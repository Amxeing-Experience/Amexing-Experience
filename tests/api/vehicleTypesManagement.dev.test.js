/**
 * Vehicle Types Management API Integration Tests - Development Environment
 * Tests vehicle type management API endpoints using the actual development server
 * Focus on CRUD operations with real authentication and database operations
 */

const request = require('supertest');
const Parse = require('parse/node');
const path = require('path');

// Load development environment
require('dotenv').config({
  path: path.join(__dirname, '../../environments/.env.development'),
});

const BASE_URL = 'http://localhost:1337';

// Test users from development environment
const testCredentials = {
  superadmin: {
    email: process.env.DEV_SUPERADMIN_EMAIL || 'superadmin@dev.amexing.com',
    password: process.env.DEV_SUPERADMIN_PASSWORD || 'fallback-password',
  },
  admin: {
    email: process.env.DEV_ADMIN_EMAIL || 'admin@dev.amexing.com',
    password: process.env.DEV_ADMIN_PASSWORD || 'fallback-password',
  },
};

let authTokens = {};
let testVehicleTypeId = null;

/**
 * Authenticate user and get JWT token
 */
async function authenticateUser(role, credentials) {
  try {
    // Get login page for CSRF token
    const response = await request(BASE_URL).get('/login').expect(200);

    // Extract CSRF token
    const csrfMatch = response.text.match(/name="_csrf".*?value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;

    if (!csrfToken) {
      throw new Error('Could not extract CSRF token');
    }

    // Login to get JWT token
    const loginResponse = await request(BASE_URL)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .set('Cookie', response.headers['set-cookie'])
      .send({
        identifier: credentials.email,
        password: credentials.password,
        _csrf: csrfToken,
      });

    if (loginResponse.status === 200 && loginResponse.body.success) {
      console.log(`✓ Authenticated ${role} user successfully`);
      return {
        accessToken: loginResponse.body.tokens.accessToken,
        user: loginResponse.body.user,
      };
    } else {
      console.error(`✗ Failed to authenticate ${role}:`, loginResponse.body);
      return null;
    }
  } catch (error) {
    console.error(`✗ Error authenticating ${role}:`, error.message);
    return null;
  }
}

/**
 * Get first vehicle type from database for testing
 */
async function getFirstVehicleType() {
  try {
    const response = await request(BASE_URL)
      .get('/api/vehicle-types?draw=1&start=0&length=1')
      .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
      .expect(200);

    if (response.body.data && response.body.data.length > 0) {
      testVehicleTypeId = response.body.data[0].objectId || response.body.data[0].id;
      console.log(`✓ Using vehicle type for testing: ${testVehicleTypeId}`);
      return true;
    }

    console.error('✗ No vehicle types found in database');
    return false;
  } catch (error) {
    console.error('✗ Error getting vehicle type:', error.message);
    return false;
  }
}

describe('Vehicle Types Management API - Integration Tests', () => {
  // Setup: Authenticate users before all tests
  beforeAll(async () => {
    console.log('\n🔧 Setting up test environment...\n');

    // Authenticate superadmin
    const superadminAuth = await authenticateUser('superadmin', testCredentials.superadmin);
    if (!superadminAuth) {
      throw new Error('Failed to authenticate superadmin user');
    }
    authTokens.superadmin = superadminAuth;

    // Authenticate admin
    const adminAuth = await authenticateUser('admin', testCredentials.admin);
    if (!adminAuth) {
      throw new Error('Failed to authenticate admin user');
    }
    authTokens.admin = adminAuth;

    // Get test vehicle type
    const vehicleTypeFound = await getFirstVehicleType();
    if (!vehicleTypeFound) {
      throw new Error('Failed to find vehicle type for testing');
    }

    console.log('✓ Test environment setup complete\n');
  }, 30000);

  describe('GET /api/vehicle-types', () => {
    it('should list all vehicle types for admin', async () => {
      const response = await request(BASE_URL)
        .get('/api/vehicle-types?draw=1&start=0&length=10')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('draw');
      expect(response.body).toHaveProperty('recordsTotal');
      expect(response.body).toHaveProperty('recordsFiltered');
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Verify data structure
      const firstType = response.body.data[0];
      expect(firstType).toHaveProperty('name');
      expect(firstType).toHaveProperty('code');
      expect(firstType).toHaveProperty('active');
      expect(firstType).toHaveProperty('exists');
    });

    it('should list all vehicle types for superadmin', async () => {
      const response = await request(BASE_URL)
        .get('/api/vehicle-types?draw=1&start=0&length=10')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('PATCH /api/vehicle-types/:id/toggle-status', () => {
    let originalStatus = null;

    beforeEach(async () => {
      // Get current status before test
      const response = await request(BASE_URL)
        .get(`/api/vehicle-types?draw=1&start=0&length=100`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      const vehicleType = response.body.data.find(
        (t) => (t.objectId || t.id) === testVehicleTypeId
      );
      originalStatus = vehicleType ? vehicleType.active : null;
      console.log(
        `\n  📊 Original vehicle type status: ${originalStatus} (ID: ${testVehicleTypeId})`
      );
    });

    afterEach(async () => {
      // Restore original status after test
      if (originalStatus !== null) {
        console.log(`  🔄 Restoring vehicle type to original status: ${originalStatus}`);
        await request(BASE_URL)
          .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
          .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
          .send({ active: originalStatus })
          .expect(200);
      }
    });

    it('should toggle vehicle type status to inactive (admin)', async () => {
      const response = await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: false })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deactivated');
      expect(response.body.data).toHaveProperty('active', false);
      expect(response.body.data).toHaveProperty('id', testVehicleTypeId);

      // Verify in database
      const verifyResponse = await request(BASE_URL)
        .get(`/api/vehicle-types?draw=1&start=0&length=100`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      const vehicleType = verifyResponse.body.data.find(
        (t) => (t.objectId || t.id) === testVehicleTypeId
      );
      expect(vehicleType).toBeDefined();
      expect(vehicleType.active).toBe(false);
      console.log('  ✓ Vehicle type successfully deactivated in database');
    });

    it('should toggle vehicle type status to active (admin)', async () => {
      // First deactivate
      await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: false })
        .expect(200);

      // Then activate
      const response = await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('activated');
      expect(response.body.data).toHaveProperty('active', true);

      // Verify in database
      const verifyResponse = await request(BASE_URL)
        .get(`/api/vehicle-types?draw=1&start=0&length=100`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      const vehicleType = verifyResponse.body.data.find(
        (t) => (t.objectId || t.id) === testVehicleTypeId
      );
      expect(vehicleType).toBeDefined();
      expect(vehicleType.active).toBe(true);
      console.log('  ✓ Vehicle type successfully activated in database');
    });

    it('should toggle vehicle type status (superadmin)', async () => {
      const response = await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send({ active: false })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('active', false);
    });

    it('should require authentication', async () => {
      const response = await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .send({ active: false })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should require vehicle type ID', async () => {
      const response = await request(BASE_URL)
        .patch('/api/vehicle-types//toggle-status')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: false })
        .expect(404); // Not found because route doesn't match

      // Alternative test with empty ID
      const response2 = await request(BASE_URL)
        .patch('/api/vehicle-types/undefined/toggle-status')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: false });

      expect([400, 404]).toContain(response2.status);
    });

    it('should require boolean active value', async () => {
      const response = await request(BASE_URL)
        .patch(`/api/vehicle-types/${testVehicleTypeId}/toggle-status`)
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: 'not-a-boolean' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('boolean');
    });

    it('should handle non-existent vehicle type', async () => {
      const response = await request(BASE_URL)
        .patch('/api/vehicle-types/nonexistent123/toggle-status')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send({ active: false });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/vehicle-types/active', () => {
    it('should get active vehicle types for dropdowns (admin)', async () => {
      const response = await request(BASE_URL)
        .get('/api/vehicle-types/active')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('vehicleTypes');
      expect(Array.isArray(response.body.data.vehicleTypes)).toBe(true);

      // All returned types should be active
      response.body.data.vehicleTypes.forEach((type) => {
        expect(type.active).toBe(true);
        expect(type.exists).toBe(true);
        expect(type).toHaveProperty('name');
        expect(type).toHaveProperty('code');
      });
    });
  });
});
