/**
 * Parse Query Helper - Utilities for Parse queries with audit context.
 *
 * Provides helper functions to execute Parse queries with proper user context
 * for audit trail attribution. Ensures that audit logs show the actual user
 * instead of "MasterKey/system".
 * @file Helper utilities for Parse queries with audit context.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-16
 * @example
 * const { queryWithContext } = require('./utils/parseQueryHelper');
 *
 * // In controller:
 * const client = await queryWithContext(query, req.user).get(clientId);
 */

/**
 * Extract user context from authenticated request user.
 * @param {object} user - Authenticated user from req.user.
 * @returns {object} - User context for Parse operations.
 * @example
 */
function extractUserContext(user) {
  if (!user) {
    return null;
  }

  return {
    user: {
      objectId: user.id || user.objectId,
      id: user.id || user.objectId,
      email: user.email || user.get?.('email') || 'unknown',
      username: user.username || user.get?.('username') || user.get?.('email') || 'unknown',
      sessionToken: user.sessionToken || user.getSessionToken?.(),
    },
  };
}

/**
 * Execute Parse query with user context for audit trail.
 * Wraps Parse query operations to automatically include user context.
 * @param {Parse.Query} query - Parse query to execute.
 * @param {object} user - Authenticated user from req.user.
 * @returns {object} - Query wrapper with context-aware methods.
 * @example
 * // Get single object with audit context
 * const client = await queryWithContext(query, req.user).get('abc123');
 *
 * // Find with audit context
 * const clients = await queryWithContext(query, req.user).find();
 *
 * // First with audit context
 * const client = await queryWithContext(query, req.user).first();
 */
function queryWithContext(query, user) {
  const context = extractUserContext(user);

  return {
    /**
     * Get object by ID with user context.
     * @param {string} objectId - Object ID to retrieve.
     * @param {object} options - Additional Parse query options.
     * @returns {Promise<Parse.Object>} - Retrieved object.
     * @example
     */
    async get(objectId, options = {}) {
      return query.get(objectId, {
        useMasterKey: true,
        context,
        ...options,
      });
    },

    /**
     * Find objects with user context.
     * @param {object} options - Additional Parse query options.
     * @returns {Promise<Array<Parse.Object>>} - Array of objects.
     * @example
     */
    async find(options = {}) {
      return query.find({
        useMasterKey: true,
        context,
        ...options,
      });
    },

    /**
     * Get first object with user context.
     * @param {object} options - Additional Parse query options.
     * @returns {Promise<Parse.Object|undefined>} - First object or undefined.
     * @example
     */
    async first(options = {}) {
      return query.first({
        useMasterKey: true,
        context,
        ...options,
      });
    },

    /**
     * Count objects with user context.
     * @param {object} options - Additional Parse query options.
     * @returns {Promise<number>} - Count of objects.
     * @example
     */
    async count(options = {}) {
      return query.count({
        useMasterKey: true,
        context,
        ...options,
      });
    },
  };
}

/**
 * Save Parse object with user context for audit trail.
 * @param {Parse.Object} object - Parse object to save.
 * @param {object} user - Authenticated user from req.user.
 * @param {object} options - Additional Parse save options.
 * @returns {Promise<Parse.Object>} - Saved object.
 * @example
 * const client = new Parse.Object('Client');
 * client.set('name', 'Acme Corp');
 * await saveWithContext(client, req.user);
 */
async function saveWithContext(object, user, options = {}) {
  const context = extractUserContext(user);

  return object.save(null, {
    useMasterKey: true,
    context,
    ...options,
  });
}

/**
 * Destroy Parse object with user context for audit trail.
 * @param {Parse.Object} object - Parse object to destroy.
 * @param {object} user - Authenticated user from req.user.
 * @param {object} options - Additional Parse destroy options.
 * @returns {Promise<Parse.Object>} - Destroyed object.
 * @example
 * await destroyWithContext(client, req.user);
 */
async function destroyWithContext(object, user, options = {}) {
  const context = extractUserContext(user);

  return object.destroy({
    useMasterKey: true,
    context,
    ...options,
  });
}

module.exports = {
  queryWithContext,
  saveWithContext,
  destroyWithContext,
  extractUserContext,
};
