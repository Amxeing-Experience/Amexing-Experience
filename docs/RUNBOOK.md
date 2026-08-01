# Amexing Experience - Operations Runbook

## 🚨 Emergency Response Guide

This runbook provides **immediate response procedures** for common operational issues in the Amexing Experience platform. Use this guide for **quick problem resolution** during incidents.

---

## 📞 Emergency Contacts & Escalation

### **Incident Severity Levels**

| Severity | Description | Response Time | Escalation |
|----------|-------------|---------------|------------|
| **P0 - Critical** | System down, security breach | 5 minutes | Immediate |
| **P1 - High** | Major functionality broken | 30 minutes | Within 1 hour |
| **P2 - Medium** | Performance degradation | 2 hours | Within 4 hours |
| **P3 - Low** | Minor issues, non-critical | 1 day | Within 2 days |

### **Response Team**

| Role | Responsibility | Contact Method |
|------|----------------|----------------|
| **On-Call Engineer** | First response, initial troubleshooting | Phone/Slack |
| **Security Team** | Security incidents, compliance | Secure channel |
| **DevOps Lead** | Infrastructure, deployment issues | Phone/Email |
| **Product Owner** | Business impact assessment | Email/Slack |

---

## 🔥 Critical Issues (P0)

### **System Down / Server Not Responding**

**Symptoms:**
- `/health` endpoint returns 5xx errors
- Users cannot access the application
- Database connection timeouts

**Immediate Actions:**
```bash
# 1. Check server status
curl -I http://localhost:1337/health
# Expected: HTTP/1.1 200 OK

# 2. Check Parse Server logs
tail -f logs/parse-server.log | grep ERROR

# 3. Check system resources
top
df -h
free -m

# 4. Restart services if needed
yarn dev  # Development
# Or for production:
pm2 restart all
```

**Troubleshooting Steps:**
```bash
# Check MongoDB connection
mongo --eval "db.stats()"

# Check Node.js processes
ps aux | grep node

# Check port availability
lsof -i :1337

# Check disk space
df -h /var/log
```

**Resolution Checklist:**
- [ ] Service restarted successfully
- [ ] Health check passes
- [ ] Database connectivity confirmed
- [ ] Monitor for 15 minutes
- [ ] Document incident cause

---

### **Security Breach / Unauthorized Access**

**Symptoms:**
- Multiple failed login attempts
- Unauthorized data access in logs
- Suspicious API calls
- Alert from security monitoring

**Immediate Actions:**
```bash
# 1. Check security logs
grep -i "SECURITY" logs/*.log | tail -20

# 2. Review failed auth attempts
grep -i "auth.*failed" logs/*.log | tail -20

# 3. Check active sessions
# Monitor user sessions in Parse Dashboard

# 4. Review recent API calls
grep -E "(POST|PUT|DELETE)" logs/access.log | tail -20
```

**Emergency Response:**
```bash
# 1. If confirmed breach - IMMEDIATE ACTIONS:
# - Rotate JWT secrets (requires service restart)
# - Disable suspicious user accounts
# - Block suspicious IP addresses

# 2. Preserve evidence
cp logs/*.log /secure/incident-$(date +%Y%m%d-%H%M%S)/

# 3. Notify security team immediately
# 4. Document all actions taken
```

**Security Incident Checklist:**
- [ ] Incident confirmed and classified
- [ ] Evidence preserved
- [ ] Security team notified
- [ ] Affected systems identified
- [ ] Containment actions taken
- [ ] Forensic analysis initiated

---

### **Database Connection Lost**

**Symptoms:**
- "Connection to database lost" errors
- Parse Server queries timing out
- Health check failing on database

**Immediate Actions:**
```bash
# 1. Check MongoDB status
mongod --version
systemctl status mongod  # Linux
brew services list | grep mongodb  # macOS

# 2. Check database connectivity
mongo mongodb://localhost:27017/AmexingDEV --eval "db.stats()"

# 3. Check Parse Server configuration
grep DATABASE_URI environments/.env.development

# 4. Restart database if needed
systemctl restart mongod  # Linux
brew services restart mongodb-community  # macOS
```

**Recovery Steps:**
```bash
# 1. Verify database is running
mongo --eval "print('Database is responsive')"

# 2. Test Parse Server connection
curl http://localhost:1337/parse/health

# 3. Run database integrity check
mongo AmexingDEV --eval "db.runCommand({dbStats: 1})"

# 4. Restart Parse Server
yarn dev
```

