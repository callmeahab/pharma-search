#!/usr/bin/env python3
"""
Build the canonical matching dictionaries consumed by BOTH the Go backend
(internal/matching/data/*.json via go:embed) and the Python ML pipeline
(ml/populate_missing_data.py).

Source of truth for the raw mined data: ml/data/grouping_intel.json
(produced by the grouping-redesign intel workflow against the live DB).

This script cleans / normalizes / de-conflicts that raw data and writes three
files into internal/matching/data/:

  ingredients.json  - whitelisted canonical ingredients + aliases + category.
                      Only supplement / otc-drug ingredients are eligible for
                      "ingredient + strength" merging (Track A). Cosmetic
                      actives are listed but flagged so they are NOT auto-merged
                      by ingredient.
  brands.json       - { "strip": [...], "keep": [...] }. `strip` = brand tokens
                      removed from the ingredient identity; `keep` = words that
                      look like brands but are real ingredient identity and must
                      never be stripped.
  stopwords.json    - { "noise": [...], "forms": [...] } removed from the
                      ingredient identity.

Run:  python3 ml/scripts/build_dictionaries.py
"""

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INTEL = ROOT / "ml" / "data" / "grouping_intel.json"
OUT_DIR = ROOT / "internal" / "matching" / "data"

# --- normalization (mirror of Go matching.NormalizeText / py normalize_lookup_text) ---
_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e", "ж": "z",
    "з": "z", "и": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj", "м": "m", "н": "n",
    "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "ћ": "c", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "џ": "dz", "ш": "s",
}
_LATIN_DIACRITICS = {"đ": "dj", "č": "c", "ć": "c", "š": "s", "ž": "z"}


def normalize(text: str) -> str:
    if not text:
        return ""
    text = text.replace("&amp;", " ").replace("&", " ")
    out = []
    for ch in text.lower():
        if ch in _CYRILLIC:
            out.append(_CYRILLIC[ch])
        elif ch in _LATIN_DIACRITICS:
            out.append(_LATIN_DIACRITICS[ch])
        else:
            out.append(ch)
    text = "".join(out)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^0-9a-z]+", " ", text)
    return " ".join(text.split())


def norm_list(values):
    seen, result = set(), []
    for v in values:
        n = normalize(v)
        if n and n not in seen:
            seen.add(n)
            result.append(n)
    return result


# Aliases that collide with units / generic words and would cause false merges
# if used for ingredient *detection*. Dropped from alias lists.
ALIAS_DROP = {"mg", "protein", "proteini", "proteina", "proteinski", "proteinska",
              "monohydrate", "folic", "aha", "bha", "mint"}

# Pre-combined canonicals we drop: component detection handles combos generically
# (e.g. "magnezijum b6" -> {magnezijum, vitamin b6}; "d3 k2" -> {vitamin d3, vitamin k2}).
# We also drop whey/vegan protein: protein powders are BRANDED LINES (Iso Sensation,
# Gold Standard, ...) differentiated by brand/line/flavor/size, not a generic
# "whey protein" commodity. Grouping all whey into one bucket is as wrong as
# grouping every face cream as "cream", so they go to the brand-line (Track B) path.
CANONICAL_DROP = {"magnezijum b6", "vitamin d3 k2", "whey protein", "vegan protein"}

# Flavor / sport-supplement descriptor words and generic brand-suffix words. These
# pollute branded-line identities (protein/gainer/etc.) and must be stripped so the
# product LINE survives (e.g. "Iso Sensation Chocolate Fudge 910g" -> "iso sensation").
CURATED_NOISE = [
    # flavors (SR/EN)
    "cokolada", "cokoladica", "cokoladni", "coko", "choco", "choko", "chocolate",
    "vanila", "vanilla", "vanil", "jagoda", "jagode", "strawberry", "banana", "banane",
    "kokos", "kokosa", "coconut", "karamela", "karamel", "caramel", "lesnik", "lesnika",
    "hazelnut", "fudge", "cookies", "cookie", "keks", "keksa", "kafa", "kafe", "coffee",
    "cappuccino", "capuccino", "tiramisu", "ananas", "pineapple", "malina", "maline",
    "visnja", "visnje", "breskva", "kupina", "borovnica", "borovnice", "mango", "limun",
    "limuna", "lemon", "narandza", "pomorandza", "orange", "jabuka", "kruska", "smokva",
    "pistac", "badem", "badema", "oraha", "slani", "salted", "neutralni", "neutralna",
    "neutralno", "neutral", "nezasladjeni", "bez", "ukus", "ukusa", "okus", "okusa",
    "flavor", "flavour", "zero", "pina", "colada", "cheesecake", "marshmallow",
    # protein / sport descriptors (the ingredient itself is no longer whitelisted)
    "protein", "proteina", "proteini", "proteinski", "proteinska", "proteinske",
    "whey", "surutka", "surutke", "izolat", "izolata", "izolatom", "isolate", "isolat",
    "koncentrat", "koncentrata", "concentrate", "hidrolizat", "hidrolizovani",
    "instant", "napitak", "shake", "blend",
    # generic brand-suffix / marketing words that leak from brand names
    "nutrition", "supplements", "supplement", "sport", "sports", "performance",
    "professional",
    # more flavor / qualifier tokens (incl. instrumental case "ukusom")
    "ukusom", "jafa", "jaffa", "sladoled", "kolacici", "kolacic", "papaja", "dinja",
    "sljiva", "sljive", "trostruka", "socna", "socni", "slatka", "kisela", "gorka",
    "kivi", "grejp", "grejpfrut", "nar", "smokva", "visnje", "dudovo",
    # baby-food / pet-food descriptors (branded consumer goods, not supplements) —
    # collapse so they don't anchor a brand-independent merge.
    "kasica", "kasicu", "kasa", "kase", "psa", "pas", "pseta", "stene", "mace",
    "macke", "macku", "macka", "psi", "pasju", "macju",
]

