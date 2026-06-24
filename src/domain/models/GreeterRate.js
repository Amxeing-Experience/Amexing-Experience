/**
 * GreeterRate Parse Object Model
 * Manages greeter pricing rates and formula configuration
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const { TtlCache } = require('../../infrastructure/cache/ttlCache');

// Caché del rate "actual" (cambia rara vez, se consulta en cada carga; cubre /current y /formula
// porque getFormulaConfiguration lee de getCurrentRate). Invalida en create/update.
const currentRateCache = new TtlCache();

/**
 * GreeterRate class for managing greeter pricing.
 */
class GreeterRate extends Parse.Object {
  constructor() {
    super('GreeterRate');
  }

  /**
   * Get current active greeter rate.
   * @returns {Promise<GreeterRate|null>} Current rate or null.
   * @example
   * const currentRate = await GreeterRate.getCurrentRate();
   */
  static async getCurrentRate() {
    try {
      const cached = currentRateCache.get();
      if (cached !== undefined) return cached;

      const query = new Parse.Query(GreeterRate);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.limit(1);
      query.include('createdBy');

      const result = await query.first({ useMasterKey: true });

      if (result) {
        console.log('getCurrentRate - Retrieved greeter rate:', {
          id: result.id,
          hasFormulaComponents: !!result.get('formulaComponents'),
          formulaComponentsLength: result.get('formulaComponents')?.length || 0,
          formulaVersion: result.get('formulaVersion'),
          basePrice: result.get('basePrice'),
          hourlyRate: result.get('hourlyRate'),
        });
      }

      return currentRateCache.set(result || null);
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting current greeter rate:', error);
      return null;
    }
  }

  /**
   * Create a new greeter rate.
   * @param {number} basePrice - Base price (default: 760 MXN).
   * @param {number} hourlyRate - Hourly rate (default: 640 MXN).
   * @param {Date} effectiveDate - When the rate becomes effective.
   * @param {Parse.User} createdBy - User creating the rate.
   * @param {string} notes - Optional notes.
   * @returns {Promise<GreeterRate>} Created rate.
   * @example
   * const rate = await GreeterRate.createRate(760, 640, new Date(), user, 'New rate');
   */
  static async createRate(basePrice, hourlyRate, effectiveDate, createdBy, notes = '') {
    try {
      // Deactivate any existing active rates
      const activeRatesQuery = new Parse.Query(GreeterRate);
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
      const newRate = new GreeterRate();
      newRate.set('basePrice', parseFloat(basePrice) || 760);
      newRate.set('hourlyRate', parseFloat(hourlyRate) || 640);
      newRate.set('effectiveDate', new Date(effectiveDate));
      newRate.set('notes', notes || '');
      newRate.set('active', true);
      newRate.set('exists', true);
      newRate.set('createdBy', createdBy);

      // Set default formula configuration
      newRate.set('formulaVersion', '1.0');
      newRate.set('hasSpecialRounding', true);

      const savedRate = await newRate.save(null, { useMasterKey: true });
      currentRateCache.clear(); // el rate actual cambió -> invalidar caché
      return savedRate;
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating greeter rate:', error);
      throw error;
    }
  }

  /**
   * Get rate history with pagination.
   * @param {number} page - Page number (0-based).
   * @param {number} limit - Number of items per page.
   * @returns {Promise<{data: Array, total: number}>} Paginated results.
   * @example
   * const history = await GreeterRate.getHistory(0, 10);
   */
  static async getHistory(page = 0, limit = 10) {
    try {
      const query = new Parse.Query(GreeterRate);
      query.equalTo('exists', true);
      query.descending('effectiveDate');
      query.include('createdBy');
      query.skip(page * limit);
      query.limit(limit);

      const results = await query.find({ useMasterKey: true });

      // Get total count
      const countQuery = new Parse.Query(GreeterRate);
      countQuery.equalTo('exists', true);
      const total = await countQuery.count({ useMasterKey: true });

      return {
        data: results,
        total,
      };
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting greeter rate history:', error);
      throw error;
    }
  }