---

## ⚠️ High Priority Issues (P1)

### **Authentication System Failure**

**Symptoms:**
- Users cannot log in
- JWT token validation failing
- OAuth providers not responding

**Troubleshooting:**
```bash
# 1. Check JWT configuration
grep JWT_SECRET environments/.env.development

# 2. Test authentication endpoint
curl -X POST http://localhost:1337/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test-admin@amexing.test","password":"TestPass123!"}'

# 3. Check OAuth providers
curl -I https://appleid.apple.com/.well-known/openid_configuration

# 4. Review authentication logs
grep -i "auth" logs/*.log | tail -20
```

**Recovery Actions:**
```bash
# 1. Verify test user login
yarn test tests/integration/auth/authentication.test.js

# 2. Check user permissions
mongo AmexingDEV --eval "db._User.find({email:'test-admin@amexing.test'})"

# 3. Restart authentication services
# (Usually requires full server restart)
```

---

### **Performance Degradation**

**Symptoms:**
- API response times > 5 seconds
- High CPU/memory usage
- Users reporting slowness

**Immediate Monitoring:**
```bash
# 1. Check system performance
top
iostat 1 5
vmstat 1 5

# 2. Monitor API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:1337/api/health

# 3. Check database performance
mongo --eval "db.currentOp()" AmexingDEV

# 4. Review slow queries
grep "slow query" logs/*.log
```

**Performance Analysis:**
```bash
# 1. Run performance regression tests
yarn test:performance

# 2. Check memory usage by process
ps aux --sort=-%mem | head

# 3. Analyze Parse Server performance
grep -E "(query|find|save)" logs/parse-server.log | tail -20

# 4. Monitor key endpoints
curl -w "Time: %{time_total}s\n" http://localhost:1337/api/quotes
```

---

### **Dinero varado: un cobro de pasarela que el saldo no ve**

Un `Payment` de pasarela solo cuenta en el saldo de la reservación si tiene `exists: true`
(`PaymentService.loadAndCompute` lee por `queryExisting`). Si una fila queda confirmada pero
soft-eliminada, el cliente pagó y la reservación sigue mostrando saldo.

**Query exacta de dinero varado:**

```bash
# Todo cobro confirmado que el rollup NO puede ver.
mongosh AmexingDEV --eval 'db.Payment.find({ gatewayStatus: "succeeded", exists: false }).pretty()'
```

Esta query es **exacta**, no aproximada, y su precisión depende de dos cosas que ya están en el
código: `retirePending` y el barrido TTL retiran con una escritura condicional que jamás puede
mover una fila que ya está en `succeeded`, y toda confirmación intenta revivir la fila antes de
recalcular. Si alguna de las dos se afloja, esta query vuelve a ser aproximada.

**Cómo distinguir los dos casos (el campo `retiredBySystem` es el que los separa):**

| `retiredBySystem` | Qué pasó | Qué hacer |
|---|---|---|
| `false` (o ausente) | Alguien del staff borró la fila **a propósito** y el cobro se confirmó después. El sistema NO la revive solo: gritó (`CRITICAL: confirmed a gateway payment that the rollup cannot see`) y dejó en pie la decisión humana. | Decidir con negocio: o se restaura la fila a mano (ver el bloque de abajo), o se inicia un reembolso. **No** es un bug. |
| `true` | Nuestro propio housekeeping la retiró y el revive automático no corrió (o falló). | Es una anomalía. Revisar el log del `paymentId` y restaurarla a mano con el bloque de abajo. **Correr `reconcileStalePayments` NO sirve para esta fila**: sus tres ramas de candidatos buscan `requires_payment`/`processing`, `expired`+`exists:false`, o `requiresRollupRepair`, y esta fila no es ninguna de las tres — el job contestaría `scanned:0` y daría falsa tranquilidad. |

**Restaurar a mano una fila varada** (los dos casos de la tabla). El `requiresRollupRepair: true` es
lo que hace que el job recalcule el saldo por ti en su siguiente corrida; sin él, restaurar `exists`
deja la fila visible pero el saldo persistido sigue viejo:

