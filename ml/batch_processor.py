#!/usr/bin/env python3
"""
Batch processor for extracting dosage information from new products.
Uses the trained NER model and falls back to rule-based extraction.
Designed to run periodically via cron (e.g., every 6 hours).
"""

import os
import re
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

import spacy
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

# Configuration
MODEL_PATH = Path(__file__).parent / "models" / "dosage_ner"
BATCH_SIZE = 500
CONFIDENCE_THRESHOLD = 0.85
LOG_FILE = Path(__file__).parent / "batch_processor.log"

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
    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharmagician")
    return psycopg2.connect(db_url)


def load_model():
    """Load the trained NER model."""
    if MODEL_PATH.exists():
        logger.info(f"Loading model from {MODEL_PATH}")
        return spacy.load(MODEL_PATH)
    else:
        logger.warning("No trained model found, will use rule-based extraction only")
        return None


# Rule-based extraction patterns
DOSAGE_PATTERNS = [
    # Pattern: number + unit (e.g., "500mg", "500 mg", "0.5g")
    r"(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|μg|ml|l|iu|me|мг|г|мкг|мл|л|ме)\b",
    # Pattern: number/number + unit (e.g., "100mg/5ml")
    r"(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|μg)\s*/\s*(\d+(?:[.,]\d+)?)\s*(ml|l|мл|л)\b",
    # Pattern: number x number + unit (e.g., "20x500mg")
    r"(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|μg|мг|г|мкг)\b",
]

UNIT_NORMALIZATION = {
    "мг": "mg",
    "г": "g",
    "мкг": "mcg",
    "μg": "mcg",
    "мл": "ml",
    "л": "l",
    "ме": "iu",
}


def extract_dosage_rules(title: str) -> Optional[Dict[str, Any]]:
    """Extract dosage using rule-based patterns."""
    title_lower = title.lower()

    for pattern in DOSAGE_PATTERNS:
        match = re.search(pattern, title_lower, re.IGNORECASE)
        if match:
            groups = match.groups()

            if len(groups) == 2:
                # Simple pattern: value + unit
                value_str = groups[0].replace(",", ".")
                unit = groups[1].lower()

                try:
                    value = float(value_str)
                    unit = UNIT_NORMALIZATION.get(unit, unit)

                    return {
                        "dosage_value": value,
                        "dosage_unit": unit,
                        "confidence": 0.9,
                        "method": "rules"
                    }
                except ValueError:
                    continue

            elif len(groups) == 4:
                # Concentration pattern: value1/value2 + unit1/unit2
                try:
                    value1 = float(groups[0].replace(",", "."))
                    unit1 = UNIT_NORMALIZATION.get(groups[1].lower(), groups[1].lower())
                    value2 = float(groups[2].replace(",", "."))
                    unit2 = UNIT_NORMALIZATION.get(groups[3].lower(), groups[3].lower())

                    return {
                        "dosage_value": value1,
                        "dosage_unit": unit1,
                        "volume_value": value2,
                        "volume_unit": unit2,
                        "confidence": 0.85,
                        "method": "rules"
                    }
                except ValueError:
                    continue

            elif len(groups) == 3:
                # Multiplied pattern: count x value + unit
                try:
                    count = int(groups[0])
                    value = float(groups[1].replace(",", "."))
                    unit = UNIT_NORMALIZATION.get(groups[2].lower(), groups[2].lower())

                    return {
                        "dosage_value": value,
                        "dosage_unit": unit,
                        "count": count,
                        "confidence": 0.8,
                        "method": "rules"
                    }
                except ValueError:
                    continue

    return None


def extract_dosage_ml(nlp, title: str) -> Optional[Dict[str, Any]]:
    """Extract dosage using the ML model."""
    doc = nlp(title)

    for ent in doc.ents:
        if ent.label_ == "DOSAGE":
            # Parse the extracted dosage text
            text = ent.text.lower().strip()

            # Try to extract value and unit
            match = re.match(r"(\d+(?:[.,]\d+)?)\s*(\w+)", text)
            if match:
                try:
                    value = float(match.group(1).replace(",", "."))
                    unit = match.group(2)
                    unit = UNIT_NORMALIZATION.get(unit, unit)

                    return {
                        "dosage_value": value,
                        "dosage_unit": unit,
                        "confidence": 0.95,
                        "method": "ml"
                    }
                except ValueError:
                    continue

    return None


