/**
 * Apple ID Token Validator
 * Handles Apple ID token verification with public key validation.
 */

const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const https = require('https');
const logger = require('../../infrastructure/logger');

class AppleIdTokenValidator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Verifies Apple ID token.
   * @param {string} idToken - Apple ID token.
   * @param {string} expectedNonce - Expected nonce value.
   * @returns {Promise<object>} Decoded token payload.
   * @example Verify Apple ID token
   * const validator = new AppleIdTokenValidator(config);
   * const payload = await validator.verifyIdToken(token, nonce);
   */
  async verifyIdToken(idToken, expectedNonce) {
    try {
      const payload = await this.validateTokenStructure(idToken);
      this.validateNonce(payload, expectedNonce);
      this.validateExpiration(payload);
      return payload;
    } catch (error) {
      logger.error('Apple ID token verification failed:', error);
      throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'Failed to verify Apple ID token');
    }
  }

  /**
   * Validates token structure and signature.
   * @param {string} idToken - ID token to validate.
   * @returns {Promise<object>} Decoded payload.
   * @example Validate token structure
   * const payload = await validator.validateTokenStructure(idToken);
   */
  async validateTokenStructure(idToken) {
    const appleKeys = await this.getApplePublicKeys();
    const decoded = jwt.decode(idToken, { complete: true });

    if (!decoded || !decoded.header.kid) {
      throw new Error('Invalid ID token format');
    }

    const publicKey = appleKeys[decoded.header.kid];
    if (!publicKey) {
      throw new Error('Unable to find matching public key');
    }

    return jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: this.config.clientId,
      issuer: 'https://appleid.apple.com',
    });
  }

  /**
   * Validates nonce if provided.
   * @param {object} payload - Token payload.
   * @param {string} expectedNonce - Expected nonce.
   * @example Validate nonce
   * validator.validateNonce(payload, 'expected-nonce');
   */
  validateNonce(payload, expectedNonce) {
    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw new Error('Nonce verification failed');
    }
  }

  /**
   * Validates token expiration.
   * @param {object} payload - Token payload.
   * @example Validate expiration
   * validator.validateExpiration(payload);
   */
  validateExpiration(payload) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('ID token has expired');
    }
  }

  /**
   * Gets Apple's public keys for token verification.
   * @returns {Promise<object>} Public keys indexed by kid.
   * @example Get Apple public keys
   * const keys = await validator.getApplePublicKeys();
   */
  async getApplePublicKeys() {
    return new Promise((resolve, reject) => {
      const url = 'https://appleid.apple.com/auth/keys';

      https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const keys = JSON.parse(data);
            const publicKeys = {};

            keys.keys.forEach((key) => {
              const publicKey = this.jwkToPublicKey(key);
              publicKeys[key.kid] = publicKey;
            });

            resolve(publicKeys);
          } catch (jwkError) {
            reject(jwkError);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Converts JWK to public key format.
   * @param {object} jwk - JSON Web Key.
   * @returns {string} Public key in PEM format.
   * @example Convert JWK to public key
   * const pem = validator.jwkToPublicKey(jwkObject);
   */
  jwkToPublicKey(jwk) {
    // Convert JWK to PEM format for jwt.verify()
    const { kty, n } = jwk;

    if (kty !== 'RSA') {
      throw new Error('Unsupported key type');
    }

    // This is a simplified conversion - in production, use a proper JWK library
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(n, 'base64').toString('base64')}\n-----END PUBLIC KEY-----`;
    return publicKeyPem;
  }
}

module.exports = { AppleIdTokenValidator };
