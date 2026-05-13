/**
 * Experiences Dashboard Mobile JavaScript
 * Handles mobile interactions and responsive behavior for experiences management
 * Created by Denisse Maldonado
 */

(function() {
    'use strict';

    // Mobile breakpoint constants
    const MOBILE_BREAKPOINT = 992;
    const TABLET_BREAKPOINT = 768;
    const SMALL_PHONE_BREAKPOINT = 576;

    // Global state
    let currentSection = 'experiences';
    let isInitialized = false;
    let touchStartY = 0;
    let scrollThreshold = 10;

    // Check if mobile device
    function isMobile() {
        return window.innerWidth < MOBILE_BREAKPOINT;
    }

    function isTablet() {
        return window.innerWidth < TABLET_BREAKPOINT;
    }

    function isSmallPhone() {
        return window.innerWidth < SMALL_PHONE_BREAKPOINT;
    }

    /**
     * Initialize mobile experiences dashboard
     */
    function initMobileExperiences() {
        if (!isMobile() || isInitialized) return;

        console.log('Initializing mobile experiences dashboard...');
        
        // Initialize core components
        initMobileNavigation();
        initTabSwitching();
        initFloatingActionButton();
        initTouchOptimizations();
        initScrollBehaviors();
        initSwipeGestures();
        initSearchAndFilters();
        initResponsiveImages();
        initNotifications();

        // Mark as initialized
        isInitialized = true;
        console.log('Mobile experiences dashboard initialized successfully');

        // Trigger custom event
        document.dispatchEvent(new CustomEvent('mobileExperiencesInitialized'));
    }

    /**
     * Initialize mobile navigation behaviors
     */
    function initMobileNavigation() {
        const backBtn = document.querySelector('.mobile-back-btn');
        
        if (backBtn) {
            backBtn.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Add haptic feedback if supported
                vibrate(10);
                
                // Navigate back with smooth transition
                if (window.history.length > 1) {
                    window.history.back();
                } else {
                    // Fallback to admin dashboard
                    window.location.href = '/dashboard/admin';
                }
            });
        }

        // Add page visibility handlers
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                pauseMobileFeatures();
            } else {
                resumeMobileFeatures();
            }
        });
    }

    /**
     * Initialize tab switching with smooth transitions
     */
    function initTabSwitching() {
        const tabs = document.querySelectorAll('.mobile-tab');
        const tabContainer = document.querySelector('.mobile-tab-container');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', function(e) {
                // Add loading state
                showTabLoadingState(this);
                
                // Add haptic feedback
                vibrate(5);
                
                // Update active state immediately for better UX
                updateActiveTab(this);
            });
        });

        // Auto-scroll to active tab on load
        setTimeout(() => {
            scrollToActiveTab();
        }, 300);

        // Handle tab container scroll indicators
        if (tabContainer) {
            addScrollIndicators(tabContainer);
        }
    }

    /**
     * Update active tab state
     */
    function updateActiveTab(activeTab) {
        const allTabs = document.querySelectorAll('.mobile-tab');
        
        allTabs.forEach(tab => {
            tab.classList.remove('active');
            tab.style.transform = '';
        });
        
        activeTab.classList.add('active');
        
        // Add subtle animation
        activeTab.style.transform = 'scale(1.02)';
        setTimeout(() => {
            activeTab.style.transform = '';
        }, 200);
    }

    /**
     * Show tab loading state
     */
    function showTabLoadingState(tab) {
        const originalContent = tab.innerHTML;
        const loader = '<div class="tab-loader"><div class="loading-spinner" style="width: 16px; height: 16px; margin: 0;"></div></div>';
        
        tab.innerHTML = loader;
        
        // Restore content after a short delay (simulating loading)
        setTimeout(() => {
            tab.innerHTML = originalContent;
        }, 500);
    }

    /**
     * Scroll to active tab
     */
    function scrollToActiveTab() {
        const activeTab = document.querySelector('.mobile-tab.active');
        const tabContainer = document.querySelector('.mobile-tab-container');
        
        if (activeTab && tabContainer) {
            const tabRect = activeTab.getBoundingClientRect();
            const containerRect = tabContainer.getBoundingClientRect();
            const scrollLeft = activeTab.offsetLeft - (containerRect.width / 2) + (tabRect.width / 2);
            
            tabContainer.scrollTo({
                left: scrollLeft,
                behavior: 'smooth'
            });
        }
    }

    /**
     * Initialize floating action button
     */
    function initFloatingActionButton() {
        const fab = document.querySelector('.fab-button');
        const fabContainer = document.querySelector('.mobile-fab');
        let fabTimeout;
        
        if (fab) {
            // Add click handler
            fab.addEventListener('click', function() {
                vibrate(15);
                handleFabAction();
            });

            // Auto-hide on scroll
            let lastScrollTop = 0;
            const handleScroll = throttle(function() {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                
                if (scrollTop > lastScrollTop && scrollTop > 100) {
                    // Scrolling down - hide FAB
                    fabContainer.style.transform = 'translateY(80px)';
                    fabContainer.style.opacity = '0.7';
                } else {
                    // Scrolling up - show FAB
                    fabContainer.style.transform = 'translateY(0)';
                    fabContainer.style.opacity = '1';
                }
                
                lastScrollTop = scrollTop;
            }, 100);

            window.addEventListener('scroll', handleScroll);
        }
    }

    /**
     * Handle FAB action based on current section
     */
    function handleFabAction() {
        const currentSectionElement = document.querySelector('.mobile-section:not([style*="display: none"])');
        
        if (currentSectionElement) {
            const sectionId = currentSectionElement.id;
            
            switch (sectionId) {
                case 'experiences-section':
                    showAddExperienceModal();
                    break;
                case 'providers-section':
                    showAddProviderModal();
                    break;
                case 'establishments-section':
                    showAddEstablishmentModal();
                    break;
                default:
                    showGenericAddModal();
            }
        }
    }

    /**
     * Initialize touch optimizations
     */
    function initTouchOptimizations() {
        // Add touch classes
        document.body.classList.add('touch-device');
        
        // Optimize button interactions
        const buttons = document.querySelectorAll('button, .btn, .mobile-tab');
        
        buttons.forEach(button => {
            // Add touch start/end handlers for better feedback
            button.addEventListener('touchstart', function() {
                this.classList.add('touching');
            });
            
            button.addEventListener('touchend', function() {
                setTimeout(() => {
                    this.classList.remove('touching');
                }, 100);
            });
            
            button.addEventListener('touchcancel', function() {
                this.classList.remove('touching');
            });
        });

        // Optimize form inputs
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            // Prevent zoom on focus for iOS
            input.addEventListener('focus', function() {
                if (isSmallPhone()) {
                    this.style.fontSize = '16px';
                }
            });
            
            input.addEventListener('blur', function() {
                this.style.fontSize = '';
            });
        });
    }

    /**
     * Initialize scroll behaviors
     */
    function initScrollBehaviors() {
        // Smooth scroll for internal links
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a[href^="#"]');
            if (link) {
                e.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });

        // Pull-to-refresh simulation
        let startY = 0;
        let currentY = 0;
        let pullDistance = 0;
        const maxPullDistance = 100;
        let isPulling = false;

        document.addEventListener('touchstart', function(e) {
            if (window.pageYOffset === 0) {
                startY = e.touches[0].clientY;
                isPulling = true;
            }
        });

        document.addEventListener('touchmove', function(e) {
            if (!isPulling) return;
            
            currentY = e.touches[0].clientY;
            pullDistance = Math.max(0, currentY - startY);
            
            if (pullDistance > 0 && pullDistance <= maxPullDistance) {
                e.preventDefault();
                // Visual feedback could be added here
            }
        });

        document.addEventListener('touchend', function(e) {
            if (isPulling && pullDistance > 60) {
                // Trigger refresh
                refreshCurrentSection();
            }
            
            isPulling = false;
            pullDistance = 0;
        });
    }

    /**
     * Initialize swipe gestures
     */
    function initSwipeGestures() {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        
        document.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startTime = Date.now();
        });
        
        document.addEventListener('touchend', function(e) {
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const endTime = Date.now();
            
            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;
            
            // Check if it's a valid swipe
            if (deltaTime < 300 && Math.abs(deltaX) > 50 && Math.abs(deltaY) < 100) {
                if (deltaX > 0) {
                    handleSwipeRight();
                } else {
                    handleSwipeLeft();
                }
            }
        });
    }

    /**
     * Handle swipe gestures
     */
    function handleSwipeRight() {
        // Navigate to previous tab
        navigateTab(-1);
    }

    function handleSwipeLeft() {
        // Navigate to next tab
        navigateTab(1);
    }

    /**
     * Navigate tabs programmatically
     */
    function navigateTab(direction) {
        const tabs = document.querySelectorAll('.mobile-tab');
        const activeTab = document.querySelector('.mobile-tab.active');
        
        if (!activeTab) return;
        
        const currentIndex = Array.from(tabs).indexOf(activeTab);
        let newIndex = currentIndex + direction;
        
        // Wrap around
        if (newIndex < 0) newIndex = tabs.length - 1;
        if (newIndex >= tabs.length) newIndex = 0;
        
        // Navigate to new tab
        const newTab = tabs[newIndex];
        if (newTab) {
            vibrate(5);
            newTab.click();
        }
    }

    /**
     * Initialize search and filters
     */
    function initSearchAndFilters() {
        // Debounced search
        const searchInputs = document.querySelectorAll('.mobile-search');
        
        searchInputs.forEach(input => {
            let searchTimeout;
            
            input.addEventListener('input', function() {
                clearTimeout(searchTimeout);
                const query = this.value.trim();
                
                searchTimeout = setTimeout(() => {
                    performSearch(query, this);
                }, 300);
            });
            
            // Clear search on ESC
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    this.value = '';
                    performSearch('', this);
                    this.blur();
                }
            });
        });

        // Filter toggles
        const filterToggles = document.querySelectorAll('.mobile-filter-toggle');
        filterToggles.forEach(toggle => {
            toggle.addEventListener('click', function() {
                vibrate(5);
                const panel = this.parentElement.nextElementSibling;
                if (panel && panel.classList.contains('mobile-filter-panel')) {
                    panel.classList.toggle('show');
                    
                    // Update icon
                    const icon = this.querySelector('i');
                    if (panel.classList.contains('show')) {
                        icon.className = 'ti ti-filter-off';
                    } else {
                        icon.className = 'ti ti-filter';
                    }
                }
            });
        });

        // Filter changes
        const filterInputs = document.querySelectorAll('.mobile-filter-panel select, .mobile-filter-panel input');
        filterInputs.forEach(input => {
            input.addEventListener('change', function() {
                applyFilters();
            });
        });
    }

    /**
     * Perform search
     */
    function performSearch(query, inputElement) {
        console.log('Searching for:', query);
        
        // Get current section
        const section = getCurrentSection();
        
        // Show loading state
        const loadingElement = getLoadingElement(section);
        if (loadingElement) {
            loadingElement.style.display = 'flex';
        }
        
        // Simulate search delay
        setTimeout(() => {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
            
            // Filter visible items based on query
            filterItems(query, section);
        }, 500);
    }

    /**
     * Apply filters
     */
    function applyFilters() {
        const section = getCurrentSection();
        const filters = getActiveFilters(section);
        
        console.log('Applying filters:', filters);
        
        // Show loading state
        const loadingElement = getLoadingElement(section);
        if (loadingElement) {
            loadingElement.style.display = 'flex';
        }
        
        // Simulate filter delay
        setTimeout(() => {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
            
            // Apply filters to items
            filterItemsBy(filters, section);
        }, 300);
    }

    /**
     * Initialize responsive images
     */
    function initResponsiveImages() {
        const images = document.querySelectorAll('img');
        
        images.forEach(img => {
            // Add loading states
            img.addEventListener('load', function() {
                this.classList.add('loaded');
            });
            
            img.addEventListener('error', function() {
                this.src = '/images/placeholder-error.png';
                this.classList.add('error');
            });
            
            // Lazy loading for off-screen images
            if ('IntersectionObserver' in window) {
                const imageObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            if (img.dataset.src) {
                                img.src = img.dataset.src;
                                img.removeAttribute('data-src');
                                imageObserver.unobserve(img);
                            }
                        }
                    });
                });
                
                if (img.dataset.src) {
                    imageObserver.observe(img);
                }
            }
        });
    }

    /**
     * Initialize notifications
     */
    function initNotifications() {
        // Request notification permission if supported
        if ('Notification' in window && Notification.permission === 'default') {
            // Don't request automatically, wait for user interaction
        }
        
        // Handle notification clicks
        document.addEventListener('click', function(e) {
            if (e.target.matches('.notification-btn, .notify-btn')) {
                showNotification('Acción completada', {
                    body: 'La operación se realizó correctamente',
                    icon: '/favicon.ico'
                });
            }
        });
    }

    /**
     * Utility Functions
     */

    // Throttle function for performance
    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Debounce function for search
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Haptic feedback
    function vibrate(duration = 10) {
        if ('vibrate' in navigator) {
            navigator.vibrate(duration);
        }
    }

    // Add scroll indicators
    function addScrollIndicators(container) {
        const updateIndicators = () => {
            const isScrollable = container.scrollWidth > container.clientWidth;
            const scrollLeft = container.scrollLeft;
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            
            container.classList.toggle('has-scroll', isScrollable);
            container.classList.toggle('scroll-left', scrollLeft > 0);
            container.classList.toggle('scroll-right', scrollLeft + clientWidth < scrollWidth - 1);
        };
        
        container.addEventListener('scroll', updateIndicators);
        updateIndicators();
    }

    // Get current section
    function getCurrentSection() {
        const activeTab = document.querySelector('.mobile-tab.active');
        if (activeTab) {
            const href = activeTab.getAttribute('href');
            if (href.includes('section=providers')) return 'providers';
            if (href.includes('section=establishments')) return 'establishments';
        }
        return 'experiences';
    }

    // Get loading element for section
    function getLoadingElement(section) {
        return document.querySelector(`#mobile-${section}-loading`);
    }

    // Get active filters
    function getActiveFilters(section) {
        const filters = {};
        const filterPanel = document.querySelector(`#mobile-${section}-filter-panel`);
        
        if (filterPanel) {
            const selects = filterPanel.querySelectorAll('select');
            selects.forEach(select => {
                if (select.value) {
                    filters[select.id] = select.value;
                }
            });
        }
        
        return filters;
    }

    // Filter items by query
    function filterItems(query, section) {
        // This would integrate with the actual data filtering
        console.log(`Filtering ${section} items by query:`, query);
    }

    // Filter items by filters
    function filterItemsBy(filters, section) {
        // This would integrate with the actual data filtering
        console.log(`Filtering ${section} items by filters:`, filters);
    }

    // Refresh current section
    function refreshCurrentSection() {
        vibrate(20);
        const section = getCurrentSection();
        console.log('Refreshing section:', section);
        
        // Show loading state
        const loadingElement = getLoadingElement(section);
        if (loadingElement) {
            loadingElement.style.display = 'flex';
        }
        
        // Simulate refresh
        setTimeout(() => {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
            showNotification('Actualizado', {
                body: 'Los datos se han actualizado correctamente'
            });
        }, 1000);
    }

    // Pause mobile features
    function pauseMobileFeatures() {
        // Pause animations, timers, etc.
        console.log('Pausing mobile features...');
    }

    // Resume mobile features
    function resumeMobileFeatures() {
        // Resume animations, timers, etc.
        console.log('Resuming mobile features...');
    }

    // Show notification
    function showNotification(title, options = {}) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, options);
        } else {
            // Fallback to in-app notification
            showInAppNotification(title, options.body);
        }
    }

    // Show in-app notification
    function showInAppNotification(title, body) {
        const notification = document.createElement('div');
        notification.className = 'mobile-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <h4>${title}</h4>
                ${body ? `<p>${body}</p>` : ''}
            </div>
            <button class="notification-close" onclick="this.parentElement.remove()">
                <i class="ti ti-x"></i>
            </button>
        `;
        
        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 1rem;
            background: white;
            padding: 1rem;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 1001;
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOutRight 0.3s ease-in forwards';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }

    // Modal handlers (placeholders)
    function showAddExperienceModal() {
        console.log('Opening add experience modal...');
        showInAppNotification('Agregar Experiencia', 'Modal de nueva experiencia próximamente');
    }

    function showAddProviderModal() {
        console.log('Opening add provider modal...');
        showInAppNotification('Agregar Proveedor', 'Modal de nuevo proveedor próximamente');
    }

    function showAddEstablishmentModal() {
        console.log('Opening add establishment modal...');
        showInAppNotification('Agregar Establecimiento', 'Modal de nuevo establecimiento próximamente');
    }

    function showGenericAddModal() {
        console.log('Opening generic add modal...');
        showInAppNotification('Agregar', 'Funcionalidad próximamente');
    }

    /**
     * Initialization and Event Listeners
     */

    // Initialize when DOM is ready
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initMobileExperiences);
        } else {
            initMobileExperiences();
        }

        // Handle window resize
        let resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const wasMobile = isInitialized;
                const nowMobile = isMobile();
                
                if (!wasMobile && nowMobile) {
                    initMobileExperiences();
                } else if (wasMobile && !nowMobile) {
                    // Clean up mobile features
                    isInitialized = false;
                }
            }, 250);
        });

        // Handle orientation change
        window.addEventListener('orientationchange', function() {
            setTimeout(() => {
                if (isMobile()) {
                    scrollToActiveTab();
                }
            }, 100);
        });

        // Handle page show/hide
        window.addEventListener('pageshow', function(e) {
            if (e.persisted) {
                // Page was restored from cache
                if (isMobile()) {
                    initMobileExperiences();
                }
            }
        });
    }

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        .touching {
            transform: scale(0.98) !important;
            opacity: 0.8 !important;
        }
        
        .touch-device * {
            -webkit-tap-highlight-color: rgba(0,0,0,0);
        }
        
        .tab-loader {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 20px;
        }
    `;
    document.head.appendChild(style);

    // Export public API
    window.ExperiencesMobile = {
        init: init,
        isMobile: isMobile,
        isTablet: isTablet,
        isSmallPhone: isSmallPhone,
        refreshCurrentSection: refreshCurrentSection,
        navigateTab: navigateTab,
        showNotification: showNotification
    };

    // Auto-initialize
    init();

})();