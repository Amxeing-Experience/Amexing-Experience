/**
 * Session Recovery Middleware - Defensive session and CSRF management.
 *
 * Provides automatic recovery mechanisms for session and CSRF issues that may occur
 * in production environments due to session expiration, multiple user switches,
 * or timing issues during logout/login cycles.
 *
 * This middleware implements PCI DSS compliant session management with:
 * - Automatic CSRF secret regeneration when missing
 * - Session health validation
 * - Proactive session expiration detection
 * - Secure audit logging without exposing sensitive data
 * - Graceful error recovery for user experience.
 * @module sessionRecoveryMiddleware
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2.0.0
 * @example
 * // Apply to Express app before routes
 * const sessionRecovery = require('./middleware/sessionRecoveryMiddleware');
 * app.use(sessionRecovery.autoRecoverSession());
 * app.use(sessionRecovery.sessionHealthCheck());
 */

const uidSafe = require('uid-safe');
const logger = require('../../infrastructure/logger');

/**
 * Generates a secure CSRF secret for the session.
 * Uses uid-safe to create a cryptographically strong random string.
 * @function generateCSRFSecret
 * @returns {Promise<string>} - 32-byte random string suitable for CSRF protection.
 * @private
 * @example
 */
async function generateCSRFSecret() {
  return uidSafe(32);
}

/**
 * Checks if a session is about to expire (within 5 minutes).
 * Helps prevent CSRF errors by proactively detecting expiring sessions.
 * @function isSessionNearExpiration
 * @param {object} session - Express session object.
 * @returns {boolean} - True if session expires within 5 minutes.
 * @private
 * @example
 */
function isSessionNearExpiration(session) {
  if (!session || !session.cookie) {
    return false;
  }

  const now = Date.now();
  const expires = session.cookie.expires
    ? new Date(session.cookie.expires).getTime()
    : now + session.cookie.maxAge;

  const timeRemaining = expires - now;
  const fiveMinutes = 5 * 60 * 1000;

  return timeRemaining > 0 && timeRemaining < fiveMinutes;
}

/**
 * Auto-recovery middleware for missing CSRF secrets.
 * Automatically regenerates CSRF secret when missing instead of failing the request.
 * This prevents user-facing errors during edge cases like:
 * - Session expiration while page is open
 * - Multiple logout/login cycles
 * - Session store failures
 * - Race conditions during session initialization.
 *
 * Security considerations:
 * - Only generates secret for valid sessions
 * - Logs all recovery events for security audit
 * - Does not mask underlying session issues (logs for investigation)
 * - Maintains PCI DSS compliance with secure random generation.
 * @function autoRecoverSession
 * @returns {Function} - Express middleware function.
 * @example
 * app.use(sessionRecovery.autoRecoverSession());
 */
function autoRecoverSession() {
  return async (req, res, next) => {
    try {
      // Only process if we have a session
      if (!req.session) {
        return next();
      }

      // Check if CSRF secret is missing
      if (!req.session.csrfSecret) {
        // Generate new CSRF secret
        req.session.csrfSecret = await generateCSRFSecret();

        // Log recovery event for security audit (PCI DSS compliant logging)
        logger.warn('CSRF secret auto-recovered for session', {
          sessionID: req.session.id,
          path: req.path,
          method: req.method,
          userAgent: req.get('User-Agent')?.substring(0, 50), // Truncate for log size
          ip: req.ip,
          timestamp: new Date().toISOString(),
        });

        // Set header to inform client about recovery
        res.setHeader('X-Session-Recovered', 'csrf-secret-regenerated');
      }

      // Check for session near expiration (within 5 minutes)
      if (isSessionNearExpiration(req.session)) {
        logger.debug('Session approaching expiration', {
          sessionID: req.session.id,
          expiresAt: req.session.cookie.expires,
          remainingTime: req.session.cookie.expires
            ? new Date(req.session.cookie.expires).getTime() - Date.now()
            : 'unknown',
        });

        // Set header to inform client to refresh session
        res.setHeader('X-Session-Warning', 'expiring-soon');
      }

      next();
    } catch (error) {
      logger.error('Session recovery middleware error', {
        error: error.message,
        stack: error.stack,
        sessionID: req.session?.id,
        path: req.path,
      });

      // Don't block the request, continue with error logging
      next();
    }
  };
}

/**
 * Session health check middleware.
 * Provides diagnostic information about session state for debugging.
 * Adds session health metadata to response headers for client-side monitoring.
 *
 * Response headers added:
 * - X-Session-Exists: true/false
 * - X-CSRF-Protected: true/false
 * - X-Session-ID: hashed session ID (first 8 chars for correlation).
 * @function sessionHealthCheck
 * @returns {Function} - Express middleware function.
 * @example
 * app.use(sessionRecovery.sessionHealthCheck());
 */
