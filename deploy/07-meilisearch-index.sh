#!/bin/bash

# Meilisearch Product Indexing Script
# Run this script after database is populated with product data

set -e

APP_DIR="/var/www/pharma-search"
LOG_DIR="/var/log/pharma-search"

echo "🔍 Starting Meilisearch Product Indexing"
echo "======================================="

# Ensure we're in the right directory
cd "$APP_DIR"

# Check if Meilisearch is running
if ! systemctl is-active --quiet meilisearch; then
    echo "❌ Meilisearch service is not running"
    echo "🔧 Starting Meilisearch service..."
    systemctl start meilisearch
    sleep 5
fi

# Check if Meilisearch responds
echo "🧪 Testing Meilisearch connection..."
if ! curl -s http://127.0.0.1:7700/health > /dev/null; then
    echo "❌ Meilisearch is not responding"
    echo "📝 Checking service logs..."
    journalctl -u meilisearch --no-pager -n 10
    exit 1
fi

echo "✅ Meilisearch is running and responding"

# Check database connection
echo "🗄️ Testing database connection..."
PGPASSWORD="pharma_secure_password_2025" psql -h localhost -U root -d pharma_search -c "SELECT COUNT(*) as product_count FROM \"Product\";" > /tmp/db_test.log 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Cannot connect to database"
    cat /tmp/db_test.log
    exit 1
fi

PRODUCT_COUNT=$(PGPASSWORD="pharma_secure_password_2025" psql -h localhost -U root -d pharma_search -t -c "SELECT COUNT(*) FROM \"Product\";" | xargs)
echo "✅ Database connected. Found $PRODUCT_COUNT products to index."

if [ "$PRODUCT_COUNT" -eq 0 ]; then
    echo "⚠️ Warning: No products found in database. Ensure data is loaded first."
    echo "📋 To load data:"
    echo "  1. Run your local scrapers to collect product data"
    echo "  2. Import the data using your local data management scripts"
    echo "  3. Then run this indexing script again"
    exit 1
fi

# Set up Python environment and run indexing
echo "🐍 Setting up Python environment..."
if [ -d "$APP_DIR/backend/venv" ]; then
  cd "$APP_DIR/backend"
  source venv/bin/activate
else
  echo "⚠️  Python venv not found, using system python3"
fi

# Load environment variables
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | xargs)
fi

# Create indexing log directory
mkdir -p "$LOG_DIR/meilisearch"

echo "📊 Starting product indexing..."
echo "📝 Indexing logs will be saved to: $LOG_DIR/meilisearch/indexing.log"

# Run the indexing script with logging, pass DB URL from .env if present
DB_URL_FROM_ENV=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"')
if [ -n "$DB_URL_FROM_ENV" ]; then
  DATABASE_URL="$DB_URL_FROM_ENV" python3 "$APP_DIR/meilisearch_indexer.py" 2>&1 | tee "$LOG_DIR/meilisearch/indexing.log"
else
  python3 "$APP_DIR/meilisearch_indexer.py" 2>&1 | tee "$LOG_DIR/meilisearch/indexing.log"
fi

INDEXING_RESULT=$?

if [ $INDEXING_RESULT -eq 0 ]; then
    echo ""
    echo "🎉 Meilisearch indexing completed successfully!"
    
    # Test search functionality
    echo "🧪 Testing search functionality..."
    
    # Test basic search
    SEARCH_TEST=$(curl -s -X POST http://127.0.0.1:7700/indexes/products/search \
        -H 'Content-Type: application/json' \
        -d '{"q": "vitamin", "limit": 5}')
    
    HITS_COUNT=$(echo "$SEARCH_TEST" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('hits', [])))" 2>/dev/null || echo "0")
    
    if [ "$HITS_COUNT" -gt 0 ]; then
        echo "✅ Search test passed: Found $HITS_COUNT results for 'vitamin'"
        
        # Test API endpoint
        echo "🌐 Testing API search endpoint..."
        API_TEST=$(curl -s "http://localhost:8000/api/search?q=vitamin&limit=3" || echo "")
        
        if echo "$API_TEST" | grep -q "groups"; then
            echo "✅ API search endpoint working correctly"
        else
            echo "⚠️ API search endpoint may have issues, but indexing completed"
        fi
        
    else
        echo "⚠️ Search test returned no results, but indexing completed"
    fi
    
    # Show index statistics
    echo ""
    echo "📊 Index Statistics:"
    INDEX_STATS=$(curl -s http://127.0.0.1:7700/indexes/products/stats || echo "{}")
    echo "$INDEX_STATS" | python3 -c "import sys, json; stats=json.load(sys.stdin); print(f\"  • Documents: {stats.get('numberOfDocuments', 'N/A')}\"); print(f\"  • Index size: {stats.get('databaseSize', 'N/A')} bytes\")" 2>/dev/null || echo "  • Could not retrieve statistics"
    
else
    echo ""
    echo "❌ Meilisearch indexing failed!"
    echo "📝 Check the log file for details: $LOG_DIR/meilisearch/indexing.log"
    echo "🔧 Common issues:"
    echo "  • Insufficient memory (Meilisearch needs at least 1GB RAM)"
    echo "  • Database connection problems"
    echo "  • Missing product data in database"
    exit 1
fi

echo ""
echo "🔧 Indexing Management Commands:"
echo "  • Re-index: bash $APP_DIR/deploy/07-meilisearch-index.sh"
echo "  • Check Meilisearch status: systemctl status meilisearch"
echo "  • View Meilisearch logs: journalctl -u meilisearch -f"
echo "  • View indexing logs: cat $LOG_DIR/meilisearch/indexing.log"
echo ""
echo "📋 Next Steps:"
echo "  • Indexing should be re-run whenever product data is updated"
echo "  • Consider setting up automated re-indexing with cron if data changes frequently"
echo "  • Monitor search performance and adjust Meilisearch configuration if needed"