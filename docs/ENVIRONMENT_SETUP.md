# Environment Setup Guide

## Overview

This guide provides comprehensive instructions for setting up secure environment variables across different deployment environments (development, staging, production). AmexingWeb uses a multi-layer security approach to protect sensitive configuration data.

## 🔐 Security Architecture

### Security Layers

1. **Layer 1: Encryption at Rest**
   - Environment files encrypted using AES-256-GCM
   - Separate encryption keys per environment
   - Git-safe encrypted configuration storage

2. **Layer 2: Runtime Security**
   - Secrets loaded into memory temporarily
   - Automatic memory clearing after use
   - Process isolation and access auditing

3. **Layer 3: Enterprise Integration**
   - HashiCorp Vault support for production
   - Cloud secrets managers (AWS/Azure/GCP)
   - Kubernetes secrets integration

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Yarn package manager
- Git (for version control)
- Access to target deployment environment
- **VS Code** (recommended IDE with optimal configuration)

### 1. Generate Environment Secrets

```bash
# Development environment (auto-generated secrets)
node scripts/generate-secrets.js development

# Staging environment (production-like)
node scripts/generate-secrets.js staging

# Production environment (template only)
node scripts/generate-secrets.js production
```

### 2. Create Encrypted Environment Files

```bash
# Create encrypted environment file
node scripts/generate-secrets.js development --encrypt

# This creates .env.development.vault with encrypted secrets
```

### 3. Load Environment in Application

```javascript
// Load encrypted environment
const { getSecretsManager } = require('./src/infrastructure/secrets/secretsManager');

const manager = getSecretsManager();
manager.initialize(process.env.ENCRYPTION_KEY);
const secrets = manager.loadEncryptedEnv('./environments/.env.development.vault');
```

## 🏠 Development Environment

### Automatic Setup

The development environment uses auto-generated secure secrets for local development:

```bash
# Generate development secrets
node scripts/generate-secrets.js development

# Generated file: environments/.env.development
# Contains: Auto-generated secure secrets for all services
```

### Manual Setup

1. **Copy example environment:**
   ```bash
   cp environments/.env.example environments/.env.development
   ```

2. **Generate encryption key:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. **Update critical values:**
   ```bash
   # Required for development
   PARSE_MASTER_KEY=your-secure-master-key
   SESSION_SECRET=your-session-secret-min-32-chars
   JWT_SECRET=your-jwt-secret-min-32-chars
   ENCRYPTION_KEY=your-base64-encryption-key
   ```

### Development Security Features

- **Auto-generated secrets**: 32-64 character secure random values
- **Low security logging**: Debug level logging enabled
- **Extended timeouts**: 60-minute session timeout for development convenience
- **Reduced encryption rounds**: bcrypt rounds = 10 for faster development

### Example Development Configuration

```bash
# Parse Server Configuration
PARSE_APP_ID=amexing-dev-2024
PARSE_MASTER_KEY=dev_a8f9b2c3d4e5f6789012345678901234567890abcdef
PARSE_SERVER_URL=http://localhost:1337/parse

# Security Configuration  
SESSION_SECRET=dev_session_secret_32_chars_minimum_length_required_for_security
JWT_SECRET=dev_jwt_secret_32_chars_minimum_length_required_for_signing
ENCRYPTION_KEY=ZGV2X2VuY3J5cHRpb25fa2V5XzMyX2J5dGVzX21pbmltdW0=

# Development Settings
NODE_ENV=development
LOG_LEVEL=debug
SESSION_TIMEOUT_MINUTES=60
BCRYPT_ROUNDS=10
```

## 🧪 Staging Environment

### Production-Like Security

The staging environment mimics production security while allowing for testing:

```bash
# Generate staging secrets
node scripts/generate-secrets.js staging --encrypt

# Generated file: environments/.env.staging.vault (encrypted)
```

### Staging Configuration

- **Production-like secrets**: Secure random generation
- **External service placeholders**: Template values for Stripe, email services
- **Enhanced security**: 30-minute timeouts, increased bcrypt rounds
- **Audit logging**: Enabled for security testing

### Manual Staging Setup

1. **Generate encrypted environment:**
   ```bash
   node scripts/generate-secrets.js staging --encrypt
   ```

2. **Configure external services:**
   ```bash
   # Update .env.staging with real service credentials
   STRIPE_SECRET_KEY=sk_test_your_actual_stripe_test_key
   EMAIL_PASS=your_actual_email_app_password
   ```

