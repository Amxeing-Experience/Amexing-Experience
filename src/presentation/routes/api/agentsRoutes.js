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
// Full-number reveal: admin/superadmin only, audited by the vault.
router.post('/:agentId/passports/:id/reveal', requireAdmin, writeOperationsLimiter, clientProfileController.revealPassportNumber);

router.get('/:agentId/trips', requireAdmin, clientProfileController.getTrips);

module.exports = router;
