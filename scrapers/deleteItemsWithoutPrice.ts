import { assertCoreSchema, createDbPool } from './helpers/db';

const pool = createDbPool();

// If more than this fraction of a vendor's products have no price, we treat it as
// a broken price selector and SKIP deleting that vendor (deleting would wipe valid
// products). Override with CLEANUP_MAX_ZERO_RATIO.
const MAX_ZERO_RATIO = Number.parseFloat(process.env.CLEANUP_MAX_ZERO_RATIO || '0.5');

async function deleteZeroPriceProducts() {
  let totalDeleted = 0;
  let skippedVendors = 0;

  try {
    await assertCoreSchema(pool);

    // Per-vendor zero-price stats so a single broken scraper can't nuke a vendor.
    const stats = await pool.query(`
      SELECT v.id AS vendor_id, v.name AS vendor_name,
             count(p.*)::int AS total,
             count(*) FILTER (WHERE p.price = 0 OR p.price IS NULL)::int AS zero
      FROM "Vendor" v
      JOIN "Product" p ON p."vendorId" = v.id
      GROUP BY v.id, v.name
      HAVING count(*) FILTER (WHERE p.price = 0 OR p.price IS NULL) > 0
      ORDER BY v.name
    `);

    for (const row of stats.rows) {
      const total = row.total as number;
      const zero = row.zero as number;
      const ratio = total === 0 ? 0 : zero / total;

      if (ratio > MAX_ZERO_RATIO) {
        console.log(
          `⚠️  ${row.vendor_name}: ${zero}/${total} (${(ratio * 100).toFixed(0)}%) zero-price — SKIPPING (likely broken price selector, not deleting)`,
        );
        skippedVendors++;
        continue;
      }

      const del = await pool.query(
        `DELETE FROM "Product" WHERE "vendorId" = $1 AND (price = 0 OR price IS NULL)`,
        [row.vendor_id],
      );
      const deleted = del.rowCount || 0;
      totalDeleted += deleted;
      console.log(`  ${row.vendor_name}: deleted ${deleted} zero-price (of ${total})`);
    }

    console.log('\nCleanup Summary:');
    console.log('----------------');
    console.log(`Deleted ${totalDeleted} zero-price products from database`);
    if (skippedVendors > 0) {
      console.log(
        `Skipped ${skippedVendors} vendor(s) with a suspiciously high zero-price ratio — check those scrapers.`,
      );
    }
  } catch (error) {
    console.error('Error during deletion:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

deleteZeroPriceProducts()
  .then(() => console.log('Cleanup completed successfully'))
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  });
