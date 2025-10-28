/**
 * ServiceController - RESTful API for Service Management.
 *
 * Provides Ajax-ready endpoints for managing transportation service catalog.
 * Restricted to SuperAdmin and Admin roles for write operations.
 * Public read access for active services.
 *
 * Features:
 * - RESTful API design (GET, POST, PUT, DELETE)
 * - Admin/SuperAdmin access control for write operations
 * - DataTables server-side integration
 * - Comprehensive validation and audit logging
 * - Pointer handling for POIs and VehicleTypes.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-01-15
 * @example
 * GET /api/services - List all services with pagination
 * POST /api/services - Create new service
 * PUT /api/services/:id - Update service
 * DELETE /api/services/:id - Soft delete service
 * GET /api/services/active - Get active services for dropdowns
 */

const Parse = require('parse/node');
const ServiceService = require('../../services/ServiceService');
const logger = require('../../../infrastructure/logger');

/**
 * ServiceController class implementing RESTful API.
 */
class ServiceController {
  constructor() {
    this.serviceService = new ServiceService();
    this.maxPageSize = 100;
    this.defaultPageSize = 25;
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
   * - order[0][dir]: Sort direction (asc/desc).
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

      // Parse DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = Math.min(parseInt(req.query.length, 10) || this.defaultPageSize, this.maxPageSize);
      const searchValue = req.query.search?.value || '';
      const sortColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const sortDirection = req.query.order?.[0]?.dir || 'asc';

      // Optional serviceType filter (e.g., 'Aeropuerto', 'Punto a Punto', 'Local')
      const serviceTypeFilter = req.query.serviceType || null;

      // Column mapping for sorting (matches frontend columns order)
      const columns = [
        'rate.name', // 0. Tarifa
        'originPOI.name', // 1. Origen
        'destinationPOI.name', // 2. Destino
        'vehicleType.name', // 3. Tipo de Vehículo
        'price', // 4. Costo
        'note', // 5. Notas
        'active', // 6. Estado
      ];
      const sortField = columns[sortColumnIndex] || 'rate.name';

      // Get total records count (without search filter, but with serviceType filter if provided)
      const totalRecordsQuery = new Parse.Query('Service');
      totalRecordsQuery.equalTo('exists', true);

      // Apply serviceType filter if provided
      if (serviceTypeFilter) {
        const serviceTypeQuery = new Parse.Query('ServiceType');
        serviceTypeQuery.equalTo('name', serviceTypeFilter);
        const serviceTypeObj = await serviceTypeQuery.first({ useMasterKey: true });

        if (serviceTypeObj) {
          const poiQuery = new Parse.Query('POI');
          poiQuery.equalTo('serviceType', serviceTypeObj);
          totalRecordsQuery.matchesQuery('destinationPOI', poiQuery);
        }
      }

      const recordsTotal = await totalRecordsQuery.count({
        useMasterKey: true,
      });

      // Build base query for all existing records
      const baseQuery = new Parse.Query('Service');
      baseQuery.equalTo('exists', true);
      baseQuery.include('originPOI');
      baseQuery.include('destinationPOI');
      baseQuery.include('destinationPOI.serviceType');
      baseQuery.include('vehicleType');
      baseQuery.include('rate');

      // Apply serviceType filter to base query
      if (serviceTypeFilter) {
        const serviceTypeQuery = new Parse.Query('ServiceType');
        serviceTypeQuery.equalTo('name', serviceTypeFilter);
        const serviceTypeObj = await serviceTypeQuery.first({ useMasterKey: true });

        if (serviceTypeObj) {
          const poiQuery = new Parse.Query('POI');
          poiQuery.equalTo('serviceType', serviceTypeObj);
          baseQuery.matchesQuery('destinationPOI', poiQuery);
        }
      }

      // Build filtered query with search
      let filteredQuery = baseQuery;
      if (searchValue) {
        // Pre-fetch serviceType object once if filter is provided
        let serviceTypeObj = null;
        if (serviceTypeFilter) {
          const serviceTypeQuery = new Parse.Query('ServiceType');
          serviceTypeQuery.equalTo('name', serviceTypeFilter);
          serviceTypeObj = await serviceTypeQuery.first({ useMasterKey: true });
        }

        // Search in origin POI names (filter POIs by serviceType if applicable)
        const originPOIQuery = new Parse.Query('POI');
        originPOIQuery.matches('name', searchValue, 'i');
        if (serviceTypeObj) {
          originPOIQuery.equalTo('serviceType', serviceTypeObj);
        }

        const originQuery = new Parse.Query('Service');
        originQuery.equalTo('exists', true);
        originQuery.matchesQuery('originPOI', originPOIQuery);
        originQuery.include('originPOI');
        originQuery.include('destinationPOI');
        originQuery.include('destinationPOI.serviceType');
        originQuery.include('vehicleType');
        originQuery.include('rate');

        // Also ensure destinationPOI matches serviceType
        if (serviceTypeObj) {
          const destPoiTypeQuery = new Parse.Query('POI');
          destPoiTypeQuery.equalTo('serviceType', serviceTypeObj);
          originQuery.matchesQuery('destinationPOI', destPoiTypeQuery);
        }

        // Search in destination POI names (filter POIs by serviceType if applicable)
        const destPOIQuery = new Parse.Query('POI');
        destPOIQuery.matches('name', searchValue, 'i');
        if (serviceTypeObj) {
          destPOIQuery.equalTo('serviceType', serviceTypeObj);
        }

        const destQuery = new Parse.Query('Service');
        destQuery.equalTo('exists', true);
        destQuery.matchesQuery('destinationPOI', destPOIQuery);
        destQuery.include('originPOI');
        destQuery.include('destinationPOI');
        destQuery.include('destinationPOI.serviceType');
        destQuery.include('vehicleType');
        destQuery.include('rate');

        // Destination POI query already has serviceType filter applied above

        // Search in vehicle type names
        const vehicleTypeQuery = new Parse.Query('VehicleType');
        vehicleTypeQuery.matches('name', searchValue, 'i');

        const vehicleQuery = new Parse.Query('Service');
        vehicleQuery.equalTo('exists', true);
        vehicleQuery.matchesQuery('vehicleType', vehicleTypeQuery);
        vehicleQuery.include('originPOI');
        vehicleQuery.include('destinationPOI');
        vehicleQuery.include('destinationPOI.serviceType');
        vehicleQuery.include('vehicleType');
        vehicleQuery.include('rate');

        // Apply serviceType filter to vehicle query
        if (serviceTypeObj) {
          const poiQuery = new Parse.Query('POI');
          poiQuery.equalTo('serviceType', serviceTypeObj);
          vehicleQuery.matchesQuery('destinationPOI', poiQuery);
        }

        // Search in rate names
        const rateTypeQuery = new Parse.Query('Rate');
        rateTypeQuery.matches('name', searchValue, 'i');

        const rateQuery = new Parse.Query('Service');
        rateQuery.equalTo('exists', true);
        rateQuery.matchesQuery('rate', rateTypeQuery);
        rateQuery.include('originPOI');
        rateQuery.include('destinationPOI');
        rateQuery.include('destinationPOI.serviceType');
        rateQuery.include('vehicleType');
        rateQuery.include('rate');

        // Apply serviceType filter to rate query
        if (serviceTypeObj) {
          const poiQuery = new Parse.Query('POI');
          poiQuery.equalTo('serviceType', serviceTypeObj);
          rateQuery.matchesQuery('destinationPOI', poiQuery);
        }

        filteredQuery = Parse.Query.or(originQuery, destQuery, vehicleQuery, rateQuery);
      }

      // Get count of filtered results
      const recordsFiltered = await filteredQuery.count({ useMasterKey: true });

      // Parse Server doesn't support sorting by nested Pointer fields
      // So we fetch all filtered results and sort in memory
      // Then apply pagination after sorting

      // Execute query without pagination first (to sort all results)
      const allServices = await filteredQuery.find({ useMasterKey: true });

      // Fetch incomplete Pointers to ensure all nested Pointers are loaded
      // This is especially important after OR queries which may not fully hydrate nested includes
      // Parse.Object.fetchAll requires all objects to be of the same class,
      // so we group them by className first
      if (allServices.length > 0) {
        // Step 1: Fetch first-level Pointers
        const pointersByClass = {
          POI: [],
          VehicleType: [],
          Rate: [],
        };

        allServices.forEach((service) => {
          const originPOI = service.get('originPOI');
          const destinationPOI = service.get('destinationPOI');
          const vehicleType = service.get('vehicleType');
          const rate = service.get('rate');

          // Check if Pointer is incomplete (doesn't have expected data)
          // A Pointer without a 'name' property needs to be fetched
          if (originPOI && typeof originPOI.get === 'function') {
            try {
              if (!originPOI.get('name')) {
                pointersByClass.POI.push(originPOI);
              }
            } catch (e) {
              pointersByClass.POI.push(originPOI);
            }
          }

          if (destinationPOI && typeof destinationPOI.get === 'function') {
            try {
              if (!destinationPOI.get('name')) {
                pointersByClass.POI.push(destinationPOI);
              }
            } catch (e) {
              pointersByClass.POI.push(destinationPOI);
            }
          }

          if (vehicleType && typeof vehicleType.get === 'function') {
            try {
              if (!vehicleType.get('name')) {
                pointersByClass.VehicleType.push(vehicleType);
              }
            } catch (e) {
              pointersByClass.VehicleType.push(vehicleType);
            }
          }

          if (rate && typeof rate.get === 'function') {
            try {
              if (!rate.get('name')) {
                pointersByClass.Rate.push(rate);
              }
            } catch (e) {
              pointersByClass.Rate.push(rate);
            }
          }
        });

        // Batch fetch all incomplete first-level Pointers by class
        const fetchPromises = [];
        if (pointersByClass.POI.length > 0) {
          fetchPromises.push(Parse.Object.fetchAll(pointersByClass.POI, { useMasterKey: true }));
        }
        if (pointersByClass.VehicleType.length > 0) {
          fetchPromises.push(
            Parse.Object.fetchAll(pointersByClass.VehicleType, {
              useMasterKey: true,
            })
          );
        }
        if (pointersByClass.Rate.length > 0) {
          fetchPromises.push(Parse.Object.fetchAll(pointersByClass.Rate, { useMasterKey: true }));
        }

        // Wait for first-level fetch operations to complete
        if (fetchPromises.length > 0) {
          await Promise.all(fetchPromises);
        }

        // Step 2: Now fetch nested serviceType Pointers from destinationPOI
        const serviceTypePointers = [];
        allServices.forEach((service) => {
          const destinationPOI = service.get('destinationPOI');
          if (destinationPOI && typeof destinationPOI.get === 'function') {
            try {
              const serviceType = destinationPOI.get('serviceType');
              if (serviceType && typeof serviceType.get === 'function') {
                try {
                  if (!serviceType.get('name')) {
                    serviceTypePointers.push(serviceType);
                  }
                } catch (e) {
                  serviceTypePointers.push(serviceType);
                }
              }
            } catch (e) {
              // serviceType may not be set, continue
            }
          }
        });

        // Fetch ServiceType Pointers
        if (serviceTypePointers.length > 0) {
          await Parse.Object.fetchAll(serviceTypePointers, {
            useMasterKey: true,
          });
        }
      }

      // Sort services in memory (Parse doesn't support nested field sorting)
      allServices.sort((a, b) => {
        let valueA;
        let valueB;

        switch (sortField) {
          case 'rate.name':
            valueA = a.get('rate')?.get('name') || '';
            valueB = b.get('rate')?.get('name') || '';
            break;
          case 'originPOI.name':
            valueA = a.get('originPOI')?.get('name') || '';
            valueB = b.get('originPOI')?.get('name') || '';
            break;
          case 'destinationPOI.name':
            valueA = a.get('destinationPOI')?.get('name') || '';
            valueB = b.get('destinationPOI')?.get('name') || '';
            break;
          case 'vehicleType.name':
            valueA = a.get('vehicleType')?.get('name') || '';
            valueB = b.get('vehicleType')?.get('name') || '';
            break;
          case 'price':
            valueA = a.get('price') || 0;
            valueB = b.get('price') || 0;
            break;
          case 'note':
            valueA = a.get('note') || '';
            valueB = b.get('note') || '';
            break;
          case 'active':
            valueA = a.get('active') ? 1 : 0;
            valueB = b.get('active') ? 1 : 0;
            break;
          default:
            valueA = a.get('rate')?.get('name') || '';
            valueB = b.get('rate')?.get('name') || '';
        }

        // Compare values
        let comparison = 0;
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          comparison = valueA.localeCompare(valueB, 'es-MX');
        } else if (typeof valueA === 'number' && typeof valueB === 'number') {
          comparison = valueA - valueB;
        } else {
          comparison = String(valueA).localeCompare(String(valueB), 'es-MX');
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });

      // Apply pagination after sorting
      const services = allServices.slice(start, start + length);

      // Format data for DataTables
      const data = services.map((service) => {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const serviceType = destinationPOI?.get('serviceType');
        const vehicleType = service.get('vehicleType');
        const rate = service.get('rate');

        return {
          id: service.id,
          objectId: service.id,
          originPOI: {
            id: originPOI?.id,
            name: originPOI?.get('name') || '-',
          },
          destinationPOI: {
            id: destinationPOI?.id,
            name: destinationPOI?.get('name') || '-',
            serviceType: {
              id: serviceType?.id,
              name: serviceType?.get('name') || '-',
            },
          },
          vehicleType: {
            id: vehicleType?.id,
            name: vehicleType?.get('name') || '-',
          },
          rate: {
            id: rate?.id,
            name: rate?.get('name') || '-',
            color: rate?.get('color') || '#6366F1',
          },
          note: service.get('note') || '',
          price: service.get('price') || 0,
          active: service.get('active'),
          createdAt: service.createdAt,
          updatedAt: service.updatedAt,
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
      logger.error('Error in ServiceController.getServices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener los servicios',
        500
      );
    }
  }

  /**
   * GET /api/services/active - Get active services for dropdowns.
   *
   * Returns simplified array of active services suitable for select/dropdown elements.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async getActiveServices(req, res) {
    try {
      const query = new Parse.Query('Service');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('destinationPOI.serviceType');
      query.include('vehicleType');
      query.include('rate');
      query.ascending('price');
      query.limit(1000);

      const services = await query.find({ useMasterKey: true });

      // Format for select options
      const options = services.map((service) => {
        const originPOI = service.get('originPOI');
        const destinationPOI = service.get('destinationPOI');
        const vehicleType = service.get('vehicleType');
        const rate = service.get('rate');

        return {
          value: service.id,
          label: `${originPOI?.get('name')} → ${destinationPOI?.get('name')} (${vehicleType?.get('name')})`,
          origin: originPOI?.get('name'),
          destination: destinationPOI?.get('name'),
          vehicleType: vehicleType?.get('name'),
          rate: {
            id: rate?.id,
            name: rate?.get('name'),
            color: rate?.get('color'),
          },
          price: service.get('price'),
        };
      });

      return this.sendSuccess(res, options, 'Active services retrieved successfully');
    } catch (error) {
      logger.error('Error in ServiceController.getActiveServices', {
        error: error.message,
        stack: error.stack,
      });

      return this.sendError(res, 'Error al obtener los servicios activos', 500);
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
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('destinationPOI.serviceType');
      query.include('vehicleType');
      query.include('rate');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      const originPOI = service.get('originPOI');
      const destinationPOI = service.get('destinationPOI');
      const serviceType = destinationPOI?.get('serviceType');
      const vehicleType = service.get('vehicleType');
      const rate = service.get('rate');

      const data = {
        id: service.id,
        originPOI: originPOI
          ? {
            id: originPOI.id,
            name: originPOI.get('name'),
          }
          : null,
        destinationPOI: {
          id: destinationPOI?.id,
          name: destinationPOI?.get('name'),
          serviceType: {
            id: serviceType?.id,
            name: serviceType?.get('name') || '-',
          },
        },
        vehicleType: {
          id: vehicleType?.id,
          name: vehicleType?.get('name'),
        },
        rate: {
          id: rate?.id,
          name: rate?.get('name'),
          color: rate?.get('color'),
        },
        note: service.get('note') || '',
        price: service.get('price'),
        active: service.get('active'),
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      };

      return this.sendSuccess(res, data, 'Servicio obtenido exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.getServiceById', {
        error: error.message,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, 'Error al obtener el servicio', 500);
    }
  }

  /**
   * POST /api/services - Create new service.
   *
   * Body Parameters:
   * - originPOI: string (required) - Origin POI ID
   * - destinationPOI: string (required) - Destination POI ID
   * - vehicleType: string (required) - VehicleType ID
   * - note: string (optional) - Service note
   * - price: number (required) - Service price.
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

      const {
        originPOI, destinationPOI, vehicleType, rate, note, price,
      } = req.body;

      // Validate required fields (origin is optional for local transfers)
      if (!destinationPOI) {
        return this.sendError(res, 'El destino es requerido', 400);
      }

      // Validate origin !== destination (only if both exist)
      if (originPOI && destinationPOI && originPOI === destinationPOI) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      if (!vehicleType) {
        return this.sendError(res, 'El tipo de vehículo es requerido', 400);
      }

      if (!rate) {
        return this.sendError(res, 'La tarifa es requerida', 400);
      }

      if (!price || parseFloat(price) <= 0) {
        return this.sendError(res, 'El precio debe ser mayor a 0', 400);
      }

      if (note && note.length > 500) {
        return this.sendError(res, 'La nota debe tener 500 caracteres o menos', 400);
      }

      // Check if route already exists
      const existingQuery = new Parse.Query('Service');

      // Handle origin: if provided, filter by it; if not, filter by null/undefined
      if (originPOI) {
        existingQuery.equalTo('originPOI', {
          __type: 'Pointer',
          className: 'POI',
          objectId: originPOI,
        });
      } else {
        existingQuery.doesNotExist('originPOI');
      }

      existingQuery.equalTo('destinationPOI', {
        __type: 'Pointer',
        className: 'POI',
        objectId: destinationPOI,
      });
      existingQuery.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleType,
      });
      existingQuery.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rate,
      });
      existingQuery.equalTo('exists', true);
      const existingCount = await existingQuery.count({ useMasterKey: true });

      if (existingCount > 0) {
        return this.sendError(res, 'Ya existe un servicio con esta ruta, tipo de vehículo y tarifa', 409);
      }

      // Verify POIs exist
      let originPOIObj = null;
      if (originPOI) {
        const originQuery = new Parse.Query('POI');
        originPOIObj = await originQuery.get(originPOI, {
          useMasterKey: true,
        });
        if (!originPOIObj) {
          return this.sendError(res, 'El origen no existe', 404);
        }
      }

      const destQuery = new Parse.Query('POI');
      const destPOIObj = await destQuery.get(destinationPOI, {
        useMasterKey: true,
      });
      if (!destPOIObj) {
        return this.sendError(res, 'El destino no existe', 404);
      }

      // Verify VehicleType exists
      const vehicleQuery = new Parse.Query('VehicleType');
      const vehicleTypeObj = await vehicleQuery.get(vehicleType, {
        useMasterKey: true,
      });
      if (!vehicleTypeObj) {
        return this.sendError(res, 'El tipo de vehículo no existe', 404);
      }

      // Verify Rate exists
      const rateQuery = new Parse.Query('Rate');
      const rateObj = await rateQuery.get(rate, {
        useMasterKey: true,
      });
      if (!rateObj) {
        return this.sendError(res, 'La tarifa no existe', 404);
      }

      // Create new service using Parse.Object.extend
      const ServiceClass = Parse.Object.extend('Service');
      const service = new ServiceClass();

      // Set originPOI only if provided (optional for local transfers)
      if (originPOIObj) {
        service.set('originPOI', originPOIObj);
      }

      service.set('destinationPOI', destPOIObj);
      service.set('vehicleType', vehicleTypeObj);
      service.set('rate', rateObj);
      service.set('note', note || '');
      service.set('price', parseFloat(price));
      service.set('active', true);
      service.set('exists', true);

      // Save with master key and user context for audit trail
      await service.save(null, {
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

      logger.info('Service created', {
        serviceId: service.id,
        origin: originPOIObj ? originPOIObj.get('name') : 'Sin origen (local)',
        destination: destPOIObj.get('name'),
        vehicleType: vehicleTypeObj.get('name'),
        rate: rateObj.get('name'),
        price: parseFloat(price),
        createdBy: currentUser.id,
      });

      const data = {
        id: service.id,
        originPOI: originPOIObj
          ? {
            id: originPOIObj.id,
            name: originPOIObj.get('name'),
          }
          : null,
        destinationPOI: {
          id: destPOIObj.id,
          name: destPOIObj.get('name'),
        },
        vehicleType: {
          id: vehicleTypeObj.id,
          name: vehicleTypeObj.get('name'),
        },
        rate: {
          id: rateObj.id,
          name: rateObj.get('name'),
          color: rateObj.get('color'),
        },
        note: service.get('note'),
        price: service.get('price'),
        active: service.get('active'),
      };

      return this.sendSuccess(res, data, 'Servicio creado exitosamente', 201);
    } catch (error) {
      logger.error('Error in ServiceController.createService', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al crear el servicio', 500);
    }
  }

  /**
   * PUT /api/services/:id - Update service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async updateService(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      // Get existing service
      const query = new Parse.Query('Service');
      query.equalTo('exists', true);
      query.include('originPOI');
      query.include('destinationPOI');
      query.include('vehicleType');
      query.include('rate');
      const service = await query.get(serviceId, { useMasterKey: true });

      if (!service) {
        return this.sendError(res, 'Servicio no encontrado', 404);
      }

      const {
        originPOI, destinationPOI, vehicleType, rate, note, price, active,
      } = req.body;

      // Update originPOI if provided
      if (originPOI) {
        const originQuery = new Parse.Query('POI');
        const originPOIObj = await originQuery.get(originPOI, {
          useMasterKey: true,
        });
        if (!originPOIObj) {
          return this.sendError(res, 'El origen no existe', 404);
        }
        service.set('originPOI', originPOIObj);
      }

      // Update destinationPOI if provided
      if (destinationPOI) {
        const destQuery = new Parse.Query('POI');
        const destPOIObj = await destQuery.get(destinationPOI, {
          useMasterKey: true,
        });
        if (!destPOIObj) {
          return this.sendError(res, 'El destino no existe', 404);
        }
        service.set('destinationPOI', destPOIObj);
      }

      // Validate origin !== destination
      const currentOrigin = service.get('originPOI');
      const currentDest = service.get('destinationPOI');
      if (currentOrigin && currentDest && currentOrigin.id === currentDest.id) {
        return this.sendError(res, 'El origen y destino deben ser diferentes', 400);
      }

      // Update vehicleType if provided
      if (vehicleType) {
        const vehicleQuery = new Parse.Query('VehicleType');
        const vehicleTypeObj = await vehicleQuery.get(vehicleType, {
          useMasterKey: true,
        });
        if (!vehicleTypeObj) {
          return this.sendError(res, 'El tipo de vehículo no existe', 404);
        }
        service.set('vehicleType', vehicleTypeObj);
      }

      // Update rate if provided
      if (rate) {
        const rateQuery = new Parse.Query('Rate');
        const rateObj = await rateQuery.get(rate, {
          useMasterKey: true,
        });
        if (!rateObj) {
          return this.sendError(res, 'La tarifa no existe', 404);
        }
        service.set('rate', rateObj);
      }

      // Update note if provided
      if (note !== undefined) {
        if (note.length > 500) {
          return this.sendError(res, 'La nota debe tener 500 caracteres o menos', 400);
        }
        service.set('note', note);
      }

      // Update price if provided
      if (price !== undefined) {
        const priceNum = parseFloat(price);
        if (priceNum <= 0) {
          return this.sendError(res, 'El precio debe ser mayor a 0', 400);
        }
        service.set('price', priceNum);
      }

      // Update active status if provided
      if (typeof active === 'boolean') {
        service.set('active', active);
      }

      // Save changes with user context for audit trail
      await service.save(null, {
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

      logger.info('Service updated', {
        serviceId: service.id,
        origin: service.get('originPOI')?.get('name') || 'Sin origen (local)',
        destination: service.get('destinationPOI')?.get('name'),
        vehicleType: service.get('vehicleType')?.get('name'),
        rate: service.get('rate')?.get('name'),
        price: service.get('price'),
        active: service.get('active'),
        updatedBy: currentUser.id,
      });

      const savedOriginPOI = service.get('originPOI');
      const data = {
        id: service.id,
        originPOI: savedOriginPOI
          ? {
            id: savedOriginPOI.id,
            name: savedOriginPOI.get('name'),
          }
          : null,
        destinationPOI: {
          id: service.get('destinationPOI')?.id,
          name: service.get('destinationPOI')?.get('name'),
        },
        vehicleType: {
          id: service.get('vehicleType')?.id,
          name: service.get('vehicleType')?.get('name'),
        },
        rate: {
          id: service.get('rate')?.id,
          name: service.get('rate')?.get('name'),
          color: service.get('rate')?.get('color'),
        },
        note: service.get('note'),
        price: service.get('price'),
        active: service.get('active'),
        updatedAt: service.updatedAt,
      };

      return this.sendSuccess(res, data, 'Servicio actualizado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.updateService', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
        body: req.body,
      });

      return this.sendError(res, 'Error al actualizar el servicio', 500);
    }
  }

  /**
   * PATCH /api/services/:id/toggle-status - Toggle service active/inactive status.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   * // Usage example documented above
   */
  async toggleServiceStatus(req, res) {
    try {
      const currentUser = req.user;
      const serviceId = req.params.id;
      const { active } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      if (typeof active !== 'boolean') {
        return this.sendError(res, 'El estado activo debe ser un valor booleano', 400);
      }

      const result = await this.serviceService.toggleServiceStatus(
        currentUser,
        serviceId,
        active,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, result.service, result.message || 'Estado actualizado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.toggleServiceStatus', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al cambiar el estado del servicio', 500);
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
      const serviceId = req.params.id;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!serviceId) {
        return this.sendError(res, 'El ID del servicio es requerido', 400);
      }

      await this.serviceService.softDeleteService(
        currentUser,
        serviceId,
        req.body?.reason || '',
        req.userRole // Pass userRole from JWT middleware
      );

      return this.sendSuccess(res, null, 'Servicio eliminado exitosamente');
    } catch (error) {
      logger.error('Error in ServiceController.deleteService', {
        error: error.message,
        stack: error.stack,
        serviceId: req.params.id,
        userId: req.user?.id,
      });

      return this.sendError(res, error.message || 'Error al eliminar el servicio', 500);
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
const serviceController = new ServiceController();
module.exports = serviceController;