3. **Deploy with encryption key:**
   ```bash
   # Set encryption key in staging server
   export ENCRYPTION_KEY="your_staging_encryption_key"
   ```

### Example Staging Configuration

```bash
# Encrypted in .env.staging.vault
# These are example decrypted values

# Parse Server Configuration
PARSE_APP_ID=amexing-staging-2024
PARSE_MASTER_KEY=staging_secure_master_key_48_characters_minimum
PARSE_SERVER_URL=https://staging.amexing.com/parse

# Security Configuration
SESSION_SECRET=staging_session_secret_64_characters_minimum_for_production_like_security
JWT_SECRET=staging_jwt_secret_64_characters_minimum_for_production_like_security
ENCRYPTION_KEY=c3RhZ2luZ19lbmNyeXB0aW9uX2tleV8zMl9ieXRlc19taW5pbXVt

# Staging Settings
NODE_ENV=staging
LOG_LEVEL=info
SESSION_TIMEOUT_MINUTES=30
BCRYPT_ROUNDS=12
ENABLE_AUDIT_LOGGING=true
```

## 🏭 Production Environment

### Enterprise Security Requirements

**⚠️ CRITICAL: Production secrets MUST be manually configured using enterprise-grade secrets management.**

### Recommended Production Setup

#### Option 1: HashiCorp Vault

```bash
# Install Vault integration
yarn add node-vault

# Configure Vault authentication
export VAULT_ADDR="https://vault.company.com"
export VAULT_TOKEN="your-vault-token"
```

```javascript
// Load secrets from Vault
const vault = require('node-vault')({
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN,
});

const secrets = await vault.read('secret/amexing/production');
```

#### Option 2: AWS Secrets Manager

```bash
# Install AWS SDK
yarn add @aws-sdk/client-secrets-manager

# Configure AWS credentials
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
```

```javascript
// Load secrets from AWS
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
const response = await client.send(new GetSecretValueCommand({
  SecretId: 'amexing/production/secrets',
}));
```

#### Option 3: Azure Key Vault

```bash
# Install Azure SDK
yarn add @azure/keyvault-secrets @azure/identity

# Configure Azure authentication
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_TENANT_ID="your-tenant-id"
```

```javascript
// Load secrets from Azure Key Vault
const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const client = new SecretClient('https://amexing-vault.vault.azure.net/', new DefaultAzureCredential());
const secret = await client.getSecret('database-password');
```

### Production Security Requirements

#### Required Security Measures

1. **Secret Rotation Policy**
   ```bash
   # Secrets must be rotated every 90 days
   # Automated rotation preferred
   # Emergency rotation procedures documented
   ```

2. **Access Control**
   ```bash
   # Principle of least privilege
   # Role-based access control (RBAC)
   # Multi-factor authentication (MFA) required
   ```

3. **Audit Logging**
   ```bash
   # All secret access logged
   # Centralized logging system
   # Real-time monitoring and alerting
   ```

4. **Encryption Standards**
   ```bash
   # AES-256 minimum encryption
   # TLS 1.3 for data in transit
   # Hardware Security Modules (HSM) preferred
   ```

### Production Environment Template

```bash
# Production secrets - MANUAL SETUP REQUIRED
# DO NOT use auto-generated values in production

# Parse Server Configuration
PARSE_APP_ID=amexing-prod-2024-secure
PARSE_MASTER_KEY=manually_set_secure_master_key_64_characters_minimum_enterprise_grade
PARSE_SERVER_URL=https://api.amexing.com/parse

# Security Configuration
SESSION_SECRET=manually_set_session_secret_128_characters_minimum_enterprise_grade
JWT_SECRET=manually_set_jwt_secret_128_characters_minimum_enterprise_grade
ENCRYPTION_KEY=manually_set_encryption_key_from_hsm_or_enterprise_kms

# Production Settings
NODE_ENV=production
LOG_LEVEL=warn
SESSION_TIMEOUT_MINUTES=15
BCRYPT_ROUNDS=14
ENABLE_AUDIT_LOGGING=true

# External Services (Use production keys)
STRIPE_SECRET_KEY=sk_live_manually_configured_stripe_production_key
EMAIL_PASS=manually_configured_production_email_credentials
```

## 🔧 Configuration Management

### Environment File Structure

