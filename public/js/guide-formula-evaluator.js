/**
 * Generic Guide Formula Evaluator Module
 * Provides a centralized way to calculate guide costs using configurable formulas
 * Can be used across all pages that need guide cost calculations
 * Created by Denisse Maldonado
 */

(function(window) {
  'use strict';

  const GuideFormulaEvaluator = {
    // Cache for formula configuration
    formulaConfig: null,
    
    // Cache for guide rate
    guideRate: null,
    
    // Loading state
    isLoading: false,
    
    // Ready promise that resolves when formula is loaded
    readyPromise: null,
    _readyResolve: null,
    
    /**
     * Get access token from localStorage or sessionStorage
     */
    getAccessToken() {
      return localStorage.getItem('accessToken') || 
             sessionStorage.getItem('accessToken') || 
             (typeof getAccessToken === 'function' ? getAccessToken() : null);
    },
    
    /**
     * Check if the formula is ready
     * @returns {Promise} Resolves when formula is loaded
     */
    ready() {
      if (this.formulaConfig !== null) {
        return Promise.resolve();
      }
      return this.readyPromise || this.loadFormula();
    },
    
    /**
     * Load formula configuration from API
     * @returns {Promise<Object>} Formula configuration
     */
    async loadFormula() {
      // Return cached config if available
      if (this.formulaConfig !== null) {
        return this.formulaConfig;
      }
      
      // Prevent duplicate requests
      if (this.isLoading) {
        // Return the existing ready promise
        return this.readyPromise;
      }
      
      this.isLoading = true;
      
      // Create ready promise if not exists
      if (!this.readyPromise) {
        this.readyPromise = new Promise(resolve => {
          this._readyResolve = resolve;
        });
      }
      
      try {
        const response = await fetch('/api/guide-transport-rate/formula', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.getAccessToken()}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.config) {
            this.formulaConfig = result.config;
            console.log('✅ Guide formula configuration loaded:', this.formulaConfig);
            
            // Log if we have custom formula components
            if (result.config.formulaComponents && result.config.formulaComponents.length > 0) {
              console.log('📊 Using custom formula with', result.config.formulaComponents.length, 'components');
            } else {
              console.log('📊 Using simple formula with multiplier:', result.config.roundTripMultiplier || 2);
            }
            
            if (this._readyResolve) {
              this._readyResolve();
              this._readyResolve = null;
            }
            return this.formulaConfig;
          }
        }
        
        // Use default configuration if API fails
        this.formulaConfig = {
          roundTripMultiplier: 2,
          minimumCharge: 0,
          formulaVersion: '1.0'
        };
        console.warn('⚠️ Using default formula configuration');
        if (this._readyResolve) {
          this._readyResolve();
          this._readyResolve = null;
        }
        return this.formulaConfig;
        
      } catch (error) {
        console.error('Error loading formula configuration:', error);
        // Use default configuration on error
        this.formulaConfig = {
          roundTripMultiplier: 2,
          minimumCharge: 0,
          formulaVersion: '1.0'
        };
        if (this._readyResolve) {
          this._readyResolve();
          this._readyResolve = null;
        }
        return this.formulaConfig;
      } finally {
        this.isLoading = false;
      }
    },
    
    /**
     * Load current guide rate from API
     * @returns {Promise<number>} Guide rate value
     */
    async loadGuideRate() {
      // Return cached rate if available
      if (this.guideRate !== null) {
        return this.guideRate;
      }
      
      try {
        const response = await fetch('/api/guide-transport-rate/current', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.getAccessToken()}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            this.guideRate = result.data.value || 400;
            console.log('✅ Guide rate loaded:', this.guideRate);
            return this.guideRate;
          }
        }
        
        // Use default rate if API fails
        this.guideRate = 400;
        console.warn('⚠️ Using default guide rate: 400');
        return this.guideRate;
        
      } catch (error) {
        console.error('Error loading guide rate:', error);
        this.guideRate = 400;
        return this.guideRate;
      }
    },
    
    /**
     * Evaluate formula components to calculate cost
     * @param {Array} components - Formula components array
     * @param {number} durationMinutes - Duration in minutes
     * @param {number} rate - Guide hourly rate
     * @returns {number} Calculated cost
     */
    evaluateComponents(components, durationMinutes, rate) {
      if (!components || components.length === 0) {
        // Fallback to simple formula
        const durationHours = durationMinutes / 60;
        return durationHours * 2 * rate;
      }
      
      let expression = '';
      const values = {
        duration_minutes: durationMinutes,
        duration_hours: durationMinutes / 60,
        rate: rate
      };
      
      // Build expression from components
      for (const comp of components) {
        if (comp.type === 'operator') {
          expression += ` ${comp.value} `;
        } else if (comp.type === 'parenthesis') {
          expression += comp.value;
        } else if (comp.type === 'fixed') {
          expression += comp.value;
        } else if (values[comp.type] !== undefined) {
          expression += values[comp.type];
        }
      }
      
      // Safely evaluate the expression
      try {
        // Use Function constructor for safe evaluation
        const result = new Function('return ' + expression)();
        return result || 0;
      } catch (error) {
        console.error('Error evaluating formula expression:', error);
        console.error('Expression:', expression);
        // Fallback to simple formula on error
        const durationHours = durationMinutes / 60;
        return durationHours * 2 * rate;
      }
    },
    
    /**
     * Calculate guide cost using the current formula
     * @param {number} durationMinutes - Duration in minutes
     * @param {number} customRate - Optional custom rate (uses current if not provided)
     * @returns {Promise<number>} Calculated guide cost
     */
    async calculateCost(durationMinutes, customRate = null) {
      // Ensure we have the formula configuration
      const config = await this.loadFormula();
      
      // Use custom rate or load current rate
      let rate = customRate;
      if (rate === null || rate === undefined) {
        rate = await this.loadGuideRate();
      }
      
      // Validate inputs
      if (!durationMinutes || durationMinutes <= 0) return 0;
      if (!rate || rate <= 0) return 0;
      
      let calculatedCost;
      
      // Check if we have advanced formula components
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        // Use advanced formula
        calculatedCost = this.evaluateComponents(config.formulaComponents, durationMinutes, rate);
        console.log(`📊 Advanced formula: ${durationMinutes} min @ $${rate}/hr = $${calculatedCost}`);
      } else {
        // Use simple formula with multiplier
        const durationHours = durationMinutes / 60;
        const multiplier = config.roundTripMultiplier || 2;
        calculatedCost = durationHours * multiplier * rate;
        console.log(`📊 Simple formula: (${durationMinutes}/60) × ${multiplier} × ${rate} = $${calculatedCost}`);
      }
      
      // Apply minimum charge if configured
      const minimumCharge = config.minimumCharge || 0;
      const finalCost = Math.max(calculatedCost, minimumCharge);
      
      if (minimumCharge > 0 && finalCost > calculatedCost) {
        console.log(`📊 Minimum charge applied: $${minimumCharge}`);
      }
      
      return finalCost;
    },
    
    /**
     * Clear cached data (useful when formula is updated)
     */
    clearCache() {
      this.formulaConfig = null;
      this.guideRate = null;
      this.isLoading = false;
      this.readyPromise = null;
      this._readyResolve = null;
      console.log('🔄 Guide formula cache cleared');
    },
    
    /**
     * Get a formatted string describing the current formula
     * @returns {Promise<string>} Formula description
     */
    async getFormulaDescription() {
      const config = await this.loadFormula();
      
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        let formula = '';
        config.formulaComponents.forEach(comp => {
          if (comp.type === 'operator') {
            formula += ` ${comp.label || comp.value} `;
          } else if (comp.type === 'duration_minutes') {
            formula += 'duración_minutos';
          } else if (comp.type === 'duration_hours') {
            formula += 'duración_horas';
          } else if (comp.type === 'rate') {
            formula += 'tarifa_guía';
          } else if (comp.type === 'fixed') {
            formula += comp.value;
          } else if (comp.type === 'parenthesis') {
            formula += comp.value;
          }
        });
        return `Fórmula: ${formula.trim()}`;
      } else {
        const multiplier = config.roundTripMultiplier || 2;
        return `Fórmula: duración_horas × ${multiplier} × tarifa_guía`;
      }
    }
  };
  
  // Export to global scope
  window.GuideFormulaEvaluator = GuideFormulaEvaluator;
  
  // Auto-initialize on DOM ready if jQuery is available
  if (typeof jQuery !== 'undefined') {
    jQuery(document).ready(function() {
      // Pre-load formula configuration
      GuideFormulaEvaluator.loadFormula().then(() => {
        console.log('✅ Guide formula evaluator ready');
      });
    });
  }
  
})(window);