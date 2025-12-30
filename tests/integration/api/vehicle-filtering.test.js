/**
 * Vehicle Filtering Integration Tests
 * Tests filtering vehicles by rate (tarifa) in DataTable.
 *
 * TDD Workflow: RED (write tests) → GREEN (implement) → REFACTOR.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Vehicle Filtering by Rate Integration', () => {
  let app;
  let superadminToken;
  let testVehicles = [];
  let testRates = [];

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    // Login as superadmin
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
  }, 30000);

  beforeEach(async () => {
    // Create test rates
    const Rate = Parse.Object.extend('Rate');

    const rate1 = new Rate();
    rate1.set('name', 'Tarifa Test Premium');
    rate1.set('percentage', 25);
    rate1.set('color', '#FF5733');
    rate1.set('active', true);
    rate1.set('exists', true);
    await rate1.save(null, { useMasterKey: true });
    testRates.push(rate1);

    const rate2 = new Rate();
    rate2.set('name', 'Tarifa Test Estándar');
    rate2.set('percentage', 15);
    rate2.set('color', '#3498DB');
    rate2.set('active', true);
    rate2.set('exists', true);
    await rate2.save(null, { useMasterKey: true });
    testRates.push(rate2);

    // Get or create test vehicle type
    const VehicleType = Parse.Object.extend('VehicleType');
    const typeQuery = new Parse.Query(VehicleType);
    typeQuery.equalTo('exists', true);
    typeQuery.equalTo('active', true);
    let vehicleType = await typeQuery.first({ useMasterKey: true });

    if (!vehicleType) {
      vehicleType = new VehicleType();
      vehicleType.set('name', 'Sedán Test');
      vehicleType.set('active', true);
      vehicleType.set('exists', true);
      await vehicleType.save(null, { useMasterKey: true });
    }

    // Create test vehicles with different rates
    const Vehicle = Parse.Object.extend('Vehicle');

    // Vehicle 1: Premium rate
    const vehicle1 = new Vehicle();
    vehicle1.set('brand', 'Toyota');
    vehicle1.set('model', 'Corolla');
    vehicle1.set('year', 2023);
    vehicle1.set('licensePlate', 'ABC-123-TEST');
    vehicle1.set('capacity', 4);
    vehicle1.set('vehicleTypeId', vehicleType);
    vehicle1.set('rateId', rate1);
    vehicle1.set('active', true);
    vehicle1.set('exists', true);
    await vehicle1.save(null, { useMasterKey: true });
    testVehicles.push(vehicle1);

    // Vehicle 2: Standard rate
    const vehicle2 = new Vehicle();
    vehicle2.set('brand', 'Honda');
    vehicle2.set('model', 'Civic');
    vehicle2.set('year', 2022);
    vehicle2.set('licensePlate', 'XYZ-456-TEST');
    vehicle2.set('capacity', 4);
    vehicle2.set('vehicleTypeId', vehicleType);
    vehicle2.set('rateId', rate2);
    vehicle2.set('active', true);
    vehicle2.set('exists', true);
    await vehicle2.save(null, { useMasterKey: true });
    testVehicles.push(vehicle2);

    // Vehicle 3: Premium rate
    const vehicle3 = new Vehicle();
    vehicle3.set('brand', 'Mazda');
    vehicle3.set('model', 'CX-5');
    vehicle3.set('year', 2024);
    vehicle3.set('licensePlate', 'DEF-789-TEST');
    vehicle3.set('capacity', 5);
    vehicle3.set('vehicleTypeId', vehicleType);
    vehicle3.set('rateId', rate1);
    vehicle3.set('active', true);
    vehicle3.set('exists', true);
    await vehicle3.save(null, { useMasterKey: true });
    testVehicles.push(vehicle3);

    // Vehicle 4: No rate
    const vehicle4 = new Vehicle();
    vehicle4.set('brand', 'Ford');
    vehicle4.set('model', 'Escape');
    vehicle4.set('year', 2021);
    vehicle4.set('licensePlate', 'GHI-012-TEST');
    vehicle4.set('capacity', 5);
    vehicle4.set('vehicleTypeId', vehicleType);
    // No rateId set
    vehicle4.set('active', true);
    vehicle4.set('exists', true);
    await vehicle4.save(null, { useMasterKey: true });
    testVehicles.push(vehicle4);
  });

  afterEach(async () => {
    // Clean up test data
    for (const vehicle of testVehicles) {
      await vehicle.destroy({ useMasterKey: true });
    }
    testVehicles = [];

    for (const rate of testRates) {
      await rate.destroy({ useMasterKey: true });
    }
    testRates = [];
  });

  describe('GET /api/vehicles with rateId filter', () => {
    it('should filter vehicles by specific rate (Premium)', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: testRates[0].id, // Premium rate
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.recordsFiltered).toBe(2); // 2 vehicles with Premium rate
      expect(response.body.data.length).toBe(2);

      // Verify all returned vehicles have Premium rate
      response.body.data.forEach((vehicle) => {
        expect(vehicle.rateId).toBeDefined();
        expect(vehicle.rateId.objectId).toBe(testRates[0].id);
        expect(vehicle.rateId.name).toBe('Tarifa Test Premium');
      });
    });

    it('should filter vehicles by specific rate (Estándar)', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: testRates[1].id, // Standard rate
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.recordsFiltered).toBe(1); // 1 vehicle with Standard rate
      expect(response.body.data.length).toBe(1);

      // Verify vehicle data
      const vehicle = response.body.data[0];
      expect(vehicle.rateId.objectId).toBe(testRates[1].id);
      expect(vehicle.rateId.name).toBe('Tarifa Test Estándar');
      expect(vehicle.brand).toBe('Honda');
    });

    it('should return empty array for non-existent rate', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: 'nonExistentRateId123',
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.recordsFiltered).toBe(0);
      expect(response.body.data.length).toBe(0);
    });

    it('should return all vehicles when no rateId filter is provided', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          // No rateId filter
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should return all test vehicles (4) plus any seeded/existing vehicles
      expect(response.body.recordsFiltered).toBeGreaterThanOrEqual(4);
      expect(response.body.data.length).toBeGreaterThanOrEqual(4);
    });

    it('should combine rateId filter with search query', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: testRates[0].id, // Premium rate (2 vehicles: Toyota, Mazda)
          'search[value]': 'ABC-123-TEST', // Search for specific license plate
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.recordsFiltered).toBeGreaterThanOrEqual(1); // At least 1 vehicle with this license plate and Premium rate
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      // Verify that the Toyota vehicle with correct license plate is in the results
      const toyotaVehicle = response.body.data.find(v => v.licensePlate === 'ABC-123-TEST');
      expect(toyotaVehicle).toBeDefined();
      expect(toyotaVehicle.brand).toBe('Toyota');
      expect(toyotaVehicle.rateId.objectId).toBe(testRates[0].id);
    });

    it('should handle empty rateId parameter (treated as no filter)', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: '', // Empty string
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should return all vehicles (no filter applied)
      expect(response.body.recordsFiltered).toBeGreaterThanOrEqual(4);
    });

    it('should work with pagination when filtering by rate', async () => {
      // First page
      const page1 = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 1, // 1 per page
          rateId: testRates[0].id, // Premium rate (2 vehicles)
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(page1.body.success).toBe(true);
      expect(page1.body.recordsFiltered).toBe(2);
      expect(page1.body.data.length).toBe(1); // Only 1 result due to pagination

      // Second page
      const page2 = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 2,
          start: 1,
          length: 1, // 1 per page
          rateId: testRates[0].id, // Premium rate (2 vehicles)
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(page2.body.success).toBe(true);
      expect(page2.body.recordsFiltered).toBe(2);
      expect(page2.body.data.length).toBe(1); // Second result

      // Verify different vehicles returned
      expect(page1.body.data[0].objectId).not.toBe(page2.body.data[0].objectId);
    });
  });

  describe('Filter validation and edge cases', () => {
    it('should handle malformed rateId gracefully', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
          rateId: 'invalid-id-format!@#',
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.recordsFiltered).toBe(0);
      expect(response.body.data.length).toBe(0);
    });

    it('should not break existing functionality without filter', async () => {
      const response = await request(app)
        .get('/api/vehicles')
        .query({
          draw: 1,
          start: 0,
          length: 10,
        })
        .set('Authorization', `Bearer ${superadminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.recordsTotal).toBeGreaterThanOrEqual(0);
    });
  });
});