```
project-root/
├── environments/
│   ├── .env.example              # Template with all variables
│   ├── .env.development          # Development configuration
│   ├── .env.staging             # Staging configuration
│   ├── .env.production          # Production configuration (if used)
│   ├── .env.development.vault   # Encrypted development file
│   ├── .env.staging.vault       # Encrypted staging file
│   └── .env.production.vault    # Encrypted production file (not recommended)
```

### Variable Categories

#### 1. Parse Server Variables
```bash
PARSE_APP_ID=application-identifier
PARSE_MASTER_KEY=server-master-key
PARSE_SERVER_URL=server-endpoint
```

#### 2. Security Variables
```bash
SESSION_SECRET=session-signing-key
JWT_SECRET=jwt-signing-key
ENCRYPTION_KEY=symmetric-encryption-key
BCRYPT_ROUNDS=password-hashing-rounds
```

#### 3. Database Variables
```bash
DATABASE_URI=mongodb-connection-string
DATABASE_NAME=database-name
```

#### 4. External Service Variables
```bash
STRIPE_SECRET_KEY=payment-processing-key
STRIPE_WEBHOOK_SECRET=webhook-verification-key
EMAIL_PASS=email-service-password
```

#### 5. Compliance Variables
```bash
PCI_ENVIRONMENT=compliance-environment
SESSION_TIMEOUT_MINUTES=session-timeout
MAX_LOGIN_ATTEMPTS=failed-login-limit
ACCOUNT_LOCKOUT_DURATION_MINUTES=lockout-duration
```

## 🛠️ Secret Generation Tools

### Automated Generation

```bash
# Generate all environment types
./scripts/generate-all-environments.sh

# Generate specific environment
node scripts/generate-secrets.js [environment] [options]

# Options:
#   --encrypt    Create encrypted file
#   --force      Overwrite existing files
#   --backup     Create backup of existing files
```

### Manual Generation Commands

```bash
# Generate random base64 key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate random hex key (64 characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate alphanumeric secret (24 characters)
node -e "const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; console.log(Array.from({length:24}, () => chars[Math.floor(Math.random() * chars.length)]).join(''))"

# Generate UUID v4
node -e "console.log(require('crypto').randomUUID())"
```

### Validation Tools

```bash
# Validate environment configuration
node scripts/validate-secrets.js development

# Check secret strength
node scripts/check-secret-strength.js .env.development

# Audit secret access
node scripts/audit-secrets.js
```

## 🔒 Security Best Practices

### General Guidelines

1. **Never commit secrets to version control**
   ```bash
   # Add to .gitignore
   environments/.env*
   !environments/.env.example
   environments/*.vault
   ```

2. **Use separate secrets per environment**
   ```bash
   # Development secrets ≠ Production secrets
   # Each environment has unique encryption keys
   ```

3. **Implement secret rotation**
   ```bash
   # Regular rotation schedule
   # Automated rotation preferred
   # Document rotation procedures
   ```

4. **Monitor secret access**
   ```bash
   # Log all secret access
   # Monitor for anomalies
   # Alert on unauthorized access
   ```

### Development Security

- **Use encrypted files for team sharing**
- **Rotate development secrets monthly**
- **Avoid real production data**
- **Use mock external services**

### Staging Security

- **Mirror production security settings**
- **Use real-like but separate credentials**
- **Enable comprehensive logging**
- **Test security configurations**

### Production Security

- **Use enterprise secrets management**
- **Implement strict access controls**
- **Enable audit logging**
- **Regular security reviews**
- **Incident response procedures**

## 🚨 Emergency Procedures

### Secret Compromise Response

1. **Immediate Actions**
   ```bash
   # 1. Revoke compromised secrets immediately
   # 2. Generate new secrets
   # 3. Update all affected systems
   # 4. Rotate related credentials
   ```

2. **Investigation**
   ```bash
   # 1. Identify scope of compromise
   # 2. Review audit logs
   # 3. Determine root cause
   # 4. Document findings
   ```

3. **Recovery**
   ```bash
   # 1. Implement additional security measures
   # 2. Update security procedures
   # 3. Notify stakeholders
   # 4. Conduct lessons learned review
   ```

### Secret Recovery

```bash
# Backup and recovery procedures
# Encrypted backup storage
# Disaster recovery testing
# Business continuity planning
```

## 🛠️ IDE Configuration (VS Code)

### Automatic Setup

VS Code configuration is included in the `.vscode/` folder for optimal development experience:

```
.vscode/
├── settings.json      # Editor settings and formatting
├── extensions.json    # Recommended extensions
├── launch.json       # Debug configurations
└── tasks.json        # Build and test tasks
```

