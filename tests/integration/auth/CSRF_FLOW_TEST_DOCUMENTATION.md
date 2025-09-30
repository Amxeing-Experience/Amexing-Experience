# CSRF Token Flow Integration Tests - Documentation

## Overview

This document describes the comprehensive integration test suite for the CSRF token flow during logout/login cycles in AmexingWeb.

## Test File Location

`/Users/black4ninja/Meeplab/Amexing/amexing-web/tests/integration/auth/csrf-logout-login-flow.test.js`

## Background

### The Bug

Users were experiencing "No CSRF secret found in session" errors when logging out and immediately logging back in. This was a race condition bug that occurred when:

1. User logs out
2. Session is destroyed
3. User immediately tries to access login page
4. New session hasn't been created yet with CSRF secret
5. Error: "No CSRF secret found in session"

### The Fix

Three key changes were implemented:

1. **dashboardAuthMiddleware.js**: Changed `session.destroy()` to `session.regenerate()` with immediate CSRF secret initialization
2. **authController.js**: Added defensive checks to ensure CSRF secret exists in all form-rendering methods (showLogin, showRegister, showForgotPassword, showResetPassword)
3. **securityMiddleware.js**: Enhanced logging and automatic CSRF secret generation when missing

## Test Suite Structure

### Test Categories

The test suite includes 10 comprehensive test categories covering all aspects of CSRF token flow:

#### 1. Session Regeneration After Logout
**Purpose**: Validates that session regeneration works correctly

**Tests**:
- Session ID changes after logout (regenerated, not destroyed)
- New CSRF token is different from old token
- New CSRF token is valid and can be used

**Timeout**: 45 seconds

#### 2. Immediate Re-login After Logout
**Purpose**: Validates that users can logout and immediately login without errors

**Tests**:
- User can logout and immediately access login page
- CSRF token is present in the response
- Different user can login immediately after logout
- No "No CSRF secret found" errors occur

**Timeout**: 30 seconds

#### 3. Multiple Consecutive Logout/Login Cycles
**Purpose**: Validates system stability across multiple cycles

**Tests**:
- System handles 3 consecutive logout/login cycles
- CSRF tokens are refreshed each time
- No errors accumulate over multiple cycles
- Session management remains stable
- All session IDs are unique
- All CSRF tokens are unique

**Timeout**: 60 seconds

#### 4. CSRF Secret Initialization on First Visit
**Purpose**: Validates proper initialization for new users

**Tests**:
- CSRF secret is created on first visit to login page
- Session is created automatically
- CSRF token is present in the response
- No errors occur during initialization

**Timeout**: Default (10 seconds)

#### 5. Race Condition Prevention
**Purpose**: Validates the core race condition fix

**Tests**:
- Rapid logout followed by login page access doesn't cause errors
- CSRF secret is available immediately after logout
- No "No CSRF secret found" errors occur
- Login succeeds with rapidly obtained CSRF token
- Parallel requests (logout + login page) handled correctly

**Timeout**: 45 seconds

#### 6. Error Recovery
**Purpose**: Validates graceful error handling

**Tests**:
- System recovers if CSRF secret is missing
- New CSRF secret is generated automatically
- Page renders without error
- CSRF token is present and valid
- Multiple rapid requests handled correctly

**Timeout**: Default (10 seconds)

#### 7. Form Submission with Old CSRF Token
**Purpose**: Validates CSRF token security

**Tests**:
- Old CSRF token from before logout is rejected
- Request fails with proper error (403)
- Error message indicates CSRF issue
- New CSRF token can be obtained
- New CSRF token allows successful login

**Timeout**: 60 seconds

#### 8. CSRF Token Persistence
**Purpose**: Validates token stability across navigation

**Tests**:
- CSRF token remains valid across different page navigations
- Session is maintained properly
- Token can be reused for multiple form submissions

**Timeout**: Default (10 seconds)

#### 9. Concurrent Sessions
**Purpose**: Validates multi-user/multi-session scenarios

**Tests**:
- System handles concurrent logout/login from multiple sessions
- Each session maintains independent CSRF tokens
- No cross-session contamination occurs
- Different session IDs for different agents
- No errors in any session

**Timeout**: Default (10 seconds)

#### 10. Performance Under Load
**Purpose**: Validates performance characteristics

**Tests**:
- CSRF token generation performs well under repeated requests
- No memory leaks or performance degradation
- System remains responsive
- Average time per request < 1 second (for 10 requests)

**Timeout**: 15 seconds

## Helper Functions

### extractCsrfToken(html)
Extracts CSRF token from HTML response using regex pattern matching.

```javascript
function extractCsrfToken(html) {
  const match = html.match(/name="csrfToken"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}
```

### getSessionId(res)
Extracts session ID from response cookies.

```javascript
function getSessionId(res) {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return null;
  const cookie = cookies.find(c => c.includes('amexing.sid'));
  if (!cookie) return null;
  const match = cookie.match(/amexing\.sid=([^;]+)/);
  return match ? match[1] : null;
}
```

### simulateLogin(agent, identifier, password)
Simulates complete login flow:
1. GET /login to obtain CSRF token
2. POST /auth/login with credentials and CSRF token

```javascript
async function simulateLogin(agent, identifier, password) {
  const loginPage = await agent.get('/login');
  const csrfToken = extractCsrfToken(loginPage.text);
  if (!csrfToken) {
    throw new Error('Failed to extract CSRF token from login page');
  }
  return agent.post('/auth/login').send({
    identifier,
    password,
    csrfToken
  });
}
```

### performLogout(agent)
Performs logout with extended timeout.

