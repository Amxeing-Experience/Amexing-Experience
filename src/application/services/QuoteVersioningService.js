/**
 * QuoteVersioningService - Business logic for quote version control.
 * Handles edit tracking, approval workflows, and version restoration.
 *
 * Features:
 * - Track all quote changes with diffs
 * - Handle approval/rejection of edits
 * - Restore previous versions
 * - Generate change summaries
 * - Manage concurrent edit conflicts.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const _ = require('lodash');
const Quote = require('../../domain/models/Quote');
const QuoteEdit = require('../../domain/models/QuoteEdit');
const QuoteOwnership = require('../../domain/models/QuoteOwnership');
const QuoteAccess = require('../../domain/models/QuoteAccess');
const logger = require('../../infrastructure/logger');

/**
 * Service class for managing quote versions and edit history.
 */
class QuoteVersioningService {
  constructor() {
    this.Quote = Quote;
    this.QuoteEdit = QuoteEdit;
    this.QuoteOwnership = QuoteOwnership;
    this.QuoteAccess = QuoteAccess;
  }

  /**
   * Record an edit to a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} editorId - Editor user ID.
   * @param {object} changes - Changes to record.
   * @param {object} options - Additional options.
   * @returns {Promise<object>} Edit record.
   * @example
   */
  async recordEdit(quoteId, editorId, changes, options = {}) {
    try {
      const quote = await this.getQuoteById(quoteId);
      const editor = await this.getUserById(editorId);

      if (!quote || !editor) {
        throw new Error('Quote or editor not found');
      }

      // Check edit permissions
      const canEdit = await this.canEdit(quoteId, editorId);
      if (!canEdit) {
        throw new Error('User does not have permission to edit this quote');
      }

      // Determine edit type
      const editType = this.determineEditType(changes);

      // Get previous values
      const previousValues = {};
      const newValues = {};
      const changedFields = Object.keys(changes);

      for (const field of changedFields) {
        previousValues[field] = quote.get(field);
        newValues[field] = changes[field];
      }

      // Check if owner is editing (auto-approve)
      const isOwner = await QuoteOwnership.isOwner(quote, editor);

      // Determine editor role
      let editorRole = 'viewer';
      if (isOwner) {
        editorRole = 'owner';
      } else {
        const access = await QuoteAccess.getAgentAccess(quote, editor);
        if (access && access.isValid()) {
          editorRole = access.getRole();
        }
      }

      // Create edit record
      const edit = await QuoteEdit.recordEdit(
        quote,
        editor,
        editType,
        changes,
        {
          previousValues,
          newValues,
          description: options.description || this.generateEditDescription(editType, changes),
          editorRole,
          autoApprove: isOwner || !quote.requiresApproval(),
        }
      );

      // If auto-approved or owner edit, apply changes
      if (edit.getApprovalStatus() === QuoteEdit.APPROVAL_STATUS.AUTO_APPROVED || isOwner) {
        await this.applyChanges(quote, changes, editor);
      }

      logger.info('Recorded quote edit', {
        quoteId,
        editorId,
        editId: edit.id,
        version: edit.getVersion(),
        autoApproved: edit.getApprovalStatus() === QuoteEdit.APPROVAL_STATUS.AUTO_APPROVED,
      });

      return this.formatEditResponse(edit);
    } catch (error) {
      logger.error('Failed to record edit', {
        error: error.message,
        quoteId,
        editorId,
      });
      throw error;
    }
  }

  /**
   * Approve a pending edit.
   * @param {string} editId - Edit ID.
   * @param {string} approverId - Approver user ID.
   * @param {string} comment - Approval comment.
   * @returns {Promise<object>} Updated edit record.
   * @example
   */
  async approveEdit(editId, approverId, comment = '') {
    try {
      const approver = await this.getUserById(approverId);
      if (!approver) {
        throw new Error('Approver not found');
      }

      // Get the edit
      const edit = await QuoteEdit.approveEdit(editId, approver, comment);

      // Get the quote
      const quote = edit.getQuote();

      // Check approval permission
      const canApprove = await this.canApproveEdits(quote.id, approverId);
      if (!canApprove) {
        throw new Error('User does not have permission to approve edits');
      }

      // Apply the changes
      const changes = edit.getChanges();
      const editor = edit.getEditor();
      await this.applyChanges(quote, changes, editor);

      // Update quote approval status
      const pendingEdits = await QuoteEdit.getPendingEdits(quote);
      if (pendingEdits.length === 0) {
        quote.setApprovalStatus(null);
      }
      await quote.save(null, { useMasterKey: true });

      logger.info('Approved quote edit', {
        editId,
        quoteId: quote.id,
        approverId,
      });

      return this.formatEditResponse(edit);
    } catch (error) {
      logger.error('Failed to approve edit', {
        error: error.message,
        editId,
        approverId,
      });
      throw error;
    }
  }

