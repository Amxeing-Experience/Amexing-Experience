# Test Coverage Analysis

**Last Updated:** May 2026  
**Total Test Files:** 80+  
**Test Suites:** Unit + Integration + Security  
**Created by:** Denisse Maldonado  

## Overview

This document maps test coverage across the AmexingWeb codebase, identifying well-tested areas, partial coverage, and critical gaps. This mapping enables safe code modifications by understanding test protection levels.

## Test Statistics

| Category | Files | Tests | Status | Coverage |
|----------|-------|-------|--------|----------|
| Unit Tests | 45 | 900+ | ✅ 896 passing | ~80% |
| Integration Tests | 38 | 450+ | ⚠️ 428 passing | ~70% |
| Security Tests | 5 | 50+ | ✅ All passing | Critical paths |
| Component Tests | 12 | 150+ | ✅ All passing | UI components |
| Total | 100+ | 1500+ | 94% passing | ~75% overall |

---

## Critical Test Files (Regression Suite)

These tests run in <10 seconds and catch critical regressions:

### Authentication & Security
| Test File | Source Coverage | Status | Priority |
|-----------|----------------|--------|----------|
| `tests/integration/api/auth.test.js` | authController, JWT | ✅ Passing | 🔴 CRITICAL |
| `tests/integration/auth/mobile-auth-flows.test.js` | Mobile auth flow | ✅ Passing | 🔴 CRITICAL |
| `tests/unit/middleware/jwtMiddleware-rbac.test.js` | JWT validation | ✅ Passing | 🔴 CRITICAL |
| `tests/unit/services/AuthenticationService.test.js` | Auth service | ✅ Passing | 🔴 CRITICAL |
| `tests/integration/security/security.integration.test.js` | Security middleware | ✅ Passing | 🔴 CRITICAL |

### Database Operations
| Test File | Source Coverage | Status | Priority |
|-----------|----------------|--------|----------|
| `tests/integration/parseServer.test.js` | Parse Server setup | ✅ Passing | 🔴 CRITICAL |
| `tests/integration/cloud/beforeSave-amexinguser.test.js` | User hooks | ✅ Passing | 🔴 CRITICAL |
| `tests/integration/seed-system.test.js` | Seed integrity | ✅ Passing | 🟠 HIGH |

### Core API Endpoints
| Test File | Source Coverage | Status | Priority |
|-----------|----------------|--------|----------|
| `tests/integration/api/employees.test.js` | EmployeesController | ✅ Passing | 🟠 HIGH |
| `tests/integration/api/quotes-duplicate.test.js` | QuoteController | ✅ Passing | 🟠 HIGH |
| `tests/integration/api/health.test.js` | Health endpoints | ✅ Passing | 🟠 HIGH |

### RBAC & Permissions
| Test File | Source Coverage | Status | Priority |
|-----------|----------------|--------|----------|
| `tests/integration/rbac/permission-system.integration.test.js` | RBAC system | ✅ Passing | 🟠 HIGH |
| `tests/unit/services/PermissionService.test.js` | Permission service | ✅ Passing | 🟠 HIGH |

### Business Logic
| Test File | Source Coverage | Status | Priority |
|-----------|----------------|--------|----------|
| `tests/unit/services/BulkImportService.test.js` | Bulk import | ✅ Passing | 🟡 MEDIUM |
| `tests/unit/controllers/api/ClientEmployeesController.test.js` | Client employees | ✅ Passing | 🟡 MEDIUM |

---

## Controller → Test Mapping

### API Controllers

| Controller | Unit Tests | Integration Tests | Coverage | Risk |
|------------|------------|-------------------|----------|------|
| **EmployeesController** | ✅ Full | ✅ Full | 95% | 🟠 HIGH |
| **ClientsController** | ❌ None | ⚠️ Partial | 40% | 🔴 CRITICAL |
| **ClientEmployeesController** | ✅ Full | ❌ None | 60% | 🟠 HIGH |
| **QuoteController** | ❌ None | ✅ Full | 70% | 🟠 HIGH |
| **ServicesController** | ⚠️ Partial | ⚠️ Partial | 50% | 🟡 MEDIUM |
| **ExperienceController** | ⚠️ Failing | ❌ None | 20% | 🔴 CRITICAL |
| **VehicleController** | ❌ None | ⚠️ Partial | 30% | 🟡 MEDIUM |
| **ReservationController** | ❌ None | ❌ None | 0% | 🔴 CRITICAL |
| **InvoiceController** | ❌ None | ⚠️ Partial | 25% | 🔴 CRITICAL |
| **BillingController** | ❌ None | ❌ None | 0% | 🔴 CRITICAL |
| **UserManagementController** | ⚠️ Partial | ✅ Full | 80% | 🟠 HIGH |
| **RolesController** | ❌ None | ✅ Full | 60% | 🟠 HIGH |
| **POIController** | ❌ None | ❌ None | 0% | 🟡 MEDIUM |
| **ToursController** | ❌ None | ⚠️ Partial | 30% | 🟡 MEDIUM |
| **BulkImportController** | ✅ Full | ❌ None | 50% | 🟡 MEDIUM |

