from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import logging
import os
import smtplib
import ssl
import json
import asyncio
from email.message import EmailMessage
from pydantic import BaseModel, EmailStr

from .config import settings
from .search_engine import PharmaSearchEngine
from .product_processor import EnhancedProductProcessor
# from .routes.exports import register_export_routes  # TODO: Create export routes if needed

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(title="Pharma Search API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize search engine
search_engine = PharmaSearchEngine(settings.database_url)
register_export_routes(app, search_engine)


class ContactPayload(BaseModel):
    name: str
    email: EmailStr
    message: str


def send_email_via_smtp(name: str, email: str, message: str) -> dict:
    contact_email = os.getenv("CONTACT_EMAIL", "apostekafm@gmail.com")
    host = os.getenv("SMTP_HOST")
    port_raw = os.getenv("SMTP_PORT")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")

    if not host or not port_raw or not user or not password:
        return {
            "ok": True,
            "mocked": True,
            "missing": {
                "SMTP_HOST": not bool(host),
                "SMTP_PORT": not bool(port_raw),
                "SMTP_USER": not bool(user),
                "SMTP_PASS": not bool(password),
            },
        }

    port = int(port_raw)

    email_msg = EmailMessage()
    email_msg["From"] = f"Pharmagician <no-reply@pharmagician.rs>"
    email_msg["To"] = contact_email
    email_msg["Reply-To"] = email
    email_msg["Subject"] = f"Kontakt forma: {name}"
    email_msg.set_content(f"Ime: {name}\nEmail: {email}\n\nPoruka:\n{message}")

    # TLS for 587, SSL for 465
    if port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context) as server:
            server.login(user, password)
            server.send_message(email_msg)
    else:
        with smtplib.SMTP(host, port) as server:
            server.ehlo()
            try:
                server.starttls()
            except Exception:
                # Some providers may not require TLS
                pass
            server.login(user, password)
            server.send_message(email_msg)

    return {"ok": True}


@app.on_event("startup")
async def startup():
    """Initialize connections on startup"""
    await search_engine.connect()
    logger.info("Search engine connected")


@app.on_event("shutdown")
async def shutdown():
    """Close connections on shutdown"""
    await search_engine.disconnect()
    logger.info("Search engine disconnected")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/api/contact")
async def contact(payload: ContactPayload):
    """Receive contact form submissions and send email via SMTP."""
    try:
        name = payload.name.strip()
        email = str(payload.email)
        message = payload.message.strip()
        if not name or not email or not message:
            raise HTTPException(status_code=400, detail="Missing fields")

        result = send_email_via_smtp(name, email, message)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Contact error: {e}")
        raise HTTPException(status_code=500, detail="Contact failed")


@app.get("/api/autocomplete")
async def autocomplete(
    q: str = Query(..., description="Search query for autocomplete"),
    limit: int = Query(8, ge=1, le=20),
):
    """Fast autocomplete search endpoint"""
    try:
        # Use the fast autocomplete function with explicit type casting
        async with search_engine.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM fast_autocomplete_search($1::text, $2::integer)",
                q, limit
            )
            
            # Convert to simple format for autocomplete
            suggestions = []
            for row in rows:
                suggestions.append({
                    "id": row["id"],
                    "title": row["title"],
                    "price": float(row["price"]),
                    "vendor_name": row["vendor_name"],
                })
            
            return {
                "suggestions": suggestions,
                "query": q,
                "limit": limit
            }
    except Exception as e:
        logger.error(f"Autocomplete error: {e}")
        raise HTTPException(status_code=500, detail="Autocomplete failed")

