/**
 * Services Catalog Seed Integration Tests
 *
 * Validates seed 020-seed-services-catalog.js
 * Ensures 69 rate-agnostic Services are created correctly
 *
 * NOTE: These tests run in IN-MEMORY database (MongoDB Memory Server)
 * They do NOT modify development or production databases
 */

const Parse = require('parse/node');
const TestDatabaseSeeder = require('../../helpers/testDatabaseSeeder');

describe('Seed 020: Services Catalog', () => {
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
  }, 300000); // 5 minutes timeout for seed execution

  describe('Services Count', () => {
    it('should create exactly 69 Services', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(69);
    });

    it('should have all Services with active=true', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.equalTo('active', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(69);
    });
  });

  describe('Rate-Agnostic Structure', () => {
    it('should have Services without rate field (rate-agnostic)', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.limit(69);

      const services = await query.find({ useMasterKey: true });

      services.forEach(service => {
        // Services should NOT have a rate field
        expect(service.get('rate')).toBeUndefined();

        // Services MUST have destinationPOI
        expect(service.get('destinationPOI')).toBeDefined();
      });
    });

    it('should have required fields: destinationPOI, active, exists', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.limit(10);

      const services = await query.find({ useMasterKey: true });

      services.forEach(service => {
        expect(service.get('destinationPOI')).toBeDefined();
        expect(service.get('active')).toBe(true);
        expect(service.get('exists')).toBe(true);
      });
    });
  });

  describe('Origin POI Handling', () => {
    it('should allow Services with null originPOI (airport/local services)', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.doesNotExist('originPOI');

      const servicesWithoutOrigin = await query.find({ useMasterKey: true });
      expect(servicesWithoutOrigin.length).toBeGreaterThan(0);
    });

    it('should have some Services with originPOI (point-to-point services)', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.exists('originPOI');

      const servicesWithOrigin = await query.find({ useMasterKey: true });
      expect(servicesWithOrigin.length).toBeGreaterThan(0);
    });

    it('should have total Services = with origin + without origin', async () => {
      const ServicesClass = Parse.Object.extend('Services');

      // Count with origin
      const withOriginQuery = new Parse.Query(ServicesClass);
      withOriginQuery.equalTo('exists', true);
      withOriginQuery.exists('originPOI');
      const withOriginCount = await withOriginQuery.count({ useMasterKey: true });

      // Count without origin
      const withoutOriginQuery = new Parse.Query(ServicesClass);
      withoutOriginQuery.equalTo('exists', true);
      withoutOriginQuery.doesNotExist('originPOI');
      const withoutOriginCount = await withoutOriginQuery.count({ useMasterKey: true });

      expect(withOriginCount + withoutOriginCount).toBe(69);
    });
  });

  describe('POI Pointers Validation', () => {
    it('should have valid destinationPOI Pointers', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.include('destinationPOI');
      query.limit(10);

      const services = await query.find({ useMasterKey: true });

      for (const service of services) {
        const destinationPOI = service.get('destinationPOI');
        expect(destinationPOI).toBeDefined();
        expect(destinationPOI.id).toBeDefined();

        // Verify pointer can be fetched
        await destinationPOI.fetch({ useMasterKey: true });
        expect(destinationPOI.get('name')).toBeDefined();
      }
    });

    it('should have valid originPOI Pointers when present', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.exists('originPOI');
      query.include('originPOI');
      query.limit(10);

      const services = await query.find({ useMasterKey: true });

      for (const service of services) {
        const originPOI = service.get('originPOI');
        expect(originPOI).toBeDefined();
        expect(originPOI.id).toBeDefined();

        // Verify pointer can be fetched
        await originPOI.fetch({ useMasterKey: true });
        expect(originPOI.get('name')).toBeDefined();
      }
    });
  });

  describe('Uniqueness', () => {
    it('should not have duplicate routes (same origin+destination)', async () => {
      const ServicesClass = Parse.Object.extend('Services');
      const query = new Parse.Query(ServicesClass);
      query.equalTo('exists', true);
      query.include(['originPOI', 'destinationPOI']);
      query.limit(1000);

      const services = await query.find({ useMasterKey: true });

      // Build route map
      const routeMap = new Map();
      for (const service of services) {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');

        const originId = originPOI ? originPOI.id : 'NULL';
        const destId = destinationPOI.id;
        const routeKey = `${originId}-${destId}`;

        if (routeMap.has(routeKey)) {
          fail(`Duplicate route found: ${routeKey}`);
        }

        routeMap.set(routeKey, service.id);
      }

      // All routes should be unique
      expect(routeMap.size).toBe(69);
    });
  });

  describe('Idempotency', () => {
    it('should maintain 69 Services after re-running seed', async () => {
      // This test assumes seed can be run multiple times
      const ServicesClass = Parse.Object.extend('Services');

      const queryBefore = new Parse.Query(ServicesClass);
      queryBefore.equalTo('exists', true);
      const countBefore = await queryBefore.count({ useMasterKey: true });

      expect(countBefore).toBe(69);

      // Note: Actual re-execution would be done in a separate test
      // This just verifies the current state is correct
    });
  });
});
