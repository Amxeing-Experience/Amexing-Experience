#!/usr/bin/env node

/**
 * Development Watch Mode
 * Automatically runs relevant tests when files change
 * Provides immediate feedback during development
 * 
 * Created by Denisse Maldonado
 * Usage: node scripts/testing/dev-watch.js [--regression-only] [--sound]
 */

const chokidar = require('chokidar');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
const regressionOnly = args.includes('--regression-only');
const soundEnabled = args.includes('--sound');
const helpRequested = args.includes('--help') || args.includes('-h');

// Display help
if (helpRequested) {
  console.log(`
${colors.bold}Development Watch Mode${colors.reset}
Automatically runs relevant tests when files change

${colors.cyan}Usage:${colors.reset}
  yarn dev:watch                    # Watch and run affected tests
  yarn dev:watch --regression-only  # Run only regression tests
  yarn dev:watch --sound            # Enable sound notifications
  
${colors.cyan}Watched directories:${colors.reset}
  src/                    # Source code changes
  tests/                  # Test file changes
  
${colors.cyan}File change mapping:${colors.reset}
  Controllers → API integration tests
  Middleware → Authentication tests
  Services → Unit tests + related integration
  Models → Database tests
  
${colors.cyan}Hot keys:${colors.reset}
  r + Enter  → Run regression tests
  t + Enter  → Run full test suite
  q + Enter  → Quit watch mode
  c + Enter  → Clear console
`);
  process.exit(0);
}

class DevWatch {
  constructor() {
    this.isRunning = false;
    this.lastRun = 0;
    this.debounceTime = 1000; // 1 second debounce
    this.testQueue = new Set();
    this.stats = {
      filesChanged: 0,
      testsRun: 0,
      lastSuccess: true
    };
    
    this.setupFileMapping();
    this.setupKeyboardInput();
  }