```bash
mongosh AmexingDEV --eval '
  db.Payment.updateOne(
    { _id: "<paymentId>" },
    { $set: { exists: true, active: true, retiredBySystem: false, requiresRollupRepair: true, _updated_at: new Date() } }
  )'
# Luego correr reconcileStalePayments desde el Parse Dashboard: la rama de reparación toma la fila,
# recalcula el saldo de la reservación y limpia la marca.
```

**Cobro perdido en su estado terminal** — pagado de verdad, pero el webhook nunca llegó y el barrido
ya lo retiró. Es el caso para el que existe la reconciliación, y NO lo encuentra la query de dinero
varado de arriba (aquella busca `succeeded`; esta fila dice `expired`):

```bash
mongosh AmexingDEV --eval 'db.Payment.find({ gatewayStatus: "expired", retiredBySystem: true, exists: false }).pretty()'
```

La mayoría de estas filas son checkouts abandonados normales (nadie pagó) y son esperables. Las que
importan son las que Stripe reporta como pagadas: eso lo resuelve `reconcileStalePayments`, que las
toma dentro de su ventana de 7 días y las reintenta tras el enfriamiento — **no** una sola vez.

**Cobro confirmado con saldo sin actualizar** (la transición ganó pero el rollup falló después; el
dinero está cobrado y el saldo miente). Se autorrepara en la siguiente corrida del job:

```bash
mongosh AmexingDEV --eval 'db.Payment.find({ requiresRollupRepair: true }).pretty()'
```

**Filas marcadas para revisión de reembolso** (un cobro que aterrizó sobre una reservación ya
cancelada; se registra el dinero, se actualiza el saldo y se marca — nunca se reembolsa solo):

```bash
mongosh AmexingDEV --eval 'db.Payment.find({ requiresRefundReview: true }).pretty()'
```

**Los dos jobs de housekeeping** (se programan desde el Parse Dashboard, nunca en código):

- `sweepExpiredOnlinePayments` — retira pendientes abandonados. Cadencia sugerida: cada 10 min.
  Nunca toca pagos manuales, pendientes vigentes, ni filas `processing` (esas solo se reportan:
  retirarlas sería retirar dinero todavía en vuelo en la pasarela).
- `reconcileStalePayments` — le pregunta a Stripe por cobros cuyo webhook nunca llegó y aplica lo
  que reporte. Cadencia sugerida: cada 30 min. Tiene **tres** ramas de candidatos: filas vivas y
  rancias, filas que el propio barrido retiró (dentro de una ventana de 7 días, reintentadas tras un
  enfriamiento de 6 h), y filas marcadas `requiresRollupRepair`. Ante una diferencia de monto o
  moneda **reporta y no corrige**: deja un log de nivel error y la evidencia en `gatewayRaw`, y jamás
  reescribe `amount`/`origAmount`/`origCurrency`.

**Ninguno de los dos tiene guarda de solapamiento**, y no la necesita: todas sus escrituras son
condicionales (el filtro de estado va dentro de la consulta), así que dos corridas encimadas —por una
cadencia agresiva o por un disparo manual sobre uno ya en curso— convergen al mismo resultado sin
duplicar nada. El único costo son consultas repetidas a Stripe. Si aun así se quiere evitar, basta con
separar las cadencias; **no** hace falta un lock.

```bash
# Filas en 'processing'. OJO: hoy NINGÚN camino del código escribe ese estado — lo produciría un
# payment_intent.processing (métodos asíncronos) que todavía no se maneja. Si esta query devuelve
# algo, es un dato inesperado y hay que investigarlo, no rutina. Nunca se retiran automáticamente
# (sería retirar dinero en vuelo); solo la reconciliación puede sacarlas de ahí.
mongosh AmexingDEV --eval 'db.Payment.find({ channel: "online", gatewayStatus: "processing", exists: true }).pretty()'
```

---

### **File Upload / S3 Issues**

**Symptoms:**
- Image uploads failing
- S3 connection timeouts
- File retrieval errors

**Troubleshooting:**
```bash
# 1. Test S3 connectivity
yarn s3:verify

# 2. Check AWS credentials
grep AWS_ environments/.env.development

# 3. Test file upload endpoint
curl -X POST http://localhost:1337/api/upload \
  -F "file=@test-image.jpg" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 4. Check S3 bucket permissions
aws s3 ls s3://amexing-bucket/dev/ --profile default
```

