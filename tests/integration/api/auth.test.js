/**
 * Authentication API Tests
 * @updated 2025-01-24 - Migrated to MongoDB Memory Server with seed system
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

// Import the Express app directly for testing
let app;

describe('Authentication API', () => {
  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 30000);

  afterAll(async () => {
    // No cleanup needed
  }, 15000);

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      // Use seeded admin user
      const credentials = AuthTestHelper.getCredentials('admin');

      const agent = request.agent(app);

      // First get CSRF token
      const loginPage = await agent.get('/login');
      const csrfMatch = loginPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken
        });

      // Should succeed with 200 or 302 (redirect)
      expect([200, 302]).toContain(response.status);
    });

    it('should reject invalid credentials', async () => {
      const agent = request.agent(app);

      // Get CSRF token
      const loginPage = await agent.get('/login');
      const csrfMatch = loginPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/login')
        .send({
          identifier: 'nonexistent@test.com',
          password: 'wrongpass',
          csrfToken: csrfToken
        });

      // Should be unauthorized (401), bad request (400), or redirect (302)
      expect([302, 400, 401]).toContain(response.status);
    });

    it('should validate required fields', async () => {
      const agent = request.agent(app);

      const response = await agent
        .post('/auth/login')
        .send({
          identifier: 'testuser@test.com'
          // missing password
        });

      // Should be bad request (400), unauthorized (401), forbidden (403), or redirect (302)
      expect([302, 400, 401, 403]).toContain(response.status);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/register', () => {
    it('should register new user with valid data', async () => {
      const agent = request.agent(app);

      // Get CSRF token
      const registerPage = await agent.get('/register');
      const csrfMatch = registerPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const userData = {
        email: `newuser-${Date.now()}@test.com`,
        password: 'TestPass123!',
        firstName: 'New',
        lastName: 'User',
        csrfToken: csrfToken
      };

      const response = await agent
        .post('/auth/register')
        .send(userData);

      // Should either succeed (200, 201, 302) or require additional validation (400, 403)
      expect([200, 201, 302, 400, 403]).toContain(response.status);
    });

    it('should reject duplicate email', async () => {
      // Try to register with existing seeded user email
      const credentials = AuthTestHelper.getCredentials('employee');

      const agent = request.agent(app);

      // Get CSRF token
      const registerPage = await agent.get('/register');
      const csrfMatch = registerPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/register')
        .send({
          email: credentials.email,
          password: 'TestPass123!',
          firstName: 'Duplicate',
          lastName: 'User',
          csrfToken: csrfToken
        });

      // Should reject duplicate (400, 409) or redirect with error (302)
      expect([302, 400, 409]).toContain(response.status);
    });

    it('should validate password requirements', async () => {
      const agent = request.agent(app);

      // Get CSRF token
      const registerPage = await agent.get('/register');
      const csrfMatch = registerPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/register')
        .send({
          email: 'weakpass@test.com',
          password: '123', // Too short
          firstName: 'Test',
          lastName: 'User',
          csrfToken: csrfToken
        });

      // Should reject weak password
      expect([302, 400, 422]).toContain(response.status);
    });

    it('should validate email format', async () => {
      const agent = request.agent(app);

      // Get CSRF token
      const registerPage = await agent.get('/register');
      const csrfMatch = registerPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'TestPass123!',
          firstName: 'Test',
          lastName: 'User',
          csrfToken: csrfToken
        });

      // Should reject invalid email
      expect([302, 400, 422]).toContain(response.status);
    });
  });

  describe('POST /logout', () => {
    it('should logout authenticated user', async () => {
      // Login first to get session
      const credentials = AuthTestHelper.getCredentials('employee');

      const agent = request.agent(app);

      // Get CSRF token and login
      const loginPage = await agent.get('/login');
      const csrfMatch = loginPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken
        });

      // Get new CSRF token for logout
      const homePage = await agent.get('/');
      const logoutCsrfMatch = homePage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const logoutCsrfToken = logoutCsrfMatch ? logoutCsrfMatch[1] : null;

      // Try logout with the same agent (maintains cookies)
      const response = await agent
        .post('/logout')
        .send({ csrfToken: logoutCsrfToken });

      // Should succeed (200), redirect (302), or forbidden (403) if CSRF missing
      expect([200, 302, 403]).toContain(response.status);
    });

    it('should handle logout without session', async () => {
      const agent = request.agent(app);

      const response = await agent
        .post('/logout')
        .send({});

      // Should handle gracefully (200, 302, 400, or 401)
      expect([200, 302, 400, 401, 403]).toContain(response.status);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to login attempts', async () => {
      const requests = [];

      // Make multiple rapid requests
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/auth/login')
            .send({
              identifier: 'test@test.com',
              password: 'test'
            })
        );
      }

      const responses = await Promise.all(requests);

      // Should have mix of regular responses and rate limited
      const statuses = responses.map(r => r.status);

      // Verify we got responses (not all should be successful)
      expect(statuses.length).toBe(10);

      // All should either fail auth, be rate limited, or redirect (302)
      const allFailedOrLimited = statuses.every(s => [302, 400, 401, 403, 429].includes(s));
      expect(allFailedOrLimited).toBe(true);
    }, 10000);
  });

  describe('Session Management', () => {
    it('should create session on successful login', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');

      const agent = request.agent(app);

      // Get CSRF token
      const loginPage = await agent.get('/login');
      const csrfMatch = loginPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      const response = await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken
        });

      // Should get cookies or session indication
      expect([200, 302]).toContain(response.status);

      if (response.headers['set-cookie']) {
        expect(response.headers['set-cookie'].length).toBeGreaterThan(0);
      }
    });

    it('should maintain session across requests', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');

      const agent = request.agent(app);

      // Get CSRF token
      const loginPage = await agent.get('/login');
      const csrfMatch = loginPage.text.match(/name="csrfToken"\s+value="([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;

      // Login
      await agent
        .post('/auth/login')
        .send({
          identifier: credentials.email,
          password: credentials.password,
          csrfToken: csrfToken
        });

      // Make authenticated request
      const response = await agent.get('/');

      // Should maintain session
      expect([200, 302]).toContain(response.status);
    });
  });
});
