/* eslint-env browser */
/**
 * quote-services-v2-module.js
 * Funciones a nivel modulo y bootstrap extraidos de quote-services-v2.js para
 * reducir su tamano. Comparte el global lexical environment con quote-services-v2.js
 * (qsDevLog, AMX_PRICE_YEAR) y la clase ItineraryBuilder, por lo que DEBE cargarse
 * DESPUES de quote-services-v2.js.
 * Created by Denisse Maldonado
 */


// Global variable to store services data for filtering
let servicesData = null;

/**
 * Load active services from Services table and populate transport dropdowns.
 * @example
 */
async function loadActiveServicesForDropdowns() {
  try {
    // qsDevLog('[Services] Loading active services from Services table...');

    // Fetch active services from the API
    const response = await fetch('/api/services/active', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load services: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      // qsDevLog(`[Services] Loaded ${result.data.length} active services`);

      // Store services data globally for filtering
      servicesData = result.data;

      // Group services by transport type
      const servicesByType = {
        aeropuerto: [],
        'punto-a-punto': [],
        local: [],
      };

      result.data.forEach((service) => {
        // Use originPOI serviceType for filtering instead of service transportType
        const originServiceType = service.originServiceType || '';
        const destinationServiceType = service.destinationServiceType || '';

        // Group services based on POI serviceType
        // For Aeropuerto: show services where origin or destination POI has serviceType "Aeropuerto"
        if (originServiceType.toLowerCase().includes('aeropuerto') || destinationServiceType.toLowerCase().includes('aeropuerto')) {
          servicesByType.aeropuerto.push(service);
        }

        // For Punto a Punto: show services where POI serviceType includes "punto" or similar
        if (originServiceType.toLowerCase().includes('punto') || destinationServiceType.toLowerCase().includes('punto')
          || originServiceType.toLowerCase().includes('point') || destinationServiceType.toLowerCase().includes('point')) {
          servicesByType['punto-a-punto'].push(service);
        }

        // For Local: show services where POI serviceType includes "local"
        if (originServiceType.toLowerCase().includes('local') || destinationServiceType.toLowerCase().includes('local')) {
          servicesByType.local.push(service);
        }

        // If no specific serviceType is found, default to aeropuerto
        if (!originServiceType && !destinationServiceType) {
          servicesByType.aeropuerto.push(service);
        }
      });

      // Store for global access
      window.servicesByTransportType = servicesByType;

      // Cargar TODOS los POIs activos (no solo los de rutas en catálogo) para que origen/destino
      // puedan ser CUALQUIER POI. Se usan en populateDropdownsForTransportType / round-trip.
      try {
        const poisResp = await fetch('/api/pois/active', { headers: { 'Content-Type': 'application/json' } });
        const poisResult = poisResp.ok ? await poisResp.json() : null;
        window.allActivePois = (poisResult && (poisResult.data || poisResult.pois))
          || (Array.isArray(poisResult) ? poisResult : []);
      } catch (poisErr) {
        console.warn('[Services] No se pudieron cargar POIs activos:', poisErr);
        window.allActivePois = window.allActivePois || [];
      }

      // Initially populate with aeropuerto services (default)
      populateDropdownsForTransportType('aeropuerto');
    }
  } catch (error) {
    console.error('[Services] Error loading active services:', error);
    // Don't break the app if services can't be loaded
  }
}

/**
 * Populate transport dropdowns based on selected transport type.
 * @param transportType
 * @param directionType
 * @example
 */
