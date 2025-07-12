import asyncpg
from typing import List, Dict, Set, Optional, Any
import re
import json
from collections import defaultdict, Counter
from rapidfuzz import fuzz, process
import logging

logger = logging.getLogger(__name__)


class QueryEnhancer:
    """Enhanced search query processing for pharmacy products"""
    
    def __init__(self, db_url: str):
        self.db_url = db_url
        self.pool: asyncpg.pool.Pool
        
        # Pharmacy-specific synonyms and expansions
        self.synonyms = {
            # Common pharmacy terms
            'vitamin': ['vitamini', 'vitamine', 'vit'],
            'protein': ['proteini', 'protein', 'whey'],
            'omega': ['omega3', 'omega-3', 'riblje ulje'],
            'magnesium': ['magnezijum', 'mg', 'magneziu'],
            'calcium': ['kalcijum', 'ca', 'kalcium'],
            'iron': ['gvožđe', 'fe', 'železo'],
            'zinc': ['cink', 'zn'],
            'probiotics': ['probiotik', 'probiotici', 'laktobacili'],
            'creatine': ['kreatin', 'creatina'],
            'collagen': ['kolagen', 'collagena'],
            'painkiller': ['lek za bol', 'analgetik', 'aspirin', 'ibuprofen'],
            'antibiotic': ['antibiotik', 'penicilin'],
            'antacid': ['antacid', 'za stomak', 'gastro'],
            'cough': ['kašalj', 'sirup za kašalj', 'expectorant'],
            'cold': ['prehlada', 'grip', 'nazeb'],
            'allergy': ['alergija', 'antihistaminik', 'cetirizin'],
            'diabetes': ['dijabetes', 'insulin', 'metformin'],
            'blood pressure': ['pritisak', 'hipertenzija', 'amlodipine'],
            'cholesterol': ['holesterol', 'statin', 'atorvastatin'],
            'baby': ['beba', 'novorođenče', 'baby', 'deca'],
            'kids': ['deca', 'dečiji', 'children', 'pediatric'],
            'elderly': ['stariji', 'senior', 'elderly'],
            'women': ['žene', 'ženski', 'women', 'female'],
            'men': ['muškarci', 'muški', 'men', 'male']
        }
        
        # Brand name variations
        self.brand_variations = {
            'johnson': ['johnson&johnson', 'j&j'],
            'bayer': ['bayer ag'],
            'pfizer': ['pfizer inc'],
            'gsk': ['glaxosmithkline'],
            'novartis': ['novartis ag'],
            'roche': ['f. hoffmann-la roche'],
        }
        
        # Common typos and corrections
        self.typo_corrections = {
            'vitmin': 'vitamin',
            'protien': 'protein',
            'omgea': 'omega',
            'magnezium': 'magnesium',
            'kalcium': 'calcium',
            'probiotik': 'probiotics',
            'kreatin': 'creatine',
            'kolagen': 'collagen',
        }
        
        # Search suggestion cache
        self._suggestion_cache = {}
        self._popular_searches = Counter()
        
    async def connect(self):
        """Initialize database connection"""
        self.pool = await asyncpg.create_pool(self.db_url)
        await self._build_suggestion_index()
        
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
            
    async def _build_suggestion_index(self):
        """Build search suggestion index from product data"""
        logger.info("Building search suggestion index...")
        
        async with self.pool.acquire() as conn:
            # Get popular product names, brands, and search tokens
            rows = await conn.fetch("""
                SELECT 
                    p.title,
                    p."normalizedName",
                    p."searchTokens",
                    b.name as brand_name,
                    COUNT(*) as product_count
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE p."processedAt" IS NOT NULL
                GROUP BY p.title, p."normalizedName", p."searchTokens", b.name
                HAVING COUNT(*) >= 1
                ORDER BY product_count DESC
                LIMIT 10000
            """)
            
            # Extract suggestions
            suggestions = set()
            for row in rows:
                # Add normalized names
                if row['normalizedName']:
                    suggestions.add(row['normalizedName'].lower().strip())
                
                # Add brand names
                if row['brand_name']:
                    suggestions.add(row['brand_name'].lower().strip())
                
                # Add search tokens
                if row['searchTokens']:
                    for token in row['searchTokens']:
                        if len(token) >= 3:  # Only meaningful tokens
                            suggestions.add(token.lower().strip())
            
            self.suggestions = sorted(list(suggestions))
            logger.info(f"Built suggestion index with {len(self.suggestions)} terms")
    
    def enhance_query(self, query: str) -> Dict[str, Any]:
        """Enhance search query with corrections, synonyms, and suggestions"""
        original_query = query.strip()
        enhanced_query = original_query.lower()
        
        enhancements = {
            'original_query': original_query,
            'corrected_query': enhanced_query,
            'synonyms_added': [],
            'typos_corrected': [],
            'suggestions': [],
            'expanded_terms': []
        }
        
        # 1. Correct typos
        enhanced_query, typos_corrected = self._correct_typos(enhanced_query)
        enhancements['typos_corrected'] = typos_corrected
        enhancements['corrected_query'] = enhanced_query
        
        # 2. Add synonyms and expand terms
        expanded_terms = self._expand_synonyms(enhanced_query)
        enhancements['synonyms_added'] = expanded_terms
        enhancements['expanded_terms'] = expanded_terms
        
        # 3. Generate suggestions
        suggestions = self._generate_suggestions(enhanced_query)
        enhancements['suggestions'] = suggestions
        
        return enhancements
    
    def _correct_typos(self, query: str) -> tuple:
        """Correct common typos in the query"""
        corrected_query = query
        corrections_made = []
        
        words = query.split()
        corrected_words = []
        
        for word in words:
            # Check exact typo corrections
            if word in self.typo_corrections:
                corrected_word = self.typo_corrections[word]
                corrected_words.append(corrected_word)
                corrections_made.append(f"{word} → {corrected_word}")
            else:
                # Use fuzzy matching for potential corrections
                if hasattr(self, 'suggestions') and self.suggestions and len(word) >= 3:
                    try:
                        matches = process.extract(word, self.suggestions, limit=1, score_cutoff=85)
                        if matches and len(matches) > 0 and len(matches[0]) >= 2:
                            suggested_word, score = matches[0][0], matches[0][1]
                            if score > 85 and suggested_word != word:
                                corrected_words.append(suggested_word)
                                corrections_made.append(f"{word} → {suggested_word}")
                            else:
                                corrected_words.append(word)
                        else:
                            corrected_words.append(word)
                    except Exception as e:
                        logger.warning(f"Error in fuzzy matching for word '{word}': {e}")
                        corrected_words.append(word)
                else:
                    corrected_words.append(word)
        
        corrected_query = ' '.join(corrected_words)
        return corrected_query, corrections_made
    
    def _expand_synonyms(self, query: str) -> List[str]:
        """Expand query with synonyms"""
        expanded_terms = []
        words = query.split()
        
        for word in words:
            # Check direct synonyms
            for main_term, synonyms in self.synonyms.items():
                if word == main_term or word in synonyms:
                    expanded_terms.extend([main_term] + synonyms)
                    break
            
            # Check brand variations
            for main_brand, variations in self.brand_variations.items():
                if word == main_brand or word in variations:
                    expanded_terms.extend([main_brand] + variations)
                    break
        
        return list(set(expanded_terms))  # Remove duplicates
    
    def _generate_suggestions(self, query: str, limit: int = 5) -> List[str]:
        """Generate search suggestions based on query"""
        if not hasattr(self, 'suggestions'):
            return []
        
        suggestions = []
        
        # 1. Exact prefix matches (highest priority)
        prefix_matches = [s for s in self.suggestions if s.startswith(query)]
        suggestions.extend(prefix_matches[:limit])
        
        # 2. Fuzzy matches if we need more suggestions
        if len(suggestions) < limit:
            remaining_limit = limit - len(suggestions)
            try:
                fuzzy_matches = process.extract(
                    query, 
                    self.suggestions, 
                    limit=remaining_limit * 2,  # Get more to filter
                    score_cutoff=60
                )
                
                # Filter out already included suggestions
                for match_result in fuzzy_matches:
                    if len(match_result) >= 2:
                        match, score = match_result[0], match_result[1]
                        if match not in suggestions and len(suggestions) < limit:
                            suggestions.append(match)
            except Exception as e:
                logger.warning(f"Error in fuzzy suggestions for query '{query}': {e}")
        
        return suggestions[:limit]
    
    async def get_related_searches(self, query: str, limit: int = 5) -> List[str]:
        """Get related searches based on product data"""
        async with self.pool.acquire() as conn:
            # Find products matching the query
            matching_products = await conn.fetch("""
                SELECT DISTINCT
                    p."searchTokens",
                    b.name as brand_name,
                    p."normalizedName"
                FROM "Product" p
                LEFT JOIN "Brand" b ON p."brandId" = b.id
                WHERE 
                    p.title ILIKE $1 OR
                    p."normalizedName" ILIKE $1 OR
                    b.name ILIKE $1 OR
                    $2 = ANY(p."searchTokens")
                LIMIT 100
            """, f'%{query}%', query.lower())
            
            # Extract related terms
            related_terms = set()
            for row in matching_products:
                if row['brand_name']:
                    related_terms.add(row['brand_name'].lower())
                if row['normalizedName']:
                    # Extract key terms from normalized names
                    words = re.findall(r'\b\w{3,}\b', row['normalizedName'].lower())
                    related_terms.update(words)
                if row['searchTokens']:
                    related_terms.update([t.lower() for t in row['searchTokens'] if len(t) >= 3])
            
            # Remove the original query terms
            query_words = set(query.lower().split())
            related_terms = related_terms - query_words
            
            # Return most relevant related terms
            return list(related_terms)[:limit]
    
    async def suggest_query_completions(self, partial_query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Suggest query completions for autocomplete"""
        if len(partial_query) < 2:
            return []
        
        async with self.pool.acquire() as conn:
            # Get completions from product titles and brands
            rows = await conn.fetch("""
                SELECT 
                    suggestion,
                    COUNT(*) as frequency
                FROM (
                    SELECT 
                        CASE 
                            WHEN p.title ILIKE $1 THEN p.title
                            WHEN p."normalizedName" ILIKE $1 THEN p."normalizedName"
                            WHEN b.name ILIKE $1 THEN b.name
                            ELSE NULL
                        END as suggestion
                    FROM "Product" p
                    LEFT JOIN "Brand" b ON p."brandId" = b.id
                    WHERE 
                        p.title ILIKE $1 OR
                        p."normalizedName" ILIKE $1 OR
                        b.name ILIKE $1
                ) sub
                WHERE suggestion IS NOT NULL
                GROUP BY suggestion
                ORDER BY frequency DESC, suggestion
                LIMIT $2
            """, f'{partial_query}%', limit)
            
            suggestions = []
            for row in rows:
                suggestions.append({
                    'text': row['suggestion'],
                    'frequency': row['frequency'],
                    'type': 'completion'
                })
            
            return suggestions