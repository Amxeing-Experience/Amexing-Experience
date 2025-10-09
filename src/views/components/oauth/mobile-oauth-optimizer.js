/* eslint-disable max-lines, no-console */
/**
 * Mobile OAuth Experience Optimizer - Sprint 04
 * Optimizes OAuth flows for mobile devices with enhanced UX
 * Integrates with component-based OAuth architecture.
 */

class MobileOAuthOptimizer {
  /**
   * Creates a new MobileOAuthOptimizer instance.
   * Initializes mobile optimization settings and device detection.
   * @class
   * @param {object} options - Configuration options for the optimizer.
   * @param {number} options.touchDelay - Delay for touch events in milliseconds.
   * @param {number} options.fastTapThreshold - Threshold for fast tap detection in milliseconds.
   * @param {boolean} options.vibrationEnabled - Enable haptic vibration feedback.
   * @param {boolean} options.adaptiveLoading - Enable adaptive loading experience.
   * @param {boolean} options.biometricSupport - Enable biometric authentication support.
   * @param {boolean} options.orientationAware - Enable orientation change handling.
   * @example
   * // Create optimizer with default settings
   * const optimizer = new MobileOAuthOptimizer();
   * @example
   * // Create optimizer with custom settings
   * const optimizer = new MobileOAuthOptimizer({
   *   touchDelay: 250,
   *   vibrationEnabled: false
   * });
   */
  constructor(options = {}) {
    this.options = {
      touchDelay: 300,
      fastTapThreshold: 200,
      vibrationEnabled: true,
      adaptiveLoading: true,
      biometricSupport: true,
      orientationAware: true,
      ...options,
    };

    this.isMobile = this.detectMobileDevice();
    this.isTablet = this.detectTabletDevice();
    this.orientation = this.detectOrientation();
    this.touchCapable = 'ontouchstart' in window;

    this.init();
  }

  /**
   * Initializes all mobile optimization features.
   * Sets up viewport, touch optimization, orientation handling, keyboard handling,
   * biometric support, and accessibility features for mobile devices.
   * @function init
   * @returns {void}
   * @example
   * // Called automatically in constructor
   * this.init();
   */
  init() {
    // Check if device is mobile or tablet
    if (!this.isMobile && !this.isTablet) return;

    this.setupViewport();
    this.optimizeLoadingExperience();
    this.setupTouchOptimization();
    this.setupOrientationHandling();
    this.setupKeyboardHandling();
    this.setupBiometricSupport();
    this.setupAccessibility();

    // eslint-disable-next-line no-console
  }

