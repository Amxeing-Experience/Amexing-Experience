#!/usr/bin/env node

/**
 * Migration Tracker - State Persistence System
 *
 * Manages the _migrations collection in MongoDB to track:
 * - Which migrations have been executed
 * - When they were executed
 * - Execution status and duration
 * - Checksums for detecting modifications
 * - Rollback availability
 *
 * This provides complete audit trail and prevents duplicate execution.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 * @security PCI DSS Compliant - Complete audit logging
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const fs = require('fs').promises;
const logger = require('../../../src/infrastructure/logger');

/**
 * MigrationTracker class for managing migration state
 */
class MigrationTracker {
  constructor() {
    this.collectionName = 'MigrationExecution';
    this.lockCollectionName = 'MigrationLock';
    this.lockTimeout = 300000; // 5 minutes
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

    logger.info('Migration Tracker initialized', {
      serverURL: Parse.serverURL,
      environment: process.env.NODE_ENV || 'development',
    });
  }

  /**
   * Calculate SHA256 checksum of migration file
   * @param {string} filePath - Path to migration file
   * @returns {Promise<string>} Checksum hash
   */
  async calculateChecksum(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      logger.warn('Failed to calculate checksum', {
        filePath,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get all executed migrations
   * @returns {Promise<Array>} Array of migration records
   */
  async getExecutedMigrations() {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      query.ascending('name');
      query.limit(1000);

      const results = await query.find({ useMasterKey: true });

      return results.map((migration) => ({
        name: migration.get('name'),
        version: migration.get('version'),
        executedAt: migration.get('executedAt'),
        environment: migration.get('environment'),
        status: migration.get('status'),
        duration: migration.get('duration'),
        checksum: migration.get('checksum'),
        rollbackAvailable: migration.get('rollbackAvailable'),
        metadata: migration.get('metadata'),
      }));
    } catch (error) {
      logger.error('Failed to get executed migrations', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if migration has been executed
   * @param {string} migrationName - Migration name
   * @returns {Promise<boolean>} True if executed
   */
  async isExecuted(migrationName) {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      query.equalTo('name', migrationName);
      query.equalTo('status', 'completed');

      const count = await query.count({ useMasterKey: true });
      return count > 0;
    } catch (error) {
      logger.error('Failed to check migration status', {
        migrationName,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get migration record
   * @param {string} migrationName - Migration name
   * @returns {Promise<object|null>} Migration record or null
   */
  async getMigration(migrationName) {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      query.equalTo('name', migrationName);

      const migration = await query.first({ useMasterKey: true });

      if (!migration) {
        return null;
      }

      return {
        id: migration.id,
        name: migration.get('name'),
        version: migration.get('version'),
        executedAt: migration.get('executedAt'),
        environment: migration.get('environment'),
        status: migration.get('status'),
        duration: migration.get('duration'),
        checksum: migration.get('checksum'),
        rollbackAvailable: migration.get('rollbackAvailable'),
        metadata: migration.get('metadata'),
        parseObject: migration,
      };
    } catch (error) {
      logger.error('Failed to get migration', {
        migrationName,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Record migration execution start
   * @param {object} migrationData - Migration information
   * @returns {Promise<object>} Created record
   */
  async recordStart(migrationData) {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const migration = new MigrationClass();

      migration.set('name', migrationData.name);
      migration.set('version', migrationData.version || '1.0.0');
      migration.set('executedAt', new Date());
      migration.set('environment', process.env.NODE_ENV || 'development');
      migration.set('status', 'running');
      migration.set('checksum', migrationData.checksum);
      migration.set('rollbackAvailable', migrationData.rollbackAvailable || false);
      migration.set('metadata', migrationData.metadata || {});

      const saved = await migration.save(null, { useMasterKey: true });

      logger.info('Migration started', {
        name: migrationData.name,
        id: saved.id,
      });

      return {
        id: saved.id,
        parseObject: saved,
      };
    } catch (error) {
      logger.error('Failed to record migration start', {
        migrationName: migrationData.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update migration status to completed
   * @param {string} migrationId - Migration record ID
   * @param {object} result - Migration execution result
   */
  async recordComplete(migrationId, result = {}) {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      const migration = await query.get(migrationId, { useMasterKey: true });

      const executedAt = migration.get('executedAt');
      const duration = new Date() - executedAt;

      migration.set('status', 'completed');
      migration.set('duration', duration);
      migration.set('completedAt', new Date());

      if (result.metadata) {
        const existingMetadata = migration.get('metadata') || {};
        migration.set('metadata', { ...existingMetadata, ...result.metadata });
      }

      await migration.save(null, { useMasterKey: true });

      logger.info('Migration completed', {
        id: migrationId,
        name: migration.get('name'),
        duration: `${duration}ms`,
      });
    } catch (error) {
      logger.error('Failed to record migration completion', {
        migrationId,
        error: error.message,
      });
    }
  }

  /**
   * Update migration status to failed
   * @param {string} migrationId - Migration record ID
   * @param {Error} error - Error that occurred
   */
  async recordFailure(migrationId, error) {
    try {
      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      const migration = await query.get(migrationId, { useMasterKey: true });

      const executedAt = migration.get('executedAt');
      const duration = new Date() - executedAt;

      migration.set('status', 'failed');
      migration.set('duration', duration);
      migration.set('completedAt', new Date());
      migration.set('error', {
        message: error.message,
        stack: error.stack,
      });

      await migration.save(null, { useMasterKey: true });

      logger.error('Migration failed', {
        id: migrationId,
        name: migration.get('name'),
        error: error.message,
        duration: `${duration}ms`,
      });
    } catch (err) {
      logger.error('Failed to record migration failure', {
        migrationId,
        error: err.message,
      });
    }
  }

  /**
   * Record rollback execution
   * @param {string} migrationName - Migration name
   * @param {object} rollbackData - Rollback information
   */
  async recordRollback(migrationName, rollbackData = {}) {
    try {
      const existing = await this.getMigration(migrationName);
      if (!existing) {
        throw new Error(`Migration ${migrationName} not found`);
      }

      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);
      const migration = await query.get(existing.id, { useMasterKey: true });

      migration.set('status', 'rolled_back');
      migration.set('rolledBackAt', new Date());
      migration.set('rollbackMetadata', rollbackData);

      await migration.save(null, { useMasterKey: true });

      logger.info('Migration rolled back', {
        name: migrationName,
        id: existing.id,
      });
    } catch (error) {
      logger.error('Failed to record rollback', {
        migrationName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Verify checksum hasn't changed
   * @param {string} migrationName - Migration name
   * @param {string} currentChecksum - Current file checksum
   * @returns {Promise<boolean>} True if checksum matches
   */
  async verifyChecksum(migrationName, currentChecksum) {
    try {
      const existing = await this.getMigration(migrationName);
      if (!existing) {
        return true; // No previous record, consider valid
      }

      const storedChecksum = existing.checksum;
      if (!storedChecksum) {
        return true; // No stored checksum, consider valid
      }

      const matches = storedChecksum === currentChecksum;

      if (!matches) {
        logger.warn('Migration checksum mismatch detected', {
          migrationName,
          storedChecksum,
          currentChecksum,
        });
      }

      return matches;
    } catch (error) {
      logger.error('Failed to verify checksum', {
        migrationName,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Acquire lock for migration execution
   * Prevents concurrent execution of migrations
   * @returns {Promise<object|null>} Lock object or null if locked
   */
  async acquireLock() {
    try {
      const LockClass = Parse.Object.extend(this.lockCollectionName);

      // Check for existing lock
      const checkQuery = new Parse.Query(LockClass);
      checkQuery.equalTo('name', 'migration_execution');
      const existingLock = await checkQuery.first({ useMasterKey: true });

      if (existingLock) {
        const lockedAt = existingLock.get('lockedAt');
        const now = new Date();
        const lockAge = now - lockedAt;

        // If lock is older than timeout, consider it stale and remove
        if (lockAge > this.lockTimeout) {
          logger.warn('Removing stale migration lock', {
            lockAge: `${lockAge}ms`,
            timeout: `${this.lockTimeout}ms`,
          });
          await existingLock.destroy({ useMasterKey: true });
        } else {
          logger.warn('Migration already in progress', {
            lockedBy: existingLock.get('lockedBy'),
            lockedAt: lockedAt,
          });
          return null;
        }
      }

      // Create new lock
      const lock = new LockClass();
      lock.set('name', 'migration_execution');
      lock.set('lockedAt', new Date());
      lock.set('lockedBy', `${process.env.NODE_ENV || 'development'}-${process.pid}`);

      const savedLock = await lock.save(null, { useMasterKey: true });

      logger.info('Migration lock acquired', {
        id: savedLock.id,
        lockedBy: savedLock.get('lockedBy'),
      });

      return {
        id: savedLock.id,
        parseObject: savedLock,
      };
    } catch (error) {
      logger.error('Failed to acquire migration lock', {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Release migration lock
   * @param {string} lockId - Lock ID to release
   */
  async releaseLock(lockId) {
    try {
      if (!lockId) {
        return;
      }

      const LockClass = Parse.Object.extend(this.lockCollectionName);
      const query = new Parse.Query(LockClass);
      const lock = await query.get(lockId, { useMasterKey: true });

      await lock.destroy({ useMasterKey: true });

      logger.info('Migration lock released', {
        id: lockId,
      });
    } catch (error) {
      logger.error('Failed to release migration lock', {
        lockId,
        error: error.message,
      });
    }
  }

  /**
   * Get migration statistics
   * @returns {Promise<object>} Statistics
   */
  async getStatistics() {
    try {
      const migrations = await this.getExecutedMigrations();

      const stats = {
        total: migrations.length,
        completed: migrations.filter((m) => m.status === 'completed').length,
        failed: migrations.filter((m) => m.status === 'failed').length,
        rolledBack: migrations.filter((m) => m.status === 'rolled_back').length,
        running: migrations.filter((m) => m.status === 'running').length,
        totalDuration: migrations.reduce((sum, m) => sum + (m.duration || 0), 0),
        byEnvironment: {},
      };

      // Group by environment
      migrations.forEach((migration) => {
        const env = migration.environment || 'unknown';
        if (!stats.byEnvironment[env]) {
          stats.byEnvironment[env] = 0;
        }
        stats.byEnvironment[env]++;
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get migration statistics', {
        error: error.message,
      });
      return {
        total: 0,
        completed: 0,
        failed: 0,
        rolledBack: 0,
        running: 0,
        totalDuration: 0,
        byEnvironment: {},
      };
    }
  }

  /**
   * Clean up old failed/rolled back migrations
   * Useful for development environments
   * @param {number} daysOld - Remove records older than this many days
   */
  async cleanup(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const MigrationClass = Parse.Object.extend(this.collectionName);
      const query = new Parse.Query(MigrationClass);

      // Only clean up failed or rolled back
      query.containedIn('status', ['failed', 'rolled_back']);
      query.lessThan('executedAt', cutoffDate);

      const toDelete = await query.find({ useMasterKey: true });

      for (const migration of toDelete) {
        await migration.destroy({ useMasterKey: true });
      }

      logger.info('Migration cleanup completed', {
        deleted: toDelete.length,
        cutoffDate: cutoffDate.toISOString(),
      });

      return toDelete.length;
    } catch (error) {
      logger.error('Failed to cleanup old migrations', {
        error: error.message,
      });
      return 0;
    }
  }
}

module.exports = MigrationTracker;
