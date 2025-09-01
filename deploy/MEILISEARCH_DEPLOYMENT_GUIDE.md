# Meilisearch Deployment Integration Guide

This guide documents the integration of Meilisearch into the Pharma Search application deployment process.

## 🚀 Overview

Meilisearch has been integrated into the deployment process to provide fast, typo-tolerant search functionality for pharmaceutical products. The deployment now includes:

- ✅ Meilisearch installation and configuration
- ✅ Systemd service setup for production
- ✅ Automated product indexing
- ✅ Environment variable configuration
- ✅ Monitoring and maintenance scripts

## 📋 Deployment Scripts Updated

### 1. System Setup (`01-system-setup.sh`)
- **Added**: Meilisearch binary installation via official installer
- **Added**: Meilisearch system user and directory creation
- **Added**: Security configuration with dedicated user/group

### 2. New: Meilisearch Service Setup (`02b-meilisearch-setup.sh`)
- **Creates**: Production Meilisearch configuration (`/etc/meilisearch.toml`)
- **Sets up**: Systemd service with security hardening
- **Generates**: Master key for production authentication
- **Configures**: Resource limits and performance settings
- **Secures**: Firewall rules (blocks external access)

### 3. Application Setup (`03-app-setup.sh`)  
- **Added**: Meilisearch environment variables to `.env` files
- **Added**: Automatic master key integration
- **Added**: Meilisearch log directory creation
- **Added**: Indexer script validation

### 4. PM2 Configuration (`05-pm2-setup.sh`)
- **Added**: Environment file loading for backend service
- **Added**: Meilisearch status monitoring in monitoring script

### 5. New: Product Indexing (`07-meilisearch-index.sh`)
- **Validates**: Meilisearch and database connectivity
- **Indexes**: All products with enhanced attributes (dosage count, brand, form, etc.)
- **Tests**: Search functionality after indexing
- **Provides**: Detailed logging and error handling
- **Shows**: Index statistics and performance metrics

### 6. Main Deployment (`deploy.sh`)
- **Added**: Meilisearch setup step in deployment flow
- **Added**: Optional indexing during initial deployment
- **Added**: Meilisearch service monitoring
- **Updated**: Management commands documentation

## 🔧 Configuration Files Created

### `/etc/meilisearch.toml`
```toml
db_path = "/var/lib/meilisearch/data"
dumps_dir = "/var/lib/meilisearch/dumps"
env = "production"
master_key = "[GENERATED_KEY]"
no_analytics = true
http_addr = "127.0.0.1:7700"
log_level = "INFO"
max_indexing_memory = "1Gb"
max_indexing_threads = 2
```

### `/var/www/pharma-search/.meilisearch-key`
```bash
MEILI_MASTER_KEY="[GENERATED_KEY]"
MEILI_HTTP_ADDR="http://127.0.0.1:7700"
```

### `/etc/systemd/system/meilisearch.service`
- Secure systemd service configuration
- Resource limits and security hardening
- Automatic restart on failure

## 🔒 Security Features

- **Internal Only**: Meilisearch only accessible from localhost (127.0.0.1:7700)
- **Firewall Rules**: UFW blocks external access to port 7700
- **Dedicated User**: Runs under `meilisearch` system user (no shell access)
- **Master Key**: Generated unique key for production authentication
- **File Permissions**: Restrictive permissions on configuration files (600)
- **Security Hardening**: Systemd service with security restrictions

## 📊 Performance Optimizations

- **Memory Limit**: 1GB RAM allocation for indexing
- **Thread Control**: Limited to 2 indexing threads
- **Resource Limits**: Systemd memory constraints
- **Caching**: Built-in Meilisearch caching for fast responses
- **Analytics Disabled**: No telemetry data sent to Meilisearch

## 🚀 Deployment Process

### Fresh Deployment
```bash
# 1. Run complete deployment
sudo ./deploy/deploy.sh

# The script will:
# - Install Meilisearch during system setup
# - Configure Meilisearch service
# - Set up application with Meilisearch integration
# - Optionally run initial indexing
```

