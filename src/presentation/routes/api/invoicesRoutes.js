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
const multer = require('multer');

const router = express.Router();
const InvoiceController = require('../../../application/controllers/api/InvoiceController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow XML and PDF files only
    const allowedMimes = ['application/xml', 'text/xml', 'application/pdf'];
    const allowedExts = ['.xml', '.pdf'];

    const isValidMime = allowedMimes.includes(file.mimetype);
    const isValidExt = allowedExts.some((ext) => file.originalname.toLowerCase().endsWith(ext));

    if (isValidMime || isValidExt) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos XML y PDF'), false);
    }
  },
});

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
 * @description GET /api/invoices/pending-count - Get count of pending invoices for badge display.
 * @access Admin, SuperAdmin
 * @returns {object} Response with pending invoices count.
 */
router.get(
  '/pending-count',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.getPendingCount(req, res)
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

/**
 * @description POST /api/invoices/upload-file - Upload XML/PDF file for invoice.
 * @access Admin, SuperAdmin
 * @param {string} invoiceId - Invoice ID (form data).
 * @param {string} fileType - File type ('xml' or 'pdf') (form data).
 * @param {File} file - File to upload (multipart/form-data).
 * @returns {object} Upload confirmation with file details.
 */
router.post(
  '/upload-file',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(6), // Admin (6) and SuperAdmin (7)
  upload.single('file'),
  (req, res) => invoiceController.uploadInvoiceFile(req, res)
);

/**
 * @description GET /api/invoices/download/:invoiceId/:fileType - Download invoice file (XML or PDF).
 * @access Department Manager, Admin, SuperAdmin
 * @param {string} invoiceId - Invoice ID.
 * @param {string} fileType - File type ('xml' or 'pdf').
 * @returns {File} Invoice file stream for download.
 */
router.get(
  '/download/:invoiceId/:fileType',
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => invoiceController.downloadInvoiceFile(req, res)
);

module.exports = router;
