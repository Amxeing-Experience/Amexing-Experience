/* eslint-env browser */
/**
 * quote-services-v2-helpers.js
 * Helpers PUROS (sin estado de instancia) extraidos de quote-services-v2.js como
 * ItineraryBuilder.prototype. DEBE cargarse DESPUES de quote-services-v2.js.
 * Created by Denisse Maldonado
 */

ItineraryBuilder.prototype.getAccessToken = function () {
    const cookies = document.cookie.split(';');

    // First try to get from window variable (passed from server)
    if (window.quoteAccessToken) {
      // Set the cookie for future requests since middleware expects it
      document.cookie = `accessToken=${window.quoteAccessToken}; path=/; SameSite=Lax`;
      return window.quoteAccessToken;
    }

    // Then try to get from cookies
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'accessToken') {
        return value;
      }
    }

    // Fallback to localStorage
    const localToken = localStorage.getItem('accessToken');
    if (localToken) {
      return localToken;
    }

    // Try sessionStorage as another fallback
    const sessionToken = sessionStorage.getItem('accessToken');
    if (sessionToken) {
      return sessionToken;
    }

    return null;
};

ItineraryBuilder.prototype.extractTotalFromBreakdown = function (breakdownText) {
    if (!breakdownText) return 0;
    const match = breakdownText.match(/Total:\s*\$([0-9,]+\.?\d*)/);
    return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
};

ItineraryBuilder.prototype.initDatePickers = function () {
    if (!window.flatpickr) return;
    const locale = (window.flatpickr.l10ns && window.flatpickr.l10ns.es) || 'es';
    const dateInput = document.getElementById('quickDayDate');
    if (dateInput && !dateInput._flatpickr) {
      window.flatpickr(dateInput, {
        dateFormat: 'Y-m-d', // value kept machine-readable
        altInput: true, // show a friendly, localized label
        altFormat: 'l j M Y', // e.g. "lunes 22 jun 2026"
        locale,
        disableMobile: true, // consistent picker even on mobile
      });
    }
};

ItineraryBuilder.prototype.setDateValue = function (input, value) {
    if (!input) return;
    if (input._flatpickr) input._flatpickr.setDate(value, false);
    else input.value = value;
};

ItineraryBuilder.prototype.closeAddDayInline = function () {
    const row = document.getElementById('addDayInline');
    if (row) row.classList.add('d-none');
    const titleInput = document.getElementById('quickDayTitle');
    if (titleInput) titleInput.value = '';
};

ItineraryBuilder.prototype.populateTimeDatalist = function () {
    let dl = document.getElementById('quoteTimeOptions');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'quoteTimeOptions';
      document.body.appendChild(dl);
    }
    if (dl.options && dl.options.length) return; // ya poblado
    let html = '';
    for (let h = 0; h < 24; h += 1) {
      for (let m = 0; m < 60; m += 15) {
        const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        html += `<option value="${t}"></option>`;
      }
    }
    dl.innerHTML = html;
};

ItineraryBuilder.prototype.setServiceTypeLocked = function (locked) {
    document.querySelectorAll('input[name="serviceType"]').forEach((radio) => {
      radio.disabled = !!locked;
      // Atenuar la etiqueta asociada para que se vea claramente deshabilitado.
      const label = radio.closest('label') || document.querySelector(`label[for="${radio.id}"]`);
      if (label) label.classList.toggle('opacity-50', !!locked);
    });
};

ItineraryBuilder.prototype.updateAttendeesLabels = function (type) {
    const isPassengers = type === 'transport' || type === 'a-disposicion';
    const labelEl = document.getElementById('serviceAttendeesLabel');
    if (labelEl) labelEl.textContent = isPassengers ? 'Pasajeros' : 'Clientes';
    const btnTextEl = document.getElementById('addAttendeeBtnText');
    if (btnTextEl) btnTextEl.textContent = isPassengers ? 'Agregar pasajero' : 'Agregar cliente';
};

ItineraryBuilder.prototype.setDefaultValuesForServiceType = function (serviceType) {
    // Set default values based on service type
    const priceField = document.getElementById('servicePrice');

    switch (serviceType) {
      case 'concepto':
      case 'a-disposicion':
        // Concepto/A Disposición defaults to empty/0 price (optional pricing)
        if (priceField) priceField.value = '';
        break;
      case 'experience':
        // Experience requires pricing, but start empty until user selects an experience
        if (priceField) priceField.value = '';
        break;
      case 'tour':
        // Tour requires pricing, but start empty until user selects a tour
        if (priceField) priceField.value = '';
        break;
      case 'transport':
        // Transport requires pricing, but start empty until user configures transport
        if (priceField) priceField.value = '';
        break;
      default:
        if (priceField) priceField.value = '';
        break;
    }

    // Clear description and notes fields for fresh start
    const descriptionField = document.getElementById('serviceDescription');
    const internalNotesField = document.getElementById('internalNotes');
    const clientNotesField = document.getElementById('clientNotes');
    const providerNotesField = document.getElementById('providerNotes');
    const teamNotesField = document.getElementById('teamNotes');

    if (descriptionField) descriptionField.value = '';
    if (internalNotesField) internalNotesField.value = '';
    if (clientNotesField) clientNotesField.value = '';
    if (providerNotesField) providerNotesField.value = '';
    if (teamNotesField) teamNotesField.value = '';
};

