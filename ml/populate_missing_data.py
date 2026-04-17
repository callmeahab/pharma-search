#!/usr/bin/env python3
"""
Populate missing product data using standardization lookups, deterministic rules,
and an optional trained multi-entity NER model.
Extracts: BRAND, DOSAGE, FORM, QUANTITY from product titles.

Updates both Product and ProductStandardization tables.
"""

import os
import re
import logging
import argparse
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

try:
    import spacy
except ImportError:  # pragma: no cover - exercised only when spaCy is absent
    spacy = None
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from tqdm import tqdm

from matching_utils import (
    build_search_metadata,
    build_standardization_payload,
    normalize_form,
)

load_dotenv()

# Configuration
MODEL_PATH = Path(__file__).parent / "models" / "pharma_ner"
BATCH_SIZE = 500
LOG_FILE = Path(__file__).parent / "populate_missing_data.log"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def get_db_connection():
    """Connect to PostgreSQL database."""
    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharma_search")
    return psycopg2.connect(db_url)


def load_model():
    """Load the optional trained multi-entity NER model when available."""
    if spacy is None:
        logger.info("spaCy is not installed. Continuing with deterministic rules only.")
        return None

    if MODEL_PATH.exists():
        logger.info(f"Loading model from {MODEL_PATH}")
        return spacy.load(MODEL_PATH)

    logger.info(f"Model not found at {MODEL_PATH}. Continuing with deterministic rules only.")
    return None


QUANTITY_UNIT_PATTERN = (
    r"mikrotablet\w*|mikrokapsul\w*|tab\w*|tabl\w*|tableta|tablete|"
    r"kaps\w*|kapsula|kapsule|caps\w*|capsule\w*|softgel\w*|cps|"
    r"komada|kom|komad|kesic\w*|ampul\w*"
)
FORM_PATTERN = re.compile(
    r"\b(tablete|tableta|tabl|tab|kapsule|kapsula|kaps|capsules|capsule|caps|softgel|softgels|cps|"
    r"sirup|sprej|spray|kapi|drops|gel|gela|krema|krem|cream|mast|losion|lotion|serum|"
    r"rastvor|solution|suspenzija|kesice|kesica|ampule|ampula)\b",
    re.IGNORECASE,
)
QUANTITY_WITH_UNIT_RE = re.compile(
    rf"\b(\d{{1,4}})\s*({QUANTITY_UNIT_PATTERN})\b",
    re.IGNORECASE,
)
QUANTITY_PREFIX_RE = re.compile(r"\b[axх×]\s*(\d{1,4})\b", re.IGNORECASE)
BRAND_STOP_WORDS = {
    "aktiv", "alpha", "beta", "bio", "b12", "b6", "calcium", "cink", "collagen",
    "coq10", "d3", "dha", "enzim", "formula", "forte", "iron", "kolagen", "k2",
    "magnezijum", "magnesium", "max", "mega", "omega", "probiotic", "probiotik",
    "q10", "selen", "sol", "ultra", "vit", "vitamin", "vitamini", "vitamini",
    "zinc",
}


# Unit normalization mapping
UNIT_NORMALIZATION = {
    # Cyrillic to Latin
    "мг": "mg", "г": "g", "мкг": "mcg", "мл": "ml", "л": "l", "ме": "iu",
    # Greek/special characters
    "μg": "mcg", "µg": "mcg",
    # Variations
    "i.u.": "iu", "i.j.": "iu", "ij": "iu",
    "gr": "g", "gram": "g", "grama": "g",
    "miligram": "mg", "miligrama": "mg",
    "mikrogram": "mcg", "mikrograma": "mcg",
    "mililitar": "ml", "mililitra": "ml",
    "litar": "l", "litra": "l",
}


# Units classified by type
PHARMA_DOSAGE_UNITS = {"mg", "mcg", "iu", "ij", "i.u.", "i.j.", "μg", "µg"}
VOLUME_UNITS = {"ml", "l", "mл", "л"}
AMBIGUOUS_UNITS = {"g", "gr", "gram", "grama"}  # small values = dosage, large = weight

# Regex for finding pharma dosage in title text
PHARMA_DOSAGE_RE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij)\b', re.IGNORECASE
)
VOLUME_RE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*(ml|l)\b', re.IGNORECASE
)
GRAM_RE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*(g|gr)\b', re.IGNORECASE
)


