# Database Schema Mapping

**Last Updated:** May 2026  
**Database:** MongoDB with Parse Server  
**Total Models:** 40+  
**Created by:** Denisse Maldonado  

## Overview

AmexingWeb uses Parse Server with MongoDB as the database backend. All models follow a standardized pattern with `active` and `exists` fields for soft deletion and logical state management.

## Standard Field Patterns

### Base Fields (All Models)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| objectId | String | Auto | Parse-generated unique identifier |
| createdAt | Date | Auto | Parse-managed creation timestamp |
| updatedAt | Date | Auto | Parse-managed update timestamp |
| active | Boolean | Yes | Activation status (true = active) |
| exists | Boolean | Yes | Logical deletion (false = soft deleted) |
| ACL | Object | Auto | Parse Access Control List |

### Audit Fields (When Applicable)
| Field | Type | Description |
|-------|------|-------------|
| createdBy | Pointer<_User> | User who created the record |
| updatedBy | Pointer<_User> | Last user to update |
| deletedBy | Pointer<_User> | User who soft deleted |
| deletedAt | Date | Soft deletion timestamp |

---

## Core Entities

### 1. _User (AmexingUser)
**Description:** Extended Parse User class with custom fields  
**Collection:** `_User`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| username | String | Yes | Unique | Login username |
| email | String | Yes | Unique, Email | Email address (enforced unique) |
| password | String | Yes | Min 8 chars | Hashed password |
| emailVerified | Boolean | No | - | Email verification status |
| phone | String | No | - | Phone number |
| firstName | String | Yes | - | First name |
| lastName | String | Yes | - | Last name |
| role | Pointer<Role> | Yes | - | User role reference |
| roleLevel | Number | Auto | 1-7 | Denormalized role level |
| department | Pointer<Department> | Conditional | Required for clients | Department reference |
| profilePicture | File | No | - | Profile image |
| lastLoginAt | Date | No | - | Last successful login |
| loginAttempts | Number | No | Max 5 | Failed login counter |
| lockedUntil | Date | No | - | Account lock expiration |
| passwordResetToken | String | No | - | Password reset token |
| passwordResetExpires | Date | No | - | Token expiration |
| organization | Pointer<Client> | Conditional | - | Organization for multi-tenant |
| delegatedPermissions | Array<Pointer> | No | - | Additional permissions |
| twoFactorEnabled | Boolean | No | Default false | 2FA status |
| active | Boolean | Yes | Default true | Account active |
| exists | Boolean | Yes | Default true | Logical deletion |

**Relationships:**
- Role (Many-to-One)
- Department (Many-to-One)
- Client/Organization (Many-to-One)
- DelegatedPermissions (Many-to-Many)

**Validation Rules:**
- Email uniqueness enforced in beforeSave hook
- Email must be valid format
- Password minimum 8 characters
- Role is required for all users

---

### 2. Role
**Description:** RBAC role definitions  
**Collection:** `Role`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| name | String | Yes | Unique | Role identifier |
| displayName | String | Yes | - | Display name |
| level | Number | Yes | 1-7 | Hierarchy level |
| description | String | No | - | Role description |
| permissions | Array<Pointer> | No | - | Role permissions |
| isSystemRole | Boolean | Yes | - | Protected system role |
| maxUsers | Number | No | - | User limit per role |
| active | Boolean | Yes | - | Role active status |
| exists | Boolean | Yes | - | Logical deletion |

**System Roles:**
| Level | Name | Display Name | Description |
|-------|------|--------------|-------------|
| 7 | superadmin | SuperAdmin | Full system access |
| 6 | admin | Admin | Administrative access |
| 5 | employee_amexing | Empleado Amexing | Internal employee |
| 4 | department_manager | Department Manager | Department head |
| 3 | client | Cliente | Client user |
| 3 | employee | Empleado | Employee user |
| 2 | driver | Chofer | Driver access |
| 1 | guest | Invitado | Minimal access |

---

