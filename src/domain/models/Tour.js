/**
 * Tour Domain Model.
 *
 * Tour catalog without pricing - contains unique tour combinations
 * Extracted from Tours table by destinationPOI, vehicleType, and time.
 *
 * Schema:
 * - destinationPOI: Pointer to POI table (destination location)
 * - time: Number (duration in minutes)
 * - notes: String (tour description/notes, optional)
 * - availability: Array (new availability format, optional)
 * - availableDays: Array (legacy availability format, optional)
 * - startTime: String (legacy start time, optional)
 * - endTime: String (legacy end time, optional)
 * - active: Boolean (true = available for booking)
 * - exists: Boolean (true = visible, false = logically deleted).
 *
 * Relationships:
 * - destinationPOI -> POI (many-to-one)
 * - TourPrices -> Tour (one-to-many, inverse).
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-15
 */

const Parse = require('parse/node');

/**
 * Tour class extending Parse.Object
 * Represents tour catalog without pricing information.
 */
class Tour extends Parse.Object {
  constructor() {
    super('Tour');
  }

  /**
   * Get destination POI.
   * @returns {Parse.Object|null} POI object or null.
   * @example
   */
  getDestinationPOI() {
    return this.get('destinationPOI');
  }

  /**
   * Set destination POI.
   * @param {Parse.Object} poi POI object.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setDestinationPOI(poi) {
    this.set('destinationPOI', poi);
    return this;
  }

  /**
   * Get tour duration in minutes.
   * @returns {number} Duration in minutes.
   * @example
   */
  getTime() {
    return this.get('time') || 0;
  }

  /**
   * Set tour duration in minutes.
   * @param {number} time Duration in minutes.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setTime(time) {
    this.set('time', parseInt(time, 10));
    return this;
  }

  /**
   * Get tour notes/description.
   * @returns {string|null} Notes or null.
   * @example
   */
  getNotes() {
    return this.get('notes');
  }

  /**
   * Set tour notes/description.
   * @param {string|null} notes Tour notes.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setNotes(notes) {
    if (notes && notes.trim()) {
      this.set('notes', notes.trim());
    } else {
      this.unset('notes');
    }
    return this;
  }

  /**
   * Get availability (new format).
   * @returns {Array|null} Availability schedule array or null.
   * @example
   */
  getAvailability() {
    return this.get('availability');
  }

  /**
   * Set availability (new format).
   * @param {Array|null} availability Availability schedule array.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setAvailability(availability) {
    if (availability && Array.isArray(availability)) {
      this.set('availability', availability);
    } else {
      this.unset('availability');
    }
    return this;
  }

  /**
   * Get available days (legacy format).
   * @returns {Array|null} Available days array or null.
   * @example
   */
  getAvailableDays() {
    return this.get('availableDays');
  }

  /**
   * Set available days (legacy format).
   * @param {Array|null} availableDays Available days array.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setAvailableDays(availableDays) {
    if (availableDays && Array.isArray(availableDays)) {
      this.set('availableDays', availableDays);
    } else {
      this.unset('availableDays');
    }
    return this;
  }

  /**
   * Get start time (legacy format).
   * @returns {string|null} Start time or null.
   * @example
   */
  getStartTime() {
    return this.get('startTime');
  }

  /**
   * Set start time (legacy format).
   * @param {string|null} startTime Start time.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setStartTime(startTime) {
    if (startTime) {
      this.set('startTime', startTime);
    } else {
      this.unset('startTime');
    }
    return this;
  }

  /**
   * Get end time (legacy format).
   * @returns {string|null} End time or null.
   * @example
   */
  getEndTime() {
    return this.get('endTime');
  }

  /**
   * Set end time (legacy format).
   * @param {string|null} endTime End time.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setEndTime(endTime) {
    if (endTime) {
      this.set('endTime', endTime);
    } else {
      this.unset('endTime');
    }
    return this;
  }

  /**
   * Check if tour is active.
   * @returns {boolean} True if active.
   * @example
   */
  isActive() {
    return this.get('active') === true;
  }

  /**
   * Set tour active status.
   * @param {boolean} active Active status.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setActive(active) {
    this.set('active', Boolean(active));
    return this;
  }

  /**
   * Check if tour exists (not logically deleted).
   * @returns {boolean} True if exists.
   * @example
   */
  exists() {
    return this.get('exists') !== false;
  }

  /**
   * Set tour exists status.
   * @param {boolean} exists Exists status.
   * @returns {Tour} This instance for chaining.
   * @example
   */
  setExists(exists) {
    this.set('exists', Boolean(exists));
    return this;
  }

  /**
   * Get tour display name.
   * @returns {string} Formatted tour name.
   * @example
   */
  getDisplayName() {
    const destination = this.getDestinationPOI();
    const time = this.getTime();

    const destinationName = destination ? destination.get('name') : 'Unknown Destination';
    const timeHours = Math.round((time / 60) * 10) / 10; // Round to 1 decimal

    return `${destinationName} | ${timeHours}h`;
  }

  /**
   * Create standard Tour record with required fields.
   * @param {object} data Tour data.
   * @param {Parse.Object} data.destinationPOI POI object.
   * @param {number} data.time Duration in minutes.
   * @param {boolean} [data.active] Active status.
   * @param {boolean} [data.exists] Exists status.
   * @returns {Tour} New Tour instance.
   * @example
   */
  static createTour(data) {
    const tour = new Tour();

    // Required fields
    tour.setDestinationPOI(data.destinationPOI);
    tour.setTime(data.time);

    // Optional fields
    if (data.notes) {
      tour.setNotes(data.notes);
    }
    if (data.availability) {
      tour.setAvailability(data.availability);
    }
    if (data.availableDays) {
      tour.setAvailableDays(data.availableDays);
    }
    if (data.startTime) {
      tour.setStartTime(data.startTime);
    }
    if (data.endTime) {
      tour.setEndTime(data.endTime);
    }

    // Standard fields
    tour.setActive(data.active !== false);
    tour.setExists(data.exists !== false);

    return tour;
  }

  /**
   * Query helper to get all active tours.
   * @returns {Parse.Query} Query for active tours.
   * @example
   */
  static getActiveToursQuery() {
    const query = new Parse.Query(Tour);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.include(['destinationPOI']);
    return query;
  }

  /**
   * Query helper to get tours by destination.
   * @param {Parse.Object} destinationPOI POI object.
   * @returns {Parse.Query} Query for tours to specific destination.
   * @example
   */
  static getToursByDestinationQuery(destinationPOI) {
    const query = new Parse.Query(Tour);
    query.equalTo('destinationPOI', destinationPOI);
    query.equalTo('exists', true);
    query.include(['destinationPOI']);
    return query;
  }
}

// Register the subclass
Parse.Object.registerSubclass('Tour', Tour);

module.exports = Tour;
