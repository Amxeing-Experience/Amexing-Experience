/**
 * ServicesController - RESTful API for Services Management.
 *
 * Provides Ajax-ready endpoints for managing simplified transportation service catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active services.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging
 * - Pointer handling for POIs and VehicleTypes
 * - Focused on aeropuerto transfers.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/services - List all services with pagination
 * GET /api/services?active=true - List only active services
 * GET /api/services?filterAeropuerto=true - List only aeropuerto services
 * POST /api/services - Create new service
 * PUT /api/services/:id - Update service
 * DELETE /api/services/:id - Soft delete service
 */

const Parse = require('parse/node');
const Services = require('../../../domain/models/Services');
const RatePrices = require('../../../domain/models/RatePrices');
const logger = require('../../../infrastructure/logger');

/**
 * ServicesController class implementing RESTful API for Services table.
 */
class ServicesController {
  constructor() {
    this.maxPageSize = 200;
    this.defaultPageSize = 100;

    // Bind methods to ensure proper context
    this.getServices = this.getServices.bind(this);
    this.getActiveServices = this.getActiveServices.bind(this);
    this.getServiceById = this.getServiceById.bind(this);
    this.getServicePrices = this.getServicePrices.bind(this);
    this.getServicesWithRatePrices = this.getServicesWithRatePrices.bind(this);
    this.getAllRatePricesForService = this.getAllRatePricesForService.bind(this);
    this.createService = this.createService.bind(this);
    this.updateService = this.updateService.bind(this);
    this.updateServiceRate = this.updateServiceRate.bind(this);
    this.toggleServiceStatus = this.toggleServiceStatus.bind(this);
    this.deleteService = this.deleteService.bind(this);
  }

  /**
   * GET /api/services - Get services with DataTables server-side processing.
   *
   * Query Parameters (DataTables format):
   * - draw: Draw counter for DataTables
   * - start: Starting record number
   * - length: Number of records to return
   * - search[value]: Search term
   * - order[0][column]: Column index to sort
   * - order[0][dir]: Sort direction (asc/desc)
   * - filterAeropuerto: Filter for aeropuerto services only (true/false)
   * - active: Filter by active status (true/false).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getServices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      logger.info('ServicesController.getServices called', {
        userId: currentUser.id,
        query: req.query,
      });

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Filter for aeropuerto services only
      const filterAeropuerto = req.query.filterAeropuerto === 'true';

      // Optional active filter (true/false)
      const activeFilter = req.query.active;

      // Column mapping for sorting (matches frontend columns order)
      const columns = [
        'originPOI.name', // 0. Ruta (Origin)
        'rate.name', // 1. Categoría/Tarifa
        'note', // 2. Notas
        'active', // 3. Estado
      ];
      const sortField = columns[sortColumnIndex] || 'originPOI.name';

      // Apply aeropuerto filter first to get the right POIs
      let aeropuertoPOIs = [];
      if (filterAeropuerto) {
        // First get the Aeropuerto ServiceType
        const serviceTypeQuery = new Parse.Query('ServiceType');
        serviceTypeQuery.equalTo('name', 'Aeropuerto');
        const aeropuertoServiceType = await serviceTypeQuery.first({ useMasterKey: true });

        if (!aeropuertoServiceType) {
          // No Aeropuerto service type found, return empty result
          if (!req.query.draw) {
            return res.json({
              success: true,
              data: [],
            });
          }
          return res.json({
            draw,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: [],
          });
        }

        // Get aeropuerto POIs
        const aeropuertoQuery = new Parse.Query('POI');
        aeropuertoQuery.equalTo('serviceType', aeropuertoServiceType);
        aeropuertoQuery.equalTo('exists', true);
        aeropuertoQuery.equalTo('active', true);
        aeropuertoPOIs = await aeropuertoQuery.find({ useMasterKey: true });

        if (aeropuertoPOIs.length === 0) {
          // No aeropuerto POIs found, return empty result
          if (!req.query.draw) {
            return res.json({
              success: true,
              data: [],
            });
          }
          return res.json({
            draw,
            recordsTotal: 0,
            recordsFiltered: 0,
            data: [],
          });
        }
      }

      /**
       * Helper function to create base query (OR queries can't be cloned)
       * Creates a Parse query with aeropuerto-specific filters or general service filters.
       * @returns {Parse.Query} Base query for services.
       * @example
       */
      const createBaseQuery = () => {
        let query;
        if (filterAeropuerto && aeropuertoPOIs.length > 0) {
          // Create aeropuerto-specific query with includes applied to each subquery
          const originQuery = new Parse.Query('Services');
          originQuery.containedIn('originPOI', aeropuertoPOIs);
          originQuery.equalTo('exists', true);
          if (activeFilter === 'true') {
            originQuery.equalTo('active', true);
          } else if (activeFilter === 'false') {
            originQuery.equalTo('active', false);
          }
          originQuery.include('originPOI');
          originQuery.include('originPOI.serviceType');
          originQuery.include('destinationPOI');
          originQuery.include('destinationPOI.serviceType');
          originQuery.include('vehicleType');
          originQuery.include('rate');

          const destQuery = new Parse.Query('Services');
          destQuery.containedIn('destinationPOI', aeropuertoPOIs);
          destQuery.equalTo('exists', true);
          if (activeFilter === 'true') {
            destQuery.equalTo('active', true);
          } else if (activeFilter === 'false') {
            destQuery.equalTo('active', false);
          }
          destQuery.include('originPOI');
          destQuery.include('originPOI.serviceType');
          destQuery.include('destinationPOI');
          destQuery.include('destinationPOI.serviceType');
          destQuery.include('vehicleType');
          destQuery.include('rate');

          query = Parse.Query.or(originQuery, destQuery);
        } else {
          // Regular query for all services
          query = new Parse.Query('Services');
          // Apply common filters
          query.equalTo('exists', true);
          if (activeFilter === 'true') {
            query.equalTo('active', true);
          } else if (activeFilter === 'false') {
            query.equalTo('active', false);
          }
          query.include('originPOI');
          query.include('originPOI.serviceType');
          query.include('destinationPOI');
          query.include('destinationPOI.serviceType');
          query.include('vehicleType');
          query.include('rate');
        }

        return query;
      };

