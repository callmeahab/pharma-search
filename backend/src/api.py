from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import logging

from .config import settings
from .search_engine_duckdb import DuckDBPharmaSearchEngine
from .product_processor_duckdb import DuckDBProductProcessor
from .database import get_db_pool

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

# Initialize DuckDB search engine
db_path = settings.get_database_path()
search_engine = DuckDBPharmaSearchEngine(db_path)


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

        # Log search type for debugging
        logger.info(f"Search query: '{q}', type: {search_type}")

        results = await search_engine.search(
            query=q,
            filters=filters if filters else None,
            group_results=True,
            limit=limit,
            offset=offset,
            search_type=search_type,
        )

        return results
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail="Search failed")


@app.post("/api/process")
async def process_products(batch_size: int = Query(100, ge=10, le=1000)):
    """Trigger product processing"""
    try:
        db_path = settings.get_database_path()
        
        processor = DuckDBProductProcessor(db_path)
        await processor.connect()

        # In production, this should be a background task
        await processor.process_products(batch_size)

        await processor.disconnect()

        return {"status": "completed", "message": "Products processed with DuckDB processor successfully"}
    except Exception as e:
        logger.error(f"Processing error: {e}")
        raise HTTPException(status_code=500, detail="Processing failed")


@app.post("/api/reprocess-all")
async def reprocess_all_products():
    """Reprocess all products with enhanced grouping (clears existing groups)"""
    try:
        db_path = settings.get_database_path()
        
        processor = DuckDBProductProcessor(db_path)
        await processor.connect()

        await processor.reprocess_all_products()
        await processor.disconnect()
        return {"status": "completed", "message": "All products reprocessed with DuckDB processor"}
    except Exception as e:
        logger.error(f"Reprocessing error: {e}")
        raise HTTPException(status_code=500, detail="Reprocessing failed")


@app.post("/api/rebuild-index")
async def rebuild_search_index():
    """Force rebuild of the search index (ignores cache)"""
    try:
        # For DuckDB, we'll clear the cache and reinitialize FTS
        search_engine._search_cache.clear()
        # Reconnect to reinitialize FTS
        await search_engine.disconnect()
        await search_engine.connect()
        return {"status": "completed", "message": "DuckDB search index rebuilt successfully"}
    except Exception as e:
        logger.error(f"Index rebuild error: {e}")
        raise HTTPException(status_code=500, detail="Index rebuild failed")


@app.get("/api/processing-analysis")
async def analyze_processing():
    """Analyze product processing effectiveness"""
    try:
        db_path = settings.get_database_path()
        
        processor = DuckDBProductProcessor(db_path)
        await processor.connect()

        # Use the simplified analyzer from the new processor
        stats = await processor.analyze_processing_effectiveness()

        await processor.disconnect()

        return {
            "status": "completed",
            "statistics": stats,
            "message": "DuckDB processing analysis completed"
        }
    except Exception as e:
        logger.error(f"Processing analysis error: {e}")
        raise HTTPException(status_code=500, detail="Processing analysis failed")


@app.get("/api/price-comparison/{group_id}")
async def get_price_comparison(group_id: str):
    """Get detailed price comparison for a specific product group"""
    try:
        result = await search_engine.get_price_comparison(group_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Price comparison error: {e}")
        raise HTTPException(status_code=500, detail="Price comparison failed")


@app.get("/api/grouping-analysis")
async def get_grouping_analysis():
    """Get grouping analysis and statistics"""
    try:
        result = await search_engine.get_grouping_analysis()
        return result
    except Exception as e:
        logger.error(f"Grouping analysis error: {e}")
        raise HTTPException(status_code=500, detail="Grouping analysis failed")


# New endpoints for scrapers
@app.get("/api/vendors")
async def get_vendors(
    name: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=100)
):
    """Get vendors, optionally filtered by name"""
    try:
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            if name:
                vendors = await conn.execute(
                    "SELECT * FROM Vendor WHERE name = ? LIMIT ?", 
                    [name, limit]
                )
            else:
                vendors = await conn.execute(
                    "SELECT * FROM Vendor LIMIT ?", 
                    [limit]
                )
            return vendors
    except Exception as e:
        logger.error(f"Vendor lookup error: {e}")
        raise HTTPException(status_code=500, detail="Vendor lookup failed")


