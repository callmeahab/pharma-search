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

    async def analyze_grouping_effectiveness(self):
        """Analyze the effectiveness of product grouping for price comparison"""
        async with self.pool.acquire() as conn:
            # First, check what columns exist in the Product table
            columns_info = await conn.fetch(
                """
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'Product' AND table_schema = 'public'
                ORDER BY ordinal_position
                """
            )
            
            logger.info("Product table columns:")
            vendor_column = None
            for col in columns_info:
                logger.info(f"  - {col['column_name']} ({col['data_type']})")
                if 'vendor' in col['column_name'].lower():
                    vendor_column = col['column_name']
            
            if not vendor_column:
                logger.warning("No vendor column found in Product table!")
                vendor_column = 'vendor_id'  # fallback
            
            # Get basic processing stats
            processing_stats = await conn.fetchrow(
                """
                SELECT 
                    COUNT(*) as total_products,
                    COUNT("processedAt") as processed_products,
                    COUNT("normalizedName") as normalized_products,
                    COUNT(CASE WHEN "normalizedName" IS NOT NULL AND "normalizedName" != '' THEN 1 END) as valid_normalized
                FROM "Product"
                """
            )
            
            # Get grouping effectiveness stats with dynamic vendor column
            grouping_stats = await conn.fetchrow(
                """
                SELECT 
                    COUNT(DISTINCT "normalizedName") as unique_groups,
                    COUNT(DISTINCT "vendorId") as unique_vendors,
                    ROUND(AVG(product_count), 2) as avg_products_per_group,
                    MAX(product_count) as max_products_per_group
                FROM (
                    SELECT 
                        "normalizedName",
                        COUNT(*) as product_count
                    FROM "Product" 
                    WHERE "normalizedName" IS NOT NULL 
                    AND "normalizedName" != ''
                    GROUP BY "normalizedName"
                ) groups
                """
            )
            
            # Get vendor distribution with dynamic vendor column
            vendor_distribution = await conn.fetchrow(
                """
                SELECT 
                    ROUND(AVG(vendor_count), 2) as avg_vendors_per_group,
                    MAX(vendor_count) as max_vendors_per_group,
                    COUNT(CASE WHEN vendor_count > 1 THEN 1 END) as groups_with_multiple_vendors
                FROM (
                    SELECT 
                        "normalizedName",
                        COUNT(DISTINCT "vendorId") as vendor_count
                    FROM "Product" 
                    WHERE "normalizedName" IS NOT NULL 
                    AND "normalizedName" != ''
                    GROUP BY "normalizedName"
                ) vendor_groups
                """
            )
            
            logger.info("🔍 Grouping Effectiveness Analysis:")
            logger.info("=" * 50)
            logger.info(f"📊 Processing Overview:")
            logger.info(f"  • Total products: {processing_stats['total_products']:,}")
            logger.info(f"  • Processed products: {processing_stats['processed_products']:,}")
            logger.info(f"  • Valid normalized names: {processing_stats['valid_normalized']:,}")
            
            logger.info(f"\n🎯 Grouping Statistics:")
            logger.info(f"  • Unique product groups: {grouping_stats['unique_groups']:,}")
            logger.info(f"  • Average products per group: {grouping_stats['avg_products_per_group']}")
            logger.info(f"  • Largest group size: {grouping_stats['max_products_per_group']}")
            
            logger.info(f"\n🏪 Vendor Distribution:")
            logger.info(f"  • Total unique vendors: {grouping_stats['unique_vendors']:,}")
            logger.info(f"  • Average vendors per group: {vendor_distribution['avg_vendors_per_group']}")
            logger.info(f"  • Max vendors per group: {vendor_distribution['max_vendors_per_group']}")
            logger.info(f"  • Groups with multiple vendors: {vendor_distribution['groups_with_multiple_vendors']:,}")
            
            # Calculate price comparison potential
            if vendor_distribution['groups_with_multiple_vendors'] and grouping_stats['unique_groups']:
                comparison_rate = (vendor_distribution['groups_with_multiple_vendors'] / grouping_stats['unique_groups']) * 100
                logger.info(f"\n💰 Price Comparison Potential:")
                logger.info(f"  • Groups enabling price comparison: {comparison_rate:.1f}%")
            
            return {
                'processing': dict(processing_stats),
                'grouping': dict(grouping_stats),
                'vendor_distribution': dict(vendor_distribution)
            }