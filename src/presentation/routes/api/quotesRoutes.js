/**
 * Quotes API Routes
 * Follows servicesRoutes.js pattern.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const QuoteController = require('../../../application/controllers/api/QuoteController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

const router = express.Router();

/**
 * Rate limiter for read operations (GET)
 * 100 requests per 15 minutes per IP.
 */
const readOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for write operations (POST, PUT, DELETE)
 * 30 requests per 15 minutes per IP.
 */
const writeOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per windowMs
  message: {
    success: false,
    error: 'Demasiadas solicitudes, por favor intente nuevamente más tarde',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/quotes - Get quotes with DataTables server-side processing.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Query Parameters (DataTables format):
 * - draw: Draw counter
 * - start: Starting record number
 * - length: Number of records to return
 * - search[value]: Search term
 * - order[0][column]: Column index to sort
 * - order[0][dir]: Sort direction (asc/desc).
 * @returns {object} DataTables response with quotes data.
 * @example
 * // Response structure:
 * {
 *   draw: 1,
 *   recordsTotal: 100,
 *   recordsFiltered: 10,
 *   data: [{id, folio, client, rate, numberOfPeople, status, ...}]
 * }
 */
router.get(
  '/',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.getQuotes(req, res)
);

/**
 * POST /api/quotes - Create a new quote.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Request body:
 * - client: string (optional) - Client ID (AmexingUser objectId).
 * - rate: string (required) - Rate ID (Rate objectId).
 * - contactPerson: string (optional) - Contact person name.
 * - contactEmail: string (optional) - Contact email.
 * - contactPhone: string (optional) - Contact phone.
 * - notes: string (optional) - Additional notes.
 * @returns {object} Response object containing success status and quote data.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   message: 'Cotización creada exitosamente',
 *   data: {
 *     id: 'abc123',
 *     folio: 'QTE-2025-0001',
 *     clientId: 'xyz789',
 *     rateId: 'def456',
 *     contactPerson: 'John Doe',
 *     contactEmail: 'john@example.com',
 *     contactPhone: '+1234567890',
 *     notes: 'Special requirements',
 *     status: 'draft',
 *     validUntil: '2025-11-28T00:00:00.000Z',
 *     active: true
 *   }
 * }
 */
router.post(
  '/',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.createQuote(req, res)
);

/**
 * GET /api/quotes/:id - Get quote by ID.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Returns complete quote information including related entities.
 * @returns {object} Response with quote data.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   data: {
 *     id, folio, client, rate, eventType, numberOfPeople,
 *     contactPerson, contactEmail, contactPhone, notes,
 *     status, validUntil, createdBy, active, createdAt, updatedAt
 *   }
 * }
 */
router.get(
  '/:id',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.getQuoteById(req, res)
);

/**
 * PUT /api/quotes/:id - Update quote.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Request body can include:
 * - status: string (draft, sent, accepted, rejected).
 * - numberOfPeople: number.
 * - contactPerson: string.
 * - contactEmail: string.
 * - contactPhone: string.
 * - notes: string.
 * - validUntil: Date.
 * @returns {object} Response with updated quote data.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   quote: { id, folio, status, ... }
 * }
 */
router.put(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.updateQuote(req, res)
);

/**
 * PUT /api/quotes/:id/service-items - Update service items (itinerary days).
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Request body:
 * - days: Array of day objects [{dayNumber, concept, vehicleType, hours, unitPrice, total, notes}].
 * - subtotal: number - Sum of all day totals.
 * - iva: number - IVA (16% of subtotal).
 * - total: number - Total (subtotal + iva).
 * @returns {object} Response with updated quote data.
 * @example
 * // Request body:
 * {
 *   days: [{dayNumber: 1, concept: 'Transfer', vehicleType: 'Sprinter', hours: 2, unitPrice: 500, total: 1000, notes: ''}],
 *   subtotal: 1000,
 *   iva: 160,
 *   total: 1160
 * }
 * // Response structure:
 * {
 *   success: true,
 *   message: 'Servicios actualizados exitosamente',
 *   data: { id, folio, serviceItems }
 * }
 */
router.put(
  '/:id/service-items',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.updateServiceItems(req, res)
);

/**
 * GET /api/quotes/:id/available-services - Get available services filtered by quote's rate.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Returns list of services (transfers) available for the quote based on its assigned rate.
 * Used by quote-services.ejs to populate transfer selector in subconcepts.
 * @returns {object} Response with services array.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   data: [{
 *     value: "service123",
 *     label: "Aeropuerto Internacional → Hotel Rosewood",
 *     vehicleType: "Sprinter",
 *     vehicleTypeId: "vt456",
 *     price: 2500.00,
 *     note: "Recepción en sala VIP",
 *     isRoundTrip: false,
 *     serviceType: "Aeropuerto"
 *   }]
 * }
 */
router.get(
  '/:id/available-services',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.getAvailableServicesForQuote(req, res)
);

/**
 * GET /api/quotes/services-by-rate/:rateId - Get available services filtered by specific rate.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Returns list of services (transfers) available for the specified rate.
 * Used when adding traslado subconcept - user selects rate first, then service.
 * @param {string} rateId - Rate ID to filter services.
 * @returns {object} Response with grouped routes array.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   data: [{
 *     routeKey: "originId_destinationId",
 *     label: "Aeropuerto Internacional -> Hotel Rosewood",
 *     originName: "Aeropuerto Internacional",
 *     destinationName: "Hotel Rosewood",
 *     originId: "poi123",
 *     destinationId: "poi456",
 *     serviceType: "Aeropuerto",
 *     hasRoundTrip: false,
 *     vehicles: [{
 *       serviceId: "service789",
 *       vehicleType: "Sprinter",
 *       vehicleTypeId: "vt456",
 *       capacity: 12,
 *       basePrice: 2000.00,
 *       price: 2500.00,
 *       surcharge: 500.00,
 *       surchargePercentage: 25,
 *       note: "Recepción en sala VIP",
 *       isRoundTrip: false
 *     }]
 *   }]
 * }
 */
router.get(
  '/services-by-rate/:rateId',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.getAvailableServicesByRate(req, res)
);

/**
 * GET /api/quotes/tours-by-rate/:rateId - Get available tours filtered by specific rate.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Returns list of tours available for the specified rate.
 * Used when adding tour subconcept - user selects rate first, then tour.
 * @param {string} rateId - Rate ID to filter tours.
 * @returns {object} Response with grouped destinations array.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   data: [{
 *     destinationKey: "poiId123",
 *     destinationName: "San Miguel de Allende",
 *     label: "San Miguel de Allende",
 *     vehicles: [{
 *       tourId: "tour456",
 *       vehicleType: "Suburban",
 *       vehicleTypeId: "vt789",
 *       capacity: 6,
 *       basePrice: 2000.00,
 *       price: 2500.00,
 *       surcharge: 500.00,
 *       surchargePercentage: 25,
 *       durationMinutes: 240,
 *       durationHours: 4.0,
 *       minPassengers: 1,
 *       maxPassengers: 6,
 *       note: "Tour incluye..."
 *     }]
 *   }]
 * }
 */
router.get(
  '/tours-by-rate/:rateId',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.getAvailableToursByRate(req, res)
);

/**
 * GET /api/quotes/tours/destinations-by-rate/:rateId - Get unique tour destinations for a rate.
 * Step 2 of 3-step tour selection: Rate → Destination → Vehicle.
 * Private access (Department Manager, Admin and SuperAdmin).
 */
router.get(
  '/tours/destinations-by-rate/:rateId',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => QuoteController.getTourDestinationsByRate(req, res)
);

/**
 * GET /api/quotes/tours/vehicles-by-rate-destination/:rateId/:destinationId - Get vehicles for rate + destination.
 * Step 3 of 3-step tour selection: Rate → Destination → Vehicle.
 * Private access (Department Manager, Admin and SuperAdmin).
 */
router.get(
  '/tours/vehicles-by-rate-destination/:rateId/:destinationId',
  readOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4),
  (req, res) => QuoteController.getTourVehiclesByRateAndDestination(req, res)
);

