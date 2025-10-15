/**
 * RateController - RESTful API for Rate (Pricing) Management.
 *
 * Provides Ajax-ready endpoints for managing pricing rates catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active Rates.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging
 * - Percentage formatting for display.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-10-14
 * @example
 * GET /api/rates - List all Rates with pagination
 * POST /api/rates - Create new Rate
 * PUT /api/rates/:id - Update Rate
 * DELETE /api/rates/:id - Soft delete Rate
 * GET /api/rates/active - Get active Rates for dropdowns
 */

const Parse = require('parse/node');
const RateService = require('../../services/RateService');
const logger = require('../../../infrastructure/logger');

/**
 * RateController class implementing RESTful API.
 */
class RateController {
  constructor() {
    this.rateService = new RateService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/rates - Get Rates with DataTables server-side processing.
   *
   * Query Parameters (DataTables format):
   * - draw: Draw counter for DataTables
   * - start: Starting record number
   * - length: Number of records to return
   * - search[value]: Search term
   * - order[0][column]: Column index to sort
   * - order[0][dir]: Sort direction (asc/desc).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getRates(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw) || 1;
      const start = parseInt(req.query.start) || 0;
      const length = Math.min(
        parseInt(req.query.length) || this.defaultPageSize,
        this.maxPageSize
      );
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['name', 'percentage', 'active'];
      const sortField = columns[sortColumnIndex] || 'name';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('Rate');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Rate');
      baseQuery.equalTo('exists', true);

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        filteredQuery = new Parse.Query('Rate');
        filteredQuery.equalTo('exists', true);
        filteredQuery.matches('name', searchValue, 'i');
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const rates = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = rates.map((rate) => {
        const percentage = rate.get('percentage');
        return {
          id: rate.id,
          objectId: rate.id,
          name: rate.get('name'),
          percentage,
          formattedPercentage:
            percentage !== undefined && percentage !== null
              ? `${percentage}%`
              : '-',
          active: rate.get('active'),
          createdAt: rate.createdAt,
          updatedAt: rate.updatedAt,
        };
      });

      // DataTables response format
      const response = {
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      };

      return res.json(response);
    } catch (error) {
      logger.error('Error in RateController.getRates', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development'
          ? `Error: ${error.message}`
          : 'Error al obtener las tarifas',
        500
      );
    }
  }

  /**
   * GET /api/rates/active - Get active Rates for dropdowns.
   *
   * Returns simplified array of active Rates suitable for select/dropdown elements.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getActiveRates(req, res) {
    try {
      const query = new Parse.Query('Rate');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('name');
      query.limit(1000);

      const rates = await query.find({ useMasterKey: true });

      // Format for select options
      const options = rates.map((rate) => {
        const percentage = rate.get('percentage');
        return {
          value: rate.id,
          label: rate.get('name'),
          percentage,
          formattedPercentage:
            percentage !== undefined && percentage !== null
              ? `${percentage}%`
              : '-',
        };
      });

      return this.sendSuccess(
        res,
        options,
        'Active Rates retrieved successfully'
      );
    } catch (error) {
      logger.error('Error in RateController.getActiveRates', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(res, 'Error al obtener las tarifas activas', 500);
    }
  }

  /**
   * GET /api/rates/:id - Get single Rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getRateById(req, res) {
    try {
      const currentUser = req.user;
      const rateId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      const query = new Parse.Query('Rate');
      query.equalTo('exists', true);
      const rate = await query.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      const percentage = rate.get('percentage');
      const data = {
        id: rate.id,
        name: rate.get('name'),
        percentage,
        formattedPercentage:
          percentage !== undefined && percentage !== null
            ? `${percentage}%`
            : '-',
        active: rate.get('active'),
        createdAt: rate.createdAt,
        updatedAt: rate.updatedAt,
      };

      return this.sendSuccess(res, data, 'Tarifa obtenida exitosamente');
    } catch (error) {
      logger.error('Error in RateController.getRateById', {
        error: error.message,
        rateId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener la tarifa', 500);
    }
  }

  /**
   * POST /api/rates - Create new Rate.
   *
   * Body Parameters:
   * - name: string (required) - Display name
   * - percentage: number (required) - Percentage value (0-100).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createRate(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { name, percentage } = req.body;

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return this.sendError(res, 'El nombre es requerido', 400);
      }

      if (name.length > 200) {
        return this.sendError(
          res,
          'El nombre debe tener 200 caracteres o menos',
          400
        );
      }

      if (percentage === undefined || percentage === null) {
        return this.sendError(res, 'El porcentaje es requerido', 400);
      }

      if (typeof percentage !== 'number') {
        return this.sendError(res, 'El porcentaje debe ser un número', 400);
      }

      if (percentage < 0 || percentage > 100) {
        return this.sendError(
          res,
          'El porcentaje debe estar entre 0 y 100',
          400
        );
      }

      // Check name uniqueness
      const checkQuery = new Parse.Query('Rate');
      checkQuery.matches('name', `^${name.trim()}$`, 'i');
      checkQuery.equalTo('exists', true);
      const existingCount = await checkQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe una tarifa con ese nombre', 409);
      }

      // Create new Rate using Parse.Object.extend
      const RateClass = Parse.Object.extend('Rate');
      const rate = new RateClass();

      rate.set('name', name.trim());
      rate.set('percentage', percentage);
      rate.set('active', true);
      rate.set('exists', true);

      // Save with master key
      await rate.save(null, { useMasterKey: true });

      logger.info('Rate created', {
        rateId: rate.id,
        name: rate.get('name'),
        percentage: rate.get('percentage'),
        createdBy: currentUser.id,
      });

      const data = {
        id: rate.id,
        name: rate.get('name'),
        percentage: rate.get('percentage'),
        formattedPercentage: `${percentage}%`,
        active: rate.get('active'),
      };

      return this.sendSuccess(res, data, 'Tarifa creada exitosamente', 201);
    } catch (error) {
      logger.error('Error in RateController.createRate', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear la tarifa', 500);
    }
  }

  /**
   * PUT /api/rates/:id - Update Rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateRate(req, res) {
    try {
      const currentUser = req.user;
      const rateId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      // Get existing Rate
      const query = new Parse.Query('Rate');
      query.equalTo('exists', true);
      const rate = await query.get(rateId, { useMasterKey: true });

      if (!rate) {
        return this.sendError(res, 'Tarifa no encontrada', 404);
      }

      const { name, percentage, active } = req.body;

      // Update name if provided
      if (name && name.trim().length > 0) {
        if (name.length > 200) {
          return this.sendError(
            res,
            'El nombre debe tener 200 caracteres o menos',
            400
          );
        }

        // Check name uniqueness if changing
        if (name.trim() !== rate.get('name')) {
          const checkQuery = new Parse.Query('Rate');
          checkQuery.matches('name', `^${name.trim()}$`, 'i');
          checkQuery.equalTo('exists', true);
          checkQuery.notEqualTo('objectId', rateId);
          const existingCount = await checkQuery.count({ useMasterKey: true });

          if (existingCount > 0) {
            return this.sendError(
              res,
              'Ya existe una tarifa con ese nombre',
              409
            );
          }

          rate.set('name', name.trim());
        }
      }

      // Update percentage if provided
      if (percentage !== undefined && percentage !== null) {
        if (typeof percentage !== 'number') {
          return this.sendError(res, 'El porcentaje debe ser un número', 400);
        }

        if (percentage < 0 || percentage > 100) {
          return this.sendError(
            res,
            'El porcentaje debe estar entre 0 y 100',
            400
          );
        }

        rate.set('percentage', percentage);
      }

      // Update active status if provided
      if (typeof active === 'boolean') {
        rate.set('active', active);
      }

      // Save changes
      await rate.save(null, { useMasterKey: true });

      logger.info('Rate updated', {
        rateId: rate.id,
        name: rate.get('name'),
        percentage: rate.get('percentage'),
        active: rate.get('active'),
        updatedBy: currentUser.id,
      });

      const finalPercentage = rate.get('percentage');
      const data = {
        id: rate.id,
        name: rate.get('name'),
        percentage: finalPercentage,
        formattedPercentage:
          finalPercentage !== undefined && finalPercentage !== null
            ? `${finalPercentage}%`
            : '-',
        active: rate.get('active'),
        updatedAt: rate.updatedAt,
      };

      return this.sendSuccess(res, data, 'Tarifa actualizada exitosamente');
    } catch (error) {
      logger.error('Error in RateController.updateRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.id,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al actualizar la tarifa', 500);
    }
  }

  /**
   * PATCH /api/rates/:id/toggle-status - Toggle Rate active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async toggleRateStatus(req, res) {
    try {
      const currentUser = req.user;
      const rateId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(
          res,
          'El estado activo debe ser un valor booleano',
          400
        );
      }

      const result = await this.rateService.toggleRateStatus(
        currentUser,
        rateId,
        active,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(
        res,
        result.rate,
        result.message || 'Estado actualizado exitosamente'
      );
    } catch (error) {
      logger.error('Error in RateController.toggleRateStatus', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        error.message || 'Error al cambiar el estado de la tarifa',
        500
      );
    }
  }

  /**
   * DELETE /api/rates/:id - Soft delete Rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteRate(req, res) {
    try {
      const currentUser = req.user;
      const rateId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!rateId) {
        return this.sendError(res, 'El ID de la tarifa es requerido', 400);
      }

      await this.rateService.softDeleteRate(
        currentUser,
        rateId,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, null, 'Tarifa eliminada exitosamente');
    } catch (error) {
      logger.error('Error in RateController.deleteRate', {
        error: error.message,
        stack: error.stack,
        rateId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        error.message || 'Error al eliminar la tarifa',
        500
      );
    }
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Express response.
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Express response.
   * @example
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }
}

// Export singleton instance
const rateController = new RateController();
module.exports = rateController;
