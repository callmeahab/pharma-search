import asyncpg
from typing import List, Dict, Optional, Any
import json
import logging
import os

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

    async def connect(self):
        """Initialize connection and load index"""
        self.pool = await asyncpg.create_pool(self.db_url)
        await self._process_products_if_needed()
        await self._load_index()

    async def disconnect(self):
        """Close connections"""
        if self.pool:
            await self.pool.close()

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
                await processor.process_products(batch_size=5000)
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
        """Search for products

        Args:
            query: Search query
            filters: Optional filters (price, vendor, brand)
            group_results: Whether to group results by product
            limit: Maximum results to return
            offset: Offset for pagination
            force_db_search: Force database search instead of similarity search
        """

        if group_results:
            if force_db_search:
                return await self._db_search_groups_exact(query, filters, limit, offset)
            return await self._search_groups_hybrid(query, filters, limit, offset)
        else:
            return await self._search_products(query, filters, limit, offset)

    async def _search_groups_hybrid(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Hybrid search that combines similarity and exact matching"""

        query_lower = query.lower().strip()
        query_len = len(query_lower)

        if query_len < 2:
            similiarity_threshold = 0.3
            similiarity_k = 1000
        elif query_len < 4:
            similiarity_threshold = 0.5
            similiarity_k = 800
        else:
            similiarity_threshold = 0.7
            similiarity_k = 500

        # First, try similarity search with appropriate threshold
        similar_products = self.matcher.find_similar_products(
            query,
            k=similiarity_k,
            threshold=similiarity_threshold,
        )

        # Also get exact/partial matches from database
        exact_matches = await self._get_exact_matches(query_lower)

        # Combine results, prioritizing exact matches
        all_product_ids = []
        seen_ids = set()

        # Add exact matches first (they're already sorted by relevance)
        for product_id in exact_matches:
            if product_id not in seen_ids:
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        # Add similarity matches, but limit them based on query length
        similarity_limit = min(len(similar_products), 500 if query_len <= 3 else 200)
        for i, (product_id, _, _) in enumerate(similar_products):
            if i >= similarity_limit:
                break
            if product_id not in seen_ids:
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        if not all_product_ids:
            # Fallback: try even more relaxed search for very short queries
            if query_len <= 3:
                return await self._fallback_short_query_search(query_lower, filters, limit, offset)
            return {"groups": [], "total": 0, "offset": offset, "limit": limit}

        # Get grouped results
        return await self._fetch_groups_by_product_ids(
            all_product_ids, filters, limit, offset, preserve_order=True
        )

    async def _get_exact_matches(self, query: str) -> List[str]:
        """Get product IDs that match the query exactly or as a whole word"""
        async with self.pool.acquire() as conn:
            query_len = len(query.strip())

            if query_len <= 3:
                rows = await conn.fetch(
                    """
                    SELECT DISTINCT p.id
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE
                        -- Prefix matches (starts with)
                        p.title ILIKE ($1 || '%') OR
                        p."normalizedName" ILIKE ($1 || '%') OR
                        b.name ILIKE ($1 || '%') OR
                        -- Substring matching for very short queries
                        p.title ILIKE ('%' || $1 || '%') OR
                        p."normalizedName" ILIKE ('%' || $1 || '%') OR
                        -- Token array search
                        $1 = ANY(p."searchTokens") OR
                        -- Partial token matching
                        EXISTS (
                            SELECT 1 FROM unnest(p."searchTokens") AS token
                            WHERE token ILIKE ($1 || '%')
                        )
                    ORDER BY
                        -- Prioritize exact prefix matches
                        CASE WHEN p.title ILIKE ($1 || '%') THEN 1
                             WHEN p."normalizedName" ILIKE ($1 || '%') THEN 2
                             WHEN b.name ILIKE ($1 || '%') THEN 3
                             ELSE 4 END,
                        p.id
                    LIMIT 1000
                    """,
                    query,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT DISTINCT p.id, 
                        -- Calculate relevance score
                        (CASE 
                            -- Exact word boundary match (highest priority)
                            WHEN p.title ~* ('\\m' || $1 || '\\M') OR
                                p."normalizedName" ~* ('\\m' || $1 || '\\M') OR
                                b.name ~* ('\\m' || $1 || '\\M') THEN 100
                            -- Prefix match (high priority)
                            WHEN p.title ILIKE ($1 || '%') OR
                                p."normalizedName" ILIKE ($1 || '%') OR
                                b.name ILIKE ($1 || '%') THEN 90
                            -- Substring match (medium priority)
                            WHEN p.title ILIKE ('%' || $1 || '%') OR
                                p."normalizedName" ILIKE ('%' || $1 || '%') THEN 80
                            -- Token exact match
                            WHEN $1 = ANY(p."searchTokens") THEN 95
                            -- Token prefix match
                            WHEN EXISTS (
                                SELECT 1 FROM unnest(p."searchTokens") AS token 
                                WHERE token ILIKE ($1 || '%')
                            ) THEN 85
                            ELSE 70
                        END) as relevance_score
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE 
                        -- Word boundary matching
                        p.title ~* ('\\m' || $1 || '\\M') OR
                        p."normalizedName" ~* ('\\m' || $1 || '\\M') OR
                        b.name ~* ('\\m' || $1 || '\\M') OR
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
        preserve_order: bool = False,
    ) -> Dict[str, Any]:
        """Fetch product groups for given product IDs with enhanced price comparison"""

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH relevant_groups AS (
                    SELECT DISTINCT pg.*
                    FROM "ProductGroup" pg
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    WHERE p.id = ANY($1::text[])
                ),
                group_products AS (
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
                                'brand_name', b.name,
                                'price_analysis', json_build_object(
                                    'diff_from_avg', p.price - AVG(p.price) OVER (PARTITION BY g.id),
                                    'percentile', CASE 
                                        WHEN MAX(p.price) OVER (PARTITION BY g.id) - MIN(p.price) OVER (PARTITION BY g.id) > 0
                                        THEN (p.price - MIN(p.price) OVER (PARTITION BY g.id)) / 
                                             (MAX(p.price) OVER (PARTITION BY g.id) - MIN(p.price) OVER (PARTITION BY g.id)) * 100
                                        ELSE 0
                                    END,
                                    'is_best_deal', p.price = MIN(p.price) OVER (PARTITION BY g.id),
                                    'is_worst_deal', p.price = MAX(p.price) OVER (PARTITION BY g.id)
                                )
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        AVG(p.price) as avg_price,
                        STDDEV(p.price) as price_stddev,
                        COUNT(DISTINCT p."vendorId") as vendor_count,
                        COUNT(*) as product_count,
                        -- Calculate price comparison metrics
                        MAX(p.price) - MIN(p.price) as price_range_span,
                        COUNT(*) FILTER (WHERE p.price <= AVG(p.price)) as below_avg_count,
                        COUNT(*) FILTER (WHERE p.price > AVG(p.price)) as above_avg_count,
                        -- For preserving order, find the minimum position of products in input array
                        MIN(array_position($1::text[], p.id)) as input_order
                    FROM relevant_groups g
                    JOIN "Product" p ON p."productGroupId" = g.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    LEFT JOIN "Brand" b ON b.id = p."brandId"
                    WHERE ($2::numeric IS NULL OR p.price >= $2)
                      AND ($3::numeric IS NULL OR p.price <= $3)
                      AND ($4::text[] IS NULL OR p."vendorId" = ANY($4))
                      AND ($5::text[] IS NULL OR p."brandId" = ANY($5))
                    GROUP BY g.id, g."normalizedName", g."dosageValue", g."dosageUnit"
                )
                SELECT id, "normalizedName", "dosageValue", "dosageUnit", 
                       products, min_price, max_price, avg_price, price_stddev,
                       vendor_count, product_count, price_range_span, below_avg_count, above_avg_count
                FROM group_products
                ORDER BY 
                    CASE WHEN $8 THEN input_order ELSE NULL END NULLS LAST,
                    vendor_count DESC,  -- Prioritize groups with more vendors for better price comparison
                    price_range_span DESC,  -- Then by price range for better savings potential
                    product_count DESC, 
                    min_price
                LIMIT $6 OFFSET $7
            """,
                product_ids,
                filters.get("min_price") if filters else None,
                filters.get("max_price") if filters else None,
                filters.get("vendor_ids") if filters else None,
                filters.get("brand_ids") if filters else None,
                limit,
                offset,
                preserve_order,  # Pass as parameter $8
            )

            count_row = await conn.fetchrow(
                'SELECT COUNT(DISTINCT pg.id) FROM "ProductGroup" pg '
                'JOIN "Product" p ON p."productGroupId" = pg.id '
                "WHERE p.id = ANY($1::text[])",
                product_ids,
            )

            total = count_row["count"] if count_row else 0

            groups = []
            for row in rows:
                price_stddev = float(row["price_stddev"]) if row["price_stddev"] else 0
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
                            "avg": float(row["avg_price"]),
                            "range": float(row["price_range_span"]),
                            "stddev": price_stddev,
                        },
                        "vendor_count": row["vendor_count"],
                        "product_count": row["product_count"],
                        "price_analysis": {
                            "savings_potential": float(row["price_range_span"]) if row["price_range_span"] else 0,
                            "price_variation": (price_stddev / float(row["avg_price"]) * 100) if row["avg_price"] and price_stddev else 0,
                            "below_avg_count": row["below_avg_count"],
                            "above_avg_count": row["above_avg_count"],
                            "has_multiple_vendors": row["vendor_count"] > 1,
                        },
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
                                'brand_name', b.name,
                                'price_analysis', json_build_object(
                                    'diff_from_avg', p.price - AVG(p.price) OVER (PARTITION BY pg.id),
                                    'percentile', CASE 
                                        WHEN MAX(p.price) OVER (PARTITION BY pg.id) - MIN(p.price) OVER (PARTITION BY pg.id) > 0
                                        THEN (p.price - MIN(p.price) OVER (PARTITION BY pg.id)) / 
                                             (MAX(p.price) OVER (PARTITION BY pg.id) - MIN(p.price) OVER (PARTITION BY pg.id)) * 100
                                        ELSE 0
                                    END,
                                    'is_best_deal', p.price = MIN(p.price) OVER (PARTITION BY pg.id),
                                    'is_worst_deal', p.price = MAX(p.price) OVER (PARTITION BY pg.id)
                                )
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        AVG(p.price) as avg_price,
                        STDDEV(p.price) as price_stddev,
                        COUNT(DISTINCT p."vendorId") as vendor_count,
                        COUNT(*) as product_count,
                        -- Calculate price comparison metrics
                        MAX(p.price) - MIN(p.price) as price_range_span,
                        COUNT(*) FILTER (WHERE p.price <= AVG(p.price)) as below_avg_count,
                        COUNT(*) FILTER (WHERE p.price > AVG(p.price)) as above_avg_count
                    FROM "ProductGroup" pg
                    JOIN matching_groups mg ON mg.id = pg.id
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    LEFT JOIN "Brand" b ON b.id = p."brandId"
                    GROUP BY pg.id, pg."normalizedName", pg."dosageValue", pg."dosageUnit"
                )
                SELECT * FROM group_data
                ORDER BY vendor_count DESC, price_range_span DESC, product_count DESC, min_price
                LIMIT ${param_count} OFFSET ${param_count + 1}
            """

            params.extend([limit, offset])

            rows = await conn.fetch(query_sql, *params)

            groups = []
            for row in rows:
                price_stddev = float(row["price_stddev"]) if row["price_stddev"] else 0
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
                            "avg": float(row["avg_price"]),
                            "range": float(row["price_range_span"]),
                            "stddev": price_stddev,
                        },
                        "vendor_count": row["vendor_count"],
                        "product_count": row["product_count"],
                        "price_analysis": {
                            "savings_potential": float(row["price_range_span"]) if row["price_range_span"] else 0,
                            "price_variation": (price_stddev / float(row["avg_price"]) * 100) if row["avg_price"] and price_stddev else 0,
                            "below_avg_count": row["below_avg_count"],
                            "above_avg_count": row["above_avg_count"],
                            "has_multiple_vendors": row["vendor_count"] > 1,
                        },
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
                SELECT DISTINCT p.id
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
                    -- Character-level similiarity for very short queries
                    similiarity(p."normalizedName", $1) > 0.2 OR
                    similiarity(p.title, $1) > 0.2 OR
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
                preserve_order=True,
            )