      // Get total records count
      const totalRecordsQuery = createBaseQuery();
      const recordsTotal = await totalRecordsQuery.count({ useMasterKey: true });

      // Apply search filter if provided
      let filteredQuery = createBaseQuery();
      if (searchValue) {
        // For search, we need to create a new combined query structure
        // because we can't easily combine OR queries
        const searchQueries = [];

        /**
         * Helper to add constraints to each search query
         * Adds base constraints including existence, includes, and active status filters.
         * @param {Parse.Query} query - Parse query to add constraints to.
         * @example
         */
        const addBaseConstraints = (query) => {
          query.equalTo('exists', true);
          query.include('originPOI');
          query.include('destinationPOI');
          query.include('vehicleType');
          query.include('rate');

          if (activeFilter === 'true') {
            query.equalTo('active', true);
          } else if (activeFilter === 'false') {
            query.equalTo('active', false);
          }

          // Add aeropuerto constraints if needed
          if (filterAeropuerto && aeropuertoPOIs.length > 0) {
            // For aeropuerto filtering with search, we need to apply the aeropuerto
            // filter to each search query individually
            const originAeropuertoQuery = new Parse.Query('Services');
            originAeropuertoQuery.containedIn('originPOI', aeropuertoPOIs);

            const destAeropuertoQuery = new Parse.Query('Services');
            destAeropuertoQuery.containedIn('destinationPOI', aeropuertoPOIs);

            const aeropuertoFilter = Parse.Query.or(originAeropuertoQuery, destAeropuertoQuery);
            const combinedQuery = Parse.Query.and(query, aeropuertoFilter);
            return combinedQuery;
          }

          return query;
        };

        // Search in origin POI name
        let originSearchQuery = new Parse.Query('Services');
        const originPOIQuery = new Parse.Query('POI');
        originPOIQuery.contains('name', searchValue);
        originSearchQuery.matchesQuery('originPOI', originPOIQuery);
        originSearchQuery = addBaseConstraints(originSearchQuery);
        searchQueries.push(originSearchQuery);

        // Search in destination POI name
        let destSearchQuery = new Parse.Query('Services');
        const destPOIQuery = new Parse.Query('POI');
        destPOIQuery.contains('name', searchValue);
        destSearchQuery.matchesQuery('destinationPOI', destPOIQuery);
        destSearchQuery = addBaseConstraints(destSearchQuery);
        searchQueries.push(destSearchQuery);

        // Search in vehicle type name
        let vehicleSearchQuery = new Parse.Query('Services');
        const vehicleTypeQuery = new Parse.Query('VehicleType');
        vehicleTypeQuery.contains('name', searchValue);
        vehicleSearchQuery.matchesQuery('vehicleType', vehicleTypeQuery);
        vehicleSearchQuery = addBaseConstraints(vehicleSearchQuery);
        searchQueries.push(vehicleSearchQuery);

        // Search in notes
        let noteSearchQuery = new Parse.Query('Services');
        noteSearchQuery.contains('note', searchValue);
        noteSearchQuery = addBaseConstraints(noteSearchQuery);
        searchQueries.push(noteSearchQuery);

        // Combine all search queries with OR
        if (searchQueries.length > 0) {
          filteredQuery = Parse.Query.or(...searchQueries);
        }
      }

