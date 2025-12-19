/**
 * ClientPrices Model.
 *
 * This model represents client-specific pricing overrides for services, tours, and experiences.
 * It allows for custom pricing per client, rate, and vehicle type combination.
 * @module domain/models/ClientPrices
 */

const Parse = require('parse/node');

/**
 * ClientPrices model class extending Parse.Object.
 * @class ClientPrices
 * @augments Parse.Object
 */
class ClientPrices extends Parse.Object {
  constructor() {
    super('ClientPrices');
  }

  /**
   * Initialize the ClientPrices with required fields.
   * @param {object} data - The data for initialization.
   * @param {string} data.clientPtr - Pointer to the AmexingUser object.
   * @param {string} data.ratePtr - Pointer to the Rate object.
   * @param {string} data.vehiclePtr - Pointer to the VehicleType object.
   * @param {string} data.itemType - Type of item: 'SERVICES', 'TOURS', or 'EXPERIENCES'.
   * @param {string} data.itemId - ObjectId of the service, tour, or experience.
   * @param {number} data.precio - Custom price for this combination.
   * @param {number} [data.basePrice] - Original base price for reference.
   * @param {string} [data.currency] - Currency code (default: 'MXN').
   * @param {boolean} [data.active] - Whether this price is active.
   * @param {boolean} [data.exists] - Logical deletion flag.
   * @param {Date} [data.valid_until] - When this price version expires (null = current active price).
   * @example
   */
  initialize(data) {
    if (!data.clientPtr) {
      throw new Error('Client pointer is required');
    }
    if (!data.ratePtr) {
      throw new Error('Rate pointer is required');
    }
    if (!data.vehiclePtr) {
      throw new Error('Vehicle pointer is required');
    }
    if (!data.itemType) {
      throw new Error('Item type is required');
    }
    if (!['SERVICES', 'TOURS', 'EXPERIENCES'].includes(data.itemType)) {
      throw new Error('Item type must be SERVICES, TOURS, or EXPERIENCES');
    }
    if (!data.itemId) {
      throw new Error('Item ID is required');
    }
    if (data.precio === undefined || data.precio === null) {
      throw new Error('Price is required');
    }

    // Set pointers
    const Client = Parse.Object.extend('AmexingUser');
    const clientPointer = new Client();
    clientPointer.id = data.clientPtr;
    this.set('clientPtr', clientPointer);

    const Rate = Parse.Object.extend('Rate');
    const ratePointer = new Rate();
    ratePointer.id = data.ratePtr;
    this.set('ratePtr', ratePointer);

    const VehicleType = Parse.Object.extend('VehicleType');
    const vehiclePointer = new VehicleType();
    vehiclePointer.id = data.vehiclePtr;
    this.set('vehiclePtr', vehiclePointer);

    // Set required fields
    this.set('itemType', data.itemType);
    this.set('itemId', data.itemId);
    this.set('precio', Number(data.precio));

    // Set optional fields
    if (data.basePrice !== undefined) {
      this.set('basePrice', Number(data.basePrice));
    }
    this.set('currency', data.currency || 'MXN');
    this.set('active', data.active !== false);
    this.set('exists', data.exists !== false);

    // Set metadata
    this.set('createdBy', data.createdBy || null);
    this.set('lastModifiedBy', data.lastModifiedBy || null);
    this.set('notes', data.notes || '');

    // Set versioning field
    this.set('valid_until', data.valid_until || null);
  }

