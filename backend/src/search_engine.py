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
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Search for products"""

        if group_results:
            return await self._search_groups(query, filters, limit, offset)
        else:
            return await self._search_products(query, filters, limit, offset)

    async def _search_groups(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Search and return grouped results"""

        similar_products = self.matcher.find_similar_products(query, k=50)

        if not similar_products:
            return await self._db_search_groups(query, filters, limit, offset)

        product_ids = [pid for pid, _, _ in similar_products]

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
                        COUNT(DISTINCT p."vendorId") as vendor_count
                    FROM relevant_groups g
                    JOIN "Product" p ON p."productGroupId" = g.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    WHERE ($2::numeric IS NULL OR p.price >= $2)
                      AND ($3::numeric IS NULL OR p.price <= $3)
                      AND ($4::text[] IS NULL OR p."vendorId" = ANY($4))
                      AND ($5::text[] IS NULL OR p."brandId" = ANY($5))
                    GROUP BY g.id, g."normalizedName", g."dosageValue", g."dosageUnit"
                )
                SELECT * FROM group_products
                ORDER BY min_price
                LIMIT $6 OFFSET $7
            """,
                product_ids,
                filters.get("min_price") if filters else None,
                filters.get("max_price") if filters else None,
                filters.get("vendor_ids") if filters else None,
                filters.get("brand_ids") if filters else None,
                limit,
                offset,
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
                    }
                )

            return {"groups": groups, "total": total, "offset": offset, "limit": limit}

    async def _db_search_groups(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Database fallback search for groups"""

        query_tokens = query.lower().split()

        async with self.pool.acquire() as conn:
            search_conditions = []
            params = []
            param_count = 1

            for token in query_tokens:
                search_conditions.append(
                    f'(pg."normalizedName" ILIKE ${param_count} OR '
                    f'${param_count + 1} = ANY(p."searchTokens"))'
                )
                params.extend([f"%{token}%", token])
                param_count += 2

            where_clause = (
                " AND ".join(search_conditions) if search_conditions else "1=1"
            )

            if filters:
                if filters.get("min_price") is not None:
                    where_clause += f" AND p.price >= ${param_count}"
                    params.append(filters["min_price"])
                    param_count += 1

                if filters.get("max_price") is not None:
                    where_clause += f" AND p.price <= ${param_count}"
                    params.append(filters["max_price"])
                    param_count += 1

            query_sql = f"""
                WITH matching_groups AS (
                    SELECT DISTINCT pg.id
                    FROM "ProductGroup" pg
                    JOIN "Product" p ON p."productGroupId" = pg.id
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
                                'vendor_name', v.name,
                                'link', p.link
                            ) ORDER BY p.price
                        ) as products,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        COUNT(DISTINCT p."vendorId") as vendor_count
                    FROM "ProductGroup" pg
                    JOIN matching_groups mg ON mg.id = pg.id
                    JOIN "Product" p ON p."productGroupId" = pg.id
                    JOIN "Vendor" v ON v.id = p."vendorId"
                    GROUP BY pg.id, pg."normalizedName", pg."dosageValue", pg."dosageUnit"
                )
                SELECT * FROM group_data
                ORDER BY min_price
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
                        "products": json.loads(row["products"]),
                        "price_range": {
                            "min": float(row["min_price"]),
                            "max": float(row["max_price"]),
                        },
                        "vendor_count": row["vendor_count"],
                    }
                )

            return {
                "groups": groups,
                "total": len(groups),
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
