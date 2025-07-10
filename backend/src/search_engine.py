import asyncpg
from typing import List, Dict, Optional, Any
import json
import logging
import os
import hashlib
import asyncio
from functools import lru_cache

from .similarity_matcher import SimilarityMatcher
from .product_processor import EnhancedProductProcessor

logger = logging.getLogger(__name__)


class PharmaSearchEngine:
    """Search engine for pharmaceutical products"""

    def __init__(self, db_url: str, cache_dir: str = "backend/cache"):
        self.db_url = db_url
        self.cache_dir = cache_dir
        # Ensure cache directory exists
        os.makedirs(cache_dir, exist_ok=True)
        self.matcher = SimilarityMatcher(cache_dir=cache_dir)
        self.pool: asyncpg.pool.Pool
        self._search_cache = {}

    async def connect(self):
        """Initialize connection and load index"""
        self.pool = await asyncpg.create_pool(self.db_url)
        await self._process_products_if_needed()
        await self._load_index()

    async def disconnect(self):
        """Close connections"""
        if self.pool:
            await self.pool.close()
    
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
        import time
        return time.time() - cache_entry.get("timestamp", 0) < max_age

    async def _process_products_if_needed(self):
        """Process products if there are unprocessed ones"""
        logger.info("Checking for unprocessed products")

        async with self.pool.acquire() as conn:
            unprocessed_count = await conn.fetchval(
                'SELECT COUNT(*) FROM "Product" WHERE "processedAt" IS NULL'
            )

        if unprocessed_count > 0:
            logger.info(
                f"Found {unprocessed_count} unprocessed products, starting processing"
            )
            processor = EnhancedProductProcessor(self.db_url)
            await processor.connect()
            try:
                await processor.process_products(batch_size=20000)
                logger.info("Product processing completed")
            finally:
                await processor.disconnect()
        else:
            logger.info("All products are already processed")

    async def search(
        self,
        query: str,
        filters: Optional[Dict] = None,
        group_results: bool = True,
        limit: int = 5000,
        offset: int = 0,
        force_db_search: bool = False,
    ) -> Dict[str, Any]:
        """Search for products with caching

        Args:
            query: Search query
            filters: Optional filters (price, vendor, brand)
            group_results: Whether to group results by product
            limit: Maximum results to return
            offset: Offset for pagination
            force_db_search: Force database search instead of similarity search
        """
        
        # Generate cache key
        search_type = "db" if force_db_search else "hybrid"
        cache_key = self._get_cache_key(query, filters, limit, offset, search_type)
        
        # Check cache
        if cache_key in self._search_cache:
            cache_entry = self._search_cache[cache_key]
            if self._is_cache_valid(cache_entry):
                logger.debug(f"Cache hit for query: {query}")
                return cache_entry["result"]
        
        # Execute search
        if group_results:
            if force_db_search:
                result = await self._db_search_groups_exact(query, filters, limit, offset)
            else:
                result = await self._search_groups_hybrid(query, filters, limit, offset)
        else:
            result = await self._search_products(query, filters, limit, offset)
        
        # Cache result
        import time
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

    async def _search_groups_hybrid(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Hybrid search that combines similarity and exact matching"""

        query_lower = query.lower().strip()
        query_len = len(query_lower)

        if query_len < 2:
            similarity_threshold = 0.3
            similarity_k = 1000
        elif query_len < 4:
            similarity_threshold = 0.5
            similarity_k = 800
        else:
            similarity_threshold = 0.7
            similarity_k = 500

        # Run similarity search and database search in parallel
        async def get_similarity_results():
            # Pre-filter products by price/vendor if specified
            if filters and (filters.get("min_price") or filters.get("max_price") or filters.get("vendor_ids")):
                # Get product details to filter before similarity search
                async with self.pool.acquire() as conn:
                    price_filter = []
                    vendor_filter = []
                    
                    if filters.get("min_price"):
                        price_filter.append(f"price >= {filters['min_price']}")
                    if filters.get("max_price"):
                        price_filter.append(f"price <= {filters['max_price']}")
                    if filters.get("vendor_ids"):
                        vendor_ids_str = "', '".join(filters["vendor_ids"])
                        vendor_filter.append(f"\"vendorId\" IN ('{vendor_ids_str}')")
                    
                    where_clause = " AND ".join(price_filter + vendor_filter)
                    if where_clause:
                        valid_product_ids = await conn.fetch(
                            f'SELECT id FROM "Product" WHERE {where_clause}'
                        )
                        valid_ids = {row["id"] for row in valid_product_ids}
                        
                        # Filter similarity search to only valid products
                        similar_products = self.matcher.find_similar_products(
                            query,
                            k=similarity_k,
                            threshold=similarity_threshold,
                        )
                        return [
                            prod for prod in similar_products if prod[0] in valid_ids
                        ]
                    else:
                        return self.matcher.find_similar_products(
                            query,
                            k=similarity_k,
                            threshold=similarity_threshold,
                        )
            else:
                return self.matcher.find_similar_products(
                    query,
                    k=similarity_k,
                    threshold=similarity_threshold,
                )

        # Run both searches in parallel
        similarity_task = asyncio.create_task(get_similarity_results())
        exact_matches_task = asyncio.create_task(self._get_exact_matches(query_lower))
        
        filtered_similarity_products, exact_matches = await asyncio.gather(
            similarity_task, exact_matches_task
        )

        # Combine results, prioritizing exact matches
        all_product_ids = []
        seen_ids = set()

        # Add exact matches first (they're already sorted by relevance)
        logger.info(f"Exact matches found: {len(exact_matches)}")
        for i, product_id in enumerate(exact_matches[:10]):  # Log first 10
            logger.info(f"Exact match {i+1}: {product_id}")
            if product_id not in seen_ids:
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        # Add similarity matches, but limit them based on query length and exact match quality
        # If we have good exact matches, reduce similarity influence
        exact_match_count = len(exact_matches)
        if exact_match_count >= 5:  # Strong exact matches found
            similarity_limit = min(len(filtered_similarity_products), 50)
        elif exact_match_count >= 2:  # Some exact matches found  
            similarity_limit = min(len(filtered_similarity_products), 100)
        else:
            similarity_limit = min(len(filtered_similarity_products), 500 if query_len <= 3 else 200)
            
        logger.info(f"Similarity matches found: {len(filtered_similarity_products)}, limit: {similarity_limit}")
        for i, (product_id, score, name) in enumerate(filtered_similarity_products):
            if i >= similarity_limit:
                break
            if product_id not in seen_ids:
                if i < 5:  # Log first 5 similarity matches
                    logger.info(f"Similarity match {i+1}: {product_id} (score: {score:.3f}, name: {name[:50]}...)")
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        if not all_product_ids:
            # Fallback: try even more relaxed search for very short queries
            if query_len <= 3:
                return await self._fallback_short_query_search(query_lower, filters, limit, offset)
            return {"groups": [], "total": 0, "offset": offset, "limit": limit}

        # Get grouped results
        return await self._fetch_groups_by_product_ids(
            all_product_ids, filters, limit, offset
        )

    async def _get_exact_matches(self, query: str) -> List[str]:
        """Get product IDs that match the query exactly or as a whole word"""
        async with self.pool.acquire() as conn:
            query_len = len(query.strip())
            query_words = query.lower().split()
            is_specific_product_query = len(query_words) >= 3 and any(len(word) > 2 for word in query_words)

            if query_len <= 3:
                rows = await conn.fetch(
                    """
                    SELECT DISTINCT p.id
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE
                        -- Use full-text search for better performance
                        p."searchVector" @@ plainto_tsquery('english', $1) OR
                        -- Prefix matches (starts with)
                        p.title ILIKE ($1 || '%') OR
                        p."normalizedName" ILIKE ($1 || '%') OR
                        b.name ILIKE ($1 || '%') OR
                        -- Token array search
                        $1 = ANY(p."searchTokens") OR
                        -- Partial token matching
                        EXISTS (
                            SELECT 1 FROM unnest(p."searchTokens") AS token
                            WHERE token ILIKE ($1 || '%')
                        )
                    ORDER BY
                        -- Prioritize full-text search matches
                        CASE WHEN p."searchVector" @@ plainto_tsquery('english', $1) THEN 0
                             WHEN p.title ILIKE ($1 || '%') THEN 1
                             WHEN p."normalizedName" ILIKE ($1 || '%') THEN 2
                             WHEN b.name ILIKE ($1 || '%') THEN 3
                             ELSE 4 END,
                        p.id
                    LIMIT 1000
                    """,
                    query,
                )
            else:
                # For longer, specific queries, prioritize phrase matching over token matching
                if is_specific_product_query:
                    rows = await conn.fetch(
                        """
                        SELECT DISTINCT p.id, 
                            -- Calculate relevance score with length normalization to prevent short name bias
                            (CASE 
                                -- Exact title match (highest priority)
                                WHEN p.title ILIKE $1 OR p."normalizedName" ILIKE $1 THEN 3000
                                -- Very close phrase matches (boosted priority, but penalize if target is too short)
                                WHEN p.title ILIKE ('%' || $1 || '%') OR p."normalizedName" ILIKE ('%' || $1 || '%') THEN 
                                    CASE 
                                        WHEN length(COALESCE(p."normalizedName", p.title)) < length($1) * 0.7 THEN 800  -- Penalize if target much shorter than query
                                        WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 1200  -- Moderate penalty for very short names
                                        ELSE 2500 
                                    END
                                -- Near exact match using similarity (very high priority)
                                WHEN similarity(p.title, $1) > 0.8 OR similarity(p."normalizedName", $1) > 0.8 THEN 2000
                                -- Brand exact match
                                WHEN b.name ILIKE $1 THEN 1800
                                -- Brand phrase match (with length check)
                                WHEN b.name ILIKE ('%' || $1 || '%') THEN 
                                    CASE WHEN length(b.name) < 8 THEN 800 ELSE 1500 END
                                -- Prefix match (medium-high priority, with length normalization)
                                WHEN p.title ILIKE ($1 || '%') OR p."normalizedName" ILIKE ($1 || '%') OR b.name ILIKE ($1 || '%') THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 15 THEN 600 ELSE 1200 END
                                -- Full-text search match (medium priority - reduced for specific queries)
                                WHEN p."searchVector" @@ plainto_tsquery('english', $1) THEN 
                                    ts_rank(p."searchVector", plainto_tsquery('english', $1)) * 50 + 500
                                -- Token exact match (lower priority for specific queries, heavily penalize short names)
                                WHEN $1 = ANY(p."searchTokens") THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 100 ELSE 300 END
                                -- Token prefix match (lowest priority)
                                WHEN EXISTS (
                                    SELECT 1 FROM unnest(p."searchTokens") AS token 
                                    WHERE token ILIKE ($1 || '%')
                                ) THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 50 ELSE 200 END
                                ELSE 50
                            END) as relevance_score
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        WHERE 
                            -- Prioritize phrase matching for specific queries (most important)
                            (p.title ILIKE ('%' || $1 || '%') AND length(COALESCE(p."normalizedName", p.title)) >= length($1) * 0.5) OR
                            (p."normalizedName" ILIKE ('%' || $1 || '%') AND length(COALESCE(p."normalizedName", p.title)) >= length($1) * 0.5) OR
                            (b.name ILIKE ('%' || $1 || '%') AND length(b.name) >= length($1) * 0.5) OR
                            -- Exact matches (no length restriction needed)
                            p.title ILIKE $1 OR
                            p."normalizedName" ILIKE $1 OR
                            b.name ILIKE $1 OR
                            -- Prefix matches (only for longer target names)
                            (p.title ILIKE ($1 || '%') AND length(COALESCE(p."normalizedName", p.title)) >= 12) OR
                            (p."normalizedName" ILIKE ($1 || '%') AND length(COALESCE(p."normalizedName", p.title)) >= 12) OR
                            (b.name ILIKE ($1 || '%') AND length(b.name) >= 8) OR
                            -- Full-text search (with lower priority)
                            p."searchVector" @@ plainto_tsquery('english', $1) OR
                            -- Token matching only for substantial matches - require multiple word overlap for short names
                            ($1 = ANY(p."searchTokens") AND length(COALESCE(p."normalizedName", p.title)) >= 15) OR
                            (EXISTS (
                                SELECT 1 FROM unnest(p."searchTokens") AS token 
                                WHERE token ILIKE ($1 || '%') AND length(token) >= 4
                            ) AND length(COALESCE(p."normalizedName", p.title)) >= 15)
                        ORDER BY relevance_score DESC, p.id
                        LIMIT 2000
                        """,
                        query,
                    )
                else:
                    # Original logic for non-specific queries
                    rows = await conn.fetch(
                        """
                        SELECT DISTINCT p.id, 
                            -- Calculate relevance score using full-text search ranking
                            (CASE 
                                -- Exact title match (highest priority)
                                WHEN p.title ILIKE $1 OR p."normalizedName" ILIKE $1 THEN 1000
                                -- Near exact match using similarity (very high priority)
                                WHEN similarity(p.title, $1) > 0.8 OR similarity(p."normalizedName", $1) > 0.8 THEN 500
                                -- Full-text search match (high priority)
                                WHEN p."searchVector" @@ plainto_tsquery('english', $1) THEN 
                                    ts_rank(p."searchVector", plainto_tsquery('english', $1)) * 100 + 200
                                -- Token exact match
                                WHEN $1 = ANY(p."searchTokens") THEN 150
                                -- Prefix match (medium-high priority)
                                WHEN p.title ILIKE ($1 || '%') OR
                                    p."normalizedName" ILIKE ($1 || '%') OR
                                    b.name ILIKE ($1 || '%') THEN 120
                                -- Token prefix match
                                WHEN EXISTS (
                                    SELECT 1 FROM unnest(p."searchTokens") AS token 
                                    WHERE token ILIKE ($1 || '%')
                                ) THEN 110
                                -- Substring match (medium priority)
                                WHEN p.title ILIKE ('%' || $1 || '%') OR
                                    p."normalizedName" ILIKE ('%' || $1 || '%') THEN 100
                                ELSE 70
                            END) as relevance_score
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        WHERE 
                            -- Full-text search
                            p."searchVector" @@ plainto_tsquery('english', $1) OR
                            -- Partial matching
                            p.title ILIKE ('%' || $1 || '%') OR
                            p."normalizedName" ILIKE ('%' || $1 || '%') OR
                            b.name ILIKE ('%' || $1 || '%') OR
                            -- Token matching
                            $1 = ANY(p."searchTokens") OR
                            EXISTS (
                                SELECT 1 FROM unnest(p."searchTokens") AS token 
                                WHERE token ILIKE ($1 || '%')
                            )
                        ORDER BY relevance_score DESC, p.id
                        LIMIT 1500
                        """,
                            query,
                    )

            return [row["id"] for row in rows]

    async def _fetch_groups_by_product_ids(
        self,
        product_ids: List[str],
        filters: Optional[Dict],
        limit: int,
        offset: int,
    ) -> Dict[str, Any]:
        """Fetch product groups for given product IDs with enhanced price comparison"""

        async with self.pool.acquire() as conn:
            # Get group IDs while preserving order of input product_ids
            # Create a mapping of product_id to position to preserve search result order
            product_positions = {pid: idx for idx, pid in enumerate(product_ids)}
            
            group_ids_with_positions = await conn.fetch(
                """
                SELECT DISTINCT pg.id, MIN(p.id) as first_product_id
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                WHERE p.id = ANY($1::text[])
                GROUP BY pg.id
                """,
                product_ids
            )
            
            # Sort by the position of the first matching product to preserve search order
            group_data = []
            for row in group_ids_with_positions:
                first_product_pos = product_positions.get(row["first_product_id"], len(product_ids))
                group_data.append((row["id"], first_product_pos))
            
            group_data.sort(key=lambda x: x[1])  # Sort by position
            group_ids_list = [gid for gid, _ in group_data]
            
            if not group_ids_list:
                return {"groups": [], "total": 0, "offset": offset, "limit": limit}
            
            # Then get the grouped results preserving the search order
            # Create a position mapping for ordering
            group_positions = {gid: idx for idx, gid in enumerate(group_ids_list)}
            
            rows = await conn.fetch(
                """
                WITH group_positions AS (
                    SELECT unnest($7::text[]) as group_id, generate_series(1, array_length($7::text[], 1)) as position
                )
                SELECT 
                    g.id,
                    g."normalizedName",
                    g."dosageValue",
                    g."dosageUnit",
                    json_agg(
                        json_build_object(
                            'id', p.id,
                            'title', p.title,
                            'price', p.price,
                            'vendor_id', p."vendorId",
                            'vendor_name', v.name,
                            'link', p.link,
                            'thumbnail', p.thumbnail,
                            'brand_name', b.name
                        ) ORDER BY p.price
                    ) as products,
                    MIN(p.price) as min_price,
                    MAX(p.price) as max_price,
                    COUNT(DISTINCT p."vendorId") as vendor_count,
                    COUNT(*) as product_count,
                    gp.position as search_order
                FROM "ProductGroup" g
                JOIN "Product" p ON p."productGroupId" = g.id
                JOIN "Vendor" v ON v.id = p."vendorId"
                LEFT JOIN "Brand" b ON b.id = p."brandId"
                LEFT JOIN group_positions gp ON gp.group_id = g.id
                WHERE g.id = ANY($7::text[])
                  AND ($1::numeric IS NULL OR p.price >= $1)
                  AND ($2::numeric IS NULL OR p.price <= $2)
                  AND ($3::text[] IS NULL OR p."vendorId" = ANY($3))
                  AND ($4::text[] IS NULL OR p."brandId" = ANY($4))
                GROUP BY g.id, g."normalizedName", g."dosageValue", g."dosageUnit", gp.position
                ORDER BY gp.position NULLS LAST
                LIMIT $5 OFFSET $6
                """,
                filters.get("min_price") if filters else None,
                filters.get("max_price") if filters else None,
                filters.get("vendor_ids") if filters else None,
                filters.get("brand_ids") if filters else None,
                limit,
                offset,
                group_ids_list,  # Pass as parameter $7
            )

            # Use the already fetched group count for better performance
            total = len(group_ids_list)

            groups = []
            for i, row in enumerate(rows):
                if i < 5:  # Log first 5 groups
                    logger.info(f"Final group {i+1}: {row['normalizedName']}")
                groups.append(
                    {
                        "id": row["id"],
                        "normalized_name": row["normalizedName"],
                        "dosage_value": (
                            float(row["dosageValue"]) if row["dosageValue"] else None
                        ),
                        "dosage_unit": row["dosageUnit"],
                        "products": json.loads(row["products"]),
                        "price_range": {
                            "min": float(row["min_price"]),
                            "max": float(row["max_price"]),
                        },
                        "vendor_count": row["vendor_count"],
                        "product_count": row["product_count"],
                    }
                )

            return {"groups": groups, "total": total, "offset": offset, "limit": limit}

    async def _db_search_groups_exact(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Database search for exact word matches only"""

        query_lower = query.lower()

        async with self.pool.acquire() as conn:
            # Use word boundary regex for exact word matching
            where_parts = [
                f"""(
                    p.title ~* ('\\m' || $1 || '\\M') OR
                    p."normalizedName" ~* ('\\m' || $1 || '\\M') OR
                    b.name ~* ('\\m' || $1 || '\\M') OR
                    pg."normalizedName" ~* ('\\m' || $1 || '\\M')
                )"""
            ]

            params = [query_lower]
            param_count = 2

            # Add filters
            if filters:
                if filters.get("min_price") is not None:
                    where_parts.append(f"p.price >= ${param_count}")
                    params.append(filters["min_price"])
                    param_count += 1

                if filters.get("max_price") is not None:
                    where_parts.append(f"p.price <= ${param_count}")
                    params.append(filters["max_price"])
                    param_count += 1

                if filters.get("vendor_ids"):
                    where_parts.append(f'p."vendorId" = ANY(${param_count}::text[])')
                    params.append(filters["vendor_ids"])
                    param_count += 1

                if filters.get("brand_ids"):
                    where_parts.append(f'p."brandId" = ANY(${param_count}::text[])')
                    params.append(filters["brand_ids"])
                    param_count += 1

            where_clause = " AND ".join(where_parts)

            # First, get the total count
            count_query = f"""
                SELECT COUNT(DISTINCT pg.id)
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE {where_clause}
            """

            total = await conn.fetchval(count_query, *params)

            # Then get the grouped results with enhanced price comparison
            query_sql = f"""
                WITH matching_groups AS (
                    SELECT DISTINCT pg.id
                    FROM "ProductGroup" pg
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE {where_clause}
                ),
                group_data AS (
                    SELECT 
                        pg.id,
                        pg."normalizedName",
                        pg."dosageValue",
                        pg."dosageUnit",
                        json_agg(
                            json_build_object(
                                'id', p.id,
                                'title', p.title,
                                'price', p.price,
                                'vendor_id', p."vendorId",
                                'vendor_name', v.name,
                                'link', p.link,
                                'thumbnail', p.thumbnail,
                                'brand_name', b.name
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        COUNT(DISTINCT p."vendorId") as vendor_count,
                        COUNT(*) as product_count
                    FROM "ProductGroup" pg
                    JOIN matching_groups mg ON mg.id = pg.id
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    LEFT JOIN "Brand" b ON b.id = p."brandId"
                    GROUP BY pg.id, pg."normalizedName", pg."dosageValue", pg."dosageUnit"
                )
                SELECT * FROM group_data
                ORDER BY vendor_count DESC, product_count DESC, min_price
                LIMIT ${param_count} OFFSET ${param_count + 1}
            """

            params.extend([limit, offset])

            rows = await conn.fetch(query_sql, *params)

            groups = []
            for row in rows:
                groups.append(
                    {
                        "id": row["id"],
                        "normalized_name": row["normalizedName"],
                        "dosage_value": (
                            float(row["dosageValue"]) if row["dosageValue"] else None
                        ),
                        "dosage_unit": row["dosageUnit"],
                        "products": json.loads(row["products"]),
                        "price_range": {
                            "min": float(row["min_price"]),
                            "max": float(row["max_price"]),
                        },
                        "vendor_count": row["vendor_count"],
                        "product_count": row["product_count"],
                    }
                )

            return {
                "groups": groups,
                "total": total,
                "offset": offset,
                "limit": limit,
                "search_type_used": "exact",
            }

    async def _search_products(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Search individual products (non-grouped)"""

        query_lower = query.lower()

        async with self.pool.acquire() as conn:
            # Use word boundary matching for better accuracy
            search_clause = """(
                p.title ~* ('\\m' || $1 || '\\M') OR 
                p."normalizedName" ~* ('\\m' || $1 || '\\M') OR
                b.name ~* ('\\m' || $1 || '\\M') OR
                $1 = ANY(p."searchTokens")
            )"""

            params = [query_lower]

            where_parts = [search_clause]
            param_count = 2

            # Add filters
            if filters:
                if filters.get("min_price") is not None:
                    where_parts.append(f"p.price >= ${param_count}")
                    params.append(filters["min_price"])
                    param_count += 1

                if filters.get("max_price") is not None:
                    where_parts.append(f"p.price <= ${param_count}")
                    params.append(filters["max_price"])
                    param_count += 1

            where_clause = " AND ".join(where_parts)

            query_sql = f"""
                SELECT 
                    p.*,
                    v.name as vendor_name,
                    b.name as brand_name
                FROM "Product" p
                JOIN "Vendor" v ON v.id = p."vendorId"
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE {where_clause}
                ORDER BY p.price
                LIMIT ${param_count} OFFSET ${param_count + 1}
            """

            params.extend([limit, offset])

            rows = await conn.fetch(query_sql, *params)

            products = []
            for row in rows:
                products.append(
                    {
                        "id": row["id"],
                        "title": row["title"],
                        "price": float(row["price"]),
                        "vendor_name": row["vendor_name"],
                        "brand_name": row["brand_name"],
                        "link": row["link"],
                        "thumbnail": row["thumbnail"],
                    }
                )

            # Get total count
            count_query = f"""
                SELECT COUNT(*)
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE {where_clause}
            """

            total = await conn.fetchval(
                count_query, *params[:-2]
            )  # Exclude limit/offset

            return {
                "products": products,
                "total": total,
                "offset": offset,
                "limit": limit,
            }

    async def _load_index(self):
        """Load similarity index"""
        logger.info("Loading similarity index")

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, "normalizedName" 
                FROM "Product" 
                WHERE "normalizedName" IS NOT NULL
            """
            )

            products = [
                {"id": row["id"], "normalized_name": row["normalizedName"]}
                for row in rows
            ]

            # Use cached index if available and valid
            self.matcher.build_index(products, use_cache=True)

        logger.info(f"Loaded index with {len(products)} products")

    async def rebuild_index(self):
        """Force rebuild of similarity index (ignores cache)"""
        logger.info("Force rebuilding similarity index")

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, "normalizedName" 
                FROM "Product" 
                WHERE "normalizedName" IS NOT NULL
            """
            )

            products = [
                {"id": row["id"], "normalized_name": row["normalizedName"]}
                for row in rows
            ]

            # Force rebuild without using cache
            self.matcher.build_index(products, use_cache=False)
            # Save the newly built index
            self.matcher.save_index()

        logger.info(f"Rebuilt index with {len(products)} products")

    async def _fallback_short_query_search(self, query: str, filters: Optional[Dict], limit: int, offset: int) -> Dict[str, Any]:
        """Fallback search for very short queries using trigrams and looser threshold"""

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT p.id,
                    p.title,
                    p."normalizedName"
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE
                    -- Any occurence anywhere in the text
                    p.title ILIKE ('%' || $1 || '%') OR
                    p."normalizedName" ILIKE ('%' || $1 || '%') OR
                    b.name ILIKE ('%' || $1 || '%') OR
                    -- Search in individual words of search tokens
                    EXISTS (
                        SELECT 1 FROM unnest(p."searchTokens") AS token
                        WHERE token ILIKE ('%' || $1 || '%')
                    ) OR
                    -- Character-level similarity for very short queries
                    similarity(p."normalizedName", $1) > 0.2 OR
                    similarity(p.title, $1) > 0.2
                ORDER BY
                    -- Prioritize by position of match
                    CASE
                        WHEN p.title ILIKE ($1 || '%') THEN 1
                        WHEN p."normalizedName" ILIKE ($1 || '%') THEN 2
                        WHEN position($1 in lower(p.title)) <= 5 THEN 3
                        ELSE 4
                    END,
                    p.id
                LIMIT 1000
                """,
                query,
            )

            product_ids = [row["id"] for row in rows]

            if not product_ids:
                return {"groups": [], "total": 0, "offset": offset, "limit": limit}

            # Get grouped results
            return await self._fetch_groups_by_product_ids(
                product_ids,
                filters,
                limit,
                offset,
            )

