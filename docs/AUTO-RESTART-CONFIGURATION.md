# Auto-Restart & High Availability Configuration

**Date:** 2025-10-22
**Environment:** Production
**Server:** amexing.meeplab.com

## Overview

This document describes the multi-layered auto-restart and high availability configuration implemented for the Amexing production server.

## Architecture

The server uses a **three-tier resilience strategy**:

1. **PM2 Process Manager** - Primary process management and auto-restart
2. **Systemd Service** - System-level auto-start on server reboot
3. **Cron Health Checks** - Periodic monitoring and recovery

---

## Tier 1: PM2 Process Manager

### Configuration
- **Process Name:** `amexing-api`
- **Mode:** Fork (production)
- **Port:** 1338
- **Config File:** `.config/pm2/ecosystem.config.js`

### Features
- Automatic restart on crash
- Memory limit monitoring (1GB max)
- Graceful shutdown
- Log management
- Cluster mode support

### Commands
```bash
# View status
pm2 status

# View logs
pm2 logs amexing-api

# Restart manually
pm2 restart amexing-api

# Stop server
pm2 stop amexing-api

# Start server
pm2 start .config/pm2/ecosystem.config.js --env production --only amexing-api

# Save current process list
pm2 save

# Monitor real-time
pm2 monit
```

### PM2 Configuration Details
```javascript
{
  name: 'amexing-api',
  script: './src/index.js',
  instances: 1,
  exec_mode: 'fork',
  env_production: {
    NODE_ENV: 'production',
    PORT: 1338,
  },
  autorestart: true,
  max_restarts: 10,
  min_uptime: '10s',
  max_memory_restart: '1G',
}
```

---

## Tier 2: Systemd Service

### Configuration
- **Service Name:** `pm2-ubuntu.service`
- **Service File:** `/etc/systemd/system/pm2-ubuntu.service`
- **Status:** ✅ Enabled
- **Auto-start:** On system boot

### What It Does
- Automatically starts PM2 daemon on server boot/reboot
- Resurrects saved PM2 process list
- Ensures processes survive system restarts

### Commands
```bash
# Check service status
systemctl status pm2-ubuntu

# Check if enabled
systemctl is-enabled pm2-ubuntu

# View service logs
journalctl -u pm2-ubuntu

# Restart service (if needed)
sudo systemctl restart pm2-ubuntu

# Disable service (not recommended)
sudo systemctl disable pm2-ubuntu
```

### How to Update Systemd Configuration
If you need to reconfigure the systemd service:
```bash
pm2 save
pm2 unstartup systemd
pm2 startup systemd
sudo <command provided by PM2>
pm2 save
```

---

## Tier 3: Cron Health Checks

### Health Check Script
- **Location:** `/home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh`
- **Runs:** Every 5 minutes
- **Log File:** `.runtime/logs/health-check.log`

### What It Monitors
1. **PM2 Daemon Status** - Ensures PM2 is running
2. **Application Status** - Verifies amexing-api is online
3. **Memory Usage** - Restarts if memory exceeds 1GB
4. **Auto-Recovery** - Attempts multiple recovery strategies

### Recovery Strategies
1. **Level 1:** Restart the application via PM2
2. **Level 2:** Resurrect PM2 daemon if down
3. **Level 3:** Start from ecosystem config file

### Notifications
The script logs all events to:
- `health-check.log` - All health check events
- `cron.log` - Cron execution logs

To add email/Slack notifications, edit the `send_notification()` function in the script.

---

## Crontab Schedule

### Current Cron Jobs

```bash
# View all cron jobs
crontab -l
```

#### Active Jobs:

1. **Health Check (Every 5 minutes)**
   ```
   */5 * * * * /home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh
   ```

2. **PM2 Resurrection (@reboot)**
   ```
   @reboot sleep 30 && pm2 resurrect
   ```

3. **PM2 State Save (Every hour)**
   ```
   0 * * * * pm2 save
   ```

4. **Log Cleanup (Daily at 2 AM)**
   ```
   0 2 * * * find logs -name "*.log" -mtime +7 -delete
   ```

5. **Disk Space Monitor (Every 30 minutes)**
   ```
   */30 * * * * df -h / | awk 'NR==2 {if (int($5) > 80) print "WARNING"}'
   ```

### Viewing Cron Logs
```bash
# Health check log
tail -f /home/ubuntu/Amexing/amexing-web/.runtime/logs/health-check.log

# Cron execution log
tail -f /home/ubuntu/Amexing/amexing-web/.runtime/logs/cron.log

# PM2 resurrect log
tail -f /home/ubuntu/Amexing/amexing-web/.runtime/logs/pm2-resurrect.log
```

---

## Testing the Configuration

