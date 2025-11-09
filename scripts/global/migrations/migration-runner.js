#!/usr/bin/env node

/**
 * Migration Runner - Database Migration Orchestrator
 *
 * Professional migration system similar to Django, Laravel, or Knex.js
 *
 * Features:
 * - Sequential execution in numeric order
 * - Checksum validation to detect file modifications
 * - Lock mechanism to prevent concurrent execution
 * - Rollback support
 * - Dry-run mode
 * - Production confirmations
 * - Complete audit trail
 *
 * Usage:
 *   yarn migrate                    # Run pending migrations
 *   yarn migrate --status           # Show migration status
 *   yarn migrate --rollback         # Rollback last migration
 *   yarn migrate --dry-run          # Show what would be executed
 *   yarn migrate --verbose          # Detailed logging
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 * @security PCI DSS Compliant - Production safeguards
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const MigrationTracker = require('./migration-tracker');
const logger = require('../../../src/infrastructure/logger');

// Command line options
const options = {
  status: process.argv.includes('--status'),
  rollback: process.argv.includes('--rollback'),
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  force: process.argv.includes('--force'),
  reset: process.argv.includes('--reset'),
  fresh: process.argv.includes('--fresh'),
};

// Console colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Logger for migration output
 */
class MigrationLogger {
  log(message, color = 'reset') {
    const timestamp = new Date().toISOString();
    const prefix = options.verbose ? `[${timestamp}] ` : '';
    console.log(`${colors[color]}${prefix}${message}${colors.reset}`);
  }

  success(message) {
    this.log(`✅ ${message}`, 'green');
  }

  error(message) {
    this.log(`❌ ${message}`, 'red');
  }

  warning(message) {
    this.log(`⚠️  ${message}`, 'yellow');
  }

  info(message) {
    this.log(`ℹ️  ${message}`, 'cyan');
  }

  section(message) {
    this.log(`\n${'='.repeat(70)}`, 'bright');
    this.log(message, 'bright');
    this.log('='.repeat(70), 'bright');
  }
}

const cliLogger = new MigrationLogger();

/**
 * Migration Runner class
 */
