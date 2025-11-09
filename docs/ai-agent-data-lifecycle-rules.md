# AI Agent Data Lifecycle Management Rules

## Overview

This document defines the standardized data lifecycle management rules for AI agents operating within the Amexing platform. All database entities use a consistent `active` and `exists` boolean pattern for proper data state management and audit compliance.

## Core Principles

### 1. Never Hard Delete Data
- **CRITICAL**: AI agents must NEVER perform hard deletes using `Parse.Object.destroy()`
- All data removal operations must use soft deletion patterns
- Hard deletion is only permitted for system administrators via manual intervention

### 2. Lifecycle Fields Standard
Every database entity includes two mandatory boolean fields:
- `active: boolean` - Controls business operation visibility
- `exists: boolean` - Controls logical existence (soft delete flag)

### 3. Data State Definitions

| active | exists | Status | Description | AI Agent Usage |
|--------|--------|---------|-------------|-----------------|
| `true` | `true` | **Active** | Normal business operations | ✅ Standard queries |
| `false` | `true` | **Archived** | Inactive but accessible | ⚠️ Archive queries only |
| `false` | `false` | **Soft Deleted** | Hidden from normal operations | ❌ Admin/audit queries only |

## Query Patterns for AI Agents

### Standard Business Queries
```javascript
// ✅ CORRECT: Query only active records
const query = BaseModel.queryActive('AmexingUser');
// Equivalent to:
// query.equalTo('active', true);
// query.equalTo('exists', true);
```

### Include Archived Records
```javascript
// ✅ CORRECT: Query active + archived (exclude soft deleted)
const query = BaseModel.queryExisting('Client');
// Equivalent to:
// query.equalTo('exists', true);
```

### Admin/Audit Queries Only
```javascript
// ⚠️ RESTRICTED: Query all records including soft deleted
const query = BaseModel.queryAll('Order');
// Use only for admin interfaces or audit reports
```

### Archived Records Only
```javascript
// ✅ CORRECT: Query only archived records
const query = BaseModel.queryArchived('Vehicle');
```

### Soft Deleted Records Only
```javascript
// ⚠️ RESTRICTED: Query only soft deleted records
const query = BaseModel.querySoftDeleted('Department');
// Use only for data recovery or audit purposes
```

## Lifecycle Operations for AI Agents

### 1. Creating New Records
```javascript
// ✅ CORRECT: BaseModel automatically sets defaults
const user = AmexingUser.create({
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe'
  // active: true, exists: true set automatically
});
await user.save();
```

### 2. Deactivating Records (Archive)
```javascript
// ✅ CORRECT: Deactivate for business rules
await user.deactivate(currentUserId);
// Sets: active=false, exists=true
// Result: Record archived but accessible
```

### 3. Soft Deleting Records
```javascript
// ✅ CORRECT: Soft delete for data retention
await user.softDelete(currentUserId);
// Sets: active=false, exists=false, deletedAt=now
// Result: Hidden from normal queries but retained for audit
```

### 4. Reactivating Records
```javascript
// ✅ CORRECT: Reactivate archived record
await user.activate(currentUserId);
// Sets: active=true, exists=true
// Result: Record returns to normal business operations
```

### 5. Restoring Soft Deleted Records
```javascript
// ✅ CORRECT: Restore soft deleted record
await user.restore(currentUserId);
// Sets: active=false, exists=true, removes deletedAt
// Result: Record restored as archived, requires explicit activation
```

## Mandatory Rules for AI Agents

### 🚫 PROHIBITED Actions
1. **Hard Delete**: Never use `Parse.Object.destroy()` or `DELETE` SQL commands
2. **Direct Field Manipulation**: Never directly set `active=false, exists=false` without using lifecycle methods
3. **Ignore Lifecycle**: Never query without considering lifecycle state
4. **Bypass Audit**: Never modify records without tracking `modifiedBy`

### ✅ REQUIRED Actions
1. **Always Use BaseModel Methods**: Use `activate()`, `deactivate()`, `softDelete()`, `restore()`
2. **Track Modifications**: Always pass `modifiedBy` parameter with user ID
3. **Use Appropriate Queries**: Choose correct query method based on business need
4. **Validate State**: Check lifecycle status before operations

## Entity-Specific Rules

### AmexingUser
- **Never soft delete**: Use `deactivate()` to disable user accounts
- **Authentication**: Only query active users for login attempts
- **Profile Access**: Allow archived users to view their own profile

### Client
- **Soft Delete Allowed**: When client relationship ends
- **Active Required**: Only active clients can create new orders
- **Archive Projects**: Deactivate instead of delete for ongoing projects