### 3. Permission
**Description:** Granular permissions for RBAC  
**Collection:** `Permission`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Permission key (e.g., users.create) |
| displayName | String | Yes | Human-readable name |
| category | String | Yes | Permission category |
| description | String | No | Permission description |
| resource | String | Yes | Resource being protected |
| action | String | Yes | Action being permitted |
| isSystemPermission | Boolean | Yes | Protected permission |

**Permission Categories:**
- users (User management)
- clients (Client management)
- quotes (Quote operations)
- services (Service management)
- billing (Financial operations)
- audit (Audit log access)
- system (System administration)

---

### 4. Client
**Description:** Organization/Agency entities  
**Collection:** `Client`  
**Risk Level:** 🟠 HIGH

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Organization name |
| commercialName | String | No | Trade name |
| rfc | String | Conditional | Tax ID (Mexico) |
| email | String | Yes | Primary email |
| phone | String | No | Primary phone |
| address | Object | No | Address structure |
| billingProfile | Pointer<BillingProfile> | No | Billing information |
| parentClient | Pointer<Client> | No | Parent organization |
| clientType | String | Yes | agency/direct/corporate |
| creditLimit | Number | No | Credit limit |
| paymentTerms | Number | No | Payment terms (days) |
| markup | Number | No | Default markup percentage |
| currency | String | No | Preferred currency |
| logo | File | No | Company logo |
| primaryContact | Pointer<_User> | No | Main contact |
| departments | Relation<Department> | No | Client departments |
| active | Boolean | Yes | Client active |
| exists | Boolean | Yes | Logical deletion |

**Relationships:**
- ParentClient (Self-referential)
- Departments (One-to-Many)
- BillingProfile (One-to-One)
- Users (One-to-Many through Department)

---

### 5. Department
**Description:** Organizational units within clients  
**Collection:** `Department`  
**Risk Level:** 🟠 HIGH

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Department name |
| code | String | No | Department code |
| client | Pointer<Client> | Yes | Parent client |
| manager | Pointer<_User> | No | Department manager |
| costCenter | String | No | Accounting cost center |
| budget | Number | No | Department budget |
| employees | Relation<_User> | No | Department employees |
| active | Boolean | Yes | Department active |
| exists | Boolean | Yes | Logical deletion |

**Relationships:**
- Client (Many-to-One)
- Manager (One-to-One with User)
- Employees (One-to-Many with Users)

---

### 6. Quote
**Description:** Travel quotes and proposals  
**Collection:** `Quote`  
**Risk Level:** 🟠 HIGH

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| folio | String | Yes | Unique quote number |
| consecutiveFolio | Number | Yes | Sequential number |
| title | String | Yes | Quote title |
| client | Pointer<Client> | Yes | Client reference |
| department | Pointer<Department> | No | Department reference |
| contactPerson | Object | Yes | Contact information |
| travelDates | Object | Yes | Start/end dates |
| origin | String | Yes | Origin location |
| destination | String | Yes | Destination |
| passengers | Number | Yes | Passenger count |
| services | Array<Object> | No | Quote services |
| experiences | Array<Pointer> | No | Experiences included |
| subtotal | Number | Yes | Subtotal amount |
| tax | Number | No | Tax amount |
| total | Number | Yes | Total amount |
| currency | String | Yes | Quote currency |
| exchangeRate | Number | No | Exchange rate used |
| status | String | Yes | Quote status |
| validUntil | Date | Yes | Expiration date |
| owner | Pointer<_User> | Yes | Quote owner |
| collaborators | Relation<QuoteAccess> | No | Shared access |
| edits | Relation<QuoteEdit> | No | Edit history |
| notes | String | No | Internal notes |
| termsConditions | String | No | Terms text |
| paymentTerms | String | No | Payment terms |
| createdBy | Pointer<_User> | Yes | Creator |
| active | Boolean | Yes | Quote active |
| exists | Boolean | Yes | Logical deletion |

**Status Values:**
- draft
- sent
- viewed
- accepted
- rejected
- expired
- converted

**Relationships:**
- Client (Many-to-One)
- Department (Many-to-One)
- Owner (Many-to-One with User)
- Services (Embedded documents)
- QuoteAccess (One-to-Many)
- QuoteEdit (One-to-Many)

---