# Words wrongly mined as noise that are actually product-LINE identifiers; keep
# them so flagship sports lines survive ("Gold Standard", "Serious Mass", "Prostar").
NOISE_REMOVE = {"gold", "golden", "mass", "gainer", "platinum", "prostar", "elite", "max"}

# Manufacturer / sports-nutrition brands the miner under-covered.
CURATED_BRANDS = [
    "ultimate", "weider", "prozis", "maximalium", "nutriversum", "qnt", "olympic",
    "olimp", "dymatize", "dy nutrition", "the nutrition", "applied nutrition",
    "muscletech", "bsn", "rule 1", "gaspari", "ronnie coleman", "insane labz",
    "gumedici", "gumedicic", "ivybears",
]

# Pure skincare / makeup / personal-care brands. A product from one of these is a
# cosmetic, so even with an ingredient in the title (Vitamin C, Q10) and no parsed
# form/volume it must NOT enter the supplement ingredient track. (Excludes
# dual-use brands that also sell supplements.)
COSMETIC_BRANDS = [
    "balea", "nivea", "nivea men", "eucerin", "garnier", "loreal", "l oreal",
    "l oreal paris", "vichy", "bioderma", "avene", "la roche posay", "uriage",
    "mustela", "sebamed", "becutan", "cerave", "neutrogena", "mixa", "ziaja",
    "nuxe", "lierac", "svr", "isdin", "klorane", "ducray", "kerastase", "cetaphil",
    "maybelline", "catrice", "essence", "golden rose", "revlon", "rimmel",
    "max factor", "bourjois", "afrodita", "eveline", "labello", "dove", "rexona",
    "loccitane", "oriflame", "avon", "nivea baby", "johnsons", "palmolive",
    "head shoulders", "schwarzkopf", "syoss", "gliss", "wella", "pantene",
    "dr theiss", "apivita", "korres", "weleda baby", "bepanthen", "sudocrem",
]

# Salt / chemical-form qualifiers that are NOT a separate identity under aggressive
# merging — strip them so all magnesium salts (etc.) collapse to the base ingredient.
SALT_FORMS = [
    "citrat", "citrate", "oksid", "oxide", "glicinat", "glycinate", "bisglicinat",
    "bisglycinate", "malat", "malate", "hlorid", "chloride", "sulfat", "sulfate",
    "karbonat", "carbonate", "laktat", "lactate", "glukonat", "gluconate",
    "pikolinat", "picolinate", "fumarat", "fumarate", "askorbat", "ascorbate",
    "monohidrat", "monohydrate", "hidrolizovani", "hydrolyzed", "kelat", "chelate",
]

CATEGORY_TRACK_A = {"supplement", "otc-drug", "otc", "drug"}

# Curated alias additions for high-frequency surface forms the miner under-covered
# (consolidates the omega family; chemical-symbol shorthands for minerals). Kept
# tiny and high-confidence to avoid false merges.
ALIAS_ADD = {
    "omega 3": ["omega"],
    "cink": ["zn"],
    "gvozdje": ["fe"],
    "multivitamin": [
        "vitamini i minerali", "vitamini minerali", "vitamina i minerala",
        "vitamina minerala", "vitaminima i mineralima", "vitaminima mineralima",
        "multivit", "multivit minerali", "multivitaminski mineralni",
    ],
}

# Gummy / jelly delivery form words (normalized to "bombone" elsewhere) — kept out
# of the residual so gummy vitamins don't fragment on these descriptors.
CURATED_FORMS = [
    "bombone", "bombona", "gumene", "gumeni", "gumenih", "gumena", "gumedica",
    "gumedice", "pektinske", "pektinska", "pektinski", "gummy", "gummies",
    "zvakace", "zvakaca", "drazeje", "drazeja",
]


