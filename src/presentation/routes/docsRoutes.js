/**
 * Documentation Routes
 * API documentation endpoints using Swagger UI.
 * @example
 * // Usage example
 * const result = await require({ 'express': 'example' });
 * // Returns: operation result
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Load OpenAPI specification
const swaggerDocument = yaml.load(
  fs.readFileSync(
    path.join(__dirname, '../../../docs/api/openapi.yaml'),
    'utf8'
  )
);

// Swagger UI options
const swaggerOptions = {
  explorer: true,
  swaggerOptions: {
    docExpansion: 'none',
    filter: true,
    showRequestHeaders: true,
    showCommonExtensions: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    requestInterceptor: (req) => {
      // Add default headers
      req.headers['Content-Type'] = 'application/json';
      return req;
    },
  },
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 50px 0; }
    .swagger-ui .scheme-container { background: #fafafa; padding: 30px 0; }
    .swagger-ui .info .title { color: #3b4151; }
  `,
  customSiteTitle: 'AmexingWeb API Documentation',
  customfavIcon: '/public/images/favicon.ico',
};

// API Documentation endpoint
router.use('/api-docs', swaggerUi.serve);
router.get('/api-docs', swaggerUi.setup(swaggerDocument, swaggerOptions));

// JSON endpoint for the OpenAPI spec
router.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerDocument);
});

// YAML endpoint for the OpenAPI spec
router.get('/api-docs.yaml', (req, res) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile(path.join(__dirname, '../../../docs/api/openapi.yaml'));
});

// Redoc alternative documentation (if preferred)
router.get('/redoc', (req, res) => {
  const redocHTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>AmexingWeb API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url='/api-docs.json'></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

  res.send(redocHTML);
});

// Documentation index page
router.get('/docs', (req, res) => {
  res.render('docs/index', {
    title: 'AmexingWeb Documentation',
    apiDocsUrl: '/api-docs',
    redocUrl: '/redoc',
    specJsonUrl: '/api-docs.json',
    specYamlUrl: '/api-docs.yaml',
  });
});

module.exports = router;
