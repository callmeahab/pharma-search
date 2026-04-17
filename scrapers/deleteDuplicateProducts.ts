import { assertCoreSchema, createDbPool } from './helpers/db';

const pool = createDbPool();

async function deleteDuplicateProducts() {
  try {
    await assertCoreSchema(pool);

    const duplicateGroupsResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT 1
        FROM "Product"
        GROUP BY LOWER(title), "vendorId", price
        HAVING COUNT(*) > 1
      ) duplicate_groups
    `);

    const duplicateGroups = duplicateGroupsResult.rows[0]?.count || 0;

    const deleteResult = await pool.query(`
      WITH ranked_products AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(title), "vendorId", price
            ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
          ) AS row_number
        FROM "Product"
      ),
      deleted AS (
        DELETE FROM "Product" p
        USING ranked_products r
        WHERE p.id = r.id
          AND r.row_number > 1
        RETURNING p.id
      )
      SELECT COUNT(*)::int AS deleted_count
      FROM deleted
    `);

    const totalDeleted = deleteResult.rows[0]?.deleted_count || 0;

    console.log('\nDeletion Summary:');
    console.log('================');
    console.log(`Total duplicate groups processed: ${duplicateGroups}`);
    console.log(`Total products deleted: ${totalDeleted}`);
  } catch (error) {
    console.error('Error deleting duplicate products:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

deleteDuplicateProducts();
