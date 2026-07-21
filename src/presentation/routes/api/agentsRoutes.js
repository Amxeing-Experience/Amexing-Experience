/**
 * Agents API Routes - profile sub-resources (passports, addresses, travel preferences) for an
 * AmexingUser (an agency's agent). Mirrors the client profile routes but resolves the owner as
 * an AmexingUser instead of a Client (see ClientProfileController.resolveOwner). Acceso: admin/
 * superadmin, el propio usuario (autoservicio), o el dueño (DM/agente) del cliente
 * (requireAdminOrSelfOrOwner).
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

// Acceso: admin/superadmin, el propio usuario (autoservicio), o el DUEÑO del cliente
// (department_manager cuya agencia = organizationId del cliente, o el agente que lo creó).
/**
 * @param req
 * @param res
 * @param next
 * @example
 */
async function requireAdminOrSelfOrOwner(req, res, next) {
  const { user, userRole } = req;
  if (!user || !userRole) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (['superadmin', 'admin'].includes(userRole)) {
    return next();
  }
  const { agentId } = req.params;
  // Autoservicio: gestionar el propio perfil.
  if (agentId && user.id && agentId === user.id) {
    return next();
  }
  // Dueño de agencia: DM (organizationId del cliente === su id) o agente (createdBy === su id).
  if (agentId && ['department_manager', 'client'].includes(userRole)) {
    try {
      const Parse = require('parse/node');
      const target = await new Parse.Query('AmexingUser')
        .include('createdBy')
        .get(agentId, { useMasterKey: true })
        .catch(() => null);
      if (target) {
        if (userRole === 'client') {
          const createdBy = target.get('createdBy');
          if (createdBy && createdBy.id === user.id) return next();
        } else if (target.get('organizationId') === user.id) {
          return next();
        }
      }
    } catch (ownerErr) {
      // cae al 403
    }
  }
  return res.status(403).json({ success: false, error: 'No autorizado' });
}

router.use(jwtMiddleware.authenticateToken);

// ---- Agent profile sub-resources: addresses, travel preferences, passports ----

router.get('/:agentId/addresses', requireAdminOrSelfOrOwner, clientProfileController.getAddresses);
router.post('/:agentId/addresses', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.createAddress);
router.put('/:agentId/addresses/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.updateAddress);
router.delete('/:agentId/addresses/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.deleteAddress);

router.get('/:agentId/travel-preferences', requireAdminOrSelfOrOwner, clientProfileController.getTravelPreferences);
// PUT (no id) replaces the whole preference set in one save (single-form modal).
router.put('/:agentId/travel-preferences', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.saveTravelPreferences);
router.post('/:agentId/travel-preferences', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.createTravelPreference);
router.put('/:agentId/travel-preferences/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.updateTravelPreference);
router.delete('/:agentId/travel-preferences/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.deleteTravelPreference);

router.get('/:agentId/loyalty-programs', requireAdminOrSelfOrOwner, clientProfileController.getLoyaltyPrograms);
router.put('/:agentId/loyalty-programs', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);
router.post('/:agentId/loyalty-programs', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.saveLoyaltyPrograms);

router.get('/:agentId/passports', requireAdminOrSelfOrOwner, clientProfileController.getPassports);
router.post('/:agentId/passports', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.createPassport);
router.put('/:agentId/passports/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.updatePassport);
router.delete('/:agentId/passports/:id', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.deletePassport);
// Document upload (image or PDF) via the S3 pipeline; multer parses the multipart body.
router.post('/:agentId/passports/:id/document', requireAdminOrSelfOrOwner, writeOperationsLimiter, handlePassportUpload, clientProfileController.uploadPassportDocument);
// Full-number reveal: admin/superadmin only, audited by the vault. NOT under the write budget —
// revealing is a read; sharing writeOperationsLimiter let eye-clicks + saves exhaust the
// 50/15min budget and 429 every later action ("deja de jalar"). Audit (vault) is the control here.
router.post('/:agentId/passports/:id/reveal', requireAdminOrSelfOrOwner, clientProfileController.revealPassportNumber);

// Agent documents (base64-in-JSON upload — multipart is blocked by the WAF, HTTP 426).
router.get('/:agentId/documents', requireAdminOrSelfOrOwner, clientProfileController.getDocuments);
router.post('/:agentId/documents', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.uploadDocument);
router.put('/:agentId/documents/:docId', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.updateDocument);
router.delete('/:agentId/documents/:docId', requireAdminOrSelfOrOwner, writeOperationsLimiter, clientProfileController.deleteDocument);

router.get('/:agentId/trips', requireAdminOrSelfOrOwner, clientProfileController.getTrips);

module.exports = router;
