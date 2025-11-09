/**
 * Parse Platform Cleanup Helpers
 * Safe test data cleanup utilities
 */

const Parse = require('parse/node');

class CleanupHelpers {
  constructor() {
    this.testPrefix = process.env.PARSE_PLATFORM_TEST_PREFIX || 'ParseTest_';
    this.cleanupQueue = [];
    this.cleanupInProgress = false;
  }

  /**
   * Add object to cleanup queue
   */
  addToCleanupQueue(className, objectId) {
    const fullClassName = this.getFullClassName(className);
    this.cleanupQueue.push({ className: fullClassName, objectId });
  }

  /**
   * Add multiple objects to cleanup queue
   */
  addArrayToCleanupQueue(objects) {
    objects.forEach(obj => {
      this.addToCleanupQueue(obj.className, obj.id);
    });
  }

  /**
   * Get full class name with test prefix
   */
  getFullClassName(className) {
    return className.startsWith(this.testPrefix) ? className : `${this.testPrefix}${className}`;
  }

  /**
   * Clean up single object by ID
   */
  async cleanupObject(className, objectId, options = {}) {
    try {
      const fullClassName = this.getFullClassName(className);
      const TestClass = Parse.Object.extend(fullClassName);
      const query = new Parse.Query(TestClass);

      const object = await query.get(objectId, { useMasterKey: true });
      await object.destroy({ useMasterKey: true, ...options });

      return true;
    } catch (error) {
      if (error.code === 101) {
        // Object doesn't exist, which is fine for cleanup
        return true;
      }

      console.warn(`Failed to cleanup object ${objectId} from ${className}:`, error.message);

      if (options.throwOnError) {
        throw error;
      }

      return false;
    }
  }

