/**
 * BaseModel - Base Parse Object class with standardized lifecycle management.
 *
 * Provides consistent data lifecycle management across all entities with:
 * - active: boolean - Indicates if record is currently active/enabled for business operations
 * - exists: boolean - Indicates if record exists in memory (false = soft deleted, audit trail only).
 *
 * Lifecycle States:
 * - active: true, exists: true = Active record (normal operations)
 * - active: false, exists: true = Inactive/disabled record (archived but accessible)
 * - active: false, exists: false = Soft deleted record (hidden from normal queries, audit trail only).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2025-09-22
 * @example
 * // Model method usage
 * const result = await basemodel.require({ 'parse/node': 'example' });
 * // Returns: model operation result
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

class BaseModel extends Parse.Object {
  // NOTE: Default values are NOT set in constructor to avoid interference with Parse object hydration
  // Defaults are set in Parse Server cloud functions (beforeSave hook) instead
  // This ensures MongoDB values are preserved when objects are queried

  /**
   * Check if record is active and exists (normal business operations).
   * @returns {boolean} - Boolean result.
   * @example
   * // Model method usage
   * const result = await basemodel.isActive({ 'parse/node': 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  isActive() {
    return this.get('active') === true && this.get('exists') === true;
  }

  /**
   * Check if record exists but is inactive (archived).
   * @returns {boolean} - Boolean result.
   * @example
   * // Model method usage
   * const result = await basemodel.isArchived({ 'parse/node': 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  isArchived() {
    return this.get('active') === false && this.get('exists') === true;
  }

  /**
   * Check if record is soft deleted (hidden from normal queries).
   * @returns {boolean} - Boolean result.
   * @example
   * // Model method usage
   * const result = await basemodel.isSoftDeleted({ 'parse/node': 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  isSoftDeleted() {
    return this.get('exists') === false;
  }

  /**
   * Activate record (set active to true, ensure exists is true).
   * @param {string} modifiedBy - User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.activate({ modifiedBy: 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  async activate(modifiedBy = null) {
    this.set('active', true);
    this.set('exists', true);
    this.set('updatedAt', new Date());
    if (modifiedBy) {
      this.set('modifiedBy', modifiedBy);
    }

    logger.info(`Record activated: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Deactivate record (set active to false, keep exists true for archive).
   * @param {string} modifiedBy - User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.deactivate({ modifiedBy: 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  async deactivate(modifiedBy = null) {
    this.set('active', false);
    this.set('exists', true); // Keep in archive
    this.set('updatedAt', new Date());
    if (modifiedBy) {
      this.set('modifiedBy', modifiedBy);
    }

    logger.info(`Record deactivated: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Soft delete record (set exists to false, hide from normal queries but keep for audit).
   * @param {string} modifiedBy - User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.softDelete({ modifiedBy: 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  async softDelete(modifiedBy = null) {
    this.set('active', false);
    this.set('exists', false);
    this.set('deletedAt', new Date());
    this.set('updatedAt', new Date());
    if (modifiedBy) {
      this.set('modifiedBy', modifiedBy);
      this.set('deletedBy', modifiedBy);
    }

    logger.info(`Record soft deleted: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Restore soft deleted record (set exists back to true, but keep inactive).
   * @param {string} modifiedBy - User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.restore({ modifiedBy: 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  async restore(modifiedBy = null) {
    this.set('exists', true);
    this.set('active', false); // Restore as inactive, let user explicitly activate
    this.unset('deletedAt');
    this.unset('deletedBy');
    this.set('updatedAt', new Date());
    if (modifiedBy) {
      this.set('modifiedBy', modifiedBy);
    }

    logger.info(`Record restored: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Override save to always update the updatedAt timestamp.
   * @param {*} attributes - Attributes parameter.
   * @param {object} options - Configuration options.
   * @example
   * // Update model
   * const updated = await basemodel.update(data);
   * // Returns: updated instance
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async save(attributes, options) {
    this.set('updatedAt', new Date());
    return super.save(attributes, options);
  }

  /**
   * Get lifecycle status as string.
   * @returns {string} - Operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.getLifecycleStatus({ attributes: 'example', options: 'example' });
   * // Returns: model operation result
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  getLifecycleStatus() {
    if (this.isSoftDeleted()) return 'deleted';
    if (this.isArchived()) return 'archived';
    if (this.isActive()) return 'active';
    return 'unknown';
  }

  /**
   * Static method to create a query that only returns active records.
   * @param {string} className - Parse class name.
   * @returns {Parse.Query} - Operation result.
   * @example
   * // Query model
   * const results = await BaseModel.query(criteria);
   * // Returns: array of instances
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static queryActive(className) {
    const query = new Parse.Query(className);
    query.equalTo('active', true);
    query.equalTo('exists', true);
    return query;
  }

  /**
   * Static method to create a query that returns active and archived records (excludes soft deleted).
   * @param {string} className - Parse class name.
   * @returns {Parse.Query} - Operation result.
   * @example
   * // Query model
   * const results = await BaseModel.query(criteria);
   * // Returns: array of instances
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static queryExisting(className) {
    const query = new Parse.Query(className);
    query.equalTo('exists', true);
    return query;
  }

  /**
   * Static method to create a query that returns all records including soft deleted (for admin/audit).
   * @param {string} className - Parse class name.
   * @returns {Parse.Query} - Operation result.
   * @example
   * // Query model
   * const results = await BaseModel.query(criteria);
   * // Returns: array of instances
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static queryAll(className) {
    return new Parse.Query(className);
  }

  /**
   * Static method to create a query that only returns archived records.
   * @param {string} className - Parse class name.
   * @returns {Parse.Query} - Operation result.
   * @example
   * // Query model
   * const results = await BaseModel.query(criteria);
   * // Returns: array of instances
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static queryArchived(className) {
    const query = new Parse.Query(className);
    query.equalTo('active', false);
    query.equalTo('exists', true);
    return query;
  }

  /**
   * Static method to create a query that only returns soft deleted records.
   * @param {string} className - Parse class name.
   * @returns {Parse.Query} - Operation result.
   * @example
   * // Query model
   * const results = await BaseModel.query(criteria);
   * // Returns: array of instances
   * // const instance = new ModelName(data);
   * // const result = await instance.save();
   */
  static querySoftDeleted(className) {
    const query = new Parse.Query(className);
    query.equalTo('exists', false);
    return query;
  }
}

module.exports = BaseModel;
