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
    // this.saveClientPrices = this.saveClientPrices.bind(this);
    this.getAllRatePricesForServiceWithClientPrices = this.getAllRatePricesForServiceWithClientPrices.bind(this);
    this.debugRatePrices = this.debugRatePrices.bind(this);
    this.debugClientPrices = this.debugClientPrices.bind(this);
  }

  /**
   * SHARED HELPER: Get vehicle type and price for a service with client override priority
   * This is the single source of truth for both main table and expanded table.
   * @param {string} serviceId - Service ID.
   * @param {string} clientId - Client ID (optional).
   * @param {string} rateId - Rate ID (optional, if not provided will use any available rate).
   * @param specificVehicleId
   * @returns {Promise<object>} - {vehicleType, rate, finalPrice, isClientPrice}.
   * @example
   */
  async getServiceVehicleTypeAndPrice(serviceId, clientId = null, rateId = null, specificVehicleId = null) {
    try {
      // Get RatePrices for this service
      const ratePricesQuery = new Parse.Query('RatePrices');
      ratePricesQuery.equalTo('service', {
        __type: 'Pointer',
        className: 'Services',
        objectId: serviceId,
      });
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.include(['rate', 'vehicleType', 'service']);

      // If specific rate requested, filter by it
      if (rateId) {
        ratePricesQuery.equalTo('rate', {
          __type: 'Pointer',
          className: 'Rates',
          objectId: rateId,
        });
      }

      // If specific vehicle requested, filter by it (disables intelligent selection)
      if (specificVehicleId) {
        ratePricesQuery.equalTo('vehicleType', {
          __type: 'Pointer',
          className: 'VehicleTypes',
          objectId: specificVehicleId,
        });
      }

      let ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      if (ratePrices.length === 0) {
        // FALLBACK: If specific rateId was requested but no pricing found, try without rateId filter
        if (rateId) {
          const fallbackRatePricesQuery = new Parse.Query('RatePrices');
          fallbackRatePricesQuery.equalTo('service', {
            __type: 'Pointer',
            className: 'Services',
            objectId: serviceId,
          });
          fallbackRatePricesQuery.equalTo('exists', true);
          fallbackRatePricesQuery.equalTo('active', true);
          fallbackRatePricesQuery.include(['rate', 'vehicleType', 'service']);
          fallbackRatePricesQuery.ascending('rate'); // Get consistent ordering

          const fallbackRatePrices = await fallbackRatePricesQuery.find({ useMasterKey: true });

          if (fallbackRatePrices.length > 0) {
            // Use the fallback pricing
            ratePrices = fallbackRatePrices;
          } else {
            return null; // No pricing data found
          }
        } else {
          return null; // No pricing data found
        }
      }

      // Get client-specific prices if clientId provided
      const clientPricesMap = new Map();
      if (clientId) {
        const clientPricesQuery = new Parse.Query('ClientPrices');
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const clientPointer = new AmexingUser();
        clientPointer.id = clientId;

        clientPricesQuery.equalTo('clientPtr', clientPointer);
        clientPricesQuery.equalTo('itemType', 'SERVICES');
        clientPricesQuery.equalTo('itemId', serviceId);
        clientPricesQuery.equalTo('exists', true);
        clientPricesQuery.equalTo('active', true);
        // Only get active records (valid_until IS NULL)
        clientPricesQuery.doesNotExist('valid_until');
        clientPricesQuery.include(['ratePtr', 'vehiclePtr']);

        const clientPrices = await clientPricesQuery.find({ useMasterKey: true });

        // Create client prices map for quick lookup
        clientPrices.forEach((clientPrice) => {
          const rateIdFromClient = clientPrice.get('ratePtr')?.id;
          const vehicleTypeId = clientPrice.get('vehiclePtr')?.id;

          if (rateIdFromClient && vehicleTypeId) {
            const key = `${rateIdFromClient}_${vehicleTypeId}`;
            clientPricesMap.set(key, {
              precio: clientPrice.get('precio'),
              basePrice: clientPrice.get('basePrice'),
              isClientPrice: true,
            });
          }
        });
      }

      // NEW LOGIC: Build complete vehicle pricing list (RatePrices + ClientPrice overrides)
      const allVehiclePricing = [];

      // Step 1: Process all RatePrices and check for ClientPrice overrides
      for (const ratePrice of ratePrices) {
        const rate = ratePrice.get('rate');
        const vehicleType = ratePrice.get('vehicleType');
        const basePrice = ratePrice.get('price') || 0;

        if (!rate || !vehicleType) {
          return;
        }

        // Check if there's a client-specific price override for this rate/vehicle combination
        const exactKey = `${rate.id}_${vehicleType.id}`;
        const clientPriceData = clientPricesMap.get(exactKey);

        if (clientPriceData) {
          // Use ClientPrice instead of RatePrice
          allVehiclePricing.push({
            vehicleType,
            rate,
            finalPrice: clientPriceData.precio,
            basePrice: clientPriceData.basePrice || basePrice,
            isClientPrice: true,
          });
        } else {
          // Use base RatePrice
          allVehiclePricing.push({
            vehicleType,
            rate,
            finalPrice: basePrice,
            basePrice,
            isClientPrice: false,
          });
        }
      }

      // Step 2: Add any ClientPrices that don't have matching RatePrices
      for (const [key] of clientPricesMap.entries()) {
        const [clientRateId, vehicleId] = key.split('_');

        // Check if we already processed this combination in Step 1
        const alreadyExists = allVehiclePricing.some(
          (item) => item.rate?.id === clientRateId && item.vehicleType?.id === vehicleId
        );

        if (!alreadyExists) {
          // We would need to fetch the rate and vehicle objects here if needed
          // For now, skip these since they don't have corresponding RatePrices
        }
      }

      // Return the complete pricing list if we have any vehicles
      if (allVehiclePricing.length > 0) {
        // If rateId is specified, filter to only vehicles for that rate
        let filteredVehicles = allVehiclePricing;
        if (rateId) {
          filteredVehicles = allVehiclePricing.filter((v) => v.rate?.id === rateId);
        }

        if (filteredVehicles.length > 0) {
          // Return the first vehicle for backward compatibility, but include all in allVehicleOptions
          const result = filteredVehicles[0];
          result.allVehicleOptions = filteredVehicles;

          return result;
        }
        // Use all vehicles if none match the specific rate
        const result = allVehiclePricing[0];
        result.allVehicleOptions = allVehiclePricing;

        return result;
      }

      // Fallback to base pricing (no client overrides)

      // If a specific rateId was requested, find ALL vehicle types for that rate
      // Otherwise, use ALL available rate prices
      let matchingRatePrices = ratePrices;

      if (rateId) {
        matchingRatePrices = ratePrices.filter((rp) => rp.get('rate')?.id === rateId);

        if (matchingRatePrices.length === 0) {
          matchingRatePrices = ratePrices;
        }
      }

      // Return ALL vehicles for this rate (instead of just one)
      const fallbackVehiclePricing = matchingRatePrices.map((ratePrice) => {
        const rate = ratePrice.get('rate');
        const vehicleType = ratePrice.get('vehicleType');
        const basePrice = ratePrice.get('price') || 0;

        return {
          vehicleType,
          rate,
          finalPrice: basePrice,
          basePrice,
          isClientPrice: false,
        };
      });

      // Return the first one for backward compatibility, but include all in a new property
      const result = fallbackVehiclePricing[0];
      result.allVehicleOptions = fallbackVehiclePricing;

      return result;
    } catch (error) {
      // Silent error handling - return null for graceful degradation
      return null;
    }
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
    // Add no-cache headers to prevent browser caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Client ID for client-specific pricing and rate ID for consistent pricing
      const { clientId, rateId } = req.query;

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
      const ratePricesVehicleMap = {};
      const ratePricesRateMap = {};

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
          ratePricesQuery.include('vehicleType');

          const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

          // Create maps: serviceId_rateId -> price/vehicleType/rate
          ratePrices.forEach((rp) => {
            const serviceObjId = rp.get('service')?.id;
            const rateObjId = rp.get('rate')?.id;
            const vehicleType = rp.get('vehicleType');
            const rate = rp.get('rate');

            if (serviceObjId && rateObjId) {
              const key = `${serviceObjId}_${rateObjId}`;
              ratePricesMap[key] = rp.get('price') || 0;
              ratePricesVehicleMap[key] = vehicleType;
              ratePricesRateMap[key] = rate;
            }
          });
        } catch (error) {
          logger.error('Error loading rate prices for services', {
            error: error.message,
          });
        }
      }

      // Get client-specific prices if clientId is provided
      const clientPricesMap = {};
      if (clientId && serviceIds.length > 0) {
        try {
          // Since Parse SDK queries fail with "Service Unavailable", use a direct HTTP approach
          const http = require('http');
          const options = {
            hostname: 'localhost',
            port: 1337,
            path: '/parse/classes/ClientPrices',
            method: 'GET',
            headers: {
              'X-Parse-Application-Id': process.env.PARSE_APP_ID,
              'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY,
            },
          };

          const clientPricesData = await new Promise((resolve, reject) => {
            const httpReq = http.request(options, (httpRes) => {
              let data = '';
              httpRes.on('data', (chunk) => {
                data += chunk;
              });
              httpRes.on('end', () => {
                try {
                  const parsed = JSON.parse(data);
                  resolve(parsed);
                } catch (error) {
                  reject(new Error(`JSON parse error: ${error.message}`));
                }
              });
            });

            httpReq.on('error', (error) => {
              reject(new Error(`HTTP request error: ${error.message}`));
            });

            httpReq.end();
          });

          // Filter for our client and services (only current active prices)
          const relevantClientPrices = (clientPricesData.results || []).filter((cp) => {
            const isOurClient = cp.clientPtr && cp.clientPtr.objectId === clientId;
            const isServices = cp.itemType === 'SERVICES';
            const isActive = cp.active === true;
            const exists = cp.exists === true;
            const isCurrent = cp.valid_until === null || cp.valid_until === undefined;
            return isOurClient && isServices && isActive && exists && isCurrent;
          });

          // Create the pricing map
          relevantClientPrices.forEach((cp) => {
            const clientServiceId = cp.itemId;
            const clientRateId = cp.ratePtr?.objectId;
            if (clientServiceId && clientRateId) {
              const price = cp.precio || 0;
              const key = `${clientServiceId}_${clientRateId}`;
              clientPricesMap[key] = price;
            }
          });
        } catch (error) {
          logger.error('Error loading client prices for services', {
            clientId,
            error: error.message,
            errorCode: error.code,
            errorStack: error.stack,
          });
        }
      }

      // Format data for DataTables (with async helper support)
      const data = await Promise.all(services.map(async (service) => {
        try {
          // Handle potential null references safely
          const originPOI = service.get('originPOI');
          const destinationPOI = service.get('destinationPOI');
          // ✅ CORRECT ARCHITECTURE: No rate or vehicleType in Services table
          // Rate and vehicle type come only from RatePrices/ClientPrices

          // Get single price (client price if available, otherwise base price)
          let finalPrice = 0;
          let rateToUse = null; // ✅ Will come from RatePrices/ClientPrices via single source of truth
          let vehicleTypeToUse = null; // ✅ Force to null - must come from RatePrices/ClientPrices

          // Debug logging for Queretaro service to track the vehicle type assignment
          if (service.id === '6p4zqx7YCf') {
            // Specific service processing
          }

          // Simple pricing: Use the helper method for consistency
          // Call helper when we have either clientId OR rateId (to get rate-specific pricing)
          // Use service.id or service.objectId (both should be the same in Parse)
          let serviceId = service.id || service.objectId || service.get('objectId');

          // If we have rateId but no serviceId, try alternative ways to get the ID
          if (!serviceId && rateId && service.attributes && service.attributes.objectId) {
            serviceId = service.attributes.objectId;
          }

          // Always try to get pricing when we have a rateId, even if serviceId is problematic
          if ((serviceId && (clientId || rateId)) || rateId) {
            // Try to call the helper if we have a serviceId
            let pricingData = null;
            if (serviceId) {
              pricingData = await this.getServiceVehicleTypeAndPrice(serviceId, clientId, rateId);
            }

            // If helper failed but we have rateId, provide a fallback using RatePrices directly
            if (!pricingData && rateId && service.get('destinationPOI')) {
              try {
                // Get the first available rate price for this service and rate
                const ratePriceQuery = new Parse.Query('RatePrices');
                ratePriceQuery.equalTo('active', true);
                ratePriceQuery.equalTo('exists', true);
                ratePriceQuery.include(['rate', 'vehicleType', 'service']);

                if (rateId) {
                  const ratePointer = new Parse.Object('Rates');
                  ratePointer.id = rateId;
                  ratePriceQuery.equalTo('rate', ratePointer);
                }

                const ratePrices = await ratePriceQuery.find({ useMasterKey: true });

                if (ratePrices.length > 0) {
                  const firstRatePrice = ratePrices[0];
                  const rate = firstRatePrice.get('rate');
                  const vehicleType = firstRatePrice.get('vehicleType');
                  const price = firstRatePrice.get('price') || 0;

                  vehicleTypeToUse = vehicleType;
                  rateToUse = rate;
                  finalPrice = price;

                  // Assign pricing data without modifying parameter
                  const priceDataForFallback = [{
                    vehicleType: {
                      name: vehicleType?.get('name'),
                      code: vehicleType?.get('code'),
                      defaultCapacity: vehicleType?.get('defaultCapacity'),
                      trunkCapacity: vehicleType?.get('trunkCapacity'),
                    },
                    price,
                    formattedPrice: `$${price.toLocaleString()} MXN`,
                  }];
                  Object.assign(service, { priceData: priceDataForFallback });
                }
              } catch (fallbackError) {
                // Fallback pricing failed - continue with no pricing
              }
            } else if (pricingData) {
              const { vehicleType, rate, finalPrice: pricingFinalPrice } = pricingData;
              vehicleTypeToUse = vehicleType;
              rateToUse = rate;
              finalPrice = pricingFinalPrice;

              // Check if we have multiple vehicle options from the helper method
              if (pricingData.allVehicleOptions && pricingData.allVehicleOptions.length > 1) {
                // Add ALL vehicle types to priceData
                const priceDataForMultiple = pricingData.allVehicleOptions.map((option) => ({
                  vehicleType: {
                    name: option.vehicleType?.get('name'),
                    code: option.vehicleType?.get('code'),
                    defaultCapacity: option.vehicleType?.get('defaultCapacity'),
                    trunkCapacity: option.vehicleType?.get('trunkCapacity'),
                  },
                  price: option.finalPrice,
                  formattedPrice: `$${option.finalPrice.toLocaleString()} MXN`,
                }));
                Object.assign(service, { priceData: priceDataForMultiple });
              } else {
                // Fallback to single vehicle (backward compatibility)
                const priceDataForSingle = [{
                  vehicleType: {
                    name: vehicleTypeToUse?.get('name'),
                    code: vehicleTypeToUse?.get('code'),
                    defaultCapacity: vehicleTypeToUse?.get('defaultCapacity'),
                    trunkCapacity: vehicleTypeToUse?.get('trunkCapacity'),
                  },
                  price: finalPrice,
                  formattedPrice: `$${finalPrice.toLocaleString()} MXN`,
                }];
                Object.assign(service, { priceData: priceDataForSingle });
              }
            } else if (clientId && rateId) {
              // FALLBACK: If no pricing data found but we have clientId and rateId,
              // try to get base pricing for this rate to show something instead of "Sin precios"

              try {
                // Get any RatePrice for this service and rate combination
                const fallbackRatePriceQuery = new Parse.Query('RatePrices');
                fallbackRatePriceQuery.equalTo('service', {
                  __type: 'Pointer',
                  className: 'Services',
                  objectId: serviceId,
                });
                fallbackRatePriceQuery.equalTo('rate', {
                  __type: 'Pointer',
                  className: 'Rate',
                  objectId: rateId,
                });
                fallbackRatePriceQuery.equalTo('active', true);
                fallbackRatePriceQuery.equalTo('exists', true);
                fallbackRatePriceQuery.include(['rate', 'vehicleType']);

                const fallbackRatePrice = await fallbackRatePriceQuery.first({ useMasterKey: true });

                if (fallbackRatePrice) {
                  const fallbackVehicleType = fallbackRatePrice.get('vehicleType');
                  const fallbackRate = fallbackRatePrice.get('rate');
                  const fallbackPrice = fallbackRatePrice.get('price') || 0;

                  vehicleTypeToUse = fallbackVehicleType;
                  rateToUse = fallbackRate;
                  finalPrice = fallbackPrice;

                  // Add fallback priceData
                  const fallbackPriceData = [{
                    vehicleType: {
                      name: fallbackVehicleType?.get('name'),
                      code: fallbackVehicleType?.get('code'),
                      defaultCapacity: fallbackVehicleType?.get('defaultCapacity'),
                      trunkCapacity: fallbackVehicleType?.get('trunkCapacity'),
                    },
                    price: fallbackPrice,
                    formattedPrice: `$${fallbackPrice.toLocaleString()} MXN`,
                  }];
                  Object.assign(service, { priceData: fallbackPriceData });
                } else {
                  // FALLBACK 3: If FALLBACK 1 failed, try to get ANY available pricing for this service
                  // (similar to FALLBACK 2 logic but for the clientId + rateId scenario)

                  try {
                    const fallback3Query = new Parse.Query('RatePrices');
                    fallback3Query.equalTo('service', {
                      __type: 'Pointer',
                      className: 'Services',
                      objectId: serviceId,
                    });
                    fallback3Query.equalTo('active', true);
                    fallback3Query.equalTo('exists', true);
                    fallback3Query.include(['rate', 'vehicleType']);
                    fallback3Query.ascending('rate'); // Sort by rate to get a consistent first option

                    const fallback3RatePrice = await fallback3Query.first({ useMasterKey: true });

                    if (fallback3RatePrice) {
                      const fallback3VehicleType = fallback3RatePrice.get('vehicleType');
                      const fallback3Rate = fallback3RatePrice.get('rate');
                      const fallback3Price = fallback3RatePrice.get('price') || 0;

                      vehicleTypeToUse = fallback3VehicleType;
                      rateToUse = fallback3Rate;
                      finalPrice = fallback3Price;

                      // Add fallback3 priceData
                      const fallback3PriceData = [{
                        vehicleType: {
                          name: fallback3VehicleType?.get('name'),
                          code: fallback3VehicleType?.get('code'),
                          defaultCapacity: fallback3VehicleType?.get('defaultCapacity'),
                          trunkCapacity: fallback3VehicleType?.get('trunkCapacity'),
                        },
                        price: fallback3Price,
                        formattedPrice: `$${fallback3Price.toLocaleString()} MXN`,
                      }];
                      Object.assign(service, { priceData: fallback3PriceData });
                    } else {
                      // No fallback pricing found
                    }
                  } catch (fallback3Error) {
                    console.error('❌ FALLBACK 3 ERROR:', fallback3Error.message);
                  }
                }
              } catch (fallbackError) {
                console.error('❌ FALLBACK ERROR:', fallbackError.message);
              }
            } else if (clientId && !rateId) {
              // FALLBACK 2: If we have clientId but no rateId (initial load),
              // get any available pricing for this service to show something

              try {
                // Get any RatePrice for this service (prefer Economic rate if available)
                const fallbackAnyRatePriceQuery = new Parse.Query('RatePrices');
                fallbackAnyRatePriceQuery.equalTo('service', {
                  __type: 'Pointer',
                  className: 'Services',
                  objectId: serviceId,
                });
                fallbackAnyRatePriceQuery.equalTo('active', true);
                fallbackAnyRatePriceQuery.equalTo('exists', true);
                fallbackAnyRatePriceQuery.include(['rate', 'vehicleType']);
                fallbackAnyRatePriceQuery.ascending('rate'); // Sort by rate to get a consistent first option

                const fallbackAnyRatePrice = await fallbackAnyRatePriceQuery.first({ useMasterKey: true });

                if (fallbackAnyRatePrice) {
                  const fallbackVehicleType = fallbackAnyRatePrice.get('vehicleType');
                  const fallbackRate = fallbackAnyRatePrice.get('rate');
                  const fallbackPrice = fallbackAnyRatePrice.get('price') || 0;

                  vehicleTypeToUse = fallbackVehicleType;
                  rateToUse = fallbackRate;
                  finalPrice = fallbackPrice;

                  // Add fallback priceData for initial load
                  const fallback2PriceData = [{
                    vehicleType: {
                      name: fallbackVehicleType?.get('name'),
                      code: fallbackVehicleType?.get('code'),
                      defaultCapacity: fallbackVehicleType?.get('defaultCapacity'),
                      trunkCapacity: fallbackVehicleType?.get('trunkCapacity'),
                    },
                    price: fallbackPrice,
                    formattedPrice: `$${fallbackPrice.toLocaleString()} MXN`,
                  }];
                  Object.assign(service, { priceData: fallback2PriceData });
                } else {
                  // No fallback pricing available
                }
              } catch (fallbackError) {
                console.error('❌ FALLBACK 2 ERROR:', fallbackError.message);
              }
            }
          }

          // Debug logging for Queretaro service after vehicle type assignment
          if (service.id === '6p4zqx7YCf') {
            // Queretaro service specific logging would go here
          }

          return {
            id: serviceId,
            objectId: serviceId,
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
            vehicleType: vehicleTypeToUse ? {
              id: vehicleTypeToUse.id,
              name: vehicleTypeToUse.get('name') || '-',
            } : { id: null, name: '-' },
            rate: rateToUse ? {
              id: rateToUse.id,
              name: rateToUse.get('name') || '-',
              percentage: rateToUse.get('percentage') || 0,
              color: rateToUse.get('color') || '#6366F1',
            } : null,
            price: finalPrice,
            note: service.get('note') || '',
            active: service.get('active') === true,
            exists: service.get('exists') === true,
            createdAt: service.get('createdAt'),
            updatedAt: service.get('updatedAt'),
            priceData: service.priceData || null,
          };
        } catch (error) {
          logger.error('Error formatting service data', {
            serviceId: service.id,
            error: error.message,
          });
          // Return a safe default object
          const serviceId = service.id || service.objectId;
          return {
            id: serviceId,
            objectId: serviceId,
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
            priceData: null,
          };
        }
      }));

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

      // Add cache-busting headers to ensure fresh pricing data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Last-Modified': new Date().toUTCString(),
        ETag: `"${Date.now()}"`, // Dynamic ETag based on timestamp
      });

      // Debug log the final data before sending response

      // Check for specific Queretaro service in response for debugging
      // const queretaroService = data.find((item) => item.id === '6p4zqx7YCf');

      // Check if this is a simple client-side request (no draw parameter)
      // If no draw parameter, return simple format for client-side processing
      if (!req.query.draw) {
        return res.json({
          success: true,
          data,
          timestamp: Date.now(), // Add timestamp for cache busting
        });
      }

      // Return DataTables server-side format
      return res.json({
        draw,
        recordsTotal,
        recordsFiltered,
        data,
        timestamp: Date.now(), // Add timestamp for cache busting
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

      const { rateId, clientId } = req.query;
      if (!rateId) {
        return this.sendError(res, 'ID de tarifa requerido', 400);
      }

      logger.info('ServicesController.getServicesWithRatePrices called', {
        userId: currentUser.id,
        rateId,
        clientId: clientId || 'none',
      });

      // 🔍 SPECIAL DEBUGGING FOR QUERETARO DATA

      // Let's examine what data we're working with specifically for Queretaro
      const debugServicesQuery = new Parse.Query('Services');
      debugServicesQuery.include(['originPOI', 'destinationPOI', 'vehicleType', 'rate']);
      debugServicesQuery.equalTo('active', true);
      debugServicesQuery.equalTo('exists', true);

      try {
        const allDebugServices = await debugServicesQuery.find({ useMasterKey: true });
        const queretaroServices = allDebugServices.filter((service) => {
          const destPOI = service.get('destinationPOI');
          const originPOI = service.get('originPOI');
          const destName = destPOI?.get('name') || '';
          const originName = originPOI?.get('name') || '';
          return destName.includes('Queretaro') || originName.includes('Queretaro')
                 || destName.includes('Querétaro') || originName.includes('Querétaro');
        });

        if (queretaroServices.length > 0) {
          for (const service of queretaroServices.slice(0, 2)) { // Limit to first 2 for brevity
            // Get RatePrices for this service
            const ratePricesQuery = new Parse.Query('RatePrices');
            ratePricesQuery.include(['servicePtr', 'ratePtr', 'vehiclePtr']);
            ratePricesQuery.equalTo('servicePtr', service);
            ratePricesQuery.equalTo('active', true);
            ratePricesQuery.equalTo('exists', true);

            await ratePricesQuery.find({ useMasterKey: true });
            // Rate prices retrieved for debugging purposes
          }
        }
      } catch (debugError) {
        console.error('🔍 DEBUG ERROR:', debugError);
      }

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

      // Get client-specific prices if clientId is provided
      const clientPricesMap = {};
      if (clientId && ratePrices.length > 0) {
        try {
          // Since Parse SDK queries fail with "Service Unavailable", use a direct HTTP approach
          const http = require('http');
          const options = {
            hostname: 'localhost',
            port: 1337,
            path: '/parse/classes/ClientPrices',
            method: 'GET',
            headers: {
              'X-Parse-Application-Id': process.env.PARSE_APP_ID,
              'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY,
            },
          };

          const clientPricesData = await new Promise((resolve, reject) => {
            const httpReq = http.request(options, (httpRes) => {
              let data = '';
              httpRes.on('data', (chunk) => {
                data += chunk;
              });
              httpRes.on('end', () => {
                try {
                  const parsed = JSON.parse(data);
                  resolve(parsed);
                } catch (error) {
                  reject(new Error(`JSON parse error: ${error.message}`));
                }
              });
            });

            httpReq.on('error', (error) => {
              reject(new Error(`HTTP request error: ${error.message}`));
            });

            httpReq.end();
          });

          // Filter for our client and services
          const relevantClientPrices = (clientPricesData.results || []).filter((cp) => {
            const isOurClient = cp.clientPtr && cp.clientPtr.objectId === clientId;
            const isServices = cp.itemType === 'SERVICES';
            const isActive = cp.active === true;
            const exists = cp.exists === true;
            // Remove rate filtering to match main table behavior (uses ANY client price)
            return isOurClient && isServices && isActive && exists;
          });

          // Create the pricing map using both ID and vehicle code for better matching
          relevantClientPrices.forEach((cp) => {
            const serviceId = cp.itemId;
            const vehicleId = cp.vehiclePtr?.objectId;
            const vehicleCode = cp.vehiclePtr?.code; // e.g., "VAN", "SEDAN"
            if (serviceId && vehicleId) {
              const price = cp.precio || 0;
              // Store by vehicle ID
              const keyById = `${serviceId}_${vehicleId}`;
              clientPricesMap[keyById] = price;

              // Also store by vehicle code for cross-table matching
              if (vehicleCode) {
                const keyByCode = `${serviceId}_CODE_${vehicleCode}`;
                clientPricesMap[keyByCode] = price;
              }
            }
          });
        } catch (error) {
          logger.error('Error loading client prices for getServicesWithRatePrices', {
            clientId,
            rateId,
            error: error.message,
            errorCode: error.code,
            errorStack: error.stack,
          });
        }
      }

      // 🎯 ULTIMATE SIMPLIFICATION: Just call the single source of truth for each RatePrice record
      // This ensures 100% consistency with the main table since we use the EXACT same method
      const data = await Promise.all(ratePrices.map(async (ratePrice) => {
        const service = ratePrice.get('service');
        const vehicleType = ratePrice.get('vehicleType');
        const basePrice = ratePrice.get('price') || 0;

        // 🎯 SIMPLE LOGIC: Check if THIS specific service + rate + vehicle has client pricing override
        let finalPrice = basePrice;
        let isClientPrice = false;

        // Check for client price override for this exact combination
        const clientPriceKey = `${service?.id}_${vehicleType?.id}`;
        const clientPriceOverride = clientPricesMap[clientPriceKey];

        if (clientPriceOverride) {
          finalPrice = clientPriceOverride;
          isClientPrice = true;
        } else {
          // Use base rate price when no client override exists
        }

        // Debug logging for service 6p4zqx7YCf
        if (service?.id === '6p4zqx7YCf') {
          // Specific service debugging would go here
        }

        // Create dual price display object for frontend
        let priceDisplay;
        if (clientId && isClientPrice) {
          priceDisplay = {
            basePrice,
            clientPrice: finalPrice,
            formattedBasePrice: `$${basePrice.toLocaleString()} MXN`,
            formattedClientPrice: `$${finalPrice.toLocaleString()} MXN`,
            showBoth: true,
          };
        }

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
            rate: ratePrice.get('rate') ? {
              id: ratePrice.get('rate').id,
              name: ratePrice.get('rate').get('name'),
            } : null,
          },
          vehicleType: vehicleType ? {
            id: vehicleType.id, // 🔥 Keep ORIGINAL vehicle from RatePrice
            name: vehicleType.get('name'),
            code: vehicleType.get('code'),
            defaultCapacity: vehicleType.get('defaultCapacity') || 4,
            trunkCapacity: vehicleType.get('trunkCapacity') || 2,
          } : null,
          price: finalPrice,
          formattedPrice: `$${finalPrice.toLocaleString()} MXN`,
          currency: 'MXN',
          priceDisplay,
        };
      }));

      logger.info('Services with rate prices retrieved successfully', {
        userId: currentUser.id,
        rateId,
        clientId: clientId || 'none',
        resultCount: data.length,
        clientPricesCount: Object.keys(clientPricesMap).length,
      });

      // Add cache-busting headers to ensure fresh pricing data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Last-Modified': new Date().toUTCString(),
        ETag: `"${Date.now()}"`,
      });

      return res.json({
        success: true,
        data,
        timestamp: Date.now(), // Add timestamp for cache busting
      });
    } catch (error) {
      logger.error('Error in getServicesWithRatePrices', {
        error: error.message,
        rateId: req.query?.rateId,
        clientId: req.query?.clientId,
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
   * GET /api/services/:id/all-rate-prices-with-client-prices?clientId=xxx - Get service pricing data with client-specific overrides.
   * Returns pricing information for all rates available for this service, with client-specific prices taking precedence.
   * @param {object} req - Express request object with params.id and query.clientId.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getAllRatePricesForServiceWithClientPrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { id: serviceId } = req.params;
      const { clientId } = req.query;

      if (!serviceId) {
        return this.sendError(res, 'ID de servicio requerido', 400);
      }

      logger.info('ServicesController.getAllRatePricesForServiceWithClientPrices called', {
        userId: currentUser.id,
        serviceId,
        clientId,
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

      // Get client-specific prices if clientId is provided
      let clientPrices = [];
      if (clientId) {
        const clientPricesQuery = new Parse.Query('ClientPrices');
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const clientPointer = new AmexingUser();
        clientPointer.id = clientId;

        clientPricesQuery.equalTo('clientPtr', clientPointer);
        clientPricesQuery.equalTo('itemType', 'SERVICES');
        clientPricesQuery.equalTo('itemId', serviceId);
        clientPricesQuery.equalTo('exists', true);
        clientPricesQuery.equalTo('active', true);
        // Only get active records (valid_until IS NULL)
        clientPricesQuery.doesNotExist('valid_until');
        clientPricesQuery.include(['ratePtr', 'vehiclePtr']);
        clientPricesQuery.limit(1000);

        clientPrices = await clientPricesQuery.find({ useMasterKey: true });
      }

      // Create a map of client prices for quick lookup
      const clientPricesMap = new Map();
      clientPrices.forEach((clientPrice) => {
        const rateId = clientPrice.get('ratePtr')?.id;
        const vehicleTypeId = clientPrice.get('vehiclePtr')?.id;
        if (rateId && vehicleTypeId) {
          const key = `${rateId}_${vehicleTypeId}`;
          clientPricesMap.set(key, {
            precio: clientPrice.get('precio'),
            basePrice: clientPrice.get('basePrice'),
            isClientPrice: true,
          });
        }
      });

      // Format the data, using client prices when available
      const data = ratePrices.map((ratePrice) => {
        const rate = ratePrice.get('rate');
        const vehicleType = ratePrice.get('vehicleType');
        const service = ratePrice.get('service');
        const basePrice = ratePrice.get('price') || 0;

        // Check if there's a client-specific price for this rate/vehicle combination
        // Try both vehicleType from RatePrices and from ClientPrices to find matching client price
        let clientPriceData = null;

        // First try: exact match with RatePrices vehicle type
        const exactKey = `${rate?.id}_${vehicleType?.id}`;
        clientPriceData = clientPricesMap.get(exactKey);

        // Second try: find by rate and vehicle name (in case different vehicle IDs for same type)
        if (!clientPriceData && rate && vehicleType) {
          for (const [key, priceData] of clientPricesMap.entries()) {
            const [clientRateId] = key.split('_');
            if (clientRateId === rate.id) {
              // Find matching client price by rate, regardless of exact vehicle ID
              const matchingClientPrice = clientPrices.find((cp) => cp.get('ratePtr')?.id === rate.id
                && cp.get('vehiclePtr')?.get('name')?.toLowerCase() === vehicleType.get('name')?.toLowerCase());
              if (matchingClientPrice) {
                clientPriceData = priceData;
                break;
              }
            }
          }
        }

        // Use client price if available, otherwise use base price
        const finalPrice = clientPriceData ? clientPriceData.precio : basePrice;

        // Debug logging for VAN vehicles to track the discrepancy issue
        if (vehicleType?.get('name')?.toLowerCase().includes('van') && rate?.get('name')?.toLowerCase().includes('económico')) {
          if (clientPriceData) {
            // VAN vehicle with client price override
          }
        }

        // Create dual price display object for frontend
        let priceDisplay;
        if (clientPriceData) {
          // Show both base and client price
          priceDisplay = {
            basePrice,
            clientPrice: clientPriceData.precio,
            formattedBasePrice: `$${basePrice.toLocaleString()} MXN`,
            formattedClientPrice: `$${clientPriceData.precio.toLocaleString()} MXN`,
            showBoth: true,
          };
        } else {
          // Show only base price
          priceDisplay = {
            basePrice,
            clientPrice: null,
            formattedBasePrice: `$${basePrice.toLocaleString()} MXN`,
            formattedClientPrice: null,
            showBoth: false,
          };
        }

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
          price: finalPrice,
          basePrice, // Always include base price for reference
          formattedPrice: `$${finalPrice.toLocaleString()} MXN`,
          priceDisplay, // Include dual price display object
          currency: 'MXN',
          isClientPrice: !!clientPriceData, // Flag to indicate if this is a custom price
        };
      });

      logger.info('Rate prices with client overrides retrieved successfully', {
        userId: currentUser.id,
        serviceId,
        clientId,
        totalPrices: data.length,
        clientOverrides: clientPricesMap.size,
      });

      return res.json({
        success: true,
        data,
        meta: {
          totalPrices: data.length,
          clientOverrides: clientPricesMap.size,
          hasClientPrices: clientPricesMap.size > 0,
        },
      });
    } catch (error) {
      logger.error('Error in getAllRatePricesForServiceWithClientPrices', {
        error: error.message,
        serviceId: req.params?.id,
        clientId: req.query?.clientId,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener precios con tarifas personalizadas', 500);
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
   * Save client-specific prices for a service.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async saveClientPrices(req, res) {
    try {
      const { clientId, serviceId, prices } = req.body;
      const currentUser = req.user;

      // Validate input
      if (!clientId || !serviceId || !prices || !Array.isArray(prices)) {
        return this.sendError(res, 'Datos incompletos', 400);
      }

      // Process each price
      const objectsToSave = [];
      const ClientPricesClass = Parse.Object.extend('ClientPrices');

      // First, find existing ACTIVE prices for this client and service (valid_until IS NULL)
      const existingQuery = new Parse.Query(ClientPricesClass);
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const clientPointer = new AmexingUser();
      clientPointer.id = clientId;

      existingQuery.equalTo('clientPtr', clientPointer);
      existingQuery.equalTo('itemType', 'SERVICES');
      existingQuery.equalTo('itemId', serviceId);
      existingQuery.equalTo('exists', true);
      // Only get active records (not versioned/historical ones)
      existingQuery.doesNotExist('valid_until');

      const existingPrices = await existingQuery.find({ useMasterKey: true });

      // Create a map to track which prices to update vs create
      const existingMap = new Map();
      existingPrices.forEach((price) => {
        const key = `${price.get('ratePtr').id}_${price.get('vehiclePtr').id}`;
        existingMap.set(key, price);
      });

      // Process each new price
      for (const priceData of prices) {
        const key = `${priceData.ratePtr}_${priceData.vehiclePtr}`;
        const existingPriceObject = existingMap.get(key);

        if (existingPriceObject) {
          // VERSIONING: Don't update existing price, instead:
          // 1. Mark existing price as historical (set valid_until to today)
          existingPriceObject.set('valid_until', new Date());
          existingPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          objectsToSave.push(existingPriceObject);

          // 2. Create NEW price record with the updated price
          const newPriceObject = new ClientPricesClass();

          const Rate = Parse.Object.extend('Rate');
          const ratePointer = new Rate();
          ratePointer.id = priceData.ratePtr;

          const VehicleType = Parse.Object.extend('VehicleType');
          const vehiclePointer = new VehicleType();
          vehiclePointer.id = priceData.vehiclePtr;

          newPriceObject.set('clientPtr', clientPointer);
          newPriceObject.set('ratePtr', ratePointer);
          newPriceObject.set('vehiclePtr', vehiclePointer);
          newPriceObject.set('itemType', 'SERVICES');
          newPriceObject.set('itemId', serviceId);
          newPriceObject.set('precio', priceData.precio);
          newPriceObject.set('basePrice', priceData.basePrice || 0);
          newPriceObject.set('currency', 'MXN');
          newPriceObject.set('active', true);
          newPriceObject.set('exists', true);
          newPriceObject.set('createdBy', currentUser ? currentUser.id : null);
          newPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          // valid_until remains null (active record)

          objectsToSave.push(newPriceObject);
          existingMap.delete(key);
        } else {
          // Create completely new price (no existing record)
          const newPriceObject = new ClientPricesClass();

          const Rate = Parse.Object.extend('Rate');
          const ratePointer = new Rate();
          ratePointer.id = priceData.ratePtr;

          const VehicleType = Parse.Object.extend('VehicleType');
          const vehiclePointer = new VehicleType();
          vehiclePointer.id = priceData.vehiclePtr;

          newPriceObject.set('clientPtr', clientPointer);
          newPriceObject.set('ratePtr', ratePointer);
          newPriceObject.set('vehiclePtr', vehiclePointer);
          newPriceObject.set('itemType', 'SERVICES');
          newPriceObject.set('itemId', serviceId);
          newPriceObject.set('precio', priceData.precio);
          newPriceObject.set('basePrice', priceData.basePrice || 0);
          newPriceObject.set('currency', 'MXN');
          newPriceObject.set('active', true);
          newPriceObject.set('exists', true);
          newPriceObject.set('createdBy', currentUser ? currentUser.id : null);
          newPriceObject.set('lastModifiedBy', currentUser ? currentUser.id : null);
          // valid_until remains null (active record)

          objectsToSave.push(newPriceObject);
        }
      }

      // Mark remaining existing prices as historical (prices that were removed)
      existingMap.forEach((price) => {
        // Set valid_until to today instead of marking as deleted
        price.set('valid_until', new Date());
        price.set('active', false);
        price.set('lastModifiedBy', currentUser ? currentUser.id : null);
        objectsToSave.push(price);
      });

      // Save all objects
      if (objectsToSave.length > 0) {
        await Parse.Object.saveAll(objectsToSave, { useMasterKey: true });
      }

      logger.info('Client prices saved successfully', {
        clientId,
        serviceId,
        priceCount: prices.length,
        userId: currentUser?.id,
      });

      return res.json({
        success: true,
        message: `Se guardaron ${prices.length} precio(s) personalizados`,
        data: {
          saved: prices.length,
          clientId,
          serviceId,
        },
      });
    } catch (error) {
      logger.error('Error saving client prices', {
        error: error.message,
        stack: error.stack,
        clientId: req.body?.clientId,
        serviceId: req.body?.serviceId,
        userId: req.user?.id,
      });

      return this.sendError(res, `Error al guardar los precios: ${error.message}`, 500);
    }
  }

  /**
   * GET /api/services/debug-rate-prices - Debug endpoint to examine RatePrices data.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async debugRatePrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { clientId, serviceId } = req.query;

      logger.info('🔧 DEBUG: Starting debugRatePrices', {
        userId: currentUser.id,
        clientId,
        serviceId,
      });

      // Get rate prices with detailed information
      const ratePricesQuery = new Parse.Query('RatePrices');

      if (serviceId) {
        ratePricesQuery.equalTo('service', {
          __type: 'Pointer',
          className: 'Services',
          objectId: serviceId,
        });
      }

      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.include('rate');
      ratePricesQuery.include('service');
      ratePricesQuery.include('vehicleType');
      ratePricesQuery.limit(100);

      const ratePrices = await ratePricesQuery.find({ useMasterKey: true });

      // Format debug data
      const debugData = ratePrices.map((rp) => {
        const service = rp.get('service');
        const rate = rp.get('rate');
        const vehicleType = rp.get('vehicleType');

        return {
          id: rp.id,
          serviceId: service?.id,
          serviceName: service ? `${service.get('originPOI')?.get('name') || 'N/A'} → ${service.get('destinationPOI')?.get('name') || 'N/A'}` : 'N/A',
          rateId: rate?.id,
          rateName: rate?.get('name'),
          vehicleTypeId: vehicleType?.id,
          vehicleTypeName: vehicleType?.get('name'),
          price: rp.get('price'),
          formattedPrice: `$${(rp.get('price') || 0).toLocaleString()} MXN`,
          active: rp.get('active'),
          exists: rp.get('exists'),
          createdAt: rp.get('createdAt'),
          updatedAt: rp.get('updatedAt'),
        };
      });

      // Statistics
      const stats = {
        totalRatePrices: ratePrices.length,
        uniqueServices: [...new Set(debugData.map((d) => d.serviceId))].length,
        uniqueRates: [...new Set(debugData.map((d) => d.rateId))].length,
        uniqueVehicleTypes: [...new Set(debugData.map((d) => d.vehicleTypeId))].length,
        priceRange: {
          min: Math.min(...debugData.map((d) => d.price || 0)),
          max: Math.max(...debugData.map((d) => d.price || 0)),
          average: debugData.reduce((sum, d) => sum + (d.price || 0), 0) / debugData.length,
        },
      };

      logger.info('🔧 DEBUG: RatePrices data retrieved', stats);

      return res.json({
        success: true,
        debug: 'RatePrices',
        data: debugData,
        stats,
        meta: {
          query: {
            clientId: clientId || null,
            serviceId: serviceId || null,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('🔧 DEBUG: Error in debugRatePrices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });
      return this.sendError(res, `Error en debug RatePrices: ${error.message}`, 500);
    }
  }

  /**
   * GET /api/services/debug-client-prices - Debug endpoint to examine ClientPrices data.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async debugClientPrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const { clientId, serviceId } = req.query;

      logger.info('🔧 DEBUG: Starting debugClientPrices', {
        userId: currentUser.id,
        clientId,
        serviceId,
      });

      // Method 1: Try Parse SDK first
      let clientPricesViaParse = [];
      let parseError = null;
      try {
        const clientPricesQuery = new Parse.Query('ClientPrices');

        if (clientId) {
          const AmexingUser = Parse.Object.extend('AmexingUser');
          const clientPointer = new AmexingUser();
          clientPointer.id = clientId;
          clientPricesQuery.equalTo('clientPtr', clientPointer);
        }

        if (serviceId) {
          clientPricesQuery.equalTo('itemId', serviceId);
        }

        clientPricesQuery.equalTo('itemType', 'SERVICES');
        clientPricesQuery.equalTo('exists', true);
        clientPricesQuery.equalTo('active', true);
        // Only get active records (valid_until IS NULL)
        clientPricesQuery.doesNotExist('valid_until');
        clientPricesQuery.include('ratePtr');
        clientPricesQuery.include('vehiclePtr');
        clientPricesQuery.include('clientPtr');
        clientPricesQuery.limit(100);

        clientPricesViaParse = await clientPricesQuery.find({ useMasterKey: true });
        logger.info('🔧 DEBUG: Parse SDK query successful', {
          count: clientPricesViaParse.length,
        });
      } catch (error) {
        parseError = error;
        logger.warn('🔧 DEBUG: Parse SDK query failed', {
          error: error.message,
        });
      }

      // Method 2: Direct HTTP approach (our workaround)
      let clientPricesViaHTTP = [];
      let httpError = null;
      try {
        const http = require('http');
        const options = {
          hostname: 'localhost',
          port: 1337,
          path: '/parse/classes/ClientPrices',
          method: 'GET',
          headers: {
            'X-Parse-Application-Id': process.env.PARSE_APP_ID,
            'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY,
          },
        };

        const clientPricesData = await new Promise((resolve, reject) => {
          const httpReq = http.request(options, (httpRes) => {
            let data = '';
            httpRes.on('data', (chunk) => {
              data += chunk;
            });
            httpRes.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                resolve(parsed);
              } catch (error) {
                reject(new Error(`JSON parse error: ${error.message}`));
              }
            });
          });

          httpReq.on('error', (error) => {
            reject(new Error(`HTTP request error: ${error.message}`));
          });

          httpReq.end();
        });

        clientPricesViaHTTP = clientPricesData.results || [];
        logger.info('🔧 DEBUG: HTTP query successful', {
          count: clientPricesViaHTTP.length,
        });
      } catch (error) {
        httpError = error;
        logger.warn('🔧 DEBUG: HTTP query failed', {
          error: error.message,
        });
      }

      // Filter HTTP results if needed
      let filteredClientPrices = clientPricesViaHTTP;
      if (clientId || serviceId) {
        filteredClientPrices = clientPricesViaHTTP.filter((cp) => {
          const matchesClient = !clientId || (cp.clientPtr && cp.clientPtr.objectId === clientId);
          const matchesService = !serviceId || (cp.itemId === serviceId);
          const isServices = cp.itemType === 'SERVICES';
          const isActive = cp.active === true;
          const exists = cp.exists === true;
          return matchesClient && matchesService && isServices && isActive && exists;
        });
      }

      // Format debug data from Parse SDK
      const parseDebugData = clientPricesViaParse.map((cp) => {
        const client = cp.get('clientPtr');
        const rate = cp.get('ratePtr');
        const vehicle = cp.get('vehiclePtr');

        return {
          id: cp.id,
          clientId: client?.id,
          clientEmail: client?.get('email'),
          rateId: rate?.id,
          rateName: rate?.get('name'),
          vehicleId: vehicle?.id,
          vehicleName: vehicle?.get('name'),
          serviceId: cp.get('itemId'),
          itemType: cp.get('itemType'),
          precio: cp.get('precio'),
          basePrice: cp.get('basePrice'),
          currency: cp.get('currency'),
          active: cp.get('active'),
          exists: cp.get('exists'),
          createdAt: cp.get('createdAt'),
          updatedAt: cp.get('updatedAt'),
        };
      });

      // Format debug data from HTTP
      const httpDebugData = filteredClientPrices.map((cp) => ({
        id: cp.objectId,
        clientId: cp.clientPtr?.objectId,
        rateId: cp.ratePtr?.objectId,
        vehicleId: cp.vehiclePtr?.objectId,
        serviceId: cp.itemId,
        itemType: cp.itemType,
        precio: cp.precio,
        basePrice: cp.basePrice,
        currency: cp.currency,
        active: cp.active,
        exists: cp.exists,
        createdAt: cp.createdAt,
        updatedAt: cp.updatedAt,
      }));

      // Statistics
      const stats = {
        parseSDK: {
          success: !parseError,
          error: parseError?.message || null,
          count: parseDebugData.length,
        },
        httpAPI: {
          success: !httpError,
          error: httpError?.message || null,
          totalCount: clientPricesViaHTTP.length,
          filteredCount: filteredClientPrices.length,
        },
        comparison: {
          countMatch: parseDebugData.length === filteredClientPrices.length,
          parseCount: parseDebugData.length,
          httpCount: filteredClientPrices.length,
        },
      };

      logger.info('🔧 DEBUG: ClientPrices data comparison', stats);

      return res.json({
        success: true,
        debug: 'ClientPrices',
        methods: {
          parseSDK: {
            data: parseDebugData,
            error: parseError?.message || null,
          },
          httpAPI: {
            data: httpDebugData,
            error: httpError?.message || null,
          },
        },
        stats,
        meta: {
          query: {
            clientId: clientId || null,
            serviceId: serviceId || null,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('🔧 DEBUG: Error in debugClientPrices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });
      return this.sendError(res, `Error en debug ClientPrices: ${error.message}`, 500);
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
