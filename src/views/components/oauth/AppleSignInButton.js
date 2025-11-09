/* eslint-disable no-console */
/**
 * Apple Sign In Button Component - Native Apple ID authentication with privacy compliance.
 * Provides secure Apple Sign In integration with corporate department flows, mobile
 * optimization, and comprehensive fallback mechanisms for cross-platform compatibility.
 *
 * This component implements Apple's official Sign In with Apple JavaScript SDK,
 * supporting both native Apple ID authentication and fallback OAuth flows for
 * non-Apple devices with privacy-compliant user data handling.
 *
 * Features:
 * - Native Apple ID SDK integration with official button rendering
 * - Cross-platform fallback for non-Apple devices
 * - Mobile-optimized touch interactions and responsive design
 * - Corporate department and configuration support
 * - Privacy-compliant email handling with Hide My Email support
 * - Secure state and nonce generation for CSRF protection
 * - Loading states and comprehensive error handling
 * - Dynamic theme support for light/dark mode
 * - Touch-optimized interactions for mobile devices
 * - Graceful degradation for unsupported browsers.
 * @class AppleSignInButton
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Basic Apple Sign In button
 * const appleButton = new AppleSignInButton({
 *   clientId: 'com.amexing.service',
 *   onSuccess: (response) => {
 *     // eslint-disable-next-line no-console
 *     console.log('Apple authentication successful:', response);
 *     // Handle successful authentication
 *   },
 *   onError: (error) => {
 *     // eslint-disable-next-line no-console
 *     console.error('Apple authentication failed:', error);
 *   }
 * });
 *
 * // Corporate department flow
 * const corporateAppleButton = new AppleSignInButton({
 *   clientId: 'com.amexing.corporate',
 *   department: 'engineering',
 *   corporateConfigId: 'corp-config-123',
 *   onSuccess: (response) => {
 *     // Handle corporate authentication
 *   }
 * });
 *
 * // Static availability check
 * if (AppleSignInButton.isSupported()) {
 *   const button = AppleSignInButton.create(options);
 * }
 */

class AppleSignInButton {
  /**
   * Creates a new AppleSignInButton instance with the specified configuration.
   * Initializes the Apple Sign In component with OAuth settings, department configuration,
   * and event handlers for authentication flow management.
   * @class
   * @param {object} options - Configuration options for Apple Sign In.
   * @example
   * const appleButton = new AppleSignInButton({
   *   clientId: 'com.amexing.service',
   *   onSuccess: (response) => console.log('Success:', response)
   * });
   */
  constructor(options = {}) {
    this.options = {
      clientId: options.clientId || window.APPLE_CLIENT_ID,
      scope: options.scope || 'email name',
      responseType: options.responseType || 'code idtoken',
      responseMode: options.responseMode || 'form_post',
      usePopup: options.usePopup || false,
      locale: options.locale || 'en_US',
      department: options.department,
      corporateConfigId: options.corporateConfigId,
      onSuccess: options.onSuccess || (() => {}),
      onError: options.onError || (() => {}),
      onCancel: options.onCancel || (() => {}),
      ...options,
    };

    this.isAppleDevice = this.detectAppleDevice();
    this.supportsAppleID = this.checkAppleIDSupport();
    this.state = null;
    this.nonce = null;

    this.init();
  }

  /**
   * Initializes the Apple Sign In component by loading the SDK and setting up authentication.
   * Checks for Apple ID support and loads the Apple ID SDK, then configures the authentication flow.
   * @function init
   * @returns {void}
   * @example
   * const button = new AppleSignInButton(options);
   * // init() is called automatically in constructor
   */
  init() {
    // Check if Apple ID is supported
    if (!this.supportsAppleID) {
      // eslint-disable-next-line no-console
      console.warn('Apple ID is not supported in this browser');
      return;
    }

    this.loadAppleIDSDK()
      .then(() => {
        this.setupAppleID();
        // eslint-disable-next-line no-console
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize Apple Sign In:', error);
        this.options.onError(error);
      });
  }

  /**
   * Detects if the current device is an Apple device based on user agent.
   * Checks for iPhone, iPad, iPod, Mac, or Safari in the browser user agent string.
   * @function detectAppleDevice
   * @returns {boolean} - True if device is detected as Apple device, false otherwise.
   * @example
   * const isApple = this.detectAppleDevice();
   * // Returns: true on Mac/iPhone/iPad, false on Windows/Android
   */
  detectAppleDevice() {
    const { userAgent } = navigator;
    return /iPhone|iPad|iPod|Mac|Safari/i.test(userAgent);
  }

