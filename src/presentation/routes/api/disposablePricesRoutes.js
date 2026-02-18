/**
 * Disposable Prices API Routes
 * Routes for A Disposición (hourly vehicle rental) pricing endpoints.
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-17
 */

const express = require('express');

const router = express.Router();
const disposablePricesController = require('../../../application/controllers/api/DisposablePricesController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// Apply JWT authentication to all disposable prices routes
router.use(jwtMiddleware.authenticateToken);

/**
 * @swagger
 * /api/disposable-prices:
 *   get:
 *     summary: Get all current disposable prices
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current disposable prices retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DisposablePrice'
 *                 total:
 *                   type: number
 *       500:
 *         description: Server error
 */
router.get('/', disposablePricesController.getCurrentPrices);

/**
 * @swagger
 * /api/disposable-prices/by-vehicle-type:
 *   get:
 *     summary: Get disposable prices grouped by vehicle type
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Disposable prices grouped by vehicle type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     $ref: '#/components/schemas/VehicleTypePrices'
 *                 total:
 *                   type: number
 */
router.get('/by-vehicle-type', disposablePricesController.getPricesByVehicleType);

/**
 * @swagger
 * /api/disposable-prices/vehicle/{vehicleTypeId}:
 *   get:
 *     summary: Get disposable price for specific vehicle type
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleTypeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vehicle type ID
 *     responses:
 *       200:
 *         description: Disposable price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DisposablePrice'
 *       404:
 *         description: No price found for vehicle type
 *       500:
 *         description: Server error
 */
router.get('/vehicle/:vehicleTypeId', disposablePricesController.getPriceByVehicleType);

/**
 * @swagger
 * /api/disposable-prices/history/{vehicleTypeId}:
 *   get:
 *     summary: Get price history for specific vehicle type
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleTypeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vehicle type ID
 *     responses:
 *       200:
 *         description: Price history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DisposablePriceHistory'
 *                 total:
 *                   type: number
 *       400:
 *         description: Vehicle type ID is required
 *       500:
 *         description: Server error
 */
router.get('/history/:vehicleTypeId', disposablePricesController.getPriceHistory);

/**
 * @swagger
 * /api/disposable-prices/batch-update:
 *   put:
 *     summary: Batch update disposable prices
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               updates:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Price ID
 *                     hourlyPrice:
 *                       type: number
 *                       description: New hourly price
 *     responses:
 *       200:
 *         description: Prices updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     updated:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/DisposablePrice'
 *                     errors:
 *                       type: array
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid update data
 *       500:
 *         description: Server error
 */
router.put('/batch-update', disposablePricesController.batchUpdatePrices);

/**
 * @swagger
 * /api/disposable-prices/vehicles-for-rate:
 *   get:
 *     summary: Get available vehicles for specific rate
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: rateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rate ID
 *     responses:
 *       200:
 *         description: Available vehicles retrieved successfully
 *       400:
 *         description: Missing rate ID
 *       500:
 *         description: Server error
 */
router.get('/vehicles-for-rate', disposablePricesController.getVehiclesForRate);

/**
 * @swagger
 * /api/disposable-prices/rates-for-vehicle:
 *   get:
 *     summary: Get available rates for specific vehicle type
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vehicleTypeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vehicle type ID
 *     responses:
 *       200:
 *         description: Available rates retrieved successfully
 *       400:
 *         description: Missing vehicle type ID
 *       500:
 *         description: Server error
 */
router.get('/rates-for-vehicle', disposablePricesController.getRatesForVehicle);

/**
 * @swagger
 * /api/disposable-prices/price:
 *   get:
 *     summary: Get price for specific vehicle type and rate
 *     tags: [DisposablePrices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vehicleTypeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vehicle type ID
 *       - in: query
 *         name: rateId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rate ID
 *     responses:
 *       200:
 *         description: Price retrieved successfully
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Server error
 */
router.get('/price', disposablePricesController.getPriceByVehicleTypeAndRate);

module.exports = router;
