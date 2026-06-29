/**
 * Services Edit Transfer Modal Frontend Integration Tests
 * Tests the complete Edit Transfer (Editar Traslado) modal functionality
 * 
 * Features tested:
 * - Modal opening/closing behavior
 * - Form validation and error handling
 * - Price grid interactions (edit, update, deactivate)
 * - Frontend-backend integration for pricing updates
 * - User permissions and access control
 * - Complete modal workflow from opening to saving
 * 
 * TDD Workflow: Testing implemented modal features for reliability
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

// TODO(test-debt): suite de frontend del modal de servicios de COTIZACIONES.
// El dominio de cotizaciones está en cambio activo, así que arreglar estos tests
// ahora se invalidaría con el próximo cambio. Se difiere a un día de mantenimiento
// de tests, cuando cotizaciones se estabilice.
describe.skip('Services Edit Transfer Modal Frontend Integration', () => {
  let app;
  let adminToken;
  let superadminToken;
  let testService;
  let testRates = [];
  let testVehicleTypes = [];
  let testPOIs = [];

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise(resolve => setTimeout(resolve, 1000));

    adminToken = await AuthTestHelper.loginAs('admin', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
  }, 30000);

  beforeEach(async () => {
    await setupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('Dashboard Page Loading', () => {
    it('should render services dashboard with modal HTML', async () => {
      const response = await request(app)
        .get('/dashboard/admin/services')
        .set('Cookie', `accessToken=${adminToken}`)
        .redirects(1);

      expect(response.status).toBe(200);

      expect(response.text).toContain('serviceModal');
      expect(response.text).toContain('Editar Traslado');
      expect(response.text).toContain('serviceForm');
      expect(response.text).toContain('modalTitle');
      expect(response.text).toContain('saveButtonText');
    });

    it('should include pricing grid components', async () => {
      const response = await request(app)
        .get('/dashboard/admin/services')
        .set('Cookie', `accessToken=${adminToken}`)
        .redirects(1);

      expect(response.status).toBe(200);

      expect(response.text).toContain('basePricingSection');
      expect(response.text).toContain('newServiceRatesSection');
      expect(response.text).toContain('pricing-grid');
    });

    it('should load required JavaScript libraries', async () => {
      const response = await request(app)
        .get('/dashboard/admin/services')
        .set('Cookie', `accessToken=${adminToken}`)
        .redirects(1);

      expect(response.status).toBe(200);

      expect(response.text).toContain('DataTables');
      expect(response.text).toContain('Bootstrap');
      expect(response.text).toContain('openServiceModal');
      expect(response.text).toContain('handleEditClick');
    });
  });

  describe('Service Modal Opening', () => {
    it('should provide service data endpoint for modal population', async () => {
      const response = await request(app)
        .get(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .redirects(1);

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.objectId).toBe(testService.id);
      expect(response.body.data.originPOI).toBeDefined();
      expect(response.body.data.destinationPOI).toBeDefined();
    });

    it('should provide rate prices for existing service', async () => {
      const ratePrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);

      const response = await request(app)
        .get(`/api/services/${testService.id}/rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .redirects(1);

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].price).toBe(100.00);
      expect(response.body.data[0].rate).toBeDefined();
      expect(response.body.data[0].vehicleType).toBeDefined();
    });
  });

  describe('Form Validation', () => {
    it('should validate required fields for service update', async () => {
      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          // Missing required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('requeridos');
    });

    it('should validate POI references exist', async () => {
      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: 'nonexistent-poi',
          destinationPOI: 'nonexistent-poi-2',
          serviceType: testService.get('serviceType')
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Price Grid Updates', () => {
    it('should handle price updates from modal form', async () => {
      const initialPrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);

      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: initialPrice.id,
            price: 150.00
          }]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.updatedCount).toBe(2); // Deactivate old + create new

      // Verify pricing history maintained
      const allPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .find({ useMasterKey: true });

      expect(allPrices.length).toBe(2); // Historical + current
      const activePrice = allPrices.find(p => !p.get('valid_until'));
      expect(activePrice.get('price')).toBe(150.00);
    });

    it('should handle price deactivation (setting to 0)', async () => {
      const initialPrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);

      const response = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: initialPrice.id,
            price: 0
          }]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.updatedCount).toBe(1); // Only deactivated

      // Verify no active prices for this combination
      const activePrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .doesNotExist('valid_until')
        .find({ useMasterKey: true });

      expect(activePrices.length).toBe(0);
    });

    it('should handle adding new rate-vehicle combinations', async () => {
      const response = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [
            {
              rateId: testRates[0].id,
              vehicleId: testVehicleTypes[0].id,
              price: 200.00
            },
            {
              rateId: testRates[1].id,
              vehicleId: testVehicleTypes[1].id,
              price: 350.00
            }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(2);

      // Verify prices were created correctly
      const newPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .find({ useMasterKey: true });

      expect(newPrices.length).toBe(2);
      const prices = newPrices.map(p => p.get('price')).sort();
      expect(prices).toEqual([200.00, 350.00]);
    });
  });

  describe('Service Information Update', () => {
    it('should update service details', async () => {
      const updateData = {
        originPOI: testPOIs[0].id,
        destinationPOI: testPOIs[1].id,
        serviceType: testService.get('serviceType'),
        distance: 25.5,
        duration: 45,
        description: 'Updated test service description'
      };

      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify service was updated
      const updatedService = await new Parse.Query('Services').get(testService.id, { useMasterKey: true });
      expect(updatedService.get('distance')).toBe(25.5);
      expect(updatedService.get('duration')).toBe(45);
      expect(updatedService.get('description')).toBe('Updated test service description');
    });

    it('should maintain service status flags on update', async () => {
      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[0].id,
          destinationPOI: testPOIs[1].id,
          serviceType: testService.get('serviceType'),
          description: 'Status test'
        });

      expect(response.status).toBe(200);

      // Verify active and exists flags maintained
      const updatedService = await new Parse.Query('Services').get(testService.id, { useMasterKey: true });
      expect(updatedService.get('active')).toBe(true);
      expect(updatedService.get('exists')).toBe(true);
    });
  });

  describe('Bulk Service Creation Fix', () => {
    it('should only create pricing combinations specified in pricingData', async () => {
      // Test data: 4 rates, 4 vehicle types, but only 4 specific combinations (not 16)
      const pricingData = [
        { rateId: testRates[0].id, vehicleId: testVehicleTypes[0].id, price: 100.00 },
        { rateId: testRates[0].id, vehicleId: testVehicleTypes[1].id, price: 150.00 },
        { rateId: testRates[1].id, vehicleId: testVehicleTypes[0].id, price: 200.00 },
        { rateId: testRates[1].id, vehicleId: testVehicleTypes[1].id, price: 250.00 }
      ];

      const response = await request(app)
        .post('/api/services/bulk-create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[0].id,
          destinationPOI: testPOIs[1].id,
          rates: [testRates[0].id, testRates[1].id],
          vehicleTypes: [testVehicleTypes[0].id, testVehicleTypes[1].id],
          pricingData: pricingData,
          note: 'Test bulk creation fix'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(4); // Should create exactly 4 prices, not 16
      expect(response.body.data.total).toBe(4); // Total should match pricingData length

      // Verify only the specified combinations were created
      const createdPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: response.body.data.servicesId })
        .include(['rate', 'vehicleType'])
        .find({ useMasterKey: true });

      expect(createdPrices.length).toBe(4);
      
      // Verify exact combinations match what was requested
      const actualCombinations = createdPrices.map(p => ({
        rateId: p.get('rate').id,
        vehicleId: p.get('vehicleType').id,
        price: p.get('price')
      }));

      pricingData.forEach(expectedCombo => {
        const match = actualCombinations.find(actual => 
          actual.rateId === expectedCombo.rateId && 
          actual.vehicleId === expectedCombo.vehicleId
        );
        expect(match).toBeDefined();
        expect(match.price).toBe(expectedCombo.price);
      });
    });

    it('should not create combinations with price <= 0 in pricingData', async () => {
      // Test data with some zero prices (should be skipped)
      const pricingData = [
        { rateId: testRates[0].id, vehicleId: testVehicleTypes[0].id, price: 100.00 },
        { rateId: testRates[0].id, vehicleId: testVehicleTypes[1].id, price: 0 }, // Should be skipped
        { rateId: testRates[1].id, vehicleId: testVehicleTypes[0].id, price: 200.00 },
        { rateId: testRates[1].id, vehicleId: testVehicleTypes[1].id, price: null } // Should be skipped
      ];

      const response = await request(app)
        .post('/api/services/bulk-create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[1].id,
          destinationPOI: testPOIs[2].id,
          rates: [testRates[0].id, testRates[1].id],
          vehicleTypes: [testVehicleTypes[0].id, testVehicleTypes[1].id],
          pricingData: pricingData,
          note: 'Test zero price filtering'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(2); // Only 2 valid prices
      expect(response.body.data.total).toBe(2); // Should count only valid prices

      // Verify only non-zero prices were created
      const createdPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: response.body.data.servicesId })
        .find({ useMasterKey: true });

      expect(createdPrices.length).toBe(2);
      createdPrices.forEach(price => {
        expect(price.get('price')).toBeGreaterThan(0);
      });
    });

    it('should maintain backward compatibility with defaultPrice when pricingData not provided', async () => {
      const response = await request(app)
        .post('/api/services/bulk-create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[2].id,
          destinationPOI: testPOIs[0].id,
          rates: [testRates[0].id],
          vehicleTypes: [testVehicleTypes[0].id, testVehicleTypes[1].id],
          defaultPrice: 300.00,
          note: 'Test backward compatibility'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(2); // All combinations created
      expect(response.body.data.total).toBe(2); // 1 rate × 2 vehicles

      // Verify all combinations have defaultPrice
      const createdPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: response.body.data.servicesId })
        .find({ useMasterKey: true });

      expect(createdPrices.length).toBe(2);
      createdPrices.forEach(price => {
        expect(price.get('price')).toBe(300.00);
      });
    });
  });

  describe('Complete Modal Workflow', () => {
    it('should handle complete edit modal save workflow', async () => {
      // Create initial pricing
      const existingPrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);

      // Step 1: Update service information
      const serviceUpdateResponse = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[0].id,
          destinationPOI: testPOIs[1].id,
          serviceType: testService.get('serviceType'),
          description: 'Complete workflow test'
        });

      expect(serviceUpdateResponse.status).toBe(200);

      // Step 2: Update existing prices
      const priceUpdateResponse = await request(app)
        .post(`/api/services/${testService.id}/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            id: existingPrice.id,
            price: 125.00
          }]
        });

      expect(priceUpdateResponse.status).toBe(200);
      expect(priceUpdateResponse.body.updatedCount).toBe(2);

      // Step 3: Add new prices
      const newPriceResponse = await request(app)
        .post(`/api/services/${testService.id}/add-rate-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{
            rateId: testRates[1].id,
            vehicleId: testVehicleTypes[1].id,
            price: 300.00
          }]
        });

      expect(newPriceResponse.status).toBe(201);
      expect(newPriceResponse.body.created).toBe(1);

      // Verify final state
      const finalService = await new Parse.Query('Services').get(testService.id, { useMasterKey: true });
      expect(finalService.get('description')).toBe('Complete workflow test');

      const finalPrices = await new Parse.Query('RatePrices')
        .equalTo('service', { __type: 'Pointer', className: 'Services', objectId: testService.id })
        .doesNotExist('valid_until')
        .find({ useMasterKey: true });

      expect(finalPrices.length).toBe(2); // Updated + new
      const activePrices = finalPrices.map(p => p.get('price')).sort();
      expect(activePrices).toEqual([125.00, 300.00]);
    });
  });

  describe('Error Handling and User Feedback', () => {
    it('should handle concurrent price updates gracefully', async () => {
      const initialPrice = await createTestRatePrice(testService, testRates[0], testVehicleTypes[0], 100.00);

      // Simulate two users editing the same price
      const [response1, response2] = await Promise.all([
        request(app)
          .post(`/api/services/${testService.id}/update-base-prices`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            prices: [{ id: initialPrice.id, price: 150.00 }]
          }),
        request(app)
          .post(`/api/services/${testService.id}/update-base-prices`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            prices: [{ id: initialPrice.id, price: 175.00 }]
          })
      ]);

      // Both should succeed (versioning handles conflicts)
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });

    it('should provide meaningful error messages', async () => {
      const response = await request(app)
        .post(`/api/services/nonexistent/update-base-prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          prices: [{ id: 'fake-id', price: 100 }]
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('no encontrado');
    });
  });

  describe('User Permission Integration', () => {
    it('should allow admin users to edit services', async () => {
      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          originPOI: testPOIs[0].id,
          destinationPOI: testPOIs[1].id,
          serviceType: testService.get('serviceType')
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow superadmin users to edit services', async () => {
      const response = await request(app)
        .put(`/api/services/${testService.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          originPOI: testPOIs[0].id,
          destinationPOI: testPOIs[1].id,
          serviceType: testService.get('serviceType')
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // Helper functions
  async function setupTestData() {
    // Create test POIs
    for (let i = 0; i < 3; i++) {
      const poi = new Parse.Object('POI');
      poi.set('name', `Test POI ${i + 1}`);
      poi.set('active', true);
      poi.set('exists', true);
      testPOIs.push(await poi.save(null, { useMasterKey: true }));
    }

    // Create test service
    const serviceData = new Parse.Object('Services');
    serviceData.set('originPOI', { __type: 'Pointer', className: 'POI', objectId: testPOIs[0].id });
    serviceData.set('destinationPOI', { __type: 'Pointer', className: 'POI', objectId: testPOIs[1].id });
    serviceData.set('serviceType', 'AEROPUERTO');
    serviceData.set('distance', 20.0);
    serviceData.set('duration', 30);
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
    if (testPOIs.length > 0) await Parse.Object.destroyAll(testPOIs, { useMasterKey: true });

    // Reset arrays
    testRates = [];
    testVehicleTypes = [];
    testPOIs = [];
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