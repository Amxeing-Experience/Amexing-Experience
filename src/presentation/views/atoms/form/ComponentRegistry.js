/**
 * Form Component Registry
 * Maps drag-and-drop component types to atomic components with their default properties.
 *
 * This registry serves as the central configuration for all form builder components,
 * defining how each draggable item maps to an atomic component and its properties.
 */

const ComponentRegistry = {
  // Basic Input Components
  text: {
    name: 'Texto',
    icon: 'ti-text-caption',
    category: 'basic',
    atomPath: '/atoms/form/input-text',
    defaultProps: {
      label: 'Campo de Texto',
      placeholder: 'Ingrese texto',
      required: false,
      helpText: '',
      validation: {
        minLength: null,
        maxLength: null,
        pattern: null,
      },
    },
    configurable: ['label', 'placeholder', 'required', 'helpText', 'validation'],
  },

  number: {
    name: 'Número',
    icon: 'ti-hash',
    category: 'basic',
    atomPath: '/atoms/form/input-number',
    defaultProps: {
      label: 'Campo Numérico',
      placeholder: '0',
      required: false,
      min: null,
      max: null,
      step: 1,
      helpText: '',
    },
    configurable: ['label', 'placeholder', 'required', 'min', 'max', 'step', 'helpText'],
  },

  email: {
    name: 'Email',
    icon: 'ti-at',
    category: 'basic',
    atomPath: '/atoms/form/input-email',
    defaultProps: {
      label: 'Correo Electrónico',
      placeholder: 'correo@ejemplo.com',
      required: false,
      helpText: '',
    },
    configurable: ['label', 'placeholder', 'required', 'helpText'],
  },

  password: {
    name: 'Contraseña',
    icon: 'ti-lock',
    category: 'basic',
    atomPath: '/atoms/form/input-password',
    defaultProps: {
      label: 'Contraseña',
      placeholder: '••••••••',
      required: false,
      helpText: '',
      validation: {
        minLength: 8,
        maxLength: null,
        pattern: null,
      },
    },
    configurable: ['label', 'placeholder', 'required', 'helpText', 'validation'],
  },

  textarea: {
    name: 'Área de Texto',
    icon: 'ti-text-wrap',
    category: 'basic',
    atomPath: '/atoms/form/textarea',
    defaultProps: {
      label: 'Descripción',
      placeholder: 'Ingrese una descripción',
      required: false,
      rows: 3,
      helpText: '',
      validation: {
        minLength: null,
        maxLength: null,
      },
    },
    configurable: ['label', 'placeholder', 'required', 'rows', 'helpText', 'validation'],
  },

  phone: {
    name: 'Teléfono',
    icon: 'ti-phone',
    category: 'basic',
    atomPath: '/atoms/form/input-phone',
    defaultProps: {
      label: 'Teléfono',
      placeholder: '+52 123 456 7890',
      required: false,
      helpText: '',
      validation: {
        pattern: '^[+]?[(]?[0-9]{1,3}[)]?[-\\s\\.]?[(]?[0-9]{1,4}[)]?[-\\s\\.]?[0-9]{1,4}[-\\s\\.]?[0-9]{1,9}$',
      },
    },
    configurable: ['label', 'placeholder', 'required', 'helpText'],
  },

  // Selection Components
  select: {
    name: 'Dropdown',
    icon: 'ti-chevron-down',
    category: 'selection',
    atomPath: '/atoms/form/select',
    defaultProps: {
      label: 'Selección',
      placeholder: 'Seleccione una opción',
      required: false,
      options: [
        { value: 'option1', label: 'Opción 1' },
        { value: 'option2', label: 'Opción 2' },
        { value: 'option3', label: 'Opción 3' },
      ],
      helpText: '',
    },
    configurable: ['label', 'placeholder', 'required', 'options', 'helpText'],
  },

  radio: {
    name: 'Radio',
    icon: 'ti-circle-dot',
    category: 'selection',
    atomPath: '/atoms/form/radio',
    defaultProps: {
      label: 'Opciones',
      required: false,
      options: [
        { value: 'option1', label: 'Opción 1' },
        { value: 'option2', label: 'Opción 2' },
        { value: 'option3', label: 'Opción 3' },
      ],
      inline: false,
      helpText: '',
    },
    configurable: ['label', 'required', 'options', 'inline', 'helpText'],
  },

  checkbox: {
    name: 'Checkbox',
    icon: 'ti-checkbox',
    category: 'selection',
    atomPath: '/atoms/form/checkbox',
    defaultProps: {
      label: 'Opciones Múltiples',
      required: false,
      options: [
        { value: 'option1', label: 'Opción 1' },
        { value: 'option2', label: 'Opción 2' },
        { value: 'option3', label: 'Opción 3' },
      ],
      inline: false,
      helpText: '',
    },
    configurable: ['label', 'required', 'options', 'inline', 'helpText'],
  },

  toggle: {
    name: 'Toggle',
    icon: 'ti-toggle-left',
    category: 'selection',
    atomPath: '/atoms/form/toggle',
    defaultProps: {
      label: 'Activar/Desactivar',
      required: false,
      helpText: '',
    },
    configurable: ['label', 'required', 'helpText'],
  },

  // Date & Time Components
  date: {
    name: 'Fecha',
    icon: 'ti-calendar',
    category: 'datetime',
    atomPath: '/atoms/form/datepicker',
    defaultProps: {
      label: 'Fecha',
      placeholder: 'dd/mm/aaaa',
      required: false,
      min: null,
      max: null,
      helpText: '',
    },
    configurable: ['label', 'placeholder', 'required', 'min', 'max', 'helpText'],
  },

  time: {
    name: 'Hora',
    icon: 'ti-clock',
    category: 'datetime',
    atomPath: '/atoms/form/timepicker',
    defaultProps: {
      label: 'Hora',
      placeholder: 'HH:MM',
      required: false,
      min: null,
      max: null,
      helpText: '',
    },
    configurable: ['label', 'placeholder', 'required', 'min', 'max', 'helpText'],
  },

  datetime: {
    name: 'Fecha y Hora',
    icon: 'ti-calendar-time',
    category: 'datetime',
    atomPath: '/atoms/form/datetime',
    defaultProps: {
      label: 'Fecha y Hora',
      required: false,
      min: null,
      max: null,
      helpText: '',
    },
    configurable: ['label', 'required', 'min', 'max', 'helpText'],
  },

  daterange: {
    name: 'Rango de Fechas',
    icon: 'ti-calendar-stats',
    category: 'datetime',
    atomPath: '/molecules/form/date-range',
    defaultProps: {
      label: 'Rango de Fechas',
      startLabel: 'Fecha Inicio',
      endLabel: 'Fecha Fin',
      required: false,
      helpText: '',
    },
    configurable: ['label', 'startLabel', 'endLabel', 'required', 'helpText'],
  },

  // Advanced Components
  file: {
    name: 'Archivo',
    icon: 'ti-paperclip',
    category: 'advanced',
    atomPath: '/atoms/form/file-upload',
    defaultProps: {
      label: 'Cargar Archivo',
      required: false,
      accept: '*/*',
      multiple: false,
      maxSize: 5242880, // 5MB in bytes
      helpText: 'Máximo 5MB',
    },
    configurable: ['label', 'required', 'accept', 'multiple', 'maxSize', 'helpText'],
  },

  image: {
    name: 'Imagen',
    icon: 'ti-photo',
    category: 'advanced',
    atomPath: '/atoms/form/image-upload',
    defaultProps: {
      label: 'Cargar Imagen',
      required: false,
      accept: 'image/*',
      multiple: false,
      maxSize: 5242880,
      preview: true,
      helpText: 'JPG, PNG o GIF. Máximo 5MB',
    },
    configurable: ['label', 'required', 'multiple', 'maxSize', 'preview', 'helpText'],
  },

  signature: {
    name: 'Firma',
    icon: 'ti-signature',
    category: 'advanced',
    atomPath: '/atoms/form/signature',
    defaultProps: {
      label: 'Firma Digital',
      required: false,
      width: 400,
      height: 200,
      helpText: 'Dibuje su firma en el recuadro',
    },
    configurable: ['label', 'required', 'width', 'height', 'helpText'],
  },

  location: {
    name: 'Ubicación',
    icon: 'ti-map-pin',
    category: 'advanced',
    atomPath: '/atoms/form/location',
    defaultProps: {
      label: 'Ubicación',
      required: false,
      enableMap: true,
      enableGeolocation: true,
      helpText: '',
    },
    configurable: ['label', 'required', 'enableMap', 'enableGeolocation', 'helpText'],
  },

  rating: {
    name: 'Calificación',
    icon: 'ti-star',
    category: 'advanced',
    atomPath: '/atoms/form/rating',
    defaultProps: {
      label: 'Calificación',
      required: false,
      max: 5,
      allowHalf: false,
      helpText: '',
    },
    configurable: ['label', 'required', 'max', 'allowHalf', 'helpText'],
  },

  richtext: {
    name: 'Texto Rico',
    icon: 'ti-text-size',
    category: 'advanced',
    atomPath: '/atoms/form/richtext',
    defaultProps: {
      label: 'Contenido',
      required: false,
      toolbar: 'basic',
      height: 200,
      helpText: '',
    },
    configurable: ['label', 'required', 'toolbar', 'height', 'helpText'],
  },

  // Layout Components
  section: {
    name: 'Sección',
    icon: 'ti-layout-navbar',
    category: 'layout',
    atomPath: '/organisms/form/form-section',
    defaultProps: {
      title: 'Nueva Sección',
      description: '',
      collapsible: false,
      collapsed: false,
    },
    configurable: ['title', 'description', 'collapsible', 'collapsed'],
  },

  divider: {
    name: 'Separador',
    icon: 'ti-separator',
    category: 'layout',
    atomPath: '/atoms/form/divider',
    defaultProps: {
      style: 'solid',
      thickness: 1,
      color: '#dee2e6',
    },
    configurable: ['style', 'thickness', 'color'],
  },

  heading: {
    name: 'Título',
    icon: 'ti-h-1',
    category: 'layout',
    atomPath: '/atoms/form/heading',
    defaultProps: {
      text: 'Título',
      level: 3,
      className: '',
    },
    configurable: ['text', 'level', 'className'],
  },

  paragraph: {
    name: 'Párrafo',
    icon: 'ti-text',
    category: 'layout',
    atomPath: '/atoms/form/paragraph',
    defaultProps: {
      text: 'Texto informativo o instrucciones para el usuario.',
      className: 'text-muted',
    },
    configurable: ['text', 'className'],
  },
};

