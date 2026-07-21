/* eslint-env browser */
/**
 * quote-services-v2-transport.js
 * Rutas / formularios / UI de TRANSPORTE (traslados, round-trip, vuelos adicionales,
 * duracion de ruta) extraidos de quote-services-v2.js como ItineraryBuilder.prototype.
 * DEBE cargarse DESPUES de quote-services-v2.js. (El pricing de transporte queda en el
 * archivo principal por su acoplamiento con el motor de calculo.)
 * Created by Denisse Maldonado
 */

ItineraryBuilder.prototype.clearTransportFormFields = function () {
    // Skip clearing during edit form population
    if (this._populatingTransportForm) return;

    // Clear origin fields
    const originSelect = document.getElementById('transportOriginSelect');
    if (originSelect) originSelect.value = '';
    const originText = document.getElementById('transportOriginText');
    if (originText) originText.value = '';
    const originCombo = document.getElementById('transportOriginCombo');
    if (originCombo) originCombo.value = '';

    // Clear destination fields
    const destCombo = document.getElementById('transportDestinationCombo');
    if (destCombo) destCombo.value = '';
    const destSelect = document.getElementById('transportDestinationSelect');
    if (destSelect) destSelect.value = '';
    const destText = document.getElementById('transportDestinationText');
    if (destText) destText.value = '';

    // Clear specific location
    const specificLocation = document.getElementById('transportSpecificLocation');
    if (specificLocation) specificLocation.value = '';
    const specificLocationRow = document.getElementById('specificLocationRow');
    if (specificLocationRow) specificLocationRow.classList.add('d-none');

    // Clear one-way pick-up / drop-off addresses (round-trip legs cleared below)
    const pickupAddress = document.getElementById('transportPickupAddress');
    if (pickupAddress) pickupAddress.value = '';
    const dropoffAddress = document.getElementById('transportDropoffAddress');
    if (dropoffAddress) dropoffAddress.value = '';

    // Clear segmento
    const category = document.getElementById('transportCategory');
    if (category) category.value = '';

    // Clear vehicle and price
    this.clearVehicleDropdown();
    this.transportPriceData = null;

    // Clear schedule fields
    const transportStartTime = document.getElementById('transportStartTime');
    if (transportStartTime) transportStartTime.value = '';
    const transportEndTime = document.getElementById('transportEndTime');
    if (transportEndTime) transportEndTime.value = '';

    // Clear flight details
    const flightNumber = document.getElementById('flightNumber');
    if (flightNumber) flightNumber.value = '';
    const flightTime = document.getElementById('flightTime');
    if (flightTime) flightTime.value = '';
    const flightDepartureTimeSuggested = document.getElementById('flightDepartureTimeSuggested');
    if (flightDepartureTimeSuggested) flightDepartureTimeSuggested.value = '';
    // Limpia la marca de edición manual de las horas sugeridas (clean slate por servicio, para
    // que el auto-cálculo vuelva a llenar en un servicio nuevo).
    ['flightDepartureTimeSuggested', 'roundTripDepartureTimeSuggestedIda', 'roundTripDepartureTimeSuggestedVuelta'].forEach((id) => {
      const sf = document.getElementById(id);
      if (sf) { delete sf.dataset.userEdited; delete sf.dataset.confirmed; sf.readOnly = true; }
    });
    // Ocultar los hints de "confirmada como hora de pick-up" (clean slate por servicio nuevo).
    ['flightDepartureConfirmedHint', 'roundTripDepartureVueltaConfirmedHint'].forEach((id) => {
      document.getElementById(id)?.classList.add('d-none');
    });

    // Clear round trip fields
    const rtFields = [
      'roundTripOriginIdaSelect', 'roundTripOriginIdaText',
      'roundTripDestinationIdaCombo', 'roundTripDestinationIdaSelect',
      'roundTripOriginVueltaCombo', 'roundTripOriginVueltaSelect',
      'roundTripDestinationVueltaSelect', 'roundTripDestinationVueltaText',
      'roundTripTimeIda', 'roundTripTimeVuelta',
      'roundTripDepartureTimeSuggestedIda', 'roundTripDepartureTimeSuggestedVuelta',
      'roundTripAirlineIda', 'roundTripFlightNumberIda',
      'roundTripAirlineVuelta', 'roundTripFlightNumberVuelta',
      'roundTripSpecificLocationIda', 'roundTripSpecificLocationVuelta',
      'roundTripPickupAddressIda', 'roundTripDropoffAddressIda',
      'roundTripPickupAddressVuelta', 'roundTripDropoffAddressVuelta',
    ];
    rtFields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Hide round trip specific location rows
    document.getElementById('roundTripSpecificLocationIdaRow')?.classList.add('d-none');
    document.getElementById('roundTripSpecificLocationVueltaRow')?.classList.add('d-none');

    // Clear waiting time
    const waitingTimeHours = document.getElementById('waitingTimeHours');
    if (waitingTimeHours) waitingTimeHours.value = 0;
    const waitingTimePrice = document.getElementById('waitingTimePrice');
    if (waitingTimePrice) waitingTimePrice.value = '';
    const waitingTimeRate = document.getElementById('waitingTimeRate');
    if (waitingTimeRate) waitingTimeRate.textContent = '';

    // Clear price field and cached base price
    const priceField = document.getElementById('servicePrice');
    if (priceField) priceField.value = '';
    this._lastTransportBasePrice = null;

    // Hide breakdown panel (keep visible during editing)
    const breakdown = document.getElementById('servicePriceBreakdown');
    // if (breakdown) breakdown.classList.add('d-none'); // Commented out - always show breakdown when editing
};

