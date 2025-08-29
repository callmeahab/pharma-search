# Pharma Search Deployment Guide

Complete deployment guide for setting up the Pharma Search application on Ubuntu Server without Docker.

## 🏗️ Architecture

The deployment consists of:
- **Frontend**: Next.js application (Port 3000)
- **Backend**: FastAPI Python service (Port 8000)
- **Database**: PostgreSQL with extensions
- **Reverse Proxy**: Nginx (Port 80/443)
- **Process Manager**: PM2 for frontend and backend services
- **Data Collection**: Scrapers run locally and data uploaded via SQL

## 🚀 Quick Deployment

### Prerequisites
- Fresh Ubuntu 20.04+ server
- Root access
- At least 2GB RAM, 10GB storage (reduced - no scraper packages)
- Internet connection

### Remote Deployment (Recommended)
```bash
# 1. Setup SSH access
cd deploy
./ssh-setup.sh YOUR_SERVER_IP root 22

# 2. Deploy to server
./sync-to-server.sh
```

### Direct Server Deployment
```bash
# 1. Copy application files to server /var/www/pharma-search/
# 2. Run the complete deployment as root
bash /var/www/pharma-search/deploy/deploy.sh
```

## 📋 Manual Step-by-Step Deployment

If you prefer to run each step manually:

### 1. System Setup
```bash
sudo bash deploy/01-system-setup.sh
```
Installs: Node.js, Bun, Python, PostgreSQL, Nginx, PM2, and creates directories.
Note: Scraper packages (Chrome, Xvfb) are not installed - scrapers run locally.

### 2. PostgreSQL Configuration
```bash
sudo bash deploy/02-postgresql-setup.sh
```
Sets up database, user, extensions, and optimizations.

### 3. Copy Application Files
```bash
# Copy your application files to /var/www/pharma-search/
# Ensure the directory structure includes:
# - frontend/ (Next.js app)
# - backend/ (FastAPI app)  
# - deploy/ (deployment scripts)
```

### 4. Application Setup
```bash
bash deploy/03-app-setup.sh
```
Installs dependencies, builds applications, creates environment files.

### 5. Database Setup
```bash
# Database schema is managed separately
# Import your schema if needed using standard PostgreSQL tools
```

### 6. Nginx Configuration
```bash
bash deploy/04-nginx-setup.sh
```
Sets up reverse proxy, SSL-ready, security headers, compression.

### 7. PM2 Process Management
```bash
bash deploy/05-pm2-setup.sh
```
Configures frontend and backend services, monitoring, and automatic restarts.

### 8. SSL Certificate Setup (Optional)
```bash
bash deploy/06-ssl-setup.sh
```
Sets up free SSL certificate from Let's Encrypt for aposteka.rs domain with auto-renewal.

## 🔧 Configuration Files

### Environment Variables (.env)
Located at `/var/www/pharma-search/.env`:
- `DATABASE_URL`: postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search
- `NEXTAUTH_SECRET`: Authentication secret  
- `API_BASE_URL`: Backend API URL
- `SMTP_*`: Email configuration (apostekafm@gmail.com)
- Production environment settings

### PM2 Ecosystem (ecosystem.config.js)
- **pharma-nextjs**: Frontend application (Port 3000)
- **pharma-fastapi**: Backend API service (Port 8000)

### Nginx Configuration
- Rate limiting for API endpoints
- Static file caching
- Security headers
- Gzip compression

## 📊 Management Commands

### Remote Management (from local machine)
```bash
# Quick updates
./quick-sync.sh

# Specific component updates
./quick-sync.sh --frontend
./quick-sync.sh --backend
./quick-sync.sh --scrapers

# Full re-sync
./sync-to-server.sh --sync-only
```

### Server Management (on server)
```bash
# Monitor all services
/var/www/pharma-search/monitor.sh

# PM2 status
pm2 status

# View logs
pm2 logs
pm2 logs pharma-nextjs
pm2 logs pharma-fastapi

# Update application
/var/www/pharma-search/update.sh

# Manual PM2 operations
pm2 restart pharma-nextjs
pm2 reload ecosystem.config.js
```

### Database Operations
```bash
# Create backup
/var/www/pharma-search/backup.sh

# View database
PGPASSWORD="pharma_secure_password_2025" psql -h localhost -U root -d pharma_search

# Check database size
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('pharma_search'));"
```

## 🔄 Service Management

### Start/Stop Services
```bash
# PM2 services
pm2 start ecosystem.config.js
pm2 stop all
pm2 restart all

# System services
systemctl restart nginx
systemctl restart postgresql
```

### View Service Status
```bash
systemctl status nginx
systemctl status postgresql
pm2 status
```

## 📝 Log Locations

- **Application Logs**: `/var/log/pharma-search/`
  - `frontend/`: Next.js application logs
  - `backend/`: FastAPI service logs
  - `scrapers/`: Scraper worker logs