      // Get filtered records count
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Apply sorting
      if (sortDirection === 'desc') {
        filteredQuery.descending(sortField.includes('.') ? sortField.split('.')[0] : sortField);
      } else {
        filteredQuery.ascending(sortField.includes('.') ? sortField.split('.')[0] : sortField);
      }

      // Apply pagination
      filteredQuery.skip(start);
      filteredQuery.limit(length);

      // Execute query
      const services = await filteredQuery.find({ useMasterKey: true });

      // Get rate prices for all services to show pricing
      const serviceIds = services.map((service) => service.id);
      const ratePricesMap = {};

      if (serviceIds.length > 0) {
        try {
          // Query all rate prices for these services
          const ratePricesQuery = new Parse.Query('RatePrices');
          ratePricesQuery.containedIn('service', serviceIds.map((id) => ({
            __type: 'Pointer',
            className: 'Services',
            objectId: id,
          })));
          ratePricesQuery.equalTo('exists', true);
          ratePricesQuery.equalTo('active', true);
          ratePricesQuery.include('rate');
          ratePricesQuery.include('service');

          const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

          // Create a map: serviceId_rateId -> price
          ratePrices.forEach((rp) => {
            const serviceId = rp.get('service')?.id;
            const rateId = rp.get('rate')?.id;
            if (serviceId && rateId) {
              ratePricesMap[`${serviceId}_${rateId}`] = rp.get('price') || 0;
            }
          });
        } catch (error) {
          logger.error('Error loading rate prices for services', {
            error: error.message,
          });
        }
      }

      // Format data for DataTables
      const data = services.map((service) => {
        try {
          // Handle potential null references safely
          const originPOI = service.get('originPOI');
          const destinationPOI = service.get('destinationPOI');
          const vehicleType = service.get('vehicleType');
          const rate = service.get('rate');

          // Get price from rate prices
          let price = 0;
          if (rate && service.id) {
            price = ratePricesMap[`${service.id}_${rate.id}`] || 0;
          }

          return {
            id: service.id,
            objectId: service.id,
            originPOI: originPOI ? {
              id: originPOI.id,
              name: originPOI.get('name') || '-',
              serviceType: originPOI.get('serviceType') ? {
                id: originPOI.get('serviceType').id,
                name: originPOI.get('serviceType').get('name') || '-',
              } : null,
            } : {
              id: null,
              name: 'Sin origen',
              serviceType: null,
            },
            destinationPOI: destinationPOI ? {
              id: destinationPOI.id,
              name: destinationPOI.get('name') || '-',
              serviceType: destinationPOI.get('serviceType') ? {
                id: destinationPOI.get('serviceType').id,
                name: destinationPOI.get('serviceType').get('name') || '-',
              } : null,
            } : {
              id: null,
              name: '-',
              serviceType: null,
            },
            vehicleType: vehicleType ? {
              id: vehicleType.id,
              name: vehicleType.get('name') || '-',
            } : { id: null, name: '-' },
            rate: rate ? {
              id: rate.id,
              name: rate.get('name') || '-',
              percentage: rate.get('percentage') || 0,
              color: rate.get('color') || '#6366F1',
            } : null,
            price,
            note: service.get('note') || '',
            active: service.get('active') === true,
            exists: service.get('exists') === true,
            createdAt: service.get('createdAt'),
            updatedAt: service.get('updatedAt'),
          };
        } catch (error) {
          logger.error('Error formatting service data', {
            serviceId: service.id,
            error: error.message,
          });
          // Return a safe default object
          return {
            id: service.id,
            objectId: service.id,
            originPOI: { id: null, name: 'Sin origen' },
            destinationPOI: { id: null, name: '-' },
            vehicleType: { id: null, name: '-' },
            rate: null,
            price: 0,
            note: '',
            active: false,
            exists: true,
            createdAt: service.get('createdAt'),
            updatedAt: service.get('updatedAt'),
          };
        }
      });

