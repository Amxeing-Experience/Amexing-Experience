/**
 * Invoice API Routes.
 *
 * Handles invoice request management endpoints for administrators.
 * Only admins can view and process invoice requests.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');

const router = express.Router();
const InvoiceController = require('../../../application/controllers/api/InvoiceController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Initialize controller
const invoiceController = new InvoiceController();

// Routes

/**
 * @description GET /api/invoices - Get pending invoice requests (for admins).
 * @access Admin, SuperAdmin
 * @returns {object} DataTables compatible response with pending invoices.
 */
router.get(
  '/',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.getPendingInvoices(req, res)
);

/**
 * @description GET /api/invoices/:id - Get invoice request details.
 * @access Admin, SuperAdmin
 * @param {string} id - Invoice request ID.
 * @returns {object} Detailed invoice request information.
 */
router.get(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.getInvoiceDetails(req, res)
);

/**
 * @description PUT /api/invoices/:id/complete - Complete an invoice request (mark as processed).
 * @access Admin, SuperAdmin
 * @param {string} id - Invoice request ID.
 * @param {string} invoiceNumber - Generated invoice number (request body).
 * @param {string} [notes] - Optional processing notes (request body).
 * @returns {object} Success confirmation with updated invoice data.
 */
router.put(
  '/:id/complete',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.completeInvoice(req, res)
);

/**
 * @description DELETE /api/invoices/:id - Cancel an invoice request.
 * @access Admin, SuperAdmin
 * @param {string} id - Invoice request ID.
 * @param {string} [reason] - Optional cancellation reason (request body).
 * @returns {object} Success confirmation.
 */
router.delete(
  '/:id',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.cancelInvoice(req, res)
);

module.exports = router;
