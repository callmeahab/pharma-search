#!/usr/bin/env python3
"""
Train a multi-entity NER model for pharmaceutical product extraction.
Extracts: BRAND, DOSAGE, FORM, QUANTITY from product titles.
Uses the Aposteka_processed.xlsx as training data source.
"""

import os
import re
import json
import random
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional

import spacy
from spacy.tokens import DocBin
from spacy.training import Example
from spacy.util import minibatch, compounding
import pandas as pd
from tqdm import tqdm

# Configuration
MODEL_OUTPUT_DIR = Path(__file__).parent / "models" / "pharma_ner"
XLSX_FILE = Path(__file__).parent / "Aposteka_processed.xlsx"
BASE_MODEL = "xx_ent_wiki_sm"  # Multilingual model

# Product forms in Serbian/English
PRODUCT_FORMS = {
    # Solid forms
    'tablete', 'tableta', 'tabl', 'tab',
    'kapsula', 'kapsule', 'caps', 'cps', 'kapsula',
    'dra?eje', 'dra?eja',
    'pastile', 'pastila',
    'pilule', 'pilula',
    'granule', 'granula',
    'pra?ak', 'powder',
    'kesica', 'kesice', 'vre?ica', 'vre?ice', 'sachets',
    # Liquid forms
    'sirup', 'syrup',
    'kapi', 'drops',
    'sprej', 'spray',
    'rastvor', 'solution', 'solutio',
    'suspenzija', 'suspension',
    'emulzija', 'emulsion',
    # Topical forms
    'krema', 'krem', 'cream',
    'gel',
    'mast', 'ointment',
    'losion', 'lotion',
    'serum',
    'ulje', 'oil',
    'balzam', 'balsam',
    'pena', 'foam',
    # Other
    'supozitorije', 'supozitorija', 'suppository',
    'ampule', 'ampula', 'ampoule',
    'bo?ica', 'vial',
    'fla?ica', 'bottle',
    'softgel', 'soft gel',
    'gummies', 'gumene', 'gumeni',
    '?vaka?e', '?vaka?a',
}

# Common brand indicators (words that typically follow brand names)
BRAND_STOPWORDS = {
    'vitamin', 'vitamini', 'mineral', 'minerali',
    'probiotik', 'probiotici', 'prebiotik',
    'omega', 'kolagen', 'collagen',
    'protein', 'amino', 'bcaa', 'kreatin', 'creatine',
    'za', 'sa', 'i', 'od', 'u', 'na',
    'tablete', 'kapsule', 'sirup', 'sprej', 'kapi',
    'krema', 'gel', 'mast', 'losion', 'serum',
}

# Quantity unit words
QUANTITY_UNITS = {
    'komad', 'komada', 'kom',
    'tableta', 'tablete', 'tabl', 'tab',
    'kapsula', 'kapsule', 'caps', 'cps',
    'kesica', 'kesice', 'kesica',
    'doza', 'doze', 'doza',
    'ampula', 'ampule',
    'bo?ica', 'bo?ice',
    'pakovanje', 'pakovanja', 'pak',
}

# Category keywords mapping - keywords that indicate product category
CATEGORY_KEYWORDS = {
    # Vitamins & Supplements
    'vitamin': 'vitamini',
    'vitamini': 'vitamini',
    'mineral': 'minerali',
    'minerali': 'minerali',
    'suplement': 'suplementi',
    'suplementi': 'suplementi',
    'probiotik': 'probiotici',
    'prebiotik': 'probiotici',
    'omega': 'suplementi',
    'protein': 'suplementi',
    'kolagen': 'suplementi',
    'collagen': 'suplementi',
    # Cosmetics
    'krema': 'kozmetika',
    'losion': 'kozmetika',
    'serum': 'kozmetika',
    'parfem': 'parfemi',
    'parfemi': 'parfemi',
    'toaletna voda': 'parfemi',
    'edp': 'parfemi',
    'edt': 'parfemi',
    'šampon': 'nega-kose',
    'sampon': 'nega-kose',
    'balzam za kosu': 'nega-kose',
    'maska za kosu': 'nega-kose',
    'ruž': 'sminka',
    'ruz': 'sminka',
    'maskara': 'sminka',
    'puder': 'sminka',
    'senka': 'sminka',
    'senke': 'sminka',
    'lak za nokte': 'nega-noktiju',
    # Medicine
    'sirup': 'lekovi',
    'tablete': 'lekovi',
    'kapi': 'lekovi',
    'supozitorije': 'lekovi',
    'mast': 'lekovi',
    # Baby
    'pelene': 'bebi-program',
    'beba': 'bebi-program',
    'dečji': 'decji-kutak',
    'decji': 'decji-kutak',
    'deca': 'decji-kutak',
}