**S3 Configuration Fix:**
```bash
# 1. Verify bucket access
aws s3api head-bucket --bucket amexing-bucket

# 2. Check IAM permissions
aws iam get-user

# 3. Test bucket write permissions
echo "test" | aws s3 cp - s3://amexing-bucket/dev/test.txt

# 4. Cleanup test file
aws s3 rm s3://amexing-bucket/dev/test.txt
```

---

## 📊 Medium Priority Issues (P2)

### **Email Delivery Issues**

**Symptoms:**
- Users not receiving emails
- MailerSend API errors
- Email bounces

**Debugging Steps:**
```bash
# 1. Check MailerSend configuration
grep MAILER environments/.env.development

# 2. Test email service
curl -X POST "https://api.mailersend.com/v1/email" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":{"email":"test@amexing.com"},"to":[{"email":"test@example.com"}],"subject":"Test"}'

# 3. Review email logs
grep -i "email\|mailer" logs/*.log

# 4. Check email queue status
# (If using email queue system)
```

---

### **Background Job Failures**

**Symptoms:**
- Scheduled tasks not running
- Data processing delays
- Cron job errors

**Investigation:**
```bash
# 1. Check cron jobs
crontab -l

# 2. Review job logs
tail -f /var/log/cron.log

# 3. Test job execution manually
node scripts/jobs/example-job.js

# 4. Check Parse Server cloud functions
curl http://localhost:1337/parse/functions/scheduledjob
```

---

### **Test Suite Failures**

**Symptoms:**
- Pre-push hook failing
- Tests passing locally but failing in CI
- Random test failures

**Test Debugging:**
```bash
# 1. Run full test suite
yarn test --verbose

# 2. Run tests in isolation
yarn test tests/integration/api/quotes.test.js

# 3. Check test environment
NODE_ENV=test yarn test

# 4. Reset test database
# MongoDB Memory Server resets automatically

# 5. Run regression tests
yarn test:regression
```

**Common Test Fixes:**
```bash
# Clean node modules if tests behaving strangely
rm -rf node_modules
yarn install

# Update test snapshots if needed
yarn test --updateSnapshot

# Fix timing issues
yarn test --runInBand
```

---

## 🛠️ Maintenance Procedures

### **Daily Health Checks**

**Automated Checks** (Run every morning):
```bash
#!/bin/bash
# daily-health-check.sh

echo "=== Daily Health Check $(date) ==="

# 1. Server health
echo "Checking server health..."
curl -f http://localhost:1337/health || echo "❌ Server health check failed"

# 2. Database connectivity
echo "Checking database..."
mongo --quiet --eval "print('✅ Database responsive')" || echo "❌ Database check failed"

# 3. Test suite status
echo "Running regression tests..."
yarn test:regression || echo "❌ Regression tests failed"

# 4. Security scan
echo "Running security check..."
yarn security:semgrep || echo "❌ Security issues found"

# 5. External services
echo "Checking external services..."
yarn s3:verify || echo "❌ S3 connectivity issues"

echo "=== Health check completed ==="
```

### **Weekly Maintenance**

**Security Updates:**
```bash
# 1. Update dependencies
yarn upgrade --latest

# 2. Security audit
yarn audit
yarn audit fix

# 3. Run full security suite
yarn security:all

# 4. Review audit logs
grep -i "security\|error\|failed" logs/*.log | tail -50
```

**Performance Review:**
```bash
# 1. Database optimization
mongo AmexingDEV --eval "db.runCommand({collStats:'_User'})"

# 2. Log rotation
find logs/ -name "*.log" -size +100M -exec gzip {} \;

# 3. Performance regression test
yarn test:performance

# 4. Resource usage analysis
df -h
free -m
```

### **Monthly Tasks**

**Backup Verification:**
```bash
# 1. Verify database backups
mongodump --db AmexingDEV --out /backup/$(date +%Y%m%d)

# 2. Test backup restoration
mongorestore --db AmexingDEV_test /backup/latest

# 3. S3 backup verification
aws s3 sync s3://amexing-bucket/backups/ /tmp/backup-verify/
```

**Dependency Updates:**
```bash
# 1. Review outdated packages
yarn outdated

# 2. Update Parse Server
yarn upgrade parse-server

# 3. Test after updates
yarn test

# 4. Update documentation if needed
```

---

## 📈 Monitoring & Alerting

