#!/usr/bin/env python3
"""
Script to preprocess all existing products with enhanced preprocessing
This will update products with improved search tokens and grouping keys
"""

import asyncio
import asyncpg
import logging
import os
import sys
from typing import List, Dict
from dotenv import load_dotenv

load_dotenv()

# Add the parent directory to the path so we can import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.preprocessor import preprocessor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ProductPreprocessor:
    """Batch preprocessor for existing products"""
    
    def __init__(self, db_url: str):
        self.db_url = db_url
        
    async def preprocess_all_products(self, batch_size: int = 1000):
        """Preprocess all products in batches"""
        
        pool = await asyncpg.create_pool(self.db_url)
        
        try:
            # Get total count
            async with pool.acquire() as conn:
                total_count = await conn.fetchval('SELECT COUNT(*) FROM "Product"')
                logger.info(f"Found {total_count} products to preprocess")
            
            # Process in batches
            processed = 0
            offset = 0
            
            while offset < total_count:
                logger.info(f"Processing batch {offset + 1} to {min(offset + batch_size, total_count)}")
                
                async with pool.acquire() as conn:
                    # Fetch batch
                    products = await conn.fetch(
                        '''
                        SELECT p.id, p.title, p.price, p."vendorId", 
                               b.name as brand_name, p."normalizedName", p."searchTokens"
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        ORDER BY p.id
                        LIMIT $1 OFFSET $2
                        ''',
                        batch_size, offset
                    )
                
                # Preprocess each product
                updates = []
                for product in products:
                    identity = preprocessor.preprocess_product(
                        product['title'], 
                        product.get('brand_name')
                    )
                    
                    updates.append({
                        'id': product['id'],
                        'normalized_name': identity.normalized_name,
                        'search_tokens': identity.search_tokens,
                        'grouping_key': identity.grouping_key,
                        'category': identity.category,
                        'strength': identity.strength,
                        'form': identity.form
                    })
                
                # Batch update
                await self._batch_update(pool, updates)
                
                processed += len(products)
                offset += batch_size
                
                logger.info(f"Processed {processed}/{total_count} products ({processed/total_count*100:.1f}%)")
                
                # Prevent overwhelming the database
                await asyncio.sleep(0.1)
                
        finally:
            await pool.close()
            
        logger.info(f"Preprocessing completed! Updated {processed} products")
    
    async def _batch_update(self, pool: asyncpg.Pool, updates: List[Dict]):
        """Batch update products with preprocessed data"""
        
        if not updates:
            return
            
        async with pool.acquire() as conn:
            # First, ensure we have the necessary columns
            await self._ensure_columns(conn)
            
            # Prepare batch update
            await conn.executemany(
                '''
                UPDATE "Product" 
                SET 
                    "normalizedName" = $2,
                    "searchTokens" = $3,
                    "groupingKey" = $4,
                    "category" = $5,
                    "strength" = $6,
                    "form" = $7,
                    "preprocessedAt" = NOW()
                WHERE id = $1
                ''',
                [
                    (
                        update['id'],
                        update['normalized_name'],
                        update['search_tokens'],
                        update['grouping_key'],
                        update['category'],
                        update['strength'],
                        update['form']
                    )
                    for update in updates
                ]
            )
    
    async def _ensure_columns(self, conn: asyncpg.Connection):
        """Ensure all required columns exist"""
        
        columns_to_add = [
            ('groupingKey', 'TEXT'),
            ('category', 'TEXT'),
            ('strength', 'TEXT'),
            ('form', 'TEXT'),
            ('preprocessedAt', 'TIMESTAMP'),
            ('mlEmbedding', 'BYTEA'),
            ('similarityHash', 'TEXT')
        ]
        
        for column_name, column_type in columns_to_add:
            try:
                await conn.execute(f'ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "{column_name}" {column_type}')
                logger.info(f"Added column {column_name}")
            except Exception as e:
                # Column probably already exists or other error
                logger.debug(f"Column {column_name} may already exist: {e}")
                pass
    
    async def add_indexes(self):
        """Add indexes for improved performance"""
        
        pool = await asyncpg.create_pool(self.db_url)
        
        try:
            async with pool.acquire() as conn:
                indexes = [
                    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_grouping_key ON "Product" ("groupingKey")',
                    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_category ON "Product" ("category")',
                    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_strength ON "Product" ("strength")',
                    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_form ON "Product" ("form")',
                    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_preprocessed ON "Product" ("preprocessedAt") WHERE "preprocessedAt" IS NOT NULL',
                ]
                
                for index_sql in indexes:
                    try:
                        await conn.execute(index_sql)
                        logger.info(f"Created index: {index_sql.split('idx_')[1].split()[0]}")
                    except Exception as e:
                        logger.warning(f"Failed to create index: {e}")
                        
        finally:
            await pool.close()
    
    async def create_grouping_view(self):
        """Create a view for easier product grouping queries"""
        
        pool = await asyncpg.create_pool(self.db_url)
        
        try:
            async with pool.acquire() as conn:
                await conn.execute('''
                    CREATE OR REPLACE VIEW product_groups AS
                    SELECT 
                        "groupingKey",
                        COUNT(*) as product_count,
                        MIN(price) as min_price,
                        MAX(price) as max_price,
                        AVG(price) as avg_price,
                        COUNT(DISTINCT "vendorId") as vendor_count,
                        array_agg(DISTINCT "vendorId") as vendor_ids,
                        array_agg(id ORDER BY price) as product_ids,
                        COALESCE(MAX("normalizedName"), MAX(title)) as group_name,
                        MAX(category) as category,
                        MAX(strength) as strength,
                        MAX(form) as form
                    FROM "Product" 
                    WHERE "groupingKey" IS NOT NULL AND "groupingKey" != ''
                    GROUP BY "groupingKey"
                    HAVING COUNT(*) > 0
                    ORDER BY product_count DESC, min_price ASC
                ''')
                
                logger.info("Created product_groups view")
                
        finally:
            await pool.close()


async def main():
    """Main function"""
    
    # Get database URL from environment
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        logger.error("DATABASE_URL environment variable not set")
        return
    
    preprocessor_instance = ProductPreprocessor(db_url)
    
    logger.info("Starting product preprocessing...")
    
    # Preprocess all products
    await preprocessor_instance.preprocess_all_products(batch_size=1000)
    
    # Add indexes for performance
    logger.info("Adding indexes...")
    await preprocessor_instance.add_indexes()
    
    # Create grouping view
    logger.info("Creating grouping view...")
    await preprocessor_instance.create_grouping_view()
    
    logger.info("Preprocessing complete!")


if __name__ == "__main__":
    asyncio.run(main())