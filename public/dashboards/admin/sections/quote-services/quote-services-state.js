/**
 * QuoteServicesState - Centralized state management with reactivity
 * Provides subscribe/notify pattern for reactive state updates
 *
 * @class QuoteServicesState
 */
class QuoteServicesState {
  /**
   * Create a new state manager
   * @param {Object} initialState - Initial state values
   */
  constructor(initialState = {}) {
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
        total: 0
      },
      isLoading: false,
      isSaving: false,
      hasUnsavedChanges: false,
      ...initialState
    };

    // Subscribers for reactive updates
    this.subscribers = new Map();

    // History for debugging
    this.history = [];
    this.maxHistorySize = 50;
  }

  /**
   * Get state value by key
   * @param {string} key - State key
   * @returns {*} State value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Get all state
   * @returns {Object} Complete state object
   */
  getAll() {
    return { ...this.state };
  }

  /**
   * Set state value
   * @param {string} key - State key
   * @param {*} value - New value
   * @param {boolean} silent - If true, don't notify subscribers
   */
  set(key, value, silent = false) {
    const oldValue = this.state[key];

    // No change, skip
    if (oldValue === value) {
      return;
    }

    this.state[key] = value;

    // Add to history
    this.addToHistory({
      timestamp: Date.now(),
      key: key,
      oldValue: oldValue,
      newValue: value
    });

    // Notify subscribers
    if (!silent) {
      this.notify(key, value, oldValue);
    }
  }

  /**
   * Set multiple state values at once
   * @param {Object} updates - Object with key-value pairs to update
   * @param {boolean} silent - If true, don't notify subscribers
   */
  setMultiple(updates, silent = false) {
    for (const [key, value] of Object.entries(updates)) {
      this.set(key, value, silent);
    }
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {Function} callback - Callback function(newValue, oldValue)
   * @returns {Function} Unsubscribe function
   *
   * @example
   * const unsubscribe = quoteState.subscribe('numberOfPeople', (newVal, oldVal) => {
   *   console.log(`Changed from ${oldVal} to ${newVal}`);
   * });
   *
   * // Later: unsubscribe()
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
   * Notify subscribers of state change
   * @param {string} key - State key that changed
   * @param {*} newValue - New value
   * @param {*} oldValue - Old value
   */
  notify(key, newValue, oldValue) {
    const keySubscribers = this.subscribers.get(key);

    if (keySubscribers) {
      keySubscribers.forEach(callback => {
        try {
          callback(newValue, oldValue);
        } catch (error) {
          console.error(`[QuoteState] Error in subscriber for ${key}:`, error);
        }
      });
    }
  }

  /**
   * Add entry to history
   * @param {Object} entry - History entry
   */
  addToHistory(entry) {
    this.history.unshift(entry);

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Get state change history
   * @param {number} count - Number of recent changes to return
   * @returns {Array} Array of history entries
   */
  getHistory(count = 10) {
    return this.history.slice(0, count);
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Mark state as saved (clear unsaved changes flag)
   */
  markAsSaved() {
    this.set('hasUnsavedChanges', false);
  }

  /**
   * Mark state as having unsaved changes
   */
  markAsUnsaved() {
    this.set('hasUnsavedChanges', true);
  }

  /**
   * Create state inspector for debugging
   * Logs all state changes to console
   * @returns {Function} Cleanup function to stop inspection
   *
   * @example
   * const cleanup = quoteState.createInspector();
   * // ... make state changes (all logged to console) ...
   * cleanup(); // Stop logging
   */
  createInspector() {
    const unsubscribers = [];

    // Subscribe to all current state keys
    for (const key of Object.keys(this.state)) {
      const unsubscribe = this.subscribe(key, (newValue, oldValue) => {
        console.log(`[QuoteState] ${key} changed:`, {
          old: oldValue,
          new: newValue
        });
      });
      unsubscribers.push(unsubscribe);
    }

    // Return cleanup function
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }

  /**
   * Reset state to initial values
   * @param {Object} initialState - New initial state (optional)
   */
  reset(initialState = {}) {
    const oldState = { ...this.state };

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
        total: 0
      },
      isLoading: false,
      isSaving: false,
      hasUnsavedChanges: false,
      ...initialState
    };

    // Notify all subscribers of reset
    for (const key of Object.keys(this.state)) {
      if (oldState[key] !== this.state[key]) {
        this.notify(key, this.state[key], oldState[key]);
      }
    }

    this.clearHistory();
  }

  /**
   * Add a new day to service items
   * @param {Object} day - Day object to add
   */
  addDay(day) {
    const serviceItems = { ...this.state.serviceItems };
    serviceItems.days.push(day);
    this.set('serviceItems', serviceItems);
    this.markAsUnsaved();
  }

  /**
   * Update a day in service items
   * @param {number} dayIndex - Index of day to update
   * @param {Object} updates - Properties to update
   */
  updateDay(dayIndex, updates) {
    const serviceItems = { ...this.state.serviceItems };

    if (serviceItems.days[dayIndex]) {
      serviceItems.days[dayIndex] = {
        ...serviceItems.days[dayIndex],
        ...updates
      };
      this.set('serviceItems', serviceItems);
      this.markAsUnsaved();
    }
  }

  /**
   * Remove a day from service items
   * @param {number} dayIndex - Index of day to remove
   */
  removeDay(dayIndex) {
    const serviceItems = { ...this.state.serviceItems };
    serviceItems.days.splice(dayIndex, 1);
    this.set('serviceItems', serviceItems);
    this.markAsUnsaved();
  }

  /**
   * Add a subconcept to a day
   * @param {number} dayIndex - Index of day
   * @param {Object} subconcept - Subconcept object to add
   */
  addSubconcept(dayIndex, subconcept) {
    const serviceItems = { ...this.state.serviceItems };

    if (serviceItems.days[dayIndex]) {
      if (!serviceItems.days[dayIndex].subconcepts) {
        serviceItems.days[dayIndex].subconcepts = [];
      }
      serviceItems.days[dayIndex].subconcepts.push(subconcept);
      this.set('serviceItems', serviceItems);
      this.markAsUnsaved();
    }
  }

  /**
   * Update a subconcept in a day
   * @param {number} dayIndex - Index of day
   * @param {number} subconceptIndex - Index of subconcept
   * @param {Object} updates - Properties to update
   */
  updateSubconcept(dayIndex, subconceptIndex, updates) {
    const serviceItems = { ...this.state.serviceItems };

    if (serviceItems.days[dayIndex]?.subconcepts?.[subconceptIndex]) {
      serviceItems.days[dayIndex].subconcepts[subconceptIndex] = {
        ...serviceItems.days[dayIndex].subconcepts[subconceptIndex],
        ...updates
      };
      this.set('serviceItems', serviceItems);
      this.markAsUnsaved();
    }
  }

  /**
   * Remove a subconcept from a day
   * @param {number} dayIndex - Index of day
   * @param {number} subconceptIndex - Index of subconcept to remove
   */
  removeSubconcept(dayIndex, subconceptIndex) {
    const serviceItems = { ...this.state.serviceItems };

    if (serviceItems.days[dayIndex]?.subconcepts) {
      serviceItems.days[dayIndex].subconcepts.splice(subconceptIndex, 1);
      this.set('serviceItems', serviceItems);
      this.markAsUnsaved();
    }
  }

  /**
   * Recalculate totals for service items
   * Should be called after any price changes
   */
  recalculateTotals() {
    const serviceItems = { ...this.state.serviceItems };

    // Recalculate day totals
    serviceItems.days.forEach(day => {
      day.dayTotal = (day.subconcepts || []).reduce((sum, sub) => {
        return sum + (parseFloat(sub.price) || 0);
      }, 0);
    });

    // Recalculate overall totals
    serviceItems.subtotal = serviceItems.days.reduce((sum, day) => {
      return sum + (parseFloat(day.dayTotal) || 0);
    }, 0);

    // Calculate IVA (16%)
    serviceItems.iva = serviceItems.subtotal * 0.16;

    // Calculate total
    serviceItems.total = serviceItems.subtotal + serviceItems.iva;

    this.set('serviceItems', serviceItems);
  }
}

// Make available globally
window.QuoteServicesState = QuoteServicesState;
