# Parse Platform Testing Infrastructure

A comprehensive testing framework for Parse Platform operations using the development database with proper test isolation.

## Overview

This testing infrastructure provides complete validation of Parse Platform functionality including:
- Parse Object operations (Create, Read, Update, Delete)
- Parse Query operations with complex filters
- Parse Schema management
- Parse Cloud Functions
- Performance and stress testing
- Real environment testing using `.env.development`

## Architecture

### Directory Structure

```
tests/parse-platform/
├── unit/                    # Individual Parse component tests
│   └── parse-object-operations.test.js
├── integration/             # Full CRUD integration tests
│   └── crud-operations.test.js
├── real-environment/        # Tests using .env.development
│   └── connection-validation.test.js
├── cloud-functions/         # Parse.Cloud testing
└── helpers/                 # Test utilities and setup
    ├── parse-test-setup.js      # Parse Server connection setup
    ├── test-data-factory.js     # Create test objects safely
    ├── parse-test-helpers.js    # Parse-specific test utilities
    ├── cleanup-helpers.js       # Safe test data cleanup
    ├── parse-global-setup.js    # Global test environment setup
    └── parse-global-teardown.js # Global test environment cleanup
```

### Test Isolation

All test objects use the prefix `ParseTest_` to ensure complete isolation from production data:
- Production tables: `AmexingUser`, `Event`, `Notification`
- Test tables: `ParseTest_AmexingUser`, `ParseTest_Event`, `ParseTest_Notification`

### Configuration Files

- **Jest Config**: `.config/jest/parse-platform.jest.config.js` - Test runner configuration
- **Environment**: `tests/parse-platform/parse-platform.env.js` - Environment variables
- **Package Scripts**: Added to `package.json` for easy execution

## Usage

### Running Tests

```bash
# Run all Parse Platform tests
yarn test:parse-platform

# Run specific test categories
yarn test:parse-platform:unit         # Unit tests only
yarn test:parse-platform:integration  # Integration tests only
yarn test:parse-platform:real        # Real environment tests
yarn test:parse-platform:cloud       # Cloud function tests

# Development modes
yarn test:parse-platform:watch       # Watch mode
yarn test:parse-platform:coverage    # With coverage report
```

### Test Categories

#### Unit Tests (`unit/`)
- Individual Parse Object operations
- Attribute manipulation and validation
- Object serialization and comparison
- Data type handling
- Test Data Factory integration

#### Integration Tests (`integration/`)
- Complete CRUD workflows
- Complex query operations
- Bulk operations and performance
- Concurrent update handling
- Object lifecycle management

#### Real Environment Tests (`real-environment/`)
- Parse Server connectivity validation
- Database operations with development DB
- Schema creation and management
- Performance benchmarking
- Error handling and resilience

#### Cloud Functions Tests (`cloud-functions/`)
- Parse.Cloud function validation
- Custom business logic testing
- Trigger and validation testing

## Test Utilities

### ParseTestSetup
Main test environment manager:
- Parse SDK initialization
- Schema creation and management
- Test object creation with metadata tracking
- Connection validation and health checks

### TestDataFactory
Safe test object creation:
- Pre-configured data generators for all entity types
- Automatic cleanup tracking
- Relationship handling
- Bulk data creation

### ParseTestHelpers
Parse-specific utilities:
- Query helpers with retry logic
- Performance measurement tools
- Object validation and comparison
- Wait conditions and timeouts

### CleanupHelpers
Comprehensive cleanup management:
- Individual object cleanup
- Bulk cleanup operations
- Test collection management
- Emergency cleanup procedures

## Key Features

### Safe Database Operations
- Uses development database with test prefixes
- Automatic cleanup after each test
- No risk to production data
- Comprehensive error handling

### Performance Testing
- Bulk operation benchmarks
- Query performance measurement
- Memory usage tracking
- Concurrent operation testing

### Comprehensive Coverage
- All Parse Platform operations
- Error scenarios and edge cases
- Schema validation
- Data integrity checks

### Developer Experience
- Clear test organization
- Detailed logging and reporting
- Watch mode for development
- Coverage reporting

## Configuration

### Environment Variables
The testing environment uses `.env.development` configuration with test-specific overrides:

```javascript
// Key configuration from parse-platform.env.js
process.env.PARSE_PLATFORM_TEST_PREFIX = 'ParseTest_';
process.env.PARSE_PLATFORM_TEST_MODE = 'true';
process.env.PARSE_APPLICATION_ID = process.env.PARSE_APP_ID;
process.env.DATABASE_URI = process.env.DATABASE_URI; // Development database
```

### Jest Configuration
Optimized for Parse Platform testing:
- Extended timeouts for database operations
- Sequential execution for integration tests
- Custom test matchers and reporters
- Proper setup and teardown handling

## Best Practices

### Writing Tests

1. **Use Test Prefixes**: All test classes automatically get `ParseTest_` prefix
2. **Track Created Objects**: Use TestDataFactory for automatic cleanup
3. **Test Isolation**: Each test should be independent
4. **Performance Awareness**: Monitor test execution times
5. **Error Handling**: Test both success and failure scenarios

### Example Test Structure

```javascript
describe('Parse Object Operations', () => {
  let parseSetup, dataFactory;

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
  });

  afterAll(async () => {
    await dataFactory.cleanup();
  });

  test('should create and retrieve object', async () => {
    const testObj = await dataFactory.createAmexingUser({
      email: 'test@example.com'
    });

    expect(testObj.id).toBeDefined();
    expect(testObj.get('email')).toBe('test@example.com');
  });
});
```

## Troubleshooting

### Common Issues

1. **Connection Timeouts**: Increase timeout in test configuration
2. **Cleanup Failures**: Check network connectivity and permissions
3. **Schema Conflicts**: Ensure unique test class names
4. **Memory Issues**: Monitor bulk operation sizes

### Debug Mode
Enable verbose logging by setting:
```bash
PARSE_PLATFORM_LOG_LEVEL=debug yarn test:parse-platform
```

### Manual Cleanup
If tests leave residual data:
```javascript
const cleanup = new CleanupHelpers();
await cleanup.emergencyCleanup('EMERGENCY_CLEANUP_CONFIRMED');
```

## Integration with CI/CD

The Parse Platform tests are designed to work in continuous integration:
- Reliable cleanup prevents test pollution
- Performance benchmarks catch regressions
- Comprehensive error handling prevents flaky tests
- Detailed reporting for debugging failures

## Security Considerations

- Tests use development database only
- Test data is clearly marked with metadata
- Automatic cleanup prevents data leakage
- No production credentials in test code
- PCI DSS compliance maintained in test environment

## Future Enhancements

- Parse LiveQuery testing
- Push notification testing
- Performance regression detection
- Advanced query optimization testing
- Multi-tenant testing scenarios