ItineraryBuilder.prototype.addMinutesToTime = function (timeStr, minutes) {
    const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || !minutes) return null;
    const total = (((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + Math.round(minutes)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

ItineraryBuilder.prototype.isRoundTrip = function () {
    const t = document.querySelector('input[name="tripType"]:checked')?.value;
    return t === 'round-trip' || t === 'roundtrip';
};

ItineraryBuilder.prototype.updateTransferScheduleLabels = function () {
    const type = document.querySelector('input[name="transportType"]:checked')?.value;
    const isLocal = type === 'local';
    const isTransfer = isLocal || type === 'punto-a-punto';
    const startLabel = document.querySelector('label[for="transportStartTime"]');
    const endLabel = document.querySelector('label[for="transportEndTime"]');
    const endInput = document.getElementById('transportEndTime');
    if (startLabel) startLabel.textContent = isLocal ? 'Hora de pick-up' : 'Hora de salida';
    if (endLabel) endLabel.textContent = isTransfer ? 'Hora estimada de llegada' : 'Hora de fin';
    if (endInput) {
      endInput.readOnly = isTransfer;
      endInput.classList.toggle('bg-light', isTransfer);
    }
};

ItineraryBuilder.prototype.parseTimeToMinutes = function (str) {
    const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
};

ItineraryBuilder.prototype.updateRoundTripFieldVisibility = function () {
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    if (!transportType) return;

    // --- IDA (arrival pattern) ---
    const idaOriginSelect = document.getElementById('roundTripOriginIdaSelect');
    const idaOriginText = document.getElementById('roundTripOriginIdaText');
    const idaDestComboWrapper = document.getElementById('roundTripDestinationIdaComboWrapper');
    const idaDestSelect = document.getElementById('roundTripDestinationIdaSelect');
    const idaOriginLabel = document.getElementById('roundTripOriginIdaLabel');

    // Hide all Ida variants first
    idaOriginSelect?.classList.add('d-none');
    idaOriginText?.classList.add('d-none');
    idaDestComboWrapper?.classList.add('d-none');
    idaDestSelect?.classList.add('d-none');

    if (transportType === 'local') {
      // Local Ida: Origin = TEXT, Destination = SELECT
      idaOriginText?.classList.remove('d-none');
      idaDestSelect?.classList.remove('d-none');
      if (idaOriginLabel) idaOriginLabel.innerHTML = 'Origen (San Miguel de Allende) <span class="text-danger">*</span>';
    } else {
      // Aeropuerto / Punto a Punto: Origin = SELECT, Destination = SELECT dropdown
      idaOriginSelect?.classList.remove('d-none');
      idaDestSelect?.classList.remove('d-none');
      if (idaOriginLabel) idaOriginLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
    }

    // --- VUELTA (departure pattern) ---
    const vueltaOriginComboWrapper = document.getElementById('roundTripOriginVueltaComboWrapper');
    const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
    const vueltaDestSelect = document.getElementById('roundTripDestinationVueltaSelect');
    const vueltaDestText = document.getElementById('roundTripDestinationVueltaText');
    const vueltaDestLabel = document.getElementById('roundTripDestinationVueltaLabel');

    // Hide all Vuelta variants first
    vueltaOriginComboWrapper?.classList.add('d-none');
    vueltaOriginSelect?.classList.add('d-none');
    vueltaDestSelect?.classList.add('d-none');
    vueltaDestText?.classList.add('d-none');

    if (transportType === 'local') {
      // Local Vuelta: Origin = SELECT, Destination = TEXT
      vueltaOriginSelect?.classList.remove('d-none');
      vueltaDestText?.classList.remove('d-none');
      if (vueltaDestLabel) vueltaDestLabel.innerHTML = 'Destino (San Miguel de Allende) <span class="text-danger">*</span>';
    } else {
      // Aeropuerto / Punto a Punto: Origin = SELECT dropdown, Destination = SELECT
      vueltaOriginSelect?.classList.remove('d-none');
      vueltaDestSelect?.classList.remove('d-none');
      if (vueltaDestLabel) vueltaDestLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
    }

    // Update section headers based on transport type
    const idaHeader = document.getElementById('roundTripIdaHeader');
    const vueltaHeader = document.getElementById('roundTripVueltaHeader');
    const dateIdaLabel = document.getElementById('roundTripDateIdaLabel');
    const timeIdaLabel = document.getElementById('roundTripTimeIdaLabel');
    const dateVueltaLabel = document.getElementById('roundTripDateVueltaLabel');
    const timeVueltaLabel = document.getElementById('roundTripTimeVueltaLabel');

    if (transportType === 'aeropuerto') {
      if (idaHeader) idaHeader.innerHTML = '<i class="ti ti-plane-arrival me-2"></i>Arrival';
      if (vueltaHeader) vueltaHeader.innerHTML = '<i class="ti ti-plane-departure me-2"></i>Departure';
      // Aeropuerto: la fecha/hora de cada pierna corresponden a su vuelo → "de Vuelo".
      if (dateIdaLabel) dateIdaLabel.textContent = 'Fecha de Vuelo';
      if (timeIdaLabel) timeIdaLabel.textContent = 'Hora de Vuelo';
      if (dateVueltaLabel) dateVueltaLabel.textContent = 'Fecha de Vuelo';
      if (timeVueltaLabel) timeVueltaLabel.textContent = 'Hora de Vuelo';
    } else if (transportType === 'punto-a-punto') {
      // Punto a Punto: the first leg is the arrival at the destination,
      // the second leg is the return trip from it.
      if (idaHeader) idaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Llegada';
      if (vueltaHeader) vueltaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Salida';
      if (dateIdaLabel) dateIdaLabel.textContent = 'Fecha de Llegada';
      if (timeIdaLabel) timeIdaLabel.textContent = 'Hora de Llegada';
      if (dateVueltaLabel) dateVueltaLabel.textContent = 'Fecha de Salida';
      if (timeVueltaLabel) timeVueltaLabel.textContent = 'Hora de Salida';
    } else {
      // Local: the first leg drops the guest off (llevar), the second leg picks them up (recoger).
      if (idaHeader) idaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Llevar';
      if (vueltaHeader) vueltaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Recoger';
      if (dateIdaLabel) dateIdaLabel.textContent = 'Fecha de Llevar';
      if (timeIdaLabel) timeIdaLabel.textContent = 'Hora de Llevar';
      if (dateVueltaLabel) dateVueltaLabel.textContent = 'Fecha de Recoger';
      if (timeVueltaLabel) timeVueltaLabel.textContent = 'Hora de Recoger';
    }

    // "Hora de salida sugerida" de la vuelta: SOLO aplica en aeropuerto. En local y punto-a-punto
    // se usa la "Hora estimada de llegada" por pierna, así que se oculta y limpia aquí.
    const vueltaSuggestedRow = document.getElementById('roundTripDepartureTimeSuggestedVueltaRow');
    if (vueltaSuggestedRow) {
      const hideSuggested = transportType !== 'aeropuerto';
      vueltaSuggestedRow.classList.toggle('d-none', hideSuggested);
      if (hideSuggested) {
        const vueltaSuggestedField = document.getElementById('roundTripDepartureTimeSuggestedVuelta');
        if (vueltaSuggestedField) vueltaSuggestedField.value = '';
      }
    }

    // Populate dropdowns for both directions
    if (typeof populateDropdownsForTransportType === 'function') {
      populateRoundTripDropdowns(transportType);
    }
};

ItineraryBuilder.prototype.syncIdaToVuelta = function () {
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    if (tripType !== 'round-trip') return;

    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    if (!transportType) return;

    if (transportType === 'local') {
      // Local: Ida origin (TEXT) → Vuelta destination (TEXT)
      const idaOrigin = document.getElementById('roundTripOriginIdaText')?.value || '';
      const vueltaDestText = document.getElementById('roundTripDestinationVueltaText');
      if (vueltaDestText && !vueltaDestText.value) vueltaDestText.value = idaOrigin;

      // Local: Ida destination (SELECT) → Vuelta origin (SELECT)
      const idaDestSlug = document.getElementById('roundTripDestinationIdaSelect')?.value || '';
      const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
      if (vueltaOriginSelect && !vueltaOriginSelect.value) vueltaOriginSelect.value = idaDestSlug;
    } else {
      // Aeropuerto / Punto a Punto:
      // Ida origin (SELECT slug) → Vuelta destination (SELECT slug)
      const idaOriginSlug = document.getElementById('roundTripOriginIdaSelect')?.value || '';
      const vueltaDestSelect = document.getElementById('roundTripDestinationVueltaSelect');
      if (vueltaDestSelect && !vueltaDestSelect.value) vueltaDestSelect.value = idaOriginSlug;

      // Ida destination (SELECT slug) → Vuelta origin (SELECT slug)
      const idaDestSlug = document.getElementById('roundTripDestinationIdaSelect')?.value || '';
      const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
      if (vueltaOriginSelect && !vueltaOriginSelect.value) vueltaOriginSelect.value = idaDestSlug;

      // Auto-fill Ida specific location → Vuelta specific location
      const idaSpecific = document.getElementById('roundTripSpecificLocationIda')?.value || '';
      const vueltaSpecific = document.getElementById('roundTripSpecificLocationVuelta');
      if (vueltaSpecific && !vueltaSpecific.value && idaSpecific) vueltaSpecific.value = idaSpecific;

      // Show Vuelta specific location row if origin was auto-filled
      const vueltaOriginVal = document.getElementById('roundTripOriginVueltaSelect')?.value;
      const vueltaLocRow = document.getElementById('roundTripSpecificLocationVueltaRow');
      if (vueltaLocRow && vueltaOriginVal) vueltaLocRow.classList.remove('d-none');
    }

    // Show/hide specific location fields after sync
    if (typeof window.checkRoundTripSpecificLocationFields === 'function') {
      window.checkRoundTripSpecificLocationFields();
    }
};

ItineraryBuilder.prototype.restoreVehicleTourQuantities = function (service) {
    // Restore adult quantity
    const adultsField = document.getElementById('tourAdultsQuantity');
    if (adultsField && service.adultsQuantity !== undefined) {
      adultsField.value = service.adultsQuantity;
    }

    // Restore children quantity
    const childrenField = document.getElementById('tourChildrenQuantity');
    if (childrenField && service.childrenQuantity !== undefined) {
      childrenField.value = service.childrenQuantity;
    }

    // Restore no-alcohol adults quantity
    const noAlcoholField = document.getElementById('tourAdultsNoAlcoholQuantity');
    if (noAlcoholField && service.adultsNoAlcoholQuantity !== undefined) {
      noAlcoholField.value = service.adultsNoAlcoholQuantity;
    }

    // Restore infants quantity
    const infantsField = document.getElementById('tourInfantsQuantity');
    if (infantsField && service.infantsQuantity !== undefined) {
      infantsField.value = service.infantsQuantity;
    }

    qsDevLog('✅ Restored vehicle tour quantities:', {
      adults: service.adultsQuantity,
      children: service.childrenQuantity,
      noAlcohol: service.adultsNoAlcoholQuantity,
      infants: service.infantsQuantity,
    });
};

ItineraryBuilder.prototype.restoreVehicleTourPrices = function (service) {
    // Restore individual person prices if custom
    if (service.priceOverride && service.customPrices) {
      const adultPriceField = document.getElementById('tourAdultPrice');
      const childPriceField = document.getElementById('tourChildPrice');
      const noAlcoholPriceField = document.getElementById('tourNoAlcoholPrice');

      if (adultPriceField) adultPriceField.value = service.customPrices.adult || 0;
      if (childPriceField) childPriceField.value = service.customPrices.child || 0;
      if (noAlcoholPriceField) noAlcoholPriceField.value = service.customPrices.noAlcohol || 0;
    } else {
      // Use standard prices
      const adultPriceField = document.getElementById('tourAdultPrice');
      const childPriceField = document.getElementById('tourChildPrice');
      const noAlcoholPriceField = document.getElementById('tourNoAlcoholPrice');

      if (adultPriceField && service.adultPrice !== undefined) {
        adultPriceField.value = service.adultPrice;
      }
      if (childPriceField && service.childPrice !== undefined) {
        childPriceField.value = service.childPrice;
      }
      if (noAlcoholPriceField && service.noAlcoholPrice !== undefined) {
        noAlcoholPriceField.value = service.noAlcoholPrice;
      }
    }

    // Restore dev breakdown prices if available
    if (service.pricesByType) {
      const devPriceEfectivoField = document.getElementById('devPriceEfectivo');
      const devPriceTransferenciaField = document.getElementById('devPriceTransferencia');
      const devPriceTarjetaField = document.getElementById('devPriceTarjeta');

      if (devPriceEfectivoField && service.pricesByType.efectivo !== undefined) {
        devPriceEfectivoField.value = service.pricesByType.efectivo.toFixed(2);
      }
      if (devPriceTransferenciaField && service.pricesByType.transferencia !== undefined) {
        devPriceTransferenciaField.value = service.pricesByType.transferencia.toFixed(2);
      }
      if (devPriceTarjetaField && service.pricesByType.tarjeta !== undefined) {
        devPriceTarjetaField.value = service.pricesByType.tarjeta.toFixed(2);
      }

      qsDevLog('✅ Restored dev prices from pricesByType');
    }

    // Restore dev breakdown texts if available
    if (service.devBreakdowns) {
      const devBreakdownEfectivoField = document.getElementById('devBreakdownEfectivo');
      const devBreakdownTransferenciaField = document.getElementById('devBreakdownTransferencia');
      const devBreakdownTarjetaField = document.getElementById('devBreakdownTarjeta');

      if (devBreakdownEfectivoField && service.devBreakdowns.efectivo) {
        devBreakdownEfectivoField.value = service.devBreakdowns.efectivo;
      }
      if (devBreakdownTransferenciaField && service.devBreakdowns.transferencia) {
        devBreakdownTransferenciaField.value = service.devBreakdowns.transferencia;
      }
      if (devBreakdownTarjetaField && service.devBreakdowns.tarjeta) {
        devBreakdownTarjetaField.value = service.devBreakdowns.tarjeta;
      }

      qsDevLog('✅ Restored dev breakdown texts');
    }
};

ItineraryBuilder.prototype.getDevBreakdownContent = function () {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';

    // Get the corresponding dev breakdown field
    const fieldId = `devBreakdown${paymentType.charAt(0).toUpperCase() + paymentType.slice(1)}`;
    const devBreakdownField = document.getElementById(fieldId);
    const breakdownText = devBreakdownField?.value || '';

    qsDevLog('📄 Reading devBreakdown content:', {
      paymentType,
      fieldId,
      hasField: !!devBreakdownField,
      textLength: breakdownText.length,
      textPreview: `${breakdownText.substring(0, 100)}...`,
    });

    if (!breakdownText.trim()) {
      qsDevLog('📄 DevBreakdown is empty');
      return {
        items: [], total: 0, totalText: '', isValid: false,
      };
    }

    // Parse breakdown text into structured data
    const lines = breakdownText.split('\n').filter((line) => line.trim());
    const items = [];
    let totalText = '';
    let total = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('Total:')) {
        totalText = trimmed;
        const totalMatch = trimmed.match(/Total:\s*\$?([\d,]+\.?\d*)/);
        if (totalMatch) {
          total = parseFloat(totalMatch[1].replace(/,/g, '')) || 0;
        }
      } else if (trimmed && !trimmed.startsWith('Subtotal:')) {
        // This is an item line (vehicle, guide, additional vehicle, etc.)
        // Extract label and amount from lines like "Vehículo: $1163.00 × 5h = $5815.00"

        let label = trimmed;
        let amount = 0;

        // Try to extract final amount (after = sign)
        const finalAmountMatch = trimmed.match(/=\s*\$?([\d,]+\.?\d*)/);
        if (finalAmountMatch) {
          amount = parseFloat(finalAmountMatch[1].replace(/,/g, '')) || 0;
          // Extract just the label part before the colon (e.g., "Guía" from "Guía: $635.00 × 5h = $3175.00")
          label = trimmed.split(':')[0].trim();
        } else {
          // Try to extract any dollar amount in the line
          const anyAmountMatch = trimmed.match(/\$?([\d,]+\.?\d*)/);
          if (anyAmountMatch) {
            amount = parseFloat(anyAmountMatch[1].replace(/,/g, '')) || 0;
          }
          // Also extract simple label for lines without equals sign
          if (trimmed.includes(':')) {
            label = trimmed.split(':')[0].trim();
          }
        }

        items.push({
          label,
          amount,
          text: trimmed,
          original: line,
        });
      }
    });

    qsDevLog('📄 Parsed devBreakdown:', {
      itemsCount: items.length,
      items: items.map((i) => ({ label: i.label, amount: i.amount })),
      totalText,
      total,
    });

    return {
      items,
      total,
      totalText,
      isValid: items.length > 0 || total > 0,
      paymentType,
    };
};

