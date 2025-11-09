/**
 * Parse Platform Test Helpers
 * Utility functions for Parse Platform testing
 */

const Parse = require('parse/node');

class ParseTestHelpers {
  constructor() {
    this.testPrefix = process.env.PARSE_PLATFORM_TEST_PREFIX || 'ParseTest_';
  }

  /**
   * Wait for a condition to be true
   */
  async waitFor(condition, timeout = 10000, interval = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const result = await condition();
        if (result) {
          return result;
        }
      } catch (error) {
        // Continue waiting unless it's the final attempt
        if (Date.now() - startTime >= timeout - interval) {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Wait for object to exist
   */
  async waitForObject(className, objectId, timeout = 10000) {
    return await this.waitFor(async () => {
      try {
        const TestClass = Parse.Object.extend(this.getFullClassName(className));
        const query = new Parse.Query(TestClass);
        const object = await query.get(objectId, { useMasterKey: true });
        return object;
      } catch (error) {
        return false;
      }
    }, timeout);
  }

  /**
   * Wait for object to be deleted
   */
  async waitForObjectDeletion(className, objectId, timeout = 10000) {
    return await this.waitFor(async () => {
      try {
        const TestClass = Parse.Object.extend(this.getFullClassName(className));
        const query = new Parse.Query(TestClass);
        await query.get(objectId, { useMasterKey: true });
        return false; // Object still exists
      } catch (error) {
        return true; // Object doesn't exist (deleted)
      }
    }, timeout);
  }

  /**
   * Wait for query to return specific count
   */
  async waitForCount(className, expectedCount, queryFilters = {}, timeout = 10000) {
    return await this.waitFor(async () => {
      const TestClass = Parse.Object.extend(this.getFullClassName(className));
      const query = new Parse.Query(TestClass);

      Object.entries(queryFilters).forEach(([key, value]) => {
        query.equalTo(key, value);
      });

      const count = await query.count({ useMasterKey: true });
      return count === expectedCount ? count : false;
    }, timeout);
  }

  /**
   * Get full class name with test prefix
   */
  getFullClassName(className) {
    return className.startsWith(this.testPrefix) ? className : `${this.testPrefix}${className}`;
  }

  /**
   * Create query with common test filters
   */
  createTestQuery(className, includeTestMetadata = true) {
    const TestClass = Parse.Object.extend(this.getFullClassName(className));
    const query = new Parse.Query(TestClass);

    if (includeTestMetadata) {
      query.exists('testMetadata');
    }

    return query;
  }

  /**
   * Find objects with retry logic
   */
  async findWithRetry(query, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await query.find({ useMasterKey: true, ...options });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.warn(`Query attempt ${attempt} failed, retrying...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Count objects with retry logic
   */
  async countWithRetry(query, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await query.count({ useMasterKey: true, ...options });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.warn(`Count attempt ${attempt} failed, retrying...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Save object with retry logic
   */
  async saveWithRetry(object, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await object.save(null, { useMasterKey: true, ...options });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.warn(`Save attempt ${attempt} failed, retrying...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Delete object with retry logic
   */
  async destroyWithRetry(object, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await object.destroy({ useMasterKey: true, ...options });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.warn(`Destroy attempt ${attempt} failed, retrying...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Validate object structure
   */
  validateObjectStructure(object, expectedFields) {
    const errors = [];

    expectedFields.forEach(field => {
      if (typeof field === 'string') {
        if (!object.has(field)) {
          errors.push(`Missing required field: ${field}`);
        }
      } else if (typeof field === 'object') {
        const { name, type, required = true } = field;

        if (required && !object.has(name)) {
          errors.push(`Missing required field: ${name}`);
        } else if (object.has(name)) {
          const value = object.get(name);
          const actualType = typeof value;

          if (type === 'Date' && !(value instanceof Date)) {
            errors.push(`Field ${name} should be Date, got ${actualType}`);
          } else if (type === 'Array' && !Array.isArray(value)) {
            errors.push(`Field ${name} should be Array, got ${actualType}`);
          } else if (type !== 'Date' && type !== 'Array' && actualType !== type) {
            errors.push(`Field ${name} should be ${type}, got ${actualType}`);
          }
        }
      }
    });

    return errors;
  }

  /**
   * Compare objects for equality (ignoring system fields)
   */
  compareObjects(obj1, obj2, ignoreFields = ['objectId', 'createdAt', 'updatedAt', 'testMetadata']) {
    const attributes1 = obj1.attributes;
    const attributes2 = obj2.attributes;

    const keys1 = Object.keys(attributes1).filter(key => !ignoreFields.includes(key));
    const keys2 = Object.keys(attributes2).filter(key => !ignoreFields.includes(key));

    if (keys1.length !== keys2.length) {
      return false;
    }

    return keys1.every(key => {
      const val1 = attributes1[key];
      const val2 = attributes2[key];

      if (val1 instanceof Date && val2 instanceof Date) {
        return val1.getTime() === val2.getTime();
      }

      if (typeof val1 === 'object' && typeof val2 === 'object') {
        return JSON.stringify(val1) === JSON.stringify(val2);
      }

      return val1 === val2;
    });
  }

  /**
   * Generate performance test data
   */
  generatePerformanceTestData(className, count) {
    const testData = [];

    for (let i = 0; i < count; i++) {
      testData.push({
        index: i,
        name: `${className}_performance_test_${i}`,
        value: Math.random(),
        timestamp: new Date(),
        metadata: {
          performanceTest: true,
          batch: Math.floor(i / 100)
        }
      });
    }

    return testData;
  }

  /**
   * Measure operation performance
   */
  async measurePerformance(operation, iterations = 1) {
    const results = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      const startMemory = process.memoryUsage();

      try {
        const result = await operation();
        const endTime = process.hrtime.bigint();
        const endMemory = process.memoryUsage();

        results.push({
          iteration: i + 1,
          duration: Number(endTime - startTime) / 1000000, // Convert to milliseconds
          memoryDelta: {
            rss: endMemory.rss - startMemory.rss,
            heapUsed: endMemory.heapUsed - startMemory.heapUsed,
            heapTotal: endMemory.heapTotal - startMemory.heapTotal
          },
          success: true,
          result
        });
      } catch (error) {
        const endTime = process.hrtime.bigint();

        results.push({
          iteration: i + 1,
          duration: Number(endTime - startTime) / 1000000,
          memoryDelta: null,
          success: false,
          error: error.message
        });
      }
    }

    return this.calculatePerformanceStats(results);
  }

  /**
   * Calculate performance statistics
   */
  calculatePerformanceStats(results) {
    const successfulResults = results.filter(r => r.success);
    const durations = successfulResults.map(r => r.duration);

    if (durations.length === 0) {
      return {
        totalOperations: results.length,
        successfulOperations: 0,
        failedOperations: results.length,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        medianDuration: 0,
        errors: results.filter(r => !r.success).map(r => r.error)
      };
    }

    durations.sort((a, b) => a - b);

    return {
      totalOperations: results.length,
      successfulOperations: successfulResults.length,
      failedOperations: results.length - successfulResults.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      medianDuration: durations[Math.floor(durations.length / 2)],
      p95Duration: durations[Math.floor(durations.length * 0.95)],
      p99Duration: durations[Math.floor(durations.length * 0.99)],
      errors: results.filter(r => !r.success).map(r => r.error),
      results: results
    };
  }

  /**
   * Create test schema with validation
   */
  async createTestSchemaWithValidation(className, fields, validationRules = {}) {
    const schema = new Parse.Schema(this.getFullClassName(className));

    // Add fields
    Object.entries(fields).forEach(([fieldName, fieldType]) => {
      switch (fieldType.toLowerCase()) {
        case 'string':
          schema.addString(fieldName);
          break;
        case 'number':
          schema.addNumber(fieldName);
          break;
        case 'boolean':
          schema.addBoolean(fieldName);
          break;
        case 'date':
          schema.addDate(fieldName);
          break;
        case 'array':
          schema.addArray(fieldName);
          break;
        case 'object':
          schema.addObject(fieldName);
          break;
        default:
          schema.addString(fieldName);
      }
    });

    // Add validation rules
    if (validationRules.required) {
      validationRules.required.forEach(fieldName => {
        schema.addField(fieldName, 'String');
      });
    }

    try {
      await schema.save();
      return schema;
    } catch (error) {
      if (error.code === 103) { // Class already exists
        return schema;
      }
      throw error;
    }
  }
}

module.exports = ParseTestHelpers;