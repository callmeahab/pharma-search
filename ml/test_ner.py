#!/usr/bin/env python3
"""
Interactive CLI tool to test the pharmaceutical NER model.
"""

import sys
from pathlib import Path

import spacy

MODEL_PATH = Path(__file__).parent / "models" / "dosage_ner"


def main():
    print("Loading NER model...")
    try:
        nlp = spacy.load(MODEL_PATH)
    except OSError:
        print(f"Error: Model not found at {MODEL_PATH}")
        print("Run 'python train_ner.py' first to train the model.")
        sys.exit(1)

    print(f"Model loaded from {MODEL_PATH}")
    print("\n" + "=" * 50)
    print("Pharmaceutical NER Test Tool")
    print("=" * 50)
    print("Enter product names to extract dosage information.")
    print("Type 'quit' or 'q' to exit.\n")

    # If arguments provided, process them and exit
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
        process_text(nlp, text)
        return

    # Interactive mode
    while True:
        try:
            text = input("Enter text: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not text:
            continue

        if text.lower() in ("quit", "q", "exit"):
            print("Goodbye!")
            break

        process_text(nlp, text)
        print()


def process_text(nlp, text: str):
    """Process text and display extracted entities."""
    doc = nlp(text)

    if doc.ents:
        print(f"  Input: {text}")
        for ent in doc.ents:
            print(f"  → {ent.label_}: '{ent.text}' (chars {ent.start_char}-{ent.end_char})")
    else:
        print(f"  Input: {text}")
        print("  → No dosage entities found")


if __name__ == "__main__":
    main()
