/* eslint-env browser */
/* global bootstrap */
/**
 * Experience Services Builder - Simplified services builder (single-day)
 * Based on ItineraryBuilder from quote-services-v2.js but without multi-day management
 * Created by Denisse Maldonado
 */

class ExperienceServicesBuilder {
  constructor(experienceId) {
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
    this.agencyRateCache = null;
    this.driverTourRateCache = null;

    // Pricing rates for Pago/Moneda
    this.transferRate = 3.0;
    this.agencyRate = 5.0;
    this.exchangeRate = 20.0;

    this.init();
  }

  getAccessToken() {
    if (window.experienceAccessToken) {
      document.cookie = `accessToken=${window.experienceAccessToken}; path=/; SameSite=Lax`;
      return window.experienceAccessToken;
    }
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'accessToken') return value;
    }
    return localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || null;
  }

  generateId(prefix = 'svc') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async init() {
    try {
      await this.loadExperienceData();

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
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) return;

      const response = await fetch(`/api/experiences/${this.experienceId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data && result.data.serviceItems) {
          this.processServiceItems(result.data.serviceItems);
        }
      }
    } catch (error) {
      console.error('Error loading experience data:', error);
    }
  }

  processServiceItems(serviceItemsData) {
    if (!serviceItemsData || !serviceItemsData.subconcepts) return;

    this.services.clear();

    serviceItemsData.subconcepts.forEach((sub) => {
      const serviceId = sub.id || this.generateId('svc');
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
        isWalkingTour: sub.isWalkingTour || false,
        languages: sub.languages || '',
        clientNotes: sub.clientNotes || '',
      });
    });
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
      const response = await fetch('/api/rates', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) this.ratesCache = data.data || [];
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
  }

  handleTransportTypeChange() {
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
    const flightDetails = document.getElementById('flightDetailsSection');
    if (flightDetails) {
      flightDetails.classList.toggle('d-none', transportType !== 'aeropuerto');
    }
  }

  handleTripTypeChange() {
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const oneWayForm = document.getElementById('oneWayForm');
    const roundTripForm = document.getElementById('roundTripForm');
    if (oneWayForm) oneWayForm.classList.toggle('d-none', tripType === 'round-trip');
    if (roundTripForm) roundTripForm.classList.toggle('d-none', tripType !== 'round-trip');
  }

  handleDirectionTypeChange() {
    const direction = document.querySelector('input[name="directionType"]:checked')?.value;
    const isArrival = direction === 'arrival';

    // Toggle origin/destination fields
    document.querySelectorAll('.transport-origin-arrival').forEach((el) => el.classList.toggle('d-none', !isArrival));
    document.querySelectorAll('.transport-origin-departure').forEach((el) => el.classList.toggle('d-none', isArrival));
    document.querySelectorAll('.transport-destination-arrival').forEach((el) => el.classList.toggle('d-none', !isArrival));
    document.querySelectorAll('.transport-destination-departure').forEach((el) => el.classList.toggle('d-none', isArrival));
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

  handleRateSelection(rateId) {
    if (!rateId) return;
    this.populateVehicleSelect(rateId);
  }

  handleVehicleSelection(vehicleId) {
    if (!vehicleId) return;

    const vehicle = this.vehicleTypesMap.get(vehicleId);
    if (vehicle) {
      const priceEl = document.getElementById('servicePrice');
      if (priceEl && vehicle.basePrice) {
        priceEl.value = vehicle.basePrice;
      }
    }
  }

  handleIncludeGuideChange(checked) {
    // Guide pricing is handled in the service save
  }

  handleIncludeGreeterChange(checked) {
    // Greeter pricing is handled in the service save
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

  populateVehicleSelect(rateId) {
    const select = document.getElementById('vehicleSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Sin vehiculo --</option>';
    if (this.vehiclesCache) {
      this.vehiclesCache.forEach((v) => {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = `${v.name} (${v.capacity} pax)`;
        select.appendChild(option);
      });
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
    const priceEl = document.getElementById('servicePrice');
    const quantityEl = document.getElementById('serviceQuantity');
    if (priceEl) priceEl.value = service.price || 0;
    if (quantityEl) quantityEl.value = service.quantity || 1;

    if (service.rateId) {
      const rateSelect = document.getElementById('transportCategory');
      if (rateSelect) rateSelect.value = service.rateId;
    }
    if (service.vehicleId) {
      const vehicleSelect = document.getElementById('vehicleSelect');
      if (vehicleSelect) vehicleSelect.value = service.vehicleId;
    }

    const includeGreeter = document.getElementById('includeGreeter');
    if (includeGreeter) includeGreeter.checked = service.includeGreeter || false;
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
    const quantity = parseInt(document.getElementById('serviceQuantity')?.value) || 1;
    const rateId = document.getElementById('transportCategory')?.value || null;
    const vehicleId = document.getElementById('vehicleSelect')?.value || null;
    const vehicleType = vehicleId ? this.vehicleTypesMap.get(vehicleId) : null;
    const includeGreeter = document.getElementById('includeGreeter')?.checked || false;

    return {
      concept: 'Transporte',
      price,
      quantity,
      rateId,
      vehicleId,
      vehicleType: vehicleId || null,
      vehicleTypeName: vehicleType ? vehicleType.name : null,
      includeGreeter,
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

  updateSaveStatus(status) {
    const indicator = document.getElementById('saveStatusIndicator');
    if (!indicator) return;

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
    this.setupDragSearch();
  }

  renderDragExperiences() {
    const container = document.getElementById('dragExperiencesList');
    if (!container) return;

    let html = '';
    let count = 0;

    // Regular experiences (exclude current)
    this.experiencesCache.forEach((exp) => {
      if (exp.id !== this.experienceId && exp.type !== 'provider_experience') {
        html += this.renderDraggableItem(exp.id, exp.name, 'experience', null);
        count++;
      }
    });

    // Provider experiences
    const providerExps = this.providerExperiencesCache || [];
    providerExps.forEach((exp) => {
      if (!this.experiencesCache.has(exp.id)) {
        this.experiencesCache.set(exp.id, exp);
      }
      const providerLabel = exp.provider ? exp.provider.name : null;
      html += this.renderDraggableItem(exp.id, exp.name, 'experience', providerLabel);
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

    this.toursCache.forEach((tour) => {
      const name = tour.destinationPOI?.name || tour.name || 'Sin destino';
      const subLabel = tour.isWalkingTour ? 'Walking' : null;
      html += this.renderDraggableItem(tour.id, name, 'tour', subLabel);
      count++;
    });

    container.innerHTML = html || '<div class="text-center text-muted py-3 small">No hay tours disponibles</div>';
    const badge = document.getElementById('toursCount');
    if (badge) badge.textContent = count;
  }

  renderDraggableItem(id, name, type, subLabel) {
    const icon = type === 'experience' ? 'ti-beach' : 'ti-map-2';
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

  setupDragSearch() {
    const expSearch = document.getElementById('dragSearchExperiences');
    const tourSearch = document.getElementById('dragSearchTours');

    if (expSearch) {
      expSearch.addEventListener('input', (e) => this.filterDragItems(e.target.value, 'dragExperiencesList'));
    }
    if (tourSearch) {
      tourSearch.addEventListener('input', (e) => this.filterDragItems(e.target.value, 'dragToursList'));
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
      const typeRadio = document.getElementById(type === 'experience' ? 'typeExperience' : 'typeTour');
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
      } else if (type === 'tour') {
        const select = document.getElementById('tourSelect');
        if (select) {
          select.value = itemId;
          this.handleTourSelection(itemId);
        }
      }
    }, 200);
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('[data-experience-id]');
  if (container) {
    const experienceId = container.dataset.experienceId;
    if (experienceId && experienceId !== 'new') {
      new ExperienceServicesBuilder(experienceId);
    }
  }
});
