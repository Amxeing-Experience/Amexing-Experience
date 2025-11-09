/**
 * Integration Tests: OAuth Providers Startup
 * Tests Parse Cloud function getOAuthProviders during initialization
 *
 * SIMPLIFIED: Tests focus on graceful handling of OAuth provider requests during startup
 */

const Parse = require('parse/node');

describe('OAuth Providers Startup Integration', () => {
  beforeAll(async () => {
    // Initialize Parse SDK for testing
    Parse.initialize(
      process.env.PARSE_APP_ID || 'amexing-test-app',
      null,
      process.env.PARSE_MASTER_KEY || 'test-master-key'
    );
    Parse.serverURL = 'http://localhost:1339/parse';

    // Wait for Parse Server initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 30000);

  describe('getOAuthProviders Cloud Function', () => {
    it('should return OAuth providers list without errors', async () => {
      const result = await Parse.Cloud.run('getOAuthProviders');

      expect(result).toBeDefined();
      expect(result.providers).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);

      console.log(`✓ getOAuthProviders returned ${result.providers.length} providers`);
    });

    it('should handle calls gracefully regardless of initialization state', async () => {
      // This test simulates calling the function during startup
      // The function should either:
      // 1. Return empty providers with debug logging (during init)
      // 2. Return actual providers (after init)

      const result = await Parse.Cloud.run('getOAuthProviders');

      expect(result).toBeDefined();
      expect(result.providers).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);

      // Either empty (during init) or populated (after init) - both are acceptable
      if (result.providers.length === 0) {
        console.log('✓ Gracefully returned empty providers during initialization');
      } else {
        console.log(`✓ Returned ${result.providers.length} configured providers`);
        result.providers.forEach(provider => {
          expect(provider).toHaveProperty('name');
        });
      }
    });

    it('should not throw errors during concurrent calls', async () => {
      // Call multiple times to simulate concurrent startup requests
      const calls = [];

      for (let i = 0; i < 3; i++) {
        calls.push(Parse.Cloud.run('getOAuthProviders'));
      }

      // All calls should complete without throwing
      const results = await Promise.all(calls);

      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.providers).toBeDefined();
        expect(Array.isArray(result.providers)).toBe(true);
      });

      console.log('✓ Multiple concurrent calls handled successfully');
    });
  });

  describe('OAuth Provider Response Structure', () => {
    it('should return valid structure when available', async () => {
      const result = await Parse.Cloud.run('getOAuthProviders');

      if (result.providers.length > 0) {
        const provider = result.providers[0];

        // Verify provider structure
        expect(provider).toHaveProperty('name');

        console.log(`✓ Provider config structure validated: ${provider.name}`);
      } else {
        console.log('⚠ No providers configured - skipping validation');
      }
    });

    it('should handle missing provider configurations gracefully', async () => {
      // Even if providers are not configured, should not throw
      const result = await Parse.Cloud.run('getOAuthProviders');

      expect(result).toBeDefined();
      expect(result.providers).toBeDefined();

      // Empty array is acceptable
      expect(Array.isArray(result.providers)).toBe(true);
    });

    it('should provide meaningful response structure', async () => {
      const result = await Parse.Cloud.run('getOAuthProviders');

      // Should always return a valid structure
      expect(result).toMatchObject({
        providers: expect.any(Array),
      });

      // Never return undefined or null
      expect(result).not.toBeNull();
      expect(result).not.toBeUndefined();
    });
  });

  describe('Performance and Response Time', () => {
    it('should respond quickly', async () => {
      const startTime = Date.now();

      await Parse.Cloud.run('getOAuthProviders');

      const duration = Date.now() - startTime;

      // Should respond in under 5 seconds
      expect(duration).toBeLessThan(5000);
      console.log(`✓ Response time: ${duration}ms`);
    });

    it('should handle rapid sequential calls', async () => {
      const calls = [];
      const callCount = 5;

      for (let i = 0; i < callCount; i++) {
        calls.push(Parse.Cloud.run('getOAuthProviders'));
        // Small delay between calls
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const results = await Promise.all(calls);

      // All should succeed
      expect(results).toHaveLength(callCount);
      results.forEach(result => {
        expect(result.providers).toBeDefined();
      });

      console.log(`✓ Handled ${callCount} rapid sequential calls`);
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple simultaneous calls', async () => {
      const concurrentCalls = 10;
      const calls = Array(concurrentCalls).fill(null).map(() =>
        Parse.Cloud.run('getOAuthProviders')
      );

      const results = await Promise.all(calls);

      // All should succeed
      expect(results).toHaveLength(concurrentCalls);

      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.providers).toBeDefined();
        expect(Array.isArray(result.providers)).toBe(true);
      });

      console.log(`✓ Handled ${concurrentCalls} concurrent calls`);
    });

    it('should return consistent results for concurrent calls', async () => {
      const calls = [
        Parse.Cloud.run('getOAuthProviders'),
        Parse.Cloud.run('getOAuthProviders'),
        Parse.Cloud.run('getOAuthProviders'),
      ];

      const results = await Promise.all(calls);

      // All should return the same structure
      const providerCounts = results.map(r => r.providers.length);
      const allSame = providerCounts.every(count => count === providerCounts[0]);

      expect(allSame).toBe(true);
      console.log('✓ Consistent results across concurrent calls');
    });
  });

  describe('Integration with Authentication Flow', () => {
    it('should be callable without authentication', async () => {
      // getOAuthProviders should work without user session
      const result = await Parse.Cloud.run('getOAuthProviders');

      expect(result).toBeDefined();
      expect(result.providers).toBeDefined();

      console.log('✓ Accessible without authentication');
    });

    it('should support login page provider discovery', async () => {
      // This function is typically called from login page
      // Should work for unauthenticated users

      const result = await Parse.Cloud.run('getOAuthProviders');

      // Should return provider list (even if empty)
      expect(Array.isArray(result.providers)).toBe(true);

      if (result.providers.length > 0) {
        console.log(`✓ Available providers for login page: ${result.providers.map(p => p.name).join(', ')}`);
      } else {
        console.log('⚠ No providers configured');
      }
    });
  });
});