@app.get("/api/search-groups")
async def search_groups(
    q: str = Query(..., description="Search query"),
    limit: int = Query(20, ge=1, le=100),
):
    """Fast search using precomputed groups"""
    try:
        async with search_engine.pool.acquire() as conn:
            # Try precomputed groups first
            groups = await conn.fetch(
                "SELECT * FROM search_product_groups($1::text, $2::integer)",
                q, limit
            )
            
            if not groups:
                # Fallback to regular search
                return await search(q, limit, 0)
            
            # Convert to our format
            result_groups = []
            for group in groups:
                # Get sample products from this group
                products = await conn.fetch("""
                    SELECT p.id, p.title, p.price, p."vendorId", v.name as vendor_name, 
                           p.link, p.thumbnail, b.name as brand_name
                    FROM "Product" p
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    LEFT JOIN "Brand" b ON b.id = p."brandId"
                    WHERE p.id = ANY($1::text[])
                    ORDER BY p.price ASC
                    LIMIT 20
                """, group["product_ids"])
                
                result_groups.append({
                    "id": f"group_{group['group_id']}",
                    "normalized_name": group["display_name"],
                    "products": [
                        {
                            "id": p["id"],
                            "title": p["title"],
                            "price": float(p["price"]),
                            "vendor_id": p["vendorId"],
                            "vendor_name": p["vendor_name"],
                            "link": p["link"],
                            "thumbnail": p["thumbnail"],
                            "brand_name": p["brand_name"] or ""
                        } for p in products
                    ],
                    "price_range": {
                        "min": float(group["min_price"]),
                        "max": float(group["max_price"]),
                        "avg": float(group["avg_price"]) if group["avg_price"] else 0
                    },
                    "vendor_count": int(group["vendor_count"]),
                    "product_count": int(group["product_count"]),
                })
            
            return {
                "groups": result_groups,
                "total": len(result_groups),
                "offset": 0,
                "limit": limit,
                "search_type_used": "precomputed_groups"
            }
    except Exception as e:
        logger.error(f"Groups search error: {e}")
        # Fallback to regular search
        return await search(q, limit, 0)

@app.get("/api/search")
async def search(
    q: str = Query(..., description="Search query"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    min_price: Optional[float] = Query(None),
    max_price: Optional[float] = Query(None),
    vendor_ids: Optional[List[str]] = Query(None),
    brand_ids: Optional[List[str]] = Query(None),
    search_type: Optional[str] = Query(
        "auto", description="Search type: 'auto', 'similarity', or 'database'"
    ),
):
    """Search for products

    Args:
        q: Search query
        limit: Maximum number of results
        offset: Offset for pagination
        min_price: Minimum price filter
        max_price: Maximum price filter
        vendor_ids: Filter by vendor IDs
        brand_ids: Filter by brand IDs
        search_type: Type of search to perform:
            - 'auto': Automatically choose best search method (default)
            - 'similarity': Force similarity-based search
            - 'database': Force database search (best for exact matches)
    """
    try:
        filters = {}
        if min_price is not None:
            filters["min_price"] = min_price
        if max_price is not None:
            filters["max_price"] = max_price
        if vendor_ids:
            filters["vendor_ids"] = vendor_ids
        if brand_ids:
            filters["brand_ids"] = brand_ids

        # Determine if we should force database search
        force_db_search = search_type == "database"

        # Log search type for debugging
        logger.info(f"Search query: '{q}', type: {search_type}")

        results = await search_engine.search(
            query=q,
            filters=filters if filters else None,
            group_results=True,
            limit=limit,
            offset=offset,
            force_db_search=force_db_search,
        )

        # Add search metadata to results
        results["search_type_used"] = "database" if force_db_search else "hybrid"

        return results
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail="Search failed")


