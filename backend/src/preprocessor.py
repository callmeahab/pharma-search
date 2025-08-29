"""
Product Preprocessing Module for Enhanced Search and Grouping
This module provides comprehensive preprocessing functions to standardize and normalize
product data for better search accuracy and grouping effectiveness.
"""

import re
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass
import unicodedata


@dataclass
class ProductIdentity:
    """Structured product identity extracted from preprocessing"""
    base_name: str
    brand: str
    strength: str
    form: str
    size: str
    variant: str
    category: str
    normalized_name: str
    search_tokens: List[str]
    grouping_key: str


class PharmaPreprocessor:
    """Advanced preprocessing for pharmaceutical products"""
    
    def __init__(self):
        self._init_mappings()
    
    def _init_mappings(self):
        """Initialize all mapping dictionaries"""
        
        # Brand name standardization
        self.brand_mappings = {
            'dr': 'dr.',
            'prof': 'prof.',
            'pharm': 'pharma',
            'laboratoires': 'laboratories',
            'lab': 'laboratories',
            'gmbh': '',
            'ltd': '',
            'inc': '',
            'co': 'company',
            'corp': 'corporation',
        }
        
        # Pharmaceutical form standardization
        self.form_mappings = {
            'tbl': 'tableta',
            'tab': 'tableta',
            'tabs': 'tablete',
            'caps': 'kapsula',
            'cap': 'kapsula',
            'cps': 'kapsula',
            'syr': 'sirup',
            'syrup': 'sirup',
            'sol': 'rastvor',
            'solution': 'rastvor',
            'susp': 'suspenzija',
            'suspension': 'suspenzija',
            'inj': 'injekcija',
            'injection': 'injekcija',
            'oint': 'mast',
            'ointment': 'mast',
            'cr': 'krema',
            'cream': 'krema',
            'gel': 'gel',
            'spray': 'sprej',
            'drops': 'kapi',
            'drop': 'kapi',
            'powder': 'prah',
            'pwd': 'prah',
        }
        
        # Dosage unit standardization
        self.dosage_mappings = {
            'mg': 'mg',
            'milligram': 'mg',
            'miligram': 'mg',
            'mcg': 'mcg',
            'µg': 'mcg',
            'microgram': 'mcg',
            'mikrogram': 'mcg',
            'g': 'g',
            'gram': 'g',
            'kg': 'kg',
            'kilogram': 'kg',
            'iu': 'iu',
            'i.u.': 'iu',
            'international unit': 'iu',
            'ml': 'ml',
            'milliliter': 'ml',
            'mililitr': 'ml',
            'l': 'l',
            'liter': 'l',
            'litr': 'l',
            '%': '%',
            'percent': '%',
            'procenat': '%',
        }
        
        # Common pharmaceutical synonyms
        self.synonym_mappings = {
            'vitamin': ['vit', 'vitam'],
            'calcium': ['calc', 'ca', 'kalcijum'],
            'magnesium': ['mag', 'mg', 'magnezijum'],
            'probiotic': ['prob', 'probiotik'],
            'omega': ['omega-3', 'omega3', 'n-3'],
            'coenzyme': ['coq', 'koenzim'],
            'acetaminophen': ['paracetamol', 'acetaminofen'],
            'ibuprofen': ['brufen', 'advil'],
            'ascorbic acid': ['vitamin c', 'askorbinska'],
        }
        
        # Category detection patterns
        self.category_patterns = {
            'vitamins': [
                r'\b(vitamin|vit|multivit)\b',
                r'\b(a|b|c|d|e|k|b1|b2|b6|b12|d3)\b',
                r'\b(thiamine|riboflavin|niacin|folate|biotin)\b'
            ],
            'minerals': [
                r'\b(calcium|magnesium|zinc|iron|selenium)\b',
                r'\b(kalcijum|magnezijum|cink|gvožđe)\b'
            ],
            'probiotics': [
                r'\b(probiotic|lactobacillus|bifidobacterium)\b',
                r'\b(probiotik|laktobacil|bifidus)\b'
            ],
            'supplements': [
                r'\b(omega|coq10|coenzyme|glucosamine)\b',
                r'\b(supplement|dodatak|ishrani)\b'
            ],
            'painkillers': [
                r'\b(ibuprofen|paracetamol|aspirin|diclofenac)\b',
                r'\b(analgesic|analgetik|protiv\s+bola)\b'
            ],
            'antibiotics': [
                r'\b(amoxicillin|penicillin|erythromycin)\b',
                r'\b(antibiotic|antibiotik)\b'
            ]
        }
        
        # Noise words to remove (but preserve important pharmaceutical terms)
        self.noise_words = {
            'za', 'od', 'do', 'sa', 'na', 'u', 'i', 'a', 'the', 'of', 'for', 'with', 'and',
            'plus', 'extra', 'special', 'premium', 'advanced', 'new', 'novo', 'original'
        }
        
    def preprocess_product(self, title: str, brand_name: Optional[str] = None) -> ProductIdentity:
        """
        Comprehensive preprocessing of a product title
        """
        if not title:
            return self._empty_identity()
        
        # Step 1: Basic cleaning
        cleaned_title = self._basic_clean(title)
        
        # Step 2: Extract and standardize components
        brand = self._extract_brand(cleaned_title, brand_name)
        strength = self._extract_strength(cleaned_title)
        form = self._extract_form(cleaned_title)
        size = self._extract_size(cleaned_title)
        variant = self._extract_variant(cleaned_title)
        category = self._detect_category(cleaned_title)
        
        # Step 3: Create base name (removing extracted components)
        base_name = self._extract_base_name(cleaned_title, brand, strength, form, size, variant)
        
        # Step 4: Apply synonym mappings
        base_name = self._apply_synonyms(base_name)
        
        # Step 5: Generate normalized name for display
        normalized_name = self._generate_normalized_name(base_name, brand, strength, form, variant)
        
        # Step 6: Create search tokens
        search_tokens = self._generate_search_tokens(cleaned_title, base_name, brand, strength, form, variant)
        
        # Step 7: Generate grouping key
        grouping_key = self._generate_grouping_key(base_name, brand, strength, form, category)
        
        return ProductIdentity(
            base_name=base_name,
            brand=brand,
            strength=strength,
            form=form,
            size=size,
            variant=variant,
            category=category,
            normalized_name=normalized_name,
            search_tokens=search_tokens,
            grouping_key=grouping_key
        )
    
    def _empty_identity(self) -> ProductIdentity:
        """Return empty identity for invalid input"""
        return ProductIdentity(
            base_name="", brand="", strength="", form="", size="", 
            variant="", category="", normalized_name="", 
            search_tokens=[], grouping_key=""
        )
    
    def _basic_clean(self, text: str) -> str:
        """Basic text cleaning and normalization"""
        # Normalize unicode characters
        text = unicodedata.normalize('NFKD', text)
        
        # Convert to lowercase
        text = text.lower().strip()
        
        # Remove trademark symbols
        text = re.sub(r'[®™©]', '', text)
        
        # Standardize whitespace and punctuation
        text = re.sub(r'[,\.\(\)\[\]\/\\]+', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        
        # Fix common OCR/typing errors
        text = re.sub(r'\bl\b', '1', text)  # lowercase L to 1 in dosages
        text = re.sub(r'\bo\b', '0', text)  # lowercase O to 0 in dosages
        
        return text.strip()
    
    def _extract_brand(self, text: str, brand_name: Optional[str] = None) -> str:
        """Extract and standardize brand name"""
        if brand_name:
            return self._standardize_brand(brand_name.lower())
        
        # Common pharmaceutical brand patterns
        brand_patterns = [
            r'\b(dr\.?\s*\w+)',
            r'\b(prof\.?\s*\w+)',
            r'\b(\w+\s*pharm\w*)',
            r'\b(\w+\s*lab\w*)',
            r'^([a-z]+\s+[a-z]+)\b',  # First two words if they look like brand
        ]
        
        for pattern in brand_patterns:
            match = re.search(pattern, text)
            if match:
                brand = match.group(1).strip()
                return self._standardize_brand(brand)
        
        return ""
    
    def _standardize_brand(self, brand: str) -> str:
        """Standardize brand name using mappings"""
        for old, new in self.brand_mappings.items():
            brand = re.sub(r'\b' + re.escape(old) + r'\b', new, brand)
        return brand.strip()
    
    def _extract_strength(self, text: str) -> str:
        """Extract and normalize dosage/strength information"""
        strength_patterns = [
            r'(\d+(?:\.\d+)?)\s*(mg|mcg|µg|iu|g|ml|l|%)',
            r'(\d+(?:\.\d+)?)\s*(milligram|miligram|microgram|mikrogram)',
            r'(\d+(?:\.\d+)?)\s*(gram|kilogram)',
            r'(\d+(?:\.\d+)?)\s*(milliliter|mililitr|liter|litr)',
            r'(\d+(?:\.\d+)?)\s*(percent|procenat)',
            r'(\d+)\s*(k|mil|million|billion)\s*(iu|mg|mcg)',
        ]
        
        for pattern in strength_patterns:
            match = re.search(pattern, text)
            if match:
                value = match.group(1)
                unit = match.group(2).lower()
                
                # Normalize unit
                normalized_unit = self.dosage_mappings.get(unit, unit)
                
                # Handle large numbers
                if len(match.groups()) > 2 and match.group(3):
                    multiplier = match.group(2).lower()
                    base_unit = match.group(3).lower()
                    
                    multipliers = {'k': 1000, 'mil': 1000000, 'million': 1000000, 'billion': 1000000000}
                    if multiplier in multipliers:
                        value = str(int(float(value) * multipliers[multiplier]))
                        normalized_unit = self.dosage_mappings.get(base_unit, base_unit)
                
                return f"{value} {normalized_unit}"
        
        return ""
    
    def _extract_form(self, text: str) -> str:
        """Extract and standardize pharmaceutical form"""
        form_patterns = [
            r'\b(tableta|tablete|tbl|tab|tabs)\b',
            r'\b(kapsula|kapsule|caps|cap|cps)\b',
            r'\b(sirup|syrup|syr)\b',
            r'\b(sprej|spray)\b',
            r'\b(kapi|drops|drop)\b',
            r'\b(mast|ointment|oint)\b',
            r'\b(krema|cream|cr)\b',
            r'\b(gel)\b',
            r'\b(prah|powder|pwd)\b',
            r'\b(rastvor|solution|sol)\b',
            r'\b(suspenzija|suspension|susp)\b',
            r'\b(injekcija|injection|inj)\b',
            r'\b(kesica|kesice|sachet|sachets)\b',
        ]
        
        for pattern in form_patterns:
            match = re.search(pattern, text)
            if match:
                form = match.group(1).lower()
                return self.form_mappings.get(form, form)
        
        return ""
    
    def _extract_size(self, text: str) -> str:
        """Extract package size/count information"""
        size_patterns = [
            r'\b(a\d+)\b',  # a10, a30
            r'\b(\d+)x\b',  # 10x, 30x
            r'\b(\d+)\s*(kom|komada|pieces|pcs)\b',
            r'\b(\d+)\s*ml\b',
            r'\b(\d+)\s*g\b(?!\s*(mg|mcg))',  # grams but not in dosage context
        ]
        
        for pattern in size_patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0).strip()
        
        return ""
    
    def _extract_variant(self, text: str) -> str:
        """Extract product variant (forte, plus, max, etc.)"""
        variant_patterns = [
            r'\b(forte|plus|max|ultra|premium|advanced|complex|complete)\b',
            r'\b(extra|special|imuno|junior|mini|midi|maxi)\b',
            r'\b(sensitive|gentle|soft|comfort|active|protect)\b',
        ]
        
        variants = []
        for pattern in variant_patterns:
            matches = re.findall(pattern, text)
            variants.extend(matches)
        
        return " ".join(sorted(set(variants))) if variants else ""
    
    def _detect_category(self, text: str) -> str:
        """Detect product category based on content"""
        for category, patterns in self.category_patterns.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    return category
        return "other"
    
    def _extract_base_name(self, text: str, brand: str, strength: str, form: str, size: str, variant: str) -> str:
        """Extract base product name by removing other components"""
        base = text
        
        # Remove extracted components
        components_to_remove = [brand, strength, form, size, variant]
        
        for component in components_to_remove:
            if component:
                # Remove the exact component
                base = re.sub(r'\b' + re.escape(component) + r'\b', '', base, flags=re.IGNORECASE)
                
                # Remove individual words from the component
                for word in component.split():
                    if len(word) > 2:  # Only remove meaningful words
                        base = re.sub(r'\b' + re.escape(word) + r'\b', '', base, flags=re.IGNORECASE)
        
        # Remove packaging indicators
        packaging_patterns = [
            r'\b(a\d+)\b', r'\b(\d+)x\b', r'\b\d+\s*(kom|komada|pack|box|pcs)\b'
        ]
        for pattern in packaging_patterns:
            base = re.sub(pattern, '', base, flags=re.IGNORECASE)
        
        # Remove noise words
        words = base.split()
        meaningful_words = [w for w in words if w not in self.noise_words and len(w) > 1]
        
        base = " ".join(meaningful_words)
        base = re.sub(r'\s+', ' ', base).strip()
        
        return base
    
    def _apply_synonyms(self, text: str) -> str:
        """Apply synonym mappings to normalize terms"""
        for canonical, synonyms in self.synonym_mappings.items():
            for synonym in synonyms:
                text = re.sub(r'\b' + re.escape(synonym) + r'\b', canonical, text, flags=re.IGNORECASE)
        
        return text
    
    def _generate_normalized_name(self, base_name: str, brand: str, strength: str, form: str, variant: str) -> str:
        """Generate a clean normalized name for display"""
        parts = []
        
        if brand:
            parts.append(brand.title())
        
        if base_name:
            parts.append(base_name.title())
        
        if variant:
            parts.append(variant.title())
        
        if strength:
            parts.append(strength)
        
        if form and form not in ['tableta', 'kapsula']:  # Don't show common forms
            parts.append(form.title())
        
        return " ".join(parts)
    
    def _generate_search_tokens(self, original: str, base_name: str, brand: str, strength: str, form: str, variant: str) -> List[str]:
        """Generate comprehensive search tokens"""
        tokens = set()
        
        # Add all meaningful words from original title
        words = re.findall(r'\b\w{2,}\b', original.lower())
        tokens.update(words)
        
        # Add component-specific tokens
        for component in [base_name, brand, strength, form, variant]:
            if component:
                component_words = re.findall(r'\b\w{2,}\b', component.lower())
                tokens.update(component_words)
        
        # Add synonym tokens
        token_list = list(tokens)
        for token in token_list:
            for canonical, synonyms in self.synonym_mappings.items():
                if token in synonyms:
                    tokens.add(canonical)
                elif token == canonical:
                    tokens.update(synonyms)
        
        # Remove noise words
        tokens = {t for t in tokens if t not in self.noise_words and len(t) > 1}
        
        return sorted(list(tokens))
    
    def _generate_grouping_key(self, base_name: str, brand: str, strength: str, form: str, category: str) -> str:
        """Generate a key for grouping similar products"""
        key_parts = []
        
        if base_name:
            key_parts.append(base_name.lower())
        
        if brand:
            key_parts.append(brand.lower())
        
        if strength:
            key_parts.append(strength.lower())
        
        if category:
            key_parts.append(category)
        
        # Only include form if it's significant (not tablets/capsules)
        if form and form not in ['tableta', 'kapsula', 'tablete', 'kapsule']:
            key_parts.append(form.lower())
        
        return "|".join(key_parts)
    
    def should_group_by_keys(self, key1: str, key2: str, similarity_threshold: float = 0.8) -> bool:
        """Determine if two products should be grouped based on their grouping keys"""
        if not key1 or not key2:
            return False
        
        # Exact match
        if key1 == key2:
            return True
        
        parts1 = key1.split("|")
        parts2 = key2.split("|")
        
        # Must have same number of significant parts
        if len(parts1) != len(parts2):
            return False
        
        # Check similarity of each part
        from rapidfuzz import fuzz
        
        similarities = []
        for p1, p2 in zip(parts1, parts2):
            if p1 == p2:
                similarities.append(1.0)
            else:
                sim = fuzz.ratio(p1, p2) / 100.0
                similarities.append(sim)
        
        # Average similarity must exceed threshold
        avg_similarity = sum(similarities) / len(similarities)
        return avg_similarity >= similarity_threshold


# Global instance for easy import
preprocessor = PharmaPreprocessor()