### Test 1: Application Crash Recovery
```bash
# Simulate crash by killing the process
pm2 stop amexing-api

# Wait 5 minutes for cron to detect and restart
# Or manually run the health check
/home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Verify recovery
pm2 status
```

### Test 2: PM2 Daemon Crash
```bash
# Kill PM2 daemon
pm2 kill

# Wait 5 minutes for cron to detect and restart
# Or manually run the health check
/home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Verify recovery
pm2 status
```

### Test 3: Server Reboot
```bash
# Reboot the server
sudo reboot

# After reboot, verify auto-start
pm2 status

# Check logs
tail -f /home/ubuntu/Amexing/amexing-web/.runtime/logs/pm2-resurrect.log
```

---

## Monitoring & Alerts

### Real-Time Monitoring
```bash
# PM2 dashboard
pm2 monit

# Application logs
pm2 logs amexing-api --lines 100

# System resource usage
htop
```

### Health Check Logs
```bash
# View health check activity
tail -f .runtime/logs/health-check.log

# View cron execution
tail -f .runtime/logs/cron.log

# Search for issues
grep "ERROR\|WARNING" .runtime/logs/health-check.log
```

### Log Files Location
```
/home/ubuntu/Amexing/amexing-web/
├── logs/                                    # PM2 logs
│   ├── pm2-error.log
│   ├── pm2-out.log
│   └── pm2-combined.log
└── .runtime/logs/                           # Application logs
    ├── health-check.log                     # Health check events
    ├── cron.log                             # Cron execution
    ├── pm2-resurrect.log                    # Reboot recovery
    ├── application-YYYY-MM-DD.log           # App logs (daily)
    └── audit-YYYY-MM-DD.log                 # Audit trail
```

---

## Maintenance

### Updating the Health Check Script
```bash
# Edit the script
nano /home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Make it executable (if needed)
chmod +x /home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Test the changes
/home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Check logs for any errors
tail -f .runtime/logs/health-check.log
```

### Updating Crontab
```bash
# Edit crontab
crontab -e

# Or create a new crontab file and install it
nano /tmp/new-crontab.txt
crontab /tmp/new-crontab.txt

# Verify changes
crontab -l
```

### Cleaning Old Logs
```bash
# Manual cleanup of old logs
find logs -name "*.log" -mtime +7 -delete
find .runtime/logs -name "*.log" -mtime +30 -delete

# View disk usage
du -h logs/
du -h .runtime/logs/
```

---

## Troubleshooting

### Issue: PM2 not starting on reboot

**Solution:**
```bash
# Reinstall systemd service
pm2 save
pm2 unstartup systemd
pm2 startup systemd
sudo <command provided>
pm2 save

# Verify
systemctl is-enabled pm2-ubuntu
```

### Issue: Health check not running

**Solution:**
```bash
# Verify crontab is installed
crontab -l

# Check cron service is running
systemctl status cron

# Test health check manually
/home/ubuntu/Amexing/amexing-web/scripts/server-health-check.sh

# Check cron logs
tail -f .runtime/logs/cron.log
```

### Issue: Application not restarting

**Solution:**
```bash
# Check PM2 status
pm2 status

# Check health check logs
tail -100 .runtime/logs/health-check.log

# Manually restart
pm2 restart amexing-api

# If that fails, start from config
pm2 delete amexing-api
pm2 start .config/pm2/ecosystem.config.js --env production --only amexing-api
pm2 save
```

### Issue: High memory usage

The health check automatically restarts the server if memory exceeds 1GB. To adjust this threshold:

```bash
# Edit the script
nano scripts/server-health-check.sh

# Find this line and change 1024 (MB):
if [ "$MEM_USAGE_MB" -gt 1024 ]; then
```

---

## Security Considerations

1. **Log Rotation** - Logs are automatically cleaned after 7-30 days
2. **Process Limits** - PM2 limits maximum restarts to prevent restart loops
3. **Graceful Shutdown** - PM2 allows 5 seconds for graceful shutdown
4. **Memory Limits** - Automatic restart if memory exceeds 1GB

---

## Summary

✅ **PM2 Process Manager** - Immediate crash recovery
✅ **Systemd Service** - Auto-start on server reboot
✅ **Cron Health Checks** - Periodic monitoring every 5 minutes
✅ **Log Management** - Automatic cleanup of old logs
✅ **Memory Monitoring** - Auto-restart on high memory usage
✅ **Disk Monitoring** - Alerts when disk exceeds 80%

The server now has **enterprise-grade resilience** with multiple layers of redundancy.

---

## Additional Resources

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Systemd Service Documentation](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Cron Documentation](https://man7.org/linux/man-pages/man5/crontab.5.html)

---

**Last Updated:** 2025-10-22
**Maintained By:** Amexing DevOps Team
