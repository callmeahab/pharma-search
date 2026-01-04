#!/usr/bin/env python3
"""
Train a spaCy NER model for pharmaceutical product extraction.
Uses the ProductStandardization table as training data.
"""

import os
import re
import json
import random
from pathlib import Path
from typing import List, Tuple, Dict, Any

import spacy
from spacy.tokens import DocBin
from spacy.training import Example
from spacy.util import minibatch, compounding
import pandas as pd
from tqdm import tqdm
from dotenv import load_dotenv
import psycopg2

load_dotenv()

# Configuration
MODEL_OUTPUT_DIR = Path(__file__).parent / "models" / "dosage_ner"
TRAIN_DATA_FILE = Path(__file__).parent / "training_data.json"
BASE_MODEL = "xx_ent_wiki_sm"  # Multilingual model


def get_db_connection():
    """Connect to PostgreSQL database."""
    db_url = os.getenv("DATABASE_URL", "postgres://postgres:docker@localhost:5432/pharmagician")
    return psycopg2.connect(db_url)


def load_training_data_from_db() -> List[Dict[str, Any]]:
    """Load training data from ProductStandardization table."""
    print("Loading training data from database...")

    conn = get_db_connection()
    cur = conn.cursor()

    # Get products with dosage information
    cur.execute("""
        SELECT title, normalized_name, dosage_value, dosage_unit
        FROM "ProductStandardization"
        WHERE dosage_value IS NOT NULL
          AND dosage_unit IS NOT NULL
          AND dosage_value > 0
        LIMIT 50000
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    print(f"Loaded {len(rows)} products with dosage information")
    return [
        {
            "title": row[0],
            "normalized_name": row[1],
            "dosage_value": float(row[2]),
            "dosage_unit": row[3]
        }
        for row in rows
    ]


def find_dosage_spans(text: str, dosage_value: float, dosage_unit: str) -> List[Tuple[int, int, str]]:
    """Find dosage mentions in text and return spans with labels."""
    entities = []
    text_lower = text.lower()

    # Format dosage value for searching
    # Handle both integer and decimal formats
    if dosage_value == int(dosage_value):
        value_patterns = [str(int(dosage_value)), f"{dosage_value:.1f}", f"{dosage_value:.2f}"]
    else:
        value_patterns = [f"{dosage_value:.1f}", f"{dosage_value:.2f}", str(dosage_value)]

    # Common dosage patterns
    unit_variations = {
        "mg": ["mg", "мг"],
        "ml": ["ml", "мл"],
        "g": ["g", "г", "gr"],
        "mcg": ["mcg", "μg", "мкг"],
        "l": ["l", "л", "liter"],
        "iu": ["iu", "ме"],
    }

    unit_lower = dosage_unit.lower().strip()
    unit_list = unit_variations.get(unit_lower, [unit_lower])

    for value_str in value_patterns:
        for unit in unit_list:
            # Pattern: value + unit (e.g., "500mg", "500 mg")
            patterns = [
                f"{value_str}{unit}",
                f"{value_str} {unit}",
                f"{value_str}  {unit}",
            ]

            for pattern in patterns:
                idx = text_lower.find(pattern.lower())
                if idx != -1:
                    start = idx
                    end = idx + len(pattern)
                    entities.append((start, end, "DOSAGE"))
                    break
            else:
                continue
            break
        else:
            continue
        break

    return entities


def create_training_examples(data: List[Dict[str, Any]]) -> List[Tuple[str, Dict]]:
    """Convert database data to spaCy training format."""
    training_data = []
    skipped = 0

    for item in tqdm(data, desc="Creating training examples"):
        text = item["title"]
        entities = find_dosage_spans(
            text,
            item["dosage_value"],
            item["dosage_unit"]
        )

        if entities:
            # Validate no overlapping entities
            sorted_ents = sorted(entities, key=lambda x: x[0])
            valid = True
            for i in range(len(sorted_ents) - 1):
                if sorted_ents[i][1] > sorted_ents[i + 1][0]:
                    valid = False
                    break

            if valid:
                training_data.append((text, {"entities": entities}))
            else:
                skipped += 1
        else:
            skipped += 1

    print(f"Created {len(training_data)} training examples, skipped {skipped}")
    return training_data


def train_model(training_data: List[Tuple[str, Dict]], iterations: int = 30):
    """Train the NER model."""
    print(f"Training model with {len(training_data)} examples...")

    # Create blank model
    nlp = spacy.blank("xx")  # Multilingual blank model

    # Add NER pipeline
    if "ner" not in nlp.pipe_names:
        ner = nlp.add_pipe("ner", last=True)
    else:
        ner = nlp.get_pipe("ner")

    # Add labels
    for _, annotations in training_data:
        for ent in annotations.get("entities", []):
            ner.add_label(ent[2])

    # Train
    other_pipes = [pipe for pipe in nlp.pipe_names if pipe != "ner"]
    with nlp.disable_pipes(*other_pipes):
        optimizer = nlp.begin_training()

        for itn in range(iterations):
            random.shuffle(training_data)
            losses = {}

            batches = minibatch(training_data, size=compounding(4.0, 32.0, 1.001))
            for batch in batches:
                examples = []
                for text, annots in batch:
                    doc = nlp.make_doc(text)
                    try:
                        example = Example.from_dict(doc, annots)
                        examples.append(example)
                    except Exception:
                        continue

                if examples:
                    nlp.update(examples, drop=0.35, losses=losses, sgd=optimizer)

            print(f"Iteration {itn + 1}/{iterations}, Loss: {losses.get('ner', 0):.4f}")

    return nlp


def evaluate_model(nlp, test_data: List[Tuple[str, Dict]]) -> Dict[str, float]:
    """Evaluate the trained model."""
    scorer = {"correct": 0, "total": 0, "predicted": 0}

    for text, annots in test_data:
        doc = nlp(text)
        gold_spans = set((e[0], e[1], e[2]) for e in annots["entities"])
        pred_spans = set((ent.start_char, ent.end_char, ent.label_) for ent in doc.ents)

        scorer["total"] += len(gold_spans)
        scorer["predicted"] += len(pred_spans)
        scorer["correct"] += len(gold_spans & pred_spans)

    precision = scorer["correct"] / max(1, scorer["predicted"])
    recall = scorer["correct"] / max(1, scorer["total"])
    f1 = 2 * precision * recall / max(0.0001, precision + recall)

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1
    }


def main():
    print("=" * 50)
    print("Pharmaceutical NER Model Training")
    print("=" * 50)

    # Load data
    data = load_training_data_from_db()

    if len(data) < 100:
        print("Error: Not enough training data. Need at least 100 examples.")
        return

    # Create training examples
    training_data = create_training_examples(data)

    if len(training_data) < 50:
        print("Error: Not enough valid training examples.")
        return

    # Split into train/test
    random.shuffle(training_data)
    split_idx = int(len(training_data) * 0.9)
    train_data = training_data[:split_idx]
    test_data = training_data[split_idx:]

    print(f"Train: {len(train_data)}, Test: {len(test_data)}")

    # Save training data for reference
    with open(TRAIN_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(training_data, f, ensure_ascii=False, indent=2)
    print(f"Saved training data to {TRAIN_DATA_FILE}")

    # Train model
    nlp = train_model(train_data, iterations=30)

    # Evaluate
    print("\nEvaluating model...")
    metrics = evaluate_model(nlp, test_data)
    print(f"Precision: {metrics['precision']:.4f}")
    print(f"Recall: {metrics['recall']:.4f}")
    print(f"F1 Score: {metrics['f1']:.4f}")

    # Save model
    MODEL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    nlp.to_disk(MODEL_OUTPUT_DIR)
    print(f"\nModel saved to {MODEL_OUTPUT_DIR}")

    # Save metrics
    metrics_file = MODEL_OUTPUT_DIR / "metrics.json"
    with open(metrics_file, "w") as f:
        json.dump(metrics, f, indent=2)

    # Test with some examples
    print("\n" + "=" * 50)
    print("Testing on sample products:")
    print("=" * 50)

    test_texts = [
        "Brufen 400mg tablete",
        "Paracetamol 500 mg",
        "Aspirin 100mg/ml sirup",
        "Vitamin C 1000mg",
    ]

    for text in test_texts:
        doc = nlp(text)
        print(f"\nText: {text}")
        if doc.ents:
            for ent in doc.ents:
                print(f"  {ent.label_}: '{ent.text}' ({ent.start_char}-{ent.end_char})")
        else:
            print("  No entities found")


if __name__ == "__main__":
    main()