### **Key Metrics to Monitor**

| Metric | Threshold | Alert Level | Action |
|--------|-----------|-------------|--------|
| **API Response Time** | > 5 seconds | High | Investigate performance |
| **Error Rate** | > 5% | Medium | Review error logs |
| **Database Connections** | > 80% pool | Medium | Check connection leaks |
| **Disk Space** | > 85% | High | Clean logs, add storage |
| **Memory Usage** | > 90% | High | Restart services |
| **Failed Logins** | > 10/minute | Security | Check for attacks |

### **Monitoring Commands**

**Real-time Monitoring:**
```bash
# Monitor API requests
tail -f logs/access.log | grep -E "(POST|PUT|DELETE)"

# Monitor errors
tail -f logs/parse-server.log | grep ERROR

# Monitor system resources
watch -n 1 "free -m; echo '---'; df -h"

# Monitor database queries
mongo --eval "db.runCommand({currentOp: 1, active: true})"
```

**Performance Metrics:**
```bash
# API endpoint response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:1337/api/health

# Database performance
mongo --eval "db.serverStatus().opcounters"

# Memory usage breakdown
ps aux --sort=-%mem | head -20

# Network connectivity
ping -c 5 github.com
```

### **Alert Configuration**

**Health Check Alerts:**
```bash
# Set up monitoring script
cat > monitor-alerts.sh << 'EOF'
#!/bin/bash
# Check health endpoint
if ! curl -f http://localhost:1337/health > /dev/null 2>&1; then
  echo "ALERT: Health check failed at $(date)" | mail -s "Server Down" admin@amexing.com
fi

# Check disk space
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 85 ]; then
  echo "ALERT: Disk usage at ${DISK_USAGE}% at $(date)" | mail -s "Disk Space" admin@amexing.com
fi
EOF

chmod +x monitor-alerts.sh

# Add to crontab for every 5 minutes
echo "*/5 * * * * /path/to/monitor-alerts.sh" | crontab -
```

---

## 🔍 Debugging Techniques

### **Log Analysis**

**Parse Server Logs:**
```bash
# Recent errors
tail -100 logs/parse-server.log | grep ERROR

# Authentication issues
grep -i "auth\|login\|session" logs/parse-server.log

# Database queries
grep -i "query\|find\|save" logs/parse-server.log

# Performance issues
grep -E "slow|timeout|error" logs/parse-server.log
```

**Application Logs:**
```bash
# Security events
grep -i "security" logs/*.log

# API errors
grep -E "500|error|fail" logs/access.log

# User activities
grep "USER_ACTION" logs/*.log | tail -20
```

### **Database Debugging**

**MongoDB Queries:**
```bash
# Check user data
mongo AmexingDEV --eval "db._User.find().limit(5).pretty()"

# Check collections
mongo AmexingDEV --eval "show collections"

# Check indexes
mongo AmexingDEV --eval "db._User.getIndexes()"

# Check collection stats
mongo AmexingDEV --eval "db.stats()"
```

**Parse Server Debugging:**
```bash
# Enable debug mode
DEBUG=parse-server:* yarn dev

# Check Parse Server health
curl http://localhost:1337/parse/health

# Test Parse Server directly
curl -X POST http://localhost:1337/parse/classes/TestObject \
  -H "X-Parse-Application-Id: AmexingDev" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'
```

### **Network Debugging**

**Connectivity Tests:**
```bash
# Test external services
curl -I https://api.mailersend.com
curl -I https://appleid.apple.com
aws s3 ls s3://amexing-bucket/

# Test internal services
curl -I http://localhost:1337/health
curl -I http://localhost:27017  # MongoDB

# DNS resolution
nslookup amexing.com
dig @8.8.8.8 amexing.com
```

---

## 📋 Incident Response Checklist

### **Incident Response Process**

**Phase 1: Detection & Assessment (0-5 minutes)**
- [ ] Incident detected (monitoring alert, user report)
- [ ] Severity level assigned (P0-P3)
- [ ] Initial response team notified
- [ ] Incident commander assigned (for P0/P1)

**Phase 2: Immediate Response (5-30 minutes)**
- [ ] System status assessed
- [ ] Immediate containment actions taken
- [ ] Customer communications prepared (if needed)
- [ ] Stakeholders notified based on severity

