from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import logging

from .config import settings
from .search_engine import PharmaSearchEngine
from .product_processor import EnhancedProductProcessor

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


@app.get("/api/grouping-analysis")
async def analyze_grouping():
    """Analyze grouping effectiveness"""
    try:
        processor = EnhancedProductProcessor(settings.database_url)
        await processor.connect()

        async with processor.pool.acquire() as conn:
            stats = await conn.fetchrow("""
                SELECT
                    COUNT(*) as total_products,
                    COUNT(DISTINCT group_stats."productGroupId") as total_groups,
                    AVG(group_stats.product_count) as avg_products_per_group,
                    AVG(group_stats.vendor_count) as avg_vendors_per_group,
                    COUNT(*) FILTER (WHERE group_stats.vendor_count > 1) as groups_with_multiple_vendors
                FROM "Product" p
                JOIN (
                    SELECT
                        "productGroupId",
                        COUNT(*) as product_count,
                        COUNT(DISTINCT "vendorId") as vendor_count
                    FROM "Product"
                    WHERE "productGroupId" IS NOT NULL
                    GROUP BY "productGroupId"
                ) group_stats ON p."productGroupId" = group_stats."productGroupId"
                WHERE p."productGroupId" IS NOT NULL
            """)

            top_groups = await conn.fetch("""
                SELECT
                    pg."normalizedName",
                    pg."productCount",
                    COUNT(DISTINCT p."vendorId") as vendor_count,
                    MIN(p.price) as min_price,
                    MAX(p.price) as max_price,
                    AVG(p.price) as avg_price
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                GROUP BY pg.id, pg."normalizedName", pg."productCount"
                ORDER BY pg."productCount" DESC
                LIMIT 10
            """) 

        await processor.disconnect()

        return {
            "status": "completed",
            "statistics": {
                "total_products": stats["total_products"],
                "total_groups": stats["total_groups"],
                "avg_products_per_group": stats["avg_products_per_group"] if stats["avg_products_per_group"] else 0,
                "avg_vendors_per_group": stats["avg_vendors_per_group"] if stats["avg_vendors_per_group"] else 0,
                "groups_with_multiple_vendors": stats["groups_with_multiple_vendors"] if stats["groups_with_multiple_vendors"] else 0,
                "multi_vendor_percentage": (stats["groups_with_multiple_vendors"] / stats["total_groups"]) * 100 if stats["total_groups"] else 0,
            },
            "top_groups": [
                {
                    "name": group["normalizedName"],
                    "product_count": group["productCount"],
                    "vendor_count": group["vendor_count"],
                    "price_range": {
                        "min": group["min_price"],
                        "max": group["max_price"],
                        "avg": group["avg_price"],
                    }
                } for group in top_groups
            ]
        }
    except Exception as e:
        logger.error(f"Grouping analysis error: {e}")
        raise HTTPException(status_code=500, detail="Grouping analysis failed")


@app.get("/api/price-comparison/{group_id}")
async def price_comparison(group_id: str):
    """Get detailed price comparison for a group"""
    try:
        search_engine = PharmaSearchEngine(settings.database_url)
        await search_engine.connect()

        async with search_engine.pool.acquire() as conn:
            group_data = await conn.fetchrow(
                """
                SELECT
                    pg.*,
                    COUNT(DISTINCT p."vendorId") as vendor_count,
                    MIN(p.price) as min_price,
                    MAX(p.price) as max_price,
                    AVG(p.price) as avg_price,
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                WHERE pg.id = $1
                GROUP BY pg.id
                """,
                group_id
            )

            products = await conn.fetch(
                """
                SELECT
                    p.*,
                    v.name as vendor_name,
                    v.website as vendor_website,
                    b.name as brand_name,
                    p.price - $2 as price_diff_from_avg,
                    CASE
                        WHEN $3 - $4 > 0
                        THEN (p.price - $4) / ($3 - $4) * 100
                        ELSE 0
                    END as price_percentile
                FROM "Product" p
                JOIN "Vendor" v ON p."vendorId" = v.id
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE p."productGroupId" = $1
                ORDER BY p.price
                """,
                group_id,
                group_data["min_price"],
                group_data["max_price"],
                group_data["avg_price"],
            )

            await search_engine.disconnect()

            return {
                "group": {
                    "id": group_data["id"],
                    "name": group_data["normalizedName"],
                    "product_count": group_data["productCount"],
                    "vendor_count": group_data["vendor_count"],
                    "dosage_value": float(group_data["dosageValue"]) if group_data["dosageValue"] else None,
                    "dosage_unit": group_data["dosageUnit"],
                    "price_stats": {
                        "min": float(group_data["min_price"]),
                        "max": float(group_data["max_price"]),
                        "avg": float(group_data["avg_price"]),
                        "range": float(group_data["max_price"]) - float(group_data["min_price"])
                    }
                },
                "products": [
                    {
                        "id": product["id"],
                        "title": product["title"],
                        "price": float(product["price"]),
                        "vendor": {
                            "name": product["vendor_name"],
                            "website": product["vendor_website"]
                        },
                        "brand": product["brand_name"],
                        "link": product["link"],
                        "thumbnail": product["thumbnail"],
                        "price_analysis": {
                            "diff_from_avg": float(product["price_diff_from_avg"]),
                            "percentile": float(product["price_percentile"]),
                            "is_best_deal": product["price"] == group_data["min_price"],
                            "is_worst_deal": product["price"] == group_data["max_price"]
                        }
                    }
                    for product in products
                ]
            }

    except Exception as e:
        logger.error(f"Price comparison error: {e}")
        raise HTTPException(status_code=500, detail="Price comparison failed")

