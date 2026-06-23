/**
 * One-time maintenance: apply the ingestion-hygiene cleanTitle() to ALREADY-stored
 * product titles in place (entity decode + vendor-suffix strip), preserving the row
 * id (so canonicalIdentity / watchlists are untouched). Collision-safe: if two raw
 * titles for the same vendor clean to the same string, keep one and delete the dup
 * (mirrors the import UPSERT). Re-run ML extraction afterwards so coreProductIdentity
 * / searchTokens reflect the cleaned titles.
 *
 *   bun clean-existing-titles.ts
 */
import { createDbPool } from './helpers/db';
import { cleanTitle } from './helpers/hygiene';

async function main() {
  const pool = createDbPool();
  const { rows } = await pool.query<{ id: string; title: string; vendorId: string }>(
    `SELECT id, title, "vendorId" FROM "Product" WHERE title IS NOT NULL`,
  );
  let updated = 0;
  let deletedDup = 0;
  for (const r of rows) {
    const clean = cleanTitle(r.title);
    if (!clean || clean === r.title) continue;
    // If another row of this vendor already holds the cleaned title, this row is a
    // duplicate of the same product -> delete it. Otherwise rename in place.
    const del = await pool.query(
      `DELETE FROM "Product" WHERE id = $1
         AND EXISTS (SELECT 1 FROM "Product" p2 WHERE p2."vendorId" = $2 AND p2.title = $3 AND p2.id <> $1)`,
      [r.id, r.vendorId, clean],
    );
    if (del.rowCount && del.rowCount > 0) { deletedDup++; continue; }
    const upd = await pool.query(
      `UPDATE "Product" SET title = $2, "updatedAt" = now() WHERE id = $1 AND title <> $2`,
      [r.id, clean],
    );
    if (upd.rowCount && upd.rowCount > 0) updated++;
  }
  console.log(`Scanned ${rows.length}; renamed ${updated}; deleted ${deletedDup} dup(s).`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
