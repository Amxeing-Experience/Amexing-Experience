/**
 * Quote Ownership & Collaboration Management
 * Handles ownership transfers, collaborator management, and edit history
 * Created by Denisse Maldonado
 */

// Dedup in-flight de GETs idénticos, COMPARTIDO por los módulos de la vista de cotización
// (este, el builder de servicios y la página). Varios piden /api/quotes/:id a la vez; esto
// colapsa esas cargas concurrentes en UN request. Se define aquí porque quote-ownership.js es
// el primer .js compartido por los 3 roles (admin, department_manager, client), así no se
// duplica en cada shell .ejs. Solo in-flight (se limpia al terminar) -> refetches posteriores
// siguen frescos. Cada consumidor recibe su propio clone() para conservar su .json()/.text().
window.amxDedupFetch = window.amxDedupFetch || (function () {
    const inflight = new Map();
    return function amxDedupFetch(url, opts) {
        const o = opts || {};
        const key = `${o.method || 'GET'}:${url}:${o.body || ''}`;
        if (!inflight.has(key)) {
            const p = fetch(url, o).finally(() => inflight.delete(key));
            inflight.set(key, p);
        }
        return inflight.get(key).then((r) => r.clone());
    };
})();

class QuoteOwnershipManager {
    constructor(quoteId) {
        this.quoteId = quoteId;
        this.currentUser = null;
        this.owner = null;
        this.agents = [];
        this.userAccess = null;
        this.pendingEdits = [];
        this.userCache = new Map(); // Cache for user lookups
        this.originalClientId = null; // Track the originally saved client ID
        this.clientWasJustChanged = false; // Flag to track if client was just changed
        this.clientChangeTimestamp = null; // Timestamp when client was changed
        this.deletedCollaboratorIds = new Set(); // Track collaborators deleted during client change
        this.savedQuoteData = null; // Store quote data for clientType checking
        this.dataLoaded = false; // Track when initial data loading is complete
        this.dataLoadingPromise = null; // Store the loading promise to await if needed

        // Store user role for filtering
        this.currentUserRole = window.currentUser?.role || window.userRole || '';
        console.log('[QuoteOwnershipManager] Initialized with user role:', this.currentUserRole);

        this.init();
    }

    /**
     * Check if the current form is in direct client mode
     * @returns {boolean} true if direct client mode is active
     */
    isDirectClientMode() {
        // First, check if we have saved quote data with clientType
        if (this.savedQuoteData && this.savedQuoteData.clientType === 'direct') {
            console.log('✅ Direct client mode detected from saved quote data:', this.savedQuoteData.clientType);
            return true;
        }

        // IMPORTANT: Also check if quote has companyClientPtr but no client (indicates direct client)
        if (this.savedQuoteData && this.savedQuoteData.companyClientPtr && !this.savedQuoteData.client) {
            console.log('✅ Direct client mode detected from data structure (has companyClientPtr, no client)');
            return true;
        }

        // Check if the direct client radio button is checked
        const directRadio = document.getElementById('clientTypeDirect');
        if (directRadio && directRadio.checked) {
            console.log('✅ Direct client mode detected from radio button');
            return true;
        }

        // Check if the direct client row is visible
        const directClientRow = document.getElementById('directClientRow');
        if (directClientRow && directClientRow.style.display !== 'none') {
            console.log('✅ Direct client mode detected from directClientRow visibility');
            return true;
        }

        // Check if the agency client row is hidden (indicates direct mode)
        const agencyClientRow = document.getElementById('agencyClientRow');
        if (agencyClientRow && agencyClientRow.style.display === 'none') {
            console.log('✅ Direct client mode detected from agencyClientRow hidden');
            return true;
        }

        console.log('❌ Not in direct client mode - all checks failed:', {
            savedQuoteData: this.savedQuoteData,
            clientType: this.savedQuoteData?.clientType,
            hasCompanyClientPtr: !!this.savedQuoteData?.companyClientPtr,
            hasClient: !!this.savedQuoteData?.client,
            directRadioChecked: directRadio?.checked,
            directClientRowDisplay: directClientRow?.style.display,
            agencyClientRowDisplay: agencyClientRow?.style.display
        });

        return false;
    }

    async init() {
        try {
            // Skip API calls for new quotes
            const isNewQuote = !this.quoteId || this.quoteId === 'new';

            if (isNewQuote) {
                console.log('New quote detected, skipping ownership/collaborator loading');
                // En una cotización nueva el propietario es el usuario actual (creador): pintar el
                // display compacto para no dejar los skeleton loaders girando indefinidamente.
                this.renderCurrentUserAsOwner();
                // Setup event listeners even for new quotes
                this.setupEventListeners();
                this.dataLoaded = true; // Mark as loaded for new quotes
                // Propietario inicial (solo admin/superadmin, cotización nueva): permitir elegir
                // quién será el propietario al crear.
                this._setupInitialOwnerSelector();
                return;
            }

            // Restore persisted client change state from sessionStorage
            const savedTimestamp = sessionStorage.getItem(`clientChangeTimestamp_${this.quoteId}`);
            const savedDeletedIds = sessionStorage.getItem(`deletedCollaborators_${this.quoteId}`);
            const wasChanged = sessionStorage.getItem(`clientChanged_${this.quoteId}`);

            if (savedTimestamp) {
                this.clientChangeTimestamp = parseInt(savedTimestamp);
                const timeSince = Date.now() - this.clientChangeTimestamp;
                console.log(`🔄 Restored client change state: ${timeSince}ms ago`);

                // If it's been more than 60 seconds, clear the persisted state
                if (timeSince > 60000) {
                    console.log('⏱️ Grace period expired, clearing persisted state');
                    sessionStorage.removeItem(`clientChangeTimestamp_${this.quoteId}`);
                    sessionStorage.removeItem(`deletedCollaborators_${this.quoteId}`);
                    sessionStorage.removeItem(`clientChanged_${this.quoteId}`);
                    this.clientChangeTimestamp = null;
                    this.deletedCollaboratorIds = new Set();
                } else {
                    // Still within grace period
                    if (savedDeletedIds) {
                        this.deletedCollaboratorIds = new Set(JSON.parse(savedDeletedIds));
                        console.log(`📋 Restored ${this.deletedCollaboratorIds.size} deleted collaborator IDs`);
                    }

                    // Set flag if client was just changed (useful for other logic)
                    this.clientWasJustChanged = wasChanged === 'true';
                }
            }

            // Load initial data
            this.dataLoadingPromise = Promise.all([
                this.loadOwnership(),
                this.loadQuoteData(),
                this.loadUserAccess(),
                this.loadAgents()
            ]);

            await this.dataLoadingPromise;
            this.dataLoaded = true;
            console.log('Initial data loading complete, dataLoaded:', this.dataLoaded);

            // Recalcular canTransfer y refrescar el display con userAccess YA cargado. En el
            // Promise.all, loadOwnership llama displayOwner antes de que loadUserAccess termine,
            // así que para un owner (no admin) canTransfer salía false y el botón "Cambiar" no
            // aparecía hasta abrir el modal. Este segundo displayOwner lo corrige.
            this.displayOwner();

            // Capture the originally saved client ID when page loads
            this.captureOriginalClient();

            // Setup event listeners
            this.setupEventListeners();

            // Check for pending edits if owner
            if (this.userAccess && this.userAccess.role === 'owner') {
                await this.loadPendingEdits();
            }
        } catch (error) {
            console.error('Error initializing ownership manager:', error);
            this.showError('Error al cargar información de propiedad');
        }
    }

