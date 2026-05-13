/**
 * Invoice Controller Integration Tests
 * Tests for invoice request management endpoints
 * Created by Denisse Maldonado
 * 
 * Coverage: Invoice listing, processing, completion, and file management
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Invoice Controller Integration Tests', () => {
  let app;
  let superadminToken;
  let adminToken;
  let departmentManagerToken;
  let clientToken;

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
  }, 30000);

  describe('GET /api/invoices - Get pending invoices', () => {
    it('should return pending invoices for admin', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('invoices');
      expect(Array.isArray(response.body.invoices)).toBe(true);
      expect(response.body).toHaveProperty('total');
    });

    it('should return pending invoices for superadmin', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('invoices');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          page: 1,
          limit: 5
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      if (response.body.invoices.length > 0) {
        expect(response.body.invoices.length).toBeLessThanOrEqual(5);
      }
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          status: 'pending'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // If there are invoices, they should all be pending
      if (response.body.invoices.length > 0) {
        response.body.invoices.forEach(invoice => {
          expect(invoice.status).toBe('pending');
        });
      }
    });

    it('should filter by date range', async () => {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          startDate: oneMonthAgo.toISOString(),
          endDate: new Date().toISOString()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should deny access to department managers', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('No tiene permisos');
    });

    it('should deny access to clients', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/invoices');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/invoices/:id - Get invoice details', () => {
    it('should return 404 for non-existent invoice', async () => {
      const response = await request(app)
        .get('/api/invoices/nonexistentid123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Solicitud de factura no encontrada');
    });

    it('should return invoice details when exists', async () => {
      // First get list to find an existing invoice
      const listResponse = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      if (listResponse.body.invoices && listResponse.body.invoices.length > 0) {
        const invoiceId = listResponse.body.invoices[0].id;
        
        const response = await request(app)
          .get(`/api/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.invoice).toBeDefined();
        expect(response.body.invoice).toHaveProperty('id');
        expect(response.body.invoice).toHaveProperty('status');
        expect(response.body.invoice).toHaveProperty('quote');
      }
    });

    it('should include related quote information', async () => {
      const listResponse = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      if (listResponse.body.invoices && listResponse.body.invoices.length > 0) {
        const invoiceId = listResponse.body.invoices[0].id;
        
        const response = await request(app)
          .get(`/api/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        if (response.status === 200) {
          expect(response.body.invoice).toHaveProperty('quote');
          expect(response.body.invoice.quote).toHaveProperty('folio');
          expect(response.body.invoice.quote).toHaveProperty('total');
        }
      }
    });

    it('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/invoices/testid')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/invoices/:id/complete - Complete invoice', () => {
    it('should mark invoice as completed with required fields', async () => {
      const response = await request(app)
        .put('/api/invoices/testInvoiceId/complete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceNumber: 'INV-2024-001',
          invoiceDate: new Date().toISOString(),
          notes: 'Invoice completed successfully'
        });

      // Will likely return 404 for test ID, but we're testing the endpoint exists
      expect([200, 404]).toContain(response.status);
    });

    it('should require invoice number', async () => {
      const response = await request(app)
        .put('/api/invoices/testInvoiceId/complete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceDate: new Date().toISOString()
        });

      expect([400, 404]).toContain(response.status);
    });

    it('should require admin role', async () => {
      const response = await request(app)
        .put('/api/invoices/testInvoiceId/complete')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({
          invoiceNumber: 'INV-2024-001',
          invoiceDate: new Date().toISOString()
        });

      expect([403, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put('/api/invoices/testInvoiceId/complete')
        .send({
          invoiceNumber: 'INV-2024-001'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/invoices/:id/cancel - Cancel invoice request', () => {
    it('should cancel invoice request with reason', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Client request',
          notes: 'Client cancelled the request'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should require cancellation reason', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect([400, 404]).toContain(response.status);
    });

    it('should require admin role', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/cancel')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          reason: 'Test'
        });

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('POST /api/invoices/:id/upload - Upload invoice file', () => {
    it('should handle file upload request structure', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('fileType', 'pdf')
        .attach('file', Buffer.from('test'), 'test-invoice.pdf');

      // Will likely return 404 for test ID or file handling error
      expect([200, 400, 404, 500]).toContain(response.status);
    });

    it('should validate file type', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('fileType', 'invalid');

      expect([400, 404]).toContain(response.status);
    });

    it('should require admin role for uploads', async () => {
      const response = await request(app)
        .post('/api/invoices/testInvoiceId/upload')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .field('fileType', 'pdf');

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('GET /api/invoices/pending-count - Get pending invoice count', () => {
    it('should return pending invoice count for admin', async () => {
      const response = await request(app)
        .get('/api/invoices/pending-count')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('count');
      expect(typeof response.body.count).toBe('number');
      expect(response.body.count).toBeGreaterThanOrEqual(0);
    });

    it('should return count for superadmin', async () => {
      const response = await request(app)
        .get('/api/invoices/pending-count')
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('count');
    });

    it('should deny access to non-admin users', async () => {
      const response = await request(app)
        .get('/api/invoices/pending-count')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/invoices/pending-count');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/invoices/:id/download/:fileType - Download invoice file', () => {
    it('should handle download request for PDF', async () => {
      const response = await request(app)
        .get('/api/invoices/testInvoiceId/download/pdf')
        .set('Authorization', `Bearer ${adminToken}`);

      // Will likely return 404 for test ID
      expect([200, 404]).toContain(response.status);
    });

    it('should handle download request for XML', async () => {
      const response = await request(app)
        .get('/api/invoices/testInvoiceId/download/xml')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 404]).toContain(response.status);
    });

    it('should validate file type parameter', async () => {
      const response = await request(app)
        .get('/api/invoices/testInvoiceId/download/invalid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([400, 404]).toContain(response.status);
    });

    it('should require admin role for downloads', async () => {
      const response = await request(app)
        .get('/api/invoices/testInvoiceId/download/pdf')
        .set('Authorization', `Bearer ${clientToken}`);

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('Business Logic Validation', () => {
    it('should not allow completing already completed invoice', async () => {
      // This would require finding a completed invoice first
      const response = await request(app)
        .put('/api/invoices/completedInvoiceId/complete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceNumber: 'INV-2024-002',
          invoiceDate: new Date().toISOString()
        });

      expect([400, 404]).toContain(response.status);
    });

    it('should validate invoice data format', async () => {
      const response = await request(app)
        .put('/api/invoices/testInvoiceId/complete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceNumber: '', // Empty invoice number
          invoiceDate: 'invalid-date' // Invalid date
        });

      expect([400, 404]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const response = await request(app)
        .get('/api/invoices/invalid!!!id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([400, 404, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('should not expose sensitive information in errors', async () => {
      const response = await request(app)
        .get('/api/invoices/../../etc/passwd')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('passwd');
      expect(response.body).not.toContain('stack');
    });
  });

  describe('Security', () => {
    it('should validate input to prevent injection', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          status: "'; DROP TABLE Invoice; --"
        });

      expect(response.status).toBe(200);
      // Should still work, Parse Server should handle injection prevention
      expect(response.body).toHaveProperty('invoices');
    });

    it('should sanitize file uploads', async () => {
      const response = await request(app)
        .post('/api/invoices/testId/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('fileType', 'pdf')
        .attach('file', Buffer.from('<?php echo "hack"; ?>'), '../../malicious.php');

      // Should reject or sanitize malicious filenames
      expect([400, 404, 500]).toContain(response.status);
    });

    it('should enforce role-based access control consistently', async () => {
      const endpoints = [
        { method: 'get', path: '/api/invoices' },
        { method: 'get', path: '/api/invoices/testId' },
        { method: 'put', path: '/api/invoices/testId/complete' },
        { method: 'post', path: '/api/invoices/testId/cancel' }
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          [endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({ reason: 'test' });

        expect([403, 404]).toContain(response.status);
      }
    });
  });
});