const AgencyRate = require('../../../domain/models/AgencyRate');
const logger = require('../../../infrastructure/logger');

/**
 * AgencyRate API Controller.
 *
 * Handles API endpoints for agency rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for agency rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */
class AgencyRateController {
  /**
   * Get agency rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with agency rate history.
   * @example
   * // GET /api/agency-rates/history?draw=1&start=0&length=10
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
      const historyResult = await AgencyRate.getHistory({
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
        `${AgencyRate.formatValue(rate.get('value'))}%`,
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
      logger.error('Error getting agency rate history:', error);
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
   * Get current active agency rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current agency rate.
   * @example
   * // GET /api/agency-rates/current
   * // Returns current active agency rate
   */
  async getCurrent(req, res) {
    try {
      const currentRate = await AgencyRate.getCurrentAgencyRate();

      if (!currentRate) {
        return res.json({
          success: false,
          error: 'No current agency rate found',
        });
      }

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: AgencyRate.formatValue(currentRate.get('value')),
          description: currentRate.get('description'),
          active: currentRate.get('active'),
          createdAt: currentRate.get('createdAt'),
          updatedAt: currentRate.get('updatedAt'),
        },
      });
    } catch (error) {
      logger.error('Error getting current agency rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving current agency rate',
      });
    }
  }

  /**
   * Create new agency rate (replaces current active one).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created agency rate.
   * @example
   * // POST /api/agency-rates
   * // Body: { value: 2.5, description: "New agency rate" }
   * // Creates new agency rate and deactivates previous ones
   */
  async create(req, res) {
    try {
      const { value, description } = req.body;

      // Validate required fields
      if (!value || Number.isNaN(Number(value))) {
        return res.status(400).json({
          success: false,
          error: 'Valid agency rate value is required',
        });
      }

      // Validate value range
      if (!AgencyRate.isValidValue(value)) {
        return res.status(400).json({
          success: false,
          error: 'Agency rate value must be between 0.01 and 50.00',
        });
      }

      // Get user ID from authenticated request
      const userId = req.user?.id || null;

      // Create new agency rate
      const newRate = await AgencyRate.createAgencyRate({
        value: parseFloat(value),
        description: description || '',
        createdBy: userId,
      });

      logger.info(`Agency rate created: ${value}%`, {
        userId,
        rateId: newRate.id,
        previousValue: 'replaced',
      });

      res.status(201).json({
        success: true,
        message: 'Agency rate created successfully',
        data: {
          id: newRate.id,
          value: newRate.get('value'),
          formatted: AgencyRate.formatValue(newRate.get('value')),
          description: newRate.get('description'),
          active: newRate.get('active'),
          createdAt: newRate.get('createdAt'),
        },
      });
    } catch (error) {
      logger.error('Error creating agency rate:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error creating agency rate',
      });
    }
  }

  /**
   * Get agency rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with agency rate details.
   * @example
   * // GET /api/agency-rates/:id
   * // Returns specific agency rate by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Agency rate ID is required',
        });
      }

      const rate = await AgencyRate.getById(id);

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Agency rate not found',
        });
      }

      const createdBy = rate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: AgencyRate.formatValue(rate.get('value')),
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
      logger.error('Error getting agency rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving agency rate',
      });
    }
  }
}

module.exports = new AgencyRateController();
