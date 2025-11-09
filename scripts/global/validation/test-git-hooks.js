#!/usr/bin/env node

/**
 * Git Hooks Testing Script for AmexingWeb
 * 
 * Tests Git hooks functionality without making actual commits
 * Useful for validating hook behavior before committing changes
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

class GitHooksTest {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.hooksDir = path.join(this.projectRoot, '.git', 'hooks');
    this.tempDir = path.join(os.tmpdir(), `git-hooks-test-${Date.now()}`);
    
    this.testResults = {
      passed: [],
      failed: [],
      skipped: []
    };
  }

  log(message, level = 'info') {
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${colors[level]}${prefix} ${message}${colors.reset}`);
  }

  setupTestEnvironment() {
    // Create temporary directory for tests
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  cleanupTestEnvironment() {
    // Clean up temporary files
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }

  testPreCommitHook() {
    this.log('Testing pre-commit hook...');
    
    const hookPath = path.join(this.hooksDir, 'pre-commit');
    if (!fs.existsSync(hookPath)) {
      this.testResults.skipped.push('pre-commit (not installed)');
      this.log('pre-commit hook not found, skipping', 'warning');
      return;
    }

    try {
      // Test with valid conditions
      process.env.TEST_MODE = 'true';
      
      // Create a test staged file
      const testFile = path.join(this.tempDir, 'test.js');
      fs.writeFileSync(testFile, 'console.log("test");');
      
      // Run the hook script
      execSync(`bash "${hookPath}"`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
        env: { ...process.env, TEST_MODE: 'true' }
      });
      
      this.testResults.passed.push('pre-commit');
      this.log('pre-commit hook test passed', 'success');
      
    } catch (error) {
      this.testResults.failed.push('pre-commit');
      this.log(`pre-commit hook test failed: ${error.message}`, 'error');
    }
  }

  testCommitMsgHook() {
    this.log('Testing commit-msg hook...');
    
    const hookPath = path.join(this.hooksDir, 'commit-msg');
    if (!fs.existsSync(hookPath)) {
      this.testResults.skipped.push('commit-msg (not installed)');
      this.log('commit-msg hook not found, skipping', 'warning');
      return;
    }

    const testCases = [
      {
        message: 'feat(auth): implement MFA for admin access',
        shouldPass: true,
        description: 'valid conventional commit'
      },
      {
        message: 'security(encryption): upgrade to AES-256-GCM\\n\\nSECURITY: High\\nPCI-DSS: Req 3.5.1',
        shouldPass: true,
        description: 'valid security commit'
      },
      {
        message: 'invalid commit message',
        shouldPass: false,
        description: 'invalid format'
      },
      {
        message: 'security(auth): add MFA\\n\\nNo security classification',
        shouldPass: false,
        description: 'security commit without classification'
      }
    ];

    let passedTests = 0;
    
    testCases.forEach((testCase, index) => {
      try {
        // Create temporary commit message file
        const msgFile = path.join(this.tempDir, `commit-msg-${index}`);
        fs.writeFileSync(msgFile, testCase.message);
        
        // Run the hook
        execSync(`bash "${hookPath}" "${msgFile}"`, {
          cwd: this.projectRoot,
          stdio: 'pipe',
          env: { ...process.env, TEST_MODE: 'true' }
        });
        
        if (testCase.shouldPass) {
          this.log(`✓ ${testCase.description}`, 'success');
          passedTests++;
        } else {
          this.log(`✗ ${testCase.description} (should have failed)`, 'error');
        }
        
      } catch (error) {
        if (!testCase.shouldPass) {
          this.log(`✓ ${testCase.description} (correctly rejected)`, 'success');
          passedTests++;
        } else {
          this.log(`✗ ${testCase.description} (unexpected failure)`, 'error');
        }
      }
    });

    if (passedTests === testCases.length) {
      this.testResults.passed.push('commit-msg');
      this.log('commit-msg hook test passed', 'success');
    } else {
      this.testResults.failed.push('commit-msg');
      this.log(`commit-msg hook test failed (${passedTests}/${testCases.length} passed)`, 'error');
    }
  }

  testPrePushHook() {
    this.log('Testing pre-push hook...');
    
    const hookPath = path.join(this.hooksDir, 'pre-push');
    if (!fs.existsSync(hookPath)) {
      this.testResults.skipped.push('pre-push (not installed)');
      this.log('pre-push hook not found, skipping', 'warning');
      return;
    }

    try {
      // Set test environment variables
      process.env.TEST_MODE = 'true';
      
      // Run the hook script
      execSync(`bash "${hookPath}"`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
        env: { ...process.env, TEST_MODE: 'true' }
      });
      
      this.testResults.passed.push('pre-push');
      this.log('pre-push hook test passed', 'success');
      
    } catch (error) {
      this.testResults.failed.push('pre-push');
      this.log(`pre-push hook test failed: ${error.message}`, 'error');
    }
  }

  testPostMergeHook() {
    this.log('Testing post-merge hook...');
    
    const hookPath = path.join(this.hooksDir, 'post-merge');
    if (!fs.existsSync(hookPath)) {
      this.testResults.skipped.push('post-merge (not installed)');
      this.log('post-merge hook not found, skipping', 'warning');
      return;
    }

    try {
      // Set test environment variables
      process.env.TEST_MODE = 'true';
      
      // Run the hook script
      execSync(`bash "${hookPath}"`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
        env: { ...process.env, TEST_MODE: 'true' }
      });
      
      this.testResults.passed.push('post-merge');
      this.log('post-merge hook test passed', 'success');
      
    } catch (error) {
      this.testResults.failed.push('post-merge');
      this.log(`post-merge hook test failed: ${error.message}`, 'error');
    }
  }

  testConventionalCommitValidation() {
    this.log('Testing conventional commit validation...');
    
    const testCommits = [
      'feat: add new feature',
      'fix(api): resolve authentication issue', 
      'docs: update README',
      'security(auth): implement MFA',
      'invalid commit',
      'FEAT: wrong case',
    ];

    let validCommits = 0;
    
    testCommits.forEach(commit => {
      try {
        // Use commitlint if available
        execSync(`echo "${commit}" | yarn --silent commitlint`, {
          cwd: this.projectRoot,
          stdio: 'pipe'
        });
        validCommits++;
        this.log(`✓ "${commit}" - valid format`, 'success');
      } catch (error) {
        this.log(`✗ "${commit}" - invalid format`, 'warning');
      }
    });

    if (validCommits >= 4) { // At least the first 4 should be valid
      this.testResults.passed.push('conventional-commits');
      this.log('Conventional commit validation working', 'success');
    } else {
      this.testResults.failed.push('conventional-commits');
      this.log('Conventional commit validation issues detected', 'error');
    }
  }

  generateTestReport() {
    console.log('\\n📋 Git Hooks Test Report');
    console.log('==========================\\n');

    if (this.testResults.passed.length > 0) {
      this.log(`Passed tests: ${this.testResults.passed.join(', ')}`, 'success');
    }

    if (this.testResults.failed.length > 0) {
      this.log(`Failed tests: ${this.testResults.failed.join(', ')}`, 'error');
    }

    if (this.testResults.skipped.length > 0) {
      this.log(`Skipped tests: ${this.testResults.skipped.join(', ')}`, 'warning');
    }

    const totalTests = this.testResults.passed.length + 
                      this.testResults.failed.length + 
                      this.testResults.skipped.length;
    
    console.log(`\\n📊 Summary: ${this.testResults.passed.length}/${totalTests} tests passed`);

    if (this.testResults.failed.length === 0) {
      this.log('🎉 All tests passed! Your Git hooks are working correctly.', 'success');
      console.log('\\n✅ Ready for PCI DSS compliant development!');
    } else {
      this.log('⚠️  Some tests failed. Review hook configuration.', 'warning');
      console.log('\\n🔧 Try running: yarn hooks:repair');
    }

    return this.testResults.failed.length === 0;
  }

  run() {
    try {
      this.log('🧪 Testing Git hooks for AmexingWeb...\\n');
      
      this.setupTestEnvironment();
      
      // Run individual hook tests
      this.testPreCommitHook();
      this.testCommitMsgHook();
      this.testPrePushHook();
      this.testPostMergeHook();
      
      // Test commit message validation
      this.testConventionalCommitValidation();
      
      // Generate report
      const allPassed = this.generateTestReport();
      
      this.cleanupTestEnvironment();
      
      if (!allPassed) {
        process.exit(1);
      }

    } catch (error) {
      this.log(`Test failed: ${error.message}`, 'error');
      this.cleanupTestEnvironment();
      process.exit(1);
    }
  }
}

// Run tests
const tester = new GitHooksTest();
tester.run();