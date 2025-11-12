/**
 * Quote Duplication API Integration Tests
 * End-to-end tests for POST /api/quotes/:id/duplicate endpoint
 * Tests duplication logic, eventType option numbering, folio generation, and permissions
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Quote Duplication API Integration Tests', () => {
  let app;
  let superadminToken;
  let adminToken;
  let employeeToken;
  let testQuoteId;
  let testRateId;

  beforeAll(async () => {
    // Import app (Parse Server already running on port 1339 via MongoDB Memory Server)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Login with seeded users using Parse SDK
    superadminToken = await AuthTestHelper.loginAs('superadmin');
    adminToken = await AuthTestHelper.loginAs('admin');
    employeeToken = await AuthTestHelper.loginAs('employee');

    // Create a test rate for quotes
    const Rate = Parse.Object.extend('Rate');
    const testRate = new Rate();
    testRate.set('name', 'Test Rate for Duplication');
    testRate.set('active', true);
    testRate.set('exists', true);
    testRate.set('basePrice', 1000);
    const savedRate = await testRate.save(null, { useMasterKey: true });
    testRateId = savedRate.id;
  }, 30000);

  afterAll(async () => {
    // Clean up test quote and rate if created
    if (testQuoteId) {
      try {
        const query = new Parse.Query('Quote');
        const quote = await query.get(testQuoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (error) {
        // Quote might already be deleted
      }
    }

    if (testRateId) {
      try {
        const query = new Parse.Query('Rate');
        const rate = await query.get(testRateId, { useMasterKey: true });
        await rate.destroy({ useMasterKey: true });
      } catch (error) {
        // Rate might already be deleted
      }
    }

    // Clean up any duplicate quotes created during tests
    try {
      const query = new Parse.Query('Quote');
      query.matches('eventType', /Test Event.*Opción/i);
      const duplicates = await query.find({ useMasterKey: true });
      await Parse.Object.destroyAll(duplicates, { useMasterKey: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Create a fresh test quote before each test
    const Quote = Parse.Object.extend('Quote');
    const testQuote = new Quote();

    // Set up quote with all required fields
    const ratePointer = {
      __type: 'Pointer',
      className: 'Rate',
      objectId: testRateId,
    };

    testQuote.set('rate', ratePointer);
    testQuote.set('eventType', 'Test Event for Duplication');
    testQuote.set('numberOfPeople', 10);
    testQuote.set('status', 'draft');
    testQuote.set('active', true);
    testQuote.set('exists', true);
    testQuote.set('contactPerson', 'John Doe');
    testQuote.set('contactEmail', 'john@test.com');
    testQuote.set('contactPhone', '+1234567890');
    testQuote.set('notes', 'Test notes');

    // Add sample serviceItems
    testQuote.set('serviceItems', {
      days: [
        {
          dayNumber: 1,
          dayTitle: 'Día 1',
          subconcepts: [
            {
              time: '10:00',
              concept: 'Transfer',
              type: 'transfer',
              vehicleType: 'Sprinter',
              hours: 2,
              unitPrice: 500,
              total: 1000,
              notes: 'Test transfer',
            },
          ],
          dayTotal: 1000,
        },
      ],
      subtotal: 1000,
      iva: 160,
      total: 1160,
    });

    const savedQuote = await testQuote.save(null, { useMasterKey: true });
    testQuoteId = savedQuote.id;
  });

  afterEach(async () => {
    // Clean up test quote after each test
    if (testQuoteId) {
      try {
        const query = new Parse.Query('Quote');
        const quote = await query.get(testQuoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (error) {
        // Ignore if already deleted
      }
    }
  });

  describe('POST /api/quotes/:id/duplicate', () => {
    it('should duplicate quote without suffix and add "- Opción 2" to eventType', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('quote');

      const duplicatedQuote = response.body.data.quote;

      // Verify eventType has "- Opción 2" appended
      expect(duplicatedQuote.eventType).toBe('Test Event for Duplication - Opción 2');

      // Verify new folio was generated (format: QTE-YYYY-####)
      expect(duplicatedQuote.folio).toMatch(/^QTE-\d{4}-\d{4}$/);
      expect(duplicatedQuote.folio).not.toBe(response.body.data.originalFolio);

      // Verify status is requested
      expect(duplicatedQuote.status).toBe('requested');

      // Verify other fields were copied
      expect(duplicatedQuote.numberOfPeople).toBe(10);
      expect(duplicatedQuote.contactPerson).toBe('John Doe');
      expect(duplicatedQuote.contactEmail).toBe('john@test.com');
      expect(duplicatedQuote.contactPhone).toBe('+1234567890');
      expect(duplicatedQuote.notes).toBe('Test notes');

      // Verify serviceItems were copied
      expect(duplicatedQuote.serviceItems).toBeDefined();
      expect(duplicatedQuote.serviceItems.days).toHaveLength(1);
      expect(duplicatedQuote.serviceItems.total).toBe(1160);

      // Clean up created duplicate
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should increment option number when duplicating quote with "Opción 2"', async () => {
      // First, update the test quote to have "Opción 2"
      const query = new Parse.Query('Quote');
      const quote = await query.get(testQuoteId, { useMasterKey: true });
      quote.set('eventType', 'Test Event for Duplication - Opción 2');
      await quote.save(null, { useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const duplicatedQuote = response.body.data.quote;

      // Verify eventType was incremented to "Opción 3"
      expect(duplicatedQuote.eventType).toBe('Test Event for Duplication - Opción 3');

      // Clean up
      const duplicateQuery = new Parse.Query('Quote');
      const duplicate = await duplicateQuery.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should increment option number correctly for any number (e.g., Opción 5 → Opción 6)', async () => {
      // Update test quote to have "Opción 5"
      const query = new Parse.Query('Quote');
      const quote = await query.get(testQuoteId, { useMasterKey: true });
      quote.set('eventType', 'Wedding Event - Opción 5');
      await quote.save(null, { useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.data.quote.eventType).toBe('Wedding Event - Opción 6');

      // Clean up
      const duplicateQuery = new Parse.Query('Quote');
      const duplicate = await duplicateQuery.get(
        response.body.data.quote.objectId,
        { useMasterKey: true },
      );
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should generate new sequential folio following QTE-YYYY-#### format', async () => {
      // Get current quote count to predict next folio
      const countQuery = new Parse.Query('Quote');
      countQuery.equalTo('exists', true);
      const currentCount = await countQuery.count({ useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);

      const duplicatedQuote = response.body.data.quote;
      const year = new Date().getFullYear();
      const expectedSequence = String(currentCount + 1).padStart(4, '0');

      expect(duplicatedQuote.folio).toBe(`QTE-${year}-${expectedSequence}`);

      // Clean up
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should copy complete serviceItems structure with all days and subconcepts', async () => {
      // Update test quote with more complex serviceItems
      const query = new Parse.Query('Quote');
      const quote = await query.get(testQuoteId, { useMasterKey: true });
      quote.set('serviceItems', {
        days: [
          {
            dayNumber: 1,
            dayTitle: 'Día 1',
            subconcepts: [
              {
                time: '10:00',
                concept: 'Transfer',
                type: 'transfer',
                vehicleType: 'Sprinter',
                hours: 2,
                unitPrice: 500,
                total: 1000,
              },
              {
                time: '14:00',
                concept: 'Experiencia',
                type: 'experiencia',
                hours: 3,
                unitPrice: 800,
                total: 2400,
              },
            ],
            dayTotal: 3400,
          },
          {
            dayNumber: 2,
            dayTitle: 'Día 2',
            subconcepts: [
              {
                time: '09:00',
                concept: 'Transfer',
                type: 'transfer',
                vehicleType: 'Suburban',
                hours: 1,
                unitPrice: 300,
                total: 300,
              },
            ],
            dayTotal: 300,
          },
        ],
        subtotal: 3700,
        iva: 592,
        total: 4292,
      });
      await quote.save(null, { useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);

      const duplicatedQuote = response.body.data.quote;

      // Verify complete serviceItems structure was copied
      expect(duplicatedQuote.serviceItems.days).toHaveLength(2);
      expect(duplicatedQuote.serviceItems.days[0].subconcepts).toHaveLength(2);
      expect(duplicatedQuote.serviceItems.days[1].subconcepts).toHaveLength(1);
      expect(duplicatedQuote.serviceItems.total).toBe(4292);

      // Clean up
      const duplicateQuery = new Parse.Query('Quote');
      const duplicate = await duplicateQuery.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should set status to "requested" regardless of original status', async () => {
      // Update test quote to have status "accepted"
      const query = new Parse.Query('Quote');
      const quote = await query.get(testQuoteId, { useMasterKey: true });
      quote.set('status', 'accepted');
      await quote.save(null, { useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);
      expect(response.body.data.quote.status).toBe('requested');

      // Clean up
      const duplicateQuery = new Parse.Query('Quote');
      const duplicate = await duplicateQuery.get(
        response.body.data.quote.objectId,
        { useMasterKey: true },
      );
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should set validUntil to 30 days from now', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);

      const duplicatedQuote = response.body.data.quote;
      const validUntil = new Date(duplicatedQuote.validUntil);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 30);

      // Allow 1 day tolerance for test execution time
      const tolerance = 24 * 60 * 60 * 1000; // 1 day in milliseconds
      expect(Math.abs(validUntil - expectedDate)).toBeLessThan(tolerance);

      // Clean up
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should allow superadmin to duplicate quote', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Clean up
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(
        response.body.data.quote.objectId,
        { useMasterKey: true },
      );
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should return 403 for employee role (insufficient permissions)', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/Access denied|Insufficient role level/i);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app).post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 when trying to duplicate non-existent quote', async () => {
      // Use a valid ObjectId format that doesn't exist
      const fakeQuoteId = 'a'.repeat(24); // Valid ObjectId format but non-existent

      const response = await request(app)
        .post(`/api/quotes/${fakeQuoteId}/duplicate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/Quote not found|Cotización no encontrada|not found/i);
    });

    it('should return 404 when trying to duplicate logically deleted quote (exists=false)', async () => {
      // Soft delete the test quote
      const query = new Parse.Query('Quote');
      const quote = await query.get(testQuoteId, { useMasterKey: true });
      quote.set('exists', false);
      await quote.save(null, { useMasterKey: true });

      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);

      // Restore quote for cleanup
      quote.set('exists', true);
      await quote.save(null, { useMasterKey: true });
    });

    it('should preserve rate reference in duplicated quote', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);

      const duplicatedQuote = response.body.data.quote;

      // Verify rate is preserved
      expect(duplicatedQuote.rate).toBeDefined();
      expect(duplicatedQuote.rate.objectId).toBe(testRateId);

      // Clean up
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });

    it('should copy contact information correctly', async () => {
      const response = await request(app)
        .post(`/api/quotes/${testQuoteId}/duplicate`)
        .set('Content-Type', 'application/json')
        .send({})
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);

      const duplicatedQuote = response.body.data.quote;

      expect(duplicatedQuote.contactPerson).toBe('John Doe');
      expect(duplicatedQuote.contactEmail).toBe('john@test.com');
      expect(duplicatedQuote.contactPhone).toBe('+1234567890');

      // Clean up
      const query = new Parse.Query('Quote');
      const duplicate = await query.get(duplicatedQuote.objectId, { useMasterKey: true });
      await duplicate.destroy({ useMasterKey: true });
    });
  });
});
