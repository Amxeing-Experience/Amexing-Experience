/**
 * Quote Services V2 Controller - Travefy-inspired Itinerary Builder
 * Created by Denisse Maldonado
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
            transport: {}
        };
        this.currentServiceType = null;
        
        // Cache for API data
        this.vehiclesCache = null;
        this.experiencesCache = new Map();
        this.toursCache = new Map();
        this.ratesCache = null;
        this.providerExperiencesCache = null;
        this.agencyRateCache = null;
        this.driverTourRateCache = null;
        this.guideTransportRateCache = null;
        this.transferRateCache = null;
        
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
        for (let cookie of cookies) {
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
                this.loadProviderExperiences(),
                this.loadAgencyRate(),
                this.loadDriverTourRate()
                // Note: Guide transport rate and transfer rate endpoints not available yet
                // this.loadGuideTransportRate(),
                // this.loadTransferRate()
            ]);
            
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
            
        } catch (error) {
            console.error('Error initializing itinerary builder:', error);
            this.showAlert('Error al cargar el itinerario', 'danger');
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
        document.querySelectorAll('input[name="serviceType"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.handleServiceTypeChange(e.target.value));
        });
        
        // Transport Type Toggle
        document.querySelectorAll('input[name="transportType"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleTransportTypeChange());
        });
        
        // Trip Type Toggle
        document.querySelectorAll('input[name="tripType"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleTripTypeChange());
        });
        
        // Direction Type Toggle (Arrival/Departure)
        document.querySelectorAll('input[name="directionType"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleDirectionTypeChange());
        });
        
        // Currency change listener
        document.getElementById('currencySelect')?.addEventListener('change', (e) => {
            const currencySymbol = document.getElementById('currencySymbol');
            if (currencySymbol) {
                currencySymbol.textContent = e.target.value;
            }
        });
        
        // Experience selection handler
        document.getElementById('experienceSelect')?.addEventListener('change', (e) => {
            this.handleExperienceSelection(e.target.value);
        });
        
        // Tour selection handler  
        document.getElementById('tourSelect')?.addEventListener('change', (e) => {
            this.handleTourSelection(e.target.value);
        });
        
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
        forms.forEach(formId => {
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
            error: '<span class="badge bg-danger"><i class="ti ti-alert-circle me-1"></i>Error al guardar</span>'
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
        if (dayId && this.days.find(d => d.id === dayId)) {
            const day = this.days.find(d => d.id === dayId);
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
                    const lastDate = new Date(lastDay.date + 'T00:00:00');
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
                const dayIndex = this.days.findIndex(d => d.id === this.currentDayId);
                if (dayIndex !== -1) {
                    this.days[dayIndex] = {
                        ...this.days[dayIndex],
                        title,
                        date,
                        description
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
                    services: []
                };
                this.days.push(newDay);
            }
            
            console.log('Attempting to save day:', {
                daysCount: this.days.length,
                days: this.days,
                quoteId: this.quoteId
            });
            
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
                quoteId: this.quoteId
            });
            this.showModalAlert('dayModalAlert', `Error al guardar el día: ${error.message}`, 'danger');
        }
    }

    deleteDay(dayId) {
        this.currentDayId = dayId;
        const day = this.days.find(d => d.id === dayId);
        
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
        
        // Reset or populate form
        if (serviceId && this.services.has(serviceId)) {
            const service = this.services.get(serviceId);
            document.getElementById('serviceModalLabel').innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Servicio';
            this.populateServiceForm(service);
        } else {
            document.getElementById('serviceModalLabel').innerHTML = '<i class="ti ti-plus-circle me-2"></i>Agregar Servicio';
            form.reset();
            this.handleServiceTypeChange('experience'); // Default to experience
        }
        
        modal.show();
    }

    handleServiceTypeChange(type) {
        // Save current service type fields before switching
        this.saveCurrentServiceTypeFields();
        
        // Hide all content sections
        document.querySelectorAll('.service-content').forEach(content => {
            content.classList.add('d-none');
        });
        
        // Show/hide transport-specific selectors
        const transportTypeSelector = document.getElementById('transportTypeSelector');
        const tripTypeSelector = document.getElementById('tripTypeSelector');
        
        if (type === 'transport') {
            transportTypeSelector?.classList.remove('d-none');
            tripTypeSelector?.classList.remove('d-none');
            // Initialize transport form based on current selections
            this.handleTransportTypeChange();
            this.handleTripTypeChange();
        } else {
            transportTypeSelector?.classList.add('d-none');
            tripTypeSelector?.classList.add('d-none');
        }
        
        // Show/hide category, vehicle and guide fields based on service type
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
        
        if (type === 'concepto' || type === 'experience') {
            // Hide category, vehicle and guide for Concepto and Experience
            categoryField?.classList.add('d-none');
            vehicleField?.classList.add('d-none');
            guideField?.classList.add('d-none');
            
            // Remove required from category for both, but handle price differently
            document.getElementById('transportCategory')?.removeAttribute('required');
            
            if (type === 'concepto') {
                // Price, currency and price type are optional for Concepto
                priceField?.removeAttribute('required');
                currencyField?.removeAttribute('required');
                priceTypeField?.removeAttribute('required');
                
                // Update labels to remove asterisk
                if (priceLabel) {
                    priceLabel.innerHTML = 'Precio Unitario';
                }
                if (currencyLabel) {
                    currencyLabel.innerHTML = 'Moneda';
                }
                if (priceTypeLabel) {
                    priceTypeLabel.innerHTML = 'Pago';
                }
            } else {
                // Price, currency and price type are required for Experience
                priceField?.setAttribute('required', 'required');
                currencyField?.setAttribute('required', 'required');
                priceTypeField?.setAttribute('required', 'required');
                
                // Update labels to add asterisk
                if (priceLabel) {
                    priceLabel.innerHTML = 'Precio Unitario <span class="text-danger">*</span>';
                }
                if (currencyLabel) {
                    currencyLabel.innerHTML = 'Moneda <span class="text-danger">*</span>';
                }
                if (priceTypeLabel) {
                    priceTypeLabel.innerHTML = 'Pago <span class="text-danger">*</span>';
                }
            }
        } else if (type === 'tour') {
            // Show all fields for Tour with combined guide + driver checkbox
            categoryField?.classList.remove('d-none');
            vehicleField?.classList.remove('d-none');
            guideField?.classList.remove('d-none');
            
            // Change title and checkbox label for Tour
            if (serviciosLabel) {
                serviciosLabel.textContent = 'Opcional';
            }
            if (guideLabel) {
                guideLabel.textContent = 'Guía + Chofer';
            }
            
            // Restore required to category, price, currency and price type
            document.getElementById('transportCategory')?.setAttribute('required', 'required');
            priceField?.setAttribute('required', 'required');
            currencyField?.setAttribute('required', 'required');
            priceTypeField?.setAttribute('required', 'required');
            
            // Update labels to add asterisk
            if (priceLabel) {
                priceLabel.innerHTML = 'Precio Unitario <span class="text-danger">*</span>';
            }
            if (currencyLabel) {
                currencyLabel.innerHTML = 'Moneda <span class="text-danger">*</span>';
            }
            if (priceTypeLabel) {
                priceTypeLabel.innerHTML = 'Pago <span class="text-danger">*</span>';
            }
        } else {
            // Show category, vehicle and guide for Transport only
            categoryField?.classList.remove('d-none');
            vehicleField?.classList.remove('d-none');
            guideField?.classList.remove('d-none');
            
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
                priceLabel.innerHTML = 'Precio Unitario <span class="text-danger">*</span>';
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
            'experience': 'experienceContent',
            'tour': 'tourContent',
            'transport': 'transportContent',
            'concepto': 'conceptoContent'
        };
        
        const contentId = contentMap[type];
        if (contentId) {
            document.getElementById(contentId)?.classList.remove('d-none');
        }
        
        // Update current service type and restore fields for the new type
        this.currentServiceType = type;
        this.restoreServiceTypeFields(type);
    }
    
    // Save current form values for the current service type
    saveCurrentServiceTypeFields() {
        if (!this.currentServiceType) return;
        
        const formData = {};
        
        // Common fields across all service types
        const commonFields = [
            'servicePrice', 'currencySelect', 'priceTypeSelect', 'serviceDescription',
            'internalNotes', 'clientNotes', 'providerNotes', 'teamNotes'
        ];
        
        // Service type specific fields
        const serviceSpecificFields = {
            experience: ['experienceSelect', 'experienceCategory'],
            tour: ['tourSelect', 'tourCategory', 'transportCategory', 'vehicleSelect', 'includeGuide'],
            transport: ['transportCategory', 'vehicleSelect', 'includeGuide'],
            concepto: ['conceptoDescription']
        };
        
        // Save common fields
        commonFields.forEach(fieldId => {
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
        specificFields.forEach(fieldId => {
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
        Object.keys(savedFields).forEach(fieldId => {
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
    
    handleTransportTypeChange() {
        const transportType = document.querySelector('input[name="transportType"]:checked')?.value;
        const flightDetailsSection = document.getElementById('flightDetailsSection');
        const roundTripFlightDetailsIda = document.querySelector('.roundtrip-flight-details-ida');
        const roundTripFlightDetailsVuelta = document.querySelector('.roundtrip-flight-details-vuelta');
        const tripType = document.querySelector('input[name="tripType"]:checked')?.value;
        
        // Round trip fields (updated for correct logic)
        const roundTripOriginIdaSelect = document.getElementById('roundTripOriginIdaSelect');
        const roundTripDestinationVueltaSelect = document.getElementById('roundTripDestinationVueltaSelect');
        
        // Show flight details only for airport transport
        if (transportType === 'aeropuerto') {
            if (tripType === 'roundtrip' || tripType === 'round-trip') {
                // Show flight details for both Ida and Vuelta
                roundTripFlightDetailsIda?.classList.remove('d-none');
                roundTripFlightDetailsVuelta?.classList.remove('d-none');
                
                // Airport transport is already configured correctly in HTML:
                // - Arrival (Ida): Origin = dropdown, Destination = text
                // - Departure (Vuelta): Origin = text, Destination = dropdown
            } else {
                flightDetailsSection?.classList.remove('d-none');
            }
        } else {
            // Hide all airport-related fields
            flightDetailsSection?.classList.add('d-none');
            roundTripFlightDetailsIda?.classList.add('d-none');
            roundTripFlightDetailsVuelta?.classList.add('d-none');
        }
    }
    
    handleTripTypeChange() {
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
        const directionType = document.querySelector('input[name="directionType"]:checked')?.value;
        
        // Get all field elements
        const originSelect = document.getElementById('transportOriginSelect');
        const originText = document.getElementById('transportOriginText');
        const destinationText = document.getElementById('transportDestinationText');
        const destinationSelect = document.getElementById('transportDestinationSelect');
        
        // Get time label element
        const timeLabel = document.querySelector('label[for="flightTime"]');
        
        if (directionType === 'arrival') {
            // Arrival: Origin is dropdown, Destination is text
            originSelect?.classList.remove('d-none');
            originText?.classList.add('d-none');
            destinationText?.classList.remove('d-none');
            destinationSelect?.classList.add('d-none');
            
            // Update required attributes
            originSelect?.setAttribute('required', 'required');
            originText?.removeAttribute('required');
            destinationText?.setAttribute('required', 'required');
            destinationSelect?.removeAttribute('required');
            
            // Update time label for Arrival
            if (timeLabel) {
                timeLabel.textContent = 'Hora de Llegada';
            }
        } else if (directionType === 'departure') {
            // Departure: Origin is text, Destination is dropdown
            originSelect?.classList.add('d-none');
            originText?.classList.remove('d-none');
            destinationText?.classList.add('d-none');
            destinationSelect?.classList.remove('d-none');
            
            // Update required attributes
            originText?.setAttribute('required', 'required');
            originSelect?.removeAttribute('required');
            destinationSelect?.setAttribute('required', 'required');
            destinationText?.removeAttribute('required');
            
            // Update time label for Departure
            if (timeLabel) {
                timeLabel.textContent = 'Hora de Salida';
            }
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
                this.services.set(this.currentServiceId, {
                    ...this.services.get(this.currentServiceId),
                    ...serviceData
                });
            } else {
                // Add new service
                const newServiceId = this.generateId('service');
                this.services.set(newServiceId, {
                    id: newServiceId,
                    dayId: this.currentDayId,
                    ...serviceData
                });
                
                // Add service to day
                const day = this.days.find(d => d.id === this.currentDayId);
                if (day) {
                    day.services.push(newServiceId);
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
        const data = {
            type,
            vehicleId: document.getElementById('vehicleSelect')?.value,
            price: parseFloat(document.getElementById('servicePrice')?.value || 0),
            quantity: parseInt(document.getElementById('serviceQuantity')?.value || 1),
            notes: document.getElementById('serviceNotes')?.value
        };
        
        // Collect type-specific data
        switch (type) {
            case 'experience':
                data.experienceId = document.getElementById('experienceSelect')?.value;
                break;
            case 'tour':
                data.tourId = document.getElementById('tourSelect')?.value;
                break;
            case 'transport':
                data.transportType = document.querySelector('input[name="transportType"]:checked')?.value;
                data.tripType = document.querySelector('input[name="tripType"]:checked')?.value;
                data.directionType = document.querySelector('input[name="directionType"]:checked')?.value;
                data.origin = document.getElementById('transportOrigin')?.value;
                data.destination = document.getElementById('transportDestination')?.value;
                data.category = document.getElementById('transportCategory')?.value;
                data.persons = parseInt(document.getElementById('transportPersons')?.value || 1);
                
                // Flight details (if airport transport)
                if (data.transportType === 'aeropuerto') {
                    data.flightNumber = document.getElementById('flightNumber')?.value;
                    data.flightTime = document.getElementById('flightTime')?.value;
                    data.airline = document.getElementById('airline')?.value;
                }
                
                // Generate concept based on selection
                const origins = {
                    'cancun': 'Cancún',
                    'playa-del-carmen': 'Playa del Carmen',
                    'tulum': 'Tulum',
                    'cozumel': 'Cozumel',
                    'merida': 'Mérida',
                    'chichen-itza': 'Chichén Itzá'
                };
                
                const transportTypes = {
                    'aeropuerto': 'Aeropuerto',
                    'punto-a-punto': 'Punto a Punto',
                    'local': 'Local'
                };
                
                // Generate concept with origin and destination
                const originName = origins[data.origin] || 'Origen';
                const destinationName = data.destination || 'Destino';
                data.concept = `${transportTypes[data.transportType] || 'Transporte'}: ${originName} - ${destinationName}`;
                break;
            case 'concepto':
                data.concept = document.getElementById('conceptoConcept')?.value;
                break;
        }
        
        return data;
    }

    validateServiceData(data) {
        if (!data.type) {
            this.showModalAlert('serviceModalAlert', 'Por favor selecciona un tipo de servicio', 'warning');
            return false;
        }
        
        if (data.type !== 'concepto' && data.price <= 0) {
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

        // Populate common fields
        document.getElementById('transportCategory').value = service.category || '';
        document.getElementById('vehicleSelect').value = service.vehicleId || '';
        document.getElementById('servicePrice').value = service.price || 0;
        document.getElementById('serviceQuantity').value = service.quantity || 1;
        document.getElementById('serviceNotes').value = service.notes || '';
        document.getElementById('currencySelect').value = service.currency || 'MXN';
        document.getElementById('priceTypeSelect').value = service.priceType || 'efectivo';
        
        // Handle guide/driver checkbox
        const includeGuideCheckbox = document.getElementById('includeGuide');
        if (includeGuideCheckbox) {
            includeGuideCheckbox.checked = service.includeGuide || false;
        }

        // Type-specific population
        switch (service.type) {
            case 'experience':
                const experienceSelect = document.getElementById('experienceSelect');
                if (experienceSelect && service.experienceId) {
                    experienceSelect.value = service.experienceId;
                }
                break;
                
            case 'tour':
                const tourSelect = document.getElementById('tourSelect');
                if (tourSelect && service.tourId) {
                    tourSelect.value = service.tourId;
                }
                break;
                
            case 'transport':
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
                    document.getElementById('roundTripDestinationVueltaSelect').value = service.returnDestination || '';
                    document.getElementById('roundTripDateVuelta').value = service.endDate || '';
                    document.getElementById('roundTripTimeVuelta').value = service.endTime || '';
                    document.getElementById('roundTripPersons').value = service.persons || 1;
                    
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
                    
                    document.getElementById('transportOriginSelect').value = service.origin || '';
                    document.getElementById('transportOriginText').value = service.origin || '';
                    document.getElementById('transportDestinationText').value = service.destination || '';
                    document.getElementById('transportDestinationSelect').value = service.destination || '';
                    document.getElementById('transportPersons').value = service.persons || 1;
                    
                    // Flight details
                    if (service.airline) {
                        document.getElementById('airline').value = service.airline;
                        document.getElementById('flightNumber').value = service.flightNumber || '';
                        document.getElementById('flightTime').value = service.startTime || '';
                    }
                }
                break;
                
            case 'concepto':
                document.getElementById('conceptoConcept').value = service.concept || '';
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
        
        container.innerHTML = this.days.map(day => `
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
        
        container.innerHTML = this.days.map(day => this.renderDayCard(day)).join('');
        
        // Attach event listeners to dynamic elements
        this.attachDayEventListeners();
        
        // Setup drag and drop for main content
        this.setupContentDragAndDrop(container);
    }

    renderDayCard(day) {
        const services = day.services.map(sid => this.services.get(sid)).filter(Boolean);
        const dayTotal = services.reduce((sum, service) => sum + (service.price * service.quantity), 0);
        
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
                            ${services.map(service => this.renderServiceItem(service)).join('')}
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
                    </div>
                </div>
            </div>
        `;
    }

    renderServiceItem(service) {
        const typeIcons = {
            experience: 'beach',
            tour: 'map-2',
            transport: 'car',
            hotel: 'building',
            food: 'tools-kitchen-2',
            other: 'dots'
        };
        
        const typeLabels = {
            experience: 'Experiencia',
            tour: 'Tour',
            transport: 'Transporte',
            concepto: 'Concepto'
        };
        
        return `
            <div class="service-item mb-3 p-3 border rounded hover-shadow" data-service-id="${service.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-start mb-2">
                            <i class="ti ti-${typeIcons[service.type]} text-primary me-2"></i>
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center mb-1">
                                    <span class="badge bg-light text-dark me-2">${typeLabels[service.type]}</span>
                                    <h6 class="mb-0 service-title">${this.getServiceTitle(service)}</h6>
                                </div>
                                <div class="service-details">
                                    <div class="row g-2 text-muted small">
                                        ${service.startTime ? `
                                            <div class="col-auto">
                                                <i class="ti ti-clock me-1"></i>
                                                ${service.startTime}${service.endTime ? ` - ${service.endTime}` : ''}
                                            </div>
                                        ` : ''}
                                        ${service.vehicleId ? `
                                            <div class="col-auto">
                                                <i class="ti ti-car me-1"></i>
                                                ${this.getVehicleName(service.vehicleId)}
                                            </div>
                                        ` : ''}
                                        ${service.quantity > 1 ? `
                                            <div class="col-auto">
                                                <i class="ti ti-x me-1"></i>${service.quantity}
                                            </div>
                                        ` : ''}
                                    </div>
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
                        <div class="fw-semibold text-primary">
                            ${this.formatCurrency(service.price)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Utility Methods
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    }

    formatDate(dateString) {
        if (!dateString) return '';
        
        // Handle date string properly to avoid timezone issues
        // If it's in YYYY-MM-DD format, parse it as local date
        if (dateString.includes('-') && dateString.length === 10) {
            const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
            const date = new Date(year, month - 1, day); // month is 0-based
            return date.toLocaleDateString('es-MX', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }
        
        // Fallback for other date formats
        const date = new Date(dateString);
        return date.toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
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
            year: 'numeric'
        });
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substr(0, maxLength) + '...';
    }

    getServiceTitle(service) {
        switch (service.type) {
            case 'experience':
                return this.getExperienceName(service.experienceId) || 'Experiencia';
            case 'tour':
                return this.getTourName(service.tourId) || 'Tour';
            case 'transport':
            case 'concepto':
                return service.concept || 'Servicio';
            default:
                return 'Servicio';
        }
    }

    getVehicleName(vehicleId) {
        const vehicle = this.vehiclesCache?.find(v => v.objectId === vehicleId);
        return vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Vehículo';
    }

    getExperienceName(experienceId) {
        // Implementation depends on your data structure
        return 'Experiencia'; // Placeholder
    }

    getTourName(tourId) {
        // Implementation depends on your data structure
        return 'Tour'; // Placeholder
    }

    scrollToDay(dayId) {
        const element = document.getElementById(`day-${dayId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // Update active state in sidebar
            document.querySelectorAll('.day-nav-item').forEach(item => {
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
        let subtotal = 0;
        
        this.days.forEach(day => {
            day.services.forEach(serviceId => {
                const service = this.services.get(serviceId);
                if (service) {
                    subtotal += service.price * service.quantity;
                }
            });
        });
        
        const iva = subtotal * 0.16;
        const total = subtotal + iva;
        const passengers = parseInt(localStorage.getItem(`quote_${this.quoteId}_passengers`) || '0');
        const perPerson = passengers > 0 ? total / passengers : 0;
        
        // Update displays
        document.getElementById('subtotalAmount').textContent = `${this.formatCurrency(subtotal)}`;
        document.getElementById('ivaAmount').textContent = `${this.formatCurrency(iva)}`;
        document.getElementById('totalAmount').textContent = `${this.formatCurrency(total)}`;
        document.getElementById('perPersonAmount').textContent = `${this.formatCurrency(perPerson)}`;
        document.getElementById('personCount').textContent = `(${passengers} personas)`;
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
        ['dayModal', 'serviceModal', 'deleteConfirmModal', 'previewModal'].forEach(modalId => {
            this.closeModal(modalId);
        });
    }

    initializeTooltips() {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            
            if (response.ok) {
                const result = await response.json();
                
                if (result.success && result.data) {
                    console.log('✅ Quote data loaded successfully');
                    
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
                number: day.dayNumber || index + 1,  // Use dayNumber from backend
                title: day.dayTitle || day.title || `Día ${index + 1}`,  // Use dayTitle from backend
                date: day.date || null,
                description: day.description || '',
                services: []
            };
            
            // Process subconcepts as services
            if (day.subconcepts && Array.isArray(day.subconcepts)) {
                day.subconcepts.forEach(subconcept => {
                    const serviceId = subconcept.id || this.generateId('service');
                    this.services.set(serviceId, {
                        id: serviceId,
                        dayId: dayData.id,
                        type: subconcept.type || 'other',
                        concept: subconcept.concept,
                        startTime: subconcept.time || subconcept.startTime,  // Backend sends 'time'
                        endTime: subconcept.endTime,
                        vehicleId: subconcept.vehicleId,
                        price: subconcept.unitPrice || 0,
                        quantity: subconcept.quantity || 1,
                        notes: subconcept.notes || '',
                        experienceId: subconcept.experienceId,
                        tourId: subconcept.tourId,
                        hotelName: subconcept.hotelName,
                        checkIn: subconcept.checkIn,
                        checkOut: subconcept.checkOut
                    });
                    dayData.services.push(serviceId);
                });
            }
            
            this.days.push(dayData);
        });
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.ratesCache = result.data;
                } else if (Array.isArray(result)) {
                    this.ratesCache = result;
                }
                console.log('✅ Rates loaded:', this.ratesCache?.length || 0);
            } else {
                console.warn(`Rates API returned ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading rates:', error);
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Handle DataTables format response
                if (result.data && Array.isArray(result.data)) {
                    this.experiencesCache.set('all', result.data);
                    console.log('✅ Experiences loaded (DataTables format):', result.data.length);
                } else if (result.success && result.data) {
                    this.experiencesCache.set('all', result.data);
                    console.log('✅ Experiences loaded (standard format):', result.data.length);
                } else if (Array.isArray(result)) {
                    this.experiencesCache.set('all', result);
                    console.log('✅ Experiences loaded (array format):', result.length);
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
            const response = await fetch('/api/tours?draw=1&start=0&length=1000&search[value]=', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.data && Array.isArray(result.data)) {
                    this.toursCache.set('all', result.data);
                    console.log('✅ Tours loaded:', result.data.length);
                } else if (result.success && result.data) {
                    this.toursCache.set('all', result.data);
                    console.log('✅ Tours loaded:', result.data.length);
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
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
                console.log('✅ Provider experiences loaded:', this.providerExperiencesCache?.length || 0);
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.agencyRateCache = result.data;
                }
                console.log('✅ Agency rate loaded:', this.agencyRateCache);
            } else {
                console.warn(`Agency rate API returned ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading agency rate:', error);
        }
    }

    async loadDriverTourRate() {
        try {
            const accessToken = this.getAccessToken();
            if (!accessToken) {
                console.warn('No access token found, skipping driver tour rate load');
                return;
            }
            
            const response = await fetch('/api/driver-tour-rate/current', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.driverTourRateCache = result.data;
                }
                console.log('✅ Driver tour rate loaded:', this.driverTourRateCache);
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
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.guideTransportRateCache = result.data;
                }
                console.log('✅ Guide transport rate loaded:', this.guideTransportRateCache);
            } else if (response.status === 404) {
                console.log('ℹ️ Guide transport rate endpoint not available yet');
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
            
            const response = await fetch('/api/transfer-rates/current', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    this.transferRateCache = result.data;
                }
                console.log('✅ Transfer rate loaded:', this.transferRateCache);
            } else if (response.status === 404) {
                console.log('ℹ️ Transfer rate endpoint not available yet');
                this.transferRateCache = null;
            } else {
                console.warn(`Transfer rate API returned ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading transfer rate:', error);
            this.transferRateCache = null;
        }
    }

    async loadClientSpecificPricing() {
        if (!this.clientId) {
            console.log('No client ID available, skipping client-specific pricing');
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
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
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
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
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
            console.log('✅ Client-specific pricing loaded - Services:', this.clientPricesCache.size, 'Tours:', this.clientTourPricesCache.size);
            
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
                    console.log('🔄 Client changed, reloading pricing for:', this.clientId);
                    
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
                    console.log('🔄 Client changed via TomSelect, reloading pricing for:', this.clientId);
                    
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
                selectedExperience = experiences.find(exp => exp.id === experienceId || exp.objectId === experienceId);
            }
            
            // Check provider experiences cache if not found
            if (!selectedExperience && this.providerExperiencesCache) {
                selectedExperience = this.providerExperiencesCache.find(exp => exp.id === experienceId || exp.objectId === experienceId);
            }
            
            if (selectedExperience) {
                
                // Get client-specific price for this experience
                const price = this.getPriceForService(experienceId, null) || selectedExperience.price || 0;
                
                // Update the price field
                document.getElementById('servicePrice').value = price;
                
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
    
    handleTourSelection(tourId) {
        if (!tourId) {
            // Clear price and details when no tour is selected
            document.getElementById('servicePrice').value = 0;
            this.clearTourDetails();
            return;
        }
        
        try {
            // Find the selected tour from cache
            let selectedTour = null;
            
            if (this.toursCache.has('all')) {
                const tours = this.toursCache.get('all');
                selectedTour = tours.find(tour => tour.id === tourId || tour.objectId === tourId);
            }
            
            if (selectedTour) {
                // Get client-specific tour price
                const price = this.getPriceForTour(tourId, null) || selectedTour.price || 0;
                
                // Update the price field
                document.getElementById('servicePrice').value = price;
                
                // Show tour details
                this.showTourDetails(selectedTour);
                
            } else {
                console.warn('Tour not found in cache:', tourId);
                document.getElementById('servicePrice').value = 0;
                this.clearTourDetails();
            }
            
        } catch (error) {
            console.error('Error handling tour selection:', error);
            document.getElementById('servicePrice').value = 0;
            this.clearTourDetails();
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
            
            
            Object.keys(experience).forEach(key => {
                const value = experience[key];
                
                // Show EVERYTHING including empty/null fields (except Parse internals)
                if (!['__type', 'className'].includes(key)) {
                    
                    // Format field name for display
                    const displayKey = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, str => str.toUpperCase())
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
                                const arrayItems = value.map(item => {
                                    if (typeof item === 'object' && item !== null) {
                                        if (item.objectId) {
                                            // Parse Pointer in array
                                            return `${item.objectId}${item.name ? ` (${item.name})` : ''}`;
                                        } else {
                                            // Generic object in array - show key properties
                                            const keys = Object.keys(item);
                                            if (keys.length <= 3) {
                                                return JSON.stringify(item);
                                            } else {
                                                // Show first few properties for readability
                                                const preview = {};
                                                keys.slice(0, 3).forEach(k => preview[k] = item[k]);
                                                return `${JSON.stringify(preview)}...`;
                                            }
                                        }
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
                        if (key.toLowerCase().includes('price') || 
                            key.toLowerCase().includes('cost') || 
                            key.toLowerCase().includes('rate') ||
                            key.toLowerCase().includes('tarifa') ||
                            key.toLowerCase().includes('precio') ||
                            key.toLowerCase().includes('fee') ||
                            key.toLowerCase().includes('commission')) {
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
                        key: key,
                        display: `<div class="${fieldClass}"><strong>${displayKey}:</strong> ${displayValue}</div>`,
                        priority: this.getFieldPriority(key),
                        isEmpty: value === null || value === undefined || value === ''
                    });
                }
            });
            
            // Sort fields by priority for better organization
            allFields.sort((a, b) => a.priority - b.priority);
            
            if (allFields.length === 0) {
                allFields.push({display: '<small class="text-muted">No details available</small>', priority: 999});
            }
            
            // Count field types for comprehensive analysis
            const fieldStats = {
                total: allFields.length,
                withData: allFields.filter(f => !f.isEmpty).length,
                empty: allFields.filter(f => f.isEmpty).length,
                pricing: allFields.filter(f => f.key.toLowerCase().includes('price') || f.key.toLowerCase().includes('precio') || f.key.toLowerCase().includes('cost')).length
            };
            
            detailsContainer.innerHTML = `
                <div class="alert alert-warning border-warning">
                    <h6><i class="ti ti-database"></i> ${experience.title || experience.name || 'Experience'} ${devIndicator}</h6>
                    <div class="text-warning-emphasis mb-2">
                        <small><strong>Experience Details</strong> (${fieldStats.total} fields)</small>
                    </div>
                    <div class="row">
                        <div class="col-12" style="max-height: 500px; overflow-y: auto; border: 2px solid #ffc107; border-radius: 0.375rem; padding: 0.75rem; background-color: #fffbf0;">
                            ${allFields.map(field => `<div class="mb-1"><small>${field.display}</small></div>`).join('')}
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
            'title': 1, 'name': 2, 'id': 3, 'objectId': 4, 'type': 5,
            
            // Pricing fields (high priority) - using CORRECT database field names
            'price': 10, 'precio': 11, 'cost': 12, 'rate': 13, 'tarifa': 14, 'fee': 15,
            'basePrice': 16, 'unitPrice': 17, 'totalPrice': 18, 'commission': 19,
            'price_child': 7, 'price_no_alcohol': 8, 'adultPrice': 9, 
            'seniorPrice': 9, 'precioAdulto': 9, 'precioSenior': 9,
            
            // Core info
            'description': 20, 'duration': 21, 'location': 22, 'category': 23,
            
            // Languages and communication
            'languages': 30, 'idiomas': 31, 'language': 32,
            
            // Includes/Excludes - using CORRECT database field names
            'includes': 35, 'notincludes': 40,
            'incluye': 36, 'include': 37, 'incluido': 38,
            'excludes': 41, 'excluye': 42, 'exclude': 43, 'noIncluye': 44, 'noincluye': 45, 'excluido': 46,
            
            // Capacity and participants
            'capacity': 50, 'minParticipants': 51, 'maxParticipants': 52,
            'minPeople': 53, 'maxPeople': 54, 'participants': 55,
            
            // Operational details - adding database field names
            'meetingPoint': 60, 'schedule': 61, 'difficulty': 62, 'requirements': 63,
            'ageRestrictions': 64, 'cancellationPolicy': 65,
            'travel_duration': 25, 'advance_booking_time': 26,
            
            // Notes fields
            'client_booking_notes': 27, 'provider_notes': 28, 'team_notes': 29, 'internal_notes': 29,
            
            // Status fields
            'active': 70, 'featured': 71, 'seasonal': 72, 'available': 73,
            
            // Provider info
            'provider': 80, 'proveedor': 81,
            
            // Dates
            'createdAt': 90, 'updatedAt': 91, 'availableFrom': 92, 'availableTo': 93,
            
            // Ratings and reviews
            'rating': 100, 'reviews': 101, 'reviewCount': 102
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
        // Show tour details in a dedicated area
        const detailsContainer = document.getElementById('tourDetails');
        if (detailsContainer) {
            detailsContainer.innerHTML = `
                <div class="alert alert-info">
                    <h6><i class="ti ti-info-circle"></i> ${tour.title}</h6>
                    ${tour.description ? `<p class="mb-1">${tour.description}</p>` : ''}
                    ${tour.duration ? `<small class="text-muted">Duración: ${tour.duration}</small>` : ''}
                    ${tour.location ? `<small class="text-muted d-block">Ubicación: ${tour.location}</small>` : ''}
                </div>
            `;
        }
    }
    
    clearExperienceDetails() {
        const detailsContainer = document.getElementById('experienceDetails');
        if (detailsContainer) {
            detailsContainer.innerHTML = '';
        }
    }
    
    clearTourDetails() {
        const detailsContainer = document.getElementById('tourDetails');
        if (detailsContainer) {
            detailsContainer.innerHTML = '';
        }
    }

    getPriceForService(serviceId, rateId) {
        // Check if client-specific price exists first
        if (this.clientPricesCache.has(serviceId)) {
            const clientPrices = this.clientPricesCache.get(serviceId);
            const clientPrice = clientPrices.find(price => price.rate.id === rateId);
            if (clientPrice) {
                console.log(`💰 Using client-specific price for service ${serviceId}:`, clientPrice.finalPrice);
                return clientPrice.finalPrice;
            }
        }
        
        // Fallback to base RatePrice
        // This would need to be implemented based on your RatePrices structure
        console.log(`💰 Using base rate price for service ${serviceId}`);
        return 0; // TODO: Implement base rate price lookup
    }

    getPriceForTour(tourId, rateId) {
        // Check if client-specific tour price exists first
        if (this.clientTourPricesCache.has(tourId)) {
            const clientTourPrices = this.clientTourPricesCache.get(tourId);
            const clientPrice = clientTourPrices.find(price => price.rate.id === rateId);
            if (clientPrice) {
                console.log(`💰 Using client-specific tour price for tour ${tourId}:`, clientPrice.finalPrice);
                return clientPrice.finalPrice;
            }
        }
        
        // Fallback to base TourPrice
        // This would need to be implemented based on your TourPrices structure
        console.log(`💰 Using base tour price for tour ${tourId}`);
        return 0; // TODO: Implement base tour price lookup
    }

    async loadDayExperiences(dayId) {
        const experienceSelect = document.getElementById('experienceSelect');
        if (!experienceSelect) return;
        
        // Clear existing options except the first placeholder
        experienceSelect.innerHTML = '<option value="">-- Selecciona una experiencia --</option>';
        
        try {
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
                        
                        if (id && title && isExperience) {
                            allExperiences.push({
                                id: id,
                                title: title,
                                type: 'experience',
                                provider: exp.provider || null,
                                description: exp.description || '',
                                duration: exp.duration || '',
                                location: exp.location || '',
                                price: exp.price || 0
                            });
                        }
                    });
                }
            }
            
            // Add provider experiences from ProviderExperiencia table
            if (this.providerExperiencesCache && Array.isArray(this.providerExperiencesCache)) {
                const validProviderExperiences = this.providerExperiencesCache.filter(exp => {
                    const hasId = exp && (exp.id || exp.objectId);
                    const hasTitle = exp && (exp.title || exp.name || exp.experienceName);
                    
                    // Check if provider experience is active and has valid provider pointer
                    const isActive = exp.active !== false; // Default to true if not specified
                    const hasValidProvider = exp.provider && 
                                           exp.provider.active !== false && 
                                           exp.provider.exists !== false;
                    
                    
                    return hasId && hasTitle && isActive && hasValidProvider;
                });
                const mappedProviderExperiences = validProviderExperiences.map(provExp => ({
                    id: provExp.id || provExp.objectId,
                    title: provExp.title || provExp.name || provExp.experienceName,
                    type: 'provider_experience',
                    provider: provExp.provider || null,
                    description: provExp.description || '',
                    duration: provExp.duration || '',
                    location: provExp.location || '',
                    price: provExp.price || 0
                }));
                
                allExperiences.push(...mappedProviderExperiences);
            }
            
            
            // Sort experiences alphabetically by title
            allExperiences.sort((a, b) => a.title.localeCompare(b.title));
            
            // Add all experiences directly without provider grouping
            allExperiences.forEach(exp => {
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
                    displayTitle = exp.provider?.name ? 
                        `${exp.title} (${exp.provider.name})` : 
                        exp.title;
                    
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
            
            console.log(`✅ Loaded ${allExperiences.length} total experiences into dropdown`);
            
        } catch (error) {
            console.error('Error loading experiences into dropdown:', error);
            this.showModalAlert('serviceModalAlert', 'Error cargando experiencias', 'warning');
        }
    }

    async loadDayTours(dayId) {
        const tourSelect = document.getElementById('tourSelect');
        if (!tourSelect) return;
        
        // Clear existing options except the first placeholder
        tourSelect.innerHTML = '<option value="">-- Selecciona un tour --</option>';
        
        try {
            // Add tours from cache
            if (this.toursCache.has('all')) {
                const tours = this.toursCache.get('all');
                
                // Filter and sort tours alphabetically by title (with null checks)
                const validTours = tours.filter(tour => tour && tour.title && tour.id);
                validTours.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                
                validTours.forEach(tour => {
                    const option = document.createElement('option');
                    option.value = tour.id;
                    option.textContent = tour.title;
                    tourSelect.appendChild(option);
                });
                
                console.log(`✅ Loaded ${validTours.length} tours into dropdown`);
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
                const subconcepts = day.services.map(serviceId => {
                    const service = this.services.get(serviceId);
                    if (!service) return null;
                    
                    const serviceTotal = (service.price || 0) * (service.quantity || 1);
                    dayTotal += serviceTotal;
                    
                    return {
                        type: service.type || 'regular',
                        concept: this.getServiceTitle(service),
                        time: service.startTime || null,  // Backend expects 'time' not 'startTime'
                        endTime: service.endTime || null,
                        vehicleId: service.vehicleId || null,
                        unitPrice: service.price || 0,
                        quantity: service.quantity || 1,
                        notes: service.notes || '',
                        hours: null,  // Add if needed
                        total: serviceTotal,
                        // Type-specific fields
                        experienceId: service.experienceId || null,
                        tourId: service.tourId || null,
                        hotelName: service.hotelName || null,
                        checkIn: service.checkIn || null,
                        checkOut: service.checkOut || null
                    };
                }).filter(Boolean);
                
                return {
                    dayNumber: index + 1,  // Backend expects dayNumber starting from 1
                    dayTitle: day.title || `Día ${index + 1}`,
                    date: day.date || null,
                    description: day.description || '',
                    subconcepts: subconcepts,
                    dayTotal: Math.round(dayTotal * 100) / 100  // Backend expects dayTotal for validation
                };
            }),
            subtotal: subtotal,
            iva: iva,
            total: total
        };
        
        console.log('Sending to backend:', {
            url: `/api/quotes/${this.quoteId}/service-items`,
            data: serviceItemsData
        });
        
        // Get access token from cookie
        const accessToken = this.getAccessToken();
        
        if (!accessToken) {
            console.error('No access token found in cookies');
            throw new Error('No access token found - please login again');
        }
        
        console.log('Access token found:', accessToken.substring(0, 20) + '...');
        
        const response = await fetch(`/api/quotes/${this.quoteId}/service-items`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(serviceItemsData)
        });
        
        console.log('Response status:', response.status);
        
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
                    errorMessage = errorData.error || 
                                 errorData.message || 
                                 errorData.msg ||
                                 (typeof errorData === 'string' ? errorData : errorMessage);
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
            console.log('Raw success response:', responseText);
            
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
        
        console.log('Save successful:', result);
        return result;
    }
    
    calculateSubtotal() {
        let subtotal = 0;
        this.days.forEach(day => {
            day.services.forEach(serviceId => {
                const service = this.services.get(serviceId);
                if (service) {
                    subtotal += (service.price || 0) * (service.quantity || 1);
                }
            });
        });
        return subtotal;
    }


    populateVehicleSelect() {
        const select = document.getElementById('vehicleSelect');
        if (!select || !this.vehiclesCache) return;
        
        select.innerHTML = '<option value="">-- Sin vehículo --</option>';
        this.vehiclesCache.forEach(vehicle => {
            select.innerHTML += `
                <option value="${vehicle.objectId}">
                    ${vehicle.brand} ${vehicle.model} - ${vehicle.type}
                </option>
            `;
        });
    }

    // Additional Methods for duplication and deletion
    duplicateDay(dayId) {
        const originalDay = this.days.find(d => d.id === dayId);
        if (!originalDay) return;
        
        const newDay = {
            ...originalDay,
            id: this.generateId('day'),
            number: this.days.length + 1,
            title: `${originalDay.title} (Copia)`,
            services: []
        };
        
        // Duplicate services
        originalDay.services.forEach(serviceId => {
            const originalService = this.services.get(serviceId);
            if (originalService) {
                const newServiceId = this.generateId('service');
                this.services.set(newServiceId, {
                    ...originalService,
                    id: newServiceId,
                    dayId: newDay.id
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
            id: newServiceId
        });
        
        // Add to the same day
        const day = this.days.find(d => d.id === originalService.dayId);
        if (day) {
            day.services.push(newServiceId);
        }
        
        this.saveToBackend();
        this.renderItinerary();
        this.showAlert('Servicio duplicado exitosamente', 'success');
    }

    deleteService(serviceId) {
        this.currentServiceId = serviceId;
        const service = this.services.get(serviceId);
        
        if (!service) return;
        
        const message = `¿Estás seguro de que deseas eliminar este servicio?`;
        document.getElementById('deleteConfirmMessage').textContent = message;
        
        const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
        modal.show();
    }

    confirmDelete() {
        if (this.currentDayId && !this.currentServiceId) {
            // Delete day
            this.days = this.days.filter(d => d.id !== this.currentDayId);
            
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
                const day = this.days.find(d => d.id === service.dayId);
                if (day) {
                    day.services = day.services.filter(sid => sid !== this.currentServiceId);
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
        
        this.days.forEach(day => {
            const services = day.services.map(sid => this.services.get(sid)).filter(Boolean);
            const dayTotal = services.reduce((sum, service) => sum + (service.price * service.quantity), 0);
            
            previewHtml += `
                <div class="preview-day mb-4">
                    <h4>Día ${day.number}: ${day.title}</h4>
                    ${day.date ? `<p class="text-muted">${this.formatDate(day.date)}</p>` : ''}
                    ${day.description ? `<p>${day.description}</p>` : ''}
                    
                    <div class="preview-services">
                        ${services.map(service => `
                            <div class="preview-service mb-2">
                                <strong>${this.getServiceTitle(service)}</strong>
                                ${service.startTime ? ` - ${service.startTime}` : ''}
                                <span class="float-end">${this.formatCurrency(service.price * service.quantity)}</span>
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
                    services: Array.from(this.services.values())
                })
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
        
        container.querySelectorAll('.day-nav-item').forEach(item => {
            // Click handler for navigation
            item.addEventListener('click', (e) => {
                // Only navigate if not dragging and not clicking grip handle
                if (!isDragging && !e.target.closest('.ti-grip-vertical')) {
                    const dayId = item.dataset.dayId;
                    this.scrollToDay(dayId);
                }
            });

            // Drag start
            item.addEventListener('dragstart', (e) => {
                const dayId = item.dataset.dayId;
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
                        const dropPosition = lastHoveredItem.dataset.dropPosition;
                        this.reorderDays(draggedDayId, targetDayId, dropPosition);
                    }
                }
                
                // Clear all drop positions
                container.querySelectorAll('[data-drop-position]').forEach(el => {
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
        
        container.querySelectorAll('.day-card').forEach(card => {
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
                
                const dayId = card.dataset.dayId;
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
                        const dropPosition = lastHoveredCard.dataset.dropPosition;
                        this.reorderDays(draggedDayId, targetDayId, dropPosition);
                    }
                }
                
                // Clear all drop positions
                container.querySelectorAll('[data-drop-position]').forEach(el => {
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
            const targetId = anyIndicator.dataset.targetId;
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
        
        const draggedIndex = this.days.findIndex(d => d.id === draggedDayId);
        const targetIndex = this.days.findIndex(d => d.id === targetDayId);
        
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
        const firstDayWithDate = this.days.find(d => d.date);
        
        if (firstDayWithDate) {
            startDate = new Date(firstDayWithDate.date + 'T00:00:00');
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
            const lastDate = new Date(lastDay.date + 'T00:00:00');
            const nextDate = new Date(lastDate);
            nextDate.setDate(lastDate.getDate() + 1);
            return nextDate.toISOString().split('T')[0];
        }
        
        return new Date().toISOString().split('T')[0];
    }

    fixDateSequence() {
        if (this.days.length === 0) return;
        
        console.log('🔧 Fixing date sequence for existing days');
        
        // Check if dates are already in proper sequence
        let needsFix = false;
        for (let i = 1; i < this.days.length; i++) {
            const prevDate = new Date(this.days[i-1].date || '2026-01-01');
            const currentDate = new Date(this.days[i].date || '2026-01-01');
            
            if (currentDate <= prevDate) {
                needsFix = true;
                break;
            }
        }
        
        if (needsFix) {
            console.log('📅 Date sequence needs fixing, updating...');
            this.updateDaySequence();
            
            // Save the corrected sequence
            this.saveToBackend();
            console.log('✅ Date sequence fixed and saved');
        } else {
            console.log('✅ Date sequence is already correct');
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
                } else {
                    if (targetElement.nextSibling) {
                        targetElement.parentNode.insertBefore(indicator, targetElement.nextSibling);
                    } else {
                        targetElement.parentNode.appendChild(indicator);
                    }
                }
            } catch (error) {
                console.debug('Could not insert indicator:', error);
            }
        });
    }

    clearDropIndicators(container) {
        const indicators = container.querySelectorAll('.drop-indicator');
        indicators.forEach(indicator => indicator.remove());
    }

    attachDayEventListeners() {
        const container = document.getElementById('daysContainer');
        if (!container) return;

        // Day action buttons
        container.querySelectorAll('.edit-day-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayId = btn.dataset.dayId;
                this.openDayModal(dayId);
            });
        });

        container.querySelectorAll('.duplicate-day-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayId = btn.dataset.dayId;
                this.duplicateDay(dayId);
            });
        });

        container.querySelectorAll('.delete-day-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayId = btn.dataset.dayId;
                this.deleteDay(dayId);
            });
        });

        // Add service buttons
        container.querySelectorAll('.add-service-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayId = btn.dataset.dayId;
                this.openServiceModal(dayId);
            });
        });

        // Service action buttons
        container.querySelectorAll('.edit-service-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayId = btn.dataset.dayId;
                const serviceId = btn.dataset.serviceId;
                this.openServiceModal(dayId, serviceId);
            });
        });

        container.querySelectorAll('.duplicate-service-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const serviceId = btn.dataset.serviceId;
                this.duplicateService(serviceId);
            });
        });

        container.querySelectorAll('.delete-service-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const serviceId = btn.dataset.serviceId;
                this.deleteService(serviceId);
            });
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const quoteIdElement = document.querySelector('[data-quote-id]');
    if (quoteIdElement) {
        const quoteId = quoteIdElement.dataset.quoteId;
        window.itineraryBuilder = new ItineraryBuilder(quoteId);
    }
});