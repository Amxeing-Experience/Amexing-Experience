/**
 * GuideTransportRate Parse Object Model
 * Manages guide pricing rates for transportation services
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');

/**
 * GuideTransportRate class for managing guide transport pricing.
 */
class GuideTransportRate extends Parse.Object {
  constructor() {
    super('GuideTransportRate');
  }

  /**
   * Get current active guide transport rate.
   * @returns {Promise<GuideTransportRate|null>} Current rate or null.
   * @example
   * const currentRate = await GuideTransportRate.getCurrentRate();
   */
  static async getCurrentRate() {
    try {
      const query = new Parse.Query(GuideTransportRate);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.limit(1);
      // Don't use select to ensure all fields are fetched including arrays
      query.include('createdBy');

      const result = await query.first({ useMasterKey: true });

      // Debug logging to trace the issue
      if (result) {
        console.log('getCurrentRate - Retrieved rate:', {
          id: result.id,
          hasFormulaComponents: !!result.get('formulaComponents'),
          formulaComponentsLength: result.get('formulaComponents')?.length || 0,
          formulaVersion: result.get('formulaVersion'),
          roundTripMultiplier: result.get('roundTripMultiplier'),
        });
      }

      return result;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting current guide transport rate:', error);
      return null;
    }
  }

  /**
   * Create a new guide transport rate.
   * @param {number} value - Rate value in MXN.
   * @param {Date} effectiveDate - When the rate becomes effective.
   * @param {Parse.User} createdBy - User creating the rate.
   * @param {string} notes - Optional notes.
   * @returns {Promise<GuideTransportRate>} Created rate.
   * @example
   * const rate = await GuideTransportRate.createRate(450, new Date(), user, 'New rate');
   */
  static async createRate(value, effectiveDate, createdBy, notes = '') {
    try {
      // Deactivate any existing active rates
      const activeRatesQuery = new Parse.Query(GuideTransportRate);
      activeRatesQuery.equalTo('active', true);
      activeRatesQuery.equalTo('exists', true);

      const activeRates = await activeRatesQuery.find({ useMasterKey: true });

      // Set all existing rates to inactive using Promise.all for better performance
      const deactivatePromises = activeRates.map((rate) => {
        rate.set('active', false);
        return rate.save(null, { useMasterKey: true });
      });
      await Promise.all(deactivatePromises);

      // Create new rate
      const newRate = new GuideTransportRate();
      newRate.set('value', parseFloat(value));
      newRate.set('effectiveDate', new Date(effectiveDate));
      newRate.set('notes', notes || '');
      newRate.set('active', true);
      newRate.set('exists', true);
      newRate.set('createdBy', createdBy);

      // Set default formula configuration if not provided
      newRate.set('roundTripMultiplier', 2);
      newRate.set('minimumCharge', 0);
      newRate.set('formulaVersion', '1.0');

      const savedRate = await newRate.save(null, { useMasterKey: true });
      return savedRate;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating guide transport rate:', error);
      throw error;
    }
  }

  /**
   * Get rate history with pagination.
   * @param {number} page - Page number (0-based).
   * @param {number} limit - Number of items per page.
   * @returns {Promise<{data: Array, total: number}>} Paginated results.
   * @example
   * const history = await GuideTransportRate.getHistory(0, 10);
   */
  static async getHistory(page = 0, limit = 10) {
    try {
      const query = new Parse.Query(GuideTransportRate);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.include('createdBy');
      query.skip(page * limit);
      query.limit(limit);

      const results = await query.find({ useMasterKey: true });

      // Get total count
      const countQuery = new Parse.Query(GuideTransportRate);
      countQuery.equalTo('exists', true);
      const total = await countQuery.count({ useMasterKey: true });

      return {
        data: results,
        total,
      };
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting guide transport rate history:', error);
      throw error;
    }
  }

