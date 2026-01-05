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
from psycopg2.extras import execute_batch
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


def extract_entities(nlp, title: str) -> Dict[str, Any]:
    """Extract all entities from a product title."""
    doc = nlp(title)

    result = {
        "brand": None,
        "dosage_value": None,
        "dosage_unit": None,
        "dosage_text": None,
        "form": None,
        "quantity_value": None,
        "quantity_unit": None,
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


def get_products_missing_data(conn, limit: int = BATCH_SIZE, update_all: bool = False) -> List[Dict]:
    """Get products with missing extracted data."""
    cur = conn.cursor()

    if update_all:
        # Get all products
        query = """
            SELECT id, title
            FROM "Product"
            WHERE title IS NOT NULL AND LENGTH(title) > 5
            ORDER BY id
            LIMIT %s
        """
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


def update_product_table(conn, updates: List[Dict]) -> int:
    """Update the Product table with extracted data."""
    if not updates:
        return 0

    cur = conn.cursor()

    query = """
        UPDATE "Product" SET
            "extractedBrand" = COALESCE(%(brand)s, "extractedBrand"),
            form = COALESCE(%(form)s, form),
            "dosageValue" = COALESCE(%(dosage_value)s, "dosageValue"),
            "dosageUnit" = COALESCE(%(dosage_unit)s, "dosageUnit"),
            "quantityValue" = COALESCE(%(quantity_value)s, "quantityValue"),
            "quantityUnit" = COALESCE(%(quantity_unit)s, "quantityUnit"),
            "processedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = %(id)s
    """

    execute_batch(cur, query, updates, page_size=100)
    updated = cur.rowcount
    conn.commit()
    cur.close()

    return updated


def update_standardization_table(conn, updates: List[Dict]) -> int:
    """Update or insert into ProductStandardization table."""
    if not updates:
        return 0

    cur = conn.cursor()

    # Use upsert pattern
    query = """
        INSERT INTO "ProductStandardization" (
            title, "originalTitle", "normalizedName",
            "brandName", "productForm",
            "dosageValue", "dosageUnit",
            "quantityValue", "quantityUnit",
            confidence, source
        ) VALUES (
            %(title)s, %(title)s, LOWER(%(title)s),
            %(brand)s, %(form)s,
            %(dosage_value)s, %(dosage_unit)s,
            %(quantity_value)s, %(quantity_unit)s,
            0.85, 'ml_extraction'
        )
        ON CONFLICT ("originalTitle", title) DO UPDATE SET
            "brandName" = COALESCE(EXCLUDED."brandName", "ProductStandardization"."brandName"),
            "productForm" = COALESCE(EXCLUDED."productForm", "ProductStandardization"."productForm"),
            "dosageValue" = COALESCE(EXCLUDED."dosageValue", "ProductStandardization"."dosageValue"),
            "dosageUnit" = COALESCE(EXCLUDED."dosageUnit", "ProductStandardization"."dosageUnit"),
            "quantityValue" = COALESCE(EXCLUDED."quantityValue", "ProductStandardization"."quantityValue"),
            "quantityUnit" = COALESCE(EXCLUDED."quantityUnit", "ProductStandardization"."quantityUnit"),
            confidence = GREATEST(EXCLUDED.confidence, "ProductStandardization".confidence),
            "updatedAt" = CURRENT_TIMESTAMP
    """

    execute_batch(cur, query, updates, page_size=100)
    updated = cur.rowcount
    conn.commit()
    cur.close()

    return updated


def process_products(nlp, conn, limit: int = 0, update_all: bool = False,
                     update_standardization: bool = True):
    """Process products and extract missing data."""

    total_processed = 0
    total_with_brand = 0
    total_with_dosage = 0
    total_with_form = 0
    total_with_quantity = 0

    while True:
        # Get batch of products
        products = get_products_missing_data(conn, BATCH_SIZE, update_all)

        if not products:
            logger.info("No more products to process")
            break

        logger.info(f"Processing batch of {len(products)} products")

        updates = []

        for product in tqdm(products, desc="Extracting entities"):
            extracted = extract_entities(nlp, product["title"])

            update_record = {
                "id": product["id"],
                "title": product["title"],
                "brand": extracted["brand"],
                "form": extracted["form"],
                "dosage_value": extracted["dosage_value"],
                "dosage_unit": extracted["dosage_unit"],
                "dosage_text": extracted["dosage_text"],
                "quantity_value": extracted["quantity_value"],
                "quantity_unit": extracted["quantity_unit"],
            }

            updates.append(update_record)

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
        if update_standardization:
            updated_std = update_standardization_table(conn, updates)
            logger.info(f"Updated {updated_std} standardization records")

        total_processed += len(products)

        # Check limit
        if limit > 0 and total_processed >= limit:
            logger.info(f"Reached limit of {limit} products")
            break

        # If update_all is False and we're getting the same products, break
        if not update_all:
            # Get next batch to check if we're making progress
            next_products = get_products_missing_data(conn, 1, update_all)
            if next_products and next_products[0]["id"] == products[0]["id"]:
                logger.info("No more products with missing data")
                break

    return {
        "total_processed": total_processed,
        "with_brand": total_with_brand,
        "with_dosage": total_with_dosage,
        "with_form": total_with_form,
        "with_quantity": total_with_quantity,
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

    conn.close()
    logger.info("\nDone!")


if __name__ == "__main__":
    main()
