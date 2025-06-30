import re
import unicodedata
from typing import List, Tuple, Optional, Dict
from transliterate import translit
from unidecode import unidecode
import logging

from .models import ExtractedAttributes, ProcessedProduct

logger = logging.getLogger(__name__)


class PharmaNormalizer:
    """Normalizes pharmaceutical product names with Serbian language support"""

    def __init__(self):
        # Common brand mappings
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

        # Unit normalizations
        self.unit_mappings = {
            # Weight
            "gr": "g",
            "grams": "g",
            "gram": "g",
            "kg": "kg",
            "kilogram": "kg",
            "mg": "mg",
            "miligram": "mg",
            "milligram": "mg",
            "mcg": "mcg",
            "μg": "mcg",
            "mikrogram": "mcg",
            # Volume
            "ml": "ml",
            "mililitar": "ml",
            "milliliter": "ml",
            "l": "L",
            "litar": "L",
            "liter": "L",
            # Count
            "c": "caps",
            "cap": "caps",
            "caps": "caps",
            "capsule": "caps",
            "kapsule": "caps",
            "kapsula": "caps",
            "t": "tab",
            "tab": "tab",
            "tabs": "tab",
            "tablet": "tab",
            "tableta": "tab",
            "tablete": "tab",
            "gc": "softgel",
            "gelcaps": "softgel",
            "gb": "gummies",
            "gummies": "gummies",
            "ser": "serving",
            "serving": "serving",
            # Other
            "iu": "IU",
            "ie": "IU",  # International Units
        }

        # Product form mappings
        self.form_mappings = {
            "powder": "powder",
            "prah": "powder",
            "prašak": "powder",
            "capsule": "capsule",
            "kapsule": "capsule",
            "kapsula": "capsule",
            "tablet": "tablet",
            "tablete": "tablet",
            "tableta": "tablet",
            "sirup": "syrup",
            "syrup": "syrup",
            "gel": "gel",
            "gela": "gel",
            "krema": "cream",
            "cream": "cream",
            "krem": "cream",
            "shot": "shot",
            "šot": "shot",
            "drink": "drink",
            "napitak": "drink",
            "bar": "bar",
            "pločica": "bar",
            "mast": "ointment",
            "ointment": "ointment",
            "kapi": "drops",
            "drops": "drops",
            "sprej": "spray",
            "spray": "spray",
        }

        # Patterns for extraction
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

        # Words to remove
        self.remove_patterns = [
            r"\b(supreme|pure|plus|ultra|max|extreme|advanced|pro)\b",
            r"\b(novo|new|original)\b",
            r"[®™]",
            r"–|-",
        ]

    def normalize(self, title: str) -> ProcessedProduct:
        """Main normalization function"""
        clean_title = self._clean_title(title)
        attributes = self._extract_attributes(clean_title)
        normalized_name = self._create_normalized_name(clean_title, attributes)
        search_tokens = self._generate_search_tokens(title, normalized_name)
        group_key = self._create_group_key(normalized_name, attributes)

        return ProcessedProduct(
            original_title=title,
            normalized_name=normalized_name,
            attributes=attributes,
            search_tokens=search_tokens,
            group_key=group_key,
        )

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

    def _extract_dosage(
        self, title: str
    ) -> Tuple[Optional[float], Optional[str], float]:
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

    def _extract_quantity(
        self, title: str
    ) -> Tuple[Optional[int], Optional[str], float]:
        """Extract quantity information"""
        for pattern in self.patterns["quantity"]:
            match = re.search(pattern, title, re.IGNORECASE)
            if match:
                try:
                    value = int(match.group(1))
                    unit = (
                        match.group(2).lower() if len(match.groups()) > 1 else "units"
                    )
                    unit = self.unit_mappings.get(unit, unit)

                    return value, unit, 0.9
                except:
                    continue

        return None, None, 0.0

    def _extract_volume(
        self, title: str
    ) -> Tuple[Optional[float], Optional[str], float]:
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
            name = re.sub(
                rf"\b{re.escape(attributes.brand)}\b", "", name, flags=re.IGNORECASE
            )

        if attributes.dosage_value and attributes.dosage_unit:
            pattern = (
                rf"\b{attributes.dosage_value}\s*{re.escape(attributes.dosage_unit)}\b"
            )
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

    def _create_normalized_name(
        self, title: str, attributes: ExtractedAttributes
    ) -> str:
        """Create normalized product name"""
        parts = []

        if attributes.product_name:
            parts.append(attributes.product_name)
        else:
            parts.append(title)

        normalized = " ".join(parts).lower()

        replacements = {
            "vitamin d3": "vitamin d",
            "vitamin d 3": "vitamin d",
            "co q10": "coq10",
            "co-q10": "coq10",
            "omega 3": "omega3",
            "omega-3": "omega3",
            "b complex": "b-complex",
            "bcaa": "bcaa",
            "eaa": "eaa",
        }

        for old, new in replacements.items():
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

    def _create_group_key(
        self, normalized_name: str, attributes: ExtractedAttributes
    ) -> str:
        """Create unique group key"""
        parts = []

        name_key = re.sub(r"[^a-z0-9]", "", normalized_name.lower())
        parts.append(f"n:{name_key}")

        if attributes.brand:
            brand_key = re.sub(r"[^a-z0-9]", "", attributes.brand.lower())
            parts.append(f"b:{brand_key}")

        if attributes.dosage_value and attributes.dosage_unit:
            parts.append(f"d:{attributes.dosage_value}{attributes.dosage_unit}")

        if attributes.form:
            parts.append(f"f:{attributes.form}")

        return "_".join(parts)

    def _has_cyrillic(self, text: str) -> bool:
        """Check if text contains Cyrillic characters"""
        return bool(re.search(r"[\u0400-\u04FF]", text))
