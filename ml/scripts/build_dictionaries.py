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
MINED = ROOT / "ml" / "data" / "mined_dictionary.json"
VERIFIED_ING = ROOT / "ml" / "data" / "verified_ingredients.json"
MINED_STRIP = ROOT / "ml" / "data" / "mined_strip.json"
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
# Demoted from Track-A: heterogeneous "categories" (not a fungible single ingredient)
# that over-merge unrelated products under one group. "probiotik" lumped probiotic
# COOKIES/oatmeal/toothpaste with real supplements (96 RSD cookie .. 6000 RSD), like
# "whey protein" collapsed every whey into one group. These group by brand/product instead.
CANONICAL_DROP = {"magnezijum b6", "vitamin d3 k2", "whey protein", "vegan protein", "probiotik"}

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
# them so flagship sports lines survive ("Gold Standard", "Serious Mass", "Prostar")
# AND so branded multivitamin / OTC lines stay distinct and group across vendors
# ("Centrum Silver" vs "Centrum Junior", "Pregnacare Original", "X Forte"). Without
# these, a brand-identity product (no whitelisted ingredient) loses its line token
# to the noise filter and collapses to a generic name or a per-vendor singleton.
# Curated from an LLM pass over the catalog's noise-bucket frequency table. NOTE:
# flavors/colors are deliberately NOT here — they must keep being stripped so the
# same protein/cosmetic merges across its flavor/shade variants.
NOISE_REMOVE = {
    "gold", "golden", "mass", "gainer", "platinum", "prostar", "elite", "max",
    # strength / line tiers
    "forte", "plus", "original", "classic", "extra", "ultra", "strong", "complete",
    "advanced", "advance", "direct", "rapid", "intense", "intensive", "total",
    "expert", "duo", "mini", "maxi", "silver",
    # demographic / target lines
    "men", "women", "woman", "homme", "kids", "junior", "senior", "adult", "lady",
    # diet / formulation lines
    "vegan", "aktiv", "activ",
    # medical / supplement product-line tokens that were collapsing distinct
    # products into a bare-brand group (Orthomol Immun / Vital, Prenatal). Mined
    # from over-merged brand-core groups (display == bare brand) in groupdump.
    "immun", "imun", "imuno", "immuno", "vital", "prenatal",
}

# Vendor / store names and encoding artifacts (mojibake, html-entity fragments) that
# leaked into scraped titles and polluted the product identity (e.g. the sitemap
# scraper picking up an og:title with the shop name -> "Centrum Silver Apothecary
# Rs Tablete"). Force them into the noise list so they're stripped from the core.
# Curated from an LLM pass over the unknown-token frequency table.
VENDOR_JUNK_NOISE = [
    "apothecary", "apoteka", "gymbeam", "proteinbox", "maxlab", "milica", "bgb",
    "scaron", "rsquo", "amp", "ampon", "pse",
    # site / country suffixes that leak from og:title shop names ("Apothecary RS",
    # "eApoteka RS") — never part of a real product identity.
    "rs", "rb",
]

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
    # makeup / nail cosmetics that were over-merging into a single bare-brand
    # group via brand-core (gloss/olovka/lak shades) — route to brand-sku so
    # shades/lines stay distinct per brand.
    "deborah", "opi", "deborah milano",
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

# Search-only concepts: their category ("search") is deliberately NOT in
# CATEGORY_TRACK_A, so they NEVER affect grouping (BuildGroupKey's ingredient route
# uses SupplementIngredients == Track-A-only). Their sole purpose is to unify SEARCH
# recall across Serbian morphological cases + EN/SR spellings, so a query like
# "probiotici" / "probiotika" resolves to the same concept token as "probiotik"
# (precise, indexed searchTokens @>) instead of collapsing to the noisy fuzzy-trigram
# fallback that surfaces singletons and cosmetics. `probiotik` stays in CANONICAL_DROP
# (kept out of grouping); it re-enters here ONLY as a search concept.
#
# `prebiotik` MUST be its own anchored concept: it is edit-distance 1 from "probiotik",
# so once "probiotik" is a fuzzy single-token alias, a "prebiotik" query would otherwise
# fuzzy-drift into probiotik. An exact alias for prebiotik wins over the fuzzy match.
CURATED_SEARCH_CONCEPTS = [
    {"canonical": "probiotik", "category": "search", "aliases": [
        "probiotik", "probiotici", "probiotika", "probiotske", "probiotski",
        "probiotskih", "probioticima", "probioticki", "probioticke", "probioticna",
        "probioticne", "probiotsko", "probiotska", "probiotic", "probiotics",
        "probiotikum", "probiotikom",
    ]},
    {"canonical": "prebiotik", "category": "search", "aliases": [
        "prebiotik", "prebiotici", "prebiotika", "prebiotski", "prebiotskih",
        "prebioticima", "prebiotska", "prebiotske", "prebiotic", "prebiotics",
    ]},
]