function sessionHealthCheck() {
  return (req, res, next) => {
    try {
      // Add session health headers for debugging (safe for production)
      if (req.session) {
        res.setHeader('X-Session-Exists', 'true');
        res.setHeader(
          'X-CSRF-Protected',
          req.session.csrfSecret ? 'true' : 'false'
        );

        // Add truncated session ID for correlation (PCI DSS safe - no sensitive data)
        if (req.session.id) {
          res.setHeader(
            'X-Session-ID',
            `${req.session.id.substring(0, 8)}***`
          );
        }
      } else {
        res.setHeader('X-Session-Exists', 'false');
        res.setHeader('X-CSRF-Protected', 'false');
      }

      next();
    } catch (error) {
      logger.error('Session health check error', {
        error: error.message,
        path: req.path,
      });
      // Don't block request
      next();
    }
  };
}

/**
 * Express route handler for dedicated session health endpoint.
 * Provides detailed session status information for frontend validation.
 * Can be called by frontend before critical operations to ensure session is valid.
 *
 * Response includes:
 * - healthy: boolean - overall session health status
 * - sessionExists: boolean - session object present
 * - csrfProtected: boolean - CSRF secret initialized
 * - expiresAt: timestamp - when session will expire
 * - nearExpiration: boolean - expires within 5 minutes
 * - sessionId: string - truncated session ID for correlation.
 * @function sessionHealthEndpoint
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @example
 * // Add as route
 * app.get('/api/session/health', sessionRecovery.sessionHealthEndpoint);
 *
 * // Frontend usage
 * const health = await fetch('/api/session/health').then(r => r.json());
 * if (!health.healthy) {
 *   // Refresh page or re-authenticate
 * }
 */
function sessionHealthEndpoint(req, res) {
  try {
    const sessionExists = !!req.session;
    const csrfProtected = sessionExists && !!req.session.csrfSecret;
    const nearExpiration = sessionExists && isSessionNearExpiration(req.session);

    const health = {
      healthy: sessionExists && csrfProtected,
      sessionExists,
      csrfProtected,
      expiresAt: req.session?.cookie?.expires || null,
      nearExpiration,
      sessionId: req.session?.id
        ? `${req.session.id.substring(0, 8)}***`
        : null,
      timestamp: new Date().toISOString(),
    };

    // Log session health check (useful for monitoring)
    logger.debug('Session health check requested', {
      healthy: health.healthy,
      sessionId: health.sessionId,
      path: req.path,
      ip: req.ip,
    });

    res.json(health);
  } catch (error) {
    logger.error('Session health endpoint error', {
      error: error.message,
      path: req.path,
    });

    res.status(500).json({
      healthy: false,
      error: 'Failed to check session health',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Validates session before critical operations.
 * Middleware that ensures session and CSRF are valid before proceeding.
 * Returns 401 with recovery instructions if session is invalid.
 *
 * Use this middleware on routes that require guaranteed valid session:
 * - Payment processing
 * - User data modifications
 * - Administrative operations.
 * @function requireValidSession
 * @returns {Function} - Express middleware function.
 * @example
 * router.post('/api/payment', sessionRecovery.requireValidSession(), paymentController);
 */
function requireValidSession() {
  return async (req, res, next) => {
    try {
      // Check session exists
      if (!req.session) {
        logger.warn('Critical operation attempted without session', {
          path: req.path,
          method: req.method,
          ip: req.ip,
        });

        return res.status(401).json({
          error: 'Session Required',
          message: 'Please refresh the page and try again',
          code: 'SESSION_MISSING',
          recoveryAction: 'refresh_page',
        });
      }

      // Check CSRF secret exists
      if (!req.session.csrfSecret) {
        // Try to recover
        req.session.csrfSecret = await generateCSRFSecret();

        logger.warn('CSRF secret missing on critical operation, auto-recovered', {
          sessionID: req.session.id,
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
      }

      // Check session expiration
      if (isSessionNearExpiration(req.session)) {
        logger.info('Critical operation attempted with expiring session', {
          sessionID: req.session.id,
          path: req.path,
          expiresAt: req.session.cookie.expires,
        });

        // Allow operation but warn client
        res.setHeader('X-Session-Warning', 'expiring-soon');
      }

      next();
    } catch (error) {
      logger.error('Session validation error', {
        error: error.message,
        path: req.path,
        method: req.method,
      });

      res.status(500).json({
        error: 'Session Validation Failed',
        message: 'Please try again',
        code: 'SESSION_VALIDATION_ERROR',
      });
    }
  };
}

module.exports = {
  autoRecoverSession,
  sessionHealthCheck,
  sessionHealthEndpoint,
  requireValidSession,
  // Exported for testing
  generateCSRFSecret,
  isSessionNearExpiration,
};
