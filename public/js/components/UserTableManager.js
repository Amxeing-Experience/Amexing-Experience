/**
 * UserTableManager - Optimized User Management Table
 * High-performance AJAX table with caching, debouncing, and error recovery
 */

class UserTableManager {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);

    if (!this.container) {
      throw new Error(`Container element with ID '${containerId}' not found`);
    }

    this.config = {
      apiBaseUrl: options.apiBaseUrl || '/api',
      pageSize: options.pageSize || 25,
      cacheEnabled: options.cacheEnabled !== false,
      cacheTimeout: options.cacheTimeout || 300000, // 5 minutes
      debounceDelay: options.debounceDelay || 300,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };

    this.state = {
      users: [],
      loading: false,
      error: null,
      currentPage: 1,
      totalPages: 1,
      totalCount: 0,
      lastUpdated: null,
      retryCount: 0
    };

    // Cache for storing API responses
    this.cache = new Map();

    // AbortController for canceling requests
    this.abortController = null;

    // Debounce timer
    this.debounceTimer = null;

    this.init();
  }

  init() {
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="user-table-wrapper">
        <!-- Header with actions and info -->
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h5 class="mb-0">Users</h5>
            <small class="text-muted" id="${this.containerId}-info">Loading...</small>
          </div>
          <div class="d-flex align-items-center gap-2">
            <small class="text-muted" id="${this.containerId}-cache-indicator" style="display: none;">
              <i class="ti ti-database text-success"></i> Cached
            </small>
            <button class="btn btn-outline-primary btn-sm" id="${this.containerId}-refresh">
              <i class="ti ti-refresh"></i> Refresh
            </button>
            <button class="btn btn-primary btn-sm" id="${this.containerId}-force-refresh">
              <i class="ti ti-download"></i> Force Reload
            </button>
          </div>
        </div>

        <!-- Loading overlay -->
        <div id="${this.containerId}-loading-overlay" class="position-relative" style="display: none;">
          <div class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-white bg-opacity-75" style="z-index: 10;">
            <div class="text-center">
              <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              <div class="mt-2 small text-muted">Loading users...</div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="table-responsive">
          <table class="table table-hover table-sm">
            <thead class="table-light">
              <tr>
                <th style="width: 250px;">User</th>
                <th style="width: 200px;">Email</th>
                <th style="width: 100px;">Role</th>
                <th style="width: 100px;">Status</th>
                <th style="width: 120px;">Last Login</th>
                <th style="width: 120px;">Created</th>
              </tr>
            </thead>
            <tbody id="${this.containerId}-tbody">
              <!-- Users will be loaded here -->
            </tbody>
          </table>
        </div>

        <!-- Pagination and info -->
        <div class="d-flex justify-content-between align-items-center mt-3">
          <div class="text-muted small">
            <span id="${this.containerId}-results-info">Loading...</span>
          </div>
          <div id="${this.containerId}-pagination">
            <!-- Pagination will be rendered here -->
          </div>
        </div>

        <!-- Error alert -->
        <div id="${this.containerId}-error" class="alert alert-danger alert-dismissible fade show mt-3" style="display: none;">
          <strong>Error!</strong> <span id="${this.containerId}-error-message"></span>
          <button type="button" class="btn-close" onclick="this.clearError()"></button>
        </div>

        <!-- Success alert -->
        <div id="${this.containerId}-success" class="alert alert-success alert-dismissible fade show mt-3" style="display: none;">
          <strong>Success!</strong> <span id="${this.containerId}-success-message"></span>
          <button type="button" class="btn-close" onclick="this.clearSuccess()"></button>
        </div>
      </div>
    `;

    this.bindEventHandlers();
  }

  bindEventHandlers() {
    // Refresh button
    const refreshBtn = document.getElementById(`${this.containerId}-refresh`);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadUsers(false);
      });
    }

    // Force refresh button
    const forceRefreshBtn = document.getElementById(`${this.containerId}-force-refresh`);
    if (forceRefreshBtn) {
      forceRefreshBtn.addEventListener('click', () => {
        this.clearCache();
        this.loadUsers(true);
      });
    }
  }

  bindEvents() {
    // Basic event binding - can be extended later
  }

  async loadUsers(forceRefresh = false) {
    // Cancel any existing request
    if (this.abortController) {
      this.abortController.abort();
    }

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce the request
    return new Promise((resolve, reject) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          await this._performLoadUsers(forceRefresh);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, this.config.debounceDelay);
    });
  }

  async _performLoadUsers(forceRefresh = false) {
    const cacheKey = `users_page_${this.state.currentPage}_size_${this.config.pageSize}`;

    // Check cache first
    if (!forceRefresh && this.config.cacheEnabled && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      const now = Date.now();

      if (now - cached.timestamp < this.config.cacheTimeout) {
        console.log('Loading users from cache');
        this.updateStateFromData(cached.data);
        this.renderUsers();
        this.renderPagination();
        this.updateInfo();
        this.showCacheIndicator();
        return;
      } else {
        // Cache expired
        this.cache.delete(cacheKey);
      }
    }

    this.setLoading(true);
    this.clearError();
    this.hideCacheIndicator();

    // Create new AbortController
    this.abortController = new AbortController();

    try {
      const token = this.getAuthToken();
      if (!token) {
        throw new Error('No authentication token found. Please login again.');
      }

      const params = new URLSearchParams({
        page: this.state.currentPage,
        limit: this.config.pageSize,
        timestamp: Date.now() // Cache busting
      });

      const response = await fetch(`${this.config.apiBaseUrl}/users?${params}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        signal: this.abortController.signal
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed. Please login again.');
        } else if (response.status === 403) {
          throw new Error('Access denied. Insufficient permissions.');
        } else if (response.status >= 500) {
          throw new Error('Server error. Please try again later.');
        } else {
          throw new Error(`Request failed: ${response.status} ${response.statusText}`);
        }
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Invalid response from server');
      }

      if (!result.data) {
        throw new Error('No data received from server');
      }

      // Cache the response
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, {
          data: result.data,
          timestamp: Date.now()
        });
      }

      console.log('API Response:', result);
      console.log('API Response Data:', result.data);

      this.updateStateFromData(result.data);
      this.renderUsers();
      this.renderPagination();
      this.updateInfo();
      this.state.retryCount = 0; // Reset retry count on success
      this.state.lastUpdated = new Date();

      console.log(`Loaded ${this.state.users.length} users (Page ${this.state.currentPage} of ${this.state.totalPages})`);

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }

      console.error('Error loading users:', error);

      // Retry logic
      if (this.state.retryCount < this.config.retryAttempts) {
        this.state.retryCount++;
        console.log(`Retrying... (${this.state.retryCount}/${this.config.retryAttempts})`);

        setTimeout(() => {
          this._performLoadUsers(forceRefresh);
        }, this.config.retryDelay * this.state.retryCount);

        this.showError(`Connection failed. Retrying... (${this.state.retryCount}/${this.config.retryAttempts})`);
      } else {
        this.showError(`Failed to load users: ${error.message}`);
        this.state.retryCount = 0;
      }
    } finally {
      this.setLoading(false);
      this.abortController = null;
    }
  }

  getAuthToken() {
    return localStorage.getItem('authToken') ||
           sessionStorage.getItem('authToken') ||
           this.getCookieValue('authToken');
  }

  getCookieValue(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  updateStateFromData(data) {
    this.state.users = data.users || [];
    this.state.totalCount = data.total || 0;
    this.state.totalPages = Math.ceil(this.state.totalCount / this.config.pageSize);
  }

  renderUsers() {
    const tbody = document.getElementById(`${this.containerId}-tbody`);

    if (!tbody) return;

    if (this.state.users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-4">
            No users found
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.state.users.map(user => this.renderUserRow(user)).join('');
  }

  renderUserRow(user) {
    return `
      <tr>
        <td>
          <div class="d-flex align-items-center">
            <div class="avatar-sm bg-primary text-white rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 32px; height: 32px; font-size: 12px;">
              ${(user.firstName?.charAt(0) || '?')}${(user.lastName?.charAt(0) || '')}
            </div>
            <div>
              <div class="fw-medium">${this.escapeHtml(user.firstName || '')} ${this.escapeHtml(user.lastName || '')}</div>
              <small class="text-muted">${this.escapeHtml(user.username || '')}</small>
            </div>
          </div>
        </td>
        <td>
          <a href="mailto:${this.escapeHtml(user.email || '')}" class="text-decoration-none">
            ${this.escapeHtml(user.email || '')}
          </a>
          ${user.emailVerified ? '<i class="ti ti-shield-check text-success ms-1" title="Email Verified"></i>' : ''}
        </td>
        <td>
          <span class="badge bg-primary">${this.escapeHtml(user.role || 'unknown')}</span>
        </td>
        <td>
          <span class="badge bg-${user.active ? 'success' : 'secondary'}">
            ${user.active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          ${user.lastLoginAt ? this.formatDate(user.lastLoginAt) : '<span class="text-muted">Never</span>'}
        </td>
        <td>
          ${this.formatDate(user.createdAt)}
        </td>
      </tr>
    `;
  }

  renderPagination() {
    const container = document.getElementById(`${this.containerId}-pagination`);
    const infoContainer = document.getElementById(`${this.containerId}-results-info`);

    // Update results info
    if (infoContainer) {
      const start = (this.state.currentPage - 1) * this.config.pageSize + 1;
      const end = Math.min(this.state.currentPage * this.config.pageSize, this.state.totalCount);
      infoContainer.textContent = `Showing ${start}-${end} of ${this.state.totalCount} users`;
    }

    if (!container || this.state.totalPages <= 1) {
      if (container) container.innerHTML = '';
      return;
    }

    const pagination = [];
    const current = this.state.currentPage;
    const total = this.state.totalPages;

    // Create pagination with event listeners instead of inline onclick
    const paginationId = `${this.containerId}-pagination-nav`;

    pagination.push(`<nav aria-label="User table pagination" id="${paginationId}">`);
    pagination.push(`<ul class="pagination pagination-sm mb-0">`);

    // Previous button
    pagination.push(`
      <li class="page-item ${current === 1 ? 'disabled' : ''}">
        <button class="page-link" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>
          <i class="ti ti-chevron-left"></i> Previous
        </button>
      </li>
    `);

    // First page and ellipsis
    if (current > 3) {
      pagination.push(`
        <li class="page-item">
          <button class="page-link" data-page="1">1</button>
        </li>
      `);
      if (current > 4) {
        pagination.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
      }
    }

    // Page numbers around current page
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
      pagination.push(`
        <li class="page-item ${i === current ? 'active' : ''}">
          <button class="page-link" data-page="${i}">${i}</button>
        </li>
      `);
    }

    // Last page and ellipsis
    if (current < total - 2) {
      if (current < total - 3) {
        pagination.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
      }
      pagination.push(`
        <li class="page-item">
          <button class="page-link" data-page="${total}">${total}</button>
        </li>
      `);
    }

    // Next button
    pagination.push(`
      <li class="page-item ${current === total ? 'disabled' : ''}">
        <button class="page-link" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>
          Next <i class="ti ti-chevron-right"></i>
        </button>
      </li>
    `);

    pagination.push(`</ul></nav>`);

    container.innerHTML = pagination.join('');

    // Bind pagination events
    const paginationNav = document.getElementById(paginationId);
    if (paginationNav) {
      paginationNav.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.page) {
          const page = parseInt(e.target.dataset.page);
          if (page && page !== this.state.currentPage) {
            this.changePage(page);
          }
        }
      });
    }
  }

  changePage(page) {
    if (page >= 1 && page <= this.state.totalPages) {
      this.state.currentPage = page;
      this.loadUsers();
    }
  }

  setLoading(loading) {
    this.state.loading = loading;
    const overlay = document.getElementById(`${this.containerId}-loading-overlay`);
    const refreshBtn = document.getElementById(`${this.containerId}-refresh`);
    const forceRefreshBtn = document.getElementById(`${this.containerId}-force-refresh`);

    if (overlay) {
      overlay.style.display = loading ? 'block' : 'none';
    }

    // Disable buttons during loading
    if (refreshBtn) {
      refreshBtn.disabled = loading;
    }
    if (forceRefreshBtn) {
      forceRefreshBtn.disabled = loading;
    }
  }

  showError(message) {
    this.state.error = message;
    const errorDiv = document.getElementById(`${this.containerId}-error`);
    const errorMessage = document.getElementById(`${this.containerId}-error-message`);

    if (errorDiv && errorMessage) {
      errorMessage.textContent = message;
      errorDiv.style.display = 'block';

      // Auto-hide after 10 seconds
      setTimeout(() => {
        this.clearError();
      }, 10000);
    }
  }

  clearError() {
    this.state.error = null;
    const errorDiv = document.getElementById(`${this.containerId}-error`);
    if (errorDiv) {
      errorDiv.style.display = 'none';
    }
  }

  showSuccess(message) {
    const successDiv = document.getElementById(`${this.containerId}-success`);
    const successMessage = document.getElementById(`${this.containerId}-success-message`);

    if (successDiv && successMessage) {
      successMessage.textContent = message;
      successDiv.style.display = 'block';

      // Auto-hide after 5 seconds
      setTimeout(() => {
        this.clearSuccess();
      }, 5000);
    }
  }

  clearSuccess() {
    const successDiv = document.getElementById(`${this.containerId}-success`);
    if (successDiv) {
      successDiv.style.display = 'none';
    }
  }

  showCacheIndicator() {
    const indicator = document.getElementById(`${this.containerId}-cache-indicator`);
    if (indicator) {
      indicator.style.display = 'block';
    }
  }

  hideCacheIndicator() {
    const indicator = document.getElementById(`${this.containerId}-cache-indicator`);
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  clearCache() {
    this.cache.clear();
    console.log('Cache cleared');
  }

  updateInfo() {
    const infoElement = document.getElementById(`${this.containerId}-info`);
    if (infoElement) {
      if (this.state.lastUpdated) {
        const timeAgo = this.getTimeAgo(this.state.lastUpdated);
        infoElement.textContent = `Last updated ${timeAgo}`;
      } else {
        infoElement.textContent = 'Loading...';
      }
    }
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch (error) {
      return 'Invalid Date';
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Public method to refresh the table
  refresh() {
    this.loadUsers(false);
  }

  // Force refresh without cache
  forceRefresh() {
    this.clearCache();
    this.loadUsers(true);
  }

  // Get current state
  getState() {
    return { ...this.state };
  }

  // Get configuration
  getConfig() {
    return { ...this.config };
  }

  // Destroy instance and cleanup
  destroy() {
    // Cancel any pending requests
    if (this.abortController) {
      this.abortController.abort();
    }

    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Clear cache
    this.clearCache();

    // Remove event listeners
    const refreshBtn = document.getElementById(`${this.containerId}-refresh`);
    const forceRefreshBtn = document.getElementById(`${this.containerId}-force-refresh`);

    if (refreshBtn) {
      refreshBtn.removeEventListener('click', this.loadUsers);
    }
    if (forceRefreshBtn) {
      forceRefreshBtn.removeEventListener('click', this.forceRefresh);
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }

    console.log('UserTableManager destroyed');
  }

  // Static method to create and auto-initialize
  static create(containerId, options = {}) {
    return new UserTableManager(containerId, options);
  }
}

// Make it available globally
window.UserTableManager = UserTableManager;