def load_data_from_xlsx() -> pd.DataFrame:
    """Load training data from xlsx file."""
    print(f"Loading data from {XLSX_FILE}...")
    df = pd.read_excel(XLSX_FILE)
    print(f"Loaded {len(df)} products")
    return df


def find_dosage_spans(text: str, dosage_value: float, dosage_unit: str) -> List[Tuple[int, int, str]]:
    """Find dosage mentions in text based on known value and unit."""
    if pd.isna(dosage_value) or pd.isna(dosage_unit):
        return []

    spans = []
    text_lower = text.lower()
    unit = str(dosage_unit).lower().strip()

    # Generate value patterns
    if dosage_value == int(dosage_value):
        value_patterns = [str(int(dosage_value)), f"{dosage_value:.1f}".rstrip('0').rstrip('.')]
    else:
        value_patterns = [f"{dosage_value:.1f}", f"{dosage_value:.2f}", str(dosage_value)]

    # Common unit variations
    unit_variations = {unit}
    if unit == 'ml':
        unit_variations.update(['ml', 'мл'])
    elif unit == 'mg':
        unit_variations.update(['mg', 'мг'])
    elif unit == 'g':
        unit_variations.update(['g', 'gr', 'gram', 'grama'])
    elif unit == 'mcg':
        unit_variations.update(['mcg', 'µg', 'мкг'])
    elif unit == 'iu':
        unit_variations.update(['iu', 'ij', 'i.u.', 'i.j.'])
    elif unit == 'l':
        unit_variations.update(['l', 'litar', 'litre', 'liter'])
    elif unit == 'kg':
        unit_variations.update(['kg', 'kilogram', 'kilograma'])

    for val in value_patterns:
        for u in unit_variations:
            # Pattern: value+unit (no space) - e.g., "100mg"
            pattern = re.escape(val) + r'\s*' + re.escape(u)
            for match in re.finditer(pattern, text_lower, re.IGNORECASE):
                spans.append((match.start(), match.end(), 'DOSAGE'))

            # Pattern with 'x' multiplier - e.g., "2x400ml"
            pattern_x = r'\d+\s*x\s*' + re.escape(val) + r'\s*' + re.escape(u)
            for match in re.finditer(pattern_x, text_lower, re.IGNORECASE):
                spans.append((match.start(), match.end(), 'DOSAGE'))

    # Deduplicate and return longest non-overlapping spans
    return dedupe_spans(spans)


def find_form_spans(text: str) -> List[Tuple[int, int, str]]:
    """Find product form mentions in text."""
    spans = []
    text_lower = text.lower()

    for form in PRODUCT_FORMS:
        # Match whole word only
        pattern = r'\b' + re.escape(form) + r'\b'
        for match in re.finditer(pattern, text_lower, re.IGNORECASE):
            spans.append((match.start(), match.end(), 'FORM'))

    return dedupe_spans(spans)


