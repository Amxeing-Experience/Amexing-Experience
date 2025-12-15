/**
 * TourPrices Domain Model.
 *
 * Tour pricing matrix - stores prices for each Rate × Tour combination
 * Enables different pricing per rate for the same tour.
 *
 * Schema:
 * - ratePtr: Pointer to Rate table (Green Class, Premium, First Class, etc.)
 * - tourPtr: Pointer to Tour table (tour catalog entry)
 * - vehicleType: Pointer to VehicleType table (SEDAN, SUBURBAN, etc.)
 * - price: Number (price in MXN for this rate-tour-vehicle combination)
 * - currency: String (currency code, default 'MXN')
 * - active: Boolean (true = price is available for booking)
 * - exists: Boolean (true = visible, false = logically deleted).
 *
 * Relationships:
 * - ratePtr -> Rate (many-to-one)
 * - tourPtr -> Tour (many-to-one)
 * - vehicleType -> VehicleType (many-to-one).
 *
 * Business Logic:
 * - Each Tour can have multiple TourPrices (one per Rate + VehicleType combination)
 * - Each Rate can have multiple TourPrices (one per Tour + VehicleType combination)
 * - Unique constraint: (ratePtr + tourPtr + vehicleType) combination should be unique.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-11
 */

const Parse = require('parse/node');

/**
 * TourPrices class extending Parse.Object
 * Represents tour pricing for specific rate-tour combinations.
 */
class TourPrices extends Parse.Object {
  constructor() {
    super('TourPrices');
  }

  /**
   * Get rate pointer.
   * @returns {Parse.Object|null} Rate object or null.
   * @example
   */
  getRate() {
    return this.get('ratePtr');
  }

  /**
   * Set rate pointer.
   * @param {Parse.Object} rate Rate object.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setRate(rate) {
    this.set('ratePtr', rate);
    return this;
  }

  /**
   * Get tour pointer.
   * @returns {Parse.Object|null} Tour object or null.
   * @example
   */
  getTour() {
    return this.get('tourPtr');
  }

  /**
   * Set tour pointer.
   * @param {Parse.Object} tour Tour object.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setTour(tour) {
    this.set('tourPtr', tour);
    return this;
  }

  /**
   * Get vehicle type.
   * @returns {Parse.Object|null} VehicleType object or null.
   * @example
   */
  getVehicleType() {
    return this.get('vehicleType');
  }

  /**
   * Set vehicle type.
   * @param {Parse.Object} vehicleType VehicleType object.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setVehicleType(vehicleType) {
    this.set('vehicleType', vehicleType);
    return this;
  }

  /**
   * Get price.
   * @returns {number} Price in configured currency.
   * @example
   */
  getPrice() {
    return this.get('price') || 0;
  }

  /**
   * Set price.
   * @param {number} price Price amount.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setPrice(price) {
    this.set('price', parseFloat(price));
    return this;
  }

  /**
   * Get currency code.
   * @returns {string} Currency code (default 'MXN').
   * @example
   */
  getCurrency() {
    return this.get('currency') || 'MXN';
  }

  /**
   * Set currency code.
   * @param {string} currency Currency code.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setCurrency(currency) {
    this.set('currency', currency || 'MXN');
    return this;
  }

  /**
   * Check if tour price is active.
   * @returns {boolean} True if active.
   * @example
   */
  isActive() {
    return this.get('active') === true;
  }

  /**
   * Set tour price active status.
   * @param {boolean} active Active status.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setActive(active) {
    this.set('active', Boolean(active));
    return this;
  }

  /**
   * Check if tour price exists (not logically deleted).
   * @returns {boolean} True if exists.
   * @example
   */
  exists() {
    return this.get('exists') !== false;
  }

  /**
   * Set tour price exists status.
   * @param {boolean} exists Exists status.
   * @returns {TourPrices} This instance for chaining.
   * @example
   */
  setExists(exists) {
    this.set('exists', Boolean(exists));
    return this;
  }

  /**
   * Get formatted price string.
   * @returns {string} Formatted price with currency.
   * @example
   */
  getFormattedPrice() {
    const price = this.getPrice();
    const currency = this.getCurrency();

    if (currency === 'MXN') {
      return `$${price.toLocaleString('es-MX')} MXN`;
    }
    return `${price.toLocaleString()} ${currency}`;
  }

  /**
   * Get tour price display name.
   * @returns {string} Formatted tour price description.
   * @example
   */
  getDisplayName() {
    const rate = this.getRate();
    const tour = this.getTour();
    const vehicleType = this.getVehicleType();

    const rateName = rate ? rate.get('name') : 'Unknown Rate';
    const tourName = tour ? tour.getDisplayName() : 'Unknown Tour';
    const vehicleName = vehicleType ? vehicleType.get('name') : 'Unknown Vehicle';
    const price = this.getFormattedPrice();

    return `${tourName} | ${vehicleName} | ${rateName} | ${price}`;
  }

