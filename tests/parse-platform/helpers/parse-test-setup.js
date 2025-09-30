/**
 * Parse Platform Test Setup Helper
 * Configures test environment for Parse Platform testing with development database
 */

const Parse = require('parse/node');
const crypto = require('crypto');

class ParseTestSetup {
  constructor() {
    this.isInitialized = false;
    this.testCollections = [];
    this.testObjectIds = [];
    this.testPrefix = process.env.PARSE_PLATFORM_TEST_PREFIX || 'ParseTest_';
    this.testConfig = {
      appId: process.env.PARSE_APP_ID || process.env.PARSE_APPLICATION_ID,
      masterKey: process.env.PARSE_MASTER_KEY,
      serverURL: process.env.PARSE_SERVER_URL,
      javascriptKey: process.env.PARSE_JAVASCRIPT_KEY
    };
  }

  /**
   * Initialize Parse SDK for testing
   */
  async initializeParse() {
    try {
      if (this.isInitialized) {
        console.log('Parse SDK already initialized');
        return;
      }

      // Initialize Parse SDK
      Parse.initialize(
        this.testConfig.appId,
        this.testConfig.javascriptKey,
        this.testConfig.masterKey
      );

      Parse.serverURL = this.testConfig.serverURL;

      // Test connection (skip if Parse Server not running)
      try {
        await this.validateConnection();
        console.log('Parse Server connection validated');
      } catch (error) {
        console.warn('Parse Server connection validation failed:', error.message);
        console.warn('Tests will be skipped if Parse Server is not available');
      }

      this.isInitialized = true;
      console.log('Parse SDK initialized successfully for testing');
    } catch (error) {
      console.error('Failed to initialize Parse SDK:', error);
      throw new Error(`Parse initialization failed: ${error.message}`);
    }
  }

  /**
   * Validate Parse Server connection
   */
  async validateConnection() {
    try {
      // Test basic Parse Server connectivity
      const TestObject = Parse.Object.extend('_TestConnection');
      const testObj = new TestObject();
      testObj.set('testField', 'connection-test');

      await testObj.save(null, { useMasterKey: true });
      await testObj.destroy({ useMasterKey: true });

      console.log('Parse Server connection validated');
    } catch (error) {
      console.error('Parse Server connection validation failed:', error);
      throw new Error(`Parse Server connection failed: ${error.message}`);
    }
  }

  /**
   * Create test schema if it doesn't exist
   */
  async createTestSchema(className, fields = {}) {
    try {
      const fullClassName = className.startsWith(this.testPrefix)
        ? className
        : `${this.testPrefix}${className}`;

      const schema = new Parse.Schema(fullClassName);

      // Check if schema already exists
      try {
        await schema.get();
        console.log(`Schema ${fullClassName} already exists`);
        return schema;
      } catch (error) {
        // Schema doesn't exist, create it
        console.log(`Creating schema: ${fullClassName}`);
      }

      // Add default fields
      const defaultFields = {
        testId: 'String',
        createdAt: 'Date',
        updatedAt: 'Date',
        testMetadata: 'Object',
        ...fields
      };

      Object.entries(defaultFields).forEach(([fieldName, fieldType]) => {
        switch (fieldType) {
          case 'String':
            schema.addString(fieldName);
            break;
          case 'Number':
            schema.addNumber(fieldName);
            break;
          case 'Boolean':
            schema.addBoolean(fieldName);
            break;
          case 'Date':
            schema.addDate(fieldName);
            break;
          case 'Array':
            schema.addArray(fieldName);
            break;
          case 'Object':
            schema.addObject(fieldName);
            break;
          case 'Pointer':
            schema.addPointer(fieldName, fieldType.target);
            break;
          default:
            schema.addString(fieldName);
        }
      });

      await schema.save();
      console.log(`Schema ${fullClassName} created successfully`);

      // Track test collection for cleanup
      this.testCollections.push(fullClassName);

      return schema;
    } catch (error) {
      console.error(`Error creating test schema ${className}:`, error);
      throw error;
    }
  }

