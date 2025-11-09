/**
 * Roles Routes Unit Tests
 * Tests for roles API routes configuration, middleware application, and routing
 */

const express = require('express');
const request = require('supertest');

// Mock dependencies BEFORE requiring routes
jest.mock('../../../../src/application/controllers/api/RolesController');
jest.mock('../../../../src/application/middleware/jwtMiddleware');

const RolesController = require('../../../../src/application/controllers/api/RolesController');
const jwtMiddleware = require('../../../../src/application/middleware/jwtMiddleware');

describe('Roles Routes', () => {
  let app;
  let mockControllerInstance;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock controller instance with methods
    mockControllerInstance = {
      getRoles: jest.fn((req, res) => res.json({ success: true, method: 'getRoles' })),
      getRoleById: jest.fn((req, res) =>
        res.json({ success: true, method: 'getRoleById' })
      ),
      updateRole: jest.fn((req, res) =>
        res.json({ success: true, method: 'updateRole' })
      ),
    };

    // Mock controller constructor to return our mock instance
    RolesController.mockImplementation(() => mockControllerInstance);

    // Mock JWT middleware
    jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
      req.user = { id: 'test-user', role: 'superadmin' };
      req.userRole = 'superadmin';
      next();
    });

    // Create fresh Express app
    app = express();
    app.use(express.json());

    // Import routes fresh for each test
    jest.isolateModules(() => {
      const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
      app.use('/api/roles', rolesRoutes);
    });
  });

  // ========================================================================
  // ROUTE REGISTRATION
  // ========================================================================

  describe('Route Registration', () => {
    it('should register GET / route', async () => {
      const response = await request(app).get('/api/roles').expect(200);

      expect(response.body.success).toBe(true);
      expect(mockControllerInstance.getRoles).toHaveBeenCalled();
    });

    it('should register GET /:id route', async () => {
      const testId = 'test-role-id-123';

      const response = await request(app).get(`/api/roles/${testId}`).expect(200);

      expect(response.body.success).toBe(true);
      expect(mockControllerInstance.getRoleById).toHaveBeenCalled();
    });

    it('should register PUT /:id route', async () => {
      const testId = 'test-role-id-123';

      const response = await request(app)
        .put(`/api/roles/${testId}`)
        .send({ displayName: 'Test Name' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockControllerInstance.updateRole).toHaveBeenCalled();
    });

    it('should pass route parameters correctly to GET /:id', async () => {
      const testId = 'specific-role-id';

      await request(app).get(`/api/roles/${testId}`).expect(200);

      expect(mockControllerInstance.getRoleById).toHaveBeenCalled();
      const call = mockControllerInstance.getRoleById.mock.calls[0];
      const req = call[0];
      expect(req.params.id).toBe(testId);
    });

    it('should pass route parameters correctly to PUT /:id', async () => {
      const testId = 'specific-role-id';
      const displayName = 'New Role Name';

      await request(app)
        .put(`/api/roles/${testId}`)
        .send({ displayName })
        .expect(200);

      expect(mockControllerInstance.updateRole).toHaveBeenCalled();
      const call = mockControllerInstance.updateRole.mock.calls[0];
      const req = call[0];
      expect(req.params.id).toBe(testId);
      expect(req.body.displayName).toBe(displayName);
    });
  });

  // ========================================================================
  // MIDDLEWARE APPLICATION
  // ========================================================================

  describe('Middleware Application', () => {
    it('should apply JWT authentication middleware to all routes', async () => {
      await request(app).get('/api/roles').expect(200);

      expect(jwtMiddleware.authenticateToken).toHaveBeenCalled();
    });

    it('should apply JWT middleware to GET /:id route', async () => {
      await request(app).get('/api/roles/test-id').expect(200);

      expect(jwtMiddleware.authenticateToken).toHaveBeenCalled();
    });

    it('should apply JWT middleware to PUT /:id route', async () => {
      await request(app)
        .put('/api/roles/test-id')
        .send({ displayName: 'Test' })
        .expect(200);

      expect(jwtMiddleware.authenticateToken).toHaveBeenCalled();
    });

    it('should attach user to request via JWT middleware', async () => {
      await request(app).get('/api/roles').expect(200);

      const call = mockControllerInstance.getRoles.mock.calls[0];
      const req = call[0];
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('test-user');
      expect(req.userRole).toBe('superadmin');
    });

    it('should block requests when JWT middleware rejects', async () => {
      // Mock JWT middleware to reject
      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      });

      // Create new app with updated middleware
      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      const response = await request(testApp).get('/api/roles').expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Unauthorized');
      expect(mockControllerInstance.getRoles).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // SUPERADMIN AUTHORIZATION
  // ========================================================================

  describe('SuperAdmin Authorization Middleware', () => {
    it('should allow superadmin role to access routes', async () => {
      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        req.user = { id: 'test-user', role: 'superadmin' };
        req.userRole = 'superadmin';
        next();
      });

      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      const response = await request(testApp).get('/api/roles').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject non-superadmin roles (admin)', async () => {
      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        req.user = { id: 'test-user', role: 'admin' };
        req.userRole = 'admin';
        next();
      });

      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      const response = await request(testApp).get('/api/roles').expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/SuperAdmin/i);
    });

    it('should reject non-superadmin roles (employee)', async () => {
      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        req.user = { id: 'test-user', role: 'employee' };
        req.userRole = 'employee';
        next();
      });

      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      const response = await request(testApp).get('/api/roles').expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should reject requests without userRole', async () => {
      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        req.user = { id: 'test-user' }; // No role
        next();
      });

      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      const response = await request(testApp).get('/api/roles').expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/Authentication required/i);
    });
  });

  // ========================================================================
  // HTTP METHODS
  // ========================================================================

  describe('HTTP Methods', () => {
    it('should support GET method for / route', async () => {
      await request(app).get('/api/roles').expect(200);

      expect(mockControllerInstance.getRoles).toHaveBeenCalled();
    });

    it('should not support POST method for / route', async () => {
      const response = await request(app)
        .post('/api/roles')
        .send({ test: 'data' });

      // Should return 404 (route not found) or 405 (method not allowed)
      expect([404, 405]).toContain(response.status);
    });

    it('should not support DELETE method for / route', async () => {
      const response = await request(app).delete('/api/roles');

      expect([404, 405]).toContain(response.status);
    });

    it('should support GET method for /:id route', async () => {
      await request(app).get('/api/roles/test-id').expect(200);

      expect(mockControllerInstance.getRoleById).toHaveBeenCalled();
    });

    it('should support PUT method for /:id route', async () => {
      await request(app)
        .put('/api/roles/test-id')
        .send({ displayName: 'Test' })
        .expect(200);

      expect(mockControllerInstance.updateRole).toHaveBeenCalled();
    });

    it('should not support POST method for /:id route', async () => {
      const response = await request(app)
        .post('/api/roles/test-id')
        .send({ test: 'data' });

      expect([404, 405]).toContain(response.status);
    });

    it('should not support DELETE method for /:id route', async () => {
      const response = await request(app).delete('/api/roles/test-id');

      expect([404, 405]).toContain(response.status);
    });
  });

  // ========================================================================
  // REQUEST/RESPONSE FLOW
  // ========================================================================

  describe('Request/Response Flow', () => {
    it('should pass request object to controller methods', async () => {
      await request(app).get('/api/roles').expect(200);

      expect(mockControllerInstance.getRoles).toHaveBeenCalled();
      const call = mockControllerInstance.getRoles.mock.calls[0];
      expect(call[0]).toBeDefined(); // req
      expect(call[1]).toBeDefined(); // res
    });

    it('should pass response object to controller methods', async () => {
      await request(app).get('/api/roles').expect(200);

      const call = mockControllerInstance.getRoles.mock.calls[0];
      const res = call[1];
      expect(typeof res.json).toBe('function');
      expect(typeof res.status).toBe('function');
    });

    it('should preserve request body for PUT requests', async () => {
      const testBody = { displayName: 'Test Name', extra: 'data' };

      await request(app).put('/api/roles/test-id').send(testBody).expect(200);

      const call = mockControllerInstance.updateRole.mock.calls[0];
      const req = call[0];
      expect(req.body).toEqual(testBody);
    });

    it('should preserve query parameters for GET requests', async () => {
      await request(app).get('/api/roles?page=2&limit=10').expect(200);

      const call = mockControllerInstance.getRoles.mock.calls[0];
      const req = call[0];
      expect(req.query.page).toBe('2');
      expect(req.query.limit).toBe('10');
    });

    it('should handle JSON content-type correctly', async () => {
      await request(app)
        .put('/api/roles/test-id')
        .set('Content-Type', 'application/json')
        .send({ displayName: 'Test' })
        .expect(200);

      expect(mockControllerInstance.updateRole).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================

  describe('Error Handling', () => {
    it('should handle controller errors gracefully', async () => {
      mockControllerInstance.getRoles = jest.fn((req, res) => {
        res.status(500).json({ success: false, error: 'Internal error' });
      });

      const response = await request(app).get('/api/roles').expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .put('/api/roles/test-id')
        .set('Content-Type', 'application/json')
        .send('invalid json{')
        .expect(400);

      // Express should return 400 for bad JSON
      expect(response.status).toBe(400);
    });

    it('should handle missing route parameters', async () => {
      // Requesting /:id route without providing id
      const response = await request(app).get('/api/roles/');

      // Should match the / route instead (trailing slash)
      expect([200, 404]).toContain(response.status);
    });
  });

  // ========================================================================
  // INTEGRATION
  // ========================================================================

  describe('Integration with Controller', () => {
    it('should create RolesController instance on module load', () => {
      expect(RolesController).toHaveBeenCalled();
    });

    it('should call controller methods with correct arguments', async () => {
      const roleId = 'test-role-123';
      const displayName = 'Updated Name';

      await request(app)
        .put(`/api/roles/${roleId}`)
        .send({ displayName })
        .expect(200);

      expect(mockControllerInstance.updateRole).toHaveBeenCalledTimes(1);

      const call = mockControllerInstance.updateRole.mock.calls[0];
      const req = call[0];
      const res = call[1];

      expect(req.params.id).toBe(roleId);
      expect(req.body.displayName).toBe(displayName);
      expect(typeof res.json).toBe('function');
    });

    it('should maintain proper middleware order', async () => {
      const executionOrder = [];

      jwtMiddleware.authenticateToken = jest.fn((req, res, next) => {
        executionOrder.push('jwt');
        req.userRole = 'superadmin';
        next();
      });

      mockControllerInstance.getRoles = jest.fn((req, res) => {
        executionOrder.push('controller');
        res.json({ success: true });
      });

      const testApp = express();
      testApp.use(express.json());
      jest.isolateModules(() => {
        const rolesRoutes = require('../../../../src/presentation/routes/api/rolesRoutes');
        testApp.use('/api/roles', rolesRoutes);
      });

      await request(testApp).get('/api/roles').expect(200);

      // JWT middleware should execute before controller
      expect(executionOrder).toEqual(['jwt', 'controller']);
    });
  });
});
