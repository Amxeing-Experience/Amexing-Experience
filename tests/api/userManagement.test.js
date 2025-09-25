/**
 * User Management API Tests
 * Tests all CRUD endpoints for the user management system using MongoDB Atlas
 * Validates role-based access control and proper data handling
 */

const request = require('supertest');
const express = require('express');
const { setupTests, teardownTests, clearDatabase } = require('../setup');
const { createTestUser } = require('../helpers/testUtils');

// Mock Express app for testing
let app;
let server;
let testUserTokens = {};

beforeAll(async () => {
  // Setup Parse connection and test users
  await setupTests();

  // Authenticate test users to get tokens
  testUserTokens.superadmin = await authenticateTestUser('superadmin');
  testUserTokens.admin = await authenticateTestUser('admin');
  testUserTokens.client = await authenticateTestUser('client');
  testUserTokens.employee = await authenticateTestUser('employee');

  // Create Express app with routes for testing
  app = express();
  app.use(express.json());

  // Import and use API routes
  const apiRoutes = require('../../src/presentation/routes/apiRoutes');
  app.use('/api', apiRoutes);

  // Start server
  server = app.listen(0); // Use random available port
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  if (server) {
    server.close();
  }
  await teardownTests();
}, 10000);

describe('User Management API - GET /api/users', () => {
  test('superadmin can get all users', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.users).toBeInstanceOf(Array);
    expect(response.body.data.pagination).toBeDefined();
    expect(response.body.data.pagination.total).toBeGreaterThan(0);
  });

  test('admin can get users with proper filtering', async () => {
    const response = await request(app)
      .get('/api/users?role=employee&limit=10')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.users).toBeInstanceOf(Array);
    expect(response.body.data.pagination.limit).toBe(10);
  });

  test('client can only see their own organization users', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.client.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    // Should only see users from their client organization
    response.body.data.users.forEach(user => {
      if (user.role !== 'superadmin' && user.role !== 'admin') {
        expect(user.clientId).toBe(testUsers.client.clientId);
      }
    });
  });

  test('unauthorized request returns 401', async () => {
    await request(app)
      .get('/api/users')
      .expect(401);
  });

  test('invalid token returns 401', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});

describe('User Management API - GET /api/users/:id', () => {
  test('superadmin can get any user by ID', async () => {
    const response = await request(app)
      .get(`/api/users/${testUserTokens.admin.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.id).toBe(testUserTokens.admin.user.id);
  });

  test('user can get their own profile', async () => {
    const response = await request(app)
      .get(`/api/users/${testUserTokens.employee.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.id).toBe(testUserTokens.employee.user.id);
  });

  test('user cannot access other users outside their scope', async () => {
    await request(app)
      .get(`/api/users/${testUserTokens.superadmin.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .expect(403);
  });

  test('non-existent user returns 404', async () => {
    await request(app)
      .get('/api/users/nonexistent123')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(404);
  });
});

describe('User Management API - POST /api/users', () => {
  test('superadmin can create any type of user', async () => {
    const newUser = {
      username: 'newuser@test.amexing.com',
      email: 'newuser@test.amexing.com',
      firstName: 'New',
      lastName: 'User',
      role: 'employee',
      password: 'TestPassword2024!@#',
      clientId: 'test-client-001',
      departmentId: 'test-dept-001'
    };

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(newUser)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toBeDefined();
    expect(response.body.data.user.email).toBe(newUser.email);
    expect(response.body.data.user.role).toBe(newUser.role);
  });

  test('admin can create users within their scope', async () => {
    const newUser = {
      username: 'admin-created@test.amexing.com',
      email: 'admin-created@test.amexing.com',
      firstName: 'Admin',
      lastName: 'Created',
      role: 'employee',
      password: 'TestPassword2024!@#',
      clientId: 'test-client-001'
    };

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .send(newUser)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe('employee');
  });

  test('client cannot create admin users', async () => {
    const newUser = {
      username: 'invalid@test.amexing.com',
      email: 'invalid@test.amexing.com',
      firstName: 'Invalid',
      lastName: 'Admin',
      role: 'admin',
      password: 'TestPassword2024!@#'
    };

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.client.accessToken}`)
      .send(newUser)
      .expect(403);
  });

  test('validation errors for invalid data', async () => {
    const invalidUser = {
      username: 'invalid',
      email: 'not-an-email',
      firstName: '',
      lastName: '',
      role: 'invalid-role'
    };

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(invalidUser)
      .expect(400);
  });
});

describe('User Management API - PUT /api/users/:id', () => {
  test('superadmin can update any user', async () => {
    const updates = {
      firstName: 'Updated',
      lastName: 'Name'
    };

    const response = await request(app)
      .put(`/api/users/${testUserTokens.employee.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(updates)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.firstName).toBe('Updated');
    expect(response.body.data.user.lastName).toBe('Name');
  });

  test('user can update their own profile', async () => {
    const updates = {
      firstName: 'SelfUpdated'
    };

    const response = await request(app)
      .put(`/api/users/${testUserTokens.employee.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .send(updates)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.firstName).toBe('SelfUpdated');
  });

  test('user cannot update restricted fields', async () => {
    const updates = {
      role: 'admin',
      active: false
    };

    await request(app)
      .put(`/api/users/${testUserTokens.employee.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .send(updates)
      .expect(403);
  });
});

describe('User Management API - DELETE /api/users/:id', () => {
  test('superadmin can soft delete users', async () => {
    // First create a user to delete
    const userToDelete = {
      username: 'todelete@test.amexing.com',
      email: 'todelete@test.amexing.com',
      firstName: 'To',
      lastName: 'Delete',
      role: 'employee',
      password: 'TestPassword2024!@#'
    };

    const createResponse = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(userToDelete);

    const userId = createResponse.body.data.user.id;

    // Now delete the user
    const response = await request(app)
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('deactivated');
  });

  test('non-superadmin cannot delete users', async () => {
    await request(app)
      .delete(`/api/users/${testUserTokens.employee.user.id}`)
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(403);
  });
});

describe('User Management API - GET /api/users/statistics', () => {
  test('superadmin can get user statistics', async () => {
    const response = await request(app)
      .get('/api/users/statistics')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.statistics).toBeDefined();
    expect(response.body.data.statistics.totalUsers).toBeGreaterThan(0);
    expect(response.body.data.statistics.roleDistribution).toBeDefined();
  });

  test('admin can get limited statistics', async () => {
    const response = await request(app)
      .get('/api/users/statistics')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.statistics).toBeDefined();
  });

  test('regular users cannot access statistics', async () => {
    await request(app)
      .get('/api/users/statistics')
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .expect(403);
  });
});