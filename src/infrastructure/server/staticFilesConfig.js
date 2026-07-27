/**
 * Static Files Configuration
 * Centralized static file serving configuration for Express application.
 * Handles all static asset routes with environment-specific optimizations.
 * @module infrastructure/server/staticFilesConfig
 * @author Amexing Development Team
 * @version 1.0.0
 */

const express = require('express');
const path = require('path');

/**
 * Static file routes configuration.
 * Each route specifies the URL path and corresponding filesystem directory.
 * @type {Array<{route: string, directory: string}>}
 */
const staticRoutes = [
  {
    route: '/public',
    directory: path.join(__dirname, '..', '..', 'presentation', 'public'),
  },
  {
    route: '/',
    directory: path.join(__dirname, '..', '..', '..', 'public'),
  },
  {
    // Motor de cálculo isomórfico: mismo archivo que usa el backend
    // (src/domain/pricing/pricingEngine.js), servido al navegador como
    // /shared/pricing/pricingEngine.js. Evita duplicar el archivo (sin drift).
    route: '/shared/pricing',
    directory: path.join(__dirname, '..', '..', 'domain', 'pricing'),
  },
  {
    // Helpers isomórficos del desglose de pagos compartidos por las 3 plantillas
    // booking-detail.ejs (admin/department_manager/client): mismo archivo que usa Jest,
    // servido al navegador como /shared/payments/paymentBreakdownHelpers.js (sin drift).
    route: '/shared/payments',
    directory: path.join(__dirname, '..', '..', 'presentation', 'views', 'dashboards', 'shared'),
  },
  {
    route: '/dashboard',
    directory: path.join(__dirname, '..', '..', '..', 'public', 'dashboard'),
  },
  {
    route: '/landing',
    directory: path.join(__dirname, '..', '..', '..', 'public', 'landing'),
  },
  {
    route: '/common',
    directory: path.join(__dirname, '..', '..', '..', 'public', 'common'),
  },
  {
    route: '/flexy-bootstrap-lite-1.0.0',
    directory: path.join(__dirname, '..', '..', '..', 'public', 'flexy-bootstrap-lite-1.0.0'),
  },
];

/**
 * Gets cache duration based on environment.
 * Production: 1 day cache, Development: no cache for hot reloading.
 * @returns {string|number} Cache duration ('1d' for production, 0 for development).
 * @example
 * const duration = getCacheDuration();
 * // Returns '1d' in production, 0 in development
 */
const getCacheDuration = () => (process.env.NODE_ENV === 'production' ? '1d' : 0);

/**
 * Configures all static file middleware for the Express application.
 * Iterates through static routes and applies express.static middleware
 * with environment-appropriate caching and proper MIME type handling.
 * @param {express.Application} app - Express application instance.
 * @returns {void}
 * @example
 * const express = require('express');
 * const { configureStaticFiles } = require('./staticFilesConfig');
 *
 * const app = express();
 * configureStaticFiles(app);
 */
const configureStaticFiles = (app) => {
  const maxAge = getCacheDuration();

  staticRoutes.forEach(({ route, directory }) => {
    app.use(route, express.static(directory, {
      maxAge,
      setHeaders: (res, filePath) => {
        // Set proper MIME types to prevent X-Content-Type-Options: nosniff issues
        if (filePath.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json');
        } else if (filePath.endsWith('.woff')) {
          res.setHeader('Content-Type', 'font/woff');
        } else if (filePath.endsWith('.woff2')) {
          res.setHeader('Content-Type', 'font/woff2');
        } else if (filePath.endsWith('.ttf')) {
          res.setHeader('Content-Type', 'font/ttf');
        } else if (filePath.endsWith('.eot')) {
          res.setHeader('Content-Type', 'application/vnd.ms-fontobject');
        } else if (filePath.endsWith('.svg')) {
          res.setHeader('Content-Type', 'image/svg+xml');
        }
      },
    }));
  });
};

module.exports = {
  configureStaticFiles,
  staticRoutes,
  getCacheDuration,
};
