/**
 * Form Component Factory
 * Factory pattern for creating form components in both builder and runtime modes.
 *
 * This factory handles the creation of form components with two different modes:
 * 1. Builder Mode: Components with edit controls, drag handles, and property editing
 * 2. Runtime Mode: Clean components for actual form rendering.
 */

const { ComponentRegistryHelpers } = require('./ComponentRegistry');

/**
 * Form Component Factory for creating and managing form components.
 * Handles component creation in both builder and runtime modes.
 * @class FormComponentFactory
 * @author Denisse Maldonado
 * @since 1.0.0
 */
class FormComponentFactory {
  /**
   * Creates a new FormComponentFactory instance.
   * Initializes component ID counter and active components map.
   * @example
   */
  constructor() {
    this.componentIdCounter = 0;
    this.activeComponents = new Map();
  }

  /**
   * Generate unique field ID.
   * @param type
   * @example
   */
  generateFieldId(type) {
    this.componentIdCounter++;
    return `${type}_${Date.now()}_${this.componentIdCounter}`;
  }

  /**
   * Create a component for the form builder (with edit controls).
   * @param {string} type - Component type from registry.
   * @param {object} props - Component properties.
   * @param {string} mode - 'builder' or 'runtime'.
   * @returns {object} Component configuration.
   * @example
   */
  create(type, props = {}, mode = 'builder') {
    const component = ComponentRegistryHelpers.getComponent(type);
    if (!component) {
      console.error(`Component type "${type}" not found in registry`);
      return null;
    }

    // Generate unique field ID
    const fieldId = props.id || this.generateFieldId(type);

    // Merge default props with provided props
    const defaultProps = ComponentRegistryHelpers.createDefaultProps(type);
    const finalProps = {
      ...defaultProps,
      ...props,
      id: fieldId,
      name: props.name || fieldId,
    };

    // Create component configuration
    const componentConfig = {
      id: fieldId,
      type,
      atomPath: component.atomPath,
      props: finalProps,
      category: component.category,
      icon: component.icon,
      label: component.name,
      configurable: component.configurable,
      mode,
    };

    // Store component reference
    this.activeComponents.set(fieldId, componentConfig);

    // Return appropriate HTML based on mode
    if (mode === 'builder') {
      return this.createBuilderComponent(componentConfig);
    }
    return this.createRuntimeComponent(componentConfig);
  }

  /**
   * Create component HTML for builder mode (with controls).
   * @param config
   * @example
   */
  createBuilderComponent(config) {
    const { id, type } = config;

    // Create the HTML structure for builder mode
    const html = `
            <div class="form-field-wrapper draggable-field" 
                 data-field-id="${id}" 
                 data-field-type="${type}"
                 data-field-config='${JSON.stringify(config)}'>
                
                <!-- Drag Handle -->
                <div class="field-drag-handle">
                    <i class="ti ti-grip-vertical"></i>
                </div>
                
                <!-- Field Content -->
                <div class="field-content" id="content_${id}">
                    ${this.renderFieldPreview(config)}
                </div>
                
                <!-- Field Actions -->
                <div class="field-actions">
                    <button class="btn btn-sm btn-light" onclick="FormBuilder.editField('${id}')" title="Configurar">
                        <i class="ti ti-settings"></i>
                    </button>
                    <button class="btn btn-sm btn-light" onclick="FormBuilder.duplicateField('${id}')" title="Duplicar">
                        <i class="ti ti-copy"></i>
                    </button>
                    <button class="btn btn-sm btn-light text-danger" onclick="FormBuilder.deleteField('${id}')" title="Eliminar">
                        <i class="ti ti-trash"></i>
                    </button>
                </div>
            </div>
        `;

    return {
      id,
      html,
      config,
    };
  }