# NOTE: category concepts (ml/data/category_concepts.json) are deliberately NOT added to
# ingredients.json. They must not enter the ingredient pipeline (Python core extraction /
# Go grouping) or they'd pollute product cores and over-merge (e.g. "Ladival" -> a
# "suncare" core). They are loaded SEPARATELY: Go matching embeds the file for query-side
# SearchConcepts resolution (category "searchcat", excluded from Track-A grouping), and
# populate_missing_data.py's CATEGORY_PATTERNS writes the detection token to searchTokens.

# Gummy / jelly delivery form words (normalized to "bombone" elsewhere) — kept out
# of the residual so gummy vitamins don't fragment on these descriptors.
CURATED_FORMS = [
    "bombone", "bombona", "gumene", "gumeni", "gumenih", "gumena", "gumedica",
    "gumedice", "pektinske", "pektinska", "pektinski", "gummy", "gummies",
    "zvakace", "zvakaca", "drazeje", "drazeja",
    # vaginal / rectal insert form words — stripped from the core so the SAME product
    # titled "vaginalete" / "supozitorije" / "globule" / "ovule" collapses to one core
    # (then the extracted form="supozitorija" re-attaches the route in the key).
    "supozitorija", "supozitorije", "suppository", "cepic", "cepici",
    "vaginaleta", "vaginalete", "vagitorija", "vagitorije", "vaginalna", "vaginalne",
    "vaginalnih", "ovula", "ovule", "globula", "globule", "pesar",
]


# ---------------------------------------------------------------------------
# Comprehensive mined dictionary: an LLM classified the ENTIRE catalog vocabulary
# (15k tokens) + 1.5k brand candidates into categories. We fold the safe, high-value
# categories in here so the dictionary is data-driven instead of hand-curated.
# INGREDIENTS are deliberately NOT auto-whitelisted from the mine (Track-A
# over-merge risk) — they're protected from being stripped but stay as identity
# tokens until a separately verified consolidation pass promotes them.
# ---------------------------------------------------------------------------
_mined = json.loads(MINED.read_text()) if MINED.exists() else {}
def _mn(key):
    return norm_list(_mined.get(key, []))
MINED_INGREDIENT_TOKENS = set(_mn("ingredient_tokens"))
MINED_BRAND_TOKENS = _mn("brand_tokens")
MINED_FORMS = _mn("forms")
MINED_FLAVORS = _mn("flavors")
MINED_COLORS = _mn("colors")
MINED_VARIANT = _mn("variant")
MINED_NOISE = _mn("noise")
# parent cosmetic brand tokens (so makeup/skincare routes to the brand-sku shade path)
MINED_COSMETIC = norm_list([p for p, r in _mined.get("brands", {}).items() if r.get("type") == "cosmetic"])
# mined product-line / variant tokens must SURVIVE stripping so lines stay distinct
# (Oligovit SE, Kaltex Daily Stress Support) — fold into NOISE_REMOVE, but never let
# a mined-active token be treated as a line word.
NOISE_REMOVE = set(NOISE_REMOVE) | (set(MINED_VARIANT) - MINED_INGREDIENT_TOKENS)

# Verified ingredient consolidation (LLM-mined, conservatively track_a-gated, then
# human-reviewed): NEW canonicals + alias merges into existing ones. And the verified
# "safe to strip" form/noise split (device/product-type words were kept OUT).
_verified_ing = json.loads(VERIFIED_ING.read_text()) if VERIFIED_ING.exists() else {"new": [], "alias_merges": {}}
_mined_strip = json.loads(MINED_STRIP.read_text()) if MINED_STRIP.exists() else {"forms": [], "noise": []}


