/* eslint-env browser */
/* global bootstrap */
/**
 * Experience Services Builder - Simplified services builder (single-day)
 * Based on ItineraryBuilder from quote-services-v2.js but without multi-day management
 * Created by Denisse Maldonado
 */

class ExperienceServicesBuilder {
  constructor(experienceId) {
    console.log('🚀 ExperienceServicesBuilder constructor called with experienceId:', experienceId);
    this.experienceId = experienceId;
    this.services = new Map();
    this.currentServiceId = null;
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;

    // Store field values for each service type
    this.serviceTypeFields = {
      experience: {},
      tour: {},
      concepto: {},
      entradas: {},
      transport: {},
    };
    this.currentServiceType = null;

    // Caches
    this.vehiclesCache = null;
    this.experiencesCache = new Map();
    this.toursCache = new Map();
    this.tourPricesMap = new Map();
    this.vehicleTypesMap = new Map();
    this.ratesCache = null;
    this.providerExperiencesCache = null;
    this.transportServicesCache = null;
    this.servicesByTransportType = null;
    this.transportPriceData = null;
    this.vehicleRatePricesCache = [];
    this.agencyRateCache = null;
    this.driverTourRateCache = null;
    // Tarifas de guía (transporte) y greeter, para sumarlos al Total.
    this.guideTransportRateCache = null;
    this.guideFormulaConfigCache = null;
    this.greeterRateCache = null;
    this.greeterRateCacheTime = null;

    // Pricing rates for Pago/Moneda
    this.transferRate = 3.0;
    this.agencyRate = 5.0;
    this.exchangeRate = 20.0;

    this.init();
  }