def extract_dosage(nlp, title: str) -> Optional[Dict[str, Any]]:
    """Extract dosage using ML model with rule-based fallback."""
    # Try ML extraction first if model is available
    if nlp:
        result = extract_dosage_ml(nlp, title)
        if result and result.get("confidence", 0) >= CONFIDENCE_THRESHOLD:
            return result

    # Fallback to rule-based extraction
    return extract_dosage_rules(title)


def get_unprocessed_products(conn, limit: int = BATCH_SIZE) -> list:
    """Get products not yet in ProductStandardization table."""
    cur = conn.cursor()

    # Find products that don't have a standardization entry
    cur.execute("""
        SELECT p.id, p.title
        FROM "Product" p
        LEFT JOIN "ProductStandardization" ps ON LOWER(p.title) = LOWER(ps.title)
        WHERE ps.id IS NULL
          AND p.title IS NOT NULL
          AND LENGTH(p.title) > 5
        ORDER BY p.id
        LIMIT %s
    """, (limit,))

    rows = cur.fetchall()
    cur.close()

    return [{"id": row[0], "title": row[1]} for row in rows]


def save_standardization(conn, records: list):
    """Save extracted standardization data to database."""
    if not records:
        return 0

    cur = conn.cursor()

    # Prepare data for bulk insert
    values = [
        (
            r["title"],
            r["title"],  # original_title
            None,  # category
            r["title"],  # normalized_name (same as title for now)
            r.get("dosage_value"),
            r.get("dosage_unit"),
            r.get("volume_value"),
            r.get("volume_unit"),
            r.get("confidence", 0.5),
            r.get("method", "batch_processor"),
        )
        for r in records
    ]

    # Insert with ON CONFLICT handling
    execute_values(
        cur,
        """
        INSERT INTO "ProductStandardization"
            (title, original_title, category, normalized_name,
             dosage_value, dosage_unit, volume_value, volume_unit,
             confidence, source)
        VALUES %s
        ON CONFLICT (title) DO UPDATE SET
            dosage_value = EXCLUDED.dosage_value,
            dosage_unit = EXCLUDED.dosage_unit,
            volume_value = EXCLUDED.volume_value,
            volume_unit = EXCLUDED.volume_unit,
            confidence = EXCLUDED.confidence,
            source = EXCLUDED.source,
            updated_at = CURRENT_TIMESTAMP
        """,
        values
    )

    inserted = cur.rowcount
    conn.commit()
    cur.close()

    return inserted


def process_batch():
    """Process a batch of unprocessed products."""
    logger.info("=" * 50)
    logger.info(f"Starting batch processing at {datetime.now()}")
    logger.info("=" * 50)

    # Load model
    nlp = load_model()

    # Connect to database
    conn = get_db_connection()

    total_processed = 0
    total_extracted = 0

    while True:
        # Get unprocessed products
        products = get_unprocessed_products(conn, BATCH_SIZE)

        if not products:
            logger.info("No more unprocessed products")
            break

        logger.info(f"Processing batch of {len(products)} products")

        records_to_save = []

        for product in tqdm(products, desc="Extracting"):
            result = extract_dosage(nlp, product["title"])

            record = {
                "title": product["title"],
                "confidence": result.get("confidence", 0) if result else 0,
                "method": result.get("method", "none") if result else "none"
            }

            if result:
                record.update(result)
                total_extracted += 1

            records_to_save.append(record)

        # Save batch
        saved = save_standardization(conn, records_to_save)
        total_processed += len(products)

        logger.info(f"Saved {saved} records")

        # Limit total processing to avoid long-running jobs
        if total_processed >= 10000:
            logger.info("Reached batch limit, stopping")
            break

    conn.close()

    logger.info("=" * 50)
    logger.info(f"Batch processing complete")
    logger.info(f"Total processed: {total_processed}")
    logger.info(f"Total with dosage extracted: {total_extracted}")
    logger.info(f"Extraction rate: {total_extracted/max(1, total_processed)*100:.1f}%")
    logger.info("=" * 50)


def main():
    try:
        process_batch()
    except Exception as e:
        logger.error(f"Batch processing failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    main()
