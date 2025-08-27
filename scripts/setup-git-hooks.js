#!/usr/bin/env node

/**
 * Git Hooks Setup Script for AmexingWeb
 * 
 * This script automatically installs and configures Git hooks for:
 * - PCI DSS compliance validation
 * - Security checks
 * - Conventional commit enforcement
 * - Changelog automation
 * 
 * Usage:
 *   yarn hooks:install
 *   node scripts/setup-git-hooks.js
 *   node scripts/setup-git-hooks.js --force
 *   node scripts/setup-git-hooks.js --auto (for postinstall)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class GitHooksSetup {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.hooksDir = path.join(this.projectRoot, '.git', 'hooks');
    this.sourceHooksDir = path.join(this.projectRoot, 'scripts', 'git-hooks');
    this.isForce = process.argv.includes('--force');
    this.isAuto = process.argv.includes('--auto');
    
    this.hooks = [
      'pre-commit',
      'commit-msg',
      'pre-push',
      'post-merge'
    ];
  }

  log(message, level = 'info') {
    if (this.isAuto && level !== 'error') return; // Quiet mode for postinstall
    
    const colors = {
      info: '\x1b[36m',   // Cyan
      success: '\x1b[32m', // Green
      warning: '\x1b[33m', // Yellow
      error: '\x1b[31m',   // Red
      reset: '\x1b[0m'
    };
    
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : level === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${colors[level]}${prefix} ${message}${colors.reset}`);
  }

  checkGitRepository() {
    if (!fs.existsSync(path.join(this.projectRoot, '.git'))) {
      throw new Error('Not a git repository. Initialize git first: git init');
    }
  }

  ensureDirectories() {
    // Ensure .git/hooks directory exists
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
      this.log('Created .git/hooks directory');
    }

    // Ensure source hooks directory exists
    if (!fs.existsSync(this.sourceHooksDir)) {
      fs.mkdirSync(this.sourceHooksDir, { recursive: true });
      this.log('Created scripts/git-hooks directory');
    }
  }

  createHookFiles() {
    this.hooks.forEach(hookName => {
      const sourceHook = path.join(this.sourceHooksDir, hookName);
      const targetHook = path.join(this.hooksDir, hookName);
      
      // Check if hook already exists and not forcing
      if (fs.existsSync(targetHook) && !this.isForce) {
        this.log(`Hook ${hookName} already exists (use --force to overwrite)`, 'warning');
        return;
      }

      // Create source hook if it doesn't exist
      if (!fs.existsSync(sourceHook)) {
        this.createSourceHook(hookName);
      }

      // Copy and make executable
      try {
        fs.copyFileSync(sourceHook, targetHook);
        fs.chmodSync(targetHook, 0o755);
        this.log(`Installed ${hookName} hook`, 'success');
      } catch (error) {
        this.log(`Failed to install ${hookName}: ${error.message}`, 'error');
      }
    });
  }

  createSourceHook(hookName) {
    const hookContent = this.getHookContent(hookName);
    const sourceHook = path.join(this.sourceHooksDir, hookName);
    
    fs.writeFileSync(sourceHook, hookContent, { mode: 0o755 });
    this.log(`Created source hook: ${hookName}`);
  }

  getHookContent(hookName) {
    const commonHeader = `#!/bin/bash
# ${hookName} hook for AmexingWeb PCI DSS Compliance
# Generated automatically by scripts/setup-git-hooks.js
# 
# This hook enforces security and compliance requirements

set -e

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "\${BLUE}ℹ️  \$1\${NC}"
}

log_success() {
    echo -e "\${GREEN}✅ \$1\${NC}"
}

log_warning() {
    echo -e "\${YELLOW}⚠️  \$1\${NC}"
}

log_error() {
    echo -e "\${RED}❌ \$1\${NC}"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    log_error "Not in project root directory"
    exit 1
fi

`;

    switch (hookName) {
      case 'pre-commit':
        return commonHeader + `
log_info "Running pre-commit checks for PCI DSS compliance..."

# 1. ESLint security checks
log_info "Running ESLint security analysis..."
if ! yarn lint; then
    log_error "ESLint checks failed. Fix issues before committing."
    exit 1
fi

# 2. Semgrep security analysis
log_info "Running Semgrep security analysis..."
if command -v semgrep >/dev/null 2>&1; then
    if ! yarn security:semgrep; then
        log_error "Semgrep security analysis failed. Review security issues."
        exit 1
    fi
else
    log_warning "Semgrep not found. Install with: pip install semgrep"
fi

# 3. Check for secrets in staged files (PCI DSS compliant)
log_info "Scanning for potential secrets..."
staged_files=$(git diff --cached --name-only)

if [ -n "$staged_files" ]; then
    # Exclude documentation and example files from secret scanning
    sensitive_files=$(echo "$staged_files" | grep -v "\\.md$" | grep -v "^docs/" | grep -v "\\.example$" | grep -v "^README")
    
    if [ -n "$sensitive_files" ]; then
        # Look for real secrets, excluding code examples and documentation
        if echo "$sensitive_files" | xargs grep -l "password\\|secret\\|key\\|token\\|credential" 2>/dev/null | \\
           xargs grep -v "// Example\\|# Example\\|\\.example\\|TODO\\|FIXME\\|body('password')\\|process\\.env\\." 2>/dev/null > /dev/null; then
            
            log_error "CRITICAL: Potential real secrets detected!"
            echo "$sensitive_files" | xargs grep -n "password\\|secret\\|key\\|token\\|credential" 2>/dev/null | \\
            grep -v "// Example\\|# Example\\|\\.example\\|TODO\\|FIXME\\|body('password')\\|process\\.env\\." || true
            echo ""
            
            # In CI/CD, always fail if real secrets detected
            if [ "$CI" = "true" ]; then
                log_error "CI/CD detected - blocking commit with potential secrets"
                exit 1
            fi
            
            # In development, require explicit confirmation
            read -p "Are these false positives? Type 'yes-false-positive' to continue: " response
            echo
            if [ "$response" != "yes-false-positive" ]; then
                log_error "Commit aborted. Review and remove sensitive data."
                exit 1
            fi
            
            # Log override for PCI DSS audit trail
            echo "$(date): Secret scan override by $(git config user.name || echo 'unknown') - $(git log -1 --pretty=format:'%s' 2>/dev/null || echo 'pending commit')" >> .git/security-audit.log
            log_warning "Override logged to security audit trail"
        fi
    fi
    
    # Additional PCI DSS checks - block real sensitive files
    if echo "$staged_files" | grep -E "\\.env$|\\.key$|\\.pem$|\\.p12$|id_rsa$|id_dsa$" > /dev/null; then
        log_error "Attempting to commit sensitive files - PCI DSS Req 3.4 violation!"
        echo "Blocked files:"
        echo "$staged_files" | grep -E "\\.env$|\\.key$|\\.pem$|\\.p12$|id_rsa$|id_dsa$"
        exit 1
    fi
fi

# 4. Validate changelog format (if exists)
if [ -f "CHANGELOG.md" ]; then
    log_info "Validating changelog format..."
    if command -v yarn >/dev/null 2>&1; then
        yarn changelog:validate || log_warning "Changelog validation failed"
    fi
fi

# 5. Documentation coverage check
log_info "Checking documentation coverage..."
if ! yarn docs:coverage; then
    log_warning "Documentation coverage check failed. Consider updating docs."
fi

# 6. Check for PCI DSS compliance keywords in security commits
if git diff --cached --name-only | grep -E "security|auth|encrypt|payment" >/dev/null; then
    log_info "Security-related files detected. Ensure proper documentation."
fi

log_success "Pre-commit checks completed successfully!"
`;

      case 'commit-msg':
        return commonHeader + `
log_info "Validating commit message format..."

# Read the commit message
commit_msg_file="$1"
commit_msg=$(cat "$commit_msg_file")

# 1. Validate conventional commit format
log_info "Checking conventional commit format..."
if command -v yarn >/dev/null 2>&1; then
    if ! echo "$commit_msg" | yarn --silent commit:validate; then
        log_error "Commit message does not follow conventional commit format"
        echo ""
        echo "Expected format:"
        echo "  type(scope): description"
        echo ""
        echo "Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, security, hotfix"
        echo ""
        echo "Examples:"
        echo "  feat(auth): implement MFA for admin access"
        echo "  fix(api): resolve authentication bypass vulnerability"
        echo "  security(encryption): upgrade to AES-256-GCM"
        echo ""
        exit 1
    fi
fi

# 2. Check for security classification in security commits
if echo "$commit_msg" | grep -E "^(security|hotfix)" >/dev/null; then
    if ! echo "$commit_msg" | grep "SECURITY:" >/dev/null; then
        log_error "Security commits must include security classification"
        echo ""
        echo "Add to commit body:"
        echo "SECURITY: [Critical|High|Medium|Low]"
        echo "PCI-DSS: Req X.X.X (if applicable)"
        echo ""
        exit 1
    fi
fi

# 3. Validate against sensitive data patterns
if echo "$commit_msg" | grep -iE "password|secret|token|key|credential" >/dev/null; then
    log_warning "Commit message contains potentially sensitive keywords"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_error "Commit aborted. Use generic terms in commit messages."
        exit 1
    fi
fi

log_success "Commit message validation passed!"
`;

      case 'pre-push':
        return commonHeader + `
log_info "Running pre-push validation..."

# 1. Check if changelog needs updating for version changes
current_version=$(grep '"version"' package.json | sed 's/.*"version": "\\(.*\\)".*/\\1/')
if git diff HEAD~1 package.json | grep '"version"' >/dev/null; then
    log_info "Version change detected. Checking changelog..."
    if [ -f "CHANGELOG.md" ]; then
        if ! grep "$current_version" CHANGELOG.md >/dev/null; then
            log_error "Version updated but CHANGELOG.md not updated"
            echo "Run: yarn changelog:generate"
            exit 1
        fi
    else
        log_warning "No CHANGELOG.md found. Consider creating one."
    fi
