/**
 * Image Optimization Client-Side Helper
 * 
 * Handles dynamic image loading with format detection and performance monitoring
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

class ImageOptimization {
  constructor() {
    this.supportedFormats = this.detectSupportedFormats();
    this.performanceMetrics = [];
    this.observer = null;
    this.init();
  }

  /**
   * Initialize the image optimization system
   */
  init() {
    // Set up Intersection Observer for lazy loading
    this.setupLazyLoading();
    
    // Monitor performance
    this.setupPerformanceMonitoring();
    
    // Handle format fallbacks
    this.setupFormatFallbacks();
    
    console.log('Image optimization initialized', {
      supportedFormats: this.supportedFormats
    });
  }

  /**
   * Detect browser support for image formats
   */
  detectSupportedFormats() {
    const formats = {
      avif: false,
      webp: false,
      jpeg: true // Always supported
    };

    // Check AVIF support
    const avifTest = new Image();
    avifTest.onload = () => { formats.avif = true; };
    avifTest.onerror = () => { formats.avif = false; };
    avifTest.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMgwf8AAAWAAAAACvJ+o=';

    // Check WebP support
    const webpTest = new Image();
    webpTest.onload = () => { formats.webp = true; };
    webpTest.onerror = () => { formats.webp = false; };
    webpTest.src = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

    // Store in session for quick access
    setTimeout(() => {
      sessionStorage.setItem('supportedImageFormats', JSON.stringify(formats));
    }, 100);

    return formats;
  }

  /**
   * Set up lazy loading with Intersection Observer
   */
  setupLazyLoading() {
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.loadImage(entry.target);
            this.observer.unobserve(entry.target);
          }
        });
      }, {
        rootMargin: '50px 0px',
        threshold: 0.01
      });

      // Observe all lazy images
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        this.observer.observe(img);
      });
    }
  }

  /**
   * Load an image with optimal format
   */
  loadImage(img) {
    const picture = img.closest('picture');
    if (!picture) return;

    // Start performance timing
    const startTime = performance.now();
    
    // Find best source based on format support
    const sources = picture.querySelectorAll('source');
    let selectedSource = null;

    sources.forEach(source => {
      const type = source.getAttribute('type');
      if (type === 'image/avif' && this.supportedFormats.avif) {
        selectedSource = source;
      } else if (type === 'image/webp' && this.supportedFormats.webp && !selectedSource) {
        selectedSource = source;
      }
    });

    // Apply selected source if found
    if (selectedSource) {
      const srcset = selectedSource.getAttribute('srcset');
      if (srcset) {
        img.srcset = srcset;
      }
    }

    // Track loading performance
    img.addEventListener('load', () => {
      const loadTime = performance.now() - startTime;
      this.recordMetric({
        type: 'image-load',
        format: selectedSource ? selectedSource.getAttribute('type') : 'jpeg',
        loadTime: loadTime,
        size: img.naturalWidth + 'x' + img.naturalHeight
      });
    });
  }

  /**
   * Set up format fallback handling
   */
  setupFormatFallbacks() {
    document.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') {
        this.handleImageError(e.target);
      }
    }, true);
  }

  /**
   * Handle image loading errors with fallbacks
   */
  handleImageError(img) {
    const fallbacks = [
      img.dataset.fallbackWebp,
      img.dataset.fallbackJpeg,
      '/img/amexing_logo_horizontal.avif'
    ];

    for (const fallback of fallbacks) {
      if (fallback && fallback !== img.src) {
        console.warn('Image failed to load, trying fallback', {
          failed: img.src,
          fallback: fallback
        });
        
        img.src = fallback;
        break;
      }
    }
  }

  /**
   * Set up performance monitoring
   */
  setupPerformanceMonitoring() {
    // Monitor LCP (Largest Contentful Paint)
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            if (entry.element?.tagName === 'IMG') {
              this.recordMetric({
                type: 'lcp',
                value: entry.startTime,
                element: entry.element.src
              });
            }
          });
        });
        
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) {
        console.warn('LCP monitoring not supported');
      }
    }

    // Monitor total image bytes
    this.calculateImageBytes();
  }

  /**
   * Calculate total image bytes loaded
   */
  calculateImageBytes() {
    if ('performance' in window && performance.getEntriesByType) {
      const resources = performance.getEntriesByType('resource');
      const imageResources = resources.filter(r => 
        r.initiatorType === 'img' || 
        r.name.match(/\.(jpg|jpeg|png|webp|avif)$/i)
      );

      const totalBytes = imageResources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      
      this.recordMetric({
        type: 'total-image-bytes',
        value: totalBytes,
        count: imageResources.length
      });
    }
  }

  /**
   * Record performance metric
   */
  recordMetric(metric) {
    metric.timestamp = Date.now();
    this.performanceMetrics.push(metric);

    // Send to analytics if configured
    if (window.analytics && window.analytics.track) {
      window.analytics.track('Image Performance', metric);
    }

    // Log in development
    if (window.location.hostname === 'localhost') {
      console.log('Image metric:', metric);
    }
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const summary = {
      supportedFormats: this.supportedFormats,
      metrics: this.performanceMetrics,
      averageLoadTime: 0,
      totalBytes: 0,
      imageCount: 0
    };

    const loadMetrics = this.performanceMetrics.filter(m => m.type === 'image-load');
    if (loadMetrics.length > 0) {
      summary.averageLoadTime = loadMetrics.reduce((sum, m) => sum + m.loadTime, 0) / loadMetrics.length;
      summary.imageCount = loadMetrics.length;
    }

    const bytesMetric = this.performanceMetrics.find(m => m.type === 'total-image-bytes');
    if (bytesMetric) {
      summary.totalBytes = bytesMetric.value;
    }

    return summary;
  }

  /**
   * Preload critical images
   */
  preloadCriticalImages(urls) {
    urls.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = url;
      
      // Detect format from URL and set type
      if (url.includes('.avif')) {
        link.type = 'image/avif';
      } else if (url.includes('.webp')) {
        link.type = 'image/webp';
      }
      
      document.head.appendChild(link);
    });
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.imageOptimization = new ImageOptimization();
  });
} else {
  window.imageOptimization = new ImageOptimization();
}