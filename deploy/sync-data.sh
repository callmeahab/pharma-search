#!/bin/bash

# Pharma Search Data Sync Script
# Syncs PostgreSQL data to remote server
# Usage: ./sync-data.sh [--skip-schema]

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
for arg in "$@"; do
    case $arg in
        --skip-schema) SKIP_SCHEMA=true ;;
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
# STEP 1: RECREATE SCHEMA FROM LOCAL DB
# ============================================
if [[ "$SKIP_SCHEMA" == false ]]; then
    echo "[1/4] Recreating database schema on server from local DB..."

    # Dump local schema (not data)
    SCHEMA_FILE="/tmp/pharma_schema_$(date +%Y%m%d_%H%M%S).sql"
    pg_dump "$LOCAL_DB_URL" \
        --schema-only \
        --no-owner \
        --no-privileges \
        --table='"Vendor"' \
        --table='"Product"' \
        --table='"ProductStandardization"' \
        -f "$SCHEMA_FILE"

    # Strip PG17-specific settings
    sed -i.bak '/^SET transaction_timeout/d' "$SCHEMA_FILE"
    rm -f "${SCHEMA_FILE}.bak"

    echo "  Schema dumped from local DB"

    # Upload schema
    scp -q "$SCHEMA_FILE" "$SERVER:/tmp/pharma_schema.sql"
    rm -f "$SCHEMA_FILE"

    ssh "$SERVER" << 'ENDSSH'
set -e

# Drop all tables
echo "  Dropping existing tables..."
sudo -u postgres psql -d pharma_search -c "
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
" 2>/dev/null || true

# Re-create extensions (dropped with schema)
echo "  Re-creating extensions..."
sudo -u postgres psql -d pharma_search -c "
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
"

# Apply schema from local dump
echo "  Applying schema..."
sudo -u postgres psql -d pharma_search -f /tmp/pharma_schema.sql 2>&1 | grep -cE "^(CREATE|ALTER)" || true

# Apply functions and triggers from migrations (these aren't in table dumps)
cd /var/www/pharma-search
if [ -d "migrations" ]; then
    for migration in migrations/002_functions.sql migrations/004_triggers.sql; do
        if [ -f "$migration" ]; then
            echo "    Applying $(basename $migration)"
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

rm -f /tmp/pharma_schema.sql
echo "  Schema ready"
ENDSSH

    echo "  Schema recreated from local DB"
else
    echo "[1/4] Skipping schema recreation (--skip-schema)"
fi

# ============================================
# STEP 2: DUMP LOCAL DATA
# ============================================
echo "[2/4] Dumping local database..."

# Dump with COPY format (fast) and --disable-triggers (adds ALTER TABLE DISABLE/ENABLE TRIGGER)
# Include Vendor to preserve IDs that match Product.vendorId
pg_dump "$LOCAL_DB_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --disable-triggers \
    --table='"Vendor"' \
    --table='"Product"' \
    --table='"ProductStandardization"' \
    -f "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "  Dump created: $DUMP_FILE ($DUMP_SIZE)"

# ============================================
# STEP 3: UPLOAD DUMP
# ============================================
echo "[3/4] Uploading to server..."

scp -q "$DUMP_FILE" "$SERVER:/tmp/pharma_data.sql"
echo "  Upload complete"

# ============================================
# STEP 4: RESTORE DATA
# ============================================
echo "[4/4] Restoring data on server..."

ssh "$SERVER" << 'ENDSSH'
set -e

echo "  Importing data with triggers/FK disabled (this may take a while)..."
# Strip PG17-specific settings that older PG versions don't support
sed -i '/^SET transaction_timeout/d' /tmp/pharma_data.sql
# Pipe SET + dump + RESET into a single psql session
# COPY FROM stdin requires the data to come through stdin, not via \i
sudo -u postgres bash -c '(echo "SET session_replication_role = replica;" ; cat /tmp/pharma_data.sql ; echo "SET session_replication_role = DEFAULT;") | psql -d pharma_search 2>&1 | tail -20'
echo "  Import finished"

# Show counts
echo ""
echo "  Table counts:"
sudo -u postgres psql -d pharma_search -t -c "
SELECT 'Vendor: ' || COUNT(*) FROM \"Vendor\"
UNION ALL
SELECT 'Product: ' || COUNT(*) FROM \"Product\"
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
# DONE
# ============================================
echo ""
echo "========================================"
echo "  Data Sync Complete!"
echo "========================================"
echo ""
echo "Options:"
echo "  --skip-schema  Skip dropping/recreating tables"
