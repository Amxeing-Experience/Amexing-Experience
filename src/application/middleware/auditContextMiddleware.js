/**
 * Audit Context Middleware - Propagates user context to Parse Server hooks.
 *
 * This middleware captures authenticated user information from the request
 * and makes it available to Parse Server cloud hooks through Parse.Cloud.httpRequest.
 * This enables proper user attribution in audit logs for READ operations.
 * @file Middleware for audit trail user context propagation.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // In app.js or routes:
 * app.use(auditContextMiddleware);
 */

const logger = require('../../infrastructure/logger');

/**
 * Middleware to propagate user context to Parse Server hooks.
 * Attaches user information to request headers that Parse Server can access.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next function.
 * @returns {void}
 * @example
 */
function auditContextMiddleware(req, res, next) {
  try {
    // If user is authenticated, store context for Parse hooks
    if (req.user) {
      // Store in request for direct access
      req.auditContext = {
        userId: req.user.id || req.user.objectId,
        username: req.user.username || req.user.email || req.user.get?.('email'),
        email: req.user.email || req.user.get?.('email'),
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        sessionToken: req.user.sessionToken || req.user.getSessionToken?.() || req.headers['x-parse-session-token'],
      };

      // Also set custom headers for Parse Server to pick up
      req.headers['x-audit-user-id'] = req.auditContext.userId;
      req.headers['x-audit-username'] = req.auditContext.username;
      req.headers['x-audit-ip'] = req.auditContext.ip;

      // Ensure session token is in headers for Parse Server
      if (req.auditContext.sessionToken && !req.headers['x-parse-session-token']) {
        req.headers['x-parse-session-token'] = req.auditContext.sessionToken;
      }

      logger.debug('Audit context set', {
        userId: req.auditContext.userId,
        username: req.auditContext.username,
        path: req.path,
        hasSessionToken: !!req.auditContext.sessionToken,
      });
    }
  } catch (error) {
    // Don't fail the request if audit context fails
    logger.warn('Failed to set audit context', {
      error: error.message,
      path: req.path,
    });
  }

  next();
}

module.exports = auditContextMiddleware;