  /**
   * Detects if the current device is a mobile device.
   * Uses user agent string and viewport width to determine mobile status.
   * @function detectMobileDevice
   * @returns {boolean} - True if device is mobile, false otherwise.
   * @example
   * // Check if device is mobile
   * const isMobile = this.detectMobileDevice();
   * // Returns: true or false
   */
  detectMobileDevice() {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) || window.innerWidth <= 768
    );
  }

  /**
   * Detects if the current device is a tablet.
   * Uses user agent string and viewport width to determine tablet status.
   * @function detectTabletDevice
   * @returns {boolean} - True if device is a tablet, false otherwise.
   * @example
   * // Check if device is tablet
   * const isTablet = this.detectTabletDevice();
   * // Returns: true or false
   */
  detectTabletDevice() {
    return (
      /iPad|Android/i.test(navigator.userAgent)
      && window.innerWidth >= 768
      && window.innerWidth <= 1024
    );
  }

  /**
   * Detects the current device orientation.
   * Compares viewport height and width to determine orientation.
   * @function detectOrientation
   * @returns {string} - 'portrait' or 'landscape'.
   * @example
   * // Get current orientation
   * const orientation = this.detectOrientation();
   * // Returns: 'portrait' or 'landscape'
   */
  detectOrientation() {
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  /**
   * Gets the current device type classification.
   * Returns the device type based on detection results.
   * @function getDeviceType
   * @returns {string} - 'tablet', 'mobile', or 'desktop'.
   * @example
   * // Get device type
   * const deviceType = this.getDeviceType();
   * // Returns: 'tablet', 'mobile', or 'desktop'
   */
  getDeviceType() {
    if (this.isTablet) return 'tablet';
    if (this.isMobile) return 'mobile';
    return 'desktop';
  }

  /**
   * Sets up optimal viewport meta tag for mobile devices.
   * Creates or updates viewport meta tag with mobile-optimized settings.
   * @function setupViewport
   * @returns {void}
   * @example
   * // Setup viewport for mobile
   * this.setupViewport();
   */
  setupViewport() {
    let viewport = document.querySelector('meta[name="viewport"]');
    // Create viewport meta tag if it doesn't exist
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }

    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }

  /**
   * Optimizes the loading experience with a skeleton screen.
   * Creates and displays a skeleton loader until the page is fully loaded.
   * @function optimizeLoadingExperience
   * @returns {void}
   * @example
   * // Optimize loading with skeleton screen
   * this.optimizeLoadingExperience();
   */
  optimizeLoadingExperience() {
    // Check if adaptive loading is enabled
    if (!this.options.adaptiveLoading) return;

    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    const skeleton = this.createMobileLoadingSkeleton();
    oauthContainer.appendChild(skeleton);

    /**
     * Removes the loading skeleton from the DOM.
     * Checks if skeleton exists and has a parent node before removal.
     * @function removeLoading
     * @returns {void}
     * @inner
     * @example
     * // Automatically called when page loads
     * removeLoading();
     */
    const removeLoading = () => {
      if (skeleton && skeleton.parentNode) {
        skeleton.remove();
      }
    };

    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(removeLoading, 100);
    });

    window.addEventListener('load', removeLoading);
  }

  /**
   * Creates a mobile-optimized skeleton loading screen.
   * Generates skeleton elements with animated placeholders for OAuth components.
   * @function createMobileLoadingSkeleton
   * @returns {HTMLElement} - The skeleton container element with styles.
   * @example
   * // Create skeleton loader
   * const skeleton = this.createMobileLoadingSkeleton();
   * // Returns: HTMLElement with loading animation
   */
  createMobileLoadingSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'oauth-mobile-skeleton';
    skeleton.innerHTML = `
            <div class="skeleton-header"></div>
            <div class="skeleton-providers">
                <div class="skeleton-provider"></div>
                <div class="skeleton-provider"></div>
                <div class="skeleton-provider"></div>
            </div>
            <div class="skeleton-form">
                <div class="skeleton-input"></div>
                <div class="skeleton-button"></div>
            </div>
        `;

    const style = document.createElement('style');
    style.textContent = `
            .oauth-mobile-skeleton {
                padding: 20px;
                animation: fadeIn 0.3s ease-in;
            }
            .oauth-mobile-skeleton > div {
                background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                background-size: 200% 100%;
                animation: loading 1.5s infinite;
                border-radius: 8px;
                margin-bottom: 16px;
            }
            .skeleton-header { height: 32px; }
            .skeleton-provider { height: 48px; margin-bottom: 12px; }
            .skeleton-input { height: 44px; }
            .skeleton-button { height: 48px; }
            @keyframes loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
    document.head.appendChild(style);

    return skeleton;
  }

  /**
   * Sets up comprehensive touch optimization for mobile devices.
   * Configures touch targets, fast tap handling, feedback, and prevents callouts.
   * @function setupTouchOptimization
   * @returns {void}
   * @example
   * // Setup touch optimizations
   * this.setupTouchOptimization();
   */
  setupTouchOptimization() {
    // Check if device supports touch
    if (!this.touchCapable) return;

    this.optimizeButtonTouchTargets();
    this.setupFastTapHandling();
    this.setupTouchFeedback();
    this.preventTouchCallouts();
  }

  /**
   * Optimizes button sizes for mobile touch targets.
   * Ensures all buttons meet minimum 44px height for accessibility.
   * @function optimizeButtonTouchTargets
   * @returns {void}
   * @example
   * // Optimize all button touch targets
   * this.optimizeButtonTouchTargets();
   */
  optimizeButtonTouchTargets() {
    const buttons = document.querySelectorAll(
      '.oauth-btn, .btn, button[type="submit"]'
    );
    buttons.forEach((button) => {
      const computedStyle = window.getComputedStyle(button);
      const minSize = 44;

      // Ensure minimum height of 44px
      if (parseInt(computedStyle.height) < minSize) {
        button.style.minHeight = `${minSize}px`;
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
      }

      // Ensure adequate padding
      if (
        parseInt(computedStyle.paddingTop)
          + parseInt(computedStyle.paddingBottom)
        < 12
      ) {
        button.style.padding = `12px ${computedStyle.paddingLeft || '16px'}`;
      }
    });
  }

  /**
   * Sets up fast tap handling to reduce touch delay.
   * Implements custom touch event handlers for responsive button interactions.
   * @function setupFastTapHandling
   * @returns {void}
   * @example
   * // Setup fast tap handling
   * this.setupFastTapHandling();
   */
  setupFastTapHandling() {
    let touchStartTime = 0;
    let touchStartTarget = null;

    document.addEventListener(
      'touchstart',
      (e) => {
        touchStartTime = Date.now();
        touchStartTarget = e.target.closest('.oauth-btn, .btn, button');

        if (touchStartTarget) {
          touchStartTarget.classList.add('touch-active');
        }
      },
      { passive: true }
    );

    document.addEventListener(
      'touchend',
      (e) => {
        const touchEndTime = Date.now();
        const touchDuration = touchEndTime - touchStartTime;

        if (touchStartTarget) {
          setTimeout(() => {
            touchStartTarget.classList.remove('touch-active');
          }, 150);
        }

        // Trigger fast tap if duration is below threshold
        if (touchDuration < this.options.fastTapThreshold && touchStartTarget) {
          e.preventDefault();
          this.triggerFastTap(touchStartTarget);
        }
      },
      { passive: false }
    );

    document.addEventListener('touchcancel', () => {
      if (touchStartTarget) {
        touchStartTarget.classList.remove('touch-active');
      }
    });
  }

  /**
   * Triggers a fast tap action with optional haptic feedback.
   * Provides vibration feedback and executes click on the element.
   * @function triggerFastTap
   * @param {HTMLElement} element - The element to trigger the tap on.
   * @returns {void}
   * @example
   * // Trigger fast tap on button
   * this.triggerFastTap(buttonElement);
   */
  triggerFastTap(element) {
    // Provide haptic feedback if enabled
    if (this.options.vibrationEnabled && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }

    element.click();
  }

  /**
   * Sets up visual touch feedback for buttons.
   * Applies CSS styles for touch-active states and hover prevention on touch devices.
   * @function setupTouchFeedback
   * @returns {void}
   * @example
   * // Setup touch feedback styles
   * this.setupTouchFeedback();
   */
  setupTouchFeedback() {
    const style = document.createElement('style');
    style.textContent = `
            .oauth-btn.touch-active,
            .btn.touch-active,
            button.touch-active {
                transform: scale(0.98);
                opacity: 0.8;
                transition: all 0.1s ease;
            }

            @media (hover: none) and (pointer: coarse) {
                .oauth-btn:hover,
                .btn:hover,
                button:hover {
                    transform: none;
                    opacity: 1;
                }
            }
        `;
    document.head.appendChild(style);
  }

  /**
   * Prevents touch callouts and unwanted text selection.
   * Disables text selection except for input and textarea elements.
   * @function preventTouchCallouts
   * @returns {void}
   * @example
   * // Prevent touch callouts
   * this.preventTouchCallouts();
   */
  preventTouchCallouts() {
    const style = document.createElement('style');
    style.textContent = `
            .oauth-container,
            .oauth-container * {
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
            }

            .oauth-container input,
            .oauth-container textarea {
                -webkit-user-select: text;
                -moz-user-select: text;
                -ms-user-select: text;
                user-select: text;
            }
        `;
    document.head.appendChild(style);
  }

  /**
   * Sets up orientation change detection and handling.
   * Listens for orientation and resize events to adjust UI accordingly.
   * @function setupOrientationHandling
   * @returns {void}
   * @example
   * // Setup orientation handling
   * this.setupOrientationHandling();
   */
  setupOrientationHandling() {
    // Check if orientation awareness is enabled
    if (!this.options.orientationAware) return;

    /**
     * Handles orientation change events.
     * Detects new orientation and adjusts UI if orientation has changed.
     * @function handleOrientationChange
     * @returns {void}
     * @inner
     * @example
     * // Called automatically on orientation change
     * handleOrientationChange();
     */
    const handleOrientationChange = () => {
      const newOrientation = this.detectOrientation();
      if (newOrientation !== this.orientation) {
        this.orientation = newOrientation;
        this.adjustForOrientation(newOrientation);
      }
    };

    window.addEventListener('orientationchange', () => {
      setTimeout(handleOrientationChange, 100);
    });

    window.addEventListener('resize', handleOrientationChange);

    this.adjustForOrientation(this.orientation);
  }

  /**
   * Adjusts UI layout based on device orientation.
   * Applies orientation-specific CSS classes and optimizations.
   * @function adjustForOrientation
   * @param {string} orientation - The current orientation ('portrait' or 'landscape').
   * @returns {void}
   * @example
   * // Adjust for landscape orientation
   * this.adjustForOrientation('landscape');
   */
  adjustForOrientation(orientation) {
    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    oauthContainer.classList.remove('portrait', 'landscape');
    oauthContainer.classList.add(orientation);

    // Apply orientation-specific optimizations
    if (orientation === 'landscape' && this.isMobile) {
      this.optimizeForLandscape();
    } else {
      this.optimizeForPortrait();
    }
  }

  /**
   * Optimizes UI for landscape orientation.
   * Applies landscape-specific CSS styles for compact layout.
   * @function optimizeForLandscape
   * @returns {void}
   * @example
   * // Optimize for landscape mode
   * this.optimizeForLandscape();
   */
  optimizeForLandscape() {
    const style = document.createElement('style');
    style.id = 'oauth-landscape-optimizations';

    // Remove existing landscape styles if present
    const existingStyle = document.getElementById(
      'oauth-landscape-optimizations'
    );
    if (existingStyle) existingStyle.remove();

    style.textContent = `
            @media screen and (orientation: landscape) and (max-height: 500px) {
                .oauth-container.landscape {
                    padding: 10px 20px;
                    max-height: 90vh;
                    overflow-y: auto;
                }

                .oauth-providers.landscape {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }

                .oauth-btn.landscape {
                    flex: 1;
                    min-width: calc(50% - 4px);
                    padding: 8px 12px;
                    font-size: 14px;
                }

                .oauth-header.landscape h1,
                .oauth-header.landscape h2 {
                    font-size: 1.2rem;
                    margin-bottom: 8px;
                }
            }
        `;
    document.head.appendChild(style);
  }

  /**
   * Optimizes UI for portrait orientation.
   * Removes landscape-specific styles to restore default layout.
   * @function optimizeForPortrait
   * @returns {void}
   * @example
   * // Optimize for portrait mode
   * this.optimizeForPortrait();
   */
  optimizeForPortrait() {
    const landscapeStyle = document.getElementById(
      'oauth-landscape-optimizations'
    );
    if (landscapeStyle) {
      landscapeStyle.remove();
    }
  }

  /**
   * Sets up keyboard appearance detection and handling.
   * Detects virtual keyboard visibility and adjusts UI accordingly.
   * @function setupKeyboardHandling
   * @returns {void}
   * @example
   * // Setup keyboard handling
   * this.setupKeyboardHandling();
   */
  setupKeyboardHandling() {
    const initialViewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;
    let keyboardVisible = false;

    /**
     * Handles viewport size changes to detect keyboard visibility.
     * Monitors viewport height changes and triggers keyboard adjustments
     * when the height difference exceeds 150px threshold.
     * @function handleViewportChange
     * @returns {void}
     * @inner
     * @example
     * // Called automatically on viewport resize
     * handleViewportChange();
     */
    const handleViewportChange = () => {
      const currentHeight = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;
      const heightDifference = initialViewportHeight - currentHeight;

      const wasKeyboardVisible = _keyboardVisible; // eslint-disable-line no-undef
      keyboardVisible = heightDifference > 150;

      // Adjust UI when keyboard visibility changes
      if (keyboardVisible && !wasKeyboardVisible) {
        this.adjustForKeyboard(true);
      } else if (!keyboardVisible && wasKeyboardVisible) {
        this.adjustForKeyboard(false);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
    } else {
      window.addEventListener('resize', handleViewportChange);
    }

    document.addEventListener('focusin', (e) => {
      if (e.target.matches('input, textarea, select')) {
        setTimeout(() => this.scrollToInput(e.target), 300);
      }
    });
  }

  /**
   * Adjusts UI when virtual keyboard appears or disappears.
   * Adds or removes CSS classes to handle keyboard visibility.
   * @function adjustForKeyboard
   * @param {boolean} visible - True if keyboard is visible, false otherwise.
   * @returns {void}
   * @example
   * // Adjust UI for keyboard visibility
   * this.adjustForKeyboard(true);
   */
  adjustForKeyboard(visible) {
    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    // Add or remove keyboard visibility classes
    if (visible) {
      oauthContainer.classList.add('keyboard-visible');
      document.body.classList.add('oauth-keyboard-active');
    } else {
      oauthContainer.classList.remove('keyboard-visible');
      document.body.classList.remove('oauth-keyboard-active');
    }
  }

  /**
   * Scrolls to an input element when it receives focus.
   * Ensures input is visible above the virtual keyboard.
   * @function scrollToInput
   * @param {HTMLElement} inputElement - The input element to scroll to.
   * @returns {void}
   * @example
   * // Scroll to input field
   * this.scrollToInput(inputElement);
   */
  scrollToInput(inputElement) {
    if (!inputElement || !this.isMobile) return;

    const rect = inputElement.getBoundingClientRect();
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    // Scroll if input is below 60% of viewport height
    if (rect.bottom > viewportHeight * 0.6) {
      inputElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }

  /**
   * Sets up biometric authentication support.
   * Detects device biometric capabilities if enabled.
   * @function setupBiometricSupport
   * @returns {void}
   * @example
   * // Setup biometric support
   * this.setupBiometricSupport();
   */
  setupBiometricSupport() {
    // Check if biometric support is enabled and available
    if (!this.options.biometricSupport || !('credentials' in navigator)) return;

    this.detectBiometricCapabilities();
  }

  /**
   * Detects if biometric authentication is available on the device.
   * Checks for platform authenticator support and adds biometric option if available.
   * @async
   * @function detectBiometricCapabilities
   * @returns {Promise<void>}
   * @example
   * // Detect biometric capabilities
   * await this.detectBiometricCapabilities();
   */
  async detectBiometricCapabilities() {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (available) {
        this.addBiometricOption();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('Biometric detection not supported:', error);
    }
  }

  /**
   * Adds a biometric authentication button to the OAuth interface.
   * Creates and appends a biometric login option to the providers container.
   * @function addBiometricOption
   * @returns {void}
   * @example
   * // Add biometric option button
   * this.addBiometricOption();
   */
  addBiometricOption() {
    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    const providersContainer = oauthContainer?.querySelector('.oauth-providers');

    if (!providersContainer) return;

    const biometricBtn = document.createElement('button');
    biometricBtn.className = 'oauth-btn biometric-auth';
    biometricBtn.innerHTML = `
            <span class="oauth-btn-icon">👆</span>
            <span class="oauth-btn-text">Use Biometric</span>
        `;

    biometricBtn.addEventListener('click', () => {
      this.initiateBiometricAuth();
    });

    providersContainer.appendChild(biometricBtn);
  }

  /**
   * Initiates biometric authentication flow.
   * Placeholder method for biometric authentication implementation.
   * @async
   * @function initiateBiometricAuth
   * @returns {Promise<void>}
   * @example
   * // Initiate biometric authentication
   * await this.initiateBiometricAuth();
   */
  async initiateBiometricAuth() {
    // eslint-disable-next-line no-console
    console.log('Biometric authentication would be initiated here');
  }

  /**
   * Sets up accessibility features for OAuth interface.
   * Implements reduced motion, dark mode support, focus indicators, and ARIA labels.
   * @function setupAccessibility
   * @returns {void}
   * @example
   * // Setup accessibility features
   * this.setupAccessibility();
   */
  setupAccessibility() {
    const style = document.createElement('style');
    style.textContent = `
            @media (prefers-reduced-motion: reduce) {
                .oauth-container *,
                .oauth-container *::before,
                .oauth-container *::after {
                    animation-duration: 0.01ms !important;
                    animation-iteration-count: 1 !important;
                    transition-duration: 0.01ms !important;
                }
            }

            @media (prefers-color-scheme: dark) {
                .oauth-container {
                    color-scheme: dark;
                }
            }

            .oauth-btn:focus-visible {
                outline: 2px solid #007AFF;
                outline-offset: 2px;
            }

            @media (max-width: 768px) {
                .oauth-container {
                    font-size: 16px;
                }

                .oauth-btn {
                    font-size: 16px;
                    line-height: 1.4;
                }

                input, textarea, select {
                    font-size: 16px;
                }
            }
        `;
    document.head.appendChild(style);

    this.addAriaLabels();
    this.setupKeyboardNavigation();
  }

  /**
   * Adds ARIA labels to OAuth buttons for screen readers.
   * Enhances accessibility by providing descriptive labels for authentication buttons.
   * @function addAriaLabels
   * @returns {void}
   * @example
   * // Add ARIA labels to buttons
   * this.addAriaLabels();
   */
  addAriaLabels() {
    const oauthButtons = document.querySelectorAll('.oauth-btn');
    oauthButtons.forEach((button) => {
      const provider = button.dataset.provider || 'Unknown';
      if (!button.getAttribute('aria-label')) {
        button.setAttribute('aria-label', `Sign in with ${provider}`);
      }
    });
  }

  /**
   * Sets up keyboard navigation indicators.
   * Adds visual indicators when user navigates with keyboard.
   * @function setupKeyboardNavigation
   * @returns {void}
   * @example
   * // Setup keyboard navigation
   * this.setupKeyboardNavigation();
   */
  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        document.body.classList.add('keyboard-navigation');
      }
    });

    document.addEventListener('mousedown', () => {
      document.body.classList.remove('keyboard-navigation');
    });
  }

  /**
   * Optimizes overall performance for mobile OAuth experience.
   * Registers service worker, preloads resources, optimizes images, and defers scripts.
   * @function optimizePerformance
   * @returns {void}
   * @example
   * // Optimize performance
   * this.optimizePerformance();
   */
  optimizePerformance() {
    // Register service worker if supported
    if ('serviceWorker' in navigator) {
      this.registerOAuthServiceWorker();
    }

    this.preloadCriticalResources();
    this.optimizeImages();
    this.deferNonCriticalScripts();
  }

  /**
   * Registers the OAuth service worker for offline support.
   * Attempts to register service worker and logs the result.
   * @async
   * @function registerOAuthServiceWorker
   * @returns {Promise<void>}
   * @example
   * // Register service worker
   * await this.registerOAuthServiceWorker();
   */
  async registerOAuthServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/oauth-sw.js');
      // eslint-disable-next-line no-console
      console.log('OAuth ServiceWorker registered:', registration);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('ServiceWorker registration failed:', error);
    }
  }

  /**
   * Preloads critical resources for faster page load.
   * Creates preload links for essential CSS and JavaScript files.
   * @function preloadCriticalResources
   * @returns {void}
   * @example
   * // Preload critical resources
   * this.preloadCriticalResources();
   */
  preloadCriticalResources() {
    const criticalResources = [
      '/assets/css/oauth-mobile.css',
      '/assets/js/oauth-provider.js',
    ];

    criticalResources.forEach((resource) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = resource;
      link.as = resource.endsWith('.css') ? 'style' : 'script';
      document.head.appendChild(link);
    });
  }

  /**
   * Optimizes images for better performance.
   * Applies lazy loading and async decoding to OAuth images.
   * @function optimizeImages
   * @returns {void}
   * @example
   * // Optimize all images
   * this.optimizeImages();
   */
  optimizeImages() {
    const images = document.querySelectorAll(
      '.oauth-provider-logo , .oauth-btn img'
    );

    images.forEach((img) => {
      if (!img.loading) {
        img.loading = 'lazy';
      }

      if (!img.decoding) {
        img.decoding = 'async';
      }
    });
  }

  /**
   * Defers non-critical scripts on mobile devices.
   * Adds defer attribute to scripts marked as non-critical for mobile.
   * @function deferNonCriticalScripts
   * @returns {void}
   * @example
   * // Defer non-critical scripts
   * this.deferNonCriticalScripts();
   */
  deferNonCriticalScripts() {
    const nonCriticalScripts = document.querySelectorAll(
      'script[data-defer-mobile]'
    );

    // Apply defer only on mobile or tablet devices
    if (this.isMobile || this.isTablet) {
      nonCriticalScripts.forEach((script) => {
        script.defer = true;
      });
    }
  }

  /**
   * Gets current optimization metrics and device information.
   * Returns comprehensive data about device capabilities and active optimizations.
   * @function getOptimizationMetrics
   * @returns {object} Metrics object containing device info and optimization status.
   * @property {string} deviceType - Device type (mobile/tablet/desktop).
   * @property {string} orientation - Current orientation (portrait/landscape).
   * @property {boolean} touchCapable - Touch capability status.
   * @property {boolean} biometricAvailable - Biometric availability status.
   * @property {object} viewportSize - Viewport dimensions.
   * @property {object} optimizationsActive - Active optimization features.
   * @example
   * // Get optimization metrics
   * const metrics = this.getOptimizationMetrics();
   * // Returns: { deviceType: 'mobile', orientation: 'portrait', ... }
   */
  getOptimizationMetrics() {
    return {
      deviceType: this.getDeviceType(),
      orientation: this.orientation,
      touchCapable: this.touchCapable,
      biometricAvailable: 'credentials' in navigator,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      optimizationsActive: {
        touchOptimization: this.touchCapable,
        orientationHandling: this.options.orientationAware,
        keyboardHandling: true,
        accessibilityEnhanced: true,
      },
    };
  }

  /**
   * Destroys the optimizer and cleans up resources.
   * Removes all dynamically created styles and cleans up the DOM.
   * @function destroy
   * @returns {void}
   * @example
   * // Destroy optimizer instance
   * optimizer.destroy();
   */
  destroy() {
    const styles = document.querySelectorAll(
      'style[id*="oauth-"], style[id*="mobile-oauth"]'
    );
    styles.forEach((style) => style.remove());

    // eslint-disable-next-line no-console
    console.log('Mobile OAuth Optimizer destroyed');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileOAuthOptimizer;
} else if (typeof window !== 'undefined') {
  window.MobileOAuthOptimizer = MobileOAuthOptimizer;
}
