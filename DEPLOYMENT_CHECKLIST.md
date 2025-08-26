# Pharma Search Deployment Checklist

## Files Required for Optimal Search Performance

Before deploying, ensure these search optimization files are included:

### ✅ Required Files for Search Optimization
- [ ] `optimize_search_indexes.sql` - Database indexes and basic optimizations
- [ ] `optimize_search_performance.sql` - Advanced search functions  
- [ ] `fix_all_functions.sql` - Function fixes (removes processedAt requirement)
- [ ] `simple_precomputed_groups.sql` - Precomputed product groups
- [ ] `deploy/optimize-search.sh` - Standalone search optimization script
- [ ] Updated `backend/src/search_engine.py` - Optimized search queries
- [ ] Updated `backend/src/api.py` - Autocomplete and streaming endpoints
- [ ] Updated `frontend/components/SearchBar.tsx` - Improved autocomplete
- [ ] Updated `frontend/lib/api.ts` - Streaming search support
- [ ] `frontend/components/ui/spinner.tsx` - Missing UI component

### ✅ Deployment Scripts Updated
- [ ] `deploy/02-postgresql-setup.sh` - Now applies search optimizations automatically
- [ ] `deploy/deploy.sh` - Checks for optimization files
- [ ] `deploy/quick-sync.sh` - Includes search optimization option

## Deployment Process

### For New Deployments
1. Copy all files to server: `./deploy/sync-to-server.sh`
2. Run full deployment: `./deploy/deploy.sh`
   - This will automatically apply ALL search optimizations during PostgreSQL setup

### For Existing Deployments
1. Sync updated files: `./deploy/quick-sync.sh --sync-only`
2. Apply ALL search optimizations: `./deploy/quick-sync.sh` → **Option 8** (Recommended)
   - Or individual optimization: `./deploy/quick-sync.sh` → Option 7

### Manual Optimization (if needed)
```bash
# On the server - Apply ALL optimizations
cd /var/www/pharma-search
sudo bash deploy/apply-search-optimizations.sh

# Or apply individual files
sudo -u postgres psql -d pharma_search -f optimize_search_indexes.sql
sudo -u postgres psql -d pharma_search -f optimize_search_performance.sql
sudo -u postgres psql -d pharma_search -f fix_all_functions.sql
sudo -u postgres psql -d pharma_search -f simple_precomputed_groups.sql

# Restart backend
pm2 restart pharma-backend
```

## Verification

After deployment, verify optimizations are working:

```bash
# Check indexes were created
sudo -u postgres psql -d pharma_search -c "
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'Product' 
AND indexname LIKE '%trgm%';
"

# Test search function exists
sudo -u postgres psql -d pharma_search -c "
SELECT proname 
FROM pg_proc 
WHERE proname = 'fast_product_search';
"

# Test search performance
sudo -u postgres psql -d pharma_search -c "
EXPLAIN ANALYZE 
SELECT * FROM fast_product_search('vitamin', NULL, NULL, NULL, NULL, 10);
"
```

## Expected Performance Improvements

- ⚡ **50-80% faster search queries** due to trigram indexes
- 🎯 **Better fuzzy search accuracy** with optimized similarity matching
- 📱 **Improved autocomplete response** with smarter debouncing
- 💾 **Reduced database load** through result caching
- 🔍 **Faster prefix matching** with composite indexes

## Troubleshooting

### If search is still slow:
1. Check if indexes were created: `\d "Product"` in psql
2. Verify pg_trgm extension: `SELECT * FROM pg_extension WHERE extname = 'pg_trgm';`
3. Update table statistics: `ANALYZE "Product"; ANALYZE "Brand";`
4. Check PM2 logs: `pm2 logs pharma-backend`

### If deployment fails:
1. Ensure all files are synced to `/var/www/pharma-search/`
2. Check PostgreSQL is running: `systemctl status postgresql`
3. Verify database connection: `psql -h localhost -U root -d pharma_search`
4. Check script permissions: `ls -la /var/www/pharma-search/deploy/`

## File Locations

- **Local Development**: `./optimize_search_indexes.sql`
- **Server**: `/var/www/pharma-search/optimize_search_indexes.sql`
- **Optimization Script**: `/var/www/pharma-search/deploy/optimize-search.sh`
- **Logs**: `/var/log/pharma-search/backend/`

## Support

If you encounter issues:
1. Check the deployment logs
2. Verify all files are present on the server
3. Test the optimization script manually
4. Review PM2 service status and logs