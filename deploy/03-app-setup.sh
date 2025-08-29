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

# Create environment file
echo "🔧 Creating environment configuration..."
cat << EOF > "$ENV_FILE"
# Database Configuration
DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"

# Next.js Configuration
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"

# API Configuration  
API_BASE_URL="http://localhost:8000"
BACKEND_URL="http://localhost:8000"
NEXT_PUBLIC_API_URL=""

# Node Environment
NODE_ENV="production"

# Python Environment
PYTHONPATH="$APP_DIR/backend"

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

# Next.js Configuration
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"

# API Configuration  
API_BASE_URL="http://localhost:8000"
BACKEND_URL="http://localhost:8000"
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
echo "🐍 Setting up Backend (FastAPI)..."
cd "$APP_DIR/backend"

# Create Python virtual environment
echo "🌐 Creating Python virtual environment..."
python3.11 -m venv venv
source venv/bin/activate

# Install Python dependencies
echo "📦 Installing backend dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create log directories
echo "📝 Creating log directories..."
mkdir -p "$LOG_DIR/frontend"
mkdir -p "$LOG_DIR/backend" 
mkdir -p "$LOG_DIR/pm2"

echo "✅ Application setup completed successfully!"
echo "🔄 Next steps:"
echo "  1. Import database schema if needed"
echo "  2. Configure Nginx with 04-nginx-setup.sh"
echo "  3. Setup PM2 services with 05-pm2-setup.sh"