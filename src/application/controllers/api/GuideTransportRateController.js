const GuideTransportRate = require('../../../domain/models/GuideTransportRate');
const logger = require('../../../infrastructure/logger');

/**
 * GuideTransportRate API Controller.
 *
 * Handles API endpoints for guide transport rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for guide transport rates
 * - Current rate retrieval with auto-creation of default rate.
 *
 * Created by Denisse Maldonado.
 */
class GuideTransportRateController {
  /**
   * Get guide transport rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with guide transport rate history.
   * @example
   * // GET /api/guide-transport-rate/history?draw=1&start=0&length=10
   * // Returns DataTables-compatible JSON response
   */
  async getHistory(req, res) {
    try {
      // Extract DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = parseInt(req.query.length, 10) || 10;

      // Calculate page number (0-based for our model)
      const page = Math.floor(start / length);

      // Get history with pagination
      const historyResult = await GuideTransportRate.getHistory(page, length);

      // Format data for DataTables (4 columns to match guia-chofer pattern)
      const formattedData = historyResult.data.map((rate) => [
        rate.get('effectiveDate').toLocaleString('es-MX', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        rate.getFormattedValue(),
        rate.get('notes') || 'Sin notas',
        rate.get('active')
          ? '<span class="badge bg-success">Activo</span>'
          : '<span class="badge bg-secondary">Inactivo</span>',
      ]);

      // Return DataTables response
      res.json({
        draw,
        recordsTotal: historyResult.total,
        recordsFiltered: historyResult.total,
        data: formattedData,
      });
    } catch (error) {
      logger.error('Error getting guide transport rate history:', error);
      res.status(500).json({
        draw: req.query.draw || 1,
        recordsTotal: 0,
        recordsFiltered: 0,
        data: [],
        error: 'Error loading history data',
      });
    }
  }

  /**
   * Get current active guide transport rate.
   * Auto-creates default rate (400 MXN) if none exists.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current guide transport rate.
   * @example
   * // GET /api/guide-transport-rate/current
   * // Returns current active guide transport rate
   */
  async getCurrent(req, res) {
    try {
      // Ensure default rate exists, create if not
      await GuideTransportRate.createDefaultIfNotExists();

      // Get current rate
      const currentRate = await GuideTransportRate.getCurrentRate();

      if (!currentRate) {
        return res.status(404).json({
          success: false,
          error: 'No guide transport rate found',
        });
      }

      const createdBy = currentRate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: currentRate.getFormattedValue(),
          notes: currentRate.get('notes') || '',
          active: currentRate.get('active'),
          effectiveDate: currentRate.get('effectiveDate'),
          createdAt: currentRate.get('createdAt'),
          updatedAt: currentRate.get('updatedAt'),
          lastUpdated: currentRate.get('effectiveDate'), // For compatibility with frontend
          createdBy: createdBy ? {
            id: createdBy.id,
            name: createdBy.get('name') || createdBy.get('email') || 'Sistema',
          } : null,
        },
      });
    } catch (error) {
      logger.error('Error getting current guide transport rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving current guide transport rate',
      });
    }
  }

  /**
   * Create new guide transport rate (replaces current active one).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created guide transport rate.
   * @example
   * // POST /api/guide-transport-rate
   * // Body: { value: 450.0, notes: "New guide transport rate", effectiveDate: "2024-01-01" }
   * // Creates new guide transport rate and deactivates previous ones
   */
  async create(req, res) {
    try {
      const { value, notes, effectiveDate } = req.body;

      // Validate required fields
      if (!value || Number.isNaN(Number(value))) {
        return res.status(400).json({
          success: false,
          error: 'Valid guide transport rate value is required',
        });
      }

      // Validate value range
      const numValue = parseFloat(value);
      if (numValue <= 0 || numValue > 10000) {
        return res.status(400).json({
          success: false,
          error: 'Guide transport rate value must be between 1.00 and 10000.00',
        });
      }

      // Get user from authenticated request
      const user = req.user || null;

      // Use provided effective date or current date
      const parsedEffectiveDate = effectiveDate ? new Date(effectiveDate) : new Date();

      // Create new guide transport rate
      const newRate = await GuideTransportRate.createRate(
        numValue,
        parsedEffectiveDate,
        user,
        notes || ''
      );

      logger.info(`Guide transport rate created: ${newRate.getFormattedValue()}`, {
        userId: user?.id,
        rateId: newRate.id,
        value: numValue,
      });

      res.status(201).json({
        success: true,
        message: 'Guide transport rate created successfully',
        data: {
          id: newRate.id,
          value: newRate.get('value'),
          formatted: newRate.getFormattedValue(),
          notes: newRate.get('notes'),
          active: newRate.get('active'),
          effectiveDate: newRate.get('effectiveDate'),
          createdAt: newRate.get('createdAt'),
        },
      });
    } catch (error) {
      logger.error('Error creating guide transport rate:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error creating guide transport rate',
      });
    }
  }

  /**
   * Get guide transport rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with guide transport rate details.
   * @example
   * // GET /api/guide-transport-rate/:id
   * // Returns specific guide transport rate by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Guide transport rate ID is required',
        });
      }

      const query = new Parse.Query(GuideTransportRate);
      query.include('createdBy');
      query.equalTo('exists', true);
      const rate = await query.get(id, { useMasterKey: true });

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Guide transport rate not found',
        });
      }

      const createdBy = rate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: rate.getFormattedValue(),
          notes: rate.get('notes') || '',
          active: rate.get('active'),
          effectiveDate: rate.get('effectiveDate'),
          createdAt: rate.get('createdAt'),
          updatedAt: rate.get('updatedAt'),
          createdBy: createdBy
            ? {
              id: createdBy.id,
              name: createdBy.get('name') || createdBy.get('email') || 'Sistema',
            }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error getting guide transport rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving guide transport rate',
      });
    }
  }
}

module.exports = new GuideTransportRateController();