```javascript
async function performLogout(agent) {
  return agent.get('/logout').timeout(15000);
}
```

## Test Configuration

### Test User Credentials
The test suite uses development environment superadmin credentials:

```javascript
const testUser = {
  identifier: 'superadmin@dev.amexing.com',
  password: 'DevSuper2024!',
};
```

### Timeout Configuration
- **Default timeout**: 10 seconds (Jest default)
- **Extended timeout**: 15-60 seconds for complex tests
- **Request timeout**: 15 seconds for individual HTTP requests

## Running the Tests

### Run Complete Test Suite
```bash
NODE_ENV=development yarn test tests/integration/auth/csrf-logout-login-flow.test.js --testTimeout=60000 --verbose
```

### Run Specific Test Category
```bash
NODE_ENV=development yarn test tests/integration/auth/csrf-logout-login-flow.test.js -t "Session Regeneration After Logout"
```

### Run with Coverage
```bash
NODE_ENV=development yarn test:coverage tests/integration/auth/csrf-logout-login-flow.test.js
```

## Success Criteria

### Test Pass Criteria
- All 10 test categories pass consistently
- No "No CSRF secret found in session" errors
- Session regeneration confirmed
- CSRF tokens refresh properly
- Race conditions handled gracefully
- Error recovery mechanisms work
- Old tokens properly rejected
- Performance benchmarks met

### Coverage Targets
- **Logout middleware**: 100% coverage
- **CSRF-related controller methods**: 100% coverage
- **Security middleware CSRF functions**: 100% coverage
- **Overall integration coverage**: > 85%

## Test Results Summary

### Expected Test Results
When all fixes are working correctly:

```
PASS tests/integration/auth/csrf-logout-login-flow.test.js
  CSRF Token Flow - Logout/Login Integration
    Session Regeneration After Logout
      ✓ should regenerate session and CSRF token after logout (45s)
    Immediate Re-login After Logout
      ✓ should allow immediate login after logout without CSRF errors (30s)
    Multiple Consecutive Logout/Login Cycles
      ✓ should handle multiple consecutive logout/login cycles (60s)
    CSRF Secret Initialization
      ✓ should initialize CSRF secret on first visit to login page (5s)
    Race Condition Prevention
      ✓ should prevent race condition errors during rapid logout/login (45s)
    Error Recovery
      ✓ should recover gracefully if CSRF secret is missing (5s)
      ✓ should handle session regeneration errors gracefully (2s)
    Form Submission with Old CSRF Token
      ✓ should reject form submission with old CSRF token after logout (60s)
    CSRF Token Persistence
      ✓ should maintain valid CSRF token across page navigations (5s)
    Concurrent Sessions
      ✓ should handle concurrent logout/login from multiple sessions (8s)
    Performance Under Load
      ✓ should handle rapid successive login page requests efficiently (3s)

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

## Validation Checklist

After running tests, verify:

- [ ] All 11 tests pass consistently
- [ ] No "No CSRF secret found" errors in any test
- [ ] Session IDs change properly on logout
- [ ] CSRF tokens are unique across sessions
- [ ] Old CSRF tokens are rejected (403 error)
- [ ] New CSRF tokens work immediately after logout
- [ ] Performance benchmarks met (< 1s per request)
- [ ] Concurrent sessions don't interfere with each other
- [ ] Error recovery works without crashes

## Troubleshooting

### Common Issues

#### Timeout Errors
**Symptom**: Tests exceed timeout limits

**Solution**:
- Check Parse Server is running
- Verify database connection
- Increase timeout values if network is slow

#### Authentication Failures
**Symptom**: Login returns 401 or redirect errors

**Solution**:
- Verify test user credentials are correct
- Check development database has test user
- Ensure `yarn dev` was run to seed data

#### CSRF Token Extraction Fails
**Symptom**: `extractCsrfToken` returns null

**Solution**:
- Verify HTML response contains CSRF token input
- Check EJS template renders correctly
- Ensure authController includes CSRF token

#### Session ID Extraction Fails
**Symptom**: `getSessionId` returns null

**Solution**:
- Verify session middleware is active
- Check cookie configuration
- Ensure session cookie name is 'amexing.sid'

## Integration with CI/CD

### Pre-commit Hooks
Include these tests in pre-commit validation:

```bash
yarn test:security
```

### CI Pipeline
Run tests as part of integration test suite:

```bash
yarn test:integration
```

### PR Validation
Require all CSRF tests to pass before merging:

```yaml
- name: Run CSRF Flow Tests
  run: NODE_ENV=development yarn test tests/integration/auth/csrf-logout-login-flow.test.js --testTimeout=60000
```

## Maintenance

### When to Update Tests

Update tests when:
- Authentication flow changes
- Session management changes
- CSRF middleware changes
- New authentication methods added
- Security requirements change

### Test Data Management

The tests use:
- Development superadmin credentials
- Ephemeral sessions (cleaned up after each test)
- No database modifications required
- Safe to run repeatedly

## Related Files

### Implementation Files
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/src/application/middleware/dashboardAuthMiddleware.js`
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/src/application/controllers/authController.js`
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/src/infrastructure/security/securityMiddleware.js`

### Test Support Files
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/tests/setup.js`
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/tests/helpers/testUtils.js`

### Related Documentation
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/docs/SECURE_DEVELOPMENT_GUIDE.md`
- `/Users/black4ninja/Meeplab/Amexing/amexing-web/CLAUDE.md`

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-09-30 | Initial comprehensive test suite |

## Authors

- **Amexing Development Team**
- **Test Automation Specialist (Claude Code)**

## License

Internal use only - Part of AmexingWeb PCI DSS compliant platform.
