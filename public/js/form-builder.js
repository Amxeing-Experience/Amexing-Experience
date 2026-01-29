/**
 * Form Builder Main System
 * Integrates ComponentRegistry, FormComponentFactory, and drag-drop functionality
 */

class FormBuilder {
    constructor() {
        this.currentForm = null;
        this.selectedField = null;
        this.dropZones = [];
        this.sortableInstances = [];
        this.factory = window.formComponentFactory;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
    }

    /**
     * Initialize the form builder
     */
    init() {
        console.log('Initializing Form Builder...');
        
        // Load component registry and factory
        this.loadDependencies();
        
        // Initialize drag and drop
        this.initDragDrop();
        
        // Initialize event listeners
        this.initEventListeners();
        
        // Load form if editing existing
        const formId = this.getFormIdFromUrl();
        if (formId) {
            this.loadForm(formId).catch(error => {
                console.error('Error loading form during initialization:', error);
                // Continue with empty form if loading fails
            });
        }
        
        console.log('Form Builder initialized successfully');
    }

    /**
     * Load required dependencies
     */
    loadDependencies() {
        // Check if dependencies are loaded
        if (!window.ComponentRegistry) {
            console.error('ComponentRegistry not loaded');
            return false;
        }
        
        if (!window.formComponentFactory) {
            console.error('FormComponentFactory not loaded');
            return false;
        }
        
        if (typeof Sortable === 'undefined') {
            console.error('SortableJS not loaded');
            return false;
        }
        
        return true;
    }

    /**
     * Initialize drag and drop functionality
     */
    initDragDrop() {
        // Make component palette draggable
        this.initComponentPalette();
        
        // Make form canvas droppable and sortable
        this.initFormCanvas();
    }

