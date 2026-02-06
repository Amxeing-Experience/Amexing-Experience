/**
 * Vehicle Rate Prices API Controller.
 *
 * Handles API endpoints for vehicle rate pricing management.
 * Provides CRUD operations with history tracking.
 *
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const VehicleRatePrices = require('../../../domain/models/VehicleRatePrices');

/**
 * Get current price for a specific rate and vehicle type.
 * @param req
 * @param res
 * @example
 */
const getCurrentPrice = async (req, res) => {
  try {
    const { rateId, vehicleTypeId } = req.query;

    if (!rateId || !vehicleTypeId) {
      return res.status(400).json({
        success: false,
        error: 'Both rateId and vehicleTypeId are required',
      });
    }

    const price = await VehicleRatePrices.getCurrentPrice(rateId, vehicleTypeId);

    if (!price) {
      return res.status(404).json({
        success: false,
        error: 'No price found for the specified rate and vehicle type',
      });
    }

    res.json({
      success: true,
      data: {
        id: price.id,
        rateId: price.get('rateId'),
        vehicleTypeId: price.get('vehicleTypeId'),
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
        active: price.get('active'),
      },
    });
  } catch (error) {
    logger.error('Error fetching current price:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get all current prices for a specific rate.
 * @param req
 * @param res
 * @example
 */
const getPricesByRate = async (req, res) => {
  try {
    const { rateId } = req.params;

    const query = new Parse.Query('VehicleRatePrices');
    query.equalTo('rateId', rateId);
    query.doesNotExist('valid_until');
    query.equalTo('exists', true);
    query.equalTo('active', true);

    const prices = await query.find({ useMasterKey: true });

    res.json({
      success: true,
      data: prices.map((price) => ({
        id: price.id,
        rateId: price.get('rateId'),
        vehicleTypeId: price.get('vehicleTypeId'),
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
      })),
    });
  } catch (error) {
    logger.error('Error fetching prices by rate:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get all current prices for a specific vehicle type.
 * @param req
 * @param res
 * @example
 */
const getPricesByVehicleType = async (req, res) => {
  try {
    const { vehicleTypeId } = req.params;

    const query = new Parse.Query('VehicleRatePrices');
    query.equalTo('vehicleTypeId', vehicleTypeId);
    query.doesNotExist('valid_until');
    query.equalTo('exists', true);
    query.equalTo('active', true);

    const prices = await query.find({ useMasterKey: true });

    res.json({
      success: true,
      data: prices.map((price) => ({
        id: price.id,
        rateId: price.get('rateId'),
        vehicleTypeId: price.get('vehicleTypeId'),
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
      })),
    });
  } catch (error) {
    logger.error('Error fetching prices by vehicle type:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get all current prices (matrix view).
 * @param req
 * @param res
 * @example
 */
const getAllCurrentPrices = async (req, res) => {
  try {
    const query = new Parse.Query('VehicleRatePrices');
    query.doesNotExist('valid_until');
    query.equalTo('exists', true);
    query.equalTo('active', true);
    query.limit(1000);

    const prices = await query.find({ useMasterKey: true });

    // Group by rate for easier consumption
    const priceMatrix = {};
    prices.forEach((price) => {
      const rateId = price.get('rateId');
      if (!priceMatrix[rateId]) {
        priceMatrix[rateId] = [];
      }
      priceMatrix[rateId].push({
        id: price.id,
        vehicleTypeId: price.get('vehicleTypeId'),
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
      });
    });

    res.json({
      success: true,
      data: priceMatrix,
      total: prices.length,
    });
  } catch (error) {
    logger.error('Error fetching all current prices:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get price history for a specific rate and vehicle type.
 * @param req
 * @param res
 * @example
 */
const getPriceHistory = async (req, res) => {
  try {
    const { rateId, vehicleTypeId } = req.query;

    if (!rateId || !vehicleTypeId) {
      return res.status(400).json({
        success: false,
        error: 'Both rateId and vehicleTypeId are required',
      });
    }

    const history = await VehicleRatePrices.getPriceHistory(rateId, vehicleTypeId);

    res.json({
      success: true,
      data: history.map((price) => ({
        id: price.id,
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
        valid_until: price.get('valid_until'),
        reason_for_change: price.get('reason_for_change'),
        created_by: price.get('created_by'),
        active: price.get('active'),
      })),
    });
  } catch (error) {
    logger.error('Error fetching price history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Update price for a specific rate and vehicle type
 * Creates new price record and sets valid_until on current price.
 * @param req
 * @param res
 * @example
 */
const updatePrice = async (req, res) => {
  try {
    const {
      rateId, vehicleTypeId, pricePerHour, reasonForChange,
    } = req.body;

    if (!rateId || !vehicleTypeId || !pricePerHour) {
      return res.status(400).json({
        success: false,
        error: 'rateId, vehicleTypeId, and pricePerHour are required',
      });
    }

    if (pricePerHour <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Price must be greater than zero',
      });
    }

    // Get user ID from session
    const userId = req.user ? req.user.id : 'api_update';

    const newPrice = await VehicleRatePrices.createNewPrice({
      rateId,
      vehicleTypeId,
      pricePerHour,
      currency: req.body.currency || 'MXN',
      created_by: userId,
      reason_for_change: reasonForChange || 'Price update via API',
    });

    logger.info(`Price updated for rate ${rateId}, vehicle ${vehicleTypeId}: ${pricePerHour}`);

    res.json({
      success: true,
      data: {
        id: newPrice.id,
        rateId: newPrice.get('rateId'),
        vehicleTypeId: newPrice.get('vehicleTypeId'),
        pricePerHour: newPrice.get('pricePerHour'),
        currency: newPrice.get('currency'),
        valid_from: newPrice.get('valid_from'),
        reason_for_change: newPrice.get('reason_for_change'),
      },
    });
  } catch (error) {
    logger.error('Error updating price:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Bulk update prices for a rate.
 * @param req
 * @param res
 * @example
 */
const bulkUpdatePrices = async (req, res) => {
  try {
    const { rateId, prices, reasonForChange } = req.body;

    if (!rateId || !prices || !Array.isArray(prices)) {
      return res.status(400).json({
        success: false,
        error: 'rateId and prices array are required',
      });
    }

    const userId = req.user ? req.user.id : 'api_bulk_update';
    const updatedPrices = [];

    for (const priceData of prices) {
      if (!priceData.vehicleTypeId || !priceData.pricePerHour) {
        // Skip invalid price data
      } else {
        const newPrice = await VehicleRatePrices.createNewPrice({
          rateId,
          vehicleTypeId: priceData.vehicleTypeId,
          pricePerHour: priceData.pricePerHour,
          currency: priceData.currency || 'MXN',
          created_by: userId,
          reason_for_change: reasonForChange || 'Bulk price update via API',
        });

        updatedPrices.push({
          id: newPrice.id,
          vehicleTypeId: newPrice.get('vehicleTypeId'),
          pricePerHour: newPrice.get('pricePerHour'),
        });
      }
    }

    logger.info(`Bulk price update for rate ${rateId}: ${updatedPrices.length} prices updated`);

    res.json({
      success: true,
      data: {
        rateId,
        updated: updatedPrices.length,
        prices: updatedPrices,
      },
    });
  } catch (error) {
    logger.error('Error in bulk price update:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Get price at a specific date (for historical queries).
 * @param req
 * @param res
 * @example
 */
const getPriceAtDate = async (req, res) => {
  try {
    const { rateId, vehicleTypeId, date } = req.query;

    if (!rateId || !vehicleTypeId || !date) {
      return res.status(400).json({
        success: false,
        error: 'rateId, vehicleTypeId, and date are required',
      });
    }

    const targetDate = new Date(date);
    if (Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
      });
    }

    const price = await VehicleRatePrices.getPriceAtDate(rateId, vehicleTypeId, targetDate);

    if (!price) {
      return res.status(404).json({
        success: false,
        error: 'No price found for the specified date',
      });
    }

    res.json({
      success: true,
      data: {
        id: price.id,
        rateId: price.get('rateId'),
        vehicleTypeId: price.get('vehicleTypeId'),
        pricePerHour: price.get('pricePerHour'),
        currency: price.get('currency'),
        valid_from: price.get('valid_from'),
        valid_until: price.get('valid_until'),
        queried_date: date,
      },
    });
  } catch (error) {
    logger.error('Error fetching price at date:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getCurrentPrice,
  getPricesByRate,
  getPricesByVehicleType,
  getAllCurrentPrices,
  getPriceHistory,
  updatePrice,
  bulkUpdatePrices,
  getPriceAtDate,
};
