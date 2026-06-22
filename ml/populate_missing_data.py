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
import dictionaries

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
    r"mikrotablet\w*|mikrokapsul\w*|tabl\w*|tableta|tablete|tbl|"
    r"kaps\w*|kapsula|kapsule|kap|caps\w*|capsule\w*|softgel\w*|cps|"
    r"drazej\w*|pastil\w*|sas\w*|vrecic\w*|kesic\w*|ampul\w*|"
    r"komada|komad|kom|tab\w*"
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


# Unit normalization -> canonical set {mg, mcg, iu, g, ml, l, kg}
UNIT_NORMALIZATION = {
    # Cyrillic to Latin
    "мг": "mg", "г": "g", "кг": "kg", "мкг": "mcg", "мл": "ml", "л": "l",
    "ме": "iu", "ије": "iu", "ијм": "iu",
    # Greek/special characters
    "μg": "mcg", "µg": "mcg", "ug": "mcg",
    # IU variations
    "i.u.": "iu", "i.j.": "iu", "ij": "iu", "iu": "iu", "ije": "iu",
    "jm": "iu", "j.m.": "iu", "ie": "iu", "i u": "iu", "i j": "iu",
    # mass
    "gr": "g", "gram": "g", "grama": "g",
    "miligram": "mg", "miligrama": "mg",
    "mikrogram": "mcg", "mikrograma": "mcg",
    "mililitar": "ml", "mililitra": "ml",
    "litar": "l", "litra": "l",
}


def canon_unit(unit: str) -> str:
    u = (unit or "").lower().strip().replace(" ", "")
    return UNIT_NORMALIZATION.get(u, UNIT_NORMALIZATION.get(unit.lower().strip(), u))


# Units classified by type
VOLUME_UNITS = {"ml", "l"}
WEIGHT_UNITS = {"g", "gr", "gram", "grama", "kg"}  # container weight (large values)

# Collapse thousands separators (1.000 / 1,000 / 1 000) only directly before a
# strength unit, so "1.000 IU" -> "1000 IU" without harming decimals like "1,2 mg".
_THOUSANDS_RE = re.compile(
    r'(?<![a-z0-9])(\d{1,3})[.,  ](\d{3})(?=\s*(?:iu|ij|i\.?\s?u\.?|i\.?\s?j\.?|j\.?\s?m\.?|mg|mcg|ug)\b)',
    re.IGNORECASE,
)


def pre_normalize_dosage(text: str) -> str:
    """Lowercase + collapse thousands separators ahead of strength extraction."""
    t = text.lower()
    t = _THOUSANDS_RE.sub(r"\1\2", t)
    return t


# IU written many ways; trailing period / end-of-string tolerated via (?![a-z]).
PHARMA_DOSAGE_RE = re.compile(
    r'(\d+(?:[.,]\d+)?)\s*'
    r'(mcg|µg|μg|ug|mg|iu|ij|i\.?\s?u\.?|i\.?\s?j\.?|j\.?\s?m\.?)'
    r'\.?(?![a-z])',
    re.IGNORECASE,
)
VOLUME_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(ml|l)\b', re.IGNORECASE)
GRAM_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|grama)\b', re.IGNORECASE)


def _parse_num(raw: str) -> float:
    return float(raw.replace(".", "").replace(",", ".")) if raw.count(",") and raw.count(".") else float(raw.replace(",", "."))


# Pack counts above this are implausible for tablets/capsules; such a "number +
# form" match is really a dosage (e.g. "2000 tablete" = 2000 IU), not a count.
MAX_PACK_COUNT = 500

# Cosmetic/topical forms (mirror of Go matching.topicalForms); used to drop
# flavor-derived false-positive forms on weight-based powders.
_TOPICAL_FORMS = {
    "krema", "krem", "gel", "serum", "losion", "mast", "sampon", "balzam", "sapun",
    "maska", "pena", "puder", "lak", "mleko", "emulzija", "fluid", "pasta",
}

# Vitamin D is dosed in IU but is very often written as a bare number ("Detrical
# 2000", "Vitamin D3 1000"). These are the realistic IU strengths; we only infer
# an IU dosage when one of these exact values is present, to avoid grabbing pack
# counts, years, or lot numbers.
PREFERRED_IU = {
    400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000,
    5000, 5600, 6000, 7000, 10000, 20000, 25000, 50000,
}
_BARE_NUM_RE = re.compile(r"(?<!\d)(\d{3,6})(?!\d)")


