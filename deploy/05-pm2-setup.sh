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
      name: 'pharma-fastapi',
      cwd: '$APP_DIR/backend',
      script: '$APP_DIR/backend/venv/bin/uvicorn',
      args: 'src.api:app --host 0.0.0.0 --port 8000 --workers 1',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        PYTHONPATH: '$APP_DIR/backend',
        DATABASE_URL: 'postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search'
      },
      error_file: '$LOG_DIR/backend/error.log',
      out_file: '$LOG_DIR/backend/out.log',
      log_file: '$LOG_DIR/backend/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 4000
    },
    {
      name: 'pharma-scrapers',
      cwd: '$APP_DIR/frontend',
      script: '/root/.bun/bin/bun',
      args: 'scripts/run-scrapers-worker.ts',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
        PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome',
        DISPLAY: ':99'
      },
      error_file: '$LOG_DIR/scrapers/error.log',
      out_file: '$LOG_DIR/scrapers/out.log',
      log_file: '$LOG_DIR/scrapers/combined.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      restart_delay: 10000,
      cron_restart: '0 2 * * *'  // Restart daily at 2 AM
    }
  ]
};
EOF

# Create scrapers runner script if it doesn't exist
echo "🤖 Creating scrapers runner script..."
cat << 'EOF' > "$APP_DIR/frontend/scripts/run-scrapers-worker.ts"
#!/usr/bin/env bun

import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// Configuration
const SCRAPER_INTERVAL = 24 * 60 * 60 * 1000; // Run every 24 hours (daily)
const SCRAPERS_DIR = path.join(process.cwd(), 'scrapers');
const LOG_DIR = process.env.LOG_DIR || '/var/log/pharma-search/scrapers';

interface ScraperInfo {
  name: string;
  path: string;
  enabled: boolean;
}

class ScraperWorker {
  private scrapers: ScraperInfo[] = [];
  private isRunning = false;

  async initialize() {
    console.log('🚀 Initializing Pharma Scrapers Worker');
    await this.loadScrapers();
    this.startScheduler();
  }

  async loadScrapers() {
    try {
      const files = await fs.readdir(SCRAPERS_DIR);
      const scraperFiles = files.filter(file => 
        file.endsWith('.ts') && 
        !file.includes('helpers') &&
        !file.startsWith('_')
      );

      this.scrapers = scraperFiles.map(file => ({
        name: file.replace('.ts', ''),
        path: path.join(SCRAPERS_DIR, file),
        enabled: true
      }));

      console.log(`📋 Loaded ${this.scrapers.length} scrapers:`, 
        this.scrapers.map(s => s.name).join(', ')
      );
    } catch (error) {
      console.error('❌ Failed to load scrapers:', error);
    }
  }

  startScheduler() {
    console.log(`⏰ Scheduler started. Next run in ${SCRAPER_INTERVAL / 1000 / 60 / 60} hours`);
    
    // Run immediately on startup
    setTimeout(() => this.runScrapers(), 10000);
    
    // Then run on schedule
    setInterval(() => {
      if (!this.isRunning) {
        this.runScrapers();
      } else {
        console.log('⏳ Scrapers still running, skipping this cycle');
      }
    }, SCRAPER_INTERVAL);
  }

  async runScrapers() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🔄 Starting scraper cycle');
    
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (const scraper of this.scrapers) {
      if (!scraper.enabled) continue;

      try {
        console.log(`🕷️ Running scraper: ${scraper.name}`);
        await this.runSingleScraper(scraper);
        successCount++;
        console.log(`✅ Completed: ${scraper.name}`);
        
        // Wait between scrapers to be respectful
        await this.sleep(5000);
      } catch (error) {
        console.error(`❌ Failed scraper ${scraper.name}:`, error);
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`🏁 Scraper cycle completed in ${Math.round(duration / 1000)}s`);
    console.log(`📊 Results: ${successCount} success, ${errorCount} errors`);
    
    this.isRunning = false;
  }

  async runSingleScraper(scraper: ScraperInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('/root/.bun/bin/bun', ['run', scraper.path], {
        cwd: process.cwd(),
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' }
      });

      let output = '';
      let errorOutput = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Scraper exited with code ${code}. Error: ${errorOutput}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // No timeout - let scrapers run as long as needed
    });
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM, shutting down gracefully');
  prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Received SIGINT, shutting down gracefully');
  prisma.$disconnect();
  process.exit(0);
});

// Start the worker
const worker = new ScraperWorker();
worker.initialize().catch(console.error);
EOF

# Make the script executable
chmod +x "$APP_DIR/frontend/scripts/run-scrapers-worker.ts"

# Setup Xvfb for headless Chrome
echo "🖼️ Setting up Xvfb for headless Chrome..."
cat << 'EOF' > /etc/systemd/system/xvfb.service
[Unit]
Description=X Virtual Framebuffer Service
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24
Restart=on-failure
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl enable xvfb
systemctl start xvfb

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

echo "Scrapers:"
tail -n 5 /var/log/pharma-search/scrapers/combined.log 2>/dev/null || echo "No scraper logs"
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
echo "  - Restart scrapers daily at 2 AM"
echo "  - Rotate logs when they exceed 100MB"
echo "  - Keep 7 days of log history"