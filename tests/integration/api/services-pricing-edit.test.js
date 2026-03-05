/**
 * Services Pricing Edit Modal Integration Tests
 * Tests the complete pricing grid edit functionality for services
 *
 * Features tested:
 * - Update existing prices (versioning with valid_until)
 * - Deactivate prices by setting to 0 (valid_until approach)
 * - Add new rate-vehicle price combinations
 * - Complete edit modal workflow
 *
 * TDD Workflow: Testing implemented features to ensure reliability
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Services Pricing Edit Integration', () => {
  let app;
  let adminToken;
  let testService;
  let testRates = [];
  let testVehicleTypes = [];

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Login with seeded admin user
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  beforeEach(async () => {
    // Create test data for each test
    await setupTestData();
  });

  afterEach(async () => {
    // Clean up test data
    await cleanupTestData();
  });

  describe('Update Base Prices Endpoint', () => {
    it('should update existing prices with versioning', async () => {
      // Create initial rate price
      const initialRatePrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);
      
      // Update the price
      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: initialRatePrice.id,
            rateId: testRates[0].id,
            vehicleId: testVehicleTypes[0].id,
            price: 150.00
          }]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.updatedCount).toBe(2); // 1 deactivated + 1 new record

      // Verify old price is deactivated
      const oldPrice = await new Parse.Query('RatePrices').get(initialRatePrice.id, { useMasterKey: true });
      expect(oldPrice.get('valid_until')).not.toBeNull();

      // Verify new price exists and is active
      const activePrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .doesNotExist('valid_until')
        .find({ useMasterKey: true });
      
      expect(activePrices.length).toBe(1);
      expect(activePrices[0].get('price')).toBe(150.00);
    });

    it('should deactivate prices when set to 0', async () => {
      // Create initial rate price
      const initialRatePrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);
      
      // Set price to 0
      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: initialRatePrice.id,
            rateId: testRates[0].id,
            vehicleId: testVehicleTypes[0].id,
            price: 0
          }]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.updatedCount).toBe(1); // Only deactivated, no new record

      // Verify price is deactivated
      const deactivatedPrice = await new Parse.Query('RatePrices').get(initialRatePrice.id, { useMasterKey: true });
      expect(deactivatedPrice.get('valid_until')).not.toBeNull();

      // Verify no active prices for this combination
      const activePrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .equalTo('rate', { __type: 'Pointer', className: 'Rate', objectId: testRates[0].id })
        .equalTo('vehicleType', { __type: 'Pointer', className: 'VehicleType', objectId: testVehicleTypes[0].id })
        .doesNotExist('valid_until')
        .find({ useMasterKey: true });
      
      expect(activePrices.length).toBe(0);
    });

    it('should handle multiple price updates in single request', async () => {
      // Create multiple initial rate prices
      const ratePrice1 = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);
      const ratePrice2 = await createTestRatePrice(testService, testRates[0], testVehicleTypes[1], 200.00);
      
      // Update both prices
      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [
            {
              id: ratePrice1.id,
              price: 125.00 // Update
            },
            {
              id: ratePrice2.id,
              price: 0 // Deactivate
            }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.updatedCount).toBe(3); // 2 deactivated + 1 new record

      // Verify results
      const activePrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .doesNotExist('valid_until')
        .find({ useMasterKey: true });
      
      expect(activePrices.length).toBe(1);
      expect(activePrices[0].get('price')).toBe(125.00);
    });
  });

  describe('Add Rate Prices Endpoint', () => {
    it('should create new rate prices for existing service', async () => {
      const response = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [
            {
              rateId: testRates[0].id,
              vehicleId: testVehicleTypes[0].id,
              price: 100.00
            },
            {
              rateId: testRates[0].id,
              vehicleId: testVehicleTypes[1].id,
              price: 200.00
            }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(2);

      // Verify rate prices were created
      const createdPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .find({ useMasterKey: true });
      
      expect(createdPrices.length).toBe(2);
      expect(createdPrices.map(p => p.get('price')).sort()).toEqual([100.00, 200.00]);
    });

    it('should prevent duplicate rate-vehicle combinations', async () => {
      // Create initial rate price
      await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);
      
      // Try to create duplicate
      const response = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            rateId: testRates[0].id,
            vehicleId: testVehicleTypes[0].id,
            price: 150.00
          }]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(0);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].error).toContain('Ya existe precio');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            rateId: testRates[0].id,
            // Missing vehicleId and price
          }]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(0);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].error).toBe('Datos inválidos');
    });
  });

  describe('Complete Edit Modal Workflow', () => {
    it('should handle mixed update and create operations', async () => {
      // Create initial rate prices for some combinations
      const existingPrice1 = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);
      const existingPrice2 = await createTestRatePrice(testService, testRates[0], testVehicleTypes[1], 200.00);

      // Simulate edit modal save: update existing + add new + deactivate one
      const updateResponse = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [
            {
              id: existingPrice1.id,
              price: 125.00 // Update
            },
            {
              id: existingPrice2.id,
              price: 0 // Deactivate
            }
          ]
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.updatedCount).toBe(3); // 2 deactivated + 1 new

      const createResponse = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [
            {
              rateId: testRates[1].id, // Different rate
              vehicleId: testVehicleTypes[0].id,
              price: 300.00
            }
          ]
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.created).toBe(1);

      // Verify final state
      const activePrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .doesNotExist('valid_until')
        .include(['rate', 'vehicleType'])
        .find({ useMasterKey: true });
      
      expect(activePrices.length).toBe(2); // Updated price + new price
      const prices = activePrices.map(p => p.get('price')).sort();
      expect(prices).toEqual([125.00, 300.00]);
    });
  });

  describe('Error Handling', () => {
    it('should require admin authentication', async () => {
      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .send({
          prices: [{
            id: 'test-id',
            price: 100
          }]
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should validate service exists', async () => {
      const response = await request(app)
        .post('/api/services/nonexistent/update-base-prices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: 'test-id',
            price: 100
          }]
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('no encontrado');
    });
  });

  // Helper functions
  async function setupTestData() {
    // Create test service
    const serviceData = new Parse.Object('Services');
    serviceData.set('destinationPOI', { __type: 'Pointer', className: 'POI', objectId: 'test-poi' });
    serviceData.set('active', true);
    serviceData.set('exists', true);
    testService = await serviceData.save(null, { useMasterKey: true });

    // Create test rates
    for (let i = 0; i < 2; i++) {
      const rate = new Parse.Object('Rate');
      rate.set('name', `Test Rate ${i + 1}`);
      rate.set('active', true);
      rate.set('exists', true);
      testRates.push(await rate.save(null, { useMasterKey: true }));
    }

    // Create test vehicle types
    for (let i = 0; i < 2; i++) {
      const vehicleType = new Parse.Object('VehicleType');
      vehicleType.set('name', `Test Vehicle ${i + 1}`);
      vehicleType.set('active', true);
      vehicleType.set('exists', true);
      testVehicleTypes.push(await vehicleType.save(null, { useMasterKey: true }));
    }
  }

  async function cleanupTestData() {
    // Clean up rate prices
    const ratePrices = await new Parse.Query('RatePrices')
      .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService?.id })
      .find({ useMasterKey: true });
    if (ratePrices.length > 0) {
      await Parse.Object.destroyAll(ratePrices, { useMasterKey: true });
    }

    // Clean up test data
    if (testService) await testService.destroy({ useMasterKey: true });
    if (testRates.length > 0) await Parse.Object.destroyAll(testRates, { useMasterKey: true });
    if (testVehicleTypes.length > 0) await Parse.Object.destroyAll(testVehicleTypes, { useMasterKey: true });

    // Reset arrays
    testRates = [];
    testVehicleTypes = [];
    testService = null;
  }

  async function createTestRatePrice(service, rate, vehicleType, price) {
    const ratePrice = new Parse.Object('RatePrices');
    ratePrice.set('service', { __type: 'Pointer', className: 'Services', objectId: service.id });
    ratePrice.set('rate', { __type: 'Pointer', className: 'Rate', objectId: rate.id });
    ratePrice.set('vehicleType', { __type: 'Pointer', className: 'VehicleType', objectId: vehicleType.id });
    ratePrice.set('price', price);
    ratePrice.set('currency', 'MXN');
    ratePrice.set('active', true);
    ratePrice.set('exists', true);
    return await ratePrice.save(null, { useMasterKey: true });
  }
});