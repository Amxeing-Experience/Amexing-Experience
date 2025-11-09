# Scripts Reference

Complete reference for all AmexingWeb npm scripts. This project includes **58 scripts** organized into **9 categories** for different aspects of development, testing, security, and deployment.

## 🆘 Quick Help

```bash
yarn help                    # Show all scripts with descriptions
yarn help development        # Show development scripts only  
yarn help security          # Show security scripts only
yarn help testing           # Show testing scripts only
yarn help --search test      # Search scripts containing 'test'
yarn help --list            # List all script categories
```

## 📋 Script Categories Overview

| Category | Scripts | Purpose |
|----------|---------|---------|
| 🚀 [Development & Runtime](#-development--runtime) | 8 scripts | Server startup, development tools, dashboard |
| 🧪 [Testing & QA](#-testing--quality-assurance) | 9 scripts | Unit tests, integration tests, security validation |
| 🔒 [Security & Compliance](#-security--compliance) | 6 scripts | Security audits, vulnerability scanning, PCI DSS compliance |
| 📋 [Code Quality](#-code-quality--analysis) | 6 scripts | Linting, formatting, complexity analysis, SonarQube |
| 📚 [Documentation](#-documentation) | 3 scripts | API docs generation, JSDoc, documentation coverage |
| 🔧 [Infrastructure & Secrets](#-infrastructure--secrets) | 6 scripts | Environment management, secrets handling, encryption |
| 🎯 [Git & Release Management](#-git--release-management) | 10 scripts | Git hooks, changelog, versioning, conventional commits |
| 📊 [Analytics & Monitoring](#-analytics--monitoring) | 3 scripts | SonarQube analysis, metrics, monitoring |
| ⚙️ [Dependencies & Licenses](#-dependencies--licenses) | 4 scripts | Dependency checking, license validation, updates |
| 🔗 [Git Hooks Management](#-git-hooks-management) | 3 scripts | Hook installation, validation, testing |

---

## 🚀 Development & Runtime

Scripts for starting the application, development server, and runtime management.

| Script | Description | Usage | Environment |
|--------|-------------|-------|-------------|
| **`start`** | Start production server | `yarn start` | Production |
| **`dev`** | Start development server with hot reload | `yarn dev` | Development |
| **`prod`** | Start with PM2 in production mode | `yarn prod` | Production |
| **`pm2:dev`** | Start with PM2 in development mode | `yarn pm2:dev` | Development |
| **`pm2:stop`** | Stop all PM2 processes | `yarn pm2:stop` | Any |
| **`pm2:restart`** | Restart all PM2 processes | `yarn pm2:restart` | Any |
| **`pm2:logs`** | View PM2 logs | `yarn pm2:logs` | Any |

### Common Development Workflows

```bash
# Standard development startup
yarn install && yarn dev

# Production deployment  
yarn install --production && yarn prod

# Development with dashboard
yarn dev & 

# PM2 management
yarn pm2:dev        # Start
yarn pm2:logs       # Monitor
yarn pm2:restart    # Restart
yarn pm2:stop       # Stop
```

---

## 🧪 Testing & Quality Assurance

Comprehensive testing suite including unit tests, integration tests, and security validation.

| Script | Description | Usage | Timeout |
|--------|-------------|-------|---------|
| **`test`** | Run all tests with Jest | `yarn test` | 30s |
| **`test:watch`** | Run tests in watch mode | `yarn test:watch` | ∞ |
| **`test:coverage`** | Generate test coverage report | `yarn test:coverage` | 30s |
| **`test:unit`** | Run unit tests only | `yarn test:unit` | 30s |
| **`test:integration`** | Run integration tests only | `yarn test:integration` | 30s |
| **`test:security`** | Run security integration tests | `yarn test:security` | 30s |
| **`test:startup`** | Validate application startup | `yarn test:startup` | 30s |
| **`test:full-validation`** | Complete security and startup validation | `yarn test:full-validation` | 60s |
| **`test:ci`** | Run tests for CI/CD pipeline | `yarn test:ci` | 30s |

### Testing Workflows

```bash
# Development testing
yarn test:watch                    # Continuous testing during development

# Pre-commit validation  
yarn test:unit                     # Quick unit test validation
yarn test:security                 # Security compliance check

# Complete validation
yarn test:full-validation          # Security + startup + semgrep scan

# CI/CD pipeline
yarn test:ci                       # Coverage report for CI systems
```

---

## 🔒 Security & Compliance

PCI DSS 4.0 compliant security tools and vulnerability management.

| Script | Description | Usage | Severity |
|--------|-------------|-------|----------|
| **`security:audit`** | Check dependency vulnerabilities | `yarn security:audit` | Production |
| **`security:audit:fix`** | Fix dependency vulnerabilities | `yarn security:audit:fix` | Production |
| **`security:semgrep`** | Static security analysis (blocking) | `yarn security:semgrep` | Critical |
| **`security:check`** | Static security analysis (non-blocking) | `yarn security:check` | Info |
| **`security:all`** | Complete security audit | `yarn security:all` | Critical |

### Security Workflows

```bash
# Daily security checks
yarn security:check               # Non-blocking scan for development

# Pre-deployment security
yarn security:all                 # Complete audit before production

# Vulnerability management  
yarn security:audit               # Check for known vulnerabilities
yarn security:audit:fix           # Auto-fix vulnerabilities where possible

# PCI DSS Compliance validation
yarn test:security && yarn security:all
```

---

## 📋 Code Quality & Analysis

Code quality enforcement, linting, formatting, and complexity analysis.

| Script | Description | Usage | Auto-fix |
|--------|-------------|-------|----------|
| **`lint`** | Check code with ESLint | `yarn lint` | No |
| **`lint:fix`** | Fix ESLint errors automatically | `yarn lint:fix` | Yes |
| **`format`** | Format code with Prettier | `yarn format` | Yes |
| **`format:check`** | Check code formatting | `yarn format:check` | No |
| **`quality:complexity`** | Analyze code complexity | `yarn quality:complexity` | No |
| **`quality:all`** | Complete quality analysis | `yarn quality:all` | Partial |

### Quality Workflows

```bash
# Before committing (automated via git hooks)
yarn lint && yarn format:check && yarn docs:coverage

# Fix code issues
yarn lint:fix                     # Fix linting issues
yarn format                       # Apply consistent formatting

# Quality analysis
yarn quality:complexity           # Check for complex functions
yarn quality:all                  # Complete quality check
```

---

## 📚 Documentation

API documentation generation, JSDoc processing, and documentation coverage.

| Script | Description | Usage | Output |
|--------|-------------|-------|--------|
| **`docs`** | Generate JSDoc documentation | `yarn docs` | HTML |
| **`docs:md`** | Generate markdown API docs | `yarn docs:md` | Markdown |
| **`docs:coverage`** | Check JSDoc coverage | `yarn docs:coverage` | Report |

### Documentation Workflows

```bash
# Generate documentation
yarn docs                         # HTML documentation in /docs
yarn docs:md                      # Markdown API reference

# Validate documentation
yarn docs:coverage                # Ensure all functions are documented
```

---

## 🔧 Infrastructure & Secrets

Environment management, secrets handling, and encryption tools.

| Script | Description | Usage | Security |
|--------|-------------|-------|----------|
| **`secrets:setup`** | Initialize secrets management | `yarn secrets:setup` | High |
| **`secrets:generate`** | Generate environment secrets | `yarn secrets:generate` | High |
| **`secrets:generate:dev`** | Generate development secrets | `yarn secrets:generate:dev` | Medium |
| **`secrets:generate:staging`** | Generate encrypted staging secrets | `yarn secrets:generate:staging` | High |
| **`secrets:encrypt`** | Encrypt environment variables | `yarn secrets:encrypt` | High |
| **`secrets:decrypt`** | Decrypt environment variables | `yarn secrets:decrypt` | High |

### Secrets Management Workflows

```bash
# Initial setup
yarn secrets:setup                # Set up secrets management system
yarn secrets:generate:dev         # Create development environment

# Environment management
yarn secrets:generate staging     # Generate staging secrets
yarn secrets:encrypt             # Encrypt sensitive variables
yarn secrets:decrypt             # Decrypt for deployment
```

---

## 🎯 Git & Release Management

Git hooks, changelog generation, versioning, and conventional commits.

| Script | Description | Usage | Automation |
|--------|-------------|-------|-------------|
| **`hooks:install`** | Install git hooks | `yarn hooks:install` | Manual |
| **`hooks:repair`** | Repair git hooks installation | `yarn hooks:repair` | Manual |
| **`hooks:validate`** | Validate git hooks setup | `yarn hooks:validate` | Manual |
| **`hooks:test`** | Test git hooks functionality | `yarn hooks:test` | Manual |
| **`changelog:generate`** | Generate CHANGELOG.md | `yarn changelog:generate` | Manual |
| **`changelog:validate`** | Validate changelog format | `yarn changelog:validate` | Manual |
| **`changelog:unreleased`** | Generate unreleased changes | `yarn changelog:unreleased` | Manual |
| **`release:prepare`** | Prepare release (dry run) | `yarn release:prepare` | Manual |
| **`release:notes`** | Generate release notes | `yarn release:notes` | Manual |
| **`release:version`** | Create new version release | `yarn release:version` | Manual |
| **`commit:validate`** | Validate commit messages | `yarn commit:validate` | Auto |

### Release Workflows

```bash
# Prepare for release
yarn changelog:generate           # Update changelog
yarn release:prepare             # Preview release changes
yarn release:version             # Create release

# Git hooks management
yarn hooks:validate              # Check hooks are working
yarn hooks:repair                # Fix hooks if needed

# Commit validation
yarn commit:validate             # Check recent commit messages
```

---

## 📊 Analytics & Monitoring

SonarQube analysis, code quality metrics, and monitoring tools.

| Script | Description | Usage | Environment |
|--------|-------------|-------|-------------|
| **`sonar:scan`** | Run SonarQube scanner | `yarn sonar:scan` | CI/CD |
| **`sonar:local`** | Run SonarQube on local server | `yarn sonar:local` | Development |
| **`sonar:coverage`** | Run tests + SonarQube analysis | `yarn sonar:coverage` | CI/CD |

### Analytics Workflows

```bash
# Local analysis
yarn sonar:local                  # Analyze against local SonarQube

# CI/CD integration
yarn sonar:coverage               # Generate coverage + analyze
yarn sonar:scan                   # Production quality gate
```

---

## ⚙️ Dependencies & Licenses

Dependency management, license validation, and package analysis.

| Script | Description | Usage | Frequency |
|--------|-------------|-------|-----------|
| **`deps:check`** | Check for unused dependencies | `yarn deps:check` | Weekly |
| **`deps:outdated`** | Check for outdated packages | `yarn deps:outdated` | Weekly |
| **`deps:licenses`** | Generate license summary | `yarn deps:licenses` | Release |
| **`deps:licenses:full`** | Generate detailed license report | `yarn deps:licenses:full` | Audit |

### Dependency Workflows

```bash
# Regular maintenance
yarn deps:outdated               # Check for updates
yarn deps:check                  # Find unused packages

# Compliance and auditing
yarn deps:licenses               # License compliance check
yarn deps:licenses:full          # Detailed license audit
```

---

## 🔗 Git Hooks Management

Specialized hooks for PCI DSS compliance and code quality enforcement.

| Script | Description | Usage | Trigger |
|--------|-------------|-------|---------|
| **`precommit`** | Pre-commit validation | `git commit` | Auto |
| **`prepush`** | Pre-push quality checks | `git push` | Auto |
| **`postinstall`** | Post-install hook setup | `yarn install` | Auto |

### Git Hooks Workflows

```bash
# Automatic triggers (via git operations)
git commit                       # Triggers precommit
git push                         # Triggers prepush
yarn install                     # Triggers postinstall

# Manual testing
yarn hooks:test                  # Test all hooks
yarn precommit                   # Test pre-commit manually
yarn prepush                     # Test pre-push manually
```

---

## 🔄 Common Multi-Script Workflows

### Complete Development Setup

```bash
# Fresh project setup
git clone <repo>
cd amexing-web
yarn install                     # Runs postinstall -> hooks setup
yarn hooks:validate             # Verify hooks installed
cp .env.example .env            # Configure environment
yarn dev                        # Start development server
```

### Pre-Deployment Checklist

```bash
# Quality assurance
yarn quality:all                # Code quality check
yarn test:full-validation       # Security + startup validation
yarn security:all              # Complete security audit
yarn docs:coverage              # Documentation coverage

# Release preparation
yarn changelog:generate         # Update changelog
yarn release:prepare           # Preview release
```

### Continuous Integration Workflow

```bash
# CI/CD pipeline scripts
yarn install --frozen-lockfile  # Install exact dependencies
yarn test:ci                   # Run tests with coverage
yarn security:all             # Security compliance
yarn sonar:coverage           # Quality analysis
yarn build                    # Build for production
```

### Development Quality Loop

```bash
# Daily development workflow
yarn dev                       # Start development
# ... make changes ...
yarn lint:fix                 # Fix linting issues
yarn format                   # Apply formatting
yarn test:watch               # Run tests continuously
# ... git commit triggers precommit automatically ...
# ... git push triggers prepush automatically ...
```

---

## 📚 Additional Resources

- [Quick Start Guide](../guides/QUICK_START.md) - Get started in 5 minutes
- [Development Guide](../guides/DEVELOPMENT.md) - Development workflow
- [Security Guide](../reference/SECURITY.md) - Security best practices  
- [Environment Setup](../reference/ENVIRONMENT.md) - Environment variables
- [Troubleshooting](../guides/TROUBLESHOOTING.md) - Common issues and solutions

---

## 🆘 Getting Help

### Script Help System
```bash
yarn help                       # Interactive help system
yarn help <category>            # Category-specific help
yarn help --search <term>       # Search scripts
```

### Support Channels
- 📧 **Issues**: [GitHub Issues](link-to-issues)
- 📚 **Documentation**: Check relevant guide in `/docs`
- 🔧 **Troubleshooting**: [Common Issues Guide](../guides/TROUBLESHOOTING.md)

---

*Generated for AmexingWeb v1.0.0 - PCI DSS 4.0 Compliant E-commerce Platform*