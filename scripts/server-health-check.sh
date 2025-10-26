#!/bin/bash
###############################################################################
# Amexing Server Health Check & Auto-Restart Script
#
# Purpose: Monitors PM2 and amexing-api process, restarting if needed
# Usage: Run via crontab every 5 minutes
# Author: Amexing DevOps Team
# Version: 1.0.0
###############################################################################

# Configuration
PROJECT_DIR="/home/ubuntu/Amexing/amexing-web"
LOG_FILE="$PROJECT_DIR/.runtime/logs/health-check.log"
PM2_PATH="/home/ubuntu/.nvm/versions/node/v24.7.0/bin/pm2"
NODE_PATH="/home/ubuntu/.nvm/versions/node/v24.7.0/bin/node"
NVM_DIR="/home/ubuntu/.nvm"

# Ensure log directory exists
mkdir -p "$PROJECT_DIR/.runtime/logs"

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Function to send notification (optional - can be extended for email/slack)
send_notification() {
    log_message "ALERT: $1"
    # TODO: Add email or Slack notification if needed
}

# Load NVM environment
export NVM_DIR="$NVM_DIR"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Change to project directory
cd "$PROJECT_DIR" || {
    log_message "ERROR: Cannot change to project directory $PROJECT_DIR"
    exit 1
}

# Check if PM2 daemon is running
if ! pgrep -f "PM2" > /dev/null; then
    log_message "WARNING: PM2 daemon not running, attempting to resurrect..."
    send_notification "PM2 daemon was down, attempting to restart"

    # Try to resurrect PM2
    $PM2_PATH resurrect >> "$LOG_FILE" 2>&1

    if [ $? -eq 0 ]; then
        log_message "SUCCESS: PM2 daemon resurrected successfully"
    else
        log_message "ERROR: Failed to resurrect PM2 daemon"
        send_notification "CRITICAL: Failed to resurrect PM2 daemon"
        exit 1
    fi

    sleep 5
fi

# Check if amexing-api is running
API_STATUS=$($PM2_PATH list | grep "amexing-api" | grep -c "online")

if [ "$API_STATUS" -eq 0 ]; then
    log_message "WARNING: amexing-api is not online, attempting to restart..."
    send_notification "amexing-api was down, attempting to restart"

    # Try to restart the application
    $PM2_PATH restart amexing-api >> "$LOG_FILE" 2>&1

    if [ $? -eq 0 ]; then
        sleep 5
        # Verify it's actually running
        API_STATUS_AFTER=$($PM2_PATH list | grep "amexing-api" | grep -c "online")

        if [ "$API_STATUS_AFTER" -gt 0 ]; then
            log_message "SUCCESS: amexing-api restarted successfully"
            send_notification "amexing-api has been restarted and is now online"
        else
            log_message "ERROR: amexing-api restart failed or not online after restart"
            send_notification "CRITICAL: amexing-api restart failed"
            exit 1
        fi
    else
        log_message "ERROR: Failed to restart amexing-api"
        send_notification "CRITICAL: Failed to restart amexing-api"

        # Last resort: try to start from ecosystem config
        log_message "RECOVERY: Attempting to start from ecosystem config..."
        $PM2_PATH start "$PROJECT_DIR/.config/pm2/ecosystem.config.js" --env production --only amexing-api >> "$LOG_FILE" 2>&1

        if [ $? -eq 0 ]; then
            log_message "RECOVERY SUCCESS: Started from ecosystem config"
        else
            log_message "RECOVERY FAILED: Could not start from ecosystem config"
            exit 1
        fi
    fi
else
    # Server is running, just log a heartbeat every hour
    CURRENT_MINUTE=$(date '+%M')
    if [ "$CURRENT_MINUTE" == "00" ]; then
        log_message "HEARTBEAT: amexing-api is running normally"
    fi
fi

# Check memory usage and restart if too high (>1GB)
# Get memory usage in MB from pm2 status
MEM_USAGE_MB=$($PM2_PATH describe amexing-api 2>/dev/null | grep -A 1 "memory" | tail -1 | grep -oE '[0-9]+' | head -1)
if [ -n "$MEM_USAGE_MB" ] && [ "$MEM_USAGE_MB" -gt 1024 ]; then
    log_message "WARNING: High memory usage detected: ${MEM_USAGE_MB}MB, restarting..."
    $PM2_PATH restart amexing-api >> "$LOG_FILE" 2>&1
    log_message "Memory optimization restart completed"
fi

# Rotate log file if it gets too large (>10MB)
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt 10485760 ]; then
        mv "$LOG_FILE" "$LOG_FILE.old"
        log_message "Log file rotated due to size"
    fi
fi

exit 0
