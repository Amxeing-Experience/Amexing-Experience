#!/usr/bin/env node

/**
 * Automated Secret Generation Script.
 * Generates secure values for environment variables across different environments.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SecureSecretsManager } = require('../../../src/infrastructure/secrets/secretsManager');

/**
 * Environment-specific secret generation configuration.
 */
const SECRET_CONFIG = {
  // Encryption and signing keys
  ENCRYPTION_KEY: { length: 32, encoding: 'base64', description: 'AES-256 encryption key' },
  SESSION_SECRET: { length: 64, encoding: 'base64', description: 'Session signing secret' },
  JWT_SECRET: { length: 64, encoding: 'base64', description: 'JWT signing secret' },
  
  // Parse Server secrets
  PARSE_MASTER_KEY: { length: 48, encoding: 'base64', description: 'Parse Server master key' },
  PARSE_APP_ID: { length: 16, charset: 'alphanumeric', description: 'Parse application ID' },
  
  // Database and authentication
  DATABASE_PASSWORD: { length: 32, charset: 'alphanumeric', description: 'Database password' },
  PARSE_DASHBOARD_PASS: { length: 24, charset: 'alphanumeric', description: 'Parse Dashboard password' },
  
  // External service keys (placeholders for production)
  EMAIL_PASS: { placeholder: 'app-specific-password', description: 'Email service password' },
};

/**
 * Environment-specific configurations.
 */
const ENVIRONMENT_CONFIGS = {
  development: {
    generateSecrets: true,
    usePlaceholders: false,
    securityLevel: 'standard',
    description: 'Local development environment',
  },
  staging: {
    generateSecrets: true,
    usePlaceholders: true,
    securityLevel: 'high',
    description: 'Staging environment (production-like)',
  },
  production: {
    generateSecrets: false, // Manual generation required
    usePlaceholders: true,
    securityLevel: 'maximum',
    description: 'Production environment (manual setup required)',
  },
};

/**
 * Generates a secure secret based on configuration.
 * @param {object} config - Secret configuration.
 * @returns {string} Generated secret.
 */
function generateSecret(config) {
  const manager = new SecureSecretsManager();
  
  if (config.placeholder) {
    return config.placeholder;
  }
  
  return manager.generateSecret(config.length, {
    encoding: config.encoding || 'base64',
    charset: config.charset || 'random',
  });
}

/**
 * Generates environment variables for a specific environment.
 * @param {string} environment - Target environment (development, staging, production).
 * @returns {object} Generated environment variables.
 */
function generateEnvironmentSecrets(environment) {
  const envConfig = ENVIRONMENT_CONFIGS[environment];
  
  if (!envConfig) {
    throw new Error(`Unknown environment: ${environment}`);
  }
  
  console.log(`\n🔐 Generating secrets for ${environment} environment`);
  console.log(`📋 Description: ${envConfig.description}`);
  console.log(`🛡️  Security Level: ${envConfig.securityLevel}`);
  
  const secrets = {};
  
  Object.entries(SECRET_CONFIG).forEach(([key, config]) => {
    if (envConfig.generateSecrets || !config.placeholder) {
      const value = generateSecret(config);
      secrets[key] = value;
      
      const displayValue = config.placeholder || value.substring(0, 8) + '...';
      console.log(`✅ ${key}: ${displayValue} (${config.description})`);
    } else {
      secrets[key] = config.placeholder;
      console.log(`⚠️  ${key}: ${config.placeholder} (${config.description}) - MANUAL SETUP REQUIRED`);
    }
  });
  
  // Add environment-specific values
  secrets.NODE_ENV = environment;
  secrets.PCI_ENVIRONMENT = environment;
  
  // Adjust security settings based on environment
  if (environment === 'production') {
    secrets.LOG_LEVEL = 'warn';
    secrets.ENABLE_AUDIT_LOGGING = 'true';
    secrets.SESSION_TIMEOUT_MINUTES = '15';
    secrets.BCRYPT_ROUNDS = '14';
  } else if (environment === 'staging') {
    secrets.LOG_LEVEL = 'info';
    secrets.ENABLE_AUDIT_LOGGING = 'true';
    secrets.SESSION_TIMEOUT_MINUTES = '30';
    secrets.BCRYPT_ROUNDS = '12';
  } else {
    secrets.LOG_LEVEL = 'debug';
    secrets.ENABLE_AUDIT_LOGGING = 'false';
    secrets.SESSION_TIMEOUT_MINUTES = '60';
    secrets.BCRYPT_ROUNDS = '10';
  }
  
  return secrets;
}

