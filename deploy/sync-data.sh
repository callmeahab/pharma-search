#!/bin/bash

# Pharma Search Data Sync Script
# Syncs PostgreSQL data and rebuilds Meilisearch index
# Usage: ./sync-data.sh [--skip-schema] [--skip-meili]

set -e

# Configuration
SERVER="${1:-pharma}"
LOCAL_DB_URL="${DATABASE_URL:-postgres://postgres:docker@localhost:5432/pharmagician}"
REMOTE_DB="pharma_search"
REMOTE_DB_USER="root"
REMOTE_DB_PASS="pharma_secure_password_2025"
REMOTE_DB_URL="postgresql://${REMOTE_DB_USER}:${REMOTE_DB_PASS}@localhost:5432/${REMOTE_DB}"
APP_DIR="/var/www/pharma-search"
DUMP_FILE="/tmp/pharma_data_$(date +%Y%m%d_%H%M%S).sql"

# Parse options
SKIP_SCHEMA=false
SKIP_MEILI=false
for arg in "$@"; do
    case $arg in
        --skip-schema) SKIP_SCHEMA=true ;;
        --skip-meili) SKIP_MEILI=true ;;
        pharma|root@*) SERVER="$arg" ;;
    esac
done

echo "========================================"
echo "  Pharma Search Data Sync"
echo "========================================"
echo ""
echo "Server: $SERVER"
echo ""

# ============================================
# STEP 1: RECREATE SCHEMA FROM MIGRATIONS
# ============================================
if [[ "$SKIP_SCHEMA" == false ]]; then
    echo "[1/5] Recreating database schema on server..."

    ssh "$SERVER" << 'ENDSSH'
set -e
cd /var/www/pharma-search

# Drop all tables
echo "  Dropping existing tables..."
sudo -u postgres psql -d pharma_search -c "
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
" 2>/dev/null || true

# Apply migrations
echo "  Applying migrations..."
if [ -d "migrations" ]; then
    chmod -R 644 migrations/*.sql 2>/dev/null || true
    for migration in migrations/*.sql; do
        if [ -f "$migration" ]; then
            echo "    $(basename $migration)"
            sudo -u postgres psql -d pharma_search -f "$migration" 2>&1 | grep -v "NOTICE" | grep -v "^$" || true
        fi
    done
fi

# Grant permissions to app user
echo "  Granting permissions..."
sudo -u postgres psql -d pharma_search -c "
GRANT ALL ON ALL TABLES IN SCHEMA public TO root;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO root;
GRANT USAGE ON SCHEMA public TO root;
"

echo "  Schema ready"
ENDSSH

    echo "  Schema recreated from migrations"
else
    echo "[1/5] Skipping schema recreation (--skip-schema)"
fi

# ============================================
# STEP 2: DUMP LOCAL DATA
# ============================================
echo "[2/5] Dumping local database..."

# Dump with column inserts for compatibility
# Include Vendor to preserve IDs that match Product.vendorId
pg_dump "$LOCAL_DB_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --column-inserts \
    --table='"Vendor"' \
    --table='"Product"' \
    --table='"ProductGroup"' \
    --table='"ProductStandardization"' \
    -f "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
ROW_COUNT=$(grep -c "^INSERT" "$DUMP_FILE" || echo "0")
echo "  Dump created: $DUMP_FILE ($DUMP_SIZE, ~$ROW_COUNT rows)"

# ============================================
# STEP 3: UPLOAD DUMP
# ============================================
echo "[3/5] Uploading to server..."

scp -q "$DUMP_FILE" "$SERVER:/tmp/pharma_data.sql"
echo "  Upload complete"

# ============================================
# STEP 4: RESTORE DATA
# ============================================
echo "[4/5] Restoring data on server..."

ssh "$SERVER" << 'ENDSSH'
set -e

echo "  Disabling foreign key checks..."
sudo -u postgres psql -d pharma_search -c "SET session_replication_role = replica;"

echo "  Importing data (this may take a while)..."
sudo -u postgres psql -d pharma_search -f /tmp/pharma_data.sql 2>&1 | \
    grep -E "^(INSERT|ERROR)" | tail -10 || true

echo "  Re-enabling foreign key checks..."
sudo -u postgres psql -d pharma_search -c "SET session_replication_role = DEFAULT;"

# Show counts
echo ""
echo "  Table counts:"
sudo -u postgres psql -d pharma_search -t -c "
SELECT 'Vendor: ' || COUNT(*) FROM \"Vendor\"
UNION ALL
SELECT 'Product: ' || COUNT(*) FROM \"Product\"
UNION ALL
SELECT 'ProductGroup: ' || COUNT(*) FROM \"ProductGroup\"
UNION ALL
SELECT 'ProductStandardization: ' || COUNT(*) FROM \"ProductStandardization\";
"

# Cleanup
rm -f /tmp/pharma_data.sql
ENDSSH

# Local cleanup
rm -f "$DUMP_FILE"

echo "  Data restored"

# ============================================
# STEP 5: REBUILD MEILISEARCH INDEX
# ============================================
if [[ "$SKIP_MEILI" == false ]]; then
    echo "[5/5] Rebuilding Meilisearch index..."

    ssh "$SERVER" << ENDSSH
set -e
cd /var/www/pharma-search

# Check if backend binary exists
if [ -f "pharma-server" ]; then
    echo "  Running index rebuild..."
    DATABASE_URL="$REMOTE_DB_URL" ./pharma-server rebuild-index 2>&1 | grep -E "(Starting|complete|indexed|Error)" || true
else
    echo "  Warning: pharma-server not found, skipping index rebuild"
fi

# Check Meilisearch status
if curl -s http://127.0.0.1:7700/health | grep -q "available"; then
    STATS=\$(curl -s http://127.0.0.1:7700/indexes/products/stats 2>/dev/null || echo "{}")
    DOC_COUNT=\$(echo "\$STATS" | grep -o '"numberOfDocuments":[0-9]*' | grep -o '[0-9]*' || echo "0")
    echo "  Meilisearch products indexed: \$DOC_COUNT"
fi
ENDSSH

    echo "  Meilisearch index rebuilt"
else
    echo "[5/5] Skipping Meilisearch rebuild (--skip-meili)"
fi

# ============================================
# DONE
# ============================================
echo ""
echo "========================================"
echo "  Data Sync Complete!"
echo "========================================"
echo ""
echo "Options:"
echo "  --skip-schema  Skip dropping/recreating tables"
echo "  --skip-meili   Skip Meilisearch index rebuild"