  /**
   * Create default rate if none exists.
   * @returns {Promise<GuideTransportRate|null>} Created default rate or null if already exists.
   * @example
   * const defaultRate = await GuideTransportRate.createDefaultIfNotExists();
   */
  static async createDefaultIfNotExists() {
    try {
      const currentRate = await GuideTransportRate.getCurrentRate();

      if (!currentRate) {
        // Create default rate of 400 MXN
        const defaultUser = (await new Parse.Query(Parse.User).equalTo('username', 'system').first({ useMasterKey: true })) || null;

        const defaultRate = await GuideTransportRate.createRate(
          400.0,
          new Date(),
          defaultUser,
          'Tarifa por defecto creada automáticamente'
        );

        // Use logger instead of console for production
        const logger = require('../../infrastructure/logger');
        logger.info('✅ Default guide transport rate created:', { value: 400, currency: 'MXN' });
        return defaultRate;
      }

      return null;
    } catch (error) {
      // Use logger instead of console for production
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating default guide transport rate:', error);
      throw error;
    }
  }

  /**
   * Get current formula configuration.
   * @returns {Promise<object>} Current formula configuration.
   * @example
   * const config = await GuideTransportRate.getFormulaConfiguration();
   */
  static async getFormulaConfiguration() {
    try {
      const currentRate = await GuideTransportRate.getCurrentRate();

      if (currentRate) {
        // Check if we have the new formula components structure
        const formulaComponents = currentRate.get('formulaComponents');

        // Debug logging
        console.log('getFormulaConfiguration - Formula data:', {
          hasComponents: !!formulaComponents,
          componentsLength: formulaComponents?.length || 0,
          firstComponent: formulaComponents?.[0],
          formulaVersion: currentRate.get('formulaVersion'),
        });

        if (formulaComponents && formulaComponents.length > 0) {
          return {
            formulaComponents,
            minimumCharge: currentRate.get('minimumCharge') || 0,
            formulaVersion: currentRate.get('formulaVersion') || '2.0',
            // Keep legacy fields for backward compatibility
            roundTripMultiplier: currentRate.get('roundTripMultiplier') || 2,
          };
        }

        // Legacy format - convert to new structure
        const multiplier = currentRate.get('roundTripMultiplier') || 2;
        return {
          formulaComponents: GuideTransportRate.getDefaultFormulaComponents(multiplier),
          minimumCharge: currentRate.get('minimumCharge') || 0,
          formulaVersion: currentRate.get('formulaVersion') || '1.0',
          roundTripMultiplier: multiplier,
        };
      }

      // Return defaults if no rate exists
      return {
        formulaComponents: GuideTransportRate.getDefaultFormulaComponents(),
        minimumCharge: 0,
        formulaVersion: '2.0',
        roundTripMultiplier: 2,
      };
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting formula configuration:', error);
      throw error;
    }
  }