    /**
     * Initialize component palette drag functionality
     */
    initComponentPalette() {
        const componentItems = document.querySelectorAll('.component-item[draggable="true"]');
        
        componentItems.forEach(item => {
            // Drag start
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('componentType', item.dataset.componentType);
                e.dataTransfer.setData('action', 'add');
                
                // Add dragging class
                item.classList.add('dragging');
                
                // Show drop zones
                this.showDropZones();
            });
            
            // Drag end
            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
                this.hideDropZones();
            });
        });
    }

    /**
     * Initialize form canvas drop and sort functionality
     */
    initFormCanvas() {
        const formCanvas = document.getElementById('formCanvas');
        if (!formCanvas) return;
        
        // Make the canvas a drop zone
        formCanvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            
            // Add visual feedback
            formCanvas.classList.add('drag-over');
            
            // Show drop indicator
            this.showDropIndicator(e);
        });
        
        formCanvas.addEventListener('dragleave', (e) => {
            if (e.target === formCanvas) {
                formCanvas.classList.remove('drag-over');
            }
        });
        
        formCanvas.addEventListener('drop', (e) => {
            e.preventDefault();
            formCanvas.classList.remove('drag-over');
            
            const action = e.dataTransfer.getData('action');
            
            if (action === 'add') {
                // Adding new component from palette
                const componentType = e.dataTransfer.getData('componentType');
                this.addComponent(componentType, e);
            }
            
            this.hideDropZones();
            this.hideDropIndicator();
        });
        
        // Make sortable fields containers sortable
        const sortableContainers = formCanvas.querySelectorAll('.sortable-fields');
        sortableContainers.forEach(container => {
            this.makeSortable(container);
        });
        
        // If no sortable containers found, create one
        if (sortableContainers.length === 0) {
            const defaultSection = document.createElement('div');
            defaultSection.className = 'sortable-fields';
            formCanvas.appendChild(defaultSection);
            this.makeSortable(defaultSection);
        }
    }

    /**
     * Make a container sortable
     */
    makeSortable(container) {
        if (!container) return;
        
        const sortable = new Sortable(container, {
            group: 'form-fields',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            handle: '.field-drag-handle',
            fallbackOnBody: true,
            swapThreshold: 0.65,
            onStart: (evt) => {
                this.showDropZones();
            },
            onEnd: (evt) => {
                this.hideDropZones();
                this.saveHistory();
                
                // Update field positions
                this.updateFieldPositions();
            }
        });
        
        this.sortableInstances.push(sortable);
        return sortable;
    }

    /**
     * Add a new component to the form
     */
    addComponent(type, event) {
        console.log(`Adding component of type: ${type}`);
        
        // Create the component using factory
        const component = this.factory.create(type, {}, 'builder');
        
        if (!component) {
            console.error(`Failed to create component of type: ${type}`);
            return;
        }
        
        // Find drop position
        const dropTarget = this.findDropTarget(event);
        
        // Create DOM element
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = component.html;
        const newElement = tempDiv.firstElementChild;
        
        // Add to form canvas
        if (dropTarget && dropTarget.nextSibling) {
            dropTarget.parentNode.insertBefore(newElement, dropTarget.nextSibling);
        } else {
            const formCanvas = document.getElementById('formCanvas');
            
            // Remove empty state if exists
            const emptyState = formCanvas.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }
            
            // Find the best position to insert
            const position = this.calculateDropPosition(event);
            const fields = formCanvas.querySelectorAll('.form-field-wrapper');
            
            if (position < fields.length && fields[position]) {
                // Ensure we have a valid reference node
                fields[position].parentNode.insertBefore(newElement, fields[position]);
            } else {
                // Append to the sortable container
                let targetContainer = formCanvas.querySelector('.sortable-fields');
                
                // If no sortable container exists, find or create one
                if (!targetContainer) {
                    const formSection = formCanvas.querySelector('.form-section');
                    if (formSection) {
                        targetContainer = formSection.querySelector('.sortable-fields');
                    }
                    
                    // Still no container? Create default section
                    if (!targetContainer) {
                        const defaultSection = document.createElement('div');
                        defaultSection.className = 'form-section mb-4';
                        defaultSection.dataset.sectionId = 'default';
                        
                        const sortableContainer = document.createElement('div');
                        sortableContainer.className = 'sortable-fields';
                        defaultSection.appendChild(sortableContainer);
                        
                        formCanvas.appendChild(defaultSection);
                        targetContainer = sortableContainer;
                        
                        // Make it sortable
                        this.makeSortable(targetContainer);
                    }
                }
                
                if (targetContainer) {
                    targetContainer.appendChild(newElement);
                } else {
                    console.error('Could not find or create sortable container');
                }
            }
        }
        
        // Make the new field draggable
        this.makeFieldDraggable(newElement);
        
        // Save to history
        this.saveHistory();
        
        // Select the new field for editing
        this.selectField(component.id);
        
        console.log(`Component ${component.id} added successfully`);
    }

    /**
     * Make a field element draggable
     */
    makeFieldDraggable(element) {
        const handle = element.querySelector('.field-drag-handle');
        if (handle) {
            handle.style.cursor = 'move';
        }
    }

    /**
     * Calculate drop position based on mouse position
     */
    calculateDropPosition(event) {
        const formCanvas = document.getElementById('formCanvas');
        const fields = formCanvas.querySelectorAll('.form-field-wrapper');
        const mouseY = event.clientY;
        
        let position = fields.length;
        
        for (let i = 0; i < fields.length; i++) {
            const rect = fields[i].getBoundingClientRect();
            if (mouseY < rect.top + rect.height / 2) {
                position = i;
                break;
            }
        }
        
        return position;
    }

    /**
     * Find the target element for dropping
     */
    findDropTarget(event) {
        const elements = document.elementsFromPoint(event.clientX, event.clientY);
        return elements.find(el => el.classList.contains('form-field-wrapper'));
    }

    /**
     * Show drop zones
     */
    showDropZones() {
        const formCanvas = document.getElementById('formCanvas');
        if (formCanvas) {
            formCanvas.classList.add('show-drop-zones');
        }
    }

    /**
     * Hide drop zones
     */
    hideDropZones() {
        const formCanvas = document.getElementById('formCanvas');
        if (formCanvas) {
            formCanvas.classList.remove('show-drop-zones');
        }
    }

    /**
     * Show drop indicator
     */
    showDropIndicator(event) {
        // Implementation for visual drop indicator
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.id = 'drop-indicator';
        
        const formCanvas = document.getElementById('formCanvas');
        const existing = document.getElementById('drop-indicator');
        if (existing) {
            existing.remove();
        }
        
        const position = this.calculateDropPosition(event);
        const fields = formCanvas.querySelectorAll('.form-field-wrapper');
        
        if (position < fields.length) {
            fields[position].parentNode.insertBefore(indicator, fields[position]);
        } else if (fields.length > 0) {
            fields[fields.length - 1].parentNode.appendChild(indicator);
        } else {
            formCanvas.appendChild(indicator);
        }
    }

    /**
     * Hide drop indicator
     */
    hideDropIndicator() {
        const indicator = document.getElementById('drop-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Select a field for editing
     */
    selectField(fieldId) {
        // Remove previous selection
        document.querySelectorAll('.form-field-wrapper').forEach(field => {
            field.classList.remove('selected');
        });
        
        // Add selection to target field
        const field = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (field) {
            field.classList.add('selected');
            this.selectedField = fieldId;
            
            // Load properties in properties panel
            this.loadFieldProperties(fieldId);
        }
    }

    /**
     * Load field properties in the properties panel
     */
    loadFieldProperties(fieldId) {
        const component = this.factory.activeComponents.get(fieldId);
        if (!component) return;
        
        // Switch to properties tab
        const propertiesTab = document.querySelector('[data-bs-target="#propertiesTab"]');
        if (propertiesTab) {
            const tab = new bootstrap.Tab(propertiesTab);
            tab.show();
        }
        
        // Hide no selection message
        const noSelection = document.querySelector('.no-selection');
        if (noSelection) {
            noSelection.classList.add('d-none');
        }
        
        // Show properties form
        const propertiesForm = document.querySelector('.properties-form');
        if (propertiesForm) {
            propertiesForm.classList.remove('d-none');
            
            // Populate form with current values
            const props = component.props;
            
            // Basic properties
            this.setPropertyValue('propLabel', props.label);
            this.setPropertyValue('propName', props.name);
            this.setPropertyValue('propPlaceholder', props.placeholder);
            this.setPropertyValue('propHelpText', props.helpText);
            
            // Validation
            this.setPropertyValue('propRequired', props.required, 'checkbox');
            this.setPropertyValue('propMinLength', props.validation?.minLength);
            this.setPropertyValue('propMaxLength', props.validation?.maxLength);
            
            // Advanced
            this.setPropertyValue('propDefaultValue', props.defaultValue);
            this.setPropertyValue('propReadOnly', props.readonly, 'checkbox');
            this.setPropertyValue('propDisabled', props.disabled, 'checkbox');
        }
    }

    /**
     * Set property value in form
     */
    setPropertyValue(elementId, value, type = 'text') {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        if (type === 'checkbox') {
            element.checked = !!value;
        } else {
            element.value = value || '';
        }
    }

    /**
     * Edit field (called from field action button)
     */
    editField(fieldId) {
        this.selectField(fieldId);
    }

    /**
     * Duplicate field (called from field action button)
     */
    duplicateField(fieldId) {
        const duplicated = this.factory.duplicateComponent(fieldId);
        if (duplicated) {
            // Add to DOM after original
            const original = document.querySelector(`[data-field-id="${fieldId}"]`);
            if (original) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = duplicated.html;
                const newElement = tempDiv.firstElementChild;
                original.parentNode.insertBefore(newElement, original.nextSibling);
                
                // Make draggable
                this.makeFieldDraggable(newElement);
                
                // Save history
                this.saveHistory();
            }
        }
    }

    /**
     * Delete field (called from field action button)
     */
    deleteField(fieldId) {
        if (confirm('¿Está seguro de eliminar este campo?')) {
            this.factory.deleteComponent(fieldId);
            this.saveHistory();
            
            // Check if form is empty
            const formCanvas = document.getElementById('formCanvas');
            const remainingFields = formCanvas.querySelectorAll('.form-field-wrapper');
            
            if (remainingFields.length === 0) {
                // Show empty state
                const emptyState = `
                    <div class="empty-state text-center py-5">
                        <i class="ti ti-drag-drop display-1 text-muted"></i>
                        <h5 class="mt-3 text-muted">Arrastra componentes aquí</h5>
                        <p class="text-muted">Comienza agregando campos desde el panel derecho</p>
                    </div>
                `;
                formCanvas.innerHTML = emptyState;
            }
        }
    }

    /**
     * Update field positions after reordering
     */
    updateFieldPositions() {
        const formCanvas = document.getElementById('formCanvas');
        const fields = formCanvas.querySelectorAll('.form-field-wrapper');
        
        fields.forEach((field, index) => {
            const fieldId = field.dataset.fieldId;
            const component = this.factory.activeComponents.get(fieldId);
            if (component) {
                component.position = index;
            }
        });
    }

    /**
     * Save current state to history
     */
    saveHistory() {
        const state = this.factory.exportConfiguration();
        
        // Remove any states after current index
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // Add new state
        this.history.push(state);
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
        
        // Update undo/redo buttons
        this.updateHistoryButtons();
    }

    /**
     * Undo last action
     */
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreState(this.history[this.historyIndex]);
            this.updateHistoryButtons();
        }
    }

    /**
     * Redo last undone action
     */
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreState(this.history[this.historyIndex]);
            this.updateHistoryButtons();
        }
    }

    /**
     * Restore form state
     */
    restoreState(state) {
        const formCanvas = document.getElementById('formCanvas');
        formCanvas.innerHTML = '';
        
        const components = this.factory.importConfiguration(state, 'builder');
        
        components.forEach(comp => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = comp.html;
            const element = tempDiv.firstElementChild;
            formCanvas.appendChild(element);
            this.makeFieldDraggable(element);
        });
    }

    /**
     * Update history buttons
     */
    updateHistoryButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        if (undoBtn) {
            undoBtn.disabled = this.historyIndex <= 0;
        }
        
        if (redoBtn) {
            redoBtn.disabled = this.historyIndex >= this.history.length - 1;
        }
    }

    /**
     * Save form to server
     */
    async saveForm() {
        try {
            const formTitle = document.getElementById('formTitle')?.value || 'Sin título';
            const formDescription = document.getElementById('formDescription')?.value || '';
            const formConfig = this.factory.exportConfiguration();
            
            // Get form ID from selected template or generate new one
            const selectedTemplate = document.querySelector('#formTemplatesList .active');
            const formId = selectedTemplate?.dataset.formId || `form-${Date.now()}`;
            
            const formData = {
                formId: formId,
                title: formTitle,
                description: formDescription,
                fields: formConfig.components.map((comp, index) => this.convertComponentToField(comp, index)),
                settings: {
                    submitUrl: `/api/forms/${formId}/submit`,
                    redirectAfterSubmit: false,
                    showProgressBar: false,
                    enableDrafts: true,
                    postSubmissionActions: []
                },
                validation: {
                    validateOnBlur: true,
                    validateOnSubmit: true,
                    showInlineErrors: true
                }
            };
            
            console.log('Saving form to database:', formData);
            
            // Send to server with session authentication
            // Include credentials to send cookies for session auth
            console.log('Making fetch request to: /api/forms/save-template');
            const response = await fetch('/api/forms/save-template', {
                method: 'POST',
                credentials: 'include', // This sends cookies for session authentication
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });
            
            console.log('Response status:', response.status);
            console.log('Response OK:', response.ok);
            
            const result = await response.json();
            console.log('Response result:', result);
            
            if (result.success) {
                this.showNotification('Formulario guardado exitosamente', 'success');
                this.markAsSaved();
                
                // Reload templates list to update field counts
                if (window.loadFormTemplates) {
                    window.loadFormTemplates();
                }
            } else {
                throw new Error(result.error || 'Error al guardar el formulario');
            }
            
            return formData;
        } catch (error) {
            console.error('Error saving form:', error);
            this.showNotification('Error al guardar el formulario: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Load form from server
     */
    async loadForm(formId) {
        try {
            console.log(`Loading form ${formId} from server...`);
            
            // Fetch from server with session authentication
            const response = await fetch(`/api/forms/${formId}`, {
                credentials: 'include' // This sends cookies for session authentication
            });
            
            const result = await response.json();
            
            if (!result.success) {
                // If form not found, that's normal for new forms - just log and continue
                if (result.error === 'Form not found') {
                    console.log(`Form ${formId} not found - creating new form`);
                    return; // Exit gracefully, form builder will start empty
                }
                throw new Error(result.error || 'Error al cargar el formulario');
            }
            
            const formData = result.data;
            
            // Update form title and description
            const titleInput = document.getElementById('formTitle');
            if (titleInput) titleInput.value = formData.title;
            
            const descInput = document.getElementById('formDescription');
            if (descInput) descInput.value = formData.description;
            
            // Convert fields to components format
            const components = formData.fields.map(field => ({
                type: field.componentType.replace('atom:', ''),
                props: field.props
            }));
            
            // Import configuration
            this.factory.importConfiguration({ components });
            
            console.log('Form loaded successfully');
            this.showNotification('Formulario cargado exitosamente', 'success');
            
        } catch (error) {
            console.error('Error loading form:', error);
            
            // Load sample data as fallback
            console.log('Loading sample form as fallback...');
            const sampleForm = {
                name: 'Formulario de Ejemplo',
                description: 'Este es un formulario de prueba',
                components: [
                    {
                        type: 'text',
                        props: {
                            label: 'Nombre Completo',
                            placeholder: 'Ingrese su nombre',
                            required: true
                        }
                    },
                    {
                        type: 'email',
                        props: {
                            label: 'Correo Electrónico',
                            placeholder: 'correo@ejemplo.com',
                            required: true
                        }
                    }
                ]
            };
            
            // Set form title and description
            const titleElement = document.getElementById('formTitle');
            if (titleElement) titleElement.value = sampleForm.name;
            
            const descElement = document.getElementById('formDescription');
            if (descElement) descElement.value = sampleForm.description;
            
            // Load components
            this.restoreState(sampleForm);
        }
    }

    /**
     * Get form ID from URL
     */
    getFormIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('id');
    }

    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Undo/Redo buttons
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undo());
        }
        
        const redoBtn = document.getElementById('redoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => this.redo());
        }
        
        // Save button
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveForm());
        }
        
        // Apply properties button
        const applyBtn = document.getElementById('applyProperties');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this.applyProperties());
        }
        
        // Form template selection
        const templates = document.querySelectorAll('#formTemplatesList .list-group-item');
        templates.forEach(template => {
            template.addEventListener('click', (e) => {
                e.preventDefault();
                this.loadFormTemplate(template.dataset.formId);
            });
        });
    }

    /**
     * Apply properties from properties panel
     */
    applyProperties() {
        if (!this.selectedField) return;
        
        const newProps = {
            label: document.getElementById('propLabel')?.value,
            name: document.getElementById('propName')?.value,
            placeholder: document.getElementById('propPlaceholder')?.value,
            helpText: document.getElementById('propHelpText')?.value,
            required: document.getElementById('propRequired')?.checked,
            readonly: document.getElementById('propReadOnly')?.checked,
            disabled: document.getElementById('propDisabled')?.checked,
            defaultValue: document.getElementById('propDefaultValue')?.value,
            validation: {
                minLength: parseInt(document.getElementById('propMinLength')?.value) || null,
                maxLength: parseInt(document.getElementById('propMaxLength')?.value) || null
            }
        };
        
        // Update component
        this.factory.updateComponent(this.selectedField, newProps);
        
        // Save history
        this.saveHistory();
        
        // Show success message
        console.log('Properties applied successfully');
    }

    /**
     * Load a form template
     */
    async loadFormTemplate(templateId) {
        console.log(`Loading template: ${templateId}`);
        
        try {
            // Clear current form
            this.factory.clearAll();
            const formCanvas = document.getElementById('formCanvas');
            formCanvas.innerHTML = '';
            
            // Show loading state
            formCanvas.innerHTML = '<div class="d-flex justify-content-center align-items-center" style="height: 200px;"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';
            
            // Load template from server
            const response = await fetch(`/api/forms/${templateId}`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to load template');
            }
            
            const template = result.data;
            console.log('Template loaded:', template);
            
            // Update form title and description
            this.updateFormTitleAndDescription(template);
            
            // Clear loading state
            formCanvas.innerHTML = '';
            
            // Load template fields
            if (template && template.fields && Array.isArray(template.fields)) {
                template.fields.forEach(field => {
                    // Convert database field format to component format
                    const componentData = this.convertFieldToComponent(field);
                    
                    const component = this.factory.create(componentData.type, componentData.props, 'builder');
                    if (component) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = component.html;
                        const element = tempDiv.firstElementChild;
                        formCanvas.appendChild(element);
                        this.makeFieldDraggable(element);
                    }
                });
            } else {
                // No fields in template, show empty state
                formCanvas.innerHTML = '<div class="text-center text-muted py-5"><h5>Template vacía</h5><p>Esta plantilla no tiene campos. Arrastra componentes desde el panel izquierdo para comenzar.</p></div>';
            }
            
            this.saveHistory();
            
        } catch (error) {
            console.error('Error loading template:', error);
            
            // Show error state
            const formCanvas = document.getElementById('formCanvas');
            formCanvas.innerHTML = `
                <div class="text-center text-danger py-5">
                    <h5>Error al cargar la plantilla</h5>
                    <p>${error.message}</p>
                    <button class="btn btn-outline-primary" onclick="window.formBuilder.loadFormTemplate('${templateId}')">
                        <i class="ti ti-refresh"></i> Reintentar
                    </button>
                </div>
            `;
        }
    }
    
    /**
     * Convert database field format to component format
     * Handles both new field format and legacy component format
     */
    convertFieldToComponent(field) {
        // Handle legacy component format (backward compatibility)
        if (field.componentType && field.props) {
            const type = field.componentType.replace('atom:', '');
            return {
                type: type,
                props: {
                    id: field.props.id || field.id,
                    name: field.props.name || field.props.id || field.id,
                    label: field.props.label || '',
                    required: field.props.required || false,
                    placeholder: field.props.placeholder || '',
                    helpText: field.props.helpText || '',
                    rows: field.props.rows,
                    min: field.props.min,
                    max: field.props.max,
                    step: field.props.step,
                    options: field.props.options,
                    minLength: field.props.validation?.minLength,
                    maxLength: field.props.validation?.maxLength,
                    pattern: field.props.validation?.pattern
                }
            };
        }
        
        // Handle new database field format
        const componentData = {
            type: field.type,
            props: {
                id: field.id,
                name: field.name,
                label: field.label,
                required: field.required || false,
                placeholder: field.placeholder || '',
                helpText: field.helpText || ''
            }
        };
        
        // Add type-specific properties
        switch (field.type) {
            case 'textarea':
                componentData.props.rows = field.rows || 3;
                break;
                
            case 'number':
                componentData.props.min = field.min;
                componentData.props.max = field.max;
                componentData.props.step = field.step;
                break;
                
            case 'select':
            case 'checkbox':
            case 'radio':
                componentData.props.options = field.options || [];
                break;
                
            case 'email':
                componentData.props.type = 'email';
                break;
                
            case 'tel':
            case 'phone':
                componentData.props.type = 'tel';
                break;
                
            case 'date':
                componentData.props.type = 'date';
                break;
                
            case 'time':
                componentData.props.type = 'time';
                break;
        }
        
        // Add validation properties
        if (field.validation) {
            if (field.validation.minLength) componentData.props.minLength = field.validation.minLength;
            if (field.validation.maxLength) componentData.props.maxLength = field.validation.maxLength;
            if (field.validation.pattern) componentData.props.pattern = field.validation.pattern;
        }
        
        return componentData;
    }
    
    /**
     * Convert form builder component back to database field format
     */
    convertComponentToField(component, index) {
        const field = {
            id: component.props?.id || `field_${index + 1}`,
            type: component.type,
            name: component.props?.name || `field_${index + 1}`,
            label: component.props?.label || '',
            required: component.props?.required || false
        };
        
        // Add optional properties if they exist
        if (component.props?.placeholder) field.placeholder = component.props.placeholder;
        if (component.props?.helpText) field.helpText = component.props.helpText;
        
        // Add type-specific properties
        switch (component.type) {
            case 'textarea':
                if (component.props?.rows) field.rows = component.props.rows;
                break;
                
            case 'number':
                if (component.props?.min !== undefined) field.min = component.props.min;
                if (component.props?.max !== undefined) field.max = component.props.max;
                if (component.props?.step !== undefined) field.step = component.props.step;
                break;
                
            case 'select':
            case 'checkbox':
            case 'radio':
                if (component.props?.options) field.options = component.props.options;
                break;
        }
        
        // Add validation properties
        const validation = {};
        if (component.props?.minLength !== undefined) validation.minLength = component.props.minLength;
        if (component.props?.maxLength !== undefined) validation.maxLength = component.props.maxLength;
        if (component.props?.pattern) validation.pattern = component.props.pattern;
        
        if (Object.keys(validation).length > 0) {
            field.validation = validation;
        }
        
        return field;
    }
    
    /**
     * Update form title and description from template
     */
    updateFormTitleAndDescription(template) {
        try {
            const selectedTemplate = document.querySelector('#formTemplatesList .active');
            const formId = selectedTemplate?.dataset.formId;
            
            let templateTitle = '';
            let templateDescription = '';
            
            if (template && template.description) {
                templateDescription = template.description;
            }
            
            // Get title from the sidebar template (which has clean titles already)
            if (selectedTemplate) {
                const titleElement = selectedTemplate.querySelector('.form-template-title');
                templateTitle = titleElement ? titleElement.textContent.trim() : '';
            }
            
            // If no title from sidebar, try to derive it from formId
            if (!templateTitle && formId) {
                switch (formId) {
                    case 'experience':
                        templateTitle = 'Experiencias';
                        break;
                    case 'tour':
                        templateTitle = 'Tours';
                        break;
                    case 'reservation':
                        templateTitle = 'Reservaciones';
                        break;
                    default:
                        templateTitle = formId.charAt(0).toUpperCase() + formId.slice(1);
                }
            }
            
            // Update form title input
            const formTitleInput = document.getElementById('formTitle');
            if (formTitleInput) {
                formTitleInput.value = templateTitle || 'Sin título';
            }
            
            // Update form description input
            const formDescriptionInput = document.getElementById('formDescription');
            if (formDescriptionInput) {
                formDescriptionInput.value = templateDescription || '';
            }
            
            console.log('Updated form title:', templateTitle);
            console.log('Updated form description:', templateDescription);
            
        } catch (error) {
            console.error('Error updating form title and description:', error);
        }
    }

    /**
     * Get authentication token
     * @returns {string|null} Auth token
     */
    getAuthToken() {
        // First try localStorage with correct key name
        const tokenFromStorage = localStorage.getItem('accessToken');
        if (tokenFromStorage) {
            return tokenFromStorage;
        }
        
        // Try cookies as fallback
        const accessTokenCookie = this.getCookie('accessToken');
        if (accessTokenCookie) {
            return accessTokenCookie;
        }
        
        // Try JWT cookie (some implementations use this name)
        const jwtCookie = this.getCookie('jwt');
        if (jwtCookie) {
            return jwtCookie;
        }
        
        // No token found
        console.warn('No authentication token found');
        return null;
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
     * Show notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (success, error, info)
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
        notification.style.zIndex = '9999';
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    /**
     * Mark form as saved
     */
    markAsSaved() {
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            const originalHtml = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="ti ti-check"></i> Guardado';
            saveBtn.classList.add('btn-success');
            saveBtn.classList.remove('btn-primary');
            
            // Restore after 3 seconds
            setTimeout(() => {
                saveBtn.innerHTML = originalHtml;
                saveBtn.classList.remove('btn-success');
                saveBtn.classList.add('btn-primary');
            }, 3000);
        }
    }

}

// Initialize Form Builder when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize on form builder page
    if (document.getElementById('formCanvas')) {
        window.FormBuilder = FormBuilder;
        window.formBuilder = new FormBuilder();
        window.formBuilder.init();
    }
});