def post_process_extraction(extracted: Dict[str, Any], title: str) -> Dict[str, Any]:
    """
    Post-process NER extraction to fix misclassified dosage entities.

    If the NER model tagged a volume (ml/l) as DOSAGE, move it to volume fields
    and regex-scan the title for the actual pharma dosage (mg/mcg/iu).
    """
    result = dict(extracted)
    dosage_unit = (result.get("dosage_unit") or "").lower()
    dosage_unit_normalized = UNIT_NORMALIZATION.get(dosage_unit, dosage_unit)

    # Check if the NER-extracted "dosage" is actually a volume
    if dosage_unit_normalized in ("ml", "l") or dosage_unit in VOLUME_UNITS:
        # Move the misclassified dosage to volume fields
        result["volume_value"] = result.get("dosage_value")
        result["volume_unit"] = dosage_unit_normalized
        # Clear the dosage fields so we can re-extract
        result["dosage_value"] = None
        result["dosage_unit"] = None
        result["dosage_text"] = None

        # Try to find actual pharma dosage in the title
        match = PHARMA_DOSAGE_RE.search(title)
        if match:
            try:
                val = float(match.group(1).replace(",", "."))
                unit = UNIT_NORMALIZATION.get(match.group(2).lower(), match.group(2).lower())
                result["dosage_value"] = val
                result["dosage_unit"] = unit
                result["dosage_text"] = match.group(0)
            except ValueError:
                pass

    # Handle ambiguous 'g' unit: small values (<=5g) are dosage, larger are weight
    elif dosage_unit_normalized == "g" or dosage_unit in AMBIGUOUS_UNITS:
        val = result.get("dosage_value") or 0
        if val > 5.0:
            # Large gram value → weight, not dosage
            result["volume_value"] = result.get("dosage_value")
            result["volume_unit"] = "g"
            result["dosage_value"] = None
            result["dosage_unit"] = None
            result["dosage_text"] = None

            # Try to find actual pharma dosage
            match = PHARMA_DOSAGE_RE.search(title)
            if match:
                try:
                    val = float(match.group(1).replace(",", "."))
                    unit = UNIT_NORMALIZATION.get(match.group(2).lower(), match.group(2).lower())
                    result["dosage_value"] = val
                    result["dosage_unit"] = unit
                    result["dosage_text"] = match.group(0)
                except ValueError:
                    pass

    # If NER found no dosage at all, try regex extraction from title
    if result.get("dosage_value") is None:
        match = PHARMA_DOSAGE_RE.search(title)
        if match:
            try:
                val = float(match.group(1).replace(",", "."))
                unit = UNIT_NORMALIZATION.get(match.group(2).lower(), match.group(2).lower())
                result["dosage_value"] = val
                result["dosage_unit"] = unit
                result["dosage_text"] = match.group(0)
            except ValueError:
                pass
        else:
            # Try gram with small-value threshold
            match = GRAM_RE.search(title)
            if match:
                try:
                    val = float(match.group(1).replace(",", "."))
                    if val <= 5.0:
                        result["dosage_value"] = val
                        result["dosage_unit"] = "g"
                        result["dosage_text"] = match.group(0)
                except ValueError:
                    pass

    # Extract volume from title if we don't have it yet
    if result.get("volume_value") is None:
        match = VOLUME_RE.search(title)
        if match:
            try:
                val = float(match.group(1).replace(",", "."))
                unit = UNIT_NORMALIZATION.get(match.group(2).lower(), match.group(2).lower())
                result["volume_value"] = val
                result["volume_unit"] = unit
            except ValueError:
                pass

    return result


def generate_normalized_name(extracted: Dict[str, Any], title: str) -> Optional[str]:
    """
    Generate a clean canonical name: brand + core ingredient + dosage + form.
    Used for display and as a base for grouping.
    """
    parts = []

    brand = extracted.get("brand")
    if brand and len(brand.strip()) > 1:
        parts.append(brand.strip().title())

    # Extract core ingredient from title (remove brand, dosage, form, quantity)
    ingredient = _extract_core_ingredient(title, brand)
    if ingredient:
        parts.append(ingredient)

    # Add dosage
    dosage_val = extracted.get("dosage_value")
    dosage_unit = extracted.get("dosage_unit")
    if dosage_val is not None and dosage_unit:
        # Format: remove trailing .0 for integer values
        if dosage_val == int(dosage_val):
            parts.append(f"{int(dosage_val)} {dosage_unit.upper()}")
        else:
            parts.append(f"{dosage_val} {dosage_unit.upper()}")

    # Add form
    form = extracted.get("form")
    if form:
        parts.append(form.strip().lower())

    if len(parts) >= 2:
        return " ".join(parts)
    return None


_FORM_WORDS = {
    "tablete", "tableta", "tabl", "tbl", "tab",
    "kapsule", "kapsula", "kaps", "caps", "capsule", "capsules",
    "softgel", "softgels",
    "gel", "gela",
    "sirup", "sprej", "spray", "kapi", "drops",
    "krema", "krem", "cream", "mast", "losion", "lotion", "serum",
    "prah", "powder", "granule", "granula",
    "kesice", "kesica", "ampule", "ampula",
    "komada", "kom", "komad",
    "rastvor", "solution", "suspenzija",
    "obloženih", "film",
    "šampon", "sampon", "balzam", "sapun",
    "parfem", "parfema", "edp", "edt", "parfum",
    "pasta", "traka",
    "cps",
    # Cosmetics/body care form words
    "ulje", "oil", "maska", "mask", "pena", "foam", "mousse",
    "puder", "lak", "emulzija", "emulsion", "voda", "water",
    "ruž", "ruz", "ulošci", "ulosci", "uložak", "ulozak",
    "tonik", "toner", "mleko", "mlijeko", "spreju",
    "fluid", "kupka", "dezodorans", "pastile", "pastila",
    "čaj", "tea", "prahu",
}

