# Deployment Guide

This guide covers the manual deployment process for AmexingWeb to staging and production environments.

## 📋 Table of Contents

- [Environments Overview](#-environments-overview)
- [Deploy to Staging](#-deploy-to-staging-manual)
- [Deploy to Production](#-deploy-to-production-manual)
- [Rollback Procedure](#-rollback-procedure)
- [Environment Setup](#-environment-setup)
- [Security Checklist](#-security-checklist-pci-dss)
- [Web Server Setup](#-web-server-setup)
- [Health Monitoring](#-health-monitoring)

## 🌍 Environments Overview

| Environment | Branch Source | Port | Database | Deploy Method |
|-------------|---------------|------|----------|---------------|
| **Development** | `development` | 1337 | AmexingDEV | Local (`yarn dev`) |
| **Staging** | `release-x.y.z` | 1338 | AmexingSTAGING | **Manual** (SSH + PM2) |
| **Production** | `main` (tagged) | 1337 | AmexingPROD | **Manual** (SSH + PM2) |

### Environment Purpose

- **Development**: Local development, rapid iteration, hot-reload
- **Staging**: Pre-production testing, QA validation, integration testing
- **Production**: Live application serving real users

## 🚧 Deploy to Staging (Manual)

**When**: After creating `release-x.y.z` branch from `development`

**Purpose**: Test the release candidate before production deployment

### Prerequisites

- ✅ Release branch created: `release-x.y.z`
- ✅ Version bumped in `package.json`
- ✅ CHANGELOG generated
- ✅ All tests passing locally
- ✅ Security scans passed

### Step-by-Step Process

#### 1. Connect to Staging Server

```bash
# SSH into staging server
ssh user@staging-server

# Navigate to application directory
cd /path/to/amexing-web
```

#### 2. Fetch and Checkout Release Branch

```bash
# Fetch latest changes
git fetch origin

# Checkout the release branch
git checkout release-x.y.z

# Pull latest commits
git pull origin release-x.y.z

# Verify branch and commit
git branch --show-current  # Should show: release-x.y.z
git log -1 --oneline       # Verify latest commit
```

#### 3. Install Dependencies

```bash
# Install/update dependencies
yarn install

# Verify installation
yarn --version
node --version  # Should be 20+
```

#### 4. Run Database Migrations

```bash
# Dry-run to preview migrations
yarn migrate:dry-run

# Check current migration status
yarn migrate:status

# Run migrations
NODE_ENV=staging yarn migrate

# Verify migration success
yarn migrate:status
```

#### 5. Run Seeds (Optional for Staging)

```bash
# Check seed status
yarn seed:status

# Run seeds if needed (staging can have test data)
NODE_ENV=staging yarn seed

# Or run specific seeds
NODE_ENV=staging node scripts/global/seeds/seed-runner.js
```

#### 6. Restart Application

```bash
# Stop current instance
yarn pm2:stop

# Start with staging configuration
yarn pm2:staging

# Or using PM2 directly
pm2 restart amexing-web --env staging

# View logs
pm2 logs amexing-web --lines 50
```

#### 7. Verify Deployment

```bash
# Check health endpoint
curl http://localhost:1338/health

# Expected response:
# {
#   "status": "healthy",
#   "version": "0.6.0",
#   "timestamp": "..."
# }

# Check metrics
curl http://localhost:1338/metrics

# Check application is responding
curl http://localhost:1338/

# View real-time logs
pm2 logs amexing-web
```

#### 8. Testing on Staging

**Manual Tests**:
- ✅ Login with test users
- ✅ Test new features
- ✅ Verify API endpoints
- ✅ Check database connections
- ✅ Test file uploads if applicable

**Automated Tests** (optional on staging):
```bash
# Run integration tests against staging
NODE_ENV=staging yarn test:integration

# Run smoke tests
curl http://localhost:1338/api/health
```

### Staging Deployment Checklist

- [ ] Release branch checked out successfully
- [ ] Dependencies installed
- [ ] Migrations executed successfully
- [ ] Seeds executed (if needed)
- [ ] PM2 restarted successfully
- [ ] Health endpoint returns 200 OK
- [ ] Application logs show no errors
- [ ] Manual testing passed
- [ ] QA sign-off received

### Troubleshooting Staging

**Problem**: Port 1338 already in use
```bash
# Find process using port
lsof -i :1338

# Kill process if needed
kill -9 <PID>

# Or stop PM2 first
pm2 stop all
pm2 start amexing-web --env staging
```

**Problem**: Database connection failed
```bash
# Check MongoDB is running
sudo systemctl status mongod

# Verify DATABASE_URI in .env.staging
cat environments/.env.staging | grep DATABASE_URI

# Test connection
mongosh $DATABASE_URI
```

**Problem**: Migrations failed
```bash
# Check migration status
yarn migrate:status

# Rollback last migration if needed
yarn migrate:rollback

# Re-run migrations
yarn migrate
```

## 🚀 Deploy to Production (Manual)

**When**: After successful staging testing and QA approval

**Purpose**: Deploy stable, tested code to production

### Prerequisites

- ✅ Staging testing completed successfully
- ✅ QA approval received
- ✅ PR `release-x.y.z` → `main` merged
- ✅ Tag created on `main` (e.g., `v0.6.0`)
- ✅ CHANGELOG updated
- ✅ Release notes prepared
- ✅ Backup plan in place

### Step-by-Step Process

#### 1. Pre-Deployment Preparation

```bash
# On your local machine:

# Ensure main is up to date
git checkout main
git pull origin main

# Verify tag exists
git tag -l | grep v0.6.0

# If tag doesn't exist, create it
git tag -a v0.6.0 -m "Release v0.6.0

Features:
- Feature A
- Feature B

Fixes:
- Bug C

See CHANGELOG.md for details"

git push origin v0.6.0
```

#### 2. Connect to Production Server

```bash
# SSH into production server
ssh user@production-server

# Navigate to application directory
cd /path/to/amexing-web
```

#### 3. Backup Current State

```bash
# Create backup tag (timestamped)
git tag "backup-$(date +%Y%m%d-%H%M%S)"

# Backup database (if not using automated backups)
mongodump --uri="$DATABASE_URI" --out="/backups/$(date +%Y%m%d)"

# Verify backup
ls -lh /backups/$(date +%Y%m%d)
```

#### 4. Fetch and Checkout Main

```bash
# Fetch latest changes
git fetch origin --tags

# Checkout main branch
git checkout main

# Pull latest code
git pull origin main

# Verify tag
git describe --tags  # Should show v0.6.0

# Double-check commit
git log -1 --oneline
```

#### 5. Install Dependencies

```bash
# Install production dependencies only
yarn install --production=false

# Verify no vulnerabilities
yarn audit

# Clean cache if needed
yarn cache clean
```

#### 6. Run Database Migrations (CRITICAL)

```bash
# IMPORTANT: Preview migrations FIRST
yarn migrate:dry-run

# Review output carefully - migrations are irreversible

# Check current status
yarn migrate:status

# If dry-run looks good, run migrations
NODE_ENV=production yarn migrate

# Verify success
yarn migrate:status
```

**⚠️ WARNING**: Migrations in production are IRREVERSIBLE. Always:
- Review `yarn migrate:dry-run` output
- Have database backup
- Test migrations on staging first
- Have rollback plan ready

#### 7. Run Seeds (Usually NOT for Production)

```bash
# ⚠️ CAUTION: Seeds should only run on FIRST deployment
# Production data is real - don't overwrite it

# Check if this is first deployment
yarn seed:status

# Only if AmexingPROD is empty:
NODE_ENV=production yarn seed

# This creates:
# - RBAC roles and permissions
# - SuperAdmin user (from env vars)
# - Initial system data
```

#### 8. Restart Application

```bash
# Stop current instance gracefully
yarn pm2:stop

# Or using PM2 directly
pm2 stop amexing-web

# Wait for graceful shutdown (30 seconds)
sleep 30

# Start production instance
yarn prod

# Or using PM2 directly
pm2 start amexing-web --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script (first time only)
pm2 startup
```

#### 9. Verify Deployment

```bash
# Health check
curl http://localhost:1337/health

# Expected response:
# {
#   "status": "healthy",
#   "version": "0.6.0",
#   "environment": "production",
#   "timestamp": "..."
# }

# Check metrics
curl http://localhost:1337/metrics

# Test main page
curl http://localhost:1337/

# Monitor logs for errors
pm2 logs amexing-web --lines 100

# Check for errors
pm2 logs amexing-web --err

# Monitor in real-time
pm2 monit
```

#### 10. Post-Deployment Validation

**Critical Endpoints**:
```bash
# Authentication
curl -X POST http://localhost:1337/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# API Health
curl http://localhost:1337/api/health

# Database connectivity
curl http://localhost:1337/health
```

**Application Tests**:
- ✅ Login works for all user types
- ✅ Critical features functional
- ✅ Database queries responding
- ✅ File uploads working (if applicable)
- ✅ API endpoints responding
- ✅ No errors in logs

#### 11. Notify Team

```bash
# Send deployment notification
# - Version deployed: v0.6.0
# - Deployment time: [timestamp]
# - Deployed by: [your name]
# - Status: Success / Issues
# - Key changes: [link to CHANGELOG]
```

#### 12. Sync Development Branch

```bash
# On your local machine:

# Update development with production changes
git checkout development
git merge main
git push origin development
```

### Production Deployment Checklist

**Pre-Deployment**:
- [ ] Staging testing completed
- [ ] QA approval received
- [ ] PR merged to main
- [ ] Tag created (v0.x.x)
- [ ] CHANGELOG updated
- [ ] Team notified of upcoming deployment
- [ ] Maintenance window scheduled (if needed)

**During Deployment**:
- [ ] Backup created
- [ ] Main branch checked out
- [ ] Dependencies installed
- [ ] Migrations previewed with dry-run
- [ ] Migrations executed successfully
- [ ] PM2 restarted successfully
- [ ] Health endpoint returns 200 OK
- [ ] No errors in PM2 logs

**Post-Deployment**:
- [ ] Critical endpoints tested
- [ ] Application responding correctly
- [ ] No errors in logs
- [ ] Monitoring systems updated
- [ ] Team notified of completion
- [ ] Development branch synced

### Troubleshooting Production

**Problem**: Application won't start
```bash
# Check PM2 status
pm2 status

# Check logs for errors
pm2 logs amexing-web --err

# Try starting manually
NODE_ENV=production node src/index.js

# Check port availability
lsof -i :1337
```

**Problem**: Database migrations failed
```bash
# Check migration status
yarn migrate:status

# Review migration logs
cat logs/migration-$(date +%Y-%m-%d).log

# If safe, rollback
yarn migrate:rollback

# Fix issue and retry
yarn migrate
```

**Problem**: Performance degradation
```bash
# Check system resources
htop

# Check PM2 metrics
pm2 monit

# Check database performance
mongosh $DATABASE_URI --eval "db.serverStatus()"

# Restart PM2 with more instances
pm2 scale amexing-web 4  # Scale to 4 instances
```

## 🔄 Rollback Procedure

### When to Rollback

Rollback if:
- ❌ Critical bugs discovered in production
- ❌ Performance significantly degraded
- ❌ Data integrity issues
- ❌ Security vulnerabilities introduced

### Quick Rollback (Previous Tag)

```bash
# On production server:

# Stop current application
pm2 stop amexing-web

# Checkout previous tag
git fetch --tags
git checkout v0.5.0  # Previous stable version

# Reinstall dependencies
yarn install --production=false

# Rollback migrations (if needed)
yarn migrate:rollback

# Restart application
pm2 restart amexing-web --env production

# Verify
curl http://localhost:1337/health
pm2 logs amexing-web
```

### Full Rollback (With Database)

```bash
# Stop application
pm2 stop amexing-web

# Restore database backup
mongorestore --uri="$DATABASE_URI" --drop /backups/20250128

# Checkout previous code
git checkout v0.5.0

# Install dependencies
yarn install --production=false

# Restart application
pm2 restart amexing-web --env production

# Verify health
curl http://localhost:1337/health
```

### Post-Rollback Actions

1. **Investigate issue**: Analyze logs to understand what failed
2. **Document incident**: Create post-mortem document
3. **Fix in development**: Address root cause
4. **Test fix**: Validate fix in staging
5. **Plan redeployment**: Schedule new deployment

## 🚀 Production Deployment

### Quick Production Start

```bash
# Production with PM2
yarn prod

# Monitor processes
yarn pm2:logs
yarn pm2:restart
yarn pm2:stop
```

### Environment Setup

1. **Create production `.env`**:
```bash
cp .env.example .env.production
```

2. **Configure production variables**:
```env
NODE_ENV=production
PORT=1337
DATABASE_URI=mongodb://your-production-db/amexingdb
PARSE_APP_ID=your-production-app-id
PARSE_MASTER_KEY=your-production-master-key
PARSE_SERVER_URL=https://yourdomain.com/parse
```

3. **Security configuration** (PCI DSS Required):
```env
ENABLE_AUDIT_LOGGING=true
LOG_LEVEL=info
SESSION_SECRET=your-secure-session-secret
```

## 🔒 Security Checklist (PCI DSS)

Before production deployment:

- [ ] All environment variables configured
- [ ] No hardcoded secrets in code
- [ ] HTTPS enforced with valid SSL certificate
- [ ] Firewall configured (UFW recommended)
- [ ] Database secured with authentication
- [ ] Audit logging enabled
- [ ] Security monitoring active

## 🌐 Web Server Setup

### Nginx Configuration (Recommended)

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;

    # Allow upload of large files (up to 250MB)
    client_max_body_size 250m;

    # Increase timeouts for large file uploads
    client_body_timeout 300s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://localhost:1337;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📊 Health Monitoring

```bash
# Health check endpoint
curl https://yourdomain.com/health

# PM2 monitoring
pm2 monit

# Application logs
tail -f logs/application-$(date +%Y-%m-%d).log
```

## 🔄 Deployment Process

1. **Prepare code**:
```bash
git pull origin main
yarn install --production
```

2. **Run security checks**:
```bash
yarn security:all
yarn test
```

3. **Deploy**:
```bash
yarn prod
```

4. **Verify deployment**:
```bash
curl https://yourdomain.com/health
```

## 🆘 Rollback Procedure

```bash
# Stop current deployment
yarn pm2:stop

# Rollback to previous version
git checkout previous-version-tag
yarn install --production
yarn prod

# Verify rollback
curl https://yourdomain.com/health
```

## 📱 Environment Variables Reference

For complete environment configuration, see: [ENVIRONMENT.md](./ENVIRONMENT.md)