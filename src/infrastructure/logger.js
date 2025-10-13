/**
 * Logger Infrastructure - Comprehensive logging system for Amexing platform.
 * Provides centralized logging with Winston, daily rotation, PCI DSS compliance,
 * and specialized security event logging for comprehensive audit trails.
 *
 * This logging system implements enterprise-grade logging with multiple transports,
 * structured logging, automatic rotation, and PCI DSS compliant security event
 * tracking for compliance and security monitoring requirements.
 *
 * Features:
 * - Winston-based structured logging with custom formatters
 * - Daily log rotation with compression and retention policies
 * - Separate error and audit log streams
 * - PCI DSS compliant security event logging
 * - Development-friendly console output with colors
 * - Automatic directory creation and file management
 * - HTTP request logging integration with Morgan
 * - Uncaught exception and rejection handling
 * - Configurable log levels and retention periods
 * - JSON audit logs for compliance reporting
 * - Environment-specific transport configuration
 * - Test environment optimization (silent mode)
 * - Fallback transport validation to prevent memory issues.
 *
 * Environment Configuration:
 * - **Development**: Console output with colors + file rotation
 * - **Production**: Structured console output + file rotation + audit logs
 * - **Test**: Silent console transport (no file creation).
 *
 * Transport Behavior by Environment:.
 * ```
 * Development (NODE_ENV=development):
 * ✓ Console: Active with colors
 * ✓ Application logs: Daily rotation
 * ✓ Error logs: Daily rotation
 * ✓ Audit logs: If ENABLE_AUDIT_LOGGING=true
 *
 * Production (NODE_ENV=production):
 * ✓ Console: Active with structured format
 * ✓ Application logs: Daily rotation
 * ✓ Error logs: Daily rotation
 * ✓ Audit logs: If ENABLE_AUDIT_LOGGING=true
 *
 * Test (NODE_ENV=test):
 * ✓ Console: Silent (no output)
 * ✗ File transports: Disabled
 * ✗ Audit logs: Disabled
 * ```
 *
 * Configuration Variables:
 * - LOG_LEVEL: Logging level (debug, info, warn, error) - default: 'info'
 * - LOG_DIR: Directory for log files - default: 'logs'
 * - ENABLE_AUDIT_LOGGING: Enable audit log transport - default: false
 * - AUDIT_LOG_RETENTION_DAYS: Audit log retention period - default: '365d'
 * - LOG_RETENTION_DAYS: Standard log retention period - default: '30d'
 * - SILENT_LOGGER: Force complete silence in test - default: false.
 * @file Infrastructure logging system for Amexing platform.
 * @author Amexing Development Team
 * @version 2.1.0
 * @since 1.0.0
 * @example
 * // Basic logging
 * const logger = require('./infrastructure/logger');
 * logger.info('Application started', { port: 3000, env: 'production' });
 * logger.error('Database connection failed', { error: dbError });
 *
 * // Security event logging
 * logger.logSecurityEvent('FAILED_LOGIN', {
 *   username: 'user@example.com',
 *   ip: '192.168.1.1',
 *   attempts: 3
 * });
 *
 * // Access attempt logging
 * logger.logAccessAttempt(false, 'john.doe', '10.0.0.1', 'Invalid password');
 * logger.logAccessAttempt(true, 'jane.smith', '10.0.0.2');
 *
 * // Data access auditing
 * logger.logDataAccess('user123', 'customer_data', 'READ', true);
 * logger.logSystemChange('admin456', 'user_permissions', 'read', 'read,write');
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logDir = process.env.LOG_DIR || 'logs';
// eslint-disable-next-line security/detect-non-literal-fs-filename
if (!fs.existsSync(logDir)) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({
    level, message, timestamp, stack, ...metadata
  }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Append metadata if present
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }

    // Append stack trace if error
    if (stack) {
      msg += `\n${stack}`;
    }

    return msg;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.simple(),
  winston.format.printf(
    ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`
  )
);

// Determine if we're in test environment
const isTestEnvironment = process.env.NODE_ENV === 'test';
const isDevelopmentEnvironment = process.env.NODE_ENV === 'development';

// Build transports array based on environment
const transports = [];

// Console transport - always add, but silence in test environment
transports.push(
  new winston.transports.Console({
    format: isDevelopmentEnvironment ? consoleFormat : customFormat,
    handleExceptions: true,
    handleRejections: true,
    silent: isTestEnvironment, // Silence console output in test environment
  })
);

// File transports - skip in test environment to avoid file creation during tests
if (!isTestEnvironment) {
  // Daily rotate file for all logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: process.env.LOG_RETENTION_DAYS || '30d',
      format: customFormat,
    })
  );

  // Daily rotate file for error logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: process.env.LOG_RETENTION_DAYS || '30d',
      level: 'error',
      format: customFormat,
    })
  );
}

// Create Winston logger with environment-specific configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'amexing-api' },
  exitOnError: false,
  transports,
  // Silence all logging in test environment if needed
  silent: isTestEnvironment && process.env.SILENT_LOGGER === 'true',
});

// Validate transports configuration
if (transports.length === 0) {
  console.warn(
    '[Logger] Warning: No transports configured. Adding fallback console transport to prevent memory issues.'
  );
  transports.push(
    new winston.transports.Console({
      format: customFormat,
      silent: true, // Silent fallback to avoid unwanted output
    })
  );
}

// Enable audit logging if configured (skip in test environment)
if (process.env.ENABLE_AUDIT_LOGGING === 'true' && !isTestEnvironment) {
  logger.add(
    new DailyRotateFile({
      filename: path.join(logDir, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '50m',
      maxFiles: process.env.AUDIT_LOG_RETENTION_DAYS || '365d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      auditMode: true,
    })
  );
}

/**
 * Logs security events for PCI DSS compliance and security monitoring.
 * Creates structured security event logs with standardized format for
 * compliance reporting, security analysis, and incident investigation.
 * @function logSecurityEvent
 * @param {string} event - Security event type (e.g., 'FAILED_LOGIN', 'ACCOUNT_LOCKED', 'PERMISSION_DENIED').
 * @param {object} details - Additional event details and context.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Log failed login attempt
 * logger.logSecurityEvent('FAILED_LOGIN', {
 *   username: 'user@example.com',
 *   ip: '192.168.1.100',
 *   userAgent: 'Mozilla/5.0...',
 *   attempts: 3
 * });
 *
 * // Log account lockout
 * logger.logSecurityEvent('ACCOUNT_LOCKED', {
 *   userId: 'user123',
 *   reason: 'Too many failed attempts',
 *   lockoutDuration: '30 minutes'
 * });
 *
 * // Log permission violation
 * logger.logSecurityEvent('PERMISSION_DENIED', {
 *   userId: 'user456',
 *   resource: '/api/admin/users',
 *   action: 'DELETE',
 *   requiredRole: 'admin'
 * });
 * @returns {*} - Operation result.
 */
