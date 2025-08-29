#!/bin/bash

# PM2 Restart Script with Updated Configuration
# Run as root after making changes to fix issues

set -e

APP_DIR="/var/www/pharma-search"

echo "🔄 Restarting PM2 services with updated configuration..."

cd "$APP_DIR"

# Stop all PM2 processes
echo "⏸️  Stopping current PM2 processes..."
pm2 stop all || true
pm2 delete all || true

# Start services with updated ecosystem config
echo "▶️  Starting PM2 services with new configuration..."
pm2 start ecosystem.config.js

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

echo "📊 Current PM2 status:"
pm2 status

echo "✅ PM2 services restarted successfully!"
echo ""
echo "🔍 To monitor logs:"
echo "  pm2 logs              # All logs"
echo "  pm2 logs pharma-nextjs"
echo "  pm2 logs pharma-fastapi"