_NOISE_WORDS = {
    # Serbian single-letter fillers (a=and/but, i=and, u=in, o=about)
    "a", "i", "u", "o",
    # Serbian filler words
    "za", "sa", "od", "na", "po", "iz", "do", "se", "je", "ili", "sve",
    "the", "of", "with", "and", "for", "in",
    # Serbian body parts / category words (not product identities)
    "kosu", "kosa", "kose", "lice", "lica", "telo", "tela",
    "ruke", "ruku", "noge", "nogu", "nos", "oči", "oci",
    "usne", "zube", "zubi", "decu", "deca", "bebe",
    "stopala", "nokti", "nokte",
    # Serbian category descriptors / demographics
    "tuširanje", "tusiranje", "kupanje", "pranje", "negu", "nega",
    "čišćenje", "ciscenje", "hidratacija", "zaštita", "zastita",
    "ženski", "muški", "muski", "muškarce", "muskarce", "žene", "zene",
    "odrasle", "odraslih", "noćna", "nocna", "dnevna",
    "suvu", "osetljivu", "kožu", "kozu", "područje", "podrucje",
    "oko", "očiju", "ociju",
    "roze", "plava", "plavi", "bela", "beli", "crna", "crni",
    "brijanje", "žvakanje", "zvakanje",
    "zaštitu", "zastitu", "sunca", "toaletna",
    # Marketing
    "plus", "extra", "forte", "max", "ultra", "super", "premium",
    "pro", "active", "natural", "organic",
    "gratis", "poklon", "set", "promo",
    # Vendor/packaging noise
    "dr.", "dr", "theiss",
    "foods", "pharm", "pharma",
    # Common suffixes that leak through
    "2u1", "3u1",
    # SPF is like dosage for sunscreen, not product identity
    "spf", "spf15", "spf20", "spf30", "spf50", "spf50+",
}


def _clean_title(t: str) -> list:
    """Clean a lowercased title string and return significant core words."""
    # Replace special chars with spaces
    t = re.sub(r'[®™©()\[\]/\\,;:!?]', ' ', t)

    # Normalize hyphenated alphanumeric tokens: d-3 → d3, b-12 → b12, omega-3 → omega3
    t = re.sub(r'\b([a-z]+)-(\d+)', r'\1\2', t)

    # Remove concatenated quantity×dosage patterns FIRST: "60x2000iu", "30x500mg"
    t = re.sub(r'\b\d+\s*[xх×]\s*\d+(?:[.,]\d+)?\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij|ml|l|g|gr|kg)\b', ' ', t, flags=re.IGNORECASE)

    # Remove quantity×count patterns without units: "60x2", "30x1"
    t = re.sub(r'\b\d+\s*[xх×]\s*\d+\b', ' ', t)

    # Remove dosage patterns: "1000 iu", "500mg", "1000ij", etc.
    t = re.sub(r'\b\d+(?:[.,]\d+)?\s*(mg|mcg|μg|µg|iu|i\.u\.|i\.j\.|ij|ml|l|g|gr|kg)\b', ' ', t, flags=re.IGNORECASE)

    # Remove quantity + form patterns: "60 tableta", "a30", "30 caps", "x60"
    t = re.sub(r'\b[ax]?\d+\s*(mikrotablet\w*|mikrokapsul\w*|tab\w*|tabl\w*|tableta|tablete|kaps\w*|kapsula|kapsule|caps\w*|capsule\w*|softgel\w*|gel\w*|komada|kom|komad|kesic\w*|ampul\w*|obložen\w*|film\w*)\b', ' ', t, flags=re.IGNORECASE)
    t = re.sub(r'\b[ax]\d+\b', ' ', t)
    t = re.sub(r'\b\d+[xх×]\b', ' ', t)

    # Remove SPF patterns: "spf50", "spf 30", "spf50+"
    t = re.sub(r'\bspf\s*\d+\+?\b', ' ', t, flags=re.IGNORECASE)

    # Remove standalone pure numbers but keep alphanumeric like d3, b12, k2, q10, c1000
    t = re.sub(r'(?<![a-z0-9])\d+(?:\+\d+)*(?![a-z0-9])', ' ', t)

    words = t.split()
    core = []
    for w in words:
        w = w.strip(".,;:!?+–—_- ")
        wl = w.lower()
        if not wl:
            continue
        if len(wl) == 1 and wl not in ('c', 'e', 'd', 'b', 'k'):
            continue
        if wl in _FORM_WORDS:
            continue
        if wl in _NOISE_WORDS:
            continue
        core.append(wl)
    return core


def _extract_core_ingredient(title: str, brand: Optional[str]) -> Optional[str]:
    """
    Extract the core product identity from a title (brand-independent).
    Strips: brand name, dosage+units, quantity+form words, noise/filler, pure numbers.
    Keeps: product name, key identifiers (d3, b12, omega3, etc.)

    Tries brand-stripped version first for cross-brand grouping.
    Falls back to full title if brand stripping leaves nothing useful.
    """
    t = title.lower()

    # Try brand-stripped version first (enables cross-brand grouping)
    if brand and len(brand) > 1:
        t_stripped = t
        brand_lower = brand.lower().strip()
        for bw in brand_lower.split():
            if len(bw) > 1:
                t_stripped = re.sub(r'\b' + re.escape(bw) + r'\b', ' ', t_stripped)

        core = _clean_title(t_stripped)
        result = " ".join(core[:4]).title() if core else None
        # Require at least 2 chars — single letters (b, c) alone are too generic
        if result and len(result) >= 2:
            return result

    # Fallback: use full title (brand stays in key)
    core = _clean_title(t)
    result = " ".join(core[:4]).title() if core else None
    if result and len(result) >= 2:
        return result
    return None



