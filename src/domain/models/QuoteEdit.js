/**
 * QuoteEdit - Domain model for quote edit history tracking.
 * Tracks all changes made to quotes with version control and approval workflow.
 *
 * Features:
 * - Track all edits with timestamps and user attribution
 * - Store change diffs for version comparison
 * - Support approval/rejection workflow
 * - Enable version restoration
 * - Maintain complete audit trail.
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
 * QuoteEdit class for tracking quote modifications.
 * @class QuoteEdit
 * @augments BaseModel
 */
class QuoteEdit extends BaseModel {
  constructor() {
    super('QuoteEdit');
  }

  // =================
  // CONSTANTS
  // =================

  static get EDIT_TYPES() {
    return {
      CREATE: 'create',
      UPDATE: 'update',
      DELETE: 'delete',
      RESTORE: 'restore',
      SERVICE_ADD: 'service_add',
      SERVICE_MODIFY: 'service_modify',
      SERVICE_REMOVE: 'service_remove',
      CLIENT_CHANGE: 'client_change',
      STATUS_CHANGE: 'status_change',
      APPROVAL: 'approval',
      REJECTION: 'rejection',
    };
  }

  static get APPROVAL_STATUS() {
    return {
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      AUTO_APPROVED: 'auto_approved',
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
    console.log('DEBUG: QuoteEdit.setQuote() called', {
      quoteId: quote?.id,
      quoteClassName: quote?.className,
      quoteIsParseObject: quote instanceof Parse.Object,
      quoteType: typeof quote,
    });

    try {
      this.set('quote', quote);
      console.log('DEBUG: QuoteEdit.setQuote() - set() completed successfully');
    } catch (setError) {
      console.log('DEBUG: QuoteEdit.setQuote() - set() failed', {
        error: setError.message,
        stack: setError.stack,
      });
      throw setError;
    }
  }

  /**
   * Get editor reference.
   * @returns {object} AmexingUser who made the edit.
   * @example
   */
  getEditor() {
    return this.get('editor');
  }

  /**
   * Set editor reference.
   * @param {object} editor - AmexingUser Parse object or Pointer.
   * @example
   */
  setEditor(editor) {
    this.set('editor', editor);
  }

  /**
   * Get edit type.
   * @returns {string} Type of edit made.
   * @example
   */
  getEditType() {
    return this.get('editType');
  }

  /**
   * Set edit type.
   * @param {string} type - Type of edit from EDIT_TYPES.
   * @example
   */
  setEditType(type) {
    if (!Object.values(QuoteEdit.EDIT_TYPES).includes(type)) {
      throw new Error(`Invalid edit type: ${type}`);
    }
    this.set('editType', type);
  }

  /**
   * Get version number.
   * @returns {number} Version number of this edit.
   * @example
   */
  getVersion() {
    return this.get('version') || 1;
  }

  /**
   * Set version number.
   * @param {number} version - Version number.
   * @example
   */
  setVersion(version) {
    this.set('version', version);
  }

  /**
   * Get changes object.
   * @returns {object} JSON object containing the changes.
   * @example
   */
  getChanges() {
    return this.get('changes') || {};
  }

  /**
   * Set changes object.
   * @param {object} changes - Changes made in this edit.
   * @example
   */
  setChanges(changes) {
    this.set('changes', changes);
  }

  /**
   * Get previous values.
   * @returns {object} Previous values before the edit.
   * @example
   */
  getPreviousValues() {
    return this.get('previousValues') || {};
  }

  /**
   * Set previous values.
   * @param {object} values - Previous values before the edit.
   * @example
   */
  setPreviousValues(values) {
    this.set('previousValues', values);
  }

  /**
   * Get new values.
   * @returns {object} New values after the edit.
   * @example
   */
  getNewValues() {
    return this.get('newValues') || {};
  }

  /**
   * Set new values.
   * @param {object} values - New values after the edit.
   * @example
   */
  setNewValues(values) {
    this.set('newValues', values);
  }

  /**
   * Get field names that were changed.
   * @returns {Array<string>} Array of field names.
   * @example
   */
  getChangedFields() {
    return this.get('changedFields') || [];
  }

  /**
   * Set changed field names.
   * @param {Array<string>} fields - Field names that were changed.
   * @example
   */
  setChangedFields(fields) {
    this.set('changedFields', fields);
  }

  /**
   * Get edit timestamp.
   * @returns {Date} When the edit was made.
   * @example
   */
  getEditedAt() {
    return this.get('editedAt');
  }

  /**
   * Set edit timestamp.
   * @param {Date} date - When the edit was made.
   * @example
   */
  setEditedAt(date) {
    this.set('editedAt', date);
  }

  /**
   * Get approval status.
   * @returns {string} Approval status of the edit.
   * @example
   */
  getApprovalStatus() {
    return this.get('approvalStatus') || QuoteEdit.APPROVAL_STATUS.PENDING;
  }

  /**
   * Set approval status.
   * @param {string} status - Approval status from APPROVAL_STATUS.
   * @example
   */
  setApprovalStatus(status) {
    if (!Object.values(QuoteEdit.APPROVAL_STATUS).includes(status)) {
      throw new Error(`Invalid approval status: ${status}`);
    }
    this.set('approvalStatus', status);
  }

  /**
   * Get approver reference.
   * @returns {object} AmexingUser who approved/rejected the edit.
   * @example
   */
  getApprovedBy() {
    return this.get('approvedBy');
  }

  /**
   * Set approver reference.
   * @param {object} user - AmexingUser Parse object or Pointer.
   * @example
   */
  setApprovedBy(user) {
    this.set('approvedBy', user);
  }

  /**
   * Get approval date.
   * @returns {Date} When the edit was approved/rejected.
   * @example
   */
  getApprovedAt() {
    return this.get('approvedAt');
  }

  /**
   * Set approval date.
   * @param {Date} date - When the edit was approved/rejected.
   * @example
   */
  setApprovedAt(date) {
    this.set('approvedAt', date);
  }

  /**
   * Get approval comment.
   * @returns {string} Comment from approver.
   * @example
   */
  getApprovalComment() {
    return this.get('approvalComment');
  }

  /**
   * Set approval comment.
   * @param {string} comment - Comment from approver.
   * @example
   */
  setApprovalComment(comment) {
    this.set('approvalComment', comment);
  }

  /**
   * Get edit description.
   * @returns {string} Human-readable description of the edit.
   * @example
   */
  getDescription() {
    return this.get('description');
  }

  /**
   * Set edit description.
   * @param {string} description - Description of the edit.
   * @example
   */
  setDescription(description) {
    this.set('description', description);
  }

  /**
   * Get editor role at time of edit.
   * @returns {string} Role the editor had when making the edit.
   * @example
   */
  getEditorRole() {
    return this.get('editorRole');
  }

  /**
   * Set editor role.
   * @param {string} role - Role of the editor.
   * @example
   */
  setEditorRole(role) {
    this.set('editorRole', role);
  }

  /**
   * Check if this edit is applied.
   * @returns {boolean} True if edit is currently applied.
   * @example
   */
  isApplied() {
    return this.get('isApplied') === true;
  }

  /**
   * Set applied status.
   * @param {boolean} applied - Whether edit is applied.
   * @example
   */
  setIsApplied(applied) {
    this.set('isApplied', applied);
  }

  // ================
  // VALIDATION
  // ================

  /**
   * Validate edit data before save.
   * @param {object} attrs - Attributes being set.
   * @returns {Parse.Error|undefined} Returns Parse.Error if validation fails.
   * @example
   */
  validate(attrs) {
    console.log('DEBUG: QuoteEdit.validate() called', {
      attrs,
      attrsKeys: Object.keys(attrs || {}),
      hasQuote: this.has('quote'),
      hasEditor: this.has('editor'),
      hasEditType: this.has('editType'),
      isNew: this.isNew(),
    });

    const parentError = super.validate(attrs);
    if (parentError) {
      console.log('DEBUG: QuoteEdit.validate() - Parent validation failed', {
        errorMessage: parentError.message,
        errorCode: parentError.code,
      });
      return parentError;
    }

    // Only run full validation during save operations (when multiple fields are being set)
    // or when the object already has most required fields
    const isSaveOperation = (attrs.quote && attrs.editor && attrs.editType)
                           || (attrs.quote && attrs.editor)
                           || (Object.keys(attrs).length >= 3)
                           || (!this.isNew() && this.has('quote') && this.has('editor') && this.has('editType'));

    if (!isSaveOperation) {
      console.log('DEBUG: QuoteEdit.validate() - Skipping validation (individual property setting)');
      return undefined;
    }

    // Quote is required
    if (!attrs.quote && !this.has('quote')) {
      console.log('DEBUG: QuoteEdit.validate() - Quote is required');
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Quote is required');
    }

    // Editor is required
    if (!attrs.editor && !this.has('editor')) {
      console.log('DEBUG: QuoteEdit.validate() - Editor is required');
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Editor is required');
    }

    // Edit type is required
    if (!attrs.editType && !this.has('editType')) {
      console.log('DEBUG: QuoteEdit.validate() - Edit type is required');
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Edit type is required');
    }

    console.log('DEBUG: QuoteEdit.validate() - Validation passed');
    return undefined;
  }

  // ================
  // STATIC METHODS
  // ================

  /**
   * Record a new edit to a quote.
   * @param {object} quote - Quote Parse object.
   * @param {object} editor - AmexingUser making the edit.
   * @param {string} editType - Type of edit from EDIT_TYPES.
   * @param {object} changes - Changes being made.
   * @param {object} options - Additional options.
   * @returns {Promise<QuoteEdit>} Created edit record.
   * @example
   */
  static async recordEdit(quote, editor, editType, changes, options = {}) {
    logger.info('QuoteEdit.recordEdit - Method called', {
      quoteId: quote?.id,
      editorId: editor?.id,
      editType,
      changes,
      options,
    });

    const {
      previousValues = {},
      newValues = {},
      description = '',
      editorRole = 'editor',
      autoApprove = false,
    } = options;

    logger.info('QuoteEdit.recordEdit - Starting version query', {
      quoteId: quote?.id,
      hasQuote: !!quote,
    });

    // Get the latest version number
    const versionQuery = new Parse.Query('QuoteEdit');
    versionQuery.equalTo('quote', quote);
    versionQuery.descending('version');
    versionQuery.limit(1);

    let latestVersion = 0;
    try {
      logger.info('QuoteEdit.recordEdit - Executing version query');
      const latestEdit = await versionQuery.first({ useMasterKey: true });
      if (latestEdit) {
        latestVersion = latestEdit.getVersion();
        logger.info('QuoteEdit.recordEdit - Found latest version', { latestVersion });
      } else {
        logger.info('QuoteEdit.recordEdit - No previous edits found, starting at version 0');
      }
    } catch (error) {
      logger.error('QuoteEdit.recordEdit - Could not get latest version', {
        error: error.message,
        stack: error.stack,
        errorCode: error.code,
      });
      // Don't throw here, continue with version 0
    }

    logger.info('QuoteEdit.recordEdit - Creating new edit record', {
      quoteId: quote?.id,
      editorId: editor?.id,
      editType,
      newVersion: latestVersion + 1,
    });

    // Create new edit record
    let edit;
    try {
      logger.info('QuoteEdit.recordEdit - Creating QuoteEdit instance');
      edit = new QuoteEdit();

      // Safe logging without circular reference issues
      const quoteDebugInfo = {
        quoteId: quote?.id,
        quoteClassName: quote?.className,
        quoteIsParseObject: quote instanceof Parse.Object,
        quoteType: typeof quote,
        quoteKeys: quote ? Object.keys(quote) : null,
      };

      // Try to add more info if possible
      try {
        if (quote && quote.toJSON) {
          quoteDebugInfo.quoteJSON = quote.toJSON();
        }
      } catch (jsonError) {
        quoteDebugInfo.jsonError = jsonError.message;
      }

      logger.info('QuoteEdit.recordEdit - Setting quote', quoteDebugInfo);

      // Validate the quote object
      if (!quote) {
        throw new Error('Quote object is null or undefined');
      }
      if (!(quote instanceof Parse.Object)) {
        throw new Error(`Quote is not a Parse.Object instance. Type: ${typeof quote}, className: ${quote.className}`);
      }

      // Try wrapping setQuote in try-catch to get more specific error
      try {
        edit.setQuote(quote);
        logger.info('QuoteEdit.recordEdit - Quote set successfully');
      } catch (setQuoteError) {
        logger.error('QuoteEdit.recordEdit - Failed to set quote', {
          error: setQuoteError.message,
          stack: setQuoteError.stack,
          errorCode: setQuoteError.code,
          errorName: setQuoteError.name,
        });
        throw new Error(`Failed to set quote on QuoteEdit: ${setQuoteError.message}`);
      }

      logger.info('QuoteEdit.recordEdit - Setting editor');
      edit.setEditor(editor);

      logger.info('QuoteEdit.recordEdit - Setting edit type');
      edit.setEditType(editType);

      logger.info('QuoteEdit.recordEdit - Setting version');
      edit.setVersion(latestVersion + 1);

      logger.info('QuoteEdit.recordEdit - Setting changes');
      edit.setChanges(changes);

      logger.info('QuoteEdit.recordEdit - Setting previous values');
      edit.setPreviousValues(previousValues);

      logger.info('QuoteEdit.recordEdit - Setting new values');
      edit.setNewValues(newValues);

      logger.info('QuoteEdit.recordEdit - Setting edited at');
      edit.setEditedAt(new Date());

      logger.info('QuoteEdit.recordEdit - Setting description');
      edit.setDescription(description);

      logger.info('QuoteEdit.recordEdit - Setting editor role');
      edit.setEditorRole(editorRole);

      logger.info('QuoteEdit.recordEdit - Setting is applied');
      edit.setIsApplied(true);

      // Extract changed field names
      logger.info('QuoteEdit.recordEdit - Setting changed fields');
      const changedFields = Object.keys(changes);
      edit.setChangedFields(changedFields);

      // Set approval status
      logger.info('QuoteEdit.recordEdit - Setting approval status', { autoApprove, editorRole });
      if (autoApprove || editorRole === 'owner') {
        edit.setApprovalStatus(QuoteEdit.APPROVAL_STATUS.AUTO_APPROVED);
        edit.setApprovedBy(editor);
        edit.setApprovedAt(new Date());
      } else {
        edit.setApprovalStatus(QuoteEdit.APPROVAL_STATUS.PENDING);
      }

      logger.info('QuoteEdit.recordEdit - Setting base fields');
      edit.set('active', true);
      edit.set('exists', true);

      logger.info('QuoteEdit.recordEdit - Object creation completed successfully');
    } catch (creationError) {
      logger.error('QuoteEdit.recordEdit - Error during object creation', {
        error: creationError.message,
        stack: creationError.stack,
        errorCode: creationError.code,
      });
      throw creationError;
    }

    try {
      logger.info('QuoteEdit.recordEdit - About to save edit record', {
        quoteId: quote.id,
        editorId: editor.id,
        editType,
        version: edit.getVersion(),
        hasQuote: !!edit.get('quote'),
        hasEditor: !!edit.get('editor'),
        hasEditType: !!edit.get('editType'),
        changes,
        description,
        autoApprove,
      });

      await edit.save(null, { useMasterKey: true });

      logger.info('Recorded quote edit', {
        quoteId: quote.id,
        editorId: editor.id,
        editType,
        version: edit.getVersion(),
        editId: edit.id,
      });
      return edit;
    } catch (error) {
      logger.error('Failed to record edit', {
        error: error.message,
        stack: error.stack,
        errorCode: error.code,
        errorName: error.name,
        quoteId: quote.id,
        editorId: editor.id,
        editType,
        version: edit.getVersion(),
        hasQuote: !!edit.get('quote'),
        hasEditor: !!edit.get('editor'),
        hasEditType: !!edit.get('editType'),
        validationError: error.message?.includes('validation') || error.code === Parse.Error.VALIDATION_ERROR,
      });
      throw error;
    }
  }

  /**
   * Approve an edit.
   * @param {string} editId - ID of the edit to approve.
   * @param {object} approver - AmexingUser approving the edit.
   * @param {string} comment - Approval comment.
   * @returns {Promise<QuoteEdit>} Updated edit record.
   * @example
   */
  static async approveEdit(editId, approver, comment = '') {
    const query = new Parse.Query('QuoteEdit');

    try {
      const edit = await query.get(editId, { useMasterKey: true });

      if (edit.getApprovalStatus() !== QuoteEdit.APPROVAL_STATUS.PENDING) {
        throw new Error('Edit is not pending approval');
      }

      edit.setApprovalStatus(QuoteEdit.APPROVAL_STATUS.APPROVED);
      edit.setApprovedBy(approver);
      edit.setApprovedAt(new Date());
      edit.setApprovalComment(comment);
      edit.setIsApplied(true);

      await edit.save(null, { useMasterKey: true });

      logger.info('Approved quote edit', {
        editId: edit.id,
        quoteId: edit.getQuote()?.id,
        approverId: approver.id,
      });

      return edit;
    } catch (error) {
      logger.error('Failed to approve edit', {
        error: error.message,
        editId,
        approverId: approver.id,
      });
      throw error;
    }
  }

  /**
   * Reject an edit.
   * @param {string} editId - ID of the edit to reject.
   * @param {object} rejector - AmexingUser rejecting the edit.
   * @param {string} reason - Rejection reason.
   * @returns {Promise<QuoteEdit>} Updated edit record.
   * @example
   */
  static async rejectEdit(editId, rejector, reason = '') {
    const query = new Parse.Query('QuoteEdit');

    try {
      const edit = await query.get(editId, { useMasterKey: true });

      if (edit.getApprovalStatus() !== QuoteEdit.APPROVAL_STATUS.PENDING) {
        throw new Error('Edit is not pending approval');
      }

      edit.setApprovalStatus(QuoteEdit.APPROVAL_STATUS.REJECTED);
      edit.setApprovedBy(rejector);
      edit.setApprovedAt(new Date());
      edit.setApprovalComment(reason);
      edit.setIsApplied(false);

      await edit.save(null, { useMasterKey: true });

      logger.info('Rejected quote edit', {
        editId: edit.id,
        quoteId: edit.getQuote()?.id,
        rejectorId: rejector.id,
        reason,
      });

      return edit;
    } catch (error) {
      logger.error('Failed to reject edit', {
        error: error.message,
        editId,
        rejectorId: rejector.id,
      });
      throw error;
    }
  }

  /**
   * Get edit history for a quote.
   * @param {object|string} quote - Quote object or ID.
   * @param {object} options - Query options.
   * @returns {Promise<QuoteEdit[]>} Array of edit records.
   * @example
   */
  static async getEditHistory(quote, options = {}) {
    const {
      limit = 100,
      skip = 0,
      includeRejected = false,
      editType = null,
      editorId = null,
    } = options;

    const query = new Parse.Query('QuoteEdit');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('exists', true);

    if (!includeRejected) {
      query.notEqualTo('approvalStatus', QuoteEdit.APPROVAL_STATUS.REJECTED);
    }

    if (editType) {
      query.equalTo('editType', editType);
    }

    if (editorId) {
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const editor = AmexingUser.createWithoutData(editorId);
      query.equalTo('editor', editor);
    }

    query.include(['editor', 'approvedBy']);
    query.descending('version');
    query.limit(limit);
    query.skip(skip);

    try {
      const history = await query.find({ useMasterKey: true });
      logger.info('Retrieved edit history', {
        quoteId: quote.id,
        recordCount: history.length,
      });
      return history;
    } catch (error) {
      logger.error('Error retrieving edit history', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }

  /**
   * Get pending edits for approval.
   * @param {object|string} quote - Quote object or ID.
   * @returns {Promise<QuoteEdit[]>} Array of pending edits.
   * @example
   */
  static async getPendingEdits(quote) {
    const query = new Parse.Query('QuoteEdit');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.equalTo('approvalStatus', QuoteEdit.APPROVAL_STATUS.PENDING);
    query.equalTo('exists', true);
    query.include(['editor']);
    query.ascending('editedAt');

    try {
      const pendingEdits = await query.find({ useMasterKey: true });
      logger.info('Retrieved pending edits', {
        quoteId: quote.id,
        count: pendingEdits.length,
      });
      return pendingEdits;
    } catch (error) {
      logger.error('Error retrieving pending edits', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }

  /**
   * Get the latest approved version of a quote.
   * @param {object|string} quote - Quote object or ID.
   * @returns {Promise<QuoteEdit|null>} Latest approved edit or null.
   * @example
   */
  static async getLatestApprovedVersion(quote) {
    const query = new Parse.Query('QuoteEdit');

    let quoteObj = quote;
    if (typeof quote === 'string') {
      const Quote = Parse.Object.extend('Quote');
      quoteObj = Quote.createWithoutData(quote);
    }

    query.equalTo('quote', quoteObj);
    query.containedIn('approvalStatus', [
      QuoteEdit.APPROVAL_STATUS.APPROVED,
      QuoteEdit.APPROVAL_STATUS.AUTO_APPROVED,
    ]);
    query.equalTo('isApplied', true);
    query.equalTo('exists', true);
    query.descending('version');
    query.limit(1);

    try {
      const latestEdit = await query.first({ useMasterKey: true });
      if (latestEdit) {
        logger.debug('Found latest approved version', {
          quoteId: quote.id,
          version: latestEdit.getVersion(),
        });
      }
      return latestEdit;
    } catch (error) {
      logger.error('Error finding latest approved version', {
        error: error.message,
        quoteId: quote.id,
      });
      throw error;
    }
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('QuoteEdit', QuoteEdit);

module.exports = QuoteEdit;
