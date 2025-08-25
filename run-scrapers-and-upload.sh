#!/bin/bash

# Pharma Search - Automated Scraping and Upload Script
# This script runs all scrapers locally and uploads the data to the server

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
EXPORTS_DIR="$SCRIPT_DIR/exports"
SERVER_HOST="root@138.197.180.107"
LOG_FILE="$SCRIPT_DIR/scraping-automation.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${GREEN}[INFO]${NC} $message"
            ;;
        "WARN")
            echo -e "${YELLOW}[WARN]${NC} $message"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $message"
            ;;
        "STEP")
            echo -e "${BLUE}[STEP]${NC} $message"
            ;;
    esac
    
    echo "$timestamp [$level] $message" >> "$LOG_FILE"
}

# Function to check prerequisites
check_prerequisites() {
    log "STEP" "Checking prerequisites..."
    
    # Check if we're in the right directory
    if [[ ! -d "$FRONTEND_DIR" ]]; then
        log "ERROR" "Frontend directory not found: $FRONTEND_DIR"
        log "ERROR" "Please run this script from the pharma-search root directory"
        exit 1
    fi
    
    # Check if bun is installed
    if ! command -v bun &> /dev/null; then
        log "ERROR" "Bun is not installed or not in PATH"
        log "ERROR" "Please install Bun: https://bun.sh"
        exit 1
    fi
    
    # Check if pg_dump is available
    if ! command -v pg_dump &> /dev/null; then
        log "ERROR" "pg_dump is not installed or not in PATH"
        log "ERROR" "Please install PostgreSQL client tools"
        exit 1
    fi
    
    # Check if ssh/scp are available
    if ! command -v scp &> /dev/null; then
        log "ERROR" "scp is not installed or not in PATH"
        exit 1
    fi
    
    # Create exports directory if it doesn't exist
    mkdir -p "$EXPORTS_DIR"
    
    # Test SSH connection to server
    log "INFO" "Testing SSH connection to server..."
    if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$SERVER_HOST" "echo 'SSH connection successful'" &>/dev/null; then
        log "WARN" "SSH connection test failed. You may need to enter password during upload."
    else
        log "INFO" "SSH connection successful"
    fi
    
    log "INFO" "Prerequisites check completed"
}

# Function to run scrapers locally
run_scrapers() {
    log "STEP" "Starting local scraper execution..."
    
    cd "$FRONTEND_DIR"
    
    local start_time=$(date +%s)
    
    # Run the local scraper script
    if bun scripts/run-scrapers-local.ts; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local hours=$((duration / 3600))
        local minutes=$(((duration % 3600) / 60))
        local seconds=$((duration % 60))
        
        log "INFO" "Scrapers completed successfully in ${hours}h ${minutes}m ${seconds}s"
        return 0
    else
        local exit_code=$?
        log "ERROR" "Scraper execution failed with exit code: $exit_code"
        return $exit_code
    fi
}

# Function to upload data to server
upload_to_server() {
    log "STEP" "Starting data upload to server..."
    
    cd "$FRONTEND_DIR"
    
    # Run the upload script
    if bun scripts/upload-data-to-server.ts; then
        log "INFO" "Data upload completed successfully"
        return 0
    else
        local exit_code=$?
        log "ERROR" "Data upload failed with exit code: $exit_code"
        return $exit_code
    fi
}

# Function to cleanup old exports (keep last 5)
cleanup_exports() {
    log "STEP" "Cleaning up old export files..."
    
    cd "$EXPORTS_DIR"
    
    # Count SQL files
    local file_count=$(ls -1 scraped-data-*.sql 2>/dev/null | wc -l)
    
    if [[ $file_count -gt 5 ]]; then
        log "INFO" "Found $file_count export files, keeping newest 5"
        
        # Remove old files (keep newest 5)
        ls -t scraped-data-*.sql | tail -n +6 | xargs rm -f
        
        local remaining=$(ls -1 scraped-data-*.sql 2>/dev/null | wc -l)
        log "INFO" "Cleanup completed, $remaining export files remaining"
    else
        log "INFO" "Found $file_count export files, no cleanup needed"
    fi
}

