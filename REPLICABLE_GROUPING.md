# Replicable Product Grouping System

## Overview

This system **automatically learns** from your product data and updates itself when you add new sources. No manual maintenance required!

## 🔄 Automated Workflow

```
┌──────────────────┐
│ Scrape New Source│
│  (add products)  │
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│ Export products  │
│  to CSV file     │
└────────┬─────────┘
         │
         ↓
┌──────────────────────────────┐
│ Run Auto-Update Script       │
│ python3 scripts/             │
│   update_mappings.py         │
└────────┬─────────────────────┘
         │
         ↓
┌──────────────────────────────┐
│ Mappings Auto-Generated      │
│ - New brands discovered      │
│ - New forms added            │
│ - New units handled          │
└────────┬─────────────────────┘
         │
         ↓
┌──────────────────────────────┐
│ Test & Deploy                │
│ go run test_grouping.go      │
└──────────────────────────────┘
```

## 🚀 Quick Start

### After Scraping New Sources:

```bash
# 1. Export products to CSV (if not already done)
# Your scraper should already create products.csv

# 2. Run the auto-update script
python3 scripts/update_mappings.py

# 3. Test the updated mappings
cd go-backend
go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go

# 4. Review and commit
git diff comprehensive_mappings.go  # See what changed
git add comprehensive_mappings.go
git commit -m "Update mappings with new product data"
```

## 📁 File Structure

```
pharma-search/
├── products.csv                     # Your product data
├── scripts/
│   └── update_mappings.py          # Auto-update script ⭐
├── go-backend/
│   ├── comprehensive_mappings.go   # Auto-generated mappings
│   ├── enhanced_grouping.go        # Grouping engine
│   └── test_grouping.go            # Test suite
└── REPLICABLE_GROUPING.md         # This file
```

## 🔧 Auto-Update Script Features

### What It Does:

1. **Analyzes ALL Products** in products.csv
2. **Extracts Patterns**:
   - Brand names (automatically)
   - Dosage units (all variations)
   - Product forms (Serbian + English)
   - Active ingredients (from context)

3. **Generates Go Code**:
   - `BuildBrandMap()` - All discovered brands
   - `BuildDosageUnitMap()` - All unit variations
   - `BuildFormMap()` - All form variations
   - `BuildActiveIngredientMap()` - Ingredient aliases

4. **Maintains Quality**:
   - Only includes brands with 10+ products (configurable)
   - Only includes forms with 50+ occurrences
   - Preserves proper capitalization
   - Comments show product counts

### Usage Examples:

```bash
# Basic usage (default: products.csv)
python3 scripts/update_mappings.py

# Custom products file
python3 scripts/update_mappings.py --products-file data/new_products.csv

# Lower threshold for brand inclusion (include brands with 5+ products)
python3 scripts/update_mappings.py --min-brand-count 5

# Custom output location
python3 scripts/update_mappings.py --output backend/mappings.go

# Show help
python3 scripts/update_mappings.py --help
```

## 📊 What Gets Auto-Updated

### Example Output After Adding New Source:

```bash
$ python3 scripts/update_mappings.py

📊 Analyzing products from products.csv...
  Processed 10,000 products...
  Processed 20,000 products...
  ...
  Processed 180,000 products...
✅ Analyzed 182,456 products

📊 Mappings Generated:
  - 127 brands
  - 11 dosage units
  - 34 product forms
  - 25 active ingredients

✅ Generated go-backend/comprehensive_mappings.go

💡 Next steps:
  1. Review the generated mappings
  2. Test with: cd go-backend && go run test_grouping.go ...
  3. Commit the updated mappings
```

### What Changed:

```go
// BEFORE (156K products):
"eucerin": "Eucerin",  // 2,468 products

// AFTER (182K products - new source added):
"eucerin": "Eucerin",  // 3,124 products  ← Updated count
"novabrand": "NovaBrand",  // 856 products  ← NEW brand discovered!
```

## 🔄 CI/CD Integration

### Automate with GitHub Actions:

```yaml
# .github/workflows/update-mappings.yml
name: Update Product Mappings

on:
  # Run after product scraper completes
  workflow_run:
    workflows: ["Product Scraper"]
    types: [completed]

  # Or run on schedule
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday 2am

jobs:
  update-mappings:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Update mappings
        run: python3 scripts/update_mappings.py

      - name: Test mappings
        uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      - run: |
          cd go-backend
          go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go

      - name: Create PR if changed
        run: |
          if [[ `git status --porcelain` ]]; then
            git config user.name "Mapping Bot"
            git config user.email "bot@example.com"
            git checkout -b update-mappings-$(date +%Y%m%d)
            git add go-backend/comprehensive_mappings.go
            git commit -m "Auto-update mappings from latest product data"
            git push origin HEAD
            # Create PR (using gh CLI or API)
          fi
```

