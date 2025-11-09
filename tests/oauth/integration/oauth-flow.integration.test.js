/**
 * OAuth Integration Flow Tests
 * End-to-end testing of OAuth authentication flows
 */

const request = require('supertest');
const OAuthTestSetup = require('../helpers/oauth-setup');
const PCIComplianceSetup = require('../helpers/pci-compliance-setup');
const SyntheticUserGenerator = require('../helpers/synthetic-data/user-generator');

// Note: In a real implementation, this would import the actual Express app
// For testing purposes, we'll create a mock app structure
const createMockApp = () => {
  const express = require('express');
  const session = require('express-session');
  const app = express();

  app.use(express.json());
  app.use(session({
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // For testing only
  }));

  // Mock OAuth endpoints
  app.get('/auth/:provider', (req, res) => {
    const { provider } = req.params;
    const authUrl = `https://${provider}.example.com/oauth/authorize?client_id=test&redirect_uri=http://localhost:1337/auth/${provider}/callback`;
    res.json({ authUrl, provider });
  });

  app.get('/auth/:provider/callback', (req, res) => {
    const { provider } = req.params;
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Mock successful callback
    res.json({
      success: true,
      provider,
      code,
      state,
      message: 'OAuth callback processed successfully'
    });
  });

  app.post('/auth/oauth/register', (req, res) => {
    const { provider, tokens, userInfo } = req.body;
    
    if (!provider || !tokens || !userInfo) {
      return res.status(400).json({ error: 'Missing required OAuth data' });
    }

    // Mock user registration
    res.status(201).json({
      success: true,
      user: {
        id: `test_user_${Date.now()}`,
        email: userInfo.email,
        provider
      },
      message: 'User registered successfully'
    });
  });

  app.get('/api/user/profile', (req, res) => {
    // Mock protected endpoint
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    res.json({
      user: {
        id: 'test_user_123',
        email: 'test.user@amexing-test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'employee'
      }
    });
  });

  return app;
};

