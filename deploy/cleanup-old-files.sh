#!/bin/bash

# Cleanup script to remove redundant files after our backend changes
# Run this after successful deployment

echo "🧹 Cleaning up redundant files..."

APP_DIR="/var/www/pharma-search"
cd "$APP_DIR"

# Remove old schema file (keeping it as backup but renaming)
if [ -f "schema_old.sql" ]; then
    echo "📁 Moving old schema file to backup..."
    mv schema_old.sql schema_backup_$(date +%Y%m%d).sql
    echo "✅ Old schema backed up as schema_backup_$(date +%Y%m%d).sql"
fi

# Apply schema updates
echo "🔧 Applying schema updates..."
if [ -f "deploy/update-schema.sql" ]; then
    PGPASSWORD="pharma_secure_password_2025" psql -h localhost -U root -d pharma_search -f deploy/update-schema.sql
    echo "✅ Schema updates applied"
else
    echo "⚠️ No schema updates file found"
fi

# Clean up any temporary files
echo "🗑️ Removing temporary files..."
find . -name "*.pyc" -delete 2>/dev/null || true
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true

# Check for unused node_modules or similar large directories
echo "📊 Checking for large unused directories..."
du -sh frontend/node_modules 2>/dev/null && echo "ℹ️ frontend/node_modules exists (normal for frontend)"

echo "✅ Cleanup completed!"
echo ""
echo "📋 What was cleaned up:"
echo "  • Moved old schema file to backup"
echo "  • Applied schema updates for new search implementation" 
echo "  • Removed Python cache files"
echo "  • Removed system temporary files"
echo ""
echo "💡 The application now uses:"
echo "  • Direct SQL queries instead of custom PostgreSQL functions"
echo "  • Preprocessed product data for better search performance"
echo "  • Actual product titles instead of normalized names in UI"