/**
 * Custom Jest Matchers for OAuth Testing
 * Provides specialized matchers for OAuth and PCI DSS compliance testing
 */

// Custom matcher for PCI DSS compliance validation
expect.extend({
  toBePCICompliant(received) {
    const pass = received && received.score >= 80;
    if (pass) {
      return {
        message: () => `Expected PCI DSS score to be less than 80, but received ${received.score}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected PCI DSS score to be at least 80, but received ${received.score || 'undefined'}`,
        pass: false,
      };
    }
  },

  toHaveValidOAuthToken(received) {
    const isValidToken = received &&
      typeof received === 'string' &&
      received.length > 10 &&
      received.includes('.');

    if (isValidToken) {
      return {
        message: () => `Expected invalid OAuth token, but received valid token`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected valid OAuth token, but received ${received}`,
        pass: false,
      };
    }
  },

  toHaveSecureConfiguration(received) {
    const hasSecureConfig = received &&
      received.useSSL !== false &&
      received.encryption !== false &&
      received.tokenExpiry && received.tokenExpiry > 0;

    if (hasSecureConfig) {
      return {
        message: () => `Expected insecure configuration, but received secure configuration`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected secure configuration, but received insecure configuration`,
        pass: false,
      };
    }
  }
});