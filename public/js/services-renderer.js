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
                console.error('ServicesRendererConfig not loaded. Please include services-renderer-config.js first.');
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

            // Initialize styles
            this.initializeStyles();
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
                        font-size: 0.75rem;
                        font-weight: 600;
                        margin-right: 0.5rem;
                        margin-bottom: 0.25rem;
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
                        font-size: 0.95rem;
                        color: #212529;
                        margin-bottom: 0.25rem;
                    }

                    .service-details {
                        font-size: 0.85rem;
                        color: #6c757d;
                    }

                    .service-detail-item {
                        display: flex;
                        align-items: center;
                        gap: 0.25rem;
                        margin-top: 0.25rem;
                    }

                    .service-price {
                        font-weight: normal;
                        font-size: 0.95rem;
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
                        font-size: 1rem;
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

        // Get badge class based on mode - using consistent Bootstrap classes
        getBadgeClass() {
            // All modes now use consistent Bootstrap badge classes
            return 'badge bg-light text-dark';
        }

        // Get passenger badge class - consistent across all modes
        getPassengerBadgeClass(type) {
            const colorMap = {
                adults: 'bg-primary-subtle text-primary',
                children: 'bg-success-subtle text-success',
                infants: 'bg-warning-subtle text-warning',
                adultsNoAlcohol: 'bg-info-subtle text-info'
            };
            return `badge ${colorMap[type] || 'bg-light text-dark'} d-inline-flex align-items-center gap-1 me-1 mb-1`;
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
                badgeLabel = 'Establecimiento';
            }

            // Clean service item with minimal styling
            let html = `<div class="service-item">`;

            // Service header row with title and price
            html += '<div class="d-flex justify-content-between align-items-start">';

            // Left side: Service info (keeping original structure)
            html += '<div class="service-info flex-grow-1">';

            // Service badges and title on same line (keeping original layout)
            html += '<div class="d-flex align-items-center mb-2">';
            if (this.config.displayRules.shouldShowServiceBadge(service)) {
                // Minimal badge styling - match main services view
                const badgeClass = 'bg-light text-dark';
                html += `<span class="badge ${badgeClass} me-2">${badgeLabel}</span>`;
            }
            if (isExcluded) {
                html += `<span class="badge bg-light text-muted small me-2">Pago externo</span>`;
            }
            // Service title (keeping original structure)
            html += `<h6 class="mb-0 service-title">${this.getServiceTitle(service)}</h6>`;
            html += '</div>';

            html += '</div>'; // service-info

            // Price - use display rules to check if should show (restore original logic)
            if (this.config.displayRules.shouldShowPrice(service)) {
                html += '<div class="service-price text-end">';
                if (isExcluded) {
                    html += '<span class="badge bg-secondary-subtle text-secondary mb-1">Pago externo</span><br>';
                    html += `<div class="service-price excluded">${this.formatCurrency(price)}</div>`;
                } else {
                    html += `<div class="service-price">${this.formatCurrency(price)}</div>`;
                }
                html += '</div>';
            }

            html += '</div>'; // Close header row

            // Service details container - moved inside service-item for proper border positioning
            html += '<div class="service-details">';

            // Schedule
            if (service.selectedSchedule || service.startTime) {
                html += `<div class="service-detail-item">
                    <i class="ti ti-clock me-1"></i>
                    ${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}
                </div>`;
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
            if (service.vehicleId || service.vehicleType || service.vehicleTypeName || 
                (service.type === 'tour' && ((service.hasAdditionalVehicle && service.additionalVehicleId) || service.additionalVehicleTypeName))) {
                html += `<div class="mt-1">
                    <div class="mb-1">
                        <i class="ti ti-car me-1"></i><span class="text-muted">Vehículo(s):</span>
                    </div>
                    ${(service.vehicleId || service.vehicleType || service.vehicleTypeName) ? `
                        <div class="ms-3">
                            <div class="d-flex align-items-center justify-content-between">
                                <span>
                                    <strong>${this.getVehicleDisplayName(service)}</strong>
                                    ${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` : 
                                      service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}
                                    ${service.rateId ? ` - ${this.getCategoryName(service.rateId)}` : 
                                      service.category ? ` - ${this.getCategoryName(service.category)}` : ''}
                                </span>
                            </div>
                        </div>
                    ` : ''}
                    ${service.type === 'tour' && ((service.hasAdditionalVehicle && service.additionalVehicleId) || service.additionalVehicleTypeName) ? `
                        <div class="ms-3 mt-1">
                            <div class="d-flex align-items-center gap-2">
                                <span>
                                    <strong>${this.getAdditionalVehicleDisplayName(service)}</strong>
                                    ${service.additionalVehicleSegment ? ` - ${this.getCategoryName(service.additionalVehicleSegment)}` : ''}
                                </span>
                            </div>
                        </div>
                    ` : ''}
                </div>`;
            }

            // Guide
            if ((service.type === 'tour' || service.type === 'a-disposicion') && service.includeGuide) {
                html += `<div class="service-detail-item text-success mt-1">
                    <i class="ti ti-user me-1"></i>
                    <strong>Incluye Chofer</strong>
                </div>`;
            }

            // Greeter
            if ((service.type === 'tour' || service.type === 'transport') && service.includeGreeter) {
                const greeterLocation = service.greeterInVehicle ? ' (en vehículo)' : '';
                html += `<div class="service-detail-item text-info mt-1">
                    <i class="ti ti-users me-1"></i>
                    <strong>Incluye Greeter${greeterLocation}</strong>
                </div>`;
            }

            // Availability warning
            if (service.availabilityPending) {
                html += `<div class="mt-2">
                    <span class="badge bg-warning text-dark">
                        <i class="ti ti-alert-triangle me-1"></i>Verificar disponibilidad
                    </span>
                </div>`;
            }

            // Notes
            if (service.notes) {
                html += `<div class="service-detail-item mt-2 text-muted small">
                    <i class="ti ti-notes me-1"></i>
                    <span style="white-space: pre-wrap;">${service.notes}</span>
                </div>`;
            }

            html += '</div>'; // service-details

            // Actions (only in list mode)
            if (this.mode === 'list' && this.container) {
                html += this.renderServiceActions(service);
            }

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
            const directionLabels = {
                arrival: service.transportType === 'aeropuerto' ? 'Llegada' : 'Ida',
                departure: service.transportType === 'aeropuerto' ? 'Salida' : 'Vuelta',
            };

            // Clean transport service item with minimal styling
            let html = `<div class="service-item">`;

            // Service header row with title and price
            html += '<div class="d-flex justify-content-between align-items-start">';

            // Left side: Service info
            html += '<div class="service-info flex-grow-1">';

            // Rounded time badge at top if exists (matching main services view styling)
            if (roundedTime) {
                html += `<div class="mb-2">
                    <span class="badge bg-info text-white">
                        <i class="ti ti-clock me-1"></i>Horario: ${roundedTime}
                    </span>
                </div>`;
            }

            // Service badges
            html += '<div class="mb-2">';
            html += `<span class="badge bg-light text-dark me-2">Transporte</span>`;
            html += `<span class="badge bg-primary-subtle text-primary me-2">${transportLabel}</span>`;

            if (service.directionType) {
                const dirLabel = directionLabels[service.directionType];
                const badgeClass = service.directionType === 'arrival' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning';
                html += `<span class="badge ${badgeClass} me-2">${dirLabel}</span>`;
            }

            if (service.tripType === 'round-trip') {
                html += `<span class="badge bg-info-subtle text-info me-2"><i class="ti ti-arrows-left-right me-1"></i>Ida y Vuelta</span>`;
            }

            if (service.returnOrigin || service.returnDestination) {
                html += `<span class="badge bg-secondary-subtle text-secondary me-2"><i class="ti ti-link me-1"></i>Conexión</span>`;
            }

            if (isExcluded) {
                html += `<span class="badge bg-secondary-subtle text-secondary me-2">Pago externo</span>`;
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

            if (hasVehicle || hasAdditional) {
                html += '<div class="mt-2">';
                html += '<div class="service-detail-item mb-1">';
                html += '<i class="ti ti-car me-1"></i>Vehículo(s):';
                html += '</div>';

                if (hasVehicle) {
                    const vehicleName = this.getVehicleDisplayName(service);
                    const segmentName = service.category ? ` - ${this.getCategoryName(service.category)}` : 
                                       service.rateId ? ` - ${this.getCategoryName(service.rateId)}` : '';
                    html += `<div style="margin-left: 20px;">
                        <strong>${vehicleName}</strong>${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` : 
                            service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}${segmentName}
                    </div>`;
                }

                if (hasAdditional) {
                    const additionalName = this.cleanVehicleName(this.getAdditionalVehicleDisplayName(service));
                    const additionalSegment = service.additionalVehicleSegment ?
                        ` - ${this.getCategoryName(service.additionalVehicleSegment)}` : ' - Segmento';
                    html += `<div style="margin-left: 20px; margin-top: 4px;">
                        <strong>${additionalName}</strong>${additionalSegment}
                    </div>`;
                }
                html += '</div>';
            }

            // Guide
            if (service.includeGuide) {
                html += `<div class="service-detail-item text-success mt-1">
                    <i class="ti ti-user me-1"></i>
                    <strong>Incluye Chofer</strong>
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

            // Notes
            if (service.notes) {
                html += `<div class="service-detail-item mt-2 text-muted small">
                    <i class="ti ti-notes me-1"></i>
                    <span style="white-space: pre-wrap;">${service.notes}</span>
                </div>`;
            }

            html += '</div>'; // service-details
            html += '</div>'; // service-info

            // Price - transport services always show price (restore original logic)
            if (this.config.displayRules.shouldShowPrice(service)) {
                html += '<div class="service-price text-end">';
                if (isExcluded) {
                    html += '<span class="badge bg-secondary-subtle text-secondary mb-1">Pago externo</span><br>';
                    html += `<div class="service-price excluded">${this.formatCurrency(price)}</div>`;
                } else {
                    html += `<div class="service-price">${this.formatCurrency(price)}</div>`;
                }
                html += '</div>';
            }

            html += '</div>'; // Close header row

            // Actions (only in list mode)
            if (this.mode === 'list' && this.container) {
                html += this.renderServiceActions(service);
            }

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
                        <i class="ti ti-car me-1"></i><span class="text-muted">Vehículo(s):</span>
                    </div>
                    ${(service.vehicleId || service.vehicleType || service.vehicleTypeName) ? `
                        <div class="ms-3">
                            <span>
                                <strong>${this.getVehicleDisplayName(service)}</strong>
                                ${service.type === 'a-disposicion' && service.vehicleCount > 1 ? ` x${service.vehicleCount}` : 
                                  service.type !== 'a-disposicion' && service.quantity > 1 ? ` x${service.quantity}` : ''}
                                ${service.rateId ? ` - ${this.getCategoryName(service.rateId)}` : 
                                  service.category ? ` - ${this.getCategoryName(service.category)}` : ''}
                            </span>
                        </div>
                    ` : ''}
                    ${service.type === 'tour' && service.additionalVehicleId ? `
                        <div class="ms-3 mt-1">
                            <span>
                                <strong>${this.getAdditionalVehicleDisplayName(service)}</strong>
                                ${service.additionalVehicleSegment ? ` - ${this.getCategoryName(service.additionalVehicleSegment)}` : ''}
                            </span>
                        </div>
                    ` : ''}
                </div>`;
            }

            // Guide
            if ((service.type === 'tour' || service.type === 'a-disposicion') && service.includeGuide) {
                html += `<div class="service-detail-item text-success">
                    <i class="ti ti-user me-1"></i>
                    <strong>Incluye Chofer</strong>
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

            // Availability warning
            if (service.availabilityPending) {
                html += `<div class="mt-2">
                    <span class="badge bg-warning text-dark">
                        <i class="ti ti-alert-triangle me-1"></i>Verificar disponibilidad
                    </span>
                </div>`;
            }

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


        // Helper: Round time to nearest 15 minutes
        roundTimeToNearest15(timeStr) {
            if (!timeStr) return '';
            const [hours, minutes] = timeStr.split(':').map(Number);
            const totalMinutes = hours * 60 + minutes;
            const rounded = Math.round(totalMinutes / 15) * 15;
            const roundedHours = Math.floor(rounded / 60);
            const roundedMinutes = rounded % 60;
            return `${String(roundedHours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
        }

        // Helper: Get service title
        getServiceTitle(service) {
            // For a-disposición, return empty to avoid redundancy (vehicle shown below)
            if (service.type === 'a-disposicion') return '';
            
            if (service.concept) return service.concept;
            if (service.experienceName) return service.experienceName;
            if (service.tourName) return service.tourName;
            if (service.name) return service.name;

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

        // Helper: Get category name
        getCategoryName(categoryId) {
            if (!categoryId) return 'Segmento';

            // Try segment mappings from summary view
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
                    return rate.label || rate.name || 'Segmento';
                }
            }

            // Static fallback mappings for common ObjectIds
            const staticMappings = {
                'ox5gO8c9ok': 'First Class',
                'yipmABp1UZ': 'Premium',
                'JGEgJ4gr9G': 'Green Class',
                // Route/geographic segments 
                'sma-leon': 'SMA-León',
                'sma-gto': 'SMA-Guanajuato',
                'sma-cdmx': 'SMA-CDMX',
                'sma-qro': 'SMA-Querétaro',
                'local-sma': 'Local SMA',
                'local-gto': 'Local Guanajuato',
                'local-leon': 'Local León'
            };

            if (staticMappings[categoryId]) {
                return staticMappings[categoryId];
            }

            // Last resort: return the ID itself
            console.warn('Unmapped segment ID in unified renderer:', categoryId);
            return categoryId;
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