      // Debug specific services
      const debugService1 = data.find((s) => s.id === '6p4zqx7YCf');
      const debugService2 = data.find((s) => s.id === 'EN7xMYlTIf');

      if (debugService1) {
        logger.info('🎯 DEBUG: Service 6p4zqx7YCf in API response', {
          id: debugService1.id,
          destinationPOI: debugService1.destinationPOI?.name,
          destinationPOIId: debugService1.destinationPOI?.id,
          serviceType: debugService1.destinationPOI?.serviceType?.name,
          serviceTypeId: debugService1.destinationPOI?.serviceType?.id,
        });
      }

      if (debugService2) {
        logger.info('🎯 DEBUG: Service EN7xMYlTIf in API response', {
          id: debugService2.id,
          destinationPOI: debugService2.destinationPOI?.name,
          destinationPOIId: debugService2.destinationPOI?.id,
          serviceType: debugService2.destinationPOI?.serviceType?.name,
          serviceTypeId: debugService2.destinationPOI?.serviceType?.id,
        });
      }

      // Log successful query for audit
      logger.info('Services query executed successfully', {
        userId: currentUser.id,
        userRole: currentUser.role || 'unknown',
        resultCount: data.length,
        totalRecords: recordsTotal,
        filteredRecords: recordsFiltered,
        searchValue: searchValue || null,
        filterAeropuerto,
        activeFilter: activeFilter || null,
      });

      // Check if this is a simple client-side request (no draw parameter)
      // If no draw parameter, return simple format for client-side processing
      if (!req.query.draw) {
        return res.json({
          success: true,
          data,
        });
      }

