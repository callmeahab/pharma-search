#!/bin/bash

# Search Performance Optimization Script
# Run this script to optimize search performance on existing deployments
# Run as root or with sudo privileges

set -e

APP_DIR="/var/www/pharma-search"
DB_NAME="pharma_search"
DB_USER="root"
DB_PASSWORD="pharma_secure_password_2025"

echo "⚡ Optimizing Search Performance for Pharma Search Application"
echo "============================================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Check if optimization file exists
if [ ! -f "$APP_DIR/optimize_search_indexes.sql" ]; then
    echo "❌ optimize_search_indexes.sql not found at $APP_DIR"
    echo "Please copy this file from your development directory and try again"
    exit 1
fi

# Check PostgreSQL service
if ! systemctl is-active --quiet postgresql; then
    echo "❌ PostgreSQL is not running. Starting it..."
    systemctl start postgresql
fi

echo "📊 Current database statistics..."
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
echo "🔍 Checking existing indexes on Product table..."
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename = 'Product'
ORDER BY indexname;
"

echo ""
echo "⚡ Applying search performance optimizations..."

# Apply the optimization file
if sudo -u postgres psql -d "$DB_NAME" -f "$APP_DIR/optimize_search_indexes.sql"; then
    echo "✅ Database optimizations applied successfully"
else
    echo "❌ Failed to apply optimizations"
    exit 1
fi

echo ""
echo "📊 Updated database statistics after optimization..."
sudo -u postgres psql -d "$DB_NAME" -c "ANALYZE \"Product\"; ANALYZE \"Brand\"; ANALYZE \"Vendor\";"

echo ""
echo "🔍 Verifying new indexes..."
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
echo "🧪 Testing search performance..."
sudo -u postgres psql -d "$DB_NAME" -c "
EXPLAIN ANALYZE 
SELECT COUNT(*) 
FROM \"Product\" p 
LEFT JOIN \"Brand\" b ON p.\"brandId\" = b.id 
WHERE 
    p.title ILIKE '%vitamin%' OR
    similarity(p.title, 'vitamin') > 0.3 OR
    b.name ILIKE '%vitamin%';
"

# Restart backend services to ensure they pick up any changes
echo ""
echo "🔄 Restarting backend services..."
if command -v pm2 >/dev/null 2>&1; then
    pm2 restart pharma-backend || echo "⚠️ PM2 restart failed - you may need to restart manually"
else
    echo "⚠️ PM2 not found - please restart your backend service manually"
fi

echo ""
echo "✅ Search optimization completed successfully!"
echo "============================================"
echo ""
echo "📊 Performance Improvements:"
echo "  • Added trigram indexes for fuzzy search on product titles and brands"
echo "  • Added composite indexes for price filtering"
echo "  • Created optimized search function for faster queries"
echo "  • Updated table statistics for better query planning"
echo ""
echo "🚀 Expected improvements:"
echo "  • 50-80% faster search response times"
echo "  • Better fuzzy search accuracy"
echo "  • Reduced database load"
echo ""
echo "📝 Next steps:"
echo "  • Monitor search performance in your application"
echo "  • Check PM2 logs: pm2 logs pharma-backend"
echo "  • Run search tests to verify improvements"
echo ""
echo "💡 Tip: Run this script again after major data updates to refresh statistics"