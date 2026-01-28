/**
 * FormRenderer Service
 * Handles runtime rendering of forms from JSON configuration
 * Part of Phase 7: Runtime Rendering.
 *
 * Created by Denisse Maldonado.
 */

const fs = require('fs').promises;
const path = require('path');
const ejs = require('ejs');
const Parse = require('parse/node');

/**
 * Form Renderer Service for dynamic form rendering and validation.
 * Handles form template rendering, submission processing, and data export.
 * @class FormRenderer
 * @author Denisse Maldonado
 * @since 1.0.0
 */
class FormRenderer {
  /**
   * Creates a new FormRenderer instance.
   * Initializes template cache, component registry, and validation rules.
   * @example
   */
  constructor() {
    this.componentCache = new Map();
    this.viewsPath = path.join(__dirname, '../../presentation/views');
    this.atomsPath = path.join(this.viewsPath, 'atoms/form');
  }

  /**
   * Render a complete form from JSON configuration.
   * @param {string} formId - Form template ID.
   * @param {object} data - Initial form data (for edit mode).
   * @param {object} options - Rendering options.
   * @returns {Promise<string>} Rendered HTML.
   * @example
   */
  async renderForm(formId, data = {}, options = {}) {
    try {
      const configuration = await this.loadFormConfiguration(formId);

      if (!configuration) {
        throw new Error(`Form configuration not found for: ${formId}`);
      }

      const formHtml = await this.buildFormHTML(configuration, data, options);

      return this.wrapForm(formHtml, configuration, options);
    } catch (error) {
      console.error('Error rendering form:', error);
      throw error;
    }
  }

  /**
   * Load form configuration from database.
   * @param {string} formId - Form template ID.
   * @returns {Promise<object>} Form configuration.
   * @example
   */
  async loadFormConfiguration(formId) {
    try {
      const FormTemplate = Parse.Object.extend('FormTemplate');
      const query = new Parse.Query(FormTemplate);
      query.equalTo('formId', formId);
      query.equalTo('active', true);
      query.equalTo('exists', true);

      const template = await query.first({ useMasterKey: true });

      if (!template) {
        return null;
      }

      return {
        id: template.get('formId'),
        title: template.get('title'),
        description: template.get('description'),
        fields: template.get('fields') || [],
        settings: template.get('settings') || {},
        validation: template.get('validation') || {},
      };
    } catch (error) {
      console.error('Error loading form configuration:', error);
      throw error;
    }
  }

  /**
   * Build form HTML from configuration.
   * @param {object} configuration - Form configuration.
   * @param {object} data - Form data.
   * @param {object} options - Rendering options.
   * @returns {Promise<string>} Form HTML.
   * @example
   */
  async buildFormHTML(configuration, data, options) {
    const sections = this.groupFieldsBySection(configuration.fields);
    let html = '';

    for (const [sectionId, section] of Object.entries(sections)) {
      html += await this.renderSection(sectionId, section, data, options);
    }

    return html;
  }

  /**
   * Group fields by section.
   * @param {Array} fields - Form fields.
   * @returns {object} Fields grouped by section.
   * @example
   */
  groupFieldsBySection(fields) {
    const sections = {};

    fields.forEach((field) => {
      const sectionId = field.section || 'default';
      if (!sections[sectionId]) {
        sections[sectionId] = {
          title: field.sectionTitle || '',
          fields: [],
        };
      }
      sections[sectionId].fields.push(field);
    });

    return sections;
  }

  /**
   * Render a form section.
   * @param {string} sectionId - Section ID.
   * @param {object} section - Section data.
   * @param {object} data - Form data.
   * @param {object} options - Rendering options.
   * @returns {Promise<string>} Section HTML.
   * @example
   */
  async renderSection(sectionId, section, data, options) {
    let html = `<div class="form-section mb-4" data-section-id="${sectionId}">`;

    if (section.title) {
      html += `<h5 class="section-title mb-3">${section.title}</h5>`;
    }

    html += '<div class="row">';

    for (const field of section.fields) {
      const fieldValue = data[field.props.name] || field.props.defaultValue || '';
      html += await this.renderField(field, fieldValue, options);
    }

    html += '</div></div>';

    return html;
  }