  /**
   * Get formatted price.
   * @returns {string} Formatted price with currency.
   * @example
   */
  getFormattedPrice() {
    const price = this.get('precio');
    const currency = this.get('currency') || 'MXN';

    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
    }).format(price);
  }

  /**
   * Calculate discount percentage from base price.
   * @returns {number} Discount percentage.
   * @example
   */
  getDiscountPercentage() {
    const basePrice = this.get('basePrice');
    const customPrice = this.get('precio');

    if (!basePrice || basePrice === 0) {
      return 0;
    }

    const discount = ((basePrice - customPrice) / basePrice) * 100;
    return Math.round(discount * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if this price represents a discount.
   * @returns {boolean} True if custom price is lower than base price.
   * @example
   */
  isDiscount() {
    const basePrice = this.get('basePrice');
    const customPrice = this.get('precio');

    return basePrice && customPrice < basePrice;
  }

  /**
   * Check if this price represents a markup.
   * @returns {boolean} True if custom price is higher than base price.
   * @example
   */
  isMarkup() {
    const basePrice = this.get('basePrice');
    const customPrice = this.get('precio');

    return basePrice && customPrice > basePrice;
  }

  /**
   * Create or update client prices in batch.
   * @static
   * @param {string} clientId - Client object ID.
   * @param {string} itemType - Type of item (SERVICES, TOURS, EXPERIENCES).
   * @param {string} itemId - Item object ID.
   * @param {Array} prices - Array of price objects with ratePtr, vehiclePtr, precio.
   * @param {object} options - Parse options (e.g., useMasterKey).
   * @returns {Promise<Array>} Array of saved ClientPrices objects.
   * @example
   */
  static async saveClientPrices(clientId, itemType, itemId, prices, options = {}) {
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const objectsToSave = [];
    const objectsToDelete = [];

    // First, find existing active prices for this client and item (valid_until = null)
    const query = new Parse.Query(ClientPricesClass);
    query.equalTo('clientPtr', new (Parse.Object.extend('Client'))({ id: clientId }));
    query.equalTo('itemType', itemType);
    query.equalTo('itemId', itemId);
    query.equalTo('exists', true);
    query.doesNotExist('valid_until'); // Only get currently active prices (valid_until IS NULL)

    const existingPrices = await query.find(options);
    const existingMap = new Map();

    // Create a map of existing prices by rate and vehicle
    existingPrices.forEach((price) => {
      const key = `${price.get('ratePtr').id}_${price.get('vehiclePtr').id}`;
      existingMap.set(key, price);
    });

    // Process each new price with versioning
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    for (const priceData of prices) {
      const key = `${priceData.ratePtr}_${priceData.vehiclePtr}`;
      const existingPrice = existingMap.get(key);

      if (priceData.precio && priceData.precio > 0) {
        // If there's an existing price, version it before creating new one
        if (existingPrice) {
          // Set existing price's valid_until to today (making it historical)
          existingPrice.set('valid_until', today);
          existingPrice.set('lastModifiedBy', priceData.lastModifiedBy);
          objectsToSave.push(existingPrice);
          existingMap.delete(key); // Remove from map as it's been processed
        }

        // Always create a new price record (for versioning)
        const newPriceObject = new ClientPricesClass();
        newPriceObject.initialize({
          clientPtr: clientId,
          ratePtr: priceData.ratePtr,
          vehiclePtr: priceData.vehiclePtr,
          itemType,
          itemId,
          precio: priceData.precio,
          basePrice: priceData.basePrice,
          createdBy: priceData.createdBy,
          lastModifiedBy: priceData.lastModifiedBy,
          valid_until: null, // New price is current (no expiration)
        });
        objectsToSave.push(newPriceObject);
      } else if (existingPrice) {
        // Price is 0 or null, version the existing price with today's date
        existingPrice.set('valid_until', today);
        existingPrice.set('lastModifiedBy', priceData.lastModifiedBy);
        existingPrice.set('active', false); // Mark as inactive
        objectsToSave.push(existingPrice);
        existingMap.delete(key);
      }
    }

    // Mark any remaining existing prices as expired (they weren't in the update)
    existingMap.forEach((price) => {
      price.set('valid_until', today);
      price.set('active', false);
      objectsToSave.push(price); // Save to objectsToSave, not delete
    });

    // Save all changes
    if (objectsToSave.length > 0) {
      return await Parse.Object.saveAll(objectsToSave, options);
    }

    return [];
  }

  /**
   * Get client prices for a specific item.
   * @static
   * @param {string} clientId - Client object ID.
   * @param {string} itemType - Type of item (SERVICES, TOURS, EXPERIENCES).
   * @param {string} itemId - Item object ID.
   * @param {object} options - Parse options.
   * @returns {Promise<Array>} Array of ClientPrices objects.
   * @example
   */
  static async getClientPrices(clientId, itemType, itemId, options = {}) {
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const query = new Parse.Query(ClientPricesClass);

    query.equalTo('clientPtr', new (Parse.Object.extend('Client'))({ id: clientId }));
    query.equalTo('itemType', itemType);
    query.equalTo('itemId', itemId);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.doesNotExist('valid_until'); // Only get current active prices (valid_until IS NULL)
    query.include(['ratePtr', 'vehiclePtr']);

    return await query.find(options);
  }

  /**
   * Get all client prices for a specific client.
   * @static
   * @param {string} clientId - Client object ID.
   * @param {string} itemType - Optional: filter by item type.
   * @param {object} options - Parse options.
   * @returns {Promise<Array>} Array of ClientPrices objects.
   * @example
   */
  static async getAllClientPrices(clientId, itemType = null, options = {}) {
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const query = new Parse.Query(ClientPricesClass);

    query.equalTo('clientPtr', new (Parse.Object.extend('Client'))({ id: clientId }));
    if (itemType) {
      query.equalTo('itemType', itemType);
    }
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.doesNotExist('valid_until'); // Only get current active prices (valid_until IS NULL)
    query.include(['ratePtr', 'vehiclePtr']);
    query.limit(1000); // Adjust as needed

    return await query.find(options);
  }
}

// Register the class with Parse
Parse.Object.registerSubclass('ClientPrices', ClientPrices);

module.exports = ClientPrices;
