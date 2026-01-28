/**
 * Form API Routes
 * Endpoints for form rendering, submission, and management.
 *
 * Created by Denisse Maldonado.
 */

const express = require('express');

const router = express.Router();
const FormController = require('../../../application/controllers/api/FormController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

/**
 * Mixed authentication middleware for form builder.
 * Supports both JWT token authentication and session-based authentication.
 * Checks for JWT token in cookies first, then falls back to session authentication.
 * @function mixedAuth
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>} Calls next() on success or returns 401 on failure.
 * @author Denisse Maldonado
 * @since 1.0.0
 * @example
 */
const mixedAuth = async (req, res, next) => {
  console.log('🔍 MIXEDAUTH: Middleware called for:', req.method, req.originalUrl);

  // Check if there's an accessToken cookie (JWT)
  if (req.cookies?.accessToken) {
    console.log('Using JWT authentication for form API');
    return jwtMiddleware.authenticateToken(req, res, next);
  }

  console.log('Using session authentication for form API');
  console.log('Session ID:', req.sessionID);
  console.log('Session user:', req.session?.user ? 'exists' : 'null');
  console.log('Cookies:', Object.keys(req.cookies || {}));

  // Try session authentication directly
  if (req.session?.user) {
    console.log('Found user in session:', req.session.user.username || req.session.user.id);
    req.user = {
      id: req.session.user.id || req.session.user.objectId || 'unknown',
      username: req.session.user.username || 'unknown',
      role: req.session.user.role || 'guest',
      name: req.session.user.name || req.session.user.username || 'Unknown User',
      email: req.session.user.email,
      clientId: req.session.user.clientId,
      organizationId: req.session.user.organizationId,
    };
    console.log('User authenticated via session:', req.user.username || req.user.id);
    return next();
  }

  // If no JWT and no session, return 401
  console.log('No authentication found - returning 401');
  return res.status(401).json({
    success: false,
    error: 'Authentication required',
  });
};

/**
 * Mixed role checking middleware factory.
 * Creates middleware that checks if user has required roles.
 * Supports both JWT and session-based authentication role checking.
 * @function mixedRequireRole
 * @param {string|Array<string>} roles - Required role(s) to access the endpoint.
 * @returns {Function} Express middleware function that validates user roles.
 * @author Denisse Maldonado
 * @since 1.0.0
 * @example
 * // Single role
 * router.post('/admin', mixedAuth, mixedRequireRole('admin'), handler);
 *
 * // Multiple roles
 * router.post('/manage', mixedAuth, mixedRequireRole(['admin', 'superadmin']), handler);
 */
const mixedRequireRole = (roles) => (req, res, next) => {
  // Check if there's an accessToken cookie (JWT)
  if (req.cookies?.accessToken) {
    return jwtMiddleware.requireRole(roles)(req, res, next);
  }

  // Use session-based role check
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
  }

  const userRole = req.user.role;
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied',
    });
  }

  next();
};

// Public endpoints (authentication optional for some forms)
router.get('/templates', FormController.getTemplates.bind(FormController));
router.get('/:id', FormController.getForm.bind(FormController));
router.get('/:id/render', FormController.renderForm.bind(FormController));

// Protected endpoints (require authentication - JWT or session)
// Form submission
router.post('/:id/submit', mixedAuth, FormController.submitForm.bind(FormController));
router.post('/validate-field', mixedAuth, FormController.validateField.bind(FormController));

// Admin endpoints (require authentication and admin role)
router.post(
  '/save-template',
  mixedAuth,
  mixedRequireRole(['admin', 'superadmin']),
  FormController.saveTemplate.bind(FormController)
);
router.get(
  '/:id/submissions',
  mixedAuth,
  mixedRequireRole(['admin', 'superadmin']),
  FormController.getSubmissions.bind(FormController)
);
router.get(
  '/:id/export',
  mixedAuth,
  mixedRequireRole(['admin', 'superadmin']),
  FormController.exportData.bind(FormController)
);
router.delete(
  '/submissions/:id',
  mixedAuth,
  mixedRequireRole(['admin', 'superadmin']),
  FormController.deleteSubmission.bind(FormController)
);

module.exports = router;
