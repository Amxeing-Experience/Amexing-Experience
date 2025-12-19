/**
 * PriceAdjustments API Controller.
 *
 * Handles CRUD operations for price adjustment factors including:
 * - Exchange rates (USD to MXN)
 * - Inflation percentages
 * - Agency commission percentages
 * - Transfer payment fee percentages.
 *
 * Features:
 * - Historical tracking with audit trail
 * - Current active value management
 * - Role-based access control (Admin level required)
 * - Comprehensive error handling and validation.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const PriceAdjustments = require('../../../domain/models/PriceAdjustments');
const logger = require('../../../infrastructure/logger');

/**
 * Price Adjustments Controller
 * Handles price adjustment operations including history retrieval and data management.
 * Provides endpoints for DataTables server-side processing and price adjustment queries.
 */
class PriceAdjustmentsController {
  /**
   * Get adjustment history by type with DataTables server-side processing.
   * GET /api/price-adjustments/:type.
   * @param req
   * @param res
   * @example
   */
  static async getAdjustmentHistory(req, res) {
    try {
      const { type } = req.params;
      const currentUser = req.user;

      // Validate type
      const validTypes = ['exchange-rate', 'inflation', 'agency', 'transfer'];
      const dbType = type.replace('-', '_'); // Convert URL format to DB format

      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid adjustment type',
        });
      }

      // Get history
      const adjustments = await PriceAdjustments.getHistoryByType(dbType, 100);

      // Format data for DataTables
      const data = adjustments.map((adjustment) => {
        const createdBy = adjustment.get('createdBy');

        return {
          id: adjustment.id,
          value: adjustment.getValue(),
          formattedValue: adjustment.getFormattedValue(),
          currency: adjustment.getCurrency(),
          effectiveDate: adjustment.getEffectiveDate(),
          note: adjustment.getNote(),
          active: adjustment.get('active'),
          createdBy: createdBy ? {
            id: createdBy.id,
            username: createdBy.get('username') || createdBy.get('email'),
            email: createdBy.get('email'),
          } : null,
          createdAt: adjustment.get('createdAt'),
        };
      });

      logger.info('Price adjustment history retrieved successfully', {
        userId: currentUser.id,
        type: dbType,
        count: data.length,
      });

      res.json({
        success: true,
        data,
        recordsTotal: data.length,
        recordsFiltered: data.length,
      });
    } catch (error) {
      logger.error('Error getting price adjustment history', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        type: req.params?.type,
      });

      res.status(500).json({
        success: false,
        error: 'Error retrieving adjustment history',
      });
    }
  }

  /**
   * Get current adjustment by type.
   * GET /api/price-adjustments/:type/current.
   * @param req
   * @param res
   * @example
   */
  static async getCurrentAdjustment(req, res) {
    try {
      const { type } = req.params;
      const currentUser = req.user;

      // Validate type
      const validTypes = ['exchange-rate', 'inflation', 'agency', 'transfer'];
      const dbType = type.replace('-', '_');

      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid adjustment type',
        });
      }

      // Get current adjustment
      const adjustment = await PriceAdjustments.getCurrentByType(dbType);

      if (!adjustment) {
        return res.json({
          success: true,
          data: null,
          message: 'No current adjustment found for this type',
        });
      }

      // Format response
      const createdBy = adjustment.get('createdBy');
      const data = {
        id: adjustment.id,
        type: adjustment.getType(),
        value: adjustment.getValue(),
        formattedValue: adjustment.getFormattedValue(),
        currency: adjustment.getCurrency(),
        effectiveDate: adjustment.getEffectiveDate(),
        note: adjustment.getNote(),
        active: adjustment.get('active'),
        createdBy: createdBy ? {
          id: createdBy.id,
          username: createdBy.get('username') || createdBy.get('email'),
          email: createdBy.get('email'),
        } : null,
        createdAt: adjustment.get('createdAt'),
        updatedAt: adjustment.get('updatedAt'),
      };

      logger.info('Current price adjustment retrieved successfully', {
        userId: currentUser.id,
        type: dbType,
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error getting current price adjustment', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        type: req.params?.type,
      });

      res.status(500).json({
        success: false,
        error: 'Error retrieving current adjustment',
      });
    }
  }

  /**
   * Create new price adjustment.
   * POST /api/price-adjustments/:type.
   * @param req
   * @param res
   * @example
   */
  static async createAdjustment(req, res) {
    try {
      const { type } = req.params;
      const {
        value, currency, effectiveDate, note,
      } = req.body;
      const currentUser = req.user;

      // Validate type
      const validTypes = ['exchange-rate', 'inflation', 'agency', 'transfer'];
      const dbType = type.replace('-', '_');

      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid adjustment type',
        });
      }

      // Validate required fields
      if (!value || !effectiveDate) {
        return res.status(400).json({
          success: false,
          error: 'Value and effective date are required',
        });
      }

      // Validate effective date
      const effectiveDateObj = new Date(effectiveDate);
      if (Number.isNaN(effectiveDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid effective date',
        });
      }

      // Create adjustment parameters
      const adjustmentParams = {
        type: dbType,
        value: parseFloat(value),
        effectiveDate: effectiveDateObj,
        createdById: currentUser.id,
        note: note || '',
      };

      // Add currency for exchange rates
      if (dbType === 'exchange_rate' && currency) {
        adjustmentParams.currency = currency;
      }

      // Create the adjustment
      const adjustment = await PriceAdjustments.createAdjustment(adjustmentParams);

      // Format response
      const data = {
        id: adjustment.id,
        type: adjustment.getType(),
        value: adjustment.getValue(),
        formattedValue: adjustment.getFormattedValue(),
        currency: adjustment.getCurrency(),
        effectiveDate: adjustment.getEffectiveDate(),
        note: adjustment.getNote(),
        active: adjustment.get('active'),
        createdAt: adjustment.get('createdAt'),
      };

      logger.info('Price adjustment created successfully', {
        userId: currentUser.id,
        type: dbType,
        value: adjustmentParams.value,
      });

      res.status(201).json({
        success: true,
        data,
        message: 'Price adjustment created successfully',
      });
    } catch (error) {
      logger.error('Error creating price adjustment', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
      });

      // Handle validation errors
      if (error.message.includes('Validation failed')) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: 'Error creating price adjustment',
      });
    }
  }

  /**
   * Get all current adjustments.
   * GET /api/price-adjustments/current.
   * @param req
   * @param res
   * @example
   */
  static async getAllCurrent(req, res) {
    try {
      const currentUser = req.user;

      // Get all current adjustments
      const adjustments = await PriceAdjustments.getAllCurrent();

      // Format response
      const data = {};
      Object.keys(adjustments).forEach((type) => {
        const adjustment = adjustments[type];
        if (adjustment) {
          const createdBy = adjustment.get('createdBy');
          data[type] = {
            id: adjustment.id,
            type: adjustment.getType(),
            value: adjustment.getValue(),
            formattedValue: adjustment.getFormattedValue(),
            currency: adjustment.getCurrency(),
            effectiveDate: adjustment.getEffectiveDate(),
            note: adjustment.getNote(),
            active: adjustment.get('active'),
            createdBy: createdBy ? {
              id: createdBy.id,
              username: createdBy.get('username') || createdBy.get('email'),
              email: createdBy.get('email'),
            } : null,
            createdAt: adjustment.get('createdAt'),
            updatedAt: adjustment.get('updatedAt'),
          };
        } else {
          data[type] = null;
        }
      });

      logger.info('All current price adjustments retrieved successfully', {
        userId: currentUser.id,
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('Error getting all current price adjustments', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      res.status(500).json({
        success: false,
        error: 'Error retrieving current adjustments',
      });
    }
  }
}

module.exports = PriceAdjustmentsController;
