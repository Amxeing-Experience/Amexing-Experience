/**
 * Agents API Routes - profile sub-resources (passports, addresses, travel preferences) for an
 * AmexingUser (an agency's agent). Mirrors the client profile routes but resolves the owner as
 * an AmexingUser instead of a Client (see ClientProfileController.resolveOwner). Acceso: admin/
 * superadmin, o el propio usuario gestionando SU perfil (autoservicio, requireAdminOrSelf).
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

// Admin/superadmin, O el propio usuario gestionando SU perfil (:agentId === su id) — autoservicio.
/**
 * @param req
 * @param res
 * @param next
 * @example
 */
function requireAdminOrSelf(req, res, next) {
  const { user, userRole } = req;
  if (!user || !userRole) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (['superadmin', 'admin'].includes(userRole)) {
    return next();
  }
  // Autoservicio: cualquier usuario autenticado puede gestionar su propio perfil.
  if (req.params.agentId && user.id && req.params.agentId === user.id) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'No autorizado' });
}

router.use(jwtMiddleware.authenticateToken);

// ---- Agent profile sub-resources: addresses, travel preferences, passports ----

router.get('/:agentId/addresses', requireAdminOrSelf, clientProfileController.getAddresses);
router.post('/:agentId/addresses', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.createAddress);
router.put('/:agentId/addresses/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.updateAddress);
router.delete('/:agentId/addresses/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.deleteAddress);

router.get('/:agentId/travel-preferences', requireAdminOrSelf, clientProfileController.getTravelPreferences);
// PUT (no id) replaces the whole preference set in one save (single-form modal).
router.put('/:agentId/travel-preferences', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.saveTravelPreferences);
router.post('/:agentId/travel-preferences', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.createTravelPreference);
router.put('/:agentId/travel-preferences/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.updateTravelPreference);
router.delete('/:agentId/travel-preferences/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.deleteTravelPreference);

router.get('/:agentId/loyalty-programs', requireAdminOrSelf, clientProfileController.getLoyaltyPrograms);
router.put('/:agentId/loyalty-programs', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);
router.post('/:agentId/loyalty-programs', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);

router.get('/:agentId/passports', requireAdminOrSelf, clientProfileController.getPassports);
router.post('/:agentId/passports', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.createPassport);
router.put('/:agentId/passports/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.updatePassport);
router.delete('/:agentId/passports/:id', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.deletePassport);
// Document upload (image or PDF) via the S3 pipeline; multer parses the multipart body.
router.post('/:agentId/passports/:id/document', requireAdminOrSelf, writeOperationsLimiter, handlePassportUpload, clientProfileController.uploadPassportDocument);
// Full-number reveal: admin/superadmin only, audited by the vault. NOT under the write budget —
// revealing is a read; sharing writeOperationsLimiter let eye-clicks + saves exhaust the
// 50/15min budget and 429 every later action ("deja de jalar"). Audit (vault) is the control here.
router.post('/:agentId/passports/:id/reveal', requireAdminOrSelf, clientProfileController.revealPassportNumber);

// Agent documents (base64-in-JSON upload — multipart is blocked by the WAF, HTTP 426).
router.get('/:agentId/documents', requireAdminOrSelf, clientProfileController.getDocuments);
router.post('/:agentId/documents', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.uploadDocument);
router.put('/:agentId/documents/:docId', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.updateDocument);
router.delete('/:agentId/documents/:docId', requireAdminOrSelf, writeOperationsLimiter, clientProfileController.deleteDocument);

router.get('/:agentId/trips', requireAdminOrSelf, clientProfileController.getTrips);

module.exports = router;
