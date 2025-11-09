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
 * @since 2024-09-22
 * @example
 * // Model method usage
 * const result = await basemodel.require({ 'parse/node': 'example' });
 * // Returns: model operation result
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * BaseModel class extending Parse.Object with standardized lifecycle management.
 * Provides consistent data lifecycle operations with active/exists state management,
 * soft deletion capabilities, and comprehensive audit logging for all domain entities.
 *
 * This base class implements a three-state lifecycle model with active/exists flags,
 * enabling soft deletion, archival, and restoration of records while maintaining
 * complete audit trails for PCI DSS compliance and business intelligence.
 *
 * Features:
 * - Three-state lifecycle (active, archived, soft-deleted)
 * - Audit trail logging for all state transitions
 * - Static query helpers for lifecycle-aware queries
 * - Automatic timestamp management
 * - Modified-by tracking for compliance.
 * @class BaseModel
 * @augments Parse.Object
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-09-22
 * @example
 * // Extend BaseModel for domain entities
 * class AmexingUser extends BaseModel {
 *   constructor() {
 *     super('AmexingUser');
 *   }
 * }
 * Parse.Object.registerSubclass('AmexingUser', AmexingUser);
 *
 * // Use lifecycle methods
 * const user = await BaseModel.queryActive('AmexingUser').first();
 * await user.deactivate('admin123');
 * await user.softDelete('admin123');
 * await user.restore('admin123');
 */
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
   * @param {Parse.User|string} modifiedBy - User object or User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.activate({ modifiedBy: userObject });
   * // Returns: model operation result
   */
  async activate(modifiedBy = null) {
    this.set('active', true);
    this.set('exists', true);
    // Track who modified the record - support both User objects and string IDs
    if (modifiedBy) {
      if (typeof modifiedBy === 'string') {
        // Create a Pointer to AmexingUser
        const AmexingUser = require('./AmexingUser');
        const userPointer = new AmexingUser();
        userPointer.id = modifiedBy;
        this.set('modifiedBy', userPointer);
      } else {
        // Already a User object
        this.set('modifiedBy', modifiedBy);
      }
    }

    logger.info(`Record activated: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy: typeof modifiedBy === 'string' ? modifiedBy : modifiedBy?.id,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Deactivate record (set active to false, keep exists true for archive).
   * @param {Parse.User|string} modifiedBy - User object or User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.deactivate({ modifiedBy: userObject });
   * // Returns: model operation result
   */
  async deactivate(modifiedBy = null) {
    this.set('active', false);
    this.set('exists', true); // Keep in archive
    // Track who modified the record - support both User objects and string IDs
    if (modifiedBy) {
      if (typeof modifiedBy === 'string') {
        // Create a Pointer to AmexingUser
        const AmexingUser = require('./AmexingUser');
        const userPointer = new AmexingUser();
        userPointer.id = modifiedBy;
        this.set('modifiedBy', userPointer);
      } else {
        // Already a User object
        this.set('modifiedBy', modifiedBy);
      }
    }

    logger.info(`Record deactivated: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy: typeof modifiedBy === 'string' ? modifiedBy : modifiedBy?.id,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Soft delete record (set exists to false, hide from normal queries but keep for audit).
   * @param {Parse.User|string} modifiedBy - User object or User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.softDelete({ modifiedBy: userObject });
   * // Returns: model operation result
   */
  async softDelete(modifiedBy = null) {
    this.set('active', false);
    this.set('exists', false);
    this.set('deletedAt', new Date());
    this.set('updatedAt', new Date());
    // Track who deleted the record - support both User objects and string IDs
    if (modifiedBy) {
      if (typeof modifiedBy === 'string') {
        // Create Pointers to AmexingUser
        const AmexingUser = require('./AmexingUser');
        const modifiedByPointer = new AmexingUser();
        modifiedByPointer.id = modifiedBy;
        const deletedByPointer = new AmexingUser();
        deletedByPointer.id = modifiedBy;
        this.set('modifiedBy', modifiedByPointer);
        this.set('deletedBy', deletedByPointer);
      } else {
        // Already a User object
        this.set('modifiedBy', modifiedBy);
        this.set('deletedBy', modifiedBy);
      }
    }

    logger.info(`Record soft deleted: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy: typeof modifiedBy === 'string' ? modifiedBy : modifiedBy?.id,
    });

    return this.save(null, { useMasterKey: true });
  }

  /**
   * Restore soft deleted record (set exists back to true, but keep inactive).
   * @param {Parse.User|string} modifiedBy - User object or User ID who performed the action.
   * @returns {Promise<BaseModel>} - Promise resolving to operation result.
   * @example
   * // Model method usage
   * const result = await basemodel.restore({ modifiedBy: userObject });
   * // Returns: model operation result
   */
  async restore(modifiedBy = null) {
    this.set('exists', true);
    this.set('active', false); // Restore as inactive, let user explicitly activate
    this.unset('deletedAt');
    this.unset('deletedBy');
    this.set('updatedAt', new Date());
    // Track who restored the record - support both User objects and string IDs
    if (modifiedBy) {
      if (typeof modifiedBy === 'string') {
        // Create a Pointer to AmexingUser
        const AmexingUser = require('./AmexingUser');
        const userPointer = new AmexingUser();
        userPointer.id = modifiedBy;
        this.set('modifiedBy', userPointer);
      } else {
        // Already a User object
        this.set('modifiedBy', modifiedBy);
      }
    }

    logger.info(`Record restored: ${this.className} ${this.id}`, {
      className: this.className,
      objectId: this.id,
      modifiedBy: typeof modifiedBy === 'string' ? modifiedBy : modifiedBy?.id,
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
