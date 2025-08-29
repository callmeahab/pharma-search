#!/usr/bin/env python3
"""
Apply schema updates for ML-enhanced preprocessing
This script must be run before the main preprocessing script
"""

import asyncio
import asyncpg
import logging
import os
import sys
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def apply_schema_updates():
    """Apply all schema updates for ML preprocessing"""
    
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        logger.error("DATABASE_URL environment variable not set")
        return False
    
    logger.info("Applying schema updates...")
    
    try:
        pool = await asyncpg.create_pool(db_url)
        
        async with pool.acquire() as conn:
            logger.info("Adding new columns...")
            
            # Add columns one by one to avoid conflicts
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
                    logger.info(f"✓ Added column {column_name}")
                except Exception as e:
                    logger.debug(f"Column {column_name}: {e}")
            
            logger.info("Creating indexes...")
            
            # Create indexes (non-concurrently for simpler execution)
            indexes = [
                'CREATE INDEX IF NOT EXISTS idx_product_grouping_key ON "Product" ("groupingKey") WHERE "groupingKey" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_category ON "Product" ("category") WHERE "category" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_strength ON "Product" ("strength") WHERE "strength" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_form ON "Product" ("form") WHERE "form" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_preprocessed ON "Product" ("preprocessedAt") WHERE "preprocessedAt" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_similarity_hash ON "Product" ("similarityHash") WHERE "similarityHash" IS NOT NULL',
                'CREATE INDEX IF NOT EXISTS idx_product_category_strength ON "Product" ("category", "strength") WHERE "category" IS NOT NULL AND "strength" IS NOT NULL',
            ]
            
            for index_sql in indexes:
                try:
                    await conn.execute(index_sql)
                    index_name = index_sql.split('idx_')[1].split()[0]
                    logger.info(f"✓ Created index {index_name}")
                except Exception as e:
                    logger.warning(f"Index creation failed: {e}")
            
            logger.info("Creating view...")
            
            # Create the view
            try:
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
                logger.info("✓ Created product_groups view")
            except Exception as e:
                logger.warning(f"View creation failed: {e}")
            
            # Update statistics
            await conn.execute('ANALYZE "Product"')
            logger.info("✓ Updated table statistics")
            
        await pool.close()
        
        logger.info("✓ Schema updates completed successfully!")
        return True
        
    except Exception as e:
        logger.error(f"✗ Schema update failed: {e}")
        return False


async def check_schema():
    """Check if schema updates were applied correctly"""
    
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        return False
    
    try:
        pool = await asyncpg.create_pool(db_url)
        
        async with pool.acquire() as conn:
            # Check if new columns exist
            result = await conn.fetch("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'Product' 
                AND column_name IN ('groupingKey', 'category', 'strength', 'form', 'preprocessedAt', 'mlEmbedding', 'similarityHash')
                ORDER BY column_name
            """)
            
            found_columns = [row['column_name'] for row in result]
            expected_columns = ['category', 'form', 'groupingKey', 'mlEmbedding', 'preprocessedAt', 'similarityHash', 'strength']
            
            logger.info(f"Found columns: {found_columns}")
            
            if set(found_columns) == set(expected_columns):
                logger.info("✓ All required columns are present")
                return True
            else:
                missing = set(expected_columns) - set(found_columns)
                logger.warning(f"Missing columns: {missing}")
                return False
        
        await pool.close()
        
    except Exception as e:
        logger.error(f"Schema check failed: {e}")
        return False


async def main():
    """Main function"""
    
    logger.info("=== Schema Update for ML Preprocessing ===")
    
    # Apply schema updates
    success = await apply_schema_updates()
    
    if not success:
        logger.error("Schema updates failed!")
        return
    
    # Verify schema
    logger.info("\nVerifying schema updates...")
    if await check_schema():
        logger.info("✓ Schema verification successful")
        logger.info("\nNext steps:")
        logger.info("1. Run: python scripts/preprocess_products.py")
        logger.info("2. Run: python scripts/setup_ml.py")
    else:
        logger.error("✗ Schema verification failed")


if __name__ == "__main__":
    asyncio.run(main())