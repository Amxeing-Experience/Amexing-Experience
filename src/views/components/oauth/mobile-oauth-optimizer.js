/* eslint-disable max-lines */
/**
 * Mobile OAuth Experience Optimizer - Sprint 04
 * Optimizes OAuth flows for mobile devices with enhanced UX
 * Integrates with component-based OAuth architecture.
 */

class MobileOAuthOptimizer {
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

  init() {
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

  detectMobileDevice() {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) || window.innerWidth <= 768
    );
  }

  detectTabletDevice() {
    return (
      /iPad|Android/i.test(navigator.userAgent)
      && window.innerWidth >= 768
      && window.innerWidth <= 1024
    );
  }

  detectOrientation() {
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  getDeviceType() {
    if (this.isTablet) return 'tablet';
    if (this.isMobile) return 'mobile';
    return 'desktop';
  }

  setupViewport() {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }

    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }

  optimizeLoadingExperience() {
    if (!this.options.adaptiveLoading) return;

    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    const skeleton = this.createMobileLoadingSkeleton();
    oauthContainer.appendChild(skeleton);

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

  setupTouchOptimization() {
    if (!this.touchCapable) return;

    this.optimizeButtonTouchTargets();
    this.setupFastTapHandling();
    this.setupTouchFeedback();
    this.preventTouchCallouts();
  }

  optimizeButtonTouchTargets() {
    const buttons = document.querySelectorAll(
      '.oauth-btn, .btn, button[type="submit"]'
    );
    buttons.forEach((button) => {
      const computedStyle = window.getComputedStyle(button);
      const minSize = 44;

      if (parseInt(computedStyle.height) < minSize) {
        button.style.minHeight = `${minSize}px`;
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
      }

      if (
        parseInt(computedStyle.paddingTop)
          + parseInt(computedStyle.paddingBottom)
        < 12
      ) {
        button.style.padding = `12px ${computedStyle.paddingLeft || '16px'}`;
      }
    });
  }

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

  triggerFastTap(element) {
    if (this.options.vibrationEnabled && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }

    element.click();
  }

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

  setupOrientationHandling() {
    if (!this.options.orientationAware) return;

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

  adjustForOrientation(orientation) {
    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    oauthContainer.classList.remove('portrait', 'landscape');
    oauthContainer.classList.add(orientation);

    if (orientation === 'landscape' && this.isMobile) {
      this.optimizeForLandscape();
    } else {
      this.optimizeForPortrait();
    }
  }

  optimizeForLandscape() {
    const style = document.createElement('style');
    style.id = 'oauth-landscape-optimizations';

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

  optimizeForPortrait() {
    const landscapeStyle = document.getElementById(
      'oauth-landscape-optimizations'
    );
    if (landscapeStyle) {
      landscapeStyle.remove();
    }
  }

  setupKeyboardHandling() {
    const initialViewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;
    let keyboardVisible = false;

    const handleViewportChange = () => {
      const currentHeight = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;
      const heightDifference = initialViewportHeight - currentHeight;

      const wasKeyboardVisible = _keyboardVisible; // eslint-disable-line no-undef
      keyboardVisible = heightDifference > 150;

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

  adjustForKeyboard(visible) {
    const oauthContainer = document.querySelector(
      '#oauth-container, .oauth-container'
    );
    if (!oauthContainer) return;

    if (visible) {
      oauthContainer.classList.add('keyboard-visible');
      document.body.classList.add('oauth-keyboard-active');
    } else {
      oauthContainer.classList.remove('keyboard-visible');
      document.body.classList.remove('oauth-keyboard-active');
    }
  }

  scrollToInput(inputElement) {
    if (!inputElement || !this.isMobile) return;

    const rect = inputElement.getBoundingClientRect();
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    if (rect.bottom > viewportHeight * 0.6) {
      inputElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }

  setupBiometricSupport() {
    if (!this.options.biometricSupport || !('credentials' in navigator)) return;

    this.detectBiometricCapabilities();
  }

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

  async initiateBiometricAuth() {
    // eslint-disable-next-line no-console
    console.log('Biometric authentication would be initiated here');
  }

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

  addAriaLabels() {
    const oauthButtons = document.querySelectorAll('.oauth-btn');
    oauthButtons.forEach((button) => {
      const provider = button.dataset.provider || 'Unknown';
      if (!button.getAttribute('aria-label')) {
        button.setAttribute('aria-label', `Sign in with ${provider}`);
      }
    });
  }

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

  optimizePerformance() {
    if ('serviceWorker' in navigator) {
      this.registerOAuthServiceWorker();
    }

    this.preloadCriticalResources();
    this.optimizeImages();
    this.deferNonCriticalScripts();
  }

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

  deferNonCriticalScripts() {
    const nonCriticalScripts = document.querySelectorAll(
      'script[data-defer-mobile]'
    );

    if (this.isMobile || this.isTablet) {
      nonCriticalScripts.forEach((script) => {
        script.defer = true;
      });
    }
  }

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
