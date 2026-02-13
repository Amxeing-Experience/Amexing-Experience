/**
 * ClientPricesController - API for Managing Client-specific Pricing.
 *
 * Provides endpoints for managing client-specific pricing with markup/discount
 * from base prices (RatePrices for services, TourPrices for tours).
 *
 * Features:
 * - Bulk application of pricing with percentage markup
 * - Support for both services and tours
 * - Version history preservation
 * - Admin/SuperAdmin access control.
 * @author Amexing Development Team
 * @version 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * Client Prices Controller for managing bulk pricing operations and real-time updates.
 * Handles batch price calculations, progress tracking with Server-Sent Events (SSE),
 * and efficient bulk database operations for vehicle and tour pricing systems.
 * @class ClientPricesController
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // Usage in routes
 * router.post('/apply-pricing/:clientId', ClientPricesController.bulkApplyPricing);
 * router.get('/pricing-progress/:processId', ClientPricesController.getProgressUpdates);
 */
class ClientPricesController {
  constructor() { // Bind methods to preserve context
    this.bulkApplyPricing = this.bulkApplyPricing.bind(this);
    this.bulkApplyPricingWithProgress = this.bulkApplyPricingWithProgress.bind(this);
    this.getProgressUpdates = this.getProgressUpdates.bind(this);
    // Store active processes and SSE connections
    this.activeProcesses = new Map();
    this.sseConnections = new Map();
  }

  /**
   * POST /api/client-prices/bulk-apply
   * Apply bulk pricing with markup percentage for a client.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async bulkApplyPricing(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      } // Extract parameters
      const {
        clientId, applyToServices, applyToTours, markupPercentage,
      } = req.body; // Validate input
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Client ID is required',
        });
      }

      if (!applyToServices && !applyToTours) {
        return res.status(400).json({
          success: false,
          error: 'Must select at least one type (services or tours)',
        });
      }

      if (markupPercentage == null || markupPercentage < 0 || markupPercentage > 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid markup percentage (must be between 0 and 100)',
        });
      }

      logger.info(`Applying bulk pricing for client ${clientId} with ${markupPercentage}% markup`, {
        user: currentUser.get('email'),
        applyToServices,
        applyToTours,
      });
      // Get the client
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const clientQuery = new Parse.Query(AmexingUserClass);
      clientQuery.equalTo('objectId', clientId);
      const client = await clientQuery.first({ useMasterKey: true });
      if (!client) {
        return res.status(404).json({
          success: false,
          error: 'Client not found',
        });
      } const results = {
        servicesCreated: 0,
        servicesUpdated: 0,
        toursCreated: 0,
        toursUpdated: 0,
        errors: [],
      }; // Apply to services if selected
      if (applyToServices) {
        const serviceResults = await this.applyServicesPricing(client, markupPercentage);
        results.servicesCreated = serviceResults.created;
        results.servicesUpdated = serviceResults.updated;
        if (serviceResults.errors.length > 0) {
          results.errors.push(...serviceResults.errors);
        }
      }

      // Apply to tours if selected
      if (applyToTours) {
        const tourResults = await this.applyToursPricing(client, markupPercentage);
        results.toursCreated = tourResults.created;
        results.toursUpdated = tourResults.updated;
        if (tourResults.errors.length > 0) {
          results.errors.push(...tourResults.errors);
        }
      } // Log the results
      logger.info(`Bulk pricing applied successfully for client ${clientId}`, {
        user: currentUser.get('email'),
        results,
      });

      const totalCreated = results.servicesCreated + results.toursCreated;
      const totalUpdated = results.servicesUpdated + results.toursUpdated;
      const totalProcessed = totalCreated + totalUpdated;

      // Generate appropriate message based on results
      // Now we always create new versions for complete audit trail
      let message = '';
      if (totalProcessed === 0) {
        message = `No se encontraron precios base para aplicar el ${markupPercentage}% de incremento.`;
      } else if (totalCreated > 0 && totalUpdated === 0) {
        message = `Se crearon ${totalCreated} nuevos precios con ${markupPercentage}% de incremento.`;
      } else if (totalCreated === 0 && totalUpdated > 0) {
        message = `Se versionaron ${totalUpdated} precios existentes y se crearon nuevas entradas con ${markupPercentage}% de incremento.`;
      } else {
        message = `Se crearon ${totalCreated} nuevos precios y se versionaron ${totalUpdated} existentes con ${markupPercentage}% de incremento.`;
      }

      res.json({
        success: true,
        message,
        servicesCreated: results.servicesCreated,
        servicesUpdated: results.servicesUpdated,
        toursCreated: results.toursCreated,
        toursUpdated: results.toursUpdated,
        totalCreated,
        totalUpdated,
        markupPercentage,
        alreadyApplied: totalProcessed === 0,
        errors: results.errors,
      });
    } catch (error) {
      logger.error('Error applying bulk pricing:', error);
      res.status(500).json({
        success: false,
        error: `Error applying bulk pricing: ${error.message}`,
      });
    }
  }

  /**
   * POST /api/client-prices/bulk-apply-with-progress
   * Start bulk pricing process and return process ID for tracking.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async bulkApplyPricingWithProgress(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Extract parameters
      const {
        clientId, applyToServices, applyToTours, markupPercentage, startProcess,
      } = req.body;

      // If not starting process, return error (should always have startProcess=true)
      if (!startProcess) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request - startProcess parameter required',
        });
      }

      // Validate input
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Client ID is required',
        });
      }

      if (!applyToServices && !applyToTours) {
        return res.status(400).json({
          success: false,
          error: 'Must select at least one type (services or tours)',
        });
      }

      if (markupPercentage == null || markupPercentage < 0 || markupPercentage > 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid markup percentage (must be between 0 and 100)',
        });
      }

      // Generate unique process ID
      const processId = `bulk_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Initialize process state
      this.activeProcesses.set(processId, {
        status: 'starting',
        progress: 0,
        message: 'Iniciando proceso...',
        results: null,
        error: null,
        startTime: new Date(),
      });

      // Start background process
      this.startBulkPricingProcess(processId, {
        clientId,
        applyToServices,
        applyToTours,
        markupPercentage,
        currentUser,
      }).catch((error) => {
        this.activeProcesses.set(processId, {
          ...this.activeProcesses.get(processId),
          status: 'error',
          error: error.message,
        });
      });

      // Return process ID immediately
      res.json({
        success: true,
        processId,
        message: 'Process started successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Error starting bulk pricing process: ${error.message}`,
      });
    }
  }

  /**
   * GET /api/client-prices/progress/:processId
   * Get progress updates via Server-Sent Events.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getProgressUpdates(req, res) {
    const { processId } = req.params;
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    /**
     * Send Server-Sent Events data to the connected client.
     * @param {object} data - Data object to send via SSE.
     * @example
     * sendSSE({ type: 'progress', value: 50, message: 'Processing...' });
     */
    const sendSSE = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Check if process exists
    if (!this.activeProcesses.has(processId)) {
      sendSSE({
        type: 'error',
        error: 'Process not found or expired',
      });
      res.end();
      return;
    }

