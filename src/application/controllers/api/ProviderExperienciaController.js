/**
 * ProviderExperienciaController - RESTful API for Provider Experiencias Management.
 *
 * Provides Ajax-ready endpoints for managing provider services (experiencias).
 * Restricted to Admin and SuperAdmin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Provider-specific experiencia management
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/providers/:providerId/experiencias - List provider experiencias
 * POST /api/providers/:providerId/experiencias - Create experiencia
 * PUT /api/providers/:providerId/experiencias/:id - Update experiencia
 * DELETE /api/providers/:providerId/experiencias/:id - Delete experiencia
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const ProviderExperiencia = require('../../../domain/models/ProviderExperiencia');

/**
 * ProviderExperienciaController class implementing RESTful API.
 */
class ProviderExperienciaController {
  constructor() {
    this.maxExperienciasPerProvider = 50;
  }

  /**
   * GET /api/provider-experiencias/all - Get all provider experiencias from all providers.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/provider-experiencias/all
   */
  async getAllProviderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Get all active provider experiencias with provider info
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('provider');
      query.ascending('provider');
      query.ascending('name');
      query.limit(1000); // Get many for selection

      const experiencias = await query.find({ useMasterKey: true });

      // Format response with provider information
      const data = experiencias.map((exp) => ({
        id: exp.id,
        name: exp.get('name'),
        description: exp.get('description'),
        price: exp.get('price'),
        tipo: exp.get('tipo'),
        duration: exp.get('duration'),
        min_people: exp.get('min_people'),
        max_people: exp.get('max_people'),
        availability: exp.get('availability') || null,
        active: exp.get('active'),
        provider: exp.get('provider') ? {
          id: exp.get('provider').id,
          name: exp.get('provider').get('name'),
          type: exp.get('provider').get('type'),
        } : null,
        createdAt: exp.createdAt,
        updatedAt: exp.updatedAt,
      }));

