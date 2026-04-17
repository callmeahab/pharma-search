/**
 * Import CSV files into the database
 * Reads CSV files from the output directory and inserts products into PostgreSQL
 */

import * as fs from 'fs';
import * as path from 'path';
import { createDbPool, loadVendors } from './helpers/db';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

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

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  values.push(current);
  return values;
}

function parseCSV(content: string): ProductRow[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const rows: ProductRow[] = [];

  // Skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length >= 8) {
      rows.push({
        title: values[0],
        price: parseFloat(values[1]) || 0,
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

async function importCSVFiles() {
  const pool = createDbPool({
    max: 20,
    idleTimeoutMillis: 30000,
  });

  try {
    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Database connection established');

    // Get all CSV files
    const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.csv'));
    console.log(`Found ${files.length} CSV files to import`);

    let totalImported = 0;
    let totalErrors = 0;

    const vendorIdByName = await loadVendors(pool);

    for (const file of files) {
      const filePath = path.join(OUTPUT_DIR, file);
      console.log(`\nProcessing: ${file}`);

      const content = fs.readFileSync(filePath, 'utf-8');
      const parsedProducts = parseCSV(content);
      console.log(`  Found ${parsedProducts.length} products`);

      if (parsedProducts.length === 0) continue;

      // Get vendor name from first product
      const vendorName = parsedProducts[0].vendor;
      const vendorId = vendorIdByName.get(vendorName);

      if (!vendorId) {
        console.log(`  Vendor "${vendorName}" not found, skipping file`);
        continue;
      }

      let fileImported = 0;
      let fileErrors = 0;
      let fileDuplicates = 0;

      const dedupedProducts = Array.from(
        parsedProducts.reduce((map, product) => {
          const existing = map.get(product.title);
          if (existing) {
            fileDuplicates++;
          }
          map.set(product.title, product);
          return map;
        }, new Map<string, ProductRow>()).values(),
      );

      // Process in batches with upsert
      const BATCH_SIZE = 2000;
      for (let i = 0; i < dedupedProducts.length; i += BATCH_SIZE) {
        const dedupedBatch = dedupedProducts.slice(i, i + BATCH_SIZE);

        if (dedupedBatch.length === 0) {
          continue;
        }

        try {
          const values: Array<string | number | null> = [];
          const placeholders = dedupedBatch
            .map((product, index) => {
              const baseIndex = index * 7;
              values.push(
                product.title,
                product.price,
                product.category,
                product.link,
                product.thumbnail,
                product.photos,
                vendorId
              );
              return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, NOW(), NOW())`;
            })
            .join(', ');

          await pool.query(
            `INSERT INTO "Product" (title, price, category, link, thumbnail, photos, "vendorId", "createdAt", "updatedAt")
             VALUES ${placeholders}
             ON CONFLICT (title, "vendorId") DO UPDATE SET
               price = EXCLUDED.price,
               category = EXCLUDED.category,
               link = EXCLUDED.link,
               thumbnail = EXCLUDED.thumbnail,
               photos = EXCLUDED.photos,
               "updatedAt" = NOW()`,
            values
          );

          fileImported += dedupedBatch.length;
        } catch (error) {
          console.error(`  Error importing batch starting with "${dedupedBatch[0]?.title ?? 'unknown'}":`, error);
          fileErrors += dedupedBatch.length;
        }
      }

      if (fileDuplicates > 0) {
        console.log(`  Skipped duplicates in batch: ${fileDuplicates}`);
      }
      console.log(`  Imported: ${fileImported}, Errors: ${fileErrors}`);
      totalImported += fileImported;
      totalErrors += fileErrors;
    }

    console.log(`\n=== Import Complete ===`);
    console.log(`Total imported: ${totalImported}`);
    console.log(`Total errors: ${totalErrors}`);

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the import
importCSVFiles();
