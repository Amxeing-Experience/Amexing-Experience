# 🛠️ Scripts Directory

**Version**: 2.0
**Last Updated**: September 24, 2025
**Structure**: Organized and Secure

## 📋 Overview

This directory contains all project scripts organized by purpose and security level. Scripts are categorized into **global** (repository-shared) and **local** (development-only) to maintain security and organization.

## 🏗️ Directory Structure

```
scripts/
├── 🌍 global/                    # Repository scripts (committed)
│   ├── setup/                   # Project setup and configuration
│   ├── deployment/              # Release and deployment scripts
│   ├── validation/              # Code quality and compliance checks
│   ├── git-hooks/               # Shared Git hooks
│   └── help.js                  # Script documentation and help
├── 🏠 local/ (gitignored)        # Local development scripts
│   ├── development/             # Development utilities
│   ├── oauth-testing/           # OAuth flow testing
│   └── database/                # Database utilities
└── 📝 templates/                # Script templates
    ├── script-template.js       # Standard script template
    └── README.md                # Template documentation
```

## 🌍 Global Scripts (Repository)

These scripts are shared across the team and committed to the repository.

### 🔧 Setup Scripts (`global/setup/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `generate-secrets.js` | Generate secure environment secrets | `node scripts/global/setup/generate-secrets.js` |
| `setup-git-hooks.js` | Install Git hooks for team | `node scripts/global/setup/setup-git-hooks.js` |
| `after-pull.js` | Post-pull setup tasks | Automatic via Git hooks |

### 🚀 Deployment Scripts (`global/deployment/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `generate-release-notes.js` | Auto-generate release notes | `node scripts/global/deployment/generate-release-notes.js` |
| `deps-update-check.js` | Check for dependency updates | `node scripts/global/deployment/deps-update-check.js` |

### ✅ Validation Scripts (`global/validation/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `validate-git-hooks.js` | Validate Git hook installation | `node scripts/global/validation/validate-git-hooks.js` |
| `doc-coverage.js` | Check documentation coverage | `node scripts/global/validation/doc-coverage.js` |
| `validate-changelog.js` | Validate changelog format | `node scripts/global/validation/validate-changelog.js` |
| `test-git-hooks.js` | Test Git hooks functionality | `node scripts/global/validation/test-git-hooks.js` |

### 🔗 Git Hooks (`global/git-hooks/`)

Shared Git hooks for consistent team workflows:
- `pre-commit` - Linting, formatting, basic tests
- `commit-msg` - Commit message validation
- `pre-push` - Pre-push validations
- `post-merge` - Post-merge setup tasks

## 🏠 Local Scripts (Development Only)

These scripts are for local development and are excluded from the repository.

### 👨‍💻 Development Utilities (`local/development/`)

| Script | Purpose | Security Features |
|--------|---------|-------------------|
| `seed-users.js` | Seed test users | ✅ No hardcoded credentials |
| `debug-users.js` | Debug user data | ✅ No sensitive data exposure |
| `clean-database.js` | Clean development DB | ✅ Environment validation |

### 🔐 OAuth Testing (`local/oauth-testing/`)

| Script | Purpose | Security Features |
|--------|---------|-------------------|
| `secure-oauth-test.js` | Test OAuth flows | ✅ Environment-based credentials |

### 🗄️ Database Utilities (`local/database/`)

Local database management and debugging scripts.

## 📝 Script Templates

Use the provided templates to create new scripts with proper structure:

```bash
# Copy template for new script
cp scripts/templates/script-template.js scripts/global/setup/my-new-script.js
```

## 🔒 Security Guidelines

### ✅ Do's
- ✅ Use environment variables for credentials
- ✅ Validate environment before execution
- ✅ Include proper JSDoc documentation
- ✅ Follow the script template structure
- ✅ Implement proper error handling
- ✅ Add security checks for production environments

### ❌ Don'ts
- ❌ Never hardcode credentials or secrets
- ❌ Don't commit local development scripts
- ❌ Avoid exposing sensitive data in logs
- ❌ Don't skip environment validation
- ❌ Don't run destructive scripts in production

## 🚀 Quick Start

### For New Team Members

1. **Setup Git Hooks** (required for all team members):
   ```bash
   node scripts/global/setup/setup-git-hooks.js
   ```

2. **Generate Development Secrets**:
   ```bash
   node scripts/global/setup/generate-secrets.js --env development
   ```

3. **Create Local Environment**:
   ```bash
   # Copy the local development scripts
   mkdir -p scripts/local/development
   cp scripts/templates/script-template.js scripts/local/development/my-script.js
   ```