### 7. Service
**Description:** Available services catalog  
**Collection:** `Service`  
**Risk Level:** 🟡 MEDIUM

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Service name |
| description | String | No | Service description |
| serviceType | Pointer<ServiceType> | Yes | Service category |
| basePrice | Number | Yes | Base price |
| currency | String | Yes | Price currency |
| unit | String | Yes | Pricing unit |
| duration | Number | No | Duration (minutes) |
| capacity | Number | No | Max capacity |
| poi | Pointer<POI> | No | Point of interest |
| includedItems | Array<String> | No | Included items |
| excludedItems | Array<String> | No | Excluded items |
| restrictions | String | No | Service restrictions |
| images | Array<File> | No | Service images |
| ratePrices | Relation<RatePrices> | No | Rate-specific prices |
| clientPrices | Relation<ClientPrices> | No | Client-specific prices |
| active | Boolean | Yes | Service active |
| exists | Boolean | Yes | Logical deletion |

**Relationships:**
- ServiceType (Many-to-One)
- POI (Many-to-One)
- RatePrices (One-to-Many)
- ClientPrices (One-to-Many)

---

### 8. Vehicle
**Description:** Transportation vehicles  
**Collection:** `Vehicle`  
**Risk Level:** 🟡 MEDIUM

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Vehicle name |
| vehicleType | Pointer<VehicleType> | Yes | Vehicle category |
| brand | String | No | Vehicle brand |
| model | String | No | Vehicle model |
| year | Number | No | Vehicle year |
| plates | String | No | License plates |
| capacity | Number | Yes | Passenger capacity |
| features | Array<String> | No | Vehicle features |
| images | Array<File> | No | Vehicle images |
| primaryImage | File | No | Main image |
| insurance | Object | No | Insurance info |
| maintenance | Array<Object> | No | Maintenance records |
| driver | Pointer<_User> | No | Assigned driver |
| available | Boolean | Yes | Availability status |
| active | Boolean | Yes | Vehicle active |
| exists | Boolean | Yes | Logical deletion |

**Relationships:**
- VehicleType (Many-to-One)
- Driver (Many-to-One with User)
- VehicleImages (One-to-Many)

---

### 9. Reservation
**Description:** Confirmed bookings  
**Collection:** `Reservation`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| reservationNumber | String | Yes | Unique reservation ID |
| quote | Pointer<Quote> | Yes | Source quote |
| client | Pointer<Client> | Yes | Client reference |
| department | Pointer<Department> | No | Department reference |
| services | Relation<ReservationService> | Yes | Reserved services |
| travelDates | Object | Yes | Travel dates |
| passengers | Array<Object> | Yes | Passenger details |
| totalAmount | Number | Yes | Total price |
| paidAmount | Number | No | Amount paid |
| balance | Number | Auto | Outstanding balance |
| status | String | Yes | Reservation status |
| paymentStatus | String | Yes | Payment status |
| cancellationRequest | Pointer | No | Cancellation reference |
| adjustments | Array<Object> | No | Price adjustments |
| notes | String | No | Reservation notes |
| createdBy | Pointer<_User> | Yes | Creator |
| active | Boolean | Yes | Reservation active |
| exists | Boolean | Yes | Logical deletion |

**Status Values:**
- confirmed
- in_progress
- completed
- cancelled
- no_show

**Payment Status:**
- pending
- partial
- paid
- refunded

---

### 10. Invoice
**Description:** Financial invoices  
**Collection:** `Invoice`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| invoiceNumber | String | Yes | Unique invoice number |
| fiscalFolio | String | No | Tax authority folio |
| reservation | Pointer<Reservation> | Yes | Related reservation |
| client | Pointer<Client> | Yes | Client reference |
| billingProfile | Pointer<BillingProfile> | Yes | Billing information |
| items | Array<Object> | Yes | Invoice line items |
| subtotal | Number | Yes | Subtotal amount |
| tax | Number | Yes | Tax amount |
| total | Number | Yes | Total amount |
| currency | String | Yes | Invoice currency |
| exchangeRate | Number | No | Exchange rate |
| issueDate | Date | Yes | Issue date |
| dueDate | Date | Yes | Payment due date |
| paidDate | Date | No | Payment received date |
| status | String | Yes | Invoice status |
| paymentMethod | String | No | Payment method |
| cfdiUse | String | No | CFDI use (Mexico) |
| xmlFile | File | No | XML file (Mexico) |
| pdfFile | File | No | PDF file |
| notes | String | No | Invoice notes |
| active | Boolean | Yes | Invoice active |
| exists | Boolean | Yes | Logical deletion |

