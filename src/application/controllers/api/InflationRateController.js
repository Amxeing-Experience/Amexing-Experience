const InflationRate = require('../../../domain/models/InflationRate');
const logger = require('../../../infrastructure/logger');

/**
 * InflationRate API Controller.
 *
 * Handles API endpoints for inflation rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for inflation rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */
class InflationRateController {
  /**
   * Get inflation rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with inflation rate history.
   * @example
   * // GET /api/inflation-rates/history?draw=1&start=0&length=10
   * // Returns DataTables-compatible JSON response
   */
  async getHistory(req, res) {
    try {
      // Extract DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = parseInt(req.query.length, 10) || 10;
      const searchValue = req.query.search?.value || '';

      // Extract sorting parameters
      const orderColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const orderDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting
      const columns = ['createdAt', 'value', 'description', 'active'];
      const sortBy = orderColumnIndex >= 0 && orderColumnIndex < columns.length ? columns[orderColumnIndex] : 'createdAt';

      // Calculate page number
      const page = Math.floor(start / length) + 1;

      // Get history with pagination
      const historyResult = await InflationRate.getHistory({
        page,
        limit: length,
        sortBy,
        sortOrder: orderDirection,
        search: searchValue,
      });

      // Format data for DataTables
      const formattedData = historyResult.data.map((rate) => [
        rate.get('createdAt').toLocaleString('es-MX', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        `${InflationRate.formatValue(rate.get('value'))}%`,
        rate.get('description') || 'Sin descripción',
        rate.get('active')
          ? '<span class="badge bg-success">Activo</span>'
          : '<span class="badge bg-secondary">Inactivo</span>',
      ]);

      // Return DataTables response
      res.json({
        draw,
        recordsTotal: historyResult.pagination.total,
        recordsFiltered: historyResult.pagination.total, // TODO: Implement search filtering
        data: formattedData,
      });
    } catch (error) {
      logger.error('Error getting inflation rate history:', error);
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
   * Get current active inflation rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current inflation rate.
   * @example
   * // GET /api/inflation-rates/current
   * // Returns current active inflation rate
   */
  async getCurrent(req, res) {
    try {
      const currentRate = await InflationRate.getCurrentInflationRate();

      if (!currentRate) {
        return res.json({
          success: false,
          error: 'No current inflation rate found',
        });
      }

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: InflationRate.formatValue(currentRate.get('value')),
          description: currentRate.get('description'),
          active: currentRate.get('active'),
          createdAt: currentRate.get('createdAt'),
          updatedAt: currentRate.get('updatedAt'),
        },
      });
    } catch (error) {
      logger.error('Error getting current inflation rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving current inflation rate',
      });
    }
  }

  /**
   * Create new inflation rate (replaces current active one).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created inflation rate.
   * @example
   * // POST /api/inflation-rates
   * // Body: { value: 2.5, description: "New inflation rate" }
   * // Creates new inflation rate and deactivates previous ones
   */
  async create(req, res) {
    try {
      const { value, description } = req.body;

      // Validate required fields
      if (!value || Number.isNaN(Number(value))) {
        return res.status(400).json({
          success: false,
          error: 'Valid inflation rate value is required',
        });
      }

      // Validate value range
      if (!InflationRate.isValidValue(value)) {
        return res.status(400).json({
          success: false,
          error: 'Inflation rate value must be between 0.01 and 50.00',
        });
      }

      // Get user ID from authenticated request
      const userId = req.user?.id || null;

      // Create new inflation rate
      const newRate = await InflationRate.createInflationRate({
        value: parseFloat(value),
        description: description || '',
        createdBy: userId,
      });

      logger.info(`Inflation rate created: ${value}%`, {
        userId,
        rateId: newRate.id,
        previousValue: 'replaced',
      });

      res.status(201).json({
        success: true,
        message: 'Inflation rate created successfully',
        data: {
          id: newRate.id,
          value: newRate.get('value'),
          formatted: InflationRate.formatValue(newRate.get('value')),
          description: newRate.get('description'),
          active: newRate.get('active'),
          createdAt: newRate.get('createdAt'),
        },
      });
    } catch (error) {
      logger.error('Error creating inflation rate:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error creating inflation rate',
      });
    }
  }

  /**
   * Get inflation rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with inflation rate details.
   * @example
   * // GET /api/inflation-rates/:id
   * // Returns specific inflation rate by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Inflation rate ID is required',
        });
      }

      const rate = await InflationRate.getById(id);

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Inflation rate not found',
        });
      }

      const createdBy = rate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: InflationRate.formatValue(rate.get('value')),
          description: rate.get('description'),
          active: rate.get('active'),
          createdAt: rate.get('createdAt'),
          updatedAt: rate.get('updatedAt'),
          createdBy: createdBy ? {
            id: createdBy.id,
            name: createdBy.get('name') || createdBy.get('email'),
          } : null,
        },
      });
    } catch (error) {
      logger.error('Error getting inflation rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving inflation rate',
      });
    }
  }
}

module.exports = new InflationRateController();
