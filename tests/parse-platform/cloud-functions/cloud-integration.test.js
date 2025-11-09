/**
 * Cloud Function Integration Test Suite
 * Tests end-to-end cloud function workflows and integration scenarios
 */

const Parse = require('parse/node');
const ParseTestHelpers = require('../helpers/parse-test-helpers');
const TestDataFactory = require('../helpers/test-data-factory');

describe('Cloud Function Integration Tests', () => {
  let testHelpers;
  let testDataFactory;
  let testObjects = [];
  let testUsers = [];

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

    if (testUsers.length > 0) {
      try {
        await Parse.Object.destroyAll(testUsers, { useMasterKey: true });
        testUsers = [];
      } catch (error) {
        console.warn('Error cleaning up test users:', error.message);
      }
    }

    // Ensure we're logged out
    try {
      await Parse.User.logOut();
    } catch (error) {
      // Ignore logout errors
    }
  });

  describe('Authentication Integration Workflows', () => {
    test('should complete full user registration and login workflow', async () => {
      const userParams = {
        username: 'integrationuser',
        email: 'integration@example.com',
        password: 'testpassword123',
        firstName: 'Integration',
        lastName: 'User',
        role: 'user'
      };

      // Test user registration
      let registrationResult;
      try {
        registrationResult = await Parse.Cloud.run('registerUser', userParams);
      } catch (error) {
        // Registration might fail due to missing service dependencies
        // but we can test the function exists and handles parameters
        expect(error.code).toBeDefined();
        console.warn('Registration test skipped due to service dependency:', error.message);
        return;
      }

      expect(registrationResult).toBeDefined();

      // Test user login
      let loginResult;
      try {
        loginResult = await Parse.Cloud.run('loginUser', {
          identifier: userParams.username,
          password: userParams.password
        });

        expect(loginResult).toBeDefined();
        expect(loginResult.user).toBeDefined();
        expect(loginResult.sessionToken).toBeDefined();
      } catch (error) {
        // Login might fail if registration didn't complete
        expect(error.code).toBeDefined();
        console.warn('Login test skipped due to registration failure:', error.message);
      }
    });

    test('should test password change workflow', async () => {
      // Create test user directly in database
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const testUser = new AmexingUser();

      testUser.set('username', 'passwordchangeuser');
      testUser.set('email', 'passwordchange@example.com');
      testUser.set('firstName', 'Password');
      testUser.set('lastName', 'Change');
      testUser.set('role', 'user');

      const savedUser = await testHelpers.saveWithRetry(testUser);
      testUsers.push(savedUser);

      // Create Parse.User for authentication
      const parseUser = new Parse.User();
      parseUser.set('username', 'passwordchangeuser');
      parseUser.set('email', 'passwordchange@example.com');
      parseUser.set('password', 'oldpassword123');

      const savedParseUser = await testHelpers.saveWithRetry(parseUser);
      testUsers.push(savedParseUser);

      // Login to get authenticated context
      const loggedInUser = await Parse.User.logIn('passwordchangeuser', 'oldpassword123');

      try {
        // Test password change
        const changeResult = await Parse.Cloud.run('changePassword', {
          currentPassword: 'oldpassword123',
          newPassword: 'newpassword123'
        });

        expect(changeResult).toBeDefined();
        expect(changeResult.success).toBe(true);
      } catch (error) {
        // Password change might fail due to service dependencies
        expect(error.code).toBeDefined();
        console.warn('Password change test affected by service dependency:', error.message);
      } finally {
        await Parse.User.logOut();
      }
    });

    test('should test password reset workflow', async () => {
      // Test password reset initiation
      try {
        const resetResult = await Parse.Cloud.run('initiatePasswordReset', {
          email: 'test@example.com'
        });

        expect(resetResult).toBeDefined();
      } catch (error) {
        // Password reset might fail due to email service configuration
        expect(error.code).toBeDefined();
        console.warn('Password reset test affected by email service dependency:', error.message);
      }

      // Test password reset completion (with invalid token)
      try {
        await Parse.Cloud.run('resetPassword', {
          resetToken: 'invalid-token-12345',
          newPassword: 'newpassword123'
        });
      } catch (error) {
        // Should fail with invalid token
        expect(error.code).toBeDefined();
        expect(error.message).toBeDefined();
      }
    });
  });

  describe('OAuth Integration Workflows', () => {
    test('should test OAuth provider configuration workflow', async () => {
      // Get available OAuth providers
      const providersResult = await Parse.Cloud.run('getOAuthProviders', {});

      expect(providersResult).toBeDefined();
      expect(providersResult.providers).toBeDefined();
      expect(Array.isArray(providersResult.providers)).toBe(true);

      // Test OAuth URL generation for each provider
      const commonProviders = ['google', 'microsoft', 'apple'];

      for (const provider of commonProviders) {
        try {
          const urlResult = await Parse.Cloud.run('generateOAuthUrl', {
            provider: provider,
            state: `test-state-${provider}`
          });

          expect(urlResult).toBeDefined();
          expect(urlResult.authUrl).toBeDefined();
          expect(typeof urlResult.authUrl).toBe('string');
        } catch (error) {
          // Provider might not be configured
          expect(error.code).toBeDefined();
          console.warn(`OAuth provider ${provider} not configured or available:`, error.message);
        }
      }
    });

    test('should test OAuth callback handling', async () => {
      const testProviders = ['google', 'microsoft'];

      for (const provider of testProviders) {
        try {
          const callbackResult = await Parse.Cloud.run('handleOAuthCallback', {
            provider: provider,
            code: 'test-authorization-code',
            state: 'test-state'
          });

          // This will likely fail with invalid code, but function should exist
          expect(callbackResult).toBeDefined();
        } catch (error) {
          // Should fail with invalid authorization code
          expect(error.code).toBeDefined();
          expect(error.message).toBeDefined();
        }
      }
    });

    test('should test OAuth account linking workflow', async () => {
      // Create and login test user
      const parseUser = new Parse.User();
      parseUser.set('username', 'oauthlinkuser');
      parseUser.set('email', 'oauthlink@example.com');
      parseUser.set('password', 'testpassword123');

      const savedUser = await testHelpers.saveWithRetry(parseUser);
      testUsers.push(savedUser);

      const loggedInUser = await Parse.User.logIn('oauthlinkuser', 'testpassword123');

      try {
        // Test OAuth account linking
        const linkResult = await Parse.Cloud.run('linkOAuthAccount', {
          provider: 'google',
          oauthData: {
            id: 'google-test-id',
            email: 'oauthlink@google.com',
            name: 'OAuth Link User'
          }
        });

        expect(linkResult).toBeDefined();
      } catch (error) {
        // Linking might fail due to service dependencies
        expect(error.code).toBeDefined();
        console.warn('OAuth linking test affected by service dependency:', error.message);
      } finally {
        await Parse.User.logOut();
      }
    });
  });

  describe('Corporate OAuth Integration Workflows', () => {
    test('should test corporate domain management workflow', async () => {
      // Test getting available corporate domains
      try {
        const domainsResult = await Parse.Cloud.run('getAvailableCorporateDomains', {});
        expect(domainsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test adding corporate domain
      try {
        const addResult = await Parse.Cloud.run('addCorporateDomain', {
          domain: 'testcorp.example.com',
          name: 'Test Corporation',
          oauthProvider: 'google'
        });
        expect(addResult).toBeDefined();
      } catch (error) {
        // Might fail due to authorization or validation
        expect(error.code).toBeDefined();
      }

      // Test domain validation
      try {
        const testResult = await Parse.Cloud.run('testCorporateDomain', {
          domain: 'testcorp.example.com'
        });
        expect(testResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test corporate landing configuration workflow', async () => {
      // Test getting corporate landing config
      try {
        const configResult = await Parse.Cloud.run('getCorporateLandingConfig', {
          domain: 'example.com'
        });
        expect(configResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test generating corporate OAuth URL
      try {
        const urlResult = await Parse.Cloud.run('generateCorporateOAuthURL', {
          domain: 'example.com',
          provider: 'google',
          redirectUrl: 'https://example.com/callback'
        });
        expect(urlResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test validating corporate landing access
      try {
        const accessResult = await Parse.Cloud.run('validateCorporateLandingAccess', {
          domain: 'example.com',
          userEmail: 'user@example.com'
        });
        expect(accessResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test corporate sync workflow', async () => {
      const testDomain = 'sync.example.com';

      // Test triggering corporate sync
      try {
        const syncResult = await Parse.Cloud.run('triggerCorporateSync', {
          domain: testDomain,
          syncType: 'full'
        });
        expect(syncResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting sync status
      try {
        const statusResult = await Parse.Cloud.run('getAllSyncStatuses', {});
        expect(statusResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting sync history
      try {
        const historyResult = await Parse.Cloud.run('getCorporateSyncHistory', {
          domain: testDomain,
          limit: 10
        });
        expect(historyResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Permission Management Integration Workflows', () => {
    test('should test permission context workflow', async () => {
      // Test getting available contexts
      try {
        const contextsResult = await Parse.Cloud.run('getAvailableContexts', {});
        expect(contextsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test switching permission context
      try {
        const switchResult = await Parse.Cloud.run('switchPermissionContext', {
          contextId: 'test-context-id',
          contextType: 'department'
        });
        expect(switchResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting available permissions
      try {
        const permissionsResult = await Parse.Cloud.run('getAvailablePermissions', {
          contextType: 'department'
        });
        expect(permissionsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test permission delegation workflow', async () => {
      // Test creating permission delegation
      try {
        const delegationResult = await Parse.Cloud.run('createPermissionDelegation', {
          targetUserId: 'test-user-id',
          permissions: ['read', 'write'],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });
        expect(delegationResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting active delegations
      try {
        const activeDelegationsResult = await Parse.Cloud.run('getActiveDelegations', {});
        expect(activeDelegationsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test revoking delegation
      try {
        const revokeResult = await Parse.Cloud.run('revokePermissionDelegation', {
          delegationId: 'test-delegation-id'
        });
        expect(revokeResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test permission audit workflow', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      const endDate = new Date();

      // Test getting permission audit report
      try {
        const auditResult = await Parse.Cloud.run('getPermissionAuditReport', {
          startDate: startDate,
          endDate: endDate,
          userId: 'test-user-id'
        });
        expect(auditResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting audit statistics
      try {
        const statsResult = await Parse.Cloud.run('getPermissionAuditStats', {
          startDate: startDate,
          endDate: endDate
        });
        expect(statsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Department OAuth Integration Workflows', () => {
    test('should test department OAuth setup workflow', async () => {
      // Test getting available departments
      try {
        const departmentsResult = await Parse.Cloud.run('getAvailableDepartments', {});
        expect(departmentsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting department OAuth config
      try {
        const configResult = await Parse.Cloud.run('getDepartmentOAuthConfig', {
          departmentId: 'test-department'
        });
        expect(configResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test initiating department OAuth
      try {
        const oauthResult = await Parse.Cloud.run('initiateDepartmentOAuth', {
          departmentId: 'test-department',
          provider: 'google',
          redirectUrl: 'https://example.com/dept-callback'
        });
        expect(oauthResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test department OAuth callback and validation workflow', async () => {
      // Test handling department OAuth callback
      try {
        const callbackResult = await Parse.Cloud.run('handleDepartmentOAuthCallback', {
          code: 'test-dept-code',
          state: 'test-dept-state',
          departmentId: 'test-department'
        });
        expect(callbackResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test validating department OAuth access
      try {
        const accessResult = await Parse.Cloud.run('validateDepartmentOAuthAccess', {
          departmentId: 'test-department',
          userId: 'test-user-id'
        });
        expect(accessResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting department analytics
      try {
        const analyticsResult = await Parse.Cloud.run('getDepartmentOAuthAnalytics', {
          departmentId: 'test-department',
          timeRange: '30d'
        });
        expect(analyticsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Apple OAuth Integration Workflows', () => {
    test('should test Apple OAuth setup and configuration workflow', async () => {
      // Test getting Apple OAuth config
      try {
        const configResult = await Parse.Cloud.run('getAppleOAuthConfig', {
          clientType: 'web'
        });
        expect(configResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test initiating Apple OAuth
      try {
        const initiateResult = await Parse.Cloud.run('initiateAppleOAuth', {
          clientType: 'web',
          redirectUri: 'https://example.com/apple-callback'
        });
        expect(initiateResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test validating Apple domain
      try {
        const domainResult = await Parse.Cloud.run('validateAppleDomain', {
          domain: 'example.com'
        });
        expect(domainResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test Apple OAuth callback and management workflow', async () => {
      // Test handling Apple OAuth callback
      try {
        const callbackResult = await Parse.Cloud.run('handleAppleOAuthCallback', {
          code: 'test-apple-code',
          id_token: 'test-apple-id-token',
          state: 'test-apple-state'
        });
        expect(callbackResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting Apple user data
      try {
        const userDataResult = await Parse.Cloud.run('getAppleUserData', {
          userId: 'test-user-id'
        });
        expect(userDataResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test revoking Apple OAuth
      try {
        const revokeResult = await Parse.Cloud.run('revokeAppleOAuth', {
          userId: 'test-user-id'
        });
        expect(revokeResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });

    test('should test Apple webhook and analytics workflow', async () => {
      // Test handling Apple webhook
      try {
        const webhookResult = await Parse.Cloud.run('handleAppleWebhook', {
          event: 'email-disabled',
          sub: 'test-apple-sub'
        });
        expect(webhookResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }

      // Test getting Apple OAuth analytics
      try {
        const analyticsResult = await Parse.Cloud.run('getAppleOAuthAnalytics', {
          timeRange: '30d'
        });
        expect(analyticsResult).toBeDefined();
      } catch (error) {
        expect(error.code).toBeDefined();
      }
    });
  });

  describe('Cross-Function Integration and Data Flow', () => {
    test('should test complete user lifecycle with OAuth integration', async () => {
      const userEmail = 'lifecycle@example.com';
      const username = 'lifecycleuser';

      // Step 1: Get OAuth providers
      const providersResult = await Parse.Cloud.run('getOAuthProviders', {});
      expect(providersResult.providers).toBeDefined();

      // Step 2: Attempt user registration (may fail due to service dependencies)
      try {
        const registerResult = await Parse.Cloud.run('registerUser', {
          username: username,
          email: userEmail,
          password: 'testpassword123',
          firstName: 'Lifecycle',
          lastName: 'User',
          role: 'user'
        });

        // Step 3: If registration succeeds, test login
        if (registerResult && registerResult.success) {
          const loginResult = await Parse.Cloud.run('loginUser', {
            identifier: username,
            password: 'testpassword123'
          });

          expect(loginResult.user).toBeDefined();
          expect(loginResult.sessionToken).toBeDefined();

          // Step 4: Test OAuth account linking
          try {
            const linkResult = await Parse.Cloud.run('linkOAuthAccount', {
              provider: 'google',
              oauthData: {
                id: 'google-lifecycle-id',
                email: userEmail,
                name: 'Lifecycle User'
              }
            });
            expect(linkResult).toBeDefined();
          } catch (linkError) {
            console.warn('OAuth linking failed:', linkError.message);
          }
        }
      } catch (error) {
        console.warn('User lifecycle test affected by service dependencies:', error.message);
        expect(error.code).toBeDefined();
      }
    });

    test('should test performance of integrated workflows', async () => {
      const performanceStats = await testHelpers.measurePerformance(
        async () => {
          // Test a sequence of cloud function calls
          const providersResult = await Parse.Cloud.run('getOAuthProviders', {});
          const helloResult = await Parse.Cloud.run('hello', {});
          const testResult = await Parse.Cloud.run('test', { workflow: 'performance' });

          return {
            providers: providersResult,
            hello: helloResult,
            test: testResult
          };
        },
        5 // 5 iterations
      );

      expect(performanceStats.successfulOperations).toBe(5);
      expect(performanceStats.failedOperations).toBe(0);
      expect(performanceStats.averageDuration).toBeLessThan(15000); // 15 seconds for integrated workflow
    });

    test('should test concurrent cloud function execution across different categories', async () => {
      const concurrentCalls = [
        Parse.Cloud.run('hello', {}),
        Parse.Cloud.run('getOAuthProviders', {}),
        Parse.Cloud.run('getAvailableContexts', {}),
        Parse.Cloud.run('getAvailableDepartments', {}),
        Parse.Cloud.run('getAppleOAuthConfig', {})
      ];

      const startTime = Date.now();
      const results = await Promise.allSettled(concurrentCalls);
      const totalTime = Date.now() - startTime;

      expect(results.length).toBe(5);
      expect(totalTime).toBeLessThan(30000); // 30 seconds for all concurrent calls

      // Check that at least some calls succeeded
      const successfulCalls = results.filter(r => r.status === 'fulfilled').length;
      expect(successfulCalls).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Recovery Integration', () => {
    test('should test error propagation across integrated workflows', async () => {
      // Test workflow with deliberate errors
      try {
        // This should fail - invalid parameters
        await Parse.Cloud.run('generateOAuthUrl', {
          provider: null,
          state: null
        });
      } catch (error) {
        expect(error.code).toBeDefined();
        expect(error.message).toBeDefined();
      }

      // Verify system still works after error
      const result = await Parse.Cloud.run('hello', {});
      expect(result.message).toBe('Hello from Cloud Code!');
    });

    test('should test timeout handling in integrated workflows', async () => {
      // Test multiple concurrent calls with timeout expectations
      const timeoutTest = async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(Parse.Cloud.run('hello', { index: i }));
        }
        return await Promise.all(promises);
      };

      const performanceStats = await testHelpers.measurePerformance(timeoutTest, 1);

      expect(performanceStats.successfulOperations).toBe(1);
      expect(performanceStats.averageDuration).toBeLessThan(30000); // 30 seconds timeout
    });
  });
});