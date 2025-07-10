import asyncio
import asyncpg
from datetime import datetime
import logging
import json
import os
from tqdm import tqdm
from typing import List, Dict

try:
    from .normalizer import PharmaNormalizer
except ImportError:
    from normalizer import PharmaNormalizer

logger = logging.getLogger(__name__)


class EnhancedProductProcessor:
    """Simplified processor for dynamic grouping - only handles product normalization"""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.normalizer = PharmaNormalizer()
        self.pool: asyncpg.pool.Pool

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.db_url)

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def process_products(self, batch_size: int = 10000):
        """Process all unprocessed products with normalization only"""
        logger.info("Starting simplified product processing (normalization only)")

        total_count = await self._get_unprocessed_count()
        logger.info(f"Found {total_count} unprocessed products")

        processed = 0
        with tqdm(total=total_count, desc="Processing products") as pbar:
            while processed < total_count:
                products = await self._fetch_unprocessed_batch(batch_size)
                if not products:
                    break

                processed_products = await self._process_batch_normalized(products)
                await self._save_processed_products_simplified(processed_products)

                processed += len(products)
                pbar.update(len(products))

        logger.info(f"Processed {processed} products with normalization")

    async def _process_batch_normalized(self, products: List[Dict]) -> List[Dict]:
        """Process a batch of products with normalization only"""
        processed = []

        for product in products:
            try:
                # Extract product info
                title = product.get("title", "")
                price = product.get("price", 0)
                
                # Normalize the product
                normalized = self.normalizer.normalize(title)
                
                # Create processed product data
                processed_product = {
                    "id": product["id"],
                    "title": title,
                    "price": price,
                    "normalizedName": normalized.normalized_name,
                    "searchTokens": normalized.search_tokens,
                    "searchVector": normalized.normalized_name,  # For full-text search
                    "processedAt": datetime.now(),
                }
                
                processed.append(processed_product)
                
            except Exception as e:
                logger.error(f"Error processing product {product.get('id')}: {e}")
                continue

        return processed

    async def _save_processed_products_simplified(self, products: List[Dict]):
        """Save processed products with normalization data only"""
        if not products:
            return

        async with self.pool.acquire() as conn:
            # Update products with normalized data
            for product in products:
                try:
                    await conn.execute(
                        """
                        UPDATE "Product" 
                        SET 
                            "normalizedName" = $2,
                            "searchTokens" = $3,
                            "searchVector" = to_tsvector('english', $4),
                            "processedAt" = $5
                        WHERE id = $1
                        """,
                        product["id"],
                        product["normalizedName"],
                        product["searchTokens"],
                        product["searchVector"],
                        product["processedAt"],
                    )
                except Exception as e:
                    logger.error(f"Error saving product {product['id']}: {e}")

    async def _get_unprocessed_count(self) -> int:
        """Get count of unprocessed products"""
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                'SELECT COUNT(*) FROM "Product" WHERE "processedAt" IS NULL'
            )

    async def _fetch_unprocessed_batch(self, batch_size: int) -> List[Dict]:
        """Fetch a batch of unprocessed products"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                '''
                SELECT id, title, price
                FROM "Product" 
                WHERE "processedAt" IS NULL
                LIMIT $1
                ''',
                batch_size
            )
            
            return [dict(row) for row in rows]

    async def reprocess_all_products(self):
        """Reprocess all products (reset and reprocess)"""
        logger.info("Reprocessing all products")
        
        async with self.pool.acquire() as conn:
            # Reset all products to unprocessed
            await conn.execute(
                '''
                UPDATE "Product" 
                SET 
                    "processedAt" = NULL,
                    "normalizedName" = NULL,
                    "searchTokens" = NULL,
                    "searchVector" = NULL
                '''
            )
        
        # Process all products
        await self.process_products()
        
        logger.info("Reprocessing complete")

    async def analyze_processing_effectiveness(self):
        """Analyze the effectiveness of product processing"""
        async with self.pool.acquire() as conn:
            stats = await conn.fetchrow(
                """
                SELECT 
                    COUNT(*) as total_products,
                    COUNT("processedAt") as processed_products,
                    COUNT("normalizedName") as normalized_products,
                    COUNT("searchTokens") as tokenized_products,
                    COUNT("searchVector") as vectorized_products
                FROM "Product"
                """
            )
            
            logger.info(f"Processing Statistics:")
            logger.info(f"  Total products: {stats['total_products']}")
            logger.info(f"  Processed: {stats['processed_products']}")
            logger.info(f"  Normalized: {stats['normalized_products']}")
            logger.info(f"  Tokenized: {stats['tokenized_products']}")
            logger.info(f"  Vectorized: {stats['vectorized_products']}")
            
            return dict(stats)