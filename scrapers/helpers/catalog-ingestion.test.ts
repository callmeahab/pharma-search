import { expect, test } from 'bun:test';
import { CSV_HEADER_LEGACY, CSV_HEADER_V2, sourceProductID, validSnapshot } from './csv';
import { parseCSV } from '../import-csv';
test('v2 CSV retains distinct variant URLs, source IDs and explicit availability', () => {
  const rows = parseCSV(`${CSV_HEADER_V2}\nSolgar cink 22mg 30 tableta,1600,,https://example.com/p?variant=1,,,Shop,2026-11-01T10:00:00Z,available,variant:1,12345670\nSolgar cink 22mg 30 tableta,1800,,https://example.com/p?variant=2,,,Shop,2026-11-01T10:00:00Z,unknown,variant:2,\n`);
  expect(rows).toHaveLength(2);
  expect(rows[0].sourceProductId).toBe('variant:1');
  expect(rows[1].sourceProductId).not.toBe(rows[0].sourceProductId);
  expect(rows[0].availability).toBe('available');
});
test('legacy snapshots remain valid with unknown stock and stable URL source IDs', () => {
  const rows = parseCSV(`${CSV_HEADER_LEGACY}\nCink 22mg,1600,,https://example.com/p?variant=1&utm_source=ad#top,,,Shop,2026-11-01T10:00:00Z\n`);
  expect(rows[0].availability).toBe('unknown');
  expect(rows[0].sourceProductId).toBe('https://example.com/p?variant=1');
  expect(sourceProductID('https://example.com/p?variant=2')).not.toBe(rows[0].sourceProductId);
  expect(validSnapshot([CSV_HEADER_V2.split(','), ['broken']])).toBe(false);
});

import { Pool } from 'pg';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const integration = process.env.CATALOG_TEST_DATABASE_URL ? test : test.skip;
integration('imports keep listing IDs across title edits, retain variants and record delisting', async () => {
  const admin = new Pool({ connectionString: process.env.CATALOG_TEST_DATABASE_URL });
  const schema = `ingestion_${Date.now()}`;
  const dir = await mkdtemp(path.join(tmpdir(), 'pharma-ingestion-'));
  const url = new URL(process.env.CATALOG_TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
  const db = new Pool({ connectionString: url.toString() });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE "Vendor"(id text PRIMARY KEY,name text); INSERT INTO "Vendor" VALUES('v','Shop');
      CREATE TABLE "Product"(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,title text,price float8,category text,link text,thumbnail text,photos text,"vendorId" text,"priceScrapedAt" timestamptz,"createdAt" timestamptz,"updatedAt" timestamptz,availability text,source_product_id text,gtin text,sku_id text,"processedAt" timestamptz,"extractedBrand" text,"canonicalIdentity" text,"canonicalCategory" text);
      CREATE UNIQUE INDEX source_identity ON "Product"("vendorId",source_product_id) WHERE source_product_id IS NOT NULL;
      CREATE TABLE "OfferLifecycle"(source_key text,sku_id text,vendor_id text,title text,link text,kind text,observed_at timestamptz,UNIQUE(source_key,kind,observed_at));`);
    const row = (id: number, title = 'Cink 22mg 30 tableta') => `${title},1600,,https://example.com/p?variant=${id},,,Shop,2026-11-01T10:00:00Z,unknown,variant:${id},`;
    const importRows = async (rows: string[]) => {
      await writeFile(path.join(dir,'shop_test_2026-11-01.csv'), CSV_HEADER_V2+'\n'+rows.join('\n')+'\n');
      const proc = Bun.spawn(['bun',path.resolve(import.meta.dir,'../import-csv.ts')],{env:{...process.env,SCRAPERS_DATABASE_URL:url.toString(),SCRAPER_OUTPUT_DIR:dir},stdout:'pipe',stderr:'pipe'});
      const [exit, out, err] = await Promise.all([proc.exited,new Response(proc.stdout).text(),new Response(proc.stderr).text()]);
      expect(exit, out+err).toBe(0);
    };
    await importRows([row(1),row(2),row(3)]);
    const before = (await db.query('SELECT id FROM "Product" WHERE source_product_id=$1',['variant:1'])).rows[0].id;
    await importRows([row(1,'Solgar Cink 22mg 30 tableta'),row(2)]);
    const after = await db.query('SELECT id,title FROM "Product" WHERE source_product_id=$1',['variant:1']);
    expect(after.rows[0].id).toBe(before);
    expect(after.rows[0].title).toContain('Solgar');
    expect(Number((await db.query('SELECT count(*) n FROM "Product"')).rows[0].n)).toBe(2);
    expect((await db.query('SELECT source_key FROM "OfferLifecycle"')).rows[0].source_key).toBe('v|variant:3');
  } finally { await db.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await rm(dir,{recursive:true,force:true}); }
});
