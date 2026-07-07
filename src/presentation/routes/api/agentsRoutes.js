/**
 * Agents API Routes - profile sub-resources (passports, addresses, travel preferences) for an
 * AmexingUser (an agency's agent). Mirrors the client profile routes but resolves the owner as
 * an AmexingUser instead of a Client (see ClientProfileController.resolveOwner). Admin/superadmin
 * only in this phase — agent self-service is a later phase.
 * @author Amexing Development Team
 * @version 1.0.0
 * @example
 * // router.use('/agents', agentsRoutes);
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const ClientProfileController = require('../../../application/controllers/api/ClientProfileController');

const router = express.Router();
const clientProfileController = new ClientProfileController();

// Run the passport document multer middleware and translate its errors (type/size) into 400s.
/**
 *
 * @param req
 * @param res
 * @param next
 * @example
 */
function handlePassportUpload(req, res, next) {
  ClientProfileController.documentUploadMiddleware()(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    return next();
  });
}

const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, error: 'Too many write operations, please try again later.' },
});

// Admin/superadmin only (Phase 1). Agent self-access is deferred to a later phase.
/**
 *
 * @param req
 * @param res
 * @param next
 * @example
 */
function requireAdmin(req, res, next) {
  const { user, userRole } = req;
  if (!user || !userRole) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!['superadmin', 'admin'].includes(userRole)) {
    return res.status(403).json({ success: false, error: 'No autorizado' });
  }
  return next();
}

router.use(jwtMiddleware.authenticateToken);

// ---- Agent profile sub-resources: addresses, travel preferences, passports ----

router.get('/:agentId/addresses', requireAdmin, clientProfileController.getAddresses);
router.post('/:agentId/addresses', requireAdmin, writeOperationsLimiter, clientProfileController.createAddress);
router.put('/:agentId/addresses/:id', requireAdmin, writeOperationsLimiter, clientProfileController.updateAddress);
router.delete('/:agentId/addresses/:id', requireAdmin, writeOperationsLimiter, clientProfileController.deleteAddress);

router.get('/:agentId/travel-preferences', requireAdmin, clientProfileController.getTravelPreferences);
// PUT (no id) replaces the whole preference set in one save (single-form modal).
router.put('/:agentId/travel-preferences', requireAdmin, writeOperationsLimiter, clientProfileController.saveTravelPreferences);
router.post('/:agentId/travel-preferences', requireAdmin, writeOperationsLimiter, clientProfileController.createTravelPreference);
router.put('/:agentId/travel-preferences/:id', requireAdmin, writeOperationsLimiter, clientProfileController.updateTravelPreference);
router.delete('/:agentId/travel-preferences/:id', requireAdmin, writeOperationsLimiter, clientProfileController.deleteTravelPreference);

router.get('/:agentId/loyalty-programs', requireAdmin, clientProfileController.getLoyaltyPrograms);
router.put('/:agentId/loyalty-programs', requireAdmin, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);
router.post('/:agentId/loyalty-programs', requireAdmin, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);

router.get('/:agentId/passports', requireAdmin, clientProfileController.getPassports);
router.post('/:agentId/passports', requireAdmin, writeOperationsLimiter, clientProfileController.createPassport);
router.put('/:agentId/passports/:id', requireAdmin, writeOperationsLimiter, clientProfileController.updatePassport);
router.delete('/:agentId/passports/:id', requireAdmin, writeOperationsLimiter, clientProfileController.deletePassport);
// Document upload (image or PDF) via the S3 pipeline; multer parses the multipart body.
router.post('/:agentId/passports/:id/document', requireAdmin, writeOperationsLimiter, handlePassportUpload, clientProfileController.uploadPassportDocument);
// Full-number reveal: admin/superadmin only, audited by the vault. NOT under the write budget —
// revealing is a read; sharing writeOperationsLimiter let eye-clicks + saves exhaust the
// 50/15min budget and 429 every later action ("deja de jalar"). Audit (vault) is the control here.
router.post('/:agentId/passports/:id/reveal', requireAdmin, clientProfileController.revealPassportNumber);

// Agent documents (base64-in-JSON upload — multipart is blocked by the WAF, HTTP 426).
router.get('/:agentId/documents', requireAdmin, clientProfileController.getDocuments);
router.post('/:agentId/documents', requireAdmin, writeOperationsLimiter, clientProfileController.uploadDocument);
router.put('/:agentId/documents/:docId', requireAdmin, writeOperationsLimiter, clientProfileController.updateDocument);
router.delete('/:agentId/documents/:docId', requireAdmin, writeOperationsLimiter, clientProfileController.deleteDocument);

router.get('/:agentId/trips', requireAdmin, clientProfileController.getTrips);

module.exports = router;
