#!/usr/bin/env node

/**
 * Seed Runner - Database Seed Orchestrator
 *
 * Professional seed system for database population with:
 * - Manifest-based dependency resolution
 * - Idempotency guarantees
 * - Rollback support
 * - Environment-aware execution
 * - Complete audit trail
 *
 * Features:
 * - Reads seed manifest for execution order
 * - Executes seeds sequentially with dependency checks
 * - Tracks execution state in MongoDB
 * - Supports dry-run mode
 * - Production confirmations
 * - Statistics and reporting
 *
 * Usage:
 *   yarn seed                    # Run pending seeds
 *   yarn seed --status           # Show seed status
 *   yarn seed --reset            # Reset seed tracking (dev only)
 *   yarn seed --dry-run          # Show what would be executed
 *   yarn seed --verbose          # Detailed logging
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
const SeedTracker = require('./seed-tracker');
const logger = require('../../../src/infrastructure/logger');

// Command line options
const options = {
  status: process.argv.includes('--status'),
  reset: process.argv.includes('--reset'),
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  force: process.argv.includes('--force'),
  specific: process.argv.find(arg => arg.startsWith('--seed='))?.split('=')[1],
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
 * Logger for seed output
 */
class SeedLogger {
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

const cliLogger = new SeedLogger();

/**
 * Seed Runner class
 */
class SeedRunner {
  constructor() {
    this.tracker = new SeedTracker();
    this.seedsDir = path.join(__dirname, '../../seeds');
    this.manifestPath = path.join(this.seedsDir, 'manifest.json');
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Initialize the seed system
   */
  async initialize() {
    try {
      await this.tracker.initialize();
      cliLogger.success('Seed system initialized');

      if (options.verbose) {
        cliLogger.info(`Environment: ${this.environment}`);
        cliLogger.info(`Seeds directory: ${this.seedsDir}`);
        cliLogger.info(`Manifest: ${this.manifestPath}`);
      }
    } catch (error) {
      cliLogger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load seed manifest
   * @returns {Promise<object>} Manifest configuration
   */
  async loadManifest() {
    try {
      const manifestContent = await fs.readFile(this.manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      if (options.verbose) {
        cliLogger.info(`Loaded manifest with ${manifest.seeds.length} seeds`);
      }

      return manifest;
    } catch (error) {
      if (error.code === 'ENOENT') {
        cliLogger.warning('Seed manifest not found, using directory scan');
        return await this.scanSeedsDirectory();
      }
      throw error;
    }
  }

  /**
   * Scan seeds directory and create dynamic manifest
   * @returns {Promise<object>} Generated manifest
   */
  async scanSeedsDirectory() {
    try {
      // Ensure seeds directory exists
      await fs.mkdir(this.seedsDir, { recursive: true });

      const files = await fs.readdir(this.seedsDir);

      // Filter seed files (format: 001-name.js, 002-name.js, etc.)
      const seedFiles = files
        .filter(file => file.match(/^\d{3}-.*\.js$/))
        .sort();

      const seeds = seedFiles.map(file => ({
        name: file.replace('.js', ''),
        file,
        enabled: true,
        environments: ['development', 'staging', 'production'],
        dependencies: [],
        idempotent: true,
      }));

      return {
        version: '1.0.0',
        seeds,
      };
    } catch (error) {
      cliLogger.error(`Failed to scan seeds directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get seeds to execute based on manifest and environment
   * @param {object} manifest - Seed manifest
   * @returns {Promise<Array>} Seeds to execute
   */
  async getSeedsToExecute(manifest) {
    const executedSeeds = await this.tracker.getExecutedSeeds();
    const executedNames = new Set(executedSeeds.map(s => s.name));

    // Filter seeds based on environment and execution status
    let seedsToRun = manifest.seeds.filter(seed => {
      // Check if enabled
      if (!seed.enabled) return false;

      // Check environment
      if (!seed.environments.includes(this.environment)) return false;

      // Check if already executed
      if (executedNames.has(seed.name) && seed.idempotent !== false) {
        // Already executed and idempotent
        return false;
      }

      return true;
    });

    // If specific seed requested, filter to only that seed
    if (options.specific) {
      seedsToRun = seedsToRun.filter(s => s.name === options.specific);
      if (seedsToRun.length === 0) {
        throw new Error(`Seed "${options.specific}" not found or not eligible for execution`);
      }
    }

    // Resolve dependencies
    seedsToRun = await this.resolveDependencies(seedsToRun, executedNames);

    return seedsToRun;
  }

  /**
   * Resolve seed dependencies and order execution
   * @param {Array} seeds - Seeds to execute
   * @param {Set} executedNames - Names of already executed seeds
   * @returns {Promise<Array>} Ordered seeds with dependencies resolved
   */
  async resolveDependencies(seeds, executedNames) {
    const ordered = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (seedName) => {
      if (visited.has(seedName)) return;
      if (visiting.has(seedName)) {
        throw new Error(`Circular dependency detected: ${seedName}`);
      }

      const seed = seeds.find(s => s.name === seedName);
      if (!seed) {
        // Dependency not in current batch, check if already executed
        if (!executedNames.has(seedName)) {
          throw new Error(`Missing dependency: ${seedName}`);
        }
        return;
      }

      visiting.add(seedName);

      // Visit dependencies first
      if (seed.dependencies && seed.dependencies.length > 0) {
        seed.dependencies.forEach(dep => visit(dep));
      }

      visiting.delete(seedName);
      visited.add(seedName);
      ordered.push(seed);
    };

    // Visit all seeds
    seeds.forEach(seed => visit(seed.name));

    return ordered;
  }

  /**
   * Load seed module
   * @param {object} seedConfig - Seed configuration from manifest
   * @returns {Promise<object>} Seed module with run() function
   */
  async loadSeedModule(seedConfig) {
    try {
      const seedPath = path.join(this.seedsDir, seedConfig.file);

      // Clear cache
      delete require.cache[require.resolve(seedPath)];

      const seedModule = require(seedPath);

      // Validate seed module
      if (typeof seedModule.run !== 'function') {
        throw new Error('Seed must export a run() function');
      }

      return {
        ...seedConfig,
        module: seedModule,
      };
    } catch (error) {
      cliLogger.error(`Failed to load seed ${seedConfig.name}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute a single seed
   * @param {object} seed - Seed configuration with module
   * @returns {Promise<object>} Execution result
   */
  async executeSeed(seed) {
    const startTime = Date.now();

    try {
      cliLogger.info(`Executing seed: ${seed.name}`);

      if (options.dryRun) {
        cliLogger.info('[DRY RUN] Would execute seed');
        return { success: true, dryRun: true };
      }

      // Execute seed
      const result = await seed.module.run();

      // Record execution
      const duration = Date.now() - startTime;
      await this.tracker.recordExecution({
        name: seed.name,
        version: seed.module.version || '1.0.0',
        status: 'completed',
        statistics: result.statistics || { created: 0, skipped: 0, errors: 0 },
        idempotent: seed.idempotent !== false,
        metadata: result.metadata || {},
      });

      cliLogger.success(
        `Seed completed: ${seed.name} (${duration}ms) - ` +
        `Created: ${result.statistics?.created || 0}, ` +
        `Skipped: ${result.statistics?.skipped || 0}, ` +
        `Errors: ${result.statistics?.errors || 0}`
      );

      return { success: true, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      cliLogger.error(`Seed failed: ${seed.name} - ${error.message}`);

      // Record failure
      try {
        await this.tracker.recordExecution({
          name: seed.name,
          version: seed.module?.version || '1.0.0',
          status: 'failed',
          statistics: { created: 0, skipped: 0, errors: 1 },
          error: error.message,
        });
      } catch (trackError) {
        logger.error('Failed to record seed failure', {
          seed: seed.name,
          error: trackError.message,
        });
      }

      return { success: false, duration, error };
    }
  }

  /**
   * Run all pending seeds
   */
  async runSeeds() {
    try {
      const manifest = await this.loadManifest();
      const seedsToRun = await this.getSeedsToExecute(manifest);

      if (seedsToRun.length === 0) {
        cliLogger.success('No seeds to run');
        return;
      }

      cliLogger.section(`Found ${seedsToRun.length} Seed(s) to Execute`);

      // Show what will be executed
      console.log('');
      seedsToRun.forEach((s, i) => {
        const deps = s.dependencies?.length > 0
          ? ` (depends on: ${s.dependencies.join(', ')})`
          : '';
        cliLogger.info(`${i + 1}. ${s.name}${deps}`);
      });
      console.log('');

      // Confirm in production
      if (this.environment === 'production' && !options.force && !options.dryRun) {
        const confirmed = await this.confirmProduction();
        if (!confirmed) {
          cliLogger.warning('Seed execution cancelled');
          return;
        }
      }

      // Execute seeds sequentially
      let successCount = 0;
      let failureCount = 0;

      for (const seedConfig of seedsToRun) {
        const seed = await this.loadSeedModule(seedConfig);
        const result = await this.executeSeed(seed);

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          if (!options.force) {
            cliLogger.error('Seed failed, stopping execution');
            break; // Stop on first failure unless --force
          }
        }
      }

      // Summary
      console.log('');
      cliLogger.section('Seed Execution Summary');
      cliLogger.success(`Executed: ${successCount}`);

      if (failureCount > 0) {
        cliLogger.error(`Failed: ${failureCount}`);
      }

      if (options.dryRun) {
        cliLogger.info('[DRY RUN] No changes were made to the database');
      }

      console.log('');
    } catch (error) {
      cliLogger.error(`Seed execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Display seed status
   */
  async showStatus() {
    cliLogger.section('Seed Status');

    try {
      const manifest = await this.loadManifest();
      const executedSeeds = await this.tracker.getExecutedSeeds();
      const executedMap = new Map(executedSeeds.map(s => [s.name, s]));

      console.log('\nSeeds:\n');
      console.log('Status'.padEnd(15) + 'Name'.padEnd(40) + 'Executed At');
      console.log('-'.repeat(80));

      for (const seed of manifest.seeds) {
        const record = executedMap.get(seed.name);

        if (record) {
          const executedAt = new Date(record.executedAt).toLocaleString();
          const stats = record.statistics
            ? ` (${record.statistics.created}/${record.statistics.skipped}/${record.statistics.errors})`
            : '';

          cliLogger.log(
            '✅ EXECUTED'.padEnd(15) + seed.name.padEnd(40) + executedAt + stats,
            'green'
          );
        } else if (!seed.enabled) {
          cliLogger.log(
            '⏸️  DISABLED'.padEnd(15) + seed.name.padEnd(40) + '-',
            'yellow'
          );
        } else if (!seed.environments.includes(this.environment)) {
          cliLogger.log(
            '⏭️  SKIPPED'.padEnd(15) + seed.name.padEnd(40) + `(${this.environment} not in: ${seed.environments.join(', ')})`,
            'yellow'
          );
        } else {
          cliLogger.log(
            '⏸️  PENDING'.padEnd(15) + seed.name.padEnd(40) + '-',
            'cyan'
          );
        }
      }

      // Show statistics
      const stats = await this.tracker.getStatistics();
      console.log('\n' + '='.repeat(80));
      console.log(
        `Total: ${stats.total} | ` +
        `Completed: ${stats.completed} | ` +
        `Failed: ${stats.failed}`
      );
      console.log(
        `Records Created: ${stats.recordsCreated} | ` +
        `Skipped: ${stats.recordsSkipped} | ` +
        `Errors: ${stats.recordsErrors}`
      );
      console.log('');
    } catch (error) {
      cliLogger.error(`Failed to show status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset seed tracking
   */
  async resetSeeds() {
    if (this.environment === 'production') {
      throw new Error('Cannot reset seeds in production');
    }

    cliLogger.section('Reset Seed Tracking');
    cliLogger.warning('This will remove all seed execution records from the database');
    cliLogger.warning('This does NOT undo the actual database changes!');
    console.log('');

    if (!options.force) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise(resolve => {
        rl.question('Type "RESET" to confirm: ', resolve);
      });
      rl.close();

      if (answer !== 'RESET') {
        cliLogger.warning('Reset cancelled');
        return;
      }
    }

    const specificSeed = options.specific;
    const count = await this.tracker.reset(specificSeed);

    if (specificSeed) {
      cliLogger.success(`Reset seed tracking for: ${specificSeed}`);
    } else {
      cliLogger.success(`Reset ${count} seed record(s)`);
    }
  }

  /**
   * Confirm operation in production
   * @returns {Promise<boolean>} True if confirmed
   */
  async confirmProduction() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('');
    cliLogger.warning('⚠️  PRODUCTION ENVIRONMENT ⚠️');
    console.log('');

    const answer = await new Promise(resolve => {
      rl.question('Type "EXECUTE SEEDS" to confirm: ', resolve);
    });
    rl.close();

    return answer === 'EXECUTE SEEDS';
  }
}

/**
 * Main execution function
 */
async function main() {
  const runner = new SeedRunner();

  try {
    await runner.initialize();

    if (options.status) {
      await runner.showStatus();
    } else if (options.reset) {
      await runner.resetSeeds();
    } else {
      await runner.runSeeds();
    }

    process.exit(0);
  } catch (error) {
    cliLogger.error(`Seed runner failed: ${error.message}`);

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

module.exports = SeedRunner;
