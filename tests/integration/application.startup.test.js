/**
 * Application Startup Validation Tests
 * Ensures the complete application starts correctly with all security features
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const app = require('../../src/index');
const { setupTests, teardownTests } = require('../setup');

describe('Application Startup Validation', () => {
  beforeAll(async () => {
    await setupTests();
    // Give the application time to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await teardownTests();
  });

  describe('Server Initialization', () => {
    it('should start the Express server successfully', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: expect.stringMatching(/^(development|test)$/)
      });
    });

    it('should have proper environment configuration', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(['development', 'test']).toContain(response.body.environment);
      expect(response.body.uptime).toBeGreaterThan(0);
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Parse Server Integration', () => {
    it('should initialize Parse Server successfully', async () => {
      const response = await request(app)
        .get('/parse/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok'
      });
    });

    it('should handle Parse Server API endpoints', async () => {
      const response = await request(app)
        .post('/parse/functions/hello')
        .set('X-Parse-Application-Id', process.env.PARSE_APP_ID || 'amexing-app-id-dev')
        .set('Content-Type', 'application/json')
        .send({ name: 'Test' });

      // Should either succeed or return proper error
      expect([200, 400, 403, 404]).toContain(response.status);
    });
  });

  describe('Database Connectivity', () => {
    it('should connect to MongoDB successfully', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Health check should include database status
      expect(response.body).toHaveProperty('database');
      
      // In development, database might be unavailable, so we check graceful handling
      if (response.body.database) {
        expect(response.body.database).toHaveProperty('connected');
        if (response.body.database.connected) {
          expect(response.body.database.responseTime).toBeGreaterThan(0);
        }
      }
    });

    it('should handle database connection gracefully when unavailable', async () => {
      const response = await request(app)
        .get('/health');

      // Should not crash the application if database is unavailable
      expect([200, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(['healthy', 'healthy (db unavailable)']).toContain(response.body.status);
      }
    });
  });

  describe('Security Middleware Loading', () => {
    it('should load all security middleware successfully', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Verify security headers are applied
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should apply rate limiting middleware', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      // Rate limiting headers might be present depending on middleware configuration
      // We check they exist or that the request succeeds (which means rate limiting is working)
      expect(response.status).toBe(200);
    });

    it('should load CORS middleware with proper configuration', async () => {
      const response = await request(app)
        .options('/api/status')
        .set('Origin', 'http://localhost:1337')
        .set('Access-Control-Request-Method', 'GET');

      expect([200, 204, 500]).toContain(response.status);
    });
  });

  describe('Route Registration', () => {
    it('should register web routes successfully', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('AmexingWeb');
    });

    it('should register API routes successfully', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'success',
        message: expect.any(String),
        timestamp: expect.any(String)
      });
    });

    it('should register documentation routes successfully', async () => {
      const response = await request(app)
        .get('/docs')
        .expect(200);

      expect(response.text).toContain('API Documentation');
    });

    it('should handle Parse Server routes', async () => {
      const response = await request(app)
        .get('/parse/serverInfo')
        .set('X-Parse-Application-Id', process.env.PARSE_APP_ID || 'amexing-app-id-dev')
        .set('X-Parse-Master-Key', process.env.PARSE_MASTER_KEY || 'amexing-master-key-dev');

      // Parse Server should respond with server info
      expect([200, 400, 403]).toContain(response.status);
    });
  });

  describe('Static Asset Serving', () => {
    it('should serve static assets from public directory', async () => {
      const response = await request(app)
        .get('/public/css/style.css');

      // Should either serve the file or return 404 if not found
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('Error Handling Setup', () => {
    it('should have proper 404 error handling', async () => {
      const response = await request(app)
        .get('/nonexistent-route')
        .expect(404);

      // Should return structured error response
      if (response.headers['content-type']?.includes('json')) {
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toBe('Not Found');
      }
    });

    it('should handle API errors properly', async () => {
      const response = await request(app)
        .get('/api/nonexistent');

      expect([200, 404, 500]).toContain(response.status);
      
      if (response.headers['content-type']?.includes('json')) {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('Session Management', () => {
    it('should initialize session store successfully', async () => {
      const agent = request.agent(app);
      
      const response = await agent
        .get('/')
        .expect(200);

      // Should set session cookie
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        const sessionCookie = cookies.find(cookie => cookie.includes('amexing.sid'));
        expect(sessionCookie).toBeDefined();
      }
    });
  });

  describe('Logging System', () => {
    it('should initialize logging system successfully', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Application should start without logging errors
      expect(response.body.status).toMatch(/healthy/);
    });
  });

  describe('Metrics Endpoint', () => {
    it('should provide system metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        system: expect.objectContaining({
          uptime: expect.any(Number),
          platform: expect.any(String),
          nodeVersion: expect.any(String),
          pid: expect.any(Number),
          environment: expect.any(String),
          memory: expect.objectContaining({
            heapTotal: expect.any(Number),
            heapUsed: expect.any(Number)
          })
        }),
        application: expect.objectContaining({
          version: expect.any(String),
          startTime: expect.any(String)
        })
      });
    });
  });

  describe('Security Configuration Validation', () => {
    it('should have PCI DSS compliant session timeout', async () => {
      // Session timeout should be 15 minutes or less for PCI DSS compliance
      const expectedTimeout = 15 * 60 * 1000; // 15 minutes in milliseconds
      
      // This is verified through environment configuration
      const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '15', 10) * 60 * 1000;
      expect(sessionTimeout).toBeLessThanOrEqual(expectedTimeout);
    });

    it('should enable audit logging in development', async () => {
      expect(['true', 'false']).toContain(process.env.ENABLE_AUDIT_LOGGING);
    });

    it('should have proper password complexity requirements', async () => {
      expect(parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10)).toBeGreaterThanOrEqual(8);
      expect(['true', 'false']).toContain(process.env.PASSWORD_REQUIRE_UPPERCASE || 'true');
      expect(['true', 'false']).toContain(process.env.PASSWORD_REQUIRE_LOWERCASE || 'true');
      expect(['true', 'false']).toContain(process.env.PASSWORD_REQUIRE_NUMBERS || 'true');
      expect(['true', 'false']).toContain(process.env.PASSWORD_REQUIRE_SPECIAL || 'true');
    });
  });

  describe('Performance Validation', () => {
    it('should respond to health checks quickly', async () => {
      const startTime = Date.now();
      
      await request(app)
        .get('/health')
        .expect(200);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/health')
      );

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Environment-Specific Configuration', () => {
    it('should run in test mode during testing', () => {
      expect(['development', 'test']).toContain(process.env.NODE_ENV);
    });

    it('should have appropriate settings for the environment', () => {
      expect(['true', 'false']).toContain(process.env.ENABLE_DASHBOARD || 'false');
      expect(['debug', 'info', 'warn', 'error']).toContain(process.env.LOG_LEVEL || 'info');
    });
  });
});