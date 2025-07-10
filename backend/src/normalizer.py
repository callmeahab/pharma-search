import re
import unicodedata
from typing import List, Tuple, Optional, Dict, Set
from transliterate import translit
from unidecode import unidecode
import logging
from rapidfuzz import fuzz

try:
    from .models import ExtractedAttributes, ProcessedProduct
except ImportError:
    from models import ExtractedAttributes, ProcessedProduct

logger = logging.getLogger(__name__)


class PharmaNormalizer:
    """Enhanced normalizer for price comparison with better product grouping"""

    def __init__(self):
        # Enhanced product identity mappings for better grouping
        self.core_product_mappings = {
            # Vitamins - normalize to common names
            "vitamin d3": "vitamin d",
            "vitamin d 3": "vitamin d", 
            "vitamin d-3": "vitamin d",
            "d3": "vitamin d",
            "cholecalciferol": "vitamin d",
            "vitamin k1": "vitamin k",
            "vitamin k 1": "vitamin k",
            "vitamin k-1": "vitamin k",
            "k1": "vitamin k",
            "d3+k1": "vitamin d + vitamin k",
            "d3 + k1": "vitamin d + vitamin k",
            "d3+k": "vitamin d + vitamin k",
            "d3 + k": "vitamin d + vitamin k",
            "vitamin b12": "vitamin b12",
            "vitamin b 12": "vitamin b12",
            "vitamin b-12": "vitamin b12",
            "cyanocobalamin": "vitamin b12",
            "methylcobalamin": "vitamin b12",
            "vitamin c": "vitamin c",
            "ascorbic acid": "vitamin c",
            "vitamin e": "vitamin e",
            "tocopherol": "vitamin e",
            
            # Minerals
            "calcium carbonate": "calcium",
            "calcium citrate": "calcium", 
            "magnesium oxide": "magnesium",
            "magnesium citrate": "magnesium",
            "zinc gluconate": "zinc",
            "zinc picolinate": "zinc",
            
            # Supplements
            "whey protein": "protein",
            "casein protein": "protein",
            "plant protein": "protein",
            "protein powder": "protein",
            "fish oil": "omega3",
            "omega 3": "omega3",
            "omega-3": "omega3",
            "epa dha": "omega3",
            "coenzyme q10": "coq10",
            "co q10": "coq10",
            "co-q10": "coq10",
            "ubiquinol": "coq10",
            "creatine monohydrate": "creatine",
            "creatine hcl": "creatine",
            
            # Amino acids
            "l-glutamine": "glutamine",
            "l-arginine": "arginine", 
            "l-leucine": "leucine",
            "l-carnitine": "carnitine",
            "acetyl l-carnitine": "carnitine",
            
            # Complex formulations
            "b complex": "b-complex",
            "b-complex": "b-complex",
            "vitamin b complex": "b-complex",
            "multivitamin": "multivitamin",
            "multi vitamin": "multivitamin",
            "bcaa": "bcaa",
            "branched chain amino acids": "bcaa",
            "eaa": "eaa",
            "essential amino acids": "eaa",
        }
        
        # Dosage range mappings for grouping similar dosages
        self.dosage_ranges = {
            # Vitamin D (IU)
            "vitamin d": [
                (0, 1000, "low"),
                (1000, 2500, "medium"), 
                (2500, 5000, "high"),
                (5000, 10000, "very-high"),
                (10000, float('inf'), "ultra-high")
            ],
            # Vitamin C (mg)
            "vitamin c": [
                (0, 250, "low"),
                (250, 500, "medium"),
                (500, 1000, "high"), 
                (1000, 2000, "very-high"),
                (2000, float('inf'), "ultra-high")
            ],
            # Protein (g)
            "protein": [
                (0, 20, "low"),
                (20, 30, "medium"),
                (30, 40, "high"),
                (40, float('inf'), "very-high")
            ],
            # Default ranges for other products
            "default": [
                (0, 100, "low"),
                (100, 500, "medium"),
                (500, 1000, "high"),
                (1000, float('inf'), "very-high")
            ]
        }

        # Common brand mappings (keep existing)
        self.brand_mappings = {
            "naughty boy": "Naughty Boy",
            "oneraw": "OneRaw",
            "nocco": "NOCCO",
            "maxler": "Maxler",
            "applied": "Applied",
            "esi": "ESI",
            "cellzoom": "CellZoom",
            "moonstruck": "MoonStruck",
            "caretaker": "CareTaker",
            "yambam": "YamBam",
            "tigger": "Tigger",
            "thera band": "Thera Band",
        }

        # Unit normalizations (keep existing)
        self.unit_mappings = {
            "gr": "g", "grams": "g", "gram": "g", "kg": "kg", "kilogram": "kg",
            "mg": "mg", "miligram": "mg", "milligram": "mg", "mcg": "mcg",
            "μg": "mcg", "mikrogram": "mcg", "ml": "ml", "mililitar": "ml",
            "milliliter": "ml", "l": "L", "litar": "L", "liter": "L",
            "c": "caps", "cap": "caps", "caps": "caps", "capsule": "caps",
            "kapsule": "caps", "kapsula": "caps", "t": "tab", "tab": "tab",
            "tabs": "tab", "tablet": "tab", "tableta": "tab", "tablete": "tab",
            "gc": "softgel", "gelcaps": "softgel", "gb": "gummies", 
            "gummies": "gummies", "ser": "serving", "serving": "serving",
            "iu": "IU", "ie": "IU",
        }

        # Form mappings (keep existing)
        self.form_mappings = {
            "powder": "powder", "prah": "powder", "prašak": "powder",
            "capsule": "capsule", "kapsule": "capsule", "kapsula": "capsule",
            "tablet": "tablet", "tablete": "tablet", "tableta": "tablet",
            "sirup": "syrup", "syrup": "syrup", "gel": "gel", "gela": "gel",
            "krema": "cream", "cream": "cream", "krem": "cream",
            "shot": "shot", "šot": "shot", "drink": "drink", "napitak": "drink",
            "bar": "bar", "pločica": "bar", "mast": "ointment",
            "ointment": "ointment", "kapi": "drops", "drops": "drops",
            "sprej": "spray", "spray": "spray",
        }

        # Keep existing patterns
        self.patterns = {
            "dosage": [
                r"(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|μg|iu|ie)\b",
                r"(\d+(?:[.,]\d+)?)\s*(miligram|gram|mikrogram)",
                r"(\d+(?:[.,]\d+)?)\s*%",
                r"(\d+)-(\d+)-(\d+)",
            ],
            "quantity": [
                r"(\d+)\s*(caps?|tablets?|tab|gc|gb|t|c|ser|serving|kapsul[ea]|tablet[ea])\b",
                r"(\d+)(c|t|gc|gb)$",
                r"a(\d+)\b",
            ],
            "volume": [
                r"(\d+(?:[.,]\d+)?)\s*(ml|l|kg|g|gr)\b",
                r"(\d+(?:[.,]\d+)?)\s*(litar|mililitar|kilogram|gram)",
            ],
        }

        self.remove_patterns = [
            r"\b(supreme|pure|plus|ultra|max|extreme|advanced|pro)\b",
            r"\b(novo|new|original)\b",
            r"[®™]",
            r"–|-",
        ]

    def _create_core_product_identity(self, title: str, attributes: ExtractedAttributes) -> str:
        """Create core product identity for grouping similar products"""
        
        # Start with the product name or title
        core_name = attributes.product_name or title
        core_name = core_name.lower().strip()
        
        # Normalize spacing and punctuation first
        core_name = re.sub(r'\s*\+\s*', ' + ', core_name)  # Normalize plus signs
        core_name = re.sub(r'\s*-\s*', ' ', core_name)     # Remove dashes
        core_name = re.sub(r'\s+', ' ', core_name)         # Normalize multiple spaces
        
        # Apply core product mappings to normalize similar products
        for original, normalized in self.core_product_mappings.items():
            if original in core_name:
                core_name = core_name.replace(original, normalized)
        
        # Remove common modifiers that don't affect product identity
        modifiers_to_remove = [
            r'\b(high|low|extra|super|mega|micro|nano)\b',
            r'\b(strength|potency|dose|formula|complex)\b',
            r'\b(fast|slow|quick|extended|release|acting)\b',
            r'\b(natural|organic|synthetic|premium|professional)\b',
            r'\b(for|with|without|free|plus|extra)\b',
            r'\b(men|women|kids|children|adult|senior)\b',
            r'\b(morning|evening|night|day)\b',
            r'\b\d+\s*(mg|g|mcg|iu|ml|caps|tabs|tablet|capsule|kom)\b',  # Remove dosage info
            r'\b(babytol|centrum|solgar|now|nature|naturals|optimum|gnc|vitacost|kirkland|life|source|nordic|carlson|thorne|garden|rainbow|bluebonnet|way|made|puritan|pride|twinlab|jarrow|swanson|country)\b',
            r'\b(twist|off|kaps|kapsula|kapsule|tableta|tablet|capsule|cap|soft|gel|gummy|liquid|powder|drop|spray|cream|gel|oil|balm|ointment)\b',
            r'\b[a-z]*\d+\b',  # Remove patterns like A30, B12, etc.
            r'\b\d+\s*(x|kom|ks|pc|pcs|pieces)\b',  # Remove quantity indicators
        ]
        
        for pattern in modifiers_to_remove:
            core_name = re.sub(pattern, ' ', core_name, flags=re.IGNORECASE)
        
        # Clean up whitespace
        core_name = ' '.join(core_name.split())
        
        # Apply additional normalizations
        normalizations = {
            'protein powder': 'protein',
            'whey isolate': 'protein',
            'whey concentrate': 'protein',
            'casein': 'protein',
            'amino acid': 'amino',
            'fish oil': 'omega3',
            'krill oil': 'omega3',
            'cod liver oil': 'omega3',
        }
        
        for old, new in normalizations.items():
            if old in core_name:
                core_name = new
                break
        
        return core_name.strip()

    def _get_dosage_range(self, product_identity: str, dosage_value: Optional[float], dosage_unit: Optional[str]) -> str:
        """Get dosage range category for grouping"""
        
        if not dosage_value or not dosage_unit:
            return "unknown"
        
        # Normalize dosage to common units
        normalized_value = dosage_value
        normalized_unit = dosage_unit.lower()
        
        # Convert to standard units
        if normalized_unit in ['mcg', 'μg']:
            normalized_value = dosage_value / 1000  # Convert to mg
            normalized_unit = 'mg'
        elif normalized_unit in ['g', 'gr']:
            normalized_value = dosage_value * 1000  # Convert to mg
            normalized_unit = 'mg'
        elif normalized_unit in ['iu', 'ie']:
            normalized_unit = 'iu'
        
        # Get appropriate ranges
        ranges = self.dosage_ranges.get(product_identity, self.dosage_ranges["default"])
        
        for min_val, max_val, category in ranges:
            if min_val <= normalized_value < max_val:
                return f"{category}-{normalized_unit}"
        
        return f"unknown-{normalized_unit}"

    def _create_group_key(self, normalized_name: str, attributes: ExtractedAttributes) -> str:
        """Create group key focused on core product identity rather than exact matching"""
        
        # Get core product identity (ignoring brand)
        core_identity = self._create_core_product_identity(normalized_name, attributes)
        
        parts = [f"product:{core_identity}"]
        
        # Add form if it significantly affects the product
        if attributes.form and attributes.form in ['powder', 'capsule', 'tablet', 'liquid']:
            parts.append(f"form:{attributes.form}")
        
        # Add dosage range instead of exact dosage
        if attributes.dosage_value and attributes.dosage_unit:
            dosage_range = self._get_dosage_range(core_identity, attributes.dosage_value, attributes.dosage_unit)
            parts.append(f"dosage:{dosage_range}")
        
        # For quantity, only group if it's a significant differentiator
        if attributes.quantity and attributes.quantity_unit:
            if attributes.quantity_unit in ['caps', 'tab', 'serving']:
                # Group by quantity ranges for countable items
                if attributes.quantity <= 30:
                    parts.append("qty:small")
                elif attributes.quantity <= 100:
                    parts.append("qty:medium")  
                elif attributes.quantity <= 200:
                    parts.append("qty:large")
                else:
                    parts.append("qty:xl")
        
        return "_".join(parts)

    def _create_similarity_group_key(self, normalized_name: str, attributes: ExtractedAttributes) -> str:
        """Create a broader similarity key for finding related products to merge"""
        
        core_identity = self._create_core_product_identity(normalized_name, attributes)
        
        # Very broad grouping - just core product + general form category
        parts = [f"sim:{core_identity}"]
        
        # Only add form if it's a major differentiator
        if attributes.form:
            if attributes.form in ['powder', 'liquid']:
                parts.append(f"f:{attributes.form}")
            elif attributes.form in ['capsule', 'tablet', 'softgel']:
                parts.append("f:solid")
        
        return "_".join(parts)

    # Keep all existing methods but update the group key creation
    def normalize(self, title: str) -> ProcessedProduct:
        """Main normalization function with enhanced grouping"""
        clean_title = self._clean_title(title)
        attributes = self._extract_attributes(clean_title)
        normalized_name = self._create_normalized_name(clean_title, attributes)
        search_tokens = self._generate_search_tokens(title, normalized_name)
        
        # Create both regular and similarity group keys
        group_key = self._create_group_key(normalized_name, attributes)
        similarity_key = self._create_similarity_group_key(normalized_name, attributes)

        processed = ProcessedProduct(
            original_title=title,
            normalized_name=normalized_name,
            attributes=attributes,
            search_tokens=search_tokens,
            group_key=group_key,
        )
        
        # Add similarity key as additional attribute
        processed.similarity_key = similarity_key
        
        return processed

    # Keep all existing methods (_clean_title, _extract_attributes, etc.)
    # ... (copy all existing methods from the original normalizer)
    
    def _clean_title(self, title: str) -> str:
        """Clean and standardize the title"""
        title = title.lower()

        if self._has_cyrillic(title):
            title = translit(title, "sr", reversed=True)

        title = re.sub(r"[^\w\s\-–%.,:]", " ", title)

        for pattern in self.remove_patterns:
            title = re.sub(pattern, " ", title, flags=re.IGNORECASE)

        title = " ".join(title.split())
        return title

    def _extract_attributes(self, title: str) -> ExtractedAttributes:
        """Extract all attributes from the title"""
        attributes = ExtractedAttributes(confidence_scores={})

        brand, brand_conf = self._extract_brand(title)
        attributes.brand = brand
        attributes.confidence_scores["brand"] = brand_conf

        dosage_value, dosage_unit, dosage_conf = self._extract_dosage(title)
        attributes.dosage_value = dosage_value
        attributes.dosage_unit = dosage_unit
        attributes.confidence_scores["dosage"] = dosage_conf

        quantity, quantity_unit, quantity_conf = self._extract_quantity(title)
        attributes.quantity = quantity
        attributes.quantity_unit = quantity_unit
        attributes.confidence_scores["quantity"] = quantity_conf

        volume, volume_unit, volume_conf = self._extract_volume(title)
        attributes.volume = volume
        attributes.volume_unit = volume_unit
        attributes.confidence_scores["volume"] = volume_conf

        form, form_conf = self._extract_form(title)
        attributes.form = form
        attributes.confidence_scores["form"] = form_conf

        product_name = self._extract_product_name(title, attributes)
        attributes.product_name = product_name

        return attributes

    def _extract_brand(self, title: str) -> Tuple[Optional[str], float]:
        """Extract brand from title"""
        title_lower = title.lower()

        for brand_key, brand_value in self.brand_mappings.items():
            if brand_key in title_lower:
                return brand_value, 0.95

        words = title.split()
        if len(words) >= 2:
            if words[0].isupper() and len(words[0]) > 2:
                return words[0].title(), 0.7

        return None, 0.0

    def _extract_dosage(self, title: str) -> Tuple[Optional[float], Optional[str], float]:
        """Extract dosage information"""
        for pattern in self.patterns["dosage"]:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                try:
                    if "-" in match.group(0):
                        return None, None, 0.0

                    value = float(match.group(1).replace(",", "."))
                    unit = match.group(2).lower() if len(match.groups()) > 1 else None

                    if unit:
                        unit = self.unit_mappings.get(unit, unit)

                    return value, unit, 0.9
                except:
                    continue

        return None, None, 0.0

    def _extract_quantity(self, title: str) -> Tuple[Optional[int], Optional[str], float]:
        """Extract quantity information"""
        for pattern in self.patterns["quantity"]:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                try:
                    value = int(match.group(1))
                    unit = match.group(2).lower() if len(match.groups()) > 1 else "units"
                    unit = self.unit_mappings.get(unit, unit)

                    return value, unit, 0.9
                except:
                    continue

        return None, None, 0.0

    def _extract_volume(self, title: str) -> Tuple[Optional[float], Optional[str], float]:
        """Extract volume/weight information"""
        for pattern in self.patterns["volume"]:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                try:
                    value = float(match.group(1).replace(",", "."))
                    unit = match.group(2).lower()
                    unit = self.unit_mappings.get(unit, unit)

                    if unit in ["mg", "mcg"] and value < 1000:
                        continue

                    return value, unit, 0.9
                except:
                    continue

        return None, None, 0.0

    def _extract_form(self, title: str) -> Tuple[Optional[str], float]:
        """Extract product form"""
        title_lower = title.lower()

        for form_key, form_value in self.form_mappings.items():
            if form_key in title_lower:
                return form_value, 0.9

        if "caps" in title_lower or "capsule" in title_lower:
            return "capsule", 0.8
        elif "tab" in title_lower or "tablet" in title_lower:
            return "tablet", 0.8
        elif "powder" in title_lower or "gr" in title_lower:
            return "powder", 0.7

        return None, 0.0

    def _extract_product_name(self, title: str, attributes: ExtractedAttributes) -> str:
        """Extract the core product name"""
        name = title

        if attributes.brand:
            name = re.sub(rf"\b{re.escape(attributes.brand)}\b", "", name, flags=re.IGNORECASE)

        if attributes.dosage_value and attributes.dosage_unit:
            pattern = rf"\b{attributes.dosage_value}\s*{re.escape(attributes.dosage_unit)}\b"
            name = re.sub(pattern, "", name, flags=re.IGNORECASE)

        if attributes.quantity:
            pattern = rf'\b{attributes.quantity}\s*{re.escape(attributes.quantity_unit or "")}\b'
            name = re.sub(pattern, "", name, flags=re.IGNORECASE)

        if attributes.volume and attributes.volume_unit:
            pattern = rf"\b{attributes.volume}\s*{re.escape(attributes.volume_unit)}\b"
            name = re.sub(pattern, "", name, flags=re.IGNORECASE)

        name = " ".join(name.split())
        name = name.strip(" -–,")

        return name

    def _create_normalized_name(self, title: str, attributes: ExtractedAttributes) -> str:
        """Create normalized product name"""
        parts = []

        if attributes.product_name:
            parts.append(attributes.product_name)
        else:
            parts.append(title)

        normalized = " ".join(parts).lower()

        # Apply core product mappings
        for old, new in self.core_product_mappings.items():
            normalized = normalized.replace(old, new)

        return normalized.strip()

    def _generate_search_tokens(self, original: str, normalized: str) -> List[str]:
        """Generate search tokens for fuzzy matching"""
        tokens = set()

        for word in original.lower().split():
            if len(word) > 2:
                tokens.add(word)

        for word in normalized.split():
            if len(word) > 2:
                tokens.add(word)

        tokens.add(unidecode(original.lower()))
        tokens.add(unidecode(normalized))

        for text in [original.lower(), normalized]:
            for i in range(len(text) - 2):
                trigram = text[i : i + 3]
                if trigram.strip():
                    tokens.add(trigram)

        return list(tokens)

    def _has_cyrillic(self, text: str) -> bool:
        """Check if text contains Cyrillic characters"""
        return bool(re.search(r"[\u0400-\u04FF]", text))
