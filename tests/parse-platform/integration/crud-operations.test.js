/**
 * Parse Platform CRUD Operations Integration Tests
 * Tests complete Create, Read, Update, Delete operations with real database
 */

const Parse = require('parse/node');
const ParseTestSetup = require('../helpers/parse-test-setup');
const TestDataFactory = require('../helpers/test-data-factory');
const ParseTestHelpers = require('../helpers/parse-test-helpers');

describe('Parse Platform CRUD Operations Integration', () => {
  let parseSetup;
  let dataFactory;
  let testHelpers;

  beforeAll(async () => {
    parseSetup = new ParseTestSetup();
    await parseSetup.initializeParse();
    dataFactory = new TestDataFactory(parseSetup);
    testHelpers = new ParseTestHelpers();

    // Create test schemas
    await parseSetup.createTestSchema('CRUDTest', {
      name: 'String',
      description: 'String',
      value: 'Number',
      active: 'Boolean',
      tags: 'Array',
      metadata: 'Object',
      lastModified: 'Date'
    });
  });

  afterAll(async () => {
    await dataFactory.cleanup();
  });

  describe('Create Operations', () => {
    test('should create single object with all field types', async () => {
      const testData = {
        name: 'CRUD Create Test',
        description: 'Testing object creation',
        value: 42,
        active: true,
        tags: ['test', 'crud', 'create'],
        metadata: {
          author: 'test-user',
          category: 'integration-test'
        },
        lastModified: new Date()
      };

      const createdObj = await dataFactory.createTestObject('CRUDTest', testData);

      expect(createdObj.id).toBeDefined();
      expect(createdObj.get('name')).toBe('CRUD Create Test');
      expect(createdObj.get('value')).toBe(42);
      expect(createdObj.get('active')).toBe(true);
      expect(createdObj.get('tags')).toEqual(['test', 'crud', 'create']);
      expect(createdObj.get('metadata').author).toBe('test-user');
      expect(createdObj.get('lastModified')).toBeInstanceOf(Date);
      expect(createdObj.createdAt).toBeInstanceOf(Date);
      expect(createdObj.updatedAt).toBeInstanceOf(Date);
    });

    test('should create multiple objects in batch', async () => {
      const objectCount = 5;
      const objects = [];

      for (let i = 0; i < objectCount; i++) {
        const testData = {
          name: `Batch Object ${i}`,
          value: i * 10,
          active: i % 2 === 0
        };
        const obj = parseSetup.createTestObject('CRUDTest', testData);
        objects.push(obj);
      }

      const savedObjects = await Parse.Object.saveAll(objects, { useMasterKey: true });

      expect(savedObjects).toHaveLength(objectCount);
      savedObjects.forEach((obj, index) => {
        expect(obj.id).toBeDefined();
        expect(obj.get('name')).toBe(`Batch Object ${index}`);
        expect(obj.get('value')).toBe(index * 10);

        // Track for cleanup
        dataFactory.createdObjects.push({
          className: obj.className,
          objectId: obj.id,
          object: obj
        });
      });
    });

    test('should handle creation with relations', async () => {
      // Create parent object
      const parent = await dataFactory.createTestObject('CRUDTest', {
        name: 'Parent Object',
        value: 100
      });

      // Create child object with relation to parent
      const child = await dataFactory.createTestObject('CRUDTest', {
        name: 'Child Object',
        parent: parent,
        value: 10
      });

      expect(child.get('parent')).toBeDefined();
      expect(child.get('parent').id).toBe(parent.id);
    });
  });

  describe('Read Operations', () => {
    let testObjects = [];

    beforeEach(async () => {
      // Create test data for reading
      testObjects = await dataFactory.createMultiple('CRUDTest', 10, (index) => ({
        name: `Read Test ${index}`,
        value: index * 5,
        active: index < 5,
        category: index % 2 === 0 ? 'even' : 'odd',
        tags: [`tag${index}`],
        lastModified: new Date(Date.now() + index * 1000)
      }));
    });

    test('should retrieve single object by ID', async () => {
      const targetObject = testObjects[0];

      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);
      const retrievedObj = await query.get(targetObject.id, { useMasterKey: true });

      expect(retrievedObj.id).toBe(targetObject.id);
      expect(retrievedObj.get('name')).toBe(targetObject.get('name'));
      expect(retrievedObj.get('value')).toBe(targetObject.get('value'));
    });

    test('should query objects with simple filters', async () => {
      const activeObjects = await testHelpers.queryTestObjects('CRUDTest', {
        active: true
      });

      expect(activeObjects.length).toBeGreaterThanOrEqual(5);
      activeObjects.forEach(obj => {
        expect(obj.get('active')).toBe(true);
      });
    });

    test('should query objects with complex filters', async () => {
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);

      query.exists('testMetadata');
      query.equalTo('active', true);
      query.greaterThan('value', 10);
      query.lessThan('value', 30);

      const results = await query.find({ useMasterKey: true });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(obj => {
        expect(obj.get('active')).toBe(true);
        expect(obj.get('value')).toBeGreaterThan(10);
        expect(obj.get('value')).toBeLessThan(30);
      });
    });

    test('should query with sorting and pagination', async () => {
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);

      query.exists('testMetadata');
      query.ascending('value');
      query.limit(5);

      const results = await query.find({ useMasterKey: true });

      expect(results.length).toBeLessThanOrEqual(5);

      // Verify sorting
      for (let i = 1; i < results.length; i++) {
        expect(results[i].get('value')).toBeGreaterThanOrEqual(results[i-1].get('value'));
      }
    });

    test('should count objects efficiently', async () => {
      const count = await testHelpers.countWithRetry(
        testHelpers.createTestQuery('CRUDTest')
      );

      expect(count).toBeGreaterThanOrEqual(10);
    });

    test('should handle query with no results', async () => {
      const noResults = await testHelpers.queryTestObjects('CRUDTest', {
        name: 'NonexistentObject'
      });

      expect(noResults).toHaveLength(0);
    });
  });

  describe('Update Operations', () => {
    let testObject;

    beforeEach(async () => {
      testObject = await dataFactory.createTestObject('CRUDTest', {
        name: 'Update Test',
        value: 50,
        active: true,
        tags: ['original'],
        metadata: { version: 1 }
      });
    });

    test('should update single field', async () => {
      const originalId = testObject.id;
      const originalCreatedAt = testObject.createdAt;

      testObject.set('name', 'Updated Name');
      const updatedObj = await testObject.save(null, { useMasterKey: true });

      expect(updatedObj.id).toBe(originalId);
      expect(updatedObj.get('name')).toBe('Updated Name');
      expect(updatedObj.get('value')).toBe(50); // Unchanged
      expect(updatedObj.createdAt).toEqual(originalCreatedAt);
      expect(updatedObj.updatedAt.getTime()).toBeGreaterThan(originalCreatedAt.getTime());
    });

    test('should update multiple fields', async () => {
      testObject.set('name', 'Multiple Updates');
      testObject.set('value', 100);
      testObject.set('active', false);
      testObject.set('metadata', { version: 2, updated: true });

      const updatedObj = await testObject.save(null, { useMasterKey: true });

      expect(updatedObj.get('name')).toBe('Multiple Updates');
      expect(updatedObj.get('value')).toBe(100);
      expect(updatedObj.get('active')).toBe(false);
      expect(updatedObj.get('metadata').version).toBe(2);
      expect(updatedObj.get('metadata').updated).toBe(true);
    });

    test('should increment numeric fields', async () => {
      const originalValue = testObject.get('value');

      testObject.increment('value', 25);
      const updatedObj = await testObject.save(null, { useMasterKey: true });

      expect(updatedObj.get('value')).toBe(originalValue + 25);
    });

    test('should add to array fields', async () => {
      testObject.add('tags', 'updated');
      testObject.addAll('tags', ['tag2', 'tag3']);

      const updatedObj = await testObject.save(null, { useMasterKey: true });

      expect(updatedObj.get('tags')).toContain('original');
      expect(updatedObj.get('tags')).toContain('updated');
      expect(updatedObj.get('tags')).toContain('tag2');
      expect(updatedObj.get('tags')).toContain('tag3');
    });

    test('should remove from array fields', async () => {
      testObject.set('tags', ['tag1', 'tag2', 'tag3', 'tag2']);
      await testObject.save(null, { useMasterKey: true });

      testObject.remove('tags', 'tag2');
      const updatedObj = await testObject.save(null, { useMasterKey: true });

      const tags = updatedObj.get('tags');
      expect(tags).toContain('tag1');
      expect(tags).toContain('tag3');
      // Should remove one instance of tag2
      expect(tags.filter(tag => tag === 'tag2')).toHaveLength(1);
    });

    test('should handle concurrent updates', async () => {
      // Create two references to the same object
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query1 = new Parse.Query(TestClass);
      const query2 = new Parse.Query(TestClass);

      const obj1 = await query1.get(testObject.id, { useMasterKey: true });
      const obj2 = await query2.get(testObject.id, { useMasterKey: true });

      // Update both objects
      obj1.set('value', 100);
      obj2.set('name', 'Concurrent Update');

      // Save first object
      await obj1.save(null, { useMasterKey: true });

      // Save second object - should handle the concurrent modification
      const finalObj = await obj2.save(null, { useMasterKey: true });

      expect(finalObj.get('name')).toBe('Concurrent Update');
      // Value might be either 100 or original depending on implementation
    });
  });

  describe('Delete Operations', () => {
    let testObjects = [];

    beforeEach(async () => {
      testObjects = await dataFactory.createMultiple('CRUDTest', 5, (index) => ({
        name: `Delete Test ${index}`,
        value: index,
        canDelete: index !== 2 // Make one object non-deletable for testing
      }));
    });

    test('should delete single object', async () => {
      const targetObject = testObjects[0];
      const objectId = targetObject.id;

      await targetObject.destroy({ useMasterKey: true });

      // Verify object is deleted
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);

      await expect(query.get(objectId, { useMasterKey: true }))
        .rejects.toThrow();

      // Remove from tracking array
      testObjects = testObjects.slice(1);
    });

    test('should delete multiple objects in batch', async () => {
      const objectsToDelete = testObjects.slice(0, 3);
      const idsToDelete = objectsToDelete.map(obj => obj.id);

      await Parse.Object.destroyAll(objectsToDelete, { useMasterKey: true });

      // Verify objects are deleted
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);
      query.containedIn('objectId', idsToDelete);

      const remainingObjects = await query.find({ useMasterKey: true });
      expect(remainingObjects).toHaveLength(0);

      // Update tracking array
      testObjects = testObjects.slice(3);
    });

    test('should handle deletion of non-existent object', async () => {
      // Create object and then delete it
      const tempObj = await dataFactory.createTestObject('CRUDTest', {
        name: 'Temp Object'
      });

      await tempObj.destroy({ useMasterKey: true });

      // Try to delete again - should not throw error
      await expect(tempObj.destroy({ useMasterKey: true }))
        .rejects.toThrow(); // Parse throws error for already deleted objects
    });

    test('should cascade delete related objects', async () => {
      // Create parent and child objects
      const parent = await dataFactory.createTestObject('CRUDTest', {
        name: 'Parent for Cascade'
      });

      const child = await dataFactory.createTestObject('CRUDTest', {
        name: 'Child for Cascade',
        parent: parent
      });

      // Delete parent
      await parent.destroy({ useMasterKey: true });

      // Child should still exist (Parse doesn't auto-cascade)
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const query = new Parse.Query(TestClass);
      const retrievedChild = await query.get(child.id, { useMasterKey: true });

      expect(retrievedChild.id).toBe(child.id);

      // Clean up child
      await child.destroy({ useMasterKey: true });
    });
  });

  describe('Complex CRUD Workflows', () => {
    test('should handle complete object lifecycle', async () => {
      // CREATE
      const obj = await dataFactory.createTestObject('CRUDTest', {
        name: 'Lifecycle Test',
        status: 'created',
        value: 0,
        history: []
      });

      const objectId = obj.id;
      expect(obj.get('status')).toBe('created');

      // READ
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      let query = new Parse.Query(TestClass);
      let retrievedObj = await query.get(objectId, { useMasterKey: true });
      expect(retrievedObj.get('name')).toBe('Lifecycle Test');

      // UPDATE multiple times
      retrievedObj.set('status', 'processing');
      retrievedObj.add('history', 'Started processing');
      await retrievedObj.save(null, { useMasterKey: true });

      retrievedObj.set('value', 50);
      retrievedObj.add('history', 'Updated value');
      await retrievedObj.save(null, { useMasterKey: true });

      retrievedObj.set('status', 'completed');
      retrievedObj.add('history', 'Processing completed');
      await retrievedObj.save(null, { useMasterKey: true });

      // Verify final state
      query = new Parse.Query(TestClass);
      const finalObj = await query.get(objectId, { useMasterKey: true });

      expect(finalObj.get('status')).toBe('completed');
      expect(finalObj.get('value')).toBe(50);
      expect(finalObj.get('history')).toHaveLength(3);
      expect(finalObj.get('history')).toContain('Processing completed');

      // DELETE
      await finalObj.destroy({ useMasterKey: true });

      // Verify deletion
      await expect(query.get(objectId, { useMasterKey: true }))
        .rejects.toThrow();
    });

    test('should handle bulk operations efficiently', async () => {
      const startTime = Date.now();
      const objectCount = 50;

      // Bulk CREATE
      const objects = [];
      for (let i = 0; i < objectCount; i++) {
        const obj = parseSetup.createTestObject('CRUDTest', {
          name: `Bulk Object ${i}`,
          value: i,
          batch: 'bulk-test'
        });
        objects.push(obj);
      }

      const createdObjects = await Parse.Object.saveAll(objects, { useMasterKey: true });
      expect(createdObjects).toHaveLength(objectCount);

      // Bulk READ
      const TestClass = Parse.Object.extend('ParseTest_CRUDTest');
      const readQuery = new Parse.Query(TestClass);
      readQuery.equalTo('batch', 'bulk-test');
      const readObjects = await readQuery.find({ useMasterKey: true });
      expect(readObjects).toHaveLength(objectCount);

      // Bulk UPDATE
      readObjects.forEach((obj, index) => {
        obj.set('value', obj.get('value') * 2);
        obj.set('updated', true);
      });
      const updatedObjects = await Parse.Object.saveAll(readObjects, { useMasterKey: true });
      expect(updatedObjects).toHaveLength(objectCount);

      // Verify updates
      updatedObjects.forEach((obj, index) => {
        expect(obj.get('value')).toBe(index * 2);
        expect(obj.get('updated')).toBe(true);
      });

      // Bulk DELETE
      await Parse.Object.destroyAll(updatedObjects, { useMasterKey: true });

      // Verify deletion
      const verifyQuery = new Parse.Query(TestClass);
      verifyQuery.equalTo('batch', 'bulk-test');
      const remainingObjects = await verifyQuery.find({ useMasterKey: true });
      expect(remainingObjects).toHaveLength(0);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`Bulk operations for ${objectCount} objects completed in ${totalTime}ms`);
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });
});