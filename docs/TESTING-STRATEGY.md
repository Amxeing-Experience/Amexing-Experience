# Testing Strategy & Regression Prevention

## Overview
This document outlines our testing strategy to prevent regression bugs and ensure code quality throughout the development lifecycle.

## Problem Statement
- **Current Issue:** Changes in one area break functionality in another
- **Discovery Time:** Too late (at commit/push time)
- **Impact:** Slow development, fear of making changes, production bugs

## Solution: Multi-Layer Testing Strategy

### Layer 1: Immediate Feedback (Development Time)
**When:** Every file save  
**Duration:** <10 seconds  
**Coverage:** Critical paths only

#### Regression Test Suite (`yarn test:regression`)
```bash
# Run fast smoke tests
yarn test:regression

# What it tests:
- Authentication (JWT/Session)
- Core API endpoints
- Database connections
- Permission checks
- Critical business logic
```

### Layer 2: Focused Testing (Pre-Commit)
**When:** Before making commits  
**Duration:** <30 seconds  
**Coverage:** Changed files and dependencies

#### Impact Analysis (`yarn impact:check <file>`)
```bash
# Check impact before editing
yarn impact:check src/application/controllers/api/EmployeesController.js

# Output:
# ⚠️ HIGH RISK FILE
# Affects: 23 tests, 5 direct dependencies
# Test coverage: 87%
# Last broken: 3 days ago
# Suggested tests to run: employee.test.js, auth.test.js
```

### Layer 3: Comprehensive Testing (Pre-Push)
**When:** Before pushing to remote  
**Duration:** ~2 minutes  
**Coverage:** Full test suite

#### Current Setup
- Unit tests
- Integration tests (MongoDB Memory Server)
- Security tests
- OAuth tests

---

## High-Risk Files
These files require extra caution when modifying:

### Critical Infrastructure
| File | Risk Level | Why | Tests to Run |
|------|------------|-----|--------------|
| `src/application/middleware/jwtMiddleware.js` | 🔴 CRITICAL | Affects all authenticated routes | `yarn test:auth` |
| `src/application/middleware/dashboardAuthMiddleware.js` | 🔴 CRITICAL | Dashboard access control | `yarn test:integration` |
| `src/cloud/main.js` | 🔴 CRITICAL | Parse hooks affect all DB operations | `yarn test:integration` |
| `src/cloud/hooks/auditTrailHooks.js` | 🔴 CRITICAL | Email validation, audit logging | `yarn test:integration` |

### High-Traffic Controllers
| File | Risk Level | Why | Tests to Run |
|------|------------|-----|--------------|
| `src/application/controllers/api/EmployeesController.js` | 🟠 HIGH | User management | `yarn test:api` |
| `src/application/controllers/api/QuotesController.js` | 🟠 HIGH | Core business logic | `yarn test:api` |
| `src/application/services/UserManagementService.js` | 🟠 HIGH | User operations | `yarn test:unit` |

### Data Models
| File | Risk Level | Why | Tests to Run |
|------|------------|-----|--------------|
| `src/domain/models/AmexingUser.js` | 🟠 HIGH | User model changes | `yarn test:integration` |
| `src/domain/models/Client.js` | 🟡 MEDIUM | Client operations | `yarn test:unit` |

---

## Common Breaking Patterns

### Pattern 1: Changing Response Structure
**Example:** Adding pagination to API response
```javascript
// Before
return { users: [...] }

// After (BREAKING)
return { data: { users: [...], pagination: {...} } }
```
**Prevention:** Always maintain backward compatibility or version APIs

### Pattern 2: Modifying Middleware
**Example:** Changing authentication token extraction
```javascript
// Changed from cookies to headers
const token = req.headers.authorization; // Breaks dashboard routes!
```
**Prevention:** Support multiple token sources

### Pattern 3: Database Field Changes
**Example:** Renaming or removing fields
```javascript
// Renamed 'active' to 'isActive'
user.get('isActive'); // Breaks all existing queries!
```
**Prevention:** Add new field, migrate data, deprecate old field