fi

# 2. Run security audit
log_info "Running security audit..."
if ! yarn audit --level high; then
    log_error "Security audit failed. Fix vulnerabilities before pushing."
    exit 1
fi

# 3. Ensure all tests pass
log_info "Running test suite..."
if ! yarn test; then
    log_error "Tests failed. Fix tests before pushing."
    exit 1
fi

# 4. Check for documentation updates on significant changes
changed_files=$(git diff HEAD~1 --name-only)
if echo "$changed_files" | grep -E "src/.*\\.(js|ts)$" | wc -l | grep -v "^0$" >/dev/null; then
    log_info "Source code changes detected. Checking documentation..."
    if ! echo "$changed_files" | grep -E "\\.(md|txt)$" >/dev/null; then
        log_warning "Code changes without documentation updates detected"
    fi
fi

log_success "Pre-push validation completed!"
`;

      case 'post-merge':
        return commonHeader + `
log_info "Running post-merge automation..."

# 1. Update changelog draft if package.json changed
if git diff HEAD~1 package.json | grep '"version"' >/dev/null; then
    log_info "Version change detected. Updating changelog draft..."
    if command -v yarn >/dev/null 2>&1; then
        yarn changelog:unreleased
        log_success "Changelog draft updated"
    fi
fi

# 2. Update compliance tracking if security files changed
security_files_changed=$(git diff HEAD~1 --name-only | grep -E "(security|auth|encrypt|compliance)" | wc -l)
if [ "$security_files_changed" -gt 0 ]; then
    log_info "Security-related files changed. Consider updating compliance tracking."
