#!/usr/bin/env python3
"""
Shared matching dictionaries for the Python ML pipeline.

Loads the SAME json files the Go backend embeds
(internal/matching/data/*.json) so extraction and grouping stay in lockstep:

  - canonical ingredient detection (alias -> canonical, longest-match-first)
  - brand strip list (+ protected ingredient words)
  - noise / form stopwords

Build the json with:  python3 ml/scripts/build_dictionaries.py
"""

import json
import re
import unicodedata
from pathlib import Path
from typing import Dict, List, Set, Tuple

_DATA_DIR = Path(__file__).resolve().parents[1] / "internal" / "matching" / "data"

_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e", "ж": "z",
    "з": "z", "и": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj", "м": "m", "н": "n",
    "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "ћ": "c", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "џ": "dz", "ш": "s",
}
_LATIN = {"đ": "dj", "č": "c", "ć": "c", "š": "s", "ž": "z"}

TRACK_A_CATEGORIES = {"supplement", "otc-drug", "otc", "drug"}


def normalize(text) -> str:
    """Mirror of Go matching.NormalizeText."""
    if not text:
        return ""
    text = str(text).lower()
    out = []
    for ch in text:
        if ch in _CYRILLIC:
            out.append(_CYRILLIC[ch])
        elif ch in _LATIN:
            out.append(_LATIN[ch])
        else:
            out.append(ch)
    text = "".join(out)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^0-9a-z]+", " ", text)
    return " ".join(text.split())


def _load(name: str) -> dict:
    return json.loads((_DATA_DIR / name).read_text())


# --- ingredients ---
_alias_index: Dict[str, Tuple[str, str]] = {}      # alias phrase -> (canonical, category)
_canonical_category: Dict[str, str] = {}
_canonical_aliases: Dict[str, List[str]] = {}
_single_token_aliases: Set[str] = set()            # 1-token aliases (kept during cleaning)
_max_alias_tokens = 1

for _entry in _load("ingredients.json")["ingredients"]:
    _canon = normalize(_entry["canonical"])
    if not _canon:
        continue
    _canonical_category[_canon] = _entry.get("category", "supplement")
    for _alias in _entry.get("aliases", []):
        _a = normalize(_alias)
        if not _a:
            continue
        _n = len(_a.split())
        _max_alias_tokens = max(_max_alias_tokens, _n)
        _alias_index.setdefault(_a, (_canon, _entry.get("category", "supplement")))
        _canonical_aliases.setdefault(_canon, []).append(_a)
        if _n == 1:
            _single_token_aliases.add(_a)

# --- brands ---
_brands = _load("brands.json")
BRAND_STRIP: Set[str] = {normalize(b) for b in _brands["strip"] if normalize(b)}
BRAND_KEEP: Set[str] = {normalize(b) for b in _brands["keep"] if normalize(b)}
# Pure-cosmetic parent brands. Their products are grouped by line via the Go
# brand-sku path (brand shown separately from a descriptive residual), so the brand
# must be STRIPPED from the core — otherwise it leaks into the residual and the
# display duplicates it ("La Roche Posay Roche Posay Effaclar"). Supplement/identity
# brands (Centrum, Pregnacare) are NOT here, so they stay in the core as the
# group identity. Sub-tokens (>=5 chars) catch partial matches like detect_brand
# returning "roche posay" for the "la roche posay" entry.
COSMETIC_BRANDS: Set[str] = {normalize(b) for b in _brands.get("cosmetic", []) if normalize(b)}
# Common words that appear inside MULTI-WORD cosmetic brand names ("natural care",
# "opi nature strong", "avene xeracalm nutrition") but are far too generic to mark a
# whole brand cosmetic on their own — without this denylist, is_cosmetic_brand wrongly
# flags supplement brands like "Natural Wealth" / "Strong Nature" / "7 Nutrition".
_COSMETIC_TOKEN_DENY: Set[str] = {
    "natural", "nature", "strong", "nutrition", "health", "active", "vitamin",
    "complex", "formula", "pharma", "plus", "care", "beauty", "gold", "premium",
}
_COSMETIC_BRAND_TOKENS: Set[str] = {
    tok for b in COSMETIC_BRANDS for tok in b.split()
    if len(tok) >= 5 and tok not in _COSMETIC_TOKEN_DENY
}


def is_cosmetic_brand(brand) -> bool:
    n = normalize(brand)
    if not n:
        return False
    if n in COSMETIC_BRANDS:
        return True
    return any(tok in _COSMETIC_BRAND_TOKENS for tok in n.split())

# --- stopwords ---
_stop = _load("stopwords.json")
NOISE_WORDS: Set[str] = {normalize(w) for w in _stop["noise"] if normalize(w)}
FORM_WORDS: Set[str] = {normalize(w) for w in _stop["forms"] if normalize(w)}

SINGLE_TOKEN_ALIASES = _single_token_aliases
# First token of every ingredient alias phrase (used to stop brand detection from
# swallowing ingredient words like "koenzim" in "Koenzim Q10").
INGREDIENT_FIRST_TOKENS: Set[str] = {a.split()[0] for a in _alias_index if a}


def analyze_ingredients(text: str, track_a_only: bool = False) -> Tuple[List[str], List[str]]:
    """Return (sorted canonical ingredients, leftover tokens). Mirror of Go."""
    tokens = normalize(text).split()
    if not tokens:
        return [], []

    used = [False] * len(tokens)
    found: Set[str] = set()

    i = 0
    while i < len(tokens):
        if used[i]:
            i += 1
            continue
        max_n = min(_max_alias_tokens, len(tokens) - i)
        matched = False
        for n in range(max_n, 0, -1):
            phrase = " ".join(tokens[i:i + n])
            entry = _alias_index.get(phrase)
            if not entry:
                continue
            if track_a_only and entry[1] not in TRACK_A_CATEGORIES:
                continue
            found.add(entry[0])
            for k in range(i, i + n):
                used[k] = True
            i += n
            matched = True
            break
        if not matched:
            i += 1

    leftover = [t for idx, t in enumerate(tokens) if not used[idx]]
    return sorted(found), leftover


def supplement_ingredients(text: str) -> List[str]:
    return analyze_ingredients(text, track_a_only=True)[0]


def canonical_compact(canonical: str) -> str:
    return canonical.replace(" ", "")


def is_brand(token: str) -> bool:
    return token in BRAND_STRIP and token not in BRAND_KEEP


_MAX_BRAND_TOKENS = max((len(b.split()) for b in BRAND_STRIP), default=1)
# Generic suffix words that are only a brand as part of a longer name
# ("Ultimate Nutrition"), never standalone.
_GENERIC_BRAND_SUFFIX = {
    "nutrition", "supplements", "supplement", "sport", "sports", "pro", "basic",
    "performance", "professional", "ultimate", "the", "prostar",
}


def detect_brand(title: str):
    """Return the longest KNOWN brand phrase present anywhere in the title (not just
    leading tokens), or None. This stops a product-line name like 'Iso Sensation'
    from being mistaken for a brand."""
    tokens = normalize(title).split()
    best = None
    for i in range(len(tokens)):
        upper = min(_MAX_BRAND_TOKENS, len(tokens) - i)
        for n in range(upper, 0, -1):
            phrase = " ".join(tokens[i:i + n])
            if phrase in BRAND_STRIP and phrase not in BRAND_KEEP:
                if n == 1 and phrase in _GENERIC_BRAND_SUFFIX:
                    continue
                if best is None or n > best[1]:
                    best = (phrase, n)
                break
    return best[0] if best else None
