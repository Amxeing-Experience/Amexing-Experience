/**
 * OAuth Provider Component - Sprint 04
 * Main OAuth orchestration component for landing pages
 * Implements Component-Based OAuth Architecture.
 */

class OAuthProvider {
  constructor(options = {}) {
    this.config = {
      corporateMode: options.corporateMode || false,
      corporateConfig: options.corporateConfig || null,
      departmentRequired: options.departmentRequired || false,
      allowedProviders: options.allowedProviders || ['google', 'microsoft', 'apple'],
      redirectUri: options.redirectUri || '/auth/oauth/callback',
      mobile: options.mobile || this.detectMobile(),
      theme: options.theme || 'default',
      ...options,
    };

    this.initialized = false;
    this.currentUser = null;
    this.selectedDepartment = null;
    this.auditService = null;

    this.init();
  }

  /**
   * Initialize OAuth Provider.
   * @example
   */
  async init() {
    if (this.initialized) return;

    try {
      // Initialize audit service for PCI compliance
      if (window.PermissionAuditService) {
        this.auditService = new window.PermissionAuditService();
      }

      // Load OAuth configuration from server
      await this.loadOAuthConfig();

      // Initialize provider-specific configurations
      await this.initializeProviders();

      // Set up event listeners
      this.setupEventListeners();

      // Initialize UI components
      this.initializeUI();

      this.initialized = true;
      this.logAuditEvent('oauth_provider_initialized');
    } catch (error) {
      console.error('Failed to initialize OAuth Provider:', error);
      this.handleInitializationError(error);
    }
  }

