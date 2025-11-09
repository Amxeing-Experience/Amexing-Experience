# READ Audit Context Propagation Limitation

## Executive Summary

**Status**: ❌ **AsyncLocalStorage approach FAILED**
**Problem**: Parse Server cloud hooks execute in isolated V8 context without access to Node.js AsyncLocalStorage
**Impact**: READ operation audit logs show "MasterKey/system" instead of actual authenticated user
**Severity**: PCI DSS compliance gap - unable to track individual user access to cardholder data

## Root Cause Analysis

### Parse Server Architecture

Parse Server 8.2.4 executes cloud code hooks (afterFind, beforeSave, etc.) in an **isolated V8 execution context** that:

1. **Does not inherit AsyncLocalStorage context** from the main Express app
2. **Runs in a separate process/sandbox** for security isolation
3. **Only receives request object** with limited context from Parse Server internals
4. **Uses `useMasterKey: true`** for internal queries, bypassing user authentication

### Evidence from Logs

```
# Expected debug output (NEVER APPEARED):
🔹 [ParseContext] Setting AsyncLocalStorage context
🔸 [AuditHook] Checking AsyncLocalStorage context

# Actual output shows isolated execution:
info: afterSave triggered for Client for user undefined
```

The complete absence of debug logs proves Parse hooks **never execute code from our AsyncLocalStorage implementation**.

## Attempted Solutions (ALL FAILED)

### 1. ❌ AsyncLocalStorage Global Context
**Approach**: Use Node.js AsyncLocalStorage to propagate user context
**Result**: FAILED - Context not accessible in Parse cloud hooks
**Why**: Parse Server cloud code runs in isolated V8 context

### 2. ❌ HTTP Headers Propagation
**Approach**: Set custom headers (`x-audit-user-id`, `x-audit-username`)
**Result**: FAILED - Headers don't propagate to internal Parse queries
**Why**: Parse Server's internal query execution doesn't forward custom headers

### 3. ❌ Context Parameter in Queries
**Approach**: Pass `context` parameter in Parse queries
**Result**: PARTIAL SUCCESS - Only works for queries originating from controllers, NOT for READ hooks
**Why**: `afterFind` hook receives results from Parse Server internals that use `useMasterKey: true`

## Why This Is Hard to Solve

### Parse Server Internal Query Flow

```
HTTP Request (with user)
  ↓
Express Middleware (sets AsyncLocalStorage)
  ↓
Parse Server Internal Router
  ↓
Parse Query Execution (useMasterKey: true)  ← User context LOST here
  ↓
Cloud Hooks (afterFind, etc.)  ← Receives request with NO user info
```

### The Fundamental Problem

When Parse Server executes queries internally (e.g., from `/classes/AmexingUser/:id` REST endpoint), it:

1. Uses `useMasterKey: true` to bypass ACLs
2. Creates a NEW request object without user session
3. Executes hooks in isolated context
4. Only provides `request.objects` array to `afterFind` hook

**There is NO mechanism** in Parse Server 8.2.4 to automatically propagate user context from HTTP layer to cloud hooks for READ operations.

## Viable Solutions

### Option 1: Custom REST API Endpoints ⭐ RECOMMENDED

**Strategy**: Create custom Express routes that bypass Parse Server's REST API entirely.

#### Implementation