def find_quantity_spans(text: str) -> List[Tuple[int, int, str]]:
    """Find quantity mentions like '60 kapsula', '30 tableta'."""
    spans = []
    text_lower = text.lower()

    for unit in QUANTITY_UNITS:
        # Pattern: number + unit word
        pattern = r'\b(\d+)\s*' + re.escape(unit) + r'\b'
        for match in re.finditer(pattern, text_lower, re.IGNORECASE):
            spans.append((match.start(), match.end(), 'QUANTITY'))

    return dedupe_spans(spans)


def find_category_spans(text: str) -> List[Tuple[int, int, str]]:
    """Find category-indicating keywords in text."""
    spans = []
    text_lower = text.lower()

    # Sort by length (longest first) to match longer phrases first
    sorted_keywords = sorted(CATEGORY_KEYWORDS.keys(), key=len, reverse=True)

    matched_ranges = set()
    for keyword in sorted_keywords:
        pattern = r'\b' + re.escape(keyword) + r'\b'
        for match in re.finditer(pattern, text_lower, re.IGNORECASE):
            # Check if this range is already matched
            match_range = set(range(match.start(), match.end()))
            if not match_range & matched_ranges:
                spans.append((match.start(), match.end(), 'CATEGORY'))
                matched_ranges.update(match_range)

    return spans