  /**
   * Create component HTML for runtime mode (clean, no controls).
   * @param config
   * @example
   */
  createRuntimeComponent(config) {
    const { id } = config;

    // For runtime, we'll need to actually render the EJS component
    // This would be handled server-side in production
    const html = this.renderFieldForRuntime(config);

    return {
      id,
      html,
      config,
    };
  }

  /**
   * Render field preview for builder mode.
   * @param config
   * @example
   */
  renderFieldPreview(config) {
    const { type, props } = config;

    // Generate preview HTML based on component type
    switch (type) {
      case 'text':
      case 'email':
      case 'password':
      case 'phone':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <input type="${type === 'email' ? 'email' : 'text'}" 
                               class="form-control" 
                               placeholder="${props.placeholder || ''}"
                               disabled>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'number':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <input type="number" 
                               class="form-control" 
                               placeholder="${props.placeholder || '0'}"
                               ${props.min ? `min="${props.min}"` : ''}
                               ${props.max ? `max="${props.max}"` : ''}
                               ${props.step ? `step="${props.step}"` : ''}
                               disabled>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'textarea':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <textarea class="form-control" 
                                  rows="${props.rows || 3}"
                                  placeholder="${props.placeholder || ''}"
                                  disabled></textarea>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'select': {
        const options = props.options || [];
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <select class="form-select" disabled>
                            <option>${props.placeholder || 'Seleccione una opción'}</option>
                            ${options.map((opt) => `<option>${opt.label}</option>`).join('')}
                        </select>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;
      }

      case 'checkbox': {
        const checkOptions = props.options || [];
        if (checkOptions.length === 0) {
          // Single checkbox
          return `
                        <div class="form-check mb-3">
                            <input class="form-check-input" type="checkbox" disabled>
                            <label class="form-check-label">${props.label}</label>
                            ${props.helpText ? `<small class="form-text text-muted d-block">${props.helpText}</small>` : ''}
                        </div>
                    `;
        }
        // Checkbox group
        return `
                        <div class="mb-3">
                            <label class="form-label">
                                ${props.label}
                                ${props.required ? '<span class="text-danger">*</span>' : ''}
                            </label>
                            ${checkOptions
    .map(
      (opt) => `
                                <div class="form-check ${props.inline ? 'form-check-inline' : ''}">
                                    <input class="form-check-input" type="checkbox" disabled>
                                    <label class="form-check-label">${opt.label}</label>
                                </div>
                            `
    )
    .join('')}
                            ${props.helpText ? `<small class="form-text text-muted d-block">${props.helpText}</small>` : ''}
                        </div>
                    `;
      }

      case 'radio': {
        const radioOptions = props.options || [];
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        ${radioOptions
    .map(
      (opt) => `
                            <div class="form-check ${props.inline ? 'form-check-inline' : ''}">
                                <input class="form-check-input" type="radio" name="radio_${config.id}" disabled>
                                <label class="form-check-label">${opt.label}</label>
                            </div>
                        `
    )
    .join('')}
                        ${props.helpText ? `<small class="form-text text-muted d-block">${props.helpText}</small>` : ''}
                    </div>
                `;
      }

      case 'date':
      case 'datetime':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <input type="${type === 'datetime' ? 'datetime-local' : 'date'}" 
                               class="form-control" 
                               disabled>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'time':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <input type="time" 
                               class="form-control" 
                               disabled>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'file':
      case 'image':
        return `
                    <div class="mb-3">
                        <label class="form-label">
                            ${props.label}
                            ${props.required ? '<span class="text-danger">*</span>' : ''}
                        </label>
                        <input type="file" 
                               class="form-control" 
                               accept="${props.accept || '*/*'}"
                               ${props.multiple ? 'multiple' : ''}
                               disabled>
                        ${props.helpText ? `<small class="form-text text-muted">${props.helpText}</small>` : ''}
                    </div>
                `;

      case 'section':
        return `
                    <div class="form-section mb-4">
                        <h5 class="section-title">${props.title || 'Nueva Sección'}</h5>
                        ${props.description ? `<p class="text-muted">${props.description}</p>` : ''}
                        <div class="section-content">
                            <!-- Los campos de esta sección se agregarán aquí -->
                        </div>
                    </div>
                `;

      case 'divider':
        return `<hr class="my-4" style="border-style: ${props.style || 'solid'}; border-width: ${props.thickness || 1}px; border-color: ${props.color || '#dee2e6'};">`;

      case 'heading': {
        const HeadingTag = `h${props.level || 3}`;
        return `<${HeadingTag} class="${props.className || ''}">${props.text || 'Título'}</${HeadingTag}>`;
      }

      case 'paragraph':
        return `<p class="${props.className || 'text-muted'}">${props.text || 'Texto informativo'}</p>`;

      default:
        return `
                    <div class="alert alert-info">
                        <i class="${config.icon || 'ti ti-help'}"></i> 
                        Componente: ${config.label}
                    </div>
                `;
    }
  }

  /**
   * Render field for runtime (actual form).
   * @param config
   * @example
   */
  renderFieldForRuntime(config) {
    // In production, this would call server-side EJS rendering
    // For now, return a simplified version
    return this.renderFieldPreview(config).replace(/disabled/g, '');
  }

  /**
   * Update component properties.
   * @param fieldId
   * @param newProps
   * @example
   */
  updateComponent(fieldId, newProps) {
    const component = this.activeComponents.get(fieldId);
    if (!component) {
      console.error(`Component ${fieldId} not found`);
      return null;
    }

    // Update props
    component.props = {
      ...component.props,
      ...newProps,
    };

    // Re-render the component
    const updatedHtml = this.renderFieldPreview(component);

    // Update the DOM if in builder mode
    const fieldElement = document.getElementById(`content_${fieldId}`);
    if (fieldElement) {
      fieldElement.innerHTML = updatedHtml;
    }

    return component;
  }

  /**
   * Duplicate a component.
   * @param fieldId
   * @example
   */
  duplicateComponent(fieldId) {
    const original = this.activeComponents.get(fieldId);
    if (!original) {
      console.error(`Component ${fieldId} not found`);
      return null;
    }

    // Create a new component with the same props but new ID
    const duplicatedProps = { ...original.props };
    delete duplicatedProps.id;
    delete duplicatedProps.name;

    return this.create(original.type, duplicatedProps, original.mode);
  }

  /**
   * Delete a component.
   * @param fieldId
   * @example
   */
  deleteComponent(fieldId) {
    this.activeComponents.delete(fieldId);

    // Remove from DOM
    const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (fieldElement) {
      fieldElement.remove();
    }
  }

  /**
   * Get all active components.
   * @example
   */
  getAllComponents() {
    return Array.from(this.activeComponents.values());
  }

  /**
   * Clear all components.
   * @example
   */
  clearAll() {
    this.activeComponents.clear();
    this.componentIdCounter = 0;
  }

  /**
   * Export form configuration as JSON.
   * @example
   */
  exportConfiguration() {
    const components = this.getAllComponents();
    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      components: components.map((comp) => ({
        id: comp.id,
        type: comp.type,
        props: comp.props,
        position: comp.position || 0,
      })),
    };
  }

  /**
   * Import form configuration from JSON.
   * @param config
   * @param mode
   * @example
   */
  importConfiguration(config, mode = 'builder') {
    this.clearAll();

    if (!config || !config.components) {
      console.error('Invalid configuration format');
      return false;
    }

    const components = [];
    config.components.forEach((comp) => {
      const created = this.create(comp.type, comp.props, mode);
      if (created) {
        components.push(created);
      }
    });

    return components;
  }
}

// Create singleton instance
const formComponentFactory = new FormComponentFactory();

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FormComponentFactory;
} else {
  window.FormComponentFactory = FormComponentFactory;
  window.formComponentFactory = formComponentFactory;
}