ItineraryBuilder.prototype.updateTransferArrivalEstimate = function () {
    // Round-trip (local/punto-a-punto) tiene su llegada estimada por pierna (Ida + Vuelta).
    this.updateRoundTripArrivalEstimates();
    const type = document.querySelector('input[name="transportType"]:checked')?.value;
    if (type !== 'local' && type !== 'punto-a-punto') return;
    const startInput = document.getElementById('transportStartTime');
    const endInput = document.getElementById('transportEndTime');
    if (!startInput || !endInput) return;
    const routeMinutes = this.getRouteDurationMinutes();
    const isRT = this.isRoundTrip();
    const totalMinutes = routeMinutes ? routeMinutes * (isRT ? 2 : 1) : 0;
    const arrival = this.addMinutesToTime(startInput.value, totalMinutes);
    if (arrival) endInput.value = arrival;
    // Small text: duración de ruta con la que se estima la hora de llegada.
    const hintEl = document.getElementById('transportArrivalDurationHint');
    if (hintEl) {
      if (routeMinutes > 0) {
        const base = `Duración de ruta: ${this.formatMinutesToHoursAndMinutes(routeMinutes)}`;
        hintEl.textContent = isRT
          ? `${base} (×2 ida y vuelta = ${this.formatMinutesToHoursAndMinutes(totalMinutes)})`
          : base;
      } else {
        hintEl.textContent = 'Sin duración de ruta; selecciona origen y destino.';
      }
    }
};

ItineraryBuilder.prototype.updateRoundTripArrivalEstimates = function () {
    const type = document.querySelector('input[name="transportType"]:checked')?.value;
    const show = (type === 'local' || type === 'punto-a-punto');
    const routeMinutes = this.getRouteDurationMinutes();
    const legs = [
      { timeId: 'roundTripTimeIda', arrId: 'roundTripArrivalIda', hintId: 'roundTripArrivalIdaHint', rowId: 'roundTripArrivalIdaRow' },
      { timeId: 'roundTripTimeVuelta', arrId: 'roundTripArrivalVuelta', hintId: 'roundTripArrivalVueltaHint', rowId: 'roundTripArrivalVueltaRow' },
    ];
    legs.forEach((leg) => {
      const row = document.getElementById(leg.rowId);
      if (row) row.classList.toggle('d-none', !show);
      if (!show) return;
      const timeVal = document.getElementById(leg.timeId)?.value;
      const arrInput = document.getElementById(leg.arrId);
      const hintEl = document.getElementById(leg.hintId);
      if (arrInput) arrInput.value = routeMinutes ? (this.addMinutesToTime(timeVal, routeMinutes) || '') : '';
      if (hintEl) {
        hintEl.textContent = routeMinutes > 0
          ? `Duración de ruta: ${this.formatMinutesToHoursAndMinutes(routeMinutes)}`
          : 'Sin duración de ruta; selecciona origen y destino.';
      }
    });
};

ItineraryBuilder.prototype.handleTransportTypeChange = function () {
    this.clearTransportFormFields();
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const flightDetailsSection = document.getElementById('flightDetailsSection');
    const roundTripFlightDetailsIda = document.querySelector('.roundtrip-flight-details-ida');
    const roundTripFlightDetailsVuelta = document.querySelector('.roundtrip-flight-details-vuelta');
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;

    // Filter dropdowns based on selected transport type
    if (transportType && typeof populateDropdownsForTransportType === 'function') {
      populateDropdownsForTransportType(transportType);
    }

    // Update direction labels based on transport type
    const arrivalLabel = document.querySelector('label[for="typeArrival"] span');
    const departureLabel = document.querySelector('label[for="typeDeparture"] span');
    const arrivalIcon = document.querySelector('label[for="typeArrival"] i');
    const departureIcon = document.querySelector('label[for="typeDeparture"] i');
    if (transportType === 'punto-a-punto') {
      if (arrivalLabel) arrivalLabel.textContent = 'Llegada';
      if (departureLabel) departureLabel.textContent = 'Salida';
      if (arrivalIcon) { arrivalIcon.className = 'ti ti-car me-1'; arrivalIcon.style.fontSize = '1.1rem'; }
      if (departureIcon) { departureIcon.className = 'ti ti-car me-1'; departureIcon.style.fontSize = '1.1rem'; }
    } else if (transportType === 'local') {
      if (arrivalLabel) arrivalLabel.textContent = 'Llevar';
      if (departureLabel) departureLabel.textContent = 'Recoger';
      if (arrivalIcon) { arrivalIcon.className = 'ti ti-car me-1'; arrivalIcon.style.fontSize = '1.1rem'; }
      if (departureIcon) { departureIcon.className = 'ti ti-car me-1'; departureIcon.style.fontSize = '1.1rem'; }
    } else {
      if (arrivalLabel) arrivalLabel.textContent = 'Arrival';
      if (departureLabel) departureLabel.textContent = 'Departure';
      if (arrivalIcon) { arrivalIcon.className = 'ti ti-plane-arrival me-1'; arrivalIcon.style.fontSize = '1.1rem'; }
      if (departureIcon) { departureIcon.className = 'ti ti-plane-departure me-1'; departureIcon.style.fontSize = '1.1rem'; }
    }

    // Round trip fields handled elsewhere

    // Show/hide schedule and flight details based on transport type
    const transportScheduleSection = document.getElementById('transportScheduleSection');

    if (transportType === 'aeropuerto') {
      // Hide schedule, show flight details
      transportScheduleSection?.classList.add('d-none');
      if (tripType === 'roundtrip' || tripType === 'round-trip') {
        roundTripFlightDetailsIda?.classList.remove('d-none');
        roundTripFlightDetailsVuelta?.classList.remove('d-none');
      } else {
        flightDetailsSection?.classList.remove('d-none');
      }
    } else {
      // Punto a Punto or Local: show schedule, hide flight details
      flightDetailsSection?.classList.add('d-none');
      roundTripFlightDetailsIda?.classList.add('d-none');
      roundTripFlightDetailsVuelta?.classList.add('d-none');
      transportScheduleSection?.classList.remove('d-none');
    }

    // Local transfers: relabel schedule to pick-up / estimated arrival and
    // auto-compute the arrival from pick-up + route duration.
    this.updateTransferScheduleLabels();
    this.updateTransferArrivalEstimate();

    // Pickup / drop-off address fields are shown for Punto a Punto and Local (one-way + round-trip)
    const usesPickupDropoff = transportType === 'punto-a-punto' || transportType === 'local';
    ['papAddressesRow', 'papAddressesRowIda', 'papAddressesRowVuelta'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (usesPickupDropoff) el.classList.remove('d-none');
      else el.classList.add('d-none');
    });

    // Local transfers never need the "Hotel/Airbnb/Particular" address row —
    // hide it explicitly when switching to local so a row left visible from a
    // previous Punto a Punto / Aeropuerto selection doesn't linger.
    if (transportType === 'local') {
      ['specificLocationRow', 'roundTripSpecificLocationIdaRow', 'roundTripSpecificLocationVueltaRow'].forEach((id) => {
        document.getElementById(id)?.classList.add('d-none');
      });
    }

    // Re-evaluate direction fields (local has different field types than aeropuerto/punto-a-punto)
    const tripType2 = document.querySelector('input[name="tripType"]:checked')?.value;
    if (tripType2 === 'one-way') {
      this.handleDirectionTypeChange();
    } else {
      this.updateRoundTripFieldVisibility();
    }
};

