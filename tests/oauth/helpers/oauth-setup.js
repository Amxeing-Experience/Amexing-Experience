/**
 * OAuth Test Setup Helper
 * Provides utilities for setting up OAuth tests
 */

class OAuthTestSetup {
  constructor() {
    this.providers = ['apple', 'corporate'];
    this.testConfig = {
      apple: {
        clientId: 'test-apple-client-id',
        teamId: 'test-team-id',
        keyId: 'test-key-id',
        privateKey: 'test-private-key'
      },
      corporate: {
        clientId: 'test-corporate-client-id',
        clientSecret: 'test-corporate-secret',
        redirectUri: 'http://localhost:1339/auth/corporate/callback'
      }
    };
  }

  async setupOAuthProviders() {
    // Mock setup for OAuth providers
    return this.testConfig;
  }

  async createTestTokens() {
    return {
      apple: 'mock-apple-token',
      corporate: 'mock-corporate-token'
    };
  }

  async cleanup() {
    // Cleanup OAuth test setup
    return true;
  }
}

module.exports = OAuthTestSetup;