**Status Values:**
- draft
- issued
- sent
- paid
- overdue
- cancelled

---

## Supporting Entities

### BillingProfile
**Description:** Billing information for clients  
**Collection:** `BillingProfile`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| legalName | String | Yes | Legal entity name |
| taxId | String | Yes | Tax identification |
| address | Object | Yes | Billing address |
| email | String | Yes | Billing email |
| phone | String | No | Billing phone |
| cfdiUse | String | No | CFDI use code |
| paymentMethod | String | No | Default payment method |
| paymentTerms | Number | No | Payment terms (days) |

### POI (Point of Interest)
**Description:** Tourist locations and attractions  
**Collection:** `POI`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | POI name |
| category | String | Yes | POI category |
| location | GeoPoint | Yes | Geographic coordinates |
| address | Object | No | Physical address |
| description | String | No | POI description |
| images | Array<File> | No | POI images |
| schedule | Object | No | Operating hours |
| prices | Object | No | Entry prices |

### ServiceType
**Description:** Service categories  
**Collection:** `ServiceType`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Type name |
| code | String | Yes | Type code |
| category | String | Yes | Main category |
| icon | String | No | Icon identifier |
| order | Number | No | Display order |

### VehicleType
**Description:** Vehicle categories  
**Collection:** `VehicleType`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Type name |
| category | String | Yes | Vehicle category |
| minCapacity | Number | Yes | Minimum capacity |
| maxCapacity | Number | Yes | Maximum capacity |
| features | Array<String> | No | Standard features |

### Rate
**Description:** Pricing rate definitions  
**Collection:** `Rate`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Rate name |
| code | String | Yes | Rate code |
| type | String | Yes | Rate type |
| validFrom | Date | Yes | Start date |
| validTo | Date | Yes | End date |
| markup | Number | No | Markup percentage |
| conditions | Object | No | Rate conditions |

### RatePrices
**Description:** Service prices per rate  
**Collection:** `RatePrices`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| service | Pointer<Service> | Yes | Service reference |
| rate | Pointer<Rate> | Yes | Rate reference |
| price | Number | Yes | Service price |
| currency | String | Yes | Price currency |
| unit | String | Yes | Pricing unit |

### ClientPrices
**Description:** Client-specific pricing  
**Collection:** `ClientPrices`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| client | Pointer<Client> | Yes | Client reference |
| service | Pointer<Service> | Yes | Service reference |
| rate | Pointer<Rate> | No | Rate reference |
| price | Number | Yes | Override price |
| markup | Number | No | Markup applied |
| validFrom | Date | No | Price start date |
| validTo | Date | No | Price end date |

---

## Audit & System Tables

### AuditLog
**Description:** System audit trail  
**Collection:** `AuditLog`  
**Risk Level:** 🔴 CRITICAL

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user | Pointer<_User> | Yes | User who performed action |
| action | String | Yes | Action performed |
| entityType | String | Yes | Entity type affected |
| entityId | String | Yes | Entity ID affected |
| changes | Object | No | Field changes |
| ipAddress | String | No | Client IP |
| userAgent | String | No | User agent string |
| timestamp | Date | Yes | Action timestamp |
| success | Boolean | Yes | Action success |
| errorMessage | String | No | Error if failed |

### EmailLog
**Description:** Email sending history  
**Collection:** `EmailLog`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| recipient | String | Yes | Recipient email |
| subject | String | Yes | Email subject |
| template | String | No | Template used |
| status | String | Yes | Send status |
| provider | String | Yes | Email provider |
| messageId | String | No | Provider message ID |
| sentAt | Date | No | Send timestamp |
| error | String | No | Error message |