  /**
   * Load OAuth configuration from server.
   * @example
   */
  async loadOAuthConfig() {
    const response = await fetch('/api/oauth/config', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load OAuth config: ${response.status}`);
    }

    const config = await response.json();
    this.serverConfig = config;

    // Update client config with server settings
    if (config.corporateConfig && this.config.corporateMode) {
      this.config.corporateConfig = config.corporateConfig;
    }
  }

  /**
   * Initialize provider-specific configurations.
   * @example
   */
  async initializeProviders() {
    const providers = this.config.allowedProviders;
    this.providerConfigs = {};

    for (const provider of providers) {
      if (this.serverConfig.providers[provider]) {
        this.providerConfigs[provider] = {
          ...this.serverConfig.providers[provider],
          initialized: false,
        };
      }
    }

    // Initialize Apple Sign In if available
    if (this.providerConfigs.apple) {
      await this.initializeAppleSignIn();
    }

    // Initialize Google OAuth if available
    if (this.providerConfigs.google && window.google) {
      await this.initializeGoogleOAuth();
    }

    // Initialize Microsoft OAuth if available
    if (this.providerConfigs.microsoft && window.Msal) {
      await this.initializeMicrosoftOAuth();
    }
  }

  /**
   * Initialize Apple Sign In.
   * @example
   */
  async initializeAppleSignIn() {
    try {
      // Initialize Apple Sign In Button component
      if (window.AppleSignInButton) {
        this.appleSignIn = new window.AppleSignInButton({
          clientId: this.providerConfigs.apple.clientId,
          department: this.selectedDepartment,
          corporateConfigId: this.config.corporateConfig?.id,
          onSuccess: this.handleAppleSuccess.bind(this),
          onError: this.handleAppleError.bind(this),
          onCancel: this.handleAppleCancel.bind(this),
        });

        this.providerConfigs.apple.initialized = true;
        this.providerConfigs.apple.component = this.appleSignIn;
        this.logAuditEvent('apple_oauth_initialized');
      } else if (window.AppleID) {
        // Fallback initialization for legacy Apple ID SDK
        await window.AppleID.auth.init({
          clientId: this.providerConfigs.apple.clientId,
          scope: 'name email',
          redirectURI: this.config.redirectUri,
          state: this.generateState(),
          nonce: this.generateNonce(),
          usePopup: true,
        });

        this.providerConfigs.apple.initialized = true;
        this.logAuditEvent('apple_oauth_initialized');
      } else {
        throw new Error('Apple Sign In not available');
      }
    } catch (error) {
      console.error('Apple Sign In initialization failed:', error);
      this.providerConfigs.apple.error = error.message;
    }
  }

  /**
   * Initialize Google OAuth.
   * @example
   */
  async initializeGoogleOAuth() {
    try {
      await window.google.accounts.id.initialize({
        client_id: this.providerConfigs.google.clientId,
        callback: this.handleGoogleResponse.bind(this),
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      this.providerConfigs.google.initialized = true;
      this.logAuditEvent('google_oauth_initialized');
    } catch (error) {
      console.error('Google OAuth initialization failed:', error);
      this.providerConfigs.google.error = error.message;
    }
  }

  /**
   * Initialize Microsoft OAuth.
   * @example
   */
  async initializeMicrosoftOAuth() {
    try {
      const msalConfig = {
        auth: {
          clientId: this.providerConfigs.microsoft.clientId,
          authority: this.providerConfigs.microsoft.authority || 'https://login.microsoftonline.com/common',
          redirectUri: this.config.redirectUri,
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      };

      this.msalInstance = new window.Msal.PublicClientApplication(msalConfig);
      await this.msalInstance.initialize();

      this.providerConfigs.microsoft.initialized = true;
      this.logAuditEvent('microsoft_oauth_initialized');
    } catch (error) {
      console.error('Microsoft OAuth initialization failed:', error);
      this.providerConfigs.microsoft.error = error.message;
    }
  }

  /**
   * Setup event listeners.
   * @example
   */
  setupEventListeners() {
    // Listen for OAuth callback messages
    window.addEventListener('message', this.handleOAuthMessage.bind(this));

    // Listen for page unload to clean up
    window.addEventListener('beforeunload', this.cleanup.bind(this));

    // Listen for department selection changes
    document.addEventListener('departmentChanged', this.handleDepartmentChange.bind(this));
  }

  /**
   * Initialize UI components.
   * @example
   */
  initializeUI() {
    const container = document.getElementById('oauth-container');
    if (!container) return;

    // Create OAuth UI based on configuration
    const ui = this.createOAuthUI();
    container.appendChild(ui);

    // Apply theme
    this.applyTheme();

    // Initialize provider selection if multiple providers
    if (this.config.allowedProviders.length > 1) {
      this.initializeProviderSelection();
    }

    // Initialize department selection if required
    if (this.config.departmentRequired) {
      this.initializeDepartmentSelection();
    }
  }

  /**
   * Create OAuth UI elements.
   * @example
   */
  createOAuthUI() {
    const container = document.createElement('div');
    container.className = `oauth-provider-container ${this.config.mobile ? 'mobile' : 'desktop'}`;

    // Create provider buttons
    this.config.allowedProviders.forEach((provider) => {
      if (this.providerConfigs[provider] && this.providerConfigs[provider].initialized) {
        const button = this.createProviderButton(provider);
        container.appendChild(button);
      }
    });

    // Create department selection if needed
    if (this.config.departmentRequired) {
      const departmentSelector = this.createDepartmentSelector();
      container.insertBefore(departmentSelector, container.firstChild);
    }

    // Create corporate branding if in corporate mode
    if (this.config.corporateMode && this.config.corporateConfig) {
      const branding = this.createCorporateBranding();
      container.insertBefore(branding, container.firstChild);
    }

    return container;
  }

  /**
   * Create provider-specific OAuth button.
   * @param provider
   * @example
   */
  createProviderButton(provider) {
    const button = document.createElement('button');
    button.className = `oauth-btn oauth-${provider}`;
    button.textContent = `Sign in with ${this.getProviderDisplayName(provider)}`;
    button.onclick = () => this.authenticateWithProvider(provider);

    // Apply provider-specific styling
    this.applyProviderStyling(button, provider);

    // Add accessibility attributes
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', `Sign in with ${this.getProviderDisplayName(provider)}`);

    return button;
  }

  /**
   * Create department selector.
   * @example
   */
  createDepartmentSelector() {
    const container = document.createElement('div');
    container.className = 'department-selector';

    const label = document.createElement('label');
    label.textContent = 'Select your department:';
    label.htmlFor = 'department-select';

    const select = document.createElement('select');
    select.id = 'department-select';
    select.name = 'department';
    select.required = true;

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Choose department...';
    select.appendChild(defaultOption);

    // Add department options from corporate config
    if (this.config.corporateConfig && this.config.corporateConfig.departments) {
      Object.entries(this.config.corporateConfig.departments).forEach(([key, dept]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = dept.displayName || key;
        select.appendChild(option);
      });
    }

    select.addEventListener('change', (e) => {
      this.selectedDepartment = e.target.value;
      this.updateProviderAvailability();
    });

    container.appendChild(label);
    container.appendChild(select);

    return container;
  }

  /**
   * Create corporate branding elements.
   * @example
   */
  createCorporateBranding() {
    const branding = document.createElement('div');
    branding.className = 'corporate-branding';

    const config = this.config.corporateConfig;

    if (config.logo) {
      const logo = document.createElement('img');
      logo.src = config.logo;
      logo.alt = `${config.name} Logo`;
      logo.className = 'corporate-logo';
      branding.appendChild(logo);
    }

    if (config.welcomeMessage) {
      const message = document.createElement('p');
      message.textContent = config.welcomeMessage;
      message.className = 'welcome-message';
      branding.appendChild(message);
    }

    return branding;
  }

  /**
   * Authenticate with specific OAuth provider.
   * @param provider
   * @example
   */
  async authenticateWithProvider(provider) {
    try {
      this.logAuditEvent('oauth_authentication_started', { provider });

      // Validate department selection if required
      if (this.config.departmentRequired && !this.selectedDepartment) {
        throw new Error('Please select your department before signing in');
      }

      switch (provider) {
        case 'apple':
          await this.authenticateWithApple();
          break;
        case 'google':
          await this.authenticateWithGoogle();
          break;
        case 'microsoft':
          await this.authenticateWithMicrosoft();
          break;
        default:
          throw new Error(`Unsupported OAuth provider: ${provider}`);
      }
    } catch (error) {
      console.error('OAuth authentication failed with provider:', provider, error);
      this.handleAuthenticationError(error, provider);
    }
  }

  /**
   * Authenticate with Apple.
   * @example
   */
  async authenticateWithApple() {
    const response = await window.AppleID.auth.signIn();
    await this.handleOAuthSuccess('apple', response);
  }

  /**
   * Authenticate with Google.
   * @example
   */
  async authenticateWithGoogle() {
    window.google.accounts.id.prompt();
  }

  /**
   * Handle Google OAuth response.
   * @param response
   * @example
   */
  async handleGoogleResponse(response) {
    await this.handleOAuthSuccess('google', response);
  }

  /**
   * Authenticate with Microsoft.
   * @example
   */
  async authenticateWithMicrosoft() {
    const loginRequest = {
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account',
    };

    const response = await this.msalInstance.loginPopup(loginRequest);
    await this.handleOAuthSuccess('microsoft', response);
  }

  /**
   * Handle successful OAuth authentication.
   * @param provider
   * @param response
   * @example
   */
  async handleOAuthSuccess(provider, response) {
    try {
      // Send OAuth response to server for validation and user creation
      const serverResponse = await fetch('/api/oauth/authenticate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          provider,
          response,
          department: this.selectedDepartment,
          corporateMode: this.config.corporateMode,
          corporateConfigId: this.config.corporateConfig?.id,
        }),
      });

      if (!serverResponse.ok) {
        throw new Error(`Server authentication failed: ${serverResponse.status}`);
      }

      const result = await serverResponse.json();

      // Handle department context switching if applicable
      if (result.contextSwitchRequired && window.PermissionContextService) {
        await this.handleContextSwitch(result.user, this.selectedDepartment);
      }

      this.logAuditEvent('oauth_authentication_success', {
        provider,
        userId: result.user.id,
        department: this.selectedDepartment,
      });

      // Redirect to appropriate page
      this.handleAuthenticationRedirect(result);
    } catch (error) {
      console.error('OAuth success handling failed:', error);
      this.handleAuthenticationError(error, provider);
    }
  }

  /**
   * Handle context switching after OAuth authentication.
   * @param user
   * @param department
   * @example
   */
  async handleContextSwitch(user, department) {
    if (!window.PermissionContextService || !department) return;

    try {
      const contextService = new window.PermissionContextService();
      await contextService.switchToContext(
        user.id,
        `dept-${department}`,
        user.sessionId
      );
    } catch (error) {
      console.warn('Context switching failed:', error);
    }
  }

  /**
   * Handle Apple Sign In success.
   * @param data
   * @example
   */
  handleAppleSuccess(data) {
    console.log('Apple OAuth success:', data);
    this.logAuditEvent('apple_oauth_success', {
      provider: 'apple',
      userId: data.user?.id,
      privacyCompliant: true,
    });

    // Handle authentication redirect
    this.handleAuthenticationRedirect(data);
  }

  /**
   * Handle Apple Sign In error.
   * @param error
   * @example
   */
  handleAppleError(error) {
    console.error('Apple OAuth error:', error);
    this.handleAuthenticationError(error, 'apple');
  }

  /**
   * Handle Apple Sign In cancellation.
   * @example
   */
  handleAppleCancel() {
    console.log('Apple OAuth cancelled by user');
    this.logAuditEvent('apple_oauth_cancelled', { provider: 'apple' });
  }

  /**
   * Handle authentication redirect.
   * @param result
   * @example
   */
  handleAuthenticationRedirect(result) {
    const redirectUrl = result.redirectUrl
                       || this.config.successRedirect
                       || '/dashboard';

    window.location.href = redirectUrl;
  }

  /**
   * Handle authentication errors.
   * @param error
   * @param provider
   * @example
   */
  handleAuthenticationError(error, provider) {
    this.logAuditEvent('oauth_authentication_error', {
      provider,
      error: error.message,
    });

    // Show user-friendly error message
    this.showErrorMessage(error.message);

    // Re-enable authentication buttons
    this.enableAuthenticationButtons();
  }

  /**
   * Show error message to user.
   * @param message
   * @example
   */
  showErrorMessage(message) {
    const container = document.getElementById('oauth-container');
    if (!container) return;

    // Remove existing error messages
    const existingErrors = container.querySelectorAll('.oauth-error');
    existingErrors.forEach((error) => error.remove());

    // Create new error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'oauth-error alert alert-error';
    errorDiv.textContent = message;

    container.insertBefore(errorDiv, container.firstChild);

    // Auto-hide error after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 5000);
  }

  /**
   * Enable authentication buttons.
   * @example
   */
  enableAuthenticationButtons() {
    const buttons = document.querySelectorAll('.oauth-btn');
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = button.textContent.replace('Signing in...', 'Sign in');
    });
  }

  /**
   * Log audit events for PCI compliance.
   * @param action
   * @param metadata
   * @example
   */
  logAuditEvent(action, metadata = {}) {
    if (!this.auditService) return;

    this.auditService.recordPermissionAudit({
      userId: this.currentUser?.id || 'anonymous',
      action,
      resource: 'oauth_authentication',
      performedBy: 'oauth_provider_component',
      timestamp: new Date(),
      metadata: {
        component: 'OAuthProvider',
        mobile: this.config.mobile,
        corporateMode: this.config.corporateMode,
        ...metadata,
      },
    });
  }

  /**
   * Utility methods.
   * @example
   */
  detectMobile() {
    return window.innerWidth <= 768
      || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  generateState() {
    return btoa(Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
  }

  generateNonce() {
    return btoa(Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
  }

  getProviderDisplayName(provider) {
    const displayNames = {
      google: 'Google',
      microsoft: 'Microsoft',
      apple: 'Apple',
    };
    return displayNames[provider] || provider;
  }

  applyProviderStyling(button, provider) {
    // Provider-specific styling will be handled by CSS
    button.setAttribute('data-provider', provider);
  }

  applyTheme() {
    if (this.config.corporateConfig && this.config.corporateConfig.theme) {
      const { theme } = this.config.corporateConfig;
      const container = document.querySelector('.oauth-provider-container');
      if (container && theme.primaryColor) {
        container.style.setProperty('--primary-color', theme.primaryColor);
      }
    }
  }

  initializeProviderSelection() {
    // Smart provider selection based on email domain
    const emailInput = document.getElementById('identifier');
    if (emailInput) {
      emailInput.addEventListener('blur', this.detectProviderFromEmail.bind(this));
    }
  }

  detectProviderFromEmail(event) {
    const email = event.target.value;
    if (!email.includes('@')) return;

    const domain = email.split('@')[1];
    let suggestedProvider = null;

    // Corporate domain mapping
    if (this.config.corporateConfig && this.config.corporateConfig.domainMappings) {
      suggestedProvider = this.config.corporateConfig.domainMappings[domain];
    }

    // Common domain detection
    if (!suggestedProvider) {
      if (domain.includes('gmail.com') || domain.includes('google.com')) {
        suggestedProvider = 'google';
      } else if (domain.includes('outlook.com') || domain.includes('microsoft.com')) {
        suggestedProvider = 'microsoft';
      } else if (domain.includes('icloud.com') || domain.includes('apple.com')) {
        suggestedProvider = 'apple';
      }
    }

    if (suggestedProvider && this.providerConfigs[suggestedProvider]) {
      this.highlightSuggestedProvider(suggestedProvider);
    }
  }

  highlightSuggestedProvider(provider) {
    // Remove existing highlights
    const buttons = document.querySelectorAll('.oauth-btn');
    buttons.forEach((btn) => btn.classList.remove('suggested'));

    // Highlight suggested provider
    const suggestedButton = document.querySelector(`.oauth-${provider}`);
    if (suggestedButton) {
      suggestedButton.classList.add('suggested');
    }
  }

  initializeDepartmentSelection() {
    this.updateProviderAvailability();
  }

  updateProviderAvailability() {
    if (!this.selectedDepartment || !this.config.corporateConfig) return;

    const departmentConfig = this.config.corporateConfig.departments[this.selectedDepartment];
    if (!departmentConfig || !departmentConfig.allowedProviders) return;

    // Show/hide providers based on department configuration
    const buttons = document.querySelectorAll('.oauth-btn');
    buttons.forEach((button) => {
      const provider = button.getAttribute('data-provider');
      const allowed = departmentConfig.allowedProviders.includes(provider);
      button.style.display = allowed ? 'block' : 'none';
    });
  }

  handleOAuthMessage(event) {
    // Handle OAuth callback messages from popup windows
    if (event.origin !== window.location.origin) return;

    if (event.data.type === 'oauth-callback') {
      this.handleOAuthSuccess(event.data.provider, event.data.response);
    }
  }

  handleDepartmentChange(event) {
    this.selectedDepartment = event.detail.department;
    this.updateProviderAvailability();
  }

  handleInitializationError(error) {
    console.error('OAuth Provider initialization failed:', error);
    this.showErrorMessage('Failed to initialize authentication system. Please refresh the page.');
  }

  cleanup() {
    // Clean up resources before page unload
    if (this.msalInstance) {
      // Microsoft OAuth cleanup if needed
    }

    // Remove event listeners
    window.removeEventListener('message', this.handleOAuthMessage.bind(this));
    document.removeEventListener('departmentChanged', this.handleDepartmentChange.bind(this));
  }
}

// Export for use in browser
window.OAuthProvider = OAuthProvider;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('oauth-container');
  if (container && container.dataset.autoInit !== 'false') {
    const config = container.dataset.config ? JSON.parse(container.dataset.config) : {};
    new OAuthProvider(config);
  }
});