  /**
   * Create default rate if none exists.
   * @returns {Promise<GreeterRate|null>} Created default rate or null if already exists.
   * @example
   * const defaultRate = await GreeterRate.createDefaultIfNotExists();
   */
  static async createDefaultIfNotExists() {
    try {
      const currentRate = await GreeterRate.getCurrentRate();

      if (!currentRate) {
        const defaultUser = (await new Parse.Query(Parse.User).equalTo('username', 'system').first({ useMasterKey: true })) || null;

        const defaultRate = await GreeterRate.createRate(
          760.0, // Base price
          640.0, // Hourly rate
          new Date(),
          defaultUser,
          'Tarifa por defecto creada automáticamente'
        );

        const logger = require('../../infrastructure/logger');
        logger.info('✅ Default greeter rate created:', { basePrice: 760, hourlyRate: 640, currency: 'MXN' });
        return defaultRate;
      }

      return null;
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error creating default greeter rate:', error);
      throw error;
    }
  }

  /**
   * Get current formula configuration.
   * @returns {Promise<object>} Current formula configuration.
   * @example
   * const config = await GreeterRate.getFormulaConfiguration();
   */
  static async getFormulaConfiguration() {
    try {
      const currentRate = await GreeterRate.getCurrentRate();

      if (currentRate) {
        const formulaComponents = currentRate.get('formulaComponents');

        console.log('getFormulaConfiguration - Greeter formula data:', {
          hasComponents: !!formulaComponents,
          componentsLength: formulaComponents?.length || 0,
          firstComponent: formulaComponents?.[0],
          formulaVersion: currentRate.get('formulaVersion'),
        });

        if (formulaComponents && formulaComponents.length > 0) {
          return {
            formulaComponents,
            basePrice: currentRate.get('basePrice') || 760,
            hourlyRate: currentRate.get('hourlyRate') || 640,
            hasSpecialRounding: currentRate.get('hasSpecialRounding') !== false,
            formulaVersion: currentRate.get('formulaVersion') || '2.0',
          };
        }

        // Legacy format - convert to new structure
        const basePrice = currentRate.get('basePrice') || 760;
        const hourlyRate = currentRate.get('hourlyRate') || 640;
        return {
          formulaComponents: GreeterRate.getDefaultFormulaComponents(basePrice, hourlyRate),
          basePrice,
          hourlyRate,
          hasSpecialRounding: currentRate.get('hasSpecialRounding') !== false,
          formulaVersion: currentRate.get('formulaVersion') || '1.0',
        };
      }

      // Return defaults if no rate exists
      return {
        formulaComponents: GreeterRate.getDefaultFormulaComponents(),
        basePrice: 760,
        hourlyRate: 640,
        hasSpecialRounding: true,
        formulaVersion: '2.0',
      };
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error getting greeter formula configuration:', error);
      throw error;
    }
  }

