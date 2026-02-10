/**
 * FormController - API endpoints for form management
 * Handles form rendering, submission, and data management.
 *
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const FormRenderer = require('../../services/FormRenderer');

/**
 * Form Controller for managing dynamic form templates.
 * Handles form rendering, submission, and template management.
 * @class FormController
 * @author Denisse Maldonado
 * @since 1.0.0
 */
class FormController {
  /**
   * Get form configuration for rendering
   * GET /api/forms/:id.
   * @param req
   * @param res
   * @example
   */
  async getForm(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Form ID is required',
        });
      }

      const configuration = await FormRenderer.loadFormConfiguration(id);

      if (!configuration) {
        return res.status(404).json({
          success: false,
          error: 'Form not found',
        });
      }

      res.json({
        success: true,
        data: configuration,
      });
    } catch (error) {
      console.error('Error getting form:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error loading form',
      });
    }
  }

  /**
   * Render form HTML
   * GET /api/forms/:id/render.
   * @param req
   * @param res
   * @example
   */
  async renderForm(req, res) {
    try {
      const { id } = req.params;
      const { mode = 'create', recordId } = req.query;

      let data = {};

      // If edit mode, load existing data
      if (mode === 'edit' && recordId) {
        data = await this.loadRecordData(id, recordId);
      }

      const options = {
        readonly: mode === 'view',
        formId: `form-${id}-${mode}`,
        action: `/api/forms/${id}/submit`,
        method: 'POST',
        includeTitle: req.query.includeTitle !== 'false',
        includeActions: req.query.includeActions !== 'false',
        showCancel: req.query.showCancel !== 'false',
        showSaveDraft: req.query.showSaveDraft === 'true',
        submitText: req.query.submitText || (mode === 'edit' ? 'Actualizar' : 'Enviar'),
      };

      const html = await FormRenderer.renderForm(id, data, options);

      res.json({
        success: true,
        html,
        mode,
        formId: id,
      });
    } catch (error) {
      console.error('Error rendering form:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error rendering form',
      });
    }
  }

  /**
   * Submit form data
   * POST /api/forms/:id/submit.
   * @param req
   * @param res
   * @example
   */
  async submitForm(req, res) {
    try {
      const { id } = req.params;
      const formData = req.body;
      const { user } = req;

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const result = await FormRenderer.handleSubmission(id, formData, user);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          errors: result.errors,
        });
      }

      res.json({
        success: true,
        submissionId: result.submissionId,
        message: 'Form submitted successfully',
      });
    } catch (error) {
      console.error('Error submitting form:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error submitting form',
      });
    }
  }

  /**
   * Save form template configuration
   * POST /api/forms/save-template.
   * @param req
   * @param res
   * @example
   */
  async saveTemplate(req, res) {
    try {
      const {
        formId, title, description, fields, settings, validation,
      } = req.body;
      const { user } = req;
      // dashboardAuthMiddleware sets the role in req.user.role
      const userRole = req.user?.role || req.userRole || 'guest';

      if (!user) {
        console.error('SaveTemplate - No user found in request');
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!['superadmin', 'admin'].includes(userRole)) {
        console.error(`SaveTemplate - Insufficient permissions. Role: ${userRole}`);
        return res.status(403).json({
          success: false,
          error: `Permission denied. Current role: ${userRole}. Required: admin or superadmin`,
        });
      }

      if (!formId || !title || !fields) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: formId, title, and fields are required',
        });
      }

      const FormTemplate = Parse.Object.extend('FormTemplate');
      const query = new Parse.Query(FormTemplate);
      // Query by formType to ensure only one form per type
      query.equalTo('formType', formId);
      query.equalTo('active', true);
      query.equalTo('exists', true);

      let template = await query.first({ useMasterKey: true });

      if (!template) {
        // Create new template for this type
        template = new FormTemplate();
        template.set('formId', formId);
        template.set('formType', formId);
        // Create pointer to AmexingUser
        const createdByPointer = {
          __type: 'Pointer',
          className: 'AmexingUser',
          objectId: user.id || user.objectId,
        };
        template.set('createdBy', createdByPointer);
        template.set('status', 'active');
      }

      // Map title to name (schema expects 'name' field)
      template.set('name', title);
      template.set('description', description);
      template.set('fields', fields);
      template.set('settings', settings || {});
      template.set('validation', validation || {});
      template.set('version', (template.get('version') || 0) + 1);
      // Create pointer to AmexingUser for lastModifiedBy
      const lastModifiedByPointer = {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: user.id || user.objectId,
      };
      template.set('lastModifiedBy', lastModifiedByPointer);
      template.set('active', true);
      template.set('exists', true);

      await template.save(null, { useMasterKey: true });

      const isNewTemplate = !template.existed();

      res.json({
        success: true,
        templateId: template.id,
        formType: formId,
        action: isNewTemplate ? 'created' : 'updated',
        message: `Form template for type '${formId}' ${isNewTemplate ? 'created' : 'updated'} successfully`,
      });
    } catch (error) {
      console.error('Error saving template:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error saving template',
      });
    }
  }

  /**
   * Get form submissions
   * GET /api/forms/:id/submissions.
   * @param req
   * @param res
   * @example
   */
  async getSubmissions(req, res) {
    try {
      const { id } = req.params;
      const {
        startDate, endDate, status, limit = 100,
      } = req.query;
      const { user } = req;
      const userRole = req.user?.role || req.userRole || 'guest';

      if (!user || !['superadmin', 'admin'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
        });
      }

      const options = {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        status,
        limit: parseInt(limit),
      };

      const submissions = await FormRenderer.getFormSubmissions(id, options);

      res.json({
        success: true,
        data: submissions,
        count: submissions.length,
      });
    } catch (error) {
      console.error('Error getting submissions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error getting submissions',
      });
    }
  }

  /**
   * Export form data
   * GET /api/forms/:id/export.
   * @param req
   * @param res
   * @example
   */
  async exportData(req, res) {
    try {
      const { id } = req.params;
      const { format = 'json', startDate, endDate } = req.query;
      const { user } = req;
      const userRole = req.user?.role || req.userRole || 'guest';

      if (!user || !['superadmin', 'admin'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
        });
      }

      const options = {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      };

      const data = await FormRenderer.exportFormData(id, format, options);

      // Set appropriate content type
      const contentTypes = {
        json: 'application/json',
        csv: 'text/csv',
        pdf: 'application/pdf',
      };

      res.setHeader('Content-Type', contentTypes[format] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="form-${id}-export.${format}"`);

      res.send(data);
    } catch (error) {
      console.error('Error exporting data:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error exporting data',
      });
    }
  }

  /**
   * Delete form submission
   * DELETE /api/forms/submissions/:id.
   * @param req
   * @param res
   * @example
   */
  async deleteSubmission(req, res) {
    try {
      const { id } = req.params;
      const { user } = req;
      const userRole = req.user?.role || req.userRole || 'guest';

      if (!user || !['superadmin', 'admin'].includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
        });
      }

      const FormSubmission = Parse.Object.extend('FormSubmission');
      const query = new Parse.Query(FormSubmission);
      const submission = await query.get(id, { useMasterKey: true });

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: 'Submission not found',
        });
      }

      // Soft delete
      submission.set('exists', false);
      // Create pointer to AmexingUser for deletedBy
      const deletedByPointer = {
        __type: 'Pointer',
        className: 'AmexingUser',
        objectId: user.id || user.objectId,
      };
      submission.set('deletedBy', deletedByPointer);
      submission.set('deletedAt', new Date());

      await submission.save(null, { useMasterKey: true });

      res.json({
        success: true,
        message: 'Submission deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting submission:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error deleting submission',
      });
    }
  }

  /**
   * Get all available form templates
   * GET /api/forms/templates.
   * @param req
   * @param res
   * @example
   */
  async getTemplates(req, res) {
    try {
      const FormTemplate = Parse.Object.extend('FormTemplate');
      const query = new Parse.Query(FormTemplate);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.select(['formId', 'name', 'formType', 'description', 'fields', 'updatedAt']);

      const templates = await query.find({ useMasterKey: true });

      const data = templates.map((template) => {
        const fields = template.get('fields') || [];
        return {
          id: template.get('formId'),
          formId: template.get('formId'),
          title: template.get('name'), // Map 'name' back to 'title' for frontend
          formType: template.get('formType'),
          description: template.get('description'),
          fields,
          fieldCount: Array.isArray(fields) ? fields.length : 0,
          updatedAt: template.get('updatedAt'),
        };
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Error getting templates:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error getting templates',
      });
    }
  }

  /**
   * Load record data for editing.
   * @param {string} formId - Form ID.
   * @param {string} recordId - Record ID.
   * @param _formId
   * @param _recordId
   * @returns {Promise<object>} Record data.
   * @example
   */
  async loadRecordData(_formId, _recordId) {
    // This would load data from the appropriate table based on formId
    // For now, returning empty object
    return {};
  }

  /**
   * Validate form field
   * POST /api/forms/validate-field.
   * @param req
   * @param res
   * @example
   */
  async validateField(req, res) {
    try {
      const { formId, fieldName, value } = req.body;

      const configuration = await FormRenderer.loadFormConfiguration(formId);

      if (!configuration) {
        return res.status(404).json({
          success: false,
          error: 'Form not found',
        });
      }

      const field = configuration.fields.find((f) => f.props.name === fieldName);

      if (!field) {
        return res.status(404).json({
          success: false,
          error: 'Field not found',
        });
      }

      const mockData = { [fieldName]: value };
      const mockConfig = { fields: [field] };

      const validation = await FormRenderer.validateFormData(mockData, mockConfig);

      res.json({
        success: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      console.error('Error validating field:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error validating field',
      });
    }
  }
}

module.exports = new FormController();
