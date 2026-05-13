# API Endpoints Mapping

**Last Updated:** May 2026  
**Total Endpoints:** 350+  
**Controllers:** 45+  
**Created by:** Denisse Maldonado  

## Overview

This document provides a comprehensive mapping of all API endpoints in the AmexingWeb system. Each endpoint is documented with its HTTP method, path, authentication requirements, and purpose.

## Quick Reference

| Category | Endpoint Count | Risk Level | Test Coverage |
|----------|---------------|------------|---------------|
| Authentication | 3 | 🔴 CRITICAL | Integration tests |
| User Management | 14 | 🔴 CRITICAL | Unit + Integration |
| Client Management | 26 | 🟠 HIGH | Integration tests |
| Employee Management | 7 | 🟠 HIGH | Unit + Integration |
| Quote Management | 35 | 🟠 HIGH | Integration tests |
| Service Management | 25 | 🟡 MEDIUM | Unit tests |
| Vehicle Management | 15 | 🟡 MEDIUM | Partial coverage |
| Billing & Financial | 12 | 🔴 CRITICAL | Security tests |

---

## Authentication & Session Management

### Core Authentication
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/auth/current-token` | JWT | Get JWT for client-side | authController | 🔴 |
| POST | `/api/auth/logout` | JWT | API/Mobile logout | authController | 🔴 |
| POST | `/api/test-csrf` | Dev | CSRF validation test | apiController | 🟡 |

### System Status
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/status` | Public | API health check | apiController |
| GET | `/api/version` | Public | API version info | apiController |
| GET | `/api/session/health` | Public | Session health | sessionController |
| GET | `/api/session/metrics` | Admin+ | Session metrics | sessionController |

**Test Files:**
- `tests/integration/api/auth.test.js`
- `tests/integration/auth/mobile-auth-flows.test.js`
- `tests/unit/middleware/jwtMiddleware-rbac.test.js`

---

## User Management

### Users Resource (`/api/users`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/users` | `users.list` | List users with filters | UserManagementController |
| GET | `/api/users/search` | `users.search` | Advanced search | UserManagementController |
| GET | `/api/users/statistics` | Admin+ | User statistics | UserManagementController |
| GET | `/api/users/:id` | `users.read` | Get user by ID | UserManagementController |
| POST | `/api/users` | `users.create` | Create user | UserManagementController |
| PUT | `/api/users/:id` | `users.update` | Update user | UserManagementController |
| PUT | `/api/users/me/profile` | JWT | Update own profile | UserManagementController |
| DELETE | `/api/users/:id` | `users.deactivate` | Soft delete | UserManagementController |
| PUT | `/api/users/:id/reactivate` | `users.reactivate` | Reactivate | UserManagementController |
| PATCH | `/api/users/:id/toggle-status` | `users.update` | Toggle status | UserManagementController |
| PATCH | `/api/users/:id/archive` | SuperAdmin | Archive user | UserManagementController |

### Profile Management
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/user/profile` | `profile.read` | Get profile | ProfileController |
| PUT | `/api/user/profile` | `profile.update` | Update profile | ProfileController |
| POST | `/api/profile/upload` | JWT | Upload photo | ProfileImageController |
| DELETE | `/api/profile/delete` | JWT | Delete photo | ProfileImageController |

**Test Files:**
- `tests/integration/services/UserManagementService.test.js`
- `tests/unit/services/AuthenticationService.test.js`

---

## Client Management

### Clients Resource (`/api/clients`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/clients` | Admin+ | List clients | ClientsController | 🟠 |
| GET | `/api/clients/active` | Admin+ | Active clients dropdown | ClientsController | 🟡 |
| GET | `/api/clients/amexing-direct` | Admin+ | Direct clients | ClientsController | 🟠 |
| POST | `/api/clients/amexing-direct/quick` | Admin+ | Quick create direct | ClientsController | 🟠 |
| GET | `/api/clients/mixed` | Admin+ | Mixed agencies/direct | ClientsController | 🟡 |
| POST | `/api/clients/quick` | Admin+ | Quick create for quotes | ClientsController | 🟠 |
| GET | `/api/clients/:id` | Admin+ | Get client by ID | ClientsController | 🟡 |
| POST | `/api/clients` | Admin+ | Create client | ClientsController | 🟠 |
| PUT | `/api/clients/:id` | Admin+ | Update client | ClientsController | 🟠 |
| DELETE | `/api/clients/:id` | Admin+ | Soft delete | ClientsController | 🔴 |
| PATCH | `/api/clients/:id/toggle-status` | Admin+ | Toggle status | ClientsController | 🟠 |
| POST | `/api/clients/:id/reset-password` | Admin+ | Reset password | ClientsController | 🔴 |