```javascript
// src/application/controllers/api/AuditedResourceController.js
router.get('/users/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;

  try {
    // Query with explicit user context
    const query = new Parse.Query('AmexingUser');
    const user = await query.get(id, { useMasterKey: true });

    // MANUALLY create READ audit log
    await AuditLog.createEntry({
      userId: currentUser.id,
      username: currentUser.email,
      action: 'READ',
      entityType: 'AmexingUser',
      entityId: user.id,
      entityName: user.get('email'),
      metadata: { ip: req.ip }
    });

    // Return data
    res.json({ success: true, data: user.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**Pros**:
- ✅ Full control over user context
- ✅ Explicit audit logging with correct user attribution
- ✅ Works reliably
- ✅ Standard Express patterns

**Cons**:
- ⚠️ Must create custom endpoints for each resource
- ⚠️ Bypasses Parse Server's built-in REST API
- ⚠️ More code to maintain

### Option 2: Parse Server Custom Middleware (NOT SUPPORTED)

Parse Server 8.2.4 **does not support** custom middleware injection into the cloud code execution context. This feature may be available in future versions.

### Option 3: Parse Server Source Code Modification (NOT RECOMMENDED)

Modifying Parse Server source code to propagate user context is:
- ❌ Extremely complex
- ❌ Breaks upgradability
- ❌ Unsupported
- ❌ High maintenance burden

### Option 4: Selective READ Auditing with Manual Logging ⭐ PRAGMATIC

**Strategy**: Disable automatic READ hooks, add manual audit logging in controllers where PCI DSS requires it.

#### Implementation

1. **Remove `afterFind` hooks** for automatic READ auditing
2. **Add explicit audit logging** in controllers for sensitive operations:

```javascript
// src/application/controllers/api/UserManagementController.js
async getUserById(req, res) {
  const { userId } = req.params;
  const currentUser = req.user;

  try {
    const user = await UserManagementService.getUserById(userId, currentUser);

    // EXPLICIT READ audit for PCI DSS compliance
    await AuditLog.createEntry({
      userId: currentUser.id,
      username: currentUser.email,
      action: 'READ',
      entityType: 'AmexingUser',
      entityId: user.id,
      entityName: user.get('email'),
      metadata: { ip: req.ip, endpoint: '/api/users/:id' }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    errorHandler(res, error);
  }
}
```

**Pros**:
- ✅ Works with existing Parse Server architecture
- ✅ Explicit control over what gets audited
- ✅ Correct user attribution
- ✅ Minimal code changes

**Cons**:
- ⚠️ Must remember to add audit logging for each sensitive endpoint
- ⚠️ Not automatic
- ⚠️ Risk of missing some audit points

## PCI DSS Compliance Impact

### Current Status

**PCI DSS Requirement 10.2.1**: Log individual user access to cardholder data

- ✅ **CREATE operations**: Working correctly
- ✅ **UPDATE operations**: Working correctly
- ✅ **DELETE operations**: Working correctly
- ❌ **READ operations**: Showing "MasterKey/system" instead of actual user

### Compliance Remediation

To achieve full PCI DSS compliance for READ operations:

1. **Implement Option 1 or Option 4** for sensitive data classes:
   - AmexingUser
   - Client
   - Employee
   - Driver
   - Payment (when implemented)
   - Transaction (when implemented)

2. **Document the approach** in PCI DSS compliance documentation

3. **Test thoroughly** to ensure all sensitive data access is logged with correct user attribution

## Recommended Action Plan

### Phase 1: Immediate (Remove Broken Implementation)

1. Remove AsyncLocalStorage debug logging:
   ```javascript
   // Remove console.log statements from:
   // - src/infrastructure/parseContext.js
   // - src/cloud/hooks/auditTrailHooks.js
   ```

2. Disable automatic READ auditing:
   ```javascript
   // Comment out registerAuditReadHooks() call in:
   // src/cloud/hooks/auditTrailHooks.js
   ```

### Phase 2: Short-term (Implement Manual Auditing)

1. Add explicit READ audit logging to existing controllers:
   - UserManagementController
   - ClientController
   - EmployeeController (when implemented)
   - DriverController (when implemented)

2. Create helper function for consistent READ auditing:
   ```javascript
   // src/application/utils/auditHelper.js
   async function logReadAccess(req, entity, className) {
     await AuditLog.createEntry({
       userId: req.user.id,
       username: req.user.email,
       action: 'READ',
       entityType: className,
       entityId: entity.id,
       entityName: extractEntityName(entity),
       metadata: { ip: req.ip, endpoint: req.path }
     });
   }
   ```

### Phase 3: Long-term (Custom REST API)

1. Create dedicated audit-aware REST API endpoints for sensitive resources
2. Deprecate Parse Server REST API for sensitive data access
3. Update frontend to use custom endpoints
4. Complete migration and remove Parse Server REST API access for sensitive classes

## Technical Lessons Learned

1. **Parse Server cloud hooks are isolated** - They don't have access to Express middleware context
2. **AsyncLocalStorage doesn't cross V8 contexts** - Can't be used for Parse Server integration
3. **Context parameter only works for direct queries** - Not for Parse Server's internal routing
4. **Manual approaches are more reliable** than automatic hooks for cross-cutting concerns in Parse Server

## References

- Parse Server Documentation: https://docs.parseplatform.org/cloudcode/guide/
- Node.js AsyncLocalStorage: https://nodejs.org/api/async_context.html
- PCI DSS Requirement 10.2.1: Individual user access to cardholder data logging
- Parse Server Source (triggers.js): https://github.com/parse-community/parse-server/blob/master/src/triggers.js

## Last Updated

2025-10-16 - Initial investigation and documentation
