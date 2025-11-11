/**
 * Tours API Routes
 * RESTful routes for tours management.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const express = require('express');

const router = express.Router();
const ToursController = require('../../../application/controllers/api/ToursController');
const jwtMiddleware = require('../../../application/middleware/jwtMiddleware');

// =================
// READ ROUTES (require department manager authentication)
// =================

/**
 * @swagger
 * /api/tours:
 *   get:
 *     tags:
 *       - Tours
 *     summary: Get tours list
 *     description: |
 *       Get paginated list of tours with DataTables server-side processing support.
 *
 *       **Access:** Department Manager and above
 *       **Rate Limited:** 100 requests per 15 minutes
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: draw
 *         in: query
 *         schema:
 *           type: integer
 *         description: Draw counter for DataTables
 *       - name: start
 *         in: query
 *         schema:
 *           type: integer
 *         description: Starting record number
 *       - name: length
 *         in: query
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *       - name: search[value]
 *         in: query
 *         schema:
 *           type: string
 *         description: Search term
 *     responses:
 *       200:
 *         description: Tours list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 draw:
 *                   type: integer
 *                 recordsTotal:
 *                   type: integer
 *                 recordsFiltered:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     tours:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/', jwtMiddleware.requireRoleLevel(4), (req, res) => ToursController.getTours(req, res));

// =================
// WRITE ROUTES (require admin/superadmin)
// =================

/**
 * @swagger
 * /api/tours:
 *   post:
 *     tags:
 *       - Tours
 *     summary: Create new tour
 *     description: |
 *       Create a new tour with destination POI, vehicle type, pricing and rate information.
 *
 *       **Access:** Admin and SuperAdmin only
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - destinationPOI
 *               - time
 *               - vehicleType
 *               - price
 *               - rate
 *             properties:
 *               destinationPOI:
 *                 type: string
 *                 description: POI object ID for destination
 *               time:
 *                 type: integer
 *                 description: Duration in minutes
 *                 minimum: 1
 *               vehicleType:
 *                 type: string
 *                 description: VehicleType object ID
 *               price:
 *                 type: number
 *                 description: Tour price
 *                 minimum: 0.01
 *               rate:
 *                 type: string
 *                 description: Rate object ID
 *     responses:
 *       201:
 *         description: Tour created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post('/', jwtMiddleware.requireRoleLevel(6), (req, res) => ToursController.createTour(req, res));

/**
 * @swagger
 * /api/tours/{id}:
 *   get:
 *     tags:
 *       - Tours
 *     summary: Get tour by ID
 *     description: |
 *       Retrieve detailed information for a specific tour including related objects.
 *
 *       **Access:** Department Manager and above
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Tour object ID
 *     responses:
 *       200:
 *         description: Tour details retrieved successfully
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
 *                     tour:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tour not found
 */
router.get('/:id', jwtMiddleware.requireRoleLevel(4), (req, res) => ToursController.getTourById(req, res));

/**
 * @swagger
 * /api/tours/{id}:
 *   put:
 *     tags:
 *       - Tours
 *     summary: Update tour
 *     description: |
 *       Update an existing tour's information.
 *
 *       **Access:** Admin and SuperAdmin only
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Tour object ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - destinationPOI
 *               - time
 *               - vehicleType
 *               - price
 *               - rate
 *             properties:
 *               destinationPOI:
 *                 type: string
 *                 description: POI object ID for destination
 *               time:
 *                 type: integer
 *                 description: Duration in minutes
 *                 minimum: 1
 *               vehicleType:
 *                 type: string
 *                 description: VehicleType object ID
 *               price:
 *                 type: number
 *                 description: Tour price
 *                 minimum: 0.01
 *               rate:
 *                 type: string
 *                 description: Rate object ID
 *     responses:
 *       200:
 *         description: Tour updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tour not found
 *   delete:
 *     tags:
 *       - Tours
 *     summary: Delete tour (soft delete)
 *     description: |
 *       Soft delete a tour by setting exists=false and active=false.
 *
 *       **Access:** Admin and SuperAdmin only
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Tour object ID
 *     responses:
 *       200:
 *         description: Tour deleted successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tour not found
 */
router.put('/:id', jwtMiddleware.requireRoleLevel(6), (req, res) => ToursController.updateTour(req, res));
router.delete('/:id', jwtMiddleware.requireRoleLevel(6), (req, res) => ToursController.deleteTour(req, res));

/**
 * @swagger
 * /api/tours/{id}/toggle-status:
 *   patch:
 *     tags:
 *       - Tours
 *     summary: Toggle tour active status
 *     description: |
 *       Toggle the active status of a tour between true and false.
 *
 *       **Access:** Admin and SuperAdmin only
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Tour object ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - active
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: New active status
 *     responses:
 *       200:
 *         description: Tour status updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tour not found
 */
router.patch('/:id/toggle-status', jwtMiddleware.requireRoleLevel(6), (req, res) => ToursController.toggleTourStatus(req, res));

module.exports = router;
