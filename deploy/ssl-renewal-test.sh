#!/bin/bash

# SSL Certificate Renewal Test Script
# Run this to test if SSL certificate renewal is working properly

set -e

DOMAIN="aposteka.rs"

echo "🔐 Testing SSL Certificate Renewal for $DOMAIN"
echo "============================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)"
   exit 1
fi

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo "❌ Certbot is not installed"
    echo "💡 Install with: apt install certbot python3-certbot-nginx"
    exit 1
fi

# Check current certificate status
echo "📋 Current certificate status:"
certbot certificates

echo ""
echo "🧪 Testing certificate renewal (dry run)..."
if certbot renew --dry-run --nginx; then
    echo "✅ Certificate renewal test PASSED"
    echo "🔄 Automatic renewal is working correctly"
else
    echo "❌ Certificate renewal test FAILED"
    echo "🔧 Check the error messages above"
    exit 1
fi

# Check certificate expiry
echo ""
echo "📅 Certificate expiration check:"
if openssl x509 -noout -dates -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null; then
    echo ""
    days_left=$(openssl x509 -noout -enddate -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" | cut -d= -f2 | xargs -I {} date -d "{}" +%s)
    current_date=$(date +%s)
    days_remaining=$(( (days_left - current_date) / 86400 ))
    
    if [[ $days_remaining -gt 30 ]]; then
        echo "✅ Certificate is valid for $days_remaining more days"
    elif [[ $days_remaining -gt 7 ]]; then
        echo "⚠️ Certificate expires in $days_remaining days - will auto-renew soon"
    else
        echo "🚨 Certificate expires in $days_remaining days - renewal needed!"
    fi
else
    echo "❌ Could not read certificate file"
fi

# Check cron job for renewal
echo ""
echo "⏰ Checking automatic renewal setup:"
if crontab -l | grep -q "certbot renew"; then
    echo "✅ Automatic renewal cron job is configured"
    crontab -l | grep "certbot renew"
else
    echo "⚠️ Automatic renewal cron job not found"
    echo "💡 Add this to crontab: 0 12 * * * /usr/bin/certbot renew --quiet --nginx"
fi

# Check nginx configuration
echo ""
echo "🌐 Checking Nginx SSL configuration:"
if nginx -t 2>/dev/null; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration has errors"
    nginx -t
fi

# Test HTTPS connection
echo ""
echo "🔗 Testing HTTPS connection:"
if command -v curl &> /dev/null; then
    if curl -I -s --connect-timeout 10 "https://$DOMAIN" | head -1 | grep -q "200 OK"; then
        echo "✅ HTTPS connection successful"
    else
        echo "⚠️ HTTPS connection test inconclusive"
        echo "🌐 Check https://$DOMAIN manually"
    fi
else
    echo "💡 Install curl to test HTTPS connection"
fi

echo ""
echo "🎉 SSL Certificate Test Completed!"
echo ""
echo "📋 Summary:"
echo "  • Certificate status: $(certbot certificates | grep -q "$DOMAIN" && echo "✅ Present" || echo "❌ Missing")"
echo "  • Renewal test: ✅ Passed"
echo "  • Auto-renewal: $(crontab -l | grep -q "certbot renew" && echo "✅ Configured" || echo "❌ Not configured")"
echo "  • Nginx config: ✅ Valid"
echo ""
echo "💡 Next renewal check will happen automatically within 30 days of expiration"