ItineraryBuilder.prototype.generateId = function (prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

ItineraryBuilder.prototype.renderPeopleQuantities = function (service) {
    // Debug: Only log if there are quantities to show
    if ((service.type === 'experience' || service.type === 'tour' || service.type === 'concepto') && (service.adultsQuantity || service.childrenQuantity || service.adultsNoAlcoholQuantity)) {
    }

    // Show people quantities for transport services
    if (service.type === 'transport') {
      const adults = service.transportAdults || 0;
      const children = service.transportChildren || 0;
      const infants = service.transportInfants || 0;
      if (adults > 0 || children > 0 || infants > 0) {
        const parts = [];
        if (adults > 0) parts.push(`<span class="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-1 me-1"><i class="ti ti-user fs-6"></i><span>${adults} adulto${adults > 1 ? 's' : ''}</span></span>`);
        if (children > 0) parts.push(`<span class="badge bg-success-subtle text-success d-inline-flex align-items-center gap-1 me-1"><i class="ti ti-mood-kid fs-6"></i><span>${children} niño${children > 1 ? 's' : ''}</span></span>`);
        if (infants > 0) parts.push(`<span class="badge bg-warning-subtle text-warning d-inline-flex align-items-center gap-1 me-1"><i class="ti ti-baby-carriage fs-6"></i><span>${infants} infante${infants > 1 ? 's' : ''}</span></span>`);
        return `
          <div class="d-flex align-items-center text-muted small mb-1">
            ${parts.join('')}
          </div>
        `;
      }
      return '';
    }

    // Show people quantities for experiences, tours, and concepto services
    if (service.type !== 'experience' && service.type !== 'tour' && service.type !== 'concepto') {
      return '';
    }

    const adultsQuantity = service.adultsQuantity || 0;
    const childrenQuantity = service.childrenQuantity || 0;
    const adultsNoAlcoholQuantity = service.adultsNoAlcoholQuantity || 0;
    const infantsQuantity = service.infantsQuantity || 0;

    // If we have detailed quantities, show them
    if (adultsQuantity > 0 || childrenQuantity > 0 || adultsNoAlcoholQuantity > 0 || infantsQuantity > 0) {
      const quantitiesHtml = [];

      if (adultsQuantity > 0) {
        quantitiesHtml.push(`
                    <span class="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-1 me-2 mb-1">
                        <i class="ti ti-user fs-6"></i>
                        <span>${adultsQuantity} adulto${adultsQuantity > 1 ? 's' : ''}</span>
                    </span>
                `);
      }

      if (childrenQuantity > 0) {
        quantitiesHtml.push(`
                    <span class="badge bg-success-subtle text-success d-inline-flex align-items-center gap-1 me-2 mb-1">
                        <i class="ti ti-mood-kid fs-6"></i>
                        <span>${childrenQuantity} niño${childrenQuantity > 1 ? 's' : ''}</span>
                    </span>
                `);
      }

      if (adultsNoAlcoholQuantity > 0) {
        quantitiesHtml.push(`
                    <span class="badge bg-info-subtle text-info d-inline-flex align-items-center gap-1 me-2 mb-1">
                        <i class="ti ti-glass-off fs-6"></i>
                        <span>${adultsNoAlcoholQuantity} sin alcohol</span>
                    </span>
                `);
      }

      if (infantsQuantity > 0) {
        quantitiesHtml.push(`
                    <span class="badge bg-warning-subtle text-warning d-inline-flex align-items-center gap-1 me-2 mb-1">
                        <i class="ti ti-baby-carriage fs-6"></i>
                        <span>${infantsQuantity} infante${infantsQuantity > 1 ? 's' : ''} (0-2)</span>
                    </span>
                `);
      }

      // Schedule is now shown in the main service details, no need to duplicate it here

      const result = `
                <div class="people-quantities mt-2 d-flex flex-wrap align-items-center">
                    ${quantitiesHtml.join('')}
                </div>
            `;
      return result;
    }

    return '';
};

ItineraryBuilder.prototype.getPriceTypeLabel = function () {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    if (paymentType !== 'efectivo') {
      return '<small class="text-muted ms-1" style="font-size: 0.75rem;">(con IVA)</small>';
    }
    return '';
};

ItineraryBuilder.prototype.getServiceDisplayPrice = function (service) {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';

    // Use pricesByType if available (critical for walking tours and all services with payment type pricing)
    if (service.pricesByType && typeof service.pricesByType === 'object') {
      const price = service.pricesByType[paymentType];
      if (price !== undefined) {
        return price;
      }
    }

    return service.price || 0;
};

ItineraryBuilder.prototype.getCorrectPriceForPaymentType = function (subconcept, backendPaymentType = null) {
    // Priority 1: Use backend payment type if provided
    // Priority 2: Use dropdown value
    // Priority 3: Default to 'efectivo'
    const currentPaymentType = backendPaymentType || document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const dropdownValue = document.getElementById('priceTypeSelect')?.value || 'efectivo';

    // Use pricesByType if available (preferred method)
    if (subconcept.pricesByType && typeof subconcept.pricesByType === 'object') {
      const selectedPrice = subconcept.pricesByType[currentPaymentType];
      const fallbackPrice = subconcept.total || subconcept.unitPrice || 0;

      return selectedPrice || fallbackPrice;
    }

    // Fallback: use original price
    const fallbackPrice = subconcept.total || subconcept.unitPrice || 0;

    return fallbackPrice;
};

ItineraryBuilder.prototype.renderAvailabilityPills = function (schedule) {
    if (!schedule || schedule.length === 0 || (schedule.length === 7 && schedule.every((s) => s.times.length === 0))) {
      return '<span class="badge bg-light text-dark border">Todos los días</span>';
    }
    return schedule.map((s) => {
      const timeStr = s.times.length > 0 ? ` ${s.times.map((t) => t.replace(/\s*-\s*/g, '-')).join(', ')}` : '';
      return `<span class="badge bg-light text-dark border me-1 mb-1">${s.day}${timeStr}</span>`;
    }).join('');
};

ItineraryBuilder.prototype.renderAvailabilityTable = function (schedule) {
    if (!schedule || schedule.length === 0 || (schedule.length === 7 && schedule.every((s) => s.times && s.times.length === 0))) {
      return `
        <div class="table-responsive">
          <table class="table table-sm table-borderless mb-0">
            <tbody>
              <tr>
                <td colspan="2" class="text-center py-2">
                  <span class="badge bg-light text-dark border">Todos los días</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }

    const rows = schedule.map((s) => {
      const times = s.times && s.times.length > 0
        ? s.times.map((t) => t.replace(/\s*-\s*/g, ' - ')).join('<br>')
        : '<span class="text-muted">Sin horarios específicos</span>';

      return `
        <tr>
          <td class="fw-medium" style="width: 30%;">${s.day}</td>
          <td class="small">${times}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-responsive">
        <table class="table table-sm table-borderless mb-0">
          <thead class="table-light">
            <tr>
              <th class="small fw-bold">Día</th>
              <th class="small fw-bold">Horarios</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
};

ItineraryBuilder.prototype.hideDetailsCard = function (type) {
    const cardId = type === 'experience' ? 'experienceDetailsCard' : 'tourDetailsCard';
    const card = document.getElementById(cardId);
    if (card) card.classList.add('d-none');
};

ItineraryBuilder.prototype.capitalizeFirst = function (text) {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
};

ItineraryBuilder.prototype.truncateText = function (text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.substr(0, maxLength)}...`;
};

ItineraryBuilder.prototype.cleanVehicleName = function (vehicleName) {
    // Remove everything inside parentheses including the parentheses
    return vehicleName ? vehicleName.replace(/\s*\([^)]*\)/g, '').trim() : vehicleName;
};

ItineraryBuilder.prototype.getSegmentDisplayName = function (segmentId) {
    // Map segment IDs to display names
    const segmentNames = {
      'sma-leon': 'SMA-León',
      'sma-gto': 'SMA-Guanajuato',
      'sma-cdmx': 'SMA-CDMX',
      'sma-qro': 'SMA-Querétaro',
      'local-sma': 'Local SMA',
      'local-gto': 'Local Guanajuato',
      'local-leon': 'Local León',
    };

    return segmentNames[segmentId] || 'Segmento';
};

ItineraryBuilder.prototype.scrollToDay = function (dayId) {
    const element = document.getElementById(`day-${dayId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update active state in sidebar
      document.querySelectorAll('.day-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.dayId === dayId);
      });
    }
};

