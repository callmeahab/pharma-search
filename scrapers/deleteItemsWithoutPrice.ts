import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function deleteZeroPriceProducts() {
  let dbDeleted = 0;

  try {
    // Delete all zero-price products
    const deleteQuery = `
      DELETE FROM "Product" 
      WHERE price = 0 OR price IS NULL
    `;
    
    const deleteResult = await pool.query(deleteQuery);
    dbDeleted = deleteResult.rowCount || 0;
    console.log(`Deleted ${dbDeleted} zero-price products from database`);

    // Verify deletion
    const verifyQuery = `
      SELECT COUNT(*) as count 
      FROM "Product" 
      WHERE price = 0 OR price IS NULL
    `;
    
    const verifyResult = await pool.query(verifyQuery);
    const remainingCount = parseInt(verifyResult.rows[0].count);
    
    if (remainingCount > 0) {
      console.log(`Warning: ${remainingCount} zero-price products still remain`);
    } else {
      console.log('All zero-price products successfully removed');
    }

    // Summary log
    console.log("\nCleanup Summary:");
    console.log("----------------");
    console.log(`Database records deleted: ${dbDeleted}`);
  } catch (error) {
    console.error("Error during deletion:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Execute the cleanup
deleteZeroPriceProducts()
  .then(() => console.log("Cleanup completed successfully"))
  .catch((error) => console.error("Cleanup failed:", error));
