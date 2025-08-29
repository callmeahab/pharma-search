/**
 * Database utilities for scrapers (without Prisma)
 * Handles database connections and operations using asyncpg
 */

import { Pool, PoolClient } from 'pg';

export interface Product {
  title: string;
  price: string;
  category: string;
  link: string;
  thumbnail: string;
  photos: string;
}

export interface DatabaseConfig {
  connectionString: string;
  pool: Pool | null;
}

class DatabaseManager {
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  constructor() {
    this.config = {
      connectionString: process.env.DATABASE_URL || '',
      pool: null
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.config.connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      try {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('✅ Database connection established');
      } catch (error) {
        console.error('❌ Failed to connect to database:', error);
        throw error;
      }
    }
  }

  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      await this.initialize();
    }
    return this.pool!.connect();
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async findVendor(vendorName: string): Promise<{ id: string; name: string } | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        'SELECT id, name FROM "Vendor" WHERE name = $1 LIMIT 1',
        [vendorName]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async findExistingProducts(title: string, vendorId: string): Promise<Array<{ id: string; createdAt: Date }>> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        'SELECT id, "createdAt" FROM "Product" WHERE title = $1 AND "vendorId" = $2 ORDER BY "createdAt" DESC',
        [title, vendorId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async deleteDuplicateProducts(productIds: string[]): Promise<number> {
    if (productIds.length === 0) return 0;

    const client = await this.getClient();
    try {
      const result = await client.query(
        'DELETE FROM "Product" WHERE id = ANY($1::text[])',
        [productIds]
      );
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async updateProduct(productId: string, productData: {
    price: number;
    category: string;
    link: string;
    thumbnail: string;
    photos: string;
  }): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query(
        `UPDATE "Product" 
         SET price = $2, category = $3, link = $4, thumbnail = $5, photos = $6, "updatedAt" = NOW()
         WHERE id = $1`,
        [productId, productData.price, productData.category, productData.link, productData.thumbnail, productData.photos]
      );
    } finally {
      client.release();
    }
  }

  async createProduct(productData: {
    title: string;
    price: number;
    category: string;
    link: string;
    thumbnail: string;
    photos: string;
    vendorId: string;
  }): Promise<string> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `INSERT INTO "Product" (title, price, category, link, thumbnail, photos, "vendorId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id`,
        [
          productData.title,
          productData.price,
          productData.category,
          productData.link,
          productData.thumbnail,
          productData.photos,
          productData.vendorId
        ]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async countVendorProducts(vendorId: string): Promise<number> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        'SELECT COUNT(*) as count FROM "Product" WHERE "vendorId" = $1',
        [vendorId]
      );
      return parseInt(result.rows[0].count, 10);
    } finally {
      client.release();
    }
  }
}

// Global database manager instance
const dbManager = new DatabaseManager();

/**
 * Parse price string and convert to number
 */
