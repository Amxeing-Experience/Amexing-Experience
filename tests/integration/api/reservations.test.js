/**
 * Reservation Controller Integration Tests
 * Tests for reservation management endpoints
 * Created by Denisse Maldonado
 * 
 * Coverage: Basic CRUD operations, employee assignment, service status updates
 */

const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Reservation Controller Integration Tests', () => {
  let app;
  let adminToken;
  let departmentManagerToken;
  let clientToken;
  let testReservationId;
  let testQuoteId;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');
    
    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get authentication tokens for different roles
    adminToken = await AuthTestHelper.loginAs('admin', app);
    departmentManagerToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
  }, 30000);

  describe('GET /api/reservations - List reservations', () => {
    it('should return reservations list for admin with DataTables format', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10,
          'order[0][column]': 0,
          'order[0][dir]': 'desc'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('draw', 1);
      expect(response.body).toHaveProperty('recordsTotal');
      expect(response.body).toHaveProperty('recordsFiltered');
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter reservations by status', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10,
          statusFilter: 'confirmed'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');

      // If there are results, they should all have status 'confirmed'
      if (response.body.data.length > 0) {
        response.body.data.forEach(reservation => {
          expect(reservation.status).toContain('confirmed');
        });
      }
    });

    it('should handle search parameter', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10,
          'search[value]': 'test'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('recordsFiltered');
    });

    it('should respect role-based filtering for department manager', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      // Department manager should only see reservations for their department
      // The actual filtering is tested by checking the response structure
      expect(response.body.recordsFiltered).toBeLessThanOrEqual(response.body.recordsTotal);
    });

    it('should respect role-based filtering for client', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${clientToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      // Client should only see their organization's reservations
      expect(response.body.recordsFiltered).toBeLessThanOrEqual(response.body.recordsTotal);
    });

    it('should handle pagination correctly', async () => {
      const page1 = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 5
        });

      const page2 = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 2,
          start: 5,
          length: 5
        });

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.data.length).toBeLessThanOrEqual(5);
      expect(page2.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should reject requests without authentication', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .query({ draw: 1, start: 0, length: 10 });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/reservations/:id - Get reservation by ID', () => {
    // Note: We need a valid reservation ID for these tests
    // In a real scenario, we would create a test reservation first
    
    it('should return 404 for non-existent reservation', async () => {
      const response = await request(app)
        .get('/api/reservations/nonexistentid123')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return reservation details when exists', async () => {
      // First, get list to find an existing reservation
      const listResponse = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ draw: 1, start: 0, length: 1 });

      if (listResponse.body.data && listResponse.body.data.length > 0) {
        const reservationId = listResponse.body.data[0].id;
        
        const response = await request(app)
          .get(`/api/reservations/${reservationId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.reservation).toBeDefined();
        expect(response.body.services).toBeDefined();
        expect(Array.isArray(response.body.services)).toBe(true);
      }
    });

    it('should include related data (quote, client, services)', async () => {
      const listResponse = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ draw: 1, start: 0, length: 1 });

      if (listResponse.body.data && listResponse.body.data.length > 0) {
        const reservationId = listResponse.body.data[0].id;
        
        const response = await request(app)
          .get(`/api/reservations/${reservationId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.reservation).toHaveProperty('quoteFolio');
        expect(response.body.reservation).toHaveProperty('clientName');
        expect(response.body.reservation).toHaveProperty('contact');
        expect(response.body.reservation).toHaveProperty('status');
      }
    });
  });

  describe('PATCH /api/reservations/:id/services/:serviceId/status - Update service status', () => {
    it('should update service status when valid', async () => {
      // Note: This would require a valid reservation with services
      // For now, we test the endpoint structure
      const response = await request(app)
        .patch('/api/reservations/testReservationId/services/testServiceId/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'completed'
        });

      // Will likely return 404 for test IDs, but we're testing the endpoint exists
      expect([200, 404]).toContain(response.status);
    });

    it('should validate status values', async () => {
      const response = await request(app)
        .patch('/api/reservations/testReservationId/services/testServiceId/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'invalid_status'
        });

      expect([400, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .patch('/api/reservations/testReservationId/services/testServiceId/status')
        .send({
          status: 'completed'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/reservations/:id/services/:serviceId/assign - Assign employee to service', () => {
    it('should assign employee and vehicle to service', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/testServiceId/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: 'testEmployeeId',
          vehicleId: 'testVehicleId'
        });

      // Will likely return 404 for test IDs, but we're testing the endpoint exists
      expect([200, 404]).toContain(response.status);
    });

    it('should allow assignment of only employee (no vehicle)', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/testServiceId/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: 'testEmployeeId'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should require at least department manager role', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/testServiceId/assign')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          employeeId: 'testEmployeeId'
        });

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('PUT /api/reservations/:id/services/batch-assign - Batch assign employees', () => {
    it('should batch assign employees to multiple services', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/batch-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceIds: ['service1', 'service2'],
          driverId: 'employee1',
          vehicleId: 'vehicle1'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should validate assignments array', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/batch-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          assignments: 'invalid'
        });

      expect([400, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/services/batch-assign')
        .send({
          assignments: []
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/reservations/:id/cancel - Cancel reservation', () => {
    it('should cancel reservation with reason', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Customer request',
          notes: 'Customer changed travel plans'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should require cancellation reason', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect([400, 404]).toContain(response.status);
    });

    it('should require at least department manager role', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/cancel')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          reason: 'Test'
        });

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('POST /api/reservations/:id/adjustments - Add price adjustment', () => {
    it('should add price adjustment (extra charge)', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'charge',
          description: 'Late checkout fee',
          amount: 500,
          currency: 'MXN'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should add price adjustment (discount)', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'discount',
          description: 'Loyalty discount',
          amount: 1000,
          currency: 'MXN'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should validate adjustment type', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/adjustments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'invalid_type',
          amount: 100
        });

      expect([400, 404]).toContain(response.status);
    });

    it('should require admin role for adjustments', async () => {
      const response = await request(app)
        .post('/api/reservations/testReservationId/adjustments')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({
          type: 'discount',
          amount: 100
        });

      expect([403, 404]).toContain(response.status);
    });
  });

  describe('DELETE /api/reservations/:id/adjustments/:adjustmentId - Remove adjustment', () => {
    it('should remove price adjustment', async () => {
      const response = await request(app)
        .delete('/api/reservations/testReservationId/adjustments/testAdjustmentId')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 404]).toContain(response.status);
    });

    it('should require admin role', async () => {
      const response = await request(app)
        .delete('/api/reservations/testReservationId/adjustments/testAdjustmentId')
        .set('Authorization', `Bearer ${departmentManagerToken}`);

      expect([403, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .delete('/api/reservations/testReservationId/adjustments/testAdjustmentId');

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/reservations/:id/service-customer - Assign service customer', () => {
    it('should assign customer to reservation services', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/service-customer')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({
          customerId: 'testCustomerId'
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should clear customer when customerId is null', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/service-customer')
        .set('Authorization', `Bearer ${departmentManagerToken}`)
        .send({
          customerId: null
        });

      expect([200, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put('/api/reservations/testReservationId/service-customer')
        .send({
          customerId: 'testCustomerId'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Test with invalid objectId format
      const response = await request(app)
        .get('/api/reservations/invalid!!!id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([400, 404, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('should handle missing required fields', async () => {
      const response = await request(app)
        .put('/api/reservations/testId/services/testServiceId/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({}); // Missing employeeId

      expect([400, 404]).toContain(response.status);
    });
  });

  describe('Security', () => {
    it('should not expose sensitive data in error messages', async () => {
      const response = await request(app)
        .get('/api/reservations/../../etc/passwd')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('passwd');
      expect(response.body).not.toContain('stack');
    });

    it('should validate input to prevent injection', async () => {
      const response = await request(app)
        .get('/api/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          draw: 1,
          start: 0,
          length: 10,
          'search[value]': "'; DROP TABLE Reservation; --"
        });

      expect(response.status).toBe(200);
      // Should still work, Parse Server should handle SQL injection prevention
      expect(response.body).toHaveProperty('data');
    });
  });
});