  /**
   * Reject a pending edit.
   * @param {string} editId - Edit ID.
   * @param {string} rejectorId - Rejector user ID.
   * @param {string} reason - Rejection reason.
   * @returns {Promise<object>} Updated edit record.
   * @example
   */
  async rejectEdit(editId, rejectorId, reason = '') {
    try {
      const rejector = await this.getUserById(rejectorId);
      if (!rejector) {
        throw new Error('Rejector not found');
      }

      // Get the edit
      const edit = await QuoteEdit.rejectEdit(editId, rejector, reason);

      // Get the quote
      const quote = edit.getQuote();

      // Check rejection permission
      const canReject = await this.canApproveEdits(quote.id, rejectorId);
      if (!canReject) {
        throw new Error('User does not have permission to reject edits');
      }

      // Update quote approval status
      const pendingEdits = await QuoteEdit.getPendingEdits(quote);
      if (pendingEdits.length === 0) {
        quote.setApprovalStatus(null);
      }
      await quote.save(null, { useMasterKey: true });

      logger.info('Rejected quote edit', {
        editId,
        quoteId: quote.id,
        rejectorId,
        reason,
      });

      return this.formatEditResponse(edit);
    } catch (error) {
      logger.error('Failed to reject edit', {
        error: error.message,
        editId,
        rejectorId,
      });
      throw error;
    }
  }

  /**
   * Get edit history for a quote.
   * @param {string} quoteId - Quote ID.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Edit history.
   * @example
   */
  async getEditHistory(quoteId, options = {}) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      const history = await QuoteEdit.getEditHistory(quote, options);

