/**
 * Services Dashboard Mobile JavaScript
 * Handles mobile interactions and responsive behavior
 * Created by Denisse Maldonado
 */

(function() {
    'use strict';

    // Mobile breakpoint constants
    const MOBILE_BREAKPOINT = 768;
    const TABLET_BREAKPOINT = 992;
    const SMALL_PHONE_BREAKPOINT = 576;

    // Check if mobile device
    function isMobile() {
        return window.innerWidth < TABLET_BREAKPOINT;
    }

    function isSmallPhone() {
        return window.innerWidth < SMALL_PHONE_BREAKPOINT;
    }

    // ============================================
    // Mobile Navigation
    // ============================================
    
    function initMobileNavigation() {
        // Create hamburger menu if it doesn't exist
        if (!document.querySelector('.mobile-menu-toggle')) {
            const menuToggle = document.createElement('button');
            menuToggle.className = 'mobile-menu-toggle';
            menuToggle.setAttribute('aria-label', 'Toggle navigation menu');
            menuToggle.innerHTML = '<i class="ti ti-menu-2"></i>';
            document.body.appendChild(menuToggle);

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);

            // Toggle sidebar on hamburger click
            menuToggle.addEventListener('click', toggleSidebar);
            
            // Close sidebar on overlay click
            overlay.addEventListener('click', closeSidebar);
            
            // Close sidebar on escape key
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    closeSidebar();
                }
            });
        }

        // Handle sidebar close button
        const closeBtn = document.querySelector('#sidebarCollapse');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeSidebar);
        }
    }

    function toggleSidebar() {
        const sidebar = document.querySelector('.left-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const menuToggle = document.querySelector('.mobile-menu-toggle');
        
        if (sidebar && overlay) {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
            
            // Update hamburger icon
            if (menuToggle) {
                const icon = menuToggle.querySelector('i');
                if (sidebar.classList.contains('active')) {
                    icon.className = 'ti ti-x';
                    document.body.style.overflow = 'hidden'; // Prevent body scroll
                } else {
                    icon.className = 'ti ti-menu-2';
                    document.body.style.overflow = '';
                }
            }
        }
    }

    function closeSidebar() {
        const sidebar = document.querySelector('.left-sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        const menuToggle = document.querySelector('.mobile-menu-toggle');
        
        if (sidebar && overlay) {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
            
            if (menuToggle) {
                menuToggle.querySelector('i').className = 'ti ti-menu-2';
            }
        }
    }

    // ============================================
    // Vehicle Rate Prices Mobile
    // ============================================

    function initVehicleRatesMobile() {
        if (!isMobile()) return;

        const vehicleRatesSection = document.querySelector('#admin-vehicle-rate-prices');
        if (!vehicleRatesSection) return;

        // Create mobile filter toggle
        createMobileFilters(vehicleRatesSection);
        
        // Make rate pills horizontally scrollable
        makeRatePillsScrollable();
    }

    function createMobileFilters(container) {
        const filterControls = container.querySelector('.d-flex.gap-3.align-items-center');
        if (!filterControls) return;

        // Create collapsible filter wrapper
        const filterWrapper = document.createElement('div');
        filterWrapper.className = 'vehicle-filters-mobile';
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'vehicle-filters-toggle';
        toggleBtn.innerHTML = `
            <span>
                <i class="ti ti-filter me-2"></i>
                Filtros
            </span>
            <i class="ti ti-chevron-down"></i>
        `;
        
        const filterContent = document.createElement('div');
        filterContent.className = 'vehicle-filters-content';
        
        // Move filter controls into collapsible content
        while (filterControls.firstChild) {
            filterContent.appendChild(filterControls.firstChild);
        }
        
        filterWrapper.appendChild(toggleBtn);
        filterWrapper.appendChild(filterContent);
        
        // Insert before the original controls container
        filterControls.parentNode.insertBefore(filterWrapper, filterControls);
        filterControls.style.display = 'none';
        
        // Toggle filter visibility
        toggleBtn.addEventListener('click', function() {
            filterContent.classList.toggle('show');
            const icon = toggleBtn.querySelector('.ti-chevron-down');
            if (filterContent.classList.contains('show')) {
                icon.className = 'ti ti-chevron-up';
            } else {
                icon.className = 'ti ti-chevron-down';
            }
        });
    }

    function makeRatePillsScrollable() {
        const pillsContainer = document.querySelector('#rate-pills-container');
        if (!pillsContainer) return;

        // Add touch scroll indicators
        addScrollIndicators(pillsContainer);
    }

    // ============================================
    // Services DataTable Mobile
    // ============================================

    function initServicesTableMobile() {
        if (!isMobile()) return;

        // Don't create mobile filter controls - use CSS to make existing ones responsive
        // createServicesFiltersMobile();
        
        // Wait for DataTable to be ready
        setTimeout(function() {
            const tableWrapper = document.querySelector('#all-services-table_wrapper');
            if (!tableWrapper) return;
            
            // Initialize mobile view based on screen size
            if (isSmallPhone()) {
                initCardView();
            } else {
                initResponsiveTable();
            }
        }, 500);
    }

    function createServicesFiltersMobile() {
        const filterContainer = document.querySelector('.d-flex.justify-content-between.align-items-center.mb-3');
        if (!filterContainer) return;

        // Create mobile filters container
        const mobileFilters = document.createElement('div');
        mobileFilters.className = 'services-filters-mobile';
        
        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'filters-toggle-btn';
        toggleBtn.innerHTML = `
            <span>
                <i class="ti ti-adjustments-horizontal me-2"></i>
                Filtros y Controles
            </span>
            <span class="badge">0</span>
        `;
        
        // Create filters content
        const filtersContent = document.createElement('div');
        filtersContent.className = 'services-filters-content';
        
        // Move existing filters into mobile container
        const pills = filterContainer.querySelector('.nav-pills');
        const controls = filterContainer.querySelector('.d-flex.gap-3');
        
        if (pills) {
            filtersContent.appendChild(pills.cloneNode(true));
        }
        
        if (controls) {
            // Create grid layout for controls
            const controlsGrid = document.createElement('div');
            controlsGrid.className = 'filter-controls-grid';
            
            // Move each control into grid
            controls.querySelectorAll('.d-flex.align-items-center').forEach(control => {
                const gridItem = document.createElement('div');
                gridItem.className = 'filter-control-item';
                gridItem.appendChild(control.cloneNode(true));
                controlsGrid.appendChild(gridItem);
            });
            
            filtersContent.appendChild(controlsGrid);
        }
        
        mobileFilters.appendChild(toggleBtn);
        mobileFilters.appendChild(filtersContent);
        
        // Insert before original filters and hide original on mobile
        filterContainer.parentNode.insertBefore(mobileFilters, filterContainer);
        filterContainer.classList.add('hide-mobile');
        
        // Toggle functionality
        toggleBtn.addEventListener('click', function() {
            filtersContent.classList.toggle('show');
            updateFilterBadge(toggleBtn);
        });
        
        // Update badge count when filters change
        updateFilterBadge(toggleBtn);
        observeFilterChanges(toggleBtn);
    }

    function updateFilterBadge(toggleBtn) {
        let activeCount = 0;
        
        // Count active pills
        const activePills = document.querySelectorAll('.services-filters-mobile .nav-pills .active');
        activeCount += activePills.length;
        
        // Count active toggles
        const activeToggles = document.querySelectorAll('.services-filters-mobile .form-check-input:checked');
        activeCount += activeToggles.length;
        
        // Count non-default dropdowns
        const dropdowns = document.querySelectorAll('.services-filters-mobile .form-select');
        dropdowns.forEach(dropdown => {
            if (dropdown.value !== dropdown.options[0].value) {
                activeCount++;
            }
        });
        
        const badge = toggleBtn.querySelector('.badge');
        badge.textContent = activeCount;
        badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }

    function observeFilterChanges(toggleBtn) {
        // Watch for changes in filters
        const filtersContent = document.querySelector('.services-filters-content');
        if (!filtersContent) return;
        
        filtersContent.addEventListener('change', () => updateFilterBadge(toggleBtn));
        filtersContent.addEventListener('click', (e) => {
            if (e.target.classList.contains('nav-link')) {
                setTimeout(() => updateFilterBadge(toggleBtn), 100);
            }
        });
    }

    function initResponsiveTable() {
        // Don't interfere with DataTable initialization
        // Just add mobile-specific enhancements if table exists
        const checkTable = setInterval(function() {
            const table = document.querySelector('#all-services-table');
            if (table && $.fn.DataTable && $.fn.DataTable.isDataTable(table)) {
                clearInterval(checkTable);
                
                const dt = $(table).DataTable();
                
                // Add mobile touch enhancement for row expansion
                $(table).off('click.mobile').on('click.mobile', 'tbody tr', function(e) {
                    if (!isMobile()) return;
                    if ($(e.target).closest('.btn, a, select, input').length) return;
                    
                    // Toggle row details on mobile
                    const $row = $(this);
                    if ($row.hasClass('mobile-expanded')) {
                        $row.removeClass('mobile-expanded');
                        $row.next('.mobile-details').remove();
                    } else {
                        $('.mobile-expanded').removeClass('mobile-expanded');
                        $('.mobile-details').remove();
                        
                        $row.addClass('mobile-expanded');
                        const details = formatMobileDetails($row);
                        $row.after(details);
                    }
                });
            }
        }, 100);
        
        // Stop checking after 5 seconds
        setTimeout(function() {
            clearInterval(checkTable);
        }, 5000);
    }

    function formatMobileDetails($row) {
        // Format hidden data for mobile display from jQuery row
        const cells = $row.find('td');
        const duration = cells.eq(2).text() || 'N/A';
        const notes = cells.eq(3).text() || 'Sin notas';
        const status = cells.eq(4).html() || '<span class="badge bg-success">Activo</span>';
        const actions = cells.last().html() || '';
        
        return `
            <tr class="mobile-details">
                <td colspan="${cells.length}">
                    <div class="mobile-row-details">
                        <div class="mobile-detail-item">
                            <span class="mobile-detail-label">Duración:</span>
                            <span class="mobile-detail-value">${duration}</span>
                        </div>
                        <div class="mobile-detail-item">
                            <span class="mobile-detail-label">Notas:</span>
                            <span class="mobile-detail-value">${notes}</span>
                        </div>
                        <div class="mobile-detail-item">
                            <span class="mobile-detail-label">Estado:</span>
                            <span class="mobile-detail-value">${status}</span>
                        </div>
                        <div class="mobile-actions">
                            ${actions}
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    function initCardView() {
        // For very small phones, create a card-based view
        const tableWrapper = document.querySelector('#all-services-table_wrapper');
        if (!tableWrapper) return;
        
        // Create cards container
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'services-mobile-cards';
        cardsContainer.id = 'services-mobile-cards';
        
        // Get table data
        const table = document.querySelector('#all-services-table');
        if (!table || !$.fn.DataTable.isDataTable(table)) return;
        
        const dt = $(table).DataTable();
        const data = dt.data();
        
        // Create cards from data
        data.each(function(row) {
            const card = createServiceCard(row);
            cardsContainer.appendChild(card);
        });
        
        // Insert cards after table wrapper
        tableWrapper.parentNode.insertBefore(cardsContainer, tableWrapper.nextSibling);
    }

    function createServiceCard(rowData) {
        const card = document.createElement('div');
        card.className = 'service-mobile-card';
        
        card.innerHTML = `
            <div class="service-card-header">
                <div>
                    <div class="service-card-route">${rowData[0] || 'Sin ruta'}</div>
                    <span class="service-card-type">Aeropuerto</span>
                </div>
                <div class="service-card-price">${rowData[1] || '$0'}</div>
            </div>
            <div class="service-card-details">
                <div class="service-detail">
                    <span class="service-detail-label">Duración</span>
                    <span class="service-detail-value">${rowData[2] || 'N/A'}</span>
                </div>
                <div class="service-detail">
                    <span class="service-detail-label">Estado</span>
                    <span class="service-detail-value">
                        <span class="badge bg-success">Activo</span>
                    </span>
                </div>
            </div>
            <div class="service-card-actions">
                <button class="btn btn-outline-primary btn-sm">
                    <i class="ti ti-edit"></i> Editar
                </button>
                <button class="btn btn-outline-danger btn-sm">
                    <i class="ti ti-trash"></i> Eliminar
                </button>
            </div>
        `;
        
        return card;
    }

    // ============================================
    // Utility Functions
    // ============================================

    function addScrollIndicators(container) {
        // Add visual indicators for scrollable content
        const isScrollable = container.scrollWidth > container.clientWidth;
        
        if (isScrollable) {
            container.classList.add('has-scroll');
            
            // Add scroll listeners for indicators
            container.addEventListener('scroll', function() {
                const scrollLeft = container.scrollLeft;
                const scrollWidth = container.scrollWidth;
                const clientWidth = container.clientWidth;
                
                if (scrollLeft <= 0) {
                    container.classList.remove('scroll-left');
                } else {
                    container.classList.add('scroll-left');
                }
                
                if (scrollLeft + clientWidth >= scrollWidth - 1) {
                    container.classList.remove('scroll-right');
                } else {
                    container.classList.add('scroll-right');
                }
            });
            
            // Trigger initial check
            container.dispatchEvent(new Event('scroll'));
        }
    }

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

    // ============================================
    // Initialization
    // ============================================

    function init() {
        // Initialize mobile navigation
        if (isMobile()) {
            initMobileNavigation();
            
            // Wait for page to be fully loaded before initializing data components
            if (document.readyState === 'complete') {
                initVehicleRatesMobile();
                initServicesTableMobile();
            } else {
                window.addEventListener('load', function() {
                    initVehicleRatesMobile();
                    initServicesTableMobile();
                });
            }
        }
        
        // Reinitialize on window resize
        let previousWidth = window.innerWidth;
        window.addEventListener('resize', debounce(function() {
            const currentWidth = window.innerWidth;
            
            // Check if we crossed the mobile breakpoint
            if ((previousWidth >= TABLET_BREAKPOINT && currentWidth < TABLET_BREAKPOINT) ||
                (previousWidth < TABLET_BREAKPOINT && currentWidth >= TABLET_BREAKPOINT)) {
                location.reload(); // Simplest way to reinitialize everything
            }
            
            previousWidth = currentWidth;
        }, 250));
        
        // Handle orientation changes
        window.addEventListener('orientationchange', function() {
            setTimeout(function() {
                if (isMobile()) {
                    adjustForOrientation();
                }
            }, 100);
        });
    }

    function adjustForOrientation() {
        const isLandscape = window.orientation === 90 || window.orientation === -90;
        document.body.classList.toggle('landscape-mode', isLandscape);
    }

    // ============================================
    // Public API
    // ============================================

    window.ServicesMobile = {
        init: init,
        toggleSidebar: toggleSidebar,
        closeSidebar: closeSidebar,
        isMobile: isMobile,
        isSmallPhone: isSmallPhone
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();