ItineraryBuilder.prototype.clearModalAlert = function (containerId) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
    }
};

ItineraryBuilder.prototype.showAlert = function (message, type = 'info') {
    const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

    const container = document.getElementById('servicesAlerts') || document.querySelector('.itinerary-builder');
    if (container) {
      const alertDiv = document.createElement('div');
      alertDiv.innerHTML = alertHtml;
      const alertElement = alertDiv.firstElementChild;
      container.insertBefore(alertElement, container.firstChild);

      // Auto-dismiss after 4 seconds for success/info, 6 seconds for warnings/errors
      const delay = (type === 'danger' || type === 'warning') ? 6000 : 4000;
      setTimeout(() => {
        if (alertElement && alertElement.parentNode) {
          // Use Bootstrap's alert close method for smooth fade out
          const bsAlert = new bootstrap.Alert(alertElement);
          bsAlert.close();
        }
      }, delay);
    }
};

ItineraryBuilder.prototype.setOptionContainersVisible = function (optionKey, isVisible, fallbackIds = []) {
    const registry = (typeof window !== 'undefined') ? window.QuoteOptionRegistry : null;
    const opt = registry ? registry.byKey(optionKey) : null;
    const ids = (opt && Array.isArray(opt.showsWhenChecked) && opt.showsWhenChecked.length)
      ? opt.showsWhenChecked
      : fallbackIds;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('d-none', !isVisible);
    });
};

