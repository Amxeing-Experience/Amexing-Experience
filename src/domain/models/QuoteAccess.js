/**
 * QuoteAccess - Domain model for quote access permissions.
 * Manages agent access to quotes with role-based permissions (editor/viewer).
 *
 * Features:
 * - Grant/revoke access to agents
 * - Role-based permissions (editor, viewer)
 * - Track who granted access and when
 * - Support for temporary access with expiration
 * - Audit trail for all access changes.
 *
 * Created by Denisse Maldonado.
 * @augments BaseModel
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');
const logger = require('../../infrastructure/logger');

/**
 * QuoteAccess class for managing quote access permissions.
 * @class QuoteAccess
 * @augments BaseModel
 */
class QuoteAccess extends BaseModel {
  constructor() {
    super('QuoteAccess');
  }

  // =================
  // CONSTANTS
  // =================

  static get ROLES() {
    return {
      EDITOR: 'editor',
      VIEWER: 'viewer',
    };
  }

  static get ACCESS_TYPES() {
    return {
      PERMANENT: 'permanent',
      TEMPORARY: 'temporary',
    };
  }

  // =================
  // GETTERS & SETTERS
  // =================

  /**
   * Get quote reference.
   * @returns {object} Quote Parse object pointer.
   * @example
   */
  getQuote() {
    return this.get('quote');
  }

  /**
   * Set quote reference.
   * @param {object} quote - Quote Parse object or Pointer.
   * @example
   */
  setQuote(quote) {
    this.set('quote', quote);
  }

  /**
   * Get agent reference.
   * @returns {object} AmexingUser Parse object (agent with access).
   * @example
   */
  getAgent() {
    return this.get('agent');
  }

  /**
   * Set agent reference.
   * @param {object} agent - AmexingUser Parse object or Pointer.
   * @example
   */
  setAgent(agent) {
    this.set('agent', agent);
  }

  /**
   * Get access role.
   * @returns {string} Role (editor or viewer).
   * @example
   */
  getRole() {
    return this.get('role');
  }