  /**
   * Update formula configuration for current active rate.
   * @param {object} config - Formula configuration object.
   * @param {Array} config.formulaComponents - Array of formula components.
   * @param {number} config.basePrice - Base price amount.
   * @param {number} config.hourlyRate - Hourly rate amount.
   * @param {boolean} config.hasSpecialRounding - Whether to apply special rounding.
   * @param {Parse.User} updatedBy - User updating the configuration.
   * @returns {Promise<GreeterRate>} Updated rate object.
   * @example
   * const updated = await GreeterRate.updateFormulaConfiguration({
   *   formulaComponents: [{type: 'basePrice', operator: '+', value: 760}, ...],
   *   basePrice: 760,
   *   hourlyRate: 640
   * }, user);
   */
  static async updateFormulaConfiguration(config, updatedBy) {
    try {
      const currentRate = await GreeterRate.getCurrentRate();

      if (!currentRate) {
        throw new Error('No active rate found to update formula configuration');
      }

      // Extract values for the new rate
      const newBasePrice = parseFloat(config.basePrice) || 760;
      const newHourlyRate = parseFloat(config.hourlyRate) || 640;
      let formulaComponents;

      // Validate and prepare formula components
      if (config.formulaComponents) {
        GreeterRate.validateFormulaComponents(config.formulaComponents);
        ({ formulaComponents } = config);
      } else {
        // Legacy update - convert to components
        formulaComponents = GreeterRate.getDefaultFormulaComponents(newBasePrice, newHourlyRate);
      }

      // Deactivate the current rate to preserve history
      currentRate.set('active', false);
      currentRate.set('lastUpdated', new Date());
      currentRate.set('lastUpdatedBy', updatedBy);
      await currentRate.save(null, { useMasterKey: true });

      console.log('updateFormulaConfiguration - Deactivated old rate:', {
        oldId: currentRate.id,
        oldBasePrice: currentRate.get('basePrice'),
        oldHourlyRate: currentRate.get('hourlyRate'),
      });

      // Create a new active rate with the updated configuration
      const newRate = new GreeterRate();
      newRate.set('basePrice', newBasePrice);
      newRate.set('hourlyRate', newHourlyRate);
      newRate.set('formulaComponents', formulaComponents);
      newRate.set('formulaVersion', '2.0');
      newRate.set('hasSpecialRounding', config.hasSpecialRounding !== undefined ? config.hasSpecialRounding : true);
      newRate.set('effectiveDate', new Date());
      newRate.set('currency', 'MXN');
      newRate.set('active', true);
      newRate.set('exists', true);
      newRate.set('createdBy', updatedBy);
      newRate.set('notes', 'Formula configuration updated');

      const savedNewRate = await newRate.save(null, { useMasterKey: true });
      currentRateCache.clear(); // la fórmula/rate actual cambió -> invalidar caché

      console.log('updateFormulaConfiguration - Created new rate:', {
        newId: savedNewRate.id,
        formulaComponentsLength: savedNewRate.get('formulaComponents')?.length || 0,
        formulaVersion: savedNewRate.get('formulaVersion'),
        basePrice: savedNewRate.get('basePrice'),
        hourlyRate: savedNewRate.get('hourlyRate'),
      });

      return savedNewRate;
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error updating greeter formula configuration:', error);
      throw error;
    }
  }

