import asyncpg
from typing import List, Dict, Optional, Any
import json
import logging
import os
import hashlib
import asyncio
import re
from functools import lru_cache
from rapidfuzz import fuzz
from collections import defaultdict

try:
    from .product_processor import EnhancedProductProcessor
    from .preprocessor import preprocessor
    from .ml_preprocessor import get_ml_preprocessor
except ImportError:
    from product_processor import EnhancedProductProcessor
    from preprocessor import preprocessor
    from ml_preprocessor import get_ml_preprocessor

logger = logging.getLogger(__name__)


class PharmaSearchEngine:
    """Search engine for pharmaceutical products"""

    def __init__(self, db_url: str, cache_dir: str = "backend/cache"):
        self.db_url = db_url
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.pool: asyncpg.pool.Pool
        self._search_cache = {}
        self._cache_stats = {"hits": 0, "misses": 0}

    async def connect(self):
        """Initialize connection"""
        self.pool = await asyncpg.create_pool(self.db_url)
        await self._process_products_if_needed()


    async def disconnect(self):
        """Close connections"""
        if self.pool:
            await self.pool.close()
    
    def _get_cache_key(self, query: str, filters: Optional[Dict], limit: int, offset: int, search_type: str) -> str:
        """Generate cache key for search results"""
        key_data = {
            "query": query.lower().strip(),
            "filters": filters or {},
            "limit": limit,
            "offset": offset,
            "search_type": search_type
        }
        return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()
    
    def _is_cache_valid(self, cache_entry: Dict, max_age: int = 300) -> bool:
        """Check if cache entry is still valid (default 5 minutes)"""
        import time
        return time.time() - cache_entry.get("timestamp", 0) < max_age

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
                await processor.process_products(batch_size=20000)
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
        """Search for products with caching

        Args:
            query: Search query
            filters: Optional filters (price, vendor, brand)
            group_results: Whether to group results by product
            limit: Maximum results to return
            offset: Offset for pagination
            force_db_search: Force database search instead of similarity search
        """
        
        # Generate cache key
        search_type = "db" if force_db_search else "hybrid"
        cache_key = self._get_cache_key(query, filters, limit, offset, search_type)
        
        # Check cache
        if cache_key in self._search_cache:
            cache_entry = self._search_cache[cache_key]
            if self._is_cache_valid(cache_entry):
                self._cache_stats["hits"] += 1
                logger.debug(f"Cache hit for query: {query} (hit rate: {self._cache_stats['hits']/(self._cache_stats['hits']+self._cache_stats['misses']):.2%})")
                return cache_entry["result"]
            else:
                # Remove expired cache entry
                del self._search_cache[cache_key]
        
        self._cache_stats["misses"] += 1
        
        # Execute search using database only
        if group_results:
            result = await self._db_search_groups_enhanced(query, filters, limit, offset)
        else:
            result = await self._search_products(query, filters, limit, offset)
        
        # Cache result
        import time
        self._search_cache[cache_key] = {
            "result": result,
            "timestamp": time.time()
        }
        
        # Clean old cache entries (keep only last 1000 entries)
        if len(self._search_cache) > 1000:
            old_keys = list(self._search_cache.keys())[:-500]
            for key in old_keys:
                del self._search_cache[key]
        
        return result

    async def _db_search_groups_enhanced(
        self, query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Enhanced database search with dynamic grouping"""

        query_lower = query.lower().strip()
        query_len = len(query_lower)
        query_words = query_lower.split()
        is_specific_product_query = len(query_words) >= 3 and any(len(word) > 2 for word in query_words)

        # Get exact matches using enhanced scoring - but return products, not groups
        exact_matches = await self._get_exact_matches(query_lower, limit)
        
        logger.info(f"Database search found {len(exact_matches)} matches for query: '{query}'")

        if not exact_matches:
            # Fallback: try more relaxed search for very short queries
            if query_len <= 3:
                return await self._fallback_short_query_search(query_lower, filters, limit, offset)
            return {"groups": [], "total": 0, "offset": offset, "limit": limit}

        # NEW: Dynamic grouping on search results
        return await self._create_dynamic_groups(
            exact_matches, query_lower, filters, limit, offset
        )

    async def _get_exact_matches(self, query: str, limit: int = 100) -> List[str]:
        """Get product IDs that match the query exactly or as a whole word - OPTIMIZED with preprocessor"""
        async with self.pool.acquire() as conn:
            query_len = len(query.strip())
            query_words = query.lower().split()
            is_specific_product_query = len(query_words) >= 3 and any(len(word) > 2 for word in query_words)

            # Limit results early to reduce grouping overhead
            search_limit = min(limit * 5, 300)  # Much smaller limit
            
            # Use preprocessor to enhance query
            query_identity = preprocessor.preprocess_product(query)
            enhanced_tokens = query_identity.search_tokens
            
            if query_len <= 3:
                # Use the optimized search function for short queries with enhanced tokens
                rows = await conn.fetch(
                    """
                    SELECT id, relevance_score as priority_score
                    FROM fast_product_search($1::text, NULL, NULL, NULL, NULL, $2::integer)
                    ORDER BY relevance_score DESC
                    """,
                    query, search_limit
                )
                
                # Also search with enhanced tokens if different from original
                if enhanced_tokens and any(token not in query.lower() for token in enhanced_tokens):
                    for token in enhanced_tokens[:3]:  # Limit to avoid too many queries
                        if token != query.lower():
                            enhanced_rows = await conn.fetch(
                                """
                                SELECT id, relevance_score as priority_score
                                FROM fast_product_search($1::text, NULL, NULL, NULL, NULL, $2::integer)
                                ORDER BY relevance_score DESC
                                """,
                                token, search_limit // 3
                            )
                            rows.extend(enhanced_rows)
            else:
                # Use the optimized search function for all longer queries
                rows = await conn.fetch(
                    """
                    SELECT id, relevance_score
                    FROM fast_product_search($1::text, NULL, NULL, NULL, NULL, $2::integer)
                    ORDER BY relevance_score DESC
                    """,
                    query, search_limit
                )

            # Remove duplicates while preserving order
            seen = set()
            unique_ids = []
            for row in rows:
                product_id = row["id"]
                if product_id not in seen:
                    seen.add(product_id)
                    unique_ids.append(product_id)

            return unique_ids

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

    async def _fallback_short_query_search(self, query: str, filters: Optional[Dict], limit: int, offset: int) -> Dict[str, Any]:
        """Fallback search for very short queries using trigrams and looser threshold"""

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT p.id,
                    p.title,
                    p."normalizedName"
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
                    -- Character-level similarity for very short queries
                    similarity(p."normalizedName", $1) > 0.2 OR
                    similarity(p.title, $1) > 0.2
                ORDER BY
                    -- Prioritize by position of match
                    CASE
                        WHEN p.title ILIKE ($1 || '%') THEN 1
                        WHEN p."normalizedName" ILIKE ($1 || '%') THEN 2
                        WHEN position($1 in lower(p.title)) <= 5 THEN 3
                        ELSE 4
                    END,
                    p.id
                """,
                query,
            )

            product_ids = [row["id"] for row in rows]

            if not product_ids:
                return {"groups": [], "total": 0, "offset": offset, "limit": limit}

            # Use dynamic grouping for fallback search too
            return await self._create_dynamic_groups(
                product_ids, query, filters, limit, offset
            )

    async def _create_dynamic_groups(
        self, product_ids: List[str], query: str, filters: Optional[Dict], limit: int, offset: int
    ) -> Dict[str, Any]:
        """Create dynamic groups from search results based on query context"""
        
        async with self.pool.acquire() as conn:
            # Get product details for grouping
            products = await conn.fetch(
                """
                SELECT 
                    p.id,
                    p.title,
                    p."normalizedName",
                    p.price,
                    p."vendorId",
                    v.name as vendor_name,
                    p.link,
                    p.thumbnail,
                    b.name as brand_name
                FROM "Product" p
                JOIN "Vendor" v ON v.id = p."vendorId"
                LEFT JOIN "Brand" b ON b.id = p."brandId"
                WHERE p.id = ANY($1::text[])
                  AND ($2::numeric IS NULL OR p.price >= $2)
                  AND ($3::numeric IS NULL OR p.price <= $3)
                  AND ($4::text[] IS NULL OR p."vendorId" = ANY($4))
                  AND ($5::text[] IS NULL OR p."brandId" = ANY($5))
                ORDER BY p.price
                """,
                product_ids,
                filters.get("min_price") if filters else None,
                filters.get("max_price") if filters else None,
                filters.get("vendor_ids") if filters else None,
                filters.get("brand_ids") if filters else None,
            )

            if not products:
                return {"groups": [], "total": 0, "offset": offset, "limit": limit}

            # Dynamic grouping logic - preserve search order
            groups = self._group_products_dynamically(products, query, product_ids)
            
            # Apply pagination to groups
            total_groups = len(groups)
            paginated_groups = groups[offset:offset + limit]
            
            logger.info(f"Dynamic grouping created {total_groups} groups from {len(products)} products")
            
            return {
                "groups": paginated_groups,
                "total": total_groups,
                "offset": offset,
                "limit": limit,
                "search_type_used": "dynamic"
            }

    def _group_products_dynamically(self, products: List[Dict], query: str, product_ids: List[str]) -> List[Dict]:
        """Improved dynamic grouping with preprocessor-enhanced similarity matching"""
        
        if not products:
            return []
        
        # Use preprocessor for enhanced grouping
        return self._group_products_with_preprocessor(products, query, product_ids)
    
    def _group_products_with_preprocessor(self, products: List[Dict], query: str, product_ids: List[str]) -> List[Dict]:
        """Group products using the advanced preprocessor and ML for better accuracy"""
        
        if not products:
            return []
        
        # Try ML-enhanced clustering first
        ml_preprocessor = get_ml_preprocessor()
        if ml_preprocessor:
            try:
                ml_clusters = ml_preprocessor.get_ml_clusters(product_ids, eps=0.15, min_samples=2)
                if ml_clusters:
                    logger.info(f"ML clustering found {len(ml_clusters)} clusters")
                    return self._create_groups_from_ml_clusters(products, ml_clusters, product_ids)
            except Exception as e:
                logger.warning(f"ML clustering failed, falling back to rule-based: {e}")
        
        # Fallback to rule-based grouping with ML similarity where available
        return self._group_products_hybrid(products, query, product_ids)
        
    def _create_groups_from_ml_clusters(self, products: List[Dict], ml_clusters: Dict, product_ids: List[str]) -> List[Dict]:
        """Create groups from ML clustering results"""
        
        # Create product lookup
        product_lookup = {p.get('id'): p for p in products}
        
        final_groups = []
        unclustered_products = list(products)
        
        # Process each ML cluster
        for cluster_id, cluster_product_ids in ml_clusters.items():
            cluster_products = []
            
            for product_id in cluster_product_ids:
                if product_id in product_lookup:
                    product = product_lookup[product_id]
                    cluster_products.append(product)
                    
                    # Remove from unclustered
                    if product in unclustered_products:
                        unclustered_products.remove(product)
            
            if cluster_products:
                # Create group from cluster
                group = self._create_group_from_products(cluster_products, product_ids, f"ml_cluster_{cluster_id}")
                final_groups.append(group)
        
        # Handle unclustered products (create individual groups)
        for product in unclustered_products:
            group = self._create_group_from_products([product], product_ids, f"single_{product.get('id', 'unknown')}")
            final_groups.append(group)
        
        # Sort groups by relevance
        final_groups.sort(key=lambda x: (x.get("search_rank", 999), -x["vendor_count"]))
        
        return final_groups
    
    def _group_products_hybrid(self, products: List[Dict], query: str, product_ids: List[str]) -> List[Dict]:
        """Hybrid grouping using both rule-based and ML similarity"""
        
        # Preprocess all products to extract structured identities
        product_identities = []
        for product in products:
            title = product.get('title', '')
            brand = product.get('brand_name', '')
            
            identity = preprocessor.preprocess_product(title, brand)
            product_identities.append({
                'product': product,
                'identity': identity,
                'grouping_key': identity.grouping_key
            })
        
        # Group by similar grouping keys with ML enhancement
        groups_dict = defaultdict(list)
        ungrouped = []
        ml_preprocessor = get_ml_preprocessor()
        
        for item in product_identities:
            key = item['grouping_key']
            product_id = item['product'].get('id')
            
            if not key:
                ungrouped.append(item)
                continue
            
            # Find existing group with similar key
            grouped = False
            for existing_key in groups_dict.keys():
                # First try rule-based similarity
                rule_based_similar = preprocessor.should_group_by_keys(key, existing_key, similarity_threshold=0.75)
                
                # Enhance with ML similarity if available
                ml_similar = False
                if ml_preprocessor and groups_dict[existing_key]:
                    existing_product_id = groups_dict[existing_key][0]['product'].get('id')
                    if existing_product_id and product_id:
                        ml_similar = ml_preprocessor.should_group_products_ml(product_id, existing_product_id, threshold=0.80)
                
                # Group if either method suggests similarity
                if rule_based_similar or ml_similar:
                    groups_dict[existing_key].append(item)
                    grouped = True
                    break
            
            if not grouped:
                groups_dict[key].append(item)
        
        # Handle ungrouped products with ML fallback
        for item in ungrouped:
            best_group_key = None
            best_similarity = 0
            product_id = item['product'].get('id')
            
            for group_key, group_items in groups_dict.items():
                if not group_items:
                    continue
                
                # Try ML similarity first
                if ml_preprocessor and product_id:
                    group_product_id = group_items[0]['product'].get('id')
                    if group_product_id:
                        ml_similarity = ml_preprocessor.compute_similarity(product_id, group_product_id)
                        if ml_similarity > best_similarity and ml_similarity > 0.7:
                            best_similarity = ml_similarity
                            best_group_key = group_key
                            continue
                
                # Fallback to text similarity
                product_title = item['product'].get('title', '')
                group_title = group_items[0]['product'].get('title', '')
                text_similarity = max(
                    fuzz.ratio(product_title.lower(), group_title.lower()),
                    fuzz.token_sort_ratio(product_title.lower(), group_title.lower()),
                    fuzz.token_set_ratio(product_title.lower(), group_title.lower())
                ) / 100.0
                
                if text_similarity > best_similarity and text_similarity > 0.7:
                    best_similarity = text_similarity
                    best_group_key = group_key
            
            if best_group_key:
                groups_dict[best_group_key].append(item)
            else:
                # Create new group for this product
                groups_dict[item['grouping_key'] or f"single_{item['product'].get('id', 'unknown')}"].append(item)
        
        # Convert to final group format
        final_groups = []
        
        for group_key, group_items in groups_dict.items():
            if not group_items:
                continue
            
            group_products = [item['product'] for item in group_items]
            group = self._create_group_from_products(group_products, product_ids, f"hybrid_{abs(hash(group_key))}")
            final_groups.append(group)
        
        # Sort groups by search relevance
        final_groups.sort(key=lambda x: (x.get("search_rank", 999), -x["vendor_count"]))
        
        return final_groups
    
    def _create_group_from_products(self, group_products: List[Dict], product_ids: List[str], group_id_prefix: str) -> Dict:
        """Create a group data structure from a list of products"""
        
        if not group_products:
            return {}
        
        # Sort by price
        group_products.sort(key=lambda x: float(x.get('price', 0)))
        
        # Generate group name
        if len(group_products) == 1:
            # Single product group
            product = group_products[0]
            identity = preprocessor.preprocess_product(product.get('title', ''), product.get('brand_name', ''))
            group_name = identity.normalized_name or product.get('title', 'Unknown Product')
        else:
            # Multi-product group - find most representative name
            titles = [p.get('title', '') for p in group_products]
            identities = [preprocessor.preprocess_product(title, p.get('brand_name', '')) for title, p in zip(titles, group_products)]
            group_name = self._generate_preprocessed_group_name(identities)
        
        # Extract dosage info
        dosage_value = None
        dosage_unit = None
        
        for product in group_products:
            identity = preprocessor.preprocess_product(product.get('title', ''), product.get('brand_name', ''))
            if identity.strength:
                strength_parts = identity.strength.split()
                if len(strength_parts) >= 2:
                    try:
                        dosage_value = float(strength_parts[0])
                        dosage_unit = strength_parts[1]
                        break
                    except (ValueError, IndexError):
                        continue
        
        prices = [float(p.get('price', 0)) for p in group_products if p.get('price')]
        
        # Calculate search rank
        search_rank = len(product_ids)  # Default to end
        if group_products:
            product_positions = {pid: idx for idx, pid in enumerate(product_ids)}
            first_product_pos = product_positions.get(group_products[0].get("id"), len(product_ids))
            search_rank = first_product_pos
        
        return {
            "id": group_id_prefix,
            "normalized_name": group_name,
            "products": [
                {
                    "id": p.get("id", ""),
                    "title": p.get("title", ""),
                    "price": float(p.get("price", 0)),
                    "vendor_id": p.get("vendorId", p.get("vendor_id", "")),
                    "vendor_name": p.get("vendor_name", ""),
                    "link": p.get("link", ""),
                    "thumbnail": p.get("thumbnail", ""),
                    "brand_name": p.get("brand_name", "")
                } for p in group_products
            ],
            "price_range": {
                "min": float(min(prices)) if prices else 0.0,
                "max": float(max(prices)) if prices else 0.0
            },
            "vendor_count": len(set(p.get("vendorId", p.get("vendor_id", "")) for p in group_products)),
            "product_count": len(group_products),
            "dosage_value": dosage_value,
            "dosage_unit": dosage_unit,
            "search_rank": search_rank
        }
    
    def _generate_preprocessed_group_name(self, identities: List) -> str:
        """Generate group name from preprocessed identities"""
        if not identities:
            return "Unknown Product"
        
        if len(identities) == 1:
            identity = identities[0]
            return identity.normalized_name or identity.base_name.title() or "Unknown Product"
        
        # Find most common normalized name
        normalized_names = [identity.normalized_name for identity in identities if identity.normalized_name]
        if normalized_names:
            name_counts = defaultdict(int)
            for name in normalized_names:
                name_counts[name] += 1
            return max(name_counts.items(), key=lambda x: x[1])[0]
        
        # Fallback to most common base name
        base_names = [identity.base_name for identity in identities if identity.base_name]
        if base_names:
            name_counts = defaultdict(int)
            for name in base_names:
                name_counts[name] += 1
            most_common_base = max(name_counts.items(), key=lambda x: x[1])[0]
            
            # Add common strength if present
            strengths = [identity.strength for identity in identities if identity.strength]
            if strengths:
                strength_counts = defaultdict(int)
                for strength in strengths:
                    strength_counts[strength] += 1
                common_strength = max(strength_counts.items(), key=lambda x: x[1])[0]
                return f"{most_common_base.title()} {common_strength}"
            
            return most_common_base.title()
        
        return "Unknown Product"

    def _normalize_product_name_for_grouping(self, name: str) -> str:
        """
        Normalize product name for grouping, being less aggressive to preserve product identity.
        """
        if not name:
            return ""
        
        # Convert to lowercase and strip
        normalized = name.lower().strip()
        
        # Only remove very specific brand prefixes, keep most brand info
        prefixes_pattern = r'^(abela\s+pharm\s*|dr\.\s*|prof\.\s*)'
        normalized = re.sub(prefixes_pattern, '', normalized, flags=re.IGNORECASE)
        
        # Remove registered trademark symbols and similar
        normalized = re.sub(r'[®™©]', '', normalized)
        
        # Standardize punctuation but keep hyphens and basic structure
        normalized = re.sub(r'[,\.\(\)\[\]\/\\]+', ' ', normalized)
        normalized = re.sub(r'\s+', ' ', normalized.strip())
        
        # Remove only obvious PACKAGING indicators, be more conservative
        packaging_patterns = [
            r'\b(a\d+)\b',  # a10, a30 - "a" followed by number (packaging count)
            r'\b(\d+)x(?!\d)\b',  # 10x, 30x - number followed by "x" but not 10x10 (size)
            r'\b\d+\s+(kom|komada|pack|box|pcs|pieces)\b',  # 10 kom, 30 komada (packaging count)
        ]
        
        for pattern in packaging_patterns:
            normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)
        
        # Remove promotional text but be less aggressive
        promo_patterns = [
            r'\b\d+\+\d+\s*gratis\b',
            r'\b(gratis|besplatno|bonus|akcija|popust|discount)\b',
        ]
        
        for pattern in promo_patterns:
            normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)
        
        # Keep more numbers - only remove standalone numbers that are clearly not dosage
        # Be more conservative about what we consider non-dosage numbers
        normalized = re.sub(r'\b\d+\b(?!\s*(mg|mcg|iu|µg|g|ml|l|%|mm|cm|kg|gram|miligram))', '', normalized)
        
        # Clean up extra whitespace
        normalized = re.sub(r'\s+', ' ', normalized.strip())
        
        return normalized

    def _extract_core_product_identity(self, name: str) -> Dict[str, str]:
        """
        Extract key components of product identity for sophisticated grouping.
        """
        normalized = self._normalize_product_name_for_grouping(name)
        original_lower = name.lower()
        
        identity = {
            'base_name': '',
            'variant': '',
            'strength': '',
            'form': '',
            'quantity': '',
            'full_identity': ''
        }
        
        # For probiotik enterobiotik, handle specially
        if 'probiotik' in original_lower and 'enterobiotik' in original_lower:
            identity['base_name'] = 'probiotik enterobiotik'
            
            # Check for variant in original name (before normalization removes it)
            variant_pattern = r'\b(forte|plus|max|ultra|premium|advanced|complex|complete|extra|special|imuno|junior)\b'
            variant_match = re.search(variant_pattern, original_lower)
            if variant_match:
                identity['variant'] = variant_match.group(1).lower()
        else:
            # For other products, extract base name more carefully
            # First remove dosage/strength info to get clean base name
            temp_name = re.sub(r'\b\d+(?:\.\d+)?\s*(mg|mcg|iu|g|ml|l|%)\b', '', normalized)
            temp_name = re.sub(r'\b\d+\s*(kesica|kesice|kapsula|kapsule|tableta|tablete)\b', '', temp_name)
            
            words = temp_name.split()
            # Take first 2-3 meaningful words as base name
            meaningful_words = [w for w in words if len(w) > 2][:3]
            identity['base_name'] = ' '.join(meaningful_words)
            
            # Extract variant
            variant_pattern = r'\b(forte|plus|max|ultra|premium|advanced|complex|complete|extra|special)\b'
            variant_match = re.search(variant_pattern, normalized)
            if variant_match:
                identity['variant'] = variant_match.group(1).lower()
        
        # Enhanced strength/dosage extraction
        strength_patterns = [
            r'\b(\d+(?:\.\d+)?)\s*(mg|mcg|iu|µg)\b',  # Standard dosage units
            r'\b(\d+(?:\.\d+)?)\s*g\b',  # Grams
            r'\b(\d+(?:\.\d+)?)\s*(ml|l)\b',  # Volume
            r'\b(\d+)\s*%\b',  # Percentage
            r'\b(\d+)\s*(k|mil|thousand|million|billion)\s*(iu|mg|mcg)?\b'  # Large numbers with units
        ]
        
        for pattern in strength_patterns:
            match = re.search(pattern, original_lower)
            if match:
                # Normalize the strength representation
                full_match = match.group(0).lower().strip()
                identity['strength'] = full_match
                break
        
        # Extract quantity/packaging count
        quantity_patterns = [
            r'\b(\d+)\s*(kesica|kesice)\b',  # sachets
            r'\b(\d+)\s*(kapsula|kapsule)\b',  # capsules
            r'\b(\d+)\s*(tableta|tablete|tbl)\b',  # tablets
            r'\b(\d+)\s*(kom)\b',  # pieces
            r'\ba(\d+)\b',  # a10, a30 format
            r'\b(\d+)x\b'  # 10x format
        ]
        
        for pattern in quantity_patterns:
            match = re.search(pattern, original_lower)
            if match:
                identity['quantity'] = match.group(1)  # Just the number
                break
        
        # Extract form from original name
        form_pattern = r'\b(kapsula|kapsule|tableta|tablete|sprej|kapi|sirup|gel|mast|krema|prah|caps|kesica|kesice)\b'
        form_match = re.search(form_pattern, original_lower)
        if form_match:
            identity['form'] = form_match.group(1).lower()
        
        # Create full identity for precise grouping
        identity_parts = []
        if identity['base_name']:
            identity_parts.append(identity['base_name'])
        if identity['variant']:
            identity_parts.append(identity['variant'])
        if identity['strength']:
            identity_parts.append(identity['strength'])
        if identity['form'] and identity['form'] not in ['kapsula', 'kapsule', 'tableta', 'tablete']:
            # Only include form if it's not a common tablet/capsule form
            identity_parts.append(identity['form'])
            
        identity['full_identity'] = ' '.join(identity_parts)
        
        return identity

    def _should_group_products(self, product1: Dict, product2: Dict, threshold: float = 0.70) -> bool:
        """
        Determine if two products should be grouped together using multiple criteria including dosage.
        """
        name1 = product1.get('title', '')
        name2 = product2.get('title', '')
        
        if not name1 or not name2:
            return False
        
        # First try simple normalized comparison for obvious matches
        norm1 = self._normalize_product_name_for_grouping(name1)
        norm2 = self._normalize_product_name_for_grouping(name2)
        
        # If normalized names are very similar, they should probably be grouped
        basic_similarity = max(
            fuzz.ratio(norm1, norm2),
            fuzz.token_sort_ratio(norm1, norm2),
            fuzz.token_set_ratio(norm1, norm2)
        )
        
        # Lower threshold for basic grouping - pharmaceutical names have many variations
        if basic_similarity >= 75:
            return True
        
        # Extract identities for more detailed analysis
        identity1 = self._extract_core_product_identity(name1)
        identity2 = self._extract_core_product_identity(name2)
        
        # Must have similar base product names (more lenient than before)
        if identity1['base_name'] and identity2['base_name']:
            base_similarity = fuzz.ratio(identity1['base_name'], identity2['base_name'])
            if base_similarity < 70:  # Reduced from 90
                return False
        
        # Allow different variants to be grouped (removed strict variant matching)
        # Products like "Vitamin D" and "Vitamin D3" should be grouped
        
        # Only separate different strengths/dosages if they're significantly different
        if identity1['strength'] and identity2['strength']:
            if identity1['strength'] != identity2['strength']:
                # Check if they're the same base strength (e.g., "500 mg" vs "500mg")
                strength1_clean = re.sub(r'\s+', '', identity1['strength'].lower())
                strength2_clean = re.sub(r'\s+', '', identity2['strength'].lower())
                if strength1_clean != strength2_clean:
                    return False
        
        # Allow different forms to be grouped unless they're very different
        # (tablets vs capsules should be grouped, but tablets vs syrup should not)
        significant_forms = {'sprej', 'kapi', 'sirup', 'gel', 'mast', 'krema', 'prah'}
        minor_forms = {'kapsula', 'kapsule', 'tableta', 'tablete', 'tbl', 'caps', 'kesica', 'kesice'}
        
        if (identity1['form'] in significant_forms and identity2['form'] in significant_forms and 
            identity1['form'] != identity2['form']):
            return False
        
        # Use normalized name similarity as final check with lower threshold
        return basic_similarity >= threshold

    def _generate_group_name(self, product_names: List[str]) -> str:
        """
        Generate a representative group name from multiple product names including dosage.
        """
        if not product_names:
            return "Unknown Product"
        
        if len(product_names) == 1:
            # For single product, use its identity for the group name
            identity = self._extract_core_product_identity(product_names[0])
            return identity.get('full_identity', product_names[0]).title()
        
        # Extract identities from all products to find common elements
        identities = [self._extract_core_product_identity(name) for name in product_names]
        
        # Find the most representative identity (most common full_identity)
        full_identity_counts = defaultdict(int)
        for identity in identities:
            if identity['full_identity']:
                full_identity_counts[identity['full_identity']] += 1
        
        if full_identity_counts:
            # Use the most common full identity
            most_common_identity = max(full_identity_counts.items(), key=lambda x: x[1])
            return most_common_identity[0].title()
        
        # Fallback: construct from most common components
        base_names = [identity['base_name'] for identity in identities if identity['base_name']]
        variants = [identity['variant'] for identity in identities if identity['variant']]
        strengths = [identity['strength'] for identity in identities if identity['strength']]
        
        # Most common base name
        if base_names:
            base_name = max(set(base_names), key=base_names.count)
        else:
            base_name = "Unknown Product"
        
        # Most common variant (if any)
        variant = max(set(variants), key=variants.count) if variants else ""
        
        # Most common strength (if any)
        strength = max(set(strengths), key=strengths.count) if strengths else ""
        
        # Construct group name
        name_parts = [base_name]
        if variant:
            name_parts.append(variant)
        if strength:
            name_parts.append(strength)
        
        return ' '.join(name_parts).title()

    def _extract_core_for_grouping(self, name: str, query: str, preserve_dosage: bool) -> str:
        """Extract core product identity for dynamic grouping with more granular criteria"""
        import re
        
        core = name.lower().strip()
        query_words = set(query.lower().split())
        
        # Preserve more distinguishing features for better grouping
        if preserve_dosage:
            # Keep numbers that appear in the query
            query_numbers = set()
            for word in query_words:
                numbers = re.findall(r'\d+', word)
                query_numbers.update(numbers)
            
            # Remove only numbers NOT in the query
            def replace_number(match):
                num = match.group()
                return num if num in query_numbers else ' '
            
            core = re.sub(r'\d+', replace_number, core)
        else:
            # For non-dosage queries, preserve size/age indicators for better grouping
            # Only remove generic numbers but keep size indicators
            core = re.sub(r'\b\d+(?!\s*(kg|g|mg|mcg|iu|ml|l|kom|komada|newborn|mini|midi|junior))\b', ' ', core)
        
        # Less aggressive noise removal to preserve more product distinctions
        noise_patterns = [
            # Remove only generic packaging indicators, keep size/age descriptors
            r'\b(kom|komada|pack|box|vp\d*|jp\d*|a\d+|mesečno|monthly)\b',
            # Remove some punctuation but keep hyphens for compound words
            r'[,\.\(\)\[\]\/\\]',
        ]
        
        for pattern in noise_patterns:
            core = re.sub(pattern, ' ', core, flags=re.IGNORECASE)
        
        # Clean up whitespace
        core = re.sub(r'\s+', ' ', core).strip()
        
        return core

    def _should_group_dynamically(self, core1: str, core2: str, query: str) -> bool:
        """Determine if two product cores should be grouped together with stricter criteria"""
        
        if not core1.strip() or not core2.strip():
            return False
            
        # Exact match
        if core1 == core2:
            return True
        
        # Calculate multiple similarity metrics
        similarity_ratio = fuzz.ratio(core1, core2)
        similarity_token_sort = fuzz.token_sort_ratio(core1, core2)
        similarity_token_set = fuzz.token_set_ratio(core1, core2)
        
        # Use the highest similarity score
        max_similarity = max(similarity_ratio, similarity_token_sort, similarity_token_set)
        
        # More conservative grouping to create more distinct groups
        query_lower = query.lower()
        query_specificity = len(query.split())
        
        # For brand name queries, be more selective to avoid overly broad groups
        brand_names = ['pampers', 'huggies', 'nivea', 'loreal', 'garnier', 'johnson', 'cetaphil', 'neutrogena']
        
        if query_lower in brand_names:
            if query_lower in core1.lower() and query_lower in core2.lower():
                # Check for specific distinguishing features
                core1_words = set(core1.split())
                core2_words = set(core2.split())
                
                # Look for size/age/type differences
                distinguishing_features = {
                    'newborn', 'mini', 'midi', 'junior', 'maxi', 'xl', 'xxl', 'xs', 's', 'm', 'l',
                    'pelene', 'gaćice', 'pants', 'care', 'protect', 'active', 'premium', 
                    'harmonie', 'sensitive', 'fresh', 'aqua', 'clean', 'dry', 'baby', 'adult',
                    'large', 'medium', 'small', 'extra', 'super', 'ultra', 'soft', 'comfort'
                }
                
                # If products have different distinguishing features, don't group them
                core1_features = core1_words & distinguishing_features
                core2_features = core2_words & distinguishing_features
                
                if core1_features != core2_features and (core1_features or core2_features):
                    # Only group if very high similarity AND overlapping features
                    return max_similarity >= 85 and len(core1_features & core2_features) > 0
                
                # For products without distinguishing features, use moderate threshold
                return max_similarity >= 80
        
        # More lenient thresholds to group similar products together
        if query_specificity <= 1:
            threshold = 70  # More lenient for single word queries
        elif query_specificity <= 2:
            threshold = 75  # Moderate for 2-word queries
        else:
            threshold = 80  # Still reasonable for specific queries
            
        return max_similarity >= threshold

    def _extract_enhanced_product_identity(self, name: str, query: str, preserve_dosage: bool) -> Dict:
        """Extract enhanced product identity with multiple criteria for better grouping"""
        import re
        
        original_name = name.lower().strip()
        
        # Extract key product attributes
        identity = {
            "core": "",
            "category": "",
            "size_age": "",
            "variant": "",
            "dosage_info": "",
            "brand": ""
        }
        
        # Extract brand information
        brand_patterns = [
            r'\b(pampers|huggies|nivea|loreal|garnier|johnson|cetaphil|neutrogena)\b'
        ]
        for pattern in brand_patterns:
            match = re.search(pattern, original_name, re.IGNORECASE)
            if match:
                identity["brand"] = match.group(1).lower()
                break
        
        # Extract category information
        category_patterns = {
            'diapers': r'\b(pelene|gaćice|pants|diaper)\b',
            'care': r'\b(care|protect|clean|sensitive|cream|lotion|oil|shampoo|gel)\b',
            'wipes': r'\b(wipes|vlažne|maramice)\b',
            'cosmetics': r'\b(makeup|foundation|mascara|lipstick|eyeshadow)\b',
            'skincare': r'\b(moisturizer|serum|toner|cleanser|mask)\b'
        }
        
        for category, pattern in category_patterns.items():
            if re.search(pattern, original_name, re.IGNORECASE):
                identity["category"] = category
                break
        
        # Extract size/age information
        size_age_patterns = [
            r'\b(newborn|mini|midi|junior|maxi|xl|xxl|xs|s|m|l|large|medium|small)\b',
            r'\b(\d+\s*(?:kg|g|mg|mcg|iu|ml|l))\b',
            r'\b(\d+\s*(?:kom|komada|pack))\b'
        ]
        
        size_age_parts = []
        for pattern in size_age_patterns:
            matches = re.findall(pattern, original_name, re.IGNORECASE)
            size_age_parts.extend(matches)
        
        identity["size_age"] = " ".join(size_age_parts).lower()
        
        # Extract product variant/type
        variant_patterns = [
            r'\b(active|premium|harmonie|fresh|aqua|dry|ultra|super|extra|soft|comfort)\b'
        ]
        
        variant_parts = []
        for pattern in variant_patterns:
            matches = re.findall(pattern, original_name, re.IGNORECASE)
            variant_parts.extend(matches)
        
        identity["variant"] = " ".join(variant_parts).lower()
        
        # Create core identity by combining key elements
        core_parts = []
        if identity["brand"]:
            core_parts.append(identity["brand"])
        if identity["category"]:
            core_parts.append(identity["category"])
        if identity["size_age"]:
            core_parts.append(identity["size_age"])
        if identity["variant"]:
            core_parts.append(identity["variant"])
        
        # If no structured extraction worked, fall back to cleaned name
        if not core_parts:
            core_parts = [self._extract_core_for_grouping(name, query, preserve_dosage)]
        
        identity["core"] = " ".join(core_parts)
        
        return identity
    
    def _should_group_enhanced(self, identity1: Dict, identity2: Dict, query: str) -> bool:
        """Enhanced grouping decision based on multiple product attributes"""
        
        # Exact core match
        if identity1["core"] == identity2["core"]:
            return True
        
        # Must have same brand if both have brands
        if identity1["brand"] and identity2["brand"] and identity1["brand"] != identity2["brand"]:
            return False
        
        # Must have same category if both have categories
        if identity1["category"] and identity2["category"] and identity1["category"] != identity2["category"]:
            return False
        
        # For multi-word queries, enforce stricter matching based on query words
        query_words = set(query.lower().split())
        if len(query_words) > 1:
            # Both products must contain the core distinguishing words from the query
            for query_word in query_words:
                if len(query_word) > 2:  # Skip very short words
                    core1_lower = identity1["core"].lower()
                    core2_lower = identity2["core"].lower()
                    
                    # Both products must contain this significant query word
                    if (query_word not in core1_lower) or (query_word not in core2_lower):
                        return False
        
        # For size/age sensitive products, must have compatible sizes
        if identity1["size_age"] and identity2["size_age"]:
            if identity1["size_age"] != identity2["size_age"]:
                # Allow some size flexibility within same category
                size_similarity = fuzz.ratio(identity1["size_age"], identity2["size_age"])
                if size_similarity < 70:
                    return False
        
        # Check core similarity
        core_similarity = max(
            fuzz.ratio(identity1["core"], identity2["core"]),
            fuzz.token_sort_ratio(identity1["core"], identity2["core"]),
            fuzz.token_set_ratio(identity1["core"], identity2["core"])
        )
        
        # More lenient grouping for enhanced identity matching
        query_specificity = len(query.split())
        if query_specificity <= 1:
            threshold = 65  # More lenient for single word queries
        elif query_specificity <= 2:
            threshold = 70  # Balanced for 2-word queries
        else:
            threshold = 75  # Reasonable for very specific queries
        
        return core_similarity >= threshold