  getAccessToken() {
    // First check for globally set token (set by experience-detail.ejs)
    if (window.experienceAccessToken) {
      console.log('🔑 Using global experienceAccessToken');
      return window.experienceAccessToken;
    }

    // Fallback: Look for clientAccessToken cookie (non-httpOnly)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'clientAccessToken') {
        console.log('🔑 Found clientAccessToken in cookies');
        return value;
      }
      // Also check for accessToken (legacy)
      if (name === 'accessToken') {
        console.log('🔑 Found accessToken in cookies (legacy)');
        return value;
      }
    }

    // Last resort: Check localStorage/sessionStorage
    const storageToken = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    if (storageToken) {
      console.log('🔑 Found token in storage');
      return storageToken;
    }

    console.warn('⚠️ No access token found in any location');
    return null;
  }

  generateId(prefix = 'svc') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async init() {
    try {
      // El botón de "Agregar servicio" no sirve hasta que el catálogo cargue
      // (los listeners se enganchan al final del init): deshabilítalo mientras tanto.
      this.setAddServiceButtonsEnabled(false);
      await this.loadExperienceData();

      // F3 (draft-first): las experiencias nuevas ya no acumulan servicios en
      // localStorage; se guardan directo contra un borrador real. Limpiamos
      // cualquier residuo de sesiones previas para no inyectar servicios fantasma.
      if (this.experienceId === 'new') {
        localStorage.removeItem('tempExperienceServices');
      }

      await Promise.all([
        this.loadVehicles(),
        this.loadAllRates(),
        this.loadAllExperiences(),
        this.loadAllTours(),
        this.loadAllTourPrices(),
        this.loadVehicleTypes(),
        this.loadProviderExperiences(),
        this.loadAgencyRate(),
        this.loadDriverTourRate(),
        this.loadGuideTransportRate(),
        this.loadGuideFormulaConfiguration(),
        this.loadGreeterRateConfiguration(),
        this.loadPricingRates(),
        this.loadTransportServices(),
        this.loadVehicleRatePrices(),
        this.loadActiveServicesForDropdowns(),
      ]);

      this.setupEventListeners();
      this.renderDragPanel();
      this.setupDragAndDrop();
      this.sortAndDetectOverlaps();
      this.renderServices();
      this.updateTotals();
      // Ya con los tours cargados: refleja si la guía global sale del walking tour SMA.
      this.updateGuideRateSource();
      this.renderBreakdown();
      // Catálogo listo: ya se puede usar el modal.
      this.setAddServiceButtonsEnabled(true);
    } catch (error) {
      console.error('Error initializing experience services builder:', error);
      this.setAddServiceButtonsError();
    }
  }

  // Habilita/deshabilita los chips de "Agregar servicio" (alta progresiva) con estado de carga.
  setAddServiceButtonsEnabled(enabled) {
    document.querySelectorAll('#addServiceChips .add-service-chip').forEach((chip) => { chip.disabled = !enabled; });
    const hint = document.querySelector('.add-service-hint');
    if (hint) hint.textContent = enabled ? 'Elige un tipo → se abre el formulario de ese servicio.' : 'Cargando servicios…';
  }

  setAddServiceButtonsError() {
    document.querySelectorAll('#addServiceChips .add-service-chip').forEach((chip) => { chip.disabled = true; });
    const hint = document.querySelector('.add-service-hint');
    if (hint) hint.textContent = 'Error al cargar servicios';
  }

  setupEventListeners() {
    // Numeric input validation functions
    const validateNumericInput = (e) => {
      const input = e.target;
      let value = input.value;

      // Remove any non-numeric characters except decimal point
      value = value.replace(/[^0-9.]/g, '');

      // Ensure only one decimal point
      const parts = value.split('.');
      if (parts.length > 2) {
        value = parts[0] + '.' + parts.slice(1).join('');
      }

      // Limit decimal places based on field type
      const isHoursField = input.id === 'hoursQuantity';
      const maxDecimals = isHoursField ? 1 : 2;
      if (parts.length === 2 && parts[1].length > maxDecimals) {
        value = parts[0] + '.' + parts[1].substring(0, maxDecimals);
      }

      // Update the input value
      if (input.value !== value) {
        input.value = value;
      }
    };

    // Prevent invalid characters on keypress
    const preventInvalidNumericChars = (e) => {
      // Allow: backspace, delete, tab, escape, enter, decimal point
      if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1 ||
        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
        (e.keyCode === 65 && e.ctrlKey === true) ||
        (e.keyCode === 67 && e.ctrlKey === true) ||
        (e.keyCode === 86 && e.ctrlKey === true) ||
        (e.keyCode === 88 && e.ctrlKey === true) ||
        // Allow: home, end, left, right
        (e.keyCode >= 35 && e.keyCode <= 39)) {
        // Allow decimal point only if not already present
        if ((e.keyCode === 110 || e.keyCode === 190) && e.target.value.indexOf('.') !== -1) {
          e.preventDefault();
        }
        return;
      }
      // Ensure that it is a number and stop the keypress
      if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
        e.preventDefault();
      }
    };

    // Handle paste events to validate pasted content
    const handleNumericPaste = (e) => {
      e.preventDefault();
      const clipboard = e.clipboardData || window.clipboardData;
      const pastedText = clipboard ? clipboard.getData('text') : '';
      // Clean the pasted text
      let cleanedText = pastedText.replace(/[^0-9.]/g, '');
      // Ensure only one decimal point
      const parts = cleanedText.split('.');
      if (parts.length > 2) {
        cleanedText = parts[0] + '.' + parts.slice(1).join('');
      }
      // Insert cleaned text at cursor position
      const input = e.target;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const currentValue = input.value;
      input.value = currentValue.substring(0, start) + cleanedText + currentValue.substring(end);
      // Trigger input event to apply full validation
      input.dispatchEvent(new Event('input'));
    };

    // Add Service buttons
    // Botones por tipo: abren el panel inline ya con el tipo seleccionado.
    // Alta progresiva: al pulsar un chip de Tipo se abre el panel inline de ese tipo.
    document.getElementById('addServiceChips')?.addEventListener('click', async (e) => {
      const chip = e.target.closest('.add-service-chip');
      if (!chip || chip.disabled) return;
      const type = chip.dataset.type;
      // Todos los tipos: alta 100% inline (row = formulario), sin abrir panel.
      if (type === 'concepto' || type === 'entradas' || type === 'experience' || type === 'transport' || type === 'tour') {
        this.addInlineService(type);
        return;
      }
      document.querySelectorAll('#addServiceChips .add-service-chip').forEach((c) => c.classList.toggle('active', c === chip));
      await this.openServiceModal(null, type);
    });
    const entradaSelectEl = document.getElementById('entradaSelect');
    if (entradaSelectEl) {
      entradaSelectEl.addEventListener('change', () => {
        const opt = entradaSelectEl.selectedOptions[0];
        const priceEl = document.getElementById('servicePrice');
        if (opt && opt.value && priceEl) priceEl.value = Number(opt.dataset.price || 0);
        this.updateServiceTotal();
      });
    }

    // Save Service button
    document.getElementById('saveServiceBtn')?.addEventListener('click', () => this.saveService());

    // Removed: Person count, payment type and currency event listeners
    // These UI elements were removed from the bottom panel

    // Service Type Toggle
    document.querySelectorAll('input[name="serviceType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => this.handleServiceTypeChange(e.target.value));
    });

    // (Simplificado) Se quitaron los toggles de tipo de transporte / viaje /
    // dirección: ya no existen esos radios en el modal.

    // Experience selection
    document.getElementById('experienceSelect')?.addEventListener('change', (e) => {
      this.handleExperienceSelection(e.target.value);
    });

    // Tour selection
    document.getElementById('tourSelect')?.addEventListener('change', (e) => {
      this.handleTourSelection(e.target.value);
      this.updateGuideDurationModeVisibility();
      this.updateServiceTotal();
    });

    // Tour transport checkbox
    document.getElementById('tourRequiresTransport')?.addEventListener('change', (e) => {
      this.handleTourTransportToggle(e.target.checked);
    });

    // Rate selection
    document.getElementById('transportCategory')?.addEventListener('change', (e) => {
      this.handleRateSelection(e.target.value);
    });

    // Vehicle selection
    document.getElementById('vehicleSelect')?.addEventListener('change', (e) => {
      this.handleVehicleSelection(e.target.value);
      this.updateVehicleCapacityHint();
    });

    // El input de Precio es el BASE; el Total (base × horas/cantidad) se recalcula
    // al cambiar horas, precio, cantidad o el check de vehículo adicional.
    document.getElementById('hoursQuantity')?.addEventListener('input', () => { this.updateServiceTotal(); this.renderVehiclePicker(); });
    document.getElementById('servicePrice')?.addEventListener('input', () => this.updateServiceTotal());
    document.getElementById('serviceQuantity')?.addEventListener('input', () => this.updateServiceTotal());
    document.getElementById('vehicleCount')?.addEventListener('input', () => { this.updateServiceTotal(); this.updateVehicleCapacityHint(); });
    document.getElementById('experienceMaxPeople')?.addEventListener('input', () => { this.updateVehicleCapacityHint(); this.renderVehiclePicker(); });
    // Desglose por pax: recalcular cuando cambian general (guía/chofer/tarifas), duración o capacidad.
    ['generalGuideToggle', 'generalChoferToggle', 'generalGuideRate', 'generalChoferRate', 'experienceDuration', 'experienceMinPeople', 'experienceMaxPeople'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        // Estos campos son a nivel EXPERIENCIA (viven en la sección Servicios pero se guardan
        // en el payload de la experiencia): además del desglose, disparan su autoguardado.
        const onChange = () => { this.renderBreakdown(); if (typeof window.scheduleExperienceInfoAutoSave === 'function') window.scheduleExperienceInfoAutoSave(); };
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
      }
    });

    // Global Guía/Chofer → aplica a TODOS los servicios (marca/desmarca su checkbox por
    // servicio) para que se vea de un vistazo en cuáles va incluido.
    document.getElementById('generalGuideToggle')?.addEventListener('change', (e) => this.applyGeneralGuideChoferToAll('includeGuide', e.target.checked));
    document.getElementById('generalChoferToggle')?.addEventListener('change', (e) => this.applyGeneralGuideChoferToAll('includeChofer', e.target.checked));

    // Duración editable del header: al cambiarla, recalcular en vivo las guías de los
    // tours a pie cobrados "por toda la experiencia" y repintar tarjetas/total/sugerida.
    // El picker de duración actualiza el hidden y despacha 'change' (no 'input').
    document.getElementById('experienceDuration')?.addEventListener('change', () => {
      this.recomputeWalkingTourExperienceGuides();
      this.renderServices();
    });

    // Modo de duración de la guía (tour a pie): recalcula el Total del modal en vivo.
    document.getElementById('guideDurationMode')?.addEventListener('change', () => this.updateServiceTotal());

    // Traslado: duración editable (h/min) + viaje redondo recalculan el total en vivo.
    document.getElementById('transportDurationHours')?.addEventListener('input', () => this.updateServiceTotal());
    document.getElementById('transportDurationMinutes')?.addEventListener('input', () => this.updateServiceTotal());
    document.getElementById('transportRoundTrip')?.addEventListener('change', () => this.updateServiceTotal());

    // Tour a pie: personas + precios de grupo editables recalculan el total en vivo.
    document.getElementById('walkingTourPeopleCount')?.addEventListener('input', () => this.updateServiceTotal());
    document.querySelectorAll('.walking-group-price').forEach((el) => {
      el.addEventListener('input', () => this.updateServiceTotal());
    });

    // Guide checkbox
    document.getElementById('includeGuide')?.addEventListener('change', (e) => {
      this.handleIncludeGuideChange(e.target.checked);
      this.updateGuideDurationModeVisibility();
      this.updateServiceTotal();
    });

    // Greeter checkbox
    document.getElementById('includeGreeter')?.addEventListener('change', (e) => {
      this.handleIncludeGreeterChange(e.target.checked);
      this.updateServiceTotal();
    });

    // Waiting time input
    document.getElementById('waitingTimeHours')?.addEventListener('input', () => {
      this.updateWaitingTimeRateDisplay();
    });

    // Specific location check + re-trigger rate lookup on destination/origin change
    document.getElementById('transportDestinationCombo')?.addEventListener('input', () => {
      this.checkSpecificLocationField();
      this.retriggerRateLookup();
    });
    document.getElementById('transportOriginCombo')?.addEventListener('input', () => {
      this.checkSpecificLocationField();
      this.retriggerRateLookup();
    });
    document.getElementById('transportOriginSelect')?.addEventListener('change', () => {
      this.checkSpecificLocationField();
      this.retriggerRateLookup();
    });
    document.getElementById('transportDestinationSelect')?.addEventListener('change', () => {
      this.checkSpecificLocationField();
      this.retriggerRateLookup();
    });

    // Round-trip specific location checks
    document.getElementById('roundTripDestinationIdaCombo')?.addEventListener('input', () => {
      this.checkRoundTripSpecificLocationFields();
    });
    document.getElementById('roundTripOriginVueltaCombo')?.addEventListener('input', () => {
      this.checkRoundTripSpecificLocationFields();
    });

    // Concepto schedule toggle
    document.getElementById('conceptoHasSchedule')?.addEventListener('change', (e) => {
      const fields = document.getElementById('conceptoScheduleFields');
      if (fields) fields.classList.toggle('d-none', !e.target.checked);
    });

    // Auto-format time inputs (HH:MM)
    document.querySelectorAll('.time-input').forEach((input) => {
      input.addEventListener('input', function () {
        let val = this.value.replace(/[^0-9]/g, '');
        if (val.length >= 3) {
          val = val.substring(0, 2) + ':' + val.substring(2, 4);
        }
        this.value = val;
      });
    });

    // Apply numeric validation to all numeric input fields
    const numericFields = [
      'hoursQuantity',      // Hours field
      'adultPrice',         // Experience adult price
      'childPrice',         // Experience child price
      'noAlcoholPrice',     // Experience no alcohol price
      'servicePrice',       // Standard service price
      'serviceQuantity'     // Service quantity
    ];

    numericFields.forEach(id => {
      const field = document.getElementById(id);
      if (field) {
        field.addEventListener('input', validateNumericInput);
        field.addEventListener('keydown', preventInvalidNumericChars);
        field.addEventListener('paste', handleNumericPaste);
      }
    });

    // Experience quantity inputs - recalculate price
    document.querySelectorAll('.experience-quantity-input').forEach((input) => {
      input.addEventListener('change', () => this.recalculateExperiencePrice());
    });

    // Tour quantity inputs
    document.querySelectorAll('.tour-quantity-input').forEach((input) => {
      input.addEventListener('change', () => this.recalculateTourPrice());
    });

    // Concepto quantity inputs
    document.querySelectorAll('.concepto-quantity-input').forEach((input) => {
      input.addEventListener('change', () => this.recalculateConceptoPrice());
    });

    // Delegated click events for service actions
    document.getElementById('servicesContainer')?.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.edit-service-btn');
      const deleteBtn = e.target.closest('.delete-service-btn');

      if (editBtn) {
        await this.openServiceModal(editBtn.dataset.serviceId);
      } else if (deleteBtn) {
        this.deleteService(deleteBtn.dataset.serviceId);
      }
    });

    // Campos inline (Concepto/Entradas): actualizan el service + desglose + autoguardado.
    const svcContainer = document.getElementById('servicesContainer');
    svcContainer?.addEventListener('input', (e) => {
      const f = e.target.closest('.inline-field');
      if (f) this.onInlineFieldChange(f);
    });
    svcContainer?.addEventListener('change', (e) => {
      const f = e.target.closest('.inline-field');
      if (f) this.onInlineFieldChange(f);
    });
  }

  // =====================
  // DATA LOADING
  // =====================

  async loadExperienceData() {
    console.log('🔍 loadExperienceData called for experience:', this.experienceId);

    try {
      // Skip loading for new experiences - they don't have existing service data
      if (this.experienceId === 'new') {
        console.log('📝 New experience - skipping service data load');
        return;
      }

      const accessToken = this.getAccessToken();
      console.log('🔑 Access token:', accessToken ? 'Found' : 'NOT FOUND');

      if (!accessToken) {
        console.error('❌ No access token available - cannot load experience data');
        return;
      }

      console.log(`📡 Fetching experience data from: /api/experiences/${this.experienceId}`);
      const response = await fetch(`/api/experiences/${this.experienceId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      console.log('📊 Response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('✅ API Response received:', {
          success: result.success,
          hasData: !!result.data,
          hasServiceItems: !!(result.data && result.data.serviceItems),
          serviceItemsCount: result.data && result.data.serviceItems && result.data.serviceItems.subconcepts ?
            result.data.serviceItems.subconcepts.length : 0
        });

        if (result.success && result.data && result.data.serviceItems) {
          console.log('🎯 Found serviceItems - calling processServiceItems');
          this.processServiceItems(result.data.serviceItems);
        } else {
          console.log('⚠️ No serviceItems found in response');
          if (result.data) {
            console.log('Available fields:', Object.keys(result.data));
          }
        }
      } else {
        console.error('❌ API request failed with status:', response.status);
      }
    } catch (error) {
      console.error('❌ Error loading experience data:', error);
    }
  }

  loadTemporaryServices() {
    try {
      const tempData = localStorage.getItem('tempExperienceServices');
      if (tempData) {
        const serviceData = JSON.parse(tempData);
        if (serviceData.services && serviceData.services.length > 0) {
          this.services.clear();
          serviceData.services.forEach(service => {
            this.services.set(service.id, service);
          });
          console.log('Loaded temporary services:', serviceData.services.length);
        }
      }
    } catch (error) {
      console.error('Error loading temporary services:', error);
    }
  }

  processServiceItems(serviceItemsData) {
    console.log('🔍 processServiceItems called with:', serviceItemsData);

    if (!serviceItemsData || !serviceItemsData.subconcepts) {
      console.log('⚠️ No serviceItemsData or subconcepts to process');
      return;
    }

    console.log(`📦 Processing ${serviceItemsData.subconcepts.length} services from API`);
    this.services.clear();

    serviceItemsData.subconcepts.forEach((sub, index) => {
      const serviceId = sub.id || this.generateId('svc');
      console.log(`🎯 Processing service ${index + 1}/${serviceItemsData.subconcepts.length}:`, {
        id: serviceId,
        type: sub.type,
        concept: sub.concept,
        experienceId: sub.experienceId
      });

      this.services.set(serviceId, {
        id: serviceId,
        type: sub.type || 'other',
        concept: sub.concept,
        startTime: sub.time || sub.startTime,
        endTime: sub.endTime,
        vehicleId: sub.vehicleId,
        vehicleType: sub.vehicleType,
        vehicleTypeName: sub.vehicleTypeName,
        price: sub.unitPrice || 0,
        hours: sub.hours != null ? sub.hours : null, // horas del tour (para recomponer total)
        durationHours: sub.durationHours != null ? sub.durationHours : null, // para duración sugerida
        quantity: sub.quantity || 1,
        perPax: sub.perPax || false,
        notes: sub.notes || '',
        experienceId: sub.experienceId,
        tourId: sub.tourId,
        entradaId: sub.entradaId,
        rateId: sub.rateId,
        hotelName: sub.hotelName,
        adultsQuantity: sub.adultsQuantity || 0,
        childrenQuantity: sub.childrenQuantity || 0,
        adultsNoAlcoholQuantity: sub.adultsNoAlcoholQuantity || 0,
        selectedSchedule: sub.selectedSchedule || '',
        adultPrice: sub.adultPrice || 0,
        childPrice: sub.childPrice || 0,
        noAlcoholPrice: sub.noAlcoholPrice || 0,
        // Guía por servicio. Tours viejos (sin includeChofer) guardaban el chofer en
        // includeGuide → se migra a includeChofer y la guía queda en false.
        includeGuide: (sub.type === 'tour' && !sub.isWalkingTour && sub.includeChofer == null)
          ? false : (sub.includeGuide || false),
        includeChofer: sub.includeChofer != null
          ? sub.includeChofer
          : ((sub.type === 'tour' && !sub.isWalkingTour) ? (sub.includeGuide || false) : false),
        guideDurationMode: sub.guideDurationMode || 'tour',
        includeGreeter: sub.includeGreeter || false,
        greeterInVehicle: sub.greeterInVehicle || false,
        waitingTimeHours: sub.waitingTimeHours || 0,
        transportType: sub.transportType || null,
        directionType: sub.directionType || null,
        tripType: sub.tripType || null,
        originName: sub.originName || null,
        destinationName: sub.destinationName || null,
        rateName: sub.rateName || null,
        roundTrip: sub.roundTrip || false,
        vehicleCount: sub.vehicleCount || (sub.additionalVehicle ? 2 : 1) || 1,
        vehicleByPax: sub.vehicleByPax || null,
        // Base real del transporte/tour (para editar/desglosar sin re-multiplicar el total).
        unitPrice: sub.transportBase != null ? sub.transportBase : (sub.tourBase != null ? sub.tourBase : undefined),
        transportDurationHours: sub.transportDurationHours ?? null,
        transportDurationMinutes: sub.transportDurationMinutes ?? null,
        isWalkingTour: sub.isWalkingTour || false,
        walkingPriceSmall: sub.walkingPriceSmall || 0,
        walkingPerGroup: sub.walkingPerGroup != null ? sub.walkingPerGroup : null,
        walkingPriceMedium: sub.walkingPriceMedium || 0,
        walkingPriceLarge: sub.walkingPriceLarge || 0,
        walkingPeopleCount: sub.walkingPeopleCount || 1,
        languages: sub.languages || '',
        clientNotes: sub.clientNotes || '',
      });
    });

    console.log(`✅ Finished processing services. Total in Map: ${this.services.size}`);
    console.log('🎨 Calling renderServices() to display them in UI...');

    // CRITICAL FIX: Render the services after processing them!
    this.renderServices();

    // Also update the summary to reflect the loaded services
    console.log('🔍 Checking if updateSummary method exists...');
    console.log('Available methods on this:', Object.getOwnPropertyNames(Object.getPrototypeOf(this)));

    if (typeof this.updateSummary === 'function') {
      try {
        console.log('✅ Calling updateSummary...');
        this.updateSummary();
      } catch (error) {
        console.warn('⚠️ Error executing updateSummary:', error);
      }
    } else {
      console.warn('⚠️ updateSummary method not found on this object, skipping summary update');
      console.log('this.constructor.name:', this.constructor.name);
      console.log('typeof this.updateSummary:', typeof this.updateSummary);
    }

    console.log('✅ Services should now be visible in the Services section');
  }

  async loadVehicles() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/dashboard/data/vehicle-types', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      // Este endpoint responde en formato DataTables ({ data, recordsTotal, ... }),
      // sin 'success'. Tomar data.data tal cual (cada fila trae defaultCapacity).
      this.vehiclesCache = Array.isArray(data?.data) ? data.data : [];
    } catch (error) {
      console.error('Error loading vehicles:', error);
    }
  }

  async loadAllRates() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/rates?length=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      // API returns DataTables format: { draw, recordsTotal, recordsFiltered, data }
      this.ratesCache = data.data || [];
    } catch (error) {
      console.error('Error loading rates:', error);
    }
  }

  async loadAllExperiences() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/experiences?type=Experience&length=1000', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      // API returns DataTables format: { draw, recordsTotal, recordsFiltered, data }
      const experiences = data.data || [];
      experiences.forEach((exp) => {
        this.experiencesCache.set(exp.id, exp);
      });
    } catch (error) {
      console.error('Error loading experiences:', error);
    }
  }

  async loadAllTours() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/tours?length=1000', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      // API returns DataTables format with success flag
      const tours = data.data || [];
      tours.forEach((tour) => {
        this.toursCache.set(tour.id, tour);
      });
    } catch (error) {
      console.error('Error loading tours:', error);
    }
  }

  async loadAllTourPrices() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/tour-prices?length=5000', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.data) {
        data.data.forEach((tp) => {
          // /api/tour-prices devuelve tourPtr/ratePtr (no tourId/rateId).
          const key = `${tp.tourPtr}_${tp.ratePtr}`;
          if (!this.tourPricesMap.has(key)) {
            this.tourPricesMap.set(key, []);
          }
          this.tourPricesMap.get(key).push(tp);
        });
      }
    } catch (error) {
      console.error('Error loading tour prices:', error);
    }
  }

  async loadVehicleTypes() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/dashboard/data/vehicle-types', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.data) {
        data.data.forEach((vt) => {
          this.vehicleTypesMap.set(vt.id, vt);
        });
      }
    } catch (error) {
      console.error('Error loading vehicle types:', error);
    }
  }

  async loadProviderExperiences() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/provider-experiencias/all', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) this.providerExperiencesCache = data.data || [];
    } catch (error) {
      console.error('Error loading provider experiences:', error);
    }
  }

  async loadAgencyRate() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/rates?name=Agencia', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.data && data.data.length > 0) {
        this.agencyRateCache = data.data[0];
      }
    } catch (error) {
      console.error('Error loading agency rate:', error);
    }
  }

  async loadDriverTourRate() {
    try {
      const token = this.getAccessToken();
      // La tarifa "Chofer Tour" la administra DriverTourRateController en su propio
      // endpoint (devuelve { data: { value } }), NO /api/rates. Con el endpoint mal,
      // driverTourRateCache quedaba null y el guía del tour se calculaba en $0.
      const response = await fetch('/api/driver-tour-rate/current', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.data) {
        this.driverTourRateCache = data.data; // { value, ... }
      }
    } catch (error) {
      console.error('Error loading driver tour rate:', error);
    }
  }

  async loadGuideTransportRate() {
    try {
      const token = this.getAccessToken();
      if (!token) return;
      const response = await fetch('/api/guide-transport-rate/current', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) this.guideTransportRateCache = result.data;
      }
    } catch (error) {
      console.error('Error loading guide transport rate:', error);
    }
  }

  async loadGuideFormulaConfiguration() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/guide-transport-rate/formula', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.config) this.guideFormulaConfigCache = result.config;
      } else {
        this.guideFormulaConfigCache = { roundTripMultiplier: 2, minimumCharge: 0 };
      }
    } catch (error) {
      this.guideFormulaConfigCache = { roundTripMultiplier: 2, minimumCharge: 0 };
    }
  }

  async loadGreeterRateConfiguration() {
    try {
      const token = this.getAccessToken();
      const response = await fetch('/api/greeter-rate/formula', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.greeterRateCache = {
            basePrice: result.data.basePrice || 760,
            hourlyRate: result.data.hourlyRate || 640,
          };
        }
      }
    } catch (error) {
      console.error('Error loading greeter rate:', error);
    }
  }

  // Costo del guía de transporte = fórmula (guideTransportRate + config). Igual que cotización.
  calculateGuideTransportCost(durationMinutes) {
    const guideRate = this.guideTransportRateCache?.value || 400;
    let componentsCost = null;
    let roundTripMultiplier = null;
    let minimumCharge = 0;

    if (typeof GuideFormulaEvaluator !== 'undefined' && GuideFormulaEvaluator.formulaConfig) {
      const config = GuideFormulaEvaluator.formulaConfig;
      minimumCharge = config.minimumCharge || 0;
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        componentsCost = GuideFormulaEvaluator.evaluateComponents(config.formulaComponents, durationMinutes, guideRate);
      } else if (config.roundTripMultiplier) {
        roundTripMultiplier = config.roundTripMultiplier;
      }
    }
    if (componentsCost === null && roundTripMultiplier === null) {
      const formulaConfig = this.guideFormulaConfigCache || { roundTripMultiplier: 2, minimumCharge: 0 };
      roundTripMultiplier = formulaConfig.roundTripMultiplier;
      minimumCharge = formulaConfig.minimumCharge || 0;
    }

    const params = { durationMinutes, guideRate, roundTripMultiplier, minimumCharge, componentsCost };
    if (window.PricingEngine) return window.PricingEngine.calculateGuideTransportCost(params);

    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return 0;
    if (componentsCost !== null) return Math.max(componentsCost, minimumCharge);
    return Math.max(durationHours * (roundTripMultiplier || 0) * guideRate, minimumCharge);
  }

  // Costo del greeter = 760 + 640 × horas (o el motor único si está cargado).
  calculateGreeterPrice(durationMinutes) {
    const basePrice = this.greeterRateCache?.basePrice || 760;
    const hourlyRate = this.greeterRateCache?.hourlyRate || 640;
    if (window.PricingEngine) {
      return window.PricingEngine.calculateGreeterPrice({ durationMinutes, basePrice, hourlyRate });
    }
    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return basePrice;
    return basePrice + (hourlyRate * durationHours);
  }

  // { guide, greeter } según tipo + checkboxes, para sumarlos al Total.
  // Tour: guía = ChoferTour × horas. Transporte: guía = fórmula(duración ruta),
  // greeter = 760 + 640 × horas(duración ruta).
  getGuideGreeterCost() {
    const type = this.currentServiceType;
    const includeGuide = document.getElementById('includeGuide')?.checked || false;
    const includeGreeter = document.getElementById('includeGreeter')?.checked || false;
    let guide = 0;
    let greeter = 0;

    if (type === 'tour') {
      if (this.selectedTourData?.isWalkingTour) {
        // Tour a pie: el precio de grupo YA incluye la guía (grupos × duración); no se
        // suma una tarifa de chofer aparte.
        guide = 0;
      } else if (includeGuide) {
        // Tour con vehículo: guía = Chofer Tour × horas del tour.
        const hours = parseFloat(document.getElementById('hoursQuantity')?.value) || 0;
        guide = (this.driverTourRateCache?.value || 0) * hours;
      }
    } else if (type === 'transport') {
      const durationMinutes = this.cachedRouteDuration || 0;
      if (includeGuide) guide = this.calculateGuideTransportCost(durationMinutes);
      if (includeGreeter) greeter = this.calculateGreeterPrice(durationMinutes);
    }
    return { guide, greeter };
  }

  // Duración (en horas, puede ser decimal) del traslado según los campos editables
  // del modal. "Redondo" multiplica ×2. Actualiza el hint y devuelve el total.
  getTransportDurationHours() {
    const h = parseInt(document.getElementById('transportDurationHours')?.value, 10) || 0;
    const m = parseInt(document.getElementById('transportDurationMinutes')?.value, 10) || 0;
    const round = document.getElementById('transportRoundTrip')?.checked || false;
    const oneWay = h + m / 60;
    const total = oneWay * (round ? 2 : 1);

    const hint = document.getElementById('transportDurationHint');
    if (hint) {
      const oneWayLabel = `${h} h ${m} min`;
      hint.textContent = round
        ? `${oneWayLabel} × 2 = ${total.toFixed(2)} h`
        : `${oneWayLabel} (${total.toFixed(2)} h)`;
    }
    return total;
  }

  // Autollena los campos de duración (h/min) desde la duración de ruta (minutos)
  // sólo si están vacíos, para no pisar lo que el usuario haya editado.
  prefillTransportDurationFromRoute() {
    const hoursEl = document.getElementById('transportDurationHours');
    const minutesEl = document.getElementById('transportDurationMinutes');
    if (!hoursEl || !minutesEl) return;

    const min = parseInt(this.cachedRouteDuration, 10) || 0;
    if (min <= 0) return;

    const isEmpty = (el) => el.value === '' || el.value == null;
    if (isEmpty(hoursEl) && isEmpty(minutesEl)) {
      hoursEl.value = Math.floor(min / 60);
      minutesEl.value = min % 60;
      this.updateServiceTotal();
    }
  }

  async loadPricingRates() {
    try {
      if (window.PricingUtils && typeof window.PricingUtils.loadCurrentRates === 'function') {
        const rates = await window.PricingUtils.loadCurrentRates();
        this.exchangeRate = rates.exchangeRate;
        this.transferRate = rates.transferRate;
        this.agencyRate = rates.agencyRate;
      }
    } catch (error) {
      console.error('Error loading pricing rates:', error);
    }
  }

  // =====================
  // SERVICE MODAL
  // =====================

  async openServiceModal(serviceId = null, presetType = null) {
    this.currentServiceId = serviceId;
    const modal = document.getElementById('serviceModal');
    if (!modal) return;

    const modalTitle = document.getElementById('serviceModalLabel');
    const saveBtn = document.getElementById('saveServiceBtn');

    // Reset form
    document.getElementById('serviceForm')?.reset();
    this.resetServiceTypeContent();

    // FEEDBACK INMEDIATO: cierra el catálogo y muestra el panel con loader al instante,
    // ANTES de las cargas async (fetch de boletos, etc.), para que no parezca inerte.
    const catalogEl = document.getElementById('dragSourceOffcanvas');
    if (catalogEl) bootstrap.Offcanvas.getInstance(catalogEl)?.hide();
    modal.classList.add('is-loading');
    modal.style.display = 'block';
    // Edición INLINE: mueve el panel justo debajo de la tarjeta editada; en alta, a su home.
    if (serviceId) {
      const card = document.querySelector(`.service-item[data-service-id="${serviceId}"]`);
      if (card) card.insertAdjacentElement('afterend', modal);
    } else {
      this.moveServicePanelHome();
    }
    modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // En alta, fija el tipo YA (síncrono) para que el formulario del tipo se vea de una.
    if (!serviceId) {
      if (modalTitle) modalTitle.innerHTML = '<i class="ti ti-plus-circle me-2"></i>Agregar Servicio';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-device-floppy me-1"></i>Guardar Servicio';
      const initialType = presetType || 'experience';
      const typeRadio = document.querySelector(`input[name="serviceType"][value="${initialType}"]`);
      if (typeRadio) typeRadio.checked = true;
      this.handleServiceTypeChange(initialType);
    }

    // Poblar los dropdowns ANTES de rellenar los campos: si se hace después,
    // reconstruyen las <option> y borran la selección que populateServiceFields fija.
    this.populateRateSelector();
    this.populateExperienceSelect();
    this.populateTourSelect();
    await this.populateEntradaSelect();

    if (serviceId) {
      // Edit mode
      const service = this.services.get(serviceId);
      if (!service) { modal.classList.remove('is-loading'); return; }

      if (modalTitle) modalTitle.innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Servicio';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-device-floppy me-1"></i>Actualizar Servicio';

      const typeRadio = document.querySelector(`input[name="serviceType"][value="${service.type}"]`);
      if (typeRadio) {
        typeRadio.checked = true;
        this.handleServiceTypeChange(service.type);
      }
      await this.populateServiceFields(service);
    }

    // Formulario listo: quita el loader.
    modal.classList.remove('is-loading');
    const firstField = modal.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (firstField) setTimeout(function () { try { firstField.focus(); } catch (e) { /* noop */ } }, 200);
  }

  resetServiceTypeContent() {
    document.querySelectorAll('.service-content').forEach((el) => el.classList.add('d-none'));
    document.getElementById('experienceContent')?.classList.remove('d-none');

    // Hide both details cards
    this.hideExperienceDetailsCard();
    this.hideTourDetailsCard();
    document.getElementById('transportTypeSelector')?.classList.add('d-none');
    document.getElementById('tripTypeSelector')?.classList.add('d-none');
    document.getElementById('experiencePricingSection')?.classList.add('d-none');
    document.getElementById('standardPricingSection')?.classList.remove('d-none');
    document.getElementById('tourTransportCheckboxContainer')?.style.setProperty('display', 'none');
    document.getElementById('transportFieldsRow')?.classList.remove('d-none');
  }

  handleServiceTypeChange(type) {
    this.currentServiceType = type;

    // La sección de precios del walking tour SOLO aplica a tours a pie: se oculta por
    // default en cada cambio de tipo (handleTourTransportToggle la re-muestra cuando
    // el tour seleccionado es a pie). Evita que se cuele en transporte/otros.
    const walkingSection = document.getElementById('walkingTourPricingSection');
    if (walkingSection) walkingSection.classList.add('d-none');

    // Al cambiar de servicio, limpia segmento/vehículo/precio para no arrastrar
    // la selección del tipo o ítem anterior. (En edición se restauran después.)
    this.resetSegmentVehiclePrice();

    // Hide all content sections
    document.querySelectorAll('.service-content').forEach((el) => el.classList.add('d-none'));

    // Show relevant content
    const contentMap = {
      experience: 'experienceContent',
      tour: 'tourContent',
      transport: 'transportContent',
      concepto: 'conceptoContent',
      entradas: 'entradasContent',
    };

    const contentEl = document.getElementById(contentMap[type]);
    if (contentEl) contentEl.classList.remove('d-none');

    // Transport-specific toggles
    const transportTypeSelector = document.getElementById('transportTypeSelector');
    const tripTypeSelector = document.getElementById('tripTypeSelector');
    if (transportTypeSelector) transportTypeSelector.classList.toggle('d-none', type !== 'transport');
    if (tripTypeSelector) tripTypeSelector.classList.toggle('d-none', type !== 'transport');

    // Experience pricing vs standard pricing
    const experiencePricingSection = document.getElementById('experiencePricingSection');
    const standardPricingSection = document.getElementById('standardPricingSection');
    if (type === 'experience') {
      if (experiencePricingSection) experiencePricingSection.classList.remove('d-none');
      if (standardPricingSection) standardPricingSection.classList.add('d-none');
    } else if (type === 'tour') {
      if (experiencePricingSection) experiencePricingSection.classList.add('d-none');
      if (standardPricingSection) standardPricingSection.classList.add('d-none');
    } else {
      if (experiencePricingSection) experiencePricingSection.classList.add('d-none');
      if (standardPricingSection) standardPricingSection.classList.remove('d-none');
    }

    // Tour transport checkbox - hidden for tour
    const tourTransportContainer = document.getElementById('tourTransportCheckboxContainer');
    if (tourTransportContainer) {
      tourTransportContainer.style.display = 'none';
    }

    // Transport fields visibility - hidden for experience, tour, and concepto
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    if (transportFieldsRow) {
      transportFieldsRow.classList.toggle('d-none', type !== 'transport');
    }

    // Duración editable + viaje redondo: sólo para transporte.
    const transportDurationRow = document.getElementById('transportDurationRow');
    if (transportDurationRow) {
      transportDurationRow.classList.toggle('d-none', type !== 'transport');
    }

    // Hide Tiempo de espera for transport (as requested)
    const tiempoEsperaSection = document.getElementById('tiempoEsperaSection');
    if (tiempoEsperaSection) {
      tiempoEsperaSection.classList.add('d-none');  // Always hidden for now
    }

    // Cantidad: oculta para transporte y para TOUR (el tour se cobra por horas, no
    // por cantidad). "Cantidad de vehículos" se muestra SOLO en transporte (combinación
    // por capacidad: N vehículos del tipo elegido → costo = base × N).
    const quantityFieldContainer = document.getElementById('quantityFieldContainer');
    const vehicleCountContainer = document.getElementById('vehicleCountContainer');
    if (quantityFieldContainer) {
      quantityFieldContainer.classList.toggle('d-none', type === 'transport' || type === 'tour');
    }
    if (vehicleCountContainer) vehicleCountContainer.classList.toggle('d-none', type !== 'transport' && type !== 'tour');
    this.updateVehicleCapacityHint();
    if (type === 'transport' || type === 'tour') this.renderVehiclePicker();

    // Guía/Greeter por tipo: Tour -> "Guía + Chofer" (sin greeter);
    // Transporte -> "Guía" + "Greeter".
    const includeGuideContainer = document.getElementById('includeGuide')?.closest('.form-check');
    const includeGreeterContainer = document.getElementById('greeterCheckboxContainer');
    const opcionalLabelContainer = includeGuideContainer?.closest('.col-md-2');
    const guideLabel = document.getElementById('guideLabel');
    // 'transportFieldsRow' ya está declarado arriba (visibilidad base por tipo).
    const segmentoCol = document.getElementById('transportSegmentoCol');
    const vehicleCol = document.getElementById('transportVehicleCol');

    if (type === 'transport') {
      if (includeGuideContainer) includeGuideContainer.classList.remove('d-none');
      if (includeGreeterContainer) includeGreeterContainer.classList.remove('d-none');
      if (opcionalLabelContainer) opcionalLabelContainer.classList.remove('d-none');
      if (guideLabel) guideLabel.textContent = 'Guía';
      // Restaurar la fila y sus columnas (por si venía de un tour a pie que las ocultó).
      if (transportFieldsRow) transportFieldsRow.classList.remove('d-none');
      if (segmentoCol) segmentoCol.classList.remove('d-none');
      if (vehicleCol) vehicleCol.classList.remove('d-none');
    } else if (type === 'tour') {
      if (includeGuideContainer) includeGuideContainer.classList.remove('d-none');
      if (includeGreeterContainer) includeGreeterContainer.classList.add('d-none');
      if (opcionalLabelContainer) opcionalLabelContainer.classList.remove('d-none');
      if (guideLabel) guideLabel.textContent = 'Guía + Chofer';
      // La fila queda visible (guía siempre disponible); Segmento/Vehículo se
      // reactivan por defecto y luego handleTourTransportToggle decide según el tour.
      if (transportFieldsRow) transportFieldsRow.classList.remove('d-none');
      if (segmentoCol) segmentoCol.classList.remove('d-none');
      if (vehicleCol) vehicleCol.classList.remove('d-none');
    } else {
      // Experiencia/Concepto: no aplican (la fila de transporte va oculta).
      if (includeGuideContainer) includeGuideContainer.classList.add('d-none');
      if (includeGreeterContainer) includeGreeterContainer.classList.add('d-none');
      if (opcionalLabelContainer) opcionalLabelContainer.classList.add('d-none');
      if (transportFieldsRow) transportFieldsRow.classList.add('d-none');
    }

    // Hide horas field for transport but keep for tours and experiences  
    const hoursContainer = document.getElementById('hoursQuantity')?.closest('.row');
    if (type === 'transport') {
      if (hoursContainer) hoursContainer.classList.add('d-none');
    } else {
      if (hoursContainer) hoursContainer.classList.remove('d-none');
    }

    // Repopulate rates dropdown to filter based on service type
    this.populateRateSelector();

    // (Simplificado) Llena los combos de origen/destino con TODAS las opciones
    if (type === 'transport') {
      setTimeout(async () => {
        await this.populateMergedTransportLists();
      }, 100);
    }

    // Muestra/oculta y actualiza el Total según el tipo de servicio.
    this.updateServiceTotal();
  }

  // (Simplificado) Sin separar aeropuerto/p2p/local: llena los datalists de origen
  // y destino con todas las opciones disponibles (cualquier lugar puede ser origen
  // o destino). El precio se resuelve por ruta (origen+destino+segmento+vehículo);
  // si no hay match, el admin lo pone manual.
  async populateMergedTransportLists() {
    if (!window.servicesByTransportType) {
      try {
        await this.loadActiveServicesForDropdowns();
      } catch (e) {
        console.warn('[Services] No se pudieron cargar servicios para origen/destino:', e);
      }
    }
    const groups = window.servicesByTransportType || {};
    const all = [].concat(groups.aeropuerto || [], groups['punto-a-punto'] || [], groups.local || []);
    const places = new Set();
    all.forEach((s) => {
      if (s && s.origin) places.add(s.origin);
      if (s && s.destination) places.add(s.destination);
    });
    const sorted = [...places].sort();
    ['transportOriginList', 'transportDestinationList'].forEach((id) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.innerHTML = '';
      sorted.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        dl.appendChild(opt);
      });
    });
  }

  clearTransportFormFields() {
    if (this._populatingTransportForm) return;

    // Clear one-way fields
    ['transportOriginSelect', 'transportOriginText', 'transportOriginCombo',
      'transportDestinationCombo', 'transportDestinationSelect', 'transportDestinationText',
      'transportSpecificLocation', 'transportStartTime', 'transportEndTime',
      'airline', 'flightNumber', 'flightTime'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    document.getElementById('specificLocationRow')?.classList.add('d-none');

    // Clear round-trip fields
    ['roundTripOriginIdaSelect', 'roundTripOriginIdaText',
      'roundTripDestinationIdaCombo', 'roundTripDestinationIdaSelect',
      'roundTripOriginVueltaCombo', 'roundTripOriginVueltaSelect',
      'roundTripDestinationVueltaSelect', 'roundTripDestinationVueltaText',
      'roundTripTimeIda', 'roundTripTimeVuelta',
      'roundTripAirlineIda', 'roundTripFlightNumberIda',
      'roundTripAirlineVuelta', 'roundTripFlightNumberVuelta',
      'roundTripSpecificLocationIda', 'roundTripSpecificLocationVuelta'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    document.getElementById('roundTripSpecificLocationIdaRow')?.classList.add('d-none');
    document.getElementById('roundTripSpecificLocationVueltaRow')?.classList.add('d-none');

    // Clear waiting time
    const waitingTimeHours = document.getElementById('waitingTimeHours');
    if (waitingTimeHours) waitingTimeHours.value = 0;
    const waitingTimeRate = document.getElementById('waitingTimeRate');
    if (waitingTimeRate) waitingTimeRate.textContent = '';

    // Clear greeter
    const includeGreeter = document.getElementById('includeGreeter');
    if (includeGreeter) includeGreeter.checked = false;
    const greeterInVehicle = document.getElementById('greeterInVehicle');
    if (greeterInVehicle) greeterInVehicle.checked = false;
    document.getElementById('greeterInVehicleContainer')?.classList.add('d-none');
  }

  async handleTransportTypeChange() {
    this.clearTransportFormFields();
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const flightDetailsSection = document.getElementById('flightDetailsSection');
    const roundTripFlightDetailsIda = document.querySelector('.roundtrip-flight-details-ida');
    const roundTripFlightDetailsVuelta = document.querySelector('.roundtrip-flight-details-vuelta');
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const transportScheduleSection = document.getElementById('transportScheduleSection');

    // Dropdowns will be populated in handleDirectionTypeChange() after fields are made visible

    // Update direction labels
    const arrivalLabel = document.querySelector('label[for="typeArrival"] span');
    const departureLabel = document.querySelector('label[for="typeDeparture"] span');
    const arrivalIcon = document.querySelector('label[for="typeArrival"] i');
    const departureIcon = document.querySelector('label[for="typeDeparture"] i');
    if (transportType === 'punto-a-punto' || transportType === 'local') {
      if (arrivalLabel) arrivalLabel.textContent = 'Ida';
      if (departureLabel) departureLabel.textContent = 'Vuelta';
      if (arrivalIcon) { arrivalIcon.className = 'ti ti-car me-1'; arrivalIcon.style.fontSize = '1.1rem'; }
      if (departureIcon) { departureIcon.className = 'ti ti-car me-1'; departureIcon.style.fontSize = '1.1rem'; }
    } else {
      if (arrivalLabel) arrivalLabel.textContent = 'Arrival';
      if (departureLabel) departureLabel.textContent = 'Departure';
      if (arrivalIcon) { arrivalIcon.className = 'ti ti-plane-arrival me-1'; arrivalIcon.style.fontSize = '1.1rem'; }
      if (departureIcon) { departureIcon.className = 'ti ti-plane-departure me-1'; departureIcon.style.fontSize = '1.1rem'; }
    }

    // Show/hide schedule and flight details
    if (transportType === 'aeropuerto') {
      transportScheduleSection?.classList.add('d-none');
      if (tripType === 'round-trip') {
        roundTripFlightDetailsIda?.classList.remove('d-none');
        roundTripFlightDetailsVuelta?.classList.remove('d-none');
      } else {
        flightDetailsSection?.classList.remove('d-none');
      }
    } else {
      flightDetailsSection?.classList.add('d-none');
      roundTripFlightDetailsIda?.classList.add('d-none');
      roundTripFlightDetailsVuelta?.classList.add('d-none');
      transportScheduleSection?.classList.remove('d-none');
    }

    // Re-evaluate field visibility
    const tripType2 = document.querySelector('input[name="tripType"]:checked')?.value;
    if (tripType2 === 'one-way') {
      await this.handleDirectionTypeChange();
    } else {
      await this.updateRoundTripFieldVisibility();
    }
  }

  // Capture current origin/destination values from all field variants
  captureTransportValues() {
    return {
      // One-way fields
      originSelect: document.getElementById('transportOriginSelect')?.value || '',
      originCombo: document.getElementById('transportOriginCombo')?.value || '',
      originText: document.getElementById('transportOriginText')?.value || '',
      destCombo: document.getElementById('transportDestinationCombo')?.value || '',
      destSelect: document.getElementById('transportDestinationSelect')?.value || '',
      destText: document.getElementById('transportDestinationText')?.value || '',
      // Round-trip Ida
      rtIdaOriginSelect: document.getElementById('roundTripOriginIdaSelect')?.value || '',
      rtIdaOriginText: document.getElementById('roundTripOriginIdaText')?.value || '',
      rtIdaDestCombo: document.getElementById('roundTripDestinationIdaCombo')?.value || '',
      rtIdaDestSelect: document.getElementById('roundTripDestinationIdaSelect')?.value || '',
      // Round-trip Vuelta
      rtVueltaOriginCombo: document.getElementById('roundTripOriginVueltaCombo')?.value || '',
      rtVueltaOriginSelect: document.getElementById('roundTripOriginVueltaSelect')?.value || '',
      rtVueltaDestSelect: document.getElementById('roundTripDestinationVueltaSelect')?.value || '',
      rtVueltaDestText: document.getElementById('roundTripDestinationVueltaText')?.value || '',
    };
  }

  // Get selected text from a select element (display name, not slug)
  getSelectText(id) {
    const el = document.getElementById(id);
    if (!el || !el.value) return '';
    return el.options[el.selectedIndex]?.textContent || '';
  }

  // Get the "active" origin/destination from one-way fields (whichever is visible)
  getActiveOneWayValues() {
    const origin =
      this.getSelectText('transportOriginSelect') ||
      document.getElementById('transportOriginCombo')?.value ||
      document.getElementById('transportOriginText')?.value || '';
    const dest =
      document.getElementById('transportDestinationCombo')?.value ||
      this.getSelectText('transportDestinationSelect') ||
      document.getElementById('transportDestinationText')?.value || '';
    return { origin, dest };
  }

  // Get the "active" origin/destination from round-trip Ida fields
  getActiveRoundTripIdaValues() {
    const origin =
      this.getSelectText('roundTripOriginIdaSelect') ||
      document.getElementById('roundTripOriginIdaText')?.value || '';
    const dest =
      document.getElementById('roundTripDestinationIdaCombo')?.value ||
      this.getSelectText('roundTripDestinationIdaSelect') || '';
    return { origin, dest };
  }

  async handleTripTypeChange() {
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const oneWayForm = document.getElementById('oneWayForm');
    const roundTripForm = document.getElementById('roundTripForm');
    const arrivalDepartureSelector = document.getElementById('arrivalDepartureSelector');
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;

    // Capture values before switching
    const wasOneWay = !oneWayForm?.classList.contains('d-none');
    let savedOrigin = '';
    let savedDest = '';

    if (wasOneWay) {
      const vals = this.getActiveOneWayValues();
      savedOrigin = vals.origin;
      savedDest = vals.dest;
    } else {
      const vals = this.getActiveRoundTripIdaValues();
      savedOrigin = vals.origin;
      savedDest = vals.dest;
    }

    // Toggle forms
    if (tripType === 'one-way') {
      oneWayForm?.classList.remove('d-none');
      roundTripForm?.classList.add('d-none');
      arrivalDepartureSelector?.classList.remove('d-none');
      if (transportType) {
        const directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
        this.populateDropdownsForTransportType(transportType, directionType);
      }
      // Restore values to one-way fields
      this.restoreOneWayValues(savedOrigin, savedDest, transportType);
    } else {
      oneWayForm?.classList.add('d-none');
      roundTripForm?.classList.remove('d-none');
      arrivalDepartureSelector?.classList.add('d-none');
      await this.updateRoundTripFieldVisibility();
      // Restore values to round-trip Ida fields
      this.restoreRoundTripValues(savedOrigin, savedDest, transportType);
    }

    // Update flight details / schedule visibility
    const flightDetailsSection = document.getElementById('flightDetailsSection');
    const roundTripFlightDetailsIda = document.querySelector('.roundtrip-flight-details-ida');
    const roundTripFlightDetailsVuelta = document.querySelector('.roundtrip-flight-details-vuelta');
    const transportScheduleSection = document.getElementById('transportScheduleSection');

    if (transportType === 'aeropuerto') {
      transportScheduleSection?.classList.add('d-none');
      if (tripType === 'round-trip') {
        flightDetailsSection?.classList.add('d-none');
        roundTripFlightDetailsIda?.classList.remove('d-none');
        roundTripFlightDetailsVuelta?.classList.remove('d-none');
      } else {
        flightDetailsSection?.classList.remove('d-none');
        roundTripFlightDetailsIda?.classList.add('d-none');
        roundTripFlightDetailsVuelta?.classList.add('d-none');
      }
    } else {
      flightDetailsSection?.classList.add('d-none');
      roundTripFlightDetailsIda?.classList.add('d-none');
      roundTripFlightDetailsVuelta?.classList.add('d-none');
      if (tripType === 'one-way') {
        transportScheduleSection?.classList.remove('d-none');
      }
    }
  }

  restoreOneWayValues(origin, dest, transportType) {
    if (!origin && !dest) return;
    setTimeout(() => {
      const originSlug = origin.toLowerCase().replace(/\s+/g, '-');
      const destSlug = dest.toLowerCase().replace(/\s+/g, '-');

      // Try to restore origin to whichever field is visible
      const originSelect = document.getElementById('transportOriginSelect');
      if (originSelect && !originSelect.classList.contains('d-none') && origin) {
        this.setSelectByValue(originSelect, originSlug);
      }
      const originCombo = document.getElementById('transportOriginCombo');
      const originComboWrapper = document.getElementById('transportOriginComboWrapper');
      if (originCombo && originComboWrapper && !originComboWrapper.classList.contains('d-none') && origin) {
        originCombo.value = origin;
      }
      const originText = document.getElementById('transportOriginText');
      if (originText && !originText.classList.contains('d-none') && origin) {
        originText.value = origin;
      }

      // Try to restore destination to whichever field is visible
      const destCombo = document.getElementById('transportDestinationCombo');
      const destComboWrapper = document.getElementById('transportDestinationComboWrapper');
      if (destCombo && destComboWrapper && !destComboWrapper.classList.contains('d-none') && dest) {
        destCombo.value = dest;
      }
      const destSelect = document.getElementById('transportDestinationSelect');
      if (destSelect && !destSelect.classList.contains('d-none') && dest) {
        this.setSelectByValue(destSelect, destSlug);
      }
      const destText = document.getElementById('transportDestinationText');
      if (destText && !destText.classList.contains('d-none') && dest) {
        destText.value = dest;
      }
      this.checkSpecificLocationField();
    }, 50);
  }

  restoreRoundTripValues(origin, dest, transportType) {
    if (!origin && !dest) return;
    setTimeout(() => {
      const originSlug = origin.toLowerCase().replace(/\s+/g, '-');
      const destSlug = dest.toLowerCase().replace(/\s+/g, '-');

      // Restore to Ida origin (select or text)
      const idaOriginSelect = document.getElementById('roundTripOriginIdaSelect');
      if (idaOriginSelect && !idaOriginSelect.classList.contains('d-none') && origin) {
        this.setSelectByValue(idaOriginSelect, originSlug);
      }
      const idaOriginText = document.getElementById('roundTripOriginIdaText');
      if (idaOriginText && !idaOriginText.classList.contains('d-none') && origin) {
        idaOriginText.value = origin;
      }

      // Restore to Ida destination (combo or select)
      const idaDestCombo = document.getElementById('roundTripDestinationIdaCombo');
      const idaDestComboWrapper = document.getElementById('roundTripDestinationIdaComboWrapper');
      if (idaDestCombo && idaDestComboWrapper && !idaDestComboWrapper.classList.contains('d-none') && dest) {
        idaDestCombo.value = dest;
      }
      const idaDestSelect = document.getElementById('roundTripDestinationIdaSelect');
      if (idaDestSelect && !idaDestSelect.classList.contains('d-none') && dest) {
        this.setSelectByValue(idaDestSelect, destSlug);
      }

      // For Vuelta, swap origin/dest
      const vueltaOriginCombo = document.getElementById('roundTripOriginVueltaCombo');
      const vueltaOriginComboWrapper = document.getElementById('roundTripOriginVueltaComboWrapper');
      if (vueltaOriginCombo && vueltaOriginComboWrapper && !vueltaOriginComboWrapper.classList.contains('d-none') && dest) {
        vueltaOriginCombo.value = dest;
      }
      const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
      if (vueltaOriginSelect && !vueltaOriginSelect.classList.contains('d-none') && dest) {
        this.setSelectByValue(vueltaOriginSelect, destSlug);
      }
      const vueltaDestSelect = document.getElementById('roundTripDestinationVueltaSelect');
      if (vueltaDestSelect && !vueltaDestSelect.classList.contains('d-none') && origin) {
        this.setSelectByValue(vueltaDestSelect, originSlug);
      }
      const vueltaDestText = document.getElementById('roundTripDestinationVueltaText');
      if (vueltaDestText && !vueltaDestText.classList.contains('d-none') && origin) {
        vueltaDestText.value = origin;
      }
      this.checkRoundTripSpecificLocationFields();
    }, 50);
  }

  async handleDirectionTypeChange() {
    console.log('🚨 DEBUG: handleDirectionTypeChange called');
    // Capture current values before clearing (swap: old origin → new dest, old dest → new origin)
    const savedValues = this.getActiveOneWayValues();
    const savedOrigin = savedValues.origin;
    const savedDest = savedValues.dest;

    this.clearTransportFormFields();
    const directionType = document.querySelector('input[name="directionType"]:checked')?.value;
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;

    // Get field elements
    const originSelect = document.getElementById('transportOriginSelect');
    const originText = document.getElementById('transportOriginText');
    const originComboWrapper = document.getElementById('transportOriginComboWrapper');
    const destinationComboWrapper = document.getElementById('transportDestinationComboWrapper');
    const destinationSelect = document.getElementById('transportDestinationSelect');
    const destinationText = document.getElementById('transportDestinationText');
    const timeLabel = document.querySelector('label[for="flightTime"]');

    // Hide all variants first
    originSelect?.classList.add('d-none');
    originText?.classList.add('d-none');
    originComboWrapper?.classList.add('d-none');
    destinationComboWrapper?.classList.add('d-none');
    destinationSelect?.classList.add('d-none');
    destinationText?.classList.add('d-none');
    originSelect?.removeAttribute('required');
    originText?.removeAttribute('required');
    document.getElementById('transportOriginCombo')?.removeAttribute('required');
    document.getElementById('transportDestinationCombo')?.removeAttribute('required');
    destinationSelect?.removeAttribute('required');
    destinationText?.removeAttribute('required');

    const originLabel = document.getElementById('transportOriginLabel');
    const destinationLabel = document.getElementById('transportDestinationLabel');

    if (directionType === 'arrival' && transportType === 'local') {
      originText?.classList.remove('d-none');
      originText?.setAttribute('required', 'required');
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen (San Miguel de Allende) <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
    } else if (directionType === 'arrival') {
      // Aeropuerto/Punto-a-Punto Arrival: Origin = SELECT, Destination = SELECT (match quote modal)
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
      if (timeLabel) timeLabel.textContent = 'Hora de Llegada';
    } else if (directionType === 'departure' && transportType === 'local') {
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      destinationText?.classList.remove('d-none');
      destinationText?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino (San Miguel de Allende) <span class="text-danger">*</span>';
    } else if (directionType === 'departure') {
      // Aeropuerto/Punto-a-Punto Departure: Origin = SELECT, Destination = SELECT (match quote modal)
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
      if (timeLabel) timeLabel.textContent = 'Hora de Salida';
    }

    // Re-populate dropdowns considering direction (like quote modal)
    console.log('🚨 DEBUG: About to check transportType:', { transportType, directionType });
    if (transportType) {
      console.log('🚨 DEBUG: Calling populateTransportPOIDropdowns...');
      this.populateDropdownsForTransportType(transportType, directionType);
    } else {
      console.log('🚨 DEBUG: transportType is empty, not calling populateTransportDropdowns');
    }

    // Restore values swapped: old origin → new dest, old dest → new origin
    if (savedOrigin || savedDest) {
      this.restoreOneWayValues(savedDest, savedOrigin, transportType);
    }
  }

  async updateRoundTripFieldVisibility() {
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    if (!transportType) return;

    // --- IDA (arrival pattern) ---
    const idaOriginSelect = document.getElementById('roundTripOriginIdaSelect');
    const idaOriginText = document.getElementById('roundTripOriginIdaText');
    const idaDestComboWrapper = document.getElementById('roundTripDestinationIdaComboWrapper');
    const idaDestSelect = document.getElementById('roundTripDestinationIdaSelect');
    const idaOriginLabel = document.getElementById('roundTripOriginIdaLabel');

    idaOriginSelect?.classList.add('d-none');
    idaOriginText?.classList.add('d-none');
    idaDestComboWrapper?.classList.add('d-none');
    idaDestSelect?.classList.add('d-none');

    if (transportType === 'local') {
      idaOriginText?.classList.remove('d-none');
      idaDestSelect?.classList.remove('d-none');
      if (idaOriginLabel) idaOriginLabel.innerHTML = 'Origen (San Miguel de Allende) <span class="text-danger">*</span>';
    } else {
      // Aeropuerto/Punto-a-Punto: Origin = SELECT, Destination = SELECT (match quote modal)
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

    vueltaOriginComboWrapper?.classList.add('d-none');
    vueltaOriginSelect?.classList.add('d-none');
    vueltaDestSelect?.classList.add('d-none');
    vueltaDestText?.classList.add('d-none');

    if (transportType === 'local') {
      vueltaOriginSelect?.classList.remove('d-none');
      vueltaDestText?.classList.remove('d-none');
      if (vueltaDestLabel) vueltaDestLabel.innerHTML = 'Destino (San Miguel de Allende) <span class="text-danger">*</span>';
    } else {
      // Aeropuerto/Punto-a-Punto: Origin = SELECT, Destination = SELECT (match quote modal)
      vueltaOriginSelect?.classList.remove('d-none');
      vueltaDestSelect?.classList.remove('d-none');
      if (vueltaDestLabel) vueltaDestLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
    }

    // Update headers
    const idaHeader = document.getElementById('roundTripIdaHeader');
    const vueltaHeader = document.getElementById('roundTripVueltaHeader');
    const dateIdaLabel = document.getElementById('roundTripDateIdaLabel');
    const timeIdaLabel = document.getElementById('roundTripTimeIdaLabel');
    const dateVueltaLabel = document.getElementById('roundTripDateVueltaLabel');
    const timeVueltaLabel = document.getElementById('roundTripTimeVueltaLabel');

    if (transportType === 'aeropuerto') {
      if (idaHeader) idaHeader.innerHTML = '<i class="ti ti-plane-arrival me-2"></i>Arrival';
      if (vueltaHeader) vueltaHeader.innerHTML = '<i class="ti ti-plane-departure me-2"></i>Departure';
      if (dateIdaLabel) dateIdaLabel.textContent = 'Fecha de Llegada';
      if (timeIdaLabel) timeIdaLabel.textContent = 'Hora de Llegada';
      if (dateVueltaLabel) dateVueltaLabel.textContent = 'Fecha de Salida';
      if (timeVueltaLabel) timeVueltaLabel.textContent = 'Hora de Salida';
    } else {
      if (idaHeader) idaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Ida';
      if (vueltaHeader) vueltaHeader.innerHTML = '<i class="ti ti-car me-2"></i>Vuelta';
      if (dateIdaLabel) dateIdaLabel.textContent = 'Fecha de Ida';
      if (timeIdaLabel) timeIdaLabel.textContent = 'Hora de Ida';
      if (dateVueltaLabel) dateVueltaLabel.textContent = 'Fecha de Vuelta';
      if (timeVueltaLabel) timeVueltaLabel.textContent = 'Hora de Vuelta';
    }

    // Populate round-trip dropdowns (using same POI logic)
    await this.populateRoundTripDropdowns(transportType);
  }

  // Legacy function - now delegates to quote modal logic
  async populateRoundTripDropdowns(transportType) {
    console.log('[Services] populateRoundTripDropdowns called for', transportType);

    try {
      // Ensure services are loaded
      if (!window.servicesByTransportType) {
        console.warn('[Services] No services data available, loading now...');
        await this.loadActiveServicesForDropdowns();
        if (!window.servicesByTransportType) {
          console.warn('[Services] Services not available for round trip dropdowns');
          return;
        }
      }
    } catch (error) {
      console.error('[Services] Error loading services for round trip:', error);
      return;
    }

    const services = window.servicesByTransportType[transportType] || [];
    console.log('[Services] Using', services.length, 'services for round trip dropdowns');

    // Collect origins/destinations for both directions
    const arrivalOrigins = new Set();
    const arrivalDestinations = new Set();
    const departureOrigins = new Set();
    const departureDestinations = new Set();

    services.forEach(service => {
      if (transportType === 'aeropuerto') {
        // Arrival: airports → origins, destinations → destinations
        if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
          arrivalOrigins.add(service.origin);
          departureDestinations.add(service.origin); // Departure dest = airports
        }
        if (service.destination) {
          arrivalDestinations.add(service.destination);
          departureOrigins.add(service.destination); // Departure origin = hotels/cities
        }
      } else {
        // Punto a Punto / Local
        if (service.origin) {
          arrivalOrigins.add(service.origin);
          departureDestinations.add(service.origin);
        }
        if (service.destination) {
          arrivalDestinations.add(service.destination);
          departureOrigins.add(service.destination);
        }
      }
    });

    console.log('🔧 POI Loading: Round trip POIs filtered - Arrival Origins:', arrivalOrigins.size, 'Departure Origins:', departureOrigins.size);

    window.slugToOriginalMapping = window.slugToOriginalMapping || new Map();

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

    // Ida (arrival): origin = SELECT, dest = SELECT (match quote modal)
    populateSelect(document.getElementById('roundTripOriginIdaSelect'), arrivalOrigins);
    populateSelect(document.getElementById('roundTripDestinationIdaSelect'), arrivalDestinations);

    // Vuelta (departure): origin = SELECT, dest = SELECT (match quote modal)
    populateSelect(document.getElementById('roundTripOriginVueltaSelect'), departureOrigins);
    populateSelect(document.getElementById('roundTripDestinationVueltaSelect'), departureDestinations);
  }

  handleExperienceSelection(experienceId) {
    if (!experienceId) {
      this.hideExperienceDetailsCard();
      return;
    }

    const exp = this.experiencesCache.get(experienceId);
    if (!exp) {
      this.hideExperienceDetailsCard();
      return;
    }

    // Build and show the experience details card
    this.buildExperienceDetailsCard(exp);

    // Set default prices (these might be hidden fields used for calculation)
    const isProvider = exp.type === 'provider_experience';
    const adultPrice = isProvider ? exp.price : exp.cost;
    const adultPriceEl = document.getElementById('adultPrice');
    if (adultPriceEl && adultPrice) adultPriceEl.value = adultPrice;

    // El campo se deja vacío si la experiencia no trae el precio; el default a
    // adulto se aplica solo en el cálculo/guardado (no se rellena en pantalla).
    const childPriceEl = document.getElementById('childPrice');
    if (childPriceEl) childPriceEl.value = isProvider ? (exp.price_child || '') : (exp.childPrice || '');

    const noAlcPriceEl = document.getElementById('noAlcoholPrice');
    if (noAlcPriceEl) noAlcPriceEl.value = isProvider ? (exp.price_no_alcohol || '') : (exp.noAlcoholPrice || '');

    // Pre-cargar "Horas" con la duración configurada de la experiencia (editable);
    // esto alimenta la "duración sugerida" (suma de tiempos de los servicios).
    const hoursEl = document.getElementById('hoursQuantity');
    if (hoursEl && exp.duration) hoursEl.value = parseFloat(exp.duration) || '';

    // Store experience data for later use
    this.selectedExperienceData = exp;

    // Check for transport services in the experience
    this.detectAndShowTransportServices(exp);
  }

  buildExperienceDetailsCard(exp) {
    const card = document.getElementById('experienceDetailsCard');
    const body = document.getElementById('experienceDetailsCardBody');
    if (!card || !body) return;

    const isProvider = exp.type === 'provider_experience';

    // Helper functions for formatting
    const tag = (icon, value) => {
      if (!value) return '';
      return `<span class="me-3 small"><i class="ti ti-${icon} me-1 text-muted"></i>${value}</span>`;
    };

    const infoLine = (icon, label, value) => {
      if (!value) return '';
      return `<div class="small py-1"><i class="ti ti-${icon} me-1 text-muted"></i><span class="text-muted">${label}:</span> ${value}</div>`;
    };

    // Format availability schedule
    const formatSchedule = (availability) => {
      if (!availability || !availability.length) return '';

      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      let scheduleHtml = '';

      availability.forEach(item => {
        const dayName = dayNames[item.day] || `Día ${item.day}`;
        const times = item.times || [];
        times.forEach(time => {
          const timeRange = `${time.start || '00:00'}-${time.end || '23:59'}`;
          scheduleHtml += `<span class="badge bg-light text-dark me-1 mb-1">${dayName} ${timeRange}</span>`;
        });
      });

      return scheduleHtml || '<span class="text-muted">Sin horarios definidos</span>';
    };

    // Format experience availability schedule in two-column table format
    const renderExperienceScheduleTable = (availability) => {
      if (!availability || !availability.length) {
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

      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const rows = availability.map(item => {
        const dayName = dayNames[item.day] || `Día ${item.day}`;
        const times = item.times || [];

        let timeStr = '';
        if (times.length === 0) {
          timeStr = '<span class="text-muted">Sin horarios específicos</span>';
        } else {
          timeStr = times.map(time => {
            const start = time.start || '00:00';
            const end = time.end || '23:59';
            return `${start} - ${end}`;
          }).join('<br>');
        }

        return `
          <tr>
            <td class="fw-medium" style="width: 30%;">${dayName}</td>
            <td class="small">${timeStr}</td>
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

    // Format arrays to comma-separated strings
    const formatArray = (arr) => {
      if (!arr) return '';
      return Array.isArray(arr) ? arr.join(', ') : arr;
    };

    // Convert minutes to hours and minutes format
    const formatMinutesToTime = (minutes) => {
      if (!minutes || minutes === 0) return 'Inmediata';
      const numMinutes = parseInt(minutes, 10);
      if (isNaN(numMinutes)) return minutes; // Return original if not a number

      const hours = Math.floor(numMinutes / 60);
      const mins = numMinutes % 60;

      if (hours === 0) return `${mins} min`;
      if (mins === 0) return `${hours} hora${hours > 1 ? 's' : ''}`;
      return `${hours} hora${hours > 1 ? 's' : ''} ${mins} min`;
    };

    // Get values from experience object
    const name = exp.name || exp.title || 'Experiencia sin nombre';
    const description = exp.description || '';
    const duration = exp.duration ? `${exp.duration} horas` : '';

    // Handle advance booking time - could be in minutes or already formatted
    const advanceBookingRaw = exp.advanceBookingTime || exp.advance_booking_time || exp.advance_minutes || 'Inmediata';
    const advanceBooking = formatMinutesToTime(advanceBookingRaw);

    const languages = formatArray(isProvider ? exp.languages : exp.languages);
    const includes = formatArray(exp.includes);
    const notIncludes = formatArray(exp.notincludes || exp.notIncludes);

    // Extract all notes types
    const clientNotes = exp.clientNotes || exp.client_booking_notes || '';
    const providerNotes = exp.provider_notes || '';
    const internalNotes = exp.internal_notes || '';
    const teamNotes = exp.team_notes || '';

    // Check for availability schedule in multiple possible properties
    const availabilityData = exp.availability_schedule || exp.availability || exp.schedules || exp.suggested_times || exp.availabilitySchedule;

    // Check if we have any content to show in the bottom section
    const hasBottomContent = includes || notIncludes || clientNotes || providerNotes || internalNotes || teamNotes;

    // Build the card HTML
    body.innerHTML = `
      <h6 class="fw-bold mb-1">${name}</h6>
      ${description ? `<p class="text-muted small mb-2">${description}</p>` : ''}
      <hr class="my-2">
      <div class="d-flex flex-wrap align-items-center mb-2">
        ${tag('clock', duration ? `Duración: ${duration}` : null)}
        ${tag('calendar-event', `Reserva anticipada: ${advanceBooking}`)}
        ${tag('language', languages ? `Idiomas: ${languages}` : null)}
      </div>
      ${availabilityData ? `
      <div class="mb-2">
        <span class="small text-muted d-block mb-2"><i class="ti ti-calendar me-1"></i>Recomendamos salir:</span>
        ${renderExperienceScheduleTable(availabilityData)}
      </div>
      ` : ''}
      ${hasBottomContent ? '<hr class="my-2">' : ''}
      ${infoLine('circle-check', 'Incluye', includes)}
      ${infoLine('circle-x', 'No incluye', notIncludes)}
      ${infoLine('user', 'Notas Cliente', clientNotes)}
      ${infoLine('building', 'Notas Proveedor', providerNotes)}
      ${infoLine('lock', 'Notas Internas', internalNotes)}
      ${infoLine('users', 'Notas Equipo', teamNotes)}
    `;

    // Show the card
    card.classList.remove('d-none');

    // Hide the schedule fields since we're showing the info in the card
    const scheduleFields = document.getElementById('experienceScheduleFields');
    if (scheduleFields) scheduleFields.style.display = 'none';
  }

  detectAndShowTransportServices(exp) {
    // Check if experience has transport services in its serviceItems
    const serviceItems = exp.serviceItems || {};
    const subconcepts = serviceItems.subconcepts || [];

    // Find transport services
    const transportServices = subconcepts.filter(sc =>
      sc.type === 'traslado' || sc.type === 'transport'
    );

    if (transportServices.length > 0) {
      // Store transport services for editing
      this.experienceTransportServices = transportServices;

      // Show transport editing section
      this.showTransportEditingSection(transportServices);
    } else {
      // Hide transport editing section if no transport services
      this.hideTransportEditingSection();
    }
  }

  showTransportEditingSection(transportServices) {
    // Check if transport editing section already exists
    let transportSection = document.getElementById('experienceTransportSection');

    if (!transportSection) {
      // Create transport editing section after experience details card
      const experienceCard = document.getElementById('experienceDetailsCard');
      if (experienceCard) {
        transportSection = document.createElement('div');
        transportSection.id = 'experienceTransportSection';
        transportSection.className = 'card mt-3';
        experienceCard.parentNode.insertBefore(transportSection, experienceCard.nextSibling);
      } else {
        return; // Can't create section without reference point
      }
    }

    // Build transport services HTML
    const transportHTML = this.buildTransportServicesHTML(transportServices);

    transportSection.innerHTML = `
      <div class="card-header d-flex align-items-center">
        <i class="ti ti-car me-2 text-warning"></i>
        <h6 class="mb-0">Servicios de Transporte Incluidos</h6>
      </div>
      <div class="card-body">
        <p class="text-muted small mb-3">Esta experiencia incluye servicios de transporte. Puedes editar el tipo de vehículo y segmento para cada servicio.</p>
        ${transportHTML}
      </div>
    `;

    // Show the section
    transportSection.classList.remove('d-none');

    // Initialize transport editing handlers
    this.initializeTransportEditingHandlers();
  }

  hideTransportEditingSection() {
    const transportSection = document.getElementById('experienceTransportSection');
    if (transportSection) {
      transportSection.classList.add('d-none');
    }
  }

  buildTransportServicesHTML(transportServices) {
    return transportServices.map((transport, index) => {
      const vehicleTypeName = transport.vehicleTypeName || 'Sin especificar';
      const concept = transport.concept || 'Servicio de transporte';

      return `
        <div class="border rounded p-3 mb-3 transport-service-item" data-transport-index="${index}">
          <div class="row align-items-center">
            <div class="col-md-6">
              <h6 class="mb-1">${concept}</h6>
              <div class="text-muted small">
                <i class="ti ti-car me-1"></i>Vehículo actual: <span class="fw-medium">${vehicleTypeName}</span>
              </div>
            </div>
            <div class="col-md-6">
              <div class="mb-2">
                <label class="form-label small">Tipo de Vehículo</label>
                <select class="form-select form-select-sm vehicle-type-select" data-transport-index="${index}">
                  <option value="">Seleccionar vehículo...</option>
                </select>
              </div>
              <div class="mb-2">
                <label class="form-label small">Segmento</label>
                <select class="form-select form-select-sm segment-select" data-transport-index="${index}">
                  <option value="">Seleccionar segmento...</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  initializeTransportEditingHandlers() {
    // Initialize vehicle and segment dropdowns
    this.populateTransportDropdowns();

    // Add change event listeners for vehicle selection
    document.querySelectorAll('.vehicle-type-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const transportIndex = e.target.dataset.transportIndex;
        this.handleTransportVehicleChange(transportIndex, e.target.value);
      });
    });

    // Add change event listeners for segment selection
    document.querySelectorAll('.segment-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const transportIndex = e.target.dataset.transportIndex;
        this.handleTransportSegmentChange(transportIndex, e.target.value);
      });
    });
  }

  populateTransportDropdowns() {
    // Populate vehicle type dropdowns (reuse existing cache if available)
    const vehicleSelects = document.querySelectorAll('.vehicle-type-select');
    vehicleSelects.forEach(select => {
      const transportIndex = select.dataset.transportIndex;

      // Clear existing options except the first one
      select.innerHTML = '<option value="">Seleccionar vehículo...</option>';

      // Populate with vehicle types from cache
      this.populateVehicleSelect(select);

      // Pre-select current vehicle if available
      if (this.experienceTransportServices && this.experienceTransportServices[transportIndex]) {
        const currentVehicleId = this.experienceTransportServices[transportIndex].vehicleId;
        if (currentVehicleId) {
          select.value = currentVehicleId;
        }
      }
    });

    // Populate segment dropdowns
    const segmentSelects = document.querySelectorAll('.segment-select');
    segmentSelects.forEach(select => {
      const transportIndex = select.dataset.transportIndex;

      // Clear existing options except the first one  
      select.innerHTML = '<option value="">Seleccionar segmento...</option>';

      // Populate with segments from cache
      this.populateSegmentSelect(select);

      // Pre-select current segment if available
      if (this.experienceTransportServices && this.experienceTransportServices[transportIndex]) {
        const currentRateId = this.experienceTransportServices[transportIndex].rateId;
        if (currentRateId) {
          select.value = currentRateId;
        }
      }
    });
  }

  populateVehicleSelect(select) {
    // Reuse existing vehicle cache logic
    if (!this.vehiclesCache) return;

    this.vehiclesCache.forEach(vehicle => {
      const option = document.createElement('option');
      option.value = vehicle.id;
      option.textContent = `${vehicle.name} (${vehicle.capacity} pax)`;
      select.appendChild(option);
    });
  }

  populateSegmentSelect(select) {
    // Reuse existing rates cache logic
    if (!this.ratesCache) return;

    this.ratesCache.forEach(rate => {
      const option = document.createElement('option');
      option.value = rate.id;
      option.textContent = rate.name;
      select.appendChild(option);
    });
  }

  handleTransportVehicleChange(transportIndex, vehicleId) {
    if (!this.experienceTransportServices || !this.experienceTransportServices[transportIndex]) {
      return;
    }

    // Update the transport service data
    this.experienceTransportServices[transportIndex].vehicleId = vehicleId;

    // Find vehicle details from cache to update vehicle type name
    if (this.vehiclesCache && vehicleId) {
      const vehicle = this.vehiclesCache.find(v => v.id === vehicleId);
      if (vehicle) {
        this.experienceTransportServices[transportIndex].vehicleTypeName = vehicle.name;
        this.experienceTransportServices[transportIndex].vehicleType = vehicle.type || vehicle.name;

        // Update the display text
        const serviceItem = document.querySelector(`[data-transport-index="${transportIndex}"]`);
        if (serviceItem) {
          const currentVehicleSpan = serviceItem.querySelector('.fw-medium');
          if (currentVehicleSpan) {
            currentVehicleSpan.textContent = `${vehicle.name} (${vehicle.capacity} pax)`;
          }
        }
      }
    }

    console.log(`Transport ${transportIndex} vehicle changed to:`, vehicleId);
  }

  handleTransportSegmentChange(transportIndex, segmentId) {
    if (!this.experienceTransportServices || !this.experienceTransportServices[transportIndex]) {
      return;
    }

    // Update the transport service data
    this.experienceTransportServices[transportIndex].rateId = segmentId;

    // Find rate details from cache to update related data
    if (this.ratesCache && segmentId) {
      const rate = this.ratesCache.find(r => r.id === segmentId);
      if (rate) {
        this.experienceTransportServices[transportIndex].rateName = rate.name;
        // You could also update pricing here if needed
      }
    }

    console.log(`Transport ${transportIndex} segment changed to:`, segmentId);
  }

  hideExperienceDetailsCard() {
    const card = document.getElementById('experienceDetailsCard');
    if (card) card.classList.add('d-none');
  }

  handleTourSelection(tourId) {
    if (!tourId) {
      this.hideTourDetailsCard();
      return;
    }

    const tour = this.toursCache.get(tourId);
    if (!tour) {
      this.hideTourDetailsCard();
      return;
    }

    // Build and show the tour details card
    this.buildTourDetailsCard(tour);

    // Store tour data for later use
    this.selectedTourData = tour;

    // Un tour CON vehículo necesita segmento + vehículo; uno a pie no.
    // Revela/oculta esos campos automáticamente al elegir el tour.
    this.handleTourTransportToggle(!tour.isWalkingTour);

    // Autocargar la duración del tour en "Horas" (tour.time está en minutos).
    // Ej: Mineral de Pozos = 180 min -> 3 horas.
    const hoursInput = document.getElementById('hoursQuantity');
    if (hoursInput && tour.time) {
      const hrs = parseInt(tour.time, 10) / 60;
      if (!isNaN(hrs) && hrs > 0) {
        hoursInput.value = +hrs.toFixed(1);
      }
    }

    // Tour a pie: precargar precios de grupo (editables), etiquetas de rango y personas=1.
    if (tour.isWalkingTour) {
      this.populateWalkingTourFields(tour);
      this.updateServiceTotal();
    }
  }

  // Precarga los inputs editables del tour a pie desde el objeto del tour.
  populateWalkingTourFields(tour, values = {}) {
    const setPrice = (inputId, value) => {
      const el = document.getElementById(inputId);
      if (el) el.value = (value != null && value !== '') ? value : 0;
    };
    const setLabel = (spanId, range) => {
      const el = document.getElementById(spanId);
      if (el) el.textContent = range ? `(${range})` : '';
    };

    // Un override 0/vacío = "sin editar" -> usa el precio del tour (un precio de
    // grupo 0 no tiene sentido). Un precio editado (>0) tiene precedencia.
    setPrice('walkingPriceSmall', values.walkingPriceSmall ? values.walkingPriceSmall : tour.walkingPriceSmall);
    setPrice('walkingPriceMedium', values.walkingPriceMedium ? values.walkingPriceMedium : tour.walkingPriceMedium);
    setPrice('walkingPriceLarge', values.walkingPriceLarge ? values.walkingPriceLarge : tour.walkingPriceLarge);

    setLabel('walkingRangeSmallLabel', tour.walkingRangeSmall);
    setLabel('walkingRangeMediumLabel', tour.walkingRangeMedium);
    setLabel('walkingRangeLargeLabel', tour.walkingRangeLarge);

    const peopleEl = document.getElementById('walkingTourPeopleCount');
    if (peopleEl) peopleEl.value = values.walkingPeopleCount != null ? values.walkingPeopleCount : 1;
  }

  buildTourDetailsCard(tour) {
    const card = document.getElementById('tourDetailsCard');
    const body = document.getElementById('tourDetailsCardBody');
    if (!card || !body) return;

    // Helper functions for formatting
    const tag = (icon, value) => {
      if (!value) return '';
      return `<span class="me-3 small"><i class="ti ti-${icon} me-1 text-muted"></i>${value}</span>`;
    };

    const infoLine = (icon, label, value) => {
      if (!value) return '';
      return `<div class="small py-1"><i class="ti ti-${icon} me-1 text-muted"></i><span class="text-muted">${label}:</span> ${value}</div>`;
    };

    // Format tour availability schedule with "Todos los días" logic like quotes system
    const renderAvailabilityPills = (schedule) => {
      if (!schedule || schedule.length === 0 || (schedule.length === 7 && schedule.every((s) => s.times && s.times.length === 0))) {
        return '<span class="badge bg-light text-dark border">Todos los días</span>';
      }
      return schedule.map((s) => {
        const timeStr = s.times && s.times.length > 0 ? ` ${s.times.map((t) => t.replace(/\s*-\s*/g, '-')).join(', ')}` : '';
        return `<span class="badge bg-light text-dark border me-1 mb-1">${s.day}${timeStr}</span>`;
      }).join('');
    };

    // Format tour availability schedule in two-column table format
    const renderAvailabilityTable = (schedule) => {
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

    // Extract availability schedule like quotes system
    const extractAvailabilitySchedule = (item) => {
      const dayAbbrevs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const dayNamesEn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const result = []; // Array of { day: 'Lun', times: ['08:00 - 12:00'] }

      // String format: "Sa, Vi, Ju, Mi"
      if (typeof item.availability === 'string' || typeof item.availableDays === 'string') {
        const str = item.availability || item.availableDays;
        const abbrevMap = { do: 0, lu: 1, ma: 2, mi: 3, ju: 4, vi: 5, sa: 6, sá: 6 };
        str.split(/[,\s]+/).forEach((part) => {
          const key = part.toLowerCase().substring(0, 2);
          if (abbrevMap[key] !== undefined) {
            result.push({ day: dayAbbrevs[abbrevMap[key]], times: [] });
          }
        });
        return result;
      }

      // Array of day numbers: [0,1,2,3,4,5,6]
      if (Array.isArray(item.availableDays)) {
        item.availableDays.forEach((d) => {
          if (d >= 0 && d <= 6) result.push({ day: dayAbbrevs[d], times: [] });
        });
        return result;
      }

      // Availability array (objects with day keys + time data)
      if (Array.isArray(item.availability)) {
        const dayTimesMap = new Map();
        for (const obj of item.availability) {
          if (!obj || typeof obj !== 'object') continue;
          for (let d = 0; d < 7; d++) {
            const keys = [d.toString(), dayNamesEn[d], dayNamesEs[d]];
            for (const key of keys) {
              if (obj.hasOwnProperty(key) && obj[key]) {
                if (!dayTimesMap.has(d)) dayTimesMap.set(d, []);
                // For tours, times might be in startTime/endTime format
                if (obj.startTime && obj.endTime) {
                  dayTimesMap.get(d).push(`${obj.startTime} - ${obj.endTime}`);
                }
                break;
              }
            }
            if (obj.day === d) {
              if (!dayTimesMap.has(d)) dayTimesMap.set(d, []);
              if (obj.startTime && obj.endTime) {
                dayTimesMap.get(d).push(`${obj.startTime} - ${obj.endTime}`);
              }
            }
          }
        }
        for (const [d, times] of dayTimesMap) {
          result.push({ day: dayAbbrevs[d], times });
        }
        return result;
      }

      // Object with days array
      if (item.availability?.days && Array.isArray(item.availability.days)) {
        item.availability.days.forEach((d) => {
          if (d >= 0 && d <= 6) result.push({ day: dayAbbrevs[d], times: [] });
        });
        return result;
      }

      // Object with day-specific booleans
      if (item.availability && typeof item.availability === 'object') {
        for (let d = 0; d < 7; d++) {
          if (item.availability[dayNamesEn[d]] === true || item.availability[dayNamesEs[d]] === true) {
            result.push({ day: dayAbbrevs[d], times: [] });
          }
        }
        if (result.length > 0) return result;
      }

      return result; // empty = no availability data = "Todos los días"
    };

    // Format arrays to comma-separated strings
    const formatArray = (arr) => {
      if (!arr) return '';
      return Array.isArray(arr) ? arr.join(', ') : arr;
    };

    // Convert minutes to hours and minutes format
    const formatMinutesToTime = (minutes) => {
      if (!minutes || minutes === 0) return 'Inmediata';
      const numMinutes = parseInt(minutes, 10);
      if (isNaN(numMinutes)) return minutes; // Return original if not a number

      const hours = Math.floor(numMinutes / 60);
      const mins = numMinutes % 60;

      if (hours === 0) return `${mins} min`;
      if (mins === 0) return `${hours} hora${hours > 1 ? 's' : ''}`;
      return `${hours} hora${hours > 1 ? 's' : ''} ${mins} min`;
    };

    // Get values from tour object - use same logic as quotes system
    const name = tour.destinationPOI?.name || tour.name || tour.title || 'Tour sin nombre';
    const description = tour.description || '';
    // Tours store duration in 'time' property (minutes), convert to hours like quotes system
    const tourDuration = tour.time ? formatMinutesToTime(parseInt(tour.time, 10)) : null;

    // Handle advance booking time - could be in minutes or already formatted
    const advanceBookingRaw = tour.advanceBookingTime || tour.advance_booking_time || tour.advance_minutes || 'Inmediata';
    const advanceBooking = formatMinutesToTime(advanceBookingRaw);

    const languages = formatArray(tour.languages);
    const includes = formatArray(tour.includes);
    const notIncludes = formatArray(tour.notincludes || tour.notIncludes);

    // Extract all notes types
    const clientNotes = tour.clientNotes || tour.client_booking_notes || '';
    const providerNotes = tour.provider_notes || '';
    const internalNotes = tour.internal_notes || '';
    const teamNotes = tour.team_notes || '';

    // Extract availability schedule using same logic as quotes system
    const availabilitySchedule = extractAvailabilitySchedule(tour);

    // Check if we have any content to show in the bottom section
    const hasBottomContent = includes || notIncludes || clientNotes || providerNotes || internalNotes || teamNotes;

    // Build the card HTML
    body.innerHTML = `
      <h6 class="fw-bold mb-1">${name}</h6>
      ${description ? `<p class="text-muted small mb-2">${description}</p>` : ''}
      <hr class="my-2">
      <div class="d-flex flex-wrap align-items-center mb-2">
        ${tag('clock', tourDuration ? `Mínimo de horas: ${tourDuration}` : null)}
        ${tag('calendar-event', `Reserva anticipada: ${advanceBooking}`)}
        ${tag('language', languages ? `Idiomas: ${languages}` : null)}
      </div>
      <div class="mb-2">
        <span class="small text-muted d-block mb-2"><i class="ti ti-calendar me-1"></i>Recomendamos salir:</span>
        ${renderAvailabilityTable(availabilitySchedule)}
      </div>
      ${hasBottomContent ? '<hr class="my-2">' : ''}
      ${infoLine('circle-check', 'Incluye', includes)}
      ${infoLine('circle-x', 'No incluye', notIncludes)}
      ${infoLine('user', 'Notas Cliente', clientNotes)}
      ${infoLine('building', 'Notas Proveedor', providerNotes)}
      ${infoLine('lock', 'Notas Internas', internalNotes)}
      ${infoLine('users', 'Notas Equipo', teamNotes)}
    `;

    // Show the card
    card.classList.remove('d-none');

    // Hide the schedule fields since we're showing the info in the card
    const scheduleFields = document.getElementById('tourScheduleFields');
    if (scheduleFields) scheduleFields.style.display = 'none';
  }

  hideTourDetailsCard() {
    const card = document.getElementById('tourDetailsCard');
    if (card) card.classList.add('d-none');
  }

  handleTourTransportToggle(checked) {
    // Tour a pie (checked=false): oculta toda la fila de transporte (segmento,
    // vehículo, guía) — no aplica — y muestra la sección de precios por grupo
    // (que ya incluye el selector "cobrar por este tour / toda la experiencia").
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    if (transportFieldsRow) transportFieldsRow.classList.toggle('d-none', !checked);
    const standardPricingSection = document.getElementById('standardPricingSection');
    if (standardPricingSection) standardPricingSection.classList.toggle('d-none', !checked);
    const walkingTourPricingSection = document.getElementById('walkingTourPricingSection');
    if (walkingTourPricingSection) walkingTourPricingSection.classList.toggle('d-none', checked);
  }

  // El selector "#guideDurationMode" solo aplica a tours a pie con la guía marcada.
  updateGuideDurationModeVisibility() {
    // El selector "cobrar por este tour / toda la experiencia" ahora vive dentro de
    // #walkingTourPricingSection, que ya se muestra/oculta con el tipo de tour, así
    // que su visibilidad se maneja sola. (Se mantiene por compatibilidad de llamadas.)
  }

  // "1-5" -> {min:1,max:5}; "16+" -> {min:16,max:Infinity}; otro -> null.
  parseWalkingTourRange(rangeStr) {
    if (!rangeStr) return null;
    const trimmed = String(rangeStr).trim();
    const plusMatch = trimmed.match(/^(\d+)\+/);
    if (plusMatch) return { min: parseInt(plusMatch[1], 10), max: Infinity };
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
    return null;
  }

  // Reparte 'peopleCount' personas en los tramos del tour (rangos vienen del tour;
  // los PRECIOS salen de los inputs editables #walkingPriceSmall/Medium/Large si están,
  // con fallback al precio guardado del tour). Devuelve [{tier, count}].
  calculateWalkingTourGroups(tour, peopleCount) {
    if (!tour) return [];
    const readPrice = (inputId, fallback) => {
      const el = document.getElementById(inputId);
      if (el && el.value !== '' && el.value != null) {
        const v = parseFloat(el.value);
        if (!isNaN(v)) return v;
      }
      return parseFloat(fallback || 0) || 0;
    };

    const tiers = [
      { name: 'Small', label: tour.walkingRangeSmall, range: this.parseWalkingTourRange(tour.walkingRangeSmall), price: readPrice('walkingPriceSmall', tour.walkingPriceSmall) },
      { name: 'Medium', label: tour.walkingRangeMedium, range: this.parseWalkingTourRange(tour.walkingRangeMedium), price: readPrice('walkingPriceMedium', tour.walkingPriceMedium) },
      { name: 'Large', label: tour.walkingRangeLarge, range: this.parseWalkingTourRange(tour.walkingRangeLarge), price: readPrice('walkingPriceLarge', tour.walkingPriceLarge) },
    ].filter((t) => t.range);

    // Tramos ordenados por capacidad máxima descendente.
    const sortedTiers = [...tiers].sort((a, b) => (b.range.max === Infinity ? 999 : b.range.max) - (a.range.max === Infinity ? 999 : a.range.max));

    const groups = [];
    let remaining = peopleCount;
    while (remaining > 0 && sortedTiers.length) {
      let bestTier = null;
      for (const tier of sortedTiers) {
        if (remaining >= tier.range.min) { bestTier = tier; break; }
      }
      if (!bestTier) bestTier = sortedTiers[sortedTiers.length - 1];
      const allocated = Math.min(remaining, bestTier.range.max === Infinity ? remaining : bestTier.range.max);
      groups.push({ tier: bestTier, count: allocated });
      remaining -= allocated;
    }
    return groups;
  }

  // Total del tour a pie: suma del precio de cada grupo asignado × las horas del tour.
  // Usa personas (default 1) + precios editables + horas (#hoursQuantity).
  // Suma de precios de grupo (según personas), SIN multiplicar por tiempo.
  getWalkingPerGroupSum() {
    const tour = this.selectedTourData;
    if (!tour || !tour.isWalkingTour) return 0;
    const peopleCount = Math.max(1, parseInt(document.getElementById('walkingTourPeopleCount')?.value, 10) || 1);
    const groups = this.calculateWalkingTourGroups(tour, peopleCount);
    return groups.reduce((sum, g) => sum + (parseFloat(g.tier.price) || 0), 0);
  }

  // Horas que multiplican al walking tour según el toggle: por el TOUR (sus horas) o
  // por TODA LA EXPERIENCIA (Duración editable del header, o la sugerida si está vacía).
  getWalkingTourHours() {
    const mode = document.getElementById('guideDurationMode')?.value || 'tour';
    if (mode === 'experience') {
      return (parseFloat(document.getElementById('experienceDuration')?.value) / 60) || this.getSuggestedDurationHours();
    }
    return parseFloat(document.getElementById('hoursQuantity')?.value) || 1;
  }

  // Total del tour a pie = suma de grupos × horas (del tour o de la experiencia).
  // El precio de grupo ya incluye la guía; no se suma tarifa de chofer aparte.
  getWalkingTourTotal() {
    if (!this.selectedTourData?.isWalkingTour) return 0;
    return this.getWalkingPerGroupSum() * this.getWalkingTourHours();
  }

  async handleRateSelection(rateId) {
    // Clear price field immediately when rate changes
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.value = '0.00';
    }

    if (!rateId) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // Check service type and delegate to appropriate handler
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;

    if (serviceType === 'transport') {
      // await: si no, handleRateSelection resuelve antes de que carguen los
      // vehículos y el .then() que restaura el vehículo (al editar) corre en vacío.
      await this.handleTransportRateSelection(rateId);
      this.updateWaitingTimeRateDisplay();
      this.updateVehicleCapacityHint();
      return;
    }

    // Tour con vehículo: la lista y el precio salen de tour-prices (no de la
    // tarifa de tiempo de espera).
    if (serviceType === 'tour') {
      this.populateTourVehicleDropdown(rateId);
      return;
    }

    // For non-transport services, use fallback vehicle population
    this.populateVehicleSelectFallback(rateId);
  }

  // Vehículos disponibles para un tour+segmento, desde tour-prices, con su pax.
  populateTourVehicleDropdown(rateId) {
    const select = document.getElementById('vehicleSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar vehículo --</option>';

    const tourId = this.selectedTourData?.id;
    if (!tourId || !rateId) return;

    const prices = this.tourPricesMap.get(`${tourId}_${rateId}`) || [];
    const capacityById = new Map();
    (this.vehiclesCache || []).forEach((v) => capacityById.set(v.id, v.defaultCapacity ?? v.capacity));

    prices.forEach((tp) => {
      if (!tp.vehicleTypeId) return;
      const option = document.createElement('option');
      option.value = tp.vehicleTypeId;
      const name = tp.vehicleType || tp.vehicleTypeId;
      const pax = capacityById.get(tp.vehicleTypeId);
      option.textContent = pax != null ? `${name} - ${pax} pax` : name;
      select.appendChild(option);
    });
    // Picker por capacidad también para tours con vehículo.
    this.renderVehiclePicker();
  }

  // Precio por hora del vehículo para el tour+segmento seleccionados (tour-prices).
  getTourVehiclePrice(vehicleId) {
    const tourId = this.selectedTourData?.id;
    const rateId = document.getElementById('transportCategory')?.value;
    if (!tourId || !rateId || !vehicleId) return null;
    const prices = this.tourPricesMap.get(`${tourId}_${rateId}`) || [];
    const tp = prices.find((p) => p.vehicleTypeId === vehicleId);
    return tp && tp.price != null ? Number(tp.price) : null;
  }

  // Limpia segmento + vehículo + precio (al cambiar de servicio).
  resetSegmentVehiclePrice() {
    const seg = document.getElementById('transportCategory');
    if (seg) seg.value = '';
    this.transportPriceData = null;
    this.clearVehicleDropdown(); // resetea vehicleSelect y pone el precio en 0.00
  }

  async handleTransportRateSelection(rateId, fallbackOrigin = null, fallbackDestination = null) {
    if (!rateId) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // (Simplificado) Origen/Destino vienen directamente de los dos combos del modal.
    // Ya no hay dirección/tipo/ida-vuelta. El origen es opcional: el destino + el
    // segmento bastan para resolver precio y vehículos por ruta.
    const originName = document.getElementById('transportOriginCombo')?.value?.trim()
      || fallbackOrigin || '';
    const destinationName = document.getElementById('transportDestinationCombo')?.value?.trim()
      || fallbackDestination || '';

    if (!destinationName) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    const apiOrigin = originName;
    const apiDestination = destinationName;

    // Show loading spinner next to Vehículo label
    const vehicleSpinner = document.getElementById('vehicleLoadingSpinner');
    vehicleSpinner?.classList.remove('d-none');

    try {
      const params = new URLSearchParams({
        destinationPOI: apiDestination,
        rateId,
      });
      if (apiOrigin) params.append('originPOI', apiOrigin);
      if (this.clientId) {
        params.append('clientId', this.clientId);
      }

      const accessToken = this.getAccessToken();
      const response = await fetch(`/api/services/prices-by-route?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        this.clearVehicleDropdown();
        this.transportPriceData = null;
        return;
      }

      // Cache the transport price data for vehicle selection
      this.transportPriceData = result.data;
      // Cache routeDuration separately so it persists even if transportPriceData is cleared
      this.cachedRouteDuration = result.data.routeDuration || null;
      this.prefillTransportDurationFromRoute();
      this.populateTransportVehicleDropdown(result.data.vehicles);
    } catch (error) {
      console.error('Error looking up transport prices:', error);
      this.clearVehicleDropdown();
      this.transportPriceData = null;
    } finally {
      vehicleSpinner?.classList.add('d-none');
    }
  }

  populateTransportVehicleDropdown(vehicles) {
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
      const clientIndicator = vehicle.isClientPrice ? ' *' : '';
      option.textContent = `${vehicle.vehicleType} - ${pax} pax, ${trunk} carry-on${clientIndicator}`;

      vehicleSelect.appendChild(option);
    });

    // Reset price since no vehicle is selected yet
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.value = '0.00';
    }
    // Renderiza el picker por capacidad con estos vehículos de ruta.
    this.renderVehiclePicker();
  }

  getTransportVehiclePrice(vehicleTypeId) {
    if (!this.transportPriceData || !this.transportPriceData.vehicles) {
      console.log('⚠️ No transport price data available');
      return null;
    }

    const vehicle = this.transportPriceData.vehicles.find(
      (v) => v.vehicleTypeId === vehicleTypeId
    );

    console.log('💰 Getting vehicle price:', {
      vehicleTypeId,
      vehicle: vehicle ? {
        type: vehicle.vehicleType,
        basePrice: vehicle.basePrice,
        clientPrice: vehicle.clientPrice,
        finalPrice: vehicle.finalPrice,
        isClientPrice: vehicle.isClientPrice
      } : 'Not found'
    });

    return vehicle ? vehicle.finalPrice : null;
  }

  handleVehicleSelection(vehicleId) {
    if (!vehicleId) {
      const priceEl = document.getElementById('servicePrice');
      if (priceEl) priceEl.value = '0.00';
      this.updateWaitingTimeRateDisplay();
      return;
    }

    // Don't auto-update price during form population (preserve saved price)
    const isPopulating = this._populatingTransportForm;

    // Check service type to determine pricing behavior
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    const priceEl = document.getElementById('servicePrice');

    if (serviceType === 'transport') {
      // For transport services, use route-based pricing
      let price = this.getTransportVehiclePrice(vehicleId);
      if (priceEl && price !== null && !isPopulating) {
        // Check if round-trip to multiply by 2
        const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        if (tripType === 'round-trip') {
          price = price * 2;
        }
        priceEl.value = price.toFixed(2);
      } else if (priceEl && !isPopulating) {
        priceEl.value = '0.00';
      }
    } else {
      // For non-transport services, use fallback pricing logic
      if (this.transportPriceData && this.transportPriceData.vehicles) {
        const vehicle = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === vehicleId);
        if (vehicle && priceEl) {
          priceEl.value = vehicle.finalPrice || '0.00';
        }
      } else if (priceEl && !isPopulating) {
        // Tour: el input de Precio muestra el BASE (precio por hora de tour-prices);
        // el total (base × horas) se muestra aparte vía updateServiceTotal().
        const base = this.getTourVehiclePrice(vehicleId);
        if (base != null) priceEl.value = base.toFixed(2);
      }
    }

    this.updateWaitingTimeRateDisplay();
    this.updateServiceTotal();
  }

  // Muestra el Total (base × multiplicador) para servicios no-experiencia.
  // Tour: base × horas. Concepto: base × cantidad. Transporte: base × (1 ó 2 vehículos).
  updateServiceTotal() {
    const totalRow = document.getElementById('serviceTotalRow');
    const totalEl = document.getElementById('serviceTotalDisplay');
    if (!totalRow || !totalEl) return;

    const type = this.currentServiceType;
    if (type !== 'tour' && type !== 'concepto' && type !== 'entradas' && type !== 'transport') {
      totalRow.classList.add('d-none');
      return;
    }
    // El total ya NO se muestra en el panel de alta (a pedido): fila siempre oculta.
    // Se conserva el cálculo por sus efectos (p. ej. hint de duración del transporte).
    totalRow.classList.add('d-none');

    const base = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    const currency = document.getElementById('currencySymbol')?.textContent || 'MXN';
    let total = base;
    let detail = '';

    if (type === 'tour' && this.selectedTourData?.isWalkingTour) {
      // Tour a pie: total = suma de precios por grupo (según personas) × horas
      // (del tour o de toda la experiencia, según el toggle).
      const peopleCount = Math.max(1, parseInt(document.getElementById('walkingTourPeopleCount')?.value, 10) || 1);
      const hours = this.getWalkingTourHours();
      total = this.getWalkingTourTotal();
      const groups = this.calculateWalkingTourGroups(this.selectedTourData, peopleCount);
      const tierParts = groups.map((g) => `${g.tier.label || g.tier.name}: $${(parseFloat(g.tier.price) || 0).toFixed(2)}`);
      detail = ` (${peopleCount} pax × ${hours} h${tierParts.length ? ` — ${tierParts.join(', ')}` : ''})`;
    } else if (type === 'tour') {
      const hours = parseFloat(document.getElementById('hoursQuantity')?.value) || 1;
      const vq = Math.max(1, parseInt(document.getElementById('vehicleCount')?.value, 10) || 1);
      total = base * vq * hours;
      detail = ` ($${base.toFixed(2)}${vq > 1 ? ` × ${vq} veh.` : ''} × ${hours} h)`;
    } else if (type === 'concepto' || type === 'entradas') {
      const qty = parseInt(document.getElementById('serviceQuantity')?.value, 10) || 1;
      total = base * qty;
      if (qty > 1) detail = ` ($${base.toFixed(2)} × ${qty})`;
    } else if (type === 'transport') {
      const round = document.getElementById('transportRoundTrip')?.checked || false;
      const qty = Math.max(1, parseInt(document.getElementById('vehicleCount')?.value, 10) || 1);
      const roundMult = round ? 2 : 1;
      total = base * qty * roundMult;
      const parts = [];
      if (qty > 1) parts.push(`${qty} veh.`);
      if (round) parts.push('redondo ×2');
      if (parts.length) detail = ` ($${base.toFixed(2)} × ${parts.join(' × ')})`;
      // Mantén el hint de duración sincronizado (aplica ×2 si es redondo).
      this.getTransportDurationHours();
    }

    // Sumar guía/greeter (según tipo + checkboxes).
    const { guide, greeter } = this.getGuideGreeterCost();
    // Round-trip de transporte: guía y greeter también se doblan (×2), igual que el base.
    const extrasMult = (type === 'transport' && document.getElementById('transportRoundTrip')?.checked) ? 2 : 1;
    const guideT = guide * extrasMult;
    const greeterT = greeter * extrasMult;
    total += guideT + greeterT;
    const extras = [];
    if (guideT > 0) extras.push(`guía $${guideT.toFixed(2)}`);
    if (greeterT > 0) extras.push(`greeter $${greeterT.toFixed(2)}`);
    if (extras.length) detail += ` + ${extras.join(' + ')}`;

    totalEl.textContent = `$${total.toFixed(2)} ${currency}${detail}`;
  }

  handleIncludeGuideChange(checked) {
    if (checked) {
      const greeter = document.getElementById('includeGreeter');
      if (greeter) {
        greeter.checked = false;
        this.handleIncludeGreeterChange(false);
      }
    }
  }

  handleIncludeGreeterChange(checked) {
    if (checked) {
      const guide = document.getElementById('includeGuide');
      if (guide) guide.checked = false;
    }
    const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
    const greeterInVehicle = document.getElementById('greeterInVehicle');
    if (greeterInVehicleContainer) {
      greeterInVehicleContainer.classList.toggle('d-none', !checked);
    }
    if (greeterInVehicle) {
      greeterInVehicle.checked = checked;
    }
  }

  // Capacidad (pax) de un tipo de vehículo. Busca en vehiclesCache, en los datos de
  // ruta (transportPriceData.vehicles) y en vehicleTypesMap, porque según el flujo el
  // vehículo puede venir de distintas fuentes.
  getVehicleCapacity(vehicleId) {
    if (!vehicleId) return 0;
    const v = (this.vehiclesCache || []).find((x) => x.id === vehicleId);
    if (v) return Number(v.defaultCapacity ?? v.capacity ?? 0) || 0;
    const rv = this.transportPriceData?.vehicles?.find((x) => x.vehicleTypeId === vehicleId);
    if (rv && rv.capacity != null) return Number(rv.capacity) || 0;
    const vt = this.vehicleTypesMap?.get(vehicleId);
    if (vt) return Number(vt.defaultCapacity ?? vt.capacity ?? 0) || 0;
    return 0;
  }

  // Muestra la capacidad combinada (capacidad del vehículo × cantidad) vs el Máx de pax
  // de la experiencia, y sugiere cuántos vehículos hacen falta si no alcanza.
  updateVehicleCapacityHint() {
    const hintEl = document.getElementById('vehicleCapacityHint');
    if (!hintEl) return;
    const vehicleId = document.getElementById('vehicleSelect')?.value;
    const count = Math.max(1, parseInt(document.getElementById('vehicleCount')?.value, 10) || 1);
    const maxPax = parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || 0;
    if (!vehicleId) { hintEl.textContent = ''; hintEl.style.color = ''; return; }
    const cap = this.getVehicleCapacity(vehicleId);
    if (!cap) { hintEl.textContent = ''; hintEl.style.color = ''; return; }
    const totalCap = cap * count;
    let msg = `Capacidad: ${cap}${count > 1 ? ` × ${count} = ${totalCap}` : ''} pax`;
    if (maxPax > 0 && totalCap >= maxPax) {
      msg += ` · cubre ${maxPax} pax ✓`;
      hintEl.style.color = '#4b7a3f';
    } else if (maxPax > 0) {
      msg += ` · no cubre ${maxPax} pax (sugerido: ${Math.ceil(maxPax / cap)}) ✗`;
      hintEl.style.color = '#c0563f';
    } else {
      hintEl.style.color = '';
    }
    hintEl.textContent = msg;
  }

  // Vehículos disponibles para el picker según el tipo de servicio actual, normalizados
  // a {vehicleTypeId, name, cap, unit}. Transporte: por ruta (finalPrice). Tour: de
  // tour-prices (precio por hora) + capacidad de vehiclesCache.
  getPickerVehicles() {
    const type = this.currentServiceType;
    if (type === 'transport') {
      return (this.transportPriceData?.vehicles || []).map((v) => ({
        vehicleTypeId: v.vehicleTypeId, name: v.vehicleType || 'Vehículo',
        cap: Number(v.capacity) || 0, unit: Number(v.finalPrice) || 0,
      }));
    }
    if (type === 'tour') {
      const tourId = this.selectedTourData?.id;
      const rateId = document.getElementById('transportCategory')?.value;
      if (!tourId || !rateId) return [];
      const prices = this.tourPricesMap.get(`${tourId}_${rateId}`) || [];
      const capById = new Map();
      (this.vehiclesCache || []).forEach((v) => capById.set(v.id, v.defaultCapacity ?? v.capacity));
      return prices.filter((tp) => tp.vehicleTypeId).map((tp) => ({
        vehicleTypeId: tp.vehicleTypeId, name: tp.vehicleType || tp.vehicleTypeId,
        cap: Number(capById.get(tp.vehicleTypeId)) || 0, unit: Number(tp.price) || 0,
      }));
    }
    return [];
  }

  // Los tours multiplican el precio por horas; transporte no.
  pickerHoursMult() {
    if (this.currentServiceType === 'tour') {
      return Math.max(1, parseFloat(document.getElementById('hoursQuantity')?.value) || 1);
    }
    return 1;
  }

  // Picker de vehículos por capacidad: opciones normalizadas (transporte o tour), calcula
  // cuántas unidades cubren el Máx de pax (count = ceil(maxPax/capacidad)) y su costo
  // (unit × count × horas). Ordena por precio y marca la más barata que cubre.
  renderVehiclePicker() {
    const wrap = document.getElementById('vehiclePicker');
    const list = document.getElementById('vehiclePickerList');
    const vehCol = document.getElementById('transportVehicleCol');
    if (!wrap || !list) return;

    const vehicles = this.getPickerVehicles();
    const hoursMult = this.pickerHoursMult();
    if (!vehicles.length) {
      wrap.classList.add('d-none');
      list.innerHTML = '';
      if (vehCol) vehCol.classList.remove('d-none');
      return;
    }
    wrap.classList.remove('d-none');
    if (vehCol) vehCol.classList.add('d-none');

    const maxPax = parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || 0;
    const currentVehicleId = document.getElementById('vehicleSelect')?.value || '';

    const opts = vehicles.map((v) => {
      const cap = Number(v.cap) || 0;
      const unit = Number(v.unit) || 0;
      const count = (maxPax > 0 && cap > 0) ? Math.max(1, Math.ceil(maxPax / cap)) : 1;
      return {
        vehicleTypeId: v.vehicleTypeId,
        name: v.name || 'Vehículo',
        cap, unit, count,
        totalCap: cap * count,
        total: unit * count * hoursMult,
        covers: cap > 0 && (cap * count) >= (maxPax || 1),
      };
    }).sort((a, b) => a.total - b.total);

    const bestIdx = opts.findIndex((o) => o.covers);
    list.innerHTML = '';
    opts.forEach((o, i) => {
      const active = o.vehicleTypeId === currentVehicleId;
      const countTxt = o.count > 1 ? `${o.count} × ` : '';
      const capTxt = o.count > 1 ? `${o.cap} ×${o.count} = ${o.totalCap}` : `${o.cap}`;
      const best = i === bestIdx ? ' <small class="veh-pick-opt__best">recomendado</small>' : '';
      const label = document.createElement('label');
      label.className = 'veh-pick-opt' + (active ? ' active' : '');
      // Orden de info (mockup): [radio] Nombre (+nota) · badge capacidad · precio a la derecha.
      label.innerHTML = `
        <input type="radio" name="vehPick" ${active ? 'checked' : ''}>
        <span class="veh-pick-opt__name">${countTxt}${o.name}${best}</span>
        <span class="veh-pick-opt__cap">${capTxt} pax</span>
        <span class="veh-pick-opt__price">$${o.total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
      label.addEventListener('click', () => this.selectVehiclePickerOption(o));
      list.appendChild(label);
    });
  }

  selectVehiclePickerOption(o) {
    const vehicleSelect = document.getElementById('vehicleSelect');
    const vehicleCount = document.getElementById('vehicleCount');
    const priceEl = document.getElementById('servicePrice');
    if (vehicleSelect) vehicleSelect.value = o.vehicleTypeId;
    if (vehicleCount) vehicleCount.value = o.count;
    if (priceEl) priceEl.value = Number(o.unit).toFixed(2);
    this.renderVehiclePicker();
    this.updateServiceTotal();
    this.updateVehicleCapacityHint();
  }

  // --- Picker INLINE directo en cada tarjeta de servicio con vehículo (sin botón). ---
  // Se llama tras renderServices: por cada transporte/tour con vehículo puebla su picker.
  async populateCardPickers() {
    // Transporte inline: SIEMPRE (aunque no tenga vehículo aún, para mostrar el segmento).
    // Tour con vehículo (no a pie) con tour elegido: también, para mostrar segmento aunque
    // aún no haya vehículo. Los tours a pie no llevan picker.
    const svcs = [...this.services.values()].filter((s) => s.type === 'transport' || (s.type === 'tour' && !s.isWalkingTour && s.tourId));
    for (const s of svcs) {
      const container = document.querySelector(`.card-veh-picker[data-service-id="${s.id}"]`);
      if (!container) continue;
      if (!container.dataset.loaded) {
        container.innerHTML = '<div class="text-muted small py-1"><span class="spinner-border spinner-border-sm me-1"></span>Cargando vehículos…</div>';
      }
      // eslint-disable-next-line no-await-in-loop
      const vehicles = await this.getCardVehiclesCached(s);
      this.renderCardVehiclePicker(s.id, container, vehicles);
      container.dataset.loaded = '1';
    }
    // Ya con la caché de vehículos caliente, recalcula el desglose: así transporte y tour
    // usan la prioridad "1 vehículo que cubra" en vez del fallback (mismo vehículo × cantidad).
    if (svcs.length) this.renderBreakdown();
  }

  // Caché de vehículos por ruta (transporte) para no re-fetchear en cada render.
  async getCardVehiclesCached(service) {
    if (service.type === 'tour') return this.getCardVehicles(service);
    const key = `${service.originName || ''}|${service.destinationName || ''}|${service.rateId || ''}`;
    if (!this._cardVehCache) this._cardVehCache = new Map();
    if (this._cardVehCache.has(key)) return this._cardVehCache.get(key);
    const vs = await this.getCardVehicles(service);
    this._cardVehCache.set(key, vs);
    return vs;
  }

  // Vehículos disponibles para una tarjeta guardada, normalizados {vehicleTypeId, name, cap, unit}.
  // Transporte: por ruta (fetch). Tour: de tour-prices ya cargados (precio por hora).
  async getCardVehicles(service) {
    const capById = new Map();
    (this.vehiclesCache || []).forEach((v) => capById.set(v.id, v.defaultCapacity ?? v.capacity));
    if (service.type === 'transport') {
      const vs = await this.fetchRouteVehicles(service.originName, service.destinationName, service.rateId);
      return vs.map((v) => ({
        vehicleTypeId: v.vehicleTypeId, name: v.vehicleType || 'Vehículo',
        cap: Number(v.capacity) || 0, unit: Number(v.finalPrice) || 0,
      }));
    }
    if (service.type === 'tour') {
      const prices = this.tourPricesMap.get(`${service.tourId}_${service.rateId}`) || [];
      return prices.filter((tp) => tp.vehicleTypeId).map((tp) => ({
        vehicleTypeId: tp.vehicleTypeId, name: tp.vehicleType || tp.vehicleTypeId,
        cap: Number(capById.get(tp.vehicleTypeId)) || 0, unit: Number(tp.price) || 0,
      }));
    }
    return [];
  }

  async fetchRouteVehicles(originName, destinationName, rateId) {
    if (!destinationName || !rateId) return [];
    try {
      const params = new URLSearchParams({ destinationPOI: destinationName, rateId });
      if (originName) params.append('originPOI', originName);
      if (this.clientId) params.append('clientId', this.clientId);
      const accessToken = this.getAccessToken();
      const res = await fetch(`/api/services/prices-by-route?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken || ''}` },
      });
      if (!res.ok) return [];
      const result = await res.json();
      if (result.success && result.data) {
        // Cachea la DURACIÓN de la ruta (minutos) para autollenar el campo de duración.
        if (!this._routeDurationCache) this._routeDurationCache = {};
        const key = `${originName || ''}|${destinationName || ''}|${rateId || ''}`;
        this._routeDurationCache[key] = (result.data.routeDuration != null) ? result.data.routeDuration : null;
        return result.data.vehicles || [];
      }
      return [];
    } catch (e) {
      console.warn('No se pudieron cargar vehículos de la ruta:', e);
      return [];
    }
  }

  renderCardVehiclePicker(serviceId, container, vehicles) {
    const service = this.services.get(serviceId);
    if (!service) return;
    // Selector de segmento: SIEMPRE presente (aunque no haya vehículos, para poder cambiarlo).
    const rates = (this.ratesCache || []).filter((r) => {
      if (service.type !== 'tour') return true;
      return !((r.label || r.name || '').toLowerCase().includes('econ'));
    });
    const segHtml = rates.length ? `
      <div class="card-seg d-flex align-items-center gap-2 mb-2">
        <span class="text-muted small fw-semibold">Segmento</span>
        <select class="form-select form-select-sm card-seg-select" style="max-width:200px;">
          ${rates.map((r) => `<option value="${r.id}" ${r.id === service.rateId ? 'selected' : ''}>${r.label || r.name}</option>`).join('')}
        </select>
      </div>` : '';
    const wireSeg = () => {
      const segEl = container.querySelector('.card-seg-select');
      if (segEl) segEl.addEventListener('change', (e) => this.changeCardSegment(serviceId, e.target.value));
    };

    if (!vehicles.length) {
      container.innerHTML = segHtml + '<div class="text-muted small py-1">Sin vehículos disponibles para este segmento.</div>';
      wireSeg();
      return;
    }

    // Ya NO hay picker de radios en la tarjeta: el vehículo se elige POR COLUMNA en el
    // desglose. Aquí solo se asegura un vehículo BASE (el recomendado por el Máx de pax) si el
    // servicio aún no tiene uno válido para este segmento, para que el desglose tenga de dónde
    // partir. La tarjeta solo muestra el selector de Segmento.
    const maxPax = parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || 0;
    const hoursMult = service.type === 'tour' ? (Number(service.hours) || 1) : 1;
    const rtMult = service.roundTrip ? 2 : 1;
    const opts = vehicles.map((v) => {
      const cap = Number(v.cap) || 0;
      const unit = Number(v.unit) || 0;
      const count = (maxPax > 0 && cap > 0) ? Math.max(1, Math.ceil(maxPax / cap)) : 1;
      return { vehicleTypeId: v.vehicleTypeId, name: v.name || 'Vehículo', cap, unit, count, covers: cap > 0 && (cap * count) >= (maxPax || 1) };
    }).sort((a, b) => (a.unit * a.count * hoursMult) - (b.unit * b.count * hoursMult));

    const hasValid = service.vehicleId && vehicles.some((v) => v.vehicleTypeId === service.vehicleId);
    if (!hasValid) {
      const rec = opts.find((o) => o.covers) || opts[0];
      if (rec) {
        const oldVehCost = (Number(service.unitPrice) || 0) * (Number(service.vehicleCount) || 1) * hoursMult * rtMult;
        const nonVehicle = Math.max(0, (Number(service.price) || 0) - oldVehCost); // guía/greeter
        service.vehicleId = rec.vehicleTypeId;
        service.vehicleType = rec.vehicleTypeId;
        service.vehicleTypeName = rec.name;
        service.vehicleCount = rec.count;
        service.unitPrice = rec.unit;
        service.price = (rec.unit * rec.count * hoursMult * rtMult) + nonVehicle;
      }
    }

    container.innerHTML = segHtml;
    wireSeg();
  }

  // Cambia el segmento de un servicio guardado desde la tarjeta: recarga los vehículos
  // de ese segmento y auto-selecciona el recomendado (para no quedar con precio inválido).
  async changeCardSegment(serviceId, rateId) {
    const service = this.services.get(serviceId);
    if (!service) return;
    service.rateId = rateId;
    // Cambia el segmento → cambia el set de vehículos: limpia los overrides por columna del
    // desglose (referencian vehículos del segmento anterior).
    service.vehicleByPax = null;
    const rate = (this.ratesCache || []).find((r) => r.id === rateId);
    if (rate) service.rateName = rate.label || rate.name;
    const container = document.querySelector(`.card-veh-picker[data-service-id="${serviceId}"]`);
    if (!container) return;
    container.innerHTML = '<div class="text-muted small py-1"><span class="spinner-border spinner-border-sm me-1"></span>Cargando vehículos…</div>';
    // Limpia la caché del par ruta+segmento anterior no hace falta: la key incluye rateId.
    const vehicles = await this.getCardVehiclesCached(service);
    this.applyRouteDurationToService(service); // autollena la duración de la ruta (solo transporte)
    if (vehicles.length) {
      const maxPax = parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || 0;
      const hoursMult = service.type === 'tour' ? (Number(service.hours) || 1) : 1;
      const opts = vehicles.map((v) => {
        const cap = Number(v.cap) || 0;
        const unit = Number(v.unit) || 0;
        const count = (maxPax > 0 && cap > 0) ? Math.max(1, Math.ceil(maxPax / cap)) : 1;
        return { vehicleTypeId: v.vehicleTypeId, name: v.name || 'Vehículo', cap, unit, count, total: unit * count * hoursMult, covers: cap > 0 && (cap * count) >= (maxPax || 1) };
      }).sort((a, b) => a.total - b.total);
      const rec = opts.find((o) => o.covers) || opts[0];
      if (rec) { this.applyCardVehicleChange(serviceId, rec); return; }
    }
    // Sin vehículos en el nuevo segmento: solo re-renderiza y guarda el cambio de rate.
    this.renderCardVehiclePicker(serviceId, container, vehicles);
    this.scheduleAutoSave();
  }

  applyCardVehicleChange(serviceId, o) {
    const service = this.services.get(serviceId);
    if (!service) return;
    const hours = service.type === 'tour' ? (Number(service.hours) || 1) : 1;
    const rtMult = service.roundTrip ? 2 : 1;
    // Preserva la porción no-vehículo (guía + greeter) del precio actual.
    const oldVehicleCost = (Number(service.unitPrice) || 0) * (Number(service.vehicleCount) || 1) * hours * rtMult;
    const nonVehicle = Math.max(0, (Number(service.price) || 0) - oldVehicleCost);
    service.vehicleId = o.vehicleTypeId;
    service.vehicleType = o.vehicleTypeId;
    service.vehicleTypeName = o.name;
    service.vehicleCount = o.count;
    service.unitPrice = o.unit;
    service.price = (o.unit * o.count * hours * rtMult) + nonVehicle;
    this.renderServices();
    this.updateTotals();
    this.scheduleAutoSave();
  }

  // ===== DESGLOSE POR PAX =====
  // El walking tour de San Miguel de Allende (único) que da el precio de la GUÍA global.
  getSmaWalkingTour() {
    let found = null;
    this.toursCache.forEach((t) => {
      if (found || !t || !t.isWalkingTour) return;
      const dest = (t.destinationPOI && t.destinationPOI.name) || t.name || '';
      if (dest.toLowerCase().includes('san miguel')) found = t;
    });
    return found;
  }

  // Precio de la guía a N pax = precio por grupo del walking tour SMA (según sus rangos
  // S/M/L y sus propios precios). Devuelve null si no se encontró el tour (fallback manual).
  smaWalkingGuidePrice(pax) {
    const tour = this.getSmaWalkingTour();
    if (!tour) return null;
    const people = Math.max(1, Number(pax) || 1);
    const tiers = [
      { range: this.parseWalkingTourRange(tour.walkingRangeSmall), price: Number(tour.walkingPriceSmall) || 0 },
      { range: this.parseWalkingTourRange(tour.walkingRangeMedium), price: Number(tour.walkingPriceMedium) || 0 },
      { range: this.parseWalkingTourRange(tour.walkingRangeLarge), price: Number(tour.walkingPriceLarge) || 0 },
    ].filter((t) => t.range);
    if (!tiers.length) return null;
    const sorted = [...tiers].sort((a, b) => (b.range.max === Infinity ? 999 : b.range.max) - (a.range.max === Infinity ? 999 : a.range.max));
    const groups = [];
    let remaining = people;
    while (remaining > 0 && sorted.length) {
      let best = null;
      for (const t of sorted) { if (remaining >= t.range.min) { best = t; break; } }
      if (!best) best = sorted[sorted.length - 1];
      const alloc = Math.min(remaining, best.range.max === Infinity ? remaining : best.range.max);
      groups.push(best);
      remaining -= alloc;
    }
    return groups.reduce((s, g) => s + (Number(g.price) || 0), 0);
  }

  // Costo general (guía + chofer) a N pax. GUÍA = precio por grupo del walking tour SMA
  // (varía por pax); si no se encontró el tour, cae a la tarifa manual × duración. CHOFER =
  // tarifa manual × duración (fijo). El desglose lo evalúa por columna.
  // Guía a N pax: precio de grupo del walking SMA × horas (× duración). Fallback sin tour:
  // tarifa manual ($/h) × horas. 0 si NINGÚN servicio tiene guía.
  generalGuideAtPax(pax) {
    if (![...this.services.values()].some((s) => s.includeGuide)) return 0;
    const hrs = this.generalGuideHours();
    const sma = this.smaWalkingGuidePrice(pax);
    if (sma != null) return sma * hrs; // precio del tier × horas
    const gRate = parseFloat(document.getElementById('generalGuideRate')?.value) || 0;
    return gRate * hrs;
  }

  // Horas que multiplican la guía: si TODOS los servicios llevan guía → duración de la
  // experiencia. Si solo ALGUNOS → suma de las duraciones de esos servicios.
  generalGuideHours() {
    return this.generalRoleHours('includeGuide');
  }

  // Chofer (fijo): tarifa × horas. La tarifa sale de Ajustes (Guía+Chofer = driver-tour-rate,
  // en driverTourRateCache); si no hay, cae al input manual. 0 si NINGÚN servicio tiene chofer.
  generalChoferFixed() {
    if (![...this.services.values()].some((s) => s.includeChofer)) return 0;
    return this.generalChoferRate() * this.generalRoleHours('includeChofer');
  }

  // Horas para guía/chofer general según el campo (includeGuide/includeChofer):
  //  - TODOS los servicios con ese rol → duración de la experiencia (si está definida).
  //  - Solo ALGUNOS → suma de las duraciones de los servicios que lo tienen.
  generalRoleHours(field) {
    const svcs = [...this.services.values()];
    const withRole = svcs.filter((s) => s[field]);
    if (!withRole.length) return 0;
    if (withRole.length === svcs.length) {
      const expHrs = (parseFloat(document.getElementById('experienceDuration')?.value) || 0) / 60;
      if (expHrs > 0) return expHrs;
    }
    return withRole.reduce((sum, s) => sum + (Number(this.getServiceDurationHours(s)) || 0), 0);
  }

  // Tarifa de chofer: de Ajustes (driver-tour-rate) si existe (> 0); si no, el input manual.
  generalChoferRate() {
    const settingsRate = Number(this.driverTourRateCache && this.driverTourRateCache.value);
    if (Number.isFinite(settingsRate) && settingsRate > 0) return settingsRate;
    return parseFloat(document.getElementById('generalChoferRate')?.value) || 0;
  }

  generalCostAtPax(pax) {
    return this.generalGuideAtPax(pax) + this.generalChoferFixed();
  }

  // La guía/chofer GENERAL solo tiene sentido si algún servicio la lleva. Si NINGÚN servicio
  // tiene guía → se APAGA (ya no es válida) PERO queda clickeable para reactivarla (al
  // prenderla de nuevo se marca en todos los servicios). Idem chofer. Se llama al cambiar los
  // checkboxes por servicio, al agregar/borrar y al cargar.
  syncGeneralTogglesFromServices() {
    const svcs = [...this.services.values()];
    const nGuide = svcs.filter((s) => s.includeGuide).length;
    const nChofer = svcs.filter((s) => s.includeChofer).length;
    const gt = document.getElementById('generalGuideToggle');
    const ct = document.getElementById('generalChoferToggle');
    // El toggle "general" refleja si aplica a TODA la experiencia: prendido SOLO si TODOS los
    // servicios lo tienen; si alguno no (o ninguno), se apaga (la guía/chofer sigue aplicando a
    // los servicios que sí lo tengan — el desglose lo respeta por servicio).
    if (gt) { gt.disabled = false; gt.checked = (svcs.length > 0 && nGuide === svcs.length); }
    if (ct) { ct.disabled = false; ct.checked = (svcs.length > 0 && nChofer === svcs.length); }
  }

  // Compat: costo general "fijo" (usa el Máx de capacidad para un valor representativo).
  generalCostFixed() {
    const maxPax = parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || 1;
    return this.generalCostAtPax(maxPax);
  }

  // Refleja el origen de las tarifas generales en la barra:
  //  - Guía: si existe el walking tour SMA, sale de ahí (por pax) → oculta el input manual.
  //  - Chofer: si hay tarifa en Ajustes (driver-tour-rate) → oculta el input manual.
  // En ambos casos muestra el indicador correspondiente; el input queda solo como fallback.
  updateGuideRateSource() {
    const hasSma = !!this.getSmaWalkingTour();
    const gGroup = document.getElementById('generalGuideRateGroup');
    const gHint = document.getElementById('generalGuideSmaHint');
    if (gGroup) gGroup.classList.toggle('d-none', hasSma);
    if (gHint) gHint.classList.toggle('d-none', !hasSma);

    const settingsRate = Number(this.driverTourRateCache && this.driverTourRateCache.value);
    const hasChoferSetting = Number.isFinite(settingsRate) && settingsRate > 0;
    const cGroup = document.getElementById('generalChoferRateGroup');
    const cHint = document.getElementById('generalChoferSettingsHint');
    if (cGroup) cGroup.classList.toggle('d-none', hasChoferSetting);
    if (cHint) cHint.classList.toggle('d-none', !hasChoferSetting);
  }

  // Costo de un servicio a N pax. Experiencia = por persona (× pax); el resto = fijo.
  // Costo de un servicio a N pax + nota. Experiencia = por persona (× pax). Transporte/
  // tour con vehículo = base × (vehículos que caben: ceil(pax/cap)) [× horas para tour],
  // preservando guía/greeter. El resto = fijo.
  serviceAtPax(service, pax, overrideVehId) {
    const p = Math.max(1, pax);
    if (service.type === 'experience') {
      const perPerson = this.calculateServicePrice({
        ...service, adultsQuantity: 0, childrenQuantity: 0, adultsNoAlcoholQuantity: 0,
      });
      return { cost: perPerson * p, note: '' };
    }
    // Entradas: un boleto POR PERSONA → precio × pax (varía por columna).
    if (service.type === 'entradas') {
      return { cost: (Number(service.price) || 0) * p, note: '' };
    }
    // Concepto: según la casilla "Por persona" → precio × pax; si no, precio fijo (una vez).
    if (service.type === 'concepto') {
      const price = Number(service.price) || 0;
      return { cost: service.perPax ? price * p : price, note: '' };
    }
    const hasVehicle = (service.type === 'transport' || service.type === 'tour') && service.vehicleId;
    const cap = hasVehicle ? this.getVehicleCapacity(service.vehicleId) : 0;
    if (hasVehicle && cap > 0 && service.unitPrice != null) {
      const base = Number(service.unitPrice) || 0;
      const savedCount = Number(service.vehicleCount) || 1;
      const hours = service.type === 'tour' ? (Number(service.hours) || 1) : 1;
      const rtMult = service.roundTrip ? 2 : 1;
      const savedVehicleCost = base * savedCount * hours * rtMult;
      const nonVehicle = Math.max(0, (Number(service.price) || 0) - savedVehicleCost); // guía/greeter

      let unit = base;
      let count = Math.max(1, Math.ceil(p / cap));
      let name = service.vehicleTypeName || 'Vehículo';
      let vehId = service.vehicleId;
      const options = this.getVehiclesForServiceSync(service);
      const chosen = overrideVehId ? options.find((o) => o.vehicleTypeId === overrideVehId) : null;

      if (chosen) {
        // Override manual por columna (elegido en el desglose): N de ese tipo para cubrir p.
        unit = Number(chosen.unit) || 0;
        count = Math.max(1, Math.ceil(p / (Number(chosen.cap) || 1)));
        name = chosen.name;
        vehId = chosen.vehicleTypeId;
      } else if (options.length) {
        // Default por columna: el vehículo de MENOR capacidad que CUBRA los pax (1 pax → cap 2;
        // si no hay de 2, el de 4; etc.), desempatando por precio. Si NINGÚN vehículo solo cubre
        // los pax, la combinación más barata (varios). NUNCA el más grande por default.
        const singles = options.filter((o) => o.cap >= p).sort((a, b) => (a.cap - b.cap) || (a.unit - b.unit));
        if (singles.length) {
          unit = singles[0].unit; count = 1; name = singles[0].name; vehId = singles[0].vehicleTypeId;
        } else {
          const multi = options
            .map((o) => ({ ...o, count: Math.max(1, Math.ceil(p / (Number(o.cap) || 1))) }))
            .sort((a, b) => (a.unit * a.count) - (b.unit * b.count))[0];
          unit = multi.unit; count = multi.count; name = multi.name; vehId = multi.vehicleTypeId;
        }
      }
      const cost = (unit * count * hours * rtMult) + nonVehicle;
      return { cost, note: `${count > 1 ? count + '× ' : ''}${name}`, vehId, count };
    }
    return { cost: this.calculateServicePrice(service), note: '' };
  }

  // Vehículos disponibles (sincrónico) para el desglose: tour desde tourPricesMap; transporte
  // desde la caché de ruta (_cardVehCache, poblada por el picker). Normalizados {name,cap,unit}.
  getVehiclesForServiceSync(service) {
    const capById = new Map();
    (this.vehiclesCache || []).forEach((v) => capById.set(v.id, v.defaultCapacity ?? v.capacity));
    if (service.type === 'tour') {
      const prices = this.tourPricesMap.get(`${service.tourId}_${service.rateId}`) || [];
      return prices
        .filter((tp) => tp.vehicleTypeId)
        .map((tp) => ({
          vehicleTypeId: tp.vehicleTypeId,
          name: tp.vehicleType || tp.vehicleTypeId,
          cap: Number(capById.get(tp.vehicleTypeId)) || 0,
          unit: Number(tp.price) || 0,
        }))
        .filter((o) => o.cap > 0);
    }
    if (service.type === 'transport') {
      const key = `${service.originName || ''}|${service.destinationName || ''}|${service.rateId || ''}`;
      const vs = (this._cardVehCache && this._cardVehCache.get(key)) || null;
      return vs ? vs.filter((o) => o.cap > 0) : [];
    }
    return [];
  }

  renderBreakdown() {
    const container = document.getElementById('serviceBreakdown');
    if (!container) return;
    // Refleja en la barra si la guía sale del walking tour SMA (oculta la tarifa manual).
    this.updateGuideRateSource();
    const services = [...this.services.values()];
    if (!services.length) {
      container.innerHTML = '<div class="form-text mt-1">Agrega servicios para ver los precios por pax.</div>';
      return;
    }

    const minPax = Math.max(1, parseInt(document.getElementById('experienceMinPeople')?.value, 10) || 1);
    const maxPax = Math.max(minPax, parseInt(document.getElementById('experienceMaxPeople')?.value, 10) || minPax);
    // Columna intermedia: editable por el usuario (this.breakdownMidPax); si no, punto medio.
    // Se acota a [Mín, Máx] para no romper el orden de columnas.
    const defaultMid = Math.round((minPax + maxPax) / 2);
    const mid = Math.min(maxPax, Math.max(minPax, this.breakdownMidPax != null ? this.breakdownMidPax : defaultMid));
    // Columnas: Mín · intermedio · Máx (sin duplicar si coinciden).
    const cols = [...new Set([minPax, mid, maxPax])];
    const last = cols.length - 1;
    const midIdx = cols.length === 3 ? 1 : -1; // índice de la columna intermedia editable
    const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const colLabel = (p, i) => `${cols.length > 1 && i === 0 ? 'Mín · ' : (cols.length > 1 && i === last ? 'Máx · ' : '')}${p} pax`;

    const rows = [];
    // Guía y Chofer generales: LÍNEAS SEPARADAS. Se muestran si ALGÚN servicio los tiene
    // (todos → × duración de la experiencia; algunos → × suma de duraciones de esos servicios).
    const guideOn = services.some((s) => s.includeGuide);
    const choferOn = services.some((s) => s.includeChofer);
    // Ámbito: "general" si TODOS los servicios lo tienen; si no, la lista de los servicios
    // que sí lo tienen marcado.
    const scopeLabel = (field) => {
      const withRole = services.filter((s) => s[field]);
      if (withRole.length === services.length) return 'general';
      return withRole.map((s) => s.concept || this.getServiceTitle(s)).join(', ');
    };
    if (guideOn) {
      const guideFromSma = !!this.getSmaWalkingTour();
      const label = (guideFromSma ? 'Guía (walking SMA)' : 'Guía')
        + ` <span class="text-muted">× duración · ${scopeLabel('includeGuide')}</span>`;
      rows.push({ label, cells: cols.map((p) => ({ cost: this.generalGuideAtPax(p), note: '' })) });
    }
    if (choferOn) {
      rows.push({
        label: `Chofer <span class="text-muted">× duración · ${scopeLabel('includeChofer')}</span>`,
        cells: cols.map(() => ({ cost: this.generalChoferFixed(), note: '' })),
      });
    }
    // Bucket por columna: 0=min, último=max, en medio=mid (para el override por escenario).
    const bucketOf = (i) => (i === 0 ? 'min' : (i === last ? 'max' : 'mid'));
    // Etiqueta de la fila: para TRASLADO muestra "origen → destino" (+ ida y vuelta si redondo);
    // el resto, su nombre/concepto.
    const rowLabel = (s) => {
      if (s.type === 'transport') {
        const o = (s.originName || '').trim();
        const d = (s.destinationName || '').trim();
        const route = (o && d) ? `${o} → ${d}` : (d || o || (s.concept || 'Traslado'));
        const tags = [];
        if (s.roundTrip) tags.push('viaje redondo');
        // Greeter: ya va incluido en el precio del traslado; se muestra para que se vea.
        const greeter = s.includeGreeter ? (this.guideGreeterCostForService(s).greeter || 0) : 0;
        if (greeter > 0) tags.push(`greeter ${fmt(greeter)}`);
        return route + (tags.length ? ` <span class="text-muted">· ${tags.join(' · ')}</span>` : '');
      }
      return s.concept || this.getServiceTitle(s);
    };
    services.forEach((s) => {
      const name = rowLabel(s);
      const isVeh = (s.type === 'transport' || s.type === 'tour') && s.vehicleId;
      if (isVeh) {
        const options = this.getVehiclesForServiceSync(s);
        const cells = cols.map((p, i) => {
          const bucket = bucketOf(i);
          const override = (s.vehicleByPax && s.vehicleByPax[bucket]) || null;
          const r = this.serviceAtPax(s, p, override);
          return { cost: r.cost, count: r.count || 1, vehId: r.vehId, note: r.note, bucket, options, serviceId: s.id };
        });
        rows.push({ label: name, cells });
      } else {
        rows.push({ label: name, cells: cols.map((p) => this.serviceAtPax(s, p)) });
      }
    });

    const totals = cols.map((_, i) => rows.reduce((sum, r) => sum + r.cells[i].cost, 0));
    const perPersonVals = cols.map((p, i) => (p > 0 ? totals[i] / p : 0));

    // Encabezados. La columna intermedia es un input editable (pax); las otras, texto.
    const th = cols.map((p, i) => {
      if (i === midIdx) {
        return `<th><input type="number" min="${minPax}" max="${maxPax}" step="1" id="bdMidPax" value="${p}" class="form-control form-control-sm d-inline-block text-center" style="width:62px;"> pax</th>`;
      }
      return `<th>${colLabel(p, i)}</th>`;
    }).join('');
    const escBd = (str) => String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const cell = (c) => {
      let inner = fmt(c.cost);
      if (c.options && c.options.length) {
        // Dropdown de vehículo POR COLUMNA (override por escenario de pax; se guarda).
        const opts = c.options.map((o) => `<option value="${escBd(o.vehicleTypeId)}" ${o.vehicleTypeId === c.vehId ? 'selected' : ''}>${escBd(o.name)}</option>`).join('');
        const cnt = c.count > 1 ? ` <small class="text-muted">×${c.count}</small>` : '';
        inner += `<br><select class="form-select bd-veh-select" data-service-id="${escBd(c.serviceId)}" data-bucket="${escBd(c.bucket)}" style="max-width:210px;font-size:14px;display:inline-block;margin-top:4px;">${opts}</select>${cnt}`;
      } else if (c.note) {
        inner += `<br><small class="text-muted">${c.note}</small>`;
      }
      return `<td>${inner}</td>`;
    };
    const bodyRows = rows.map((r) => `<tr><td>${r.label}</td>${r.cells.map(cell).join('')}</tr>`).join('');
    const totalRow = `<tr class="sum"><td>Total</td>${totals.map((v) => `<td>${fmt(v)}</td>`).join('')}</tr>`;
    const ppRow = `<tr class="ppv"><td>Por persona</td>${perPersonVals.map((v) => `<td>${fmt(v)}</td>`).join('')}</tr>`;

    const maxPerPerson = perPersonVals[last] || 0;
    container.innerHTML = `
      <table>
        <thead><tr><th>Servicio</th>${th}</tr></thead>
        <tbody>${bodyRows}${totalRow}${ppRow}</tbody>
      </table>
      <div class="mt-2">
        <button type="button" id="bdCopyAdult" class="btn btn-sm btn-outline-success">
          <i class="ti ti-arrow-down-circle me-1"></i>Poner ${fmt(maxPerPerson)} (por persona · Máx) en Precio Adulto
        </button>
      </div>`;

    // Copia el por-persona del Máx al input "Precio Adulto" (#experienceCost) y dispara
    // su input/change para que el autoguardado lo tome.
    const copyBtn = container.querySelector('#bdCopyAdult');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const el = document.getElementById('experienceCost');
        if (!el) return;
        el.value = Math.round(maxPerPerson * 100) / 100;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        copyBtn.innerHTML = '<i class="ti ti-check me-1"></i>Copiado a Precio Adulto';
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="ti ti-arrow-down-circle me-1"></i>Poner ${fmt(maxPerPerson)} (por persona · Máx) en Precio Adulto`;
        }, 1600);
      });
    }

    // Override de vehículo por columna (escenario de pax): guarda en service.vehicleByPax[bucket]
    // y repinta. Se persiste con la experiencia.
    container.querySelectorAll('.bd-veh-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const service = this.services.get(e.target.dataset.serviceId);
        if (!service) return;
        if (!service.vehicleByPax) service.vehicleByPax = {};
        service.vehicleByPax[e.target.dataset.bucket] = e.target.value || null;
        this.renderBreakdown();
        this.updateTotals();
        this.scheduleAutoSave();
      });
    });

    // Intermedio editable: al cambiarlo (blur/enter), guarda y repinta el desglose.
    const midEl = container.querySelector('#bdMidPax');
    if (midEl) {
      midEl.addEventListener('change', (e) => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v)) {
          this.breakdownMidPax = null; // vacío → vuelve al punto medio automático
        } else {
          // Acotar a [Mín, Máx]: el intermedio no puede salir del rango de capacidad.
          v = Math.min(maxPax, Math.max(minPax, v));
          this.breakdownMidPax = v;
        }
        this.renderBreakdown();
      });
    }
  }

  getWaitingTimePrice() {
    const vehicleTypeId = document.getElementById('vehicleSelect')?.value;
    const rateId = document.getElementById('transportCategory')?.value;
    if (!vehicleTypeId || !rateId || !this.vehicleRatePricesCache.length) return null;

    const match = this.vehicleRatePricesCache.find(
      (p) => p.vehicleTypeId === vehicleTypeId && p.rateId === rateId,
    );
    return match ? { pricePerHour: match.pricePerHour, currency: match.currency || 'MXN' } : null;
  }

  updateWaitingTimeRateDisplay() {
    const rateEl = document.getElementById('waitingTimeRate');
    if (!rateEl) return;

    const wtPrice = this.getWaitingTimePrice();
    if (wtPrice) {
      rateEl.textContent = `$${wtPrice.pricePerHour.toLocaleString()} ${wtPrice.currency}/hora`;
    } else {
      rateEl.textContent = '';
    }
  }

  // Locations that require the "Ubicación Específica" field
  checkSpecificLocationField() {
    const specificLocationRow = document.getElementById('specificLocationRow');
    if (!specificLocationRow) return;

    const needsSpecificLocation = [
      'San Miguel de Allende', 'San Miguel Allende', 'Centro San Miguel de Allende',
      'Guanajuato Capital', 'León', 'Ciudad de México', 'CDMX',
    ];

    const matchesAny = (value) => needsSpecificLocation.some((loc) =>
      value && value.toLowerCase().includes(loc.toLowerCase())
    );

    const originCombo = document.getElementById('transportOriginCombo')?.value || '';
    const destCombo = document.getElementById('transportDestinationCombo')?.value || '';
    const originText = document.getElementById('transportOriginText')?.value || '';
    const destText = document.getElementById('transportDestinationText')?.value || '';

    const needsField = matchesAny(originCombo) || matchesAny(destCombo) || matchesAny(originText) || matchesAny(destText);

    if (needsField) {
      specificLocationRow.classList.remove('d-none');
      const nameSpan = document.getElementById('selectedDestinationName');
      const matchedName = [destCombo, originCombo, destText, originText].find((v) => matchesAny(v)) || '';
      if (nameSpan) nameSpan.textContent = matchedName;
    } else {
      specificLocationRow.classList.add('d-none');
      const field = document.getElementById('transportSpecificLocation');
      if (field) field.value = '';
    }
  }

  checkRoundTripSpecificLocationFields() {
    const needsSpecificLocation = [
      'San Miguel de Allende', 'San Miguel Allende', 'Centro San Miguel de Allende',
      'Guanajuato Capital', 'León', 'Ciudad de México', 'CDMX',
    ];

    const matchesAny = (value) => needsSpecificLocation.some((loc) =>
      value && value.toLowerCase().includes(loc.toLowerCase())
    );

    // Ida
    const idaRow = document.getElementById('roundTripSpecificLocationIdaRow');
    if (idaRow) {
      const idaDest = document.getElementById('roundTripDestinationIdaCombo')?.value || '';
      idaRow.classList.toggle('d-none', !matchesAny(idaDest));
    }

    // Vuelta
    const vueltaRow = document.getElementById('roundTripSpecificLocationVueltaRow');
    if (vueltaRow) {
      const vueltaOrigin = document.getElementById('roundTripOriginVueltaCombo')?.value || '';
      vueltaRow.classList.toggle('d-none', !matchesAny(vueltaOrigin));
    }
  }

  recalculateExperiencePrice() {
    // Recalculate based on quantities * prices
  }

  recalculateTourPrice() {
    // Recalculate based on quantities * prices
  }

  recalculateConceptoPrice() {
    // Recalculate based on quantities
  }

  populateRateSelector() {
    const select = document.getElementById('transportCategory');
    if (!select || !this.ratesCache) return;

    // Store current value to restore after population
    const currentValue = select.value;

    // Check if current service type is Tour
    const serviceTypeInputs = document.querySelectorAll('input[name="serviceType"]');
    let currentServiceType = 'experience'; // default
    serviceTypeInputs.forEach((input) => {
      if (input.checked) {
        currentServiceType = input.value;
      }
    });

    select.innerHTML = '<option value="">-- Seleccionar segmento --</option>';
    this.ratesCache.forEach((rate) => {
      const label = rate.label || rate.name;

      // Skip "Economico/Económico" option when Tour is selected
      // Check for both spellings with and without accent
      if (currentServiceType === 'tour' && label) {
        const normalizedLabel = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalizedLabel === 'economico' || normalizedLabel === 'economica') {
          return; // Skip this rate
        }
      }

      const option = document.createElement('option');
      option.value = rate.id;
      option.textContent = label;
      select.appendChild(option);
    });

    // Restore previous value if it still exists in the updated options
    if (currentValue) {
      select.value = currentValue;
    }
  }

  populateVehicleSelectFromRoute(vehicles) {
    const select = document.getElementById('vehicleSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Seleccionar vehículo --</option>';
    if (!vehicles || vehicles.length === 0) {
      const noOption = document.createElement('option');
      noOption.value = '';
      noOption.textContent = '-- Sin vehículos disponibles --';
      noOption.disabled = true;
      select.appendChild(noOption);
      return;
    }

    vehicles.forEach((vehicle) => {
      const option = document.createElement('option');
      option.value = vehicle.vehicleTypeId;
      const pax = vehicle.capacity || 0;
      const trunk = vehicle.trunkCapacity || 0;
      option.textContent = `${vehicle.vehicleType} - ${pax} pax, ${trunk} carry-on`;
      select.appendChild(option);
    });

    const priceEl = document.getElementById('servicePrice');
    if (priceEl) priceEl.value = '';
  }

  populateVehicleSelectFallback(rateId) {
    const select = document.getElementById('vehicleSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Seleccionar vehículo --</option>';

    // Get unique vehicles from vehicleRatePricesCache for this rate
    const seen = new Set();
    const filtered = this.vehicleRatePricesCache.filter((p) => {
      if (p.rateId !== rateId || seen.has(p.vehicleTypeId)) return false;
      seen.add(p.vehicleTypeId);
      return true;
    });

    if (filtered.length === 0 && this.vehiclesCache) {
      // Ultimate fallback: use vehiclesCache
      this.vehiclesCache.forEach((v) => {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = `${v.name} (${v.defaultCapacity ?? v.capacity} pax)`;
        select.appendChild(option);
      });
    } else {
      // Capacidad (pax) por tipo de vehículo, desde vehiclesCache.
      // El campo real es defaultCapacity (no capacity).
      const capacityById = new Map();
      (this.vehiclesCache || []).forEach((v) => capacityById.set(v.id, v.defaultCapacity ?? v.capacity));
      filtered.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.vehicleTypeId;
        const name = p.vehicleTypeName || p.vehicleTypeCode || p.vehicleTypeId;
        const pax = capacityById.get(p.vehicleTypeId);
        option.textContent = pax != null ? `${name} - ${pax} pax` : name;
        select.appendChild(option);
      });
    }
  }

  clearVehicleDropdown() {
    const select = document.getElementById('vehicleSelect');
    if (select) {
      select.innerHTML = '<option value="">-- Sin vehículo --</option>';
      select.value = '';
    }

    // Also clear price field - set to 0.00 to match quote modal behavior
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.value = '0.00';
    }

    this.updateServiceTotal();
  }

  retriggerRateLookup() {
    const rateId = document.getElementById('transportCategory')?.value;
    if (rateId) {
      this.handleRateSelection(rateId);
    }
  }

  populateExperienceSelect() {
    const select = document.getElementById('experienceSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona una experiencia --</option>';

    // Group: Experiencias
    const expGroup = document.createElement('optgroup');
    expGroup.label = 'Experiencias';
    let hasExperiences = false;
    this.experiencesCache.forEach((exp) => {
      if (exp.id !== this.experienceId && exp.type !== 'provider_experience') {
        const option = document.createElement('option');
        option.value = exp.id;
        option.textContent = exp.name;
        expGroup.appendChild(option);
        hasExperiences = true;
      }
    });
    if (hasExperiences) select.appendChild(expGroup);

    // Groups: Proveedores y Establecimientos (ambos vienen de provider-experiencias,
    // se distinguen por provider.type para mostrarlos en grupos separados).
    const providerExps = this.providerExperiencesCache || [];
    if (providerExps.length > 0) {
      // Cachear todas para lookup posterior (precio, edición, etc.)
      providerExps.forEach((exp) => {
        if (!this.experiencesCache.has(exp.id)) {
          this.experiencesCache.set(exp.id, exp);
        }
      });

      const buildGroup = (label, predicate) => {
        const items = providerExps.filter(predicate);
        if (items.length === 0) return;
        const group = document.createElement('optgroup');
        group.label = label;
        items.forEach((exp) => {
          const option = document.createElement('option');
          option.value = exp.id;
          const parentName = exp.provider ? ` (${exp.provider.name})` : '';
          option.textContent = `${exp.name}${parentName}`;
          group.appendChild(option);
        });
        select.appendChild(group);
      };

      buildGroup('Experiencias de Proveedores', (exp) => exp.provider?.type !== 'Establishment');
      buildGroup('Experiencias de Establecimientos', (exp) => exp.provider?.type === 'Establishment');
    }
  }

  populateTourSelect() {
    const select = document.getElementById('tourSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecciona un tour --</option>';

    const walkingTours = [];
    const vehicleTours = [];
    this.toursCache.forEach((tour) => {
      if (tour.isWalkingTour) {
        walkingTours.push(tour);
      } else {
        vehicleTours.push(tour);
      }
    });

    if (vehicleTours.length > 0) {
      const vehicleGroup = document.createElement('optgroup');
      vehicleGroup.label = 'Tours con Vehículo';
      vehicleTours.forEach((tour) => {
        const option = document.createElement('option');
        option.value = tour.id;
        option.textContent = tour.destinationPOI?.name || tour.name || 'Sin destino';
        vehicleGroup.appendChild(option);
      });
      select.appendChild(vehicleGroup);
    }

    if (walkingTours.length > 0) {
      const walkingGroup = document.createElement('optgroup');
      walkingGroup.label = 'Tours a Pie';
      walkingTours.forEach((tour) => {
        const option = document.createElement('option');
        option.value = tour.id;
        option.textContent = tour.destinationPOI?.name || tour.name || 'Sin destino';
        walkingGroup.appendChild(option);
      });
      select.appendChild(walkingGroup);
    }
  }

  async populateServiceFields(service) {
    switch (service.type) {
      case 'experience':
        this.populateExperienceFields(service);
        break;
      case 'tour':
        this.populateTourFields(service);
        break;
      case 'transport':
        await this.populateTransportFields(service);
        break;
      case 'concepto':
        this.populateConceptoFields(service);
        break;
      case 'entradas':
        this.populateEntradasFields(service);
        break;
    }
  }

  populateExperienceFields(service) {
    const expSelect = document.getElementById('experienceSelect');
    if (expSelect && service.experienceId) expSelect.value = service.experienceId;

    const adultsQty = document.getElementById('adultsQuantity');
    const childrenQty = document.getElementById('childrenQuantity');
    const noAlcQty = document.getElementById('adultsNoAlcoholQuantity');
    const adultPrice = document.getElementById('adultPrice');
    const childPrice = document.getElementById('childPrice');
    const noAlcPrice = document.getElementById('noAlcoholPrice');

    if (adultsQty) adultsQty.value = service.adultsQuantity || 0;
    if (childrenQty) childrenQty.value = service.childrenQuantity || 0;
    if (noAlcQty) noAlcQty.value = service.adultsNoAlcoholQuantity || 0;

    // Cargar el catálogo (tarjeta + precios base) ANTES de restaurar los precios
    // guardados, para que la EDICIÓN gane sobre el catálogo (antes los pisaba).
    if (service.experienceId) this.handleExperienceSelection(service.experienceId);

    // Precios guardados por encima del catálogo. Niño/sin-alcohol: si se guardaron
    // vacíos (null), el campo se queda vacío.
    if (adultPrice && service.adultPrice != null) adultPrice.value = service.adultPrice;
    if (childPrice) childPrice.value = service.childPrice != null ? service.childPrice : '';
    if (noAlcPrice) noAlcPrice.value = service.noAlcoholPrice != null ? service.noAlcoholPrice : '';

    const startTime = document.getElementById('experienceStartTime');
    const endTime = document.getElementById('experienceEndTime');
    if (startTime) startTime.value = service.startTime || '';
    if (endTime) endTime.value = service.endTime || '';

    // Restore languages and clientNotes after handleExperienceSelection populates from cache
    setTimeout(() => {
      const langEl = document.getElementById('experienceLanguages');
      const notesEl = document.getElementById('experienceClientNotes');
      if (langEl && service.languages) langEl.value = service.languages;
      if (notesEl && service.clientNotes) notesEl.value = service.clientNotes;
    }, 100);
  }

  populateTourFields(service) {
    const tourSelect = document.getElementById('tourSelect');
    if (tourSelect && service.tourId) tourSelect.value = service.tourId;

    const adultsQty = document.getElementById('tourAdultsQuantity');
    const childrenQty = document.getElementById('tourChildrenQuantity');
    const noAlcQty = document.getElementById('tourAdultsNoAlcoholQuantity');
    const adultPrice = document.getElementById('tourAdultPrice');
    const childPrice = document.getElementById('tourChildPrice');
    const noAlcPrice = document.getElementById('tourNoAlcoholPrice');

    if (adultsQty) adultsQty.value = service.adultsQuantity || 0;
    if (childrenQty) childrenQty.value = service.childrenQuantity || 0;
    if (noAlcQty) noAlcQty.value = service.adultsNoAlcoholQuantity || 0;
    if (adultPrice) adultPrice.value = service.adultPrice || 0;
    if (childPrice) childPrice.value = service.childPrice || 0;
    if (noAlcPrice) noAlcPrice.value = service.noAlcoholPrice || 0;

    const startTime = document.getElementById('tourStartTime');
    const endTime = document.getElementById('tourEndTime');
    if (startTime) startTime.value = service.startTime || '';
    if (endTime) endTime.value = service.endTime || '';

    const includeGuide = document.getElementById('includeGuide');
    const includeGreeter = document.getElementById('includeGreeter');
    if (includeGuide) includeGuide.checked = service.includeGuide || false;
    if (includeGreeter) includeGreeter.checked = service.includeGreeter || false;

    // Restaurar el modo de duración de la guía guardado (tours a pie).
    const guideDurationMode = document.getElementById('guideDurationMode');
    if (guideDurationMode) guideDurationMode.value = service.guideDurationMode || 'tour';

    if (service.tourId) this.handleTourSelection(service.tourId);

    // Ya con el tour seleccionado, mostrar/ocultar el selector y refrescar el total.
    this.updateGuideDurationModeVisibility();
    this.updateServiceTotal();

    // Tour a pie: restaurar personas + precios de grupo GUARDADOS (sobre los del tour).
    if (service.isWalkingTour && this.selectedTourData?.isWalkingTour) {
      this.populateWalkingTourFields(this.selectedTourData, {
        walkingPriceSmall: service.walkingPriceSmall != null ? service.walkingPriceSmall : undefined,
        walkingPriceMedium: service.walkingPriceMedium != null ? service.walkingPriceMedium : undefined,
        walkingPriceLarge: service.walkingPriceLarge != null ? service.walkingPriceLarge : undefined,
        walkingPeopleCount: service.walkingPeopleCount != null ? service.walkingPeopleCount : 1,
      });
      this.updateServiceTotal();
    }

    // Restaurar horas guardadas (handleTourSelection las pone con la duración del tour).
    if (service.hours) {
      const hoursEl = document.getElementById('hoursQuantity');
      if (hoursEl) hoursEl.value = service.hours;
    }

    // Restaurar segmento + vehículo + precio BASE guardados (sin que se recalcule).
    if (service.rateId) {
      const rateSelect = document.getElementById('transportCategory');
      if (rateSelect) {
        rateSelect.value = service.rateId;
        this._populatingTransportForm = true;
        this.handleRateSelection(service.rateId); // tour -> puebla vehículos (síncrono)
        if (service.vehicleId) {
          const vehicleSelect = document.getElementById('vehicleSelect');
          if (vehicleSelect) vehicleSelect.value = service.vehicleId;
        }
        const priceEl = document.getElementById('servicePrice');
        if (priceEl) {
          // Como en cotizaciones: el precio BASE siempre es el precio por hora del
          // VEHÍCULO (tour-prices), NUNCA el total del servicio. Así al editar no se
          // triplica (el total = base × horas se muestra aparte vía updateServiceTotal).
          const vehBase = service.vehicleId != null ? this.getTourVehiclePrice(service.vehicleId) : null;
          priceEl.value = vehBase != null
            ? vehBase
            : (service.unitPrice != null ? service.unitPrice : (service.price || 0));
        }
        // Cantidad de vehículos + picker por capacidad (tour con vehículo).
        const vcTourEl = document.getElementById('vehicleCount');
        if (vcTourEl) vcTourEl.value = service.vehicleCount || 1;
        this.renderVehiclePicker();
        this.updateVehicleCapacityHint();
        this._populatingTransportForm = false;
      }
    }
    this.updateServiceTotal();

    // Restore languages and clientNotes after handleTourSelection populates from cache
    setTimeout(() => {
      const langEl = document.getElementById('tourLanguages');
      const notesEl = document.getElementById('tourClientNotes');
      if (langEl && service.languages) langEl.value = service.languages;
      if (notesEl && service.clientNotes) notesEl.value = service.clientNotes;
    }, 100);
  }

  async populateTransportFields(service) {
    // 1. Set transport type radio (aeropuerto/punto-a-punto/local)
    if (service.transportType) {
      const transportRadio = document.querySelector(`input[name="transportType"][value="${service.transportType}"]`);
      if (transportRadio) {
        transportRadio.checked = true;
        await this.handleTransportTypeChange();
      }
    }

    // 2. Set trip type radio (one-way/round-trip)
    if (service.tripType) {
      const tripRadio = document.querySelector(`input[name="tripType"][value="${service.tripType}"]`);
      if (tripRadio) {
        tripRadio.checked = true;
        await this.handleTripTypeChange();
      }
    }

    // 3. Set direction type radio (arrival/departure)
    if (service.directionType) {
      const dirRadio = document.querySelector(`input[name="directionType"][value="${service.directionType}"]`);
      if (dirRadio) {
        dirRadio.checked = true;
        await this.handleDirectionTypeChange();
      }
    }

    // 4-7. Restaurar origen/destino + segmento + vehículo. El combo de destino se
    // restaura con setTimeout(50ms) y aún no está listo cuando cargamos vehículos por
    // ruta, así que pasamos origen/destino como fallback DIRECTO a la carga (evita el
    // dropdown de vehículo vacío al editar).
    setTimeout(async () => {
      if (service.originName || service.destinationName) {
        this.restoreOneWayValues(service.originName || '', service.destinationName || '', service.transportType);
      }

      if (service.rateId) {
        const rateSelect = document.getElementById('transportCategory');
        if (rateSelect) rateSelect.value = service.rateId;
        this._populatingTransportForm = true;
        // Carga vehículos por ruta con origen/destino explícitos (no depende del combo).
        await this.handleTransportRateSelection(service.rateId, service.originName || '', service.destinationName || '');
        // 6. Vehículo + cantidad + precio BASE (el Total se recompone aparte).
        if (service.vehicleId) {
          const vehicleSelect = document.getElementById('vehicleSelect');
          if (vehicleSelect) vehicleSelect.value = service.vehicleId;
        }
        const vcEl = document.getElementById('vehicleCount');
        if (vcEl) vcEl.value = service.vehicleCount || (service.additionalVehicle ? 2 : 1);
        const priceEl = document.getElementById('servicePrice');
        if (priceEl) priceEl.value = service.unitPrice != null ? service.unitPrice : (service.price || 0);
        this.updateWaitingTimeRateDisplay();
        this.updateVehicleCapacityHint();
        this.renderVehiclePicker();
        this.updateServiceTotal();
        this._populatingTransportForm = false;
      } else {
        const priceEl = document.getElementById('servicePrice');
        if (priceEl) priceEl.value = service.price || 0;
      }

      this.checkSpecificLocationField();
      this.checkRoundTripSpecificLocationFields();
    }, 100);

    // 8. Cantidad de vehículos (compat: additionalVehicle guardado antes → 2)
    const vehicleCountEl = document.getElementById('vehicleCount');
    if (vehicleCountEl) vehicleCountEl.value = service.vehicleCount || (service.additionalVehicle ? 2 : 1);
    const quantityEl = document.getElementById('serviceQuantity');
    if (quantityEl) quantityEl.value = service.quantity || 1;

    // 9. Guide & Greeter
    const includeGuide = document.getElementById('includeGuide');
    if (includeGuide) includeGuide.checked = service.includeGuide || false;

    const includeGreeter = document.getElementById('includeGreeter');
    if (includeGreeter) {
      includeGreeter.checked = service.includeGreeter || false;
      this.handleIncludeGreeterChange(includeGreeter.checked);
    }

    const greeterInVehicle = document.getElementById('greeterInVehicle');
    if (greeterInVehicle) greeterInVehicle.checked = service.greeterInVehicle || false;

    // 10. Waiting time
    const waitingTimeHours = document.getElementById('waitingTimeHours');
    if (waitingTimeHours) waitingTimeHours.value = service.waitingTimeHours || 0;

    // 11. Duración editable (h/min) + viaje redondo
    const durHoursEl = document.getElementById('transportDurationHours');
    const durMinutesEl = document.getElementById('transportDurationMinutes');
    const roundTripEl = document.getElementById('transportRoundTrip');
    if (durHoursEl) durHoursEl.value = service.transportDurationHours ?? '';
    if (durMinutesEl) durMinutesEl.value = service.transportDurationMinutes ?? '';
    if (roundTripEl) roundTripEl.checked = service.roundTrip || false;
    this.updateServiceTotal();
  }

  populateConceptoFields(service) {
    const conceptoEl = document.getElementById('conceptoConcept');
    if (conceptoEl) conceptoEl.value = service.concept || '';

    const priceEl = document.getElementById('servicePrice');
    const quantityEl = document.getElementById('serviceQuantity');
    if (priceEl) priceEl.value = service.price || 0;
    if (quantityEl) quantityEl.value = service.quantity || 1;

    const notesEl = document.getElementById('serviceNotes');
    if (notesEl) notesEl.value = service.notes || '';

    this.updateServiceTotal();
  }

  // --- Entradas (tipo de servicio): selector de boletos con precio auto ---
  async fetchAllEntradas() {
    if (this.entradasCache) return this.entradasCache;
    try {
      const token = (typeof getAccessToken === 'function') ? getAccessToken() : (window.experienceAccessToken || null);
      const res = await fetch('/api/destinos/all-entradas', { credentials: 'same-origin', headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (!res.ok) { this.entradasCache = []; return this.entradasCache; }
      const json = await res.json();
      this.entradasCache = (json && json.data) || [];
    } catch (e) {
      console.warn('No se pudieron cargar las entradas:', e);
      this.entradasCache = [];
    }
    return this.entradasCache;
  }

  async populateEntradaSelect() {
    const select = document.getElementById('entradaSelect');
    if (!select) return;
    const all = await this.fetchAllEntradas();
    const current = select.value;
    select.innerHTML = '<option value="">-- Selecciona un boleto --</option>';
    const groups = {};
    all.forEach((e) => {
      const g = e.destinoName || 'Sin destino';
      (groups[g] = groups[g] || []).push(e);
    });
    Object.keys(groups).sort().forEach((g) => {
      const og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach((e) => {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = `${e.name} \u00b7 $${Number(e.price || 0).toLocaleString('es-MX')}`;
        o.dataset.name = e.name || '';
        o.dataset.price = Number(e.price || 0);
        og.appendChild(o);
      });
      select.appendChild(og);
    });
    if (current) select.value = current;
  }

  buildEntradasService() {
    const sel = document.getElementById('entradaSelect');
    const entradaId = sel?.value || '';
    if (!entradaId) {
      this.showModalAlert('Selecciona un boleto');
      return null;
    }
    const opt = sel.selectedOptions[0];
    const concept = (opt && opt.dataset.name) || (opt && opt.textContent) || 'Entrada';
    const price = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    const quantity = parseInt(document.getElementById('serviceQuantity')?.value) || 1;
    return { entradaId, concept, price, quantity };
  }

  populateEntradasFields(service) {
    const sel = document.getElementById('entradaSelect');
    if (sel) {
      if (service.entradaId && !Array.from(sel.options).some((o) => o.value === service.entradaId)) {
        const o = document.createElement('option');
        o.value = service.entradaId;
        o.textContent = service.concept || service.entradaId;
        o.dataset.name = service.concept || '';
        o.dataset.price = service.price || 0;
        sel.appendChild(o);
      }
      sel.value = service.entradaId || '';
    }
    const priceEl = document.getElementById('servicePrice');
    const quantityEl = document.getElementById('serviceQuantity');
    if (priceEl) priceEl.value = service.price || 0;
    if (quantityEl) quantityEl.value = service.quantity || 1;
    const notesEl = document.getElementById('serviceNotes');
    if (notesEl) notesEl.value = service.notes || '';
    this.updateServiceTotal();
  }

  // =====================
  // SERVICE CRUD
  // =====================

  async saveService() {
    const type = document.querySelector('input[name="serviceType"]:checked')?.value || 'experience';
    let service = {};

    switch (type) {
      case 'experience':
        service = this.buildExperienceService();
        break;
      case 'tour':
        service = this.buildTourService();
        break;
      case 'transport':
        service = this.buildTransportService();
        break;
      case 'concepto':
        service = this.buildConceptoService();
        break;
      case 'entradas':
        service = this.buildEntradasService();
        break;
    }

    if (!service) return;

    // Validate end time is not earlier than start time
    if (service.startTime && service.endTime) {
      const startMinutes = this.parseTimeForSorting(service.startTime);
      const endMinutes = this.parseTimeForSorting(service.endTime);
      if (startMinutes !== 999999 && endMinutes !== 999999 && endMinutes <= startMinutes) {
        this.showModalAlert('La hora de fin debe ser posterior a la hora de inicio');
        return;
      }
    }

    service.type = type;
    service.notes = document.getElementById('serviceNotes')?.value || '';

    // Transporte: duración = tiempo de ruta (min -> hrs), para la duración sugerida.
    if (type === 'transport' && !service.durationHours && this.cachedRouteDuration) {
      service.durationHours = (parseFloat(this.cachedRouteDuration) || 0) / 60;
    }

    if (this.currentServiceId) {
      // Update existing
      service.id = this.currentServiceId;
      this.services.set(this.currentServiceId, service);
    } else {
      // Create new
      service.id = this.generateId('svc');
      this.services.set(service.id, service);
    }

    // Cierra el panel inline y lo devuelve a su home (fuera de la lista de tarjetas).
    const modalEl = document.getElementById('serviceModal');
    if (modalEl) modalEl.style.display = 'none';
    this.moveServicePanelHome();
    // Limpia el chip de tipo que quedó marcado como activo.
    document.querySelectorAll('#addServiceChips .add-service-chip.active').forEach((c) => c.classList.remove('active'));

    this.sortAndDetectOverlaps();
    this.renderServices();
    this.updateTotals();
    this.scheduleAutoSave();
  }

  buildExperienceService() {
    const experienceId = document.getElementById('experienceSelect')?.value;
    if (!experienceId) {
      this.showModalAlert('Selecciona una experiencia');
      return null;
    }

    const exp = this.experiencesCache.get(experienceId);
    const adultsQty = parseInt(document.getElementById('adultsQuantity')?.value) || 0;
    const childrenQty = parseInt(document.getElementById('childrenQuantity')?.value) || 0;
    const noAlcQty = parseInt(document.getElementById('adultsNoAlcoholQuantity')?.value) || 0;
    const adultPrice = parseFloat(document.getElementById('adultPrice')?.value) || 0;
    const childRaw = document.getElementById('childPrice')?.value;
    const noAlcRaw = document.getElementById('noAlcoholPrice')?.value;
    // Valor capturado: null si se dejó vacío (así al reabrir el campo sigue vacío
    // y se respeta la edición). Un 0 explícito sí se conserva.
    const childPrice = (childRaw == null || childRaw === '') ? null : (parseFloat(childRaw) || 0);
    const noAlcPrice = (noAlcRaw == null || noAlcRaw === '') ? null : (parseFloat(noAlcRaw) || 0);
    // Para el TOTAL, si no se capturó precio de niño/sin-alcohol se usa el de adulto.
    const childForCalc = childPrice != null ? childPrice : adultPrice;
    const noAlcForCalc = noAlcPrice != null ? noAlcPrice : adultPrice;

    const total = (adultsQty * adultPrice) + (childrenQty * childForCalc) + (noAlcQty * noAlcForCalc);

    const isProvider = exp && exp.type === 'provider_experience';

    // Build base service object
    const service = {
      experienceId,
      concept: exp ? exp.name : 'Experiencia',
      // Horas editables del modal (default = duración de la experiencia); alimenta
      // la duración sugerida. durationHours queda como respaldo.
      hours: parseFloat(document.getElementById('hoursQuantity')?.value) || null,
      durationHours: exp && exp.duration ? (parseFloat(exp.duration) || 0) : 0,
      isProviderExperience: isProvider,
      price: total,
      quantity: 1,
      adultsQuantity: adultsQty,
      childrenQuantity: childrenQty,
      adultsNoAlcoholQuantity: noAlcQty,
      adultPrice,
      childPrice,
      noAlcoholPrice: noAlcPrice,
      startTime: document.getElementById('experienceStartTime')?.value || null,
      endTime: document.getElementById('experienceEndTime')?.value || null,
      selectedSchedule: document.getElementById('experienceMultipleTime')?.value || '',
      languages: document.getElementById('experienceLanguages')?.value || '',
      clientNotes: document.getElementById('experienceClientNotes')?.value || '',
    };

    // Include modified transport services if they exist
    if (this.experienceTransportServices && this.experienceTransportServices.length > 0) {
      // Create a modified serviceItems structure with updated transport services
      const originalServiceItems = exp?.serviceItems || {};
      const modifiedSubconcepts = [];

      // Copy all original subconcepts
      if (originalServiceItems.subconcepts) {
        originalServiceItems.subconcepts.forEach((subconcept, index) => {
          if (subconcept.type === 'traslado' || subconcept.type === 'transport') {
            // Use modified transport service if available
            const modifiedTransport = this.experienceTransportServices[index];
            if (modifiedTransport) {
              modifiedSubconcepts.push({
                ...subconcept,
                vehicleId: modifiedTransport.vehicleId || subconcept.vehicleId,
                vehicleType: modifiedTransport.vehicleType || subconcept.vehicleType,
                vehicleTypeName: modifiedTransport.vehicleTypeName || subconcept.vehicleTypeName,
                rateId: modifiedTransport.rateId || subconcept.rateId,
                rateName: modifiedTransport.rateName || subconcept.rateName
              });
            } else {
              modifiedSubconcepts.push(subconcept);
            }
          } else {
            // Keep non-transport subconcepts as-is
            modifiedSubconcepts.push(subconcept);
          }
        });
      }

      // Add the modified service items to the service object
      service.modifiedServiceItems = {
        ...originalServiceItems,
        subconcepts: modifiedSubconcepts
      };

      // Add a flag to indicate transport services were modified
      service.hasTransportModifications = true;
    }

    return service;
  }

  buildTourService() {
    const tourId = document.getElementById('tourSelect')?.value;
    if (!tourId) {
      this.showModalAlert('Selecciona un tour');
      return null;
    }

    const tour = this.toursCache.get(tourId);
    const adultsQty = parseInt(document.getElementById('tourAdultsQuantity')?.value) || 0;
    const childrenQty = parseInt(document.getElementById('tourChildrenQuantity')?.value) || 0;
    const noAlcQty = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value) || 0;
    const adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value) || 0;
    const childPrice = parseFloat(document.getElementById('tourChildPrice')?.value) || 0;
    const noAlcPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value) || 0;

    const includeGuide = document.getElementById('includeGuide')?.checked || false;
    const includeGreeter = document.getElementById('includeGreeter')?.checked || false;

    const rateId = document.getElementById('transportCategory')?.value || null;
    const vehicleId = document.getElementById('vehicleSelect')?.value || null;
    const vehicleType = vehicleId ? this.vehicleTypesMap.get(vehicleId) : null;

    const isWalkingTour = tour ? (tour.isWalkingTour || false) : false;

    // El precio del tour-con-vehículo = base (precio por hora de tour-prices) × horas
    // + guía (Chofer Tour × horas) si aplica.
    const base = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    const hours = parseFloat(document.getElementById('hoursQuantity')?.value) || 1;
    // Tour-con-vehículo: N vehículos por capacidad (precio = base × N × horas).
    const vehicleQty = Math.max(1, parseInt(document.getElementById('vehicleCount')?.value, 10) || 1);
    const { guide: guideCost } = this.getGuideGreeterCost();

    // Tour a pie: precio por grupo (precios editables) según personas; SIN base × horas.
    const walkingPriceSmall = parseFloat(document.getElementById('walkingPriceSmall')?.value) || 0;
    const walkingPriceMedium = parseFloat(document.getElementById('walkingPriceMedium')?.value) || 0;
    const walkingPriceLarge = parseFloat(document.getElementById('walkingPriceLarge')?.value) || 0;
    const walkingPeopleCount = Math.max(1, parseInt(document.getElementById('walkingTourPeopleCount')?.value, 10) || 1);

    const total = isWalkingTour
      ? (this.getWalkingTourTotal() + guideCost)
      : (base * vehicleQty * hours) + guideCost;

    return {
      tourId,
      concept: tour ? (tour.destinationPOI?.name || tour.name || 'Tour') : 'Tour',
      price: total,
      unitPrice: isWalkingTour ? total : base,
      hours,
      vehicleCount: vehicleQty,
      guideCost,
      quantity: 1,
      walkingPriceSmall,
      walkingPriceMedium,
      walkingPriceLarge,
      walkingPeopleCount,
      walkingPerGroup: isWalkingTour ? this.getWalkingPerGroupSum() : null, // suma de grupos, para recalcular × duración
      adultsQuantity: adultsQty,
      childrenQuantity: childrenQty,
      adultsNoAlcoholQuantity: noAlcQty,
      adultPrice,
      childPrice,
      noAlcoholPrice: noAlcPrice,
      startTime: document.getElementById('tourStartTime')?.value || null,
      endTime: document.getElementById('tourEndTime')?.value || null,
      rateId,
      vehicleId,
      vehicleType: vehicleId || null,
      vehicleTypeName: vehicleType ? vehicleType.name : null,
      includeGuide,
      includeGreeter,
      // Modo de cobro de la guía en tours a pie: 'tour' (horas del tour) o
      // 'experience' (Duración editable del header). Default 'tour'.
      guideDurationMode: document.getElementById('guideDurationMode')?.value || 'tour',
      isWalkingTour: tour ? (tour.isWalkingTour || false) : false,
      languages: document.getElementById('tourLanguages')?.value || '',
      clientNotes: document.getElementById('tourClientNotes')?.value || '',
    };
  }

  buildTransportService() {
    // Precio = base por ruta × vehículos + guía (fórmula) + greeter. quantity = 1
    // porque el total ya viene completo (el detalle por vehículo queda en unitPrice).
    const base = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    // Combinación por capacidad: N vehículos del tipo elegido (costo = base × N).
    const vehicleQty = Math.max(1, parseInt(document.getElementById('vehicleCount')?.value, 10) || 1);
    const { guide: guideCost, greeter: greeterCost } = this.getGuideGreeterCost();
    // Viaje redondo multiplica ×2 TODO el traslado: base (por vehículo) + guía + greeter.
    const roundTrip = document.getElementById('transportRoundTrip')?.checked || false;
    const rtMult = roundTrip ? 2 : 1;
    const price = ((base * vehicleQty) + guideCost + greeterCost) * rtMult;
    const quantity = 1;
    const rateId = document.getElementById('transportCategory')?.value || null;
    const vehicleId = document.getElementById('vehicleSelect')?.value || null;
    const vehicleType = vehicleId ? this.vehicleTypesMap.get(vehicleId) : null;
    const includeGuide = document.getElementById('includeGuide')?.checked || false;
    const includeGreeter = document.getElementById('includeGreeter')?.checked || false;
    const greeterInVehicle = document.getElementById('greeterInVehicle')?.checked || false;
    const waitingTimeHours = parseFloat(document.getElementById('waitingTimeHours')?.value || 0);

    // Capture transport metadata for display
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value || '';
    const directionType = document.querySelector('input[name="directionType"]:checked')?.value || '';
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value || 'one-way';
    const vals = this.getActiveOneWayValues();
    const originName = vals.origin || '';
    const destinationName = vals.dest || '';

    // Get vehicle display name from route data or vehicleRatePrices
    let vehicleDisplayName = vehicleType ? vehicleType.name : null;
    if (!vehicleDisplayName && this.transportPriceData?.vehicles) {
      const rv = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === vehicleId);
      if (rv) vehicleDisplayName = rv.vehicleType;
    }
    if (!vehicleDisplayName && vehicleId) {
      const vrp = this.vehicleRatePricesCache.find((p) => p.vehicleTypeId === vehicleId);
      if (vrp) vehicleDisplayName = vrp.vehicleTypeName || vrp.vehicleTypeCode;
    }

    // Get rate name
    let rateName = '';
    if (rateId && this.ratesCache) {
      const rate = this.ratesCache.find((r) => r.id === rateId);
      if (rate) rateName = rate.name;
    }

    return {
      concept: 'Transporte',
      price,
      unitPrice: base,
      quantity,
      vehicleCount: vehicleQty,
      guideCost,
      greeterCost,
      rateId,
      rateName,
      vehicleId,
      vehicleType: vehicleId || null,
      vehicleTypeName: vehicleDisplayName,
      transportType,
      directionType,
      tripType,
      originName,
      destinationName,
      includeGuide,
      includeGreeter,
      greeterInVehicle,
      waitingTimeHours,
      // Duración (con ×2 si es redondo) para la duración sugerida y la tarjeta.
      durationHours: this.getTransportDurationHours(),
      roundTrip,
      transportDurationHours: parseInt(document.getElementById('transportDurationHours')?.value, 10) || 0,
      transportDurationMinutes: parseInt(document.getElementById('transportDurationMinutes')?.value, 10) || 0,
    };
  }

  buildConceptoService() {
    const concept = document.getElementById('conceptoConcept')?.value || '';
    if (!concept.trim()) {
      this.showModalAlert('Ingresa un concepto');
      return null;
    }

    const price = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    const quantity = parseInt(document.getElementById('serviceQuantity')?.value) || 1;
    const hasSchedule = document.getElementById('conceptoHasSchedule')?.checked || false;
    const startTime = hasSchedule ? (document.getElementById('conceptoStartTime')?.value || '') : '';
    const endTime = hasSchedule ? (document.getElementById('conceptoEndTime')?.value || '') : '';

    return {
      concept,
      price,
      quantity,
      startTime,
      endTime,
    };
  }

  duplicateService(serviceId) {
    const original = this.services.get(serviceId);
    if (!original) return;

    const newService = { ...original, id: this.generateId('svc') };
    this.services.set(newService.id, newService);

    this.renderServices();
    this.updateTotals();
    this.scheduleAutoSave();
  }

  deleteService(serviceId) {
    if (!confirm('Estas seguro de eliminar este servicio?')) return;

    this.services.delete(serviceId);
    this.detectOverlaps();
    this.renderServices();
    this.updateTotals();
    this.scheduleAutoSave();
  }

  // =====================
  // RENDERING
  // =====================

  // Recalcula la guía de los tours a pie que se cobran "por toda la experiencia":
  // guía = ChoferTour × Duración editable del header. Se aplica sobre la base a pie
  // (precio sin guía) para no duplicar, y actualiza price/unitPrice del servicio.
  // Walking tours en modo "por toda la experiencia": su total = suma de grupos ×
  // la duración de la experiencia. Como esa duración es editable (o la sugerida),
  // se recalcula en vivo cuando cambia.
  recomputeWalkingTourExperienceGuides() {
    // Duración del header si está puesta; si no, la duración total sugerida (suma
    // de todos los servicios) — así siempre cubre toda la experiencia.
    const globalDur = (parseFloat(document.getElementById('experienceDuration')?.value) / 60) || this.getSuggestedDurationHours();
    this.services.forEach((s) => {
      if (s.type === 'tour' && s.isWalkingTour && s.guideDurationMode === 'experience') {
        const perGroup = parseFloat(s.walkingPerGroup) || 0;
        s.price = perGroup * globalDur;
        s.unitPrice = s.price;
        s.guideCost = 0;
      }
    });
  }

  renderServices() {
    // Antes de pintar: recalcular las guías "por toda la experiencia" para que
    // tarjetas, total y duración sugerida reflejen la Duración editable actual.
    this.recomputeWalkingTourExperienceGuides();

    const container = document.getElementById('servicesContainer');
    const emptyState = document.getElementById('emptyStateContainer');
    if (!container || !emptyState) return;

    // F2 (total en vivo): recalcular desglose + totales en cada re-render de
    // servicios (agregar/editar/borrar), para que el total se actualice al instante.
    this.updatePriceBreakdown();
    // Duración sugerida = suma de los tiempos de los servicios (se recalcula en vivo).
    this.updateSuggestedDuration();

    if (this.services.size === 0) {
      container.classList.add('d-none');
      emptyState.classList.remove('d-none');
      return;
    }

    container.classList.remove('d-none');
    emptyState.classList.add('d-none');

    // Rescata el panel de edición inline fuera de la lista ANTES de limpiar (si estaba
    // debajo de una tarjeta, se destruiría con innerHTML='').
    this.moveServicePanelHome();
    container.innerHTML = '';
    this.services.forEach((service) => {
      container.innerHTML += this.renderServiceItem(service);
    });
    // Puebla el picker de vehículos directo en cada tarjeta con vehículo.
    this.populateCardPickers();
    // Puebla los selects de boletos (Entradas) inline.
    this.populateInlineEntradas();
    // Puebla los selects de experiencia inline.
    this.populateInlineExperienceSelects();
    // Puebla los selects de tour inline.
    this.populateInlineTourSelects();
    // Puebla los datalists de origen/destino (compartidos) para los rows de transporte inline.
    if ([...this.services.values()].some((s) => s.type === 'transport')) {
      this.populateMergedTransportLists();
    }
    // Habilita/deshabilita los toggles generales de guía/chofer según los servicios (al
    // agregar/borrar/cargar).
    this.syncGeneralTogglesFromServices();
  }

  // Devuelve el panel de servicio a su posición "home" (fuera de la lista de tarjetas).
  moveServicePanelHome() {
    const home = document.getElementById('svcPanelHome');
    const modal = document.getElementById('serviceModal');
    if (home && modal && home.nextElementSibling !== modal) {
      home.insertAdjacentElement('afterend', modal);
    }
  }

  updateSummary() {
    try {
      // Update services count
      const totalServices = this.services.size;
      const servicesCountElements = document.querySelectorAll('[data-services-count]');
      servicesCountElements.forEach(el => {
        el.textContent = totalServices;
      });

      // Update total pricing if summary section exists
      let totalPrice = 0;
      this.services.forEach(service => {
        const servicePrice = this.calculateServicePrice ? this.calculateServicePrice(service) : 0;
        if (typeof servicePrice === 'number') {
          totalPrice += servicePrice;
        }
      });

      const totalPriceElements = document.querySelectorAll('[data-total-price]');
      totalPriceElements.forEach(el => {
        el.textContent = `$${totalPrice.toFixed(2)}`;
      });

      console.log(`📊 Summary updated - Services: ${totalServices}, Total Price: $${totalPrice.toFixed(2)}`);
    } catch (error) {
      console.warn('⚠️ Error updating summary:', error);
    }
  }

  // Row inline para Concepto/Entradas: el propio row es el formulario (input/dropdown +
  // precio + cantidad), sin panel. Conserva el cálculo (precio × cantidad).
  renderInlineSimpleService(service) {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const isEntrada = service.type === 'entradas';
    const price = Number(service.price) || 0;
    const qty = Math.max(1, Number(service.quantity) || 1);
    const mainField = isEntrada
      ? `<div class="isvc-fld grow">
           <label class="isvc-lbl">Entrada</label>
           <select class="form-select form-select-sm inline-field" data-service-id="${service.id}" data-field="entrada">
             <option value="">Selecciona una entrada…</option>
           </select>
         </div>`
      : `<div class="isvc-fld grow">
           <label class="isvc-lbl">Concepto</label>
           <input type="text" class="form-control form-control-sm inline-field" data-service-id="${service.id}" data-field="concept" value="${esc(service.concept)}" placeholder="Describe el servicio…">
         </div>`;
    return `
      <div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${service.id}">
        <div class="d-flex align-items-end flex-wrap gap-2">
          ${mainField}
          <div class="isvc-fld">
            <label class="isvc-lbl">Precio</label>
            <div class="input-group input-group-sm" style="width:auto;">
              <span class="input-group-text">$</span>
              <input type="number" min="0" step="0.01" class="form-control inline-field" data-service-id="${service.id}" data-field="price" value="${price || ''}" placeholder="0.00" style="max-width:96px;">
            </div>
          </div>
          ${isEntrada ? '' : `
          <div class="isvc-fld">
            <label class="isvc-lbl">Tarifa</label>
            <div class="d-flex align-items-center gap-2" style="height:31px;">
              <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${service.id}" data-field="perPax" id="pp_${service.id}" ${service.perPax ? 'checked' : ''}><label class="form-check-label small" for="pp_${service.id}" title="Marcado: el precio se multiplica por los pax. Sin marcar: precio fijo.">Por persona</label></div>
            </div>
          </div>`}
          ${this.renderInlineGuiaChofer(service)}
          <button type="button" class="btn btn-light btn-sm delete-service-btn ms-auto align-self-center" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  }

  // Rellena los <select> de boletos (Entradas) inline tras renderServices.
  async populateInlineEntradas() {
    const selects = document.querySelectorAll('.inline-field[data-field="entrada"]');
    if (!selects.length) return;
    const all = await this.fetchAllEntradas();
    const groups = {};
    all.forEach((e) => {
      const g = e.destinoName || 'Sin destino';
      (groups[g] = groups[g] || []).push(e);
    });
    selects.forEach((sel) => {
      const service = this.services.get(sel.dataset.serviceId);
      const current = service ? (service.entradaId || '') : '';
      sel.innerHTML = '<option value="">Selecciona un boleto…</option>';
      Object.keys(groups).sort().forEach((g) => {
        const og = document.createElement('optgroup');
        og.label = g;
        groups[g].forEach((e) => {
          const o = document.createElement('option');
          o.value = e.id;
          o.textContent = `${e.name} · $${Number(e.price || 0).toLocaleString('es-MX')}`;
          o.dataset.name = e.name || '';
          o.dataset.price = Number(e.price || 0);
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
      if (current && !Array.from(sel.options).some((o) => o.value === current)) {
        const o = document.createElement('option');
        o.value = current; o.textContent = (service && service.concept) || current;
        o.dataset.name = (service && service.concept) || ''; o.dataset.price = (service && service.price) || 0;
        sel.appendChild(o);
      }
      sel.value = current;
    });
  }

  // Componente de duración inline en horas y minutos (mismo que usa Traslado). La fuente
  // de verdad sigue siendo service.hours (horas fraccionarias); aquí se muestra como h + m.
  renderInlineDurationHM(service, fieldH, fieldM) {
    const raw = service.hours != null ? service.hours : (service.durationHours != null ? service.durationHours : null);
    const has = raw != null && raw !== '';
    const totalH = has ? (Number(raw) || 0) : 0;
    const h = has ? Math.floor(totalH) : '';
    const m = has ? Math.round((totalH - Math.floor(totalH)) * 60) : '';
    return `
          <div class="isvc-fld">
            <label class="isvc-lbl">Duración</label>
            <div class="input-group input-group-sm" style="width:auto;">
              <input type="number" min="0" step="1" class="form-control inline-field" data-service-id="${service.id}" data-field="${fieldH}" value="${h}" placeholder="0" style="max-width:50px;" aria-label="Horas">
              <span class="input-group-text px-1">h</span>
              <input type="number" min="0" max="59" step="5" class="form-control inline-field" data-service-id="${service.id}" data-field="${fieldM}" value="${m}" placeholder="0" style="max-width:50px;" aria-label="Minutos">
              <span class="input-group-text px-1">m</span>
            </div>
          </div>`;
  }

  // Par de checkboxes Guía + Chofer (por servicio). Visible en TODOS los tipos para que
  // se vea de un vistazo qué servicios incluyen guía/chofer. El global de arriba los marca
  // en todos. (El modelo de costo se define aparte.)
  renderInlineGuiaChofer(service) {
    const id = service.id;
    // ms-auto: empuja el grupo a la derecha para que Guía/Chofer queden alineados igual
    // en TODOS los tipos (consistencia visual), justo antes del botón de eliminar.
    return `
          <div class="isvc-fld ms-auto">
            <label class="isvc-lbl">Incluye</label>
            <div class="d-flex align-items-center gap-2" style="height:31px;">
              <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="includeGuide" id="sg_${id}" ${service.includeGuide ? 'checked' : ''}><label class="form-check-label small" for="sg_${id}">Guía</label></div>
              <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="includeChofer" id="sc_${id}" ${service.includeChofer ? 'checked' : ''}><label class="form-check-label small" for="sc_${id}">Chofer</label></div>
            </div>
          </div>`;
  }

  // Row inline de Experiencia: dropdown de experiencia + duración + precios adulto/niño/
  // sin-alcohol. Los pax salen de la capacidad (Mín/Máx) → el desglose multiplica por pax.
  renderInlineExperienceService(service) {
    const a = Number(service.adultPrice) || 0;
    const c = (service.childPrice != null && service.childPrice !== '') ? service.childPrice : '';
    const n = (service.noAlcoholPrice != null && service.noAlcoholPrice !== '') ? service.noAlcoholPrice : '';
    const priceBox = (label, field, val) => `
      <div class="isvc-fld">
        <label class="isvc-lbl">${label}</label>
        <div class="input-group input-group-sm" style="width:auto;">
          <span class="input-group-text">$</span>
          <input type="number" min="0" step="0.01" class="form-control inline-field" data-service-id="${service.id}" data-field="${field}" value="${val === '' ? '' : val}" placeholder="0.00" style="max-width:90px;">
        </div>
      </div>`;
    return `
      <div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${service.id}">
        <div class="d-flex align-items-end flex-wrap gap-2">
          <div class="isvc-fld grow">
            <label class="isvc-lbl">Experiencia</label>
            <select class="form-select form-select-sm inline-field" data-service-id="${service.id}" data-field="experience">
              <option value="">Selecciona una experiencia…</option>
            </select>
          </div>
          ${this.renderInlineDurationHM(service, 'durHours', 'durMinutes')}
          ${this.renderInlineGuiaChofer(service)}
          <button type="button" class="btn btn-light btn-sm delete-service-btn align-self-center" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
        </div>
        <div class="d-flex align-items-end flex-wrap gap-2 mt-2">
          ${priceBox('Adulto', 'adultPrice', a || '')}
          ${priceBox('Niño', 'childPrice', c)}
          ${priceBox('Sin alcohol', 'noAlcoholPrice', n)}
        </div>
      </div>`;
  }

  // Rellena los <select> de experiencia inline (mismas fuentes que populateExperienceSelect).
  populateInlineExperienceSelects() {
    const selects = document.querySelectorAll('.inline-field[data-field="experience"]');
    if (!selects.length) return;
    const buildOptions = () => {
      const frag = document.createDocumentFragment();
      const expGroup = document.createElement('optgroup');
      expGroup.label = 'Experiencias';
      let has = false;
      this.experiencesCache.forEach((exp) => {
        if (exp.id !== this.experienceId && exp.type !== 'provider_experience') {
          const o = document.createElement('option');
          o.value = exp.id; o.textContent = exp.name;
          expGroup.appendChild(o); has = true;
        }
      });
      if (has) frag.appendChild(expGroup);
      const providerExps = this.providerExperiencesCache || [];
      providerExps.forEach((exp) => { if (!this.experiencesCache.has(exp.id)) this.experiencesCache.set(exp.id, exp); });
      const buildGroup = (label, predicate) => {
        const items = providerExps.filter(predicate);
        if (!items.length) return;
        const g = document.createElement('optgroup');
        g.label = label;
        items.forEach((exp) => {
          const o = document.createElement('option');
          o.value = exp.id;
          o.textContent = `${exp.name}${exp.provider ? ` (${exp.provider.name})` : ''}`;
          g.appendChild(o);
        });
        frag.appendChild(g);
      };
      buildGroup('Experiencias de Proveedores', (exp) => exp.provider?.type !== 'Establishment');
      buildGroup('Experiencias de Establecimientos', (exp) => exp.provider?.type === 'Establishment');
      return frag;
    };
    selects.forEach((sel) => {
      const service = this.services.get(sel.dataset.serviceId);
      const current = service ? (service.experienceId || '') : '';
      sel.innerHTML = '<option value="">Selecciona una experiencia…</option>';
      sel.appendChild(buildOptions());
      if (current && !Array.from(sel.options).some((o) => o.value === current)) {
        const o = document.createElement('option');
        o.value = current; o.textContent = (service && service.concept) || current;
        sel.appendChild(o);
      }
      sel.value = current;
    });
  }

  // Row inline de Transporte (full inline: ruta + segmento + vehículo + duración + toggles).
  // Reusa el picker de vehículos por capacidad (card-veh-picker) que ya recalcula el precio.
  renderInlineTransportService(service) {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const id = service.id;
    const durH = service.transportDurationHours != null ? service.transportDurationHours : '';
    const durM = service.transportDurationMinutes != null ? service.transportDurationMinutes : '';
    return `
      <div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${id}">
        <div class="mb-2"><span class="badge bg-success bg-opacity-25 text-success">Traslado</span></div>
        <div class="d-flex align-items-start flex-wrap gap-3">
          <!-- Izquierda: Origen arriba, Destino debajo. -->
          <div class="d-flex flex-column gap-2" style="flex:1 1 260px; min-width:200px;">
            <div class="isvc-fld">
              <label class="isvc-lbl">Origen</label>
              <input type="text" list="transportOriginList" class="form-control form-control-sm inline-field" data-service-id="${id}" data-field="transportOrigin" value="${esc(service.originName)}" placeholder="Origen…">
            </div>
            <div class="isvc-fld">
              <label class="isvc-lbl">Destino</label>
              <input type="text" list="transportDestinationList" class="form-control form-control-sm inline-field" data-service-id="${id}" data-field="transportDestination" value="${esc(service.destinationName)}" placeholder="Destino…">
            </div>
          </div>
          <!-- Derecha: Duración junto a [Incluye (Guía/Chofer) arriba · Opciones (Redondo/Greeter) debajo]. -->
          <div class="d-flex align-items-start gap-3 ms-auto">
            <div class="isvc-fld">
              <label class="isvc-lbl">Duración</label>
              <div class="input-group input-group-sm" style="width:auto;">
                <input type="number" min="0" step="1" class="form-control inline-field" data-service-id="${id}" data-field="transportDurHours" value="${durH}" placeholder="0" style="max-width:50px;" aria-label="Horas">
                <span class="input-group-text px-1">h</span>
                <input type="number" min="0" max="59" step="5" class="form-control inline-field" data-service-id="${id}" data-field="transportDurMinutes" value="${durM}" placeholder="0" style="max-width:50px;" aria-label="Minutos">
                <span class="input-group-text px-1">m</span>
              </div>
            </div>
            <div class="d-flex flex-column gap-2">
              <div class="isvc-fld">
                <label class="isvc-lbl">Incluye</label>
                <div class="d-flex align-items-center gap-2" style="height:31px;">
                  <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="includeGuide" id="sg_${id}" ${service.includeGuide ? 'checked' : ''}><label class="form-check-label small" for="sg_${id}">Guía</label></div>
                  <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="includeChofer" id="sc_${id}" ${service.includeChofer ? 'checked' : ''}><label class="form-check-label small" for="sc_${id}">Chofer</label></div>
                </div>
              </div>
              <div class="isvc-fld">
                <label class="isvc-lbl">Opciones</label>
                <div class="d-flex align-items-center gap-2" style="height:31px;">
                  <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="roundTrip" id="rt_${id}" ${service.roundTrip ? 'checked' : ''}><label class="form-check-label small" for="rt_${id}">Redondo</label></div>
                  <div class="form-check m-0"><input class="form-check-input inline-field" type="checkbox" data-service-id="${id}" data-field="includeGreeter" id="gr_${id}" ${service.includeGreeter ? 'checked' : ''}><label class="form-check-label small" for="gr_${id}">Greeter</label></div>
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-light btn-sm delete-service-btn" data-service-id="${id}" title="Eliminar"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="card-veh-picker mt-2" data-service-id="${id}"></div>
      </div>`;
  }

  // Costo guía/greeter de un transporte a partir del SERVICE (no del DOM del panel).
  guideGreeterCostForService(service) {
    let guide = 0;
    let greeter = 0;
    const durMin = (Number(service.transportDurationHours) || 0) * 60 + (Number(service.transportDurationMinutes) || 0);
    if (service.includeGuide) guide = this.calculateGuideTransportCost(durMin);
    if (service.includeGreeter) greeter = this.calculateGreeterPrice(durMin);
    return { guide, greeter };
  }

  // Recalcula el precio de un transporte inline con la MISMA fórmula que serviceAtPax:
  // (base × vehículos × rtMult) + guía + greeter. Deja price/guideCost/greeterCost al día.
  recomputeInlineTransportPrice(service) {
    const base = Number(service.unitPrice) || 0;
    const count = Math.max(1, Number(service.vehicleCount) || 1);
    const rtMult = service.roundTrip ? 2 : 1;
    const { guide, greeter } = this.guideGreeterCostForService(service);
    service.guideCost = guide;
    service.greeterCost = greeter;
    service.price = (base * count * rtMult) + guide + greeter;
  }

  // Debounce del refetch de vehículos por ruta (evita un fetch por tecla al escribir origen/destino).
  debounceRouteReload(serviceId) {
    if (!this.routeReloadTimers) this.routeReloadTimers = {};
    clearTimeout(this.routeReloadTimers[serviceId]);
    this.routeReloadTimers[serviceId] = setTimeout(() => this.reloadInlineTransportVehicles(serviceId), 450);
  }

  // Recarga el picker de vehículos de un transporte inline tras cambiar la ruta.
  async reloadInlineTransportVehicles(serviceId) {
    const service = this.services.get(serviceId);
    if (!service || service.type !== 'transport') return;
    const container = document.querySelector(`.card-veh-picker[data-service-id="${serviceId}"]`);
    if (!container) return;
    container.innerHTML = '<div class="text-muted small py-1"><span class="spinner-border spinner-border-sm me-1"></span>Cargando vehículos…</div>';
    const vehicles = await this.getCardVehiclesCached(service);
    this.applyRouteDurationToService(service); // autollena la duración de la ruta (si la hay)
    this.renderCardVehiclePicker(serviceId, container, vehicles);
    this.renderBreakdown();
  }

  // Autollena la duración del traslado con la de la RUTA (minutos, del backend) — editable.
  // Solo aplica si el backend la devolvió; refleja en los inputs h/m y recalcula (greeter, etc.).
  applyRouteDurationToService(service) {
    if (!service || service.type !== 'transport') return;
    const key = `${service.originName || ''}|${service.destinationName || ''}|${service.rateId || ''}`;
    const routeMin = this._routeDurationCache && this._routeDurationCache[key];
    if (routeMin == null || !(routeMin > 0)) return;
    const h = Math.floor(routeMin / 60);
    const m = Math.round(routeMin % 60);
    service.transportDurationHours = h;
    service.transportDurationMinutes = m;
    service.durationHours = routeMin / 60;
    service.hours = service.durationHours;
    const hEl = document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="transportDurHours"]`);
    const mEl = document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="transportDurMinutes"]`);
    if (hEl) hEl.value = h;
    if (mEl) mEl.value = m;
    this.recomputeInlineTransportPrice(service); // la duración afecta greeter/guía
  }

  // Row inline de Tour (full inline). Fork por modo: con vehículo (segmento + picker) o
  // a pie (precios por grupo + personas). Reusa el card-veh-picker y la lógica de precios.
  renderInlineTourService(service) {
    const id = service.id;
    const tour = service.tourId ? this.toursCache.get(service.tourId) : null;
    const isWalking = service.isWalkingTour || (tour && tour.isWalkingTour);
    const header = `
        <div class="d-flex align-items-end flex-wrap gap-2">
          <div class="isvc-fld grow">
            <label class="isvc-lbl">Tour</label>
            <select class="form-select form-select-sm inline-field" data-service-id="${id}" data-field="tour">
              <option value="">Selecciona un tour…</option>
            </select>
          </div>
          ${this.renderInlineDurationHM(service, 'durHours', 'durMinutes')}`;
    const del = `<button type="button" class="btn btn-light btn-sm delete-service-btn ms-auto align-self-center" data-service-id="${id}" title="Eliminar"><i class="ti ti-trash"></i></button>`;

    // Sin tour elegido aún: solo dropdown + duración.
    if (!service.tourId) {
      return `<div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${id}">
        ${header}
          ${del}
        </div>
      </div>`;
    }

    // Tour a pie: precios por grupo (S/M/L) + personas. El precio de grupo ya incluye guía.
    if (isWalking) {
      const tierInput = (label, field, val) => `
          <div class="isvc-fld">
            <label class="isvc-lbl">${label}</label>
            <div class="input-group input-group-sm" style="width:auto;">
              <span class="input-group-text">$</span>
              <input type="number" min="0" step="0.01" class="form-control inline-field" data-service-id="${id}" data-field="${field}" value="${val || ''}" placeholder="0" style="max-width:78px;">
            </div>
          </div>`;
      const lbl = (r, d) => (r ? `Grupo ${r}` : d);
      return `<div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${id}">
        ${header}
          ${this.renderInlineGuiaChofer(service)}
          ${del}
        </div>
        <div class="d-flex align-items-end flex-wrap gap-2 mt-2">
          ${tierInput(lbl(tour && tour.walkingRangeSmall, 'Grupo chico'), 'walkingPriceSmall', service.walkingPriceSmall)}
          ${tierInput(lbl(tour && tour.walkingRangeMedium, 'Grupo mediano'), 'walkingPriceMedium', service.walkingPriceMedium)}
          ${tierInput(lbl(tour && tour.walkingRangeLarge, 'Grupo grande'), 'walkingPriceLarge', service.walkingPriceLarge)}
        </div>
      </div>`;
    }

    // Tour con vehículo: segmento + picker (reusa card-veh-picker) + guía/chofer.
    return `<div class="service-item inline-svc mb-2 p-2 px-3 border rounded" data-service-id="${id}">
      ${header}
        ${this.renderInlineGuiaChofer(service)}
        ${del}
      </div>
      <div class="card-veh-picker mt-2" data-service-id="${id}"></div>
    </div>`;
  }

  // Rellena los <select> de tour inline (mismas fuentes que populateTourSelect).
  populateInlineTourSelects() {
    const selects = document.querySelectorAll('.inline-field[data-field="tour"]');
    if (!selects.length) return;
    const buildOptions = () => {
      const frag = document.createDocumentFragment();
      const vehicle = [];
      const walking = [];
      this.toursCache.forEach((t) => { (t.isWalkingTour ? walking : vehicle).push(t); });
      const group = (label, items) => {
        if (!items.length) return;
        const g = document.createElement('optgroup');
        g.label = label;
        items.forEach((t) => {
          const o = document.createElement('option');
          o.value = t.id;
          o.textContent = t.destinationPOI?.name || t.name || 'Sin destino';
          g.appendChild(o);
        });
        frag.appendChild(g);
      };
      group('Tours con Vehículo', vehicle);
      group('Tours a Pie', walking);
      return frag;
    };
    selects.forEach((sel) => {
      const service = this.services.get(sel.dataset.serviceId);
      const current = service ? (service.tourId || '') : '';
      sel.innerHTML = '<option value="">Selecciona un tour…</option>';
      sel.appendChild(buildOptions());
      if (current && !Array.from(sel.options).some((o) => o.value === current)) {
        const o = document.createElement('option');
        o.value = current; o.textContent = (service && service.concept) || current;
        sel.appendChild(o);
      }
      sel.value = current;
    });
  }

  // Horas que multiplican al tour a pie: por el tour (sus horas) o por la experiencia.
  walkingHoursForService(service) {
    if (service.guideDurationMode === 'experience') {
      return (parseFloat(document.getElementById('experienceDuration')?.value) / 60) || this.getSuggestedDurationHours();
    }
    return Number(service.hours) || 1;
  }

  // Suma de precios de grupo (según personas) para un tour a pie, desde el SERVICE.
  walkingPerGroupSumForService(service) {
    const tour = this.toursCache.get(service.tourId);
    if (!tour || !tour.isWalkingTour) return 0;
    const people = Math.max(1, Number(service.walkingPeopleCount) || 1);
    const pick = (v, fb) => ((v != null && v !== '') ? (Number(v) || 0) : (Number(fb) || 0));
    const tiers = [
      { range: this.parseWalkingTourRange(tour.walkingRangeSmall), price: pick(service.walkingPriceSmall, tour.walkingPriceSmall) },
      { range: this.parseWalkingTourRange(tour.walkingRangeMedium), price: pick(service.walkingPriceMedium, tour.walkingPriceMedium) },
      { range: this.parseWalkingTourRange(tour.walkingRangeLarge), price: pick(service.walkingPriceLarge, tour.walkingPriceLarge) },
    ].filter((t) => t.range);
    const sorted = [...tiers].sort((a, b) => (b.range.max === Infinity ? 999 : b.range.max) - (a.range.max === Infinity ? 999 : a.range.max));
    const groups = [];
    let remaining = people;
    while (remaining > 0 && sorted.length) {
      let best = null;
      for (const t of sorted) { if (remaining >= t.range.min) { best = t; break; } }
      if (!best) best = sorted[sorted.length - 1];
      const alloc = Math.min(remaining, best.range.max === Infinity ? remaining : best.range.max);
      groups.push(best);
      remaining -= alloc;
    }
    return groups.reduce((s, g) => s + (Number(g.price) || 0), 0);
  }

  // Recalcula el precio de un tour inline. A pie: suma de grupos × horas. Con vehículo:
  // base × vehículos × horas + guía (Chofer Tour × horas). Misma lógica que buildTourService.
  recomputeInlineTourPrice(service) {
    const tour = service.tourId ? this.toursCache.get(service.tourId) : null;
    const isWalking = service.isWalkingTour || (tour && tour.isWalkingTour);
    if (isWalking) {
      const perGroup = this.walkingPerGroupSumForService(service);
      const total = perGroup * this.walkingHoursForService(service);
      service.walkingPerGroup = perGroup;
      service.unitPrice = total; // walking: unitPrice = total (como buildTourService)
      service.guideCost = 0;
      service.price = total;
      return;
    }
    const base = Number(service.unitPrice) || 0;
    const count = Math.max(1, Number(service.vehicleCount) || 1);
    const hours = Number(service.hours) || 1;
    // Tour: el costo propio es el CHOFER (Chofer Tour × horas). La guía va por la barra general.
    const driver = service.includeChofer ? ((this.driverTourRateCache?.value || 0) * hours) : 0;
    service.guideCost = driver;
    service.price = (base * count * hours) + driver;
  }

  // Aplica el global de Guía/Chofer a TODOS los servicios: marca el flag por servicio y
  // recalcula el precio de los que lo cobran (transporte/tour). Repinta y autoguarda.
  applyGeneralGuideChoferToAll(field, checked) {
    this.services.forEach((service) => {
      service[field] = checked;
      if (service.type === 'tour') this.recomputeInlineTourPrice(service);
      else if (service.type === 'transport') this.recomputeInlineTransportPrice(service);
    });
    this.renderServices();
    this.renderBreakdown();
    this.updateTotals();
    this.scheduleAutoSave();
  }

  // Cambio de un campo inline: actualiza el service SIN re-render (para no perder foco),
  // refresca el desglose y autoguarda.
  onInlineFieldChange(el) {
    const service = this.services.get(el.dataset.serviceId);
    if (!service) return;
    const field = el.dataset.field;
    if (field === 'concept') {
      service.concept = el.value;
    } else if (field === 'price') {
      service.price = parseFloat(el.value) || 0;
    } else if (field === 'quantity') {
      service.quantity = Math.max(1, parseInt(el.value, 10) || 1);
    } else if (field === 'perPax') {
      service.perPax = el.checked; // Concepto: precio por persona (× pax) vs fijo
    } else if (field === 'entrada') {
      const opt = el.selectedOptions[0];
      service.entradaId = el.value || null;
      if (opt && opt.value) {
        service.concept = opt.dataset.name || opt.textContent;
        if (opt.dataset.price != null) {
          service.price = Number(opt.dataset.price) || 0;
          const priceInput = document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="price"]`);
          if (priceInput) priceInput.value = service.price || '';
        }
      }
    } else if (field === 'experience') {
      // Al elegir la experiencia: autollena concepto, precios y duración desde la cache.
      service.experienceId = el.value || null;
      const exp = el.value ? this.experiencesCache.get(el.value) : null;
      if (exp) {
        const isProvider = exp.type === 'provider_experience';
        service.concept = exp.name || 'Experiencia';
        service.isProviderExperience = isProvider;
        const ap = isProvider ? exp.price : exp.cost;
        if (ap != null && ap !== '') service.adultPrice = Number(ap) || 0;
        const cp = isProvider ? exp.price_child : exp.childPrice;
        service.childPrice = (cp == null || cp === '') ? null : (Number(cp) || 0);
        const np = isProvider ? exp.price_no_alcohol : exp.noAlcoholPrice;
        service.noAlcoholPrice = (np == null || np === '') ? null : (Number(np) || 0);
        if (exp.duration) {
          service.hours = parseFloat(exp.duration) || null;
          service.durationHours = parseFloat(exp.duration) || 0;
        }
        // Refleja los valores en los inputs inline sin re-render completo (conserva foco).
        const setF = (f, v) => {
          const i = document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="${f}"]`);
          if (i) i.value = (v == null ? '' : v);
        };
        setF('adultPrice', service.adultPrice || '');
        setF('childPrice', service.childPrice == null ? '' : service.childPrice);
        setF('noAlcoholPrice', service.noAlcoholPrice == null ? '' : service.noAlcoholPrice);
        setF('hours', service.hours == null ? '' : service.hours);
      }
    } else if (field === 'durHours' || field === 'durMinutes') {
      // Duración en horas + minutos (Experiencia/Tour). Fuente de verdad: service.hours (fracc.).
      const h = parseInt(document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="durHours"]`)?.value, 10) || 0;
      const m = parseInt(document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="durMinutes"]`)?.value, 10) || 0;
      service.hours = (h === 0 && m === 0) ? null : (h + (m / 60));
      service.durationHours = service.hours || 0;
      if (service.type === 'tour') this.recomputeInlineTourPrice(service);
    } else if (field === 'adultPrice') {
      service.adultPrice = parseFloat(el.value) || 0;
    } else if (field === 'childPrice') {
      service.childPrice = el.value === '' ? null : (parseFloat(el.value) || 0);
    } else if (field === 'noAlcoholPrice') {
      service.noAlcoholPrice = el.value === '' ? null : (parseFloat(el.value) || 0);
    } else if (field === 'transportOrigin') {
      service.originName = el.value.trim();
      this.debounceRouteReload(service.id);
    } else if (field === 'transportDestination') {
      service.destinationName = el.value.trim();
      this.debounceRouteReload(service.id);
    } else if (field === 'transportDurHours' || field === 'transportDurMinutes') {
      const h = parseInt(document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="transportDurHours"]`)?.value, 10) || 0;
      const m = parseInt(document.querySelector(`.inline-field[data-service-id="${service.id}"][data-field="transportDurMinutes"]`)?.value, 10) || 0;
      service.transportDurationHours = h;
      service.transportDurationMinutes = m;
      service.durationHours = h + (m / 60);
      service.hours = service.durationHours;
      this.recomputeInlineTransportPrice(service); // la duración afecta el costo de guía/greeter
    } else if (field === 'roundTrip') {
      service.roundTrip = el.checked;
      this.recomputeInlineTransportPrice(service);
    } else if (field === 'includeGuide') {
      service.includeGuide = el.checked;
      if (service.type === 'tour') this.recomputeInlineTourPrice(service);
      else if (service.type === 'transport') this.recomputeInlineTransportPrice(service);
      this.syncGeneralTogglesFromServices(); // si ya ningún servicio tiene guía, apaga la general
    } else if (field === 'includeChofer') {
      service.includeChofer = el.checked;
      if (service.type === 'tour') this.recomputeInlineTourPrice(service);
      else if (service.type === 'transport') this.recomputeInlineTransportPrice(service);
      this.syncGeneralTogglesFromServices(); // si ya ningún servicio tiene chofer, apaga el general
    } else if (field === 'includeGreeter') {
      service.includeGreeter = el.checked;
      if (service.type === 'tour') this.recomputeInlineTourPrice(service);
      else if (service.type === 'transport') this.recomputeInlineTransportPrice(service);
    } else if (field === 'tour') {
      // Elegir el tour cambia el LAYOUT del row (vehículo vs a pie) → re-render completo.
      service.tourId = el.value || null;
      const tour = el.value ? this.toursCache.get(el.value) : null;
      if (tour) {
        service.concept = tour.destinationPOI?.name || tour.name || 'Tour';
        service.isWalkingTour = !!tour.isWalkingTour;
        if (tour.time) {
          const hrs = parseInt(tour.time, 10) / 60;
          if (!isNaN(hrs) && hrs > 0) { service.hours = +hrs.toFixed(1); service.durationHours = service.hours; }
        }
        if (tour.isWalkingTour) {
          service.walkingPriceSmall = Number(tour.walkingPriceSmall) || 0;
          service.walkingPriceMedium = Number(tour.walkingPriceMedium) || 0;
          service.walkingPriceLarge = Number(tour.walkingPriceLarge) || 0;
          service.walkingPeopleCount = service.walkingPeopleCount || 1;
          this.recomputeInlineTourPrice(service);
        } else {
          // Tour con vehículo: se elige segmento/vehículo en el picker de abajo.
          service.vehicleId = null; service.vehicleType = null; service.vehicleTypeName = null;
          service.unitPrice = 0; service.vehicleCount = 1; service.rateId = null;
        }
      }
      this.renderServices();
    } else if (field === 'walkingPeople') {
      service.walkingPeopleCount = Math.max(1, parseInt(el.value, 10) || 1);
      this.recomputeInlineTourPrice(service);
    } else if (field === 'walkingPriceSmall') {
      service.walkingPriceSmall = el.value === '' ? null : (parseFloat(el.value) || 0);
      this.recomputeInlineTourPrice(service);
    } else if (field === 'walkingPriceMedium') {
      service.walkingPriceMedium = el.value === '' ? null : (parseFloat(el.value) || 0);
      this.recomputeInlineTourPrice(service);
    } else if (field === 'walkingPriceLarge') {
      service.walkingPriceLarge = el.value === '' ? null : (parseFloat(el.value) || 0);
      this.recomputeInlineTourPrice(service);
    }
    this.renderBreakdown();
    this.scheduleAutoSave();
  }

  // Alta inline directa (Concepto/Entradas/Experiencia): crea un row vacío y enfoca su
  // primer campo. Experiencia lleva campos de precios/duración; el resto solo concepto.
  addInlineService(type) {
    // Guía/Chofer por servicio arrancan según el estado GLOBAL (barra de arriba): si el
    // global está marcado, el servicio nuevo ya nace incluyéndolos (visible por servicio).
    const gGuide = document.getElementById('generalGuideToggle')?.checked || false;
    const gChofer = document.getElementById('generalChoferToggle')?.checked || false;
    const service = {
      id: this.generateId('svc'),
      type,
      concept: '',
      price: 0,
      quantity: 1,
      includeGuide: gGuide,
      includeChofer: gChofer,
    };
    if (type === 'experience') {
      Object.assign(service, {
        experienceId: null,
        adultPrice: 0,
        childPrice: null,
        noAlcoholPrice: null,
        hours: null,
        durationHours: 0,
        adultsQuantity: 0,
        childrenQuantity: 0,
        adultsNoAlcoholQuantity: 0,
      });
    } else if (type === 'transport') {
      Object.assign(service, {
        originName: '',
        destinationName: '',
        rateId: null,
        rateName: null,
        vehicleId: null,
        vehicleType: null,
        vehicleTypeName: null,
        vehicleCount: 1,
        unitPrice: 0,
        roundTrip: false,
        includeGreeter: false,
        transportDurationHours: null,
        transportDurationMinutes: null,
      });
    } else if (type === 'tour') {
      Object.assign(service, {
        tourId: null,
        isWalkingTour: false,
        rateId: null,
        vehicleId: null,
        vehicleType: null,
        vehicleTypeName: null,
        vehicleCount: 1,
        unitPrice: 0,
        hours: null,
        durationHours: 0,
        includeGreeter: false,
        guideDurationMode: 'tour',
        walkingPriceSmall: null,
        walkingPriceMedium: null,
        walkingPriceLarge: null,
        walkingPeopleCount: 1,
      });
    } else {
      service.entradaId = null;
    }
    this.services.set(service.id, service);
    this.renderServices();
    this.updateTotals();
    this.scheduleAutoSave();
    setTimeout(() => {
      const el = document.querySelector(`.inline-field[data-service-id="${service.id}"]`);
      if (el) el.focus();
    }, 60);
  }

  renderServiceItem(service) {
    const typeLabels = {
      experience: 'Experiencia',
      tour: 'Tour',
      transport: 'Transporte',
      concepto: 'Concepto',
      entradas: 'Entradas',
    };

    const servicePrice = this.calculateServicePrice(service);
    const title = service.concept || this.getServiceTitle(service);

    const overlapClass = service.hasOverlap ? ' has-overlap' : '';
    const overlapBadge = service.hasOverlap ? `
              <span class="overlap-warning-badge ms-2" title="${this.getOverlapTooltip(service)}">
                <i class="ti ti-alert-triangle"></i>
                <span>Conflicto de horario</span>
              </span>` : '';

    // Concepto / Entradas: row 100% inline (el row ES el formulario; sin panel).
    if (service.type === 'concepto' || service.type === 'entradas') {
      return this.renderInlineSimpleService(service);
    }

    // Experiencia: row 100% inline (dropdown + duración + precios adulto/niño/sin-alcohol).
    if (service.type === 'experience') {
      return this.renderInlineExperienceService(service);
    }

    // Transporte: row 100% inline (ruta + segmento + vehículo + duración + toggles).
    if (service.type === 'transport') {
      return this.renderInlineTransportService(service);
    }

    // Tour: row 100% inline (dropdown + duración + vehículo/segmento o precios por grupo).
    if (service.type === 'tour') {
      return this.renderInlineTourService(service);
    }

    // El cálculo de precio por servicio ya NO se muestra en la tarjeta: el precio real
    // por pax lo da el "Desglose por capacidad" (evita duplicar/confundir).
    const priceBreakdownHtml = '';

    // Duración del servicio (para ver/verificar la suma de la "duración sugerida").
    // Duración mostrada en la tarjeta. Para un walking tour en modo "por toda la
    // experiencia" muestra la duración de la experiencia (que es la que multiplica su
    // precio); en cualquier otro caso, la duración propia del servicio.
    let svcDurationHours = this.getServiceDurationHours(service);
    let svcDurationLabel = `${svcDurationHours} h`;
    if (service.type === 'tour' && service.isWalkingTour && service.guideDurationMode === 'experience') {
      const expDur = (parseFloat(document.getElementById('experienceDuration')?.value) / 60) || this.getSuggestedDurationHours();
      svcDurationHours = expDur;
      svcDurationLabel = `${expDur} h (toda la experiencia)`;
    }
    const svcDurationHtml = svcDurationHours > 0
      ? `<div class="col-auto"><i class="ti ti-clock-hour-3 me-1"></i>${svcDurationLabel}</div>`
      : '';

    return `
      <div class="service-item mb-3 p-3 border rounded hover-shadow${overlapClass}" data-service-id="${service.id}" style="animation: fadeInUp 0.3s ease;">
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center mb-2">
              <span class="badge bg-light text-dark me-2">${service.type === 'tour' && service.isWalkingTour ? 'Walking Tour' : (typeLabels[service.type] || service.type)}</span>
              <h6 class="mb-0 service-title">${title}</h6>${overlapBadge}
            </div>
            <div class="service-details">
              <div class="row g-2 text-muted small">
                ${service.selectedSchedule || service.startTime ? `
                  <div class="col-auto"><i class="ti ti-clock me-1"></i>${service.selectedSchedule || (service.startTime + (service.endTime ? ' - ' + service.endTime : ''))}</div>
                ` : ''}
                ${(service.vehicleTypeName && !(service.type === 'tour' && service.vehicleId)) ? `
                  <div class="col-auto"><i class="ti ti-car me-1"></i>${service.vehicleCount > 1 ? `${service.vehicleCount}× ` : ''}${service.vehicleTypeName}</div>
                ` : ''}
                ${svcDurationHtml}
              </div>
              ${(service.type === 'tour' && service.vehicleId) ? `
                <div class="card-veh-picker mt-2" data-service-id="${service.id}"></div>
              ` : ''}
              ${this.renderPeopleQuantities(service)}
              ${priceBreakdownHtml}
              ${service.includeGuide ? '<div class="text-success small mt-1"><i class="ti ti-user me-1"></i><strong>Incluye Guia + Chofer</strong></div>' : ''}
              ${service.includeGreeter ? '<div class="text-info small mt-1"><i class="ti ti-users me-1"></i><strong>Incluye Greeter</strong></div>' : ''}
              ${service.notes ? `<div class="text-muted small mt-1"><i class="ti ti-notes me-1"></i>${service.notes}</div>` : ''}
            </div>
          </div>
          <div class="service-actions d-flex flex-column align-items-end justify-content-between">
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-light edit-service-btn" data-service-id="${service.id}" title="Editar"><i class="ti ti-pencil"></i></button>              <button type="button" class="btn btn-light delete-service-btn" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderTransportServiceItem(service, servicePrice, overlapClass, overlapBadge) {
    // Transport type badge
    const transportTypeLabels = {
      aeropuerto: 'Aeropuerto',
      'punto-a-punto': 'Punto a Punto',
      local: 'Local',
    };
    const transportTypeBadge = service.transportType
      ? `<span class="badge bg-success bg-opacity-25 text-success me-1">${transportTypeLabels[service.transportType] || service.transportType}</span>`
      : '';

    // Direction badge
    const directionLabels = {
      arrival: service.transportType === 'aeropuerto' ? 'Llegada' : 'Ida',
      departure: service.transportType === 'aeropuerto' ? 'Salida' : 'Vuelta',
    };
    const directionBadge = service.directionType
      ? `<span class="badge bg-warning bg-opacity-25 text-warning">${directionLabels[service.directionType] || service.directionType}</span>`
      : '';
    const tripBadge = service.tripType === 'round-trip'
      ? '<span class="badge bg-info bg-opacity-25 text-info">Round Trip</span>'
      : '';

    // Route display
    const origin = service.originName || '';
    const destination = service.destinationName || '';
    const routeHtml = (origin || destination) ? `
      <div class="mt-2 ms-1" style="border-left: 3px solid #dee2e6; padding-left: 10px;">
        ${origin ? `<div class="small text-dark">${origin}</div>` : ''}
        ${destination ? `<div class="small text-dark">${destination}</div>` : ''}
      </div>
    ` : '';

    // Vehicle
    const vehCount = service.vehicleCount || 1;
    const vehicleHtml = service.vehicleTypeName
      ? `${service.tripType === 'round-trip' ? '<div class="small text-info mt-2"><i class="ti ti-arrows-exchange me-1"></i>Ida y Regreso ×2</div>' : ''}
         <div class="card-veh-picker mt-2" data-service-id="${service.id}"></div>`
      : '';

    // Greeter
    const greeterHtml = service.includeGreeter
      ? '<div class="small text-warning mt-1"><i class="ti ti-users me-1"></i><strong>Incluye Greeter</strong></div>'
      : '';

    // Guide
    const guideHtml = service.includeGuide
      ? '<div class="small text-success mt-1"><i class="ti ti-user me-1"></i><strong>Incluye Guia + Chofer</strong></div>'
      : '';

    // Waiting time
    const waitingHtml = service.waitingTimeHours > 0
      ? `<div class="small text-warning mt-1"><i class="ti ti-clock me-1"></i><strong>Tiempo de espera: ${service.waitingTimeHours}h</strong></div>`
      : '';

    return `
      <div class="service-item mb-3 p-3 border rounded hover-shadow${overlapClass}" data-service-id="${service.id}" style="animation: fadeInUp 0.3s ease;">
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center flex-wrap gap-1 mb-1">
              <span class="badge bg-light text-dark">Transporte</span>
              ${transportTypeBadge}
              ${tripBadge || directionBadge}
              ${overlapBadge}
            </div>
            ${routeHtml}
            ${vehicleHtml}
            ${guideHtml}
            ${greeterHtml}
            ${waitingHtml}
          </div>
          <div class="service-actions d-flex flex-column align-items-end justify-content-between">
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-light edit-service-btn" data-service-id="${service.id}" title="Editar"><i class="ti ti-pencil"></i></button>              <button type="button" class="btn btn-light delete-service-btn" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderPeopleQuantities(service) {
    if (service.type !== 'experience' && service.type !== 'tour' && service.type !== 'concepto') return '';
    const adults = service.adultsQuantity || 0;
    const children = service.childrenQuantity || 0;
    const noAlc = service.adultsNoAlcoholQuantity || 0;

    // If no quantities but prices exist, show simulated single person
    const hasNoPeople = adults === 0 && children === 0 && noAlc === 0;
    const hasPrices = (service.adultPrice > 0) || (service.childPrice > 0) || (service.noAlcoholPrice > 0);

    // El desglose de precios ya muestra el simulado de 1 persona; no lo repetimos aquí.
    if (hasNoPeople && hasPrices) {
      return '';
    }

    if (hasNoPeople) return '';

    const parts = [];
    if (adults > 0) parts.push(`${adults} adulto${adults > 1 ? 's' : ''}`);
    if (children > 0) parts.push(`${children} niño${children > 1 ? 's' : ''}`);
    if (noAlc > 0) parts.push(`${noAlc} s/alcohol`);

    return `<div class="text-muted small mt-1"><i class="ti ti-users me-1"></i>${parts.join(' + ')}</div>`;
  }

  // Desglose por grupos del tour a pie para la tarjeta del servicio: reparte las
  // personas en tramos (rangos del tour) y muestra cada grupo × horas.
  renderWalkingTourBreakdown(service) {
    const tour = this.toursCache.get(service.tourId);
    if (!tour) return '';
    const peopleCount = Math.max(1, parseInt(service.walkingPeopleCount, 10) || 1);
    // Horas del multiplicador: por toda la experiencia (duración global) o por el tour.
    const hours = service.guideDurationMode === 'experience'
      ? ((parseFloat(document.getElementById('experienceDuration')?.value) / 60) || this.getSuggestedDurationHours())
      : (parseFloat(service.hours) || 1);
    const priceOf = (svc, fb) => (parseFloat(svc) || parseFloat(fb) || 0);
    const tiers = [
      { label: tour.walkingRangeSmall, range: this.parseWalkingTourRange(tour.walkingRangeSmall), price: priceOf(service.walkingPriceSmall, tour.walkingPriceSmall) },
      { label: tour.walkingRangeMedium, range: this.parseWalkingTourRange(tour.walkingRangeMedium), price: priceOf(service.walkingPriceMedium, tour.walkingPriceMedium) },
      { label: tour.walkingRangeLarge, range: this.parseWalkingTourRange(tour.walkingRangeLarge), price: priceOf(service.walkingPriceLarge, tour.walkingPriceLarge) },
    ].filter((t) => t.range);
    if (!tiers.length) return '';

    const sorted = [...tiers].sort((a, b) => (b.range.max === Infinity ? 999 : b.range.max) - (a.range.max === Infinity ? 999 : a.range.max));
    const groups = [];
    let remaining = peopleCount;
    while (remaining > 0 && sorted.length) {
      let best = null;
      for (const t of sorted) { if (remaining >= t.range.min) { best = t; break; } }
      if (!best) best = sorted[sorted.length - 1];
      const alloc = Math.min(remaining, best.range.max === Infinity ? remaining : best.range.max);
      groups.push({ tier: best, count: alloc });
      remaining -= alloc;
    }
    if (!groups.length) return '';

    const hoursLabel = hours > 1 ? ` × ${hours} h` : '';
    const lines = groups.map((g) => `
        <div class="d-flex justify-content-between small">
          <span>Grupo ${g.tier.label || ''} (${g.count} pax)${hoursLabel}</span>
          <span class="fw-semibold">$${(g.tier.price * hours).toFixed(2)}</span>
        </div>
      `);
    return `
      <div class="price-breakdown mt-2 p-2 bg-light rounded">
        <div class="small fw-bold mb-1">${peopleCount} ${peopleCount > 1 ? 'personas' : 'persona'}:</div>
        ${lines.join('')}
      </div>
    `;
  }

  renderPriceBreakdown(service) {
    if (service.type !== 'experience' && service.type !== 'tour') return '';

    // Tour a pie: desglose por GRUPOS (no usa precio por persona).
    if (service.type === 'tour' && service.isWalkingTour) {
      return this.renderWalkingTourBreakdown(service);
    }

    const adults = service.adultsQuantity || 0;
    const children = service.childrenQuantity || 0;
    const noAlc = service.adultsNoAlcoholQuantity || 0;
    const adultPrice = service.adultPrice || 0;
    const childPrice = service.childPrice || 0;
    const noAlcPrice = service.noAlcoholPrice || 0;

    // If no quantities but prices exist, simulate single person pricing
    const hasNoPeople = adults === 0 && children === 0 && noAlc === 0;
    const hasPrices = adultPrice > 0 || childPrice > 0 || noAlcPrice > 0;

    if (hasNoPeople && hasPrices) {
      const breakdownParts = [];

      if (adultPrice > 0) {
        const total = adultPrice * 1;
        breakdownParts.push(`<span class="text-primary">Adulto: $${adultPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</span>`);
      }
      if (childPrice > 0) {
        const total = childPrice * 1;
        breakdownParts.push(`<span class="text-info">Niño: $${childPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</span>`);
      }
      if (noAlcPrice > 0) {
        const total = noAlcPrice * 1;
        breakdownParts.push(`<span class="text-warning">Sin Alcohol: $${noAlcPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</span>`);
      }

      return `
        <div class="price-breakdown mt-2 p-2 bg-light rounded">
          <div class="small">${breakdownParts.join('<br>')}</div>
        </div>
      `;
    }

    // Show actual breakdown for selected quantities
    const breakdownLines = [];

    if (adults > 0 && adultPrice > 0) {
      const adultsTotal = adults * adultPrice;
      breakdownLines.push(`
        <div class="d-flex justify-content-between small">
          <span>Adultos: $${adultPrice.toFixed(2)} × ${adults}</span>
          <span class="fw-semibold">$${adultsTotal.toFixed(2)}</span>
        </div>
      `);
    }

    if (children > 0 && childPrice > 0) {
      const childrenTotal = children * childPrice;
      breakdownLines.push(`
        <div class="d-flex justify-content-between small">
          <span>Niños: $${childPrice.toFixed(2)} × ${children}</span>
          <span class="fw-semibold">$${childrenTotal.toFixed(2)}</span>
        </div>
      `);
    }

    if (noAlc > 0 && noAlcPrice > 0) {
      const noAlcTotal = noAlc * noAlcPrice;
      breakdownLines.push(`
        <div class="d-flex justify-content-between small">
          <span>Sin Alcohol: $${noAlcPrice.toFixed(2)} × ${noAlc}</span>
          <span class="fw-semibold">$${noAlcTotal.toFixed(2)}</span>
        </div>
      `);
    }

    if (breakdownLines.length === 0) return '';

    return `
      <div class="price-breakdown mt-2 p-2 bg-light rounded">
        ${breakdownLines.join('')}
      </div>
    `;
  }

  getServiceTitle(service) {
    if (service.concept) return service.concept;
    if (service.experienceId) {
      const exp = this.experiencesCache.get(service.experienceId);
      return exp ? exp.name : 'Experiencia';
    }
    if (service.tourId) {
      const tour = this.toursCache.get(service.tourId);
      return tour ? (tour.name || tour.destination) : 'Tour';
    }
    return 'Servicio';
  }

  // =====================
  // PRICING
  // =====================

  calculateServicePrice(service) {
    // Los TOURS no usan precio por persona (adulto/niño): su precio es base × horas
    // (+ guía), ya calculado y guardado en service.price. Por eso NO entran a esta
    // rama; caen al retorno de abajo (service.price × quantity) para no quedar en $0.
    if (service.type === 'experience') {
      const adults = service.adultsQuantity || 0;
      const children = service.childrenQuantity || 0;
      const noAlc = service.adultsNoAlcoholQuantity || 0;
      const adultPrice = service.adultPrice || 0;
      const childPrice = service.childPrice || 0;
      const noAlcPrice = service.noAlcoholPrice || 0;

      // If no quantities but prices exist, simulate single person pricing for display
      const hasNoPeople = adults === 0 && children === 0 && noAlc === 0;
      const hasPrices = adultPrice > 0 || childPrice > 0 || noAlcPrice > 0;

      if (hasNoPeople && hasPrices) {
        // Calculate simulated total for 1 person
        let simulatedTotal = 0;
        if (adultPrice > 0) simulatedTotal += adultPrice * 1;
        if (childPrice > 0) simulatedTotal += childPrice * 1;
        if (noAlcPrice > 0) simulatedTotal += noAlcPrice * 1;
        return simulatedTotal;
      }

      // Calculate actual totals
      const adultsTotal = adults * adultPrice;
      const childrenTotal = children * childPrice;
      const noAlcTotal = noAlc * noAlcPrice;
      return adultsTotal + childrenTotal + noAlcTotal;
    }
    return (service.price || 0) * (service.quantity || 1);
  }

  calculateSubtotal() {
    let subtotal = 0;
    this.services.forEach((service) => {
      subtotal += this.calculateServicePrice(service);
    });
    return Math.round(subtotal * 100) / 100;
  }

  updateTotals() {
    // Simplified version - bottom panel UI elements were removed
    this.renderBreakdown();
    // Only dispatch event for cross-panel updates
    window.dispatchEvent(new CustomEvent('servicesUpdated'));
  }

  // F2 (total en vivo): refleja el total de servicios en el header, siempre visible
  // mientras se construye la experiencia (como el total corriente de una cotización).
  setHeaderTotal(amount) {
    const el = document.getElementById('expHeaderTotal');
    if (!el) return;
    const n = Number(amount) || 0;
    el.textContent = `$${n.toFixed(2)}`;
    const wrap = document.getElementById('expHeaderTotalWrap');
    if (wrap) wrap.classList.remove('d-none');
  }

  // "HH:MM" -> minutos (para duración por horario). null si no es válido.
  parseTimeToMinutes(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return (parseInt(m[1], 10) * 60) + parseInt(m[2], 10);
  }

  // Duración de UN servicio en horas: duración explícita (tour = horas;
  // transporte/experiencia = durationHours) y, si no, por horario (fin - inicio).
  getServiceDurationHours(service) {
    let h = 0;
    if (service.hours) {
      h = parseFloat(service.hours) || 0;
    } else if (service.durationHours) {
      h = parseFloat(service.durationHours) || 0;
    } else {
      const start = this.parseTimeToMinutes(service.startTime);
      const end = this.parseTimeToMinutes(service.endTime);
      if (start != null && end != null && end > start) h = (end - start) / 60;
    }
    // Guarda: >48 h en un solo servicio es casi seguro minutos guardados como horas
    // (dato legacy) → normaliza para que la "duración sugerida" no se dispare.
    if (h > 48) h = h / 60;
    return h;
  }

  // Suma de las duraciones de todos los servicios = duración sugerida de la experiencia.
  getSuggestedDurationHours() {
    let total = 0;
    this.services.forEach((s) => { total += this.getServiceDurationHours(s); });
    return Math.round(total * 100) / 100;
  }

  // Etiqueta "Duración sugerida: X h" en el header (con enlace para aplicarla al campo).
  updateSuggestedDuration() {
    const el = document.getElementById('expSuggestedDuration');
    if (!el) return;
    const suggested = this.getSuggestedDurationHours();
    if (suggested <= 0) { el.innerHTML = ''; return; }
    el.innerHTML = `Sugerida: <strong>${suggested} h</strong> · <a href="#" id="expUseSuggestedDuration">usar</a>`;
    const link = document.getElementById('expUseSuggestedDuration');
    if (link) {
      link.onclick = (e) => {
        e.preventDefault();
        // La duración ahora se guarda en MINUTOS (picker amigable); la sugerida se calcula en horas.
        const suggestedMinutes = Math.round(suggested * 60);
        const hidden = document.getElementById('experienceDuration');
        const picker = hidden ? hidden.closest('.advance-time-picker') : null;
        if (picker && window.AdvanceTimePicker) {
          window.AdvanceTimePicker.set(picker, suggestedMinutes);
        } else if (hidden) {
          hidden.value = suggestedMinutes;
        }
      };
    }
  }

  updatePriceBreakdown() {
    // Update the information panel breakdown (not the removed bottom panel)
    const breakdownListEl = document.getElementById('servicesBreakdownList');
    const servicesTotalCostEl = document.getElementById('servicesTotalCost');
    const servicesPerPersonCostEl = document.getElementById('servicesPerPersonCost');

    if (!breakdownListEl) return;

    // Clear existing breakdown
    breakdownListEl.innerHTML = '';

    if (this.services.size === 0) {
      breakdownListEl.innerHTML = `
        <div class="text-center text-muted py-3">
          <i class="ti ti-package-off"></i>
          <p class="mb-0 small">No hay servicios agregados aun</p>
          <p class="mb-0 small text-muted">Los servicios se agregan en la seccion Servicios</p>
        </div>
      `;

      // Update totals to zero
      if (servicesTotalCostEl) servicesTotalCostEl.textContent = '$0.00';
      if (servicesPerPersonCostEl) servicesPerPersonCostEl.textContent = '$0.00';
      this.setHeaderTotal(0); // F2: total en vivo del header
      return;
    }

    let totalServicesCost = 0;

    // Build the breakdown list
    this.services.forEach((service) => {
      const servicePrice = this.calculateServicePrice(service);
      const serviceTitle = this.getServiceTitle(service);
      const quantity = service.quantity || 1;
      const subtotal = servicePrice * quantity;
      totalServicesCost += subtotal;

      const breakdownItem = document.createElement('div');
      breakdownItem.className = 'service-breakdown-item mb-3 pb-3 border-bottom';

      let details = [];
      if (service.startTime) details.push(`Hora: ${service.startTime}`);
      if (service.vehicleTypeName) {
        const vehicleDetail = service.tripType === 'round-trip'
          ? `Vehículo: ${service.vehicleTypeName} (Ida y Regreso ×2)`
          : `Vehículo: ${service.vehicleTypeName}`;
        details.push(vehicleDetail);
      }
      if (quantity > 1 && service.type !== 'experience' && service.type !== 'tour') {
        details.push(`Cantidad: ${quantity}`);
      }

      // Build price breakdown for experiences and tours with static simulado
      let priceDetailsHtml = '';
      if (service.type === 'experience' || service.type === 'tour') {
        const adults = service.adultsQuantity || 0;
        const children = service.childrenQuantity || 0;
        const noAlc = service.adultsNoAlcoholQuantity || 0;
        const adultPrice = service.adultPrice || 0;
        const childPrice = service.childPrice || 0;
        const noAlcPrice = service.noAlcoholPrice || 0;

        const priceLines = [];

        // If no quantities but prices exist, show static simulado pricing
        const hasNoPeople = adults === 0 && children === 0 && noAlc === 0;
        const hasPrices = adultPrice > 0 || childPrice > 0 || noAlcPrice > 0;

        if (hasNoPeople && hasPrices) {
          if (adultPrice > 0) {
            const total = adultPrice * 1;
            priceLines.push(`<div class="small ms-3">• 1 Adulto: $${adultPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</div>`);
          }
          if (childPrice > 0) {
            const total = childPrice * 1;
            priceLines.push(`<div class="small ms-3">• 1 Niño: $${childPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</div>`);
          }
          if (noAlcPrice > 0) {
            const total = noAlcPrice * 1;
            priceLines.push(`<div class="small ms-3">• 1 Sin Alcohol: $${noAlcPrice.toFixed(2)} × 1 = $${total.toFixed(2)}</div>`);
          }
        } else {
          // Show actual breakdown
          if (adults > 0 && adultPrice > 0) {
            const adultsTotal = adults * adultPrice;
            priceLines.push(`<div class="small ms-3">• ${adults} Adulto${adults > 1 ? 's' : ''}: $${adultPrice.toFixed(2)} × ${adults} = $${adultsTotal.toFixed(2)}</div>`);
          }
          if (children > 0 && childPrice > 0) {
            const childrenTotal = children * childPrice;
            priceLines.push(`<div class="small ms-3">• ${children} Niño${children > 1 ? 's' : ''}: $${childPrice.toFixed(2)} × ${children} = $${childrenTotal.toFixed(2)}</div>`);
          }
          if (noAlc > 0 && noAlcPrice > 0) {
            const noAlcTotal = noAlc * noAlcPrice;
            priceLines.push(`<div class="small ms-3">• ${noAlc} Sin Alcohol: $${noAlcPrice.toFixed(2)} × ${noAlc} = $${noAlcTotal.toFixed(2)}</div>`);
          }
        }

        if (priceLines.length > 0) {
          priceDetailsHtml = priceLines.join('');
        }
      }

      breakdownItem.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1">
            <div class="service-breakdown-name fw-semibold">${serviceTitle}</div>
            ${details.length > 0 ? `<div class="service-breakdown-details text-muted small">${details.join(' | ')}</div>` : ''}
            ${priceDetailsHtml}
          </div>
          <div class="text-end">
            <div class="service-breakdown-price fw-bold">$${servicePrice.toFixed(2)}</div>
            ${quantity > 1 && service.type !== 'experience' && service.type !== 'tour' ? `<small class="text-muted">x${quantity} = $${subtotal.toFixed(2)}</small>` : ''}
          </div>
        </div>
      `;

      breakdownListEl.appendChild(breakdownItem);
    });

    // Calculate per person cost using fixed 1 person for simplicity
    const perPersonCost = Math.round(totalServicesCost * 100) / 100;

    // Update summary totals in information panel
    if (servicesTotalCostEl) servicesTotalCostEl.textContent = `$${totalServicesCost.toFixed(2)}`;
    if (servicesPerPersonCostEl) servicesPerPersonCostEl.textContent = `$${perPersonCost.toFixed(2)}`;
    this.setHeaderTotal(totalServicesCost); // F2: total en vivo del header
  }

  // =====================
  // PERSONA COUNT HELPER
  // =====================

  // Removed: getPersonCount() method - no longer needed after bottom panel removal

  // =====================
  // AUTO-SAVE
  // =====================

  scheduleAutoSave() {
    this.hasUnsavedChanges = true;
    this.updateSaveStatus('unsaved');

    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);

    this.autoSaveTimer = setTimeout(async () => {
      try {
        this.updateSaveStatus('saving');
        await this.saveToBackend();
        this.hasUnsavedChanges = false;
        this.updateSaveStatus('saved');
      } catch (error) {
        console.error('Auto-save failed:', error);
        this.updateSaveStatus('error');
      }
    }, 2000);
  }

  // F3 (draft-first): asegura que exista un borrador de experiencia (active:false)
  // para guardar servicios directo, sin localStorage. Devuelve el id del borrador,
  // o null si falta el nombre (en cuyo caso avisa amablemente al usuario).
  async ensureDraftExperience() {
    if (this._draftExperienceId) return this._draftExperienceId;
    if (window.__experienceDraftId) {
      this._draftExperienceId = window.__experienceDraftId;
      return this._draftExperienceId;
    }

    const name = (document.getElementById('experienceName')?.value || '').trim();
    const type = (document.getElementById('experienceType')?.value || '').trim() || 'Experience';
    const description = (document.getElementById('experienceDescription')?.value || '').trim();
    if (!name) {
      this.showBasicInfoRequired();
      return null;
    }

    const accessToken = this.getAccessToken();
    if (!accessToken) throw new Error('No access token found');

    const response = await fetch('/api/experiences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      // cost:0 satisface la validación del create; el form de Información pone el
      // costo real al finalizar el borrador.
      body: JSON.stringify({ name, description: description || name, type, cost: 0, active: false }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo crear el borrador de la experiencia');
    }

    const result = await response.json();
    const id = (result.data && result.data.id) || result.id;
    if (!id) throw new Error('El borrador se creó sin id');

    this._draftExperienceId = id;
    // El form de Información finaliza este borrador (active:true) al guardar.
    window.__experienceDraftId = id;
    console.log('✅ F3 draft-first: borrador de experiencia creado', id);
    return id;
  }

  // Aviso amable cuando falta el nombre para poder crear el borrador (no se pierde
  // lo que el usuario ya configuró en el servicio).
  showBasicInfoRequired() {
    const msg = 'Escribe primero el nombre de la experiencia (arriba) para poder guardar los servicios.';
    if (typeof window.showAlert === 'function') window.showAlert(msg, 'warning');
    else window.alert(msg);
    const nameEl = document.getElementById('experienceName');
    if (nameEl) {
      nameEl.focus();
      nameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async saveToBackend() {
    // F3 (draft-first): en vez de acumular en localStorage, aseguramos un borrador
    // real (active:false) y guardamos los servicios directo contra él.
    if (this.experienceId === 'new') {
      const draftId = await this.ensureDraftExperience();
      if (!draftId) return; // faltó el nombre; ya se avisó al usuario
      this.experienceId = draftId;
    }

    const subtotal = this.calculateSubtotal();
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    const subconcepts = [];
    this.services.forEach((service) => {
      const servicePrice = this.calculateServicePrice(service);
      // Concepto/Entradas: guarda el PRECIO UNITARIO (no el total), para que al recargar
      // el row inline muestre el precio por unidad. Otros tipos: quantity=1, sin cambio.
      const isSimple = service.type === 'concepto' || service.type === 'entradas';
      const storedUnit = isSimple ? (Number(service.price) || 0) : servicePrice;
      subconcepts.push({
        type: service.type || 'other',
        concept: service.concept || this.getServiceTitle(service),
        time: service.startTime || null,
        endTime: service.endTime || null,
        vehicleId: service.vehicleId || null,
        vehicleType: service.vehicleType || null,
        vehicleTypeName: service.vehicleTypeName || null,
        unitPrice: storedUnit,
        quantity: service.quantity || 1,
        perPax: service.perPax || false,
        notes: service.notes || '',
        hours: service.hours || null,
        durationHours: service.durationHours || null,
        total: storedUnit * (service.quantity || 1),
        experienceId: service.experienceId || null,
        tourId: service.tourId || null,
        entradaId: service.entradaId || null,
        rateId: service.rateId || null,
        hotelName: service.hotelName || null,
        adultsQuantity: service.adultsQuantity || null,
        childrenQuantity: service.childrenQuantity || null,
        adultsNoAlcoholQuantity: service.adultsNoAlcoholQuantity || null,
        selectedSchedule: service.selectedSchedule || null,
        adultPrice: service.adultPrice || null,
        childPrice: service.childPrice || null,
        noAlcoholPrice: service.noAlcoholPrice || null,
        includeGuide: service.includeGuide || false,
        includeChofer: service.includeChofer || false,
        guideDurationMode: service.guideDurationMode || 'tour',
        includeGreeter: service.includeGreeter || false,
        greeterInVehicle: service.greeterInVehicle || false,
        waitingTimeHours: service.waitingTimeHours || 0,
        transportType: service.transportType || null,
        directionType: service.directionType || null,
        tripType: service.tripType || null,
        originName: service.originName || null,
        destinationName: service.destinationName || null,
        rateName: service.rateName || null,
        roundTrip: service.roundTrip || false,
        vehicleCount: service.vehicleCount || 1,
        vehicleByPax: service.vehicleByPax || null,
        transportBase: service.type === 'transport' ? (service.unitPrice || 0) : null,
        // Base por vehículo del tour (para editar/desglosar sin perder el precio unitario).
        tourBase: (service.type === 'tour' && !service.isWalkingTour) ? (service.unitPrice || 0) : null,
        transportDurationHours: service.transportDurationHours ?? null,
        transportDurationMinutes: service.transportDurationMinutes ?? null,
        isWalkingTour: service.isWalkingTour || false,
        walkingPriceSmall: service.walkingPriceSmall || null,
        walkingPerGroup: service.walkingPerGroup != null ? service.walkingPerGroup : null,
        walkingPriceMedium: service.walkingPriceMedium || null,
        walkingPriceLarge: service.walkingPriceLarge || null,
        walkingPeopleCount: service.walkingPeopleCount || null,
        languages: service.languages || '',
        clientNotes: service.clientNotes || '',
      });
    });

    const serviceItemsData = { subconcepts, subtotal, iva, total };

    const accessToken = this.getAccessToken();
    if (!accessToken) throw new Error('No access token found');

    const response = await fetch(`/api/experiences/${this.experienceId}/service-items`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(serviceItemsData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save');
    }
  }

  getTemporaryServiceData() {
    const subtotal = this.calculateSubtotal();
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    const services = Array.from(this.services.values()).map(service => ({
      ...service,
      calculatedPrice: this.calculateServicePrice(service)
    }));

    const tempData = {
      services,
      subtotal,
      iva,
      total,
      timestamp: Date.now()
    };

    console.log('🔍 Storing temporary service data:', {
      servicesCount: services.length,
      subtotal,
      total,
      data: tempData
    });

    return tempData;
  }

  // Static method to transfer temporary services to a new experience
  static async transferTemporaryServices(newExperienceId, accessToken) {
    try {
      console.log('🔍 Services Transfer Debug - Starting transfer to experience:', newExperienceId);

      const tempData = localStorage.getItem('tempExperienceServices');
      if (!tempData) {
        console.log('🔍 Services Transfer Debug - No temporary data found');
        return;
      }

      const serviceData = JSON.parse(tempData);
      console.log('🔍 Services Transfer Debug - Parsed temporary data:', serviceData);

      if (!serviceData.services || serviceData.services.length === 0) {
        console.log('🔍 Services Transfer Debug - No services to transfer');
        return;
      }

      console.log('🔍 Services Transfer Debug - Found', serviceData.services.length, 'services to transfer');

      // Convert temporary services to the format expected by the API
      const subconcepts = serviceData.services.map(service => ({
        type: service.type || 'other',
        concept: service.concept || service.name,
        time: service.startTime || null,
        endTime: service.endTime || null,
        vehicleId: service.vehicleId || null,
        vehicleType: service.vehicleType || null,
        vehicleTypeName: service.vehicleTypeName || null,
        unitPrice: service.calculatedPrice || 0,
        quantity: service.quantity || 1,
        perPax: service.perPax || false,
        notes: service.notes || '',
        hours: service.hours || null,
        durationHours: service.durationHours || null,
        total: (service.calculatedPrice || 0) * (service.quantity || 1),
        experienceId: service.experienceId || null,
        tourId: service.tourId || null,
        entradaId: service.entradaId || null,
        rateId: service.rateId || null,
        hotelName: service.hotelName || null,
        adultsQuantity: service.adultsQuantity || null,
        childrenQuantity: service.childrenQuantity || null,
        adultsNoAlcoholQuantity: service.adultsNoAlcoholQuantity || null,
        selectedSchedule: service.selectedSchedule || null,
        adultPrice: service.adultPrice || null,
        childPrice: service.childPrice || null,
        noAlcoholPrice: service.noAlcoholPrice || null,
        includeGuide: service.includeGuide || false,
        includeChofer: service.includeChofer || false,
        guideDurationMode: service.guideDurationMode || 'tour',
        includeGreeter: service.includeGreeter || false,
        greeterInVehicle: service.greeterInVehicle || false,
        waitingTimeHours: service.waitingTimeHours || 0,
        transportType: service.transportType || null,
        directionType: service.directionType || null,
        tripType: service.tripType || null,
        originName: service.originName || null,
        destinationName: service.destinationName || null,
        rateName: service.rateName || null,
        roundTrip: service.roundTrip || false,
        vehicleCount: service.vehicleCount || 1,
        vehicleByPax: service.vehicleByPax || null,
        transportBase: service.type === 'transport' ? (service.unitPrice || 0) : null,
        // Base por vehículo del tour (para editar/desglosar sin perder el precio unitario).
        tourBase: (service.type === 'tour' && !service.isWalkingTour) ? (service.unitPrice || 0) : null,
        transportDurationHours: service.transportDurationHours ?? null,
        transportDurationMinutes: service.transportDurationMinutes ?? null,
        isWalkingTour: service.isWalkingTour || false,
        languages: service.languages || '',
        clientNotes: service.clientNotes || '',
      }));

      const serviceItemsData = {
        subconcepts,
        subtotal: serviceData.subtotal,
        iva: serviceData.iva,
        total: serviceData.total
      };

      console.log('🔍 Services Transfer Debug - Service items data to send:', {
        url: `/api/experiences/${newExperienceId}/service-items`,
        data: serviceItemsData,
        subconceptsCount: subconcepts.length
      });

      const response = await fetch(`/api/experiences/${newExperienceId}/service-items`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(serviceItemsData),
      });

      console.log('🔍 Services Transfer Debug - API Response:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });

      if (response.ok) {
        // Clear temporary data after successful transfer
        localStorage.removeItem('tempExperienceServices');
        console.log('✅ Successfully transferred temporary services to experience:', newExperienceId);
      } else {
        const errorData = await response.text();
        console.error('❌ Failed to transfer temporary services:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error transferring temporary services:', error);
    }
  }

  updateSaveStatus(status) {
    const indicator = document.getElementById('saveStatusIndicator');
    if (!indicator) return;

    // For new experiences, show different status messages
    if (this.experienceId === 'new') {
      switch (status) {
        case 'saving':
          indicator.innerHTML = '<i class="ti ti-device-floppy text-warning"></i> <small class="text-warning">Guardando temporalmente...</small>';
          break;
        case 'saved':
          indicator.innerHTML = '<i class="ti ti-check text-success"></i> <small class="text-success">Servicios guardados temporalmente</small>';
          break;
        case 'unsaved':
          indicator.innerHTML = '<i class="ti ti-clock text-muted"></i> <small class="text-muted">Cambios sin guardar</small>';
          break;
        case 'error':
          indicator.innerHTML = '<i class="ti ti-alert-triangle text-danger"></i> <small class="text-danger">Error al guardar</small>';
          break;
      }
      return;
    }

    const statusMap = {
      saved: '<span class="badge bg-success"><i class="ti ti-check me-1"></i>Guardado</span>',
      saving: '<span class="badge bg-warning"><i class="ti ti-loader me-1"></i>Guardando...</span>',
      unsaved: '<span class="badge bg-secondary"><i class="ti ti-dots me-1"></i>Sin guardar</span>',
      error: '<span class="badge bg-danger"><i class="ti ti-alert-circle me-1"></i>Error al guardar</span>',
    };

    indicator.innerHTML = statusMap[status] || statusMap.saved;
  }

  // =====================
  // HELPERS
  // =====================

  showModalAlert(message, type = 'warning') {
    const container = document.getElementById('serviceModalAlert');
    if (!container) return;
    container.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        <i class="ti ti-alert-circle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>
    `;
  }

  // =====================
  // DRAG & DROP PANEL
  // =====================

  renderDragPanel() {
    this.renderDragExperiences();
    this.renderDragTours();
    this.renderDragTraslados();
    this.setupDragSearch();
  }

  renderDragExperiences() {
    const container = document.getElementById('dragExperiencesList');
    if (!container) return;

    let html = '';
    let count = 0;

    // Merge regular + provider experiences, then sort A-Z
    const allExps = [];

    this.experiencesCache.forEach((exp) => {
      if (exp.id !== this.experienceId && exp.type !== 'provider_experience' && exp.name && exp.active !== false) {
        allExps.push({ id: exp.id, name: exp.name, label: null });
      }
    });

    (this.providerExperiencesCache || []).forEach((exp) => {
      if (!exp.name || !exp.provider || !exp.provider.name) return;
      if (!this.experiencesCache.has(exp.id)) {
        this.experiencesCache.set(exp.id, exp);
      }
      allExps.push({ id: exp.id, name: exp.name, label: exp.provider.name });
    });

    allExps.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    allExps.forEach((exp) => {
      html += this.renderDraggableItem(exp.id, exp.name, 'experience', exp.label);
      count++;
    });

    container.innerHTML = html || '<div class="text-center text-muted py-3 small">No hay experiencias disponibles</div>';
    const badge = document.getElementById('experiencesCount');
    if (badge) badge.textContent = count;
  }

  renderDragTours() {
    const container = document.getElementById('dragToursList');
    if (!container) return;

    let html = '';
    let count = 0;

    const sortedTours = [];
    this.toursCache.forEach((tour) => {
      const name = tour.destinationPOI?.name || tour.name || '';
      if (!name || tour.active === false) return;
      sortedTours.push({ tour, name });
    });
    sortedTours.sort((a, b) => a.name.localeCompare(b.name));

    sortedTours.forEach(({ tour, name }) => {
      const subLabel = tour.isWalkingTour ? 'Walking' : null;
      html += this.renderDraggableItem(tour.id, name, 'tour', subLabel);
      count++;
    });

    container.innerHTML = html || '<div class="text-center text-muted py-3 small">No hay tours disponibles</div>';
    const badge = document.getElementById('toursCount');
    if (badge) badge.textContent = count;
  }

  renderDraggableItem(id, name, type, subLabel) {
    const icon = type === 'experience' ? 'ti-beach' : type === 'transport' ? 'ti-car' : 'ti-map-2';
    const badge = subLabel ? `<span class="drag-badge badge bg-light text-muted">${subLabel}</span>` : '';
    return `
      <div class="drag-item" draggable="true" data-drag-id="${id}" data-drag-type="${type}">
        <i class="ti ti-grip-vertical drag-handle"></i>
        <i class="ti ${icon} me-2 text-muted" style="font-size: 0.9rem;"></i>
        <span class="drag-name">${name}</span>
        ${badge}
      </div>
    `;
  }

  async loadTransportServices() {
    try {
      const response = await fetch('/api/services/active', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.transportServicesCache = result.data;
          this.buildServicesByTransportType(result.data);
        }
      }
    } catch (error) {
      console.error('Error loading transport services:', error);
    }
  }

  async loadActiveServicesForDropdowns() {
    try {
      console.log('[Services] Loading active services from Services table...');

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
        console.log(`[Services] Loaded ${result.data.length} active services`);

        // Store services data globally for filtering
        this.servicesData = result.data;

        // Group services by transport type
        const servicesByType = {
          aeropuerto: [],
          'punto-a-punto': [],
          local: []
        };

        result.data.forEach(service => {
          // Use originPOI serviceType for filtering instead of service transportType
          const originServiceType = service.originServiceType || '';
          const destinationServiceType = service.destinationServiceType || '';

          // Group services based on POI serviceType
          // For Aeropuerto: show services where origin or destination POI has serviceType "Aeropuerto"
          if (originServiceType.toLowerCase().includes('aeropuerto') || destinationServiceType.toLowerCase().includes('aeropuerto')) {
            servicesByType.aeropuerto.push(service);
          }

          // For Punto a Punto: show services where POI serviceType includes "punto" or similar
          if (originServiceType.toLowerCase().includes('punto') || destinationServiceType.toLowerCase().includes('punto') ||
            originServiceType.toLowerCase().includes('point') || destinationServiceType.toLowerCase().includes('point')) {
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
        this.servicesByTransportType = servicesByType; // Also store on instance

        console.log('[Services] Services grouped by transport type:', {
          aeropuerto: servicesByType.aeropuerto.length,
          'punto-a-punto': servicesByType['punto-a-punto'].length,
          local: servicesByType.local.length
        });

        return result.data;
      }
    } catch (error) {
      console.error('[Services] Error loading active services:', error);
      // Don't break the app if services can't be loaded
    }
    return [];
  }

  populateDropdownsForTransportType(transportType, directionType) {
    if (!window.servicesByTransportType) {
      console.warn('[Services] No services data available for filtering');
      return;
    }

    // If directionType not passed, read from DOM
    if (!directionType) {
      directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
    }

    const services = window.servicesByTransportType[transportType] || [];

    const origins = new Set();
    const destinations = new Set();

    services.forEach(service => {
      if (transportType === 'aeropuerto') {
        if (directionType === 'departure') {
          // Departure: user leaves FROM a local destination TO the airport
          // origin dropdown = non-airport POIs (hotels, cities — same as arrival destinations)
          // destination combo = airports
          if (service.destination) {
            origins.add(service.destination);
          }
          if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
            destinations.add(service.origin);
          }
        } else {
          // Arrival: user arrives FROM the airport TO a local destination
          // origin dropdown = airports
          // destination combo = non-airport destinations
          if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
            origins.add(service.origin);
          }
          if (service.destination) {
            destinations.add(service.destination);
          }
        }
      } else if (directionType === 'departure') {
        // Departure for non-aeropuerto: swap origins/destinations
        // User departs FROM destination → TO origin (relative to DB)
        if (service.destination) origins.add(service.destination);
        if (service.origin) destinations.add(service.origin);
      } else {
        // Arrival for non-aeropuerto: origins and destinations as stored
        if (service.origin) origins.add(service.origin);
        if (service.destination) destinations.add(service.destination);
      }
    });

    // Create mapping from slugified values to original names (make it global)
    window.slugToOriginalMapping = new Map();

    const isDeparture = directionType === 'departure';

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
      [...dataSet].sort().forEach(location => {
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
      [...dataSet].sort().forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        element.appendChild(option);
      });
    };

    if (isDeparture && transportType === 'local') {
      // Local Vuelta: origin = SELECT, destination = TEXT (no dropdown needed)
      originSelectEls.forEach(el => populateSelect(el, origins));
      // Clear unused elements
      if (originDatalistEl) originDatalistEl.innerHTML = '';
      if (destinationSelectEl) { while (destinationSelectEl.options.length > 1) destinationSelectEl.remove(1); }
      destinationDatalistEls.forEach(el => { if (el) el.innerHTML = ''; });
    } else if (isDeparture) {
      // Aeropuerto / Punto a Punto departure: origin = SELECT dropdown, destination = SELECT
      originSelectEls.forEach(el => populateSelect(el, origins));
      populateSelect(destinationSelectEl, destinations);
      if (originDatalistEl) originDatalistEl.innerHTML = '';
      destinationDatalistEls.forEach(el => { if (el) el.innerHTML = ''; });
    } else if (transportType === 'local') {
      // Local Ida: origin = TEXT (no dropdown needed), destination = SELECT
      populateSelect(destinationSelectEl, destinations);
      // Clear unused elements
      originSelectEls.forEach(el => { if (el) { while (el.options.length > 1) el.remove(1); } });
      if (originDatalistEl) originDatalistEl.innerHTML = '';
      destinationDatalistEls.forEach(el => { if (el) el.innerHTML = ''; });
    } else {
      // Arrival: origins → origin SELECT, destinations → destination SELECT dropdown
      originSelectEls.forEach(el => populateSelect(el, origins));
      if (destinationSelectEl) populateSelect(destinationSelectEl, destinations);
      // Clear departure-specific elements
      if (originDatalistEl) originDatalistEl.innerHTML = '';
      destinationDatalistEls.forEach(el => { if (el) el.innerHTML = ''; });
    }

    console.log(`[Services] Dropdowns updated for ${transportType}:`, {
      origins: origins.size,
      destinations: destinations.size,
      directionType
    });
  }

  buildServicesByTransportType(services) {
    const servicesByType = { aeropuerto: [], 'punto-a-punto': [], local: [] };

    services.forEach((service) => {
      const originServiceType = service.originServiceType || '';
      const destinationServiceType = service.destinationServiceType || '';

      if (originServiceType.toLowerCase().includes('aeropuerto') || destinationServiceType.toLowerCase().includes('aeropuerto')) {
        servicesByType.aeropuerto.push(service);
      }
      if (originServiceType.toLowerCase().includes('punto') || destinationServiceType.toLowerCase().includes('punto') ||
        originServiceType.toLowerCase().includes('point') || destinationServiceType.toLowerCase().includes('point')) {
        servicesByType['punto-a-punto'].push(service);
      }
      if (originServiceType.toLowerCase().includes('local') || destinationServiceType.toLowerCase().includes('local')) {
        servicesByType.local.push(service);
      }
      if (!originServiceType && !destinationServiceType) {
        servicesByType.aeropuerto.push(service);
      }
    });

    this.servicesByTransportType = servicesByType;
  }

  async loadVehicleRatePrices() {
    try {
      const token = this.getAccessToken();
      if (!token) return;

      const response = await fetch('/api/vehicle-rate-prices/all', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.prices) {
          this.vehicleRatePricesCache = data.result.prices;
        }
      }
    } catch (error) {
      console.warn('Error loading vehicle rate prices:', error);
    }
  }

  renderDragTraslados() {
    const container = document.getElementById('dragTrasladosList');
    if (!container) return;

    const services = this.transportServicesCache || [];
    if (services.length === 0) {
      container.innerHTML = '<div class="text-center text-muted py-3 small">No hay servicios de transporte disponibles</div>';
      const badge = document.getElementById('trasladosCount');
      if (badge) badge.textContent = 0;
      return;
    }

    // Deduplicate by origin→destination
    const routeMap = new Map();
    services.forEach((service) => {
      if (!service.destination || service.destination === '-') return;
      const routeKey = `${service.origin || ''}→${service.destination}`;
      if (!routeMap.has(routeKey)) routeMap.set(routeKey, service);
    });
    const uniqueRoutes = Array.from(routeMap.values());

    // Group by service type
    const groups = {
      aeropuerto: { label: 'Aeropuerto', icon: 'ti-plane', items: [] },
      'punto-a-punto': { label: 'Punto a Punto', icon: 'ti-arrows-exchange', items: [] },
      local: { label: 'Local', icon: 'ti-map-pin', items: [] },
    };

    uniqueRoutes.forEach((service) => {
      const originType = (service.originServiceType || '').toLowerCase();
      const destType = (service.destinationServiceType || '').toLowerCase();

      if (!originType && !destType) return;

      if (originType.includes('aeropuerto') || destType.includes('aeropuerto')) {
        if (!service.origin || service.origin === 'Sin origen') return;
        groups.aeropuerto.items.push(service);
      } else if (originType.includes('punto') || destType.includes('punto') || originType.includes('point') || destType.includes('point')) {
        if (!service.origin || service.origin === 'Sin origen') return;
        groups['punto-a-punto'].items.push(service);
      } else if (originType.includes('local') || destType.includes('local')) {
        groups.local.items.push(service);
      }
    });

    let html = '';
    let totalCount = 0;

    Object.entries(groups).forEach(([groupKey, group]) => {
      if (group.items.length === 0) return;

      html += `<div class="drag-group-header text-muted small fw-bold mt-2 mb-1 px-1"><i class="ti ${group.icon} me-1"></i>${group.label}</div>`;

      group.items.forEach((service) => {
        html += this.renderTransportDragItem(service, groupKey === 'local');
        totalCount++;
      });
    });

    container.innerHTML = html || '<div class="text-center text-muted py-3 small">No hay servicios de transporte disponibles</div>';
    const badge = document.getElementById('trasladosCount');
    if (badge) badge.textContent = totalCount;
  }

  renderTransportDragItem(service, isLocal = false) {
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };
    const origin = escapeHtml(service.origin || 'Sin origen');
    const destination = escapeHtml(service.destination || '-');

    if (isLocal) {
      return `
        <div class="drag-item" draggable="true" data-drag-id="${service.value}" data-drag-type="transport">
          <i class="ti ti-grip-vertical drag-handle"></i>
          <i class="ti ti-car me-2 text-muted" style="font-size: 0.9rem;"></i>
          <span class="drag-name">${destination}</span>
        </div>
      `;
    }

    return `
      <div class="drag-item drag-item-transport" draggable="true" data-drag-id="${service.value}" data-drag-type="transport">
        <i class="ti ti-grip-vertical drag-handle"></i>
        <i class="ti ti-car me-2 text-muted" style="font-size: 0.9rem;"></i>
        <div class="drag-transport-info">
          <div class="drag-transport-origin">${origin}</div>
          <div class="drag-transport-destination">${destination}</div>
        </div>
      </div>
    `;
  }

  setupDragSearch() {
    const expSearch = document.getElementById('dragSearchExperiences');
    const tourSearch = document.getElementById('dragSearchTours');
    const trasladoSearch = document.getElementById('dragSearchTraslados');

    if (expSearch) {
      expSearch.addEventListener('input', (e) => this.filterDragItems(e.target.value, 'dragExperiencesList'));
    }
    if (tourSearch) {
      tourSearch.addEventListener('input', (e) => this.filterDragItems(e.target.value, 'dragToursList'));
    }
    if (trasladoSearch) {
      trasladoSearch.addEventListener('input', (e) => this.filterDragItems(e.target.value, 'dragTrasladosList'));
    }
  }

  filterDragItems(query, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = container.querySelectorAll('.drag-item');
    const q = query.toLowerCase().trim();

    items.forEach((item) => {
      const name = item.querySelector('.drag-name')?.textContent.toLowerCase() || '';
      item.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  }

  setupDragAndDrop() {
    const dropZone = document.getElementById('servicesDropZone');
    if (!dropZone) return;

    // Drag start on items (delegated)
    document.getElementById('dragSourcePanel')?.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.drag-item');
      if (!item) return;
      item.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        id: item.dataset.dragId,
        type: item.dataset.dragType,
      }));
      e.dataTransfer.effectAllowed = 'copy';
    });

    document.getElementById('dragSourcePanel')?.addEventListener('dragend', (e) => {
      const item = e.target.closest('.drag-item');
      if (item) item.classList.remove('dragging');
    });

    // Drop zone events
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');

      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.id && data.type) {
          this.handleDrop(data.id, data.type);
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    });
  }

  async handleDrop(itemId, type) {
    // Open the service modal pre-filled with the dropped item
    await this.openServiceModal();

    // Wait for modal to render, then select the type and item
    setTimeout(async () => {
      // Select the correct service type radio
      const typeMap = { experience: 'typeExperience', tour: 'typeTour', transport: 'typeTransport' };
      const typeRadio = document.getElementById(typeMap[type]);
      if (typeRadio) {
        typeRadio.checked = true;
        this.handleServiceTypeChange(type);
      }

      // Select the item in the dropdown
      if (type === 'experience') {
        const select = document.getElementById('experienceSelect');
        if (select) {
          select.value = itemId;
          this.handleExperienceSelection(itemId);
        }
      } else if (type === 'transport') {
        await this.preselectTransportRoute(itemId);
      } else if (type === 'tour') {
        const select = document.getElementById('tourSelect');
        if (select) {
          select.value = itemId;
          this.handleTourSelection(itemId);
        }
      }
    }, 200);
  }

  async preselectTransportRoute(serviceId) {
    // Find the service in cache
    const services = this.transportServicesCache || [];
    const service = services.find((s) => s.value === serviceId);
    if (!service) return;

    // Determine transport type from service types
    const originType = (service.originServiceType || '').toLowerCase();
    const destType = (service.destinationServiceType || '').toLowerCase();

    let transportType = 'aeropuerto';
    if (originType.includes('punto') || destType.includes('punto') || originType.includes('point') || destType.includes('point')) {
      transportType = 'punto-a-punto';
    } else if (originType.includes('local') || destType.includes('local')) {
      transportType = 'local';
    }

    // Select the transport type radio
    const transportRadio = document.querySelector(`input[name="transportType"][value="${transportType}"]`);
    if (transportRadio) {
      transportRadio.checked = true;
      await this.handleTransportTypeChange();
    }

    // For aeropuerto, determine direction based on which POI is the airport
    if (transportType === 'aeropuerto') {
      let direction = 'arrival';
      if (destType.includes('aeropuerto')) {
        direction = 'departure';
      }
      const dirRadio = document.querySelector(`input[name="directionType"][value="${direction}"]`);
      if (dirRadio) {
        dirRadio.checked = true;
        await this.handleDirectionTypeChange();
      }

      // Pre-fill origin/destination
      setTimeout(() => {
        const originSlug = (service.origin || '').toLowerCase().replace(/\s+/g, '-');
        const destSlug = (service.destination || '').toLowerCase().replace(/\s+/g, '-');

        if (direction === 'arrival') {
          // Origin = airport (SELECT), Destination = hotel/city (COMBO)
          const originSelect = document.getElementById('transportOriginSelect');
          if (originSelect) this.setSelectByValue(originSelect, originSlug);
          const destCombo = document.getElementById('transportDestinationCombo');
          if (destCombo) destCombo.value = service.destination || '';
        } else {
          // Origin = hotel/city (COMBO), Destination = airport (SELECT)
          const originCombo = document.getElementById('transportOriginCombo');
          if (originCombo) originCombo.value = service.destination || '';
          const destSelect = document.getElementById('transportDestinationSelect');
          if (destSelect) this.setSelectByValue(destSelect, originSlug);
        }
        this.checkSpecificLocationField();
      }, 100);
    } else {
      // For punto-a-punto and local, pre-fill fields
      setTimeout(() => {
        const originSlug = (service.origin || '').toLowerCase().replace(/\s+/g, '-');
        const originSelect = document.getElementById('transportOriginSelect');
        if (originSelect && !originSelect.classList.contains('d-none')) {
          this.setSelectByValue(originSelect, originSlug);
        }
        const destCombo = document.getElementById('transportDestinationCombo');
        if (destCombo && !destCombo.closest('.position-relative')?.classList.contains('d-none')) {
          destCombo.value = service.destination || '';
        }
        const destSelect = document.getElementById('transportDestinationSelect');
        if (destSelect && !destSelect.classList.contains('d-none')) {
          const destSlug = (service.destination || '').toLowerCase().replace(/\s+/g, '-');
          this.setSelectByValue(destSelect, destSlug);
        }
        this.checkSpecificLocationField();
      }, 100);
    }
  }

  setSelectByValue(selectEl, value) {
    if (!selectEl) return;
    // Try exact match first
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === value) {
        selectEl.selectedIndex = i;
        return;
      }
    }
    // Try text match
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].textContent.toLowerCase().replace(/\s+/g, '-') === value) {
        selectEl.selectedIndex = i;
        return;
      }
    }
  }

  // =====================
  // TIME SORTING & OVERLAP DETECTION
  // =====================

  parseTimeForSorting(timeStr) {
    if (!timeStr) return 999999;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 999999;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  getServiceTimeString(service) {
    if (service.selectedSchedule) return service.selectedSchedule;
    if (service.startTime) return service.startTime + (service.endTime ? ' - ' + service.endTime : '');
    return '';
  }

  sortServicesByTime() {
    const entries = Array.from(this.services.entries());
    entries.sort((a, b) => {
      const timeA = this.parseTimeForSorting(a[1].startTime || a[1].selectedSchedule);
      const timeB = this.parseTimeForSorting(b[1].startTime || b[1].selectedSchedule);
      return timeA - timeB;
    });
    this.services = new Map(entries);
  }

  parseTimeRange(service) {
    const startStr = service.startTime || service.selectedSchedule;
    if (!startStr) return null;

    const startMatch = startStr.match(/^(\d{1,2}):(\d{2})/);
    if (!startMatch) return null;
    const start = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);

    let end = start + 60; // default 1-hour duration
    if (service.endTime) {
      const endMatch = service.endTime.match(/^(\d{1,2}):(\d{2})/);
      if (endMatch) {
        end = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10);
      }
    } else if (service.selectedSchedule) {
      const rangeMatch = service.selectedSchedule.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (rangeMatch) {
        end = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
      }
    }

    return { start, end };
  }

  timeRangesOverlap(rangeA, rangeB) {
    return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
  }

  detectOverlaps() {
    const servicesArray = Array.from(this.services.values());

    // Reset overlap flags
    servicesArray.forEach((s) => {
      s.hasOverlap = false;
      s.overlapsWith = [];
    });

    for (let i = 0; i < servicesArray.length; i++) {
      const rangeA = this.parseTimeRange(servicesArray[i]);
      if (!rangeA) continue;

      for (let j = i + 1; j < servicesArray.length; j++) {
        const rangeB = this.parseTimeRange(servicesArray[j]);
        if (!rangeB) continue;

        if (this.timeRangesOverlap(rangeA, rangeB)) {
          servicesArray[i].hasOverlap = true;
          servicesArray[j].hasOverlap = true;
          servicesArray[i].overlapsWith.push({
            concept: servicesArray[j].concept,
            time: this.getServiceTimeString(servicesArray[j]),
          });
          servicesArray[j].overlapsWith.push({
            concept: servicesArray[i].concept,
            time: this.getServiceTimeString(servicesArray[i]),
          });
        }
      }
    }
  }

  getOverlapTooltip(service) {
    if (!service.overlapsWith || service.overlapsWith.length === 0) return '';
    const conflicts = service.overlapsWith
      .map((s) => `${s.concept} (${s.time})`)
      .join(', ');
    return `Conflicto con: ${conflicts}`;
  }

  sortAndDetectOverlaps() {
    this.sortServicesByTime();
    this.detectOverlaps();
  }
}

// Make the class globally available
window.ExperienceServicesBuilder = ExperienceServicesBuilder;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('[data-experience-id]');
  if (container) {
    const experienceId = container.dataset.experienceId;
    if (experienceId) {
      // Make the instance globally accessible for cross-panel communication
      window.experienceServicesBuilder = new ExperienceServicesBuilder(experienceId);
    }
  }
});