      return res.json({
        success: true,
        data,
        count: data.length,
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getAllProviderExperiencias', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve provider experiencias',
        500
      );
    }
  }

  /**
   * GET /api/providers/:providerId/experiencias - Get provider experiencias.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/providers/abc123/experiencias
   */
  async getProviderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;

      // Verify provider exists
      const providerQuery = new Parse.Query('Experience');
      providerQuery.equalTo('objectId', providerId);
      providerQuery.equalTo('type', 'Provider');
      providerQuery.equalTo('exists', true);

      const provider = await providerQuery.first({ useMasterKey: true });
      if (!provider) {
        return this.sendError(res, 'Provider not found', 404);
      }

      // Get experiencias for this provider
      const experiencias = await ProviderExperiencia.findByProvider(providerId);

      // Format response
      const data = experiencias.map((exp) => this.formatExperienciaForResponse(exp));

      return res.json({
        success: true,
        data,
        count: data.length,
        provider: {
          id: provider.id,
          name: provider.get('name'),
          description: provider.get('description'),
        },
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getProviderExperiencias', {
        error: error.message,
        stack: error.stack,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve experiencias',
        500
      );
    }
  }

  /**
   * GET /api/providers/:providerId/experiencias/:id - Get single experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/providers/abc123/experiencias/xyz456
   */
  async getExperienciaById(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;

      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider', 403);
      }

      return res.json({
        success: true,
        data: this.formatExperienciaForResponse(experiencia),
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.getExperienciaById', {
        error: error.message,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to retrieve experiencia', 500);
    }
  }

  /**
   * POST /api/providers/:providerId/experiencias - Create new experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * POST /api/providers/abc123/experiencias
   * Body: { name, description, price, duration, min_people, max_people }
   */
  async createExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;
      const {
        name,
        description,
        price,
        duration,
        min_people: minPeople,
        max_people: maxPeople,
        displayOrder,
        tipo,
        availability,
      } = req.body;

      // Validate required fields
      if (!name || !description) {
        return this.sendError(res, 'Name and description are required', 400);
      }

      // Verify provider exists
      const providerQuery = new Parse.Query('Experience');
      providerQuery.equalTo('objectId', providerId);
      providerQuery.equalTo('type', 'Provider');
      providerQuery.equalTo('exists', true);

      const provider = await providerQuery.first({ useMasterKey: true });
      if (!provider) {
        return this.sendError(res, 'Provider not found', 404);
      }

      // Check experiencias limit
      const count = await ProviderExperiencia.countByProvider(providerId);
      if (count >= this.maxExperienciasPerProvider) {
        return this.sendError(res, `Maximum ${this.maxExperienciasPerProvider} experiencias per provider`, 400);
      }

      // Check name uniqueness for this provider
      const isUnique = await ProviderExperiencia.isNameUnique(providerId, name);
      if (!isUnique) {
        return this.sendError(res, 'An experiencia with this name already exists for this provider', 409);
      }

      // Create new experiencia
      const experiencia = new ProviderExperiencia();

      // Create proper Parse pointer for provider
      const providerPointer = {
        __type: 'Pointer',
        className: 'Experience',
        objectId: provider.id,
      };

      experiencia.setProvider(providerPointer);

      experiencia.setName(name);

      experiencia.setDescription(description);

      experiencia.setPrice(price || 0);

      if (tipo !== undefined && tipo !== null && tipo !== '') {
        experiencia.setTipo(tipo);
      }
      if (duration !== undefined && duration !== null) {
        experiencia.setDuration(duration);
      }
      if (minPeople !== undefined && minPeople !== null) {
        experiencia.setMinPeople(minPeople);
      }
      if (maxPeople !== undefined && maxPeople !== null) {
        experiencia.setMaxPeople(maxPeople);
      }
      if (displayOrder !== undefined && displayOrder !== null) {
        experiencia.setDisplayOrder(displayOrder);
      }
      if (availability !== undefined && availability !== null) {
        experiencia.setAvailability(availability);
      }

      // Set required lifecycle fields before validation
      experiencia.set('active', true);
      experiencia.set('exists', true);

      // Validate experiencia before saving
      const validation = experiencia.validateExplicitly();

      if (!validation.valid) {
        return this.sendError(res, validation.errors.join(', '), 400);
      }

      // Save experiencia
      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia created', {
        providerId,
        experienciaId: experiencia.id,
        name,
        userId: req.user.id,
      });

      return res.status(201).json({
        success: true,
        data: this.formatExperienciaForResponse(experiencia),
        message: 'Experiencia created successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.createExperiencia', {
        error: error.message,
        stack: error.stack,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create experiencia',
        500
      );
    }
  }

  /**
   * PUT /api/providers/:providerId/experiencias/:id - Update experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/providers/abc123/experiencias/xyz456
   */
  async updateExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;
      const {
        name,
        description,
        price,
        duration,
        min_people: minPeople,
        max_people: maxPeople,
        displayOrder,
        active,
        tipo,
        availability,
      } = req.body;

      // Get experiencia
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider', 403);
      }

      // Update fields
      if (name !== undefined) {
        // Check name uniqueness if changing
        if (name !== experiencia.getName()) {
          const isUnique = await ProviderExperiencia.isNameUnique(providerId, name, id);
          if (!isUnique) {
            return this.sendError(res, 'An experiencia with this name already exists for this provider', 409);
          }
        }
        experiencia.setName(name);
      }

      if (description !== undefined) experiencia.setDescription(description);
      if (price !== undefined) experiencia.setPrice(price);
      if (tipo !== undefined) experiencia.setTipo(tipo === '' ? null : tipo);
      if (duration !== undefined) experiencia.setDuration(duration);
      if (minPeople !== undefined) experiencia.setMinPeople(minPeople);
      if (maxPeople !== undefined) experiencia.setMaxPeople(maxPeople);
      if (displayOrder !== undefined) experiencia.setDisplayOrder(displayOrder);
      if (active !== undefined) experiencia.setActive(active);
      if (availability !== undefined) experiencia.setAvailability(availability);

      // Validate experiencia before saving
      const validation = experiencia.validateExplicitly();
      if (!validation.valid) {
        return this.sendError(res, validation.errors.join(', '), 400);
      }

      // Save
      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia updated', {
        providerId,
        experienciaId: id,
        updates: req.body,
        userId: req.user.id,
      });

      return res.json({
        success: true,
        data: this.formatExperienciaForResponse(experiencia),
        message: 'Experiencia updated successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.updateExperiencia', {
        error: error.message,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to update experiencia', 500);
    }
  }

  /**
   * DELETE /api/providers/:providerId/experiencias/:id - Delete experiencia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * DELETE /api/providers/abc123/experiencias/xyz456
   */
  async deleteExperiencia(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId, id } = req.params;

      // Get experiencia
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('objectId', id);
      query.equalTo('exists', true);
      query.include('provider');

      const experiencia = await query.first({ useMasterKey: true });

      if (!experiencia) {
        return this.sendError(res, 'Experiencia not found', 404);
      }

      // Verify it belongs to the specified provider
      if (experiencia.get('provider')?.id !== providerId) {
        return this.sendError(res, 'Experiencia does not belong to this provider', 403);
      }

      // Soft delete
      experiencia.setExists(false);
      experiencia.setActive(false);
      await experiencia.save(null, { useMasterKey: true });

      logger.info('Provider experiencia deleted', {
        providerId,
        experienciaId: id,
        name: experiencia.getName(),
        userId: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Experiencia deleted successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.deleteExperiencia', {
        error: error.message,
        providerId: req.params.providerId,
        experienciaId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to delete experiencia', 500);
    }
  }

  /**
   * PUT /api/providers/:providerId/experiencias/reorder - Reorder experiencias.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * PUT /api/providers/abc123/experiencias/reorder
   * Body: { experiencias: [{id: 'xyz', order: 0}, {id: 'abc', order: 1}] }
   */
  async reorderExperiencias(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { providerId } = req.params;
      const { experiencias } = req.body;

      if (!Array.isArray(experiencias)) {
        return this.sendError(res, 'Experiencias array is required', 400);
      }

      // Get all experiencias for this provider
      const providerExperiencias = await ProviderExperiencia.findByProvider(providerId);
      const experienciaMap = new Map(providerExperiencias.map((exp) => [exp.id, exp]));

      // Update display order for each experiencia
      const updates = experiencias.map((item) => {
        const experiencia = experienciaMap.get(item.id);
        if (experiencia) {
          experiencia.setDisplayOrder(item.order);
          return experiencia.save(null, { useMasterKey: true });
        }
        return Promise.resolve();
      });

      await Promise.all(updates);

      logger.info('Provider experiencias reordered', {
        providerId,
        count: updates.length,
        userId: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Experiencias reordered successfully',
      });
    } catch (error) {
      logger.error('Error in ProviderExperienciaController.reorderExperiencias', {
        error: error.message,
        providerId: req.params.providerId,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Failed to reorder experiencias', 500);
    }
  }

  /**
   * Format experiencia for response.
   * @param {ProviderExperiencia} experiencia - Experiencia object.
   * @returns {object} Formatted experiencia data.
   * @private
   * @example
   * const formatted = controller.formatExperienciaForResponse(experiencia);
   */
  formatExperienciaForResponse(experiencia) {
    return {
      id: experiencia.id,
      name: experiencia.getName(),
      description: experiencia.getDescription(),
      price: experiencia.getPrice(),
      tipo: experiencia.getTipo(),
      duration: experiencia.getDuration(),
      min_people: experiencia.getMinPeople(),
      max_people: experiencia.getMaxPeople(),
      displayOrder: experiencia.getDisplayOrder(),
      active: experiencia.isActive(),
      availability: experiencia.getAvailability(),
      createdAt: experiencia.createdAt,
      updatedAt: experiencia.updatedAt,
    };
  }

  /**
   * Send error response.
   * @param {object} res - Express response.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} Error response.
   * @private
   * @example
   * return this.sendError(res, 'Not found', 404);
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = new ProviderExperienciaController();
