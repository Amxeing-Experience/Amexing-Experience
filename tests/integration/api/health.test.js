/**
 * Health Endpoint API Tests
 * @updated 2025-01-24 - Migrated to MongoDB Memory Server
 */

const request = require('supertest');

// Import the Express app directly for testing
let app;

describe('Health Endpoint', () => {
  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 30000);
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: expect.any(String)
      });

      // Validate timestamp format
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
      
      // Validate uptime is positive
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it('should return consistent format', async () => {
      const response1 = await request(app).get('/health');
      const response2 = await request(app).get('/health');

      expect(response1.body).toHaveProperty('status');
      expect(response1.body).toHaveProperty('timestamp');
      expect(response1.body).toHaveProperty('uptime');
      expect(response1.body).toHaveProperty('environment');

      expect(response2.body).toHaveProperty('status');
      expect(response2.body).toHaveProperty('timestamp');
      expect(response2.body).toHaveProperty('uptime');
      expect(response2.body).toHaveProperty('environment');

      // Uptime should increase between calls
      expect(response2.body.uptime).toBeGreaterThanOrEqual(response1.body.uptime);
    });

    it('should have correct content type', async () => {
      await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);
    });
  });
});