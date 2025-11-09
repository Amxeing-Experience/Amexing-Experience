/**
 * Parse Platform Connection Validation Test
 * Tests basic connectivity with real development database
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');
const CleanupHelpers = require('../helpers/cleanup-helpers');

describe('Parse Platform Connection Validation', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;
  let cleanup;

  beforeAll(async () => {
    // Initialize test environment
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();

    // Initialize helpers
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();
    cleanup = new CleanupHelpers();

    // Validate Parse Server is ready
    await parseSetup.waitForParseServer(30000);
  });

  afterAll(async () => {
    // Clean up test data
    if (dataFactory) {
      await dataFactory.cleanup();
    }
    if (cleanup) {
      await cleanup.processCleanupQueue();
    }
  });

  describe('Basic Parse Server Connectivity', () => {
    test('should connect to Parse Server successfully', async () => {
      expect(parseSetup.isInitialized).toBe(true);

      const config = parseSetup.getTestConfig();
      expect(config.appId).toBeDefined();
      expect(config.serverURL).toBeDefined();
      expect(config.masterKey).toBeDefined();
    });

    test('should validate Parse Server connection', async () => {
      await expect(parseSetup.validateConnection()).resolves.not.toThrow();
    });

    test('should have correct environment configuration', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.PARSE_PLATFORM_TEST_MODE).toBe('true');
      expect(process.env.PARSE_PLATFORM_TEST_PREFIX).toBe('ParseTest_');
    });
  });

  describe('Parse Object Operations', () => {
    test('should create a test object successfully', async () => {
      const testObj = parseSetup.createTestObject('TestConnection', {
        name: 'Connection Test',
        value: 'test-value'
      });

      expect(testObj).toBeInstanceOf(Parse.Object);
      expect(testObj.get('name')).toBe('Connection Test');
      expect(testObj.get('testMetadata')).toBeDefined();
      expect(testObj.get('testMetadata').testId).toBeDefined();
    });

    test('should save and retrieve a test object', async () => {
      const originalObj = await parseSetup.createAndSaveTestObject('TestConnection', {
        name: 'Save Test',
        value: 42,
        active: true
      });

      expect(originalObj.id).toBeDefined();
      expect(originalObj.get('name')).toBe('Save Test');
      expect(originalObj.get('value')).toBe(42);
      expect(originalObj.get('active')).toBe(true);

      // Retrieve the object
      const TestClass = Parse.Object.extend('ParseTest_TestConnection');
      const query = new Parse.Query(TestClass);
      const retrievedObj = await query.get(originalObj.id, { useMasterKey: true });

      expect(retrievedObj.id).toBe(originalObj.id);
      expect(retrievedObj.get('name')).toBe('Save Test');
      expect(retrievedObj.get('value')).toBe(42);

      // Clean up
      await originalObj.destroy({ useMasterKey: true });
    });

    test('should update a test object', async () => {
      const testObj = await parseSetup.createAndSaveTestObject('TestConnection', {
        name: 'Update Test',
        counter: 1
      });

      const originalId = testObj.id;

      // Update the object
      testObj.set('name', 'Updated Name');
      testObj.set('counter', 2);
      const updatedObj = await testObj.save(null, { useMasterKey: true });

      expect(updatedObj.id).toBe(originalId);
      expect(updatedObj.get('name')).toBe('Updated Name');
      expect(updatedObj.get('counter')).toBe(2);

      // Clean up
      await updatedObj.destroy({ useMasterKey: true });
    });

    test('should delete a test object', async () => {
      const testObj = await parseSetup.createAndSaveTestObject('TestConnection', {
        name: 'Delete Test'
      });

      const objectId = testObj.id;

      // Delete the object
      await testObj.destroy({ useMasterKey: true });

      // Verify it's deleted
      const TestClass = Parse.Object.extend('ParseTest_TestConnection');
      const query = new Parse.Query(TestClass);

      await expect(query.get(objectId, { useMasterKey: true }))
        .rejects.toThrow(); // Should throw because object doesn't exist
    });
  });

  describe('Parse Query Operations', () => {
    let testObjects = [];

    beforeEach(async () => {
      // Create test objects for querying
      testObjects = await dataFactory.createMultiple('TestQuery', 5, (index) => ({
        name: `Query Test ${index}`,
        index: index,
        category: index % 2 === 0 ? 'even' : 'odd',
        active: index < 3
      }));
    });

    afterEach(async () => {
      // Clean up test objects
      for (const obj of testObjects) {
        try {
          await obj.destroy({ useMasterKey: true });
        } catch (error) {
          // Object might already be deleted
        }
      }
      testObjects = [];
    });

    test('should query all test objects', async () => {
      const objects = await testHelpers.queryTestObjects('TestQuery');
      expect(objects.length).toBeGreaterThanOrEqual(5);

      // Verify they all have test metadata
      objects.forEach(obj => {
        expect(obj.get('testMetadata')).toBeDefined();
      });
    });

    test('should query with filters', async () => {
      const evenObjects = await testHelpers.queryTestObjects('TestQuery', {
        category: 'even'
      });

      expect(evenObjects.length).toBeGreaterThanOrEqual(2);
      evenObjects.forEach(obj => {
        expect(obj.get('category')).toBe('even');
      });
    });

    test('should query with complex filters', async () => {
      const activeObjects = await testHelpers.queryTestObjects('TestQuery', {
        active: true,
        category: 'odd'
      });

      expect(activeObjects.length).toBeGreaterThanOrEqual(1);
      activeObjects.forEach(obj => {
        expect(obj.get('active')).toBe(true);
        expect(obj.get('category')).toBe('odd');
      });
    });

    test('should count objects', async () => {
      const TestClass = Parse.Object.extend('ParseTest_TestQuery');
      const query = new Parse.Query(TestClass);
      query.exists('testMetadata');

      const count = await query.count({ useMasterKey: true });
      expect(count).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Parse Schema Operations', () => {
    test('should create a test schema', async () => {
      const schema = await parseSetup.createTestSchema('SchemaTest', {
        name: 'String',
        value: 'Number',
        active: 'Boolean',
        metadata: 'Object'
      });

      expect(schema).toBeDefined();
    });

    test('should handle existing schema gracefully', async () => {
      // Create schema first time
      const schema1 = await parseSetup.createTestSchema('SchemaExisting', {
        name: 'String'
      });

      // Try to create it again - should not throw
      const schema2 = await parseSetup.createTestSchema('SchemaExisting', {
        name: 'String',
        value: 'Number' // Additional field
      });

      expect(schema1).toBeDefined();
      expect(schema2).toBeDefined();
    });
  });

  describe('Test Data Factory Integration', () => {
    test('should create AmexingUser test data', async () => {
      const user = await dataFactory.createAmexingUser({
        email: 'connection.test@amexing-test.com',
        username: 'connection_test_user'
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.get('email')).toBe('connection.test@amexing-test.com');
      expect(user.get('username')).toBe('connection_test_user');
      expect(user.get('testMetadata')).toBeDefined();
    });

    test('should create Event test data', async () => {
      const event = await dataFactory.createEvent({
        title: 'Connection Test Event'
      });

      expect(event).toBeDefined();
      expect(event.id).toBeDefined();
      expect(event.get('title')).toBe('Connection Test Event');
      expect(event.get('testMetadata')).toBeDefined();
    });

    test('should create multiple related objects', async () => {
      const relatedObjects = await dataFactory.createRelatedObjects();

      expect(relatedObjects.user).toBeDefined();
      expect(relatedObjects.event).toBeDefined();
      expect(relatedObjects.notification).toBeDefined();
      expect(relatedObjects.role).toBeDefined();

      // Verify relationships
      expect(relatedObjects.event.get('createdBy')).toBe(relatedObjects.user.id);
      expect(relatedObjects.notification.get('userId')).toBe(relatedObjects.user.id);
    });
  });

  describe('Performance Validation', () => {
    test('should handle bulk operations efficiently', async () => {
      const startTime = Date.now();

      // Create 20 objects in bulk
      const objects = await dataFactory.createMultiple('PerformanceTest', 20);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(objects.length).toBe(20);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify all objects were created
      objects.forEach(obj => {
        expect(obj.id).toBeDefined();
        expect(obj.get('testMetadata')).toBeDefined();
      });
    });

    test('should perform query operations efficiently', async () => {
      // Create test data
      await dataFactory.createMultiple('QueryPerformance', 50);

      const startTime = Date.now();

      // Query the objects
      const objects = await testHelpers.queryTestObjects('QueryPerformance');

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(objects.length).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid object creation gracefully', async () => {
      // Try to create object with invalid class name
      await expect(async () => {
        const InvalidClass = Parse.Object.extend(''); // Empty class name
        const obj = new InvalidClass();
        await obj.save(null, { useMasterKey: true });
      }).rejects.toThrow();
    });

    test('should handle query errors gracefully', async () => {
      // Query non-existent object
      const TestClass = Parse.Object.extend('ParseTest_NonExistent');
      const query = new Parse.Query(TestClass);

      await expect(query.get('invalid-id', { useMasterKey: true }))
        .rejects.toThrow();
    });

    test('should handle cleanup errors gracefully', async () => {
      // Try to clean up non-existent object
      const result = await cleanup.cleanupObject('NonExistent', 'invalid-id');
      expect(result).toBe(true); // Should return true for non-existent objects
    });
  });

  describe('Test Isolation', () => {
    test('should use test prefix for all test objects', () => {
      const testObj = parseSetup.createTestObject('IsolationTest', {
        name: 'test'
      });

      expect(testObj.className).toBe('ParseTest_IsolationTest');
    });

    test('should only query test objects with metadata', async () => {
      // Create a regular Parse object without test metadata (simulate real data)
      const RegularClass = Parse.Object.extend('ParseTest_RegularObject');
      const regularObj = new RegularClass();
      regularObj.set('name', 'regular');
      await regularObj.save(null, { useMasterKey: true });

      // Create a test object
      const testObj = await parseSetup.createAndSaveTestObject('RegularObject', {
        name: 'test'
      });

      // Query should only return test objects
      const testObjects = await testHelpers.queryTestObjects('RegularObject');

      expect(testObjects.length).toBe(1);
      expect(testObjects[0].id).toBe(testObj.id);
      expect(testObjects[0].get('testMetadata')).toBeDefined();

      // Clean up
      await regularObj.destroy({ useMasterKey: true });
      await testObj.destroy({ useMasterKey: true });
    });
  });
});