  /**
   * Checks if the browser supports Apple ID authentication.
   * Verifies if the AppleID SDK is available in the window object or if the device is an Apple device.
   * @function checkAppleIDSupport
   * @returns {boolean} - True if Apple ID is supported, false otherwise.
   * @example
   * const isSupported = this.checkAppleIDSupport();
   * // Returns: true if AppleID SDK available or on Apple device
   */
  checkAppleIDSupport() {
    // Check if browser supports Apple ID
    return 'AppleID' in window || this.isAppleDevice;
  }

  /**
   * Asynchronously loads the Apple ID SDK from Apple's CDN.
   * Creates a script element, injects it into the document head, and waits for the SDK to load.
   * Includes a 10-second timeout fallback to prevent indefinite waiting.
   * @async
   * @function loadAppleIDSDK
   * @returns {Promise<void>} - Promise that resolves when SDK is loaded, rejects on error or timeout.
   * @throws {Error} - Throws error if SDK fails to load or timeout occurs.
   * @example
   * await this.loadAppleIDSDK();
   * // window.AppleID is now available
   */
  async loadAppleIDSDK() {
    return new Promise((resolve, reject) => {
      // Check if SDK already loaded
      if (window.AppleID) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (window.AppleID) {
          resolve();
        } else {
          reject(new Error('Apple ID SDK failed to load'));
        }
      };

      script.onerror = () => {
        reject(new Error('Failed to load Apple ID SDK'));
      };

      document.head.appendChild(script);

      // Fallback timeout
      setTimeout(() => {
        if (!window.AppleID) {
          reject(new Error('Apple ID SDK load timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Configures and initializes the Apple ID SDK with authentication parameters.
   * Generates cryptographic state and nonce for CSRF protection, initializes the Apple ID SDK,
   * and creates the sign-in button with proper configuration.
   * @async
   * @function setupAppleID
   * @returns {Promise<void>} - Promise that resolves when setup is complete.
   * @example
   * await this.setupAppleID();
   * // Apple ID SDK is now configured and button is rendered
   */
  async setupAppleID() {
    try {
      // Generate state and nonce for CSRF protection
      this.state = this.generateRandomString(32);
      this.nonce = this.generateRandomString(32);

      // Configure Apple ID
      AppleID.auth.init({
        clientId: this.options.clientId,
        scope: this.options.scope,
        redirectURI: this.options.redirectUri || `${window.location.origin}/auth/oauth/apple/callback`,
        state: this.state,
        nonce: this.nonce,
        usePopup: this.options.usePopup,
      });

      this.createSignInButton();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Apple ID setup failed:', error);
      this.options.onError(error);
    }
  }

  /**
   * Creates and renders the Apple Sign In button in the DOM.
   * Finds or creates a container element, clears existing content, and renders either
   * the native Apple ID button or a fallback button based on browser support.
   * @function createSignInButton
   * @returns {void}
   * @example
   * this.createSignInButton();
   * // Apple Sign In button is now rendered in the DOM
   */
  createSignInButton() {
    // Find or create container
    const container = document.getElementById('apple-signin-container')
      || document.querySelector('.apple-signin-container')
      || this.createButtonContainer();

    // Clear existing content
    container.innerHTML = '';

    // Render appropriate button type
    if (this.supportsAppleID && window.AppleID) {
      this.createNativeAppleButton(container);
    } else {
      this.createFallbackButton(container);
    }

    // Add mobile optimizations
    this.applyMobileOptimizations(container);
  }

  /**
   * Creates a new DOM container for the Apple Sign In button.
   * Generates a div element with appropriate ID and classes, then appends it to
   * the OAuth providers container or document body as a fallback.
   * @function createButtonContainer
   * @returns {HTMLDivElement} - The created container element.
   * @example
   * const container = this.createButtonContainer();
   * // Returns: <div id="apple-signin-container" class="apple-signin-container oauth-provider-apple">
   */
  createButtonContainer() {
    const container = document.createElement('div');
    container.id = 'apple-signin-container';
    container.className = 'apple-signin-container oauth-provider-apple';

    // Find OAuth providers container
    const providersContainer = document.querySelector('.oauth-providers');
    if (providersContainer) {
      providersContainer.appendChild(container);
    } else {
      document.body.appendChild(container);
    }

    return container;
  }

  /**
   * Creates and renders the native Apple ID sign-in button using the Apple SDK.
   * Configures the official Apple button with proper styling attributes, renders it using
   * the AppleID SDK, and attaches success/failure event listeners.
   * @function createNativeAppleButton
   * @param {HTMLElement} container - The container element to append the button to.
   * @returns {void}
   * @example
   * this.createNativeAppleButton(containerElement);
   * // Native Apple ID button is rendered with SDK
   */
  createNativeAppleButton(container) {
    // Create Apple ID sign-in button
    const buttonDiv = document.createElement('div');
    buttonDiv.id = 'appleid-signin';
    buttonDiv.className = 'apple-signin-button native';

    // Apple's official button styling attributes
    buttonDiv.setAttribute('data-color', this.isAppleDevice ? 'black' : 'white');
    buttonDiv.setAttribute('data-border', 'true');
    buttonDiv.setAttribute('data-type', 'sign-in');
    buttonDiv.setAttribute('data-border-radius', '12');
    buttonDiv.setAttribute('data-size', 'medium');
    buttonDiv.setAttribute('data-logo-color', this.isAppleDevice ? 'white' : 'black');

    container.appendChild(buttonDiv);

    // Render the button using Apple SDK
    try {
      AppleID.auth.renderButton(buttonDiv, {
        color: this.isAppleDevice ? 'black' : 'white',
        border: true,
        type: 'sign-in',
        borderRadius: 12,
        size: 'medium',
        logoColor: this.isAppleDevice ? 'white' : 'black',
      });

      // Add event listeners
      document.addEventListener('AppleIDSignInOnSuccess', this.handleSuccess.bind(this));
      document.addEventListener('AppleIDSignInOnFailure', this.handleError.bind(this));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to render Apple button:', error);
      this.createFallbackButton(container);
    }
  }

  /**
   * Creates a fallback Apple Sign In button for browsers without native Apple ID support.
   * Builds a custom button with Apple branding, proper styling, click handlers,
   * and mobile touch optimizations for cross-platform compatibility.
   * @function createFallbackButton
   * @param {HTMLElement} container - The container element to append the button to.
   * @returns {void}
   * @example
   * this.createFallbackButton(containerElement);
   * // Custom Apple-styled button is rendered
   */
  createFallbackButton(container) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'oauth-btn apple-signin-fallback';
    button.setAttribute('data-provider', 'apple');

    // Use DOM methods instead of innerHTML to prevent XSS
    const iconSpan = document.createElement('span');
    iconSpan.className = 'oauth-btn-icon';
    // Create SVG element directly instead of using innerHTML
    iconSpan.appendChild(this.createAppleIconSVG());

    const textSpan = document.createElement('span');
    textSpan.className = 'oauth-btn-text';
    textSpan.textContent = 'Continue with Apple'; // Safe: using textContent

    button.appendChild(iconSpan);
    button.appendChild(textSpan);

    button.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 44px;
            padding: 0 16px;
            background: ${this.isAppleDevice ? '#000' : '#fff'};
            color: ${this.isAppleDevice ? '#fff' : '#000'};
            border: 1px solid ${this.isAppleDevice ? '#000' : '#d1d1d6'};
            border-radius: 12px;
            font-size: 16px;
            font-weight: 500;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            -webkit-appearance: none;
            appearance: none;
        `;

    button.addEventListener('click', this.handleFallbackClick.bind(this));

    // Mobile touch optimizations
    if (window.oauthMobileOptimizer) {
      button.addEventListener('touchstart', () => {
        button.style.transform = 'scale(0.98)';
        button.style.opacity = '0.8';
      });

      button.addEventListener('touchend', () => {
        setTimeout(() => {
          button.style.transform = 'scale(1)';
          button.style.opacity = '1';
        }, 150);
      });
    }

    container.appendChild(button);
  }

  /**
   * Returns the Apple logo icon as an SVG string.
   * Provides the official Apple logo SVG markup for use in fallback buttons.
   * Note: This method is deprecated in favor of createAppleIconSVG() for XSS prevention.
   * @function getAppleIcon
   * @returns {string} - SVG markup string for the Apple logo.
   * @deprecated Use createAppleIconSVG() instead for safer DOM manipulation.
   * @example
   * const iconSVG = this.getAppleIcon();
   * // Returns: "<svg width="18" height="22"...>...</svg>"
   */
  getAppleIcon() {
    return `
            <svg width="18" height="22" viewBox="0 0 814 1000" style="fill: currentColor;">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 201.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 65.6 0 120.5 43.9 162.2 43.9 40.8 0 101.2-46.4 175.8-46.4 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
            </svg>
        `;
  }

  /**
   * Creates the Apple logo icon as an SVG DOM element.
   * Programmatically builds an SVG element with the official Apple logo path,
   * preventing XSS vulnerabilities by avoiding innerHTML usage.
   * @function createAppleIconSVG
   * @returns {SVGElement} - SVG DOM element containing the Apple logo.
   * @example
   * const svgElement = this.createAppleIconSVG();
   * iconContainer.appendChild(svgElement);
   */
  createAppleIconSVG() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 814 1000');
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 201.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 65.6 0 120.5 43.9 162.2 43.9 40.8 0 101.2-46.4 175.8-46.4 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z'
    );

    svg.appendChild(path);
    return svg;
  }

  /**
   * Applies mobile-specific optimizations and responsive styling to the button container.
   * Injects CSS for touch interactions, responsive sizing, and dark mode support
   * when the oauthMobileOptimizer is available.
   * @function applyMobileOptimizations
   * @param {HTMLElement} _container - The container element to optimize.
   * @returns {void}
   * @example
   * this.applyMobileOptimizations(containerElement);
   * // Mobile-optimized styles are applied
   */
  applyMobileOptimizations(_container) {
    if (!window.oauthMobileOptimizer) return;

    // Apply mobile-specific styling
    const style = document.createElement('style');
    style.textContent = `
            .apple-signin-container {
                width: 100%;
                margin-bottom: 12px;
            }

            .apple-signin-button,
            .apple-signin-fallback {
                width: 100%;
                min-height: 44px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }

            @media (max-width: 768px) {
                .apple-signin-button,
                .apple-signin-fallback {
                    font-size: 16px;
                    min-height: 48px;
                    border-radius: 12px;
                }
            }

            @media (prefers-color-scheme: dark) {
                .apple-signin-fallback {
                    background: #1c1c1e !important;
                    color: #ffffff !important;
                    border-color: #48484a !important;
                }
            }
        `;

    if (!document.getElementById('apple-signin-styles')) {
      style.id = 'apple-signin-styles';
      document.head.appendChild(style);
    }
  }

  /**
   * Handles the fallback button click event to initiate Apple OAuth flow.
   * Calls the backend API to generate an Apple authorization URL, displays loading state,
   * and redirects to Apple's authentication page on success.
   * @async
   * @function handleFallbackClick
   * @param {Event} event - The click event object.
   * @returns {Promise<void>} - Promise that resolves when OAuth flow is initiated.
   * @example
   * button.addEventListener('click', this.handleFallbackClick.bind(this));
   * // User is redirected to Apple authorization page
   */
  async handleFallbackClick(event) {
    event.preventDefault();

    try {
      this.showLoading(event.target);

      // Call backend to initiate Apple OAuth
      const response = await fetch('/api/cloud/initiateAppleOAuth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Parse-Application-Id': window.Parse?.applicationId || process.env.PARSE_APP_ID,
        },
        body: JSON.stringify({
          department: this.options.department,
          corporateConfigId: this.options.corporateConfigId,
          redirectUri: `${window.location.origin}/auth/oauth/apple/callback`,
        }),
      });

      const data = await response.json();

      // Check for successful response
      if (data.success && data.authUrl) {
        // Redirect to Apple authorization
        window.location.href = data.authUrl;
      } else {
        throw new Error(data.error || 'Failed to initiate Apple OAuth');
      }
    } catch (error) {
      this.hideLoading(event.target);
      // eslint-disable-next-line no-console
      console.error('Apple OAuth initiation failed:', error);
      this.options.onError(error);
    }
  }

  /**
   * Handles successful Apple authentication response from the native SDK.
   * Extracts user data and authorization information from the event detail,
   * then invokes the onSuccess callback with formatted response data.
   * @function handleSuccess
   * @param {Event} event - The AppleIDSignInOnSuccess event object.
   * @returns {void}
   * @example
   * document.addEventListener('AppleIDSignInOnSuccess', this.handleSuccess.bind(this));
   * // onSuccess callback is invoked with authentication data
   */
  handleSuccess(event) {
    const { detail } = event;

    try {
      // Process successful authentication
      this.options.onSuccess({
        provider: 'apple',
        response: detail,
        user: detail.user,
        authorization: detail.authorization,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Apple OAuth success handling failed:', error);
      this.options.onError(error);
    }
  }

  /**
   * Handles Apple authentication errors from the native SDK.
   * Distinguishes between user cancellation and actual errors, invoking
   * the appropriate callback (onCancel or onError) based on error type.
   * @function handleError
   * @param {Event} event - The AppleIDSignInOnFailure event object.
   * @returns {void}
   * @example
   * document.addEventListener('AppleIDSignInOnFailure', this.handleError.bind(this));
   * // onError or onCancel callback is invoked
   */
  handleError(event) {
    const { detail } = event;

    // Check if user cancelled the authentication
    if (detail.error === 'popup_closed_by_user') {
      this.options.onCancel();
    } else {
      // eslint-disable-next-line no-console
      console.error('Apple OAuth error:', detail);
      this.options.onError(new Error(detail.error || 'Apple OAuth failed'));
    }
  }

  /**
   * Displays a loading spinner on the button during authentication processing.
   * Disables the button, hides text by making it transparent, and adds an animated
   * loading spinner to indicate processing state.
   * @function showLoading
   * @param {HTMLElement} button - The button element to show loading state on.
   * @returns {void}
   * @example
   * this.showLoading(buttonElement);
   * // Button shows loading spinner and is disabled
   */
  showLoading(button) {
    if (!button) return;

    button.disabled = true;
    button.style.position = 'relative';
    button.style.color = 'transparent';

    const spinner = document.createElement('div');
    spinner.className = 'apple-loading-spinner';
    spinner.style.cssText = `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 20px;
            height: 20px;
            border: 2px solid #e3e3e3;
            border-top: 2px solid currentColor;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

    button.appendChild(spinner);
  }

  /**
   * Removes the loading spinner and restores the button to its normal state.
   * Re-enables the button, restores text color, and removes the loading spinner element.
   * @function hideLoading
   * @param {HTMLElement} button - The button element to hide loading state on.
   * @returns {void}
   * @example
   * this.hideLoading(buttonElement);
   * // Button returns to normal state without spinner
   */
  hideLoading(button) {
    if (!button) return;

    button.disabled = false;
    button.style.color = '';

    const spinner = button.querySelector('.apple-loading-spinner');
    if (spinner) {
      spinner.remove();
    }
  }

  /**
   * Generates a cryptographically secure random string for state and nonce values.
   * Uses the Web Crypto API to create random bytes and converts them to a hexadecimal string
   * for CSRF protection in OAuth flows.
   * @function generateRandomString
   * @param {number} length - The desired length of the random byte array.
   * @returns {string} - Hexadecimal string representation of random bytes (length * 2 characters).
   * @example
   * const state = this.generateRandomString(32);
   * // Returns: "a1b2c3d4e5f6..." (64 hex characters from 32 bytes)
   */
  generateRandomString(length) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Refreshes the Apple Sign In button by reinitializing the SDK and re-rendering the button.
   * Useful for updating the button when configuration options change or to recover from errors.
   * @async
   * @function refresh
   * @returns {Promise<void>} - Promise that resolves when refresh is complete.
   * @example
   * await appleButton.refresh();
   * // Button is re-rendered with current configuration
   */
  async refresh() {
    try {
      // Check if Apple ID SDK is available
      if (window.AppleID && this.supportsAppleID) {
        await this.setupAppleID();
        this.createSignInButton();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Apple Sign In refresh failed:', error);
    }
  }

  /**
   * Sets the department identifier for corporate authentication flows.
   * Updates the department option used in OAuth requests for department-specific configurations.
   * @function setDepartment
   * @param {string} department - The department identifier to set.
   * @returns {void}
   * @example
   * appleButton.setDepartment('engineering');
   * // Department is set for subsequent authentication requests
   */
  setDepartment(department) {
    this.options.department = department;
  }

  /**
   * Sets the corporate configuration ID for enterprise authentication flows.
   * Updates the corporate config option used in OAuth requests for organization-specific settings.
   * @function setCorporateConfig
   * @param {string} corporateConfigId - The corporate configuration ID to set.
   * @returns {void}
   * @example
   * appleButton.setCorporateConfig('corp-config-123');
   * // Corporate config is set for subsequent authentication requests
   */
  setCorporateConfig(corporateConfigId) {
    this.options.corporateConfigId = corporateConfigId;
  }

  /**
   * Updates component options and refreshes the button to reflect changes.
   * Merges new options with existing configuration and triggers a button refresh.
   * @function updateOptions
   * @param {object} newOptions - New options to merge with existing configuration.
   * @returns {void}
   * @example
   * appleButton.updateOptions({ department: 'sales', locale: 'es_ES' });
   * // Options are updated and button is refreshed
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    this.refresh();
  }

  /**
   * Checks if Apple Sign In is available in the current environment.
   * Returns the cached support status determined during component initialization.
   * @function isAvailable
   * @returns {boolean} - True if Apple Sign In is supported, false otherwise.
   * @example
   * if (appleButton.isAvailable()) {
   *   // Apple Sign In is available
   * }
   */
  isAvailable() {
    return this.supportsAppleID;
  }

  /**
   * Returns detailed information about the Apple OAuth provider.
   * Provides metadata including availability, native support, privacy features,
   * and recommendations for the current environment.
   * @function getProviderInfo
   * @returns {object} Provider information object with name, displayName, available, native, privacyCompliant, supportsPrivateEmail, and recommended properties.
   * @example
   * const info = appleButton.getProviderInfo();
   * // Returns: { name: 'apple', displayName: 'Apple', available: true, ... }
   */
  getProviderInfo() {
    return {
      name: 'apple',
      displayName: 'Apple',
      available: this.supportsAppleID,
      native: this.isAppleDevice,
      privacyCompliant: true,
      supportsPrivateEmail: true,
      recommended: this.isAppleDevice,
    };
  }

  /**
   * Destroys the component and cleans up all resources, event listeners, and DOM elements.
   * Removes event listeners, button container, and injected styles to prevent memory leaks.
   * @function destroy
   * @returns {void}
   * @example
   * appleButton.destroy();
   * // All component resources are cleaned up
   */
  destroy() {
    // Clean up event listeners
    document.removeEventListener('AppleIDSignInOnSuccess', this.handleSuccess.bind(this));
    document.removeEventListener('AppleIDSignInOnFailure', this.handleError.bind(this));

    // Remove button container
    const container = document.getElementById('apple-signin-container');
    if (container) {
      container.remove();
    }

    // Remove styles
    const styles = document.getElementById('apple-signin-styles');
    if (styles) {
      styles.remove();
    }

    // eslint-disable-next-line no-console
    console.log('Apple Sign In component destroyed');
  }

  /**
   * Static factory method for quick component initialization.
   * Creates and returns a new AppleSignInButton instance with the provided options.
   * @static
   * @function create
   * @param {object} options - Configuration options for the component.
   * @returns {AppleSignInButton} New AppleSignInButton instance.
   * @example
   * const button = AppleSignInButton.create({ clientId: 'com.example.app' });
   * // New instance is created and initialized
   */
  static create(options = {}) {
    return new AppleSignInButton(options);
  }

  /**
   * Static method to check if Apple Sign In is supported in the current environment.
   * Checks for AppleID SDK availability or Apple device user agent without creating an instance.
   * @static
   * @function isSupported
   * @returns {boolean} - True if Apple Sign In is supported, false otherwise.
   * @example
   * if (AppleSignInButton.isSupported()) {
   *   const button = AppleSignInButton.create(options);
   * }
   */
  static isSupported() {
    const { userAgent } = navigator;
    const isAppleDevice = /iPhone|iPad|iPod|Mac|Safari/i.test(userAgent);
    return 'AppleID' in window || isAppleDevice;
  }
}

// Add CSS animations
const appleSignInStyle = document.createElement('style');
appleSignInStyle.textContent = `
    @keyframes spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
`;
document.head.appendChild(appleSignInStyle);

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppleSignInButton;
} else if (typeof window !== 'undefined') {
  window.AppleSignInButton = AppleSignInButton;
}
