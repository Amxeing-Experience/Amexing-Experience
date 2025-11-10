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
      const data = experiences.map((exp) => this.formatExperienceData(exp));

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

      const data = {
        id: experience.id,
        name: experience.get('name'),
        description: experience.get('description'),
        type: experience.get('type'),
        providerType: experience.get('providerType'),
        duration: experience.get('duration'),
        cost: experience.get('cost'),
        vehicleType: vehicleType ? {
          id: vehicleType.id,
          name: vehicleType.get('name'),
          code: vehicleType.get('code'),
          defaultCapacity: vehicleType.get('defaultCapacity'),
          trunkCapacity: vehicleType.get('trunkCapacity'),
        } : null,
        vehicleTypeId: vehicleType ? vehicleType.id : null,
        experiences: includedExperiences.map((exp) => exp.id),
        experienceDetails: includedExperiences.map((exp) => ({
          id: exp.id,
          name: exp.get('name'),
          description: exp.get('description'),
          cost: exp.get('cost'),
        })),
        tours: includedTours.map((tour) => tour.id),
        tourDetails: includedTours.map((tour) => ({
          id: tour.id,
          destinationPOI: tour.get('destinationPOI'),
          time: tour.get('time'),
          vehicleType: tour.get('vehicleType'),
          price: tour.get('price'),
          rate: tour.get('rate'),
        })),
        active: experience.get('active'),
        createdAt: experience.createdAt,
        updatedAt: experience.updatedAt,
      };

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
  async createExperience(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const {
        name, description, type, providerType, duration, cost, experiences, tours, vehicleType,
      } = req.body;

      // Validation
      if (!name || !description || !type || cost === undefined) {
        return this.sendError(res, 'Required fields: name, description, type, cost', 400);
      }

      if (!['Experience', 'Provider'].includes(type)) {
        return this.sendError(res, 'Type must be Experience or Provider', 400);
      }

      // Validate providerType for Provider type (optional field)
      if (type === 'Provider' && providerType) {
        if (!['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
          return this.sendError(res, 'Provider type must be Exclusivo, Compartido, or Privado', 400);
        }
      }

      if (cost < 0) {
        return this.sendError(res, 'Cost must be greater than or equal to 0', 400);
      }

      // Validate duration (optional field)
      if (duration !== undefined && duration !== null && duration !== '') {
        if (Number.isNaN(parseFloat(duration)) || parseFloat(duration) < 0) {
          return this.sendError(res, 'Duration must be a positive number', 400);
        }
      }

      if (name.length > 200) {
        return this.sendError(res, 'Name must be 200 characters or less', 400);
      }

      if (description.length > 1000) {
        return this.sendError(res, 'Description must be 1000 characters or less', 400);
      }

      // Validate experiences array
      if (experiences && experiences.length > this.maxExperiencesPerPackage) {
        return this.sendError(res, `Maximum ${this.maxExperiencesPerPackage} experiences per package`, 400);
      }

      // Validate tours array
      if (tours && tours.length > this.maxToursPerPackage) {
        return this.sendError(res, `Maximum ${this.maxToursPerPackage} tours per package`, 400);
      }

      // Validate total items count (experiences + tours)
      const totalItems = (experiences ? experiences.length : 0) + (tours ? tours.length : 0);
      if (totalItems > this.maxTotalItemsPerPackage) {
        return this.sendError(res, `Maximum ${this.maxTotalItemsPerPackage} total items (experiences + tours) per package`, 400);
      }

      // Create experience object
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

      // Convert experience IDs to Pointers
      if (experiences && experiences.length > 0) {
        const experiencePointers = [];
        for (const expId of experiences) {
          try {
            // Validate that experience exists
            const expQuery = new Parse.Query('Experience');
            const exp = await expQuery.get(expId, { useMasterKey: true });
            if (!exp) {
              return this.sendError(res, `Experience ${expId} not found`, 404);
            }
            experiencePointers.push(exp);
          } catch (error) {
            return this.sendError(res, `Experience ${expId} not found`, 404);
          }
        }
        experienceObj.set('experiences', experiencePointers);
      } else {
        experienceObj.set('experiences', []);
      }

      // Convert tour IDs to Pointers
      if (tours && tours.length > 0) {
        const tourPointers = [];
        for (const tourId of tours) {
          try {
            // Validate that tour exists
            const tourQuery = new Parse.Query('Tours');
            const tour = await tourQuery.get(tourId, { useMasterKey: true });
            if (!tour) {
              return this.sendError(res, `Tour ${tourId} not found`, 404);
            }
            tourPointers.push(tour);
          } catch (error) {
            return this.sendError(res, `Tour ${tourId} not found`, 404);
          }
        }
        experienceObj.set('tours', tourPointers);
      } else {
        experienceObj.set('tours', []);
      }

      // Handle optional vehicleType relationship
      if (vehicleType && vehicleType.trim() !== '') {
        try {
          const vehicleTypeQuery = new Parse.Query('VehicleType');
          vehicleTypeQuery.equalTo('exists', true);
          vehicleTypeQuery.equalTo('active', true);
          const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });
          if (!vehicleTypeObj) {
            return this.sendError(res, `Vehicle type ${vehicleType} not found or inactive`, 404);
          }
          experienceObj.set('vehicleType', vehicleTypeObj);
        } catch (error) {
          return this.sendError(res, `Vehicle type ${vehicleType} not found or inactive`, 404);
        }
      }

      // Save experience with user context for audit trail
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

      logger.info('Experience created successfully', {
        experienceId: experienceObj.id,
        name,
        type,
        userId: currentUser.id,
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

      const {
        name, description, providerType, duration, cost, experiences, tours, active, vehicleType,
      } = req.body;

      // Get existing experience
      const query = new Parse.Query('Experience');
      const experienceObj = await query.get(experienceId, {
        useMasterKey: true,
      });

      if (!experienceObj) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Validation
      if (name !== undefined) {
        if (!name) {
          return this.sendError(res, 'Name cannot be empty', 400);
        }
        if (name.length > 200) {
          return this.sendError(res, 'Name must be 200 characters or less', 400);
        }
        experienceObj.set('name', name);
      }

      if (description !== undefined) {
        if (!description) {
          return this.sendError(res, 'Description cannot be empty', 400);
        }
        if (description.length > 1000) {
          return this.sendError(res, 'Description must be 1000 characters or less', 400);
        }
        experienceObj.set('description', description);
      }

      if (cost !== undefined) {
        if (cost < 0) {
          return this.sendError(res, 'Cost must be greater than or equal to 0', 400);
        }
        experienceObj.set('cost', parseFloat(cost));
      }

      if (duration !== undefined) {
        if (duration === null || duration === '') {
          // Allow clearing the duration field
          experienceObj.set('duration', null);
        } else {
          if (Number.isNaN(parseFloat(duration)) || parseFloat(duration) < 0) {
            return this.sendError(res, 'Duration must be a positive number', 400);
          }
          experienceObj.set('duration', parseFloat(duration));
        }
      }

      if (providerType !== undefined) {
        // Only validate and set providerType if this is a Provider
        const currentType = experienceObj.get('type');
        if (currentType === 'Provider') {
          if (providerType && !['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
            return this.sendError(res, 'Provider type must be Exclusivo, Compartido, or Privado', 400);
          }
          // Allow empty/null providerType to clear the field
          experienceObj.set('providerType', providerType || null);
        }
      }

      if (active !== undefined) {
        experienceObj.set('active', active);
      }

      // Update experiences array
      if (experiences !== undefined) {
        if (experiences.length > this.maxExperiencesPerPackage) {
          return this.sendError(res, `Maximum ${this.maxExperiencesPerPackage} experiences per package`, 400);
        }

        // Prevent self-inclusion
        if (experiences.includes(experienceId)) {
          return this.sendError(res, 'An experience cannot include itself', 400);
        }

        // Convert experience IDs to Pointers
        if (experiences.length > 0) {
          const experiencePointers = [];
          for (const expId of experiences) {
            try {
              const expQuery = new Parse.Query('Experience');
              const exp = await expQuery.get(expId, { useMasterKey: true });
              if (!exp) {
                return this.sendError(res, `Experience ${expId} not found`, 404);
              }
              experiencePointers.push(exp);
            } catch (error) {
              return this.sendError(res, `Experience ${expId} not found`, 404);
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
          return this.sendError(res, `Maximum ${this.maxToursPerPackage} tours per package`, 400);
        }

        // Validate total items count (experiences + tours)
        const currentExperiences = experiences !== undefined ? experiences : (experienceObj.get('experiences') || []);
        const totalItems = currentExperiences.length + tours.length;
        if (totalItems > this.maxTotalItemsPerPackage) {
          return this.sendError(res, `Maximum ${this.maxTotalItemsPerPackage} total items (experiences + tours) per package`, 400);
        }

        // Convert tour IDs to Pointers
        if (tours.length > 0) {
          const tourPointers = [];
          for (const tourId of tours) {
            try {
              const tourQuery = new Parse.Query('Tours');
              const tour = await tourQuery.get(tourId, { useMasterKey: true });
              if (!tour) {
                return this.sendError(res, `Tour ${tourId} not found`, 404);
              }
              tourPointers.push(tour);
            } catch (error) {
              return this.sendError(res, `Tour ${tourId} not found`, 404);
            }
          }
          experienceObj.set('tours', tourPointers);
        } else {
          experienceObj.set('tours', []);
        }
      }

      // Update vehicleType relationship
      if (vehicleType !== undefined) {
        if (vehicleType && vehicleType.trim() !== '') {
          try {
            const vehicleTypeQuery = new Parse.Query('VehicleType');
            vehicleTypeQuery.equalTo('exists', true);
            vehicleTypeQuery.equalTo('active', true);
            const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, { useMasterKey: true });
            if (!vehicleTypeObj) {
              return this.sendError(res, `Vehicle type ${vehicleType} not found or inactive`, 404);
            }
            experienceObj.set('vehicleType', vehicleTypeObj);
          } catch (error) {
            return this.sendError(res, `Vehicle type ${vehicleType} not found or inactive`, 404);
          }
        } else {
          // Clear the vehicleType relationship
          experienceObj.unset('vehicleType');
        }
      }

      // Save changes with user context for audit trail
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

      logger.info('Experience updated successfully', {
        experienceId: experienceObj.id,
        userId: currentUser.id,
        updates: {
          name,
          description,
          cost,
          experiences,
          tours,
          active,
        },
      });

      return res.json({
        success: true,
        message: 'Experience updated successfully',
        data: {
          id: experienceObj.id,
          name: experienceObj.get('name'),
        },
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
   */
  formatExperienceData(experience) {
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
