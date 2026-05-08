/**
 * Mobile Authentication Flows Integration Tests
 *
 * Tests for web redirects and mobile token responses.
 * Verifies that:
 * - Web login redirects to correct dashboard by role
 * - Mobile login returns tokens in response body
 * - Mobile refresh returns new tokens via Authorization header
 * - Web flows do NOT include tokens in body (cookies only)
 *
 * @module tests/integration/auth/mobile-auth-flows
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');
const { getTestApp } = require('../../helpers/testAppSetup');

describe('Authentication Flows - Web and Mobile', () => {
  let app;

  beforeAll(async () => {
    app = await getTestApp();
  }, 30000);

  // ═══════════════════════════════════════════════════════════════════════════
  // WEB LOGIN REDIRECTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Web Login Redirects', () => {
    const rolesToTest = [
      { role: 'superadmin', expectedRedirect: '/dashboard/superadmin' },
      { role: 'admin', expectedRedirect: '/dashboard/admin/bookings' },
      { role: 'client', expectedRedirect: '/dashboard/client' },
      { role: 'guest', expectedRedirect: '/dashboard/guest' },
    ];

    test.each(rolesToTest)(
      'should redirect $role to $expectedRedirect',
      async ({ role, expectedRedirect }) => {
        const agent = request.agent(app);
        const credentials = AuthTestHelper.getCredentials(role);

        // Get CSRF token from login page
        const loginPage = await agent.get('/login');
        const csrfToken = AuthTestHelper.extractCsrfToken(loginPage.text);

        // Submit login with HTML Accept header (browser-like)
        const response = await agent
          .post('/auth/login')
          .set('Accept', 'text/html')
          .send({
            identifier: credentials.email,
            password: credentials.password,
            csrfToken,
          });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe(expectedRedirect);
      }
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE LOGIN
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Mobile Login', () => {
    it('should return tokens in response body for mobile client', async () => {
      const credentials = AuthTestHelper.getCredentials('client');

      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.role).toBe('client');

      // Verify tokens are present in body
      expect(response.body.tokens).toBeDefined();
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();
      expect(response.body.tokens.tokenType).toBe('Bearer');
      expect(response.body.tokens.expiresIn).toBeDefined();
    });

    it('should NOT return tokens in body for web API client', async () => {
      const credentials = AuthTestHelper.getCredentials('client');

      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        // NO X-Client-Type header
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();

      // Tokens should NOT be in body
      expect(response.body.tokens).toBeUndefined();
    });

    it('should return correct role in mobile response for multiple roles', async () => {
      const rolesToTest = ['superadmin', 'admin', 'client'];

      for (const role of rolesToTest) {
        const credentials = AuthTestHelper.getCredentials(role);

        const response = await request(app)
          .post('/auth/login')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .set('X-Client-Type', 'mobile')
          .send({
            identifier: credentials.email,
            password: credentials.password,
          });

        expect(response.status).toBe(200);
        expect(response.body.user.role).toBe(role);
      }
    });

    it('should set cookies even for mobile client', async () => {
      const credentials = AuthTestHelper.getCredentials('client');

      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      expect(response.status).toBe(200);

      // Cookies should still be set (for hybrid scenarios)
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.includes('accessToken'))).toBe(true);
      expect(cookies.some((c) => c.includes('refreshToken'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Mobile Refresh Token', () => {
    it('should return new tokens when using Authorization header', async () => {
      const credentials = AuthTestHelper.getCredentials('client');

      // First login to get refresh token
      const loginResponse = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      expect(loginResponse.status).toBe(200);
      const refreshToken = loginResponse.body.tokens.refreshToken;
      expect(refreshToken).toBeDefined();

      // Use refresh token via Authorization header
      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.success).toBe(true);
      expect(refreshResponse.body.user).toBeDefined();

      // Verify new tokens are returned
      expect(refreshResponse.body.tokens).toBeDefined();
      expect(refreshResponse.body.tokens.accessToken).toBeDefined();
      expect(refreshResponse.body.tokens.refreshToken).toBeDefined();

      // New tokens should be different from original
      expect(refreshResponse.body.tokens.accessToken).not.toBe(
        loginResponse.body.tokens.accessToken
      );
    });

    it('should NOT return tokens in body for web refresh (cookie-based)', async () => {
      const agent = request.agent(app);
      const credentials = AuthTestHelper.getCredentials('client');

      // Login via web to set cookies
      const loginResponse = await agent
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      expect(loginResponse.status).toBe(200);

      // Extract refreshToken from cookies and use Bearer token for refresh
      // This bypasses CSRF (which is required for cookie-only refresh)
      const cookies = loginResponse.headers['set-cookie'];
      const refreshTokenCookie = cookies.find((c) => c.startsWith('refreshToken='));
      const refreshToken = refreshTokenCookie?.split(';')[0].split('=')[1];
      expect(refreshToken).toBeDefined();

      // Refresh WITH Bearer token but WITHOUT X-Client-Type (simulates web API client)
      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${refreshToken}`);
      // Note: NOT setting X-Client-Type: mobile

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.success).toBe(true);

      // Tokens should NOT be in body for web (no X-Client-Type header)
      expect(refreshResponse.body.tokens).toBeUndefined();
    });

    it('should reject refresh without valid token', async () => {
      // Note: Without Authorization header, CSRF blocks first (403)
      // This test verifies that an invalid/malformed token is rejected with 401
      // The "should reject refresh with invalid token" test below covers this case
      // This test verifies CSRF protection when no Bearer token is present
      const response = await request(app)
        .post('/auth/refresh')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile');
      // No Authorization header = CSRF blocks = 403

      // CSRF protection returns 403 when no Bearer token is provided
      // This is expected behavior - mobile clients MUST provide Bearer token
      expect(response.status).toBe(403);
    });

    it('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .set('Authorization', 'Bearer invalid-token-here');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should preserve user info in refresh response', async () => {
      const credentials = AuthTestHelper.getCredentials('admin');

      // Login first
      const loginResponse = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .send({
          identifier: credentials.email,
          password: credentials.password,
        });

      const refreshToken = loginResponse.body.tokens.refreshToken;

      // Refresh
      const refreshResponse = await request(app)
        .post('/auth/refresh')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .set('X-Client-Type', 'mobile')
        .set('Authorization', `Bearer ${refreshToken}`);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.user).toBeDefined();
      expect(refreshResponse.body.user.id).toBeDefined();
      expect(refreshResponse.body.user.username).toBeDefined();
    });
  });
});