      return history.map((edit) => this.formatEditResponse(edit));
    } catch (error) {
      logger.error('Failed to get edit history', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }

  /**
   * Get pending edits for approval.
   * @param {string} quoteId - Quote ID.
   * @returns {Promise<Array>} Pending edits.
   * @example
   */
  async getPendingEdits(quoteId) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      const pendingEdits = await QuoteEdit.getPendingEdits(quote);

      return pendingEdits.map((edit) => this.formatEditResponse(edit));
    } catch (error) {
      logger.error('Failed to get pending edits', {
        error: error.message,
        quoteId,
      });
      throw error;
    }
  }

  /**
   * Restore a previous version of a quote.
   * @param {string} quoteId - Quote ID.
   * @param {number} version - Version to restore.
   * @param {string} restoredById - User restoring the version.
   * @returns {Promise<object>} New edit record for the restoration.
   * @example
   */
  async restoreVersion(quoteId, version, restoredById) {
    try {
      const quote = await this.getQuoteById(quoteId);
      const restoredBy = await this.getUserById(restoredById);

      if (!quote || !restoredBy) {
        throw new Error('Quote or user not found');
      }

      // Check permission to restore
      const canRestore = await this.canRestore(quoteId, restoredById);
      if (!canRestore) {
        throw new Error('User does not have permission to restore versions');
      }

      // Find the version to restore
      const versionQuery = new Parse.Query('QuoteEdit');
      versionQuery.equalTo('quote', quote);
      versionQuery.equalTo('version', version);
      versionQuery.equalTo('exists', true);

      const versionEdit = await versionQuery.first({ useMasterKey: true });
      if (!versionEdit) {
        throw new Error(`Version ${version} not found`);
      }

      // Get the values from that version
      const valuesToRestore = versionEdit.getNewValues();

      // Create restoration edit
      const restorationEdit = await QuoteEdit.recordEdit(
        quote,
        restoredBy,
        QuoteEdit.EDIT_TYPES.RESTORE,
        valuesToRestore,
        {
          previousValues: this.getCurrentValues(quote, Object.keys(valuesToRestore)),
          newValues: valuesToRestore,
          description: `Restored to version ${version}`,
          autoApprove: await QuoteOwnership.isOwner(quote, restoredBy),
        }
      );

      // Apply the restoration if auto-approved
      if (restorationEdit.getApprovalStatus() === QuoteEdit.APPROVAL_STATUS.AUTO_APPROVED) {
        await this.applyChanges(quote, valuesToRestore, restoredBy);
      }

      logger.info('Restored quote version', {
        quoteId,
        version,
        restoredById,
        newVersion: restorationEdit.getVersion(),
      });

      return this.formatEditResponse(restorationEdit);
    } catch (error) {
      logger.error('Failed to restore version', {
        error: error.message,
        quoteId,
        version,
        restoredById,
      });
      throw error;
    }
  }

  /**
   * Get diff between two versions.
   * @param {string} quoteId - Quote ID.
   * @param {number} fromVersion - Starting version.
   * @param {number} toVersion - Ending version.
   * @returns {Promise<object>} Diff between versions.
   * @example
   */
  async getVersionDiff(quoteId, fromVersion, toVersion) {
    try {
      const quote = await this.getQuoteById(quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      // Get both versions
      const versionQuery = new Parse.Query('QuoteEdit');
      versionQuery.equalTo('quote', quote);
      versionQuery.containedIn('version', [fromVersion, toVersion]);
      versionQuery.equalTo('exists', true);

      const versions = await versionQuery.find({ useMasterKey: true });

      const fromEdit = versions.find((e) => e.getVersion() === fromVersion);
      const toEdit = versions.find((e) => e.getVersion() === toVersion);

      if (!fromEdit || !toEdit) {
        throw new Error('One or both versions not found');
      }

      // Generate diff
      const diff = {
        fromVersion,
        toVersion,
        fromDate: fromEdit.getEditedAt(),
        toDate: toEdit.getEditedAt(),
        fromEditor: this.formatUserInfo(fromEdit.getEditor()),
        toEditor: this.formatUserInfo(toEdit.getEditor()),
        changes: this.generateDiff(fromEdit.getNewValues(), toEdit.getNewValues()),
      };

      return diff;
    } catch (error) {
      logger.error('Failed to get version diff', {
        error: error.message,
        quoteId,
        fromVersion,
        toVersion,
      });
      throw error;
    }
  }

  // ================
  // PERMISSION CHECKS
  // ================

  /**
   * Check if user can edit a quote.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<boolean>} True if user can edit.
   * @example
   */
  async canEdit(quoteId, userId) {
    // Owner can always edit
    const isOwner = await QuoteOwnership.isOwner(quoteId, userId);
    if (isOwner) {
      return true;
    }

    // Check if user has editor access
    const quote = await this.getQuoteById(quoteId);
    const user = await this.getUserById(userId);

    if (!quote || !user) {
      return false;
    }

    return QuoteAccess.hasAccess(quote, user, QuoteAccess.ROLES.EDITOR);
  }

  /**
   * Check if user can approve/reject edits.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<boolean>} True if user can approve edits.
   * @example
   */
  async canApproveEdits(quoteId, userId) {
    return QuoteOwnership.isOwner(quoteId, userId);
  }

  /**
   * Check if user can restore versions.
   * @param {string} quoteId - Quote ID.
   * @param {string} userId - User ID.
   * @returns {Promise<boolean>} True if user can restore.
   * @example
   */
  async canRestore(quoteId, userId) {
    return QuoteOwnership.isOwner(quoteId, userId);
  }

  // ================
  // HELPER METHODS
  // ================

  /**
   * Apply changes to a quote.
   * @param {object} quote - Quote object.
   * @param {object} changes - Changes to apply.
   * @param {object} editor - Editor user.
   * @returns {Promise<void>}
   * @example
   */
  async applyChanges(quote, changes, editor) {
    for (const [field, value] of Object.entries(changes)) {
      quote.set(field, value);
    }

    quote.setLastEditedBy(editor);
    quote.setLastEditedAt(new Date());
    quote.incrementVersion();

    await quote.save(null, { useMasterKey: true });
  }

  /**
   * Determine edit type from changes.
   * @param {object} changes - Changes object.
   * @returns {string} Edit type.
   * @example
   */
  determineEditType(changes) {
    const fields = Object.keys(changes);

    if (fields.includes('serviceItems')) {
      const { serviceItems } = changes;
      if (serviceItems && serviceItems.days) {
        return QuoteEdit.EDIT_TYPES.SERVICE_MODIFY;
      }
    }

    if (fields.includes('client')) {
      return QuoteEdit.EDIT_TYPES.CLIENT_CHANGE;
    }

    if (fields.includes('status')) {
      return QuoteEdit.EDIT_TYPES.STATUS_CHANGE;
    }

    return QuoteEdit.EDIT_TYPES.UPDATE;
  }

  /**
   * Generate edit description.
   * @param {string} editType - Type of edit.
   * @param {object} changes - Changes made.
   * @returns {string} Description.
   * @example
   */
  generateEditDescription(editType, changes) {
    const fields = Object.keys(changes);

    switch (editType) {
      case QuoteEdit.EDIT_TYPES.SERVICE_ADD:
        return 'Added new service';
      case QuoteEdit.EDIT_TYPES.SERVICE_MODIFY:
        return 'Modified services';
      case QuoteEdit.EDIT_TYPES.SERVICE_REMOVE:
        return 'Removed service';
      case QuoteEdit.EDIT_TYPES.CLIENT_CHANGE:
        return 'Changed client information';
      case QuoteEdit.EDIT_TYPES.STATUS_CHANGE:
        return `Changed status to ${changes.status}`;
      default:
        return `Updated ${fields.join(', ')}`;
    }
  }

  /**
   * Get current values for fields.
   * @param {object} quote - Quote object.
   * @param {Array<string>} fields - Field names.
   * @returns {object} Current values.
   * @example
   */
  getCurrentValues(quote, fields) {
    const values = {};
    for (const field of fields) {
      values[field] = quote.get(field);
    }
    return values;
  }

  /**
   * Generate diff between two sets of values.
   * @param {object} oldValues - Old values.
   * @param {object} newValues - New values.
   * @returns {Array} Diff array.
   * @example
   */
  generateDiff(oldValues, newValues) {
    const diff = [];
    const allFields = _.union(Object.keys(oldValues), Object.keys(newValues));

    for (const field of allFields) {
      const oldValue = oldValues[field];
      const newValue = newValues[field];

      if (!_.isEqual(oldValue, newValue)) {
        diff.push({
          field,
          oldValue,
          newValue,
          type: this.getDiffType(oldValue, newValue),
        });
      }
    }

    return diff;
  }

  /**
   * Get diff type.
   * @param {any} oldValue - Old value.
   * @param {any} newValue - New value.
   * @returns {string} Diff type (added, removed, modified).
   * @example
   */
  getDiffType(oldValue, newValue) {
    if (oldValue === undefined || oldValue === null) {
      return 'added';
    }
    if (newValue === undefined || newValue === null) {
      return 'removed';
    }
    return 'modified';
  }

  /**
   * Get quote by ID.
   * @param {string} quoteId - Quote ID.
   * @returns {Promise<object>} Quote object.
   * @example
   */
  async getQuoteById(quoteId) {
    const query = new Parse.Query('Quote');
    query.equalTo('exists', true);

    try {
      const quote = await query.get(quoteId, { useMasterKey: true });
      return quote;
    } catch (error) {
      logger.error('Quote not found', { quoteId, error: error.message });
      return null;
    }
  }

  /**
   * Get user by ID.
   * @param {string} userId - User ID.
   * @returns {Promise<object>} User object.
   * @example
   */
  async getUserById(userId) {
    const query = new Parse.Query('AmexingUser');
    query.equalTo('exists', true);

    try {
      const user = await query.get(userId, { useMasterKey: true });
      return user;
    } catch (error) {
      logger.error('User not found', { userId, error: error.message });
      return null;
    }
  }

  /**
   * Format user info.
   * @param {object} user - User object.
   * @returns {object} Formatted user info.
   * @example
   */
  formatUserInfo(user) {
    if (!user) return null;

    return {
      id: user.id,
      username: user.get('username'),
      email: user.get('email'),
      firstName: user.get('firstName'),
      lastName: user.get('lastName'),
    };
  }

  /**
   * Format edit response.
   * @param {object} edit - QuoteEdit object.
   * @returns {object} Formatted response.
   * @example
   */
  formatEditResponse(edit) {
    return {
      id: edit.id,
      version: edit.getVersion(),
      editType: edit.getEditType(),
      editor: this.formatUserInfo(edit.getEditor()),
      editorRole: edit.getEditorRole(),
      editedAt: edit.getEditedAt(),
      approvalStatus: edit.getApprovalStatus(),
      approvedBy: this.formatUserInfo(edit.getApprovedBy()),
      approvedAt: edit.getApprovedAt(),
      approvalComment: edit.getApprovalComment(),
      description: edit.getDescription(),
      changedFields: edit.getChangedFields(),
      changes: edit.getChanges(),
      previousValues: edit.getPreviousValues(),
      newValues: edit.getNewValues(),
      isApplied: edit.isApplied(),
      createdAt: edit.createdAt,
    };
  }
}

module.exports = QuoteVersioningService;
