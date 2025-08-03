// API client for scrapers to communicate with the DuckDB backend
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

export interface ApiProduct {
  id: string;
  title: string;
  price: number;
  category?: string;
  link: string;
  thumbnail: string;
  photos: string;
  vendorId: string;
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  vendor = {
    findFirst: async (options: { where: { name: string } }): Promise<Vendor | null> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/vendors?name=${encodeURIComponent(options.where.name)}`);
        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const vendors = await response.json();
        return vendors.length > 0 ? vendors[0] : null;
      } catch (error) {
        console.error('Error finding vendor:', error);
        throw error;
      }
    },

    findMany: async (options?: { take?: number }): Promise<Vendor[]> => {
      try {
        const limit = options?.take ? `?limit=${options.take}` : '';
        const response = await fetch(`${this.baseUrl}/api/vendors${limit}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Error finding vendors:', error);
        throw error;
      }
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
    }): Promise<ApiProduct[]> => {
      try {
        const params = new URLSearchParams({
          title: options.where.title,
          vendorId: options.where.vendorId
        });
        if (options.orderBy?.createdAt) {
          params.append('orderBy', `createdAt:${options.orderBy.createdAt}`);
        }
        
        const response = await fetch(`${this.baseUrl}/api/products?${params}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Error finding products:', error);
        throw error;
      }
    },

    deleteMany: async (options: {
      where: {
        id: {
          in: string[];
        };
      };
    }): Promise<void> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/products/bulk-delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ids: options.where.id.in })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
      } catch (error) {
        console.error('Error deleting products:', error);
        throw error;
      }
    },

    update: async (options: {
      where: { id: string };
      data: {
        price: number;
        category?: string;
        updatedAt?: Date;
      };
    }): Promise<void> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/products/${options.where.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(options.data)
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
      } catch (error) {
        console.error('Error updating product:', error);
        throw error;
      }
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
      try {
        const response = await fetch(`${this.baseUrl}/api/products`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(options.data)
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
      } catch (error) {
        console.error('Error creating product:', error);
        throw error;
      }
    },

    count: async (): Promise<number> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/products/count`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        const result = await response.json();
        return result.count;
      } catch (error) {
        console.error('Error counting products:', error);
        throw error;
      }
    }
  };

  async $disconnect(): Promise<void> {
    // No connection to close for HTTP client
    return Promise.resolve();
  }
}

// Create and export a singleton instance
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const apiClient = new ApiClient(apiUrl);