### Pattern 4: Parse Hook Modifications
**Example:** Adding validation in beforeSave
```javascript
// New validation breaks existing data
if (!user.get('email')) throw error; // Breaks tests with mock data!
```
**Prevention:** Check for test environment, handle edge cases

---

## Testing Best Practices

### 1. Before Making Changes
```bash
# 1. Check current test status
yarn test:regression

# 2. Analyze impact
yarn impact:check <file-to-modify>

# 3. Create baseline
git stash
yarn test > baseline.txt
git stash pop
```

### 2. While Making Changes
```bash
# Run watch mode
yarn dev:watch

# You'll see:
# 👀 Watching for changes...
# ✅ All regression tests passing
# 
# [Make change]
# 
# ❌ 2 tests failing:
#   - employee.pagination.test.js
#   - employee.filter.test.js
```

### 3. After Making Changes
```bash
# 1. Run affected tests
yarn test:affected

# 2. Run regression suite
yarn test:regression

# 3. Run full suite before commit
yarn test
```

---

## Test Organization

### Unit Tests (`tests/unit/`)
- Fast, isolated tests
- No external dependencies
- Mock all services/databases
- Target: <5 seconds total

### Integration Tests (`tests/integration/`)
- Test full workflows
- Use MongoDB Memory Server
- Real Parse Server instance
- Target: <2 minutes total

### Regression Tests (`tests/regression/`)
- Subset of critical tests
- Fastest possible execution
- Core functionality only
- Target: <10 seconds total

---

## Emergency Procedures

### When Tests Are Failing

#### 1. Identify Scope
```bash
# See all failing tests
yarn test 2>&1 | grep "FAIL"

# Run specific test for details
yarn test <specific-test-file>
```

#### 2. Quick Rollback
```bash
# If you need to quickly undo
git stash  # Save your changes
yarn test  # Verify tests pass
git stash pop  # Reapply changes carefully
```

#### 3. Bisect to Find Breaking Change
```bash
# Find which commit broke tests
git bisect start
git bisect bad  # Current commit is bad
git bisect good <last-known-good-commit>
# Git will help find the breaking commit
```

---

## Metrics & Goals

### Current State (May 2026)
- **Test Suite Size:** ~600 tests
- **Execution Time:** ~110 seconds
- **Pass Rate:** 94%+
- **Feedback Time:** At push (too late)

### Target State (July 2026)
- **Regression Suite:** <10 seconds
- **Feedback Time:** <10 seconds from save
- **Pass Rate:** 99%+
- **Regression Bugs:** 90% reduction

---

## Tools & Commands Reference

### Quick Reference
```bash
# Daily Development
yarn dev:watch          # Auto-test on changes
yarn test:regression    # Quick smoke test
yarn impact:check       # Check before editing

# Before Commit
yarn test:affected      # Test changed areas
yarn lint:fix          # Fix code style

# Before Push
yarn test              # Full test suite
yarn test:security     # Security validation
```

### Troubleshooting
```bash
# If tests hang
yarn test --detectOpenHandles

# If MongoDB issues
pkill mongod
yarn test

# If Parse Server issues
yarn test --runInBand

# Generate coverage report
yarn test:coverage
```

---

## FAQ

**Q: Tests are too slow, can I skip them?**  
A: No, but use `yarn test:regression` for quick checks during development.

**Q: How do I know what tests to run?**  
A: Use `yarn impact:check <file>` to see affected tests.

**Q: Tests pass locally but fail in CI?**  
A: Check environment variables, ensure clean database state.

**Q: Can I disable a flaky test?**  
A: Use `test.skip` temporarily, but create issue to fix it.

---

## Related Documents
- [REGRESSION-PREVENTION-PROGRESS.md](./REGRESSION-PREVENTION-PROGRESS.md) - Implementation progress
- [API-ENDPOINTS.md](./maps/API-ENDPOINTS.md) - API documentation
- [DATABASE-SCHEMA.md](./maps/DATABASE-SCHEMA.md) - Database structure
- [BUSINESS-FLOWS.md](./maps/BUSINESS-FLOWS.md) - Business logic flows

---

Last Updated: May 5, 2026