### Client Employees (Nested)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/clients/:clientId/employees` | Client access | List employees | ClientEmployeesController |
| GET | `/api/clients/:clientId/sub-clients` | Client access | Get sub-clients | ClientEmployeesController |
| GET | `/api/clients/:clientId/employees/:id` | Client access | Get employee | ClientEmployeesController |
| POST | `/api/clients/:clientId/employees` | Client access | Create employee | ClientEmployeesController |
| PUT | `/api/clients/:clientId/employees/:id` | Client access | Update employee | ClientEmployeesController |
| DELETE | `/api/clients/:clientId/employees/:id` | Client access | Soft delete | ClientEmployeesController |
| PATCH | `/api/clients/:clientId/employees/:id/toggle-status` | Client access | Toggle status | ClientEmployeesController |

### Bulk Operations
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/clients/bulk/template` | Admin+ | Download template | BulkImportController |
| POST | `/api/clients/bulk/upload` | Admin+ | Upload Excel | BulkImportController |
| POST | `/api/clients/bulk/process` | Admin+ | Process import | BulkImportController |
| GET | `/api/clients/bulk/status/:jobId` | Admin+ | Get job status | BulkImportController |
| GET | `/api/clients/bulk/error-report/:jobId` | Admin+ | Error report | BulkImportController |

**Test Files:**
- `tests/unit/controllers/api/ClientEmployeesController.test.js`
- `tests/unit/services/BulkImportService.test.js`

---

## Employee Management

### Employees Resource (`/api/employees`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/employees` | Admin+ | List Amexing employees | EmployeesController | 🟠 |
| GET | `/api/employees/:id` | Admin+ | Get employee by ID | EmployeesController | 🟡 |
| POST | `/api/employees` | Admin+ | Create employee | EmployeesController | 🟠 |
| PUT | `/api/employees/:id` | Admin+ | Update employee | EmployeesController | 🟠 |
| DELETE | `/api/employees/:id` | Admin+ | Soft delete | EmployeesController | 🔴 |
| PATCH | `/api/employees/:id/toggle-status` | Admin+ | Toggle status | EmployeesController | 🟠 |
| GET | `/api/employees/photo/:employeeId` | Public | Serve photos | EmployeesController | 🟢 |

**Test Files:**
- `tests/integration/api/employees.test.js`
- `tests/unit/controllers/api/EmployeesController.test.js`

---

## Quote Management

### Quotes Resource (`/api/quotes`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/quotes` | Employee+ | List quotes | QuoteController | 🟠 |
| POST | `/api/quotes` | Dept Manager+ | Create quote | QuoteController | 🟠 |
| GET | `/api/quotes/owned` | JWT | Get owned quotes | QuoteController | 🟡 |
| GET | `/api/quotes/with-invoices` | Dept Manager+ | Quotes with invoices | QuoteController | 🟡 |
| GET | `/api/quotes/:id` | Dept Manager+ | Get quote by ID | QuoteController | 🟡 |
| PUT | `/api/quotes/:id` | Dept Manager+ | Update quote | QuoteController | 🟠 |
| PUT | `/api/quotes/:id/service-items` | Dept Manager+ | Update services | QuoteController | 🟠 |
| GET | `/api/quotes/:id/available-services` | Dept Manager+ | Available services | QuoteController | 🟢 |
| POST | `/api/quotes/:id/duplicate` | Dept Manager+ | Duplicate quote | QuoteController | 🟠 |
| POST | `/api/quotes/:id/share-link` | Dept Manager+ | Generate link | QuoteController | 🟡 |
| POST | `/api/quotes/:id/generate-receipt` | Dept Manager+ | Generate receipt | QuoteController | 🟠 |
| POST | `/api/quotes/:id/send-email` | Dept Manager+ | Send email | QuoteController | 🟠 |
| POST | `/api/quotes/:id/request-invoice` | Dept Manager+ | Request invoice | QuoteController | 🔴 |
| POST | `/api/quotes/:id/cancel-reservation` | Dept Manager+ | Cancel reservation | QuoteController | 🔴 |
| DELETE | `/api/quotes/:id` | Dept Manager+ | Soft delete | QuoteController | 🔴 |

