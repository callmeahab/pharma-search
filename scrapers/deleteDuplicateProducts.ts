import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface Product {
  id: string;
  title: string;
  price: number;
  vendorId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductWithVendor extends Product {
  vendor: {
    name: string;
  };
}

async function deleteDuplicateProducts() {
  try {
    // Get all products with their vendor information
    const query = `
      SELECT 
        p.id,
        p.title,
        p.price,
        p."vendorId",
        p."createdAt",
        p."updatedAt",
        v.name as vendor_name
      FROM "Product" p
      JOIN "Vendor" v ON p."vendorId" = v.id
      ORDER BY p."updatedAt" DESC
    `;
    
    const result = await pool.query(query);
    const products: ProductWithVendor[] = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      price: row.price,
      vendorId: row.vendorId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      vendor: {
        name: row.vendor_name
      }
    }));

    // Create a map to store duplicate counts and track which ones to keep
    const duplicateMap = new Map<string, ProductWithVendor[]>();

    // Group products by title, vendor name, and price
    products.forEach((product: ProductWithVendor) => {
      const key = `${product.title}|${product.vendor.name}|${product.price}`;
      const existing = duplicateMap.get(key) || [];
      existing.push(product);
      duplicateMap.set(key, existing);
    });

    // Filter out non-duplicates
    const duplicates = Array.from(duplicateMap.entries()).filter(
      ([_, products]) => products.length > 1
    );

    console.log("\nDuplicate Products Report:");
    console.log("========================\n");

    let totalDeleted = 0;
    let totalGroups = 0;

    // Process each group of duplicates
    for (const [key, products] of duplicates) {
      const [title, vendor, price] = key.split("|");
      const keepProduct = products[0]; // Keep the most recent one
      const deleteProducts = products.slice(1); // Delete the rest

      console.log(`\nProcessing duplicates for:`);
      console.log(`Product: ${title}`);
      console.log(`Vendor: ${vendor}`);
      console.log(`Price: ${price}`);
      console.log(`Total duplicates: ${products.length}`);
      console.log(`Keeping product ID: ${keepProduct.id}`);
      console.log(`Deleting ${deleteProducts.length} duplicates...`);

      // Delete from database
      const deleteIds = deleteProducts.map((p) => p.id);
      const deleteQuery = `
        DELETE FROM "Product" 
        WHERE id = ANY($1)
      `;
      
      const deleteResult = await pool.query(deleteQuery, [deleteIds]);

      totalDeleted += deleteResult.rowCount || 0;
      totalGroups++;

      console.log(`Successfully deleted ${deleteResult.rowCount || 0} duplicates\n`);
    }

    console.log("\nDeletion Summary:");
    console.log("================");
    console.log(`Total duplicate groups processed: ${totalGroups}`);
    console.log(`Total products deleted: ${totalDeleted}`);
  } catch (error) {
    console.error("Error deleting duplicate products:", error);
  } finally {
    await pool.end();
  }
}

// Run the script
deleteDuplicateProducts();
