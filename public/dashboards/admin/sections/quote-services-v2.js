/* eslint-env browser */
/* global bootstrap */
/**
 * Quote Services V2 Controller - Travefy-inspired Itinerary Builder
 * Created by Denisse Maldonado.
 */

class ItineraryBuilder {
  constructor(quoteId) {
    this.quoteId = quoteId;
    this.days = [];
    this.services = new Map();
    this.currentDayId = null;
    this.currentServiceId = null;
    this.editMode = null; // 'day' or 'service'
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;

    // Store field values for each service type to preserve user input
    this.serviceTypeFields = {
      experience: {},
      tour: {},
      concepto: {},
      transport: {},
    };
    this.currentServiceType = null;

    // Cache for API data
    this.vehiclesCache = null;
    this.experiencesCache = new Map();
    this.toursCache = new Map();

    // Cache for pricing data
    this.tourPricesMap = new Map(); // Key: `${tourId}_${rateId}` -> Array of TourPrices
    this.clientPricesMap = new Map(); // Key: `${tourId}_${rateId}_${vehiclePtr}` -> ClientPrice
    this.vehicleTypesMap = new Map(); // Key: vehicleTypeId -> VehicleType info
    this.ratesCache = null;
    this.providerExperiencesCache = null;
    this.agencyRateCache = null;
    this.driverTourRateCache = null;
    this.guideTransportRateCache = null;
    this.transferRateCache = null;

    // Transport route pricing cache
    this.transportPriceData = null;

    // Number of people from quote data
    this.numberOfPeople = 0;

    // Pricing rates (loaded via PricingUtils)
    this.exchangeRate = 0;
    this.transferRate = 0;
    this.agencyRate = 0;

    // Client-specific pricing cache
    this.clientId = null;
    this.clientPricesCache = new Map(); // serviceId -> client prices
    this.clientTourPricesCache = new Map(); // tourId -> client tour prices

    this.init();
  }

  // Get access token from various sources
  getAccessToken() {
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
  }

  getClientId() {
    // Try to get client ID from the quote information section
    const clientIdInput = document.getElementById('clientId');
    if (clientIdInput) {
      return clientIdInput.value;
    }

    // Try to get from TomSelect if it's initialized
    try {
      const clientTS = document.querySelector('#clientId.tomselect');
      if (clientTS && clientTS.tomselect) {
        return clientTS.tomselect.getValue();
      }
    } catch (error) {
      console.debug('TomSelect not available for client ID');
    }

    return null;
  }

  async init() {
    // Show loading overlay
    const loadingOverlay = document.getElementById('itineraryLoadingOverlay');

    try {
      // Load initial data
      await this.loadQuoteData();

      // Get client ID for personalized pricing
      this.clientId = this.getClientId();

      // Load all data concurrently for better performance
      await Promise.all([
        this.loadVehicles(),
        this.loadAllRates(),
        this.loadAllExperiences(),
        this.loadAllTours(),
        this.loadAllTourPrices(),
        this.loadAllClientPrices(),
        this.loadVehicleTypes(),
        this.loadProviderExperiences(),
        this.loadDriverTourRate(),
        this.loadGuideTransportRate(),
      ]);

      // Load pricing rates (exchange, transfer, agency) with auth
      await this.loadPricingRates();

      // Load client-specific pricing if client is available
      if (this.clientId) {
        await this.loadClientSpecificPricing();
      }

      // Setup UI
      this.setupEventListeners();
      this.renderItinerary();

      // Initialize tooltips and popovers
      this.initializeTooltips();

      // Watch for client changes in the information section
      this.setupClientChangeListener();

      // Sync numberOfPeople from information tab input
      const numberOfPeopleInput = document.getElementById('numberOfPeople');
      if (numberOfPeopleInput) {
        // Read initial value if not loaded from API yet
        if (!this.numberOfPeople) {
          this.numberOfPeople = parseInt(numberOfPeopleInput.value) || 0;
        }
        numberOfPeopleInput.addEventListener('change', () => {
          this.numberOfPeople = parseInt(numberOfPeopleInput.value) || 0;
          this.updateAllDayPerPerson();
          this.updateTotals();
        });
      }

      // Hide loading overlay
      if (loadingOverlay) {
        loadingOverlay.classList.add('d-none');
      }
    } catch (error) {
      console.error('Error initializing itinerary builder:', error);
      this.showAlert('Error al cargar el itinerario', 'danger');
      // Hide loading overlay even on error
      if (loadingOverlay) {
        loadingOverlay.classList.add('d-none');
      }
    }
  }

  setupEventListeners() {
    // Day Management
    document.getElementById('addNewDayBtn')?.addEventListener('click', () => this.openDayModal());
    document.getElementById('addDaySidebarBtn')?.addEventListener('click', () => this.openDayModal());
    document.getElementById('emptyStateAddDayBtn')?.addEventListener('click', () => this.openDayModal());
    document.getElementById('saveDayBtn')?.addEventListener('click', () => this.saveDay());

    // Service Management
    document.getElementById('saveServiceBtn')?.addEventListener('click', () => this.saveService());

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

    // Direction Type Toggle (Arrival/Departure)
    document.querySelectorAll('input[name="directionType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleDirectionTypeChange());
    });

    // Restore persisted currency and payment type selections
    const savedCurrency = sessionStorage.getItem('quoteServices_currency');
    const savedPaymentType = sessionStorage.getItem('quoteServices_paymentType');
    const currencySelect = document.getElementById('currencySelect');
    const priceTypeSelect = document.getElementById('priceTypeSelect');

    if (savedCurrency && currencySelect) {
      currencySelect.value = savedCurrency;
    }
    if (savedPaymentType && priceTypeSelect) {
      priceTypeSelect.value = savedPaymentType;
    }

    // Currency change listener
    currencySelect?.addEventListener('change', (e) => {
      sessionStorage.setItem('quoteServices_currency', e.target.value);
      this.renderDaysContent();
      this.updateTotals();
      this.updateServicePriceBreakdown();
    });

    // Payment type change listener
    priceTypeSelect?.addEventListener('change', (e) => {
      sessionStorage.setItem('quoteServices_paymentType', e.target.value);
      this.renderDaysContent();
      this.updateTotals();
      this.updateServicePriceBreakdown();
    });

    // Experience selection handler
    document.getElementById('experienceSelect')?.addEventListener('change', (e) => {
      this.handleExperienceSelection(e.target.value);
    });

    // Tour selection handler
    document.getElementById('tourSelect')?.addEventListener('change', (e) => {
      this.handleTourSelection(e.target.value);
    });

    // Tour requires transport checkbox handler
    document.getElementById('tourRequiresTransport')?.addEventListener('change', (e) => {
      this.handleTourTransportToggle(e.target.checked);
    });

    // Rate selection handler for tour vehicles
    document.getElementById('transportCategory')?.addEventListener('change', (e) => {
      this.handleRateSelection(e.target.value);
    });

    // Vehicle selection handler for price update
    document.getElementById('vehicleSelect')?.addEventListener('change', (e) => {
      this.handleVehicleSelection(e.target.value);
    });

