#!/bin/bash

# Pharma Search - Cron Job Setup Script
# This script helps set up automated cron jobs for scraping

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_SCRIPT="$SCRIPT_DIR/run-scrapers-and-upload.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    
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
        "SUCCESS")
            echo -e "${CYAN}[SUCCESS]${NC} $message"
            ;;
    esac
}

# Function to display header
show_header() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    Pharma Search Cron Setup                  ║${NC}"
    echo -e "${BLUE}║              Automated Scheduling Configuration             ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Function to check prerequisites
check_prerequisites() {
    log "STEP" "Checking prerequisites..."
    
    # Check if automation script exists
    if [[ ! -f "$AUTOMATION_SCRIPT" ]]; then
        log "ERROR" "Automation script not found: $AUTOMATION_SCRIPT"
        exit 1
    fi
    
    # Check if automation script is executable
    if [[ ! -x "$AUTOMATION_SCRIPT" ]]; then
        log "WARN" "Automation script is not executable, fixing..."
        chmod +x "$AUTOMATION_SCRIPT"
    fi
    
    # Check if cron is available
    if ! command -v crontab &> /dev/null; then
        log "ERROR" "crontab is not available on this system"
        exit 1
    fi
    
    log "INFO" "Prerequisites check completed"
}

# Function to show current cron jobs
show_current_cron() {
    log "STEP" "Current cron jobs:"
    echo ""
    
    if crontab -l &>/dev/null; then
        echo -e "${CYAN}Current crontab:${NC}"
        crontab -l | sed 's/^/  /'
    else
        echo -e "${YELLOW}No cron jobs currently configured${NC}"
    fi
    echo ""
}

# Function to add cron job
add_cron_job() {
    local schedule=$1
    local job_description=$2
    
    log "STEP" "Adding cron job..."
    
    # Create the cron job command
    local cron_command="cd $SCRIPT_DIR && ./run-scrapers-and-upload.sh >> $SCRIPT_DIR/cron.log 2>&1"
    local cron_entry="$schedule $cron_command"
    
    # Get current crontab or create empty one
    local temp_cron="/tmp/pharma_cron_$$"
    crontab -l &>/dev/null > "$temp_cron" || touch "$temp_cron"
    
    # Check if our job already exists
    if grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" &>/dev/null; then
        log "WARN" "A pharma search cron job already exists"
        echo ""
        echo "Existing job:"
        grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" | sed 's/^/  /'
        echo ""
        
        read -p "Do you want to replace it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "INFO" "Cron job setup cancelled"
            rm -f "$temp_cron"
            return
        fi
        
        # Remove existing pharma search jobs
        grep -v -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" > "${temp_cron}.new" || touch "${temp_cron}.new"
        mv "${temp_cron}.new" "$temp_cron"
    fi
    
    # Add comment and new job
    echo "" >> "$temp_cron"
    echo "# Pharma Search - $job_description" >> "$temp_cron"
    echo "$cron_entry" >> "$temp_cron"
    
    # Install new crontab
    if crontab "$temp_cron"; then
        log "SUCCESS" "Cron job added successfully!"
        log "INFO" "Schedule: $job_description"
        log "INFO" "Command: $cron_command"
    else
        log "ERROR" "Failed to install cron job"
        rm -f "$temp_cron"
        return 1
    fi
    
    # Cleanup
    rm -f "$temp_cron"
}

# Function to remove cron jobs
remove_cron_jobs() {
    log "STEP" "Removing pharma search cron jobs..."
    
    # Get current crontab
    local temp_cron="/tmp/pharma_cron_$$"
    if ! crontab -l &>/dev/null > "$temp_cron"; then
        log "INFO" "No cron jobs to remove"
        return
    fi
    
    # Check if our jobs exist
    if ! grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" &>/dev/null; then
        log "INFO" "No pharma search cron jobs found"
        rm -f "$temp_cron"
        return
    fi
    
    # Show what will be removed
    echo ""
    echo "Jobs to be removed:"
    grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" | sed 's/^/  /'
    echo ""
    
    read -p "Are you sure you want to remove these jobs? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "INFO" "Removal cancelled"
        rm -f "$temp_cron"
        return
    fi
    
    # Remove pharma search jobs and their comments
    grep -v -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" "$temp_cron" | \
    grep -v "^# Pharma Search -" > "${temp_cron}.new" || touch "${temp_cron}.new"
    
    # Install new crontab
    if crontab "${temp_cron}.new"; then
        log "SUCCESS" "Pharma search cron jobs removed successfully!"
    else
        log "ERROR" "Failed to remove cron jobs"
    fi
    
    # Cleanup
    rm -f "$temp_cron" "${temp_cron}.new"
}

# Function to show schedule options
show_schedule_menu() {
    echo ""
    echo -e "${CYAN}Available Schedule Options:${NC}"
    echo ""
    echo "  1) Daily at 2:00 AM          (Recommended)"
    echo "  2) Daily at 6:00 AM"
    echo "  3) Every 12 hours (2 AM & 2 PM)"
    echo "  4) Every 6 hours"
    echo "  5) Weekly (Sunday 2:00 AM)"
    echo "  6) Custom schedule"
    echo ""
}

