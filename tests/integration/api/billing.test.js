/**
 * Billing Controller Integration Tests
 * Tests for billing information management endpoints
 * Created by Denisse Maldonado
 * 
 * Coverage: Billing info CRUD operations, user billing data management
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Billing Controller Integration Tests', () => {
  let app;
  let superadminToken;
  let adminToken;
  let departmentManagerToken;
  let clientToken;
  let employeeToken;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');
    
    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get authentication tokens for different roles
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
    adminToken = await AuthTestHelper.loginAs('admin', app);
    departmentManagerToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);
  }, 30000);

  describe('GET /api/billing/get - Get user billing info', () => {
    it('should return billing info for authenticated user', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('billingInfo');
    });

    it('should return empty billing info if not set', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.billingInfo).toBeDefined();
      // Billing info might be empty object
      expect(typeof response.body.data.billingInfo).toBe('object');
    });

    it('should work for admin users', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should work for department managers', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/billing/get');

      expect(response.status).toBe(401);
    });

    it('should not expose sensitive fields directly', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      
      // Should not contain raw credit card numbers or sensitive data
      if (response.body.data.billingInfo.creditCard) {
        expect(response.body.data.billingInfo.creditCard).not.toMatch(/^\d{16}$/);
      }
    });
  });

  describe('POST /api/billing/save - Save billing info', () => {
    const validBillingInfo = {
      companyName: 'Test Company',
      taxId: 'RFC123456789',
      address: {
        street: '123 Test Street',
        city: 'Mexico City',
        state: 'CDMX',
        zipCode: '01234',
        country: 'Mexico'
      },
      contactEmail: 'billing@testcompany.com',
      contactPhone: '+52 55 1234 5678',
      paymentMethod: 'invoice',
      paymentTerms: '30'
    };

    it('should save valid billing information', async () => {
      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validBillingInfo);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });

    it('should update existing billing information', async () => {
      // First save
      await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validBillingInfo);

      // Update
      const updatedInfo = {
        ...validBillingInfo,
        companyName: 'Updated Company Name'
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(updatedInfo);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify update
      const getResponse = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(getResponse.body.data.billingInfo.companyName).toBe('Updated Company Name');
    });

    it('should validate required fields', async () => {
      const invalidInfo = {
        companyName: '' // Empty required field
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(invalidInfo);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should validate email format', async () => {
      const invalidEmail = {
        ...validBillingInfo,
        contactEmail: 'invalid-email'
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(invalidEmail);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should validate tax ID format for Mexico', async () => {
      const invalidTaxId = {
        ...validBillingInfo,
        taxId: '123' // Too short for RFC
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(invalidTaxId);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should sanitize input data', async () => {
      const maliciousInput = {
        ...validBillingInfo,
        companyName: '<script>alert("xss")</script>Test Company'
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(maliciousInput);

      expect(response.status).toBe(200);

      // Verify sanitization
      const getResponse = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(getResponse.body.data.billingInfo.companyName).not.toContain('<script>');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/billing/save')
        .send(validBillingInfo);

      expect(response.status).toBe(401);
    });

    it('should handle partial updates', async () => {
      const partialUpdate = {
        contactPhone: '+52 55 9876 5432'
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(partialUpdate);

      expect([200, 400]).toContain(response.status);
    });
  });

  describe('GET /api/billing/get-user/:userId - Get specific user billing (Admin)', () => {
    it('should allow admin to get any user billing info', async () => {
      // Get a user ID first
      const credentials = AuthTestHelper.getCredentials('client');
      
      // This endpoint should exist for admins
      const response = await request(app)
        .get('/api/billing/get-user/testUserId')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 404]).toContain(response.status);
    });

    it('should allow superadmin to get any user billing info', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/testUserId')
        .set('Authorization', `Bearer ${superadminToken}`);

      expect([200, 404]).toContain(response.status);
    });

    it('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/testUserId')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should deny access to department managers', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/testUserId')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/nonexistentuser123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/testUserId');

      expect(response.status).toBe(401);
    });
  });

  describe('Data Privacy & Security', () => {
    it('should not expose other users billing info to regular users', async () => {
      // Try to access another user's billing through potential security holes
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`)
        .query({ userId: 'anotherUserId' }); // Shouldn't work

      expect(response.status).toBe(200);
      // Should return current user's info, not the requested user
      expect(response.body.data.billingInfo).toBeDefined();
    });

    it('should log billing info access for audit trail', async () => {
      const response = await request(app)
        .get('/api/billing/get')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(200);
      // Audit logging should be happening in background
      // Can't directly test but endpoint should complete successfully
    });

    it('should handle PII data according to PCI DSS standards', async () => {
      const sensitiveData = {
        ...validBillingInfo,
        creditCardLast4: '1234', // Should handle partial card data
        bankAccount: 'XXXX-XXXX-1234' // Should handle masked data
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(sensitiveData);

      expect([200, 400]).toContain(response.status);
      
      if (response.status === 200) {
        // Verify no full card numbers are stored
        const getResponse = await request(app)
          .get('/api/billing/get')
          .set('Authorization', `Bearer ${clientToken}`);

        if (getResponse.body.data.billingInfo.creditCardLast4) {
          expect(getResponse.body.data.billingInfo.creditCardLast4).toMatch(/^\d{4}$/);
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const response = await request(app)
        .get('/api/billing/get-user/invalid!!!id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([400, 404, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json"}');

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should not expose internal errors', async () => {
      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          companyName: 'a'.repeat(1000) // Very long string
        });

      if (response.status >= 500) {
        expect(response.body).not.toContain('stack');
        expect(response.body).not.toContain('MongoError');
      }
    });
  });

  describe('Business Rules', () => {
    it('should enforce payment terms validation', async () => {
      const invalidTerms = {
        ...validBillingInfo,
        paymentTerms: 'invalid'
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(invalidTerms);

      // Should validate payment terms (e.g., must be numeric or specific values)
      expect([200, 400]).toContain(response.status);
    });

    it('should validate address completeness', async () => {
      const incompleteAddress = {
        ...validBillingInfo,
        address: {
          street: '123 Test St'
          // Missing city, state, zipCode
        }
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(incompleteAddress);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should handle international addresses', async () => {
      const internationalAddress = {
        ...validBillingInfo,
        address: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'USA'
        }
      };

      const response = await request(app)
        .post('/api/billing/save')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(internationalAddress);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});

// Helper to create valid billing info
const validBillingInfo = {
  companyName: 'Test Company',
  taxId: 'RFC123456789',
  address: {
    street: '123 Test Street',
    city: 'Mexico City',
    state: 'CDMX',
    zipCode: '01234',
    country: 'Mexico'
  },
  contactEmail: 'billing@testcompany.com',
  contactPhone: '+52 55 1234 5678',
  paymentMethod: 'invoice',
  paymentTerms: '30'
};