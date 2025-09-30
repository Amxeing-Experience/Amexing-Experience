/**
 * User Management API Tests
 * Tests all CRUD endpoints for the user management system using MongoDB Atlas
 * Validates role-based access control and proper data handling
 */

const request = require('supertest');
const express = require('express');
const { setupTests, teardownTests, clearDatabase } = require('../setup');
const { createTestUser } = require('../helpers/testUtils');

// Mock JWT middleware for testing
jest.mock('../../src/application/middleware/jwtMiddleware', () => ({
  authenticateToken: (req, res, next) => {
    // Extract user info from authorization header for testing
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const mockUsers = {
      'mock-jwt-token-superadmin': {
        id: 'test-superadmin-001',
        username: 'superadmin@test.amexing.com',
        email: 'superadmin@test.amexing.com',
        role: 'superadmin',
        active: true,
        exists: true
      },
      'mock-jwt-token-admin': {
        id: 'test-admin-001',
        username: 'admin@test.amexing.com',
        email: 'admin@test.amexing.com',
        role: 'admin',
        active: true,
        exists: true
      },
      'mock-jwt-token-client': {
        id: 'test-client-001',
        username: 'client@test.amexing.com',
        email: 'client@test.amexing.com',
        role: 'client',
        active: true,
        exists: true,
        clientId: 'test-client-001'
      },
      'mock-jwt-token-employee': {
        id: 'test-employee-001',
        username: 'employee@test.amexing.com',
        email: 'employee@test.amexing.com',
        role: 'employee',
        active: true,
        exists: true,
        clientId: 'test-client-001'
      }
    };

    // Find user by token prefix
    const user = Object.entries(mockUsers).find(([key]) => token.startsWith(key))?.[1];

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = user;
    next();
  },
  // Mock RBAC functions - allow all for testing
  requirePermission: (permission, contextExtractor) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  },
  requireRoleLevel: (minimumLevel) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    // Simple role level mapping for tests
    const roleLevels = { employee: 3, client: 5, admin: 6, superadmin: 7 };
    const userLevel = roleLevels[req.user.role] || 1;
    if (userLevel < minimumLevel) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient role level',
        required: minimumLevel,
        current: userLevel
      });
    }
    next();
  },
  requireOrganizationScope: (requiredScope) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next(); // Allow all for testing
  },
  requireRole: (allowedRoles) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  },
  authRateLimit: (req, res, next) => next()
}));

// Mock security middleware completely
jest.mock('../../src/infrastructure/security/securityMiddleware', () => ({
  getCsrfProtection: () => (req, res, next) => next(),
  getApiRateLimiter: () => (req, res, next) => next(),
  getAuthRateLimiter: () => (req, res, next) => next(),
  securityHeaders: () => (req, res, next) => next(),
  contentSecurityPolicy: () => (req, res, next) => next()
}));

// Mock express-rate-limit
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

// Helper function to authenticate test users
async function authenticateTestUser(role) {
  const testUsers = {
    superadmin: {
      id: actualUserIds[role] || 'test-superadmin-001',
      username: 'superadmin@test.amexing.com',
      email: 'superadmin@test.amexing.com',
      role: 'superadmin',
      active: true,
      exists: true
    },
    admin: {
      id: actualUserIds[role] || 'test-admin-001',
      username: 'admin@test.amexing.com',
      email: 'admin@test.amexing.com',
      role: 'admin',
      active: true,
      exists: true
    },
    client: {
      id: actualUserIds[role] || 'test-client-001',
      username: 'client@test.amexing.com',
      email: 'client@test.amexing.com',
      role: 'client',
      active: true,
      exists: true,
      clientId: 'test-client-001'
    },
    employee: {
      id: actualUserIds[role] || 'test-employee-001',
      username: 'employee@test.amexing.com',
      email: 'employee@test.amexing.com',
      role: 'employee',
      active: true,
      exists: true,
      departmentId: 'test-dept-001'
    }
  };

  const user = testUsers[role];
  if (!user) {
    throw new Error(`Test user role '${role}' not found`);
  }

  return {
    user,
    accessToken: `mock-jwt-token-${role}`, // Simplified token for middleware mock
    sessionToken: `mock-session-${role}`
  };
}

