#!/bin/bash

# Pharma Search Server Setup Script
# Run once on a fresh Ubuntu server as root
# Usage: sudo ./setup.sh

set -e

APP_DIR="/var/www/pharma-search"
LOG_DIR="/var/log/pharma-search"
SERVER_IP="143.244.182.210"
DOMAIN="aposteka.rs"  # Update after DNS is configured

echo "========================================"
echo "  Pharma Search Server Setup"
echo "========================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# ============================================
# SYSTEM PACKAGES
# ============================================
echo "[1/7] Installing system packages..."

apt update && apt upgrade -y

apt install -y \
    curl wget git build-essential \
    software-properties-common apt-transport-https \
    ca-certificates gnupg lsb-release \
    unzip vim htop ufw

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> /etc/profile
export PATH="/root/.bun/bin:$PATH"

# PM2
npm install -g pm2

# Go 1.24
cd /tmp
wget -q https://go.dev/dl/go1.24.0.linux-amd64.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
export PATH=$PATH:/usr/local/go/bin
cd -

# Nginx
apt install -y nginx

echo "  System packages installed"

# ============================================
# POSTGRESQL
# ============================================
echo "[2/7] Setting up PostgreSQL..."

sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update
apt install -y postgresql-15 postgresql-client-15 postgresql-contrib-15

systemctl start postgresql
systemctl enable postgresql

# Create user and database
sudo -u postgres psql -c "CREATE USER root WITH PASSWORD 'pharma_secure_password_2025';" 2>/dev/null || \
sudo -u postgres psql -c "ALTER USER root WITH PASSWORD 'pharma_secure_password_2025';"

sudo -u postgres psql -c "CREATE DATABASE pharma_search OWNER root;" 2>/dev/null || \
sudo -u postgres psql -c "ALTER DATABASE pharma_search OWNER TO root;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pharma_search TO root;"
sudo -u postgres psql -c "ALTER USER root CREATEDB;"

# Extensions
sudo -u postgres psql -d pharma_search -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -d pharma_search -c "CREATE EXTENSION IF NOT EXISTS unaccent;"

# Performance tuning
PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | grep -oP 'PostgreSQL \K[0-9]+')
PG_CONFIG="/etc/postgresql/$PG_VERSION/main/postgresql.conf"

cat << EOF >> "$PG_CONFIG"

# Pharma Search Optimizations
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
work_mem = 4MB
max_connections = 100
EOF

systemctl restart postgresql
echo "  PostgreSQL configured"

# ============================================
# MEILISEARCH
# ============================================
echo "[3/7] Setting up Meilisearch..."

curl -L https://install.meilisearch.com | sh
install -m 0755 meilisearch /usr/local/bin/meilisearch

# Create user
if ! id -u meilisearch >/dev/null 2>&1; then
    useradd --system --home /var/lib/meilisearch --create-home --shell /bin/false meilisearch
fi
mkdir -p /var/lib/meilisearch/data /var/lib/meilisearch/dumps
chown -R meilisearch:meilisearch /var/lib/meilisearch

# Config
cat << EOF > /etc/meilisearch.toml
db_path = "/var/lib/meilisearch/data"
env = "development"
no_analytics = true
http_addr = "127.0.0.1:7700"
log_level = "INFO"
EOF
chown meilisearch:meilisearch /etc/meilisearch.toml
chmod 600 /etc/meilisearch.toml

# Systemd service
cat << EOF > /etc/systemd/system/meilisearch.service
[Unit]
Description=Meilisearch
After=systemd-user-sessions.service

[Service]
Type=simple
User=meilisearch
Group=meilisearch
ExecStart=/usr/local/bin/meilisearch --config-file-path /etc/meilisearch.toml
WorkingDirectory=/var/lib/meilisearch
Restart=on-failure
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable meilisearch
systemctl start meilisearch

echo "  Meilisearch configured"

# ============================================
# APPLICATION DIRECTORIES
# ============================================
echo "[4/7] Creating application directories..."

mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR/frontend" "$LOG_DIR/backend" "$LOG_DIR/pm2"

echo "  Directories created"

# ============================================
# NGINX
# ============================================
echo "[5/7] Configuring Nginx..."

rm -f /etc/nginx/sites-enabled/default

cat << 'EOF' > /etc/nginx/sites-available/pharma-search
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=general:10m rate=20r/s;

upstream nextjs_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream connect_backend {
    server 127.0.0.1:50051;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name 143.244.182.210 aposteka.rs www.aposteka.rs;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/json application/javascript;

    client_max_body_size 10M;

    access_log /var/log/nginx/aposteka.access.log;
    error_log /var/log/nginx/aposteka.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location /service.PharmaAPI/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://connect_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connect-Protocol-Version 1;

        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Connect-Protocol-Version" always;

        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin "*";
            add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
            add_header Access-Control-Allow-Headers "Content-Type, Connect-Protocol-Version";
            return 204;
        }

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location / {
        limit_req zone=general burst=50 nodelay;
        proxy_pass http://nextjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        proxy_pass http://nextjs_backend;
        proxy_set_header Host $host;
    }

    location /health {
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    location ~ /\. { deny all; }
    location ~ \.(env|log)$ { deny all; }
}
EOF

ln -sf /etc/nginx/sites-available/pharma-search /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
systemctl enable nginx

echo "  Nginx configured"

# ============================================
# FIREWALL
# ============================================
echo "[6/7] Configuring firewall..."

ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 7700  # Block external Meilisearch access
ufw --force enable

echo "  Firewall configured"

# ============================================
# PM2 ECOSYSTEM CONFIG
# ============================================
echo "[7/7] Creating PM2 configuration..."

cat << EOF > "$APP_DIR/ecosystem.config.js"
module.exports = {
  apps: [
    {
      name: 'pharma-frontend',
      cwd: '$APP_DIR/frontend',
      script: '/root/.bun/bin/bun',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NODE_OPTIONS: '--max_old_space_size=384'
      },
      error_file: '$LOG_DIR/frontend/error.log',
      out_file: '$LOG_DIR/frontend/out.log',
      time: true,
      autorestart: true,
      max_memory_restart: '512M'
    },
    {
      name: 'pharma-backend',
      cwd: '$APP_DIR',
      script: '$APP_DIR/pharma-server',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        DATABASE_URL: 'postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search',
        MEILI_URL: 'http://127.0.0.1:7700',
        MEILI_API_KEY: ''
      },
      error_file: '$LOG_DIR/backend/error.log',
      out_file: '$LOG_DIR/backend/out.log',
      time: true,
      autorestart: true,
      max_memory_restart: '256M'
    }
  ]
};
EOF

pm2 startup
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7

echo "  PM2 configured"

# ============================================
# DONE
# ============================================
echo ""
echo "========================================"
echo "  Server Setup Complete!"
echo "========================================"
echo ""
echo "Server: $SERVER_IP"
echo ""
echo "Next steps:"
echo "  1. Deploy code:     ./deploy.sh root@$SERVER_IP"
echo "  2. Sync data:       ./sync-data.sh root@$SERVER_IP"
echo "  3. Setup SSL:       certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
echo "Access:"
echo "  http://$SERVER_IP"
echo ""
echo "Services:"
echo "  PostgreSQL:   postgresql://root:***@localhost:5432/pharma_search"
echo "  Meilisearch:  http://127.0.0.1:7700"
echo "  Frontend:     http://localhost:3000 (via PM2)"
echo "  Backend:      http://localhost:50051 (via PM2)"
