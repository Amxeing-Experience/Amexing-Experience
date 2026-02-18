/**
 * DisposablePricesController - API Controller for Disposable Prices (A Disposición).
 *
 * Handles HTTP requests for disposable pricing data.
 * Provides endpoints for retrieving hourly rental prices.
 * @author Created by Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-17
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const DisposablePrices = require('../../../domain/models/DisposablePrices');

/**
 * DisposablePricesController class.
 */
class DisposablePricesController {
  /**
   * Get all current disposable prices
   * GET /api/disposable-prices.
   * @param req
   * @param res
   * @example
   */
  async getCurrentPrices(req, res) {
    try {
      logger.info('Getting current disposable prices');

      // Get current prices using the domain model
      const disposablePrices = await DisposablePrices.getCurrentPrices();

      // Format response data
      const formattedPrices = disposablePrices.map((price) => {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');

        return {
          id: price.id,
          vehicleType: {
            id: vehicleType.id,
            name: vehicleType.get('name'),
            code: vehicleType.get('code'),
            capacity: vehicleType.get('capacity') || vehicleType.get('defaultCapacity'),
            description: vehicleType.get('description'),
          },
          rate: {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color'),
          },
          hourlyPrice: price.get('hourlyPrice'),
          currency: price.get('currency'),
          formattedPrice: `${price.get('currency') || 'MXN'} $${price.get('hourlyPrice')}`,
          effectiveDate: price.get('effectiveDate'),
          isCurrentlyEffective: !price.get('endDate') || price.get('endDate') > new Date(),
        };
      });

      logger.info(`Retrieved ${formattedPrices.length} disposable prices`);

      res.json({
        success: true,
        data: formattedPrices,
        total: formattedPrices.length,
      });
    } catch (error) {
      logger.error('Error getting current disposable prices', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve disposable prices',
        message: error.message,
      });
    }
  }

  /**
   * Get disposable price by vehicle type
   * GET /api/disposable-prices/vehicle/:vehicleTypeId.
   * @param req
   * @param res
   * @example
   */
  async getPriceByVehicleType(req, res) {
    try {
      const { vehicleTypeId } = req.params;

      if (!vehicleTypeId) {
        return res.status(400).json({
          success: false,
          error: 'Vehicle type ID is required',
        });
      }

      logger.info('Getting disposable price by vehicle type', { vehicleTypeId });

      const disposablePrice = await DisposablePrices.getPriceByVehicleType(vehicleTypeId);

      if (!disposablePrice) {
        return res.status(404).json({
          success: false,
          error: 'No disposable price found for this vehicle type',
        });
      }

      // Format response data
      const vehicleType = disposablePrice.get('vehicleType');
      const rate = disposablePrice.get('rate');

      const formattedPrice = {
        id: disposablePrice.id,
        vehicleType: {
          id: vehicleType.id,
          name: vehicleType.get('name'),
          code: vehicleType.get('code'),
          capacity: vehicleType.get('capacity') || vehicleType.get('defaultCapacity'),
          description: vehicleType.get('description'),
        },
        rate: {
          id: rate.id,
          name: rate.get('name'),
          color: rate.get('color'),
        },
        hourlyPrice: disposablePrice.get('hourlyPrice'),
        currency: disposablePrice.get('currency'),
        formattedPrice: `${disposablePrice.get('currency') || 'MXN'} $${disposablePrice.get('hourlyPrice')}`,
        effectiveDate: disposablePrice.get('effectiveDate'),
        isCurrentlyEffective: !disposablePrice.get('endDate') || disposablePrice.get('endDate') > new Date(),
      };

      res.json({
        success: true,
        data: formattedPrice,
      });
    } catch (error) {
      logger.error('Error getting disposable price by vehicle type', {
        vehicleTypeId: req.params.vehicleTypeId,
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve disposable price',
        message: error.message,
      });
    }
  }

  /**
   * Get disposable prices grouped by vehicle type for easy lookup
   * GET /api/disposable-prices/by-vehicle-type.
   * @param req
   * @param res
   * @example
   */
  async getPricesByVehicleType(req, res) {
    try {
      logger.info('Getting disposable prices grouped by vehicle type');

      const disposablePrices = await DisposablePrices.getCurrentPrices();

      // Group by vehicle type for easy frontend consumption
      const pricesByVehicleType = {};

      disposablePrices.forEach((price) => {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');
        if (vehicleType) {
          const vehicleTypeId = vehicleType.id;

          if (!pricesByVehicleType[vehicleTypeId]) {
            pricesByVehicleType[vehicleTypeId] = {
              vehicleType: {
                id: vehicleType.id,
                name: vehicleType.get('name'),
                code: vehicleType.get('code'),
                capacity: vehicleType.get('capacity') || vehicleType.get('defaultCapacity'),
                description: vehicleType.get('description'),
              },
              prices: [],
            };
          }

          pricesByVehicleType[vehicleTypeId].prices.push({
            id: price.id,
            rate: {
              id: rate.id,
              name: rate.get('name'),
              color: rate.get('color'),
            },
            hourlyPrice: price.get('hourlyPrice'),
            currency: price.get('currency'),
            formattedPrice: `${price.get('currency') || 'MXN'} $${price.get('hourlyPrice')}`,
            effectiveDate: price.get('effectiveDate'),
            isCurrentlyEffective: !price.get('endDate') || price.get('endDate') > new Date(),
          });
        }
      });

      logger.info(`Grouped prices for ${Object.keys(pricesByVehicleType).length} vehicle types`);

      res.json({
        success: true,
        data: pricesByVehicleType,
        total: disposablePrices.length,
      });
    } catch (error) {
      logger.error('Error getting disposable prices by vehicle type', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve disposable prices by vehicle type',
        message: error.message,
      });
    }
  }

  /**
   * Get available vehicles for specific rate
   * GET /api/disposable-prices/vehicles-for-rate.
   * @param req
   * @param res
   * @example
   */
  async getVehiclesForRate(req, res) {
    try {
      const { rateId } = req.query;

      if (!rateId) {
        return res.status(400).json({
          success: false,
          error: 'Rate ID is required',
        });
      }

      // Query disposable prices to find available vehicles for this rate
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include('vehicleType');

      const prices = await query.find({ useMasterKey: true });

      // Extract unique vehicles
      const vehiclesMap = new Map();
      prices.forEach((price) => {
        const vehicleType = price.get('vehicleType');
        if (vehicleType && !vehiclesMap.has(vehicleType.id)) {
          vehiclesMap.set(vehicleType.id, {
            value: vehicleType.id,
            label: vehicleType.get('name'),
            capacity: vehicleType.get('defaultCapacity') || 4,
            trunkCapacity: vehicleType.get('trunkCapacity') || 2,
          });
        }
      });

      const availableVehicles = Array.from(vehiclesMap.values());

      res.json({
        success: true,
        data: availableVehicles,
        total: availableVehicles.length,
      });
    } catch (error) {
      logger.error('Error getting vehicles for rate', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve vehicles for rate',
        message: error.message,
      });
    }
  }

  /**
   * Get available rates for specific vehicle type
   * GET /api/disposable-prices/rates-for-vehicle.
   * @param req
   * @param res
   * @example
   */
  async getRatesForVehicle(req, res) {
    try {
      const { vehicleTypeId } = req.query;

      if (!vehicleTypeId) {
        return res.status(400).json({
          success: false,
          error: 'Vehicle type ID is required',
        });
      }

      // Query disposable prices to find available rates for this vehicle
      const query = new Parse.Query('DisposablePrices');
      query.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include('rate');

      const prices = await query.find({ useMasterKey: true });

      // Extract unique rates
      const ratesMap = new Map();
      prices.forEach((price) => {
        const rate = price.get('rate');
        if (rate && !ratesMap.has(rate.id)) {
          ratesMap.set(rate.id, {
            value: rate.id,
            label: rate.get('name'),
            percentage: rate.get('percentage'),
          });
        }
      });

      const availableRates = Array.from(ratesMap.values());

      res.json({
        success: true,
        data: availableRates,
        total: availableRates.length,
      });
    } catch (error) {
      logger.error('Error getting rates for vehicle type', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve rates for vehicle',
        message: error.message,
      });
    }
  }

  /**
   * Get price for specific vehicle type and rate
   * GET /api/disposable-prices/price.
   * @param req
   * @param res
   * @example
   */
  async getPriceByVehicleTypeAndRate(req, res) {
    try {
      const { vehicleTypeId, rateId } = req.query;

      if (!vehicleTypeId || !rateId) {
        return res.status(400).json({
          success: false,
          error: 'Vehicle type and rate are required',
        });
      }

      const query = new Parse.Query('DisposablePrices');
      query.equalTo('vehicleType', {
        __type: 'Pointer',
        className: 'VehicleType',
        objectId: vehicleTypeId,
      });
      query.equalTo('rate', {
        __type: 'Pointer',
        className: 'Rate',
        objectId: rateId,
      });
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include(['vehicleType', 'rate']);

      const price = await query.first({ useMasterKey: true });

      if (!price) {
        // Return default price if no specific price found
        return res.json({
          success: true,
          data: {
            hourlyPrice: 500,
            currency: 'MXN',
            isDefault: true,
          },
        });
      }

      res.json({
        success: true,
        data: {
          id: price.id,
          hourlyPrice: price.get('hourlyPrice'),
          currency: price.get('currency') || 'MXN',
          vehicleType: price.get('vehicleType')?.get('name'),
          rate: price.get('rate')?.get('name'),
          isDefault: false,
        },
      });
    } catch (error) {
      logger.error('Error getting price by vehicle type and rate', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve price',
        message: error.message,
      });
    }
  }

  /**
   * Batch update disposable prices
   * PUT /api/disposable-prices/batch-update.
   * @param req
   * @param res
   * @example
   */
  async batchUpdatePrices(req, res) {
    try {
      const { updates } = req.body;

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No price updates provided',
        });
      }

      logger.info('Batch updating disposable prices', { count: updates.length });

      const updatedPrices = [];
      const errors = [];

      // Process each update
      for (const update of updates) {
        try {
          const { id, hourlyPrice } = update;

          if (!id || hourlyPrice === undefined || hourlyPrice === null) {
            errors.push({ id, error: 'Invalid update data' });
            // eslint-disable-next-line no-continue
            continue;
          }

          // Validate price is a positive number
          const price = parseFloat(hourlyPrice);
          if (Number.isNaN(price) || price < 0) {
            errors.push({ id, error: 'Invalid price value' });
            // eslint-disable-next-line no-continue
            continue;
          }

          // Update the price using the domain model
          const updatedPrice = await DisposablePrices.updatePriceById(id, { hourlyPrice: price });

          if (updatedPrice) {
            updatedPrices.push({
              id: updatedPrice.id,
              hourlyPrice: updatedPrice.get('hourlyPrice'),
              vehicleType: updatedPrice.get('vehicleType').get('name'),
              rate: updatedPrice.get('rate').get('name'),
            });
          } else {
            errors.push({ id, error: 'Price not found or update failed' });
          }
        } catch (error) {
          logger.error('Error updating individual price', {
            id: update.id,
            error: error.message,
          });
          errors.push({ id: update.id, error: error.message });
        }
      }

      const response = {
        success: updatedPrices.length > 0,
        data: {
          updated: updatedPrices,
          errors,
        },
        message: `Updated ${updatedPrices.length} prices successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
      };

      logger.info('Batch update completed', {
        updated: updatedPrices.length,
        failed: errors.length,
      });

      res.json(response);
    } catch (error) {
      logger.error('Error in batch update disposable prices', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update prices',
        message: error.message,
      });
    }
  }

  /**
   * Get price history for a specific vehicle type
   * GET /api/disposable-prices/history/:vehicleTypeId.
   * @param req
   * @param res
   * @example
   */
  async getPriceHistory(req, res) {
    try {
      const { vehicleTypeId } = req.params;

      if (!vehicleTypeId) {
        return res.status(400).json({
          success: false,
          error: 'Vehicle type ID is required',
        });
      }

      logger.info('Getting disposable price history', { vehicleTypeId });

      const priceHistory = await DisposablePrices.getPriceHistoryByVehicleType(vehicleTypeId);

      // Format response data
      const formattedHistory = priceHistory.map((price) => {
        const vehicleType = price.get('vehicleType');
        const rate = price.get('rate');

        return {
          id: price.id,
          vehicleType: {
            id: vehicleType.id,
            name: vehicleType.get('name'),
            code: vehicleType.get('code'),
          },
          rate: {
            id: rate.id,
            name: rate.get('name'),
            color: rate.get('color'),
          },
          hourlyPrice: price.get('hourlyPrice'),
          currency: price.get('currency'),
          formattedPrice: `${price.get('currency') || 'MXN'} $${price.get('hourlyPrice')}`,
          effectiveDate: price.get('effectiveDate'),
          endDate: price.get('endDate'),
          isCurrentlyEffective: !price.get('endDate') || price.get('endDate') > new Date(),
          active: price.get('active'),
          exists: price.get('exists'),
        };
      });

      logger.info(`Retrieved ${formattedHistory.length} price history records`);

      res.json({
        success: true,
        data: formattedHistory,
        total: formattedHistory.length,
      });
    } catch (error) {
      logger.error('Error getting disposable price history', {
        vehicleTypeId: req.params.vehicleTypeId,
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve price history',
        message: error.message,
      });
    }
  }
}

module.exports = new DisposablePricesController();