### Manual Indexing (After Data Updates)
```bash
# Re-index products after data changes
sudo bash /var/www/pharma-search/deploy/07-meilisearch-index.sh
```

### Service Management
```bash
# Check Meilisearch status
systemctl status meilisearch

# View logs
journalctl -u meilisearch -f

# Restart service
systemctl restart meilisearch

# View application monitoring
/var/www/pharma-search/monitor.sh
```

## 📋 Index Structure

The Meilisearch index includes enhanced product data:

- **Basic Info**: title, price, category, brand, vendor
- **Dosage Data**: dosageValue, dosageUnit, dosageCount
- **Volume Data**: volumeValue, volumeUnit, volumeRange
- **Search Features**: searchableText, synonyms, typo tolerance
- **Faceted Search**: brandFacet, categoryFacet, formFacet, priceRange
- **Images & Links**: thumbnail, product link, vendor information

## 🔍 Search Capabilities

- **Sub-10ms Response Times**: Fast search with caching
- **Typo Tolerance**: Handles misspellings automatically
- **Faceted Filtering**: Filter by brand, category, form, price
- **Product Grouping**: Smart grouping by similarity for price comparison
- **Dosage Count Awareness**: Groups products by package size (30 vs 60 tablets)
- **Multi-language**: Supports Serbian/Latin script variations

## 📈 Monitoring & Maintenance

### Automated Monitoring
- **PM2 Integration**: Meilisearch status in monitoring script
- **Health Checks**: HTTP endpoint monitoring
- **Log Rotation**: Automatic log management
- **Service Auto-restart**: Systemd handles failures

### Manual Maintenance Commands
```bash
# Full application monitoring
/var/www/pharma-search/monitor.sh

# Check index statistics
curl -s http://127.0.0.1:7700/indexes/products/stats

# Test search functionality  
curl -s -X POST http://127.0.0.1:7700/indexes/products/search \
     -H 'Content-Type: application/json' \
     -d '{"q": "vitamin d", "limit": 5}'

# Re-index after data updates
bash /var/www/pharma-search/deploy/07-meilisearch-index.sh
```

## 🔄 Update Process

The update script (`/var/www/pharma-search/update.sh`) now includes:
- **Optional Re-indexing**: Prompts for re-indexing after updates
- **Service Coordination**: Ensures all services restart properly
- **Meilisearch Integration**: Maintains search functionality during updates

## 📁 Directory Structure

```
/var/www/pharma-search/
├── meilisearch_indexer.py          # Product indexing script
├── .meilisearch-key                # Meilisearch credentials
├── .env                            # Environment variables
└── deploy/
    ├── 02b-meilisearch-setup.sh   # Meilisearch service setup
    └── 07-meilisearch-index.sh    # Product indexing script

/var/lib/meilisearch/
├── data/                           # Search index data
└── dumps/                          # Index backups

/var/log/pharma-search/
└── meilisearch/
    └── indexing.log               # Indexing operation logs

/etc/
├── meilisearch.toml               # Service configuration
└── systemd/system/
    └── meilisearch.service        # Systemd service definition
```

## 🚨 Troubleshooting

### Common Issues

1. **Meilisearch Won't Start**
   ```bash
   journalctl -u meilisearch --no-pager -n 20
   # Check for permission issues or port conflicts
   ```

2. **Indexing Fails**
   ```bash
   cat /var/log/pharma-search/meilisearch/indexing.log
   # Check database connectivity and memory availability
   ```

3. **Search Not Working**
   ```bash
   curl -s http://127.0.0.1:7700/health
   # Verify service is running and accessible
   ```

4. **Memory Issues**
   ```bash
   # Check available memory
   free -h
   # Adjust max_indexing_memory in /etc/meilisearch.toml if needed
   ```

## 📞 Support

- **Service Logs**: `journalctl -u meilisearch -f`
- **Application Logs**: `/var/log/pharma-search/meilisearch/`
- **Monitoring Script**: `/var/www/pharma-search/monitor.sh`
- **Configuration**: `/etc/meilisearch.toml`

This integration provides a robust, production-ready search solution with proper security, monitoring, and maintenance capabilities.