function populateDropdownsForTransportType(transportType, directionType) {
  if (!window.allActivePois || window.allActivePois.length === 0) {
    console.warn('[Services] No hay POIs activos para poblar origen/destino');
    return;
  }

  // If directionType not passed, read from DOM
  if (!directionType) {
    directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
  }

  const allPois = window.allActivePois || [];
  const isAirportPoi = (p) => String((p && p.serviceType && p.serviceType.name) || '').trim().toLowerCase() === 'aeropuerto';
  const airportNames = allPois.filter(isAirportPoi).map((p) => p.label).filter(Boolean);
  const nonAirportNames = allPois.filter((p) => !isAirportPoi(p)).map((p) => p.label).filter(Boolean);
  const allNames = allPois.map((p) => p.label).filter(Boolean);

  const isDeparture = directionType === 'departure';

  // Regla de AEROPUERTO (por ahora solo este tipo): un traslado de aeropuerto siempre toca un
  // aeropuerto de un lado y NO del otro. Arrival = origen aeropuerto → destino cualquiera MENOS
  // aeropuerto; Departure = origen cualquiera MENOS aeropuerto → destino aeropuerto. Punto a Punto
  // y Local mantienen libertad total (cualquier POI en ambos lados).
  let origins;
  let destinations;
  if (transportType === 'aeropuerto') {
    origins = new Set(isDeparture ? nonAirportNames : airportNames);
    destinations = new Set(isDeparture ? airportNames : nonAirportNames);
  } else {
    origins = new Set(allNames);
    destinations = new Set(allNames);
  }

  // Create mapping from slugified values to original names (make it global)
  window.slugToOriginalMapping = new Map();

  // Elements (one-way only — round trip uses populateRoundTripDropdowns)
  const originSelectEls = [
    document.getElementById('transportOriginSelect'),
  ];
  const destinationSelectEl = document.getElementById('transportDestinationSelect');
  const originDatalistEl = document.getElementById('transportOriginList');
  const destinationDatalistEls = [
    document.getElementById('transportDestinationList'),
  ];

  // Helper: populate a SELECT element with slugified values
  const populateSelect = (element, dataSet) => {
    if (!element) return;
    while (element.options.length > 1) element.remove(1);
    [...dataSet].sort().forEach((location) => {
      const option = document.createElement('option');
      const slugValue = location.toLowerCase().replace(/\s+/g, '-');
      option.value = slugValue;
      option.textContent = location;
      element.appendChild(option);
      window.slugToOriginalMapping.set(slugValue, location);
    });
  };

  // Helper: populate a DATALIST element with original values
  const populateDatalist = (element, dataSet) => {
    if (!element) return;
    element.innerHTML = '';
    [...dataSet].sort().forEach((location) => {
      const option = document.createElement('option');
      option.value = location;
      element.appendChild(option);
    });
  };

  if (isDeparture && transportType === 'local') {
    // Local Vuelta: origin = SELECT, destination = TEXT (no dropdown needed)
    originSelectEls.forEach((el) => populateSelect(el, origins));
    // Clear unused elements
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    if (destinationSelectEl) { while (destinationSelectEl.options.length > 1) destinationSelectEl.remove(1); }
    destinationDatalistEls.forEach((el) => { if (el) el.innerHTML = ''; });
  } else if (isDeparture) {
    // Aeropuerto / Punto a Punto departure: origin = SELECT dropdown, destination = SELECT
    originSelectEls.forEach((el) => populateSelect(el, origins));
    populateSelect(destinationSelectEl, destinations);
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    destinationDatalistEls.forEach((el) => { if (el) el.innerHTML = ''; });
  } else if (transportType === 'local') {
    // Local Ida: origin = TEXT (no dropdown needed), destination = SELECT
    populateSelect(destinationSelectEl, destinations);
    // Clear unused elements
    originSelectEls.forEach((el) => { if (el) { while (el.options.length > 1) el.remove(1); } });
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    destinationDatalistEls.forEach((el) => { if (el) el.innerHTML = ''; });
  } else {
    // Arrival: origins → origin SELECT, destinations → destination SELECT dropdown
    originSelectEls.forEach((el) => populateSelect(el, origins));
    if (destinationSelectEl) populateSelect(destinationSelectEl, destinations);
    // Clear departure-specific elements
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    destinationDatalistEls.forEach((el) => { if (el) el.innerHTML = ''; });
  }

  // Update options indicators
  updateOptionsIndicator(
    isDeparture ? 'transportOriginList' : 'transportDestinationList',
    isDeparture ? 'originOptionsIndicator' : 'destinationOptionsIndicator'
  );

  // qsDevLog(`[Services] Dropdowns updated for ${transportType}:`, {
  //   origins: origins.size,
  //   destinations: destinations.size
  // });
}

/**
 * Populate round trip dropdowns for both directions simultaneously.
 * Ida = arrival pattern, Vuelta = departure pattern.
 * @param transportType
 * @example
 */
