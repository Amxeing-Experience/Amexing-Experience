/**
 * QuoteServicesState - Centralized state management for quote services.
 *
 * Replaces scattered global variables with a clean, predictable state container.
 * Provides reactive state updates with subscriber pattern for components.
 *
 * Benefits:
 * - Single source of truth for quote data
 * - Predictable state updates
 * - Easy debugging (state inspector)
 * - Component reactivity via subscriptions.
 * @module QuoteServicesState
 * @example
 * const state = new QuoteServicesState();
 *
 * // Subscribe to changes
 * state.subscribe('numberOfPeople', (newValue) => {
 *   console.log('People changed:', newValue);
 *   updateCapacityFilters(newValue);
 * });
 *
 * // Update state (triggers subscribers)
 * state.set('numberOfPeople', 10);
 */

class QuoteServicesState {
  /**
   * Create new state manager.
   * @param {object} initialState - Initial state values.
   * @example
   */
  constructor(initialState = {}) {
    // Core quote data
    this.state = {
      // Quote metadata
      quoteId: null,
      quoteData: null,
      rateId: null,
      rateName: null,
      numberOfPeople: 0,

      // Service items
      serviceItems: {
        days: [],
        subtotal: 0,
        iva: 0,
        total: 0,
      },

      // UI state
      isLoading: false,
      isSaving: false,
      lastSaved: null,
      hasUnsavedChanges: false,

      // Validation state
      validationErrors: [],

      // Override with initial state
      ...initialState,
    };

    // Subscriber registry: Map<stateKey, Set<callback>>
    this.subscribers = new Map();

    // State change history (for debugging)
    this.history = [];
    this.maxHistoryLength = 50;
  }

  /**
   * Get current state value.
   * @param {string} key - State key.
   * @returns {*} Current value.
   * @example
   * const people = state.get('numberOfPeople'); // 5
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Get entire state object (immutable copy).
   * @returns {object} State snapshot.
   * @example
   * const snapshot = state.getAll();
   * console.log(snapshot.numberOfPeople); // 5
   */
  getAll() {
    return { ...this.state };
  }

  /**
   * Set state value and notify subscribers.
   * @param {string} key - State key.
   * @param {*} value - New value.
   * @param {boolean} [silent] - Skip subscriber notifications.
   * @returns {void}
   * @example
   * state.set('numberOfPeople', 10); // Notifies subscribers
   * state.set('numberOfPeople', 10, true); // Silent update
   */
  set(key, value, silent = false) {
    const oldValue = this.state[key];

    // Only update if value actually changed
    if (oldValue === value) {
      return;
    }

    // Update state
    this.state[key] = value;

    // Track change in history
    this.addToHistory({
      timestamp: Date.now(),
      key,
      oldValue,
      newValue: value,
    });

    // Notify subscribers (unless silent)
    if (!silent) {
      this.notify(key, value, oldValue);
    }

    // Auto-mark as having unsaved changes (except for UI state)
    if (!silent && !this.isUIState(key)) {
      this.state.hasUnsavedChanges = true;
    }
  }

