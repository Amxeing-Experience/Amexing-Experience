#!/usr/bin/env node

/**
 * Git Hooks Validation Script for AmexingWeb
 * 
 * Validates that all required Git hooks are properly installed and configured
 * for PCI DSS compliance and security enforcement.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class GitHooksValidator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.hooksDir = path.join(this.projectRoot, '.git', 'hooks');
    this.sourceHooksDir = path.join(this.projectRoot, 'scripts', 'git-hooks');
    
    this.requiredHooks = [
      'pre-commit',
      'commit-msg', 
      'pre-push',
      'post-merge'
    ];

    this.results = {
      installed: [],
      missing: [],
      executable: [],
      nonExecutable: [],
      upToDate: [],
      outdated: []
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

  checkGitRepository() {
    if (!fs.existsSync(path.join(this.projectRoot, '.git'))) {
      throw new Error('Not a git repository');
    }
  }

  validateHookExists(hookName) {
    const hookPath = path.join(this.hooksDir, hookName);
    const exists = fs.existsSync(hookPath);
    
    if (exists) {
      this.results.installed.push(hookName);
    } else {
      this.results.missing.push(hookName);
    }
    
    return exists;
  }

  validateHookExecutable(hookName) {
    const hookPath = path.join(this.hooksDir, hookName);
    
    if (!fs.existsSync(hookPath)) {
      return false;
    }
    
    const stats = fs.statSync(hookPath);
    const isExecutable = !!(stats.mode & 0o111);
    
    if (isExecutable) {
      this.results.executable.push(hookName);
    } else {
      this.results.nonExecutable.push(hookName);
    }
    
    return isExecutable;
  }

  validateHookContent(hookName) {
    const hookPath = path.join(this.hooksDir, hookName);
    const sourceHookPath = path.join(this.sourceHooksDir, hookName);
    
    if (!fs.existsSync(hookPath) || !fs.existsSync(sourceHookPath)) {
      return false;
    }
    
    const hookContent = fs.readFileSync(hookPath, 'utf8');
    const sourceContent = fs.readFileSync(sourceHookPath, 'utf8');
    
    const isUpToDate = hookContent === sourceContent;
    
    if (isUpToDate) {
      this.results.upToDate.push(hookName);
    } else {
      this.results.outdated.push(hookName);
    }
    
    return isUpToDate;
  }

  validateHookFunctionality(hookName) {
    const hookPath = path.join(this.hooksDir, hookName);
    
    if (!fs.existsSync(hookPath)) {
      return false;
    }
    
    try {
      // Basic syntax check for shell script
      execSync(`bash -n "${hookPath}"`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      this.log(`Hook ${hookName} has syntax errors: ${error.message}`, 'error');
      return false;
    }
  }

  checkRequiredTools() {
    const tools = [
      { name: 'yarn', command: 'yarn --version' },
      { name: 'node', command: 'node --version' },
      { name: 'git', command: 'git --version' },
      { name: 'eslint', command: 'yarn eslint --version' },
    ];

    const optional = [
      { name: 'semgrep', command: 'semgrep --version' },
      { name: 'commitlint', command: 'yarn commitlint --version' },
    ];

    this.log('Checking required tools...');
    
    let allRequired = true;
    tools.forEach(tool => {
      try {
        execSync(tool.command, { stdio: 'pipe' });
        this.log(`${tool.name}: available`, 'success');
      } catch (error) {
        this.log(`${tool.name}: missing or not working`, 'error');
        allRequired = false;
      }
    });

    this.log('Checking optional tools...');
    optional.forEach(tool => {
      try {
        execSync(tool.command, { stdio: 'pipe' });
        this.log(`${tool.name}: available`, 'success');
      } catch (error) {
        this.log(`${tool.name}: not available (optional)`, 'warning');
      }
    });

    return allRequired;
  }

  generateReport() {
    console.log('\n📋 Git Hooks Validation Report');
    console.log('================================\n');

    // Installation status
    console.log('📦 Installation Status:');
    if (this.results.installed.length > 0) {
      this.log(`Installed hooks: ${this.results.installed.join(', ')}`, 'success');
    }
    if (this.results.missing.length > 0) {
      this.log(`Missing hooks: ${this.results.missing.join(', ')}`, 'error');
    }

    // Executable status
    console.log('\n🔧 Executable Status:');
    if (this.results.executable.length > 0) {
      this.log(`Executable hooks: ${this.results.executable.join(', ')}`, 'success');
    }
    if (this.results.nonExecutable.length > 0) {
      this.log(`Non-executable hooks: ${this.results.nonExecutable.join(', ')}`, 'error');
    }

    // Content status
    console.log('\n📝 Content Status:');
    if (this.results.upToDate.length > 0) {
      this.log(`Up-to-date hooks: ${this.results.upToDate.join(', ')}`, 'success');
    }
    if (this.results.outdated.length > 0) {
      this.log(`Outdated hooks: ${this.results.outdated.join(', ')}`, 'warning');
    }

    // Overall status
    console.log('\n🎯 Overall Status:');
    const totalIssues = this.results.missing.length + 
                       this.results.nonExecutable.length + 
                       this.results.outdated.length;

    if (totalIssues === 0) {
      this.log('All hooks are properly installed and configured!', 'success');
      console.log('\n✨ Your repository is ready for PCI DSS compliant development!');
    } else {
      this.log(`Found ${totalIssues} issues that need attention`, 'warning');
      console.log('\n🔧 Recommended actions:');
      
      if (this.results.missing.length > 0 || this.results.nonExecutable.length > 0) {
        console.log('   • Run: yarn hooks:install');
      }
      
      if (this.results.outdated.length > 0) {
        console.log('   • Run: yarn hooks:repair');
      }
      
      console.log('   • Run: yarn hooks:validate (to check again)');
    }

    console.log('\n📚 Available commands:');
    console.log('   • yarn hooks:install - Install missing hooks');
    console.log('   • yarn hooks:repair  - Reinstall all hooks');
    console.log('   • yarn hooks:test    - Test hooks without committing');
    console.log('   • yarn hooks:validate - Run this validation again');

    return totalIssues === 0;
  }

  run() {
    try {
      this.log('🔍 Validating Git hooks for AmexingWeb...\n');
      
      this.checkGitRepository();
      
      // Check each required hook
      this.requiredHooks.forEach(hookName => {
        this.log(`Checking ${hookName}...`);
        
        if (this.validateHookExists(hookName)) {
          this.validateHookExecutable(hookName);
          this.validateHookContent(hookName);
          this.validateHookFunctionality(hookName);
        }
      });

      // Check required tools
      this.log('');
      const toolsOk = this.checkRequiredTools();
      
      // Generate and display report
      const allValid = this.generateReport();
      
      if (!allValid) {
        process.exit(1);
      }

    } catch (error) {
      this.log(`Validation failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// Run validation
const validator = new GitHooksValidator();
validator.run();