    async loadOwnership() {
        try {
            console.log('Loading ownership data for quote:', this.quoteId);
            const response = await fetch(`/api/quotes/${this.quoteId}/ownership`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });


            if (response.ok) {
                const data = await response.json();
                console.log('Received ownership data:', data.data);
                this.owner = data.data;
                this.displayOwner();
                console.log('Owner data updated and displayed');
            } else {
                console.error('Failed to load ownership:', response.status);
            }
        } catch (error) {
            console.error('Error loading ownership:', error);
        }
    }

    async loadQuoteData() {
        try {
            console.log('📊 Loading quote data for clientType check:', this.quoteId);
            // Dedup in-flight: el builder y la página piden el mismo /api/quotes/:id a la vez;
            // se reusa el request en vuelo en lugar de duplicarlo (fallback a fetch si no está).
            const response = await (window.amxDedupFetch || fetch)(`/api/quotes/${this.quoteId}`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.savedQuoteData = data.data;
                console.log('📊 Quote data loaded successfully:', {
                    clientType: this.savedQuoteData?.clientType,
                    hasClient: !!this.savedQuoteData?.client,
                    hasCompanyClientPtr: !!this.savedQuoteData?.companyClientPtr,
                    fullData: this.savedQuoteData
                });
            } else {
                console.error('❌ Failed to load quote data:', response.status);
                const errorText = await response.text();
                console.error('Error response:', errorText);
            }
        } catch (error) {
            console.error('❌ Error loading quote data:', error);
        }
    }

    async loadUserAccess() {
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/access`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.userAccess = data.data;
                this.displayUserAccess();
            }
        } catch (error) {
            console.error('Error loading user access:', error);
        }
    }

    async loadAgents() {
        try {
            // SMART FILTERING: Allow new collaborators but filter out deleted ones during grace period
            const CLIENT_CHANGE_GRACE_PERIOD = 60000; // 60 seconds
            const timeSinceClientChange = this.clientChangeTimestamp ? (Date.now() - this.clientChangeTimestamp) : null;
            const isInGracePeriod = this.clientWasJustChanged || (timeSinceClientChange !== null && timeSinceClientChange < CLIENT_CHANGE_GRACE_PERIOD);

            if (isInGracePeriod) {
                console.log(`⏰ loadAgents - Within grace period (${timeSinceClientChange}ms since client change)`);
            }

            // Add client context to ensure we get collaborators for the correct client
            let currentClientId = this.originalClientId;
            const clientSelect = document.getElementById('clientId');
            if (clientSelect && clientSelect.value) {
                currentClientId = clientSelect.value;
            }

            // Build query parameters for client context
            const params = new URLSearchParams();
            if (currentClientId) {
                params.set('clientId', currentClientId);
            }

            const queryString = params.toString() ? `?${params.toString()}` : '';
            const endpoint = `/api/quotes/${this.quoteId}/collaborators${queryString}`;

            console.log('loadAgents - endpoint:', endpoint);
            console.log('loadAgents - currentClientId:', currentClientId);

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('loadAgents - received data:', data);
                let collaborators = data.data || [];

                // SMART FILTERING: During grace period, filter out deleted collaborators but keep new ones
                if (isInGracePeriod && this.deletedCollaboratorIds && this.deletedCollaboratorIds.size > 0) {
                    const beforeCount = collaborators.length;
                    collaborators = collaborators.filter(collab => {
                        const shouldKeep = !this.deletedCollaboratorIds.has(collab.agent.id);
                        if (!shouldKeep) {
                            console.log(`🚫 Filtering out deleted collaborator: ${collab.agent.firstName} ${collab.agent.lastName}`);
                        }
                        return shouldKeep;
                    });
                    console.log(`🔍 Filtered ${beforeCount - collaborators.length} deleted collaborators, keeping ${collaborators.length} valid ones`);
                }

                this.agents = collaborators;
                console.log('loadAgents - final agents count:', this.agents.length);
                this.displayAgents();
            }
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }

    async loadPendingEdits() {
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits/pending`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.pendingEdits = data.data;
                this.displayPendingEditsAlert();
            }
        } catch (error) {
            console.error('Error loading pending edits:', error);
        }
    }

    displayOwner() {
        if (!this.owner) return;


        // Safely get owner elements (they may not exist in reorganized UI)
        const ownerNameEl = document.getElementById('ownerName');
        const ownerEmailEl = document.getElementById('ownerEmail');
        const ownerSinceEl = document.getElementById('ownerSince');

        // Handle placeholder ownership
        if (this.owner.isPlaceholder) {
            // Don't show error-related placeholders, show friendly message
            if (this.owner.ownershipType === 'error' || this.owner.ownershipType === 'not-found') {
                if (ownerNameEl) ownerNameEl.innerHTML = '<span class="text-muted">Sin asignar</span>';
                if (ownerEmailEl) ownerEmailEl.innerHTML = '<span class="text-muted">-</span>';
                if (ownerSinceEl) ownerSinceEl.textContent = '';
            } else if (this.owner.ownershipType === 'unassigned') {
                if (ownerNameEl) ownerNameEl.innerHTML = '<span class="text-warning">Sin propietario</span>';
                if (ownerEmailEl) ownerEmailEl.innerHTML = '<span class="text-muted">Requiere asignación</span>';
                if (ownerSinceEl) ownerSinceEl.textContent = 'Creada: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
            } else {
                if (ownerNameEl) ownerNameEl.innerHTML = '<span class="text-warning">' + this.owner.firstName + ' ' + this.owner.lastName + '</span>';
                if (ownerEmailEl) ownerEmailEl.innerHTML = '<span class="text-muted">Sin propietario asignado</span>';
                if (ownerSinceEl) ownerSinceEl.textContent = 'Creada: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
            }
        } else if (this.owner.isDefaultOwner) {
            // This is the createdBy user shown as default owner
            if (ownerNameEl) ownerNameEl.innerHTML = `${this.owner.firstName} ${this.owner.lastName} <small class="text-muted">(Creador)</small>`;
            if (ownerEmailEl) ownerEmailEl.textContent = this.owner.email;
            if (ownerSinceEl) ownerSinceEl.textContent = 'Creó: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
        } else {
            // This is a formally assigned owner
            if (ownerNameEl) ownerNameEl.textContent = this.owner.firstName + ' ' + this.owner.lastName;
            if (ownerEmailEl) ownerEmailEl.textContent = this.owner.email;
            if (ownerSinceEl) ownerSinceEl.textContent = 'Desde: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
        }

        // Store transfer capability for use in consolidated modal.
        // Fuentes múltiples del rol para evitar races de inicialización (window.currentUser puede
        // no estar seteado todavía en la carga inicial).
        const userRole = window.currentUser?.role || this.currentUserRole || window.userRole || document.body.dataset.userRole || '';
        const currentUserId = window.currentUser?.id || window.currentUserData?.id || '';

        // Check if current user is the creator (when isDefaultOwner is true)
        const isCreator = this.owner && this.owner.isDefaultOwner && this.owner.id === currentUserId;

        // Only superadmin, admin, or the quote's owner (incl. its creator when no
        // formal owner exists yet) may transfer ownership.
        this.canTransfer = (
            userRole === 'admin' || userRole === 'superadmin' ||
            (this.userAccess && this.userAccess.role === 'owner' && !this.owner.isPlaceholder) ||
            isCreator
        );

        if (isCreator) {
            console.log('User is the creator of the quote, enabling transfer capability');
        }

        // Add user access info next to owner if applicable
        this.displayUserAccessWithOwner();

        // Update compact owner display in quote information form
        this.updateCompactOwnerDisplay();
    }

    // Propietario inicial (cotización nueva): revela el selector y lo puebla. El markup
    // #initialOwnerRow solo se renderiza para admin/superadmin (gate EJS), así que su existencia
    // implica el permiso; no dependemos de window.currentUser (que puede no estar seteado aún).
    _setupInitialOwnerSelector() {
        const row = document.getElementById('initialOwnerRow');
        if (!row) return;
        row.classList.remove('d-none');
        // Evitar repetición: en cotización nueva el selector ES el propietario, así que ocultamos
        // el display compacto de "propietario actual" (mostraría el mismo usuario).
        document.getElementById('ownerDisplayBlock')?.classList.add('d-none');
        this.loadInitialOwnerOptions();
        document.getElementById('clientId')?.addEventListener('change', () => this.loadInitialOwnerOptions());
        document.getElementById('directClientId')?.addEventListener('change', () => this.loadInitialOwnerOptions());
    }

    // Puebla el combobox buscable #initialOwnerSelect con los owners disponibles del cliente
    // (endpoint sin quote), lista plana con tag de rol (mismo estilo que la transferencia).
    // Loader/errores en #initialOwnerAlerts. Default: el usuario actual (creador).
    async loadInitialOwnerOptions() {
        const inst = await this._getOwnerCombobox('initialOwnerSelect');
        if (!inst) return;
        const alert = (msg, type = 'info') => this._inlineTransferAlert(msg, type, 'initialOwnerAlerts');

        const directRow = document.getElementById('directClientRow');
        const isDirect = !!directRow && window.getComputedStyle(directRow).display !== 'none';
        const clientId = isDirect
            ? (document.getElementById('directClientId')?.value || '')
            : (document.getElementById('clientId')?.value || '');
        const clientType = isDirect ? 'direct' : 'agency';
        const meId = window.currentUser?.id || window.currentUserData?.id || '';
        const meName = (window.currentUserData
            ? `${window.currentUserData.firstName || ''} ${window.currentUserData.lastName || ''}`.trim()
            : '') || (window.currentUser && window.currentUser.name) || 'Yo';
        const meEmail = window.currentUserData?.email || window.currentUser?.email || '';
        const meLabel = `${meName}${meEmail ? ` - ${meEmail}` : ''} (yo)`;

        const setJustMe = () => {
            alert('');
            if (inst.clearOptions) inst.clearOptions();
            if (meId && inst.addOption) {
                inst.addOption({ value: meId, text: meLabel, firstName: meName, lastName: '' });
                inst.setValue(meId);
            }
        };
        if (!clientId) { setJustMe(); return; }

        alert('Cargando propietarios…', 'info');
        if (inst.clearOptions) inst.clearOptions();
        let resp;
        try {
            resp = await fetch(`/api/quotes/owners/available?clientId=${encodeURIComponent(clientId)}&clientType=${encodeURIComponent(clientType)}`, {
                headers: { Authorization: `Bearer ${this.getAccessToken()}` },
            });
        } catch (e) { setJustMe(); return; }
        if (!resp.ok) { setJustMe(); return; }
        const json = await resp.json();
        const users = (json && json.data) || [];
        if (inst.clearOptions) inst.clearOptions();

        // Asegurar al usuario actual como opción (default) aunque no venga en la lista.
        if (meId && !users.some((u) => u.id === meId)) {
            inst.addOption({ value: meId, text: meLabel, firstName: meName, lastName: '' });
        }
        users.forEach((u) => {
            const tag = u.isAdmin ? ' · Admin' : (u.isDepartmentManager ? ' · Agencia' : (u.isClient ? ' · Agente' : ''));
            inst.addOption({
                value: u.id,
                text: `${u.firstName || ''} ${u.lastName || ''}`.trim()
                    + (u.email ? ` - ${u.email}` : '')
                    + (u.id === meId ? ' (yo)' : '') + tag,
                firstName: u.firstName || '',
                lastName: u.lastName || '',
            });
        });
        alert('');
        if (meId) inst.setValue(meId);
        else if (users[0]) inst.setValue(users[0].id);
    }

    // Cotización nueva: el propietario es el usuario actual (creador). No hay owner en el backend
    // todavía, así que se pinta el display compacto directo desde window.currentUserData.
    renderCurrentUserAsOwner() {
        const compactNameEl = document.getElementById('compactOwnerName');
        const compactEmailEl = document.getElementById('compactOwnerEmail');
        const ownerLoader = document.getElementById('ownerLoader');
        const ownerEmailLoader = document.getElementById('ownerEmailLoader');
        if (!compactNameEl || !compactEmailEl) return; // no existe en esta página

        const u = window.currentUserData || window.currentUser || {};
        const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || '';
        const email = u.email || '';

        if (ownerLoader) ownerLoader.style.display = 'none';
        if (ownerEmailLoader) ownerEmailLoader.style.display = 'none';
        compactNameEl.textContent = name || 'Tú';
        compactNameEl.style.display = 'block';
        compactEmailEl.textContent = email;
        compactEmailEl.style.display = 'block';
    }

    updateCompactOwnerDisplay() {
        const compactNameEl = document.getElementById('compactOwnerName');
        const compactEmailEl = document.getElementById('compactOwnerEmail');
        const ownerLoader = document.getElementById('ownerLoader');
        const ownerEmailLoader = document.getElementById('ownerEmailLoader');

        if (!compactNameEl || !compactEmailEl) {
            return; // Elements don't exist on this page
        }

        // Hide skeleton loaders
        if (ownerLoader) ownerLoader.style.display = 'none';
        if (ownerEmailLoader) ownerEmailLoader.style.display = 'none';

        if (this.owner.isPlaceholder) {
            if (this.owner.ownershipType === 'error' || this.owner.ownershipType === 'not-found') {
                compactNameEl.innerHTML = '<span class="text-muted">Sin asignar</span>';
                compactEmailEl.innerHTML = '<span class="text-muted">-</span>';
            } else if (this.owner.ownershipType === 'unassigned') {
                compactNameEl.innerHTML = '<span class="text-warning">Sin propietario</span>';
                compactEmailEl.innerHTML = '<span class="text-muted">Requiere asignación</span>';
            } else {
                compactNameEl.textContent = this.owner.firstName + ' ' + this.owner.lastName;
                compactEmailEl.innerHTML = '<span class="text-muted">Sin propietario asignado</span>';
            }
        } else {
            // Normal owner display
            compactNameEl.textContent = this.owner.firstName + ' ' + this.owner.lastName;
            compactEmailEl.textContent = this.owner.email;
        }

        // Show the content (in case it was hidden)
        compactNameEl.style.display = 'block';
        compactEmailEl.style.display = 'block';

        // Con un propietario real cargado (cotización existente o recién guardada) el selector
        // "Propietario inicial" (solo del alta) sobra: se oculta y se muestra el display + transferencia.
        document.getElementById('initialOwnerRow')?.classList.add('d-none');
        document.getElementById('ownerDisplayBlock')?.classList.remove('d-none');

        // Botón "Cambiar propietario" (transferencia inline): solo si el usuario puede transferir.
        const changeBtn = document.getElementById('btnInlineChangeOwner');
        if (changeBtn) changeBtn.classList.toggle('d-none', !this.canTransfer);
    }

    displayUserAccessWithOwner() {
        // Only show if user is not the owner
        if (!this.userAccess || this.userAccess.role === 'owner') {
            // Remove any existing access info (safely)
            const ownerSinceEl = document.getElementById('ownerSince');
            if (ownerSinceEl && ownerSinceEl.parentElement) {
                const existingAccess = ownerSinceEl.parentElement.querySelector('.user-access-info');
                if (existingAccess) {
                    existingAccess.remove();
                }
            }
            return;
        }

        // Create or update the user access info (safely)
        const ownerSinceEl = document.getElementById('ownerSince');
        if (!ownerSinceEl || !ownerSinceEl.parentElement) {
            console.log('Owner since element or parent not found - skipping user access display');
            return;
        }

        let accessDiv = ownerSinceEl.parentElement.querySelector('.user-access-info');
        if (!accessDiv) {
            accessDiv = document.createElement('div');
            accessDiv.className = 'user-access-info mt-1';
            ownerSinceEl.parentElement.appendChild(accessDiv);
        }

        const roleText = this.userAccess.role === 'editor' ? 'Editor' : 'Visualizador';
        const roleClass = this.userAccess.role === 'editor' ? 'bg-primary' : 'bg-success';

        accessDiv.innerHTML = `
            <small class="text-muted">Tu acceso: </small>
            <span class="badge ${roleClass} ms-1">
                <i class="ti ${this.userAccess.role === 'editor' ? 'ti-pencil' : 'ti-eye'} me-1"></i>${roleText}
            </span>
        `;
    }

    displayUserAccess() {
        if (!this.userAccess) return;

        // Hide the old access banner - we're now showing this with the owner info
        const accessDiv = document.getElementById('currentUserAccess');
        if (accessDiv) {
            accessDiv.classList.add('d-none');
        }

        // Show/hide owner-only features with admin override
        const userRole = window.currentUser?.role || '';
        const isOwner = this.userAccess.role === 'owner';
        const isAdmin = userRole === 'admin' || userRole === 'superadmin';

        // Manage agents - available for all users
        const manageBtn = document.getElementById('btnManageCollaborators');
        if (manageBtn) {
            // Always show the button - remove any d-none class that might have been added
            manageBtn.classList.remove('d-none');
        }

        // Transfer capability is now handled in the consolidated modal

        // Pending edits - only for owners
        const alertElem = document.getElementById('pendingEditsAlert');
        if (alertElem) {
            if (isOwner) {
                alertElem.classList.remove('d-none');
            } else {
                alertElem.classList.add('d-none');
            }
        }
    }

    displayAgents() {
        const listDiv = document.getElementById('collaboratorsList');

        // Check if the agents list container exists (may not exist after UI reorganization)
        if (!listDiv) {
            console.log('Collaborators list element not found - skipping agents display');
            return;
        }

        // Filter out current owner from collaborators (defensive filtering)
        // Ownership supersedes collaboration
        const filteredAgents = this.agents.filter(collab => {
            if (this.owner && collab.agent && collab.agent.id === this.owner.id) {
                console.log('Filtered out current owner from agents display:', {
                    ownerId: this.owner.id,
                    agentId: collab.agent.id,
                    ownerName: `${this.owner.firstName} ${this.owner.lastName}`,
                    agentName: `${collab.agent.firstName} ${collab.agent.lastName}`
                });
                return false;
            }
            return true;
        });

        if (filteredAgents.length === 0) {
            listDiv.innerHTML = `
                <div class="text-center py-3 text-muted">
                    <i class="ti ti-users-off mb-2" style="font-size: 2rem;"></i>
                    <p class="mb-0">No hay agentes asignados</p>
                </div>
            `;
            return;
        }

        let html = '<div class="row g-1">';

        filteredAgents.forEach(collab => {
            const agent = collab.agent;
            const roleClass = collab.role === 'editor' ? 'bg-primary' : 'bg-success';
            const roleIcon = collab.role === 'editor' ? 'ti-pencil' : 'ti-eye';
            const roleText = collab.role === 'editor' ? 'Editor' : 'Visualizador';

            html += `
                <div class="col-12 col-md-6 col-xl-4 mb-1">
                    <div class="card collaborator-card" data-agent-id="${agent.id}" style="min-height: 90px;">
                        <div class="card-body p-2">
                            <!-- User info without avatar -->
                            <div class="mb-0">
                                <h6 class="mb-0 text-truncate" style="font-size: 0.9rem;">${agent.firstName} ${agent.lastName}</h6>
                                <small class="text-muted text-truncate d-block" style="font-size: 0.75rem;">${agent.email}</small>
                            </div>
                            
                            <!-- Role badge -->
                            <div class="mb-0">
                                <span class="badge ${roleClass}" style="font-size: 0.7rem; padding: 0.2rem 0.4rem;">
                                    <i class="ti ${roleIcon} me-1"></i>${roleText}
                                </span>
                            </div>
                            
                            <!-- Last activity - always render for consistent height -->
                            <div class="small ${collab.lastActivity ? 'text-muted' : 'invisible'} mb-0" style="font-size: 0.7rem;">
                                <i class="ti ti-clock me-1"></i>
                                ${collab.lastActivity ?
                    `Última actividad: ${new Date(collab.lastActivity.date).toLocaleDateString('es-MX')}` :
                    'Placeholder'}
                            </div>
                            
                            <!-- Remove button for owner only - no space when not owner -->
                            ${this.userAccess && this.userAccess.role === 'owner' ? `
                                <div class="mt-0">
                                    <button class="btn btn-sm btn-outline-danger w-100 btn-remove-agent" 
                                            data-agent-id="${agent.id}"
                                            data-agent-name="${agent.firstName} ${agent.lastName}"
                                            style="font-size: 0.7rem; padding: 0.15rem 0.3rem;">
                                        <i class="ti ti-trash me-1"></i>
                                        Remover
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        listDiv.innerHTML = html;

        // Add custom styles to minimize spacing
        if (!document.getElementById('agent-spacing-styles')) {
            const style = document.createElement('style');
            style.id = 'agent-spacing-styles';
            style.textContent = `
                #collaboratorsList .row {
                    margin-bottom: 0 !important;
                }
                #collaboratorsList .col-12:last-child {
                    margin-bottom: 0 !important;
                }
                #collaboratorsList {
                    padding-bottom: 0 !important;
                }
                .collaborator-card {
                    margin-bottom: 0 !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    displayPendingEditsAlert() {
        if (this.pendingEdits.length > 0) {
            const alertDiv = document.getElementById('pendingEditsAlert');
            const countSpan = document.getElementById('pendingCount');

            alertDiv.classList.remove('d-none');
            countSpan.textContent = this.pendingEdits.length;
        }
    }

    setupEventListeners() {
        // Manage access button (consolidated modal)
        const manageBtn = document.getElementById('btnManageCollaborators');
        if (manageBtn) {
            manageBtn.addEventListener('click', () => this.showCollaboratorsModal());
        }

        // View history button
        const historyBtn = document.getElementById('btnViewHistory');
        if (historyBtn) {
            historyBtn.addEventListener('click', () => this.showEditHistory());
        }

        // Review edits button
        const reviewBtn = document.getElementById('btnReviewEdits');
        if (reviewBtn) {
            reviewBtn.addEventListener('click', () => this.showPendingEdits());
        }

        // Confirm transfer button (in consolidated modal)
        const confirmTransferBtn = document.getElementById('btnConfirmTransferMain');
        if (confirmTransferBtn) {
            confirmTransferBtn.addEventListener('click', () => this.transferOwnership());
        }

        // Transferencia INLINE (sección Propietario, sin modal)
        document.getElementById('btnInlineChangeOwner')?.addEventListener('click', () => this.openInlineTransfer());
        document.getElementById('btnInlineTransfer')?.addEventListener('click', () => this.transferOwnershipInline());
        document.getElementById('btnInlineTransferCancel')?.addEventListener('click', () => this.closeInlineTransfer());
        // Al elegir un propietario en el combobox → personalizar/habilitar el botón "Transferir a X".
        document.getElementById('inlineNewOwnerSelect')?.addEventListener('change', () => this.onInlineOwnerSelected());
        // Razón opcional colapsable.
        document.getElementById('btnToggleTransferReason')?.addEventListener('click', (e) => {
            e.preventDefault();
            const input = document.getElementById('inlineTransferReason');
            if (input) input.classList.remove('d-none');
            e.currentTarget.classList.add('d-none');
            input?.focus();
        });

        // Add agent button (legacy)
        const addCollabBtn = document.getElementById('btnAddCollaborator');
        if (addCollabBtn) {
            addCollabBtn.addEventListener('click', () => this.addAgent());
        }

        // Add people input with dropdown functionality
        const addPeopleInput = document.getElementById('addPeopleInput');
        if (addPeopleInput) {
            addPeopleInput.addEventListener('input', (e) => {
                this.filterUserDropdown(e.target.value);
            });

            addPeopleInput.addEventListener('focus', () => {
                this.showUserDropdown();
            });

            addPeopleInput.addEventListener('keydown', (e) => {
                this.handleDropdownNavigation(e);
            });
        }

        // Save and close button
        const saveCloseBtn = document.getElementById('btnSaveAndClose');
        if (saveCloseBtn) {
            saveCloseBtn.addEventListener('click', () => this.saveAndCloseModal());
        }

        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('userDropdown');
            const input = document.getElementById('addPeopleInput');
            if (dropdown && input && !dropdown.contains(e.target) && !input.contains(e.target)) {
                this.hideUserDropdown();
            }
        });

        // Remove agent buttons (delegated)
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-remove-agent')) {
                const btn = e.target.closest('.btn-remove-agent');
                this.removeAgent(btn.dataset.agentId, btn.dataset.agentName, btn);
            }

            // Handle expandable row clicks
            if (e.target.closest('.expandable-row')) {
                // Don't expand if clicking on action buttons
                if (e.target.closest('.btn-approve-edit, .btn-reject-edit')) {
                    return;
                }

                const row = e.target.closest('.expandable-row');
                const editId = row.dataset.editId;
                this.toggleEditDetails(editId);
            }

            // Handle approve edit button
            if (e.target.closest('.btn-approve-edit')) {
                e.stopPropagation(); // Prevent row expansion
                const btn = e.target.closest('.btn-approve-edit');
                this.approveEdit(btn.dataset.editId);
            }

            // Handle reject edit button
            if (e.target.closest('.btn-reject-edit')) {
                e.stopPropagation(); // Prevent row expansion
                const btn = e.target.closest('.btn-reject-edit');
                this.rejectEdit(btn.dataset.editId);
            }

            // Handle remove agent from modal
            if (e.target.closest('.btn-remove-agent-modal')) {
                const btn = e.target.closest('.btn-remove-agent-modal');
                this.removeAgentFromModal(btn.dataset.agentId, btn);
            }
        });

        // Handle role changes (delegated)
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('role-select')) {
                this.updateAgentRole(e.target.dataset.agentId, e.target.value, e.target);
            }
        });
    }


    async showCollaboratorsModal() {
        console.log('showCollaboratorsModal called');

        // Wait for initial data to load if still loading
        if (!this.dataLoaded && this.dataLoadingPromise) {
            console.log('Waiting for initial data to load before opening modal...');
            await this.dataLoadingPromise;
            console.log('Data loaded, proceeding with modal');
        }

        // Check if quote has a client selected first
        const clientField = document.getElementById('clientId');
        const userRole = window.currentUser?.role || '';

        // For department_manager and client roles, the client field is hidden but still has value
        // Skip validation for these roles or if field is hidden
        const isHiddenRole = userRole === 'department_manager' || userRole === 'client';

        // Check if this is a direct client quote by looking at the UI state
        const isDirectClientMode = this.isDirectClientMode();

        if (clientField && !isHiddenRole && !isDirectClientMode) {
            const clientValue = clientField.value || clientField.tomselect?.getValue() || clientField.customSelect?.getValue();
            console.log('Client value check:', { clientValue, fieldValue: clientField.value });

            if (!clientValue) {
                this.showToast('Por favor selecciona un cliente antes de gestionar la propiedad', 'warning');
                clientField.classList.add('is-invalid');
                clientField.focus();
                // Scroll to client field if needed
                clientField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
        } else if (isDirectClientMode) {
            // For direct client mode, check the directClientId field instead
            const directClientField = document.getElementById('directClientId');
            if (directClientField) {
                const directClientValue = directClientField.value || directClientField.tomselect?.getValue() || directClientField.customSelect?.getValue();
                console.log('Direct client value check:', { directClientValue, isDirectClientMode });

                if (!directClientValue) {
                    this.showToast('Por favor selecciona un cliente directo antes de gestionar la propiedad', 'warning');
                    directClientField.classList.add('is-invalid');
                    directClientField.focus();
                    directClientField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            }
        } else if (isHiddenRole && clientField) {
            // For hidden roles, try to get the value even if field is invisible
            const clientValue = clientField.value || clientField.tomselect?.getValue() || clientField.customSelect?.getValue();
            console.log('Hidden role client value:', { clientValue, userRole });
        }

        // Check if quote is saved - if not, auto-save it first
        const quoteIdInput = document.getElementById('quoteId');
        const quoteId = quoteIdInput ? quoteIdInput.value : '';
        const isNewQuote = !quoteId || quoteId === '' || quoteId === 'new';

        if (isNewQuote) {
            this.showToast('Guardando cotización...', 'info');
            this.setButtonLoading('btnManageCollaborators', true, 'Guardando...');

            try {
                const savedQuote = await this.saveQuoteInBackground();
                if (!savedQuote || !savedQuote.id) {
                    this.showToast('Error al guardar la cotización. Revisa los campos requeridos.', 'error');
                    this.setButtonLoading('btnManageCollaborators', false);
                    return;
                }

                // Update the page state to reflect the saved quote
                if (quoteIdInput) {
                    quoteIdInput.value = savedQuote.id;
                }

                // Update this instance's quoteId for API calls
                this.quoteId = savedQuote.id;

                // Update UI to edit mode with folio information
                this.updatePageToEditMode(savedQuote.id, savedQuote.folio);

                // Reload ownership data now that we have a real quote
                await this.loadOwnership();
                await this.loadUserAccess();

                // Capture the client ID as original since we just saved
                this.captureOriginalClient();

                // Show success message with folio
                const folioText = savedQuote.folio ? ` ${savedQuote.folio}` : '';
                this.showToast(`📄 Cotización${folioText} creada - gestiona colaboradores`, 'success');
            } catch (error) {
                console.error('Error auto-saving quote:', error);
                this.showToast('Error al guardar la cotización. Intenta nuevamente.', 'error');
                this.setButtonLoading('btnManageCollaborators', false);
                return;
            }
        } else {
            // For existing quotes, check if client has changed
            if (this.hasClientChanged()) {
                const currentClientId = this.getCurrentClientId();

                // Show prominent update message with longer duration
                this.showToast('🔄 Actualizando cliente de la cotización...', 'info', 3000);
                this.setButtonLoading('btnManageCollaborators', true, 'Actualizando cliente...');

                console.log('Client changed detected:', {
                    original: this.originalClientId,
                    current: currentClientId
                });

                try {
                    // Update quote with new client
                    await this.updateQuoteClient(this.quoteId, currentClientId);

                    // Set flag and timestamp that client was just changed
                    this.clientWasJustChanged = true;
                    this.clientChangeTimestamp = Date.now();
                    console.log('📌 Client change marked at:', new Date(this.clientChangeTimestamp).toISOString());

                    // Persist client change state to sessionStorage
                    sessionStorage.setItem(`clientChangeTimestamp_${this.quoteId}`, this.clientChangeTimestamp.toString());
                    sessionStorage.setItem(`clientChanged_${this.quoteId}`, 'true');

                    // Clear any cached collaborators from the previous client
                    this.clearCollaboratorsCache();

                    // Remove all existing collaborators from the quote since client changed
                    await this.clearAllCollaborators();

                    // Clear and refresh all user dropdowns for new client context
                    this.clearUserDropdowns();

                    // Don't reload agents immediately - let the modal handle the empty state
                    // The DELETE operations may still be processing on the server

                    this.showToast('✅ Cliente actualizado - Colaboradores anteriores removidos', 'success', 2500);
                } catch (error) {
                    console.error('Error updating client:', error);

                    // Reset the client change flag since update failed
                    this.clientWasJustChanged = false;

                    // Show specific error message
                    let errorMessage = '❌ Error al actualizar cliente';
                    if (error.message.includes('Client not found')) {
                        errorMessage = '❌ Cliente no encontrado. Selecciona un cliente válido.';
                    } else if (error.message.includes('authentication')) {
                        errorMessage = '❌ Error de permisos. Inicia sesión nuevamente.';
                    } else if (error.message) {
                        errorMessage = `❌ Error: ${error.message}`;
                    }

                    this.showToast(errorMessage, 'error', 5000);
                    this.setButtonLoading('btnManageCollaborators', false);
                    return;
                }
            }
        }

        // Don't proceed to open modal until any client updates are complete
        // (The client update section above will handle the button loading state)

        // Show final loading state on button if not already loading from client update
        if (!document.getElementById('btnManageCollaborators').disabled) {
            this.setButtonLoading('btnManageCollaborators', true, 'Cargando modal...');
        }

        try {
            const modalElement = document.getElementById('manageCollaboratorsModal');
            console.log('Modal element:', modalElement);

            if (!modalElement) {
                console.error('Modal element not found: manageCollaboratorsModal');
                this.showToast('Error: Modal no encontrado', 'error');
                return;
            }

            const modal = new bootstrap.Modal(modalElement);

            // Always clear collaborators UI first to prevent showing stale data
            const collaboratorsList = document.getElementById('collaboratorsManagementList');
            if (collaboratorsList) {
                collaboratorsList.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <i class="ti ti-users-refresh mb-2" style="font-size: 2rem; opacity: 0.5;"></i>
                        <p class="mb-0">Cargando colaboradores...</p>
                        <div class="spinner-border spinner-border-sm mt-2" role="status">
                            <span class="visually-hidden">Cargando...</span>
                        </div>
                    </div>
                `;
            }

            // If client was just changed, show specific message
            if (this.clientWasJustChanged) {
                console.log('Modal opening after client change - ensuring fresh collaborator state');
                if (collaboratorsList) {
                    collaboratorsList.innerHTML = `
                        <div class="text-center text-muted py-4">
                            <i class="ti ti-refresh mb-2" style="font-size: 2rem; opacity: 0.3;"></i>
                            <p class="mb-0">Cliente actualizado</p>
                            <small>Cargando colaboradores para el nuevo cliente...</small>
                            <div class="spinner-border spinner-border-sm mt-2" role="status">
                                <span class="visually-hidden">Cargando...</span>
                            </div>
                        </div>
                    `;
                }
            }

            // Update ownership section in modal
            this.displayOwnershipInModal();

            // Show/hide ownership transfer section based on permissions
            // (superadmin, admin, or the owner — encoded in this.canTransfer).
            const ownershipSection = document.getElementById('ownershipTransferSection');

            if (this.canTransfer) {
                if (ownershipSection) {
                    ownershipSection.style.display = 'block';
                }

                // Note: transferForm no longer exists in Google-style layout
                // The transfer functionality is now in a details/summary section

                // Update button text if it exists
                const confirmBtn = document.getElementById('btnConfirmTransferMain');
                if (confirmBtn) {
                    if (this.owner && this.owner.needsAssignment) {
                        confirmBtn.innerHTML = '<i class="ti ti-user-plus me-1"></i>Asignar Propietario';
                        confirmBtn.className = 'btn btn-sm btn-outline-primary w-100';
                    } else {
                        confirmBtn.innerHTML = '<i class="ti ti-transfer me-1"></i>Transferir';
                        confirmBtn.className = 'btn btn-sm btn-outline-warning w-100';
                    }
                }
            } else {
                if (ownershipSection) {
                    ownershipSection.style.display = 'none';
                }
            }

            // Load available users for ownership transfer and dropdown
            // Force reload if client was just changed to get new client's users
            console.log('Loading users for dropdowns...', { clientWasJustChanged: this.clientWasJustChanged });

            if (this.clientWasJustChanged) {
                // Give a moment for the server to process the client update
                await new Promise(resolve => setTimeout(resolve, 500));
                console.log('Client was just changed - forcing fresh user data load');
            }

            // Ambos pegan a /available-owners; en paralelo en vez de secuencial (−1 round-trip).
            await Promise.all([
                this.loadAvailableUsers('newOwnerSelectMain'),
                this.loadUsersForDropdown(),
            ]);

            // Reset placeholder text after loading new users
            if (this.clientWasJustChanged) {
                const addPeopleInput = document.getElementById('addPeopleInput');
                if (addPeopleInput) {
                    addPeopleInput.placeholder = 'Añadir Personas';
                }
                console.log('Dropdowns reloaded with fresh client context');
            }

            // Display current agents in management view with loading state
            // If client was just changed, force reload agents for new client context
            if (this.clientWasJustChanged) {
                console.log('Client was just changed - forcing agents reload for new client context...');
                // Clear any stale agent data first
                this.agents = [];
                // Small delay to ensure backend processing is complete
                await new Promise(resolve => setTimeout(resolve, 1000));
                // Load agents for the new client context
                await this.loadAgents();
                await this.displayAgentsManagement();
            } else {
                console.log('Loading agents for modal display...');
                await this.displayAgentsManagement();
            }

            // Show the modal
            modal.show();

            // Update button text to indicate modal is ready
            const btn = document.getElementById('btnManageCollaborators');
            if (btn && !btn.disabled) {
                btn.innerHTML = '<i class="ti ti-user-plus me-1"></i>Compartir';
            }

        } catch (error) {
            console.error('Error loading modal data:', error);
            this.showToast('❌ Error al cargar datos de colaboración', 'error');
        } finally {
            // Hide loading state on button
            this.setButtonLoading('btnManageCollaborators', false);

            // Reset the client change flag now that modal loading is complete
            // But keep the timestamp for grace period checking
            if (this.clientWasJustChanged) {
                console.log('Resetting clientWasJustChanged flag after modal loading completion');
                console.log('Client change timestamp remains:', this.clientChangeTimestamp);
                this.clientWasJustChanged = false;
                sessionStorage.setItem(`clientChanged_${this.quoteId}`, 'false');
                // Don't reset timestamp - it's used for grace period checking
            }

            // Check if grace period has expired and clear persisted state if so
            if (this.clientChangeTimestamp) {
                const timeSince = Date.now() - this.clientChangeTimestamp;
                if (timeSince > 60000) {
                    console.log('🧹 Grace period expired, clearing persisted state');
                    sessionStorage.removeItem(`clientChangeTimestamp_${this.quoteId}`);
                    sessionStorage.removeItem(`deletedCollaborators_${this.quoteId}`);
                    sessionStorage.removeItem(`clientChanged_${this.quoteId}`);
                    this.clientChangeTimestamp = null;
                    this.deletedCollaboratorIds = new Set();
                }
            }

            console.log('Modal loading complete, button state restored');
        }
    }

    // Save quote in background without page redirect
    async saveQuoteInBackground() {
        const form = document.getElementById('quoteInformationForm');
        if (!form) {
            throw new Error('Quote form not found');
        }

        // Validate form first
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            // Find first invalid field and focus it
            const firstInvalid = form.querySelector(':invalid');
            if (firstInvalid) {
                firstInvalid.focus();
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return null;
        }

        // Get client ID - handle both agency and direct client modes
        let clientId = null;
        const userRole = window.currentUser?.role || window.userRole;
        const isDirectClientMode = this.isDirectClientMode();

        if (isDirectClientMode) {
            // For direct client mode, get the directClientId
            const directClientField = document.getElementById('directClientId');
            if (directClientField) {
                if (directClientField.customSelect) {
                    clientId = directClientField.customSelect.getValue();
                } else if (directClientField.tomselect) {
                    clientId = directClientField.tomselect.getValue();
                } else {
                    clientId = directClientField.value;
                }
            }
            console.log('Direct client mode - using directClientId:', clientId);
        } else {
            // For agency mode, get the regular clientId
            const clientField = document.getElementById('clientId');
            if (clientField) {
                // Check for custom dropdown first, then Tom Select
                if (clientField.customSelect) {
                    clientId = clientField.customSelect.getValue();
                } else if (clientField.tomselect) {
                    clientId = clientField.tomselect.getValue();
                } else {
                    // For hidden input or disabled dropdown - just get the value
                    clientId = clientField.value;
                }
            }

            // Fallback to currentUserData for restricted roles
            if (!clientId && window.currentUserData) {
                if (userRole === 'client' && window.currentUserData.clientId) {
                    clientId = window.currentUserData.clientId;
                    console.log('Using clientId from currentUserData.clientId:', clientId);
                } else if ((userRole === 'department_manager' || userRole === 'client') && window.currentUserData.id) {
                    clientId = window.currentUserData.id;
                    console.log('Using clientId from currentUserData.id:', clientId);
                }
            }
            console.log('Agency mode - using clientId:', clientId);
        }

        if (!clientId) {
            console.error('Cliente requerido - no clientId found', {
                isDirectClientMode,
                fieldExists: isDirectClientMode ? !!document.getElementById('directClientId') : !!document.getElementById('clientId'),
                userRole,
                currentUserData: window.currentUserData
            });
            throw new Error('Cliente requerido');
        }

        // Get form data using the same structure as createQuote
        const formData = {
            clientId: clientId,
            eventType: document.getElementById('eventType')?.value?.trim() || undefined,
            numberOfPeople: document.getElementById('numberOfPeople')?.value ?
                parseInt(document.getElementById('numberOfPeople').value, 10) : undefined,
            numberOfAdults: parseInt(document.getElementById('numberOfAdults')?.value || 0),
            numberOfChildren: parseInt(document.getElementById('numberOfChildren')?.value || 0),
            numberOfInfants: parseInt(document.getElementById('numberOfInfants')?.value || 0),
            preferredLanguage: document.getElementById('preferredLanguage')?.value || 'es',
            contactPerson: document.getElementById('contactPerson')?.value?.trim() || undefined,
            contactEmail: document.getElementById('contactEmail')?.value?.trim() || undefined,
            contactPhone: document.getElementById('contactPhone')?.value?.trim() || undefined,
            notes: document.getElementById('notes')?.value?.trim() || undefined
        };

        // Include clientType for direct client quotes
        if (isDirectClientMode && (userRole === 'admin' || userRole === 'superadmin')) {
            formData.clientType = 'direct';
            console.log('Added clientType: direct to formData');
        }

        // Get access token
        const accessToken = this.getAccessToken();

        const response = await fetch('/api/quotes', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.success && result.data) {
            return result.data; // Return full quote data including folio
        } else {
            throw new Error(result.error || 'Error al guardar la cotización');
        }
    }

    // Update page UI to edit mode after saving
    updatePageToEditMode(quoteId, folio = null) {
        // Update the submit button text
        const submitBtn = document.getElementById('createQuoteBtn');
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="ti ti-check me-1"></i>Actualizar Cotización';
        }

        // Update page URL without redirect (for better UX)
        if (window.history && window.history.replaceState) {
            const currentUrl = window.location.href;
            const newUrl = currentUrl.replace(/\/new$/, `/${quoteId}`);
            window.history.replaceState({}, '', newUrl);
        }

        // Update page title and header to show folio if available
        if (folio) {
            console.log('Updating page title with folio:', folio);

            // Update document title
            document.title = `${folio} - Cotización | Amexing Quotes`;

            // Update page header if it exists
            const pageTitle = document.querySelector('h1, .page-title, .card-title');
            if (pageTitle && pageTitle.textContent.includes('Nueva Cotización')) {
                pageTitle.textContent = `Cotización ${folio}`;
            }

            // Update breadcrumb if it exists
            const breadcrumbActive = document.querySelector('.breadcrumb-item.active');
            if (breadcrumbActive && breadcrumbActive.textContent.includes('Nueva Cotización')) {
                breadcrumbActive.textContent = folio;
            }
        }
    }

    // Get JWT token from cookies (copied from quote-information.ejs)
    getAccessToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'accessToken') {
                return value;
            }
        }
        return null;
    }

    // Capture the originally saved client ID when page loads
    captureOriginalClient() {
        // El dropdown #clientId solo se renderiza en la sección "Información". El panel de ownership
        // se incluye en TODAS las secciones (Información/Servicios/Resumen), así que en Servicios y
        // Resumen el campo no existe: no hay cliente que capturar y NO es un error. Salimos en
        // silencio para no ensuciar la consola con 5 reintentos + warning (las secciones son
        // server-rendered: si el campo no está en el primer intento, no aparecerá después).
        if (!document.getElementById('clientId')) {
            console.log('captureOriginalClient: sección sin #clientId (no es Información); se omite.');
            return;
        }

        console.log('Starting captureOriginalClient...');

        // Try multiple times with increasing delays to ensure dropdown is ready
        const attemptCapture = (attempt = 1, maxAttempts = 5) => {
            const clientField = document.getElementById('clientId');
            console.log(`Capture attempt ${attempt}/${maxAttempts} - clientField:`, !!clientField);

            if (clientField) {
                let clientId = null;

                // Try multiple methods to get the client ID
                if (clientField.customSelect && clientField.customSelect.getValue) {
                    clientId = clientField.customSelect.getValue();
                    console.log('Found clientId via customSelect:', clientId);
                } else if (clientField.tomselect && clientField.tomselect.getValue) {
                    clientId = clientField.tomselect.getValue();
                    console.log('Found clientId via tomselect:', clientId);
                } else if (clientField.value) {
                    clientId = clientField.value;
                    console.log('Found clientId via direct value:', clientId);
                } else {
                    // Fallback: check data attributes
                    clientId = clientField.dataset.value || clientField.getAttribute('data-value');
                    console.log('Found clientId via data attributes:', clientId);
                }

                if (clientId && clientId !== '' && clientId !== 'undefined') {
                    this.originalClientId = clientId;
                    console.log('✅ Successfully captured original client ID:', this.originalClientId);
                    return true;
                }
            }

            // If we failed and have more attempts, try again with longer delay
            if (attempt < maxAttempts) {
                const delay = attempt * 500; // Increasing delay: 500ms, 1s, 1.5s, 2s
                console.log(`Retrying capture in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
                setTimeout(() => attemptCapture(attempt + 1, maxAttempts), delay);
            } else {
                console.warn('❌ Failed to capture original client ID after all attempts');
            }

            return false;
        };

        // Start first attempt immediately, then with delays if needed
        attemptCapture();
    }

    // Get current client ID from dropdown
    getCurrentClientId() {
        const clientField = document.getElementById('clientId');
        let currentClientId = null;

        if (clientField) {
            if (clientField.customSelect) {
                currentClientId = clientField.customSelect.getValue();
                console.log('getCurrentClientId via customSelect:', currentClientId);
            } else if (clientField.tomselect) {
                currentClientId = clientField.tomselect.getValue();
                console.log('getCurrentClientId via tomselect:', currentClientId);
            } else {
                currentClientId = clientField.value;
                console.log('getCurrentClientId via direct value:', currentClientId);
            }
        } else {
            console.warn('getCurrentClientId - clientField not found');
        }

        console.log('getCurrentClientId final result:', {
            clientId: currentClientId,
            type: typeof currentClientId,
            length: currentClientId ? currentClientId.length : 0
        });

        return currentClientId;
    }

    // Check if client has changed from original
    hasClientChanged() {
        const currentClientId = this.getCurrentClientId();
        const hasChanged = currentClientId && this.originalClientId && currentClientId !== this.originalClientId;

        console.log('Client change detection:', {
            current: currentClientId,
            original: this.originalClientId,
            hasChanged: hasChanged
        });

        return hasChanged;
    }

    // Update quote with new client
    async updateQuoteClient(quoteId, newClientId) {
        console.log('🔄 Starting client update request:', {
            quoteId,
            newClientId,
            newClientIdType: typeof newClientId,
            newClientIdLength: newClientId ? newClientId.length : 0
        });

        const formData = {
            clientId: newClientId
        };

        const response = await fetch(`/api/quotes/${quoteId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.getAccessToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.success) {
            // Update the original client ID to the new one
            this.originalClientId = newClientId;
            console.log('✅ Client update successful:', {
                quoteId,
                newClientId,
                response: result
            });
            return true;
        } else {
            const errorMessage = result.error || 'Error al actualizar cliente';
            console.error('❌ Client update failed:', {
                quoteId,
                newClientId,
                error: errorMessage,
                response: result
            });
            throw new Error(errorMessage);
        }
    }

    // Clear collaborators cache when client changes
    clearCollaboratorsCache() {
        console.log('Clearing collaborators cache for client change...');

        // Clear the agents array
        this.agents = [];

        // Clear all modal elements that show collaborators
        const modalElements = [
            'manageAgentsList',
            'collaboratorsManagementList',
            'collaboratorsList'
        ];

        modalElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                        <span>Cargando colaboradores del nuevo cliente...</span>
                    </div>
                `;
                console.log(`Cleared collaborators from ${elementId}`);
            }
        });

        // Also clear any existing collaborator items to prevent stale data
        const collaboratorItems = document.querySelectorAll('.collaborator-item, .person-item');
        collaboratorItems.forEach(item => {
            if (item.parentNode) {
                item.parentNode.removeChild(item);
            }
        });

        console.log('Collaborators cache cleared successfully');
    }

    // Check and update page permissions after ownership transfer
    async checkAndUpdatePagePermissions() {
        try {
            console.log('Checking if page permissions need updating...');

            // Check if current user's access level changed
            const currentAccess = this.userAccess;
            const isOwner = this.owner && this.owner.id === window.currentUser?.id;

            console.log('Permission check:', {
                currentUserId: window.currentUser?.id,
                ownerId: this.owner?.id,
                isOwner,
                currentAccess: currentAccess?.level
            });

            // Update UI elements based on new permissions
            this.updatePageElementsForPermissions(isOwner, currentAccess);

            // If user lost owner privileges, show notification
            if (!isOwner && currentAccess?.level !== 'owner') {
                this.showToast('Permisos actualizados después de transferencia', 'info', 3000);
            }

        } catch (error) {
            console.error('Error updating page permissions:', error);
        }
    }

    // Update page elements based on current permissions
    updatePageElementsForPermissions(isOwner, userAccess) {
        // Update any permission-dependent UI elements here
        // This could include disabling certain buttons, hiding sections, etc.

        const transferSection = document.getElementById('ownershipTransferSection');
        if (transferSection) {
            // Show/hide transfer section: only superadmin, admin, or the owner.
            const canTransfer = isOwner || ['admin', 'superadmin'].includes(window.currentUser?.role);
            transferSection.style.display = canTransfer ? 'block' : 'none';
        }

        console.log('Page permissions updated:', { isOwner, accessLevel: userAccess?.level });
    }

    // Clear user dropdowns when client changes
    clearUserDropdowns() {
        console.log('Clearing user dropdowns for client change...');

        // Clear the "Añadir Personas" dropdown cache
        this.availableUsers = [];
        this.filteredUsers = [];
        this.selectedUserIndex = -1;

        // Clear the actual dropdown display
        const userDropdown = document.getElementById('userDropdown');
        if (userDropdown) {
            userDropdown.innerHTML = `
                <div class="p-2">
                    <div class="text-center text-muted">
                        <i class="ti ti-users mb-2" style="font-size: 2rem; opacity: 0.3;"></i>
                        <p class="mb-0">Cliente actualizado</p>
                        <small>Los usuarios se cargarán para el nuevo cliente</small>
                    </div>
                </div>
            `;
            userDropdown.classList.remove('show');
        }

        // Clear the "Transferir propiedad" dropdown
        const ownershipSelect = document.getElementById('newOwnerSelectMain');
        if (ownershipSelect) {
            ownershipSelect.innerHTML = `
                <option value="">Cargando usuarios del nuevo cliente...</option>
            `;
        }

        // Clear the input field
        const addPeopleInput = document.getElementById('addPeopleInput');
        if (addPeopleInput) {
            addPeopleInput.value = '';
            addPeopleInput.placeholder = 'Usuarios se cargarán para el nuevo cliente...';
        }

        console.log('User dropdowns cleared successfully');
    }

    // Force clear local agents cache and UI
    forceClearAgentsCache() {
        console.log('🧹 Force clearing agents cache and UI');
        this.agents = [];

        // Clear all UI elements
        const elements = [
            'collaboratorsManagementList',
            'agentsList'
        ];

        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.innerHTML = '';
            }
        });

        console.log('✅ Agents cache and UI force cleared');
    }

    // Clear all collaborators from the quote when client changes
    async clearAllCollaborators() {
        console.log('🧹 Clearing all collaborators due to client change...');

        try {
            // CRITICAL FIX: Always fetch collaborators from database first
            // Don't rely on this.agents which might be empty
            console.log('📥 Fetching current collaborators from database...');
            const fetchResponse = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            let collaboratorsToDelete = [];
            if (fetchResponse.ok) {
                const data = await fetchResponse.json();
                collaboratorsToDelete = data.data || [];
                console.log(`📊 Found ${collaboratorsToDelete.length} collaborators in database to remove`);
            } else {
                console.warn('⚠️ Could not fetch collaborators from database');
                // Fall back to local cache if database fetch fails
                collaboratorsToDelete = this.agents || [];
            }

            if (collaboratorsToDelete.length === 0) {
                console.log('✅ No collaborators to clear');
                return;
            }

            const originalCount = collaboratorsToDelete.length;
            console.log(`🔄 Starting removal of ${originalCount} collaborators from database...`);

            // Remove each collaborator sequentially to ensure proper processing
            let removedCount = 0;
            const failedRemovals = [];
            const deletedCollaboratorIds = new Set(); // Track successfully deleted IDs

            for (const collab of collaboratorsToDelete) {
                try {
                    console.log(`Removing collaborator: ${collab.agent.firstName} ${collab.agent.lastName} (ID: ${collab.agent.id})`);
                    const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${collab.agent.id}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.getAccessToken()}`
                        },
                        body: JSON.stringify({
                            reason: 'Client changed - removing previous client collaborators'
                        })
                    });

                    if (response.ok) {
                        console.log(`✅ Successfully removed collaborator: ${collab.agent.firstName} ${collab.agent.lastName}`);
                        removedCount++;
                        deletedCollaboratorIds.add(collab.agent.id); // Track deleted ID
                    } else {
                        const errorData = await response.json().catch(() => ({}));
                        console.warn(`❌ Failed to remove collaborator: ${collab.agent.id}`, {
                            status: response.status,
                            error: errorData
                        });
                        failedRemovals.push({
                            agent: collab.agent,
                            status: response.status,
                            error: errorData
                        });
                    }
                } catch (error) {
                    console.warn(`❌ Error removing collaborator ${collab.agent.id}:`, error);
                    failedRemovals.push({
                        agent: collab.agent,
                        error: error.message
                    });
                }

                // Small delay between requests to avoid overwhelming server
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log(`Removed ${removedCount} out of ${originalCount} collaborators`);

            // Database verification with exponential backoff retry logic
            console.log('🔍 Performing database verification with exponential backoff...');

            let verificationAttempts = 0;
            const maxAttempts = 5;
            const maxWaitTime = 30000; // 30 seconds total timeout
            let allCollaboratorsRemoved = false;
            const startTime = Date.now();

            while (verificationAttempts < maxAttempts && !allCollaboratorsRemoved && (Date.now() - startTime) < maxWaitTime) {
                verificationAttempts++;
                console.log(`🔄 Database verification attempt ${verificationAttempts}/${maxAttempts}`);

                try {
                    // Check timeout
                    if ((Date.now() - startTime) >= maxWaitTime) {
                        console.warn(`⏰ Verification timeout reached (${maxWaitTime}ms)`);
                        break;
                    }

                    // Exponential backoff: 0.5s, 1s, 2s, 4s, 8s
                    if (verificationAttempts > 1) {
                        const backoffTime = Math.min(500 * Math.pow(2, verificationAttempts - 2), 8000);
                        console.log(`⏳ Waiting ${backoffTime}ms before verification attempt ${verificationAttempts}...`);
                        await new Promise(resolve => setTimeout(resolve, backoffTime));
                    }

                    const verificationResponse = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                        headers: {
                            'Authorization': `Bearer ${this.getAccessToken()}`
                        }
                    });

                    if (verificationResponse.ok) {
                        const verificationData = await verificationResponse.json();
                        const remainingCollaborators = verificationData.data || [];

                        console.log(`Attempt ${verificationAttempts}: Found ${remainingCollaborators.length} remaining collaborators`);

                        if (remainingCollaborators.length === 0) {
                            const elapsedTime = Date.now() - startTime;
                            console.log(`✅ Database verification successful: All collaborators removed (${elapsedTime}ms)`);
                            allCollaboratorsRemoved = true;
                        } else {
                            console.warn(`⚠️ Attempt ${verificationAttempts}: ${remainingCollaborators.length} collaborators still exist`);
                            // Log details about remaining collaborators
                            remainingCollaborators.forEach(remaining => {
                                console.warn(`  - ${remaining.agent?.firstName} ${remaining.agent?.lastName} (${remaining.agent?.id})`);
                            });

                            // If this is the last attempt or timeout reached, don't throw error - proceed anyway
                            if (verificationAttempts === maxAttempts || (Date.now() - startTime) >= maxWaitTime) {
                                console.warn(`⚠️ Database cleanup incomplete after ${verificationAttempts} attempts (${Date.now() - startTime}ms). Proceeding anyway.`);
                                // Don't throw error - let the system proceed with client change
                                allCollaboratorsRemoved = true; // Force exit from loop
                            }
                        }
                    } else {
                        console.warn(`Verification attempt ${verificationAttempts} failed - API response not OK`);
                        if (verificationAttempts === maxAttempts) {
                            console.warn('Could not verify database state after max attempts');
                        }
                    }
                } catch (verificationError) {
                    console.warn(`Database verification attempt ${verificationAttempts} failed:`, verificationError);
                    if (verificationAttempts === maxAttempts) {
                        console.error('Database verification completely failed after max attempts');
                        throw verificationError;
                    }
                }
            }

            // Clear the local cache regardless of database state
            this.agents = [];

            // Report summary
            if (failedRemovals.length > 0) {
                console.warn(`❌ ${failedRemovals.length} collaborator removals failed:`, failedRemovals);
                // Don't throw error - log warning but proceed with client change
                console.warn(`⚠️ Warning: Failed to remove ${failedRemovals.length} out of ${originalCount} collaborators. Client change will proceed.`);
            } else {
                console.log('✅ All collaborator removal requests completed successfully');
            }

            // Save the deleted collaborator IDs for filtering during grace period
            this.deletedCollaboratorIds = deletedCollaboratorIds;
            console.log(`📝 Tracking ${deletedCollaboratorIds.size} deleted collaborator IDs for grace period filtering`);

            // Persist deleted IDs to sessionStorage
            sessionStorage.setItem(`deletedCollaborators_${this.quoteId}`, JSON.stringify([...deletedCollaboratorIds]));

            // Final verification result
            const totalTime = Date.now() - startTime;
            if (allCollaboratorsRemoved) {
                console.log(`🎯 Collaborator cleanup completed successfully in ${totalTime}ms`);
            } else {
                console.warn(`⚠️ Collaborator cleanup completed with warnings in ${totalTime}ms`);
            }
        } catch (error) {
            console.error('Error clearing collaborators:', error);
            throw error;
        }
    }

    async showEditHistory() {
        const modal = new bootstrap.Modal(document.getElementById('editHistoryModal'));

        // Enhance modal header
        this.enhanceModalHeader();

        // Add legend after header
        this.addLegend();

        modal.show();

        // Load edit history
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayEditHistory(data.data);
                this.updateModalHeaderCount(data.data.length);
            }
        } catch (error) {
            console.error('Error loading edit history:', error);
        }
    }

    enhanceModalHeader() {
        const modalHeader = document.querySelector('#editHistoryModal .modal-header');
        if (modalHeader) {
            modalHeader.innerHTML = `
                <div class="w-100">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <div class="modal-icon-gradient me-3">
                                <i class="ti ti-history"></i>
                            </div>
                            <div>
                                <h5 class="modal-title mb-0">Historial de Cambios</h5>
                                <small class="text-muted" id="editCountSubtitle">Cargando...</small>
                            </div>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                </div>
            `;

            // Add styles for the enhanced header
            modalHeader.style.background = '#f8f9fa';
            modalHeader.style.color = '#212529';
            modalHeader.style.borderBottom = '2px solid #dee2e6';

            // Add icon gradient background
            const style = document.createElement('style');
            style.textContent = `
                .modal-icon-gradient {
                    width: 45px;
                    height: 45px;
                    background: #e9ecef;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid #ced4da;
                }
                
                .modal-icon-gradient i {
                    color: #495057;
                }
                
                #editHistoryModal .modal-content {
                    border: 1px solid #dee2e6;
                    border-radius: 8px;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                }
                
                #editHistoryModal .modal-body {
                    padding: 0;
                }
                
                #editHistoryTable {
                    margin-bottom: 0;
                }
                
                #editHistoryTable thead th {
                    background: #f8f9fa;
                    border: none;
                    font-weight: 600;
                    color: #495057;
                    padding: 1rem 0.75rem;
                    border-bottom: 2px solid #dee2e6;
                }
                
                #editHistoryTable tbody tr {
                    transition: all 0.2s ease;
                    border-bottom: 1px solid #e5e7eb;
                }
                
                #editHistoryTable tbody tr.expandable-row {
                    cursor: pointer;
                }
                
                #editHistoryTable tbody tr.expandable-row:hover {
                    background-color: #f8f9fa;
                }
                
                #editHistoryTable tbody tr.table-active {
                    background: #e8f4f8;
                    border-left: 3px solid #0d6efd;
                }
                
                .detail-row {
                    transition: all 0.3s ease;
                }
                
                .chevron-expand {
                    font-size: 1rem;
                    transition: transform 0.2s ease;
                    cursor: pointer;
                }
                
                .expandable-row.expanded .chevron-expand {
                    transform: rotate(180deg);
                }
                
                .detail-card {
                    background: #f8f9fa;
                    border-left: 4px solid #0d6efd;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                }
                
                .changes-comparison .table {
                    border-radius: 6px;
                    overflow: hidden;
                    border: 1px solid #dee2e6;
                }
                
                .changes-comparison .table thead {
                    background: #495057;
                    color: white;
                }
                
                .changes-comparison .table tbody tr:hover {
                    background-color: #f8f9fa;
                }
                
                .badge {
                    border-radius: 4px;
                    padding: 0.4rem 0.6rem;
                    font-weight: 500;
                }
                
                .text-primary strong {
                    color: #0d6efd !important;
                }
                
                .version-legend {
                    background: #f8f9fa;
                    border-bottom: 1px solid #e9ecef;
                }
                
                .version-legend .badge {
                    font-size: 0.7rem;
                    font-weight: 500;
                }
                
                .changes-summary {
                    max-width: 100%;
                }
                
                .change-card {
                    background: #fdfdfd;
                    border: 1px solid #e9ecef;
                    transition: all 0.2s ease;
                }
                
                .change-card:hover {
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                
                .change-flow {
                    gap: 0.5rem;
                }
                
                .change-from, .change-to {
                    min-height: 60px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                
                .change-from {
                    background: #fff2f0 !important;
                    border: 1px solid #ffccc7;
                }
                
                .change-to {
                    background: #f0f9f4 !important;
                    border: 1px solid #b7eb8f;
                }
                
                .bg-success-subtle {
                    background-color: var(--bs-success-bg-subtle, #d1e7dd) !important;
                }
                
                /* Collaborator cards styles */
                .collaborator-card {
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    border: 1px solid #dee2e6;
                }
                
                .collaborator-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }
                
                .collaborator-card .card-body {
                    padding: 0.75rem !important;
                }
                
                .collaborator-card .badge {
                    font-size: 0.8rem;
                    padding: 0.4rem 0.7rem;
                    font-weight: 500;
                }
                
                .collaborator-card h6 {
                    font-size: 1rem;
                    font-weight: 600;
                    margin-bottom: 0.25rem !important;
                }
                
                .collaborator-card small {
                    font-size: 0.85rem;
                }
            `;

            if (!document.getElementById('editHistoryStyles')) {
                style.id = 'editHistoryStyles';
                document.head.appendChild(style);
            }
        }
    }

    updateModalHeaderCount(count) {
        const subtitle = document.getElementById('editCountSubtitle');
        if (subtitle) {
            subtitle.textContent = count === 0
                ? 'No hay cambios registrados'
                : `${count} ${count === 1 ? 'cambio registrado' : 'cambios registrados'}`;
        }
    }

    addLegend() {
        const modal = document.getElementById('editHistoryModal');
        const modalBody = modal.querySelector('.modal-body');

        // Check if legend already exists
        if (modal.querySelector('.version-legend')) {
            return;
        }

        // Create legend element
        const legend = document.createElement('div');
        legend.className = 'version-legend';
        legend.innerHTML = `
            <div class="d-flex align-items-center justify-content-center py-2 px-3 bg-light border-bottom">
                <small class="text-muted me-3">
                    <i class="ti ti-info-circle me-1"></i>Leyenda:
                </small>
                <div class="d-flex align-items-center gap-3">
                    <div class="d-flex align-items-center">
                        <span class="badge bg-success px-2 me-2">v1.0</span>
                        <small class="text-muted">Últimas 24 horas</small>
                    </div>
                    <div class="d-flex align-items-center">
                        <span class="badge bg-primary px-2 me-2">v1.0</span>
                        <small class="text-muted">Anteriores</small>
                    </div>
                </div>
            </div>
        `;

        // Insert legend before modal body content
        modalBody.parentNode.insertBefore(legend, modalBody);
    }

    async showPendingEdits() {
        const modal = new bootstrap.Modal(document.getElementById('reviewEditsModal'));
        modal.show();

        // Load and display pending edits
        await this.loadPendingEdits();
        this.displayPendingEditsForReview();
    }

    displayEditHistory(edits) {
        // Store edits for later use in expansion
        this.currentEdits = edits;

        const tbody = document.querySelector('#editHistoryTable tbody');

        if (edits.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-5">
                        <div class="text-muted">
                            <i class="ti ti-history mb-3" style="font-size: 3rem; opacity: 0.3;"></i>
                            <p class="mb-0">No hay historial de cambios</p>
                            <small>Las ediciones aparecerán aquí cuando se realicen cambios</small>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        edits.forEach((edit, index) => {
            const statusBadge = this.getStatusBadge(edit.approvalStatus);

            // Get relevant changes (filter ownership transfers)
            const relevantChanges = this.getRelevantChanges(edit);
            const relevantFields = Object.keys(relevantChanges);
            const changedFieldsList = relevantFields.map(field => this.getFieldDisplayName(field)).join(', ');

            // Calculate if edit is recent (last 24 hours)
            const editDate = new Date(edit.editedAt);
            const now = new Date();
            const hoursAgo = (now - editDate) / (1000 * 60 * 60);
            const isRecent = hoursAgo <= 24;

            html += `
                <tr class="${isRecent ? 'table-active' : ''} expandable-row" data-edit-id="${edit.id}">
                    <td>
                        <span class="badge ${isRecent ? 'bg-success' : 'bg-primary'} px-3">v${edit.version}</span>
                    </td>
                    <td>
                        <div>
                            <div class="fw-medium">${new Date(edit.editedAt).toLocaleDateString('es-MX')}</div>
                            <small class="text-muted">${new Date(edit.editedAt).toLocaleTimeString('es-MX')}</small>
                        </div>
                    </td>
                    <td>
                        <div>
                            <div class="fw-semibold">${edit.editor.firstName} ${edit.editor.lastName}</div>
                            <span class="badge bg-secondary text-white small">${edit.editorRole}</span>
                        </div>
                    </td>
                    <td>
                        <div class="edit-description">
                            <div class="mb-1">${edit.description}</div>
                            <div class="small">
                                <span class="text-muted">Campos modificados:</span>
                                <span class="text-primary fw-medium">${edit.changedFields.map(field => this.getFieldDisplayName(field)).join(', ')}</span>
                            </div>
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="d-flex align-items-center gap-1">
                            <i class="ti ti-chevron-down chevron-expand text-muted"></i>
                            ${edit.approvalStatus === 'pending' && this.userAccess?.role === 'owner' ? `
                                <button class="btn btn-sm btn-outline-success btn-approve-edit" 
                                        data-edit-id="${edit.id}"
                                        title="Aprobar cambio">
                                    <i class="ti ti-check"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger btn-reject-edit" 
                                        data-edit-id="${edit.id}"
                                        title="Rechazar cambio">
                                    <i class="ti ti-x"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
                <tr class="detail-row" id="detail-${edit.id}" style="display: none;">
                    <td colspan="6" class="p-0">
                        <div class="detail-card m-2 p-3 bg-light rounded border">
                            <div class="row g-2 mb-2">
                                <div class="col-md-6">
                                    <div class="d-flex align-items-center">
                                        <strong class="text-dark me-2">Editor:</strong>
                                        <span>${edit.editor.firstName} ${edit.editor.lastName}</span>
                                        <span class="badge bg-secondary text-white ms-2 small">${edit.editorRole}</span>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="d-flex align-items-center">
                                        <strong class="text-dark me-2">Estado:</strong>
                                        ${statusBadge}
                                        <small class="text-muted ms-3">${new Date(edit.editedAt).toLocaleDateString('es-MX')} ${new Date(edit.editedAt).toLocaleTimeString('es-MX')}</small>
                                    </div>
                                </div>
                            </div>
                            
                            ${edit.description !== 'Ownership transferred:' ? `
                                <div class="mb-2">
                                    <strong class="text-dark">Descripción:</strong>
                                    <span class="ms-2">${edit.description}</span>
                                </div>
                            ` : ''}
                            
                            <div class="mb-2">
                                <strong class="text-dark">Campos:</strong>
                                <span class="ms-2">
                                    ${edit.changedFields.map(field =>
                `<span class="badge bg-info text-dark me-1">${this.getFieldDisplayName(field)}</span>`
            ).join('')}
                                </span>
                            </div>
                            
                            <div class="changes-details" data-edit-id="${edit.id}">
                                <!-- Changes will be loaded dynamically -->
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    displayPendingEditsForReview() {
        const listDiv = document.getElementById('pendingEditsList');

        if (this.pendingEdits.length === 0) {
            listDiv.innerHTML = `
                <div class="text-center py-3 text-muted">
                    <i class="ti ti-check-circle mb-2" style="font-size: 2rem;"></i>
                    <p class="mb-0">No hay ediciones pendientes</p>
                </div>
            `;
            return;
        }

        let html = '';
        this.pendingEdits.forEach(edit => {
            html += `
                <div class="edit-item pending" data-edit-id="${edit.id}">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <strong>${edit.editor.firstName} ${edit.editor.lastName}</strong>
                            <span class="text-muted ms-2">${new Date(edit.editedAt).toLocaleString('es-MX')}</span>
                        </div>
                        <span class="badge bg-warning">Pendiente</span>
                    </div>
                    <p class="mb-2">${edit.description}</p>
                    <div class="changes-list">
                        ${this.formatChanges(edit.changes, edit.previousValues, edit.newValues)}
                    </div>
                    <div class="mt-3 d-flex gap-2">
                        <button class="btn btn-sm btn-success btn-approve-edit" 
                                data-edit-id="${edit.id}">
                            <i class="ti ti-check me-1"></i>Aprobar
                        </button>
                        <button class="btn btn-sm btn-danger btn-reject-edit" 
                                data-edit-id="${edit.id}">
                            <i class="ti ti-x me-1"></i>Rechazar
                        </button>
                    </div>
                </div>
            `;
        });

        listDiv.innerHTML = html;
    }

    formatChanges(changes, previousValues, newValues) {
        let html = '<div class="small">';

        Object.keys(changes).forEach(field => {
            const oldVal = previousValues[field];
            const newVal = newValues[field];

            html += `
                <div class="mb-1">
                    <strong class="change-field">${field}:</strong>
                    <span class="old-value">${this.formatValue(oldVal)}</span>
                    →
                    <span class="new-value">${this.formatValue(newVal)}</span>
                </div>
            `;
        });

        html += '</div>';
        return html;
    }

    formatValue(value) {
        if (value === null || value === undefined) return 'vacío';
        if (typeof value === 'object') return JSON.stringify(value);
        return value.toString();
    }

    getStatusBadge(status) {
        const badges = {
            'pending': '<span class="badge bg-warning">Pendiente</span>',
            'approved': '<span class="badge bg-success">Aprobado</span>',
            'rejected': '<span class="badge bg-danger">Rechazado</span>',
            'auto_approved': '<span class="badge bg-info">Auto-aprobado</span>'
        };

        return badges[status] || '<span class="badge bg-secondary">Desconocido</span>';
    }

    async loadAvailableUsers(selectId) {
        try {
            // Note: Removed loadAvailableUsers loading log for console cleanup

            // Get current user role to determine filtering

            const userRole = this.currentUserRole || window.currentUser?.role || window.userRole || document.body.dataset.userRole || '';
            const isDirectClientQuote = this.isDirectClientMode();
            const shouldFilterAdmins = !isDirectClientQuote && (userRole === 'client' || userRole === 'department_manager');
            console.log('User role for filtering:', userRole, 'Direct client quote:', isDirectClientQuote, 'Should filter admins:', shouldFilterAdmins, 'Stored role:', this.currentUserRole);

            // Use department-filtered endpoint for both ownership transfers and agent additions
            // Get current client ID for context
            let currentClientId = this.originalClientId;
            const clientSelect = document.getElementById('clientId');
            if (clientSelect && clientSelect.value) {
                currentClientId = clientSelect.value;
            }

            // Build query parameters
            const params = new URLSearchParams();
            if (this.clientWasJustChanged) {
                params.set('_t', Date.now().toString());
            }
            if (currentClientId) {
                params.set('clientId', currentClientId);
            }

            const queryString = params.toString() ? `?${params.toString()}` : '';
            const endpoint = `/api/quotes/${this.quoteId}/available-owners${queryString}`;

            console.log('loadAvailableUsers - endpoint:', endpoint);
            console.log('loadAvailableUsers - currentClientId:', currentClientId);

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            // Note: Removed response status log for console cleanup

            // Handle missing client error
            if (!response.ok && response.status === 400) {
                const errorData = await response.json();
                console.log('loadAvailableUsers - 400 error:', errorData);

                if (errorData.requiresClient) {
                    this.showError('Por favor selecciona un cliente antes de gestionar la propiedad');
                    // Optionally highlight the client field
                    const clientField = document.getElementById('clientId');
                    if (clientField) {
                        clientField.classList.add('is-invalid');
                        clientField.focus();
                    }
                    return;
                }
                // Show other 400 errors
                this.showError(errorData.error || 'Error al cargar usuarios disponibles');
                return;
            }

            if (response.ok) {
                const responseData = await response.json();
                const select = document.getElementById(selectId);

                // Note: Removed verbose received data log for console cleanup

                if (!select) {
                    console.error(`loadAvailableUsers - Select element not found: ${selectId}`);
                    return;
                }

                select.innerHTML = '<option value="">Seleccionar usuario...</option>';

                // Available owners endpoint returns array directly in data
                const users = responseData.data || [];

                // Group users by type for better UX
                const departmentManagers = [];
                const clients = [];
                const admins = [];
                const others = [];

                console.log('🔍 loadAvailableUsers - Processing users for', selectId);
                console.log('Raw users received:', users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, role: u.role })));

                users.forEach(user => {
                    // For ownership transfer: don't show current owner (unless placeholder)
                    // For collaboration: don't show current owner or existing agents
                    if (selectId === 'newOwnerSelectMain') {
                        // For ownership transfer, only exclude real owners (not placeholders)
                        if (this.owner && !this.owner.isPlaceholder && user.id === this.owner.id) return;
                    } else {
                        // For collaboration, exclude current owner and existing agents
                        if (this.owner && user.id === this.owner.id) return;
                        if (this.agents.some(c => c.agent.id === user.id)) return;
                    }

                    // Categorize users for both dropdowns
                    if (user.isDepartmentManager) {
                        departmentManagers.push(user);
                    } else if (user.isClient) {
                        clients.push(user);
                    } else if (user.isAdmin) {
                        admins.push(user);
                    } else {
                        others.push(user);
                    }
                });

                // Add grouped options for both ownership transfer and agent addition
                // Add Department Managers
                if (departmentManagers.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Gerentes de Departamento';
                    departmentManagers.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.firstName} ${user.lastName} - ${user.email}`;
                        console.log(`📋 Adding Dept Manager option: ID=${user.id}, Text="${option.textContent}"`);
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                }

                // Add Agents (client role users)
                if (clients.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Agentes';
                    clients.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.firstName} ${user.lastName} - ${user.email}`;
                        console.log(`📋 Adding Client option: ID=${user.id}, Text="${option.textContent}"`);
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                }

                // Add Admins (merge with Others under Administradores label)
                // Only show admin group for admin/superadmin users
                const administratorsGroup = [...admins, ...others];
                if (!shouldFilterAdmins && administratorsGroup.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Administradores';
                    administratorsGroup.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.firstName} ${user.lastName} - ${user.email}`;
                        console.log(`📋 Adding Admin option: ID=${user.id}, Text="${option.textContent}"`);
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                } else if (shouldFilterAdmins && administratorsGroup.length > 0) {
                    console.log(`🚫 Filtering out ${administratorsGroup.length} admin users for role: ${userRole}`);
                }
            }
        } catch (error) {
            console.error('Error loading users:', error);
            this.showError('Error al cargar usuarios disponibles');
        }
    }

    async displayAgentsManagement() {
        const listDiv = document.getElementById('collaboratorsManagementList');

        if (this.agents.length === 0) {
            listDiv.innerHTML = `
                <p class="text-muted text-center py-3">
                    No hay agentes asignados actualmente
                </p>
            `;
            return;
        }

        let html = '';

        this.agents.forEach(collab => {
            const agent = collab.agent;
            const initials = `${agent.firstName.charAt(0)}${agent.lastName.charAt(0)}`.toUpperCase();
            const avatarColor = this.getAvatarColor(agent.email);

            html += `
                <div class="person-item d-flex align-items-center mb-2 p-2" style="min-height: 60px;">
                    <div class="person-avatar bg-${avatarColor} text-white d-flex align-items-center justify-content-center me-3" 
                         style="width: 40px; height: 40px; border-radius: 50%; font-weight: 500; font-size: 14px; flex-shrink: 0;">
                        ${initials}
                    </div>
                    <div class="flex-grow-1 me-2" style="min-width: 0; max-width: calc(100% - 200px);">
                        <div class="fw-medium text-truncate" title="${agent.firstName} ${agent.lastName}">${agent.firstName} ${agent.lastName}</div>
                        <small class="text-muted text-truncate d-block" title="${agent.email}">${agent.email}</small>
                    </div>
                    <div class="d-flex align-items-center gap-2" style="flex-shrink: 0; width: 160px;">
                        <div class="position-relative" style="flex: 1;">
                            <select class="role-selector form-select form-select-sm" 
                                    data-agent-id="${agent.id}"
                                    style="appearance: none; padding-right: 2rem;">
                                <option value="viewer" ${collab.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                                <option value="editor" ${collab.role === 'editor' ? 'selected' : ''}>Editor</option>
                            </select>
                            <i class="ti ti-chevron-down position-absolute" 
                               style="right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 12px; color: #6c757d;"></i>
                        </div>
                        <button class="btn btn-outline-danger btn-sm btn-remove-agent-modal" 
                                data-agent-id="${agent.id}"
                                title="Remover acceso"
                                style="width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="ti ti-x" style="font-size: 12px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        listDiv.innerHTML = html;

        // Add event listeners for role changes
        listDiv.querySelectorAll('.role-selector').forEach(select => {
            select.addEventListener('change', (e) => {
                this.updateAgentRole(e.target.dataset.agentId, e.target.value, e.target);
            });
        });
    }

    getAvatarColor(email) {
        const colors = ['primary', 'success', 'warning', 'info', 'secondary'];
        const hash = email.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
        return colors[Math.abs(hash) % colors.length];
    }

    async updateAgentRole(agentId, newRole) {
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${agentId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.getAccessToken()
                },
                body: JSON.stringify({ role: newRole })
            });

            if (response.ok) {
                // Update local data
                const collab = this.agents.find(c => c.agent.id === agentId);
                if (collab) {
                    collab.role = newRole;
                }
                console.log(`Role updated successfully for agent ${agentId} to ${newRole}`);
            } else {
                console.error('Failed to update agent role');
                this.showError('Error al actualizar el rol del agente');
            }
        } catch (error) {
            console.error('Error updating agent role:', error);
            this.showError('Error al actualizar el rol del agente');
        }
    }


    async addCollaboratorByUser(userId, role) {
        // Show loading state
        this.setModalLoading(true, 'Agregando...');

        try {
            console.log('Adding collaborator:', { userId, role, quoteId: this.quoteId });

            // Protection against race conditions: If client was recently changed,
            // wait a bit more to ensure all clear operations are complete
            if (this.clientWasJustChanged) {
                console.log('Client was recently changed - waiting for clearAllCollaborators to complete...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.getAccessToken()
                },
                body: JSON.stringify({
                    userId: userId,
                    agentId: userId,
                    role: role
                })
            });

            if (response.ok) {
                this.showSuccess('Colaborador agregado exitosamente');

                // Protection: If client was recently changed, add extra delay before loading agents
                // to ensure we don't load stale data
                if (this.clientWasJustChanged) {
                    console.log('Waiting extra time before loading agents due to recent client change...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Reload agents list but maintain client context awareness
                // Check if we're within grace period after client change
                const timeSinceClientChange = this.clientChangeTimestamp ? (Date.now() - this.clientChangeTimestamp) : null;
                const CLIENT_CHANGE_GRACE_PERIOD = 60000; // 60 seconds

                if (timeSinceClientChange !== null && timeSinceClientChange < CLIENT_CHANGE_GRACE_PERIOD) {
                    console.log(`⚠️ Within client change grace period (${timeSinceClientChange}ms) - only showing new collaborator`);
                    // During grace period, only add the new collaborator to empty list
                    this.forceClearAgentsCache();

                    // Manually add just the new collaborator we just created
                    // We'll need to fetch just this one collaborator's details
                    // For now, just keep the list empty and let UI update show the new state
                }

                await this.loadAgents();
                await this.displayAgentsManagement();
                console.log('Collaborator added successfully');
            } else {
                const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
                console.error('Failed to add collaborator:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorData
                });

                // Check if error is about trying to add current owner as collaborator
                if (errorData.error && errorData.error.includes('already the owner')) {
                    this.showToast('Esta persona ya es el propietario de la cotización', 'warning');
                } else {
                    this.showError(errorData.message || errorData.error || `Error ${response.status}: ${response.statusText}`);
                }
            }
        } catch (error) {
            console.error('Error adding collaborator:', error);
            this.showError('Error al agregar el agente');
        } finally {
            // Hide loading state
            this.setModalLoading(false);
        }
    }

    getCurrentClientId() {
        const clientIdInput = document.getElementById('clientId');
        if (clientIdInput) {
            return clientIdInput.value || clientIdInput.tomselect?.getValue();
        }
        return null;
    }

    // User Dropdown Functionality
    availableUsers = [];
    filteredUsers = [];
    selectedUserIndex = -1;

    async loadUsersForDropdown() {
        try {
            // Get current user role to determine filtering
            const userRole = this.currentUserRole || window.currentUser?.role || window.userRole || document.body.dataset.userRole || '';
            const isDirectClientQuote = this.isDirectClientMode();
            const shouldFilterAdmins = !isDirectClientQuote && (userRole === 'client' || userRole === 'department_manager');
            console.log('[Dropdown] User role for filtering:', userRole, 'Direct client quote:', isDirectClientQuote, 'Should filter admins:', shouldFilterAdmins, 'Stored role:', this.currentUserRole);

            // Use the same API endpoint as loadAvailableUsers with proper client context
            let currentClientId = this.originalClientId;
            const clientSelect = document.getElementById('clientId');
            if (clientSelect && clientSelect.value) {
                currentClientId = clientSelect.value;
            }

            // Build query parameters  
            const params = new URLSearchParams();
            if (this.clientWasJustChanged) {
                params.set('_t', Date.now().toString());
            }
            if (currentClientId) {
                params.set('clientId', currentClientId);
            }

            const queryString = params.toString() ? `?${params.toString()}` : '';
            const endpoint = `/api/quotes/${this.quoteId}/available-owners${queryString}`;

            console.log('loadUsersForDropdown - endpoint:', endpoint);
            console.log('loadUsersForDropdown - currentClientId:', currentClientId);

            const token = this.getAccessToken();

            console.log('🔐 AUTH DEBUG - loadUsersForDropdown request (FIXED):', {
                endpoint,
                hasToken: !!token,
                tokenStart: token ? token.substring(0, 10) + '...' : 'NO_TOKEN',
                tokenLength: token ? token.length : 0,
                userRole: window.currentUser?.role || 'unknown',
                userId: window.currentUser?.id || 'unknown',
                currentClientId,
                tokenSource: 'cookies_via_getAccessToken'
            });

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 400) {
                    const errorData = await response.json();
                    if (errorData.requiresClient) {
                        // Client not selected - just use empty array
                        this.availableUsers = [];
                        this.filteredUsers = [];
                        return;
                    }
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const responseData = await response.json();
            const users = responseData.data || [];

            // Convert API response to dropdown format
            // Filter out admins for non-admin users
            this.availableUsers = users
                .filter(user => {
                    // Log the exact fields for debugging
                    console.log('Checking user for filtering:', {
                        name: `${user.firstName} ${user.lastName}`,
                        role: user.role,
                        isAdmin: user.isAdmin,
                        isDepartmentManager: user.isDepartmentManager,
                        isClient: user.isClient,
                        username: user.username,
                        email: user.email
                    });

                    // Filter out admins for client/department_manager users
                    // Check multiple ways to identify admin users
                    const isAdminUser =
                        user.role === 'admin' ||
                        user.role === 'superadmin' ||
                        user.isAdmin === true ||
                        (user.email && (user.email.includes('admin@') || user.email.includes('superadmin@'))) ||
                        (user.username && (user.username.includes('admin@') || user.username.includes('superadmin@')));

                    if (shouldFilterAdmins && isAdminUser) {
                        console.log('✅ FILTERING OUT admin user from dropdown:', user.firstName, user.lastName, 'role:', user.role, 'isAdmin:', user.isAdmin, 'email:', user.email);
                        return false;
                    }
                    return true;
                })
                .map(user => {
                    console.log('Processing user from API:', user);
                    return {
                        id: user.value || user.id || user.objectId,
                        firstName: user.firstName || user.label?.split(' ')[0] || 'Unknown',
                        lastName: user.lastName || user.label?.split(' ').slice(1).join(' ') || '',
                        email: user.email || `${user.label?.toLowerCase().replace(/\s+/g, '.')}@unknown.com`,
                        displayName: user.label,
                        role: user.role // Keep role for potential future use
                    };
                });

            this.filteredUsers = [...this.availableUsers];

        } catch (error) {
            console.error('Error loading users for dropdown:', error);
            this.availableUsers = [];
            this.filteredUsers = [];
        }
    }

    showUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            this.renderUserDropdown();
            dropdown.classList.add('show');
        }
    }

    hideUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            dropdown.classList.remove('show');
        }
        this.selectedUserIndex = -1;
    }

    filterUserDropdown(query) {
        if (!query.trim()) {
            this.filteredUsers = [...this.availableUsers];
        } else {
            const lowerQuery = query.toLowerCase();
            this.filteredUsers = this.availableUsers.filter(user =>
                user.firstName.toLowerCase().includes(lowerQuery) ||
                user.lastName.toLowerCase().includes(lowerQuery) ||
                user.email.toLowerCase().includes(lowerQuery)
            );
        }
        this.selectedUserIndex = -1;
        this.renderUserDropdown();
    }

    renderUserDropdown() {
        const dropdown = document.getElementById('userDropdown');
        if (!dropdown) return;

        if (this.filteredUsers.length === 0) {
            dropdown.innerHTML = `
                <div class="p-2 text-center text-muted">
                    No se encontraron usuarios
                </div>
            `;
            return;
        }

        let html = '';
        this.filteredUsers.forEach((user, index) => {
            const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
            const avatarColor = this.getAvatarColor(user.email);
            const isActive = index === this.selectedUserIndex ? 'active' : '';

            html += `
                <div class="dropdown-user-item ${isActive}" data-user-index="${index}">
                    <div class="dropdown-user-avatar bg-${avatarColor} text-white">
                        ${initials}
                    </div>
                    <div>
                        <div class="fw-medium">${user.firstName} ${user.lastName}</div>
                        <small class="text-muted">${user.email}</small>
                    </div>
                </div>
            `;
        });

        dropdown.innerHTML = html;

        // Add click handlers
        dropdown.querySelectorAll('.dropdown-user-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                this.selectUser(index);
            });
        });
    }

    handleDropdownNavigation(e) {
        const dropdown = document.getElementById('userDropdown');
        if (!dropdown.classList.contains('show')) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedUserIndex = Math.min(this.selectedUserIndex + 1, this.filteredUsers.length - 1);
                this.updateDropdownSelection();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedUserIndex = Math.max(this.selectedUserIndex - 1, -1);
                this.updateDropdownSelection();
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedUserIndex >= 0) {
                    this.selectUser(this.selectedUserIndex);
                }
                break;
            case 'Escape':
                this.hideUserDropdown();
                break;
        }
    }

    updateDropdownSelection() {
        const dropdown = document.getElementById('userDropdown');
        if (!dropdown) return;

        dropdown.querySelectorAll('.dropdown-user-item').forEach((item, index) => {
            item.classList.toggle('active', index === this.selectedUserIndex);
        });
    }

    async selectUser(index) {
        if (index < 0 || index >= this.filteredUsers.length) return;

        const user = this.filteredUsers[index];

        console.log('Selected user:', user);
        console.log('User ID:', user.id, 'Type:', typeof user.id);

        // Check if user ID is valid
        if (!user.id) {
            this.showError('ID de usuario inválido');
            return;
        }

        // Add user as collaborator
        await this.addCollaboratorByUser(user.id, 'viewer');

        // Clear input and hide dropdown
        const input = document.getElementById('addPeopleInput');
        if (input) input.value = '';
        this.hideUserDropdown();
    }

    saveAndCloseModal() {
        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('manageCollaboratorsModal'));
        if (modal) {
            modal.hide();
        }

        // Refresh the main display
        this.displayOwner();
        this.displayAgents();
    }

    // Toast Notification System
    showToast(message, type = 'info', duration = 4000) {
        const container = document.querySelector('.toast-container');
        if (!container) return;

        const toastId = `toast-${Date.now()}`;
        const iconClass = {
            success: 'ti-check-circle text-success',
            error: 'ti-x-circle text-danger',
            warning: 'ti-alert-triangle text-warning',
            info: 'ti-info-circle text-info'
        };

        const bgClass = {
            success: 'bg-success-subtle border-success',
            error: 'bg-danger-subtle border-danger',
            warning: 'bg-warning-subtle border-warning',
            info: 'bg-info-subtle border-info'
        };

        const toastHtml = `
            <div class="toast ${bgClass[type]} border" id="${toastId}" role="alert">
                <div class="toast-body d-flex align-items-center">
                    <i class="${iconClass[type]} me-2"></i>
                    <span class="flex-grow-1">${message}</span>
                    <button type="button" class="btn-close btn-close-sm ms-2" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', toastHtml);

        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, { delay: duration });
        toast.show();

        // Auto-remove from DOM after hiding
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    }

    // Loading State Helpers
    setButtonLoading(buttonId, loading, text = 'Cargando...') {
        const button = document.getElementById(buttonId);
        if (!button) return;

        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = `
                <i class="ti ti-loader-2 spin me-1"></i>
                ${text}
            `;
            // Add spinner animation styles if not already added
            this.addSpinnerStyles();
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            delete button.dataset.originalText;
        }
    }

    addSpinnerStyles() {
        if (!document.getElementById('spinner-styles')) {
            const style = document.createElement('style');
            style.id = 'spinner-styles';
            style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
            `;
            document.head.appendChild(style);
        }
    }

    setModalLoading(loading, message = 'Cargando...') {
        // Disable Hecho button
        const hechoBtn = document.getElementById('btnSaveAndClose');
        if (hechoBtn) {
            if (loading) {
                hechoBtn.disabled = true;
                hechoBtn.dataset.originalText = hechoBtn.innerHTML;
                hechoBtn.innerHTML = `<i class="ti ti-loader-2 spin me-1"></i>${message}`;
                this.addSpinnerStyles();
            } else {
                hechoBtn.disabled = false;
                hechoBtn.innerHTML = hechoBtn.dataset.originalText || 'Hecho';
                delete hechoBtn.dataset.originalText;
            }
        }

        // Also disable the add people input
        const addInput = document.getElementById('addPeopleInput');
        if (addInput) {
            addInput.disabled = loading;
            if (loading) {
                addInput.placeholder = 'Agregando colaborador...';
            } else {
                addInput.placeholder = 'Buscar personas para agregar...';
            }
        }
    }

    showInlineRoleLoader(agentId, show) {
        const select = document.querySelector(`[data-agent-id="${agentId}"].role-selector`);
        if (!select) return;

        let loader = select.parentElement.querySelector('.role-loader');
        if (!loader) {
            loader = document.createElement('span');
            loader.className = 'role-loader ms-2';
            loader.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            select.parentElement.appendChild(loader);
        }

        select.disabled = show;
        loader.style.display = show ? 'inline-block' : 'none';
    }

    showInputLoading(inputId, show) {
        const input = document.getElementById(inputId);
        if (!input) return;

        input.disabled = show;
        if (show) {
            input.style.opacity = '0.6';
            input.setAttribute('placeholder', 'Procesando...');
        } else {
            input.style.opacity = '1';
            input.setAttribute('placeholder', 'Añadir Personas');
        }
    }

    setModalDismissible(dismissible) {
        const modal = document.getElementById('manageCollaboratorsModal');
        if (!modal) return;

        modal.setAttribute('data-bs-backdrop', dismissible ? 'true' : 'static');
        modal.setAttribute('data-bs-keyboard', dismissible ? 'true' : 'false');

        const closeBtn = modal.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.disabled = !dismissible;
            closeBtn.style.opacity = dismissible ? '1' : '0.5';
        }
    }

    displayOwnershipInModal() {
        console.log('=== DISPLAYING OWNERSHIP IN MODAL ===');
        console.log('this.owner:', this.owner);

        if (!this.owner) {
            console.log('No owner data available for modal display');
            return;
        }

        const modalOwnerName = document.getElementById('modalOwnerName');
        const modalOwnerEmail = document.getElementById('modalOwnerEmail');
        const ownerInitials = document.getElementById('ownerInitials');

        console.log('Modal elements found:', {
            modalOwnerName: !!modalOwnerName,
            modalOwnerEmail: !!modalOwnerEmail,
            ownerInitials: !!ownerInitials
        });

        if (this.owner.isPlaceholder) {
            if (this.owner.ownershipType === 'error' || this.owner.ownershipType === 'not-found') {
                if (modalOwnerName) modalOwnerName.innerHTML = '<span class="text-muted">Sin asignar</span>';
                if (modalOwnerEmail) modalOwnerEmail.innerHTML = '<span class="text-muted">-</span>';
                if (ownerInitials) ownerInitials.textContent = '?';
                console.log('Displaying placeholder: Sin asignar');
            } else if (this.owner.ownershipType === 'unassigned') {
                if (modalOwnerName) modalOwnerName.innerHTML = '<span class="text-warning">Sin propietario</span>';
                if (modalOwnerEmail) modalOwnerEmail.innerHTML = '<span class="text-muted">Requiere asignación</span>';
                if (ownerInitials) ownerInitials.textContent = '?';
                console.log('Displaying placeholder: Sin propietario');
            } else {
                if (modalOwnerName) modalOwnerName.innerHTML = '<span class="text-warning">' + this.owner.firstName + ' ' + this.owner.lastName + '</span>';
                if (modalOwnerEmail) modalOwnerEmail.innerHTML = '<span class="text-muted">Sin propietario asignado</span>';
                if (ownerInitials) ownerInitials.textContent = `${this.owner.firstName.charAt(0)}${this.owner.lastName.charAt(0)}`.toUpperCase();
                console.log('Displaying placeholder owner:', this.owner.firstName, this.owner.lastName);
            }
        } else if (this.owner.isDefaultOwner) {
            // Show createdBy user as default owner
            if (modalOwnerName) modalOwnerName.innerHTML = `${this.owner.firstName} ${this.owner.lastName} <small class="text-muted">(Creador)</small>`;
            if (modalOwnerEmail) modalOwnerEmail.textContent = this.owner.email;
            if (ownerInitials) ownerInitials.textContent = `${this.owner.firstName.charAt(0)}${this.owner.lastName.charAt(0)}`.toUpperCase();
            console.log('Displaying default owner (creator):', this.owner.firstName, this.owner.lastName);
        } else {
            if (modalOwnerName) modalOwnerName.textContent = this.owner.firstName + ' ' + this.owner.lastName;
            if (modalOwnerEmail) modalOwnerEmail.textContent = this.owner.email;
            if (ownerInitials) ownerInitials.textContent = `${this.owner.firstName.charAt(0)}${this.owner.lastName.charAt(0)}`.toUpperCase();
            console.log('Displaying formal owner:', this.owner.firstName, this.owner.lastName, this.owner.email);
        }

        console.log('=== END MODAL OWNERSHIP DISPLAY ===');
    }

    // ===== Transferencia de propietario INLINE (sección Propietario, sin modal) =====
    // Instancia customSelect del combobox de propietario (polling hasta que el átomo inicialice).
    async _getOwnerCombobox(elId = 'inlineNewOwnerSelect', timeoutMs = 5000) {
        const el0 = document.getElementById(elId);
        if (el0 && el0.customSelect) return el0.customSelect;
        return new Promise((resolve) => {
            const start = Date.now();
            const iv = setInterval(() => {
                const el = document.getElementById(elId);
                if (el && el.customSelect) { clearInterval(iv); resolve(el.customSelect); }
                else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(null); }
            }, 100);
        });
    }

    _resetInlineTransferButton() {
        const btn = document.getElementById('btnInlineTransfer');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="ti ti-check"></i>';
            btn.title = 'Transferir';
        }
    }

    async openInlineTransfer() {
        // El editor OCUPA el lugar del display del propietario (se oculta para no repetir).
        document.getElementById('ownerDisplayBlock')?.classList.add('d-none');
        const row = document.getElementById('inlineTransferRow');
        if (row) row.classList.remove('d-none');
        this._inlineTransferAlert('');
        this._resetInlineTransferButton();
        try {
            await this._populateOwnerCombobox();
        } catch (e) {
            this._inlineTransferAlert('No se pudo cargar la lista de usuarios', 'danger');
        }
    }

    // Puebla el combobox buscable con los owners del quote, excluyendo SOLO al propietario actual
    // (los agentes SÍ pueden recibir la transferencia — antes se excluían por error).
    async _populateOwnerCombobox() {
        // Estado de carga visible (cubre la inicialización del átomo + el fetch).
        this._inlineTransferAlert('Cargando propietarios…', 'info');
        const inst = await this._getOwnerCombobox();
        if (!inst) { this._inlineTransferAlert('No se pudo inicializar el selector', 'danger'); return; }
        if (inst.clearOptions) inst.clearOptions();

        const clientId = document.getElementById('clientId')?.value || '';
        const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
        let resp;
        try {
            resp = await fetch(`/api/quotes/${this.quoteId}/available-owners${qs}`, {
                headers: { Authorization: `Bearer ${this.getAccessToken()}` },
            });
        } catch (e) {
            this._inlineTransferAlert('Error de red al cargar usuarios', 'danger');
            return;
        }
        if (!resp.ok) {
            if (resp.status === 400) {
                const err = await resp.json().catch(() => ({}));
                if (err.requiresClient) { this._inlineTransferAlert('Selecciona un cliente antes de transferir'); return; }
            }
            this._inlineTransferAlert('Error al cargar usuarios disponibles', 'danger');
            return;
        }
        const json = await resp.json();
        const users = ((json && json.data) || []).filter(
            (u) => !(this.owner && !this.owner.isPlaceholder && u.id === this.owner.id),
        );
        if (inst.clearOptions) inst.clearOptions();
        if (!users.length) {
            this._inlineTransferAlert('No hay otros usuarios disponibles para transferir', 'warning');
            return;
        }
        this._inlineTransferAlert(''); // limpiar el "Cargando…"
        users.forEach((u) => {
            const tag = u.isAdmin ? ' · Admin' : (u.isDepartmentManager ? ' · Agencia' : (u.isClient ? ' · Agente' : ''));
            inst.addOption({
                value: u.id,
                text: `${u.firstName || ''} ${u.lastName || ''}`.trim() + (u.email ? ` - ${u.email}` : '') + tag,
                firstName: u.firstName || '',
                lastName: u.lastName || '',
            });
        });
    }

    // Al elegir un usuario: habilitar y personalizar el botón "Transferir a <Nombre>".
    onInlineOwnerSelected() {
        const inst = document.getElementById('inlineNewOwnerSelect')?.customSelect;
        const btn = document.getElementById('btnInlineTransfer');
        if (!inst || !btn) return;
        const val = inst.getValue ? inst.getValue() : '';
        const opt = val && inst.getOption ? inst.getOption(val) : null;
        if (val && opt) {
            const name = `${opt.firstName || ''} ${opt.lastName || ''}`.trim() || 'usuario';
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-check"></i>';
            btn.title = `Transferir a ${name}`;
        } else {
            this._resetInlineTransferButton();
        }
    }

    closeInlineTransfer() {
        // Restaurar el display del propietario y ocultar el editor.
        document.getElementById('ownerDisplayBlock')?.classList.remove('d-none');
        const row = document.getElementById('inlineTransferRow');
        if (row) row.classList.add('d-none');
        const inst = document.getElementById('inlineNewOwnerSelect')?.customSelect;
        if (inst && inst.clearOptions) inst.clearOptions();
        const reason = document.getElementById('inlineTransferReason');
        if (reason) { reason.value = ''; reason.classList.add('d-none'); }
        document.getElementById('btnToggleTransferReason')?.classList.remove('d-none');
        this._resetInlineTransferButton();
        this._inlineTransferAlert('');
    }

    _inlineTransferAlert(message, type = 'warning', containerId = 'inlineTransferAlerts') {
        const c = document.getElementById(containerId);
        if (!c) return;
        c.innerHTML = message
            ? `<div class="alert alert-${type} alert-dismissible fade show py-1 px-2 mb-2" role="alert"><small>${message}</small><button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button></div>`
            : '';
    }

    async transferOwnershipInline() {
        const inst = document.getElementById('inlineNewOwnerSelect')?.customSelect;
        const newOwnerId = inst && inst.getValue ? inst.getValue() : '';
        const reason = document.getElementById('inlineTransferReason')?.value || '';
        if (!newOwnerId) {
            this._inlineTransferAlert('Por favor selecciona un nuevo propietario');
            return;
        }
        // Sin popup de confirmación: el botón "Transferir a <Nombre>" ya es la acción explícita.
        this.setButtonLoading('btnInlineTransfer', true, 'Transfiriendo...');
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/ownership/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAccessToken()}` },
                body: JSON.stringify({ newOwnerId, reason }),
            });
            if (!response.ok) {
                let msg = 'Error al transferir propiedad';
                try { const e = await response.json(); msg = e.error || msg; } catch (_) { /* noop */ }
                this._inlineTransferAlert(msg, 'danger');
                return;
            }
            // Recarga ligera en paralelo, refresca el display del propietario y notifica al
            // formulario para que el Contacto (si "es el propietario") se actualice en caliente.
            await Promise.all([this.loadOwnership(), this.loadUserAccess()]);
            this.displayOwner();
            document.dispatchEvent(new CustomEvent('quoteOwnerChanged', {
                detail: {
                    firstName: this.owner?.firstName || '',
                    lastName: this.owner?.lastName || '',
                    email: this.owner?.email || '',
                    phone: this.owner?.phone || '',
                    fullName: this.owner?.fullName || `${this.owner?.firstName || ''} ${this.owner?.lastName || ''}`.trim(),
                },
            }));
            this.showSuccess('Propiedad transferida exitosamente');
            this.closeInlineTransfer();
            // Permisos de página en segundo plano: no bloquea la respuesta visual.
            this.checkAndUpdatePagePermissions();
        } catch (error) {
            console.error('Error transferring ownership (inline):', error);
            this._inlineTransferAlert('Error al transferir propiedad', 'danger');
        } finally {
            this.setButtonLoading('btnInlineTransfer', false);
        }
    }

    async transferOwnership() {
        const newOwnerId = document.getElementById('newOwnerSelectMain').value;
        const reason = document.getElementById('transferReasonMain').value;

        // Enhanced debugging for user selection issue
        console.log('=== OWNERSHIP TRANSFER DEBUGGING ===');
        console.log('Selected newOwnerId:', newOwnerId);

        const selectElement = document.getElementById('newOwnerSelectMain');
        const selectedOption = selectElement.options[selectElement.selectedIndex];
        console.log('Selected option text:', selectedOption?.text);
        console.log('Selected option value:', selectedOption?.value);
        console.log('All available options:');
        Array.from(selectElement.options).forEach((option, index) => {
            console.log(`  [${index}] ${option.value} - ${option.text}`);
        });
        console.log('Current client context (originalClientId):', this.originalClientId);
        console.log('Client was just changed?', this.clientWasJustChanged);
        console.log('=== END TRANSFER DEBUGGING ===');

        if (!newOwnerId) {
            this.showError('Por favor selecciona un nuevo propietario');
            return;
        }

        // Additional validation: verify selected user is intended
        if (selectedOption) {
            const confirmMessage = `¿Confirmar transferencia de propiedad a:\n\n${selectedOption.text}\n\nRazón: ${reason || 'Sin razón especificada'}`;
            if (!confirm(confirmMessage)) {
                console.log('Transfer cancelled by user confirmation');
                return;
            }
        }

        // Show loading state on transfer button and disable modal
        this.setButtonLoading('btnConfirmTransferMain', true, 'Transfiriendo...');
        this.setModalLoading(true, 'Transfiriendo propiedad...');

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/ownership/transfer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({
                    newOwnerId,
                    reason
                })
            });

            if (response.ok) {
                // Show appropriate success message
                const successMessage = (this.owner && this.owner.needsAssignment)
                    ? 'Propietario asignado exitosamente'
                    : 'Propiedad transferida exitosamente';

                this.showSuccess(successMessage);

                // Clear form
                document.getElementById('newOwnerSelectMain').value = '';
                document.getElementById('transferReasonMain').value = '';

                // Reload ownership data and wait for completion
                console.log('=== STARTING OWNERSHIP DATA RELOAD AFTER TRANSFER ===');
                console.log('Current owner before reload:', this.owner);

                // Recarga en paralelo (antes eran dos awaits secuenciales → doble latencia).
                await Promise.all([this.loadOwnership(), this.loadUserAccess()]);
                console.log('Owner/access after reload:', this.owner, this.userAccess);

                console.log('=== OWNERSHIP DATA RELOAD COMPLETED ===');

                // Update both modal and main page display with fresh data
                this.displayOwnershipInModal();
                this.displayOwner(); // Update main page ownership display

                // Notificar al formulario de información para que la sección de Contacto
                // (cuando "el contacto es el propietario") se actualice sin recargar la página.
                // El listener actualiza window.__quoteOwner y refresca el resumen del contacto.
                document.dispatchEvent(new CustomEvent('quoteOwnerChanged', {
                    detail: {
                        firstName: this.owner?.firstName || '',
                        lastName: this.owner?.lastName || '',
                        email: this.owner?.email || '',
                        phone: this.owner?.phone || '',
                        fullName: this.owner?.fullName
                            || `${this.owner?.firstName || ''} ${this.owner?.lastName || ''}`.trim(),
                    }
                }));

                // Refresh collaborators to show updated list after ownership transfer
                await this.loadAgents();
                this.displayAgents();

                // Update page permissions if current user changed
                await this.checkAndUpdatePagePermissions();

                console.log('✅ Transfer completed - UI updated with new ownership');
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al transferir propiedad');
            }
        } catch (error) {
            console.error('Error transferring ownership:', error);
            this.showError('Error al transferir propiedad');
        } finally {
            // Hide loading states
            this.setButtonLoading('btnConfirmTransferMain', false);
            this.setModalLoading(false);
        }
    }

    async addAgent() {
        const collaboratorSelect = document.getElementById('collaboratorSelect');
        const roleSelect = document.getElementById('collaboratorRole');

        const agentId = collaboratorSelect?.value;
        const role = roleSelect?.value || 'viewer';

        // Enhanced validation
        if (!collaboratorSelect) {
            this.showError('Error: elemento de selección de colaborador no encontrado');
            return;
        }

        if (!agentId) {
            // Check if dropdown has options
            if (collaboratorSelect.options.length <= 1) {
                this.showError('No hay usuarios disponibles. Asegúrate de que la cotización tenga un cliente seleccionado.');
                return;
            }
            this.showError('Por favor selecciona un usuario');
            return;
        }

        console.log('addAgent - Sending request:', {
            quoteId: this.quoteId,
            agentId,
            role,
            requestBody: { agentId, role }
        });

        // Show loading state on add button and disable Hecho button
        this.setButtonLoading('btnAddCollaborator', true, 'Agregando...');
        this.setModalLoading(true, 'Agregando...');

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({
                    agentId,
                    role
                })
            });

            console.log('addAgent - Response status:', response.status);

            if (response.ok) {
                this.showSuccess('Agente agregado exitosamente');

                // Reset form
                document.getElementById('collaboratorSelect').value = '';
                document.getElementById('collaboratorRole').value = 'viewer';

                // Reload agents (add small delay to ensure database transaction is committed)
                setTimeout(async () => {
                    await this.loadAgents();
                    await this.displayAgentsManagement();
                    // Hide loading state after reload
                    this.setButtonLoading('btnAddCollaborator', false);
                    this.setModalLoading(false);
                }, 100);
            } else {
                const errorData = await response.json();
                console.error('addAgent - Server error:', {
                    status: response.status,
                    errorData,
                    requestData: { agentId, role }
                });

                // More specific error messages
                let errorMessage = 'Error al agregar agente';
                if (errorData.error) {
                    if (errorData.error.includes('Agent ID and role are required')) {
                        errorMessage = 'Error de validación: Los datos del agente no se enviaron correctamente. Por favor intenta de nuevo.';
                    } else if (errorData.error.includes('permission')) {
                        errorMessage = 'No tienes permisos suficientes para agregar agentes a esta cotización.';
                    } else if (errorData.error.includes('not found')) {
                        errorMessage = 'La cotización o el usuario seleccionado no se encontraron.';
                    } else {
                        errorMessage = errorData.error;
                    }
                }

                this.showError(errorMessage);
                // Hide loading state on error
                this.setButtonLoading('btnAddCollaborator', false);
                this.setModalLoading(false);
            }
        } catch (error) {
            console.error('Error adding agent:', error);
            this.showError('Error de conexión al agregar agente. Por favor verifica tu conexión e intenta de nuevo.');
            // Hide loading state on exception
            this.setButtonLoading('btnAddCollaborator', false);
            this.setModalLoading(false);
        }
    }

    async removeAgent(agentId, agentName, buttonElement = null) {
        if (!confirm(`¿Estás seguro de quitar a ${agentName} como agente?`)) {
            return;
        }

        // Show loading state on the specific button if provided
        if (buttonElement) {
            buttonElement.disabled = true;
            const originalText = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="ti ti-loader-2 spin"></i>';
            buttonElement.originalText = originalText;
            // Add spinner animation styles
            this.addSpinnerStyles();
        }

        // Also disable Hecho button
        this.setModalLoading(true, 'Removiendo...');

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${agentId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({
                    reason: 'Removed by owner/admin'
                })
            });

            if (response.ok) {
                this.showSuccess('Agente eliminado exitosamente');
                await this.loadAgents();
                await this.displayAgentsManagement();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al eliminar agente');
            }
        } catch (error) {
            console.error('Error removing agent:', error);
            this.showError('Error al eliminar agente');
        } finally {
            // Restore button state if provided
            if (buttonElement && buttonElement.originalText) {
                buttonElement.disabled = false;
                buttonElement.innerHTML = buttonElement.originalText;
                delete buttonElement.originalText;
            }
            // Re-enable Hecho button
            this.setModalLoading(false);
        }
    }

    async removeAgentFromModal(agentId, buttonElement = null) {
        const collab = this.agents.find(c => c.agent.id === agentId);
        if (collab) {
            await this.removeAgent(agentId, `${collab.agent.firstName} ${collab.agent.lastName}`, buttonElement);
            await this.displayAgentsManagement();
        }
    }

    async updateAgentRole(agentId, newRole, selectElement = null) {
        // Show loading state on dropdown and disable Hecho button
        if (selectElement) {
            selectElement.disabled = true;
            selectElement.style.opacity = '0.6';
        }
        this.setModalLoading(true, 'Guardando...');

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${agentId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({ role: newRole })
            });

            if (response.ok) {
                this.showSuccess('Rol actualizado exitosamente');
                await this.loadAgents();
                await this.displayAgentsManagement();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al actualizar rol');
            }
        } catch (error) {
            console.error('Error updating role:', error);
            this.showError('Error al actualizar rol');
        } finally {
            // Restore dropdown state and enable Hecho button
            if (selectElement) {
                selectElement.disabled = false;
                selectElement.style.opacity = '1';
            }
            this.setModalLoading(false);
        }
    }

    async approveEdit(editId) {
        if (!confirm('¿Aprobar esta edición?')) return;

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits/${editId}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({ comment: '' })
            });

            if (response.ok) {
                this.showSuccess('Edición aprobada');
                await this.loadPendingEdits();
                this.displayPendingEditsForReview();

                // Reload quote data if on quote page
                if (window.loadQuoteData) {
                    window.loadQuoteData();
                }
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al aprobar edición');
            }
        } catch (error) {
            console.error('Error approving edit:', error);
            this.showError('Error al aprobar edición');
        }
    }

    async rejectEdit(editId) {
        const reason = prompt('Razón del rechazo (opcional):');
        if (reason === null) return; // User cancelled

        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits/${editId}/reject`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAccessToken()}`
                },
                body: JSON.stringify({ reason })
            });

            if (response.ok) {
                this.showSuccess('Edición rechazada');
                await this.loadPendingEdits();
                this.displayPendingEditsForReview();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al rechazar edición');
            }
        } catch (error) {
            console.error('Error rejecting edit:', error);
            this.showError('Error al rechazar edición');
        }
    }

    async toggleEditDetails(editId) {
        const detailRow = document.getElementById(`detail-${editId}`);
        const expandableRow = document.querySelector(`[data-edit-id="${editId}"]`);

        if (detailRow.style.display === 'none' || detailRow.style.display === '') {
            // Show details
            detailRow.style.display = 'table-row';
            expandableRow.classList.add('expanded');

            // Load changes details if not already loaded
            const changesContainer = detailRow.querySelector(`[data-edit-id="${editId}"]`);
            if (changesContainer && changesContainer.innerHTML.trim() === '<!-- Changes will be loaded dynamically -->') {
                // Find the edit data from the current edits array (we need to pass it somehow)
                changesContainer.innerHTML = '<div class="text-center py-2"><i class="ti ti-loader animate-spin"></i> Cargando detalles...</div>';

                try {
                    // For now, we'll need to fetch the edit data or pass it differently
                    // This is a placeholder for the async change loading
                    const editData = this.findEditData(editId);
                    if (editData) {
                        const changesHtml = await this.formatEditDetailsForExpansion(editData);
                        changesContainer.innerHTML = changesHtml;
                    } else {
                        changesContainer.innerHTML = '<div class="alert alert-warning">No se pudieron cargar los detalles del cambio.</div>';
                    }
                } catch (error) {
                    console.error('Error loading change details:', error);
                    changesContainer.innerHTML = '<div class="alert alert-danger">Error al cargar detalles del cambio.</div>';
                }
            }

            // Hide other open detail rows
            document.querySelectorAll('.detail-row').forEach(row => {
                if (row.id !== `detail-${editId}`) {
                    row.style.display = 'none';
                }
            });

            // Reset other expanded rows
            document.querySelectorAll('.expandable-row').forEach(row => {
                if (row.dataset.editId !== editId) {
                    row.classList.remove('expanded');
                }
            });
        } else {
            // Hide details
            detailRow.style.display = 'none';
            expandableRow.classList.remove('expanded');
        }
    }

    findEditData(editId) {
        // Helper method to find edit data from the last loaded edits
        // This would need to be enhanced to properly store and retrieve edit data
        return this.currentEdits?.find(edit => edit.id === editId) || null;
    }

    getActionType(edit) {
        const changes = edit.changes || {};
        const fields = Object.keys(changes);
        const description = edit.description || '';

        // Ownership transfer
        if (fields.includes('owner') &&
            (description.includes('Ownership transferred') || description.includes('transferred'))) {
            return 'ownership_transfer';
        }

        // Collaborator added
        if (fields.includes('collaboratorAdded') && fields.includes('role')) {
            return 'collaborator_added';
        }

        // Collaborator removed
        if (fields.includes('collaboratorRemoved')) {
            return 'collaborator_removed';
        }

        // Role changed
        if (fields.includes('roleChanged') ||
            (description.includes('role') && (description.includes('changed') || description.includes('updated')))) {
            return 'role_changed';
        }

        // Status change
        if (fields.includes('status') && fields.length === 1) {
            return 'status_change';
        }

        // Client assignment
        if (fields.includes('clientId')) {
            return 'client_assignment';
        }

        // General edit (multiple fields or other changes)
        return 'general_edit';
    }

    isOwnershipTransfer(edit) {
        return this.getActionType(edit) === 'ownership_transfer';
    }

    async getActionHeader(edit, actionType) {
        const changes = edit.changes || {};

        switch (actionType) {
            case 'ownership_transfer':
                return '<i class="ti ti-user-check me-1"></i>Transferencia de Propiedad';

            case 'collaborator_added':
                // Get user info for the added collaborator
                const addedUserId = changes.collaboratorAdded;
                const role = changes.role;
                const userInfo = await this.getUserInfo(addedUserId);
                const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : 'Usuario';
                const roleText = role === 'editor' ? 'Editor' : 'Visualizador';
                return `<i class="ti ti-user-plus me-1"></i>Colaborador Agregado: ${userName} (${roleText})`;

            case 'collaborator_removed':
                // Get user info for the removed collaborator
                const removedUserId = changes.collaboratorRemoved;
                const removedUserInfo = await this.getUserInfo(removedUserId);
                const removedUserName = removedUserInfo ? `${removedUserInfo.firstName} ${removedUserInfo.lastName}` : 'Usuario';
                return `<i class="ti ti-user-minus me-1"></i>Colaborador Removido: ${removedUserName}`;

            case 'role_changed':
                return '<i class="ti ti-shield-check me-1"></i>Cambio de Rol';

            case 'status_change':
                return '<i class="ti ti-flag me-1"></i>Cambio de Estado';

            case 'client_assignment':
                return '<i class="ti ti-building me-1"></i>Asignación de Cliente';

            case 'general_edit':
            default:
                return '<i class="ti ti-clipboard-list me-1"></i>¿Qué cambió?';
        }
    }

    getRelevantChanges(edit) {
        const changes = edit.changes || {};
        const relevantChanges = { ...changes };
        const actionType = this.getActionType(edit);

        switch (actionType) {
            case 'ownership_transfer':
                // Remove previousOwner as it's redundant with owner change
                delete relevantChanges.previousOwner;
                break;

            case 'collaborator_added':
                // Hide technical fields, they'll be shown in the action header
                delete relevantChanges.collaboratorAdded;
                delete relevantChanges.role;
                break;

            case 'collaborator_removed':
                // Hide technical field, show in action header
                delete relevantChanges.collaboratorRemoved;
                break;

            case 'role_changed':
                // Keep roleChanged field but format it nicely
                break;

            case 'status_change':
                // Keep status field as primary focus
                break;

            case 'client_assignment':
                // Keep clientId as primary focus
                break;

            case 'general_edit':
                // Show all fields for general edits
                break;
        }

        return relevantChanges;
    }

    async formatEditDetailsForExpansion(edit) {
        if (!edit.changes && !edit.previousValues && !edit.newValues) {
            return '<div class="alert alert-info border-0 bg-white"><i class="ti ti-info-circle me-2"></i>No hay detalles de cambios disponibles.</div>';
        }

        const changes = edit.changes || {};
        const previousValues = edit.previousValues || {};
        const newValues = edit.newValues || {};

        if (Object.keys(changes).length === 0) {
            return '<div class="alert alert-info border-0 bg-white"><i class="ti ti-info-circle me-2"></i>No se registraron cambios específicos.</div>';
        }

        // Get only relevant changes (filtered for ownership transfers)
        const relevantChanges = this.getRelevantChanges(edit);
        const actionType = this.getActionType(edit);

        // If relevantChanges is empty due to collaboration filtering, show collaboration details
        if (Object.keys(relevantChanges).length === 0) {
            if (actionType === 'collaborator_added' || actionType === 'collaborator_removed') {
                return await this.formatCollaborationDetails(edit, actionType);
            }
            return '<div class="alert alert-info border-0 bg-white"><i class="ti ti-info-circle me-2"></i>No hay cambios relevantes para mostrar.</div>';
        }

        let html = '<div class="changes-summary mt-2">';

        // Get action header (actionType already declared above)
        const actionHeader = await this.getActionHeader(edit, actionType);

        html += `<strong class="text-dark mb-2 d-block">${actionHeader}</strong>`;

        // Create user-friendly change cards
        html += '<div class="changes-grid row g-2">';

        for (const field of Object.keys(relevantChanges)) {
            const fieldName = this.getFieldDisplayName(field);
            const icon = this.getChangeIcon(field);
            const oldVal = await this.formatUserFriendlyValue(field, previousValues[field], edit);
            const newVal = await this.formatUserFriendlyValue(field, newValues[field], edit);

            html += `
                <div class="col-12">
                    <div class="change-card p-2 bg-white border rounded">
                        <div class="d-flex align-items-center mb-2">
                            <i class="${icon} text-primary me-2"></i>
                            <strong class="text-dark">${fieldName}</strong>
                        </div>
                        <div class="change-flow d-flex align-items-center">
                            <div class="change-from p-2 bg-light rounded text-center flex-fill">
                                <div class="small text-muted">Antes</div>
                                <div class="fw-medium text-danger">${oldVal}</div>
                            </div>
                            <div class="mx-2">
                                <i class="ti ti-arrow-right text-muted"></i>
                            </div>
                            <div class="change-to p-2 bg-success-subtle rounded text-center flex-fill">
                                <div class="small text-muted">Ahora</div>
                                <div class="fw-medium text-success">${newVal}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    async formatCollaborationDetails(edit, actionType) {
        const changes = edit.changes || {};
        let html = '<div class="changes-summary mt-2">';

        // Get action header
        const actionHeader = await this.getActionHeader(edit, actionType);
        html += `<strong class="text-dark mb-3 d-block">${actionHeader}</strong>`;

        // Create details cards
        html += '<div class="collaboration-details">';

        if (actionType === 'collaborator_added') {
            const userId = changes.collaboratorAdded;
            const role = changes.role;
            const userInfo = await this.getUserInfo(userId);
            const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}`.trim() : 'Usuario desconocido';
            const roleText = role === 'editor' ? 'Editor' : 'Visualizador';

            // Get who performed the action - use edit.editor which is the actual field
            let editorName = 'Usuario desconocido';
            if (edit.editor && edit.editor.firstName && edit.editor.lastName) {
                editorName = `${edit.editor.firstName} ${edit.editor.lastName}`.trim();
            } else if (edit.editor && edit.editor.id) {
                // Fallback to getUserInfo if we only have ID
                const editorInfo = await this.getUserInfo(edit.editor.id);
                editorName = editorInfo ? `${editorInfo.firstName} ${editorInfo.lastName}`.trim() : 'Usuario desconocido';
            }

            html += `
                <div class="row g-2">
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-white border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-user text-primary me-2"></i>
                                <strong class="text-dark small">Usuario agregado</strong>
                            </div>
                            <div class="detail-value text-success fw-medium">${userName}</div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-white border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-shield text-primary me-2"></i>
                                <strong class="text-dark small">Rol asignado</strong>
                            </div>
                            <div class="detail-value text-success fw-medium">${roleText}</div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-light border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-user-check text-primary me-2"></i>
                                <strong class="text-dark small">Agregado por</strong>
                            </div>
                            <div class="detail-value text-primary fw-medium">${editorName}</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (actionType === 'collaborator_removed') {
            const userId = changes.collaboratorRemoved;
            const reason = changes.reason || edit.description;
            const userInfo = await this.getUserInfo(userId);
            const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}`.trim() : 'Usuario desconocido';

            // Get who performed the action - use edit.editor which is the actual field
            let editorName = 'Usuario desconocido';
            if (edit.editor && edit.editor.firstName && edit.editor.lastName) {
                editorName = `${edit.editor.firstName} ${edit.editor.lastName}`.trim();
            } else if (edit.editor && edit.editor.id) {
                // Fallback to getUserInfo if we only have ID
                const editorInfo = await this.getUserInfo(edit.editor.id);
                editorName = editorInfo ? `${editorInfo.firstName} ${editorInfo.lastName}`.trim() : 'Usuario desconocido';
            }

            // Clean reason text
            let cleanReason = 'No especificada';
            if (reason && !reason.includes('collaboratorRemoved') && reason.trim() !== '') {
                cleanReason = reason;
            }

            html += `
                <div class="row g-2">
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-white border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-user text-primary me-2"></i>
                                <strong class="text-dark small">Usuario removido</strong>
                            </div>
                            <div class="detail-value text-danger fw-medium">${userName}</div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-white border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-message-circle text-primary me-2"></i>
                                <strong class="text-dark small">Razón</strong>
                            </div>
                            <div class="detail-value text-muted fw-medium">${cleanReason}</div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="detail-card p-3 bg-light border rounded h-100">
                            <div class="d-flex align-items-center mb-2">
                                <i class="ti ti-user-check text-primary me-2"></i>
                                <strong class="text-dark small">Removido por</strong>
                            </div>
                            <div class="detail-value text-primary fw-medium">${editorName}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Note: "Acción realizada por" is now integrated into the 3-column layout above

        html += '</div></div>';
        return html;
    }

    formatEditDetailsForDisplay(edit) {
        // Keep this method for backward compatibility if needed elsewhere
        return this.formatEditDetailsForExpansion(edit);
    }

    formatDisplayValue(value) {
        if (value === null || value === undefined) {
            return '<em class="text-muted">vacío</em>';
        }
        if (typeof value === 'object') {
            return '<code>' + JSON.stringify(value, null, 2) + '</code>';
        }
        if (typeof value === 'boolean') {
            return value ? '<span class="badge bg-success">Sí</span>' : '<span class="badge bg-danger">No</span>';
        }
        return String(value);
    }

    getFieldDisplayName(field) {
        const fieldMap = {
            'owner': 'Propietario',
            'previousOwner': 'Propietario Anterior',
            'status': 'Estado',
            'clientId': 'Cliente',
            'agentId': 'Agente',
            'createdBy': 'Creado Por',
            'modifiedBy': 'Modificado Por',
            'approvalStatus': 'Estado de Aprobación',
            'priority': 'Prioridad',
            'department': 'Departamento',
            // Collaboration fields (usually hidden by filtering)
            'collaboratorAdded': 'Colaborador Agregado',
            'collaboratorRemoved': 'Colaborador Removido',
            'roleChanged': 'Cambio de Rol',
            'role': 'Rol',
            // Additional common fields
            'updatedAt': 'Última Actualización',
            'createdAt': 'Fecha de Creación',
            'description': 'Descripción',
            'notes': 'Notas',
            'reason': 'Razón',
            'type': 'Tipo'
        };
        return fieldMap[field] || field;
    }

    getChangeIcon(field) {
        const iconMap = {
            'owner': 'ti-user-check',
            'previousOwner': 'ti-user-x',
            'status': 'ti-flag',
            'clientId': 'ti-building',
            'agentId': 'ti-user-circle',
            'department': 'ti-building-store',
            // Collaboration icons
            'collaboratorAdded': 'ti-user-plus',
            'collaboratorRemoved': 'ti-user-minus',
            'roleChanged': 'ti-shield-check',
            'role': 'ti-shield',
            // Additional icons
            'priority': 'ti-star',
            'description': 'ti-file-text',
            'notes': 'ti-note',
            'reason': 'ti-message-circle',
            'type': 'ti-tag',
            'createdBy': 'ti-user-plus',
            'modifiedBy': 'ti-user-edit',
            'approvalStatus': 'ti-check-circle'
        };
        return iconMap[field] || 'ti-edit';
    }

    async getUserInfo(userId) {
        if (!userId || userId === null || userId === undefined || userId === 'undefined') {
            return {
                name: 'Usuario desconocido',
                firstName: 'Usuario',
                lastName: 'desconocido',
                email: ''
            };
        }

        // Check cache first
        if (this.userCache.has(userId)) {
            return this.userCache.get(userId);
        }

        try {
            // Try to get user info from available users endpoint (which we know exists)
            const response = await fetch(`/api/quotes/${this.quoteId}/available-owners`, {
                headers: {
                    'Authorization': `Bearer ${this.getAccessToken()}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const users = data.data || [];

                // Find the user by ID
                const user = users.find(u => u.id === userId);
                if (user) {
                    const userInfo = {
                        name: `${user.firstName || 'Usuario'} ${user.lastName || 'desconocido'}`,
                        firstName: user.firstName || 'Usuario',
                        lastName: user.lastName || 'desconocido',
                        email: user.email || ''
                    };
                    this.userCache.set(userId, userInfo);
                    return userInfo;
                }
            }

            // If not found in available users, try to get from current edit data
            if (this.owner && this.owner.id === userId) {
                const userInfo = {
                    name: `${this.owner.firstName || 'Usuario'} ${this.owner.lastName || 'desconocido'}`,
                    firstName: this.owner.firstName || 'Usuario',
                    lastName: this.owner.lastName || 'desconocido',
                    email: this.owner.email || ''
                };
                this.userCache.set(userId, userInfo);
                return userInfo;
            }

            // Check agents
            const agent = this.agents?.find(a => a.agent.id === userId);
            if (agent) {
                const userInfo = {
                    name: `${agent.agent.firstName || 'Usuario'} ${agent.agent.lastName || 'desconocido'}`,
                    firstName: agent.agent.firstName || 'Usuario',
                    lastName: agent.agent.lastName || 'desconocido',
                    email: agent.agent.email || ''
                };
                this.userCache.set(userId, userInfo);
                return userInfo;
            }

            // Fallback: return ID with indication it's not resolved
            const fallback = {
                name: `Usuario ${userId.substring(0, 8)}...`,
                firstName: 'Usuario',
                lastName: 'desconocido',
                email: ''
            };
            this.userCache.set(userId, fallback);
            return fallback;

        } catch (error) {
            console.warn('Error fetching user info for:', userId, error);
            const fallback = {
                name: 'Usuario desconocido',
                firstName: 'Usuario',
                lastName: 'desconocido',
                email: ''
            };
            this.userCache.set(userId, fallback);
            return fallback;
        }
    }

    async formatUserFriendlyValue(field, value, edit) {
        // Handle null/undefined values first
        if (value === null || value === undefined) {
            return 'Sin especificar';
        }

        // Format specific field types for business users
        switch (field) {
            case 'collaboratorAdded':
            case 'collaboratorRemoved':
                // These are user IDs - get user name
                const userInfo = await this.getUserInfo(value);
                return userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : 'Usuario desconocido';

            case 'role':
                const roleMap = {
                    'editor': 'Editor',
                    'viewer': 'Visualizador',
                    'owner': 'Propietario',
                    'admin': 'Administrador'
                };
                return roleMap[value] || value;

            case 'roleChanged':
                // This might be an object with from/to values
                if (typeof value === 'object' && value.from && value.to) {
                    const fromRole = this.formatUserFriendlyValue('role', value.from, edit);
                    const toRole = this.formatUserFriendlyValue('role', value.to, edit);
                    return `${fromRole} → ${toRole}`;
                }
                return String(value);

            case 'status':
                const statusMap = {
                    'draft': 'Borrador',
                    'pending': 'Pendiente',
                    'approved': 'Aprobado',
                    'rejected': 'Rechazado',
                    'active': 'Activo',
                    'inactive': 'Inactivo'
                };
                return statusMap[value] || value;

            case 'priority':
                const priorityMap = {
                    'low': 'Baja',
                    'medium': 'Media',
                    'high': 'Alta',
                    'urgent': 'Urgente'
                };
                return priorityMap[value] || value;

            default:
                // If it looks like a user ID, try to get user name
                if (typeof value === 'string' && (field.includes('owner') || field.includes('agent') || field.includes('By'))) {
                    if (!value) return 'Sin asignar';

                    const userInfo = await this.getUserInfo(value);
                    return userInfo ? userInfo.name : 'Usuario desconocido';
                }

                return String(value);
        }
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showError(message) {
        this.showToast(message, 'error');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Get quote ID from page - could be from window, data attribute, or hidden input
    const quoteId = window.quoteId ||
        document.querySelector('[data-quote-id]')?.dataset.quoteId ||
        document.getElementById('quoteId')?.value ||
        'new';

    console.log('Initializing QuoteOwnershipManager with quoteId:', quoteId);

    // Always initialize the manager, even for new quotes
    // The manager handles both new and existing quotes
    window.quoteOwnership = new QuoteOwnershipManager(quoteId);
});