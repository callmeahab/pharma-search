#!/bin/bash

# PM2 Process Management Setup
# Run as root

set -e

APP_DIR="/var/www/pharma-search"
LOG_DIR="/var/log/pharma-search"

echo "⚡ Setting up PM2 Process Management"

cd "$APP_DIR"

# Create PM2 ecosystem configuration
echo "📝 Creating PM2 ecosystem configuration..."
cat << EOF > ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'pharma-nextjs',
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
      log_file: '$LOG_DIR/frontend/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 4000
    },
    {
      name: 'pharma-go-backend',
      cwd: '$APP_DIR',
      script: '$APP_DIR/pharma-server',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        DATABASE_URL: 'postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search',
        MEILI_URL: process.env.MEILI_HTTP_ADDR || 'http://127.0.0.1:7700',
        MEILI_API_KEY: process.env.MEILI_MASTER_KEY || ''
      },
      env_file: '$APP_DIR/.env',
      error_file: '$LOG_DIR/backend/error.log',
      out_file: '$LOG_DIR/backend/out.log',
      log_file: '$LOG_DIR/backend/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      restart_delay: 4000
    }
  ]
};
EOF

# Set up PM2 startup script
echo "🔄 Setting up PM2 startup..."
pm2 startup

echo "💾 Starting PM2 services..."
pm2 start ecosystem.config.js

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Setup PM2 log rotation
echo "📝 Setting up PM2 log rotation..."
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Create monitoring script
echo "📊 Creating monitoring script..."
cat << 'EOF' > "$APP_DIR/monitor.sh"
#!/bin/bash

echo "🔍 Pharma Search Application Status"
echo "=================================="

echo ""
echo "📊 PM2 Processes:"
pm2 status

echo ""
echo "🐘 PostgreSQL Status:"
systemctl is-active postgresql || echo "❌ PostgreSQL is not running"

echo ""
echo "🔍 Meilisearch Status:"
systemctl is-active meilisearch || echo "❌ Meilisearch is not running"

echo ""
echo "🌐 Nginx Status:"  
systemctl is-active nginx || echo "❌ Nginx is not running"

echo ""
echo "💾 Disk Usage:"
df -h /var/www/pharma-search /var/log/pharma-search

echo ""
echo "🧠 Memory Usage:"
free -h

echo ""
echo "📋 Recent Logs (last 10 lines):"
echo "Frontend:"
tail -n 5 /var/log/pharma-search/frontend/combined.log 2>/dev/null || echo "No frontend logs"

echo "Backend:"  
tail -n 5 /var/log/pharma-search/backend/combined.log 2>/dev/null || echo "No backend logs"
EOF

chmod +x "$APP_DIR/monitor.sh"

echo "✅ PM2 setup completed successfully!"
echo ""
echo "🎯 PM2 Commands:"
echo "  pm2 status           - View process status"
echo "  pm2 logs             - View all logs" 
echo "  pm2 logs [app-name]  - View specific app logs"
echo "  pm2 restart [app]    - Restart application"
echo "  pm2 stop [app]       - Stop application"
echo "  pm2 reload [app]     - Zero-downtime reload"
echo ""
echo "📊 Monitoring:"
echo "  Run: $APP_DIR/monitor.sh"
echo ""
echo "🔄 The system will automatically:"
echo "  - Restart failed processes"
echo "  - Rotate logs when they exceed 100MB"
echo "  - Keep 7 days of log history"
echo ""
echo "📊 Data Management:"
echo "  - Data collection runs locally (not on server)"
echo "  - Use local automation scripts for data updates"