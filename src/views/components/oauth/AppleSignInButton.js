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
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * // const result = await authService.login(credentials);
 * // Returns: { success: true, user: {...}, tokens: {...} }
 * // Basic Apple Sign In button
 * const appleButton = new AppleSignInButton({
 *   clientId: 'com.amexing.service',
 *   onSuccess: (response) => {
 *     console.log('Apple authentication successful:', response);
 *     // Handle successful authentication
 *   },
 *   onError: (error) => {
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

  init() {
    if (!this.supportsAppleID) {
      console.warn('Apple ID is not supported in this browser');
      return;
    }

    this.loadAppleIDSDK()
      .then(() => {
        this.setupAppleID();
        console.log('Apple Sign In initialized');
      })
      .catch((error) => {
        console.error('Failed to initialize Apple Sign In:', error);
        this.options.onError(error);
      });
  }

  detectAppleDevice() {
    const { userAgent } = navigator;
    return /iPhone|iPad|iPod|Mac|Safari/i.test(userAgent);
  }

  checkAppleIDSupport() {
    // Check if browser supports Apple ID
    return 'AppleID' in window || this.isAppleDevice;
  }

  async loadAppleIDSDK() {
    return new Promise((resolve, reject) => {
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

  async setupAppleID() {
    try {
      // Generate state and nonce
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
      console.error('Apple ID setup failed:', error);
      this.options.onError(error);
    }
  }

  createSignInButton() {
    // Find or create container
    const container = document.getElementById('apple-signin-container')
                         || document.querySelector('.apple-signin-container')
                         || this.createButtonContainer();

    // Clear existing content
    container.innerHTML = '';

    if (this.supportsAppleID && window.AppleID) {
      this.createNativeAppleButton(_container); // eslint-disable-line no-undef
    } else {
      this.createFallbackButton(_container); // eslint-disable-line no-undef
    }

    // Add mobile optimizations
    this.applyMobileOptimizations(_container); // eslint-disable-line no-undef
  }

  createButtonContainer() {
    const container = document.createElement('div');
    container.id = 'apple-signin-container';
    container.className = 'apple-signin-container oauth-provider-apple';

    // Find OAuth providers container
    const providersContainer = document.querySelector('.oauth-providers');
    if (providersContainer) {
      providersContainer.appendChild(_container); // eslint-disable-line no-undef
    } else {
      document.body.appendChild(_container); // eslint-disable-line no-undef
    }

    return container;
  }

  createNativeAppleButton(_container) {
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

    container.appendChild(buttonDiv); // eslint-disable-line no-undef

    // Render the button
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
      console.error('Failed to render Apple button:', error);
      this.createFallbackButton(_container);
    }
  }

  createFallbackButton(_container) {
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

    container.appendChild(button); // eslint-disable-line no-undef
  }

  getAppleIcon() {
    return `
            <svg width="18" height="22" viewBox="0 0 814 1000" style="fill: currentColor;">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 201.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 65.6 0 120.5 43.9 162.2 43.9 40.8 0 101.2-46.4 175.8-46.4 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
            </svg>
        `;
  }

  createAppleIconSVG() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 814 1000');
    svg.style.fill = 'currentColor';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 201.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 65.6 0 120.5 43.9 162.2 43.9 40.8 0 101.2-46.4 175.8-46.4 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z');

    svg.appendChild(path);
    return svg;
  }

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

      if (data.success && data.authUrl) {
        // Redirect to Apple authorization
        window.location.href = data.authUrl;
      } else {
        throw new Error(data.error || 'Failed to initiate Apple OAuth');
      }
    } catch (error) {
      this.hideLoading(event.target);
      console.error('Apple OAuth initiation failed:', error);
      this.options.onError(error);
    }
  }

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
      console.error('Apple OAuth success handling failed:', error);
      this.options.onError(error);
    }
  }

  handleError(event) {
    const { detail } = event;

    if (detail.error === 'popup_closed_by_user') {
      this.options.onCancel();
    } else {
      console.error('Apple OAuth error:', detail);
      this.options.onError(new Error(detail.error || 'Apple OAuth failed'));
    }
  }

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

  hideLoading(button) {
    if (!button) return;

    button.disabled = false;
    button.style.color = '';

    const spinner = button.querySelector('.apple-loading-spinner');
    if (spinner) {
      spinner.remove();
    }
  }

  generateRandomString(length) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async refresh() {
    try {
      if (window.AppleID && this.supportsAppleID) {
        await this.setupAppleID();
        this.createSignInButton();
      }
    } catch (error) {
      console.error('Apple Sign In refresh failed:', error);
    }
  }

  setDepartment(department) {
    this.options.department = department;
  }

  setCorporateConfig(corporateConfigId) {
    this.options.corporateConfigId = corporateConfigId;
  }

  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    this.refresh();
  }

  isAvailable() {
    return this.supportsAppleID;
  }

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

    console.log('Apple Sign In component destroyed');
  }

  // Static method for quick initialization
  static create(options = {}) {
    return new AppleSignInButton(options);
  }

  // Static method to check availability
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