### Quote Ownership
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| POST | `/api/quotes/:quoteId/ownership/transfer` | Owner/Admin | Transfer ownership | QuoteOwnershipController |
| GET | `/api/quotes/:quoteId/available-owners` | Admin/DM | Available owners | QuoteOwnershipController |
| GET | `/api/quotes/:quoteId/ownership` | JWT | Current ownership | QuoteOwnershipController |
| GET | `/api/quotes/:quoteId/ownership/history` | Access | History | QuoteOwnershipController |

### Quote Collaboration
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/quotes/:quoteId/access` | JWT | Check access | QuoteCollaborationController |
| POST | `/api/quotes/:quoteId/collaborators` | Owner | Add collaborator | QuoteCollaborationController |
| GET | `/api/quotes/:quoteId/collaborators` | Access | Get collaborators | QuoteCollaborationController |
| DELETE | `/api/quotes/:quoteId/collaborators/:agentId` | Owner | Remove collaborator | QuoteCollaborationController |
| PUT | `/api/quotes/:quoteId/collaborators/:agentId/role` | Owner | Update role | QuoteCollaborationController |

**Test Files:**
- `tests/integration/api/quotes-duplicate.test.js`

---

## Service Management

### Services Resource (`/api/services`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/services` | Dept Manager+ | List services | ServicesController |
| GET | `/api/services/active` | JWT | Active services | ServicesController |
| GET | `/api/services/with-rate-prices` | Dept Manager+ | Services with prices | ServicesController |
| GET | `/api/services/prices-by-route` | Dept Manager+ | Route prices | ServicesController |
| GET | `/api/services/:id/all-rate-prices` | Dept Manager+ | All rate prices | ServicesController |
| GET | `/api/services/:id/all-rate-prices-with-client-prices` | Dept Manager+ | With client prices | ServicesController |
| GET | `/api/services/debug-rate-prices` | Admin+ | Debug prices | ServicesController |
| GET | `/api/services/:id/price-history` | Admin+ | Price history | ServicesController |
| GET | `/api/services/:id` | Dept Manager+ | Get service | ServicesController |
| POST | `/api/services/bulk-create` | Admin+ | Bulk create | ServicesController |
| POST | `/api/services` | Admin+ | Create service | ServicesController |
| PATCH | `/api/services/:id/toggle-status` | Admin+ | Toggle status | ServicesController |
| PUT | `/api/services/:id` | Admin+ | Update service | ServicesController |
| DELETE | `/api/services/:id` | Admin+ | Soft delete | ServicesController |
| POST | `/api/services/client-prices` | Admin+ | Save client prices | ServicesController |
| POST | `/api/services/:id/update-base-prices` | Admin+ | Update base prices | ServicesController |
| POST | `/api/services/:id/add-rate-prices` | Admin+ | Add rate prices | ServicesController |

### Service Types
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/service-types` | Dept Manager+ | List types | ServiceTypeController |
| GET | `/api/service-types/active` | JWT | Active types | ServiceTypeController |
| GET | `/api/service-types/:id` | Dept Manager+ | Get type | ServiceTypeController |
| POST | `/api/service-types` | Admin+ | Create type | ServiceTypeController |
| PUT | `/api/service-types/:id` | Admin+ | Update type | ServiceTypeController |
| DELETE | `/api/service-types/:id` | Admin+ | Delete type | ServiceTypeController |
| PATCH | `/api/service-types/:id/toggle-status` | Admin+ | Toggle status | ServiceTypeController |

**Test Files:**
- `tests/integration/api/services-rate-filter.test.js`
- `tests/integration/api/services-pricing-edit.test.js`

---

## Vehicle Management

### Vehicles Resource (`/api/vehicles`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/vehicles` | Dept Manager+ | List vehicles | VehicleController |
| GET | `/api/vehicles/:id` | Dept Manager+ | Get vehicle | VehicleController |
| POST | `/api/vehicles` | Admin+ | Create vehicle | VehicleController |
| PUT | `/api/vehicles/:id` | Admin+ | Update vehicle | VehicleController |
| DELETE | `/api/vehicles/:id` | Admin+ | Soft delete | VehicleController |

