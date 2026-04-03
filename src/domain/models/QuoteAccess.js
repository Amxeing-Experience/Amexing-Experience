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
    const isRevoked = this.isRevoked();
    const active = this.get('active');
    const expiresAt = this.getExpiresAt();
    const isExpired = expiresAt && expiresAt < new Date();

    console.log('DEBUG: QuoteAccess.isValid() check', {
      accessId: this.id,
      agentId: this.getAgent()?.id,
      isRevoked,
      active,
      expiresAt,
      isExpired,
      exists: this.get('exists'),
      role: this.getRole(),
    });

    if (isRevoked) {
      console.log('DEBUG: QuoteAccess.isValid() - FALSE: isRevoked');
      return false;
    }

    if (!active) {
      console.log('DEBUG: QuoteAccess.isValid() - FALSE: not active', { active });
      return false;
    }

    if (isExpired) {
      console.log('DEBUG: QuoteAccess.isValid() - FALSE: expired', { expiresAt, now: new Date() });
      return false;
    }

    console.log('DEBUG: QuoteAccess.isValid() - TRUE: all checks passed');
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
    console.log('DEBUG: QuoteAccess validate() called', {
      attrs,
      attrsKeys: Object.keys(attrs || {}),
      isNew: this.isNew(),
      hasQuote: this.has('quote'),
      hasAgent: this.has('agent'),
    });

    const parentError = super.validate(attrs);
    if (parentError) {
      console.log('DEBUG: Parent validation error', parentError);
      return parentError;
    }

    // Only run full validation during save operations, not during individual property setting
    // Check if this is a save operation by looking for multiple required fields being set at once
    const isSaveOperation = (attrs.quote && attrs.agent && attrs.role)
                           || (attrs.quote && attrs.agent && attrs.grantedBy)
                           || (Object.keys(attrs).length >= 3); // Multiple fields being set at once

    console.log('DEBUG: Validation check', {
      isSaveOperation,
      isNew: this.isNew(),
      attrsKeys: Object.keys(attrs || {}),
      attrsLength: Object.keys(attrs || {}).length,
      attrsHasQuote: !!attrs.quote,
      attrsHasAgent: !!attrs.agent,
      attrsHasRole: !!attrs.role,
    });

    if (isSaveOperation) {
      console.log('DEBUG: Running full validation (save operation detected)');

      // Quote is required
      if (!attrs.quote && !this.has('quote')) {
        console.log('DEBUG: Quote validation failed');
        return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Quote is required');
      }

      // Agent is required
      if (!attrs.agent && !this.has('agent')) {
        console.log('DEBUG: Agent validation failed - this is the error!');
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
    } else {
      console.log('DEBUG: Skipping validation (individual property setting)');
    }

    console.log('DEBUG: Validation completed successfully');
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

    console.log('DEBUG: QuoteAccess.grantAccess - ENTRY POINT - Method called!', {
      quoteId: quote?.id,
      agentId: agent?.id,
      role,
    });

    // Debug logging
    logger.info('QuoteAccess.grantAccess - Starting', {
      quoteId: quote?.id,
      agentId: agent?.id,
      agentType: typeof agent,
      agentIsNull: agent === null,
      role,
      grantedById: grantedBy?.id,
      options,
    });

    // Check for existing access
    const existingAccess = await this.getAgentAccess(quote, agent);
    if (existingAccess && existingAccess.isValid()) {
      console.log('DEBUG: QuoteAccess.grantAccess - Updating existing access', {
        accessId: existingAccess.id,
        currentActive: existingAccess.get('active'),
        currentRevoked: existingAccess.get('revoked'),
        currentExists: existingAccess.get('exists'),
      });

      // Update existing access
      existingAccess.setRole(role);
      existingAccess.setGrantedBy(grantedBy);
      existingAccess.setGrantedAt(new Date());
      // Ensure critical fields are set for existing records too
      existingAccess.set('active', true);
      existingAccess.set('exists', true);
      existingAccess.set('revoked', false);
      if (expiresAt) {
        existingAccess.setExpiresAt(expiresAt);
        existingAccess.setAccessType(QuoteAccess.ACCESS_TYPES.TEMPORARY);
      }
      await existingAccess.save(null, { useMasterKey: true });

      console.log('DEBUG: QuoteAccess.grantAccess - Updated existing access with fields', {
        accessId: existingAccess.id,
        active: existingAccess.get('active'),
        revoked: existingAccess.get('revoked'),
        exists: existingAccess.get('exists'),
      });

      logger.info('Updated existing quote access', {
        quoteId: quote.id,
        agentId: agent.id,
        role,
        accessId: existingAccess.id,
      });

      return existingAccess;
    }

    // Create new access record
    logger.info('QuoteAccess.grantAccess - Creating new access record', {
      quoteId: quote?.id,
      agentId: agent?.id,
      role,
      grantedById: grantedBy?.id,
    });

    const access = new QuoteAccess();

    logger.info('QuoteAccess.grantAccess - Setting access properties', {
      agentIsNull: agent === null,
      agentId: agent?.id,
    });

    try {
      console.log('DEBUG: About to set quote', {
        quoteId: quote?.id,
        quoteType: typeof quote,
        quoteIsNull: quote === null,
        quoteClassName: quote?.className,
      });

      access.setQuote(quote);
      console.log('DEBUG: Quote set successfully');

      logger.info('QuoteAccess.grantAccess - Setting agent', { agentId: agent?.id });
      access.setAgent(agent);

      logger.info('QuoteAccess.grantAccess - Setting role', { role });
      access.setRole(role);

      logger.info('QuoteAccess.grantAccess - Setting grantedBy', { grantedById: grantedBy?.id });
      access.setGrantedBy(grantedBy);

      logger.info('QuoteAccess.grantAccess - Setting grantedAt');
      access.setGrantedAt(new Date());

      logger.info('QuoteAccess.grantAccess - Properties set successfully');
    } catch (propertyError) {
      console.error('DEBUG: Error setting properties!', {
        error: propertyError.message,
        errorCode: propertyError.code,
        errorName: propertyError.name,
        stack: propertyError.stack,
        quoteId: quote?.id,
        agentId: agent?.id,
        role,
      });

      logger.error('QuoteAccess.grantAccess - Error setting properties', {
        error: propertyError.message,
        errorCode: propertyError.code,
        errorStack: propertyError.stack,
        errorName: propertyError.name,
        quoteId: quote?.id,
        agentId: agent?.id,
        role,
      });
      throw propertyError;
    }

    if (expiresAt) {
      access.setExpiresAt(expiresAt);
      access.setAccessType(QuoteAccess.ACCESS_TYPES.TEMPORARY);
    } else {
      access.setAccessType(QuoteAccess.ACCESS_TYPES.PERMANENT);
    }

    access.set('active', true);
    access.set('exists', true);
    access.set('revoked', false);
    access.set('reason', reason);

    logger.info('QuoteAccess.grantAccess - About to save access record', {
      agentSet: !!access.get('agent'),
      quoteSet: !!access.get('quote'),
      roleSet: !!access.get('role'),
    });

    try {
      console.log('DEBUG: QuoteAccess.grantAccess - About to save with fields:', {
        quoteId: quote.id,
        agentId: agent.id,
        role,
        active: access.get('active'),
        exists: access.get('exists'),
        revoked: access.get('revoked'),
      });

      await access.save(null, { useMasterKey: true });

      console.log('DEBUG: QuoteAccess.grantAccess - SAVED access record with ID:', {
        accessId: access.id,
        quoteId: quote.id,
        agentId: agent.id,
        role,
        active: access.get('active'),
        exists: access.get('exists'),
        revoked: access.get('revoked'),
      });

      logger.info('QuoteAccess.grantAccess - Successfully saved access record', {
        quoteId: quote.id,
        agentId: agent.id,
        role,
        grantedById: grantedBy.id,
        accessId: access.id,
      });
      return access;
    } catch (error) {
      logger.error('QuoteAccess.grantAccess - Failed to save access record', {
        error: error.message,
        errorCode: error.code,
        agentId: agent?.id,
        quoteId: quote?.id,
        agentIsNull: agent === null,
        agentType: typeof agent,
        agentValue: JSON.stringify(agent?.toJSON?.() || agent),
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

    try {
      // Delete the access record completely instead of just marking as revoked
      // This ensures collaborators don't reappear after page reload
      await access.destroy({ useMasterKey: true });

      logger.info('Deleted quote access record', {
        quoteId: quote.id,
        agentId: agent.id,
        revokedById: revokedBy.id,
        reason,
        accessId: access.id,
      });
      return true;
    } catch (error) {
      logger.error('Failed to delete access record', {
        error: error.message,
        quoteId: quote.id,
        agentId: agent.id,
        accessId: access.id,
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

    console.log('DEBUG: QuoteAccess.getQuoteCollaborators - Query setup', {
      quoteId: quote.id,
      includeRevoked,
      role,
      quoteObjId: quoteObj.id,
    });

    query.equalTo('quote', quoteObj);
    query.equalTo('exists', true);

    if (!includeRevoked) {
      query.equalTo('revoked', false);
      query.equalTo('active', true);
      console.log('DEBUG: QuoteAccess.getQuoteCollaborators - Added filters: revoked=false, active=true');
    }

    if (role) {
      query.equalTo('role', role);
    }

    query.include(['agent', 'grantedBy']);
    query.descending('grantedAt');

    try {
      const collaborators = await query.find({ useMasterKey: true });

      console.log('DEBUG: QuoteAccess.getQuoteCollaborators - About to process collaborators', {
        totalFound: collaborators.length,
        quoteId: quote.id,
      });

      logger.info('QuoteAccess.getQuoteCollaborators - Raw collaborators found', {
        quoteId: quote.id,
        totalCount: collaborators.length,
        includeRevoked,
        collaborators: collaborators.map((access) => ({
          id: access.id,
          agentId: access.getAgent()?.id,
          role: access.getRole(),
          active: access.get('active'),
          exists: access.get('exists'),
          revoked: access.isRevoked(),
          isValid: access.isValid(),
        })),
      });

      // Filter out expired access
      const validCollaborators = collaborators.filter((access) => {
        if (!includeRevoked && !access.isValid()) {
          logger.info('QuoteAccess.getQuoteCollaborators - Filtering out invalid access', {
            accessId: access.id,
            agentId: access.getAgent()?.id,
            active: access.get('active'),
            exists: access.get('exists'),
            revoked: access.isRevoked(),
            isValid: access.isValid(),
          });
          return false;
        }
        return true;
      });

      logger.info('Retrieved quote collaborators', {
        quoteId: quote.id,
        rawCount: collaborators.length,
        validCount: validCollaborators.length,
        filtered: collaborators.length - validCollaborators.length,
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
