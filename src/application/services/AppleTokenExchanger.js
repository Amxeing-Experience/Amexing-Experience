/**
 * Apple Token Exchanger
 * Handles exchanging authorization codes for access tokens.
 * @example
 * // Service method usage
 * const result = await appletokenexchanger.require({ 'https': 'example' });
 * // Returns: { success: true, data: {...} }
 */

const https = require('https');
const jwt = require('jsonwebtoken');

/**
 * Apple Token Exchanger - Handles Apple OAuth token exchange operations.
 * Manages the secure exchange of authorization codes for access tokens and
 * generates the required client secrets for Apple's OAuth flow.
 *
 * This class implements Apple's specific requirements for token exchange,
 * including the generation of JWT-based client secrets using ES256 algorithm
 * and the proper handling of authorization code to token conversion.
 *
 * Features:
 * - JWT client secret generation using ES256 algorithm
 * - Secure authorization code to token exchange
 * - Automatic token expiration handling
 * - Apple-specific OAuth flow compliance
 * - Error handling and validation
 * - Private key based authentication.
 * @class AppleTokenExchanger
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Initialize token exchanger with Apple config and private key
 * const config = {
 *   teamId: 'APPLE_TEAM_ID',
 *   clientId: 'com.company.app',
 *   keyId: 'KEY_ID_FROM_APPLE'
 * };
 * const privateKey = fs.readFileSync('apple_private_key.p8', 'utf8');
 * const exchanger = new AppleTokenExchanger(config, privateKey);
 *
 * // Generate client secret for token exchange
 * const clientSecret = exchanger.generateClientSecret();
 *
 * // Exchange authorization code for tokens
 * const tokens = await exchanger.exchangeCodeForTokens(authorizationCode);
 * console.log('Access token:', tokens.accesstoken);
 * console.log('Refresh token:', tokens.refreshtoken);
 */
class AppleTokenExchanger {
  constructor(config, privateKey) {
    this.config = config;
    this.privateKey = privateKey;
  }

  /**
   * Generates client secret for Apple OAuth.
   * @returns {string} - Operation result Signed JWT client secret.
   * @example
   * // Service method usage
   * const result = await appletokenexchanger.generateClientSecret({ 'https': 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const exchanger = new AppleTokenExchanger(config, privateKey);
   * const clientSecret = exchanger.generateClientSecret();
   */
  generateClientSecret() {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.config.teamId,
      iat: now,
      exp: now + 3600, // 1 hour expiration
      aud: 'https://appleid.apple.com',
      sub: this.config.clientId,
    };

    const headers = {
      kid: this.config.keyId,
      alg: 'ES256',
    };

    return jwt.sign(payload, this.privateKey, {
      algorithm: 'ES256',
      header: headers,
    });
  }

  /**
   * Exchanges authorization code for tokens.
   * @param {string} authorizationCode - Authorization code from Apple.
   * @returns {Promise<object>} - Token data.
   * @example
   * // Service method usage
   * const result = await appletokenexchanger.exchangeCodeForTokens({ authorizationCode: 'example' });
   * // Returns: { success: true, data: {...} }
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * const exchanger = new AppleTokenExchanger(config, privateKey);
   * const tokens = await exchanger.exchangeCodeForTokens('authorization_code_here');
   */
  async exchangeCodeForTokens(authorizationCode) {
    const clientSecret = this.generateClientSecret();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });

    return new Promise((resolve, reject) => {
      const data = params.toString();

      const options = {
        hostname: 'appleid.apple.com',
        port: 443,
        path: '/auth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (response) => {
        let responseData = '';

        response.on('data', (chunk) => {
          responseData += chunk;
        });

        response.on('end', () => {
          try {
            const result = JSON.parse(responseData);

            /**
             * Handles Apple token exchange response with comprehensive error checking.
             * Validates HTTP status codes and Apple API error responses to ensure
             * successful token exchange or proper error propagation.
             * @param {*} response.statusCode ! - response.statusCode ! Parameter.
             * @returns {*} - Operation result.
             * @example
             * // Service method usage
             * const result = await appletokenexchanger.if({ response.statusCode: 'example' });
             * // Returns: { success: true, data: {...} }
             */
            if (response.statusCode !== 200) {
              reject(new Error(`Token exchange failed: ${result.error_description || result.error}`));
            } else {
              resolve(result);
            }
          } catch (exchangeError) {
            reject(exchangeError);
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = { AppleTokenExchanger };
