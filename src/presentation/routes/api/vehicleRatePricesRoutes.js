/**
 * Vehicle Rate Prices API Routes.
 *
 * API endpoints for vehicle rate pricing management.
 *
 * Created by Denisse Maldonado.
 */

const express = require('express');

const router = express.Router();
const vehicleRatePricesController = require('../../../application/controllers/api/vehicleRatePricesController');
const { authenticateToken } = require('../../../application/middleware/jwtMiddleware');

/**
 * Public endpoints (read-only).
 */

// Get current price for specific rate and vehicle
// GET /api/vehicle-rate-prices/current?rateId=xxx&vehicleTypeId=xxx
router.get('/current', vehicleRatePricesController.getCurrentPrice);

// Get all prices for a specific rate
// GET /api/vehicle-rate-prices/by-rate/:rateId
router.get('/by-rate/:rateId', vehicleRatePricesController.getPricesByRate);

// Get all prices for a specific vehicle type
// GET /api/vehicle-rate-prices/by-vehicle/:vehicleTypeId
router.get('/by-vehicle/:vehicleTypeId', vehicleRatePricesController.getPricesByVehicleType);

// Get all current prices (matrix view)
// GET /api/vehicle-rate-prices/all
router.get('/all', vehicleRatePricesController.getAllCurrentPrices);

// Get price at specific date
// GET /api/vehicle-rate-prices/at-date?rateId=xxx&vehicleTypeId=xxx&date=2024-01-01
router.get('/at-date', vehicleRatePricesController.getPriceAtDate);

// Get price history
// GET /api/vehicle-rate-prices/history?rateId=xxx&vehicleTypeId=xxx
router.get('/history', vehicleRatePricesController.getPriceHistory);

/**
 * Protected endpoints (require authentication).
 */

// Update single price
// POST /api/vehicle-rate-prices/update
router.post('/update', authenticateToken, vehicleRatePricesController.updatePrice);

// Bulk update prices for a rate
// POST /api/vehicle-rate-prices/bulk-update
router.post('/bulk-update', authenticateToken, vehicleRatePricesController.bulkUpdatePrices);

module.exports = router;
