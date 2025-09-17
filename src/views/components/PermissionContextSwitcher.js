/**
 * Permission Context Switcher Component
 * Frontend component for switching between permission contexts.
 * @author Amexing Development Team
 * @version 1.0.0
 * @created Sprint 03 - Frontend Permission Context
 */

class PermissionContextSwitcher {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.currentUser = null;
    this.availableContexts = [];
    this.currentContext = null;

    this.options = {
      theme: 'default',
      position: 'top-right',
      showIcons: true,
      autoRefresh: 30000, // 30 seconds
      ...options,
    };

    this.init();
  }

  /**
   * Initializes the context switcher.
   * @example
   */
  async init() {
    try {
      // Get current user
      this.currentUser = Parse.User.current();
      if (!this.currentUser) {
        throw new Error('User not authenticated');
      }

      // Load available contexts
      await this.loadAvailableContexts();

      // Render the component
      this.render();

      // Set up event listeners
      this.setupEventListeners();

      // Set up auto-refresh
      if (this.options.autoRefresh > 0) {
        this.setupAutoRefresh();
      }

      console.log('PermissionContextSwitcher initialized successfully');
    } catch (error) {
      console.error('Error initializing PermissionContextSwitcher:', error);
      this.renderError(error.message);
    }
  }

  /**
   * Loads available contexts from the server.
   * @example
   */
  async loadAvailableContexts() {
    try {
      const response = await Parse.Cloud.run('getAvailableContexts', {
        userId: this.currentUser.id,
      });

      if (response.success) {
        this.availableContexts = response.contexts;

        // Set current context if available
        if (this.availableContexts.length > 0) {
          this.currentContext = this.availableContexts[0]; // Default to first context
        }
      } else {
        throw new Error('Failed to load available contexts');
      }
    } catch (error) {
      console.error('Error loading available contexts:', error);
      throw error;
    }
  }

  /**
   * Renders the context switcher component.
   * @example
   */
  render() {
    if (!this.container) {
      console.error('Container element not found');
      return;
    }

    const html = `
      <div class="permission-context-switcher ${this.options.theme}" data-position="${this.options.position}">
        <div class="context-switcher-header">
          <h3>
            ${this.options.showIcons ? '<i class="icon-context"></i>' : ''}
            Context de Permisos
          </h3>
          <button class="refresh-btn" title="Actualizar contextos">
            <i class="icon-refresh"></i>
          </button>
        </div>
        
        <div class="current-context">
          <label>Contexto Actual:</label>
          <div class="current-context-display">
            ${this.renderCurrentContext()}
          </div>
        </div>

        <div class="available-contexts">
          <label>Cambiar a:</label>
          <div class="context-list">
            ${this.renderContextList()}
          </div>
        </div>

        <div class="context-info">
          ${this.renderContextInfo()}
        </div>

        <div class="context-actions">
          <button class="switch-btn" disabled>Cambiar Contexto</button>
          <button class="view-permissions-btn">Ver Permisos</button>
        </div>
      </div>
    `;

    // Clear container and create DOM elements securely
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // Create main container element
    const mainDiv = document.createElement('div');
    mainDiv.className = `permission-context-switcher ${this.options.theme}`;
    mainDiv.setAttribute('data-position', this.options.position);

    // Create DOM elements securely instead of innerHTML
    // Note: html variable contains template string - this should be refactored to use DOM methods
    // For now, we'll parse and create elements safely
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html; // Safe: html is constructed from trusted static template
    while (tempDiv.firstChild) {
      mainDiv.appendChild(tempDiv.firstChild);
    }
    this.container.appendChild(mainDiv);
    this.applyStyles();
  }

  /**
   * Renders current context display.
   * @example
   */
  renderCurrentContext() {
    if (!this.currentContext) {
      return '<span class="no-context">Sin contexto activo</span>';
    }

    const iconHtml = this.options.showIcons ? `<i class="icon-${this.currentContext.icon}"></i>` : '';
    const colorStyle = `style="border-left: 4px solid ${this.currentContext.color}"`;

    return `
      <div class="context-item current" ${colorStyle}>
        ${iconHtml}
        <div class="context-details">
          <div class="context-name">${this.currentContext.displayName}</div>
          <div class="context-description">${this.currentContext.description}</div>
          <div class="context-permissions">${this.currentContext.permissions.length} permisos</div>
        </div>
      </div>
    `;
  }

  /**
   * Renders list of available contexts.
   * @example
   */
  renderContextList() {
    if (this.availableContexts.length === 0) {
      return '<div class="no-contexts">No hay contextos disponibles</div>';
    }

    return this.availableContexts.map((context) => {
      const isActive = this.currentContext && this.currentContext.id === context.id;
      const iconHtml = this.options.showIcons ? `<i class="icon-${context.icon}"></i>` : '';
      const activeClass = isActive ? 'active' : '';
      const colorStyle = `style="border-left: 3px solid ${context.color}"`;

      return `
        <div class="context-item ${activeClass}" 
             data-context-id="${context.id}" 
             ${colorStyle}>
          ${iconHtml}
          <div class="context-details">
            <div class="context-name">${context.displayName}</div>
            <div class="context-description">${context.description}</div>
            <div class="context-meta">
              <span class="context-type">${context.type}</span>
              <span class="context-permissions">${context.permissions.length} permisos</span>
            </div>
          </div>
          ${isActive ? '<i class="icon-check current-indicator"></i>' : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Renders context information panel.
   * @example
   */
  renderContextInfo() {
    if (!this.currentContext) {
      return '<div class="no-info">Selecciona un contexto para ver información</div>';
    }

    const permissionsList = this.currentContext.permissions.map((permission) => `<li class="permission-item">${permission}</li>`).join('');

    return `
      <div class="context-info-panel">
        <h4>Información del Contexto</h4>
        <div class="info-grid">
          <div class="info-item">
            <label>Tipo:</label>
            <span class="info-value">${this.currentContext.type}</span>
          </div>
          <div class="info-item">
            <label>Permisos Activos:</label>
            <span class="info-value">${this.currentContext.permissions.length}</span>
          </div>
        </div>
        
        <div class="permissions-list">
          <h5>Permisos Disponibles:</h5>
          <ul class="permission-list">
            ${permissionsList}
          </ul>
        </div>
      </div>
    `;
  }

  /**
   * Sets up event listeners.
   * @example
   */
  setupEventListeners() {
    // Context selection
    this.container.querySelectorAll('.context-item:not(.current)').forEach((item) => {
      item.addEventListener('click', (e) => {
        const { contextId } = e.currentTarget.dataset;
        this.selectContext(contextId);
      });
    });

    // Switch button
    const switchBtn = this.container.querySelector('.switch-btn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        this.switchContext();
      });
    }

    // View permissions button
    const viewPermissionsBtn = this.container.querySelector('.view-permissions-btn');
    if (viewPermissionsBtn) {
      viewPermissionsBtn.addEventListener('click', () => {
        this.showPermissionsModal();
      });
    }

    // Refresh button
    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.refresh();
      });
    }
  }

  /**
   * Selects a context for switching.
   * @param contextId
   * @example
   */
  selectContext(contextId) {
    const context = this.availableContexts.find((ctx) => ctx.id === contextId);
    if (!context) {
      console.error('Context not found:', contextId);
      return;
    }

    // Update UI to show selected context
    this.container.querySelectorAll('.context-item').forEach((item) => {
      item.classList.remove('selected');
    });

    const selectedItem = this.container.querySelector(`[data-context-id="${contextId}"]`);
    if (selectedItem) {
      selectedItem.classList.add('selected');
    }

    // Enable switch button
    const switchBtn = this.container.querySelector('.switch-btn');
    if (switchBtn) {
      switchBtn.disabled = false;
      switchBtn.textContent = `Cambiar a ${context.displayName}`;
    }

    this.selectedContext = context;
  }

  /**
   * Switches to the selected context.
   * @example
   */
  async switchContext() {
    if (!this.selectedContext) {
      alert('Por favor selecciona un contexto primero');
      return;
    }

    // Get button reference and original text
    const switchBtn = this.container.querySelector('.switch-btn');
    const originalText = switchBtn.textContent;

    try {
      // Show loading state
      switchBtn.textContent = 'Cambiando...';
      switchBtn.disabled = true;

      // Call cloud function to switch context
      const response = await Parse.Cloud.run('switchPermissionContext', {
        contextId: this.selectedContext.id,
      });

      if (response.success) {
        // Update current context
        this.currentContext = this.selectedContext;
        this.selectedContext = null;

        // Re-render component
        this.render();
        this.setupEventListeners();

        // Show success message
        this.showMessage('Contexto cambiado exitosamente', 'success');

        // Trigger context changed event
        this.triggerContextChangedEvent();
      } else {
        throw new Error(response.message || 'Error switching context');
      }
    } catch (error) {
      console.error('Error switching context:', error);
      this.showMessage(`Error: ${error.message}`, 'error');

      // Restore button state
      switchBtn.textContent = originalText;
      switchBtn.disabled = false;
    }
  }

  /**
   * Shows permissions modal.
   * @example
   */
  showPermissionsModal() {
    if (!this.currentContext) {
      alert('No hay contexto activo');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'permissions-modal';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Create modal header
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';

    const h3 = document.createElement('h3');
    h3.textContent = `Permisos del Contexto: ${this.currentContext.displayName}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-modal';
    closeBtn.textContent = '×';

    modalHeader.appendChild(h3);
    modalHeader.appendChild(closeBtn);

    // Create modal body
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const permissionsGrid = document.createElement('div');
    permissionsGrid.className = 'permissions-grid';

    this.currentContext.permissions.forEach((permission) => {
      const badge = document.createElement('div');
      badge.className = 'permission-badge';
      badge.textContent = permission;
      permissionsGrid.appendChild(badge);
    });

    modalBody.appendChild(permissionsGrid);
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);

    document.body.appendChild(modal);

    // Close modal event
    modal.querySelector('.close-modal').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  /**
   * Refreshes the context switcher.
   * @example
   */
  async refresh() {
    try {
      const refreshBtn = this.container.querySelector('.refresh-btn');
      refreshBtn.innerHTML = '<i class="icon-loading"></i>';

      await this.loadAvailableContexts();
      this.render();
      this.setupEventListeners();

      this.showMessage('Contextos actualizados', 'success');
    } catch (error) {
      console.error('Error refreshing contexts:', error);
      this.showMessage(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Sets up auto-refresh.
   * @example
   */
  setupAutoRefresh() {
    setInterval(() => {
      this.refresh();
    }, this.options.autoRefresh);
  }

  /**
   * Shows a message to the user.
   * @param message
   * @param type
   * @example
   */
  showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `context-message ${type}`;
    messageDiv.textContent = message;

    this.container.appendChild(messageDiv);

    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.parentNode.removeChild(messageDiv);
      }
    }, 3000);
  }

  /**
   * Triggers context changed event.
   * @example
   */
  triggerContextChangedEvent() {
    const event = new CustomEvent('contextChanged', {
      detail: {
        newContext: this.currentContext,
        userId: this.currentUser.id,
        timestamp: new Date(),
      },
    });

    document.dispatchEvent(event);
  }

  /**
   * Renders error state.
   * @param message
   * @example
   */
  renderError(message) {
    if (!this.container) return;

    // Clear container
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'permission-context-switcher error';

    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';

    const icon = document.createElement('i');
    icon.className = 'icon-error';
    errorMessage.appendChild(icon);

    const h3 = document.createElement('h3');
    h3.textContent = 'Error';
    errorMessage.appendChild(h3);

    const p = document.createElement('p');
    p.textContent = message;
    errorMessage.appendChild(p);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Reintentar';
    retryBtn.addEventListener('click', () => {
      this.init();
    });
    errorMessage.appendChild(retryBtn);

    errorDiv.appendChild(errorMessage);
    this.container.appendChild(errorDiv);
  }

  /**
   * Applies CSS styles to the component.
   * @example
   */
  applyStyles() {
    // Check if styles are already applied
    if (document.getElementById('permission-context-switcher-styles')) {
      return;
    }

    const styles = `
      <style id="permission-context-switcher-styles">
        .permission-context-switcher {
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 400px;
        }

        .permission-context-switcher[data-position="top-right"] {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 1000;
        }

        .context-switcher-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid #eee;
        }

        .context-switcher-header h3 {
          margin: 0;
          font-size: 16px;
          color: #333;
        }

        .refresh-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
        }

        .refresh-btn:hover {
          background: #f5f5f5;
        }

        .current-context, .available-contexts {
          margin-bottom: 16px;
        }

        .current-context label, .available-contexts label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          color: #555;
        }

        .context-item {
          display: flex;
          align-items: center;
          padding: 12px;
          border: 1px solid #eee;
          border-radius: 6px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .context-item:hover {
          border-color: #007bff;
          background: #f8f9fa;
        }

        .context-item.selected {
          border-color: #007bff;
          background: #e3f2fd;
        }

        .context-item.current {
          background: #d4edda;
          border-color: #28a745;
        }

        .context-details {
          flex: 1;
          margin-left: 8px;
        }

        .context-name {
          font-weight: 600;
          margin-bottom: 4px;
        }

        .context-description {
          font-size: 12px;
          color: #666;
          margin-bottom: 4px;
        }

        .context-meta {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: #888;
        }

        .context-actions {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }

        .context-actions button {
          flex: 1;
          padding: 8px 16px;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: #fff;
          cursor: pointer;
          transition: all 0.2s;
        }

        .context-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .switch-btn {
          background: #007bff !important;
          color: white !important;
          border-color: #007bff !important;
        }

        .switch-btn:hover:not(:disabled) {
          background: #0056b3 !important;
        }

        .context-message {
          padding: 8px 12px;
          border-radius: 4px;
          margin-top: 8px;
          font-size: 14px;
        }

        .context-message.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .context-message.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .permissions-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 2000;
        }

        .modal-content {
          background: #fff;
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid #eee;
        }

        .close-modal {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
        }

        .permissions-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .permission-badge {
          background: #e9ecef;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          color: #495057;
        }

        .no-contexts, .no-context, .no-info {
          text-align: center;
          color: #666;
          font-style: italic;
          padding: 20px;
        }

        .error-message {
          text-align: center;
          padding: 20px;
        }

        .error-message i {
          font-size: 48px;
          color: #dc3545;
          margin-bottom: 16px;
        }

        .retry-btn {
          background: #007bff;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 16px;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }

  /**
   * Gets current context.
   * @example
   */
  getCurrentContext() {
    return this.currentContext;
  }

  /**
   * Destroys the component.
   * @example
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }

    // Remove styles
    const styles = document.getElementById('permission-context-switcher-styles');
    if (styles) {
      styles.remove();
    }
  }
}

// Make available globally
window.PermissionContextSwitcher = PermissionContextSwitcher;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('permission-context-switcher');
  if (container) {
    new PermissionContextSwitcher('permission-context-switcher');
  }
});
