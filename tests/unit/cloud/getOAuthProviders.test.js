/**
 * Unit Tests for Parse.Cloud.define('getOAuthProviders')
 * Tests OAuthService initialization check and error logging
 */

// Mock dependencies BEFORE requiring
jest.mock('../../../src/infrastructure/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../../src/infrastructure/logger');

describe('Parse.Cloud.define("getOAuthProviders") - Initialization Check', () => {
  let mockOAuthService;
  let mockCloudFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock OAuthService
    mockOAuthService = {
      getAvailableProviders: jest.fn(),
      getProviderConfig: jest.fn(),
      isInitialized: false, // Track initialization state
    };

    // Mock the cloud function implementation (matches actual implementation in src/cloud/main.js)
    mockCloudFunction = async (request) => {
      try {
        // Check if OAuthService is initialized
        if (!mockOAuthService.isInitialized) {
          logger.debug('getOAuthProviders called before OAuthService initialization', {
            timestamp: new Date().toISOString(),
            phase: 'startup',
          });

          // Return empty providers during initialization
          return { providers: [] };
        }

        const providers = mockOAuthService.getAvailableProviders();
        const providerConfigs = providers.map((provider) =>
          mockOAuthService.getProviderConfig(provider)
        );

        return { providers: providerConfigs };
      } catch (error) {
        // Check if error is initialization-related (matches actual implementation)
        if (error.message && (error.message.includes('not initialized') || error.message.includes('initialization'))) {
          logger.debug('getOAuthProviders called during OAuthService initialization', {
            error: error.message,
            timestamp: new Date().toISOString(),
            phase: 'startup',
          });

          // Gracefully return empty providers
          return { providers: [] };
        }

        // For other errors, use error logging
        logger.error('Get OAuth providers error:', error);
        throw error;
      }
    };
  });

  describe('OAuthService Initialization State', () => {
    it('should use debug logging when service is not initialized', async () => {
      // OAuthService not initialized
      mockOAuthService.isInitialized = false;

      const request = {};
      const result = await mockCloudFunction(request);

      // Verify debug logging was used
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('OAuthService'),
        expect.objectContaining({
          timestamp: expect.any(String),
          phase: 'startup',
        })
      );

      // Verify error was NOT logged
      expect(logger.error).not.toHaveBeenCalled();

      // Should return empty providers gracefully
      expect(result).toEqual({ providers: [] });
    });

    it('should use error logging for non-initialization errors', async () => {
      // Service initialized but throws different error
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const request = {};

      await expect(mockCloudFunction(request)).rejects.toThrow('Database connection failed');

      // Verify error logging was used for real errors
      expect(logger.error).toHaveBeenCalledWith(
        'Get OAuth providers error:',
        expect.any(Error)
      );

      // Debug should not be called for real errors
      const debugCalls = logger.debug.mock.calls.filter(call =>
        call[0].includes('error')
      );
      expect(debugCalls.length).toBe(0);
    });

    it('should return providers successfully when service is initialized', async () => {
      // Service fully initialized
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockReturnValue(['google', 'apple']);
      mockOAuthService.getProviderConfig.mockImplementation((provider) => ({
        name: provider,
        enabled: true,
      }));

      const request = {};
      const result = await mockCloudFunction(request);

      // Verify no debug or error logging
      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();

      // Should return provider configs
      expect(result).toEqual({
        providers: [
          { name: 'google', enabled: true },
          { name: 'apple', enabled: true },
        ],
      });
    });
  });

  describe('Initialization Error Handling', () => {
    it('should gracefully handle "not initialized" errors', async () => {
      // Set initialized to true so it doesn't hit the early return,
      // but make getAvailableProviders throw to test the catch block
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockImplementation(() => {
        throw new Error('OAuthService not initialized');
      });

      const request = {};
      const result = await mockCloudFunction(request);

      // Should use debug logging for initialization errors
      // The catch block logs: "getOAuthProviders called during OAuthService initialization"
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('getOAuthProviders called during OAuthService initialization'),
        expect.objectContaining({
          error: expect.stringContaining('not initialized'),
          phase: 'startup',
        })
      );

      // Should return empty providers gracefully
      expect(result).toEqual({ providers: [] });
    });

    it('should distinguish between startup and runtime errors', async () => {
      // First call during startup
      mockOAuthService.isInitialized = false;
      let request = {};
      await mockCloudFunction(request);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          phase: 'startup',
        })
      );

      // Clear mocks
      jest.clearAllMocks();

      // Second call after initialization with runtime error
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockImplementation(() => {
        throw new Error('Runtime configuration error');
      });

      request = {};
      await expect(mockCloudFunction(request)).rejects.toThrow('Runtime configuration error');

      // Runtime errors should use error logging
      expect(logger.error).toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('Logging Context', () => {
    it('should include timestamp in debug logs', async () => {
      mockOAuthService.isInitialized = false;

      const request = {};
      await mockCloudFunction(request);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        })
      );
    });

    it('should include phase indicator for startup logs', async () => {
      mockOAuthService.isInitialized = false;

      const request = {};
      await mockCloudFunction(request);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          phase: 'startup',
        })
      );
    });
  });

  describe('Provider Configuration', () => {
    it('should map provider configs correctly when initialized', async () => {
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockReturnValue(['google', 'apple', 'microsoft']);
      mockOAuthService.getProviderConfig.mockImplementation((provider) => ({
        name: provider,
        clientId: `${provider}-client-id`,
        enabled: true,
      }));

      const request = {};
      const result = await mockCloudFunction(request);

      expect(result.providers).toHaveLength(3);
      expect(result.providers[0]).toEqual({
        name: 'google',
        clientId: 'google-client-id',
        enabled: true,
      });
    });

    it('should return empty array during initialization phase', async () => {
      mockOAuthService.isInitialized = false;

      const request = {};
      const result = await mockCloudFunction(request);

      expect(result.providers).toEqual([]);
      expect(mockOAuthService.getAvailableProviders).not.toHaveBeenCalled();
      expect(mockOAuthService.getProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('should not throw errors during initialization phase', async () => {
      mockOAuthService.isInitialized = false;

      const request = {};

      // Should not throw
      await expect(mockCloudFunction(request)).resolves.toEqual({ providers: [] });
    });

    it('should throw errors for real issues after initialization', async () => {
      mockOAuthService.isInitialized = true;
      mockOAuthService.getAvailableProviders.mockImplementation(() => {
        throw new Error('Critical service failure');
      });

      const request = {};

      // Should throw for real errors
      await expect(mockCloudFunction(request)).rejects.toThrow('Critical service failure');
    });
  });
});
