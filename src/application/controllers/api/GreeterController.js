/**
 * GreeterController - RESTful API for Greeter Services Management.
 *
 * Provides Ajax-ready endpoints for managing greeter services catalog.
 * Read access: Client level and above (client, department_manager, admin, superadmin).
 * Write access: Admin and SuperAdmin roles only.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - DataTables server-side integration
 * - POI integration with Pointer references
 * - Price and service validation
 * - Comprehensive validation and audit logging.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/greeter - List greeter services with DataTables (client+)
 * POST /api/greeter - Create greeter service (admin+)
 * PUT /api/greeter/:id - Update greeter service (admin+)
 * DELETE /api/greeter/:id - Soft delete greeter service (admin+)
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * GreeterController class implementing RESTful API.
 */
class GreeterController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
  }

  /**
   * GET /api/greeter - Get greeter services with DataTables server-side processing.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getGreeterServices(req, res) {
    try {
      // DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';

      // Additional filters
      const poiId = req.query.poiId || null;

      logger.info('Fetching greeter services', {
        draw,
        start,
        length,
        searchValue,
        poiId,
      });

      // Build query
      const query = new Parse.Query('Greeter');
      // Show both active and inactive services, but not soft-deleted ones
      query.equalTo('exists', true);

      // Search filter
      if (searchValue) {
        query.contains('name', searchValue);
      }

      // POI filter
      if (poiId) {
        const poi = await new Parse.Query('POI').get(poiId, { useMasterKey: true });
        if (poi) {
          query.equalTo('poi', poi);
        }
      }

      // Include relations
      query.include(['poi']);

      // Count total records (before pagination)
      const totalQuery = new Parse.Query('Greeter');
      // Count both active and inactive services, but not soft-deleted ones
      totalQuery.equalTo('exists', true);
      if (searchValue) {
        totalQuery.contains('name', searchValue);
      }
      if (poiId) {
        const poi = await new Parse.Query('POI').get(poiId, { useMasterKey: true });
        if (poi) {
          totalQuery.equalTo('poi', poi);
        }
      }

      const recordsTotal = await new Parse.Query('Greeter').equalTo('exists', true).count({ useMasterKey: true });

      const recordsFiltered = await totalQuery.count({ useMasterKey: true });

      // Apply pagination and sorting
      query.skip(start);
      query.limit(length);
      query.ascending('name'); // Default sort by name

      const results = await query.find({ useMasterKey: true });

      // Format data for DataTables
      const data = results.map((greeter) => ({
        id: greeter.id,
        objectId: greeter.id,
        name: greeter.get('name') || '-',
        poi: greeter.get('poi')
          ? {
            id: greeter.get('poi').id,
            name: greeter.get('poi').get('name') || '-',
          }
          : null,
        price: greeter.get('price') || 0,
        description: greeter.get('description') || '-',
        duration: greeter.get('duration') || null,
        capacity: greeter.get('capacity') || null,
        active: greeter.get('active'),
        createdAt: greeter.get('createdAt'),
        updatedAt: greeter.get('updatedAt'),
      }));

      res.json({
        draw,
        recordsTotal,
        recordsFiltered,
        data,
        success: true,
      });
    } catch (error) {
      logger.error('Error fetching greeter services:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch greeter services',
        details: error.message,
      });
    }
  }

  /**
   * GET /api/greeter/:id - Get single greeter service by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getGreeterService(req, res) {
    try {
      const { id } = req.params;

      logger.info('Fetching greeter service by ID:', { id });

      const query = new Parse.Query('Greeter');
      query.include(['poi']);

      const greeter = await query.get(id, { useMasterKey: true });

      if (!greeter || !greeter.get('exists')) {
        return res.status(404).json({
          success: false,
          error: 'Greeter service not found',
        });
      }

      const data = {
        id: greeter.id,
        name: greeter.get('name'),
        poiId: greeter.get('poi') ? greeter.get('poi').id : null,
        price: greeter.get('price'),
        description: greeter.get('description'),
        duration: greeter.get('duration'),
        capacity: greeter.get('capacity'),
        active: greeter.get('active'),
        createdAt: greeter.get('createdAt'),
        updatedAt: greeter.get('updatedAt'),
        poi: greeter.get('poi')
          ? {
            id: greeter.get('poi').id,
            name: greeter.get('poi').get('name'),
          }
          : null,
      };

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error fetching greeter service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch greeter service',
        details: error.message,
      });
    }
  }

  /**
   * POST /api/greeter - Create new greeter service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async createGreeterService(req, res) {
    try {
      // Safety check for request body
      if (!req.body) {
        return res.status(400).json({
          success: false,
          error: 'Request body is missing',
        });
      }

      const {
        name, poiId, price, description, duration, capacity,
      } = req.body;

      logger.info('Creating new greeter service:', { name, poiId, price });

      // Validate required fields
      if (!poiId || price === undefined || price === null) {
        return res.status(400).json({
          success: false,
          error: 'POI and price are required',
        });
      }

      // Validate price
      const priceNum = parseFloat(price);
      if (Number.isNaN(priceNum) || priceNum <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Price must be a positive number',
        });
      }

      // Get POI
      let poi;
      try {
        const poiQuery = new Parse.Query('POI');
        poi = await poiQuery.get(poiId, { useMasterKey: true });
      } catch (error) {
        logger.error('POI not found:', error);
        return res.status(404).json({
          success: false,
          error: 'POI not found',
        });
      }

      // Check for duplicate name if provided
      if (name && name.trim()) {
        const existingQuery = new Parse.Query('Greeter');
        existingQuery.equalTo('name', name.trim());
        existingQuery.equalTo('exists', true);
        const existing = await existingQuery.first({ useMasterKey: true });

        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'A greeter service with this name already exists',
          });
        }
      }

      // Create new greeter service using Parse.Object directly
      const GreeterClass = Parse.Object.extend('Greeter');
      const greeter = new GreeterClass();

      // Set properties
      if (name && name.trim()) {
        greeter.set('name', name.trim());
      }
      greeter.set('poi', poi);
      greeter.set('price', priceNum);

      if (description && description.trim()) {
        greeter.set('description', description.trim());
      }

      if (duration) {
        const durationNum = parseInt(duration, 10);
        if (!Number.isNaN(durationNum) && durationNum > 0) {
          greeter.set('duration', durationNum);
        }
      }

      if (capacity) {
        const capacityNum = parseInt(capacity, 10);
        if (!Number.isNaN(capacityNum) && capacityNum > 0) {
          greeter.set('capacity', capacityNum);
        }
      }

      // Set default values
      greeter.set('active', true);
      greeter.set('exists', true);

      // Save the greeter
      const savedGreeter = await greeter.save(null, { useMasterKey: true });

      // Fetch with relations for response
      const query = new Parse.Query('Greeter');
      query.include('poi');
      const createdGreeter = await query.get(savedGreeter.id, { useMasterKey: true });

      const poiData = createdGreeter.get('poi');

      res.status(201).json({
        success: true,
        message: 'Greeter service created successfully',
        data: {
          id: createdGreeter.id,
          name: createdGreeter.get('name') || null,
          poiId: poiData ? poiData.id : null,
          price: createdGreeter.get('price'),
          description: createdGreeter.get('description') || null,
          duration: createdGreeter.get('duration') || null,
          capacity: createdGreeter.get('capacity') || null,
          active: createdGreeter.get('active'),
          poi: poiData
            ? {
              id: poiData.id,
              name: poiData.get('name'),
            }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error creating greeter service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create greeter service',
        details: error.message,
      });
    }
  }

  /**
   * PUT /api/greeter/:id - Update greeter service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async updateGreeterService(req, res) {
    try {
      const { id } = req.params;
      const {
        name, poiId, price, description, duration, capacity, active,
      } = req.body;

      logger.info('Updating greeter service:', {
        id,
        name,
        poiId,
        price,
      });

      // Get existing greeter service
      const greeter = await new Parse.Query('Greeter').get(id, { useMasterKey: true });

      if (!greeter || !greeter.get('exists')) {
        return res.status(404).json({
          success: false,
          error: 'Greeter service not found',
        });
      }

      // Validate if name is changing and unique
      if (name && name.trim() && name !== greeter.get('name')) {
        const existingQuery = new Parse.Query('Greeter');
        existingQuery.equalTo('name', name.trim());
        existingQuery.equalTo('exists', true);
        existingQuery.notEqualTo('objectId', id);
        const existing = await existingQuery.first({ useMasterKey: true });

        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'A greeter service with this name already exists',
          });
        }

        greeter.set('name', name.trim());
      }

      // Update POI if provided
      if (poiId) {
        const poi = await new Parse.Query('POI').get(poiId, { useMasterKey: true });
        if (!poi) {
          return res.status(404).json({
            success: false,
            error: 'POI not found',
          });
        }
        greeter.set('poi', poi);
      }

      // Update other fields
      if (price !== undefined && price !== null) {
        const priceNum = parseFloat(price);
        if (Number.isNaN(priceNum) || priceNum <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Price must be a positive number',
          });
        }
        greeter.set('price', priceNum);
      }

      if (description !== undefined) {
        greeter.set('description', description && description.trim() ? description.trim() : null);
      }

      if (duration !== undefined) {
        const durationNum = duration ? parseInt(duration, 10) : null;
        greeter.set('duration', !Number.isNaN(durationNum) ? durationNum : null);
      }

      if (capacity !== undefined) {
        const capacityNum = capacity ? parseInt(capacity, 10) : null;
        greeter.set('capacity', !Number.isNaN(capacityNum) ? capacityNum : null);
      }

      if (active !== undefined) {
        greeter.set('active', active);
      }

      const savedGreeter = await greeter.save(null, { useMasterKey: true });

      // Fetch updated greeter with relations
      const query = new Parse.Query('Greeter');
      query.include(['poi']);
      const updatedGreeter = await query.get(savedGreeter.id, { useMasterKey: true });

      res.json({
        success: true,
        message: 'Greeter service updated successfully',
        data: {
          id: updatedGreeter.id,
          name: updatedGreeter.get('name'),
          poiId: updatedGreeter.get('poi') ? updatedGreeter.get('poi').id : null,
          price: updatedGreeter.get('price'),
          description: updatedGreeter.get('description'),
          duration: updatedGreeter.get('duration'),
          capacity: updatedGreeter.get('capacity'),
          active: updatedGreeter.get('active'),
          poi: updatedGreeter.get('poi')
            ? {
              id: updatedGreeter.get('poi').id,
              name: updatedGreeter.get('poi').get('name'),
            }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error updating greeter service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update greeter service',
        details: error.message,
      });
    }
  }

  /**
   * DELETE /api/greeter/:id - Soft delete greeter service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async deleteGreeterService(req, res) {
    try {
      const { id } = req.params;

      logger.info('Soft deleting greeter service:', { id });

      const greeter = await new Parse.Query('Greeter').get(id, { useMasterKey: true });

      if (!greeter || !greeter.get('exists')) {
        return res.status(404).json({
          success: false,
          error: 'Greeter service not found',
        });
      }

      // Soft delete by setting exists to false
      greeter.set('exists', false);
      greeter.set('active', false);
      await greeter.save(null, { useMasterKey: true });

      res.json({
        success: true,
        message: 'Greeter service deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting greeter service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete greeter service',
        details: error.message,
      });
    }
  }
}

module.exports = GreeterController;
