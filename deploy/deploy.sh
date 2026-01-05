#!/bin/bash

# Pharma Search Deployment Script
# Run from local machine to deploy code to server
# Usage: ./deploy.sh [user@server]

set -e

# Configuration
SERVER="${1:-pharma}"
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

# Create directory if it doesn't exist
ssh "$SERVER" "mkdir -p $APP_DIR"

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
    # Fix permissions so postgres user can read
    chmod -R 644 migrations/*.sql 2>/dev/null || true
    chmod -R 644 migrations/seed/*.sql 2>/dev/null || true

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

# Create ecosystem.config.js if it doesn't exist
if [ ! -f "ecosystem.config.js" ]; then
    cat << 'EOFPM2' > ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'pharma-frontend',
      cwd: '/var/www/pharma-search/frontend',
      script: '/root/.bun/bin/bun',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NODE_OPTIONS: '--max_old_space_size=384'
      },
      error_file: '/var/log/pharma-search/frontend/error.log',
      out_file: '/var/log/pharma-search/frontend/out.log',
      time: true,
      autorestart: true,
      max_memory_restart: '512M'
    },
    {
      name: 'pharma-backend',
      cwd: '/var/www/pharma-search',
      script: '/var/www/pharma-search/pharma-server',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        DATABASE_URL: 'postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search',
        MEILI_URL: 'http://127.0.0.1:7700',
        MEILI_API_KEY: ''
      },
      error_file: '/var/log/pharma-search/backend/error.log',
      out_file: '/var/log/pharma-search/backend/out.log',
      time: true,
      autorestart: true,
      max_memory_restart: '256M'
    }
  ]
};
EOFPM2
fi

# Create log directories
mkdir -p /var/log/pharma-search/frontend /var/log/pharma-search/backend

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