def parse_dosage_text(text: str) -> Optional[Dict[str, Any]]:
    """Parse dosage text to extract value and unit."""
    text = text.lower().strip()

    # Pattern: number + unit (e.g., "500mg", "500 mg", "0.5g")
    match = re.match(r"(\d+(?:[.,]\d+)?)\s*(\w+)", text)
    if match:
        try:
            value = float(match.group(1).replace(",", "."))
            unit = match.group(2)
            unit = UNIT_NORMALIZATION.get(unit, unit)
            return {"value": value, "unit": unit}
        except ValueError:
            pass

    return None


def parse_quantity_text(text: str) -> Optional[Dict[str, Any]]:
    """Parse quantity text to extract value and unit."""
    text = text.lower().strip()

    # Pattern: number + unit (e.g., "60 tableta", "100 caps")
    match = re.match(r"(\d+)\s*(\w+)?", text)
    if match:
        try:
            value = int(match.group(1))
            unit = match.group(2) if match.group(2) else "kom"
            return {"value": value, "unit": unit}
        except ValueError:
            pass

    return None


def extract_brand_candidate(title: str) -> Optional[str]:
    """Conservatively extract a leading brand candidate from the title."""
    tokens = re.findall(r"[A-Za-zА-Яа-я0-9+-]+", title)
    if not tokens:
        return None

    brand_tokens: List[str] = []
    for token in tokens:
        normalized = token.lower().strip("+-")
        if not normalized:
            continue
        if re.match(r"^\d", normalized):
            break
        if normalized in BRAND_STOP_WORDS:
            break
        if FORM_PATTERN.match(normalized):
            break
        if PHARMA_DOSAGE_RE.match(normalized) or VOLUME_RE.match(normalized):
            break

        brand_tokens.append(token)
        if len(brand_tokens) >= 2:
            break

    if not brand_tokens:
        return None

    brand = " ".join(brand_tokens).strip()
    return brand if len(brand) > 1 else None


def extract_entities_rule_based(title: str) -> Dict[str, Any]:
    """Extract core entities using regexes and conservative heuristics."""
    result = {
        "brand": None,
        "dosage_value": None,
        "dosage_unit": None,
        "dosage_text": None,
        "form": None,
        "quantity_value": None,
        "quantity_unit": None,
        "volume_value": None,
        "volume_unit": None,
        "entities_found": []
    }

    brand = extract_brand_candidate(title)
    if brand:
        result["brand"] = brand
        result["entities_found"].append({"label": "BRAND", "text": brand})

    form_match = FORM_PATTERN.search(title)
    if form_match:
        normalized = normalize_form(form_match.group(1)) or form_match.group(1).lower()
        result["form"] = normalized
        result["entities_found"].append({"label": "FORM", "text": form_match.group(1)})

    dosage_match = PHARMA_DOSAGE_RE.search(title)
    if dosage_match:
        value = float(dosage_match.group(1).replace(",", "."))
        unit = UNIT_NORMALIZATION.get(dosage_match.group(2).lower(), dosage_match.group(2).lower())
        result["dosage_value"] = value
        result["dosage_unit"] = unit
        result["dosage_text"] = dosage_match.group(0)
        result["entities_found"].append({"label": "DOSAGE", "text": dosage_match.group(0)})
    else:
        gram_match = GRAM_RE.search(title)
        if gram_match:
            value = float(gram_match.group(1).replace(",", "."))
            if value <= 5.0:
                result["dosage_value"] = value
                result["dosage_unit"] = "g"
                result["dosage_text"] = gram_match.group(0)
                result["entities_found"].append({"label": "DOSAGE", "text": gram_match.group(0)})

    volume_match = VOLUME_RE.search(title)
    if volume_match:
        result["volume_value"] = float(volume_match.group(1).replace(",", "."))
        result["volume_unit"] = UNIT_NORMALIZATION.get(
            volume_match.group(2).lower(), volume_match.group(2).lower()
        )

    quantity_match = QUANTITY_WITH_UNIT_RE.search(title)
    if quantity_match:
        result["quantity_value"] = int(quantity_match.group(1))
        result["quantity_unit"] = quantity_match.group(2).lower()
        result["entities_found"].append({"label": "QUANTITY", "text": quantity_match.group(0)})

        if not result["form"]:
            normalized = normalize_form(quantity_match.group(2))
            if normalized and normalized not in {"kom", "komad", "komada"}:
                result["form"] = normalized
    else:
        quantity_prefix_match = QUANTITY_PREFIX_RE.search(title)
        if quantity_prefix_match:
            result["quantity_value"] = int(quantity_prefix_match.group(1))
            result["quantity_unit"] = "kom"
            result["entities_found"].append(
                {"label": "QUANTITY", "text": quantity_prefix_match.group(0)}
            )

    return result


