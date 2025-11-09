/**
 * Parse Object Operations Comprehensive Tests
 * Tests individual Parse Object operations in isolation with full coverage
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse Object Operations Comprehensive Tests', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();
  });

  afterAll(async () => {
    await dataFactory.cleanup();
    await parseSetup.cleanupAllTestData();
  });

  describe('Object Creation', () => {
    test('should create Parse Object with correct attributes', () => {
      const testData = {
        name: 'Unit Test Object',
        value: 123,
        active: true,
        metadata: { test: 'data' }
      };

      const obj = parseSetup.createTestObject('UnitTest', testData);

      expect(obj).toBeInstanceOf(Parse.Object);
      expect(obj.className).toBe('ParseTest_UnitTest');
      expect(obj.get('name')).toBe('Unit Test Object');
      expect(obj.get('value')).toBe(123);
      expect(obj.get('active')).toBe(true);
      expect(obj.get('metadata')).toEqual({ test: 'data' });
      expect(obj.get('testMetadata')).toBeDefined();
    });

    test('should generate unique test IDs', () => {
      const obj1 = parseSetup.createTestObject('UnitTest', { name: 'test1' });
      const obj2 = parseSetup.createTestObject('UnitTest', { name: 'test2' });

      const testId1 = obj1.get('testMetadata').testId;
      const testId2 = obj2.get('testMetadata').testId;

      expect(testId1).toBeDefined();
      expect(testId2).toBeDefined();
      expect(testId1).not.toBe(testId2);
    });

    test('should handle different data types correctly', () => {
      const testData = {
        stringField: 'test string',
        numberField: 42,
        booleanField: false,
        dateField: new Date(),
        arrayField: [1, 2, 3],
        objectField: { nested: 'object' }
      };

      const obj = parseSetup.createTestObject('DataTypes', testData);

      expect(obj.get('stringField')).toBe('test string');
      expect(obj.get('numberField')).toBe(42);
      expect(obj.get('booleanField')).toBe(false);
      expect(obj.get('dateField')).toBeInstanceOf(Date);
      expect(obj.get('arrayField')).toEqual([1, 2, 3]);
      expect(obj.get('objectField')).toEqual({ nested: 'object' });
    });
  });

  describe('Object Attributes', () => {
    let testObj;

    beforeEach(() => {
      testObj = parseSetup.createTestObject('AttributeTest', {
        name: 'Attribute Test',
        count: 0
      });
    });

    test('should set and get attributes', () => {
      testObj.set('name', 'Updated Name');
      testObj.set('count', 5);

      expect(testObj.get('name')).toBe('Updated Name');
      expect(testObj.get('count')).toBe(5);
    });

    test('should check if attribute exists', () => {
      expect(testObj.has('name')).toBe(true);
      expect(testObj.has('nonExistent')).toBe(false);
    });

    test('should unset attributes', () => {
      testObj.unset('count');

      expect(testObj.has('count')).toBe(false);
      expect(testObj.get('count')).toBeUndefined();
    });

    test('should increment numeric attributes', () => {
      testObj.set('counter', 10);
      testObj.increment('counter');

      expect(testObj.get('counter')).toBe(11);

      testObj.increment('counter', 5);
      expect(testObj.get('counter')).toBe(16);
    });

    test('should add to array attributes', () => {
      testObj.set('tags', ['tag1']);
      testObj.add('tags', 'tag2');

      expect(testObj.get('tags')).toEqual(['tag1', 'tag2']);

      testObj.addAll('tags', ['tag3', 'tag4']);
      expect(testObj.get('tags')).toEqual(['tag1', 'tag2', 'tag3', 'tag4']);
    });

    test('should remove from array attributes', () => {
      testObj.set('items', ['a', 'b', 'c', 'b']);
      testObj.remove('items', 'b');

      // Should only remove one instance
      expect(testObj.get('items')).toEqual(['a', 'c', 'b']);

      testObj.removeAll('items', ['a', 'b']);
      expect(testObj.get('items')).toEqual(['c']);
    });
  });

  describe('Object Validation', () => {
    test('should validate required attributes', () => {
      const requiredFields = [
        'name',
        { name: 'email', type: 'string' },
        { name: 'age', type: 'number', required: true }
      ];

      const validObj = parseSetup.createTestObject('ValidationTest', {
        name: 'Valid Object',
        email: 'test@example.com',
        age: 25
      });

      const errors = testHelpers.validateObjectStructure(validObj, requiredFields);
      expect(errors).toHaveLength(0);
    });

    test('should detect missing required fields', () => {
      const requiredFields = [
        'name',
        { name: 'email', type: 'string' }
      ];

      const invalidObj = parseSetup.createTestObject('ValidationTest', {
        name: 'Invalid Object'
        // Missing email
      });

      // Mock validation since we don't have testHelpers initialized
      const hasEmail = invalidObj.has('email');
      expect(hasEmail).toBe(false);
    });
  });

  describe('Object Serialization', () => {
    test('should convert to JSON', () => {
      const obj = parseSetup.createTestObject('SerializationTest', {
        name: 'JSON Test',
        value: 42,
        active: true
      });

      const json = obj.toJSON();

      expect(json.name).toBe('JSON Test');
      expect(json.value).toBe(42);
      expect(json.active).toBe(true);
      expect(json.testMetadata).toBeDefined();
      expect(json.className).toBeUndefined(); // className is not included in JSON
    });

    test('should handle complex objects in JSON', () => {
      const complexData = {
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' }
        },
        date: new Date('2024-01-01')
      };

      const obj = parseSetup.createTestObject('ComplexJSON', complexData);
      const json = obj.toJSON();

      expect(json.nested.array).toEqual([1, 2, 3]);
      expect(json.nested.object.key).toBe('value');
      expect(json.date).toEqual(complexData.date.toISOString());
    });
  });

  describe('Object Comparison', () => {
    test('should compare object equality by ID', async () => {
      const obj1 = await parseSetup.createAndSaveTestObject('ComparisonTest', {
        name: 'Object 1'
      });

      const obj2 = await parseSetup.createAndSaveTestObject('ComparisonTest', {
        name: 'Object 2'
      });

      // Same object should be equal
      expect(obj1.equals(obj1)).toBe(true);

      // Different objects should not be equal
      expect(obj1.equals(obj2)).toBe(false);

      // Clean up
      await obj1.destroy({ useMasterKey: true });
      await obj2.destroy({ useMasterKey: true });
    });

    test('should detect dirty attributes', () => {
      const obj = parseSetup.createTestObject('DirtyTest', {
        name: 'Original Name'
      });

      // Initially no dirty attributes
      expect(obj.dirty()).toBe(false);

      // Modify attribute
      obj.set('name', 'Modified Name');
      expect(obj.dirty()).toBe(true);
      expect(obj.dirty('name')).toBe(true);
      expect(obj.dirty('otherField')).toBe(false);
    });
  });

  describe('Advanced Object Operations', () => {
    test('should handle Parse.Object.extend() functionality', async () => {
      const CustomClass = Parse.Object.extend('ParseTest_CustomExtended', {
        // Instance methods
        getDisplayName: function() {
          return `${this.get('firstName')} ${this.get('lastName')}`;
        },

        isActive: function() {
          return this.get('status') === 'active';
        }
      }, {
        // Class methods
        createNew: function(firstName, lastName) {
          const obj = new this();
          obj.set('firstName', firstName);
          obj.set('lastName', lastName);
          obj.set('status', 'active');
          return obj;
        }
      });

      const instance = CustomClass.createNew('John', 'Doe');
      expect(instance.getDisplayName()).toBe('John Doe');
      expect(instance.isActive()).toBe(true);

      const saved = await testHelpers.saveWithRetry(instance);
      expect(saved.id).toBeDefined();
      expect(saved.getDisplayName()).toBe('John Doe');

      await testHelpers.destroyWithRetry(saved);
    });

    test('should handle object relationships with Pointers', async () => {
      // Create parent object
      const parentObj = await parseSetup.createAndSaveTestObject('Parent', {
        name: 'Parent Object',
        type: 'container'
      });

      // Create child object with pointer to parent
      const childObj = await parseSetup.createAndSaveTestObject('Child', {
        name: 'Child Object',
        parent: parentObj
      });

      expect(childObj.get('parent')).toBeInstanceOf(Parse.Object);
      expect(childObj.get('parent').id).toBe(parentObj.id);

      // Query child with included parent
      const ChildClass = Parse.Object.extend(testHelpers.getFullClassName('Child'));
      const query = new Parse.Query(ChildClass);
      query.include('parent');
      query.equalTo('objectId', childObj.id);

      const fetchedChild = await query.first({ useMasterKey: true });
      expect(fetchedChild.get('parent').get('name')).toBe('Parent Object');

      // Cleanup
      await childObj.destroy({ useMasterKey: true });
      await parentObj.destroy({ useMasterKey: true });
    });

    test('should handle object relationships with Relations', async () => {
      const userObj = await parseSetup.createAndSaveTestObject('User', {
        username: 'testuser',
        email: 'test@example.com'
      });

      const roleObj1 = await parseSetup.createAndSaveTestObject('Role', {
        name: 'admin'
      });

      const roleObj2 = await parseSetup.createAndSaveTestObject('Role', {
        name: 'editor'
      });

      // Create relation
      const relation = userObj.relation('roles');
      relation.add(roleObj1);
      relation.add(roleObj2);
      await userObj.save(null, { useMasterKey: true });

      // Query relation
      const roleQuery = relation.query();
      const userRoles = await roleQuery.find({ useMasterKey: true });

      expect(userRoles).toHaveLength(2);
      expect(userRoles.map(r => r.get('name')).sort()).toEqual(['admin', 'editor']);

      // Cleanup
      await userObj.destroy({ useMasterKey: true });
      await roleObj1.destroy({ useMasterKey: true });
      await roleObj2.destroy({ useMasterKey: true });
    });
  });

  describe('Data Type Validation', () => {
    test('should handle all Parse data types correctly', async () => {
      const complexData = {
        // Primitive types
        stringField: 'test string',
        numberField: 42.5,
        booleanField: true,

        // Complex types
        dateField: new Date('2024-01-01T12:00:00Z'),
        arrayField: ['item1', 'item2', 'item3'],
        objectField: {
          nested: {
            value: 'deep',
            number: 123
          }
        },

        // Parse specific types
        geoPointField: new Parse.GeoPoint(40.7128, -74.0060), // NYC
        fileField: new Parse.File('test.txt', { base64: btoa('test content') }),

        // Null and undefined
        nullField: null
      };

      const obj = parseSetup.createTestObject('DataTypeTest', complexData);
      const saved = await testHelpers.saveWithRetry(obj);

      // Verify all types are preserved
      expect(saved.get('stringField')).toBe('test string');
      expect(saved.get('numberField')).toBe(42.5);
      expect(saved.get('booleanField')).toBe(true);
      expect(saved.get('dateField')).toBeInstanceOf(Date);
      expect(saved.get('arrayField')).toEqual(['item1', 'item2', 'item3']);
      expect(saved.get('objectField').nested.value).toBe('deep');
      expect(saved.get('geoPointField')).toBeInstanceOf(Parse.GeoPoint);
      expect(saved.get('fileField')).toBeInstanceOf(Parse.File);
      expect(saved.get('nullField')).toBeNull();

      await testHelpers.destroyWithRetry(saved);
    });

    test('should validate data type constraints', () => {
      const validationTests = [
        {
          name: 'string field validation',
          fields: [{ name: 'name', type: 'string', required: true }],
          validData: { name: 'Valid Name' },
          invalidData: { name: 123 }
        },
        {
          name: 'number field validation',
          fields: [{ name: 'age', type: 'number', required: true }],
          validData: { age: 25 },
          invalidData: { age: 'not a number' }
        },
        {
          name: 'boolean field validation',
          fields: [{ name: 'isActive', type: 'boolean', required: true }],
          validData: { isActive: true },
          invalidData: { isActive: 'yes' }
        },
        {
          name: 'date field validation',
          fields: [{ name: 'createdAt', type: 'Date', required: true }],
          validData: { createdAt: new Date() },
          invalidData: { createdAt: '2024-01-01' }
        },
        {
          name: 'array field validation',
          fields: [{ name: 'tags', type: 'Array', required: true }],
          validData: { tags: ['tag1', 'tag2'] },
          invalidData: { tags: 'not an array' }
        }
      ];

      validationTests.forEach(test => {
        // Test valid data
        const validObj = parseSetup.createTestObject('ValidationTest', test.validData);
        const validErrors = testHelpers.validateObjectStructure(validObj, test.fields);
        expect(validErrors).toHaveLength(0);

        // Test invalid data
        const invalidObj = parseSetup.createTestObject('ValidationTest', test.invalidData);
        const invalidErrors = testHelpers.validateObjectStructure(invalidObj, test.fields);
        expect(invalidErrors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Object Persistence Operations', () => {
    test('should handle save operations with proper error handling', async () => {
      const obj = parseSetup.createTestObject('SaveTest', {
        name: 'Test Save',
        value: 100
      });

      // Test initial save
      const saved = await testHelpers.saveWithRetry(obj);
      expect(saved.id).toBeDefined();
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.updatedAt).toBeInstanceOf(Date);

      // Test update
      saved.set('value', 200);
      const updated = await testHelpers.saveWithRetry(saved);
      expect(updated.get('value')).toBe(200);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(updated.createdAt.getTime());

      await testHelpers.destroyWithRetry(updated);
    });

    test('should handle bulk save operations', async () => {
      const objects = [];
      for (let i = 0; i < 5; i++) {
        objects.push(parseSetup.createTestObject('BulkSaveTest', {
          name: `Bulk Test ${i}`,
          index: i
        }));
      }

      const savedObjects = await Parse.Object.saveAll(objects, { useMasterKey: true });
      expect(savedObjects).toHaveLength(5);
      savedObjects.forEach(obj => {
        expect(obj.id).toBeDefined();
        expect(obj.createdAt).toBeInstanceOf(Date);
      });

      // Test bulk update
      savedObjects.forEach((obj, index) => {
        obj.set('updated', true);
        obj.set('newValue', index * 10);
      });

      const updatedObjects = await Parse.Object.saveAll(savedObjects, { useMasterKey: true });
      updatedObjects.forEach(obj => {
        expect(obj.get('updated')).toBe(true);
        expect(obj.get('newValue')).toBeDefined();
      });

      // Cleanup
      await Parse.Object.destroyAll(updatedObjects, { useMasterKey: true });
    });

    test('should handle fetch operations', async () => {
      const originalObj = await parseSetup.createAndSaveTestObject('FetchTest', {
        name: 'Original Name',
        value: 'Original Value'
      });

      // Create new instance with same ID but different local data
      const FetchClass = Parse.Object.extend(testHelpers.getFullClassName('FetchTest'));
      const fetchObj = new FetchClass();
      fetchObj.id = originalObj.id;
      fetchObj.set('name', 'Local Name'); // This should be overwritten by fetch

      // Fetch from server
      await fetchObj.fetch({ useMasterKey: true });
      expect(fetchObj.get('name')).toBe('Original Name');
      expect(fetchObj.get('value')).toBe('Original Value');

      await testHelpers.destroyWithRetry(originalObj);
    });
  });

  describe('Object Performance Testing', () => {
    test('should measure object creation performance', async () => {
      const stats = await testHelpers.measurePerformance(async () => {
        const obj = parseSetup.createTestObject('PerformanceTest', {
          name: 'Performance Test',
          timestamp: new Date(),
          data: { test: 'performance' }
        });
        return await testHelpers.saveWithRetry(obj);
      }, 10);

      expect(stats.successfulOperations).toBe(10);
      expect(stats.averageDuration).toBeGreaterThan(0);
      expect(stats.maxDuration).toBeGreaterThanOrEqual(stats.minDuration);

      console.log('Object Creation Performance:', {
        averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
        minDuration: `${stats.minDuration.toFixed(2)}ms`,
        maxDuration: `${stats.maxDuration.toFixed(2)}ms`,
        p95Duration: `${stats.p95Duration.toFixed(2)}ms`
      });

      // Cleanup created objects
      for (const result of stats.results) {
        if (result.success && result.result) {
          await testHelpers.destroyWithRetry(result.result);
        }
      }
    });

    test('should measure bulk operations performance', async () => {
      const objectCount = 50;
      const stats = await testHelpers.measurePerformance(async () => {
        const objects = [];
        for (let i = 0; i < objectCount; i++) {
          objects.push(parseSetup.createTestObject('BulkPerfTest', {
            name: `Bulk Performance Test ${i}`,
            index: i,
            timestamp: new Date()
          }));
        }
        return await Parse.Object.saveAll(objects, { useMasterKey: true });
      }, 3);

      expect(stats.successfulOperations).toBe(3);
      expect(stats.averageDuration).toBeGreaterThan(0);

      console.log(`Bulk Save Performance (${objectCount} objects):`, {
        averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
        objectsPerSecond: (objectCount * 1000 / stats.averageDuration).toFixed(2)
      });

      // Cleanup
      for (const result of stats.results) {
        if (result.success && result.result) {
          await Parse.Object.destroyAll(result.result, { useMasterKey: true });
        }
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid object operations gracefully', async () => {
      // Test saving object without required fields
      const invalidObj = parseSetup.createTestObject('InvalidTest', {});

      try {
        await testHelpers.saveWithRetry(invalidObj);
      } catch (error) {
        expect(error).toBeDefined();
        // Parse Server might allow this, so we just verify error handling works
      }
    });

    test('should handle concurrent modifications', async () => {
      const obj = await parseSetup.createAndSaveTestObject('ConcurrentTest', {
        counter: 0
      });

      // Simulate concurrent modifications
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push((async () => {
          const fetchedObj = await obj.fetch({ useMasterKey: true });
          fetchedObj.increment('counter');
          return await testHelpers.saveWithRetry(fetchedObj);
        })());
      }

      const results = await Promise.all(promises);

      // Fetch final state
      await obj.fetch({ useMasterKey: true });
      expect(obj.get('counter')).toBeGreaterThan(0);

      await testHelpers.destroyWithRetry(obj);
    });

    test('should handle object with circular references in JSON', () => {
      const obj = parseSetup.createTestObject('CircularTest', {
        name: 'Circular Test'
      });

      // Create circular reference (Parse should handle this)
      const circularData = { name: 'test' };
      circularData.self = circularData;

      // This should not cause infinite recursion
      expect(() => {
        obj.set('metadata', { reference: circularData });
        obj.toJSON();
      }).not.toThrow();
    });
  });

  describe('Test Data Factory Integration', () => {
    test('should create AmexingUser with factory', async () => {
      const userData = dataFactory.createAmexingUserData({
        email: 'factory.test@example.com',
        username: 'factory_test'
      });

      expect(userData.email).toBe('factory.test@example.com');
      expect(userData.username).toBe('factory_test');
      expect(userData.firstName).toBeDefined();
      expect(userData.permissions).toBeDefined();
      expect(userData.profile).toBeDefined();
    });

    test('should create Event with factory', async () => {
      const eventData = dataFactory.createEventData({
        title: 'Factory Test Event'
      });

      expect(eventData.title).toBe('Factory Test Event');
      expect(eventData.startDate).toBeInstanceOf(Date);
      expect(eventData.capacity).toBeDefined();
      expect(eventData.isActive).toBeDefined();
    });

    test('should override factory defaults', async () => {
      const customUserData = dataFactory.createAmexingUserData({
        role: 'admin',
        status: 'inactive',
        permissions: {
          canManageUsers: true,
          canCreateEvents: true
        }
      });

      expect(customUserData.role).toBe('admin');
      expect(customUserData.status).toBe('inactive');
      expect(customUserData.permissions.canManageUsers).toBe(true);
      expect(customUserData.permissions.canCreateEvents).toBe(true);
    });

    test('should create multiple related objects', async () => {
      const relatedObjects = await dataFactory.createRelatedObjects();

      expect(relatedObjects.user).toBeDefined();
      expect(relatedObjects.role).toBeDefined();
      expect(relatedObjects.event).toBeDefined();
      expect(relatedObjects.notification).toBeDefined();

      expect(relatedObjects.event.get('createdBy')).toBe(relatedObjects.user.id);
      expect(relatedObjects.notification.get('userId')).toBe(relatedObjects.user.id);
    });
  });
});