def build_ingredients(intel):
    entries = []
    for item in intel["ingredients"]["ingredients"]:
        canonical = normalize(item["canonical"])
        if not canonical or canonical in CANONICAL_DROP:
            continue
        category = item.get("category", "supplement")
        aliases = norm_list([canonical] + item.get("aliases", []) + ALIAS_ADD.get(canonical, []))
        aliases = [a for a in aliases if a not in ALIAS_DROP]
        if canonical not in aliases:
            aliases.insert(0, canonical)
        entries.append({"canonical": canonical, "category": category, "aliases": aliases})
    # stable order: longest canonical first helps longest-match consumers, but we
    # keep declaration order and let consumers sort aliases by length.
    return {"ingredients": entries}


def build_brands(intel, ingredient_aliases):
    raw = intel["brands"]
    strip = norm_list(raw["brands"] + CURATED_BRANDS)
    keep = norm_list(raw["ambiguous"])
    keep_set = set(keep) | ingredient_aliases
    # never strip something that is a real ingredient identity
    strip = [b for b in strip if b not in keep_set and len(b) >= 2]
    cosmetic = norm_list(COSMETIC_BRANDS)
    return {"strip": strip, "keep": keep, "cosmetic": cosmetic}


# Current hardcoded lists in the existing pipeline (union them in so nothing regresses).
EXISTING_NOISE = [
    "a", "i", "u", "o", "za", "sa", "od", "na", "po", "iz", "do", "se", "je", "ili", "sve",
    "the", "of", "with", "and", "for", "in",
    "plus", "extra", "forte", "max", "ultra", "super", "premium", "pro", "active",
    "natural", "organic", "gratis", "poklon", "set", "promo",
    "dr", "theiss", "foods", "pharm", "pharma", "2u1", "3u1",
    "spf", "spf15", "spf20", "spf30", "spf50",
]
EXISTING_FORMS = [
    "tablete", "tableta", "tabl", "tbl", "tab", "kapsule", "kapsula", "kaps", "caps",
    "capsule", "capsules", "softgel", "softgels", "gel", "gela", "sirup", "sprej",
    "spray", "kapi", "drops", "krema", "krem", "cream", "mast", "losion", "lotion",
    "serum", "prah", "powder", "granule", "granula", "kesice", "kesica", "ampule",
    "ampula", "komada", "kom", "komad", "rastvor", "solution", "suspenzija", "film",
    "sampon", "balzam", "sapun", "pasta", "cps", "ulje", "oil", "maska", "mask",
]


def build_stopwords(intel, ingredient_aliases):
    noise = norm_list(EXISTING_NOISE + intel["noise"]["noiseWords"] + SALT_FORMS + CURATED_NOISE)
    forms = norm_list(EXISTING_FORMS + intel["noise"]["formWords"] + CURATED_FORMS)
    # never let a stopword shadow a real ingredient identity, or a product-line word
    noise = [w for w in noise if w not in ingredient_aliases and w not in NOISE_REMOVE]
    forms = [w for w in forms if w not in NOISE_REMOVE]
    forms = [w for w in forms if w not in ingredient_aliases]
    # a token cannot be both noise and form; prefer form
    form_set = set(forms)
    noise = [w for w in noise if w not in form_set]
    return {"noise": noise, "forms": forms}


def main():
    intel = json.loads(INTEL.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    ingredients = build_ingredients(intel)
    ingredient_aliases = set()
    for e in ingredients["ingredients"]:
        ingredient_aliases.update(e["aliases"])

    brands = build_brands(intel, ingredient_aliases)
    stopwords = build_stopwords(intel, ingredient_aliases)

    (OUT_DIR / "ingredients.json").write_text(json.dumps(ingredients, ensure_ascii=False, indent=1) + "\n")
    (OUT_DIR / "brands.json").write_text(json.dumps(brands, ensure_ascii=False, indent=1) + "\n")
    (OUT_DIR / "stopwords.json").write_text(json.dumps(stopwords, ensure_ascii=False, indent=1) + "\n")

    track_a = sum(1 for e in ingredients["ingredients"] if e["category"] in CATEGORY_TRACK_A)
    print(f"ingredients.json : {len(ingredients['ingredients'])} canonicals "
          f"({track_a} Track-A supplement/otc, {len(ingredients['ingredients']) - track_a} cosmetic/other)")
    print(f"brands.json      : {len(brands['strip'])} strip, {len(brands['keep'])} keep")
    print(f"stopwords.json   : {len(stopwords['noise'])} noise, {len(stopwords['forms'])} forms")


if __name__ == "__main__":
    main()
