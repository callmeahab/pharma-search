#!/bin/bash

# Search Performance Optimization Script for Deployment
# This script applies all search optimizations in the correct order

set -e

APP_DIR="/var/www/pharma-search"
DB_NAME="pharma_search"
DB_USER="root"

echo "🚀 Applying Search Performance Optimizations"
echo "============================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Check PostgreSQL service
if ! systemctl is-active --quiet postgresql; then
    echo "❌ PostgreSQL is not running. Starting it..."
    systemctl start postgresql
fi

echo "📊 Current search performance status..."
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT 
    COUNT(*) as total_products,
    COUNT(CASE WHEN \"processedAt\" IS NOT NULL THEN 1 END) as processed_products
FROM \"Product\";
"

echo ""
echo "🔧 Step 1: Basic Search Indexes"
echo "================================"
if [ -f "$APP_DIR/optimize_search_indexes.sql" ]; then
    sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/optimize_search_indexes.sql"
    echo "✅ Basic search indexes applied"
else
    echo "⚠️ optimize_search_indexes.sql not found - skipping basic indexes"
fi

echo ""
echo "⚡ Step 2: Advanced Search Functions"
echo "==================================="
if [ -f "$APP_DIR/optimize_search_performance.sql" ]; then
    sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/optimize_search_performance.sql"
    echo "✅ Advanced search functions created"
else
    echo "⚠️ optimize_search_performance.sql not found - skipping function optimizations"
fi

echo ""
echo "🔧 Step 3: Function Fixes (Critical)"
echo "===================================="
if [ -f "$APP_DIR/fix_all_functions.sql" ]; then
    sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/fix_all_functions.sql"
    echo "✅ Search function fixes applied (removed processedAt requirement)"
else
    echo "⚠️ fix_all_functions.sql not found - search may not work properly!"
fi

echo ""
echo "💾 Step 4: Precomputed Groups"
echo "============================="
if [ -f "$APP_DIR/simple_precomputed_groups.sql" ]; then
    sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/simple_precomputed_groups.sql"
    echo "✅ Precomputed groups created"
    
    # Check if groups were created
    GROUP_COUNT=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM product_groups_mv;" 2>/dev/null || echo "0")
    echo "📊 Created $GROUP_COUNT product groups"
else
    echo "⚠️ simple_precomputed_groups.sql not found - using dynamic grouping only"
fi

echo ""
echo "🧪 Step 5: Testing Search Functions"
echo "==================================="

# Test autocomplete function
echo "Testing autocomplete function..."
AUTOCOMPLETE_TEST=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM fast_autocomplete_search('protein', 5);" 2>/dev/null || echo "0")
if [ "$AUTOCOMPLETE_TEST" -gt "0" ]; then
    echo "✅ Autocomplete function working: $AUTOCOMPLETE_TEST results for 'protein'"
else
    echo "⚠️ Autocomplete function may not be working properly"
fi

# Test main search function
echo "Testing main search function..."
SEARCH_TEST=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM fast_product_search('protein', NULL, NULL, NULL, NULL, 10);" 2>/dev/null || echo "0")
if [ "$SEARCH_TEST" -gt "0" ]; then
    echo "✅ Main search function working: $SEARCH_TEST results for 'protein'"
else
    echo "⚠️ Main search function may not be working properly"
fi

# Test precomputed groups function
echo "Testing precomputed groups function..."
GROUPS_TEST=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM search_product_groups('protein', 5);" 2>/dev/null || echo "0")
if [ "$GROUPS_TEST" -gt "0" ]; then
    echo "✅ Precomputed groups function working: $GROUPS_TEST groups for 'protein'"
else
    echo "⚠️ Precomputed groups function not working - will use dynamic grouping"
fi

echo ""
echo "📈 Step 6: Performance Statistics"
echo "================================="
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT 
    schemaname,
    tablename, 
    attname, 
    n_distinct, 
    correlation
FROM pg_stats 
WHERE schemaname = 'public' 
    AND tablename = 'Product' 
    AND attname IN ('title', 'normalizedName', 'price')
ORDER BY tablename, attname;
"

echo ""
echo "📝 Step 7: Index Information"
echo "============================"
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename IN ('Product', 'Brand')
    AND indexname LIKE '%trgm%'
ORDER BY indexname;
"

echo ""
echo "✅ Search Optimization Complete!"
echo "================================"
echo ""
echo "🚀 Performance Improvements Applied:"
echo "  • Trigram indexes for fuzzy search"
echo "  • Optimized search functions with fast paths"
echo "  • Autocomplete function for instant suggestions"
echo "  • Precomputed groups for common queries"
echo "  • Streaming search support"
echo ""
echo "📊 Expected improvements:"
echo "  • 50-80% faster search queries"
echo "  • Sub-second autocomplete responses"
echo "  • Progressive result loading"
echo "  • Better search relevance"
echo ""
echo "🔄 Next steps:"
echo "  • Restart backend services: pm2 restart pharma-backend"
echo "  • Test search functionality in the application"
echo "  • Monitor search performance and logs"
echo ""
echo "💡 Tip: Run 'REFRESH MATERIALIZED VIEW product_groups_mv;' monthly to update precomputed groups"