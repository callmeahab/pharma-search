#!/usr/bin/env python3
"""
Import reviewed product standardization rows from Excel into ProductStandardization.

Usage:
    python scripts/import_standardization.py [--excel-path PATH] [--batch-size SIZE]

This script:
1. Reads a reviewed Excel workbook
2. Batch inserts rows into ProductStandardization table
3. Handles duplicates with ON CONFLICT
4. Reports progress and statistics
"""

import os
import sys
import argparse
from pathlib import Path
import io

import psycopg2
from psycopg2.extras import execute_values
import sqlite3
import tempfile
import zipfile
import xml.etree.ElementTree as ET

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from matching_utils import normalize_lookup_text


def get_db_connection():
    """Get database connection from environment or defaults."""
    db_url = os.getenv('DATABASE_URL')
    if db_url:
        return psycopg2.connect(db_url)

    # Fallback to individual params
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', '5432')),
        database=os.getenv('DB_NAME', 'pharma_search'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'docker')
    )


class ExcelRowReader:
    """Stream rows from Excel without loading shared strings into memory."""

    def __init__(self, excel_path: str, sheet_name: str | None):
        self.excel_path = excel_path
        self.sheet_name = sheet_name
        self.zip_file: zipfile.ZipFile | None = None
        self.shared_strings_db: sqlite3.Connection | None = None
        self.shared_strings_cursor: sqlite3.Cursor | None = None
        self.shared_strings_path: str | None = None
        self.sheet_xml_path: str | None = None
        self.headers_by_col: dict[str, str] = {}
        self.required_headers = {'title', 'originalTitle', 'normalizedName'}
        self.optional_headers = {'category', 'dosageValue', 'dosageUnit'}
        self.needed_headers = self.required_headers | self.optional_headers
        self.needed_cols: set[str] = set()

    def __enter__(self):
        print(f"Loading Excel file: {self.excel_path}", flush=True)
        self.zip_file = zipfile.ZipFile(self.excel_path)
        self.sheet_xml_path = self._resolve_sheet_path(self.sheet_name)
        self._build_shared_strings_db()
        self._load_headers()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.shared_strings_cursor:
            self.shared_strings_cursor.close()
        if self.shared_strings_db:
            self.shared_strings_db.close()
        if self.shared_strings_path and os.path.exists(self.shared_strings_path):
            os.unlink(self.shared_strings_path)
        if self.zip_file:
            self.zip_file.close()

    def _resolve_sheet_path(self, sheet_name: str | None) -> str:
        workbook_xml = self.zip_file.open("xl/workbook.xml") if self.zip_file else None
        rels_xml = self.zip_file.open("xl/_rels/workbook.xml.rels") if self.zip_file else None

        sheet_id_by_name = {}
        for _, elem in ET.iterparse(workbook_xml if workbook_xml else "", events=("end",)):
            if elem.tag.endswith("sheet"):
                name = elem.attrib.get("name")
                r_id = elem.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                if name and r_id:
                    sheet_id_by_name[name] = r_id
            elem.clear()

        rels_by_id = {}
        for _, elem in ET.iterparse(rels_xml if rels_xml else "", events=("end",)):
            if elem.tag.endswith("Relationship"):
                r_id = elem.attrib.get("Id")
                target = elem.attrib.get("Target")
                if r_id and target:
                    rels_by_id[r_id] = target
            elem.clear()

        if sheet_name:
            r_id = sheet_id_by_name.get(sheet_name)
            if not r_id:
                raise ValueError(f"Sheet not found: {sheet_name}")
        else:
            if not sheet_id_by_name:
                raise ValueError("No sheets found in workbook")
            r_id = next(iter(sheet_id_by_name.values()))

        target = rels_by_id.get(r_id)
        if not target:
            raise ValueError("Unable to resolve sheet path from workbook relationships")

        return f"xl/{target}"

    def _build_shared_strings_db(self):
        if self.zip_file and "xl/sharedStrings.xml" not in self.zip_file.namelist():
            return

        shared_strings_file = self.zip_file.open("xl/sharedStrings.xml") if self.zip_file and "xl/sharedStrings.xml" in self.zip_file.namelist() else None
        temp_db = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite")
        temp_db.close()
        self.shared_strings_path = temp_db.name
        self.shared_strings_db = sqlite3.connect(self.shared_strings_path)
        self.shared_strings_cursor = self.shared_strings_db.cursor()

        self.shared_strings_cursor.execute(
            "CREATE TABLE strings (id INTEGER PRIMARY KEY, value TEXT)"
        )

        batch = []
        for _, elem in ET.iterparse(shared_strings_file if shared_strings_file else io.StringIO("<sharedStrings />"), events=("end",)):
            if elem.tag.endswith("si"):
                text_parts = []
                for t in elem.iter():
                    if t.tag.endswith("t") and t.text:
                        text_parts.append(t.text)
                value = "".join(text_parts)
                batch.append((value,))
                if len(batch) >= 1000:
                    self.shared_strings_cursor.executemany(
                        "INSERT INTO strings (value) VALUES (?)", batch
                    )
                    self.shared_strings_db.commit()
                    batch = []
                elem.clear()

        if batch:
            self.shared_strings_cursor.executemany(
                "INSERT INTO strings (value) VALUES (?)", batch
            )
            self.shared_strings_db.commit()

    def _get_shared_string(self, index: int) -> str | None:
        if not self.shared_strings_cursor:
            return None
        row = self.shared_strings_cursor.execute(
            "SELECT value FROM strings WHERE id = ?",
            (index + 1,),
        ).fetchone()
        return row[0] if row else None

    def _load_headers(self):
        sheet_file = self.zip_file.open(self.sheet_xml_path) if self.zip_file and self.sheet_xml_path else None
        for _, elem in ET.iterparse(sheet_file if sheet_file else "", events=("end",)):
            if elem.tag.endswith("row"):
                row_num = elem.attrib.get("r")
                if row_num != "1":
                    elem.clear()
                    break

                for cell in elem.iter():
                    if not cell.tag.endswith("c"):
                        continue
                    cell_ref = cell.attrib.get("r", "")
                    col = "".join(ch for ch in cell_ref if ch.isalpha())
                    value = self._parse_cell_value(cell)
                    if value is None:
                        continue
                    header = str(value).strip()
                    if header:
                        self.headers_by_col[col] = header
                elem.clear()
                break

        missing = [col for col in self.required_headers if col not in self.headers_by_col.values()]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        for col, header in self.headers_by_col.items():
            if header in self.needed_headers:
                self.needed_cols.add(col)

        print(f"Loaded header with columns: {list(self.headers_by_col.values())}")

    def _parse_cell_value(self, cell) -> str | float | None:
        cell_type = cell.attrib.get("t")
        value_node = None

        for child in cell:
            if child.tag.endswith("v"):
                value_node = child
                break
            if child.tag.endswith("is"):
                value_node = child
                break

        if cell_type == "s":
            if value_node is None or value_node.text is None:
                return None
            return self._get_shared_string(int(value_node.text))
        if cell_type == "inlineStr":
            for t_node in cell.iter():
                if t_node.tag.endswith("t") and t_node.text is not None:
                    return t_node.text
            return None
        if value_node is None or value_node.text is None:
            return None
        return value_node.text

    def iter_rows(self, max_rows: int = 0):
        sheet_file = self.zip_file.open(self.sheet_xml_path) if self.zip_file and self.sheet_xml_path else None
        row_count = 0
        for _, elem in ET.iterparse(sheet_file if sheet_file else "", events=("end",)):
            if not elem.tag.endswith("row"):
                continue

            row_num = elem.attrib.get("r")
            if row_num == "1":
                elem.clear()
                continue

            row_count += 1
            if max_rows > 0 and row_count > max_rows:
                elem.clear()
                break

            row_values = {}
            for cell in elem.iter():
                if not cell.tag.endswith("c"):
                    continue
                cell_ref = cell.attrib.get("r", "")
                col = "".join(ch for ch in cell_ref if ch.isalpha())
                if col not in self.needed_cols:
                    continue
                value = self._parse_cell_value(cell)
                header = self.headers_by_col.get(col)
                if header:
                    row_values[header] = value

            elem.clear()
            yield row_values