fi

# 3. Notify about security merges
if git log -1 --pretty=format:"%s" | grep -E "^(security|hotfix)" >/dev/null; then
    log_warning "Security-related merge detected!"
    log_info "Consider notifying security team and updating incident logs."
fi

log_success "Post-merge automation completed!"
`;

      default:
        return commonHeader + `
log_info "Generic hook: ${hookName}"
log_success "Hook executed successfully!"
`;
    }
  }

  validateInstallation() {
    let allInstalled = true;
    
    this.hooks.forEach(hookName => {
      const targetHook = path.join(this.hooksDir, hookName);
      if (fs.existsSync(targetHook)) {
        const stats = fs.statSync(targetHook);
        if (stats.mode & 0o111) { // Check if executable
          this.log(`${hookName}: installed and executable`, 'success');
        } else {
          this.log(`${hookName}: installed but not executable`, 'warning');
          allInstalled = false;
        }
      } else {
        this.log(`${hookName}: not installed`, 'error');
        allInstalled = false;
      }
    });

    return allInstalled;
  }

  installDependencies() {
    if (!this.isAuto) {
      this.log('Installing required dependencies...');
      try {
        execSync('yarn install --silent', { cwd: this.projectRoot });
        this.log('Dependencies installed', 'success');
      } catch (error) {
        this.log('Failed to install dependencies', 'warning');
      }
    }
  }

  run() {
    try {
      this.log('🔧 Setting up Git hooks for AmexingWeb PCI DSS compliance...');
      
      this.checkGitRepository();
      this.ensureDirectories();
      this.createHookFiles();
      
      if (this.validateInstallation()) {
        this.log('🎉 All Git hooks installed successfully!', 'success');
        
        if (!this.isAuto) {
          this.log('');
          this.log('Available commands:');
          this.log('  yarn hooks:validate  - Check hook status');
          this.log('  yarn hooks:repair    - Reinstall all hooks');
          this.log('  yarn hooks:test      - Test hooks without committing');
          this.log('');
          this.log('Hooks enforce:');
          this.log('  • PCI DSS compliance checks');
          this.log('  • Security vulnerability scanning');
          this.log('  • Conventional commit format');
          this.log('  • Documentation requirements');
          this.log('  • Secret detection');
        }
      } else {
        throw new Error('Some hooks failed to install properly');
      }

    } catch (error) {
      this.log(`Setup failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }
}

// Run the setup
const setup = new GitHooksSetup();
setup.run();