// Store actual user IDs from database
const actualUserIds = {};

// Create actual test users in Parse database
async function createActualTestUsers() {
  const Parse = require('parse/node');

  // Use AmexingUser model since that's what UserManagementService expects
  const AmexingUser = Parse.Object.extend('AmexingUser');

  const testUsers = [
    {
      role: 'superadmin',
      username: 'superadmin@test.amexing.com',
      email: 'superadmin@test.amexing.com',
      password: 'SuperAdminPass123!',
      firstName: 'Test',
      lastName: 'Superadmin',
      active: true,
      exists: true,
      emailVerified: true
    },
    {
      role: 'admin',
      username: 'admin@test.amexing.com',
      email: 'admin@test.amexing.com',
      password: 'AdminPass123!',
      firstName: 'Test',
      lastName: 'Admin',
      active: true,
      exists: true,
      emailVerified: true
    },
    {
      role: 'client',
      username: 'client@test.amexing.com',
      email: 'client@test.amexing.com',
      password: 'ClientPass123!',
      firstName: 'Test',
      lastName: 'Client',
      active: true,
      exists: true,
      emailVerified: true,
      clientId: 'test-client-001'
    },
    {
      role: 'employee',
      username: 'employee@test.amexing.com',
      email: 'employee@test.amexing.com',
      password: 'EmployeePass123!',
      firstName: 'Test',
      lastName: 'Employee',
      active: true,
      exists: true,
      emailVerified: true,
      departmentId: 'test-dept-001'
    }
  ];

  for (const userData of testUsers) {
    try {
      // Check if user already exists
      const query = new Parse.Query(AmexingUser);
      query.equalTo('username', userData.username);
      let user = await query.first({ useMasterKey: true });

      if (!user) {
        // Create new user using AmexingUser model
        user = new AmexingUser();
        Object.keys(userData).forEach(key => {
          user.set(key, userData[key]);
        });

        await user.save(null, { useMasterKey: true });

        console.log(`Created test user: ${userData.username} with ID: ${user.id}`);
      } else {
        console.log(`Test user already exists: ${userData.username} with ID: ${user.id}`);
      }

      // Store the actual objectId
      actualUserIds[userData.role] = user.id;

    } catch (error) {
      console.error(`Failed to create test user ${userData.username}:`, error.message);
      // Continue with other users
    }
  }

  console.log('Actual user IDs:', actualUserIds);
}

// Mock Express app for testing
let app;
let server;
let testUserTokens = {};

