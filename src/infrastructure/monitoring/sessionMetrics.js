/**
 * Session Metrics Monitoring.
 *
 * Tracks and reports session-related metrics for monitoring and alerting.
 * Helps identify session issues, CSRF errors, and session store problems.
 * @module sessionMetrics
 * @author Amexing Development Team
 * @version 1.0.0
 */

const logger = require('../logger');

/**
 * Session Metrics Tracker.
 */
class SessionMetrics {
  constructor() {
    // Metrics storage
    this.metrics = {
      // Session operations
      sessionsCreated: 0,
      sessionsTouched: 0,
      sessionsDestroyed: 0,
      sessionsRecovered: 0,

      // CSRF operations
      csrfTokensGenerated: 0,
      csrfValidationSuccess: 0,
      csrfValidationFailures: 0,
      csrfTokenMissing: 0,
      csrfTokenInvalid: 0,
      csrfSessionExpired: 0,

      // Session health checks
      healthCheckRequests: 0,
      healthySessionChecks: 0,
      unhealthySessionChecks: 0,
      nearExpirationWarnings: 0,

      // Session store errors
      storeErrors: 0,
      storeConnectionErrors: 0,

      // Timing metrics
      lastSessionCreated: null,
      lastCsrfFailure: null,
      lastStoreError: null,
    };

    // Error tracking (last 100 errors)
    this.recentErrors = [];
    this.maxRecentErrors = 100;

    // Warning thresholds
    this.thresholds = {
      csrfFailureRate: 0.05, // 5% failure rate triggers warning
      storeErrorRate: 0.01, // 1% error rate triggers warning
    };

    logger.info('Session metrics monitoring initialized');
  }

