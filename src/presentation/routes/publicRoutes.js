/**
 * PublicRoutes - Public routes without authentication.
 * Provides public access to shared resources (quotes, etc.).
 * No authentication middleware applied.
 * Security Measures:
 * - Rate limiting to prevent abuse.
 * - Audit logging for all access.
 * - Resource-specific access tokens (folio, shareToken).
 * - Input validation and sanitization.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const PublicQuoteController = require('../../application/controllers/PublicQuoteController');
const logger = require('../../infrastructure/logger');

const router = express.Router();

/**
 * Rate limiter for public routes.
 * Prevents abuse while allowing legitimate access.
 */
const publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Demasiadas solicitudes desde esta IP, por favor intente más tarde.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn('Rate limit exceeded for public route', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent'),
    });
    res.status(429).render('errors/429', {
      message: 'Demasiadas solicitudes. Por favor intente más tarde.',
    });
  },
});

// Apply rate limiting to all public routes
router.use(publicRateLimiter);

/**
 * Public quote view by folio.
 * GET /quotes/:folio.
 * @param {string} folio - Quote folio number (QTE-YYYY-NNNN).
 * @returns {HTML} Public quote view or error page.
 * @example
 * GET /quotes/QTE-2025-0004
 */
router.get('/quotes/:folio', PublicQuoteController.viewPublicQuote);

module.exports = router;
