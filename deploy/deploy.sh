#!/bin/bash

# Complete Deployment Script for Pharma Search Application
# Run this script as root on a fresh Ubuntu server

set -e

APP_DIR="/var/www/pharma-search"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting Complete Deployment of Pharma Search Application"
echo "============================================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Step 1: System Setup
echo ""
echo "📦 Step 1: System Setup"
echo "======================"
if [ -f "$SCRIPT_DIR/01-system-setup.sh" ]; then
    bash "$SCRIPT_DIR/01-system-setup.sh"
else
    echo "❌ 01-system-setup.sh not found"
    exit 1
fi

# Step 2: PostgreSQL Setup
echo ""
echo "🐘 Step 2: PostgreSQL Setup" 
echo "==========================="
if [ -f "$SCRIPT_DIR/02-postgresql-setup.sh" ]; then
    bash "$SCRIPT_DIR/02-postgresql-setup.sh"
else
    echo "❌ 02-postgresql-setup.sh not found"
    exit 1
fi

# Step 2b: Meilisearch Setup
echo ""
echo "🔍 Step 2b: Meilisearch Setup"
echo "============================"
if [ -f "$SCRIPT_DIR/02b-meilisearch-setup.sh" ]; then
    bash "$SCRIPT_DIR/02b-meilisearch-setup.sh"
else
    echo "❌ 02b-meilisearch-setup.sh not found"
    exit 1
fi

# Step 2c: gRPC-Web Proxy Setup
echo ""
echo "🔁 Step 2c: gRPC-Web Proxy Setup"
echo "==============================="
if [ -f "$SCRIPT_DIR/02c-grpcweb-proxy-setup.sh" ]; then
    bash "$SCRIPT_DIR/02c-grpcweb-proxy-setup.sh"
else
    echo "❌ 02c-grpcweb-proxy-setup.sh not found"
    exit 1
fi

# Step 3: Verify Application Files
echo ""
echo "📂 Step 3: Verifying Application Files"
echo "======================================"
if [ ! -d "$APP_DIR/frontend" ] || [ ! -d "$APP_DIR/go-backend" ]; then
    echo "❌ Application files not found in $APP_DIR"
    echo "Please ensure you have copied your application files to:"
    echo "  - $APP_DIR/frontend/ (Next.js application)"
    echo "  - $APP_DIR/go-backend/ (Go gRPC application)"
    echo "  - $APP_DIR/deploy/ (deployment scripts)"
    exit 1
fi

echo "✅ Application files verified"

# Step 4: Application Setup
echo ""
echo "🎨 Step 4: Application Setup"
echo "==========================="
bash "$APP_DIR/deploy/03-app-setup.sh"

# Step 5: Database Setup
echo ""
echo "🗄️ Step 5: Database Setup"
echo "=========================="
echo "✅ Database setup completed in PostgreSQL script"
echo "ℹ️ Note: Import your database schema manually if needed"

# Step 6: Nginx Setup
echo ""
echo "🌐 Step 6: Nginx Setup"
echo "====================="
bash "$APP_DIR/deploy/04-nginx-setup.sh"

# Step 7: PM2 Setup
echo ""
echo "⚡ Step 7: PM2 Setup"
echo "==================="
bash "$APP_DIR/deploy/05-pm2-setup.sh"

# Step 8: SSL Setup (Optional)
echo ""
echo "🔐 Step 8: SSL Certificate Setup"
echo "==============================="
echo "This will set up SSL certificate for aposteka.rs using Let's Encrypt"
read -p "Do you want to set up SSL certificate now? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    bash "$APP_DIR/deploy/06-ssl-setup.sh"
else
    echo "⏭️ Skipping SSL setup - you can run it later with:"
    echo "   bash $APP_DIR/deploy/06-ssl-setup.sh"
fi

# Step 8: Meilisearch Indexing (Optional)
echo ""
echo "🔍 Step 8: Meilisearch Indexing"
echo "==============================="
echo "This will index your product data for search functionality."
echo "Note: Ensure your database contains product data before indexing."
read -p "Do you want to run Meilisearch indexing now? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    if [ -f "$APP_DIR/deploy/07-meilisearch-index.sh" ]; then
        bash "$APP_DIR/deploy/07-meilisearch-index.sh"
    else
        echo "❌ Indexing script not found"
        echo "📋 You can run indexing manually later with:"
        echo "   bash $APP_DIR/deploy/07-meilisearch-index.sh"
    fi
