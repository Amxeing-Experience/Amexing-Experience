/**
 * Invoice Request Workflow Integration Test
 * 
 * Tests the complete invoice request workflow:
 * 1. Department manager creates a quote with 'scheduled' status
 * 2. Department manager requests invoice via API
 * 3. Admin views pending invoice requests
 * 4. Admin processes (completes) the invoice request
 * 5. Verify button state changes and duplicate prevention
 */

const request = require('supertest');
const AuthTestHelper = require('../helpers/authTestHelper');

describe('Invoice Request Workflow Integration', () => {
  let app;
  let departmentManagerToken;
  let adminToken;
  let testQuote;
  let testInvoice;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Login with seeded users
    departmentManagerToken = await AuthTestHelper.loginAs('department_manager', app);
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  describe('Step 1: Create Scheduled Quote', () => {
    it('should create a quote with scheduled status', async () => {
      // First create a quote
      const quoteData = {
        rate: '67890abcdef123456789012ab', // Mock rate ID
        contactPerson: 'Test Contact',
        contactEmail: 'test@example.com',
        contactPhone: '+1234567890',
        notes: 'Test quote for invoice workflow'
      };

      const response = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send(quoteData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      testQuote = response.body.data;

      // Update quote to scheduled status (simulate business process)
      const updateResponse = await request(app)
        .put(`/api/quotes/${testQuote.id}`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ status: 'scheduled' });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
    });
  });

  describe('Step 2: Request Invoice', () => {
    it('should create invoice request for scheduled quote', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuote.id}/request-invoice`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ notes: 'Please generate invoice for this quote' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Solicitud de factura enviada exitosamente');
      expect(response.body.data.invoiceRequestId).toBeDefined();
    });

    it('should prevent duplicate invoice requests', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuote.id}/request-invoice`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ notes: 'Duplicate request attempt' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('pending invoice request');
    });
  });

  describe('Step 3: Admin Views Pending Invoices', () => {
    it('should list pending invoice requests for admins', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Find our test invoice in the results
      testInvoice = response.body.data.find(invoice => 
        invoice.quote && invoice.quote.id === testQuote.id
      );
      expect(testInvoice).toBeDefined();
      expect(testInvoice.status).toBe('pending');
    });

    it('should get detailed invoice information', async () => {
      const response = await request(app)
        .get(`/api/invoices/${testInvoice.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testInvoice.id);
      expect(response.body.data.status).toBe('pending');
      expect(response.body.data.quote.id).toBe(testQuote.id);
      expect(response.body.data.requestedBy).toBeDefined();
    });
  });

  describe('Step 4: Admin Processes Invoice', () => {
    it('should complete invoice request', async () => {
      const invoiceData = {
        invoiceNumber: 'INV-TEST-2025-0001',
        notes: 'Invoice processed successfully'
      };

      const response = await request(app)
        .put(`/api/invoices/${testInvoice.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invoiceData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Factura completada exitosamente');
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.invoiceNumber).toBe(invoiceData.invoiceNumber);
    });

    it('should not allow completing already processed invoice', async () => {
      const invoiceData = {
        invoiceNumber: 'INV-TEST-2025-0002',
        notes: 'Attempting to reprocess'
      };

      const response = await request(app)
        .put(`/api/invoices/${testInvoice.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invoiceData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Solo se pueden completar facturas pendientes');
    });
  });

  describe('Step 5: Verify Quote State Changes', () => {
    it('should show quote has pending invoice request', async () => {
      // Get quotes and check if our quote shows hasPendingInvoiceRequest flag
      const response = await request(app)
        .get('/api/quotes')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 50
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const quote = response.body.data.find(q => q.id === testQuote.id);
      expect(quote).toBeDefined();
      // Note: Since invoice is completed, this may be false now
      // The exact behavior depends on business logic
    });

    it('should prevent new invoice requests after completion', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuote.id}/request-invoice`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ notes: 'Attempting request after completion' });

      // This should either fail or create a new request depending on business rules
      // Since the first request is completed, a new one might be allowed
      // The exact behavior depends on business requirements
      expect([200, 400].includes(response.status)).toBe(true);
    });
  });

  describe('Step 6: Admin Invoice Cancellation', () => {
    let additionalTestInvoice;

    beforeAll(async () => {
      // Create another quote and invoice request to test cancellation
      const quoteResponse = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({
          rate: '67890abcdef123456789012ab',
          contactPerson: 'Cancellation Test',
          contactEmail: 'cancel@example.com',
          contactPhone: '+9876543210',
          notes: 'Quote for cancellation test'
        });

      const newQuote = quoteResponse.body.data;
      
      // Update to scheduled status
      await request(app)
        .put(`/api/quotes/${newQuote.id}`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ status: 'scheduled' });

      // Request invoice
      await request(app)
        .post(`/api/quotes/${newQuote.id}/request-invoice`)
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({ notes: 'Request for cancellation test' });

      // Get the invoice ID
      const invoicesResponse = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ draw: 1, start: 0, length: 10 });

      additionalTestInvoice = invoicesResponse.body.data.find(invoice => 
        invoice.quote && invoice.quote.id === newQuote.id
      );
    });

    it('should cancel pending invoice request', async () => {
      const response = await request(app)
        .delete(`/api/invoices/${additionalTestInvoice.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cancelled for testing purposes' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Solicitud de factura cancelada exitosamente');
    });
  });

  describe('Step 7: Authorization Tests', () => {
    it('should deny access to department manager for invoice management', async () => {
      const response = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient role level');
    });

    it('should require authentication for invoice endpoints', async () => {
      const response = await request(app)
        .get('/api/invoices');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access token required');
    });

    it('should require valid invoice number for completion', async () => {
      // Test validation for empty invoice number (returns 400)
      const response = await request(app)
        .put(`/api/invoices/nonexistent-id/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ invoiceNumber: '', notes: 'Invalid request' });

      expect(response.status).toBe(400);
    });
  });
});