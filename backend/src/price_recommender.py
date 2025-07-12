import asyncpg
from typing import List, Dict, Optional, Any, Tuple
import json
import logging
from datetime import datetime, timedelta
from collections import defaultdict
import statistics

logger = logging.getLogger(__name__)


class PriceRecommender:
    """Price-aware recommendations for pharmacy products"""
    
    def __init__(self, db_url: str):
        self.db_url = db_url
        self.pool: asyncpg.pool.Pool
        
    async def connect(self):
        """Initialize database connection"""
        self.pool = await asyncpg.create_pool(self.db_url)
        
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
    
    async def find_better_deals(self, product_id: str, similarity_threshold: float = 0.8) -> List[Dict[str, Any]]:
        """Find better deals for similar products"""
        async with self.pool.acquire() as conn:
            # Get the target product details
            target_product = await conn.fetchrow("""
                SELECT 
                    p.*,
                    b.name as brand_name,
                    v.name as vendor_name
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                LEFT JOIN "Vendor" v ON p."vendorId" = v.id
                WHERE p.id = $1
            """, product_id)
            
            if not target_product:
                return []
            
            # Find similar products with better prices
            similar_products = await conn.fetch("""
                SELECT 
                    p.*,
                    b.name as brand_name,
                    v.name as vendor_name,
                    GREATEST(
                        similarity(p.title, $2),
                        similarity(p."normalizedName", $2),
                        CASE WHEN b.name = $3 THEN 1.0 ELSE similarity(COALESCE(b.name, ''), $3) END
                    ) as similarity_score
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                LEFT JOIN "Vendor" v ON p."vendorId" = v.id
                WHERE 
                    p.id != $1
                    AND p.price < $4
                    AND (
                        similarity(p.title, $2) > $5 OR
                        similarity(p."normalizedName", $2) > $5 OR
                        b.name = $3 OR
                        (b.name IS NOT NULL AND similarity(b.name, $3) > 0.7)
                    )
                ORDER BY similarity_score DESC, p.price ASC
                LIMIT 10
            """, 
            product_id,
            target_product['title'],
            target_product['brand_name'] or '',
            target_product['price'],
            similarity_threshold
            )
            
            better_deals = []
            for product in similar_products:
                savings = float(target_product['price']) - float(product['price'])
                savings_percentage = (savings / float(target_product['price'])) * 100
                
                better_deals.append({
                    'product': {
                        'id': product['id'],
                        'title': product['title'],
                        'price': float(product['price']),
                        'vendor_name': product['vendor_name'],
                        'brand_name': product['brand_name'],
                        'link': product['link'],
                        'thumbnail': product['thumbnail']
                    },
                    'savings': {
                        'amount': round(savings, 2),
                        'percentage': round(savings_percentage, 1)
                    },
                    'similarity_score': float(product['similarity_score']),
                    'recommendation_reason': self._get_recommendation_reason(
                        target_product, product, savings_percentage
                    )
                })
            
            return better_deals
    
    async def suggest_cheaper_alternatives(self, search_query: str, price_limit: Optional[float] = None) -> List[Dict[str, Any]]:
        """Suggest cheaper alternatives for a search query"""
        async with self.pool.acquire() as conn:
            # Get products matching the search query
            base_query = """
                SELECT 
                    p.*,
                    b.name as brand_name,
                    v.name as vendor_name
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                LEFT JOIN "Vendor" v ON p."vendorId" = v.id
                WHERE 
                    p.title ILIKE $1 OR
                    p."normalizedName" ILIKE $1 OR
                    b.name ILIKE $1 OR
                    $2 = ANY(p."searchTokens")
            """
            
            params = [f'%{search_query}%', search_query.lower()]
            
            if price_limit:
                base_query += " AND p.price <= $3"
                params.append(price_limit)
            
            base_query += " ORDER BY p.price ASC LIMIT 20"
            
            products = await conn.fetch(base_query, *params)
            
            if not products:
                return []
            
            # Calculate price statistics
            prices = [float(p['price']) for p in products]
            avg_price = statistics.mean(prices)
            median_price = statistics.median(prices)
            
            alternatives = []
            for product in products:
                price = float(product['price'])
                
                # Focus on products below average price
                if price <= avg_price:
                    price_percentile = (sorted(prices).index(price) + 1) / len(prices) * 100
                    
                    alternatives.append({
                        'product': {
                            'id': product['id'],
                            'title': product['title'],
                            'price': price,
                            'vendor_name': product['vendor_name'],
                            'brand_name': product['brand_name'],
                            'link': product['link'],
                            'thumbnail': product['thumbnail']
                        },
                        'price_analysis': {
                            'vs_average': round(price - avg_price, 2),
                            'vs_median': round(price - median_price, 2),
                            'percentile': round(price_percentile, 1),
                            'is_bargain': price <= avg_price * 0.8
                        },
                        'recommendation_reason': self._get_alternative_reason(price, avg_price, price_percentile)
                    })
            
            return alternatives[:10]
    
    async def track_price_drops(self, product_ids: List[str], days_back: int = 30) -> List[Dict[str, Any]]:
        """Track price drops for specified products (simulated - would need price history table)"""
        # Note: This is a simplified implementation. In a real system, you'd have a price history table
        async with self.pool.acquire() as conn:
            price_alerts = []
            
            for product_id in product_ids:
                # Get current product info
                product = await conn.fetchrow("""
                    SELECT 
                        p.*,
                        b.name as brand_name,
                        v.name as vendor_name
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    LEFT JOIN "Vendor" v ON p."vendorId" = v.id
                    WHERE p.id = $1
                """, product_id)
                
                if product:
                    # Find similar products to estimate if this is a good deal
                    similar_prices = await conn.fetch("""
                        SELECT p.price
                        FROM "Product" p
                        LEFT JOIN "Brand" b ON p."brandId" = b.id
                        WHERE 
                            p.id != $1
                            AND (
                                similarity(p."normalizedName", $2) > 0.7 OR
                                b.name = $3
                            )
                        ORDER BY similarity(p."normalizedName", $2) DESC
                        LIMIT 10
                    """, product_id, product['normalizedName'], product['brand_name'])
                    
                    if similar_prices:
                        similar_price_values = [float(p['price']) for p in similar_prices]
                        avg_similar_price = statistics.mean(similar_price_values)
                        current_price = float(product['price'])
                        
                        if current_price < avg_similar_price * 0.9:  # 10% below average
                            savings = avg_similar_price - current_price
                            savings_percentage = (savings / avg_similar_price) * 100
                            
                            price_alerts.append({
                                'product': {
                                    'id': product['id'],
                                    'title': product['title'],
                                    'price': current_price,
                                    'vendor_name': product['vendor_name'],
                                    'brand_name': product['brand_name'],
                                    'link': product['link'],
                                    'thumbnail': product['thumbnail']
                                },
                                'alert_type': 'good_deal',
                                'savings': {
                                    'amount': round(savings, 2),
                                    'percentage': round(savings_percentage, 1)
                                },
                                'message': f"Great deal! {savings_percentage:.1f}% below average price"
                            })
            
            return price_alerts
    
    async def get_price_comparison_insights(self, product_group_id: str) -> Dict[str, Any]:
        """Get detailed price insights for a product group"""
        async with self.pool.acquire() as conn:
            # For dynamic groups, we'll analyze based on similar products
            # This is a simplified approach - in a real system you'd have actual group tables
            
            products = await conn.fetch("""
                SELECT 
                    p.*,
                    b.name as brand_name,
                    v.name as vendor_name
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                LEFT JOIN "Vendor" v ON p."vendorId" = v.id
                WHERE p."normalizedName" IS NOT NULL
                ORDER BY p.price
                LIMIT 50
            """)
            
            if not products:
                return {}
            
            prices = [float(p['price']) for p in products]
            
            insights = {
                'price_statistics': {
                    'min_price': min(prices),
                    'max_price': max(prices),
                    'avg_price': statistics.mean(prices),
                    'median_price': statistics.median(prices),
                    'price_range': max(prices) - min(prices),
                    'std_deviation': statistics.stdev(prices) if len(prices) > 1 else 0
                },
                'vendor_analysis': self._analyze_vendor_pricing(products),
                'deal_recommendations': self._find_best_deals(products),
                'price_distribution': self._get_price_distribution(prices)
            }
            
            return insights
    
    def _get_recommendation_reason(self, target_product: Dict, alternative_product: Dict, savings_percentage: float) -> str:
        """Generate recommendation reason text"""
        if alternative_product['brand_name'] == target_product['brand_name']:
            return f"Same brand, {savings_percentage:.1f}% cheaper at {alternative_product['vendor_name']}"
        elif savings_percentage > 30:
            return f"Huge savings! {savings_percentage:.1f}% cheaper alternative"
        elif savings_percentage > 15:
            return f"Great deal: {savings_percentage:.1f}% savings"
        else:
            return f"Similar product, {savings_percentage:.1f}% less expensive"
    
    def _get_alternative_reason(self, price: float, avg_price: float, percentile: float) -> str:
        """Generate alternative recommendation reason"""
        if price <= avg_price * 0.7:
            return f"Excellent value - {percentile:.0f}th percentile pricing"
        elif price <= avg_price * 0.85:
            return f"Good deal - below average price"
        else:
            return f"Budget option - {percentile:.0f}% of products cost more"
    
    def _analyze_vendor_pricing(self, products: List[Dict]) -> Dict[str, Any]:
        """Analyze pricing patterns by vendor"""
        vendor_prices = defaultdict(list)
        
        for product in products:
            vendor_prices[product['vendor_name']].append(float(product['price']))
        
        vendor_analysis = {}
        for vendor, prices in vendor_prices.items():
            if len(prices) >= 2:  # Only analyze vendors with multiple products
                vendor_analysis[vendor] = {
                    'avg_price': round(statistics.mean(prices), 2),
                    'product_count': len(prices),
                    'price_range': {
                        'min': min(prices),
                        'max': max(prices)
                    }
                }
        
        # Rank vendors by average price
        sorted_vendors = sorted(
            vendor_analysis.items(), 
            key=lambda x: x[1]['avg_price']
        )
        
        return {
            'vendor_rankings': sorted_vendors,
            'cheapest_vendor': sorted_vendors[0][0] if sorted_vendors else None,
            'most_expensive_vendor': sorted_vendors[-1][0] if sorted_vendors else None
        }
    
    def _find_best_deals(self, products: List[Dict]) -> List[Dict[str, Any]]:
        """Find the best deals from the product list"""
        prices = [float(p['price']) for p in products]
        avg_price = statistics.mean(prices)
        
        best_deals = []
        for product in products:
            price = float(product['price'])
            if price <= avg_price * 0.8:  # 20% below average
                savings_vs_avg = avg_price - price
                savings_percentage = (savings_vs_avg / avg_price) * 100
                
                best_deals.append({
                    'product': {
                        'id': product['id'],
                        'title': product['title'],
                        'price': price,
                        'vendor_name': product['vendor_name'],
                        'brand_name': product['brand_name']
                    },
                    'deal_score': savings_percentage,
                    'savings_vs_average': round(savings_vs_avg, 2)
                })
        
        return sorted(best_deals, key=lambda x: x['deal_score'], reverse=True)[:5]
    
    def _get_price_distribution(self, prices: List[float]) -> Dict[str, Any]:
        """Get price distribution quartiles"""
        sorted_prices = sorted(prices)
        n = len(sorted_prices)
        
        return {
            'quartiles': {
                'q1': sorted_prices[n // 4] if n >= 4 else sorted_prices[0],
                'q2': statistics.median(sorted_prices),
                'q3': sorted_prices[3 * n // 4] if n >= 4 else sorted_prices[-1]
            },
            'percentiles': {
                '10th': sorted_prices[n // 10] if n >= 10 else sorted_prices[0],
                '90th': sorted_prices[9 * n // 10] if n >= 10 else sorted_prices[-1]
            }
        }