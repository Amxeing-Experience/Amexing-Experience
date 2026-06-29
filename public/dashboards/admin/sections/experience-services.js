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

      // Load temporarily stored services for new experiences
      if (this.experienceId === 'new') {
        this.loadTemporaryServices();
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
      // Catálogo listo: ya se puede usar el modal.
      this.setAddServiceButtonsEnabled(true);
    } catch (error) {
      console.error('Error initializing experience services builder:', error);
      this.setAddServiceButtonsError();
    }
  }

  // Habilita/deshabilita los botones de "Agregar servicio" mostrando un estado de carga.
  setAddServiceButtonsEnabled(enabled) {
    ['addServiceBtn', 'emptyStateAddServiceBtn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = !enabled;
      if (!enabled) {
        if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Cargando servicios…';
      } else if (btn.dataset.idleHtml) {
        btn.innerHTML = btn.dataset.idleHtml;
        delete btn.dataset.idleHtml;
      }
    });
  }

  setAddServiceButtonsError() {
    ['addServiceBtn', 'emptyStateAddServiceBtn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-alert-triangle me-1"></i>Error al cargar';
    });
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
    document.getElementById('addServiceBtn')?.addEventListener('click', async () => await this.openServiceModal());
    document.getElementById('emptyStateAddServiceBtn')?.addEventListener('click', async () => await this.openServiceModal());

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
    });

    // Tour con vehículo: recalcular el precio (pricePerHour × horas) al cambiar las horas.
    document.getElementById('hoursQuantity')?.addEventListener('input', () => {
      const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
      const vehicleId = document.getElementById('vehicleSelect')?.value;
      if (serviceType === 'tour' && vehicleId) {
        this.handleVehicleSelection(vehicleId);
      }
    });

    // Guide checkbox
    document.getElementById('includeGuide')?.addEventListener('change', (e) => {
      this.handleIncludeGuideChange(e.target.checked);
    });

    // Greeter checkbox
    document.getElementById('includeGreeter')?.addEventListener('change', (e) => {
      this.handleIncludeGreeterChange(e.target.checked);
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
      const duplicateBtn = e.target.closest('.duplicate-service-btn');
      const deleteBtn = e.target.closest('.delete-service-btn');

      if (editBtn) {
        await this.openServiceModal(editBtn.dataset.serviceId);
      } else if (duplicateBtn) {
        this.duplicateService(duplicateBtn.dataset.serviceId);
      } else if (deleteBtn) {
        this.deleteService(deleteBtn.dataset.serviceId);
      }
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
        quantity: sub.quantity || 1,
        notes: sub.notes || '',
        experienceId: sub.experienceId,
        tourId: sub.tourId,
        rateId: sub.rateId,
        hotelName: sub.hotelName,
        adultsQuantity: sub.adultsQuantity || 0,
        childrenQuantity: sub.childrenQuantity || 0,
        adultsNoAlcoholQuantity: sub.adultsNoAlcoholQuantity || 0,
        selectedSchedule: sub.selectedSchedule || '',
        adultPrice: sub.adultPrice || 0,
        childPrice: sub.childPrice || 0,
        noAlcoholPrice: sub.noAlcoholPrice || 0,
        includeGuide: sub.includeGuide || false,
        includeGreeter: sub.includeGreeter || false,
        greeterInVehicle: sub.greeterInVehicle || false,
        waitingTimeHours: sub.waitingTimeHours || 0,
        transportType: sub.transportType || null,
        directionType: sub.directionType || null,
        tripType: sub.tripType || null,
        originName: sub.originName || null,
        destinationName: sub.destinationName || null,
        rateName: sub.rateName || null,
        isWalkingTour: sub.isWalkingTour || false,
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
      const response = await fetch('/api/rates?name=Chofer+Tour', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.data && data.data.length > 0) {
        this.driverTourRateCache = data.data[0];
      }
    } catch (error) {
      console.error('Error loading driver tour rate:', error);
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

  async openServiceModal(serviceId = null) {
    this.currentServiceId = serviceId;
    const modal = document.getElementById('serviceModal');
    if (!modal) return;

    const modalTitle = document.getElementById('serviceModalLabel');
    const saveBtn = document.getElementById('saveServiceBtn');

    // Reset form
    document.getElementById('serviceForm')?.reset();
    this.resetServiceTypeContent();

    if (serviceId) {
      // Edit mode
      const service = this.services.get(serviceId);
      if (!service) return;

      if (modalTitle) modalTitle.innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Servicio';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-device-floppy me-1"></i>Actualizar Servicio';

      // Set service type
      const typeRadio = document.querySelector(`input[name="serviceType"][value="${service.type}"]`);
      if (typeRadio) {
        typeRadio.checked = true;
        this.handleServiceTypeChange(service.type);
      }

      // Populate fields based on type
      await this.populateServiceFields(service);
    } else {
      // Create mode
      if (modalTitle) modalTitle.innerHTML = '<i class="ti ti-plus-circle me-2"></i>Agregar Servicio';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-device-floppy me-1"></i>Guardar Servicio';
      this.handleServiceTypeChange('experience');
    }

    // Populate rate selector
    this.populateRateSelector();

    // Populate experience and tour selects
    this.populateExperienceSelect();
    this.populateTourSelect();

    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
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

    // Hide Tiempo de espera for transport (as requested)
    const tiempoEsperaSection = document.getElementById('tiempoEsperaSection');
    if (tiempoEsperaSection) {
      tiempoEsperaSection.classList.add('d-none');  // Always hidden for now
    }

    // Hide Additional Vehicle checkbox and Cantidad field for transport (as requested) 
    const quantityFieldContainer = document.getElementById('quantityFieldContainer');
    const additionalVehicleContainer = document.getElementById('additionalVehicleContainer');
    if (type === 'transport') {
      if (quantityFieldContainer) quantityFieldContainer.classList.add('d-none');  // Hide cantidad field for transport
      if (additionalVehicleContainer) additionalVehicleContainer.classList.add('d-none');  // Hide additional vehicle
    } else {
      if (quantityFieldContainer) quantityFieldContainer.classList.remove('d-none');
      if (additionalVehicleContainer) additionalVehicleContainer.classList.add('d-none');
    }

    // Hide Guía + Chofer and Greeter checkboxes for transport (as requested)
    const includeGuideContainer = document.getElementById('includeGuide')?.closest('.form-check');
    const includeGreeterContainer = document.getElementById('greeterCheckboxContainer');

    // Hide the "Opcional" label column for transport
    const opcionalLabelContainer = includeGuideContainer?.closest('.col-md-2');

    if (type === 'transport') {
      if (includeGuideContainer) includeGuideContainer.classList.add('d-none');
      if (includeGreeterContainer) includeGreeterContainer.classList.add('d-none');
      if (opcionalLabelContainer) opcionalLabelContainer.classList.add('d-none');
    } else {
      if (includeGuideContainer) includeGuideContainer.classList.remove('d-none');
      if (includeGreeterContainer) includeGreeterContainer.classList.remove('d-none');
      if (opcionalLabelContainer) opcionalLabelContainer.classList.remove('d-none');
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

    // Default: si la experiencia no trae precio de niño o de "sin alcohol",
    // se usa el de adulto.
    const childPriceEl = document.getElementById('childPrice');
    if (childPriceEl) {
      const child = isProvider ? exp.price_child : exp.childPrice;
      childPriceEl.value = child || adultPrice || '';
    }

    const noAlcPriceEl = document.getElementById('noAlcoholPrice');
    if (noAlcPriceEl) {
      const noAlc = isProvider ? exp.price_no_alcohol : exp.noAlcoholPrice;
      noAlcPriceEl.value = noAlc || adultPrice || '';
    }

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
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    if (transportFieldsRow) {
      transportFieldsRow.classList.toggle('d-none', !checked);
    }
    // Un tour CON vehículo cobra por el vehículo -> muestra el campo de Precio.
    const standardPricingSection = document.getElementById('standardPricingSection');
    if (standardPricingSection) {
      standardPricingSection.classList.toggle('d-none', !checked);
    }
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
      this.handleTransportRateSelection(rateId);
      this.updateWaitingTimeRateDisplay();
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
        // Tour con vehículo: precio = (precio por hora de tour-prices) × horas del tour.
        const perHour = this.getTourVehiclePrice(vehicleId);
        const hours = parseFloat(document.getElementById('hoursQuantity')?.value) || 0;
        if (perHour != null && hours > 0) {
          priceEl.value = (perHour * hours).toFixed(2);
        }
      }
    }

    this.updateWaitingTimeRateDisplay();
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
    if (adultPrice) adultPrice.value = service.adultPrice || 0;
    if (childPrice) childPrice.value = service.childPrice || 0;
    if (noAlcPrice) noAlcPrice.value = service.noAlcoholPrice || 0;

    const startTime = document.getElementById('experienceStartTime');
    const endTime = document.getElementById('experienceEndTime');
    if (startTime) startTime.value = service.startTime || '';
    if (endTime) endTime.value = service.endTime || '';

    if (service.experienceId) this.handleExperienceSelection(service.experienceId);

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

    if (service.tourId) this.handleTourSelection(service.tourId);

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

    // 4. Restore origin/destination after dropdowns are populated
    setTimeout(() => {
      if (service.originName || service.destinationName) {
        this.restoreOneWayValues(service.originName || '', service.destinationName || '', service.transportType);
      }

      // 5. Set rate (segment) and trigger vehicle lookup
      if (service.rateId) {
        const rateSelect = document.getElementById('transportCategory');
        if (rateSelect) {
          rateSelect.value = service.rateId;
          // Trigger rate selection to load vehicles, then set vehicle + price
          this._populatingTransportForm = true;
          this.handleRateSelection(service.rateId).then(() => {
            // 6. Set vehicle after vehicles are loaded
            if (service.vehicleId) {
              const vehicleSelect = document.getElementById('vehicleSelect');
              if (vehicleSelect) vehicleSelect.value = service.vehicleId;
            }
            // 7. Set price (override any auto-filled price with saved value)
            const priceEl = document.getElementById('servicePrice');
            if (priceEl) priceEl.value = service.price || 0;

            this.updateWaitingTimeRateDisplay();
            this._populatingTransportForm = false;
          });
        }
      } else {
        const priceEl = document.getElementById('servicePrice');
        if (priceEl) priceEl.value = service.price || 0;
      }

      this.checkSpecificLocationField();
      this.checkRoundTripSpecificLocationFields();
    }, 100);

    // 8. Additional vehicle checkbox
    const additionalVehicle = document.getElementById('additionalVehicle');
    if (additionalVehicle) additionalVehicle.checked = (service.quantity || 1) > 1;
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

    if (this.currentServiceId) {
      // Update existing
      service.id = this.currentServiceId;
      this.services.set(this.currentServiceId, service);
    } else {
      // Create new
      service.id = this.generateId('svc');
      this.services.set(service.id, service);
    }

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('serviceModal'));
    if (modal) modal.hide();

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
    // Default: si el campo de niño o "sin alcohol" está vacío, usa el de adulto
    // (un 0 explícito sí se respeta).
    const childRaw = document.getElementById('childPrice')?.value;
    const noAlcRaw = document.getElementById('noAlcoholPrice')?.value;
    const childPrice = (childRaw == null || childRaw === '') ? adultPrice : (parseFloat(childRaw) || 0);
    const noAlcPrice = (noAlcRaw == null || noAlcRaw === '') ? adultPrice : (parseFloat(noAlcRaw) || 0);

    const total = (adultsQty * adultPrice) + (childrenQty * childPrice) + (noAlcQty * noAlcPrice);

    const isProvider = exp && exp.type === 'provider_experience';

    // Build base service object
    const service = {
      experienceId,
      concept: exp ? exp.name : 'Experiencia',
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

    const total = (adultsQty * adultPrice) + (childrenQty * childPrice) + (noAlcQty * noAlcPrice);

    return {
      tourId,
      concept: tour ? (tour.destinationPOI?.name || tour.name || 'Tour') : 'Tour',
      price: total,
      quantity: 1,
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
      isWalkingTour: tour ? (tour.isWalkingTour || false) : false,
      languages: document.getElementById('tourLanguages')?.value || '',
      clientNotes: document.getElementById('tourClientNotes')?.value || '',
    };
  }

  buildTransportService() {
    const price = parseFloat(document.getElementById('servicePrice')?.value) || 0;
    const additionalVehicle = document.getElementById('additionalVehicle')?.checked || false;
    const quantity = additionalVehicle ? 2 : 1;
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
      quantity,
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

  renderServices() {
    const container = document.getElementById('servicesContainer');
    const emptyState = document.getElementById('emptyStateContainer');
    if (!container || !emptyState) return;

    if (this.services.size === 0) {
      container.classList.add('d-none');
      emptyState.classList.remove('d-none');
      return;
    }

    container.classList.remove('d-none');
    emptyState.classList.add('d-none');

    container.innerHTML = '';
    this.services.forEach((service) => {
      container.innerHTML += this.renderServiceItem(service);
    });
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

  renderServiceItem(service) {
    const typeLabels = {
      experience: 'Experiencia',
      tour: 'Tour',
      transport: 'Transporte',
      concepto: 'Concepto',
    };

    const servicePrice = this.calculateServicePrice(service);
    const title = service.concept || this.getServiceTitle(service);

    const overlapClass = service.hasOverlap ? ' has-overlap' : '';
    const overlapBadge = service.hasOverlap ? `
              <span class="overlap-warning-badge ms-2" title="${this.getOverlapTooltip(service)}">
                <i class="ti ti-alert-triangle"></i>
                <span>Conflicto de horario</span>
              </span>` : '';

    // Transport-specific rendering
    if (service.type === 'transport') {
      return this.renderTransportServiceItem(service, servicePrice, overlapClass, overlapBadge);
    }

    // Add price breakdown for experience and tour services
    let priceBreakdownHtml = '';
    if ((service.type === 'experience' || service.type === 'tour')) {
      priceBreakdownHtml = this.renderPriceBreakdown(service);
    }

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
                ${service.vehicleTypeName ? `
                  <div class="col-auto"><i class="ti ti-car me-1"></i>${service.vehicleTypeName}${service.quantity > 1 ? ` x${service.quantity}` : ''}</div>
                ` : ''}
              </div>
              ${this.renderPeopleQuantities(service)}
              ${priceBreakdownHtml}
              ${service.includeGuide ? '<div class="text-success small mt-1"><i class="ti ti-user me-1"></i><strong>Incluye Guia + Chofer</strong></div>' : ''}
              ${service.includeGreeter ? '<div class="text-info small mt-1"><i class="ti ti-users me-1"></i><strong>Incluye Greeter</strong></div>' : ''}
              ${service.notes ? `<div class="text-muted small mt-1"><i class="ti ti-notes me-1"></i>${service.notes}</div>` : ''}
            </div>
          </div>
          <div class="service-actions d-flex flex-column align-items-end justify-content-between">
            <div class="btn-group btn-group-sm">
              <button type="button" class="btn btn-light edit-service-btn" data-service-id="${service.id}" title="Editar"><i class="ti ti-pencil"></i></button>
              <button type="button" class="btn btn-light duplicate-service-btn" data-service-id="${service.id}" title="Duplicar"><i class="ti ti-copy"></i></button>
              <button type="button" class="btn btn-light delete-service-btn" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
            </div>
            <div class="fw-bold text-end mt-2">
              <div class="text-muted small">Total</div>
              $${servicePrice.toFixed(2)}
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
    const vehicleHtml = service.vehicleTypeName
      ? `<div class="small text-muted mt-2"><i class="ti ti-bus me-1"></i>${service.vehicleTypeName}${service.quantity > 1 ? ` x${service.quantity}` : ''}${service.tripType === 'round-trip' ? ' <span class="text-info">(Ida y Regreso ×2)</span>' : ''}</div>`
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
              <button type="button" class="btn btn-light edit-service-btn" data-service-id="${service.id}" title="Editar"><i class="ti ti-pencil"></i></button>
              <button type="button" class="btn btn-light duplicate-service-btn" data-service-id="${service.id}" title="Duplicar"><i class="ti ti-copy"></i></button>
              <button type="button" class="btn btn-light delete-service-btn" data-service-id="${service.id}" title="Eliminar"><i class="ti ti-trash"></i></button>
            </div>
            <div class="fw-bold text-end mt-2">$${servicePrice.toFixed(2)}</div>
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

    if (hasNoPeople && hasPrices) {
      const parts = [];
      if (service.adultPrice > 0) {
        parts.push('1 adulto (simulado)');
      }
      if (service.childPrice > 0) {
        parts.push('1 niño (simulado)');
      }
      if (service.noAlcoholPrice > 0) {
        parts.push('1 s/alcohol (simulado)');
      }
      return `<div class="text-muted small mt-1"><i class="ti ti-users me-1"></i>${parts.join(' + ')}</div>`;
    }

    if (hasNoPeople) return '';

    const parts = [];
    if (adults > 0) parts.push(`${adults} adulto${adults > 1 ? 's' : ''}`);
    if (children > 0) parts.push(`${children} niño${children > 1 ? 's' : ''}`);
    if (noAlc > 0) parts.push(`${noAlc} s/alcohol`);

    return `<div class="text-muted small mt-1"><i class="ti ti-users me-1"></i>${parts.join(' + ')}</div>`;
  }

  renderPriceBreakdown(service) {
    if (service.type !== 'experience' && service.type !== 'tour') return '';

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
          <div class="small fw-bold mb-1">Precios simulados para 1 persona:</div>
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
    if (service.type === 'experience' || service.type === 'tour') {
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
    // Only dispatch event for cross-panel updates
    window.dispatchEvent(new CustomEvent('servicesUpdated'));
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
          priceLines.push(`<div class="text-muted small mt-2">Precios simulados para 1 persona:</div>`);
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

  async saveToBackend() {
    // For new experiences, store services temporarily in localStorage
    if (this.experienceId === 'new') {
      const serviceData = this.getTemporaryServiceData();
      localStorage.setItem('tempExperienceServices', JSON.stringify(serviceData));
      return; // Skip API call for new experiences
    }

    const subtotal = this.calculateSubtotal();
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    const subconcepts = [];
    this.services.forEach((service) => {
      const servicePrice = this.calculateServicePrice(service);
      subconcepts.push({
        type: service.type || 'other',
        concept: service.concept || this.getServiceTitle(service),
        time: service.startTime || null,
        endTime: service.endTime || null,
        vehicleId: service.vehicleId || null,
        vehicleType: service.vehicleType || null,
        vehicleTypeName: service.vehicleTypeName || null,
        unitPrice: servicePrice,
        quantity: service.quantity || 1,
        notes: service.notes || '',
        hours: null,
        total: servicePrice * (service.quantity || 1),
        experienceId: service.experienceId || null,
        tourId: service.tourId || null,
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
        includeGreeter: service.includeGreeter || false,
        greeterInVehicle: service.greeterInVehicle || false,
        waitingTimeHours: service.waitingTimeHours || 0,
        transportType: service.transportType || null,
        directionType: service.directionType || null,
        tripType: service.tripType || null,
        originName: service.originName || null,
        destinationName: service.destinationName || null,
        rateName: service.rateName || null,
        isWalkingTour: service.isWalkingTour || false,
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
        notes: service.notes || '',
        hours: null,
        total: (service.calculatedPrice || 0) * (service.quantity || 1),
        experienceId: service.experienceId || null,
        tourId: service.tourId || null,
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
        includeGreeter: service.includeGreeter || false,
        greeterInVehicle: service.greeterInVehicle || false,
        waitingTimeHours: service.waitingTimeHours || 0,
        transportType: service.transportType || null,
        directionType: service.directionType || null,
        tripType: service.tripType || null,
        originName: service.originName || null,
        destinationName: service.destinationName || null,
        rateName: service.rateName || null,
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
