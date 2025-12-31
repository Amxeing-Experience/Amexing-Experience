/**
 * RatePrices Seed Integration Tests
 *
 * Validates seed 021-seed-rate-prices.js
 * Ensures 621 RatePrices are created correctly with valid Pointers
 *
 * NOTE: These tests run in IN-MEMORY database (MongoDB Memory Server)
 * They do NOT modify development or production databases
 */

const Parse = require('parse/node');
const TestDatabaseSeeder = require('../../helpers/testDatabaseSeeder');

describe('Seed 021: RatePrices', () => {
  beforeAll(async () => {
    // Connect to IN-MEMORY test database (port 1339)
    // This is already initialized by globalSetup.js
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';

    // Execute service data seeds before running tests
    const seeder = new TestDatabaseSeeder();
    console.log('\n🌱 Seeding service data for tests...');
    await seeder.seedServiceData();
    console.log('✅ Service data seeded\n');

    await new Promise(resolve => setTimeout(resolve, 1000));
  }, 300000);

  describe('RatePrices Count', () => {
    it('should create exactly 621 RatePrices', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(621);
    });

    it('should have all RatePrices with active=true', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.equalTo('active', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(621);
    });
  });

  describe('Pointer Validation', () => {
    it('should have valid servicePtr Pointers to Services', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include('service');
      query.limit(50);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        const servicePtr = rp.get('service');
        expect(servicePtr).toBeDefined();
        expect(servicePtr.id).toBeDefined();

        // Verify pointer can be fetched
        await servicePtr.fetch({ useMasterKey: true });
        expect(servicePtr.get('destinationPOI')).toBeDefined();
        expect(servicePtr.get('exists')).toBe(true);
      }
    });

    it('should have valid ratePtr Pointers', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include('rate');
      query.limit(50);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        const ratePtr = rp.get('rate');
        expect(ratePtr).toBeDefined();
        expect(ratePtr.id).toBeDefined();

        // Verify pointer can be fetched
        await ratePtr.fetch({ useMasterKey: true });
        expect(ratePtr.get('name')).toBeDefined();
        expect(['Premium', 'Económico', 'Green Class', 'First Class']).toContain(ratePtr.get('name'));
      }
    });

    it('should have valid vehicleTypePtr Pointers', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include('vehicleType');
      query.limit(50);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        const vehiclePtr = rp.get('vehicleType');
        expect(vehiclePtr).toBeDefined();
        expect(vehiclePtr.id).toBeDefined();

        // Verify pointer can be fetched
        await vehiclePtr.fetch({ useMasterKey: true });
        expect(vehiclePtr.get('code')).toBeDefined();
      }
    });

    it('should not have broken Pointers (all fetchable)', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include(['service', 'rate', 'vehicleType']);
      query.limit(100);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        // Try to fetch all pointers - should not throw
        const servicePtr = rp.get('service');
        const ratePtr = rp.get('rate');
        const vehiclePtr = rp.get('vehicleType');

        await expect(servicePtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
        await expect(ratePtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
        await expect(vehiclePtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
      }
    });
  });

  describe('Rate Distribution', () => {
    it('should have correct distribution for Premium rate (207 records = 69 × 3 vehicles)', async () => {
      const RateClass = Parse.Object.extend('Rate');
      const rateQuery = new Parse.Query(RateClass);
      rateQuery.equalTo('name', 'Premium');
      const premiumRate = await rateQuery.first({ useMasterKey: true });

      if (premiumRate) {
        const RatePricesClass = Parse.Object.extend('RatePrices');
        const query = new Parse.Query(RatePricesClass);
        query.equalTo('rate', premiumRate);
        query.equalTo('exists', true);

        const count = await query.count({ useMasterKey: true });
        expect(count).toBe(207); // 69 services × 3 vehicles (SEDAN, SUBURBAN, SPRINTER)
      }
    });

    it('should have correct distribution for Económico rate (138 records = 69 × 2 vehicles)', async () => {
      const RateClass = Parse.Object.extend('Rate');
      const rateQuery = new Parse.Query(RateClass);
      rateQuery.equalTo('name', 'Económico');
      const economicoRate = await rateQuery.first({ useMasterKey: true });

      if (economicoRate) {
        const RatePricesClass = Parse.Object.extend('RatePrices');
        const query = new Parse.Query(RatePricesClass);
        query.equalTo('rate', economicoRate);
        query.equalTo('exists', true);

        const count = await query.count({ useMasterKey: true });
        expect(count).toBe(138); // 69 services × 2 vehicles (SEDAN, VAN)
      }
    });

    it('should have correct distribution for Green Class rate (138 records = 69 × 2 vehicles)', async () => {
      const RateClass = Parse.Object.extend('Rate');
      const rateQuery = new Parse.Query(RateClass);
      rateQuery.equalTo('name', 'Green Class');
      const greenRate = await rateQuery.first({ useMasterKey: true });

      if (greenRate) {
        const RatePricesClass = Parse.Object.extend('RatePrices');
        const query = new Parse.Query(RatePricesClass);
        query.equalTo('rate', greenRate);
        query.equalTo('exists', true);

        const count = await query.count({ useMasterKey: true });
        expect(count).toBe(138); // 69 services × 2 vehicles (MODEL 3, MODEL Y)
      }
    });

    it('should have correct distribution for First Class rate (138 records = 69 × 2 vehicles)', async () => {
      const RateClass = Parse.Object.extend('Rate');
      const rateQuery = new Parse.Query(RateClass);
      rateQuery.equalTo('name', 'First Class');
      const firstClassRate = await rateQuery.first({ useMasterKey: true });

      if (firstClassRate) {
        const RatePricesClass = Parse.Object.extend('RatePrices');
        const query = new Parse.Query(RatePricesClass);
        query.equalTo('rate', firstClassRate);
        query.equalTo('exists', true);

        const count = await query.count({ useMasterKey: true });
        expect(count).toBe(138); // 69 services × 2 vehicles (SEDAN, SUBURBAN)
      }
    });

    it('should match expected total (207+138+138+138 = 621)', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include('rate');
      query.limit(1000);

      const allRatePrices = await query.find({ useMasterKey: true });

      const distribution = {};
      for (const rp of allRatePrices) {
        const rate = rp.get('rate');
        if (rate) {
          const rateName = rate.get('name');
          distribution[rateName] = (distribution[rateName] || 0) + 1;
        }
      }

      const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(621);
    });
  });

  describe('Required Fields', () => {
    it('should have price field in all RatePrices', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.limit(50);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        const price = rp.get('price');
        expect(price).toBeDefined();
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
      }
    });

    it('should have all required fields: service, rate, vehicleType, price, active, exists', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.limit(10);

      const ratePrices = await query.find({ useMasterKey: true });

      for (const rp of ratePrices) {
        expect(rp.get('service')).toBeDefined();
        expect(rp.get('rate')).toBeDefined();
        expect(rp.get('vehicleType')).toBeDefined();
        expect(rp.get('price')).toBeDefined();
        expect(rp.get('active')).toBe(true);
        expect(rp.get('exists')).toBe(true);
      }
    });
  });

  describe('Uniqueness', () => {
    it('should not have duplicates (same service+rate+vehicle combination)', async () => {
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const query = new Parse.Query(RatePricesClass);
      query.equalTo('exists', true);
      query.include(['service', 'rate', 'vehicleType']);
      query.limit(1000);

      const ratePrices = await query.find({ useMasterKey: true });

      // Build unique key map
      const uniqueMap = new Map();
      for (const rp of ratePrices) {
        const service = rp.get('service');
        const rate = rp.get('rate');
        const vehicle = rp.get('vehicleType');

        const uniqueKey = `${service.id}-${rate.id}-${vehicle.id}`;

        if (uniqueMap.has(uniqueKey)) {
          fail(`Duplicate RatePrice found: service=${service.id}, rate=${rate.id}, vehicle=${vehicle.id}`);
        }

        uniqueMap.set(uniqueKey, rp.id);
      }

      expect(uniqueMap.size).toBe(621);
    });
  });
});
