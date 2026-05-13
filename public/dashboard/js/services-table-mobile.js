/**
 * Services DataTable Mobile Enhancements
 * Provides advanced mobile features for the services table
 * Created by Denisse Maldonado
 */

(function() {
    'use strict';

    // Mobile breakpoint constants
    const MOBILE_BREAKPOINT = 768;
    const SMALL_PHONE_BREAKPOINT = 576;

    // Check if mobile device
    function isMobile() {
        return window.innerWidth < MOBILE_BREAKPOINT;
    }

    function isSmallPhone() {
        return window.innerWidth < SMALL_PHONE_BREAKPOINT;
    }

    /**
     * Initialize mobile enhancements for DataTable
     */
    function initDataTableMobile() {
        const table = document.querySelector('#all-services-table');
        if (!table) return;

        // Wait for DataTable to be ready
        const checkDataTable = setInterval(function() {
            if ($.fn.DataTable && $.fn.DataTable.isDataTable(table)) {
                clearInterval(checkDataTable);
                setupMobileFeatures(table);
            }
        }, 100);

        // Stop checking after 5 seconds
        setTimeout(() => clearInterval(checkDataTable), 5000);
    }

    /**
     * Setup all mobile features
     */
    function setupMobileFeatures(table) {
        if (!isMobile()) return;

        // Add swipe hint
        addSwipeHint();

        // Setup scroll indicator
        setupScrollIndicator();

        // Setup row expansion for hidden columns
        if (window.innerWidth < MOBILE_BREAKPOINT && window.innerWidth >= SMALL_PHONE_BREAKPOINT) {
            setupRowExpansion(table);
        }

        // Setup card view toggle for very small screens
        if (isSmallPhone()) {
            setupCardViewToggle(table);
        }

        // Add touch optimizations
        addTouchOptimizations(table);
    }

    /**
     * Add swipe hint for scrollable tables
     */
    function addSwipeHint() {
        const tableWrapper = document.querySelector('.table-responsive');
        if (!tableWrapper) return;

        // Check if table is scrollable
        if (tableWrapper.scrollWidth > tableWrapper.clientWidth) {
            const hint = document.createElement('div');
            hint.className = 'swipe-hint';
            hint.innerHTML = `
                <i class="ti ti-hand-finger"></i>
                <span>Desliza para ver más columnas</span>
                <i class="ti ti-arrow-right"></i>
            `;
            tableWrapper.parentNode.insertBefore(hint, tableWrapper);

            // Remove hint after first scroll or after 5 seconds
            const removeHint = () => {
                if (hint.parentNode) {
                    hint.style.opacity = '0';
                    setTimeout(() => hint.remove(), 300);
                }
            };
            
            tableWrapper.addEventListener('scroll', removeHint, { once: true });
            setTimeout(removeHint, 5000);
        }
    }

    /**
     * Setup scroll indicator for table
     */
    function setupScrollIndicator() {
        const tableWrapper = document.querySelector('.table-responsive');
        if (!tableWrapper) return;

        tableWrapper.addEventListener('scroll', function() {
            const maxScroll = this.scrollWidth - this.clientWidth;
            const currentScroll = this.scrollLeft;

            if (currentScroll >= maxScroll - 1) {
                this.classList.add('scrolled-right');
            } else {
                this.classList.remove('scrolled-right');
            }
        });
    }

    /**
     * Setup row expansion for hidden columns on tablets
     */
    function setupRowExpansion(table) {
        const $table = $(table);
        const dt = $table.DataTable();

        // Add click handler for row expansion
        $table.on('click', 'tbody tr', function(e) {
            // Don't expand if clicking on buttons or links
            if ($(e.target).closest('.btn, a, select, input').length) return;

            const $row = $(this);
            const rowData = dt.row(this).data();

            if ($row.hasClass('expanded')) {
                // Collapse row
                $row.removeClass('expanded');
                $row.next('.mobile-details-row').remove();
            } else {
                // Expand row
                $('.expanded', $table).removeClass('expanded');
                $('.mobile-details-row', $table).remove();

                $row.addClass('expanded');
                const detailsHtml = createMobileDetails(rowData, $row);
                $row.after(detailsHtml);
            }
        });
    }

    /**
     * Create mobile details row HTML
     */
    function createMobileDetails(rowData, $row) {
        // Get hidden column data
        const cells = $row.find('td');
        const notes = cells.eq(3).text() || 'Sin notas';
        const status = cells.eq(4).html() || '<span class="badge bg-success">Activo</span>';

        return `
            <tr class="mobile-details-row">
                <td colspan="${cells.length}">
                    <div class="mobile-details-content">
                        <div class="mobile-detail-item">
                            <span class="mobile-detail-label">Notas</span>
                            <span class="mobile-detail-value">${notes}</span>
                        </div>
                        <div class="mobile-detail-item">
                            <span class="mobile-detail-label">Estado</span>
                            <span class="mobile-detail-value">${status}</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Setup card view toggle for small phones
     */
    function setupCardViewToggle(table) {
        const wrapper = document.querySelector('#all-services-table_wrapper');
        if (!wrapper) return;

        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'switch-to-cards';
        toggleBtn.innerHTML = '<i class="ti ti-layout-cards me-2"></i>Vista de Tarjetas';
        
        // Insert button before table wrapper
        wrapper.parentNode.insertBefore(toggleBtn, wrapper);

        // Create cards container
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'services-cards-container';
        wrapper.parentNode.insertBefore(cardsContainer, wrapper.nextSibling);

        // Toggle handler
        let isCardView = false;
        toggleBtn.addEventListener('click', function() {
            isCardView = !isCardView;
            
            if (isCardView) {
                wrapper.parentNode.classList.add('cards-view-active');
                toggleBtn.innerHTML = '<i class="ti ti-table me-2"></i>Vista de Tabla';
                createServiceCards(table, cardsContainer);
            } else {
                wrapper.parentNode.classList.remove('cards-view-active');
                toggleBtn.innerHTML = '<i class="ti ti-layout-cards me-2"></i>Vista de Tarjetas';
                cardsContainer.innerHTML = '';
            }
        });
    }

    /**
     * Create service cards from table data
     */
    function createServiceCards(table, container) {
        const dt = $(table).DataTable();
        const data = dt.rows({ page: 'current' }).data();
        
        container.innerHTML = '';
        
        data.each(function(row, index) {
            const card = createServiceCard(row, index);
            container.appendChild(card);
        });
    }

    /**
     * Create individual service card
     */
    function createServiceCard(rowData, index) {
        const card = document.createElement('div');
        card.className = 'service-card';
        
        // Parse row data (assuming it's an array from DataTable)
        const [route, price, duration, notes, statusHtml, actions] = rowData;
        
        // Extract text from status HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = statusHtml || '<span class="badge bg-success">Activo</span>';
        const statusBadge = tempDiv.querySelector('.badge');
        const statusText = statusBadge ? statusBadge.textContent : 'Activo';
        const statusClass = statusBadge && statusBadge.classList.contains('bg-danger') ? 'text-danger' : 'text-success';
        
        card.innerHTML = `
            <div class="service-card-header">
                <div class="service-card-route">${route || 'Sin ruta'}</div>
                <div class="service-card-price">${price || '$0'}</div>
            </div>
            <div class="service-card-body">
                <div class="service-card-info">
                    <div class="service-card-info-item">
                        <span class="service-card-info-label">Duración</span>
                        <span class="service-card-info-value">${duration || 'N/A'}</span>
                    </div>
                    <div class="service-card-info-item">
                        <span class="service-card-info-label">Estado</span>
                        <span class="service-card-info-value ${statusClass}">${statusText}</span>
                    </div>
                    ${notes ? `
                    <div class="service-card-info-item" style="grid-column: 1 / -1;">
                        <span class="service-card-info-label">Notas</span>
                        <span class="service-card-info-value">${notes}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="service-card-actions">
                    ${actions || ''}
                </div>
            </div>
        `;
        
        // Make action buttons work in card view
        const actionButtons = card.querySelectorAll('.btn');
        actionButtons.forEach(btn => {
            btn.classList.remove('btn-sm');
            btn.classList.add('btn-block');
        });
        
        return card;
    }

    /**
     * Add touch optimizations
     */
    function addTouchOptimizations(table) {
        // Add touch-friendly class
        table.classList.add('touch-optimized');
        
        // Improve button tap areas
        const buttons = table.querySelectorAll('.btn');
        buttons.forEach(btn => {
            if (isMobile()) {
                btn.style.minHeight = '44px';
                btn.style.minWidth = '44px';
            }
        });
        
        // Add haptic feedback on tap (if supported)
        if ('vibrate' in navigator) {
            table.addEventListener('click', function(e) {
                if (e.target.closest('.btn, tr')) {
                    navigator.vibrate(10);
                }
            });
        }
    }

    /**
     * Handle orientation changes
     */
    function handleOrientationChange() {
        setTimeout(function() {
            const table = document.querySelector('#all-services-table');
            if (table && $.fn.DataTable.isDataTable(table)) {
                $(table).DataTable().columns.adjust();
            }
        }, 300);
    }

    /**
     * Initialize when DOM is ready
     */
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initDataTableMobile);
        } else {
            initDataTableMobile();
        }
        
        // Handle orientation changes
        window.addEventListener('orientationchange', handleOrientationChange);
        
        // Reinitialize on resize if crossing breakpoints
        let previousWidth = window.innerWidth;
        window.addEventListener('resize', debounce(function() {
            const currentWidth = window.innerWidth;
            
            if ((previousWidth >= MOBILE_BREAKPOINT && currentWidth < MOBILE_BREAKPOINT) ||
                (previousWidth < MOBILE_BREAKPOINT && currentWidth >= MOBILE_BREAKPOINT) ||
                (previousWidth >= SMALL_PHONE_BREAKPOINT && currentWidth < SMALL_PHONE_BREAKPOINT) ||
                (previousWidth < SMALL_PHONE_BREAKPOINT && currentWidth >= SMALL_PHONE_BREAKPOINT)) {
                
                // Reinitialize features
                const table = document.querySelector('#all-services-table');
                if (table) {
                    setupMobileFeatures(table);
                }
            }
            
            previousWidth = currentWidth;
        }, 250));
    }

    /**
     * Debounce utility
     */
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

    // Initialize
    init();

    // Export for debugging
    window.ServicesTableMobile = {
        init: init,
        isMobile: isMobile,
        isSmallPhone: isSmallPhone
    };

})();