  /**
   * Update formula configuration for current active rate.
   * @param {object} config - Formula configuration object.
   * @param {Array} config.formulaComponents - Array of formula components.
   * @param {number} config.minimumCharge - Minimum charge amount.
   * @param {number} config.roundTripMultiplier - Legacy: Round trip multiplier.
   * @param {Parse.User} updatedBy - User updating the configuration.
   * @returns {Promise<GuideTransportRate>} Updated rate object.
   * @example
   * const updated = await GuideTransportRate.updateFormulaConfiguration({
   *   formulaComponents: [{type: 'duration_hours', operator: '*'}, ...],
   *   minimumCharge: 100
   * }, user);
   */
  static async updateFormulaConfiguration(config, updatedBy) {
    try {
      const currentRate = await GuideTransportRate.getCurrentRate();

      if (!currentRate) {
        throw new Error('No active rate found to update formula configuration');
      }

      // Validate formula components if provided
      if (config.formulaComponents) {
        GuideTransportRate.validateFormulaComponents(config.formulaComponents);
        currentRate.set('formulaComponents', config.formulaComponents);
        currentRate.set('formulaVersion', '2.0'); // New version for component-based formula
      } else if (config.roundTripMultiplier !== undefined) {
        // Legacy update - convert to components
        const multiplier = parseFloat(config.roundTripMultiplier) || 2;
        currentRate.set('formulaComponents', GuideTransportRate.getDefaultFormulaComponents(multiplier));
        currentRate.set('roundTripMultiplier', multiplier);
        currentRate.set('formulaVersion', '2.0');
      }

      // Update other configuration
      if (config.minimumCharge !== undefined) {
        currentRate.set('minimumCharge', parseFloat(config.minimumCharge) || 0);
      }

      currentRate.set('lastUpdated', new Date());
      currentRate.set('lastUpdatedBy', updatedBy);

      const updatedRate = await currentRate.save(null, { useMasterKey: true });

      // Debug logging to confirm save
      console.log('updateFormulaConfiguration - Saved formula:', {
        id: updatedRate.id,
        formulaComponentsLength: updatedRate.get('formulaComponents')?.length || 0,
        formulaVersion: updatedRate.get('formulaVersion'),
        minimumCharge: updatedRate.get('minimumCharge'),
      });

      // Fetch the rate again to verify it was saved correctly
      const verifyQuery = new Parse.Query(GuideTransportRate);
      verifyQuery.equalTo('objectId', updatedRate.id);
      const verifiedRate = await verifyQuery.first({ useMasterKey: true });

      if (verifiedRate) {
        console.log('updateFormulaConfiguration - Verified saved data:', {
          id: verifiedRate.id,
          hasFormulaComponents: !!verifiedRate.get('formulaComponents'),
          formulaComponentsLength: verifiedRate.get('formulaComponents')?.length || 0,
          firstComponent: verifiedRate.get('formulaComponents')?.[0],
        });
      }

      return updatedRate;
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error updating formula configuration:', error);
      throw error;
    }
  }