def extract_entities_from_doc(doc) -> Dict[str, Any]:
    """Extract all entities from a processed spaCy doc."""
    result = {
        "brand": None,
        "dosage_value": None,
        "dosage_unit": None,
        "dosage_text": None,
        "form": None,
        "quantity_value": None,
        "quantity_unit": None,
        "volume_value": None,
        "volume_unit": None,
        "entities_found": []
    }

    for ent in doc.ents:
        result["entities_found"].append({
            "label": ent.label_,
            "text": ent.text
        })

        if ent.label_ == "BRAND" and not result["brand"]:
            result["brand"] = ent.text.strip()

        elif ent.label_ == "DOSAGE" and not result["dosage_value"]:
            parsed = parse_dosage_text(ent.text)
            if parsed:
                result["dosage_value"] = parsed["value"]
                result["dosage_unit"] = parsed["unit"]
                result["dosage_text"] = ent.text.strip()

        elif ent.label_ == "FORM" and not result["form"]:
            result["form"] = ent.text.strip().lower()

        elif ent.label_ == "QUANTITY" and not result["quantity_value"]:
            parsed = parse_quantity_text(ent.text)
            if parsed:
                result["quantity_value"] = parsed["value"]
                result["quantity_unit"] = parsed["unit"]

    return result


def extract_entities(title: str, nlp=None) -> Dict[str, Any]:
    """Extract all entities from a product title using ML when available."""
    if nlp is None:
        return extract_entities_rule_based(title)
    return extract_entities_from_doc(nlp(title))


def get_products_missing_data(conn, limit: int = BATCH_SIZE, update_all: bool = False,
                               last_id: str = "") -> List[Dict]:
    """Get products with missing extracted data."""
    cur = conn.cursor()

    if update_all:
        # Get all products, paginated by last_id
        query = """
            SELECT id, title
            FROM "Product"
            WHERE title IS NOT NULL AND LENGTH(title) > 5
              AND id > %s
            ORDER BY id
            LIMIT %s
        """
        cur.execute(query, (last_id, limit))
    else:
        # Get products missing key fields
        query = """
            SELECT id, title
            FROM "Product"
            WHERE title IS NOT NULL
              AND LENGTH(title) > 5
              AND id > %s
              AND (
                  "processedAt" IS NULL
                  OR "normalizedName" IS NULL
                  OR "coreProductIdentity" IS NULL
                  OR "searchTokens" IS NULL
                  OR "keywordTags" IS NULL
              )
            ORDER BY id
            LIMIT %s
        """
        cur.execute(query, (last_id, limit))

    rows = cur.fetchall()
    cur.close()

    return [{"id": row[0], "title": row[1]} for row in rows]


def get_standardizations_for_titles(conn, titles: List[str]) -> Dict[str, Dict[str, Any]]:
    """Fetch standardization data for matching product titles."""
    if not titles:
        return {}

    normalized_titles = list({title.strip().lower() for title in titles if title and title.strip()})
    cur = conn.cursor()
    query = """
        SELECT DISTINCT ON (LOWER(COALESCE("originalTitle", title)), LOWER(title))
            "originalTitle",
            title,
            "normalizedName",
            "brandName",
            "productForm",
            "dosageValue",
            "dosageUnit",
            "quantityValue",
            "quantityUnit",
            "volumeValue",
            "volumeUnit"
        FROM "ProductStandardization"
        WHERE LOWER(COALESCE("originalTitle", '')) = ANY(%s)
           OR LOWER(title) = ANY(%s)
        ORDER BY LOWER(COALESCE("originalTitle", title)), LOWER(title), confidence DESC, "updatedAt" DESC
    """
    cur.execute(query, (normalized_titles, normalized_titles))
    rows = cur.fetchall()
    cur.close()

    standardizations: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        original_title, title, normalized_name, brand, form, dosage_value, dosage_unit, quantity_value, quantity_unit, volume_value, volume_unit = row
        record = {
            "title": title,
            "normalized_name": normalized_name,
            "brand": brand,
            "form": form,
            "dosage_value": dosage_value,
            "dosage_unit": dosage_unit,
            "quantity_value": quantity_value,
            "quantity_unit": quantity_unit,
            "volume_value": volume_value,
            "volume_unit": volume_unit,
        }
        if original_title:
            standardizations.setdefault(original_title, record)
            standardizations.setdefault(original_title.lower(), record)
        if title:
            standardizations.setdefault(title, record)
            standardizations.setdefault(title.lower(), record)

    return standardizations


