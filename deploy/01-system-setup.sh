#!/bin/bash

# Ubuntu Server Deployment Script - System Setup
# Run as root or with sudo privileges

set -e  # Exit on any error

echo "🚀 Starting Ubuntu Server Setup for Pharma Search Application"

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install essential packages
echo "🔧 Installing essential packages..."
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    unzip \
    vim \
    htop \
    ufw

# Note: Scraper packages removed - scrapers run locally, not on server

# Install Node.js 20.x (LTS)
echo "📚 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Bun (used by the frontend)
echo "🥖 Installing Bun..."
curl -fsSL https://bun.sh/install | bash
# Add bun to PATH for all users
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> /etc/profile
source /etc/profile

# Install PM2 globally
echo "⚡ Installing PM2..."
npm install -g pm2

# Install Python 3.11 and pip
echo "🐍 Installing Python 3.11..."
add-apt-repository -y ppa:deadsnakes/ppa
apt update
apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# Create python3.11 symlink if needed
if ! command -v python3.11 &> /dev/null; then
    ln -sf /usr/bin/python3.11 /usr/local/bin/python3.11
fi

# Install Nginx
echo "🌐 Installing Nginx..."
apt install -y nginx

# Install PostgreSQL 15
echo "🐘 Installing PostgreSQL 15..."
sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update
apt install -y postgresql-15 postgresql-client-15 postgresql-contrib-15

# Configure firewall
echo "🔒 Configuring UFW firewall..."
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Create application directories
echo "📁 Creating application directories..."
mkdir -p /var/www/pharma-search
mkdir -p /var/log/pharma-search

echo "✅ System setup completed successfully!"
echo "📋 Installed packages: Node.js, Bun, Python, PostgreSQL, Nginx, PM2"
echo "📝 Note: Scraper packages (Chrome, Xvfb) not installed - scrapers run locally"
echo ""
echo "🔑 Next steps:"
echo "  1. Run 02-postgresql-setup.sh to configure PostgreSQL"
echo "  2. Copy your application files to /var/www/pharma-search"
echo "  3. Run 03-app-setup.sh to configure the application"