  /**
   * Update multiple state values at once.
   * @param {object} updates - Key-value pairs to update.
   * @param {boolean} [silent] - Skip subscriber notifications.
   * @returns {void}
   * @example
   * state.setMultiple({
   *   numberOfPeople: 10,
   *   rateName: 'Premium',
   *   isLoading: false
   * });
   */
  setMultiple(updates, silent = false) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value, silent);
    });
  }

  /**
   * Subscribe to state changes.
   * @param {string} key - State key to watch.
   * @param {Function} callback - Callback(newValue, oldValue).
   * @returns {Function} Unsubscribe function.
   * @example
   * const unsubscribe = state.subscribe('numberOfPeople', (newVal, oldVal) => {
   *   console.log(`Changed from ${oldVal} to ${newVal}`);
   * });
   *
   * // Later: stop watching
   * unsubscribe();
   */
  subscribe(key, callback) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }

    this.subscribers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(key)?.delete(callback);
    };
  }

  /**
   * Notify all subscribers of a state change.
   * @param {string} key - State key that changed.
   * @param {*} newValue - New value.
   * @param {*} oldValue - Previous value.
   * @returns {void}
   * @private
   * @example
   */
  notify(key, newValue, oldValue) {
    const subscribers = this.subscribers.get(key);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    subscribers.forEach((callback) => {
      try {
        callback(newValue, oldValue);
      } catch (error) {
        console.error(`[QuoteServicesState] Subscriber error for ${key}:`, error);
      }
    });
  }

  /**
   * Check if key represents UI state (not data).
   * @param {string} key - State key.
   * @returns {boolean} True if UI state.
   * @private
   * @example
   */
  isUIState(key) {
    const uiKeys = ['isLoading', 'isSaving', 'lastSaved', 'hasUnsavedChanges'];
    return uiKeys.includes(key);
  }

  /**
   * Add entry to state change history.
   * @param {object} entry - History entry.
   * @returns {void}
   * @private
   * @example
   */
  addToHistory(entry) {
    this.history.push(entry);

    // Limit history size
    if (this.history.length > this.maxHistoryLength) {
      this.history.shift();
    }
  }

  /**
   * Get state change history.
   * @param {number} [limit] - Number of recent changes to return.
   * @returns {Array} Recent state changes.
   * @example
   * const recent = state.getHistory(5);
   * recent.forEach(change => {
   *   console.log(`${change.key}: ${change.oldValue} → ${change.newValue}`);
   * });
   */
  getHistory(limit = 10) {
    return this.history.slice(-limit);
  }

  /**
   * Reset state to initial values.
   * @param {boolean} [keepQuoteData] - Keep quote ID and data.
   * @returns {void}
   * @example
   * state.reset(); // Reset everything
   * state.reset(true); // Reset but keep quote ID/data
   */
  reset(keepQuoteData = false) {
    const preservedState = keepQuoteData ? {
      quoteId: this.state.quoteId,
      quoteData: this.state.quoteData,
      rateId: this.state.rateId,
      rateName: this.state.rateName,
    } : {};

    this.state = {
      quoteId: null,
      quoteData: null,
      rateId: null,
      rateName: null,
      numberOfPeople: 0,
      serviceItems: {
        days: [],
        subtotal: 0,
        iva: 0,
        total: 0,
      },
      isLoading: false,
      isSaving: false,
      lastSaved: null,
      hasUnsavedChanges: false,
      validationErrors: [],
      ...preservedState,
    };

    this.history = [];
  }

  /**
   * Mark state as saved (clear unsaved changes flag).
   * @returns {void}
   * @example
   * await saveToBackend();
   * state.markAsSaved();
   */
  markAsSaved() {
    this.setMultiple({
      hasUnsavedChanges: false,
      lastSaved: new Date().toISOString(),
    }, true); // Silent to avoid notifications
  }

  /**
   * Get service items day by index.
   * @param {number} dayIndex - Day index.
   * @returns {object | null} Day object or null.
   * @example
   * const day = state.getDay(0); // First day
   */
  getDay(dayIndex) {
    const days = this.state.serviceItems.days || [];
    return days[dayIndex] || null;
  }

  /**
   * Add new day to service items.
   * @param {object} dayData - Day data.
   * @returns {void}
   * @example
   * state.addDay({
   *   dayNumber: 1,
   *   dayTitle: 'Día 1',
   *   dayDate: '2024-12-25',
   *   subconcepts: [],
   *   dayTotal: 0
   * });
   */
  addDay(dayData) {
    const days = [...this.state.serviceItems.days];
    days.push(dayData);

    this.set('serviceItems', {
      ...this.state.serviceItems,
      days,
    });
  }

  /**
   * Update day by index.
   * @param {number} dayIndex - Day index.
   * @param {object} updates - Day property updates.
   * @returns {void}
   * @example
   * state.updateDay(0, { dayTitle: 'Arrival Day' });
   */
  updateDay(dayIndex, updates) {
    const days = [...this.state.serviceItems.days];

    if (!days[dayIndex]) {
      console.warn(`[QuoteServicesState] Day ${dayIndex} does not exist`);
      return;
    }

    days[dayIndex] = {
      ...days[dayIndex],
      ...updates,
    };

    this.set('serviceItems', {
      ...this.state.serviceItems,
      days,
    });
  }

  /**
   * Remove day by index.
   * @param {number} dayIndex - Day index to remove.
   * @returns {void}
   * @example
   * state.removeDay(0); // Remove first day
   */
  removeDay(dayIndex) {
    const days = this.state.serviceItems.days.filter((_, index) => index !== dayIndex);

    // Renumber remaining days
    days.forEach((day, index) => {
      day.dayNumber = index + 1;
    });

    this.set('serviceItems', {
      ...this.state.serviceItems,
      days,
    });
  }

  /**
   * Add subconcept to day.
   * @param {number} dayIndex - Day index.
   * @param {object} subconceptData - Subconcept data.
   * @returns {void}
   * @example
   * state.addSubconcept(0, {
   *   type: 'traslado',
   *   serviceId: 'service123',
   *   price: 2500
   * });
   */
  addSubconcept(dayIndex, subconceptData) {
    const day = this.getDay(dayIndex);
    if (!day) {
      console.warn(`[QuoteServicesState] Day ${dayIndex} does not exist`);
      return;
    }

    const subconcepts = [...(day.subconcepts || [])];
    subconcepts.push(subconceptData);

    this.updateDay(dayIndex, { subconcepts });
  }

  /**
   * Update subconcept.
   * @param {number} dayIndex - Day index.
   * @param {number} subconceptIndex - Subconcept index.
   * @param {object} updates - Subconcept property updates.
   * @returns {void}
   * @example
   * state.updateSubconcept(0, 0, { price: 3000 });
   */
  updateSubconcept(dayIndex, subconceptIndex, updates) {
    const day = this.getDay(dayIndex);
    if (!day) {
      console.warn(`[QuoteServicesState] Day ${dayIndex} does not exist`);
      return;
    }

    const subconcepts = [...(day.subconcepts || [])];
    if (!subconcepts[subconceptIndex]) {
      console.warn(`[QuoteServicesState] Subconcept ${subconceptIndex} does not exist in day ${dayIndex}`);
      return;
    }

    subconcepts[subconceptIndex] = {
      ...subconcepts[subconceptIndex],
      ...updates,
    };

    this.updateDay(dayIndex, { subconcepts });
  }

  /**
   * Remove subconcept.
   * @param {number} dayIndex - Day index.
   * @param {number} subconceptIndex - Subconcept index to remove.
   * @returns {void}
   * @example
   * state.removeSubconcept(0, 1); // Remove second subconcept from first day
   */
  removeSubconcept(dayIndex, subconceptIndex) {
    const day = this.getDay(dayIndex);
    if (!day) {
      console.warn(`[QuoteServicesState] Day ${dayIndex} does not exist`);
      return;
    }

    const subconcepts = (day.subconcepts || []).filter((_, index) => index !== subconceptIndex);
    this.updateDay(dayIndex, { subconcepts });
  }

  /**
   * Recalculate totals for all days and quote.
   * @returns {void}
   * @example
   * state.recalculateTotals(); // After adding/removing subconcepts
   */
  recalculateTotals() {
    const days = this.state.serviceItems.days || [];
    let subtotal = 0;

    // Calculate totals for each day
    const updatedDays = days.map((day) => {
      const daySubtotal = (day.subconcepts || []).reduce(
        (sum, subconcept) => sum + (parseFloat(subconcept.price) || 0),
        0
      );

      subtotal += daySubtotal;

      return {
        ...day,
        dayTotal: daySubtotal,
      };
    });

    // Calculate IVA (16%)
    const iva = subtotal * 0.16;
    const total = subtotal + iva;

    this.set('serviceItems', {
      days: updatedDays,
      subtotal: Math.round(subtotal * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      total: Math.round(total * 100) / 100,
    });
  }

  /**
   * Get state as JSON (for saving).
   * @returns {string} JSON string.
   * @example
   * const json = state.toJSON();
   * localStorage.setItem('quote-draft', json);
   */
  toJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  /**
   * Load state from JSON.
   * @param {string} json - JSON string.
   * @returns {void}
   * @example
   * const json = localStorage.getItem('quote-draft');
   * state.fromJSON(json);
   */
  fromJSON(json) {
    try {
      const parsed = JSON.parse(json);
      this.state = { ...this.state, ...parsed };
    } catch (error) {
      console.error('[QuoteServicesState] Failed to parse JSON:', error);
    }
  }

  /**
   * Create state inspector for debugging
   * Logs state changes to console.
   * @returns {Function} Cleanup function.
   * @example
   * const cleanup = state.createInspector();
   * // All state changes will be logged
   * // Later: cleanup();
   */
  createInspector() {
    const subscriptions = [];

    Object.keys(this.state).forEach((key) => {
      const unsubscribe = this.subscribe(key, (newVal, oldVal) => {
        console.log(`[State] ${key}:`, oldVal, '→', newVal);
      });
      subscriptions.push(unsubscribe);
    });

    return () => {
      subscriptions.forEach((unsub) => unsub());
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuoteServicesState;
}