### Order
- **Status-Based Lifecycle**:
  - Completed orders: Keep active for reporting
  - Cancelled orders: Use `deactivate()`
  - Data retention: Soft delete after 7 years
- **Financial Records**: Never soft delete orders with financial data

### Vehicle
- **Maintenance Status**: Use `active` for operational availability
- **Fleet Management**: Deactivate for maintenance, soft delete when sold
- **Driver Assignment**: Only active vehicles can be assigned

### Department
- **Reorganization**: Use `deactivate()` during restructuring
- **Audit Trail**: Soft delete only when department permanently dissolved
- **Employee Access**: Archived departments visible to former employees

## Error Handling

### Invalid Lifecycle Transitions
```javascript
// ❌ WRONG: Trying to activate soft deleted record
if (record.isSoftDeleted()) {
  throw new Error('Must restore before activating');
}

// ✅ CORRECT: Proper restoration flow
if (record.isSoftDeleted()) {
  await record.restore(currentUserId);
}
await record.activate(currentUserId);
```

### Permission Validation
```javascript
// ✅ CORRECT: Check permissions before lifecycle operations
if (!user.hasPermission('USER_MANAGEMENT')) {
  throw new Error('Insufficient permissions for user lifecycle management');
}
await targetUser.deactivate(user.id);
```

## Monitoring and Logging

### Required Audit Logs
All lifecycle operations must log:
- **Operation Type**: activate, deactivate, softDelete, restore
- **Entity**: className and objectId
- **Performer**: modifiedBy user ID
- **Timestamp**: operation date/time
- **Reason**: business justification when available

### Example Logging
```javascript
logger.info('User lifecycle operation', {
  operation: 'deactivate',
  className: 'AmexingUser',
  objectId: user.id,
  modifiedBy: currentUserId,
  reason: 'Employee termination',
  previousState: 'active',
  newState: 'archived'
});
```

## Compliance Requirements

### Data Retention
- **Active Records**: Indefinite retention for business operations
- **Archived Records**: 7-year retention minimum for audit compliance
- **Soft Deleted Records**: 10-year retention for legal requirements

### GDPR/Privacy Compliance
- **Right to be Forgotten**: Implement separate anonymization process
- **Data Portability**: Include lifecycle status in data exports
- **Access Requests**: Users can access their archived data

### PCI DSS Compliance
- **Financial Data**: Never soft delete payment records
- **Audit Trail**: All lifecycle changes must be logged
- **Access Control**: Restrict soft delete operations to authorized personnel

## Implementation Examples

### User Management Service
```javascript
class UserManagementService {
  async suspendUser(userId, currentUserId, reason) {
    const user = await AmexingUser.queryActive('AmexingUser').get(userId);
    await user.deactivate(currentUserId);

    logger.info('User suspended', {
      targetUserId: userId,
      performedBy: currentUserId,
      reason
    });
  }

  async terminateUser(userId, currentUserId, reason) {
    const user = await BaseModel.queryExisting('AmexingUser').get(userId);
    await user.softDelete(currentUserId);

    logger.info('User terminated', {
      targetUserId: userId,
      performedBy: currentUserId,
      reason
    });
  }
}
```

### Order Processing Service
```javascript
class OrderService {
  async cancelOrder(orderId, currentUserId, reason) {
    const order = await BaseModel.queryActive('Order').get(orderId);

    if (order.get('status') === 'completed') {
      throw new Error('Cannot cancel completed order');
    }

    await order.deactivate(currentUserId);
    order.set('status', 'cancelled');
    order.set('cancellationReason', reason);
    await order.save();
  }
}
```

## Testing Guidelines

### Unit Tests
```javascript
describe('User Lifecycle Management', () => {
  it('should archive user correctly', async () => {
    const user = await createTestUser();
    await user.deactivate('admin123');

    expect(user.isArchived()).toBe(true);
    expect(user.get('active')).toBe(false);
    expect(user.get('exists')).toBe(true);
  });

  it('should exclude soft deleted from active queries', async () => {
    const user = await createTestUser();
    await user.softDelete('admin123');

    const activeUsers = await BaseModel.queryActive('AmexingUser').find();
    expect(activeUsers).not.toContain(user);
  });
});
```

---

## Summary

AI agents must strictly follow these lifecycle management rules to ensure:
- **Data Integrity**: Consistent state management across all entities
- **Audit Compliance**: Complete audit trail for all data operations
- **Business Continuity**: Proper data retention and recovery capabilities
- **Security**: Controlled access to different data states

**Remember: When in doubt, use the BaseModel methods and query helpers. They are designed to enforce these rules automatically.**