### Vehicle Images
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/vehicles/optimized/:vehicleId/:imageName` | Public | Serve optimized | VehicleImageController |
| POST | `/api/vehicles/:id/images` | Admin+ | Upload image | VehicleImageController |
| GET | `/api/vehicles/:id/images` | JWT | List images | VehicleImageController |
| DELETE | `/api/vehicles/:id/images/:imageId` | Admin+ | Delete image | VehicleImageController |
| PATCH | `/api/vehicles/:id/images/reorder` | Admin+ | Reorder images | VehicleImageController |
| PATCH | `/api/vehicles/:id/images/:imageId/primary` | Admin+ | Set primary | VehicleImageController |

### Vehicle Types
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/vehicle-types` | Dept Manager+ | List types | VehicleTypeController |
| GET | `/api/vehicle-types/active` | JWT | Active types | VehicleTypeController |
| GET | `/api/vehicle-types/:id` | Dept Manager+ | Get type | VehicleTypeController |
| POST | `/api/vehicle-types` | Admin+ | Create type | VehicleTypeController |
| PUT | `/api/vehicle-types/:id` | Admin+ | Update type | VehicleTypeController |
| DELETE | `/api/vehicle-types/:id` | Admin+ | Delete type | VehicleTypeController |
| PATCH | `/api/vehicle-types/:id/toggle-status` | Admin+ | Toggle status | VehicleTypeController |

**Test Files:**
- `tests/integration/api/vehicles-with-rates.test.js`
- `tests/integration/api/vehicle-filtering.test.js`
- `tests/integration/api/vehicle-images-s3.test.js`

---

## Experience Management

### Experiences Resource (`/api/experiences`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/experiences` | Client+ | List experiences | ExperienceController |
| GET | `/api/experiences/:id/dependencies` | Client+ | Check dependencies | ExperienceController |
| GET | `/api/experiences/:id/price-history` | Admin+ | Price history | ExperienceController |
| GET | `/api/experiences/:id` | Client+ | Get experience | ExperienceController |
| POST | `/api/experiences` | Admin+ | Create experience | ExperienceController |
| PUT | `/api/experiences/:id/service-items` | Admin+ | Update services | ExperienceController |
| PUT | `/api/experiences/:id` | Admin+ | Update experience | ExperienceController |
| DELETE | `/api/experiences/:id` | Admin+ | Soft delete | ExperienceController |

### Experience Images
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| POST | `/api/experiences/:id/images` | Admin+ | Upload image | ExperienceImageController |
| GET | `/api/experiences/:id/images` | JWT | List images | ExperienceImageController |
| DELETE | `/api/experiences/:id/images/:imageId` | Admin+ | Delete image | ExperienceImageController |
| PATCH | `/api/experiences/:id/images/reorder` | Admin+ | Reorder | ExperienceImageController |
| PATCH | `/api/experiences/:id/images/:imageId/primary` | Admin+ | Set primary | ExperienceImageController |

**Test Files:**
- `tests/unit/controllers/api/ExperienceController.test.js`

---

## Tour Management

### Tours Resource (`/api/tours`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/tours` | Dept Manager+ | List tours | ToursController |
| GET | `/api/tours/with-rate-prices` | Dept Manager+ | Tours with prices | ToursController |
| POST | `/api/tours` | Admin+ | Create tour | ToursController |
| GET | `/api/tours/:id` | Dept Manager+ | Get tour | ToursController |
| GET | `/api/tours/:id/all-prices` | Dept Manager+ | All prices | ToursController |
| GET | `/api/tours/:id/price-history` | Admin+ | Price history | ToursController |
| POST | `/api/tours/client-prices` | Admin+ | Client prices | ToursController |
| PUT | `/api/tours/:id` | Admin+ | Update tour | ToursController |
| DELETE | `/api/tours/:id` | Admin+ | Delete tour | ToursController |
| PATCH | `/api/tours/:id/toggle-status` | Admin+ | Toggle status | ToursController |