/**
 * Creates environment file with generated secrets.
 * @param {object} secrets - Generated secrets.
 * @param {string} environment - Target environment.
 * @param {boolean} encrypt - Whether to encrypt the file.
 */
function createEnvironmentFile(secrets, environment, encrypt = false) {
  const fileName = encrypt ? `.env.${environment}.vault` : `.env.${environment}`;
  const filePath = path.join(process.cwd(), 'environments', fileName);
  
  console.log(`\n📄 Creating environment file: ${fileName}`);
  
  if (encrypt) {
    // Use encrypted format
    const manager = new SecureSecretsManager();
    const encryptionKey = secrets.ENCRYPTION_KEY;
    
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY is required for encrypted files');
    }
    
    manager.initialize(encryptionKey);
    manager.saveEncryptedEnv(secrets, filePath);
    console.log(`🔒 Encrypted environment file created: ${fileName}`);
  } else {
    // Create standard .env file
    const lines = [
      `# Environment Configuration for ${environment.toUpperCase()}`,
      `# Generated: ${new Date().toISOString()}`,
      `# Security Level: ${ENVIRONMENT_CONFIGS[environment].securityLevel}`,
      '',
      '# ⚠️  SECURITY WARNING:',
      '# This file contains sensitive information. Do not commit to version control.',
      '# Consider using encrypted environments/.env.vault files for production.',
      '',
    ];
    
    // Group related variables
    const groups = {
      'Parse Server Configuration': [
        'PARSE_APP_ID', 'PARSE_MASTER_KEY', 'PARSE_SERVER_URL', 'PARSE_PUBLIC_SERVER_URL',
        'PARSE_DASHBOARD_USER', 'PARSE_DASHBOARD_PASS'
      ],
      'Database Configuration': [
        'DATABASE_URI', 'DATABASE_NAME'
      ],
      'Server Configuration': [
        'NODE_ENV', 'PORT', 'DASHBOARD_PORT', 'HOST'
      ],
      'Security Configuration': [
        'SESSION_SECRET', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN',
        'ENCRYPTION_KEY', 'BCRYPT_ROUNDS'
      ],
      'External Services': [
        'EMAIL_FROM', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS'
      ],
      'PCI DSS Compliance': [
        'PCI_ENVIRONMENT', 'ENABLE_PCI_COMPLIANCE', 'SESSION_TIMEOUT_MINUTES',
        'MAX_LOGIN_ATTEMPTS', 'ACCOUNT_LOCKOUT_DURATION_MINUTES'
      ]
    };
    
    Object.entries(groups).forEach(([groupName, keys]) => {
      lines.push(`# ${groupName}`);
      keys.forEach((key) => {
        if (secrets[key] !== undefined) {
          lines.push(`${key}=${secrets[key]}`);
        } else {
          // Add default values for missing keys
          const defaultValues = {
            PARSE_SERVER_URL: 'http://localhost:1337/parse',
            PARSE_PUBLIC_SERVER_URL: 'http://localhost:1337/parse',
            PARSE_DASHBOARD_USER: 'admin',
            DATABASE_URI: 'mongodb://localhost:27017/amexingdb',
            DATABASE_NAME: 'amexingdb',
            PORT: '1337',
            DASHBOARD_PORT: '4040',
            HOST: 'localhost',
            JWT_EXPIRES_IN: '15m',
            JWT_REFRESH_EXPIRES_IN: '7d',
            EMAIL_FROM: 'alejandro@meeplab.com',
            EMAIL_HOST: 'smtp.gmail.com',
            EMAIL_PORT: '587',
            EMAIL_USER: 'alejandro@meeplab.com',
            ENABLE_PCI_COMPLIANCE: 'true',
            MAX_LOGIN_ATTEMPTS: '6',
            ACCOUNT_LOCKOUT_DURATION_MINUTES: '30',
          };
          
          if (defaultValues[key]) {
            lines.push(`${key}=${defaultValues[key]}`);
          }
        }
      });
      lines.push('');
    });
    
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`📄 Environment file created: ${fileName}`);
  }
  
  // Set restrictive permissions
  try {
    fs.chmodSync(filePath, 0o600);
    console.log(`🔒 File permissions set to 600 (owner read/write only)`);
  } catch (error) {
    console.warn(`⚠️  Could not set file permissions: ${error.message}`);
  }
}

