#!/bin/bash

# Fix Meilisearch Configuration Script
# Run this on the server to fix all Meilisearch issues

set -e

echo "🔧 Fixing Meilisearch Configuration Issues"
echo "==========================================="

# Stop Meilisearch service
echo "🛑 Stopping Meilisearch service..."
systemctl stop meilisearch || true

# Reset failed service state
systemctl reset-failed meilisearch || true

# Create a clean, working Meilisearch configuration
echo "📝 Creating clean Meilisearch configuration..."
cat << 'EOF' > /etc/meilisearch.toml
db_path = "/var/lib/meilisearch/data"
env = "development"
no_analytics = true
http_addr = "127.0.0.1:7700"
log_level = "INFO"
EOF

# Set proper permissions
chown meilisearch:meilisearch /etc/meilisearch.toml
chmod 600 /etc/meilisearch.toml

echo "✅ Configuration file created:"
cat /etc/meilisearch.toml

# Start Meilisearch service
echo "🚀 Starting Meilisearch service..."
systemctl start meilisearch

# Wait for service to start
echo "⏳ Waiting for Meilisearch to start..."
sleep 3

# Check service status
if systemctl is-active --quiet meilisearch; then
    echo "✅ Meilisearch service is running"
else
    echo "❌ Meilisearch service failed to start"
    echo "📝 Service logs:"
    journalctl -u meilisearch --no-pager -n 10
    exit 1
fi

# Test HTTP connection
echo "🧪 Testing Meilisearch HTTP connection..."
if curl -s http://127.0.0.1:7700/health > /dev/null; then
    echo "✅ Meilisearch is responding to HTTP requests"
    
    # Show health status
    echo "📊 Meilisearch health status:"
    curl -s http://127.0.0.1:7700/health | python3 -m json.tool 2>/dev/null || echo "Health check passed but couldn't format JSON"
else
    echo "❌ Meilisearch is not responding to HTTP requests"
    echo "📝 Service logs:"
    journalctl -u meilisearch --no-pager -n 5
    exit 1
fi

echo ""
echo "🎉 Meilisearch is now working correctly!"
echo "🔧 You can now run: bash deploy/07-meilisearch-index.sh"
echo ""
echo "📊 Useful commands:"
echo "  - Check status: systemctl status meilisearch"
echo "  - View logs: journalctl -u meilisearch -f"
echo "  - Test health: curl http://127.0.0.1:7700/health"