  /**
   * Clean up multiple objects by IDs
   */
  async cleanupObjects(className, objectIds, options = {}) {
    const results = [];

    for (const objectId of objectIds) {
      const result = await this.cleanupObject(className, objectId, {
        ...options,
        throwOnError: false
      });
      results.push({ objectId, success: result });
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Cleanup completed for ${className}: ${successful} successful, ${failed} failed`);

    return results;
  }

  /**
   * Clean up all objects in a class with test metadata
   */
  async cleanupTestClass(className, batchSize = 100) {
    try {
      const fullClassName = this.getFullClassName(className);
      let totalCleaned = 0;
      let hasMoreObjects = true;

      while (hasMoreObjects) {
        const TestClass = Parse.Object.extend(fullClassName);
        const query = new Parse.Query(TestClass);

        // Only clean objects with test metadata
        query.exists('testMetadata');
        query.limit(batchSize);

        const objects = await query.find({ useMasterKey: true });

        if (objects.length === 0) {
          hasMoreObjects = false;
        } else {
          await Parse.Object.destroyAll(objects, { useMasterKey: true });
          totalCleaned += objects.length;

          console.log(`Cleaned ${objects.length} objects from ${fullClassName} (total: ${totalCleaned})`);

          // Continue if we got the full batch size (might be more objects)
          hasMoreObjects = objects.length === batchSize;
        }

        // Small delay to avoid overwhelming the database
        if (hasMoreObjects) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`Cleanup completed for ${fullClassName}: ${totalCleaned} objects removed`);
      return totalCleaned;
    } catch (error) {
      console.error(`Failed to cleanup test class ${className}:`, error);
      throw error;
    }
  }

  /**
   * Clean up all objects in multiple classes
   */
  async cleanupTestClasses(classNames, batchSize = 100) {
    const results = {};

    for (const className of classNames) {
      try {
        const cleaned = await this.cleanupTestClass(className, batchSize);
        results[className] = { success: true, cleaned };
      } catch (error) {
        console.error(`Failed to cleanup class ${className}:`, error);
        results[className] = { success: false, error: error.message };
      }
    }

    return results;
  }

  /**
   * Process cleanup queue
   */
  async processCleanupQueue(batchSize = 50) {
    if (this.cleanupInProgress) {
      console.warn('Cleanup already in progress, skipping');
      return;
    }

    this.cleanupInProgress = true;

    try {
      console.log(`Processing cleanup queue: ${this.cleanupQueue.length} items`);

      // Group by class name for efficient batch processing
      const groupedByClass = this.cleanupQueue.reduce((groups, item) => {
        if (!groups[item.className]) {
          groups[item.className] = [];
        }
        groups[item.className].push(item.objectId);
        return groups;
      }, {});

      const results = {};

      for (const [className, objectIds] of Object.entries(groupedByClass)) {
        // Process in batches
        for (let i = 0; i < objectIds.length; i += batchSize) {
          const batch = objectIds.slice(i, i + batchSize);
          const batchResults = await this.cleanupObjects(className, batch);

          if (!results[className]) {
            results[className] = [];
          }
          results[className].push(...batchResults);
        }
      }

      // Clear the queue after processing
      this.cleanupQueue = [];

      console.log('Cleanup queue processing completed');
      return results;
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Safe cleanup with error handling and retries
   */
  async safeCleanup(cleanupFunction, maxRetries = 3, delayBetweenRetries = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await cleanupFunction();
        return result;
      } catch (error) {
        console.warn(`Cleanup attempt ${attempt} failed:`, error.message);

        if (attempt === maxRetries) {
          console.error('All cleanup attempts failed:', error);
          throw error;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delayBetweenRetries * attempt));
      }
    }
  }

  /**
   * Clean up objects created after a specific date
   */
  async cleanupObjectsCreatedAfter(className, afterDate, batchSize = 100) {
    try {
      const fullClassName = this.getFullClassName(className);
      let totalCleaned = 0;
      let hasMoreObjects = true;

      while (hasMoreObjects) {
        const TestClass = Parse.Object.extend(fullClassName);
        const query = new Parse.Query(TestClass);

        query.exists('testMetadata');
        query.greaterThan('createdAt', afterDate);
        query.limit(batchSize);

        const objects = await query.find({ useMasterKey: true });

        if (objects.length === 0) {
          hasMoreObjects = false;
        } else {
          await Parse.Object.destroyAll(objects, { useMasterKey: true });
          totalCleaned += objects.length;

          hasMoreObjects = objects.length === batchSize;
        }

        if (hasMoreObjects) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`Cleaned ${totalCleaned} objects from ${fullClassName} created after ${afterDate}`);
      return totalCleaned;
    } catch (error) {
      console.error(`Failed to cleanup objects created after ${afterDate}:`, error);
      throw error;
    }
  }

  /**
   * Clean up objects by test metadata
   */
  async cleanupByTestMetadata(className, metadataFilter, batchSize = 100) {
    try {
      const fullClassName = this.getFullClassName(className);
      let totalCleaned = 0;
      let hasMoreObjects = true;

      while (hasMoreObjects) {
        const TestClass = Parse.Object.extend(fullClassName);
        const query = new Parse.Query(TestClass);

        // Apply metadata filters
        Object.entries(metadataFilter).forEach(([key, value]) => {
          query.equalTo(`testMetadata.${key}`, value);
        });

        query.limit(batchSize);

        const objects = await query.find({ useMasterKey: true });

        if (objects.length === 0) {
          hasMoreObjects = false;
        } else {
          await Parse.Object.destroyAll(objects, { useMasterKey: true });
          totalCleaned += objects.length;

          hasMoreObjects = objects.length === batchSize;
        }

        if (hasMoreObjects) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`Cleaned ${totalCleaned} objects from ${fullClassName} matching metadata filter`);
      return totalCleaned;
    } catch (error) {
      console.error(`Failed to cleanup objects by metadata filter:`, error);
      throw error;
    }
  }

  /**
   * Emergency cleanup - removes all test objects
   */
  async emergencyCleanup(confirmationToken = null) {
    if (confirmationToken !== 'EMERGENCY_CLEANUP_CONFIRMED') {
      throw new Error('Emergency cleanup requires confirmation token');
    }

    console.warn('Starting emergency cleanup - removing ALL test objects');

    const testClasses = [
      'AmexingUser',
      'Event',
      'Notification',
      'Role',
      'Permission',
      'AuditLog',
      'Session',
      'Installation'
    ];

    const results = await this.cleanupTestClasses(testClasses);

    console.warn('Emergency cleanup completed');
    return results;
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats() {
    return {
      queueLength: this.cleanupQueue.length,
      inProgress: this.cleanupInProgress,
      testPrefix: this.testPrefix
    };
  }

  /**
   * Clear cleanup queue without processing
   */
  clearCleanupQueue() {
    const queueLength = this.cleanupQueue.length;
    this.cleanupQueue = [];
    console.log(`Cleared cleanup queue: ${queueLength} items removed`);
    return queueLength;
  }

  /**
   * Validate cleanup safety
   */
  validateCleanupSafety(className) {
    const fullClassName = this.getFullClassName(className);

    // Ensure we're only cleaning test classes
    if (!fullClassName.startsWith(this.testPrefix)) {
      throw new Error(`Unsafe cleanup: ${className} does not start with test prefix ${this.testPrefix}`);
    }

    // Ensure we're not in production
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cleanup operations not allowed in production environment');
    }

    return true;
  }
}

module.exports = CleanupHelpers;