# AmexingWeb

<!-- Status Badges -->
[![Build Status](https://img.shields.io/github/actions/workflow/status/black4ninja/amexing-web/pr-validation.yml?branch=main&label=build&logo=github&style=flat-square)](https://github.com/black4ninja/amexing-web/actions/workflows/pr-validation.yml)
[![Security Scan](https://img.shields.io/github/actions/workflow/status/black4ninja/amexing-web/pci-security-scan.yml?branch=main&label=security%20scan&logo=shield&style=flat-square&color=success)](https://github.com/black4ninja/amexing-web/actions/workflows/pci-security-scan.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?logo=node.js&style=flat-square)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

<!-- Compliance & Quality Badges -->
[![PCI DSS](https://img.shields.io/badge/PCI%20DSS-4.0%20Compliant-gold?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K)](https://www.pcisecuritystandards.org/)
[![Code Quality](https://img.shields.io/badge/code%20quality-ESLint%20%2B%20Prettier-blue?style=flat-square&logo=eslint)](https://github.com/black4ninja/amexing-web/actions)
[![Dependencies](https://img.shields.io/badge/dependencies-up%20to%20date-brightgreen?style=flat-square&logo=dependabot)](https://github.com/black4ninja/amexing-web/network/dependencies)

<!-- Technology Stack Badges -->
[![Parse Server](https://img.shields.io/badge/Parse%20Server-7.0-blueviolet?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMjIgOEwxMiAxNEwyIDhMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=)](https://parseplatform.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6%2B-green?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18-lightgrey?style=flat-square&logo=express)](https://expressjs.com/)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-✓-brightgreen?style=flat-square&logo=conventionalcommits)](https://conventionalcommits.org)

A PCI DSS 4.0 compliant e-commerce platform built with Parse Server, Node.js, and MongoDB. This project implements Clean Architecture with MVC pattern, following SOLID principles and security-first design.

## ✨ Key Features

- 🔒 **PCI DSS 4.0 Compliant** - Payment card industry standards
- 🛡️ **Security First** - Comprehensive middleware with Helmet.js, rate limiting, XSS protection
- 🏗️ **Clean Architecture** - MVC pattern with domain-driven design
- ⚡ **Parse Server** - Powerful BaaS with cloud functions
- 🎯 **MongoDB** - NoSQL database with advanced security
- 📊 **PM2 Ready** - Production-ready process management
- 📝 **Comprehensive Logging** - Winston logger with audit trails

## 🚀 Quick Start

```bash
# Clone and setup
git clone <your-repo-url> && cd amexing-web
cp environments/.env.example environments/.env.development && yarn install

# Start development
yarn dev

# Access application
open http://localhost:1337
```

**Detailed setup**: [📖 Quick Start Guide](docs/guides/QUICK_START.md)

## 📚 Documentation

### 📖 Getting Started
- [⚡ Quick Start Guide](docs/guides/QUICK_START.md) - Get running in 5 minutes
- [⚙️ Development Guide](docs/readme/DEVELOPMENT.md) - Development workflow and best practices
- [🚀 Deployment Guide](docs/readme/DEPLOYMENT.md) - Production deployment instructions
- [🔧 Troubleshooting](docs/readme/TROUBLESHOOTING.md) - Common issues and solutions

### 📋 Reference Documentation
- [📜 Scripts Reference](docs/reference/SCRIPTS.md) - All 58 npm scripts documented
- [🔌 API Reference](docs/readme/API_REFERENCE.md) - Complete API documentation
- [🌍 Environment Variables](docs/readme/ENVIRONMENT.md) - Configuration options
- [🔒 Security Guide](SECURITY.md) - Security best practices and PCI DSS compliance

### 🔄 Development Workflows  
- [🧪 Testing Guide](docs/readme/TESTING.md) - Testing strategies and best practices
- [✨ Code Quality](docs/project/CODE_QUALITY.md) - Quality standards and tools
- [🎯 Release Process](docs/readme/RELEASE.md) - Release management workflow

## 🔄 Después de hacer Git Pull

**¿Acabas de hacer `git pull` y algo no funciona?** Sigue estos pasos:

```bash
# 1. Verificar si necesitas actualizar dependencias
yarn deps:update-check

# 2. Si hay cambios en package.json/yarn.lock, actualizar:
yarn install

# 3. Si hay actualizaciones importantes (Parse, Node.js, etc.):
yarn after-pull

# 4. Verificar que todo funciona:
yarn dev
```

### 🚨 Casos Críticos Recientes
- **Parse Server 8.2.4**: Requiere Node.js 20+ y `yarn install`
- **Node.js 24**: Usar `--experimental-vm-modules` (ya configurado)
- **Yarn resolutions**: Configuraciones de seguridad automáticas

## 🎯 Essential Commands

```bash
# Interactive help system
yarn scripts:help              # Show all available scripts
yarn scripts:help development  # Show development scripts
yarn scripts:help security     # Show security scripts

# Development
yarn dev                       # Start development server

# Post-pull utilities
yarn after-pull               # Complete post-pull setup
yarn deps:update-check        # Check if dependencies need updating
yarn deps:full-update         # Full dependency refresh

# Testing & Quality
yarn test                      # Run all tests
yarn test:security             # Security validation suite
yarn quality:all               # Complete quality analysis

# Security & Compliance
yarn security:all              # Complete security audit
yarn test:full-validation      # Security + startup validation
```

## 🌐 Application Access

Once running, access these endpoints:

| Service | URL | Description |
|---------|-----|-------------|
| **Web App** | http://localhost:1337 | Main application interface |
| **API Docs** | http://localhost:1337/docs | Interactive API documentation |
| **Health Check** | http://localhost:1337/health | System status and metrics |

## 🛠️ Technology Stack

### Core Technologies
- **Runtime**: Node.js 18+ with Express.js 4.18
- **Database**: MongoDB 6+ (local or Atlas)
- **Backend Framework**: Parse Server 7.0 (BaaS with cloud functions)
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
- 🐛 **Issues**: Check [Troubleshooting Guide](docs/guides/TROUBLESHOOTING.md)
- 📜 **Scripts**: Run `yarn scripts:help` for interactive help
- 📧 **Support**: [Create an issue](link-to-issues)
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

This project follows strict PCI DSS compliance requirements. Before contributing:

1. **Read the documentation**: [Development Guide](docs/guides/DEVELOPMENT.md)
2. **Follow security practices**: [Security Guide](docs/reference/SECURITY.md)
3. **Use conventional commits**: Enforced by git hooks
4. **Maintain test coverage**: All features require comprehensive tests

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

---

**🔒 Security Notice**: This is a PCI DSS Level 1 compliant payment processing application. All development must follow security best practices outlined in the documentation. When in doubt, consult the [Security Guide](docs/reference/SECURITY.md).

*For detailed information on any aspect of the project, see the comprehensive documentation in the `/docs` folder.*