/**
 * Displays security recommendations for the environment.
 * @param {string} environment - Target environment.
 */
function displaySecurityRecommendations(environment) {
  console.log(`\n🛡️  Security Recommendations for ${environment}:`);
  
  const recommendations = {
    development: [
      '• Use generated secrets for local development',
      '• Do not commit environments/.env files to version control',
      '• Regularly rotate development secrets',
      '• Use encrypted environments/.env.vault files for team sharing',
    ],
    staging: [
      '• Use production-like security settings',
      '• Encrypt environment files with dotenv-vault',
      '• Implement proper access controls',
      '• Monitor secret access and rotation',
      '• Test security configurations thoroughly',
    ],
    production: [
      '• NEVER use auto-generated secrets in production',
      '• Use enterprise secrets management (HashiCorp Vault, AWS Secrets Manager)',
      '• Implement secret rotation policies',
      '• Enable comprehensive audit logging',
      '• Use separate encryption keys per environment',
      '• Regularly review and update security policies',
    ],
  };
  
  recommendations[environment].forEach((rec) => console.log(rec));
}

/**
 * Main execution function.
 */
function main() {
  const args = process.argv.slice(2);
  const environment = args[0] || 'development';
  const encrypt = args.includes('--encrypt');
  const help = args.includes('--help') || args.includes('-h');
  
  if (help) {
    console.log(`
🔐 AmexingWeb Secret Generation Tool

Usage: node scripts/generate-secrets.js [environment] [options]

Environments:
  development  Generate secrets for local development (default)
  staging      Generate secrets for staging environment
  production   Show production setup requirements (no auto-generation)

Options:
  --encrypt    Create encrypted .env.vault file
  --help, -h   Show this help message

Examples:
  node scripts/generate-secrets.js development
  node scripts/generate-secrets.js staging --encrypt
  node scripts/generate-secrets.js production

Security Notes:
  • Development: Auto-generated secrets for local use
  • Staging: Production-like secrets with placeholders for external services
  • Production: Manual setup required, no auto-generation for security
    `);
    return;
  }
  
  if (!ENVIRONMENT_CONFIGS[environment]) {
    console.error(`❌ Unknown environment: ${environment}`);
    console.error('Valid environments: development, staging, production');
    process.exit(1);
  }
  
  try {
    console.log('🚀 AmexingWeb Secret Generation Tool');
    console.log('==================================');
    
    const secrets = generateEnvironmentSecrets(environment);
    
    if (environment === 'production') {
      console.log('\n⚠️  PRODUCTION ENVIRONMENT DETECTED');
      console.log('🔒 For security reasons, production secrets must be set up manually.');
      console.log('📋 Use the generated template as a reference.');
    }
    
    createEnvironmentFile(secrets, environment, encrypt);
    displaySecurityRecommendations(environment);
    
    console.log('\n✅ Secret generation completed successfully!');
    console.log(`📄 Next steps: Review the generated environments/.env.${environment} file`);
    
    if (encrypt) {
      console.log('🔑 Remember to securely store your encryption key');
    }
    
  } catch (error) {
    console.error(`❌ Error generating secrets: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  generateEnvironmentSecrets,
  createEnvironmentFile,
  SECRET_CONFIG,
  ENVIRONMENT_CONFIGS,
};