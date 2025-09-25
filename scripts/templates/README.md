# 📝 Script Templates

**Purpose**: Standardized templates for creating new scripts
**Version**: 2.0
**Compliance**: PCI DSS Level 1

## 🎯 Overview

This directory contains templates for creating consistent, secure, and well-documented scripts. All templates follow security best practices and PCI DSS compliance requirements.

## 📋 Available Templates

### `script-template.js`
Complete JavaScript script template with:
- ✅ Proper JSDoc documentation
- ✅ Environment variable handling
- ✅ Security validations
- ✅ Error handling patterns
- ✅ Command-line argument parsing
- ✅ Help system
- ✅ Logging standards

## 🚀 How to Use Templates

### 1. Copy Template
```bash
# For global scripts (repository)
cp scripts/templates/script-template.js scripts/global/[category]/my-script.js

# For local scripts (development only)
cp scripts/templates/script-template.js scripts/local/[category]/my-script.js
```

### 2. Customize Template

Replace the following placeholders:

| Placeholder | Replace With | Example |
|-------------|--------------|---------|
| `[SCRIPT NAME]` | Your script name | `User Data Seeder` |
| `[Brief Description]` | One-line description | `Seeds development database with test users` |
| `[Detailed description]` | Full description | `This script creates test users for development...` |
| `[category]` | Script category | `development`, `setup`, `validation` |
| `[script-name]` | Script filename | `seed-users`, `validate-hooks` |
| `isLocalScript` | `true` or `false` | `true` for local scripts |

### 3. Implement Functionality

1. **Update the class name**: `ScriptTemplate` → `YourScriptName`
2. **Configure constants**: Update the `CONFIG` object
3. **Add required environment variables**: Update `validateEnvironment()`
4. **Implement main logic**: Update `execute()` method
5. **Add specific methods**: Add your business logic methods
6. **Update help text**: Customize `showHelp()` function

## 📚 Template Structure

### Header Section
```javascript
/**
 * [SCRIPT NAME] - [Brief Description]
 * [Detailed description...]
 *
 * Usage:
 *   node scripts/[category]/[script-name].js
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @security PCI DSS Compliant
 */
```

### Security Features
- ✅ Production environment checks
- ✅ Environment variable validation
- ✅ No hardcoded secrets
- ✅ Secure error handling
- ✅ Resource cleanup

### Standard Methods

| Method | Purpose | Required |
|--------|---------|----------|
| `constructor()` | Initialize script with options | ✅ |
| `validateEnvironment()` | Check required environment variables | ✅ |
| `log()` | Standardized logging | ✅ |
| `execute()` | Main script logic | ✅ |
| `cleanup()` | Resource cleanup | ✅ |

## 🔒 Security Checklist

When creating a new script, ensure:

### Environment Variables
- [ ] All credentials loaded from environment
- [ ] No hardcoded passwords or API keys
- [ ] Validation for required variables
- [ ] Appropriate defaults for optional variables

### Production Safety
- [ ] Production environment check (for local scripts)
- [ ] Confirmation prompts for destructive operations
- [ ] Dry-run mode for testing
- [ ] Clear logging of what will be changed

### Error Handling
- [ ] Try-catch blocks around async operations
- [ ] Meaningful error messages
- [ ] Graceful failure handling
- [ ] Resource cleanup in finally blocks

### Documentation
- [ ] Complete JSDoc header
- [ ] Usage examples
- [ ] Parameter descriptions
- [ ] Security notes

## 💡 Common Patterns

### Environment Variable Pattern
```javascript
const requiredVars = ['DB_URL', 'API_KEY'];
const missingVars = requiredVars.filter(name => !process.env[name]);

if (missingVars.length > 0) {
  console.error('❌ Missing environment variables:', missingVars);
  process.exit(1);
}
```

### Production Check Pattern
```javascript
if (process.env.NODE_ENV === 'production' && isLocalScript) {
  console.error('❌ SECURITY ERROR: Cannot run local script in production');
  process.exit(1);
}
```

### Async Error Handling Pattern
```javascript
try {
  await script.execute();
  console.log('✅ Script completed successfully');
} catch (error) {
  console.error('❌ Script failed:', error.message);
  if (verbose) console.error(error.stack);
  process.exit(1);
} finally {
  await script.cleanup();
}
```

### Argument Parsing Pattern
```javascript
function parseArguments() {
  const args = { verbose: false, help: false };
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--verbose': args.verbose = true; break;
      case '--help': args.help = true; break;
    }
  }

  return args;
}
```

## 🧪 Testing Your Script

### Basic Tests
```bash
# Test help functionality
node scripts/[category]/your-script.js --help

# Test with minimal parameters
node scripts/[category]/your-script.js --dry-run

# Test verbose mode
node scripts/[category]/your-script.js --verbose
```

### Security Tests
```bash
# Test without required environment variables
unset REQUIRED_VAR && node scripts/[category]/your-script.js

# Test production environment check (for local scripts)
NODE_ENV=production node scripts/local/development/your-script.js
```

## 📖 Examples

### Simple Setup Script
```javascript
class DatabaseSetup extends ScriptTemplate {
  async execute() {
    this.log('Setting up database...');

    // Create tables
    await this.createTables();

    // Set up indexes
    await this.createIndexes();

    this.log('Database setup completed', 'success');
  }

  async createTables() {
    // Implementation
  }
}
```

### OAuth Testing Script
```javascript
class OAuthTester extends ScriptTemplate {
  validateEnvironment() {
    const requiredVars = [
      'OAUTH_CLIENT_ID',
      'OAUTH_CLIENT_SECRET'
    ];
    // ... validation logic
  }

  async execute() {
    const authUrl = this.generateAuthUrl();
    const result = await this.testOAuthFlow(authUrl);
    return result;
  }
}
```

## 🎨 Customization Guidelines

### For Global Scripts
- Use generic, reusable patterns
- Avoid environment-specific hardcoding
- Include comprehensive documentation
- Follow team coding standards

### For Local Scripts
- Include development-specific shortcuts
- Add debugging and verbose options
- Include cleanup and reset functionality
- Focus on developer productivity

## 📞 Getting Help

### Template Questions
- Check the main scripts `README.md`
- Review existing scripts for examples
- Ask in the team development channel

### Security Questions
- Consult the security officer for sensitive operations
- Review PCI DSS compliance requirements
- Test scripts in development environment first

---

*These templates are continuously improved based on team feedback and best practices. Suggest improvements via GitHub issues.*