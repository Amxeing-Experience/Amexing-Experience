/**
 * Health Check Module
 * Provides health check functionality for monitoring application and database status.
 * Includes database connectivity tests, system metrics, and comprehensive health reporting.
 * @module infrastructure/monitoring/healthCheck
 * @author Amexing Development Team
 * @version 1.0.0
 */

const { MongoClient } = require('mongodb');
const logger = require('../logger');

/**
 * Database connection timeout configuration (3 seconds).
 * @constant {number}
 */
const DB_TIMEOUT_MS = 3000;

/**
 * Retrieves database connection metrics for health monitoring.
 * Performs a direct MongoDB connection test with timeout controls to assess
 * database availability and response time.
 * @async
 * @returns {Promise<{connected: boolean, responseTime: number|null, error: string|null}>}
 * Database metrics object with connection status, response time, and error details.
 * @example
 * const { getDatabaseMetrics } = require('./healthCheck');
 *
 * const dbMetrics = await getDatabaseMetrics();
 * console.log('DB Connected:', dbMetrics.connected);
 * console.log('Response Time:', dbMetrics.responseTime, 'ms');
 */
const getDatabaseMetrics = async () => {
  const dbMetrics = {
    connected: false,
    responseTime: null,
    error: null,
  };

  try {
    const startTime = Date.now();
    const connectionString = process.env.DATABASE_URI || 'mongodb://localhost:27017/amexingdb';

    const client = new MongoClient(connectionString, {
      connectTimeoutMS: DB_TIMEOUT_MS,
      serverSelectionTimeoutMS: DB_TIMEOUT_MS,
      maxPoolSize: 1, // Minimal pool for health checks
    });

    await client.connect();
    await client.db().admin().ping();

    const responseTime = Date.now() - startTime;
    dbMetrics.connected = true;
    dbMetrics.responseTime = responseTime;

    await client.close();
  } catch (error) {
    dbMetrics.connected = false;
    dbMetrics.error = error.message;
    logger.debug('Database health check failed:', error.message);
  }

  return dbMetrics;
};

/**
 * Retrieves comprehensive system metrics for monitoring.
 * Collects Node.js process information, memory usage, CPU statistics,
 * and platform details for system monitoring and performance analysis.
 * @returns {{uptime: number, platform: string, nodeVersion: string, pid: number, environment: string, memory: object, cpu: object}}
 * System metrics object containing uptime, memory, CPU, and platform information.
 * @example
 * const { getSystemMetrics } = require('./healthCheck');
 *
 * const metrics = getSystemMetrics();
 * console.log('Uptime:', metrics.uptime, 'seconds');
 * console.log('Memory Used:', metrics.memory.heapUsed, 'MB');
 */
const getSystemMetrics = () => ({
  uptime: process.uptime(),
  platform: process.platform,
  nodeVersion: process.version,
  pid: process.pid,
  environment: process.env.NODE_ENV,
  memory: {
    rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    external: Math.round(process.memoryUsage().external / 1024 / 1024),
    arrayBuffers: Math.round(process.memoryUsage().arrayBuffers / 1024 / 1024),
  },
  cpu: {
    usage: process.cpuUsage(),
    loadAverage:
      process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
  },
});

/**
 * Generates complete health check response.
 * Combines database metrics and system metrics into a comprehensive health report.
 * @async
 * @returns {Promise<object>} Complete health check object with status, database, and system info.
 * @example
 * const { getHealthCheck } = require('./healthCheck');
 *
 * app.get('/health', async (req, res) => {
 *   const health = await getHealthCheck();
 *   const statusCode = health.status === 'healthy' ? 200 : 503;
 *   res.status(statusCode).json(health);
 * });
 */
const getHealthCheck = async () => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    database: {
      connected: false,
      responseTime: null,
      error: null,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
    },
  };

  try {
    const dbMetrics = await getDatabaseMetrics();
    healthCheck.database = dbMetrics;

    if (dbMetrics.connected) {
      logger.debug(
        `Database health check passed in ${dbMetrics.responseTime}ms`
      );
    } else if (process.env.NODE_ENV === 'production') {
      healthCheck.status = 'unhealthy';
    } else {
      healthCheck.status = 'healthy (db unavailable)';
    }
  } catch (error) {
    healthCheck.database.error = error.message;
    logger.warn(
      'Database health check failed (continuing gracefully):',
      error.message
    );

    if (process.env.NODE_ENV === 'production') {
      healthCheck.status = 'unhealthy';
    } else {
      healthCheck.status = 'healthy (db unavailable)';
    }
  }

  return healthCheck;
};

/**
 * Generates comprehensive metrics for monitoring.
 * Combines system metrics, database metrics, and application information.
 * @async
 * @param {object} [parseServer] - Optional Parse Server instance for metrics.
 * @returns {Promise<object>} Complete metrics object.
 * @example
 * const { getMetrics } = require('./healthCheck');
 *
 * app.get('/metrics', async (req, res) => {
 *   const metrics = await getMetrics(parseServer);
 *   res.json(metrics);
 * });
 */
const getMetrics = async (parseServer = null) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    system: getSystemMetrics(),
    application: {
      version: process.env.npm_package_version || '1.0.0',
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    database: await getDatabaseMetrics(),
  };

  // Add Parse Server specific metrics if available
  if (parseServer && parseServer.adapter) {
    metrics.parseServer = {
      version: require('parse-server/package.json').version,
      appId: process.env.PARSE_APP_ID,
      serverURL: process.env.PARSE_SERVER_URL,
    };
  }

  return metrics;
};

module.exports = {
  getDatabaseMetrics,
  getSystemMetrics,
  getHealthCheck,
  getMetrics,
};
