#!/bin/bash

# Apply Database Migrations Script
# Run after 02-postgresql-setup.sh

set -e

APP_DIR="/var/www/pharma-search"
MIGRATIONS_DIR="$APP_DIR/migrations"
DB_NAME="pharma_search"
DB_USER="root"

echo "📦 Applying Database Migrations"

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "❌ Migrations directory not found: $MIGRATIONS_DIR"
    exit 1
fi

# Apply migrations in order
echo "🔄 Applying migrations..."

for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        migration_name=$(basename "$migration")
        echo "  → Applying $migration_name..."
        sudo -u postgres psql -d "$DB_NAME" -f "$migration" 2>&1 | grep -v "NOTICE" || true
    fi
done

# Apply seed data
SEED_DIR="$MIGRATIONS_DIR/seed"
if [ -d "$SEED_DIR" ]; then
    echo "🌱 Applying seed data..."
    for seed in "$SEED_DIR"/*.sql; do
        if [ -f "$seed" ]; then
            seed_name=$(basename "$seed")
            echo "  → Seeding $seed_name..."
            sudo -u postgres psql -d "$DB_NAME" -f "$seed" 2>&1 | grep -v "NOTICE" || true
        fi
    done
fi

# Verify tables were created
echo "🧪 Verifying database schema..."
TABLE_COUNT=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "  → Found $TABLE_COUNT tables"

# List tables
echo "📋 Tables in database:"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"

# Count vendors
VENDOR_COUNT=$(sudo -u postgres psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM \"Vendor\";")
echo "  → Found $VENDOR_COUNT vendors seeded"

echo "✅ Migrations applied successfully!"
