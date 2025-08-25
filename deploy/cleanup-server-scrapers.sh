#!/bin/bash

# Script to clean up server-side scraper processes and files
# Run this on the server to remove old scraper setup

set -e

APP_DIR="/var/www/pharma-search"
LOG_DIR="/var/log/pharma-search"

echo "🧹 Cleaning up server-side scraper processes and files..."

# Stop and delete the pharma-scrapers PM2 process if it exists
echo "🛑 Stopping pharma-scrapers PM2 process..."
if pm2 list | grep -q "pharma-scrapers"; then
    pm2 stop pharma-scrapers 2>/dev/null || true
    pm2 delete pharma-scrapers 2>/dev/null || true
    echo "✅ pharma-scrapers PM2 process removed"
else
    echo "ℹ️ pharma-scrapers PM2 process not found"
fi

# Remove scraper worker script if it exists
echo "🗑️ Removing scraper worker script..."
if [ -f "$APP_DIR/frontend/scripts/run-scrapers-worker.ts" ]; then
    rm -f "$APP_DIR/frontend/scripts/run-scrapers-worker.ts"
    echo "✅ Scraper worker script removed"
else
    echo "ℹ️ Scraper worker script not found"
fi

# Remove scraper logs directory if it exists
echo "🗑️ Removing scraper logs directory..."
if [ -d "$LOG_DIR/scrapers" ]; then
    rm -rf "$LOG_DIR/scrapers"
    echo "✅ Scraper logs directory removed"
else
    echo "ℹ️ Scraper logs directory not found"
fi

# Stop and disable Xvfb service if it exists
echo "🖼️ Cleaning up Xvfb service..."
if systemctl is-active --quiet xvfb 2>/dev/null; then
    systemctl stop xvfb
    echo "✅ Xvfb service stopped"
fi

if systemctl is-enabled --quiet xvfb 2>/dev/null; then
    systemctl disable xvfb
    echo "✅ Xvfb service disabled"
fi

if [ -f "/etc/systemd/system/xvfb.service" ]; then
    rm -f "/etc/systemd/system/xvfb.service"
    systemctl daemon-reload
    echo "✅ Xvfb service file removed"
else
    echo "ℹ️ Xvfb service file not found"
fi

# Save PM2 configuration (without scrapers)
echo "💾 Saving updated PM2 configuration..."
pm2 save

echo ""
echo "🎉 Server cleanup completed!"
echo ""
echo "📋 Summary:"
echo "  ✅ Removed pharma-scrapers PM2 process"
echo "  ✅ Removed scraper worker script"
echo "  ✅ Removed scraper logs directory"
echo "  ✅ Cleaned up Xvfb service"
echo "  ✅ Updated PM2 configuration"
echo ""
echo "📊 Current PM2 processes:"
pm2 status
echo ""
echo "ℹ️ Scrapers now run locally and data is uploaded via SQL"