  /**
   * Create test object with standard test metadata
   */
  createTestObject(className, data = {}) {
    const fullClassName = className.startsWith(this.testPrefix)
      ? className
      : `${this.testPrefix}${className}`;

    const TestClass = Parse.Object.extend(fullClassName);
    const testObj = new TestClass();

    // Add test metadata
    const testMetadata = {
      testId: this.generateTestId(),
      testRun: process.env.JEST_WORKER_ID || 'main',
      createdBy: 'parse-platform-test',
      timestamp: new Date().toISOString()
    };

    testObj.set('testMetadata', testMetadata);

    // Set provided data
    Object.entries(data).forEach(([key, value]) => {
      testObj.set(key, value);
    });

    return testObj;
  }

  /**
   * Save test object and track for cleanup
   */
  async saveTestObject(testObj, options = {}) {
    try {
      const savedObj = await testObj.save(null, { useMasterKey: true, ...options });

      // Track object for cleanup
      this.testObjectIds.push({
        className: savedObj.className,
        objectId: savedObj.id
      });

      return savedObj;
    } catch (error) {
      console.error('Failed to save test object:', error);
      throw error;
    }
  }

  /**
   * Create and save test object in one operation
   */
  async createAndSaveTestObject(className, data = {}, options = {}) {
    const testObj = this.createTestObject(className, data);
    return await this.saveTestObject(testObj, options);
  }

