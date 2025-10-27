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
 * @since 2024-01-15
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
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';
      const typeFilter = req.query.type; // "Experience" or "Provider"
      const { excludeId } = req.query; // ID to exclude from results (for edit modal)

      // Column mapping for sorting
      const columns = ['name', 'description', 'cost', 'updatedAt'];
      const sortField = columns[sortColumnIndex] || 'updatedAt';

      // Get total records count (without search filter)
      const totalRecordsQuery = new Parse.Query('Experience');
      totalRecordsQuery.equalTo('exists', true);
      if (typeFilter && ['Experience', 'Provider'].includes(typeFilter)) {
        totalRecordsQuery.equalTo('type', typeFilter);
      }
      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Experience');
      baseQuery.equalTo('exists', true);
      if (typeFilter && ['Experience', 'Provider'].includes(typeFilter)) {
        baseQuery.equalTo('type', typeFilter);
      }
      // Exclude specific experience if provided (for edit modal to prevent self-selection)
      if (excludeId) {
        baseQuery.notEqualTo('objectId', excludeId);
      }

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
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

        filteredQuery = Parse.Query.or(nameQuery, descQuery);
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({
        useMasterKey: true,
      });

      // Apply sorting
      if (sortDirection === 'asc') {
        filteredQuery.ascending(sortField);
      } else {
        filteredQuery.descending(sortField);
      }

      // Include experiences array for display
      filteredQuery.include('experiences');

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const experiences = await filteredQuery.find({ useMasterKey: true });

      // Format data for DataTables
      const data = experiences.map((experience) => {
        const includedExperiences = experience.get('experiences') || [];

        return {
          id: experience.id,
          objectId: experience.id,
          name: experience.get('name'),
          description: experience.get('description'),
          type: experience.get('type'),
          cost: experience.get('cost'),
          experiences: includedExperiences.map((exp) => ({
            id: exp.id,
            name: exp.get('name'),
          })),
          experienceCount: includedExperiences.length,
          active: experience.get('active'),
          createdAt: experience.createdAt,
          updatedAt: experience.updatedAt,
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

      const experience = await query.get(experienceId, { useMasterKey: true });

      if (!experience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      const includedExperiences = experience.get('experiences') || [];

      const data = {
        id: experience.id,
        name: experience.get('name'),
        description: experience.get('description'),
        type: experience.get('type'),
        cost: experience.get('cost'),
        experiences: includedExperiences.map((exp) => exp.id),
        experienceDetails: includedExperiences.map((exp) => ({
          id: exp.id,
          name: exp.get('name'),
          cost: exp.get('cost'),
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
        name, description, type, cost, experiences,
      } = req.body;

      // Validation
      if (!name || !description || !type || cost === undefined) {
        return this.sendError(res, 'Required fields: name, description, type, cost', 400);
      }

      if (!['Experience', 'Provider'].includes(type)) {
        return this.sendError(res, 'Type must be Experience or Provider', 400);
      }

      if (cost < 0) {
        return this.sendError(res, 'Cost must be greater than or equal to 0', 400);
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

      // Create experience object
      const Experience = Parse.Object.extend('Experience');
      const experienceObj = new Experience();

      experienceObj.set('name', name);
      experienceObj.set('description', description);
      experienceObj.set('type', type);
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
        name, description, cost, experiences, active,
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
