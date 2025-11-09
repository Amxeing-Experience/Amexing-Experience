# Quick Start Guide

Get AmexingWeb up and running in 5 minutes with this comprehensive setup guide.

## Prerequisites

### System Requirements

- **Node.js 18+** - Runtime environment
- **MongoDB 6+** - Database (local or Atlas)
- **Yarn 1.22+** - Package manager (recommended) or npm 9+

### Why Yarn?
- ✅ **Faster installations** - Parallel downloads and better caching
- ✅ **Deterministic builds** - yarn.lock ensures consistent installs
- ✅ **Better security** - Built-in security features and vulnerability detection
- ✅ **Network resilience** - Automatic retries and offline mode

---

## Installation

### 1. Clone and Setup Environment

```bash
# Clone the repository
git clone <your-repo-url>
cd amexing-web

# Setup environment configuration
cp environments/.env.example environments/.env.development
# Edit environments/.env.development with your configuration (see Environment section below)
```

### 2. Install Dependencies

```bash
# Install all dependencies (production + development)
yarn install

# This will automatically:
# - Install all required packages
# - Setup git hooks via postinstall script
```

### 🔄 ¿Actualizando el proyecto existente?

Si ya tienes el proyecto y acabas de hacer `git pull`, sigue estos pasos:

```bash
# 1. Verificar si hay cambios en dependencias
yarn deps:update-check

# 2. Si aparecen cambios importantes, actualizar:
yarn install

# 3. Para actualizaciones completas (Parse Server, etc.):
yarn after-pull

# 4. Verificar que todo funciona:
yarn dev
```

**⚠️ Actualizaciones Recientes Importantes:**
- **Parse Server 8.2.4** (desde 7.x) - Cambios significativos en API
- **Node.js 24** - Usa `--experimental-vm-modules` automáticamente
- **Security Resolutions** - 86% reducción de vulnerabilidades

### 3. Git Hooks Setup (PCI DSS Compliance)

Git hooks are automatically installed during `yarn install`, but you should verify they're working:

```bash
# Verify hooks are installed correctly
yarn hooks:validate

# If validation fails, manually install hooks
yarn hooks:install

# Test hooks functionality
yarn hooks:test
```

**What git hooks do:**
- **Pre-commit**: Lint code, check formatting, validate documentation
- **Pre-push**: Run complete quality analysis and security checks
- **Commit-msg**: Enforce conventional commit format
- **Post-merge**: Update dependencies if package.json changed

### 4. Database Setup

Choose one of the following database options:

#### Option A: Local MongoDB

```bash
# macOS with Homebrew
brew install mongodb-community
brew services start mongodb-community

# Ubuntu/Debian
sudo systemctl start mongod

# Verify MongoDB is running
mongo --eval "db.adminCommand('ismaster')"
```

#### Option B: Docker MongoDB

```bash
# Start MongoDB container
docker run -d -p 27017:27017 --name amexing-mongo \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  mongo:6

# Verify container is running
docker ps | grep amexing-mongo
```

#### Option C: MongoDB Atlas (Cloud)

