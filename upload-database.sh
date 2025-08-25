#!/bin/bash

# Database Upload Script
# Uploads local PostgreSQL database to remote server

# Configuration
SERVER_HOST="138.197.180.107"
SERVER_USER="root"
SERVER_PORT="22"
LOCAL_DB_NAME="pharmagician"
LOCAL_DB_USER="postgres"
LOCAL_DB_PASSWORD="docker"
REMOTE_DB_NAME="pharma_search"
REMOTE_DB_USER="root"
REMOTE_DB_PASSWORD="pharma_secure_password_2025"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required commands exist
check_dependencies() {
    print_status "Checking dependencies..."
    
    local missing_deps=()
    
    if ! command -v pg_dump &> /dev/null; then
        missing_deps+=("postgresql-client")
    fi
    
    if ! command -v scp &> /dev/null; then
        missing_deps+=("openssh-client")
    fi
    
    if ! command -v ssh &> /dev/null; then
        missing_deps+=("openssh-client")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        print_error "Please install the missing dependencies and try again."
        exit 1
    fi
    
    print_success "All dependencies found"
}

# Test local database connection
test_local_connection() {
    print_status "Testing local database connection..."
    
    if PGPASSWORD="$LOCAL_DB_PASSWORD" pg_isready -h localhost -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" &> /dev/null; then
        print_success "Local database connection successful"
    else
        print_error "Cannot connect to local database"
        print_error "Make sure PostgreSQL is running and credentials are correct"
        exit 1
    fi
}

# Test remote server connection
test_remote_connection() {
    print_status "Testing remote server connection..."
    
    if ssh -p "$SERVER_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$SERVER_USER@$SERVER_HOST" "echo 'Connection test successful'" &> /dev/null; then
        print_success "Remote server connection successful"
    else
        print_error "Cannot connect to remote server"
        print_error "Make sure SSH key authentication is set up"
        exit 1
    fi
}

# Create database dump
create_dump() {
    local dump_file="$1"
    print_status "Creating database dump..."
    
    if PGPASSWORD="$LOCAL_DB_PASSWORD" pg_dump -h localhost -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" --clean --if-exists --no-owner --no-privileges > "$dump_file"; then
        print_success "Database dump created: $dump_file"
    else
        print_error "Failed to create database dump"
        exit 1
    fi
}

# Upload dump to server
upload_dump() {
    local dump_file="$1"
    print_status "Uploading dump to server..."
    
    if scp -P "$SERVER_PORT" "$dump_file" "$SERVER_USER@$SERVER_HOST:/tmp/pharma_dump.sql"; then
        print_success "Dump uploaded successfully"
    else
        print_error "Failed to upload dump to server"
        exit 1
    fi
}

# Create backup on server
create_server_backup() {
    print_status "Creating backup on server..."
    
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_command="mkdir -p /root/backups && PGPASSWORD=\"$REMOTE_DB_PASSWORD\" pg_dump -h localhost -U \"$REMOTE_DB_USER\" -d \"$REMOTE_DB_NAME\" > \"/root/backups/pre-import-${timestamp}.sql\""
    
    if ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$backup_command"; then
        print_success "Server backup created: pre-import-${timestamp}.sql"
    else
        print_warning "Failed to create server backup, continuing anyway..."
    fi
}

# Import dump to remote database
import_dump() {
    print_status "Importing dump to remote database..."
    
    local import_command="PGPASSWORD=\"$REMOTE_DB_PASSWORD\" psql -h localhost -U \"$REMOTE_DB_USER\" -d \"$REMOTE_DB_NAME\" -f /tmp/pharma_dump.sql"
    
    if ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$import_command"; then
        print_success "Database import completed"
    else
        print_error "Failed to import database"
        exit 1
    fi
}

# Clean up temporary files
cleanup() {
    local dump_file="$1"
    print_status "Cleaning up temporary files..."
    
    # Remove local dump file
    if [ -f "$dump_file" ]; then
        rm "$dump_file"
        print_success "Local dump file removed"
    fi
    
    # Remove remote dump file
    ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "rm -f /tmp/pharma_dump.sql" 2>/dev/null
    print_success "Remote dump file removed"
}

# Show help
show_help() {
    cat << EOF
Database Upload Script

This script uploads your local PostgreSQL database to a remote server.

Usage: $0 [OPTIONS]

Options:
    --help, -h          Show this help message
    --no-backup         Skip creating backup on server
    --dry-run           Show what would be done without executing

Configuration (edit script to modify):
    Local Database:  $LOCAL_DB_NAME@localhost:5432
    Remote Server:   $SERVER_USER@$SERVER_HOST:$SERVER_PORT
    Remote Database: $REMOTE_DB_NAME

Before running:
1. Ensure your local PostgreSQL is running
2. Set up SSH key authentication to the remote server
3. Verify the remote PostgreSQL is running

Example:
    $0                  # Full upload with backup
    $0 --no-backup      # Upload without server backup
    $0 --dry-run        # Show what would happen

EOF
}

# Parse command line arguments
CREATE_BACKUP=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            exit 0
            ;;
        --no-backup)
            CREATE_BACKUP=false
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            print_error "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Main execution
main() {
    echo "🚀 Starting database upload to server..."
    echo ""
    
    # Show configuration
    print_status "Configuration:"
    echo "  Local DB:    $LOCAL_DB_NAME@localhost:5432"
    echo "  Remote:      $SERVER_USER@$SERVER_HOST:$SERVER_PORT"
    echo "  Remote DB:   $REMOTE_DB_NAME"
    echo "  Backup:      $CREATE_BACKUP"
    echo "  Dry run:     $DRY_RUN"
    echo ""
    
    if [ "$DRY_RUN" = true ]; then
        print_status "DRY RUN - No actual changes will be made"
        echo ""
        print_status "Would execute:"
        echo "  1. Check dependencies"
        echo "  2. Test local database connection"
        echo "  3. Test remote server connection"
        echo "  4. Create database dump"
        echo "  5. Upload dump to server"
        if [ "$CREATE_BACKUP" = true ]; then
            echo "  6. Create backup on server"
            echo "  7. Import dump to remote database"
            echo "  8. Clean up temporary files"
        else
            echo "  6. Import dump to remote database"
            echo "  7. Clean up temporary files"
        fi
        exit 0
    fi
    
    # Create temporary dump file
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local dump_file="/tmp/pharma_dump_${timestamp}.sql"
    
    # Trap to ensure cleanup on exit
    trap "cleanup '$dump_file'" EXIT
    
    # Execute steps
    check_dependencies
    test_local_connection
    test_remote_connection
    create_dump "$dump_file"
    upload_dump "$dump_file"
    
    if [ "$CREATE_BACKUP" = true ]; then
        create_server_backup
    fi
    
    import_dump
    
    echo ""
    print_success "🎉 Database upload completed successfully!"
    echo ""
    print_status "📋 Next steps:"
    echo "  1. Check the application to verify data was imported correctly"
    echo "  2. Monitor server performance and logs"
    
    if [ "$CREATE_BACKUP" = true ]; then
        echo "  3. Server backup created in /root/backups/"
    fi
}

# Run main function
main "$@"