/**
 * Parse Context Propagation - Global user context for audit trails.
 *
 * Uses AsyncLocalStorage to propagate user context through the entire
 * request lifecycle, ensuring audit logs capture the actual user
 * instead of "MasterKey/system" even when using useMasterKey.
 *
 * This is a global solution that works automatically for ALL Parse queries
 * without needing to modify individual controllers.
 * @file Parse Server context propagation for audit trails.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // In Express middleware:
 * app.use(parseContextMiddleware);
 *
 * // Automatically available in Parse hooks:
 * const context = getParseContext();
 * // context.user contains authenticated user info
 */

const { AsyncLocalStorage } = require('async_hooks');

/**
 * AsyncLocalStorage instance for storing request context.
 * This allows us to access user context anywhere in the async call chain
 * without explicitly passing it through function parameters.
 */
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Set Parse context for current async execution context.
 * @param {object} context - Context object with user information.
 * @param {Function} callback - Function to execute with this context.
 * @returns {*} - Result of callback execution.
 * @example
 */
function runWithParseContext(context, callback) {
  return asyncLocalStorage.run(context, callback);
}

/**
 * Get current Parse context from async local storage.
 * @returns {object|null} - Current context or null if not set.
 * @example
 */
function getParseContext() {
  return asyncLocalStorage.getStore() || null;
}

/**
 * Express middleware to set Parse context from authenticated user.
 * Should be applied after authentication middleware.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {void}
 * @example
 */
function parseContextMiddleware(req, res, next) {
  if (req.user) {
    const context = {
      user: {
        objectId: req.user.id || req.user.objectId,
        id: req.user.id || req.user.objectId,
        email: req.user.email || req.user.get?.('email') || 'unknown',
        username: req.user.username || req.user.get?.('username') || req.user.get?.('email') || 'unknown',
        sessionToken: req.user.sessionToken || req.user.getSessionToken?.(),
      },
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
      path: req.path,
      method: req.method,
    };

    // Run the rest of the request with this context
    return runWithParseContext(context, () => next());
  }

  // No user authenticated, continue without context
  next();
}

module.exports = {
  runWithParseContext,
  getParseContext,
  parseContextMiddleware,
};