    // Store SSE connection
    this.sseConnections.set(processId, { res, sendSSE });

    // Send initial status
    const currentState = this.activeProcesses.get(processId);
    sendSSE({
      type: 'status',
      message: currentState.message,
      progress: currentState.progress,
    });

    // Handle client disconnect
    req.on('close', () => {
      this.sseConnections.delete(processId);
    });

    // Auto-cleanup after 10 minutes
    setTimeout(() => {
      if (this.sseConnections.has(processId)) {
        this.sseConnections.delete(processId);
        this.activeProcesses.delete(processId);
        res.end();
      }
    }, 600000); // 10 minutes
  }

  /**
   * Apply pricing to services for a client (OPTIMIZED VERSION).
   * @param client
   * @param markupPercentage
   * @private
   * @example
   */
  async applyServicesPricing(client, markupPercentage) {
    const stats = {
      created: 0,
      updated: 0,
      errors: [],
    };

    try {
      // Step 1: Load all data in parallel (much faster)
      const [services, rates, vehicleTypes] = await Promise.all([
        // Get all Services
        (async () => {
          const ServicesClass = Parse.Object.extend('Services');
          const query = new Parse.Query(ServicesClass);
          query.equalTo('exists', true);
          query.equalTo('active', true);
          query.limit(10000);
          return query.find({ useMasterKey: true });
        })(),

        // Get all Rates
        (async () => {
          const RateClass = Parse.Object.extend('Rate');
          const query = new Parse.Query(RateClass);
          query.equalTo('exists', true);
          query.equalTo('active', true);
          return query.find({ useMasterKey: true });
        })(),

        // Get all VehicleTypes
        (async () => {
          const VehicleTypeClass = Parse.Object.extend('VehicleType');
          const query = new Parse.Query(VehicleTypeClass);
          query.equalTo('exists', true);
          query.equalTo('active', true);
          return query.find({ useMasterKey: true });
        })(),
      ]);
      // Early exit if no basic data
      if (services.length === 0) {
        return stats;
      }
      if (rates.length === 0) {
        return stats;
      }
      if (vehicleTypes.length === 0) {
        return stats;
      }

      // Step 2: Load ALL RatePrices at once (instead of individual queries)
      const RatePricesClass = Parse.Object.extend('RatePrices');
      const ratePricesQuery = new Parse.Query(RatePricesClass);
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.equalTo('active', true);
      ratePricesQuery.doesNotExist('valid_until');
      ratePricesQuery.limit(50000); // High limit to get all
      const allRatePrices = await ratePricesQuery.find({ useMasterKey: true });
      if (allRatePrices.length === 0) {
        return stats;
      }

      // Step 3: Create lookup map for fast access
      const ratePricesMap = new Map();
      for (const ratePrice of allRatePrices) {
        const key = `${ratePrice.get('service')?.id}-${ratePrice.get('rate')?.id}-${ratePrice.get('vehicleType')?.id}`;
        ratePricesMap.set(key, {
          price: ratePrice.get('price'),
          object: ratePrice,
        });
      }
      // Step 4: Load existing ClientPrices for this client
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const existingQuery = new Parse.Query(ClientPricesClass);
      existingQuery.equalTo('clientPtr', client);
      existingQuery.equalTo('itemType', 'SERVICES');
      existingQuery.equalTo('exists', true);
      existingQuery.doesNotExist('valid_until');
      existingQuery.limit(50000);
      const existingPrices = await existingQuery.find({ useMasterKey: true });
      // Step 5: Create lookup map for existing prices
      const existingPricesMap = new Map();
      for (const existing of existingPrices) {
        const key = `${existing.get('itemId')}-${existing.get('ratePtr')?.id}-${existing.get('vehiclePtr')?.id}`;
        existingPricesMap.set(key, existing);
      }
      // Step 6: Process combinations efficiently
      // const totalCombinations = services.length * rates.length * vehicleTypes.length;

      const toUpdate = [];
      const toCreate = [];
      let processedCount = 0;
      // let skippedNoBasePrice = 0;
      // const skippedSamePrice = 0;

      for (const service of services) {
        for (const rate of rates) {
          for (const vehicleType of vehicleTypes) {
            processedCount += 1;

            // Progress logging every 1000 combinations
            if (processedCount % 1000 === 0) {
              // Progress logging placeholder
            }

            try {
              // Look up base price (O(1) instead of database query)
              const ratePriceKey = `${service.id}-${rate.id}-${vehicleType.id}`;
              const ratePriceData = ratePricesMap.get(ratePriceKey);

              if (!ratePriceData) {
                // skippedNoBasePrice += 1; // Track skipped items
                // eslint-disable-next-line no-continue
                // eslint-disable-next-line no-continue
                continue; // No base price, skip
              }

              const basePrice = ratePriceData.price;
              const markedUpPrice = Math.round(basePrice * (1 + markupPercentage / 100));

              // Look up existing price (O(1) instead of database query)
              const existingKey = `${service.id}-${rate.id}-${vehicleType.id}`;
              const existing = existingPricesMap.get(existingKey);

              if (existing) {
                // ALWAYS version the old price and create new one for complete audit trail
                const today = new Date();
                today.setHours(23, 59, 59, 999);
                existing.set('valid_until', today);
                existing.set('active', false);
                toUpdate.push(existing);

                // ALWAYS create new price entry (even if price is the same)
                const newPrice = new ClientPricesClass();
                newPrice.set('clientPtr', client);
                newPrice.set('itemType', 'SERVICES');
                newPrice.set('itemId', service.id);
                newPrice.set('ratePtr', rate);
                newPrice.set('vehiclePtr', vehicleType);
                newPrice.set('precio', markedUpPrice);
                newPrice.set('basePrice', basePrice);
                newPrice.set('currency', 'MXN');
                newPrice.set('active', true);
                newPrice.set('exists', true);
                newPrice.set('createdBy', 'bulk_pricing_ui');
                newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);
                toCreate.push(newPrice);

                stats.updated += 1;
              } else {
                // Create new price
                const newPrice = new ClientPricesClass();
                newPrice.set('clientPtr', client);
                newPrice.set('itemType', 'SERVICES');
                newPrice.set('itemId', service.id);
                newPrice.set('ratePtr', rate);
                newPrice.set('vehiclePtr', vehicleType);
                newPrice.set('precio', markedUpPrice);
                newPrice.set('basePrice', basePrice);
                newPrice.set('currency', 'MXN');
                newPrice.set('active', true);
                newPrice.set('exists', true);
                newPrice.set('createdBy', 'bulk_pricing_ui');
                newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);
                toCreate.push(newPrice);

                stats.created += 1;
              }
            } catch (error) {
              stats.errors.push(`Service ${service.id}: ${error.message}`);
            }
          }
        }
      }

      // Step 7: Batch save operations
      // Batch update existing prices
      if (toUpdate.length > 0) {
        await Parse.Object.saveAll(toUpdate, { useMasterKey: true });
      }

      // Batch create new prices (in chunks to avoid memory issues)
      if (toCreate.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < toCreate.length; i += chunkSize) {
          const chunk = toCreate.slice(i, i + chunkSize);
          await Parse.Object.saveAll(chunk, { useMasterKey: true });
        }
      }
    } catch (error) {
      stats.errors.push(`Services processing: ${error.message}`);
    }

    return stats;
  }

  /**
   * Apply pricing to services for a client with progress updates.
   * @param client
   * @param markupPercentage
   * @param sendProgress
   * @private
   * @example
   */
  async applyServicesPricingWithProgress(client, markupPercentage, sendProgress) {
    const stats = {
      created: 0,
      updated: 0,
      errors: [],
    };

    try {
      // Get all Services
      sendProgress({ message: 'Cargando servicios...', type: 'status' });
      const ServicesClass = Parse.Object.extend('Services');
      const servicesQuery = new Parse.Query(ServicesClass);
      servicesQuery.equalTo('exists', true);
      servicesQuery.equalTo('active', true);
      servicesQuery.limit(10000);
      const services = await servicesQuery.find({ useMasterKey: true });

      sendProgress({ message: `Encontrados ${services.length} servicios`, type: 'status' });

      // Get all Rates
      sendProgress({ message: 'Cargando tarifas...', type: 'status' });
      const RateClass = Parse.Object.extend('Rate');
      const ratesQuery = new Parse.Query(RateClass);
      ratesQuery.equalTo('exists', true);
      ratesQuery.equalTo('active', true);
      const rates = await ratesQuery.find({ useMasterKey: true });

      sendProgress({ message: `Encontradas ${rates.length} tarifas`, type: 'status' });

      // Get all VehicleTypes
      sendProgress({ message: 'Cargando tipos de vehículo...', type: 'status' });
      const VehicleTypeClass = Parse.Object.extend('VehicleType');
      const vehiclesQuery = new Parse.Query(VehicleTypeClass);
      vehiclesQuery.equalTo('exists', true);
      vehiclesQuery.equalTo('active', true);
      const vehicleTypes = await vehiclesQuery.find({ useMasterKey: true });

      sendProgress({ message: `Encontrados ${vehicleTypes.length} tipos de vehículo`, type: 'status' });

      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const RatePricesClass = Parse.Object.extend('RatePrices');

      const totalCombinations = services.length * rates.length * vehicleTypes.length;
      sendProgress({
        message: `Procesando ${totalCombinations} combinaciones de servicios...`,
        type: 'status',
      });

      // Process all combinations
      let processedCount = 0;

      for (const service of services) {
        for (const rate of rates) {
          for (const vehicleType of vehicleTypes) {
            processedCount += 1;

            // Send progress every 100 combinations
            if (processedCount % 100 === 0) {
              const progressPercent = Math.round((processedCount / totalCombinations) * 40); // Services get 40% of total progress
              sendProgress({
                message: `Procesando servicios: ${processedCount}/${totalCombinations} (${Math.round((processedCount / totalCombinations) * 100)}%)`,
                type: 'status',
                progress: progressPercent,
              });
            }

            try {
              // Get base price from RatePrices
              const basePriceQuery = new Parse.Query(RatePricesClass);
              basePriceQuery.equalTo('service', service);
              basePriceQuery.equalTo('rate', rate);
              basePriceQuery.equalTo('vehicleType', vehicleType);
              basePriceQuery.equalTo('exists', true);
              basePriceQuery.equalTo('active', true);
              basePriceQuery.doesNotExist('valid_until');

              const ratePrice = await basePriceQuery.first({ useMasterKey: true });

              if (!ratePrice) {
                // eslint-disable-next-line no-continue
                continue; // No base price, skip
              }

              const basePrice = ratePrice.get('price');
              const markedUpPrice = Math.round(basePrice * (1 + markupPercentage / 100));

              // Check if ClientPrice already exists
              const existingQuery = new Parse.Query(ClientPricesClass);
              existingQuery.equalTo('clientPtr', client);
              existingQuery.equalTo('itemType', 'SERVICES');
              existingQuery.equalTo('itemId', service.id);
              existingQuery.equalTo('ratePtr', rate);
              existingQuery.equalTo('vehiclePtr', vehicleType);
              existingQuery.equalTo('exists', true);
              existingQuery.doesNotExist('valid_until');

              const existing = await existingQuery.first({ useMasterKey: true });

              if (existing && existing.get('precio') !== markedUpPrice) {
                // Version the existing price
                const today = new Date();
                today.setHours(23, 59, 59, 999);
                existing.set('valid_until', today);
                existing.set('active', false);
                await existing.save(null, { useMasterKey: true });
                stats.updated += 1;
              } else if (existing) {
                // eslint-disable-next-line no-continue
                continue; // Same price, skip
              }

              // Create new price
              const newPrice = new ClientPricesClass();
              newPrice.set('clientPtr', client);
              newPrice.set('itemType', 'SERVICES');
              newPrice.set('itemId', service.id);
              newPrice.set('ratePtr', rate);
              newPrice.set('vehiclePtr', vehicleType);
              newPrice.set('precio', markedUpPrice);
              newPrice.set('basePrice', basePrice);
              newPrice.set('currency', 'MXN');
              newPrice.set('active', true);
              newPrice.set('exists', true);
              newPrice.set('createdBy', 'bulk_pricing_ui');
              newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);

              await newPrice.save(null, { useMasterKey: true });
              if (!existing) stats.created += 1;
            } catch (error) {
              stats.errors.push(`Service ${service.id}: ${error.message}`);
            }
          }
        }
      }

      sendProgress({
        message: `Servicios completados: ${stats.created} creados, ${stats.updated} actualizados`,
        type: 'status',
      });
    } catch (error) {
      stats.errors.push(`Services processing: ${error.message}`);
      sendProgress({
        error: `Error procesando servicios: ${error.message}`,
        type: 'error',
      });
    }

    return stats;
  }

  /**
   * Apply pricing to tours for a client (OPTIMIZED VERSION).
   * @param client
   * @param markupPercentage
   * @private
   * @example
   */
  async applyToursPricing(client, markupPercentage) {
    const stats = {
      created: 0,
      updated: 0,
      errors: [],
    };

    try {
      // Step 1: Load TourPrices and existing ClientPrices in parallel
      const [tourPrices, existingPrices] = await Promise.all([
        // Get all TourPrices with their relationships
        (async () => {
          const TourPricesClass = Parse.Object.extend('TourPrices');
          const query = new Parse.Query(TourPricesClass);
          query.equalTo('exists', true);
          query.equalTo('active', true);
          query.doesNotExist('valid_until');
          query.include(['tourPtr', 'ratePtr', 'vehicleType']);
          query.limit(10000);
          return query.find({ useMasterKey: true });
        })(),

        // Get existing ClientPrices for tours
        (async () => {
          const ClientPricesClass = Parse.Object.extend('ClientPrices');
          const query = new Parse.Query(ClientPricesClass);
          query.equalTo('clientPtr', client);
          query.equalTo('itemType', 'TOUR');
          query.equalTo('exists', true);
          query.doesNotExist('valid_until');
          query.limit(50000);
          return query.find({ useMasterKey: true });
        })(),
      ]);

      // Step 2: Create lookup map for existing prices
      const existingPricesMap = new Map();
      for (const existing of existingPrices) {
        const key = `${existing.get('itemId')}-${existing.get('ratePtr')?.id}-${existing.get('vehiclePtr')?.id}`;
        existingPricesMap.set(key, existing);
      }
      // Step 3: Process tours efficiently
      const ClientPricesClass = Parse.Object.extend('ClientPrices');
      const toUpdate = [];
      const toCreate = [];
      let processedCount = 0;

      for (const tourPrice of tourPrices) {
        processedCount += 1;

        // Progress logging every 100 tours
        if (processedCount % 100 === 0) {
          // Progress logging placeholder
        }

        try {
          const tour = tourPrice.get('tourPtr');
          const rate = tourPrice.get('ratePtr');
          const vehicleType = tourPrice.get('vehicleType');

          if (!tour || !rate || !vehicleType) {
            // eslint-disable-next-line no-continue
            continue; // Missing required pointers
          }

          const basePrice = tourPrice.get('price');
          if (!basePrice || basePrice <= 0) {
            // eslint-disable-next-line no-continue
            continue; // Invalid base price
          }

          const markedUpPrice = Math.round(basePrice * (1 + markupPercentage / 100));

          // Look up existing price (O(1) instead of database query)
          const existingKey = `${tour.id}-${rate.id}-${vehicleType.id}`;
          const existing = existingPricesMap.get(existingKey);

          if (existing) {
            // ALWAYS version the old price and create new one for complete audit trail
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            existing.set('valid_until', today);
            existing.set('active', false);
            toUpdate.push(existing);

            // ALWAYS create new price entry (even if price is the same)
            const newPrice = new ClientPricesClass();
            newPrice.set('clientPtr', client);
            newPrice.set('itemType', 'TOUR'); // Singular for tours
            newPrice.set('itemId', tour.id);
            newPrice.set('ratePtr', rate);
            newPrice.set('vehiclePtr', vehicleType);
            newPrice.set('precio', markedUpPrice);
            newPrice.set('basePrice', basePrice);
            newPrice.set('currency', tourPrice.get('currency') || 'MXN');
            newPrice.set('active', true);
            newPrice.set('exists', true);
            newPrice.set('createdBy', 'bulk_pricing_ui');
            newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);
            toCreate.push(newPrice);

            stats.updated += 1;
          } else {
            // Create new price
            const newPrice = new ClientPricesClass();
            newPrice.set('clientPtr', client);
            newPrice.set('itemType', 'TOUR'); // Singular for tours
            newPrice.set('itemId', tour.id);
            newPrice.set('ratePtr', rate);
            newPrice.set('vehiclePtr', vehicleType);
            newPrice.set('precio', markedUpPrice);
            newPrice.set('basePrice', basePrice);
            newPrice.set('currency', tourPrice.get('currency') || 'MXN');
            newPrice.set('active', true);
            newPrice.set('exists', true);
            newPrice.set('createdBy', 'bulk_pricing_ui');
            newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);
            toCreate.push(newPrice);

            stats.created += 1;
          }
        } catch (error) {
          stats.errors.push(`Tour ${tourPrice.id}: ${error.message}`);
        }
      }

      // Step 4: Batch save operations
      // Batch update existing prices
      if (toUpdate.length > 0) {
        await Parse.Object.saveAll(toUpdate, { useMasterKey: true });
      }

      // Batch create new prices (in chunks)
      if (toCreate.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < toCreate.length; i += chunkSize) {
          const chunk = toCreate.slice(i, i + chunkSize);
          await Parse.Object.saveAll(chunk, { useMasterKey: true });
          console.log(`💾 Saved tour chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(toCreate.length / chunkSize)} (${chunk.length} items)`);
        }
      }
    } catch (error) {
      stats.errors.push(`Tours processing: ${error.message}`);
    }

    return stats;
  }

  /**
   * Apply pricing to tours for a client with progress updates.
   * @param client
   * @param markupPercentage
   * @param sendProgress
   * @private
   * @example
   */
  async applyToursPricingWithProgress(client, markupPercentage, sendProgress) {
    const stats = {
      created: 0,
      updated: 0,
      errors: [],
    };

    try {
      // Get all TourPrices with their relationships
      sendProgress({ message: 'Cargando precios de tours...', type: 'status' });
      const TourPricesClass = Parse.Object.extend('TourPrices');
      const tourPricesQuery = new Parse.Query(TourPricesClass);
      tourPricesQuery.equalTo('exists', true);
      tourPricesQuery.equalTo('active', true);
      tourPricesQuery.doesNotExist('valid_until');
      tourPricesQuery.include(['tourPtr', 'ratePtr', 'vehicleType']);
      tourPricesQuery.limit(10000);
      const tourPrices = await tourPricesQuery.find({ useMasterKey: true });

      sendProgress({ message: `Encontrados ${tourPrices.length} precios de tours`, type: 'status' });

      const ClientPricesClass = Parse.Object.extend('ClientPrices');

      // Process all tour prices
      let tourIndex = 0;
      for (const tourPrice of tourPrices) {
        tourIndex += 1;

        // Send progress every 25 tours
        if (tourIndex % 25 === 0) {
          const progressPercent = 40 + Math.round((tourIndex / tourPrices.length) * 60); // Tours get remaining 60% of progress
          sendProgress({
            message: `Procesando tours: ${tourIndex}/${tourPrices.length} (${Math.round((tourIndex / tourPrices.length) * 100)}%)`,
            type: 'status',
            progress: progressPercent,
          });
        }

        try {
          const tour = tourPrice.get('tourPtr');
          const rate = tourPrice.get('ratePtr');
          const vehicleType = tourPrice.get('vehicleType');

          if (!tour || !rate || !vehicleType) {
            // eslint-disable-next-line no-continue
            continue; // Missing required pointers
          }

          const basePrice = tourPrice.get('price');
          if (!basePrice || basePrice <= 0) {
            // eslint-disable-next-line no-continue
            continue; // Invalid base price
          }

          const markedUpPrice = Math.round(basePrice * (1 + markupPercentage / 100));

          // Check if ClientPrice already exists
          const existingQuery = new Parse.Query(ClientPricesClass);
          existingQuery.equalTo('clientPtr', client);
          existingQuery.equalTo('itemType', 'TOUR'); // Note: singular for tours
          existingQuery.equalTo('itemId', tour.id);
          existingQuery.equalTo('ratePtr', rate);
          existingQuery.equalTo('vehiclePtr', vehicleType);
          existingQuery.equalTo('exists', true);
          existingQuery.doesNotExist('valid_until');

          const existing = await existingQuery.first({ useMasterKey: true });

          if (existing) {
            // ALWAYS version the old price and create new one for complete audit trail
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            existing.set('valid_until', today);
            existing.set('active', false);
            await existing.save(null, { useMasterKey: true });

            // ALWAYS create new price entry (even if price is the same)
            const newPrice = new ClientPricesClass();
            newPrice.set('clientPtr', client);
            newPrice.set('itemType', 'TOUR'); // Singular for tours
            newPrice.set('itemId', tour.id);
            newPrice.set('ratePtr', rate);
            newPrice.set('vehiclePtr', vehicleType);
            newPrice.set('precio', markedUpPrice);
            newPrice.set('basePrice', basePrice);
            newPrice.set('currency', tourPrice.get('currency') || 'MXN');
            newPrice.set('active', true);
            newPrice.set('exists', true);
            newPrice.set('createdBy', 'bulk_pricing_ui');
            newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);

            await newPrice.save(null, { useMasterKey: true });
            stats.updated += 1;
          } else {
            // Create new price
            const newPrice = new ClientPricesClass();
            newPrice.set('clientPtr', client);
            newPrice.set('itemType', 'TOUR'); // Singular for tours
            newPrice.set('itemId', tour.id);
            newPrice.set('ratePtr', rate);
            newPrice.set('vehiclePtr', vehicleType);
            newPrice.set('precio', markedUpPrice);
            newPrice.set('basePrice', basePrice);
            newPrice.set('currency', tourPrice.get('currency') || 'MXN');
            newPrice.set('active', true);
            newPrice.set('exists', true);
            newPrice.set('createdBy', 'bulk_pricing_ui');
            newPrice.set('notes', `Applied ${markupPercentage}% markup via admin UI`);

            await newPrice.save(null, { useMasterKey: true });
            stats.created += 1;
          }
        } catch (error) {
          stats.errors.push(`Tour ${tourPrice.id}: ${error.message}`);
        }
      }

      sendProgress({
        message: `Tours completados: ${stats.created} creados, ${stats.updated} actualizados`,
        type: 'status',
      });
    } catch (error) {
      stats.errors.push(`Tours processing: ${error.message}`);
      sendProgress({
        error: `Error procesando tours: ${error.message}`,
        type: 'error',
      });
    }

    return stats;
  }

  /**
   * Start background bulk pricing process.
   * @param processId
   * @param params
   * @private
   * @example
   */
  async startBulkPricingProcess(processId, params) {
    const {
      clientId, applyToServices, applyToTours, markupPercentage, currentUser,
    } = params;

    /**
     * Update progress state and send real-time updates via SSE.
     * @param {object} data - Progress data object containing status, percentage, message, etc.
     * @example
     * updateProgress({ progress: 75, message: 'Processing services...', phase: 'services' });
     */
    const updateProgress = (data) => {
      // Update process state
      const currentState = this.activeProcesses.get(processId);
      if (currentState) {
        this.activeProcesses.set(processId, {
          ...currentState,
          ...data,
        });
      }

      // Send SSE update if connection exists
      const connection = this.sseConnections.get(processId);
      if (connection) {
        connection.sendSSE(data);
      }
    };

    try {
      updateProgress({
        message: 'Cargando información del cliente...',
        type: 'status',
        progress: 5,
      });

      // Get the client
      const AmexingUserClass = Parse.Object.extend('AmexingUser');
      const clientQuery = new Parse.Query(AmexingUserClass);
      clientQuery.equalTo('objectId', clientId);
      const client = await clientQuery.first({ useMasterKey: true });

      if (!client) {
        updateProgress({
          error: 'Client not found',
          type: 'error',
        });
        return;
      }

      const results = {
        servicesCreated: 0,
        servicesUpdated: 0,
        toursCreated: 0,
        toursUpdated: 0,
        errors: [],
      };

      let totalProgress = 10; // Starting at 10%
      const totalSteps = (applyToServices ? 1 : 0) + (applyToTours ? 1 : 0);
      let currentStep = 0;

      // Apply to services if selected
      if (applyToServices) {
        currentStep += 1;
        updateProgress({
          message: `Procesando servicios... (${currentStep}/${totalSteps})`,
          type: 'status',
          progress: totalProgress,
        });

        const serviceResults = await this.applyServicesPricingWithProgress(client, markupPercentage, updateProgress);
        results.servicesCreated = serviceResults.created;
        results.servicesUpdated = serviceResults.updated;
        if (serviceResults.errors.length > 0) {
          results.errors.push(...serviceResults.errors);
        }

        totalProgress = totalSteps === 1 ? 90 : 45; // 90% if only services, 45% if both
      }

      // Apply to tours if selected
      if (applyToTours) {
        currentStep += 1;
        updateProgress({
          message: `Procesando tours... (${currentStep}/${totalSteps})`,
          type: 'status',
          progress: totalProgress,
        });

        const tourResults = await this.applyToursPricingWithProgress(client, markupPercentage, updateProgress);
        results.toursCreated = tourResults.created;
        results.toursUpdated = tourResults.updated;
        if (tourResults.errors.length > 0) {
          results.errors.push(...tourResults.errors);
        }

        totalProgress = 90;
      }

      updateProgress({
        message: 'Finalizando proceso...',
        type: 'status',
        progress: 95,
      });

      // Log success
      logger.info(`Bulk pricing completed for client ${clientId}`, {
        user: currentUser.get('email'),
        results,
      });

      // Send completion
      updateProgress({
        message: 'Proceso completado exitosamente',
        type: 'success',
        progress: 100,
        results: {
          servicesCreated: results.servicesCreated,
          servicesUpdated: results.servicesUpdated,
          toursCreated: results.toursCreated,
          toursUpdated: results.toursUpdated,
          totalCreated: results.servicesCreated + results.toursCreated,
          totalUpdated: results.servicesUpdated + results.toursUpdated,
          errors: results.errors,
        },
      });

      // Clean up after 30 seconds
      setTimeout(() => {
        this.activeProcesses.delete(processId);
        this.sseConnections.delete(processId);
      }, 30000);
    } catch (error) {
      logger.error('Error in background bulk pricing process:', error);
      updateProgress({
        error: `Error applying bulk pricing: ${error.message}`,
        type: 'error',
      });

      // Clean up after error
      setTimeout(() => {
        this.activeProcesses.delete(processId);
        this.sseConnections.delete(processId);
      }, 30000);
    }
  }
}

module.exports = ClientPricesController;
