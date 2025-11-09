/**
 * Test Environment Check Helper
 * Validates test environment requirements before running tests
 */

const Parse = require('parse/node');

class TestEnvironmentCheck {
  constructor() {
    this.checks = {
      parseServerRunning: false,
      databaseConnected: false,
      environmentConfigured: false,
      testPrefixSet: false
    };
  }

  /**
   * Check if Parse Server is running
   */
  async checkParseServer() {
    try {
      const response = await fetch(`${process.env.PARSE_SERVER_URL}/health`);
      this.checks.parseServerRunning = response.ok;
      return this.checks.parseServerRunning;
    } catch (error) {
      this.checks.parseServerRunning = false;
      return false;
    }
  }

  /**
   * Check if database is accessible
   */
  async checkDatabase() {
    try {
      // Initialize Parse if not already done
      if (!Parse.applicationId) {
        Parse.initialize(
          process.env.PARSE_APPLICATION_ID,
          process.env.PARSE_JAVASCRIPT_KEY,
          process.env.PARSE_MASTER_KEY
        );
        Parse.serverURL = process.env.PARSE_SERVER_URL;
      }

      // Try a simple query
      const TestObject = Parse.Object.extend('_TestConnection');
      const query = new Parse.Query(TestObject);
      await query.limit(1).find({ useMasterKey: true });

      this.checks.databaseConnected = true;
      return true;
    } catch (error) {
      this.checks.databaseConnected = false;
      return false;
    }
  }

  /**
   * Check environment configuration
   */
  checkEnvironmentConfiguration() {
    const requiredVars = [
      'PARSE_APPLICATION_ID',
      'PARSE_MASTER_KEY',
      'PARSE_SERVER_URL',
      'DATABASE_URI'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    this.checks.environmentConfigured = missing.length === 0;

    if (!this.checks.environmentConfigured) {
      console.warn('Missing environment variables:', missing);
    }

    return this.checks.environmentConfigured;
  }

  /**
   * Check test prefix configuration
   */
  checkTestPrefix() {
    this.checks.testPrefixSet = process.env.PARSE_PLATFORM_TEST_PREFIX === 'ParseTest_';
    return this.checks.testPrefixSet;
  }

  /**
   * Run all environment checks
   */
  async runAllChecks() {
    console.log('Running Parse Platform environment checks...');

    this.checkEnvironmentConfiguration();
    this.checkTestPrefix();

    if (this.checks.environmentConfigured) {
      await this.checkParseServer();

      if (this.checks.parseServerRunning) {
        await this.checkDatabase();
      }
    }

    return this.checks;
  }

  /**
   * Get environment status summary
   */
  getEnvironmentStatus() {
    const status = {
      ready: Object.values(this.checks).every(check => check === true),
      checks: { ...this.checks },
      requirements: {
        parseServer: this.checks.parseServerRunning ? '✓ Running' : '✗ Not running',
        database: this.checks.databaseConnected ? '✓ Connected' : '✗ Not connected',
        environment: this.checks.environmentConfigured ? '✓ Configured' : '✗ Missing variables',
        testPrefix: this.checks.testPrefixSet ? '✓ Set' : '✗ Not set'
      }
    };

    return status;
  }

  /**
   * Skip tests if environment not ready
   */
  skipIfNotReady(testSuite) {
    if (!this.checks.parseServerRunning) {
      testSuite.skip('Parse Server is not running');
      return true;
    }

    if (!this.checks.databaseConnected) {
      testSuite.skip('Database is not accessible');
      return true;
    }

    if (!this.checks.environmentConfigured) {
      testSuite.skip('Environment is not properly configured');
      return true;
    }

    return false;
  }

  /**
   * Log environment status
   */
  logStatus() {
    const status = this.getEnvironmentStatus();

    console.log('\nParse Platform Test Environment Status:');
    console.log('==========================================');
    console.log(`Overall Status: ${status.ready ? '✓ READY' : '✗ NOT READY'}`);
    console.log('\nRequirements:');
    Object.entries(status.requirements).forEach(([key, value]) => {
      console.log(`  ${key.padEnd(12)}: ${value}`);
    });

    if (!status.ready) {
      console.log('\nTo run Parse Platform tests:');
      if (!this.checks.parseServerRunning) {
        console.log('  1. Start Parse Server: yarn dev');
      }
      if (!this.checks.environmentConfigured) {
        console.log('  2. Check .env configuration');
      }
      console.log('  3. Run: yarn test:parse-platform');
    }

    console.log('==========================================\n');
  }
}

module.exports = TestEnvironmentCheck;