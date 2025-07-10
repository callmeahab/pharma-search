import asyncpg
from typing import List, Dict, Optional, Any
import json
import logging
import os
import hashlib
import asyncio
from functools import lru_cache
from rapidfuzz import fuzz
from collections import defaultdict

# Removed FAISS similarity matcher - using database search only
from .product_processor import EnhancedProductProcessor

logger = logging.getLogger(__name__)


class PharmaSearchEngine:
    """Search engine for pharmaceutical products"""

    def __init__(self, db_url: str, cache_dir: str = "backend/cache"):
        self.db_url = db_url
        self.cache_dir = cache_dir
        # Ensure cache directory exists
        os.makedirs(cache_dir, exist_ok=True)
        # Removed FAISS similarity matcher
        self.pool: asyncpg.pool.Pool
        self._search_cache = {}

    async def connect(self):
        """Initialize connection"""
        self.pool = await asyncpg.create_pool(self.db_url)
        await self._process_products_if_needed()
        # Removed FAISS index loading

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
        
        # Execute search using database only
        if group_results:
            result = await self._db_search_groups_enhanced(query, filters, limit, offset)
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

    async def _db_search_groups_enhanced(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Enhanced database search with dynamic grouping"""

        query_lower = query.lower().strip()
        query_len = len(query_lower)
        query_words = query_lower.split()
        is_specific_product_query = len(query_words) >= 3 and any(len(word) > 2 for word in query_words)

        # Get exact matches using enhanced scoring - but return products, not groups
        exact_matches = await self._get_exact_matches(query_lower)
        
        logger.info(f"Database search found {len(exact_matches)} matches for query: '{query}'")

        if not exact_matches:
            # Fallback: try more relaxed search for very short queries
            if query_len <= 3:
                return await self._fallback_short_query_search(query_lower, filters, limit, offset)
            return {"groups": [], "total": 0, "offset": offset, "limit": limit}

        # NEW: Dynamic grouping on search results
        return await self._create_dynamic_groups(
            exact_matches, query_lower, filters, limit, offset
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
                    """,
                    query,
                )
            else:
                # For longer, specific queries, prioritize phrase matching over token matching
                if is_specific_product_query:
                    rows = await conn.fetch(
                        """
                        SELECT DISTINCT p.id, 
                            -- Enhanced relevance score with fuzzy matching and length normalization
                            (CASE 
                                -- Exact title match (highest priority)
                                WHEN p.title ILIKE $1 OR p."normalizedName" ILIKE $1 THEN 4000
                                -- Very close phrase matches (boosted priority, but penalize if target is too short)
                                WHEN p.title ILIKE ('%' || $1 || '%') OR p."normalizedName" ILIKE ('%' || $1 || '%') THEN 
                                    CASE 
                                        WHEN length(COALESCE(p."normalizedName", p.title)) < length($1) * 0.7 THEN 800  -- Penalize if target much shorter than query
                                        WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 1200  -- Moderate penalty for very short names
                                        ELSE 3000 
                                    END
                                -- High similarity using trigrams (very high priority)
                                WHEN similarity(p.title, $1) > 0.8 OR similarity(p."normalizedName", $1) > 0.8 THEN 
                                    2500 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 500)::int
                                -- Medium similarity using trigrams
                                WHEN similarity(p.title, $1) > 0.6 OR similarity(p."normalizedName", $1) > 0.6 THEN 
                                    2000 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 300)::int
                                -- Brand exact match
                                WHEN b.name ILIKE $1 THEN 2200
                                -- Brand phrase match (with length check)
                                WHEN b.name ILIKE ('%' || $1 || '%') THEN 
                                    CASE WHEN length(b.name) < 8 THEN 900 ELSE 1800 END
                                -- Brand similarity
                                WHEN similarity(b.name, $1) > 0.7 THEN 1600 + (similarity(b.name, $1) * 200)::int
                                -- Prefix match (medium-high priority, with length normalization)
                                WHEN p.title ILIKE ($1 || '%') OR p."normalizedName" ILIKE ($1 || '%') OR b.name ILIKE ($1 || '%') THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 15 THEN 700 ELSE 1400 END
                                -- Full-text search match (medium priority)
                                WHEN p."searchVector" @@ plainto_tsquery('english', $1) THEN 
                                    (ts_rank(p."searchVector", plainto_tsquery('english', $1)) * 100 + 800)::int
                                -- Medium similarity for fuzzy matching
                                WHEN similarity(p.title, $1) > 0.4 OR similarity(p."normalizedName", $1) > 0.4 THEN 
                                    800 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 400)::int
                                -- Token exact match (lower priority for specific queries, heavily penalize short names)
                                WHEN $1 = ANY(p."searchTokens") THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 200 ELSE 600 END
                                -- Token prefix match (lowest priority)
                                WHEN EXISTS (
                                    SELECT 1 FROM unnest(p."searchTokens") AS token 
                                    WHERE token ILIKE ($1 || '%')
                                ) THEN 
                                    CASE WHEN length(COALESCE(p."normalizedName", p.title)) < 10 THEN 100 ELSE 400 END
                                ELSE 50
                            END) as relevance_score
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        WHERE 
                            -- Much broader search - any occurrence anywhere
                            p.title ILIKE ('%' || $1 || '%') OR
                            p."normalizedName" ILIKE ('%' || $1 || '%') OR
                            b.name ILIKE ('%' || $1 || '%') OR
                            -- Exact matches
                            p.title ILIKE $1 OR
                            p."normalizedName" ILIKE $1 OR
                            b.name ILIKE $1 OR
                            -- Prefix matches
                            p.title ILIKE ($1 || '%') OR
                            p."normalizedName" ILIKE ($1 || '%') OR
                            b.name ILIKE ($1 || '%') OR
                            -- Trigram similarity (lower threshold)
                            similarity(p.title, $1) > 0.3 OR
                            similarity(p."normalizedName", $1) > 0.3 OR
                            similarity(b.name, $1) > 0.3 OR
                            -- Full-text search
                            p."searchVector" @@ plainto_tsquery('english', $1) OR
                            -- Token matching (no length restrictions)
                            $1 = ANY(p."searchTokens") OR
                            EXISTS (
                                SELECT 1 FROM unnest(p."searchTokens") AS token 
                                WHERE token ILIKE ($1 || '%')
                            )
                        ORDER BY relevance_score DESC, p.id
                        """,
                        query,
                    )
                else:
                    # Enhanced logic for non-specific queries
                    rows = await conn.fetch(
                        """
                        SELECT DISTINCT p.id, 
                            -- Enhanced relevance score with fuzzy matching
                            (CASE 
                                -- Exact title match (highest priority)
                                WHEN p.title ILIKE $1 OR p."normalizedName" ILIKE $1 THEN 2000
                                -- Near exact match using similarity (very high priority)
                                WHEN similarity(p.title, $1) > 0.8 OR similarity(p."normalizedName", $1) > 0.8 THEN 
                                    1500 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 300)::int
                                -- Brand exact match
                                WHEN b.name ILIKE $1 THEN 1400
                                -- Full-text search match (high priority)
                                WHEN p."searchVector" @@ plainto_tsquery('english', $1) THEN 
                                    (ts_rank(p."searchVector", plainto_tsquery('english', $1)) * 150 + 800)::int
                                -- Medium similarity fuzzy matching
                                WHEN similarity(p.title, $1) > 0.5 OR similarity(p."normalizedName", $1) > 0.5 THEN 
                                    1000 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 200)::int
                                -- Brand similarity
                                WHEN similarity(b.name, $1) > 0.6 THEN 900 + (similarity(b.name, $1) * 100)::int
                                -- Prefix match (medium-high priority)
                                WHEN p.title ILIKE ($1 || '%') OR
                                    p."normalizedName" ILIKE ($1 || '%') OR
                                    b.name ILIKE ($1 || '%') THEN 700
                                -- Token exact match
                                WHEN $1 = ANY(p."searchTokens") THEN 600
                                -- Substring match (medium priority)
                                WHEN p.title ILIKE ('%' || $1 || '%') OR
                                    p."normalizedName" ILIKE ('%' || $1 || '%') THEN 500
                                -- Lower similarity fuzzy matching
                                WHEN similarity(p.title, $1) > 0.3 OR similarity(p."normalizedName", $1) > 0.3 THEN 
                                    400 + (GREATEST(similarity(p.title, $1), similarity(p."normalizedName", $1)) * 100)::int
                                -- Token prefix match
                                WHEN EXISTS (
                                    SELECT 1 FROM unnest(p."searchTokens") AS token 
                                    WHERE token ILIKE ($1 || '%')
                                ) THEN 300
                                ELSE 100
                            END) as relevance_score
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        WHERE 
                            -- Broadest possible search - any occurrence anywhere
                            p.title ILIKE ('%' || $1 || '%') OR
                            p."normalizedName" ILIKE ('%' || $1 || '%') OR
                            b.name ILIKE ('%' || $1 || '%') OR
                            -- Exact matches
                            p.title ILIKE $1 OR
                            p."normalizedName" ILIKE $1 OR
                            b.name ILIKE $1 OR
                            -- Prefix matching
                            p.title ILIKE ($1 || '%') OR
                            p."normalizedName" ILIKE ($1 || '%') OR
                            b.name ILIKE ($1 || '%') OR
                            -- Trigram similarity (very low threshold)
                            similarity(p.title, $1) > 0.2 OR
                            similarity(p."normalizedName", $1) > 0.2 OR
                            similarity(b.name, $1) > 0.2 OR
                            -- Full-text search
                            p."searchVector" @@ plainto_tsquery('english', $1) OR
                            -- Token matching (no restrictions)
                            $1 = ANY(p."searchTokens") OR
                            EXISTS (
                                SELECT 1 FROM unnest(p."searchTokens") AS token 
                                WHERE token ILIKE ($1 || '%')
                            )
                        ORDER BY relevance_score DESC, p.id
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

            # Then get the grouped results with all products from all vendors
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
                    WHERE {where_clause.replace('pg.', 'p.')}
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

    async def _create_dynamic_groups(
        self, product_ids: List[str], query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Create dynamic groups from search results based on query context"""
        
        async with self.pool.acquire() as conn:
            # Get product details for grouping
            products = await conn.fetch(
                """
                SELECT 
                    p.id,
                    p.title,
                    p."normalizedName",
                    p.price,
                    p."vendorId",
                    v.name as vendor_name,
                    p.link,
                    p.thumbnail,
                    b.name as brand_name
                FROM "Product" p
                JOIN "Vendor" v ON v.id = p."vendorId"
                LEFT JOIN "Brand" b ON b.id = p."brandId"
                WHERE p.id = ANY($1::text[])
                  AND ($2::numeric IS NULL OR p.price >= $2)
                  AND ($3::numeric IS NULL OR p.price <= $3)
                  AND ($4::text[] IS NULL OR p."vendorId" = ANY($4))
                  AND ($5::text[] IS NULL OR p."brandId" = ANY($5))
                ORDER BY p.price
                """,
                product_ids,
                filters.get("min_price") if filters else None,
                filters.get("max_price") if filters else None,
                filters.get("vendor_ids") if filters else None,
                filters.get("brand_ids") if filters else None,
            )

            if not products:
                return {"groups": [], "total": 0, "offset": offset, "limit": limit}

            # Dynamic grouping logic
            groups = self._group_products_dynamically(products, query)
            
            # Apply pagination to groups
            total_groups = len(groups)
            paginated_groups = groups[offset:offset + limit]
            
            logger.info(f"Dynamic grouping created {total_groups} groups from {len(products)} products")
            
            return {
                "groups": paginated_groups,
                "total": total_groups,
                "offset": offset,
                "limit": limit,
                "search_type_used": "dynamic"
            }

    def _group_products_dynamically(self, products: List[Dict], query: str) -> List[Dict]:
        """Group products dynamically based on similarity and query context with enhanced criteria"""
        
        query_words = set(query.lower().split())
        has_dosage_in_query = any(word for word in query_words if any(char.isdigit() for char in word))
        
        # Extract enhanced identity for each product
        product_identities = {}
        for product in products:
            name = product.get("normalizedName") or product.get("title") or ""
            identity = self._extract_enhanced_product_identity(name, query, has_dosage_in_query)
            product_identities[product["id"]] = identity
        
        # Group products by enhanced similarity
        groups_dict = defaultdict(list)
        processed = set()
        
        for product in products:
            if product["id"] in processed:
                continue
                
            product_identity = product_identities[product["id"]]
            group_key = product_identity["core"]
            
            # Find similar products to group with
            group_products = [product]
            processed.add(product["id"])
            
            for other_product in products:
                if other_product["id"] in processed:
                    continue
                    
                other_identity = product_identities[other_product["id"]]
                
                # Check if they should be grouped using enhanced criteria
                if self._should_group_enhanced(product_identity, other_identity, query):
                    group_products.append(other_product)
                    processed.add(other_product["id"])
            
            groups_dict[group_key] = group_products
        
        # Convert to output format
        result_groups = []
        for group_name, group_products in groups_dict.items():
            if not group_products:
                continue
                
            # Keep all products from all vendors
            final_products = group_products
            final_products.sort(key=lambda x: x["price"])
            
            if final_products:
                min_price = min(p["price"] for p in final_products)
                max_price = max(p["price"] for p in final_products)
                
                result_groups.append({
                    "id": f"dynamic_{hash(group_name)}",
                    "normalized_name": group_name,
                    "products": [
                        {
                            "id": p["id"],
                            "title": p["title"],
                            "price": float(p["price"]),
                            "vendor_id": p["vendorId"],
                            "vendor_name": p["vendor_name"],
                            "link": p["link"],
                            "thumbnail": p["thumbnail"],
                            "brand_name": p["brand_name"]
                        } for p in final_products
                    ],
                    "price_range": {
                        "min": float(min_price),
                        "max": float(max_price)
                    },
                    "vendor_count": len(set(p["vendorId"] for p in final_products)),
                    "product_count": len(final_products),
                    "dosage_value": None,
                    "dosage_unit": None
                })
        
        # Sort groups by relevance: vendor count first, then product count, then price
        result_groups.sort(key=lambda x: (x["vendor_count"], x["product_count"], -x["price_range"]["min"]), reverse=True)
        
        return result_groups

    def _extract_core_for_grouping(self, name: str, query: str, preserve_dosage: bool) -> str:
        """Extract core product identity for dynamic grouping with more granular criteria"""
        import re
        
        core = name.lower().strip()
        query_words = set(query.lower().split())
        
        # Preserve more distinguishing features for better grouping
        if preserve_dosage:
            # Keep numbers that appear in the query
            query_numbers = set()
            for word in query_words:
                numbers = re.findall(r'\d+', word)
                query_numbers.update(numbers)
            
            # Remove only numbers NOT in the query
            def replace_number(match):
                num = match.group()
                return num if num in query_numbers else ' '
            
            core = re.sub(r'\d+', replace_number, core)
        else:
            # For non-dosage queries, preserve size/age indicators for better grouping
            # Only remove generic numbers but keep size indicators
            core = re.sub(r'\b\d+(?!\s*(kg|g|mg|mcg|iu|ml|l|kom|komada|newborn|mini|midi|junior))\b', ' ', core)
        
        # Less aggressive noise removal to preserve more product distinctions
        noise_patterns = [
            # Remove only generic packaging indicators, keep size/age descriptors
            r'\b(kom|komada|pack|box|vp\d*|jp\d*|a\d+|mesečno|monthly)\b',
            # Remove some punctuation but keep hyphens for compound words
            r'[,\.\(\)\[\]\/\\]',
        ]
        
        for pattern in noise_patterns:
            core = re.sub(pattern, ' ', core, flags=re.IGNORECASE)
        
        # Clean up whitespace
        core = re.sub(r'\s+', ' ', core).strip()
        
        return core

    def _should_group_dynamically(self, core1: str, core2: str, query: str) -> bool:
        """Determine if two product cores should be grouped together with stricter criteria"""
        
        if not core1.strip() or not core2.strip():
            return False
            
        # Exact match
        if core1 == core2:
            return True
        
        # Calculate multiple similarity metrics
        similarity_ratio = fuzz.ratio(core1, core2)
        similarity_token_sort = fuzz.token_sort_ratio(core1, core2)
        similarity_token_set = fuzz.token_set_ratio(core1, core2)
        
        # Use the highest similarity score
        max_similarity = max(similarity_ratio, similarity_token_sort, similarity_token_set)
        
        # More conservative grouping to create more distinct groups
        query_lower = query.lower()
        query_specificity = len(query.split())
        
        # For brand name queries, be more selective to avoid overly broad groups
        brand_names = ['pampers', 'huggies', 'nivea', 'loreal', 'garnier', 'johnson', 'cetaphil', 'neutrogena']
        
        if query_lower in brand_names:
            if query_lower in core1.lower() and query_lower in core2.lower():
                # Check for specific distinguishing features
                core1_words = set(core1.split())
                core2_words = set(core2.split())
                
                # Look for size/age/type differences
                distinguishing_features = {
                    'newborn', 'mini', 'midi', 'junior', 'maxi', 'xl', 'xxl', 'xs', 's', 'm', 'l',
                    'pelene', 'gaćice', 'pants', 'care', 'protect', 'active', 'premium', 
                    'harmonie', 'sensitive', 'fresh', 'aqua', 'clean', 'dry', 'baby', 'adult',
                    'large', 'medium', 'small', 'extra', 'super', 'ultra', 'soft', 'comfort'
                }
                
                # If products have different distinguishing features, don't group them
                core1_features = core1_words & distinguishing_features
                core2_features = core2_words & distinguishing_features
                
                if core1_features != core2_features and (core1_features or core2_features):
                    # Only group if very high similarity AND overlapping features
                    return max_similarity >= 85 and len(core1_features & core2_features) > 0
                
                # For products without distinguishing features, use moderate threshold
                return max_similarity >= 80
        
        # Stricter thresholds for better granularity
        if query_specificity <= 1:
            threshold = 85  # Stricter for single word queries
        elif query_specificity <= 2:
            threshold = 90  # Very strict for 2-word queries
        else:
            threshold = 95  # Extremely strict for very specific queries
            
        return max_similarity >= threshold

    def _extract_enhanced_product_identity(self, name: str, query: str, preserve_dosage: bool) -> Dict:
        """Extract enhanced product identity with multiple criteria for better grouping"""
        import re
        
        original_name = name.lower().strip()
        
        # Extract key product attributes
        identity = {
            "core": "",
            "category": "",
            "size_age": "",
            "variant": "",
            "dosage_info": "",
            "brand": ""
        }
        
        # Extract brand information
        brand_patterns = [
            r'\b(pampers|huggies|nivea|loreal|garnier|johnson|cetaphil|neutrogena)\b'
        ]
        for pattern in brand_patterns:
            match = re.search(pattern, original_name, re.IGNORECASE)
            if match:
                identity["brand"] = match.group(1).lower()
                break
        
        # Extract category information
        category_patterns = {
            'diapers': r'\b(pelene|gaćice|pants|diaper)\b',
            'care': r'\b(care|protect|clean|sensitive|cream|lotion|oil|shampoo|gel)\b',
            'wipes': r'\b(wipes|vlažne|maramice)\b',
            'cosmetics': r'\b(makeup|foundation|mascara|lipstick|eyeshadow)\b',
            'skincare': r'\b(moisturizer|serum|toner|cleanser|mask)\b'
        }
        
        for category, pattern in category_patterns.items():
            if re.search(pattern, original_name, re.IGNORECASE):
                identity["category"] = category
                break
        
        # Extract size/age information
        size_age_patterns = [
            r'\b(newborn|mini|midi|junior|maxi|xl|xxl|xs|s|m|l|large|medium|small)\b',
            r'\b(\d+\s*(?:kg|g|mg|mcg|iu|ml|l))\b',
            r'\b(\d+\s*(?:kom|komada|pack))\b'
        ]
        
        size_age_parts = []
        for pattern in size_age_patterns:
            matches = re.findall(pattern, original_name, re.IGNORECASE)
            size_age_parts.extend(matches)
        
        identity["size_age"] = " ".join(size_age_parts).lower()
        
        # Extract product variant/type
        variant_patterns = [
            r'\b(active|premium|harmonie|fresh|aqua|dry|ultra|super|extra|soft|comfort)\b'
        ]
        
        variant_parts = []
        for pattern in variant_patterns:
            matches = re.findall(pattern, original_name, re.IGNORECASE)
            variant_parts.extend(matches)
        
        identity["variant"] = " ".join(variant_parts).lower()
        
        # Create core identity by combining key elements
        core_parts = []
        if identity["brand"]:
            core_parts.append(identity["brand"])
        if identity["category"]:
            core_parts.append(identity["category"])
        if identity["size_age"]:
            core_parts.append(identity["size_age"])
        if identity["variant"]:
            core_parts.append(identity["variant"])
        
        # If no structured extraction worked, fall back to cleaned name
        if not core_parts:
            core_parts = [self._extract_core_for_grouping(name, query, preserve_dosage)]
        
        identity["core"] = " ".join(core_parts)
        
        return identity
    
    def _should_group_enhanced(self, identity1: Dict, identity2: Dict, query: str) -> bool:
        """Enhanced grouping decision based on multiple product attributes"""
        
        # Exact core match
        if identity1["core"] == identity2["core"]:
            return True
        
        # Must have same brand if both have brands
        if identity1["brand"] and identity2["brand"] and identity1["brand"] != identity2["brand"]:
            return False
        
        # Must have same category if both have categories
        if identity1["category"] and identity2["category"] and identity1["category"] != identity2["category"]:
            return False
        
        # For size/age sensitive products, must have compatible sizes
        if identity1["size_age"] and identity2["size_age"]:
            if identity1["size_age"] != identity2["size_age"]:
                # Allow some size flexibility within same category
                size_similarity = fuzz.ratio(identity1["size_age"], identity2["size_age"])
                if size_similarity < 70:
                    return False
        
        # Check core similarity
        core_similarity = max(
            fuzz.ratio(identity1["core"], identity2["core"]),
            fuzz.token_sort_ratio(identity1["core"], identity2["core"]),
            fuzz.token_set_ratio(identity1["core"], identity2["core"])
        )
        
        # More lenient grouping for enhanced identity matching
        query_specificity = len(query.split())
        if query_specificity <= 1:
            threshold = 75  # Moderate for single word queries
        elif query_specificity <= 2:
            threshold = 80  # Balanced for 2-word queries
        else:
            threshold = 85  # Stricter for very specific queries
        
        return core_similarity >= threshold

