# Scraper Migration Guide: From Prisma to Native PostgreSQL

This guide explains how to migrate all your scrapers from Prisma to native PostgreSQL using the new database layer.

## 🚀 Quick Migration

### Automated Migration (Recommended)

1. **Run the migration script:**
   ```bash
   python update_scrapers.py
   ```

2. **Install new dependencies:**
   ```bash
   cd frontend
   npm install pg @types/pg
   npm uninstall @prisma/client prisma
   ```

3. **Test a scraper:**
   ```bash
   bun scrapers/apothecary.ts
   ```

### Manual Migration (if needed)

If the automated script doesn't work perfectly, here's how to manually update scrapers:

## 📝 Manual Changes Required

### 1. Update Import Statements

**Before:**
```typescript
import { insertData, Product } from './helpers/utils';
```

**After:**
```typescript
import { insertData, Product, initializeDatabase, closeDatabase } from './helpers/database';
```

### 2. Wrap Main Logic with Database Initialization

**Before:**
```typescript
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'VendorName');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
```

**After:**
```typescript
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    
    if (allProducts.length > 0) {
      await insertData(allProducts, 'VendorName');
      console.log(`Successfully processed ${allProducts.length} products`);
    } else {
      console.log('No products found.');
    }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
  }
}

// Run the scraper
main();
```

## 🗂️ Files Created/Updated

### New Files
- `frontend/scrapers/helpers/database.ts` - New database layer without Prisma
- `frontend/scrapers/helpers/utils_new.ts` - Updated utils (compatibility layer)
- `frontend/scrapers/apothecary_new.ts` - Example updated scraper

### Backup Files
- `frontend/scrapers/helpers/utils_prisma.ts` - Backup of original Prisma utils

## 🔧 What the New Database Layer Provides

### Core Functions
- `insertData(products, vendorName)` - Same interface as before
- `initializeDatabase()` - Initialize connection pool
- `closeDatabase()` - Clean shutdown
- `parsePrice(priceString)` - Price parsing (extracted from old utils)

### Database Operations
- `findVendor(name)` - Find vendor by name
- `findExistingProducts(title, vendorId)` - Find duplicates
- `createProduct(data)` - Create new product
- `updateProduct(id, data)` - Update existing product
- `deleteDuplicateProducts(ids)` - Clean up duplicates

## 📦 Dependencies

### Remove
```bash
npm uninstall @prisma/client prisma
```

### Add
```bash
npm install pg @types/pg
```

## 🧪 Testing Your Migration

### Test Individual Scraper
```bash
# Make sure DATABASE_URL is set
export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"

# Or on Windows
set DATABASE_URL=postgresql://user:pass@localhost:5432/dbname

# Test scraper
bun scrapers/apothecary.ts
```

### Test Scraper Runner
```bash
bun scripts/run-scrapers-local.ts
```

## 🔍 Troubleshooting

### Common Issues

1. **"Database connection failed"**
   - Check DATABASE_URL is set correctly
   - Ensure PostgreSQL is running
   - Verify credentials and database exists

2. **"Vendor not found"**
   - Make sure vendor exists in database: `SELECT * FROM "Vendor"`
   - Check vendor name spelling matches exactly

3. **Import errors**
   - Make sure you've run the migration script
   - Check that database.ts file exists
   - Verify pg dependency is installed

### Validation

1. **Check scrapers work:**
   ```bash
   # Should complete without errors
   bun scrapers/apothecary.ts
   ```

2. **Check data is inserted:**
   ```sql
   SELECT COUNT(*) FROM "Product" WHERE "vendorId" = (SELECT id FROM "Vendor" WHERE name = 'Apothecary');
   ```

3. **Check no Prisma references remain:**
   ```bash
   grep -r "PrismaClient\|@prisma/client" frontend/scrapers/
   # Should return no results
   ```

## 🚀 Benefits of New System

1. **No Prisma dependency** - Simpler deployment
2. **Direct SQL control** - Better performance tuning
3. **Connection pooling** - Better resource management
4. **Error handling** - More robust error recovery
5. **Cleaner shutdown** - Proper connection cleanup

## 🔄 Rollback Plan

If you need to rollback:

1. **Restore original utils:**
   ```bash
   cd frontend/scrapers/helpers
   cp utils_prisma.ts utils.ts
   ```

2. **Reinstall Prisma:**
   ```bash
   npm install @prisma/client prisma
   npm uninstall pg @types/pg
   ```

3. **Revert scraper changes** (if you made manual changes)

## 📊 Migration Status

After running `python update_scrapers.py`, you should see:

- ✅ All `.ts` files in `frontend/scrapers/` updated
- ✅ New database layer created
- ✅ Backup of original utils created
- ✅ Import statements updated
- ✅ Main function wrappers added

The migration preserves all existing scraper logic while replacing only the database layer.