function populateRoundTripDropdowns(transportType) {
  if (!window.allActivePois || window.allActivePois.length === 0) return;

  const allPois = window.allActivePois || [];
  const isAirportPoi = (p) => String((p && p.serviceType && p.serviceType.name) || '').trim().toLowerCase() === 'aeropuerto';
  const airportNames = allPois.filter(isAirportPoi).map((p) => p.label).filter(Boolean);
  const nonAirportNames = allPois.filter((p) => !isAirportPoi(p)).map((p) => p.label).filter(Boolean);
  const allNames = allPois.map((p) => p.label).filter(Boolean);

  // Regla de AEROPUERTO (round-trip): Ida = arrival (origen aeropuerto → destino cualquiera menos
  // aeropuerto); Vuelta = departure (origen cualquiera menos aeropuerto → destino aeropuerto).
  // Punto a Punto / Local: libertad total. Ver populateDropdownsForTransportType (one-way).
  const isAirport = transportType === 'aeropuerto';
  const arrivalOrigins = new Set(isAirport ? airportNames : allNames);
  const arrivalDestinations = new Set(isAirport ? nonAirportNames : allNames);
  const departureOrigins = new Set(isAirport ? nonAirportNames : allNames);
  const departureDestinations = new Set(isAirport ? airportNames : allNames);

  // Ensure slug mapping exists
  if (!window.slugToOriginalMapping) window.slugToOriginalMapping = new Map();

  const populateSelect = (element, dataSet) => {
    if (!element) return;
    while (element.options.length > 1) element.remove(1);
    [...dataSet].sort().forEach((location) => {
      const option = document.createElement('option');
      const slugValue = location.toLowerCase().replace(/\s+/g, '-');
      option.value = slugValue;
      option.textContent = location;
      element.appendChild(option);
      window.slugToOriginalMapping.set(slugValue, location);
    });
  };

  const populateDatalist = (element, dataSet) => {
    if (!element) return;
    element.innerHTML = '';
    [...dataSet].sort().forEach((location) => {
      const option = document.createElement('option');
      option.value = location;
      element.appendChild(option);
    });
  };

  // --- IDA (arrival pattern) ---
  const idaOriginSelect = document.getElementById('roundTripOriginIdaSelect');
  const idaDestCombo = document.getElementById('roundTripDestinationIdaList');
  const idaDestSelect = document.getElementById('roundTripDestinationIdaSelect');

  if (transportType === 'local') {
    // Local Ida: origin = TEXT (no dropdown), destination = SELECT
    if (idaOriginSelect) { while (idaOriginSelect.options.length > 1) idaOriginSelect.remove(1); }
    populateSelect(idaDestSelect, arrivalDestinations);
    if (idaDestCombo) idaDestCombo.innerHTML = '';
  } else {
    // Aeropuerto / Punto a Punto: origin = SELECT, destination = SELECT dropdown
    populateSelect(idaOriginSelect, arrivalOrigins);
    populateSelect(idaDestSelect, arrivalDestinations);
    if (idaDestCombo) idaDestCombo.innerHTML = '';
  }

  // --- VUELTA (departure pattern) ---
  const vueltaOriginCombo = document.getElementById('roundTripOriginVueltaList');
  const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
  const vueltaDestSelect = document.getElementById('roundTripDestinationVueltaSelect');

  if (transportType === 'local') {
    // Local Vuelta: origin = SELECT, destination = TEXT (no dropdown)
    populateSelect(vueltaOriginSelect, departureOrigins);
    if (vueltaOriginCombo) vueltaOriginCombo.innerHTML = '';
    if (vueltaDestSelect) { while (vueltaDestSelect.options.length > 1) vueltaDestSelect.remove(1); }
  } else {
    // Aeropuerto / Punto a Punto: origin = SELECT dropdown, destination = SELECT
    populateSelect(vueltaOriginSelect, departureOrigins);
    populateSelect(vueltaDestSelect, departureDestinations);
    if (vueltaOriginCombo) vueltaOriginCombo.innerHTML = '';
  }
}

/**
 * Show indicator when datalist has options and origin is selected.
 * @param datalistId
 * @param indicatorId
 * @example
 */
function updateOptionsIndicator(datalistId, indicatorId) {
  const datalist = document.getElementById(datalistId);
  const indicator = document.getElementById(indicatorId);

  if (datalist && indicator) {
    // Check if an origin is selected
    const transportOrigin = document.getElementById('transportOriginSelect');
    const roundTripOrigin = document.getElementById('roundTripOriginIdaSelect');

    const originSelected = (transportOrigin && transportOrigin.value && transportOrigin.value !== '')
      || (roundTripOrigin && roundTripOrigin.value && roundTripOrigin.value !== '');

    const hasOptions = datalist.options.length > 0;

    // Only show indicator if origin is selected AND there are options
    if (hasOptions && originSelected) {
      indicator.classList.remove('d-none');
    } else {
      indicator.classList.add('d-none');
    }
  }
}

/**
 * Update destination combo box options based on selected origin.
 * @param selectedOrigin
 * @example
 */
