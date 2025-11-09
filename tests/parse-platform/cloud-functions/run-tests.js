#!/usr/bin/env node

/**
 * Cloud Functions Test Runner
 * Executes Parse Cloud Functions test suite with proper configuration
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const TEST_CONFIG = {
  timeout: 30000,
  maxWorkers: 2,
  bail: false,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true
};

// Test suites in execution order
const TEST_SUITES = [
  {
    name: 'Cloud Define Operations',
    file: 'cloud-define-operations.test.js',
    description: 'Tests Parse.Cloud.define() function registration and execution'
  },
  {
    name: 'Cloud Hooks Operations',
    file: 'cloud-hooks-operations.test.js',
    description: 'Tests Parse.Cloud hooks (beforeSave, afterSave, beforeDelete, afterDelete)'
  },
  {
    name: 'Existing Functions Validation',
    file: 'existing-functions-validation.test.js',
    description: 'Tests all registered cloud functions from main.js'
  },
  {
    name: 'Cloud Integration Tests',
    file: 'cloud-integration.test.js',
    description: 'End-to-end cloud function workflows and integration scenarios'
  },
  {
    name: 'Cloud Jobs Tests',
    file: 'cloud-jobs.test.js',
    description: 'Tests Parse.Cloud.job background job functionality'
  }
];

class CloudFunctionTestRunner {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../../');
    this.testDir = path.resolve(__dirname);
    this.resultsDir = path.join(this.projectRoot, 'test-results', 'cloud-functions');
    this.startTime = Date.now();
  }

  async run() {
    console.log('🚀 Starting Parse Cloud Functions Test Suite');
    console.log('=' .repeat(60));

    // Setup
    this.ensureDirectories();
    this.displayConfiguration();

    // Environment check
    await this.checkEnvironment();

    // Run tests
    const results = await this.runTestSuites();

    // Summary
    this.displaySummary(results);

    // Exit with appropriate code
    const hasFailures = results.some(result => !result.success);
    process.exit(hasFailures ? 1 : 0);
  }

  ensureDirectories() {
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  displayConfiguration() {
    console.log('📋 Configuration:');
    console.log(`   Project Root: ${this.projectRoot}`);
    console.log(`   Test Directory: ${this.testDir}`);
    console.log(`   Results Directory: ${this.resultsDir}`);
    console.log(`   Timeout: ${TEST_CONFIG.timeout}ms`);
    console.log(`   Max Workers: ${TEST_CONFIG.maxWorkers}`);
    console.log(`   Verbose: ${TEST_CONFIG.verbose}`);
    console.log('');
  }

  async checkEnvironment() {
    console.log('🔍 Environment Check:');

    // Check if Parse configuration exists
    const parseConfigPath = path.join(__dirname, '../parse-platform.env.js');
    if (!fs.existsSync(parseConfigPath)) {
      console.error('❌ Parse configuration not found:', parseConfigPath);
      process.exit(1);
    }
    console.log('✅ Parse configuration found');

    // Check if cloud functions exist
    const cloudMainPath = path.join(this.projectRoot, 'src/cloud/main.js');
    if (!fs.existsSync(cloudMainPath)) {
      console.error('❌ Cloud functions main file not found:', cloudMainPath);
      process.exit(1);
    }
    console.log('✅ Cloud functions main file found');

    // Load and validate Parse config
    try {
      const parseConfig = require(parseConfigPath);
      if (!parseConfig.appId || !parseConfig.serverURL) {
        throw new Error('Missing required Parse configuration');
      }
      console.log('✅ Parse configuration valid');
      console.log(`   App ID: ${parseConfig.appId}`);
      console.log(`   Server URL: ${parseConfig.serverURL}`);
    } catch (error) {
      console.error('❌ Invalid Parse configuration:', error.message);
      process.exit(1);
    }

    console.log('');
  }

  async runTestSuites() {
    const results = [];

    for (const [index, suite] of TEST_SUITES.entries()) {
      console.log(`📦 Test Suite ${index + 1}/${TEST_SUITES.length}: ${suite.name}`);
      console.log(`   ${suite.description}`);
      console.log(`   File: ${suite.file}`);

      const result = await this.runSingleSuite(suite);
      results.push(result);

      if (result.success) {
        console.log(`   ✅ PASSED (${result.duration}ms)`);
      } else {
        console.log(`   ❌ FAILED (${result.duration}ms)`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
      }

      console.log('');

      // Small delay between test suites to avoid resource conflicts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }

  async runSingleSuite(suite) {
    const suiteStartTime = Date.now();
    const testFile = path.join(this.testDir, suite.file);

    const jestCommand = [
      'npx jest',
      `"${testFile}"`,
      `--config="${path.join(this.testDir, 'jest.config.js')}"`,
      `--testTimeout=${TEST_CONFIG.timeout}`,
      `--maxWorkers=${TEST_CONFIG.maxWorkers}`,
      TEST_CONFIG.verbose ? '--verbose' : '',
      TEST_CONFIG.bail ? '--bail' : '',
      TEST_CONFIG.forceExit ? '--forceExit' : '',
      TEST_CONFIG.detectOpenHandles ? '--detectOpenHandles' : '',
      '--no-cache',
      '--runInBand' // Run tests serially to avoid Parse conflicts
    ].filter(Boolean).join(' ');

    try {
      const output = execSync(jestCommand, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PARSE_PLATFORM_TEST_PREFIX: 'CloudTest_'
        }
      });

      return {
        suite: suite.name,
        file: suite.file,
        success: true,
        duration: Date.now() - suiteStartTime,
        output: output
      };

    } catch (error) {
      return {
        suite: suite.name,
        file: suite.file,
        success: false,
        duration: Date.now() - suiteStartTime,
        error: error.message,
        output: error.stdout || '',
        stderr: error.stderr || ''
      };
    }
  }

  displaySummary(results) {
    const totalDuration = Date.now() - this.startTime;
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('📊 Test Suite Summary');
    console.log('=' .repeat(60));
    console.log(`   Total Suites: ${results.length}`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏱️  Total Duration: ${totalDuration}ms`);
    console.log(`   📁 Results Directory: ${this.resultsDir}`);
    console.log('');

    if (failed > 0) {
      console.log('❌ Failed Test Suites:');
      results.filter(r => !r.success).forEach(result => {
        console.log(`   • ${result.suite}: ${result.error}`);
      });
      console.log('');
    }

    // Performance insights
    const slowSuites = results.filter(r => r.duration > 60000); // 1 minute
    if (slowSuites.length > 0) {
      console.log('🐌 Slow Test Suites (>1 minute):');
      slowSuites.forEach(result => {
        console.log(`   • ${result.suite}: ${result.duration}ms`);
      });
      console.log('');
    }

    // Recommendations
    if (failed > 0) {
      console.log('💡 Recommendations:');
      console.log('   • Check Parse Server connectivity and configuration');
      console.log('   • Verify OAuth provider configurations if OAuth tests fail');
      console.log('   • Check email service setup if password reset tests fail');
      console.log('   • Review cloud function registration and deployment');
      console.log('   • Check test environment variables and permissions');
      console.log('');
    }

    console.log('📋 Available Reports:');
    console.log(`   • Summary: ${path.join(this.resultsDir, 'cloud-functions-summary.json')}`);
    console.log(`   • HTML Report: ${path.join(this.resultsDir, 'cloud-functions-report.html')}`);
    console.log(`   • Performance: ${path.join(this.resultsDir, 'performance-report.json')}`);
    if (failed > 0) {
      console.log(`   • Failure Analysis: ${path.join(this.resultsDir, 'failure-analysis.json')}`);
    }
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Parse Cloud Functions Test Runner');
  console.log('');
  console.log('Usage: node run-tests.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h     Show help');
  console.log('  --suite NAME   Run specific test suite');
  console.log('  --quiet        Reduce output verbosity');
  console.log('  --bail         Stop on first failure');
  console.log('');
  console.log('Available test suites:');
  TEST_SUITES.forEach((suite, index) => {
    console.log(`  ${index + 1}. ${suite.name} (${suite.file})`);
    console.log(`     ${suite.description}`);
  });
  process.exit(0);
}

// Handle specific suite execution
const suiteIndex = args.findIndex(arg => arg === '--suite');
if (suiteIndex !== -1 && args[suiteIndex + 1]) {
  const suiteName = args[suiteIndex + 1];
  const targetSuite = TEST_SUITES.find(suite =>
    suite.name.toLowerCase().includes(suiteName.toLowerCase()) ||
    suite.file.toLowerCase().includes(suiteName.toLowerCase())
  );

  if (!targetSuite) {
    console.error(`❌ Test suite not found: ${suiteName}`);
    console.log('Available suites:');
    TEST_SUITES.forEach(suite => console.log(`  • ${suite.name}`));
    process.exit(1);
  }

  // Override TEST_SUITES to run only the target suite
  TEST_SUITES.length = 0;
  TEST_SUITES.push(targetSuite);
}

// Apply command line options
if (args.includes('--quiet')) {
  TEST_CONFIG.verbose = false;
}

if (args.includes('--bail')) {
  TEST_CONFIG.bail = true;
}

// Run the test suite
const runner = new CloudFunctionTestRunner();
runner.run().catch(error => {
  console.error('❌ Test runner failed:', error);
  process.exit(1);
});