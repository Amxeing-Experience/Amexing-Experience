# Business Flows Documentation

## Overview

This document maps the core business workflows in the Amexing Experience platform, focusing on the business logic flows that developers need to understand before making changes. This is part of the Phase 3 regression prevention strategy.

## Table of Contents

- [1. Quote Creation & Management Flow](#1-quote-creation--management-flow)
- [2. Invoice & Payment Flow](#2-invoice--payment-flow)
- [3. User Management & Role Flow](#3-user-management--role-flow)
- [4. Reservation & Service Delivery Flow](#4-reservation--service-delivery-flow)
- [5. State Transition Rules](#5-state-transition-rules)
- [6. Critical Business Rules](#6-critical-business-rules)
- [7. Error Handling Patterns](#7-error-handling-patterns)

---

## 1. Quote Creation & Management Flow

### 1.1 Flow Overview

```
[Quote Creation] → [Service Configuration] → [Status Management] → [Client Interaction]
       ↓                     ↓                      ↓                    ↓
   Validation &         Pricing &              Role-Based          Share Links &
   Folio Generation     Service Items          Transitions         Email Notifications
```

### 1.2 Quote Lifecycle States

**Valid Quote Statuses:**
- `quoted` - Initial state, quote created and ready for review
- `requested` - Client has requested services (triggers reservation creation)
- `hold` - Quote on hold (admin only)
- `scheduled` - Services confirmed and scheduled (admin only)
- `rejected` - Quote rejected or cancelled

### 1.3 Business Rules

**State Transitions:**
```
quoted → requested    (All roles: client, department_manager, admin, superadmin)
quoted → hold        (Admin/SuperAdmin only)
quoted → scheduled   (Admin/SuperAdmin only)  
quoted → rejected    (Admin/SuperAdmin only)
requested → scheduled (Admin/SuperAdmin only)
requested → rejected  (Admin/SuperAdmin only)
any → quoted         (Admin/SuperAdmin only - revert)
```

**Critical Validation Points:**
1. **Pricing Validation**: Quote must have total > 0 before status change to `requested`
2. **Service Items Required**: Quote must have valid service items structure:
   ```javascript
   serviceItems: {
     days: [/* service days array */],
     subtotal: number,
     iva: number,
     total: number
   }
   ```
3. **Automatic Reservation Creation**: When status changes to `requested`, system automatically creates:
   - Reservation record
   - ReservationService records for each subconcept

**Key Controllers & Services:**
- `QuoteController` - API endpoints and request handling
- `QuoteService` - Core business logic
- `QuoteOwnershipService` - Ownership management
- `QuoteCollaborationService` - Multi-user collaboration
- `QuoteVersioningService` - Change tracking

### 1.4 Collaboration Features

**Quote Ownership Model:**
- Each quote has a single owner
- Owner can delegate access to collaborators
- Ownership can be transferred (admin/department_manager only)

**Access Levels:**
- `view` - Read-only access
- `edit` - Can modify quote content
- `owner` - Full control including collaboration management

---

## 2. Invoice & Payment Flow

### 2.1 Flow Overview

```
[Quote Status: scheduled] → [Invoice Request] → [Admin Processing] → [Invoice Generation]
         ↓                        ↓                    ↓                   ↓
   Receipt Generation         Pending Queue       Admin Review       XML/PDF Files
```

### 2.2 Invoice Request Process

**Trigger:** Quote reaches `scheduled` status
**Actors:** Department Manager, Admin, SuperAdmin

**Process Steps:**
1. **Request Creation**: User clicks "Request Invoice" on scheduled quote
2. **Queue Management**: Invoice request added to pending queue
3. **Admin Processing**: Admin reviews and processes requests
4. **File Generation**: System generates XML and PDF files
5. **Completion**: Files stored in S3, download links provided

**Business Rules:**
- Only scheduled quotes can request invoices
- Invoice requests track complete lifecycle
- Admin-only processing for security compliance
- Department managers can only create requests, not process them

### 2.3 Payment Information Management

**Billing Profile Structure:**
```javascript
billingInfo: {
  rfc: string,           // Tax ID
  razonSocial: string,   // Company name
  direccion: string,     // Address
  codigoPostal: string,  // Postal code
  email: string          // Billing email
}
```

**Payment Methods:**
- Managed through `PaymentInfo` model
- Support for multiple payment configurations
- Default payment info for standard transactions
- Admin can select specific payment info for receipts

**Key Controllers & Services:**
- `InvoiceController` - Invoice request management
- `BillingController` - Billing information management
- `PDFReceiptService` - Receipt generation
- `PaymentInfoController` - Payment method configuration

---

## 3. User Management & Role Flow

### 3.1 Role Hierarchy

```
SuperAdmin (7) 
    ↓
Admin (6)
    ↓
Department Manager (5)
    ↓
Client (4)
    ↓
Employee/Employee_Amexing (3)
    ↓
Driver (2)
    ↓
Guest (1)
```

### 3.2 Authentication Flow

```
[Login Attempt] → [Credential Validation] → [Role Assignment] → [JWT Generation]
      ↓                    ↓                     ↓                   ↓
  Username/Email       Parse Server          Role-Based           Token with
  Password Check       Authentication        Permissions          Expiration
      ↓                    ↓                     ↓                   ↓
  OAuth Providers      Account Status         Department           Session
  (Apple, Corporate)   Lock Check             Client Mapping       Management
```

### 3.3 Registration & Onboarding

**User Creation Process:**
1. **Registration**: Email/password or OAuth provider
2. **Email Verification**: Automated email validation
3. **Role Assignment**: Based on business rules or admin assignment
4. **Department/Client Mapping**: Organizational structure assignment
5. **Permission Inheritance**: Role-based permission assignment

**Business Rules:**
- Email uniqueness enforced (case-insensitive)
- Password complexity requirements
- Account lockout protection (failed login attempts)
- OAuth provider integration (Apple, Corporate SSO)

### 3.4 Role-Based Access Control

**Data Filtering by Role:**

**SuperAdmin/Admin:**
- See all data across organization
- Full CRUD operations on all entities

**Department Manager:**
- See users in their department
- Manage quotes/reservations for department users
- Limited administrative functions

**Client:**
- See users in their client organization
- Access to their quotes and reservations
- Cannot see other client data

**Employee/Driver:**
- See only assigned or owned records
- Limited modification rights

**Key Controllers & Services:**
- `AuthController` - Authentication endpoints
- `AuthenticationService` - Core auth logic
- `UserManagementService` - User CRUD operations
- `RoleAuthorizationService` - Permission checking
- `PermissionService` - Role-based filtering

---

## 4. Reservation & Service Delivery Flow

### 4.1 Flow Overview

```
[Quote: requested] → [Auto-Reservation] → [Service Assignment] → [Delivery Tracking]
        ↓                   ↓                    ↓                    ↓
   Validation &        Reservation +         Employee           Status Updates &
   Price Check         Service Records       Assignment         Completion
```

### 4.2 Automatic Reservation Creation

**Trigger:** Quote status changes to `requested`
**Process:**
1. **Validation**: Ensure quote has valid service items and pricing
2. **Reservation Creation**: Create main Reservation record
3. **Service Breakdown**: Create ReservationService records for each subconcept
4. **Folio Generation**: Generate unique reservation folio
5. **Email Notification**: Send confirmation to client

**Business Logic:**
```javascript
// Service Items Structure Required
serviceItems: {
  days: [
    {
      dayNumber: 1,
      concept: "Transfer",
      date: "2024-01-15",
      subconcepts: [
        {
          type: "traslado", // or "tour"
          concept: "Airport → Hotel",
          serviceId: "service123",
          vehicleType: "Sprinter",
          unitPrice: 2500.00,
          quantity: 1,
          total: 2500.00
        }
      ]
    }
  ],
  subtotal: 2500.00,
  iva: 400.00,
  total: 2900.00
}
```

### 4.3 Service Status Tracking

**Reservation States:**
- `pending` - Newly created, awaiting assignment
- `assigned` - Employee/driver assigned
- `in_progress` - Service delivery in progress
- `completed` - Service completed successfully
- `cancelled` - Service cancelled

**ReservationService States:**
- `pending` - Awaiting execution
- `assigned` - Staff assigned to service
- `completed` - Individual service completed
- `cancelled` - Individual service cancelled

### 4.4 Employee Assignment

**Assignment Rules:**
- Department managers can assign employees from their department
- Admins can assign any employee
- Assignment based on service type and employee capabilities

**Key Controllers & Services:**
- `ReservationController` - Reservation management
- `QuoteService.createReservationFromQuote()` - Auto-creation logic
- `ReservationService` model - Service tracking

---

## 5. State Transition Rules

### 5.1 Quote State Machine

```
     quoted
    /   |   \
   v    v    v
hold  requested  rejected
      |    |
      v    v
  scheduled  rejected
```

**Transition Permissions:**
```javascript
const stateTransitions = {
  quoted: {
    requested: ['client', 'department_manager', 'admin', 'superadmin'],
    hold: ['admin', 'superadmin'],
    rejected: ['admin', 'superadmin']
  },
  requested: {
    scheduled: ['admin', 'superadmin'],
    rejected: ['admin', 'superadmin']
  },
  hold: {
    quoted: ['admin', 'superadmin'],
    scheduled: ['admin', 'superadmin'],
    rejected: ['admin', 'superadmin']
  }
};
```

### 5.2 Reservation State Machine

```
    pending
       |
       v
   assigned
       |
       v
  in_progress
    /     \
   v       v
completed cancelled
```

### 5.3 Invoice Request States

```
   pending
      |
      v
  processing
    /    \
   v      v
completed rejected
```

---

## 6. Critical Business Rules

### 6.1 Data Lifecycle Rules

**Standard Pattern for All Entities:**
- `active: true` - Entity is active and operational
- `exists: true` - Entity exists and is visible
- `active: false` - Entity is disabled but visible
- `exists: false` - Entity is soft-deleted (audit trail only)

**Business Rule:** NEVER physically delete records - always use soft deletion

### 6.2 Financial Rules

**Quote Pricing:**
- Subtotal must be calculated from service items
- IVA = Subtotal * 0.16 (16% tax rate)
- Total = Subtotal + IVA
- All prices in MXN unless specified otherwise

**Invoice Generation:**
- Only scheduled quotes can generate invoices
- XML and PDF files must be generated together
- Files stored in S3 with proper naming convention
- Invoice numbers must be sequential and unique

### 6.3 Security Rules

**PCI DSS Compliance:**
- No sensitive payment data stored in logs
- All payment information encrypted
- Audit trail for all financial operations
- Role-based access to sensitive operations

**Data Access:**
- Users can only access data within their organizational scope
- Department managers limited to their department
- Clients limited to their organization
- All access logged for audit

---

## 7. Error Handling Patterns

### 7.1 Validation Errors

**Pattern:**
```javascript
if (!validationPassed) {
  throw new Error('Human-readable message for user');
}
```

**Response Format:**
```javascript
{
  success: false,
  error: 'Human-readable message',
  code: 'ERROR_CODE',
  timestamp: '2024-01-01T12:00:00.000Z'
}
```

### 7.2 Business Logic Errors

**Common Scenarios:**
- Quote without pricing attempting status change to `requested`
- Invalid role attempting restricted state transition
- Missing service items when creating reservation
- Duplicate email registration

**Error Handling Strategy:**
- Log detailed error information for debugging
- Return user-friendly messages to frontend
- Maintain system state consistency
- Provide actionable error messages

### 7.3 Integration Errors

**Email Service Failures:**
- Non-blocking operations for notifications
- Retry logic for critical communications
- Fallback mechanisms for service failures

**File Generation Errors:**
- Validate input data before processing
- Proper error reporting for PDF/XML generation
- S3 upload failure handling

---

## Implementation Notes

### Key Files to Review Before Changes

**Quote Management:**
- `/src/application/controllers/api/QuoteController.js`
- `/src/application/services/QuoteService.js`
- `/src/application/services/QuoteOwnershipService.js`

**Reservation Flow:**
- `/src/application/controllers/api/ReservationController.js`
- `/src/domain/models/Reservation.js`
- `/src/domain/models/ReservationService.js`

**User Management:**
- `/src/application/controllers/authController.js`
- `/src/application/services/AuthenticationService.js`
- `/src/application/services/UserManagementService.js`

**Financial Operations:**
- `/src/application/controllers/api/InvoiceController.js`
- `/src/application/controllers/api/BillingController.js`
- `/src/application/services/PDFReceiptService.js`

### Testing Strategy

Before modifying business flows:
1. Run integration tests: `yarn test:integration`
2. Review existing test coverage for the flow
3. Add tests for new business rules
4. Validate state transitions work correctly
5. Test role-based access controls

### Monitoring Points

**Critical Metrics to Watch:**
- Quote to reservation conversion rate
- State transition success/failure rates
- Email notification delivery rates
- Invoice generation success rates
- User authentication success rates

---

*This document should be updated whenever business rules change. Last updated: January 2025*