#!/usr/bin/env node

/**
 * Create Migration Helper - Migration Generator
 *
 * Automates the creation of new migration files with proper naming,
 * structure, and boilerplate code.
 *
 * Features:
 * - Auto-increments migration number
 * - Generates descriptive filename
 * - Uses standardized template
 * - Validates migration name
 * - Checks for naming conflicts
 *
 * Usage:
 *   node scripts/global/migrations/create-migration.js <migration-name>
 *   yarn migrate:create <migration-name>
 *
 * Examples:
 *   yarn migrate:create add-rates-table
 *   yarn migrate:create update-user-schema
 *   yarn migrate:create seed-initial-permissions
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-25
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

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
 * Logger for migration creation
 */
class CreateLogger {
  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
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

const logger = new CreateLogger();

/**
 * Migration Creator class
 */
class MigrationCreator {
  constructor() {
    this.migrationsDir = path.join(__dirname, '../../migrations');
    this.templatePath = path.join(__dirname, 'templates/migration-template.js');
  }

  /**
   * Get the next migration number
   * @returns {Promise<string>} Next migration number (e.g., "005")
   */
  async getNextMigrationNumber() {
    try {
      // Ensure migrations directory exists
      await fs.mkdir(this.migrationsDir, { recursive: true });

      // Read existing migration files
      const files = await fs.readdir(this.migrationsDir);

      // Filter migration files and extract numbers
      const migrationNumbers = files
        .filter(file => file.match(/^\d{3}-.*\.js$/))
        .map(file => parseInt(file.substring(0, 3), 10))
        .filter(num => !isNaN(num));

      // Get highest number and increment
      const highestNumber = migrationNumbers.length > 0
        ? Math.max(...migrationNumbers)
        : 0;

      const nextNumber = highestNumber + 1;

      // Format as 3-digit string with leading zeros
      return nextNumber.toString().padStart(3, '0');
    } catch (error) {
      logger.error(`Failed to determine next migration number: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate migration name
   * @param {string} name - Migration name to validate
   * @returns {object} {valid: boolean, error: string|null}
   */
  validateMigrationName(name) {
    // Check if name is provided
    if (!name || name.trim().length === 0) {
      return {
        valid: false,
        error: 'Migration name is required',
      };
    }

    // Check length
    if (name.length > 50) {
      return {
        valid: false,
        error: 'Migration name must be 50 characters or less',
      };
    }

    // Check format (lowercase, hyphens, alphanumeric)
    const validFormat = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!validFormat.test(name)) {
      return {
        valid: false,
        error: 'Migration name must be lowercase, alphanumeric, with hyphens (e.g., add-users-table)',
      };
    }

    return { valid: true, error: null };
  }

  /**
   * Check if migration name already exists
   * @param {string} name - Migration name
   * @returns {Promise<boolean>} True if name exists
   */
  async migrationExists(name) {
    try {
      const files = await fs.readdir(this.migrationsDir);
      return files.some(file => file.includes(`-${name}.js`));
    } catch (error) {
      // Directory might not exist yet
      return false;
    }
  }

  /**
   * Generate migration file content from template
   * @param {string} name - Migration name
   * @param {string} description - Migration description
   * @param {string} author - Author name
   * @returns {Promise<string>} Migration file content
   */
  async generateMigrationContent(name, description, author) {
    try {
      // Read template
      let content = await fs.readFile(this.templatePath, 'utf-8');

      // Get current date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];

      // Replace placeholders
      const replacements = {
        '[MIGRATION_NAME]': name,
        '[DESCRIPTION]': description || `Migration: ${name}`,
        '[AUTHOR_NAME]': author || 'Amexing Development Team',
        '[DATE]': dateStr,
      };

      Object.entries(replacements).forEach(([placeholder, value]) => {
        content = content.replace(new RegExp(placeholder, 'g'), value);
      });

      return content;
    } catch (error) {
      logger.error(`Failed to generate migration content: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create migration file
   * @param {string} name - Migration name (e.g., "add-rates-table")
   * @param {object} options - Creation options
   * @returns {Promise<string>} Created file path
   */
  async createMigration(name, options = {}) {
    try {
      logger.section('Creating New Migration');

      // Validate name
      const validation = this.validateMigrationName(name);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Check if migration already exists
      const exists = await this.migrationExists(name);
      if (exists) {
        throw new Error(`Migration with name "${name}" already exists`);
      }

      // Get next migration number
      const migrationNumber = await this.getNextMigrationNumber();
      logger.info(`Next migration number: ${migrationNumber}`);

      // Generate filename
      const filename = `${migrationNumber}-${name}.js`;
      const filepath = path.join(this.migrationsDir, filename);

      logger.info(`Creating migration: ${filename}`);

      // Prompt for description if not provided
      let description = options.description;
      if (!description && !options.skipPrompts) {
        description = await this.promptForDescription();
      }

      // Get author from git config or environment
      const author = options.author || await this.getAuthor();

      // Generate content from template
      const content = await this.generateMigrationContent(name, description, author);

      // Ensure directory exists
      await fs.mkdir(this.migrationsDir, { recursive: true });

      // Write file
      await fs.writeFile(filepath, content, 'utf-8');

      logger.success(`Migration created: ${filename}`);
      logger.info(`File path: ${filepath}`);

      // Show next steps
      console.log('');
      logger.section('Next Steps');
      logger.info('1. Edit the migration file to add your database changes');
      logger.info('2. Implement the up() function with your changes');
      logger.info('3. Implement the down() function for rollback (optional but recommended)');
      logger.info('4. Test the migration: yarn migrate --dry-run');
      logger.info('5. Run the migration: yarn migrate');
      console.log('');

      return filepath;
    } catch (error) {
      logger.error(`Failed to create migration: ${error.message}`);
      throw error;
    }
  }

  /**
   * Prompt user for migration description
   * @returns {Promise<string>} Migration description
   */
  async promptForDescription() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\nMigration description (optional): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  /**
   * Get author name from git config or environment
   * @returns {Promise<string>} Author name
   */
  async getAuthor() {
    try {
      const { execSync } = require('child_process');
      const gitName = execSync('git config user.name', { encoding: 'utf-8' }).trim();
      return gitName || 'Amexing Development Team';
    } catch (error) {
      return 'Amexing Development Team';
    }
  }

  /**
   * Show usage information
   */
  static showUsage() {
    logger.section('Create Migration - Usage');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/global/migrations/create-migration.js <migration-name>');
    console.log('  yarn migrate:create <migration-name>');
    console.log('');
    console.log('Options:');
    console.log('  --description "Description"  Set migration description');
    console.log('  --author "Name"             Set author name');
    console.log('  --skip-prompts              Skip interactive prompts');
    console.log('  --help                      Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  yarn migrate:create add-rates-table');
    console.log('  yarn migrate:create update-user-schema --description "Add new fields to User"');
    console.log('  yarn migrate:create seed-permissions --skip-prompts');
    console.log('');
    console.log('Naming Rules:');
    console.log('  - Use lowercase letters');
    console.log('  - Use hyphens to separate words');
    console.log('  - Use descriptive names (add-*, update-*, remove-*, create-*)');
    console.log('  - Maximum 50 characters');
    console.log('');
    console.log('Examples of good names:');
    console.log('  ✅ add-rates-table');
    console.log('  ✅ update-user-roles');
    console.log('  ✅ create-audit-logs');
    console.log('  ✅ remove-deprecated-fields');
    console.log('');
    console.log('Examples of bad names:');
    console.log('  ❌ AddRatesTable (use lowercase)');
    console.log('  ❌ add_rates_table (use hyphens, not underscores)');
    console.log('  ❌ migration1 (not descriptive)');
    console.log('');
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    MigrationCreator.showUsage();
    process.exit(0);
  }

  const migrationName = args[0];

  const options = {
    description: null,
    author: null,
    skipPrompts: false,
  };

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--description' && args[i + 1]) {
      options.description = args[i + 1];
      i++;
    } else if (args[i] === '--author' && args[i + 1]) {
      options.author = args[i + 1];
      i++;
    } else if (args[i] === '--skip-prompts') {
      options.skipPrompts = true;
    }
  }

  return { migrationName, options };
}

/**
 * Main execution function
 */
async function main() {
  const creator = new MigrationCreator();

  try {
    const { migrationName, options } = parseArgs();

    // Create migration
    await creator.createMigration(migrationName, options);

    process.exit(0);
  } catch (error) {
    logger.error(`Migration creation failed: ${error.message}`);
    console.log('');
    logger.info('Run with --help for usage information');
    console.log('');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MigrationCreator;
