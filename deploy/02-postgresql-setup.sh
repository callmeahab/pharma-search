#!/bin/bash

# PostgreSQL Setup Script
# Run as root or with sudo privileges

set -e

echo "🐘 Configuring PostgreSQL for Pharma Search Application"

# Start and enable PostgreSQL
echo "🔄 Starting PostgreSQL service..."
systemctl start postgresql
systemctl enable postgresql

# Create database and user
echo "📊 Creating database and user..."

# Check if user exists, create if not
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='root'" | grep -q 1; then
    echo "Creating PostgreSQL user 'root'..."
    sudo -u postgres psql -c "CREATE USER root WITH PASSWORD 'pharma_secure_password_2025';"
else
    echo "PostgreSQL user 'root' already exists, updating password..."
    sudo -u postgres psql -c "ALTER USER root WITH PASSWORD 'pharma_secure_password_2025';"
fi

# Check if database exists, create if not  
if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw pharma_search; then
    echo "Creating database 'pharma_search'..."
    sudo -u postgres psql -c "CREATE DATABASE pharma_search OWNER root;"
else
    echo "Database 'pharma_search' already exists, updating owner..."
    sudo -u postgres psql -c "ALTER DATABASE pharma_search OWNER TO root;"
fi

# Grant privileges and set permissions
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pharma_search TO root;"
sudo -u postgres psql -c "ALTER USER root CREATEDB;"

# Install required PostgreSQL extensions
echo "🔧 Installing PostgreSQL extensions..."
sudo -u postgres psql -d pharma_search -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -d pharma_search -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
echo "✅ PostgreSQL extensions installed"

# Configure PostgreSQL for better performance
echo "⚡ Optimizing PostgreSQL configuration..."
PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | grep -oP 'PostgreSQL \K[0-9]+')
PG_CONFIG_DIR="/etc/postgresql/$PG_VERSION/main"

# Backup original config
cp "$PG_CONFIG_DIR/postgresql.conf" "$PG_CONFIG_DIR/postgresql.conf.backup"

# Update PostgreSQL configuration
cat << EOF >> "$PG_CONFIG_DIR/postgresql.conf"

# Pharma Search Application Optimizations
shared_preload_libraries = 'pg_stat_statements'
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 1GB
max_wal_size = 4GB
max_worker_processes = 8
max_parallel_workers_per_gather = 2
max_parallel_workers = 8
max_parallel_maintenance_workers = 2
EOF

# Configure pg_hba.conf for local connections
PG_HBA_CONF="$PG_CONFIG_DIR/pg_hba.conf"
cp "$PG_HBA_CONF" "$PG_HBA_CONF.backup"

# Allow local connections
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" "$PG_CONFIG_DIR/postgresql.conf"

# Restart PostgreSQL to apply changes
echo "🔄 Restarting PostgreSQL..."
systemctl restart postgresql

# Apply search optimizations
echo "⚡ Applying search performance optimizations..."
APP_DIR="/var/www/pharma-search"
DB_NAME="pharma_search"

# Test connection
echo "🧪 Testing database connection..."
sudo -u postgres psql -d pharma_search -c "SELECT 'Database connection successful!' as status;"

echo "✅ PostgreSQL setup completed successfully!"
echo "📝 Database Details:"
echo "  Database Name: pharma_search"
echo "  Username: root" 
echo "  Password: pharma_secure_password_2025"
echo "  Host: localhost"
echo "  Port: 5432"
echo ""
echo "🔗 Connection string for applications:"
echo "postgresql://root:pharma_secure_password_2025@localhost:5432/pharma_search"