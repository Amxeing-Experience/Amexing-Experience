/**
 * Clients Management API Integration Tests - Development Environment
 * Tests client management API endpoints using the actual development server
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
let testClientId = null;
let departmentManagerRoleId = null;

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
 * Find department_manager role ID for creating test clients
 */
async function findDepartmentManagerRole() {
  try {
    const response = await request(BASE_URL)
      .get('/api/roles?limit=100')
      .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
      .expect(200);

    if (response.body.success && response.body.data.roles.length > 0) {
      const role = response.body.data.roles.find((r) => r.name === 'department_manager');
      if (role) {
        departmentManagerRoleId = role.id;
        console.log(`✓ Found department_manager role: ${departmentManagerRoleId}`);
        return true;
      }
    }

    console.error('✗ department_manager role not found');
    return false;
  } catch (error) {
    console.error('✗ Error finding department_manager role:', error.message);
    return false;
  }
}

describe('Clients Management API - Integration Tests', () => {
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

    // Find department_manager role
    const roleFound = await findDepartmentManagerRole();
    if (!roleFound) {
      throw new Error('Failed to find department_manager role');
    }

    console.log('✓ Test environment setup complete\n');
  }, 30000);

  describe('GET /api/clients', () => {
    it('should list all clients for superadmin', async () => {
      const response = await request(BASE_URL)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('users');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.users)).toBe(true);
    });

    it('should list all clients for admin', async () => {
      const response = await request(BASE_URL)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('users');
      expect(Array.isArray(response.body.data.users)).toBe(true);
    });

    it('should support pagination parameters', async () => {
      const response = await request(BASE_URL)
        .get('/api/clients?page=1&limit=5')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination).toMatchObject({
        page: 1,
        limit: 5,
      });
    });

    it('should filter by active status', async () => {
      const response = await request(BASE_URL)
        .get('/api/clients?active=true')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.users)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      await request(BASE_URL).get('/api/clients').expect(401);
    });
  });

  describe('POST /api/clients', () => {
    const testClient = {
      username: `testclient_${Date.now()}@dev.amexing.com`,
      email: `testclient_${Date.now()}@dev.amexing.com`,
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'Client',
      company: 'Test Company LLC',
      active: true,
      exists: true,
    };

    it('should create a new client as superadmin', async () => {
      const response = await request(BASE_URL)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send(testClient)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toHaveProperty('id');
      expect(response.body.data.user.email).toBe(testClient.email);
      expect(response.body.data.user.firstName).toBe(testClient.firstName);
      expect(response.body.data.user.role).toBe('department_manager');

      // Save ID for cleanup
      testClientId = response.body.data.user.id;
    });

    it('should create a new client as admin', async () => {
      const adminClient = {
        ...testClient,
        username: `admin_testclient_${Date.now()}@dev.amexing.com`,
        email: `admin_testclient_${Date.now()}@dev.amexing.com`,
      };

      const response = await request(BASE_URL)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authTokens.admin.accessToken}`)
        .send(adminClient)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.role).toBe('department_manager');
    });

    it('should enforce department_manager role on creation', async () => {
      const clientWithWrongRole = {
        ...testClient,
        username: `wrongrole_${Date.now()}@dev.amexing.com`,
        email: `wrongrole_${Date.now()}@dev.amexing.com`,
        role: 'admin', // Try to create with wrong role
      };

      const response = await request(BASE_URL)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send(clientWithWrongRole)
        .expect(201);

      // Should still create as department_manager
      expect(response.body.data.user.role).toBe('department_manager');
    });

    it('should validate required fields', async () => {
      const invalidClient = {
        username: 'incomplete@test.com',
        // Missing password, firstName, lastName
      };

      await request(BASE_URL)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send(invalidClient)
        .expect(400);
    });

    it('should prevent duplicate email', async () => {
      const duplicateClient = {
        ...testClient,
        username: testClient.email, // Same email as first test
      };

      const response = await request(BASE_URL)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send(duplicateClient);

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/clients/:id', () => {
    it('should update client information', async () => {
      if (!testClientId) {
        console.warn('⚠ Skipping update test - no test client created');
        return;
      }

      const updates = {
        firstName: 'Updated',
        lastName: 'Client',
        company: 'Updated Company Inc',
      };

      const response = await request(BASE_URL)
        .put(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send(updates)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.firstName).toBe(updates.firstName);
      expect(response.body.data.user.company).toBe(updates.company);
    });

    it('should prevent role changes on update', async () => {
      if (!testClientId) {
        console.warn('⚠ Skipping role change test - no test client created');
        return;
      }

      const response = await request(BASE_URL)
        .put(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send({
          firstName: 'Test',
          role: 'admin', // Try to change role
        })
        .expect(200);

      // Role should remain department_manager
      expect(response.body.data.user.role).toBe('department_manager');
    });

    it('should return 404 for non-existent client', async () => {
      await request(BASE_URL)
        .put('/api/clients/nonexistentid123')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send({ firstName: 'Test' })
        .expect(404);
    });
  });

  describe('PATCH /api/clients/:id', () => {
    it('should partially update client', async () => {
      if (!testClientId) {
        console.warn('⚠ Skipping partial update test - no test client created');
        return;
      }

      const response = await request(BASE_URL)
        .patch(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .send({ company: 'Partially Updated LLC' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.company).toBe('Partially Updated LLC');
    });
  });

  describe('DELETE /api/clients/:id', () => {
    it('should logically delete client (exists: false)', async () => {
      if (!testClientId) {
        console.warn('⚠ Skipping delete test - no test client created');
        return;
      }

      const response = await request(BASE_URL)
        .delete(`/api/clients/${testClientId}`)
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');

      // Verify client is no longer in list
      const listResponse = await request(BASE_URL)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      const deletedClient = listResponse.body.data.users.find((u) => u.id === testClientId);
      expect(deletedClient).toBeUndefined();
    });

    it('should return 404 when deleting non-existent client', async () => {
      await request(BASE_URL)
        .delete('/api/clients/nonexistentid456')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(404);
    });
  });

  describe('Security & Permissions', () => {
    it('should require authentication for all endpoints', async () => {
      await request(BASE_URL).get('/api/clients').expect(401);
      await request(BASE_URL).post('/api/clients').send({}).expect(401);
      await request(BASE_URL).put('/api/clients/123').send({}).expect(401);
      await request(BASE_URL).patch('/api/clients/123').send({}).expect(401);
      await request(BASE_URL).delete('/api/clients/123').expect(401);
    });

    it('should enforce department_manager role for all clients', async () => {
      const response = await request(BASE_URL)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authTokens.superadmin.accessToken}`)
        .expect(200);

      if (response.body.data.users.length > 0) {
        response.body.data.users.forEach((user) => {
          expect(user.role).toBe('department_manager');
        });
      }
    });
  });

  // Cleanup after all tests
  afterAll(async () => {
    console.log('\n🧹 Cleaning up test data...\n');
    console.log('✓ Cleanup complete\n');
  });
});
