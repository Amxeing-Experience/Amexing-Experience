# Development Guide

## 🚀 Quick Start

```bash
# Clone and setup
git clone <repo-url> && cd amexing-web
cp .env.example .env
yarn install

# Start development server
yarn dev

# Access application
open http://localhost:1337
```

## 🔧 Development Commands

```bash
# Development
yarn dev              # Start with nodemon
yarn start            # Production mode


# Code Quality
yarn lint             # Check code style
yarn lint:fix         # Fix linting issues
yarn format           # Format with Prettier

# Testing
yarn test             # Run all tests
yarn test:watch       # Run tests in watch mode
yarn test:coverage    # Generate coverage report

# Security (PCI DSS)
yarn security:all     # Complete security scan
yarn security:audit   # Dependency vulnerabilities
yarn security:semgrep # Static security analysis
```

## 🏗️ Project Structure

```
src/
├── application/      # Controllers, middleware, validators
├── domain/          # Business logic and entities
├── infrastructure/  # External services, database, logging
├── presentation/    # Routes, views, public assets
└── cloud/          # Parse Server cloud functions
```

## 🛠️ Code Style

- **ESLint**: Enforced code quality and security rules
- **Prettier**: Consistent code formatting
- **Pre-commit hooks**: Automatic validation before commits

```bash
# Format code before committing
yarn format && yarn lint
```

## 🔒 Security Development

AmexingWeb follows **PCI DSS 4.0** secure development practices:

- ✅ All input must be validated and sanitized
- ✅ No hardcoded secrets or credentials
- ✅ Security middleware cannot be bypassed
- ✅ Audit logging for all security events

See [SECURE_DEVELOPMENT_GUIDE.md](../SECURE_DEVELOPMENT_GUIDE.md) for detailed security requirements.

## 🐛 Common Issues

### Port Already in Use
```bash
# Change port in .env file
PORT=3000
```

### MongoDB Connection Issues
```bash
# Check database connection string
DATABASE_URI=mongodb://localhost:27017/amexingdb
```

### Parse Server Issues
```bash
# Verify Parse Server configuration

```

For more troubleshooting: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)