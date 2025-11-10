/**
 * POIController - RESTful API for POI (Point of Interest) Management.
 *
 * Provides Ajax-ready endpoints for managing POI catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active POIs.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/pois - List all POIs with pagination
 * POST /api/pois - Create new POI
 * PUT /api/pois/:id - Update POI
 * DELETE /api/pois/:id - Soft delete POI
 * GET /api/pois/active - Get active POIs for dropdowns
 */

const Parse = require('parse/node');
const POIService = require('../../services/POIService');
const logger = require('../../../infrastructure/logger');

/**
 * POIController class implementing RESTful API.
 */
class POIController {
  constructor() {
    this.poiService = new POIService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/pois - Get POIs with DataTables server-side processing.
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
   * // Usage example documented above
   */
  async getPOIs(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Column mapping for sorting (matches frontend columns order)
      const columns = ['name', 'active'];
      const sortField = columns[sortColumnIndex] || 'name';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('POI');
      totalRecordsQuery.equalTo('exists', true);
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('POI');
      baseQuery.equalTo('exists', true);

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        filteredQuery = new Parse.Query('POI');
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

      // Include serviceType pointer
      filteredQuery.include('serviceType');

      // Execute query
      const pois = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = pois.map((poi) => {
        const serviceType = poi.get('serviceType');
        return {
          id: poi.id,
          objectId: poi.id,
          name: poi.get('name'),
          active: poi.get('active'),
          serviceType: serviceType
            ? {
              id: serviceType.id,
              name: serviceType.get('name'),
            }
            : null,
          createdAt: poi.createdAt,
          updatedAt: poi.updatedAt,
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
      logger.error('Error in POIController.getPOIs', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener los puntos de interés',
        500
      );
    }
  }

  /**
   * GET /api/pois/active - Get active POIs for dropdowns.
   *
   * Returns simplified array of active POIs suitable for select/dropdown elements.
   * Query Parameters:
   * - serviceType: string (optional) - Filter by service type name (Aeropuerto, Punto a Punto, Local).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getActivePOIs(req, res) {
    try {
      const serviceTypeFilter = req.query.serviceType || null;

      const query = new Parse.Query('POI');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('name');
      query.limit(1000);
      query.include('serviceType');

      // Filter by serviceType if provided
      if (serviceTypeFilter) {
        const serviceTypeQuery = new Parse.Query('ServiceType');
        serviceTypeQuery.equalTo('name', serviceTypeFilter);
        serviceTypeQuery.equalTo('active', true);
        serviceTypeQuery.equalTo('exists', true);
        const serviceTypeObj = await serviceTypeQuery.first({ useMasterKey: true });

        if (serviceTypeObj) {
          query.equalTo('serviceType', serviceTypeObj);
        }
      }

      const pois = await query.find({ useMasterKey: true });

      // Format for select options
      const options = pois.map((poi) => {
        const serviceType = poi.get('serviceType');
        return {
          value: poi.id,
          label: poi.get('name'),
          serviceType: serviceType
            ? {
              id: serviceType.id,
              name: serviceType.get('name'),
            }
            : null,
        };
      });

      return this.sendSuccess(res, options, 'Active POIs retrieved successfully');
    } catch (error) {
      logger.error('Error in POIController.getActivePOIs', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(res, 'Error al obtener los puntos de interés activos', 500);
    }
  }

  /**
   * GET /api/pois/:id - Get single POI by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getPOIById(req, res) {
    try {
      const currentUser = req.user;
      const poiId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!poiId) {
        return this.sendError(res, 'El ID del punto de interés es requerido', 400);
      }

      const query = new Parse.Query('POI');
      query.equalTo('exists', true);
      query.include('serviceType');
      const poi = await query.get(poiId, { useMasterKey: true });

      if (!poi) {
        return this.sendError(res, 'Punto de interés no encontrado', 404);
      }

      const serviceType = poi.get('serviceType');
      const data = {
        id: poi.id,
        name: poi.get('name'),
        active: poi.get('active'),
        serviceType: serviceType
          ? {
            id: serviceType.id,
            name: serviceType.get('name'),
          }
          : null,
        createdAt: poi.createdAt,
        updatedAt: poi.updatedAt,
      };

      return this.sendSuccess(res, data, 'Punto de interés obtenido exitosamente');
    } catch (error) {
      logger.error('Error in POIController.getPOIById', {
        error: error.message,
        poiId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener el punto de interés', 500);
    }
  }

  /**
   * POST /api/pois - Create new POI.
   *
   * Body Parameters:
   * - name: string (required) - Display name.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async createPOI(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { name, serviceTypeId } = req.body;

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return this.sendError(res, 'El nombre es requerido', 400);
      }

      if (name.length > 200) {
        return this.sendError(res, 'El nombre debe tener 200 caracteres o menos', 400);
      }

      if (!serviceTypeId) {
        return this.sendError(res, 'El tipo de traslado es requerido', 400);
      }

      // Validate service type exists and is active
      const serviceTypeQuery = new Parse.Query('ServiceType');
      serviceTypeQuery.equalTo('exists', true);
      serviceTypeQuery.equalTo('active', true);
      let serviceType;
      try {
        serviceType = await serviceTypeQuery.get(serviceTypeId, {
          useMasterKey: true,
        });
      } catch (error) {
        return this.sendError(res, 'El tipo de traslado seleccionado no existe o no está activo', 400);
      }

      // Check name uniqueness
      const checkQuery = new Parse.Query('POI');
      checkQuery.matches('name', `^${name.trim()}$`, 'i');
      checkQuery.equalTo('exists', true);
      const existingCount = await checkQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe un punto de interés con ese nombre', 409);
      }

      // Create new POI using Parse.Object.extend
      const POIClass = Parse.Object.extend('POI');
      const poi = new POIClass();

      poi.set('name', name.trim());
      poi.set('active', true);
      poi.set('exists', true);
      poi.set('serviceType', serviceType);

      // Save with master key and user context for audit trail
      await poi.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      logger.info('POI created', {
        poiId: poi.id,
        name: poi.get('name'),
        serviceTypeId: serviceType.id,
        createdBy: currentUser.id,
      });

      const data = {
        id: poi.id,
        name: poi.get('name'),
        active: poi.get('active'),
        serviceType: {
          id: serviceType.id,
          name: serviceType.get('name'),
        },
      };

      return this.sendSuccess(res, data, 'Punto de interés creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in POIController.createPOI', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear el punto de interés', 500);
    }
  }

  /**
   * PUT /api/pois/:id - Update POI.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async updatePOI(req, res) {
    try {
      const currentUser = req.user;
      const poiId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!poiId) {
        return this.sendError(res, 'El ID del punto de interés es requerido', 400);
      }

      // Get existing POI
      const query = new Parse.Query('POI');
      query.equalTo('exists', true);
      const poi = await query.get(poiId, { useMasterKey: true });

      if (!poi) {
        return this.sendError(res, 'Punto de interés no encontrado', 404);
      }

      const { name, active, serviceTypeId } = req.body;

      // Update name if provided
      if (name && name.trim().length > 0) {
        if (name.length > 200) {
          return this.sendError(res, 'El nombre debe tener 200 caracteres o menos', 400);
        }

        // Check name uniqueness if changing
        if (name.trim() !== poi.get('name')) {
          const checkQuery = new Parse.Query('POI');
          checkQuery.matches('name', `^${name.trim()}$`, 'i');
          checkQuery.equalTo('exists', true);
          checkQuery.notEqualTo('objectId', poiId);
          const existingCount = await checkQuery.count({ useMasterKey: true });

          if (existingCount > 0) {
            return this.sendError(res, 'Ya existe un punto de interés con ese nombre', 409);
          }

          poi.set('name', name.trim());
        }
      }

      // Update active status if provided
      if (typeof active === 'boolean') {
        poi.set('active', active);
      }

      // Update service type if provided
      if (serviceTypeId) {
        const serviceTypeQuery = new Parse.Query('ServiceType');
        serviceTypeQuery.equalTo('exists', true);
        serviceTypeQuery.equalTo('active', true);
        try {
          const serviceType = await serviceTypeQuery.get(serviceTypeId, {
            useMasterKey: true,
          });
          poi.set('serviceType', serviceType);
        } catch (error) {
          return this.sendError(res, 'El tipo de traslado seleccionado no existe o no está activo', 400);
        }
      }

      // Save changes with user context for audit trail
      await poi.save(null, {
        useMasterKey: true,
        context: {
          user: {
            objectId: currentUser.id,
            id: currentUser.id,
            email: currentUser.get('email'),
            username: currentUser.get('username') || currentUser.get('email'),
          },
        },
      });

      // Fetch updated POI with serviceType included
      const updatedQuery = new Parse.Query('POI');
      updatedQuery.include('serviceType');
      const updatedPoi = await updatedQuery.get(poi.id, { useMasterKey: true });

      logger.info('POI updated', {
        poiId: updatedPoi.id,
        name: updatedPoi.get('name'),
        active: updatedPoi.get('active'),
        serviceTypeId: updatedPoi.get('serviceType')?.id,
        updatedBy: currentUser.id,
      });

      const serviceType = updatedPoi.get('serviceType');
      const data = {
        id: updatedPoi.id,
        name: updatedPoi.get('name'),
        active: updatedPoi.get('active'),
        serviceType: serviceType
          ? {
            id: serviceType.id,
            name: serviceType.get('name'),
          }
          : null,
        updatedAt: updatedPoi.updatedAt,
      };

      return this.sendSuccess(res, data, 'Punto de interés actualizado exitosamente');
    } catch (error) {
      logger.error('Error in POIController.updatePOI', {
        error: error.message,
        stack: error.stack,
        poiId: req.params.id,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al actualizar el punto de interés', 500);
    }
  }

  /**
   * PATCH /api/pois/:id/toggle-status - Toggle POI active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async togglePOIStatus(req, res) {
    try {
      const currentUser = req.user;
      const poiId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!poiId) {
        return this.sendError(res, 'El ID del punto de interés es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'El estado activo debe ser un valor booleano', 400);
      }

      const result = await this.poiService.togglePOIStatus(
        currentUser,
        poiId,
        active,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, result.poi, result.message || 'Estado actualizado exitosamente');
    } catch (error) {
      logger.error('Error in POIController.togglePOIStatus', {
        error: error.message,
        stack: error.stack,
        poiId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al cambiar el estado del punto de interés', 500);
    }
  }

  /**
   * DELETE /api/pois/:id - Soft delete POI.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async deletePOI(req, res) {
    try {
      const currentUser = req.user;
      const poiId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!poiId) {
        return this.sendError(res, 'El ID del punto de interés es requerido', 400);
      }

      await this.poiService.softDeletePOI(
        currentUser,
        poiId,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, null, 'Punto de interés eliminado exitosamente');
    } catch (error) {
      logger.error('Error in POIController.deletePOI', {
        error: error.message,
        stack: error.stack,
        poiId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al eliminar el punto de interés', 500);
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
   * // Usage example documented above
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
   * // Usage example documented above
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }
}

// Export singleton instance
const poiController = new POIController();
module.exports = poiController;