def find_brand_spans(text: str, other_spans: List[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    """
    Find brand name at the start of the text.
    Brand is typically the first word(s) before product descriptors.
    """
    # Get positions covered by other entities
    covered = set()
    for start, end, _ in other_spans:
        covered.update(range(start, end))

    # Split into words and find brand
    words = text.split()
    if not words:
        return []

    brand_words = []
    current_pos = 0

    for word in words:
        word_start = text.find(word, current_pos)
        word_end = word_start + len(word)
        word_lower = word.lower().rstrip('.,;:!?')

        # Stop if we hit a stopword or the word overlaps with another entity
        if word_lower in BRAND_STOPWORDS:
            break
        if any(pos in covered for pos in range(word_start, word_end)):
            break
        # Stop if word looks like a dosage (contains numbers + unit)
        if re.match(r'^\d+\s*(mg|ml|g|mcg|iu|kg|l)\b', word_lower):
            break
        # Stop if word is a number followed by nothing pharmaceutical
        if re.match(r'^\d+$', word_lower) and len(brand_words) > 0:
            break

        brand_words.append((word, word_start, word_end))
        current_pos = word_end

        # Limit brand to first 4 words max
        if len(brand_words) >= 4:
            break

    if brand_words:
        # Return span covering all brand words
        start = brand_words[0][1]
        end = brand_words[-1][2]
        # Only if brand is at least 2 characters
        if end - start >= 2:
            return [(start, end, 'BRAND')]

    return []


def dedupe_spans(spans: List[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    """Remove overlapping spans, keeping the longest ones."""
    if not spans:
        return []

    # Sort by length (descending) then by start position
    spans = sorted(spans, key=lambda x: (-(x[1] - x[0]), x[0]))

    result = []
    covered = set()

    for start, end, label in spans:
        # Check if this span overlaps with any already selected span
        span_range = set(range(start, end))
        if not span_range & covered:
            result.append((start, end, label))
            covered.update(span_range)

    return sorted(result, key=lambda x: x[0])


def create_training_example(text: str, spans: List[Tuple[int, int, str]]) -> Optional[Dict]:
    """Create a training example dict."""
    if not spans:
        return None

    # Filter out overlapping spans
    spans = dedupe_spans(spans)

    return {
        "text": text,
        "entities": [(start, end, label) for start, end, label in spans]
    }


def prepare_training_data(df: pd.DataFrame) -> List[Dict]:
    """Prepare training data from dataframe."""
    print("Preparing training data...")
    training_data = []

    for _, row in tqdm(df.iterrows(), total=len(df)):
        text = str(row['title'])
        if not text or text == 'nan':
            continue

        # Find all entity spans
        dosage_spans = find_dosage_spans(text, row.get('dosageValue'), row.get('dosageUnit'))
        form_spans = find_form_spans(text)
        quantity_spans = find_quantity_spans(text)
        category_spans = find_category_spans(text)

        # Combine non-overlapping spans
        all_spans = dedupe_spans(dosage_spans + form_spans + quantity_spans + category_spans)

        # Find brand (after other entities are identified)
        brand_spans = find_brand_spans(text, all_spans)
        all_spans = dedupe_spans(all_spans + brand_spans)

        if all_spans:
            example = create_training_example(text, all_spans)
            if example:
                training_data.append(example)

    print(f"Created {len(training_data)} training examples")
    return training_data


def convert_to_spacy_format(training_data: List[Dict], nlp) -> List[Example]:
    """Convert training data to spaCy Example format."""
    examples = []
    skipped = 0

    for item in tqdm(training_data, desc="Converting to spaCy format"):
        text = item["text"]
        entities = item["entities"]

        try:
            doc = nlp.make_doc(text)
            ents = []
            for start, end, label in entities:
                span = doc.char_span(start, end, label=label, alignment_mode="contract")
                if span is not None:
                    ents.append(span)

            doc.ents = ents
            example = Example.from_dict(doc, {"entities": entities})
            examples.append(example)
        except Exception as e:
            skipped += 1
            continue

    if skipped > 0:
        print(f"Skipped {skipped} examples due to alignment issues")

    return examples


def train_ner_model(training_data: List[Dict], n_iter: int = 30):
    """Train the NER model."""
    print(f"\nTraining NER model for {n_iter} iterations...")

    # Load base model
    print(f"Loading base model: {BASE_MODEL}")
    try:
        nlp = spacy.load(BASE_MODEL)
    except OSError:
        print(f"Downloading {BASE_MODEL}...")
        spacy.cli.download(BASE_MODEL)
        nlp = spacy.load(BASE_MODEL)

    # Add NER pipe if not present
    if "ner" not in nlp.pipe_names:
        ner = nlp.add_pipe("ner", last=True)
    else:
        ner = nlp.get_pipe("ner")

    # Add labels
    for label in ["BRAND", "DOSAGE", "FORM", "QUANTITY", "CATEGORY"]:
        ner.add_label(label)

    # Convert training data
    print("Converting training data...")
    train_examples = convert_to_spacy_format(training_data, nlp)

    # Split into train/eval
    random.shuffle(train_examples)
    split_idx = int(len(train_examples) * 0.9)
    train_set = train_examples[:split_idx]
    eval_set = train_examples[split_idx:]

    print(f"Training set: {len(train_set)} examples")
    print(f"Evaluation set: {len(eval_set)} examples")

    # Get pipes to disable during training
    other_pipes = [pipe for pipe in nlp.pipe_names if pipe != "ner"]

    # Training loop
    with nlp.disable_pipes(*other_pipes):
        optimizer = nlp.resume_training()

        for iteration in range(n_iter):
            random.shuffle(train_set)
            losses = {}

            batches = minibatch(train_set, size=compounding(4.0, 32.0, 1.001))
            for batch in batches:
                nlp.update(batch, drop=0.35, losses=losses, sgd=optimizer)

            if iteration % 5 == 0 or iteration == n_iter - 1:
                print(f"Iteration {iteration + 1}/{n_iter}, Loss: {losses.get('ner', 0):.4f}")

    return nlp, eval_set


def evaluate_model(nlp, eval_examples: List[Example]):
    """Evaluate the model on held-out examples."""
    print("\nEvaluating model...")

    scorer = nlp.evaluate(eval_examples)

    print(f"\nOverall scores:")
    print(f"  Precision: {scorer['ents_p']:.4f}")
    print(f"  Recall: {scorer['ents_r']:.4f}")
    print(f"  F1 Score: {scorer['ents_f']:.4f}")

    # Per-entity scores if available
    if 'ents_per_type' in scorer:
        print(f"\nPer-entity scores:")
        for ent_type, scores in scorer['ents_per_type'].items():
            print(f"  {ent_type}:")
            print(f"    Precision: {scores['p']:.4f}")
            print(f"    Recall: {scores['r']:.4f}")
            print(f"    F1: {scores['f']:.4f}")

    return scorer


def test_model(nlp):
    """Test model on sample products."""
    test_texts = [
        "Brufen 400mg tablete",
        "Paracetamol 500 mg 20 tableta",
        "Aspirin 100mg/ml sirup",
        "Vitamin C 1000mg 60 kapsula",
        "Probiotik Bulardi 10 kesica",
        "NOW Foods Omega-3 1000mg 100 softgel",
        "Solgar Vitamin D3 2000IU 100 kapsula",
        "A-Derma Exomega krema 200ml",
        "Bioderma Sensibio gel 500ml",
        "La Roche-Posay Effaclar losion 200ml",
        "Kolagen Complex 500mg 30 kapsula",
        "Nivea šampon za suvu kosu 250ml",
        "Armaf Club De Nuit parfem edp 100ml",
    ]

    print("\n" + "=" * 50)
    print("Testing on sample products:")
    print("=" * 50)

    for text in test_texts:
        doc = nlp(text)
        print(f"\nText: {text}")
        if doc.ents:
            for ent in doc.ents:
                print(f"  {ent.label_}: '{ent.text}' ({ent.start_char}-{ent.end_char})")
        else:
            print("  No entities found")


def create_normalized_name(doc, source_category: str = None) -> str:
    """Create a normalized product name from extracted entities."""
    brand = ""
    dosage = ""
    form = ""
    quantity = ""
    category = ""

    for ent in doc.ents:
        if ent.label_ == "BRAND":
            brand = ent.text
        elif ent.label_ == "DOSAGE":
            dosage = ent.text
        elif ent.label_ == "FORM":
            form = ent.text
        elif ent.label_ == "QUANTITY":
            quantity = ent.text
        elif ent.label_ == "CATEGORY":
            # Map keyword to category name
            category = CATEGORY_KEYWORDS.get(ent.text.lower(), ent.text)

    # Use source category if no category extracted from text
    if not category and source_category:
        category = source_category

    # Build normalized name
    parts = []
    if brand:
        parts.append(brand)
    if dosage:
        parts.append(dosage)
    if form:
        parts.append(form)
    if quantity:
        parts.append(f"({quantity})")
    if category:
        parts.append(f"[{category}]")

    return " ".join(parts).strip()


def main():
    print("=" * 50)
    print("Pharmaceutical Multi-Entity NER Model Training")
    print("=" * 50)

    # Load data
    df = load_data_from_xlsx()

    # Prepare training data
    training_data = prepare_training_data(df)

    # Save training data for inspection
    training_file = Path(__file__).parent / "training_data_multi.json"
    with open(training_file, "w", encoding="utf-8") as f:
        json.dump(training_data[:1000], f, ensure_ascii=False, indent=2)  # Save sample
    print(f"Sample training data saved to {training_file}")

    # Train model
    nlp, eval_set = train_ner_model(training_data, n_iter=30)

    # Evaluate
    evaluate_model(nlp, eval_set)

    # Save model
    MODEL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    nlp.to_disk(MODEL_OUTPUT_DIR)
    print(f"\nModel saved to {MODEL_OUTPUT_DIR}")

    # Test
    test_model(nlp)

    # Demo normalized names
    print("\n" + "=" * 50)
    print("Normalized name examples:")
    print("=" * 50)
    test_texts = [
        "Solgar Vitamin D3 2000IU 100 kapsula",
        "NOW Foods Omega-3 1000mg 100 softgel",
        "Brufen 400mg 20 tableta",
    ]
    for text in test_texts:
        doc = nlp(text)
        normalized = create_normalized_name(doc)
        print(f"\n  Original: {text}")
        print(f"  Normalized: {normalized}")


if __name__ == "__main__":
    main()
