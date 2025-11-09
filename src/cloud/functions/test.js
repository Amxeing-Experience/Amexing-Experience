const logger = require('../../infrastructure/logger');

/**
 * Test Cloud Function.
 * A simple test endpoint for checking Parse Cloud functionality.
 * @param {object} request - Parse Cloud Function request object.
 * @returns {Promise<object>} - Test response with success status and echoed parameters.
 * @example
 * // Cloud function usage
 * Parse.Cloud.run('functionName', { request: 'example' });
 * // Returns: function result
 * // const isValid = validator.validate(data);
 * // Returns: boolean or validation result object
 * // Call from client
 * Parse.Cloud.run('test', { data: 'sample' })
 */
module.exports = async (request) => {
  const { params } = request;

  // Log the test function call
  logger.debug('Test function called', { params });

  // Simulate some async operation
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

  // Return test response
  return {
    success: true,
    message: 'Test function executed successfully',
    echo: params,
    timestamp: new Date().toISOString(),
    random: Math.floor(Math.random() * 1000),
  };
};
