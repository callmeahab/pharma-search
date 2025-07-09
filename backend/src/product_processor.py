import asyncio
import asyncpg
from datetime import datetime
import logging
import json
import os
import re
from tqdm import tqdm
from typing import List, Dict, Set, Tuple
from collections import defaultdict
from rapidfuzz import fuzz

from .normalizer import PharmaNormalizer
from .similarity_matcher import SimilarityMatcher

logger = logging.getLogger(__name__)


class EnhancedProductProcessor:
    """Enhanced processor with better grouping for price comparison"""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self.normalizer = PharmaNormalizer()
        self.matcher = SimilarityMatcher()
        self.pool: asyncpg.pool.Pool

    async def connect(self):
        """Create database connection pool"""
        self.pool = await asyncpg.create_pool(self.db_url)

    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()

    async def process_products(self, batch_size: int = 10000):
        """Process all unprocessed products with enhanced grouping"""
        logger.info("Starting enhanced product processing")

        # Step 1: Process products with new grouping logic
        await self._process_products_with_new_grouping(batch_size)
        
        # Step 2: Fast group merging during initial processing
        logger.info("Using fast inline group merging during processing")
        
        # Step 3: Update similarity index
        await self._update_similarity_index()
        
        logger.info("Enhanced product processing complete")

    async def _process_products_with_new_grouping(self, batch_size: int):
        """Process products with enhanced grouping logic"""
        
        total_count = await self._get_unprocessed_count()
        logger.info(f"Found {total_count} unprocessed products")

        processed = 0
        with tqdm(total=total_count, desc="Processing products") as pbar:
            while processed < total_count:
                products = await self._fetch_unprocessed_batch(batch_size)
                if not products:
                    break

                processed_products = await self._process_batch_enhanced(products)
                await self._save_processed_products_enhanced(processed_products)

                processed += len(products)
                pbar.update(len(products))

        logger.info(f"Processed {processed} products with new grouping")

    async def _process_batch_enhanced(self, products: List[Dict]) -> List[Dict]:
        """Process a batch of products with enhanced grouping"""
        processed = []
        normalized_names = []

        # First pass: normalize all products
        for product in products:
            try:
                title = product.get("originalTitle") or product.get("title")
                processed_product = self.normalizer.normalize(title)

                # Preserve existing ML-extracted data if confidence is high
                if product.get("brand_name") and product.get("brandConfidence", 0) > 0.8:
                    processed_product.attributes.brand = product["brand_name"]

                if product.get("product_name_ml") and product.get("productNameConfidence", 0) > 0.8:
                    processed_product.attributes.product_name = product["product_name_ml"]

                if product.get("quantity") and product.get("quantityConfidence", 0) > 0.8:
                    processed_product.attributes.quantity = product["quantity"]

                if product.get("unit_name") and product.get("unitConfidence", 0) > 0.8:
                    processed_product.attributes.quantity_unit = product["unit_name"]

                processed.append({
                    "id": product["id"],
                    "normalized_name": processed_product.normalized_name,
                    "search_tokens": processed_product.search_tokens,
                    "group_key": processed_product.group_key,
                    "similarity_key": getattr(processed_product, 'similarity_key', processed_product.group_key),
                    "dosage_value": processed_product.attributes.dosage_value,
                    "dosage_unit": processed_product.attributes.dosage_unit,
                    "quantity": processed_product.attributes.quantity,
                    "quantity_unit": processed_product.attributes.quantity_unit,
                    "form": processed_product.attributes.form,
                    "brand": processed_product.attributes.brand,
                    "processed_product": processed_product,
                })
                
                normalized_names.append(processed_product.normalized_name if processed_product.normalized_name else "")

            except Exception as e:
                logger.error(f"Error processing product {product.get('id')}: {e}")
                continue

        # Second pass: batch generate embeddings
        if normalized_names:
            embeddings = self.matcher.encoder.encode(normalized_names, batch_size=512, show_progress_bar=False)
            
            # Assign embeddings back to processed products
            for i, item in enumerate(processed):
                if i < len(embeddings):
                    item["title_embedding"] = embeddings[i].tolist()
                    # Remove the temporary processed_product
                    item.pop("processed_product", None)

        return processed

    async def _save_processed_products_enhanced(self, products: List[Dict]):
        """Save processed products with enhanced grouping"""
        if not products:
            return

        async with self.pool.acquire() as conn:
            # Create groups with similarity keys
            groups = {}
            similarity_groups = defaultdict(list)
            
            for product in products:
                group_key = product["group_key"]
                similarity_key = product["similarity_key"]
                
                # Track similarity groups for later merging
                similarity_groups[similarity_key].append(product)
                
                if group_key not in groups:
                    group = await conn.fetchrow(
                        'SELECT id FROM "ProductGroup" WHERE "groupKey" = $1', group_key
                    )

                    if not group:
                        # Validate dosage value for group creation
                        group_dosage_value = product["dosage_value"]
                        if group_dosage_value is not None:
                            if group_dosage_value > 99999999.99 or group_dosage_value < -99999999.99:
                                group_dosage_value = None
                        
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
                            group_dosage_value,
                            product["dosage_unit"],
                        )
                        groups[group_key] = group_id
                    else:
                        groups[group_key] = group["id"]

            # Fast inline group merging by similarity
            merged_groups = await self._merge_similar_groups_inline(conn, similarity_groups, groups)
            
            # Update products with merged group assignments
            for product in products:
                try:
                    final_group_id = merged_groups.get(product["group_key"], groups[product["group_key"]])
                    
                    # Validate dosage value to prevent numeric overflow
                    dosage_value = product["dosage_value"]
                    if dosage_value is not None:
                        # Database field is DECIMAL(10,2), max value is 99,999,999.99
                        if dosage_value > 99999999.99:
                            dosage_value = None
                            logger.warning(f"Product {product['id']}: dosage value {product['dosage_value']} too large, setting to NULL")
                        elif dosage_value < -99999999.99:
                            dosage_value = None
                            logger.warning(f"Product {product['id']}: dosage value {product['dosage_value']} too small, setting to NULL")
                    
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
                        final_group_id,
                        dosage_value,
                        product["dosage_unit"],
                        product["id"],
                    )
                except Exception as e:
                    logger.error(f"Error saving product {product['id']}: {e}")

            # Update group product counts for final groups only
            final_group_ids = set(merged_groups.values()) or set(groups.values())
            for group_id in final_group_ids:
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

    async def _merge_similar_groups_inline(self, conn, similarity_groups: Dict, groups: Dict) -> Dict:
        """Comprehensive group merging using fuzzy matching"""
        merged_groups = {}
        
        # First pass: merge by exact similarity key
        for similarity_key, products in similarity_groups.items():
            if len(products) <= 1:
                continue
                
            # Find the best representative group (most common or first)
            group_keys = [p["group_key"] for p in products]
            group_counts = defaultdict(int)
            for gk in group_keys:
                group_counts[gk] += 1
            
            # Use the group with most products as the target
            target_group_key = max(group_counts.items(), key=lambda x: x[1])[0]
            target_group_id = groups[target_group_key]
            
            # Map all other groups to the target group
            for gk in group_keys:
                if gk != target_group_key:
                    merged_groups[gk] = target_group_id
        
        # Second pass: aggressive fuzzy matching for remaining groups
        all_products = []
        for products in similarity_groups.values():
            all_products.extend(products)
        
        # Group by core product identity for fuzzy matching
        product_groups = defaultdict(list)
        for product in all_products:
            # Extract core identity from normalized name
            core_identity = self._extract_core_identity(product["normalized_name"])
            product_groups[core_identity].append(product)
        
        # Merge groups with very similar core identities
        for core_identity, products in product_groups.items():
            if len(products) <= 1:
                continue
                
            # Get unique group keys
            group_keys = list(set(p["group_key"] for p in products))
            if len(group_keys) <= 1:
                continue
                
            # Find target group (most products)
            group_counts = defaultdict(int)
            for p in products:
                group_counts[p["group_key"]] += 1
            
            target_group_key = max(group_counts.items(), key=lambda x: x[1])[0]
            target_group_id = groups[target_group_key]
            
            # Check if groups are similar enough to merge
            for gk in group_keys:
                if gk != target_group_key and self._should_merge_groups(target_group_key, gk):
                    merged_groups[gk] = target_group_id
                    
        return merged_groups
    
    def _extract_core_identity(self, normalized_name: str) -> str:
        """Extract core product identity for fuzzy matching"""
        # Remove brand names, quantities, forms, and other noise
        core = normalized_name.lower()
        
        # Remove common variations
        remove_patterns = [
            r'\b\d+\s*(mg|g|mcg|iu|ml|caps|tabs|tablet|capsule|kom|ks|x|pcs|pieces)\b',
            r'\b(twist|off|kaps|kapsula|kapsule|tableta|tablet|capsule|cap)\b',
            r'\b[a-z]*\d+\b',
            r'\b(babytol|centrum|solgar|gnc)\b',
            r'[,\.\-]'
        ]
        
        for pattern in remove_patterns:
            core = re.sub(pattern, ' ', core, flags=re.IGNORECASE)
        
        # Clean up whitespace
        core = ' '.join(core.split())
        return core
    
    def _should_merge_groups(self, group1: str, group2: str) -> bool:
        """Check if two groups should be merged based on similarity"""
        # Extract core parts from group keys
        def extract_core(group_key):
            if group_key.startswith('product:'):
                return group_key.split('_')[0].replace('product:', '')
            return group_key
        
        core1 = extract_core(group1)
        core2 = extract_core(group2)
        
        # Use fuzzy matching with high threshold
        similarity = fuzz.token_sort_ratio(core1, core2)
        return similarity >= 85  # High threshold for automatic merging

    async def _merge_similar_groups(self):
        """Merge similar product groups for better price comparison"""
        logger.info("Starting group merging for better price comparison")
        
        async with self.pool.acquire() as conn:
            # Get all product groups with their products
            groups = await conn.fetch("""
                SELECT 
                    pg.id,
                    pg."normalizedName",
                    pg."groupKey",
                    pg."dosageValue",
                    pg."dosageUnit",
                    pg."productCount",
                    array_agg(DISTINCT p."vendorId") as vendor_ids,
                    array_agg(p."normalizedName") as product_names,
                    array_agg(DISTINCT token) as all_search_tokens
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                CROSS JOIN LATERAL unnest(p."searchTokens") AS token
                WHERE pg."productCount" > 0
                GROUP BY pg.id, pg."normalizedName", pg."groupKey", pg."dosageValue", pg."dosageUnit", pg."productCount"
                ORDER BY pg."productCount" DESC
            """)

            merge_candidates = await self._find_merge_candidates(groups)
            
            if merge_candidates:
                await self._execute_group_merges(conn, merge_candidates)
                logger.info(f"Merged {len(merge_candidates)} group pairs")
            else:
                logger.info("No suitable groups found for merging")

    async def _find_merge_candidates(self, groups: List[Dict]) -> List[Tuple[str, str, float]]:
        """Find groups that should be merged based on similarity"""
        merge_candidates = []
        
        logger.info(f"Analyzing {len(groups)} groups for merge opportunities")
        
        for i, group1 in enumerate(groups):
            for j, group2 in enumerate(groups[i+1:], i+1):
                
                # Skip if same group
                if group1["id"] == group2["id"]:
                    continue
                
                # Calculate similarity score
                similarity_score = self._calculate_group_similarity(group1, group2)
                
                # Merge if similarity is high enough
                if similarity_score > 0.85:
                    merge_candidates.append((group1["id"], group2["id"], similarity_score))
                    logger.info(f"Merge candidate: '{group1['normalizedName']}' + '{group2['normalizedName']}' (score: {similarity_score:.3f})")
        
        # Sort by similarity score descending
        merge_candidates.sort(key=lambda x: x[2], reverse=True)
        
        return merge_candidates

    def _calculate_group_similarity(self, group1: Dict, group2: Dict) -> float:
        """Calculate similarity between two groups"""
        
        # Extract core product names
        name1 = group1["normalizedName"].lower()
        name2 = group2["normalizedName"].lower()
        
        # Apply core product mappings to normalize
        core_mappings = self.normalizer.core_product_mappings
        for original, normalized in core_mappings.items():
            name1 = name1.replace(original, normalized)
            name2 = name2.replace(original, normalized)
        
        # Calculate text similarity
        text_similarity = fuzz.token_sort_ratio(name1, name2) / 100.0
        
        # Boost score for exact core matches
        if name1 == name2:
            text_similarity = 1.0
        
        # Check dosage compatibility
        dosage_similarity = self._calculate_dosage_similarity(group1, group2)
        
        # Check if they have different vendors (good for price comparison)
        vendor_overlap = set(group1.get("vendor_ids", [])) & set(group2.get("vendor_ids", []))
        vendor_bonus = 0.1 if len(vendor_overlap) < len(set(group1.get("vendor_ids", []))) else 0
        
        # Final similarity score
        similarity = (text_similarity * 0.7) + (dosage_similarity * 0.2) + vendor_bonus
        
        return min(similarity, 1.0)

    def _calculate_dosage_similarity(self, group1: Dict, group2: Dict) -> float:
        """Calculate dosage similarity between groups"""
        
        dosage1 = group1.get("dosageValue")
        dosage2 = group2.get("dosageValue")
        unit1 = group1.get("dosageUnit")
        unit2 = group2.get("dosageUnit")
        
        # If one has no dosage info, neutral similarity
        if not dosage1 or not dosage2:
            return 0.5
        
        # Different units - lower similarity
        if unit1 != unit2:
            return 0.3
        
        # Same units - calculate ratio similarity
        if unit1 == unit2:
            ratio = min(float(dosage1), float(dosage2)) / max(float(dosage1), float(dosage2))
            
            # Allow some dosage variation for grouping
            if ratio >= 0.5:  # Within 2x range
                return 0.8
            elif ratio >= 0.25:  # Within 4x range
                return 0.6
            else:
                return 0.2
        
        return 0.5

    async def _execute_group_merges(self, conn, merge_candidates: List[Tuple[str, str, float]]):
        """Execute the actual group merges"""
        
        merged_groups = set()
        
        for source_id, target_id, score in merge_candidates:
            # Skip if either group was already merged
            if source_id in merged_groups or target_id in merged_groups:
                continue
            
            try:
                # Get group info
                source_group = await conn.fetchrow(
                    'SELECT * FROM "ProductGroup" WHERE id = $1', source_id
                )
                target_group = await conn.fetchrow(
                    'SELECT * FROM "ProductGroup" WHERE id = $1', target_id
                )
                
                if not source_group or not target_group:
                    continue
                
                # Move all products from source to target group
                await conn.execute(
                    'UPDATE "Product" SET "productGroupId" = $1 WHERE "productGroupId" = $2',
                    target_id, source_id
                )
                
                # Update target group metadata
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
                    target_id,
                )
                
                # Delete source group
                await conn.execute(
                    'DELETE FROM "ProductGroup" WHERE id = $1', source_id
                )
                
                merged_groups.add(source_id)
                logger.info(f"Merged group '{source_group['normalizedName']}' into '{target_group['normalizedName']}'")
                
            except Exception as e:
                logger.error(f"Error merging groups {source_id} -> {target_id}: {e}")

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

    async def reprocess_all_products(self):
        """Reprocess all products with new grouping logic"""
        logger.info("Reprocessing all products with new grouping logic")
        
        async with self.pool.acquire() as conn:
            # Reset processing status
            await conn.execute('UPDATE "Product" SET "processedAt" = NULL')
            
            # Clear existing groups
            await conn.execute('DELETE FROM "ProductGroup"')
            
        # Process with new logic
        await self.process_products()
        
        logger.info("All products reprocessed with enhanced grouping")

    async def analyze_grouping_effectiveness(self):
        """Analyze how well the grouping is working"""
        logger.info("Analyzing grouping effectiveness")
        
        async with self.pool.acquire() as conn:
            # Get grouping statistics
            stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_products,
                    COUNT(DISTINCT "productGroupId") as total_groups,
                    AVG(pg."productCount") as avg_products_per_group,
                    COUNT(DISTINCT p."vendorId") as total_vendors,
                    AVG(vendor_counts.vendor_count) as avg_vendors_per_group
                FROM "Product" p
                JOIN "ProductGroup" pg ON p."productGroupId" = pg.id
                JOIN (
                    SELECT 
                        "productGroupId",
                        COUNT(DISTINCT "vendorId") as vendor_count
                    FROM "Product"
                    GROUP BY "productGroupId"
                ) vendor_counts ON vendor_counts."productGroupId" = pg.id
            """)
            
            # Get top groups by product count
            top_groups = await conn.fetch("""
                SELECT 
                    pg."normalizedName",
                    pg."productCount",
                    COUNT(DISTINCT p."vendorId") as vendor_count,
                    MIN(p.price) as min_price,
                    MAX(p.price) as max_price
                FROM "ProductGroup" pg
                JOIN "Product" p ON p."productGroupId" = pg.id
                GROUP BY pg.id, pg."normalizedName", pg."productCount"
                ORDER BY pg."productCount" DESC
                LIMIT 10
            """)
            
            logger.info(f"Grouping Statistics:")
            logger.info(f"  Total products: {stats['total_products']}")
            logger.info(f"  Total groups: {stats['total_groups']}")
            logger.info(f"  Avg products per group: {stats['avg_products_per_group']:.2f}")
            logger.info(f"  Avg vendors per group: {stats['avg_vendors_per_group']:.2f}")
            
            logger.info(f"\nTop 10 groups by product count:")
            for group in top_groups:
                price_range = f"${group['min_price']:.2f} - ${group['max_price']:.2f}"
                logger.info(f"  {group['normalizedName']}: {group['product_count']} products, {group['vendor_count']} vendors, {price_range}")
