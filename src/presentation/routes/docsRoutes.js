/**
 * Documentation Routes.
 *
 * Provides documentation index page and related endpoints.
 * API documentation (Redocly) is configured in src/infrastructure/docs/redoclyServer.js.
 * @module presentation/routes/docsRoutes
 * @author Amexing Development Team
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // Documentation routes are automatically configured via Express
 * app.use('/', docsRoutes);
 */

const express = require('express');

const router = express.Router();

/**
 * Documentation index page.
 * Shows links to various documentation resources.
 *
 * Route: GET /docs.
 */
router.get('/docs', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';

  res.render('docs/index', {
    title: 'AmexingWeb Documentation',
    apiDocsUrl: isProduction ? null : '/api-docs',
    specJsonUrl: isProduction ? null : '/api-docs.json',
    isProduction,
  });
});

module.exports = router;