1. Create account at [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a cluster
3. Get connection string
4. Update `DATABASE_URI` in your `.env` file

### 5. Environment Configuration

Edit your `.env` file with appropriate values:

```bash
# Essential configuration
NODE_ENV=development
PORT=1337
DATABASE_URI=mongodb://localhost:27017/amexingdb_dev

# Parse Server (auto-generated during secrets:generate:dev)
PARSE_APP_ID=your-app-id
PARSE_MASTER_KEY=your-master-key
PARSE_SERVER_URL=http://localhost:1337/parse

# Generate secure secrets for development
yarn secrets:generate:dev
```

### 6. Start the Application

```bash
# Development mode (hot reload)
yarn dev

# Alternative: Production mode with PM2
yarn prod
```

---

## Access Points

Once the application is running:

| Service | URL | Description |
|---------|-----|-------------|
| **Main Application** | http://localhost:1337 | Web interface |
| **API Documentation** | http://localhost:1337/docs | Interactive API docs |
| **Health Check** | http://localhost:1337/health | System status |
| **Metrics** | http://localhost:1337/metrics | System metrics |

---

## Verification

### 1. Health Check

```bash
curl http://localhost:1337/health
```

Expected response:
```json
{
  "status": "healthy",
  "environment": "development",
  "database": {
    "connected": true,
    "responseTime": 25
  },
  "uptime": 42.123
}
```

### 2. Parse Server Check

```bash
curl -X POST http://localhost:1337/parse/functions/hello \
  -H "X-Parse-Application-Id: your-app-id" \
  -H "Content-Type: application/json" \
  -d '{"name": "Developer"}'
```

### 3. Git Hooks Verification

```bash
# Make a test commit (should trigger pre-commit hooks)
git add README.md
git commit -m "test: verify git hooks functionality"
```

---

## Development Workflow

### Essential Commands

```bash
# Interactive help system
yarn scripts:help                    # Show all available scripts
yarn scripts:help development        # Development-specific scripts
yarn scripts:help security          # Security-related scripts

# Development
yarn dev                            # Start development server

# Testing
yarn test                           # Run all tests
yarn test:security                  # Security validation
yarn test:watch                     # Continuous testing

# Code Quality
yarn lint                           # Check code quality
yarn format                         # Fix code formatting
yarn quality:all                    # Complete quality check

# Security
yarn security:check                 # Non-blocking security scan
yarn security:all                   # Complete security audit
```

### Development Server Features

When running `yarn dev`:
- ✅ **Hot reload** with nodemon
- ✅ **Debug logging** enabled
- ✅ **Source maps** for debugging
- ✅ **Comprehensive error reporting**

---

## Common Issues & Solutions

### Port Already in Use

```bash
# Check what's using port 1337
lsof -ti:1337
kill -9 $(lsof -ti:1337)

# Or use different port
PORT=3000 yarn dev
```

### MongoDB Connection Issues

```bash
# Check MongoDB status
brew services list | grep mongodb    # macOS
systemctl status mongod              # Linux
docker ps | grep mongo               # Docker

# Reset MongoDB
yarn secrets:generate:dev            # Regenerate connection strings
```

### Git Hooks Not Working

```bash
# Repair git hooks installation
yarn hooks:repair

# Manually verify hooks
ls -la .git/hooks/
yarn hooks:validate
```

### Parse Server Issues

```bash
# Check Parse Server configuration
curl http://localhost:1337/parse/serverInfo

# Verify app ID and master key
grep PARSE .env
```

---

## Next Steps

Once you have the application running:

1. **📚 Read the Documentation**
   - [Development Guide](DEVELOPMENT.md) - Development workflow
   - [Scripts Reference](../reference/SCRIPTS.md) - All 58 scripts documented
   - [API Reference](../reference/API_REFERENCE.md) - Complete API docs

2. **🔐 Security Setup**
   - Review [Security Guide](../reference/SECURITY.md)
   - Run complete security validation: `yarn test:full-validation`

3. **⚙️ Development Environment**
   - Setup your IDE with project settings
   - Configure debugging for Node.js and Parse Server
   - Review code quality standards

4. **🧪 Testing**
   - Explore the test suites: `yarn test`
   - Learn about security testing: `yarn test:security`
   - Setup continuous testing: `yarn test:watch`

---

## Getting Help

- 🆘 **Troubleshooting**: [Common Issues Guide](TROUBLESHOOTING.md)
- 📋 **Scripts Help**: `yarn scripts:help` or `yarn scripts:help --search <term>`
- 📧 **Support**: Create an issue in the project repository
- 📚 **Documentation**: Complete docs in `/docs` folder

---

*This guide gets you started quickly. For comprehensive information, see the complete documentation in the `/docs` folder.*