export function parsePrice(priceString: string): number {
  if (!priceString) return 0;

  let p = priceString;
  // Remove currency symbols, spaces and other non-numeric characters except . and ,
  p = p.replace(/[^\d.,]/g, "");

  let price: number;
  // Count dots and commas to better detect format
  const dotCount = (p.match(/\./g) || []).length;
  const commaCount = (p.match(/,/g) || []).length;

  // Helper to count digits after decimal separator
  const digitsAfterDecimal = (str: string, separator: string) => {
    const parts = str.split(separator);
    return parts[1]?.replace(/[^\d]/g, "").length || 0;
  };

  if (
    // European format indicators:
    (commaCount === 1 && digitsAfterDecimal(p, ",") === 2) || // e.g., 33.746,30
    (commaCount === 1 &&
      p.includes(".") &&
      p.indexOf(",") > p.indexOf(".")) || // e.g., 33.746,30
    // Handle cases where dot is used as thousand separator
    (dotCount === 1 &&
      commaCount === 0 &&
      (p.split(".")[1].length === 3 || // e.g., 23.911 or 1.390
        (p.endsWith("000") && p.split(".")[0].length > 0))) || // e.g., 1.000
    // Handle multiple dots as thousand separators
    (dotCount > 1 && commaCount === 0) || // e.g., 1.533.179
    // Handle simple numbers without thousand separators
    (commaCount === 0 && dotCount === 0) // e.g., 100
  ) {
    if (commaCount === 1) {
      // European format with comma: convert to US format
      p = p.replace(/\./g, "").replace(",", ".");
    } else if (dotCount >= 1) {
      // Treat as European format where dot(s) are thousand separator(s)
      p = p.replace(/\./g, "");
    }
    price = parseFloat(p);
  } else if (
    // US format indicators:
    (dotCount === 1 && digitsAfterDecimal(p, ".") === 2) || // e.g., 1,000.00
    (dotCount === 1 && p.indexOf(".") > p.lastIndexOf(",")) || // e.g., 1,123.32
    (commaCount > 0 &&
      dotCount === 1 &&
      p.indexOf(".") > p.indexOf(",")) // e.g., 1,000.00
  ) {
    // US format: remove thousand separators
    p = p.replace(/,/g, "");
    price = parseFloat(p);
  } else {
    // Any other format, try simple comma removal
    p = p.replace(/,/g, "");
    price = parseFloat(p);
  }

  if (isNaN(price)) {
    price = 0; // Default value if parsing fails
  }

  return price;
}

/**
 * Insert scraped product data into database
 * Replaces the Prisma-based insertData function
 */
export async function insertData(allProducts: Product[], shopName: string): Promise<void> {
  try {
    // Find the vendor
    const vendor = await dbManager.findVendor(shopName);
    if (!vendor) {
      throw new Error(`Vendor "${shopName}" not found`);
    }

    let successCount = 0;
    let errorCount = 0;

    // Process products in smaller batches to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
      const batch = allProducts.slice(i, i + BATCH_SIZE);

      for (const product of batch) {
        try {
          const price = parsePrice(product.price);

          // First check for any duplicate products
          const duplicateProducts = await dbManager.findExistingProducts(product.title, vendor.id);

          if (duplicateProducts.length > 1) {
            // Keep only the most recent product, delete others
            const [keepProduct, ...deleteProducts] = duplicateProducts;
            const deletedCount = await dbManager.deleteDuplicateProducts(
              deleteProducts.map(p => p.id)
            );
            console.log(
              `Deleted ${deletedCount} duplicate products for "${product.title}"`
            );
          }

          // Now proceed with update or create
          if (duplicateProducts.length > 0) {
            // Update the most recent product
            await dbManager.updateProduct(duplicateProducts[0].id, {
              price,
              category: product.category,
              link: product.link,
              thumbnail: product.thumbnail,
              photos: product.photos,
            });
          } else {
            // Create new product
            await dbManager.createProduct({
              title: product.title,
              price,
              category: product.category,
              link: product.link,
              thumbnail: product.thumbnail,
              photos: product.photos,
              vendorId: vendor.id,
            });
          }

          successCount++;
        } catch (error) {
          console.error(`Error processing product "${product.title}":`, error);
          errorCount++;
        }
      }

      // Add a small delay between batches to prevent overwhelming the database
      if (i + BATCH_SIZE < allProducts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `Successfully processed ${successCount} products, ${errorCount} errors.`
    );

    const totalProducts = await dbManager.countVendorProducts(vendor.id);
    console.log(`Total products for ${shopName}: ${totalProducts}`);

  } catch (error) {
    console.error("Error inserting products into database:", error);
    throw error;
  }
}

/**
 * Initialize database connection
 * Call this before using any database operations
 */
export async function initializeDatabase(): Promise<void> {
  await dbManager.initialize();
}

/**
 * Close database connection
 * Call this when done with database operations
 */
export async function closeDatabase(): Promise<void> {
  await dbManager.close();
}

export default dbManager;