      // Return DataTables server-side format
      return res.json({
        draw,
        recordsTotal,
        recordsFiltered,
        data,
      });
    } catch (error) {
      logger.error('Error in getServices - DETAILED ERROR LOGGING', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        query: req.query,
        filterAeropuerto: req.query.filterAeropuerto,
        errorName: error.name,
        errorCode: error.code,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      return this.sendError(res, 'Error al obtener servicios', 500);
    }
  }

  /**
   * GET /api/services/active - Get active services for dropdowns.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/services/active
   * Returns: Simple array of {value, label} for select options
   */
  async getActiveServices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      logger.info('ServicesController.getActiveServices called', {
        userId: currentUser.id,
      });

      // Get all active services
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.include('rate');
      query.ascending('destinationPOI'); // Sort by destination for better UX

      const services = await query.find({ useMasterKey: true });

      // Format for dropdown usage
      const formattedServices = services.map((service) => {
        const origin = service.get('originPOI')?.get('name') || 'Sin origen';
        const destination = service.get('destinationPOI')?.get('name') || '-';
        const vehicleType = service.get('vehicleType')?.get('name') || '-';
        const rate = service.get('rate')?.get('name') || '-';

        return {
          value: service.id,
          label: `${origin} → ${destination} (${vehicleType}, ${rate})`,
        };
      });

      logger.info('Active services retrieved successfully', {
        userId: currentUser.id,
        serviceCount: formattedServices.length,
      });

      return res.json({
        success: true,
        data: formattedServices,
      });
    } catch (error) {
      logger.error('Error in getActiveServices', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener servicios activos', 500);
    }
  }

  /**
   * GET /api/services/:id - Get single service by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getServiceById(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('originPOI.serviceType');
      query.include('destinationPOI');
      query.include('destinationPOI.serviceType');
      query.include('vehicleType');
      query.include('rate');

      const service = await query.get(id, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');

      // Get price from RatePrices if needed
      let price = 0;
      if (service.get('rate')?.id) {
        try {
          const ratePriceQuery = new Parse.Query('RatePrices');
          ratePriceQuery.equalTo('service', {
            __type: 'Pointer',
            className: 'Services',
            objectId: service.id,
          });
          ratePriceQuery.equalTo('rate', service.get('rate'));
          ratePriceQuery.equalTo('exists', true);
          ratePriceQuery.equalTo('active', true);

          const ratePrice = await ratePriceQuery.first({ useMasterKey: true });
          price = ratePrice?.get('price') || 0;
        } catch (error) {
          logger.warn('Error loading price for service', {
            serviceId: service.id,
            error: error.message,
          });
        }
      }

      const data = {
        id: service.id,
        originPOI: originPOI ? {
          id: originPOI.id,
          name: originPOI.get('name'),
          serviceType: originPOI.get('serviceType') ? {
            id: originPOI.get('serviceType').id,
            name: originPOI.get('serviceType').get('name'),
          } : null,
        } : null,
        destinationPOI: destinationPOI ? {
          id: destinationPOI.id,
          name: destinationPOI.get('name'),
          serviceType: destinationPOI.get('serviceType') ? {
            id: destinationPOI.get('serviceType').id,
            name: destinationPOI.get('serviceType').get('name'),
          } : null,
        } : null,
        vehicleType: {
          id: service.get('vehicleType')?.id,
          name: service.get('vehicleType')?.get('name'),
        },
        rate: {
          id: service.get('rate')?.id,
          name: service.get('rate')?.get('name'),
          color: service.get('rate')?.get('color') || '#6366F1',
        },
        price,
        note: service.get('note') || '',
        active: service.get('active'),
        exists: service.get('exists'),
        createdAt: service.get('createdAt'),
        updatedAt: service.get('updatedAt'),
      };

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in getServiceById', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener servicio', 500);
    }
  }

  /**
   * GET /api/services/with-rate-prices?rateId=xxx - Get all services with their prices for a specific rate.
   * @param {object} req - Express request object with query.rateId.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/services/with-rate-prices?rateId=abc123
   * Returns: {
   *   success: true,
   *   data: [
   *     {
   *       service: { id: "service1", originPOI: {...}, destinationPOI: {...} },
   *       price: 2500.00,
   *       formattedPrice: "$2,500.00 MXN",
   *       currency: "MXN"
   *     }
   *   ]
   * }
   */
  async getServicesWithRatePrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { rateId } = req.query;
      if (!rateId) {
        return this.sendError(res, 'ID de tarifa requerido', 400);
      }

      logger.info('ServicesController.getServicesWithRatePrices called', {
        userId: currentUser.id,
        rateId,
      });

      // Get all rate prices for the specific rate
      const ratePricesQuery = new Parse.Query('RatePrices');
      ratePricesQuery.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.include(['service', 'service.originPOI', 'service.destinationPOI', 'service.rate', 'vehicleType']);
      ratePricesQuery.limit(1000);

      const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      // Format the data
      const data = ratePrices.map((ratePrice) => {
        const service = ratePrice.get('service');
        const vehicleType = ratePrice.get('vehicleType');
        const price = ratePrice.get('price') || 0;

        return {
          service: {
            id: service?.id,
            originPOI: service?.get('originPOI') ? {
              id: service.get('originPOI').id,
              name: service.get('originPOI').get('name'),
            } : null,
            destinationPOI: service?.get('destinationPOI') ? {
              id: service.get('destinationPOI').id,
              name: service.get('destinationPOI').get('name'),
            } : null,
            rate: service?.get('rate') ? {
              id: service.get('rate').id,
              name: service.get('rate').get('name'),
            } : null,
          },
          vehicleType: vehicleType ? {
            id: vehicleType.id,
            name: vehicleType.get('name'),
            code: vehicleType.get('code'),
            defaultCapacity: vehicleType.get('defaultCapacity') || 4,
            trunkCapacity: vehicleType.get('trunkCapacity') || 2,
          } : null,
          price,
          formattedPrice: `$${price.toLocaleString()} MXN`,
          currency: 'MXN',
        };
      });

      logger.info('Services with rate prices retrieved successfully', {
        userId: currentUser.id,
        rateId,
        resultCount: data.length,
      });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in getServicesWithRatePrices', {
        error: error.message,
        rateId: req.query?.rateId,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener servicios con precios', 500);
    }
  }

  /**
   * GET /api/services/:id/all-rate-prices - Get all rate prices for a specific service.
   * Returns pricing information for ALL rates available for this service.
   * @param {object} req - Express request object with params.id.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/services/abc123/all-rate-prices
   * Returns: {
   *   success: true,
   *   data: [
   *     {
   *       rate: { id: 'rate1', name: 'Premium' },
   *       vehicleType: { id: 'vt1', name: 'Sedan', code: 'SEDAN' },
   *       price: 1500,
   *       formattedPrice: '$1,500.00 MXN'
   *     }
   *   ]
   * }
   */
  async getAllRatePricesForService(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { id: serviceId } = req.params;
      if (!serviceId) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      logger.info('ServicesController.getAllRatePricesForService called', {
        userId: currentUser.id,
        serviceId,
      });

      // Get all rate prices for the specific service
      const ratePricesQuery = new Parse.Query('RatePrices');
      ratePricesQuery.equalTo('service', {
        __type: 'Pointer',
        className: 'Services',
        objectId: serviceId,
      });
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.include(['rate', 'vehicleType', 'service']);
      ratePricesQuery.limit(1000);

      const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      // Format the data
      const data = ratePrices.map((ratePrice) => {
        const rate = ratePrice.get('rate');
        const vehicleType = ratePrice.get('vehicleType');
        const service = ratePrice.get('service');
        const price = ratePrice.get('price') || 0;

        return {
          rate: rate ? {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color') || '#6c757d',
          } : null,
          vehicleType: vehicleType ? {
            id: vehicleType.id,
            name: vehicleType.get('name'),
            code: vehicleType.get('code'),
            defaultCapacity: vehicleType.get('defaultCapacity') || 4,
            trunkCapacity: vehicleType.get('trunkCapacity') || 2,
          } : null,
          service: service ? {
            id: service.id,
          } : null,
          price,
          formattedPrice: `$${price.toLocaleString()} MXN`,
          currency: 'MXN',
        };
      });

      logger.info('All rate prices for service retrieved successfully', {
        userId: currentUser.id,
        serviceId,
        resultCount: data.length,
      });

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error in getAllRatePricesForService', {
        error: error.message,
        serviceId: req.params?.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener precios de todas las tarifas', 500);
    }
  }

  /**
   * GET /api/services/:id/prices - Get service pricing data by service ID.
   * Returns pricing information for all rates available for this service.
   * @param {object} req - Express request object with params.id.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * GET /api/services/abc123/prices
   * Returns: {
   *   success: true,
   *   data: [
   *     {
   *       rate: { id: "rate1", name: "Económico", percentage: 0 },
   *       price: 2500.00,
   *       formattedPrice: "$2,500.00",
   *       currency: "MXN"
   *     }
   *   ]
   * }
   */
  async getServicePrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      // Validate service ID format - Parse ObjectIds should be 10 character strings
      if (id === 'undefined' || id === 'null' || !id || id.length !== 10) {
        logger.warn('Invalid service ID format received in getServicePrices', {
          receivedId: id,
          idLength: id ? id.length : 'null',
          userId: currentUser.id,
        });
        return this.sendError(res, 'Formato de ID de servicio inválido', 400);
      }

      logger.info('ServicesController.getServicePrices called', {
        userId: currentUser.id,
        serviceId: id,
      });

      // Verify service exists
      let service;
      try {
        const serviceQuery = new Parse.Query('Services');
        serviceQuery.equalTo('exists', true);
        service = await serviceQuery.get(id, { useMasterKey: true });
      } catch (parseError) {
        logger.error('Error querying service in getServicePrices', {
          error: parseError.message,
          serviceId: id,
          userId: currentUser.id,
          parseErrorCode: parseError.code,
        });
        return this.sendError(res, 'Error al verificar el servicio', 500);
      }

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      // Get all rate prices for this service
      let ratePrices;
      try {
        logger.info('Attempting to call RatePrices.getRatePricesByService', {
          serviceId: id,
          ratePricesClass: typeof RatePrices,
          ratePricesMethod: typeof RatePrices.getRatePricesByService,
        });
        ratePrices = await RatePrices.getRatePricesByService(id);
        logger.info('RatePrices.getRatePricesByService completed successfully', {
          serviceId: id,
          resultCount: ratePrices ? ratePrices.length : 0,
        });
      } catch (ratePricesError) {
        logger.error('Error fetching RatePrices in getServicePrices', {
          error: ratePricesError.message,
          errorType: ratePricesError.constructor.name,
          serviceId: id,
          userId: currentUser.id,
          stack: ratePricesError.stack,
        });
        return this.sendError(res, 'Error al obtener precios por tarifas', 500);
      }

      // Format the pricing data
      let formattedPrices;
      try {
        logger.info('Starting to format pricing data', {
          serviceId: id,
          ratePricesCount: ratePrices.length,
          ratePricesType: typeof ratePrices,
          firstRatePrice: ratePrices.length > 0 ? {
            hasGetMethod: typeof ratePrices[0].get,
            ratePtrValue: ratePrices[0].get ? ratePrices[0].get('ratePtr') : 'no-get-method',
          } : 'no-rate-prices',
        });

        formattedPrices = ratePrices.map((ratePrice, index) => {
          try {
            logger.info(`Processing rate price ${index}`, {
              serviceId: id,
              ratePriceType: typeof ratePrice,
              ratePriceClassName: ratePrice.className,
              hasGetMethod: typeof ratePrice.get,
            });

            // Check if rate is properly included
            const rate = ratePrice.get('rate');
            logger.info(`Rate object extracted for index ${index}`, {
              serviceId: id,
              rateExists: !!rate,
              rateType: typeof rate,
              rateId: rate?.id || 'no-id',
              rateName: rate?.get ? rate.get('name') : 'no-get-method',
            });

            // Try to call methods safely
            let price; let formattedPrice; let
              currency;
            try {
              price = ratePrice.getPrice();
              formattedPrice = ratePrice.getFormattedPrice();
              currency = ratePrice.getCurrency();
            } catch (methodError) {
              logger.error(`Error calling RatePrice methods for index ${index}`, {
                serviceId: id,
                methodError: methodError.message,
              });
              price = 0;
              formattedPrice = '$0.00';
              currency = 'MXN';
            }

            return {
              rate: {
                id: rate?.id || null,
                name: rate?.get ? rate.get('name') : 'Sin tarifa',
                percentage: rate?.get ? rate.get('percentage') : 0,
              },
              price,
              formattedPrice,
              currency,
            };
          } catch (itemError) {
            logger.error(`Error formatting rate price item ${index}`, {
              serviceId: id,
              itemError: itemError.message,
              itemStack: itemError.stack,
            });
            // Return safe default object
            return {
              rate: {
                id: null,
                name: 'Error en tarifa',
                percentage: 0,
              },
              price: 0,
              formattedPrice: '$0.00',
              currency: 'MXN',
            };
          }
        });

        logger.info('Pricing data formatting completed', {
          serviceId: id,
          formattedCount: formattedPrices.length,
        });
      } catch (formatError) {
        logger.error('Error in pricing data formatting main block', {
          serviceId: id,
          formatError: formatError.message,
          formatStack: formatError.stack,
        });
        // Return empty array as fallback
        formattedPrices = [];
      }

      logger.info('Service pricing data retrieved successfully', {
        userId: currentUser.id,
        serviceId: id,
        priceCount: formattedPrices.length,
      });

      return res.json({
        success: true,
        data: formattedPrices,
      });
    } catch (error) {
      logger.error('Error in getServicePrices - MAIN CATCH', {
        error: error.message,
        errorType: error.constructor.name,
        serviceId: req.params?.id,
        userId: req.user?.id,
        stack: error.stack,
        errorString: error.toString(),
      });
      return this.sendError(res, 'Error al obtener precios del servicio', 500);
    }
  }

  /**
   * POST /api/services - Create new service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async createService(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Check permissions
      const userRole = currentUser.get?.('role') || currentUser.role;
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(res, 'Permisos insuficientes', 403);
      }

      const {
        originPOI, destinationPOI, vehicleType, rate, note,
      } = req.body;

      // Validation
      if (!destinationPOI || !vehicleType || !rate) {
        return this.sendError(res, 'Destino, tipo de vehículo y tarifa son requeridos', 400);
      }

      if (originPOI === destinationPOI) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      // Check if service already exists
      const existingService = await Services.findByRoute(originPOI, destinationPOI, vehicleType);
      if (existingService && existingService.get('exists')) {
        return this.sendError(res, 'Ya existe un servicio con esta ruta, tipo de vehículo y tarifa', 409);
      }

      // Create service
      const service = new Services();
      if (originPOI) {
        service.setOriginPOI({
          __type: 'Pointer',
          className: 'POI',
          objectId: originPOI,
        });
      }
      service.setDestinationPOI({
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationPOI,
      });
      service.setVehicleType({
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleType,
      });
      service.setRate({
        __type: 'Pointer',
        className: 'Rate',
        objectId: rate,
      });
      service.setNote(note || '');
      service.set('active', true);
      service.set('exists', true);

      await service.save(null, { useMasterKey: true });

      logger.info('Service created successfully', {
        serviceId: service.id,
        userId: currentUser.id,
        userRole,
      });

      return res.status(201).json({
        success: true,
        data: { id: service.id },
        message: 'Servicio creado exitosamente',
      });
    } catch (error) {
      logger.error('Error in createService', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        requestBody: req.body,
      });
      return this.sendError(res, 'Error al crear servicio', 500);
    }
  }

  /**
   * PUT /api/services/:id - Update existing service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async updateService(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Check permissions
      const userRole = currentUser.get?.('role') || currentUser.role;
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(res, 'Permisos insuficientes', 403);
      }

      const { id } = req.params;
      const {
        originPOI, destinationPOI, vehicleType, rate, note,
      } = req.body;

      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      // Validation
      if (!destinationPOI || !vehicleType || !rate) {
        return this.sendError(res, 'Destino, tipo de vehículo y tarifa son requeridos', 400);
      }

      if (originPOI === destinationPOI) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      // Get existing service
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      const service = await query.get(id, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      // Check if updated route would conflict with another service
      const existingService = await Services.findByRoute(originPOI, destinationPOI, vehicleType);
      if (existingService && existingService.id !== id && existingService.get('exists')) {
        return this.sendError(res, 'Ya existe otro servicio con esta ruta y tipo de vehículo', 409);
      }

      // Update service
      if (originPOI) {
        service.setOriginPOI({
          __type: 'Pointer',
          className: 'POI',
          objectId: originPOI,
        });
      } else {
        service.unset('originPOI');
      }
      service.setDestinationPOI({
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationPOI,
      });
      service.setVehicleType({
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleType,
      });
      service.setRate({
        __type: 'Pointer',
        className: 'Rate',
        objectId: rate,
      });
      service.setNote(note || '');

      await service.save(null, { useMasterKey: true });

      logger.info('Service updated successfully', {
        serviceId: service.id,
        userId: currentUser.id,
        userRole,
      });

      return res.json({
        success: true,
        message: 'Servicio actualizado exitosamente',
      });
    } catch (error) {
      logger.error('Error in updateService', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
        requestBody: req.body,
      });
      return this.sendError(res, 'Error al actualizar servicio', 500);
    }
  }

  /**
   * PATCH /api/services/:id/toggle-status - Toggle service active status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async toggleServiceStatus(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Check permissions
      const userRole = currentUser.get?.('role') || currentUser.role;
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(res, 'Permisos insuficientes', 403);
      }

      const { id } = req.params;
      const { active } = req.body;

      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'Estado activo debe ser verdadero o falso', 400);
      }

      // Get existing service
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      const service = await query.get(id, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      // Update status
      service.set('active', active);
      await service.save(null, { useMasterKey: true });

      logger.info('Service status toggled', {
        serviceId: service.id,
        newStatus: active,
        userId: currentUser.id,
        userRole,
      });

      return res.json({
        success: true,
        message: `Servicio ${active ? 'activado' : 'desactivado'} exitosamente`,
      });
    } catch (error) {
      logger.error('Error in toggleServiceStatus', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al cambiar estado del servicio', 500);
    }
  }

  /**
   * DELETE /api/services/:id - Soft delete service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async deleteService(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Check permissions
      const userRole = currentUser.get?.('role') || currentUser.role;
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(res, 'Permisos insuficientes', 403);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      // Get existing service
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      const service = await query.get(id, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      // Soft delete
      service.set('exists', false);
      service.set('active', false);
      await service.save(null, { useMasterKey: true });

      logger.info('Service deleted successfully', {
        serviceId: service.id,
        userId: currentUser.id,
        userRole,
      });

      return res.json({
        success: true,
        message: 'Servicio eliminado exitosamente',
      });
    } catch (error) {
      logger.error('Error in deleteService', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al eliminar servicio', 500);
    }
  }

  /**
   * PATCH /api/services/:id/rate - Update service rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Update service rate
   * PATCH /api/services/abc123/rate
   * Body: { rateId: "def456" }
   */
  async updateServiceRate(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Check permissions
      const userRole = currentUser.get?.('role') || currentUser.role;
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(res, 'Permisos insuficientes', 403);
      }

      const { id } = req.params;
      const { rateId } = req.body;

      if (!id) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      if (!rateId) {
        return this.sendError(res, 'ID de tarifa requerido', 400);
      }

      // Get existing service
      const query = new Parse.Query('Services');
      query.equalTo('exists', true);
      query.include('rate');
      const service = await query.get(id, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      // Update rate
      service.setRate({
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });

      await service.save(null, { useMasterKey: true });

      logger.info('Service rate updated successfully', {
        serviceId: service.id,
        rateId,
        userId: currentUser.id,
        userRole,
      });

      return res.json({
        success: true,
        message: 'Tarifa asignada exitosamente',
      });
    } catch (error) {
      logger.error('Error in updateServiceRate', {
        error: error.message,
        serviceId: req.params?.id,
        rateId: req.body?.rateId,
        userId: req.user?.id,
      });

      const message = error.code === 101 ? 'Servicio no encontrado' : 'Error al actualizar la tarifa';
      return this.sendError(res, message, error.code === 101 ? 404 : 500);
    }
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  sendError(res, message, statusCode = 500) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = new ServicesController();
