# Parse Cloud Functions Test Suite

This directory contains comprehensive tests for Parse.Cloud functionality, designed to validate cloud code execution and catch version compatibility issues.

## Test Structure

### 1. `cloud-define-operations.test.js`
Tests for Parse.Cloud.define() function registration and execution:
- Function registration validation
- Parameter handling (strings, numbers, booleans, arrays, objects, dates)
- Error handling and timeout scenarios
- Performance measurement
- Concurrent execution testing
- Request context validation

### 2. `cloud-hooks-operations.test.js`
Tests for Parse.Cloud hooks (beforeSave, afterSave, beforeDelete, afterDelete):
- AmexingUser hook testing
- Legacy Parse.User hook testing
- Session and login hook testing
- Hook error handling and edge cases
- Hook execution order and dependencies
- Batch operation hook execution

### 3. `existing-functions-validation.test.js`
Tests for all registered cloud functions from main.js:
- **Basic Functions**: hello, test
- **OAuth Admin**: getAvailableCorporateDomains, addCorporateDomain, getOAuthProviderStatus
- **Corporate Landing**: getCorporateLandingConfig, generateCorporateOAuthURL
- **Corporate Sync**: triggerCorporateSync, startPeriodicSync, stopPeriodicSync
- **OAuth Permissions**: getUserPermissionInheritance, switchPermissionContext
- **Department OAuth**: getAvailableDepartments, initiateDepartmentOAuth
- **Apple OAuth**: initiateAppleOAuth, handleAppleOAuthCallback
- **Authentication**: registerUser, loginUser, refreshToken, changePassword
- **OAuth Provider**: generateOAuthUrl, handleOAuthCallback, getOAuthProviders

### 4. `cloud-integration.test.js`
End-to-end integration testing:
- Authentication workflows (registration → login → password change)
- OAuth integration workflows
- Corporate OAuth workflows
- Permission management workflows
- Department and Apple OAuth workflows
- Cross-function integration and data flow
- Performance testing of integrated workflows
- Error handling and recovery testing

### 5. `cloud-jobs.test.js`
Tests for Parse.Cloud.job background job functionality:
- Job infrastructure validation
- Registered job testing (cleanupExpiredSessions, securityAudit)
- Job parameter and message handling
- Error handling and recovery
- Performance and monitoring
- State management and persistence
- Job scheduling and coordination

## Key Features

### Comprehensive Function Coverage
- Tests all 50+ cloud functions registered in main.js
- Validates function existence, parameter handling, and response structure
- Tests both success and failure scenarios

### Performance Monitoring
- Execution time measurement for all cloud functions
- Memory usage tracking during job execution
- Concurrent execution testing
- Performance benchmarking with configurable thresholds

### Error Handling Validation
- Tests function behavior with invalid parameters
- Validates error response structure and codes
- Tests timeout scenarios and recovery
- Authentication error testing

### Integration Testing
- End-to-end workflow validation
- Cross-function data flow testing
- Real database operations through cloud functions
- OAuth provider integration testing

### Job System Testing
- Background job execution simulation
- Job state tracking and persistence
- Batch processing patterns
- Job scheduling and dependency management

## Configuration

### Environment Setup
Tests use the existing Parse Platform test infrastructure:
- Environment: `.env.development` (real Parse Server)
- Configuration: `parse-platform.env.js`
- Test helpers: `ParseTestHelpers` and `TestDataFactory`

### Test Isolation
- Automatic cleanup of test data after each test
- Prefixed test object names to avoid conflicts
- Master key usage for administrative operations
- Session management for authentication tests

## Running the Tests

### Individual Test Suites
```bash
# Cloud function definition tests
npm test tests/parse-platform/cloud-functions/cloud-define-operations.test.js

# Cloud hooks tests
npm test tests/parse-platform/cloud-functions/cloud-hooks-operations.test.js

# Existing functions validation
npm test tests/parse-platform/cloud-functions/existing-functions-validation.test.js

# Integration tests
npm test tests/parse-platform/cloud-functions/cloud-integration.test.js

# Background jobs tests
npm test tests/parse-platform/cloud-functions/cloud-jobs.test.js
```

### All Cloud Function Tests
```bash
# Run all cloud function tests
npm test tests/parse-platform/cloud-functions/
```

### With Verbose Output
```bash
# Detailed test output with performance metrics
npm test tests/parse-platform/cloud-functions/ -- --verbose
```

## Expected Test Behavior

### Success Scenarios
- Basic functions (hello, test) should always pass
- OAuth provider listing should work without authentication
- Function registration validation should pass for 80%+ of functions
- Performance tests should complete within configured timeouts

### Expected Failures (Service Dependencies)
Some tests may fail due to external service dependencies:
- **Email Service**: Password reset functions may fail without SMTP configuration
- **OAuth Providers**: OAuth functions may fail without provider credentials
- **Corporate Services**: Corporate domain functions may require specific configurations
- **Apple OAuth**: Apple-specific functions require Apple Developer certificates

### Performance Expectations
- Basic functions: < 5 seconds average execution
- Complex functions: < 10 seconds average execution
- Integrated workflows: < 15 seconds total execution
- Concurrent operations: < 30 seconds for 10 concurrent calls

## Debugging

### Test Failures
1. Check Parse Server connection in test output
2. Verify .env.development configuration
3. Check for authentication token expiration
4. Review function parameter validation errors

### Performance Issues
1. Monitor execution time warnings in test output
2. Check memory usage deltas in performance tests
3. Review concurrent execution results
4. Validate timeout configurations

### Service Dependencies
1. Review OAuth provider configuration warnings
2. Check email service setup for password reset tests
3. Verify corporate domain configuration
4. Validate Apple OAuth certificate setup

## Security Considerations

### Test Data
- All test data uses prefixed names to avoid production conflicts
- Master key usage is restricted to test operations
- Sensitive data is masked in test outputs
- Automatic cleanup prevents data accumulation

### Authentication Testing
- Test users are created with non-production credentials
- Session tokens are properly cleaned up
- Password testing uses secure test patterns
- OAuth testing uses sandbox/test credentials

## Maintenance

### Adding New Cloud Functions
1. Add function validation to `existing-functions-validation.test.js`
2. Add integration scenarios to `cloud-integration.test.js`
3. Update this README with new function categories
4. Add performance benchmarks for complex functions

### Updating Test Infrastructure
1. Maintain compatibility with ParseTestHelpers
2. Update cleanup patterns for new object types
3. Add new performance thresholds as needed
4. Update error handling patterns for new Parse versions

This test suite provides comprehensive validation of Parse.Cloud functionality and helps catch version compatibility issues before they affect the production application.