  /**
   * Set access role.
   * @param {string} role - Role (editor or viewer).
   * @example
   */
  setRole(role) {
    if (!Object.values(QuoteAccess.ROLES).includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be 'editor' or 'viewer'`);
    }
    this.set('role', role);
  }

  /**
   * Get who granted access.
   * @returns {object} AmexingUser who granted access.
   * @example
   */
  getGrantedBy() {
    return this.get('grantedBy');
  }

  /**
   * Set who granted access.
   * @param {object} user - AmexingUser Parse object or Pointer.
   * @example
   */
  setGrantedBy(user) {
    this.set('grantedBy', user);
  }

  /**
   * Get access grant date.
   * @returns {Date} Date when access was granted.
   * @example
   */
  getGrantedAt() {
    return this.get('grantedAt');
  }

  /**
   * Set access grant date.
   * @param {Date} date - Date when access was granted.
   * @example
   */
  setGrantedAt(date) {
    this.set('grantedAt', date);
  }

  /**
   * Get access expiration date.
   * @returns {Date|null} Date when access expires (null if permanent).
   * @example
   */
  getExpiresAt() {
    return this.get('expiresAt');
  }

  /**
   * Set access expiration date.
   * @param {Date|null} date - Expiration date or null for permanent access.
   * @example
   */
  setExpiresAt(date) {
    this.set('expiresAt', date);
  }

  /**
   * Get access type.
   * @returns {string} Access type (permanent or temporary).
   * @example
   */
  getAccessType() {
    return this.get('accessType') || QuoteAccess.ACCESS_TYPES.PERMANENT;
  }

  /**
   * Set access type.
   * @param {string} type - Access type (permanent or temporary).
   * @example
   */
  setAccessType(type) {
    if (!Object.values(QuoteAccess.ACCESS_TYPES).includes(type)) {
      throw new Error(`Invalid access type: ${type}`);
    }
    this.set('accessType', type);
  }

  /**
   * Get revoked status.
   * @returns {boolean} Whether access has been revoked.
   * @example
   */
  isRevoked() {
    return this.get('revoked') === true;
  }

  /**
   * Set revoked status.
   * @param {boolean} revoked - Whether access is revoked.
   * @example
   */
  setRevoked(revoked) {
    this.set('revoked', revoked);
    if (revoked) {
      this.set('revokedAt', new Date());
    }
  }

  /**
   * Get revoked by user.
   * @returns {object} AmexingUser who revoked access.
   * @example
   */
  getRevokedBy() {
    return this.get('revokedBy');
  }

  /**
   * Set revoked by user.
   * @param {object} user - AmexingUser Parse object or Pointer.
   * @example
   */
  setRevokedBy(user) {
    this.set('revokedBy', user);
  }

  /**
   * Get revoke reason.
   * @returns {string} Reason for revoking access.
   * @example
   */
  getRevokeReason() {
    return this.get('revokeReason');
  }

  /**
   * Set revoke reason.
   * @param {string} reason - Reason for revoking access.
   * @example
   */
  setRevokeReason(reason) {
    this.set('revokeReason', reason);
  }

  /**
   * Get last accessed date.
   * @returns {Date} Date when agent last accessed the quote.
   * @example
   */
  getLastAccessedAt() {
    return this.get('lastAccessedAt');
  }

  /**
   * Set last accessed date.
   * @param {Date} date - Date of last access.
   * @example
   */
  setLastAccessedAt(date) {
    this.set('lastAccessedAt', date);
  }

  /**
   * Check if access is currently valid.
   * @returns {boolean} True if access is valid and not expired.
   * @example
   */
  isValid() {
    if (this.isRevoked()) {
      return false;
    }

    if (!this.get('active')) {
      return false;
    }

    const expiresAt = this.getExpiresAt();
    if (expiresAt && expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  // ================
  // VALIDATION
  // ================

  /**
   * Validate access data before save.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails.
   * @example
   */
  validate(attrs) {
    const parentError = super.validate(attrs);
    if (parentError) {
      return parentError;
    }

    // Quote is required
    if (!attrs.quote && !this.has('quote')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Quote is required');
    }

    // Agent is required
    if (!attrs.agent && !this.has('agent')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Agent is required');
    }

    // Role is required
    if (!attrs.role && !this.has('role')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Role is required');
    }

    // Granted by is required
    if (!attrs.grantedBy && !this.has('grantedBy')) {
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'GrantedBy is required');
    }

    return undefined;
  }

  // ================
  // STATIC METHODS
  // ================

  /**
   * Grant access to an agent for a quote.
   * @param {object} quote - Quote Parse object.
   * @param {object} agent - AmexingUser to grant access.
   * @param {string} role - Access role (editor/viewer).
   * @param {object} grantedBy - User granting access.
   * @param {object} options - Additional options.
   * @returns {Promise<QuoteAccess>} Created access record.
   * @example
   */
  static async grantAccess(quote, agent, role, grantedBy, options = {}) {
    const { expiresAt = null, reason = '' } = options;

    // Check for existing access
    const existingAccess = await this.getAgentAccess(quote, agent);
    if (existingAccess && existingAccess.isValid()) {
      // Update existing access
      existingAccess.setRole(role);
      existingAccess.setGrantedBy(grantedBy);
      existingAccess.setGrantedAt(new Date());
      if (expiresAt) {
        existingAccess.setExpiresAt(expiresAt);
        existingAccess.setAccessType(QuoteAccess.ACCESS_TYPES.TEMPORARY);
      }
      await existingAccess.save(null, { useMasterKey: true });

      logger.info('Updated existing quote access', {
        quoteId: quote.id,
        agentId: agent.id,
        role,
        accessId: existingAccess.id,
      });

      return existingAccess;
    }

    // Create new access record
    const access = new QuoteAccess();
    access.setQuote(quote);
    access.setAgent(agent);
    access.setRole(role);
    access.setGrantedBy(grantedBy);
    access.setGrantedAt(new Date());

    if (expiresAt) {
      access.setExpiresAt(expiresAt);
      access.setAccessType(QuoteAccess.ACCESS_TYPES.TEMPORARY);
    } else {
      access.setAccessType(QuoteAccess.ACCESS_TYPES.PERMANENT);
    }

    access.set('active', true);
    access.set('exists', true);
    access.set('reason', reason);

    try {
      await access.save(null, { useMasterKey: true });
      logger.info('Granted quote access', {
        quoteId: quote.id,
        agentId: agent.id,
        role,
        grantedById: grantedBy.id,
        accessId: access.id,
      });
      return access;
    } catch (error) {
      logger.error('Failed to grant access', {
        error: error.message,
        quoteId: quote.id,
        agentId: agent.id,
      });
      throw error;
    }
  }

  /**
   * Revoke access for an agent.
   * @param {object} quote - Quote Parse object.
   * @param {object} agent - AmexingUser to revoke access.
   * @param {object} revokedBy - User revoking access.
   * @param {string} reason - Reason for revocation.
   * @returns {Promise<boolean>} True if revoked successfully.
   * @example
   */
  static async revokeAccess(quote, agent, revokedBy, reason = '') {
    const access = await this.getAgentAccess(quote, agent);
    if (!access || !access.isValid()) {
      logger.warn('No valid access to revoke', {
        quoteId: quote.id,
        agentId: agent.id,
      });
      return false;
    }

    access.setRevoked(true);
    access.setRevokedBy(revokedBy);
    access.setRevokeReason(reason);
    access.set('active', false);

    try {
      await access.save(null, { useMasterKey: true });
      logger.info('Revoked quote access', {
        quoteId: quote.id,
        agentId: agent.id,
        revokedById: revokedBy.id,
        reason,
      });
      return true;
    } catch (error) {
      logger.error('Failed to revoke access', {
        error: error.message,
        quoteId: quote.id,
        agentId: agent.id,
      });
      throw error;
    }
  }

  /**
   * Get agent's access to a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object|string} agent - AmexingUser object or ID.
   * @returns {Promise<QuoteAccess|null>} Access record or null.
   * @example
   */
  static async getAgentAccess(quote, agent) {
    const query = new Parse.Query('QuoteAccess');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    let agentObj = agent;
    if (typeof agent === 'string') {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      agentObj = AmexingUser.createWithoutData(agent);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('agent', agentObj);
    query.equalTo('exists', true);
    query.descending('grantedAt');

    try {
      const access = await query.first({ useMasterKey: true });
      return access;
    } catch (error) {
      logger.error('Error finding agent access', {
        error: error.message,
        quoteId: quote.id,
        agentId: agent.id,
      });
      throw error;
    }
  }

  /**
   * Get all agents with access to a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object} options - Query options.
   * @returns {Promise<QuoteAccess[]>} Array of access records.
   * @example
   */
  static async getQuoteCollaborators(quote, options = {}) {
    const { includeRevoked = false, role = null } = options;
    const query = new Parse.Query('QuoteAccess');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('exists', true);

    if (!includeRevoked) {
      query.equalTo('revoked', false);
      query.equalTo('active', true);
    }

    if (role) {
      query.equalTo('role', role);
    }

    query.include(['agent', 'grantedBy']);
    query.descending('grantedAt');

    try {
      const collaborators = await query.find({ useMasterKey: true });

      // Filter out expired access
      const validCollaborators = collaborators.filter((access) => {
        if (!includeRevoked && !access.isValid()) {
          return false;
        }
        return true;
      });

      logger.info('Retrieved quote collaborators', {
        quoteId: quote.id,
        count: validCollaborators.length,
      });

      return validCollaborators;
    } catch (error) {
      logger.error('Error retrieving collaborators', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }

  /**
   * Check if a user has specific access to a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object|string} user - AmexingUser object or ID.
   * @param {string} requiredRole - Required role (null for any role).
   * @returns {Promise<boolean>} True if user has access.
   * @example
   */
  static async hasAccess(quote, user, requiredRole = null) {
    const access = await this.getAgentAccess(quote, user);

    if (!access || !access.isValid()) {
      return false;
    }

    if (requiredRole) {
      return access.getRole() === requiredRole;
    }

    return true;
  }

  /**
   * Update agent's last access time.
   * @param {object|string} quote - Quote object or ID.
   * @param {object|string} agent - AmexingUser object or ID.
   * @returns {Promise<void>}
   * @example
   */
  static async updateLastAccessed(quote, agent) {
    const access = await this.getAgentAccess(quote, agent);
    if (access && access.isValid()) {
      access.setLastAccessedAt(new Date());
      await access.save(null, { useMasterKey: true });
    }
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('QuoteAccess', QuoteAccess);

module.exports = QuoteAccess;