logger.logSecurityEvent = (event, details) => {
  logger.info('SECURITY_EVENT', {
    event,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Logs authentication access attempts with privacy protection and PCI DSS compliance.
 * Tracks both successful and failed login attempts with partial username masking
 * for security while maintaining audit trail requirements.
 * @function logAccessAttempt
 * @param {boolean} success - Whether the access attempt was successful.
 * @param {string} username - Username attempting access (will be partially masked).
 * @param {string} ip - IP address of the access attempt.
 * @param {string|null} [reason] - Reason for failure (if applicable).
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Log successful login
 * logger.logAccessAttempt(true, 'john.doe@company.com', '192.168.1.10');
 *
 * // Log failed login with reason
 * logger.logAccessAttempt(false, 'user@example.com', '10.0.0.1', 'Invalid password');
 *
 * // Log failed login with account lockout
 * logger.logAccessAttempt(false, 'admin@domain.com', '172.16.0.5', 'Account locked');
 * @returns {*} - Operation result.
 */
logger.logAccessAttempt = (success, username, ip, reason = null) => {
  const logData = {
    type: 'ACCESS_ATTEMPT',
    success,
    username: username ? `${username.substring(0, 3)}***` : 'unknown',
    ip,
    timestamp: new Date().toISOString(),
  };

  // Include failure reason if provided
  if (reason) {
    logData.reason = reason;
  }

  // Log success or failure with appropriate level
  if (success) {
    logger.info('Successful login', logData);
  } else {
    logger.warn('Failed login attempt', logData);
  }
};

/**
 * Logs data access events for compliance and audit requirements.
 * Tracks all data access operations including reads, writes, updates, and deletions
 * with user attribution for PCI DSS and regulatory compliance.
 * @function logDataAccess
 * @param {string} userId - Unique identifier of the user accessing the data.
 * @param {string} resource - Resource or data type being accessed (e.g., 'customer_data', 'payment_info').
 * @param {string} action - Action performed (READ, WRITE, UPDATE, DELETE).
 * @param {boolean} success - Whether the data access was successful.
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Log successful customer data read
 * logger.logDataAccess('user123', 'customer_data', 'READ', true);
 *
 * // Log failed attempt to access payment information
 * logger.logDataAccess('user456', 'payment_info', 'READ', false);
 *
 * // Log successful update to user profile
 * logger.logDataAccess('admin789', 'user_profile', 'UPDATE', true);
 * @returns {*} - Operation result.
 */
logger.logDataAccess = (userId, resource, action, success) => {
  logger.info('DATA_ACCESS', {
    userId,
    resource,
    action,
    success,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Logs system configuration and data changes for audit trails and compliance.
 * Tracks modifications to system settings, user permissions, and critical data
 * with privacy protection for sensitive values while maintaining audit requirements.
 * @function logSystemChange
 * @param {string} userId - Unique identifier of the user making the change.
 * @param {string} change - Description of what was changed (e.g., 'user_permissions', 'system_config').
 * @param {string|null} oldValue - Previous value (will be masked with *** for privacy).
 * @param {string|null} newValue - New value (will be masked with *** for privacy).
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Log permission change
 * logger.logSystemChange('admin123', 'user_permissions', 'read', 'read,write,delete');
 *
 * // Log configuration update
 * logger.logSystemChange('sysadmin456', 'max_login_attempts', '3', '5');
 *
 * // Log user role change
 * logger.logSystemChange('hr789', 'user_role', 'employee', 'manager');
 * @returns {*} - Operation result.
 */
logger.logSystemChange = (userId, change, oldValue, newValue) => {
  logger.info('SYSTEM_CHANGE', {
    userId,
    change,
    oldValue: oldValue ? '***' : null,
    newValue: newValue ? '***' : null,
    timestamp: new Date().toISOString(),
  });
};

// Stream for Morgan HTTP logger
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

// NOTE: Global error handlers are registered in src/index.js
// to avoid duplicate event listeners and ensure proper graceful shutdown.
// This keeps the logger module focused on logging functionality only.

module.exports = logger;