ItineraryBuilder.prototype.renderTransportServiceItem = function (service) {
    const transportTypes = { aeropuerto: 'Aeropuerto', 'punto-a-punto': 'Punto a Punto', local: 'Local' };
    const transportLabel = transportTypes[service.transportType] || 'Transporte';

    // Extract specific location from origin/destination if embedded
    let origin = service.originName || service.origin || 'Origen';
    let destination = service.destination || 'Destino';
    let specificLocation = service.specificLocation || '';

    // If no explicit specificLocation, try to extract from origin/destination
    if (!specificLocation) {
      // Check if origin has embedded specific location (format: "City, Specific Location")
      if (origin.includes(',')) {
        const originParts = origin.split(',');
        if (originParts.length === 2) {
          origin = originParts[0].trim();
          specificLocation = originParts[1].trim();
        }
      }
      // Check destination if origin didn't have it
      else if (destination.includes(',')) {
        const destParts = destination.split(',');
        if (destParts.length === 2) {
          destination = destParts[0].trim();
          specificLocation = destParts[1].trim();
        }
      }
    }

    const vehicleName = this.getVehicleDisplayName(service);
    const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;
    const isAirport = service.transportType === 'aeropuerto';

    // Extract and round flight time for the header
    let flightTime = '';
    // For departure transport services, prefer suggested departure time
    if (service.type === 'transport' && service.directionType === 'departure' && service.flightDepartureTimeSuggested) {
      flightTime = service.flightDepartureTimeSuggested;
    } else if (service.startTime) {
      flightTime = service.startTime;
    } else if (service.selectedSchedule) {
      // Extract time from selectedSchedule (e.g., "13:39" or "13:39 - 14:30")
      const timeMatch = service.selectedSchedule.match(/^(\d{1,2}:\d{2})/);
      if (timeMatch) {
        flightTime = timeMatch[1];
      }
    }

    // Round to nearest 15 minutes
    const roundedTime = flightTime ? this.roundTimeToNearest15(flightTime) : '';

    return `
            <div class="service-item mb-3 p-3 border rounded ${service.hasOverlap && !service.overlapAccepted ? 'has-overlap' : ''}" data-service-id="${service.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        ${roundedTime ? `
                        <div class="mb-2">
                            <span class="badge bg-secondary text-white">
                                <i class="ti ti-clock me-1"></i>Hora: ${roundedTime}
                            </span>
                        </div>
                        ` : ''}
                        <div class="service-details">
                            <!-- Transport badges -->
                            <div class="d-flex align-items-center mb-2 flex-wrap gap-1">
                                <span class="badge bg-light text-dark me-2">Transporte</span>
                                <span class="badge bg-primary-subtle text-primary">${transportLabel}</span>
                                ${service.directionType ? `<span class="badge ${service.directionType === 'arrival' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}">${(service.transportType === 'local' && service.waitingTimeHours > 0) ? (service.directionType === 'arrival' ? 'Ida' : 'Regreso') : (service.transportType === 'local' ? (service.directionType === 'arrival' ? 'Llevar' : 'Recoger') : (service.directionType === 'arrival' ? 'Llegada' : 'Salida'))}</span>` : ''}
                                ${service.tripType === 'round-trip' ? '<span class="badge bg-info-subtle text-info"><i class="ti ti-arrows-left-right me-1"></i>Ida y Vuelta</span>' : ''}
                                ${service.returnOrigin || service.returnDestination ? '<span class="badge bg-secondary-subtle text-secondary"><i class="ti ti-link me-1"></i>Conexión</span>' : ''}
                            </div>
                            <!-- Service Description -->
                            ${service.serviceDescription ? `
                                <div class="d-flex align-items-start text-muted small mb-2">
                                    <i class="ti ti-file-text me-1"></i>
                                    <span class="text-muted me-1">Descripción:</span>
                                    <span style="white-space: pre-wrap;">${service.serviceDescription}</span>
                                </div>
                            ` : ''}
                            <!-- Passenger counts -->
                            ${this.renderPeopleQuantities(service)}
                            <!-- Origin and Destination -->
                            <div class="d-flex align-items-center text-muted small mb-1">
                                <i class="ti ti-circle-filled text-success me-1" style="font-size: 0.5rem;"></i>
                                <span class="text-muted me-1">Desde:</span>
                                ${origin}
                            </div>
                            <div class="d-flex align-items-center text-muted small mb-1">
                                <i class="ti ti-map-pin-filled text-danger me-1" style="font-size: 0.7rem;"></i>
                                <span class="text-muted me-1">Hacia:</span>
                                ${destination}
                            </div>
                            <!-- Pickup / Drop-off: se muestran siempre que existan (cualquier tipo de transporte). -->
                            ${(() => {
                                const lines = [];
                                const row = (icon, color, label, value) => `
                                    <div class="d-flex align-items-center text-muted small mb-1">
                                        <i class="ti ${icon} me-1 ${color}"></i>
                                        <span class="text-muted me-1">${label}:</span>${value}
                                    </div>`;
                                if (service.tripType === 'round-trip') {
                                    if (service.pickupAddressIda) lines.push(row('ti-map-pin-up', 'text-success', 'Pick-up (ida)', service.pickupAddressIda));
                                    if (service.dropoffAddressIda) lines.push(row('ti-map-pin-down', 'text-danger', 'Drop-off (ida)', service.dropoffAddressIda));
                                    if (service.pickupAddressVuelta) lines.push(row('ti-map-pin-up', 'text-success', 'Pick-up (regreso)', service.pickupAddressVuelta));
                                    if (service.dropoffAddressVuelta) lines.push(row('ti-map-pin-down', 'text-danger', 'Drop-off (regreso)', service.dropoffAddressVuelta));
                                } else {
                                    if (service.pickupAddress) lines.push(row('ti-map-pin-up', 'text-success', 'Pick-up', service.pickupAddress));
                                    if (service.dropoffAddress) lines.push(row('ti-map-pin-down', 'text-danger', 'Drop-off', service.dropoffAddress));
                                }
                                return lines.join('');
                            })()}
                            <!-- Airline -->
                            ${service.transportType === 'aeropuerto' && service.airline ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-plane me-1"></i>
                                    <span class="text-muted me-1">Aerolínea:</span>
                                    ${service.airline}
                                </div>
                            ` : ''}
                            <!-- Flight Number -->
                            ${service.transportType === 'aeropuerto' && service.flightNumber ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-ticket me-1"></i>
                                    <span class="me-1">Número de vuelo:</span>
                                    ${service.flightNumber}
                                </div>
                            ` : ''}
                            <!-- Additional flights -->
                            ${Array.isArray(service.additionalFlights) && service.additionalFlights.length > 0 ? `
                                <div class="text-muted small mt-1">
                                    <div class="mb-1">
                                        <i class="ti ti-plane me-1"></i><span class="text-muted">Vuelos adicionales:</span>
                                    </div>
                                    ${service.additionalFlights.map((f) => {
                                        const airline = String(f.airline || '').trim();
                                        const number = String(f.flightNumber || '').trim();
                                        const time = String(f.flightTime || '').trim();
                                        const label = [airline, number].filter(Boolean).join(' ') || 'Vuelo';
                                        return `<div class="ms-3"><strong>${label}</strong>${time ? ` <span class="text-muted">— ${time}</span>` : ''}</div>`;
                                    }).join('')}
                                </div>
                            ` : ''}
                            <!-- Return Flight Information (for round-trip services) -->
                            ${service.transportType === 'aeropuerto' && service.returnAirline ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-plane me-1"></i>
                                    <span class="text-muted me-1">Aerolínea de regreso:</span>
                                    ${service.returnAirline}
                                </div>
                            ` : ''}
                            ${service.transportType === 'aeropuerto' && service.returnFlightNumber ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-ticket me-1"></i>
                                    <span class="text-muted me-1">Vuelo de regreso:</span>
                                    ${service.returnFlightNumber}
                                </div>
                            ` : ''}
                            <!-- Arrival/Departure Time — aeropuerto involves a flight,
                                 punto-a-punto and local are just scheduled departures. -->
                            ${service.selectedSchedule || service.startTime ? (() => {
        const parts = String(service.selectedSchedule || '').split(/\s*-\s*/);
        const startT = service.startTime || parts[0] || '';
        const endT = service.endTime || (parts.length > 1 ? parts[1] : '');
        const overlapBadge = (service.hasOverlap && !service.overlapAccepted) ? `
                                    <span class="overlap-warning-badge ms-2" title="${this.getOverlapTooltip(service)}">
                                        <i class="ti ti-alert-triangle"></i>
                                        <span>Conflicto de horario</span>
                                        <button type="button" class="accept-overlap-btn" data-service-id="${service.id}" title="Aceptar este conflicto y ocultar el aviso">
                                            Aceptar
                                        </button>
                                    </span>` : '';
        // Point transfers (local & punto a punto): split into start ("Hora de
        // pick-up" for local, "Hora de salida" for punto a punto) + estimated arrival.
        if (service.transportType === 'local' || service.transportType === 'punto-a-punto') {
          const startLabel = service.transportType === 'local' ? 'Hora de pick-up:' : 'Hora de salida:';
          return `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-clock me-1"></i>
                                    <span class="me-1">${startLabel}</span>
                                    ${startT}
                                    ${overlapBadge}
                                </div>
                                ${endT ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-flag me-1"></i>
                                    <span class="me-1">Hora estimada de llegada:</span>
                                    ${endT}
                                </div>` : ''}`;
        }
        return `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-clock me-1"></i>
                                    <span class="me-1">Horario de vuelo:</span>
                                    ${service.selectedSchedule || (startT + (endT ? ` - ${endT}` : ''))}
                                    ${overlapBadge}
                                </div>`;
      })() : ''}
                            <!-- Specific address: label depends on direction (departure → salida, arrival → llegada) -->
                            ${specificLocation ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-map-pin me-1"></i>
                                    <span class="text-muted me-1">${service.directionType === 'departure' ? 'Dirección de salida:' : 'Dirección de llegada:'}</span>
                                    ${specificLocation}
                                </div>
                            ` : ''}
                            ${(() => {
        // Fix: Check for actual time values (not null, not empty string)
        const hasFlightTime = service.flightDepartureTimeSuggested && service.flightDepartureTimeSuggested.trim();
        const hasIdaTime = service.roundTripDepartureTimeSuggestedIda && service.roundTripDepartureTimeSuggestedIda.trim();
        const hasVueltaTime = service.roundTripDepartureTimeSuggestedVuelta && service.roundTripDepartureTimeSuggestedVuelta.trim();
        const hasAnyTime = hasFlightTime || hasIdaTime || hasVueltaTime;

        // Only show departure time for departure services (not arrival)
        const shouldShowDepartureTime = service.type === 'transport' && hasAnyTime && service.directionType !== 'arrival';

        return shouldShowDepartureTime;
      })() ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-clock me-1"></i>
                                    <span class="me-1">Horario de salida:</span>
                                    ${service.flightDepartureTimeSuggested || service.roundTripDepartureTimeSuggestedIda || service.roundTripDepartureTimeSuggestedVuelta}
                                    ${service.roundTripDepartureTimeSuggestedVuelta && service.roundTripDepartureTimeSuggestedVuelta !== service.roundTripDepartureTimeSuggestedIda ? ` / ${service.roundTripDepartureTimeSuggestedVuelta}` : ''}
                                </div>
                            ` : ''}
                            <!-- Vehicles -->
                            ${(hasVehicle
                                || (service.hasAdditionalVehicle && service.additionalVehicleId)
                                || (Array.isArray(service.extraAdditionalVehicles) && service.extraAdditionalVehicles.length > 0)
                            ) ? `
                                <div class="text-muted small mt-1">
                                    <div class="mb-1">
                                        <i class="ti ti-car me-1"></i><span class="text-muted">Vehículo(s):</span>
                                    </div>
                                    ${hasVehicle ? `
                                        <div class="ms-3">
                                            <div class="d-flex align-items-center justify-content-between">
                                                <span>
                                                    <strong>${vehicleName}</strong>
                                                    ${service.quantity > 1 ? ` x${service.quantity}` : ''}
                                                    ${(() => {
            const categoryName = service.category ? this.getCategoryName(service.category) : '';
            return service.category ? ` - ${categoryName || 'Segmento'}` : '';
          })()}
                                                    ${service.type === 'transport' && service.waitingTimeHours > 0 ? ` <span class="text-warning"><i class="ti ti-clock"></i> ${service.waitingTimeHours}h espera</span>` : ''}
                                                </span>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${service.hasAdditionalVehicle && service.additionalVehicleId ? `
                                        <div class="ms-3 mt-1">
                                            <div class="d-flex align-items-center gap-2">
                                                <span>
                                                    ${(() => {
            // Get actual additional vehicle name
            let additionalVehicleName = 'Vehículo adicional';
            if (service.additionalVehicleTypeName) {
              additionalVehicleName = this.cleanVehicleName(service.additionalVehicleTypeName);
            } else {
              const vehicleInfo = this.getVehicleTypeInfo(service.additionalVehicleId);
              if (vehicleInfo && vehicleInfo.name) {
                additionalVehicleName = this.cleanVehicleName(vehicleInfo.name);
              }
            }
            const additionalSegmentName = service.additionalVehicleSegment ? this.getCategoryName(service.additionalVehicleSegment) : '';
            return `<strong>${additionalVehicleName}</strong> - ${additionalSegmentName || 'Segmento'}`;
          })()}
                                                </span>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${(Array.isArray(service.extraAdditionalVehicles) ? service.extraAdditionalVehicles : []).map((v) => {
        const name = (v && (v.vehicleTypeName || '')).trim() || 'Vehículo adicional';
        const seg = (v && v.segmentName) || (v && v.segment ? this.getCategoryName(v.segment) : '');
        const wh = parseFloat(v && v.waitingHours) || 0;
        const waitingTxt = wh > 0 ? ` <span class="text-warning"><i class="ti ti-clock"></i> ${wh}h espera</span>` : '';
        return `<div class="ms-3 mt-1"><span><strong>${name}</strong>${seg ? ` - ${seg}` : ''}${waitingTxt}</span></div>`;
      }).join('')}
                                </div>
                            ` : ''}
                            ${service.includeGuide ? `
                                <div class="d-flex align-items-center text-success small mt-1">
                                    <i class="ti ti-user me-1"></i>
                                    <strong>${service.type === 'tour' ? 'Incluye Guía + Driver' : 'Incluye Guía'}</strong>
                                </div>
                            ` : ''}
                            ${service.includeGreeter ? `
                                <div class="d-flex align-items-center text-info small mt-1">
                                    <i class="ti ti-users me-1"></i>
                                    <strong>Incluye Greeter + Driver</strong>
                                </div>
                            ` : ''}
                            ${''/* Tiempo de espera del principal ahora se muestra inline junto al vehículo */}
                            ${service.isCustomPrice && this.canEditPrices ? `
                                <div class="d-flex align-items-center text-info small mt-1">
                                    <i class="ti ti-edit me-1"></i>
                                    <strong>Precio personalizado</strong>
                                </div>
                            ` : ''}
                            ${service.availabilityPending ? `
                                <div class="mt-1">
                                    <span class="badge bg-warning text-dark">
                                        <i class="ti ti-alert-triangle me-1"></i>Verificar disponibilidad
                                    </span>
                                </div>
                            ` : ''}
                            ${service.priceePending ? `
                                <div class="mt-1">
                                    <span class="badge bg-warning text-dark">
                                        <i class="ti ti-alert-triangle me-1"></i>Precio pendiente
                                    </span>
                                </div>
                            ` : ''}
                            ${service.guideGreeterPending ? `
                                <div class="mt-1">
                                    <span class="badge bg-warning text-dark">
                                        <i class="ti ti-alert-triangle me-1"></i>Guía/greeter pendiente (falta duración de ruta)
                                    </span>
                                </div>
                            ` : ''}
                            <!-- Notes Section -->
                            ${service.notes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-notes me-1"></i>
                                    <span style="white-space: pre-wrap;">${service.notes}</span>
                                </div>
                            ` : ''}
                            ${Array.isArray(service.attendees) && service.attendees.filter((n) => String(n).trim()).length > 0 ? `
                                <div class="text-muted small mt-1">
                                    <div class="mb-1">
                                        <i class="ti ti-users me-1"></i><span class="text-muted">${(service.type === 'transport' || service.type === 'a-disposicion') ? 'Pasajeros' : 'Clientes'}:</span>
                                    </div>
                                    ${service.attendees.map((n) => String(n).trim()).filter(Boolean).map((name) => `
                                        <div class="ms-3">
                                            <strong>${name}</strong>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                            ${service.clientNotes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-user me-1"></i>
                                    <span class="text-muted me-1">Notas del cliente:</span>
                                    <span style="white-space: pre-wrap;">${service.clientNotes}</span>
                                </div>
                            ` : ''}
                            ${service.providerNotes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-building me-1"></i>
                                    <span class="text-muted me-1">Notas del proveedor:</span>
                                    <span style="white-space: pre-wrap;">${service.providerNotes}</span>
                                </div>
                            ` : ''}
                            ${service.teamNotes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-users me-1"></i>
                                    <span class="text-muted me-1">Notas del equipo:</span>
                                    <span style="white-space: pre-wrap;">${service.teamNotes}</span>
                                </div>
                            ` : ''}
                            ${service.internalNotes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-lock me-1"></i>
                                    <span class="text-muted me-1">Notas internas:</span>
                                    <span style="white-space: pre-wrap;">${service.internalNotes}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="d-flex flex-column align-items-end">
                        <div class="service-actions mb-2">
                            ${(['admin', 'superadmin'].includes(this.userRole) || !this.isServiceProtected(service)) ? `
                            <div class="btn-group btn-group-sm">
                                <button type="button" class="btn btn-light edit-service-btn"
                                        data-day-id="${service.dayId}" data-service-id="${service.id}" title="Editar">
                                    <i class="ti ti-pencil"></i>
                                </button>
                                <button type="button" class="btn btn-light duplicate-service-btn"
                                        data-service-id="${service.id}" title="Duplicar">
                                    <i class="ti ti-copy"></i>
                                </button>
                                <button type="button" class="btn btn-light delete-service-btn"
                                        data-service-id="${service.id}" title="Eliminar">
                                    <i class="ti ti-trash"></i>
                                </button>
                            </div>
                            ` : ''}
                            ${this.renderServiceLockControls(service)}
                        </div>
                        ${!(service.type === 'concepto' && this.getServiceDisplayPrice(service) <= 0) ? `
                            ${service.includeInTotal === false ? `
                            <span class="badge bg-secondary-subtle text-secondary mb-1">Pago externo</span>
                            ` : ''}
                            <div class="fw-semibold ${service.includeInTotal === false ? 'text-muted text-decoration-line-through' : 'text-primary'}">
                                ${this.formatCurrency(this.getServiceDisplayPrice(service))}
                                ${this.getPriceTypeLabel()}
                            </div>
                            ${Number(service.discountAmount) > 0 ? `<div class="small text-success mt-1" title="Descuento aplicado"><i class="ti ti-discount-2 me-1"></i>Descuento ${service.discountType === 'percent' ? service.discountValue + '%' : ''} −${this.formatCurrency(service.discountAmount)}</div>` : ''}
                            ${(['admin', 'superadmin'].includes(this.userRole) || !this.isServiceProtected(service)) ? `
                            <button type="button" class="btn btn-sm btn-link p-0 mt-1 toggle-include-total-btn d-flex align-items-center gap-1"
                                    data-service-id="${service.id}" title="${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}" style="text-decoration: none;">
                                <i class="ti ${service.includeInTotal === false ? 'ti-circle-plus text-success' : 'ti-circle-minus text-muted'}" style="font-size: 0.85rem;"></i>
                                <small class="${service.includeInTotal === false ? 'text-success' : 'text-muted'}" style="font-size: 0.7rem;">${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}</small>
                            </button>
                            ` : ''}
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
};

ItineraryBuilder.prototype.addAdditionalFlightRow = function (flight = {}, listId = 'additionalFlightsList', headerId = 'additionalFlightsHeader') {
    const list = document.getElementById(listId);
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'row g-2 mb-2 additional-flight-row align-items-end';
    const esc = (v) => String(v || '').replace(/"/g, '&quot;');
    row.innerHTML = `
      <div class="col-md-4">
        <input type="text" class="form-control form-control-sm additional-flight-airline" placeholder="Aerolínea" value="${esc(flight.airline)}">
      </div>
      <div class="col-md-3">
        <input type="text" class="form-control form-control-sm additional-flight-number" placeholder="N° vuelo" value="${esc(flight.flightNumber)}">
      </div>
      <div class="col-md-3">
        <input type="text" class="form-control form-control-sm time-input additional-flight-time" list="quoteTimeOptions" placeholder="__:__" maxlength="5" autocomplete="off" value="${esc(flight.flightTime)}">
      </div>
      <div class="col-md-2 text-end">
        <button type="button" class="btn btn-sm btn-outline-danger remove-additional-flight-btn" title="Quitar">
          <i class="ti ti-x"></i>
        </button>
      </div>
    `;
    row.querySelector('.remove-additional-flight-btn')?.addEventListener('click', () => {
      row.remove();
      this.updateAdditionalFlightsHeaderVisibility(listId, headerId);
    });
    list.appendChild(row);
    this.updateAdditionalFlightsHeaderVisibility(listId, headerId);
};

ItineraryBuilder.prototype.clearAdditionalFlights = function (listId = 'additionalFlightsList', headerId = 'additionalFlightsHeader') {
    const list = document.getElementById(listId);
    if (list) list.innerHTML = '';
    this.updateAdditionalFlightsHeaderVisibility(listId, headerId);
};

ItineraryBuilder.prototype.populateAdditionalFlights = function (flights, listId = 'additionalFlightsList', headerId = 'additionalFlightsHeader') {
    this.clearAdditionalFlights(listId, headerId);
    const arr = Array.isArray(flights) ? flights : [];
    arr.forEach((f) => this.addAdditionalFlightRow(f || {}, listId, headerId));
};

ItineraryBuilder.prototype.collectAdditionalFlights = function (listId = 'additionalFlightsList') {
    const rows = document.querySelectorAll(`#${listId} .additional-flight-row`);
    return Array.from(rows)
      .map((row) => ({
        airline: (row.querySelector('.additional-flight-airline')?.value || '').trim(),
        flightNumber: (row.querySelector('.additional-flight-number')?.value || '').trim(),
        flightTime: (row.querySelector('.additional-flight-time')?.value || '').trim(),
      }))
      .filter((f) => f.airline || f.flightNumber || f.flightTime);
};

ItineraryBuilder.prototype.handleTourTransportToggle = function (requiresTransport) {
    // Get the transport field elements
    const categoryField = document.getElementById('transportCategory')?.closest('[class*="col-"]');
    const vehicleField = document.getElementById('vehicleSelect')?.closest('[class*="col-"]');
    const guideField = document.getElementById('includeGuide')?.closest('[class*="col-"]');

    // Get the pricing fields (Precio and Cantidad)
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    const standardPricingSection = document.getElementById('standardPricingSection');

    if (requiresTransport) {
      // Show transport fields
      categoryField?.classList.remove('d-none');
      vehicleField?.classList.remove('d-none');
      guideField?.classList.remove('d-none');
      document.getElementById('transportCategory')?.setAttribute('required', 'required');

      // For tours, guide is always included. The checkbox controls adding a chofer too.
      const guideLabel = guideField?.querySelector('.form-check-label[for="includeGuide"]');
      if (guideLabel) guideLabel.textContent = 'Guía + Chofer';

      // Hide quantity, show additional vehicle checkbox
      const quantityField = document.getElementById('serviceQuantity')?.closest('.col-md-6');
      quantityField?.classList.add('d-none');
      document.getElementById('serviceQuantity').value = 1;
      document.getElementById('extraAdditionalVehiclesContainer')?.classList.remove('d-none');
      this.syncExtraVehiclesButtonEnabled();

      // Only uncheck additional vehicle if we're NOT populating the form during edit
      if (!this._populatingVehicleTourForm) {
        const _avCb = document.getElementById('additionalVehicleCheckbox'); if (_avCb) _avCb.checked = false;
      }

      // Show pricing fields — clear any inline display:none left over from
      // a previous walking-tour edit (which force-hides the section).
      if (standardPricingSection) {
        standardPricingSection.classList.remove('d-none');
        standardPricingSection.style.display = '';
      }

      // Vehicle tours: the price field is ALWAYS editable — keep the "Editar precio
      // manualmente" checkbox hidden and force the override ON so the breakdown reads
      // servicePrice. This runs on new selection AND edit population, so it's the single
      // source of truth for the toggle state. (Walking tours never reach this branch.)
      if (this.canEditPrices) {
        document.getElementById('tourVehicleOverridePricesContainer')?.classList.add('d-none');
        const vehicleOverrideCheckbox = document.getElementById('tourVehicleOverridePrices');
        if (vehicleOverrideCheckbox) vehicleOverrideCheckbox.checked = true;
        const servicePriceFieldEditable = document.getElementById('servicePrice');
        if (servicePriceFieldEditable) {
          servicePriceFieldEditable.readOnly = false;
          servicePriceFieldEditable.removeAttribute('readonly');
          servicePriceFieldEditable.removeAttribute('data-readonly');
          servicePriceFieldEditable.classList.remove('readonly-price');
          servicePriceFieldEditable.style.backgroundColor = '';
        }
      }

      this.updateVehicleCapacityNote();
    } else {
      // Hide transport fields
      categoryField?.classList.add('d-none');
      vehicleField?.classList.add('d-none');
      guideField?.classList.add('d-none');
      document.getElementById('transportCategory')?.removeAttribute('required');

      // Hide the tour vehicle override toggle
      if (this.canEditPrices) {
        document.getElementById('tourVehicleOverridePricesContainer')?.classList.add('d-none');
      }

      // Hide additional vehicle checkbox, show quantity field
      document.getElementById('additionalVehicleContainer')?.classList.add('d-none');
      document.getElementById('vehicleCapacityNote')?.classList.add('d-none');

      // Hide pricing fields
      if (standardPricingSection) {
        standardPricingSection.classList.add('d-none');
      }

      // Clear transport field values when hidden
      const transportCategory = document.getElementById('transportCategory');
      const vehicleSelect = document.getElementById('vehicleSelect');
      const includeGuide = document.getElementById('includeGuide');
      const includeGreeter = document.getElementById('includeGreeter');

      if (transportCategory) transportCategory.value = '';
      if (vehicleSelect) vehicleSelect.value = '';
      if (includeGuide) includeGuide.checked = false;
      if (includeGreeter) includeGreeter.checked = false;

      // Clear pricing field values when hidden
      const servicePrice = document.getElementById('servicePrice');
      const quantity = document.getElementById('quantity');

      if (quantity) quantity.value = '1';
      // Note: Currency and payment type are preserved from saved values

      // Recalculate price without vehicle costs for tours
      this.recalculateTourPrice();

      // Update dev breakdown to reflect no vehicle
      this.updateDevPaymentBreakdown();

      // Refresh the visible desglose (reads from the dev breakdown updated above).
      // Without this the breakdown kept showing the previous "con vehículo" values.
      setTimeout(() => {
        this.updateServicePriceBreakdown();
      }, 50);

      // Update the current service data to reflect no vehicle
      if (this.currentServiceId) {
        const currentService = this.getServiceForEditing();
        if (currentService && currentService.type === 'tour') {
          // Clear vehicle data
          currentService.vehicleId = null;
          currentService.vehicleType = null;
          currentService.vehicleTypeName = null;
          currentService.rateId = null;
          // Update the display immediately
          this.updateTotals();
          this.renderDaysContent();
        }
      }
    }

    // Reubica el precio: inline (segmento + vehículo + precio) cuando hay traslado; si no, vuelve
    // a su lugar.
    this.syncMainVehiclePriceLayout();
};

ItineraryBuilder.prototype.setRouteDurationFields = function (min) {
    const hoursEl = document.getElementById('routeDurationHours');
    const minsEl = document.getElementById('routeDurationMinutes');
    const m = Number(min);
    if (!m || Number.isNaN(m) || m <= 0) {
      if (hoursEl) hoursEl.value = '';
      if (minsEl) minsEl.value = '';
    } else {
      if (hoursEl) hoursEl.value = Math.floor(m / 60);
      if (minsEl) minsEl.value = Math.round(m % 60);
    }
    this.updateRouteDurationRoundTripHint();
};

ItineraryBuilder.prototype.updateRouteDurationRoundTripHint = function () {
    const hintEl = document.getElementById('routeDurationRoundTripHint');
    if (!hintEl) return;
    const h = parseInt(document.getElementById('routeDurationHours')?.value || 0, 10) || 0;
    const mm = parseInt(document.getElementById('routeDurationMinutes')?.value || 0, 10) || 0;
    const oneLeg = (h * 60) + mm;
    if (this.isRoundTrip() && oneLeg > 0) {
      hintEl.textContent = `Ida y vuelta (×2): total ${this.formatMinutesToHoursAndMinutes(oneLeg * 2)}`;
      hintEl.classList.remove('d-none');
    } else {
      hintEl.classList.add('d-none');
    }
};

ItineraryBuilder.prototype.getRouteDurationMinutes = function () {
    // Los campos se capturan/muestran en HORAS + MINUTOS; internamente todo (guía/greeter/hora
    // sugerida, guardado) usa MINUTOS. Aquí sumamos horas*60 + minutos.
    const hoursEl = document.getElementById('routeDurationHours');
    const minsEl = document.getElementById('routeDurationMinutes');
    if ((hoursEl && hoursEl.value !== '') || (minsEl && minsEl.value !== '')) {
      const h = parseInt(hoursEl?.value || 0, 10) || 0;
      const mm = parseInt(minsEl?.value || 0, 10) || 0;
      const total = (h * 60) + mm;
      if (total > 0) return total;
    }
    let rd = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;
    if (!rd && this.currentServiceId && this.services.has(this.currentServiceId)) {
      rd = this.services.get(this.currentServiceId).routeDuration || null;
    }
    return rd;
};

ItineraryBuilder.prototype.updateSuggestedDepartureTime = function () {
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    // Fuente única: campo editable → lookup → guardado (ver getRouteDurationMinutes).
    const routeDuration = this.getRouteDurationMinutes();

    qsDevLog('🕐 updateSuggestedDepartureTime called:', {
      tripType,
      routeDuration,
      transportPriceData: this.transportPriceData,
      cachedRouteDuration: this.cachedRouteDuration,
      currentServiceId: this.currentServiceId,
      isEditing: !!this.currentServiceId,
    });

    // Aviso visible: si no hay duración de ruta, no se puede sugerir la hora → avisar para
    // capturarla a mano. (El aviso vive dentro del container de la sugerida, así que sólo se ve
    // cuando ese campo aplica.) Si sí hay duración, se oculta.
    this.setNoRouteDurationWarning(!routeDuration);
    if (!routeDuration) {
      qsDevLog('⚠️ No route duration available');
      return;
    }

    if (tripType === 'round-trip') {
      // Round trip Ida
      const idaFlightTime = document.getElementById('roundTripTimeIda')?.value;
      qsDevLog('🛫 Round trip Ida:', { flightTime: idaFlightTime });
      if (idaFlightTime) {
        const suggestedTime = this.calculateSuggestedDepartureTime(idaFlightTime, routeDuration);
        const suggestedField = document.getElementById('roundTripDepartureTimeSuggestedIda');
        qsDevLog('📝 Setting Ida suggested time:', { suggestedTime, fieldExists: !!suggestedField });
        if (suggestedField && suggestedTime && suggestedField.dataset.userEdited !== '1') {
          suggestedField.value = suggestedTime;
        }
      }

      // Round trip Vuelta
      const vueltaFlightTime = document.getElementById('roundTripTimeVuelta')?.value;
      qsDevLog('🛬 Round trip Vuelta:', { flightTime: vueltaFlightTime });
      if (vueltaFlightTime) {
        const suggestedTime = this.calculateSuggestedDepartureTime(vueltaFlightTime, routeDuration);
        const suggestedField = document.getElementById('roundTripDepartureTimeSuggestedVuelta');
        qsDevLog('📝 Setting Vuelta suggested time:', { suggestedTime, fieldExists: !!suggestedField });
        if (suggestedField && suggestedTime && suggestedField.dataset.userEdited !== '1') {
          suggestedField.value = suggestedTime;
        }
      }
    } else {
      // One-way
      const flightTime = document.getElementById('flightTime')?.value;
      qsDevLog('✈️ One-way:', { flightTime });
      if (flightTime) {
        const suggestedTime = this.calculateSuggestedDepartureTime(flightTime, routeDuration);
        const suggestedField = document.getElementById('flightDepartureTimeSuggested');
        qsDevLog('📝 Setting one-way suggested time:', { suggestedTime, fieldExists: !!suggestedField });
        if (suggestedField && suggestedTime && suggestedField.dataset.userEdited !== '1') {
          suggestedField.value = suggestedTime;
          qsDevLog('✅ Field updated successfully');
        }
      }
    }
};

ItineraryBuilder.prototype.updateRouteDurationFromRoute = async function () {
    if (this._populatingTransportForm) return;
    const { originName, destinationName } = this.getTransportRouteNames();
    if (!originName || !destinationName) return;
    try {
      const params = new URLSearchParams({ originPOI: originName, destinationPOI: destinationName });
      const accessToken = this.getAccessToken();
      const res = await fetch(`/api/services/route-duration?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken || ''}` },
      });
      if (!res.ok) return;
      const result = await res.json();
      const minutes = result?.data?.routeDuration;
      if (minutes) {
        this.cachedRouteDuration = minutes;
        this.setRouteDurationFields(minutes);
        if (typeof this.updateTransferArrivalEstimate === 'function') this.updateTransferArrivalEstimate();
      }
    } catch (e) {
      // Silent — duration stays as-is; the field can be captured manually.
    }
};

ItineraryBuilder.prototype.populateTransportVehicleDropdown = function (vehicles) {
    const vehicleSelect = document.getElementById('vehicleSelect');
    if (!vehicleSelect) return;

    vehicleSelect.innerHTML = '<option value="">-- Sin vehículo --</option>';
    vehicleSelect.value = '';

    if (!vehicles || vehicles.length === 0) {
      const noOption = document.createElement('option');
      noOption.value = '';
      noOption.textContent = '-- Sin vehículos disponibles --';
      noOption.disabled = true;
      vehicleSelect.appendChild(noOption);
      return;
    }

    vehicles.forEach((vehicle) => {
      const option = document.createElement('option');
      option.value = vehicle.vehicleTypeId;

      const pax = vehicle.capacity || 0;
      const trunk = vehicle.trunkCapacity || 0;
      // El asterisco (precio de cliente) SOLO lo ven admin/superadmin.
      const clientIndicator = (vehicle.isClientPrice && this.canEditPrices) ? ' *' : '';
      option.textContent = `${vehicle.vehicleType} - ${pax} pax, ${trunk} carry-on${clientIndicator}`;

      vehicleSelect.appendChild(option);
    });

    // Reset price since no vehicle is selected yet
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.value = '0.00';
    }

    // Also update additional vehicle dropdown if it's using the same segment
    const mainSegmentId = document.getElementById('transportCategory')?.value;
    const additionalSegmentId = document.getElementById('additionalSegmentSelect')?.value;

    if (additionalSegmentId && additionalSegmentId === mainSegmentId) {
      qsDevLog('🔄 Syncing additional vehicle dropdown with main vehicle data');
      this.populateAdditionalVehicleDropdown(vehicles);
    }
};
