#!/usr/bin/env python3
"""
Canonicalize per-product identities for the bare-brand catch-all groups.

The rule-based extractor collapses some branded products to a bare brand because
their only distinguishing token is a stage number (Aptamil 1/2/3), a 2-char
variant (Oligovit SE/HER), or a noise-classified line word. This script finds
those groups, asks Claude to assign each product a canonical brand+line identity,
and writes it to Product.canonicalIdentity — which matching.BuildGroupKey trusts
verbatim (see migrations/012_canonical_identity.sql).

Self-contained and idempotent. Reuses the Go grouping (cmd/groupdump) as the
single source of truth, so it never drifts from production grouping.

  export ANTHROPIC_API_KEY=...            # required
  export DATABASE_URL=postgres://...      # defaults to local
  python ml/scripts/canonicalize_identities.py            # full run
  python ml/scripts/canonicalize_identities.py --dry-run  # preview, no DB writes
  python ml/scripts/canonicalize_identities.py --min-size 8 --concurrency 8
"""
import argparse
import collections
import concurrent.futures
import csv
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import anthropic
import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))
import dictionaries as d  # noqa: E402  (shared normalize / FORM_WORDS)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("canonicalize")

MODEL = "claude-opus-4-8"
PACK = re.compile(r"^(a\d+|x\d+|\d+x?|\d+(kom|kaps?|tab|tbl|tableta|kapsula|ml|g|gr|mg|mcg|kg|doza|kesica|kesice)?)$")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["assignments"],
    "properties": {
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "canonical"],
                "properties": {"id": {"type": "string"}, "canonical": {"type": "string"}},
            },
        }
    },
}

PROMPT = """You are canonicalizing one brand's product catalog for a SERBIAN pharmacy price-comparison site. Assign EACH product a CANONICAL IDENTITY — the brand plus the smallest line/stage/variant that distinguishes it — so the SAME real product (titled differently by different vendors) gets the IDENTICAL string, and DIFFERENT products get different strings.

Brand: {brand}
Products (id <TAB> title):
{rows}

Rules:
- Title Case. Include the brand + the minimal distinguishing tokens.
- KEEP stage numbers — infant formula / pregnancy stages "1"/"2"/"3" ARE the identity (e.g. "Aptamil 1", "Femibion 2", "Novalac 3").
- KEEP short variant codes (e.g. "Oligovit Se", "Oligovit Her") and named lines ("Supradyn Energy", "Aptamil Comfort", "Centrum Silver").
- Do NOT include pack size (30 tableta / a30 / 800g), price, or vendor name (e.g. "Apoteka Milica").
- If the brand is genuinely ONE product sold in different pack sizes, give EVERY product the same canonical (just the product name) — do not invent fake distinctions.

Return every product's id with its canonical string."""


def run_groupdump(db_url: str) -> str:
    """Run the Go grouping over the live DB and return the per-product CSV path."""
    out = tempfile.NamedTemporaryFile(suffix=".csv", delete=False).name
    log.info("running cmd/groupdump ...")
    subprocess.run(
        ["go", "run", "./cmd/groupdump", "-csv", out],
        cwd=str(ROOT), env={**os.environ, "DATABASE_URL": db_url},
        check=True, stdout=subprocess.DEVNULL,
    )
    return out


def _sig(title: str, brand: str) -> str:
    bt = set(d.normalize(brand).split())
    keep = [t for t in d.normalize(title).split()
            if t not in bt and not PACK.match(t) and t not in d.FORM_WORDS]
    return " ".join(sorted(keep))


def find_targets(csv_path: str, min_size: int):
    """Bare-brand catch-all groups (single-token display) holding >=2 distinct products."""
    by_key = collections.defaultdict(list)
    with open(csv_path, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            if r["method"] == "brand-core":
                by_key[r["key"]].append(r)
    targets = []
    for members in by_key.values():
        disp = members[0]["display"]
        if len(disp.split()) != 1 or len(members) < min_size:
            continue
        sigs = {_sig(m["title"], m["brand"] or disp) for m in members}
        sigs.discard("")
        if len(sigs) < 2:  # one real product across pack sizes -> leave it
            continue
        targets.append({
            "brand": members[0]["brand"] or disp, "display": disp,
            "products": [{"id": m["id"], "title": m["title"]} for m in members],
        })
    targets.sort(key=lambda t: -len(t["products"]))
    return targets


def canonicalize(client: anthropic.Anthropic, target: dict) -> dict:
    rows = "\n".join(f"{p['id']}\t{p['title'][:120]}" for p in target["products"])
    msg = client.messages.create(
        model=MODEL, max_tokens=8000,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}, "effort": "low"},
        messages=[{"role": "user", "content": PROMPT.format(brand=target["display"], rows=rows)}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    valid = {p["id"] for p in target["products"]}
    out = {}
    for a in json.loads(text).get("assignments", []):
        cid = (a.get("canonical") or "").strip()
        if a.get("id") in valid and cid:
            out[a["id"]] = cid
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-size", type=int, default=8, help="min products in a catch-all group to target")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--limit-brands", type=int, default=0, help="cap brands processed (0 = all)")
    ap.add_argument("--dry-run", action="store_true", help="print assignments, do not write")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharma_search?sslmode=disable")
    if not os.getenv("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is not set")

    targets = find_targets(run_groupdump(db_url), args.min_size)
    if args.limit_brands:
        targets = targets[:args.limit_brands]
    n_prod = sum(len(t["products"]) for t in targets)
    log.info("targets: %d brands, %d products", len(targets), n_prod)

    client = anthropic.Anthropic()
    pairs: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {ex.submit(canonicalize, client, t): t for t in targets}
        for fut in concurrent.futures.as_completed(futs):
            t = futs[fut]
            try:
                got = fut.result()
                pairs.update(got)
                log.info("  %-22s %d/%d", t["display"][:22], len(got), len(t["products"]))
            except Exception as e:  # noqa: BLE001 — one brand failing must not abort the run
                log.warning("  %-22s FAILED: %s", t["display"][:22], str(e)[:80])

    log.info("canonical identities resolved: %d", len(pairs))
    if args.dry_run:
        for pid, cid in list(pairs.items())[:30]:
            log.info("    %s -> %s", pid, cid)
        log.info("dry-run: no DB writes")
        return

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute('UPDATE "Product" SET "canonicalIdentity" = NULL WHERE "canonicalIdentity" IS NOT NULL')
    execute_values(
        cur,
        'UPDATE "Product" p SET "canonicalIdentity" = v.cid FROM (VALUES %s) AS v(id, cid) WHERE p.id = v.id',
        list(pairs.items()),
    )
    conn.commit()
    cur.execute('SELECT count(*) FROM "Product" WHERE "canonicalIdentity" IS NOT NULL')
    log.info("rows with canonicalIdentity now: %d", cur.fetchone()[0])
    conn.close()


if __name__ == "__main__":
    main()
