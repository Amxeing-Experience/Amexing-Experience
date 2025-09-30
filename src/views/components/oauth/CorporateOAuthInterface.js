/**
 * Corporate OAuth Interface Component - Sprint 04
 * Handles corporate-specific OAuth flows with branding and customization
 * Integrates with landing page system for corporate clients.
 */

class CorporateOAuthInterface {
  constructor(options = {}) {
    this.config = {
      corporateConfigId: options.corporateConfigId || null,
      corporateConfig: options.corporateConfig || null,
      landingPageMode: options.landingPageMode || false,
      customDomain: options.customDomain || null,
      autoDetectCorporate: options.autoDetectCorporate !== false,
      fallbackToRegular: options.fallbackToRegular !== false,
      ...options,
    };

    this.corporateData = null;
    this.brandingApplied = false;
    this.oauthProvider = null;

    this.init();
  }

  /**
   * Initialize Corporate OAuth Interface.
   * @example
   * // Usage example
   * const result = await init(parameters);
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async init() {
    try {
      // Load corporate configuration
      await this.loadCorporateConfiguration();

      // Auto-detect corporate context if enabled
      if (this.config.autoDetectCorporate) {
        await this.detectCorporateContext();
      }

      // Apply corporate branding
      if (this.corporateData) {
        await this.applyCorporateBranding();
      }

      // Initialize OAuth with corporate settings
      await this.initializeOAuthProvider();

      // Setup corporate-specific event handlers
      this.setupCorporateEventHandlers();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Corporate OAuth Interface initialization failed:', error);
      if (this.config.fallbackToRegular) {
        this.fallbackToRegularOAuth();
      }
    }
  }

  /**
   * Load corporate configuration from server or local config.
   * @example
   * // Usage example
   * const result = await loadCorporateConfiguration(parameters);
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async loadCorporateConfiguration() {
    if (this.config.corporateConfig) {
      this.corporateData = this.config.corporateConfig;
      return;
    }

    if (!this.config.corporateConfigId) {
      return;
    }

    try {
      const response = await fetch(
        `/api/corporate/config/${this.config.corporateConfigId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      if (response.ok) {
        this.corporateData = await response.json();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load corporate configuration:', error);
    }
  }

  /**
   * Auto-detect corporate context from domain, subdomain, or URL parameters.
   * @example
   * // Usage example
   * const result = await detectCorporateContext(parameters);
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async detectCorporateContext() {
    const currentDomain = window.location.hostname;
    const subdomain = currentDomain.split('.')[0];
    const urlParams = new URLSearchParams(window.location.search);
    const corporateParam = urlParams.get('corporate') || urlParams.get('client');

    // Try detection methods in order of priority
    const detectionMethods = [
      () => this.detectFromCustomDomain(currentDomain),
      () => this.detectFromSubdomain(subdomain),
      () => this.detectFromUrlParameter(corporateParam),
      () => this.detectFromLocalStorage(),
      () => this.detectFromReferrer(),
    ];

    for (const method of detectionMethods) {
      try {
        const detected = await method();
        if (detected) {
          this.corporateData = detected;
          break;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Corporate detection method failed:', error);
      }
    }
  }

  /**
   * Detect corporate configuration from custom domain.
   * @param {*} domain - Domain parameter.
   * @param _domain
   * @example
   * // Usage example
   * const result = await detectFromCustomDomain({ domain: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async detectFromCustomDomain(_domain) {
    if (!_domain || _domain === 'localhost') return null;

    try {
      const response = await fetch(
        `/api/corporate/detect/domain/${encodeURIComponent(_domain)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Domain detection failed:', error);
    }

    return null;
  }

  /**
   * Detect corporate configuration from subdomain.
   * @param {*} subdomain - Subdomain parameter.
   * @example
   * // Usage example
   * const result = await detectFromSubdomain({ subdomain: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async detectFromSubdomain(subdomain) {
    if (!subdomain || subdomain === 'www' || subdomain === 'localhost') return null;

    try {
      const response = await fetch(
        `/api/corporate/detect/subdomain/${encodeURIComponent(subdomain)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Subdomain detection failed:', error);
    }

    return null;
  }

  /**
   * Detect corporate configuration from URL parameter.
   * @param {*} param - Param parameter.
   * @example
   * // Usage example
   * const result = await detectFromUrlParameter({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async detectFromUrlParameter(param) {
    if (!param) return null;

    try {
      const response = await fetch(
        `/api/corporate/detect/param/${encodeURIComponent(param)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Parameter detection failed:', error);
    }

    return null;
  }

  /**
   * Detect corporate configuration from local storage (for returning users).
   * @example
   * // Usage example
   * const result = await detectFromLocalStorage({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  detectFromLocalStorage() {
    try {
      const stored = localStorage.getItem('amexing_corporate_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate that stored config is still valid (not expired)
        if (parsed.expiresAt && new Date(parsed.expiresAt) > new Date()) {
          return parsed.config;
        }
        localStorage.removeItem('amexing_corporate_config');
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('LocalStorage detection failed:', error);
    }

    return null;
  }

  /**
   * Detect corporate configuration from referrer URL.
   * @example
   * // Usage example
   * const result = await detectFromReferrer({ param: 'example' });
   * // Returns: operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async detectFromReferrer() {
    const { referrer } = document;
    if (!referrer) return null;

    try {
      const referrerDomain = new URL(referrer).hostname;
      return await this.detectFromCustomDomain(referrerDomain);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Referrer detection failed:', error);
    }

    return null;
  }

  /**
   * Apply corporate branding to the interface.
   * @example
   * // Usage example
   * const result = await applyCorporateBranding({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async applyCorporateBranding() {
    if (!this.corporateData || this.brandingApplied) return;

    try {
      // Apply theme colors
      await this.applyThemeColors();

      // Apply logos and imagery
      await this.applyLogosAndImagery();

      // Apply custom fonts
      await this.applyCustomFonts();

      // Apply custom CSS
      await this.applyCustomCSS();

      // Update page metadata
      this.updatePageMetadata();

      // Store corporate config for future visits
      this.storeCorporateConfig();

      this.brandingApplied = true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to apply corporate branding:', error);
    }
  }

  /**
   * Apply corporate theme colors.
   * @example
   * // Usage example
   * const result = await applyThemeColors({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  applyThemeColors() {
    const { theme } = this.corporateData;
    if (!theme) return;

    const root = document.documentElement;

    if (theme.primaryColor) {
      root.style.setProperty('--primary-color', theme.primaryColor);
    }

    if (theme.secondaryColor) {
      root.style.setProperty('--secondary-color', theme.secondaryColor);
    }

    if (theme.backgroundColor) {
      root.style.setProperty('--brand-background', theme.backgroundColor);
    }

    if (theme.textColor) {
      root.style.setProperty('--brand-text', theme.textColor);
    }

    if (theme.buttonColor) {
      root.style.setProperty('--button-color', theme.buttonColor);
    }

    if (theme.linkColor) {
      root.style.setProperty('--link-color', theme.linkColor);
    }

    // Apply gradient backgrounds if defined
    if (theme.gradientBackground) {
      document.body.style.background = theme.gradientBackground;
    }
  }

  /**
   * Apply corporate logos and imagery.
   * @example
   * // Usage example
   * const result = await applyLogosAndImagery({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async applyLogosAndImagery() {
    const { branding } = this.corporateData;
    if (!branding) return;

    // Update main logo in header
    if (branding.logo) {
      const logoElements = document.querySelectorAll('.logo, .corporate-logo');
      logoElements.forEach((element) => {
        if (element.tagName === 'IMG') {
          element.src = branding.logo;
          element.alt = `${this.corporateData.name} Logo`;
        } else {
          // Replace text logo with image
          const img = document.createElement('img');
          img.src = branding.logo;
          img.alt = `${this.corporateData.name} Logo`;
          img.className = `${element.className} corporate-logo-img`;
          element.parentNode.replaceChild(img, element);
        }
      });
    }

    // Update favicon
    if (branding.favicon) {
      const favicon = document.querySelector('link[rel="icon"]')
        || document.querySelector('link[rel="shortcut icon"]');
      if (favicon) {
        favicon.href = branding.favicon;
      } else {
        const newFavicon = document.createElement('link');
        newFavicon.rel = 'icon';
        newFavicon.href = branding.favicon;
        document.head.appendChild(newFavicon);
      }
    }

    // Apply background imagery
    if (branding.backgroundImage) {
      document.body.style.backgroundImage = `url(${branding.backgroundImage})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    }

    // Apply corporate imagery to OAuth sections
    if (branding.oauthBackground) {
      const oauthContainers = document.querySelectorAll(
        '.oauth-provider-container , .corporate-branding'
      );
      oauthContainers.forEach((container) => {
        container.style.backgroundImage = `url(${branding.oauthBackground})`;
        container.style.backgroundSize = 'cover';
        container.style.backgroundPosition = 'center';
      });
    }
  }

  /**
   * Apply custom fonts.
   * @example
   * // Usage example
   * const result = await applyCustomFonts({ param: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async applyCustomFonts() {
    const { fonts } = this.corporateData;
    if (!fonts) return;

    // Load Google Fonts if specified
    if (fonts.googleFonts && fonts.googleFonts.length > 0) {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = `https://fonts.googleapis.com/css2?${fonts.googleFonts.map((font) => `family=${encodeURIComponent(font)}`).join('&')}&display=swap`;
      document.head.appendChild(fontLink);
    }

    // Apply font family settings
    if (fonts.primaryFont) {
      document.documentElement.style.setProperty(
        '--font-primary',
        fonts.primaryFont
      );
    }

    if (fonts.secondaryFont) {
      document.documentElement.style.setProperty(
        '--font-secondary',
        fonts.secondaryFont
      );
    }

    // Apply font sizes if specified
    if (fonts.baseFontSize) {
      document.documentElement.style.setProperty(
        '--font-size-base',
        fonts.baseFontSize
      );
    }
  }

  /**
   * Apply custom CSS.
   * @example
   * // Usage example
   * const result = await applyCustomCSS({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async applyCustomCSS() {
    const { customCSS } = this.corporateData;
    if (!customCSS) return;

    try {
      const style = document.createElement('style');
      style.type = 'text/css';
      style.textContent = customCSS;
      style.setAttribute('data-corporate-css', this.corporateData.id);
      document.head.appendChild(style);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to apply custom CSS:', error);
    }
  }

  /**
   * Update page metadata with corporate information.
   * @example
   * // Usage example
   * const result = await updatePageMetadata({ param: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  updatePageMetadata() {
    const meta = this.corporateData.metadata;
    if (!meta) return;

    // Update page title
    if (meta.title) {
      document.title = meta.title;
    }

    // Update meta description
    if (meta.description) {
      let descriptionMeta = document.querySelector('meta[name="description"]');
      if (!descriptionMeta) {
        descriptionMeta = document.createElement('meta');
        descriptionMeta.name = 'description';
        document.head.appendChild(descriptionMeta);
      }
      descriptionMeta.content = meta.description;
    }

    // Update Open Graph meta tags
    if (meta.ogTitle) {
      this.updateMetaTag('property', 'og:title', meta.ogTitle);
    }

    if (meta.ogDescription) {
      this.updateMetaTag('property', 'og:description', meta.ogDescription);
    }

    if (meta.ogImage) {
      this.updateMetaTag('property', 'og:image', meta.ogImage);
    }

    // Update Twitter Card meta tags
    if (meta.twitterTitle) {
      this.updateMetaTag('name', 'twitter:title', meta.twitterTitle);
    }

    if (meta.twitterDescription) {
      this.updateMetaTag(
        'name',
        'twitter:description',
        meta.twitterDescription
      );
    }

    if (meta.twitterImage) {
      this.updateMetaTag('name', 'twitter:image', meta.twitterImage);
    }
  }

  /**
   * Helper to update or create meta tags.
   * @param {*} attribute - Attribute parameter.
   * @param {*} value - Value parameter.
   * @param {*} content - Content parameter.
   * @example
   * // Usage example
   * const result = await updateMetaTag({ attribute: 'example', value: 'example', content: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  updateMetaTag(attribute, value, content) {
    let metaTag = document.querySelector(`meta[${attribute}="${value}"]`);
    if (!metaTag) {
      metaTag = document.createElement('meta');
      metaTag.setAttribute(attribute, value);
      document.head.appendChild(metaTag);
    }
    metaTag.content = content;
  }

  /**
   * Store corporate configuration for future visits.
   * @example
   * // Usage example
   * const result = await storeCorporateConfig({ attribute: 'example', value: 'example', content: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  storeCorporateConfig() {
    try {
      const storageData = {
        config: this.corporateData,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      };

      localStorage.setItem(
        'amexing_corporate_config',
        JSON.stringify(storageData)
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to store corporate config:', error);
    }
  }

  /**
   * Initialize OAuth Provider with corporate settings.
   * @example
   * // Usage example
   * const result = await initializeOAuthProvider({ attribute: 'example', value: 'example', content: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async initializeOAuthProvider() {
    if (!window.OAuthProvider) return;

    const oauthConfig = {
      corporateMode: true,
      corporateConfig: this.corporateData,
      departmentRequired:
        this.corporateData?.requireDepartmentSelection || false,
      allowedProviders: this.corporateData?.allowedProviders || [
        'google',
        'microsoft',
        'apple',
      ],
      mobile: this.detectMobile(),
    };

    // Apply corporate-specific OAuth settings
    if (this.corporateData?.oauth) {
      Object.assign(oauthConfig, this.corporateData.oauth);
    }

    this.oauthProvider = new window.OAuthProvider(oauthConfig);
    window.corporateOAuthProvider = this.oauthProvider;
  }

  /**
   * Setup corporate-specific event handlers.
   * @example
   * // Usage example
   * const result = await setupCorporateEventHandlers({ attribute: 'example', value: 'example', content: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  setupCorporateEventHandlers() {
    // Handle corporate domain email detection
    document.addEventListener(
      'emailDomainDetected',
      this.handleEmailDomainDetection.bind(this)
    );

    // Handle department changes
    document.addEventListener(
      'departmentChanged',
      this.handleDepartmentChange.bind(this)
    );

    // Handle OAuth success with corporate context
    document.addEventListener(
      'oauthSuccess',
      this.handleCorporateOAuthSuccess.bind(this)
    );

    // Handle corporate branding updates
    document.addEventListener(
      'corporateBrandingUpdate',
      this.handleBrandingUpdate.bind(this)
    );

    // Handle page visibility changes (for session management)
    document.addEventListener(
      'visibilitychange',
      this.handleVisibilityChange.bind(this)
    );
  }

  /**
   * Handle email domain detection for corporate users.
   * @param {*} event - Event parameter.
   * @example
   * // Usage example
   * const result = await handleEmailDomainDetection({ event: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  handleEmailDomainDetection(event) {
    const { _domain, email } = event.detail;

    if (this.corporateData?.emailDomains?.includes(_domain)) {
      // User is using corporate email domain
      this.highlightCorporateLogin(email);
      this.suggestCorporateProviders(_domain);
    }
  }

  /**
   * Highlight corporate login options.
   * @param {string} email - User email address.
   * @param email
   * @param _email
   * @example
   * // Usage example
   * const result = await highlightCorporateLogin({ email: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  highlightCorporateLogin(_email) {
    const oauthContainer = document.getElementById('oauth-container');
    if (!oauthContainer) return;

    // Remove existing corporate highlights
    oauthContainer
      .querySelectorAll('.corporate-highlight')
      .forEach((el) => el.remove());

    // Add corporate user notice
    const notice = document.createElement('div');
    notice.className = 'corporate-highlight';
    notice.style.cssText = `
      padding: 1rem;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, ${this.corporateData?.theme?.primaryColor || '#667eea'} 0%, ${this.corporateData?.theme?.secondaryColor || '#764ba2'} 100%);
      color: white;
      border-radius: 8px;
      text-align: center;
      font-weight: 500;
    `;
    // Use DOM methods to prevent XSS
    const welcomeP = document.createElement('p');
    welcomeP.style.cssText = 'margin: 0 0 0.5rem 0;';
    welcomeP.textContent = `Welcome, ${this.corporateData.name} team member!`;

    const instructionP = document.createElement('p');
    instructionP.style.cssText = 'margin: 0; font-size: 0.875rem; opacity: 0.9;';
    instructionP.textContent = `Sign in with your ${this.corporateData.name} account for the best experience.`;

    notice.appendChild(welcomeP);
    notice.appendChild(instructionP);

    oauthContainer.insertBefore(notice, oauthContainer.firstChild);
  }

  /**
   * Suggest corporate OAuth providers based on email domain.
   * @param {*} domain - Domain parameter.
   * @param _domain
   * @example
   * // Usage example
   * const result = await suggestCorporateProviders({ domain: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  suggestCorporateProviders(domain) {
    if (!this.corporateData?.domainMappings) return;

    const suggestedProvider = this.corporateData.domainMappings[domain];
    if (suggestedProvider) {
      // Trigger provider suggestion
      const event = new CustomEvent('suggestProvider', {
        detail: { provider: suggestedProvider, reason: 'corporate_domain' },
      });
      document.dispatchEvent(event);
    }
  }

  /**
   * Handle department selection changes.
   * @param {*} event - Event parameter.
   * @example
   * // Usage example
   * const result = await handleDepartmentChange({ event: 'example' });
   * // Returns: operation result
   * // const provider = new OAuthProvider(config);
   * // const authUrl = await provider.getAuthorizationUrl(options);
   * @returns {*} - Operation result.
   */
  handleDepartmentChange(event) {
    const { department } = event.detail;

    if (this.corporateData?.departments?.[department]) {
      const deptConfig = this.corporateData.departments[department];

      // Update allowed providers based on department
      if (deptConfig.allowedProviders && this.oauthProvider) {
        this.oauthProvider.updateAllowedProviders(deptConfig.allowedProviders);
      }

      // Apply department-specific branding
      if (deptConfig.theme) {
        this.applyDepartmentTheme(deptConfig.theme);
      }
    }
  }