ItineraryBuilder.prototype.initializeTooltips = function () {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map((tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl));
};

ItineraryBuilder.prototype.timeRangesOverlap = function (rangeA, rangeB) {
    // Two ranges overlap if:
    // A starts before B ends AND B starts before A ends
    return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
};

ItineraryBuilder.prototype.addAttendeeRow = function (value = '') {
    const list = document.getElementById('serviceAttendeesList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center gap-2 mb-1 service-attendee-row';
    row.innerHTML = `
      <input type="text" class="form-control form-control-sm service-attendee-input" placeholder="Nombre completo" value="${(value || '').replace(/"/g, '&quot;')}">
      <button type="button" class="btn btn-sm btn-outline-danger remove-attendee-btn" title="Quitar">
        <i class="ti ti-x"></i>
      </button>
    `;
    row.querySelector('.remove-attendee-btn')?.addEventListener('click', () => {
      row.remove();
    });
    list.appendChild(row);
};

ItineraryBuilder.prototype.updateAdditionalFlightsHeaderVisibility = function (listId = 'additionalFlightsList', headerId = 'additionalFlightsHeader') {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    if (!header || !list) return;
    const hasRows = list.querySelectorAll('.additional-flight-row').length > 0;
    header.classList.toggle('d-none', !hasRows);
};

ItineraryBuilder.prototype.updateExtraVehiclesHeaderVisibility = function () {
    const header = document.getElementById('extraAdditionalVehiclesHeader');
    const list = document.getElementById('extraAdditionalVehiclesList');
    if (!header || !list) return;
    const hasRows = list.querySelectorAll('.extra-additional-vehicle-row').length > 0;
    header.classList.toggle('d-none', !hasRows);
};

ItineraryBuilder.prototype.syncExtraVehiclesButtonEnabled = function () {
    const hasMainVehicle = !!document.getElementById('vehicleSelect')?.value;
    const btn = document.getElementById('addExtraAdditionalVehicleBtn');
    if (btn) btn.disabled = !hasMainVehicle;
    // Hint "Selecciona primero el vehículo principal": visible solo cuando no hay principal.
    const hint = document.getElementById('extraVehiclesMainHint');
    if (hint) hint.classList.toggle('d-none', hasMainVehicle);
};

ItineraryBuilder.prototype.getOverlapTooltip = function (service) {
    if (!service.overlapsWith || service.overlapsWith.length === 0) {
      return 'Conflicto de horario detectado';
    }

    const conflicts = service.overlapsWith.map((overlap) => `${overlap.concept} (${overlap.time})`).join(', ');

    return `Conflicto con: ${conflicts}`;
};

ItineraryBuilder.prototype.setNoRouteDurationWarning = function (show) {
    ['flightDepartureNoRouteWarning', 'roundTripDepartureNoRouteWarningVuelta'].forEach((id) => {
      document.getElementById(id)?.classList.toggle('d-none', !show);
    });
};

ItineraryBuilder.prototype.updateVehicleCapacityNote = function () {
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    // A-disposición usa su propio elemento de nota (el de transporte vive en transport-main-field).
    const isADisp = serviceType === 'a-disposicion';
    const noteEl = document.getElementById(isADisp ? 'aDisposicionVehicleCapacityNote' : 'vehicleCapacityNote');
    const noteTextEl = document.getElementById(isADisp ? 'aDisposicionVehicleCapacityNoteText' : 'vehicleCapacityNoteText');
    if (!noteEl || !noteTextEl) return;

    const includeGuide = document.getElementById('includeGuide')?.checked;
    const includeGreeter = document.getElementById('includeGreeter')?.checked;
    const greeterInVehicle = document.getElementById('greeterInVehicle')?.checked;
    const tourRequiresTransport = document.getElementById('tourRequiresTransport')?.checked;

    // For tours: guide always occupies 1 seat when transport is required
    // For tours with Guía + Chofer: 2 seats occupied
    let seatsOccupied = 0;
    let occupantLabel = '';

    if (serviceType === 'tour' && tourRequiresTransport) {
      // Tours always include a guide who occupies 1 seat
      seatsOccupied = 1;
      occupantLabel = 'El guía ocupa 1 lugar';
      if (includeGuide) {
        // Guía + Chofer checked → 2 seats
        seatsOccupied = 2;
        occupantLabel = 'El guía y chofer ocupan 2 lugares';
      }
    } else if (serviceType === 'transport') {
      if (includeGuide) {
        seatsOccupied = 1;
        occupantLabel = 'El guía ocupa 1 lugar';
      } else if (includeGreeter && greeterInVehicle) {
        seatsOccupied = 1;
        occupantLabel = 'El greeter ocupa 1 lugar';
      }
    } else if (isADisp) {
      // A-disposición: guía y greeter son mutuamente excluyentes. El guía siempre ocupa
      // asiento; el greeter solo si "viaja en el vehículo".
      const adGuide = document.getElementById('aDisposicionGuide')?.checked;
      const adGreeter = document.getElementById('aDisposicionGreeter')?.checked;
      const adGreeterInVehicle = document.getElementById('aDisposicionGreeterInVehicle')?.checked;
      if (adGuide) {
        seatsOccupied = 1;
        occupantLabel = 'El guía ocupa 1 lugar';
      } else if (adGreeter && adGreeterInVehicle) {
        seatsOccupied = 1;
        occupantLabel = 'El greeter ocupa 1 lugar';
      }
    }

    if (seatsOccupied === 0) {
      noteEl.classList.add('d-none');
      return;
    }

    // Show only who occupies seats; the "Capacidad disponible: X de Y pax" detail
    // was removed per request.
    noteTextEl.textContent = occupantLabel;
    noteEl.classList.remove('d-none');
};

ItineraryBuilder.prototype.handleConceptoScheduleToggle = function (hasSchedule) {
    const scheduleFields = document.getElementById('conceptoScheduleFields');
    if (scheduleFields) {
      if (hasSchedule) {
        scheduleFields.classList.remove('d-none');
      } else {
        scheduleFields.classList.add('d-none');
        // Clear the time fields when unchecked
        document.getElementById('conceptoStartTime').value = '';
        document.getElementById('conceptoEndTime').value = '';
      }
    }
};

ItineraryBuilder.prototype.extractVehicleTypesFromPrices = function (tourPrices, clientPrices) {
    // Devuelve NOMBRES de vehículo únicos. Los precios de tour identifican el vehículo por nombre
    // ("SEDAN") y los client prices por id (vehiclePtr, p. ej. "dehZQoFrDL"); antes no se fusionaban
    // → el dropdown mostraba el objectId y duplicaba la opción. Resolvemos el id del client price a
    // su nombre (vía vehicleTypesMap) para que ambos coincidan y quede UNA sola opción por vehículo.
    const names = new Set();

    tourPrices.forEach((price) => {
      if (price.vehicleType) names.add(price.vehicleType);
    });

    clientPrices.forEach((price) => {
      const raw = price.vehiclePtr;
      if (!raw) return;
      const name = this.getVehicleTypeInfo(raw)?.name || raw;
      names.add(name);
    });

    return Array.from(names);
};

ItineraryBuilder.prototype.reconcileBreakdownItemsToTotal = function (items, total) {
    if (!Array.isArray(items) || items.length === 0 || !(total > 0)) return;
    const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
    const sum = r2(items.reduce((s, it) => s + (Number(it.amountMXN) || 0), 0));
    const residual = r2(total - sum);
    // Solo absorbe diferencias de centavos (redondeo). Algo mayor a $1 es otro problema:
    // se deja visible en vez de enmascararlo.
    if (Math.abs(residual) < 0.01 || Math.abs(residual) > 1) return;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if ((Number(items[i].amountMXN) || 0) > 0) {
        items[i].amountMXN = r2((Number(items[i].amountMXN) || 0) + residual);
        break;
      }
    }
};

