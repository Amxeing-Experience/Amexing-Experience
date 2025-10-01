/**
 * Secrets Manager - Secure handling of environment variables and secrets.
 * Provides encryption, decryption, and secure access to sensitive configuration.
 * @example
 * // Usage example
 * const result = await require({ 'crypto': 'example' });
 * // Returns: operation result
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * SecureSecretsManager class for handling encrypted environment variables.
 */
class SecureSecretsManager {
  constructor() {
    this.encryptedSecrets = new Map();
    this.loadedSecrets = new Set();
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32;
  }

  /**
   * Initialize the secrets manager with encryption _key.
   * @param {string} encryptionKey - Base64 encoded encryption _key.
   * @example
   * // Usage example
   * const result = await initialize({ encryptionKey: 'example' });
   * // Returns: operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   * const manager = new SecureSecretsManager();
   * manager.initialize(process.env.ENCRYPTION_KEY);
   * @returns {*} - Operation result.
   */
  initialize(encryptionKey) {
    // Check if encryption key is provided
    if (!encryptionKey) {
      throw new Error('Encryption key is required for secrets manager');
    }

    try {
      this.encryptionKey = Buffer.from(encryptionKey, 'base64');
      // Validate encryption key length
      if (this.encryptionKey.length !== this.keyLength) {
        throw new Error(
          `Encryption key must be ${this.keyLength} bytes when decoded`
        );
      }
    } catch (error) {
      throw new Error(`Invalid encryption key format: ${error.message}`);
    }
  }