  log(message, color = colors.reset) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${message}${colors.reset}`);
  }

  setupFileMapping() {
    this.fileTestMap = {
      // Controllers -> API tests
      'src/application/controllers/api/EmployeesController.js': [
        'tests/integration/api/employees.test.js',
        'tests/unit/controllers/api/EmployeesController.test.js'
      ],
      'src/application/controllers/api/QuotesController.js': [
        'tests/integration/api/quotes-duplicate.test.js'
      ],
      
      // Middleware -> Auth/Security tests
      'src/application/middleware/jwtMiddleware.js': [
        'tests/unit/middleware/jwtMiddleware-rbac.test.js',
        'tests/integration/api/auth.test.js'
      ],
      'src/application/middleware/dashboardAuthMiddleware.js': [
        'tests/integration/frontend/quote-services-auto-sort.test.js',
        'tests/integration/frontend/services-edit-modal.test.js'
      ],
      'src/application/middleware/authMiddleware.js': [
        'tests/integration/api/auth.test.js',
        'tests/integration/security/security.integration.test.js'
      ],
      
      // Services -> Unit tests + related integration
      'src/application/services/AuthenticationService.js': [
        'tests/unit/services/AuthenticationService.test.js',
        'tests/integration/api/auth.test.js'
      ],
      'src/application/services/UserManagementService.js': [
        'tests/integration/api/employees.test.js'
      ],
      'src/services/PermissionService.js': [
        'tests/unit/services/PermissionService.test.js',
        'tests/integration/rbac/permission-system.integration.test.js'
      ],
      
      // Parse Cloud Functions -> Integration tests
      'src/cloud/main.js': [
        'tests/integration/cloud/beforeSave-amexinguser.test.js',
        'tests/integration/parseServer.test.js'
      ],
      'src/cloud/hooks/auditTrailHooks.js': [
        'tests/integration/cloud/beforeSave-amexinguser.test.js'
      ],
      
      // Models -> Database tests
      'src/domain/models/AmexingUser.js': [
        'tests/integration/cloud/beforeSave-amexinguser.test.js'
      ]
    };
    
    // Patterns for unknown files
    this.filePatterns = [
      {
        pattern: /src\/application\/controllers\/api\/.*\.js$/,
        defaultTests: ['tests/integration/api/', 'regression']
      },
      {
        pattern: /src\/application\/middleware\/.*\.js$/,
        defaultTests: ['tests/integration/auth/', 'regression']
      },
      {
        pattern: /src\/application\/services\/.*\.js$/,
        defaultTests: ['tests/unit/services/', 'regression']
      },
      {
        pattern: /src\/cloud\/.*\.js$/,
        defaultTests: ['tests/integration/cloud/', 'tests/integration/parseServer.test.js']
      },
      {
        pattern: /tests\/.*\.test\.js$/,
        defaultTests: ['self'] // Run the test file itself
      }
    ];
  }

  setupKeyboardInput() {
    // Setup keyboard input for manual commands
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    let input = '';
    
    process.stdin.on('data', (key) => {
      // Handle special keys
      if (key === '\u0003') { // Ctrl+C
        this.shutdown();
        return;
      }
      
      if (key === '\r' || key === '\n') { // Enter
        this.handleCommand(input.trim());
        input = '';
        return;
      }
      
      if (key === '\u007f') { // Backspace
        input = input.slice(0, -1);
        process.stdout.write('\b \b');
        return;
      }
      
      // Regular character
      if (key >= ' ' && key <= '~') {
        input += key;
        process.stdout.write(key);
      }
    });
  }

  async handleCommand(command) {
    process.stdout.write('\n');
    
    switch (command.toLowerCase()) {
      case 'r':
        this.log('🏃‍♂️ Running regression tests...', colors.cyan);
        await this.runRegressionTests();
        break;
      case 't':
        this.log('🚀 Running full test suite...', colors.cyan);
        await this.runFullTests();
        break;
      case 'c':
        console.clear();
        this.showWatchStatus();
        break;
      case 'q':
        this.shutdown();
        break;
      case '':
        // Empty command, ignore
        break;
      default:
        this.log(`❓ Unknown command: ${command}`, colors.yellow);
        this.showCommands();
    }
    
    this.showPrompt();
  }

  showCommands() {
    this.log(`${colors.dim}Commands: r=regression, t=full tests, c=clear, q=quit${colors.reset}`);
  }

  showPrompt() {
    process.stdout.write(`${colors.cyan}> ${colors.reset}`);
  }

  async startWatching() {
    this.showWatchStatus();
    this.log('🚀 Starting development watch mode...', colors.green);
    
    // Initial regression test run
    this.log('🔄 Running initial regression tests...', colors.blue);
    await this.runRegressionTests();
    
    // Setup file watcher
    const watcher = chokidar.watch([
      'src/**/*.js',
      'tests/**/*.test.js'
    ], {
      ignored: [
        'node_modules/**',
        '.git/**',
        'coverage/**',
        '**/*.tmp',
        '**/*.log'
      ],
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });

    watcher.on('error', (error) => {
      this.log(`❌ Watcher error: ${error.message}`, colors.red);
    });

    this.log('👀 Watching for file changes...', colors.green);
    this.showCommands();
    this.showPrompt();

    return watcher;
  }

  showWatchStatus() {
    console.clear();
    this.log(`${colors.bold}🛡️  Development Watch Mode${colors.reset}`, colors.cyan);
    this.log(`${colors.dim}═══════════════════════════════════════════════════════${colors.reset}`);
    this.log(`Mode: ${regressionOnly ? 'Regression only' : 'Smart testing'}`, colors.blue);
    this.log(`Sound: ${soundEnabled ? 'Enabled' : 'Disabled'}`, colors.blue);
    this.log(`Status: ${this.stats.lastSuccess ? '✅ Tests passing' : '❌ Tests failing'}`, this.stats.lastSuccess ? colors.green : colors.red);
    this.log(`Stats: ${this.stats.filesChanged} files changed, ${this.stats.testsRun} test runs`, colors.dim);
    this.log(`${colors.dim}═══════════════════════════════════════════════════════${colors.reset}`);
  }

  async handleFileChange(filePath) {
    this.stats.filesChanged++;
    this.log(`📝 File changed: ${filePath}`, colors.yellow);
    
    // Debounce multiple changes
    const now = Date.now();
    if (now - this.lastRun < this.debounceTime) {
      return;
    }
    this.lastRun = now;

    if (this.isRunning) {
      this.log('⏳ Tests already running, queuing...', colors.yellow);
      this.testQueue.add(filePath);
      return;
    }

    await this.runTestsForFile(filePath);
    
    // Process queued files
    if (this.testQueue.size > 0) {
      const queuedFiles = Array.from(this.testQueue);
      this.testQueue.clear();
      
      for (const queuedFile of queuedFiles) {
        await this.runTestsForFile(queuedFile);
      }
    }
  }

  async runTestsForFile(filePath) {
    if (regressionOnly) {
      await this.runRegressionTests();
      return;
    }

    const testsToRun = this.getTestsForFile(filePath);
    
    if (testsToRun.length === 0) {
      this.log('🤷‍♂️ No specific tests found, running regression tests', colors.blue);
      await this.runRegressionTests();
      return;
    }

    this.log(`🎯 Running ${testsToRun.length} relevant test(s)`, colors.blue);
    
    for (const testFile of testsToRun) {
      if (testFile === 'regression') {
        await this.runRegressionTests();
      } else if (testFile === 'self') {
        await this.runSingleTest(filePath);
      } else {
        await this.runSingleTest(testFile);
      }
    }
  }

  getTestsForFile(filePath) {
    const normalizedPath = path.normalize(filePath);
    
    // Check exact mappings first
    if (this.fileTestMap[normalizedPath]) {
      return this.fileTestMap[normalizedPath];
    }

    // Check patterns
    for (const patternConfig of this.filePatterns) {
      if (patternConfig.pattern.test(normalizedPath)) {
        return patternConfig.defaultTests;
      }
    }

    return [];
  }

  async runRegressionTests() {
    this.isRunning = true;
    this.stats.testsRun++;
    
    try {
      const result = await this.executeCommand(
        'node',
        ['scripts/testing/regression-guard.js'],
        { timeout: 15000 }
      );
      
      this.stats.lastSuccess = result.success;
      
      if (result.success) {
        this.log('✅ Regression tests passed', colors.green);
        this.playSound('success');
      } else {
        this.log('❌ Regression tests failed', colors.red);
        this.playSound('error');
      }
    } catch (error) {
      this.log(`❌ Regression tests error: ${error.message}`, colors.red);
      this.stats.lastSuccess = false;
      this.playSound('error');
    } finally {
      this.isRunning = false;
    }
  }

  async runFullTests() {
    this.isRunning = true;
    this.stats.testsRun++;
    
    try {
      this.log('🚀 Running full test suite (this may take a while)...', colors.blue);
      
      const result = await this.executeCommand(
        'yarn',
        ['test'],
        { timeout: 180000 } // 3 minutes
      );
      
      this.stats.lastSuccess = result.success;
      
      if (result.success) {
        this.log('✅ Full test suite passed', colors.green);
        this.playSound('success');
      } else {
        this.log('❌ Full test suite failed', colors.red);
        this.playSound('error');
      }
    } catch (error) {
      this.log(`❌ Full test suite error: ${error.message}`, colors.red);
      this.stats.lastSuccess = false;
      this.playSound('error');
    } finally {
      this.isRunning = false;
    }
  }

  async runSingleTest(testFile) {
    this.isRunning = true;
    
    try {
      // Check if test file exists
      if (!fs.existsSync(testFile)) {
        this.log(`⚠️  Test file not found: ${testFile}`, colors.yellow);
        return;
      }

      this.log(`🧪 Running ${path.basename(testFile)}`, colors.blue);
      
      const result = await this.executeCommand(
        'yarn',
        ['test', testFile],
        { timeout: 30000 }
      );
      
      if (result.success) {
        this.log(`✅ ${path.basename(testFile)} passed`, colors.green);
      } else {
        this.log(`❌ ${path.basename(testFile)} failed`, colors.red);
        this.stats.lastSuccess = false;
      }
    } catch (error) {
      this.log(`❌ Test error: ${error.message}`, colors.red);
      this.stats.lastSuccess = false;
    } finally {
      this.isRunning = false;
    }
  }

  async executeCommand(command, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      let output = '';
      child.stdout?.on('data', (data) => output += data);
      child.stderr?.on('data', (data) => output += data);

      const timeout = options.timeout && setTimeout(() => {
        child.kill();
        resolve({ success: false, output: 'Timeout' });
      }, options.timeout);

      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        resolve({ 
          success: code === 0,
          output,
          code 
        });
      });
    });
  }

  playSound(type) {
    if (!soundEnabled) return;
    
    try {
      const sounds = {
        success: 'Glass',
        error: 'Basso',
        warning: 'Purr'
      };
      
      spawn('osascript', [
        '-e',
        `display notification "Tests ${type === 'success' ? 'passed' : 'failed'}" with title "Dev Watch" sound name "${sounds[type]}"`
      ]);
    } catch (error) {
      // Silently fail if sound is not available
    }
  }

  shutdown() {
    this.log('👋 Shutting down watch mode...', colors.yellow);
    process.exit(0);
  }
}

// Main execution
async function main() {
  try {
    const watch = new DevWatch();
    await watch.startWatching();
  } catch (error) {
    console.error(`${colors.red}❌ Dev watch failed: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}👋 Graceful shutdown...${colors.reset}`);
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = DevWatch;