import asyncio
import asyncpg
from datetime import datetime
import logging
import json
from tqdm import tqdm
from typing import List, Dict

from .normalizer import PharmaNormalizer
from .similarity_matcher import SimilarityMatcher

logger = logging.getLogger(__name__)


class ProductProcessor:
    """Main processor for pharmaceutical products"""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.normalizer = PharmaNormalizer()
        self.matcher = SimilarityMatcher()
        self.pool = None

    async def connect(self):
        """Create database connection pool"""
        self.pool = await asyncpg.create_pool(self.db_url)

    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()

    async def process_products(self, batch_size: int = 10000):
        """Process all unprocessed products"""
        logger.info("Starting product processing")

        total_count = await self._get_unprocessed_count()
        logger.info(f"Found {total_count} unprocessed products")

        processed = 0
        with tqdm(total=total_count) as pbar:
            while processed < total_count:
                products = await self._fetch_unprocessed_batch(batch_size)
                if not products:
                    break

                processed_products = await self._process_batch(products)
                await self._save_processed_products(processed_products)

                processed += len(products)
                pbar.update(len(products))

        logger.info(f"Processing complete. Processed {processed} products")
        await self._update_similarity_index()

    async def _get_unprocessed_count(self) -> int:
        """Get count of unprocessed products"""
        async with self.pool.acquire() as conn:
            result = await conn.fetchval(
                'SELECT COUNT(*) FROM "Product" WHERE "processedAt" IS NULL'
            )
            return result

    async def _fetch_unprocessed_batch(self, batch_size: int) -> List[Dict]:
        """Fetch batch of unprocessed products"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT p.*, 
                       b.name as brand_name,
                       pn.name as product_name_ml,
                       u.name as unit_name
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                LEFT JOIN "ProductName" pn ON p."productNameId" = pn.id
                LEFT JOIN "Unit" u ON p."unitId" = u.id
                WHERE p."processedAt" IS NULL
                LIMIT {batch_size}
            """
            )

            return [dict(row) for row in rows]

    async def _process_batch(self, products: List[Dict]) -> List[Dict]:
        """Process a batch of products"""
        processed = []

        for product in products:
            try:
                title = product.get("originalTitle") or product.get("title")
                processed_product = self.normalizer.normalize(title)

                if (
                    product.get("brand_name")
                    and product.get("brandConfidence", 0) > 0.8
                ):
                    processed_product.attributes.brand = product["brand_name"]

                if (
                    product.get("product_name_ml")
                    and product.get("productNameConfidence", 0) > 0.8
                ):
                    processed_product.attributes.product_name = product[
                        "product_name_ml"
                    ]

                if (
                    product.get("quantity")
                    and product.get("quantityConfidence", 0) > 0.8
                ):
                    processed_product.attributes.quantity = product["quantity"]

                if product.get("unit_name") and product.get("unitConfidence", 0) > 0.8:
                    processed_product.attributes.quantity_unit = product["unit_name"]

                if processed_product.normalized_name:
                    embedding = self.matcher.encoder.encode(
                        [processed_product.normalized_name]
                    )[0]
                    processed_product.embedding = embedding.tolist()

                processed.append(
                    {
                        "id": product["id"],
                        "normalized_name": processed_product.normalized_name,
                        "search_tokens": processed_product.search_tokens,
                        "group_key": processed_product.group_key,
                        "dosage_value": processed_product.attributes.dosage_value,
                        "dosage_unit": processed_product.attributes.dosage_unit,
                        "title_embedding": processed_product.embedding,
                    }
                )

            except Exception as e:
                logger.error(f"Error processing product {product.get('id')}: {e}")
                continue

        return processed

    async def _save_processed_products(self, products: List[Dict]):
        """Save processed products to database"""
        if not products:
            return

        async with self.pool.acquire() as conn:
            groups = {}
            for product in products:
                group_key = product["group_key"]
                if group_key not in groups:
                    group = await conn.fetchrow(
                        'SELECT id FROM "ProductGroup" WHERE "groupKey" = $1', group_key
                    )

                    if not group:
                        group_id = await conn.fetchval(
                            """
                            INSERT INTO "ProductGroup" (
                                id, "normalizedName", "groupKey", 
                                "dosageValue", "dosageUnit",
                                "createdAt", "updatedAt"
                            ) VALUES (
                                gen_random_uuid()::text, $1, $2, $3, $4, 
                                NOW(), NOW()
                            ) RETURNING id
                        """,
                            product["normalized_name"],
                            group_key,
                            product["dosage_value"],
                            product["dosage_unit"],
                        )
                        groups[group_key] = group_id
                    else:
                        groups[group_key] = group["id"]

            for product in products:
                try:
                    await conn.execute(
                        """
                        UPDATE "Product" 
                        SET "normalizedName" = $1,
                            "searchTokens" = $2,
                            "productGroupId" = $3,
                            "dosageValue" = $4,
                            "dosageUnit" = $5,
                            "processedAt" = NOW()
                        WHERE id = $6
                    """,
                        product["normalized_name"],
                        product["search_tokens"],
                        groups[product["group_key"]],
                        product["dosage_value"],
                        product["dosage_unit"],
                        product["id"],
                    )

                except Exception as e:
                    logger.error(f"Error saving product {product['id']}: {e}")

            for group_id in groups.values():
                await conn.execute(
                    """
                    UPDATE "ProductGroup"
                    SET "productCount" = (
                        SELECT COUNT(*) FROM "Product" 
                        WHERE "productGroupId" = $1
                    ),
                    "updatedAt" = NOW()
                    WHERE id = $1
                """,
                    group_id,
                )

    async def _update_similarity_index(self):
        """Update the similarity search index"""
        logger.info("Updating similarity index")

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

            self.matcher.build_index(products)

        logger.info("Similarity index updated")
