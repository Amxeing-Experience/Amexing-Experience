const DriverTourRate = require('../../../domain/models/DriverTourRate');
const logger = require('../../../infrastructure/logger');

/**
 * DriverTourRate API Controller.
 *
 * Handles API endpoints for driver tour rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for driver tour rates
 * - Current rate retrieval.
 *
 * Created by Denisse Maldonado.
 */
class DriverTourRateController {
  /**
   * Get driver tour rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with driver tour rate history.
   * @example
   * // GET /api/driver-tour-rate/history?draw=1&start=0&length=10
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
      const historyResult = await DriverTourRate.getHistory({
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
        `$${DriverTourRate.formatValue(rate.get('value'))} MXN`,
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
      logger.error('Error getting driver tour rate history:', error);
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
   * Get current active driver tour rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current driver tour rate.
   * @example
   * // GET /api/driver-tour-rate/current
   * // Returns current active driver tour rate
   */
  async getCurrent(req, res) {
    try {
      // Ensure default rate exists, create if not
      const currentRate = await DriverTourRate.ensureDefaultRate();

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: DriverTourRate.formatValue(currentRate.get('value')),
          description: currentRate.get('description'),
          active: currentRate.get('active'),
          createdAt: currentRate.get('createdAt'),
          updatedAt: currentRate.get('updatedAt'),
          lastUpdated: currentRate.get('createdAt'), // For compatibility with frontend
        },
      });
    } catch (error) {
      logger.error('Error getting current driver tour rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving current driver tour rate',
      });
    }
  }

  /**
   * Create new driver tour rate (replaces current active one).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created driver tour rate.
   * @example
   * // POST /api/driver-tour-rate
   * // Body: { value: 635.0, description: "New driver tour rate" }
   * // Creates new driver tour rate and deactivates previous ones
   */
  async create(req, res) {
    try {
      const { value, description } = req.body;

      // Validate required fields
      if (!value || Number.isNaN(Number(value))) {
        return res.status(400).json({
          success: false,
          error: 'Valid driver tour rate value is required',
        });
      }

      // Validate value range
      if (!DriverTourRate.isValidValue(value)) {
        return res.status(400).json({
          success: false,
          error: 'Driver tour rate value must be between 1.00 and 10000.00',
        });
      }

      // Get user ID from authenticated request
      const userId = req.user?.id || null;

      // Create new driver tour rate
      const newRate = await DriverTourRate.createDriverTourRate({
        value: parseFloat(value),
        description: description || '',
        createdBy: userId,
      });

      logger.info(`Driver tour rate created: $${value} MXN`, {
        userId,
        rateId: newRate.id,
        previousValue: 'replaced',
      });

      res.status(201).json({
        success: true,
        message: 'Driver tour rate created successfully',
        data: {
          id: newRate.id,
          value: newRate.get('value'),
          formatted: DriverTourRate.formatValue(newRate.get('value')),
          description: newRate.get('description'),
          active: newRate.get('active'),
          createdAt: newRate.get('createdAt'),
        },
      });
    } catch (error) {
      logger.error('Error creating driver tour rate:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error creating driver tour rate',
      });
    }
  }

  /**
   * Get driver tour rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with driver tour rate details.
   * @example
   * // GET /api/driver-tour-rate/:id
   * // Returns specific driver tour rate by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Driver tour rate ID is required',
        });
      }

      const rate = await DriverTourRate.getById(id);

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Driver tour rate not found',
        });
      }

      const createdBy = rate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: DriverTourRate.formatValue(rate.get('value')),
          description: rate.get('description'),
          active: rate.get('active'),
          createdAt: rate.get('createdAt'),
          updatedAt: rate.get('updatedAt'),
          createdBy: createdBy
            ? {
              id: createdBy.id,
              name: createdBy.get('name') || createdBy.get('email'),
            }
            : null,
        },
      });
    } catch (error) {
      logger.error('Error getting driver tour rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error retrieving driver tour rate',
      });
    }
  }
}

module.exports = new DriverTourRateController();
