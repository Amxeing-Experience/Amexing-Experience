const ExchangeRate = require('../../../domain/models/ExchangeRate');
const logger = require('../../../infrastructure/logger');

/**
 * ExchangeRate API Controller.
 *
 * Handles API endpoints for exchange rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for exchange rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */
class ExchangeRateController {
  /**
   * Get exchange rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getHistory(req, res) {
    try {
      // Extract DataTables parameters
      const draw = parseInt(req.query.draw) || 1;
      const start = parseInt(req.query.start) || 0;
      const length = parseInt(req.query.length) || 10;
      const searchValue = req.query.search?.value || '';

      // Extract sorting parameters
      const orderColumnIndex = parseInt(req.query.order?.[0]?.column) || 0;
      const orderDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting
      const columns = ['createdAt', 'value', 'description', 'active'];
      const sortBy = columns[orderColumnIndex] || 'createdAt';

      // Calculate page number
      const page = Math.floor(start / length) + 1;

      // Get history with pagination
      const historyResult = await ExchangeRate.getHistory({
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
        `$${ExchangeRate.formatValue(rate.get('value'))}`,
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
      logger.error('Error getting exchange rate history:', error);
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
   * Get current active exchange rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getCurrent(req, res) {
    try {
      const currentRate = await ExchangeRate.getCurrentExchangeRate();

      if (!currentRate) {
        return res.json({
          success: false,
          error: 'No current exchange rate found',
        });
      }

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: ExchangeRate.formatValue(currentRate.get('value')),
          description: currentRate.get('description'),
          active: currentRate.get('active'),
          createdAt: currentRate.get('createdAt'),
          updatedAt: currentRate.get('updatedAt'),
        },
      });
    } catch (error) {
      logger.error('Error getting current exchange rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving current exchange rate',
      });
    }
  }

  /**
   * Create new exchange rate (replaces current active one).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async create(req, res) {
    try {
      const { value, description } = req.body;

      // Validate required fields
      if (!value || Number.isNaN(Number(value))) {
        return res.status(400).json({
          success: false,
          error: 'Valid exchange rate value is required',
        });
      }

      // Validate value range
      if (!ExchangeRate.isValidValue(value)) {
        return res.status(400).json({
          success: false,
          error: 'Exchange rate value must be between 0.01 and 999.99',
        });
      }

      // Get user ID from authenticated request
      const userId = req.user?.id || null;

      // Create new exchange rate
      const newRate = await ExchangeRate.createExchangeRate({
        value: parseFloat(value),
        description: description || '',
        createdBy: userId,
      });

      logger.info(`Exchange rate created: ${value}`, {
        userId,
        rateId: newRate.id,
        previousValue: 'replaced',
      });

      res.status(201).json({
        success: true,
        message: 'Exchange rate created successfully',
        data: {
          id: newRate.id,
          value: newRate.get('value'),
          formatted: ExchangeRate.formatValue(newRate.get('value')),
          description: newRate.get('description'),
          active: newRate.get('active'),
          createdAt: newRate.get('createdAt'),
        },
      });
    } catch (error) {
      logger.error('Error creating exchange rate:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error creating exchange rate',
      });
    }
  }

  /**
   * Get exchange rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Exchange rate ID is required',
        });
      }

      const rate = await ExchangeRate.getById(id);

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Exchange rate not found',
        });
      }

      const createdBy = rate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: ExchangeRate.formatValue(rate.get('value')),
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
      logger.error('Error getting exchange rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving exchange rate',
      });
    }
  }
}

module.exports = new ExchangeRateController();