beforeAll(async () => {
  // Setup Parse connection and test users
  await setupTests();

  // Create actual test users in the database
  await createActualTestUsers();

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

describe('User Management API - PATCH /api/users/:id/archive', () => {
  test('superadmin can archive users completely', async () => {
    // First create a user to archive
    const userToArchive = {
      username: 'toarchive@test.amexing.com',
      email: 'toarchive@test.amexing.com',
      firstName: 'To',
      lastName: 'Archive',
      role: 'employee',
      password: 'TestPassword2024!@#'
    };

    const createResponse = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(userToArchive);

    const userId = createResponse.body.data.user.id;

    // Archive the user
    const response = await request(app)
      .patch(`/api/users/${userId}/archive`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send({ reason: 'Testing archive functionality' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.archived).toBe(true);
    expect(response.body.data.reason).toBe('Testing archive functionality');
  });

  test('non-superadmin cannot archive users', async () => {
    await request(app)
      .patch(`/api/users/${testUserTokens.employee.user.id}/archive`)
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .send({ reason: 'Unauthorized attempt' })
      .expect(403);
  });
});

describe('User Management API - PUT /api/users/:id/reactivate', () => {
  test('superadmin can reactivate deactivated users', async () => {
    // First create and deactivate a user
    const userToReactivate = {
      username: 'toreactivate@test.amexing.com',
      email: 'toreactivate@test.amexing.com',
      firstName: 'To',
      lastName: 'Reactivate',
      role: 'employee',
      password: 'TestPassword2024!@#'
    };

    const createResponse = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(userToReactivate);

    const userId = createResponse.body.data.user.id;

    // Deactivate the user first
    await request(app)
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    // Now reactivate the user
    const response = await request(app)
      .put(`/api/users/${userId}/reactivate`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send({ reason: 'Testing reactivation functionality' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.reactivated).toBe(true);
    expect(response.body.data.reason).toBe('Testing reactivation functionality');
  });

  test('admin can reactivate users within their scope', async () => {
    // Create a user to reactivate
    const userToReactivate = {
      username: 'admin-reactivate@test.amexing.com',
      email: 'admin-reactivate@test.amexing.com',
      firstName: 'Admin',
      lastName: 'Reactivate',
      role: 'employee',
      password: 'TestPassword2024!@#'
    };

    const createResponse = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .send(userToReactivate);

    const userId = createResponse.body.data.user.id;

    // Deactivate first
    await request(app)
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(200);

    // Reactivate
    const response = await request(app)
      .put(`/api/users/${userId}/reactivate`)
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .send({ reason: 'Admin reactivation' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});

describe('User Management API - PATCH /api/users/:id/toggle-status', () => {
  test('superadmin can toggle user active status', async () => {
    // Create a user to toggle
    const userToToggle = {
      username: 'totoggle@test.amexing.com',
      email: 'totoggle@test.amexing.com',
      firstName: 'To',
      lastName: 'Toggle',
      role: 'employee',
      password: 'TestPassword2024!@#'
    };

    const createResponse = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send(userToToggle);

    const userId = createResponse.body.data.user.id;

    // Toggle to inactive
    const deactivateResponse = await request(app)
      .patch(`/api/users/${userId}/toggle-status`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send({ active: false, reason: 'Testing toggle functionality' })
      .expect(200);

    expect(deactivateResponse.body.success).toBe(true);
    expect(deactivateResponse.body.data.newStatus).toBe(false);

    // Toggle back to active
    const activateResponse = await request(app)
      .patch(`/api/users/${userId}/toggle-status`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send({ active: true, reason: 'Reactivating for test' })
      .expect(200);

    expect(activateResponse.body.success).toBe(true);
    expect(activateResponse.body.data.newStatus).toBe(true);
  });

  test('toggle-status requires active boolean parameter', async () => {
    await request(app)
      .patch(`/api/users/${testUserTokens.employee.user.id}/toggle-status`)
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .send({ reason: 'Missing active parameter' })
      .expect(400);
  });

  test('employee cannot toggle user status', async () => {
    await request(app)
      .patch(`/api/users/${testUserTokens.admin.user.id}/toggle-status`)
      .set('Authorization', `Bearer ${testUserTokens.employee.accessToken}`)
      .send({ active: false, reason: 'Unauthorized attempt' })
      .expect(403);
  });
});

describe('User Management API - GET /api/users/search', () => {
  test('superadmin can search users', async () => {
    const response = await request(app)
      .get('/api/users/search?q=test&role=employee&limit=5')
      .set('Authorization', `Bearer ${testUserTokens.superadmin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.users).toBeInstanceOf(Array);
  });

  test('admin can search within their scope', async () => {
    const response = await request(app)
      .get('/api/users/search?q=admin')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.users).toBeInstanceOf(Array);
  });

  test('search without query parameter returns all visible users', async () => {
    const response = await request(app)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${testUserTokens.admin.accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.users).toBeInstanceOf(Array);
  });

  test('unauthorized search returns 401', async () => {
    await request(app)
      .get('/api/users/search?q=test')
      .expect(401);
  });
});