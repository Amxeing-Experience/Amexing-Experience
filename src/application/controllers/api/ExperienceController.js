/**
 * ExperienceController - RESTful API for Experience Management.
 *
 * Provides Ajax-ready endpoints for managing experiences and providers catalog.
 * Restricted to Admin and SuperAdmin roles.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - DataTables server-side integration
 * - Array of Pointers for experience relationships (packages)
 * - Type filtering (Experience vs Provider)
 * - Comprehensive validation and audit logging.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/experiences - List experiences with DataTables
 * POST /api/experiences - Create experience
 * PUT /api/experiences/:id - Update experience
 * DELETE /api/experiences/:id - Soft delete experience
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * ExperienceController class implementing RESTful API.
 */
class ExperienceController {
  constructor() {
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
    this.maxExperiencesPerPackage = 20;
    this.maxToursPerPackage = 20;
    this.maxTotalItemsPerPackage = 30;
  }

  /**
   * GET /api/experiences - Get experiences with DataTables server-side processing.
   *
   * Supports type filtering via query parameter: ?type=Experience or ?type=Provider.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getExperiences(req, res) {
    try {
      if (!req.user) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const params = this.parseDataTablesParams(req.query);
      const columns = ['name', 'description', 'cost', 'updatedAt'];
      const sortField = columns[params.sortColumnIndex] || 'updatedAt';

      // Get total records count
      const totalQuery = this.buildBaseQuery(params.typeFilter, null);
      const recordsTotal = await totalQuery.count({ useMasterKey: true });

      // Build filtered query
      const filteredQuery = params.searchValue
        ? this.buildSearchQuery(params.searchValue, params.typeFilter, params.excludeId)
        : this.buildBaseQuery(params.typeFilter, params.excludeId);

      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting and pagination
      filteredQuery[params.sortDirection === 'asc' ? 'ascending' : 'descending'](sortField);
      filteredQuery.include('experiences');
      filteredQuery.include('vehicleType');
      filteredQuery.include('tours');
      filteredQuery.skip(params.start);
      filteredQuery.limit(params.length);

      // Execute and format
      const experiences = await filteredQuery.find({ useMasterKey: true });
      const data = experiences.map((exp) => this.formatExperienceForDataTable(exp));

      return res.json({
        draw: params.draw,
        recordsTotal,
        recordsFiltered,
        data,
      });
    } catch (error) {
      logger.error('Error in ExperienceController.getExperiences', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve experiences',
        500
      );
    }
  }

  /**
   * GET /api/experiences/:id - Get single experience by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  /**
   * Formats vehicle type data for API response.
   * @param {Parse.Object} vehicleType - Vehicle type object.
   * @returns {object|null} Formatted vehicle type data.
   * @example
   */
  formatVehicleType(vehicleType) {
    return vehicleType ? {
      id: vehicleType.id,
      name: vehicleType.get('name'),
      code: vehicleType.get('code'),
      defaultCapacity: vehicleType.get('defaultCapacity'),
      trunkCapacity: vehicleType.get('trunkCapacity'),
    } : null;
  }

  /**
   * Formats experience details for API response.
   * @param {Array<Parse.Object>} experiences - Array of experience objects.
   * @returns {Array<object>} Formatted experience details.
   * @example
   */
  formatExperienceDetails(experiences) {
    return experiences.map((exp) => ({
      id: exp.id,
      name: exp.get('name'),
      description: exp.get('description'),
      cost: exp.get('cost'),
    }));
  }

  /**
   * Formats tour details for API response.
   * @param {Array<Parse.Object>} tours - Array of tour objects.
   * @returns {Array<object>} Formatted tour details.
   * @example
   */
  formatTourDetails(tours) {
    return tours.map((tour) => ({
      id: tour.id,
      destinationPOI: tour.get('destinationPOI'),
      time: tour.get('time'),
      vehicleType: tour.get('vehicleType'),
      price: tour.get('price'),
      rate: tour.get('rate'),
    }));
  }