  /**
   * Apply department-specific theme.
   * @param {*} theme - Theme parameter.
   * @example
   * // Usage example
   * const result = await applyDepartmentTheme({ theme: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  applyDepartmentTheme(theme) {
    const root = document.documentElement;

    if (theme.primaryColor) {
      root.style.setProperty('--dept-primary-color', theme.primaryColor);
    }

    if (theme.accentColor) {
      root.style.setProperty('--dept-accent-color', theme.accentColor);
    }
  }

  /**
   * Handle corporate OAuth success.
   * @param {*} event - Event parameter.
   * @example
   * // Usage example
   * const result = await handleCorporateOAuthSuccess({ event: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  handleCorporateOAuthSuccess(event) {
    const { _provider, user, department } = event.detail;

    // Track corporate OAuth usage
    this.trackCorporateOAuthUsage(_provider, department);

    // Apply post-login corporate customizations
    this.applyPostLoginCustomizations(user);
  }

  /**
   * Track corporate OAuth usage for analytics.
   * @param {string} provider - OAuth provider name.
   * @param _provider
   * @param {object} department - Department object.
   * @example
   * // Usage example
   * const result = await trackCorporateOAuthUsage({ provider: 'example' , department: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  trackCorporateOAuthUsage(_provider, department) {
    try {
      fetch('/api/analytics/corporate-oauth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          corporateId: this.corporateData.id,
          _provider,
          department,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          referrer: document.referrer,
        }),
      });
    } catch (error) {
      console.warn('Failed to track corporate OAuth usage:', error);
    }
  }

  /**
   * Apply post-login corporate customizations.
   * @param {*} user - User parameter.
   * @example
   * // Usage example
   * const result = await applyPostLoginCustomizations({ user: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  applyPostLoginCustomizations(user) {
    if (!this.corporateData?.postLoginCustomizations) return;

    const customizations = this.corporateData.postLoginCustomizations;

    if (customizations.redirectUrl) {
      setTimeout(() => {
        window.location.href = customizations.redirectUrl;
      }, customizations.redirectDelay || 1000);
    }

    if (customizations.welcomeMessage) {
      this.showWelcomeMessage(customizations.welcomeMessage, user);
    }
  }

  /**
   * Show corporate welcome message.
   * @param {string} message - Message string.
   * @param {*} user - User parameter.
   * @example
   * // Usage example
   * const result = await showWelcomeMessage({ message: 'example', user: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  showWelcomeMessage(message, user) {
    const welcomeDiv = document.createElement('div');
    welcomeDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      max-width: 300px;
      padding: 1rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      border-left: 4px solid ${this.corporateData?.theme?.primaryColor || '#667eea'};
    `;

    // Use DOM methods to prevent XSS
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'position: absolute; top: 0.5rem; right: 0.5rem; border: none; background: none; font-size: 1.2rem; cursor: pointer;';
    closeBtn.addEventListener('click', () => closeBtn.parentElement.remove());

    const welcomeH4 = document.createElement('h4');
    welcomeH4.style.cssText = `margin: 0 0 0.5rem 0; color: ${this.corporateData?.theme?.primaryColor || '#667eea'};`;
    welcomeH4.textContent = 'Welcome!';

    const messageP = document.createElement('p');
    messageP.style.cssText = 'margin: 0; font-size: 0.875rem; color: #666;';
    messageP.textContent = message.replace('{name}', user.name || user.email);

    welcomeDiv.appendChild(closeBtn);
    welcomeDiv.appendChild(welcomeH4);
    welcomeDiv.appendChild(messageP);

    document.body.appendChild(welcomeDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (welcomeDiv.parentElement) {
        welcomeDiv.remove();
      }
    }, 5000);
  }

  /**
   * Handle branding updates (for dynamic rebranding).
   * @param {*} event - Event parameter.
   * @example
   * // Usage example
   * const result = await handleBrandingUpdate({ event: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  handleBrandingUpdate(event) {
    const { newBranding } = event.detail;

    if (this.corporateData) {
      this.corporateData.branding = {
        ...this.corporateData.branding,
        ...newBranding,
      };
      this.brandingApplied = false;
      this.applyCorporateBranding();
    }
  }

  /**
   * Handle page visibility changes.
   * @example
   * // Usage example
   * const result = await handleVisibilityChange({ event: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  handleVisibilityChange() {
    if (document.hidden) {
      // Page is hidden - pause any animations or timers
      this.pauseCorporateFeatures();
    } else {
      // Page is visible - resume features and check for updates
      this.resumeCorporateFeatures();
      this.checkForUpdates();
    }
  }

  /**
   * Pause corporate features when page is hidden.
   * @example
   * // Usage example
   * const result = await pauseCorporateFeatures({ event: 'example' });
   * // Returns: operation result
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * @returns {*} - Operation result.
   */
  pauseCorporateFeatures() {
    // Pause any ongoing animations or periodic tasks
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
  }