class MigrationRunner {
  constructor() {
    this.tracker = new MigrationTracker();
    this.migrationsDir = path.join(__dirname, '../../migrations');
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Initialize the migration system
   */
  async initialize() {
    try {
      await this.tracker.initialize();
      cliLogger.success('Migration system initialized');

      if (options.verbose) {
        cliLogger.info(`Environment: ${this.environment}`);
        cliLogger.info(`Migrations directory: ${this.migrationsDir}`);
      }
    } catch (error) {
      cliLogger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Scan migrations directory and get all migration files
   * @returns {Promise<Array>} Array of migration file info
   */
  async scanMigrations() {
    try {
      const files = await fs.readdir(this.migrationsDir);

      // Filter and sort migration files (format: 001-name.js, 002-name.js, etc.)
      const migrationFiles = files
        .filter(file => file.match(/^\d{3}-.*\.js$/))
        .sort();

      const migrations = [];

      for (const file of migrationFiles) {
        const filePath = path.join(this.migrationsDir, file);
        const migrationName = file.replace('.js', '');

        // Load migration module
        let migration;
        try {
          delete require.cache[require.resolve(filePath)]; // Clear cache
          migration = require(filePath);
        } catch (error) {
          cliLogger.warning(`Failed to load migration ${file}: ${error.message}`);
          continue;
        }

        // Calculate checksum
        const checksum = await this.tracker.calculateChecksum(filePath);

        migrations.push({
          name: migrationName,
          file,
          filePath,
          version: migration.version || '1.0.0',
          description: migration.description || migrationName,
          module: migration,
          checksum,
          rollbackAvailable: typeof migration.down === 'function',
        });
      }

      return migrations;
    } catch (error) {
      cliLogger.error(`Failed to scan migrations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get pending migrations (not yet executed)
   * @returns {Promise<Array>} Array of pending migrations
   */
  async getPendingMigrations() {
    const allMigrations = await this.scanMigrations();
    const executed = await this.tracker.getExecutedMigrations();
    const executedNames = new Set(
      executed.filter(m => m.status === 'completed').map(m => m.name)
    );

    const pending = allMigrations.filter(m => !executedNames.has(m.name));

    // Verify checksums for executed migrations
    for (const migration of allMigrations) {
      if (executedNames.has(migration.name)) {
        const isValid = await this.tracker.verifyChecksum(migration.name, migration.checksum);
        if (!isValid) {
          cliLogger.warning(
            `Migration ${migration.name} has been modified after execution!`
          );
        }
      }
    }

    return pending;
  }

  /**
   * Display migration status
   */
  async showStatus() {
    cliLogger.section('Migration Status');

    const allMigrations = await this.scanMigrations();
    const executed = await this.tracker.getExecutedMigrations();
    const executedMap = new Map(executed.map(m => [m.name, m]));

    console.log('\nMigrations:\n');
    console.log('Status'.padEnd(12) + 'Name'.padEnd(40) + 'Executed At');
    console.log('-'.repeat(80));

    for (const migration of allMigrations) {
      const record = executedMap.get(migration.name);

      if (record) {
        let status = '';
        let color = 'reset';

        switch (record.status) {
          case 'completed':
            status = '✅ DONE';
            color = 'green';
            break;
          case 'failed':
            status = '❌ FAILED';
            color = 'red';
            break;
          case 'rolled_back':
            status = '⏪ ROLLED BACK';
            color = 'yellow';
            break;
          case 'running':
            status = '▶️  RUNNING';
            color = 'cyan';
            break;
        }

        const executedAt = record.executedAt
          ? new Date(record.executedAt).toLocaleString()
          : 'N/A';

        cliLogger.log(
          status.padEnd(12) + migration.name.padEnd(40) + executedAt,
          color
        );
      } else {
        cliLogger.log(
          '⏸️  PENDING'.padEnd(12) + migration.name.padEnd(40) + '-',
          'yellow'
        );
      }
    }

    // Show statistics
    const stats = await this.tracker.getStatistics();
    console.log('\n' + '='.repeat(80));
    console.log(`Total: ${stats.total} | Completed: ${stats.completed} | Failed: ${stats.failed} | Rolled Back: ${stats.rolledBack}`);

    if (stats.totalDuration > 0) {
      console.log(`Total execution time: ${(stats.totalDuration / 1000).toFixed(2)}s`);
    }

    console.log('');
  }

  /**
   * Execute a single migration
   * @param {object} migration - Migration info
   * @returns {Promise<object>} Execution result
   */
  async executeMigration(migration) {
    const startTime = Date.now();

    try {
      cliLogger.info(`Executing migration: ${migration.name}`);

      if (options.dryRun) {
        cliLogger.info('[DRY RUN] Would execute migration');
        return { success: true, dryRun: true };
      }

      // Check if migration has up() function
      if (typeof migration.module.up !== 'function') {
        throw new Error('Migration must export an up() function');
      }

      // Record start in tracker
      const record = await this.tracker.recordStart({
        name: migration.name,
        version: migration.version,
        checksum: migration.checksum,
        rollbackAvailable: migration.rollbackAvailable,
      });

      // Execute migration
      const result = await migration.module.up();

      // Record completion
      await this.tracker.recordComplete(record.id, {
        metadata: result || {},
      });

      const duration = Date.now() - startTime;
      cliLogger.success(
        `Migration completed: ${migration.name} (${duration}ms)`
      );

      return { success: true, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      cliLogger.error(
        `Migration failed: ${migration.name} - ${error.message}`
      );

      // Try to record failure (may fail if recordStart failed)
      try {
        const existing = await this.tracker.getMigration(migration.name);
        if (existing) {
          await this.tracker.recordFailure(existing.id, error);
        }
      } catch (trackError) {
        logger.error('Failed to record migration failure', {
          migration: migration.name,
          error: trackError.message,
        });
      }

      return { success: false, duration, error };
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations() {
    // Acquire lock
    const lock = await this.tracker.acquireLock();
    if (!lock) {
      cliLogger.error('Another migration process is already running');
      cliLogger.info('If this is an error, wait 5 minutes or check _migration_locks collection');
      return;
    }

    try {
      const pending = await this.getPendingMigrations();

      if (pending.length === 0) {
        cliLogger.success('No pending migrations');
        return;
      }

      cliLogger.section(`Found ${pending.length} Pending Migration(s)`);

      // Show what will be executed
      console.log('');
      pending.forEach((m, i) => {
        cliLogger.info(`${i + 1}. ${m.name}`);
      });
      console.log('');

      // Confirm in production
      if (this.environment === 'production' && !options.force && !options.dryRun) {
        const confirmed = await this.confirmProduction();
        if (!confirmed) {
          cliLogger.warning('Migration cancelled');
          return;
        }
      }

      // Execute migrations sequentially
      let successCount = 0;
      let failureCount = 0;

      for (const migration of pending) {
        const result = await this.executeMigration(migration);

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          cliLogger.error('Migration failed, stopping execution');
          break; // Stop on first failure
        }
      }

      // Summary
      console.log('');
      cliLogger.section('Migration Summary');
      cliLogger.success(`Executed: ${successCount}`);

      if (failureCount > 0) {
        cliLogger.error(`Failed: ${failureCount}`);
      }

      if (options.dryRun) {
        cliLogger.info('[DRY RUN] No changes were made to the database');
      }

      console.log('');
    } finally {
      // Always release lock
      await this.tracker.releaseLock(lock.id);
    }
  }

  /**
   * Rollback last migration
   */
  async rollbackMigration() {
    try {
      const executed = await this.tracker.getExecutedMigrations();
      const completed = executed
        .filter(m => m.status === 'completed')
        .sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt));

      if (completed.length === 0) {
        cliLogger.warning('No migrations to rollback');
        return;
      }

      const lastMigration = completed[0];
      cliLogger.section(`Rollback Migration: ${lastMigration.name}`);

      // Load migration file
      const allMigrations = await this.scanMigrations();
      const migration = allMigrations.find(m => m.name === lastMigration.name);

      if (!migration) {
        cliLogger.error(`Migration file not found: ${lastMigration.name}`);
        return;
      }

      if (!migration.rollbackAvailable) {
        cliLogger.error('This migration does not support rollback (no down() function)');
        return;
      }

      // Confirm in production
      if (this.environment === 'production' && !options.force) {
        const confirmed = await this.confirmProduction(
          `ROLLBACK ${lastMigration.name}`
        );
        if (!confirmed) {
          cliLogger.warning('Rollback cancelled');
          return;
        }
      }

      if (options.dryRun) {
        cliLogger.info('[DRY RUN] Would rollback migration');
        return;
      }

      // Execute rollback
      cliLogger.info(`Rolling back: ${migration.name}`);
      const startTime = Date.now();

      await migration.module.down();

      const duration = Date.now() - startTime;

      // Record rollback
      await this.tracker.recordRollback(migration.name, {
        duration,
        rolledBackAt: new Date(),
      });

      cliLogger.success(`Rollback completed: ${migration.name} (${duration}ms)`);
    } catch (error) {
      cliLogger.error(`Rollback failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset all migrations (DANGEROUS - dev only)
   */
  async resetMigrations() {
    if (this.environment === 'production') {
      throw new Error('Cannot reset migrations in production');
    }

    cliLogger.section('Reset All Migrations');
    cliLogger.warning('This will remove all migration records from the database');
    cliLogger.warning('This does NOT undo the actual database changes!');
    console.log('');

    if (!options.force) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise(resolve => {
        rl.question('Type "RESET" to confirm: ', resolve);
        rl.close();
      });

      if (answer !== 'RESET') {
        cliLogger.warning('Reset cancelled');
        return;
      }
    }

    // Get all migrations and delete tracking records
    const executed = await this.tracker.getExecutedMigrations();

    for (const migration of executed) {
      const record = await this.tracker.getMigration(migration.name);
      if (record && record.parseObject) {
        await record.parseObject.destroy({ useMasterKey: true });
      }
    }

    cliLogger.success(`Reset ${executed.length} migration record(s)`);
  }

  /**
   * Fresh migrations (reset + run all)
   */
  async freshMigrations() {
    if (this.environment === 'production') {
      throw new Error('Cannot run fresh migrations in production');
    }

    cliLogger.section('Fresh Migrations (Reset + Run All)');

    await this.resetMigrations();
    await this.runMigrations();
  }

  /**
   * Confirm operation in production
   * @param {string} action - Action to confirm
   * @returns {Promise<boolean>} True if confirmed
   */
  async confirmProduction(action = 'MIGRATE') {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('');
    cliLogger.warning('⚠️  PRODUCTION ENVIRONMENT ⚠️');
    console.log('');

    const answer = await new Promise(resolve => {
      rl.question(`Type "EXECUTE ${action}" to confirm: `, resolve);
      rl.close();
    });

    return answer === `EXECUTE ${action}`;
  }
}

/**
 * Main execution function
 */
async function main() {
  const runner = new MigrationRunner();

  try {
    await runner.initialize();

    if (options.status) {
      await runner.showStatus();
    } else if (options.rollback) {
      await runner.rollbackMigration();
    } else if (options.reset) {
      await runner.resetMigrations();
    } else if (options.fresh) {
      await runner.freshMigrations();
    } else {
      await runner.runMigrations();
    }

    process.exit(0);
  } catch (error) {
    cliLogger.error(`Migration runner failed: ${error.message}`);

    if (options.verbose) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MigrationRunner;
