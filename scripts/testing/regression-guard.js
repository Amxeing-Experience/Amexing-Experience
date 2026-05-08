#!/usr/bin/env node

/**
 * Regression Test Guard
 * Fast smoke tests to catch regressions immediately during development
 * Target: <10 seconds execution time
 * 
 * Created by Denisse Maldonado
 * Usage: node scripts/testing/regression-guard.js [--verbose] [--category=auth]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const categoryFilter = args.find(arg => arg.startsWith('--category='))?.split('=')[1];
const helpRequested = args.includes('--help') || args.includes('-h');

// Display help
if (helpRequested) {
  console.log(`
${colors.bold}Regression Test Guard${colors.reset}
Fast smoke tests to catch regressions during development

${colors.cyan}Usage:${colors.reset}
  yarn test:regression                 # Run all critical tests
  yarn test:regression --verbose       # Show detailed output
  yarn test:regression --category=auth # Run only auth tests
  
${colors.cyan}Categories:${colors.reset}
  auth        - Authentication tests
  database    - Database operations
  api         - Core API endpoints
  permissions - Permission system
  business    - Business logic

${colors.cyan}Example:${colors.reset}
  yarn test:regression --category=auth --verbose
`);
  process.exit(0);
}

class RegressionGuard {
  constructor() {
    this.startTime = Date.now();
    this.testResults = [];
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.skippedTests = 0;
    
    this.loadCriticalTests();
  }

  loadCriticalTests() {
    try {
      const criticalTestsPath = path.join(process.cwd(), 'tests/regression/critical-tests.json');
      this.config = JSON.parse(fs.readFileSync(criticalTestsPath, 'utf8'));
      
      // Filter by category if specified
      if (categoryFilter) {
        this.config.criticalTests = this.config.criticalTests.filter(
          category => category.category.toLowerCase() === categoryFilter.toLowerCase()
        );
        
        if (this.config.criticalTests.length === 0) {
          console.log(`${colors.yellow}⚠️  No tests found for category: ${categoryFilter}${colors.reset}`);
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(`${colors.red}❌ Failed to load critical tests config: ${error.message}${colors.reset}`);
      process.exit(1);
    }
  }

  log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
  }

  async runTests() {
    this.log(`${colors.bold}🛡️  Regression Guard - Critical Test Suite${colors.reset}`);
    this.log(`${colors.dim}Target: <10 seconds | Fail-fast: ${this.config.failFast}${colors.reset}`);
    
    if (categoryFilter) {
      this.log(`${colors.cyan}📂 Filtering by category: ${categoryFilter}${colors.reset}`);
    }
    
    this.log('');

    for (const category of this.config.criticalTests) {
      await this.runTestCategory(category);
      
      // Fail fast if enabled and we have failures
      if (this.config.failFast && this.failedTests > 0) {
        this.log(`${colors.red}⚡ Fail-fast enabled - stopping due to test failures${colors.reset}`);
        break;
      }
    }

    this.showSummary();
  }

  async runTestCategory(category) {
    this.log(`${colors.bold}${this.getPriorityIcon(category.priority)} ${category.category}${colors.reset}`);
    
    for (const testFile of category.tests) {
      // Check if test file exists
      if (!fs.existsSync(path.join(process.cwd(), testFile))) {
        this.log(`  ${colors.yellow}⚠️  Skipped: ${testFile} (not found)${colors.reset}`);
        this.skippedTests++;
        continue;
      }

      const result = await this.runSingleTest(testFile, category.maxDuration);
      this.processTestResult(result, testFile);
    }
    
    this.log('');
  }

  async runSingleTest(testFile, maxDuration) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Build Jest command
      const jestArgs = [
        'NODE_ENV=test',
        'node',
        '--experimental-vm-modules',
        'node_modules/.bin/jest',
        testFile,
        '--config',
        '.config/jest/jest.config.js',
        '--testTimeout=25000',
        '--silent',
        '--no-coverage',
        '--maxWorkers=1'
      ];

      if (!verbose) {
        jestArgs.push('--reporters=jest-silent-reporter');
      }

      const jest = spawn('bash', ['-c', jestArgs.join(' ')], {
        stdio: verbose ? 'pipe' : 'pipe',
        timeout: maxDuration
      });

      let output = '';
      let errorOutput = '';

      if (jest.stdout) {
        jest.stdout.on('data', (data) => {
          output += data.toString();
        });
      }

      if (jest.stderr) {
        jest.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      }

      jest.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        resolve({
          success: code === 0,
          duration,
          output: output + errorOutput,
          timedOut: duration >= maxDuration,
          code
        });
      });

      jest.on('error', (error) => {
        resolve({
          success: false,
          duration: Date.now() - startTime,
          output: error.message,
          timedOut: false,
          code: -1
        });
      });
    });
  }

  processTestResult(result, testFile) {
    const fileName = path.basename(testFile);
    const shortPath = testFile.replace('tests/', '');
    
    if (result.success) {
      this.log(`  ${colors.green}✅ ${fileName}${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}`);
      this.passedTests++;
    } else {
      const timeoutInfo = result.timedOut ? ' (TIMEOUT)' : '';
      this.log(`  ${colors.red}❌ ${fileName}${colors.reset}${colors.red}${timeoutInfo}${colors.reset} ${colors.dim}(${result.duration}ms)${colors.reset}`);
      
      if (verbose && result.output) {
        // Show only relevant error output
        const errorLines = result.output.split('\n')
          .filter(line => line.includes('FAIL') || line.includes('Error') || line.includes('Expected'))
          .slice(0, 3);
        
        errorLines.forEach(line => {
          this.log(`    ${colors.dim}${line.trim()}${colors.reset}`);
        });
      }
      
      this.failedTests++;
    }
    
    this.totalTests++;
    this.testResults.push({
      file: shortPath,
      success: result.success,
      duration: result.duration,
      timedOut: result.timedOut
    });
  }

  getPriorityIcon(priority) {
    switch (priority) {
      case 'CRITICAL': return '🔴';
      case 'HIGH': return '🟠';
      case 'MEDIUM': return '🟡';
      default: return '🔵';
    }
  }

  showSummary() {
    const totalDuration = Date.now() - this.startTime;
    const targetMet = totalDuration <= this.config.totalMaxDuration;
    
    this.log(`${colors.bold}📊 Regression Guard Summary${colors.reset}`);
    this.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);
    
    // Test counts
    this.log(`Tests:     ${colors.green}${this.passedTests} passed${colors.reset}, ${this.failedTests > 0 ? colors.red : colors.dim}${this.failedTests} failed${colors.reset}, ${this.skippedTests > 0 ? colors.yellow : colors.dim}${this.skippedTests} skipped${colors.reset}`);
    
    // Duration with target comparison
    const durationColor = targetMet ? colors.green : colors.red;
    const targetStatus = targetMet ? '✅ FAST' : '⚠️  SLOW';
    this.log(`Duration:  ${durationColor}${totalDuration}ms${colors.reset} / ${this.config.totalMaxDuration}ms target ${targetStatus}`);
    
    // Overall status
    if (this.failedTests === 0) {
      this.log(`${colors.green}${colors.bold}✅ All regression tests passed!${colors.reset}`);
      
      if (!targetMet) {
        this.log(`${colors.yellow}⚠️  Warning: Execution exceeded target time${colors.reset}`);
        this.log(`${colors.dim}Consider optimizing slow tests or adjusting targets${colors.reset}`);
      }
    } else {
      this.log(`${colors.red}${colors.bold}❌ Regression tests failed!${colors.reset}`);
      this.log(`${colors.dim}Fix failing tests before committing changes${colors.reset}`);
    }

    // Show slowest tests if verbose
    if (verbose && this.testResults.length > 0) {
      this.log('');
      this.log(`${colors.dim}Slowest tests:${colors.reset}`);
      
      const slowestTests = this.testResults
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3);
      
      slowestTests.forEach((test, index) => {
        const icon = test.success ? '✅' : '❌';
        this.log(`${colors.dim}${index + 1}. ${icon} ${test.file} (${test.duration}ms)${colors.reset}`);
      });
    }

    // Usage tips
    if (this.failedTests > 0) {
      this.log('');
      this.log(`${colors.cyan}💡 Quick fixes:${colors.reset}`);
      this.log(`${colors.dim}• Run individual test: yarn test ${this.testResults.find(r => !r.success)?.file}${colors.reset}`);
      this.log(`${colors.dim}• Run full test suite: yarn test${colors.reset}`);
      this.log(`${colors.dim}• Check recent changes: git diff HEAD~1${colors.reset}`);
    }
    
    // Exit with appropriate code
    process.exit(this.failedTests > 0 ? 1 : 0);
  }
}

// Main execution
async function main() {
  try {
    const guard = new RegressionGuard();
    await guard.runTests();
  } catch (error) {
    console.error(`${colors.red}❌ Regression guard failed: ${error.message}${colors.reset}`);
    
    if (verbose) {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}⚠️  Regression guard interrupted${colors.reset}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log(`\n${colors.yellow}⚠️  Regression guard terminated${colors.reset}`);
  process.exit(1);
});

if (require.main === module) {
  main();
}

module.exports = RegressionGuard;