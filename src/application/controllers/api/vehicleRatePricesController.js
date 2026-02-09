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
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Query the VehicleRatePrices table directly
      const query = new Parse.Query('VehicleRatePrices');
      query.doesNotExist('valid_until'); // Current prices only
      query.equalTo('exists', true);
      query.equalTo('active', true);

      const prices = await query.find({ useMasterKey: true });

      return res.json({
        success: true,
        result: {
          count: prices.length,
          prices: prices.map((p) => ({
            id: p.id,
            rateId: p.get('rateId'),
            vehicleTypeId: p.get('vehicleTypeId'),
            pricePerHour: p.get('pricePerHour'),
            currency: p.get('currency'),
            validFrom: p.get('valid_from'),
            active: p.get('active'),
          })),
        },
      });
    } catch (error) {
      console.error('Error in VehicleRatePricesController.getAllVehicleRatePrices:', error);

      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve vehicle rate prices',
      });
    }
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

      // Query the VehicleRatePrices table directly
      const query = new Parse.Query('VehicleRatePrices');
      query.doesNotExist('valid_until'); // Current prices only
      query.equalTo('exists', true);
      query.equalTo('active', true);

      const prices = await query.find({ useMasterKey: true });

      return res.json({
        success: true,
        result: {
          count: prices.length,
          prices: prices.map((p) => ({
            id: p.id,
            rateId: p.get('rateId'),
            vehicleTypeId: p.get('vehicleTypeId'),
            pricePerHour: p.get('pricePerHour'),
            currency: p.get('currency'),
            validFrom: p.get('valid_from'),
            active: p.get('active'),
          })),
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
