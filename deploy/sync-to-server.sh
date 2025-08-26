#!/bin/bash

# Rsync Deployment Script for Pharma Search Application
# This script syncs the local codebase to the remote server

set -e

# Configuration - UPDATE THESE VALUES
SERVER_IP="138.197.180.107"              # e.g., "192.168.1.100" or "yourserver.com"
SERVER_USER="root"                      # User with deployment privileges
SERVER_PORT="22"                        # SSH port
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"  # Parent directory (pharma-search)
FINAL_DIR="/var/www/pharma-search"      # Final application directory

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if configuration is updated
check_config() {
    if [[ "$SERVER_IP" == "YOUR_SERVER_IP" ]]; then
        print_error "Please update the SERVER_IP in this script!"
        echo "Edit this file and set:"
        echo "  SERVER_IP=\"your.server.ip.address\""
        echo "  SERVER_USER=\"root\"  # or your server username"
        exit 1
    fi
}

# Check if we can connect to the server
check_connection() {
    print_status "Testing SSH connection to $SERVER_USER@$SERVER_IP:$SERVER_PORT..."
    
    if ssh -p "$SERVER_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$SERVER_USER@$SERVER_IP" "echo 'Connection successful'" &>/dev/null; then
        print_success "SSH connection successful"
    else
        print_error "Cannot connect to server. Please check:"
        echo "  • Server IP: $SERVER_IP"
        echo "  • Username: $SERVER_USER"
        echo "  • Port: $SERVER_PORT"
        echo "  • SSH key authentication is set up"
        exit 1
    fi
}

# Create exclusion list for rsync
create_exclude_list() {
    cat << EOF > /tmp/pharma-rsync-exclude
node_modules/
.next/
dist/
build/
*.log
.env
.env.local
.env.production
.DS_Store
Thumbs.db
*.tmp
*.temp
backend/venv/
backend/__pycache__/
backend/**/__pycache__/
backend/cache/
frontend/node_modules/
frontend/.next/
frontend/bun.lockb
.git/
.gitignore
*.sqlite
*.db
pharma_search.db
*.sql.backup
scrapers_logs/
.vscode/
.idea/
coverage/
.nyc_output/
.pytest_cache/
.coverage
EOF
}

# Sync files to server
sync_files() {
    print_status "Syncing files to server..."
    
    create_exclude_list
    
    # Create remote directory
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" "mkdir -p $FINAL_DIR"
    
    # Sync files with rsync
    rsync -avz \
        --progress \
        --delete \
        --exclude-from=/tmp/pharma-rsync-exclude \
        -e "ssh -p $SERVER_PORT" \
        "$LOCAL_DIR/" \
        "$SERVER_USER@$SERVER_IP:$FINAL_DIR/"
    
    # Clean up exclude list
    rm -f /tmp/pharma-rsync-exclude
    
    print_success "Files synced successfully"
}

# Make scripts executable on server
make_executable() {
    print_status "Setting script permissions on server..."
    
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << EOF
        chmod +x "$FINAL_DIR/deploy"/*.sh
        echo "✅ Scripts made executable"
EOF
    
    print_success "Permissions set"
}

# Run the deployment scripts
run_deployment() {
    print_status "Do you want to run the full deployment now? (y/N)"
    read -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Running full deployment..."
        
        ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
            set -e
            cd /var/www/pharma-search/deploy
            
            echo "🚀 Starting full deployment..."
            bash deploy.sh
EOF
        
        print_success "Full deployment completed!"
    else
        print_warning "Skipping deployment. Files are synced but not deployed."
        echo ""
        echo "To deploy manually, run on the server:"
        echo "  cd $FINAL_DIR/deploy"
        echo "  sudo bash deploy.sh"
    fi
}

# Show deployment status
show_status() {
    print_status "Checking application status..."
    
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP" << 'EOF'
        if [ -f "/var/www/pharma-search/monitor.sh" ]; then
            echo "📊 Application Status:"
            echo "====================="
            sudo -u pharma /var/www/pharma-search/monitor.sh 2>/dev/null || echo "Application not yet running"
        else
            echo "ℹ️  Application not yet deployed. Run deployment first."
        fi
EOF
}

# Main deployment function
main() {
    echo "🚀 Pharma Search Deployment Sync"
    echo "================================="
    echo ""
    echo "📋 Configuration:"
    echo "  Server: $SERVER_USER@$SERVER_IP:$SERVER_PORT"
    echo "  Local:  $LOCAL_DIR"
    echo "  Remote: $FINAL_DIR"
    echo ""
    
    check_config
    check_connection
    sync_files
    make_executable
    
    # Ask if they want to run full deployment
    run_deployment
    
    show_status
    
    echo ""
    print_success "Sync completed successfully!"
    echo ""
    echo "🔧 Remote management commands:"
    echo "  ssh $SERVER_USER@$SERVER_IP \"/var/www/pharma-search/monitor.sh\""
    echo "  ssh $SERVER_USER@$SERVER_IP \"/var/www/pharma-search/update.sh\""
    echo "  ssh $SERVER_USER@$SERVER_IP \"pm2 status\""
}

# Handle command line arguments
case "${1:-}" in
    --sync-only)
        check_config
        check_connection
        sync_files
        print_success "Files synced. No deployment run."
        ;;
    --status)
        check_config
        check_connection
        show_status
        ;;
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --sync-only    Only sync files, don't deploy"
        echo "  --status       Check remote application status"
        echo "  --help         Show this help message"
        echo ""
        echo "Configuration (edit this script):"
        echo "  SERVER_IP      IP address or hostname of target server"
        echo "  SERVER_USER    Username for SSH connection (usually 'root')"
        echo "  SERVER_PORT    SSH port (usually 22)"
        ;;
    *)
        main
        ;;
esac