  /**
   * Record session creation.
   * @param sessionId
   * @example
   */
  recordSessionCreated(sessionId) {
    this.metrics.sessionsCreated++;
    this.metrics.lastSessionCreated = new Date().toISOString();

    logger.debug('Session created metric recorded', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      totalCreated: this.metrics.sessionsCreated,
    });
  }

  /**
   * Record session touch (extension).
   * @param sessionId
   * @example
   */
  recordSessionTouched(sessionId) {
    this.metrics.sessionsTouched++;

    logger.debug('Session touched metric recorded', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      totalTouched: this.metrics.sessionsTouched,
    });
  }

  /**
   * Record session destruction.
   * @param sessionId
   * @example
   */
  recordSessionDestroyed(sessionId) {
    this.metrics.sessionsDestroyed++;

    logger.debug('Session destroyed metric recorded', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      totalDestroyed: this.metrics.sessionsDestroyed,
    });
  }

  /**
   * Record session recovery.
   * @param sessionId
   * @param reason
   * @example
   */
  recordSessionRecovered(sessionId, reason) {
    this.metrics.sessionsRecovered++;

    logger.info('Session recovered', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      reason,
      totalRecovered: this.metrics.sessionsRecovered,
    });
  }

  /**
   * Record CSRF persistence issue (authenticated user without CSRF secret).
   * @param sessionId
   * @param context
   * @example
   */
  recordCsrfPersistenceIssue(sessionId, context = {}) {
    // Increment a specific counter for persistence issues
    if (!this.metrics.csrfPersistenceIssues) {
      this.metrics.csrfPersistenceIssues = 0;
    }
    this.metrics.csrfPersistenceIssues++;

    // Store as recent error
    this.addRecentError('CSRF_PERSISTENCE_ISSUE', 'Authenticated user missing CSRF secret', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      ...context,
    });

    logger.warn('CSRF persistence issue recorded', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      totalPersistenceIssues: this.metrics.csrfPersistenceIssues,
      context,
    });
  }

  /**
   * Record CSRF token generation.
   * @example
   */
  recordCsrfTokenGenerated() {
    this.metrics.csrfTokensGenerated++;
  }

  /**
   * Record successful CSRF secret persistence to session store.
   * @param sessionId
   * @param context
   * @example
   */
  recordCsrfSecretPersisted(sessionId, context = {}) {
    if (!this.metrics.csrfSecretsPersisted) {
      this.metrics.csrfSecretsPersisted = 0;
    }
    this.metrics.csrfSecretsPersisted++;

    logger.debug('CSRF secret persisted successfully', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      totalPersisted: this.metrics.csrfSecretsPersisted,
      context,
    });
  }

  /**
   * Record failed CSRF secret persistence to session store.
   * @param sessionId
   * @param error
   * @param context
   * @example
   */
  recordCsrfSecretPersistenceFailure(sessionId, error, context = {}) {
    if (!this.metrics.csrfSecretPersistenceFailures) {
      this.metrics.csrfSecretPersistenceFailures = 0;
    }
    this.metrics.csrfSecretPersistenceFailures++;

    this.addRecentError('CSRF_SECRET_PERSISTENCE_FAILURE', error.message || error, {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      ...context,
    });

    logger.error('CSRF secret persistence failure', {
      sessionId: `${sessionId?.substring(0, 8)}***`,
      error: error.message || error,
      totalFailures: this.metrics.csrfSecretPersistenceFailures,
      context,
    });
  }

  /**
   * Record CSRF validation success.
   * @example
   */
  recordCsrfValidationSuccess() {
    this.metrics.csrfValidationSuccess++;
  }

  /**
   * Record CSRF validation failure.
   * @param reason
   * @param context
   * @example
   */
  recordCsrfValidationFailure(reason, context = {}) {
    this.metrics.csrfValidationFailures++;
    this.metrics.lastCsrfFailure = new Date().toISOString();

    // Track specific failure types
    if (reason === 'TOKEN_MISSING') {
      this.metrics.csrfTokenMissing++;
    } else if (reason === 'TOKEN_INVALID') {
      this.metrics.csrfTokenInvalid++;
    } else if (reason === 'SESSION_EXPIRED') {
      this.metrics.csrfSessionExpired++;
    }

    // Store recent error
    this.addRecentError('CSRF_VALIDATION_FAILURE', reason, context);

    // Check if failure rate is concerning
    this.checkCsrfFailureRate();

    logger.warn('CSRF validation failure recorded', {
      reason,
      totalFailures: this.metrics.csrfValidationFailures,
      failureRate: this.getCsrfFailureRate(),
      context,
    });
  }

  /**
   * Record health check.
   * @param isHealthy
   * @param nearExpiration
   * @example
   */
  recordHealthCheck(isHealthy, nearExpiration = false) {
    this.metrics.healthCheckRequests++;

    if (isHealthy) {
      this.metrics.healthySessionChecks++;
    } else {
      this.metrics.unhealthySessionChecks++;
    }

    if (nearExpiration) {
      this.metrics.nearExpirationWarnings++;
    }
  }

  /**
   * Record session store error.
   * @param error
   * @param context
   * @example
   */
  recordStoreError(error, context = {}) {
    this.metrics.storeErrors++;
    this.metrics.lastStoreError = new Date().toISOString();

    if (error.message?.includes('connection') || error.message?.includes('timeout')) {
      this.metrics.storeConnectionErrors++;
    }

    // Store recent error
    this.addRecentError('STORE_ERROR', error.message, context);

    logger.error('Session store error recorded', {
      error: error.message,
      totalErrors: this.metrics.storeErrors,
      context,
    });

    // Check if error rate is concerning
    this.checkStoreErrorRate();
  }

  /**
   * Add error to recent errors list.
   * @param type
   * @param message
   * @param context
   * @example
   */
  addRecentError(type, message, context) {
    this.recentErrors.push({
      type,
      message,
      context,
      timestamp: new Date().toISOString(),
    });

    // Limit size of recent errors
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
    }
  }

  /**
   * Calculate CSRF failure rate.
   * @example
   */
  getCsrfFailureRate() {
    const total = this.metrics.csrfValidationSuccess + this.metrics.csrfValidationFailures;
    if (total === 0) return 0;
    return this.metrics.csrfValidationFailures / total;
  }

  /**
   * Calculate store error rate.
   * @example
   */
  getStoreErrorRate() {
    const total = this.metrics.sessionsCreated + this.metrics.sessionsTouched;
    if (total === 0) return 0;
    return this.metrics.storeErrors / total;
  }

  /**
   * Check if CSRF failure rate exceeds threshold.
   * @example
   */
  checkCsrfFailureRate() {
    const rate = this.getCsrfFailureRate();

    if (rate > this.thresholds.csrfFailureRate) {
      logger.warn('CSRF failure rate exceeds threshold', {
        currentRate: rate,
        threshold: this.thresholds.csrfFailureRate,
        failures: this.metrics.csrfValidationFailures,
        successes: this.metrics.csrfValidationSuccess,
        recommendation: 'Check session timeout configuration and client-side keepalive',
      });
    }
  }

  /**
   * Check if store error rate exceeds threshold.
   * @example
   */
  checkStoreErrorRate() {
    const rate = this.getStoreErrorRate();

    if (rate > this.thresholds.storeErrorRate) {
      logger.error('Session store error rate exceeds threshold', {
        currentRate: rate,
        threshold: this.thresholds.storeErrorRate,
        errors: this.metrics.storeErrors,
        operations: this.metrics.sessionsCreated + this.metrics.sessionsTouched,
        recommendation: 'Check MongoDB connection and session store configuration',
      });
    }
  }

  /**
   * Get all metrics.
   * @example
   */
  getMetrics() {
    return {
      ...this.metrics,
      calculatedMetrics: {
        csrfFailureRate: this.getCsrfFailureRate(),
        storeErrorRate: this.getStoreErrorRate(),
        sessionSuccessRate:
          this.metrics.sessionsCreated > 0
            ? (this.metrics.sessionsCreated - this.metrics.storeErrors) / this.metrics.sessionsCreated
            : 1,
      },
      recentErrorCount: this.recentErrors.length,
    };
  }

  /**
   * Get recent errors.
   * @param limit
   * @example
   */
  getRecentErrors(limit = 10) {
    return this.recentErrors.slice(-limit).reverse();
  }

  /**
   * Get session health summary.
   * @example
   */
  getHealthSummary() {
    const csrfFailureRate = this.getCsrfFailureRate();
    const storeErrorRate = this.getStoreErrorRate();

    return {
      overall:
        csrfFailureRate < this.thresholds.csrfFailureRate && storeErrorRate < this.thresholds.storeErrorRate
          ? 'healthy'
          : 'degraded',
      csrf: {
        status: csrfFailureRate < this.thresholds.csrfFailureRate ? 'healthy' : 'warning',
        failureRate: csrfFailureRate,
        threshold: this.thresholds.csrfFailureRate,
      },
      sessionStore: {
        status: storeErrorRate < this.thresholds.storeErrorRate ? 'healthy' : 'error',
        errorRate: storeErrorRate,
        threshold: this.thresholds.storeErrorRate,
      },
      sessions: {
        created: this.metrics.sessionsCreated,
        touched: this.metrics.sessionsTouched,
        destroyed: this.metrics.sessionsDestroyed,
        recovered: this.metrics.sessionsRecovered,
      },
      healthChecks: {
        total: this.metrics.healthCheckRequests,
        healthy: this.metrics.healthySessionChecks,
        unhealthy: this.metrics.unhealthySessionChecks,
      },
    };
  }

  /**
   * Reset all metrics (for testing).
   * @example
   */
  reset() {
    this.metrics = {
      sessionsCreated: 0,
      sessionsTouched: 0,
      sessionsDestroyed: 0,
      sessionsRecovered: 0,
      csrfTokensGenerated: 0,
      csrfValidationSuccess: 0,
      csrfValidationFailures: 0,
      csrfTokenMissing: 0,
      csrfTokenInvalid: 0,
      csrfSessionExpired: 0,
      healthCheckRequests: 0,
      healthySessionChecks: 0,
      unhealthySessionChecks: 0,
      nearExpirationWarnings: 0,
      storeErrors: 0,
      storeConnectionErrors: 0,
      lastSessionCreated: null,
      lastCsrfFailure: null,
      lastStoreError: null,
    };
    this.recentErrors = [];

    logger.info('Session metrics reset');
  }
}

// Export singleton instance
module.exports = new SessionMetrics();
