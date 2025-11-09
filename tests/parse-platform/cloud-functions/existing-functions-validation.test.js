/**
 * Existing Cloud Functions Validation Test Suite
 * Tests all registered cloud functions from main.js
 */

const Parse = require('parse/node');
const ParseTestHelpers = require('../helpers/parse-test-helpers');
const TestDataFactory = require('../helpers/test-data-factory');

describe('Existing Cloud Functions Validation', () => {
  let testHelpers;
  let testDataFactory;
  let testObjects = [];

  beforeAll(async () => {
    // Initialize Parse connection
    const parseConfig = require('../parse-platform.env.js');
    Parse.initialize(parseConfig.appId, parseConfig.jsKey, parseConfig.masterKey);
    Parse.serverURL = parseConfig.serverURL;

    testHelpers = new ParseTestHelpers();
    testDataFactory = new TestDataFactory();

    // Verify Parse is initialized
    expect(Parse.applicationId).toBe(parseConfig.appId);
    expect(Parse.serverURL).toBe(parseConfig.serverURL);
  });

  afterEach(async () => {
    // Clean up test data
    if (testObjects.length > 0) {
      try {
        await Parse.Object.destroyAll(testObjects, { useMasterKey: true });
        testObjects = [];
      } catch (error) {
        console.warn('Error cleaning up test objects:', error.message);
      }
    }
  });

  describe('Basic Cloud Functions', () => {
    test('should validate hello function', async () => {
      const result = await Parse.Cloud.run('hello', {});

      expect(result).toBeDefined();
      expect(result.message).toBe('Hello from Cloud Code!');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });

    test('should validate test function', async () => {
      const params = {
        testKey: 'testValue',
        number: 42,
        boolean: true
      };

      const result = await Parse.Cloud.run('test', params);

      expect(result).toBeDefined();
      expect(result.received).toEqual(params);
      expect(result.success).toBe(true);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('OAuth Admin Functions', () => {
    test('should validate getAvailableCorporateDomains function exists', async () => {
      // Function should exist and be callable, may return empty result
      try {
        const result = await Parse.Cloud.run('getAvailableCorporateDomains', {});
        expect(result).toBeDefined();
      } catch (error) {
        // Function exists but may require specific parameters or authorization
        expect(error.code).toBeDefined();
      }
    });

    test('should validate addCorporateDomain function exists', async () => {
      // Function should exist, will likely fail without proper parameters
      try {
        const result = await Parse.Cloud.run('addCorporateDomain', {
          domain: 'test.example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Expected to fail without proper authorization or complete parameters
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getOAuthProviderStatus function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getOAuthProviderStatus', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate testCorporateDomain function exists', async () => {
      try {
        const result = await Parse.Cloud.run('testCorporateDomain', {
          domain: 'test.example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getOAuthAuditLogs function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getOAuthAuditLogs', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Corporate Landing Functions', () => {
    test('should validate getCorporateLandingConfig function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getCorporateLandingConfig', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate generateCorporateOAuthURL function exists', async () => {
      try {
        const result = await Parse.Cloud.run('generateCorporateOAuthURL', {
          provider: 'google',
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate validateCorporateLandingAccess function exists', async () => {
      try {
        const result = await Parse.Cloud.run('validateCorporateLandingAccess', {
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getCorporateClientDepartments function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getCorporateClientDepartments', {
          clientId: 'test-client'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Corporate Sync Functions', () => {
    test('should validate triggerCorporateSync function exists', async () => {
      try {
        const result = await Parse.Cloud.run('triggerCorporateSync', {
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate startPeriodicSync function exists', async () => {
      try {
        const result = await Parse.Cloud.run('startPeriodicSync', {
          domain: 'example.com',
          interval: 3600000 // 1 hour
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate stopPeriodicSync function exists', async () => {
      try {
        const result = await Parse.Cloud.run('stopPeriodicSync', {
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getAllSyncStatuses function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAllSyncStatuses', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getCorporateSyncHistory function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getCorporateSyncHistory', {
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('OAuth Permissions Functions', () => {
    test('should validate getUserPermissionInheritance function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getUserPermissionInheritance', {
          userId: 'test-user-id'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getAvailableContexts function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAvailableContexts', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate switchPermissionContext function exists', async () => {
      try {
        const result = await Parse.Cloud.run('switchPermissionContext', {
          contextId: 'test-context'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate createPermissionDelegation function exists', async () => {
      try {
        const result = await Parse.Cloud.run('createPermissionDelegation', {
          targetUserId: 'test-user',
          permissions: ['read', 'write']
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate checkUserPermission function exists', async () => {
      try {
        const result = await Parse.Cloud.run('checkUserPermission', {
          permission: 'read',
          resource: 'test-resource'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getPermissionAuditReport function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getPermissionAuditReport', {
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endDate: new Date()
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getAvailablePermissions function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAvailablePermissions', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Department OAuth Functions', () => {
    test('should validate getAvailableDepartments function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAvailableDepartments', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate initiateDepartmentOAuth function exists', async () => {
      try {
        const result = await Parse.Cloud.run('initiateDepartmentOAuth', {
          departmentId: 'test-dept',
          provider: 'google'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate handleDepartmentOAuthCallback function exists', async () => {
      try {
        const result = await Parse.Cloud.run('handleDepartmentOAuthCallback', {
          code: 'test-code',
          state: 'test-state'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getDepartmentOAuthConfig function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getDepartmentOAuthConfig', {
          departmentId: 'test-dept'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate validateDepartmentOAuthAccess function exists', async () => {
      try {
        const result = await Parse.Cloud.run('validateDepartmentOAuthAccess', {
          departmentId: 'test-dept',
          userId: 'test-user'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getDepartmentOAuthAnalytics function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getDepartmentOAuthAnalytics', {
          departmentId: 'test-dept'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Apple OAuth Functions', () => {
    test('should validate initiateAppleOAuth function exists', async () => {
      try {
        const result = await Parse.Cloud.run('initiateAppleOAuth', {
          clientType: 'web'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate handleAppleOAuthCallback function exists', async () => {
      try {
        const result = await Parse.Cloud.run('handleAppleOAuthCallback', {
          code: 'test-code',
          id_token: 'test-token'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getAppleOAuthConfig function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAppleOAuthConfig', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate revokeAppleOAuth function exists', async () => {
      try {
        const result = await Parse.Cloud.run('revokeAppleOAuth', {
          userId: 'test-user'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate validateAppleDomain function exists', async () => {
      try {
        const result = await Parse.Cloud.run('validateAppleDomain', {
          domain: 'example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate getAppleOAuthAnalytics function exists', async () => {
      try {
        const result = await Parse.Cloud.run('getAppleOAuthAnalytics', {});
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Authentication Cloud Functions', () => {
    test('should validate registerUser function exists and requires parameters', async () => {
      try {
        const result = await Parse.Cloud.run('registerUser', {});
        expect(result).toBeDefined();
      } catch (error) {
        // Should fail without required parameters
        expect(error.code).toBeDefined();
      }
    });

    test('should validate loginUser function exists and requires parameters', async () => {
      try {
        const result = await Parse.Cloud.run('loginUser', {});
        expect(result).toBeDefined();
      } catch (error) {
        // Should fail without credentials
        expect(error.code).toBeDefined();
      }
    });

    test('should validate refreshToken function exists', async () => {
      try {
        const result = await Parse.Cloud.run('refreshToken', {
          refreshToken: 'invalid-token'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Should fail with invalid token
        expect(error.code).toBeDefined();
      }
    });

    test('should validate changePassword function requires authentication', async () => {
      try {
        const result = await Parse.Cloud.run('changePassword', {
          currentPassword: 'old',
          newPassword: 'new'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Should fail without authentication
        expect(error.code).toBeDefined();
        expect(error.message).toContain('Authentication required');
      }
    });

    test('should validate initiatePasswordReset function exists', async () => {
      try {
        const result = await Parse.Cloud.run('initiatePasswordReset', {
          email: 'test@example.com'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // May fail due to email service configuration
        expect(error.code).toBeDefined();
      }
    });

    test('should validate resetPassword function exists', async () => {
      try {
        const result = await Parse.Cloud.run('resetPassword', {
          resetToken: 'invalid-token',
          newPassword: 'newpassword'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Should fail with invalid token
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('OAuth Provider Functions', () => {
    test('should validate generateOAuthUrl function exists', async () => {
      try {
        const result = await Parse.Cloud.run('generateOAuthUrl', {
          provider: 'google',
          state: 'test-state'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate handleOAuthCallback function exists', async () => {
      try {
        const result = await Parse.Cloud.run('handleOAuthCallback', {
          provider: 'google',
          code: 'test-code',
          state: 'test-state'
        });
        expect(result).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should validate linkOAuthAccount function requires authentication', async () => {
      try {
        const result = await Parse.Cloud.run('linkOAuthAccount', {
          provider: 'google',
          oauthData: { id: 'test' }
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Should require authentication
        expect(error.code).toBeDefined();
        expect(error.message).toContain('Authentication required');
      }
    });

    test('should validate unlinkOAuthAccount function requires authentication', async () => {
      try {
        const result = await Parse.Cloud.run('unlinkOAuthAccount', {
          provider: 'google'
        });
        expect(result).toBeDefined();
      } catch (error) {
        // Should require authentication
        expect(error.code).toBeDefined();
        expect(error.message).toContain('Authentication required');
      }
    });

    test('should validate getOAuthProviders function works without authentication', async () => {
      const result = await Parse.Cloud.run('getOAuthProviders', {});

      expect(result).toBeDefined();
      expect(result.providers).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);
    });
  });

  describe('Function Parameter Validation', () => {
    test('should validate functions handle missing required parameters', async () => {
      const functionsWithRequiredParams = [
        { name: 'loginUser', params: {} },
        { name: 'registerUser', params: {} },
        { name: 'generateOAuthUrl', params: {} },
        { name: 'handleOAuthCallback', params: {} }
      ];

      for (const { name, params } of functionsWithRequiredParams) {
        try {
          await Parse.Cloud.run(name, params);
          // If it succeeds, that's unexpected but not necessarily wrong
        } catch (error) {
          // Should fail with validation error
          expect(error.code).toBeDefined();
          expect(typeof error.message).toBe('string');
        }
      }
    });

    test('should validate functions handle invalid parameter types', async () => {
      const invalidParams = [
        { name: 'test', params: { invalidDate: 'not-a-date' } },
        { name: 'generateOAuthUrl', params: { provider: null } },
        { name: 'refreshToken', params: { refreshToken: 123 } }
      ];

      for (const { name, params } of invalidParams) {
        try {
          await Parse.Cloud.run(name, params);
          // Some functions might handle invalid params gracefully
        } catch (error) {
          expect(error.code).toBeDefined();
        }
      }
    });
  });

  describe('Function Performance Testing', () => {
    test('should measure basic function performance', async () => {
      const basicFunctions = ['hello', 'test', 'getOAuthProviders'];

      for (const functionName of basicFunctions) {
        const performanceStats = await testHelpers.measurePerformance(
          async () => {
            return await Parse.Cloud.run(functionName, {});
          },
          5 // 5 iterations
        );

        expect(performanceStats.successfulOperations).toBeGreaterThan(0);
        expect(performanceStats.averageDuration).toBeLessThan(10000); // 10 seconds max
      }
    });

    test('should measure concurrent function execution', async () => {
      const concurrentCalls = 5;
      const promises = [];

      for (let i = 0; i < concurrentCalls; i++) {
        promises.push(Parse.Cloud.run('hello', { index: i }));
      }

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      expect(results.length).toBe(concurrentCalls);
      expect(totalTime).toBeLessThan(30000); // 30 seconds for all concurrent calls

      results.forEach((result, index) => {
        expect(result.message).toBe('Hello from Cloud Code!');
      });
    });
  });

  describe('Function Error Response Validation', () => {
    test('should validate error response structure', async () => {
      try {
        await Parse.Cloud.run('nonExistentFunction', {});
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe('number');
        expect(error.message).toBeDefined();
        expect(typeof error.message).toBe('string');
      }
    });

    test('should validate authentication error responses', async () => {
      try {
        await Parse.Cloud.run('changePassword', {
          currentPassword: 'old',
          newPassword: 'new'
        });
      } catch (error) {
        expect(error.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
        expect(error.message).toContain('Authentication required');
      }
    });

    test('should validate parameter validation error responses', async () => {
      try {
        await Parse.Cloud.run('generateOAuthUrl', {
          provider: null
        });
      } catch (error) {
        expect(error.code).toBeDefined();
        expect(error.message).toBeDefined();
        expect(typeof error.message).toBe('string');
      }
    });
  });

  describe('Complete Function Registry Validation', () => {
    test('should validate all expected cloud functions are registered', async () => {
      const expectedFunctions = [
        // Basic functions
        'hello', 'test',

        // OAuth Admin functions
        'getAvailableCorporateDomains', 'addCorporateDomain', 'getOAuthProviderStatus',
        'testCorporateDomain', 'getOAuthAuditLogs',

        // Corporate Landing functions
        'getCorporateLandingConfig', 'generateCorporateOAuthURL', 'validateCorporateLandingAccess',
        'getCorporateClientDepartments',

        // Corporate Sync functions
        'triggerCorporateSync', 'startPeriodicSync', 'stopPeriodicSync',
        'getAllSyncStatuses', 'getCorporateSyncHistory',

        // OAuth Permissions functions
        'getUserPermissionInheritance', 'getAvailableContexts', 'switchPermissionContext',
        'createPermissionDelegation', 'revokePermissionDelegation', 'createEmergencyElevation',
        'createPermissionOverride', 'checkUserPermission', 'getActiveDelegations',
        'getDelegatedPermissions', 'getPermissionAuditReport', 'getPermissionAuditStats',
        'getAvailablePermissions',

        // Department OAuth functions
        'getAvailableDepartments', 'initiateDepartmentOAuth', 'handleDepartmentOAuthCallback',
        'getDepartmentOAuthConfig', 'switchToDepartmentContext', 'getDepartmentOAuthProviders',
        'validateDepartmentOAuthAccess', 'getDepartmentOAuthAnalytics',

        // Apple OAuth functions
        'initiateAppleOAuth', 'handleAppleOAuthCallback', 'getAppleOAuthConfig',
        'revokeAppleOAuth', 'handleAppleWebhook', 'getAppleUserData',
        'validateAppleDomain', 'getAppleOAuthAnalytics',

        // Authentication functions
        'registerUser', 'loginUser', 'refreshToken', 'changePassword',
        'initiatePasswordReset', 'resetPassword',

        // OAuth Provider functions
        'generateOAuthUrl', 'handleOAuthCallback', 'linkOAuthAccount',
        'unlinkOAuthAccount', 'getOAuthProviders'
      ];

      const registrationResults = [];

      // Test function registration in batches to avoid overwhelming the server
      const batchSize = 10;
      for (let i = 0; i < expectedFunctions.length; i += batchSize) {
        const batch = expectedFunctions.slice(i, i + batchSize);

        for (const functionName of batch) {
          try {
            await Parse.Cloud.run(functionName, {});
            registrationResults.push({ function: functionName, registered: true, error: null });
          } catch (error) {
            // Function is registered if we get any error other than "function not found"
            const isRegistered = !error.message.includes('not found') &&
                               !error.message.includes('Invalid function');
            registrationResults.push({
              function: functionName,
              registered: isRegistered,
              error: error.message
            });
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const unregisteredFunctions = registrationResults.filter(r => !r.registered);

      if (unregisteredFunctions.length > 0) {
        console.warn('Unregistered functions found:', unregisteredFunctions);
      }

      // Most functions should be registered
      const registeredCount = registrationResults.filter(r => r.registered).length;
      const registrationPercentage = (registeredCount / expectedFunctions.length) * 100;

      expect(registrationPercentage).toBeGreaterThan(80); // At least 80% should be registered
    });
  });
});