ItineraryBuilder.prototype.collectServiceBreakdownItemsFromDev = function () {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    let devField = document.getElementById('devBreakdownEfectivo');
    if (paymentType === 'transferencia') {
      devField = document.getElementById('devBreakdownTransferencia') || devField;
    } else if (paymentType === 'tarjeta') {
      devField = document.getElementById('devBreakdownTarjeta') || devField;
    }
    const items = [];
    (devField?.value || '').split('\n').forEach((rawLine) => {
      const lineText = rawLine.trim();
      // Saltar líneas resumen; los componentes ya vienen con recargo (convención única).
      if (!lineText || /^(Subtotal|Total|Recargo)/i.test(lineText)) return;
      const lineAmounts = lineText.match(/-?\$[0-9,.]+/g);
      const amountMXN = lineAmounts && lineAmounts.length
        ? parseFloat(lineAmounts[lineAmounts.length - 1].replace('$', '').replace(/,/g, ''))
        : 0;
      if (amountMXN === 0) return;
      const label = lineText.replace(/\s*=\s*-?\$[0-9,.]+\s*$/, '');
      items.push({ label, amountMXN, alreadySurcharged: true });
    });
    return items;
};

ItineraryBuilder.prototype.clearVehicleDropdown = function () {
    const vehicleSelect = document.getElementById('vehicleSelect');
    if (vehicleSelect) {
      vehicleSelect.innerHTML = '<option value="">-- Sin vehículo --</option>';
      vehicleSelect.value = '';
    }

    // Also clear price field - set to 0 for tours
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.value = '0.00';
    }

    // Al limpiar vehículos ya no hay ruta seleccionada → ocultar aviso de "precio pendiente".
    if (typeof this._setTransportRoutePending === 'function') {
      this._setTransportRoutePending(false);
    }
};

