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

    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }

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

// Create Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'amexing-api' },
  exitOnError: false,
  transports: [
    // Console transport
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'development' ? consoleFormat : customFormat,
      handleExceptions: true,
      handleRejections: true,
    }),

    // Daily rotate file for all logs
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: process.env.LOG_RETENTION_DAYS || '30d',
      format: customFormat,
    }),

    // Daily rotate file for error logs
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: process.env.LOG_RETENTION_DAYS || '30d',
      level: 'error',
      format: customFormat,
    }),
  ],
});

// Add audit log transport if enabled
if (process.env.ENABLE_AUDIT_LOGGING === 'true') {
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

// PCI DSS compliant logging functions
logger.logSecurityEvent = (event, details) => {
  logger.info('SECURITY_EVENT', {
    event,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

logger.logAccessAttempt = (success, username, ip, reason = null) => {
  const logData = {
    type: 'ACCESS_ATTEMPT',
    success,
    username: username ? `${username.substring(0, 3)}***` : 'unknown',
    ip,
    timestamp: new Date().toISOString(),
  };

  if (reason) {
    logData.reason = reason;
  }

  if (success) {
    logger.info('Successful login', logData);
  } else {
    logger.warn('Failed login attempt', logData);
  }
};

logger.logDataAccess = (userId, resource, action, success) => {
  logger.info('DATA_ACCESS', {
    userId,
    resource,
    action,
    success,
    timestamp: new Date().toISOString(),
  });
};

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

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = logger;
