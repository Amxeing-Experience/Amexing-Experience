/**
 * FormRuntime - Client-side form runtime handler
 * Manages form rendering, validation, and submission at runtime
 * 
 * Created by Denisse Maldonado
 */

class FormRuntime {
  constructor() {
    this.forms = new Map();
    this.validators = new Map();
    this.submissions = new Map();
  }

  /**
   * Initialize a runtime form
   * @param {string} formId - Form identifier
   * @param {string} containerId - Container element ID
   * @param {Object} options - Form options
   */
  async initializeForm(formId, containerId, options = {}) {
    try {
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container ${containerId} not found`);
      }

      // Show loading state
      container.innerHTML = this.getLoadingHTML();

      // Fetch and render form
      const response = await fetch(`/api/forms/${formId}/render?${new URLSearchParams(options)}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load form');
      }

      // Insert form HTML
      container.innerHTML = result.html;

      // Initialize form behaviors
      const formElement = container.querySelector('form');
      if (formElement) {
        this.setupForm(formElement, formId, options);
      }

      return formElement;
    } catch (error) {
      console.error('Error initializing form:', error);
      this.showError(containerId, error.message);
      throw error;
    }
  }

  /**
   * Setup form behaviors
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @param {Object} options - Form options
   */
  setupForm(formElement, formId, options = {}) {
    // Store form reference
    this.forms.set(formId, {
      element: formElement,
      options: options,
      isDirty: false
    });

    // Setup validation
    this.setupValidation(formElement, formId);

    // Setup submission handler
    this.setupSubmission(formElement, formId, options);

    // Setup field change tracking
    this.setupChangeTracking(formElement, formId);

    // Setup action buttons
    this.setupActions(formElement, formId, options);

    // Setup auto-save if enabled
    if (options.autoSave) {
      this.setupAutoSave(formElement, formId, options.autoSaveInterval || 30000);
    }

    // Setup field enhancements
    this.enhanceFields(formElement);
  }

  /**
   * Setup form validation
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   */
  setupValidation(formElement, formId) {
    // Bootstrap validation
    formElement.classList.add('needs-validation');
    formElement.setAttribute('novalidate', true);

    // Custom validation on blur
    const inputs = formElement.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.addEventListener('blur', (e) => {
        this.validateField(e.target, formId);
      });

      // Real-time validation for certain fields
      if (input.type === 'email' || input.type === 'url' || input.type === 'tel') {
        input.addEventListener('input', debounce((e) => {
          this.validateField(e.target, formId);
        }, 500));
      }
    });
  }

  /**
   * Validate a single field
   * @param {HTMLElement} field - Field element
   * @param {string} formId - Form identifier
   */
  async validateField(field, formId) {
    const fieldName = field.name;
    const value = field.value;

    // HTML5 validation
    if (!field.checkValidity()) {
      field.classList.add('is-invalid');
      field.classList.remove('is-valid');
      this.showFieldError(field, field.validationMessage);
      return false;
    }

    // Custom validation rules
    const validators = this.validators.get(formId);
    if (validators && validators[fieldName]) {
      try {
        const isValid = await validators[fieldName](value, field);
        if (!isValid) {
          field.classList.add('is-invalid');
          field.classList.remove('is-valid');
          return false;
        }
      } catch (error) {
        console.error('Validation error:', error);
      }
    }

    // Server-side validation for complex rules
    if (field.dataset.serverValidate === 'true') {
      try {
        const response = await fetch('/api/forms/validate-field', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            formId: formId,
            fieldName: fieldName,
            value: value
          })
        });

        const result = await response.json();
        if (!result.success && result.errors) {
          field.classList.add('is-invalid');
          field.classList.remove('is-valid');
          const error = result.errors.find(e => e.field === fieldName);
          if (error) {
            this.showFieldError(field, error.message);
          }
          return false;
        }
      } catch (error) {
        console.error('Server validation error:', error);
      }
    }

    // Mark as valid
    field.classList.remove('is-invalid');
    field.classList.add('is-valid');
    this.clearFieldError(field);
    return true;
  }

  /**
   * Setup form submission
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @param {Object} options - Form options
   */
  setupSubmission(formElement, formId, options) {
    formElement.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Validate all fields
      const isValid = await this.validateForm(formElement, formId);
      
      if (!isValid) {
        formElement.classList.add('was-validated');
        this.showNotification('Por favor corrija los errores antes de enviar', 'error');
        return;
      }

      // Submit form
      await this.submitForm(formElement, formId, options);
    });
  }

  /**
   * Validate entire form
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @returns {Promise<boolean>} Validation result
   */
  async validateForm(formElement, formId) {
    let isValid = true;
    const fields = formElement.querySelectorAll('input, select, textarea');

    for (const field of fields) {
      const fieldValid = await this.validateField(field, formId);
      if (!fieldValid) {
        isValid = false;
      }
    }

    return isValid;
  }

  /**
   * Submit form data
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @param {Object} options - Form options
   */
  async submitForm(formElement, formId, options) {
    try {
      // Show loading state
      const submitBtn = formElement.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

      // Get form data
      const formData = new FormData(formElement);
      const data = Object.fromEntries(formData.entries());

      // Submit to server
      const response = await fetch(`/api/forms/${formId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.success) {
        // Store submission ID
        this.submissions.set(formId, result.submissionId);

        // Show success message
        this.showNotification('Formulario enviado exitosamente', 'success');

        // Execute success callback
        if (options.onSuccess) {
          options.onSuccess(result);
        }

        // Redirect if configured
        if (options.redirectUrl) {
          setTimeout(() => {
            window.location.href = options.redirectUrl;
          }, 1500);
        }

        // Reset form if configured
        if (options.resetOnSubmit !== false) {
          formElement.reset();
          formElement.classList.remove('was-validated');
          this.clearFormValidation(formElement);
        }
      } else {
        // Show errors
        if (result.errors) {
          this.showValidationErrors(formElement, result.errors);
        } else {
          this.showNotification(result.error || 'Error al enviar el formulario', 'error');
        }

        // Execute error callback
        if (options.onError) {
          options.onError(result);
        }
      }

      // Restore button
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    } catch (error) {
      console.error('Submit error:', error);
      this.showNotification('Error de conexión. Por favor intente nuevamente.', 'error');
      
      // Restore button
      const submitBtn = formElement.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  }

  /**
   * Setup change tracking
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   */
  setupChangeTracking(formElement, formId) {
    const formData = this.forms.get(formId);
    
    formElement.addEventListener('input', () => {
      formData.isDirty = true;
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (formData.isDirty) {
        e.preventDefault();
        e.returnValue = '¿Está seguro de que desea salir? Los cambios no guardados se perderán.';
      }
    });
  }

  /**
   * Setup action buttons
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @param {Object} options - Form options
   */
  setupActions(formElement, formId, options) {
    // Cancel button
    const cancelBtn = formElement.querySelector('[data-action="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (options.onCancel) {
          options.onCancel();
        } else if (options.cancelUrl) {
          window.location.href = options.cancelUrl;
        } else {
          window.history.back();
        }
      });
    }

    // Save draft button
    const saveDraftBtn = formElement.querySelector('[data-action="save-draft"]');
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener('click', async () => {
        await this.saveDraft(formElement, formId);
      });
    }
  }

  /**
   * Setup auto-save
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   * @param {number} interval - Auto-save interval in milliseconds
   */
  setupAutoSave(formElement, formId, interval) {
    setInterval(async () => {
      const formData = this.forms.get(formId);
      if (formData && formData.isDirty) {
        await this.saveDraft(formElement, formId);
        formData.isDirty = false;
      }
    }, interval);
  }

  /**
   * Save form as draft
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} formId - Form identifier
   */
  async saveDraft(formElement, formId) {
    try {
      const formData = new FormData(formElement);
      const data = Object.fromEntries(formData.entries());

      // Store in localStorage
      localStorage.setItem(`form-draft-${formId}`, JSON.stringify({
        data: data,
        savedAt: new Date().toISOString()
      }));

      this.showNotification('Borrador guardado', 'info', 2000);
    } catch (error) {
      console.error('Error saving draft:', error);
      this.showNotification('Error al guardar borrador', 'error');
    }
  }

  /**
   * Load draft data
   * @param {string} formId - Form identifier
   * @returns {Object|null} Draft data
   */
  loadDraft(formId) {
    try {
      const draft = localStorage.getItem(`form-draft-${formId}`);
      if (draft) {
        return JSON.parse(draft);
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
    return null;
  }

  /**
   * Enhance form fields with additional functionality
   * @param {HTMLFormElement} formElement - Form element
   */
  enhanceFields(formElement) {
    // Date pickers
    formElement.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(input => {
      // Add date picker enhancement if library is available
      if (window.flatpickr) {
        flatpickr(input, {
          dateFormat: input.type === 'date' ? 'Y-m-d' : 'Y-m-d H:i',
          enableTime: input.type === 'datetime-local',
          locale: 'es'
        });
      }
    });

    // File uploads
    formElement.querySelectorAll('input[type="file"]').forEach(input => {
      this.enhanceFileUpload(input);
    });

    // Rich text editors
    formElement.querySelectorAll('[data-component="richtext"]').forEach(textarea => {
      if (window.tinymce) {
        tinymce.init({
          target: textarea,
          height: 300,
          menubar: false,
          plugins: 'lists link image',
          toolbar: 'undo redo | formatselect | bold italic | alignleft aligncenter alignright | bullist numlist | link image'
        });
      }
    });

    // Number inputs with formatting
    formElement.querySelectorAll('input[type="number"]').forEach(input => {
      if (input.dataset.format === 'currency') {
        this.setupCurrencyFormat(input);
      }
    });
  }

  /**
   * Enhance file upload field
   * @param {HTMLInputElement} input - File input element
   */
  enhanceFileUpload(input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-upload-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const preview = document.createElement('div');
    preview.className = 'file-preview mt-2';
    wrapper.appendChild(preview);

    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      preview.innerHTML = '';
      
      files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-preview-item d-flex align-items-center mb-1';
        item.innerHTML = `
          <i class="ti ti-file me-2"></i>
          <span>${file.name}</span>
          <small class="ms-2 text-muted">(${this.formatFileSize(file.size)})</small>
        `;
        preview.appendChild(item);
      });
    });
  }

  /**
   * Setup currency formatting
   * @param {HTMLInputElement} input - Number input element
   */
  setupCurrencyFormat(input) {
    input.addEventListener('blur', (e) => {
      const value = parseFloat(e.target.value);
      if (!isNaN(value)) {
        e.target.value = value.toFixed(2);
      }
    });
  }

  /**
   * Show field error
   * @param {HTMLElement} field - Field element
   * @param {string} message - Error message
   */
  showFieldError(field, message) {
    let feedback = field.nextElementSibling;
    if (!feedback || !feedback.classList.contains('invalid-feedback')) {
      feedback = document.createElement('div');
      feedback.className = 'invalid-feedback';
      field.parentNode.insertBefore(feedback, field.nextSibling);
    }
    feedback.textContent = message;
  }

  /**
   * Clear field error
   * @param {HTMLElement} field - Field element
   */
  clearFieldError(field) {
    const feedback = field.nextElementSibling;
    if (feedback && feedback.classList.contains('invalid-feedback')) {
      feedback.textContent = '';
    }
  }

  /**
   * Show validation errors
   * @param {HTMLFormElement} formElement - Form element
   * @param {Array} errors - Validation errors
   */
  showValidationErrors(formElement, errors) {
    errors.forEach(error => {
      const field = formElement.querySelector(`[name="${error.field}"]`);
      if (field) {
        field.classList.add('is-invalid');
        this.showFieldError(field, error.message);
      }
    });
  }

  /**
   * Clear form validation
   * @param {HTMLFormElement} formElement - Form element
   */
  clearFormValidation(formElement) {
    formElement.querySelectorAll('.is-invalid').forEach(field => {
      field.classList.remove('is-invalid');
    });
    formElement.querySelectorAll('.is-valid').forEach(field => {
      field.classList.remove('is-valid');
    });
    formElement.querySelectorAll('.invalid-feedback').forEach(feedback => {
      feedback.textContent = '';
    });
  }

  /**
   * Show notification
   * @param {string} message - Notification message
   * @param {string} type - Notification type (success, error, info)
   * @param {number} duration - Duration in milliseconds
   */
  showNotification(message, type = 'info', duration = 5000) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
    notification.style.zIndex = '9999';
    notification.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after duration
    setTimeout(() => {
      notification.remove();
    }, duration);
  }

  /**
   * Show error in container
   * @param {string} containerId - Container element ID
   * @param {string} message - Error message
   */
  showError(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger" role="alert">
          <i class="ti ti-alert-circle me-2"></i>
          ${message}
        </div>
      `;
    }
  }

  /**
   * Get loading HTML
   * @returns {string} Loading HTML
   */
  getLoadingHTML() {
    return `
      <div class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Cargando...</span>
        </div>
        <p class="mt-3 text-muted">Cargando formulario...</p>
      </div>
    `;
  }

  /**
   * Get auth token
   * @returns {string|null} Auth token
   */
  getAuthToken() {
    // Get token from localStorage or cookie
    return localStorage.getItem('authToken') || this.getCookie('authToken');
  }

  /**
   * Get cookie value
   * @param {string} name - Cookie name
   * @returns {string|null} Cookie value
   */
  getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop().split(';').shift();
    }
    return null;
  }

  /**
   * Format file size
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Register custom validator
   * @param {string} formId - Form identifier
   * @param {string} fieldName - Field name
   * @param {Function} validator - Validator function
   */
  registerValidator(formId, fieldName, validator) {
    if (!this.validators.has(formId)) {
      this.validators.set(formId, {});
    }
    const validators = this.validators.get(formId);
    validators[fieldName] = validator;
  }

  /**
   * Destroy form instance
   * @param {string} formId - Form identifier
   */
  destroy(formId) {
    const formData = this.forms.get(formId);
    if (formData) {
      // Clean up any resources
      if (window.tinymce) {
        const editors = tinymce.get();
        editors.forEach(editor => {
          if (formData.element.contains(editor.targetElm)) {
            editor.remove();
          }
        });
      }
      
      // Remove from maps
      this.forms.delete(formId);
      this.validators.delete(formId);
      this.submissions.delete(formId);
    }
  }
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Export for use
window.FormRuntime = new FormRuntime();