ItineraryBuilder.prototype.getTransportRouteNames = function () {
    const direction = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;

    let originName = '';
    let destinationName = '';

    if (tripType === 'round-trip') {
      if (transportType === 'local') {
        originName = document.getElementById('roundTripOriginIdaText')?.value || '';
        const destSlug = document.getElementById('roundTripDestinationIdaSelect')?.value;
        destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      } else {
        const originSlug = document.getElementById('roundTripOriginIdaSelect')?.value;
        originName = window.slugToOriginalMapping?.get(originSlug) || originSlug || '';
        const destSlug = document.getElementById('roundTripDestinationIdaSelect')?.value;
        destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      }
    } else {
      const resolveDestSelect = () => {
        const destSlug = document.getElementById('transportDestinationSelect')?.value;
        return window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      };
      if (direction === 'arrival' && transportType === 'local') {
        originName = document.getElementById('transportOriginText')?.value || '';
        destinationName = resolveDestSelect();
      } else if (direction === 'departure' && transportType === 'local') {
        const slug = document.getElementById('transportOriginSelect')?.value;
        originName = window.slugToOriginalMapping?.get(slug) || slug || '';
        destinationName = document.getElementById('transportDestinationText')?.value || '';
      } else {
        const originSlug = document.getElementById('transportOriginSelect')?.value;
        originName = window.slugToOriginalMapping?.get(originSlug) || originSlug || '';
        destinationName = resolveDestSelect();
      }
    }
    return { originName, destinationName };
};

ItineraryBuilder.prototype.applySpecialRounding = function (rawPrice) {
    const integerPart = Math.floor(rawPrice);
    const lastTwoDigits = integerPart % 100;

    if (lastTwoDigits === 0) {
      return integerPart;
    } if (lastTwoDigits < 50) {
      return Math.floor(integerPart / 100) * 100;
    }
    return Math.ceil(integerPart / 100) * 100;
};

ItineraryBuilder.prototype.getPrimaryAdditionalVehiclePrice = function (listPrice) {
    const input = document.getElementById('additionalVehiclePrice');
    const custom = input && input.value !== '' ? (parseFloat(input.value) || 0) : null;
    return (custom !== null && custom > 0) ? custom : (parseFloat(listPrice) || 0);
};

ItineraryBuilder.prototype.updateADisposicionVehiclesHeaderVisibility = function () {
    const header = document.getElementById('aDisposicionAdditionalVehiclesHeader');
    const list = document.getElementById('aDisposicionAdditionalVehiclesList');
    if (!header || !list) return;
    const hasRows = list.querySelectorAll('.adisp-av-row').length > 0;
    header.classList.toggle('d-none', !hasRows);
};

ItineraryBuilder.prototype.getADisposicionDiscount = function (hours) {
    if (hours >= 16) return 10;
    if (hours >= 12) return 7.5;
    if (hours >= 10) return 5;
    if (hours >= 8) return 2.5;
    return 0;
};

ItineraryBuilder.prototype.parseWalkingTourRange = function (rangeStr) {
    if (!rangeStr) return null;
    const trimmed = rangeStr.trim();
    const plusMatch = trimmed.match(/^(\d+)\+/);
    if (plusMatch) return { min: parseInt(plusMatch[1], 10), max: Infinity };
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
    return null;
};

