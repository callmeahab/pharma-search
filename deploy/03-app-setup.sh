#!/bin/bash

# Application Setup Script
# Run as root

set -e

APP_DIR="/var/www/pharma-search"
LOG_DIR="/var/log/pharma-search"
ENV_FILE="$APP_DIR/.env"

echo "🚀 Setting up Pharma Search Application"

# Ensure we're in the right directory
cd "$APP_DIR"

# Load Meilisearch configuration
MEILI_CONFIG=""
if [ -f "$APP_DIR/.meilisearch-key" ]; then
    MEILI_CONFIG=$(cat "$APP_DIR/.meilisearch-key")
    MEILI_MASTER_KEY=$(echo "$MEILI_CONFIG" | grep MEILI_MASTER_KEY | cut -d'"' -f2)
    MEILI_HTTP_ADDR=$(echo "$MEILI_CONFIG" | grep MEILI_HTTP_ADDR | cut -d'"' -f2)
else
    echo "⚠️ Warning: Meilisearch key file not found. Using defaults."
    MEILI_MASTER_KEY=""
    MEILI_HTTP_ADDR="http://127.0.0.1:7700"
fi

# Create environment file
echo "🔧 Creating environment configuration..."
cat << EOF > "$ENV_FILE"
# Database Configuration
DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"

# Meilisearch Configuration
MEILI_MASTER_KEY="$MEILI_MASTER_KEY"
MEILI_HTTP_ADDR="$MEILI_HTTP_ADDR"

# Next.js Configuration
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"

# API Configuration (Go gRPC runs on :50051; HTTP endpoints not used)
API_BASE_URL=""
BACKEND_URL=""
NEXT_PUBLIC_API_URL=""

# Node Environment
NODE_ENV="production"

# Go Backend / Meilisearch
MEILI_URL="$MEILI_HTTP_ADDR"
MEILI_API_KEY="$MEILI_MASTER_KEY"

# Logging
LOG_LEVEL="info"
LOG_DIR="$LOG_DIR"

# SMTP Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="apostekafm@gmail.com"
SMTP_PASS="qloc tgzo oucr mrwh"

# Note: Scrapers run locally, not on server
EOF

# Set proper permissions for environment file
chmod 600 "$ENV_FILE"

# Create frontend .env file
echo "🔧 Creating frontend environment file..."
cat << EOF > "$APP_DIR/frontend/.env"
# Database Configuration
DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"

# Meilisearch Configuration
MEILI_MASTER_KEY="$MEILI_MASTER_KEY"
MEILI_HTTP_ADDR="$MEILI_HTTP_ADDR"

# Next.js Configuration
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"

# API Configuration  
API_BASE_URL="http://localhost:8080"
BACKEND_URL="http://localhost:8080"
NEXT_PUBLIC_API_URL=""

# Node Environment
NODE_ENV="production"

# SMTP Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="apostekafm@gmail.com"
SMTP_PASS="qloc tgzo oucr mrwh"
EOF

chmod 600 "$APP_DIR/frontend/.env"

# Setup Frontend
echo "🎨 Setting up Frontend (Next.js)..."
cd "$APP_DIR/frontend"

# Install dependencies with Bun
echo "📦 Installing frontend dependencies..."
export PATH="/root/.bun/bin:$PATH"
bun install

# Prisma not used in this version
echo "ℹ️ Database managed via direct SQL connections"

# Build the application with memory limits
echo "🏗️ Building Next.js application..."
export NODE_OPTIONS="--max_old_space_size=512"
bun run build

# Setup Backend
echo "🔨 Setting up Backend (Go gRPC)..."
cd "$APP_DIR/go-backend"

# Install Go if not installed
if ! command -v go &> /dev/null; then
    echo "📦 Installing Go..."
    cd /tmp
    wget https://go.dev/dl/go1.22.3.linux-amd64.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf go1.22.3.linux-amd64.tar.gz
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /root/.bashrc
    export PATH=$PATH:/usr/local/go/bin
    cd "$APP_DIR/go-backend"
fi

# Install Go dependencies and build
echo "📦 Installing Go dependencies..."
go mod download
echo "🏗️ Building Go backend..."
go build -o pharma-server

# Create log directories
echo "📝 Creating log directories..."
mkdir -p "$LOG_DIR/frontend"
mkdir -p "$LOG_DIR/backend" 
mkdir -p "$LOG_DIR/pm2"
mkdir -p "$LOG_DIR/meilisearch"

# Copy Meilisearch indexer script if it exists
if [ -f "$APP_DIR/meilisearch_indexer.py" ]; then
    echo "✅ Meilisearch indexer script found"
else
    echo "⚠️ Warning: meilisearch_indexer.py not found in app directory"
    echo "📋 Ensure you copy this file to enable search indexing"
fi

echo "✅ Application setup completed successfully!"
echo "🔄 Next steps:"
echo "  1. Import database schema if needed"
echo "  2. Configure Nginx with 04-nginx-setup.sh"
echo "  3. Setup PM2 services with 05-pm2-setup.sh"