else
    echo "⏭️ Skipping indexing - you can run it later with:"
    echo "   bash $APP_DIR/deploy/07-meilisearch-index.sh"
fi

# Final checks
echo ""
echo "🔍 Step 9: Final Checks"
echo "======================"

echo "🧪 Checking service status..."
sleep 5

echo "PostgreSQL: $(systemctl is-active postgresql)"
echo "Meilisearch: $(systemctl is-active meilisearch)"
echo "Nginx: $(systemctl is-active nginx)"

echo ""
echo "📊 PM2 Status:"
pm2 status

# Create update script
echo ""
echo "📝 Creating update script..."
cat << 'EOF' > "$APP_DIR/update.sh"
#!/bin/bash
# Application Update Script
# Run as root

set -e

APP_DIR="/var/www/pharma-search"
cd "$APP_DIR"

echo "🔄 Updating Pharma Search Application"

# Update frontend
echo "🎨 Updating frontend..."
cd frontend
export PATH="/root/.bun/bin:$PATH"
bun install
# Prisma not needed - using direct SQL connections
bun run build

# Update backend  
echo "🦫 Updating backend (Go)..."
cd ../go-backend
go mod download
go build -o pharma-server main.go

# Database is managed separately
echo "ℹ️ Database schema managed separately from application"

# Check if Meilisearch needs re-indexing
echo "🔍 Checking if Meilisearch re-indexing is needed..."
read -p "Re-index Meilisearch after update? (Y/n): " -n 1 -r
echo
if [[ ! \$REPLY =~ ^[Nn]\$ ]]; then
    echo "🔄 Re-indexing Meilisearch..."
    bash "$APP_DIR/deploy/07-meilisearch-index.sh"
fi

# Restart services (zero-downtime reload)
echo "🔄 Restarting services..."
pm2 reload ecosystem.config.js

echo "✅ Update completed successfully!"
pm2 status
EOF

chmod +x "$APP_DIR/update.sh"

# Create backup script
echo "💾 Creating backup script..."
cat << 'EOF' > "$APP_DIR/backup.sh"
#!/bin/bash
# Database Backup Script

BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="pharma_search"

mkdir -p "$BACKUP_DIR"

echo "💾 Creating database backup..."
PGPASSWORD="pharma_secure_password_2025" pg_dump -h localhost -U root -d "$DB_NAME" > "$BACKUP_DIR/pharma_search_$DATE.sql"

# Keep only last 7 backups
ls -t "$BACKUP_DIR"/pharma_search_*.sql | tail -n +8 | xargs rm -f

echo "✅ Backup completed: $BACKUP_DIR/pharma_search_$DATE.sql"
EOF

chmod +x "$APP_DIR/backup.sh"

# Add backup to crontab
echo "⏰ Setting up automated backups..."
(crontab -l 2>/dev/null; echo "0 3 * * * $APP_DIR/backup.sh") | crontab -

echo ""
echo "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "====================================="
echo ""
echo "🌐 Your application should now be running at:"
echo "  • http://aposteka.rs (or https://aposteka.rs if SSL was set up)"
echo "  • http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP')"
echo ""
echo "📋 Important Information:"
echo "  • Application Directory: $APP_DIR"
echo "  • Database: pharma_search"
echo "  • Database User: root"
echo "  • Database Password: pharma_secure_password_2025"
echo "  • Meilisearch: http://127.0.0.1:7700 (internal only)"
echo "  • Meilisearch Config: /etc/meilisearch.toml"
echo ""
echo "🔧 Management Commands:"
echo "  • Monitor: $APP_DIR/monitor.sh"
echo "  • Update: $APP_DIR/update.sh"
echo "  • Backup: $APP_DIR/backup.sh"
echo "  • Index Products: $APP_DIR/deploy/07-meilisearch-index.sh"
echo "  • PM2 Status: pm2 status"
echo "  • View Logs: pm2 logs"
echo ""
echo "🔄 Next Steps:"
echo "  1. Update the domain name in nginx config if needed"
echo "  2. Set up SSL certificate (Let's Encrypt recommended)"
echo "  3. Configure firewall rules for your specific needs"
echo "  4. Monitor the application and check logs"
echo ""
echo "📞 Support:"
echo "  • Logs: /var/log/pharma-search/"
echo "  • Nginx Logs: /var/log/nginx/"
echo "  • PM2 Logs: pm2 logs"

# Show current status
echo ""
echo "📊 Current Status:"
"$APP_DIR/monitor.sh"