#!/usr/bin/env python3
"""
Assign each product a CANONICAL CATEGORY for the brand/category filtering feature.

The raw scraped Product.category is too noisy to filter on (1000+ multilingual,
vendor-specific values + URL-fragment junk). This script derives a clean canonical
category (one of ~12) per product from several signals, in confidence order, and
writes it to Product.canonicalCategory (read by the search backend for faceting +
filtering). Idempotent: clears all canonicalCategory, then rewrites.

Signals (highest confidence first):
  1. mined raw->canonical map (ml/data/category_map.json) for SPECIFIC categories
     a vendor labelled explicitly but our heuristics can't detect (sex-shop, baby,
     hair, oral, sun, devices, sports, personal-care).
  2. cosmetic brand (Eucerin/Vichy/...) -> Cosmetics & Skincare.
  3. detected Track-A ingredient -> Supplements & Vitamins / OTC Medicines.
  4. mined map for the general buckets (Cosmetics / Supplements / OTC).
  5. form fallback (krema->Cosmetics, kapsule->Supplements).
  Else: NULL (uncategorized -> not shown in the category facet; still searchable).

  export DATABASE_URL=postgres://...      # defaults to local
  python ml/scripts/assign_categories.py            # full run
  python ml/scripts/assign_categories.py --dry-run  # show distribution, no writes
"""
import argparse
import collections
import json
import logging
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))
import dictionaries as d  # noqa: E402  shared normalize / brand / ingredient helpers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("assign_categories")

CATEGORY_MAP = json.loads((ROOT / "ml" / "data" / "category_map.json").read_text())

# Canonical categories a vendor labels explicitly but our brand/ingredient/form
# heuristics cannot reliably derive -> trust the mined raw mapping first.
SPECIFIC = {
    "Sexual Health", "Baby & Mom", "Oral Care", "Hair Care", "Sun Care",
    "Medical Devices", "Sports Nutrition", "Personal Care",
}
# General buckets the heuristics CAN derive -> only used as a mid-priority fallback.
GENERAL = {"Cosmetics & Skincare", "Supplements & Vitamins", "OTC Medicines"}

# Raw categories that are genuinely NOT pharma products (gym equipment, clothing, pets,
# books, accessories). The mined map sends these to "Other", but "Other" falls through
# to the brand/ingredient/form heuristics which would mis-bucket e.g. boxing gloves or
# shaker bottles into Supplements/Cosmetics. Short-circuit them to uncategorized so they
# never appear in the category facet. (Generic vendor labels like "Apoteka Net"/"Biofarm"
# are intentionally NOT here — those carry real products and should fall through.)
JUNK_CATEGORIES = {
    "Garderoba", "Fitnes Oprema", "Fitnes oprema", "fitnes-oprema", "fitness-oprema",
    "Box Oprema", "Oprema za teretanu", "sportska-oprema", "Dodatna Oprema",
    "Kućni ljubimci", "ljubimci", "Literatura", "Gurtne", "gurtne",
    "venum-i-ringhorns", "obuca-carape-ulosci", "obuca-carape-i-ulosci",
    "tekstil", "odeca", "Šejkeri", "Plastični šejkeri", "Mirišljave sveće",
    "Održavanje naočara", "Muška Odeća za Trening", "Muške Majice za Trening",
}

# Form -> category, last-resort fallback (form is ~94% populated, very clean).
FORM_CATEGORY = {
    "krema": "Cosmetics & Skincare", "serum": "Cosmetics & Skincare",
    "losion": "Cosmetics & Skincare", "gel": "Cosmetics & Skincare",
    "mast": "OTC Medicines",
    "kapsule": "Supplements & Vitamins", "kapsul": "Supplements & Vitamins",
    "kapsuli": "Supplements & Vitamins", "capsula": "Supplements & Vitamins",
    "tablete": "Supplements & Vitamins", "tableti": "Supplements & Vitamins",
    "tbl": "Supplements & Vitamins", "tabs": "Supplements & Vitamins",
    "tablets": "Supplements & Vitamins", "pastila": "Supplements & Vitamins",
    "pastile": "Supplements & Vitamins", "bombone": "Supplements & Vitamins",
    "drazeja": "Supplements & Vitamins", "mikrotableta": "Supplements & Vitamins",
    "kesice": "Supplements & Vitamins",
}


def ingredient_category(text: str):
    """Map a detected Track-A ingredient to a canonical category, or None."""
    canons, _ = d.analyze_ingredients(text or "")
    if not canons:
        return None
    cats = {d._canonical_category.get(c) for c in canons}
    if "supplement" in cats:
        return "Supplements & Vitamins"
    if cats & {"otc-drug", "otc", "drug"}:
        return "OTC Medicines"
    return None


def assign(raw_category: str, brand: str, core: str, title: str, form: str):
    raw = (raw_category or "").strip()
    # 0. genuinely non-product vendor bucket -> uncategorized (skip heuristics)
    if raw in JUNK_CATEGORIES:
        return None
    c_raw = CATEGORY_MAP.get(raw)
    # 1. explicit vendor label for a domain heuristics can't see
    if c_raw in SPECIFIC:
        return c_raw
    # 2. known cosmetic brand
    if d.is_cosmetic_brand(brand):
        return "Cosmetics & Skincare"
    # 3. detected supplement / OTC ingredient
    c_ing = ingredient_category(core or title)
    if c_ing:
        return c_ing
    # 4. vendor's general bucket
    if c_raw in GENERAL:
        return c_raw
    # 5. form fallback
    c_form = FORM_CATEGORY.get(d.normalize(form))
    if c_form:
        return c_form
    return None  # uncategorized


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="print distribution, do not write")
    ap.add_argument("--batch", type=int, default=5000)
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, COALESCE(category,''), COALESCE("extractedBrand",''),
               COALESCE("coreProductIdentity",''), title, COALESCE(form,'')
        FROM "Product"
    """)
    rows = cur.fetchall()
    log.info("scoring %d products", len(rows))

    pairs = []
    dist = collections.Counter()
    for pid, raw, brand, core, title, form in rows:
        cat = assign(raw, brand, core, title, form)
        dist[cat or "(uncategorized)"] += 1
        if cat:
            pairs.append((pid, cat))

    total = len(rows)
    log.info("category distribution:")
    for cat, n in dist.most_common():
        log.info("  %-26s %7d (%.1f%%)", cat, n, 100 * n / total)
    log.info("categorized: %d / %d (%.1f%%)", len(pairs), total, 100 * len(pairs) / total)

    if args.dry_run:
        log.info("dry-run: no DB writes")
        return

    cur.execute('UPDATE "Product" SET "canonicalCategory" = NULL WHERE "canonicalCategory" IS NOT NULL')
    for i in range(0, len(pairs), args.batch):
        execute_values(
            cur,
            'UPDATE "Product" p SET "canonicalCategory" = v.cat FROM (VALUES %s) AS v(id, cat) WHERE p.id = v.id',
            pairs[i:i + args.batch],
        )
    conn.commit()
    cur.execute('SELECT count(*) FROM "Product" WHERE "canonicalCategory" IS NOT NULL')
    log.info("rows with canonicalCategory now: %d", cur.fetchone()[0])
    conn.close()


if __name__ == "__main__":
    main()