  /**
   * Render a single field.
   * @param {object} field - Field configuration.
   * @param {any} value - Field value.
   * @param {object} options - Rendering options.
   * @returns {Promise<string>} Field HTML.
   * @example
   */
  async renderField(field, value, options = {}) {
    try {
      const componentType = field.componentType.replace('atom:', '');
      const componentPath = path.join(this.atomsPath, `${componentType}.ejs`);

      // Check if component exists
      const componentExists = await this.checkFileExists(componentPath);
      if (!componentExists) {
        console.warn(`Component not found: ${componentType}, using fallback`);
        return this.renderFallbackField(field, value);
      }

      // Prepare props for the component
      const props = {
        ...field.props,
        value,
        id: field.id,
        className: field.props.className || 'form-control',
        readonly: options.readonly || field.props.readonly,
        disabled: options.disabled || field.props.disabled,
      };

      // Get column width
      const colClass = this.getColumnClass(field.props.width || 12);

      // Render the component
      const componentHtml = await this.renderComponent(componentType, props);

      return `<div class="${colClass}">${componentHtml}</div>`;
    } catch (error) {
      console.error(`Error rendering field ${field.id}:`, error);
      return this.renderFallbackField(field, value);
    }
  }

  /**
   * Render component using EJS.
   * @param {string} componentType - Component type.
   * @param {object} props - Component props.
   * @returns {Promise<string>} Rendered HTML.
   * @example
   */
  async renderComponent(componentType, props) {
    const componentPath = path.join(this.atomsPath, `${componentType}.ejs`);

    // Use cached template if available
    let template = this.componentCache.get(componentType);

    if (!template) {
      // Validate component path to prevent directory traversal
      const normalizedPath = path.normalize(componentPath);
      if (!normalizedPath.startsWith(this.atomsPath)) {
        throw new Error('Invalid component path');
      }
      // Path is validated - safe to read
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const templateContent = await fs.readFile(normalizedPath, 'utf8');
      template = ejs.compile(templateContent, {
        filename: componentPath,
        async: true,
      });
      this.componentCache.set(componentType, template);
    }

    return template(props);
  }

  /**
   * Render fallback field for unsupported types.
   * @param {object} field - Field configuration.
   * @param {any} value - Field value.
   * @returns {string} Fallback HTML.
   * @example
   */
  renderFallbackField(field, value) {
    const { props } = field;
    return `
      <div class="mb-3">
        ${props.label ? `<label class="form-label">${props.label}${props.required ? ' <span class="text-danger">*</span>' : ''}</label>` : ''}
        <input type="text" 
               id="${field.id}" 
               name="${props.name}" 
               class="form-control" 
               value="${value || ''}"
               placeholder="${props.placeholder || ''}"
               ${props.required ? 'required' : ''}
               ${props.readonly ? 'readonly' : ''}
               ${props.disabled ? 'disabled' : ''}>
        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
      </div>
    `;
  }

  /**
   * Get Bootstrap column class based on width.
   * @param {number} width - Width (1-12).
   * @returns {string} Column class.
   * @example
   */
  getColumnClass(width) {
    const widthMap = {
      12: 'col-12',
      9: 'col-md-9 col-12',
      8: 'col-md-8 col-12',
      6: 'col-md-6 col-12',
      4: 'col-md-4 col-12',
      3: 'col-md-3 col-12',
      2: 'col-md-2 col-12',
    };
    return widthMap[width] || 'col-12';
  }

  /**
   * Wrap form content with form element.
   * @param {string} formHtml - Inner form HTML.
   * @param {object} configuration - Form configuration.
   * @param {object} options - Form options.
   * @returns {string} Complete form HTML.
   * @example
   */
  wrapForm(formHtml, configuration, options) {
    const formId = options.formId || `form-${configuration.id}`;
    const action = options.action || `/api/forms/${configuration.id}/submit`;
    const method = options.method || 'POST';

    return `
      <form id="${formId}" 
            action="${action}" 
            method="${method}" 
            class="needs-validation ${options.className || ''}" 
            novalidate
            data-form-id="${configuration.id}">
        
        ${
  options.includeTitle !== false
    ? `
          <div class="mb-4">
            <h3 class="form-title">${configuration.title}</h3>
            ${configuration.description ? `<p class="text-muted">${configuration.description}</p>` : ''}
          </div>
        `
    : ''
}
        
        ${formHtml}
        
        ${
  options.includeActions !== false
    ? `
          <div class="form-actions d-flex justify-content-end gap-2 mt-4">
            ${options.showCancel !== false ? '<button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>' : ''}
            ${options.showSaveDraft ? '<button type="button" class="btn btn-outline-primary" data-action="save-draft">Guardar Borrador</button>' : ''}
            <button type="submit" class="btn btn-primary">
              ${options.submitText || 'Enviar'}
            </button>
          </div>
        `
    : ''
}
      </form>
    `;
  }