def infer_bare_iu(title: str, quantity_value: Optional[int]) -> Optional[float]:
    """Infer an IU dosage from a bare (unitless) number for single-ingredient
    Vitamin D products. Returns None for combos or when no realistic IU value is
    present."""
    canon = dictionaries.supplement_ingredients(title)
    if canon != ["vitamin d3"]:
        return None
    t = pre_normalize_dosage(title)
    # Only realistic IU values are accepted, and the known pack count is excluded,
    # so pack sizes / years / lot numbers are not mistaken for a strength.
    candidates = {
        int(m.group(1))
        for m in _BARE_NUM_RE.finditer(t)
        if int(m.group(1)) in PREFERRED_IU and int(m.group(1)) != (quantity_value or -1)
    }
    return float(max(candidates)) if candidates else None


# Realistic Vitamin C mg strengths (written bare: "C 1000", "C-500").
PREFERRED_C_MG = {100, 200, 250, 300, 500, 750, 1000, 1500, 2000, 3000, 4000}


def infer_bare_mg(title: str, quantity_value: Optional[int]) -> Optional[float]:
    """Infer a mg dosage from a bare number for single-ingredient Vitamin C, whose
    strength is very often written without a unit ("Vitamin C 1000", "C-500")."""
    canon = dictionaries.supplement_ingredients(title)
    if canon != ["vitamin c"]:
        return None
    t = pre_normalize_dosage(title)
    candidates = {
        int(m.group(1))
        for m in _BARE_NUM_RE.finditer(t)
        if int(m.group(1)) in PREFERRED_C_MG and int(m.group(1)) != (quantity_value or -1)
    }
    return float(max(candidates)) if candidates else None


def extract_measures(title: str) -> Dict[str, Any]:
    """Extract pharma dosage (mg/mcg/iu/small-g) and container volume/weight from
    a title with robust unit/separator handling."""
    t = pre_normalize_dosage(title)
    out = {
        "dosage_value": None, "dosage_unit": None, "dosage_text": None,
        "volume_value": None, "volume_unit": None,
    }

    m = PHARMA_DOSAGE_RE.search(t)
    if m:
        try:
            out["dosage_value"] = _parse_num(m.group(1))
            out["dosage_unit"] = canon_unit(m.group(2))
            out["dosage_text"] = m.group(0).strip()
        except ValueError:
            pass
    if out["dosage_value"] is None:
        g = GRAM_RE.search(t)
        if g:
            try:
                val, unit = _parse_num(g.group(1)), canon_unit(g.group(2))
                if unit == "g" and val <= 5.0:
                    out["dosage_value"], out["dosage_unit"], out["dosage_text"] = val, "g", g.group(0).strip()
            except ValueError:
                pass

    # bottle volume (ml/l) — skip the denominator of a concentration like "10 mg/ml"
    for vm in VOLUME_RE.finditer(t):
        if vm.start() > 0 and t[vm.start() - 1] == "/":
            continue
        try:
            out["volume_value"] = _parse_num(vm.group(1))
            out["volume_unit"] = canon_unit(vm.group(2))
        except ValueError:
            pass
        break

    # large gram / kg -> container weight, stored on the volume dimension
    if out["volume_value"] is None:
        for g in GRAM_RE.finditer(t):
            try:
                val, unit = _parse_num(g.group(1)), canon_unit(g.group(2))
            except ValueError:
                continue
            if unit == "kg":
                out["volume_value"], out["volume_unit"] = val * 1000.0, "g"
                break
            if unit == "g" and val > 5.0:
                out["volume_value"], out["volume_unit"] = val, "g"
                break
    return out


