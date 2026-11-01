/** Persist worker status, then report source freshness without sending messages. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDbPool } from './helpers/db';
const pool = createDbPool();
const output = path.resolve(process.env.SCRAPER_OUTPUT_DIR || 'output');
try {
  for (const file of (await readdir(path.join(output, '.runs')).catch(() => [])).filter(f => f.endsWith('.json'))) {
    const run = JSON.parse(await readFile(path.join(output, '.runs', file), 'utf8'));
    await pool.query(`INSERT INTO "ScraperRun"(id,scraper,started_at,finished_at,status,products,attempt,vendor_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [run.id,run.scraper,run.startedAt,run.finishedAt,run.status,run.products,run.attempt,(run.vendorNames || []).join(', ')]);
  }
  const hours = Number(process.env.SOURCE_FRESHNESS_HOURS || 36);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Invalid SOURCE_FRESHNESS_HOURS');
  const { rows } = await pool.query(`SELECT v.name,count(*)::int offers,max(p."priceScrapedAt") last_observed,
      count(*) FILTER(WHERE p."priceScrapedAt" < now()-($1*interval '1 hour') OR p."priceScrapedAt" IS NULL)::int stale_offers
    FROM "Product" p JOIN "Vendor" v ON v.id=p."vendorId" GROUP BY v.id ORDER BY v.name`, [hours]);
  const failures = rows.filter(r => !r.last_observed || Date.now()-new Date(r.last_observed).getTime()>hours*3600000);
  const { rows: runs } = await pool.query(`SELECT DISTINCT ON(scraper) scraper,status,finished_at,products,vendor_name FROM "ScraperRun" ORDER BY scraper,finished_at DESC`);
  const report = { generated_at: new Date().toISOString(), threshold_hours: hours, vendors: rows, latest_runs: runs, stale_sources: failures.map(r => r.name) };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--check') && (failures.length || runs.some(r => !['ok'].includes(r.status)))) process.exitCode = 1;
} finally { await pool.end(); }