### Dashboard Controllers

| Controller | Unit Tests | Integration Tests | Coverage |
|------------|------------|-------------------|----------|
| **dashboardController** | ❌ None | ⚠️ Partial | 30% |
| **authController** | ✅ Full | ✅ Full | 90% |
| **changePasswordController** | ✅ Full | ✅ Full | 85% |

---

## Service → Test Mapping

| Service | Unit Tests | Integration Tests | Coverage | Risk |
|---------|------------|-------------------|----------|------|
| **AuthenticationService** | ✅ Full | ✅ Full | 95% | 🔴 CRITICAL |
| **UserManagementService** | ⚠️ Partial | ✅ Full | 85% | 🟠 HIGH |
| **PermissionService** | ✅ Full | ✅ Full | 90% | 🔴 CRITICAL |
| **BulkImportService** | ✅ Full | ❌ None | 70% | 🟡 MEDIUM |
| **EmailService** | ⚠️ Partial | ⚠️ Partial | 60% | 🟠 HIGH |
| **FileStorageService** | ❌ None | ⚠️ Partial | 40% | 🟡 MEDIUM |
| **ImageOptimizationService** | ❌ None | ✅ Full | 50% | 🟢 LOW |
| **QuoteService** | ❌ None | ⚠️ Partial | 30% | 🟠 HIGH |
| **ReservationService** | ❌ None | ❌ None | 0% | 🔴 CRITICAL |
| **InvoiceService** | ❌ None | ❌ None | 0% | 🔴 CRITICAL |

---

## Middleware → Test Mapping

| Middleware | Unit Tests | Integration Tests | Coverage |
|------------|------------|-------------------|----------|
| **jwtMiddleware** | ✅ Full | ✅ Full | 95% |
| **authMiddleware** | ✅ Full | ✅ Full | 90% |
| **dashboardAuthMiddleware** | ⚠️ Partial | ⚠️ Failing | 40% |
| **validationMiddleware** | ✅ Full | ⚠️ Partial | 70% |
| **rateLimitMiddleware** | ❌ None | ✅ Full | 60% |
| **securityMiddleware** | ⚠️ Partial | ✅ Full | 80% |
| **sessionRecoveryMiddleware** | ❌ None | ✅ Full | 50% |

---

## Test Categories

### Well-Tested Areas (>80% Coverage)
✅ **Excellent coverage, safe to modify**

- Authentication system (JWT, login/logout)
- RBAC and permissions
- User management operations
- Employee CRUD operations
- Password management
- Audit logging
- Parse Cloud hooks
- Seed system integrity

### Partially Tested (40-80% Coverage)
⚠️ **Modify with caution, run related tests**

- Quote management
- Service pricing
- Client management
- Email operations
- Dashboard authentication
- Vehicle management
- Tour operations
- File uploads

### Critical Gaps (<40% Coverage)
❌ **High risk, needs test coverage before modification**

- Reservation workflows
- Invoice generation
- Billing operations
- Payment processing
- Experience management
- POI management
- Bulk operations (except import)
- Cancellation workflows

---

## Test File Organization

```
tests/
├── unit/                          # Fast, isolated tests
│   ├── controllers/
│   │   ├── api/                  # API controller tests
│   │   └── authController.test.js
│   ├── middleware/                # Middleware tests
│   ├── services/                  # Service layer tests
│   └── views/                     # View/template tests
│
├── integration/                   # Full stack tests
│   ├── api/                      # API endpoint tests
│   ├── auth/                     # Authentication flows
│   ├── cloud/                    # Parse Cloud functions
│   ├── components/               # UI component integration
│   ├── dashboard/                # Dashboard workflows
│   ├── email/                    # Email service tests
│   ├── frontend/                 # Frontend integration
│   ├── rbac/                     # Permission tests
│   ├── security/                 # Security tests
│   └── seeds/                    # Seed data tests
│
├── regression/                    # Fast smoke tests
│   └── critical-tests.json      # Test configuration
│
├── helpers/                       # Test utilities
│   ├── authTestHelper.js        # Authentication helpers
│   ├── testCleanupHelper.js     # Cleanup utilities
│   └── mockDataHelper.js        # Mock data generation
│
└── __mocks__/                    # Module mocks
    └── exceljs.js               # ESM compatibility fix
```

---

## Test Execution Patterns

### Running Specific Test Categories

