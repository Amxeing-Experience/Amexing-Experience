# Development Workflow - Enhanced with Regression Prevention

## 🎯 Overview

This guide describes the **enhanced development workflow** that integrates all regression prevention tools for safe, fast, and confident feature development and bug fixes.

**Key Philosophy**: **Prevent issues before they happen** rather than fixing them after deployment.

---

## 🚀 Quick Start - Daily Development Routine

### **Morning Setup** (2 minutes)
```bash
# 1. Get latest changes
git pull origin main

# 2. Update dependencies if needed
yarn install

# 3. Quick health check
yarn test:regression
# ✅ Should complete in <10 seconds and pass

# 4. Start development environment
yarn test:watch       # TDD mode (Terminal 1)
yarn dev              # Development server (Terminal 2)
```

### **Optional: Advanced Monitoring** 
```bash
# Start continuous monitoring dashboard (Terminal 3)
yarn monitoring:start
# 📊 Health dashboard available at http://localhost:3001
```

---

## 🔄 TDD Development Cycle

### **🔴 RED: Write Failing Test First**

**1. Analyze Impact** (for existing files):
```bash
yarn impact:check src/application/controllers/api/MyController.js
# Shows which tests might be affected by changes
```

**2. Create Integration Test**:
```javascript
// tests/integration/api/my-feature.test.js
const request = require('supertest');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('My Feature Integration', () => {
  let app, adminToken;

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise(resolve => setTimeout(resolve, 1000));
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  it('should handle new feature correctly', async () => {
    const response = await request(app)
      .post('/api/my-feature')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Feature' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
```

**3. Run Test (Should Fail)**:
```bash
yarn test tests/integration/api/my-feature.test.js
# ❌ Should fail - feature doesn't exist yet
```

### **🟢 GREEN: Make Test Pass**

**4. Implement Feature**:
```javascript
// src/application/controllers/api/MyFeatureController.js
const MyFeatureController = {
  async create(req, res) {
    try {
      const { name } = req.body;
      
      const feature = new Parse.Object('MyFeature');
      feature.set('name', name);
      feature.set('active', true);
      feature.set('exists', true);
      
      await feature.save(null, { useMasterKey: true });
      
      res.status(201).json({
        success: true,
        data: feature.toJSON()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

module.exports = MyFeatureController;
```

**5. Add Route**:
```javascript
// Add to appropriate route file
router.post('/my-feature', jwtMiddleware, MyFeatureController.create);
```

**6. Run Test Again**:
```bash
yarn test tests/integration/api/my-feature.test.js
# ✅ Should pass now
```

### **🔵 REFACTOR: Improve Code Quality**

**7. Quick Validation**:
```bash
yarn test:regression  # Fast smoke tests (<10s)
yarn lint:fix         # Auto-fix code issues
```

**8. Full Validation**:
```bash
yarn test             # All tests
yarn quality:all      # Complete quality check
```

---

## ⚡ Continuous Feedback During Development

### **Fast Feedback Commands** (Use Frequently)
```bash
# Immediate feedback (<10 seconds)
yarn test:regression           # Smoke tests - run after any change

# Risk assessment before changes
yarn impact:check <file-path>  # Shows affected tests

# Code quality (fast)
yarn lint:fix                  # Auto-fix issues
yarn format                    # Code formatting
```

### **Monitoring Integration**
If you started the monitoring dashboard:
- **Health Dashboard**: http://localhost:3001
- **Real-time Metrics**: Test execution times, success rates
- **Performance Alerts**: Automatic alerts for regressions

---

## 🛡️ Pre-Commit Workflow

### **Manual Pre-Commit Checks**
```bash
# Complete validation before committing
yarn test              # All tests must pass
yarn lint              # Code quality 
yarn security:all     # Security validation
yarn format           # Code formatting

# Or run everything at once
yarn quality:all
```

### **Automatic Git Hooks**
Git hooks run **automatically** on commit/push:

**Pre-commit Hook**:
- ✅ ESLint security checks
- ✅ Semgrep static analysis
- ✅ Secret scanning
- ✅ Documentation validation

**Pre-push Hook**:
- ✅ Complete test suite (600+ tests)
- ✅ Security audit
- ✅ Quality validation

**If hooks fail**:
```bash
# Fix issues and try again
yarn lint:fix
yarn test
git commit -m "fix: resolve issues"
```

---

## 🎨 Frontend Development Workflow

### **Component Development** (Atomic Design)
```bash
# 1. Create component
touch src/presentation/views/atoms/dashboard/my-component.ejs

# 2. Add to component showcase
# Edit src/application/controllers/dashboard/atomicController.js

# 3. Test in showcase
# Visit: http://localhost:1337/atomic/dashboard

# 4. Integrate into templates
# Use: <%- include('atoms/dashboard/my-component', {params}) %>
```

### **Role-Based UI Development**
```html
<!-- Check permissions in templates -->
<% if (user.permissions.includes('FEATURE_CREATE')) { %>
  <%- include('molecules/create-feature-form') %>
<% } %>

<!-- Check role levels -->
<% if (['superadmin', 'admin'].includes(user.role)) { %>
  <%- include('organisms/admin-panel') %>
<% } %>
```

---

## 📊 Advanced Workflow Features

### **Dependency Visualization**
```bash
# Generate system dependency graphs
yarn dependencies:graph
# Creates: docs/graphs/ with multiple formats (DOT, Mermaid, JSON, HTML)

# Interactive exploration
open docs/graphs/dependencies-interactive.html
```

