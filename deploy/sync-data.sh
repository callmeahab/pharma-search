#!/bin/bash

# Pharma Search Data Sync Script
# Syncs PostgreSQL and Meilisearch data from local to server
# Usage: ./sync-data.sh [user@server] [--pg-only|--meili-only]

set -e

# Configuration
SERVER="${1:-root@aposteka.rs}"
LOCAL_DB_URL="${DATABASE_URL:-postgres://postgres:docker@localhost:5432/pharmagician}"
REMOTE_DB="pharma_search"
REMOTE_DB_USER="root"
DUMP_FILE="/tmp/pharma_dump_$(date +%Y%m%d_%H%M%S).sql"

# Parse options
PG_ONLY=false
MEILI_ONLY=false
for arg in "$@"; do
    case $arg in
        --pg-only) PG_ONLY=true ;;
        --meili-only) MEILI_ONLY=true ;;
    esac
done

echo "========================================"
echo "  Pharma Search Data Sync"
echo "========================================"
echo ""
echo "Server: $SERVER"
echo ""

# Check if server is provided
if [[ "$1" == --* ]] || [[ -z "$1" ]]; then
    echo "Usage: ./sync-data.sh user@server [--pg-only|--meili-only]"
    echo ""
    echo "Options:"
    echo "  --pg-only     Only sync PostgreSQL data"
    echo "  --meili-only  Only rebuild Meilisearch index"
    echo ""
    echo "Examples:"
    echo "  ./sync-data.sh root@aposteka.rs"
    echo "  ./sync-data.sh root@aposteka.rs --pg-only"
    exit 1
fi

# ============================================
# POSTGRESQL SYNC
# ============================================
if [[ "$MEILI_ONLY" == false ]]; then
    echo "[1/3] Dumping local PostgreSQL database..."

    # Extract connection parts from DATABASE_URL
    # Format: postgres://user:pass@host:port/dbname
    LOCAL_HOST=$(echo "$LOCAL_DB_URL" | sed -E 's/.*@([^:]+):.*/\1/')
    LOCAL_PORT=$(echo "$LOCAL_DB_URL" | sed -E 's/.*:([0-9]+)\/.*/\1/')
    LOCAL_USER=$(echo "$LOCAL_DB_URL" | sed -E 's/.*\/\/([^:]+):.*/\1/')
    LOCAL_PASS=$(echo "$LOCAL_DB_URL" | sed -E 's/.*:([^@]+)@.*/\1/')
    LOCAL_DB=$(echo "$LOCAL_DB_URL" | sed -E 's/.*\/([^?]+).*/\1/')

    # Dump database (data only, excluding problematic tables if any)
    PGPASSWORD="$LOCAL_PASS" pg_dump \
        -h "$LOCAL_HOST" \
        -p "$LOCAL_PORT" \
        -U "$LOCAL_USER" \
        -d "$LOCAL_DB" \
        --data-only \
        --disable-triggers \
        --no-owner \
        --no-privileges \
        -f "$DUMP_FILE"

    DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    echo "  Dump created: $DUMP_FILE ($DUMP_SIZE)"

    echo "[2/3] Uploading and restoring on server..."

    # Compress and upload
    gzip -f "$DUMP_FILE"
    scp "${DUMP_FILE}.gz" "$SERVER:/tmp/"

    # Restore on server
    ssh "$SERVER" << ENDSSH
set -e

# Stop PM2 to prevent connections during restore
pm2 stop all 2>/dev/null || true

# Decompress
gunzip -f "${DUMP_FILE}.gz"

# Clear existing data and restore
echo "  Truncating tables..."
sudo -u postgres psql -d $REMOTE_DB -c "
DO \\\$\\\$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE \"' || r.tablename || '\" CASCADE';
    END LOOP;
END\\\$\\\$;
"

echo "  Restoring data..."
sudo -u postgres psql -d $REMOTE_DB -f "$DUMP_FILE" 2>&1 | grep -v "NOTICE" | head -20

# Cleanup
rm -f "$DUMP_FILE"

# Restart PM2
pm2 start all

echo "  Database restored"
ENDSSH

    # Cleanup local
    rm -f "${DUMP_FILE}.gz"

    echo "  PostgreSQL sync complete"
else
    echo "[1/3] Skipping PostgreSQL (--meili-only)"
    echo "[2/3] Skipping PostgreSQL (--meili-only)"
fi

# ============================================
# MEILISEARCH INDEX REBUILD
# ============================================
if [[ "$PG_ONLY" == false ]]; then
    echo "[3/3] Rebuilding Meilisearch index on server..."

    ssh "$SERVER" << 'ENDSSH'
set -e
cd /var/www/pharma-search

# Check if the Go binary exists and has rebuild command
if [ -f "pharma-server" ]; then
    echo "  Triggering index rebuild via backend..."
    # Use the backend's rebuild endpoint or command
    ./pharma-server rebuild-index 2>/dev/null || \
    curl -s http://127.0.0.1:50051/rebuild-index 2>/dev/null || \
    echo "  Note: Run rebuild manually if needed"
fi

# Check Meilisearch health
if curl -s http://127.0.0.1:7700/health | grep -q "available"; then
    echo "  Meilisearch is healthy"

    # Get index stats
    STATS=$(curl -s http://127.0.0.1:7700/indexes/products/stats 2>/dev/null || echo "{}")
    DOC_COUNT=$(echo "$STATS" | grep -o '"numberOfDocuments":[0-9]*' | grep -o '[0-9]*' || echo "0")
    echo "  Products indexed: $DOC_COUNT"
else
    echo "  Warning: Meilisearch not responding"
fi
ENDSSH

    echo "  Meilisearch rebuild triggered"
else
    echo "[3/3] Skipping Meilisearch (--pg-only)"
fi

# ============================================
# DONE
# ============================================
echo ""
echo "========================================"
echo "  Data Sync Complete!"
echo "========================================"
echo ""
echo "Verify on server:"
echo "  ssh $SERVER 'sudo -u postgres psql -d $REMOTE_DB -c \"SELECT COUNT(*) FROM \\\"Product\\\";\"'"
echo "  ssh $SERVER 'curl -s http://127.0.0.1:7700/indexes/products/stats'"
