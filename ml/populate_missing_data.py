#!/usr/bin/env python3
"""
Populate missing product data using the trained multi-entity NER model.
Extracts: BRAND, DOSAGE, FORM, QUANTITY from product titles.

Updates both Product and ProductStandardization tables.

GPU Support:
- macOS (Apple Silicon): Uses Metal via spacy[apple]
- Windows/Linux (NVIDIA): Uses CUDA via spacy[cuda12x]
"""

import os
import re
import sys
import logging
import platform
import argparse
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

import spacy
import psycopg2
from psycopg2.extras import execute_batch, execute_values
from dotenv import load_dotenv
from tqdm import tqdm

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


def setup_gpu() -> Tuple[bool, str]:
    """Detect and configure GPU acceleration (Metal on macOS, CUDA on Windows/Linux)."""
    system = platform.system()
    gpu_available = False
    gpu_type = "CPU"

    try:
        if system == "Darwin":
            # macOS - check for Metal (Apple Silicon) via thinc_apple_ops
            try:
                from thinc.api import get_current_ops
                ops = get_current_ops()
                if ops.name == "apple":
                    gpu_available = True
                    gpu_type = "Metal (Apple Silicon)"
                    logger.info("Metal acceleration enabled via thinc_apple_ops")
                else:
                    # Try to import and it will auto-register
                    import thinc_apple_ops
                    ops = get_current_ops()
                    if ops.name == "apple":
                        gpu_available = True
                        gpu_type = "Metal (Apple Silicon)"
                        logger.info("Metal acceleration enabled via thinc_apple_ops")
            except ImportError:
                logger.warning("Metal support not available. Install with: pip install 'spacy[apple]'")
        else:
            # Windows/Linux - try CUDA
            try:
                gpu_available = spacy.prefer_gpu()
                if gpu_available:
                    gpu_type = "CUDA"
                    # Try to get GPU info
                    try:
                        import cupy
                        device = cupy.cuda.Device()
                        logger.info(f"CUDA GPU acceleration enabled: {device.compute_capability}")
                    except Exception:
                        logger.info("CUDA GPU acceleration enabled")
                else:
                    logger.warning("CUDA not available. Install with: pip install 'spacy[cuda12x]'")
            except Exception as e:
                logger.warning(f"CUDA initialization failed: {e}")
    except Exception as e:
        logger.warning(f"GPU detection error: {e}")

    if not gpu_available:
        logger.info("Using CPU for inference")

    return gpu_available, gpu_type


def get_db_connection():
    """Connect to PostgreSQL database."""
    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharmagician")
    return psycopg2.connect(db_url)


def load_model():
    """Load the trained multi-entity NER model."""
    if MODEL_PATH.exists():
        logger.info(f"Loading model from {MODEL_PATH}")
        return spacy.load(MODEL_PATH)
    else:
        logger.error(f"Model not found at {MODEL_PATH}")
        logger.error("Run 'python train_multi_ner.py' first to train the model.")
        sys.exit(1)


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


