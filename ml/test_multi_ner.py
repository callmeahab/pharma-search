#!/usr/bin/env python3
"""
Interactive CLI tool to test the multi-entity pharmaceutical NER model.
Extracts BRAND, DOSAGE, FORM, QUANTITY and creates normalized names.
"""

import sys
from pathlib import Path

import spacy

MODEL_PATH = Path(__file__).parent / "models" / "pharma_ner"


# Category keywords mapping
CATEGORY_KEYWORDS = {
    'vitamin': 'vitamini', 'vitamini': 'vitamini',
    'mineral': 'minerali', 'minerali': 'minerali',
    'suplement': 'suplementi', 'suplementi': 'suplementi',
    'probiotik': 'probiotici', 'prebiotik': 'probiotici',
    'omega': 'suplementi', 'protein': 'suplementi',
    'kolagen': 'suplementi', 'collagen': 'suplementi',
    'krema': 'kozmetika', 'losion': 'kozmetika', 'serum': 'kozmetika',
    'parfem': 'parfemi', 'parfemi': 'parfemi', 'edp': 'parfemi', 'edt': 'parfemi',
    'šampon': 'nega-kose', 'sampon': 'nega-kose',
    'ruž': 'sminka', 'ruz': 'sminka', 'maskara': 'sminka', 'puder': 'sminka',
    'sirup': 'lekovi', 'tablete': 'lekovi', 'kapi': 'lekovi',
    'pelene': 'bebi-program', 'beba': 'bebi-program',
}


def create_normalized_name(doc) -> str:
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
            category = CATEGORY_KEYWORDS.get(ent.text.lower(), ent.text)

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

    return " ".join(parts).strip() if parts else "[no entities found]"


def process_text(nlp, text: str):
    """Process text and display extracted entities."""
    doc = nlp(text)

    print(f"\n  Input: {text}")
    print(f"  {'─' * 50}")

    if doc.ents:
        for ent in doc.ents:
            print(f"  {ent.label_:10} │ '{ent.text}'")
        print(f"  {'─' * 50}")
        print(f"  Normalized │ {create_normalized_name(doc)}")
    else:
        print("  No entities found")


def main():
    print("Loading NER model...")
    try:
        nlp = spacy.load(MODEL_PATH)
    except OSError:
        print(f"Error: Model not found at {MODEL_PATH}")
        print("Run 'python train_multi_ner.py' first to train the model.")
        sys.exit(1)

    print(f"Model loaded from {MODEL_PATH}")
    print("\n" + "=" * 60)
    print("Pharmaceutical Multi-Entity NER Test Tool")
    print("=" * 60)
    print("Extracts: BRAND, DOSAGE, FORM, QUANTITY, CATEGORY")
    print("Enter product names to extract entities and get normalized names.")
    print("Type 'quit' or 'q' to exit.\n")

    # If arguments provided, process them and exit
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
        process_text(nlp, text)
        return

    # Interactive mode
    while True:
        try:
            text = input("\nEnter text: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not text:
            continue

        if text.lower() in ("quit", "q", "exit"):
            print("Goodbye!")
            break

        process_text(nlp, text)


if __name__ == "__main__":
    main()
