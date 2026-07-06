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
const ImageOptimizationService = require('../../services/ImageOptimizationService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');
const logger = require('../../../infrastructure/logger');

/**
 * POIController class implementing RESTful API.
 */
class POIController {
  constructor() {
    this.poiService = new POIService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;

    // Servicios de imagen (mismos que experiencias) para la imagen única del destino.
    // Carpeta S3 propia `pois/…`; presigned URLs con formato óptimo (AVIF/WebP/JPEG).
    const s3Options = {
      baseFolder: 'pois',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    };
    this.imageOptimizationService = new ImageOptimizationService({
      ...s3Options,
      enableOptimization: process.env.ENABLE_IMAGE_OPTIMIZATION !== 'false',
    });
    this.serverOptimizationService = new ServerImageOptimizationService(s3Options);
  }

  /**
   * Procesa la imagen única de un destino (misma lógica que las fotos de experiencias,
   * pero para UNA sola imagen). Devuelve el objeto imagen a persistir o null.
   * @param {object|null} image - `{ dataUrl }` (nueva) o `{ s3Key, optimizedVariants, ... }` (existente).
   * @param {string} poiId - Id del destino (para la ruta en S3).
   * @param {object} userContext - Contexto de auditoría.
   * @returns {Promise<object|null>} Imagen optimizada, la existente, o null.
   * @example
   * const img = await controller.processSingleImage({ dataUrl }, poi.id, userContext);
   */
  async processSingleImage(image, poiId, userContext) {
    if (!image) {
      return null;
    }

    // Imagen nueva (data URL base64) → optimizar y subir
    if (image.dataUrl && image.dataUrl.startsWith('data:')) {
      const matches = image.dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        logger.warn('Invalid base64 data URL for POI image', { poiId });
        return image.s3Key ? image : null;
      }

      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substr(2, 9);
      const originalFileName = image.fileName || 'image.jpg';
      const extension = originalFileName.split('.').pop() || 'jpg';
      const uniqueFileName = `${timestamp}-${randomString}.${extension}`;

      const optimizationResult = await this.serverOptimizationService.uploadOptimizedImage(
        buffer,
        uniqueFileName,
        mimeType,
        { entityPath: `pois/${poiId}`, entityId: poiId, userContext }
      );

      logger.info('POI image optimized', {
        poiId,
        fileName: originalFileName,
        s3Key: optimizationResult.originalS3Key,
        userId: userContext?.userId,
      });

      return {
        s3Key: optimizationResult.originalS3Key,
        fileName: originalFileName,
        originalName: originalFileName,
        optimizedVariants: optimizationResult.optimizedVariants,
        optimizationMetadata: optimizationResult.metadata,
        fileSize: buffer.length,
        mimeType,
      };
    }

    // Imagen existente → conservar, pero sin persistir la url/dataUrl presigned (transitorias);
    // se regeneran al responder. Preserva los metadatos de optimización.
    if (image.s3Key || image.optimizedVariants || image.optimizationMetadata) {
      const persisted = { ...image };
      delete persisted.url;
      delete persisted.dataUrl;
      return persisted;
    }

    return null;
  }

  /**
   * Formatea la imagen del destino para la respuesta: presigned URL en el formato óptimo.
   * @param {object|null} image - Imagen persistida.
   * @param {string} acceptHeader - Header Accept del navegador.
   * @returns {Promise<object|null>} Imagen con `url`/`dataUrl` o null.
   * @example
   * const img = await controller.formatImageForResponse(poi.get('image'), req.get('accept'));
   */
  async formatImageForResponse(image, acceptHeader = '') {
    if (!image) {
      return null;
    }

    try {
      // Elige el s3Key a servir: la variante optimizada preferida según el header Accept
      // (avif → webp → jpeg), y si no hay variantes, el original. Se construye la presigned
      // URL directamente (no se usa getImageWithOptimalFormat porque espera un Parse.Object).
      let { s3Key } = image;
      const variants = image.optimizedVariants;
      if (variants && typeof variants === 'object') {
        const preferred = this.imageOptimizationService.detectPreferredFormat?.(acceptHeader);
        const order = [preferred, 'avif', 'webp', 'jpeg'].filter(Boolean);
        const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;
        const chosen = order.map((fmt) => keyFrom(variants[fmt])).find(Boolean);
        if (chosen) {
          s3Key = chosen;
        }
      }

      if (s3Key) {
        const url = await this.imageOptimizationService.getPresignedUrl(s3Key);
        return { ...image, url, dataUrl: url };
      }
    } catch (error) {
      logger.warn('Error formatting POI image for response', { error: error.message });
    }

    return image;
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
        image: await this.formatImageForResponse(poi.get('image'), req.get('accept') || ''),
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

      const { name, serviceTypeId, image } = req.body;

      // Validate required fields
      if (!name || name.trim().length === 0) {
        return this.sendError(res, 'El nombre es requerido', 400);
      }

      if (name.length > 280) {
        return this.sendError(res, 'El nombre debe tener 280 caracteres o menos', 400);
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

      // Imagen (opcional): se procesa DESPUÉS del primer save para tener el id del destino
      // (la ruta en S3 usa `pois/${poiId}`). Si hay imagen, se optimiza y se re-guarda.
      const userContext = {
        objectId: currentUser.id,
        id: currentUser.id,
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username') || currentUser.get('email'),
      };
      if (image) {
        const processedImage = await this.processSingleImage(image, poi.id, userContext);
        if (processedImage) {
          poi.set('image', processedImage);
          await poi.save(null, { useMasterKey: true, context: { user: userContext } });
        }
      }

      logger.info('POI created', {
        poiId: poi.id,
        name: poi.get('name'),
        serviceTypeId: serviceType.id,
        hasImage: !!poi.get('image'),
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
        image: await this.formatImageForResponse(poi.get('image'), req.get('accept') || ''),
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

      const {
        name, active, serviceTypeId, image,
      } = req.body;

      // Update name if provided
      if (name && name.trim().length > 0) {
        if (name.length > 280) {
          return this.sendError(res, 'El nombre debe tener 280 caracteres o menos', 400);
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

      // Imagen (opcional): solo se toca si el request la incluye. Objeto con dataUrl →
      // se optimiza; objeto existente → se conserva; null/vacío → se quita del destino.
      const userContext = {
        objectId: currentUser.id,
        id: currentUser.id,
        userId: currentUser.id,
        email: currentUser.get('email'),
        username: currentUser.get('username') || currentUser.get('email'),
      };
      if (Object.prototype.hasOwnProperty.call(req.body, 'image')) {
        const processedImage = image ? await this.processSingleImage(image, poi.id, userContext) : null;
        if (processedImage) {
          poi.set('image', processedImage);
        } else {
          poi.unset('image');
        }
      }

      // Save changes with user context for audit trail
      await poi.save(null, {
        useMasterKey: true,
        context: { user: userContext },
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
        image: await this.formatImageForResponse(updatedPoi.get('image'), req.get('accept') || ''),
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
