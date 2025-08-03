"""
DuckDB-compatible product processor for pharmaceutical products
"""
import asyncio
import logging
import json
import os
from datetime import datetime
from typing import List, Dict, Optional

try:
    from .database import get_db_pool, close_db_pool
    from .normalizer import PharmaNormalizer
except ImportError:
    try:
        from database import get_db_pool, close_db_pool
        from normalizer import PharmaNormalizer
    except ImportError:
        # Docker environment
        import sys
        sys.path.append(os.path.dirname(__file__))
        from database import get_db_pool, close_db_pool
        from normalizer import PharmaNormalizer

logger = logging.getLogger(__name__)


class DuckDBProductProcessor:
    """DuckDB-compatible product processor for pharmaceutical products"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.normalizer = PharmaNormalizer()
        self.db_pool = None

    async def connect(self):
        """Initialize database connection"""
        self.db_pool = await get_db_pool()
        logger.info("DuckDB product processor connected")

    async def disconnect(self):
        """Close database connection"""
        await close_db_pool()
        logger.info("DuckDB product processor disconnected")

    async def process_products(self, batch_size: int = 1000):
        """Process all unprocessed products with normalization"""
        logger.info("Starting DuckDB product processing (normalization only)")

        total_count = await self._get_unprocessed_count()
        logger.info(f"Found {total_count} unprocessed products")

        if total_count == 0:
            logger.info("No products to process")
            return

        processed = 0
        while processed < total_count:
            # Fetch batch of unprocessed products
            products = await self._fetch_unprocessed_batch(batch_size)
            if not products:
                break

            # Process the batch
            processed_products = await self._process_batch_normalized(products)
            
            # Save processed products
            await self._save_processed_products(processed_products)

            processed += len(products)
            logger.info(f"Processed {processed}/{total_count} products")

        logger.info("Product processing completed")

    async def _get_unprocessed_count(self) -> int:
        """Get count of unprocessed products"""
        async with self.db_pool.acquire() as conn:
            result = await conn.execute(
                'SELECT COUNT(*) as count FROM Product WHERE processedAt IS NULL'
            )
            return result[0]['count'] if result else 0

    async def _fetch_unprocessed_batch(self, batch_size: int) -> List[Dict]:
        """Fetch batch of unprocessed products"""
        async with self.db_pool.acquire() as conn:
            results = await conn.execute(
                '''
                SELECT id, title, description, category, dosageValue, dosageUnit,
                       quantity, brandId, unitId, productNameId, vendorId
                FROM Product 
                WHERE processedAt IS NULL 
                LIMIT ?
                ''',
                [batch_size]
            )
            return results

    async def _process_batch_normalized(self, products: List[Dict]) -> List[Dict]:
        """Process a batch of products with normalization"""
        processed_products = []
        
        for product in products:
            try:
                # Normalize the product title
                normalized_data = self.normalizer.normalize_product_name(
                    product.get('title', '')
                )
                
                # Create search tokens
                search_tokens = self._create_search_tokens(
                    product.get('title', ''),
                    normalized_data.get('normalized_name', ''),
                    product.get('description', '')
                )
                
                # Update product data
                processed_product = {
                    'id': product['id'],
                    'normalizedName': normalized_data.get('normalized_name'),
                    'searchTokens': json.dumps(search_tokens),  # Store as JSON string for DuckDB
                    'processedAt': datetime.now().isoformat(),
                }
                
                # Add dosage information if available
                if normalized_data.get('dosage_value'):
                    processed_product['dosageValue'] = normalized_data['dosage_value']
                if normalized_data.get('dosage_unit'):
                    processed_product['dosageUnit'] = normalized_data['dosage_unit']
                
                processed_products.append(processed_product)
                
            except Exception as e:
                logger.error(f"Error processing product {product.get('id', 'unknown')}: {e}")
                # Mark as processed even if failed to avoid infinite loops
                processed_products.append({
                    'id': product['id'],
                    'processedAt': datetime.now().isoformat(),
                })
        
        return processed_products

    def _create_search_tokens(self, title: str, normalized_name: str, description: str = '') -> List[str]:
        """Create search tokens from product information"""
        tokens = set()
        
        # Add tokens from title
        if title:
            tokens.update(self._tokenize_text(title.lower()))
        
        # Add tokens from normalized name
        if normalized_name:
            tokens.update(self._tokenize_text(normalized_name.lower()))
        
        # Add tokens from description (first 100 chars)
        if description:
            desc_short = description[:100].lower()
            tokens.update(self._tokenize_text(desc_short))
        
        # Filter out short tokens and common stop words
        stop_words = {'i', 'a', 'u', 'za', 'od', 'do', 'sa', 'na', 'po', 'mg', 'ml', 'g', 'kg'}
        filtered_tokens = [
            token for token in tokens 
            if len(token) >= 2 and token not in stop_words
        ]
        
        return list(filtered_tokens)[:50]  # Limit to 50 tokens

    def _tokenize_text(self, text: str) -> List[str]:
        """Simple tokenization of text"""
        import re
        # Split on non-alphanumeric characters
        tokens = re.findall(r'\b\w+\b', text)
        return [token.strip() for token in tokens if token.strip()]

    async def _save_processed_products(self, processed_products: List[Dict]):
        """Save processed products to database"""
        if not processed_products:
            return
            
        async with self.db_pool.acquire() as conn:
            for product in processed_products:
                try:
                    # Update the product with processed data
                    update_fields = []
                    params = []
                    
                    if 'normalizedName' in product:
                        update_fields.append('normalizedName = ?')
                        params.append(product['normalizedName'])
                    
                    if 'searchTokens' in product:
                        update_fields.append('searchTokens = ?')
                        params.append(product['searchTokens'])
                    
                    if 'dosageValue' in product:
                        update_fields.append('dosageValue = ?')
                        params.append(product['dosageValue'])
                    
                    if 'dosageUnit' in product:
                        update_fields.append('dosageUnit = ?')
                        params.append(product['dosageUnit'])
                    
                    update_fields.append('processedAt = ?')
                    params.append(product['processedAt'])
                    
                    # Add product ID for WHERE clause
                    params.append(product['id'])
                    
                    update_sql = f'''
                        UPDATE Product 
                        SET {', '.join(update_fields)}
                        WHERE id = ?
                    '''
                    
                    await conn.execute(update_sql, params)
                    
                except Exception as e:
                    logger.error(f"Error saving product {product.get('id', 'unknown')}: {e}")

    async def reprocess_all_products(self):
        """Reprocess all products (mark as unprocessed first)"""
        logger.info("Reprocessing all products")
        
        async with self.db_pool.acquire() as conn:
            # Mark all products as unprocessed
            await conn.execute(
                'UPDATE Product SET processedAt = NULL, normalizedName = NULL, searchTokens = NULL'
            )
        
        # Process all products
        await self.process_products()

    async def analyze_processing_effectiveness(self) -> Dict:
        """Analyze the effectiveness of product processing"""
        async with self.db_pool.acquire() as conn:
            # Get basic stats
            total_products = await conn.execute('SELECT COUNT(*) as count FROM Product')
            processed_products = await conn.execute(
                'SELECT COUNT(*) as count FROM Product WHERE processedAt IS NOT NULL'
            )
            
            total_count = total_products[0]['count'] if total_products else 0
            processed_count = processed_products[0]['count'] if processed_products else 0
            
            # Get normalization stats
            normalized_products = await conn.execute(
                'SELECT COUNT(*) as count FROM Product WHERE normalizedName IS NOT NULL'
            )
            normalized_count = normalized_products[0]['count'] if normalized_products else 0
            
            # Get search token stats
            with_tokens = await conn.execute(
                'SELECT COUNT(*) as count FROM Product WHERE searchTokens IS NOT NULL AND searchTokens != ""'
            )
            tokens_count = with_tokens[0]['count'] if with_tokens else 0
            
            return {
                'total_products': total_count,
                'processed_products': processed_count,
                'processing_percentage': (processed_count / total_count * 100) if total_count > 0 else 0,
                'normalized_products': normalized_count,
                'normalization_percentage': (normalized_count / total_count * 100) if total_count > 0 else 0,
                'products_with_tokens': tokens_count,
                'tokenization_percentage': (tokens_count / total_count * 100) if total_count > 0 else 0,
            }