  /**
   * Create standard TourPrices record.
   * @param {object} data TourPrices data.
   * @param {Parse.Object} data.rate Rate object.
   * @param {Parse.Object} data.tour Tour object.
   * @param {Parse.Object} data.vehicleType VehicleType object.
   * @param {number} data.price Price amount.
   * @param {string} [data.currency] Currency code.
   * @param {boolean} [data.active] Active status.
   * @param {boolean} [data.exists] Exists status.
   * @returns {TourPrices} New TourPrices instance.
   * @example
   */
  static createTourPrice(data) {
    const tourPrice = new TourPrices();

    // Required fields
    tourPrice.setRate(data.rate);
    tourPrice.setTour(data.tour);
    tourPrice.setVehicleType(data.vehicleType);
    tourPrice.setPrice(data.price);

    // Optional fields
    tourPrice.setCurrency(data.currency || 'MXN');
    tourPrice.setActive(data.active !== false);
    tourPrice.setExists(data.exists !== false);

    return tourPrice;
  }

  /**
   * Query helper to get all active tour prices.
   * @returns {Parse.Query} Query for active tour prices.
   * @example
   */
  static getActiveTourPricesQuery() {
    const query = new Parse.Query(TourPrices);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour prices by rate.
   * @param {Parse.Object} rate Rate object.
   * @returns {Parse.Query} Query for tour prices with specific rate.
   * @example
   */
  static getTourPricesByRateQuery(rate) {
    const query = new Parse.Query(TourPrices);
    query.equalTo('ratePtr', rate);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour prices by tour.
   * @param {Parse.Object} tour Tour object.
   * @returns {Parse.Query} Query for tour prices for specific tour.
   * @example
   */
  static getTourPricesByTourQuery(tour) {
    const query = new Parse.Query(TourPrices);
    query.equalTo('tourPtr', tour);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour price by rate and tour combination.
   * @param {Parse.Object} rate Rate object.
   * @param {Parse.Object} tour Tour object.
   * @returns {Parse.Query} Query for specific rate-tour combination.
   * @example
   */
  static getTourPriceByRateAndTourQuery(rate, tour) {
    const query = new Parse.Query(TourPrices);
    query.equalTo('ratePtr', rate);
    query.equalTo('tourPtr', tour);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour prices by destination POI.
   * @param {Parse.Object} destinationPOI POI object.
   * @returns {Parse.Query} Query for tour prices to specific destination.
   * @example
   */
  static getTourPricesByDestinationQuery(destinationPOI) {
    const tourQuery = new Parse.Query('Tour');
    tourQuery.equalTo('destinationPOI', destinationPOI);
    tourQuery.equalTo('exists', true);

    const query = new Parse.Query(TourPrices);
    query.matchesQuery('tourPtr', tourQuery);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour prices by vehicle type.
   * @param {Parse.Object} vehicleType VehicleType object.
   * @returns {Parse.Query} Query for tour prices with specific vehicle type.
   * @example
   */
  static getTourPricesByVehicleTypeQuery(vehicleType) {
    const query = new Parse.Query(TourPrices);
    query.equalTo('vehicleType', vehicleType);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tour price by rate, tour and vehicle type combination.
   * @param {Parse.Object} rate Rate object.
   * @param {Parse.Object} tour Tour object.
   * @param {Parse.Object} vehicleType VehicleType object.
   * @returns {Parse.Query} Query for specific rate-tour-vehicle combination.
   * @example
   */
  static getTourPriceByRateAndTourAndVehicleQuery(rate, tour, vehicleType) {
    const query = new Parse.Query(TourPrices);
    query.equalTo('ratePtr', rate);
    query.equalTo('tourPtr', tour);
    query.equalTo('vehicleType', vehicleType);
    query.equalTo('exists', true);
    query.include(['ratePtr', 'tourPtr', 'vehicleType', 'tourPtr.destinationPOI']);
    return query;
  }

  /**
   * Get price statistics for a tour across all rates.
   * @param {Parse.Object} tour Tour object.
   * @returns {Promise<object>} Price statistics.
   * @example
   */
  static async getTourPriceStatistics(tour) {
    const query = TourPrices.getTourPricesByTourQuery(tour);
    const tourPrices = await query.find({ useMasterKey: true });

    if (tourPrices.length === 0) {
      return {
        count: 0,
        minPrice: 0,
        maxPrice: 0,
        avgPrice: 0,
        rates: [],
      };
    }

    const prices = tourPrices.map((tp) => tp.getPrice());
    const rates = tourPrices.map((tp) => ({
      name: tp.getRate().get('name'),
      price: tp.getPrice(),
      formatted: tp.getFormattedPrice(),
    }));

    return {
      count: tourPrices.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      rates: rates.sort((a, b) => a.price - b.price),
    };
  }

  /**
   * Get price statistics for a rate across all tours.
   * @param {Parse.Object} rate Rate object.
   * @returns {Promise<object>} Price statistics.
   * @example
   */
  static async getRatePriceStatistics(rate) {
    const query = TourPrices.getTourPricesByRateQuery(rate);
    const tourPrices = await query.find({ useMasterKey: true });

    if (tourPrices.length === 0) {
      return {
        count: 0,
        minPrice: 0,
        maxPrice: 0,
        avgPrice: 0,
        tours: [],
      };
    }

    const prices = tourPrices.map((tp) => tp.getPrice());
    const tours = tourPrices.map((tp) => ({
      name: tp.getTour().getDisplayName(),
      price: tp.getPrice(),
      formatted: tp.getFormattedPrice(),
    }));

    return {
      count: tourPrices.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      tours: tours.sort((a, b) => a.price - b.price),
    };
  }
}

// Register the subclass
Parse.Object.registerSubclass('TourPrices', TourPrices);

module.exports = TourPrices;
