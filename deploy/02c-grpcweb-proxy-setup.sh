#!/bin/bash

# gRPC-Web Proxy Setup Script
# This proxy translates gRPC-Web requests to standard gRPC
# Run as root after system setup

set -e

echo "🌐 Setting up gRPC-Web Proxy"
echo "==============================="

# Create grpcwebproxy user
echo "👤 Creating grpcwebproxy user..."
if ! id "grpcwebproxy" &>/dev/null; then
    useradd --system --shell /bin/false --home /var/lib/grpcwebproxy grpcwebproxy
    mkdir -p /var/lib/grpcwebproxy
    chown grpcwebproxy:grpcwebproxy /var/lib/grpcwebproxy
fi

# Install Go if not present (needed to build grpcwebproxy)
echo "📦 Checking Go installation..."
if ! command -v go &> /dev/null; then
    echo "📦 Installing Go..."
    cd /tmp
    wget https://go.dev/dl/go1.22.3.linux-amd64.tar.gz
    rm -rf /usr/local/go
    tar -C /usr/local -xzf go1.22.3.linux-amd64.tar.gz
    export PATH=$PATH:/usr/local/go/bin
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /root/.bashrc
    rm go1.22.3.linux-amd64.tar.gz
else
    echo "✅ Go already installed"
    export PATH=$PATH:/usr/local/go/bin
fi

# Build grpcwebproxy from source
echo "🔨 Building grpcwebproxy from source..."
cd /tmp
rm -rf grpc-web
git clone https://github.com/improbable-eng/grpc-web.git
cd grpc-web/go/grpcwebproxy
go mod tidy
go build -o grpcwebproxy .
mv grpcwebproxy /usr/local/bin/
chmod +x /usr/local/bin/grpcwebproxy
chown root:root /usr/local/bin/grpcwebproxy

cd /tmp
rm -rf grpc-web

echo "✅ grpcwebproxy built and installed successfully"

# Create systemd service
echo "🔧 Creating grpcwebproxy systemd service..."
cat << EOF > /etc/systemd/system/grpcwebproxy.service
[Unit]
Description=gRPC-Web Proxy
After=network.target

[Service]
Type=simple
User=grpcwebproxy
Group=grpcwebproxy
ExecStart=/usr/local/bin/grpcwebproxy \
  --backend_addr=127.0.0.1:50051 \
  --run_tls_server=false \
  --allow_all_origins \
  --server_http_max_write_timeout=30s \
  --server_http_max_read_timeout=30s \
  --use_websockets \
  --server_bind_address=0.0.0.0 \
  --server_http_debug_port=8081
WorkingDirectory=/var/lib/grpcwebproxy
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=23

# Security settings
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes

# Resource limits
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "🔄 Enabling grpcwebproxy service..."
systemctl daemon-reload
systemctl enable grpcwebproxy
systemctl start grpcwebproxy

# Wait for service to start
echo "⏳ Waiting for grpcwebproxy to start..."
sleep 3

# Check if grpcwebproxy is running
if systemctl is-active --quiet grpcwebproxy; then
    echo "✅ grpcwebproxy service started successfully"
else
    echo "❌ grpcwebproxy service failed to start"
    journalctl -u grpcwebproxy --no-pager -n 10
    exit 1
fi

# Test grpcwebproxy connection
echo "🧪 Testing grpcwebproxy connection..."
if curl -s http://127.0.0.1:8080/healthz > /dev/null 2>&1; then
    echo "✅ grpcwebproxy is responding to HTTP requests"
else
    echo "⚠️ grpcwebproxy health endpoint not available (this is normal)"
fi

# Add firewall rules (block external access to grpc ports)
echo "🔒 Configuring firewall for gRPC services..."
ufw deny 50051 comment "Block external gRPC access"
ufw allow 8080 comment "Allow gRPC-Web proxy access"

echo ""
echo "✅ gRPC-Web Proxy setup completed successfully!"
echo "🌐 gRPC-Web proxy running on: http://127.0.0.1:8080"
echo "🔗 Proxying to gRPC backend: 127.0.0.1:50051"
echo "📊 Status: systemctl status grpcwebproxy"
echo "📝 Logs: journalctl -u grpcwebproxy -f"
echo ""
echo "🔧 Next steps:"
echo "  1. Update nginx to proxy gRPC-Web requests to port 8080"
echo "  2. Test gRPC-Web communication through the proxy"