## 🎯 Adding New Product Sources

### Step-by-Step:

1. **Scrape New Source**
   ```bash
   python3 scrapers/new_vendor_scraper.py
   ```

2. **Append to products.csv**
   ```bash
   cat new_vendor_products.csv >> products.csv
   ```

3. **Auto-Update Mappings**
   ```bash
   python3 scripts/update_mappings.py
   ```

4. **Verify Changes**
   ```bash
   # See what's new
   git diff go-backend/comprehensive_mappings.go

   # Test
   cd go-backend
   go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go
   ```

5. **Deploy**
   ```bash
   git add go-backend/comprehensive_mappings.go
   git commit -m "Add mappings for NewVendor source"
   git push
   ```

## 📈 Monitoring Mapping Quality

### Check Coverage:

```python
# In your analytics dashboard
total_products = 182456
grouped_products = 145876
coverage = (grouped_products / total_products) * 100

print(f"Grouping coverage: {coverage:.1f}%")
# Target: 70-85% coverage
```

### Identify Gaps:

```sql
-- Products without groups
SELECT title, COUNT(*) as unmatched_count
FROM products
WHERE normalized_group_id IS NULL
GROUP BY title
ORDER BY unmatched_count DESC
LIMIT 100;
```

### Add Missing Patterns:

If you find new patterns not auto-detected:

```python
# Edit scripts/update_mappings.py
# Add to ingredient_groups in _build_ingredient_groups():

"new_ingredient": [
    "pattern1", "pattern2", "variation",
],
```

## 🔐 Version Control Best Practices

### Keep Track of Changes:

```bash
# Tag each mapping update
git tag -a mappings-v1.0 -m "Initial mappings from 156K products"
git tag -a mappings-v1.1 -m "Updated with NewVendor data (182K products)"

# View mapping history
git log --oneline go-backend/comprehensive_mappings.go

# Compare versions
git diff mappings-v1.0..mappings-v1.1 -- go-backend/comprehensive_mappings.go
```

## 🧪 Testing Strategy

### After Each Update:

1. **Unit Tests**
   ```bash
   go run test_grouping.go enhanced_grouping.go comprehensive_mappings.go
   ```

2. **Integration Test**
   ```bash
   # Test with real search queries
   curl "localhost:8080/api/search?q=vitamin+d+2000"
   # Verify grouping in response
   ```

3. **Coverage Check**
   ```sql
   SELECT
     COUNT(DISTINCT enhanced_group_key) as total_groups,
     COUNT(*) as total_products,
     AVG(products_per_group) as avg_group_size
   FROM (
     SELECT enhanced_group_key, COUNT(*) as products_per_group
     FROM products
     GROUP BY enhanced_group_key
   );
   ```

## 🆘 Troubleshooting

### Problem: Script fails to find patterns

**Solution:** Lower the min-brand-count threshold
```bash
python3 scripts/update_mappings.py --min-brand-count 5
```

### Problem: Too many noise brands included

**Solution:** Raise the threshold
```bash
python3 scripts/update_mappings.py --min-brand-count 20
```

### Problem: New language variations not detected

**Solution:** Add patterns to the script's form_pattern regex:
```python
# In update_mappings.py, add to form_pattern:
self.form_pattern = re.compile(
    r'\b(...|new_pattern|another_variation)\w*\b',
    re.IGNORECASE
)
```

## 📝 Maintenance Schedule

### Recommended:

- **After each scrape:** Run auto-update (automated in CI/CD)
- **Weekly:** Review new mappings in PR
- **Monthly:** Analyze grouping quality metrics
- **Quarterly:** Audit and refine ingredient groups manually

## 🎓 Advanced: Custom Mappings

### Override Auto-Generated Mappings:

Create a manual overrides file:

```go
// go-backend/mapping_overrides.go
package main

func GetManualOverrides() map[string]string {
    return map[string]string{
        // Manual corrections for edge cases
        "specialbrand": "SpecialBrand",  // Override capitalization
        "alias1": "canonical_brand",      // Map alias to canonical
    }
}
```

Then merge in enhanced_grouping.go:

```go
func NewEnhancedGroupingEngine() *EnhancedGroupingEngine {
    brands := BuildBrandMap()

    // Apply manual overrides
    for alias, canonical := range GetManualOverrides() {
        brands[alias] = canonical
    }

    return &EnhancedGroupingEngine{
        brandAliases: brands,
        // ...
    }
}
```

---

## ✅ Summary

This system is now **fully replicable** and **self-maintaining**:

1. ✅ Scrape new sources → products.csv
2. ✅ Run `update_mappings.py` → auto-generates mappings
3. ✅ Test → verify grouping works
4. ✅ Deploy → commit and push

No manual mapping maintenance required! The system learns from your data automatically.