@app.get("/api/search-stream")
async def search_stream(
    q: str = Query(..., description="Search query"),
    limit: int = Query(50, ge=1, le=200),
):
    """Streaming search endpoint - returns results as they're found"""
    
    async def generate_search_stream():
        try:
            # Send initial response
            yield f"data: {json.dumps({'type': 'start', 'query': q})}\n\n"
            
            # Get search results in batches
            batch_size = 10
            offset = 0
            total_sent = 0
            
            while total_sent < limit:
                current_batch_size = min(batch_size, limit - total_sent)
                
                # Search for this batch
                results = await search_engine.search(
                    query=q,
                    filters=None,
                    group_results=True,
                    limit=current_batch_size,
                    offset=offset,
                    force_db_search=False,
                )
                
                if not results.get("groups"):
                    break
                
                # Send batch results
                batch_data = {
                    'type': 'batch',
                    'groups': results["groups"],
                    'offset': offset,
                    'batch_size': len(results["groups"])
                }
                yield f"data: {json.dumps(batch_data)}\n\n"
                
                total_sent += len(results["groups"])
                offset += current_batch_size
                
                # Small delay to prevent overwhelming
                await asyncio.sleep(0.05)
                
                # Stop if we got fewer results than requested
                if len(results["groups"]) < current_batch_size:
                    break
            
            # Send completion signal
            yield f"data: {json.dumps({'type': 'complete', 'total': total_sent})}\n\n"
            
        except Exception as e:
            logger.error(f"Streaming search error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        generate_search_stream(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.post("/api/process")
async def process_products(batch_size: int = Query(100, ge=10, le=1000)):
    """Trigger product processing"""
    try:
        processor = EnhancedProductProcessor(settings.database_url)
        await processor.connect()

        # In production, this should be a background task
        await processor.process_products(batch_size)

        await processor.disconnect()

        return {"status": "completed", "message": "Products processed with enhanced processor successfully"}
    except Exception as e:
        logger.error(f"Processing error: {e}")
        raise HTTPException(status_code=500, detail="Processing failed")


@app.post("/api/reprocess-all")
async def reprocess_all_products():
    """Reprocess all products with enhanced grouping (clears existing groups)"""
    try:
        processor = EnhancedProductProcessor(settings.database_url)
        await processor.connect()

        await processor.reprocess_all_products()
        await processor.disconnect()
        return {"status": "completed", "message": "All products reprocessed with enhanced grouping"}
    except Exception as e:
        logger.error(f"Reprocessing error: {e}")
        raise HTTPException(status_code=500, detail="Reprocessing failed")


@app.post("/api/rebuild-index")
async def rebuild_search_index():
    """Force rebuild of the search index (ignores cache)"""
    try:
        await search_engine.rebuild_index()
        return {"status": "completed", "message": "Search index rebuilt successfully"}
    except Exception as e:
        logger.error(f"Index rebuild error: {e}")
        raise HTTPException(status_code=500, detail="Index rebuild failed")


@app.get("/api/processing-analysis")
async def analyze_processing():
    """Analyze product processing effectiveness"""
    try:
        processor = EnhancedProductProcessor(settings.database_url)
        await processor.connect()

        # Use the simplified analyzer from the new processor
        stats = await processor.analyze_processing_effectiveness()

        await processor.disconnect()

        return {
            "status": "completed",
            "statistics": stats,
            "message": "Now using dynamic grouping - no pre-computed groups needed"
        }
    except Exception as e:
        logger.error(f"Processing analysis error: {e}")
        raise HTTPException(status_code=500, detail="Processing analysis failed")


@app.get("/api/price-comparison")
async def price_comparison_dynamic(q: str):
    """Get detailed price comparison using dynamic grouping"""
    try:
        search_engine = PharmaSearchEngine(settings.database_url)
        await search_engine.connect()

        # Use dynamic search to get grouped results
        results = await search_engine.search(q, group_results=True, limit=10)
        
        await search_engine.disconnect()

        if not results.get("groups"):
            return {
                "message": f"No products found for '{q}'",
                "groups": []
            }

        return {
            "query": q,
            "groups": results["groups"],
            "total_groups": len(results["groups"]),
            "message": "Price comparison using dynamic grouping"
        }
    except Exception as e:
        logger.error(f"Price comparison error: {e}")
        raise HTTPException(status_code=500, detail="Price comparison failed")
# CSV export routes registered from routes/exports.py
