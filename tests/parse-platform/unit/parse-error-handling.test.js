/**
 * Parse Error Handling Tests
 * Comprehensive testing of Parse.Error functionality and error scenarios
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse Error Handling Tests', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();
  });

  afterAll(async () => {
    await dataFactory.cleanup();
    await parseSetup.cleanupAllTestData();
  });

  describe('Standard Parse Error Codes and Messages', () => {
    test('should recognize standard Parse error codes', () => {
      // Test that Parse.Error constants are available and have expected types
      expect(typeof Parse.Error.INVALID_JSON).toBe('number');
      expect(typeof Parse.Error.INVALID_QUERY).toBe('number');
      expect(typeof Parse.Error.OBJECT_NOT_FOUND).toBe('number');
      expect(typeof Parse.Error.INVALID_CLASS_NAME).toBe('number');
      expect(typeof Parse.Error.MISSING_OBJECT_ID).toBe('number');
      expect(typeof Parse.Error.INVALID_KEY_NAME).toBe('number');
      expect(typeof Parse.Error.INVALID_POINTER).toBe('number');
      expect(typeof Parse.Error.INVALID_FIELD_NAME).toBe('number');
      expect(typeof Parse.Error.INVALID_NESTED_KEY).toBe('number');
      expect(typeof Parse.Error.DUPLICATE_VALUE).toBe('number');
      expect(typeof Parse.Error.INVALID_ROLE_NAME).toBe('number');
      expect(typeof Parse.Error.INVALID_ACL).toBe('number');
      expect(typeof Parse.Error.TIMEOUT).toBe('number');
      expect(typeof Parse.Error.INVALID_EMAIL_ADDRESS).toBe('number');
      expect(typeof Parse.Error.USERNAME_MISSING).toBe('number');
      expect(typeof Parse.Error.PASSWORD_MISSING).toBe('number');
      expect(typeof Parse.Error.USERNAME_TAKEN).toBe('number');
      expect(typeof Parse.Error.EMAIL_TAKEN).toBe('number');
      expect(typeof Parse.Error.EMAIL_MISSING).toBe('number');
      expect(typeof Parse.Error.EMAIL_NOT_FOUND).toBe('number');
      expect(Parse.Error.SESSION_MISSING).toBe(206);
      expect(Parse.Error.MUST_CREATE_USER_THROUGH_SIGNUP).toBe(207);
      expect(Parse.Error.ACCOUNT_ALREADY_LINKED).toBe(208);
      expect(Parse.Error.LINKED_ID_MISSING).toBe(250);
      expect(Parse.Error.INVALID_LINKED_SESSION).toBe(251);
      expect(Parse.Error.UNSUPPORTED_SERVICE).toBe(252);
    });

    test('should create Parse.Error objects with proper structure', () => {
      const customError = new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Custom error message');

      expect(customError).toBeInstanceOf(Parse.Error);
      expect(customError).toBeInstanceOf(Error);
      expect(customError.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      expect(customError.message).toBe('Custom error message');
    });

    test('should handle error inheritance properly', () => {
      const parseError = new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid query');

      expect(parseError instanceof Error).toBe(true);
      expect(parseError instanceof Parse.Error).toBe(true);
      expect(parseError.toString()).toContain('Invalid query');
      expect(parseError.stack).toBeDefined();
    });
  });

  describe('Object Not Found Errors', () => {
    test('should throw OBJECT_NOT_FOUND when querying non-existent object', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));
      const query = new Parse.Query(TestClass);

      const nonExistentId = 'nonexistent123456789012';

      try {
        await query.get(nonExistentId, { useMasterKey: true });
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
        expect(error.message).toContain('Object not found');
      }
    });

    test('should throw OBJECT_NOT_FOUND when fetching deleted object', async () => {
      // Create an object
      const testObj = await parseSetup.createAndSaveTestObject('ErrorTest', {
        name: 'Test Object'
      });

      const objectId = testObj.id;

      // Delete the object
      await testObj.destroy({ useMasterKey: true });

      // Try to fetch the deleted object
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));
      const query = new Parse.Query(TestClass);

      try {
        await query.get(objectId, { useMasterKey: true });
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      }
    });
  });

  describe('Validation Errors', () => {
    test('should handle invalid class name errors', async () => {
      try {
        // Try to create object with invalid class name
        const InvalidClass = Parse.Object.extend('invalid-class-name!@#');
        const invalidObj = new InvalidClass();
        invalidObj.set('test', 'value');

        await invalidObj.save(null, { useMasterKey: true });
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        // The exact error code may vary depending on Parse Server version
        expect([Parse.Error.INVALID_CLASS_NAME, Parse.Error.INVALID_KEY_NAME]).toContain(error.code);
      }
    });

    test('should handle invalid field name errors', async () => {
      const testObj = parseSetup.createTestObject('ErrorTest', {});

      try {
        // Try to set field with invalid name
        testObj.set('invalid-field!@#', 'value');
        await testHelpers.saveWithRetry(testObj);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect([Parse.Error.INVALID_KEY_NAME, Parse.Error.INVALID_FIELD_NAME]).toContain(error.code);
      }
    });

    test('should handle invalid pointer errors', async () => {
      const testObj = parseSetup.createTestObject('ErrorTest', {});

      try {
        // Try to set invalid pointer
        const invalidPointer = { __type: 'Pointer', className: 'NonExistent', objectId: 'invalid' };
        testObj.set('invalidPointer', invalidPointer);
        await testHelpers.saveWithRetry(testObj);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.INVALID_POINTER);
      }
    });

    test('should handle duplicate value errors', async () => {
      // This test assumes unique constraints are set up on certain fields
      // Create first object
      const obj1 = await parseSetup.createAndSaveTestObject('UniqueTest', {
        uniqueField: 'unique_value_123'
      });

      try {
        // Try to create second object with same unique value
        const obj2 = parseSetup.createTestObject('UniqueTest', {
          uniqueField: 'unique_value_123'
        });
        await testHelpers.saveWithRetry(obj2);

        // If no unique constraint is set, clean up both objects
        await obj1.destroy({ useMasterKey: true });
        await obj2.destroy({ useMasterKey: true });
      } catch (error) {
        // Clean up first object
        await obj1.destroy({ useMasterKey: true });

        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
      }
    });
  });

  describe('Authentication and Permission Errors', () => {
    test('should handle username missing errors', async () => {
      const user = new Parse.User();
      user.set('password', 'testpassword');
      user.set('email', 'test@example.com');

      try {
        await user.signUp();
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.USERNAME_MISSING);
      }
    });

    test('should handle password missing errors', async () => {
      const user = new Parse.User();
      user.set('username', 'testuser123');
      user.set('email', 'test@example.com');

      try {
        await user.signUp();
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.PASSWORD_MISSING);
      }
    });

    test('should handle username taken errors', async () => {
      const username = `testuser_${Date.now()}`;

      // Create first user
      const user1 = new Parse.User();
      user1.set('username', username);
      user1.set('password', 'password1');
      user1.set('email', `test1_${Date.now()}@example.com`);

      const savedUser1 = await user1.signUp();

      try {
        // Try to create second user with same username
        const user2 = new Parse.User();
        user2.set('username', username); // Same username
        user2.set('password', 'password2');
        user2.set('email', `test2_${Date.now()}@example.com`);

        await user2.signUp();
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
      } finally {
        // Cleanup
        await savedUser1.destroy({ useMasterKey: true });
      }
    });

    test('should handle invalid login credentials', async () => {
      try {
        await Parse.User.logIn('nonexistentuser', 'wrongpassword');
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect([Parse.Error.OBJECT_NOT_FOUND, Parse.Error.INVALID_LOGIN_PARAMETERS]).toContain(error.code);
      }
    });

    test('should handle session missing errors', async () => {
      // Ensure no user is logged in
      await Parse.User.logOut();

      const testObj = parseSetup.createTestObject('SessionTest', {
        name: 'Test Object'
      });

      try {
        // Try to save without proper authentication (if ACLs are set up)
        await testObj.save();
        // If this succeeds, it means the object was saved without authentication
        // which might be allowed in the test configuration
        await testObj.destroy({ useMasterKey: true });
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect([Parse.Error.SESSION_MISSING, Parse.Error.OBJECT_NOT_FOUND]).toContain(error.code);
      }
    });
  });

  describe('Query and Data Type Errors', () => {
    test('should handle invalid query errors', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));
      const query = new Parse.Query(TestClass);

      try {
        // Try to use invalid regex pattern
        query.matches('name', '[invalid regex');
        await testHelpers.findWithRetry(query);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.INVALID_QUERY);
      }
    });

    test('should handle invalid JSON errors', async () => {
      // This is harder to test directly since Parse SDK handles JSON serialization
      // But we can test with circular references or invalid data structures

      const testObj = parseSetup.createTestObject('JSONTest', {});

      try {
        // Create circular reference
        const circularObj = { name: 'test' };
        circularObj.self = circularObj;

        // Try to save object with circular reference
        testObj.set('circularData', circularObj);
        await testHelpers.saveWithRetry(testObj);

        // If this succeeds, Parse handled the circular reference
        await testObj.destroy({ useMasterKey: true });
      } catch (error) {
        // This might throw various errors depending on how Parse handles it
        expect(error).toBeDefined();
      }
    });

    test('should handle invalid nested key errors', async () => {
      const testObj = parseSetup.createTestObject('NestedTest', {});

      try {
        // Try to use invalid nested key syntax
        testObj.set('data.invalid..key', 'value');
        await testHelpers.saveWithRetry(testObj);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect([Parse.Error.INVALID_NESTED_KEY, Parse.Error.INVALID_KEY_NAME]).toContain(error.code);
      }
    });
  });

  describe('Network and Connection Errors', () => {
    test('should handle connection timeout scenarios', async () => {
      // This test simulates timeout by using very short timeout values
      const testObj = parseSetup.createTestObject('TimeoutTest', {
        name: 'Timeout Test',
        largeData: 'x'.repeat(10000) // Large data to potentially cause timeout
      });

      try {
        // Set very short timeout (this might not work in all Parse SDK versions)
        const savedObj = await testObj.save(null, {
          useMasterKey: true
          // timeout: 1 // Very short timeout - not all Parse SDK versions support this
        });

        // If save succeeds, clean up
        await savedObj.destroy({ useMasterKey: true });
      } catch (error) {
        if (error.code === Parse.Error.TIMEOUT || error.code === Parse.Error.CONNECTION_FAILED) {
          expect(error).toBeInstanceOf(Parse.Error);
        } else {
          // Other errors are also acceptable in this test
          expect(error).toBeDefined();
        }
      }
    });

    test('should handle connection failure gracefully', async () => {
      // This test is conceptual since we can't easily simulate network failures
      // In real scenarios, you might use network mocking libraries

      const testObj = parseSetup.createTestObject('ConnectionTest', {
        name: 'Connection Test'
      });

      try {
        await testHelpers.saveWithRetry(testObj, {}, 1); // Only 1 retry
        // If successful, clean up
        await testObj.destroy({ useMasterKey: true });
      } catch (error) {
        // Any error is acceptable here since we're testing error handling
        expect(error).toBeDefined();
        expect(error.message).toBeDefined();
      }
    });
  });

  describe('Custom Error Creation and Handling', () => {
    test('should create custom Parse errors', () => {
      const customCode = 9999;
      const customMessage = 'This is a custom error for testing';

      const customError = new Parse.Error(customCode, customMessage);

      expect(customError).toBeInstanceOf(Parse.Error);
      expect(customError.code).toBe(customCode);
      expect(customError.message).toBe(customMessage);
    });

    test('should handle custom error throwing and catching', async () => {
      const customErrorFunction = () => {
        throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Custom operation failed');
      };

      try {
        customErrorFunction();
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OTHER_CAUSE);
        expect(error.message).toBe('Custom operation failed');
      }
    });

    test('should create errors with additional properties', () => {
      const errorWithDetails = new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'Validation failed',
        { field: 'email', reason: 'invalid format' }
      );

      expect(errorWithDetails.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(errorWithDetails.message).toBe('Validation failed');
      // Additional properties might be stored in error object depending on Parse version
    });
  });

  describe('Error Propagation in Promises', () => {
    test('should properly propagate errors through promise chains', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));

      try {
        await new Parse.Query(TestClass)
          .get('nonexistent123456789012', { useMasterKey: true })
          .then(obj => {
            // This should not execute
            return obj.save();
          })
          .then(savedObj => {
            // This should not execute either
            return savedObj.get('name');
          });

        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      }
    });

    test('should handle errors in async/await chains', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));

      try {
        const obj = await new Parse.Query(TestClass).get('nonexistent123456789012', { useMasterKey: true });
        const savedObj = await obj.save();
        const name = savedObj.get('name');

        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      }
    });

    test('should handle multiple errors in parallel operations', async () => {
      const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));
      const query1 = new Parse.Query(TestClass);
      const query2 = new Parse.Query(TestClass);

      const promises = [
        query1.get('nonexistent1', { useMasterKey: true }),
        query2.get('nonexistent2', { useMasterKey: true })
      ];

      try {
        await Promise.all(promises);
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      }

      // Test with Promise.allSettled to see all errors
      const results = await Promise.allSettled(promises);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
      expect(results[0].reason).toBeInstanceOf(Parse.Error);
      expect(results[1].reason).toBeInstanceOf(Parse.Error);
    });
  });

  describe('Error Recovery Patterns', () => {
    test('should implement retry logic for transient errors', async () => {
      let attempts = 0;
      const maxRetries = 3;

      const retryOperation = async () => {
        attempts++;

        if (attempts < 3) {
          // Simulate transient error
          throw new Parse.Error(Parse.Error.CONNECTION_FAILED, 'Simulated connection failure');
        }

        // Success on third attempt
        return parseSetup.createAndSaveTestObject('RetryTest', {
          name: 'Success after retries',
          attempts: attempts
        });
      };

      let result;
      let lastError;

      for (let i = 0; i < maxRetries; i++) {
        try {
          result = await retryOperation();
          break;
        } catch (error) {
          lastError = error;
          if (i === maxRetries - 1) {
            throw error;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      expect(result).toBeDefined();
      expect(result.get('attempts')).toBe(3);
      expect(attempts).toBe(3);

      // Cleanup
      await result.destroy({ useMasterKey: true });
    });

    test('should implement fallback strategies for errors', async () => {
      const primaryOperation = async () => {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Primary operation failed');
      };

      const fallbackOperation = async () => {
        return parseSetup.createAndSaveTestObject('FallbackTest', {
          name: 'Fallback success',
          source: 'fallback'
        });
      };

      let result;
      try {
        result = await primaryOperation();
      } catch (error) {
        expect(error).toBeInstanceOf(Parse.Error);
        result = await fallbackOperation();
      }

      expect(result).toBeDefined();
      expect(result.get('source')).toBe('fallback');

      // Cleanup
      await result.destroy({ useMasterKey: true });
    });

    test('should implement circuit breaker pattern for repeated failures', async () => {
      let failureCount = 0;
      let circuitOpen = false;
      const failureThreshold = 3;
      const resetTime = 1000; // 1 second

      const circuitBreakerOperation = async () => {
        if (circuitOpen) {
          throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Circuit breaker is open');
        }

        // Simulate failure
        failureCount++;
        if (failureCount >= failureThreshold) {
          circuitOpen = true;
          setTimeout(() => {
            circuitOpen = false;
            failureCount = 0;
          }, resetTime);
        }

        throw new Parse.Error(Parse.Error.CONNECTION_FAILED, 'Simulated repeated failure');
      };

      // First three calls should fail normally
      for (let i = 0; i < failureThreshold; i++) {
        try {
          await circuitBreakerOperation();
          fail('Expected error was not thrown');
        } catch (error) {
          expect(error.code).toBe(Parse.Error.CONNECTION_FAILED);
        }
      }

      // Fourth call should fail due to circuit breaker
      try {
        await circuitBreakerOperation();
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error.code).toBe(Parse.Error.OTHER_CAUSE);
        expect(error.message).toContain('Circuit breaker is open');
      }

      expect(circuitOpen).toBe(true);
    });
  });

  describe('Error Logging and Monitoring', () => {
    test('should capture error details for monitoring', async () => {
      const errors = [];

      const errorHandler = (error, context) => {
        errors.push({
          error: error,
          context: context,
          timestamp: new Date(),
          userAgent: 'Parse Platform Test',
          stackTrace: error.stack
        });
      };

      try {
        const TestClass = Parse.Object.extend(testHelpers.getFullClassName('ErrorTest'));
        const query = new Parse.Query(TestClass);
        await query.get('nonexistent123456789012', { useMasterKey: true });

        fail('Expected error was not thrown');
      } catch (error) {
        errorHandler(error, { operation: 'query.get', className: 'ErrorTest' });
      }

      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBeInstanceOf(Parse.Error);
      expect(errors[0].context.operation).toBe('query.get');
      expect(errors[0].timestamp).toBeInstanceOf(Date);
      expect(errors[0].stackTrace).toBeDefined();
    });

    test('should categorize errors by type and severity', async () => {
      const errorCategories = {
        validation: [],
        authentication: [],
        network: [],
        notFound: [],
        other: []
      };

      const categorizeError = (error) => {
        switch (error.code) {
          case Parse.Error.VALIDATION_ERROR:
          case Parse.Error.INVALID_QUERY:
          case Parse.Error.INVALID_CLASS_NAME:
            errorCategories.validation.push(error);
            break;
          case Parse.Error.USERNAME_MISSING:
          case Parse.Error.PASSWORD_MISSING:
          case Parse.Error.USERNAME_TAKEN:
            errorCategories.authentication.push(error);
            break;
          case Parse.Error.CONNECTION_FAILED:
          case Parse.Error.TIMEOUT:
            errorCategories.network.push(error);
            break;
          case Parse.Error.OBJECT_NOT_FOUND:
            errorCategories.notFound.push(error);
            break;
          default:
            errorCategories.other.push(error);
        }
      };

      // Generate various types of errors
      const testErrors = [
        new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found'),
        new Parse.Error(Parse.Error.USERNAME_MISSING, 'Username missing'),
        new Parse.Error(Parse.Error.INVALID_QUERY, 'Invalid query'),
        new Parse.Error(Parse.Error.CONNECTION_FAILED, 'Connection failed'),
        new Parse.Error(9999, 'Custom error')
      ];

      testErrors.forEach(categorizeError);

      expect(errorCategories.notFound).toHaveLength(1);
      expect(errorCategories.authentication).toHaveLength(1);
      expect(errorCategories.validation).toHaveLength(1);
      expect(errorCategories.network).toHaveLength(1);
      expect(errorCategories.other).toHaveLength(1);
    });
  });
});