function updateDestinationsForOrigin(selectedOrigin = null) {
  qsDevLog('🔍 updateDestinationsForOrigin called with origin:', selectedOrigin);

  // Origen/destino libre: el destino ya NO se filtra por la ruta del catálogo ni por el tipo. Los
  // destinos son siempre TODOS los POIs activos. Repoblamos la lista completa para que quede
  // consistente aunque haya cambiado el origen; excluimos solo el POI ya elegido como origen
  // para no ofrecer "mismo origen = destino".
  const transportType = document.querySelector('input[name="transportType"]:checked')?.value || 'aeropuerto';
  const directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
  const isDeparture = directionType === 'departure';
  const isDepartureWithSelect = isDeparture && (transportType === 'aeropuerto' || transportType === 'punto-a-punto');
  const isBidirectional = transportType === 'punto-a-punto';

  const originalOriginName = selectedOrigin
    ? (window.slugToOriginalMapping?.get(selectedOrigin) || selectedOrigin)
    : null;

  const allPois = window.allActivePois || [];
  const allNames = allPois.map((p) => p.label).filter(Boolean);

  const destinations = new Set(
    allNames.filter((name) => name !== originalOriginName),
  );

  if (isDepartureWithSelect || isBidirectional) {
    // Aeropuerto / Punto a Punto departure: update destination SELECT
    const destSelect = document.getElementById('transportDestinationSelect');
    if (destSelect) {
      while (destSelect.options.length > 1) destSelect.remove(1);
      [...destinations].sort().forEach((location) => {
        const option = document.createElement('option');
        const slugValue = location.toLowerCase().replace(/\s+/g, '-');
        option.value = slugValue;
        option.textContent = location;
        destSelect.appendChild(option);
        window.slugToOriginalMapping?.set(slugValue, location);
      });
    }
  } else {
    // Arrival / Local departure: update destination datalists (COMBO)
    const datalists = [
      document.getElementById('transportDestinationList'),
      document.getElementById('roundTripDestinationIdaList'),
    ];
    datalists.forEach((element) => {
      if (!element) return;
      element.innerHTML = '';
      [...destinations].sort().forEach((location) => {
        const option = document.createElement('option');
        option.value = location;
        element.appendChild(option);
      });
    });
    updateOptionsIndicator('transportDestinationList', 'destinationOptionsIndicator');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Prevent multiple instances (singleton pattern)
  if (window.itineraryBuilder) {
    qsDevLog('🔒 ItineraryBuilder already exists, skipping initialization');
    return;
  }

  const quoteIdElement = document.querySelector('[data-quote-id]');
  if (quoteIdElement) {
    const { quoteId } = quoteIdElement.dataset;
    // Note: Removed ItineraryBuilder initialization log for console cleanup
    window.itineraryBuilder = new ItineraryBuilder(quoteId);
    window.itineraryBuilder.init();
  }

  // Load active services from Services table for dropdowns (handled by ItineraryBuilder.init())
  loadActiveServicesForDropdowns();

  // Add event listeners for origin selectboxes to update destination combo boxes
  setTimeout(() => {
    // Use setTimeout to ensure the DOM elements are ready after async loading
    const originSelects = [
      document.getElementById('transportOriginSelect'),
      document.getElementById('roundTripOriginIdaSelect'),
    ];

    originSelects.forEach((select, index) => {
      if (select) {
        qsDevLog(`✅ Adding event listener to origin select ${index}:`, select.id);
        select.addEventListener('change', (e) => {
          const selectedOrigin = e.target.value;
          qsDevLog(`🔄 Origin select ${index} changed to:`, selectedOrigin);

          // Clear destination fields when origin changes
          const destinationCombos = [
            document.getElementById('transportDestinationCombo'),
            document.getElementById('roundTripDestinationIdaCombo'),
          ];

          destinationCombos.forEach((combo) => {
            if (combo) {
              combo.value = '';
              // Trigger change event to hide specific location field if it was showing
              combo.dispatchEvent(new Event('input'));
            }
          });

          if (selectedOrigin) {
            updateDestinationsForOrigin(selectedOrigin);
          } else {
            // If no origin selected, reset to show all destinations for transport type
            const transportType = document.querySelector('input[name="transportType"]:checked')?.value || 'aeropuerto';
            qsDevLog('Resetting to all destinations for transport type:', transportType);
            populateDropdownsForTransportType(transportType);
          }

          // Re-trigger transport price lookup if rate is already selected
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (window.itineraryBuilder && currentRateId) {
            window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          }
          // Route duration is per origin+destination — refresh it even without a segmento.
          if (window.itineraryBuilder) window.itineraryBuilder.updateRouteDurationFromRoute();

          // Auto-sync Ida → Vuelta (swapped) for round trip
          if (window.itineraryBuilder) window.itineraryBuilder.syncIdaToVuelta();
        });
      } else {
        qsDevLog(`Origin select ${index} not found`);
      }
    });

    // Departure origin combo: filter destinations when user selects/types origin
    const originCombo = document.getElementById('transportOriginCombo');
    if (originCombo) {
      originCombo.addEventListener('input', (e) => {
        const selectedOrigin = e.target.value;

        // Clear destination fields when origin changes
        const destSelect = document.getElementById('transportDestinationSelect');
        if (destSelect) destSelect.value = '';
        const destCombo = document.getElementById('transportDestinationCombo');
        if (destCombo) destCombo.value = '';

        if (selectedOrigin) {
          updateDestinationsForOrigin(selectedOrigin);
        } else {
          const currentTransportType = document.querySelector('input[name="transportType"]:checked')?.value || 'aeropuerto';
          populateDropdownsForTransportType(currentTransportType);
        }

        // Check if specific location field is needed
        checkSpecificLocationField();

        // Re-trigger transport price lookup if rate is already selected
        const currentRateId = document.getElementById('transportCategory')?.value;
        if (window.itineraryBuilder && currentRateId) {
          window.itineraryBuilder.handleTransportRateSelection(currentRateId);
        }
        // Route duration is per origin+destination — refresh it even without a segmento.
        if (window.itineraryBuilder) window.itineraryBuilder.updateRouteDurationFromRoute();
      });
    }

    // Departure destination select: trigger rate selection when airport is selected
    const destSelectEl = document.getElementById('transportDestinationSelect');
    if (destSelectEl) {
      destSelectEl.addEventListener('change', () => {
        const currentRateId = document.getElementById('transportCategory')?.value;
        if (window.itineraryBuilder && currentRateId) {
          window.itineraryBuilder.handleTransportRateSelection(currentRateId);
        }
        // Route duration is per origin+destination — refresh it even without a segmento.
        if (window.itineraryBuilder) window.itineraryBuilder.updateRouteDurationFromRoute();
      });
    }

    // Destination combo: trigger rate selection and specific location check when destination changes
    const destComboEl = document.getElementById('transportDestinationCombo');
    if (destComboEl) {
      destComboEl.addEventListener('input', () => {
        checkSpecificLocationField();
        const currentRateId = document.getElementById('transportCategory')?.value;
        if (window.itineraryBuilder && currentRateId) {
          window.itineraryBuilder.handleTransportRateSelection(currentRateId);
        }
        // Route duration is per origin+destination — refresh it even without a segmento.
        if (window.itineraryBuilder) window.itineraryBuilder.updateRouteDurationFromRoute();
      });
    }
  }, 100);

  // List of locations that need the "Ubicación Específica" field
  const needsSpecificLocation = [
    'San Miguel de Allende',
    'San Miguel Allende',
    'Centro San Miguel de Allende',
    'Guanajuato Capital',
    'León',
    'Ciudad de México',
    'CDMX',
  ];

  // Check if a location value matches the specific location list
  /**
   *
   * @param value
   * @example
   */
  function locationNeedsSpecificField(value) {
    return needsSpecificLocation.some((loc) => value && value.toLowerCase().includes(loc.toLowerCase()));
  }

  // Show/hide specific location field based on origin OR destination value
  /**
   *
   * @example
   */
  function checkSpecificLocationField() {
    const specificLocationRow = document.getElementById('specificLocationRow');
    if (!specificLocationRow) return;

    // Punto a punto (one-way, llegada o salida): no se usa el campo "Dirección (Hotel, Airbnb...)";
    // origen y destino ya son POIs. Ocultar y limpiar.
    const transportTypeSel = document.querySelector('input[name="transportType"]:checked')?.value;
    if (transportTypeSel === 'punto-a-punto') {
      specificLocationRow.classList.add('d-none');
      const ptpField = document.getElementById('transportSpecificLocation');
      if (ptpField) ptpField.value = '';
      return;
    }

    const originSelect = document.getElementById('transportOriginSelect');
    const destSelect = document.getElementById('transportDestinationSelect');
    const originVal = originSelect?.selectedIndex > 0 ? originSelect.options[originSelect.selectedIndex].text : '';
    const destVal = destSelect?.selectedIndex > 0 ? destSelect.options[destSelect.selectedIndex].text : '';
    const needsField = locationNeedsSpecificField(originVal) || locationNeedsSpecificField(destVal);

    if (needsField) {
      specificLocationRow.classList.remove('d-none');
    } else {
      specificLocationRow.classList.add('d-none');
      const specificLocationField = document.getElementById('transportSpecificLocation');
      if (specificLocationField) specificLocationField.value = '';
    }
  }

  // Show/hide round-trip specific location fields based on destination/origin values
  // Exposed on window so ItineraryBuilder methods can call it
  window.checkRoundTripSpecificLocationFields = checkRoundTripSpecificLocationFields;
  /**
   *
   * @example
   */
  function checkRoundTripSpecificLocationFields() {
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    // Local y punto-a-punto no usan el campo de "Dirección (Hotel, Airbnb...)".
    if (transportType === 'local' || transportType === 'punto-a-punto') {
      document.getElementById('roundTripSpecificLocationIdaRow')?.classList.add('d-none');
      document.getElementById('roundTripSpecificLocationVueltaRow')?.classList.add('d-none');
      const idaField = document.getElementById('roundTripSpecificLocationIda');
      if (idaField) idaField.value = '';
      const vueltaField = document.getElementById('roundTripSpecificLocationVuelta');
      if (vueltaField) vueltaField.value = '';
      return;
    }

    // Ida: check destination select
    const idaRow = document.getElementById('roundTripSpecificLocationIdaRow');
    const idaDest = document.getElementById('roundTripDestinationIdaSelect')?.value || '';
    if (idaRow) {
      if (locationNeedsSpecificField(idaDest)) {
        idaRow.classList.remove('d-none');
      } else {
        idaRow.classList.add('d-none');
        const field = document.getElementById('roundTripSpecificLocationIda');
        if (field) field.value = '';
      }
    }

    // Vuelta: check origin select
    const vueltaRow = document.getElementById('roundTripSpecificLocationVueltaRow');
    const vueltaOrigin = document.getElementById('roundTripOriginVueltaSelect')?.value || '';
    if (vueltaRow) {
      if (locationNeedsSpecificField(vueltaOrigin)) {
        vueltaRow.classList.remove('d-none');
      } else {
        vueltaRow.classList.add('d-none');
        const field = document.getElementById('roundTripSpecificLocationVuelta');
        if (field) field.value = '';
      }
    }
  }

  // Add event listeners for destination combo boxes
  setTimeout(() => {
    const destinationCombos = [
      document.getElementById('transportDestinationCombo'),
      document.getElementById('roundTripDestinationIdaCombo'),
    ];

    destinationCombos.forEach((combo) => {
      if (combo) {
        // Handle input changes
        combo.addEventListener('input', () => {
          checkSpecificLocationField();
          checkRoundTripSpecificLocationFields();
        });

        // Handle selection from datalist - also trigger transport price lookup
        combo.addEventListener('change', (e) => {
          checkSpecificLocationField();
          checkRoundTripSpecificLocationFields();
          // Re-trigger transport price lookup if rate is already selected
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (window.itineraryBuilder && currentRateId && e.target.value) {
            window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          }
          // Route duration is per origin+destination — refresh it even without a segmento.
          if (window.itineraryBuilder) window.itineraryBuilder.updateRouteDurationFromRoute();
          // Auto-sync Ida → Vuelta (swapped) for round trip
          if (window.itineraryBuilder) window.itineraryBuilder.syncIdaToVuelta();
        });
      }
    });
  }, 150);

  // Auto-sync Ida → Vuelta for Local transport type fields + trigger vehicle reload
  setTimeout(() => {
    const rtIdaDestSelect = document.getElementById('roundTripDestinationIdaSelect');
    if (rtIdaDestSelect) {
      rtIdaDestSelect.addEventListener('change', () => {
        if (window.itineraryBuilder) {
          window.itineraryBuilder.syncIdaToVuelta();
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (currentRateId) window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          // Route duration is per origin+destination — refresh it even without a segmento.
          window.itineraryBuilder.updateRouteDurationFromRoute();
        }
      });
    }
    const rtIdaOriginText = document.getElementById('roundTripOriginIdaText');
    if (rtIdaOriginText) {
      rtIdaOriginText.addEventListener('input', () => {
        if (window.itineraryBuilder) {
          window.itineraryBuilder.syncIdaToVuelta();
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (currentRateId) window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          // Route duration is per origin+destination — refresh it even without a segmento.
          window.itineraryBuilder.updateRouteDurationFromRoute();
        }
      });
    }

    // Vuelta origin combo: trigger specific location check when user edits it manually
    const rtVueltaOriginCombo = document.getElementById('roundTripOriginVueltaCombo');
    if (rtVueltaOriginCombo) {
      rtVueltaOriginCombo.addEventListener('input', () => {
        checkRoundTripSpecificLocationFields();
      });
      rtVueltaOriginCombo.addEventListener('change', () => {
        checkRoundTripSpecificLocationFields();
      });
    }

    // Auto-fill Ida specific location → Vuelta specific location as user types
    const rtIdaSpecificLocation = document.getElementById('roundTripSpecificLocationIda');
    if (rtIdaSpecificLocation) {
      rtIdaSpecificLocation.addEventListener('input', () => {
        const vueltaField = document.getElementById('roundTripSpecificLocationVuelta');
        if (vueltaField) {
          vueltaField.value = rtIdaSpecificLocation.value;
        }
      });
    }
  }, 150);

  // Global debug functions for testing
  window.testOriginFiltering = function (origin) {
    qsDevLog('🧪 Testing origin filtering for:', origin);
    updateDestinationsForOrigin(origin);
  };

  window.debugServices = function () {
    qsDevLog('🔍 Current services data:', window.servicesByTransportType);
    qsDevLog('🔍 Slug to original mapping:', window.slugToOriginalMapping);
    qsDevLog('🔍 Origin elements:', [
      document.getElementById('transportOriginSelect'),
      document.getElementById('roundTripOriginIdaSelect'),
    ]);
    qsDevLog('🔍 Destination datalists:', [
      document.getElementById('transportDestinationList'),
      document.getElementById('roundTripDestinationIdaList'),
    ]);
  };

  // ==================
  // MODAL HANDLING - FIX FOR EXPERIENCE FIELDS
  // ==================

  // Initialize modal state and handle service type selection
  /**
   *
   * @example
   */
  function initializeModalState() {
    // Check which service type is initially checked
    const checkedServiceType = document.querySelector('input[name="serviceType"]:checked');
    if (checkedServiceType) {
      const selectedType = checkedServiceType.value;

      // Hide all content sections first
      const contentSections = document.querySelectorAll('.service-content');
      contentSections.forEach((section) => section.classList.add('d-none'));

      // Hide all pricing sections
      const experiencePricingSection = document.getElementById('experiencePricingSection');
      const standardPricingSection = document.getElementById('standardPricingSection');
      const transportTypeSelector = document.getElementById('transportTypeSelector');

      if (experiencePricingSection) experiencePricingSection.classList.add('d-none');
      if (standardPricingSection) standardPricingSection.classList.remove('d-none'); // Show standard pricing by default
      if (transportTypeSelector) transportTypeSelector.classList.add('d-none');

      // Clear breakdown panel on modal state init (keep visible during editing)
      const breakdownPanel = document.getElementById('servicePriceBreakdown');
      // if (breakdownPanel) breakdownPanel.classList.add('d-none'); // Commented out - always show breakdown when editing

      // Clear tour schedule when switching away from tour
      if (selectedType !== 'tour' && window.itineraryBuilder) {
        window.itineraryBuilder.clearTourSchedule();
      }

      // Show appropriate content based on selection
      switch (selectedType) {
        case 'experience':
          const experienceContent = document.getElementById('experienceContent');
          if (experienceContent) {
            experienceContent.classList.remove('d-none');
          }
          break;
        case 'tour':
          const tourContent = document.getElementById('tourContent');
          if (tourContent) tourContent.classList.remove('d-none');
          break;
        case 'transport':
          const transportContent = document.getElementById('transportContent');
          if (transportContent) transportContent.classList.remove('d-none');
          if (transportTypeSelector) transportTypeSelector.classList.remove('d-none');
          break;
        case 'concepto':
          const conceptoContent = document.getElementById('conceptoContent');
          if (conceptoContent) conceptoContent.classList.remove('d-none');
          break;
        case 'a-disposicion':
          const aDisposicionContent = document.getElementById('aDisposicionContent');
          if (aDisposicionContent) aDisposicionContent.classList.remove('d-none');
          break;
      }
    }
  }

  // Handle service type selection in modal
  const serviceTypeRadios = document.querySelectorAll('input[name="serviceType"]');
  serviceTypeRadios.forEach((radio) => {
    radio.addEventListener('change', function () {
      const selectedType = this.value;

      initializeModalState();
    });
  });

  // Handle experience selection to show detailed fields
  // Use event delegation to handle dynamically loaded content
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'experienceSelect') {
      const selectedExperience = e.target.value;
      const experiencePricingSection = document.getElementById('experiencePricingSection');

      if (experiencePricingSection) {

      }

      const standardPricingSection = document.getElementById('standardPricingSection');

      if (selectedExperience && experiencePricingSection) {
        experiencePricingSection.classList.remove('d-none');
        if (standardPricingSection) standardPricingSection.classList.add('d-none');
      } else if (experiencePricingSection) {
        experiencePricingSection.classList.add('d-none');
        if (standardPricingSection) standardPricingSection.classList.remove('d-none');
      } else {
        console.error('experiencePricingSection element not found!');
      }
    }
  });

  // Also add a direct handler for when the modal is shown
  const serviceModal = document.getElementById('serviceModal');
  if (serviceModal) {
    serviceModal.addEventListener('shown.bs.modal', () => {
      // Check if all required elements exist
      const experienceSelect = document.getElementById('experienceSelect');
      const experiencePricingSection = document.getElementById('experiencePricingSection');
      const experienceContent = document.getElementById('experienceContent');

      // Initialize the modal state based on selected service type
      initializeModalState();

      // Initialize dev payment prices in development mode
      if (window.itineraryBuilder && window.itineraryBuilder.isDevelopmentMode) {
        window.itineraryBuilder.updateDevPaymentPrices();
      }

      // Ensure service breakdown is visible after modal is fully shown (especially for edit mode)
      if (window.itineraryBuilder && window.itineraryBuilder.editMode === 'service') {
        qsDevLog('🔄 Modal shown: Ensuring service breakdown visibility for edit mode');
        setTimeout(() => {
          window.itineraryBuilder.updateServicePriceBreakdown();
        }, 50);
      }

      // Fix checkbox sync issues that can occur with Bootstrap modals
      setTimeout(() => {
        const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
        if (tourOverrideCheckbox) {
          // Check if there's a visual/actual state mismatch
          const parent = tourOverrideCheckbox.closest('.form-check');
          const shouldBeChecked = parent?.classList.contains('active')
            || tourOverrideCheckbox.hasAttribute('checked');

          if (shouldBeChecked && !tourOverrideCheckbox.checked) {
            qsDevLog('🔧 Fixing tour override checkbox state on modal show');
            tourOverrideCheckbox.checked = true;
          } else if (!shouldBeChecked && tourOverrideCheckbox.checked) {
            qsDevLog('🔧 Unchecking tour override checkbox on modal show');
            tourOverrideCheckbox.checked = false;
          }
        }
      }, 200);

      // Set up experience handler and check current value
      if (experienceSelect) {
        // Trigger change event if already has a value
        if (experienceSelect.value) {
          experienceSelect.dispatchEvent(new Event('change'));
        }

        // Also force show pricing section if experience is selected
        if (experienceSelect.value && experiencePricingSection) {
          const standardPricingSection = document.getElementById('standardPricingSection');
          experiencePricingSection.classList.remove('d-none');
          if (standardPricingSection) standardPricingSection.classList.add('d-none');
        }
      }
    });
  }

  // Update the total display for per-group pricing
  /**
   *
   * @example
   */
  function updateWalkingGroupTotalDisplay() {
    const groupInputs = document.querySelectorAll('.walking-group-price');
    let baseTotal = 0;

    groupInputs.forEach((input) => {
      const value = parseFloat(input.value) || 0;
      baseTotal += value;
    });

    // Calculate totals with surcharges
    const efectivoTotal = baseTotal;
    const transferRate = window.quoteServicesManager?.transferRate || 0;
    const agencyRate = window.quoteServicesManager?.agencyRate || 0;
    const transferenciaTotal = baseTotal * (1 + (transferRate / 100));
    const tarjetaTotal = baseTotal * (1 + (agencyRate / 100));

    // Get current payment type to highlight
    const currentPaymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';

    const totalDisplay = document.getElementById('walkingGroupTotalDisplay');
    if (totalDisplay) {
      totalDisplay.innerHTML = `
        <div class="d-flex flex-column gap-1">
          <div class="d-flex justify-content-between ${currentPaymentType === 'efectivo' ? 'text-primary fw-bold' : ''}">
            <span>Efectivo:</span>
            <span>$${efectivoTotal.toFixed(2)} MXN</span>
          </div>
          <div class="d-flex justify-content-between ${currentPaymentType === 'transferencia' ? 'text-primary fw-bold' : ''}">
            <span>Transferencia:</span>
            <span>$${transferenciaTotal.toFixed(2)} MXN ${transferRate > 0 ? `(+${transferRate.toFixed(2)}%)` : ''}</span>
          </div>
          <div class="d-flex justify-content-between ${currentPaymentType === 'tarjeta' ? 'text-primary fw-bold' : ''}">
            <span>Tarjeta:</span>
            <span>$${tarjetaTotal.toFixed(2)} MXN ${agencyRate > 0 ? `(+${agencyRate.toFixed(2)}%)` : ''}</span>
          </div>
        </div>
      `;
    }

    // Store the total for use in data collection (use current payment type total)
    const totals = {
      efectivo: efectivoTotal,
      transferencia: transferenciaTotal,
      tarjeta: tarjetaTotal,
    };
    window.walkingGroupTotal = totals[currentPaymentType] || efectivoTotal;
  }

  // Clear walking tour group pricing data
  /**
   *
   * @example
   */
  function clearWalkingTourGroupPricing() {
    // Remove the listener if it exists
    if (window._walkingGroupListener) {
      const peopleCountInput = document.getElementById('walkingTourPeopleCount');
      peopleCountInput?.removeEventListener('input', window._walkingGroupListener);
      window._walkingGroupListener = null;
    }

    // Reset to total mode
    const totalModeRadio = document.getElementById('walkingPriceModeTotal');
    if (totalModeRadio) {
      totalModeRadio.checked = true;
    }

    // Clear group inputs
    const groupPricesContainer = document.getElementById('walkingTourGroupPrices');
    if (groupPricesContainer) {
      groupPricesContainer.innerHTML = '';
    }

    // Clear stored total
    window.walkingGroupTotal = 0;
  }
});
