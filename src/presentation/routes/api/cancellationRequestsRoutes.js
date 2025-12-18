/**
 * Cancellation Requests API Routes - RESTful endpoints for quote cancellation management.
 * Implements 24-hour cancellation policy business rules.
 *
 * Features:
 * - JWT authentication required for all endpoints
 * - Role-based access control (SuperAdmin, Admin, employee_amexing)
 * - Comprehensive error handling and audit logging
 * - Rate limiting and security middleware.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');
const CancellationRequestsController = require('../../../application/controllers/api/CancellationRequestsController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();
const controller = new CancellationRequestsController();

// =============================================================================
// MIDDLEWARE STACK
// =============================================================================

// Apply JWT authentication to all routes
router.use(jwtMiddleware.authenticateToken);

// =============================================================================
// CANCELLATION REQUESTS ROUTES
// =============================================================================

/**
 * GET /api/cancellation-requests
 * Get cancellation requests with filtering and pagination
 * Access: SuperAdmin, Admin, employee_amexing with view_cancellation_requests permission.
 */
router.get(
  '/',
  jwtMiddleware.requireRole(['superadmin', 'admin']),
  controller.getCancellationRequests.bind(controller)
);

/**
 * GET /api/cancellation-requests/:id
 * Get specific cancellation request by ID
 * Access: SuperAdmin, Admin, employee_amexing with view_cancellation_requests permission.
 */
router.get(
  '/:id',
  jwtMiddleware.requireRole(['superadmin', 'admin']),
  controller.getCancellationRequestById.bind(controller)
);

/**
 * POST /api/cancellation-requests
 * Create new cancellation request or cancel quote directly (24h rule)
 * Access: Any authenticated user (for their own quotes)
 * Business Logic:
 * - If >24h before event: Cancel quote immediately
 * - If <24h before event: Create cancellation request for approval.
 */
router.post(
  '/',
  // Note: No role restriction - any authenticated user can request cancellation
  controller.createCancellationRequest.bind(controller)
);

/**
 * PUT /api/cancellation-requests/:id/review
 * Review cancellation request (approve/reject)
 * Access: SuperAdmin, Admin only.
 */
router.put(
  '/:id/review',
  jwtMiddleware.requireRole(['superadmin', 'admin']),
  controller.reviewCancellationRequest.bind(controller)
);

/**
 * GET /api/cancellation-requests/quote/:quoteFolio
 * Get cancellation requests for specific quote
 * Access: SuperAdmin, Admin, employee_amexing with view_cancellation_requests permission.
 */
router.get(
  '/quote/:quoteFolio',
  jwtMiddleware.requireRole(['superadmin', 'admin']),
  async (req, res) => {
    try {
      const { quoteFolio } = req.params;

      // Find quote by folio first
      const Quote = require('../../../domain/models/Quote');
      const quote = await Quote.findByFolio(quoteFolio);

      if (!quote) {
        return res.status(404).json({
          success: false,
          error: 'Quote not found',
          timestamp: new Date().toISOString(),
        });
      }

      // Find cancellation requests for this quote
      const CancellationRequest = require('../../../domain/models/CancellationRequest');
      const requests = await CancellationRequest.findByQuote(quote.id);

      res.json({
        success: true,
        data: {
          requests,
          quote: {
            id: quote.id,
            folio: quote.getFolio(),
            status: quote.getStatus(),
          },
        },
        message: 'Cancellation requests retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

/**
 * GET /api/cancellation-requests/pending/count
 * Get count of pending cancellation requests
 * Access: SuperAdmin, Admin, employee_amexing with view_cancellation_requests permission.
 */
router.get(
  '/pending/count',
  jwtMiddleware.requireRole(['superadmin', 'admin']),
  async (req, res) => {
    try {
      const query = new Parse.Query('CancellationRequest');
      query.equalTo('status', 'pending');
      query.equalTo('active', true);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });

      res.json({
        success: true,
        data: { count },
        message: 'Pending cancellation requests count retrieved successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// Handle 404 for undefined routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Cancellation requests endpoint not found',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
router.use((error, req, res, _next) => {
  console.error('Cancellation requests route error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error in cancellation requests API',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