  /**
   * Generate unique test ID
   */
  generateTestId() {
    return `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate synthetic test data
   */
  generateTestData(type = 'user') {
    const timestamp = Date.now();

    const generators = {
      user: () => ({
        username: `testuser_${timestamp}`,
        email: `test.${timestamp}@parsetest.com`,
        firstName: 'Parse',
        lastName: 'Test',
        active: true,
        profile: {
          avatar: 'https://example.com/avatar.jpg',
          bio: 'Parse Platform test user'
        }
      }),

      event: () => ({
        title: `Test Event ${timestamp}`,
        description: 'Parse Platform test event',
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600000), // 1 hour later
        location: 'Test Location',
        capacity: 100,
        isActive: true
      }),

      notification: () => ({
        title: `Test Notification ${timestamp}`,
        message: 'Parse Platform test notification',
        type: 'info',
        isRead: false,
        priority: 'normal',
        metadata: { testData: true }
      }),

      role: () => ({
        name: `TestRole_${timestamp}`,
        description: 'Parse Platform test role',
        permissions: ['read', 'write'],
        isActive: true
      })
    };

    return generators[type] ? generators[type]() : generators.user();
  }

  /**
   * Create bulk test data
   */
  async createBulkTestData(className, count = 5, dataGenerator = null) {
    try {
      const objects = [];

      for (let i = 0; i < count; i++) {
        const data = dataGenerator ? dataGenerator(i) : this.generateTestData();
        const testObj = this.createTestObject(className, data);
        objects.push(testObj);
      }

      const savedObjects = await Parse.Object.saveAll(objects, { useMasterKey: true });

      // Track objects for cleanup
      savedObjects.forEach(obj => {
        this.testObjectIds.push({
          className: obj.className,
          objectId: obj.id
        });
      });

      console.log(`Created ${savedObjects.length} test objects for ${className}`);
      return savedObjects;
    } catch (error) {
      console.error(`Failed to create bulk test data for ${className}:`, error);
      throw error;
    }
  }

  /**
   * Query test objects with common filters
   */
  async queryTestObjects(className, filters = {}) {
    try {
      const fullClassName = className.startsWith(this.testPrefix)
        ? className
        : `${this.testPrefix}${className}`;

      const TestClass = Parse.Object.extend(fullClassName);
      const query = new Parse.Query(TestClass);

      // Add test metadata filter to only get test objects
      query.exists('testMetadata');

      // Apply additional filters
      Object.entries(filters).forEach(([key, value]) => {
        if (typeof value === 'object' && value.operator) {
          switch (value.operator) {
            case 'equalTo':
              query.equalTo(key, value.value);
              break;
            case 'notEqualTo':
              query.notEqualTo(key, value.value);
              break;
            case 'greaterThan':
              query.greaterThan(key, value.value);
              break;
            case 'lessThan':
              query.lessThan(key, value.value);
              break;
            case 'contains':
              query.contains(key, value.value);
              break;
            case 'startsWith':
              query.startsWith(key, value.value);
              break;
            default:
              query.equalTo(key, value.value);
          }
        } else {
          query.equalTo(key, value);
        }
      });

      return await query.find({ useMasterKey: true });
    } catch (error) {
      console.error(`Failed to query test objects for ${className}:`, error);
      throw error;
    }
  }

  /**
   * Clean up individual test object
   */
  async cleanupTestObject(className, objectId) {
    try {
      const fullClassName = className.startsWith(this.testPrefix)
        ? className
        : `${this.testPrefix}${className}`;

      const TestClass = Parse.Object.extend(fullClassName);
      const query = new Parse.Query(TestClass);

      const object = await query.get(objectId, { useMasterKey: true });
      await object.destroy({ useMasterKey: true });

      // Remove from tracking
      this.testObjectIds = this.testObjectIds.filter(
        item => !(item.className === fullClassName && item.objectId === objectId)
      );

    } catch (error) {
      // Object might already be deleted, which is fine
      console.warn(`Could not cleanup object ${objectId} from ${className}:`, error.message);
    }
  }

  /**
   * Clean up all test data
   */
  async cleanupAllTestData() {
    try {
      console.log('Starting Parse Platform test data cleanup...');

      // Clean up tracked objects
      for (const item of this.testObjectIds) {
        await this.cleanupTestObject(item.className, item.objectId);
      }

      // Clean up any remaining test objects
      for (const className of this.testCollections) {
        await this.cleanupTestCollection(className);
      }

      this.testObjectIds = [];
      this.testCollections = [];

      console.log('Parse Platform test data cleanup completed');
    } catch (error) {
      console.error('Failed to cleanup all test data:', error);
    }
  }

  /**
   * Clean up entire test collection
   */
  async cleanupTestCollection(className) {
    try {
      const TestClass = Parse.Object.extend(className);
      const query = new Parse.Query(TestClass);
      query.exists('testMetadata'); // Only clean test objects
      query.limit(1000); // Batch cleanup

      const objects = await query.find({ useMasterKey: true });

      if (objects.length > 0) {
        await Parse.Object.destroyAll(objects, { useMasterKey: true });
        console.log(`Cleaned up ${objects.length} objects from ${className}`);

        // If there might be more objects, recursively clean
        if (objects.length === 1000) {
          await this.cleanupTestCollection(className);
        }
      }
    } catch (error) {
      console.warn(`Could not cleanup collection ${className}:`, error.message);
    }
  }

  /**
   * Get test configuration
   */
  getTestConfig() {
    return {
      ...this.testConfig,
      testPrefix: this.testPrefix,
      isInitialized: this.isInitialized,
      testCollections: [...this.testCollections],
      trackedObjects: this.testObjectIds.length
    };
  }

  /**
   * Wait for Parse Server to be ready
   */
  async waitForParseServer(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        await this.validateConnection();
        return true;
      } catch (error) {
        console.log('Waiting for Parse Server...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`Parse Server not ready after ${timeout}ms`);
  }
}

// Global instance
const parseTestSetup = new ParseTestSetup();

// Initialize Parse on module load
parseTestSetup.initializeParse().catch(error => {
  console.error('Failed to initialize Parse in test setup:', error);
});

module.exports = ParseTestSetup;