def build_ingredients(intel):
    entries = []
    merges = _verified_ing.get("alias_merges", {})
    for item in intel["ingredients"]["ingredients"]:
        canonical = normalize(item["canonical"])
        if not canonical or canonical in CANONICAL_DROP:
            continue
        category = item.get("category", "supplement")
        aliases = norm_list([canonical] + item.get("aliases", []) + ALIAS_ADD.get(canonical, [])
                            + merges.get(canonical, []))
        aliases = [a for a in aliases if a not in ALIAS_DROP]
        if canonical not in aliases:
            aliases.insert(0, canonical)
        entries.append({"canonical": canonical, "category": category, "aliases": aliases})
    # verified NEW canonicals mined from the catalog (single actives, cross-brand safe)
    have = {e["canonical"] for e in entries}
    for ni in _verified_ing.get("new", []):
        c = normalize(ni["canonical"])
        if not c or c in have or c in CANONICAL_DROP:
            continue
        aliases = [a for a in norm_list([c] + ni.get("aliases", [])) if a not in ALIAS_DROP]
        if c not in aliases:
            aliases.insert(0, c)
        entries.append({"canonical": c, "category": ni.get("category", "supplement"), "aliases": aliases})
        have.add(c)
    # search-only concepts (non-Track-A) — re-add even if in CANONICAL_DROP, since they
    # are deliberately excluded from grouping but needed for search-concept resolution.
    for sc in CURATED_SEARCH_CONCEPTS:
        c = normalize(sc["canonical"])
        if not c or c in have:
            continue
        aliases = [a for a in norm_list([c] + sc.get("aliases", [])) if a not in ALIAS_DROP]
        if c not in aliases:
            aliases.insert(0, c)
        entries.append({"canonical": c, "category": sc["category"], "aliases": aliases})
        have.add(c)
    return {"ingredients": entries}


def build_brands(intel, ingredient_aliases):
    raw = intel["brands"]
    strip = norm_list(raw["brands"] + CURATED_BRANDS + MINED_BRAND_TOKENS)
    keep = norm_list(raw["ambiguous"])
    # never strip a real ingredient identity or a mined active (keep it as identity)
    keep_set = set(keep) | ingredient_aliases | MINED_INGREDIENT_TOKENS | NOISE_REMOVE
    strip = [b for b in strip if b not in keep_set and len(b) >= 2]
    cosmetic = norm_list(COSMETIC_BRANDS + MINED_COSMETIC)
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
    # The RAW mined form/noise lists are NOT folded in wholesale — they over-strip
    # context-dependent product-TYPE words ("grickalica"=clipper, "pelene"=diapers
    # ARE the identity for a device/baby brand). Instead we fold in MINED_STRIP, the
    # VERIFIED split where an LLM separated genuinely strippable forms/filler from
    # the keep-as-identity product-type words (the latter stay out, as identity).
    noise = norm_list(EXISTING_NOISE + intel["noise"]["noiseWords"] + SALT_FORMS + CURATED_NOISE
                      + VENDOR_JUNK_NOISE + _mined_strip.get("noise", []))
    forms = norm_list(EXISTING_FORMS + intel["noise"]["formWords"] + CURATED_FORMS
                      + _mined_strip.get("forms", []))
    # never let a stopword shadow a real ingredient identity, a mined active, or a
    # product-line / variant word
    protected = ingredient_aliases | MINED_INGREDIENT_TOKENS | NOISE_REMOVE
    noise = [w for w in noise if w not in protected]
    forms = [w for w in forms if w not in NOISE_REMOVE and w not in ingredient_aliases and w not in MINED_INGREDIENT_TOKENS]
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
    # Sync the mined category concepts (source: ml/data) into the Go embed dir so the
    # matching package's SearchConcepts resolves category-intent queries. Kept OUT of
    # ingredients.json on purpose (see CURATED_SEARCH_CONCEPTS note).
    _cat_src = ROOT / "ml" / "data" / "category_concepts.json"
    if _cat_src.exists():
        (OUT_DIR / "category_concepts.json").write_text(_cat_src.read_text())

    track_a = sum(1 for e in ingredients["ingredients"] if e["category"] in CATEGORY_TRACK_A)
    print(f"ingredients.json : {len(ingredients['ingredients'])} canonicals "
          f"({track_a} Track-A supplement/otc, {len(ingredients['ingredients']) - track_a} cosmetic/other)")
    print(f"brands.json      : {len(brands['strip'])} strip, {len(brands['keep'])} keep")
    print(f"stopwords.json   : {len(stopwords['noise'])} noise, {len(stopwords['forms'])} forms")


if __name__ == "__main__":
    main()
