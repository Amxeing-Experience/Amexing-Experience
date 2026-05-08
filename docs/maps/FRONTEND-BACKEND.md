# Frontend-Backend Coupling Map

## Overview

This document maps the relationship between frontend EJS templates and backend API controllers/services in the Amexing Experience platform. This is part of the Phase 3 Advanced Mapping strategy for regression prevention.

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Route-Controller Mapping](#2-route-controller-mapping) 
- [3. Atomic Design Structure](#3-atomic-design-structure)
- [4. Dashboard-API Coupling](#4-dashboard-api-coupling)
- [5. Authentication Flow](#5-authentication-flow)
- [6. Critical Coupling Points](#6-critical-coupling-points)
- [7. Risk Analysis](#7-risk-analysis)

---

## 1. Architecture Overview

### Frontend Structure
```
src/presentation/
├── routes/           # Route definitions (7 route modules)
├── views/           # EJS template hierarchy
│   ├── atoms/       # Basic UI elements (form inputs, buttons)
│   ├── molecules/   # Component combinations (modals, cards)
│   ├── organisms/   # Complex components (navbars, datatables)
│   ├── templates/   # Page layouts and templates
│   ├── dashboards/  # Role-specific dashboard views (8 roles)
│   ├── auth/        # Authentication pages
│   ├── landing/     # Public landing pages
│   └── docs/        # Documentation pages
└── static/          # Static assets (CSS, JS, images)
```

### Backend Structure
```
src/application/
├── controllers/
│   ├── api/              # 47+ API controllers 
│   ├── dashboard/        # 8+ dashboard controllers
│   ├── authController.js # Authentication controller
│   └── apiController.js  # Main API controller
├── middleware/           # Authentication, validation, security
└── services/            # Business logic services
```

---

## 2. Route-Controller Mapping

### Route Modules (src/presentation/routes/)

| Route Module | Purpose | Controllers | Template Scope |
|--------------|---------|-------------|----------------|
| **webRoutes.js** | Public pages | Landing, Home | `/landing/`, `/` |
| **apiRoutes.js** | REST API | 47+ API controllers | JSON responses |
| **authRoutes.js** | Authentication | AuthController | `/auth/` |
| **dashboardRoutes.js** | Role dashboards | 8 dashboard controllers | `/dashboards/` |
| **atomicRoutes.js** | Component showcase | AtomicController | `/atomic/` |
| **docsRoutes.js** | Documentation | DocsController | `/docs/` |
| **publicRoutes.js** | Static content | PublicController | `/public/` |

### Dashboard Routes by Role

#### SuperAdmin Routes (Level 7)
```javascript
Base: /dashboard/superadmin/
Templates: src/presentation/views/dashboards/superadmin/
Controller: SuperAdminController

Routes:
├── / (index)              → index.ejs
├── /profile               → profile.ejs  
├── /users                 → users.ejs
├── /roles                 → roles.ejs
├── /clients               → clients.ejs
├── /tours                 → tours.ejs
├── /permissions           → permissions.ejs
├── /analytics             → analytics.ejs
├── /reports               → reports.ejs
├── /emails                → emails.ejs
├── /audit                 → audit.ejs
├── /settings              → settings.ejs
├── /integrations          → integrations.ejs
├── /security              → security.ejs
├── /compliance            → compliance.ejs
├── /vehicles              → vehicles.ejs
├── /services              → services.ejs
├── /experiences           → experiences.ejs
├── /greeter               → greeter.ejs
└── /tarifario-export      → tarifario-export.ejs
```

#### Admin Routes (Level 6)
```javascript
Base: /dashboard/admin/
Templates: src/presentation/views/dashboards/admin/
Controller: AdminController

Routes:
├── / (index)              → index.ejs
├── /profile               → profile.ejs
├── /clients               → clients.ejs
├── /clients/:id           → client-detail.ejs
├── /departments           → departments.ejs
├── /employees             → employees.ejs
├── /drivers               → drivers.ejs
├── /events                → events.ejs
├── /experiences           → experiences.ejs
├── /experiences/:id       → experience-detail.ejs
├── /schedule              → schedule.ejs
├── /bookings              → bookings.ejs
├── /bookings/:id          → booking-detail.ejs
├── /vehicles              → vehicles.ejs
├── /price-settings        → price-settings.ejs
├── /pois                  → pois.ejs
├── /services              → services.ejs
├── /a-disposicion         → a-disposicion.ejs
├── /pricing               → pricing.ejs
├── /tours                 → tours.ejs
├── /greeter               → greeter.ejs
├── /quotes                → quotes.ejs
├── /quotes/:id            → quote-detail.ejs
├── /invoices              → invoices.ejs
├── /payment-info          → payment-info.ejs
├── /fleet                 → fleet.ejs
├── /routes                → routes.ejs
├── /billing               → billing.ejs
├── /reports               → reports.ejs
├── /settings              → settings.ejs
├── /notifications         → notifications.ejs
├── /forms                 → forms.ejs
├── /form-preview          → form-preview.ejs
└── /tarifario-export      → tarifario-export.ejs
```

#### Client Routes (Level 5)
```javascript
Base: /dashboard/client/
Templates: src/presentation/views/dashboards/client/
Controller: ClientController
Default: Redirects to /vehicles

Routes:
├── /profile               → profile.ejs
├── /clients               → owned-clients.ejs
├── /departments           → departments.ejs
├── /employees             → employees.ejs
├── /team                  → team.ejs
├── /bookings              → bookings.ejs
├── /bookings/:id          → booking-detail.ejs
├── /budgets               → budgets.ejs
└── /reports               → reports.ejs

Note: Many routes redirect to departments.ejs
```

#### Department Manager Routes (Level 4)
```javascript
Base: /dashboard/department_manager/
Templates: src/presentation/views/dashboards/department_manager/
Controller: DepartmentManagerController
```

#### Employee Routes (Level 3)
```javascript
Base: /dashboard/employee/
Templates: src/presentation/views/dashboards/employee/
Controller: EmployeeController
```

#### Driver Routes (Level 2)
```javascript
Base: /dashboard/driver/
Templates: src/presentation/views/dashboards/driver/
Controller: DriverController
```

#### Guest Routes (Level 1)
```javascript
Base: /dashboard/guest/
Templates: src/presentation/views/dashboards/guest/
Controller: GuestController
```

---

## 3. Atomic Design Structure

### Component Hierarchy

#### Atoms (Basic Elements)
```
src/presentation/views/atoms/
├── common/           # Shared across all contexts
├── auth/             # Authentication specific
├── dashboard/        # Dashboard specific
├── navigation/       # Navigation elements
└── form/             # Form elements
```

#### Molecules (Component Combinations)  
```
src/presentation/views/molecules/
├── common/           # Shared combinations
├── auth/             # Auth-specific molecules
├── dashboard/        # Dashboard molecules (modals, cards)
├── navigation/       # Navigation components
└── cards/            # Card components
```

#### Organisms (Complex Components)
```
src/presentation/views/organisms/
├── common/           # Shared complex components
├── auth/             # Authentication flows
├── dashboard/        # Dashboard organisms
│   ├── navigation/   # Dashboard navigation
│   ├── modals/       # Dashboard modals
│   └── header/       # Dashboard headers
├── landing/          # Landing page organisms
├── forms/            # Complex form organisms
├── modal/            # Modal organisms
├── datatable/        # DataTable organisms
├── services/         # Service-related organisms
├── billing/          # Billing organisms
├── experiences/      # Experience organisms
└── profile/          # Profile organisms
```

#### Templates & Pages
```
src/presentation/views/dashboards/[role]/
Each role has its own template directory with:
├── index.ejs         # Dashboard home
├── profile.ejs       # User profile
├── [feature].ejs     # Feature-specific pages
└── change-password.ejs # Password change
```

### Component Showcase System
```javascript
Routes: /atomic/[category] 
Purpose: Component development, testing, documentation
Controllers: AtomicController
Categories: dashboard, auth, common
```

---

## 4. Dashboard-API Coupling

### Critical AJAX Dependencies

#### DataTable Components
```javascript
Template: /organisms/datatable/
JavaScript: Makes AJAX calls to multiple APIs
Coupling Level: HIGH

API Dependencies:
├── /api/users              → UserManagement, AmexingUsers
├── /api/clients            → ClientsController
├── /api/employees          → EmployeesController
├── /api/quotes             → QuoteController
├── /api/reservations       → ReservationController
├── /api/invoices           → InvoiceController
├── /api/vehicles           → VehicleController
├── /api/tours              → ToursController
└── /api/services           → ServiceController, ServicesController
```

#### Modal Components
```javascript
Templates: /organisms/dashboard/modals/
JavaScript: Dynamic form submission via AJAX
Coupling Level: HIGH

Modal Types → API Endpoints:
├── Client Modal           → /api/clients/*
├── Employee Modal         → /api/employees/*
├── Billing Profile Modal → /api/billing/*
├── Quote Edit Modal       → /api/quotes/*
├── Service Modal          → /api/services/*
├── Vehicle Modal          → /api/vehicles/*
└── User Management Modal → /api/users/*
```

#### Form Components
```javascript
Templates: /organisms/forms/
JavaScript: Real-time validation + submission
Coupling Level: MEDIUM-HIGH

Form Types → API Endpoints:
├── Quote Forms            → /api/quotes/*, /api/quote-collaboration/*
├── Experience Forms       → /api/experiences/*
├── Billing Forms          → /api/billing/*, /api/payment-info/*
├── Profile Forms          → /api/profile/*
├── Authentication Forms   → /api/auth/*
└── Service Forms          → /api/services/*, /api/service-types/*
```

### Role-Based API Access Patterns

#### SuperAdmin Dashboard
```javascript
Template Access: ALL templates
API Access: ALL 47+ API controllers
Special Features:
├── System Administration   → /api/audit/*, /api/roles/*
├── Compliance Monitoring   → /api/compliance/*
├── User Management         → /api/users/*, /api/amexing-users/*
├── Tarifario Export        → /api/tarifario-export/*
└── Security Management     → /api/security/*
```

#### Admin Dashboard  
```javascript
Template Access: Admin-specific templates
API Access: ~35 API controllers
Key Features:
├── Client Management       → /api/clients/*, /api/owned-clients/*
├── Employee Management     → /api/employees/*, /api/client-employees/*
├── Quote Management        → /api/quotes/*, /api/quote-ownership/*
├── Experience Management   → /api/experiences/*
├── Billing & Invoices      → /api/invoices/*, /api/billing/*
└── Fleet Management        → /api/vehicles/*, /api/tours/*
```

#### Client Dashboard
```javascript
Template Access: Client-specific templates  
API Access: ~20 API controllers
Scope: Organization-limited
Key Features:
├── Department Management   → /api/departments/*
├── Employee Management     → /api/employees/* (filtered)
├── Booking Management      → /api/bookings/* (filtered)
├── Budget Tracking         → /api/budgets/*
└── Reporting               → /api/reports/* (filtered)
```

#### Department Manager Dashboard
```javascript
Template Access: Dept-specific templates
API Access: ~15 API controllers  
Scope: Department-limited
Key Features:
├── Team Management         → /api/employees/* (dept-filtered)
├── Booking Approval        → /api/bookings/* (dept-filtered)
├── Service Requests        → /api/quotes/* (dept-filtered)
└── Department Reports      → /api/reports/* (dept-filtered)
```

#### Employee Dashboard
```javascript
Template Access: Employee templates
API Access: ~8 API controllers
Scope: Own records + department-limited
Key Features:
├── Profile Management      → /api/profile/*
├── Service Requests        → /api/quotes/* (own)
├── Booking Requests        → /api/bookings/* (own)
└── Service Catalog         → /api/services/* (read-only)
```

---

## 5. Authentication Flow

### Frontend Authentication Components
```javascript
Templates: src/presentation/views/auth/
├── login.ejs               → AuthController.login()
├── register.ejs            → AuthController.register()  
├── forgot-password.ejs     → AuthController.forgotPassword()
├── reset-password.ejs      → AuthController.resetPassword()
└── verify-email.ejs        → AuthController.verifyEmail()
```

### Backend Authentication Endpoints
```javascript
Controller: src/application/controllers/authController.js
Routes: src/presentation/routes/authRoutes.js

Flow:
├── POST /login             → authController.login()
├── POST /register          → authController.register()
├── POST /logout            → authController.logout()
├── POST /forgot-password   → authController.forgotPassword()
├── POST /reset-password    → authController.resetPassword()
├── GET  /verify-email      → authController.verifyEmail()
└── GET  /auth/current-token → API endpoint for AJAX
```

### Session & JWT Management
```javascript
Frontend: HttpOnly cookies + CSRF tokens
Backend: JWT validation middleware

Critical Dependencies:
├── dashboardAuthMiddleware.js  → Dashboard protection
├── jwtMiddleware.js           → API protection  
├── sessionRecovery.js         → Session restoration
└── auditContextMiddleware.js  → Audit logging
```

---

## 6. Critical Coupling Points

### High-Risk Coupling Areas

#### 1. DataTable JavaScript Dependencies
```javascript
Risk Level: CRITICAL
Impact: Dashboard functionality breaks completely

Files Affected:
├── /organisms/datatable/*.ejs
├── /public/js/datatable-*.js  
└── Multiple API controllers

Breaking Change Scenarios:
├── API endpoint URL changes
├── Response format changes
├── Authentication changes
├── Permission model changes
└── Database schema changes
```

#### 2. Modal Form Submissions
```javascript  
Risk Level: HIGH
Impact: User actions fail silently or with errors

Files Affected:
├── /organisms/dashboard/modals/*.ejs
├── /molecules/dashboard/*.ejs
└── Form-handling API controllers

Breaking Change Scenarios:
├── Form validation changes
├── Field name changes
├── API endpoint changes
├── Response format changes
└── File upload handling changes
```

#### 3. Real-Time Features
```javascript
Risk Level: HIGH  
Impact: Live updates stop working

Files Affected:
├── Dashboard notification systems
├── Live quote updates  
├── Booking status updates
└── Chat/messaging features

Dependencies:
├── WebSocket connections (if any)
├── Polling mechanisms
├── Event-driven updates
└── Push notification systems
```

#### 4. Role-Based UI Components
```javascript
Risk Level: MEDIUM-HIGH
Impact: Unauthorized access or missing features

Files Affected:
├── Role-specific navigation
├── Conditional UI elements
├── Permission-based buttons
└── Feature availability toggles

Dependencies:
├── RBAC permission system
├── Role hierarchy changes  
├── Permission matrix updates
└── Dashboard middleware
```

### Medium-Risk Coupling Areas

#### 1. Static Asset Dependencies
```javascript
Risk Level: MEDIUM
Impact: Styling/UX issues

Files Affected:
├── CSS framework dependencies (Flexy Bootstrap)
├── JavaScript library versions
├── Icon font dependencies
└── Image asset references
```

#### 2. Template Inheritance
```javascript
Risk Level: MEDIUM
Impact: Layout/structure issues

Dependencies:
├── Layout template changes
├── Shared organism updates
├── Atomic component modifications
└── CSS class changes
```

---

## 7. Risk Analysis

### Potential Breaking Changes

#### Backend Changes That Break Frontend

| Change Type | Risk Level | Frontend Impact | Mitigation Strategy |
|-------------|------------|----------------|-------------------|
| **API URL Changes** | CRITICAL | AJAX calls fail | API versioning, URL mapping |
| **Response Format Changes** | HIGH | JavaScript errors | Response contracts, testing |
| **Authentication Changes** | HIGH | Login failures | Gradual migration, fallbacks |
| **Permission Changes** | HIGH | Access errors | Permission testing, validation |
| **Database Schema Changes** | MEDIUM | Data display issues | API abstraction layer |
| **Controller Method Changes** | MEDIUM | Route errors | Route testing, documentation |

#### Frontend Changes That Break Backend

| Change Type | Risk Level | Backend Impact | Mitigation Strategy |
|-------------|------------|---------------|-------------------|
| **Form Field Changes** | HIGH | Validation errors | Schema validation |
| **AJAX Parameter Changes** | HIGH | API errors | Parameter validation |
| **File Upload Changes** | MEDIUM | Upload failures | File validation |
| **Authentication Flow Changes** | MEDIUM | Session issues | Auth testing |

### Testing Strategy Recommendations

#### Critical Test Coverage Needed
```javascript
1. API Contract Testing
   - Response format stability
   - Authentication requirements
   - Permission enforcement

2. Integration Testing  
   - Dashboard → API interactions
   - Form submission flows
   - File upload processes
   - Authentication flows

3. UI Component Testing
   - Modal functionality
   - DataTable operations  
   - Form validation
   - Navigation flows

4. Role-Based Testing
   - Permission enforcement
   - UI element visibility
   - Feature accessibility
   - Data filtering
```

#### Regression Prevention
```javascript
1. API Change Detection
   - Monitor endpoint responses
   - Track authentication flows
   - Validate permission checks

2. Frontend Monitoring
   - AJAX error tracking
   - JavaScript error logging  
   - Performance monitoring
   - User interaction tracking

3. Integration Monitoring
   - Dashboard load success
   - Form submission rates
   - Authentication success rates
   - Feature usage patterns
```

### Development Guidelines

#### Safe Change Practices
```javascript
1. API Changes
   - Use API versioning
   - Maintain backward compatibility
   - Test with frontend integration tests
   - Document breaking changes

2. Frontend Changes
   - Test against actual API endpoints
   - Validate form submissions
   - Check role-based functionality
   - Verify authentication flows

3. Database Changes
   - Use migrations with rollback capability
   - Test API response formats
   - Validate data relationships
   - Check permission filtering
```

---

## Implementation Notes

### Key Monitoring Points
```javascript
1. Dashboard Load Performance
   - Initial page load times
   - API response times
   - JavaScript error rates
   - Authentication success rates

2. User Interaction Success
   - Form submission success rates
   - Modal operation success rates
   - DataTable operation success rates
   - Navigation success rates

3. API Integration Health
   - Endpoint availability
   - Response format consistency
   - Authentication token validity
   - Permission enforcement accuracy
```

### Development Tools Needed
```javascript
1. API Contract Testing Tools
   - Schema validation
   - Response format testing
   - Authentication testing
   - Permission testing

2. Frontend Integration Testing
   - AJAX interaction testing
   - Form submission testing
   - UI component testing
   - Cross-browser testing

3. Monitoring & Alerting
   - API change detection
   - Frontend error tracking
   - Performance monitoring
   - User experience tracking
```

---

*This document should be updated whenever significant frontend-backend coupling changes occur. Last updated: May 2026*