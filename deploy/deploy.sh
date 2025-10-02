#!/bin/bash

# Complete Deployment Script for Pharma Search Application
# Run this script as root on a fresh Ubuntu server

set -e

APP_DIR="/var/www/pharma-search"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Deploying Pharma Search Application"
echo "======================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Run setup scripts in order
SETUP_SCRIPTS=(
    "01-system-setup.sh:System Setup"
    "02-postgresql-setup.sh:PostgreSQL Setup"
    "02b-meilisearch-setup.sh:Meilisearch Setup"
    "02c-grpcweb-proxy-setup.sh:gRPC-Web Proxy Setup"
    "03-app-setup.sh:Application Setup"
    "04-nginx-setup.sh:Nginx Setup"
    "05-pm2-setup.sh:PM2 Setup"
)

for item in "${SETUP_SCRIPTS[@]}"; do
    script="${item%%:*}"
    name="${item#*:}"

    echo ""
    echo "📦 $name"
    echo "======================"

    if [ -f "$SCRIPT_DIR/$script" ]; then
        bash "$SCRIPT_DIR/$script"
    else
        echo "❌ $script not found"
        exit 1
    fi
done

# Optional: SSL Setup
echo ""
echo "🔐 SSL Certificate Setup"
echo "========================"
read -p "Set up SSL certificate for aposteka.rs? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    bash "$APP_DIR/deploy/06-ssl-setup.sh"
else
    echo "⏭️ Skipping SSL - run later: bash $APP_DIR/deploy/06-ssl-setup.sh"
fi

# Optional: Meilisearch Indexing
echo ""
echo "🔍 Meilisearch Indexing"
echo "======================="
read -p "Index product data now? (requires database with products) (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    if [ -f "$APP_DIR/deploy/07-meilisearch-index.sh" ]; then
        bash "$APP_DIR/deploy/07-meilisearch-index.sh"
    else
        echo "❌ Indexing script not found"
    fi
else
    echo "⏭️ Skipping indexing - run later: bash $APP_DIR/deploy/07-meilisearch-index.sh"
fi

# Service status check
echo ""
echo "🔍 Service Status"
echo "================="
sleep 3
echo "PostgreSQL: $(systemctl is-active postgresql)"
echo "Meilisearch: $(systemctl is-active meilisearch)"
echo "Nginx: $(systemctl is-active nginx)"
echo ""
pm2 status

echo ""
echo "🎉 DEPLOYMENT COMPLETED!"
echo "======================="
echo ""
echo "🌐 Application URL:"
echo "  http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP')"
echo ""
echo "🔧 Management:"
echo "  • Update: $APP_DIR/update.sh"
echo "  • Index: $APP_DIR/deploy/07-meilisearch-index.sh"
echo "  • Restart: bash $APP_DIR/deploy/restart-pm2.sh"
echo "  • PM2: pm2 status | pm2 logs"
echo ""
echo "📊 Next steps:"
echo "  1. Configure domain in nginx if needed"
echo "  2. Set up SSL (if skipped)"
echo "  3. Monitor logs and services"
