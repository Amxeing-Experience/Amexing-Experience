#!/usr/bin/env node

/**
 * Seed Tracker - State Persistence System for Seeds
 *
 * Manages the _seeds collection in MongoDB to track:
 * - Which seeds have been executed
 * - Execution statistics (created, skipped, errors)
 * - Idempotency verification
 * - Environment-specific execution
 *
 * This ensures seeds can be re-run safely without duplicating data.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 * @security PCI DSS Compliant - Complete audit logging
 */

const Parse = require('parse/node');
const logger = require('../../../src/infrastructure/logger');

/**
 * SeedTracker class for managing seed execution state
 */
class SeedTracker {
  constructor() {
    this.collectionName = 'SeedExecution';
  }

  /**
   * Initialize Parse connection
   * @param {object} config - Parse configuration
   */
  async initialize(config = {}) {
    if (!Parse.applicationId) {
      Parse.initialize(
        config.appId || process.env.PARSE_APP_ID,
        config.jsKey || process.env.PARSE_JAVASCRIPT_KEY,
        config.masterKey || process.env.PARSE_MASTER_KEY
      );
      Parse.serverURL = config.serverURL || process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
    }

    logger.info('Seed Tracker initialized', {
      serverURL: Parse.serverURL,
      environment: process.env.NODE_ENV || 'development',
    });
  }

  /**
   * Get all executed seeds
   * @returns {Promise<Array>} Array of seed records
   */
  async getExecutedSeeds() {
    try {
      const SeedClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(SeedClass);
      query.ascending('name');
      query.limit(1000);

      const results = await query.find({ useMasterKey: true });

      return results.map((seed) => ({
        name: seed.get('name'),
        version: seed.get('version'),
        executedAt: seed.get('executedAt'),
        environment: seed.get('environment'),
        status: seed.get('status'),
        idempotent: seed.get('idempotent'),
        statistics: seed.get('statistics'),
      }));
    } catch (error) {
      logger.error('Failed to get executed seeds', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if seed has been executed successfully
   * @param {string} seedName - Seed name
   * @returns {Promise<boolean>} True if executed
   */
  async isExecuted(seedName) {
    try {
      const SeedClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(SeedClass);
      query.equalTo('name', seedName);
      query.equalTo('status', 'completed');

      const count = await query.count({ useMasterKey: true });
      return count > 0;
    } catch (error) {
      logger.error('Failed to check seed status', {
        seedName,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get seed record
   * @param {string} seedName - Seed name
   * @returns {Promise<object|null>} Seed record or null
   */
  async getSeed(seedName) {
    try {
      const SeedClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(SeedClass);
      query.equalTo('name', seedName);

      const seed = await query.first({ useMasterKey: true });

      if (!seed) {
        return null;
      }

      return {
        id: seed.id,
        name: seed.get('name'),
        version: seed.get('version'),
        executedAt: seed.get('executedAt'),
        environment: seed.get('environment'),
        status: seed.get('status'),
        idempotent: seed.get('idempotent'),
        statistics: seed.get('statistics'),
        parseObject: seed,
      };
    } catch (error) {
      logger.error('Failed to get seed', {
        seedName,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Record seed execution
   * @param {object} seedData - Seed information
   * @returns {Promise<object>} Created/updated record
   */
  async recordExecution(seedData) {
    try {
      // Check if seed already executed
      const existing = await this.getSeed(seedData.name);

      const SeedClass = Parse.Object.extend(this.collectionName);
      let seed;

      if (existing && existing.parseObject) {
        // Update existing record
        seed = existing.parseObject;
      } else {
        // Create new record
        seed = new SeedClass();
        seed.set('name', seedData.name);
      }

      seed.set('version', seedData.version || '1.0.0');
      seed.set('executedAt', new Date());
      seed.set('environment', process.env.NODE_ENV || 'development');
      seed.set('status', seedData.status || 'completed');
      seed.set('idempotent', seedData.idempotent !== false);
      seed.set('statistics', seedData.statistics || {
        created: 0,
        skipped: 0,
        errors: 0,
      });

      const saved = await seed.save(null, { useMasterKey: true });

      logger.info('Seed execution recorded', {
        name: seedData.name,
        status: seedData.status,
        statistics: seedData.statistics,
      });

      return {
        id: saved.id,
        parseObject: saved,
      };
    } catch (error) {
      logger.error('Failed to record seed execution', {
        seedName: seedData.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get seed statistics
   * @returns {Promise<object>} Statistics
   */
  async getStatistics() {
    try {
      const seeds = await this.getExecutedSeeds();

      const stats = {
        total: seeds.length,
        completed: seeds.filter((s) => s.status === 'completed').length,
        failed: seeds.filter((s) => s.status === 'failed').length,
        idempotent: seeds.filter((s) => s.idempotent).length,
        totalCreated: 0,
        totalSkipped: 0,
        totalErrors: 0,
        byEnvironment: {},
      };

      // Aggregate statistics
      seeds.forEach((seed) => {
        if (seed.statistics) {
          stats.totalCreated += seed.statistics.created || 0;
          stats.totalSkipped += seed.statistics.skipped || 0;
          stats.totalErrors += seed.statistics.errors || 0;
        }

        const env = seed.environment || 'unknown';
        if (!stats.byEnvironment[env]) {
          stats.byEnvironment[env] = 0;
        }
        stats.byEnvironment[env]++;
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get seed statistics', {
        error: error.message,
      });
      return {
        total: 0,
        completed: 0,
        failed: 0,
        idempotent: 0,
        totalCreated: 0,
        totalSkipped: 0,
        totalErrors: 0,
        byEnvironment: {},
      };
    }
  }

  /**
   * Reset seed tracking (for development/testing)
   * DANGEROUS: Only use in non-production environments
   * @param {string} seedName - Optional: reset specific seed, or all if not provided
   */
  async reset(seedName = null) {
    // Security check
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot reset seed tracking in production environment');
    }

    try {
      const SeedClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(SeedClass);

      if (seedName) {
        query.equalTo('name', seedName);
      }

      const toDelete = await query.find({ useMasterKey: true });

      for (const seed of toDelete) {
        await seed.destroy({ useMasterKey: true });
      }

      logger.warn('Seed tracking reset', {
        seedName: seedName || 'ALL',
        deleted: toDelete.length,
      });

      return toDelete.length;
    } catch (error) {
      logger.error('Failed to reset seed tracking', {
        seedName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark seed as failed
   * @param {string} seedName - Seed name
   * @param {Error} error - Error that occurred
   */
  async recordFailure(seedName, error) {
    try {
      const existing = await this.getSeed(seedName);

      const SeedClass = Parse.Object.extend(this.collectionName);
      let seed;

      if (existing && existing.parseObject) {
        seed = existing.parseObject;
      } else {
        seed = new SeedClass();
        seed.set('name', seedName);
      }

      seed.set('status', 'failed');
      seed.set('executedAt', new Date());
      seed.set('environment', process.env.NODE_ENV || 'development');
      seed.set('error', {
        message: error.message,
        stack: error.stack,
      });

      await seed.save(null, { useMasterKey: true });

      logger.error('Seed execution failed', {
        name: seedName,
        error: error.message,
      });
    } catch (err) {
      logger.error('Failed to record seed failure', {
        seedName,
        error: err.message,
      });
    }
  }
}

module.exports = SeedTracker;
