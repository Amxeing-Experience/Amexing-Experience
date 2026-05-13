const GreeterRate = require('../../../domain/models/GreeterRate');
const logger = require('../../../infrastructure/logger');

/**
 * GreeterRate API Controller.
 *
 * Handles API endpoints for greeter rate management:
 * - DataTables server-side processing for history
 * - CRUD operations for greeter rates
 * - Current rate retrieval with auto-creation of default rate
 * - Formula configuration and simulation.
 *
 * Created by Denisse Maldonado.
 */
class GreeterRateController {
  /**
   * Get greeter rate history for DataTables
   * Supports server-side processing with sorting, pagination, and search.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with greeter rate history.
   * @example
   * // GET /api/greeter-rate/history?draw=1&start=0&length=10
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
      const historyResult = await GreeterRate.getHistory(page, length);

      // Format data for DataTables (4 columns to match the pattern)
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
      logger.error('Error getting greeter rate history:', error);
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
   * Get current active greeter rate.
   * Auto-creates default rate (760 base + 640 hourly) if none exists.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with current greeter rate.
   * @example
   * // GET /api/greeter-rate/current
   * // Returns current active greeter rate
   */
  async getCurrent(req, res) {
    try {
      // Ensure default rate exists, create if not
      await GreeterRate.createDefaultIfNotExists();

      // Get current rate
      const currentRate = await GreeterRate.getCurrentRate();

      if (!currentRate) {
        return res.status(404).json({
          success: false,
          error: 'No greeter rate found',
        });
      }

      const createdBy = currentRate.get('createdBy');

      res.json({
        success: true,
        data: {
          id: currentRate.id,
          basePrice: currentRate.get('basePrice'),
          hourlyRate: currentRate.get('hourlyRate'),
          effectiveDate: currentRate.get('effectiveDate'),
          notes: currentRate.get('notes'),
          active: currentRate.get('active'),
          formatted: currentRate.getFormattedValue(),
          createdBy: createdBy ? {
            id: createdBy.id,
            username: createdBy.get('username'),
            firstName: createdBy.get('firstName'),
            lastName: createdBy.get('lastName'),
          } : null,
          lastUpdated: currentRate.get('lastUpdated'),
          lastUpdatedBy: currentRate.get('lastUpdatedBy'),
        },
      });
    } catch (error) {
      logger.error('Error getting current greeter rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error loading current greeter rate',
      });
    }
  }

  /**
   * Get specific greeter rate by ID.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with greeter rate details.
   * @example
   * // GET /api/greeter-rate/:id
   * // Returns specific greeter rate
   */
  async getById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'ID parameter is required',
        });
      }

      const query = new Parse.Query(GreeterRate);
      query.include('createdBy');
      query.include('lastUpdatedBy');

      const rate = await query.get(id, { useMasterKey: true });

      if (!rate) {
        return res.status(404).json({
          success: false,
          error: 'Greeter rate not found',
        });
      }

      const createdBy = rate.get('createdBy');
      const lastUpdatedBy = rate.get('lastUpdatedBy');

      res.json({
        success: true,
        data: {
          id: rate.id,
          basePrice: rate.get('basePrice'),
          hourlyRate: rate.get('hourlyRate'),
          effectiveDate: rate.get('effectiveDate'),
          notes: rate.get('notes'),
          active: rate.get('active'),
          formatted: rate.getFormattedValue(),
          createdBy: createdBy ? {
            id: createdBy.id,
            username: createdBy.get('username'),
            firstName: createdBy.get('firstName'),
            lastName: createdBy.get('lastName'),
          } : null,
          lastUpdated: rate.get('lastUpdated'),
          lastUpdatedBy: lastUpdatedBy ? {
            id: lastUpdatedBy.id,
            username: lastUpdatedBy.get('username'),
            firstName: lastUpdatedBy.get('firstName'),
            lastName: lastUpdatedBy.get('lastName'),
          } : null,
        },
      });
    } catch (error) {
      logger.error('Error getting greeter rate by ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error loading greeter rate',
      });
    }
  }

  /**
   * Create new greeter rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with created greeter rate.
   * @example
   * // POST /api/greeter-rate
   * // Body: { basePrice: 760, hourlyRate: 640, effectiveDate: "2024-01-01", notes: "New rate" }
   */
  async create(req, res) {
    try {
      const {
        basePrice, hourlyRate, effectiveDate, notes,
      } = req.body;
      const { user } = req;

      // Validation
      if (!basePrice || basePrice <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Base price must be a positive number',
        });
      }

      if (!hourlyRate || hourlyRate <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Hourly rate must be a positive number',
        });
      }

      if (!effectiveDate) {
        return res.status(400).json({
          success: false,
          error: 'Effective date is required',
        });
      }

      // Validate effective date
      const parsedDate = new Date(effectiveDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid effective date format',
        });
      }

      // Create new rate
      const newRate = await GreeterRate.createRate(
        parseFloat(basePrice),
        parseFloat(hourlyRate),
        parsedDate,
        user,
        notes || ''
      );

      res.json({
        success: true,
        data: {
          id: newRate.id,
          basePrice: newRate.get('basePrice'),
          hourlyRate: newRate.get('hourlyRate'),
          effectiveDate: newRate.get('effectiveDate'),
          notes: newRate.get('notes'),
          active: newRate.get('active'),
          formatted: newRate.getFormattedValue(),
        },
        message: 'Greeter rate created successfully',
      });

      logger.info('Greeter rate created:', {
        id: newRate.id,
        basePrice: newRate.get('basePrice'),
        hourlyRate: newRate.get('hourlyRate'),
        userId: user.id,
      });
    } catch (error) {
      logger.error('Error creating greeter rate:', error);
      res.status(500).json({
        success: false,
        error: 'Error creating greeter rate',
      });
    }
  }

  /**
   * Get current formula configuration for greeter rates.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with formula configuration.
   * @example
   * // GET /api/greeter-rate/formula
   * // Returns current formula configuration
   */
  async getFormulaConfiguration(req, res) {
    try {
      const config = await GreeterRate.getFormulaConfiguration();

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error('Error getting greeter formula configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Error loading formula configuration',
      });
    }
  }

  /**
   * Update formula configuration for current active greeter rate.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with updated configuration.
   * @example
   * // PUT /api/greeter-rate/formula
   * // Body: { formulaComponents: [...], basePrice: 760, hourlyRate: 640, hasSpecialRounding: true }
   */
  async updateFormulaConfiguration(req, res) {
    try {
      const { user } = req;
      const {
        formulaComponents, basePrice, hourlyRate, hasSpecialRounding,
      } = req.body;

      // Validation
      if (basePrice !== undefined && (Number.isNaN(Number(basePrice)) || basePrice < 0)) {
        return res.status(400).json({
          success: false,
          error: 'Base price must be a valid non-negative number',
        });
      }

      if (hourlyRate !== undefined && (Number.isNaN(Number(hourlyRate)) || hourlyRate < 0)) {
        return res.status(400).json({
          success: false,
          error: 'Hourly rate must be a valid non-negative number',
        });
      }

      const config = {
        formulaComponents,
        basePrice,
        hourlyRate,
        hasSpecialRounding,
      };

      const updatedRate = await GreeterRate.updateFormulaConfiguration(config, user);
      const newConfig = await GreeterRate.getFormulaConfiguration();

      res.json({
        success: true,
        data: newConfig,
        message: 'Formula configuration updated successfully',
      });

      logger.info('Greeter formula configuration updated:', {
        rateId: updatedRate.id,
        basePrice: updatedRate.get('basePrice'),
        hourlyRate: updatedRate.get('hourlyRate'),
        userId: user.id,
      });
    } catch (error) {
      logger.error('Error updating greeter formula configuration:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error updating formula configuration',
      });
    }
  }

  /**
   * Simulate greeter cost calculation with given parameters.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Express response with simulation result.
   * @example
   * // POST /api/greeter-rate/simulate
   * // Body: { durationMinutes: 90, basePrice: 760, hourlyRate: 640 }
   */
  async simulateCalculation(req, res) {
    try {
      const {
        durationMinutes, basePrice, hourlyRate, formulaComponents, hasSpecialRounding,
      } = req.body;

      // Validation
      if (!durationMinutes || durationMinutes <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Duration must be a positive number',
        });
      }

      // Use custom values if provided, otherwise use current configuration
      let customBasePrice = basePrice;
      let customHourlyRate = hourlyRate;

      if (customBasePrice === undefined || customHourlyRate === undefined) {
        const config = await GreeterRate.getFormulaConfiguration();
        customBasePrice = customBasePrice || config.basePrice;
        customHourlyRate = customHourlyRate || config.hourlyRate;
      }

      // If custom formula components are provided, use them for simulation
      let result;
      if (formulaComponents && formulaComponents.length > 0) {
        try {
          // Validate components first
          GreeterRate.validateFormulaComponents(formulaComponents);

          // Evaluate custom formula
          const evaluation = GreeterRate.evaluateFormula(
            formulaComponents,
            durationMinutes,
            customBasePrice,
            customHourlyRate
          );

          let finalCost = evaluation.value;
          if (hasSpecialRounding !== false) {
            finalCost = GreeterRate.applySpecialRounding(evaluation.value);
          }

          result = {
            cost: finalCost,
            breakdown: {
              durationMinutes,
              durationHours: durationMinutes / 60,
              basePrice: customBasePrice,
              hourlyRate: customHourlyRate,
              formulaComponents,
              formulaString: evaluation.formula,
              hasSpecialRounding: hasSpecialRounding !== false,
              calculatedCost: evaluation.value,
              finalCost,
            },
          };
        } catch (formulaError) {
          return res.status(400).json({
            success: false,
            error: `Formula error: ${formulaError.message}`,
          });
        }
      } else {
        // Use standard calculation
        result = await GreeterRate.calculateCost(durationMinutes, customBasePrice, customHourlyRate);
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error simulating greeter calculation:', error);
      res.status(500).json({
        success: false,
        error: 'Error running simulation',
      });
    }
  }
}

module.exports = new GreeterRateController();
