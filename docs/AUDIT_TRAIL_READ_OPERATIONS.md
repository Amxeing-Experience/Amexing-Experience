# Audit Trail READ Operations - Implementation Guide

## Overview

This document explains how READ operation auditing works in AmexingWeb and how to ensure proper user attribution in audit logs.

## How It Works

### Sensitive Data Classes

The following classes are audited for READ operations (PCI DSS Requirement 10.2.1):

- `AmexingUser` - User account data
- `Client` - Corporate client data
- `Employee` - Employee personal data
- `Driver` - Driver personal data
- `Payment` - Payment/transaction data
- `Transaction` - Financial transaction data
- `AuditLog` - Access to audit logs themselves

### Audit Criteria

**ONLY individual object access is logged** (queries returning exactly 1 result):
- ✅ `query.get('objectId')` → Audited
- ✅ `query.first()` that returns 1 result → Audited
- ❌ `query.find()` returning multiple results → **NOT audited** (prevents log volume issues)

## User Attribution

### Correct Attribution (Authenticated API Calls)

When a user makes an API call with a valid JWT token:

```javascript
// Client-side (frontend)
fetch('/api/clients/abc123', {
  headers: {
    'Authorization': 'Bearer <jwt_token>'
  }
});

// Server-side audit log will show:
// userId: "CoLhdA3pJo"
// username: "admin@dev.amexing.com"
// action: "READ"
```

**This is the CORRECT and SECURE way to audit user access.**

### System Attribution (Internal/Administrative Operations)

When Parse Server makes internal queries (e.g., from cloud functions, scheduled jobs, or admin dashboard rendering):

```javascript
// Server-side query with masterKey
const query = new Parse.Query('Client');
const client = await query.get(clientId, { useMasterKey: true });

// Audit log will show:
// userId: "system"
// username: "MasterKey"
// action: "READ"
```

**This is EXPECTED for administrative/system operations.**

## Implementation Patterns

### Frontend API Calls (Correct Pattern)

**When making queries from frontend code**, always use the API endpoints with JWT authentication:

```javascript
// ✅ CORRECT: Uses JWT authentication
async function getClient(clientId) {
  const response = await fetch(`/api/clients/${clientId}`, {
    headers: {
      'Authorization': `Bearer ${getJWTToken()}`,
      'Content-Type': 'application/json'
    }
  });
  return response.json();
}
```

### Backend Controllers (Context Passing)

**When making queries in controllers**, pass user context explicitly:

```javascript
// ✅ CORRECT: Pass user context for audit trail
async getClient(req, res) {
  try {
    const currentUser = req.user; // From JWT middleware

    const query = new Parse.Query('Client');
    const client = await query.get(req.params.id, {
      useMasterKey: true,
      context: {
        user: {
          objectId: currentUser.id,
          id: currentUser.id,
          email: currentUser.get('email'),
          username: currentUser.get('username') || currentUser.get('email'),
        },
      },
    });

    res.json({ success: true, data: client.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
```

### Cloud Functions (System Operations)

**Cloud functions and internal operations** will correctly show "MasterKey/system":

```javascript
// This is EXPECTED to show as "MasterKey" in audit logs
Parse.Cloud.define('processPayment', async (request) => {
  const clientQuery = new Parse.Query('Client');
  const client = await clientQuery.get(request.params.clientId, { useMasterKey: true });

  // Audit log: userId="system", username="MasterKey"
  // This is correct for internal/automated operations
});
```

## Troubleshooting

### Issue: Audit logs show "MasterKey" instead of actual user

**Diagnosis**: Check if the query is being made with `useMasterKey: true` without passing user context.

**Solutions**:

1. **If from API endpoint**: Ensure JWT middleware is applied and user context is passed:
   ```javascript
   await query.get(id, {
     useMasterKey: true,
     context: { user: { objectId: req.user.id, username: req.user.get('email') } }
   });
   ```

2. **If from frontend**: Use API endpoints instead of direct Parse SDK calls:
   ```javascript
   // ❌ WRONG: Direct Parse SDK from frontend (will show as anonymous)
   const query = new Parse.Query('Client');
   const client = await query.get(clientId);

   // ✅ CORRECT: Use API endpoint
   const response = await fetch(`/api/clients/${clientId}`, {
     headers: { 'Authorization': `Bearer ${token}` }
   });
   ```

3. **If from admin dashboard**: This is expected behavior for administrative queries. Consider:
   - Adding admin-specific audit logs
   - Using session-based authentication for dashboard queries
   - Accepting "MasterKey" attribution for admin operations

### Issue: READ operations not being logged

**Diagnosis**: Query might be returning multiple results or accessing non-sensitive class.

**Verification**:
```javascript
// Check if query returns exactly 1 result
const results = await query.find();
console.log(`Query returned ${results.length} results`); // Must be 1 for READ audit

// Check if class is in AUDIT_READ_CLASSES
const sensitiveClasses = ['AmexingUser', 'Client', 'Employee', 'Driver', 'Payment', 'Transaction', 'AuditLog'];
console.log(`Is sensitive? ${sensitiveClasses.includes(className)}`);
```

## PCI DSS Compliance

### Requirement 10.2.1 Compliance

**Individual access to cardholder data (all elements) must be logged**:

✅ **COMPLIANT**: Our implementation logs:
- Individual user access to sensitive data
- User ID and username
- Timestamp and IP address
- Entity type and ID accessed
- Action type (READ)

### What Gets Logged

**Logged (PCI DSS Required)**:
- Individual reads of AmexingUser, Client, Employee, Driver
- Individual reads of Payment, Transaction data
- Individual reads of AuditLog (access to audit data itself)

**Not Logged (Performance Optimization)**:
- Bulk queries (multiple results)
- Catalog data (VehicleType, POI, Rate)
- Public/non-sensitive data
- List views (queries returning multiple items)

## Best Practices

1. **Always use API endpoints for user-initiated reads** → Ensures proper user attribution
2. **Pass user context in controller queries** → Maintains audit trail accuracy
3. **Accept "MasterKey" for admin/system operations** → Expected behavior for internal processes
4. **Monitor audit logs regularly** → Verify READ audits are being created correctly
5. **Test with authenticated users** → Validate user attribution before deployment

## Security Notes

- **Never bypass audit logging** for compliance reasons
- **MasterKey attribution is acceptable** for legitimate admin/system operations
- **Individual user access MUST be logged** per PCI DSS 10.2.1
- **Bulk queries are not logged** to prevent performance degradation
- **IP addresses are logged** for forensic analysis

## Related Files

- `src/cloud/hooks/auditTrailHooks.js` - READ audit hook implementation
- `src/application/middleware/auditContextMiddleware.js` - User context propagation
- `src/domain/models/AuditLog.js` - Audit log model
- `src/application/controllers/api/` - API controllers with user context

## References

- [PCI DSS v4.0.1 Requirement 10](https://docs-prv.pcisecuritystandards.org/PCI%20DSS/Standard/PCI-DSS-v4_0_1.pdf)
- [Parse Server Hooks Documentation](https://docs.parseplatform.org/js/guide/#cloud-code-hooks)
- [Parse Server Context Option](https://docs.parseplatform.org/js/guide/#cloud-code-context)
