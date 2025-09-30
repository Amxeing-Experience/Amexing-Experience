# Authentication Integration Tests

This directory contains comprehensive integration tests for the authentication system in AmexingWeb.

## Test Files

### csrf-logout-login-flow.test.js

Comprehensive integration tests for CSRF token flow during logout/login cycles.

**Purpose**: Validates that the race condition bug fix for "No CSRF secret found in session" errors is working correctly.

**Test Coverage**:
- Session regeneration after logout
- Immediate re-login after logout
- Multiple consecutive logout/login cycles
- CSRF secret initialization
- Race condition prevention
- Error recovery
- Form submission with old CSRF tokens
- CSRF token persistence
- Concurrent sessions
- Performance under load

**Running Tests**:
```bash
# Run all CSRF flow tests
NODE_ENV=development yarn test tests/integration/auth/csrf-logout-login-flow.test.js --testTimeout=60000 --verbose

# Run specific test
NODE_ENV=development yarn test tests/integration/auth/csrf-logout-login-flow.test.js -t "Race Condition Prevention"
```

**Documentation**: See [CSRF_FLOW_TEST_DOCUMENTATION.md](./CSRF_FLOW_TEST_DOCUMENTATION.md) for detailed documentation.

## Test Standards

### Test Data Pattern
- Use development environment credentials
- Tests should be idempotent (repeatable)
- Clean up after each test
- No database modifications required

### Test Timeouts
- Default: 10 seconds
- Extended: 15-60 seconds for complex flows
- Request timeout: 15 seconds for individual HTTP requests

### Success Criteria
- All tests pass consistently
- No race condition errors
- Proper CSRF token validation
- Session management working correctly
- Performance benchmarks met

## Development Workflow

### Before Implementing Changes
1. Run existing tests to establish baseline
2. Identify test cases that need updates
3. Document expected behavior changes

### After Implementing Changes
1. Run full authentication test suite
2. Verify all tests pass
3. Check test coverage
4. Update documentation if needed

### Adding New Tests
1. Follow existing test structure
2. Add comprehensive JSDoc comments
3. Include timeout specifications
4. Update documentation
5. Ensure tests are isolated and repeatable

## Related Documentation

- [CSRF Flow Test Documentation](./CSRF_FLOW_TEST_DOCUMENTATION.md) - Detailed documentation for CSRF token flow tests
- [Secure Development Guide](/docs/SECURE_DEVELOPMENT_GUIDE.md) - Security best practices
- [CLAUDE.md](/CLAUDE.md) - Project guidelines and standards

## Support

For issues or questions about authentication tests:
1. Check test documentation
2. Review test logs for error details
3. Verify environment configuration
4. Ensure Parse Server is running

## Maintenance

### Regular Maintenance Tasks
- Run tests before each commit
- Update tests when authentication flow changes
- Review test coverage quarterly
- Update documentation as needed

### Test Health Indicators
- **Green**: All tests passing consistently
- **Yellow**: Intermittent failures (investigate)
- **Red**: Consistent failures (fix immediately)

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2025-09-30 | Initial authentication test suite with CSRF flow tests |