# Function to display summary
show_summary() {
    local start_time=$1
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    local hours=$((total_duration / 3600))
    local minutes=$(((total_duration % 3600) / 60))
    local seconds=$((total_duration % 60))
    
    log "STEP" "=== AUTOMATION SUMMARY ==="
    log "INFO" "Total execution time: ${hours}h ${minutes}m ${seconds}s"
    log "INFO" "Log file: $LOG_FILE"
    
    # Show latest export info
    if [[ -d "$EXPORTS_DIR" ]]; then
        local latest_export=$(ls -t "$EXPORTS_DIR"/scraped-data-*.sql 2>/dev/null | head -1)
        if [[ -n "$latest_export" ]]; then
            local file_size=$(du -h "$latest_export" | cut -f1)
            log "INFO" "Latest export: $(basename "$latest_export") ($file_size)"
        fi
    fi
    
    log "INFO" "Automation completed successfully!"
    log "INFO" "Check your application at http://138.197.180.107 to verify the data"
}

# Function to handle errors
handle_error() {
    local exit_code=$1
    log "ERROR" "Automation failed with exit code: $exit_code"
    log "ERROR" "Check the log file for details: $LOG_FILE"
    
    # Show last few log entries
    log "INFO" "Last 10 log entries:"
    tail -10 "$LOG_FILE" | while read line; do
        echo "  $line"
    done
    
    exit $exit_code
}

# Function to handle interruption
handle_interrupt() {
    log "WARN" "Script interrupted by user"
    log "INFO" "Partial log available at: $LOG_FILE"
    exit 130
}

# Main execution function
main() {
    local start_time=$(date +%s)
    
    # Set up signal handlers
    trap 'handle_interrupt' INT TERM
    trap 'handle_error $?' ERR
    
    # Header
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    Pharma Search Automation                  ║${NC}"
    echo -e "${BLUE}║              Automated Scraping and Upload Process           ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    log "INFO" "Starting automation process..."
    log "INFO" "Script directory: $SCRIPT_DIR"
    log "INFO" "Log file: $LOG_FILE"
    
    # Execute steps
    check_prerequisites
    run_scrapers
    upload_to_server
    cleanup_exports
    show_summary $start_time
}

# Help function
show_help() {
    cat << EOF
Pharma Search - Automated Scraping and Upload Script

USAGE:
    ./run-scrapers-and-upload.sh [OPTIONS]

OPTIONS:
    --help, -h          Show this help message
    --dry-run          Check prerequisites without running scrapers
    --scrapers-only    Run only scrapers without uploading
    --upload-only      Upload latest export without running scrapers
    --cleanup          Clean up old export files only

DESCRIPTION:
    This script automates the complete data collection process:
    1. Runs all scrapers locally with optimal performance
    2. Exports data to SQL format
    3. Uploads data to the production server
    4. Cleans up old export files

REQUIREMENTS:
    - Bun runtime installed
    - PostgreSQL client tools (pg_dump)
    - SSH access to server (root@138.197.180.107)
    - Local PostgreSQL database running

EXAMPLES:
    ./run-scrapers-and-upload.sh                 # Full automation
    ./run-scrapers-and-upload.sh --scrapers-only # Run scrapers only
    ./run-scrapers-and-upload.sh --upload-only   # Upload latest data only
    ./run-scrapers-and-upload.sh --dry-run       # Check prerequisites

LOG FILE:
    All operations are logged to: scraping-automation.log

EOF
}

# Handle command line arguments
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --dry-run)
        log "INFO" "Dry run mode - checking prerequisites only"
        check_prerequisites
        log "INFO" "Dry run completed successfully"
        exit 0
        ;;
    --scrapers-only)
        log "INFO" "Scrapers-only mode"
        check_prerequisites
        run_scrapers
        cleanup_exports
        log "INFO" "Scrapers-only execution completed"
        exit 0
        ;;
    --upload-only)
        log "INFO" "Upload-only mode"
        check_prerequisites
        upload_to_server
        log "INFO" "Upload-only execution completed"
        exit 0
        ;;
    --cleanup)
        log "INFO" "Cleanup-only mode"
        cleanup_exports
        log "INFO" "Cleanup completed"
        exit 0
        ;;
    "")
        # No arguments - run full automation
        main
        ;;
    *)
        log "ERROR" "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac