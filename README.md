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

### 👥 For Contributors
- **[🤝 Contributing Guide](CONTRIBUTING.md)** - **Start here**: Gitflow, development process, and quality standards
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

## 🎯 Essential Commands

```bash
# Interactive help
yarn scripts:help              # Discover all 58 available scripts

# Development
yarn dev                       # Start dev server (http://localhost:1337)
yarn dev:prod                  # Start prod-like server (http://localhost:1338)

# Testing & Quality (enforced by git hooks)
yarn test                      # Run all tests
yarn test:watch                # TDD watch mode
yarn lint:fix                  # Auto-fix lint errors
yarn security:all              # Complete security audit

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
- **Testing**: Jest with comprehensive test suites
- **Code Quality**: ESLint, Prettier, SonarQube integration
- **Security Analysis**: Semgrep static analysis
- **Documentation**: JSDoc, OpenAPI/Swagger
- **Git Workflow**: Conventional commits, automated hooks

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
├── docs/                    # 📚 Organized documentation
│   ├── guides/             # Getting started guides
│   ├── reference/          # Technical reference docs
│   └── workflows/          # Development processes
├── src/                    # 🔧 Application source code
│   ├── application/        # Controllers, middleware, validators
│   ├── domain/            # Business logic and entities
│   ├── infrastructure/    # Database, security, services
│   └── presentation/      # Views, routes, public assets
├── config/                # ⚙️ Configuration files
├── scripts/               # 🛠️ Development and deployment scripts
└── tests/                 # 🧪 Test suites (unit, integration, security)
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