### Setting
**Description:** System configuration  
**Collection:** `Setting`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | String | Yes | Setting key |
| value | Mixed | Yes | Setting value |
| type | String | Yes | Value type |
| category | String | Yes | Setting category |
| description | String | No | Setting description |
| isPublic | Boolean | Yes | Public visibility |
| isEncrypted | Boolean | Yes | Encryption status |

---

## Relationship Patterns

### One-to-One
- User ↔ ProfilePicture
- Client ↔ BillingProfile
- Department ↔ Manager (User)

### One-to-Many
- Client → Departments
- Department → Users
- User → Quotes (as owner)
- Quote → QuoteEdits
- Service → RatePrices

### Many-to-One
- User → Role
- User → Department
- Quote → Client
- Service → ServiceType
- Vehicle → VehicleType

### Many-to-Many (via Junction)
- Quote ↔ Services (via quote.services array)
- User ↔ Permissions (via DelegatedPermission)
- Quote ↔ Users (via QuoteAccess)

---

## Data Validation Rules

### Email Validation
- Enforced at Parse Cloud level
- Case-insensitive uniqueness
- Whitespace trimmed
- Format validation (must contain @)
- Cannot reuse soft-deleted user emails

### Soft Deletion Pattern
```javascript
// Soft delete
record.set('exists', false);
record.set('deletedBy', currentUser);
record.set('deletedAt', new Date());

// Query active records
query.equalTo('exists', true);
query.equalTo('active', true);
```

### Status Management
```javascript
// Deactivate (temporary)
record.set('active', false);

// Reactivate
record.set('active', true);

// Permanent removal (rare)
record.destroy({ useMasterKey: true });
```

---

## Parse-Specific Features

### ACL (Access Control Lists)
- Automatic per-record permissions
- Read/Write access per user/role
- Public read/write options

### Relations
- Lazy-loaded by default
- Use `include()` for eager loading
- Bidirectional navigation

### Pointers
- Strong typed references
- Automatic garbage collection prevention
- Cascade delete handling via Cloud Code

### Cloud Functions
- beforeSave hooks for validation
- afterSave hooks for denormalization
- beforeDelete hooks for cascade logic

---

## Security Considerations

### Critical Tables
- _User: Contains authentication data
- Role/Permission: System access control
- Invoice: Financial data
- AuditLog: Compliance records
- BillingProfile: PII and payment info

### PCI DSS Compliance
- No credit card data stored
- Payment processing via external providers
- Audit trails for all financial operations
- Encryption at rest via MongoDB

### Data Privacy
- PII fields identified and protected
- GDPR compliance via soft deletion
- User data export capabilities
- Right to be forgotten implementation

---

## Performance Optimizations

### Indexes
```javascript
// Compound indexes for common queries
User: { role: 1, active: 1, exists: 1 }
Quote: { client: 1, status: 1, exists: 1 }
Service: { serviceType: 1, active: 1 }
Reservation: { travelDates.start: 1, status: 1 }
```

### Denormalization
- User.roleLevel copied from Role.level
- Quote.clientName copied from Client.name
- Reservation.totalAmount calculated and stored

### Query Optimization
- Always filter by exists: true first
- Use select() to limit field retrieval
- Implement pagination for large datasets
- Cache frequently accessed data

---

## Migration Considerations

### Adding Fields
- All new fields should be nullable initially
- Run migration to populate required fields
- Then enforce constraints

### Changing Relationships
- Maintain backward compatibility
- Use dual-write during transition
- Clean up old references after migration

### Data Cleanup
- Regular cleanup of soft-deleted records
- Archive old audit logs
- Compress historical data

---

## Related Documentation
- [API-ENDPOINTS.md](./API-ENDPOINTS.md) - API endpoint mapping
- [TEST-COVERAGE.md](./TEST-COVERAGE.md) - Test coverage
- [PERMISSIONS-MATRIX.md](../PERMISSIONS-MATRIX.md) - RBAC details
- [BUSINESS-FLOWS.md](../BUSINESS-FLOWS.md) - Business logic

---

Last Updated: May 6, 2026  
Created by: Denisse Maldonado