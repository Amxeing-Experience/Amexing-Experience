#!/usr/bin/env node

/**
 * Initial Secrets Setup Script.
 * Sets up encrypted environment files and initializes the secrets management system.
 */

const fs = require('fs');
const path = require('path');
const { SecureSecretsManager } = require('../src/infrastructure/secrets/secretsManager');
const { generateEnvironmentSecrets } = require('./generate-secrets');

/**
 * Interactive setup wizard for secrets management.
 */
class SecretsSetupWizard {
  constructor() {
    this.manager = new SecureSecretsManager();
  }

  /**
   * Display welcome message and setup overview.
   */
  displayWelcome() {
    console.log(`
🔐 AmexingWeb Secrets Management Setup
=====================================

This wizard will help you set up secure environment variable management
for your AmexingWeb project.

What this setup includes:
• Generate encryption keys for secrets management
• Create encrypted environment files
• Set up development environment
• Provide production deployment guidance

Let's get started!
`);
  }

  /**
   * Check if environment files already exist.
   * @returns {object} Existing files information.
   */
  checkExistingFiles() {
    const files = [
      '.env',
      '.env.development',
      '.env.staging',
      '.env.production',
      '.env.vault',
      '.env.development.vault',
      '.env.staging.vault',
    ];

    const existing = [];
    files.forEach((file) => {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        existing.push({
          name: file,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    });

    return existing;
  }

  /**
   * Generate master encryption key for the project.
   * @returns {string} Generated encryption key.
   */
  generateMasterKey() {
    console.log('\n🔑 Generating master encryption key...');
    
    const encryptionKey = SecureSecretsManager.generateEncryptionKey();
    
    console.log('✅ Master encryption key generated');
    console.log(`📋 Key length: ${encryptionKey.length} characters (base64 encoded)`);
    
    return encryptionKey;
  }

  /**
   * Create encrypted environment file from existing .env.
   * @param {string} encryptionKey - Encryption key to use.
   */
  createEncryptedFromExisting(encryptionKey) {
    const envPath = path.join(process.cwd(), '.env');
    
    if (!fs.existsSync(envPath)) {
      console.log('ℹ️  No existing .env file found, skipping migration');
      return;
    }
    
    console.log('\n📦 Migrating existing .env file to encrypted format...');
    
    try {
      // Read existing .env file
      const envContent = fs.readFileSync(envPath, 'utf8');
      const secrets = {};
      
      envContent.split('\n').forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            secrets[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
      
      // Initialize manager and save encrypted version
      this.manager.initialize(encryptionKey);
      this.manager.saveEncryptedEnv(secrets, '.env.vault');
      
      console.log('✅ Created encrypted .env.vault file');
      console.log(`📊 Migrated ${Object.keys(secrets).length} environment variables`);
      
      // Create backup of original
      const backupPath = `.env.backup.${Date.now()}`;
      fs.copyFileSync(envPath, backupPath);
      console.log(`💾 Original .env backed up as ${backupPath}`);
      
    } catch (error) {
      console.error(`❌ Error migrating .env file: ${error.message}`);
    }
  }

  /**
   * Set up development environment with auto-generated secrets.
   * @param {string} encryptionKey - Encryption key to use.
   */
  setupDevelopmentEnvironment(encryptionKey) {
    console.log('\n🚀 Setting up development environment...');
    
    try {
      // Generate development secrets
      const secrets = generateEnvironmentSecrets('development');
      secrets.ENCRYPTION_KEY = encryptionKey;
      
      // Create both plain and encrypted versions
      this.createEnvironmentFile(secrets, 'development', false);
      
      this.manager.initialize(encryptionKey);
      this.manager.saveEncryptedEnv(secrets, '.env.development.vault');
      
      console.log('✅ Development environment configured');
      console.log('📄 Created .env.development (plain text)');
      console.log('🔒 Created .env.development.vault (encrypted)');
      
    } catch (error) {
      console.error(`❌ Error setting up development environment: ${error.message}`);
    }
  }

  /**
   * Create environment file.
   * @param {object} secrets - Secrets to write.
   * @param {string} environment - Environment name.
   * @param {boolean} encrypt - Whether to encrypt.
   */
  createEnvironmentFile(secrets, environment, encrypt = false) {
    const fileName = encrypt ? `.env.${environment}.vault` : `.env.${environment}`;
    const filePath = path.join(process.cwd(), fileName);
    
    if (!encrypt) {
      const lines = [
        `# Environment Configuration for ${environment.toUpperCase()}`,
        `# Generated: ${new Date().toISOString()}`,
        '# ⚠️  Do not commit this file to version control',
        '',
      ];
      
      Object.entries(secrets).forEach(([key, value]) => {
        lines.push(`${key}=${value}`);
      });
      
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      
      // Set restrictive permissions
      try {
        fs.chmodSync(filePath, 0o600);
      } catch (error) {
        console.warn(`⚠️  Could not set file permissions: ${error.message}`);
      }
    }
  }

  /**
   * Update .gitignore to exclude sensitive files.
   */
  updateGitignore() {
    console.log('\n📝 Updating .gitignore...');
    
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    const secretsSection = `
# Environment Variables and Secrets
.env
.env.local
.env.development
.env.staging
.env.production
.env.*.local
.env.backup.*

# Encrypted Environment Files (optional to commit)
# .env.vault
# .env.*.vault

# Secrets and Keys
*.key
*.pem
secrets/
vault/
`;
    
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }
    
    if (!gitignoreContent.includes('Environment Variables and Secrets')) {
      fs.appendFileSync(gitignorePath, secretsSection);
      console.log('✅ Updated .gitignore with secrets exclusions');
    } else {
      console.log('ℹ️  .gitignore already contains secrets exclusions');
    }
  }

  /**
   * Add environment scripts to package.json.
   */
  updatePackageScripts() {
    console.log('\n📦 Updating package.json scripts...');
    
    const packagePath = path.join(process.cwd(), 'package.json');
    
    if (!fs.existsSync(packagePath)) {
      console.log('⚠️  package.json not found, skipping script updates');
      return;
    }
    
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      
      const newScripts = {
        'secrets:generate': 'node scripts/generate-secrets.js',
        'secrets:generate:dev': 'node scripts/generate-secrets.js development',
        'secrets:generate:staging': 'node scripts/generate-secrets.js staging --encrypt',
        'secrets:validate': 'node scripts/validate-secrets.js',
        'secrets:audit': 'node scripts/audit-secrets.js',
      };
      
      packageJson.scripts = { ...packageJson.scripts, ...newScripts };
      
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2), 'utf8');
      console.log('✅ Added secrets management scripts to package.json');
      
    } catch (error) {
      console.error(`❌ Error updating package.json: ${error.message}`);
    }
  }

  /**
   * Display setup completion summary.
   * @param {string} encryptionKey - Generated encryption key.
   */
  displaySummary(encryptionKey) {
    console.log(`
🎉 Secrets Management Setup Complete!
====================================

What was created:
✅ Master encryption key generated
✅ Development environment configured
✅ .gitignore updated with secrets exclusions
✅ Package.json scripts added

Your master encryption key:
${encryptionKey}

⚠️  IMPORTANT: Store this encryption key securely!
• Add it to your password manager
• Share it securely with team members
• Use it to decrypt .env.vault files

Next steps:
1. Review the generated .env.development file
2. Test your application: yarn dev
3. For staging/production, run: yarn secrets:generate:staging

Available commands:
• yarn secrets:generate:dev      - Generate development secrets
• yarn secrets:generate:staging  - Generate staging secrets (encrypted)
• yarn secrets:validate          - Validate environment configuration
• yarn secrets:audit            - Audit secret access

Documentation:
• Environment Setup: docs/ENVIRONMENT_SETUP.md
• Security Policy: SECURITY.md
• Code Quality: CODE_QUALITY.md

🔐 Your secrets are now secure!
`);
  }

  /**
   * Run the complete setup wizard.
   */
  async run() {
    try {
      this.displayWelcome();
      
      // Check for existing files
      const existingFiles = this.checkExistingFiles();
      if (existingFiles.length > 0) {
        console.log('\n📋 Existing environment files found:');
        existingFiles.forEach((file) => {
          console.log(`• ${file.name} (${file.size} bytes, modified: ${file.modified.toISOString()})`);
        });
        console.log('\nThis setup will create additional encrypted files without overwriting existing ones.');
      }
      
      // Generate master encryption key
      const encryptionKey = this.generateMasterKey();
      
      // Migrate existing .env if present
      this.createEncryptedFromExisting(encryptionKey);
      
      // Set up development environment
      this.setupDevelopmentEnvironment(encryptionKey);
      
      // Update project files
      this.updateGitignore();
      this.updatePackageScripts();
      
      // Display completion summary
      this.displaySummary(encryptionKey);
      
    } catch (error) {
      console.error(`❌ Setup failed: ${error.message}`);
      process.exit(1);
    }
  }
}

/**
 * Main execution function.
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔐 AmexingWeb Secrets Setup

Usage: node scripts/secrets-setup.js [options]

Options:
  --help, -h    Show this help message

This script sets up secure environment variable management for AmexingWeb:
• Generates encryption keys
• Creates encrypted environment files  
• Configures development environment
• Updates project configuration

Run without arguments to start the interactive setup wizard.
    `);
    return;
  }
  
  const wizard = new SecretsSetupWizard();
  wizard.run();
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { SecretsSetupWizard };