ItineraryBuilder.prototype.clearWalkingTourFields = function () {
    const container = document.getElementById('walkingTourGroupPricesContainer');
    if (container) container.innerHTML = '';

    const peopleCount = document.getElementById('walkingTourPeopleCount');
    if (peopleCount) peopleCount.value = '1';
    const currency = document.getElementById('walkingTourCurrency');
    if (currency) currency.value = 'MXN';

    const breakdown = document.getElementById('walkingTourGroupBreakdown');
    if (breakdown) breakdown.classList.add('d-none');
    const breakdownContent = document.getElementById('walkingTourGroupBreakdownContent');
    if (breakdownContent) breakdownContent.innerHTML = '';

    if (typeof window !== 'undefined') window.walkingGroupTotal = 0;
};

ItineraryBuilder.prototype.getFieldPriority = function (key) {
    // Priority order for field display
    const priorityMap = {
      // Core identification
      title: 1,
      name: 2,
      id: 3,
      objectId: 4,
      type: 5,

      // Pricing fields (high priority) - using CORRECT database field names
      price: 10,
      precio: 11,
      cost: 12,
      rate: 13,
      tarifa: 14,
      fee: 15,
      basePrice: 16,
      unitPrice: 17,
      totalPrice: 18,
      commission: 19,
      price_child: 7,
      price_no_alcohol: 8,
      adultPrice: 9,
      seniorPrice: 9,
      precioAdulto: 9,
      precioSenior: 9,

      // Core info
      description: 20,
      duration: 21,
      location: 22,
      category: 23,

      // Languages and communication
      languages: 30,
      idiomas: 31,
      language: 32,

      // Includes/Excludes - using CORRECT database field names
      includes: 35,
      notincludes: 40,
      incluye: 36,
      include: 37,
      incluido: 38,
      excludes: 41,
      excluye: 42,
      exclude: 43,
      noIncluye: 44,
      noincluye: 45,
      excluido: 46,

      // Capacity and participants
      capacity: 50,
      minParticipants: 51,
      maxParticipants: 52,
      minPeople: 53,
      maxPeople: 54,
      participants: 55,

      // Operational details - adding database field names
      meetingPoint: 60,
      schedule: 61,
      difficulty: 62,
      requirements: 63,
      ageRestrictions: 64,
      cancellationPolicy: 65,
      travel_duration: 25,
      advance_booking_time: 26,

      // Notes fields
      client_booking_notes: 27,
      provider_notes: 28,
      team_notes: 29,
      internal_notes: 29,

      // Status fields
      active: 70,
      featured: 71,
      seasonal: 72,
      available: 73,

      // Provider info
      provider: 80,
      proveedor: 81,

      // Dates
      createdAt: 90,
      updatedAt: 91,
      availableFrom: 92,
      availableTo: 93,

      // Ratings and reviews
      rating: 100,
      reviews: 101,
      reviewCount: 102,
    };

    const lowerKey = key.toLowerCase();
    for (const [fieldName, priority] of Object.entries(priorityMap)) {
      if (lowerKey.includes(fieldName.toLowerCase())) {
        return priority;
      }
    }

    return 999; // Default priority for unlisted fields
};

ItineraryBuilder.prototype.showTourDetails = function (tour) {
    // Only show the info card in development mode
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname.includes('dev');

    const detailsContainer = document.getElementById('tourDetails');
    if (detailsContainer) {
      if (isDevelopment) {
        // Show detailed info card only in development
        const tourName = tour.destinationPOI?.name || 'Tour sin nombre';
        const tourDescription = tour.description || '';
        const duration = tour.time ? `${tour.time} minutos` : (tour.travel_duration || '');
        const minPeople = tour.min_people || 'N/A';
        const maxPeople = tour.max_people || 'N/A';
        const includes = tour.includes || '';
        const notIncludes = tour.notincludes || '';
        const languages = tour.languages ? (Array.isArray(tour.languages) ? tour.languages.join(', ') : tour.languages) : '';

        detailsContainer.innerHTML = `
                    <div class="alert alert-info">
                        <small class="badge bg-warning text-dark mb-2">Development Only</small>
                        <h6><i class="ti ti-map-pin"></i> ${tourName}</h6>
                        ${tourDescription ? `<p class="mb-2">${tourDescription}</p>` : ''}
                        <div class="row">
                            ${duration ? `
                            <div class="col-md-6">
                                <small class="text-muted d-block"><i class="ti ti-clock"></i> Duración: ${duration}</small>
                            </div>
                            ` : ''}
                            <div class="col-md-6">
                                <small class="text-muted d-block"><i class="ti ti-users"></i> Personas: ${minPeople} - ${maxPeople}</small>
                            </div>
                        </div>
                        ${includes ? `
                        <div class="mt-2">
                            <small class="text-muted d-block"><strong>Incluye:</strong> <span style="white-space: pre-wrap;">${includes}</span></small>
                        </div>
                        ` : ''}
                        ${notIncludes ? `
                        <div class="mt-1">
                            <small class="text-muted d-block"><strong>No incluye:</strong> <span style="white-space: pre-wrap;">${notIncludes}</span></small>
                        </div>
                        ` : ''}
                        ${languages ? `
                        <div class="mt-1">
                            <small class="text-muted d-block"><i class="ti ti-language"></i> Idiomas: ${languages}</small>
                        </div>
                        ` : ''}
                    </div>
                `;
      } else {
        // In production, clear the container
        detailsContainer.innerHTML = '';
      }
    }
};

ItineraryBuilder.prototype.clearTourSchedule = function () {
    const scheduleInfoDiv = document.getElementById('tourScheduleInfo');
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const tourStartTime = document.getElementById('tourStartTime');
    const tourEndTime = document.getElementById('tourEndTime');
    if (tourStartTime) tourStartTime.value = '';
    if (tourEndTime) tourEndTime.value = '';
};

ItineraryBuilder.prototype.clearExperienceSchedule = function () {
    const scheduleInfoDiv = document.getElementById('experienceScheduleInfo');
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const expStartTime = document.getElementById('experienceStartTime');
    const expEndTime = document.getElementById('experienceEndTime');
    if (expStartTime) expStartTime.value = '';
    if (expEndTime) expEndTime.value = '';
};

ItineraryBuilder.prototype.clearDropIndicators = function (container) {
    const indicators = container.querySelectorAll('.drop-indicator');
    indicators.forEach((indicator) => indicator.remove());
};
