# Deployment Guide

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