- **System Logs**:
  - Nginx: `/var/log/nginx/`
  - PostgreSQL: `/var/log/postgresql/`
  - PM2: `pm2 logs`

## 🔒 Security Features

- UFW firewall configured (SSH, HTTP, HTTPS)
- PostgreSQL local connections only
- Nginx security headers
- Rate limiting on API endpoints
- Log rotation and cleanup
- Process isolation with dedicated user

## 📈 Performance Optimizations

- **PostgreSQL**: Optimized for the workload
- **Nginx**: Gzip compression, static file caching
- **PM2**: Cluster mode for Node.js, automatic restarts
- **Log Rotation**: Prevents disk space issues
- **Lightweight Server**: No scraper packages (Chrome, Xvfb) - reduced resource usage

## 🚨 Troubleshooting

### Common Issues

1. **Services not starting**:
   ```bash
   pm2 logs
   systemctl status nginx
   systemctl status postgresql
   ```

2. **Database connection issues**:
   ```bash
   sudo -u postgres psql -d pharma_search -c "SELECT version();"
   ```

3. **Permission issues**:
   ```bash
   chown -R root:root /var/www/pharma-search
   chown -R root:root /var/log/pharma-search
   ```

4. **Port conflicts**:
   ```bash
   netstat -tlnp | grep :3000
   netstat -tlnp | grep :8000
   ```

### Health Checks
- Frontend: `curl http://localhost:3000`
- Backend: `curl http://localhost:8000/api/health`
- Nginx: `curl http://localhost/health`

## 🔄 Automated Maintenance

The deployment includes automated:
- **Log rotation**: Daily with 14-day retention
- **Database backups**: Daily at 3 AM, 7-day retention
- **Process monitoring**: PM2 auto-restart on failures
- **Data Collection**: Run scrapers locally and upload data via SQL scripts

## 🕷️ Data Collection (Local Scrapers)

The scrapers now run on your local machine for better performance and reliability.

### Running Scrapers Locally
```bash
# Navigate to frontend directory
cd frontend

# Run all scrapers and export to SQL
bun scripts/run-scrapers-local.ts

# This will:
# 1. Run all 86+ scrapers with concurrency
# 2. Run cleanup scripts
# 3. Export database to SQL file in ../exports/
```

### Uploading Data to Server
```bash
# First, configure the server details in the script
# Edit: frontend/scripts/upload-data-to-server.ts
# Update SERVER_CONFIG with your server IP and credentials

# Then upload the latest scraped data
bun scripts/upload-data-to-server.ts

# This will:
# 1. Create backup on server
# 2. Upload SQL file via SCP
# 3. Execute SQL on remote database
# 4. Clean up temporary files
```

### Automation Options
You can automate this process with:
```bash
# Create a daily cron job on your local machine
# Add to crontab: crontab -e
0 2 * * * cd /path/to/pharma-search/frontend && bun scripts/run-scrapers-local.ts && bun scripts/upload-data-to-server.ts
```

## 📞 Support

For issues:
1. Check logs in `/var/log/pharma-search/` (server) or `../scrapers_logs/` (local)
2. Run the monitor script: `/var/www/pharma-search/monitor.sh`
3. Check individual service status
4. Review this documentation

## 🔄 Updates and Maintenance

### Regular Updates
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update application
/var/www/pharma-search/update.sh

# Update Node.js dependencies
cd /var/www/pharma-search/frontend
export PATH="/root/.bun/bin:$PATH"
bun update

# Update Python dependencies
cd /var/www/pharma-search/backend
source venv/bin/activate
pip install --upgrade -r requirements.txt
```

### SSL Certificate Management

#### Initial Setup
The deployment includes automated SSL setup:
```bash
# Run during deployment or separately
bash deploy/06-ssl-setup.sh
```

#### Manual SSL Commands
```bash
# Install SSL certificate manually
sudo certbot --nginx -d aposteka.rs -d www.aposteka.rs

# Test certificate renewal
sudo certbot renew --dry-run

# Force renewal (if needed)
sudo certbot renew --force-renewal

# Check certificate status
sudo certbot certificates
```

#### Certificate Details
- **Domain**: aposteka.rs, www.aposteka.rs
- **Provider**: Let's Encrypt (free)
- **Renewal**: Automatic (daily check at 12:00 PM)
- **Validity**: 90 days (auto-renewed at 30 days remaining)

## 📋 Deployment Checklist

- [ ] System packages updated
- [ ] PostgreSQL installed and configured  
- [ ] Application code cloned and built
- [ ] Environment variables configured
- [ ] Database migrated
- [ ] Nginx configured and running
- [ ] PM2 services started (frontend + backend)
- [ ] SSL certificate installed for aposteka.rs (recommended)
- [ ] Firewall configured (ports 80, 443, 22)
- [ ] Database backups enabled
- [ ] Application accessible at https://aposteka.rs
- [ ] Local scraper setup configured