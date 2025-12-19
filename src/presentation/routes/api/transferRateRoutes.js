const express = require('express');
const rateLimit = require('express-rate-limit');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');
const transferRateController = require('../../../application/controllers/api/TransferRateController');

const router = express.Router();

// Rate limiting configurations
const readRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for reads
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

const writeRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute for writes
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

/**
 * @swagger
 * components:
 *   schemas:
 *     TransferRate:
 *       type: object
 *       required:
 *         - value
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier for the transfer rate
 *         value:
 *           type: number
 *           minimum: 0.01
 *           maximum: 50.00
 *           description: Transfer rate percentage value
 *         description:
 *           type: string
 *           description: Optional description for the rate
 *         active:
 *           type: boolean
 *           description: Whether this rate is currently active
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         createdBy:
 *           type: string
 *           description: Email of user who created the rate
 *       example:
 *         id: "abc123"
 *         value: 3.5
 *         description: "New transfer commission rate"
 *         active: true
 *         createdAt: "2023-12-14T10:30:00Z"
 *         createdBy: "admin@amexing.com"
 */

/**
 * @swagger
 * /api/transfer-rates:
 *   post:
 *     summary: Create a new transfer rate
 *     tags: [Transfer Rates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 50.00
 *                 example: 3.5
 *               description:
 *                 type: string
 *                 example: "New transfer commission rate"
 *     responses:
 *       201:
 *         description: Transfer rate created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TransferRate'
 *                 message:
 *                   type: string
 *                   example: "Transfer rate created successfully"
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized - insufficient permissions
 *       429:
 *         description: Too many requests
 */
router.post(
  '/',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => transferRateController.create(req, res)
);

/**
 * @swagger
 * /api/transfer-rates/history:
 *   get:
 *     summary: Get transfer rate history with pagination (DataTables compatible)
 *     tags: [Transfer Rates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: draw
 *         schema:
 *           type: integer
 *         description: DataTables draw counter
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *         description: Starting record index
 *       - in: query
 *         name: length
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *       - in: query
 *         name: search[value]
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: order[0][column]
 *         schema:
 *           type: integer
 *         description: Column index for sorting
 *       - in: query
 *         name: order[0][dir]
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort direction
 *     responses:
 *       200:
 *         description: Transfer rate history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 draw:
 *                   type: integer
 *                 recordsTotal:
 *                   type: integer
 *                 recordsFiltered:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: array
 *                     items:
 *                       type: string
 *       401:
 *         description: Unauthorized - insufficient permissions
 *       429:
 *         description: Too many requests
 */
router.get(
  '/history',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => transferRateController.getHistory(req, res)
);

/**
 * @swagger
 * /api/transfer-rates/current:
 *   get:
 *     summary: Get current active transfer rate
 *     tags: [Transfer Rates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current transfer rate retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TransferRate'
 *       404:
 *         description: No active transfer rate found
 *       401:
 *         description: Unauthorized - insufficient permissions
 *       429:
 *         description: Too many requests
 */
router.get(
  '/current',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => transferRateController.getCurrent(req, res)
);

/**
 * @swagger
 * /api/transfer-rates/{id}:
 *   get:
 *     summary: Get transfer rate by ID
 *     tags: [Transfer Rates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transfer rate ID
 *     responses:
 *       200:
 *         description: Transfer rate retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TransferRate'
 *       404:
 *         description: Transfer rate not found
 *       401:
 *         description: Unauthorized - insufficient permissions
 *       429:
 *         description: Too many requests
 *   delete:
 *     summary: Soft delete transfer rate
 *     tags: [Transfer Rates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Transfer rate ID
 *     responses:
 *       200:
 *         description: Transfer rate deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Transfer rate deleted successfully"
 *       404:
 *         description: Transfer rate not found
 *       401:
 *         description: Unauthorized - insufficient permissions
 *       429:
 *         description: Too many requests
 */
router.get(
  '/:id',
  readRateLimit,
  jwtMiddleware.requireRoleLevel(6),
  (req, res) => transferRateController.getById(req, res)
);

router.delete(
  '/:id',
  writeRateLimit,
  jwtMiddleware.requireRoleLevel(8),
  (req, res) => transferRateController.delete(req, res)
);

module.exports = router;