### Tour Images
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| POST | `/api/tours/:id/images` | Admin+ | Upload image | TourImageController |
| GET | `/api/tours/:id/images` | JWT | List images | TourImageController |
| DELETE | `/api/tours/:id/images/:imageId` | Admin+ | Delete image | TourImageController |
| PATCH | `/api/tours/:id/images/reorder` | Admin+ | Reorder | TourImageController |
| PATCH | `/api/tours/:id/images/:imageId/primary` | Admin+ | Set primary | TourImageController |

**Test Files:**
- `tests/integration/api/tours-availability.test.js`

---

## Reservation Management

### Reservations Resource (`/api/reservations`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/reservations` | Dept Manager+ | List reservations | ReservationController | 🟠 |
| GET | `/api/reservations/:id` | Dept Manager+ | Get details | ReservationController | 🟡 |
| PUT | `/api/reservations/:id/services/batch-assign` | Dept Manager+ | Batch assign | ReservationController | 🟠 |
| PUT | `/api/reservations/:id/services/:serviceId/assign` | Dept Manager+ | Assign employee | ReservationController | 🟠 |
| PUT | `/api/reservations/:id/service-customer` | Dept Manager+ | Assign customer | ReservationController | 🟠 |
| POST | `/api/reservations/:id/adjustments` | Admin+ | Add adjustment | ReservationController | 🔴 |
| DELETE | `/api/reservations/:id/adjustments/:adjustmentId` | Admin+ | Remove adjustment | ReservationController | 🔴 |
| PATCH | `/api/reservations/:id/services/:serviceId/status` | Dept Manager+ | Update status | ReservationController | 🟠 |
| POST | `/api/reservations/:id/cancel` | Dept Manager+ | Cancel reservation | ReservationController | 🔴 |

### Cancellation Requests
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/cancellation-requests` | Dept Manager+ | List requests | CancellationRequestsController |
| POST | `/api/cancellation-requests` | Dept Manager+ | Create request | CancellationRequestsController |
| PUT | `/api/cancellation-requests/:id/approve` | Admin+ | Approve | CancellationRequestsController |
| PUT | `/api/cancellation-requests/:id/reject` | Admin+ | Reject | CancellationRequestsController |

---

## Pricing Management

### Rates Resource (`/api/rates`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/rates` | Dept Manager+ | List rates | RateController |
| GET | `/api/rates/active` | JWT | Active rates | RateController |
| GET | `/api/rates/:id` | Dept Manager+ | Get rate | RateController |
| POST | `/api/rates` | Admin+ | Create rate | RateController |
| PUT | `/api/rates/:id` | Admin+ | Update rate | RateController |
| DELETE | `/api/rates/:id` | Admin+ | Delete rate | RateController |

### Client Prices
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| POST | `/api/client-prices/bulk-apply` | Admin+ | Bulk apply markup | ClientPricesController | 🔴 |
| POST | `/api/client-prices/bulk-apply-with-progress` | Admin+ | With progress | ClientPricesController | 🔴 |
| GET | `/api/client-prices/progress/:processId` | SSE | Progress updates | ClientPricesController | 🟢 |

### Exchange Rates
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/exchange-rate` | JWT | Get rates | ExchangeRateController |
| POST | `/api/exchange-rate` | Admin+ | Update rate | ExchangeRateController |

### Inflation Rates
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/inflation-rate` | JWT | Get rates | InflationRateController |
| POST | `/api/inflation-rate` | Admin+ | Update rate | InflationRateController |

---

## Billing & Financial

### Billing Resource (`/api/billing`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/billing/get` | JWT | Get user billing | BillingController | 🔴 |
| POST | `/api/billing/save` | JWT | Save billing info | BillingController | 🔴 |
| GET | `/api/billing/get-user/:userId` | Admin | Get any user billing | BillingController | 🔴 |