def update_product_table(conn, updates: List[Dict]) -> int:
    """Update the Product table with extracted data."""
    if not updates:
        return 0

    cur = conn.cursor()

    rows = [
        (
            update["id"],
            update["brand"],
            update["form"],
            update["dosage_value"],
            update["dosage_unit"],
            update["quantity_value"],
            update["quantity_unit"],
            update.get("volume_value"),
            update.get("volume_unit"),
            update.get("normalized_name"),
            update.get("core_product_identity"),
            update.get("search_tokens"),
            update.get("keyword_tags"),
        )
        for update in updates
    ]

    query = """
        UPDATE "Product" AS p SET
            "extractedBrand" = COALESCE(v.brand::text, p."extractedBrand"),
            form = COALESCE(v.form::text, p.form),
            "dosageValue" = COALESCE(v.dosage_value::double precision, p."dosageValue"),
            "dosageUnit" = COALESCE(v.dosage_unit::text, p."dosageUnit"),
            "quantityValue" = COALESCE(v.quantity_value::integer, p."quantityValue"),
            "quantityUnit" = COALESCE(v.quantity_unit::text, p."quantityUnit"),
            "volumeValue" = COALESCE(v.volume_value::numeric, p."volumeValue"),
            "volumeUnit" = COALESCE(v.volume_unit::text, p."volumeUnit"),
            "normalizedName" = COALESCE(v.normalized_name::text, p."normalizedName"),
            "coreProductIdentity" = COALESCE(v.core_product_identity::text, p."coreProductIdentity"),
            "searchTokens" = COALESCE(v.search_tokens::text[], p."searchTokens"),
            "keywordTags" = COALESCE(v.keyword_tags::text[], p."keywordTags"),
            "processedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (VALUES %s) AS v(
            id, brand, form, dosage_value, dosage_unit, quantity_value, quantity_unit,
            volume_value, volume_unit, normalized_name, core_product_identity,
            search_tokens, keyword_tags
        )
        WHERE p.id = v.id
        RETURNING p.id
    """

    execute_values(cur, query, rows, page_size=100)
    updated = cur.rowcount
    conn.commit()
    cur.close()

    return updated


def update_standardization_table(conn, updates: List[Dict]) -> int:
    """Update or insert into ProductStandardization table."""
    if not updates:
        return 0

    cur = conn.cursor()

    # Deduplicate by title to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time"
    seen_titles = set()
    unique_updates = []
    for update in updates:
        if update["title"] not in seen_titles:
            seen_titles.add(update["title"])
            unique_updates.append(update)

    rows = []
    for update in unique_updates:
        payload = build_standardization_payload(update)
        rows.append(
            (
                payload["title"],
                payload["original_title"],
                payload["normalized_name"],
                payload["brand"],
                payload["form"],
                payload["dosage_value"],
                payload["dosage_unit"],
                payload["quantity_value"],
                payload["quantity_unit"],
                payload["volume_value"],
                payload["volume_unit"],
                0.8,
                update.get("pipeline_source", "rules_pipeline"),
            )
        )

    if not rows:
        cur.close()
        return 0

    # Use upsert pattern
    query = """
        INSERT INTO "ProductStandardization" (
            title, "originalTitle", "normalizedName",
            "brandName", "productForm",
            "dosageValue", "dosageUnit",
            "quantityValue", "quantityUnit",
            "volumeValue", "volumeUnit",
            confidence, source
        ) VALUES %s
        ON CONFLICT ("originalTitle", title) DO UPDATE SET
            "normalizedName" = COALESCE(EXCLUDED."normalizedName", "ProductStandardization"."normalizedName"),
            "brandName" = COALESCE(EXCLUDED."brandName", "ProductStandardization"."brandName"),
            "productForm" = COALESCE(EXCLUDED."productForm", "ProductStandardization"."productForm"),
            "dosageValue" = COALESCE(EXCLUDED."dosageValue", "ProductStandardization"."dosageValue"),
            "dosageUnit" = COALESCE(EXCLUDED."dosageUnit", "ProductStandardization"."dosageUnit"),
            "quantityValue" = COALESCE(EXCLUDED."quantityValue", "ProductStandardization"."quantityValue"),
            "quantityUnit" = COALESCE(EXCLUDED."quantityUnit", "ProductStandardization"."quantityUnit"),
            "volumeValue" = COALESCE(EXCLUDED."volumeValue", "ProductStandardization"."volumeValue"),
            "volumeUnit" = COALESCE(EXCLUDED."volumeUnit", "ProductStandardization"."volumeUnit"),
            confidence = GREATEST(EXCLUDED.confidence, "ProductStandardization".confidence),
            "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "originalTitle"
    """

    execute_values(cur, query, rows, page_size=100)
    updated = cur.rowcount
    conn.commit()
    cur.close()

    return updated