// Helper functions
const ComponentRegistryHelpers = {
  /**
   * Get component by type.
   * @param type
   * @example
   */
  getComponent(type) {
    return ComponentRegistry[type] || null;
  },

  /**
   * Get components by category.
   * @param category
   * @example
   */
  getComponentsByCategory(category) {
    return Object.entries(ComponentRegistry)
      .filter(([_key, comp]) => comp.category === category)
      .reduce((acc, [key, comp]) => ({ ...acc, [key]: comp }), {});
  },

  /**
   * Get all categories.
   * @example
   */
  getCategories() {
    const categories = new Set();
    Object.values(ComponentRegistry).forEach((comp) => {
      categories.add(comp.category);
    });
    return Array.from(categories);
  },

  /**
   * Create default props for a component type.
   * @param type
   * @example
   */
  createDefaultProps(type) {
    const component = this.getComponent(type);
    if (!component) return {};

    // Deep clone to avoid reference issues
    return JSON.parse(JSON.stringify(component.defaultProps));
  },

  /**
   * Validate props for a component type.
   * @param type
   * @param props
   * @param _props
   * @example
   */
  validateProps(type, _props) {
    const component = this.getComponent(type);
    if (!component) return false;

    // Check if all required props are present
    // Add validation logic here
    return true;
  },
};

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ComponentRegistry, ComponentRegistryHelpers };
} else {
  window.ComponentRegistry = ComponentRegistry;
  window.ComponentRegistryHelpers = ComponentRegistryHelpers;
}
