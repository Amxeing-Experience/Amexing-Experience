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
      ]);

      this.setupEventListeners();
      this.renderDragPanel();
      this.setupDragAndDrop();
      this.sortAndDetectOverlaps();
      this.renderServices();
      this.updateTotals();
    } catch (error) {
      console.error('Error initializing experience services builder:', error);
    }
  }

  setupEventListeners() {
    // Add Service buttons
    document.getElementById('addServiceBtn')?.addEventListener('click', () => this.openServiceModal());
    document.getElementById('emptyStateAddServiceBtn')?.addEventListener('click', () => this.openServiceModal());

    // Save Service button
    document.getElementById('saveServiceBtn')?.addEventListener('click', () => this.saveService());

    // Person count for per-person calculation
    document.getElementById('personCount')?.addEventListener('input', () => this.updateTotals());

    // Payment type and currency dropdowns
    document.getElementById('paymentTypeSelect')?.addEventListener('change', () => this.updateTotals());
    document.getElementById('currencySelect')?.addEventListener('change', () => this.updateTotals());

    // Service Type Toggle
    document.querySelectorAll('input[name="serviceType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => this.handleServiceTypeChange(e.target.value));
    });

    // Transport Type Toggle
    document.querySelectorAll('input[name="transportType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleTransportTypeChange());
    });

    // Trip Type Toggle
    document.querySelectorAll('input[name="tripType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleTripTypeChange());
    });

    // Direction Type Toggle
    document.querySelectorAll('input[name="directionType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleDirectionTypeChange());
    });

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
    document.getElementById('servicesContainer')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.edit-service-btn');
      const duplicateBtn = e.target.closest('.duplicate-service-btn');
      const deleteBtn = e.target.closest('.delete-service-btn');

      if (editBtn) {
        this.openServiceModal(editBtn.dataset.serviceId);
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
      if (data.success) this.vehiclesCache = data.data || [];
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
          const key = `${tp.tourId}_${tp.rateId}`;
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

  openServiceModal(serviceId = null) {
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
      this.populateServiceFields(service);
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
    document.getElementById('transportTypeSelector')?.classList.add('d-none');
    document.getElementById('tripTypeSelector')?.classList.add('d-none');
    document.getElementById('experiencePricingSection')?.classList.add('d-none');
    document.getElementById('standardPricingSection')?.classList.remove('d-none');
    document.getElementById('tourTransportCheckboxContainer')?.style.setProperty('display', 'none');
    document.getElementById('transportFieldsRow')?.classList.remove('d-none');
  }

  handleServiceTypeChange(type) {
    this.currentServiceType = type;

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

    // Tiempo de espera - only for transport
    const tiempoEsperaSection = document.getElementById('tiempoEsperaSection');
    if (tiempoEsperaSection) {
      tiempoEsperaSection.classList.toggle('d-none', type !== 'transport');
    }

    // Quantity field vs Additional Vehicle checkbox
    const quantityFieldContainer = document.getElementById('quantityFieldContainer');
    const additionalVehicleContainer = document.getElementById('additionalVehicleContainer');
    if (type === 'transport') {
      if (quantityFieldContainer) quantityFieldContainer.classList.add('d-none');
      if (additionalVehicleContainer) additionalVehicleContainer.classList.remove('d-none');
    } else {
      if (quantityFieldContainer) quantityFieldContainer.classList.remove('d-none');
      if (additionalVehicleContainer) additionalVehicleContainer.classList.add('d-none');
    }
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

  handleTransportTypeChange() {
    this.clearTransportFormFields();
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const flightDetailsSection = document.getElementById('flightDetailsSection');
    const roundTripFlightDetailsIda = document.querySelector('.roundtrip-flight-details-ida');
    const roundTripFlightDetailsVuelta = document.querySelector('.roundtrip-flight-details-vuelta');
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const transportScheduleSection = document.getElementById('transportScheduleSection');

    // Populate dropdowns based on transport type
    this.populateTransportDropdowns(transportType);

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
      this.handleDirectionTypeChange();
    } else {
      this.updateRoundTripFieldVisibility();
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

  handleTripTypeChange() {
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
        this.populateTransportDropdowns(transportType);
      }
      // Restore values to one-way fields
      this.restoreOneWayValues(savedOrigin, savedDest, transportType);
    } else {
      oneWayForm?.classList.add('d-none');
      roundTripForm?.classList.remove('d-none');
      arrivalDepartureSelector?.classList.add('d-none');
      this.updateRoundTripFieldVisibility();
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

  handleDirectionTypeChange() {
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
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      destinationComboWrapper?.classList.remove('d-none');
      document.getElementById('transportDestinationCombo')?.setAttribute('required', 'required');
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
      originComboWrapper?.classList.remove('d-none');
      document.getElementById('transportOriginCombo')?.setAttribute('required', 'required');
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
      if (timeLabel) timeLabel.textContent = 'Hora de Salida';
    }

    // Re-populate dropdowns considering direction
    if (transportType) {
      this.populateTransportDropdowns(transportType, directionType);
    }

    // Restore values swapped: old origin → new dest, old dest → new origin
    if (savedOrigin || savedDest) {
      this.restoreOneWayValues(savedDest, savedOrigin, transportType);
    }
  }

  updateRoundTripFieldVisibility() {
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
      idaOriginSelect?.classList.remove('d-none');
      idaDestComboWrapper?.classList.remove('d-none');
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
      vueltaOriginComboWrapper?.classList.remove('d-none');
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

    // Populate round-trip dropdowns
    this.populateRoundTripDropdowns(transportType);
  }

  // Populate transport dropdowns from cached services data
  populateTransportDropdowns(transportType, directionType) {
    if (!this.servicesByTransportType) return;

    if (!directionType) {
      directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
    }

    const services = this.servicesByTransportType[transportType] || [];
    const origins = new Set();
    const destinations = new Set();

    services.forEach((service) => {
      if (transportType === 'aeropuerto') {
        if (directionType === 'departure') {
          if (service.destination) origins.add(service.destination);
          if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
            destinations.add(service.origin);
          }
        } else {
          if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
            origins.add(service.origin);
          }
          if (service.destination) destinations.add(service.destination);
        }
      } else if (directionType === 'departure') {
        if (service.destination) origins.add(service.destination);
        if (service.origin) destinations.add(service.origin);
      } else {
        if (service.origin) origins.add(service.origin);
        if (service.destination) destinations.add(service.destination);
      }
    });

    // Slug mapping for selects
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

    const isDeparture = directionType === 'departure';
    const originSelect = document.getElementById('transportOriginSelect');
    const destinationSelect = document.getElementById('transportDestinationSelect');
    const originDatalist = document.getElementById('transportOriginList');
    const destinationDatalist = document.getElementById('transportDestinationList');

    if (isDeparture && transportType === 'local') {
      populateSelect(originSelect, origins);
    } else if (isDeparture) {
      populateDatalist(originDatalist, origins);
      populateSelect(originSelect, origins);
      populateSelect(destinationSelect, destinations);
      populateDatalist(destinationDatalist, destinations);
    } else if (transportType === 'local') {
      populateSelect(destinationSelect, destinations);
    } else {
      populateSelect(originSelect, origins);
      populateDatalist(destinationDatalist, destinations);
    }
  }

  populateRoundTripDropdowns(transportType) {
    if (!this.servicesByTransportType) return;

    const services = this.servicesByTransportType[transportType] || [];
    const arrivalOrigins = new Set();
    const arrivalDestinations = new Set();
    const departureOrigins = new Set();
    const departureDestinations = new Set();

    services.forEach((service) => {
      if (transportType === 'aeropuerto') {
        if (service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
          arrivalOrigins.add(service.origin);
          departureDestinations.add(service.origin);
        }
        if (service.destination) {
          arrivalDestinations.add(service.destination);
          departureOrigins.add(service.destination);
        }
      } else {
        if (service.origin) { arrivalOrigins.add(service.origin); departureDestinations.add(service.origin); }
        if (service.destination) { arrivalDestinations.add(service.destination); departureOrigins.add(service.destination); }
      }
    });

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

    // Ida (arrival): origin = SELECT, dest = COMBO
    populateSelect(document.getElementById('roundTripOriginIdaSelect'), arrivalOrigins);
    populateDatalist(document.getElementById('roundTripDestinationIdaList'), arrivalDestinations);
    populateSelect(document.getElementById('roundTripDestinationIdaSelect'), arrivalDestinations);

    // Vuelta (departure): origin = COMBO, dest = SELECT
    populateDatalist(document.getElementById('roundTripOriginVueltaList'), departureOrigins);
    populateSelect(document.getElementById('roundTripOriginVueltaSelect'), departureOrigins);
    populateSelect(document.getElementById('roundTripDestinationVueltaSelect'), departureDestinations);
  }

  handleExperienceSelection(experienceId) {
    if (!experienceId) return;
    const exp = this.experiencesCache.get(experienceId);
    if (!exp) return;

    const isProvider = exp.type === 'provider_experience';

    // Populate read-only fields
    const descEl = document.getElementById('experienceDescription');
    if (descEl) descEl.value = exp.description || '';

    // Advance booking time
    const advEl = document.getElementById('advanceBookingTime');
    if (advEl) advEl.value = exp.advanceBookingTime || exp.advance_booking_time || '';

    // Languages
    const langEl = document.getElementById('experienceLanguages');
    if (langEl) {
      const langs = isProvider ? exp.languages : exp.languages;
      langEl.value = Array.isArray(langs) ? langs.join(', ') : (langs || '');
    }

    // Includes
    const inclEl = document.getElementById('experienceIncludes');
    if (inclEl) {
      const incl = exp.includes || [];
      inclEl.value = Array.isArray(incl) ? incl.join(', ') : (incl || '');
    }

    // Not includes
    const notInclEl = document.getElementById('experienceNotIncludes');
    if (notInclEl) {
      const notIncl = exp.notincludes || exp.notIncludes || [];
      notInclEl.value = Array.isArray(notIncl) ? notIncl.join(', ') : (notIncl || '');
    }

    // Client notes
    const notesEl = document.getElementById('experienceClientNotes');
    if (notesEl) notesEl.value = exp.clientNotes || exp.client_booking_notes || '';

    // Set default prices
    const adultPrice = isProvider ? exp.price : exp.cost;
    const adultPriceEl = document.getElementById('adultPrice');
    if (adultPriceEl && adultPrice) adultPriceEl.value = adultPrice;

    const childPriceEl = document.getElementById('childPrice');
    if (childPriceEl) childPriceEl.value = isProvider ? (exp.price_child || '') : (exp.childPrice || '');

    const noAlcPriceEl = document.getElementById('noAlcoholPrice');
    if (noAlcPriceEl) noAlcPriceEl.value = isProvider ? (exp.price_no_alcohol || '') : (exp.noAlcoholPrice || '');
  }

  handleTourSelection(tourId) {
    if (!tourId) return;
    const tour = this.toursCache.get(tourId);
    if (!tour) return;

    // Populate tour fields
    const descEl = document.getElementById('tourDescription');
    if (descEl) descEl.value = tour.description || '';

    const advEl = document.getElementById('tourAdvanceBookingTime');
    if (advEl) advEl.value = tour.advanceBookingTime || '';

    const langEl = document.getElementById('tourLanguages');
    if (langEl) {
      const langs = tour.languages;
      langEl.value = Array.isArray(langs) ? langs.join(', ') : (langs || '');
    }

    const inclEl = document.getElementById('tourIncludes');
    if (inclEl) {
      const incl = tour.includes || [];
      inclEl.value = Array.isArray(incl) ? incl.join(', ') : (incl || '');
    }

    const notInclEl = document.getElementById('tourNotIncludes');
    if (notInclEl) {
      const notIncl = tour.notIncludes || tour.notincludes || [];
      notInclEl.value = Array.isArray(notIncl) ? notIncl.join(', ') : (notIncl || '');
    }

    const notesEl = document.getElementById('tourClientNotes');
    if (notesEl) notesEl.value = tour.clientNotes || tour.client_booking_notes || '';
  }

  handleTourTransportToggle(checked) {
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    if (transportFieldsRow) {
      transportFieldsRow.classList.toggle('d-none', !checked);
    }
  }

  async handleRateSelection(rateId) {
    if (!rateId) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // Only do route-based lookup for transport type
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    if (serviceType !== 'transport') {
      this.populateVehicleSelectFallback(rateId);
      return;
    }

    // Read origin/destination from visible form fields
    const directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;

    let originName = '';
    let destinationName = '';

    if (tripType === 'round-trip') {
      if (transportType === 'local') {
        originName = document.getElementById('roundTripOriginIdaText')?.value || '';
        const destSelect = document.getElementById('roundTripDestinationIdaSelect');
        const destSlug = destSelect?.value;
        destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      } else {
        const originSelect = document.getElementById('roundTripOriginIdaSelect');
        const slug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(slug) || slug || '';
        destinationName = document.getElementById('roundTripDestinationIdaCombo')?.value || '';
      }
    } else {
      const isDepartureWithSelect = directionType === 'departure' && (transportType === 'aeropuerto' || transportType === 'punto-a-punto');
      const isLocalIda = directionType === 'arrival' && transportType === 'local';

      const resolveDestSelect = () => {
        const destSelect = document.getElementById('transportDestinationSelect');
        const destSlug = destSelect?.value;
        return window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      };

      if (isLocalIda) {
        originName = document.getElementById('transportOriginText')?.value || '';
        destinationName = resolveDestSelect();
      } else if (isDepartureWithSelect) {
        originName = document.getElementById('transportOriginCombo')?.value || '';
        destinationName = resolveDestSelect();
      } else if (directionType === 'departure' && transportType === 'local') {
        const originSelect = document.getElementById('transportOriginSelect');
        const slug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(slug) || slug || '';
        destinationName = document.getElementById('transportDestinationText')?.value || '';
      } else if (directionType === 'arrival') {
        const originSelect = document.getElementById('transportOriginSelect');
        const slug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(slug) || slug || '';
        destinationName = document.getElementById('transportDestinationCombo')?.value || '';
      } else {
        originName = document.getElementById('transportOriginCombo')?.value || '';
        destinationName = document.getElementById('transportDestinationCombo')?.value || '';
      }
    }

    if (!originName || !destinationName) {
      // No route yet — use fallback
      this.transportPriceData = null;
      this.populateVehicleSelectFallback(rateId);
      return;
    }

    // Swap for departure (DB stores origin→destination, user selected reverse)
    let apiOrigin = originName;
    let apiDestination = destinationName;
    if (tripType !== 'round-trip' && directionType === 'departure') {
      apiOrigin = destinationName;
      apiDestination = originName;
    }

    try {
      const token = this.getAccessToken();
      const params = new URLSearchParams({
        originPOI: apiOrigin,
        destinationPOI: apiDestination,
        rateId,
      });

      const response = await fetch(`/api/services/prices-by-route?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      if (result.success && result.data && result.data.vehicles && result.data.vehicles.length > 0) {
        // Route match — use route-specific vehicles
        this.transportPriceData = result.data;
        this.populateVehicleSelectFromRoute(result.data.vehicles);
      } else {
        // No match — fallback to VehicleRatePrices
        this.transportPriceData = null;
        this.populateVehicleSelectFallback(rateId);
      }
    } catch (error) {
      console.error('Error looking up transport prices:', error);
      this.transportPriceData = null;
      this.populateVehicleSelectFallback(rateId);
    }

    this.updateWaitingTimeRateDisplay();
  }

  handleVehicleSelection(vehicleId) {
    if (!vehicleId) {
      const priceEl = document.getElementById('servicePrice');
      if (priceEl) priceEl.value = '';
      this.updateWaitingTimeRateDisplay();
      return;
    }

    // Route match: auto-fill price from transportPriceData
    if (this.transportPriceData && this.transportPriceData.vehicles) {
      const vehicle = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === vehicleId);
      if (vehicle) {
        const priceEl = document.getElementById('servicePrice');
        if (priceEl) priceEl.value = vehicle.finalPrice || 0;
      }
    }
    // Fallback (no transportPriceData): don't touch price — user fills manually

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

    select.innerHTML = '<option value="">-- Seleccionar segmento --</option>';
    this.ratesCache.forEach((rate) => {
      const option = document.createElement('option');
      option.value = rate.id;
      option.textContent = rate.name;
      select.appendChild(option);
    });
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
        option.textContent = `${v.name} (${v.capacity} pax)`;
        select.appendChild(option);
      });
    } else {
      filtered.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.vehicleTypeId;
        option.textContent = `${p.vehicleTypeName || p.vehicleTypeCode || p.vehicleTypeId}`;
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

    // Group: Provider Experiencias
    const providerExps = this.providerExperiencesCache || [];
    if (providerExps.length > 0) {
      const provGroup = document.createElement('optgroup');
      provGroup.label = 'Experiencias de Proveedores';
      providerExps.forEach((exp) => {
        // Add to experiencesCache for later lookup
        if (!this.experiencesCache.has(exp.id)) {
          this.experiencesCache.set(exp.id, exp);
        }
        const option = document.createElement('option');
        option.value = exp.id;
        const providerName = exp.provider ? ` (${exp.provider.name})` : '';
        option.textContent = `${exp.name}${providerName}`;
        provGroup.appendChild(option);
      });
      select.appendChild(provGroup);
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

  populateServiceFields(service) {
    switch (service.type) {
      case 'experience':
        this.populateExperienceFields(service);
        break;
      case 'tour':
        this.populateTourFields(service);
        break;
      case 'transport':
        this.populateTransportFields(service);
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

  populateTransportFields(service) {
    // 1. Set transport type radio (aeropuerto/punto-a-punto/local)
    if (service.transportType) {
      const transportRadio = document.querySelector(`input[name="transportType"][value="${service.transportType}"]`);
      if (transportRadio) {
        transportRadio.checked = true;
        this.handleTransportTypeChange();
      }
    }

    // 2. Set trip type radio (one-way/round-trip)
    if (service.tripType) {
      const tripRadio = document.querySelector(`input[name="tripType"][value="${service.tripType}"]`);
      if (tripRadio) {
        tripRadio.checked = true;
        this.handleTripTypeChange();
      }
    }

    // 3. Set direction type radio (arrival/departure)
    if (service.directionType) {
      const dirRadio = document.querySelector(`input[name="directionType"][value="${service.directionType}"]`);
      if (dirRadio) {
        dirRadio.checked = true;
        this.handleDirectionTypeChange();
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
    const childPrice = parseFloat(document.getElementById('childPrice')?.value) || 0;
    const noAlcPrice = parseFloat(document.getElementById('noAlcoholPrice')?.value) || 0;

    const total = (adultsQty * adultPrice) + (childrenQty * childPrice) + (noAlcQty * noAlcPrice);

    const isProvider = exp && exp.type === 'provider_experience';
    return {
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
              <span class="text-danger ms-2" title="${this.getOverlapTooltip(service)}">
                <i class="ti ti-alert-triangle"></i>
                <small>Conflicto de horario</small>
              </span>` : '';

    // Transport-specific rendering
    if (service.type === 'transport') {
      return this.renderTransportServiceItem(service, servicePrice, overlapClass, overlapBadge);
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
            <div class="fw-bold text-end mt-2">$${servicePrice.toFixed(2)}</div>
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
      ? `<div class="small text-muted mt-2"><i class="ti ti-bus me-1"></i>${service.vehicleTypeName}${service.quantity > 1 ? ` x${service.quantity}` : ''}</div>`
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
    if (adults === 0 && children === 0 && noAlc === 0) return '';

    const parts = [];
    if (adults > 0) parts.push(`${adults} adulto${adults > 1 ? 's' : ''}`);
    if (children > 0) parts.push(`${children} nino${children > 1 ? 's' : ''}`);
    if (noAlc > 0) parts.push(`${noAlc} s/alcohol`);

    return `<div class="text-muted small mt-1"><i class="ti ti-users me-1"></i>${parts.join(' + ')}</div>`;
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
      const adultsTotal = (service.adultsQuantity || 0) * (service.adultPrice || 0);
      const childrenTotal = (service.childrenQuantity || 0) * (service.childPrice || 0);
      const noAlcTotal = (service.adultsNoAlcoholQuantity || 0) * (service.noAlcoholPrice || 0);
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
    const baseSubtotal = this.calculateSubtotal();
    const baseIva = Math.round(baseSubtotal * 0.16 * 100) / 100;
    const baseTotal = Math.round((baseSubtotal + baseIva) * 100) / 100;

    // Apply payment rate
    const paymentType = document.getElementById('paymentTypeSelect')?.value || 'efectivo';
    const currency = document.getElementById('currencySelect')?.value || 'MXN';

    let adjustedSubtotal = baseSubtotal;
    let adjustedIva = baseIva;
    let adjustedTotal = baseTotal;

    // Apply payment rate markup
    if (paymentType === 'transferencia') {
      adjustedSubtotal = baseSubtotal * (1 + this.transferRate / 100);
    } else if (paymentType === 'tarjeta') {
      adjustedSubtotal = baseSubtotal * (1 + this.agencyRate / 100);
    }
    adjustedIva = Math.round(adjustedSubtotal * 0.16 * 100) / 100;
    adjustedTotal = Math.round((adjustedSubtotal + adjustedIva) * 100) / 100;

    // Apply currency conversion
    if (currency === 'USD' && this.exchangeRate > 0) {
      adjustedSubtotal = adjustedSubtotal / this.exchangeRate;
      adjustedIva = adjustedIva / this.exchangeRate;
      adjustedTotal = adjustedTotal / this.exchangeRate;

      if (window.PricingUtils && typeof window.PricingUtils.applyUSDRoundingRules === 'function') {
        adjustedSubtotal = window.PricingUtils.applyUSDRoundingRules(adjustedSubtotal);
        adjustedIva = window.PricingUtils.applyUSDRoundingRules(adjustedIva);
        adjustedTotal = window.PricingUtils.applyUSDRoundingRules(adjustedTotal);
      }
    }

    const subtotalEl = document.getElementById('subtotalAmount');
    const ivaEl = document.getElementById('ivaAmount');
    const totalEl = document.getElementById('totalAmount');
    const perPersonEl = document.getElementById('perPersonAmount');
    const personCountEl = document.getElementById('personCount');

    const currSuffix = currency === 'USD' ? ' USD' : '';
    if (subtotalEl) subtotalEl.textContent = `$${adjustedSubtotal.toFixed(2)}${currSuffix}`;
    if (ivaEl) ivaEl.textContent = `$${adjustedIva.toFixed(2)}${currSuffix}`;
    if (totalEl) totalEl.textContent = `$${adjustedTotal.toFixed(2)}${currSuffix}`;

    const persons = parseInt(personCountEl?.value, 10) || 1;
    const perPerson = Math.round((adjustedTotal / persons) * 100) / 100;
    if (perPersonEl) perPersonEl.textContent = `$${perPerson.toFixed(2)}${currSuffix}`;
  }

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

  handleDrop(itemId, type) {
    // Open the service modal pre-filled with the dropped item
    this.openServiceModal();

    // Wait for modal to render, then select the type and item
    setTimeout(() => {
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
        this.preselectTransportRoute(itemId);
      } else if (type === 'tour') {
        const select = document.getElementById('tourSelect');
        if (select) {
          select.value = itemId;
          this.handleTourSelection(itemId);
        }
      }
    }, 200);
  }

  preselectTransportRoute(serviceId) {
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
      this.handleTransportTypeChange();
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
        this.handleDirectionTypeChange();
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
      new ExperienceServicesBuilder(experienceId);
    }
  }
});