### For Script Development

1. **Use the Template**:
   ```bash
   cp scripts/templates/script-template.js scripts/[category]/[your-script].js
   ```

2. **Follow Security Guidelines**:
   - Use environment variables for all credentials
   - Add proper validation and error handling
   - Include comprehensive documentation

3. **Test Your Script**:
   ```bash
   node scripts/[category]/[your-script].js --help
   node scripts/[category]/[your-script].js --verbose
   ```

## 📊 Script Categories

### Global Scripts Criteria
Scripts that should be in the repository:
- ✅ Shared team utilities
- ✅ CI/CD and deployment scripts
- ✅ Code quality and validation tools
- ✅ Project setup and configuration
- ✅ No sensitive data or credentials

### Local Scripts Criteria
Scripts that should be local only:
- ✅ Personal debugging tools
- ✅ Development data seeding
- ✅ OAuth testing with real credentials
- ✅ Database cleanup utilities
- ✅ Any script with hardcoded test data

## 🔧 Common Script Commands

### Environment Variables
```bash
# Development environment
NODE_ENV=development node scripts/[script].js

# Staging environment
NODE_ENV=staging node scripts/[script].js

# Load specific environment file
node -r dotenv/config scripts/[script].js dotenv_config_path=./environments/.env.development
```

### Common Patterns
```bash
# Help information
node scripts/[script].js --help

# Verbose output
node scripts/[script].js --verbose

# Dry run mode
node scripts/[script].js --dry-run

# Force execution
node scripts/[script].js --force
```

## 🧪 Testing Scripts

### Manual Testing
```bash
# Test script with help flag
node scripts/[script].js --help

# Test with minimal parameters
node scripts/[script].js --dry-run

# Test with full parameters
node scripts/[script].js --verbose --all-options
```

### Automated Testing
```bash
# Validate all global scripts
node scripts/global/validation/test-git-hooks.js

# Check documentation coverage
node scripts/global/validation/doc-coverage.js --scripts
```

## 📚 Best Practices

### Script Structure
1. **Shebang line**: `#!/usr/bin/env node`
2. **JSDoc header**: Complete documentation
3. **Environment loading**: Use dotenv
4. **Security checks**: Validate environment
5. **Argument parsing**: Standard patterns
6. **Error handling**: Comprehensive try/catch
7. **Cleanup**: Always clean up resources

### Error Handling
```javascript
try {
  await script.execute();
} catch (error) {
  console.error('❌ Script failed:', error.message);

  if (args.verbose) {
    console.error(error.stack);
  }

  process.exit(1);
} finally {
  await script.cleanup();
}
```

### Logging Standards
```javascript
// Use consistent logging
console.log('✅ Success message');
console.error('❌ Error message');
console.warn('⚠️ Warning message');
console.info('ℹ️ Information');
console.debug('🔍 Debug info');
```

## 🆘 Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   ```
   ❌ Missing required environment variables: VARIABLE_NAME
   💡 Solution: Add variables to .env.development
   ```

2. **Permission Denied**
   ```bash
   # Make script executable
   chmod +x scripts/[script].js
   ```

3. **Module Not Found**
   ```bash
   # Install dependencies
   npm install

   # Check require paths
   node -e "console.log(require.resolve('module-name'))"
   ```

### Debug Mode
```bash
# Enable Node.js debugging
DEBUG=* node scripts/[script].js

# Enable script verbose mode
node scripts/[script].js --verbose

# Check environment loading
node -e "console.log(process.env)" | grep SCRIPT_VAR
```

## 📞 Support

### Getting Help
- **Script Help**: `node scripts/[script].js --help`
- **General Help**: `node scripts/global/help.js`
- **Team Documentation**: Check planning/workflows/
- **Issues**: Create GitHub issue with "scripts" label

### Contact Points
- **Script Development**: Development Team
- **Security Questions**: Security Officer
- **CI/CD Scripts**: DevOps Team
- **Git Hooks**: Technical Lead

---

## 🎯 Migration Notes

This structure was created as part of the scripts reorganization to:
- ✅ Separate global vs local scripts
- ✅ Remove hardcoded credentials
- ✅ Improve security compliance (PCI DSS)
- ✅ Provide consistent templates
- ✅ Enable better maintainability

**Previous Issues Resolved:**
- 🔐 Removed hardcoded OAuth credentials
- 🧹 Cleaned up 34+ disorganized scripts
- 📚 Added comprehensive documentation
- 🏗️ Created proper structure and templates

---

*This documentation is maintained by the development team. For updates or suggestions, please create an issue.*