/**
 * POST /api/quotes/:id/duplicate - Duplicate an existing quote.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Creates a copy of an existing quote with:
 * - New auto-generated folio (QTE-YYYY-####)
 * - EventType with incremented "Opción X" suffix (e.g., "Event - Opción 2" → "Event - Opción 3")
 * - Status set to "draft"
 * - ValidUntil set to +30 days from now
 * - Complete copy of serviceItems (itinerary)
 * - Same rate, client, contact info, and notes.
 * @returns {object} Response with duplicated quote data.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   message: 'Cotización duplicada exitosamente',
 *   data: {
 *     quote: {
 *       id: 'newId123',
 *       folio: 'QTE-2025-0042',
 *       eventType: 'Wedding - Opción 3',
 *       status: 'draft',
 *       ...
 *     },
 *     originalFolio: 'QTE-2025-0041'
 *   }
 * }
 */
router.post(
  '/:id/duplicate',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.duplicateQuote(req, res)
);

/**
 * POST /api/quotes/:id/share-link - Generate shareable public link.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Generates a public URL for sharing the quote with clients.
 * Uses the quote's folio as the access key (e.g., /quotes/QTE-2025-0004).
 * No authentication required for the public view.
 * @returns {object} Response with share URL.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   data: {
 *     shareUrl: 'http://localhost:1337/quotes/QTE-2025-0004',
 *     folio: 'QTE-2025-0004',
 *     quoteId: 'abc123'
 *   }
 * }
 */
router.post(
  '/:id/share-link',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.generateShareLink(req, res)
);

/**
 * DELETE /api/quotes/:id - Soft delete quote.
 * Private access (Department Manager, Admin and SuperAdmin).
 *
 * Soft deletes the quote (sets exists=false, active=false).
 * Cannot be undone through normal UI.
 * @returns {object} Response with success status.
 * @example
 * // Response structure:
 * {
 *   success: true,
 *   message: 'Quote deleted successfully'
 * }
 */
router.delete(
  '/:id',
  writeOperationsLimiter,
  jwtMiddleware.authenticateToken,
  jwtMiddleware.requireRoleLevel(4), // Department Manager (4), Admin (6) and SuperAdmin (7)
  (req, res) => QuoteController.deleteQuote(req, res)
);

module.exports = router;
