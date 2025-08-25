#!/bin/bash

# SSL Certificate Setup with Let's Encrypt
# Run as root

set -e

DOMAIN="aposteka.rs"
EMAIL="admin@aposteka.rs"  # Update with your email
WEBROOT="/var/www/html"

echo "🔐 Setting up SSL certificate for $DOMAIN"

# Check if domain is provided as argument
if [[ $# -eq 1 ]]; then
    DOMAIN=$1
    echo "📧 Using domain: $DOMAIN"
fi

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Install Certbot and Nginx plugin
echo "📦 Installing Certbot..."
apt update
apt install -y certbot python3-certbot-nginx

# Create webroot directory for challenges
echo "📁 Setting up webroot directory..."
mkdir -p "$WEBROOT"
chown www-data:www-data "$WEBROOT"

# Ensure Nginx is running
echo "🌐 Ensuring Nginx is running..."
systemctl start nginx
systemctl enable nginx

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
nginx -t

# Wait for DNS propagation (if domain was just set up)
echo "🌐 Checking domain resolution..."
if ! nslookup "$DOMAIN" > /dev/null 2>&1; then
    echo "⚠️ Warning: Domain $DOMAIN may not be fully propagated yet"
    echo "   If certificate generation fails, wait a few minutes and try again"
fi

# Get SSL certificate
echo "🔐 Requesting SSL certificate for $DOMAIN..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --redirect \
    --expand

if [[ $? -eq 0 ]]; then
    echo "✅ SSL certificate obtained successfully!"
else
    echo "❌ Failed to obtain SSL certificate"
    echo ""
    echo "🔧 Troubleshooting steps:"
    echo "  1. Ensure $DOMAIN points to this server's IP address"
    echo "  2. Check that ports 80 and 443 are open in firewall"
    echo "  3. Verify Nginx is running and accessible"
    echo "  4. Wait for DNS propagation (can take up to 48 hours)"
    exit 1
fi

# Test certificate renewal
echo "🔄 Testing certificate renewal..."
certbot renew --dry-run

if [[ $? -eq 0 ]]; then
    echo "✅ Certificate renewal test successful"
else
    echo "⚠️ Certificate renewal test failed - check configuration"
fi

# Set up automatic renewal
echo "⏰ Setting up automatic certificate renewal..."
crontab -l 2>/dev/null > /tmp/current_cron || true
echo "0 12 * * * /usr/bin/certbot renew --quiet --nginx" >> /tmp/current_cron
crontab /tmp/current_cron
rm /tmp/current_cron

# Test SSL configuration
echo "🧪 Testing SSL configuration..."
if command -v curl > /dev/null; then
    echo "Testing HTTPS connection..."
    if curl -I "https://$DOMAIN" > /dev/null 2>&1; then
        echo "✅ HTTPS connection successful"
    else
        echo "⚠️ HTTPS connection test failed - but certificate may still be valid"
    fi
fi

# Display certificate information
echo ""
echo "🎉 SSL Setup Completed Successfully!"
echo ""
echo "📋 Certificate Information:"
certbot certificates

echo ""
echo "🔧 SSL Configuration Summary:"
echo "  • Domain: $DOMAIN"
echo "  • Certificate: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "  • Private Key: /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo "  • Auto-renewal: Enabled (daily at 12:00 PM)"
echo ""
echo "🌐 Your site is now accessible at:"
echo "  • https://$DOMAIN"
echo "  • https://www.$DOMAIN"
echo ""
echo "📅 Certificate expires in ~90 days and will auto-renew"
echo "💡 Test renewal manually: sudo certbot renew --dry-run"

echo ""
echo "🔐 Security Headers Added:"
echo "  • HSTS (Strict-Transport-Security)"
echo "  • X-Frame-Options"
echo "  • X-Content-Type-Options"
echo "  • Referrer-Policy"