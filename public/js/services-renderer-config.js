/**
 * Services Renderer Configuration
 * Centralized configuration for service rendering across all views
 * Created by Denisse Maldonado
 */

(function (window) {
    'use strict';

    const ServicesRendererConfig = {
        // Type colors matching quote-services-v2.js
        typeColors: {
            transport: '#0d6efd',
            traslado: '#0d6efd',
            experience: '#6f42c1',
            experiencia: '#6f42c1',
            tour: '#198754',
            concepto: '#6c757d',
            regular: '#6c757d',
            'a-disposicion': '#fd7e14'
        },

        // Type labels matching quote-services-v2.js
        typeLabels: {
            transport: 'Transporte',
            traslado: 'Transporte',
            experience: 'Experiencia',
            experiencia: 'Experiencia',
            tour: 'Tour',
            concepto: 'Concepto',
            regular: 'Concepto',
            'a-disposicion': 'A Disposición'
        },

        // Transport type labels
        transportTypes: {
            aeropuerto: 'Aeropuerto',
            'punto-a-punto': 'Punto a Punto',
            local: 'Local'
        },

        // Direction labels for transport — must match the modal labels in quote-services-v2.js
        directionLabels: {
            arrival: {
                aeropuerto: 'Llegada',
                'punto-a-punto': 'Llegada',
                local: 'Llevar'
            },
            departure: {
                aeropuerto: 'Salida',
                'punto-a-punto': 'Salida',
                local: 'Recoger'
            }
        },

        // Icons for service types
        typeIcons: {
            transport: 'ti-car',
            traslado: 'ti-car',
            experience: 'ti-beach',
            experiencia: 'ti-beach',
            tour: 'ti-map-2',
            concepto: 'ti-file-text',
            regular: 'ti-file-text',
            'a-disposicion': 'ti-clock-hour-4'
        },

        // Badge styles for different contexts
        badgeStyles: {
            // Main service type badge
            serviceType: (type) => {
                const color = ServicesRendererConfig.typeColors[type] || '#6c757d';
                return `background: ${color}15; color: ${color};`;
            },

            // Secondary badges (transport subtypes, etc)
            secondary: (color) => {
                return `background: ${color}25; color: ${color};`;
            },

            // Info badges (schedule, passengers, etc)
            info: 'background: #0dcaf015; color: #0dcaf0;',

            // Warning badges
            warning: 'background: #ffc10715; color: #ffc107;',

            // Success badges
            success: 'background: #19875415; color: #198754;',

            // Muted badges
            muted: 'background: #6c757d15; color: #6c757d;'
        },

        // Passenger type configurations
        passengerTypes: {
            adults: {
                icon: 'ti ti-user',
                color: '#0d6efd',
                label: 'adulto',
                pluralLabel: 'adultos'
            },
            children: {
                icon: 'ti ti-mood-kid',
                color: '#198754',
                label: 'niño',
                pluralLabel: 'niños'
            },
            infants: {
                icon: 'ti ti-baby-carriage',
                color: '#fd7e14',
                label: 'infante',
                pluralLabel: 'infantes'
            },
            adultsNoAlcohol: {
                icon: 'ti ti-glass-off',
                color: '#0dcaf0',
                label: 'sin alcohol',
                pluralLabel: 'sin alcohol'
            }
        },

        // Common CSS classes
        cssClasses: {
            badge: 'service-badge',
            serviceCard: 'service-card',
            serviceHeader: 'service-header',
            serviceInfo: 'service-info',
            serviceDetails: 'service-details',
            servicePrice: 'service-price',
            dayCard: 'day-card',
            dayHeader: 'day-header',
            dayTotal: 'day-total'
        },

        // Formatting utilities
        formatters: {
            currency: (amount) => {
                return new Intl.NumberFormat('es-MX', {
                    style: 'currency',
                    currency: 'MXN',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(amount || 0);
            },

            date: (dateString) => {
                if (!dateString) return '';
                // YYYY-MM-DD strings must be parsed as LOCAL dates — `new Date('2026-08-11')`
                // is UTC midnight, which shifts to the previous day in any negative-offset
                // timezone (e.g. Mexico City UTC-6) when formatted.
                let date;
                if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                    const [y, m, d] = dateString.split('-').map(Number);
                    date = new Date(y, m - 1, d);
                } else {
                    date = new Date(dateString);
                }
                // es-MX returns the weekday in lowercase ("lunes"); capitalize it.
                const formatted = new Intl.DateTimeFormat('es-MX', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }).format(date);
                return formatted.charAt(0).toUpperCase() + formatted.slice(1);
            },

            time: (timeString) => {
                if (!timeString) return '';
                // Ensure proper formatting (HH:MM)
                return timeString.replace(/(\d{1,2}):?(\d{2})/, (match, h, m) => {
                    return `${h.padStart(2, '0')}:${m}`;
                });
            },

            truncateText: (text, maxLength = 50) => {
                if (!text || text.length <= maxLength) return text;
                return text.substring(0, maxLength) + '...';
            }
        },

        // Helper functions
        helpers: {
            isTransport: (type) => {
                return type === 'traslado' || type === 'transport';
            },

            isExperience: (type) => {
                return type === 'experiencia' || type === 'experience';
            },

            isTour: (type) => {
                return type === 'tour';
            },

            isConcepto: (type) => {
                return type === 'concepto' || type === 'regular';
            },

            isADisposicion: (type) => {
                return type === 'a-disposicion';
            },

            getServiceBadgeLabel: (service) => {
                // Both regular and establishment experiences show as "Experiencia"
                if (ServicesRendererConfig.helpers.isExperience(service.type)) {
                    return 'Experiencia';
                }
                return ServicesRendererConfig.typeLabels[service.type] || service.type || 'Servicio';
            },

            getTransportDirectionLabel: (service) => {
                if (!service.directionType || !service.transportType) return '';
                const labels = ServicesRendererConfig.directionLabels[service.directionType];
                return labels ? (labels[service.transportType] || service.directionType) : service.directionType;
            },

            getPassengerCount: (service) => {
                const adults = service.adultsQuantity || service.transportAdults || 0;
                const children = service.childrenQuantity || service.transportChildren || 0;
                const infants = service.infantsQuantity || service.transportInfants || 0;
                const noAlcohol = service.adultsNoAlcoholQuantity || 0;
                return {
                    adults,
                    children,
                    infants,
                    noAlcohol,
                    total: adults + children + infants + noAlcohol
                };
            }
        }
    };

    // Data normalization functions
    ServicesRendererConfig.normalizeService = function (service) {
        if (!service) return null;

        return {
            // Core identification
            id: service.id || service._id || service.objectId,
            type: service.type,
            dayId: service.dayId,

            // Names and concepts
            concept: service.concept || service.name || service.title,
            experienceName: service.experienceName || service.concept,
            tourName: service.tourName || service.concept,
            name: service.name || service.concept,

            // Schedule and timing
            selectedSchedule: service.selectedSchedule || service.time || service.schedule,
            startTime: service.startTime || service.start || service.time || service.selectedSchedule,
            endTime: service.endTime || service.end,
            duration: service.duration || 1,

            // Passenger quantities (normalize all variations)
            transportAdults: service.transportAdults || service.adults || service.adultsQuantity || 0,
            transportChildren: service.transportChildren || service.children || service.childrenQuantity || 0,
            transportInfants: service.transportInfants || service.infants || service.infantsQuantity || 0,
            adultsQuantity: service.adultsQuantity || service.adults || service.transportAdults || 0,
            childrenQuantity: service.childrenQuantity || service.children || service.transportChildren || 0,
            infantsQuantity: service.infantsQuantity || service.infants || service.transportInfants || 0,
            adultsNoAlcoholQuantity: service.adultsNoAlcoholQuantity || service.noAlcoholAdults || 0,
            persons: service.persons || 0,

            // Transport specific - core fields
            transportType: service.transportType,
            directionType: service.directionType,
            tripType: service.tripType,
            origin: service.origin || service.transportOrigin || service.originName,
            destination: service.destination || service.transportDestination,
            destinationPOI: service.destinationPOI,
            airline: service.airline,
            flightNumber: service.flightNumber,
            specificLocation: service.specificLocation,
            category: service.category,

            // Transport specific - departure times
            flightDepartureTimeSuggested: service.flightDepartureTimeSuggested,
            roundTripDepartureTimeSuggestedIda: service.roundTripDepartureTimeSuggestedIda,
            roundTripDepartureTimeSuggestedVuelta: service.roundTripDepartureTimeSuggestedVuelta,

            // Transport specific - round trip fields
            startDate: service.startDate,
            endDate: service.endDate,
            returnOrigin: service.returnOrigin,
            returnDestination: service.returnDestination,
            returnAirline: service.returnAirline,
            returnFlightNumber: service.returnFlightNumber,

            // Transport specific - route and pricing
            routeDuration: service.routeDuration,
            baseVehiclePrice: service.baseVehiclePrice,
            waitingTimeHours: service.waitingTimeHours || 0,
            waitingTimePricePerHour: service.waitingTimePricePerHour || 0,

            // Vehicle information
            vehicleId: service.vehicleId,
            vehicleType: service.vehicleType,
            vehicleTypeName: service.vehicleTypeName,
            quantity: service.quantity || 1,

            // Additional vehicle (tours, legacy primary)
            hasAdditionalVehicle: service.hasAdditionalVehicle || false,
            additionalVehicleId: service.additionalVehicleId,
            additionalVehicleTypeName: service.additionalVehicleTypeName,
            additionalVehicleSegmentName: service.additionalVehicleSegmentName,
            // Vehículos adicionales (lista multi-vehículo) — cada item incluye su waitingHours/waitingPricePerHour.
            extraAdditionalVehicles: Array.isArray(service.extraAdditionalVehicles) ? service.extraAdditionalVehicles : [],

            // Guide and Greeter features
            includeGuide: service.includeGuide || false,
            includeGreeter: service.includeGreeter || false,
            greeterInVehicle: service.greeterInVehicle || false,

            // Tour specific
            isWalkingTour: service.isWalkingTour || false,
            tourId: service.tourId,
            rateId: service.rateId,

            // Experience specific
            experienceId: service.experienceId,
            providerType: service.providerType,

            // Hotel specific
            hotelName: service.hotelName,
            checkIn: service.checkIn,
            checkOut: service.checkOut,

            // Pricing - all variations
            price: service.price || service.total || 0,
            total: service.total || service.price || 0,
            pricesByType: service.pricesByType,
            adultPrice: service.adultPrice || 0,
            childPrice: service.childPrice || 0,
            noAlcoholPrice: service.noAlcoholPrice || 0,
            customPrice: service.customPrice,
            customPrices: service.customPrices,
            unitPrice: service.unitPrice,
            basePrice: service.basePrice,
            vehicleRatePerHour: service.vehicleRatePerHour,
            guideRatePerHour: service.guideRatePerHour,
            includeInTotal: service.includeInTotal !== false, // Default to true

            // Status and metadata
            availabilityPending: service.availabilityPending || false,
            hasOverlap: service.hasOverlap || false,
            imageUrl: service.imageUrl,

            // Notes
            notes: service.notes || service.teamNotes || '',

            // Keep any other fields that might exist
            ...service
        };
    };

    ServicesRendererConfig.normalizeQuoteServices = function (data) {
        // If it comes from backend (quote-summary format)
        if (data && data.days && data.days[0] && data.days[0].subconcepts) {
            return {
                days: data.days.map(day => ({
                    id: day.id || day._id,
                    number: day.dayNumber || day.number,
                    title: day.dayTitle || day.title || `Día ${day.dayNumber || day.number}`,
                    date: day.date,
                    description: day.description,
                    services: (day.subconcepts || []).map(sc => ServicesRendererConfig.normalizeService(sc))
                })),
                currency: data.currency || 'MXN',
                paymentType: data.paymentType || 'efectivo',
                total: data.total || 0
            };
        }

        // If it comes from frontend (quote-services format with Map)
        if (data && data.days && data.services) {
            const servicesMap = data.services;
            return {
                days: data.days.map(day => ({
                    id: day.id,
                    number: day.number,
                    title: day.title || `Día ${day.number}`,
                    date: day.date,
                    description: day.description,
                    services: day.services.map(sid => {
                        const service = servicesMap.get ? servicesMap.get(sid) : servicesMap[sid];
                        return ServicesRendererConfig.normalizeService(service);
                    }).filter(Boolean)
                })),
                currency: data.currency || 'MXN',
                paymentType: data.paymentType || 'efectivo'
            };
        }

        // Return as-is if we can't normalize
        return data;
    };

    // Display rules for conditional rendering
    ServicesRendererConfig.displayRules = {
        // Should show suggested departure time for transport services
        shouldShowDepartureTime: function (service) {
            // Only show departure time for departure services (not arrival)
            if (!service || service.type !== 'transport') return false;
            if (service.directionType === 'arrival') return false;

            // Check for actual time values (not null, not empty string)
            const hasFlightTime = service.flightDepartureTimeSuggested &&
                service.flightDepartureTimeSuggested.toString().trim();
            const hasIdaTime = service.roundTripDepartureTimeSuggestedIda &&
                service.roundTripDepartureTimeSuggestedIda.toString().trim();
            const hasVueltaTime = service.roundTripDepartureTimeSuggestedVuelta &&
                service.roundTripDepartureTimeSuggestedVuelta.toString().trim();

            return hasFlightTime || hasIdaTime || hasVueltaTime;
        },

        // Should show service type badge
        shouldShowServiceBadge: function (service) {
            // Hide "Concepto" badge for concepto services
            return service && service.type !== 'concepto';
        },

        // Should show price section
        shouldShowPrice: function (service) {
            // Hide price section for concepto services with $0 price
            if (!service) return true;
            if (service.type === 'concepto') {
                const price = service.price || service.total || 0;
                return price > 0;
            }
            return true;
        },

        // Get schedule label based on transport type. Aeropuerto transfers always
        // include a flight, so "Horario de vuelo" is accurate. Punto-a-punto and
        // local transfers don't involve a flight — they're just a scheduled
        // departure, so "Horario de salida" reads correctly.
        getScheduleLabel: function (service) {
            if (!service || service.type !== 'transport') {
                return 'Horario:';
            }
            if (service.transportType === 'punto-a-punto' || service.transportType === 'local') {
                return 'Horario de salida:';
            }
            return 'Horario de vuelo:';
        },

        // Should show round trip fields
        shouldShowRoundTripFields: function (service) {
            if (!service || service.type !== 'transport') return false;
            if (service.directionType === 'arrival') return false;
            return service.tripType === 'round-trip';
        }
    };

    // Export to global scope
    window.ServicesRendererConfig = ServicesRendererConfig;

})(window);