  /**
   * Calculate guide transport cost using current formula.
   * @param {number} durationMinutes - Duration in minutes.
   * @param {number} customRate - Optional custom rate (uses current if not provided).
   * @returns {Promise<object>} Calculation result with cost and breakdown.
   * @example
   * const result = await GuideTransportRate.calculateCost(30);
   */
  static async calculateCost(durationMinutes, customRate = null) {
    try {
      const config = await GuideTransportRate.getFormulaConfiguration();
      const currentRate = customRate || (await GuideTransportRate.getCurrentRate());
      const rate = customRate || (currentRate ? currentRate.get('value') : 400);

      let calculatedCost;
      let formulaString;

      // Check if we have component-based formula
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        const result = GuideTransportRate.evaluateFormula(
          config.formulaComponents,
          durationMinutes,
          rate
        );
        calculatedCost = result.value;
        formulaString = result.formula;
      } else {
        // Legacy calculation
        const durationHours = durationMinutes / 60;
        calculatedCost = durationHours * config.roundTripMultiplier * rate;
        formulaString = `(${durationMinutes} ÷ 60) × ${config.roundTripMultiplier} × ${rate}`;
      }

      // Apply minimum charge if configured
      const finalCost = Math.max(calculatedCost, config.minimumCharge);

      return {
        cost: finalCost,
        breakdown: {
          durationMinutes,
          durationHours: durationMinutes / 60,
          rate,
          formulaComponents: config.formulaComponents,
          formulaString,
          minimumCharge: config.minimumCharge,
          calculatedCost,
          finalCost,
        },
      };
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error calculating guide transport cost:', error);
      throw error;
    }
  }

  /**
   * Get default formula components.
   * @param {number} multiplier - Optional multiplier value (default: 2).
   * @returns {Array} Default formula components.
   * @example
   */
  static getDefaultFormulaComponents(multiplier = 2) {
    return [
      {
        type: 'duration_hours',
        label: 'Duración (horas)',
        id: 'comp_1',
      },
      {
        type: 'operator',
        value: '*',
        label: '×',
        id: 'op_1',
      },
      {
        type: 'fixed',
        value: multiplier,
        label: `${multiplier} (viaje redondo)`,
        editable: true,
        id: 'comp_2',
      },
      {
        type: 'operator',
        value: '*',
        label: '×',
        id: 'op_2',
      },
      {
        type: 'rate',
        label: 'Tarifa guía',
        id: 'comp_3',
      },
    ];
  }

  /**
   * Validate formula components.
   * @param {Array} components - Formula components to validate.
   * @throws {Error} If validation fails.
   * @example
   */
  static validateFormulaComponents(components) {
    if (!Array.isArray(components) || components.length === 0) {
      throw new Error('Formula components must be a non-empty array');
    }

    let expectOperator = false;
    const validTypes = ['duration_minutes', 'duration_hours', 'rate', 'fixed', 'operator', 'parenthesis'];
    const validOperators = ['+', '-', '*', '/'];

    for (let i = 0; i < components.length; i++) {
      const comp = components[i];

      if (!comp.type || !validTypes.includes(comp.type)) {
        throw new Error(`Invalid component type: ${comp.type}`);
      }

      if (comp.type === 'operator') {
        if (!expectOperator) {
          throw new Error('Unexpected operator in formula');
        }
        if (!validOperators.includes(comp.value)) {
          throw new Error(`Invalid operator: ${comp.value}`);
        }
        expectOperator = false;
      } else if (comp.type === 'parenthesis') {
        // Handle parenthesis validation
        if (comp.value !== '(' && comp.value !== ')') {
          throw new Error('Invalid parenthesis');
        }
      } else {
        // It's a value component
        if (expectOperator && i > 0) {
          throw new Error('Expected operator between values');
        }
        if (comp.type === 'fixed' && (Number.isNaN(Number(comp.value)) || comp.value === null)) {
          throw new Error('Fixed value must be a number');
        }
        expectOperator = true;
      }
    }

    if (!expectOperator && components[components.length - 1].type !== 'parenthesis') {
      throw new Error('Formula cannot end with an operator');
    }
  }

  /**
   * Evaluate formula with given values.
   * @param {Array} components - Formula components.
   * @param {number} durationMinutes - Duration in minutes.
   * @param {number} rate - Guide rate.
   * @returns {object} Evaluation result with value and formula string.
   * @example
   */
  static evaluateFormula(components, durationMinutes, rate) {
    let formulaString = '';
    let expression = '';

    const values = {
      duration_minutes: durationMinutes,
      duration_hours: durationMinutes / 60,
      rate,
    };

    for (const comp of components) {
      if (comp.type === 'operator') {
        expression += ` ${comp.value} `;
        formulaString += ` ${comp.label || comp.value} `;
      } else if (comp.type === 'parenthesis') {
        expression += comp.value;
        formulaString += comp.value;
      } else if (comp.type === 'fixed') {
        expression += comp.value;
        formulaString += comp.value;
      } else if (values[comp.type] !== undefined) {
        expression += values[comp.type];
        formulaString += `${values[comp.type]}`;
      }
    }

    // Safely evaluate the expression
    let result;
    try {
      // Use math expression parser to safely evaluate without eval
      // eslint-disable-next-line no-new-func
      result = new Function(`return ${expression}`)();
      // Note: In production, consider using a proper math expression parser library
      // like math.js or expr-eval for better security
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error evaluating formula expression:', error);
      throw new Error('Invalid formula expression');
    }

    return {
      value: result,
      formula: formulaString.trim(),
      expression: expression.trim(),
    };
  }

  /**
   * Format rate value for display.
   * @returns {string} Formatted rate.
   * @example
   * const formattedValue = rate.getFormattedValue(); // "$400.00 MXN"
   */
  getFormattedValue() {
    const value = this.get('value') || 0;
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(value);
  }
}

// Register the subclass
Parse.Object.registerSubclass('GuideTransportRate', GuideTransportRate);

module.exports = GuideTransportRate;
