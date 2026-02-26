/**
 * VehicleRatePricesController - API wrapper for vehicle rate prices cloud functions.
 *
 * Provides JWT-authenticated access to vehicle rate prices data by proxying
 * calls to Parse Cloud functions with proper authentication.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');

/**
 * VehicleRatePricesController class implementing API endpoints.
 */
class VehicleRatePricesController {
  /**
   * GET /api/vehicle-rate-prices/all - Get all current vehicle rate prices.
   *
   * Queries the database directly for vehicle rate prices data.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getAllVehicleRatePrices(req, res) {
    // Just call the getAllCurrentPrices method to avoid duplication
    return this.getAllCurrentPrices(req, res);
  }

  /**
   * GET /api/vehicle-rate-prices/all - Alias for getAllVehicleRatePrices.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getAllCurrentPrices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Query the VehicleRatePrices table directly with related data
      const query = new Parse.Query('VehicleRatePrices');
      query.doesNotExist('valid_until'); // Current prices only
      query.equalTo('exists', true);
      query.equalTo('active', true);

      // Include related Rate and VehicleType data
      query.include('rateId');
      query.include('vehicleTypeId');

      const prices = await query.find({ useMasterKey: true });

      // Fetch rates and vehicle types separately if includes didn't work
      const rateIds = [...new Set(prices.map((p) => p.get('rateId')).filter((id) => id))];
      const vehicleTypeIds = [...new Set(prices.map((p) => p.get('vehicleTypeId')).filter((id) => id))];

      const rateQuery = new Parse.Query('Rate');
      rateQuery.containedIn('objectId', rateIds);
      const rates = await rateQuery.find({ useMasterKey: true });
      const rateMap = {};
      const rateColors = {};
      rates.forEach((rate) => {
        rateMap[rate.id] = rate;
        rateColors[rate.get('name')] = rate.get('color') || '#6c757d';
      });

      const vehicleTypeQuery = new Parse.Query('VehicleType');
      vehicleTypeQuery.containedIn('objectId', vehicleTypeIds);
      const vehicleTypes = await vehicleTypeQuery.find({ useMasterKey: true });
      const vehicleTypeMap = {};
      vehicleTypes.forEach((vt) => {
        vehicleTypeMap[vt.id] = vt;
      });

      return res.json({
        success: true,
        result: {
          count: prices.length,
          prices: prices.map((p) => {
            const rateId = p.get('rateId');
            const vehicleTypeId = p.get('vehicleTypeId');

            // Use the maps to get the full objects
            const rate = rateMap[rateId];
            const vehicleType = vehicleTypeMap[vehicleTypeId];

            return {
              id: p.id,
              rateId,
              rateName: rate ? rate.get('name') : 'undefined',
              rateColor: rate ? rate.get('color') || '#6c757d' : '#6c757d',
              vehicleTypeId,
              vehicleTypeName: vehicleType ? vehicleType.get('name') : 'undefined',
              vehicleTypeCode: vehicleType ? vehicleType.get('code') : 'undefined',
              pricePerHour: p.get('pricePerHour'),
              currency: p.get('currency'),
              validFrom: p.get('valid_from'),
              active: p.get('active'),
            };
          }),
          rateColors,
        },
      });
    } catch (error) {
      console.error('Error in VehicleRatePricesController.getAllCurrentPrices:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve vehicle rate prices',
      });
    }
  }

  // Add placeholder methods for other routes
  async getCurrentPrice(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  async getPricesByRate(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  async getPricesByVehicleType(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  async getPriceAtDate(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  async getPriceHistory(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  async updatePrice(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  /**
   * Bulk update multiple vehicle rate prices.
   * POST /api/vehicle-rate-prices/bulk-update.
   * @param {object} req - Express request object containing array of price updates.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} JSON response with operation status.
   * @example
   * // Request body
   * {
   *   "updates": [
   *     { "id": "price1", "price": 150.00 },
   *     { "id": "price2", "price": 200.00 }
   *   ]
   * }
   */
  async bulkUpdatePrices(req, res) {
    return res.status(501).json({ success: false, error: 'Not implemented yet' });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} status - HTTP status code.
   * @returns {object} Express response.
   * @example
   */
  sendError(res, message, status = 500) {
    return res.status(status).json({
      success: false,
      error: message,
    });
  }
}

module.exports = new VehicleRatePricesController();
