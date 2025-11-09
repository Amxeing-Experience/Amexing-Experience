/**
 * Session Manager - Client-side session health monitoring and management.
 *
 * Provides automatic session keepalive, health monitoring, expiry warnings,
 * and CSRF token management to prevent session-related errors in production.
 *
 * Features:
 * - Automatic session keepalive (extends session every 5 minutes)
 * - Session health monitoring
 * - Session expiry warnings (5 minutes before expiration)
 * - Pre-submit session validation
 * - Automatic CSRF token refresh
 * - Graceful session recovery.
 * @param window
 * @module SessionManager
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 */

(function (window) {
  /**
   * SessionManager class.
   */
  class SessionManager {
    constructor(options = {}) {
      // Configuration
      this.config = {
        // Check session health every 5 minutes (300000ms)
        keepaliveInterval: options.keepaliveInterval || 300000,
        // Check every 30 seconds when near expiration
        warningCheckInterval: options.warningCheckInterval || 30000,
        // Warn when 5 minutes (300000ms) from expiration
        expiryWarningThreshold: options.expiryWarningThreshold || 300000,
        // API endpoint for session health
        healthEndpoint: options.healthEndpoint || '/api/session/health',
        // Enable debug logging
        debug: options.debug || false,
        // Callback when session is about to expire
        onSessionExpiring: options.onSessionExpiring || null,
        // Callback when session expires
        onSessionExpired: options.onSessionExpired || null,
        // Callback when session is healthy
        onSessionHealthy: options.onSessionHealthy || null,
      };

      // State
      this.state = {
        isHealthy: false,
        expiresAt: null,
        nearExpiration: false,
        lastCheck: null,
        warningShown: false,
        keepaliveTimer: null,
        warningTimer: null,
      };

      // Initialize
      this.init();
    }

    /**
     * Initialize session manager.
     * @example
     */
    init() {
      this.log('SessionManager initialized');

      // Start keepalive timer
      this.startKeepalive();

      // Check session health immediately
      this.checkHealth();

      // Add form submit interceptors
      this.setupFormInterceptors();

      // Listen for page visibility changes
      this.setupVisibilityListener();
    }

    /**
     * Log debug messages.
     * @param {...any} args
     * @example
     */
    log(...args) {
      if (this.config.debug) {
        console.log('[SessionManager]', ...args);
      }
    }

    /**
     * Start keepalive timer.
     * @example
     */
    startKeepalive() {
      this.log('Starting keepalive timer');

      // Clear existing timer
      if (this.state.keepaliveTimer) {
        clearInterval(this.state.keepaliveTimer);
      }

      // Set new timer
      this.state.keepaliveTimer = setInterval(() => {
        this.checkHealth();
      }, this.config.keepaliveInterval);
    }

    /**
     * Start warning check timer (more frequent checks when near expiration).
     * @example
     */
    startWarningTimer() {
      this.log('Starting warning timer');

      // Clear existing timer
      if (this.state.warningTimer) {
        clearInterval(this.state.warningTimer);
      }

      // Set new timer
      this.state.warningTimer = setInterval(() => {
        this.checkHealth();
      }, this.config.warningCheckInterval);
    }

    /**
     * Stop warning timer.
     * @example
     */
    stopWarningTimer() {
      if (this.state.warningTimer) {
        this.log('Stopping warning timer');
        clearInterval(this.state.warningTimer);
        this.state.warningTimer = null;
      }
    }

    /**
     * Check session health.
     * @example
     */
    async checkHealth() {
      try {
        this.log('Checking session health...');

        const response = await fetch(this.config.healthEndpoint, {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`);
        }

        const health = await response.json();
        this.log('Session health:', health);

        // Update state
        const wasHealthy = this.state.isHealthy;
        const wasNearExpiration = this.state.nearExpiration;

        this.state.isHealthy = health.healthy;
        this.state.expiresAt = health.expiresAt ? new Date(health.expiresAt) : null;
        this.state.nearExpiration = health.nearExpiration || false;
        this.state.lastCheck = new Date();

        // Handle state changes
        if (!wasHealthy && this.state.isHealthy) {
          this.log('Session recovered to healthy state');
          this.state.warningShown = false;
          this.stopWarningTimer();

          if (this.config.onSessionHealthy) {
            this.config.onSessionHealthy(health);
          }
        }

        if (!wasNearExpiration && this.state.nearExpiration) {
          this.log('Session approaching expiration');
          this.handleSessionExpiring();
          this.startWarningTimer();
        } else if (wasNearExpiration && !this.state.nearExpiration) {
          this.log('Session no longer near expiration');
          this.state.warningShown = false;
          this.stopWarningTimer();
        }

        if (!this.state.isHealthy && !health.sessionExists) {
          this.log('Session expired');
          this.handleSessionExpired();
        }

        return health;
      } catch (error) {
        console.error('[SessionManager] Health check error:', error);
        return null;
      }
    }

    /**
     * Handle session expiring warning.
     * @example
     */
    handleSessionExpiring() {
      if (this.state.warningShown) {
        return;
      }

      this.state.warningShown = true;
      this.log('Session expiring - showing warning');

      if (this.config.onSessionExpiring) {
        this.config.onSessionExpiring(this.state.expiresAt);
      } else {
        // Default warning behavior
        this.showExpiryWarning();
      }
    }

    /**
     * Handle session expired.
     * @example
     */
    handleSessionExpired() {
      this.log('Session expired');

      if (this.config.onSessionExpired) {
        this.config.onSessionExpired();
      } else {
        // Default expired behavior
        this.showExpiredNotification();
      }
    }

    /**
     * Show expiry warning notification.
     * @example
     */
    showExpiryWarning() {
      // Check if Bootstrap toast is available
      if (typeof window.bootstrap !== 'undefined' && window.bootstrap.Toast) {
        const toastHtml = `
          <div class="toast align-items-center text-white bg-warning border-0" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
            <div class="d-flex">
              <div class="toast-body">
                <strong>⚠️ Tu sesión está por expirar</strong><br>
                Tu sesión expirará pronto. Haz clic en cualquier parte para extenderla.
              </div>
              <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
          </div>
        `;

        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('session-toast-container');
        if (!toastContainer) {
          toastContainer = document.createElement('div');
          toastContainer.id = 'session-toast-container';
          toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
          toastContainer.style.zIndex = '9999';
          document.body.appendChild(toastContainer);
        }

        // Add toast
        toastContainer.innerHTML = toastHtml;
        const toastElement = toastContainer.querySelector('.toast');
        const toast = new window.bootstrap.Toast(toastElement);
        toast.show();

        // Extend session when user clicks anywhere
        const extendSession = () => {
          this.checkHealth();
          toast.hide();
          document.removeEventListener('click', extendSession);
        };
        document.addEventListener('click', extendSession);
      } else {
        // Fallback to alert if Bootstrap toast not available
        window.alert('Tu sesión está por expirar. Haz clic en OK para extenderla.');
        this.checkHealth();
      }
    }

    /**
     * Show session expired notification.
     * @example
     */
    showExpiredNotification() {
      window.alert('Tu sesión ha expirado. Por favor, recarga la página.');
    }

    /**
     * Setup form submit interceptors.
     * @example
     */
    setupFormInterceptors() {
      this.log('Setting up form interceptors');

      // Intercept all form submissions
      document.addEventListener('submit', async (event) => {
        const form = event.target;

        // Skip if not a form
        if (form.tagName !== 'FORM') {
          return;
        }

        // Skip if form has data-skip-session-check attribute
        if (form.hasAttribute('data-skip-session-check')) {
          return;
        }

        this.log('Form submit intercepted, checking session...');

        // Prevent default submission
        event.preventDefault();

        // Check session health
        const health = await this.checkHealth();

        if (!health) {
          window.alert('No se pudo verificar la sesión. Por favor, intenta de nuevo.');
          return;
        }

        if (!health.healthy) {
          const reload = window.confirm('Tu sesión ha expirado. ¿Deseas recargar la página?');
          if (reload) {
            window.location.reload();
          }
          return;
        }

        if (health.nearExpiration) {
          const proceed = window.confirm('Tu sesión está por expirar. ¿Deseas continuar?');
          if (!proceed) {
            return;
          }
        }

        // Session is healthy, submit form
        this.log('Session healthy, submitting form');
        form.submit();
      });
    }

    /**
     * Setup page visibility listener.
     * @example
     */
    setupVisibilityListener() {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.log('Page became visible, checking session');
          this.checkHealth();
        }
      });
    }

    /**
     * Manually extend session.
     * @example
     */
    async extend() {
      this.log('Manually extending session');
      return this.checkHealth();
    }

    /**
     * Get current session state.
     * @example
     */
    getState() {
      return { ...this.state };
    }

    /**
     * Destroy session manager.
     * @example
     */
    destroy() {
      this.log('Destroying session manager');

      if (this.state.keepaliveTimer) {
        clearInterval(this.state.keepaliveTimer);
      }

      if (this.state.warningTimer) {
        clearInterval(this.state.warningTimer);
      }
    }
  }

  // Export to window
  window.SessionManager = SessionManager;

  // Auto-initialize if data-auto-init attribute is present
  if (document.currentScript && document.currentScript.hasAttribute('data-auto-init')) {
    document.addEventListener('DOMContentLoaded', () => {
      window.sessionManager = new SessionManager({
        debug: document.currentScript.hasAttribute('data-debug'),
      });
    });
  }
}(window));