def prepare_row(values: dict) -> tuple | None:
    """Prepare a single row for database insertion."""
    title = values.get('title')
    original_title = values.get('originalTitle')
    category = values.get('category')
    normalized_name = values.get('normalizedName')

    if title is not None:
        title = str(title).strip()
    if original_title is not None:
        original_title = str(original_title).strip()
    if category is not None:
        category = str(category).strip()
    if normalized_name is not None:
        normalized_name = str(normalized_name).strip()

    # Skip rows without required fields
    if not title or not normalized_name:
        return None

    normalized_name = normalize_lookup_text(normalized_name)
    if not normalized_name:
        return None

    # Parse dosage
    dosage_value = None
    dosage_unit = None
    dosage_value_raw = values.get('dosageValue')
    if dosage_value_raw is not None and str(dosage_value_raw).strip() != "":
        try:
            dosage_value = float(str(dosage_value_raw).replace(',', '.'))
        except (ValueError, TypeError):
            pass
    dosage_unit_raw = values.get('dosageUnit')
    if dosage_unit_raw is not None and str(dosage_unit_raw).strip() != "":
        dosage_unit = str(dosage_unit_raw).strip()

    return (
        title,
        original_title,
        category,
        normalized_name,
        dosage_value,
        dosage_unit,
        1.0,  # confidence
        'excel_import'  # source
    )


