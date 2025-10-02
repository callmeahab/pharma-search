# Quick Guide: After Scraping New Products

## ⚡ TL;DR - 3 Commands

```bash
# 1. Update mappings from new products
python3 scripts/update_mappings.py

# 2. Test the updated grouping
cd go-backend && go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go

# 3. Commit changes
git add go-backend/comprehensive_mappings.go
git commit -m "Update mappings with new product data"
```

## 📋 Detailed Workflow

### When You Add a New Vendor/Source:

1. **Scrape Products** (you already do this)
   ```bash
   # Your existing scraper
   python3 scrapers/new_vendor.py
   ```

2. **Ensure Data is in products.csv**
   ```bash
   # Check the file exists and has data
   wc -l products.csv
   head products.csv
   ```

3. **Run Auto-Update**
   ```bash
   python3 scripts/update_mappings.py
   ```

   Output will show:
   ```
   📊 Analyzing products from products.csv...
   ✅ Analyzed 182,456 products

   📊 Mappings Generated:
     - 127 brands
     - 11 dosage units
     - 34 product forms
     - 25 active ingredients

   ✅ Generated go-backend/comprehensive_mappings.go
   ```

4. **Review What Changed**
   ```bash
   git diff go-backend/comprehensive_mappings.go
   ```

   Look for:
   - ✅ New brands added
   - ✅ Product counts updated
   - ✅ New forms/units discovered

5. **Test Grouping**
   ```bash
   cd go-backend
   go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go
   ```

   Should show successful groupings like:
   ```
   Group: vitamin_d_standard-iu (2 products)
     ✓ Vitamin D3 2000 IU 30 tableta
     ✓ STRONG NATURE VITAMIN D3 2000IU, 30 kom
   ```

6. **Commit and Deploy**
   ```bash
   git add go-backend/comprehensive_mappings.go
   git commit -m "Update mappings: added NewVendor (15K products)"
   git push

   # Deploy your backend
   # (your existing deployment process)
   ```

## 🔍 What to Check

### Good Signs ✅

- Script completes without errors
- New brands appear in mappings with reasonable counts
- Test grouping shows products grouped correctly
- Coverage stays above 70%

### Warning Signs ⚠️

- **Too many single-product brands**: Lower min-brand-count
  ```bash
  python3 scripts/update_mappings.py --min-brand-count 20
  ```

- **Missing expected brands**: Check products.csv format
  ```bash
  # Format should be: price;title
  head -5 products.csv
  ```

- **Grouping gets worse**: Review git diff, may need manual corrections
  ```bash
  git diff go-backend/comprehensive_mappings.go
  ```

## 🚨 Troubleshooting

### Script Error: "Products file not found"

```bash
# Make sure you're in project root
cd /Users/ahab/pharma-search

# Or specify full path
python3 scripts/update_mappings.py --products-file /full/path/to/products.csv
```

### Script Error: "encoding error"

```bash
# Ensure CSV is UTF-8 encoded
file -I products.csv
# Should show: charset=utf-8

# Convert if needed
iconv -f ISO-8859-1 -t UTF-8 products.csv > products_utf8.csv
mv products_utf8.csv products.csv
```

### Too Many Noise Brands

```bash
# Increase minimum threshold
python3 scripts/update_mappings.py --min-brand-count 20

# Or even higher for very large datasets
python3 scripts/update_mappings.py --min-brand-count 50
```

## 📊 Monitoring

### Check Grouping Quality

After updating mappings, check how well products group:

```bash
# Run a test search
curl "localhost:8080/api/search?q=vitamin+d"

# Check response - look for groups with multiple products:
# "groups": [
#   {
#     "id": "vitamin_d_standard-iu",
#     "product_count": 15,  ← Good! Multiple products in group
#     "vendor_count": 8      ← Good! Multiple vendors = price comparison
#   }
# ]
```

### Database Query

```sql
-- Check grouping coverage
SELECT
  COUNT(*) as total_products,
  COUNT(CASE WHEN enhanced_group_key IS NOT NULL THEN 1 END) as grouped,
  ROUND(100.0 * COUNT(CASE WHEN enhanced_group_key IS NOT NULL THEN 1 END) / COUNT(*), 1) as coverage_pct
FROM products;

-- Target: 70-85% coverage
```

## 🔄 Frequency

### How Often to Run:

| Scenario | Frequency |
|----------|-----------|
| After each scrape | Every time (automated) |
| Added new vendor | Immediately |
| Regular maintenance | Weekly |
| Major source changes | Immediately |

## 🤖 Automation (Optional)

### Set up automatic updates:

```bash
# Add to crontab (run weekly on Sunday 2am)
0 2 * * 0 cd /Users/ahab/pharma-search && python3 scripts/update_mappings.py

# Or use GitHub Actions (see REPLICABLE_GROUPING.md)
```

## 📚 Related Documentation

- **Full Details**: `REPLICABLE_GROUPING.md`
- **Solution Overview**: `COMPREHENSIVE_GROUPING_SOLUTION.md`
- **Implementation Guide**: `PRODUCT_GROUPING_SOLUTION.md`

## ✅ Checklist

After each scrape:

- [ ] New products added to products.csv
- [ ] Run `python3 scripts/update_mappings.py`
- [ ] Review git diff of mappings
- [ ] Test grouping works
- [ ] Check grouping quality metrics
- [ ] Commit and deploy

---

**Questions?** See troubleshooting section above or check full documentation.
