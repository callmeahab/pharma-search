#!/bin/bash

# Meilisearch Setup Script
# Run as root after system setup

set -e

echo "🔍 Setting up Meilisearch Search Engine"
echo "======================================="

# Create Meilisearch configuration without authentication (internal use only)
echo "📝 Creating Meilisearch configuration..."
cat << EOF > /etc/meilisearch.toml
# Meilisearch Configuration (v1.x) - Development Mode (Internal Only)
db_path = "/var/lib/meilisearch/data"
env = "development"
no_analytics = true
http_addr = "127.0.0.1:7700"
log_level = "INFO"
EOF

# Set proper permissions for config
chown meilisearch:meilisearch /etc/meilisearch.toml
chmod 600 /etc/meilisearch.toml

# Create systemd service
echo "🔧 Creating Meilisearch systemd service..."
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
RestartSec=1
RestartSteps=3

# Security settings
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=/var/lib/meilisearch
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes

# Resource limits
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "🔄 Enabling Meilisearch service..."
systemctl daemon-reload
systemctl enable meilisearch
systemctl start meilisearch

# Wait for service to start
echo "⏳ Waiting for Meilisearch to start..."
sleep 5

# Check if Meilisearch is running
if systemctl is-active --quiet meilisearch; then
    echo "✅ Meilisearch service started successfully"
else
    echo "❌ Meilisearch service failed to start"
    journalctl -u meilisearch --no-pager -n 10
    exit 1
fi

# Test Meilisearch connection
echo "🧪 Testing Meilisearch connection..."
if curl -s http://127.0.0.1:7700/health > /dev/null; then
    echo "✅ Meilisearch is responding to HTTP requests"
else
    echo "❌ Meilisearch is not responding"
    exit 1
fi

# Create environment file without authentication
echo "🔑 Saving Meilisearch configuration..."
cat << EOF > /var/www/pharma-search/.meilisearch-key
# Meilisearch Configuration - No Authentication (Internal Only)
# This file is used by the application to connect to Meilisearch
MEILI_MASTER_KEY=""
MEILI_HTTP_ADDR="http://127.0.0.1:7700"
EOF

chmod 600 /var/www/pharma-search/.meilisearch-key
chown root:root /var/www/pharma-search/.meilisearch-key

# Add firewall rules (block external access)
echo "🔒 Configuring firewall for Meilisearch..."
ufw deny 7700 comment "Block external Meilisearch access"

echo ""
echo "✅ Meilisearch setup completed successfully!"
echo "🔑 Configuration saved to: /var/www/pharma-search/.meilisearch-key"
echo "🌐 Meilisearch running on: http://127.0.0.1:7700 (internal only, development mode)"
echo "📊 Status: systemctl status meilisearch"
echo "📝 Logs: journalctl -u meilisearch -f"
echo ""
echo "🔧 Next steps:"
echo "  1. Update application environment to use Meilisearch"
echo "  2. Run product indexing after database is populated"
echo ""
echo "🔒 Security Note:"
echo "  - Meilisearch runs in development mode (no master key required)"
echo "  - Internal access only (127.0.0.1)"
echo "  - External access blocked by firewall (port 7700)"