**Phase 3: Investigation & Resolution (30 minutes - 4 hours)**
- [ ] Root cause analysis initiated
- [ ] Fix implemented and tested
- [ ] Solution deployed to production
- [ ] Service functionality verified

**Phase 4: Recovery & Follow-up (4+ hours)**
- [ ] Service fully restored
- [ ] Monitoring increased for stability
- [ ] Post-incident review scheduled
- [ ] Documentation updated

### **Communication Templates**

**Internal Alert Template:**
```
INCIDENT ALERT - [SEVERITY]
Time: [TIMESTAMP]
Issue: [BRIEF DESCRIPTION]
Impact: [USER/BUSINESS IMPACT]
ETA: [ESTIMATED RESOLUTION TIME]
Lead: [INCIDENT COMMANDER]
Status Page: [IF APPLICABLE]
```

**Customer Communication Template:**
```
We are currently experiencing [ISSUE DESCRIPTION]. 
Our team is actively working on a resolution.
Estimated resolution time: [ETA]
Updates will be provided every [FREQUENCY].
We apologize for any inconvenience.
```

---

## 🔧 Troubleshooting Quick Reference

### **Common Error Codes**

| Error Code | Description | Quick Fix |
|------------|-------------|-----------|
| **ECONNREFUSED** | Connection refused | Check service is running |
| **ETIMEDOUT** | Connection timeout | Check network/firewall |
| **OBJECT_NOT_FOUND** | Parse object not found | Check object ID/permissions |
| **INVALID_SESSION_TOKEN** | JWT token invalid | Re-authenticate user |
| **DUPLICATE_VALUE** | Unique constraint violation | Check for existing records |

### **Service Start/Stop Commands**

```bash
# Development
yarn dev                    # Start development server
pkill -f "node.*src/index"  # Stop development server

# Database
mongod                      # Start MongoDB
mongo                       # MongoDB shell
brew services start mongodb-community  # macOS
systemctl start mongod      # Linux

# Testing
yarn test                   # Run all tests
yarn test:regression        # Quick regression tests
yarn test:integration      # Integration tests only
```

### **Configuration Validation**

```bash
# Environment check
node -e "console.log(process.env.NODE_ENV)"

# Parse Server config
grep -E "(PARSE_|DATABASE_)" environments/.env.development

# AWS config
aws configure list

# Git config
git config --list | grep -E "(user|remote)"
```

---

## 📞 Emergency Contacts

### **Critical Systems**

| System | Contact | Escalation |
|--------|---------|------------|
| **Parse Server** | DevOps Team | CTO |
| **MongoDB** | Database Admin | Infrastructure Lead |
| **AWS Services** | Cloud Engineer | DevOps Lead |
| **Security** | Security Team | CISO |

### **External Vendors**

| Vendor | Service | Support Contact |
|--------|---------|----------------|
| **MongoDB Atlas** | Database hosting | Enterprise support |
| **AWS** | Cloud infrastructure | Business support |
| **MailerSend** | Email delivery | API support |

---

## 📝 Incident Documentation

### **Post-Incident Review Template**

```markdown
# Incident Report - [DATE]

## Summary
- **Incident ID**: [UNIQUE ID]
- **Date/Time**: [START] - [END]
- **Duration**: [TOTAL TIME]
- **Severity**: [P0/P1/P2/P3]

## Impact
- **Users Affected**: [NUMBER/PERCENTAGE]
- **Services Affected**: [LIST]
- **Business Impact**: [DESCRIPTION]

## Timeline
- [TIME]: Issue detected
- [TIME]: Response team notified
- [TIME]: Investigation started
- [TIME]: Root cause identified
- [TIME]: Fix implemented
- [TIME]: Service restored

## Root Cause
[DETAILED EXPLANATION]

## Resolution
[STEPS TAKEN TO RESOLVE]

## Follow-up Actions
- [ ] [ACTION ITEM 1]
- [ ] [ACTION ITEM 2]
- [ ] [ACTION ITEM 3]

## Lessons Learned
[WHAT WE LEARNED AND HOW TO PREVENT]
```

---

This runbook is a **living document**. Update it regularly based on new incidents, system changes, and lessons learned. 

**Keep it accessible**, **keep it current**, and **keep it simple** for effective incident response.

---

*Last Updated: May 6, 2026*  
*Version: 1.0*  
*Created by Denisse Maldonado*