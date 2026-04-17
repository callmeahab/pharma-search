import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


SERBIAN_REPLACEMENTS = str.maketrans(
    {
        "đ": "dj",
        "Đ": "dj",
        "č": "c",
        "Č": "c",
        "ć": "c",
        "Ć": "c",
        "š": "s",
        "Š": "s",
        "ž": "z",
        "Ž": "z",
    }
)

CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e", "ж": "z",
    "з": "z", "и": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj", "м": "m", "н": "n",
    "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "ћ": "c", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "џ": "dz", "ш": "s",
    "А": "a", "Б": "b", "В": "v", "Г": "g", "Д": "d", "Ђ": "dj", "Е": "e", "Ж": "z",
    "З": "z", "И": "i", "Ј": "j", "К": "k", "Л": "l", "Љ": "lj", "М": "m", "Н": "n",
    "Њ": "nj", "О": "o", "П": "p", "Р": "r", "С": "s", "Т": "t", "Ћ": "c", "У": "u",
    "Ф": "f", "Х": "h", "Ц": "c", "Ч": "c", "Џ": "dz", "Ш": "s",
}

FORM_ALIASES = {
    "tab": "tablete",
    "tabl": "tablete",
    "tableta": "tablete",
    "tablete": "tablete",
    "kaps": "kapsule",
    "kapsula": "kapsule",
    "kapsule": "kapsule",
    "caps": "kapsule",
    "capsule": "kapsule",
    "capsules": "kapsule",
    "softgel": "kapsule",
    "softgels": "kapsule",
    "cps": "kapsule",
    "sirup": "sirup",
    "sprej": "sprej",
    "spray": "sprej",
    "kapi": "kapi",
    "drops": "kapi",
    "gel": "gel",
    "gela": "gel",
    "krema": "krema",
    "krem": "krema",
    "cream": "krema",
    "mast": "mast",
    "ointment": "mast",
    "losion": "losion",
    "lotion": "losion",
    "serum": "serum",
    "rastvor": "rastvor",
    "solution": "rastvor",
    "suspenzija": "suspenzija",
    "kesica": "kesice",
    "kesice": "kesice",
    "ampula": "ampule",
    "ampule": "ampule",
}


def normalize_lookup_text(text: Optional[str]) -> str:
    if not text:
        return ""

    transliterated = "".join(CYRILLIC_TO_LATIN.get(ch, ch) for ch in text)
    transliterated = transliterated.translate(SERBIAN_REPLACEMENTS).lower()
    transliterated = transliterated.replace("-", " ").replace("_", " ")
    transliterated = re.sub(r"[^0-9a-z]+", " ", transliterated)
    return " ".join(transliterated.split())


def normalize_form(form: Optional[str]) -> Optional[str]:
    normalized = normalize_lookup_text(form)
    if not normalized:
        return None
    return FORM_ALIASES.get(normalized, normalized)


def format_measure(value: Optional[float], unit: Optional[str], uppercase_unit: bool = True) -> Optional[str]:
    if value is None or unit is None:
        return None

    normalized_unit = normalize_lookup_text(unit)
    if not normalized_unit:
        return None

    if float(value).is_integer():
        value_text = str(int(value))
    else:
        value_text = format(value, "g")

    unit_text = normalized_unit.upper() if uppercase_unit else normalized_unit
    return f"{value_text} {unit_text}"


def build_standardized_title(update: Dict[str, Any]) -> str:
    normalized_name = (update.get("normalized_name") or "").strip()
    if normalized_name:
        return normalized_name

    parts: List[str] = []
    brand = (update.get("brand") or "").strip()
    if brand:
        parts.append(brand.title())

    core_product_identity = (update.get("core_product_identity") or "").strip()
    if core_product_identity:
        parts.append(core_product_identity)
    else:
        raw_title = (update.get("title") or "").strip()
        if raw_title:
            parts.append(raw_title)

    for measure in (
        format_measure(update.get("dosage_value"), update.get("dosage_unit")),
        format_measure(update.get("volume_value"), update.get("volume_unit")),
    ):
        if measure:
            parts.append(measure)

    normalized_form = normalize_form(update.get("form"))
    quantity_value = update.get("quantity_value")
    if quantity_value:
        if normalized_form:
            parts.append(f"{int(quantity_value)} {normalized_form}")
        else:
            parts.append(f"x{int(quantity_value)}")
    elif normalized_form:
        parts.append(normalized_form)

    return " ".join(part for part in parts if part).strip()


def build_standardization_payload(update: Dict[str, Any]) -> Dict[str, Any]:
    standardized_title = build_standardized_title(update)
    normalized_lookup = normalize_lookup_text(standardized_title)

    return {
        "title": standardized_title or (update.get("title") or "").strip(),
        "original_title": (update.get("title") or "").strip(),
        "normalized_name": normalized_lookup,
        "brand": update.get("brand"),
        "form": normalize_form(update.get("form")),
        "dosage_value": update.get("dosage_value"),
        "dosage_unit": normalize_lookup_text(update.get("dosage_unit")) or None,
        "quantity_value": update.get("quantity_value"),
        "quantity_unit": normalize_lookup_text(update.get("quantity_unit")) or None,
        "volume_value": update.get("volume_value"),
        "volume_unit": normalize_lookup_text(update.get("volume_unit")) or None,
    }


def build_search_metadata(update: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    token_candidates: List[str] = []
    for field in (
        update.get("title"),
        update.get("brand"),
        update.get("core_product_identity"),
        update.get("normalized_name"),
        update.get("form"),
    ):
        normalized = normalize_lookup_text(field)
        if normalized:
            token_candidates.extend(normalized.split())
            compact = normalized.replace(" ", "")
            if compact != normalized:
                token_candidates.append(compact)

    if update.get("dosage_value") is not None and update.get("dosage_unit"):
        value = int(update["dosage_value"]) if float(update["dosage_value"]).is_integer() else format(update["dosage_value"], "g")
        unit = normalize_lookup_text(update["dosage_unit"])
        token_candidates.extend([value, unit, f"{value}{unit}"])

    if update.get("volume_value") is not None and update.get("volume_unit"):
        value = int(update["volume_value"]) if float(update["volume_value"]).is_integer() else format(update["volume_value"], "g")
        unit = normalize_lookup_text(update["volume_unit"])
        token_candidates.extend([value, unit, f"{value}{unit}"])

    if update.get("quantity_value"):
        token_candidates.append(str(int(update["quantity_value"])))

    tokens = dedupe_non_empty(token_candidates)

    tags = []
    brand = normalize_lookup_text(update.get("brand"))
    if brand:
        tags.append(f"brand:{brand}")
    core = normalize_lookup_text(update.get("core_product_identity"))
    if core:
        tags.append(f"core:{core}")
    dosage = format_measure(update.get("dosage_value"), update.get("dosage_unit"), uppercase_unit=False)
    if dosage:
        tags.append(f"dose:{normalize_lookup_text(dosage)}")
    normalized_form = normalize_form(update.get("form"))
    if normalized_form:
        tags.append(f"form:{normalize_lookup_text(normalized_form)}")
    if update.get("quantity_value"):
        tags.append(f"qty:{int(update['quantity_value'])}")

    return tokens, dedupe_non_empty(tags)


def dedupe_non_empty(values: Iterable[Any]) -> List[str]:
    seen = set()
    result: List[str] = []
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result
