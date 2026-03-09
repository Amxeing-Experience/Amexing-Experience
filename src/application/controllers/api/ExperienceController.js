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
const {
  validateDaySchedules,
  sortDaySchedulesChronological,
} = require('../../../infrastructure/utils/availabilityUtils');

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
   * Supports filtering via query parameters:
   * - ?type=Experience or ?type=Provider (type filter)
   * - ?dayDate=YYYY-MM-DD (day-of-week availability filter).
   *
   * Day-of-week filtering improves performance by filtering on backend instead of client-side.
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
      const totalQuery = this.buildBaseQuery(params.typeFilter, null, null);
      const recordsTotal = await totalQuery.count({ useMasterKey: true });

      // Build filtered query (with day-of-week filtering if dayDate provided)
      const filteredQuery = params.searchValue
        ? this.buildSearchQuery(params.searchValue, params.typeFilter, params.excludeId, params.dayDate)
        : this.buildBaseQuery(params.typeFilter, params.excludeId, params.dayDate);

      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting and pagination
      filteredQuery[params.sortDirection === 'asc' ? 'ascending' : 'descending'](sortField);
      filteredQuery.include('experiences');
      filteredQuery.include('vehicleType');
      filteredQuery.include('tours');
      filteredQuery.include('tours.destinationPOI');
      filteredQuery.skip(params.start);
      filteredQuery.limit(params.length);

      // Execute and format
      const experiences = await filteredQuery.find({ useMasterKey: true });
      const data = await Promise.all(experiences.map((exp) => this.formatExperienceForDataTable(exp)));

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
    return vehicleType
      ? {
        id: vehicleType.id,
        name: vehicleType.get('name'),
        code: vehicleType.get('code'),
        defaultCapacity: vehicleType.get('defaultCapacity'),
        trunkCapacity: vehicleType.get('trunkCapacity'),
      }
      : null;
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
   * Formats provider experience details for API response.
   * @param {Array<Parse.Object>} providerExperiences - Provider experiences array.
   * @returns {Array<object>} Formatted provider experience details.
   * @example
   */
  formatProviderExperienceDetails(providerExperiences) {
    return providerExperiences.map((provExp) => ({
      id: provExp.id,
      name: provExp.get('name'),
      description: provExp.get('description'),
      price: provExp.get('price'),
      provider: provExp.get('provider')
        ? {
          id: provExp.get('provider').id,
          name: provExp.get('provider').get('name'),
        }
        : null,
    }));
  }

  /**
   * Formats complete experience data for API response.
   * @param {Parse.Object} experience - Experience object.
   * @param {Array<Parse.Object>} includedExperiences - Included experiences.
   * @param {Array<Parse.Object>} includedProviderExperiences - Included provider experiences.
   * @param {Array<Parse.Object>} includedTours - Included tours.
   * @param {Parse.Object} vehicleType - Vehicle type object.
   * @returns {object} Formatted experience data.
   * @example
   */
  formatExperienceData(experience, includedExperiences, includedProviderExperiences, includedTours, vehicleType) {
    return {
      id: experience.id,
      name: experience.get('name'),
      description: experience.get('description'),
      type: experience.get('type'),
      providerType: experience.get('providerType'),
      duration: experience.get('duration'),
      cost: experience.get('cost'),
      min_people: experience.get('min_people'),
      max_people: experience.get('max_people') || null,
      time_journey: experience.get('time_journey'),
      travel_duration: experience.get('travel_duration') || null,
      advance_minutes: experience.get('advance_minutes') || null,
      price_no_alcohol: experience.get('price_no_alcohol') || null,
      price_child: experience.get('price_child') || null,
      includes: experience.get('includes') || [],
      notincludes: experience.get('notincludes') || [],
      languages: experience.get('languages') || [],
      photos: experience.get('photos') || [],
      internal_notes: experience.get('internal_notes') || null,
      client_booking_notes: experience.get('client_booking_notes') || null,
      provider_notes: experience.get('provider_notes') || null,
      team_notes: experience.get('team_notes') || null,
      vehicleType: this.formatVehicleType(vehicleType),
      vehicleTypeId: vehicleType ? vehicleType.id : null,
      experiences: includedExperiences.map((exp) => exp.id),
      experienceDetails: this.formatExperienceDetails(includedExperiences),
      providerExperiences: includedProviderExperiences.map((provExp) => provExp.id),
      providerExperienceDetails: this.formatProviderExperienceDetails(includedProviderExperiences),
      tours: includedTours.map((tour) => tour.id),
      tourDetails: this.formatTourDetails(includedTours),
      availability: experience.get('availability') || null,
      serviceItems: experience.get('serviceItems') || null,
      active: experience.get('active'),
      createdAt: experience.createdAt,
      updatedAt: experience.updatedAt,
    };
  }

  /**
   * Get experience by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Returns experience data or error.
   * @author Denisse Maldonado
   * @since 1.0.0
   * @example
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
      // Only get active records (valid_until IS NULL) - price versioning
      query.doesNotExist('valid_until');
      query.include('experiences');
      query.include('providerExperiences');
      query.include('tours');
      query.include('vehicleType');

      const experience = await query.get(experienceId, { useMasterKey: true });

      if (!experience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      const includedExperiences = experience.get('experiences') || [];
      const includedProviderExperiences = experience.get('providerExperiences') || [];
      const includedTours = experience.get('tours') || [];
      const vehicleType = experience.get('vehicleType');

      const data = this.formatExperienceData(
        experience,
        includedExperiences,
        includedProviderExperiences,
        includedTours,
        vehicleType
      );

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
      return {
        error: 'Required fields: name, description, type, cost',
        status: 400,
      };
    }

    if (!['Experience', 'Provider'].includes(type)) {
      return { error: 'Type must be Experience or Provider', status: 400 };
    }

    if (type === 'Provider' && providerType) {
      if (!['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
        return {
          error: 'Provider type must be Exclusivo, Compartido, or Privado',
          status: 400,
        };
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

    return null;
  }

  /**
   * Validates experience, provider experience, and tour arrays.
   * @param {Array} experiences - Experience IDs array.
   * @param {Array} providerExperiences - Provider Experience IDs array.
   * @param {Array} tours - Tour IDs array.
   * @returns {object|null} Validation error or null if valid.
   * @example
   */
  validateExperienceArrays(experiences, providerExperiences, tours) {
    if (experiences && experiences.length > this.maxExperiencesPerPackage) {
      return {
        error: `Maximum ${this.maxExperiencesPerPackage} experiences per package`,
        status: 400,
      };
    }

    if (providerExperiences && providerExperiences.length > this.maxExperiencesPerPackage) {
      return {
        error: `Maximum ${this.maxExperiencesPerPackage} provider experiences per package`,
        status: 400,
      };
    }

    if (tours && tours.length > this.maxToursPerPackage) {
      return {
        error: `Maximum ${this.maxToursPerPackage} tours per package`,
        status: 400,
      };
    }

    const totalItems = (experiences ? experiences.length : 0)
      + (providerExperiences ? providerExperiences.length : 0)
      + (tours ? tours.length : 0);
    if (totalItems > this.maxTotalItemsPerPackage) {
      return {
        error: `Maximum ${this.maxTotalItemsPerPackage} total items (experiences + provider experiences + tours) per package`,
        status: 400,
      };
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
          try {
            const expQuery = new Parse.Query('Experience');
            expQuery.equalTo('objectId', expId);
            expQuery.equalTo('exists', true);
            // Only get active records (valid_until IS NULL) - price versioning
            expQuery.doesNotExist('valid_until');
            const exp = await expQuery.first({ useMasterKey: true });
            if (!exp) {
              logger.warn(`Experience ${expId} not found or inactive`);
              return {
                error: `Experience ${expId} not found or is inactive`,
                status: 404,
              };
            }
            experiencePointers.push(exp);
          } catch (err) {
            logger.error(`Error fetching experience ${expId}:`, err);
            return {
              error: `Error fetching experience ${expId}: ${err.message}`,
              status: 404,
            };
          }
        }
        experienceObj.set('experiences', experiencePointers);
      } else {
        experienceObj.set('experiences', []);
      }

      // Process tours
      if (tours && tours.length > 0) {
        const tourPointers = [];
        for (const tourId of tours) {
          try {
            const tourQuery = new Parse.Query('Tours');
            tourQuery.equalTo('objectId', tourId);
            tourQuery.equalTo('exists', true);
            const tour = await tourQuery.first({ useMasterKey: true });
            if (!tour) {
              logger.warn(`Tour ${tourId} not found or inactive`);
              return {
                error: `Tour ${tourId} not found or is inactive`,
                status: 404,
              };
            }
            tourPointers.push(tour);
          } catch (err) {
            logger.error(`Error fetching tour ${tourId}:`, err);
            return {
              error: `Error fetching tour ${tourId}: ${err.message}`,
              status: 404,
            };
          }
        }
        experienceObj.set('tours', tourPointers);
      } else {
        experienceObj.set('tours', []);
      }

      return null;
    } catch (error) {
      logger.error('Error processing relationships:', {
        error: error.message,
        stack: error.stack,
        experiences,
        tours,
      });
      return {
        error: `Failed to process relationships: ${error.message}`,
        status: 404,
      };
    }
  }

  /**
   * Processes provider experience relationships.
   * @param {Parse.Object} experienceObj - Experience object to set relationships on.
   * @param {Array} providerExperiences - Provider Experience IDs array.
   * @returns {object|null} Error object or null if successful.
   * @example
   */
  async processProviderExperienceRelationships(experienceObj, providerExperiences) {
    try {
      // Process provider experiences
      if (providerExperiences && providerExperiences.length > 0) {
        const providerExperiencePointers = [];
        for (const providerExpId of providerExperiences) {
          try {
            // Query ProviderExperiencia table instead of Experience table
            const providerExpQuery = new Parse.Query('ProviderExperiencia');
            providerExpQuery.equalTo('objectId', providerExpId);
            providerExpQuery.equalTo('exists', true);
            providerExpQuery.equalTo('active', true);

            const providerExp = await providerExpQuery.first({
              useMasterKey: true,
            });
            if (!providerExp) {
              logger.warn(`Provider Experience ${providerExpId} not found or inactive`);
              return {
                error: `Provider Experience ${providerExpId} not found or is inactive`,
                status: 404,
              };
            }

            // Use the actual Parse object (consistent with experiences and tours)
            providerExperiencePointers.push(providerExp);
          } catch (err) {
            logger.error(`Error fetching provider experience ${providerExpId}:`, err);
            return {
              error: `Error fetching provider experience ${providerExpId}: ${err.message}`,
              status: 404,
            };
          }
        }
        experienceObj.set('providerExperiences', providerExperiencePointers);
      } else {
        experienceObj.set('providerExperiences', []);
      }

      return null;
    } catch (error) {
      logger.error('Error processing provider experience relationships:', {
        error: error.message,
        stack: error.stack,
        providerExperiences,
      });
      return {
        error: `Failed to process provider experience relationships: ${error.message}`,
        status: 404,
      };
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
      const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, {
        useMasterKey: true,
      });
      if (!vehicleTypeObj) {
        return {
          error: `Vehicle type ${vehicleType} not found or inactive`,
          status: 404,
        };
      }
      experienceObj.set('vehicleType', vehicleTypeObj);
      return null;
    } catch (error) {
      return {
        error: `Vehicle type ${vehicleType} not found or inactive`,
        status: 404,
      };
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
      name,
      description,
      type,
      providerType,
      duration,
      cost,
      min_people: minPeople,
      max_people: maxPeople,
      time_journey: timeJourney,
      travel_duration: travelDuration,
      advance_minutes: advanceMinutes,
      price_no_alcohol: priceNoAlcohol,
      price_child: priceChild,
      includes,
      notincludes,
      languages,
      photos,
      internal_notes: internalNotes,
      client_booking_notes: clientBookingNotes,
      provider_notes: providerNotes,
      team_notes: teamNotes,
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
    if (minPeople !== undefined && minPeople !== null && minPeople !== '') {
      experienceObj.set('min_people', parseInt(minPeople, 10));
    }
    if (maxPeople !== undefined && maxPeople !== null && maxPeople !== '') {
      experienceObj.set('max_people', parseInt(maxPeople, 10));
    }
    if (timeJourney !== undefined && timeJourney !== null && timeJourney !== '') {
      experienceObj.set('time_journey', parseFloat(timeJourney));
    }
    if (travelDuration !== undefined && travelDuration !== null && travelDuration !== '') {
      experienceObj.set('travel_duration', parseInt(travelDuration, 10));
    }
    if (advanceMinutes !== undefined && advanceMinutes !== null && advanceMinutes !== '') {
      experienceObj.set('advance_minutes', parseInt(advanceMinutes, 10));
    }
    if (priceNoAlcohol !== undefined && priceNoAlcohol !== null && priceNoAlcohol !== '') {
      experienceObj.set('price_no_alcohol', parseFloat(priceNoAlcohol));
    }
    if (priceChild !== undefined && priceChild !== null && priceChild !== '') {
      experienceObj.set('price_child', parseFloat(priceChild));
    }
    if (includes !== undefined && Array.isArray(includes)) {
      experienceObj.set('includes', includes);
    }
    if (notincludes !== undefined && Array.isArray(notincludes)) {
      experienceObj.set('notincludes', notincludes);
    }
    if (languages !== undefined && Array.isArray(languages)) {
      experienceObj.set('languages', languages);
    }
    if (photos !== undefined && Array.isArray(photos)) {
      experienceObj.set('photos', photos);
    }
    if (internalNotes !== undefined && internalNotes !== null) {
      experienceObj.set('internal_notes', internalNotes);
    }
    if (clientBookingNotes !== undefined && clientBookingNotes !== null) {
      experienceObj.set('client_booking_notes', clientBookingNotes);
    }
    if (providerNotes !== undefined && providerNotes !== null) {
      experienceObj.set('provider_notes', providerNotes);
    }
    if (teamNotes !== undefined && teamNotes !== null) {
      experienceObj.set('team_notes', teamNotes);
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

  /**
   * Create a new experience.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Returns created experience or error.
   * @author Denisse Maldonado
   * @since 1.0.0
   * @example
   */
  async createExperience(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const {
        experiences, providerExperiences, tours, vehicleType,
      } = req.body;

      // Validate input
      const inputValidation = this.validateCreateExperienceInput(req.body);
      if (inputValidation) {
        return this.sendError(res, inputValidation.error, inputValidation.status);
      }

      // Validate arrays
      const arrayValidation = this.validateExperienceArrays(experiences, providerExperiences, tours);
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

      // Process provider experience relationships
      const providerExperienceError = await this.processProviderExperienceRelationships(
        experienceObj,
        providerExperiences
      );
      if (providerExperienceError) {
        return this.sendError(res, providerExperienceError.error, providerExperienceError.status);
      }

      const vehicleTypeError = await this.processVehicleTypeRelationship(experienceObj, vehicleType);
      if (vehicleTypeError) {
        return this.sendError(res, vehicleTypeError.error, vehicleTypeError.status);
      }

      // Process availability (optional)
      const { availability } = req.body;
      if (availability && Array.isArray(availability)) {
        if (availability.length === 0) {
          return this.sendError(res, 'At least one day schedule must be provided if availability is set', 400);
        }

        const availabilityValidation = validateDaySchedules(availability);
        if (!availabilityValidation.valid) {
          return this.sendError(res, `Invalid availability data: ${availabilityValidation.errors.join(', ')}`, 400);
        }

        const sortedSchedules = sortDaySchedulesChronological(availability);
        experienceObj.set('availability', sortedSchedules);
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
   * Validates and updates basic experience fields.
   * @param {Parse.Object} experienceObj - Experience object to update.
   * @param {object} data - Update data.
   * @returns {object|null} Validation error or null if valid.
   * @example
   */
  validateAndUpdateBasicFields(experienceObj, data) {
    const {
      name,
      description,
      cost,
      duration,
      providerType,
      active,
      min_people: minPeople,
      max_people: maxPeople,
      time_journey: timeJourney,
      travel_duration: travelDuration,
      advance_minutes: advanceMinutes,
      price_no_alcohol: priceNoAlcohol,
      price_child: priceChild,
      includes,
      notincludes,
      languages,
      photos,
      internal_notes: internalNotes,
      client_booking_notes: clientBookingNotes,
      provider_notes: providerNotes,
      team_notes: teamNotes,
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
      experienceObj.set('description', description);
    }

    // Store cost change info for versioning (but don't return early - process all fields first)
    let costChangeInfo = null;

    if (cost !== undefined) {
      if (cost < 0) {
        return {
          error: 'Cost must be greater than or equal to 0',
          status: 400,
        };
      }
      // Store cost change info for versioning (will be returned to caller)
      const oldCost = experienceObj.get('cost');
      const newCost = parseFloat(cost);

      // IMPORTANT: Do NOT modify the experience object here if cost changed
      // The versioning logic in updateExperience will handle the cost change
      const costChanged = oldCost !== newCost;

      if (!costChanged) {
        // If cost didn't change, it's safe to set it
        experienceObj.set('cost', newCost);
      }

      // Store cost change info to return later (don't return early)
      costChangeInfo = {
        costChanged,
        oldCost,
        newCost,
      };
    }

    if (duration !== undefined) {
      if (duration === null || duration === '') {
        experienceObj.set('duration', null);
      } else {
        if (Number.isNaN(parseFloat(duration)) || parseFloat(duration) < 0) {
          return { error: 'Duration must be a positive number', status: 400 };
        }
        const parsedDuration = parseFloat(duration);
        experienceObj.set('duration', parsedDuration);
      }
    }

    if (providerType !== undefined) {
      const currentType = experienceObj.get('type');
      if (currentType === 'Provider') {
        if (providerType && !['Exclusivo', 'Compartido', 'Privado'].includes(providerType)) {
          return {
            error: 'Provider type must be Exclusivo, Compartido, or Privado',
            status: 400,
          };
        }
        experienceObj.set('providerType', providerType || null);
      }
    }

    if (minPeople !== undefined) {
      if (minPeople === null || minPeople === '') {
        experienceObj.set('min_people', null);
      } else {
        if (Number.isNaN(parseInt(minPeople, 10)) || parseInt(minPeople, 10) < 1) {
          return {
            error: 'Minimum people must be a positive number',
            status: 400,
          };
        }
        experienceObj.set('min_people', parseInt(minPeople, 10));
      }
    }

    if (timeJourney !== undefined) {
      if (timeJourney === null || timeJourney === '') {
        experienceObj.set('time_journey', null);
      } else {
        if (Number.isNaN(parseFloat(timeJourney)) || parseFloat(timeJourney) < 0) {
          return {
            error: 'Journey time must be greater than or equal to 0',
            status: 400,
          };
        }
        experienceObj.set('time_journey', parseFloat(timeJourney));
      }
    }

    if (includes !== undefined) {
      if (Array.isArray(includes)) {
        experienceObj.set('includes', includes);
      } else if (includes === null) {
        experienceObj.set('includes', []);
      }
    }

    if (notincludes !== undefined) {
      if (Array.isArray(notincludes)) {
        experienceObj.set('notincludes', notincludes);
      } else if (notincludes === null) {
        experienceObj.set('notincludes', []);
      }
    }

    if (photos !== undefined) {
      if (Array.isArray(photos)) {
        experienceObj.set('photos', photos);
      } else if (photos === null) {
        experienceObj.set('photos', []);
      }
    }

    if (languages !== undefined) {
      if (Array.isArray(languages)) {
        experienceObj.set('languages', languages);
      } else if (languages === null) {
        experienceObj.set('languages', []);
      }
    }

    if (maxPeople !== undefined) {
      if (maxPeople === null || maxPeople === '') {
        experienceObj.set('max_people', null);
      } else {
        if (Number.isNaN(parseInt(maxPeople, 10)) || parseInt(maxPeople, 10) < 1) {
          return {
            error: 'Maximum people must be a positive number',
            status: 400,
          };
        }
        experienceObj.set('max_people', parseInt(maxPeople, 10));
      }
    }

    if (travelDuration !== undefined) {
      if (travelDuration === null || travelDuration === '') {
        experienceObj.set('travel_duration', null);
      } else {
        if (Number.isNaN(parseInt(travelDuration, 10)) || parseInt(travelDuration, 10) < 0) {
          return {
            error: 'Travel duration must be greater than or equal to 0',
            status: 400,
          };
        }
        experienceObj.set('travel_duration', parseInt(travelDuration, 10));
      }
    }

    if (advanceMinutes !== undefined) {
      if (advanceMinutes === null || advanceMinutes === '') {
        experienceObj.set('advance_minutes', null);
      } else {
        if (Number.isNaN(parseInt(advanceMinutes, 10)) || parseInt(advanceMinutes, 10) < 0) {
          return {
            error: 'Advance minutes must be greater than or equal to 0',
            status: 400,
          };
        }
        experienceObj.set('advance_minutes', parseInt(advanceMinutes, 10));
      }
    }

    if (priceNoAlcohol !== undefined) {
      if (priceNoAlcohol === null || priceNoAlcohol === '') {
        experienceObj.set('price_no_alcohol', null);
      } else {
        experienceObj.set('price_no_alcohol', parseFloat(priceNoAlcohol));
      }
    }

    if (priceChild !== undefined) {
      if (priceChild === null || priceChild === '') {
        experienceObj.set('price_child', null);
      } else {
        experienceObj.set('price_child', parseFloat(priceChild));
      }
    }

    if (internalNotes !== undefined) {
      experienceObj.set('internal_notes', internalNotes || null);
    }
    if (clientBookingNotes !== undefined) {
      experienceObj.set('client_booking_notes', clientBookingNotes || null);
    }
    if (providerNotes !== undefined) {
      experienceObj.set('provider_notes', providerNotes || null);
    }
    if (teamNotes !== undefined) {
      experienceObj.set('team_notes', teamNotes || null);
    }

    if (active !== undefined) {
      experienceObj.set('active', active);
    }

    // Return cost change info if there was a cost change, otherwise null
    return costChangeInfo;
  }

  /**
   * Updates experience relationships (experiences and tours).
   * @param {Parse.Object} experienceObj - Experience object to update.
   * @param {string} experienceId - Current experience ID (to prevent self-inclusion).
   * @param {object} data - Update data containing experiences and tours arrays.
   * @returns {object|null} Error object or null if successful.
   * @example
   */
  async updateExperienceRelationships(experienceObj, experienceId, data) {
    const { experiences, providerExperiences, tours } = data;

    // Update experiences array
    if (experiences !== undefined) {
      if (experiences.length > this.maxExperiencesPerPackage) {
        return {
          error: `Maximum ${this.maxExperiencesPerPackage} experiences per package`,
          status: 400,
        };
      }
      if (experiences.includes(experienceId)) {
        return { error: 'An experience cannot include itself', status: 400 };
      }

      if (experiences.length > 0) {
        const experiencePointers = [];
        for (const expId of experiences) {
          try {
            const expQuery = new Parse.Query('Experience');
            expQuery.equalTo('exists', true);
            // Only get active records (valid_until IS NULL) - price versioning
            expQuery.doesNotExist('valid_until');
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

    // Update provider experiences array
    if (providerExperiences !== undefined) {
      if (providerExperiences.length > this.maxExperiencesPerPackage) {
        return {
          error: `Maximum ${this.maxExperiencesPerPackage} provider experiences per package`,
          status: 400,
        };
      }

      if (providerExperiences.length > 0) {
        const providerExperiencePointers = [];
        for (const providerExpId of providerExperiences) {
          try {
            const providerExpQuery = new Parse.Query('ProviderExperiencia');
            providerExpQuery.equalTo('objectId', providerExpId);
            providerExpQuery.equalTo('exists', true);
            providerExpQuery.equalTo('active', true);

            const providerExp = await providerExpQuery.first({
              useMasterKey: true,
            });
            if (!providerExp) {
              return {
                error: `Provider Experience ${providerExpId} not found or is inactive`,
                status: 404,
              };
            }

            // Use the actual Parse object (consistent with experiences and tours)
            providerExperiencePointers.push(providerExp);
          } catch (err) {
            return {
              error: `Error fetching provider experience ${providerExpId}: ${err.message}`,
              status: 404,
            };
          }
        }
        experienceObj.set('providerExperiences', providerExperiencePointers);
      } else {
        experienceObj.set('providerExperiences', []);
      }
    }

    // Update tours array
    if (tours !== undefined) {
      if (tours.length > this.maxToursPerPackage) {
        return {
          error: `Maximum ${this.maxToursPerPackage} tours per package`,
          status: 400,
        };
      }

      const currentExperiences = experiences !== undefined ? experiences : experienceObj.get('experiences') || [];
      const currentProviderExperiences = providerExperiences !== undefined ? providerExperiences : experienceObj.get('providerExperiences') || [];
      const totalItems = currentExperiences.length + currentProviderExperiences.length + tours.length;
      if (totalItems > this.maxTotalItemsPerPackage) {
        return {
          error: `Maximum ${this.maxTotalItemsPerPackage} total items (experiences + provider experiences + tours) per package`,
          status: 400,
        };
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
   * Updates vehicle type relationship for experience.
   * @param {Parse.Object} experienceObj - Experience object to update.
   * @param {string} vehicleType - Vehicle type ID or empty to clear.
   * @returns {object|null} Error object or null if successful.
   * @example
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
        const vehicleTypeObj = await vehicleTypeQuery.get(vehicleType, {
          useMasterKey: true,
        });
        if (!vehicleTypeObj) {
          return {
            error: `Vehicle type ${vehicleType} not found or inactive`,
            status: 404,
          };
        }
        experienceObj.set('vehicleType', vehicleTypeObj);
      } catch (error) {
        return {
          error: `Vehicle type ${vehicleType} not found or inactive`,
          status: 404,
        };
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
      const experienceObj = await query.get(experienceId, {
        useMasterKey: true,
      });
      if (!experienceObj) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Validate and update all fields and relationships
      const basicFieldsResult = this.validateAndUpdateBasicFields(experienceObj, req.body);
      if (basicFieldsResult && basicFieldsResult.error) {
        return this.sendError(res, basicFieldsResult.error, basicFieldsResult.status);
      }

      // Extract cost change information if it exists
      const costChangeInfo = basicFieldsResult && basicFieldsResult.costChanged ? basicFieldsResult : null;

      const relationshipsError = await this.updateExperienceRelationships(experienceObj, experienceId, req.body);
      if (relationshipsError) {
        return this.sendError(res, relationshipsError.error, relationshipsError.status);
      }

      const vehicleTypeError = await this.updateVehicleTypeRelationship(experienceObj, req.body.vehicleType);
      if (vehicleTypeError) {
        return this.sendError(res, vehicleTypeError.error, vehicleTypeError.status);
      }

      // Update availability (optional)
      const { availability } = req.body;
      if (availability !== undefined) {
        if (availability === null) {
          // Remove availability (set to available anytime)
          experienceObj.unset('availability');
        } else if (Array.isArray(availability) && availability.length > 0) {
          const availabilityValidation = validateDaySchedules(availability);
          if (!availabilityValidation.valid) {
            return this.sendError(res, `Invalid availability data: ${availabilityValidation.errors.join(', ')}`, 400);
          }

          const sortedSchedules = sortDaySchedulesChronological(availability);
          experienceObj.set('availability', sortedSchedules);
        } else if (Array.isArray(availability) && availability.length === 0) {
          return this.sendError(res, 'At least one day schedule must be provided if availability is set', 400);
        }
      }

      // Handle cost versioning if cost was changed
      if (costChangeInfo && costChangeInfo.costChanged) {
        logger.info('Cost changed, implementing versioning', {
          experienceId: experienceObj.id,
          oldCost: costChangeInfo.oldCost,
          newCost: costChangeInfo.newCost,
        });

        // VERSIONING: Instead of updating the existing experience, create a new version
        const originalId = experienceObj.id;

        // 1. Mark current experience as historical (set valid_until to today)
        experienceObj.set('valid_until', new Date());
        experienceObj.set('lastModifiedBy', currentUser.id);
        await this.saveExperienceWithAudit(experienceObj, currentUser);

        // 2. Create NEW experience record with the updated cost
        const ExperienceClass = Parse.Object.extend('Experience');
        const newExperience = new ExperienceClass();

        // Copy all fields from UPDATED experience (not original JSON)
        const fieldsToExclude = ['objectId', 'createdAt', 'updatedAt', 'valid_until'];

        // DEBUG: Log versioning data copy
        logger.info('🔍 VERSIONING COPY DEBUG:', {
          originalId,
          originalDuration: experienceObj.get('duration'),
          requestedDuration: req.body.duration,
          experienceAllFields: Object.keys(experienceObj.attributes),
        });

        // Get all field names from the updated object (not the original JSON)
        Object.keys(experienceObj.attributes).forEach((key) => {
          if (!fieldsToExclude.includes(key)) {
            if (key === 'cost') {
              // Use the new cost
              newExperience.set(key, costChangeInfo.newCost);
              logger.info('✅ Versioning: Set new cost:', costChangeInfo.newCost);
            } else {
              const value = experienceObj.get(key);
              newExperience.set(key, value);
              if (key === 'duration') {
                logger.info('✅ Versioning: Copied duration:', value);
              }
            }
          }
        });

        // Ensure the new experience is active and exists
        newExperience.set('active', true);
        newExperience.set('exists', true);
        newExperience.set('createdBy', currentUser.id);
        newExperience.set('lastModifiedBy', currentUser.id);
        // valid_until remains null (active record)

        // Save the new experience
        await this.saveExperienceWithAudit(newExperience, currentUser);

        logger.info('Experience versioning completed', {
          originalId,
          newId: newExperience.id,
          historicalCost: costChangeInfo.oldCost,
          newActiveCost: costChangeInfo.newCost,
        });

        // Return the new experience ID
        return res.json({
          success: true,
          message: 'Experience updated successfully with cost history',
          data: {
            id: newExperience.id,
            originalId,
            name: newExperience.get('name'),
            costChanged: true,
          },
        });
      }

      // Save and respond (for non-cost changes)
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
      // Only get active records (valid_until IS NULL) - price versioning
      dependencyQuery.doesNotExist('valid_until');
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
      length: Math.min(parseInt(query.length, 10) || this.defaultPageSize, this.maxPageSize),
      searchValue: query.search?.value || '',
      sortColumnIndex: parseInt(query.order?.[0]?.column, 10) || 0,
      sortDirection: query.order?.[0]?.dir || 'asc',
      typeFilter: query.type,
      excludeId: query.excludeId,
      dayDate: query.dayDate, // YYYY-MM-DD format for day-of-week filtering
    };
  }

  /**
   * Build base query for experiences.
   * @param {string} typeFilter - Type filter (Experience/Provider).
   * @param {string} excludeId - ID to exclude.
   * @param {string} dayDate - Date in YYYY-MM-DD format for day-of-week filtering.
   * @returns {Parse.Query} Base query.
   * @private
   * @example
   */
  buildBaseQuery(typeFilter, excludeId, dayDate) {
    const query = new Parse.Query('Experience');
    query.equalTo('exists', true);
    // Only get active records (valid_until IS NULL) - price versioning
    query.doesNotExist('valid_until');
    if (typeFilter && ['Experience', 'Provider'].includes(typeFilter)) {
      query.equalTo('type', typeFilter);
    }
    if (excludeId) {
      query.notEqualTo('objectId', excludeId);
    }

    // Apply day-of-week filtering if dayDate provided
    if (dayDate) {
      const QuoteServiceHelper = require('../../services/QuoteServiceHelper');
      const dayCode = QuoteServiceHelper.getDayOfWeekCode(dayDate);

      if (dayCode !== null) {
        // Filter by availability.day array containing dayCode
        query.equalTo('availability.day', dayCode);
      }
    }

    return query;
  }

  /**
   * Build search query with filters.
   * @param {string} searchValue - Search term.
   * @param {string} typeFilter - Type filter (Experience/Provider).
   * @param {string} excludeId - ID to exclude.
   * @param {string} dayDate - Date in YYYY-MM-DD format for day-of-week filtering.
   * @returns {Parse.Query} Filtered query.
   * @private
   * @example
   */
  buildSearchQuery(searchValue, typeFilter, excludeId, dayDate) {
    const nameQuery = new Parse.Query('Experience');
    nameQuery.equalTo('exists', true);
    // Only get active records (valid_until IS NULL) - price versioning
    nameQuery.doesNotExist('valid_until');
    if (typeFilter) nameQuery.equalTo('type', typeFilter);
    if (excludeId) nameQuery.notEqualTo('objectId', excludeId);
    nameQuery.matches('name', searchValue, 'i');

    const descQuery = new Parse.Query('Experience');
    descQuery.equalTo('exists', true);
    // Only get active records (valid_until IS NULL) - price versioning
    descQuery.doesNotExist('valid_until');
    if (typeFilter) descQuery.equalTo('type', typeFilter);
    if (excludeId) descQuery.notEqualTo('objectId', excludeId);
    descQuery.matches('description', searchValue, 'i');

    // Apply day-of-week filtering to both queries
    if (dayDate) {
      const QuoteServiceHelper = require('../../services/QuoteServiceHelper');
      const dayCode = QuoteServiceHelper.getDayOfWeekCode(dayDate);

      if (dayCode !== null) {
        nameQuery.equalTo('availability.day', dayCode);
        descQuery.equalTo('availability.day', dayCode);
      }
    }

    return Parse.Query.or(nameQuery, descQuery);
  }

  /**
   * Format experience data for DataTables.
   * @param {Parse.Object} experience - Experience object.
   * @returns {object} Formatted experience data.
   * @private
   * @example
   */
  async formatExperienceForDataTable(experience) {
    const includedExperiences = experience.get('experiences') || [];
    const includedProviderExperiences = experience.get('providerExperiences') || [];
    const includedTours = experience.get('tours') || [];
    const vehicleType = experience.get('vehicleType');

    // Get experiencias count for providers
    let experienciasCount = 0;
    if (experience.get('type') === 'Provider') {
      const ProviderExperiencia = require('../../../domain/models/ProviderExperiencia');
      experienciasCount = await ProviderExperiencia.countByProvider(experience.id);
    }

    // Get photos from ExperienceImage table
    let photos = [];
    try {
      const ExperienceImage = require('../../../domain/models/ExperienceImage');
      const experienceImages = await ExperienceImage.findByExperience(experience.id);

      logger.info('Fetching images for experience', {
        experienceId: experience.id,
        experienceName: experience.get('name'),
        imageCount: experienceImages.length,
      });

      // Format photos for response (handle async getUrl)
      photos = await Promise.all(experienceImages.map(async (img) => {
        const photo = {
          id: img.id,
          fileName: img.getFileName(),
          displayOrder: img.getDisplayOrder(),
          isPrincipal: img.getIsPrimary(),
          principal: img.getIsPrimary(),
          order: img.getDisplayOrder(),
          s3Key: img.getS3Key(),
          url: await img.getUrl(), // Now async
        };

        // Include optimization metadata if available
        const optimizationMetadata = img.getOptimizationMetadata();
        if (optimizationMetadata && optimizationMetadata.optimized) {
          photo.optimized = optimizationMetadata.optimized;
          photo.optimizationMetadata = optimizationMetadata;
        }

        return photo;
      }));
    } catch (error) {
      logger.warn('Error fetching experience images', {
        experienceId: experience.id,
        error: error.message,
      });
    }

    return {
      id: experience.id,
      objectId: experience.id,
      name: experience.get('name'),
      description: experience.get('description'),
      type: experience.get('type'),
      providerType: experience.get('providerType'),
      duration: experience.get('duration'),
      cost: experience.get('cost'),
      price_child: experience.get('price_child') || null,
      price_no_alcohol: experience.get('price_no_alcohol') || null,
      min_people: experience.get('min_people'),
      experienciasCount,
      time_journey: experience.get('time_journey'),
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
      tours: includedTours.map((tour) => {
        const poi = tour.get('destinationPOI');
        return {
          id: tour.id,
          destinationPOI: poi
            ? {
              objectId: poi.id,
              name: poi.get('name'),
            }
            : null,
          time: tour.get('time'),
        };
      }),
      experienceCount: includedExperiences.length,
      providerExperienceCount: includedProviderExperiences.length,
      tourCount: includedTours.length,
      totalItemCount: includedExperiences.length + includedProviderExperiences.length + includedTours.length,
      availability: experience.get('availability') || null,
      photos,
      active: experience.get('active'),
      createdAt: experience.createdAt,
      updatedAt: experience.updatedAt,
    };
  }

  /**
   * GET /api/experiences/:id/price-history - Get price history for an experience.
   *
   * Retrieves all historical price records for a specific experience,
   * including active and historical versions ordered by creation date.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {object} JSON response with price history data.
   * @author Amexing Development Team
   * @version 1.0.0
   * @since 1.0.0
   * @example
   * GET /api/experiences/abcd1234/price-history
   * Response: {
   *   success: true,
   *   data: [
   *     {
   *       cost: 1500.00,
   *       validFrom: "2024-01-01T00:00:00Z",
   *       validUntil: "2024-06-01T00:00:00Z",
   *       status: "historical",
   *       duration: 152
   *     }
   *   ]
   * }
   */
  async getPriceHistory(req, res) {
    try {
      const { id: experienceId } = req.params;
      const currentUser = req.user;

      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      logger.info('Getting experience price history', {
        experienceId,
        userId: currentUser?.id,
      });

      // Create query to get all experience records with the same name
      // (including historical versions with valid_until set)
      const experienceQuery = new Parse.Query('Experience');
      experienceQuery.equalTo('objectId', experienceId);
      experienceQuery.equalTo('exists', true);

      const currentExperience = await experienceQuery.first({
        useMasterKey: true,
      });

      if (!currentExperience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      const experienceName = currentExperience.get('name');

      // Query all experiences with the same name (current and historical)
      const historyQuery = new Parse.Query('Experience');
      historyQuery.equalTo('name', experienceName);
      historyQuery.equalTo('exists', true);
      historyQuery.addDescending('createdAt');
      historyQuery.limit(100); // Limit to last 100 price changes

      const priceHistory = await historyQuery.find({ useMasterKey: true });

      if (!priceHistory || priceHistory.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No price history found for this experience',
        });
      }

      // Process and format price history data
      const formattedHistory = priceHistory.map((record) => {
        const cost = parseFloat(record.get('cost') || 0);
        const createdAt = record.get('createdAt');
        const validUntil = record.get('valid_until');
        const isActive = !validUntil; // No valid_until means it's the active record

        // Calculate duration if there's a valid_until date
        let duration = null;
        if (validUntil) {
          const diffMs = validUntil.getTime() - createdAt.getTime();
          duration = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // Convert to days
        } else {
          // For active record, calculate days since creation
          const diffMs = new Date().getTime() - createdAt.getTime();
          duration = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        return {
          id: record.id,
          cost: cost.toFixed(2),
          validFrom: createdAt.toISOString(),
          validUntil: validUntil ? validUntil.toISOString() : null,
          status: isActive ? 'active' : 'historical',
          duration,
          createdAt: createdAt.toISOString(),
        };
      });

      logger.info('Price history retrieved successfully', {
        experienceId,
        experienceName,
        recordCount: formattedHistory.length,
        userId: currentUser?.id,
      });

      return res.json({
        success: true,
        data: formattedHistory,
        experienceName,
        totalRecords: formattedHistory.length,
      });
    } catch (error) {
      logger.error('Error getting experience price history', {
        experienceId: req.params.id,
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error retrieving price history', 500);
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

  /**
   * PUT /api/experiences/:id/service-items - Update experience service items.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Returns updated service items or error.
   * @example
   */
  async updateServiceItems(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Authentication required', 401);
      }

      const experienceId = req.params.id;
      if (!experienceId) {
        return this.sendError(res, 'Experience ID is required', 400);
      }

      const {
        subconcepts = [], subtotal = 0, iva = 0, total = 0,
      } = req.body;

      // Validate subconcepts is array
      if (!Array.isArray(subconcepts)) {
        return this.sendError(res, 'El campo subconcepts debe ser un array', 400);
      }

      // Validate numeric fields
      if (typeof subtotal !== 'number' || subtotal < 0) {
        return this.sendError(res, 'El subtotal debe ser un número positivo', 400);
      }

      // Validate IVA calculation (16% of subtotal)
      const expectedIva = Math.round(subtotal * 0.16 * 100) / 100;
      const ivaRounded = Math.round(iva * 100) / 100;
      if (Math.abs(ivaRounded - expectedIva) > 0.01) {
        return this.sendError(res, 'El IVA debe ser el 16% del subtotal', 400);
      }

      // Validate total calculation
      const expectedTotal = Math.round((subtotal + iva) * 100) / 100;
      const totalRounded = Math.round(total * 100) / 100;
      if (Math.abs(totalRounded - expectedTotal) > 0.01) {
        return this.sendError(res, 'El total debe ser la suma del subtotal + IVA', 400);
      }

      // Validate each subconcept
      for (let j = 0; j < subconcepts.length; j++) {
        const sub = subconcepts[j];

        // Validate time format HH:MM (optional)
        if (sub.time && !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(sub.time)) {
          return this.sendError(
            res,
            `Hora inválida en servicio ${j + 1}. Use formato HH:MM (00:00 - 23:59)`,
            400
          );
        }

        // Validate numeric fields
        if (sub.hours !== null && sub.hours !== undefined) {
          if (typeof sub.hours !== 'number' || sub.hours < 0) {
            return this.sendError(res, `Horas inválidas en servicio ${j + 1}`, 400);
          }
        }

        if (sub.unitPrice !== null && sub.unitPrice !== undefined) {
          if (typeof sub.unitPrice !== 'number' || sub.unitPrice < 0) {
            return this.sendError(res, `Precio unitario inválido en servicio ${j + 1}`, 400);
          }
        }

        if (sub.total !== null && sub.total !== undefined) {
          if (typeof sub.total !== 'number' || sub.total < 0) {
            return this.sendError(res, `Total inválido en servicio ${j + 1}`, 400);
          }
        }
      }

      // Query experience
      const query = new Parse.Query('Experience');
      query.equalTo('exists', true);
      const experience = await query.get(experienceId, { useMasterKey: true });

      if (!experience) {
        return this.sendError(res, 'Experience not found', 404);
      }

      // Build and save serviceItems
      const serviceItems = {
        subconcepts,
        subtotal,
        iva,
        total,
      };

      experience.set('serviceItems', serviceItems);

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

      logger.info('Experience service items updated successfully', {
        experienceId: experience.id,
        name: experience.get('name'),
        subconceptsCount: subconcepts.length,
        subtotal,
        iva,
        total,
        updatedBy: currentUser.id,
      });

      return res.json({
        success: true,
        data: {
          id: experience.id,
          serviceItems,
        },
        message: 'Servicios de experiencia actualizados exitosamente',
      });
    } catch (error) {
      logger.error('Error in ExperienceController.updateServiceItems', {
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
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al actualizar los servicios',
        500
      );
    }
  }
}

module.exports = new ExperienceController();