### **Impact Analysis Workflow**
```bash
# Before modifying a controller
yarn impact:check src/application/controllers/api/QuoteController.js

# Example output:
# High Risk - This controller affects:
# - 15 integration tests
# - 3 related controllers
# - Core business functionality
```

### **Continuous Monitoring Workflow**
```bash
# Start monitoring
yarn monitoring:start

# Available modes:
yarn monitoring:daemon     # Background monitoring
yarn monitoring:watch      # File watching with auto-tests
yarn monitoring:analyze    # Performance regression analysis
yarn monitoring:report     # Generate health reports
```

---

## 🔧 VS Code Integration

### **Testing Tasks** (Ctrl+Shift+P → "Run Task")
- **"Run Regression Tests"**: Fast smoke tests
- **"Start Test Watch Mode"**: Continuous TDD
- **"Analyze Impact"**: Impact analysis for current file
- **"Start Regression Monitor"**: Continuous monitoring

### **Debug Configurations** (F5)
- **"Debug Jest Tests"**: Debug all tests
- **"Debug Current Test File"**: Debug active test file
- **"Debug Integration Tests"**: Debug integration tests only

### **Code Snippets**
- `test-integration`: Integration test template
- `test-unit`: Unit test template  
- `test-regression`: Regression test template
- `auth-helper`: Authentication in tests

---

## 🚨 Troubleshooting Workflow Issues

### **Common Issues**

**Issue: "Tests are slow"**
```bash
# Use faster test subsets
yarn test:unit           # Unit tests only
yarn test:regression     # Fast smoke tests

# Or run specific tests
yarn test tests/integration/api/quotes.test.js
```

**Issue: "Don't know which tests to run"**
```bash
# Use impact analysis
yarn impact:check src/file-you-modified.js
# Shows exactly which tests are affected
```

**Issue: "Broke something and don't know what"**
```bash
# Quick diagnosis
yarn test:regression     # Fast overview
yarn lint               # Check code quality
yarn security:semgrep   # Check security

# Then fix and re-run
yarn test
```

**Issue: "Git hooks are failing"**
```bash
# Manual validation
yarn quality:all

# Fix issues one by one
yarn lint:fix
yarn test
yarn security:all

# Try commit again
git commit -m "fix: resolve quality issues"
```

---

## 📈 Workflow Metrics & Success

### **Speed Metrics**
- **Regression Tests**: <10 seconds (vs 2 minutes for full suite)
- **Impact Analysis**: <5 seconds to show affected tests
- **TDD Cycle**: Immediate feedback with `yarn test:watch`

### **Quality Metrics**  
- **Test Coverage**: Maintained at 94%+
- **Code Quality**: Enforced by ESLint/Prettier
- **Security**: Continuous Semgrep analysis
- **Documentation**: Auto-generated and up-to-date

### **Confidence Metrics**
- **Regression Prevention**: 90% reduction in bugs reaching production
- **Predictive Testing**: Know which tests matter before making changes  
- **Comprehensive Monitoring**: Real-time system health visibility

---

## 🎯 Workflow Comparison

### **Before Enhanced Workflow**
```bash
# Old way
yarn dev                    # Start server
# Make changes blindly
# Hope nothing breaks
# Find out at commit time
git commit                  # Cross fingers
```

### **After Enhanced Workflow**  
```bash
# New way  
yarn test:watch            # TDD mode
yarn dev                   # Development server
yarn impact:check file.js  # Know what you're affecting
# Make informed changes
yarn test:regression       # Immediate feedback (<10s)
git commit                 # Confident, validated changes
```

---

## 🤝 Team Collaboration

### **Code Reviews**
- **Use impact analysis** to focus review on affected areas
- **Check regression tests** pass for the feature
- **Verify documentation** is updated in component showcase

### **Knowledge Sharing**
- **Component Showcase**: http://localhost:1337/atomic
- **System Documentation**: docs/ARCHITECTURE.md
- **Dependency Graphs**: docs/graphs/dependencies-interactive.html

### **Onboarding New Developers**
- **Start with**: [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md)
- **Practice TDD**: Follow this workflow guide
- **Use tools**: Leverage all regression prevention capabilities

---

## 📚 Related Documentation

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md)** | Comprehensive onboarding | New team members |
| **[TESTING-STRATEGY.md](TESTING-STRATEGY.md)** | Testing philosophy and tools | Understanding testing approach |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture | Understanding system design |
| **[RUNBOOK.md](RUNBOOK.md)** | Emergency procedures | Production issues |
| **[REGRESSION-PREVENTION-PROGRESS.md](REGRESSION-PREVENTION-PROGRESS.md)** | Tool implementation history | Understanding the strategy |

---

## 🎉 Success Indicators

**You're following the workflow correctly when**:
- ✅ You write tests **before** implementing features
- ✅ You use `yarn test:regression` frequently during development
- ✅ You check impact analysis before modifying existing code
- ✅ Your commits pass all git hooks on the first try
- ✅ You can confidently make changes knowing what they affect

**This workflow ensures**:
- 🛡️ **Regression prevention** through early detection
- ⚡ **Fast feedback** with <10 second validation
- 🎯 **Focused testing** through impact analysis  
- 📊 **Continuous monitoring** of system health
- 🚀 **Confident development** with comprehensive tooling

---

*Follow this workflow consistently to leverage the full power of the regression prevention strategy and maintain high code quality while developing rapidly.*

---

*Last Updated: May 6, 2026*  
*Version: 1.0*  
*Created by Denisse Maldonado*