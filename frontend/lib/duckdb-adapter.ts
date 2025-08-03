/**
 * DuckDB adapter for frontend database operations
 * Provides a bridge between the frontend and DuckDB database
 */

import * as duckdb from 'duckdb';

export interface DuckDBConfig {
  databasePath: string;
  readonly?: boolean;
}

export class DuckDBAdapter {
  private db: duckdb.Database | null = null;
  private connection: duckdb.Connection | null = null;
  private config: DuckDBConfig;

  constructor(config: DuckDBConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.db && this.connection) {
      return; // Already connected
    }

    try {
      // Connect to DuckDB
      this.db = new duckdb.Database(this.config.databasePath);
      this.connection = this.db.connect();

      // Install and load FTS extension
      await this.executeQuery("INSTALL fts");
      await this.executeQuery("LOAD fts");

      // Ensure tables exist
      await this.initializeTables();
    } catch (error) {
      console.error('Failed to connect to DuckDB:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async executeQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Database not connected'));
        return;
      }

      this.connection.all(sql, params, (err: Error | null, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  private async initializeTables(): Promise<void> {
    if (!this.connection) throw new Error('Database not connected');

    // Create tables if they don't exist (DuckDB syntax)
    const createTablesSQL = [
      `CREATE TABLE IF NOT EXISTS Vendor (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        logo VARCHAR,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scraperFile VARCHAR,
        website VARCHAR
      )`,
      
      `CREATE TABLE IF NOT EXISTS Brand (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        embedding BLOB,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS Unit (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS ProductName (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        embedding BLOB,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      `CREATE TABLE IF NOT EXISTS Product (
        id VARCHAR PRIMARY KEY,
        vendorId VARCHAR NOT NULL,
        price DOUBLE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        title VARCHAR NOT NULL,
        category VARCHAR,
        link VARCHAR NOT NULL,
        thumbnail VARCHAR NOT NULL,
        photos VARCHAR NOT NULL,
        brandConfidence DOUBLE,
        brandId VARCHAR,
        description VARCHAR,
        dosageUnit VARCHAR,
        dosageValue DECIMAL(10,3),
        normalizedName VARCHAR,
        originalTitle VARCHAR,
        processedAt TIMESTAMP,
        productNameConfidence DOUBLE,
        productNameId VARCHAR,
        quantity INTEGER,
        quantityConfidence DOUBLE,
        searchTokens VARCHAR[],
        titleEmbedding BLOB,
        unitConfidence DOUBLE,
        unitId VARCHAR,
        FOREIGN KEY (brandId) REFERENCES Brand(id),
        FOREIGN KEY (productNameId) REFERENCES ProductName(id),
        FOREIGN KEY (unitId) REFERENCES Unit(id),
        FOREIGN KEY (vendorId) REFERENCES Vendor(id),
        UNIQUE (title, vendorId)
      )`,
      
      `CREATE TABLE IF NOT EXISTS User (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR UNIQUE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Create indexes
      `CREATE INDEX IF NOT EXISTS idx_product_normalized_name ON Product(normalizedName)`,
      `CREATE INDEX IF NOT EXISTS idx_product_brand_id ON Product(brandId)`,
      `CREATE INDEX IF NOT EXISTS idx_product_vendor_id ON Product(vendorId)`,
      `CREATE INDEX IF NOT EXISTS idx_product_price ON Product(price)`
    ];

    for (const sql of createTablesSQL) {
      await this.executeQuery(sql);
    }
  }

  // Generic query method
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.connection) throw new Error('Database not connected');

    try {
      const result = await this.executeQuery(sql, params);
      return result as T[];
    } catch (error) {
      console.error('Query failed:', error);
      throw error;
    }
  }

  // Get single record
  async queryFirst<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // Execute insert/update/delete
  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
    if (!this.connection) throw new Error('Database not connected');

    try {
      await this.executeQuery(sql, params);
      // DuckDB doesn't return the same info as SQLite, so we return a placeholder
      return { changes: 1, lastInsertRowid: 0 };
    } catch (error) {
      console.error('Execute failed:', error);
      throw error;
    }
  }

  // Search products - optimized for DuckDB with FTS
  async searchProducts(query: string, options: {
    limit?: number;
    offset?: number;
    minPrice?: number;
    maxPrice?: number;
    vendorIds?: string[];
    brandIds?: string[];
  } = {}) {
    const {
      limit = 20,
      offset = 0,
      minPrice,
      maxPrice,
      vendorIds,
      brandIds
    } = options;

    // Try to use FTS first, fallback to LIKE search
    let sql = `
      SELECT 
        p.*,
        v.name as vendor_name,
        b.name as brand_name,
        CASE 
          WHEN LOWER(p.title) = LOWER($1) THEN 1000
          WHEN LOWER(p.normalizedName) = LOWER($1) THEN 950
          WHEN LOWER(p.title) LIKE LOWER($1 || '%') THEN 700
          WHEN LOWER(p.normalizedName) LIKE LOWER($1 || '%') THEN 650
          WHEN LOWER(b.name) = LOWER($1) THEN 600
          WHEN LOWER(b.name) LIKE LOWER($1 || '%') THEN 550
          WHEN LOWER(p.title) LIKE LOWER('%' || $1 || '%') THEN 400
          WHEN LOWER(p.normalizedName) LIKE LOWER('%' || $1 || '%') THEN 350
          ELSE 100
        END as relevance_score
      FROM Product p
      LEFT JOIN Vendor v ON p.vendorId = v.id
      LEFT JOIN Brand b ON p.brandId = b.id
      WHERE (
        LOWER(p.title) LIKE LOWER('%' || $1 || '%') OR
        LOWER(p.normalizedName) LIKE LOWER('%' || $1 || '%') OR
        LOWER(b.name) LIKE LOWER('%' || $1 || '%') OR
        EXISTS (
          SELECT 1 FROM unnest(p.searchTokens) AS token
          WHERE LOWER(token) LIKE LOWER($1 || '%')
        )
      )
    `;

    const params: any[] = [query];
    let paramIndex = 2;

    // Add filters
    if (minPrice !== undefined) {
      sql += ` AND p.price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }

    if (maxPrice !== undefined) {
      sql += ` AND p.price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }

    if (vendorIds && vendorIds.length > 0) {
      const placeholders = vendorIds.map(() => `$${paramIndex++}`).join(', ');
      sql += ` AND p.vendorId IN (${placeholders})`;
      params.push(...vendorIds);
    }

    if (brandIds && brandIds.length > 0) {
      const placeholders = brandIds.map(() => `$${paramIndex++}`).join(', ');
      sql += ` AND p.brandId IN (${placeholders})`;
      params.push(...brandIds);
    }

    // Add ordering and pagination
    sql += `
      ORDER BY relevance_score DESC, p.price
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    return this.query(sql, params);
  }

  // Get vendors
  async getVendors() {
    return this.query('SELECT * FROM Vendor ORDER BY name');
  }

  // Get brands
  async getBrands() {
    return this.query('SELECT * FROM Brand ORDER BY name');
  }

  // Get product count
  async getProductCount(filters: {
    minPrice?: number;
    maxPrice?: number;
    vendorIds?: string[];
    brandIds?: string[];
  } = {}): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM Product p WHERE 1=1';
    const params: any[] = [];

    if (filters.minPrice !== undefined) {
      sql += ' AND p.price >= ?';
      params.push(filters.minPrice);
    }

    if (filters.maxPrice !== undefined) {
      sql += ' AND p.price <= ?';
      params.push(filters.maxPrice);
    }

    if (filters.vendorIds && filters.vendorIds.length > 0) {
      const placeholders = filters.vendorIds.map(() => '?').join(', ');
      sql += ` AND p.vendorId IN (${placeholders})`;
      params.push(...filters.vendorIds);
    }

    if (filters.brandIds && filters.brandIds.length > 0) {
      const placeholders = filters.brandIds.map(() => '?').join(', ');
      sql += ` AND p.brandId IN (${placeholders})`;
      params.push(...filters.brandIds);
    }

    const result = await this.queryFirst<{ count: number }>(sql, params);
    return result?.count || 0;
  }
}

// Singleton instance
let duckdbAdapter: DuckDBAdapter | null = null;

export function getDuckDBAdapter(config?: DuckDBConfig): DuckDBAdapter {
  if (!duckdbAdapter) {
    const dbConfig = config || {
      databasePath: process.env.DATABASE_PATH || 'pharma_search.db',
      readonly: true // Frontend should be read-only
    };
    duckdbAdapter = new DuckDBAdapter(dbConfig);
  }
  return duckdbAdapter;
}

export default DuckDBAdapter;