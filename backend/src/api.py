from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import logging

from .config import settings
from .search_engine import PharmaSearchEngine
from .product_processor import EnhancedProductProcessor
from .query_enhancer import QueryEnhancer
from .price_recommender import PriceRecommender

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

# Initialize search engine and recommender components
search_engine = PharmaSearchEngine(settings.database_url)
query_enhancer = QueryEnhancer(settings.database_url)
price_recommender = PriceRecommender(settings.database_url)


@app.on_event("startup")
async def startup():
    """Initialize connections on startup"""
    await search_engine.connect()
    await query_enhancer.connect()
    await price_recommender.connect()
    logger.info("Search engine and recommender systems connected")


@app.on_event("shutdown")
async def shutdown():
    """Close connections on shutdown"""
    await search_engine.disconnect()
    await query_enhancer.disconnect()
    await price_recommender.disconnect()
    logger.info("Search engine and recommender systems disconnected")


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
        # Enhance the query before searching
        query_enhancements = query_enhancer.enhance_query(q)
        enhanced_query = query_enhancements.get('corrected_query', q)
        
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
        logger.info(f"Original query: '{q}' -> Enhanced: '{enhanced_query}', type: {search_type}")

        results = await search_engine.search(
            query=enhanced_query,
            filters=filters if filters else None,
            group_results=True,
            limit=limit,
            offset=offset,
            force_db_search=force_db_search,
        )

        # Add search metadata to results
        results["search_type_used"] = "database" if force_db_search else "hybrid"
        results["query_enhancements"] = query_enhancements

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


# New Recommendation API Endpoints

@app.get("/api/suggestions")
async def get_search_suggestions(
    q: str = Query(..., description="Partial search query"),
    limit: int = Query(5, ge=1, le=10)
):
    """Get search suggestions and query completions"""
    try:
        suggestions = await query_enhancer.suggest_query_completions(q, limit)
        return {
            "query": q,
            "suggestions": suggestions
        }
    except Exception as e:
        logger.error(f"Suggestions error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get suggestions")


@app.get("/api/related-searches")
async def get_related_searches(
    q: str = Query(..., description="Search query"),
    limit: int = Query(5, ge=1, le=10)
):
    """Get related search terms"""
    try:
        related = await query_enhancer.get_related_searches(q, limit)
        return {
            "query": q,
            "related_searches": related
        }
    except Exception as e:
        logger.error(f"Related searches error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get related searches")


@app.get("/api/better-deals/{product_id}")
async def get_better_deals(
    product_id: str,
    similarity_threshold: float = Query(0.8, ge=0.1, le=1.0)
):
    """Find better deals for similar products"""
    try:
        deals = await price_recommender.find_better_deals(product_id, similarity_threshold)
        return {
            "product_id": product_id,
            "better_deals": deals,
            "count": len(deals)
        }
    except Exception as e:
        logger.error(f"Better deals error: {e}")
        raise HTTPException(status_code=500, detail="Failed to find better deals")


@app.get("/api/cheaper-alternatives")
async def get_cheaper_alternatives(
    q: str = Query(..., description="Search query"),
    price_limit: Optional[float] = Query(None, ge=0),
    limit: int = Query(10, ge=1, le=20)
):
    """Get cheaper alternatives for a search query"""
    try:
        alternatives = await price_recommender.suggest_cheaper_alternatives(q, price_limit)
        return {
            "query": q,
            "price_limit": price_limit,
            "alternatives": alternatives[:limit],
            "count": len(alternatives[:limit])
        }
    except Exception as e:
        logger.error(f"Cheaper alternatives error: {e}")
        raise HTTPException(status_code=500, detail="Failed to find cheaper alternatives")


@app.post("/api/price-alerts")
async def track_price_drops(
    product_ids: List[str],
    days_back: int = Query(30, ge=1, le=90)
):
    """Track price drops for specified products"""
    try:
        alerts = await price_recommender.track_price_drops(product_ids, days_back)
        return {
            "product_ids": product_ids,
            "price_alerts": alerts,
            "count": len(alerts)
        }
    except Exception as e:
        logger.error(f"Price alerts error: {e}")
        raise HTTPException(status_code=500, detail="Failed to track price drops")


@app.get("/api/price-insights/{group_id}")
async def get_price_insights(group_id: str):
    """Get detailed price insights for a product group"""
    try:
        insights = await price_recommender.get_price_comparison_insights(group_id)
        return {
            "group_id": group_id,
            "insights": insights
        }
    except Exception as e:
        logger.error(f"Price insights error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get price insights")