def process_products(nlp, conn, limit: int = 0, update_all: bool = False,
                     update_standardization: bool = True):
    """Process products and extract missing data."""

    # Get total count for progress tracking
    cur = conn.cursor()
    if update_all:
        cur.execute('SELECT COUNT(*) FROM "Product" WHERE title IS NOT NULL AND LENGTH(title) > 5')
    else:
        cur.execute('''SELECT COUNT(*) FROM "Product"
                       WHERE title IS NOT NULL AND LENGTH(title) > 5
                       AND ("processedAt" IS NULL
                            OR "normalizedName" IS NULL OR "coreProductIdentity" IS NULL
                            OR "searchTokens" IS NULL OR "keywordTags" IS NULL)''')
    total_to_process = cur.fetchone()[0]
    cur.close()
    logger.info(f"Total products to process: {total_to_process}")

    total_processed = 0
    total_with_brand = 0
    total_with_dosage = 0
    total_with_form = 0
    total_with_quantity = 0
    total_from_standardization = 0
    last_id = ""  # Track last processed ID for pagination

    while True:
        # Get batch of products
        products = get_products_missing_data(conn, BATCH_SIZE, update_all, last_id)

        if not products:
            logger.info("No more products to process")
            break

        progress_pct = (total_processed / total_to_process * 100) if total_to_process > 0 else 0
        logger.info(f"Processing batch of {len(products)} products ({total_processed}/{total_to_process}, {progress_pct:.1f}%)")

        updates = []
        standardization_updates = []
        titles = [product["title"] for product in products]
        standardizations = get_standardizations_for_titles(conn, titles)

        inference_indexes: List[int] = []
        inference_titles: List[str] = []
        standardization_missing_by_index: Dict[int, bool] = {}

        for idx, product in enumerate(products):
            standardization = standardizations.get(product["title"]) or standardizations.get(product["title"].lower())
            standardization_missing = False
            if standardization:
                total_from_standardization += 1
                standardization_missing = any(
                    standardization[field] is None
                    for field in [
                        "brand",
                        "form",
                        "dosage_value",
                        "dosage_unit",
                        "quantity_value",
                        "quantity_unit",
                        "volume_value",
                        "volume_unit",
                    ]
                )
            standardization_missing_by_index[idx] = standardization_missing

            if not standardization or standardization_missing:
                inference_indexes.append(idx)
                inference_titles.append(product["title"])

        inferred_by_index: Dict[int, Dict[str, Any]] = {}
        if inference_titles:
            if nlp is not None:
                docs = nlp.pipe(inference_titles, batch_size=128)
                for i, doc in enumerate(
                    tqdm(docs, total=len(inference_titles), desc="Extracting entities")
                ):
                    inferred_by_index[inference_indexes[i]] = extract_entities_from_doc(doc)
            else:
                for i, title in enumerate(
                    tqdm(inference_titles, total=len(inference_titles), desc="Extracting entities (rules)")
                ):
                    inferred_by_index[inference_indexes[i]] = extract_entities_rule_based(title)

        for idx, product in enumerate(products):
            standardization = standardizations.get(product["title"]) or standardizations.get(product["title"].lower())
            extracted = None

            if standardization and not standardization_missing_by_index[idx]:
                extracted = {
                    "brand": standardization["brand"],
                    "form": standardization["form"],
                    "dosage_value": standardization["dosage_value"],
                    "dosage_unit": standardization["dosage_unit"],
                    "dosage_text": None,
                    "quantity_value": standardization["quantity_value"],
                    "quantity_unit": standardization["quantity_unit"],
                    "volume_value": standardization.get("volume_value"),
                    "volume_unit": standardization.get("volume_unit"),
                }
            else:
                inferred = inferred_by_index.get(idx) or extract_entities(product["title"], nlp)
                if standardization:
                    extracted = {
                        "brand": standardization["brand"] or inferred["brand"],
                        "form": standardization["form"] or inferred["form"],
                        "dosage_value": standardization["dosage_value"] or inferred["dosage_value"],
                        "dosage_unit": standardization["dosage_unit"] or inferred["dosage_unit"],
                        "dosage_text": inferred["dosage_text"],
                        "quantity_value": standardization["quantity_value"] or inferred["quantity_value"],
                        "quantity_unit": standardization["quantity_unit"] or inferred["quantity_unit"],
                        "volume_value": standardization.get("volume_value") or inferred.get("volume_value"),
                        "volume_unit": standardization.get("volume_unit") or inferred.get("volume_unit"),
                    }
                else:
                    extracted = inferred

            # Post-process: fix misclassified dosage (ml→volume, find real pharma dosage)
            extracted = post_process_extraction(extracted, product["title"])

            normalized_form = normalize_form(extracted.get("form")) or extracted.get("form")
            extracted["form"] = normalized_form

            # Generate normalized name and core identity
            norm_name = generate_normalized_name(extracted, product["title"])
            core_identity = _extract_core_ingredient(product["title"], extracted.get("brand"))
            search_tokens, keyword_tags = build_search_metadata({
                "title": product["title"],
                "brand": extracted.get("brand"),
                "core_product_identity": core_identity,
                "normalized_name": norm_name,
                "dosage_value": extracted.get("dosage_value"),
                "dosage_unit": extracted.get("dosage_unit"),
                "volume_value": extracted.get("volume_value"),
                "volume_unit": extracted.get("volume_unit"),
                "quantity_value": extracted.get("quantity_value"),
                "form": normalized_form,
            })

            update_record = {
                "id": product["id"],
                "title": product["title"],
                "brand": extracted["brand"],
                "form": normalized_form,
                "dosage_value": extracted["dosage_value"],
                "dosage_unit": extracted["dosage_unit"],
                "dosage_text": extracted.get("dosage_text"),
                "quantity_value": extracted["quantity_value"],
                "quantity_unit": extracted["quantity_unit"],
                "volume_value": extracted.get("volume_value"),
                "volume_unit": extracted.get("volume_unit"),
                "normalized_name": norm_name,
                "core_product_identity": core_identity,
                "search_tokens": search_tokens,
                "keyword_tags": keyword_tags,
                "pipeline_source": "ml_pipeline" if nlp is not None and idx in inferred_by_index else "rules_pipeline",
            }

            updates.append(update_record)
            if not standardization or standardization_missing:
                standardization_updates.append(update_record)

            # Count extractions
            if extracted["brand"]:
                total_with_brand += 1
            if extracted["dosage_value"]:
                total_with_dosage += 1
            if extracted["form"]:
                total_with_form += 1
            if extracted["quantity_value"]:
                total_with_quantity += 1

        # Update Product table
        updated_products = update_product_table(conn, updates)
        logger.info(f"Updated {updated_products} products")

        # Update ProductStandardization table
        if update_standardization and standardization_updates:
            updated_std = update_standardization_table(conn, standardization_updates)
            logger.info(f"Updated {updated_std} standardization records")

        total_processed += len(products)

        # Advance pagination cursor for both modes so each row is handled once per run.
        if products:
            last_id = products[-1]["id"]

        # Check limit
        if limit > 0 and total_processed >= limit:
            logger.info(f"Reached limit of {limit} products")
            break

    return {
        "total_processed": total_processed,
        "with_brand": total_with_brand,
        "with_dosage": total_with_dosage,
        "with_form": total_with_form,
        "with_quantity": total_with_quantity,
        "from_standardization": total_from_standardization,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Populate missing product data using standardization, deterministic rules, and optional NER"
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Maximum number of products to process (0 = no limit)"
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Process all products, not just those with missing data"
    )
    parser.add_argument(
        "--no-standardization", action="store_true",
        help="Skip updating ProductStandardization table"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be done without making changes"
    )
    parser.add_argument(
        "--rules-only", action="store_true",
        help="Skip spaCy model loading and use deterministic extraction rules only"
    )

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Populate Missing Product Data")
    logger.info("=" * 60)

    # Optional model support
    if args.rules_only:
        nlp = None
        logger.info("Skipping spaCy model load because --rules-only was provided")
    else:
        nlp = load_model()

    if nlp is not None:
        logger.info(f"Optional model enabled with pipes: {nlp.pipe_names}")
    else:
        logger.info("Using standardization lookups and deterministic extraction rules only")

    # Connect to database
    logger.info("Connecting to database...")
    conn = get_db_connection()

    if args.dry_run:
        # Just show stats
        cur = conn.cursor()
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT("extractedBrand") as with_brand,
                COUNT(form) as with_form,
                COUNT("dosageValue") as with_dosage,
                COUNT("quantityValue") as with_quantity
            FROM "Product"
            WHERE title IS NOT NULL
        """)
        row = cur.fetchone()
        cur.close()

        logger.info(f"\nCurrent database stats:")
        logger.info(f"  Total products: {row[0]}")
        logger.info(f"  With brand: {row[1]} ({row[1]/row[0]*100:.1f}%)")
        logger.info(f"  With form: {row[2]} ({row[2]/row[0]*100:.1f}%)")
        logger.info(f"  With dosage: {row[3]} ({row[3]/row[0]*100:.1f}%)")
        logger.info(f"  With quantity: {row[4]} ({row[4]/row[0]*100:.1f}%)")
        logger.info(f"\nMissing data:")
        logger.info(f"  Without brand: {row[0] - row[1]}")
        logger.info(f"  Without form: {row[0] - row[2]}")
        logger.info(f"  Without dosage: {row[0] - row[3]}")
        logger.info(f"  Without quantity: {row[0] - row[4]}")

        # Test on a few examples
        logger.info(f"\nSample extractions:")
        cur = conn.cursor()
        cur.execute("""
            SELECT title FROM "Product"
            WHERE title IS NOT NULL
            ORDER BY RANDOM()
            LIMIT 5
        """)
        for row in cur.fetchall():
            title = row[0]
            extracted = extract_entities(title, nlp)
            logger.info(f"\n  Title: {title}")
            for ent in extracted["entities_found"]:
                logger.info(f"    {ent['label']}: {ent['text']}")
        cur.close()

    else:
        # Process products
        start_time = datetime.now()

        stats = process_products(
            nlp, conn,
            limit=args.limit,
            update_all=args.all,
            update_standardization=not args.no_standardization
        )

        duration = datetime.now() - start_time

        logger.info("\n" + "=" * 60)
        logger.info("Processing Complete")
        logger.info("=" * 60)
        logger.info(f"Duration: {duration}")
        logger.info(f"Total processed: {stats['total_processed']}")
        if stats['total_processed'] > 0:
            logger.info(f"Extraction rates:")
            logger.info(f"  Brand: {stats['with_brand']} ({stats['with_brand']/stats['total_processed']*100:.1f}%)")
            logger.info(f"  Dosage: {stats['with_dosage']} ({stats['with_dosage']/stats['total_processed']*100:.1f}%)")
            logger.info(f"  Form: {stats['with_form']} ({stats['with_form']/stats['total_processed']*100:.1f}%)")
            logger.info(f"  Quantity: {stats['with_quantity']} ({stats['with_quantity']/stats['total_processed']*100:.1f}%)")
            logger.info(
                f"  From standardization: {stats['from_standardization']} "
                f"({stats['from_standardization']/stats['total_processed']*100:.1f}%)"
            )

    conn.close()
    logger.info("\nDone!")


if __name__ == "__main__":
    main()
