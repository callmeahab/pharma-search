#!/bin/bash

# SSH Key Setup Script for Server Deployment
# Sets up passwordless SSH authentication

set -e

SERVER_IP="${1:-138.197.180.107}"
SERVER_USER="${2:-root}"
SERVER_PORT="${3:-22}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

# Check parameters
if [[ "$SERVER_IP" == "YOUR_SERVER_IP" ]]; then
    echo "Usage: $0 SERVER_IP [USER] [PORT]"
    echo "Example: $0 192.168.1.100 root 22"
    exit 1
fi

echo "🔑 SSH Key Setup for Pharma Search Deployment"
echo "=============================================="
echo ""
echo "📋 Configuration:"
echo "  Server: $SERVER_USER@$SERVER_IP:$SERVER_PORT"
echo ""

# Check if SSH key exists
SSH_KEY_PATH="$HOME/.ssh/id_rsa"
SSH_PUB_PATH="$HOME/.ssh/id_rsa.pub"

if [ ! -f "$SSH_KEY_PATH" ]; then
    print_status "Generating SSH key pair..."
    ssh-keygen -t rsa -b 4096 -f "$SSH_KEY_PATH" -N "" -C "pharma-deployment-$(whoami)@$(hostname)"
    print_success "SSH key generated"
else
    print_success "SSH key already exists"
fi

# Copy public key to server
print_status "Copying public key to server..."
if ssh-copy-id -p "$SERVER_PORT" "$SERVER_USER@$SERVER_IP"; then
    print_success "Public key copied to server"
else
    print_error "Failed to copy public key"
    echo ""
    echo "Manual setup required:"
    echo "1. Copy this public key:"
    cat "$SSH_PUB_PATH"
    echo ""
    echo "2. On the server, run:"
    echo "   mkdir -p ~/.ssh"
    echo "   echo 'PASTE_PUBLIC_KEY_HERE' >> ~/.ssh/authorized_keys"
    echo "   chmod 700 ~/.ssh"
    echo "   chmod 600 ~/.ssh/authorized_keys"
    exit 1
fi

# Test connection
print_status "Testing SSH connection..."
if ssh -p "$SERVER_PORT" -o ConnectTimeout=10 "$SERVER_USER@$SERVER_IP" "echo 'SSH connection successful'"; then
    print_success "SSH connection working!"
else
    print_error "SSH connection failed"
    exit 1
fi

# Update sync scripts with server details
print_status "Updating deployment scripts with server details..."

# Update sync-to-server.sh
if [ -f "sync-to-server.sh" ]; then
    sed -i.backup "s/SERVER_IP=\"YOUR_SERVER_IP\"/SERVER_IP=\"$SERVER_IP\"/" sync-to-server.sh
    sed -i.backup "s/SERVER_USER=\"root\"/SERVER_USER=\"$SERVER_USER\"/" sync-to-server.sh
    sed -i.backup "s/SERVER_PORT=\"22\"/SERVER_PORT=\"$SERVER_PORT\"/" sync-to-server.sh
    print_success "Updated sync-to-server.sh"
fi

# Update quick-sync.sh
if [ -f "quick-sync.sh" ]; then
    sed -i.backup "s/SERVER_IP=\"YOUR_SERVER_IP\"/SERVER_IP=\"$SERVER_IP\"/" quick-sync.sh
    sed -i.backup "s/SERVER_PORT=\"22\"/SERVER_PORT=\"$SERVER_PORT\"/" quick-sync.sh
    print_success "Updated quick-sync.sh"
fi

echo ""
print_success "SSH setup completed successfully!"
echo ""
echo "🚀 Next steps:"
echo "  1. Run initial deployment: ./sync-to-server.sh"
echo "  2. For quick updates: ./quick-sync.sh"
echo ""
echo "🔧 Server connection:"
echo "  ssh -p $SERVER_PORT $SERVER_USER@$SERVER_IP"