def import_to_db(conn, rows_iter, batch_size: int = 200):
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

    inserted = 0
    prepared = 0

    with conn.cursor() as cur:
        batch = []
        for row in rows_iter:
            if row is None:
                continue
            batch.append(row)
            prepared += 1

            if len(batch) < batch_size:
                continue

            try:
                execute_values(cur, insert_sql, batch, page_size=min(batch_size, 200))
                conn.commit()
                inserted += len(batch)
                print(f"Progress: inserted {inserted:,} rows")
            except Exception as e:
                conn.rollback()
                print(f"Error inserting batch at {inserted}: {e}")
                # Try inserting one by one to find problematic rows
                for j, row in enumerate(batch):
                    try:
                        execute_values(cur, insert_sql, [row], page_size=1)
                        conn.commit()
                        inserted += 1
                    except Exception as row_error:
                        conn.rollback()
                        print(f"  Skipping row {inserted + j}: {row_error}")

            batch = []

        if batch:
            try:
                execute_values(cur, insert_sql, batch, page_size=min(batch_size, 200))
                conn.commit()
                inserted += len(batch)
                print(f"Progress: inserted {inserted:,} rows")
            except Exception as e:
                conn.rollback()
                print(f"Error inserting final batch at {inserted}: {e}")
                for j, row in enumerate(batch):
                    try:
                        execute_values(cur, insert_sql, [row], page_size=1)
                        conn.commit()
                        inserted += 1
                    except Exception as row_error:
                        conn.rollback()
                        print(f"  Skipping row {inserted + j}: {row_error}")

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
        help='Path to the reviewed Excel file (default: Aposteka_processed.xlsx)'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=200,
        help='Batch size for inserts (default: 200)'
    )
    parser.add_argument(
        '--sheet',
        default=None,
        help='Excel sheet name (default: first sheet)'
    )
    parser.add_argument(
        '--max-rows',
        type=int,
        default=0,
        help='Maximum rows to read (0 = no limit)'
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

    print("Preparing rows for import...")

    if args.dry_run:
        with ExcelRowReader(str(excel_path), args.sheet) as reader:
            prepared = 0
            for values in reader.iter_rows(args.max_rows):
                if prepare_row(values) is not None:
                    prepared += 1
            print(f"Prepared {prepared:,} rows for import")
            print("Dry run - not inserting data")
        return

    # Connect and import
    print("\nConnecting to database...")
    conn = get_db_connection()

    try:
        with ExcelRowReader(str(excel_path), args.sheet) as reader:
            rows_iter = (
                prepare_row(values)
                for values in reader.iter_rows(args.max_rows)
            )
            print(f"\nImporting rows in batches of {args.batch_size}...")
            inserted = import_to_db(conn, rows_iter, args.batch_size)

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