  /**
   * Calculate greeter cost using current formula with special rounding.
   * @param {number} durationMinutes - Duration in minutes.
   * @param {number} customBasePrice - Optional custom base price.
   * @param {number} customHourlyRate - Optional custom hourly rate.
   * @returns {Promise<object>} Calculation result with cost and breakdown.
   * @example
   * const result = await GreeterRate.calculateCost(90);
   */
  static async calculateCost(durationMinutes, customBasePrice = null, customHourlyRate = null) {
    try {
      const config = await GreeterRate.getFormulaConfiguration();
      const currentRate = await GreeterRate.getCurrentRate();

      const basePrice = customBasePrice || config.basePrice;
      const hourlyRate = customHourlyRate || config.hourlyRate;

      let calculatedCost;
      let formulaString;

      // Check if we have component-based formula
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        const result = GreeterRate.evaluateFormula(
          config.formulaComponents,
          durationMinutes,
          basePrice,
          hourlyRate
        );
        calculatedCost = result.value;
        formulaString = result.formula;
      } else {
        // Default greeter formula: basePrice + (hourlyRate * duration_hours)
        const durationHours = durationMinutes / 60;
        if (!durationHours || durationHours <= 0) {
          calculatedCost = basePrice;
        } else {
          calculatedCost = basePrice + (hourlyRate * durationHours);
        }
        formulaString = `${basePrice} + (${hourlyRate} × ${durationMinutes / 60})`;
      }

      // Apply special rounding if enabled
      let finalCost = calculatedCost;
      if (config.hasSpecialRounding) {
        finalCost = GreeterRate.applySpecialRounding(calculatedCost);
      }

      return {
        cost: finalCost,
        breakdown: {
          durationMinutes,
          durationHours: durationMinutes / 60,
          basePrice,
          hourlyRate,
          formulaComponents: config.formulaComponents,
          formulaString,
          hasSpecialRounding: config.hasSpecialRounding,
          calculatedCost,
          finalCost,
        },
      };
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error calculating greeter cost:', error);
      throw error;
    }
  }

  /**
   * Apply special rounding logic (same as used in quote-services-v2.js).
   * @param {number} rawPrice - Raw calculated price.
   * @returns {number} Rounded price.
   * @example
   */
  static applySpecialRounding(rawPrice) {
    const integerPart = Math.floor(rawPrice);
    const lastTwoDigits = integerPart % 100;

    if (lastTwoDigits === 0) return integerPart;
    if (lastTwoDigits < 50) return Math.floor(integerPart / 100) * 100;
    return Math.ceil(integerPart / 100) * 100;
  }

  /**
   * Get default formula components.
   * @param {number} basePrice - Base price value (default: 760).
   * @param {number} hourlyRate - Hourly rate value (default: 640).
   * @returns {Array} Default formula components.
   * @example
   */
  static getDefaultFormulaComponents(basePrice = 760, hourlyRate = 640) {
    return [
      {
        type: 'fixed',
        value: basePrice,
        label: `${basePrice} (precio base)`,
        editable: true,
        id: 'comp_1',
      },
      {
        type: 'operator',
        value: '+',
        label: '+',
        id: 'op_1',
      },
      {
        type: 'parenthesis',
        value: '(',
        label: '(',
        id: 'paren_1',
      },
      {
        type: 'fixed',
        value: hourlyRate,
        label: `${hourlyRate} (tarifa por hora)`,
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
        type: 'duration_hours',
        label: 'Duración (horas)',
        id: 'comp_3',
      },
      {
        type: 'parenthesis',
        value: ')',
        label: ')',
        id: 'paren_2',
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
    const validTypes = ['duration_minutes', 'duration_hours', 'basePrice', 'hourlyRate', 'fixed', 'operator', 'parenthesis'];
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
        if (comp.value !== '(' && comp.value !== ')') {
          throw new Error('Invalid parenthesis');
        }
      } else {
        if (expectOperator && i > 0 && components[i - 1].type !== 'parenthesis') {
          throw new Error('Expected operator between values');
        }
        if (comp.type === 'fixed' && (Number.isNaN(Number(comp.value)) || comp.value === null)) {
          throw new Error('Fixed value must be a number');
        }
        if (comp.type !== 'parenthesis') {
          expectOperator = true;
        }
      }
    }
  }

  /**
   * Evaluate formula with given values.
   * @param {Array} components - Formula components.
   * @param {number} durationMinutes - Duration in minutes.
   * @param {number} basePrice - Base price.
   * @param {number} hourlyRate - Hourly rate.
   * @returns {object} Evaluation result with value and formula string.
   * @example
   */
  static evaluateFormula(components, durationMinutes, basePrice, hourlyRate) {
    let formulaString = '';
    let expression = '';

    const values = {
      duration_minutes: durationMinutes,
      duration_hours: durationMinutes / 60,
      basePrice,
      hourlyRate,
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
      // eslint-disable-next-line no-new-func
      result = new Function(`return ${expression}`)();
    } catch (error) {
      const logger = require('../../infrastructure/logger');
      logger.error('Error evaluating greeter formula expression:', error);
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
   * const formattedValue = rate.getFormattedValue(); // "$760.00 MXN (base) + $640.00 MXN/hr"
   */
  getFormattedValue() {
    const basePrice = this.get('basePrice') || 760;
    const hourlyRate = this.get('hourlyRate') || 640;

    /**
     * Format a number as MXN currency.
     * @param {number} value - Numeric value to format.
     * @returns {string} Currency-formatted string.
     * @example
     *   formatCurrency(760); // '$760.00'
     */
    const formatCurrency = (value) => new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(value);

    return `${formatCurrency(basePrice)} (base) + ${formatCurrency(hourlyRate)}/hr`;
  }
}

// Register the subclass
Parse.Object.registerSubclass('GreeterRate', GreeterRate);

module.exports = GreeterRate;