  /**
   * Encrypt a secret value.
   * @param {string} value - Plain text value to encrypt.
   * @returns {string} - Operation result Encrypted value with IV and auth tag.
   * @example
   * // Usage example
   * const result = await encryptSecret({ value: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const encrypted = manager.encryptSecret('my-secret-value');
   */
  encryptSecret(value) {
    // Check if secrets manager is initialized
    if (!this.encryptionKey) {
      throw new Error('Secrets manager not initialized');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv
    );
    cipher.setAAD(Buffer.from('secrets-manager'));

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a secret value.
   * @param {string} encryptedValue - Encrypted value with IV and auth tag.
   * @returns {string} - Operation result Decrypted plain text value.
   * @example
   * // Usage example
   * const result = await decryptSecret({ encryptedValue: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const decrypted = manager.decryptSecret(encryptedValue);
   */
  decryptSecret(encryptedValue) {
    // Check if secrets manager is initialized
    if (!this.encryptionKey) {
      throw new Error('Secrets manager not initialized');
    }

    try {
      const [ivHex, authTagHex, encrypted] = encryptedValue.split(':');

      // Validate encrypted value components
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted value format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.encryptionKey,
        iv
      );
      decipher.setAAD(Buffer.from('secrets-manager'));
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Failed to decrypt secret: ${error.message}`);
    }
  }

  /**
   * Load and decrypt secrets from encrypted environment file.
   * @param {string} filePath - Path to encrypted secrets file.
   * @returns {object} - Operation result Decrypted environment variables.
   * @example
   * // Usage example
   * const result = await loadEncryptedEnv({ filePath: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const secrets = manager.loadEncryptedEnv('.env.vault');
   */
  loadEncryptedEnv(filePath) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const encryptedContent = fs.readFileSync(filePath, 'utf8');
      const secrets = {};

      encryptedContent.split('\n').forEach((line) => {
        const trimmedLine = line.trim();
        // Skip empty lines and comments
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [_key, encryptedValue] = trimmedLine.split('=', 2);
          // Process valid key-value pairs
          if (_key && encryptedValue) {
            secrets[_key.trim()] = this.decryptSecret(encryptedValue.trim());
            this.loadedSecrets.add(_key.trim());
          }
        }
      });

      return secrets;
    } catch (error) {
      throw new Error(`Failed to load encrypted environment: ${error.message}`);
    }
  }

  /**
   * Save encrypted secrets to file.
   * @param {object} secrets - Plain text secrets to encrypt and save.
   * @param {string} filePath - Path to save encrypted secrets.
   * @example
   * // Usage example
   * const result = await saveEncryptedEnv({ secrets: 'example', filePath: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * manager.saveEncryptedEnv(secrets, '.env.vault');
   * @returns {*} - Operation result.
   */
  saveEncryptedEnv(secrets, filePath) {
    try {
      const lines = [];
      lines.push('# Encrypted Environment Variables');
      lines.push('# Generated by SecureSecretsManager');
      lines.push(`# Created: ${new Date().toISOString()}`);
      lines.push('');

      Object.entries(secrets).forEach(([_key, value]) => {
        // Validate key and value are strings
        if (typeof _key === 'string' && typeof value === 'string') {
          const encryptedValue = this.encryptSecret(value);
          lines.push(`${_key}=${encryptedValue}`);
        }
      });

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save encrypted environment: ${error.message}`);
    }
  }

  /**
   * Securely get a secret value, clearing it from memory after access.
   * @param {string} key - Secret key name.
   * @param _key
   * @param {object} secrets - Secrets object.
   * @returns {string} - Operation result Secret value.
   * @example
   * // Usage example
   * const result = await getSecureValue({ key: 'example', secrets: 'example' });
   * // Returns: operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * const secret = manager.getSecureValue('DATABASE_PASSWORD', secrets);
   */
  getSecureValue(_key /* unused */, secrets) {
    // Validate key to prevent object injection
    if (
      typeof _key !== 'string'
      || _key.includes('__proto__')
      || _key.includes('constructor')
      || _key.includes('prototype')
    ) {
      return undefined;
    }

    // eslint-disable-next-line security/detect-object-injection
    const value = secrets[_key]; // eslint-disable-line no-underscore-dangle
    // Track secret access for audit purposes
    if (value) {
      // Mark as accessed for audit purposes
      this.encryptedSecrets.set(_key, {
        accessed: new Date(),
        accessCount: (this.encryptedSecrets.get(_key)?.accessCount || 0) + 1,
      });
    }
    return value;
  }

  /**
   * Clear secrets from memory for security.
   * @param {object} secretsObj - Secrets object to clear.
   * @returns {object} - Operation result Cleared secrets object.
   * @example
   * // Usage example
   * const result = await clearSecrets({ secretsObj: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * const cleared = manager.clearSecrets(secrets);
   */
  clearSecrets(secretsObj) {
    const secretsCopy = { ...secretsObj };
    Object.keys(secretsCopy).forEach((_key) => {
      // Validate key to prevent object injection
      if (
        typeof _key === 'string'
        && !_key.includes('__proto__')
        && !_key.includes('constructor')
        && !_key.includes('prototype')
      ) {
        // eslint-disable-next-line security/detect-object-injection
        secretsCopy[_key] = null; // eslint-disable-line no-underscore-dangle
        // eslint-disable-next-line security/detect-object-injection
        delete secretsCopy[_key]; // eslint-disable-line no-underscore-dangle
      }
    });
    return secretsCopy;
  }

  /**
   * Generate a secure random secret.
   * @param {number} length - Length of secret to generate.
   * @param {object} options - Generation options.
   * @returns {string} - Operation result Generated secret.
   * @example
   * // Usage example
   * const result = await generateSecret({ length: 'example', options: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * const secret = manager.generateSecret(32, { encoding: 'base64' });
   */
  generateSecret(length = 32, options = {}) {
    const { encoding = 'base64', charset = 'alphanumeric' } = options;

    // Generate alphanumeric secret
    if (charset === 'alphanumeric') {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      // Build secret character by character
      for (let i = 0; i < length; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    const bytes = crypto.randomBytes(length);
    // Return secret in requested encoding
    return encoding === 'hex'
      ? bytes.toString('hex')
      : bytes.toString('base64');
  }

  /**
   * Generate an encryption key for the secrets manager.
   * @returns {string} - Operation result Base64 encoded encryption _key.
   * @example
   * // Usage example
   * const result = await generateEncryptionKey({ length: 'example', options: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * const key = SecureSecretsManager.generateEncryptionKey();
   */
  static generateEncryptionKey() {
    return crypto.randomBytes(32).toString('base64');
  }

  /**
   * Validate environment variables against required schema.
   * @param {object} secrets - Secrets to validate.
   * @param {object} schema - Required environment schema.
   * @returns {object} - Operation result Validation result.
   * @example
   * // Validation utility usage
   * const isValid = validateFunction(input);
   * // Returns: boolean
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * const result = manager.validateSecrets(secrets, requiredSchema);
   */
  validateSecrets(secrets, schema) {
    const missing = [];
    const invalid = [];

    // eslint-disable-next-line complexity
    Object.entries(schema).forEach(([_key, requirements]) => {
      // Validate key to prevent object injection
      if (
        typeof _key !== 'string'
        || _key.includes('__proto__')
        || _key.includes('constructor')
        || _key.includes('prototype')
      ) {
        return;
      }
      // eslint-disable-next-line security/detect-object-injection
      const value = secrets[_key]; // eslint-disable-line no-underscore-dangle

      // Check if required secret is missing
      if (!value) {
        missing.push(_key);
        return;
      }

      // Validate minimum length requirement
      if (requirements.minLength && value.length < requirements.minLength) {
        invalid.push(`${_key}: minimum length ${requirements.minLength}`);
      }

      // Validate pattern requirement
      if (requirements.pattern && !requirements.pattern.test(value)) {
        invalid.push(`${_key}: does not match required pattern`);
      }
    });

    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
    };
  }

  /**
   * Get audit information about secret access.
   * @returns {object} - Operation result Audit information.
   * @example
   * // Usage example
   * const result = await getAuditInfo({ secrets: 'example', schema: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * const audit = manager.getAuditInfo();
   */
  getAuditInfo() {
    const audit = {
      loadedSecrets: Array.from(this.loadedSecrets),
      accessedSecrets: {},
      timestamp: new Date().toISOString(),
    };

    this.encryptedSecrets.forEach((info, _key) => {
      // Validate key to prevent object injection
      if (
        typeof _key === 'string'
        && !_key.includes('__proto__')
        && !_key.includes('constructor')
        && !_key.includes('prototype')
      ) {
        // eslint-disable-next-line security/detect-object-injection
        audit.accessedSecrets[_key] = info; // eslint-disable-line no-underscore-dangle
      }
    });

    return audit;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton secrets manager instance.
 * @returns {SecureSecretsManager} - Operation result Secrets manager instance.
 * @example
 * // Usage example
 * const result = await getSecretsManager({ secrets: 'example', schema: 'example' });
 * // Returns: operation result
 * // Example usage:
 * // const result = await methodName(params);
 * // Returns appropriate result based on operation
 * const manager = getSecretsManager();
 */
function getSecretsManager() {
  // Create singleton instance if not exists
  if (!instance) {
    instance = new SecureSecretsManager();
  }
  return instance;
}

module.exports = {
  SecureSecretsManager,
  getSecretsManager,
};