  /**
   * Resume corporate features when page becomes visible.
   * @example
   * // Usage example
   * const result = await resumeCorporateFeatures({ event: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  resumeCorporateFeatures() {
    // Resume periodic updates
    this.updateTimer = setInterval(
      () => {
        this.checkForUpdates();
      },
      5 * 60 * 1000
    ); // Check every 5 minutes
  }

  /**
   * Check for corporate configuration updates.
   * @example
   * // Validation utility usage
   * const isValid = validateFunction(input);
   * // Returns: boolean
   * // const isValid = validator.validate(data);
   * // Returns: boolean or validation result object
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async checkForUpdates() {
    if (!this.corporateData?.id) return;

    try {
      const response = await fetch(
        `/api/corporate/config/${this.corporateData.id}/version`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      if (response.ok) {
        const { version, hasUpdates } = await response.json();

        if (hasUpdates && version !== this.corporateData.version) {
          await this.loadCorporateConfiguration();
          await this.applyCorporateBranding();
        }
      }
    } catch (error) {
      console.warn('Failed to check for corporate updates:', error);
    }
  }

  /**
   * Fallback to regular OAuth if corporate configuration fails.
   * @example
   * // Usage example
   * const result = await fallbackToRegularOAuth({ event: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  fallbackToRegularOAuth() {
    console.log('Falling back to regular OAuth interface');

    // Initialize standard OAuth provider
    if (window.OAuthProvider) {
      this.oauthProvider = new window.OAuthProvider({
        corporateMode: false,
        allowedProviders: ['google', 'microsoft', 'apple'],
      });
    }

    // Remove any corporate branding attempts
    this.removeCorporateBranding();
  }

  /**
   * Remove corporate branding.
   * @example
   * // Usage example
   * const result = await removeCorporateBranding({ event: 'example' });
   * // Returns: operation result
   * // const result = await authService.login(credentials);
   * // Returns: { success: true, user: {...}, tokens: {...} }
   * @returns {*} - Operation result.
   */
  removeCorporateBranding() {
    // Remove corporate CSS
    const corporateStyles = document.querySelectorAll('[data-corporate-css]');
    corporateStyles.forEach((style) => style.remove());

    // Reset CSS custom properties
    const root = document.documentElement;
    root.style.removeProperty('--primary-color');
    root.style.removeProperty('--secondary-color');
    root.style.removeProperty('--brand-background');
    root.style.removeProperty('--brand-text');

    // Remove corporate highlights
    const highlights = document.querySelectorAll('.corporate-highlight');
    highlights.forEach((highlight) => highlight.remove());

    // Reset document title and meta tags
    document.title = 'AmexingWeb - Sign In';
  }