    // Include guide checkbox listener for tours (Guía + Chofer)
    document.getElementById('includeGuide')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Uncheck greeter when guide is selected (mutual exclusivity)
        const greeterCheckbox = document.getElementById('includeGreeter');
        if (greeterCheckbox) {
          greeterCheckbox.checked = false;
        }
      }
      this.handleIncludeGuideChange(e.target.checked);
    });

    // Include greeter checkbox listener
    document.getElementById('includeGreeter')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Uncheck guide when greeter is selected (mutual exclusivity)
        const guideCheckbox = document.getElementById('includeGuide');
        if (guideCheckbox) {
          guideCheckbox.checked = false;
        }
      }
      // Show/hide "Viaja en el vehículo" sub-checkbox
      const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
      const greeterInVehicle = document.getElementById('greeterInVehicle');
      if (greeterInVehicleContainer) {
        if (e.target.checked) {
          greeterInVehicleContainer.classList.remove('d-none');
          if (greeterInVehicle) greeterInVehicle.checked = true;
        } else {
          greeterInVehicleContainer.classList.add('d-none');
          if (greeterInVehicle) greeterInVehicle.checked = false;
        }
      }
      this.handleIncludeGreeterChange(e.target.checked);
    });

    // Greeter in vehicle checkbox listener - update capacity note
    document.getElementById('greeterInVehicle')?.addEventListener('change', () => {
      this.updateVehicleCapacityNote();
    });

    // Price input listener - update conversion preview when user types a price
    document.getElementById('servicePrice')?.addEventListener('input', () => {
      this.updateServicePriceBreakdown();
    });

    // Quantity change listener - recalculate transport price and update breakdown
    document.getElementById('serviceQuantity')?.addEventListener('change', () => {
      const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
      if (serviceType === 'transport') {
        this.recalculateTransportPrice();
      }
      this.updateServicePriceBreakdown();
    });

    // People quantity inputs - update breakdown when quantities change
    ['tourAdultsQuantity', 'tourChildrenQuantity', 'tourAdultsNoAlcoholQuantity',
      'adultsQuantity', 'childrenQuantity', 'adultsNoAlcoholQuantity',
      'conceptoAdultsQuantity', 'conceptoChildrenQuantity', 'conceptoAdultsNoAlcoholQuantity'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.updateServicePriceBreakdown();
      });
    });

    // Tour/Experience price inputs - update breakdown when prices change
    ['tourAdultPrice', 'tourChildPrice', 'tourNoAlcoholPrice',
      'adultPrice', 'childPrice', 'noAlcoholPrice'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.updateServicePriceBreakdown();
      });
    });

    // Concepto schedule checkbox handler
    document.getElementById('conceptoHasSchedule')?.addEventListener('change', (e) => {
      this.handleConceptoScheduleToggle(e.target.checked);
    });

    // Time input formatting and validation
    this.setupTimeInputs();

    // Delete Confirmation
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', () => this.confirmDelete());

    // Preview
    document.getElementById('previewItineraryBtn')?.addEventListener('click', () => this.showPreview());
    document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.exportPdf());

    // Auto-save on form changes - disabled to prevent 401 errors
    // this.setupAutoSave();

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();
  }

  setupAutoSave() {
    const forms = ['dayForm', 'serviceForm'];
    forms.forEach((formId) => {
      const form = document.getElementById(formId);
      if (form) {
        form.addEventListener('input', () => {
          this.hasUnsavedChanges = true;
          this.updateSaveStatus('unsaved');
          this.scheduleAutoSave();
        });
      }
    });
  }

  scheduleAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      if (this.hasUnsavedChanges) {
        this.autoSave();
      }
    }, 2000);
  }

  async autoSave() {
    try {
      this.updateSaveStatus('saving');
      // Save current state to backend
      await this.saveToBackend();
      this.hasUnsavedChanges = false;
      this.updateSaveStatus('saved');
    } catch (error) {
      console.error('Auto-save error:', error);
      this.updateSaveStatus('error');
    }
  }

  updateSaveStatus(status) {
    const indicator = document.getElementById('saveStatusIndicator');
    if (!indicator) return;

    const badges = {
      saved: '<span class="badge bg-success"><i class="ti ti-check me-1"></i>Guardado</span>',
      saving: '<span class="badge bg-warning"><i class="ti ti-loader me-1"></i>Guardando...</span>',
      unsaved: '<span class="badge bg-secondary"><i class="ti ti-edit me-1"></i>Sin guardar</span>',
      error: '<span class="badge bg-danger"><i class="ti ti-alert-circle me-1"></i>Error al guardar</span>',
    };

    indicator.innerHTML = badges[status] || badges.saved;
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + N: New Day
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        this.openDayModal();
      }

      // Ctrl/Cmd + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.autoSave();
      }

      // Escape: Close modals
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });
  }

  // Day Management Methods
  openDayModal(dayId = null) {
    this.editMode = 'day';
    this.currentDayId = dayId;

    const modal = new bootstrap.Modal(document.getElementById('dayModal'));
    const form = document.getElementById('dayForm');

    // Reset or populate form
    if (dayId && this.days.find((d) => d.id === dayId)) {
      const day = this.days.find((d) => d.id === dayId);
      document.getElementById('dayModalLabel').innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Día';
      document.getElementById('dayTitle').value = day.title || '';
      document.getElementById('dayDate').value = day.date || '';
      document.getElementById('dayDescription').value = day.description || '';
    } else {
      document.getElementById('dayModalLabel').innerHTML = '<i class="ti ti-calendar-plus me-2"></i>Agregar Día';
      form.reset();

      // Calculate the next sequential date
      let nextDate;
      if (this.days.length > 0) {
        // Get the last day's date
        const lastDay = this.days[this.days.length - 1];
        if (lastDay.date) {
          const lastDate = new Date(`${lastDay.date}T00:00:00`);
          nextDate = new Date(lastDate);
          nextDate.setDate(lastDate.getDate() + 1);
        } else {
          // If last day has no date, use today
          nextDate = new Date();
        }
      } else {
        // First day, use today
        nextDate = new Date();
      }

      // Set the date input to the calculated date
      document.getElementById('dayDate').value = nextDate.toISOString().split('T')[0];
    }

    modal.show();
  }

  async saveDay() {
    const title = document.getElementById('dayTitle').value.trim();
    const date = document.getElementById('dayDate').value;
    const description = document.getElementById('dayDescription').value.trim();

    // Clear any previous modal alerts
    this.clearModalAlert('dayModalAlert');

    if (!title) {
      this.showModalAlert('dayModalAlert', 'Por favor ingresa un título para el día', 'warning');
      return;
    }

    try {
      if (this.currentDayId) {
        // Update existing day
        const dayIndex = this.days.findIndex((d) => d.id === this.currentDayId);
        if (dayIndex !== -1) {
          this.days[dayIndex] = {
            ...this.days[dayIndex],
            title,
            date,
            description,
          };
        }
      } else {
        // Add new day
        const newDay = {
          id: this.generateId('day'),
          number: this.days.length + 1,
          title,
          date: date || this.getNextSequentialDate(),
          description,
          services: [],
        };
        this.days.push(newDay);
      }

      // Sort days by date and reassign numbers
      this.days.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
      this.days.forEach((d, i) => { d.number = i + 1; });

      // Save to backend
      await this.saveToBackend();

      // Update UI
      this.renderItinerary();
      this.closeModal('dayModal');
      this.showAlert('Día guardado exitosamente', 'success');
    } catch (error) {
      console.error('Detailed error saving day:', {
        error: error.message,
        stack: error.stack,
        days: this.days,
        quoteId: this.quoteId,
      });
      this.showModalAlert('dayModalAlert', `Error al guardar el día: ${error.message}`, 'danger');
    }
  }

  deleteDay(dayId) {
    this.currentDayId = dayId;
    const day = this.days.find((d) => d.id === dayId);

    if (!day) return;

    const message = `¿Estás seguro de que deseas eliminar el "${day.title}"? Se eliminarán también todos los servicios asociados.`;
    document.getElementById('deleteConfirmMessage').textContent = message;

    const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    modal.show();
  }

  // Service Management Methods
  openServiceModal(dayId, serviceId = null) {
    this.editMode = 'service';
    this.currentDayId = dayId;
    this.currentServiceId = serviceId;

    const modal = new bootstrap.Modal(document.getElementById('serviceModal'));
    const form = document.getElementById('serviceForm');

    // Load day-specific data
    this.loadDayExperiences(dayId);
    this.loadDayTours(dayId);

    // Populate rates dropdown when modal opens
    this.populateRatesDropdown();

    // Reset or populate form
    if (serviceId && this.services.has(serviceId)) {
      const service = this.services.get(serviceId);
      document.getElementById('serviceModalLabel').innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Servicio';
      this.populateServiceForm(service);
    } else {
      document.getElementById('serviceModalLabel').innerHTML = '<i class="ti ti-plus-circle me-2"></i>Agregar Servicio';
      form.reset();

      // Clear tour details when opening a new service modal
      const tourDetails = document.getElementById('tourDetails');
      if (tourDetails) {
        tourDetails.style.display = 'none';
        tourDetails.innerHTML = '';
      }

      // Clear tour schedule/horarios disponibles
      this.clearTourSchedule();

      // Also clear experience schedule
      this.clearExperienceSchedule();

      // Clear tour transport checkbox
      const tourRequiresTransport = document.getElementById('tourRequiresTransport');
      if (tourRequiresTransport) {
        tourRequiresTransport.checked = false;
      }

      // Clear vehicle dropdown and transport price cache
      this.clearVehicleDropdown();
      this.transportPriceData = null;

      // Clear price breakdown
      const breakdown = document.getElementById('servicePriceBreakdown');
      if (breakdown) breakdown.classList.add('d-none');

      this.handleServiceTypeChange('experience'); // Default to experience
    }

    modal.show();
  }

  handleServiceTypeChange(type) {
    // Clear breakdown panel when switching service types
    const breakdown = document.getElementById('servicePriceBreakdown');
    if (breakdown) breakdown.classList.add('d-none');

    // Save current service type fields before switching
    this.saveCurrentServiceTypeFields();

    // Hide all content sections
    document.querySelectorAll('.service-content').forEach((content) => {
      content.classList.add('d-none');
    });

    // Clear tour details and schedules when switching away from tour type
    if (type !== 'tour') {
      const tourDetails = document.getElementById('tourDetails');
      if (tourDetails) {
        tourDetails.style.display = 'none';
        tourDetails.innerHTML = '';
      }
      this.clearTourSchedule();
    }

    // Clear experience schedules when switching away from experience type
    if (type !== 'experience') {
      this.clearExperienceSchedule();
    }

    // Show/hide transport-specific selectors
    const transportTypeSelector = document.getElementById('transportTypeSelector');
    const tripTypeSelector = document.getElementById('tripTypeSelector');
    const tourTransportCheckbox = document.getElementById('tourTransportCheckboxContainer');
    const transportPeopleFieldsRow = document.getElementById('transportPeopleFieldsRow');

    if (type === 'transport') {
      transportTypeSelector?.classList.remove('d-none');
      tripTypeSelector?.classList.remove('d-none');
      // Show transport people fields
      if (transportPeopleFieldsRow) {
        transportPeopleFieldsRow.style.display = 'flex';
      }
      // Initialize transport form based on current selections
      this.handleTransportTypeChange();
      this.handleTripTypeChange();
      // Hide tour transport checkbox
      if (tourTransportCheckbox) {
        tourTransportCheckbox.style.display = 'none';
      }
    } else if (type === 'tour') {
      transportTypeSelector?.classList.add('d-none');
      tripTypeSelector?.classList.add('d-none');
      // Hide transport people fields
      if (transportPeopleFieldsRow) {
        transportPeopleFieldsRow.style.display = 'none';
      }
      // Show tour transport checkbox
      if (tourTransportCheckbox) {
        tourTransportCheckbox.style.display = 'block';
      }
    } else {
      transportTypeSelector?.classList.add('d-none');
      tripTypeSelector?.classList.add('d-none');
      // Hide transport people fields
      if (transportPeopleFieldsRow) {
        transportPeopleFieldsRow.style.display = 'none';
      }
      // Hide tour transport checkbox
      if (tourTransportCheckbox) {
        tourTransportCheckbox.style.display = 'none';
      }
    }

    // Show/hide category, vehicle, guide and quantity fields based on service type
    const categoryField = document.getElementById('transportCategory')?.closest('.col-md-6');
    const vehicleField = document.getElementById('vehicleSelect')?.closest('.col-md-4');
    const guideField = document.getElementById('includeGuide')?.closest('.col-md-2');
    const guideLabel = document.getElementById('guideLabel');
    const serviciosLabel = guideField?.querySelector('.form-label');
    const priceField = document.getElementById('servicePrice');
    const priceLabel = document.querySelector('label[for="servicePrice"]');
    const currencyField = document.getElementById('currencySelect');
    const priceTypeField = document.getElementById('priceTypeSelect');
    const currencyLabel = document.querySelector('label[for="currencySelect"]');
    const priceTypeLabel = document.querySelector('label[for="priceTypeSelect"]');
    const quantityField = document.getElementById('serviceQuantity')?.closest('.col-md-6');

    if (type === 'concepto' || type === 'experience') {
      // Hide category, vehicle and guide for Concepto and Experience
      categoryField?.classList.add('d-none');
      vehicleField?.classList.add('d-none');
      guideField?.classList.add('d-none');

      // Remove required from category for both, but handle price differently
      document.getElementById('transportCategory')?.removeAttribute('required');

      if (type === 'concepto') {
        // Hide quantity field for Concepto
        quantityField?.classList.add('d-none');
        document.getElementById('serviceQuantity')?.removeAttribute('required');

        // Price, currency and price type are optional for Concepto
        priceField?.removeAttribute('required');
        currencyField?.removeAttribute('required');
        priceTypeField?.removeAttribute('required');

        // Update labels to remove asterisk
        if (priceLabel) {
          priceLabel.innerHTML = 'Precio';
        }
        if (currencyLabel) {
          currencyLabel.innerHTML = 'Moneda';
        }
        if (priceTypeLabel) {
          priceTypeLabel.innerHTML = 'Pago';
        }
      } else {
        // Show quantity field for Experience
        quantityField?.classList.remove('d-none');
        document.getElementById('serviceQuantity')?.setAttribute('required', 'required');

        // Price, currency and price type are required for Experience
        priceField?.setAttribute('required', 'required');
        currencyField?.setAttribute('required', 'required');
        priceTypeField?.setAttribute('required', 'required');

        // Update labels to add asterisk
        if (priceLabel) {
          priceLabel.innerHTML = 'Precio <span class="text-danger">*</span>';
        }
        if (currencyLabel) {
          currencyLabel.innerHTML = 'Moneda <span class="text-danger">*</span>';
        }
        if (priceTypeLabel) {
          priceTypeLabel.innerHTML = 'Pago <span class="text-danger">*</span>';
        }
      }
    } else if (type === 'tour') {
      // For tours, visibility of transport fields depends on the checkbox
      const requiresTransport = document.getElementById('tourRequiresTransport');
      const showTransportFields = requiresTransport?.checked || false;

      // Get the standard pricing section
      const standardPricingSection = document.getElementById('standardPricingSection');

      if (showTransportFields) {
        // Show transport fields if required
        categoryField?.classList.remove('d-none');
        vehicleField?.classList.remove('d-none');
        guideField?.classList.remove('d-none');
        document.getElementById('transportCategory')?.setAttribute('required', 'required');

        // Show quantity field for Tour
        quantityField?.classList.remove('d-none');
        document.getElementById('serviceQuantity')?.setAttribute('required', 'required');

        // Show pricing fields
        if (standardPricingSection) {
          standardPricingSection.classList.remove('d-none');
        }

        // Set pricing fields as required
        priceField?.setAttribute('required', 'required');
        currencyField?.setAttribute('required', 'required');
        priceTypeField?.setAttribute('required', 'required');

        // Update labels to add asterisk
        if (priceLabel) {
          priceLabel.innerHTML = 'Precio <span class="text-danger">*</span>';
        }
        if (currencyLabel) {
          currencyLabel.innerHTML = 'Moneda <span class="text-danger">*</span>';
        }
        if (priceTypeLabel) {
          priceTypeLabel.innerHTML = 'Pago <span class="text-danger">*</span>';
        }
      } else {
        // Hide transport fields if not required
        categoryField?.classList.add('d-none');
        vehicleField?.classList.add('d-none');
        guideField?.classList.add('d-none');
        document.getElementById('transportCategory')?.removeAttribute('required');

        // Show quantity field for Tour (even without transport)
        quantityField?.classList.remove('d-none');
        document.getElementById('serviceQuantity')?.setAttribute('required', 'required');

        // Hide pricing fields
        if (standardPricingSection) {
          standardPricingSection.classList.add('d-none');
        }

        // Remove required from pricing fields
        priceField?.removeAttribute('required');
        currencyField?.removeAttribute('required');
        priceTypeField?.removeAttribute('required');

        // Update labels to remove asterisk
        if (priceLabel) {
          priceLabel.innerHTML = 'Precio';
        }
        if (currencyLabel) {
          currencyLabel.innerHTML = 'Moneda';
        }
        if (priceTypeLabel) {
          priceTypeLabel.innerHTML = 'Pago';
        }
      }

      // Change title and checkbox label for Tour
      if (serviciosLabel) {
        serviciosLabel.textContent = 'Opcional';
      }
      if (guideLabel) {
        guideLabel.textContent = 'Guía + Chofer';
      }
    } else {
      // Show category, vehicle and guide for Transport only
      categoryField?.classList.remove('d-none');
      vehicleField?.classList.remove('d-none');
      guideField?.classList.remove('d-none');

      // Show quantity field for Transport
      quantityField?.classList.remove('d-none');
      document.getElementById('serviceQuantity')?.setAttribute('required', 'required');

      // Reset title and checkbox label for Transport
      if (serviciosLabel) {
        serviciosLabel.textContent = 'Opcional';
      }
      if (guideLabel) {
        guideLabel.textContent = 'Guía';
      }

      // Restore required to category, price, currency and price type when visible
      document.getElementById('transportCategory')?.setAttribute('required', 'required');
      priceField?.setAttribute('required', 'required');
      currencyField?.setAttribute('required', 'required');
      priceTypeField?.setAttribute('required', 'required');

      // Update labels to add asterisk
      if (priceLabel) {
        priceLabel.innerHTML = 'Precio <span class="text-danger">*</span>';
      }
      if (currencyLabel) {
        currencyLabel.innerHTML = 'Moneda <span class="text-danger">*</span>';
      }
      if (priceTypeLabel) {
        priceTypeLabel.innerHTML = 'Pago <span class="text-danger">*</span>';
      }
    }

    // Show selected content section
    const contentMap = {
      experience: 'experienceContent',
      tour: 'tourContent',
      transport: 'transportContent',
      concepto: 'conceptoContent',
    };

    const contentId = contentMap[type];
    if (contentId) {
      document.getElementById(contentId)?.classList.remove('d-none');
    }

    // Update current service type and restore fields for the new type
    this.currentServiceType = type;
    this.restoreServiceTypeFields(type);

    // Load tours when tour type is selected
    if (type === 'tour' && this.currentDayId) {
      this.loadDayTours(this.currentDayId);
    }

    // Repopulate rates dropdown to filter based on service type
    this.populateRatesDropdown();
  }

  // Save current form values for the current service type
  saveCurrentServiceTypeFields() {
    if (!this.currentServiceType) return;

    const formData = {};

    // Common fields across all service types
    const commonFields = [
      'servicePrice', 'currencySelect', 'priceTypeSelect', 'serviceDescription',
      'internalNotes', 'clientNotes', 'providerNotes', 'teamNotes',
    ];

    // Service type specific fields
    const serviceSpecificFields = {
      experience: ['experienceSelect', 'experienceCategory'],
      tour: ['tourSelect', 'tourCategory', 'transportCategory', 'vehicleSelect', 'includeGuide', 'includeGreeter'],
      transport: ['transportCategory', 'vehicleSelect', 'includeGuide', 'includeGreeter'],
      concepto: ['conceptoDescription'],
    };

    // Save common fields
    commonFields.forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (field.type === 'checkbox') {
          formData[fieldId] = field.checked;
        } else {
          formData[fieldId] = field.value;
        }
      }
    });

    // Save service-specific fields
    const specificFields = serviceSpecificFields[this.currentServiceType] || [];
    specificFields.forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (field.type === 'checkbox') {
          formData[fieldId] = field.checked;
        } else {
          formData[fieldId] = field.value;
        }
      }
    });

    // Save transport type and trip type for transport services
    if (this.currentServiceType === 'transport') {
      const transportType = document.querySelector('input[name="transportType"]:checked');
      const tripType = document.querySelector('input[name="tripType"]:checked');
      if (transportType) formData.transportType = transportType.value;
      if (tripType) formData.tripType = tripType.value;
    }

    this.serviceTypeFields[this.currentServiceType] = formData;
  }

  // Restore form values for the target service type
  restoreServiceTypeFields(targetServiceType) {
    const savedFields = this.serviceTypeFields[targetServiceType];
    if (!savedFields || Object.keys(savedFields).length === 0) {
      // Set default values for service types when no saved data exists
      this.setDefaultValuesForServiceType(targetServiceType);
      return;
    }

    // Restore all saved fields
    Object.keys(savedFields).forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (field.type === 'checkbox') {
          field.checked = savedFields[fieldId];
        } else {
          field.value = savedFields[fieldId];
        }
      }
    });

    // Restore radio buttons for transport
    if (targetServiceType === 'transport') {
      if (savedFields.transportType) {
        const transportTypeRadio = document.querySelector(`input[name="transportType"][value="${savedFields.transportType}"]`);
        if (transportTypeRadio) transportTypeRadio.checked = true;
      }
      if (savedFields.tripType) {
        const tripTypeRadio = document.querySelector(`input[name="tripType"][value="${savedFields.tripType}"]`);
        if (tripTypeRadio) tripTypeRadio.checked = true;
      }
    }
  }

  // Set default values when switching to a service type for the first time
  setDefaultValuesForServiceType(serviceType) {
    // Set default values based on service type
    const priceField = document.getElementById('servicePrice');

    switch (serviceType) {
      case 'concepto':
        // Concepto defaults to empty/0 price (optional pricing)
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
  }

  clearTransportFormFields() {
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

    // Clear specific location
    const specificLocation = document.getElementById('transportSpecificLocation');
    if (specificLocation) specificLocation.value = '';
    const specificLocationRow = document.getElementById('specificLocationRow');
    if (specificLocationRow) specificLocationRow.classList.add('d-none');

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

    // Clear price field
    const priceField = document.getElementById('servicePrice');
    if (priceField) priceField.value = '';

    // Hide breakdown panel
    const breakdown = document.getElementById('servicePriceBreakdown');
    if (breakdown) breakdown.classList.add('d-none');
  }

  handleTransportTypeChange() {
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
  }

  handleTripTypeChange() {
    this.clearTransportFormFields();
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const oneWayForm = document.getElementById('oneWayForm');
    const roundTripForm = document.getElementById('roundTripForm');
    const arrivalDepartureSelector = document.getElementById('arrivalDepartureSelector');

    // Show appropriate form based on trip type
    if (tripType === 'one-way') {
      oneWayForm?.classList.remove('d-none');
      roundTripForm?.classList.add('d-none');
      // Show arrival/departure selector only for one-way
      arrivalDepartureSelector?.classList.remove('d-none');
      // Initialize direction type fields
      this.handleDirectionTypeChange();
    } else {
      oneWayForm?.classList.add('d-none');
      roundTripForm?.classList.remove('d-none');
      // Hide arrival/departure selector for round trip
      arrivalDepartureSelector?.classList.add('d-none');
    }

    // Re-check transport type to show/hide flight details correctly
    this.handleTransportTypeChange();
  }

  handleDirectionTypeChange() {
    this.clearTransportFormFields();
    const directionType = document.querySelector('input[name="directionType"]:checked')?.value;
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;

    // Get all field elements
    const originSelect = document.getElementById('transportOriginSelect');
    const originText = document.getElementById('transportOriginText');
    const originComboWrapper = document.getElementById('transportOriginComboWrapper');
    const destinationComboWrapper = document.getElementById('transportDestinationComboWrapper');
    const destinationSelect = document.getElementById('transportDestinationSelect');

    // Get time label element
    const timeLabel = document.querySelector('label[for="flightTime"]');

    // Hide all origin/destination variants first
    originSelect?.classList.add('d-none');
    originText?.classList.add('d-none');
    originComboWrapper?.classList.add('d-none');
    destinationComboWrapper?.classList.add('d-none');
    destinationSelect?.classList.add('d-none');
    originSelect?.removeAttribute('required');
    originText?.removeAttribute('required');
    document.getElementById('transportOriginCombo')?.removeAttribute('required');
    document.getElementById('transportDestinationCombo')?.removeAttribute('required');
    destinationSelect?.removeAttribute('required');

    if (directionType === 'arrival') {
      // Arrival: Origin = SELECT (airports), Destination = COMBO (hotels/cities)
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      destinationComboWrapper?.classList.remove('d-none');
      document.getElementById('transportDestinationCombo')?.setAttribute('required', 'required');

      if (timeLabel) {
        timeLabel.textContent = 'Hora de Llegada';
      }
    } else if (directionType === 'departure') {
      if (transportType === 'aeropuerto') {
        // Departure + Aeropuerto: Origin = COMBO (hotels/cities), Destination = SELECT (airports)
        originComboWrapper?.classList.remove('d-none');
        document.getElementById('transportOriginCombo')?.setAttribute('required', 'required');
        destinationSelect?.classList.remove('d-none');
        destinationSelect?.setAttribute('required', 'required');
      } else {
        // Departure + other: Origin = text, Destination = combo
        originText?.classList.remove('d-none');
        originText?.setAttribute('required', 'required');
        destinationComboWrapper?.classList.remove('d-none');
        document.getElementById('transportDestinationCombo')?.setAttribute('required', 'required');
      }

      if (timeLabel) {
        timeLabel.textContent = 'Hora de Salida';
      }
    }

    // Re-populate dropdowns considering direction
    if (transportType) {
      populateDropdownsForTransportType(transportType, directionType);
    }
  }

  async saveService() {
    const serviceData = this.collectServiceData();

    // Clear any previous modal alerts
    this.clearModalAlert('serviceModalAlert');

    if (!this.validateServiceData(serviceData)) {
      return;
    }

    try {
      if (this.currentServiceId) {
        // Update existing service
        const existingService = this.services.get(this.currentServiceId);
        const updatedService = {
          ...existingService,
          ...serviceData,
        };

        this.services.set(this.currentServiceId, updatedService);

        // Recalculate overlaps for this day since service time might have changed
        const day = this.days.find((d) => d.id === updatedService.dayId);
        if (day) {
          this.recalculateOverlapsForDay(day);
        }
      } else {
        // Add new service
        const newServiceId = this.generateId('service');
        this.services.set(newServiceId, {
          id: newServiceId,
          dayId: this.currentDayId,
          ...serviceData,
        });

        // Add service to day
        const day = this.days.find((d) => d.id === this.currentDayId);
        if (day) {
          day.services.push(newServiceId);
          // Sort services by time and remove duplicates
          day.services = this.sortAndDeduplicateServices(day.services);
        }
      }

      // Save to backend
      await this.saveToBackend();

      // Update UI
      this.renderItinerary();
      this.closeModal('serviceModal');
      this.showAlert('Servicio guardado exitosamente', 'success');
    } catch (error) {
      console.error('Error saving service:', error);
      this.showModalAlert('serviceModalAlert', `Error al guardar el servicio: ${error.message}`, 'danger');
    }
  }

  collectServiceData() {
    const type = document.querySelector('input[name="serviceType"]:checked')?.value;
    const vehicleSelectValue = document.getElementById('vehicleSelect')?.value;

    const data = {
      type,
      price: parseFloat(document.getElementById('servicePrice')?.value || 0),
      quantity: type === 'concepto' ? 1 : parseInt(document.getElementById('serviceQuantity')?.value || 1),
      notes: document.getElementById('serviceNotes')?.value,
      includeInTotal: document.getElementById('includeInTotal')?.checked !== false,
      greeterInVehicle: document.getElementById('greeterInVehicle')?.checked || false,
    };

    // For tours and transport, store vehicle type information
    if ((type === 'tour' || type === 'transport') && vehicleSelectValue) {
      data.vehicleType = vehicleSelectValue; // Store the vehicle type ID
      // Get display name from vehicle types map or transport price data
      if (type === 'transport' && this.transportPriceData?.vehicles) {
        const vehicle = this.transportPriceData.vehicles.find(v => v.vehicleTypeId === vehicleSelectValue);
        data.vehicleTypeName = vehicle ? vehicle.vehicleType : vehicleSelectValue;
      } else {
        data.vehicleTypeName = vehicleSelectValue;
      }
    } else if (vehicleSelectValue) {
      // For other services, store as vehicleId
      data.vehicleId = vehicleSelectValue;
    }

    // Collect type-specific data
    switch (type) {
      case 'experience': {
        data.experienceId = document.getElementById('experienceSelect')?.value;
        data.adultsQuantity = parseInt(document.getElementById('adultsQuantity')?.value || 0);
        data.childrenQuantity = parseInt(document.getElementById('childrenQuantity')?.value || 0);
        data.adultsNoAlcoholQuantity = parseInt(document.getElementById('adultsNoAlcoholQuantity')?.value || 0);

        // Collect schedule data - get the text content of selected option, not the index value
        const scheduleSelect = document.getElementById('experienceMultipleTime');
        if (scheduleSelect && scheduleSelect.selectedIndex > 0) {
          data.selectedSchedule = scheduleSelect.options[scheduleSelect.selectedIndex].textContent;
          data.startTime = this.extractStartTimeFromSchedule(data.selectedSchedule);
        } else {
          data.selectedSchedule = '';
          data.startTime = '';
        }

        // Collect price data
        data.adultPrice = parseFloat(document.getElementById('adultPrice')?.value || 0);
        data.childPrice = parseFloat(document.getElementById('childPrice')?.value || 0);
        data.noAlcoholPrice = parseFloat(document.getElementById('noAlcoholPrice')?.value || 0);

        break;
      }
      case 'tour': {
        data.tourId = document.getElementById('tourSelect')?.value;
        data.rateId = document.getElementById('transportCategory')?.value; // Store rate for vehicle pricing

        // Collect includeGuide checkbox state for tours
        const includeGuideCheckbox = document.getElementById('includeGuide');
        data.includeGuide = includeGuideCheckbox ? includeGuideCheckbox.checked : false;

        // Collect includeGreeter checkbox state for tours
        const includeGreeterCheckbox = document.getElementById('includeGreeter');
        data.includeGreeter = includeGreeterCheckbox ? includeGreeterCheckbox.checked : false;

        // Collect passenger quantities for tours (same as experiences)
        data.adultsQuantity = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
        data.childrenQuantity = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
        data.adultsNoAlcoholQuantity = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value || 0);

        // Collect tour-specific prices
        data.adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
        data.childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
        data.noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);

        // Collect schedule data - get the text content of selected option, not the index value
        const tourScheduleSelect = document.getElementById('tourMultipleTime');
        if (tourScheduleSelect && tourScheduleSelect.selectedIndex > 0) {
          data.selectedSchedule = tourScheduleSelect.options[tourScheduleSelect.selectedIndex].textContent;
          data.startTime = this.extractStartTimeFromSchedule(data.selectedSchedule);
        } else {
          data.selectedSchedule = '';
          data.startTime = '';
        }
        break;
      }
      case 'transport': {
        data.transportType = document.querySelector('input[name="transportType"]:checked')?.value;
        data.tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        data.directionType = document.querySelector('input[name="directionType"]:checked')?.value;

        // Get origin from appropriate field based on direction
        const directionType = data.directionType;
        const isDepartureAeropuerto = directionType === 'departure' && data.transportType === 'aeropuerto';
        if (isDepartureAeropuerto) {
          // Departure + Aeropuerto: origin = COMBO (local place), destination = SELECT (airport)
          data.origin = document.getElementById('transportOriginCombo')?.value || '';
          const destSelect = document.getElementById('transportDestinationSelect');
          const destSlug = destSelect?.value || '';
          data.destination = destSlug;
          // Resolve display name from select text
          if (destSelect && destSelect.selectedIndex > 0) {
            data.destination = destSelect.options[destSelect.selectedIndex].textContent;
          } else if (window.slugToOriginalMapping?.has(destSlug)) {
            data.destination = window.slugToOriginalMapping.get(destSlug);
          }
        } else if (directionType === 'arrival') {
          // Arrival: origin = SELECT (airport slug), destination = COMBO (text)
          data.origin = document.getElementById('transportOriginSelect')?.value || '';
          data.destination = document.getElementById('transportDestinationCombo')?.value || '';
        } else {
          // Other departure: origin = text, destination = COMBO
          data.origin = document.getElementById('transportOriginText')?.value || '';
          data.destination = document.getElementById('transportDestinationCombo')?.value || '';
        }

        // If specific location is filled, append it to destination
        const specificLocation = document.getElementById('transportSpecificLocation')?.value;
        if (specificLocation && specificLocation.trim()) {
          data.destination = `${data.destination}, ${specificLocation.trim()}`;
        }

        data.category = document.getElementById('transportCategory')?.value;

        // Collect people counts for transport
        data.transportAdults = parseInt(document.getElementById('transportAdults')?.value || 0);
        data.transportChildren = parseInt(document.getElementById('transportChildren')?.value || 0);
        data.transportInfants = parseInt(document.getElementById('transportInfants')?.value || 0);

        // Calculate total persons for backwards compatibility
        data.persons = data.transportAdults + data.transportChildren + data.transportInfants || 1;

        // Collect includeGuide and includeGreeter checkbox states for transport
        const transportGuideCheckbox = document.getElementById('includeGuide');
        data.includeGuide = transportGuideCheckbox ? transportGuideCheckbox.checked : false;

        const transportGreeterCheckbox = document.getElementById('includeGreeter');
        data.includeGreeter = transportGreeterCheckbox ? transportGreeterCheckbox.checked : false;

        // Flight details (if airport transport)
        if (data.transportType === 'aeropuerto') {
          data.flightNumber = document.getElementById('flightNumber')?.value;
          data.flightTime = document.getElementById('flightTime')?.value;
          data.startTime = data.flightTime; // Use flight time for sorting
          data.airline = document.getElementById('airline')?.value;
        } else {
          // Punto a Punto / Local: collect schedule fields
          const transportStartTime = document.getElementById('transportStartTime')?.value;
          const transportEndTime = document.getElementById('transportEndTime')?.value;
          data.startTime = transportStartTime || '';
          data.endTime = transportEndTime || '';
          if (transportStartTime) {
            data.selectedSchedule = transportEndTime ? `${transportStartTime} - ${transportEndTime}` : transportStartTime;
          }
        }

        // Resolve origin display name from the active field
        const resolveOriginName = () => {
          if (isDepartureAeropuerto) {
            // Departure + Aeropuerto: origin is COMBO text field
            const originCombo = document.getElementById('transportOriginCombo')?.value;
            if (originCombo) return originCombo;
          } else if (directionType === 'arrival') {
            // Arrival: origin is SELECT
            const originSelect = document.getElementById('transportOriginSelect');
            if (originSelect && originSelect.selectedIndex > 0) {
              return originSelect.options[originSelect.selectedIndex].textContent;
            }
          } else {
            const originText = document.getElementById('transportOriginText')?.value;
            if (originText) return originText;
          }
          return data.origin || 'Origen';
        };

        const transportTypes = {
          aeropuerto: 'Aeropuerto',
          'punto-a-punto': 'Punto a Punto',
          local: 'Local',
        };

        // Generate concept with origin and destination
        const originName = resolveOriginName();
        data.originName = originName; // Store resolved name for display
        const destinationName = data.destination || 'Destino';
        data.concept = `${transportTypes[data.transportType] || 'Transporte'}: ${originName} - ${destinationName}`;

        // Persist route duration for pricing calculations (Guía/Greeter surcharges)
        data.routeDuration = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;

        // Store base vehicle price separately so calculateServicePrice can add surcharges
        // (the price field may already include surcharges from recalculateTransportPrice)
        if (vehicleSelectValue) {
          data.baseVehiclePrice = this.getTransportVehiclePrice(vehicleSelectValue) || data.price;
        } else {
          data.baseVehiclePrice = data.price;
        }
        break;
      }
      case 'concepto': {
        data.concept = document.getElementById('conceptoConcept')?.value;

        // Collect people quantities for concepto
        data.adultsQuantity = parseInt(document.getElementById('conceptoAdultsQuantity')?.value || 0);
        data.childrenQuantity = parseInt(document.getElementById('conceptoChildrenQuantity')?.value || 0);
        data.adultsNoAlcoholQuantity = parseInt(document.getElementById('conceptoAdultsNoAlcoholQuantity')?.value || 0);

        // Collect schedule data if checkbox is checked
        const hasSchedule = document.getElementById('conceptoHasSchedule')?.checked;
        if (hasSchedule) {
          const startTimeEl = document.getElementById('conceptoStartTime');
          const endTimeEl = document.getElementById('conceptoEndTime');

          const startTime = startTimeEl?.value;
          const endTime = endTimeEl?.value;

          if (startTime) {
            data.startTime = startTime;
            // Create a schedule string for display
            if (endTime) {
              data.endTime = endTime;
              data.selectedSchedule = `${startTime} - ${endTime}`;
            } else {
              data.selectedSchedule = startTime;
            }
          }
        }
        break;
      }
      default:
        console.warn('Unknown service type:', type);
        break;
    }

    return data;
  }

  validateServiceData(data) {
    if (!data.type) {
      this.showModalAlert('serviceModalAlert', 'Por favor selecciona un tipo de servicio', 'warning');
      return false;
    }

    // For tours and experiences, no price validation - allow empty/placeholder entries
    // This allows adding tours/experiences without prices for planning purposes
    if (data.type === 'tour' || data.type === 'experience') {
      // No price validation - can save with $0 or no price
      // Useful for placeholders or complimentary services
    } else if (data.type === 'transport' && (!data.price || data.price <= 0)) {
      // Transport should have a price
      this.showModalAlert('serviceModalAlert', 'Por favor ingresa un precio válido', 'warning');
      return false;
    }

    // Type-specific validation
    switch (data.type) {
      case 'experience':
        if (!data.experienceId) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona una experiencia', 'warning');
          return false;
        }
        break;
      case 'tour':
        if (!data.tourId) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona un tour', 'warning');
          return false;
        }
        break;
      case 'transport':
        if (!data.origin) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona un origen', 'warning');
          return false;
        }
        if (!data.destination) {
          this.showModalAlert('serviceModalAlert', 'Por favor ingresa un destino', 'warning');
          return false;
        }
        if (!data.category) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona una categoría', 'warning');
          return false;
        }
        if (!data.persons || data.persons < 1) {
          this.showModalAlert('serviceModalAlert', 'Por favor ingresa un número válido de personas', 'warning');
          return false;
        }
        break;
      case 'concepto':
        if (!data.concept) {
          this.showModalAlert('serviceModalAlert', 'Por favor ingresa un concepto', 'warning');
          return false;
        }
        break;
    }

    return true;
  }

  populateServiceForm(service) {
    if (!service) return;

    // Set service type
    const serviceTypeRadio = document.querySelector(`input[name="serviceType"][value="${service.type}"]`);
    if (serviceTypeRadio) {
      serviceTypeRadio.checked = true;
      this.handleServiceTypeChange(service.type);
    }

    // Populate include in total checkbox
    const includeInTotalCheckbox = document.getElementById('includeInTotal');
    if (includeInTotalCheckbox) {
      includeInTotalCheckbox.checked = service.includeInTotal !== false;
    }

    // Populate common fields
    document.getElementById('transportCategory').value = service.category || '';
    // For tours with vehicle type, use vehicleType, otherwise use vehicleId
    const vehicleSelectValue = service.vehicleType || service.vehicleTypeName || service.vehicleId || '';
    document.getElementById('vehicleSelect').value = vehicleSelectValue;
    // For tours, show only vehicle cost in price field; for others, show full calculated price
    if (service.type === 'tour') {
      // For tours, only show vehicle cost (not people costs)
      if (service.vehicleId || service.vehicleType || service.vehicleTypeName) {
        const vehicleCost = this.getVehicleCost(service);
        document.getElementById('servicePrice').value = vehicleCost || 0;
      } else {
        document.getElementById('servicePrice').value = 0; // No vehicle, show 0
      }
    } else {
      document.getElementById('servicePrice').value = this.calculateServicePrice(service);
    }
    document.getElementById('serviceQuantity').value = service.quantity || 1;
    document.getElementById('serviceNotes').value = service.notes || '';
    document.getElementById('currencySelect').value = service.currency || 'MXN';
    document.getElementById('priceTypeSelect').value = service.priceType || 'efectivo';

    // Handle guide/driver checkbox
    const includeGuideCheckbox = document.getElementById('includeGuide');
    if (includeGuideCheckbox) {
      includeGuideCheckbox.checked = service.includeGuide || false;
    }

    // Handle greeter checkbox
    const includeGreeterCheckbox = document.getElementById('includeGreeter');
    if (includeGreeterCheckbox) {
      includeGreeterCheckbox.checked = service.includeGreeter || false;
    }

    // Populate greeter in vehicle checkbox (must be after includeGreeter is set)
    const greeterInVehicleCheckbox = document.getElementById('greeterInVehicle');
    const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
    if (greeterInVehicleContainer) {
      if (service.includeGreeter) {
        greeterInVehicleContainer.classList.remove('d-none');
      } else {
        greeterInVehicleContainer.classList.add('d-none');
      }
    }
    if (greeterInVehicleCheckbox) {
      greeterInVehicleCheckbox.checked = service.greeterInVehicle || false;
    }

    // Update capacity note after all checkboxes are set
    this.updateVehicleCapacityNote();

    // Type-specific population
    switch (service.type) {
      case 'experience':
        const experienceSelect = document.getElementById('experienceSelect');
        if (experienceSelect && service.experienceId) {
          experienceSelect.value = service.experienceId;
          // Trigger the experience selection to show pricing section
          if (this.handleExperienceSelection) {
            this.handleExperienceSelection(service.experienceId);
          }
        }

        // Use multiple setTimeout attempts to ensure DOM elements are visible before populating
        const populateQuantityFields = (attempt = 1) => {
          const adultsQuantityField = document.getElementById('adultsQuantity');
          const childrenQuantityField = document.getElementById('childrenQuantity');
          const adultsNoAlcoholQuantityField = document.getElementById('adultsNoAlcoholQuantity');
          const experienceContent = document.getElementById('experienceContent');
          const experiencePricingSection = document.getElementById('experiencePricingSection');

          // Check if all fields are available and visible
          if (adultsQuantityField && childrenQuantityField && adultsNoAlcoholQuantityField
            && experienceContent && !experienceContent.classList.contains('d-none')) {
            // Populate the fields
            if (service.adultsQuantity !== undefined) {
              adultsQuantityField.value = service.adultsQuantity;
            }
            if (service.childrenQuantity !== undefined) {
              childrenQuantityField.value = service.childrenQuantity;
            }
            if (service.adultsNoAlcoholQuantity !== undefined) {
              adultsNoAlcoholQuantityField.value = service.adultsNoAlcoholQuantity;
            }

            // Also restore price fields when fields are ready
            const adultPriceField = document.getElementById('adultPrice');
            const childPriceField = document.getElementById('childPrice');
            const noAlcoholPriceField = document.getElementById('noAlcoholPrice');

            if (adultPriceField && service.adultPrice !== undefined) {
              adultPriceField.value = service.adultPrice;
            }
            if (childPriceField && service.childPrice !== undefined) {
              childPriceField.value = service.childPrice;
            }
            if (noAlcoholPriceField && service.noAlcoholPrice !== undefined) {
              noAlcoholPriceField.value = service.noAlcoholPrice;
            }

            // Also restore schedule field when fields are ready
            const scheduleField = document.getElementById('experienceMultipleTime');

            // Ensure the schedule dropdown is populated and restore selection
            if (service.experienceId && service.selectedSchedule) {
              this.handleExperienceSelection(service.experienceId);

              // Wait for schedule dropdown to be populated, then restore selection
              setTimeout(() => {
                const updatedScheduleField = document.getElementById('experienceMultipleTime');
                if (updatedScheduleField) {
                  // Find the option with matching text content
                  for (let i = 0; i < updatedScheduleField.options.length; i++) {
                    const optionText = updatedScheduleField.options[i].textContent;
                    if (optionText === service.selectedSchedule) {
                      updatedScheduleField.selectedIndex = i;

                      break;
                    }
                  }
                }
              }, 200);
            }
          } else if (attempt < 5) {
            // Retry with longer delay

            setTimeout(() => populateQuantityFields(attempt + 1), 100 * attempt);
          } else {
            console.error('❌ Failed to populate quantity fields after 5 attempts');
          }
        };

        setTimeout(populateQuantityFields, 50);
        break;

      case 'tour':
        const tourSelect = document.getElementById('tourSelect');
        if (tourSelect && service.tourId) {
          tourSelect.value = service.tourId;
          // Trigger tour selection to show tour content
          this.handleTourSelection(service.tourId);
        }

        // Handle transport/vehicle information for tours
        const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;

        if (hasVehicle) {
          // Check the "Se requiere traslado" checkbox
          const requiresTransportCheckbox = document.getElementById('tourRequiresTransport');
          if (requiresTransportCheckbox) {
            requiresTransportCheckbox.checked = true;
            // Trigger the transport toggle to show transport fields
            if (this.handleTourTransportToggle) {
              this.handleTourTransportToggle(true);
            }
          }

          // Set the rate if available
          setTimeout(() => {
            if (service.rateId) {
              const transportCategorySelect = document.getElementById('transportCategory');
              if (transportCategorySelect) {
                transportCategorySelect.value = service.rateId;
                // Trigger rate selection to populate vehicles
                this.handleRateSelection(service.rateId);

                // After rate selection, set the vehicle
                setTimeout(() => {
                  const vehicleValue = service.vehicleType || service.vehicleTypeName || service.vehicleId;
                  if (vehicleValue) {
                    const vehicleSelect = document.getElementById('vehicleSelect');
                    if (vehicleSelect) {
                      vehicleSelect.value = vehicleValue;
                      // Trigger vehicle selection for price update
                      this.handleVehicleSelection(vehicleValue);
                    }
                  }
                }, 500);
              }
            }
          }, 300);
        }

        // Populate tour passenger quantities (similar to experiences)
        const populateTourQuantityFields = (attempt = 1) => {
          const tourAdultsQuantityField = document.getElementById('tourAdultsQuantity');
          const tourChildrenQuantityField = document.getElementById('tourChildrenQuantity');
          const tourAdultsNoAlcoholQuantityField = document.getElementById('tourAdultsNoAlcoholQuantity');
          const tourContent = document.getElementById('tourContent');

          // Check if all fields are available and visible
          if (tourAdultsQuantityField && tourChildrenQuantityField && tourAdultsNoAlcoholQuantityField
            && tourContent && !tourContent.classList.contains('d-none')) {
            // Populate the fields
            if (service.adultsQuantity !== undefined) {
              tourAdultsQuantityField.value = service.adultsQuantity;
            }
            if (service.childrenQuantity !== undefined) {
              tourChildrenQuantityField.value = service.childrenQuantity;
            }
            if (service.adultsNoAlcoholQuantity !== undefined) {
              tourAdultsNoAlcoholQuantityField.value = service.adultsNoAlcoholQuantity;
            }

            // Also restore schedule selection if available
            const tourScheduleSelect = document.getElementById('tourMultipleTime');
            if (tourScheduleSelect && service.selectedSchedule) {
              // Find the option that matches the saved schedule
              for (let i = 0; i < tourScheduleSelect.options.length; i++) {
                if (tourScheduleSelect.options[i].textContent === service.selectedSchedule) {
                  tourScheduleSelect.selectedIndex = i;
                  break;
                }
              }
            }
          } else if (attempt < 5) {
            // Retry with longer delay

            setTimeout(() => populateTourQuantityFields(attempt + 1), 100 * attempt);
          } else {
            console.error('❌ Failed to populate tour quantity fields after 5 attempts');
          }
        };

        setTimeout(populateTourQuantityFields, 50);
        break;

      case 'transport':
        // Use flag to prevent clearTransportFormFields during edit population
        this._populatingTransportForm = true;

        if (service.transportType) {
          const transportTypeRadio = document.querySelector(`input[name="transportType"][value="${service.transportType}"]`);
          if (transportTypeRadio) {
            transportTypeRadio.checked = true;
            this.handleTransportTypeChange();
          }
        }

        if (service.tripType) {
          const tripTypeRadio = document.querySelector(`input[name="tripType"][value="${service.tripType}"]`);
          if (tripTypeRadio) {
            tripTypeRadio.checked = true;
            this.handleTripTypeChange();
          }
        }

        // Populate transport fields based on trip type
        if (service.tripType === 'round-trip') {
          // Round trip fields
          document.getElementById('roundTripOriginIdaSelect').value = service.origin || '';
          document.getElementById('roundTripDestinationIda').value = service.destination || '';
          document.getElementById('roundTripDateIda').value = service.startDate || '';
          document.getElementById('roundTripTimeIda').value = service.startTime || '';
          document.getElementById('roundTripOriginVuelta').value = service.returnOrigin || '';
          document.getElementById('roundTripDestinationCombo').value = service.returnDestination || '';
          document.getElementById('roundTripDateVuelta').value = service.endDate || '';
          document.getElementById('roundTripTimeVuelta').value = service.endTime || '';

          // Flight details
          if (service.airline) {
            document.getElementById('roundTripAirlineIda').value = service.airline;
            document.getElementById('roundTripFlightNumberIda').value = service.flightNumber || '';
          }
          if (service.returnAirline) {
            document.getElementById('roundTripAirlineVuelta').value = service.returnAirline;
            document.getElementById('roundTripFlightNumberVuelta').value = service.returnFlightNumber || '';
          }
        } else {
          // One way fields
          if (service.directionType) {
            const directionTypeRadio = document.querySelector(`input[name="directionType"][value="${service.directionType}"]`);
            if (directionTypeRadio) {
              directionTypeRadio.checked = true;
              this.handleDirectionTypeChange();
            }
          }

          // Set origin/destination in the correct fields based on direction
          const isDepartureAeropuerto = service.directionType === 'departure' && service.transportType === 'aeropuerto';
          if (isDepartureAeropuerto) {
            // Departure + Aeropuerto: origin = COMBO, destination = SELECT
            document.getElementById('transportOriginCombo').value = service.origin || '';
            document.getElementById('transportDestinationSelect').value = service.destination || '';
          } else {
            document.getElementById('transportOriginSelect').value = service.origin || '';
            document.getElementById('transportDestinationCombo').value = service.destination || '';
          }
          document.getElementById('transportOriginText').value = service.origin || '';

          // Populate the new people fields for transport
          document.getElementById('transportAdults').value = service.transportAdults || 0;
          document.getElementById('transportChildren').value = service.transportChildren || 0;
          document.getElementById('transportInfants').value = service.transportInfants || 0;

          // Restore specific location if available
          if (service.specificLocation) {
            const specificLocationField = document.getElementById('transportSpecificLocation');
            if (specificLocationField) specificLocationField.value = service.specificLocation;
            const specificLocationRow = document.getElementById('specificLocationRow');
            if (specificLocationRow) specificLocationRow.classList.remove('d-none');
          }

          // Populate the new people fields for transport
          document.getElementById('transportAdults').value = service.transportAdults || 0;
          document.getElementById('transportChildren').value = service.transportChildren || 0;
          document.getElementById('transportInfants').value = service.transportInfants || 0;

          // Flight details (airport)
          if (service.transportType === 'aeropuerto') {
            if (service.airline) document.getElementById('airline').value = service.airline;
            if (service.flightNumber) document.getElementById('flightNumber').value = service.flightNumber;
            if (service.startTime) document.getElementById('flightTime').value = service.startTime;
          } else {
            // Punto a Punto / Local: restore schedule fields
            if (service.startTime) document.getElementById('transportStartTime').value = service.startTime;
            if (service.endTime) document.getElementById('transportEndTime').value = service.endTime;
          }
        }

        // Restore category/segmento and trigger vehicle population
        if (service.category) {
          document.getElementById('transportCategory').value = service.category;
          const savedPrice = service.price || 0;
          // Trigger rate selection to fetch and populate vehicles
          // Pass origin/destination from service data as fallback for race conditions
          this.handleTransportRateSelection(service.category, service.originName || service.origin, service.destination).then(() => {
            // After vehicles are loaded, set the saved vehicle
            if (service.vehicleType) {
              const vehicleSelect = document.getElementById('vehicleSelect');
              if (vehicleSelect) {
                vehicleSelect.value = service.vehicleType;
              }
            }
            // Restore price (populateTransportVehicleDropdown resets it to 0)
            document.getElementById('servicePrice').value = savedPrice;
            // Update capacity note now that vehicle is populated
            this.updateVehicleCapacityNote();
            // Clear flag after async population is complete
            this._populatingTransportForm = false;
          });
        } else {
          this._populatingTransportForm = false;
        }
        break;

      case 'concepto':
        document.getElementById('conceptoConcept').value = service.concept || '';

        // Populate people quantities for concepto
        const conceptoAdultsQuantityField = document.getElementById('conceptoAdultsQuantity');
        const conceptoChildrenQuantityField = document.getElementById('conceptoChildrenQuantity');
        const conceptoAdultsNoAlcoholQuantityField = document.getElementById('conceptoAdultsNoAlcoholQuantity');

        if (conceptoAdultsQuantityField && service.adultsQuantity !== undefined) {
          conceptoAdultsQuantityField.value = service.adultsQuantity;
        }
        if (conceptoChildrenQuantityField && service.childrenQuantity !== undefined) {
          conceptoChildrenQuantityField.value = service.childrenQuantity;
        }
        if (conceptoAdultsNoAlcoholQuantityField && service.adultsNoAlcoholQuantity !== undefined) {
          conceptoAdultsNoAlcoholQuantityField.value = service.adultsNoAlcoholQuantity;
        }

        // Populate schedule fields if service has schedule data
        const hasScheduleCheckbox = document.getElementById('conceptoHasSchedule');
        const startTimeField = document.getElementById('conceptoStartTime');
        const endTimeField = document.getElementById('conceptoEndTime');

        if (service.startTime || service.selectedSchedule) {
          // Check the checkbox to show schedule fields
          if (hasScheduleCheckbox) {
            hasScheduleCheckbox.checked = true;
            this.handleConceptoScheduleToggle(true);
          }

          // Populate start time
          if (startTimeField && service.startTime) {
            startTimeField.value = service.startTime;
          }

          // Populate end time
          if (endTimeField && service.endTime) {
            endTimeField.value = service.endTime;
          }
        } else {
          // No schedule, ensure checkbox is unchecked
          if (hasScheduleCheckbox) {
            hasScheduleCheckbox.checked = false;
            this.handleConceptoScheduleToggle(false);
          }
        }
        break;
    }
  }

  // Rendering Methods
  renderItinerary() {
    this.renderDaysSidebar();
    this.renderDaysContent();
    this.updateTotals();
    this.updateEmptyState();
  }

  renderDaysSidebar() {
    const container = document.getElementById('daysList');
    if (!container) return;

    container.innerHTML = this.days.map((day) => `
            <div class="day-nav-item ${day.id === this.currentDayId ? 'active' : ''}" 
                 data-day-id="${day.id}" 
                 draggable="true">
                <i class="ti ti-grip-vertical text-muted me-2" style="cursor: grab; opacity: 0.6;"></i>
                <span class="day-nav-number">${day.number}</span>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${this.truncateText(day.title, 20)}</div>
                    <small class="text-muted">${day.date ? this.formatDate(day.date) : this.generateDefaultDate(day.number)}</small>
                </div>
            </div>
        `).join('');

    // Add event listeners for day navigation and drag & drop
    this.setupSidebarDragAndDrop(container);
  }

  renderDaysContent() {
    const container = document.getElementById('daysContainer');
    if (!container) return;

    container.innerHTML = this.days.map((day) => this.renderDayCard(day)).join('');

    // Attach event listeners to dynamic elements
    this.attachDayEventListeners();

    // Setup drag and drop for main content
    this.setupContentDragAndDrop(container);
  }

  renderDayCard(day) {
    const services = day.services.map((sid) => this.services.get(sid)).filter(Boolean);
    const dayTotalMXN = services.reduce((sum, service) => {
      if (service.includeInTotal === false) return sum;
      return sum + (this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity));
    }, 0);
    const dayTotal = this.getDisplayPrice(dayTotalMXN);

    return `
            <div class="day-card mb-4" data-day-id="${day.id}" id="day-${day.id}" draggable="false">
                <div class="card border-0 shadow-sm">
                    <div class="card-header bg-white border-bottom">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center">
                                <i class="ti ti-grip-vertical text-muted me-2 drag-handle" style="cursor: grab; opacity: 0.6;" title="Arrastrar para reordenar"></i>
                                <div class="day-number-badge me-3">
                                    <span class="badge bg-primary rounded-circle" style="width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; font-size: 1rem;">
                                        ${day.number}
                                    </span>
                                </div>
                                <div>
                                    <h5 class="mb-0 day-title">${day.title}</h5>
                                    <small class="text-muted day-date">${day.date ? this.formatDate(day.date) : this.generateDefaultDate(day.number)}</small>
                                    ${day.description ? `<div class="mt-1"><small class="text-muted day-description"><i class="ti ti-notes me-1"></i>${day.description}</small></div>` : ''}
                                </div>
                            </div>
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-sm btn-light edit-day-btn" 
                                        data-day-id="${day.id}" title="Editar día">
                                    <i class="ti ti-pencil"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-light duplicate-day-btn" 
                                        data-day-id="${day.id}" title="Duplicar día">
                                    <i class="ti ti-copy"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-light delete-day-btn" 
                                        data-day-id="${day.id}" title="Eliminar día">
                                    <i class="ti ti-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="services-list">
                            ${services.map((service) => this.renderServiceItem(service)).join('')}
                        </div>
                        
                        <button type="button" class="btn btn-outline-primary btn-sm w-100 mt-3 add-service-btn"
                                data-day-id="${day.id}">
                            <i class="ti ti-plus me-1"></i>Agregar Servicio
                        </button>
                    </div>
                    <div class="card-footer bg-light">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="text-muted">Total del día:</span>
                            <span class="fw-bold day-total">${this.formatCurrency(dayTotal)}</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span class="text-muted d-flex align-items-center gap-1">
                                Total por persona
                                <span class="d-inline-flex align-items-center">
                                    (<input type="number" class="day-person-count-input" value="${this.numberOfPeople || 0}" min="0" style="width: 40px; border: none; border-bottom: 1px dashed #6c757d; background: transparent; text-align: center; padding: 0; font-size: inherit; color: inherit; outline: none;">
)
                                </span>
                            </span>
                            <span class="fw-semibold text-info day-per-person">${this.numberOfPeople > 0 ? this.formatCurrency(dayTotal / this.numberOfPeople) : '$0.00'}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  renderServiceItem(service) {
    if (service.type === 'transport') {
      return this.renderTransportServiceItem(service);
    }

    const typeLabels = {
      experience: 'Experiencia',
      tour: 'Tour',
      concepto: 'Concepto',
    };

    return `
            <div class="service-item mb-3 p-3 border rounded hover-shadow ${service.hasOverlap ? 'has-overlap' : ''}" data-service-id="${service.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-start mb-2">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <span class="badge bg-light text-dark me-2">${typeLabels[service.type] || service.type}</span>
                                    <h6 class="mb-0 service-title">${this.getServiceTitle(service)}</h6>
                                </div>
                                <div class="service-details">
                                    <div class="row g-2 text-muted small">
                                        ${service.selectedSchedule || service.startTime ? `
                                            <div class="col-auto">
                                                <i class="ti ti-clock me-1"></i>
                                                ${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}
                                                ${service.hasOverlap ? `
                                                    <span class="text-danger ms-2" title="${this.getOverlapTooltip(service)}">
                                                        <i class="ti ti-alert-triangle"></i>
                                                        <small>Conflicto de horario</small>
                                                    </span>
                                                ` : ''}
                                            </div>
                                        ` : ''}
                                    </div>
                                    ${this.renderPeopleQuantities(service)}
                                    ${(service.vehicleId || service.vehicleType || service.vehicleTypeName) ? `
                                        <div class="row g-2 text-muted small mt-1">
                                            <div class="col-auto">
                                                <i class="ti ti-car me-1"></i>
                                                ${this.getVehicleDisplayName(service)}
                                                ${service.quantity > 1 ? ` x${service.quantity}` : ''}
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${service.type === 'tour' && service.includeGuide ? `
                                        <div class="row g-2 text-success small mt-1">
                                            <div class="col-auto">
                                                <i class="ti ti-user me-1"></i>
                                                <strong>Incluye Guía + Chofer</strong>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${(service.type === 'tour' || service.type === 'transport') && service.includeGreeter ? `
                                        <div class="row g-2 text-info small mt-1">
                                            <div class="col-auto">
                                                <i class="ti ti-users me-1"></i>
                                                <strong>Incluye Greeter</strong>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${service.notes ? `
                                        <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                            <i class="ti ti-notes me-1"></i>
                                            <span>${service.notes}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex flex-column align-items-end">
                        <div class="service-actions mb-2">
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
                        </div>
                        ${service.includeInTotal === false ? `
                        <span class="badge bg-secondary-subtle text-secondary mb-1">Pago externo</span>
                        ` : ''}
                        <div class="fw-semibold ${service.includeInTotal === false ? 'text-muted text-decoration-line-through' : 'text-primary'}">
                            ${this.formatCurrency(this.getDisplayPrice(this.calculateServicePrice(service)))}
                        </div>
                        <button type="button" class="btn btn-sm btn-link p-0 mt-1 toggle-include-total-btn d-flex align-items-center gap-1"
                                data-service-id="${service.id}" title="${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}" style="text-decoration: none;">
                            <i class="ti ${service.includeInTotal === false ? 'ti-circle-plus text-success' : 'ti-circle-minus text-muted'}" style="font-size: 0.85rem;"></i>
                            <small class="${service.includeInTotal === false ? 'text-success' : 'text-muted'}" style="font-size: 0.7rem;">${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}</small>
                        </button>
                    </div>
                </div>
            </div>
        `;
  }

  renderTransportServiceItem(service) {
    const transportTypes = { aeropuerto: 'Aeropuerto', 'punto-a-punto': 'Punto a Punto', local: 'Local' };
    const transportLabel = transportTypes[service.transportType] || 'Transporte';
    const origin = service.originName || service.origin || 'Origen';
    const destination = service.destination || 'Destino';
    const vehicleName = this.getVehicleDisplayName(service);
    const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;
    const isAirport = service.transportType === 'aeropuerto';

    return `
            <div class="service-item mb-3 p-3 border rounded hover-shadow ${service.hasOverlap ? 'has-overlap' : ''}" data-service-id="${service.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-2">
                            <span class="badge bg-light text-dark me-2">Transporte</span>
                            <span class="badge bg-primary-subtle text-primary">${transportLabel}</span>
                            ${service.directionType ? `<span class="badge ${service.directionType === 'arrival' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}">${service.directionType === 'arrival' ? 'Llegada' : 'Salida'}</span>` : ''}
                        </div>
                        <div class="service-details">
                            <!-- Route display -->
                            <div class="d-flex align-items-center gap-2 mb-2">
                                <div class="d-flex align-items-center gap-2 small" style="line-height: 1.6;">
                                    <div class="d-flex flex-column align-items-center" style="min-width: 14px;">
                                        <i class="ti ti-circle-filled text-success" style="font-size: 0.5rem;"></i>
                                        <div style="width: 1.5px; height: 16px; background: linear-gradient(to bottom, #198754, #6c757d);"></div>
                                        <i class="ti ti-map-pin-filled text-danger" style="font-size: 0.7rem;"></i>
                                    </div>
                                    <div class="d-flex flex-column">
                                        <span class="fw-medium">${origin}</span>
                                        <span class="fw-medium">${destination}</span>
                                    </div>
                                </div>
                            </div>
                            <!-- Time -->
                            ${service.selectedSchedule || service.startTime ? `
                                <div class="d-flex align-items-center text-muted small mb-1">
                                    <i class="ti ti-clock me-1"></i>
                                    ${isAirport ? '<span class="text-muted me-1">Hora:</span>' : ''}
                                    ${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}
                                    ${service.hasOverlap ? `
                                        <span class="text-danger ms-2" title="${this.getOverlapTooltip(service)}">
                                            <i class="ti ti-alert-triangle"></i>
                                            <small>Conflicto de horario</small>
                                        </span>
                                    ` : ''}
                                </div>
                            ` : ''}
                            ${this.renderPeopleQuantities(service)}
                            <!-- Vehicle -->
                            ${hasVehicle ? `
                                <div class="d-flex align-items-center text-muted small mt-1">
                                    <i class="ti ti-car me-1"></i>
                                    ${vehicleName}
                                    ${service.quantity > 1 ? ` x${service.quantity}` : ''}
                                </div>
                            ` : ''}
                            ${service.includeGuide ? `
                                <div class="d-flex align-items-center text-success small mt-1">
                                    <i class="ti ti-user me-1"></i>
                                    <strong>Incluye Guía + Chofer</strong>
                                </div>
                            ` : ''}
                            ${service.includeGreeter ? `
                                <div class="d-flex align-items-center text-info small mt-1">
                                    <i class="ti ti-users me-1"></i>
                                    <strong>Incluye Greeter</strong>
                                </div>
                            ` : ''}
                            ${service.notes ? `
                                <div class="service-notes mt-1 text-muted small d-flex align-items-start">
                                    <i class="ti ti-notes me-1"></i>
                                    <span>${service.notes}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="d-flex flex-column align-items-end">
                        <div class="service-actions mb-2">
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
                        </div>
                        ${service.includeInTotal === false ? `
                        <span class="badge bg-secondary-subtle text-secondary mb-1">Pago externo</span>
                        ` : ''}
                        <div class="fw-semibold ${service.includeInTotal === false ? 'text-muted text-decoration-line-through' : 'text-primary'}">
                            ${this.formatCurrency(this.getDisplayPrice(this.calculateServicePrice(service)))}
                        </div>
                        <button type="button" class="btn btn-sm btn-link p-0 mt-1 toggle-include-total-btn d-flex align-items-center gap-1"
                                data-service-id="${service.id}" title="${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}" style="text-decoration: none;">
                            <i class="ti ${service.includeInTotal === false ? 'ti-circle-plus text-success' : 'ti-circle-minus text-muted'}" style="font-size: 0.85rem;"></i>
                            <small class="${service.includeInTotal === false ? 'text-success' : 'text-muted'}" style="font-size: 0.7rem;">${service.includeInTotal === false ? 'Incluir en total' : 'Excluir del total'}</small>
                        </button>
                    </div>
                </div>
            </div>
        `;
  }

  // Utility Methods
  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateServicePrice(service) {
    // console.log('🔍 calculateServicePrice called for service:', service.type, service.id || 'no-id');

    // For experience and tour services, calculate based on people quantities and individual prices
    if (service.type === 'experience' || service.type === 'tour') {
      const adultsQuantity = service.adultsQuantity || 0;
      const childrenQuantity = service.childrenQuantity || 0;
      const adultsNoAlcoholQuantity = service.adultsNoAlcoholQuantity || 0;

      const adultPrice = service.adultPrice || 0;
      const childPrice = service.childPrice || 0;
      const noAlcoholPrice = service.noAlcoholPrice || 0;

      let totalPrice = 0;

      // Debug logging for people calculation (commented out to reduce console noise)
      // if (service.type === 'tour') {
      //     console.log('👥 calculateServicePrice - People data:', {
      //         adultsQuantity, childrenQuantity, adultsNoAlcoholQuantity,
      //         adultPrice, childPrice, noAlcoholPrice,
      //         includeGuide: service.includeGuide
      //     });
      //     console.log('👥 calculateServicePrice - Full service object:', service);
      //
      //     // Check if we need to fetch tour prices
      //     if (service.tourId && this.toursCache) {
      //         const tourData = this.toursCache.get('all')?.find(t => t.id === service.tourId);
      //         if (tourData) {
      //             console.log('🎯 Tour data from cache:', tourData);
      //             console.log('🎯 Tour prices should be - Adult:', tourData.price, 'Child:', tourData.price_child, 'No Alcohol:', tourData.price_no_alcohol);
      //         }
      //     }
      // }

      // If we have individual prices, calculate based on quantities
      if (adultPrice > 0 || childPrice > 0 || noAlcoholPrice > 0) {
        totalPrice = (adultsQuantity * adultPrice)
          + (childrenQuantity * childPrice)
          + (adultsNoAlcoholQuantity * noAlcoholPrice);

        if (service.type === 'tour') {
          // console.log('👥 calculateServicePrice - People total calculated:', totalPrice);
        }
      }

      // For tours with transport, add vehicle costs
      if (service.type === 'tour' && (service.vehicleId || service.vehicleType || service.vehicleTypeName)) {
        const vehicleQuantity = service.quantity || 1; // Number of vehicles needed
        const vehicleCost = this.getVehicleCost(service);
        const vehicleTotal = vehicleCost * vehicleQuantity;
        totalPrice += vehicleTotal;
      }

      // For tours with includeGuide (Guía + Chofer), add driver tour rate
      if (service.type === 'tour' && service.includeGuide && this.driverTourRateCache) {
        const driverTourRate = this.driverTourRateCache.value || 0;
        totalPrice += driverTourRate;
        // console.log('🚗 calculateServicePrice: Adding driver tour rate to total:', driverTourRate, 'New total:', totalPrice);
      } else if (service.type === 'tour') {
        // console.log('🚗 calculateServicePrice: Tour without includeGuide:', service.includeGuide, 'or no driverTourRateCache');
      }

      return totalPrice;
    }

    // For transport services: (vehiclePrice * quantity) + Guía + Greeter
    // Returns the full total so callers should NOT multiply by quantity again
    if (service.type === 'transport') {
      const vehiclePrice = service.baseVehiclePrice || service.price || 0;
      const quantity = service.quantity || 1;
      let totalPrice = vehiclePrice * quantity;

      if (service.includeGuide && service.routeDuration) {
        totalPrice += this.calculateGuideTransportCost(service.routeDuration);
      }

      if (service.includeGreeter && service.routeDuration) {
        totalPrice += this.calculateGreeterPrice(service.routeDuration);
      }

      return totalPrice;
    }

    // For other service types or when no individual prices, use the regular price
    return service.price || 0;
  }

  getVehicleCost(service) {
    // Try to get vehicle cost from the pricing data
    const { tourId } = service;
    const { rateId } = service; // You might need to store this in the service
    const vehicleType = service.vehicleType || service.vehicleTypeName || service.vehicleId;

    // console.log('💰 getVehicleCost called with:', {tourId, rateId, vehicleType});

    if (!tourId || !vehicleType) {
      // console.log('❌ Missing tourId or vehicleType, returning 0');
      return 0;
    }

    // First try client-specific pricing
    if (this.clientId) {
      const clientPrices = this.getClientPricesFromCache(tourId, rateId);
      const clientPrice = clientPrices.find((price) => price.vehiclePtr === vehicleType);
      if (clientPrice && clientPrice.price !== undefined) {
        return clientPrice.price;
      }
    }

    // Fallback to tour pricing
    const tourPrices = this.getTourPricesFromCache(tourId, rateId);
    // console.log('🎯 Tour prices from cache:', tourPrices);
    // console.log('🔍 Looking for vehicleType:', vehicleType);
    const tourPrice = tourPrices.find((price) => price.vehicleType === vehicleType);
    // console.log('🎯 Found tour price:', tourPrice);
    if (tourPrice && tourPrice.price !== undefined) {
      return tourPrice.price;
    }

    // If no specific pricing found, try to use the regular service price
    return service.price || 0;
  }

  renderPeopleQuantities(service) {
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
        if (adults > 0) parts.push(`<span class="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-1 me-2 mb-1"><i class="ti ti-user fs-6"></i><span>${adults} adulto${adults > 1 ? 's' : ''}</span></span>`);
        if (children > 0) parts.push(`<span class="badge bg-success-subtle text-success d-inline-flex align-items-center gap-1 me-2 mb-1"><i class="ti ti-mood-kid fs-6"></i><span>${children} niño${children > 1 ? 's' : ''} (3-12)</span></span>`);
        if (infants > 0) parts.push(`<span class="badge bg-warning-subtle text-warning d-inline-flex align-items-center gap-1 me-2 mb-1"><i class="ti ti-baby-carriage fs-6"></i><span>${infants} infante${infants > 1 ? 's' : ''} (0-2)</span></span>`);
        let flightHtml = '';
        if (service.transportType === 'aeropuerto' && service.flightNumber) {
          flightHtml = `<span class="badge bg-secondary-subtle text-secondary d-inline-flex align-items-center gap-1 me-2 mb-1"><i class="ti ti-plane fs-6"></i><span>${service.airline ? service.airline + ' ' : ''}${service.flightNumber}</span></span>`;
        }
        return `<div class="people-quantities mt-2 d-flex flex-wrap align-items-center">${parts.join('')}${flightHtml}</div>`;
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

    // If we have detailed quantities, show them
    if (adultsQuantity > 0 || childrenQuantity > 0 || adultsNoAlcoholQuantity > 0) {
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

      // Schedule is now shown in the main service details, no need to duplicate it here

      const result = `
                <div class="people-quantities mt-2 d-flex flex-wrap align-items-center">
                    ${quantitiesHtml.join('')}
                </div>
            `;
      return result;
    }

    return '';
  }

  formatCurrency(amount) {
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  /**
   * Apply payment surcharge + currency conversion for display.
   * All internal prices stay in MXN; this is display-only.
   */
  getDisplayPrice(mxnPrice) {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const currency = document.getElementById('currencySelect')?.value || 'MXN';

    // Step 1: Apply payment surcharge
    let withSurcharge = mxnPrice;
    if (window.PricingUtils) {
      withSurcharge = PricingUtils.applyPaymentRate(
        mxnPrice, paymentType, this.transferRate, this.agencyRate
      );
    } else if (paymentType === 'transferencia' && this.transferRate > 0) {
      withSurcharge = mxnPrice * (1 + this.transferRate / 100);
    } else if (paymentType === 'tarjeta' && this.agencyRate > 0) {
      withSurcharge = mxnPrice * (1 + this.agencyRate / 100);
    }

    // Step 2: Currency conversion
    if (currency === 'USD' && this.exchangeRate > 0) {
      const usdPrice = withSurcharge / this.exchangeRate;
      return window.PricingUtils ? PricingUtils.applyUSDRoundingRules(usdPrice) : Math.round(usdPrice);
    }
    return withSurcharge;
  }

  formatMinutesToHoursAndMinutes(minutes) {
    if (!minutes || minutes === 0) {
      return '0 minutos';
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    let result = '';

    if (hours > 0) {
      result += `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }

    if (remainingMinutes > 0) {
      if (result) result += ' y ';
      result += `${remainingMinutes} ${remainingMinutes === 1 ? 'minuto' : 'minutos'}`;
    }

    return result;
  }

  formatDate(dateString) {
    if (!dateString) return '';

    // Handle date string properly to avoid timezone issues
    // If it's in YYYY-MM-DD format, parse it as local date
    if (dateString.includes('-') && dateString.length === 10) {
      const [year, month, day] = dateString.split('-').map((num) => parseInt(num, 10));
      const date = new Date(year, month - 1, day); // month is 0-based
      return date.toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }

    // Fallback for other date formats
    const date = new Date(dateString);
    return date.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  generateDefaultDate(dayNumber) {
    // Generate a default date starting from today + (day number - 1)
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (dayNumber - 1));

    return targetDate.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.substr(0, maxLength)}...`;
  }

  getServiceTitle(service) {
    switch (service.type) {
      case 'experience':
        return this.getExperienceName(service.experienceId) || 'Experiencia';
      case 'tour':
        return this.getTourName(service.tourId) || 'Tour';
      case 'transport':
        return service.concept || 'Transporte';
      case 'concepto':
        // For concepto, just return the concept text without "Concepto" prefix
        // since the badge already shows "Concepto"
        return service.concept || 'Concepto';
      default:
        return 'Servicio';
    }
  }

  getVehicleName(vehicleId) {
    const vehicle = this.vehiclesCache?.find((v) => v.objectId === vehicleId);
    return vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehículo';
  }

  getVehicleDisplayName(service) {
    // For transport, try vehicleType, vehicleTypeName, or vehicleId (backwards compat)
    if (service.type === 'transport') {
      if (service.vehicleTypeName) return service.vehicleTypeName;
      const vtId = service.vehicleType || service.vehicleId;
      if (vtId) {
        const vehicleInfo = this.getVehicleTypeInfo(vtId);
        if (vehicleInfo && vehicleInfo.name) return vehicleInfo.name;
        return vtId;
      }
      return 'Vehículo';
    }
    // For tours with vehicle type, show the vehicle type name
    if (service.type === 'tour' && service.vehicleType) {
      // Try to get the proper display name from the vehicle types cache
      const vehicleInfo = this.getVehicleTypeInfo(service.vehicleType);
      if (vehicleInfo && vehicleInfo.name) {
        return vehicleInfo.name;
      }
      return service.vehicleType;
    }
    // For tours with vehicleTypeName, use that
    if (service.type === 'tour' && service.vehicleTypeName) {
      return service.vehicleTypeName;
    }
    // Special case: For tours, check if vehicleId is actually a vehicle type name
    if (service.type === 'tour' && service.vehicleId) {
      // Check if this vehicleId is actually a vehicle type name
      const vehicleInfo = this.getVehicleTypeInfo(service.vehicleId);
      if (vehicleInfo && vehicleInfo.name) {
        // It's a vehicle type, return the proper name
        return vehicleInfo.name;
      }
      // If not found in vehicle types, it might be a raw vehicle type name, so return it directly
      return service.vehicleId;
    }
    // For non-tour services with specific vehicles, show brand and model
    if (service.vehicleId) {
      return this.getVehicleName(service.vehicleId);
    }
    return 'Vehículo';
  }

  getExperienceName(experienceId) {
    if (!experienceId) return 'Experiencia';

    // Check regular experiences cache
    if (this.experiencesCache.has('all')) {
      const experiences = this.experiencesCache.get('all');
      const experience = experiences.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      if (experience) {
        return experience.title || experience.name || 'Experiencia';
      }
    }

    // Check provider experiences cache
    if (this.providerExperiencesCache && Array.isArray(this.providerExperiencesCache)) {
      const experience = this.providerExperiencesCache.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      if (experience) {
        return experience.title || experience.name || 'Experiencia';
      }
    }

    return 'Experiencia';
  }

  getTourName(tourId) {
    if (!tourId) return 'Tour';

    // Find the tour from cache
    if (this.toursCache.has('all')) {
      const tours = this.toursCache.get('all');
      const tour = tours.find((t) => t.id === tourId || t.objectId === tourId);
      if (tour) {
        // Handle destinationPOI as both string and Parse object
        let destinationName = null;
        const { destinationPOI } = tour;

        if (destinationPOI) {
          if (typeof destinationPOI === 'string') {
            destinationName = destinationPOI;
          } else if (typeof destinationPOI === 'object' && destinationPOI !== null) {
            // Try various possible field names
            destinationName = destinationPOI.name
              || destinationPOI.destinationName
              || destinationPOI.location
              || destinationPOI.title
              || destinationPOI.label
              || destinationPOI.objectId
              || destinationPOI.id;

            // If it's a Parse object with a get method
            if (typeof destinationPOI.get === 'function') {
              destinationName = destinationPOI.get('name')
                || destinationPOI.get('destinationName')
                || destinationPOI.get('location')
                || destinationPOI.get('title')
                || destinationPOI.get('label');
            }
          }
        }

        return destinationName || tour.name || tour.title || 'Tour';
      }
    }

    return 'Tour'; // Fallback
  }

  scrollToDay(dayId) {
    const element = document.getElementById(`day-${dayId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update active state in sidebar
      document.querySelectorAll('.day-nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.dayId === dayId);
      });
    }
  }

  updateEmptyState() {
    const emptyState = document.getElementById('emptyStateContainer');
    const daysContainer = document.getElementById('daysContainer');

    if (this.days.length === 0) {
      emptyState?.classList.remove('d-none');
      daysContainer?.classList.add('d-none');
    } else {
      emptyState?.classList.add('d-none');
      daysContainer?.classList.remove('d-none');
    }
  }

  updateTotals() {
    let subtotalMXN = 0;

    this.days.forEach((day) => {
      day.services.forEach((serviceId) => {
        const service = this.services.get(serviceId);
        if (service && service.includeInTotal !== false) {
          const servicePrice = this.calculateServicePrice(service);
          subtotalMXN += servicePrice * (service.type === 'transport' ? 1 : service.quantity);
        }
      });
    });

    const displaySubtotal = this.getDisplayPrice(subtotalMXN);
    const iva = displaySubtotal * 0.16;
    const total = displaySubtotal + iva;
    const passengers = this.numberOfPeople || 0;
    const perPerson = passengers > 0 ? total / passengers : 0;

    // Update displays
    document.getElementById('subtotalAmount').textContent = `${this.formatCurrency(displaySubtotal)}`;
    document.getElementById('ivaAmount').textContent = `${this.formatCurrency(iva)}`;
    document.getElementById('totalAmount').textContent = `${this.formatCurrency(total)}`;
    document.getElementById('perPersonAmount').textContent = `${this.formatCurrency(perPerson)}`;
    document.getElementById('personCount').textContent = `(${passengers} ${passengers === 1 ? 'persona' : 'personas'})`;
  }

  showModalAlert(containerId, message, type = 'danger') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show mb-3" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

    container.innerHTML = alertHtml;

    // Auto-dismiss after 5 seconds for warnings and 7 seconds for errors
    const dismissTime = type === 'danger' ? 7000 : 5000;
    setTimeout(() => {
      this.clearModalAlert(containerId);
    }, dismissTime);
  }

  clearModalAlert(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
    }
  }

  showAlert(message, type = 'info') {
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
  }

  closeModal(modalId) {
    const modal = bootstrap.Modal.getInstance(document.getElementById(modalId));
    if (modal) {
      // Clear any modal alerts when closing
      if (modalId === 'dayModal') {
        this.clearModalAlert('dayModalAlert');
      } else if (modalId === 'serviceModal') {
        this.clearModalAlert('serviceModalAlert');
      }
      modal.hide();
    }
  }

  closeAllModals() {
    ['dayModal', 'serviceModal', 'deleteConfirmModal', 'previewModal'].forEach((modalId) => {
      this.closeModal(modalId);
    });
  }

  initializeTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map((tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl));
  }

  // API Methods
  async loadQuoteData() {
    try {
      const accessToken = this.getAccessToken();

      if (!accessToken) {
        console.warn('No access token found, skipping data load');
        return;
      }

      const response = await fetch(`/api/quotes/${this.quoteId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();

        if (result.success && result.data) {
          // Cache numberOfPeople from quote data
          this.numberOfPeople = result.data.numberOfPeople || 0;

          // Process service items if they exist
          if (result.data.serviceItems) {
            this.processServiceItems(result.data.serviceItems);
          } else {
          }
        } else {
          console.warn('⚠️ Quote data response not successful or missing data:', result);
        }
      } else {
        console.error('❌ Quote data request failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('💥 Error loading quote data:', error);
    }
  }

  processServiceItems(serviceItemsData) {
    if (!serviceItemsData || !serviceItemsData.days) return;

    // Clear existing data
    this.days = [];
    this.services.clear();

    // Process days and services
    serviceItemsData.days.forEach((day, index) => {
      const dayData = {
        id: day.id || this.generateId('day'),
        number: day.dayNumber || index + 1, // Use dayNumber from backend
        title: day.dayTitle || day.title || `Día ${index + 1}`, // Use dayTitle from backend
        date: day.date || null,
        description: day.description || '',
        services: [],
      };

      // Process subconcepts as services
      if (day.subconcepts && Array.isArray(day.subconcepts)) {
        day.subconcepts.forEach((subconcept) => {
          const serviceId = subconcept.id || this.generateId('service');
          this.services.set(serviceId, {
            id: serviceId,
            dayId: dayData.id,
            type: subconcept.type || 'other',
            concept: subconcept.concept,
            startTime: subconcept.time || subconcept.startTime, // Backend sends 'time'
            endTime: subconcept.endTime,
            vehicleId: subconcept.vehicleId,
            vehicleType: subconcept.vehicleType, // Load vehicle type for tours
            vehicleTypeName: subconcept.vehicleTypeName, // Load vehicle type display name
            price: subconcept.unitPrice || 0,
            quantity: subconcept.quantity || 1,
            notes: subconcept.notes || '',
            experienceId: subconcept.experienceId,
            tourId: subconcept.tourId,
            rateId: subconcept.rateId,
            hotelName: subconcept.hotelName,
            checkIn: subconcept.checkIn,
            checkOut: subconcept.checkOut,
            // People quantities for experiences (from backend)
            adultsQuantity: subconcept.adultsQuantity || 0,
            childrenQuantity: subconcept.childrenQuantity || 0,
            adultsNoAlcoholQuantity: subconcept.adultsNoAlcoholQuantity || 0,
            // Schedule for experiences (from backend)
            selectedSchedule: subconcept.selectedSchedule || '',
            // Individual prices for experiences (from backend)
            adultPrice: subconcept.adultPrice || 0,
            childPrice: subconcept.childPrice || 0,
            noAlcoholPrice: subconcept.noAlcoholPrice || 0,
            // Tour-specific fields (from backend)
            includeGuide: subconcept.includeGuide || false,
            includeGreeter: subconcept.includeGreeter || false,
            greeterInVehicle: subconcept.greeterInVehicle || false,
            includeInTotal: subconcept.includeInTotal !== undefined ? subconcept.includeInTotal : true,
            // Transport-specific fields (from backend)
            transportType: subconcept.transportType || null,
            tripType: subconcept.tripType || null,
            directionType: subconcept.directionType || null,
            origin: subconcept.origin || null,
            originName: subconcept.originName || null,
            destination: subconcept.destination || null,
            destinationPOI: subconcept.destinationPOI || null,
            specificLocation: subconcept.specificLocation || null,
            category: subconcept.category || null,
            transportAdults: subconcept.transportAdults || 0,
            transportChildren: subconcept.transportChildren || 0,
            transportInfants: subconcept.transportInfants || 0,
            persons: subconcept.persons || 0,
            flightNumber: subconcept.flightNumber || null,
            airline: subconcept.airline || null,
            routeDuration: subconcept.routeDuration || null,
            baseVehiclePrice: subconcept.baseVehiclePrice || null,
          });

          // Debug logging for people quantities and schedule loading
          if (subconcept.type === 'experience' && (subconcept.adultsQuantity || subconcept.childrenQuantity || subconcept.adultsNoAlcoholQuantity || subconcept.selectedSchedule)) {
          }

          // Debug logging for includeGuide loading
          if (subconcept.type === 'tour' && subconcept.includeGuide) {
            // console.log('🔄 Loading tour with includeGuide from backend:', subconcept.includeGuide);
          }

          dayData.services.push(serviceId);
        });
      }

      // Sort services by time and remove duplicates
      dayData.services = this.sortAndDeduplicateServices(dayData.services);

      this.days.push(dayData);
    });
  }

  // Sort services by time only (without deduplication)
  sortServicesByTime(serviceIds) {
    if (!serviceIds || serviceIds.length === 0) return [];

    // Get service objects
    const services = serviceIds
      .map((serviceId) => {
        const service = this.services.get(serviceId);
        return service ? { id: serviceId, service } : null;
      })
      .filter((s) => s !== null);

    // Sort by time
    services.sort((a, b) => {
      const timeStrA = a.service.selectedSchedule || a.service.startTime || '';
      const timeStrB = b.service.selectedSchedule || b.service.startTime || '';
      const timeA = this.parseTimeForSorting(timeStrA);
      const timeB = this.parseTimeForSorting(timeStrB);
      return timeA - timeB;
    });

    // Detect overlaps after sorting
    this.detectScheduleOverlaps(services);

    return services.map((s) => s.id);
  }

  // Sort services by time and remove duplicates
  sortAndDeduplicateServices(serviceIds) {
    if (!serviceIds || serviceIds.length === 0) return [];

    // Get service objects and remove duplicates first
    const uniqueServices = [];
    const seenServices = new Set();

    for (const serviceId of serviceIds) {
      const service = this.services.get(serviceId);
      if (!service) continue;

      // Create a unique key for deduplication
      const uniqueKey = `${service.concept || ''}-${service.startTime || ''}-${service.price || 0}-${service.type || ''}`;

      if (!seenServices.has(uniqueKey)) {
        seenServices.add(uniqueKey);
        uniqueServices.push({ id: serviceId, service });
      } else {
        // console.log('🔄 Removing duplicate service:', service.concept, service.startTime);
        // Remove duplicate from services Map
        this.services.delete(serviceId);
      }
    }

    // Sort by time - use selectedSchedule for sorting if available, otherwise startTime
    uniqueServices.sort((a, b) => {
      const timeStrA = a.service.selectedSchedule || a.service.startTime || '';
      const timeStrB = b.service.selectedSchedule || b.service.startTime || '';
      const timeA = this.parseTimeForSorting(timeStrA);
      const timeB = this.parseTimeForSorting(timeStrB);
      return timeA - timeB;
    });

    // Detect overlaps after sorting
    this.detectScheduleOverlaps(uniqueServices);

    // console.log('🔄 Services after sort and deduplication:', uniqueServices.map(s => ({
    //     concept: s.service.concept,
    //     schedule: s.service.selectedSchedule,
    //     startTime: s.service.startTime,
    //     parsedTime: this.parseTimeForSorting(s.service.selectedSchedule || s.service.startTime),
    //     hasOverlap: s.service.hasOverlap
    // })));

    return uniqueServices.map((s) => s.id);
  }

  // Parse time for sorting - handles formats like "08:00 - 12:00", "13:00", etc.
  parseTimeForSorting(timeStr) {
    if (!timeStr) return 999999; // Put services without time at the end

    // Handle range formats like "08:00 - 12:00"
    const rangeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*-/);
    if (rangeMatch) {
      const hours = parseInt(rangeMatch[1], 10);
      const minutes = parseInt(rangeMatch[2], 10);
      return hours * 60 + minutes;
    }

    // Handle single time formats like "13:00"
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      return hours * 60 + minutes;
    }

    // If we can't parse it, put it at the end
    return 999999;
  }

  // Extract start time from schedule for backend validation
  extractStartTimeFromSchedule(scheduleText) {
    if (!scheduleText) return '';

    // Handle range formats like "08:00 - 12:00" - extract start time
    const rangeMatch = scheduleText.match(/^(\d{1,2}:\d{2})\s*-/);
    if (rangeMatch) {
      return rangeMatch[1];
    }

    // Handle single time formats like "13:00"
    const timeMatch = scheduleText.match(/^(\d{1,2}:\d{2})/);
    if (timeMatch) {
      return timeMatch[1];
    }

    // If we can't extract a valid time, return empty
    return '';
  }

  // Detect schedule overlaps in a list of services
  detectScheduleOverlaps(services) {
    // Clear previous overlap flags
    services.forEach((s) => {
      s.service.hasOverlap = false;
      s.service.overlapsWith = [];
    });

    // Check each service against all others
    for (let i = 0; i < services.length; i++) {
      const serviceA = services[i].service;
      const timeRangeA = this.parseTimeRange(serviceA.selectedSchedule || serviceA.startTime);

      if (!timeRangeA) continue;

      for (let j = 0; j < services.length; j++) {
        if (i === j) continue;

        const serviceB = services[j].service;
        const timeRangeB = this.parseTimeRange(serviceB.selectedSchedule || serviceB.startTime);

        if (!timeRangeB) continue;

        // Check if times overlap
        if (this.timeRangesOverlap(timeRangeA, timeRangeB)) {
          serviceA.hasOverlap = true;
          if (!serviceA.overlapsWith) serviceA.overlapsWith = [];
          serviceA.overlapsWith.push({
            concept: this.getServiceTitle(serviceB),
            time: serviceB.selectedSchedule || serviceB.startTime,
          });
        }
      }
    }
  }

  // Parse time range string into start and end minutes
  parseTimeRange(timeStr) {
    if (!timeStr) return null;

    // Handle range formats like "08:00 - 12:00"
    const rangeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (rangeMatch) {
      const startHours = parseInt(rangeMatch[1], 10);
      const startMinutes = parseInt(rangeMatch[2], 10);
      const endHours = parseInt(rangeMatch[3], 10);
      const endMinutes = parseInt(rangeMatch[4], 10);

      return {
        start: startHours * 60 + startMinutes,
        end: endHours * 60 + endMinutes,
      };
    }

    // Handle single time - assume 1 hour duration
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const start = hours * 60 + minutes;

      return {
        start,
        end: start + 60, // Assume 1 hour duration for single times
      };
    }

    return null;
  }

  // Check if two time ranges overlap
  timeRangesOverlap(rangeA, rangeB) {
    // Two ranges overlap if:
    // A starts before B ends AND B starts before A ends
    return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
  }

  // Get overlap tooltip text
  getOverlapTooltip(service) {
    if (!service.overlapsWith || service.overlapsWith.length === 0) {
      return 'Conflicto de horario detectado';
    }

    const conflicts = service.overlapsWith.map((overlap) => `${overlap.concept} (${overlap.time})`).join(', ');

    return `Conflicto con: ${conflicts}`;
  }

  // Recalculate overlaps for a specific day after changes
  recalculateOverlapsForDay(day) {
    if (!day || !day.services || day.services.length === 0) return;

    // Get service objects for this day
    const dayServices = day.services
      .map((serviceId) => {
        const service = this.services.get(serviceId);
        return service ? { id: serviceId, service } : null;
      })
      .filter((s) => s !== null);

    // Recalculate overlaps for this day's services
    this.detectScheduleOverlaps(dayServices);

    // console.log('🔄 Recalculated overlaps for day:', day.title, dayServices.map(s => ({
    //     concept: this.getServiceTitle(s.service),
    //     hasOverlap: s.service.hasOverlap
    // })));
  }

  async loadVehicles() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping vehicles load');
        return;
      }

      const response = await fetch('/api/vehicles', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.vehiclesCache = result.data;
        } else if (Array.isArray(result)) {
          this.vehiclesCache = result;
        }
        this.populateVehicleSelect();
      } else {
        console.warn(`Vehicles API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading vehicles:', error);
      // Don't break initialization if vehicles fail to load
    }
  }

  async loadAllRates() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping rates load');
        return;
      }

      const response = await fetch('/api/rates/active', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.ratesCache = result.data;
        } else if (Array.isArray(result)) {
          this.ratesCache = result;
        }
        // Populate the rates dropdown after loading
        this.populateRatesDropdown();
      } else {
        console.warn(`Rates API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading rates:', error);
    }
  }

  async loadAllTourPrices() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping TourPrices load');
        return;
      }

      // Try to use API endpoint if available, otherwise fallback to Parse SDK
      let tourPrices = [];

      try {
        // First try API endpoint (following pattern of existing functions)
        // Add cache buster to force reload with fixed vehicle names
        const response = await fetch(`/api/tour-prices?_t=${Date.now()}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            tourPrices = result.data;
          } else {
            throw new Error('API response format invalid');
          }
        } else {
          throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
      } catch (apiError) {
        // Fallback to Parse Cloud Function
        try {
          const cloudResponse = await fetch('/parse/functions/getTourPrices', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'X-Parse-Application-Id': 'CrTRTaJpoJFNt8PJ',
            },
            body: JSON.stringify({}),
          });

          if (cloudResponse.ok) {
            const cloudResult = await cloudResponse.json();
            if (cloudResult.result) {
              tourPrices = cloudResult.result;
            } else {
              throw new Error('Cloud function response invalid');
            }
          } else {
            throw new Error(`Cloud function returned ${cloudResponse.status}: ${cloudResponse.statusText}`);
          }
        } catch (cloudError) {
          // For now, use empty array but we need to create the cloud function
          tourPrices = [];
        }
      }

      // Clear existing cache
      this.tourPricesMap.clear();

      // Index by tour+rate for fast lookup
      tourPrices.forEach((tp) => {
        const tourId = tp.tourPtr;
        const rateId = tp.ratePtr;

        if (tourId && rateId) {
          const key = `${tourId}_${rateId}`;

          if (!this.tourPricesMap.has(key)) {
            this.tourPricesMap.set(key, []);
          }

          // Store the essential data
          this.tourPricesMap.get(key).push({
            id: tp.id,
            tourId,
            rateId,
            vehicleType: tp.vehicleType,
            price: tp.price,
            valid_until: tp.valid_until,
          });
        }
      });
    } catch (error) {
      console.error('❌ Error loading TourPrices:', error);
      // Don't break initialization if this fails
      this.tourPricesMap.clear();
    }
  }

  async loadAllClientPrices() {
    try {
      const clientId = this.getClientId();
      if (!clientId) {
        this.clientPricesMap.clear();
        return;
      }

      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping ClientPrices load');
        return;
      }

      // Try API endpoint first, fallback to Parse SDK
      let clientPrices = [];

      try {
        // First try API endpoint with cache buster
        const response = await fetch(`/api/client-prices?clientId=${clientId}&itemType=TOUR&_t=${Date.now()}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            clientPrices = result.data;
          } else {
            throw new Error('API response format invalid');
          }
        } else {
          throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
      } catch (apiError) {
        // Fallback to Parse Cloud Function
        try {
          const cloudResponse = await fetch('/parse/functions/getClientPrices', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'X-Parse-Application-Id': 'CrTRTaJpoJFNt8PJ',
            },
            body: JSON.stringify({
              clientId,
              itemType: 'TOUR',
            }),
          });

          if (cloudResponse.ok) {
            const cloudResult = await cloudResponse.json();
            if (cloudResult.result) {
              clientPrices = cloudResult.result;
            } else {
              throw new Error('Cloud function response invalid');
            }
          } else {
            throw new Error(`Cloud function returned ${cloudResponse.status}: ${cloudResponse.statusText}`);
          }
        } catch (cloudError) {
          // For now, use empty array but we need to create the cloud function
          clientPrices = [];
        }
      }

      // Clear existing cache
      this.clientPricesMap.clear();

      // Index by tour+rate+vehicle for fast lookup
      clientPrices.forEach((cp) => {
        const tourId = cp.itemPtr;
        const rateId = cp.ratePtr;
        const { vehiclePtr } = cp;

        if (tourId && rateId) {
          const key = `${tourId}_${rateId}_${vehiclePtr || 'default'}`;

          // Store the essential data
          this.clientPricesMap.set(key, {
            id: cp.id,
            tourId,
            rateId,
            vehiclePtr,
            price: cp.price,
            valid_until: cp.valid_until,
            clientPtr: cp.clientPtr,
            itemType: cp.itemType,
          });
        }
      });
    } catch (error) {
      console.error('❌ Error loading ClientPrices:', error);
      // Don't break initialization if this fails
      this.clientPricesMap.clear();
    }
  }

  async loadVehicleTypes() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping vehicle types load');
        return;
      }

      const response = await fetch('/api/vehicle-types/active', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          // Store vehicle types by both ID and name/code for easy lookup
          result.data.forEach((vt) => {
            this.vehicleTypesMap.set(vt.value, {
              id: vt.value,
              name: vt.label,
              code: vt.code,
              capacity: vt.capacity,
              trunkCapacity: vt.trunkCapacity,
              icon: vt.icon,
            });

            // Also store by code/name for lookup by string
            if (vt.code) {
              this.vehicleTypesMap.set(vt.code, this.vehicleTypesMap.get(vt.value));
            }
            if (vt.label) {
              this.vehicleTypesMap.set(vt.label, this.vehicleTypesMap.get(vt.value));
            }
          });
        } else if (Array.isArray(result)) {
          // Handle direct array response
          result.forEach((vt) => {
            this.vehicleTypesMap.set(vt.value || vt.id, vt);
          });
        }
      } else {
        console.warn(`Vehicle types API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading vehicle types:', error);
    }
  }

  async loadAllExperiences() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping experiences load');
        return;
      }

      const response = await fetch('/api/experiences?draw=1&start=0&length=1000&search[value]=', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();

        // Handle DataTables format response
        if (result.data && Array.isArray(result.data)) {
          this.experiencesCache.set('all', result.data);
        } else if (result.success && result.data) {
          this.experiencesCache.set('all', result.data);
        } else if (Array.isArray(result)) {
          this.experiencesCache.set('all', result);
        }
      } else {
        console.warn(`Experiences API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading experiences:', error);
    }
  }

  async loadAllTours() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping tours load');
        return;
      }

      // Use DataTables format to get all tours
      const url = '/api/tours?draw=1&start=0&length=1000&search[value]=';
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          this.toursCache.set('all', result.data);
        } else if (result.success && result.data) {
          this.toursCache.set('all', result.data);
        } else {
          console.warn('Unexpected tours API response format:', result);
        }
      } else {
        console.warn(`Tours API returned ${response.status}: ${response.statusText}`);
        const responseText = await response.text();
        console.warn('Response body:', responseText);
      }
    } catch (error) {
      console.error('Error loading tours:', error);
    }
  }

  async loadProviderExperiences() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping provider experiences load');
        return;
      }

      // Load provider experiences using the dedicated provider-experiencias API
      const response = await fetch('/api/provider-experiencias/all', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();

        if (result.success && result.data) {
          this.providerExperiencesCache = result.data;
        } else if (result.data && Array.isArray(result.data)) {
          this.providerExperiencesCache = result.data;
        } else if (Array.isArray(result)) {
          this.providerExperiencesCache = result;
        } else {
          this.providerExperiencesCache = [];
        }
      } else {
        console.warn(`Provider experiences API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading provider experiences:', error);
      // Set empty array to prevent errors
      this.providerExperiencesCache = [];
    }
  }

  async loadAgencyRate() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping agency rate load');
        return;
      }

      const response = await fetch('/api/agency-rate/current', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.agencyRateCache = result.data;
        }
      } else {
        console.warn(`Agency rate API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading agency rate:', error);
    }
  }

  async loadDriverTourRate() {
    // console.log('🚀 Starting loadDriverTourRate...');
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping driver tour rate load');
        return;
      }
      // console.log('📍 Access token found, fetching driver tour rate...');

      const response = await fetch('/api/driver-tour-rate/current', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        // console.log('📊 Driver Tour Rate API response:', result);
        if (result.success && result.data) {
          this.driverTourRateCache = result.data;
          // console.log('✅ Driver Tour Rate loaded successfully:', this.driverTourRateCache);
        } else {
          console.warn('⚠️ Driver Tour Rate API returned success=false or no data');
        }
      } else {
        console.warn(`Driver tour rate API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading driver tour rate:', error);
    }
  }

  async loadGuideTransportRate() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping guide transport rate load');
        return;
      }

      // Try the endpoint, but handle 404 gracefully since it might not exist yet
      const response = await fetch('/api/guide-transport-rate/current', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.guideTransportRateCache = result.data;
        }
      } else if (response.status === 404) {
        this.guideTransportRateCache = null;
      } else {
        console.warn(`Guide transport rate API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading guide transport rate:', error);
      this.guideTransportRateCache = null;
    }
  }

  async loadTransferRate() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping transfer rate load');
        return;
      }

      const response = await fetch('/api/transfer-rate/current', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.transferRateCache = result.data;
        }
      } else if (response.status === 404) {
        this.transferRateCache = null;
      } else {
        console.warn(`Transfer rate API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading transfer rate:', error);
      this.transferRateCache = null;
    }
  }

  async loadPricingRates() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping pricing rates load');
        return;
      }

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      const [exchangeRes, transferRes, agencyRes] = await Promise.all([
        fetch('/api/exchange-rate/current', { headers }),
        fetch('/api/transfer-rate/current', { headers }),
        fetch('/api/agency-rate/current', { headers }),
      ]);

      if (exchangeRes.ok) {
        const data = await exchangeRes.json();
        if (data.success && data.data) {
          this.exchangeRate = data.data.value || data.data.rate || 0;
        }
      }

      if (transferRes.ok) {
        const data = await transferRes.json();
        if (data.success && data.data) {
          this.transferRate = data.data.value || data.data.rate || 0;
        }
      }

      if (agencyRes.ok) {
        const data = await agencyRes.json();
        if (data.success && data.data) {
          this.agencyRate = data.data.value || data.data.rate || 0;
        }
      }

      console.log('Pricing rates loaded:', {
        exchangeRate: this.exchangeRate,
        transferRate: this.transferRate,
        agencyRate: this.agencyRate,
      });
    } catch (error) {
      console.error('Error loading pricing rates:', error);
    }
  }

  async loadClientSpecificPricing() {
    if (!this.clientId) {
      return;
    }

    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) {
        console.warn('No access token found, skipping client pricing load');
        return;
      }

      // Load client-specific pricing for all experiences/services and tours concurrently
      const pricingPromises = [];

      // Load client-specific service pricing
      if (this.experiencesCache.has('all')) {
        const experiences = this.experiencesCache.get('all');
        const servicePromises = experiences.map(async (experience) => {
          try {
            const response = await fetch(`/api/services/${experience.id}/all-rate-prices-with-client-prices?clientId=${this.clientId}`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            });

            if (response.ok) {
              const result = await response.json();
              if (result.success && result.data) {
                this.clientPricesCache.set(experience.id, result.data);
              }
            }
          } catch (error) {
            console.debug(`Error loading client prices for service ${experience.id}:`, error);
          }
        });
        pricingPromises.push(...servicePromises);
      }

      // Load client-specific tour pricing
      if (this.toursCache.has('all')) {
        const tours = this.toursCache.get('all');
        const tourPromises = tours.map(async (tour) => {
          try {
            const response = await fetch(`/api/tours/${tour.id}/all-rate-prices-with-client-prices?clientId=${this.clientId}`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            });

            if (response.ok) {
              const result = await response.json();
              if (result.success && result.data) {
                this.clientTourPricesCache.set(tour.id, result.data);
              }
            }
          } catch (error) {
            console.debug(`Error loading client prices for tour ${tour.id}:`, error);
          }
        });
        pricingPromises.push(...tourPromises);
      }

      await Promise.all(pricingPromises);
    } catch (error) {
      console.error('Error loading client-specific pricing:', error);
    }
  }

  setupClientChangeListener() {
    // Watch for client selection changes to reload pricing
    const clientSelect = document.getElementById('clientId');
    if (clientSelect) {
      // For regular input
      clientSelect.addEventListener('change', async () => {
        const newClientId = this.getClientId();
        if (newClientId !== this.clientId) {
          this.clientId = newClientId;

          // Clear existing client pricing cache
          this.clientPricesCache.clear();
          this.clientTourPricesCache.clear();

          // Reload client-specific pricing
          if (this.clientId) {
            await this.loadClientSpecificPricing();
          }
        }
      });
    }

    // Also watch for TomSelect changes
    document.addEventListener('tomselect:change', async (e) => {
      if (e.target && e.target.id === 'clientId') {
        const newClientId = this.getClientId();
        if (newClientId !== this.clientId) {
          this.clientId = newClientId;

          // Clear existing client pricing cache
          this.clientPricesCache.clear();
          this.clientTourPricesCache.clear();

          // Reload client-specific pricing
          if (this.clientId) {
            await this.loadClientSpecificPricing();
          }
        }
      }
    });
  }

  handleExperienceSelection(experienceId) {
    if (!experienceId) {
      // Clear price and details when no experience is selected
      document.getElementById('servicePrice').value = 0;
      this.clearExperienceDetails();
      return;
    }

    try {
      // Find the selected experience from cache
      let selectedExperience = null;

      // Check regular experiences cache
      if (this.experiencesCache.has('all')) {
        const experiences = this.experiencesCache.get('all');
        selectedExperience = experiences.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      }

      // Check provider experiences cache if not found
      if (!selectedExperience && this.providerExperiencesCache) {
        selectedExperience = this.providerExperiencesCache.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      }

      if (selectedExperience) {
        // Get client-specific price for this experience
        const price = this.getPriceForService(experienceId, null) || selectedExperience.price || 0;

        // Update the price field
        document.getElementById('servicePrice').value = price;

        // Auto-fill experience-specific fields with default values
        this.fillExperienceFields(selectedExperience);

        // Show experience details
        this.showExperienceDetails(selectedExperience);
      } else {
        console.warn('Experience not found in cache:', experienceId);
        document.getElementById('servicePrice').value = 0;
        this.clearExperienceDetails();
      }
    } catch (error) {
      console.error('Error handling experience selection:', error);
      document.getElementById('servicePrice').value = 0;
      this.clearExperienceDetails();
    }
  }

  fillExperienceFields(experience) {
    // Only fill quantity fields if we're NOT in edit mode
    // In edit mode, the quantities should be restored by populateServiceForm
    if (!this.currentServiceId) {
      // Fill people quantity fields with default values (NEW service only)
      const adultsQuantityField = document.getElementById('adultsQuantity');
      const childrenQuantityField = document.getElementById('childrenQuantity');
      const adultsNoAlcoholQuantityField = document.getElementById('adultsNoAlcoholQuantity');

      // Set default values for people quantities
      if (adultsQuantityField) {
        adultsQuantityField.value = experience.defaultAdults || 2;
      } else {

      }

      if (childrenQuantityField) {
        childrenQuantityField.value = experience.defaultChildren || 0;
      } else {

      }

      if (adultsNoAlcoholQuantityField) {
        adultsNoAlcoholQuantityField.value = experience.defaultAdultsNoAlcohol || 0;
      } else {

      }
    } else {

    }

    // Fill read-only experience information fields
    const experienceDescriptionField = document.getElementById('experienceDescription');
    const experienceLanguagesField = document.getElementById('experienceLanguages');
    const experienceIncludesField = document.getElementById('experienceIncludes');
    const experienceNotIncludesField = document.getElementById('experienceNotIncludes');
    const advanceBookingTimeField = document.getElementById('advanceBookingTime');
    const experienceClientNotesField = document.getElementById('experienceClientNotes');

    // Fill description
    if (experienceDescriptionField && experience.description) {
      experienceDescriptionField.value = experience.description;
    }

    // Fill languages
    if (experienceLanguagesField && experience.languages) {
      const languagesText = Array.isArray(experience.languages)
        ? experience.languages.join(', ')
        : experience.languages;
      experienceLanguagesField.value = languagesText;
    }

    // Fill includes
    if (experienceIncludesField && experience.includes) {
      const includesText = Array.isArray(experience.includes)
        ? experience.includes.join('\n')
        : experience.includes;
      experienceIncludesField.value = includesText;
    }

    // Fill excludes/not includes
    if (experienceNotIncludesField && experience.notincludes) {
      const notIncludesText = Array.isArray(experience.notincludes)
        ? experience.notincludes.join('\n')
        : experience.notincludes;
      experienceNotIncludesField.value = notIncludesText;
    }

    // Fill advance booking time (convert minutes to hours and minutes)
    if (advanceBookingTimeField && experience.advance_booking_time) {
      const formattedTime = this.formatMinutesToHoursAndMinutes(experience.advance_booking_time);
      advanceBookingTimeField.value = formattedTime;
    }

    // Fill client notes
    if (experienceClientNotesField && experience.client_booking_notes) {
      experienceClientNotesField.value = experience.client_booking_notes;
    }

    // Handle price fields - Precios
    const adultPriceField = document.getElementById('adultPrice');
    const childPriceField = document.getElementById('childPrice');
    const noAlcoholPriceField = document.getElementById('noAlcoholPrice');

    if (adultPriceField && experience.price) {
      adultPriceField.value = experience.price;
    }

    if (childPriceField && experience.price_child) {
      childPriceField.value = experience.price_child;
    }

    if (noAlcoholPriceField && experience.price_no_alcohol) {
      noAlcoholPriceField.value = experience.price_no_alcohol;
    }

    // Handle schedule/availability - Horarios Disponibles
    // Get current day info for schedule filtering
    const currentDayInfo = this.getCurrentDayContext();

    this.handleExperienceSchedule(experience, currentDayInfo);
  }

  getCurrentDayContext() {
    if (!this.currentDayId) {
      return { dayOfWeek: null, dayDate: null, dayInfo: null };
    }

    const dayInfo = this.days.find((d) => d.id === this.currentDayId);
    if (!dayInfo || !dayInfo.date) {
      return { dayOfWeek: null, dayDate: null, dayInfo };
    }

    const dayDate = new Date(dayInfo.date);
    const dayOfWeek = dayDate.getDay();

    return { dayOfWeek, dayDate, dayInfo };
  }

  handleExperienceSchedule(experience, dayContext = null) {
    const singleTimeField = document.getElementById('experienceSingleTime');
    const multipleTimeField = document.getElementById('experienceMultipleTime');
    const availabilityStatusDiv = document.getElementById('experienceAvailabilityStatus');
    const availabilityMessageSpan = document.getElementById('experienceAvailabilityMessage');

    // Hide all schedule elements initially
    if (singleTimeField) singleTimeField.style.display = 'none';
    if (multipleTimeField) multipleTimeField.style.display = 'none';
    if (availabilityStatusDiv) availabilityStatusDiv.style.display = 'none';

    const currentDayOfWeek = dayContext?.dayOfWeek;
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const dayAbbrevEs = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

    // Check if experience has specific times
    if (experience.startTime && experience.endTime) {
      // Single fixed time
      const startTime = this.formatTime(experience.startTime);
      const endTime = this.formatTime(experience.endTime);
      const timeRange = `${startTime} - ${endTime}`;

      if (singleTimeField) {
        singleTimeField.value = timeRange;
        singleTimeField.style.display = 'block';
      }
    } else if (experience.availability && typeof experience.availability === 'object') {
      // Handle availability array - extract schedules for current day

      if (Array.isArray(experience.availability) && currentDayOfWeek !== null) {
        const timeOptions = this.extractTimeOptionsForDay(experience.availability, currentDayOfWeek);

        if (timeOptions.length > 0 && multipleTimeField) {
          // Clear existing options
          const currentSelection = multipleTimeField.value;
          const currentSelectionText = multipleTimeField.selectedIndex > 0
            ? multipleTimeField.options[multipleTimeField.selectedIndex].textContent : '';

          multipleTimeField.innerHTML = '<option value="">-- Selecciona un horario --</option>';

          // Add time options
          timeOptions.forEach((timeOption, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = timeOption.label;
            option.dataset.timeData = JSON.stringify(timeOption.data);
            multipleTimeField.appendChild(option);
          });

          // Try to restore previous selection if it exists
          if (currentSelectionText) {
            for (let i = 0; i < multipleTimeField.options.length; i++) {
              if (multipleTimeField.options[i].textContent === currentSelectionText) {
                multipleTimeField.selectedIndex = i;

                break;
              }
            }
          }

          multipleTimeField.style.display = 'block';
        } else {
          // No specific times found, show generic availability message
          if (availabilityStatusDiv && availabilityMessageSpan) {
            availabilityMessageSpan.textContent = 'Horario según disponibilidad';
            availabilityStatusDiv.style.display = 'block';
          }
        }
      } else if (experience.availability.times && Array.isArray(experience.availability.times)) {
        // Availability object with times array
        if (multipleTimeField) {
          multipleTimeField.innerHTML = '<option value="">-- Selecciona un horario --</option>';
          experience.availability.times.forEach((time, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = time;
            multipleTimeField.appendChild(option);
          });
          multipleTimeField.style.display = 'block';
        }
      } else {
        // Show availability status message
        if (availabilityStatusDiv && availabilityMessageSpan) {
          availabilityMessageSpan.textContent = 'Horario según disponibilidad';
          availabilityStatusDiv.style.display = 'block';
        }
      }
    } else {
      // No specific time info, show general availability message
      if (availabilityStatusDiv && availabilityMessageSpan) {
        availabilityMessageSpan.textContent = 'Horario según disponibilidad';
        availabilityStatusDiv.style.display = 'block';
      }
    }
  }

  extractTimeOptionsForDay(availabilityArray, dayOfWeek) {
    if (!Array.isArray(availabilityArray) || dayOfWeek === null) {
      return [];
    }

    const timeOptions = [];
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const dayAbbrevEs = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

    const currentDayName = dayNames[dayOfWeek];
    const currentDayNameEs = dayNamesEs[dayOfWeek];
    const currentDayAbbrevEs = dayAbbrevEs[dayOfWeek];

    for (let i = 0; i < availabilityArray.length; i++) {
      const availabilityObj = availabilityArray[i];

      if (!availabilityObj || typeof availabilityObj !== 'object') {
        continue;
      }

      // Check if this availability object applies to the current day
      let appliesToCurrentDay = false;
      let scheduleData = null;

      // Method 1: Check for day number property
      if (availabilityObj.hasOwnProperty(dayOfWeek.toString())) {
        const dayData = availabilityObj[dayOfWeek.toString()];
        if (dayData) {
          appliesToCurrentDay = true;
          scheduleData = dayData;
        }
      }

      // Method 2: Check for English day names
      if (!appliesToCurrentDay && availabilityObj.hasOwnProperty(currentDayName)) {
        const dayData = availabilityObj[currentDayName];
        if (dayData) {
          appliesToCurrentDay = true;
          scheduleData = dayData;
        }
      }

      // Method 3: Check for Spanish day names
      if (!appliesToCurrentDay && availabilityObj.hasOwnProperty(currentDayNameEs)) {
        const dayData = availabilityObj[currentDayNameEs];
        if (dayData) {
          appliesToCurrentDay = true;
          scheduleData = dayData;
        }
      }

      // Method 4: Check for Spanish abbreviations
      if (!appliesToCurrentDay && availabilityObj.hasOwnProperty(currentDayAbbrevEs)) {
        const dayData = availabilityObj[currentDayAbbrevEs];
        if (dayData) {
          appliesToCurrentDay = true;
          scheduleData = dayData;
        }
      }

      // Method 5: Check for 'day' property matching current day
      if (!appliesToCurrentDay && availabilityObj.day === dayOfWeek) {
        appliesToCurrentDay = true;
        scheduleData = availabilityObj;
      }

      // If this applies to current day, extract time information
      if (appliesToCurrentDay && scheduleData) {
        const extractedTimes = this.extractTimesFromScheduleData(scheduleData, i);
        timeOptions.push(...extractedTimes);
      }
    }

    return timeOptions;
  }

  extractTimesFromScheduleData(scheduleData, index = 0) {
    const times = [];

    if (!scheduleData) {
      return times;
    }

    // Handle different schedule data formats

    // Format 1: Direct time properties
    if (scheduleData.startTime && scheduleData.endTime) {
      const startTime = this.formatTime(scheduleData.startTime);
      const endTime = this.formatTime(scheduleData.endTime);
      times.push({
        label: `${startTime} - ${endTime}`,
        data: { startTime: scheduleData.startTime, endTime: scheduleData.endTime, source: `object_${index}` },
      });
    }

    // Format 2: Time property with string
    if (scheduleData.time && typeof scheduleData.time === 'string') {
      times.push({
        label: scheduleData.time,
        data: { time: scheduleData.time, source: `object_${index}` },
      });
    }

    // Format 3: Array of times
    if (Array.isArray(scheduleData.times)) {
      scheduleData.times.forEach((time, timeIndex) => {
        if (typeof time === 'string') {
          times.push({
            label: time,
            data: { time, source: `object_${index}_time_${timeIndex}` },
          });
        } else if (time.startTime && time.endTime) {
          // Handle startTime/endTime format
          const startTime = this.formatTime(time.startTime);
          const endTime = this.formatTime(time.endTime);
          times.push({
            label: `${startTime} - ${endTime}`,
            data: { startTime: time.startTime, endTime: time.endTime, source: `object_${index}_time_${timeIndex}` },
          });
        } else if (time.start && time.end) {
          // Handle start/end format (as seen in Testing experience)
          const startTime = this.formatTime(time.start);
          const endTime = this.formatTime(time.end);
          times.push({
            label: `${startTime} - ${endTime}`,
            data: { startTime: time.start, endTime: time.end, source: `object_${index}_time_${timeIndex}` },
          });
        }
      });
    }

    // Format 4: Array of schedule objects
    if (Array.isArray(scheduleData)) {
      scheduleData.forEach((item, itemIndex) => {
        if (item.startTime && item.endTime) {
          const startTime = this.formatTime(item.startTime);
          const endTime = this.formatTime(item.endTime);
          times.push({
            label: `${startTime} - ${endTime}`,
            data: { startTime: item.startTime, endTime: item.endTime, source: `object_${index}_item_${itemIndex}` },
          });
        } else if (item.start && item.end) {
          // Handle start/end format in array items
          const startTime = this.formatTime(item.start);
          const endTime = this.formatTime(item.end);
          times.push({
            label: `${startTime} - ${endTime}`,
            data: { startTime: item.start, endTime: item.end, source: `object_${index}_item_${itemIndex}` },
          });
        } else if (typeof item === 'string') {
          times.push({
            label: item,
            data: { time: item, source: `object_${index}_item_${itemIndex}` },
          });
        }
      });
    }

    // Format 5: Direct string value (boolean true converted to generic availability)
    if (scheduleData === true) {
      times.push({
        label: 'Disponible todo el día',
        data: { allDay: true, source: `object_${index}` },
      });
    }

    return times;
  }

  formatTime(timeString) {
    // Handle different time formats
    if (!timeString) return '';

    // If it's already formatted, return as is
    if (typeof timeString === 'string' && timeString.includes(':')) {
      return timeString;
    }

    // If it's a Parse Date object
    if (timeString.iso) {
      const date = new Date(timeString.iso);
      return date.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    // If it's a JavaScript Date
    if (timeString instanceof Date) {
      return timeString.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    // Return as string if none of the above
    return String(timeString);
  }

  handleTourTransportToggle(requiresTransport) {
    // Get the transport field elements
    const categoryField = document.getElementById('transportCategory')?.closest('.col-md-6');
    const vehicleField = document.getElementById('vehicleSelect')?.closest('.col-md-4');
    const guideField = document.getElementById('includeGuide')?.closest('.col-md-2');

    // Get the pricing fields (Precio and Cantidad)
    const transportFieldsRow = document.getElementById('transportFieldsRow');
    const standardPricingSection = document.getElementById('standardPricingSection');

    if (requiresTransport) {
      // Show transport fields
      categoryField?.classList.remove('d-none');
      vehicleField?.classList.remove('d-none');
      guideField?.classList.remove('d-none');
      document.getElementById('transportCategory')?.setAttribute('required', 'required');

      // Show pricing fields
      if (standardPricingSection) {
        standardPricingSection.classList.remove('d-none');
      }
    } else {
      // Hide transport fields
      categoryField?.classList.add('d-none');
      vehicleField?.classList.add('d-none');
      guideField?.classList.add('d-none');
      document.getElementById('transportCategory')?.removeAttribute('required');

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
      const currencySelect = document.getElementById('currencySelect');
      const priceTypeSelect = document.getElementById('priceTypeSelect');

      if (quantity) quantity.value = '1';
      if (currencySelect) currencySelect.value = 'USD';
      if (priceTypeSelect) priceTypeSelect.value = 'per_person';

      // Recalculate price without vehicle costs for tours
      this.recalculateTourPrice();

      // Update the current service data to reflect no vehicle
      if (this.currentServiceId) {
        const currentService = this.services.get(this.currentServiceId);
        if (currentService && currentService.type === 'tour') {
          // Clear vehicle data
          currentService.vehicleId = null;
          currentService.vehicleType = null;
          currentService.vehicleTypeName = null;
          currentService.rateId = null;
          // Update the display immediately
          this.updateTotals();
          this.renderDays();
        }
      }
    }
  }

  recalculateTourPrice() {
    // Get current tour data from form
    const adultsQuantity = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
    const childrenQuantity = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
    const adultsNoAlcoholQuantity = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value || 0);

    const adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
    const childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
    const noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);

    // console.log('👥 People quantities:', {adultsQuantity, childrenQuantity, adultsNoAlcoholQuantity});
    // console.log('💰 People prices:', {adultPrice, childPrice, noAlcoholPrice});

    // Calculate people costs
    let totalPrice = (adultsQuantity * adultPrice)
      + (childrenQuantity * childPrice)
      + (adultsNoAlcoholQuantity * noAlcoholPrice);

    // console.log('👥 People total calculated:', totalPrice);

    // Add vehicle costs if a vehicle is selected
    const vehicleSelect = document.getElementById('vehicleSelect');
    const tourSelect = document.getElementById('tourSelect');
    const rateSelect = document.getElementById('transportCategory');
    const serviceQuantity = parseInt(document.getElementById('serviceQuantity')?.value || 1);

    if (vehicleSelect && vehicleSelect.value && tourSelect && tourSelect.value) {
      // Create a temporary service object to calculate vehicle cost
      const tempService = {
        type: 'tour',
        tourId: tourSelect.value,
        rateId: rateSelect ? rateSelect.value : null,
        vehicleId: vehicleSelect.value,
        vehicleType: vehicleSelect.value, // Use the actual value, not text content
        quantity: serviceQuantity,
      };

      const vehicleCost = this.getVehicleCost(tempService);
      const vehicleTotal = vehicleCost * serviceQuantity;
      totalPrice += vehicleTotal;
      // console.log('🚛 Recalculation - Tour:', tourSelect.value, 'Rate:', rateSelect?.value, 'Vehicle:', vehicleSelect.value);
      // console.log('🚛 Adding vehicle cost in recalculation:', vehicleCost, '× quantity:', serviceQuantity, '= Total vehicle cost:', vehicleTotal);
    }

    // Add driver tour rate if includeGuide is checked (Guía + Chofer)
    const includeGuideCheckbox = document.getElementById('includeGuide');
    if (includeGuideCheckbox && includeGuideCheckbox.checked && this.driverTourRateCache) {
      const driverTourRate = this.driverTourRateCache.value || 0;
      totalPrice += driverTourRate;
      // console.log('🚗 Adding driver tour rate in recalculation:', driverTourRate, 'New total:', totalPrice);
    }

    // Update the price field - ONLY show vehicle cost, not the total
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      // Only show the vehicle cost in the price field
      if (vehicleSelect && vehicleSelect.value && tourSelect && tourSelect.value) {
        // We already calculated vehicleCost above, let's extract just that
        const tempService2 = {
          type: 'tour',
          tourId: tourSelect.value,
          rateId: rateSelect ? rateSelect.value : null,
          vehicleId: vehicleSelect.value,
          vehicleType: vehicleSelect.value,
          quantity: serviceQuantity,
        };
        const vehicleOnlyCost = this.getVehicleCost(tempService2);
        servicePriceField.value = vehicleOnlyCost.toFixed(2);
        // console.log('💰 Setting price field to vehicle cost only:', vehicleOnlyCost);
      } else {
        // No vehicle selected, show 0
        servicePriceField.value = '0.00';
      }
    }

    // Update the service data with current form values
    if (this.currentServiceId) {
      const currentService = this.services.get(this.currentServiceId);
      if (currentService && currentService.type === 'tour') {
        // Update people data
        currentService.adultsQuantity = adultsQuantity;
        currentService.childrenQuantity = childrenQuantity;
        currentService.adultsNoAlcoholQuantity = adultsNoAlcoholQuantity;
        currentService.adultPrice = adultPrice;
        currentService.childPrice = childPrice;
        currentService.noAlcoholPrice = noAlcoholPrice;
        currentService.price = peopleTotal;

        // Update includeGuide state
        if (includeGuideCheckbox) {
          currentService.includeGuide = includeGuideCheckbox.checked;
        }

        // Update includeGreeter state
        const includeGreeterCheckbox = document.getElementById('includeGreeter');
        if (includeGreeterCheckbox) {
          currentService.includeGreeter = includeGreeterCheckbox.checked;
        }
      }
    }

    // Update breakdown after tour price recalculation
    this.updateServicePriceBreakdown();
  }

  /**
   * Handle rate selection for tour vehicles.
   * @param rateId
   * @example
   */
  handleRateSelection(rateId) {
    // console.log('📍 handleRateSelection called with rateId:', rateId);

    // Clear price field immediately when rate changes
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      // console.log('📍 Clearing price field to 0.00');
      servicePriceField.value = '0.00';
    } else {
      // console.log('📍 Price field not found!');
    }

    // Check if we're currently in tour mode with transport enabled
    const serviceTypeInputs = document.querySelectorAll('input[name="serviceType"]');
    let currentServiceType = 'experience'; // default
    serviceTypeInputs.forEach((input) => {
      if (input.checked) {
        currentServiceType = input.value;
      }
    });

    if (currentServiceType === 'transport') {
      this.handleTransportRateSelection(rateId);
      return;
    }

    if (currentServiceType !== 'tour') {
      return;
    }

    const tourSelect = document.getElementById('tourSelect');
    const tourId = tourSelect?.value;
    const transportCheckbox = document.getElementById('tourRequiresTransport');
    const transportEnabled = transportCheckbox?.checked || false;

    if (!transportEnabled) {
      return;
    }

    if (!tourId || !rateId) {
      // Clear vehicle dropdown if no tour or rate selected
      this.clearVehicleDropdown();
      return;
    }

    try {
      // Get tour prices from cache
      const tourPrices = this.getTourPricesFromCache(tourId, rateId);

      // Get client prices from cache
      const clientPrices = this.getClientPricesFromCache(tourId, rateId);

      // Extract vehicle types from prices
      const vehicleTypes = this.extractVehicleTypesFromPrices(tourPrices, clientPrices);

      // Populate vehicle dropdown with prices
      this.populateVehicleDropdownWithPrices(vehicleTypes, tourId, rateId);

      // After populating dropdown, ensure price stays at 0 since no vehicle is selected yet
      const servicePriceField = document.getElementById('servicePrice');
      if (servicePriceField) {
        servicePriceField.value = '0.00';
        // console.log('📍 Resetting price to 0.00 after dropdown population');
      }
    } catch (error) {
      console.error('❌ Error handling rate selection:', error);
      this.clearVehicleDropdown();
    }
  }

  /**
   * Handle include guide checkbox change for tours (Guía + Chofer).
   * @param isChecked
   * @example
   */
  handleIncludeGuideChange(isChecked) {
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    if (serviceType === 'tour') {
      this.recalculateTourPrice();
    } else if (serviceType === 'transport') {
      this.recalculateTransportPrice();
    }
    this.updateVehicleCapacityNote();
  }

  /**
   * Handle include greeter checkbox change for tours.
   * @param isChecked
   * @example
   */
  handleIncludeGreeterChange(isChecked) {
    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    if (serviceType === 'tour') {
      this.recalculateTourPrice();
    } else if (serviceType === 'transport') {
      this.recalculateTransportPrice();
    }
    this.updateVehicleCapacityNote();
  }

  updateVehicleCapacityNote() {
    const noteEl = document.getElementById('vehicleCapacityNote');
    const noteTextEl = document.getElementById('vehicleCapacityNoteText');
    if (!noteEl || !noteTextEl) return;

    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    const includeGuide = document.getElementById('includeGuide')?.checked;
    const includeGreeter = document.getElementById('includeGreeter')?.checked;
    const greeterInVehicle = document.getElementById('greeterInVehicle')?.checked;
    const vehicleSelect = document.getElementById('vehicleSelect');
    const selectedVehicleId = vehicleSelect?.value;

    const reducesCapacity = includeGuide || (includeGreeter && greeterInVehicle);

    if (serviceType !== 'transport' || !reducesCapacity || !selectedVehicleId) {
      noteEl.classList.add('d-none');
      return;
    }

    // Get vehicle capacity from transport price data or global vehicle types map
    let capacity = 0;
    if (this.transportPriceData?.vehicles) {
      const vehicle = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === selectedVehicleId);
      if (vehicle) capacity = vehicle.capacity || 0;
    }
    if (!capacity) {
      const vehicleInfo = this.getVehicleTypeInfo(selectedVehicleId);
      if (vehicleInfo) capacity = vehicleInfo.capacity || vehicleInfo.defaultCapacity || 0;
    }

    const occupant = includeGuide ? 'El guía' : 'El greeter';

    if (capacity > 0) {
      const effectiveCapacity = capacity - 1;
      noteTextEl.textContent = `${occupant} ocupa 1 lugar. Capacidad disponible: ${effectiveCapacity} de ${capacity} pax`;
      noteEl.classList.remove('d-none');
    } else {
      noteTextEl.textContent = `${occupant} ocupa 1 lugar del vehículo`;
      noteEl.classList.remove('d-none');
    }
  }

  /**
   * Handle concepto schedule checkbox toggle.
   * @example
   */
  setupTimeInputs() {
    // Setup time input formatting for all time-input fields
    document.addEventListener('input', (e) => {
      if (e.target.classList.contains('time-input')) {
        this.formatTimeInput(e.target);
      }
    });

    document.addEventListener('keypress', (e) => {
      if (e.target.classList.contains('time-input')) {
        this.restrictTimeInputKeys(e);
      }
    });

    document.addEventListener('focus', (e) => {
      if (e.target.classList.contains('time-input') && !e.target.value) {
        // Show placeholder hint on focus
        e.target.placeholder = e.target.dataset.placeholder || '__:__';
      }
    });
  }

  formatTimeInput(input) {
    let value = input.value.replace(/[^0-9]/g, ''); // Remove non-digits

    // Auto-format as user types
    if (value.length >= 2) {
      value = `${value.substring(0, 2)}:${value.substring(2, 4)}`;
    }

    // Validate hours (00-23) and minutes (00-59)
    if (value.length === 5) {
      const [hours, minutes] = value.split(':');
      const h = parseInt(hours);
      const m = parseInt(minutes);

      if (h > 23) {
        value = `23:${minutes}`;
      }
      if (m > 59) {
        value = `${hours}:59`;
      }
    }

    input.value = value;
  }

  restrictTimeInputKeys(e) {
    // Allow: backspace, delete, tab, escape, enter
    if ([8, 9, 27, 13, 46].indexOf(e.keyCode) !== -1
      // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
      || (e.keyCode === 65 && e.ctrlKey === true)
      || (e.keyCode === 67 && e.ctrlKey === true)
      || (e.keyCode === 86 && e.ctrlKey === true)
      || (e.keyCode === 88 && e.ctrlKey === true)) {
      return;
    }

    // Ensure that it's a number and stop if not
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
    }

    // Limit to 5 characters (HH:MM)
    if (e.target.value.length >= 5) {
      e.preventDefault();
    }
  }

  handleConceptoScheduleToggle(hasSchedule) {
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
  }

  /**
   * Handle vehicle selection for price update.
   * @param vehicleType
   * @example
   */
  handleVehicleSelection(vehicleType) {
    if (!vehicleType) {
      // Clear price field if no vehicle selected
      const servicePriceField = document.getElementById('servicePrice');
      if (servicePriceField) {
        servicePriceField.value = '';
      }
      this.updateVehicleCapacityNote();
      return;
    }

    const serviceTypeRadio = document.querySelector('input[name="serviceType"]:checked');
    const currentServiceType = serviceTypeRadio?.value;

    // Transport: recalculate full price including Guía/Greeter surcharges
    if (currentServiceType === 'transport') {
      this.recalculateTransportPrice();
      this.updateVehicleCapacityNote();
      return;
    }

    const tourSelect = document.getElementById('tourSelect');
    const rateSelect = document.getElementById('transportCategory');
    const tourId = tourSelect?.value;
    const rateId = rateSelect?.value;

    if (!tourId || !rateId) {
      console.warn('Missing tour or rate for vehicle price calculation');
      return;
    }

    try {
      if (currentServiceType === 'tour') {
        // For tours, recalculate complete price (people + vehicle + driver)
        this.recalculateTourPrice();
      } else {
        // For non-tour services, use vehicle price only
        const finalPrice = this.getVehiclePriceWithPriority(vehicleType, tourId, rateId);
        this.updatePriceField(finalPrice);
      }
    } catch (error) {
      console.error('Error handling vehicle selection:', error);
    }
  }

  /**
   * Get tour prices from cache for specific tour and rate.
   * @param tourId
   * @param rateId
   * @example
   */
  getTourPricesFromCache(tourId, rateId) {
    const key = `${tourId}_${rateId}`;
    return this.tourPricesMap.get(key) || [];
  }

  /**
   * Get client prices from cache for specific tour and rate.
   * @param tourId
   * @param rateId
   * @example
   */
  getClientPricesFromCache(tourId, rateId) {
    if (!this.clientId) {
      return [];
    }

    // Return all client prices for this tour+rate combination
    // Filter by tour, rate and client in the returned array
    return Array.from(this.clientPricesMap.values()).filter((price) => price.tourId === tourId
      && price.rateId === rateId
      && price.clientPtr === this.clientId);
  }

  /**
   * Extract unique vehicle types from tour and client prices.
   * @param tourPrices
   * @param clientPrices
   * @example
   */
  extractVehicleTypesFromPrices(tourPrices, clientPrices) {
    const vehicleTypesMap = new Map(); // Use Map to store unique vehicleTypeId -> vehicleTypeName

    // Add vehicle types from tour prices
    tourPrices.forEach((price) => {
      const { vehicleType } = price;
      const vehicleTypeId = price.vehicleTypeId || price.vehicleType; // fallback to vehicleType if no ID

      if (vehicleType) {
        vehicleTypesMap.set(vehicleTypeId, vehicleType);
      }
    });

    // Add vehicle types from client prices
    clientPrices.forEach((price) => {
      const vehicleType = price.vehiclePtr;
      // For client prices, vehiclePtr is the vehicle type name/ID
      if (vehicleType) {
        vehicleTypesMap.set(vehicleType, vehicleType);
      }
    });

    return Array.from(vehicleTypesMap.values());
  }

  /**
   * Populate vehicle dropdown with vehicle types and their prices.
   * @param vehicleTypes
   * @param tourId
   * @param rateId
   * @example
   */
  populateVehicleDropdownWithPrices(vehicleTypes, tourId, rateId) {
    const vehicleSelect = document.getElementById('vehicleSelect');
    if (!vehicleSelect) {
      console.error('❌ Vehicle select element not found');
      return;
    }

    // Clear existing options except the default one
    vehicleSelect.innerHTML = '<option value="">-- Sin vehículo --</option>';
    vehicleSelect.value = ''; // Ensure the value is cleared

    if (vehicleTypes.length === 0) {
      const noOption = document.createElement('option');
      noOption.value = '';
      noOption.textContent = '-- Sin vehículos disponibles --';
      noOption.disabled = true;
      vehicleSelect.appendChild(noOption);

      return;
    }

    // Add options for each vehicle type with capacity info
    vehicleTypes.forEach((vehicleType) => {
      const vehicleInfo = this.getVehicleTypeInfo(vehicleType);
      const isClientPrice = this.hasClientPrice(vehicleType, tourId, rateId);

      const option = document.createElement('option');
      option.value = vehicleType;

      // Format capacity display
      let capacityDisplay = '';
      if (vehicleInfo) {
        const pax = vehicleInfo.capacity || 0;
        const trunk = vehicleInfo.trunkCapacity || 0;
        capacityDisplay = `${pax} pax, ${trunk} carry-on`;
      } else {
        capacityDisplay = 'Capacidad no disponible';
      }

      const clientIndicator = isClientPrice ? ' ⭐' : '';
      option.textContent = `${vehicleType} - ${capacityDisplay}${clientIndicator}`;

      vehicleSelect.appendChild(option);
    });
  }

  /**
   * Get vehicle price with ClientPrice priority over TourPrice.
   * @param vehicleType
   * @param tourId
   * @param rateId
   * @example
   */
  getVehiclePriceWithPriority(vehicleType, tourId, rateId) {
    // First try client price (highest priority)
    if (this.clientId) {
      const clientPrices = this.getClientPricesFromCache(tourId, rateId);
      const clientPrice = clientPrices.find((price) => price.vehiclePtr === vehicleType);
      if (clientPrice && clientPrice.price !== undefined) {
        return clientPrice.price;
      }
    }

    // Fallback to tour price
    const tourPrices = this.getTourPricesFromCache(tourId, rateId);
    const tourPrice = tourPrices.find((price) => price.vehicleType === vehicleType);
    if (tourPrice && tourPrice.price !== undefined) {
      return tourPrice.price;
    }

    console.warn('⚠️ No price found for vehicle:', vehicleType);
    return null;
  }

  /**
   * Get vehicle type information from cache.
   * @param vehicleTypeKey
   * @example
   */
  getVehicleTypeInfo(vehicleTypeKey) {
    // Try different possible keys
    return this.vehicleTypesMap.get(vehicleTypeKey)
      || this.vehicleTypesMap.get(vehicleTypeKey?.toLowerCase())
      || this.vehicleTypesMap.get(vehicleTypeKey?.toUpperCase())
      || null;
  }

  /**
   * Check if client has specific price for vehicle.
   * @param vehicleType
   * @param tourId
   * @param rateId
   * @example
   */
  hasClientPrice(vehicleType, tourId, rateId) {
    if (!this.clientId) {
      return false;
    }

    const clientPrices = this.getClientPricesFromCache(tourId, rateId);
    return clientPrices.some((price) => price.vehiclePtr === vehicleType);
  }

  /**
   * Update price field with calculated price.
   * @param price
   * @example
   */
  updatePriceField(price) {
    const servicePriceField = document.getElementById('servicePrice');
    if (!servicePriceField) {
      console.error('❌ Service price field not found');
      return;
    }

    if (price !== null && price !== undefined) {
      servicePriceField.value = price.toFixed(2);
    } else {
      servicePriceField.value = '';
    }

    this.updateServicePriceBreakdown();
  }

  /**
   * Show an itemized price breakdown in the modal based on service type.
   * Applies Moneda/Pago conversion to all displayed amounts.
   */
  updateServicePriceBreakdown() {
    const container = document.getElementById('servicePriceBreakdown');
    const itemsDiv = document.getElementById('breakdownItems');
    const totalSpan = document.getElementById('breakdownTotal');
    if (!container || !itemsDiv || !totalSpan) return;

    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    const items = []; // {label, amountMXN}
    let totalMXN = 0;

    if (serviceType === 'transport') {
      const vehicleSelect = document.getElementById('vehicleSelect');
      const selectedVehicleId = vehicleSelect?.value;
      const quantity = parseInt(document.getElementById('serviceQuantity')?.value || 1);
      let unitPrice = 0;

      if (selectedVehicleId && this.transportPriceData?.vehicles) {
        unitPrice = this.getTransportVehiclePrice(selectedVehicleId) || 0;
      }
      if (unitPrice === 0) {
        unitPrice = this._lastTransportBasePrice || parseFloat(document.getElementById('servicePrice')?.value || 0);
      }

      if (unitPrice > 0) {
        const displayUnit = this.getDisplayPrice(unitPrice);
        items.push({ label: `Vehículo (${quantity} × ${this.formatCurrency(displayUnit)})`, amountMXN: unitPrice * quantity });
      }

      const routeDuration = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;
      if (document.getElementById('includeGuide')?.checked && routeDuration) {
        const guideCost = this.calculateGuideTransportCost(routeDuration);
        items.push({ label: 'Guía + Chofer', amountMXN: guideCost });
      }
      if (document.getElementById('includeGreeter')?.checked && routeDuration) {
        const greeterCost = this.calculateGreeterPrice(routeDuration);
        items.push({ label: 'Greeter', amountMXN: greeterCost });
      }
    } else if (serviceType === 'tour') {
      const adultsQty = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
      const childrenQty = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
      const noAlcoholQty = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value || 0);
      const adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
      const childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
      const noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);

      if (adultsQty > 0 && adultPrice > 0) {
        const displayUnit = this.getDisplayPrice(adultPrice);
        items.push({ label: `Adultos (${adultsQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: adultsQty * adultPrice });
      }
      if (childrenQty > 0 && childPrice > 0) {
        const displayUnit = this.getDisplayPrice(childPrice);
        items.push({ label: `Niños (${childrenQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: childrenQty * childPrice });
      }
      if (noAlcoholQty > 0 && noAlcoholPrice > 0) {
        const displayUnit = this.getDisplayPrice(noAlcoholPrice);
        items.push({ label: `Sin alcohol (${noAlcoholQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: noAlcoholQty * noAlcoholPrice });
      }

      // Vehicle cost
      const vehicleSelect = document.getElementById('vehicleSelect');
      const vehicleQty = parseInt(document.getElementById('serviceQuantity')?.value || 1);
      if (vehicleSelect?.value) {
        const vehicleCost = parseFloat(document.getElementById('servicePrice')?.value || 0);
        if (vehicleCost > 0) {
          const displayUnit = this.getDisplayPrice(vehicleCost);
          items.push({ label: `Vehículo (${vehicleQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: vehicleCost * vehicleQty });
        }
      }

      // Driver tour rate (Guía + Chofer)
      if (document.getElementById('includeGuide')?.checked && this.driverTourRateCache) {
        const driverRate = this.driverTourRateCache.value || 0;
        if (driverRate > 0) {
          items.push({ label: 'Guía + Chofer', amountMXN: driverRate });
        }
      }
    } else if (serviceType === 'experience') {
      const adultsQty = parseInt(document.getElementById('adultsQuantity')?.value || 0);
      const childrenQty = parseInt(document.getElementById('childrenQuantity')?.value || 0);
      const noAlcoholQty = parseInt(document.getElementById('adultsNoAlcoholQuantity')?.value || 0);
      const adultPrice = parseFloat(document.getElementById('adultPrice')?.value || 0);
      const childPrice = parseFloat(document.getElementById('childPrice')?.value || 0);
      const noAlcoholPrice = parseFloat(document.getElementById('noAlcoholPrice')?.value || 0);

      if (adultsQty > 0 && adultPrice > 0) {
        const displayUnit = this.getDisplayPrice(adultPrice);
        items.push({ label: `Adultos (${adultsQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: adultsQty * adultPrice });
      }
      if (childrenQty > 0 && childPrice > 0) {
        const displayUnit = this.getDisplayPrice(childPrice);
        items.push({ label: `Niños (${childrenQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: childrenQty * childPrice });
      }
      if (noAlcoholQty > 0 && noAlcoholPrice > 0) {
        const displayUnit = this.getDisplayPrice(noAlcoholPrice);
        items.push({ label: `Sin alcohol (${noAlcoholQty} × ${this.formatCurrency(displayUnit)})`, amountMXN: noAlcoholQty * noAlcoholPrice });
      }
    } else if (serviceType === 'concepto') {
      const price = parseFloat(document.getElementById('servicePrice')?.value || 0);
      if (price > 0) {
        items.push({ label: 'Precio', amountMXN: price });
      }
    }

    // Calculate total
    totalMXN = items.reduce((sum, item) => sum + item.amountMXN, 0);

    // Hide if no items or total is 0
    if (items.length === 0 || totalMXN <= 0) {
      container.classList.add('d-none');
      return;
    }

    // Render breakdown items
    itemsDiv.innerHTML = items.map((item) => {
      const displayAmt = this.getDisplayPrice(item.amountMXN);
      return `<div class="d-flex justify-content-between"><span class="text-muted">${item.label}</span><span>${this.formatCurrency(displayAmt)}</span></div>`;
    }).join('');

    const displayTotal = this.getDisplayPrice(totalMXN);
    totalSpan.textContent = this.formatCurrency(displayTotal);
    container.classList.remove('d-none');

    // Update price label when conversion is active
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const priceLabel = document.querySelector('label[for="servicePrice"]');
    if (priceLabel) {
      if (currency !== 'MXN' || paymentType !== 'efectivo') {
        priceLabel.innerHTML = 'Precio base <small class="text-muted">(MXN)</small> <span class="text-danger">*</span>';
      } else {
        priceLabel.innerHTML = 'Precio <span class="text-danger">*</span>';
      }
    }
  }

  /**
   * Clear vehicle dropdown.
   * @example
   */
  clearVehicleDropdown() {
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
  }

  // =================
  // TRANSPORT PRICE LOOKUP
  // =================

  /**
   * Handle rate (Segmento) selection for transport services.
   * Looks up vehicle prices for the selected origin + destination + rate combination.
   */
  async handleTransportRateSelection(rateId, fallbackOrigin = null, fallbackDestination = null) {
    if (!rateId) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // Get origin and destination from the appropriate fields based on direction
    const directionRadio = document.querySelector('input[name="directionType"]:checked');
    const direction = directionRadio?.value || 'arrival';
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;

    let originName = '';
    let destinationName = '';

    if (direction === 'departure' && transportType === 'aeropuerto') {
      // Departure + Aeropuerto: origin COMBO (local place), destination SELECT (airport)
      originName = document.getElementById('transportOriginCombo')?.value || '';
      const destSelect = document.getElementById('transportDestinationSelect');
      const destSlug = destSelect?.value;
      destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
    } else if (direction === 'arrival') {
      const originSelect = document.getElementById('transportOriginSelect');
      const slug = originSelect?.value;
      originName = window.slugToOriginalMapping?.get(slug) || slug || '';
      destinationName = document.getElementById('transportDestinationCombo')?.value || '';
    } else {
      originName = document.getElementById('transportOriginText')?.value || '';
      destinationName = document.getElementById('transportDestinationCombo')?.value || '';
    }

    // Use fallbacks from service data if form fields are empty (edit race condition)
    if (!originName && fallbackOrigin) originName = fallbackOrigin;
    if (!destinationName && fallbackDestination) destinationName = fallbackDestination;

    if (!originName || !destinationName) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // For departure + aeropuerto: swap origin/destination for API query
    // DB stores routes as airport(origin)→hotel(destination)
    // User selected: origin=hotel/city, destination=airport
    // So swap to match DB: apiOrigin=airport(destination), apiDestination=hotel(origin)
    let apiOrigin = originName;
    let apiDestination = destinationName;
    if (direction === 'departure' && transportType === 'aeropuerto') {
      apiOrigin = destinationName;
      apiDestination = originName;
    }

    // Show loading spinner next to Vehículo label
    const vehicleSpinner = document.getElementById('vehicleLoadingSpinner');
    vehicleSpinner?.classList.remove('d-none');

    try {
      const params = new URLSearchParams({
        originPOI: apiOrigin,
        destinationPOI: apiDestination,
        rateId,
      });
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

  /**
   * Populate vehicle dropdown with transport route price data.
   */
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

  /**
   * Get transport vehicle price from cached route price data.
   */
  getTransportVehiclePrice(vehicleTypeId) {
    if (!this.transportPriceData || !this.transportPriceData.vehicles) {
      return null;
    }

    const vehicle = this.transportPriceData.vehicles.find(
      (v) => v.vehicleTypeId === vehicleTypeId
    );

    return vehicle ? vehicle.finalPrice : null;
  }

  /**
   * Calculate guide cost for transport: durationHours * 2 * guideRate.
   * The * 2 accounts for round trip (outbound + return).
   * @param {number} durationMinutes - Route duration in minutes.
   * @returns {number} Guide cost.
   */
  calculateGuideTransportCost(durationMinutes) {
    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return 0;
    const guideRate = this.guideTransportRateCache?.value || 400;
    return durationHours * 2 * guideRate;
  }

  /**
   * Calculate greeter price based on route duration.
   * Formula: 760 + (640 * durationHours) with special rounding.
   * @param {number} durationMinutes - Route duration in minutes.
   * @returns {number} Greeter price.
   */
  calculateGreeterPrice(durationMinutes) {
    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return 760;

    const rawPrice = 760 + (640 * durationHours);
    const integerPart = Math.floor(rawPrice);
    const lastTwoDigits = integerPart % 100;

    if (lastTwoDigits === 0) return integerPart;
    if (lastTwoDigits < 50) return Math.floor(integerPart / 100) * 100;
    return Math.ceil(integerPart / 100) * 100;
  }

  /**
   * Recalculate transport price including vehicle base + Guía/Greeter surcharges.
   */
  recalculateTransportPrice() {
    const vehicleSelect = document.getElementById('vehicleSelect');
    const selectedVehicleId = vehicleSelect?.value;
    let basePrice = 0;

    // Try to get vehicle base price from cached API data
    if (selectedVehicleId && this.transportPriceData?.vehicles) {
      basePrice = this.getTransportVehiclePrice(selectedVehicleId) || 0;
    }

    // Fallback: if no cached data, read current price field (which has the vehicle price)
    if (basePrice === 0 && selectedVehicleId) {
      if (!this._lastTransportBasePrice) {
        const currentPrice = parseFloat(document.getElementById('servicePrice')?.value || 0);
        basePrice = currentPrice;
      } else {
        basePrice = this._lastTransportBasePrice;
      }
    }

    // Cache the base price for later use
    if (basePrice > 0 && this.transportPriceData?.vehicles) {
      this._lastTransportBasePrice = basePrice;
    }

    // Multiply vehicle price by quantity (number of vehicles)
    const quantity = parseInt(document.getElementById('serviceQuantity')?.value || 1);
    let totalPrice = basePrice * quantity;

    // Get routeDuration from multiple sources
    const routeDuration = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;

    const includeGuide = document.getElementById('includeGuide')?.checked;
    const includeGreeter = document.getElementById('includeGreeter')?.checked;

    // Add Guía (Traslados) — once per trip, not per vehicle
    if (includeGuide && routeDuration) {
      totalPrice += this.calculateGuideTransportCost(routeDuration);
    }

    // Add Greeter — once per trip, not per vehicle
    if (includeGreeter && routeDuration) {
      totalPrice += this.calculateGreeterPrice(routeDuration);
    }

    console.log('🔧 Final transport price:', totalPrice);
    this.updatePriceField(totalPrice);

    // Update breakdown after transport price recalculation
    this.updateServicePriceBreakdown();
  }

  handleTourSelection(tourId) {
    if (!tourId) {
      // Clear all price fields and details when no tour is selected
      const servicePriceField = document.getElementById('servicePrice');
      const adultPriceField = document.getElementById('tourAdultPrice');
      const childPriceField = document.getElementById('tourChildPrice');
      const noAlcoholPriceField = document.getElementById('tourNoAlcoholPrice');

      // Clear passenger quantity fields
      const tourAdultsQuantityField = document.getElementById('tourAdultsQuantity');
      const tourChildrenQuantityField = document.getElementById('tourChildrenQuantity');
      const tourAdultsNoAlcoholQuantityField = document.getElementById('tourAdultsNoAlcoholQuantity');

      if (servicePriceField) servicePriceField.value = 0;

      // Clear and show all price and quantity fields when no tour is selected
      if (adultPriceField) {
        adultPriceField.value = '';
        const adultPriceContainer = adultPriceField.closest('.col-md-4');
        if (adultPriceContainer) adultPriceContainer.style.display = 'block';
      }
      if (tourAdultsQuantityField) {
        tourAdultsQuantityField.value = 0;
        const adultQuantityContainer = tourAdultsQuantityField.closest('.col-md-4');
        if (adultQuantityContainer) adultQuantityContainer.style.display = 'block';
      }

      if (childPriceField) {
        childPriceField.value = '';
        const childPriceContainer = childPriceField.closest('.col-md-4');
        if (childPriceContainer) childPriceContainer.style.display = 'block';
      }
      if (tourChildrenQuantityField) {
        tourChildrenQuantityField.value = 0;
        const childQuantityContainer = tourChildrenQuantityField.closest('.col-md-4');
        if (childQuantityContainer) childQuantityContainer.style.display = 'block';
      }

      if (noAlcoholPriceField) {
        noAlcoholPriceField.value = '';
        const noAlcoholPriceContainer = noAlcoholPriceField.closest('.col-md-4');
        if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'block';
      }
      if (tourAdultsNoAlcoholQuantityField) {
        tourAdultsNoAlcoholQuantityField.value = 0;
        const noAlcoholQuantityContainer = tourAdultsNoAlcoholQuantityField.closest('.col-md-4');
        if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'block';
      }

      this.clearTourDetails();
      this.clearTourSchedule();

      // Also hide the tour details info box
      const tourDetails = document.getElementById('tourDetails');
      if (tourDetails) {
        tourDetails.style.display = 'none';
        tourDetails.innerHTML = '';
      }
      return;
    }

    try {
      // Find the selected tour from cache
      let selectedTour = null;

      if (this.toursCache.has('all')) {
        const tours = this.toursCache.get('all');
        selectedTour = tours.find((tour) => tour.id === tourId || tour.objectId === tourId);
      }

      if (selectedTour) {
        // Get client-specific tour price or use base price
        const price = this.getPriceForTour(tourId, null) || selectedTour.price || 0;

        // Auto-fill form fields
        const servicePriceField = document.getElementById('servicePrice');
        const serviceDescriptionField = document.getElementById('serviceDescription');
        const internalNotesField = document.getElementById('internalNotes');
        const clientNotesField = document.getElementById('clientNotes');
        const providerNotesField = document.getElementById('providerNotes');
        const teamNotesField = document.getElementById('teamNotes');

        // Tour-specific readonly fields
        const tourDescriptionField = document.getElementById('tourDescription');
        const tourAdvanceBookingTimeField = document.getElementById('tourAdvanceBookingTime');
        const tourLanguagesField = document.getElementById('tourLanguages');
        const tourIncludesField = document.getElementById('tourIncludes');
        const tourNotIncludesField = document.getElementById('tourNotIncludes');
        const tourClientNotesField = document.getElementById('tourClientNotes');

        // Fill price fields - for tours, set to 0 initially (vehicle cost will be added when vehicle is selected)
        if (servicePriceField) {
          servicePriceField.value = 0; // Tours should show 0 until a vehicle is selected
        }

        // Fill adult, child, and no-alcohol prices - use TOUR-specific fields
        const tourAdultPriceField = document.getElementById('tourAdultPrice');
        const tourChildPriceField = document.getElementById('tourChildPrice');
        const tourNoAlcoholPriceField = document.getElementById('tourNoAlcoholPrice');

        // Get quantity fields as well
        const tourAdultsQuantityField = document.getElementById('tourAdultsQuantity');
        const tourChildrenQuantityField = document.getElementById('tourChildrenQuantity');
        const tourAdultsNoAlcoholQuantityField = document.getElementById('tourAdultsNoAlcoholQuantity');

        // Adult Price Field and Quantity
        if (tourAdultPriceField) {
          const adultPriceValue = selectedTour.price || price || 0;
          const adultPriceContainer = tourAdultPriceField.closest('.col-md-4');
          const adultQuantityContainer = tourAdultsQuantityField?.closest('.col-md-4');

          if (adultPriceValue && adultPriceValue > 0) {
            tourAdultPriceField.value = adultPriceValue;
            if (adultPriceContainer) adultPriceContainer.style.display = 'block';
            if (adultQuantityContainer) adultQuantityContainer.style.display = 'block';
          } else {
            tourAdultPriceField.value = '';
            if (adultPriceContainer) adultPriceContainer.style.display = 'none';
            if (adultQuantityContainer) adultQuantityContainer.style.display = 'none';
            if (tourAdultsQuantityField) tourAdultsQuantityField.value = 0;
          }
        }

        // Child Price Field and Quantity
        if (tourChildPriceField) {
          const childPriceValue = selectedTour.price_child || 0;
          const childPriceContainer = tourChildPriceField.closest('.col-md-4');
          const childQuantityContainer = tourChildrenQuantityField?.closest('.col-md-4');

          if (childPriceValue && childPriceValue > 0) {
            tourChildPriceField.value = childPriceValue;
            if (childPriceContainer) childPriceContainer.style.display = 'block';
            if (childQuantityContainer) childQuantityContainer.style.display = 'block';
          } else {
            tourChildPriceField.value = '';
            if (childPriceContainer) childPriceContainer.style.display = 'none';
            if (childQuantityContainer) childQuantityContainer.style.display = 'none';
            if (tourChildrenQuantityField) tourChildrenQuantityField.value = 0;
          }
        }

        // No Alcohol Price Field and Quantity
        if (tourNoAlcoholPriceField) {
          const noAlcoholPriceValue = selectedTour.price_no_alcohol || 0;
          const noAlcoholPriceContainer = tourNoAlcoholPriceField.closest('.col-md-4');
          const noAlcoholQuantityContainer = tourAdultsNoAlcoholQuantityField?.closest('.col-md-4');

          if (noAlcoholPriceValue && noAlcoholPriceValue > 0) {
            tourNoAlcoholPriceField.value = noAlcoholPriceValue;
            if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'block';
            if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'block';
          } else {
            tourNoAlcoholPriceField.value = '';
            if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'none';
            if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'none';
            if (tourAdultsNoAlcoholQuantityField) tourAdultsNoAlcoholQuantityField.value = 0;
          }
        }

        // Fill passenger quantity fields with default values (only for new services)
        if (!this.currentServiceId) {
          // Only set default for adults if the field is visible
          if (tourAdultsQuantityField && tourAdultsQuantityField.closest('.col-md-4').style.display !== 'none') {
            tourAdultsQuantityField.value = 0; // Default 0 adults
          }
          // Children and no alcohol fields are already set to 0 when hidden
        } else {
          // When editing existing service, override with saved price values if they exist
          const existingService = this.services.get(this.currentServiceId);
          if (existingService) {
            // Override adult price with saved value
            if (tourAdultPriceField && existingService.adultPrice !== undefined) {
              const savedAdultPrice = existingService.adultPrice;
              const adultPriceContainer = tourAdultPriceField.closest('.col-md-4');
              const adultQuantityContainer = tourAdultsQuantityField?.closest('.col-md-4');

              if (savedAdultPrice && savedAdultPrice > 0) {
                tourAdultPriceField.value = savedAdultPrice;
                if (adultPriceContainer) adultPriceContainer.style.display = 'block';
                if (adultQuantityContainer) adultQuantityContainer.style.display = 'block';
              } else {
                tourAdultPriceField.value = '';
                if (adultPriceContainer) adultPriceContainer.style.display = 'none';
                if (adultQuantityContainer) adultQuantityContainer.style.display = 'none';
              }
            }

            // Override child price with saved value
            if (tourChildPriceField && existingService.childPrice !== undefined) {
              const savedChildPrice = existingService.childPrice;
              const childPriceContainer = tourChildPriceField.closest('.col-md-4');
              const childQuantityContainer = tourChildrenQuantityField?.closest('.col-md-4');

              if (savedChildPrice && savedChildPrice > 0) {
                tourChildPriceField.value = savedChildPrice;
                if (childPriceContainer) childPriceContainer.style.display = 'block';
                if (childQuantityContainer) childQuantityContainer.style.display = 'block';
              } else {
                tourChildPriceField.value = '';
                if (childPriceContainer) childPriceContainer.style.display = 'none';
                if (childQuantityContainer) childQuantityContainer.style.display = 'none';
              }
            }

            // Override no alcohol price with saved value
            if (tourNoAlcoholPriceField && existingService.noAlcoholPrice !== undefined) {
              const savedNoAlcoholPrice = existingService.noAlcoholPrice;
              const noAlcoholPriceContainer = tourNoAlcoholPriceField.closest('.col-md-4');
              const noAlcoholQuantityContainer = tourAdultsNoAlcoholQuantityField?.closest('.col-md-4');

              if (savedNoAlcoholPrice && savedNoAlcoholPrice > 0) {
                tourNoAlcoholPriceField.value = savedNoAlcoholPrice;
                if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'block';
                if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'block';
              } else {
                tourNoAlcoholPriceField.value = '';
                if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'none';
                if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'none';
              }
            }
          }
        }

        // Fill main description from tour (editable field)
        if (serviceDescriptionField && selectedTour.description) {
          serviceDescriptionField.value = selectedTour.description;
        }

        // Fill tour-specific readonly fields
        if (tourDescriptionField) {
          tourDescriptionField.value = selectedTour.description || '';
        }

        if (tourAdvanceBookingTimeField) {
          const bookingTime = selectedTour.advance_booking_time || '';
          tourAdvanceBookingTimeField.value = bookingTime ? `${bookingTime} horas` : 'No especificado';
        }

        if (tourLanguagesField) {
          const { languages } = selectedTour;
          if (Array.isArray(languages)) {
            tourLanguagesField.value = languages.join(', ');
          } else {
            tourLanguagesField.value = languages || 'No especificado';
          }
        }

        if (tourIncludesField) {
          tourIncludesField.value = selectedTour.includes || '';
        }

        if (tourNotIncludesField) {
          tourNotIncludesField.value = selectedTour.notincludes || '';
        }

        if (tourClientNotesField) {
          tourClientNotesField.value = selectedTour.client_booking_notes || '';
        }

        // Fill editable notes fields
        if (internalNotesField && selectedTour.internal_notes) {
          internalNotesField.value = selectedTour.internal_notes;
        }

        if (clientNotesField && selectedTour.client_booking_notes) {
          clientNotesField.value = selectedTour.client_booking_notes;
        }

        if (providerNotesField && selectedTour.provider_notes) {
          providerNotesField.value = selectedTour.provider_notes;
        }

        if (teamNotesField && selectedTour.team_notes) {
          teamNotesField.value = selectedTour.team_notes;
        }

        // Show tour details
        this.showTourDetails(selectedTour);

        // Handle tour schedule/availability
        this.handleTourSchedule(selectedTour);

        // Update breakdown after all tour fields are populated
        this.updateServicePriceBreakdown();
      } else {
        console.warn('Tour not found in cache:', tourId);
        document.getElementById('servicePrice').value = 0;
        this.clearTourDetails();
        this.clearTourSchedule();
      }
    } catch (error) {
      console.error('Error handling tour selection:', error);
      document.getElementById('servicePrice').value = 0;
      this.clearTourDetails();
      this.clearTourSchedule();
    }
  }

  showExperienceDetails(experience) {
    // Show COMPREHENSIVE experience details including ALL pricing, languages, includes/excludes for review
    const detailsContainer = document.getElementById('experienceDetails');
    if (detailsContainer) {
      const devIndicator = (window.location.hostname === 'localhost' || window.location.hostname.includes('dev'))
        ? `<span class="badge bg-secondary ms-2">${experience.type === 'provider_experience' ? 'ProvExp' : 'Exp'}</span>`
        : '';

      // Iterate through ALL object properties to capture EVERYTHING
      const allFields = [];

      Object.keys(experience).forEach((key) => {
        const value = experience[key];

        // Show EVERYTHING including empty/null fields (except Parse internals)
        if (!['__type', 'className'].includes(key)) {
          // Format field name for display
          const displayKey = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (str) => str.toUpperCase())
            .replace(/Id$/, ' ID')
            .replace(/Url$/, ' URL')
            .replace(/Api$/, ' API');

          // Handle ALL value types including empty/null
          let displayValue = value;
          let fieldClass = '';

          if (value === null) {
            displayValue = '<span class="text-muted">🔴 NULL</span>';
            fieldClass = 'text-muted';
          } else if (value === undefined) {
            displayValue = '<span class="text-muted">🟡 UNDEFINED</span>';
            fieldClass = 'text-muted';
          } else if (value === '') {
            displayValue = '<span class="text-muted">⚪ EMPTY STRING</span>';
            fieldClass = 'text-muted';
          } else if (typeof value === 'object' && value !== null) {
            if (value.objectId) {
              // Parse Pointer object
              displayValue = `🔗 ${value.objectId}`;
              if (value.name) displayValue += ` (${value.name})`;
              if (value.title) displayValue += ` (${value.title})`;
              fieldClass = 'text-info';
            } else if (value.iso) {
              // Parse Date object
              displayValue = `📅 ${new Date(value.iso).toLocaleString()}`;
              fieldClass = 'text-primary';
            } else if (Array.isArray(value)) {
              if (value.length === 0) {
                displayValue = '<span class="text-muted">📝 EMPTY ARRAY []</span>';
                fieldClass = 'text-muted';
              } else {
                // Handle array of objects properly
                const arrayItems = value.map((item) => {
                  if (typeof item === 'object' && item !== null) {
                    if (item.objectId) {
                      // Parse Pointer in array
                      return `${item.objectId}${item.name ? ` (${item.name})` : ''}`;
                    }
                    // Generic object in array - show key properties
                    const keys = Object.keys(item);
                    if (keys.length <= 3) {
                      return JSON.stringify(item);
                    }
                    // Show first few properties for readability
                    const preview = {};
                    keys.slice(0, 3).forEach((k) => preview[k] = item[k]);
                    return `${JSON.stringify(preview)}...`;
                  }
                  return String(item);
                });
                displayValue = `📋 [${arrayItems.join(', ')}]`;
                fieldClass = 'text-success';
              }
            } else {
              // Generic object - show as formatted JSON for complete visibility
              displayValue = `<pre class="mb-0" style="font-size: 0.8em; max-height: 100px; overflow-y: auto; background-color: #f1f3f4;">${JSON.stringify(value, null, 2)}</pre>`;
            }
          } else if (typeof value === 'boolean') {
            displayValue = value ? '✅ TRUE' : '❌ FALSE';
            fieldClass = value ? 'text-success' : 'text-danger';
          } else if (typeof value === 'number') {
            // Format ALL potential price/currency fields
            if (key.toLowerCase().includes('price')
              || key.toLowerCase().includes('cost')
              || key.toLowerCase().includes('rate')
              || key.toLowerCase().includes('tarifa')
              || key.toLowerCase().includes('precio')
              || key.toLowerCase().includes('fee')
              || key.toLowerCase().includes('commission')) {
              displayValue = `💰 $${value.toLocaleString()}`;
              fieldClass = 'text-success fw-bold';
            } else {
              displayValue = `🔢 ${value.toLocaleString()}`;
              fieldClass = 'text-info';
            }
          } else if (typeof value === 'string') {
            if (value.trim() === '') {
              displayValue = '<span class="text-muted">⚪ EMPTY STRING (whitespace only)</span>';
              fieldClass = 'text-muted';
            } else if (value.length > 150) {
              // Handle long text fields with expansion capability
              displayValue = `📄 <span class="expandable-text">${value.substring(0, 150)}... <button class="btn btn-sm btn-link p-0" onclick="this.previousElementSibling.textContent='${value.replace(/'/g, "\\'")}'; this.remove();">show more</button></span>`;
            } else {
              displayValue = `📝 ${value}`;
            }
          }

          allFields.push({
            key,
            display: `<div class="${fieldClass}"><strong>${displayKey}:</strong> ${displayValue}</div>`,
            priority: this.getFieldPriority(key),
            isEmpty: value === null || value === undefined || value === '',
          });
        }
      });

      // Sort fields by priority for better organization
      allFields.sort((a, b) => a.priority - b.priority);

      if (allFields.length === 0) {
        allFields.push({ display: '<small class="text-muted">No details available</small>', priority: 999 });
      }

      // Count field types for comprehensive analysis
      const fieldStats = {
        total: allFields.length,
        withData: allFields.filter((f) => !f.isEmpty).length,
        empty: allFields.filter((f) => f.isEmpty).length,
        pricing: allFields.filter((f) => f.key.toLowerCase().includes('price') || f.key.toLowerCase().includes('precio') || f.key.toLowerCase().includes('cost')).length,
      };

      detailsContainer.innerHTML = `
                <div class="alert alert-warning border-warning">
                    <h6><i class="ti ti-database"></i> ${experience.title || experience.name || 'Experience'} ${devIndicator}</h6>
                    <div class="text-warning-emphasis mb-2">
                        <small><strong>Experience Details</strong> (${fieldStats.total} fields)</small>
                    </div>
                    <div class="row">
                        <div class="col-12" style="max-height: 500px; overflow-y: auto; border: 2px solid #ffc107; border-radius: 0.375rem; padding: 0.75rem; background-color: #fffbf0;">
                            ${allFields.map((field) => `<div class="mb-1"><small>${field.display}</small></div>`).join('')}
                        </div>
                    </div>
                </div>
            `;
    }
  }

  getFieldPriority(key) {
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
  }

  showTourDetails(tour) {
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
                            <small class="text-muted d-block"><strong>Incluye:</strong> ${includes}</small>
                        </div>
                        ` : ''}
                        ${notIncludes ? `
                        <div class="mt-1">
                            <small class="text-muted d-block"><strong>No incluye:</strong> ${notIncludes}</small>
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
  }

  clearExperienceDetails() {
    const detailsContainer = document.getElementById('experienceDetails');
    if (detailsContainer) {
      detailsContainer.innerHTML = '';
    }
  }

  handleTourSchedule(tour) {
    // Get the current day context using existing method
    const dayContext = this.getCurrentDayContext();

    // Deep inspection for Atotonilco tour
    if (tour.destinationPOI?.name === 'Atotonilco') {
    }

    const singleTimeField = document.getElementById('tourSingleTime');
    const multipleTimeField = document.getElementById('tourMultipleTime');
    const availabilityStatusDiv = document.getElementById('tourAvailabilityStatus');
    const availabilityMessageSpan = document.getElementById('tourAvailabilityMessage');

    // Hide all schedule elements initially (use setProperty to override !important)
    if (singleTimeField) singleTimeField.style.setProperty('display', 'none', 'important');
    if (multipleTimeField) multipleTimeField.style.display = 'none';
    if (availabilityStatusDiv) availabilityStatusDiv.style.display = 'none';

    const currentDayOfWeek = dayContext?.dayOfWeek;

    // Always show the availability status div since we always have something to display
    let scheduleDisplayed = false;

    // Check if tour has specific times
    if (tour.startTime && tour.endTime) {
      // Single fixed time
      const startTime = this.formatTime(tour.startTime);
      const endTime = this.formatTime(tour.endTime);
      const timeRange = `${startTime} - ${endTime}`;

      if (singleTimeField) {
        singleTimeField.value = timeRange;
        // Remove !important by setting via setAttribute
        singleTimeField.style.setProperty('display', 'block', 'important');

        scheduleDisplayed = true;
      }
    } else if (tour.availability && typeof tour.availability === 'object') {
      // Handle availability array - extract schedules for current day

      if (Array.isArray(tour.availability) && currentDayOfWeek !== null) {
        const timeOptions = this.extractTimeOptionsForDay(tour.availability, currentDayOfWeek);

        if (timeOptions.length > 0 && multipleTimeField) {
          // Clear existing options
          multipleTimeField.innerHTML = '<option value="">-- Selecciona un horario --</option>';

          // Add time options
          timeOptions.forEach((timeOption, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = timeOption.label;
            option.dataset.timeData = JSON.stringify(timeOption.data);
            multipleTimeField.appendChild(option);
          });

          multipleTimeField.style.display = 'block';

          scheduleDisplayed = true;
        } else {
          // No specific times found, show generic availability message
          if (availabilityStatusDiv && availabilityMessageSpan) {
            availabilityMessageSpan.textContent = 'Horario según disponibilidad';
            availabilityStatusDiv.style.display = 'block';
            scheduleDisplayed = true;
          }
        }
      } else if (tour.availability.times && Array.isArray(tour.availability.times)) {
        // Availability object with times array
        if (multipleTimeField) {
          multipleTimeField.innerHTML = '<option value="">-- Selecciona un horario --</option>';
          tour.availability.times.forEach((time, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = time;
            multipleTimeField.appendChild(option);
          });
          multipleTimeField.style.display = 'block';

          scheduleDisplayed = true;
        }
      } else {
        // Show availability status message
        if (availabilityStatusDiv && availabilityMessageSpan) {
          availabilityMessageSpan.textContent = 'Horario según disponibilidad';
          availabilityStatusDiv.style.display = 'block';
          scheduleDisplayed = true;
        }
      }
    } else if (tour.time) {
      // If tour has duration but no specific schedule, just show availability message
      if (availabilityStatusDiv && availabilityMessageSpan) {
        availabilityMessageSpan.textContent = 'Horario según disponibilidad';
        availabilityStatusDiv.style.display = 'block';
        scheduleDisplayed = true;
      }
    }

    // Always show at least a default message if nothing else was shown
    if (!scheduleDisplayed) {
      // Default availability message
      if (availabilityStatusDiv && availabilityMessageSpan) {
        availabilityMessageSpan.textContent = 'Horario flexible - coordinar con el proveedor';
        availabilityStatusDiv.style.display = 'block';
      }
    }
  }

  clearTourSchedule() {
    // Clear tour-specific schedule fields
    const tourSingleTime = document.getElementById('tourSingleTime');
    const tourMultipleTime = document.getElementById('tourMultipleTime');
    const tourAvailabilityStatus = document.getElementById('tourAvailabilityStatus');

    if (tourSingleTime) {
      tourSingleTime.value = '';
      tourSingleTime.style.setProperty('display', 'none', 'important');
    }

    if (tourMultipleTime) {
      tourMultipleTime.innerHTML = '<option value="">-- Selecciona un horario --</option>';
      tourMultipleTime.style.display = 'none';
    }

    if (tourAvailabilityStatus) {
      tourAvailabilityStatus.style.display = 'none';
    }

    // Also clear shared schedule fields if they exist
    const scheduleSelect = document.getElementById('scheduleSelect');
    if (scheduleSelect) {
      scheduleSelect.innerHTML = '<option value="">-- Selecciona un horario --</option>';
      scheduleSelect.disabled = true;
    }

    // Clear time input fields
    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');

    if (startTimeInput) {
      startTimeInput.value = '';
      startTimeInput.disabled = false;
    }

    if (endTimeInput) {
      endTimeInput.value = '';
      endTimeInput.disabled = false;
    }
  }

  clearExperienceSchedule() {
    // Clear experience-specific schedule fields
    const experienceSingleTime = document.getElementById('experienceSingleTime');
    const experienceMultipleTime = document.getElementById('experienceMultipleTime');
    const experienceAvailabilityStatus = document.getElementById('experienceAvailabilityStatus');

    if (experienceSingleTime) {
      experienceSingleTime.value = '';
      experienceSingleTime.style.display = 'none';
    }

    if (experienceMultipleTime) {
      experienceMultipleTime.innerHTML = '<option value="">-- Selecciona un horario --</option>';
      experienceMultipleTime.style.display = 'none';
    }

    if (experienceAvailabilityStatus) {
      experienceAvailabilityStatus.style.display = 'none';
    }

    // Clear shared schedule/time fields
    const scheduleSelect = document.getElementById('scheduleSelect');
    if (scheduleSelect) {
      scheduleSelect.innerHTML = '<option value="">-- Selecciona un horario --</option>';
      scheduleSelect.disabled = true;
    }

    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');

    if (startTime) {
      startTime.value = '';
      startTime.disabled = false;
    }

    if (endTime) {
      endTime.value = '';
      endTime.disabled = false;
    }
  }

  clearTourDetails() {
    const detailsContainer = document.getElementById('tourDetails');
    if (detailsContainer) {
      detailsContainer.innerHTML = '';
    }

    // Clear tour-specific readonly fields
    const tourFieldIds = [
      'tourDescription',
      'tourAdvanceBookingTime',
      'tourLanguages',
      'tourIncludes',
      'tourNotIncludes',
      'tourClientNotes',
    ];

    tourFieldIds.forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.value = '';
      }
    });
  }

  getPriceForService(serviceId, rateId) {
    // Check if client-specific price exists first
    if (this.clientPricesCache.has(serviceId)) {
      const clientPrices = this.clientPricesCache.get(serviceId);
      const clientPrice = clientPrices.find((price) => price.rate.id === rateId);
      if (clientPrice) {
        return clientPrice.finalPrice;
      }
    }

    // Fallback to base RatePrice
    // This would need to be implemented based on your RatePrices structure

    return 0; // TODO: Implement base rate price lookup
  }

  getPriceForTour(tourId, rateId) {
    // Check if client-specific tour price exists first
    if (this.clientTourPricesCache.has(tourId)) {
      const clientTourPrices = this.clientTourPricesCache.get(tourId);
      const clientPrice = clientTourPrices.find((price) => price.rate.id === rateId);
      if (clientPrice) {
        return clientPrice.finalPrice;
      }
    }

    // Fallback to base TourPrice
    // This would need to be implemented based on your TourPrices structure

    return 0; // TODO: Implement base tour price lookup
  }

  async loadDayExperiences(dayId) {
    const experienceSelect = document.getElementById('experienceSelect');
    if (!experienceSelect) {
      return;
    }

    // Clear existing options except the first placeholder
    experienceSelect.innerHTML = '<option value="">-- Selecciona una experiencia --</option>';

    try {
      // Get the day information to check availability
      const dayInfo = this.days.find((d) => d.id === dayId);
      let dayOfWeek = null;
      let dayDate = null;

      if (dayInfo && dayInfo.date) {
        dayDate = new Date(dayInfo.date);
        dayOfWeek = dayDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      } else {

      }

      const allExperiences = [];

      // Add experiences from Experience table (only type === "Experience", not "Provider")
      if (this.experiencesCache.has('all')) {
        const experiences = this.experiencesCache.get('all');

        if (Array.isArray(experiences)) {
          experiences.forEach((exp, index) => {
            // Try different property names that might exist
            const id = exp.id || exp.objectId || exp._id;
            const title = exp.title || exp.name || exp.experienceName;

            // Only include experiences (exclude providers)
            const isExperience = exp.type === 'Experience';

            // Check availability for the selected day
            const isAvailableOnDay = this.isExperienceAvailableOnDay(exp, dayOfWeek, dayDate);

            if (id && title && isExperience && isAvailableOnDay) {
              allExperiences.push({
                id,
                title,
                type: 'experience',
                provider: exp.provider || null,
                description: exp.description || '',
                duration: exp.duration || '',
                location: exp.location || '',
                price: exp.price || 0,
              });
            }
          });
        }
      }

      // Add provider experiences from ProviderExperiencia table
      if (this.providerExperiencesCache && Array.isArray(this.providerExperiencesCache)) {
        const validProviderExperiences = this.providerExperiencesCache.filter((exp) => {
          const hasId = exp && (exp.id || exp.objectId);
          const hasTitle = exp && (exp.title || exp.name || exp.experienceName);

          // Check if provider experience is active and has valid provider pointer
          const isActive = exp.active !== false; // Default to true if not specified
          const hasValidProvider = exp.provider
            && exp.provider.active !== false
            && exp.provider.exists !== false;

          // Check availability for the selected day
          const isAvailableOnDay = this.isExperienceAvailableOnDay(exp, dayOfWeek, dayDate);

          return hasId && hasTitle && isActive && hasValidProvider && isAvailableOnDay;
        });
        const mappedProviderExperiences = validProviderExperiences.map((provExp) => ({
          id: provExp.id || provExp.objectId,
          title: provExp.title || provExp.name || provExp.experienceName,
          type: 'provider_experience',
          provider: provExp.provider || null,
          description: provExp.description || '',
          duration: provExp.duration || '',
          location: provExp.location || '',
          price: provExp.price || 0,
        }));

        allExperiences.push(...mappedProviderExperiences);
      }

      // Sort experiences alphabetically by title
      allExperiences.sort((a, b) => a.title.localeCompare(b.title));

      // Add all experiences directly without provider grouping
      allExperiences.forEach((exp) => {
        // Debug availability structure for Testing experience
        if (exp.title === 'Testing' || exp.name === 'Testing') {
        }

        const option = document.createElement('option');
        option.value = exp.id;

        // Only show provider name for regular experiences, not provider experiences
        let displayTitle;
        if (exp.type === 'provider_experience') {
          // Provider experiences: show only the title (no provider name)
          displayTitle = exp.title;

          // Add development environment indicator
          if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev')) {
            displayTitle += ' [ProvExp]';
          }
        } else {
          // Regular experiences: show provider name if available
          displayTitle = exp.provider?.name
            ? `${exp.title} (${exp.provider.name})`
            : exp.title;

          // Add development environment indicator
          if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev')) {
            displayTitle += ' [Exp]';
          }
        }

        option.textContent = displayTitle;
        option.dataset.type = exp.type;
        option.dataset.providerId = exp.provider?.id || '';
        option.dataset.providerName = exp.provider?.name || '';
        experienceSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading experiences into dropdown:', error);
      this.showModalAlert('serviceModalAlert', 'Error cargando experiencias', 'warning');
    }
  }

  isExperienceAvailableOnDay(experience, dayOfWeek, dayDate) {
    // If no day info provided, default to available (show all)
    if (dayOfWeek === null || dayDate === null) {
      return true;
    }

    // Check if availability is stored as a string with Spanish abbreviations (e.g., "Sa, Vi, Ju, Mi")
    if (typeof experience.availability === 'string' || typeof experience.availableDays === 'string') {
      const availabilityString = experience.availability || experience.availableDays;
      const isAvailable = this.parseSpanishDayAbbreviations(availabilityString, dayOfWeek);

      return isAvailable;
    }

    // Check availableDays array (common format: [0,1,2,3,4,5,6] where 0=Sunday)
    if (Array.isArray(experience.availableDays)) {
      const isAvailable = experience.availableDays.includes(dayOfWeek);

      return isAvailable;
    }

    // Check availability object
    if (experience.availability && typeof experience.availability === 'object') {
      // Handle array of availability objects (common format)
      if (Array.isArray(experience.availability)) {
        const isAvailable = this.checkAvailabilityArray(experience.availability, dayOfWeek);

        return isAvailable;
      }

      // Handle different availability structures
      if (experience.availability.days && Array.isArray(experience.availability.days)) {
        const isAvailable = experience.availability.days.includes(dayOfWeek);

        return isAvailable;
      }

      // Check for day-specific availability (Monday, Tuesday, etc.)
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const dayName = dayNames[dayOfWeek];
      const dayNameEs = dayNamesEs[dayOfWeek];

      if (experience.availability[dayName] !== undefined) {
        const isAvailable = experience.availability[dayName];

        return isAvailable;
      }

      if (experience.availability[dayNameEs] !== undefined) {
        const isAvailable = experience.availability[dayNameEs];

        return isAvailable;
      }

      // Check for daily schedule (if experience has times for this day)
      if (experience.availability.schedule && typeof experience.availability.schedule === 'object') {
        const hasScheduleForDay = experience.availability.schedule[dayName]
          || experience.availability.schedule[dayNameEs]
          || experience.availability.schedule[dayOfWeek];
        if (hasScheduleForDay !== undefined) {
          const isAvailable = hasScheduleForDay !== null && hasScheduleForDay !== false;

          return isAvailable;
        }
      }
    }

    // Check specific day fields (monday, tuesday, etc.)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    if (experience[dayName] !== undefined) {
      const isAvailable = experience[dayName];

      return isAvailable;
    }

    // If no availability info found, default to available

    return true;
  }

  parseSpanishDayAbbreviations(availabilityString, dayOfWeek) {
    if (!availabilityString || typeof availabilityString !== 'string') {
      return false;
    }

    // Map Spanish day abbreviations to day numbers (0=Sunday, 1=Monday, etc.)
    const spanishDayMap = {
      do: 0,
      dom: 0,
      domingo: 0,
      lu: 1,
      lun: 1,
      lunes: 1,
      ma: 2,
      mar: 2,
      martes: 2,
      mi: 3,
      mie: 3,
      miércoles: 3,
      miercoles: 3,
      ju: 4,
      jue: 4,
      jueves: 4,
      vi: 5,
      vie: 5,
      viernes: 5,
      sa: 6,
      sab: 6,
      sábado: 6,
      sabado: 6,
    };

    // Convert to lowercase and split by common separators
    const dayAbbreviations = availabilityString.toLowerCase()
      .replace(/\s+/g, ' ')
      .split(/[,;|\s]+/)
      .filter((day) => day.trim().length > 0);

    // Check if the current day of week is in the available days
    for (const dayAbbr of dayAbbreviations) {
      const trimmedDay = dayAbbr.trim();
      if (spanishDayMap.hasOwnProperty(trimmedDay)) {
        const availableDay = spanishDayMap[trimmedDay];
        if (availableDay === dayOfWeek) {
          return true;
        }
      }
    }

    return false;
  }

  checkTourAvailability(tour, dayOfWeek) {
    // If no availability data, assume tour is available every day
    if (!tour.availability && !tour.availableDays) {
      return true;
    }

    // Check availableDays array (e.g., [0,1,2,3,4,5,6] where 0=Sunday)
    if (tour.availableDays && Array.isArray(tour.availableDays)) {
      const isAvailable = tour.availableDays.includes(dayOfWeek);

      return isAvailable;
    }

    // Check availability array
    if (tour.availability && Array.isArray(tour.availability)) {
      const isAvailable = this.checkAvailabilityArray(tour.availability, dayOfWeek);

      return isAvailable;
    }

    // Check availability object
    if (tour.availability && typeof tour.availability === 'object') {
      // Check for days array in availability object
      if (tour.availability.days && Array.isArray(tour.availability.days)) {
        const isAvailable = tour.availability.days.includes(dayOfWeek);

        return isAvailable;
      }

      // Check for day-specific properties (monday, tuesday, etc.)
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[dayOfWeek];

      if (tour.availability[dayName] !== undefined) {
        const isAvailable = tour.availability[dayName];

        return isAvailable;
      }
    }

    // If we can't determine availability, assume tour is available

    return true;
  }

  checkAvailabilityArray(availabilityArray, dayOfWeek) {
    if (!Array.isArray(availabilityArray)) {
      return false;
    }

    // Map day numbers to various possible property names
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const dayAbbrevEn = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayAbbrevEs = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

    const currentDayName = dayNames[dayOfWeek];
    const currentDayNameEs = dayNamesEs[dayOfWeek];
    const currentDayAbbrevEn = dayAbbrevEn[dayOfWeek];
    const currentDayAbbrevEs = dayAbbrevEs[dayOfWeek];

    for (let i = 0; i < availabilityArray.length; i++) {
      const availabilityObj = availabilityArray[i];

      if (!availabilityObj || typeof availabilityObj !== 'object') {
        continue;
      }

      // Check for day number property
      if (availabilityObj.hasOwnProperty(dayOfWeek.toString())) {
        const isAvailable = availabilityObj[dayOfWeek.toString()];

        if (isAvailable) return true;
      }

      // Check for English day names
      if (availabilityObj.hasOwnProperty(currentDayName)) {
        const isAvailable = availabilityObj[currentDayName];

        if (isAvailable) return true;
      }

      // Check for Spanish day names
      if (availabilityObj.hasOwnProperty(currentDayNameEs)) {
        const isAvailable = availabilityObj[currentDayNameEs];

        if (isAvailable) return true;
      }

      // Check for English abbreviations
      if (availabilityObj.hasOwnProperty(currentDayAbbrevEn)) {
        const isAvailable = availabilityObj[currentDayAbbrevEn];

        if (isAvailable) return true;
      }

      // Check for Spanish abbreviations
      if (availabilityObj.hasOwnProperty(currentDayAbbrevEs)) {
        const isAvailable = availabilityObj[currentDayAbbrevEs];

        if (isAvailable) return true;
      }

      // Check for 'day' property with day number
      if (availabilityObj.day !== undefined) {
        if (availabilityObj.day === dayOfWeek) {
          return true;
        }
      }

      // Check for 'dayOfWeek' property
      if (availabilityObj.dayOfWeek !== undefined) {
        if (availabilityObj.dayOfWeek === dayOfWeek) {
          return true;
        }
      }

      // Check for any property that might contain day abbreviations as string
      Object.keys(availabilityObj).forEach((key) => {
        const value = availabilityObj[key];
        if (typeof value === 'string' && this.parseSpanishDayAbbreviations(value, dayOfWeek)) {
          return true;
        }
      });
    }

    return false;
  }

  async loadDayTours(dayId) {
    const tourSelect = document.getElementById('tourSelect');
    if (!tourSelect) {
      console.error('❌ tourSelect element not found!');
      return;
    }

    // Clear existing options except the first placeholder
    tourSelect.innerHTML = '<option value="">-- Selecciona un tour --</option>';

    // Get the day information to check availability
    const dayInfo = this.days.find((d) => d.id === dayId);
    let dayOfWeek = null;
    let dayDate = null;

    if (dayInfo && dayInfo.date) {
      dayDate = new Date(dayInfo.date);
      dayOfWeek = dayDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    } else {

    }

    try {
      // Load tours if not in cache
      if (!this.toursCache.has('all')) {
        await this.loadAllTours();
      }

      // Add tours from cache
      if (this.toursCache.has('all')) {
        const tours = this.toursCache.get('all');

        // Filter tours with destinationPOI that has a name
        let validTours = tours.filter((tour) => tour && tour.destinationPOI && tour.destinationPOI.name && tour.objectId);

        // Filter by availability if we have a specific day
        if (dayOfWeek !== null) {
          validTours = validTours.filter((tour) => {
            // Check if tour is available on this day
            const isAvailable = this.checkTourAvailability(tour, dayOfWeek);
            if (!isAvailable) {

            }
            return isAvailable;
          });
        }

        // Sort tours alphabetically by destinationPOI name
        validTours.sort((a, b) => {
          const nameA = a.destinationPOI?.name || '';
          const nameB = b.destinationPOI?.name || '';
          return nameA.localeCompare(nameB);
        });

        validTours.forEach((tour) => {
          const option = document.createElement('option');
          option.value = tour.objectId || tour.id;
          option.textContent = tour.destinationPOI?.name || tour.description || 'Tour sin nombre';
          tourSelect.appendChild(option);
        });
      } else {
        console.warn('⚠️ No tours in cache after loading attempt');
      }
    } catch (error) {
      console.error('Error loading tours into dropdown:', error);
      this.showModalAlert('serviceModalAlert', 'Error cargando tours', 'warning');
    }
  }

  async saveToBackend() {
    // Calculate totals
    const subtotal = this.calculateSubtotal();
    const iva = Math.round(subtotal * 0.16 * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    // Transform our data structure to match the expected format
    const serviceItemsData = {
      days: this.days.map((day, index) => {
        // Calculate day total from services
        let dayTotal = 0;
        const subconcepts = day.services.map((serviceId) => {
          const service = this.services.get(serviceId);
          if (!service) return null;

          const servicePrice = this.calculateServicePrice(service);
          const serviceTotal = servicePrice * (service.quantity || 1);
          dayTotal += serviceTotal;

          const subconcept = {
            type: service.type || 'regular',
            concept: this.getServiceTitle(service),
            time: service.startTime || null, // Backend expects 'time' not 'startTime'
            endTime: service.endTime || null,
            vehicleId: service.vehicleId || null,
            vehicleType: service.vehicleType || null, // Store vehicle type for tours
            vehicleTypeName: service.vehicleTypeName || null, // Store display name
            unitPrice: servicePrice,
            quantity: service.quantity || 1,
            notes: service.notes || '',
            hours: null, // Add if needed
            total: serviceTotal,
            // Type-specific fields
            experienceId: service.experienceId || null,
            tourId: service.tourId || null,
            rateId: service.rateId || null, // Store rate for vehicle pricing
            hotelName: service.hotelName || null,
            // People quantities for experiences
            adultsQuantity: service.adultsQuantity || null,
            childrenQuantity: service.childrenQuantity || null,
            adultsNoAlcoholQuantity: service.adultsNoAlcoholQuantity || null,
            // Schedule for experiences
            selectedSchedule: service.selectedSchedule || null,
            // Individual prices for experiences
            adultPrice: service.adultPrice || null,
            childPrice: service.childPrice || null,
            noAlcoholPrice: service.noAlcoholPrice || null,
            checkIn: service.checkIn || null,
            checkOut: service.checkOut || null,
            // Tour-specific fields
            includeGuide: service.includeGuide || false,
            includeGreeter: service.includeGreeter || false,
            greeterInVehicle: service.greeterInVehicle || false,
            includeInTotal: service.includeInTotal !== false,
            // Transport-specific fields
            transportType: service.transportType || null,
            tripType: service.tripType || null,
            directionType: service.directionType || null,
            origin: service.origin || null,
            originName: service.originName || null,
            destination: service.destination || null,
            destinationPOI: service.destinationPOI || null,
            specificLocation: service.specificLocation || null,
            category: service.category || null,
            transportAdults: service.transportAdults || null,
            transportChildren: service.transportChildren || null,
            transportInfants: service.transportInfants || null,
            persons: service.persons || null,
            flightNumber: service.flightNumber || null,
            airline: service.airline || null,
            routeDuration: service.routeDuration || null,
            baseVehiclePrice: service.baseVehiclePrice || null,
          };

          // Debug logging for includeGuide
          if (service.type === 'tour' && service.includeGuide) {
            // console.log('💾 Saving tour with includeGuide:', service.includeGuide);
          }

          // Debug logging for saving people quantities and schedule
          if (service.type === 'experience' && (service.adultsQuantity || service.childrenQuantity || service.adultsNoAlcoholQuantity || service.selectedSchedule)) {

          }

          return subconcept;
        }).filter(Boolean);

        return {
          dayNumber: index + 1, // Backend expects dayNumber starting from 1
          dayTitle: day.title || `Día ${index + 1}`,
          date: day.date || null,
          description: day.description || '',
          subconcepts,
          dayTotal: Math.round(dayTotal * 100) / 100, // Backend expects dayTotal for validation
        };
      }),
      subtotal,
      iva,
      total,
    };

    // Get access token from cookie
    const accessToken = this.getAccessToken();

    if (!accessToken) {
      console.error('No access token found in cookies');
      throw new Error('No access token found - please login again');
    }

    const response = await fetch(`/api/quotes/${this.quoteId}/service-items`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(serviceItemsData),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to save to backend';
      let responseBody;

      try {
        // Clone the response so we can read it multiple times if needed
        const responseClone = response.clone();
        responseBody = await response.text();
        console.error('Raw response body:', responseBody);

        // Try to parse as JSON
        try {
          const errorData = JSON.parse(responseBody);
          console.error('Parsed error response:', errorData);

          // Check different possible error message fields
          errorMessage = errorData.error
            || errorData.message
            || errorData.msg
            || (typeof errorData === 'string' ? errorData : errorMessage);
        } catch (jsonError) {
          // Not JSON, use the text directly
          console.error('Response is not JSON:', responseBody);
          errorMessage = responseBody || errorMessage;
        }
      } catch (e) {
        console.error('Error reading response:', e);
      }

      throw new Error(errorMessage);
    }

    // Success case
    let result;
    try {
      const responseText = await response.text();

      // Try to parse the response
      if (responseText) {
        result = JSON.parse(responseText);
      } else {
        // Empty response, but successful
        result = { success: true };
      }
    } catch (e) {
      console.error('Error parsing success response:', e);
      // If parsing fails but status is ok, consider it successful
      result = { success: true };
    }

    return result;
  }

  calculateSubtotal() {
    let subtotal = 0;
    this.days.forEach((day) => {
      day.services.forEach((serviceId) => {
        const service = this.services.get(serviceId);
        if (service) {
          const servicePrice = this.calculateServicePrice(service);
          subtotal += servicePrice * (service.quantity || 1);
        }
      });
    });
    return subtotal;
  }

  populateVehicleSelect() {
    const select = document.getElementById('vehicleSelect');
    if (!select || !this.vehiclesCache) return;

    select.innerHTML = '<option value="">-- Sin vehículo --</option>';
    this.vehiclesCache.forEach((vehicle) => {
      select.innerHTML += `
                <option value="${vehicle.objectId}">
                    ${vehicle.brand} ${vehicle.model} - ${vehicle.type}
                </option>
            `;
    });
  }

  populateRatesDropdown() {
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
          return;
        }
      }

      // Format percentage display (e.g., "Standard (15%)")
      const percentage = rate.formattedPercentage || (rate.percentage ? `${rate.percentage}%` : '');
      const displayText = percentage ? `${label} (${percentage})` : label;

      select.innerHTML += `
                <option value="${rate.value || rate.objectId || rate.id}">
                    ${displayText}
                </option>
            `;
    });

    // Restore previous value if it still exists
    if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
      select.value = currentValue;
    }
  }

  // Additional Methods for duplication and deletion
  duplicateDay(dayId) {
    const originalDay = this.days.find((d) => d.id === dayId);
    if (!originalDay) return;

    const newDay = {
      ...originalDay,
      id: this.generateId('day'),
      number: this.days.length + 1,
      title: `${originalDay.title} (Copia)`,
      services: [],
    };

    // Duplicate services
    originalDay.services.forEach((serviceId) => {
      const originalService = this.services.get(serviceId);
      if (originalService) {
        const newServiceId = this.generateId('service');
        this.services.set(newServiceId, {
          ...originalService,
          id: newServiceId,
          dayId: newDay.id,
        });
        newDay.services.push(newServiceId);
      }
    });

    this.days.push(newDay);
    this.saveToBackend();
    this.renderItinerary();
    this.showAlert('Día duplicado exitosamente', 'success');
  }

  duplicateService(serviceId) {
    const originalService = this.services.get(serviceId);
    if (!originalService) return;

    const newServiceId = this.generateId('service');
    this.services.set(newServiceId, {
      ...originalService,
      id: newServiceId,
    });

    // Add to the same day
    const day = this.days.find((d) => d.id === originalService.dayId);
    if (day) {
      day.services.push(newServiceId);

      // Sort services by time (but don't deduplicate since we want to keep the duplicate)
      day.services = this.sortServicesByTime(day.services);
      this.recalculateOverlapsForDay(day);
    }

    this.saveToBackend();
    this.renderItinerary();
    this.showAlert('Servicio duplicado exitosamente', 'success');
  }

  deleteService(serviceId) {
    this.currentServiceId = serviceId;
    const service = this.services.get(serviceId);

    if (!service) return;

    const message = '¿Estás seguro de que deseas eliminar este servicio?';
    document.getElementById('deleteConfirmMessage').textContent = message;

    const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    modal.show();
  }

  confirmDelete() {
    if (this.currentDayId && !this.currentServiceId) {
      // Delete day
      this.days = this.days.filter((d) => d.id !== this.currentDayId);

      // Delete associated services
      this.services.forEach((service, id) => {
        if (service.dayId === this.currentDayId) {
          this.services.delete(id);
        }
      });

      // Renumber days
      this.days.forEach((day, index) => {
        day.number = index + 1;
      });
    } else if (this.currentServiceId) {
      // Delete service
      const service = this.services.get(this.currentServiceId);
      if (service) {
        // Remove from day
        const day = this.days.find((d) => d.id === service.dayId);
        if (day) {
          day.services = day.services.filter((sid) => sid !== this.currentServiceId);

          // Recalculate overlaps for remaining services in this day
          this.recalculateOverlapsForDay(day);
        }

        // Remove from services map
        this.services.delete(this.currentServiceId);
      }
    }

    this.saveToBackend();
    this.renderItinerary();
    this.closeModal('deleteConfirmModal');
    this.showAlert('Elemento eliminado exitosamente', 'success');
  }

  showPreview() {
    const modal = new bootstrap.Modal(document.getElementById('previewModal'));
    const content = document.getElementById('previewContent');

    // Generate preview HTML
    let previewHtml = '<div class="itinerary-preview">';

    this.days.forEach((day) => {
      const services = day.services.map((sid) => this.services.get(sid)).filter(Boolean);
      const dayTotal = services.reduce((sum, service) => sum + (this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity)), 0);

      previewHtml += `
                <div class="preview-day mb-4">
                    <h4>Día ${day.number}: ${day.title}</h4>
                    ${day.date ? `<p class="text-muted">${this.formatDate(day.date)}</p>` : ''}
                    ${day.description ? `<p>${day.description}</p>` : ''}
                    
                    <div class="preview-services">
                        ${services.map((service) => `
                            <div class="preview-service mb-2">
                                <strong>${this.getServiceTitle(service)}</strong>
                                ${service.startTime ? ` - ${service.startTime}` : ''}
                                <span class="float-end">${this.formatCurrency(this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity))}</span>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="text-end mt-2">
                        <strong>Total del día: ${this.formatCurrency(dayTotal)}</strong>
                    </div>
                </div>
            `;
    });

    previewHtml += '</div>';
    content.innerHTML = previewHtml;

    modal.show();
  }

  async exportPdf() {
    try {
      const response = await fetch(`/api/quotes/${this.quoteId}/export-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          days: this.days,
          services: Array.from(this.services.values()),
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `itinerary_${this.quoteId}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);

        this.showAlert('PDF exportado exitosamente', 'success');
      } else {
        throw new Error('Failed to export PDF');
      }
    } catch (error) {
      console.error('Error exporting PDF:', error);
      this.showAlert('Error al exportar el PDF', 'danger');
    }
  }

  // Drag and Drop Methods
  setupSidebarDragAndDrop(container) {
    let draggedElement = null;
    let isDragging = false;
    let dropZoneActive = false;

    // Add dragover and drop to container to catch all drops
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Special handling for dropping at the very top
      const rect = container.getBoundingClientRect();
      const firstItem = container.querySelector('.day-nav-item');

      if (firstItem && e.clientY < rect.top + 40) {
        // Mark top zone as active
        dropZoneActive = 'top';

        // Show indicator at the very top if not already there
        if (!container.querySelector('.drop-indicator.top-indicator')) {
          this.clearDropIndicators(container);
          const indicator = document.createElement('div');
          indicator.className = 'drop-indicator top-indicator';
          indicator.innerHTML = `
                        <div class="drop-line"></div>
                        <div class="drop-text">Mover al principio</div>
                    `;
          container.insertBefore(indicator, firstItem);
        }
      } else {
        dropZoneActive = false;
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      let draggedDayId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

      if (!draggedDayId) {
        // Try to get it from draggedElement as fallback
        if (draggedElement && draggedElement.dataset.dayId) {
          draggedDayId = draggedElement.dataset.dayId;
        }
      }

      if (draggedDayId) {
        this.handleDrop(container, draggedDayId, e);
      }
    }, false); // Changed to bubble phase

    container.querySelectorAll('.day-nav-item').forEach((item) => {
      // Click handler for navigation
      item.addEventListener('click', (e) => {
        // Only navigate if not dragging and not clicking grip handle
        if (!isDragging && !e.target.closest('.ti-grip-vertical')) {
          const { dayId } = item.dataset;
          this.scrollToDay(dayId);
        }
      });

      // Drag start
      item.addEventListener('dragstart', (e) => {
        const { dayId } = item.dataset;
        draggedElement = item;
        isDragging = true;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dayId);
        // Store in multiple formats for compatibility
        e.dataTransfer.setData('text', dayId);
      });

      // Drag end
      item.addEventListener('dragend', (e) => {
        item.classList.remove('dragging');
        this.clearDropIndicators(container);

        // If drop didn't happen but we have position info, do the reorder
        if (e.dataTransfer.dropEffect === 'none' && draggedElement) {
          const lastHoveredItem = container.querySelector('[data-drop-position]');
          if (lastHoveredItem && lastHoveredItem !== item) {
            const draggedDayId = item.dataset.dayId;
            const targetDayId = lastHoveredItem.dataset.dayId;
            const { dropPosition } = lastHoveredItem.dataset;
            this.reorderDays(draggedDayId, targetDayId, dropPosition);
          }
        }

        // Clear all drop positions
        container.querySelectorAll('[data-drop-position]').forEach((el) => {
          delete el.dataset.dropPosition;
        });

        setTimeout(() => {
          draggedElement = null;
          isDragging = false;
        }, 150);
      });

      // Drag enter
      item.addEventListener('dragenter', (e) => {
        if (draggedElement && draggedElement !== item) {
          e.preventDefault();
        }
      });

      // Drag over for indicators - simplified
      item.addEventListener('dragover', (e) => {
        if (draggedElement && draggedElement !== item) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          // Get position for indicator
          const rect = item.getBoundingClientRect();
          const mouseY = e.clientY;
          const insertBefore = mouseY < (rect.top + rect.height / 2);

          // Store position on the item
          item.dataset.dropPosition = insertBefore ? 'before' : 'after';

          // Show indicator
          this.showDropIndicator(item, e);
        }
      });

      // Add drop event to each item as well
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        let draggedDayId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

        if (!draggedDayId && draggedElement) {
          draggedDayId = draggedElement.dataset.dayId;
        }

        if (draggedDayId) {
          const targetDayId = item.dataset.dayId;
          const dropPosition = item.dataset.dropPosition || 'before';

          this.clearDropIndicators(container);

          if (draggedDayId !== targetDayId) {
            this.reorderDays(draggedDayId, targetDayId, dropPosition);
          }
        }
      });
    });
  }

  setupContentDragAndDrop(container) {
    let draggedElement = null;

    // Add dragover and drop to container to catch all drops
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Special handling for dropping at the very top
      const rect = container.getBoundingClientRect();
      const firstCard = container.querySelector('.day-card');

      if (firstCard && e.clientY < rect.top + 60) {
        // Show indicator at the very top if not already there
        if (!container.querySelector('.drop-indicator.top-indicator')) {
          this.clearDropIndicators(container);
          const indicator = document.createElement('div');
          indicator.className = 'drop-indicator top-indicator';
          indicator.innerHTML = `
                        <div class="drop-line"></div>
                        <div class="drop-text">Mover al principio</div>
                    `;
          container.insertBefore(indicator, firstCard);
        }
      }
    });

    // Add dragover to container to allow dropping
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      let draggedDayId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

      if (!draggedDayId) {
        // Try to get it from draggedElement as fallback
        if (draggedElement && draggedElement.dataset.dayId) {
          draggedDayId = draggedElement.dataset.dayId;
        }
      }

      if (draggedDayId) {
        this.handleDrop(container, draggedDayId, e);
      }
    }, false); // Changed to bubble phase

    container.querySelectorAll('.day-card').forEach((card) => {
      // Set up drag handle behavior
      const dragHandle = card.querySelector('.drag-handle');

      if (dragHandle) {
        // Make card draggable when pressing drag handle
        dragHandle.addEventListener('mousedown', (e) => {
          card.setAttribute('draggable', 'true');
        });

        // Reset draggable when mouse is released outside card
        document.addEventListener('mouseup', (e) => {
          if (!card.contains(e.target)) {
            card.setAttribute('draggable', 'false');
          }
        });
      }

      // Drag start - only if draggable is true
      card.addEventListener('dragstart', (e) => {
        if (card.getAttribute('draggable') !== 'true') {
          e.preventDefault();
          return false;
        }

        const { dayId } = card.dataset;
        draggedElement = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dayId);
        // Store in multiple formats for compatibility
        e.dataTransfer.setData('text', dayId);
      });

      // Drag end
      card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
        card.setAttribute('draggable', 'false');
        this.clearDropIndicators(container);

        // If drop didn't happen but we have position info, do the reorder
        if (e.dataTransfer.dropEffect === 'none' && draggedElement) {
          const lastHoveredCard = container.querySelector('[data-drop-position]');
          if (lastHoveredCard && lastHoveredCard !== card) {
            const draggedDayId = card.dataset.dayId;
            const targetDayId = lastHoveredCard.dataset.dayId;
            const { dropPosition } = lastHoveredCard.dataset;
            this.reorderDays(draggedDayId, targetDayId, dropPosition);
          }
        }

        // Clear all drop positions
        container.querySelectorAll('[data-drop-position]').forEach((el) => {
          delete el.dataset.dropPosition;
        });

        setTimeout(() => {
          draggedElement = null;
        }, 150);
      });

      // Drag enter
      card.addEventListener('dragenter', (e) => {
        if (draggedElement && draggedElement !== card) {
          e.preventDefault();
        }
      });

      // Drag over for indicators - simplified
      card.addEventListener('dragover', (e) => {
        if (draggedElement && draggedElement !== card) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          // Get position for indicator
          const rect = card.getBoundingClientRect();
          const mouseY = e.clientY;
          const insertBefore = mouseY < (rect.top + rect.height / 2);

          // Store position on the card
          card.dataset.dropPosition = insertBefore ? 'before' : 'after';

          // Show indicator
          this.showDropIndicator(card, e);
        }
      });

      // Add drop event to each card as well
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        let draggedDayId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

        if (!draggedDayId && draggedElement) {
          draggedDayId = draggedElement.dataset.dayId;
        }

        if (draggedDayId) {
          const targetDayId = card.dataset.dayId;
          const dropPosition = card.dataset.dropPosition || 'before';

          this.clearDropIndicators(container);

          if (draggedDayId !== targetDayId) {
            this.reorderDays(draggedDayId, targetDayId, dropPosition);
          }
        }
      });
    });
  }

  handleDrop(container, draggedDayId, event) {
    // Check if we have a top indicator visible
    const topIndicator = container.querySelector('.drop-indicator.top-indicator');
    if (topIndicator) {
      this.clearDropIndicators(container);

      // Move to first position
      if (this.days.length > 0) {
        const firstDayId = this.days[0].id;
        if (draggedDayId !== firstDayId) {
          this.reorderDays(draggedDayId, firstDayId, 'before');
        }
      }
      return;
    }

    // Check for any drop indicator
    const anyIndicator = container.querySelector('.drop-indicator');
    if (anyIndicator) {
      const { targetId } = anyIndicator.dataset;
      const dropBefore = anyIndicator.dataset.dropBefore === 'true';

      if (targetId) {
        this.clearDropIndicators(container);
        this.reorderDays(draggedDayId, targetId, dropBefore ? 'before' : 'after');
        return;
      }
    }

    // Fallback: Find the closest day-card/day-nav-item
    const targetCard = event.target.closest('.day-card') || event.target.closest('.day-nav-item');
    if (targetCard) {
      const targetDayId = targetCard.dataset.dayId;
      const dropPosition = targetCard.dataset.dropPosition || 'before';

      this.clearDropIndicators(container);

      if (draggedDayId && targetDayId && draggedDayId !== targetDayId) {
        this.reorderDays(draggedDayId, targetDayId, dropPosition);
      }
    }
  }

  reorderDays(draggedDayId, targetDayId, dropPosition = 'before') {
    if (draggedDayId === targetDayId) {
      return;
    }

    const draggedIndex = this.days.findIndex((d) => d.id === draggedDayId);
    const targetIndex = this.days.findIndex((d) => d.id === targetDayId);

    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    // Create a new array for cleaner manipulation
    const newDays = [...this.days];
    const draggedDay = newDays[draggedIndex];

    // Remove dragged item
    newDays.splice(draggedIndex, 1);

    // Calculate new insertion index
    let insertIndex = targetIndex;

    // Adjust for the removal
    if (draggedIndex < targetIndex) {
      insertIndex--;
    }

    // Adjust for before/after position
    if (dropPosition === 'after') {
      insertIndex++;
    }

    // Ensure index is within bounds
    insertIndex = Math.max(0, Math.min(insertIndex, newDays.length));

    // Insert at new position
    newDays.splice(insertIndex, 0, draggedDay);

    // Replace the days array
    this.days = newDays;

    // Update day numbers only (not dates)
    this.updateDayNumbers();

    // Save to backend and re-render
    this.saveToBackend();
    this.renderItinerary();

    this.showAlert('Días reordenados exitosamente', 'success');
  }

  updateDayNumbers() {
    // Only update day numbers, keep dates as they are
    this.days.forEach((day, index) => {
      day.number = index + 1;
    });
  }

  updateDaySequence() {
    // This function updates both numbers and dates sequentially
    // Only used when we want to fix/reset the date sequence

    // Get the first date to use as starting point, or today
    let startDate;
    const firstDayWithDate = this.days.find((d) => d.date);

    if (firstDayWithDate) {
      startDate = new Date(`${firstDayWithDate.date}T00:00:00`);
    } else {
      startDate = new Date();
    }

    // Update all days with sequential numbers and dates
    this.days.forEach((day, index) => {
      day.number = index + 1;

      // Calculate sequential date
      const dayDate = new Date(startDate);
      dayDate.setDate(startDate.getDate() + index);
      day.date = dayDate.toISOString().split('T')[0];
    });
  }

  getNextSequentialDate() {
    if (this.days.length === 0) {
      return new Date().toISOString().split('T')[0];
    }

    const lastDay = this.days[this.days.length - 1];
    if (lastDay.date) {
      const lastDate = new Date(`${lastDay.date}T00:00:00`);
      const nextDate = new Date(lastDate);
      nextDate.setDate(lastDate.getDate() + 1);
      return nextDate.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
  }

  fixDateSequence() {
    if (this.days.length === 0) return;

    // Check if dates are already in proper sequence
    let needsFix = false;
    for (let i = 1; i < this.days.length; i++) {
      const prevDate = new Date(this.days[i - 1].date || '2026-01-01');
      const currentDate = new Date(this.days[i].date || '2026-01-01');

      if (currentDate <= prevDate) {
        needsFix = true;
        break;
      }
    }

    if (needsFix) {
      this.updateDaySequence();

      // Save the corrected sequence
      this.saveToBackend();
    } else {
    }
  }

  showDropIndicator(targetElement, event) {
    // Skip if this is a drop indicator itself
    if (targetElement.classList.contains('drop-indicator')) {
      return;
    }

    // Throttle updates but not too much
    if (this.lastIndicatorUpdate && Date.now() - this.lastIndicatorUpdate < 100) {
      return;
    }
    this.lastIndicatorUpdate = Date.now();

    // Clear existing indicators
    this.clearDropIndicators(targetElement.parentNode);

    // Skip if no valid target
    if (!targetElement || !targetElement.parentNode) {
      return;
    }

    // Get the mouse position within the target element
    const rect = targetElement.getBoundingClientRect();
    const mouseY = event.clientY;
    const elementMiddle = rect.top + (rect.height / 2);

    // Simple before/after logic based on middle
    const insertBefore = mouseY < elementMiddle;

    // Create drop indicator
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.dataset.dropBefore = insertBefore ? 'true' : 'false';
    indicator.dataset.targetId = targetElement.dataset.dayId || targetElement.dataset.dayId;
    indicator.innerHTML = `
            <div class="drop-line"></div>
            <div class="drop-text">Soltar aquí</div>
        `;

    // Insert the indicator
    requestAnimationFrame(() => {
      try {
        if (insertBefore) {
          targetElement.parentNode.insertBefore(indicator, targetElement);
        } else if (targetElement.nextSibling) {
          targetElement.parentNode.insertBefore(indicator, targetElement.nextSibling);
        } else {
          targetElement.parentNode.appendChild(indicator);
        }
      } catch (error) {
        console.debug('Could not insert indicator:', error);
      }
    });
  }

  clearDropIndicators(container) {
    const indicators = container.querySelectorAll('.drop-indicator');
    indicators.forEach((indicator) => indicator.remove());
  }

  attachDayEventListeners() {
    const container = document.getElementById('daysContainer');
    if (!container) return;

    // Day action buttons
    container.querySelectorAll('.edit-day-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { dayId } = btn.dataset;
        this.openDayModal(dayId);
      });
    });

    container.querySelectorAll('.duplicate-day-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { dayId } = btn.dataset;
        this.duplicateDay(dayId);
      });
    });

    container.querySelectorAll('.delete-day-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { dayId } = btn.dataset;
        this.deleteDay(dayId);
      });
    });

    // Add service buttons
    container.querySelectorAll('.add-service-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { dayId } = btn.dataset;
        this.openServiceModal(dayId);
      });
    });

    // Service action buttons
    container.querySelectorAll('.edit-service-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { dayId } = btn.dataset;
        const { serviceId } = btn.dataset;
        this.openServiceModal(dayId, serviceId);
      });
    });

    container.querySelectorAll('.duplicate-service-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { serviceId } = btn.dataset;
        this.duplicateService(serviceId);
      });
    });

    container.querySelectorAll('.delete-service-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const { serviceId } = btn.dataset;
        this.deleteService(serviceId);
      });
    });

    // Toggle include in total buttons
    container.querySelectorAll('.toggle-include-total-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { serviceId } = btn.dataset;
        const service = this.services.get(serviceId);
        if (service) {
          service.includeInTotal = service.includeInTotal === false;
          this.renderDaysContent();
          this.updateTotals();
        }
      });
    });

    // Person count inputs in day footers
    container.querySelectorAll('.day-person-count-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const newCount = parseInt(e.target.value) || 0;
        this.numberOfPeople = newCount;
        // Sync the numberOfPeople input in the information tab
        const infoInput = document.getElementById('numberOfPeople');
        if (infoInput) infoInput.value = newCount;
        // Update all day cards per-person totals and global totals
        this.updateAllDayPerPerson();
        this.updateTotals();
      });
    });
  }

  updateAllDayPerPerson() {
    const container = document.getElementById('daysContainer');
    if (!container) return;

    container.querySelectorAll('.day-card').forEach((card) => {
      const dayId = card.dataset.dayId;
      const day = this.days.find((d) => d.id === dayId);
      if (!day) return;

      const services = day.services.map((sid) => this.services.get(sid)).filter(Boolean);
      const dayTotalMXN = services.reduce((sum, service) => {
        if (service.includeInTotal === false) return sum;
        return sum + (this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity));
      }, 0);
      const dayTotal = this.getDisplayPrice(dayTotalMXN);
      const perPerson = this.numberOfPeople > 0 ? dayTotal / this.numberOfPeople : 0;

      const perPersonEl = card.querySelector('.day-per-person');
      if (perPersonEl) perPersonEl.textContent = this.formatCurrency(perPerson);

      // Sync all person count inputs to same value
      const input = card.querySelector('.day-person-count-input');
      if (input && parseInt(input.value) !== this.numberOfPeople) {
        input.value = this.numberOfPeople;
      }
    });
  }
}

// Global variable to store services data for filtering
let servicesData = null;

/**
 * Load active services from Services table and populate transport dropdowns
 */
async function loadActiveServicesForDropdowns() {
  try {
    // console.log('[Services] Loading active services from Services table...');

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
      // console.log(`[Services] Loaded ${result.data.length} active services`);

      // Store services data globally for filtering
      servicesData = result.data;

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


      // Initially populate with aeropuerto services (default)
      populateDropdownsForTransportType('aeropuerto');

    }
  } catch (error) {
    console.error('[Services] Error loading active services:', error);
    // Don't break the app if services can't be loaded
  }
}

/**
 * Populate transport dropdowns based on selected transport type
 */
function populateDropdownsForTransportType(transportType, directionType) {
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
    } else {
      // For other types: add all origins and destinations
      if (service.origin) origins.add(service.origin);
      if (service.destination) destinations.add(service.destination);
    }
  });

  // Create mapping from slugified values to original names (make it global)
  window.slugToOriginalMapping = new Map();

  const isDeparture = directionType === 'departure' && transportType === 'aeropuerto';

  // Populate origin SELECT (arrival: airports, non-departure modes)
  const originSelectEls = [
    document.getElementById('transportOriginSelect'),
    document.getElementById('roundTripOriginIdaSelect'),
  ];

  // Populate destination SELECT (departure+aeropuerto: airports)
  const destinationSelectEl = document.getElementById('transportDestinationSelect');

  // Populate origin datalist (departure+aeropuerto: local places)
  const originDatalistEl = document.getElementById('transportOriginList');

  // Populate destination datalists (arrival/other: local places)
  const destinationDatalistEls = [
    document.getElementById('transportDestinationList'),
    document.getElementById('roundTripDestinationList'),
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

  if (isDeparture) {
    // Departure + Aeropuerto:
    // origins (local places) → origin datalist + origin SELECT (for compatibility)
    // destinations (airports) → destination SELECT
    populateDatalist(originDatalistEl, origins);
    originSelectEls.forEach(el => populateSelect(el, origins)); // Keep in sync for fallback
    populateSelect(destinationSelectEl, destinations);
    populateDatalist(destinationDatalistEls[0], destinations); // Keep in sync
    populateDatalist(destinationDatalistEls[1], destinations);
  } else {
    // Arrival / other:
    // origins (airports or POIs) → origin SELECT
    // destinations (local places) → destination datalists
    originSelectEls.forEach(el => populateSelect(el, origins));
    destinationDatalistEls.forEach(el => populateDatalist(el, destinations));
    // Clear departure-specific elements
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    if (destinationSelectEl) { while (destinationSelectEl.options.length > 1) destinationSelectEl.remove(1); }
  }

  // Update options indicators
  updateOptionsIndicator(isDeparture ? 'transportOriginList' : 'transportDestinationList',
    isDeparture ? 'originOptionsIndicator' : 'destinationOptionsIndicator');

  // console.log(`[Services] Dropdowns updated for ${transportType}:`, {
  //   origins: origins.size,
  //   destinations: destinations.size
  // });
}

/**
 * Show indicator when datalist has options and origin is selected
 */
function updateOptionsIndicator(datalistId, indicatorId) {
  const datalist = document.getElementById(datalistId);
  const indicator = document.getElementById(indicatorId);

  if (datalist && indicator) {
    // Check if an origin is selected
    const transportOrigin = document.getElementById('transportOriginSelect');
    const roundTripOrigin = document.getElementById('roundTripOriginIdaSelect');

    const originSelected = (transportOrigin && transportOrigin.value && transportOrigin.value !== '') ||
      (roundTripOrigin && roundTripOrigin.value && roundTripOrigin.value !== '');

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
 * Update destination combo box options based on selected origin
 */
function updateDestinationsForOrigin(selectedOrigin = null) {
  console.log('🔍 updateDestinationsForOrigin called with origin:', selectedOrigin);

  if (!window.servicesByTransportType || !selectedOrigin) {
    console.log('❌ No services data or origin, returning');
    return; // No filtering if no origin selected
  }

  // Convert slugified value back to original name
  const originalOriginName = window.slugToOriginalMapping?.get(selectedOrigin) || selectedOrigin;
  console.log(`🔄 Converting slug "${selectedOrigin}" to original name: "${originalOriginName}"`);

  const transportType = document.querySelector('input[name="transportType"]:checked')?.value || 'aeropuerto';
  const directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
  const services = window.servicesByTransportType[transportType] || [];

  // For departure+aeropuerto: user's origin is a local place stored as service.destination in DB
  // So filter by service.destination and return service.origin (airports) as destination options
  const isDeparture = directionType === 'departure' && transportType === 'aeropuerto';

  const relevantServices = services.filter(service =>
    isDeparture ? service.destination === originalOriginName : service.origin === originalOriginName
  );

  if (relevantServices.length === 0) {
    return;
  }

  // Get matching destinations
  const destinations = new Set();
  relevantServices.forEach(service => {
    if (isDeparture) {
      // Departure: only show airports as destinations
      if (service.origin && service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
        destinations.add(service.origin);
      }
    } else {
      if (service.destination) {
        destinations.add(service.destination);
      }
    }
  });

  if (isDeparture) {
    // Departure: update destination SELECT with filtered airports
    const destSelect = document.getElementById('transportDestinationSelect');
    if (destSelect) {
      while (destSelect.options.length > 1) destSelect.remove(1);
      [...destinations].sort().forEach(location => {
        const option = document.createElement('option');
        const slugValue = location.toLowerCase().replace(/\s+/g, '-');
        option.value = slugValue;
        option.textContent = location;
        destSelect.appendChild(option);
        window.slugToOriginalMapping?.set(slugValue, location);
      });
    }
  } else {
    // Arrival/other: update destination datalists
    const datalists = [
      document.getElementById('transportDestinationList'),
      document.getElementById('roundTripDestinationList'),
    ];
    datalists.forEach(element => {
      if (!element) return;
      element.innerHTML = '';
      [...destinations].sort().forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        element.appendChild(option);
      });
    });
    updateOptionsIndicator('transportDestinationList', 'destinationOptionsIndicator');
  }
}

/**
 * Load active services from Services table and populate transport dropdowns
 */
async function loadActiveServicesForDropdowns() {
  try {
    // console.log('[Services] Loading active services from Services table...');

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
      // console.log(`[Services] Loaded ${result.data.length} active services`);

      // Store services data globally for filtering
      servicesData = result.data;

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


      // Initially populate with aeropuerto services (default)
      populateDropdownsForTransportType('aeropuerto');

    }
  } catch (error) {
    console.error('[Services] Error loading active services:', error);
    // Don't break the app if services can't be loaded
  }
}

/**
 * Populate transport dropdowns based on selected transport type
 */
function populateDropdownsForTransportType(transportType, directionType) {
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
    } else {
      // For other types: add all origins and destinations
      if (service.origin) origins.add(service.origin);
      if (service.destination) destinations.add(service.destination);
    }
  });

  // Create mapping from slugified values to original names (make it global)
  window.slugToOriginalMapping = new Map();

  const isDeparture = directionType === 'departure' && transportType === 'aeropuerto';

  // Populate origin SELECT (arrival: airports, non-departure modes)
  const originSelectEls = [
    document.getElementById('transportOriginSelect'),
    document.getElementById('roundTripOriginIdaSelect'),
  ];

  // Populate destination SELECT (departure+aeropuerto: airports)
  const destinationSelectEl = document.getElementById('transportDestinationSelect');

  // Populate origin datalist (departure+aeropuerto: local places)
  const originDatalistEl = document.getElementById('transportOriginList');

  // Populate destination datalists (arrival/other: local places)
  const destinationDatalistEls = [
    document.getElementById('transportDestinationList'),
    document.getElementById('roundTripDestinationList'),
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

  if (isDeparture) {
    // Departure + Aeropuerto:
    // origins (local places) → origin datalist + origin SELECT (for compatibility)
    // destinations (airports) → destination SELECT
    populateDatalist(originDatalistEl, origins);
    originSelectEls.forEach(el => populateSelect(el, origins)); // Keep in sync for fallback
    populateSelect(destinationSelectEl, destinations);
    populateDatalist(destinationDatalistEls[0], destinations); // Keep in sync
    populateDatalist(destinationDatalistEls[1], destinations);
  } else {
    // Arrival / other:
    // origins (airports or POIs) → origin SELECT
    // destinations (local places) → destination datalists
    originSelectEls.forEach(el => populateSelect(el, origins));
    destinationDatalistEls.forEach(el => populateDatalist(el, destinations));
    // Clear departure-specific elements
    if (originDatalistEl) originDatalistEl.innerHTML = '';
    if (destinationSelectEl) { while (destinationSelectEl.options.length > 1) destinationSelectEl.remove(1); }
  }

  // Update options indicators
  updateOptionsIndicator(isDeparture ? 'transportOriginList' : 'transportDestinationList',
    isDeparture ? 'originOptionsIndicator' : 'destinationOptionsIndicator');

  // console.log(`[Services] Dropdowns updated for ${transportType}:`, {
  //   origins: origins.size,
  //   destinations: destinations.size
  // });
}

/**
 * Show indicator when datalist has options and origin is selected
 */
function updateOptionsIndicator(datalistId, indicatorId) {
  const datalist = document.getElementById(datalistId);
  const indicator = document.getElementById(indicatorId);

  if (datalist && indicator) {
    // Check if an origin is selected
    const transportOrigin = document.getElementById('transportOriginSelect');
    const roundTripOrigin = document.getElementById('roundTripOriginIdaSelect');

    const originSelected = (transportOrigin && transportOrigin.value && transportOrigin.value !== '') ||
      (roundTripOrigin && roundTripOrigin.value && roundTripOrigin.value !== '');

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
 * Update destination combo box options based on selected origin
 */
function updateDestinationsForOrigin(selectedOrigin = null) {
  console.log('🔍 updateDestinationsForOrigin called with origin:', selectedOrigin);

  if (!window.servicesByTransportType || !selectedOrigin) {
    console.log('❌ No services data or origin, returning');
    return; // No filtering if no origin selected
  }

  // Convert slugified value back to original name
  const originalOriginName = window.slugToOriginalMapping?.get(selectedOrigin) || selectedOrigin;
  console.log(`🔄 Converting slug "${selectedOrigin}" to original name: "${originalOriginName}"`);

  const transportType = document.querySelector('input[name="transportType"]:checked')?.value || 'aeropuerto';
  const directionType = document.querySelector('input[name="directionType"]:checked')?.value || 'arrival';
  const services = window.servicesByTransportType[transportType] || [];

  // For departure+aeropuerto: user's origin is a local place stored as service.destination in DB
  // So filter by service.destination and return service.origin (airports) as destination options
  const isDeparture = directionType === 'departure' && transportType === 'aeropuerto';

  const relevantServices = services.filter(service =>
    isDeparture ? service.destination === originalOriginName : service.origin === originalOriginName
  );

  if (relevantServices.length === 0) {
    return;
  }

  // Get matching destinations
  const destinations = new Set();
  relevantServices.forEach(service => {
    if (isDeparture) {
      // Departure: only show airports as destinations
      if (service.origin && service.originServiceType && service.originServiceType.toLowerCase().includes('aeropuerto')) {
        destinations.add(service.origin);
      }
    } else {
      if (service.destination) {
        destinations.add(service.destination);
      }
    }
  });

  if (isDeparture) {
    // Departure: update destination SELECT with filtered airports
    const destSelect = document.getElementById('transportDestinationSelect');
    if (destSelect) {
      while (destSelect.options.length > 1) destSelect.remove(1);
      [...destinations].sort().forEach(location => {
        const option = document.createElement('option');
        const slugValue = location.toLowerCase().replace(/\s+/g, '-');
        option.value = slugValue;
        option.textContent = location;
        destSelect.appendChild(option);
        window.slugToOriginalMapping?.set(slugValue, location);
      });
    }
  } else {
    // Arrival/other: update destination datalists
    const datalists = [
      document.getElementById('transportDestinationList'),
      document.getElementById('roundTripDestinationList'),
    ];
    datalists.forEach(element => {
      if (!element) return;
      element.innerHTML = '';
      [...destinations].sort().forEach(location => {
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
  const quoteIdElement = document.querySelector('[data-quote-id]');
  if (quoteIdElement) {
    const { quoteId } = quoteIdElement.dataset;
    window.itineraryBuilder = new ItineraryBuilder(quoteId);
  }

  // Load active services from Services table for dropdowns
  loadActiveServicesForDropdowns();

  // Add event listeners for origin selectboxes to update destination combo boxes
  setTimeout(() => {
    // Use setTimeout to ensure the DOM elements are ready after async loading
    const originSelects = [
      document.getElementById('transportOriginSelect'),
      document.getElementById('roundTripOriginIdaSelect')
    ];

    originSelects.forEach((select, index) => {
      if (select) {
        console.log(`✅ Adding event listener to origin select ${index}:`, select.id);
        select.addEventListener('change', (e) => {
          const selectedOrigin = e.target.value;
          console.log(`🔄 Origin select ${index} changed to:`, selectedOrigin);

          // Clear destination fields when origin changes
          const destinationCombos = [
            document.getElementById('transportDestinationCombo'),
            document.getElementById('roundTripDestinationCombo')
          ];

          destinationCombos.forEach(combo => {
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
            console.log('Resetting to all destinations for transport type:', transportType);
            populateDropdownsForTransportType(transportType);
          }

          // Re-trigger transport price lookup if rate is already selected
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (window.itineraryBuilder && currentRateId) {
            window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          }
        });
      } else {
        console.log(`Origin select ${index} not found`);
      }
    });

    // Departure origin combo: filter destinations when user selects/types origin
    const originCombo = document.getElementById('transportOriginCombo');
    if (originCombo) {
      originCombo.addEventListener('input', (e) => {
        const selectedOrigin = e.target.value;

        // Clear destination select when origin changes
        const destSelect = document.getElementById('transportDestinationSelect');
        if (destSelect) destSelect.value = '';

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
    'CDMX'
  ];

  // Check if a location value matches the specific location list
  function locationNeedsSpecificField(value) {
    return needsSpecificLocation.some(loc =>
      value && value.toLowerCase().includes(loc.toLowerCase())
    );
  }

  // Show/hide specific location field based on origin OR destination value
  function checkSpecificLocationField() {
    const specificLocationRow = document.getElementById('specificLocationRow');
    if (!specificLocationRow) return;

    const originCombo = document.getElementById('transportOriginCombo')?.value || '';
    const destCombo = document.getElementById('transportDestinationCombo')?.value || '';
    const needsField = locationNeedsSpecificField(originCombo) || locationNeedsSpecificField(destCombo);

    if (needsField) {
      specificLocationRow.classList.remove('d-none');
    } else {
      specificLocationRow.classList.add('d-none');
      const specificLocationField = document.getElementById('transportSpecificLocation');
      if (specificLocationField) specificLocationField.value = '';
    }
  }


  // Add event listeners for destination combo boxes
  setTimeout(() => {
    const destinationCombos = [
      document.getElementById('transportDestinationCombo'),
      document.getElementById('roundTripDestinationCombo')
    ];

    destinationCombos.forEach(combo => {
      if (combo) {
        // Handle input changes
        combo.addEventListener('input', () => {
          checkSpecificLocationField();
        });

        // Handle selection from datalist - also trigger transport price lookup
        combo.addEventListener('change', (e) => {
          checkSpecificLocationField();
          // Re-trigger transport price lookup if rate is already selected
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (window.itineraryBuilder && currentRateId && e.target.value) {
            window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          }
        });
      }
    });
  }, 150);

  // Global debug functions for testing
  window.testOriginFiltering = function (origin) {
    console.log('🧪 Testing origin filtering for:', origin);
    updateDestinationsForOrigin(origin);
  };

  window.debugServices = function () {
    console.log('🔍 Current services data:', window.servicesByTransportType);
    console.log('🔍 Slug to original mapping:', window.slugToOriginalMapping);
    console.log('🔍 Origin elements:', [
      document.getElementById('transportOriginSelect'),
      document.getElementById('roundTripOriginIdaSelect')
    ]);
    console.log('🔍 Destination datalists:', [
      document.getElementById('transportDestinationList'),
      document.getElementById('roundTripDestinationList')
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

      // Clear breakdown panel on modal state init
      const breakdownPanel = document.getElementById('servicePriceBreakdown');
      if (breakdownPanel) breakdownPanel.classList.add('d-none');

      // Clear tour schedule when switching away from tour
      if (selectedType !== 'tour' && window.quoteServicesManager) {
        window.quoteServicesManager.clearTourSchedule();
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

      if (experiencePricingSection) {

      }

      // Initialize the modal state based on selected service type
      initializeModalState();

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
});