### Recommended Extensions

The project automatically suggests these essential extensions:

#### Core Development
- **ESLint** - Code linting and quality
- **Prettier** - Code formatting
- **Jest** - Test runner integration
- **GitLens** - Advanced Git integration

#### Node.js & API Development
- **Node.js IntelliSense** - Enhanced Node.js support
- **REST Client** - API testing within VS Code
- **MongoDB for VS Code** - Database management
- **Thunder Client** - Alternative API testing

#### Documentation & Productivity
- **Markdown All in One** - Enhanced markdown support
- **TODO Highlight** - Task management
- **Auto Rename Tag** - HTML/JSX tag synchronization
- **Code Spell Checker** - Spelling verification

### Debug Configurations

Pre-configured debug setups available via `F5` or Debug panel:

#### Application Debugging
- **Launch AmexingWeb Server** - Debug main application
- **Launch AmexingWeb (Production Mode)** - Debug production build
- **Attach to Node Process** - Attach to running server

#### Testing & Development
- **Debug Current Test File** - Debug active test file
- **Debug All Tests** - Debug complete test suite
- **Debug Cloud Functions** - Debug Parse cloud code

#### Full Application
- **Launch Full Application** - Debug server

### Development Tasks

Quick access to common tasks via `Ctrl+Shift+P` → "Tasks: Run Task":

#### Build & Run
- **Start Development Server** - `yarn dev`
- **Start Production Server** - `yarn start`

#### Testing
- **Run Tests** - `yarn test`
- **Run Tests with Coverage** - `yarn test:coverage`
- **Run Unit Tests** - `yarn test:unit`
- **Run Integration Tests** - `yarn test:integration`
- **Watch Tests** - `yarn test:watch`

#### Code Quality
- **Run ESLint** - `yarn lint`
- **Fix ESLint Issues** - `yarn lint:fix`
- **Format Code** - `yarn format`
- **Security Audit** - `yarn security:all`
- **Full Quality Check** - `yarn quality:all`

#### Project Management
- **Generate Documentation** - `yarn docs`
- **Install Git Hooks** - `yarn hooks:install`
- **Generate Changelog** - `yarn changelog:generate`
- **Clean Dependencies** - Remove and reinstall packages

### IDE Settings Highlights

#### Editor Configuration
```json
{
  "editor.tabSize": 2,
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

#### Security & Privacy
```json
{
  "telemetry.enableTelemetry": false,
  "security.workspace.trust.untrustedFiles": "prompt"
}
```

#### Performance Optimization
- Excluded folders: `node_modules`, `coverage`, `logs`
- Optimized search and IntelliSense
- Memory-efficient file watching

### Getting Started with VS Code

1. **Install VS Code**: Download from [code.visualstudio.com](https://code.visualstudio.com)

2. **Open Project**: 
   ```bash
   code /path/to/AmexingWeb
   ```

3. **Install Recommended Extensions**: 
   - VS Code will prompt to install recommended extensions
   - Or manually: `Ctrl+Shift+X` → "Show Recommended Extensions"

4. **Start Developing**:
   - Press `F5` to launch with debugging
   - Use `Ctrl+Shift+P` for command palette
   - Access tasks via `Terminal` → `Run Task`

### Alternative IDEs

While VS Code is recommended, the project supports other editors:

- **IntelliJ IDEA / WebStorm** - Full Node.js support
- **Sublime Text** - Lightweight alternative
- **Atom** - GitHub's editor (deprecated but functional)
- **Vim/Neovim** - Terminal-based editing

For other IDEs, ensure:
- ESLint integration
- Prettier formatting
- Node.js debugging support
- Jest test runner integration

## 📚 Additional Resources

### Documentation Links

- [SECURITY.md](../SECURITY.md) - Security policies and procedures
- [CODE_QUALITY.md](../CODE_QUALITY.md) - Code quality and analysis tools
- [README.md](../README.md) - Project overview and quick start

### External Resources

- [OWASP Secrets Management](https://owasp.org/www-community/vulnerabilities/Sensitive_data_exposure)
- [NIST Cryptographic Standards](https://www.nist.gov/itl/cryptographic-standards)
- [PCI DSS Requirements](https://www.pcisecuritystandards.org/)

### Support

For environment setup support:
- Create an issue in the project repository
- Consult the security team for production setups
- Review audit logs for troubleshooting

---

**Last Updated**: January 2025  
**Next Review**: February 2025  
**Document Owner**: DevOps Team