### Billing Profiles
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/billing-profiles` | JWT | List profiles | BillingProfileController |
| GET | `/api/billing-profiles/:id` | JWT | Get profile | BillingProfileController |
| POST | `/api/billing-profiles` | JWT | Create profile | BillingProfileController |
| PUT | `/api/billing-profiles/:id` | JWT | Update profile | BillingProfileController |
| DELETE | `/api/billing-profiles/:id` | JWT | Delete profile | BillingProfileController |

### Invoices
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/invoices` | Dept Manager+ | List invoices | InvoiceController | 🔴 |
| GET | `/api/invoices/:id` | Dept Manager+ | Get invoice | InvoiceController | 🔴 |
| POST | `/api/invoices` | Admin+ | Create invoice | InvoiceController | 🔴 |
| PUT | `/api/invoices/:id` | Admin+ | Update invoice | InvoiceController | 🔴 |
| POST | `/api/invoices/:id/send` | Admin+ | Send invoice | InvoiceController | 🔴 |
| POST | `/api/invoices/:id/cancel` | Admin+ | Cancel invoice | InvoiceController | 🔴 |

### Payment Info
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/payment-info` | JWT | Get payment info | PaymentInfoController |
| POST | `/api/payment-info` | JWT | Save payment info | PaymentInfoController |

---

## Points of Interest

### POIs Resource (`/api/pois`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/pois` | Dept Manager+ | List POIs | POIController |
| GET | `/api/pois/active` | JWT | Active POIs | POIController |
| GET | `/api/pois/:id` | Dept Manager+ | Get POI | POIController |
| POST | `/api/pois` | Admin+ | Create POI | POIController |
| PUT | `/api/pois/:id` | Admin+ | Update POI | POIController |
| DELETE | `/api/pois/:id` | Admin+ | Delete POI | POIController |
| PATCH | `/api/pois/:id/toggle-status` | Admin+ | Toggle status | POIController |

---

## RBAC Management

### Roles Resource (`/api/roles`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/roles` | JWT | List roles | RolesController | 🟠 |
| GET | `/api/roles/:id` | JWT | Get role | RolesController | 🟡 |
| POST | `/api/roles` | SuperAdmin | Create role | RolesController | 🔴 |
| PUT | `/api/roles/:id` | SuperAdmin | Update role | RolesController | 🔴 |
| DELETE | `/api/roles/:id` | SuperAdmin | Delete role | RolesController | 🔴 |

### Permissions
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/permissions` | Admin+ | List permissions | PermissionController |
| GET | `/api/permissions/:id` | Admin+ | Get permission | PermissionController |
| POST | `/api/permissions` | SuperAdmin | Create permission | PermissionController |
| PUT | `/api/permissions/:id` | SuperAdmin | Update permission | PermissionController |

**Test Files:**
- `tests/integration/rbac/permission-system.integration.test.js`
- `tests/unit/services/PermissionService.test.js`

---

## Audit & Monitoring

### Audit Logs (`/api/audit`)
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| GET | `/api/audit/logs` | Admin+ | Get audit logs | AuditLogController | 🟠 |
| GET | `/api/audit/user/:userId` | Admin+ | User audit logs | AuditLogController | 🟠 |
| GET | `/api/audit/entity/:entityType/:entityId` | Admin+ | Entity logs | AuditLogController | 🟠 |
| GET | `/api/audit/entity/:entityType` | Admin+ | Logs by type | AuditLogController | 🟠 |
| GET | `/api/audit/statistics` | Admin+ | Audit statistics | AuditLogController | 🟡 |

---

## Notifications

### Notifications Resource (`/api/notifications`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/notifications` | `notifications.read` | Get notifications | NotificationsController |
| PATCH | `/api/notifications/:notificationId/read` | `notifications.update` | Mark as read | NotificationsController |
| PATCH | `/api/notifications/mark-all-read` | `notifications.update` | Mark all read | NotificationsController |

---

## Form Builder