# Function to get schedule from user selection
get_schedule() {
    local choice=$1
    
    case $choice in
        1)
            echo "0 2 * * *"
            echo "Daily at 2:00 AM"
            ;;
        2)
            echo "0 6 * * *"
            echo "Daily at 6:00 AM"
            ;;
        3)
            echo "0 2,14 * * *"
            echo "Every 12 hours (2:00 AM & 2:00 PM)"
            ;;
        4)
            echo "0 */6 * * *"
            echo "Every 6 hours"
            ;;
        5)
            echo "0 2 * * 0"
            echo "Weekly on Sunday at 2:00 AM"
            ;;
        6)
            echo ""
            echo -e "${YELLOW}Custom cron schedule format: minute hour day month weekday${NC}"
            echo "Examples:"
            echo "  0 2 * * *     = Daily at 2:00 AM"
            echo "  30 14 * * 5   = Every Friday at 2:30 PM"
            echo "  0 */4 * * *   = Every 4 hours"
            echo ""
            read -p "Enter custom schedule: " custom_schedule
            echo "$custom_schedule"
            echo "Custom schedule: $custom_schedule"
            ;;
        *)
            log "ERROR" "Invalid choice"
            return 1
            ;;
    esac
}

# Function to interactive setup
interactive_setup() {
    log "STEP" "Interactive cron job setup"
    
    show_schedule_menu
    read -p "Select schedule option (1-6): " -n 1 -r choice
    echo
    echo
    
    local schedule_info
    schedule_info=$(get_schedule "$choice")
    
    if [[ $? -ne 0 ]] || [[ -z "$schedule_info" ]]; then
        log "ERROR" "Invalid schedule selection"
        return 1
    fi
    
    local schedule=$(echo "$schedule_info" | head -1)
    local description=$(echo "$schedule_info" | tail -1)
    
    if [[ -z "$schedule" ]]; then
        log "ERROR" "Empty schedule"
        return 1
    fi
    
    log "INFO" "Selected schedule: $description"
    log "INFO" "Cron expression: $schedule"
    echo ""
    
    read -p "Proceed with this schedule? (Y/n): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log "INFO" "Setup cancelled"
        return
    fi
    
    add_cron_job "$schedule" "$description"
}

# Function to show help
show_help() {
    cat << EOF
Pharma Search - Cron Job Setup Script

USAGE:
    ./setup-cron.sh [COMMAND] [OPTIONS]

COMMANDS:
    setup, add          Set up a new cron job (interactive)
    remove, delete      Remove all pharma search cron jobs
    list, show          Show current cron jobs
    quick-daily         Quick setup for daily at 2 AM (recommended)
    help                Show this help message

QUICK SETUPS:
    ./setup-cron.sh quick-daily     # Set up daily at 2:00 AM

EXAMPLES:
    ./setup-cron.sh setup           # Interactive setup
    ./setup-cron.sh quick-daily     # Quick daily setup
    ./setup-cron.sh list            # Show current jobs
    ./setup-cron.sh remove          # Remove all pharma jobs

NOTES:
    - Cron jobs will log to: cron.log
    - The automation script will log to: scraping-automation.log
    - Jobs run in the background and won't interrupt your work
    - You can monitor progress by checking the log files

SCHEDULING RECOMMENDATIONS:
    - Daily at 2:00 AM: Recommended for most users
    - Every 12 hours: For high-frequency updates
    - Weekly: For lower resource usage

LOG FILES:
    - Cron execution: cron.log
    - Detailed scraping: scraping-automation.log

EOF
}

# Function to quick setup daily
quick_daily_setup() {
    log "INFO" "Setting up daily cron job at 2:00 AM (recommended)"
    add_cron_job "0 2 * * *" "Daily at 2:00 AM"
}

# Function to test cron setup
test_cron_setup() {
    log "STEP" "Testing cron job setup..."
    
    # Check if job exists in crontab
    if crontab -l | grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" &>/dev/null; then
        log "SUCCESS" "Cron job is properly configured"
        
        # Show next run time (approximate)
        local next_run
        next_run=$(crontab -l | grep -F "$SCRIPT_DIR/run-scrapers-and-upload.sh" | head -1 | awk '{print $1, $2, $3, $4, $5}')
        log "INFO" "Schedule: $next_run"
        
        # Suggest testing
        echo ""
        log "INFO" "To test the setup manually, run:"
        echo "  ./run-scrapers-and-upload.sh --dry-run"
        echo ""
        log "INFO" "To monitor cron execution, check:"
        echo "  tail -f cron.log"
        
    else
        log "WARN" "No cron job found"
    fi
}

# Main function
main() {
    show_header
    check_prerequisites
    
    case "${1:-setup}" in
        setup|add)
            show_current_cron
            interactive_setup
            test_cron_setup
            ;;
        remove|delete)
            show_current_cron
            remove_cron_jobs
            ;;
        list|show)
            show_current_cron
            ;;
        quick-daily)
            show_current_cron
            quick_daily_setup
            test_cron_setup
            ;;
        test)
            test_cron_setup
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log "ERROR" "Unknown command: $1"
            echo ""
            echo "Use './setup-cron.sh help' for usage information"
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"