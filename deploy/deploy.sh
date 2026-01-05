#!/bin/bash

# Pharma Search Deployment Script
# Run from local machine to deploy code to server
# Usage: ./deploy.sh [user@server]

set -e

# Configuration
SERVER="${1:-root@aposteka.rs}"
APP_DIR="/var/www/pharma-search"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "========================================"
echo "  Pharma Search Deployment"
echo "========================================"
echo ""
echo "Server: $SERVER"
echo "Local:  $LOCAL_DIR"
echo ""

# Check if server is provided
if [[ -z "$1" ]]; then
    echo "Usage: ./deploy.sh user@server"
    echo "Example: ./deploy.sh root@aposteka.rs"
    exit 1
fi

# ============================================
# SYNC CODE
# ============================================
echo "[1/4] Syncing code to server..."

rsync -avz --delete \
    --exclude '.git' \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'ml' \
    --exclude 'scrapers' \
    --exclude 'scrapers_logs' \
    --exclude '.devcontainer' \
    --exclude '.claude' \
    --exclude '*.log' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'pharma-search' \
    --exclude 'pharma-server' \
    --exclude 'frontend/.env' \
    "$LOCAL_DIR/" "$SERVER:$APP_DIR/"

echo "  Code synced"

# ============================================
# BUILD ON SERVER
# ============================================
echo "[2/4] Building applications on server..."

ssh "$SERVER" << 'ENDSSH'
set -e
cd /var/www/pharma-search

# Create .env files if they don't exist
if [ ! -f .env ]; then
    cat << EOF > .env
DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"
MEILI_URL="http://127.0.0.1:7700"
MEILI_API_KEY=""
NODE_ENV="production"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
EOF
fi

if [ ! -f frontend/.env ]; then
    cat << EOF > frontend/.env
DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"
NODE_ENV="production"
EOF
fi

# Build frontend
echo "  Building frontend..."
cd frontend
export PATH="/root/.bun/bin:$PATH"
bun install --frozen-lockfile 2>/dev/null || bun install
NODE_OPTIONS="--max_old_space_size=512" bun run build

# Build backend
echo "  Building backend..."
cd ..
export PATH=$PATH:/usr/local/go/bin
go mod download
go build -o pharma-server

echo "  Build complete"
ENDSSH

echo "  Applications built"

# ============================================
# APPLY MIGRATIONS
# ============================================
echo "[3/4] Applying database migrations..."

ssh "$SERVER" << 'ENDSSH'
set -e
cd /var/www/pharma-search

if [ -d "migrations" ]; then
    for migration in migrations/*.sql; do
        if [ -f "$migration" ]; then
            echo "  Applying $(basename $migration)..."
            sudo -u postgres psql -d pharma_search -f "$migration" 2>&1 | grep -v "NOTICE" || true
        fi
    done

    # Seed data
    if [ -d "migrations/seed" ]; then
        for seed in migrations/seed/*.sql; do
            if [ -f "$seed" ]; then
                echo "  Seeding $(basename $seed)..."
                sudo -u postgres psql -d pharma_search -f "$seed" 2>&1 | grep -v "NOTICE" || true
            fi
        done
    fi
fi
ENDSSH

echo "  Migrations applied"

# ============================================
# RESTART PM2
# ============================================
echo "[4/4] Restarting PM2 services..."

ssh "$SERVER" << 'ENDSSH'
set -e
cd /var/www/pharma-search

# Check if PM2 processes exist
if pm2 list | grep -q "pharma"; then
    pm2 restart all
else
    pm2 start ecosystem.config.js
    pm2 save
fi

pm2 status
ENDSSH

echo "  PM2 restarted"

# ============================================
# DONE
# ============================================
echo ""
echo "========================================"
echo "  Deployment Complete!"
echo "========================================"
echo ""
echo "Check status: ssh $SERVER 'pm2 status'"
echo "View logs:    ssh $SERVER 'pm2 logs'"