@app.get("/api/products")
async def get_products(
    title: Optional[str] = Query(None),
    vendorId: Optional[str] = Query(None),
    orderBy: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=100)
):
    """Get products with optional filtering"""
    try:
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM Product WHERE 1=1"
            params = []
            
            if title:
                query += " AND title = ?"
                params.append(title)
            if vendorId:
                query += " AND vendorId = ?"
                params.append(vendorId)
            if orderBy:
                if orderBy.startswith("createdAt:"):
                    direction = orderBy.split(":")[1].upper()
                    if direction in ["ASC", "DESC"]:
                        query += f" ORDER BY createdAt {direction}"
            
            query += " LIMIT ?"
            params.append(limit)
            
            products = await conn.execute(query, params)
            return products
    except Exception as e:
        logger.error(f"Product lookup error: {e}")
        raise HTTPException(status_code=500, detail="Product lookup failed")


@app.get("/api/products/count")
async def get_product_count():
    """Get total product count"""
    try:
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            result = await conn.execute("SELECT COUNT(*) as count FROM Product")
            return {"count": result[0]["count"] if result else 0}
    except Exception as e:
        logger.error(f"Product count error: {e}")
        raise HTTPException(status_code=500, detail="Product count failed")


class ProductCreate(BaseModel):
    title: str
    price: float
    link: str
    thumbnail: str
    photos: str
    vendorId: str
    category: Optional[str] = None

@app.post("/api/products")
async def create_product(product: ProductCreate):
    """Create a new product"""
    try:
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            # Generate ID
            import uuid
            product_id = str(uuid.uuid4()).replace("-", "")
            
            from datetime import datetime
            now = datetime.now().isoformat()
            
            await conn.execute(
                """INSERT INTO Product 
                   (id, title, price, link, thumbnail, photos, vendorId, category, createdAt, updatedAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [product_id, product.title, product.price, product.link, product.thumbnail, 
                 product.photos, product.vendorId, product.category, now, now]
            )
            return {"id": product_id, "status": "created"}
    except Exception as e:
        logger.error(f"Product creation error: {e}")
        raise HTTPException(status_code=500, detail="Product creation failed")


@app.patch("/api/products/{product_id}")
async def update_product(
    product_id: str,
    price: Optional[float] = None,
    category: Optional[str] = None
):
    """Update a product"""
    try:
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            updates = []
            params = []
            
            if price is not None:
                updates.append("price = ?")
                params.append(price)
            if category is not None:
                updates.append("category = ?")
                params.append(category)
            
            if updates:
                from datetime import datetime
                now = datetime.now().isoformat()
                updates.append("updatedAt = ?")
                params.append(now)
                params.append(product_id)
                
                query = f"UPDATE Product SET {', '.join(updates)} WHERE id = ?"
                await conn.execute(query, params)
            
            return {"status": "updated"}
    except Exception as e:
        logger.error(f"Product update error: {e}")
        raise HTTPException(status_code=500, detail="Product update failed")


class BulkDeleteRequest(BaseModel):
    ids: List[str]

@app.post("/api/products/bulk-delete")
async def bulk_delete_products(request: BulkDeleteRequest):
    """Delete multiple products by IDs"""
    try:
        if not request.ids:
            return {"deleted": 0}
            
        db_pool = await get_db_pool()
        async with db_pool.acquire() as conn:
            placeholders = ", ".join(["?" for _ in request.ids])
            await conn.execute(f"DELETE FROM Product WHERE id IN ({placeholders})", request.ids)
            return {"deleted": len(request.ids)}
    except Exception as e:
        logger.error(f"Bulk delete error: {e}")
        raise HTTPException(status_code=500, detail="Bulk delete failed")

