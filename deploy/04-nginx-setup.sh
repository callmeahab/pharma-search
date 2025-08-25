#!/bin/bash

# Nginx Reverse Proxy Setup
# Run as root or with sudo privileges

set -e

echo "🌐 Setting up Nginx Reverse Proxy"

# Remove default nginx configuration
echo "🗑️ Removing default Nginx configuration..."
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-available/default

# Create Nginx configuration for the application
echo "⚙️ Creating Nginx configuration..."
cat << 'EOF' > /etc/nginx/sites-available/pharma-search
# Pharma Search Application Nginx Configuration

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=general:10m rate=20r/s;

# Upstream servers
upstream nextjs_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream fastapi_backend {
    server 127.0.0.1:8000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name aposteka.rs www.aposteka.rs;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private auth;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        text/json
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # Client body size limit (for file uploads)
    client_max_body_size 10M;

    # Logging
    access_log /var/log/nginx/aposteka.access.log;
    error_log /var/log/nginx/aposteka.error.log;

    # Let's Encrypt challenges
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \$uri =404;
    }

    # API routes (FastAPI backend)
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://fastapi_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    # Static files and Next.js app
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
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
        
        proxy_pass http://nextjs_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # Deny access to sensitive files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    location ~ \.(env|log)$ {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

# Enable the site
echo "✅ Enabling Nginx site..."
ln -sf /etc/nginx/sites-available/pharma-search /etc/nginx/sites-enabled/

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
nginx -t

# Restart Nginx
echo "🔄 Restarting Nginx..."
systemctl restart nginx
systemctl enable nginx

# Create log rotation for application logs
echo "📝 Setting up log rotation..."
cat << EOF > /etc/logrotate.d/pharma-search
/var/log/pharma-search/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
    create 0640 pharma pharma
}

/var/log/nginx/pharma-search.*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        if [ -f /var/run/nginx.pid ]; then
            kill -USR1 \`cat /var/run/nginx.pid\`
        fi
    endscript
}
EOF

echo "✅ Nginx setup completed successfully!"
echo "🌐 Your application will be available at: http://your-server-ip"
echo "📊 Nginx status: $(systemctl is-active nginx)"
echo ""
echo "🔧 To customize the domain name:"
echo "  1. Edit /etc/nginx/sites-available/pharma-search"
echo "  2. Replace 'server_name _;' with your domain"
echo "  3. Run: nginx -t && systemctl reload nginx"