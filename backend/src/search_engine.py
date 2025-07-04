import asyncpg
from typing import List, Dict, Optional, Any
import json
import logging
import os

from .similarity_matcher import SimilarityMatcher
from .product_processor import ProductProcessor

logger = logging.getLogger(__name__)


class PharmaSearchEngine:
    """Search engine for pharmaceutical products"""

    def __init__(self, db_url: str, cache_dir: str = "backend/cache"):
        self.db_url = db_url
        self.cache_dir = cache_dir
        # Ensure cache directory exists
        os.makedirs(cache_dir, exist_ok=True)
        self.matcher = SimilarityMatcher(cache_dir=cache_dir)
        self.pool = None

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
            processor = ProductProcessor(self.db_url)
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

        query_lower = query.lower()

        # First, try similarity search with appropriate threshold
        similar_products = self.matcher.find_similar_products(
            query,
            k=500,  # Get more candidates
            threshold=0.75,  # Back to reasonable threshold
        )

        # Also get exact/partial matches from database
        exact_matches = await self._get_exact_matches(query_lower)

        # Combine results, prioritizing exact matches
        all_product_ids = []
        seen_ids = set()

        # Add exact matches first
        for product_id in exact_matches:
            if product_id not in seen_ids:
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        # Then add similarity matches
        for product_id, score, _ in similar_products:
            if product_id not in seen_ids:
                all_product_ids.append(product_id)
                seen_ids.add(product_id)

        if not all_product_ids:
            return {"groups": [], "total": 0, "offset": offset, "limit": limit}

        # Get grouped results
        return await self._fetch_groups_by_product_ids(
            all_product_ids, filters, limit, offset, preserve_order=True
        )

    async def _get_exact_matches(self, query: str) -> List[str]:
        """Get product IDs that match the query exactly or as a whole word"""
        async with self.pool.acquire() as conn:
            # Use word boundaries for more accurate matching
            rows = await conn.fetch(
                """
                SELECT DISTINCT p.id
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE 
                    -- Exact match at word boundary
                    p.title ~* ('\\m' || $1 || '\\M') OR
                    p."normalizedName" ~* ('\\m' || $1 || '\\M') OR
                    b.name ~* ('\\m' || $1 || '\\M') OR
                    -- Exact match in search tokens
                    $1 = ANY(p."searchTokens")
                ORDER BY p.id
                LIMIT 1000
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
        """Fetch product groups for given product IDs"""

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
                                'thumbnail', p.thumbnail
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        AVG(p.price) as avg_price,
                        COUNT(DISTINCT p."vendorId") as vendor_count,
                        COUNT(*) as product_count,
                        -- For preserving order, find the minimum position of products in input array
                        MIN(array_position($1::text[], p.id)) as input_order
                    FROM relevant_groups g
                    JOIN "Product" p ON p."productGroupId" = g.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    WHERE ($2::numeric IS NULL OR p.price >= $2)
                      AND ($3::numeric IS NULL OR p.price <= $3)
                      AND ($4::text[] IS NULL OR p."vendorId" = ANY($4))
                      AND ($5::text[] IS NULL OR p."brandId" = ANY($5))
                    GROUP BY g.id, g."normalizedName", g."dosageValue", g."dosageUnit"
                )
                SELECT id, "normalizedName", "dosageValue", "dosageUnit", 
                       products, min_price, max_price, avg_price, 
                       vendor_count, product_count
                FROM group_products
                ORDER BY 
                    CASE WHEN $8 THEN input_order ELSE NULL END NULLS LAST,
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

            # Then get the grouped results
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
                                'thumbnail', p.thumbnail
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        AVG(p.price) as avg_price,
                        COUNT(DISTINCT p."vendorId") as vendor_count,
                        COUNT(*) as product_count
                    FROM "ProductGroup" pg
                    JOIN matching_groups mg ON mg.id = pg.id
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    GROUP BY pg.id, pg."normalizedName", pg."dosageValue", pg."dosageUnit"
                )
                SELECT * FROM group_data
                ORDER BY product_count DESC, min_price
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
                            "avg": float(row["avg_price"]),
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