  /**
   * Formats complete experience data for API response.
   * @param {Parse.Object} experience - Experience object.
   * @param {Array<Parse.Object>} includedExperiences - Included experiences.
   * @param {Array<Parse.Object>} includedTours - Included tours.
   * @param {Parse.Object} vehicleType - Vehicle type object.
   * @returns {object} Formatted experience data.
   * @example
   */
  formatExperienceData(experience, includedExperiences, includedTours, vehicleType) {
    return {
      id: experience.id,
      name: experience.get('name'),
      description: experience.get('description'),
      type: experience.get('type'),
      providerType: experience.get('providerType'),
      duration: experience.get('duration'),
      cost: experience.get('cost'),
      vehicleType: this.formatVehicleType(vehicleType),
      vehicleTypeId: vehicleType ? vehicleType.id : null,
      experiences: includedExperiences.map((exp) => exp.id),
      experienceDetails: this.formatExperienceDetails(includedExperiences),
      tours: includedTours.map((tour) => tour.id),
      tourDetails: this.formatTourDetails(includedTours),
      active: experience.get('active'),
      createdAt: experience.createdAt,
      updatedAt: experience.updatedAt,
    };
  }

  async getExperienceById(req, res) {
    try {
      const currentUser = req.user;
      const experienceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      const query = new Parse.Query('Experience');
      query.equalTo('exists', true);
      query.include('experiences');
      query.include('vehicleType');

      const experience = await query.get(experienceId, { useMasterKey: true });

      if (!experience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      const includedExperiences = experience.get('experiences') || [];
      const includedTours = experience.get('tours') || [];
      const vehicleType = experience.get('vehicleType');

      const data = this.formatExperienceData(experience, includedExperiences, includedTours, vehicleType);

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in ExperienceController.getExperienceById', {
        error: error.message,
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return this.sendError(res, 'Experience not found', 404);
      }

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to retrieve experience',
        500
      );
    }
  }

  /**
   * POST /api/experiences - Create new experience.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  /**
   * Validates input data for creating an experience.
   * @param {object} data - Request body data.
   * @returns {object|null} Validation error or null if valid.
   * @example
   */
  validateCreateExperienceInput(data) {
    const {
      name, description, type, providerType, duration, cost,
    } = data;

    if (!name || !description || !type || cost === undefined) {
      return { error: 'Required fields: name, description, type, cost', status: 400 };
    }

    if (!['Experience', 'Provider'].includes(type)) {
      return { error: 'Type must be Experience or Provider', status: 400 };
    }

    if (type === 'Provider' && providerType) {
      if (!['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
        return { error: 'Provider type must be Exclusivo, Compartido, or Privado', status: 400 };
      }
    }

    if (cost < 0) {
      return { error: 'Cost must be greater than or equal to 0', status: 400 };
    }

    if (duration !== undefined && duration !== null && duration !== '') {
      if (Number.isNaN(parseFloat(duration)) || parseFloat(duration) < 0) {
        return { error: 'Duration must be a positive number', status: 400 };
      }
    }

    if (name.length > 200) {
      return { error: 'Name must be 200 characters or less', status: 400 };
    }

    if (description.length > 1000) {
      return { error: 'Description must be 1000 characters or less', status: 400 };
    }

    return null;
  }

  /**
   * Validates experience and tour arrays.
   * @param {Array} experiences - Experience IDs array.
   * @param {Array} tours - Tour IDs array.
   * @returns {object|null} Validation error or null if valid.
   * @example
   */
  validateExperienceArrays(experiences, tours) {
    if (experiences && experiences.length > this.maxExperiencesPerPackage) {
      return { error: `Maximum ${this.maxExperiencesPerPackage} experiences per package`, status: 400 };
    }

    if (tours && tours.length > this.maxToursPerPackage) {
      return { error: `Maximum ${this.maxToursPerPackage} tours per package`, status: 400 };
    }

    const totalItems = (experiences ? experiences.length : 0) + (tours ? tours.length : 0);
    if (totalItems > this.maxTotalItemsPerPackage) {
      return { error: `Maximum ${this.maxTotalItemsPerPackage} total items (experiences + tours) per package`, status: 400 };
    }

    return null;
  }

  /**
   * Processes experience and tour relationships.
   * @param {Parse.Object} experienceObj - Experience object to set relationships on.
   * @param {Array} experiences - Experience IDs array.
   * @param {Array} tours - Tour IDs array.
   * @returns {object|null} Error object or null if successful.
   * @example
   */
  async processExperienceRelationships(experienceObj, experiences, tours) {
    try {
      // Process experiences
      if (experiences && experiences.length > 0) {
        const experiencePointers = [];
        for (const expId of experiences) {
          const expQuery = new Parse.Query('Experience');
          const exp = await expQuery.get(expId, { useMasterKey: true });
          if (!exp) {
            return { error: `Experience ${expId} not found`, status: 404 };
          }
          experiencePointers.push(exp);
        }
        experienceObj.set('experiences', experiencePointers);
      } else {
        experienceObj.set('experiences', []);
      }

      // Process tours
      if (tours && tours.length > 0) {
        const tourPointers = [];
        for (const tourId of tours) {
          const tourQuery = new Parse.Query('Tours');
          const tour = await tourQuery.get(tourId, { useMasterKey: true });
          if (!tour) {
            return { error: `Tour ${tourId} not found`, status: 404 };
          }
          tourPointers.push(tour);
        }
        experienceObj.set('tours', tourPointers);
      } else {
        experienceObj.set('tours', []);
      }

      return null;
    } catch (error) {
      return { error: 'Failed to process relationships', status: 404 };
    }
  }

  /**
   * Processes vehicle type relationship.
   * @param {Parse.Object} experienceObj - Experience object.
   * @param {string} vehicleType - Vehicle type ID.
   * @returns {object|null} Error object or null if successful.
   * @example
   */
  async processVehicleTypeRelationship(experienceObj, vehicleType) {
    if (!vehicleType || vehicleType.trim() === '') {
      return null;
    }

    try {
      const vehicleTypeQuery = new Parse.Query('VehicleType');
      vehicleTypeQuery.equalTo('exists', true);
      vehicleTypeQuery.equalTo('active', true);
      const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });
      if (!vehicleTypeObj) {
        return { error: `Vehicle type ${vehicleType} not found or inactive`, status: 404 };
      }
      experienceObj.set('vehicleType', vehicleTypeObj);
      return null;
    } catch (error) {
      return { error: `Vehicle type ${vehicleType} not found or inactive`, status: 404 };
    }
  }

  /**
   * Creates and populates a new experience object.
   * @param {object} data - Experience data.
   * @returns {Parse.Object} New experience object.
   * @example
   */
  createExperienceObject(data) {
    const {
      name, description, type, providerType, duration, cost,
    } = data;

    const Experience = Parse.Object.extend('Experience');
    const experienceObj = new Experience();

    experienceObj.set('name', name);
    experienceObj.set('description', description);
    experienceObj.set('type', type);
    if (type === 'Provider' && providerType) {
      experienceObj.set('providerType', providerType);
    }
    if (duration !== undefined && duration !== null && duration !== '') {
      experienceObj.set('duration', parseFloat(duration));
    }
    experienceObj.set('cost', parseFloat(cost));
    experienceObj.set('active', true);
    experienceObj.set('exists', true);

    return experienceObj;
  }

  /**
   * Saves experience object with audit context.
   * @param {Parse.Object} experienceObj - Experience object to save.
   * @param {Parse.User} currentUser - Current user for audit trail.
   * @returns {Promise<void>}
   * @example
   */
  async saveExperienceWithAudit(experienceObj, currentUser) {
    await experienceObj.save(null, {
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
  }

  /**
   * Handles createExperience success response and logging.
   * @param {object} res - Express response object.
   * @param {Parse.Object} experienceObj - Created experience object.
   * @param {object} reqBody - Original request body.
   * @param {string} userId - Current user ID.
   * @returns {object} JSON response.
   * @example
   */
  handleCreateExperienceSuccess(res, experienceObj, reqBody, userId) {
    logger.info('Experience created successfully', {
      experienceId: experienceObj.id,
      name: reqBody.name,
      type: reqBody.type,
      userId,
    });

    return res.status(201).json({
      success: true,
      message: 'Experience created successfully',
      data: {
        id: experienceObj.id,
        name: experienceObj.get('name'),
        type: experienceObj.get('type'),
      },
    });
  }

  async createExperience(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const { experiences, tours, vehicleType } = req.body;

      // Validate input
      const inputValidation = this.validateCreateExperienceInput(req.body);
      if (inputValidation) {
        return this.sendError(res, inputValidation.error, inputValidation.status);
      }

      // Validate arrays
      const arrayValidation = this.validateExperienceArrays(experiences, tours);
      if (arrayValidation) {
        return this.sendError(res, arrayValidation.error, arrayValidation.status);
      }

      // Create and setup experience object
      const experienceObj = this.createExperienceObject(req.body);

      // Process relationships
      const relationshipError = await this.processExperienceRelationships(experienceObj, experiences, tours);
      if (relationshipError) {
        return this.sendError(res, relationshipError.error, relationshipError.status);
      }

      const vehicleTypeError = await this.processVehicleTypeRelationship(experienceObj, vehicleType);
      if (vehicleTypeError) {
        return this.sendError(res, vehicleTypeError.error, vehicleTypeError.status);
      }

      // Save and respond
      await this.saveExperienceWithAudit(experienceObj, currentUser);
      return this.handleCreateExperienceSuccess(res, experienceObj, req.body, currentUser.id);
    } catch (error) {
      logger.error('Error in ExperienceController.createExperience', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to create experience',
        500
      );
    }
  }

  /**
   * Validates and updates basic experience fields
   * @param {Parse.Object} experienceObj - Experience object to update
   * @param {object} data - Update data
   * @returns {object|null} Validation error or null if valid
   */
  validateAndUpdateBasicFields(experienceObj, data) {
    const {
      name, description, cost, duration, providerType, active,
    } = data;

    if (name !== undefined) {
      if (!name) {
        return { error: 'Name cannot be empty', status: 400 };
      }
      if (name.length > 200) {
        return { error: 'Name must be 200 characters or less', status: 400 };
      }
      experienceObj.set('name', name);
    }

    if (description !== undefined) {
      if (!description) {
        return { error: 'Description cannot be empty', status: 400 };
      }
      if (description.length > 1000) {
        return { error: 'Description must be 1000 characters or less', status: 400 };
      }
      experienceObj.set('description', description);
    }

    if (cost !== undefined) {
      if (cost < 0) {
        return { error: 'Cost must be greater than or equal to 0', status: 400 };
      }
      experienceObj.set('cost', parseFloat(cost));
    }

    if (duration !== undefined) {
      if (duration === null || duration === '') {
        experienceObj.set('duration', null);
      } else {
        if (Number.isNaN(parseFloat(duration)) || parseFloat(duration) < 0) {
          return { error: 'Duration must be a positive number', status: 400 };
        }
        experienceObj.set('duration', parseFloat(duration));
      }
    }

    if (providerType !== undefined) {
      const currentType = experienceObj.get('type');
      if (currentType === 'Provider') {
        if (providerType && !['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
          return { error: 'Provider type must be Exclusivo, Compartido, or Privado', status: 400 };
        }
        experienceObj.set('providerType', providerType || null);
      }
    }

    if (active !== undefined) {
      experienceObj.set('active', active);
    }

    return null;
  }

  /**
   * Updates experience relationships (experiences and tours)
   * @param {Parse.Object} experienceObj - Experience object to update
   * @param {string} experienceId - Current experience ID (to prevent self-inclusion)
   * @param {object} data - Update data containing experiences and tours arrays
   * @returns {object|null} Error object or null if successful
   */
  async updateExperienceRelationships(experienceObj, experienceId, data) {
    const { experiences, tours } = data;

    // Update experiences array
    if (experiences !== undefined) {
      if (experiences.length > this.maxExperiencesPerPackage) {
        return { error: `Maximum ${this.maxExperiencesPerPackage} experiences per package`, status: 400 };
      }
      if (experiences.includes(experienceId)) {
        return { error: 'An experience cannot include itself', status: 400 };
      }

      if (experiences.length > 0) {
        const experiencePointers = [];
        for (const expId of experiences) {
          try {
            const expQuery = new Parse.Query('Experience');
            const exp = await expQuery.get(expId, { useMasterKey: true });
            if (!exp) return { error: `Experience ${expId} not found`, status: 404 };
            experiencePointers.push(exp);
          } catch (error) {
            return { error: `Experience ${expId} not found`, status: 404 };
          }
        }
        experienceObj.set('experiences', experiencePointers);
      } else {
        experienceObj.set('experiences', []);
      }
    }

    // Update tours array
    if (tours !== undefined) {
      if (tours.length > this.maxToursPerPackage) {
        return { error: `Maximum ${this.maxToursPerPackage} tours per package`, status: 400 };
      }

      const currentExperiences = experiences !== undefined ? experiences : (experienceObj.get('experiences') || []);
      if (currentExperiences.length + tours.length > this.maxTotalItemsPerPackage) {
        return { error: `Maximum ${this.maxTotalItemsPerPackage} total items per package`, status: 400 };
      }

      if (tours.length > 0) {
        const tourPointers = [];
        for (const tourId of tours) {
          try {
            const tourQuery = new Parse.Query('Tours');
            const tour = await tourQuery.get(tourId, { useMasterKey: true });
            if (!tour) return { error: `Tour ${tourId} not found`, status: 404 };
            tourPointers.push(tour);
          } catch (error) {
            return { error: `Tour ${tourId} not found`, status: 404 };
          }
        }
        experienceObj.set('tours', tourPointers);
      } else {
        experienceObj.set('tours', []);
      }
    }

    return null;
  }

  /**
   * Updates vehicle type relationship for experience
   * @param {Parse.Object} experienceObj - Experience object to update
   * @param {string} vehicleType - Vehicle type ID or empty to clear
   * @returns {object|null} Error object or null if successful
   */
  async updateVehicleTypeRelationship(experienceObj, vehicleType) {
    if (vehicleType === undefined) {
      return null;
    }

    if (vehicleType && vehicleType.trim() !== '') {
      try {
        const vehicleTypeQuery = new Parse.Query('VehicleType');
        vehicleTypeQuery.equalTo('exists', true);
        vehicleTypeQuery.equalTo('active', true);
        const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });
        if (!vehicleTypeObj) {
          return { error: `Vehicle type ${vehicleType} not found or inactive`, status: 404 };
        }
        experienceObj.set('vehicleType', vehicleTypeObj);
      } catch (error) {
        return { error: `Vehicle type ${vehicleType} not found or inactive`, status: 404 };
      }
    } else {
      experienceObj.unset('vehicleType');
    }

    return null;
  }

  /**
   * PUT /api/experiences/:id - Update experience.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async updateExperience(req, res) {
    try {
      const currentUser = req.user;
      const experienceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }
      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      // Get existing experience
      const query = new Parse.Query('Experience');
      const experienceObj = await query.get(experienceId, { useMasterKey: true });
      if (!experienceObj) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Validate and update all fields and relationships
      const basicFieldsError = this.validateAndUpdateBasicFields(experienceObj, req.body);
      if (basicFieldsError) {
        return this.sendError(res, basicFieldsError.error, basicFieldsError.status);
      }

      const relationshipsError = await this.updateExperienceRelationships(experienceObj, experienceId, req.body);
      if (relationshipsError) {
        return this.sendError(res, relationshipsError.error, relationshipsError.status);
      }

      const vehicleTypeError = await this.updateVehicleTypeRelationship(experienceObj, req.body.vehicleType);
      if (vehicleTypeError) {
        return this.sendError(res, vehicleTypeError.error, vehicleTypeError.status);
      }

      // Save and respond
      await this.saveExperienceWithAudit(experienceObj, currentUser);

      logger.info('Experience updated successfully', {
        experienceId: experienceObj.id,
        userId: currentUser.id,
        updates: req.body,
      });

      return res.json({
        success: true,
        message: 'Experience updated successfully',
        data: { id: experienceObj.id, name: experienceObj.get('name') },
      });
    } catch (error) {
      logger.error('Error in ExperienceController.updateExperience', {
        error: error.message,
        stack: error.stack,
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return this.sendError(res, 'Experience not found', 404);
      }

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to update experience',
        500
      );
    }
  }

  /**
   * DELETE /api/experiences/:id - Soft delete experience.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async deleteExperience(req, res) {
    try {
      const currentUser = req.user;
      const experienceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      const query = new Parse.Query('Experience');
      const experience = await query.get(experienceId, { useMasterKey: true });

      if (!experience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Soft delete: set exists to false with user context for audit trail
      experience.set('exists', false);
      experience.set('active', false);
      await experience.save(null, {
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

      logger.info('Experience soft deleted successfully', {
        experienceId: experience.id,
        name: experience.get('name'),
        userId: currentUser.id,
      });

      return res.json({
        success: true,
        message: 'Experience deleted successfully',
      });
    } catch (error) {
      logger.error('Error in ExperienceController.deleteExperience', {
        error: error.message,
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return this.sendError(res, 'Experience not found', 404);
      }

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to delete experience',
        500
      );
    }
  }

  /**
   * GET /api/experiences/:id/dependencies - Check if experience/provider is being used.
   *
   * Checks if the experience or provider is included in other experiences.
   * Used for validation before deactivate or delete operations.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/experiences/abc123/dependencies
   * Response: { success: true, canModify: false, dependencyCount: 2, dependencies: [{id, name}] }
   */
  async checkDependencies(req, res) {
    try {
      const currentUser = req.user;
      const experienceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      // Verify experience exists
      const experienceQuery = new Parse.Query('Experience');
      const targetExperience = await experienceQuery.get(experienceId, {
        useMasterKey: true,
      });

      if (!targetExperience || !targetExperience.get('exists')) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Find all experiences that include this experience in their experiences array
      const dependencyQuery = new Parse.Query('Experience');
      dependencyQuery.equalTo('exists', true);
      dependencyQuery.equalTo('experiences', targetExperience);
      dependencyQuery.select(['name', 'type']);

      const dependencies = await dependencyQuery.find({ useMasterKey: true });

      const dependencyData = dependencies.map((dep) => ({
        id: dep.id,
        name: dep.get('name'),
        type: dep.get('type'),
      }));

      return res.json({
        success: true,
        canModify: dependencies.length === 0,
        dependencyCount: dependencies.length,
        dependencies: dependencyData,
        targetName: targetExperience.get('name'),
        targetType: targetExperience.get('type'),
      });
    } catch (error) {
      logger.error('Error in ExperienceController.checkDependencies', {
        error: error.message,
        experienceId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return this.sendError(res, 'Experience not found', 404);
      }

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Failed to check dependencies',
        500
      );
    }
  }

  /**
   * Parse DataTables request parameters.
   * @param {object} query - Request query object.
   * @returns {object} Parsed parameters.
   * @private
   * @example
   */
  parseDataTablesParams(query) {
    return {
      draw: parseInt(query.draw, 10) || 1,
      start: parseInt(query.start, 10) || 0,
      length: Math.min(
        parseInt(query.length, 10) || this.defaultPageSize,
        this.maxPageSize
      ),
      searchValue: query.search?.value || '',
      sortColumnIndex: parseInt(query.order?.[0]?.column, 10) || 0,
      sortDirection: query.order?.[0]?.dir || 'asc',
      typeFilter: query.type,
      excludeId: query.excludeId,
    };
  }

  /**
   * Build base query for experiences.
   * @param {string} typeFilter - Type filter (Experience/Provider).
   * @param {string} excludeId - ID to exclude.
   * @returns {Parse.Query} Base query.
   * @private
   * @example
   */
  buildBaseQuery(typeFilter, excludeId) {
    const query = new Parse.Query('Experience');
    query.equalTo('exists', true);
    if (typeFilter && ['Experience', 'Provider'].includes(typeFilter)) {
      query.equalTo('type', typeFilter);
    }
    if (excludeId) {
      query.notEqualTo('objectId', excludeId);
    }
    return query;
  }

  /**
   * Build search query with filters.
   * @param {string} searchValue - Search term.
   * @param {string} typeFilter - Type filter (Experience/Provider).
   * @param {string} excludeId - ID to exclude.
   * @returns {Parse.Query} Filtered query.
   * @private
   * @example
   */
  buildSearchQuery(searchValue, typeFilter, excludeId) {
    const nameQuery = new Parse.Query('Experience');
    nameQuery.equalTo('exists', true);
    if (typeFilter) nameQuery.equalTo('type', typeFilter);
    if (excludeId) nameQuery.notEqualTo('objectId', excludeId);
    nameQuery.matches('name', searchValue, 'i');

    const descQuery = new Parse.Query('Experience');
    descQuery.equalTo('exists', true);
    if (typeFilter) descQuery.equalTo('type', typeFilter);
    if (excludeId) descQuery.notEqualTo('objectId', excludeId);
    descQuery.matches('description', searchValue, 'i');

    return Parse.Query.or(nameQuery, descQuery);
  }

  /**
   * Format experience data for DataTables.
   * @param {Parse.Object} experience - Experience object.
   * @returns {object} Formatted experience data.
   * @private
   * @example
   */
  formatExperienceForDataTable(experience) {
    const includedExperiences = experience.get('experiences') || [];
    const includedTours = experience.get('tours') || [];
    const vehicleType = experience.get('vehicleType');

    return {
      id: experience.id,
      objectId: experience.id,
      name: experience.get('name'),
      description: experience.get('description'),
      type: experience.get('type'),
      providerType: experience.get('providerType'),
      duration: experience.get('duration'),
      cost: experience.get('cost'),
      vehicleType: vehicleType
        ? {
          id: vehicleType.id,
          name: vehicleType.get('name'),
          code: vehicleType.get('code'),
        }
        : null,
      vehicleTypeId: vehicleType ? vehicleType.id : null,
      experiences: includedExperiences.map((exp) => ({
        id: exp.id,
        name: exp.get('name'),
      })),
      tours: includedTours.map((tour) => ({
        id: tour.id,
        destinationPOI: tour.get('destinationPOI'),
        time: tour.get('time'),
      })),
      experienceCount: includedExperiences.length,
      tourCount: includedTours.length,
      totalItemCount: includedExperiences.length + includedTours.length,
      active: experience.get('active'),
      createdAt: experience.createdAt,
      updatedAt: experience.updatedAt,
    };
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} status - HTTP status code.
   * @returns {object} Express response.
   * @example
   * // Usage example documented above
   */
  sendError(res, message, status = 500) {
    return res.status(status).json({
      success: false,
      error: message,
    });
  }
}

module.exports = new ExperienceController();