```bash
# Fast regression tests (<10 seconds)
yarn test:regression

# Unit tests only (no database)
yarn test:unit

# Integration tests (MongoDB Memory Server)
yarn test:integration

# Security validation
yarn test:security

# Component tests
yarn test:components

# Full test suite
yarn test
```

### Running Tests for Specific Areas

```bash
# Test specific controller
yarn test tests/unit/controllers/api/EmployeesController.test.js

# Test authentication flows
yarn test tests/integration/auth

# Test RBAC system
yarn test tests/integration/rbac

# Test API endpoints
yarn test tests/integration/api
```

---

## Test Dependencies

### Critical Test Infrastructure
| Component | Purpose | Used By |
|-----------|---------|---------|
| **MongoDB Memory Server** | In-memory database | All integration tests |
| **AuthTestHelper** | Login simulation | Most integration tests |
| **Parse Server (1339)** | Test Parse instance | Integration tests |
| **Seeded RBAC** | Pre-configured roles | Permission tests |
| **TestCleanupHelper** | Data cleanup | Integration tests |

### Test User Credentials
All test users use domain `@amexing.test` with password `TestPass123!`

| Role | Email |
|------|-------|
| superadmin | test-superadmin@amexing.test |
| admin | test-admin@amexing.test |
| client | test-client@amexing.test |
| department_manager | test-department-manager@amexing.test |
| employee | test-employee@amexing.test |
| employee_amexing | test-employee-amexing@amexing.test |
| driver | test-driver@amexing.test |
| guest | test-guest@amexing.test |

---

## Known Test Issues

### Currently Failing Tests (~27)
1. **Dashboard authentication** - Cookie vs token mismatch
2. **Frontend integration** - Redirect handling issues
3. **Experience controller** - 15 failing unit tests
4. **Some API response validations** - Pagination field mismatches

### Flaky Tests
- Tests dependent on external services
- Tests with timing dependencies
- Tests requiring specific MongoDB state

### Test Debt
- Missing reservation workflow tests
- No invoice generation tests
- Limited billing operation coverage
- No end-to-end user journey tests

---

## Impact Analysis Matrix

When modifying files, check this matrix for required test runs:

| File Modified | Must Run Tests | Risk Level |
|---------------|----------------|------------|
| `jwtMiddleware.js` | ALL auth tests + regression | 🔴 CRITICAL |
| `authController.js` | auth.test.js + mobile-auth | 🔴 CRITICAL |
| `EmployeesController.js` | employees.test.js + integration | 🟠 HIGH |
| `UserManagementService.js` | UserManagement tests | 🟠 HIGH |
| `PermissionService.js` | RBAC tests + regression | 🔴 CRITICAL |
| `QuoteController.js` | quotes-duplicate.test.js | 🟠 HIGH |
| `dashboardAuthMiddleware.js` | Frontend integration tests | 🟠 HIGH |
| Any Parse Cloud hook | cloud/ tests + integration | 🔴 CRITICAL |
| Any domain model | Related controller tests | 🟡 MEDIUM |
| Any service | Service unit tests | 🟡 MEDIUM |

---

## Test Coverage Improvement Plan

### Priority 1: Critical Gaps
1. **Reservation workflows** - Full CRUD + status transitions
2. **Invoice generation** - Creation, PDF generation, sending
3. **Billing operations** - Payment processing, profiles
4. **Experience management** - Fix failing tests first

### Priority 2: High-Value Areas
1. **Client management** - Complete CRUD coverage
2. **Quote workflows** - Status transitions, collaboration
3. **Dashboard authentication** - Fix cookie issues
4. **Cancellation flows** - Request and approval

### Priority 3: Nice to Have
1. **POI management** - Basic CRUD
2. **Tour operations** - Pricing and availability
3. **Vehicle management** - Complete coverage
4. **End-to-end tests** - User journey tests

---

## Testing Best Practices

### When Adding New Features
1. Write integration test first (TDD)
2. Implement feature
3. Add to regression suite if critical
4. Update this coverage map

### Before Modifying Code
1. Check coverage map for file
2. Run related tests
3. Use `yarn dev:watch` for real-time feedback
4. Run regression suite before commit

### Test Maintenance
1. Keep tests under 10 seconds for regression
2. Use AuthTestHelper for authentication
3. Never hard-code test credentials
4. Clean up test data properly

---

## Related Documentation
- [API-ENDPOINTS.md](./API-ENDPOINTS.md) - API endpoint listing
- [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md) - Database structure
- [TESTING-STRATEGY.md](../TESTING-STRATEGY.md) - Testing approach
- [REGRESSION-PREVENTION-PROGRESS.md](../REGRESSION-PREVENTION-PROGRESS.md) - Progress tracking

---

Last Updated: May 6, 2026  
Created by: Denisse Maldonado