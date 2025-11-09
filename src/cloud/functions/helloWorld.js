const logger = require('../../infrastructure/logger');

/**
 * Hello World Cloud Function.
 * Returns a simple JSON response for testing.
 * @param {object} request - Parse Cloud Function request object.
 * @returns {Promise<object>} - Response object with greeting and metadata.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Call from client
 * Parse.Cloud.run('hello', { name: 'Developer' })
 */
module.exports = async (request) => {
  const { params, user, headers } = request;

  // Log the function call
  logger.info('Hello world function called', {
    userId: user?.id,
    params,
  });

  // Get optional name parameter
  const name = params.name || 'World';

  // Build response
  const response = {
    message: `Hello ${name} from Parse Cloud!`,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    data: {
      requestId: headers['x-request-id'],
      authenticated: !!user,
      userId: user?.id || null,
      username: user?.get('username') || null,
    },
    metadata: {
      serverTime: Date.now(),
      parseVersion: '7.0+',
    },
  };

  // Add additional data if user is authenticated
  if (user) {
    response.data.userCreatedAt = user.get('createdAt');
    response.data.emailVerified = user.get('emailVerified') || false;
  }

  return response;
};
