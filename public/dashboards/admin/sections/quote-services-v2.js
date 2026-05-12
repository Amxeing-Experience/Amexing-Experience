/* eslint-env browser */
/* global bootstrap, GuideFormulaEvaluator */
/**
 * Quote Services V2 Controller - Travefy-inspired Itinerary Builder
 * Created by Denisse Maldonado.
 */

// Include the generic formula evaluator if not already loaded
if (typeof GuideFormulaEvaluator === 'undefined') {
  const script = document.createElement('script');
  script.src = '/js/guide-formula-evaluator.js';
  document.head.appendChild(script);
}

class ItineraryBuilder {
  constructor(quoteId) {
    this.quoteId = quoteId;
    this.days = [];
    this.services = new Map();
    // Debug function for checkbox state
    window.debugTourOverride = () => {
      const checkbox = document.getElementById('tourOverridePrices');
      const parentCheck = checkbox?.closest('.form-check');
      console.log('Debug Tour Override Checkbox:', {
        element: checkbox,
        exists: !!checkbox,
        checked: checkbox?.checked,
        indeterminate: checkbox?.indeterminate,
        disabled: checkbox?.disabled,
        value: checkbox?.value,
        className: checkbox?.className,
        hasCheckedAttr: checkbox?.hasAttribute('checked'),
        parentElement: checkbox?.parentElement,
        parentClasses: parentCheck?.className,
        parentHasChecked: parentCheck?.classList.contains('checked'),
        innerHTML: checkbox?.outerHTML,
      });
      // Try to fix the state if there's a mismatch
      if (checkbox && parentCheck?.classList.contains('checked') && !checkbox.checked) {
        console.log('🔧 Fixing checkbox state mismatch');
        checkbox.checked = true;
        checkbox.setAttribute('checked', 'checked');
      }
      return checkbox?.checked;
    };

    // Manual toggle function for the checkbox
    window.toggleTourOverride = () => {
      const checkbox = document.getElementById('tourOverridePrices');
      if (checkbox) {
        // Toggle the state
        checkbox.checked = !checkbox.checked;
        // Trigger change event
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✅ Tour override toggled to: ${checkbox.checked}`);
        return checkbox.checked;
      }
      console.log('❌ Checkbox not found');
      return false;
    };

    // Force check the checkbox with debugging
    window.checkTourOverride = () => {
      const checkbox = document.getElementById('tourOverridePrices');
      console.log('Checkbox element:', checkbox);
      console.log('Before: checked =', checkbox?.checked, 'disabled =', checkbox?.disabled);

      if (checkbox) {
        // Remove any disabled state
        checkbox.disabled = false;
        checkbox.removeAttribute('disabled');

        // Force check it
        checkbox.checked = true;
        checkbox.setAttribute('checked', 'checked');

        console.log('After: checked =', checkbox.checked, 'disabled =', checkbox.disabled);

        // Trigger change event
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // Double check it stayed checked
        setTimeout(() => {
          console.log('After 100ms: checked =', checkbox.checked);
          if (!checkbox.checked) {
            console.error('❌ Something is unchecking the checkbox!');
          }
        }, 100);

        return checkbox.checked;
      }
      console.log('❌ Checkbox not found');
      return false;
    };

    this.currentDayId = null;
    this.currentServiceId = null;
    this.editMode = null; // 'day' or 'service'
    this.autoSaveTimer = null;
    this.hasUnsavedChanges = false;
    this.saveInProgress = false;

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
    this.guideFormulaConfigCache = null;
    this.greeterRateCache = null;
    this.greeterRateCacheTime = null;
    this.transferRateCache = null;

    // Loading states to prevent duplicate API calls
    this.loadingStates = {
      guideTransportRate: false,
      guideFormulaConfig: false,
      driverTourRate: false,
      agencyRate: false,
      transferRate: false,
      vehicleRatePrices: false,
    };

    // Transport route pricing cache
    this.transportPriceData = null;

    // Vehicle rate prices cache (Tiempo de espera)
    this.vehicleRatePricesCache = [];

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

    // Role-based price editing
    this.userRole = window.userRole || 'client';
    this.canEditPrices = ['admin', 'superadmin'].includes(this.userRole);

    // Store calculated prices for restoration
    this.calculatedPrices = {
      experience: { adult: 0, child: 0, noAlcohol: 0 },
      tour: { adult: 0, child: 0, noAlcohol: 0 },
      transport: 0,
      aDisposicion: 0,
    };

    // Note: init() is called manually from DOMContentLoaded to avoid double initialization
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

      // Ensure GuideFormulaEvaluator is ready before continuing
      if (typeof GuideFormulaEvaluator !== 'undefined') {
        console.log('⏳ Waiting for guide formula evaluator to be ready...');
        try {
          await GuideFormulaEvaluator.ready();
          console.log('✅ Guide formula evaluator ready with config:', GuideFormulaEvaluator.formulaConfig);
        } catch (error) {
          console.warn('⚠️ Could not load guide formula evaluator, using fallback:', error);
        }
      }

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
        this.loadGuideFormulaConfiguration(),
        this.loadGreeterRateConfiguration(),
        this.loadVehicleRatePrices(),
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

      // Initialize continue button state
      this.updateContinueButton('saved');

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

      // Signal that caches are ready for the drag catalog
      document.dispatchEvent(new CustomEvent('itinerary-caches-ready'));
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
    // Price validation functions - define at the beginning to avoid reference errors
    const validatePriceInput = (e) => {
      const input = e.target;
      let { value } = input;

      // Remove any non-numeric characters except decimal point
      value = value.replace(/[^0-9.]/g, '');

      // Ensure only one decimal point
      const parts = value.split('.');
      if (parts.length > 2) {
        value = `${parts[0]}.${parts.slice(1).join('')}`;
      }

      // Limit to 2 decimal places
      if (parts.length === 2 && parts[1].length > 2) {
        value = `${parts[0]}.${parts[1].substring(0, 2)}`;
      }

      // Update the input value
      if (input.value !== value) {
        input.value = value;
      }
    };

    // Prevent invalid characters on keypress
    const preventInvalidPriceChars = (e) => {
      // Allow: backspace, delete, tab, escape, enter, decimal point
      if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1
          // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
          || (e.keyCode === 65 && e.ctrlKey === true)
          || (e.keyCode === 67 && e.ctrlKey === true)
          || (e.keyCode === 86 && e.ctrlKey === true)
          || (e.keyCode === 88 && e.ctrlKey === true)
          // Allow: home, end, left, right
          || (e.keyCode >= 35 && e.keyCode <= 39)) {
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
    const handlePricePaste = (e) => {
      e.preventDefault();
      const clipboard = e.clipboardData || window.clipboardData;
      const pastedText = clipboard ? clipboard.getData('text') : '';
      // Clean the pasted text
      let cleanedText = pastedText.replace(/[^0-9.]/g, '');
      // Ensure only one decimal point
      const parts = cleanedText.split('.');
      if (parts.length > 2) {
        cleanedText = `${parts[0]}.${parts.slice(1).join('')}`;
      }
      // Insert cleaned text at cursor position
      const input = e.target;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const currentValue = input.value;
      input.value = currentValue.substring(0, start) + cleanedText + currentValue.substring(end);
      // Trigger input event to apply full validation
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

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

    // Additional vehicle checkbox for transport
    document.getElementById('additionalVehicleCheckbox')?.addEventListener('change', (e) => {
      const qty = document.getElementById('serviceQuantity');
      if (qty) {
        // Context-aware quantity calculation
        const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        const baseQuantity = (tripType === 'round-trip') ? 2 : 1;
        const newQuantity = e.target.checked ? (baseQuantity * 2) : baseQuantity;
        qty.value = newQuantity;

        console.log(`🚗 Additional vehicle ${e.target.checked ? 'checked' : 'unchecked'}: tripType=${tripType}, baseQuantity=${baseQuantity}, newQuantity=${newQuantity}`);
      }
      this.updateServicePriceBreakdown();
    });

    // Walking tour quantity inputs → update total people count for tier pricing
    ['walkingTourAdultsQuantity', 'walkingTourChildrenQuantity', 'walkingTourInfantsQuantity'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        const adults = parseInt(document.getElementById('walkingTourAdultsQuantity')?.value || 0);
        const children = parseInt(document.getElementById('walkingTourChildrenQuantity')?.value || 0);
        const infants = parseInt(document.getElementById('walkingTourInfantsQuantity')?.value || 0);
        const total = adults + children + infants;
        const peopleCountField = document.getElementById('walkingTourPeopleCount');
        if (peopleCountField) peopleCountField.value = total || 1;
        // Re-highlight tier based on new total
        if (this.currentTourData) this.highlightWalkingTourTier(this.currentTourData);
        this.updateServicePriceBreakdown();
      });
    });

    // Walking tour manual price input → validate and update breakdown
    const walkingManualField = document.getElementById('walkingTourManualPrice');
    if (walkingManualField) {
      walkingManualField.addEventListener('input', (e) => {
        validatePriceInput(e);
        this.updateServicePriceBreakdown();
      });
      walkingManualField.addEventListener('keydown', preventInvalidPriceChars);
      walkingManualField.addEventListener('paste', handlePricePaste);
    }

    // Walking tour pricing mode toggle handlers
    document.getElementById('walkingPriceModeTotal')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        handleWalkingPriceModeChange('total');
      }
    });

    document.getElementById('walkingPriceModeGroup')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        handleWalkingPriceModeChange('group');
      }
    });

    // Transport Type Toggle
    document.querySelectorAll('input[name="transportType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleTransportTypeChange());
    });

    // Show specific location when destination is selected (arrival only — destination is city/hotel)
    document.getElementById('transportDestinationSelect')?.addEventListener('change', (e) => {
      const arrivalRadio = document.getElementById('typeArrival');
      if (!arrivalRadio?.checked) return; // Only for arrival — destination is city
      const specificLocationRow = document.getElementById('specificLocationRow');
      const selectedNames = document.querySelectorAll('.selectedDestinationName');
      if (specificLocationRow) {
        if (e.target.value) {
          selectedNames.forEach((el) => { el.textContent = e.target.options[e.target.selectedIndex]?.text || ''; });
          specificLocationRow.classList.remove('d-none');
        } else {
          specificLocationRow.classList.add('d-none');
        }
      }
    });

    // Show specific location when origin is selected (departure only — origin is city/hotel)
    document.getElementById('transportOriginSelect')?.addEventListener('change', (e) => {
      const arrivalRadio = document.getElementById('typeArrival');
      if (arrivalRadio?.checked) return; // Skip for arrival — origin is airport
      const specificLocationRow = document.getElementById('specificLocationRow');
      const selectedNames = document.querySelectorAll('.selectedDestinationName');
      if (specificLocationRow) {
        if (e.target.value) {
          selectedNames.forEach((el) => { el.textContent = e.target.options[e.target.selectedIndex]?.text || ''; });
          specificLocationRow.classList.remove('d-none');
        } else {
          specificLocationRow.classList.add('d-none');
        }
      }
    });

    // Show specific location for round trip Ida destination select (arrival)
    document.getElementById('roundTripDestinationIdaSelect')?.addEventListener('change', (e) => {
      const row = document.getElementById('roundTripSpecificLocationIdaRow');
      const selectedNames = document.querySelectorAll('.selectedDestinationName');
      if (row) {
        if (e.target.value) {
          selectedNames.forEach((el) => { el.textContent = e.target.options[e.target.selectedIndex]?.text || ''; });
          row.classList.remove('d-none');
        } else {
          row.classList.add('d-none');
        }
      }
    });

    // Show specific location for round trip Vuelta origin select (departure)
    document.getElementById('roundTripOriginVueltaSelect')?.addEventListener('change', (e) => {
      const row = document.getElementById('roundTripSpecificLocationVueltaRow');
      const selectedNames = document.querySelectorAll('.selectedDestinationName');
      if (row) {
        if (e.target.value) {
          selectedNames.forEach((el) => { el.textContent = e.target.options[e.target.selectedIndex]?.text || ''; });
          row.classList.remove('d-none');
        } else {
          row.classList.add('d-none');
        }
      }
    });

    // Trip Type Toggle
    document.querySelectorAll('input[name="tripType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleTripTypeChange());
    });

    // Direction Type Toggle (Arrival/Departure)
    document.querySelectorAll('input[name="directionType"]').forEach((radio) => {
      radio.addEventListener('change', () => this.handleDirectionTypeChange());
    });

    // Restore persisted currency and payment type selections (scoped per quote)
    const quoteKey = this.quoteId || 'default';
    const savedCurrency = sessionStorage.getItem(`quoteServices_currency_${quoteKey}`);
    const savedPaymentType = sessionStorage.getItem(`quoteServices_paymentType_${quoteKey}`);
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
      sessionStorage.setItem(`quoteServices_currency_${quoteKey}`, e.target.value);
      this.renderDaysContent();
      this.updateTotals();
      this.updateServicePriceBreakdown();
      this.hasUnsavedChanges = true;
      this.scheduleAutoSave();
    });

    // Payment type change listener
    priceTypeSelect?.addEventListener('change', (e) => {
      sessionStorage.setItem(`quoteServices_paymentType_${quoteKey}`, e.target.value);
      this.renderDaysContent();
      this.updateTotals();
      this.updateServicePriceBreakdown();
      this.hasUnsavedChanges = true;
      this.scheduleAutoSave();
    });

    // Experience selection handler
    document.getElementById('experienceSelect')?.addEventListener('change', (e) => {
      this.handleExperienceSelection(e.target.value);
    });

    // Tour selection handler
    document.getElementById('tourSelect')?.addEventListener('change', (e) => {
      this.handleTourSelection(e.target.value);
    });

    // Price Override Toggle Handlers (Admin Only)
    if (this.canEditPrices) {
      // Experience price override toggle
      document.getElementById('experienceOverridePrices')?.addEventListener('change', (e) => {
        this.handlePriceOverrideToggle('experience', e.target.checked);
      });

      // Tour price override toggle - SIMPLE like additionalVehicleCheckbox
      const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
      if (tourOverrideCheckbox) {
        tourOverrideCheckbox.addEventListener('change', (e) => {
          // Note: Removed checkbox change log for console cleanup
          this.handlePriceOverrideToggle('tour', e.target.checked);
        });
      }

      // Tour vehicle price override toggle (for vehicle tours with transport)
      document.getElementById('tourVehicleOverridePrices')?.addEventListener('change', (e) => {
        const servicePriceField = document.getElementById('servicePrice');
        if (servicePriceField) {
          servicePriceField.readOnly = !e.target.checked;
          if (e.target.checked) {
            servicePriceField.classList.add('price-override-active');
          } else {
            servicePriceField.classList.remove('price-override-active');
            // Re-trigger vehicle selection to restore calculated price
            const vehicleSelect = document.getElementById('vehicleSelect');
            if (vehicleSelect?.value) {
              this.handleVehicleSelection(vehicleSelect.value);
            }
          }
        }
        this.updateServicePriceBreakdown();
      });

      // Transport price override toggle
      document.getElementById('transportOverridePrices')?.addEventListener('change', (e) => {
        this.handlePriceOverrideToggle('transport', e.target.checked);
      });

      // A Disposición price override toggle
      document.getElementById('aDisposicionOverridePrices')?.addEventListener('change', (e) => {
        this.handlePriceOverrideToggle('aDisposicion', e.target.checked);
      });
    }

    // Tour requires transport checkbox handler
    document.getElementById('tourRequiresTransport')?.addEventListener('change', (e) => {
      this.handleTourTransportToggle(e.target.checked);
      this.updateVehicleCapacityNote();
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
        // Hide "Viaja en el vehículo" since greeter is unchecked
        const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
        if (greeterInVehicleContainer) greeterInVehicleContainer.classList.add('d-none');
        const greeterInVehicle = document.getElementById('greeterInVehicle');
        if (greeterInVehicle) greeterInVehicle.checked = false;
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
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      servicePriceField.addEventListener('input', (e) => {
        // Check if field should be readonly based on service type and override state
        const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
        if (serviceType === 'tour') {
          const isOverrideChecked = document.getElementById('tourOverridePrices')?.checked || false;
          const storedService = this.currentServiceId ? this.services.get(this.currentServiceId) : null;

          if (!isOverrideChecked && !storedService?.priceOverride) {
            console.warn('⚠️ Tour price edit - override not checked. Allowing edit for testing.');
            // For now, allow the edit but log warning
          }
        }
        validatePriceInput(e);
        this.updateServicePriceBreakdown();
      });
      servicePriceField.addEventListener('keydown', preventInvalidPriceChars);
      servicePriceField.addEventListener('paste', handlePricePaste);
    }

    // Quantity change listener - recalculate transport price and update breakdown
    document.getElementById('serviceQuantity')?.addEventListener('change', () => {
      const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
      if (serviceType === 'transport') {
        this.recalculateTransportPrice();
      }
      this.updateServicePriceBreakdown();
    });

    // People quantity inputs - update breakdown when quantities change
    ['tourAdultsQuantity', 'tourChildrenQuantity', 'tourInfantsQuantity',
      'adultsQuantity', 'childrenQuantity', 'adultsNoAlcoholQuantity',
      'conceptoAdultsQuantity', 'conceptoChildrenQuantity', 'conceptoAdultsNoAlcoholQuantity'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        this.updateServicePriceBreakdown();
      });
    });

    // Tour start time listener - auto-calculate end time
    document.getElementById('tourStartTime')?.addEventListener('change', () => {
      this.calculateTourEndTime();
    });

    // Tour duration field listener - validate, calculate end time, and update pricing
    document.getElementById('tourDuration')?.addEventListener('change', () => {
      this.validateTourDuration();
      this.calculateTourEndTime();
      this.recalculateTourPrice();
      this.updateServicePriceBreakdown();
    });

    // Tour/Experience price inputs - update breakdown when prices change and validate input
    ['tourAdultPrice', 'tourChildPrice', 'tourNoAlcoholPrice',
      'adultPrice', 'childPrice', 'noAlcoholPrice'].forEach((id) => {
      const field = document.getElementById(id);
      if (field) {
        field.addEventListener('input', (e) => {
          validatePriceInput(e);
          this.updateServicePriceBreakdown();
        });
        field.addEventListener('keydown', preventInvalidPriceChars);
        field.addEventListener('paste', handlePricePaste);
      }
    });

    // Concepto schedule checkbox handler
    document.getElementById('conceptoHasSchedule')?.addEventListener('change', (e) => {
      this.handleConceptoScheduleToggle(e.target.checked);
    });

    // Walking tour people count - update tier highlight and price
    document.getElementById('walkingTourPeopleCount')?.addEventListener('input', () => {
      const tourSelect = document.getElementById('tourSelect');
      if (tourSelect?.value && this.toursCache.has('all')) {
        const selectedTour = this.toursCache.get('all').find(
          (t) => t.id === tourSelect.value || t.objectId === tourSelect.value
        );
        if (selectedTour?.isWalkingTour) {
          this.highlightWalkingTourTier(selectedTour);
          this.updateServicePriceBreakdown();
        }
      }
    });

    // Time input formatting and validation
    this.setupTimeInputs();

    // Delete Confirmation
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', () => this.confirmDelete());

    // A Disposición - rate, vehicle, hours, vehicle count
    document.getElementById('aDisposicionRate')?.addEventListener('change', (e) => {
      this.handleADisposicionRateChange(e.target.value);
    });
    document.getElementById('aDisposicionVehicle')?.addEventListener('change', () => {
      this.calculateADisposicionPrice();
    });
    document.getElementById('aDisposicionHours')?.addEventListener('input', () => {
      this.calculateADisposicionPrice();
    });
    document.getElementById('aDisposicionVehicleCount')?.addEventListener('input', () => {
      this.calculateADisposicionPrice();
    });

    // Waiting time hours listener (Transport)
    document.getElementById('waitingTimeHours')?.addEventListener('input', () => {
      // Don't recalculate price for transport (keep vehicle price only)
      // Just update the breakdown to show the waiting time cost
      this.updateServicePriceBreakdown();
    });

    // Preview
    document.getElementById('previewItineraryBtn')?.addEventListener('click', () => this.showPreview());
    document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.exportPdf());

    // Continue to Summary Button
    document.getElementById('continueToSummaryBtn')?.addEventListener('click', () => {
      // Only allow navigation if quote is fully saved
      if (!this.hasUnsavedChanges && !this._saveInProgress) {
        const quoteId = document.querySelector('[data-quote-id]')?.getAttribute('data-quote-id');
        if (quoteId) {
          // Detect dashboard context to construct correct URL
          const currentPath = window.location.pathname;
          let dashboardType = 'admin'; // default

          if (currentPath.includes('/dashboard/client/')) {
            dashboardType = 'client';
          } else if (currentPath.includes('/dashboard/department_manager/')) {
            dashboardType = 'department_manager';
          }

          window.location.href = `/dashboard/${dashboardType}/quotes/${quoteId}?section=summary`;
        }
      }
    });

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

    // Update continue button state
    this.updateContinueButton(status);
  }

  updateContinueButton(status) {
    const continueBtn = document.getElementById('continueToSummaryBtn');
    const continueText = document.getElementById('continueButtonText');

    if (!continueBtn || !continueText) return;

    // Check if quote is fully saved and ready to continue
    const isReadyToContinue = status === 'saved' && !this.hasUnsavedChanges && !this._saveInProgress;

    if (isReadyToContinue) {
      // Enable button for continuation
      continueBtn.disabled = false;
      continueBtn.className = 'btn btn-primary btn-lg px-4 py-2';
      continueText.textContent = 'Continuar al Resumen';
    } else {
      // Disable button and show appropriate message
      continueBtn.disabled = true;
      continueBtn.className = 'btn btn-secondary btn-lg px-4 py-2';

      if (status === 'saving' || this._saveInProgress) {
        continueText.textContent = 'Guardando cambios...';
      } else if (status === 'error') {
        continueText.textContent = 'Error - Guardar primero';
      } else if (this.hasUnsavedChanges) {
        continueText.textContent = 'Guardar cambios primero';
      } else {
        continueText.textContent = 'Continuar al Resumen';
      }
    }
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
    let title = document.getElementById('dayTitle').value.trim();
    const date = document.getElementById('dayDate').value;
    const description = document.getElementById('dayDescription').value.trim();

    // Clear any previous modal alerts
    this.clearModalAlert('dayModalAlert');

    // Auto-generate title if empty
    if (!title) {
      const dayNumber = this.days.length + 1;
      title = `Día ${dayNumber}`;
    }

    // Get button element and set loading state
    const saveBtn = document.getElementById('saveDayBtn');
    const originalContent = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Guardando...';
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
    } finally {
      // Restore button state
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalContent;
      }
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

  // Helper method to prefill people fields from quote data
  prefillPeopleFields() {
    // Check if quote data is available (loaded from API)
    if (!this.quoteData) {
      this.pendingPrefillRequest = true;
      return;
    }

    // Read values from cached quote data
    const numberOfAdults = this.quoteData.numberOfAdults || 0;
    const numberOfChildren = this.quoteData.numberOfChildren || 0;
    const numberOfInfants = this.quoteData.numberOfInfants || 0;

    // Tour fields
    const tourAdultsField = document.getElementById('tourAdultsQuantity');
    const tourChildrenField = document.getElementById('tourChildrenQuantity');
    const tourInfantsField = document.getElementById('tourInfantsQuantity');

    if (tourAdultsField) tourAdultsField.value = numberOfAdults || '';
    if (tourChildrenField) tourChildrenField.value = numberOfChildren || '';
    if (tourInfantsField) tourInfantsField.value = numberOfInfants || '';

    // Walking tour fields
    const walkingAdultsField = document.getElementById('walkingTourAdultsQuantity');
    const walkingChildrenField = document.getElementById('walkingTourChildrenQuantity');
    const walkingInfantsField = document.getElementById('walkingTourInfantsQuantity');

    if (walkingAdultsField) walkingAdultsField.value = numberOfAdults || '';
    if (walkingChildrenField) walkingChildrenField.value = numberOfChildren || '';
    if (walkingInfantsField) walkingInfantsField.value = numberOfInfants || '';

    // Transport fields
    const transportAdultsField = document.getElementById('transportAdults');
    const transportChildrenField = document.getElementById('transportChildren');
    const transportInfantsField = document.getElementById('transportInfants');

    if (transportAdultsField) transportAdultsField.value = numberOfAdults || '';
    if (transportChildrenField) transportChildrenField.value = numberOfChildren || '';
    if (transportInfantsField) transportInfantsField.value = numberOfInfants || '';

    // Experience fields (only adults and children)
    const experienceAdultsField = document.getElementById('adultsQuantity');
    const experienceChildrenField = document.getElementById('childrenQuantity');

    if (experienceAdultsField) experienceAdultsField.value = numberOfAdults;
    if (experienceChildrenField) experienceChildrenField.value = numberOfChildren;

    // Concepto fields (auto-fill from quote information)
    const conceptoAdultsField = document.getElementById('conceptoAdultsQuantity');
    const conceptoChildrenField = document.getElementById('conceptoChildrenQuantity');

    if (conceptoAdultsField) conceptoAdultsField.value = numberOfAdults || '';
    if (conceptoChildrenField) conceptoChildrenField.value = numberOfChildren || '';
    // Note: conceptoAdultsNoAlcoholQuantity stays empty (no corresponding quote data)
  }

  // Service Management Methods
  openServiceModal(dayId, serviceId = null) {
    this.editMode = 'service';
    this.currentDayId = dayId;
    this.currentServiceId = serviceId;
    this.currentServiceAvailabilityPending = false;

    const modal = new bootstrap.Modal(document.getElementById('serviceModal'));
    const form = document.getElementById('serviceForm');

    // Load day-specific data
    this.loadDayExperiences(dayId);
    this.loadDayTours(dayId);

    // Populate rates dropdown when modal opens
    this.populateRatesDropdown();

    // Build day label for modal title
    const dayInfo = this.days.find((d) => d.id === dayId);
    let dayLabel = '';
    if (dayInfo?.date) {
      const date = new Date(`${dayInfo.date}T12:00:00`);
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      dayLabel = ` - ${dayNames[date.getDay()]} ${date.getDate()} de ${monthNames[date.getMonth()]}`;
    }

    // Reset or populate form
    if (serviceId && this.services.has(serviceId)) {
      const originalService = this.services.get(serviceId);

      // Debug: Log what service data is retrieved from Map for walking tours
      if (originalService.isWalkingTour || (originalService.concept && originalService.concept.toLowerCase().includes('pie'))) {
        console.log('🔄 Retrieved walking tour from services Map for edit:', {
          serviceId,
          retrievedPeopleData: {
            adultsQuantity: originalService.adultsQuantity,
            childrenQuantity: originalService.childrenQuantity,
            infantsQuantity: originalService.infantsQuantity,
            walkingTourPeopleCount: originalService.walkingTourPeopleCount,
          },
          isWalkingTour: originalService.isWalkingTour,
          concept: originalService.concept,
          allServiceKeys: Object.keys(originalService),
        });
      }

      // CRITICAL FIX: Create a deep copy of the service object to prevent reference corruption
      // This ensures that modifications during populateServiceForm don't affect the original in the Map
      const service = JSON.parse(JSON.stringify(originalService));

      console.log('🔒 Created service copy to prevent Map corruption');

      document.getElementById('serviceModalLabel').innerHTML = `<i class="ti ti-pencil me-2"></i>Editar Servicio${dayLabel}`;
      this.populateServiceForm(service);
    } else {
      document.getElementById('serviceModalLabel').innerHTML = `<i class="ti ti-plus-circle me-2"></i>Agregar Servicio${dayLabel}`;
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

      // Hide details cards
      this.hideDetailsCard('experience');
      this.hideDetailsCard('tour');

      // Clear tour transport checkbox
      const tourRequiresTransport = document.getElementById('tourRequiresTransport');
      if (tourRequiresTransport) {
        tourRequiresTransport.checked = false;
      }

      // Clear vehicle dropdown and transport price cache
      this.clearVehicleDropdown();
      this.transportPriceData = null;

      // Clear vehicle capacity note and greeter sub-checkbox
      const capacityNote = document.getElementById('vehicleCapacityNote');
      if (capacityNote) capacityNote.classList.add('d-none');
      const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
      if (greeterInVehicleContainer) greeterInVehicleContainer.classList.add('d-none');

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

    // Hide additional vehicle checkbox (shown only for transport)
    document.getElementById('additionalVehicleContainer')?.classList.add('d-none');

    // Clear guide/greeter checkboxes and re-enable when switching service types
    const includeGuideEl = document.getElementById('includeGuide');
    const includeGreeterEl = document.getElementById('includeGreeter');
    const greeterInVehicleEl = document.getElementById('greeterInVehicle');
    if (includeGuideEl) { includeGuideEl.checked = false; includeGuideEl.disabled = false; }
    if (includeGreeterEl) includeGreeterEl.checked = false;
    if (greeterInVehicleEl) greeterInVehicleEl.checked = false;
    document.getElementById('greeterInVehicleContainer')?.classList.add('d-none');
    document.getElementById('vehicleCapacityNote')?.classList.add('d-none');

    // Save current service type fields before switching
    this.saveCurrentServiceTypeFields();

    // Hide all content sections
    document.querySelectorAll('.service-content').forEach((content) => {
      content.classList.add('d-none');
    });

    // Hide all price override toggles first (admin only)
    if (this.canEditPrices) {
      document.getElementById('experienceOverridePrices')?.parentElement?.classList.add('d-none');
      document.getElementById('tourOverridePricesContainer')?.classList.add('d-none');
      document.getElementById('tourVehicleOverridePricesContainer')?.classList.add('d-none');
      document.getElementById('transportOverridePricesContainer')?.classList.add('d-none');
      document.getElementById('aDisposicionOverridePricesContainer')?.classList.add('d-none');
    }

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

    // Hide "Incluir en total" checkbox for all types except concepto
    if (type !== 'concepto') {
      document.getElementById('includeInTotalContainer')?.style.setProperty('display', 'none');
    }

    // Show/hide transport-specific selectors
    const transportTypeSelector = document.getElementById('transportTypeSelector');
    const tripTypeSelector = document.getElementById('tripTypeSelector');
    const tourTransportCheckbox = document.getElementById('tourTransportCheckboxContainer');
    const transportPeopleFieldsRow = document.getElementById('transportPeopleFieldsRow');

    // Show/hide Tiempo de espera section
    const tiempoEsperaSection = document.getElementById('tiempoEsperaSection');

    if (type === 'transport') {
      transportTypeSelector?.classList.remove('d-none');
      tripTypeSelector?.classList.remove('d-none');
      tiempoEsperaSection?.classList.remove('d-none');
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
      tiempoEsperaSection?.classList.add('d-none');
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
      tiempoEsperaSection?.classList.add('d-none');
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

    // Show/hide Greeter checkbox (only for Transport)
    const greeterCheckboxContainer = document.getElementById('greeterCheckboxContainer');
    const greeterInVehicleContainer = document.getElementById('greeterInVehicleContainer');
    const includeGreeter = document.getElementById('includeGreeter');
    const greeterInVehicle = document.getElementById('greeterInVehicle');
    if (type === 'transport') {
      if (greeterCheckboxContainer) greeterCheckboxContainer.classList.remove('d-none');
    } else {
      if (greeterCheckboxContainer) greeterCheckboxContainer.classList.add('d-none');
      if (greeterInVehicleContainer) greeterInVehicleContainer.classList.add('d-none');
      if (includeGreeter) includeGreeter.checked = false;
      if (greeterInVehicle) greeterInVehicle.checked = false;
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

    if (type === 'concepto' || type === 'experience' || type === 'a-disposicion') {
      // Hide category, vehicle and guide for Concepto and Experience
      categoryField?.classList.add('d-none');
      vehicleField?.classList.add('d-none');
      guideField?.classList.add('d-none');

      // Remove required from category for both, but handle price differently
      document.getElementById('transportCategory')?.removeAttribute('required');

      if (type === 'concepto') {
        // Show "Incluir en total" checkbox only for Concepto
        document.getElementById('includeInTotalContainer')?.style.setProperty('display', '');

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

        // Auto-fill concepto fields from quote information (only for new services)
        if (!this.currentServiceId && this.quoteData) {
          this.prefillPeopleFields();
        }
      } else if (type === 'a-disposicion') {
        // Hide quantity field for A Disposición
        quantityField?.classList.add('d-none');
        document.getElementById('serviceQuantity')?.removeAttribute('required');

        // Price, currency and price type are required for A Disposición
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

        // Populate rate dropdown for A Disposición
        this.populateADisposicionRates();
      } else {
        // Hide quantity field for Experience (uses its own quantity fields)
        quantityField?.classList.add('d-none');
        document.getElementById('serviceQuantity')?.removeAttribute('required');

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

        // Hide quantity input, show additional vehicle checkbox (same as transport)
        quantityField?.classList.add('d-none');
        document.getElementById('serviceQuantity')?.removeAttribute('required');
        document.getElementById('serviceQuantity').value = 1;
        document.getElementById('additionalVehicleContainer')?.classList.remove('d-none');
        document.getElementById('additionalVehicleCheckbox').checked = false;

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

      // Hide quantity input, show additional vehicle checkbox for Transport
      quantityField?.classList.add('d-none');
      document.getElementById('serviceQuantity')?.removeAttribute('required');
      document.getElementById('serviceQuantity').value = 1;
      document.getElementById('additionalVehicleContainer')?.classList.remove('d-none');
      document.getElementById('additionalVehicleCheckbox').checked = false;

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
      'a-disposicion': 'aDisposicionContent',
      concepto: 'conceptoContent',
    };

    const contentId = contentMap[type];
    if (contentId) {
      document.getElementById(contentId)?.classList.remove('d-none');
    }

    // Show the appropriate price override toggle (admin only)
    // And set readonly state for servicePrice based on service type
    const servicePriceField = document.getElementById('servicePrice');
    if (this.canEditPrices) {
      if (type === 'experience') {
        document.getElementById('experienceOverridePrices')?.parentElement?.classList.remove('d-none');
      } else if (type === 'tour') {
        document.getElementById('tourOverridePricesContainer')?.classList.remove('d-none');
        // Tour price should be readonly unless override is checked
        const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
        if (servicePriceField && tourOverrideCheckbox) {
          const shouldBeReadonly = !tourOverrideCheckbox.checked;
          servicePriceField.readOnly = shouldBeReadonly;
          console.log('🔐 Setting tour price field readonly state:', {
            checked: tourOverrideCheckbox.checked,
            readonly: shouldBeReadonly,
            currentValue: servicePriceField.value,
          });
          // Also set disabled attribute for better enforcement
          if (shouldBeReadonly) {
            servicePriceField.classList.add('readonly-price');
            servicePriceField.style.backgroundColor = '#f5f5f5';
            servicePriceField.setAttribute('data-readonly', 'true');
          } else {
            servicePriceField.classList.remove('readonly-price');
            servicePriceField.style.backgroundColor = '';
            servicePriceField.removeAttribute('data-readonly');
          }
        }
      } else if (type === 'transport') {
        document.getElementById('transportOverridePricesContainer')?.classList.remove('d-none');
        // Transport price should be readonly unless override is checked
        if (servicePriceField) {
          servicePriceField.readOnly = !document.getElementById('transportOverridePrices')?.checked;
        }
      } else if (type === 'a-disposicion') {
        document.getElementById('aDisposicionOverridePricesContainer')?.classList.remove('d-none');
        // A disposición price should be readonly unless override is checked
        if (servicePriceField) {
          servicePriceField.readOnly = !document.getElementById('aDisposicionOverridePrices')?.checked;
        }
      }
    } else {
      // Non-admin users cannot edit prices for transport/a-disposicion
      if (servicePriceField && (type === 'transport' || type === 'a-disposicion')) {
        servicePriceField.readOnly = true;
      }
    }

    // Concepto always allows manual price entry
    if (type === 'concepto' && servicePriceField) {
      servicePriceField.readOnly = false;
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

    // Prefill people fields from information step when switching to new service type
    // Only for new services, not when editing existing ones
    if (!this.currentServiceId) {
      // Use setTimeout to ensure DOM elements are ready after service type switch
      setTimeout(() => {
        this.prefillPeopleFields();
      }, 100); // Increased from 50ms to 100ms for better DOM readiness
    }
  }

  // Handle price override toggle for admin users
  handlePriceOverrideToggle(serviceType, isOverride) {
    console.log(`🔄 Price override toggle for ${serviceType}: ${isOverride}`);

    // Special handling for walking tours
    if (serviceType === 'tour') {
      const tourSelect = document.getElementById('tourSelect');
      const selectedTourId = tourSelect?.value;

      if (selectedTourId && this.toursCache.has('all')) {
        const tours = this.toursCache.get('all');
        const selectedTour = tours.find((tour) => tour.id === selectedTourId || tour.objectId === selectedTourId);

        // Handle walking tours differently - DISABLED FOR NOW
        if (selectedTour?.isWalkingTour) {
          // Walking tour price override is temporarily disabled
          // Always hide price override UI for walking tours
          const walkingTourManualPriceContainer = document.getElementById('walkingTourManualPriceContainer');
          const walkingTourManualPrice = document.getElementById('walkingTourManualPrice');
          const walkingTierCards = document.querySelectorAll('.walking-tier-card');

          // Always hide manual price field and disable it for walking tours
          walkingTourManualPriceContainer?.classList.add('d-none');
          if (walkingTourManualPrice) {
            walkingTourManualPrice.classList.remove('price-override-active');
            walkingTourManualPrice.value = '';
          }

          // Restore tier pricing cards visibility
          walkingTierCards.forEach((card) => card.style.opacity = '1');

          // Re-calculate tier pricing
          this.updateWalkingTourPricing();

          // Update the breakdown
          this.updateServicePriceBreakdown();
          return; // Exit early for walking tours
        }
      }
    }

    // Map service types to price field IDs (for non-walking tours)
    const priceFieldMap = {
      experience: ['adultPrice', 'childPrice', 'noAlcoholPrice'],
      tour: ['servicePrice', 'tourAdultPrice', 'tourChildPrice', 'tourNoAlcoholPrice'], // Tour main price + individual fields
      transport: ['servicePrice'], // Transport has single price field
      aDisposicion: ['servicePrice'], // A Disposición has single price field
    };

    const fields = priceFieldMap[serviceType] || [];

    fields.forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) {
        if (isOverride) {
          // Enable manual editing
          field.readOnly = false;
          field.removeAttribute('readonly'); // Force remove readonly attribute
          field.classList.add('price-override-active');
          field.style.backgroundColor = ''; // Clear gray background
          // Note: Removed field editing log for console cleanup
        } else {
          // Disable manual editing and restore calculated prices
          field.readOnly = true;
          field.setAttribute('readonly', 'readonly'); // Force set readonly attribute
          field.classList.remove('price-override-active');
          field.style.backgroundColor = '#f5f5f5'; // Gray background for readonly
          console.log(`🔒 Disabled editing for ${fieldId}`);

          // Restore calculated prices ONLY when DISABLING override (isOverride = false)
          if (!isOverride) {
            if (serviceType === 'experience') {
              // Re-trigger experience selection to restore prices
              const experienceSelect = document.getElementById('experienceSelect');
              if (experienceSelect?.value) {
                this.handleExperienceSelection(experienceSelect.value);
              }
            } else if (serviceType === 'tour') {
              // Re-trigger tour selection to restore prices
              const tourSelect = document.getElementById('tourSelect');
              if (tourSelect?.value) {
                this.handleTourSelection(tourSelect.value);
              }
            }
          }
        }
      }
    });

    // Update the breakdown to reflect override status
    this.updateServicePriceBreakdown();
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
    const destText = document.getElementById('transportDestinationText');
    if (destText) destText.value = '';

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

    // Clear round trip fields
    const rtFields = [
      'roundTripOriginIdaSelect', 'roundTripOriginIdaText',
      'roundTripDestinationIdaCombo', 'roundTripDestinationIdaSelect',
      'roundTripOriginVueltaCombo', 'roundTripOriginVueltaSelect',
      'roundTripDestinationVueltaSelect', 'roundTripDestinationVueltaText',
      'roundTripTimeIda', 'roundTripTimeVuelta',
      'roundTripAirlineIda', 'roundTripFlightNumberIda',
      'roundTripAirlineVuelta', 'roundTripFlightNumberVuelta',
      'roundTripSpecificLocationIda', 'roundTripSpecificLocationVuelta',
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
    const waitingTimeRate = document.getElementById('waitingTimeRate');
    if (waitingTimeRate) waitingTimeRate.textContent = '';

    // Clear price field and cached base price
    const priceField = document.getElementById('servicePrice');
    if (priceField) priceField.value = '';
    this._lastTransportBasePrice = null;

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

    // Update direction labels based on transport type
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

    // Re-evaluate direction fields (local has different field types than aeropuerto/punto-a-punto)
    const tripType2 = document.querySelector('input[name="tripType"]:checked')?.value;
    if (tripType2 === 'one-way') {
      this.handleDirectionTypeChange();
    } else {
      this.updateRoundTripFieldVisibility();
    }
  }

  handleTripTypeChange() {
    // Save current one-way values before clearing to transfer to round-trip
    const prevOriginEl = document.getElementById('transportOriginSelect');
    const prevDestEl = document.getElementById('transportDestinationSelect');
    const prevOriginText = prevOriginEl?.selectedIndex > 0 ? prevOriginEl.options[prevOriginEl.selectedIndex].text : '';
    const prevDestText = prevDestEl?.selectedIndex > 0 ? prevDestEl.options[prevDestEl.selectedIndex].text : '';
    // Also save round-trip values for transferring back to one-way
    const prevIdaOriginEl = document.getElementById('roundTripOriginIdaSelect');
    const prevIdaDestEl = document.getElementById('roundTripDestinationIdaSelect');
    const prevIdaOriginText = prevIdaOriginEl?.selectedIndex > 0 ? prevIdaOriginEl.options[prevIdaOriginEl.selectedIndex].text : '';
    const prevIdaDestText = prevIdaDestEl?.selectedIndex > 0 ? prevIdaDestEl.options[prevIdaDestEl.selectedIndex].text : '';

    this.clearTransportFormFields();
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
    const oneWayForm = document.getElementById('oneWayForm');
    const roundTripForm = document.getElementById('roundTripForm');
    const arrivalDepartureSelector = document.getElementById('arrivalDepartureSelector');

    // Show appropriate form based on trip type
    const quantityField = document.getElementById('serviceQuantity');
    const roundTripHint = document.getElementById('roundTripQuantityHint');

    if (tripType === 'one-way') {
      oneWayForm?.classList.remove('d-none');
      roundTripForm?.classList.add('d-none');
      // Show arrival/departure selector only for one-way
      arrivalDepartureSelector?.classList.remove('d-none');
      // Reset quantity to 1 for one-way, or 2 if additional vehicle is checked
      if (quantityField) {
        const additionalVehicle = document.getElementById('additionalVehicleCheckbox')?.checked;
        const baseQuantity = 1; // one-way base quantity
        const finalQuantity = additionalVehicle ? (baseQuantity * 2) : baseQuantity;
        quantityField.value = finalQuantity;

        console.log(`➡️  One-way selected: additionalVehicle=${additionalVehicle}, baseQuantity=${baseQuantity}, finalQuantity=${finalQuantity}`);
      }
      roundTripHint?.classList.add('d-none');
      // Initialize direction type fields
      this.handleDirectionTypeChange();

      // Transfer round-trip Ida values → one-way
      if (prevIdaOriginText || prevIdaDestText) {
        setTimeout(() => {
          const originSel = document.getElementById('transportOriginSelect');
          const destSel = document.getElementById('transportDestinationSelect');
          if (originSel && prevIdaOriginText) {
            for (const opt of originSel.options) {
              if (opt.textContent.trim() === prevIdaOriginText) { originSel.value = opt.value; break; }
            }
          }
          if (destSel && prevIdaDestText) {
            for (const opt of destSel.options) {
              if (opt.textContent.trim() === prevIdaDestText) { destSel.value = opt.value; break; }
            }
          }
        }, 100);
      }
    } else {
      oneWayForm?.classList.add('d-none');
      roundTripForm?.classList.remove('d-none');
      // Hide arrival/departure selector for round trip
      arrivalDepartureSelector?.classList.add('d-none');
      // Set quantity to 2 for round trip (Ida + Regreso), or 4 if additional vehicle is checked
      if (quantityField) {
        const additionalVehicle = document.getElementById('additionalVehicleCheckbox')?.checked;
        const baseQuantity = 2; // round trip base quantity
        const finalQuantity = additionalVehicle ? (baseQuantity * 2) : baseQuantity;
        quantityField.value = finalQuantity;

        console.log(`🔄 Round trip selected: additionalVehicle=${additionalVehicle}, baseQuantity=${baseQuantity}, finalQuantity=${finalQuantity}`);
      }
      roundTripHint?.classList.remove('d-none');
      // Pre-fill date fields with current day's date (or today if day has no date)
      const currentDay = this.days.find((d) => d.id === this.currentDayId);
      const defaultDate = currentDay?.date || new Date().toISOString().split('T')[0];
      const dateIda = document.getElementById('roundTripDateIda');
      const dateVuelta = document.getElementById('roundTripDateVuelta');
      if (dateIda && !dateIda.value) dateIda.value = defaultDate;
      if (dateVuelta && !dateVuelta.value) dateVuelta.value = defaultDate;
      // Set correct field types for round trip based on transport type
      this.updateRoundTripFieldVisibility();

      // Transfer one-way origin/dest → round-trip Ida origin/dest (swapped for Vuelta via syncIdaToVuelta)
      if (prevOriginText || prevDestText) {
        setTimeout(() => {
          const idaOrigin = document.getElementById('roundTripOriginIdaSelect');
          const idaDest = document.getElementById('roundTripDestinationIdaSelect');
          if (idaOrigin && prevOriginText) {
            for (const opt of idaOrigin.options) {
              if (opt.textContent.trim() === prevOriginText) { idaOrigin.value = opt.value; break; }
            }
          }
          if (idaDest && prevDestText) {
            for (const opt of idaDest.options) {
              if (opt.textContent.trim() === prevDestText) { idaDest.value = opt.value; break; }
            }
          }
          // Auto-fill Vuelta from Ida (swapped)
          this.syncIdaToVuelta();
        }, 100);
      }
    }

    // Re-check transport type to show/hide flight details correctly
    this.handleTransportTypeChange();
  }

  handleDirectionTypeChange() {
    // Save current origin/destination values before clearing to swap them
    const prevOriginEl = document.getElementById('transportOriginSelect');
    const prevDestEl = document.getElementById('transportDestinationSelect');
    const prevOriginText = prevOriginEl?.selectedIndex > 0 ? prevOriginEl.options[prevOriginEl.selectedIndex].text : '';
    const prevDestText = prevDestEl?.selectedIndex > 0 ? prevDestEl.options[prevDestEl.selectedIndex].text : '';

    this.clearTransportFormFields();
    const directionType = document.querySelector('input[name="directionType"]:checked')?.value;
    const transportType = document.querySelector('input[name="transportType"]:checked')?.value;

    // Get all field elements
    const originSelect = document.getElementById('transportOriginSelect');
    const originText = document.getElementById('transportOriginText');
    const originComboWrapper = document.getElementById('transportOriginComboWrapper');
    const destinationComboWrapper = document.getElementById('transportDestinationComboWrapper');
    const destinationSelect = document.getElementById('transportDestinationSelect');
    const destinationText = document.getElementById('transportDestinationText');

    // Get time label element
    const timeLabel = document.querySelector('label[for="flightTime"]');

    // Hide all origin/destination variants first
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

    // Update labels based on transport type and direction
    const originLabel = document.getElementById('transportOriginLabel');
    const destinationLabel = document.getElementById('transportDestinationLabel');

    if (directionType === 'arrival' && transportType === 'local') {
      // Local Ida: Origin = TEXT (ubicación específica), Destination = SELECT
      originText?.classList.remove('d-none');
      originText?.setAttribute('required', 'required');
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen (San Miguel de Allende) <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
    } else if (directionType === 'arrival') {
      // Arrival: Origin = SELECT (airports), Destination = SELECT dropdown
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');

      if (timeLabel) {
        timeLabel.textContent = 'Hora de Llegada';
      }
    } else if (directionType === 'departure' && transportType === 'local') {
      // Local Vuelta: Origin = SELECT, Destination = TEXT (ubicación específica)
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      destinationText?.classList.remove('d-none');
      destinationText?.setAttribute('required', 'required');
      if (destinationLabel) destinationLabel.innerHTML = 'Destino (San Miguel de Allende) <span class="text-danger">*</span>';
    } else if (directionType === 'departure') {
      // Departure + Aeropuerto / Punto a Punto: Origin = SELECT dropdown, Destination = SELECT
      originSelect?.classList.remove('d-none');
      originSelect?.setAttribute('required', 'required');
      if (originLabel) originLabel.innerHTML = 'Origen <span class="text-danger">*</span>';
      if (destinationLabel) destinationLabel.innerHTML = 'Destino <span class="text-danger">*</span>';
      destinationSelect?.classList.remove('d-none');
      destinationSelect?.setAttribute('required', 'required');

      if (timeLabel) {
        timeLabel.textContent = 'Hora de Salida';
      }
    }

    // Re-populate dropdowns considering direction
    if (transportType) {
      populateDropdownsForTransportType(transportType, directionType);
    }

    // Swap origin ↔ destination from previous direction (arrival→departure or vice versa)
    if (prevOriginText || prevDestText) {
      const newOriginSelect = document.getElementById('transportOriginSelect');
      const newDestSelect = document.getElementById('transportDestinationSelect');
      // Previous destination → new origin, previous origin → new destination
      if (newOriginSelect && prevDestText) {
        for (const opt of newOriginSelect.options) {
          if (opt.textContent.trim() === prevDestText) { newOriginSelect.value = opt.value; break; }
        }
      }
      if (newDestSelect && prevOriginText) {
        for (const opt of newDestSelect.options) {
          if (opt.textContent.trim() === prevOriginText) { newDestSelect.value = opt.value; break; }
        }
      }
    }
  }

  /**
   * Update round trip field visibility based on transport type.
   * Ida leg uses arrival pattern, Vuelta leg uses departure pattern.
   * @example
   */
  updateRoundTripFieldVisibility() {
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

    // Populate dropdowns for both directions
    if (typeof populateDropdownsForTransportType === 'function') {
      populateRoundTripDropdowns(transportType);
    }
  }

  /**
   * Auto-fill Vuelta fields from Ida fields (swapped: origin↔destination).
   * Only fills empty Vuelta fields to avoid overwriting user edits.
   * @example
   */
  syncIdaToVuelta() {
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
  }

  async saveService() {
    // Prevent multiple simultaneous save operations
    if (this._saveInProgress) {
      console.log('⚠️ Save already in progress, skipping');
      return;
    }
    this._saveInProgress = true;

    const serviceData = this.collectServiceData();

    // Log collected data for debugging price persistence
    if (serviceData.type === 'tour' || serviceData.type === 'experience') {
      console.log('💾 Saving service with price data:', {
        type: serviceData.type,
        priceOverride: serviceData.priceOverride,
        customPrice: serviceData.customPrice,
        price: serviceData.price,
        adultPrice: serviceData.adultPrice,
        childPrice: serviceData.childPrice,
        customPrices: serviceData.customPrices,
      });
    }

    // Clear any previous modal alerts
    this.clearModalAlert('serviceModalAlert');

    if (!this.validateServiceData(serviceData)) {
      this._saveInProgress = false;
      return;
    }

    // Round-trip transport: split into two separate services (Ida + Vuelta)
    if (serviceData.type === 'transport' && serviceData.tripType === 'round-trip') {
      const result = await this.saveRoundTripAsTwo(serviceData);
      this._saveInProgress = false;
      return result;
    }

    const saveBtn = document.getElementById('saveServiceBtn');
    const originalContent = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Guardando...';
    }

    try {
      if (this.currentServiceId) {
        // Update existing service
        const existingService = this.services.get(this.currentServiceId);
        const updatedService = {
          ...existingService,
          ...serviceData,
        };

        // Debug logging for tour updates
        if (updatedService.type === 'tour') {
          console.log('📝 Updating tour service:', {
            existingPriceOverride: existingService.priceOverride,
            newPriceOverride: serviceData.priceOverride,
            updatedPriceOverride: updatedService.priceOverride,
            existingCustomPrice: existingService.customPrice,
            newCustomPrice: serviceData.customPrice,
            updatedCustomPrice: updatedService.customPrice,
          });
        }

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
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalContent;
      }
      this._saveInProgress = false;
    }
  }

  /**
   * Save round-trip transport as two separate one-way services on their respective days.
   * Ida goes to the day matching startDate, Vuelta to the day matching endDate.
   * Creates days automatically if they don't exist.
   * @param serviceData
   * @example
   */
  async saveRoundTripAsTwo(serviceData) {
    try {
      const transportLabel = { aeropuerto: 'Aeropuerto', 'punto-a-punto': 'Punto a Punto', local: 'Local' };
      const typeLabel = transportLabel[serviceData.transportType] || 'Transporte';

      // --- Ida leg ---
      const idaData = {
        ...serviceData,
        tripType: 'one-way',
        directionType: 'arrival',
        concept: `${typeLabel}: ${serviceData.origin} - ${serviceData.destination} (Ida)`,
        startTime: serviceData.startTime,
        endTime: '',
        startDate: serviceData.startDate,
        endDate: '',
        returnOrigin: '',
        returnDestination: '',
        returnAirline: '',
        returnFlightNumber: '',
      };

      // --- Vuelta leg ---
      const vueltaData = {
        ...serviceData,
        tripType: 'one-way',
        directionType: 'departure',
        concept: `${typeLabel}: ${serviceData.returnOrigin} - ${serviceData.returnDestination} (Vuelta)`,
        origin: serviceData.returnOrigin,
        originName: serviceData.returnOrigin,
        destination: serviceData.returnDestination,
        startTime: serviceData.endTime,
        endTime: '',
        startDate: serviceData.endDate,
        endDate: '',
        airline: serviceData.returnAirline || '',
        flightNumber: serviceData.returnFlightNumber || '',
        returnOrigin: '',
        returnDestination: '',
        returnAirline: '',
        returnFlightNumber: '',
      };

      // Find or create days for each date
      console.log('[RoundTrip] Ida startDate:', idaData.startDate, '| Vuelta startDate:', vueltaData.startDate);
      console.log('[RoundTrip] Available days:', this.days.map((d) => ({ id: d.id, date: d.date, title: d.title })));
      const idaDayId = this.findOrCreateDayByDate(idaData.startDate);
      const vueltaDayId = this.findOrCreateDayByDate(vueltaData.startDate);
      console.log('[RoundTrip] Ida → dayId:', idaDayId, '| Vuelta → dayId:', vueltaDayId);

      if (this.currentServiceId) {
        // Editing: update the existing service as Ida, create Vuelta as new
        const existingService = this.services.get(this.currentServiceId);
        const updatedIda = { ...existingService, ...idaData, dayId: idaDayId };
        this.services.set(this.currentServiceId, updatedIda);
        this.moveServiceToDay(this.currentServiceId, existingService.dayId, idaDayId);

        // Create Vuelta as new service
        const vueltaId = this.generateId('service');
        this.services.set(vueltaId, { id: vueltaId, dayId: vueltaDayId, ...vueltaData });
        const vueltaDay = this.days.find((d) => d.id === vueltaDayId);
        if (vueltaDay) {
          vueltaDay.services.push(vueltaId);
          vueltaDay.services = this.sortAndDeduplicateServices(vueltaDay.services);
        }
      } else {
        // New: create both services
        const idaId = this.generateId('service');
        this.services.set(idaId, { id: idaId, dayId: idaDayId, ...idaData });
        const idaDay = this.days.find((d) => d.id === idaDayId);
        if (idaDay) {
          idaDay.services.push(idaId);
          idaDay.services = this.sortAndDeduplicateServices(idaDay.services);
        }

        const vueltaId = this.generateId('service');
        this.services.set(vueltaId, { id: vueltaId, dayId: vueltaDayId, ...vueltaData });
        const vueltaDay = this.days.find((d) => d.id === vueltaDayId);
        if (vueltaDay) {
          vueltaDay.services.push(vueltaId);
          vueltaDay.services = this.sortAndDeduplicateServices(vueltaDay.services);
        }
      }

      // Re-sort all days by date and renumber
      this.days.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
      this.days.forEach((d, i) => { d.number = i + 1; });

      await this.saveToBackend();
      this.renderItinerary();
      this.closeModal('serviceModal');
      this.showAlert('Servicio de ida y vuelta guardado exitosamente', 'success');
    } catch (error) {
      console.error('Error saving round-trip service:', error);
      this.showModalAlert('serviceModalAlert', `Error al guardar: ${error.message}`, 'danger');
    }
  }

  /**
   * Find a day by its date, or create a new one if it doesn't exist.
   * @param {string} dateStr - Date in YYYY-MM-DD format.
   * @returns {string} Day ID.
   * @example
   */
  findOrCreateDayByDate(dateStr) {
    if (!dateStr) return this.currentDayId;

    const existingDay = this.days.find((d) => d.date === dateStr);
    if (existingDay) return existingDay.id;

    // Create new day
    const newDay = {
      id: this.generateId('day'),
      number: this.days.length + 1,
      title: `Día ${this.days.length + 1}`,
      date: dateStr,
      description: '',
      services: [],
    };
    this.days.push(newDay);

    // Re-sort days by date and renumber
    this.days.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    this.days.forEach((d, i) => { d.number = i + 1; });

    return newDay.id;
  }

  /**
   * Move a service from one day to another.
   * @param serviceId
   * @param oldDayId
   * @param newDayId
   * @example
   */
  moveServiceToDay(serviceId, oldDayId, newDayId) {
    if (oldDayId === newDayId) return;

    const oldDay = this.days.find((d) => d.id === oldDayId);
    if (oldDay) {
      oldDay.services = oldDay.services.filter((id) => id !== serviceId);
    }

    const newDay = this.days.find((d) => d.id === newDayId);
    if (newDay && !newDay.services.includes(serviceId)) {
      newDay.services.push(serviceId);
      newDay.services = this.sortAndDeduplicateServices(newDay.services);
    }
  }

  collectServiceData() {
    const type = document.querySelector('input[name="serviceType"]:checked')?.value;
    const vehicleSelectValue = document.getElementById('vehicleSelect')?.value;

    // Collect base price from the field
    const servicePriceField = document.getElementById('servicePrice');
    const basePrice = parseFloat(servicePriceField?.value || 0);

    const data = {
      type,
      price: basePrice,
      quantity: type === 'concepto' ? 1
        : (type === 'transport' || (type === 'tour' && document.getElementById('tourRequiresTransport')?.checked))
          ? (document.getElementById('additionalVehicleCheckbox')?.checked ? 2 : 1)
          : parseInt(document.getElementById('serviceQuantity')?.value || 1),
      notes: document.getElementById('serviceNotes')?.value,
      includeInTotal: document.getElementById('includeInTotal')?.checked !== false,
      greeterInVehicle: document.getElementById('greeterInVehicle')?.checked || false,
      availabilityPending: this.currentServiceAvailabilityPending || false,
    };

    // For tours and transport, store vehicle type information
    if ((type === 'tour' || type === 'transport') && vehicleSelectValue) {
      data.vehicleType = vehicleSelectValue; // Store the vehicle type ID
      // Get display name from vehicle types map or transport price data
      if (type === 'transport' && this.transportPriceData?.vehicles) {
        const vehicle = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === vehicleSelectValue);
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
        
        // Always capture provider type from selected dropdown option
        const selectedOption = document.getElementById('experienceSelect')?.selectedOptions[0];
        if (selectedOption?.dataset.providerType) {
          data.providerType = selectedOption.dataset.providerType;
          console.debug('💾 Saving experience with provider type:', {
            experienceId: data.experienceId,
            providerType: data.providerType,
            providerName: selectedOption.dataset.providerName
          });
        }

        // Collect schedule data from start/end time inputs
        data.startTime = document.getElementById('experienceStartTime')?.value || '';
        data.endTime = document.getElementById('experienceEndTime')?.value || '';
        data.selectedSchedule = data.startTime && data.endTime
          ? `${data.startTime} - ${data.endTime}`
          : data.startTime || '';

        // Collect price data
        data.adultPrice = parseFloat(document.getElementById('adultPrice')?.value || 0);
        data.childPrice = parseFloat(document.getElementById('childPrice')?.value || 0);
        data.noAlcoholPrice = parseFloat(document.getElementById('noAlcoholPrice')?.value || 0);

        // Store price override flag
        data.priceOverride = document.getElementById('experienceOverridePrices')?.checked || false;
        if (data.priceOverride) {
          data.customPrices = {
            adult: data.adultPrice,
            child: data.childPrice,
            noAlcohol: data.noAlcoholPrice,
          };
          // Store the custom price for experiences
          data.customPrice = data.price;
          // Update main price to reflect custom adult price when override is enabled
          data.price = data.adultPrice;
          console.log('🔍 Experience price override data collection:', {
            priceOverride: data.priceOverride,
            customPrice: data.customPrice,
            customPrices: data.customPrices,
            price: data.price,
          });
        }

        break;
      }
      case 'tour': {
        data.tourId = document.getElementById('tourSelect')?.value;

        // Check if this is a walking tour
        const selectedTourData = this.toursCache.has('all')
          ? this.toursCache.get('all').find((t) => t.id === data.tourId || t.objectId === data.tourId)
          : null;

        if (selectedTourData?.isWalkingTour) {
          // Walking tour: collect tier-based pricing
          data.isWalkingTour = true;

          // Debug: Check form values before collection
          const walkingAdults = document.getElementById('walkingTourAdultsQuantity')?.value;
          const walkingChildren = document.getElementById('walkingTourChildrenQuantity')?.value;
          const walkingInfants = document.getElementById('walkingTourInfantsQuantity')?.value;

          // Note: Removed verbose walking tour form values log for console cleanup

          data.adultsQuantity = parseInt(document.getElementById('walkingTourAdultsQuantity')?.value || 0);
          data.childrenQuantity = parseInt(document.getElementById('walkingTourChildrenQuantity')?.value || 0);
          data.infantsQuantity = parseInt(document.getElementById('walkingTourInfantsQuantity')?.value || 0);
          data.walkingTourPeopleCount = data.adultsQuantity + data.childrenQuantity + data.infantsQuantity || 1;

          // Note: Removed walking tour final data log for console cleanup

          // Check for price override on walking tours
          const walkingTourOverride = document.getElementById('tourOverridePrices')?.checked;
          const walkingPriceMode = document.querySelector('input[name="walkingPriceMode"]:checked')?.value || 'total';

          if (walkingTourOverride) {
            if (walkingPriceMode === 'group') {
              // Per-group pricing mode
              const groupPrices = [];
              const groupInputs = document.querySelectorAll('.walking-group-price');
              groupInputs.forEach((input) => {
                groupPrices.push(parseFloat(input.value) || 0);
              });
              data.walkingTourGroupPrices = groupPrices;
              data.walkingTourPrice = groupPrices.reduce((sum, price) => sum + price, 0);
              data.walkingTourPriceOverride = true;
              data.walkingTourPriceMode = 'group';
            } else {
              // Total price override mode
              const walkingTourManualPrice = document.getElementById('walkingTourManualPrice')?.value;
              if (walkingTourManualPrice) {
                data.walkingTourPrice = parseFloat(walkingTourManualPrice);
                data.walkingTourPriceOverride = true;
                data.walkingTourPriceMode = 'total';
              }
            }
          } else {
            // Get duration for walking tour calculation
            const duration = parseFloat(document.getElementById('tourDuration')?.value || 1);
            data.walkingTourPrice = this.getWalkingTourPrice(selectedTourData, data.walkingTourPeopleCount, duration);
            data.walkingTourPriceOverride = false;
            data.walkingTourPriceMode = 'calculated';
          }

          data.walkingTourCurrency = selectedTourData.walkingPriceCurrency || 'MXN';
          data.persons = data.walkingTourPeopleCount;
        } else {
          // Vehicle tour: collect standard pricing
          data.rateId = document.getElementById('transportCategory')?.value;

          // Collect includeGuide checkbox state for tours
          const includeGuideCheckbox = document.getElementById('includeGuide');
          data.includeGuide = includeGuideCheckbox ? includeGuideCheckbox.checked : false;

          // Collect includeGreeter checkbox state for tours
          const includeGreeterCheckbox = document.getElementById('includeGreeter');
          data.includeGreeter = includeGreeterCheckbox ? includeGreeterCheckbox.checked : false;

          // Collect passenger counts for tours
          data.adultsQuantity = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
          data.childrenQuantity = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
          data.infantsQuantity = parseInt(document.getElementById('tourInfantsQuantity')?.value || 0);
        }

        // Collect schedule data from start/end time inputs
        data.startTime = document.getElementById('tourStartTime')?.value || '';
        data.endTime = document.getElementById('tourEndTime')?.value || '';
        data.selectedSchedule = data.startTime && data.endTime
          ? `${data.startTime} - ${data.endTime}`
          : data.startTime || '';

        // Collect tour duration
        data.duration = parseFloat(document.getElementById('tourDuration')?.value || 1);

        // Store tour price override flag
        const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
        let priceOverride = tourOverrideCheckbox?.checked || false;

        // WORKAROUND: If the price has been manually edited (different from calculated), treat as override
        const servicePriceField = document.getElementById('servicePrice');
        if (!priceOverride && servicePriceField && this.lastValidTourPrice !== undefined) {
          const currentPrice = parseFloat(servicePriceField.value);
          const calculatedPrice = parseFloat(this.lastValidTourPrice);
          if (!isNaN(currentPrice) && !isNaN(calculatedPrice) && Math.abs(currentPrice - calculatedPrice) > 0.01) {
            console.log('🔄 Price was manually edited, enabling override automatically');
            priceOverride = true;
            // Try to check the checkbox
            if (tourOverrideCheckbox) {
              tourOverrideCheckbox.checked = true;
            }
          }
        }

        data.priceOverride = priceOverride;

        console.log('🎯 Tour override state:', {
          checkboxChecked: tourOverrideCheckbox?.checked,
          priceOverride: data.priceOverride,
          isWalkingTour: data.isWalkingTour,
          currentPrice: data.price,
          lastCalculated: this.lastValidTourPrice,
        });

        if (data.priceOverride && !data.isWalkingTour) {
          // Store custom tour prices when override is checked
          data.adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
          data.childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
          data.noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);
          // Store the actual price from the field as customPrice
          // This is the user's manually entered price that should be persisted
          data.customPrice = data.price;
          data.priceOverride = true; // Ensure this is set
          console.log('✅ Tour price override ENABLED - storing custom price:', {
            priceOverride: data.priceOverride,
            customPrice: data.customPrice,
            price: data.price,
            fieldValue: document.getElementById('servicePrice')?.value,
            adultPrice: data.adultPrice,
          });
        } else {
          console.log('ℹ️ Tour override NOT enabled - using calculated prices');
          // Clear any custom price when override is disabled
          data.customPrice = null;
          data.priceOverride = false; // Ensure this is set
        }

        break;
      }
      case 'transport': {
        data.transportType = document.querySelector('input[name="transportType"]:checked')?.value;
        data.tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        data.directionType = document.querySelector('input[name="directionType"]:checked')?.value;

        // Helper: resolve SELECT display text (not slug value)
        const resolveSelectText = (selectEl) => {
          if (selectEl && selectEl.selectedIndex > 0) {
            return selectEl.options[selectEl.selectedIndex].textContent;
          }
          const slug = selectEl?.value || '';
          return window.slugToOriginalMapping?.get(slug) || slug;
        };

        // --- ROUND TRIP: collect from dynamic round trip fields ---
        if (data.tripType === 'round-trip') {
          const tType = data.transportType;

          // Ida origin (arrival pattern)
          if (tType === 'local') {
            data.origin = document.getElementById('roundTripOriginIdaText')?.value || '';
          } else {
            data.origin = resolveSelectText(document.getElementById('roundTripOriginIdaSelect'));
          }

          // Ida destination (arrival pattern) — always SELECT now
          data.destination = resolveSelectText(document.getElementById('roundTripDestinationIdaSelect'));

          // Append specific location to Ida destination if filled
          const idaSpecific = document.getElementById('roundTripSpecificLocationIda')?.value?.trim();
          if (idaSpecific) {
            data.destination = `${data.destination}, ${idaSpecific}`;
          }

          data.startDate = document.getElementById('roundTripDateIda')?.value || '';
          data.startTime = document.getElementById('roundTripTimeIda')?.value || '';

          // Vuelta origin (departure pattern) — always SELECT now
          data.returnOrigin = resolveSelectText(document.getElementById('roundTripOriginVueltaSelect'));

          // Append specific location to Vuelta origin if filled
          const vueltaSpecific = document.getElementById('roundTripSpecificLocationVuelta')?.value?.trim();
          if (vueltaSpecific) {
            data.returnOrigin = `${data.returnOrigin}, ${vueltaSpecific}`;
          }

          // Vuelta destination (departure pattern)
          if (tType === 'local') {
            data.returnDestination = document.getElementById('roundTripDestinationVueltaText')?.value || '';
          } else {
            data.returnDestination = resolveSelectText(document.getElementById('roundTripDestinationVueltaSelect'));
          }

          data.endDate = document.getElementById('roundTripDateVuelta')?.value || '';
          data.endTime = document.getElementById('roundTripTimeVuelta')?.value || '';

          // Flight details for round trip
          if (tType === 'aeropuerto') {
            data.airline = document.getElementById('roundTripAirlineIda')?.value || '';
            data.flightNumber = document.getElementById('roundTripFlightNumberIda')?.value || '';
            data.returnAirline = document.getElementById('roundTripAirlineVuelta')?.value || '';
            data.returnFlightNumber = document.getElementById('roundTripFlightNumberVuelta')?.value || '';
          }

          data.originName = data.origin || 'Origen';
          const transportTypeLabels = { aeropuerto: 'Aeropuerto', 'punto-a-punto': 'Punto a Punto', local: 'Local' };
          data.concept = `${transportTypeLabels[tType] || 'Transporte'}: ${data.origin || 'Origen'} - ${data.destination || 'Destino'} (Ida y Vuelta)`;
          data.originName = data.origin || 'Origen';
        } else {
        // --- ONE-WAY: existing logic ---

          // Get origin from appropriate field based on direction
          const { directionType } = data;

          // Resolve destination from SELECT (display text, not slug)
          const resolveDestinationSelect = () => {
            const destSelect = document.getElementById('transportDestinationSelect');
            const destSlug = destSelect?.value || '';
            if (destSelect && destSelect.selectedIndex > 0) {
              return destSelect.options[destSelect.selectedIndex].textContent;
            }
            return window.slugToOriginalMapping?.get(destSlug) || destSlug;
          };

          const isDepartureWithSelect = directionType === 'departure' && (data.transportType === 'aeropuerto' || data.transportType === 'punto-a-punto');

          const isLocalIda = directionType === 'arrival' && data.transportType === 'local';

          if (isLocalIda) {
          // Local Ida: origin = TEXT (ubicación específica), destination = SELECT
            data.origin = document.getElementById('transportOriginText')?.value || '';
            data.destination = resolveDestinationSelect();
          } else if (directionType === 'departure' && data.transportType === 'local') {
          // Local Vuelta: origin = SELECT, destination = TEXT
            const originSelect = document.getElementById('transportOriginSelect');
            if (originSelect && originSelect.selectedIndex > 0) {
              data.origin = originSelect.options[originSelect.selectedIndex].textContent;
            } else {
              data.origin = originSelect?.value || '';
            }
            data.destination = document.getElementById('transportDestinationText')?.value || '';
          } else if (directionType === 'departure') {
          // Departure: origin = SELECT (city), destination = SELECT (airport)
            const originSelect = document.getElementById('transportOriginSelect');
            data.origin = originSelect?.selectedIndex > 0 ? originSelect.options[originSelect.selectedIndex].textContent : (originSelect?.value || '');
            data.destination = resolveDestinationSelect();
          } else {
          // Arrival: origin = SELECT (airport), destination = SELECT (city)
            data.origin = document.getElementById('transportOriginSelect')?.value || '';
            data.destination = resolveDestinationSelect();
          }

          // If specific location is filled, append it to origin (departure) or destination (arrival)
          const specificLocation = document.getElementById('transportSpecificLocation')?.value;
          if (specificLocation && specificLocation.trim()) {
            if (directionType === 'departure') {
              data.origin = `${data.origin}, ${specificLocation.trim()}`;
            } else {
              data.destination = `${data.destination}, ${specificLocation.trim()}`;
            }
          }

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
            if (isLocalIda) {
            // Local Ida: origin is TEXT field
              const originText = document.getElementById('transportOriginText')?.value;
              if (originText) return originText;
            } else {
            // Both arrival and departure: origin is SELECT
              const originSelect = document.getElementById('transportOriginSelect');
              if (originSelect && originSelect.selectedIndex > 0) {
                return originSelect.options[originSelect.selectedIndex].textContent;
              }
            }
            return data.origin || 'Origen';
          };

          const transportTypes = {
            aeropuerto: 'Aeropuerto',
            'punto-a-punto': 'Punto a Punto',
            local: 'Local',
          };

          // Generate concept with origin and destination
          let originName = resolveOriginName();
          // For departure, append specific location to display name (matches data.origin)
          if (directionType === 'departure' && specificLocation && specificLocation.trim()) {
            originName = `${originName}, ${specificLocation.trim()}`;
          }
          data.originName = originName;
          const destinationName = data.destination || 'Destino';
          data.concept = `${transportTypes[data.transportType] || 'Transporte'}: ${originName} - ${destinationName}`;
        } // end one-way else block

        // Shared transport fields (both one-way and round-trip)
        data.category = document.getElementById('transportCategory')?.value;

        data.transportAdults = parseInt(document.getElementById('transportAdults')?.value || 0);
        data.transportChildren = parseInt(document.getElementById('transportChildren')?.value || 0);
        data.transportInfants = parseInt(document.getElementById('transportInfants')?.value || 0);
        data.persons = data.transportAdults + data.transportChildren + data.transportInfants || 1;

        data.includeGuide = document.getElementById('includeGuide')?.checked || false;
        data.includeGreeter = document.getElementById('includeGreeter')?.checked || false;

        // Persist route duration for pricing calculations (Guía/Greeter surcharges)
        data.routeDuration = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;

        // Store base vehicle price separately so calculateServicePrice can add surcharges
        // (the price field may already include surcharges from recalculateTransportPrice)
        if (vehicleSelectValue) {
          data.baseVehiclePrice = this.getTransportVehiclePrice(vehicleSelectValue) || data.price;
        } else {
          data.baseVehiclePrice = data.price;
        }

        // Waiting time (Tiempo de espera)
        data.waitingTimeHours = parseFloat(document.getElementById('waitingTimeHours')?.value || 0);
        data.waitingTimePricePerHour = this.getWaitingTimePrice()?.pricePerHour || 0;

        // Store transport price override flag
        data.priceOverride = document.getElementById('transportOverridePrices')?.checked || false;
        if (data.priceOverride) {
          data.customPrice = data.price;
        }

        break;
      }
      case 'a-disposicion': {
        data.rateId = document.getElementById('aDisposicionRate')?.value;
        data.vehicleType = document.getElementById('aDisposicionVehicle')?.value;
        data.vehicleCount = parseInt(document.getElementById('aDisposicionVehicleCount')?.value || 1, 10);
        data.hours = parseFloat(document.getElementById('aDisposicionHours')?.value || 4);
        data.hourlyPrice = this._disposicionHourlyRate || 0;
        data.discountPercent = this.getADisposicionDiscount(data.hours);

        // Store vehicle name for display
        const adVehicleSelect = document.getElementById('aDisposicionVehicle');
        if (adVehicleSelect?.selectedIndex > 0) {
          data.vehicleTypeName = adVehicleSelect.options[adVehicleSelect.selectedIndex].text;
        }

        // Collect schedule
        const adStartTime = document.getElementById('aDisposicionStartTime')?.value;
        const adEndTime = document.getElementById('aDisposicionEndTime')?.value;
        if (adStartTime) {
          data.startTime = adStartTime;
          if (adEndTime) {
            data.endTime = adEndTime;
            data.selectedSchedule = `${adStartTime} - ${adEndTime}`;
          } else {
            data.selectedSchedule = adStartTime;
          }
        }

        // Store a disposición price override flag
        data.priceOverride = document.getElementById('aDisposicionOverridePrices')?.checked || false;
        if (data.priceOverride) {
          data.customPrice = data.price;
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

    // Collect common fields for all service types
    data.serviceDescription = document.getElementById('serviceDescription')?.value || '';
    data.internalNotes = document.getElementById('internalNotes')?.value || '';
    data.clientNotes = document.getElementById('clientNotes')?.value || '';
    data.providerNotes = document.getElementById('providerNotes')?.value || '';
    data.teamNotes = document.getElementById('teamNotes')?.value || '';

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
        if (data.tripType === 'round-trip') {
          if (!data.startDate) {
            this.showModalAlert('serviceModalAlert', 'Por favor selecciona la fecha de Ida', 'warning');
            return false;
          }
          if (!data.endDate) {
            this.showModalAlert('serviceModalAlert', 'Por favor selecciona la fecha de Vuelta', 'warning');
            return false;
          }
        }
        break;
      case 'concepto':
        if (!data.concept) {
          this.showModalAlert('serviceModalAlert', 'Por favor ingresa un concepto', 'warning');
          return false;
        }
        break;
      case 'a-disposicion':
        if (!data.rateId) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona un segmento', 'warning');
          return false;
        }
        if (!data.vehicleType) {
          this.showModalAlert('serviceModalAlert', 'Por favor selecciona un vehículo', 'warning');
          return false;
        }
        break;
    }

    return true;
  }

  async populateServiceForm(service) {
    if (!service) return;

    // Debug: Log service object at the start of populateServiceForm for walking tours
    if (service.isWalkingTour) {
      console.log('🔍 Service object at START of populateServiceForm:', {
        serviceId: service.id,
        peopleData: {
          adultsQuantity: service.adultsQuantity,
          childrenQuantity: service.childrenQuantity,
          infantsQuantity: service.infantsQuantity,
        },
      });
    }

    // Restore price override toggle FIRST (before setting service type)
    // This ensures the toggle state is correct when handleServiceTypeChange runs
    if (service.priceOverride) {
      switch (service.type) {
        case 'experience':
          const experienceOverride = document.getElementById('experienceOverridePrices');
          if (experienceOverride) {
            experienceOverride.checked = true;
          }
          break;
        case 'tour':
          const tourOverride = document.getElementById('tourOverridePrices');
          if (tourOverride) {
            tourOverride.checked = true;
            tourOverride.setAttribute('checked', 'checked');
            console.log('✅ Tour override checkbox restored to checked state');
            // Ensure the price field is editable
            const priceField = document.getElementById('servicePrice');
            if (priceField) {
              priceField.readOnly = false;
              priceField.style.backgroundColor = '';
            }
          }
          break;
        case 'transport':
          const transportOverride = document.getElementById('transportOverridePrices');
          if (transportOverride) {
            transportOverride.checked = true;
          }
          break;
        case 'a-disposicion':
          const aDisposicionOverride = document.getElementById('aDisposicionOverridePrices');
          if (aDisposicionOverride) {
            aDisposicionOverride.checked = true;
          }
          break;
      }
    }

    // Set service type (now the override toggle state is already set)
    const serviceTypeRadio = document.querySelector(`input[name="serviceType"][value="${service.type}"]`);
    if (serviceTypeRadio) {
      serviceTypeRadio.checked = true;

      // Debug: Log service object BEFORE handleServiceTypeChange for walking tours
      if (service.isWalkingTour) {
        console.log('🔍 Service object BEFORE handleServiceTypeChange:', {
          serviceId: service.id,
          peopleData: {
            adultsQuantity: service.adultsQuantity,
            childrenQuantity: service.childrenQuantity,
            infantsQuantity: service.infantsQuantity,
          },
        });
      }

      this.handleServiceTypeChange(service.type);

      // Debug: Log service object AFTER handleServiceTypeChange for walking tours
      if (service.isWalkingTour) {
        console.log('🔍 Service object AFTER handleServiceTypeChange:', {
          serviceId: service.id,
          peopleData: {
            adultsQuantity: service.adultsQuantity,
            childrenQuantity: service.childrenQuantity,
            infantsQuantity: service.infantsQuantity,
          },
        });
      }
    }

    // Populate include in total checkbox
    const includeInTotalCheckbox = document.getElementById('includeInTotal');
    if (includeInTotalCheckbox) {
      includeInTotalCheckbox.checked = service.includeInTotal !== false;
    }

    // Restore availability pending flag
    this.currentServiceAvailabilityPending = service.availabilityPending || false;

    // Populate common fields
    document.getElementById('transportCategory').value = service.category || '';
    // For tours with vehicle type, use vehicleType, otherwise use vehicleId
    const vehicleSelectValue = service.vehicleType || service.vehicleTypeName || service.vehicleId || '';
    document.getElementById('vehicleSelect').value = vehicleSelectValue;
    // For tours, check for custom price first, then show vehicle cost; for others, show full calculated price
    if (service.type === 'tour') {
      console.log('🔍 Populating tour price field:', {
        priceOverride: service.priceOverride,
        customPrice: service.customPrice,
        price: service.price,
        vehicleId: service.vehicleId,
        vehicleType: service.vehicleType,
        vehicleTypeName: service.vehicleTypeName,
        duration: service.duration,
        quantity: service.quantity,
      });
      // Check if tour has custom price override
      if (service.priceOverride) {
        // When price override is enabled, use customPrice as the BASE price (not total)
        const basePrice = service.customPrice !== undefined && service.customPrice !== null
          ? service.customPrice
          : service.price;
        const priceField = document.getElementById('servicePrice');
        if (priceField) {
          priceField.value = basePrice || 0;
          console.log('✅ Loading custom BASE price into field:', basePrice, 'Field value now:', priceField.value);
        }
        // Store this as the last valid price
        this.lastValidTourPrice = basePrice;

        // Set a flag to prevent overwriting
        this._restoringCustomPrice = true;
        setTimeout(() => {
          this._restoringCustomPrice = false;
          const currentValue = document.getElementById('servicePrice')?.value;
          console.log('🔍 Price field value after 100ms:', currentValue);
          if (currentValue !== String(basePrice)) {
            console.error('❌ Price was overwritten! Expected:', basePrice, 'Got:', currentValue);
            // Force restore it
            document.getElementById('servicePrice').value = basePrice;
            console.log('🔄 Force restored price to:', basePrice);
          }
        }, 100);
      } else if (service.vehicleId || service.vehicleType || service.vehicleTypeName) {
        // For tours without override, show vehicle cost (not people costs)
        const vehicleCost = this.getVehicleCost(service);
        document.getElementById('servicePrice').value = vehicleCost || 0;
        console.log('📊 Using calculated vehicle cost:', vehicleCost);
      } else {
        document.getElementById('servicePrice').value = 0; // No vehicle, show 0
        console.log('⚠️ No vehicle selected, using 0');
      }
    } else {
      // Check if service has price override enabled
      if (service.priceOverride && service.customPrice !== undefined) {
        // For transport and a-disposicion services with custom price
        document.getElementById('servicePrice').value = service.customPrice;
      } else if (service.priceOverride && service.customPrices) {
        // For experiences with custom prices, use adult price as base
        document.getElementById('servicePrice').value = service.customPrices.adult || 0;
      } else if (service.priceOverride && service.adultPrice !== undefined) {
        // For tours with custom individual prices, use adult price as base
        document.getElementById('servicePrice').value = service.adultPrice || 0;
      } else {
        // Use calculated price when no custom prices are set
        document.getElementById('servicePrice').value = this.calculateServicePrice(service);
      }
    }
    document.getElementById('serviceQuantity').value = service.quantity || 1;

    // Restore additional vehicle checkbox for transport
    // Restore additional vehicle checkbox for transport and tours with transport
    const addVehicleCheckbox = document.getElementById('additionalVehicleCheckbox');
    if (addVehicleCheckbox && (service.quantity || 1) >= 2) {
      addVehicleCheckbox.checked = true;
    }

    document.getElementById('serviceNotes').value = service.notes || '';

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

    // Apply price override toggle effects (toggle is already checked earlier)
    if (service.priceOverride) {
      switch (service.type) {
        case 'experience':
          this.handlePriceOverrideToggle('experience', true);
          break;
        case 'tour':
          this.handlePriceOverrideToggle('tour', true);
          // Explicitly ensure price field is editable for tours
          const tourPriceField = document.getElementById('servicePrice');
          if (tourPriceField) {
            tourPriceField.readOnly = false;
            tourPriceField.classList.add('price-override-active');
            // Restore the custom price AFTER handlePriceOverrideToggle
            if (service.customPrice !== undefined && service.customPrice !== null) {
              tourPriceField.value = service.customPrice;
              console.log('🔄 Restored custom price after override toggle:', service.customPrice);

              // Force restore after a delay in case something else overwrites it
              setTimeout(() => {
                const field = document.getElementById('servicePrice');
                if (field && field.value !== String(service.customPrice)) {
                  console.log('🔧 Fixing price field - was:', field.value, 'setting to:', service.customPrice);
                  field.value = service.customPrice;
                  this.lastValidTourPrice = service.customPrice;
                }
              }, 200);

              // And again after a longer delay
              setTimeout(() => {
                const field = document.getElementById('servicePrice');
                if (field && field.value !== String(service.customPrice)) {
                  console.log('🔧 Final fix - setting price to:', service.customPrice);
                  field.value = service.customPrice;
                  this.lastValidTourPrice = service.customPrice;
                }
              }, 500);
            }
          }
          break;
        case 'transport':
          this.handlePriceOverrideToggle('transport', true);
          break;
        case 'a-disposicion':
          this.handlePriceOverrideToggle('aDisposicion', true);
          break;
      }
    }

    // Type-specific population
    if (service.isWalkingTour) {
      console.log('🔍 Service object BEFORE type-specific switch:', {
        serviceId: service.id,
        serviceType: service.type,
        peopleData: {
          adultsQuantity: service.adultsQuantity,
          childrenQuantity: service.childrenQuantity,
          infantsQuantity: service.infantsQuantity,
        },
      });
    }

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

            // Restore individual prices - prioritize custom prices if price override is enabled
            if (service.priceOverride && service.customPrices) {
              if (adultPriceField) {
                adultPriceField.value = service.customPrices.adult || 0;
              }
              if (childPriceField) {
                childPriceField.value = service.customPrices.child || 0;
              }
              if (noAlcoholPriceField) {
                noAlcoholPriceField.value = service.customPrices.noAlcohol || 0;
              }
            } else {
              // Use standard price fields when no custom prices
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

            // Restore start/end time fields
            const expStartTimeField = document.getElementById('experienceStartTime');
            const expEndTimeField = document.getElementById('experienceEndTime');
            if (expStartTimeField && service.startTime) expStartTimeField.value = service.startTime;
            if (expEndTimeField && service.endTime) expEndTimeField.value = service.endTime;
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
        console.log('🔍 ENTERED tour case - service object at start:', {
          serviceId: service.id,
          isWalkingTour: service.isWalkingTour,
          peopleData: {
            adultsQuantity: service.adultsQuantity,
            childrenQuantity: service.childrenQuantity,
            infantsQuantity: service.infantsQuantity,
          },
        });

        const tourSelect = document.getElementById('tourSelect');
        if (tourSelect && service.tourId) {
          tourSelect.value = service.tourId;
          // Trigger tour selection to show tour content
          console.log('🔍 About to call handleTourSelection');
          this.handleTourSelection(service.tourId);
          console.log('🔍 After handleTourSelection - service object:', {
            adultsQuantity: service.adultsQuantity,
            childrenQuantity: service.childrenQuantity,
            infantsQuantity: service.infantsQuantity,
          });
        }

        // Walking tour: restore individual counts and tier highlight
        if (service.isWalkingTour) {
          // ONLY hide standard pricing section for walking tours during EDIT mode
          // (This should NOT affect creating new walking tours or other service types)
          const standardPricingSection = document.getElementById('standardPricingSection');
          if (standardPricingSection) {
            standardPricingSection.classList.add('d-none');
            standardPricingSection.style.display = 'none'; // Force hide with inline style
            console.log('🚶‍♂️ Walking tour: Hiding standard pricing section during EDIT ONLY');
          }

          setTimeout(() => {
            const wAdults = document.getElementById('walkingTourAdultsQuantity');
            const wChildren = document.getElementById('walkingTourChildrenQuantity');
            const wInfants = document.getElementById('walkingTourInfantsQuantity');
            const peopleCountField = document.getElementById('walkingTourPeopleCount');

            // Debug: Check all service object properties for walking tours
            console.log('🔍 Service object before walking tour restoration:', {
              allPeopleKeys: Object.keys(service).filter((k) => k.includes('adult') || k.includes('child') || k.includes('infant')),
              serviceValues: {
                adultsQuantity: service.adultsQuantity,
                childrenQuantity: service.childrenQuantity,
                infantsQuantity: service.infantsQuantity,
                transportAdults: service.transportAdults,
                transportChildren: service.transportChildren,
                transportInfants: service.transportInfants,
                walkingTourPeopleCount: service.walkingTourPeopleCount,
              },
              serviceId: service.id,
              isWalkingTour: service.isWalkingTour,
            });

            console.log('🚶‍♂️ Walking tour people count restoration:', {
              serviceData: {
                adults: service.adultsQuantity,
                children: service.childrenQuantity,
                infants: service.infantsQuantity,
              },
              domElements: {
                wAdults: !!wAdults,
                wChildren: !!wChildren,
                wInfants: !!wInfants,
                peopleCountField: !!peopleCountField,
              },
            });

            if (wAdults && service.adultsQuantity !== undefined) {
              wAdults.value = service.adultsQuantity;
              console.log('✅ Set adults:', service.adultsQuantity);
            }
            if (wChildren && service.childrenQuantity !== undefined) {
              wChildren.value = service.childrenQuantity;
              console.log('✅ Set children:', service.childrenQuantity);
            }
            if (wInfants && service.infantsQuantity !== undefined) {
              wInfants.value = service.infantsQuantity;
              console.log('✅ Set infants:', service.infantsQuantity);
            }
            if (peopleCountField) {
              const totalPeople = (service.adultsQuantity || 0) + (service.childrenQuantity || 0) + (service.infantsQuantity || 0) || 1;
              peopleCountField.value = totalPeople;
              console.log('✅ Set total people count:', totalPeople);
            }

            // Re-highlight the correct tier AFTER people count fields are populated
            if (this.toursCache.has('all')) {
              const walkingTourData = this.toursCache.get('all').find(
                (t) => (t.id === service.tourId || t.objectId === service.tourId) && t.isWalkingTour
              );
              if (walkingTourData) {
                console.log('🎯 Highlighting walking tour tier after people count restoration');
                this.highlightWalkingTourTier(walkingTourData);
              }
            }

            // Restore start/end time fields for walking tours
            const tourStartTimeField = document.getElementById('tourStartTime');
            const tourEndTimeField = document.getElementById('tourEndTime');
            if (tourStartTimeField && service.startTime) tourStartTimeField.value = service.startTime;
            if (tourEndTimeField && service.endTime) tourEndTimeField.value = service.endTime;

            // Restore tour duration for walking tours
            const tourDurationField = document.getElementById('tourDuration');
            if (tourDurationField && service.duration) {
              tourDurationField.value = service.duration;
            }

            // Re-enforce hiding standard pricing section for walking tours during EDIT mode only
            const standardPricingSectionTimeout = document.getElementById('standardPricingSection');
            if (standardPricingSectionTimeout) {
              standardPricingSectionTimeout.classList.add('d-none');
              standardPricingSectionTimeout.style.display = 'none'; // Force hide with inline style
              console.log('🚶‍♂️ Walking tour: Re-enforcing standard pricing section hiding during EDIT ONLY');
            }
          }, 300);
          break;
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
            // Restore additional vehicle checkbox AFTER toggle (which resets it)
            if ((service.quantity || 1) >= 2) {
              const addVehicleCb = document.getElementById('additionalVehicleCheckbox');
              if (addVehicleCb) addVehicleCb.checked = true;
              document.getElementById('serviceQuantity').value = service.quantity;
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
                      // Only trigger vehicle selection if price override is NOT enabled
                      // This prevents overwriting custom prices during edit population
                      if (!service.priceOverride) {
                        this.handleVehicleSelection(vehicleValue);
                      }
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
          const tourInfantsQuantityField = document.getElementById('tourInfantsQuantity');
          const tourContent = document.getElementById('tourContent');

          // Check if all fields are available and visible
          if (tourAdultsQuantityField && tourChildrenQuantityField && tourInfantsQuantityField
            && tourContent && !tourContent.classList.contains('d-none')) {
            // Populate the fields
            if (service.adultsQuantity !== undefined) {
              tourAdultsQuantityField.value = service.adultsQuantity || '';
            }
            if (service.childrenQuantity !== undefined) {
              tourChildrenQuantityField.value = service.childrenQuantity || '';
            }
            if (service.infantsQuantity !== undefined) {
              tourInfantsQuantityField.value = service.infantsQuantity || '';
            }

            // Restore start/end time fields
            const tourStartTimeField = document.getElementById('tourStartTime');
            const tourEndTimeField = document.getElementById('tourEndTime');
            if (tourStartTimeField && service.startTime) tourStartTimeField.value = service.startTime;
            if (tourEndTimeField && service.endTime) tourEndTimeField.value = service.endTime;

            // Restore tour duration
            const tourDurationField = document.getElementById('tourDuration');
            if (tourDurationField && service.duration) {
              tourDurationField.value = service.duration;
            }

            // Restore tour individual price fields if price override is enabled
            if (service.priceOverride && !service.isWalkingTour) {
              const tourAdultPriceField = document.getElementById('tourAdultPrice');
              const tourChildPriceField = document.getElementById('tourChildPrice');
              const tourNoAlcoholPriceField = document.getElementById('tourNoAlcoholPrice');

              if (tourAdultPriceField && service.adultPrice !== undefined) {
                tourAdultPriceField.value = service.adultPrice;
              }
              if (tourChildPriceField && service.childPrice !== undefined) {
                tourChildPriceField.value = service.childPrice;
              }
              if (tourNoAlcoholPriceField && service.noAlcoholPrice !== undefined) {
                tourNoAlcoholPriceField.value = service.noAlcoholPrice;
              }
            }
          } else if (attempt < 5) {
            // Retry with longer delay

            setTimeout(() => populateTourQuantityFields(attempt + 1), 100 * attempt);
          } else {
            console.error('❌ Failed to populate tour quantity fields after 5 attempts');
          }
        };

        // Only prefill from information step for NEW tours (not when editing existing tours)
        console.log('🔍 Tour prefill decision:', {
          currentServiceId: this.currentServiceId,
          hasCurrentServiceId: !!this.currentServiceId,
          isEditing: !!this.currentServiceId,
        });

        if (!this.currentServiceId) {
          setTimeout(populateTourQuantityFields, 50);
          console.log('🔄 Scheduling tour quantity prefill for new tour');
        } else {
          console.log(`🚫 Skipping tour quantity prefill during edit (currentServiceId: ${this.currentServiceId})`);
        }
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

        // Helper: set SELECT value by slug or by matching option text (for display names)
        const setSelectByValueOrText = (selectEl, val) => {
          if (!selectEl || !val) return;
          selectEl.value = val;
          if (selectEl.value === val) return;
          for (let i = 0; i < selectEl.options.length; i++) {
            if (selectEl.options[i].textContent.trim() === val.trim()) {
              selectEl.selectedIndex = i;
              return;
            }
          }
        };

        // Helper: split "San Miguel de Allende, Hotel Rosewood" → { baseName, specificLocation }
        // Checks if the part before the first comma matches a known specific-location city
        const splitSpecificLocation = (value) => {
          if (!value || !value.includes(',')) return { baseName: value || '', specificLocation: '' };
          const commaIdx = value.indexOf(',');
          const candidate = value.substring(0, commaIdx).trim();
          const rest = value.substring(commaIdx + 1).trim();
          // Check if the base part is a known city that uses specific location
          const knownCities = ['San Miguel de Allende', 'San Miguel Allende', 'Centro San Miguel de Allende',
            'Guanajuato Capital', 'León', 'Ciudad de México', 'CDMX'];
          const isKnown = knownCities.some((c) => candidate.toLowerCase().includes(c.toLowerCase()));
          if (isKnown && rest) {
            return { baseName: candidate, specificLocation: rest };
          }
          return { baseName: value, specificLocation: '' };
        };

        // Populate transport fields based on trip type
        if (service.tripType === 'round-trip') {
          // Round trip fields — set into whichever field is visible per transport type
          // Ida origin
          const idaOriginSelect = document.getElementById('roundTripOriginIdaSelect');
          const idaOriginText = document.getElementById('roundTripOriginIdaText');
          if (idaOriginSelect && !idaOriginSelect.classList.contains('d-none')) {
            setSelectByValueOrText(idaOriginSelect, service.origin);
          }
          if (idaOriginText && !idaOriginText.classList.contains('d-none')) {
            idaOriginText.value = service.origin || '';
          }
          // Ida destination
          const idaDestCombo = document.getElementById('roundTripDestinationIdaCombo');
          const idaDestSelect = document.getElementById('roundTripDestinationIdaSelect');
          if (idaDestCombo && !document.getElementById('roundTripDestinationIdaComboWrapper')?.classList.contains('d-none')) {
            idaDestCombo.value = service.destination || '';
          }
          if (idaDestSelect && !idaDestSelect.classList.contains('d-none')) {
            setSelectByValueOrText(idaDestSelect, service.destination);
          }
          document.getElementById('roundTripDateIda').value = service.startDate || '';
          document.getElementById('roundTripTimeIda').value = service.startTime || '';

          // Vuelta origin
          const vueltaOriginCombo = document.getElementById('roundTripOriginVueltaCombo');
          const vueltaOriginSelect = document.getElementById('roundTripOriginVueltaSelect');
          if (vueltaOriginCombo && !document.getElementById('roundTripOriginVueltaComboWrapper')?.classList.contains('d-none')) {
            vueltaOriginCombo.value = service.returnOrigin || '';
          }
          if (vueltaOriginSelect && !vueltaOriginSelect.classList.contains('d-none')) {
            setSelectByValueOrText(vueltaOriginSelect, service.returnOrigin);
          }
          // Vuelta destination
          const vueltaDestSelect = document.getElementById('roundTripDestinationVueltaSelect');
          const vueltaDestText = document.getElementById('roundTripDestinationVueltaText');
          if (vueltaDestSelect && !vueltaDestSelect.classList.contains('d-none')) {
            setSelectByValueOrText(vueltaDestSelect, service.returnDestination);
          }
          if (vueltaDestText && !vueltaDestText.classList.contains('d-none')) {
            vueltaDestText.value = service.returnDestination || '';
          }
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
              // Re-populate dropdowns for correct direction (departure vs arrival have different options)
              if (typeof populateDropdownsForTransportType === 'function') {
                populateDropdownsForTransportType(service.transportType, service.directionType);
              }
            }
          }

          // Split specific location from origin/destination if embedded (e.g., "San Miguel, Hotel X")
          const originSplit = splitSpecificLocation(service.origin);
          const destSplit = splitSpecificLocation(service.destination);
          let extractedSpecificLocation = '';

          // Set origin/destination in the correct fields based on direction
          const isDeparture = service.directionType === 'departure';
          const isDepartureWithSelect = isDeparture && (service.transportType === 'aeropuerto' || service.transportType === 'punto-a-punto');
          const isLocalIda = !isDeparture && service.transportType === 'local';
          if (isLocalIda) {
            // Local Ida: origin = TEXT, destination = SELECT
            document.getElementById('transportOriginText').value = originSplit.baseName;
            setSelectByValueOrText(document.getElementById('transportDestinationSelect'), destSplit.baseName);
          } else if (isDeparture && service.transportType === 'local') {
            // Local Vuelta: origin = SELECT, destination = TEXT
            setSelectByValueOrText(document.getElementById('transportOriginSelect'), originSplit.baseName);
            document.getElementById('transportDestinationText').value = destSplit.baseName;
          } else if (isDeparture) {
            // Departure: origin = SELECT (city), destination = SELECT (airport)
            setSelectByValueOrText(document.getElementById('transportOriginSelect'), originSplit.baseName);
            setSelectByValueOrText(document.getElementById('transportDestinationSelect'), destSplit.baseName);
            extractedSpecificLocation = originSplit.specificLocation;
          } else {
            // Arrival: origin = SELECT (airport), destination = SELECT (city)
            setSelectByValueOrText(document.getElementById('transportOriginSelect'), originSplit.baseName);
            setSelectByValueOrText(document.getElementById('transportDestinationSelect'), destSplit.baseName);
            extractedSpecificLocation = destSplit.specificLocation;
          }
          document.getElementById('transportOriginText').value = originSplit.baseName;

          // Populate the new people fields for transport
          document.getElementById('transportAdults').value = service.transportAdults || '';
          document.getElementById('transportChildren').value = service.transportChildren || '';
          document.getElementById('transportInfants').value = service.transportInfants || '';

          // Restore specific location — from explicit field or extracted from origin/destination
          const specificToRestore = service.specificLocation || extractedSpecificLocation;
          if (specificToRestore) {
            const specificLocationField = document.getElementById('transportSpecificLocation');
            if (specificLocationField) specificLocationField.value = specificToRestore;
            const specificLocationRow = document.getElementById('specificLocationRow');
            if (specificLocationRow) specificLocationRow.classList.remove('d-none');
          }

          // Populate the new people fields for transport
          document.getElementById('transportAdults').value = service.transportAdults || '';
          document.getElementById('transportChildren').value = service.transportChildren || '';
          document.getElementById('transportInfants').value = service.transportInfants || '';

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
          // Use custom price if override is enabled, otherwise use service.price
          const savedPrice = (service.priceOverride && service.customPrice !== undefined)
            ? service.customPrice
            : (service.price || 0);
          // Trigger rate selection to fetch and populate vehicles
          // Pass origin/destination from service data as fallback for race conditions
          // Strip specific location suffix from origin/destination for API lookup
          const editOrigin = (service.originName || service.origin || '').split(',')[0].trim();
          const editDestination = (service.destination || '').split(',')[0].trim();
          this.handleTransportRateSelection(service.category, editOrigin, editDestination).then(() => {
            // After vehicles are loaded, set the saved vehicle
            if (service.vehicleType) {
              const vehicleSelect = document.getElementById('vehicleSelect');
              if (vehicleSelect) {
                vehicleSelect.value = service.vehicleType;
                // Fallback: match by vehicle name if ID doesn't match
                if (!vehicleSelect.value && service.vehicleTypeName) {
                  for (let i = 0; i < vehicleSelect.options.length; i++) {
                    if (vehicleSelect.options[i].textContent.includes(service.vehicleTypeName)) {
                      vehicleSelect.selectedIndex = i;
                      break;
                    }
                  }
                }
              }
            }
            // Restore price (populateTransportVehicleDropdown resets it to 0)
            document.getElementById('servicePrice').value = savedPrice;
            // Update capacity note now that vehicle is populated
            this.updateVehicleCapacityNote();
            // Restore waiting time
            if (service.waitingTimeHours > 0) {
              const wtHoursField = document.getElementById('waitingTimeHours');
              if (wtHoursField) wtHoursField.value = service.waitingTimeHours;
            }
            this.updateWaitingTimeRateDisplay();
            // Clear flag after async population is complete
            this._populatingTransportForm = false;
          });
        } else {
          // Restore waiting time even without category
          if (service.waitingTimeHours > 0) {
            const wtHoursField = document.getElementById('waitingTimeHours');
            if (wtHoursField) wtHoursField.value = service.waitingTimeHours;
          }
          this._populatingTransportForm = false;
        }
        break;

      case 'a-disposicion':
        if (service.startTime) document.getElementById('aDisposicionStartTime').value = service.startTime;
        if (service.endTime) document.getElementById('aDisposicionEndTime').value = service.endTime;

        // Restore rate → load vehicles → set vehicle → recalculate price
        if (service.rateId) {
          const adRateSelect = document.getElementById('aDisposicionRate');
          if (adRateSelect) {
            adRateSelect.value = service.rateId;
            await this.handleADisposicionRateChange(service.rateId);
            if (service.vehicleType) {
              document.getElementById('aDisposicionVehicle').value = service.vehicleType;
            }
          }
        }
        if (service.vehicleCount) {
          document.getElementById('aDisposicionVehicleCount').value = service.vehicleCount;
        }
        if (service.hours) {
          document.getElementById('aDisposicionHours').value = service.hours;
        }

        // Only recalculate price if no custom price override is set
        if (!service.priceOverride || service.customPrice === undefined) {
          await this.calculateADisposicionPrice();
        } else {
          // For services with custom price override, restore the custom price with multiple timeout attempts
          const { customPrice } = service;
          console.log('🔄 A Disposición: Restoring custom price with timeouts:', customPrice);

          // Immediate restoration attempt
          const priceField = document.getElementById('servicePrice');
          if (priceField) {
            priceField.value = customPrice;
            console.log('✅ Immediate custom price restoration:', customPrice);
          }

          // Additional restoration attempts with timeouts to handle timing issues
          [50, 100, 250, 500].forEach((delay, index) => {
            setTimeout(() => {
              const currentField = document.getElementById('servicePrice');
              if (currentField && parseFloat(currentField.value || 0) !== customPrice) {
                console.log(`🔄 Timeout ${index + 1} (${delay}ms): Restoring custom price:`, customPrice);
                currentField.value = customPrice;
              } else if (currentField) {
                console.log(`✅ Timeout ${index + 1} (${delay}ms): Custom price already correct:`, currentField.value);
              }
            }, delay);
          });
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

    // Populate common fields for all service types
    const serviceDescriptionField = document.getElementById('serviceDescription');
    const internalNotesField = document.getElementById('internalNotes');
    const clientNotesField = document.getElementById('clientNotes');
    const providerNotesField = document.getElementById('providerNotes');
    const teamNotesField = document.getElementById('teamNotes');

    if (serviceDescriptionField && service.serviceDescription) {
      serviceDescriptionField.value = service.serviceDescription;
    }
    if (internalNotesField && service.internalNotes) {
      internalNotesField.value = service.internalNotes;
    }
    if (clientNotesField && service.clientNotes) {
      clientNotesField.value = service.clientNotes;
    }
    if (providerNotesField && service.providerNotes) {
      providerNotesField.value = service.providerNotes;
    }
    if (teamNotesField && service.teamNotes) {
      teamNotesField.value = service.teamNotes;
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
                                <button type="button" class="btn btn-sm btn-primary add-service-btn"
                                        data-day-id="${day.id}" title="Agregar servicio">
                                    <i class="ti ti-plus"></i>
                                </button>
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

    let badgeLabel = null;
    if (service.type === 'tour' && service.isWalkingTour) {
      badgeLabel = 'Tour a Pie';
    } else if (service.type === 'experience' && this.isExperienceFromEstablishment(service.experienceId)) {
      badgeLabel = 'Establecimiento';
    }
    
    const typeLabels = {
      experience: 'Experiencia',
      tour: 'Tour',
      transport: 'Transporte',
      'a-disposicion': 'A Disposición',
      concepto: 'Concepto',
    };

    return `
            <div class="service-item mb-3 p-3 border rounded hover-shadow ${service.hasOverlap ? 'has-overlap' : ''}" data-service-id="${service.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-start mb-2">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <span class="badge bg-light text-dark me-2">${badgeLabel || typeLabels[service.type] || service.type}</span>
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
                                                <strong>Incluye Greeter ${service.routeDuration ? this.formatGreeterFormula(service.routeDuration, this.calculateGreeterPrice(service.routeDuration)) : ''}</strong>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${service.type === 'transport' && service.waitingTimeHours > 0 ? `
                                        <div class="row g-2 text-warning small mt-1">
                                            <div class="col-auto">
                                                <i class="ti ti-clock me-1"></i>
                                                <strong>Tiempo de espera: ${service.waitingTimeHours}h</strong>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${service.availabilityPending ? `
                                        <div class="mt-1">
                                            <span class="badge bg-warning text-dark">
                                                <i class="ti ti-alert-triangle me-1"></i>Verificar disponibilidad
                                            </span>
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
                            ${this.getPriceTypeLabel()}
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
                            ${service.directionType ? `<span class="badge ${service.directionType === 'arrival' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}">${(service.transportType === 'punto-a-punto' || service.transportType === 'local') ? (service.directionType === 'arrival' ? 'Ida' : 'Vuelta') : (service.directionType === 'arrival' ? 'Llegada' : 'Salida')}</span>` : ''}
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
                                    <strong>Incluye Greeter ${service.routeDuration ? this.formatGreeterFormula(service.routeDuration, this.calculateGreeterPrice(service.routeDuration)) : ''}</strong>
                                </div>
                            ` : ''}
                            ${service.waitingTimeHours > 0 ? `
                                <div class="d-flex align-items-center text-warning small mt-1">
                                    <i class="ti ti-clock me-1"></i>
                                    <strong>Tiempo de espera: ${service.waitingTimeHours}h</strong>
                                </div>
                            ` : ''}
                            ${service.availabilityPending ? `
                                <div class="mt-1">
                                    <span class="badge bg-warning text-dark">
                                        <i class="ti ti-alert-triangle me-1"></i>Verificar disponibilidad
                                    </span>
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
                            ${this.getPriceTypeLabel()}
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

    // Walking tour: return the tier-based price (already includes duration multiplication)
    if (service.type === 'tour' && service.isWalkingTour) {
      return service.walkingTourPrice || service.price || 0;
    }

    // For experience and tour services, calculate based on people quantities and individual prices
    if (service.type === 'experience' || service.type === 'tour') {
      // Check for custom BASE price override for tours
      if (service.type === 'tour' && service.priceOverride && service.customPrice !== null && service.customPrice !== undefined) {
        // Custom price is the BASE price per vehicle
        const basePrice = service.customPrice;
        const quantity = service.quantity || 1;
        const duration = service.duration || 1;
        let totalPrice = basePrice * quantity * duration;

        // Add driver tour rate if includeGuide is checked
        if (service.includeGuide && this.driverTourRateCache) {
          const driverTourRate = this.driverTourRateCache.value || 0;
          totalPrice += driverTourRate;
          console.log('🚗 Adding driver tour rate to custom price total:', driverTourRate);
        }

        // Note: Removed verbose custom pricing log for console cleanup

        return totalPrice;
      }
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

      // Get tour duration
      const duration = service.duration || 1;

      // If we have individual prices, calculate based on quantities and multiply by duration
      if (adultPrice > 0 || childPrice > 0 || noAlcoholPrice > 0) {
        totalPrice = ((adultsQuantity * adultPrice)
          + (childrenQuantity * childPrice)
          + (adultsNoAlcoholQuantity * noAlcoholPrice)) * duration;

        if (service.type === 'tour') {
          // console.log('👥 calculateServicePrice - People total calculated:', totalPrice);
        }
      }

      // For tours with transport, add vehicle costs (also multiplied by duration)
      if (service.type === 'tour' && (service.vehicleId || service.vehicleType || service.vehicleTypeName)) {
        const vehicleQuantity = service.quantity || 1; // Number of vehicles needed
        const vehicleCost = this.getVehicleCost(service);
        const vehicleTotal = vehicleCost * vehicleQuantity * duration;
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
      // Check for custom price override for transport
      if (service.priceOverride && service.customPrice !== null && service.customPrice !== undefined) {
        // Custom price is the BASE price per vehicle
        const basePrice = service.customPrice;
        const quantity = service.quantity || 1;
        let totalPrice = basePrice * quantity;

        // Add guide surcharge if included
        if (service.includeGuide && service.routeDuration) {
          totalPrice += this.calculateGuideTransportCost(service.routeDuration);
        }

        // Add greeter surcharge if included
        if (service.includeGreeter && service.routeDuration) {
          totalPrice += this.calculateGreeterPrice(service.routeDuration);
        }

        // Add waiting time if applicable
        if (service.waitingTimeHours > 0 && service.waitingTimePricePerHour > 0) {
          totalPrice += service.waitingTimePricePerHour * service.waitingTimeHours;
        }

        // Apply special rounding to final total if greeter is included
        if (service.includeGreeter) {
          const originalTotal = totalPrice;
          totalPrice = this.applySpecialRounding(totalPrice);
          
          console.log('💰 Transport service with greeter rounding (custom price):', {
            basePrice: basePrice * quantity,
            includeGuide: service.includeGuide,
            includeGreeter: service.includeGreeter,
            originalTotal,
            finalRoundedTotal: totalPrice,
            formula: `${originalTotal} → ${totalPrice}`
          });
        }

        return totalPrice;
      }

      const vehiclePrice = service.baseVehiclePrice || service.price || 0;
      const quantity = service.quantity || 1;
      let totalPrice = vehiclePrice * quantity;

      if (service.includeGuide && service.routeDuration) {
        totalPrice += this.calculateGuideTransportCost(service.routeDuration);
      }

      if (service.includeGreeter && service.routeDuration) {
        totalPrice += this.calculateGreeterPrice(service.routeDuration);
      }

      // Waiting time (Tiempo de espera)
      if (service.waitingTimeHours > 0 && service.waitingTimePricePerHour > 0) {
        totalPrice += service.waitingTimePricePerHour * service.waitingTimeHours;
      }

      // Apply special rounding to final total if greeter is included
      if (service.includeGreeter) {
        const originalTotal = totalPrice;
        totalPrice = this.applySpecialRounding(totalPrice);
        
        console.log('💰 Transport service with greeter rounding:', {
          basePrice: vehiclePrice * quantity,
          includeGuide: service.includeGuide,
          includeGreeter: service.includeGreeter,
          originalTotal,
          finalRoundedTotal: totalPrice,
          formula: `${originalTotal} → ${totalPrice}`
        });
      }

      return totalPrice;
    }

    // For a-disposicion services: hourlyRate * hours * vehicleCount
    if (service.type === 'a-disposicion') {
      // Check for custom price override for a-disposicion
      if (service.priceOverride && service.customPrice !== null && service.customPrice !== undefined) {
        // Custom price is the HOURLY rate
        const hourlyRate = service.customPrice;
        const hours = service.hours || 4; // Default 4 hours
        const vehicleCount = service.vehicleCount || 1;
        let totalPrice = hourlyRate * hours * vehicleCount;

        // Apply discount if applicable
        const discount = service.discountPercent || this.getADisposicionDiscount(hours);
        if (discount > 0) {
          totalPrice *= (1 - discount / 100);
        }

        return totalPrice;
      }

      // Use calculated hourly rate when no override
      const hourlyRate = service.hourlyPrice || 0;
      const hours = service.hours || 4;
      const vehicleCount = service.vehicleCount || 1;
      let totalPrice = hourlyRate * hours * vehicleCount;

      // Apply discount if applicable
      if (service.discountPercent > 0) {
        totalPrice *= (1 - service.discountPercent / 100);
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
          flightHtml = `<span class="badge bg-secondary-subtle text-secondary d-inline-flex align-items-center gap-1 me-2 mb-1"><i class="ti ti-plane fs-6"></i><span>${service.airline ? `${service.airline} ` : ''}${service.flightNumber}</span></span>`;
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

  getPriceTypeLabel() {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    if (paymentType !== 'efectivo') {
      return '<small class="text-muted ms-1" style="font-size: 0.75rem;">(con IVA)</small>';
    }
    return '';
  }

  /**
   * Format greeter formula for display in price breakdown.
   * Shows the exact formula being used with values and calculation.
   * @param {number} durationMinutes - Route duration in minutes
   * @param {number} finalPrice - The calculated final price
   * @returns {string} Formatted formula display
   * @example
   * formatGreeterFormula(90, 1320) // Returns: "($760 + $640×1.5h = $1,320)"
   */
  formatGreeterFormula(durationMinutes, finalPrice) {
    const basePrice = this.greeterRateCache?.basePrice || 760;
    const hourlyRate = this.greeterRateCache?.hourlyRate || 640;
    const isUsingCache = !!this.greeterRateCache;
    const durationHours = durationMinutes / 60;
    
    const source = isUsingCache ? '[API]' : '[Default]';
    const formattedBase = this.formatCurrency(basePrice);
    const formattedHourly = this.formatCurrency(hourlyRate);
    const formattedFinal = this.formatCurrency(finalPrice);
    
    return `(${formattedBase} + ${formattedHourly}×${durationHours.toFixed(1)}h = ${formattedFinal}) ${source}`;
  }

  /**
   * Apply payment surcharge + currency conversion for display.
   * All internal prices stay in MXN; this is display-only.
   * @param mxnPrice
   * @example
   */
  getDisplayPrice(mxnPrice) {
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const currency = document.getElementById('currencySelect')?.value || 'MXN';

    // Step 1: Apply cash rounding for efectivo payments
    let priceToProcess = mxnPrice;
    if (paymentType === 'efectivo' && currency === 'MXN' && window.PricingUtils && window.PricingUtils.applyCashRounding) {
      priceToProcess = PricingUtils.applyCashRounding(mxnPrice);
    }

    // Step 2: Apply payment surcharge
    let withSurcharge = priceToProcess;
    if (window.PricingUtils) {
      withSurcharge = PricingUtils.applyPaymentRate(priceToProcess, paymentType, this.transferRate, this.agencyRate);
    } else if (paymentType === 'transferencia' && this.transferRate > 0) {
      withSurcharge = priceToProcess * (1 + this.transferRate / 100);
    } else if (paymentType === 'tarjeta' && this.agencyRate > 0) {
      withSurcharge = priceToProcess * (1 + this.agencyRate / 100);
    }

    // Step 3: Currency conversion
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

  extractAvailabilitySchedule(item) {
    const dayAbbrevs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dayNamesEn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const result = []; // Array of { day: 'Lun', times: ['08:00 - 12:00'] }

    // String format: "Sa, Vi, Ju, Mi"
    if (typeof item.availability === 'string' || typeof item.availableDays === 'string') {
      const str = item.availability || item.availableDays;
      const abbrevMap = {
        do: 0, lu: 1, ma: 2, mi: 3, ju: 4, vi: 5, sa: 6, sá: 6,
      };
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
              const extracted = this.extractTimesFromScheduleData(obj[key], 0);
              extracted.forEach((t) => dayTimesMap.get(d).push(t.label));
              break;
            }
          }
          if (obj.day === d) {
            if (!dayTimesMap.has(d)) dayTimesMap.set(d, []);
            const extracted = this.extractTimesFromScheduleData(obj, 0);
            extracted.forEach((t) => dayTimesMap.get(d).push(t.label));
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
  }

  renderAvailabilityPills(schedule) {
    if (!schedule || schedule.length === 0 || (schedule.length === 7 && schedule.every((s) => s.times.length === 0))) {
      return '<span class="badge bg-light text-dark border">Todos los días</span>';
    }
    return schedule.map((s) => {
      const timeStr = s.times.length > 0 ? ` ${s.times.map((t) => t.replace(/\s*-\s*/g, '-')).join(', ')}` : '';
      return `<span class="badge bg-light text-dark border me-1 mb-1">${s.day}${timeStr}</span>`;
    }).join('');
  }

  renderAvailabilityTable(schedule) {
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
  }

  buildDetailsCard(type, data) {
    const cardId = type === 'experience' ? 'experienceDetailsCard' : 'tourDetailsCard';
    const bodyId = type === 'experience' ? 'experienceDetailsCardBody' : 'tourDetailsCardBody';
    const card = document.getElementById(cardId);
    const body = document.getElementById(bodyId);
    if (!card || !body) return;

    const tag = (icon, value) => {
      if (!value) return '';
      return `<span class="me-3 small"><i class="ti ti-${icon} me-1 text-muted"></i>${value}</span>`;
    };

    const infoLine = (icon, label, value) => {
      if (!value) return '';
      return `<div class="small py-1"><i class="ti ti-${icon} me-1 text-muted"></i><span class="text-muted">${label}:</span> ${value}</div>`;
    };

    body.innerHTML = `
      <h6 class="fw-bold mb-1">${data.title}</h6>
      ${data.description ? `<p class="text-muted small mb-2">${data.description}</p>` : ''}
      <hr class="my-2">
      <div class="d-flex flex-wrap align-items-center mb-2">
        ${tag('clock', data.duration ? `${data.durationLabel || 'Duración'}: ${data.duration}` : null)}
        ${tag('calendar-event', `Reserva anticipada: ${data.advanceBooking || 'Inmediata'}`)}
        ${tag('language', data.languages ? `Idiomas: ${data.languages}` : null)}
      </div>
      <div class="mb-2">
        <span class="small text-muted d-block mb-2"><i class="ti ti-calendar me-1"></i>Recomendamos salir:</span>
        ${this.renderAvailabilityTable(data.availabilitySchedule)}
      </div>
      ${data.includes || data.notIncludes || data.clientNotes ? '<hr class="my-2">' : ''}
      ${infoLine('circle-check', 'Incluye', data.includes)}
      ${infoLine('circle-x', 'No incluye', data.notIncludes)}
      ${infoLine('notes', 'Notas', data.clientNotes)}
    `;

    card.classList.remove('d-none');
  }

  hideDetailsCard(type) {
    const cardId = type === 'experience' ? 'experienceDetailsCard' : 'tourDetailsCard';
    const card = document.getElementById(cardId);
    if (card) card.classList.add('d-none');
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
      case 'a-disposicion':
        return service.vehicleTypeName || 'A Disposición';
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

  isExperienceFromEstablishment(experienceId) {
    if (!experienceId) return false;

    // Check regular experiences cache
    if (this.experiencesCache.has('all')) {
      const experiences = this.experiencesCache.get('all');
      const experience = experiences.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      if (experience && experience.provider?.type && experience.provider.type.toLowerCase() === 'establishment') {
        return true;
      }
    }

    // Check provider experiences cache
    if (this.providerExperiencesCache && Array.isArray(this.providerExperiencesCache)) {
      const experience = this.providerExperiencesCache.find((exp) => exp.id === experienceId || exp.objectId === experienceId);
      if (experience && experience.provider?.type && experience.provider.type.toLowerCase() === 'establishment') {
        return true;
      }
    }

    return false;
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
    // Calculate total from all services (prices already include transfer rate if applicable)
    let totalMXN = 0;

    this.days.forEach((day) => {
      day.services.forEach((serviceId) => {
        const service = this.services.get(serviceId);
        if (service && service.includeInTotal !== false) {
          const servicePrice = this.calculateServicePrice(service);
          totalMXN += servicePrice * (service.type === 'transport' ? 1 : service.quantity);
        }
      });
    });

    // Apply display price conversion (includes transfer rate, currency conversion, etc.)
    const displayTotal = this.getDisplayPrice(totalMXN);
    
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const ivaRow = document.getElementById('ivaRow');
    
    let displaySubtotal, iva, finalTotal;
    
    if (paymentType === 'efectivo') {
      // For cash: no IVA
      displaySubtotal = displayTotal;
      iva = 0;
      finalTotal = displayTotal;
      if (ivaRow) {
        ivaRow.classList.add('d-none');
      }
    } else {
      // For transferencia/tarjeta: extract IVA from total
      // Services already include IVA, so: Base = Total ÷ 1.16
      displaySubtotal = displayTotal / 1.16;
      iva = displayTotal - displaySubtotal;
      finalTotal = displayTotal;
      if (ivaRow) {
        ivaRow.classList.remove('d-none');
      }
    }
    
    const passengers = this.numberOfPeople || 0;
    const perPerson = passengers > 0 ? finalTotal / passengers : 0;

    // Update displays
    document.getElementById('subtotalAmount').textContent = `${this.formatCurrency(displaySubtotal)}`;
    document.getElementById('ivaAmount').textContent = `${this.formatCurrency(iva)}`;
    document.getElementById('totalAmount').textContent = `${this.formatCurrency(finalTotal)}`;
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

          // Cache individual passenger counts for prefill functionality
          this.quoteData = {
            numberOfAdults: result.data.numberOfAdults || 0,
            numberOfChildren: result.data.numberOfChildren || 0,
            numberOfInfants: result.data.numberOfInfants || 0,
          };

          // If there's a pending prefill request, execute it now
          if (this.pendingPrefillRequest) {
            this.prefillPeopleFields();
            this.pendingPrefillRequest = false;
          }

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

    // Restore saved currency and payment type to dropdowns (if not already set by sessionStorage)
    const quoteKey = this.quoteId || 'default';
    if (serviceItemsData.currency && !sessionStorage.getItem(`quoteServices_currency_${quoteKey}`)) {
      const currencyEl = document.getElementById('currencySelect');
      if (currencyEl) currencyEl.value = serviceItemsData.currency;
    }
    if (serviceItemsData.paymentType && !sessionStorage.getItem(`quoteServices_paymentType_${quoteKey}`)) {
      const paymentEl = document.getElementById('priceTypeSelect');
      if (paymentEl) paymentEl.value = serviceItemsData.paymentType;
    }

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

          // Note: Removed verbose backend service data logging for console cleanup
          const serviceData = {
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
            providerType: subconcept.providerType,
            tourId: subconcept.tourId,
            rateId: subconcept.rateId,
            hotelName: subconcept.hotelName,
            checkIn: subconcept.checkIn,
            checkOut: subconcept.checkOut,
            // People quantities for experiences (from backend)
            adultsQuantity: subconcept.adultsQuantity || 0,
            childrenQuantity: subconcept.childrenQuantity || 0,
            adultsNoAlcoholQuantity: subconcept.adultsNoAlcoholQuantity || 0,
            infantsQuantity: subconcept.infantsQuantity || 0,
            // Schedule for experiences (from backend)
            selectedSchedule: subconcept.selectedSchedule || '',
            // Individual prices for experiences (from backend)
            adultPrice: subconcept.adultPrice || 0,
            childPrice: subconcept.childPrice || 0,
            noAlcoholPrice: subconcept.noAlcoholPrice || 0,
            // Tour-specific fields (from backend)
            duration: subconcept.duration || 1,
            includeGuide: subconcept.includeGuide || false,
            includeGreeter: subconcept.includeGreeter || false,
            greeterInVehicle: subconcept.greeterInVehicle || false,
            availabilityPending: subconcept.availabilityPending || false,
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
            waitingTimeHours: subconcept.waitingTimeHours || 0,
            waitingTimePricePerHour: subconcept.waitingTimePricePerHour || 0,
            // Round trip fields
            startDate: subconcept.startDate || null,
            endDate: subconcept.endDate || null,
            returnOrigin: subconcept.returnOrigin || null,
            returnDestination: subconcept.returnDestination || null,
            returnAirline: subconcept.returnAirline || null,
            returnFlightNumber: subconcept.returnFlightNumber || null,
            // Price override fields (from backend)
            priceOverride: subconcept.priceOverride || false,
            customPrice: subconcept.customPrice || null,
            customPrices: subconcept.customPrices || null,
            // Walking tour fields (from backend)
            isWalkingTour: subconcept.isWalkingTour || false,
            walkingTourPrice: subconcept.walkingTourPrice || null,
            walkingTourPeopleCount: subconcept.walkingTourPeopleCount || null,
            walkingTourCurrency: subconcept.walkingTourCurrency || null,
            walkingTourPriceOverride: subconcept.walkingTourPriceOverride || false,
            walkingTourPriceMode: subconcept.walkingTourPriceMode || null,
            walkingTourGroupPrices: subconcept.walkingTourGroupPrices || null,
          };

          // Debug: Log what gets stored in services Map for walking tours
          if (subconcept.isWalkingTour || (subconcept.concept && subconcept.concept.toLowerCase().includes('pie'))) {
            // Note: Removed walking tour storage log for console cleanup
          }

          this.services.set(serviceId, serviceData);

          // Debug logging for loaded service data
          // Note: Removed verbose backend service price loading log for console cleanup

          // Debug logging for people quantities and schedule loading
          if (subconcept.type === 'experience' && (subconcept.adultsQuantity || subconcept.childrenQuantity || subconcept.adultsNoAlcoholQuantity || subconcept.selectedSchedule)) {
          }

          // Debug logging for includeGuide loading
          if (subconcept.type === 'tour' && subconcept.includeGuide) {
            // console.log('🔄 Loading tour with includeGuide from backend:', subconcept.includeGuide);
          }

          // Debug logging for walking tour data loading
          if (subconcept.isWalkingTour) {
            console.log('🚶‍♂️ Loading walking tour from backend:', {
              concept: subconcept.concept,
              isWalkingTour: subconcept.isWalkingTour,
              backendPeopleData: {
                adultsQuantity: subconcept.adultsQuantity,
                childrenQuantity: subconcept.childrenQuantity,
                infantsQuantity: subconcept.infantsQuantity,
                walkingTourPeopleCount: subconcept.walkingTourPeopleCount,
              },
              walkingTourPrice: subconcept.walkingTourPrice,
              duration: subconcept.duration,
              rawSubconcept: Object.keys(subconcept).filter((k) => k.includes('adult') || k.includes('child') || k.includes('infant')).reduce((obj, key) => {
                obj[key] = subconcept[key];
                return obj;
              }, {}),
            });
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
          // NEW: Check if both services share the same destination POI
          // If they do, it's not a conflict since they're at the same location
          if (this.servicesShareDestination(serviceA, serviceB)) {
            continue; // Skip conflict - same destination allows overlapping activities
          }

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

  // Check if two services share the same destination POI
  servicesShareDestination(serviceA, serviceB) {
    // Only check for tours and experiences that have destinationPOI
    if (!serviceA || !serviceB) return false;

    // Both must be tour or experience types to have destinations
    const hasDestinationTypes = ['tour', 'experience'];
    if (!hasDestinationTypes.includes(serviceA.type) || !hasDestinationTypes.includes(serviceB.type)) {
      return false;
    }

    // Get destination POI IDs for comparison
    let destinationA = null;
    let destinationB = null;

    // For tours, check the cached tour data
    if (serviceA.type === 'tour' && serviceA.tourId && this.toursCache.has('all')) {
      const tourA = this.toursCache.get('all').find((t) => t.id === serviceA.tourId || t.objectId === serviceA.tourId);
      if (tourA?.destinationPOI) {
        destinationA = tourA.destinationPOI.objectId || tourA.destinationPOI.id || tourA.destinationPOI;
      }
    }

    if (serviceB.type === 'tour' && serviceB.tourId && this.toursCache.has('all')) {
      const tourB = this.toursCache.get('all').find((t) => t.id === serviceB.tourId || t.objectId === serviceB.tourId);
      if (tourB?.destinationPOI) {
        destinationB = tourB.destinationPOI.objectId || tourB.destinationPOI.id || tourB.destinationPOI;
      }
    }

    // For experiences, check the cached experience data
    if (serviceA.type === 'experience' && serviceA.experienceId) {
      if (this.experiencesCache.has('all')) {
        const expA = this.experiencesCache.get('all').find((e) => e.id === serviceA.experienceId || e.objectId === serviceA.experienceId);
        if (expA?.destinationPOI) {
          destinationA = expA.destinationPOI.objectId || expA.destinationPOI.id || expA.destinationPOI;
        }
      }
      // Also check provider experiences cache
      if (!destinationA && this.providerExperiencesCache) {
        const expA = this.providerExperiencesCache.find((e) => e.id === serviceA.experienceId || e.objectId === serviceA.experienceId);
        if (expA?.destinationPOI) {
          destinationA = expA.destinationPOI.objectId || expA.destinationPOI.id || expA.destinationPOI;
        }
      }
    }

    if (serviceB.type === 'experience' && serviceB.experienceId) {
      if (this.experiencesCache.has('all')) {
        const expB = this.experiencesCache.get('all').find((e) => e.id === serviceB.experienceId || e.objectId === serviceB.experienceId);
        if (expB?.destinationPOI) {
          destinationB = expB.destinationPOI.objectId || expB.destinationPOI.id || expB.destinationPOI;
        }
      }
      // Also check provider experiences cache
      if (!destinationB && this.providerExperiencesCache) {
        const expB = this.providerExperiencesCache.find((e) => e.id === serviceB.experienceId || e.objectId === serviceB.experienceId);
        if (expB?.destinationPOI) {
          destinationB = expB.destinationPOI.objectId || expB.destinationPOI.id || expB.destinationPOI;
        }
      }
    }

    // Both services must have destinations and they must match
    if (destinationA && destinationB && destinationA === destinationB) {
      console.log(`✅ Services at same destination (${destinationA}) - no overlap conflict`);
      return true;
    }

    return false;
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
    // Prevent duplicate API calls
    if (this.loadingStates.guideTransportRate || this.guideTransportRateCache !== null) {
      console.log('🔒 Guide transport rate already loaded/loading, skipping');
      return;
    }

    this.loadingStates.guideTransportRate = true;
    try {
      console.log('🚀 Loading guide transport rate...');
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
    } finally {
      this.loadingStates.guideTransportRate = false;
    }
  }

  async loadGuideFormulaConfiguration() {
    // Prevent duplicate API calls
    if (this.loadingStates.guideFormulaConfig || this.guideFormulaConfigCache !== null) {
      console.log('🔒 Guide formula config already loaded/loading, skipping');
      return;
    }

    this.loadingStates.guideFormulaConfig = true;

    try {
      console.log('📥 Loading guide formula configuration...');
      const response = await fetch('/api/guide-transport-rate/formula', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getAccessToken()}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.config) {
          this.guideFormulaConfigCache = result.config;
          console.log('✅ Guide formula configuration loaded successfully');
        }
      } else if (response.status === 404) {
        // Use defaults if config not found
        this.guideFormulaConfigCache = {
          roundTripMultiplier: 2,
          minimumCharge: 0,
          formulaVersion: '1.0',
        };
        console.log('⚠️ No formula config found, using defaults');
      } else {
        console.warn(`Guide formula config API returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error loading guide formula configuration:', error);
      // Use defaults on error
      this.guideFormulaConfigCache = {
        roundTripMultiplier: 2,
        minimumCharge: 0,
        formulaVersion: '1.0',
      };
    } finally {
      this.loadingStates.guideFormulaConfig = false;
    }
  }

  async loadGreeterRateConfiguration() {
    // Check cache validity (5 minutes cache)
    const now = Date.now();
    const cacheValidDuration = 5 * 60 * 1000; // 5 minutes
    if (this.greeterRateCache && this.greeterRateCacheTime && 
        (now - this.greeterRateCacheTime) < cacheValidDuration) {
      console.log('🔒 Greeter rate config cache still valid, skipping API call');
      return this.greeterRateCache;
    }

    try {
      console.log('📥 Loading greeter rate configuration...');
      const token = this.getAccessToken();
      console.log('🔑 Using access token:', token ? 'Present' : 'Missing');
      
      const response = await fetch('/api/greeter-rate/formula', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('🌐 API Response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (response.ok) {
        const result = await response.json();
        console.log('📦 API Response Data:', result);
        
        if (result.success && result.data) {
          this.greeterRateCache = {
            basePrice: result.data.basePrice || 760,
            hourlyRate: result.data.hourlyRate || 640
          };
          this.greeterRateCacheTime = now;
          console.log('✅ Quote Services: Greeter rate configuration loaded from API:', this.greeterRateCache);
          return this.greeterRateCache;
        } else {
          console.warn('⚠️ Quote Services: API response missing data field:', result);
        }
      } else if (response.status === 404) {
        // Use defaults if config not found
        this.greeterRateCache = { basePrice: 760, hourlyRate: 640 };
        this.greeterRateCacheTime = now;
        console.log('⚠️ No greeter rate config found (404), using defaults');
        return this.greeterRateCache;
      } else {
        const responseText = await response.text();
        console.warn(`❌ Greeter rate config API returned ${response.status}: ${response.statusText}`, responseText);
      }
    } catch (error) {
      console.error('❌ Error loading greeter rate configuration:', error);
    }

    // Fallback to defaults on error
    this.greeterRateCache = { basePrice: 760, hourlyRate: 640 };
    this.greeterRateCacheTime = now;
    console.log('🔄 Using fallback greeter rate configuration');
    return this.greeterRateCache;
  }

  /**
   * Refresh greeter rate cache by forcing a reload from the API.
   * Call this when greeter rates might have been updated.
   * Can also be called from browser console: window.quoteServices.refreshGreeterRateCache()
   */
  async refreshGreeterRateCache() {
    console.log('🔄 Quote Services: Manually refreshing greeter rate cache...');
    this.greeterRateCache = null;
    this.greeterRateCacheTime = null;
    const result = await this.loadGreeterRateConfiguration();
    console.log('🎯 Quote Services: Cache refreshed, new values:', result);
    return result;
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
      this.currentServiceAvailabilityPending = false;
      return;
    }

    // Check if selected option is marked as unavailable
    const expSelect = document.getElementById('experienceSelect');
    const selectedOption = expSelect?.options[expSelect.selectedIndex];
    this.currentServiceAvailabilityPending = selectedOption?.dataset?.unavailable === 'true';
    const expAvailWarning = document.getElementById('experienceAvailabilityWarning');
    if (expAvailWarning) {
      expAvailWarning.style.display = this.currentServiceAvailabilityPending ? '' : 'none';
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
        adultsQuantityField.value = experience.defaultAdults || '';
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

    // Build minimalist experience details card
    this.buildDetailsCard('experience', {
      title: experience.title || experience.name || '',
      description: experience.description || '',
      duration: experience.duration ? `${experience.duration} horas` : null,
      advanceBooking: experience.advance_booking_time ? this.formatMinutesToHoursAndMinutes(experience.advance_booking_time) : null,
      availabilitySchedule: this.extractAvailabilitySchedule(experience),
      languages: Array.isArray(experience.languages) ? experience.languages.join(', ') : experience.languages,
      includes: Array.isArray(experience.includes) ? experience.includes.join(', ') : experience.includes,
      notIncludes: Array.isArray(experience.notincludes) ? experience.notincludes.join(', ') : experience.notincludes,
      clientNotes: experience.client_booking_notes || '',
    });

    // Handle price fields - Precios
    const adultPriceField = document.getElementById('adultPrice');
    const childPriceField = document.getElementById('childPrice');
    const noAlcoholPriceField = document.getElementById('noAlcoholPrice');

    // Check if price override is enabled (admin only)
    const isPriceOverride = document.getElementById('experienceOverridePrices')?.checked || false;

    // Store calculated prices for potential restoration
    if (experience.price) {
      this.calculatedPrices.experience.adult = experience.price;
    }
    if (experience.price_child) {
      this.calculatedPrices.experience.child = experience.price_child;
    }
    if (experience.price_no_alcohol) {
      this.calculatedPrices.experience.noAlcohol = experience.price_no_alcohol;
    }

    // Only update prices if override is NOT enabled or if fields are empty
    if (!isPriceOverride || !this.canEditPrices) {
      if (adultPriceField && experience.price) {
        adultPriceField.value = experience.price;
      }

      if (childPriceField && experience.price_child) {
        childPriceField.value = experience.price_child;
      }

      if (noAlcoholPriceField && experience.price_no_alcohol) {
        noAlcoholPriceField.value = experience.price_no_alcohol;
      }
    } else {
      // If override is enabled and fields are empty, populate with calculated values as starting point
      if (adultPriceField && !adultPriceField.value && experience.price) {
        adultPriceField.value = experience.price;
      }
      if (childPriceField && !childPriceField.value && experience.price_child) {
        childPriceField.value = experience.price_child;
      }
      if (noAlcoholPriceField && !noAlcoholPriceField.value && experience.price_no_alcohol) {
        noAlcoholPriceField.value = experience.price_no_alcohol;
      }
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
    const scheduleInfoDiv = document.getElementById('experienceScheduleInfo');
    const suggestedTimesDiv = document.getElementById('experienceSuggestedTimes');

    // Hide suggested times initially
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const currentDayOfWeek = dayContext?.dayOfWeek;
    const suggestedTimes = [];

    // Collect all available time slots
    if (experience.startTime && experience.endTime) {
      suggestedTimes.push(`${this.formatTime(experience.startTime)} - ${this.formatTime(experience.endTime)}`);
    } else if (experience.availability && typeof experience.availability === 'object') {
      if (Array.isArray(experience.availability) && currentDayOfWeek !== null) {
        const timeOptions = this.extractTimeOptionsForDay(experience.availability, currentDayOfWeek);
        timeOptions.forEach((opt) => suggestedTimes.push(opt.label));
      } else if (experience.availability.times && Array.isArray(experience.availability.times)) {
        experience.availability.times.forEach((time) => suggestedTimes.push(time));
      }
    }

    // Show suggested times as read-only text
    if (suggestedTimes.length > 0 && scheduleInfoDiv && suggestedTimesDiv) {
      suggestedTimesDiv.textContent = suggestedTimes.join(' • ');
      scheduleInfoDiv.classList.remove('d-none');
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

      // For tours, guide is always included. The checkbox controls adding a chofer too.
      const guideLabel = guideField?.querySelector('.form-check-label[for="includeGuide"]');
      if (guideLabel) guideLabel.textContent = 'Guía + Chofer';

      // Hide quantity, show additional vehicle checkbox
      const quantityField = document.getElementById('serviceQuantity')?.closest('.col-md-6');
      quantityField?.classList.add('d-none');
      document.getElementById('serviceQuantity').value = 1;
      document.getElementById('additionalVehicleContainer')?.classList.remove('d-none');
      document.getElementById('additionalVehicleCheckbox').checked = false;

      // Show pricing fields
      if (standardPricingSection) {
        standardPricingSection.classList.remove('d-none');
      }

      // Show the tour vehicle override toggle for admin users
      if (this.canEditPrices) {
        document.getElementById('tourVehicleOverridePricesContainer')?.classList.remove('d-none');
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
          this.renderDaysContent();
        }
      }
    }
  }

  validateTourDuration() {
    const durationField = document.getElementById('tourDuration');
    const warningEl = document.getElementById('tourDurationWarning');
    if (!durationField || !warningEl) return;

    const selectedHours = parseFloat(durationField.value || 0);
    const defaultMinutes = this.currentTourData?.time || 0;
    const defaultHours = defaultMinutes / 60;

    if (selectedHours < defaultHours) {
      warningEl.classList.remove('d-none');
    } else {
      warningEl.classList.add('d-none');
    }
  }

  calculateTourEndTime() {
    const startTimeField = document.getElementById('tourStartTime');
    const durationField = document.getElementById('tourDuration');
    const endTimeField = document.getElementById('tourEndTime');

    if (!startTimeField || !durationField || !endTimeField) return;

    const startTime = startTimeField.value;
    const duration = parseFloat(durationField.value || 0);

    if (!startTime || !duration) return;

    // Parse start time (HH:MM format)
    const [hours, minutes] = startTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return;

    // Calculate end time
    const totalMinutes = (hours * 60) + minutes + (duration * 60);
    const endHours = Math.floor(totalMinutes / 60) % 24; // Handle day overflow
    const endMinutes = totalMinutes % 60;

    // Format as HH:MM
    const formattedEndTime = `${String(endHours).padStart(2, '0')}:${
      String(endMinutes).padStart(2, '0')}`;

    // Set the end time field
    endTimeField.value = formattedEndTime;
  }

  recalculateTourPrice() {
    // Skip if we're restoring a custom price
    if (this._restoringCustomPrice) {
      console.log('⏭️ Skipping price recalculation - restoring custom price');
      return;
    }

    // Get current tour data from form
    const adultsQuantity = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
    const childrenQuantity = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
    const adultsNoAlcoholQuantity = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value || 0);

    const adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
    const childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
    const noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);

    // console.log('👥 People quantities:', {adultsQuantity, childrenQuantity, adultsNoAlcoholQuantity});
    // console.log('💰 People prices:', {adultPrice, childPrice, noAlcoholPrice});

    // Get tour duration in hours
    const tourDuration = parseFloat(document.getElementById('tourDuration')?.value || 1);

    // Calculate people costs and multiply by duration
    const peopleTotal = ((adultsQuantity * adultPrice)
      + (childrenQuantity * childPrice)
      + (adultsNoAlcoholQuantity * noAlcoholPrice)) * tourDuration;

    // Start with people total for the overall price
    let totalPrice = peopleTotal;

    // console.log('👥 People total calculated:', peopleTotal);

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

    // Update the price field - ONLY if price override is not active
    // Check both DOM and service object for override state to handle timing issues
    const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
    const isOverrideChecked = tourOverrideCheckbox?.checked || false;
    const storedService = this.currentServiceId ? this.services.get(this.currentServiceId) : null;
    const hasStoredOverride = storedService?.priceOverride || false;
    const tourOverride = isOverrideChecked || hasStoredOverride;

    const servicePriceField = document.getElementById('servicePrice');

    console.log('🔒 Price protection check in recalculateTourPrice:', {
      tourOverride,
      isOverrideChecked,
      hasStoredOverride,
      currentServiceId: this.currentServiceId,
      storedService: storedService ? {
        priceOverride: storedService.priceOverride,
        customPrice: storedService.customPrice,
        price: storedService.price,
      } : null,
      currentFieldValue: servicePriceField?.value,
    });

    if (servicePriceField && !tourOverride) {
      // Only update price field when override is NOT checked
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
        this.lastValidTourPrice = vehicleOnlyCost.toFixed(2); // Store for readonly enforcement
        console.log('✅ Updated tour price field to vehicle cost:', vehicleOnlyCost.toFixed(2));
        // console.log('💰 Setting price field to vehicle cost only:', vehicleOnlyCost);
      } else {
        // No vehicle selected, show 0
        servicePriceField.value = '0.00';
        this.lastValidTourPrice = '0.00'; // Store for readonly enforcement
      }
    } else if (tourOverride && servicePriceField) {
      // Price override is enabled - preserve the custom price
      console.log('🛡️ Price field protected - override is enabled, preserving value:', servicePriceField.value);
      // If we're editing and have a stored custom price, ensure it's displayed
      if (storedService?.customPrice && servicePriceField.value !== storedService.customPrice.toString()) {
        console.log('📝 Restoring custom price from stored service:', storedService.customPrice);
        servicePriceField.value = storedService.customPrice.toFixed(2);
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
      this.updateWaitingTimeRateDisplay();
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
      // For transport, don't recalculate price (keep vehicle price only)
      // Just update the breakdown to show the surcharges
    }
    this.updateVehicleCapacityNote();
    this.updateServicePriceBreakdown();
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
      // For transport, don't recalculate price (keep vehicle price only)
      // Just update the breakdown to show the surcharges
    }
    this.updateVehicleCapacityNote();
    this.updateServicePriceBreakdown();
  }

  updateVehicleCapacityNote() {
    const noteEl = document.getElementById('vehicleCapacityNote');
    const noteTextEl = document.getElementById('vehicleCapacityNoteText');
    if (!noteEl || !noteTextEl) return;

    const serviceType = document.querySelector('input[name="serviceType"]:checked')?.value;
    const includeGuide = document.getElementById('includeGuide')?.checked;
    const includeGreeter = document.getElementById('includeGreeter')?.checked;
    const greeterInVehicle = document.getElementById('greeterInVehicle')?.checked;
    const tourRequiresTransport = document.getElementById('tourRequiresTransport')?.checked;
    const vehicleSelect = document.getElementById('vehicleSelect');
    const selectedVehicleId = vehicleSelect?.value;

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
    }

    if (seatsOccupied === 0) {
      noteEl.classList.add('d-none');
      return;
    }

    // Get vehicle capacity if a vehicle is selected
    let capacity = 0;
    if (selectedVehicleId) {
      if (this.transportPriceData?.vehicles) {
        const vehicle = this.transportPriceData.vehicles.find((v) => v.vehicleTypeId === selectedVehicleId);
        if (vehicle) capacity = vehicle.capacity || 0;
      }
      if (!capacity) {
        const vehicleInfo = this.getVehicleTypeInfo(selectedVehicleId);
        if (vehicleInfo) capacity = vehicleInfo.capacity || vehicleInfo.defaultCapacity || 0;
      }
    }

    if (capacity > 0) {
      const effectiveCapacity = capacity - seatsOccupied;
      noteTextEl.textContent = `${occupantLabel}. Capacidad disponible: ${effectiveCapacity} de ${capacity} pax`;
    } else {
      noteTextEl.textContent = `${occupantLabel} del vehículo`;
    }
    noteEl.classList.remove('d-none');
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
      this.updateWaitingTimeRateDisplay();
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
        capacityDisplay = `${pax} pax`;
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
   * @example
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

      // Check if price is overridden for transport
      const isTransportPriceOverride = document.getElementById('transportOverridePrices')?.checked || false;

      if (isTransportPriceOverride) {
        // Use the manual price as per-vehicle base price when override is checked
        const manualPrice = parseFloat(document.getElementById('servicePrice')?.value || 0);
        unitPrice = manualPrice; // Manual price is already the per-vehicle base price
      } else {
        // Use calculated price when override is not checked
        if (selectedVehicleId && this.transportPriceData?.vehicles) {
          unitPrice = this.getTransportVehiclePrice(selectedVehicleId) || 0;
        }
        if (unitPrice === 0) {
          unitPrice = this._lastTransportBasePrice || parseFloat(document.getElementById('servicePrice')?.value || 0);
        }
      }

      if (unitPrice > 0) {
        const displayUnit = this.getDisplayPrice(unitPrice);
        const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        const vehicleLabel = tripType === 'round-trip'
          ? `Vehículo Ida y Regreso (${quantity} × ${this.formatCurrency(displayUnit)})`
          : `Vehículo (${quantity} × ${this.formatCurrency(displayUnit)})`;
        items.push({ label: vehicleLabel, amountMXN: unitPrice * quantity });
      }

      // Add indicator if transport price is overridden
      if (isTransportPriceOverride && this.canEditPrices) {
        items.push({ label: '<span class="text-info"><i class="ti ti-edit"></i> Precio personalizado</span>', amountMXN: 0 });
      }

      const routeDuration = this.transportPriceData?.routeDuration || this.cachedRouteDuration || null;
      const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
      const brkLegMultiplier = tripType === 'round-trip' ? 2 : 1;
      const legSuffix = tripType === 'round-trip' ? ' (×2 Ida y Regreso)' : '';

      if (document.getElementById('includeGuide')?.checked && routeDuration) {
        const guideCost = this.calculateGuideTransportCost(routeDuration) * brkLegMultiplier;
        items.push({ label: `Guía + Chofer${legSuffix}`, amountMXN: guideCost });
      }
      if (document.getElementById('includeGreeter')?.checked && routeDuration) {
        const greeterCost = this.calculateGreeterPrice(routeDuration) * brkLegMultiplier;
        const baseGreeterCost = this.calculateGreeterPrice(routeDuration); // Cost before leg multiplier
        const formulaDisplay = this.formatGreeterFormula(routeDuration, baseGreeterCost);
        items.push({ label: `Greeter ${formulaDisplay}${legSuffix}`, amountMXN: greeterCost });
      }
      // Tiempo de espera
      const brkWaitingHours = parseFloat(document.getElementById('waitingTimeHours')?.value || 0);
      if (brkWaitingHours > 0) {
        const wtPrice = this.getWaitingTimePrice();
        if (wtPrice) {
          const wtCost = wtPrice.pricePerHour * brkWaitingHours * brkLegMultiplier;
          const displayHourly = this.getDisplayPrice(wtPrice.pricePerHour);
          items.push({ label: `Tiempo de espera (${brkWaitingHours}h × ${this.formatCurrency(displayHourly)})${legSuffix}`, amountMXN: wtCost });
        }
      }
    } else if (serviceType === 'tour') {
      // Check if it's a walking tour
      let isWalkingTourBreakdown = false;
      const tourSelectBreakdown = document.getElementById('tourSelect');
      if (tourSelectBreakdown?.value && this.toursCache.has('all')) {
        const walkingTourData = this.toursCache.get('all').find(
          (t) => (t.id === tourSelectBreakdown.value || t.objectId === tourSelectBreakdown.value) && t.isWalkingTour
        );
        if (walkingTourData) {
          isWalkingTourBreakdown = true;
          const peopleCount = parseInt(document.getElementById('walkingTourPeopleCount')?.value || 1, 10);
          const duration = parseFloat(document.getElementById('tourDuration')?.value || 1);

          // SIMPLIFIED: Walking tour price overrides are disabled, show only calculated price
          // Calculate and show basic tier breakdown
          const groups = this.calculateWalkingTourGroups(walkingTourData, peopleCount);
          const walkingPrice = this.getWalkingTourPrice(walkingTourData, peopleCount, duration);

          if (groups.length > 1) {
            // Multiple groups - show detailed breakdown with hours
            groups.forEach((group, index) => {
              // Calculate actual price for this group - let getDisplayPrice handle currency conversion
              let groupPrice = group.tier.price || 0;
              const priceCurrency = walkingTourData.walkingPriceCurrency || 'MXN';

              // If source price is in USD, convert to MXN for internal storage
              if (priceCurrency === 'USD' && this.exchangeRate) {
                groupPrice = Math.round(groupPrice * this.exchangeRate);
              }

              // Multiply by duration for final price
              const totalGroupPrice = groupPrice * duration;

              items.push({
                label: `Grupo ${index + 1} (${group.tier.label}) - ${group.count} personas × ${duration}h`,
                amountMXN: totalGroupPrice,
              });
            });
          } else {
            // Single group - show simple breakdown with hours
            items.push({ label: `Tour a Pie (${peopleCount} personas) × ${duration}h`, amountMXN: walkingPrice });
          }
        }
      }

      if (!isWalkingTourBreakdown) {
        const adultsQty = parseInt(document.getElementById('tourAdultsQuantity')?.value || 0);
        const childrenQty = parseInt(document.getElementById('tourChildrenQuantity')?.value || 0);
        const noAlcoholQty = parseInt(document.getElementById('tourAdultsNoAlcoholQuantity')?.value || 0);
        const adultPrice = parseFloat(document.getElementById('tourAdultPrice')?.value || 0);
        const childPrice = parseFloat(document.getElementById('tourChildPrice')?.value || 0);
        const noAlcoholPrice = parseFloat(document.getElementById('tourNoAlcoholPrice')?.value || 0);
        const tourDuration = parseFloat(document.getElementById('tourDuration')?.value || 1);

        // Check if prices are overridden for tours
        const isTourPriceOverride = document.getElementById('tourOverridePrices')?.checked || false;

        if (adultsQty > 0 && adultPrice > 0) {
          const displayUnit = this.getDisplayPrice(adultPrice);
          items.push({
            label: `Adultos (${adultsQty} × ${this.formatCurrency(displayUnit)} × ${tourDuration}h)`,
            amountMXN: adultsQty * adultPrice * tourDuration,
          });
        }
        if (childrenQty > 0 && childPrice > 0) {
          const displayUnit = this.getDisplayPrice(childPrice);
          items.push({
            label: `Niños (${childrenQty} × ${this.formatCurrency(displayUnit)} × ${tourDuration}h)`,
            amountMXN: childrenQty * childPrice * tourDuration,
          });
        }
        if (noAlcoholQty > 0 && noAlcoholPrice > 0) {
          const displayUnit = this.getDisplayPrice(noAlcoholPrice);
          items.push({
            label: `Sin alcohol (${noAlcoholQty} × ${this.formatCurrency(displayUnit)} × ${tourDuration}h)`,
            amountMXN: noAlcoholQty * noAlcoholPrice * tourDuration,
          });
        }

        // Add indicator if tour prices are overridden
        if (isTourPriceOverride && this.canEditPrices) {
          items.push({ label: '<span class="text-info"><i class="ti ti-edit"></i> Precios personalizados</span>', amountMXN: 0 });
        }

        // Vehicle cost (multiplied by duration)
        const vehicleSelect = document.getElementById('vehicleSelect');
        const vehicleQty = parseInt(document.getElementById('serviceQuantity')?.value || 1);
        if (vehicleSelect?.value) {
          const vehicleCost = parseFloat(document.getElementById('servicePrice')?.value || 0);
          if (vehicleCost > 0) {
            const displayUnit = this.getDisplayPrice(vehicleCost);
            items.push({
              label: `Vehículo (${vehicleQty} × ${this.formatCurrency(displayUnit)} × ${tourDuration}h)`,
              amountMXN: vehicleCost * vehicleQty * tourDuration,
            });
          }
        }

        // Driver tour rate (Guía + Chofer)
        if (document.getElementById('includeGuide')?.checked && this.driverTourRateCache) {
          const driverRate = this.driverTourRateCache.value || 0;
          if (driverRate > 0) {
            items.push({ label: 'Guía + Chofer', amountMXN: driverRate });
          }
        }
      } // end if (!isWalkingTourBreakdown)
    } else if (serviceType === 'experience') {
      const adultsQty = parseInt(document.getElementById('adultsQuantity')?.value || 0);
      const childrenQty = parseInt(document.getElementById('childrenQuantity')?.value || 0);
      const noAlcoholQty = parseInt(document.getElementById('adultsNoAlcoholQuantity')?.value || 0);
      const adultPrice = parseFloat(document.getElementById('adultPrice')?.value || 0);
      const childPrice = parseFloat(document.getElementById('childPrice')?.value || 0);
      const noAlcoholPrice = parseFloat(document.getElementById('noAlcoholPrice')?.value || 0);

      // Check if prices are overridden
      const isPriceOverride = document.getElementById('experienceOverridePrices')?.checked || false;

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

      // Add indicator if prices are overridden
      if (isPriceOverride && this.canEditPrices) {
        items.push({ label: '<span class="text-info"><i class="ti ti-edit"></i> Precios personalizados</span>', amountMXN: 0 });
      }
    } else if (serviceType === 'a-disposicion') {
      // Check if price is overridden for a disposición
      const isADisposicionPriceOverride = document.getElementById('aDisposicionOverridePrices')?.checked || false;

      if (isADisposicionPriceOverride) {
        // Use the manual price as HOURLY RATE when override is checked
        const hourlyRate = parseFloat(document.getElementById('servicePrice')?.value || 0);
        const hours = parseFloat(document.getElementById('aDisposicionHours')?.value || 0);
        const vehicleCount = parseInt(document.getElementById('aDisposicionVehicleCount')?.value || 1, 10);

        if (hourlyRate > 0 && hours > 0) {
          const displayHourlyRate = this.getDisplayPrice(hourlyRate);
          const baseCost = hourlyRate * hours * vehicleCount;
          const discount = this.getADisposicionDiscount(hours);

          // Show detailed breakdown with hourly rate calculation
          if (vehicleCount > 1) {
            items.push({ label: `${hours}h × ${vehicleCount} vehículos × ${this.formatCurrency(displayHourlyRate)}`, amountMXN: baseCost });
          } else {
            items.push({ label: `${hours}h × ${this.formatCurrency(displayHourlyRate)}`, amountMXN: baseCost });
          }

          // Add discount if applicable
          if (discount > 0) {
            const discountAmount = baseCost * (discount / 100);
            items.push({ label: `Descuento por volumen (-${discount}%)`, amountMXN: -discountAmount });
          }
        } else if (hourlyRate > 0) {
          // Fallback if no hours specified
          items.push({ label: 'Tarifa personalizada por hora', amountMXN: hourlyRate });
        }

        // Add indicator for manual price
        if (hourlyRate > 0 && this.canEditPrices) {
          items.push({ label: '<span class="text-info"><i class="ti ti-edit"></i> Precio personalizado</span>', amountMXN: 0 });
        }
      } else {
        // Use calculated pricing when override is not checked
        const hourlyRate = this._disposicionHourlyRate || 0;
        const hours = parseFloat(document.getElementById('aDisposicionHours')?.value || 0);
        const vehicleCount = parseInt(document.getElementById('aDisposicionVehicleCount')?.value || 1, 10);
        const discount = this.getADisposicionDiscount(hours);

        if (hourlyRate > 0 && hours > 0) {
          const displayHourly = this.getDisplayPrice(hourlyRate);
          items.push({ label: `Tarifa por hora (${this.formatCurrency(displayHourly)})`, amountMXN: hourlyRate });

          const baseCost = hourlyRate * hours * vehicleCount;
          if (vehicleCount > 1) {
            items.push({ label: `${hours}h × ${vehicleCount} vehículos`, amountMXN: baseCost });
          } else {
            items.push({ label: `${hours} horas`, amountMXN: baseCost });
          }

          if (discount > 0) {
            const discountAmount = baseCost * (discount / 100);
            items.push({ label: `Descuento por volumen (-${discount}%)`, amountMXN: -discountAmount });
          }
        }
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

    // Get payment type
    const paymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';

    // Render all service-specific breakdown items first
    let itemsHTML = items.map((item) => {
      const displayAmt = this.getDisplayPrice(item.amountMXN);
      return `<div class="d-flex justify-content-between">
        <span class="text-muted">${item.label}</span>
        <span>${this.formatCurrency(displayAmt)}</span>
      </div>`;
    }).join('');

    // Calculate display total with payment surcharges
    const displayTotal = this.getDisplayPrice(totalMXN);

    // Add IVA section if payment type is not efectivo
    if (paymentType !== 'efectivo') {
      // Since getDisplayPrice already applies surcharges and IVA is included
      // We need to extract and show the IVA portion
      const baseAmount = displayTotal / 1.16;
      const ivaAmount = displayTotal - baseAmount;
      
      // Add separator and IVA section
      itemsHTML += `
        <hr class="my-1">
        <div class="d-flex justify-content-between">
          <span class="text-muted">Subtotal</span>
          <span>${this.formatCurrency(baseAmount)}</span>
        </div>
        <div class="d-flex justify-content-between">
          <span class="text-muted">IVA (16%)</span>
          <span>${this.formatCurrency(ivaAmount)}</span>
        </div>`;
    }

    // Render the complete breakdown
    itemsDiv.innerHTML = itemsHTML;

    // Show final total
    totalSpan.textContent = this.formatCurrency(displayTotal);
    container.classList.remove('d-none');

    // Update price label when conversion is active
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    // paymentType already declared above at line 8354
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
   * @param rateId
   * @param fallbackOrigin
   * @param fallbackDestination
   * @example
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
    const tripType = document.querySelector('input[name="tripType"]:checked')?.value;

    let originName = '';
    let destinationName = '';

    if (tripType === 'round-trip') {
      // Round trip: read from Ida fields (arrival leg)
      if (transportType === 'local') {
        // Local: Ida origin = TEXT, Ida destination = SELECT
        originName = document.getElementById('roundTripOriginIdaText')?.value || '';
        const destSelect = document.getElementById('roundTripDestinationIdaSelect');
        const destSlug = destSelect?.value;
        destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      } else {
        // Aeropuerto / Punto a Punto: Ida origin = SELECT (slug), Ida destination = SELECT (slug)
        const originSelect = document.getElementById('roundTripOriginIdaSelect');
        const originSlug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(originSlug) || originSlug || '';
        const destSelect = document.getElementById('roundTripDestinationIdaSelect');
        const destSlug = destSelect?.value;
        destinationName = window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      }
    } else {
      // One-way: read from one-way fields based on direction
      const isDepartureWithSelect = direction === 'departure' && (transportType === 'aeropuerto' || transportType === 'punto-a-punto');

      // Helper to resolve destination SELECT display name
      const resolveDestSelect = () => {
        const destSelect = document.getElementById('transportDestinationSelect');
        const destSlug = destSelect?.value;
        return window.slugToOriginalMapping?.get(destSlug) || destSlug || '';
      };

      const isLocalIda = direction === 'arrival' && transportType === 'local';

      if (isLocalIda) {
        // Local Ida: origin TEXT, destination SELECT
        originName = document.getElementById('transportOriginText')?.value || '';
        destinationName = resolveDestSelect();
      } else if (direction === 'departure' && transportType === 'local') {
        // Local Vuelta: origin SELECT, destination TEXT
        const originSelect = document.getElementById('transportOriginSelect');
        const slug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(slug) || slug || '';
        destinationName = document.getElementById('transportDestinationText')?.value || '';
      } else if (direction === 'departure') {
        // Departure: origin SELECT (city), destination SELECT (airport)
        const originSelect = document.getElementById('transportOriginSelect');
        const originSlug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(originSlug) || originSlug || '';
        destinationName = resolveDestSelect();
      } else {
        // Arrival: origin SELECT (airport), destination SELECT (city)
        const originSelect = document.getElementById('transportOriginSelect');
        const originSlug = originSelect?.value;
        originName = window.slugToOriginalMapping?.get(originSlug) || originSlug || '';
        destinationName = resolveDestSelect();
      }
    }

    // Use fallbacks from service data if form fields are empty (edit race condition)
    if (!originName && fallbackOrigin) originName = fallbackOrigin;
    if (!destinationName && fallbackDestination) destinationName = fallbackDestination;

    if (!originName || !destinationName) {
      this.clearVehicleDropdown();
      this.transportPriceData = null;
      return;
    }

    // For one-way departure: swap origin/destination for API query
    // DB stores routes as origin→destination, but user selected in reverse for departure
    // Round trip uses Ida (arrival) data which is already in DB order
    let apiOrigin = originName;
    let apiDestination = destinationName;

    // Debug logging for price investigation
    console.log('🔍 Transport Route Price Lookup:', {
      userSelection: {
        direction,
        tripType,
        originName,
        destinationName,
        rateId,
      },
    });

    if (tripType !== 'round-trip' && direction === 'departure') {
      apiOrigin = destinationName;
      apiDestination = originName;
      console.log('🔄 Swapped for departure:', { apiOrigin, apiDestination });
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

      // Debug logging for price investigation
      console.log('📦 API Response - Transport Prices:', {
        apiRequest: { apiOrigin, apiDestination, rateId },
        vehiclesReturned: result.data.vehicles?.length || 0,
        vehicles: result.data.vehicles?.map((v) => ({
          type: v.vehicleType,
          basePrice: v.basePrice,
          clientPrice: v.clientPrice,
          finalPrice: v.finalPrice,
          isClientPrice: v.isClientPrice,
        })),
      });

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
   * @param vehicles
   * @example
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
   * @param vehicleTypeId
   * @example
   */
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
        isClientPrice: vehicle.isClientPrice,
      } : 'NOT FOUND',
    });

    return vehicle ? vehicle.finalPrice : null;
  }

  /**
   * Calculate guide cost for transport using configurable formula.
   * Uses the generic GuideFormulaEvaluator if available, otherwise falls back to simple formula.
   * @param {number} durationMinutes - Route duration in minutes.
   * @returns {number} Guide cost.
   * @example
   */
  calculateGuideTransportCost(durationMinutes) {
    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return 0;

    // Get current rate
    const guideRate = this.guideTransportRateCache?.value || 400;

    // Try to use the generic formula evaluator if available
    if (typeof GuideFormulaEvaluator !== 'undefined' && GuideFormulaEvaluator.formulaConfig) {
      const config = GuideFormulaEvaluator.formulaConfig;

      // Use advanced formula components if available
      if (config.formulaComponents && config.formulaComponents.length > 0) {
        const calculatedCost = GuideFormulaEvaluator.evaluateComponents(config.formulaComponents, durationMinutes, guideRate);
        const minimumCharge = config.minimumCharge || 0;
        const finalCost = Math.max(calculatedCost, minimumCharge);
        console.log(`📊 [Quote] Using custom formula: ${durationMinutes}min @ $${guideRate}/hr = $${finalCost} (components: ${config.formulaComponents.length})`);
        return finalCost;
      }
      // Otherwise use multiplier formula
      if (config.roundTripMultiplier) {
        const calculatedCost = durationHours * config.roundTripMultiplier * guideRate;
        const minimumCharge = config.minimumCharge || 0;
        const finalCost = Math.max(calculatedCost, minimumCharge);
        console.log(`📊 [Quote] Using simple formula: ${durationHours}h × ${config.roundTripMultiplier} × $${guideRate} = $${finalCost}`);
        return finalCost;
      }
    }

    // Fallback to cached formula config or default
    const formulaConfig = this.guideFormulaConfigCache || {
      roundTripMultiplier: 2,
      minimumCharge: 0,
    };

    // Apply the configurable formula
    const calculatedCost = durationHours * formulaConfig.roundTripMultiplier * guideRate;

    // Apply minimum charge if configured
    const finalCost = Math.max(calculatedCost, formulaConfig.minimumCharge);
    console.log(`⚠️ [Quote] Using fallback formula: ${durationHours}h × ${formulaConfig.roundTripMultiplier} × $${guideRate} = $${finalCost}`);
    return finalCost;
  }

  /**
   * Calculate greeter price based on route duration.
   * Formula: 760 + (640 * durationHours) with special rounding.
   * @param {number} durationMinutes - Route duration in minutes.
   * @returns {number} Greeter price.
   * @example
   */
  // Apply special rounding logic to final service totals when greeter is included
  // Same logic as used in original greeter calculation: if last two digits < 50, round down to nearest 100; otherwise round up
  applySpecialRounding(rawPrice) {
    const integerPart = Math.floor(rawPrice);
    const lastTwoDigits = integerPart % 100;
    
    if (lastTwoDigits === 0) {
      return integerPart;
    } else if (lastTwoDigits < 50) {
      return Math.floor(integerPart / 100) * 100;
    } else {
      return Math.ceil(integerPart / 100) * 100;
    }
  }

  calculateGreeterPrice(durationMinutes) {
    // Trigger cache loading if not available
    if (!this.greeterRateCache) {
      console.log('⚡ Greeter cache missing, triggering immediate load');
      // Trigger async load but don't wait for it - use defaults for now
      this.loadGreeterRateConfiguration().catch(error => {
        console.error('Failed to load greeter config in background:', error);
      });
    }
    
    // Use cached values or fallback to defaults
    const basePrice = this.greeterRateCache?.basePrice || 760;
    const hourlyRate = this.greeterRateCache?.hourlyRate || 640;
    
    // Debug: Log what values are being used
    console.log('🔍 calculateGreeterPrice DEBUG:', {
      durationMinutes,
      greeterRateCache: this.greeterRateCache,
      basePrice,
      hourlyRate,
      cacheTime: this.greeterRateCacheTime,
      isUsingCache: !!this.greeterRateCache,
      isUsingDefaults: !this.greeterRateCache
    });

    const durationHours = durationMinutes / 60;
    if (!durationHours || durationHours <= 0) return basePrice;

    // Calculate final price using configurable formula (no special rounding here)
    // Note: Special rounding now applied to final service total, not individual greeter calculation
    const finalPrice = basePrice + (hourlyRate * durationHours);
    
    console.log('💰 calculateGreeterPrice RESULT (unrounded):', {
      finalPrice,
      formula: `${basePrice} + (${hourlyRate} × ${durationHours.toFixed(2)}h) = ${finalPrice}`
    });

    return finalPrice;
  }

  /**
   * Load vehicle rate prices (Tiempo de espera hourly rates).
   * @example
   */
  async loadVehicleRatePrices() {
    try {
      const accessToken = this.getAccessToken();
      if (!accessToken) return;

      const response = await fetch('/api/vehicle-rate-prices/all', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.prices) {
          this.vehicleRatePricesCache = data.result.prices;
          console.log(`[VehicleRatePrices] Loaded ${this.vehicleRatePricesCache.length} prices`);
        }
      }
    } catch (error) {
      console.warn('[VehicleRatePrices] Failed to load:', error);
    }
  }

  /**
   * Look up waiting time hourly price for current vehicle + rate selection.
   * @returns {{ pricePerHour: number, currency: string }|null}
   * @example
   */
  getWaitingTimePrice() {
    const vehicleTypeId = document.getElementById('vehicleSelect')?.value;
    const rateId = document.getElementById('transportCategory')?.value;
    if (!vehicleTypeId || !rateId || !this.vehicleRatePricesCache.length) return null;

    const match = this.vehicleRatePricesCache.find(
      (p) => p.vehicleTypeId === vehicleTypeId && p.rateId === rateId
    );
    return match ? { pricePerHour: match.pricePerHour, currency: match.currency || 'MXN' } : null;
  }

  /**
   * Update the waiting time rate display label.
   * @example
   */
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

  /**
   * Recalculate transport price including vehicle base + Guía/Greeter surcharges.
   * @example
   */
  recalculateTransportPrice() {
    // Refresh greeter cache in case rates were updated recently
    this.refreshGreeterRateCache().catch(error => {
      console.warn('Could not refresh greeter cache during transport recalculation:', error);
    });

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
    const vehiclePrice = basePrice * quantity;

    // For the price field, we only show the vehicle price (client or base)
    // Surcharges are calculated for the breakdown but not added to the field
    console.log('🔧 Vehicle price (for field):', vehiclePrice);
    this.updatePriceField(vehiclePrice);

    // Update breakdown after transport price recalculation
    this.updateServicePriceBreakdown();
  }

  // =====================
  // A Disposición Methods
  // =====================

  /**
   * Populate the A Disposición rate dropdown with active rates.
   * @example
   */
  async populateADisposicionRates() {
    const rateSelect = document.getElementById('aDisposicionRate');
    if (!rateSelect) return;

    // Use cached rates if available, otherwise fetch
    if (!this.ratesCache || this.ratesCache.length === 0) {
      await this.loadAllRates();
    }

    rateSelect.innerHTML = '<option value="">-- Seleccionar segmento --</option>';
    (this.ratesCache || []).forEach((rate) => {
      const label = rate.label || rate.name;

      // Filter out "Económico" for A Disposición (same as admin page)
      if (label) {
        const normalizedLabel = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalizedLabel === 'economico' || normalizedLabel === 'economica') {
          return;
        }
      }

      const percentage = rate.formattedPercentage || (rate.percentage ? `${rate.percentage}%` : '');
      const displayText = percentage ? `${label} (${percentage})` : label;

      const option = document.createElement('option');
      option.value = rate.value || rate.objectId || rate.id;
      option.textContent = displayText;
      rateSelect.appendChild(option);
    });
  }

  /**
   * Handle A Disposición rate change — load available vehicles.
   * @param rateId
   * @example
   */
  async handleADisposicionRateChange(rateId) {
    const vehicleSelect = document.getElementById('aDisposicionVehicle');
    if (!vehicleSelect) return;

    // Reset vehicle and price
    vehicleSelect.innerHTML = '<option value="">-- Seleccionar vehículo --</option>';
    this._disposicionHourlyRate = null;
    this._disposicionPriceCacheKey = null;
    document.getElementById('servicePrice').value = '';
    document.getElementById('aDisposicionDiscountInfo').textContent = '';

    if (!rateId) return;

    try {
      const accessToken = this.getAccessToken();
      const response = await fetch(`/api/disposable-prices/vehicles-for-rate?rateId=${rateId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        const vehicles = result.data || [];

        vehicles.forEach((vehicle) => {
          const option = document.createElement('option');
          option.value = vehicle.value || vehicle.id;
          option.textContent = `${vehicle.label} - ${vehicle.capacity} pax`;
          vehicleSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading vehicles for A Disposición:', error);
    }
  }

  /**
   * Calculate A Disposición price based on rate, vehicle, hours, and vehicle count.
   * @example
   */
  async calculateADisposicionPrice() {
    const rateId = document.getElementById('aDisposicionRate')?.value;
    const vehicleTypeId = document.getElementById('aDisposicionVehicle')?.value;
    const hours = parseFloat(document.getElementById('aDisposicionHours')?.value || 0);
    const vehicleCount = parseInt(document.getElementById('aDisposicionVehicleCount')?.value || 1, 10);
    const priceField = document.getElementById('servicePrice');
    const discountInfo = document.getElementById('aDisposicionDiscountInfo');

    if (!rateId || !vehicleTypeId || hours <= 0) {
      if (priceField) priceField.value = '';
      if (discountInfo) discountInfo.textContent = '';
      return;
    }

    try {
      // Fetch hourly rate if not cached for this combination
      const cacheKey = `${vehicleTypeId}_${rateId}`;
      if (this._disposicionPriceCacheKey !== cacheKey) {
        const accessToken = this.getAccessToken();
        const response = await fetch(`/api/disposable-prices/price?vehicleTypeId=${vehicleTypeId}&rateId=${rateId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) return;
        const result = await response.json();
        const priceData = result.data || {};
        this._disposicionHourlyRate = priceData.hourlyPrice || 0;
        this._disposicionCurrency = priceData.currency || 'MXN';
        this._disposicionPriceCacheKey = cacheKey;
      }

      const discount = this.getADisposicionDiscount(hours);
      const basePrice = this._disposicionHourlyRate;

      // Only update price field if price override is not active
      const isOverrideActive = document.getElementById('aDisposicionOverridePrices')?.checked || false;
      if (priceField && !isOverrideActive) {
        priceField.value = basePrice;
      }

      // Set currency to match
      const currencySelect = document.getElementById('currencySelect');
      if (currencySelect) currencySelect.value = this._disposicionCurrency;

      // Show discount info
      if (discountInfo) {
        discountInfo.textContent = discount > 0
          ? `Descuento por volumen: -${discount}%`
          : '';
      }

      this.updateServicePriceBreakdown();
    } catch (error) {
      console.error('Error calculating A Disposición price:', error);
    }
  }

  /**
   * Get volume discount percentage based on hours.
   * @param hours
   * @example
   */
  getADisposicionDiscount(hours) {
    if (hours >= 16) return 10;
    if (hours >= 12) return 7.5;
    if (hours >= 10) return 5;
    if (hours >= 8) return 2.5;
    return 0;
  }

  // =====================
  // Walking Tour Methods
  // =====================

  /**
   * Handle walking tour selection — show tier pricing, hide vehicle fields.
   * @param tour
   * @example
   */
  handleWalkingTourSelection(tour) {
    // Hide transport checkbox (walking tours don't need vehicles)
    const tourTransportCheckbox = document.getElementById('tourTransportCheckboxContainer');
    if (tourTransportCheckbox) tourTransportCheckbox.style.display = 'none';

    // Populate tier cards
    document.getElementById('walkingRangeSmallLabel').textContent = tour.walkingRangeSmall || '—';
    document.getElementById('walkingRangeMediumLabel').textContent = tour.walkingRangeMedium || '—';
    document.getElementById('walkingRangeLargeLabel').textContent = tour.walkingRangeLarge || '—';

    const currency = tour.walkingPriceCurrency || 'MXN';
    document.getElementById('walkingPriceSmallLabel').textContent = `$${parseFloat(tour.walkingPriceSmall || 0).toLocaleString()} ${currency}`;
    document.getElementById('walkingPriceMediumLabel').textContent = `$${parseFloat(tour.walkingPriceMedium || 0).toLocaleString()} ${currency}`;
    document.getElementById('walkingPriceLargeLabel').textContent = `$${parseFloat(tour.walkingPriceLarge || 0).toLocaleString()} ${currency}`;
    document.getElementById('walkingTourCurrency').value = currency;

    // Store tour data for tier re-highlight on quantity change
    this.currentTourData = tour;

    // Pre-fill individual person counts from quote data (but only for NEW walking tours, not when editing)
    const adultsField = document.getElementById('walkingTourAdultsQuantity');
    const childrenField = document.getElementById('walkingTourChildrenQuantity');
    const infantsField = document.getElementById('walkingTourInfantsQuantity');
    const peopleCountField = document.getElementById('walkingTourPeopleCount');

    if (this.quoteData && !this.currentServiceId) {
      console.log('🔄 Prefilling walking tour from information step (NEW tour)');
      const numberOfAdults = this.quoteData.numberOfAdults || 0;
      const numberOfChildren = this.quoteData.numberOfChildren || 0;
      const numberOfInfants = this.quoteData.numberOfInfants || 0;
      const totalPeople = numberOfAdults + numberOfChildren + numberOfInfants;

      if (adultsField) adultsField.value = numberOfAdults;
      if (childrenField) childrenField.value = numberOfChildren;
      if (infantsField) infantsField.value = numberOfInfants;
      if (peopleCountField) peopleCountField.value = totalPeople || 1;
    } else if (this.currentServiceId) {
      console.log(`🚫 Skipping walking tour prefill during edit (currentServiceId: ${this.currentServiceId})`);
    }

    // Highlight matching tier
    console.log('🔍 BEFORE highlightWalkingTourTier - checking if service object exists');
    if (this.currentServiceId && this.services.has(this.currentServiceId)) {
      const currentService = this.services.get(this.currentServiceId);
      console.log('🔍 Service in Map BEFORE highlightWalkingTourTier:', {
        adultsQuantity: currentService.adultsQuantity,
        childrenQuantity: currentService.childrenQuantity,
        infantsQuantity: currentService.infantsQuantity,
      });
    }

    this.highlightWalkingTourTier(tour);

    console.log('🔍 AFTER highlightWalkingTourTier - checking service object again');
    if (this.currentServiceId && this.services.has(this.currentServiceId)) {
      const currentService = this.services.get(this.currentServiceId);
      console.log('🔍 Service in Map AFTER highlightWalkingTourTier:', {
        adultsQuantity: currentService.adultsQuantity,
        childrenQuantity: currentService.childrenQuantity,
        infantsQuantity: currentService.infantsQuantity,
      });
    }

    // Set default duration from tour.time (minutes to hours)
    const durationField = document.getElementById('tourDuration');
    if (durationField && tour.time) {
      const defaultHours = Math.ceil(tour.time / 60); // Round up to nearest hour
      durationField.value = defaultHours;
    }
    // Store current tour data for validation
    this.currentTourData = tour;

    // Build minimalist tour details card
    const tourDuration = tour.time ? this.formatMinutesToHoursAndMinutes(parseInt(tour.time, 10)) : null;
    const bookingTime = tour.advance_booking_time;
    this.buildDetailsCard('tour', {
      title: tour.destinationPOI?.name || tour.name || '',
      description: tour.description || '',
      duration: tourDuration,
      durationLabel: 'Mínimo de horas',
      advanceBooking: bookingTime ? this.formatMinutesToHoursAndMinutes(parseInt(bookingTime, 10)) : null,
      availabilitySchedule: this.extractAvailabilitySchedule(tour),
      languages: (tour.languages || []).join(', ') || null,
      includes: Array.isArray(tour.includes) ? tour.includes.join(', ') : tour.includes,
      notIncludes: Array.isArray(tour.notincludes) ? tour.notincludes.join(', ') : tour.notincludes,
      clientNotes: tour.client_booking_notes || '',
    });
    this.handleTourSchedule(tour);
    this.updateServicePriceBreakdown();
  }

  /**
   * Parse walking tour range string like "1-5 pax" or "15+".
   * @param rangeStr
   * @example
   */
  parseWalkingTourRange(rangeStr) {
    if (!rangeStr) return null;
    const trimmed = rangeStr.trim();
    const plusMatch = trimmed.match(/^(\d+)\+/);
    if (plusMatch) return { min: parseInt(plusMatch[1], 10), max: Infinity };
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
    return null;
  }

  /**
   * Highlight the matching walking tour tier based on people count.
   * @param tour
   * @example
   */
  highlightWalkingTourTier(tour) {
    const peopleCount = parseInt(document.getElementById('walkingTourPeopleCount')?.value || 0, 10);

    const tierCards = {
      Small: document.getElementById('walkingTierSmall'),
      Medium: document.getElementById('walkingTierMedium'),
      Large: document.getElementById('walkingTierLarge'),
    };

    // Remove all highlights
    Object.values(tierCards).forEach((card) => {
      if (card) {
        card.style.border = '';
        card.style.backgroundColor = '';
      }
    });

    const breakdownDiv = document.getElementById('walkingTourGroupBreakdown');
    const breakdownContent = document.getElementById('walkingTourGroupBreakdownContent');
    if (breakdownDiv) breakdownDiv.classList.add('d-none');

    if (peopleCount <= 0) return;

    const groups = this.calculateWalkingTourGroups(tour, peopleCount);
    const priceCurrency = tour.walkingPriceCurrency || 'MXN';

    // Highlight all used tiers
    const usedTiers = new Set();
    groups.forEach((g) => usedTiers.add(g.tier.name));
    usedTiers.forEach((name) => {
      const card = tierCards[name];
      if (card) {
        card.style.border = '2px solid #0d6efd';
        card.style.backgroundColor = '#e7f1ff';
      }
    });

    // Show breakdown if multiple groups
    if (groups.length > 1 && breakdownDiv && breakdownContent) {
      let total = 0;
      const lines = groups.map((g, i) => {
        let { price } = g.tier;
        // If source price is in USD, convert to MXN for internal storage
        if (priceCurrency === 'USD' && this.exchangeRate) {
          price = Math.round(price * this.exchangeRate);
        }
        total += price;
        // Use getDisplayPrice for proper currency display with payment surcharges
        const displayPrice = this.getDisplayPrice(price);
        return `<div class="d-flex justify-content-between"><span>Grupo ${i + 1}: ${g.tier.label} pax</span><span class="fw-bold">${this.formatCurrency(displayPrice)}</span></div>`;
      }).join('');

      // Use getDisplayPrice for total as well
      const displayTotal = this.getDisplayPrice(total);
      breakdownContent.innerHTML = `
        <div class="small fw-bold mb-1"><i class="ti ti-users me-1"></i>${peopleCount} personas total</div>
        ${lines}
        <hr class="my-1">
        <div class="d-flex justify-content-between fw-bold"><span>Total</span><span>${this.formatCurrency(displayTotal)}</span></div>
      `;
      breakdownDiv.classList.remove('d-none');
    }

    // Set service price using getWalkingTourPrice (normalizes to MXN)
    const servicePriceField = document.getElementById('servicePrice');
    if (servicePriceField) {
      const duration = parseFloat(document.getElementById('tourDuration')?.value || 1);
      const mxnPrice = this.getWalkingTourPrice(tour, peopleCount, duration);
      servicePriceField.value = mxnPrice;
    }
  }

  /**
   * Get walking tour price for a given people count, normalized to MXN.
   * @param tour
   * @param peopleCount
   * @example
   */
  calculateWalkingTourGroups(tour, peopleCount) {
    const tiers = [
      {
        name: 'Small', label: tour.walkingRangeSmall, range: this.parseWalkingTourRange(tour.walkingRangeSmall), price: parseFloat(tour.walkingPriceSmall || 0),
      },
      {
        name: 'Medium', label: tour.walkingRangeMedium, range: this.parseWalkingTourRange(tour.walkingRangeMedium), price: parseFloat(tour.walkingPriceMedium || 0),
      },
      {
        name: 'Large', label: tour.walkingRangeLarge, range: this.parseWalkingTourRange(tour.walkingRangeLarge), price: parseFloat(tour.walkingPriceLarge || 0),
      },
    ].filter((t) => t.range);

    // Sort tiers by max capacity descending
    const sortedTiers = [...tiers].sort((a, b) => (b.range.max === Infinity ? 999 : b.range.max) - (a.range.max === Infinity ? 999 : a.range.max));

    const groups = [];
    let remaining = peopleCount;

    while (remaining > 0) {
      // Find the largest tier that fits
      let bestTier = null;
      for (const tier of sortedTiers) {
        if (remaining >= tier.range.min) {
          bestTier = tier;
          break;
        }
      }
      if (!bestTier) {
        // Remaining is less than smallest tier min — use smallest tier
        bestTier = sortedTiers[sortedTiers.length - 1];
      }
      const allocated = Math.min(remaining, bestTier.range.max === Infinity ? remaining : bestTier.range.max);
      groups.push({ tier: bestTier, count: allocated });
      remaining -= allocated;
    }

    return groups;
  }

  getWalkingTourPrice(tour, peopleCount, duration = 1) {
    const groups = this.calculateWalkingTourGroups(tour, peopleCount);
    const priceCurrency = tour.walkingPriceCurrency || 'MXN';

    let total = 0;
    for (const group of groups) {
      let { price } = group.tier;
      // If source price is in USD, convert to MXN for internal storage
      if (priceCurrency === 'USD' && this.exchangeRate) {
        price = Math.round(price * this.exchangeRate);
      }
      // Multiply group price by duration (hours)
      total += price * duration;
    }

    // Store the calculated price for use in override
    this.currentWalkingTourPrice = total;

    return total;
  }

  // Update walking tour pricing (recalculate tier prices)
  updateWalkingTourPricing() {
    const tourSelect = document.getElementById('tourSelect');
    const selectedTourId = tourSelect?.value;

    if (selectedTourId && this.toursCache.has('all')) {
      const tours = this.toursCache.get('all');
      const selectedTour = tours.find((tour) => tour.id === selectedTourId || tour.objectId === selectedTourId);

      if (selectedTour?.isWalkingTour) {
        this.highlightWalkingTourTier(selectedTour);
        this.updateServicePriceBreakdown();
      }
    }
  }

  handleTourSelection(tourId) {
    if (!tourId) {
      // Reset both pricing sections to default
      const vehiclePricingSection = document.getElementById('vehicleTourPricingSection');
      const walkingPricingSection = document.getElementById('walkingTourPricingSection');
      if (vehiclePricingSection) vehiclePricingSection.classList.remove('d-none');
      if (walkingPricingSection) walkingPricingSection.classList.add('d-none');

      // Reset transport checkbox to normal state when no tour is selected
      const tourRequiresTransport = document.getElementById('tourRequiresTransport');
      const tourTransportContainer = document.getElementById('tourTransportCheckboxContainer');
      if (tourRequiresTransport && tourTransportContainer) {
        tourRequiresTransport.checked = false;
        tourRequiresTransport.disabled = false;
        tourTransportContainer.style.display = 'block';
        this.handleTourTransportToggle(false); // Hide transport fields
      }

      // Show standard pricing section when no tour is selected
      const standardPricingSection = document.getElementById('standardPricingSection');
      if (standardPricingSection) {
        standardPricingSection.classList.remove('d-none');
      }

      // Hide tour override toggles when no tour is selected
      if (this.canEditPrices) {
        document.getElementById('tourOverridePricesContainer')?.classList.add('d-none');
        document.getElementById('tourVehicleOverridePricesContainer')?.classList.add('d-none');
      }

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
      this.currentServiceAvailabilityPending = false;
      return;
    }

    // Check if selected option is marked as unavailable
    const tourSelect = document.getElementById('tourSelect');
    const selectedTourOption = tourSelect?.options[tourSelect.selectedIndex];
    this.currentServiceAvailabilityPending = selectedTourOption?.dataset?.unavailable === 'true';
    const tourAvailWarning = document.getElementById('tourAvailabilityWarning');
    if (tourAvailWarning) {
      tourAvailWarning.style.display = this.currentServiceAvailabilityPending ? '' : 'none';
    }

    try {
      // Find the selected tour from cache
      let selectedTour = null;

      if (this.toursCache.has('all')) {
        const tours = this.toursCache.get('all');
        selectedTour = tours.find((tour) => tour.id === tourId || tour.objectId === tourId);
      }

      if (selectedTour) {
        // Reset pricing sections
        const vehiclePricingSection = document.getElementById('vehicleTourPricingSection');
        const walkingPricingSection = document.getElementById('walkingTourPricingSection');

        // Walking tour: use tier-based pricing
        if (selectedTour.isWalkingTour) {
          if (vehiclePricingSection) vehiclePricingSection.classList.add('d-none');
          if (walkingPricingSection) walkingPricingSection.classList.remove('d-none');

          // Hide the tour person prices override toggle for walking tours (DISABLED FOR NOW)
          if (this.canEditPrices) {
            document.getElementById('tourOverridePricesContainer')?.classList.add('d-none');
          }

          // Hide transport checkbox for walking tours (they don't require transport)
          const tourRequiresTransport = document.getElementById('tourRequiresTransport');
          const tourTransportContainer = document.getElementById('tourTransportCheckboxContainer');
          if (tourRequiresTransport && tourTransportContainer) {
            tourRequiresTransport.checked = false;
            tourRequiresTransport.disabled = true;
            tourTransportContainer.style.display = 'none'; // Hide the entire transport checkbox container
            this.handleTourTransportToggle(false); // Hide transport fields
          }

          // Note: Standard pricing section hiding is only done during edit mode for walking tours
          // This allows walking tours to show pricing section when creating new ones

          this.handleWalkingTourSelection(selectedTour);
          return;
        }

        // Vehicle tour: show standard pricing and auto-enable transport
        if (vehiclePricingSection) vehiclePricingSection.classList.remove('d-none');
        if (walkingPricingSection) walkingPricingSection.classList.add('d-none');

        // Hide the tour person prices override toggle for vehicle tours
        if (this.canEditPrices) {
          document.getElementById('tourOverridePricesContainer')?.classList.add('d-none');
        }

        // Show standard pricing section (Precio base and Cantidad fields) for vehicle tours
        const standardPricingSection = document.getElementById('standardPricingSection');
        if (standardPricingSection) {
          standardPricingSection.classList.remove('d-none');
        }

        // Auto-enable transport for vehicle tours
        const tourRequiresTransport = document.getElementById('tourRequiresTransport');
        const tourTransportContainer = document.getElementById('tourTransportCheckboxContainer');
        if (tourRequiresTransport && tourTransportContainer) {
          tourRequiresTransport.checked = true;
          tourRequiresTransport.disabled = true; // Disable checkbox since transport is always required
          tourTransportContainer.style.display = 'none'; // Hide checkbox since it's always checked
          this.handleTourTransportToggle(true); // Show transport fields automatically
        }

        // Get client-specific tour price or use base price
        const price = this.getPriceForTour(tourId, null) || selectedTour.price || 0;

        // Auto-fill form fields
        const servicePriceField = document.getElementById('servicePrice');
        const serviceDescriptionField = document.getElementById('serviceDescription');
        const internalNotesField = document.getElementById('internalNotes');
        const clientNotesField = document.getElementById('clientNotes');
        const providerNotesField = document.getElementById('providerNotes');
        const teamNotesField = document.getElementById('teamNotes');

        // Fill price fields - for tours, set to 0 initially (vehicle cost will be added when vehicle is selected)
        if (servicePriceField) {
          servicePriceField.value = 0; // Tours should show 0 until a vehicle is selected
        }

        // Check if price override is active for tours
        const tourOverrideToggle = document.getElementById('tourOverridePrices');
        const isPriceOverride = tourOverrideToggle?.checked || false;

        // Store calculated prices for tours
        this.calculatedPrices.tour = {
          adult: selectedTour.price || price || 0,
          child: selectedTour.price_child || 0,
          noAlcohol: selectedTour.price_no_alcohol || 0,
        };

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
          const adultPriceValue = this.calculatedPrices.tour.adult;
          const adultPriceContainer = tourAdultPriceField.closest('.col-md-4');
          const adultQuantityContainer = tourAdultsQuantityField?.closest('.col-md-4');

          if (adultPriceValue && adultPriceValue > 0) {
            // Only set the value if not in override mode or if the field is empty
            if (!isPriceOverride || !tourAdultPriceField.value) {
              tourAdultPriceField.value = adultPriceValue;
            }
            if (adultPriceContainer) adultPriceContainer.style.display = 'block';
            if (adultQuantityContainer) adultQuantityContainer.style.display = 'block';
          } else {
            tourAdultPriceField.value = '';
            if (adultPriceContainer) adultPriceContainer.style.display = 'none';
            if (adultQuantityContainer) adultQuantityContainer.style.display = 'none';
            // Don't clear quantity field for vehicle tours - preserve prefilled values
          }
        }

        // Child Price Field and Quantity
        if (tourChildPriceField) {
          const childPriceValue = this.calculatedPrices.tour.child;
          const childPriceContainer = tourChildPriceField.closest('.col-md-4');
          const childQuantityContainer = tourChildrenQuantityField?.closest('.col-md-4');

          if (childPriceValue && childPriceValue > 0) {
            // Only set the value if not in override mode or if the field is empty
            if (!isPriceOverride || !tourChildPriceField.value) {
              tourChildPriceField.value = childPriceValue;
            }
            if (childPriceContainer) childPriceContainer.style.display = 'block';
            if (childQuantityContainer) childQuantityContainer.style.display = 'block';
          } else {
            tourChildPriceField.value = '';
            if (childPriceContainer) childPriceContainer.style.display = 'none';
            if (childQuantityContainer) childQuantityContainer.style.display = 'none';
            // Don't clear quantity field for vehicle tours - preserve prefilled values
          }
        }

        // No Alcohol Price Field and Quantity
        if (tourNoAlcoholPriceField) {
          const noAlcoholPriceValue = this.calculatedPrices.tour.noAlcohol;
          const noAlcoholPriceContainer = tourNoAlcoholPriceField.closest('.col-md-4');
          const noAlcoholQuantityContainer = tourAdultsNoAlcoholQuantityField?.closest('.col-md-4');

          if (noAlcoholPriceValue && noAlcoholPriceValue > 0) {
            // Only set the value if not in override mode or if the field is empty
            if (!isPriceOverride || !tourNoAlcoholPriceField.value) {
              tourNoAlcoholPriceField.value = noAlcoholPriceValue;
            }
            if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'block';
            if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'block';
          } else {
            tourNoAlcoholPriceField.value = '';
            if (noAlcoholPriceContainer) noAlcoholPriceContainer.style.display = 'none';
            if (noAlcoholQuantityContainer) noAlcoholQuantityContainer.style.display = 'none';
            // Don't clear quantity field for vehicle tours - preserve prefilled values
          }
        }

        // Fill passenger quantity fields with default values (only for new services)
        if (!this.currentServiceId) {
          // Don't override prefilled values for vehicle tours - the prefillPeopleFields() method
          // has already set appropriate values from the information step
          // Children and no alcohol fields are already handled by hiding containers when no price
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

        // Set default duration from tour.time (minutes to hours)
        const durationField = document.getElementById('tourDuration');
        if (durationField && selectedTour.time) {
          const defaultHours = Math.ceil(selectedTour.time / 60); // Round up to nearest hour
          durationField.value = defaultHours;
        }
        // Store current tour data for validation
        this.currentTourData = selectedTour;

        // Build minimalist tour details card
        const tourDuration = selectedTour.time ? this.formatMinutesToHoursAndMinutes(parseInt(selectedTour.time, 10)) : null;
        const bookingTimeValue = selectedTour.advance_booking_time;
        this.buildDetailsCard('tour', {
          title: selectedTour.destinationPOI?.name || selectedTour.name || '',
          description: selectedTour.description || '',
          duration: tourDuration,
          durationLabel: 'Mínimo de horas',
          advanceBooking: bookingTimeValue ? this.formatMinutesToHoursAndMinutes(parseInt(bookingTimeValue, 10)) : null,
          availabilitySchedule: this.extractAvailabilitySchedule(selectedTour),
          languages: Array.isArray(selectedTour.languages) ? selectedTour.languages.join(', ') : selectedTour.languages || null,
          includes: Array.isArray(selectedTour.includes) ? selectedTour.includes.join(', ') : selectedTour.includes,
          notIncludes: Array.isArray(selectedTour.notincludes) ? selectedTour.notincludes.join(', ') : selectedTour.notincludes,
          clientNotes: selectedTour.client_booking_notes || '',
        });

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
    this.hideDetailsCard('experience');
  }

  handleTourSchedule(tour) {
    const dayContext = this.getCurrentDayContext();
    const scheduleInfoDiv = document.getElementById('tourScheduleInfo');
    const suggestedTimesDiv = document.getElementById('tourSuggestedTimes');

    // Hide suggested times initially
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const currentDayOfWeek = dayContext?.dayOfWeek;
    const suggestedTimes = [];

    // Collect all available time slots
    if (tour.startTime && tour.endTime) {
      suggestedTimes.push(`${this.formatTime(tour.startTime)} - ${this.formatTime(tour.endTime)}`);
    } else if (tour.availability && typeof tour.availability === 'object') {
      if (Array.isArray(tour.availability) && currentDayOfWeek !== null) {
        const timeOptions = this.extractTimeOptionsForDay(tour.availability, currentDayOfWeek);
        timeOptions.forEach((opt) => suggestedTimes.push(opt.label));
      } else if (tour.availability.times && Array.isArray(tour.availability.times)) {
        tour.availability.times.forEach((time) => suggestedTimes.push(time));
      }
    }

    // Show suggested times as read-only text
    if (suggestedTimes.length > 0 && scheduleInfoDiv && suggestedTimesDiv) {
      suggestedTimesDiv.textContent = suggestedTimes.join(' • ');
      scheduleInfoDiv.classList.remove('d-none');
    }
  }

  clearTourSchedule() {
    const scheduleInfoDiv = document.getElementById('tourScheduleInfo');
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const tourStartTime = document.getElementById('tourStartTime');
    const tourEndTime = document.getElementById('tourEndTime');
    if (tourStartTime) tourStartTime.value = '';
    if (tourEndTime) tourEndTime.value = '';
  }

  clearExperienceSchedule() {
    const scheduleInfoDiv = document.getElementById('experienceScheduleInfo');
    if (scheduleInfoDiv) scheduleInfoDiv.classList.add('d-none');

    const expStartTime = document.getElementById('experienceStartTime');
    const expEndTime = document.getElementById('experienceEndTime');
    if (expStartTime) expStartTime.value = '';
    if (expEndTime) expEndTime.value = '';
  }

  clearTourDetails() {
    this.hideDetailsCard('tour');
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

            if (id && title && isExperience) {
              allExperiences.push({
                id,
                title,
                type: 'experience',
                provider: exp.provider || null,
                description: exp.description || '',
                duration: exp.duration || '',
                location: exp.location || '',
                price: exp.price || 0,
                unavailable: !isAvailableOnDay && dayOfWeek !== null,
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

          return hasId && hasTitle && isActive && hasValidProvider;
        });
        const mappedProviderExperiences = validProviderExperiences.map((provExp) => {
          const isAvailableOnDay = this.isExperienceAvailableOnDay(provExp, dayOfWeek, dayDate);
          return {
            id: provExp.id || provExp.objectId,
            title: provExp.title || provExp.name || provExp.experienceName,
            type: 'provider_experience',
            unavailable: !isAvailableOnDay && dayOfWeek !== null,
            provider: provExp.provider || null,
            description: provExp.description || '',
            duration: provExp.duration || '',
            location: provExp.location || '',
            price: provExp.price || 0,
          };
        });

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
        if (exp.type === 'provider_experience' && exp.provider?.type === 'Establishment') {
          // Provider experiences from establishments: show as "Title - EstablishmentName"
          displayTitle = `${exp.title} - ${exp.provider.name}`;

          // Add development environment indicator
          if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev')) {
            displayTitle += ' [Est]';
          }
        } else if (exp.type === 'provider_experience') {
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

        if (exp.unavailable) {
          // keep original title clean — warning shown below dropdown
          option.dataset.unavailable = 'true';
        }
        option.textContent = displayTitle;
        option.dataset.type = exp.type;
        option.dataset.providerId = exp.provider?.id || '';
        option.dataset.providerName = exp.provider?.name || '';
        option.dataset.providerType = exp.provider?.type || '';
        
        // Debug: Log establishment experiences for troubleshooting
        if (exp.provider?.type === 'Establishment') {
          console.debug('🏪 Establishment experience added to dropdown:', {
            id: exp.id,
            title: exp.title,
            providerName: exp.provider.name,
            providerType: exp.provider.type,
            displayTitle: displayTitle
          });
        }
        
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

        // Filter tours: must have destinationPOI with name, be active and exist
        const validTours = tours.filter((tour) => tour && tour.destinationPOI && tour.destinationPOI.name && tour.objectId && tour.active !== false && tour.exists !== false);

        // Track availability per tour (don't filter out — mark instead)
        const tourAvailability = new Map();
        if (dayOfWeek !== null) {
          validTours.forEach((tour) => {
            const tourId = tour.objectId || tour.id;
            tourAvailability.set(tourId, this.checkTourAvailability(tour, dayOfWeek));
          });
        }

        // Sort tours alphabetically by destinationPOI name
        validTours.sort((a, b) => {
          const nameA = a.destinationPOI?.name || '';
          const nameB = b.destinationPOI?.name || '';
          return nameA.localeCompare(nameB);
        });

        // Split into vehicle tours and walking tours
        const vehicleTours = validTours.filter((t) => !t.isWalkingTour);
        const walkingTours = validTours.filter((t) => t.isWalkingTour === true);

        const addTourOption = (tour, parent) => {
          const option = document.createElement('option');
          const tourId = tour.objectId || tour.id;
          option.value = tourId;
          const text = tour.destinationPOI?.name || tour.description || 'Tour sin nombre';
          if (tourAvailability.has(tourId) && !tourAvailability.get(tourId)) {
            // keep original title clean — warning shown below dropdown
            option.dataset.unavailable = 'true';
          }
          option.textContent = text;
          parent.appendChild(option);
        };

        if (vehicleTours.length > 0 && walkingTours.length > 0) {
          // Use optgroups when both types exist
          const vehicleGroup = document.createElement('optgroup');
          vehicleGroup.label = 'Tours en Vehículo';
          vehicleTours.forEach((tour) => addTourOption(tour, vehicleGroup));
          tourSelect.appendChild(vehicleGroup);

          const walkingGroup = document.createElement('optgroup');
          walkingGroup.label = 'Tours a Pie';
          walkingTours.forEach((tour) => addTourOption(tour, walkingGroup));
          tourSelect.appendChild(walkingGroup);
        } else {
          // Single type — flat list
          validTours.forEach((tour) => addTourOption(tour, tourSelect));
        }
      } else {
        console.warn('⚠️ No tours in cache after loading attempt');
      }
    } catch (error) {
      console.error('Error loading tours into dropdown:', error);
      this.showModalAlert('serviceModalAlert', 'Error cargando tours', 'warning');
    }
  }

  async saveToBackend() {
    // Totals will be calculated from display prices (with surcharge + currency)
    let grandSubtotal = 0;

    // Transform our data structure to match the expected format
    const serviceItemsData = {
      days: this.days.map((day, index) => {
        // Calculate day total from services (using display prices)
        let dayTotal = 0;
        const subconcepts = day.services.map((serviceId) => {
          const service = this.services.get(serviceId);
          if (!service) return null;

          // Apply payment surcharge + currency conversion so summary matches
          const baseMXN = this.calculateServicePrice(service);
          const servicePrice = this.getDisplayPrice(baseMXN);
          const serviceTotal = servicePrice * (service.type === 'transport' ? 1 : (service.quantity || 1));
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
            availabilityPending: service.availabilityPending || false,
            hours: service.hours || null,
            total: serviceTotal,
            // Type-specific fields
            experienceId: service.experienceId || null,
            providerType: service.providerType || null,
            tourId: service.tourId || null,
            rateId: service.rateId || null, // Store rate for vehicle pricing
            hotelName: service.hotelName || null,
            // People quantities
            adultsQuantity: service.adultsQuantity || null,
            childrenQuantity: service.childrenQuantity || null,
            adultsNoAlcoholQuantity: service.adultsNoAlcoholQuantity || null,
            infantsQuantity: service.infantsQuantity || null,
            // Schedule for experiences
            selectedSchedule: service.selectedSchedule || null,
            // Individual prices for experiences
            adultPrice: service.adultPrice || null,
            childPrice: service.childPrice || null,
            noAlcoholPrice: service.noAlcoholPrice || null,
            checkIn: service.checkIn || null,
            checkOut: service.checkOut || null,
            // Tour-specific fields
            duration: service.duration || null,
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
            waitingTimeHours: service.waitingTimeHours || 0,
            waitingTimePricePerHour: service.waitingTimePricePerHour || 0,
            // Round trip fields
            startDate: service.startDate || null,
            endDate: service.endDate || null,
            returnOrigin: service.returnOrigin || null,
            returnDestination: service.returnDestination || null,
            returnAirline: service.returnAirline || null,
            returnFlightNumber: service.returnFlightNumber || null,
            // A Disposición fields
            vehicleCount: service.vehicleCount || null,
            hourlyPrice: service.hourlyPrice || null,
            discountPercent: service.discountPercent || null,
            // Walking tour fields
            isWalkingTour: service.isWalkingTour || false,
            walkingTourPeopleCount: service.walkingTourPeopleCount || null,
            walkingTourPrice: service.walkingTourPrice || null,
            walkingTourCurrency: service.walkingTourCurrency || null,
            // Price override fields
            priceOverride: service.priceOverride || false,
            customPrice: service.customPrice || null,
            customPrices: service.customPrices || null,
          };

          // Debug logging for price override
          if (service.type === 'tour' || service.type === 'experience') {
            console.log('💾 Sending to backend - service price data:', {
              type: service.type,
              priceOverride: service.priceOverride,
              customPrice: service.customPrice,
              customPrices: service.customPrices,
              price: service.price,
              unitPrice: servicePrice,
              duration: service.duration,
            });
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
      subtotal: 0, // calculated below
      iva: 0,
      total: 0,
      currency: document.getElementById('currencySelect')?.value || 'MXN',
      paymentType: document.getElementById('priceTypeSelect')?.value || 'efectivo',
    };

    // Calculate totals from display-price day totals
    serviceItemsData.days.forEach((day) => { grandSubtotal += day.dayTotal; });
    serviceItemsData.subtotal = Math.round(grandSubtotal * 100) / 100;
    serviceItemsData.iva = Math.round(grandSubtotal * 0.16 * 100) / 100;
    serviceItemsData.total = Math.round((serviceItemsData.subtotal + serviceItemsData.iva) * 100) / 100;

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

    // Dispatch event for successful service items update
    if (result.success) {
      const event = new CustomEvent('serviceItemsUpdated', {
        detail: {
          quoteId: this.quoteId,
          serviceItems: serviceItemsData,
          total: serviceItemsData.total,
          subtotal: serviceItemsData.subtotal,
          currency: serviceItemsData.currency,
        },
      });
      document.dispatchEvent(event);
      console.log('📡 Dispatched serviceItemsUpdated event', { total: serviceItemsData.total });
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
    const modalEl = document.getElementById('previewModal');
    const modal = new bootstrap.Modal(modalEl);
    const content = document.getElementById('previewContent');

    // Add price toggle button to modal header if not already there
    const modalHeader = modalEl.querySelector('.modal-header');
    if (!modalHeader.querySelector('#togglePreviewPrices')) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-sm btn-outline-secondary ms-2';
      toggleBtn.id = 'togglePreviewPrices';
      toggleBtn.innerHTML = '<i class="ti ti-eye-off me-1"></i>Ocultar Precios';
      modalHeader.querySelector('.modal-title').after(toggleBtn);

      toggleBtn.addEventListener('click', () => {
        const preview = content.querySelector('.itinerary-preview');
        if (preview) {
          const hidden = preview.classList.toggle('hide-prices');
          toggleBtn.innerHTML = hidden
            ? '<i class="ti ti-eye me-1"></i>Mostrar Precios'
            : '<i class="ti ti-eye-off me-1"></i>Ocultar Precios';
        }
      });
    }

    // Color map per service type
    const typeColors = {
      transport: '#0d6efd',
      experience: '#6f42c1',
      tour: '#198754',
      concepto: '#6c757d',
      'a-disposicion': '#fd7e14',
    };

    const typeLabels = {
      experience: 'Experiencia',
      tour: 'Tour',
      transport: 'Transporte',
      'a-disposicion': 'A Disposición',
      concepto: 'Concepto',
    };

    // Calculate grand total
    let grandTotal = 0;

    // Generate preview HTML
    let previewHtml = `<div class="itinerary-preview">
      <style>
        .itinerary-preview .pv-day-card { border: 1px solid #e9ecef; border-radius: 0.5rem; overflow: hidden; margin-bottom: 1.5rem; }
        .itinerary-preview .pv-day-header { background: linear-gradient(135deg, #f8f9fa 0%, #fff 100%); padding: 1rem 1.25rem; border-bottom: 1px solid #e9ecef; }
        .itinerary-preview .pv-day-badge { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #f76b1c 0%, #fa984f 100%); color: white; font-weight: 700; font-size: 0.9rem; margin-right: 0.75rem; flex-shrink: 0; }
        .itinerary-preview .pv-day-title { font-size: 1.1rem; font-weight: 600; color: #212529; }
        .itinerary-preview .pv-day-date { font-size: 0.85rem; color: #6c757d; }
        .itinerary-preview .pv-day-desc { font-size: 0.85rem; color: #6c757d; margin-top: 0.25rem; }
        .itinerary-preview .pv-services { padding: 0.75rem 1.25rem; }
        .itinerary-preview .pv-service { display: flex; justify-content: space-between; align-items: flex-start; padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 0.375rem; background: #fafbfc; border-left: 4px solid #dee2e6; }
        .itinerary-preview .pv-service:last-child { margin-bottom: 0; }
        .itinerary-preview .pv-service-info { flex: 1; min-width: 0; }
        .itinerary-preview .pv-service-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap; }
        .itinerary-preview .pv-badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 0.25rem; font-size: 0.7rem; font-weight: 600; }
        .itinerary-preview .pv-service-name { font-weight: 600; font-size: 0.9rem; color: #212529; }
        .itinerary-preview .pv-service-detail { font-size: 0.8rem; color: #6c757d; display: flex; align-items: center; gap: 0.25rem; margin-top: 0.2rem; }
        .itinerary-preview .pv-route { display: flex; align-items: flex-start; gap: 0.5rem; margin-top: 0.25rem; }
        .itinerary-preview .pv-route-dots { display: flex; flex-direction: column; align-items: center; min-width: 14px; padding-top: 2px; }
        .itinerary-preview .pv-route-line { width: 1.5px; height: 14px; background: linear-gradient(to bottom, #198754, #dc3545); }
        .itinerary-preview .pv-route-names { font-size: 0.85rem; line-height: 1.5; }
        .itinerary-preview .pv-price { font-weight: 600; font-size: 0.9rem; color: #212529; white-space: nowrap; margin-left: 1rem; padding-top: 0.15rem; }
        .itinerary-preview .pv-price.pv-excluded { text-decoration: line-through; color: #adb5bd; }
        .itinerary-preview .pv-day-footer { padding: 0.75rem 1.25rem; background: #f8f9fa; border-top: 1px solid #e9ecef; text-align: right; }
        .itinerary-preview .pv-day-total { font-weight: 700; font-size: 1rem; color: #212529; }
        .itinerary-preview .pv-grand-total { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; border-radius: 0.5rem; padding: 1.25rem 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
        .itinerary-preview .pv-grand-label { font-size: 1rem; opacity: 0.85; }
        .itinerary-preview .pv-grand-amount { font-size: 1.5rem; font-weight: 700; }
        .itinerary-preview .pv-grand-person { font-size: 0.85rem; opacity: 0.7; }
        .itinerary-preview .pv-notes { font-size: 0.78rem; color: #868e96; font-style: italic; margin-top: 0.2rem; }
        .itinerary-preview.hide-prices .pv-price,
        .itinerary-preview.hide-prices .pv-day-footer,
        .itinerary-preview.hide-prices .pv-grand-total { display: none !important; }
      </style>`;

    this.days.forEach((day) => {
      const services = day.services.map((sid) => this.services.get(sid)).filter(Boolean);
      const dayTotalMXN = services.reduce((sum, service) => {
        if (service.includeInTotal === false) return sum;
        return sum + (this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity));
      }, 0);
      const dayTotal = this.getDisplayPrice(dayTotalMXN);
      grandTotal += dayTotalMXN;

      previewHtml += `
        <div class="pv-day-card">
          <div class="pv-day-header">
            <div style="display: flex; align-items: center;">
              <span class="pv-day-badge">${day.number}</span>
              <div>
                <div class="pv-day-title">Día ${day.number} · ${day.title}</div>
                ${day.date ? `<div class="pv-day-date"><i class="ti ti-calendar me-1"></i>${this.formatDate(day.date)}</div>` : ''}
                ${day.description ? `<div class="pv-day-desc">${day.description}</div>` : ''}
              </div>
            </div>
          </div>
          <div class="pv-services">
            ${services.map((service) => this.renderPreviewService(service, typeColors, typeLabels)).join('')}
          </div>
          <div class="pv-day-footer">
            <span class="pv-day-total">Total del día: ${this.formatCurrency(dayTotal)}</span>
          </div>
        </div>`;
    });

    // Grand total
    const grandTotalDisplay = this.getDisplayPrice(grandTotal);
    const perPerson = this.numberOfPeople > 0 ? this.formatCurrency(grandTotalDisplay / this.numberOfPeople) : null;
    const selectedCurrency = document.getElementById('currencySelect')?.value || 'MXN';
    const selectedPaymentType = document.getElementById('priceTypeSelect')?.value || 'efectivo';
    const paymentLabels = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta de Crédito/Débito' };
    const paymentLabel = paymentLabels[selectedPaymentType] || selectedPaymentType;

    previewHtml += `
      <div class="pv-grand-total">
        <div>
          <div class="pv-grand-label">Total General</div>
          <div class="pv-grand-person"><i class="ti ti-coin me-1"></i>${selectedCurrency} · <i class="ti ti-credit-card me-1"></i>${paymentLabel}</div>
          ${perPerson ? `<div class="pv-grand-person"><i class="ti ti-users me-1"></i>Por persona (${this.numberOfPeople}): ${perPerson}</div>` : ''}
        </div>
        <div class="pv-grand-amount">${this.formatCurrency(grandTotalDisplay)}</div>
      </div>`;

    previewHtml += '</div>';
    content.innerHTML = previewHtml;

    modal.show();
  }

  renderPreviewService(service, typeColors, typeLabels) {
    const color = typeColors[service.type] || '#6c757d';
    const price = this.calculateServicePrice(service) * (service.type === 'transport' ? 1 : service.quantity);
    const displayPrice = this.getDisplayPrice(price);
    const isExcluded = service.includeInTotal === false;

    if (service.type === 'transport') {
      return this.renderPreviewTransport(service, color, displayPrice, isExcluded);
    }
    return this.renderPreviewGenericService(service, color, typeColors, typeLabels, displayPrice, isExcluded);
  }

  renderPreviewTransport(service, color, displayPrice, isExcluded) {
    const transportTypes = { aeropuerto: 'Aeropuerto', 'punto-a-punto': 'Punto a Punto', local: 'Local' };
    const transportLabel = transportTypes[service.transportType] || 'Transporte';
    const origin = service.originName || service.origin || 'Origen';
    const destination = service.destination || 'Destino';
    const vehicleName = this.getVehicleDisplayName(service);
    const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;
    const directionLabels = {
      arrival: service.transportType === 'aeropuerto' ? 'Llegada' : 'Ida',
      departure: service.transportType === 'aeropuerto' ? 'Salida' : 'Vuelta',
    };

    return `
      <div class="pv-service" style="border-left-color: ${color};">
        <div class="pv-service-info">
          <div class="pv-service-header">
            <span class="pv-badge" style="background: ${color}15; color: ${color};">Transporte</span>
            <span class="pv-badge" style="background: ${color}25; color: ${color};">${transportLabel}</span>
            ${service.directionType ? `<span class="pv-badge" style="background: ${service.directionType === 'arrival' ? '#19875415' : '#fd7e1415'}; color: ${service.directionType === 'arrival' ? '#198754' : '#fd7e14'};">${directionLabels[service.directionType] || ''}</span>` : ''}
            ${isExcluded ? '<span class="pv-badge" style="background: #6c757d20; color: #6c757d;">Pago externo</span>' : ''}
          </div>
          <div class="pv-route">
            <div class="pv-route-dots">
              <i class="ti ti-circle-filled text-success" style="font-size: 0.45rem;"></i>
              <div class="pv-route-line"></div>
              <i class="ti ti-map-pin-filled text-danger" style="font-size: 0.6rem;"></i>
            </div>
            <div class="pv-route-names">
              <div>${origin}</div>
              <div>${destination}</div>
            </div>
          </div>
          ${service.selectedSchedule || service.startTime ? `<div class="pv-service-detail"><i class="ti ti-clock"></i>${service.selectedSchedule || service.startTime}</div>` : ''}
          ${hasVehicle ? `<div class="pv-service-detail"><i class="ti ti-car"></i>${vehicleName}${service.quantity > 1 ? ` x${service.quantity}` : ''}</div>` : ''}
          ${service.flightNumber ? `<div class="pv-service-detail"><i class="ti ti-plane"></i>${service.flightNumber}${service.airline ? ` · ${service.airline}` : ''}</div>` : ''}
          ${service.includeGuide ? '<div class="pv-service-detail" style="color: #198754;"><i class="ti ti-user"></i>Incluye Guía + Chofer</div>' : ''}
          ${service.includeGreeter ? '<div class="pv-service-detail" style="color: #0dcaf0;"><i class="ti ti-users"></i>Incluye Greeter</div>' : ''}
          ${service.waitingTimeHours > 0 ? `<div class="pv-service-detail" style="color: #fd7e14;"><i class="ti ti-clock"></i>Tiempo de espera: ${service.waitingTimeHours}h</div>` : ''}
          ${service.notes ? `<div class="pv-notes"><i class="ti ti-notes me-1"></i>${service.notes}</div>` : ''}
        </div>
        <div class="pv-price ${isExcluded ? 'pv-excluded' : ''}">${this.formatCurrency(displayPrice)}</div>
      </div>`;
  }

  renderPreviewGenericService(service, color, typeColors, typeLabels, displayPrice, isExcluded) {
    const label = typeLabels[service.type] || service.type;
    const hasVehicle = service.vehicleId || service.vehicleType || service.vehicleTypeName;
    let badgeLabel = null;
    if (service.type === 'tour' && service.isWalkingTour) {
      badgeLabel = 'Tour a Pie';
    } else if (service.type === 'experience' && this.isExperienceFromEstablishment(service.experienceId)) {
      badgeLabel = 'Establecimiento';
    }

    return `
      <div class="pv-service" style="border-left-color: ${color};">
        <div class="pv-service-info">
          <div class="pv-service-header">
            <span class="pv-badge" style="background: ${color}15; color: ${color};">${badgeLabel || label}</span>
            ${isExcluded ? '<span class="pv-badge" style="background: #6c757d20; color: #6c757d;">Pago externo</span>' : ''}
            <span class="pv-service-name">${this.getServiceTitle(service)}</span>
          </div>
          ${service.selectedSchedule || service.startTime ? `<div class="pv-service-detail"><i class="ti ti-clock"></i>${service.selectedSchedule || (service.startTime + (service.endTime ? ` - ${service.endTime}` : ''))}</div>` : ''}
          ${hasVehicle ? `<div class="pv-service-detail"><i class="ti ti-car"></i>${this.getVehicleDisplayName(service)}${service.quantity > 1 ? ` x${service.quantity}` : ''}</div>` : ''}
          ${service.type === 'tour' && service.includeGuide ? '<div class="pv-service-detail" style="color: #198754;"><i class="ti ti-user"></i>Incluye Guía + Chofer</div>' : ''}
          ${(service.type === 'tour' || service.type === 'transport') && service.includeGreeter ? `<div class="pv-service-detail" style="color: #0dcaf0;"><i class="ti ti-users"></i>Incluye Greeter ${service.routeDuration ? this.formatGreeterFormula(service.routeDuration, this.calculateGreeterPrice(service.routeDuration)) : ''}</div>` : ''}
          ${service.notes ? `<div class="pv-notes"><i class="ti ti-notes me-1"></i>${service.notes}</div>` : ''}
        </div>
        <div class="pv-price ${isExcluded ? 'pv-excluded' : ''}">${this.formatCurrency(displayPrice)}</div>
      </div>`;
  }

  async exportPdf() {
    const btn = document.getElementById('exportPdfBtn');
    const originalText = btn ? btn.innerHTML : '';

    try {
      // Show loading state
      if (btn) {
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generando PDF...';
        btn.disabled = true;
      }

      // Load html2pdf dynamically if not already loaded
      if (typeof html2pdf === 'undefined') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('No se pudo cargar la librería de PDF'));
          document.head.appendChild(script);
        });
      }

      const previewContent = document.getElementById('previewContent');
      const previewEl = previewContent?.querySelector('.itinerary-preview');
      if (!previewEl) throw new Error('No preview content found');

      // Temporarily ensure prices are visible for PDF
      const wasHidden = previewEl.classList.contains('hide-prices');
      if (wasHidden) previewEl.classList.remove('hide-prices');

      const opt = {
        margin: [10, 10, 10, 10],
        filename: `Itinerario_${this.quoteId}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          backgroundColor: '#ffffff',
          logging: false,
        },
        jsPDF: {
          unit: 'mm',
          format: 'letter',
          orientation: 'portrait',
          compress: true,
        },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['.pv-day-header', '.pv-service', '.pv-grand-total'],
        },
      };

      await html2pdf().set(opt).from(previewEl).save();

      // Restore hidden state if it was hidden
      if (wasHidden) previewEl.classList.add('hide-prices');

      this.showAlert('PDF exportado exitosamente', 'success');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      this.showAlert('Error al exportar el PDF', 'danger');
    } finally {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    }
  }

  // Drag and Drop Methods
  setupSidebarDragAndDrop(container) {
    let draggedElement = null;
    let isDragging = false;
    let dropZoneActive = false;

    // Add dragover and drop to container to catch all drops
    container.addEventListener('dragover', (e) => {
      // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
      if (e.dataTransfer.types.includes('application/x-catalog-item')) {
        container.querySelectorAll('.drop-indicator').forEach((el) => el.remove());
        return;
      }

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
      // Skip if this is a catalog drag-and-drop
      if (e.dataTransfer.types.includes('application/x-catalog-item')) return;

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
        // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
        if (e.dataTransfer.types.includes('application/x-catalog-item')) return;

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
        // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
        if (e.dataTransfer.types.includes('application/x-catalog-item')) return;

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
      // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
      if (e.dataTransfer.types.includes('application/x-catalog-item')) {
        this.clearDropIndicators(container);
        return;
      }

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
      // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
      if (e.dataTransfer.types.includes('application/x-catalog-item')) {
        this.clearDropIndicators(container);
        return;
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    container.addEventListener('drop', (e) => {
      // Skip if this is a catalog drag-and-drop (handled by DragCatalogManager)
      if (e.dataTransfer.types.includes('application/x-catalog-item')) return;

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
      const { dayId } = card.dataset;
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

  // Initialize per-group pricing fields for walking tours
  initializeWalkingTourGroupPricing(tour) {
    const peopleCountInput = document.getElementById('walkingTourPeopleCount');
    const peopleCount = parseInt(peopleCountInput?.value || 0);

    if (peopleCount <= 0) return;

    // Calculate groups
    const groups = this.calculateWalkingTourGroups(tour, peopleCount);

    // Update group inputs when people count changes
    if (!window._walkingGroupListener) {
      window._walkingGroupListener = () => {
        const newCount = parseInt(peopleCountInput?.value || 0);
        if (newCount > 0) {
          this.generateWalkingTourGroupInputs(tour, newCount);
        }
      };
      peopleCountInput?.addEventListener('input', window._walkingGroupListener.bind(this));
    }

    // Generate initial group inputs
    this.generateWalkingTourGroupInputs(tour, peopleCount);
  }

  // Generate dynamic input fields for each walking tour group
  generateWalkingTourGroupInputs(tour, peopleCount) {
    const priceMode = document.querySelector('input[name="walkingPriceMode"]:checked')?.value || 'total';
    const groupPricesContainer = document.getElementById('walkingTourGroupPrices');
    const totalPriceContainer = document.getElementById('walkingTourTotalPriceContainer');
    const groupPricesSection = document.getElementById('walkingTourGroupPricesSection');

    if (priceMode === 'total') {
      // Show total price mode
      totalPriceContainer?.classList.remove('d-none');
      groupPricesSection?.classList.add('d-none');
    } else {
      // Show per-group mode
      totalPriceContainer?.classList.add('d-none');
      groupPricesSection?.classList.remove('d-none');

      if (!groupPricesContainer) return;

      // Calculate groups
      const groups = this.calculateWalkingTourGroups(tour, peopleCount);
      const priceCurrency = tour.walkingPriceCurrency || 'MXN';

      // Generate input fields for each group
      let html = '';
      groups.forEach((group, index) => {
        let defaultPrice = group.tier.price;
        // If source price is in USD, convert to MXN for internal storage
        if (priceCurrency === 'USD' && this.exchangeRate) {
          defaultPrice = Math.round(defaultPrice * this.exchangeRate);
        }

        html += `
          <div class="mb-3">
            <label class="form-label d-flex justify-content-between align-items-center">
              <span>
                <i class="ti ti-users me-1"></i>
                Grupo ${index + 1} (${group.tier.label})
              </span>
              <span class="text-muted small">${group.count} personas</span>
            </label>
            <div class="input-group">
              <span class="input-group-text">$</span>
              <input type="text" 
                     class="form-control walking-group-price" 
                     id="walkingGroupPrice_${index}" 
                     data-group-index="${index}"
                     value="${defaultPrice.toFixed(2)}"
                     placeholder="Precio del grupo">
              <span class="input-group-text">MXN</span>
            </div>
          </div>
        `;
      });

      // Add total calculation display
      html += `
        <div class="border-top pt-2 mt-3">
          <div class="d-flex justify-content-between align-items-center">
            <span class="fw-bold">Total:</span>
            <span class="fw-bold text-primary" id="walkingGroupTotalDisplay">$0.00 MXN</span>
          </div>
        </div>
      `;

      groupPricesContainer.innerHTML = html;

      // Add event listeners to group price inputs
      const groupInputs = groupPricesContainer.querySelectorAll('.walking-group-price');
      groupInputs.forEach((input) => {
        input.addEventListener('input', (e) => {
          // Apply price validation
          const inp = e.target;
          let { value } = inp;

          // Remove any non-numeric characters except decimal point
          value = value.replace(/[^0-9.]/g, '');

          // Allow only one decimal point
          const parts = value.split('.');
          if (parts.length > 2) {
            value = `${parts[0]}.${parts.slice(1).join('')}`;
          }

          // Limit to 2 decimal places
          if (parts.length === 2 && parts[1].length > 2) {
            value = `${parts[0]}.${parts[1].substring(0, 2)}`;
          }

          // Update the input value if it was modified
          if (inp.value !== value) {
            inp.value = value;
          }

          // Update total display
          updateWalkingGroupTotalDisplay();
          // Update breakdown
          this.updateServicePriceBreakdown();
        });

        // Add keydown handler to prevent invalid characters
        input.addEventListener('keydown', (e) => {
          // Allow: backspace, delete, tab, escape, enter, decimal point
          if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1
              // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
              || (e.keyCode === 65 && e.ctrlKey === true)
              || (e.keyCode === 67 && e.ctrlKey === true)
              || (e.keyCode === 86 && e.ctrlKey === true)
              || (e.keyCode === 88 && e.ctrlKey === true)
              // Allow: home, end, left, right
              || (e.keyCode >= 35 && e.keyCode <= 39)) {
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
        });

        // Add paste handler to validate pasted content
        input.addEventListener('paste', (e) => {
          e.preventDefault();
          const clipboard = e.clipboardData || window.clipboardData;
          const pastedText = clipboard ? clipboard.getData('text') : '';
          // Clean the pasted text
          let cleanedText = pastedText.replace(/[^0-9.]/g, '');
          // Ensure only one decimal point
          const parts = cleanedText.split('.');
          if (parts.length > 2) {
            cleanedText = `${parts[0]}.${parts.slice(1).join('')}`;
          }
          // Insert cleaned text at cursor position
          const inp = e.target;
          const start = inp.selectionStart;
          const end = inp.selectionEnd;
          const currentValue = inp.value;
          inp.value = currentValue.substring(0, start) + cleanedText + currentValue.substring(end);
          // Trigger input event to apply full validation
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });

      // Calculate initial total
      updateWalkingGroupTotalDisplay();
    }
  }
}

// Global variable to store services data for filtering
let servicesData = null;

/**
 * Load active services from Services table and populate transport dropdowns.
 * @example
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

  services.forEach((service) => {
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

  // console.log(`[Services] Dropdowns updated for ${transportType}:`, {
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
  if (!window.servicesByTransportType) return;

  const services = window.servicesByTransportType[transportType] || [];

  // Collect origins/destinations for both directions
  const arrivalOrigins = new Set();
  const arrivalDestinations = new Set();
  const departureOrigins = new Set();
  const departureDestinations = new Set();

  services.forEach((service) => {
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

  // For departure: user's origin is a local place stored as service.destination in DB
  // So filter by service.destination and return service.origin as destination options
  const isDeparture = directionType === 'departure';
  const isDepartureWithSelect = isDeparture && (transportType === 'aeropuerto' || transportType === 'punto-a-punto');

  const relevantServices = services.filter((service) => (isDeparture ? service.destination === originalOriginName : service.origin === originalOriginName));

  if (relevantServices.length === 0) {
    return;
  }

  // Get matching destinations
  const destinations = new Set();
  relevantServices.forEach((service) => {
    if (isDeparture) {
      // Departure: show matching origins as destination options
      if (service.origin) {
        destinations.add(service.origin);
      }
    } else if (service.destination) {
      destinations.add(service.destination);
    }
  });

  if (isDepartureWithSelect) {
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
    console.log('🔒 ItineraryBuilder already exists, skipping initialization');
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
        console.log(`✅ Adding event listener to origin select ${index}:`, select.id);
        select.addEventListener('change', (e) => {
          const selectedOrigin = e.target.value;
          console.log(`🔄 Origin select ${index} changed to:`, selectedOrigin);

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
            console.log('Resetting to all destinations for transport type:', transportType);
            populateDropdownsForTransportType(transportType);
          }

          // Re-trigger transport price lookup if rate is already selected
          const currentRateId = document.getElementById('transportCategory')?.value;
          if (window.itineraryBuilder && currentRateId) {
            window.itineraryBuilder.handleTransportRateSelection(currentRateId);
          }

          // Auto-sync Ida → Vuelta (swapped) for round trip
          if (window.itineraryBuilder) window.itineraryBuilder.syncIdaToVuelta();
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

    // Destination combo: trigger rate selection and specific location check when destination changes
    const destComboEl = document.getElementById('transportDestinationCombo');
    if (destComboEl) {
      destComboEl.addEventListener('input', () => {
        checkSpecificLocationField();
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
    if (transportType === 'local') {
      document.getElementById('roundTripSpecificLocationIdaRow')?.classList.add('d-none');
      document.getElementById('roundTripSpecificLocationVueltaRow')?.classList.add('d-none');
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
    console.log('🧪 Testing origin filtering for:', origin);
    updateDestinationsForOrigin(origin);
  };

  window.debugServices = function () {
    console.log('🔍 Current services data:', window.servicesByTransportType);
    console.log('🔍 Slug to original mapping:', window.slugToOriginalMapping);
    console.log('🔍 Origin elements:', [
      document.getElementById('transportOriginSelect'),
      document.getElementById('roundTripOriginIdaSelect'),
    ]);
    console.log('🔍 Destination datalists:', [
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

      // Fix checkbox sync issues that can occur with Bootstrap modals
      setTimeout(() => {
        const tourOverrideCheckbox = document.getElementById('tourOverridePrices');
        if (tourOverrideCheckbox) {
          // Check if there's a visual/actual state mismatch
          const parent = tourOverrideCheckbox.closest('.form-check');
          const shouldBeChecked = parent?.classList.contains('active')
                                 || tourOverrideCheckbox.hasAttribute('checked');

          if (shouldBeChecked && !tourOverrideCheckbox.checked) {
            console.log('🔧 Fixing tour override checkbox state on modal show');
            tourOverrideCheckbox.checked = true;
          } else if (!shouldBeChecked && tourOverrideCheckbox.checked) {
            console.log('🔧 Unchecking tour override checkbox on modal show');
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
    let total = 0;

    groupInputs.forEach((input) => {
      const value = parseFloat(input.value) || 0;
      total += value;
    });

    const totalDisplay = document.getElementById('walkingGroupTotalDisplay');
    if (totalDisplay) {
      totalDisplay.textContent = `$${total.toFixed(2)} MXN`;
    }

    // Store the total for use in data collection
    window.walkingGroupTotal = total;
  }

  // Handle walking tour pricing mode change
  /**
   *
   * @param mode
   * @example
   */
  function handleWalkingPriceModeChange(mode) {
    const tourSelect = document.getElementById('tourSelect');
    const selectedTourId = tourSelect?.value;

    if (selectedTourId && this.toursCache.has('all')) {
      const tours = this.toursCache.get('all');
      const selectedTour = tours.find((tour) => tour.id === selectedTourId || tour.objectId === selectedTourId);

      if (selectedTour) {
        const peopleCountInput = document.getElementById('walkingTourPeopleCount');
        const peopleCount = parseInt(peopleCountInput?.value || 0);

        if (peopleCount > 0) {
          this.generateWalkingTourGroupInputs(selectedTour, peopleCount);
        }
      }
    }
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