def post_process_extraction(extracted: Dict[str, Any], title: str) -> Dict[str, Any]:
    """Reconcile extracted measures: fix volume-as-dosage misclassification and
    backfill from the title via extract_measures."""
    result = dict(extracted)
    du = canon_unit(result.get("dosage_unit") or "")

    if du in ("ml", "l"):
        result["volume_value"] = result.get("dosage_value")
        result["volume_unit"] = du
        result["dosage_value"] = result["dosage_unit"] = result["dosage_text"] = None
    elif du == "g" and (result.get("dosage_value") or 0) > 5.0:
        result["volume_value"] = result.get("dosage_value")
        result["volume_unit"] = "g"
        result["dosage_value"] = result["dosage_unit"] = result["dosage_text"] = None
    elif du:
        result["dosage_unit"] = du

    measures = extract_measures(title)
    if result.get("dosage_value") is None and measures["dosage_value"] is not None:
        result["dosage_value"] = measures["dosage_value"]
        result["dosage_unit"] = measures["dosage_unit"]
        result["dosage_text"] = measures["dosage_text"]
    if result.get("volume_value") is None and measures["volume_value"] is not None:
        result["volume_value"] = measures["volume_value"]
        result["volume_unit"] = measures["volume_unit"]

    # Last resort: recover a bare (unitless) strength written without a unit.
    if result.get("dosage_value") is None:
        iu = infer_bare_iu(title, result.get("quantity_value"))
        if iu is not None:
            result["dosage_value"], result["dosage_unit"] = iu, "iu"
        else:
            mg = infer_bare_mg(title, result.get("quantity_value"))
            if mg is not None:
                result["dosage_value"], result["dosage_unit"] = mg, "mg"

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


# Patterns used to strip measures / pack tokens before identity extraction.
# Fuse only short vitamer codes (d-3 -> d3, b-12 -> b12, omega-3 -> omega3); do
# NOT fuse strengths like C-1000 / E-400 (those numbers are dosages — leave the
# hyphen so it normalizes to a space and "vitamin c" is still detected).
_HYPHEN_CODE_RE = re.compile(r'([a-z])-(\d{1,2})\b')
_PACK_RES = [
    re.compile(r'\b\d+\s*[xх×]\s*\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|µg|μg|iu|ij|ml|l|kg|g|gr)\b', re.IGNORECASE),
    re.compile(r'\b\d+\s*[xх×]\s*\d+\b'),
    re.compile(r'\b[axх×]\s*\d+\b', re.IGNORECASE),
    re.compile(r'\b\d+\s*[xх×]\b'),
]
_QTY_FORM_RE = re.compile(rf'\b\d+\s*(?:{QUANTITY_UNIT_PATTERN}|obložen\w*|film\w*)\b', re.IGNORECASE)
_SPF_RE = re.compile(r'\bspf\s*\d+\+?\b', re.IGNORECASE)
_PERCENT_RE = re.compile(r'\b\d+(?:[.,]\d+)?\s*%')
_KEEP_SHORT = {"c", "d", "b", "k", "e"}


def _strip_measures_for_core(title: str) -> str:
    """Remove dosage / volume / pack-size / SPF tokens from a title so only the
    product identity words remain."""
    t = pre_normalize_dosage(title)
    t = re.sub(r'[®™©()\[\]/\\,;:!?]', ' ', t)
    t = _HYPHEN_CODE_RE.sub(r'\1\2', t)  # d-3 -> d3, omega-3 -> omega3
    for pat in _PACK_RES:
        t = pat.sub(' ', t)
    t = PHARMA_DOSAGE_RE.sub(' ', t)
    t = re.sub(r'\b\d+(?:[.,]\d+)?\s*(?:ml|l|kg|g|gr|gram|grama)\b', ' ', t, flags=re.IGNORECASE)
    t = _QTY_FORM_RE.sub(' ', t)
    t = _SPF_RE.sub(' ', t)
    t = _PERCENT_RE.sub(' ', t)
    return t


