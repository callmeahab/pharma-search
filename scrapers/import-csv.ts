/**
 * Import CSV files into the database
 * Reads CSV files from the output directory and inserts products into PostgreSQL
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import 'dotenv/config';

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
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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

    for (const file of files) {
      const filePath = path.join(OUTPUT_DIR, file);
      console.log(`\nProcessing: ${file}`);

      const content = fs.readFileSync(filePath, 'utf-8');
      const products = parseCSV(content);
      console.log(`  Found ${products.length} products`);

      if (products.length === 0) continue;

      // Get vendor name from first product
      const vendorName = products[0].vendor;

      // Find vendor in database
      const vendorResult = await pool.query(
        'SELECT id, name FROM "Vendor" WHERE name = $1 LIMIT 1',
        [vendorName]
      );

      if (vendorResult.rows.length === 0) {
        console.log(`  Vendor "${vendorName}" not found, skipping file`);
        continue;
      }

      const vendorId = vendorResult.rows[0].id;
      let fileImported = 0;
      let fileErrors = 0;

      // Process in batches with upsert
      const BATCH_SIZE = 1000;
      for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);

        try {
          const values: Array<string | number | null> = [];
          const placeholders = batch
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
              return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`;
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

          fileImported += batch.length;
        } catch (error) {
          console.error(`  Error importing batch starting with "${batch[0]?.title ?? 'unknown'}":`, error);
          fileErrors += batch.length;
        }

        // Small delay between batches
        if (i + BATCH_SIZE < products.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
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
