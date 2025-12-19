const TransferRate = require('../../../domain/models/TransferRate');
const logger = require('../../../infrastructure/logger');

/**
 * Transfer Rate API Controller.
 *
 * Handles HTTP requests for transfer rate management operations.
 * Provides RESTful endpoints for CRUD operations and DataTables integration.
 *
 * Created by Denisse Maldonado.
 */
class TransferRateController {
  /**
   * Create a new transfer rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created transfer rate.
   * @example
   * // POST /api/transfer-rates
   * // Body: { value: 1.5, description: "New transfer rate" }
   * // Creates new transfer rate and deactivates previous ones
   */
  async create(req, res) {
    try {
      const { value, description } = req.body;

      // Validation
      if (!value) {
        return res.status(400).json({
          success: false,
          error: 'Transfer rate value is required',
        });
      }

      if (!TransferRate.isValidValue(value)) {
        return res.status(400).json({
          success: false,
          error: 'Transfer rate value must be between 0.01 and 50.00',
        });
      }

      // Get user ID from authenticated session
      const createdBy = req.user ? req.user.id : null;

      // Create transfer rate
      const transferRate = await TransferRate.createTransferRate({
        value: parseFloat(value),
        description: description || '',
        createdBy,
      });

      logger.info('Transfer rate created via API', {
        rateId: transferRate.id,
        value,
        userId: createdBy,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });

      res.status(201).json({
        success: true,
        data: {
          id: transferRate.id,
          value: transferRate.get('value'),
          formatted: TransferRate.formatValue(transferRate.get('value')),
          description: transferRate.get('description'),
          active: transferRate.get('active'),
          createdAt: transferRate.get('createdAt'),
        },
        message: 'Transfer rate created successfully',
      });
    } catch (error) {
      logger.error('Error in TransferRateController.create:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to create transfer rate',
        details: error.message,
      });
    }
  }

  /**
   * Get transfer rate history with DataTables support.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with transfer rate history.
   * @example
   * // GET /api/transfer-rates/history?draw=1&start=0&length=10
   * // Returns DataTables-compatible JSON response
   */
  async getHistory(req, res) {
    try {
      // DataTables parameters
      const draw = parseInt(req.query.draw, 10) || 1;
      const start = parseInt(req.query.start, 10) || 0;
      const length = parseInt(req.query.length, 10) || 10;
      const searchValue = req.query.search?.value || '';

      // Sorting parameters
      const orderColumnIndex = parseInt(req.query.order?.[0]?.column, 10) || 0;
      const orderDirection = req.query.order?.[0]?.dir || 'desc';

      // Column mapping for sorting
      const columns = ['createdAt', 'value', 'description', 'active'];
      const sortBy = orderColumnIndex >= 0 && orderColumnIndex < columns.length ? columns[orderColumnIndex] : 'createdAt';

      // Calculate page from start and length
      const page = Math.floor(start / length) + 1;

      const historyResult = await TransferRate.getHistory({
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
        `${TransferRate.formatValue(rate.get('value'))}%`,
        rate.get('description') || 'Sin descripción',
        rate.get('active')
          ? '<span class="badge bg-success">Activo</span>'
          : '<span class="badge bg-secondary">Inactivo</span>',
      ]);

      res.json({
        draw,
        recordsTotal: historyResult.pagination.total,
        recordsFiltered: historyResult.pagination.total,
        data: formattedData,
      });
    } catch (error) {
      logger.error('Error in TransferRateController.getHistory:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve transfer rate history',
        details: error.message,
      });
    }
  }

  /**
   * Get current active transfer rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current transfer rate.
   * @example
   * // GET /api/transfer-rates/current
   * // Returns current active transfer rate
   */
  async getCurrent(req, res) {
    try {
      const currentRate = await TransferRate.getCurrentTransferRate();

      if (!currentRate) {
        return res.status(404).json({
          success: false,
          error: 'No active transfer rate found',
        });
      }

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          value: currentRate.get('value'),
          formatted: TransferRate.formatValue(currentRate.get('value')),
          description: currentRate.get('description'),
          active: currentRate.get('active'),
          createdAt: currentRate.get('createdAt'),
          createdBy: currentRate.get('createdBy')?.get('email') || null,
        },
      });
    } catch (error) {
      logger.error('Error in TransferRateController.getCurrent:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve current transfer rate',
        details: error.message,
      });
    }
  }

  /**
   * Get transfer rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with transfer rate details.
   * @example
   * // GET /api/transfer-rates/:id
   * // Returns specific transfer rate by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      const rate = await TransferRate.getById(id);

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Transfer rate not found',
        });
      }

      res.json({
        success: true,
        data: {
          id: rate.id,
          value: rate.get('value'),
          formatted: TransferRate.formatValue(rate.get('value')),
          description: rate.get('description'),
          active: rate.get('active'),
          createdAt: rate.get('createdAt'),
          createdBy: rate.get('createdBy')?.get('email') || null,
        },
      });
    } catch (error) {
      logger.error('Error in TransferRateController.getById:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve transfer rate',
        details: error.message,
      });
    }
  }

  /**
   * Soft delete transfer rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response confirming deletion.
   * @example
   * // DELETE /api/transfer-rates/:id
   * // Soft deletes transfer rate (sets exists: false)
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      const deleted = await TransferRate.softDelete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Transfer rate not found',
        });
      }

      logger.info('Transfer rate deleted via API', {
        rateId: id,
        userId: req.user?.id,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });

      res.json({
        success: true,
        message: 'Transfer rate deleted successfully',
      });
    } catch (error) {
      logger.error('Error in TransferRateController.delete:', error);

      res.status(500).json({
        success: false,
        error: 'Failed to delete transfer rate',
        details: error.message,
      });
    }
  }
}

module.exports = new TransferRateController();
