import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { config as loadDotenv } from 'dotenv';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(helperDir, '..', '..');
const projectEnvPath = path.join(projectRoot, '.env');

// Prefer the repo-local DB config for scraper/import scripts.
loadDotenv({ path: projectEnvPath, override: true });

if (process.env.SCRAPERS_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SCRAPERS_DATABASE_URL;
}

const LEGACY_DATABASE_NAMES = new Set(['pharma-search', 'pharmagician']);

function normalizeLegacyDatabaseURL(databaseURL: string | undefined) {
  if (!databaseURL) {
    return databaseURL;
  }

  try {
    const parsed = new URL(databaseURL);
    const databaseName = parsed.pathname.replace(/^\//, '');
    if (LEGACY_DATABASE_NAMES.has(databaseName)) {
      parsed.pathname = '/pharma_search';
      return parsed.toString();
    }
  } catch {
    // Keep the original value if it isn't a URL we can safely rewrite.
  }

  return databaseURL;
}

process.env.DATABASE_URL = normalizeLegacyDatabaseURL(process.env.DATABASE_URL);

export function createDbPool(overrides: Record<string, unknown> = {}) {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ...overrides,
  });
}

export async function assertCoreSchema(pool: Pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      to_regclass('public."Vendor"')::text AS vendor_table,
      to_regclass('public."Product"')::text AS product_table
  `);

  const row = result.rows[0];
  if (row?.vendor_table && row?.product_table) {
    return;
  }

  const databaseName = row?.database_name || '(unknown)';
  throw new Error(
    [
      `Connected to database "${databaseName}" but the pharma-search schema is missing.`,
      `Expected tables: public."Vendor" and public."Product".`,
      'Load the repo root .env or set SCRAPERS_DATABASE_URL to the correct database.',
      'If this is the right database, run:',
      'go run ./cmd/migrate',
    ].join('\n'),
  );
}

export async function loadVendors(pool: Pool) {
  await assertCoreSchema(pool);

  const vendorRows = await pool.query('SELECT id, name FROM "Vendor"');
  const vendors = new Map<string, string>(
    vendorRows.rows.map((row) => [row.name, row.id]),
  );

  if (vendors.size === 0) {
    throw new Error(
      [
        'The "Vendor" table exists but it is empty.',
        'Seed vendor names before importing CSVs:',
        'go run ./cmd/migrate',
      ].join('\n'),
    );
  }

  return vendors;
}