def _extract_core_ingredient(title: str, brand: Optional[str] = None) -> Optional[str]:
    """Extract a clean, canonical product identity.

    Detects whitelisted ingredients (mapped to their canonical names so brand /
    language / abbreviation variants collapse), then appends the remaining
    descriptor tokens with brand / noise / form / pack tokens removed. Word order
    is canonicalized (sorted ingredients first) so the same product yields the
    same identity regardless of how the vendor titled it.
    """
    cleaned = _strip_measures_for_core(title)
    canon, leftover = dictionaries.analyze_ingredients(cleaned, track_a_only=False)

    brand_tokens = set(dictionaries.normalize(brand).split()) if brand else set()

    descriptors: List[str] = []
    for tok in leftover:
        if tok in brand_tokens or dictionaries.is_brand(tok):
            continue
        if tok in dictionaries.NOISE_WORDS or tok in dictionaries.FORM_WORDS:
            continue
        if re.fullmatch(r'\d+(?:[.,]\d+)*', tok):
            continue
        if re.fullmatch(r'(?:\d+[a-z]+|[a-z]+\d+\+?)', tok) and tok not in dictionaries.SINGLE_TOKEN_ALIASES:
            continue
        if len(tok) < 2 and tok not in _KEEP_SHORT:
            continue
        descriptors.append(tok)

    parts = canon + descriptors
    parts = parts[:5]
    if not parts:
        # Last-resort fallback still strips brand / noise / form so brand tokens
        # never leak into the identity.
        parts = [
            t for t in leftover
            if t not in brand_tokens
            and not dictionaries.is_brand(t)
            and t not in dictionaries.NOISE_WORDS
            and t not in dictionaries.FORM_WORDS
            and len(t) >= 2
        ][:3]

    core = " ".join(parts).strip()
    if len(core) < 2:
        return None
    return core.title()



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
    """Extract the brand as a KNOWN brand found anywhere in the title (longest
    match). Returns Title Cased brand, or None. This avoids mistaking a product-line
    name (e.g. 'Iso Sensation') for a brand, which would strip the real identity."""
    brand = dictionaries.detect_brand(title)
    return brand.title() if brand else None


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

    measures = extract_measures(title)
    result["dosage_value"] = measures["dosage_value"]
    result["dosage_unit"] = measures["dosage_unit"]
    result["dosage_text"] = measures["dosage_text"]
    result["volume_value"] = measures["volume_value"]
    result["volume_unit"] = measures["volume_unit"]
    if measures["dosage_text"]:
        result["entities_found"].append({"label": "DOSAGE", "text": measures["dosage_text"]})

    # Pick the first plausible count. A "number + form" match whose number is too
    # large to be a pack size (e.g. "2000 TABLETE" = 2000 IU in tablet form, not
    # 2000 tablets) is skipped so it can be read as a dosage instead.
    quantity_match = None
    for m in QUANTITY_WITH_UNIT_RE.finditer(title):
        if int(m.group(1)) <= MAX_PACK_COUNT:
            quantity_match = m
            break
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
        if quantity_prefix_match and int(quantity_prefix_match.group(1)) <= MAX_PACK_COUNT:
            result["quantity_value"] = int(quantity_prefix_match.group(1))
            result["quantity_unit"] = "kom"
            result["entities_found"].append(
                {"label": "QUANTITY", "text": quantity_prefix_match.group(0)}
            )

    # Large powders/tubs (>=400 g, or any kg) are not cosmetics: a "krema"/"cream"
    # form here is a flavor false-positive ("cookies & cream", "keks i krema"), so
    # drop it. Small gram weights (30-250 g) can be genuine cosmetic creams -> keep.
    _vu, _vv = result.get("volume_unit"), result.get("volume_value") or 0
    if (_vu == "kg" or (_vu == "g" and _vv >= 400)) and normalize_form(result.get("form")) in _TOPICAL_FORMS:
        result["form"] = None

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

    # Direct assignment (no COALESCE): a re-extraction must fully overwrite, incl.
    # clearing a field to NULL when the new extraction finds nothing — COALESCE
    # would otherwise preserve stale values from a previous (noisier) run.
    query = """
        UPDATE "Product" AS p SET
            "extractedBrand" = v.brand::text,
            form = v.form::text,
            "dosageValue" = v.dosage_value::double precision,
            "dosageUnit" = v.dosage_unit::text,
            "quantityValue" = v.quantity_value::integer,
            "quantityUnit" = v.quantity_unit::text,
            "volumeValue" = v.volume_value::numeric,
            "volumeUnit" = v.volume_unit::text,
            "normalizedName" = v.normalized_name::text,
            "coreProductIdentity" = v.core_product_identity::text,
            "searchTokens" = v.search_tokens::text[],
            "keywordTags" = v.keyword_tags::text[],
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

            # Add canonical ingredient tokens (compact + spaced) so concept-based
            # search unifies spelling/language variants (magnezijum/magnesium/mg).
            canon, _ = dictionaries.analyze_ingredients(
                f"{product['title']} {core_identity or ''}", track_a_only=False
            )
            extra_tokens = []
            for c in canon:
                extra_tokens.append(dictionaries.canonical_compact(c))
                extra_tokens.extend(c.split())
            if extra_tokens:
                seen = set(search_tokens)
                search_tokens = list(search_tokens) + [t for t in extra_tokens if t and t not in seen]

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