  /**
   * Handle form submission.
   * @param {string} formId - Form ID.
   * @param {object} formData - Submitted form data.
   * @param {object} user - Current user.
   * @returns {Promise<object>} Submission result.
   * @example
   */
  async handleSubmission(formId, formData, user) {
    try {
      // Load form configuration for validation
      const configuration = await this.loadFormConfiguration(formId);

      if (!configuration) {
        throw new Error('Form configuration not found');
      }

      // Validate form data
      const validation = await this.validateFormData(formData, configuration);

      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
        };
      }

      // Save submission to database
      const submission = await this.saveSubmission(formId, formData, user, configuration);

      // Execute any post-submission actions
      await this.executePostSubmissionActions(submission, configuration);

      return {
        success: true,
        submissionId: submission.id,
        data: submission,
      };
    } catch (error) {
      console.error('Error handling form submission:', error);
      throw error;
    }
  }

  /**
   * Validate form data against configuration.
   * @param {object} formData - Form data.
   * @param {object} configuration - Form configuration.
   * @returns {Promise<object>} Validation result.
   * @example
   */
  async validateFormData(formData, configuration) {
    const errors = [];

    for (const field of configuration.fields) {
      const fieldName = field.props.name;
      const value = formData[fieldName];
      const validation = field.props.validation || {};

      // Required field check
      if (field.props.required && (!value || value.toString().trim() === '')) {
        errors.push({
          field: fieldName,
          message: `${field.props.label} es requerido`,
        });
        // eslint-disable-next-line no-continue
        continue;
      }

      // Skip validation if field is not required and empty
      if (!value || value.toString().trim() === '') {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Min length check
      if (validation.minLength && value.length < validation.minLength) {
        errors.push({
          field: fieldName,
          message: `${field.props.label} debe tener al menos ${validation.minLength} caracteres`,
        });
      }

      // Max length check
      if (validation.maxLength && value.length > validation.maxLength) {
        errors.push({
          field: fieldName,
          message: `${field.props.label} no debe exceder ${validation.maxLength} caracteres`,
        });
      }

      // Pattern check
      if (validation.pattern) {
        // Validate pattern before creating regex
        if (typeof validation.pattern !== 'string' || validation.pattern.length > 100) {
          throw new Error('Invalid pattern');
        }
        // Pattern is validated - safe to use
        // eslint-disable-next-line security/detect-non-literal-regexp
        const regex = new RegExp(validation.pattern, 'u');
        if (!regex.test(value)) {
          errors.push({
            field: fieldName,
            message: `${field.props.label} tiene un formato inválido`,
          });
        }
      }

      // Email validation
      if (field.componentType === 'atom:input-email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          errors.push({
            field: fieldName,
            message: `${field.props.label} debe ser un email válido`,
          });
        }
      }

      // Number validation
      if (field.componentType === 'atom:input-number') {
        const numValue = Number(value);
        if (Number.isNaN(numValue)) {
          errors.push({
            field: fieldName,
            message: `${field.props.label} debe ser un número`,
          });
        }

        if (validation.min !== undefined && numValue < validation.min) {
          errors.push({
            field: fieldName,
            message: `${field.props.label} debe ser mayor o igual a ${validation.min}`,
          });
        }

        if (validation.max !== undefined && numValue > validation.max) {
          errors.push({
            field: fieldName,
            message: `${field.props.label} debe ser menor o igual a ${validation.max}`,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Save form submission to database.
   * @param {string} formId - Form ID.
   * @param {object} formData - Form data.
   * @param {object} user - User submitting the form.
   * @param {object} configuration - Form configuration.
   * @returns {Promise<object>} Saved submission.
   * @example
   */
  async saveSubmission(formId, formData, user, configuration) {
    try {
      const FormSubmission = Parse.Object.extend('FormSubmission');
      const submission = new FormSubmission();

      submission.set('formId', formId);
      submission.set('formTitle', configuration.title);
      submission.set('data', formData);
      submission.set('submittedBy', user);
      submission.set('submittedAt', new Date());
      submission.set('status', 'submitted');
      submission.set('active', true);
      submission.set('exists', true);

      // Add metadata
      submission.set('metadata', {
        userAgent: user.userAgent || '',
        ipAddress: user.ipAddress || '',
        formVersion: configuration.version || '1.0.0',
      });

      await submission.save(null, { useMasterKey: true });

      return submission.toJSON();
    } catch (error) {
      console.error('Error saving form submission:', error);
      throw error;
    }
  }

  /**
   * Execute post-submission actions (notifications, workflows, etc.).
   * @param {object} submission - Form submission.
   * @param {object} configuration - Form configuration.
   * @returns {Promise<void>}
   * @example
   */
  async executePostSubmissionActions(submission, configuration) {
    const actions = configuration.settings?.postSubmissionActions || [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'email':
            await this.sendEmailNotification(submission, action);
            break;
          case 'webhook':
            await this.callWebhook(submission, action);
            break;
          case 'redirect':
            // Handled on client side
            break;
          default:
            console.warn(`Unknown post-submission action: ${action.type}`);
        }
      } catch (error) {
        console.error(`Error executing post-submission action ${action.type}:`, error);
      }
    }
  }

  /**
   * Send email notification for form submission.
   * @param {object} submission - Form submission.
   * @param {object} action - Email action configuration.
   * @returns {Promise<void>}
   * @example
   */
  async sendEmailNotification(submission, action) {
    // Implementation depends on email service
    console.log('Email notification would be sent:', action);
  }

  /**
   * Call webhook for form submission.
   * @param {object} submission - Form submission.
   * @param {object} action - Webhook action configuration.
   * @returns {Promise<void>}
   * @example
   */
  async callWebhook(submission, action) {
    // Implementation for webhook calls
    console.log('Webhook would be called:', action);
  }

  /**
   * Check if file exists.
   * @param {string} filePath - File path.
   * @returns {Promise<boolean>}
   * @example
   */
  async checkFileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Export form data to various formats.
   * @param {string} formId - Form ID.
   * @param {string} format - Export format (json, csv, pdf).
   * @param {object} options - Export options.
   * @returns {Promise<Buffer>} Exported data.
   * @example
   */
  async exportFormData(formId, format = 'json', options = {}) {
    const submissions = await this.getFormSubmissions(formId, options);

    switch (format.toLowerCase()) {
      case 'json':
        return Buffer.from(JSON.stringify(submissions, null, 2));

      case 'csv':
        return this.exportToCSV(submissions);

      case 'pdf':
        return this.exportToPDF(submissions, options);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Get form submissions.
   * @param {string} formId - Form ID.
   * @param {object} options - Query options.
   * @returns {Promise<Array>} Form submissions.
   * @example
   */
  async getFormSubmissions(formId, options = {}) {
    try {
      const FormSubmission = Parse.Object.extend('FormSubmission');
      const query = new Parse.Query(FormSubmission);

      query.equalTo('formId', formId);
      query.equalTo('exists', true);

      if (options.startDate) {
        query.greaterThanOrEqualTo('submittedAt', options.startDate);
      }

      if (options.endDate) {
        query.lessThanOrEqualTo('submittedAt', options.endDate);
      }

      if (options.status) {
        query.equalTo('status', options.status);
      }

      query.descending('submittedAt');

      if (options.limit) {
        query.limit(options.limit);
      }

      const submissions = await query.find({ useMasterKey: true });

      return submissions.map((sub) => sub.toJSON());
    } catch (error) {
      console.error('Error getting form submissions:', error);
      throw error;
    }
  }

  /**
   * Export submissions to CSV.
   * @param {Array} submissions - Form submissions.
   * @returns {Buffer} CSV data.
   * @example
   */
  exportToCSV(submissions) {
    if (submissions.length === 0) {
      return Buffer.from('No data available');
    }

    // Get all unique field names
    const fieldNames = new Set();
    submissions.forEach((sub) => {
      Object.keys(sub.data || {}).forEach((key) => fieldNames.add(key));
    });

    // Build CSV header
    const headers = ['Submission ID', 'Submitted At', 'Status', ...Array.from(fieldNames)];
    let csv = `${headers.map((h) => `"${h}"`).join(',')}\n`;

    // Build CSV rows
    submissions.forEach((sub) => {
      const row = [
        sub.objectId,
        sub.submittedAt,
        sub.status,
        ...Array.from(fieldNames).map((field) => {
          const value = sub.data?.[field] || '';
          return `"${String(value).replace(/"/g, '""')}"`;
        }),
      ];
      csv += `${row.join(',')}\n`;
    });

    return Buffer.from(csv);
  }

  /**
   * Export submissions to PDF.
   * @param {Array} submissions - Form submissions.
   * @param {object} options - PDF options.
   * @param _options
   * @returns {Buffer} PDF data.
   * @example
   */
  async exportToPDF(submissions, _options) {
    // This would require a PDF library like puppeteer or pdfkit
    // For now, returning a placeholder
    console.log('PDF export would be generated with:', submissions.length, 'submissions');
    return Buffer.from('PDF export not yet implemented');
  }
}

module.exports = new FormRenderer();