def extract_entities(nlp, title: str) -> Dict[str, Any]:
    """Extract all entities from a product title."""
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
              AND (
                  "extractedBrand" IS NULL
                  OR form IS NULL
                  OR "dosageValue" IS NULL
                  OR "quantityValue" IS NULL
              )
            ORDER BY id
            LIMIT %s
        """
        cur.execute(query, (limit,))

    rows = cur.fetchall()
    cur.close()

    return [{"id": row[0], "title": row[1]} for row in rows]


def get_standardizations_for_titles(conn, titles: List[str]) -> Dict[str, Dict[str, Any]]:
    """Fetch standardization data for matching product titles."""
    if not titles:
        return {}

    cur = conn.cursor()
    query = """
        SELECT
            "originalTitle",
            title,
            "brandName",
            "productForm",
            "dosageValue",
            "dosageUnit",
            "quantityValue",
            "quantityUnit"
        FROM "ProductStandardization"
        WHERE "originalTitle" = ANY(%s) OR title = ANY(%s)
    """
    cur.execute(query, (titles, titles))
    rows = cur.fetchall()
    cur.close()

    standardizations: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        original_title, title, brand, form, dosage_value, dosage_unit, quantity_value, quantity_unit = row
        record = {
            "brand": brand,
            "form": form,
            "dosage_value": dosage_value,
            "dosage_unit": dosage_unit,
            "quantity_value": quantity_value,
            "quantity_unit": quantity_unit,
        }
        if original_title and original_title not in standardizations:
            standardizations[original_title] = record
        if title and title not in standardizations:
            standardizations[title] = record

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
            "normalizedName" = v.normalized_name::text,
            "coreProductIdentity" = v.core_product_identity::text,
            "processedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (VALUES %s) AS v(
            id, brand, form, dosage_value, dosage_unit, quantity_value, quantity_unit,
            volume_value, volume_unit, normalized_name, core_product_identity
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

    rows = [
        (
            update["title"],
            update["title"],
            update["title"],  # normalizedName
            update["brand"],
            update["form"],
            update["dosage_value"],
            update["dosage_unit"],
            update["quantity_value"],
            update["quantity_unit"],
            0.8,  # confidence
            "ml",  # source
        )
        for update in unique_updates
    ]

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
            confidence, source
        ) VALUES %s
        ON CONFLICT ("originalTitle", title) DO UPDATE SET
            "brandName" = COALESCE(EXCLUDED."brandName", "ProductStandardization"."brandName"),
            "productForm" = COALESCE(EXCLUDED."productForm", "ProductStandardization"."productForm"),
            "dosageValue" = COALESCE(EXCLUDED."dosageValue", "ProductStandardization"."dosageValue"),
            "dosageUnit" = COALESCE(EXCLUDED."dosageUnit", "ProductStandardization"."dosageUnit"),
            "quantityValue" = COALESCE(EXCLUDED."quantityValue", "ProductStandardization"."quantityValue"),
            "quantityUnit" = COALESCE(EXCLUDED."quantityUnit", "ProductStandardization"."quantityUnit"),
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
                       AND ("extractedBrand" IS NULL OR form IS NULL
                            OR "dosageValue" IS NULL OR "quantityValue" IS NULL)''')
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

        ml_indexes: List[int] = []
        ml_titles: List[str] = []
        standardization_missing_by_index: Dict[int, bool] = {}

        for idx, product in enumerate(products):
            standardization = standardizations.get(product["title"])
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
                    ]
                )
            standardization_missing_by_index[idx] = standardization_missing

            if not standardization or standardization_missing:
                ml_indexes.append(idx)
                ml_titles.append(product["title"])

        ml_extracted_by_index: Dict[int, Dict[str, Any]] = {}
        if ml_titles:
            ml_pipe = nlp.pipe(ml_titles, batch_size=128)
            for i, doc in enumerate(tqdm(ml_pipe, total=len(ml_titles), desc="Extracting entities")):
                ml_extracted_by_index[ml_indexes[i]] = extract_entities_from_doc(doc)

        for idx, product in enumerate(products):
            standardization = standardizations.get(product["title"])
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
                }
            else:
                ml_extracted = ml_extracted_by_index.get(idx) or extract_entities(nlp, product["title"])
                if standardization:
                    extracted = {
                        "brand": standardization["brand"] or ml_extracted["brand"],
                        "form": standardization["form"] or ml_extracted["form"],
                        "dosage_value": standardization["dosage_value"] or ml_extracted["dosage_value"],
                        "dosage_unit": standardization["dosage_unit"] or ml_extracted["dosage_unit"],
                        "dosage_text": ml_extracted["dosage_text"],
                        "quantity_value": standardization["quantity_value"] or ml_extracted["quantity_value"],
                        "quantity_unit": standardization["quantity_unit"] or ml_extracted["quantity_unit"],
                    }
                else:
                    extracted = ml_extracted

            # Post-process: fix misclassified dosage (ml→volume, find real pharma dosage)
            extracted = post_process_extraction(extracted, product["title"])

            # Generate normalized name and core identity
            norm_name = generate_normalized_name(extracted, product["title"])
            core_identity = _extract_core_ingredient(product["title"], extracted.get("brand"))

            update_record = {
                "id": product["id"],
                "title": product["title"],
                "brand": extracted["brand"],
                "form": extracted["form"],
                "dosage_value": extracted["dosage_value"],
                "dosage_unit": extracted["dosage_unit"],
                "dosage_text": extracted.get("dosage_text"),
                "quantity_value": extracted["quantity_value"],
                "quantity_unit": extracted["quantity_unit"],
                "volume_value": extracted.get("volume_value"),
                "volume_unit": extracted.get("volume_unit"),
                "normalized_name": norm_name,
                "core_product_identity": core_identity,
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

        # Update last_id for pagination (when update_all is True)
        if update_all and products:
            last_id = products[-1]["id"]

        # Check limit
        if limit > 0 and total_processed >= limit:
            logger.info(f"Reached limit of {limit} products")
            break

        # If update_all is False and we're getting the same products, break
        if not update_all:
            # Get next batch to check if we're making progress
            next_products = get_products_missing_data(conn, 1, update_all, last_id)
            if next_products and next_products[0]["id"] == products[0]["id"]:
                logger.info("No more products with missing data")
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
        description="Populate missing product data using NER model"
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

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Populate Missing Product Data")
    logger.info("=" * 60)

    # Setup GPU
    gpu_available, gpu_type = setup_gpu()
    logger.info(f"Compute device: {gpu_type}")

    # Load model
    nlp = load_model()
    logger.info(f"Model loaded with {len(nlp.pipe_names)} pipes: {nlp.pipe_names}")

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
            extracted = extract_entities(nlp, title)
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
