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
    directory: path.join(
      __dirname,
      '..',
      '..',
      '..',
      'public',
      'flexy-bootstrap-lite-1.0.0'
    ),
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
 * with environment-appropriate caching.
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
    app.use(route, express.static(directory, { maxAge }));
  });
};

module.exports = {
  configureStaticFiles,
  staticRoutes,
  getCacheDuration,
};
