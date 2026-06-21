/**
 * Services Renderer Component
 * Unified service rendering for all views
 * Created by Denisse Maldonado
 */

/* global ServicesRendererConfig */

(function (window) {
    'use strict';

    class ServicesRenderer {
        constructor(options = {}) {
            // Check if config is loaded
            if (typeof ServicesRendererConfig === 'undefined') {
                console.error('❌ ServicesRenderer: ServicesRendererConfig not loaded. Please include services-renderer-config.js first.');
                return;
            }

            this.config = ServicesRendererConfig;
            this.mode = options.mode || 'list'; // 'list', 'preview', 'summary'
            this.container = options.container || null;
            this.formatCurrency = options.formatCurrency || this.config.formatters.currency;
            this.formatDate = options.formatDate || this.config.formatters.date;
            this.truncateText = options.truncateText || this.config.formatters.truncateText;

            // Payment type for pricing
            this.paymentType = options.paymentType || 'efectivo';

            // Segment mappings for converting ObjectIds to human-readable names
            this.segmentMappings = options.segmentMappings || {};
            this.ratesCache = options.ratesCache || [];

            // Rate fetching state
            this.ratesFetchPromise = null;
            this.lastRatesFetch = null;

            // Initialize styles
            this.initializeStyles();

            // Log initialization details
            this.logInitialization(options);
        }

        // Helper: Log initialization details for debugging
        logInitialization(options) {
            const cacheInfo = {
                provided: !!options.ratesCache,
                isArray: Array.isArray(this.ratesCache),
                length: this.ratesCache?.length || 0,
                validStructure: this.ratesCache?.length > 0 ? this.validateRatesCache() : false
            };

            console.log('🔧 ServicesRenderer: Initialized', {
                mode: this.mode,
                paymentType: this.paymentType,
                hasContainer: !!this.container,
                containerType: this.container ? (typeof this.container === 'string' ? 'selector' : 'element') : 'none',
                ratesCache: cacheInfo,
                config: {
                    loaded: !!this.config,
                    hasFormatters: !!this.config?.formatters,
                    hasHelpers: !!this.config?.helpers
                }
            });

            // Warn about potential issues
            if (!this.container) {
                console.warn('⚠️ ServicesRenderer: No container specified - render() will fail');
            }

            if (cacheInfo.provided && cacheInfo.length === 0) {
                console.warn('⚠️ ServicesRenderer: Empty ratesCache provided - segment names may display as IDs');
            }

            if (cacheInfo.provided && !cacheInfo.validStructure) {
                console.warn('⚠️ ServicesRenderer: Invalid ratesCache structure - segment resolution may fail');
            }
        }

        initializeStyles() {
            // Check if styles are already injected
            if (document.getElementById('services-renderer-styles')) return;

            const styles = `
                <style id="services-renderer-styles">
                    /* Common styles for all modes */
                    .service-badge {
                        display: inline-block;
                        padding: 0.25em 0.6em;
                        border-radius: 0.375rem;
                        font-size: 0.875rem;
                        font-weight: 600;
                        margin-right: 0.5rem;
                        margin-bottom: 0.25rem;
                        background: #969b81;
                        color: white;
                        border: none;
                    }
                    
                    .service-badge.secondary {
                        background: rgba(150, 155, 129, 0.2);
                        color: #969b81;
                    }
                    
                    .service-badge.warning {
                        background: #c4a747;
                        color: white;
                    }
                    
                    .service-badge.error {
                        background: #a67c7c;
                        color: white;
                    }
                    
                    .service-badge.info {
                        background: #8a9aa8;
                        color: white;
                    }
                    
                    .service-badge.external {
                        background: rgba(150, 155, 129, 0.15);
                        color: #969b81;
                        border: 1px solid rgba(150, 155, 129, 0.3);
                    }
                    
                    /* Passenger-specific badge colors */
                    .service-badge.children {
                        background: #b5ba9e;
                        color: white;
                    }
                    
                    .service-badge.infants {
                        background: rgba(150, 155, 129, 0.3);
                        color: #969b81;
                    }
                    
                    .service-badge.no-alcohol {
                        background: #7a7f6b;
                        color: white;
                    }

                    .service-item {
                        border-bottom: 2px solid #969b81 !important;
                        margin-bottom: 0;
                        padding: 1rem 0;
                    }

                    .service-item:last-child {
                        border-bottom: none !important;
                    }

                    /* Remove any box shadows from containers */
                    .services-renderer-preview,
                    .services-renderer-summary,
                    .services-renderer-list,
                    .day-card,
                    .service-item {
                        box-shadow: none !important;
                        -webkit-box-shadow: none !important;
                        -moz-box-shadow: none !important;
                    }

                    .service-card {
                        border: 1px solid #e9ecef;
                        border-radius: 0.5rem;
                        padding: 1rem;
                        margin-bottom: 0.75rem;
                        background: #fafbfc;
                        border-left: 4px solid #dee2e6;
                    }
                    
                    /* Ensure passenger badges have consistent spacing */
                    .passenger-badges .badge {
                        margin-right: 0.5rem;
                        margin-bottom: 0.25rem;
                    }

                    .service-card.transport {
                        border-left-color: ${this.config.typeColors.transport};
                    }

                    .service-card.experience,
                    .service-card.experiencia {
                        border-left-color: ${this.config.typeColors.experience};
                    }

                    .service-card.tour {
                        border-left-color: ${this.config.typeColors.tour};
                    }

                    .service-card.concepto {
                        border-left-color: ${this.config.typeColors.concepto};
                    }

                    .service-card.a-disposicion {
                        border-left-color: ${this.config.typeColors['a-disposicion']};
                    }

                    .service-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 0.5rem;
                    }

                    .service-info {
                        flex: 1;
                        min-width: 0;
                    }

                    .service-title {
                        font-weight: 600;
                        font-size: 1.075rem;
                        color: #212529;
                        margin-bottom: 0.25rem;
                    }

                    .service-details {
                        font-size: 0.975rem;
                        color: #6c757d;
                    }

                    .service-detail-item {
                        display: flex;
                        align-items: center;
                        gap: 0.25rem;
                        margin-top: 0.25rem;
                    }
                    /* Keep label and value in the same darker tone for a
                       consistent look. The label keeps its text-muted class
                       so other contexts still get the lighter tone — this
                       only equalizes the in-row pairing. */
                    .service-detail-item .text-muted {
                        color: inherit !important;
                    }

                    .service-price {
                        font-weight: normal;
                        font-size: 1.075rem;
                        color: #000000;
                        white-space: nowrap;
                        margin-left: 1rem;
                    }

                    .service-price.excluded {
                        text-decoration: line-through;
                        color: #adb5bd;
                    }

                    .service-actions {
                        display: flex;
                        gap: 0.25rem;
                    }

                    .passenger-badges {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 0.25rem;
                        margin-top: 0.5rem;
                    }

                    .day-card {
                        margin-bottom: 1.5rem;
                    }

                    .day-header {
                        background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
                        padding: 1rem 1.25rem;
                    }

                    .day-number-badge {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        width: 35px;
                        height: 35px;
                        border-radius: 50%;
                        background: #969b81;
                        color: white;
                        font-weight: 700;
                        font-size: 1rem;
                        margin-right: 0.75rem;
                        flex-shrink: 0;
                    }

                    .day-services {
                        padding: 1rem;
                    }

                    .day-footer {
                        padding: 0.75rem 1.25rem;
                        background: #f8f9fa;
                        text-align: right;
                    }

                    .day-total {
                        font-size: 1.125rem;
                        color: #212529;
                    }

                    /* Mode-specific adjustments - minimal differences for consistency */
                    .services-renderer-preview .service-card {
                        margin-bottom: 0.5rem;
                    }

                    .services-renderer-summary .service-card {
                        margin-bottom: 0.5rem;
                    }

                    /* Hide prices in preview mode if requested */
                    .services-renderer-preview.hide-prices .service-price,
                    .services-renderer-preview.hide-prices .day-footer {
                        display: none !important;
                    }
                </style>
            `;

            document.head.insertAdjacentHTML('beforeend', styles);
        }

        // Get badge class based on mode - using sage color scheme
        getBadgeClass() {
            // All modes now use consistent sage color scheme
            return 'service-badge';
        }

        // Get passenger badge class - consistent across all modes with sage color scheme
        getPassengerBadgeClass(type) {
            const colorMap = {
                adults: 'service-badge',
                children: 'service-badge children',
                infants: 'service-badge infants',
                adultsNoAlcohol: 'service-badge no-alcohol'
            };
            return `${colorMap[type] || 'service-badge secondary'} d-inline-flex align-items-center gap-1 me-1 mb-1`;
        }

        // Main render method
        render(data, servicesMap) {
            // If data needs normalization
            if (data && (data.serviceItems || (data.days && data.services))) {
                const normalized = this.config.normalizeQuoteServices(data.serviceItems || data);
                this.renderNormalized(normalized);
                return;
            }

            // Legacy support for direct days/services
            const days = data;
            const services = servicesMap || {};
            if (!this.container) {
                console.error('Container not specified for ServicesRenderer');
                return;
            }

            const html = this.renderDays(days, services);

            if (typeof this.container === 'string') {
                const element = document.querySelector(this.container);
                if (element) {
                    element.innerHTML = html;
                }
            } else if (this.container instanceof HTMLElement) {
                this.container.innerHTML = html;
            }

            // Dispatch render complete event
            this.dispatchRenderEvent('servicesRendered', { days, services });
        }

        // Render with normalized data
        renderNormalized(normalizedData) {
            if (!this.container) {
                console.error('Container not specified for ServicesRenderer');
                return;
            }

            let html = `<div class="services-renderer-${this.mode}">`;
            let grandTotal = 0;

            normalizedData.days.forEach(day => {
                const dayTotal = day.services.reduce((sum, service) => {
                    if (service.includeInTotal === false) return sum;
                    return sum + this.getServicePrice(service);
                }, 0);
                grandTotal += dayTotal;

                html += this.renderNormalizedDay(day, dayTotal);
            });


            html += '</div>';

            if (typeof this.container === 'string') {
                const element = document.querySelector(this.container);
                if (element) {
                    element.innerHTML = html;
                }
            } else if (this.container instanceof HTMLElement) {
                this.container.innerHTML = html;
            }

            this.dispatchRenderEvent('servicesRendered', normalizedData);
        }

        // Render a normalized day
        renderNormalizedDay(day, dayTotal) {
            return `
                <div class="day-card">
                    <div class="day-header">
                        <div style="display: flex; align-items: center;">
                            <span class="day-number-badge">${day.number}</span>
                            <div>
                                <div class="day-title">Día ${day.number} · ${day.title || ''}</div>
                                ${day.date ? `<div class="text-muted small"><i class="ti ti-calendar me-1"></i>${this.formatDate(day.date)}</div>` : ''}
                                ${day.description ? `<div class="text-muted small mt-1">${day.description}</div>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="day-services">
                        ${day.services.map(service => this.renderService(service)).join('')}
                    </div>
                    <div class="day-footer">
                        <span class="day-total">Total del día: ${this.formatCurrency(dayTotal)}</span>
                    </div>
                </div>
            `;
        }

        // Render all days
        renderDays(days, servicesMap) {
            let html = `<div class="services-renderer-${this.mode}">`;
            let grandTotal = 0;

            days.forEach(day => {
                const services = day.services
                    .map(sid => servicesMap.get ? servicesMap.get(sid) : servicesMap[sid])
                    .filter(Boolean);

                const dayTotal = this.calculateDayTotal(services);
                grandTotal += dayTotal;

                html += this.renderDay(day, services, dayTotal);
            });


            html += '</div>';
            return html;
        }

        // Render a single day
        renderDay(day, services, dayTotal) {
            return `
                <div class="day-card">
                    <div class="day-header">
                        <div style="display: flex; align-items: center;">
                            <span class="day-number-badge">${day.number || day.dayNumber}</span>
                            <div>
                                <div class="day-title">Día ${day.number || day.dayNumber} · ${day.title || day.dayTitle || ''}</div>
                                ${day.date ? `<div class="text-muted small"><i class="ti ti-calendar me-1"></i>${this.formatDate(day.date)}</div>` : ''}
                                ${day.description ? `<div class="text-muted small mt-1">${day.description}</div>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="day-services">
                        ${services.map(service => this.renderService(service)).join('')}
                    </div>
                    <div class="day-footer">
                        <span class="day-total">Total del día: ${this.formatCurrency(dayTotal)}</span>
                    </div>
                </div>
            `;
        }

        // Render a single service
        renderService(service) {
            // Special rendering for transport services
            if (this.config.helpers.isTransport(service.type)) {
                return this.renderTransportService(service);
            }

            const isExcluded = service.includeInTotal === false;
            const price = this.getServicePrice(service);

            // Check for special badge labels
            let badgeLabel = this.config.helpers.getServiceBadgeLabel(service);
            if (service.type === 'tour' && service.isWalkingTour) {
                badgeLabel = 'Tour a Pie';
            } else if (service.type === 'experience' && this.isExperienceFromEstablishment(service)) {
                badgeLabel = 'Experiencia';
            }

            // Pick a start time (startTime → first time in selectedSchedule) and round to
            // the nearest 15-min mark so we can show the same grey-blue "Hora: HH:MM"
            // badge transports already display above the type label.
            let startTime = '';
            if (service.startTime) {
                startTime = service.startTime;
            } else if (service.selectedSchedule) {
                const timeMatch = String(service.selectedSchedule).match(/^(\d{1,2}:\d{2})/);
                if (timeMatch) startTime = timeMatch[1];
            } else if (service.time) {
                startTime = service.time;
            }
            const roundedTime = startTime ? this.roundTimeToNearest15(startTime) : '';

            // Clean service item with minimal styling
            let html = `<div class="service-item">`;

            // Service header row with title and price
            html += '<div class="d-flex justify-content-between align-items-start">';

            // Left side: Service info (keeping original structure)
            html += '<div class="service-info flex-grow-1">';

            // Rounded time badge at top (mirrors the transport renderer styling).
            if (roundedTime) {
                html += `<div class="mb-2">
                    <span class="service-badge info">
                        <i class="ti ti-clock me-1"></i>Hora: ${roundedTime}
                    </span>
                </div>`;
            }

            // Service badges and title on same line (keeping original layout)
            html += '<div class="d-flex align-items-center mb-2">';
            if (this.config.displayRules.shouldShowServiceBadge(service)) {
                // Use sage color scheme for service badges
                html += `<span class="service-badge me-2">${badgeLabel}</span>`;
            }
            if (isExcluded) {
                html += `<span class="service-badge external small me-2">Pago externo</span>`;
            }
            // Service title (keeping original structure)
            html += `<h6 class="mb-0 service-title">${this.getServiceTitle(service)}</h6>`;
            html += '</div>';

            html += '</div>'; // service-info

            // Price - use display rules to check if should show (restore original logic)
            if (this.config.displayRules.shouldShowPrice(service)) {
                html += '<div class="service-price text-end">';
                if (isExcluded) {
                    html += '<span class="service-badge external mb-1">Pago externo</span><br>';
                    html += `<div class="service-price excluded">${this.formatCurrency(price)}</div>`;
                } else {
                    html += `<div class="service-price">${this.formatCurrency(price)}</div>`;
                }
                html += '</div>';
            }

            html += '</div>'; // Close header row

            // Service details container - moved inside service-item for proper border positioning
            html += '<div class="service-details">';

            // Schedule. Para CONCEPTO con una sola hora no repetimos la línea: ya se muestra
            // arriba en el badge "Hora: HH:MM". Solo se muestra si es un rango (inicio – fin).
            // El resto de los tipos conservan el comportamiento previo.
            if (service.selectedSchedule || service.startTime) {
                const scheduleIsRange = (typeof service.selectedSchedule === 'string' && service.selectedSchedule.includes(' - '))
                    || (service.startTime && service.endTime);
                if (scheduleIsRange || service.type !== 'concepto') {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-clock me-1"></i>
                        ${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}
                    </div>`;
                }
            }

            // People quantities
            html += this.renderPeopleQuantities(service);

            // Duration (for tours)
            if (service.type === 'tour' && service.duration) {
                html += `<div class="service-detail-item mt-1">
                    <i class="ti ti-clock-hour-${service.duration || 1} me-1"></i>
                    <span>Duración: ${service.duration} ${service.duration === 1 ? 'hora' : 'horas'}</span>
                </div>`;
            }

            // Duration (for a-disposición)
            if (service.type === 'a-disposicion' && service.hours) {
                html += `<div class="service-detail-item mt-1">
                    <i class="ti ti-clock me-1"></i>
                    <span>Duración: ${service.hours} ${service.hours == 1 ? 'hora' : 'horas'}</span>
                </div>`;
            }

            // Vehicle info - standardized format like transport services
            const hasExtraVehicles = Array.isArray(service.extraAdditionalVehicles) && service.extraAdditionalVehicles.length > 0;
            if (service.vehicleId || service.vehicleType || service.vehicleTypeName ||
                (service.type === 'tour' && ((service.hasAdditionalVehicle && service.additionalVehicleId) || service.additionalVehicleTypeName)) ||
                hasExtraVehicles) {
                html += `<div class="mt-1">
                    <div class="mb-1">
                        <i class="ti ti-car me-1"></i>Vehículo(s):
                    </div>
                    ${(service.vehicleId || service.vehicleType || service.vehicleTypeName) ? `
                        <div class="ms-3">
                            <div class="d-flex align-items-center justify-content-between">
                                <span>
                                    <strong>${this.getVehicleDisplayName(service)}</strong>
                                    ${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` :
                            service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}
                                    ${this.getMainSegmentSuffix(service)}
                                </span>
                            </div>
                        </div>
                    ` : ''}
                    ${service.type === 'tour' && ((service.hasAdditionalVehicle && service.additionalVehicleId) || service.additionalVehicleTypeName) ? `
                        <div class="ms-3 mt-1">
                            <div class="d-flex align-items-center gap-2">
                                <span>
                                    <strong>${this.getAdditionalVehicleDisplayName(service)}</strong>${(() => { const n = this.getAdditionalSegmentName(service); return n ? ` - ${this.renderSegmentChip(n, this.getAdditionalSegmentColor(service))}` : ''; })()}
                                </span>
                            </div>
                        </div>
                    ` : ''}
                    ${service.type === 'a-disposicion' && Array.isArray(service.aDisposicionAdditionalVehicles) && service.aDisposicionAdditionalVehicles.length
                        ? service.aDisposicionAdditionalVehicles.map((av) => `
                        <div class="ms-3 mt-1">
                            <div class="d-flex align-items-center gap-2">
                                <span>
                                    <strong>${(((av && (av.vehicleLabel || av.vehicleType)) || 'Vehículo adicional').split(' - ')[0].trim())}</strong>${(av && av.segmentLabel) ? ` - ${this.renderSegmentChip(av.segmentLabel)}` : ''}
                                </span>
                            </div>
                        </div>
                    `).join('') : ''}
                    ${this.renderExtraAdditionalVehicleRows(service)}
                </div>`;
            }

            // Guide ("Incluye Guía" en todos los tipos; a-disposición se renombró de Chofer a Guía)
            if ((service.type === 'tour' || service.type === 'a-disposicion') && service.includeGuide) {
                html += `<div class="service-detail-item text-success mt-1">
                    <i class="ti ti-user me-1"></i>
                    <strong>Incluye Guía</strong>
                </div>`;
            }

            // Greeter (transporte, tours y a-disposición)
            if ((service.type === 'tour' || service.type === 'transport' || service.type === 'a-disposicion') && service.includeGreeter) {
                const greeterLocation = service.greeterInVehicle ? ' (en vehículo)' : '';
                html += `<div class="service-detail-item text-info mt-1">
                    <i class="ti ti-users me-1"></i>
                    <strong>Incluye Greeter${greeterLocation}</strong>
                </div>`;
            }

            // Note: "Verificar disponibilidad" warning is intentionally NOT rendered here.
            // It belongs only to the internal cotización (services edit) view; the summary /
            // public quote should never expose it to clients.

            // Notes (callout style — full-width gray background, text inside flows naturally).
            if (service.notes) {
                html += `<div class="mt-2 p-2" style="border-left: 3px solid #adb5bd; width: 100%;">
                    <div class="d-flex align-items-center mb-1">
                        <i class="ti ti-notes me-1 text-secondary"></i>
                        <strong class="text-secondary" style="font-size: 0.85rem;">Notas</strong>
                    </div>
                    <div class="text-dark" style="white-space: pre-line; word-break: break-word; font-size: 0.9rem;">${service.notes}</div>
                </div>`;
            }

            // Asistentes — same vehicle-style block (header + indented names per row).
            if (Array.isArray(service.attendees) && service.attendees.filter((n) => String(n).trim()).length > 0) {
                html += `<div class="mt-1 text-muted small">
                    <div class="mb-1">
                        <i class="ti ti-users me-1"></i><span class="text-muted">Asistentes:</span>
                    </div>
                    ${service.attendees.map((n) => String(n).trim()).filter(Boolean).map((name) => `
                        <div class="ms-3"><strong>${name}</strong></div>
                    `).join('')}
                </div>`;
            }

            html += '</div>'; // service-details

            // Actions (only in list mode)
            if (this.mode === 'list' && this.container) {
                html += this.renderServiceActions(service);
            }

            html += this.renderAssignmentsBlock(service);

            html += '</div>'; // service-item

            return html;
        }

        // Render transport service with special layout
        renderTransportService(service) {
            const isExcluded = service.includeInTotal === false;
            const price = this.getServicePrice(service);
            const typeColor = this.config.typeColors.transport;

            // Get transport specific info
            const transportTypes = {
                aeropuerto: 'Aeropuerto',
                'punto-a-punto': 'Punto a Punto',
                local: 'Local'
            };
            const transportLabel = transportTypes[service.transportType] || 'Transporte';

            // Extract and round flight time
            let flightTime = '';
            // For departure transport services, prefer suggested departure time
            if (service.type === 'transport' && service.directionType === 'departure' && service.flightDepartureTimeSuggested) {
                flightTime = service.flightDepartureTimeSuggested;
            } else if (service.startTime) {
                flightTime = service.startTime;
            } else if (service.selectedSchedule) {
                const timeMatch = service.selectedSchedule.match(/^(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    flightTime = timeMatch[1];
                }
            } else if (service.time) {
                // Fallback to time field (used in public quote view)
                flightTime = service.time;
            }
            const roundedTime = flightTime ? this.roundTimeToNearest15(flightTime) : '';

            // Get origin and destination
            let origin = service.originName || service.origin || 'Origen';
            let destination = service.destination || 'Destino';
            let specificLocation = service.specificLocation || '';

            // Extract specific location from embedded format
            if (!specificLocation) {
                if (origin.includes(',')) {
                    const parts = origin.split(',');
                    origin = parts[0].trim();
                    specificLocation = parts[1].trim();
                } else if (destination.includes(',')) {
                    const parts = destination.split(',');
                    destination = parts[0].trim();
                    specificLocation = parts[1].trim();
                }
            }

            // Direction labels
            // Match the modal labels in quote-services-v2.js
            const directionLabels = (() => {
                if (service.transportType === 'local') {
                    return { arrival: 'Llevar', departure: 'Recoger' };
                }
                // aeropuerto + punto-a-punto both use Llegada/Salida
                return { arrival: 'Llegada', departure: 'Salida' };
            })();

            // Clean transport service item with minimal styling
            let html = `<div class="service-item">`;

            // Service header row with title and price
            html += '<div class="d-flex justify-content-between align-items-start">';

            // Left side: Service info
            html += '<div class="service-info flex-grow-1">';

            // Rounded time badge at top if exists (matching main services view styling)
            if (roundedTime) {
                html += `<div class="mb-2">
                    <span class="service-badge info">
                        <i class="ti ti-clock me-1"></i>Hora: ${roundedTime}
                    </span>
                </div>`;
            }

            // Service badges
            html += '<div class="mb-2">';
            html += `<span class="service-badge me-2">Transporte</span>`;
            html += `<span class="service-badge secondary me-2">${transportLabel}</span>`;

            if (service.directionType) {
                const dirLabel = directionLabels[service.directionType];
                const badgeClass = service.directionType === 'arrival' ? 'service-badge info' : 'service-badge warning';
                html += `<span class="${badgeClass} me-2">${dirLabel}</span>`;
            }

            if (service.tripType === 'round-trip') {
                html += `<span class="service-badge info me-2"><i class="ti ti-arrows-left-right me-1"></i>Ida y Vuelta</span>`;
            }

            if (service.returnOrigin || service.returnDestination) {
                html += `<span class="service-badge secondary me-2"><i class="ti ti-link me-1"></i>Conexión</span>`;
            }

            if (isExcluded) {
                html += `<span class="service-badge external me-2">Pago externo</span>`;
            }
            html += '</div>';

            // Passenger quantities
            html += this.renderPeopleQuantities(service);

            // Service details
            html += '<div class="service-details mt-2">';

            // Origin and destination
            html += `<div class="service-detail-item">
                <i class="ti ti-circle-filled text-success me-1" style="font-size: 0.5rem;"></i>
                <span class="text-muted me-1">Desde:</span>
                ${origin}
            </div>`;
            html += `<div class="service-detail-item">
                <i class="ti ti-map-pin-filled text-danger me-1" style="font-size: 0.7rem;"></i>
                <span class="text-muted me-1">Hacia:</span>
                ${destination}
            </div>`;

            // Pickup / drop-off addresses (Punto a Punto + Local)
            const isPapOrLocal = service.transportType === 'punto-a-punto' || service.transportType === 'local';
            if (isPapOrLocal) {
                if (service.tripType === 'round-trip') {
                    // Per-leg addresses
                    if (service.pickupAddressIda || service.dropoffAddressIda) {
                        if (service.pickupAddressIda) {
                            html += `<div class="service-detail-item">
                                <i class="ti ti-map-pin-up me-1 text-success"></i>
                                <span class="text-muted me-1">Pick-up (ida):</span>${service.pickupAddressIda}
                            </div>`;
                        }
                        if (service.dropoffAddressIda) {
                            html += `<div class="service-detail-item">
                                <i class="ti ti-map-pin-down me-1 text-danger"></i>
                                <span class="text-muted me-1">Drop-off (ida):</span>${service.dropoffAddressIda}
                            </div>`;
                        }
                    }
                    if (service.pickupAddressVuelta || service.dropoffAddressVuelta) {
                        if (service.pickupAddressVuelta) {
                            html += `<div class="service-detail-item">
                                <i class="ti ti-map-pin-up me-1 text-success"></i>
                                <span class="text-muted me-1">Pick-up (regreso):</span>${service.pickupAddressVuelta}
                            </div>`;
                        }
                        if (service.dropoffAddressVuelta) {
                            html += `<div class="service-detail-item">
                                <i class="ti ti-map-pin-down me-1 text-danger"></i>
                                <span class="text-muted me-1">Drop-off (regreso):</span>${service.dropoffAddressVuelta}
                            </div>`;
                        }
                    }
                } else {
                    // One-way addresses
                    if (service.pickupAddress) {
                        html += `<div class="service-detail-item">
                            <i class="ti ti-map-pin-up me-1 text-success"></i>
                            <span class="text-muted me-1">Pick-up:</span>${service.pickupAddress}
                        </div>`;
                    }
                    if (service.dropoffAddress) {
                        html += `<div class="service-detail-item">
                            <i class="ti ti-map-pin-down me-1 text-danger"></i>
                            <span class="text-muted me-1">Drop-off:</span>${service.dropoffAddress}
                        </div>`;
                    }
                }
            }

            // Airline info
            if (service.transportType === 'aeropuerto') {
                if (service.airline) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-plane me-1"></i>
                        <span class="text-muted me-1">Aerolínea:</span>
                        ${service.airline}
                    </div>`;
                }
                if (service.flightNumber) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-ticket me-1"></i>
                        <span class="me-1">Número de vuelo:</span>
                        ${service.flightNumber}
                    </div>`;
                }
                // Additional flights — same vehicle-style block (header + indented rows)
                if (Array.isArray(service.additionalFlights) && service.additionalFlights.length > 0) {
                    html += `<div class="mt-1 text-muted small">
                        <div class="mb-1">
                            <i class="ti ti-plane me-1"></i><span class="text-muted">Vuelos adicionales:</span>
                        </div>
                        ${service.additionalFlights.map((f) => {
                            const airline = (f.airline || '').trim();
                            const number = (f.flightNumber || '').trim();
                            const time = (f.flightTime || '').trim();
                            const label = [airline, number].filter(Boolean).join(' ') || 'Vuelo';
                            return `<div class="ms-3"><strong>${label}</strong>${time ? ` <span class="text-muted">— ${time}</span>` : ''}</div>`;
                        }).join('')}
                    </div>`;
                }
            }

            // Schedule time
            if (service.selectedSchedule || service.startTime || service.time) {
                const timeLabel = this.config.displayRules.getScheduleLabel(service);
                const timeValue = service.selectedSchedule || service.startTime || service.time;
                html += `<div class="service-detail-item">
                    <i class="ti ti-clock me-1"></i>
                    ${timeLabel} ${timeValue}
                </div>`;
            }

            // Departure time suggestions - only show for departure services (not arrivals)
            if (this.config.displayRules.shouldShowDepartureTime(service)) {
                if (service.transportType === 'aeropuerto' && service.flightDepartureTimeSuggested) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-clock me-1"></i>
                        <span class="me-1">Horario de salida:</span>
                        ${service.flightDepartureTimeSuggested}
                    </div>`;
                }
            }

            // Round trip departure times - only show for departure services
            if (this.config.displayRules.shouldShowRoundTripFields(service)) {
                if (service.roundTripDepartureTimeSuggestedIda) {
                    html += `<div class="service-detail-item text-info">
                        <i class="ti ti-clock-check me-1"></i>
                        <span class="text-muted">Salida ida:</span> ${service.roundTripDepartureTimeSuggestedIda}
                    </div>`;
                }
                if (service.roundTripDepartureTimeSuggestedVuelta) {
                    html += `<div class="service-detail-item text-info">
                        <i class="ti ti-clock-check me-1"></i>
                        <span class="text-muted">Salida vuelta:</span> ${service.roundTripDepartureTimeSuggestedVuelta}
                    </div>`;
                }

                // Round trip dates
                if (service.startDate || service.endDate) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-calendar me-1"></i>
                        <span class="text-muted">Fechas:</span> ${service.startDate || ''} - ${service.endDate || ''}
                    </div>`;
                }

                // Return flight info
                if (service.returnAirline || service.returnFlightNumber) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-plane-return me-1"></i>
                        <span class="text-muted">Vuelo retorno:</span> ${service.returnAirline || ''} ${service.returnFlightNumber || ''}
                    </div>`;
                }
            }

            // Route duration is kept in data for pricing calculations but not displayed in UI

            // Specific location
            if (specificLocation) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-map-pin me-1"></i>
                    <span class="text-muted me-1">Dirección de llegada:</span>
                    ${specificLocation}
                </div>`;
            }

            // Vehicles
            const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;
            const hasAdditional = service.additionalVehicleId || service.additionalVehicleTypeName;
            const hasExtraVehicles = Array.isArray(service.extraAdditionalVehicles) && service.extraAdditionalVehicles.length > 0;

            if (hasVehicle || hasAdditional || hasExtraVehicles) {
                html += '<div class="mt-2">';
                html += '<div class="service-detail-item mb-1">';
                html += '<i class="ti ti-car me-1"></i>Vehículo(s):';
                html += '</div>';

                if (hasVehicle) {
                    const vehicleName = this.getVehicleDisplayName(service);
                    const segmentName = this.getMainSegmentSuffix(service);
                    html += `<div style="margin-left: 20px;">
                        <strong>${vehicleName}</strong>${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` :
                            service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}${segmentName}
                    </div>`;
                }

                if (hasAdditional) {
                    const additionalName = this.cleanVehicleName(this.getAdditionalVehicleDisplayName(service));
                    const additionalSegmentName = this.getAdditionalSegmentName(service);
                    const additionalSegment = additionalSegmentName
                        ? ` - ${this.renderSegmentChip(additionalSegmentName, this.getAdditionalSegmentColor(service))}`
                        : '';
                    html += `<div style="margin-left: 20px; margin-top: 4px;">
                        <strong>${additionalName}</strong>${additionalSegment}
                    </div>`;
                }
                // Extra additional vehicles (Phase 3 multi-vehicle support)
                if (Array.isArray(service.extraAdditionalVehicles) && service.extraAdditionalVehicles.length > 0) {
                    service.extraAdditionalVehicles.forEach((v) => {
                        const name = (v && (v.vehicleTypeName || '')).trim() || 'Vehículo adicional';
                        const segName = (v && v.segmentName) || (v && v.segment ? this.getCategoryNameFromCache(v.segment) : '');
                        const cleanSegName = segName && segName !== v.segment ? segName : '';
                        const segColor = (v && v.segmentColor) || (v && v.segment ? this.getCategoryColorFromCache(v.segment) : '');
                        const chip = cleanSegName ? ` - ${this.renderSegmentChip(cleanSegName, segColor)}` : '';
                        html += `<div style="margin-left: 20px; margin-top: 4px;">
                            <strong>${name}</strong>${chip}
                        </div>`;
                    });
                }
                html += '</div>';
            }

            // Guide (label differs: a-disposicion → Chofer, tours/experiences → Guía)
            if (service.includeGuide) {
                const guideLabel = service.type === 'a-disposicion' ? 'Incluye Chofer' : 'Incluye Guía';
                html += `<div class="service-detail-item text-success mt-1">
                    <i class="ti ti-user me-1"></i>
                    <strong>${guideLabel}</strong>
                </div>`;
            }

            // Greeter
            if (service.includeGreeter) {
                const greeterLocation = service.greeterInVehicle ? ' (en vehículo)' : '';
                html += `<div class="service-detail-item text-info mt-1">
                    <i class="ti ti-users me-1"></i>
                    <strong>Incluye Greeter${greeterLocation}</strong>
                </div>`;
            }

            // Waiting time
            if (service.waitingTimeHours > 0) {
                html += `<div class="service-detail-item text-warning mt-1">
                    <i class="ti ti-clock me-1"></i>
                    <strong>Tiempo de espera: ${service.waitingTimeHours}h</strong>
                </div>`;
            }

            html += '</div>'; // service-details
            html += '</div>'; // service-info

            // Price - transport services always show price (restore original logic)
            if (this.config.displayRules.shouldShowPrice(service)) {
                html += '<div class="service-price text-end">';
                if (isExcluded) {
                    html += '<span class="service-badge external mb-1">Pago externo</span><br>';
                    html += `<div class="service-price excluded">${this.formatCurrency(price)}</div>`;
                } else {
                    html += `<div class="service-price">${this.formatCurrency(price)}</div>`;
                }
                html += '</div>';
            }

            html += '</div>'; // Close header row

            // Notes (callout) — placed outside the info/price flex row so the gray
            // background spans the full service-item width.
            if (service.notes) {
                html += `<div class="mt-2 p-2" style="border-left: 3px solid #adb5bd;">
                    <div class="d-flex align-items-center mb-1">
                        <i class="ti ti-notes me-1 text-secondary"></i>
                        <strong class="text-secondary" style="font-size: 0.85rem;">Notas</strong>
                    </div>
                    <div class="text-dark" style="white-space: pre-line; word-break: break-word; font-size: 0.9rem;">${service.notes}</div>
                </div>`;
            }

            // Asistentes — same vehicle-style block (header + indented names per row).
            if (Array.isArray(service.attendees) && service.attendees.filter((n) => String(n).trim()).length > 0) {
                html += `<div class="mt-2 text-muted small">
                    <div class="mb-1">
                        <i class="ti ti-users me-1"></i><span class="text-muted">Asistentes:</span>
                    </div>
                    ${service.attendees.map((n) => String(n).trim()).filter(Boolean).map((name) => `
                        <div class="ms-3"><strong>${name}</strong></div>
                    `).join('')}
                </div>`;
            }

            // Actions (only in list mode)
            if (this.mode === 'list' && this.container) {
                html += this.renderServiceActions(service);
            }

            html += this.renderAssignmentsBlock(service);

            html += '</div>'; // service-item

            return html;
        }

        // Render service details based on type
        renderServiceDetails(service) {
            let html = '';

            // Schedule
            if (service.selectedSchedule || service.startTime) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-clock me-1"></i>
                    ${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}
                </div>`;
            }

            // Duration (for tours)
            if (service.type === 'tour' && service.duration) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-clock-hour-${service.duration || 1} me-1"></i>
                    <span>Duración: ${service.duration} ${service.duration === 1 ? 'hora' : 'horas'}</span>
                </div>`;
            }

            // Duration (for a-disposición)
            if (service.type === 'a-disposicion' && service.hours) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-clock me-1"></i>
                    <span>Duración: ${service.hours} ${service.hours == 1 ? 'hora' : 'horas'}</span>
                </div>`;
            }

            // Vehicle info - standardized format like transport services
            if (service.vehicleId || service.vehicleType || service.vehicleTypeName ||
                (service.type === 'tour' && service.additionalVehicleId)) {
                html += `<div>
                    <div class="mb-1">
                        <i class="ti ti-car me-1"></i>Vehículo(s):
                    </div>
                    ${(service.vehicleId || service.vehicleType || service.vehicleTypeName) ? `
                        <div class="ms-3">
                            <span>
                                <strong>${this.getVehicleDisplayName(service)}</strong>
                                ${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` :
                            service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}
                                ${this.getMainSegmentSuffix(service)}
                            </span>
                        </div>
                    ` : ''}
                    ${service.type === 'tour' && service.additionalVehicleId ? `
                        <div class="ms-3 mt-1">
                            <span>
                                <strong>${this.getAdditionalVehicleDisplayName(service)}</strong>${(() => { const n = this.getAdditionalSegmentName(service); return n ? ` - ${this.renderSegmentChip(n, this.getAdditionalSegmentColor(service))}` : ''; })()}
                            </span>
                        </div>
                    ` : ''}
                    ${this.renderExtraAdditionalVehicleRows(service)}
                </div>`;
            }

            // Guide (label differs: a-disposicion → Chofer, tours/experiences → Guía)
            if ((service.type === 'tour' || service.type === 'a-disposicion') && service.includeGuide) {
                const guideLabel = service.type === 'a-disposicion' ? 'Incluye Chofer' : 'Incluye Guía';
                html += `<div class="service-detail-item text-success">
                    <i class="ti ti-user me-1"></i>
                    <strong>${guideLabel}</strong>
                </div>`;
            }

            // Greeter
            if ((service.type === 'tour' || service.type === 'transport') && service.includeGreeter) {
                html += `<div class="service-detail-item text-info">
                    <i class="ti ti-users me-1"></i>
                    <strong>Incluye Greeter</strong>
                </div>`;
            }

            // Waiting time
            if (service.type === 'transport' && service.waitingTimeHours > 0) {
                html += `<div class="service-detail-item text-warning">
                    <i class="ti ti-clock me-1"></i>
                    <strong>Tiempo de espera: ${service.waitingTimeHours}h</strong>
                </div>`;
            }

            // Transport-specific details
            if (this.config.helpers.isTransport(service.type)) {
                html += this.renderTransportDetails(service);
            }

            // Note: "Verificar disponibilidad" warning is intentionally NOT rendered here.
            // It belongs only to the internal cotización (services edit) view; the summary /
            // public quote should never expose it to clients.

            return html;
        }

        // Render transport-specific details
        renderTransportDetails(service) {
            let html = '';

            // Origin and destination
            const origin = this.getTransportLocation(service, 'origin');
            const destination = this.getTransportLocation(service, 'destination');

            if (origin) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-circle-filled text-success me-1" style="font-size: 0.5rem;"></i>
                    <span class="text-muted me-1">Desde:</span>
                    ${origin}
                </div>`;
            }

            if (destination) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-map-pin-filled text-danger me-1" style="font-size: 0.7rem;"></i>
                    <span class="text-muted me-1">Hacia:</span>
                    ${destination}
                </div>`;
            }

            // Flight info
            if (service.transportType === 'aeropuerto') {
                if (service.airline) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-plane me-1"></i>
                        <span class="text-muted me-1">Aerolínea:</span>
                        ${service.airline}
                    </div>`;
                }
                if (service.flightNumber) {
                    html += `<div class="service-detail-item">
                        <i class="ti ti-ticket me-1"></i>
                        <span class="text-muted me-1">Vuelo:</span>
                        ${service.flightNumber}
                    </div>`;
                }
            }

            return html;
        }

        // Render people quantities for services
        renderPeopleQuantities(service) {
            const adults = service.adultsQuantity || service.transportAdults || 0;
            const children = service.childrenQuantity || service.transportChildren || 0;
            const infants = service.infantsQuantity || service.transportInfants || 0;
            const noAlcohol = service.adultsNoAlcoholQuantity || 0;

            if (adults === 0 && children === 0 && infants === 0 && noAlcohol === 0) {
                return '';
            }

            let html = '<div class="passenger-badges d-flex align-items-center text-muted small mb-1">';

            if (adults > 0) {
                const config = this.config.passengerTypes.adults;
                html += `<span class="${this.getPassengerBadgeClass('adults')}">
                    <i class="${config.icon} fs-6"></i>
                    <span>${adults} ${adults > 1 ? config.pluralLabel : config.label}</span>
                </span>`;
            }

            if (children > 0) {
                const config = this.config.passengerTypes.children;
                html += `<span class="${this.getPassengerBadgeClass('children')}">
                    <i class="${config.icon} fs-6"></i>
                    <span>${children} ${children > 1 ? config.pluralLabel : config.label}</span>
                </span>`;
            }

            if (infants > 0) {
                const config = this.config.passengerTypes.infants;
                html += `<span class="${this.getPassengerBadgeClass('infants')}">
                    <i class="${config.icon} fs-6"></i>
                    <span>${infants} ${infants > 1 ? config.pluralLabel : config.label}</span>
                </span>`;
            }

            if (noAlcohol > 0) {
                const config = this.config.passengerTypes.adultsNoAlcohol;
                html += `<span class="${this.getPassengerBadgeClass('adultsNoAlcohol')}">
                    <i class="${config.icon} fs-6"></i>
                    <span>${noAlcohol} ${config.label}</span>
                </span>`;
            }

            html += '</div>';
            return html;
        }

        // Render people quantities simplified for minimal layout
        renderPeopleQuantitiesSimple(service) {
            const adults = service.adultsQuantity || service.transportAdults || 0;
            const children = service.childrenQuantity || service.transportChildren || 0;
            const infants = service.infantsQuantity || service.transportInfants || 0;
            const noAlcohol = service.adultsNoAlcoholQuantity || 0;

            if (adults === 0 && children === 0 && infants === 0 && noAlcohol === 0) {
                return '';
            }

            const parts = [];
            if (adults > 0) parts.push(`${adults} adulto${adults > 1 ? 's' : ''}`);
            if (children > 0) parts.push(`${children} niño${children > 1 ? 's' : ''}`);
            if (infants > 0) parts.push(`${infants} infante${infants > 1 ? 's' : ''}`);
            if (noAlcohol > 0) parts.push(`${noAlcohol} sin alcohol`);

            return `<i class="ti ti-users me-1"></i>${parts.join(' • ')}`;
        }

        // Render passenger badges
        renderPassengerBadges(passengers) {
            let html = '<div class="passenger-badges">';

            if (passengers.adults > 0) {
                const config = this.config.passengerTypes.adults;
                html += `<span class="service-badge" style="background: ${config.color}15; color: ${config.color};">
                    <i class="${config.icon} me-1" style="font-size: 0.8rem;"></i>
                    ${passengers.adults} ${passengers.adults > 1 ? config.pluralLabel : config.label}
                </span>`;
            }

            if (passengers.children > 0) {
                const config = this.config.passengerTypes.children;
                html += `<span class="service-badge" style="background: ${config.color}15; color: ${config.color};">
                    <i class="${config.icon} me-1" style="font-size: 0.8rem;"></i>
                    ${passengers.children} ${passengers.children > 1 ? config.pluralLabel : config.label}
                </span>`;
            }

            if (passengers.infants > 0) {
                const config = this.config.passengerTypes.infants;
                html += `<span class="service-badge" style="background: ${config.color}15; color: ${config.color};">
                    <i class="${config.icon} me-1" style="font-size: 0.8rem;"></i>
                    ${passengers.infants} ${passengers.infants > 1 ? config.pluralLabel : config.label}
                </span>`;
            }

            if (passengers.noAlcohol > 0) {
                const config = this.config.passengerTypes.adultsNoAlcohol;
                html += `<span class="service-badge" style="background: ${config.color}15; color: ${config.color};">
                    <i class="${config.icon} me-1" style="font-size: 0.8rem;"></i>
                    ${passengers.noAlcohol} ${config.label}
                </span>`;
            }

            html += '</div>';
            return html;
        }

        // Render assignments block (reservation-only: chofer, vehículo, guía, greeter, extras, seguidor).
        // Returns empty string when service.assignments is not present (e.g. quotes).
        renderAssignmentsBlock(service) {
            const a = service && service.assignments;
            if (!a) return '';
            const hasAny = a.driver || a.vehicle || a.guide || a.greeter || a.serviceCustomer
                || (Array.isArray(a.extras) && a.extras.some((e) => e.driver || e.vehicle));
            if (!hasAny) return '';

            // Build initials from a name (e.g. "Test 1 Driver" → "TD")
            const initials = (name) => {
                if (!name) return '?';
                const parts = String(name).trim().split(/\s+/);
                if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            };
            // Deterministic background color from a string (gives each user a stable hue)
            const colorFromName = (name) => {
                let h = 0;
                const s = String(name || '');
                for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
                const palette = ['#7c8473', '#a39160', '#71909a', '#a67c52', '#8b6f8b', '#6b8b6b'];
                return palette[Math.abs(h) % palette.length];
            };

            // Avatar with photo fallback to colored initials
            const avatar = (person, size = 40) => {
                if (person && person.profilePhotoUrl) {
                    return `<img src="${person.profilePhotoUrl}"
                        alt="${person.fullName || ''}"
                        onerror="this.outerHTML='${this._escapeAttr(this.initialsAvatarHTML(person.fullName, size))}'"
                        style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1px solid #e9ecef;flex-shrink:0;">`;
                }
                return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colorFromName(person?.fullName)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size * 0.4)}px;flex-shrink:0;letter-spacing:0.02em;">${initials(person?.fullName)}</div>`;
            };

            // Vehicle thumb: image or clean car icon
            const vehicleThumb = (vehicle, w = 56, h = 42) => {
                if (vehicle && vehicle.imageUrl) {
                    return `<img src="${vehicle.imageUrl}" alt="${vehicle.name || ''}"
                        onerror="this.outerHTML='${this._escapeAttr(this.vehiclePlaceholderHTML(w, h))}'"
                        style="width:${w}px;height:${h}px;object-fit:cover;border-radius:4px;border:1px solid #e9ecef;flex-shrink:0;">`;
                }
                return this.vehiclePlaceholderHTML(w, h);
            };

            const contactLine = (person) => {
                if (!person) return '';
                const bits = [];
                if (person.phone) bits.push(`<span><i class="ti ti-phone" style="font-size:0.78rem;opacity:0.7;"></i> ${person.phone}</span>`);
                if (person.email) bits.push(`<span><i class="ti ti-mail" style="font-size:0.78rem;opacity:0.7;"></i> ${person.email}</span>`);
                if (bits.length === 0) return '';
                return `<div class="text-muted d-flex flex-wrap" style="font-size:0.72rem;gap:0.5rem;margin-top:2px;">${bits.join('')}</div>`;
            };

            // Half-card: person (driver). Sin label — el ícono y el avatar lo identifican.
            const halfPerson = (person) => {
                if (!person) {
                    return `
                        <div class="d-flex align-items-center gap-2 flex-grow-1" style="min-width:0;">
                            <div style="width:40px;height:40px;border-radius:50%;background:#eef0f2;display:flex;align-items:center;justify-content:center;color:#adb5bd;flex-shrink:0;">
                                <i class="ti ti-user"></i>
                            </div>
                            <div style="font-size:0.85rem;line-height:1.25;min-width:0;color:#adb5bd;font-style:italic;">Sin chofer</div>
                        </div>`;
                }
                return `
                    <div class="d-flex align-items-center gap-2 flex-grow-1" style="min-width:0;">
                        ${avatar(person, 40)}
                        <div style="font-size:0.85rem;line-height:1.25;min-width:0;">
                            <div class="fw-semibold text-truncate" style="color:#212529;">${person.fullName || '—'}</div>
                            ${contactLine(person)}
                        </div>
                    </div>`;
            };

            // Half-card: vehicle.
            const halfVehicle = (vehicle) => {
                if (!vehicle) {
                    return `
                        <div class="d-flex align-items-center gap-2 flex-grow-1" style="min-width:0;">
                            ${this.vehiclePlaceholderHTML(56, 42)}
                            <div style="font-size:0.85rem;line-height:1.25;min-width:0;color:#adb5bd;font-style:italic;">Sin vehículo</div>
                        </div>`;
                }
                const meta = [vehicle.plate, vehicle.color, vehicle.year].filter(Boolean).join(' · ');
                return `
                    <div class="d-flex align-items-center gap-2 flex-grow-1" style="min-width:0;">
                        ${vehicleThumb(vehicle)}
                        <div style="font-size:0.85rem;line-height:1.25;min-width:0;">
                            <div class="fw-semibold text-truncate" style="color:#212529;">${vehicle.name || '—'}</div>
                            ${meta ? `<div class="text-muted text-truncate" style="font-size:0.72rem;margin-top:2px;">${meta}</div>` : ''}
                        </div>
                    </div>`;
            };

            // Pair card with optional segment chip in the corner
            const pairCard = (slotIndex, driver, vehicle, segmentName) => {
                // Segmento sin color: badge neutro (se removió el color por segmento).
                const segChip = segmentName
                    ? `<span class="badge" style="background:#f1f3f4;color:#5f6368;font-size:0.65rem;font-weight:500;padding:2px 8px;letter-spacing:0.03em;">${segmentName}</span>`
                    : '';
                const slotChip = `<span class="text-muted" style="font-size:0.7rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">${slotIndex === 1 ? 'Vehículo principal' : `Vehículo adicional ${slotIndex - 1}`}</span>`;
                return `
                    <div class="border rounded bg-white assignment-card" style="overflow:hidden;">
                        <div class="d-flex justify-content-between align-items-center px-2 py-1" style="background:#fafbfc;border-bottom:1px solid #eef0f2;">
                            ${slotChip}
                            ${segChip}
                        </div>
                        <div class="d-flex align-items-stretch p-2" style="gap:0.75rem;">
                            ${halfPerson(driver)}
                            <div style="width:1px;background:#eef0f2;"></div>
                            ${halfVehicle(vehicle)}
                        </div>
                    </div>`;
            };

            // Standalone card for guide / greeter / service customer
            const standaloneCard = (label, icon, person) => {
                if (!person) return '';
                return `
                    <div class="border rounded bg-white p-2 d-flex align-items-center gap-2 assignment-card">
                        ${avatar(person, 40)}
                        <div style="font-size:0.85rem;line-height:1.25;min-width:0;flex-grow:1;">
                            <div class="text-muted" style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;"><i class="ti ${icon} me-1"></i>${label}</div>
                            <div class="fw-semibold text-truncate" style="color:#212529;">${person.fullName || '—'}</div>
                            ${contactLine(person)}
                        </div>
                    </div>`;
            };

            const pairCards = [];
            // Main slot (driver + vehicle) — always slot 1 if either exists
            if (a.driver || a.vehicle) {
                pairCards.push(pairCard(1, a.driver, a.vehicle, null, null));
            }
            // Extras
            if (Array.isArray(a.extras)) {
                a.extras.forEach((extra, idx) => {
                    if (!extra.driver && !extra.vehicle) return;
                    pairCards.push(pairCard(idx + 2, extra.driver, extra.vehicle, extra.segmentName, extra.segmentColor));
                });
            }

            const standaloneCards = [];
            if (a.guide) standaloneCards.push(standaloneCard('Guía', 'ti-id-badge-2', a.guide));
            if (a.greeter) standaloneCards.push(standaloneCard('Greeter', 'ti-hand-stop', a.greeter));
            if (a.serviceCustomer) standaloneCards.push(standaloneCard('Seguidor de servicio', 'ti-eye', a.serviceCustomer));

            const pairGridHtml = pairCards.length
                ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:0.5rem;">${pairCards.join('')}</div>`
                : '';
            const standaloneGridHtml = standaloneCards.length
                ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0.5rem;margin-top:${pairCards.length ? '0.5rem' : '0'};">${standaloneCards.join('')}</div>`
                : '';

            return `
                <div class="mt-2 p-2 assignments-block" style="background:#f8f9fa;border-left:3px solid #969b81;border-radius:0 4px 4px 0;">
                    <div class="d-flex align-items-center mb-2 assignments-header" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:#6c757d;font-weight:600;">
                        <i class="ti ti-user-check me-1"></i>Asignaciones
                    </div>
                    ${pairGridHtml}
                    ${standaloneGridHtml}
                </div>
            `;
        }

        // Small HTML helpers for the assignments block (kept on the prototype so the inline
        // onerror handlers above can reach them through `this.*`).
        initialsAvatarHTML(name, size = 40) {
            const palette = ['#7c8473', '#a39160', '#71909a', '#a67c52', '#8b6f8b', '#6b8b6b'];
            let h = 0;
            const s = String(name || '');
            for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
            const bg = palette[Math.abs(h) % palette.length];
            const parts = s.trim().split(/\s+/).filter(Boolean);
            let init = '?';
            if (parts.length === 1) init = parts[0].slice(0, 2).toUpperCase();
            else if (parts.length > 1) init = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size * 0.4)}px;flex-shrink:0;">${init}</div>`;
        }

        vehiclePlaceholderHTML(w = 56, h = 42) {
            return `<div style="width:${w}px;height:${h}px;border-radius:4px;background:#eef0f2;display:flex;align-items:center;justify-content:center;color:#adb5bd;flex-shrink:0;"><i class="ti ti-car" style="font-size:1.1rem;"></i></div>`;
        }

        _escapeAttr(s) {
            return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
        }

        // Render service actions (edit, duplicate, delete buttons)
        renderServiceActions(service) {
            return `
                <div class="service-actions">
                    <button type="button" class="btn btn-sm btn-light edit-service-btn"
                            data-day-id="${service.dayId}" data-service-id="${service.id}" title="Editar">
                        <i class="ti ti-pencil"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-light duplicate-service-btn"
                            data-service-id="${service.id}" title="Duplicar">
                        <i class="ti ti-copy"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-light delete-service-btn"
                            data-service-id="${service.id}" title="Eliminar">
                        <i class="ti ti-trash"></i>
                    </button>
                </div>
            `;
        }


        // Helper: Round time DOWN to previous 15-minute interval (matches admin services view)
        roundTimeToNearest15(timeStr) {
            if (!timeStr || !timeStr.includes(':')) return timeStr || '';
            const [hours, minutes] = timeStr.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) return timeStr;
            let totalMinutes = hours * 60 + minutes;
            totalMinutes = Math.floor(totalMinutes / 15) * 15;
            const roundedHours = Math.floor(totalMinutes / 60) % 24;
            const roundedMinutes = totalMinutes % 60;
            return `${String(roundedHours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
        }

        // Helper: Get service title
        getServiceTitle(service) {
            // For a-disposición, return empty to avoid redundancy (vehicle shown below)
            if (service.type === 'a-disposicion') return '';

            // Establishment experiences: append "- ProviderName" to match the dropdown format
            const isEstablishmentExp = service.type === 'experience'
                && (service.providerType || '').toLowerCase() === 'establishment'
                && service.providerName;

            let base = service.concept || service.experienceName || service.tourName || service.name;
            if (base) {
                if (isEstablishmentExp && !base.includes(` - ${service.providerName}`)) {
                    base = `${base} - ${service.providerName}`;
                }
                return base;
            }

            // For transport, build title from route
            if (this.config.helpers.isTransport(service.type)) {
                const origin = this.getTransportLocation(service, 'origin', true);
                const destination = this.getTransportLocation(service, 'destination', true);
                if (origin && destination) {
                    return `${origin} → ${destination}`;
                }
            }

            return this.config.typeLabels[service.type] || 'Servicio';
        }

        // Helper: Get transport location
        getTransportLocation(service, type, short = false) {
            let location = '';

            if (type === 'origin') {
                location = service.origin || service.transportOrigin || '';
            } else {
                location = service.destination || service.transportDestination || '';
            }

            // Extract location from embedded format
            if (location.includes(' - ')) {
                const parts = location.split(' - ');
                location = short ? parts[0] : location;
            }

            return location;
        }

        // Helper: Get vehicle display name
        getVehicleDisplayName(service) {
            let name = service.vehicleTypeName || service.vehicleType || 'Vehículo seleccionado';
            // Clean vehicle name - remove capacity info like "- 4 pax"
            if (name && typeof name === 'string') {
                name = name.split(' - ')[0].trim();
            }
            return name;
        }

        // Helper: Get additional vehicle display name
        getAdditionalVehicleDisplayName(service) {
            return service.additionalVehicleTypeName || service.additionalVehicleType || 'Vehículo adicional';
        }

        // Helper: Clean vehicle name
        cleanVehicleName(name) {
            if (!name) return '';
            // Remove redundant "Vehículo: " prefix if present
            return name.replace(/^Vehículo:\s*/i, '').trim();
        }

        // Helper: Get category name with auto-refetch capability
        async getCategoryName(categoryId) {
            if (!categoryId) return 'Segmento';

            // First try cached rates
            const cachedResult = this.getCategoryNameFromCache(categoryId);
            if (cachedResult !== categoryId) {
                return cachedResult; // Found in cache
            }

            // If not found and cache is empty/null, try to fetch rates
            if (!this.ratesCache || this.ratesCache.length === 0) {
                console.log('🔄 ServicesRenderer: No rates cache, attempting to fetch rates...');
                await this.fetchRatesIfMissing();

                // Try again with fresh cache
                const retryResult = this.getCategoryNameFromCache(categoryId);
                if (retryResult !== categoryId) {
                    return retryResult;
                }
            }

            // If still not found, check if we should refresh cache
            if (this.shouldRefreshRatesCache()) {
                console.log('🔄 ServicesRenderer: Refreshing rates cache for missing segment:', categoryId);
                await this.refreshRatesCache();

                // Final attempt
                const finalResult = this.getCategoryNameFromCache(categoryId);
                if (finalResult !== categoryId) {
                    return finalResult;
                }
            }

            // Last resort: return the ID itself with comprehensive logging
            console.warn('❌ ServicesRenderer: Unmapped segment ID after all attempts:', {
                categoryId,
                cacheSize: this.ratesCache?.length || 0,
                cacheKeys: this.ratesCache?.map(r => r.value || r.objectId || r.id) || []
            });
            return categoryId;
        }

        // Helper: Get category name from cache only (synchronous)
        // Helper: Resolve the additional-vehicle segment name with cache fallback.
        // Prefer the saved name, then look up the ID via segmentMappings / ratesCache.
        getAdditionalSegmentName(service) {
            if (service && service.additionalVehicleSegmentName) {
                return service.additionalVehicleSegmentName;
            }
            const segmentId = service && service.additionalVehicleSegment;
            if (!segmentId) return '';
            const resolved = this.getCategoryNameFromCache(segmentId);
            // getCategoryNameFromCache returns the ID itself when unmapped; treat that as empty.
            return resolved && resolved !== segmentId ? resolved : '';
        }

        // Helper: Resolve a segment's rate color (hex) by ID using the same caches.
        // Returns '' if not found.
        getCategoryColorFromCache(categoryId) {
            if (!categoryId) return '';
            if (this.ratesCache && this.ratesCache.length > 0) {
                const rate = this.ratesCache.find(r =>
                    r.value === categoryId || r.objectId === categoryId || r.id === categoryId);
                if (rate && rate.color) return rate.color;
            }
            return '';
        }

        // Helper: Render the extra additional vehicles (Phase 3 multi-vehicle support).
        // Each row uses the same indented + chip pattern as the primary additional vehicle.
        renderExtraAdditionalVehicleRows(service) {
            const list = (service && Array.isArray(service.extraAdditionalVehicles))
                ? service.extraAdditionalVehicles : [];
            if (list.length === 0) return '';
            return list.map((v) => {
                const name = (v && (v.vehicleTypeName || '')).trim() || 'Vehículo adicional';
                const segmentName = (v && v.segmentName) || (v && v.segment ? this.getCategoryNameFromCache(v.segment) : '');
                const cleanSegment = segmentName && segmentName !== v.segment ? segmentName : '';
                const segmentColor = (v && v.segmentColor) || (v && v.segment ? this.getCategoryColorFromCache(v.segment) : '');
                const chip = cleanSegment ? ` - ${this.renderSegmentChip(cleanSegment, segmentColor)}` : '';
                return `<div class="ms-3 mt-1">
                    <div class="d-flex align-items-center gap-2">
                        <span><strong>${name}</strong>${chip}</span>
                    </div>
                </div>`;
            }).join('');
        }

        // Helper: Resolve the additional-vehicle segment color with cache fallback.
        getAdditionalSegmentColor(service) {
            if (service && service.additionalVehicleSegmentColor) {
                return service.additionalVehicleSegmentColor;
            }
            const segmentId = service && service.additionalVehicleSegment;
            return segmentId ? this.getCategoryColorFromCache(segmentId) : '';
        }

        // Helper: Render a segment name as a small colored chip.
        // Segmento sin color: badge neutro (se removió el color por segmento). Se conserva el
        // segundo parámetro por compatibilidad con los callers, pero ya no se usa.
        renderSegmentChip(name) {
            if (!name) return '';
            return `<span class="badge ms-1" style="background-color: #f1f3f4; color: #5f6368; font-weight: 500;">${name}</span>`;
        }

        // Helper: Resolve main segment name + color and return the formatted " - <chip>" suffix.
        getMainSegmentSuffix(service) {
            const id = (service && (service.rateId || service.category)) || '';
            const name = service && service.categoryName
                ? service.categoryName
                : (id ? this.getCategoryNameFromCache(id) : '');
            // getCategoryNameFromCache returns the ID itself when unmapped — treat that as empty.
            const displayName = name && name !== id ? name : '';
            if (!displayName) return '';
            const color = service && service.categoryColor
                ? service.categoryColor
                : this.getCategoryColorFromCache(id);
            return ` - ${this.renderSegmentChip(displayName, color)}`;
        }

        getCategoryNameFromCache(categoryId) {
            if (!categoryId) return 'Segmento';

            // Try segmentMappings (used by quote-summary view: { id: name })
            if (this.segmentMappings && this.segmentMappings[categoryId]) {
                return this.segmentMappings[categoryId];
            }

            // Try rates cache from services view
            if (this.ratesCache && this.ratesCache.length > 0) {
                const rate = this.ratesCache.find(r =>
                    r.value === categoryId ||
                    r.objectId === categoryId ||
                    r.id === categoryId
                );

                if (rate) {
                    console.log('✅ ServicesRenderer: Found segment in cache:', categoryId, '->', rate.label || rate.name);
                    return rate.label || rate.name || 'Segmento';
                }
            }

            return categoryId; // Not found, return as-is
        }

        // Helper: Fetch rates if missing or cache is empty
        async fetchRatesIfMissing() {
            if (this.ratesFetchPromise) {
                // Avoid duplicate requests
                console.log('🔄 ServicesRenderer: Rate fetch already in progress, waiting...');
                return await this.ratesFetchPromise;
            }

            this.ratesFetchPromise = this.performRatesFetch();
            try {
                await this.ratesFetchPromise;
            } finally {
                this.ratesFetchPromise = null;
            }
        }

        // Helper: Get access token using the same pattern as quote-services-v2.js
        getAccessToken() {
            // First try to get from window variable (passed from server)
            if (typeof window !== 'undefined' && window.quoteAccessToken) {
                // Set the cookie for future requests since middleware expects it
                document.cookie = `accessToken=${window.quoteAccessToken}; path=/; SameSite=Lax`;
                console.log('✅ ServicesRenderer: Using token from window.quoteAccessToken');
                return window.quoteAccessToken;
            }

            // Then try to get from cookies (most common in this app)
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'accessToken') {
                    console.log('✅ ServicesRenderer: Using token from accessToken cookie');
                    return value;
                }
            }

            // Try localStorage/sessionStorage with various keys
            const tokenSources = [
                { source: 'localStorage.accessToken', getter: () => localStorage.getItem('accessToken') },
                { source: 'sessionStorage.accessToken', getter: () => sessionStorage.getItem('accessToken') },
                { source: 'localStorage.token', getter: () => localStorage.getItem('token') },
                { source: 'sessionStorage.token', getter: () => sessionStorage.getItem('token') }
            ];

            for (const tokenSource of tokenSources) {
                try {
                    const token = tokenSource.getter();
                    if (token) {
                        console.log(`✅ ServicesRenderer: Using token from ${tokenSource.source}`);
                        return token;
                    }
                } catch (error) {
                    console.warn(`⚠️ ServicesRenderer: Error accessing ${tokenSource.source}:`, error.message);
                }
            }

            // Try window.getAccessToken function if available
            if (typeof window !== 'undefined' && typeof window.getAccessToken === 'function') {
                try {
                    const token = window.getAccessToken();
                    if (token) {
                        console.log('✅ ServicesRenderer: Using token from window.getAccessToken()');
                        return token;
                    }
                } catch (error) {
                    console.warn('⚠️ ServicesRenderer: Error calling window.getAccessToken():', error.message);
                }
            }

            console.warn('❌ ServicesRenderer: No authentication token found in any source:', {
                windowQuoteAccessToken: !!(window.quoteAccessToken),
                cookieCount: document.cookie.split(';').length,
                hasWindowGetAccessToken: typeof window.getAccessToken === 'function',
                checkedSources: tokenSources.map(s => s.source)
            });
            return null;
        }

        // Helper: Perform the actual rates fetch
        async performRatesFetch() {
            try {
                console.log('🔄 ServicesRenderer: Fetching rates from /api/rates/active...');

                // Get token using comprehensive method
                const token = this.getAccessToken();
                if (!token) {
                    console.warn('⚠️ ServicesRenderer: No authentication token found - cannot fetch rates');
                    return;
                }

                const response = await fetch('/api/rates/active', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();

                if (result.success && result.data) {
                    this.ratesCache = result.data;
                    console.log('✅ ServicesRenderer: Successfully fetched rates:', this.ratesCache.length);
                    this.lastRatesFetch = Date.now();
                } else {
                    console.warn('⚠️ ServicesRenderer: API returned unsuccessful response:', result);
                }
            } catch (error) {
                console.error('❌ ServicesRenderer: Failed to fetch rates:', error.message);
                // Don't throw to avoid breaking the UI
            }
        }

        // Helper: Check if rates cache should be refreshed
        shouldRefreshRatesCache() {
            // Only refresh if:
            // 1. We have a cache but it's been more than 5 minutes since last fetch
            // 2. Or we've never fetched before
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            return !this.lastRatesFetch || this.lastRatesFetch < fiveMinutesAgo;
        }

        // Helper: Refresh the rates cache
        async refreshRatesCache() {
            this.lastRatesFetch = 0; // Force refresh
            await this.fetchRatesIfMissing();
        }

        // Helper: Validate rates cache structure
        validateRatesCache() {
            if (!this.ratesCache || !Array.isArray(this.ratesCache)) {
                console.warn('⚠️ ServicesRenderer: Invalid ratesCache structure - not an array');
                return false;
            }

            if (this.ratesCache.length === 0) {
                console.warn('⚠️ ServicesRenderer: ratesCache is empty');
                return false;
            }

            // Check if rates have expected structure
            const hasValidStructure = this.ratesCache.every(rate =>
                rate &&
                (rate.value || rate.objectId || rate.id) &&
                (rate.label || rate.name)
            );

            if (!hasValidStructure) {
                console.warn('⚠️ ServicesRenderer: Some rates missing required fields (value/id and label/name)');
                return false;
            }

            console.log('✅ ServicesRenderer: ratesCache validation passed:', this.ratesCache.length, 'rates');
            return true;
        }

        // Helper: Check if experience is from establishment
        isExperienceFromEstablishment(service) {
            return service.providerType && service.providerType.toLowerCase() === 'establishment';
        }

        // Helper: Get service price
        getServicePrice(service) {
            // Use pricesByType if available
            if (service.pricesByType && typeof service.pricesByType === 'object' && this.paymentType) {
                const price = service.pricesByType[this.paymentType];
                if (price !== undefined) return price;
            }

            // Fallback to base price
            return service.price || service.total || 0;
        }

        // Helper: Calculate day total
        calculateDayTotal(services) {
            return services.reduce((sum, service) => {
                if (service.includeInTotal === false) return sum;
                return sum + this.getServicePrice(service);
            }, 0);
        }

        // Update payment type
        setPaymentType(paymentType) {
            this.paymentType = paymentType;
        }

        // Dispatch custom events
        dispatchRenderEvent(eventName, detail) {
            const event = new CustomEvent(eventName, { detail });
            document.dispatchEvent(event);
        }
    }

    // Export to global scope
    window.ServicesRenderer = ServicesRenderer;

})(window);