#!/usr/bin/env python3
"""
Import standardized product names from Excel into ProductStandardization table.

Usage:
    python scripts/import_standardization.py [--excel-path PATH] [--batch-size SIZE]

This script:
1. Reads the Aposteka_processed.xlsx file
2. Batch inserts rows into ProductStandardization table
3. Handles duplicates with ON CONFLICT
4. Reports progress and statistics
"""

import os
import sys
import argparse
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values


def get_db_connection():
    """Get database connection from environment or defaults."""
    db_url = os.getenv('DATABASE_URL')
    if db_url:
        return psycopg2.connect(db_url)

    # Fallback to individual params
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', '5432')),
        database=os.getenv('DB_NAME', 'pharmagician'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'docker')
    )


def load_excel(excel_path: str) -> pd.DataFrame:
    """Load and validate Excel file."""
    print(f"Loading Excel file: {excel_path}")

    df = pd.read_excel(excel_path)

    required_columns = ['title', 'originalTitle', 'normalizedName']
    missing = [col for col in required_columns if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    print(f"Loaded {len(df):,} rows with columns: {df.columns.tolist()}")
    return df


def prepare_data(df: pd.DataFrame) -> list:
    """Prepare data for database insertion."""
    rows = []

    for _, row in df.iterrows():
        # Extract values, handling NaN
        title = row['title'] if pd.notna(row['title']) else None
        original_title = row['originalTitle'] if pd.notna(row.get('originalTitle')) else None
        category = row['category'] if pd.notna(row.get('category')) else None
        normalized_name = row['normalizedName'] if pd.notna(row.get('normalizedName')) else None

        # Skip rows without required fields
        if not title or not normalized_name:
            continue

        # Parse dosage
        dosage_value = None
        dosage_unit = None
        if pd.notna(row.get('dosageValue')):
            try:
                dosage_value = float(str(row['dosageValue']).replace(',', '.'))
            except (ValueError, TypeError):
                pass
        if pd.notna(row.get('dosageUnit')):
            dosage_unit = str(row['dosageUnit']).strip()

        rows.append((
            title,
            original_title,
            category,
            normalized_name,
            dosage_value,
            dosage_unit,
            1.0,  # confidence
            'excel_import'  # source
        ))

    return rows


def import_to_db(conn, rows: list, batch_size: int = 1000):
    """Batch import rows into database."""
    insert_sql = """
        INSERT INTO "ProductStandardization" (
            title,
            "originalTitle",
            category,
            "normalizedName",
            "dosageValue",
            "dosageUnit",
            confidence,
            source
        ) VALUES %s
        ON CONFLICT ("originalTitle", title) DO UPDATE SET
            "normalizedName" = EXCLUDED."normalizedName",
            "dosageValue" = EXCLUDED."dosageValue",
            "dosageUnit" = EXCLUDED."dosageUnit",
            "updatedAt" = CURRENT_TIMESTAMP
    """

    total = len(rows)
    inserted = 0

    with conn.cursor() as cur:
        for i in range(0, total, batch_size):
            batch = rows[i:i + batch_size]
            try:
                execute_values(cur, insert_sql, batch, page_size=batch_size)
                conn.commit()
                inserted += len(batch)

                pct = (inserted / total) * 100
                print(f"Progress: {inserted:,}/{total:,} ({pct:.1f}%)")

            except Exception as e:
                conn.rollback()
                print(f"Error inserting batch at {i}: {e}")
                # Try inserting one by one to find problematic rows
                for j, row in enumerate(batch):
                    try:
                        execute_values(cur, insert_sql, [row], page_size=1)
                        conn.commit()
                        inserted += 1
                    except Exception as row_error:
                        conn.rollback()
                        print(f"  Skipping row {i+j}: {row_error}")

    return inserted


def get_stats(conn):
    """Get statistics about imported data."""
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM "ProductStandardization"')
        total = cur.fetchone()[0]

        cur.execute('SELECT COUNT(*) FROM "ProductStandardization" WHERE "dosageValue" IS NOT NULL')
        with_dosage = cur.fetchone()[0]

        cur.execute('SELECT COUNT(DISTINCT category) FROM "ProductStandardization"')
        categories = cur.fetchone()[0]

        cur.execute('SELECT source, COUNT(*) FROM "ProductStandardization" GROUP BY source')
        by_source = dict(cur.fetchall())

    return {
        'total': total,
        'with_dosage': with_dosage,
        'categories': categories,
        'by_source': by_source
    }


def main():
    parser = argparse.ArgumentParser(description='Import standardized products from Excel')
    parser.add_argument(
        '--excel-path',
        default='Aposteka_processed.xlsx',
        help='Path to Excel file (default: Aposteka_processed.xlsx)'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=1000,
        help='Batch size for inserts (default: 1000)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Parse data but do not insert'
    )

    args = parser.parse_args()

    # Resolve path relative to project root
    project_root = Path(__file__).parent.parent
    excel_path = project_root / args.excel_path

    if not excel_path.exists():
        print(f"Error: Excel file not found: {excel_path}")
        sys.exit(1)

    # Load and prepare data
    df = load_excel(str(excel_path))
    rows = prepare_data(df)
    print(f"Prepared {len(rows):,} rows for import")

    if args.dry_run:
        print("Dry run - not inserting data")
        return

    # Connect and import
    print("\nConnecting to database...")
    conn = get_db_connection()

    try:
        print(f"\nImporting {len(rows):,} rows in batches of {args.batch_size}...")
        inserted = import_to_db(conn, rows, args.batch_size)

        print(f"\nSuccessfully imported {inserted:,} rows")

        # Show stats
        stats = get_stats(conn)
        print(f"\nDatabase statistics:")
        print(f"  Total rows: {stats['total']:,}")
        print(f"  With dosage: {stats['with_dosage']:,}")
        print(f"  Categories: {stats['categories']}")
        print(f"  By source: {stats['by_source']}")

    finally:
        conn.close()


if __name__ == '__main__':
    main()
