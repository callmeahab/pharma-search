# Migration from Prisma to Native PostgreSQL

This guide explains how to migrate from Prisma to the consolidated PostgreSQL schema.

## 🗂️ Consolidated Files

All SQL functionality has been consolidated into:
- **`schema.sql`** - Complete database schema with all tables, indexes, functions, and views

## 🗑️ Files/Directories Removed

### Prisma Files
- `frontend/prisma/` (entire directory)
- `prisma/` (entire directory)

### Old SQL Files (now consolidated)
- `backend/sql/init.sql`
- `backend/sql/enhanced_search_functions.sql`
- `backend/sql/optimize_search_indexes.sql`
- `backend/scripts/update_schema.sql`
- `backend/scripts/apply_schema_updates.py`

## 🚀 Quick Migration

### Option 1: Automated Migration (Recommended)

**Windows:**
```bash
./migrate_from_prisma.bat
```

**Linux/macOS:**
```bash
chmod +x migrate_from_prisma.sh
./migrate_from_prisma.sh
```

### Option 2: Manual Migration

1. **Backup your database:**
   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. **Apply the new schema:**
   ```bash
   psql $DATABASE_URL -f schema.sql
   ```

3. **Remove Prisma dependencies:**
   ```bash
   npm uninstall @prisma/client prisma
   ```

4. **Install new dependencies:**
   ```bash
   pip install asyncpg python-dotenv
   ```

## 📋 Schema Features

### Core Tables
- `Vendor` - Pharmacy vendors
- `VendorLocations` - Vendor physical locations  
- `Product` - Products with full search/ML enhancements
- `ProductGroup` - Product groupings for price comparison
- `Brand`, `Unit`, `ProductName` - Reference tables
- `Category`, `User` - Additional entities

### Enhanced Columns in Product Table
- **Search:** `searchTokens`, `searchVector`, `normalizedName`
- **ML:** `mlEmbedding`, `similarityHash`, `groupingKey`
- **Processing:** `strength`, `form`, `category`, `preprocessedAt`
- **Grouping:** `coreProductIdentity`, `similarityKey`, `formCategory`

### Search Functions
- `fast_product_search()` - Advanced product search with fuzzy matching
- `fast_autocomplete_search()` - Autocomplete functionality
- `expand_pharma_abbreviations()` - Pharmaceutical abbreviation expansion
- `find_similar_products_by_hash()` - ML similarity search

### Views
- `product_groups` - Simple product grouping view
- `PriceComparisonView` - Price comparison analytics
- `GroupingSummary` - Grouping statistics
- `ProductGroupStats` - Materialized view for performance

## 🔧 Code Changes Required

### Replace Prisma Client Usage

**Before (Prisma):**
```typescript
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// Find products
const products = await prisma.product.findMany({
  where: { price: { gte: 100 } },
  include: { vendor: true, brand: true }
})

// Create product
const product = await prisma.product.create({
  data: { title: 'Test', price: 100, vendorId: 'vendor1' }
})
```

**After (AsyncPG):**
```python
import asyncpg

# Find products
async with pool.acquire() as conn:
    products = await conn.fetch("""
        SELECT p.*, v.name as vendor_name, b.name as brand_name
        FROM "Product" p
        JOIN "Vendor" v ON p."vendorId" = v.id
        LEFT JOIN "Brand" b ON p."brandId" = b.id
        WHERE p.price >= $1
    """, 100)

# Create product
async with pool.acquire() as conn:
    product_id = await conn.fetchval("""
        INSERT INTO "Product" (title, price, "vendorId")
        VALUES ($1, $2, $3)
        RETURNING id
    """, 'Test', 100, 'vendor1')
```

### Database Connection Setup

**Create `database_config.py`:**
```python
import os
import asyncpg

class DatabaseConfig:
    def __init__(self):
        self.database_url = os.getenv('DATABASE_URL')
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable must be set")
    
    async def get_pool(self) -> asyncpg.Pool:
        return await asyncpg.create_pool(self.database_url)
    
    async def get_connection(self) -> asyncpg.Connection:
        return await asyncpg.connect(self.database_url)

db_config = DatabaseConfig()
```

## 🏗️ New Search Capabilities

### 1. Enhanced Product Search
```sql
SELECT * FROM fast_product_search('vitamin d3', 0, 1000, NULL, NULL, 50);
```

### 2. Pharmaceutical Abbreviation Support
- `vitc` → `vitamin c`
- `d3` → `vitamin d3`
- `prob` → `probiotic`
- `coq10` → `coenzyme q10`

### 3. ML-Enhanced Grouping
Products are automatically grouped using:
- Rule-based similarity matching
- ML embeddings for semantic similarity  
- Pharmaceutical-specific logic
- Dosage and form awareness

### 4. Price Comparison Views
```sql
-- Get price comparisons for grouped products
SELECT * FROM "PriceComparisonView" 
WHERE group_id = 'some-group-id'
ORDER BY price;

-- Get grouping statistics
SELECT * FROM "GroupingSummary";
```

## 🚀 Post-Migration Steps

1. **Update application code** to use asyncpg instead of Prisma
2. **Run preprocessing:**
   ```bash
   python backend/scripts/preprocess_products.py
   ```
3. **Setup ML models:**
   ```bash
   python backend/scripts/setup_ml.py
   ```
4. **Test all functionality** to ensure everything works

## 📊 Performance Improvements

The new schema includes:
- **80+ optimized indexes** for fast queries
- **Trigram indexes** for fuzzy search
- **GIN indexes** for array and full-text search  
- **Materialized views** for complex analytics
- **Automatic statistics** maintenance via triggers

## 🆘 Rollback Plan

If you need to rollback:
1. Restore from the backup created during migration
2. Reinstall Prisma dependencies
3. Revert any code changes

The migration script creates a timestamped backup file (`backup_YYYYMMDD_HHMMSS.sql`) that you can use to restore your original database state.

## 📞 Support

If you encounter issues:
1. Check the backup file was created successfully
2. Verify DATABASE_URL is correctly set
3. Ensure all dependencies are installed
4. Test database connectivity with `psql $DATABASE_URL`

The consolidated schema provides all the functionality of the original Prisma setup plus enhanced search, ML capabilities, and better performance.