/**
 * Import CSV files into the database.
 *
 * For each vendor we import only the NEWEST CSV per scraper-shard (so old dated
 * snapshots don't re-apply stale prices), then transactionally replace that
 * vendor's catalog: upsert the fresh rows and delist (delete) any of the vendor's
 * products that were NOT in this run — unless the fresh snapshot is suspiciously
 * small vs. what's already stored (a broken scrape must not wipe a vendor).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createDbPool, loadVendors } from './helpers/db';
import { parsePrice } from './helpers/database';
import { cleanTitle, isLikelyProduct, isResolvableProductLink } from './helpers/hygiene';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

// If a fresh snapshot has fewer than this fraction of the vendor's currently
// stored products, we skip delisting (likely a broken/partial scrape) and only
// upsert. Override with IMPORT_DELIST_MIN_RATIO.
const DELIST_MIN_RATIO = Number.parseFloat(process.env.IMPORT_DELIST_MIN_RATIO || '0.5');

interface ProductRow {
  title: string;
  price: number;
  category: string;
  link: string;
  thumbnail: string;
  photos: string;
  vendor: string;
  scrapedAt: string;
}

// Robust CSV parser: handles quoted fields containing commas, escaped quotes
// ("") and NEWLINES inside quotes (the old line-split parser corrupted any
// multi-line quoted title).
function parseCSVRecords(content: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function parseCSV(content: string): ProductRow[] {
  const records = parseCSVRecords(content);
  if (records.length < 2) return [];

  const rows: ProductRow[] = [];
  // Skip header (record 0)
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    if (values.length >= 8 && values[0].trim()) {
      // Ingestion hygiene at the single chokepoint: clean the title (entity decode +
      // vendor-suffix strip), robustly parse the price to integer RSD, and drop
      // non-products (no price / category pages) so garbage never reaches the DB.
      const title = cleanTitle(values[0]);
      const price = parsePrice(values[1]);
      if (!isLikelyProduct(title, price)) continue;
      // Drop products whose link is a category/listing/brand page or a malformed
      // double-prefixed URL — a wrong href strands the product on a dead page.
      if (!isResolvableProductLink(values[3])) continue;
      rows.push({
        title,
        price,
        category: values[2],
        link: values[3],
        thumbnail: values[4],
        photos: values[5],
        vendor: values[6],
        scrapedAt: values[7],
      });
    }
  }
  return rows;
}

// Keep only the newest CSV per scraper-shard. Filenames are
// `<shop>_<scraper>_<YYYY-MM-DD>.csv`; we group by the `<shop>_<scraper>` prefix
// so all six ananas shards survive (each its latest date) while old dates drop.
function latestCsvFiles(files: string[]): string[] {
  const byPrefix = new Map<string, { date: string; file: string }>();
  for (const f of files) {
    const m = f.match(/^(.*)_(\d{4}-\d{2}-\d{2})\.csv$/);
    if (!m) {
      byPrefix.set(f, { date: '', file: f });
      continue;
    }
    const prefix = m[1];
    const date = m[2];
    const cur = byPrefix.get(prefix);
    if (!cur || date > cur.date) {
      byPrefix.set(prefix, { date, file: f });
    }
  }
  return [...byPrefix.values()].map((v) => v.file);
}

async function importCSVFiles() {
  const pool = createDbPool({ max: 20, idleTimeoutMillis: 30000 });
  let hadError = false;

  try {
    const probe = await pool.connect();
    await probe.query('SELECT 1');
    probe.release();
    console.log('Database connection established');

    const allFiles = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.csv'));
    const files = latestCsvFiles(allFiles);
    console.log(
      `Found ${allFiles.length} CSV files; using ${files.length} latest-per-shard`,
    );

    const vendorIdByName = await loadVendors(pool);

    // Group fresh rows by vendor (merging all shards of the same vendor, e.g. ananas1-6).
    const perVendor = new Map<string, { vendorName: string; rows: ProductRow[] }>();
    for (const file of files) {
      const content = fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8');
      const parsed = parseCSV(content);
      if (parsed.length === 0) {
        console.log(`  ${file}: 0 products, skipping`);
        continue;
      }
      const vendorName = parsed[0].vendor;
      const vendorId = vendorIdByName.get(vendorName);
      if (!vendorId) {
        console.log(`  ${file}: vendor "${vendorName}" not found, skipping`);
        continue;
      }
      const bucket = perVendor.get(vendorId) || { vendorName, rows: [] };
      bucket.rows.push(...parsed);
      perVendor.set(vendorId, bucket);
    }

    let totalImported = 0;
    let totalDelisted = 0;
    let totalErrors = 0;

    for (const [vendorId, { vendorName, rows }] of perVendor) {
      // Dedupe within the vendor's combined snapshot by CASE-INSENSITIVE title, keeping
      // the LOWEST price. The DB unique constraint is (title, vendorId) and case-sensitive,
      // so "...10ml" and "...10ML" would otherwise both insert as separate rows for the
      // same product (inflating that vendor's coverage count and showing two prices).
      const deduped = Array.from(
        rows
          .reduce((map, p) => {
            const key = p.title.trim().toLowerCase();
            const prev = map.get(key);
            if (!prev || p.price < prev.price) map.set(key, p);
            return map;
          }, new Map<string, ProductRow>())
          .values(),
      );

      const client = await pool.connect();
      try {
        const { rows: cntRows } = await client.query(
          'SELECT count(*)::int AS n FROM "Product" WHERE "vendorId" = $1',
          [vendorId],
        );
        const existing = cntRows[0].n as number;

        await client.query('BEGIN');
        const { rows: nowRows } = await client.query('SELECT now() AS now');
        const watermark = nowRows[0].now as string;

        let imported = 0;
        const BATCH_SIZE = 2000;
        for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
          const batch = deduped.slice(i, i + BATCH_SIZE);
          const values: Array<string | number | null> = [];
          const placeholders = batch
            .map((p, index) => {
              const b = index * 8;
              // scrapedAt = when the price was actually scraped (preserved per row);
              // updatedAt = now() each run (delist watermark, see below).
              values.push(p.title, p.price, p.category, p.link, p.thumbnail, p.photos, vendorId, p.scrapedAt || null);
              return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::timestamptz, now(), now())`;
            })
            .join(', ');

          await client.query(
            `INSERT INTO "Product" (title, price, category, link, thumbnail, photos, "vendorId", "priceScrapedAt", "createdAt", "updatedAt")
             VALUES ${placeholders}
             ON CONFLICT (title, "vendorId") DO UPDATE SET
               price = EXCLUDED.price,
               category = EXCLUDED.category,
               link = EXCLUDED.link,
               thumbnail = EXCLUDED.thumbnail,
               photos = EXCLUDED.photos,
               "priceScrapedAt" = EXCLUDED."priceScrapedAt",
               "updatedAt" = now()`,
            values,
          );
          imported += batch.length;
        }

        // Delist products this run didn't touch — but only if the snapshot is
        // plausibly complete (guards against a broken scrape nuking the vendor).
        let delisted = 0;
        const ratio = existing === 0 ? 1 : deduped.length / existing;
        if (ratio >= DELIST_MIN_RATIO) {
          const del = await client.query(
            'DELETE FROM "Product" WHERE "vendorId" = $1 AND "updatedAt" < $2',
            [vendorId, watermark],
          );
          delisted = del.rowCount || 0;
        } else {
          console.log(
            `  ${vendorName}: snapshot ${deduped.length} vs existing ${existing} (ratio ${ratio.toFixed(2)} < ${DELIST_MIN_RATIO}) — SKIPPING delist (likely broken scrape)`,
          );
        }

        await client.query('COMMIT');
        console.log(`  ${vendorName}: upserted ${imported}, delisted ${delisted} (had ${existing})`);
        totalImported += imported;
        totalDelisted += delisted;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`  ${vendorName}: import failed, rolled back:`, error);
        totalErrors++;
        hadError = true;
      } finally {
        client.release();
      }
    }

    console.log(`\n=== Import Complete ===`);
    console.log(`Vendors: ${perVendor.size}`);
    console.log(`Total upserted: ${totalImported}`);
    console.log(`Total delisted: ${totalDelisted}`);
    console.log(`Vendor failures: ${totalErrors}`);
  } catch (error) {
    console.error('Import failed:', error);
    hadError = true;
  } finally {
    await pool.end();
  }

  if (hadError) process.exit(1);
}

importCSVFiles();
