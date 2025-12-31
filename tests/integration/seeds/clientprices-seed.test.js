/**
 * ClientPrices Seed Integration Tests
 *
 * Validates seed 022-seed-client-prices.js
 * Ensures 8 sample ClientPrices and 6 client users are created correctly from CSV
 * CRITICAL: Validates users are in AmexingUser with roleId as Pointer
 *
 * NOTE: These tests run in IN-MEMORY database (MongoDB Memory Server)
 * They do NOT modify development or production databases
 */

const Parse = require('parse/node');
const TestDatabaseSeeder = require('../../helpers/testDatabaseSeeder');

describe('Seed 022: ClientPrices and Users', () => {
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

  describe('ClientPrices Count', () => {
    it('should create exactly 8 sample ClientPrices records from CSV', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(8);
    });

    it('should have all ClientPrices with active=true', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.equalTo('active', true);

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(8);
    });

    it('should have all ClientPrices with valid_until=null (current prices)', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.doesNotExist('valid_until');

      const count = await query.count({ useMasterKey: true });
      expect(count).toBe(8);
    });
  });

  describe('Client Users', () => {
    it('should have 6 unique client users (department_manager)', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      const clientUsers = users.filter(u => {
        const role = u.get('roleId');
        return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
      });

      // 6 clientes únicos en CSV
      expect(clientUsers.length).toBeGreaterThanOrEqual(6);
      expect(clientUsers.length).toBeLessThanOrEqual(7); // +1 posible test user
    });

    it('should have users in AmexingUser table (NOT _User)', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      const clientUsers = users.filter(u => {
        const role = u.get('roleId');
        return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
      });

      expect(clientUsers.length).toBeGreaterThan(0);

      // Verify they are AmexingUser instances
      for (const user of clientUsers) {
        expect(user.className).toBe('AmexingUser');
      }
    });
  });

  describe('User roleId Validation', () => {
    it('should have all users with roleId as Pointer (NOT string)', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      for (const user of users) {
        const roleId = user.get('roleId');
        expect(roleId).toBeDefined();
        expect(roleId.id).toBeDefined();

        // roleId should be a Parse.Object (Pointer), not a string
        expect(typeof roleId).toBe('object');
        expect(roleId.className).toBe('Role');

        // Should have a valid role name
        const roleName = roleId.get('name');
        expect(typeof roleName).toBe('string');
        expect(roleName).toBeDefined();
      }
    });

    it('should have department_manager users with correct Role configuration', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      const clientUsers = users.filter(u => {
        const role = u.get('roleId');
        return role && role.get('name') === 'department_manager';
      });

      for (const user of clientUsers) {
        const role = user.get('roleId');
        expect(role.get('name')).toBe('department_manager');
        expect(role.get('organization')).toBe('client');
        expect(role.get('exists')).toBe(true);
      }
    });
  });

  describe('User contextualData', () => {
    it('should have companyName in contextualData for all client users', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      const clientUsers = users.filter(u => {
        const role = u.get('roleId');
        return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
      });

      for (const user of clientUsers) {
        const contextualData = user.get('contextualData');
        expect(contextualData).toBeDefined();
        expect(contextualData.companyName).toBeDefined();
        expect(typeof contextualData.companyName).toBe('string');
        expect(contextualData.companyName.length).toBeGreaterThan(0);
      }
    });

    it('should have clientIndex in contextualData', async () => {
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const query = new Parse.Query(AmexingUserClass);
      query.include('roleId');
      query.equalTo('exists', true);

      const users = await query.find({ useMasterKey: true });

      const clientUsers = users.filter(u => {
        const role = u.get('roleId');
        return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
      });

      for (const user of clientUsers) {
        const contextualData = user.get('contextualData');
        expect(contextualData).toBeDefined();
        expect(contextualData.clientIndex).toBeDefined();
        expect(typeof contextualData.clientIndex).toBe('number');
      }
    });
  });

  describe('ClientPtr Validation', () => {
    it('should have valid clientPtr Pointers to AmexingUser', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.include('clientPtr');
      query.limit(50);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const clientPtr = cp.get('clientPtr');
        expect(clientPtr).toBeDefined();
        expect(clientPtr.id).toBeDefined();

        // Verify pointer can be fetched
        await clientPtr.fetch({ useMasterKey: true });
        expect(clientPtr.get('email')).toBeDefined();
        expect(clientPtr.className).toBe('AmexingUser');
      }
    });

    it('should have no broken clientPtr Pointers', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.include('clientPtr');
      query.limit(200);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const clientPtr = cp.get('clientPtr');
        await expect(clientPtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
      }
    });
  });

  describe('Service Pointers Validation', () => {
    it('should have valid itemId (Services ObjectId)', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.limit(50);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const itemType = cp.get('itemType');
        const itemId = cp.get('itemId');

        expect(itemType).toBe('SERVICES');
        expect(itemId).toBeDefined();
        expect(typeof itemId).toBe('string');
        expect(itemId.length).toBeGreaterThan(0);

        // Verify itemId points to valid Services record
        const ServicesClass = Parse.Object.extend('Services');
        const serviceQuery = new Parse.Query(ServicesClass);
        const service = await serviceQuery.get(itemId, { useMasterKey: true });
        expect(service).toBeDefined();
        expect(service.get('exists')).toBe(true);
      }
    });

    it('should have no broken service references', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.limit(200);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const itemId = cp.get('itemId');

        const ServicesClass = Parse.Object.extend('Services');
        const serviceQuery = new Parse.Query(ServicesClass);

        await expect(serviceQuery.get(itemId, { useMasterKey: true })).resolves.toBeDefined();
      }
    });
  });

  describe('Rate and Vehicle Pointers', () => {
    it('should have valid ratePtr Pointers', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.include('ratePtr');
      query.limit(50);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const ratePtr = cp.get('ratePtr');
        expect(ratePtr).toBeDefined();
        expect(ratePtr.id).toBeDefined();

        await ratePtr.fetch({ useMasterKey: true });
        expect(ratePtr.get('name')).toBeDefined();
      }
    });

    it('should have valid vehiclePtr Pointers', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.include('vehiclePtr');
      query.limit(50);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const vehiclePtr = cp.get('vehiclePtr');
        expect(vehiclePtr).toBeDefined();
        expect(vehiclePtr.id).toBeDefined();

        await vehiclePtr.fetch({ useMasterKey: true });
        expect(vehiclePtr.get('code')).toBeDefined();
      }
    });

    it('should have no broken ratePtr or vehiclePtr Pointers', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.include(['ratePtr', 'vehiclePtr']);
      query.limit(200);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        const ratePtr = cp.get('ratePtr');
        const vehiclePtr = cp.get('vehiclePtr');

        await expect(ratePtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
        await expect(vehiclePtr.fetch({ useMasterKey: true })).resolves.toBeDefined();
      }
    });
  });

  describe('Required Fields', () => {
    it('should have all required fields: clientPtr, itemType, itemId, ratePtr, vehiclePtr, precio', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.limit(10);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        expect(cp.get('clientPtr')).toBeDefined();
        expect(cp.get('itemType')).toBe('SERVICES');
        expect(cp.get('itemId')).toBeDefined();
        expect(cp.get('ratePtr')).toBeDefined();
        expect(cp.get('vehiclePtr')).toBeDefined();
        expect(cp.get('precio')).toBeDefined();
        expect(typeof cp.get('precio')).toBe('number');
        expect(cp.get('precio')).toBeGreaterThan(0);
      }
    });

    it('should have currency field set to MXN', async () => {
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const query = new Parse.Query(ClientPricesClass);
      query.equalTo('exists', true);
      query.limit(50);

      const clientPrices = await query.find({ useMasterKey: true });

      for (const cp of clientPrices) {
        expect(cp.get('currency')).toBe('MXN');
      }
    });
  });

  describe('Dashboard Query Compatibility', () => {
    it('should match dashboard query (users visible in /dashboard/admin/clients)', async () => {
      // Simulate dashboard query
      const RoleClass = Parse.Object.extend('Role');
      const roleQuery = new Parse.Query(RoleClass);
      roleQuery.equalTo('name', 'department_manager');
      roleQuery.equalTo('organization', 'client');
      roleQuery.equalTo('exists', true);

      const role = await roleQuery.first({ useMasterKey: true });
      expect(role).toBeDefined();

      // Get users that dashboard would show
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const usersQuery = new Parse.Query(AmexingUserClass);
      usersQuery.equalTo('roleId', role);
      usersQuery.equalTo('exists', true);

      const dashboardUsers = await usersQuery.find({ useMasterKey: true });

      expect(dashboardUsers.length).toBeGreaterThanOrEqual(6);
      expect(dashboardUsers.length).toBeLessThanOrEqual(7);

      // Verify each user has companyName for display
      for (const user of dashboardUsers) {
        const contextual = user.get('contextualData');
        expect(contextual.companyName).toBeDefined();
      }
    });
  });
});