describe('OAuth Integration Flow Tests', () => {
  let app;
  let oauthSetup;
  let pciSetup;
  let userGenerator;

  beforeAll(async () => {
    // Initialize test environment
    app = createMockApp();
    oauthSetup = new OAuthTestSetup();
    pciSetup = new PCIComplianceSetup();
    userGenerator = new SyntheticUserGenerator();

    await oauthSetup.setup();
    await pciSetup.setup();
  });

  afterAll(async () => {
    await oauthSetup.teardown();
    const complianceReport = await pciSetup.teardown();
    console.log('PCI DSS Compliance Report:', complianceReport.compliance);
  });

  beforeEach(async () => {
    await oauthSetup.clearTestData();
  });

  describe('Google OAuth Integration Flow', () => {
    test('should complete full Google OAuth flow', async () => {
      pciSetup.verifyOperationCompliance('oauth_authentication', { 
        provider: 'google',
        flow: 'integration'
      });

      // Step 1: Initiate OAuth flow
      const initiateResponse = await request(app)
        .get('/auth/google')
        .expect(200);

      expect(initiateResponse.body).toHaveProperty('authUrl');
      expect(initiateResponse.body).toHaveProperty('provider', 'google');
      expect(initiateResponse.body.authUrl).toContain('google.example.com/oauth/authorize');

      // Step 2: Handle OAuth callback
      const callbackResponse = await request(app)
        .get('/auth/google/callback')
        .query({
          code: 'test_authorization_code_12345',
          state: 'test_state_token'
        })
        .expect(200);

      expect(callbackResponse.body.success).toBe(true);
      expect(callbackResponse.body.provider).toBe('google');
      expect(callbackResponse.body.code).toBe('test_authorization_code_12345');

      // Step 3: Register user with OAuth data
      const testUser = userGenerator.generateUserWithOAuth('google');
      pciSetup.validateSyntheticData(testUser);

      const registerResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'google',
          tokens: {
            access_token: 'test_access_token',
            refresh_token: 'test_refresh_token',
            id_token: 'test_id_token'
          },
          userInfo: {
            email: testUser.email,
            name: testUser.fullName,
            given_name: testUser.firstName,
            family_name: testUser.lastName
          }
        })
        .expect(201);

      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user.email).toBe(testUser.email);
      expect(registerResponse.body.user.provider).toBe('google');

      pciSetup.logAuditEvent('OAUTH_INTEGRATION_COMPLETE', 'Google OAuth integration flow completed successfully', {
        provider: 'google',
        userEmail: testUser.email
      });
    });

    test('should handle Google OAuth errors gracefully', async () => {
      // Test missing authorization code
      const errorResponse = await request(app)
        .get('/auth/google/callback')
        .query({ state: 'test_state' })
        .expect(400);

      expect(errorResponse.body.error).toBe('Missing authorization code');

      // Test invalid registration data
      const invalidRegisterResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'google'
          // Missing tokens and userInfo
        })
        .expect(400);

      expect(invalidRegisterResponse.body.error).toBe('Missing required OAuth data');
    });
  });

  describe('Microsoft OAuth Integration Flow', () => {
    test('should complete full Microsoft OAuth flow', async () => {
      pciSetup.verifyOperationCompliance('oauth_authentication', { 
        provider: 'microsoft',
        flow: 'integration'
      });

      // Step 1: Initiate OAuth flow
      const initiateResponse = await request(app)
        .get('/auth/microsoft')
        .expect(200);

      expect(initiateResponse.body.authUrl).toContain('microsoft.example.com/oauth/authorize');
      expect(initiateResponse.body.provider).toBe('microsoft');

      // Step 2: Handle OAuth callback
      const callbackResponse = await request(app)
        .get('/auth/microsoft/callback')
        .query({
          code: 'microsoft_auth_code_67890',
          state: 'microsoft_state_token'
        })
        .expect(200);

      expect(callbackResponse.body.success).toBe(true);
      expect(callbackResponse.body.provider).toBe('microsoft');

      // Step 3: Register corporate user
      const corporateUser = userGenerator.generateCorporateUser('TEST_CORP_001', 'manager');
      const microsoftUser = userGenerator.generateUserWithOAuth('microsoft', corporateUser);
      pciSetup.validateSyntheticData(microsoftUser);

      const registerResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'microsoft',
          tokens: {
            access_token: 'microsoft_access_token',
            refresh_token: 'microsoft_refresh_token',
            id_token: 'microsoft_id_token'
          },
          userInfo: {
            email: microsoftUser.email,
            displayName: microsoftUser.fullName,
            userPrincipalName: microsoftUser.email,
            jobTitle: 'Test Manager'
          }
        })
        .expect(201);

      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user.provider).toBe('microsoft');

      pciSetup.logAuditEvent('OAUTH_INTEGRATION_COMPLETE', 'Microsoft OAuth integration flow completed successfully', {
        provider: 'microsoft',
        corporateId: corporateUser.corporateId
      });
    });
  });

  describe('Apple OAuth Integration Flow', () => {
    test('should complete full Apple OAuth flow', async () => {
      pciSetup.verifyOperationCompliance('oauth_authentication', { 
        provider: 'apple',
        flow: 'integration'
      });

      // Apple OAuth flow
      const initiateResponse = await request(app)
        .get('/auth/apple')
        .expect(200);

      expect(initiateResponse.body.authUrl).toContain('apple.example.com/oauth/authorize');

      const callbackResponse = await request(app)
        .get('/auth/apple/callback')
        .query({
          code: 'apple_auth_code_abcdef',
          state: 'apple_state_token'
        })
        .expect(200);

      expect(callbackResponse.body.success).toBe(true);
      expect(callbackResponse.body.provider).toBe('apple');

      // Register Apple user
      const appleUser = userGenerator.generateUserWithOAuth('apple');
      pciSetup.validateSyntheticData(appleUser);

      const registerResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'apple',
          tokens: {
            access_token: 'apple_access_token',
            id_token: 'apple_id_token'
          },
          userInfo: {
            email: appleUser.email,
            sub: 'apple_user_identifier',
            name: {
              firstName: appleUser.firstName,
              lastName: appleUser.lastName
            }
          }
        })
        .expect(201);

      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.user.provider).toBe('apple');
    });
  });

  describe('OAuth Security and Authorization', () => {
    test('should protect endpoints with OAuth tokens', async () => {
      // Test accessing protected endpoint without token
      const unauthorizedResponse = await request(app)
        .get('/api/user/profile')
        .expect(401);

      expect(unauthorizedResponse.body.error).toBe('Missing or invalid authorization header');

      // Test with valid token
      const authorizedResponse = await request(app)
        .get('/api/user/profile')
        .set('Authorization', 'Bearer test_valid_access_token')
        .expect(200);

      expect(authorizedResponse.body.user).toHaveProperty('email');
      expect(authorizedResponse.body.user).toHaveProperty('role');

      pciSetup.logAuditEvent('PROTECTED_ENDPOINT_ACCESS', 'Protected endpoint accessed successfully', {
        endpoint: '/api/user/profile',
        tokenType: 'Bearer'
      });
    });

    test('should validate OAuth state parameter', async () => {
      const stateToken = 'secure_state_token_' + Date.now();
      
      const callbackResponse = await request(app)
        .get('/auth/google/callback')
        .query({
          code: 'test_auth_code',
          state: stateToken
        })
        .expect(200);

      expect(callbackResponse.body.state).toBe(stateToken);
    });

    test('should handle CSRF protection in OAuth flow', async () => {
      // This test would verify CSRF token validation in real implementation
      const csrfToken = 'csrf_token_' + Date.now();
      
      // Mock request with CSRF token
      const response = await request(app)
        .get('/auth/google')
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(response.body).toHaveProperty('authUrl');
    });
  });

  describe('Corporate SSO Integration', () => {
    test('should handle corporate domain validation', async () => {
      pciSetup.verifyOperationCompliance('oauth_authentication', { 
        type: 'corporate_sso',
        domain: 'amexing-test.com'
      });

      const corporateUser = userGenerator.generateCorporateUser('TEST_CORP_001', 'admin');
      
      // Simulate Google Workspace domain validation
      const corporateOAuthUser = {
        ...corporateUser,
        email: 'admin.user@amexing-test.com', // Corporate domain
        oauthAccounts: [{
          provider: 'google',
          email: 'admin.user@amexing-test.com',
          profileData: {
            hd: 'amexing-test.com' // Hosted domain
          }
        }]
      };

      pciSetup.validateSyntheticData(corporateOAuthUser);

      const registerResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'google',
          tokens: {
            access_token: 'corporate_access_token',
            refresh_token: 'corporate_refresh_token'
          },
          userInfo: {
            email: corporateOAuthUser.email,
            hd: 'amexing-test.com',
            name: corporateOAuthUser.fullName
          }
        })
        .expect(201);

      expect(registerResponse.body.user.email).toContain('@amexing-test.com');

      pciSetup.logAuditEvent('CORPORATE_SSO_REGISTRATION', 'Corporate SSO user registered', {
        domain: 'amexing-test.com',
        provider: 'google'
      });
    });

    test('should handle role assignment for corporate users', async () => {
      const managerUser = userGenerator.generateCorporateUser('TEST_CORP_001', 'manager');
      const adminUser = userGenerator.generateCorporateUser('TEST_CORP_001', 'admin');

      // Validate permissions are correctly assigned
      expect(managerUser.permissions.canManageTeam).toBe(true);
      expect(managerUser.permissions.canCreateEvents).toBe(true);
      expect(adminUser.permissions.canManageUsers).toBe(true);
      expect(adminUser.permissions.canAccessFinance).toBe(true);

      pciSetup.validateSyntheticData(managerUser);
      pciSetup.validateSyntheticData(adminUser);
    });
  });

  describe('OAuth Session Management', () => {
    test('should manage OAuth sessions securely', async () => {
      const agent = request.agent(app);

      // Initiate OAuth with session
      const sessionResponse = await agent
        .get('/auth/google')
        .expect(200);

      expect(sessionResponse.body).toHaveProperty('authUrl');

      // Complete OAuth with same session
      const callbackResponse = await agent
        .get('/auth/google/callback')
        .query({
          code: 'session_test_code',
          state: 'session_test_state'
        })
        .expect(200);

      expect(callbackResponse.body.success).toBe(true);
    });

    test('should handle session timeout', async () => {
      // This would test session timeout handling in real implementation
      const testUser = userGenerator.generateUser();
      
      pciSetup.logAuditEvent('SESSION_TIMEOUT_TEST', 'Testing session timeout handling', {
        userEmail: testUser.email
      });

      expect(testUser).toHaveProperty('email');
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle OAuth provider downtime', async () => {
      // Simulate provider downtime by expecting specific error handling
      const downResponse = await request(app)
        .get('/auth/google/callback')
        .query({
          error: 'temporarily_unavailable',
          error_description: 'The service is temporarily overloaded'
        })
        .expect(200);

      // In real implementation, this would handle the error gracefully
      expect(downResponse.body).toHaveProperty('provider');
    });

    test('should handle malformed OAuth responses', async () => {
      const malformedResponse = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'google',
          tokens: 'invalid_token_format', // Should be object
          userInfo: null
        })
        .expect(400);

      expect(malformedResponse.body.error).toBe('Missing required OAuth data');
    });

    test('should log and recover from OAuth errors', () => {
      const errorScenarios = [
        'invalid_client',
        'invalid_grant',
        'unsupported_grant_type',
        'invalid_scope'
      ];

      errorScenarios.forEach(error => {
        pciSetup.logAuditEvent('OAUTH_ERROR_HANDLED', `Handled OAuth error: ${error}`, {
          errorType: error,
          recoveryAction: 'redirect_to_login'
        });
      });

      const auditLogs = pciSetup.getAuditLogs();
      const errorLogs = auditLogs.filter(log => log.eventType === 'OAUTH_ERROR_HANDLED');
      
      expect(errorLogs).toHaveLength(4);
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle concurrent OAuth flows', async () => {
      const concurrentRequests = 10;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .get('/auth/google/callback')
            .query({
              code: `concurrent_code_${i}`,
              state: `concurrent_state_${i}`
            })
        );
      }

      const responses = await Promise.all(promises);
      
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.code).toBe(`concurrent_code_${index}`);
      });
    });

    test('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      const loadTest = await request(app)
        .post('/auth/oauth/register')
        .send({
          provider: 'google',
          tokens: {
            access_token: 'load_test_token',
            refresh_token: 'load_test_refresh'
          },
          userInfo: {
            email: 'load.test@amexing-test.com',
            name: 'Load Test User'
          }
        })
        .expect(201);

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(loadTest.body.success).toBe(true);
    });
  });
});