### Forms Resource (`/api/forms`)
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/forms/templates` | Public | Get templates | FormController |
| GET | `/api/forms/:id` | Public | Get form definition | FormController |
| GET | `/api/forms/:id/render` | Public | Render form | FormController |
| POST | `/api/forms/:id/submit` | Mixed | Submit form | FormController |
| POST | `/api/forms/validate-field` | Mixed | Validate field | FormController |
| POST | `/api/forms/save-template` | Admin+ | Save template | FormController |
| GET | `/api/forms/:id/submissions` | Admin+ | Get submissions | FormController |
| GET | `/api/forms/:id/export` | Admin+ | Export data | FormController |
| DELETE | `/api/forms/submissions/:id` | Admin+ | Delete submission | FormController |

---

## Utilities & Exports

### Data Export
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/tarifario/export` | Dept Manager+ | Export tarifario | TarifarioExportController |

### Email Services
| Method | Path | Auth | Purpose | Controller | Risk |
|--------|------|------|---------|------------|------|
| POST | `/api/emails/send-test` | SuperAdmin | Send test email | EmailController | 🟠 |
| GET | `/api/emails/usage` | SuperAdmin | Email statistics | EmailController | 🟡 |

### External APIs
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/reviews/tripadvisor` | Public | TripAdvisor reviews | ReviewController |
| POST | `/api/contact` | Public (Rate Limited) | Contact form | ContactController |

### Debug & Testing
| Method | Path | Auth | Purpose | Controller |
|--------|------|------|---------|------------|
| GET | `/api/data` | JWT | Sample data | DataController |
| POST | `/api/debug/load-vehicle-images-call` | Dev | Debug images | DebugController |

---

## Authentication Matrix

### Public Endpoints (No Auth)
- System status and version
- Session health check
- Employee photos
- Optimized vehicle images
- TripAdvisor reviews
- Form templates
- Contact form

### JWT Required
- User profile management
- Basic data access
- Active dropdowns

### Permission-Based
- Specific permissions like `users.list`, `notifications.read`
- Granular access control

### Role-Based Access

| Role Level | Role Name | Access Level |
|------------|-----------|--------------|
| 7 | SuperAdmin | Full system access |
| 6 | Admin | Full CRUD operations |
| 5 | employee_amexing | Internal operations |
| 4 | department_manager | Department resources |
| 3 | client | Client resources |
| 3 | employee | Basic employee access |
| 2 | driver | Driver-specific access |
| 1 | guest | Minimal access |

---

## Risk Assessment

### Critical Endpoints (🔴)
- Authentication and logout
- User deletion and archival
- Billing and payment processing
- Invoice management
- Financial adjustments
- Password reset
- Role management

### High Risk Endpoints (🟠)
- User creation and updates
- Client management
- Employee management
- Quote processing
- Reservation management
- Audit log access
- Email services

### Medium Risk Endpoints (🟡)
- Data queries and listings
- Status toggles
- Profile updates
- Image uploads

### Low Risk Endpoints (🟢)
- Public status checks
- Read-only operations
- Static file serving

---

## Testing Coverage

### Well-Tested Components
- Authentication flows (`auth.test.js`, `mobile-auth-flows.test.js`)
- JWT middleware (`jwtMiddleware-rbac.test.js`)
- User management service (`UserManagementService.test.js`)
- Permission system (`permission-system.integration.test.js`)
- Employee controllers (`EmployeesController.test.js`)

### Partial Coverage
- Quote management
- Service pricing
- Vehicle management
- Tour availability

### Coverage Gaps
- Experience management (failing tests)
- Reservation workflows
- Billing operations
- Bulk import processes
- Form builder

---

## Middleware Stack

All API endpoints pass through:
1. **Rate Limiting** - Per-endpoint limits
2. **Security Middleware** - Headers, XSS protection
3. **JWT Validation** - Token verification
4. **Permission Checks** - RBAC validation
5. **Validation Middleware** - Request validation
6. **Audit Logging** - PCI DSS compliance
7. **Error Handling** - Standardized responses

---

## Related Documentation
- [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md) - Database structure
- [TEST-COVERAGE.md](./TEST-COVERAGE.md) - Test coverage analysis
- [PERMISSIONS-MATRIX.md](../PERMISSIONS-MATRIX.md) - Full RBAC matrix
- [TESTING-STRATEGY.md](../TESTING-STRATEGY.md) - Testing approach

---

Last Updated: May 6, 2026  
Created by: Denisse Maldonado