  /**
   * Utility methods.
   * @example
   * // Usage example
   * const result = await detectMobile({ event: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  detectMobile() {
    return (
      window.innerWidth <= 768
      || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      )
    );
  }

  /**
   * Get corporate configuration.
   * @example
   * // Usage example
   * const result = await getCorporateConfig({ event: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  getCorporateConfig() {
    return this.corporateData;
  }

  /**
   * Update corporate configuration.
   * @param {*} newConfig - NewConfig parameter.
   * @example
   * // Usage example
   * const result = await updateCorporateConfig({ newConfig: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async updateCorporateConfig(newConfig) {
    this.corporateData = { ...this.corporateData, ...newConfig };
    this.brandingApplied = false;
    await this.applyCorporateBranding();
  }

  /**
   * Cleanup resources.
   * @example
   * // Usage example
   * const result = await cleanup({ newConfig: 'example' });
   * // Returns: operation result
   * // Example usage:
   * // const result = await methodName(params);
   * // Returns appropriate result based on operation
   * @returns {*} - Operation result.
   */
  cleanup() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    if (this.oauthProvider && this.oauthProvider.cleanup) {
      this.oauthProvider.cleanup();
    }

    this.removeCorporateBranding();
  }
}

// Export for use in browser
window.CorporateOAuthInterface = CorporateOAuthInterface;

// Auto-initialize if corporate context detected
document.addEventListener('DOMContentLoaded', () => {
  const corporateContainer = document.querySelector('[data-corporate-oauth]');
  if (corporateContainer) {
    const config = corporateContainer.dataset.corporateConfig
      ? JSON.parse(corporateContainer.dataset.corporateConfig)
      : {};

    window.corporateOAuthInterface = new CorporateOAuthInterface(config);
  }
});
