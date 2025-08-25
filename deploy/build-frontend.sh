#!/bin/bash

# Next.js Build Script with Memory Management
# Run this script to build the frontend with memory optimizations

set -e

APP_DIR="/var/www/pharma-search"
cd "$APP_DIR/frontend"

echo "🏗️ Building Next.js application with memory optimizations..."

# Stop other services temporarily to free memory
echo "⏸️  Temporarily stopping services to free memory..."
pm2 stop pharma-scrapers || true
pm2 stop pharma-fastapi || true

# Set memory limits
export NODE_OPTIONS="--max_old_space_size=512 --max_semi_space_size=128"
export PATH="/root/.bun/bin:$PATH"

# Clear any existing build
echo "🧹 Clearing previous build..."
rm -rf .next

# Build with timeout and error handling
echo "🏗️ Starting build process..."
timeout 300s bun run build || {
    echo "❌ Build failed or timed out. Trying with even lower memory..."
    export NODE_OPTIONS="--max_old_space_size=256 --max_semi_space_size=64"
    timeout 300s bun run build
}

echo "✅ Build completed successfully!"

# Restart services
echo "▶️  Restarting services..."
pm2 start pharma-fastapi || true
pm2 start pharma-scrapers || true

echo "🎉 Frontend build completed and services restarted!"