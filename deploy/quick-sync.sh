#!/bin/bash

# Quick Sync Script - Updates only changed files
# Use this for quick updates after the initial deployment

set -e

# Configuration - UPDATE THESE VALUES  
SERVER_IP="138.197.180.107"
SERVER_USER="root"  # Use root user for updates
SERVER_PORT="22"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="/var/www/pharma-search"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

# Quick update - only sync changed files and restart services
quick_update() {
    print_status "🔄 Quick update - syncing only changed files..."
    
    # Create minimal exclude list
    cat << EOF > /tmp/quick-exclude
node_modules/
.next/
build/
*.log
.env*
.DS_Store
backend/venv/
backend/__pycache__/
backend/cache/
frontend/node_modules/
frontend/.next/
.git/
scrapers_logs/
EOF
    
    # Sync only changed files
    rsync -avz \
        --progress \
        --update \
        --exclude-from=/tmp/quick-exclude \
        -e "ssh -p $SERVER_PORT" \
        "$LOCAL_DIR/" \
        "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"
    
    rm -f /tmp/quick-exclude
    
    print_success "Files synced"
}

# Update specific components
update_frontend() {
    print_status "🎨 Updating frontend..."
    
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
        cd /var/www/pharma-search/frontend
        export PATH="/root/.bun/bin:$PATH"
        
        echo "📦 Installing dependencies..."
        bun install
        
        echo "🔨 Generating Prisma client..."
        bunx prisma generate
        
        echo "🏗️ Building application..."
        bun run build
        
        echo "🔄 Restarting frontend..."
        pm2 restart pharma-nextjs
EOF
    
    print_success "Frontend updated"
}

update_backend() {
    print_status "🐍 Updating backend..."
    
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
        cd /var/www/pharma-search/backend
        source venv/bin/activate
        
        echo "📦 Installing dependencies..."
        pip install -r requirements.txt
        
        echo "🔄 Restarting backend..."
        pm2 restart pharma-fastapi
EOF
    
    print_success "Backend updated"
}

update_scrapers() {
    print_status "🕷️ Updating scrapers..."
    
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
        echo "🔄 Restarting scrapers..."
        pm2 restart pharma-scrapers
EOF
    
    print_success "Scrapers updated"
}

# Check what changed
check_changes() {
    print_status "📋 Checking for changes..."
    
    # Check if specific directories have changes
    FRONTEND_CHANGED=false
    BACKEND_CHANGED=false
    SCRAPERS_CHANGED=false
    
    if git diff --quiet HEAD~1 HEAD -- frontend/ 2>/dev/null; then
        echo "Frontend: No changes"
    else
        echo "Frontend: Changes detected"
        FRONTEND_CHANGED=true
    fi
    
    if git diff --quiet HEAD~1 HEAD -- backend/ 2>/dev/null; then
        echo "Backend: No changes"
    else
        echo "Backend: Changes detected"
        BACKEND_CHANGED=true
    fi
    
    if git diff --quiet HEAD~1 HEAD -- frontend/scrapers/ 2>/dev/null; then
        echo "Scrapers: No changes"
    else
        echo "Scrapers: Changes detected"
        SCRAPERS_CHANGED=true
    fi
}

# Main function
main() {
    if [[ "$SERVER_IP" == "YOUR_SERVER_IP" ]]; then
        echo "❌ Please update SERVER_IP in this script!"
        exit 1
    fi
    
    echo "🚀 Quick Sync - Pharma Search"
    echo "============================"
    
    quick_update
    
    # Ask what to update
    echo ""
    print_warning "What would you like to update?"
    echo "1) Frontend only"
    echo "2) Backend only" 
    echo "3) Scrapers only"
    echo "4) Everything"
    echo "5) Just restart services"
    echo "6) Run database migrations"
    echo "q) Quit"
    
    read -p "Choose (1-6,q): " -n 1 -r
    echo
    
    case $REPLY in
        1) update_frontend ;;
        2) update_backend ;;
        3) update_scrapers ;;
        4) 
            update_frontend
            update_backend
            update_scrapers
            ;;
        5)
            ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" "pm2 restart all"
            print_success "All services restarted"
            ;;
        6)
            ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
                cd /var/www/pharma-search/frontend
                export PATH="/root/.bun/bin:$PATH"
                export DATABASE_URL="postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"
                echo "🗄️ Running migrations..."
                bunx prisma migrate deploy
                echo "🔄 Restarting services..."
                pm2 restart pharma-nextjs
EOF
            print_success "Migrations completed"
            ;;
        q) 
            print_warning "Cancelled"
            exit 0
            ;;
        *)
            echo "Invalid option"
            exit 1
            ;;
    esac
    
    # Show status
    echo ""
    print_status "📊 Current status:"
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" "pm2 status"
    
    print_success "Quick update completed!"
}

# Handle arguments
case "${1:-}" in
    --frontend) quick_update; update_frontend ;;
    --backend) quick_update; update_backend ;;
    --scrapers) quick_update; update_scrapers ;;
    --all) quick_update; update_frontend; update_backend; update_scrapers ;;
    --sync-only) quick_update ;;
    --help)
        echo "Quick Sync Usage:"
        echo "  $0                Run interactive update"
        echo "  $0 --frontend     Update frontend only"
        echo "  $0 --backend      Update backend only"
        echo "  $0 --scrapers     Update scrapers only"
        echo "  $0 --all          Update everything"
        echo "  $0 --sync-only    Only sync files"
        ;;
    *) main ;;
esac