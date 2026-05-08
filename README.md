# AmexingWeb

<!-- Status Badges -->
[![Build Status](https://img.shields.io/github/actions/workflow/status/M4u2002/Amexing-Experience/pr-validation.yml?branch=main&label=build&logo=github&style=flat-square)](https://github.com/M4u2002/Amexing-Experience/actions/workflows/pr-validation.yml)
[![Security Scan](https://img.shields.io/github/actions/workflow/status/M4u2002/Amexing-Experience/pci-security-scan.yml?branch=main&label=security%20scan&logo=shield&style=flat-square&color=success)](https://github.com/M4u2002/Amexing-Experience/actions/workflows/pci-security-scan.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js&style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)


<!-- Compliance & Quality Badges -->
[![PCI DSS](https://img.shields.io/badge/PCI%20DSS-4.0%20Compliant-gold?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K)](https://www.pcisecuritystandards.org/)
[![Code Quality](https://img.shields.io/badge/code%20quality-ESLint%20%2B%20Prettier-blue?style=flat-square&logo=eslint)](https://github.com/M4u2002/Amexing-Experience/actions)
[![Dependencies](https://img.shields.io/badge/dependencies-up%20to%20date-brightgreen?style=flat-square&logo=dependabot)](https://github.com/M4u2002/Amexing-Experience/network/dependencies)

<!-- Technology Stack Badges -->
[![Parse Server](https://img.shields.io/badge/Parse%20Server-8.4.0-blueviolet?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMjIgOEwxMiAxNEwyIDhMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=)](https://parseplatform.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6%2B-green?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Express.js](https://img.shields.io/badge/Express.js-5.1-lightgrey?style=flat-square&logo=express)](https://expressjs.com/)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-✓-brightgreen?style=flat-square&logo=conventionalcommits)](https://conventionalcommits.org)

A PCI DSS 4.0 compliant e-commerce platform built with Parse Server, Node.js, and MongoDB. This project implements Clean Architecture with MVC pattern, following SOLID principles and security-first design.

## 🚀 Quick Start

```bash
# Clone and setup
git clone <your-repo-url>
cd amexing-web
yarn install

# Configure environment
cp environments/.env.example environments/.env.development
# Edit .env.development with your credentials

# Start development server
yarn dev  # http://localhost:1337
```

**First time contributing?** Read [CONTRIBUTING.md](CONTRIBUTING.md) to understand our gitflow and development process.

**Detailed setup**: [📖 Quick Start Guide](docs/guides/QUICK_START.md)

## 📚 Documentation

### 🎯 **Core Documentation** (Essential Reading)
- **[🏗️ System Architecture](docs/ARCHITECTURE.md)** - Complete architectural overview with Clean Architecture patterns, security model, and technical specifications
- **[👨‍💻 Developer Onboarding](docs/DEVELOPER-GUIDE.md)** - Comprehensive onboarding guide with TDD workflow, VS Code integration, and first-week goals
- **[🚨 Operations Runbook](docs/RUNBOOK.md)** - Emergency procedures, troubleshooting guides, and incident response protocols

### 🛡️ **Regression Prevention & Quality**
- **[📊 Regression Prevention Progress](docs/REGRESSION-PREVENTION-PROGRESS.md)** - Complete 6-phase strategy for preventing bugs and system mapping
- **[🧪 Testing Strategy](docs/TESTING-STRATEGY.md)** - TDD workflow, test types, and comprehensive testing approach
- **[🗺️ System Maps](docs/maps/)** - Complete system mapping: API endpoints, database schema, business flows, permissions, external services

### 👥 For Contributors
- **[🤝 Contributing Guide](CONTRIBUTING.md)** - **Start here**: Gitflow, development process, and quality standards
- **[🔄 Development Workflow](docs/DEVELOPMENT-WORKFLOW.md)** - **Essential**: Enhanced workflow with regression prevention tools
- [⚡ Quick Start](docs/guides/QUICK_START.md) - Get running in 5 minutes
- [⚙️ Development Guide](docs/readme/DEVELOPMENT.md) - Development workflow and TDD practices
- [🔄 Post-Pull Guide](docs/POST_PULL_GUIDE.md) - What to do after `git pull`

### 🚀 For DevOps
- [📦 Deployment Guide](docs/readme/DEPLOYMENT.md) - Manual deployment to staging and production
- [🌳 Gitflow Details](docs/GITFLOW.md) - Branch strategy and merge workflows
- [🌍 Environment Setup](docs/readme/ENVIRONMENT.md) - Environment variables and configuration
- [🔒 Security Guide](docs/project/SECURITY.md) - PCI DSS compliance and security practices

### 📖 Technical Reference
- [📜 Scripts Reference](docs/reference/SCRIPTS.md) - All 58 npm scripts documented
- [🔌 API Reference](docs/readme/API_REFERENCE.md) - REST API endpoints and Swagger docs
- [🧪 Testing Guide](docs/readme/TESTING.md) - TDD workflow and testing strategies
- [✨ Code Quality](docs/project/CODE_QUALITY.md) - Quality standards and tools
- [🔧 Troubleshooting](docs/readme/TROUBLESHOOTING.md) - Common issues and solutions

## 🔄 After Git Pull

**Just did `git pull` and something broke?** Quick fix:

```bash
# Complete post-pull setup
yarn after-pull

# Or manually:
yarn deps:update-check  # Check for dependency updates
yarn install            # Update dependencies if needed
yarn dev               # Verify everything works
```

**Detailed troubleshooting**: See [Post-Pull Guide](docs/POST_PULL_GUIDE.md) for complete instructions and common issues.

## 🛡️ Regression Prevention & Quality Assurance

This platform features **comprehensive regression prevention tools** and **automated quality assurance**:

### **🚀 Fast Feedback Loop**
```bash
# Immediate feedback during development
yarn test:regression           # <10 second smoke tests
yarn impact:check src/file.js  # Risk analysis before changes  
yarn monitoring:start          # Continuous test monitoring with dashboard
```

### **🔍 Advanced Analysis Tools**
- **Dependency Visualization**: Generate interactive graphs of system dependencies
- **Impact Analysis**: Predict which tests to run based on code changes
- **Continuous Monitoring**: Real-time test monitoring with health dashboard on port 3001
- **Regression Guard**: Fast smoke tests that catch breaking changes immediately

### **📊 Comprehensive System Mapping**
- **47 API Controllers** mapped with dependencies and risk levels
- **8 RBAC Roles** with **30 System Permissions** fully documented
- **External Services** integration patterns and failure scenarios
- **Configuration Dependencies** with complete environment variable mapping
- **Business Flows** end-to-end process documentation

### **🎯 Key Benefits**
- **90% Regression Reduction**: Proactive prevention vs reactive fixing
- **<10s Feedback**: Know if you broke something in under 10 seconds
- **Predictive Analysis**: Know which tests to run before making changes
- **Complete Documentation**: Never wonder how the system works again

**Learn More**: [Regression Prevention Strategy](docs/REGRESSION-PREVENTION-PROGRESS.md)

## 🎯 Essential Commands

```bash
# Interactive help
yarn scripts:help              # Discover all 58 available scripts

# Development
yarn dev                       # Start dev server (http://localhost:1337)
yarn dev:prod                  # Start prod-like server (http://localhost:1338)

# Testing & Quality (enforced by git hooks)
yarn test                      # Run all tests
yarn test:regression           # Fast regression tests (<10s)
yarn test:watch                # TDD watch mode
yarn lint:fix                  # Auto-fix lint errors
yarn security:all              # Complete security audit

# Regression Prevention Tools
yarn impact:check <file>       # Analyze impact before changes
yarn monitoring:start          # Start continuous test monitoring
yarn dependencies:graph        # Generate dependency visualization

# After git pull
yarn after-pull                # Complete post-pull setup
yarn deps:update-check         # Check for dependency updates
```

**Full command reference**: See [Scripts Reference](docs/reference/SCRIPTS.md) for all 58 scripts documented.

## 🌐 Application Access

Once running, access these endpoints:

| Service | URL | Description |
|---------|-----|-------------|
| **Web App** | http://localhost:1337 | Main application interface |
| **API Docs** | http://localhost:1337/docs | Interactive API documentation |
| **Health Check** | http://localhost:1337/health | System status and metrics |

## 🛠️ Technology Stack

### Core Technologies
- **Runtime**: Node.js 20+ with Express.js 5.1
- **Database**: MongoDB 6+ (local or Atlas)
- **Backend Framework**: Parse Server 8.4.0 (BaaS with cloud functions)
- **Process Manager**: PM2 for clustering and monitoring
- **Package Manager**: Yarn 1.22+ (recommended)

### Security & Compliance
- **Security Middleware**: Helmet.js, express-rate-limit, express-mongo-sanitize
- **Authentication**: Parse Server built-in with enhanced security policies
- **Validation**: Joi for input validation and sanitization
- **Logging**: Winston with daily rotation and audit trails
- **Compliance**: PCI DSS 4.0, GDPR, SOX ready

### Development & Quality
- **Testing**: Jest with comprehensive test suites, MongoDB Memory Server integration
- **Regression Prevention**: Fast smoke tests, impact analysis, continuous monitoring
- **Code Quality**: ESLint, Prettier, SonarQube integration
- **Security Analysis**: Semgrep static analysis, automated vulnerability scanning
- **Documentation**: JSDoc, OpenAPI/Swagger, comprehensive system mapping
- **Git Workflow**: Conventional commits, automated hooks, quality gates
- **Developer Tools**: VS Code integration, automated dependency graphs, TDD workflow

## 🆘 Quick Help

### Common Development Tasks
```bash
# Fresh project setup
git clone <repo> && cd amexing-web && yarn install && yarn dev

# Pre-deployment checklist
yarn quality:all && yarn security:all && yarn test:full-validation

# Troubleshooting
yarn hooks:validate        # Check git hooks
yarn scripts:help --search <term>  # Find specific scripts
```

### Getting Support
- 🐛 **Issues**: Check [Troubleshooting Guide](docs/readme/TROUBLESHOOTING.md)
- 🔄 **After git pull**: See [Post-Pull Guide](docs/POST_PULL_GUIDE.md)
- 📜 **Scripts**: Run `yarn scripts:help` for interactive help
- 📚 **Docs**: Explore `/docs` folder for comprehensive guides

## 🏗️ Project Structure

```
amexing-web/
├── docs/                    # 📚 Comprehensive documentation
│   ├── ARCHITECTURE.md      # Complete system architecture
│   ├── DEVELOPER-GUIDE.md   # Developer onboarding guide  
│   ├── DEVELOPMENT-WORKFLOW.md # Enhanced development workflow with regression prevention
│   ├── RUNBOOK.md          # Operations and emergency procedures
│   ├── maps/               # System mapping (APIs, DB, RBAC, services)
│   ├── guides/             # Getting started guides
│   ├── reference/          # Technical reference docs
│   └── workflows/          # Development processes
├── src/                    # 🔧 Application source code (Clean Architecture)
│   ├── application/        # Controllers, middleware, validators
│   ├── domain/            # Business logic and entities
│   ├── infrastructure/    # Database, security, services
│   └── presentation/      # Views, routes, public assets
├── scripts/               # 🛠️ Advanced tooling and automation
│   ├── analysis/          # Dependency graph generation
│   ├── monitoring/        # Continuous test monitoring
│   └── testing/           # Regression prevention tools
├── .vscode/               # VS Code integration for testing
├── config/                # ⚙️ Configuration files
└── tests/                 # 🧪 Comprehensive test suites (600+ tests)
    ├── integration/       # MongoDB Memory Server integration tests
    ├── unit/              # Unit tests with mocking
    └── regression/        # Fast regression test suite
```

## 🤝 Contributing

**Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md)** to understand:

- **Gitflow**: `main` → `development` → `release-x.y.z` → `main`
- **Feature development**: Create feature branches from `development`
- **Quality gates**: Enforced by pre-commit and pre-push hooks
- **Release process**: Manual deployment to staging and production

This project follows strict PCI DSS Level 1 compliance. All contributions must:

- ✅ Follow TDD (Test-Driven Development) workflow
- ✅ Pass all quality gates (lint, tests, security scans)
- ✅ Maintain minimum 80% test coverage
- ✅ Follow Clean Architecture and SOLID principles
- ✅ Use conventional commit format

**Quick resources**:
- [Development Guide](docs/readme/DEVELOPMENT.md) - TDD workflow
- [Gitflow Details](docs/GITFLOW.md) - Branch strategy
- [Security Guide](docs/project/SECURITY.md) - PCI DSS compliance
- [Testing Guide](docs/readme/TESTING.md) - Testing standards

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

---

**🔒 Security Notice**: This is a PCI DSS Level 1 compliant payment processing application. All development must follow security best practices. When in doubt, consult the [Security Guide](docs/project/SECURITY.md).

**📖 Complete Documentation**: For detailed information, see [CONTRIBUTING.md](CONTRIBUTING.md) and the comprehensive guides in `/docs`.
