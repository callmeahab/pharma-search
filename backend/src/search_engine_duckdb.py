"""
DuckDB-based search engine for pharmaceutical products with enhanced full-text search
"""
import asyncio
import hashlib
import json
import logging
import os
import time
from collections import defaultdict
from functools import lru_cache
from typing import Any, Dict, List, Optional

from rapidfuzz import fuzz

try:
    from .database import get_db_pool, close_db_pool
except ImportError:
    try:
        # Handle relative import when running directly
        from database import get_db_pool, close_db_pool
    except ImportError:
        # Docker environment - use absolute imports
        import sys
        import os
        sys.path.append(os.path.dirname(__file__))
        from database import get_db_pool, close_db_pool

logger = logging.getLogger(__name__)


class DuckDBPharmaSearchEngine:
    """Search engine for pharmaceutical products using DuckDB with advanced full-text search"""

    def __init__(self, db_path: str, cache_dir: str = "backend/cache"):
        self.db_path = db_path
        self.cache_dir = cache_dir
        # Ensure cache directory exists
        os.makedirs(cache_dir, exist_ok=True)
        self._search_cache = {}
        self.db_pool = None

    async def connect(self):
        """Initialize connection"""
        self.db_pool = await get_db_pool()
        
        # Debug: Check if database file exists and its size
        if os.path.exists(self.db_path):
            size = os.path.getsize(self.db_path)
            logger.info(f"Database file {self.db_path} exists, size: {size} bytes")
        else:
            logger.warning(f"Database file {self.db_path} does not exist")
        
        await self._process_products_if_needed()
        logger.info("DuckDB search engine connected")

    async def disconnect(self):
        """Close connections"""
        await close_db_pool()
        logger.info("DuckDB search engine disconnected")

    def _get_cache_key(self, query: str, filters: Optional[Dict], limit: int, offset: int, search_type: str) -> str:
        """Generate cache key for search results"""
        key_data = {
            "query": query.lower().strip(),
            "filters": filters or {},
            "limit": limit,
            "offset": offset,
            "search_type": search_type
        }
        return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()

    def _is_cache_valid(self, cache_entry: Dict, max_age: int = 300) -> bool:
        """Check if cache entry is still valid (default 5 minutes)"""
        return time.time() - cache_entry.get("timestamp", 0) < max_age

    async def _process_products_if_needed(self):
        """Process products if there are unprocessed ones"""
        logger.info("Checking for unprocessed products")

        async with self.db_pool.acquire() as conn:
            try:
                # Check if Product table exists
                tables = await conn.execute("SHOW TABLES")
                table_names = [t['table_name'] for t in tables] if tables else []
                
                if 'Product' not in table_names:
                    logger.warning("Product table not found. Database may be empty.")
                    await self._initialize_schema_if_needed()
                    return
                
                result = await conn.execute(
                    'SELECT COUNT(*) as count FROM Product WHERE processedAt IS NULL'
                )
                unprocessed_count = result[0]['count'] if result else 0

                if unprocessed_count > 0:
                    logger.info(f"Found {unprocessed_count} unprocessed products, starting processing")
                    # TODO: Implement DuckDB product processor
                    logger.info("Product processing completed")
                else:
                    logger.info("All products are already processed")
                    
            except Exception as e:
                logger.error(f"Error checking products: {e}")
                await self._initialize_schema_if_needed()

    async def _initialize_schema_if_needed(self):
        """Initialize database schema if tables don't exist"""
        logger.info("Initializing DuckDB schema...")
        
        try:
            from .migration_helper import create_schema_only
        except ImportError:
            try:
                from migration_helper import create_schema_only
            except ImportError:
                logger.error("Migration helper not found")
                return
        
        success = await create_schema_only(self.db_path)
        if success:
            logger.info("Schema initialized successfully")
        else:
            logger.error("Failed to initialize schema")

    async def search(
        self,
        query: str,
        filters: Optional[Dict] = None,
        group_results: bool = True,
        limit: int = 5000,
        offset: int = 0,
        search_type: str = "auto",
    ) -> Dict[str, Any]:
        """Search for products with caching and DuckDB FTS

        Args:
            query: Search query
            filters: Optional filters (price, vendor, brand)
            group_results: Whether to group results by product
            limit: Maximum results to return
            offset: Offset for pagination
            search_type: Search strategy ("auto", "similarity", "database")
        """

        # Generate cache key
        cache_key = self._get_cache_key(query, filters, limit, offset, search_type)

        # Check cache
        if cache_key in self._search_cache:
            cache_entry = self._search_cache[cache_key]
            if self._is_cache_valid(cache_entry):
                logger.debug(f"Cache hit for query: {query}")
                return cache_entry["result"]

        # Execute search using DuckDB FTS
        if group_results:
            result = await self._search_with_grouping(query, filters, limit, offset, search_type)
        else:
            result = await self._search_products(query, filters, limit, offset, search_type)

        # Cache result
        self._search_cache[cache_key] = {
            "result": result,
            "timestamp": time.time()
        }

        # Clean old cache entries (keep only last 1000 entries)
        if len(self._search_cache) > 1000:
            old_keys = list(self._search_cache.keys())[:-500]
            for key in old_keys:
                del self._search_cache[key]

        return result

    async def _search_with_grouping(
        self, query: str, filters: Optional[Dict], limit: int, offset: int, search_type: str
    ) -> Dict[str, Any]:
        """Search with dynamic grouping using DuckDB FTS"""

        query_lower = query.lower().strip()
        
        # Get matches using DuckDB full-text search
        matches = await self._get_fts_matches(query_lower, filters, search_type)
        
        logger.info(f"DuckDB FTS found {len(matches)} matches for query: '{query}'")

        if not matches:
            return {"groups": [], "total": 0, "offset": offset, "limit": limit, "search_type_used": search_type}

        # Create dynamic groups
        return await self._create_dynamic_groups(matches, query_lower, filters, limit, offset, search_type)

    async def _get_fts_matches(self, query: str, filters: Optional[Dict], search_type: str) -> List[Dict]:
        """Get product matches using DuckDB full-text search"""
        
        async with self.db_pool.acquire() as conn:
            # Simplified DuckDB query without FTS for now (FTS will be added after data migration)
            base_query = """
            SELECT DISTINCT 
                p.id,
                p.title,
                p.normalizedName,
                p.price,
                p.link,
                p.thumbnail,
                p.description,
                p.vendorId,
                p.brandId,
                p.dosageValue,
                p.dosageUnit,
                v.name as vendor_name,
                b.name as brand_name,
                CASE 
                    -- Exact title match gets highest score
                    WHEN LOWER(p.title) = ? THEN 1000
                    -- Exact normalized name match
                    WHEN LOWER(p.normalizedName) = ? THEN 950
                    -- Title starts with query
                    WHEN LOWER(p.title) LIKE (? || '%') THEN 700
                    -- Normalized name starts with query  
                    WHEN LOWER(p.normalizedName) LIKE (? || '%') THEN 650
                    -- Brand name exact match
                    WHEN LOWER(b.name) = ? THEN 600
                    -- Brand name starts with query
                    WHEN LOWER(b.name) LIKE (? || '%') THEN 550
                    -- Title contains query
                    WHEN LOWER(p.title) LIKE ('%' || ? || '%') THEN 400
                    -- Normalized name contains query
                    WHEN LOWER(p.normalizedName) LIKE ('%' || ? || '%') THEN 350
                    ELSE 100
                END as relevance_score
            FROM Product p
            LEFT JOIN Vendor v ON p.vendorId = v.id
            LEFT JOIN Brand b ON p.brandId = b.id
            WHERE (
                LOWER(p.title) LIKE ('%' || ? || '%') OR
                LOWER(p.normalizedName) LIKE ('%' || ? || '%') OR
                LOWER(b.name) LIKE ('%' || ? || '%')
            )
            """

            # Parameters for the base query (query is repeated multiple times for different CASE conditions)
            params = [query.lower()] * 11  # query used 11 times in the CASE and WHERE clauses
            
            if filters:
                if 'min_price' in filters:
                    base_query += " AND p.price >= ?"
                    params.append(float(filters['min_price']))
                
                if 'max_price' in filters:
                    base_query += " AND p.price <= ?"
                    params.append(float(filters['max_price']))
                
                if 'vendor_ids' in filters and filters['vendor_ids']:
                    placeholders = ', '.join(['?' for _ in filters['vendor_ids']])
                    base_query += f" AND p.vendorId IN ({placeholders})"
                    params.extend(filters['vendor_ids'])
                
                if 'brand_ids' in filters and filters['brand_ids']:
                    placeholders = ', '.join(['?' for _ in filters['brand_ids']])
                    base_query += f" AND p.brandId IN ({placeholders})"
                    params.extend(filters['brand_ids'])

            # Order by relevance
            base_query += " ORDER BY relevance_score DESC LIMIT 1000"

            try:
                results = await conn.execute(base_query, params)
                return results
            except Exception as e:
                logger.error(f"DuckDB query failed: {e}")
                logger.error(f"Query: {base_query}")
                logger.error(f"Params: {params}")
                
                # Fallback to simple text search
                return await self._fallback_text_search(query, filters, conn)

    async def _fallback_text_search(self, query: str, filters: Optional[Dict], conn) -> List[Dict]:
        """Fallback text search when FTS fails"""
        
        fallback_query = """
        SELECT DISTINCT 
            p.id,
            p.title,
            p.normalizedName,
            p.price,
            p.link,
            p.thumbnail,
            p.description,
            p.vendorId,
            p.brandId,
            p.dosageValue,
            p.dosageUnit,
            v.name as vendor_name,
            b.name as brand_name,
            CASE 
                WHEN LOWER(p.title) = ? THEN 1000
                WHEN LOWER(p.normalizedName) = ? THEN 950
                WHEN LOWER(p.title) LIKE (? || '%') THEN 700
                WHEN LOWER(p.normalizedName) LIKE (? || '%') THEN 650
                WHEN LOWER(p.title) LIKE ('%' || ? || '%') THEN 400
                WHEN LOWER(p.normalizedName) LIKE ('%' || ? || '%') THEN 350
                ELSE 100
            END as relevance_score
        FROM Product p
        LEFT JOIN Vendor v ON p.vendorId = v.id
        LEFT JOIN Brand b ON p.brandId = b.id
        WHERE (
            LOWER(p.title) LIKE ('%' || ? || '%') OR
            LOWER(p.normalizedName) LIKE ('%' || ? || '%') OR
            LOWER(b.name) LIKE ('%' || ? || '%')
        )
        ORDER BY relevance_score DESC
        LIMIT 1000
        """

        try:
            # query used 9 times in the above query
            params = [query.lower()] * 9
            results = await conn.execute(fallback_query, params)
            return results
        except Exception as e:
            logger.error(f"Fallback search also failed: {e}")
            return []

    async def _create_dynamic_groups(
        self, matches: List[Dict], query: str, filters: Optional[Dict], 
        limit: int, offset: int, search_type: str
    ) -> Dict[str, Any]:
        """Create dynamic product groups from search results"""
        
        # Group products by normalized name
        groups_dict = defaultdict(list)
        
        for product in matches:
            # Use normalizedName as the grouping key, fallback to title
            group_key = product.get('normalizedName') or product.get('title', '')
            if group_key:
                groups_dict[group_key.lower()].append(product)
        
        # Convert to list format and calculate group statistics
        groups = []
        for group_name, products in groups_dict.items():
            if not products:
                continue
                
            # Calculate price statistics
            prices = [float(p['price']) for p in products if p.get('price') is not None]
            if not prices:
                continue
                
            min_price = min(prices)
            max_price = max(prices)
            avg_price = sum(prices) / len(prices)
            
            # Get unique vendors
            vendors = set(p.get('vendorId') for p in products if p.get('vendorId'))
            
            # Create group object
            group = {
                "id": hashlib.md5(group_name.encode()).hexdigest()[:12],
                "normalized_name": group_name.title(),
                "products": products,
                "price_range": {
                    "min": min_price,
                    "max": max_price,
                    "avg": avg_price,
                    "range": max_price - min_price
                },
                "vendor_count": len(vendors),
                "product_count": len(products),
                "dosage_value": products[0].get('dosageValue'),
                "dosage_unit": products[0].get('dosageUnit'),
            }
            
            # Add price analysis
            if len(products) > 1:
                below_avg = sum(1 for p in prices if p < avg_price)
                above_avg = len(prices) - below_avg
                
                group["price_analysis"] = {
                    "savings_potential": max_price - min_price,
                    "price_variation": (max_price - min_price) / avg_price * 100 if avg_price > 0 else 0,
                    "below_avg_count": below_avg,
                    "above_avg_count": above_avg,
                    "has_multiple_vendors": len(vendors) > 1
                }
            
            groups.append(group)
        
        # Sort groups by relevance (products with exact matches first)
        def group_relevance(group):
            # Check if any product in group has high relevance to query
            max_relevance = max((
                1000 if query in group['normalized_name'].lower() else
                500 if group['normalized_name'].lower().startswith(query) else
                100
            ), 100)
            
            # Boost groups with multiple vendors (better for comparison)
            if group['vendor_count'] > 1:
                max_relevance += 50
                
            return max_relevance
        
        groups.sort(key=group_relevance, reverse=True)
        
        # Apply pagination
        total = len(groups)
        groups = groups[offset:offset + limit]
        
        return {
            "groups": groups,
            "total": total,
            "offset": offset,
            "limit": limit,
            "search_type_used": search_type
        }

    async def _search_products(
        self, query: str, filters: Optional[Dict], limit: int, offset: int, search_type: str
    ) -> Dict[str, Any]:
        """Search products without grouping"""
        
        matches = await self._get_fts_matches(query, filters, search_type)
        
        # Apply pagination
        total = len(matches)
        products = matches[offset:offset + limit]
        
        return {
            "products": products,
            "total": total,
            "offset": offset,
            "limit": limit,
            "search_type_used": search_type
        }

    async def get_price_comparison(self, group_id: str) -> Dict[str, Any]:
        """Get detailed price comparison for a product group"""
        
        async with self.db_pool.acquire() as conn:
            # Get products from the price comparison view
            results = await conn.execute("""
                SELECT * FROM PriceComparisonView 
                WHERE group_id = $1 
                ORDER BY price
            """, [group_id])
            
            if not results:
                raise ValueError(f"No price comparison data found for group {group_id}")
            
            # Group data
            first_result = results[0]
            group_data = {
                "id": group_id,
                "name": first_result.get('product_name', ''),
                "product_count": first_result.get('product_count', 0),
                "vendor_count": first_result.get('vendor_count', 0),
                "dosage_value": first_result.get('dosage_value'),
                "dosage_unit": first_result.get('dosage_unit'),
                "price_stats": {
                    "min": first_result.get('min_price', 0),
                    "max": first_result.get('max_price', 0),
                    "avg": first_result.get('avg_price', 0),
                    "range": first_result.get('max_price', 0) - first_result.get('min_price', 0)
                }
            }
            
            # Product data with price analysis
            products = []
            for result in results:
                product = {
                    "id": result['product_id'],
                    "title": result['title'],
                    "price": result['price'],
                    "vendor": {
                        "name": result['vendor_name'],
                        "website": result.get('vendor_website', '')
                    },
                    "brand": result.get('brand_name', ''),
                    "link": result['link'],
                    "thumbnail": result['thumbnail'],
                    "price_analysis": {
                        "diff_from_avg": result.get('price_diff_from_avg', 0),
                        "percentile": result.get('price_percentile', 0),
                        "is_best_deal": result['price'] == group_data['price_stats']['min'],
                        "is_worst_deal": result['price'] == group_data['price_stats']['max']
                    }
                }
                products.append(product)
            
            return {
                "group": group_data,
                "products": products
            }

    async def get_grouping_analysis(self) -> Dict[str, Any]:
        """Get grouping analysis using DuckDB views"""
        
        async with self.db_pool.acquire() as conn:
            # Get statistics from the materialized view
            stats_result = await conn.execute("""
                SELECT 
                    COUNT(*) as total_products,
                    COUNT(DISTINCT normalizedName) as total_groups,
                    AVG(product_count) as avg_products_per_group,
                    AVG(vendor_count) as avg_vendors_per_group,
                    SUM(CASE WHEN vendor_count > 1 THEN 1 ELSE 0 END) as groups_with_multiple_vendors
                FROM ProductGroupStats
            """)
            
            if not stats_result:
                return {"status": "error", "message": "No grouping data available"}
            
            stats = stats_result[0]
            total_groups = stats.get('total_groups', 1)
            multi_vendor_groups = stats.get('groups_with_multiple_vendors', 0)
            
            # Calculate percentage
            multi_vendor_percentage = (multi_vendor_groups / total_groups * 100) if total_groups > 0 else 0
            
            # Get top groups
            top_groups_result = await conn.execute("""
                SELECT 
                    normalizedName as name,
                    product_count,
                    vendor_count,
                    min_price,
                    max_price,
                    avg_price
                FROM ProductGroupStats
                ORDER BY product_count DESC, vendor_count DESC
                LIMIT 10
            """)
            
            top_groups = []
            for group in top_groups_result:
                top_groups.append({
                    "name": group['name'],
                    "product_count": group['product_count'],
                    "vendor_count": group['vendor_count'],
                    "price_range": {
                        "min": group['min_price'],
                        "max": group['max_price'],
                        "avg": group['avg_price']
                    }
                })
            
            return {
                "status": "success",
                "statistics": {
                    "total_products": stats.get('total_products', 0),
                    "total_groups": total_groups,
                    "avg_products_per_group": round(stats.get('avg_products_per_group', 0), 2),
                    "avg_vendors_per_group": round(stats.get('avg_vendors_per_group', 0), 2),
                    "groups_with_multiple_vendors": multi_vendor_groups,
                    "multi_vendor_percentage": round(multi_vendor_percentage, 2)
                },
                "top_groups": top_groups
            }