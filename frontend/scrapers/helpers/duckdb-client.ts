import duckdb from 'duckdb';
import { randomBytes } from 'crypto';

export interface Product {
  title: string;
  price: string;
  category: string;
  link: string;
  thumbnail: string;
  photos: string;
}

export interface Vendor {
  id: string;
  name: string;
  logo?: string;
  website?: string;
  scraperFile?: string;
}

export class DuckDBClient {
  private db: duckdb.Database;
  private connection: duckdb.Connection;

  constructor(dbPath: string) {
    this.db = new duckdb.Database(dbPath);
    this.connection = this.db.connect();
  }

  vendor = {
    findFirst: async (options: { where: { name: string } }): Promise<Vendor | null> => {
      return new Promise((resolve, reject) => {
        this.connection.all(
          'SELECT * FROM Vendor WHERE name = ? LIMIT 1',
          [options.where.name],
          (err: Error | null, rows: any[]) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (rows.length === 0) {
              resolve(null);
              return;
            }
            
            const row = rows[0];
            resolve({
              id: row.id,
              name: row.name,
              logo: row.logo,
              website: row.website,
              scraperFile: row.scraperFile
            });
          }
        );
      });
    },

    findMany: async (options?: { take?: number }): Promise<Vendor[]> => {
      return new Promise((resolve, reject) => {
        const limit = options?.take ? ` LIMIT ${options.take}` : '';
        this.connection.all(
          `SELECT * FROM Vendor${limit}`,
          [],
          (err: Error | null, rows: any[]) => {
            if (err) {
              reject(err);
              return;
            }
            
            resolve(rows.map(row => ({
              id: row.id,
              name: row.name,
              logo: row.logo,
              website: row.website,
              scraperFile: row.scraperFile
            })));
          }
        );
      });
    }
  };

  product = {
    findMany: async (options: {
      where: {
        title: string;
        vendorId: string;
      };
      orderBy?: {
        createdAt: string;
      };
    }): Promise<any[]> => {
      return new Promise((resolve, reject) => {
        const orderBy = options.orderBy?.createdAt === 'desc' ? 'ORDER BY createdAt DESC' : '';
        this.connection.all(
          `SELECT * FROM Product WHERE title = ? AND vendorId = ? ${orderBy}`,
          [options.where.title, options.where.vendorId],
          (err: Error | null, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          }
        );
      });
    },

    deleteMany: async (options: {
      where: {
        id: {
          in: string[];
        };
      };
    }): Promise<void> => {
      return new Promise((resolve, reject) => {
        const ids = options.where.id.in;
        if (ids.length === 0) {
          resolve();
          return;
        }
        
        const placeholders = ids.map(() => '?').join(',');
        this.connection.run(
          `DELETE FROM Product WHERE id IN (${placeholders})`,
          ids,
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    },

    update: async (options: {
      where: { id: string };
      data: {
        price: number;
        category?: string;
        updatedAt?: Date;
      };
    }): Promise<void> => {
      return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        this.connection.run(
          `UPDATE Product SET price = ?, category = ?, updatedAt = ? WHERE id = ?`,
          [options.data.price, options.data.category, now, options.where.id],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    },

    create: async (options: {
      data: {
        title: string;
        price: number;
        category?: string;
        link: string;
        thumbnail: string;
        photos: string;
        vendorId: string;
      }
    }): Promise<void> => {
      return new Promise((resolve, reject) => {
        const id = this.generateId();
        const now = new Date().toISOString();
        
        this.connection.run(
          `INSERT INTO Product (
            id, vendorId, price, title, category, link, thumbnail, photos, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            options.data.vendorId,
            options.data.price,
            options.data.title,
            options.data.category,
            options.data.link,
            options.data.thumbnail,
            options.data.photos,
            now,
            now
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    },

    count: async (): Promise<number> => {
      return new Promise((resolve, reject) => {
        this.connection.get(
          'SELECT COUNT(*) as count FROM Product',
          [],
          (err: Error | null, row: any) => {
            if (err) {
              reject(err);
            } else {
              resolve(row.count);
            }
          }
        );
      });
    }
  };

  async $disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.connection.close();
      this.db.close();
      resolve();
    });
  }

  private generateId(): string {
    // Generate a random string similar to Prisma's cuid format
    return randomBytes(12).toString('base64url');
  }
}

// Create and export a singleton instance
import { homedir } from 'os';
import { join } from 'path';

const dbPath = process.env.DATABASE_PATH || join(homedir(), 'pharma_search.db');
export const duckdbClient = new DuckDBClient(dbPath);