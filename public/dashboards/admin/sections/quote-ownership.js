/**
 * Quote Ownership & Collaboration Management
 * Handles ownership transfers, collaborator management, and edit history
 * Created by Denisse Maldonado
 */

class QuoteOwnershipManager {
    constructor(quoteId) {
        this.quoteId = quoteId;
        this.currentUser = null;
        this.owner = null;
        this.agents = [];
        this.userAccess = null;
        this.pendingEdits = [];
        
        this.init();
    }

    async init() {
        try {
            
            // Load initial data
            await Promise.all([
                this.loadOwnership(),
                this.loadUserAccess(),
                this.loadAgents()
            ]);
            
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
            const response = await fetch(`/api/quotes/${this.quoteId}/ownership`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            
            if (response.ok) {
                const data = await response.json();
                this.owner = data.data;
                this.displayOwner();
            } else {
                console.error('Failed to load ownership:', response.status);
            }
        } catch (error) {
            console.error('Error loading ownership:', error);
        }
    }

    async loadUserAccess() {
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/access`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.agents = data.data;
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
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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
        
        
        // Handle placeholder ownership
        if (this.owner.isPlaceholder) {
            // Don't show error-related placeholders, show friendly message
            if (this.owner.ownershipType === 'error' || this.owner.ownershipType === 'not-found') {
                document.getElementById('ownerName').innerHTML = 
                    '<span class="text-muted">Sin asignar</span>';
                document.getElementById('ownerEmail').innerHTML = 
                    '<span class="text-muted">-</span>';
                document.getElementById('ownerSince').textContent = '';
            } else if (this.owner.ownershipType === 'unassigned') {
                document.getElementById('ownerName').innerHTML = 
                    '<span class="text-warning">Sin propietario</span>';
                document.getElementById('ownerEmail').innerHTML = 
                    '<span class="text-muted">Requiere asignación</span>';
                document.getElementById('ownerSince').textContent = 
                    'Creada: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
            } else {
                document.getElementById('ownerName').innerHTML = 
                    '<span class="text-warning">' + this.owner.firstName + ' ' + this.owner.lastName + '</span>';
                document.getElementById('ownerEmail').innerHTML = 
                    '<span class="text-muted">Sin propietario asignado</span>';
                document.getElementById('ownerSince').textContent = 
                    'Creada: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
            }
        } else if (this.owner.isDefaultOwner) {
            // This is the createdBy user shown as default owner
            document.getElementById('ownerName').innerHTML = 
                `${this.owner.firstName} ${this.owner.lastName} <small class="text-muted">(Creador)</small>`;
            document.getElementById('ownerEmail').textContent = this.owner.email;
            document.getElementById('ownerSince').textContent = 
                'Creó: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
        } else {
            // This is a formally assigned owner
            document.getElementById('ownerName').textContent = 
                this.owner.firstName + ' ' + this.owner.lastName;
            document.getElementById('ownerEmail').textContent = this.owner.email;
            document.getElementById('ownerSince').textContent = 
                'Desde: ' + new Date(this.owner.ownershipStartDate).toLocaleDateString('es-MX');
        }
        
        // Store transfer capability for use in consolidated modal
        const userRole = window.currentUser?.role || '';
        this.canTransfer = (
            (this.userAccess && this.userAccess.role === 'owner' && !this.owner.isPlaceholder) ||
            (userRole === 'admin' || userRole === 'superadmin') ||
            (this.owner && this.owner.needsAssignment)
        );
    }

    displayUserAccess() {
        if (!this.userAccess) return;
        
        const accessDiv = document.getElementById('currentUserAccess');
        const roleSpan = document.getElementById('userAccessRole');
        const detailsDiv = document.getElementById('userAccessDetails');
        
        // Handle placeholder access
        if (this.userAccess.isPlaceholder) {
            // Don't show error messages, just hide the access info or show minimal info
            if (this.userAccess.error) {
                // Hide the access panel for errors
                accessDiv.classList.add('d-none');
                return;
            } else {
                accessDiv.classList.remove('d-none');
                roleSpan.textContent = 'Visualizador';
                detailsDiv.innerHTML = '<span class="text-muted">Solo lectura</span>';
                return;
            }
        }
        
        // Only show if not owner (owner info is already displayed)
        if (this.userAccess.role !== 'owner') {
            accessDiv.classList.remove('d-none');
            
            let roleText = this.userAccess.role === 'editor' ? 'Editor' : 'Visualizador';
            roleSpan.textContent = roleText;
            
            let details = [];
            if (this.userAccess.canEdit) {
                details.push('Puedes editar la cotización');
            } else {
                details.push('Solo puedes ver la cotización');
            }
            
            if (this.userAccess.expiresAt) {
                const expiryDate = new Date(this.userAccess.expiresAt);
                details.push(`Expira: ${expiryDate.toLocaleDateString('es-MX')}`);
            }
            
            detailsDiv.textContent = details.join(' • ');
        }
        
        // Show/hide owner-only features with admin override
        const userRole = window.currentUser?.role || '';
        const isOwner = this.userAccess.role === 'owner';
        const isAdmin = userRole === 'admin' || userRole === 'superadmin';
        
        // Manage agents - only for admins and department managers
        const manageBtn = document.getElementById('btnManageCollaborators');
        if (manageBtn) {
            const canManage = isAdmin || userRole === 'department_manager';
            if (canManage) {
                manageBtn.classList.remove('d-none');
            } else {
                manageBtn.classList.add('d-none');
            }
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
        
        if (this.agents.length === 0) {
            listDiv.innerHTML = `
                <div class="text-center py-3 text-muted">
                    <i class="ti ti-users-off mb-2" style="font-size: 2rem;"></i>
                    <p class="mb-0">No hay agentes asignados</p>
                </div>
            `;
            return;
        }
        
        let html = '<div class="agents-grid">';
        
        this.agents.forEach(collab => {
            const agent = collab.agent;
            const roleClass = collab.role === 'editor' ? 'editor' : 'viewer';
            const roleIcon = collab.role === 'editor' ? 'ti-pencil' : 'ti-eye';
            const roleText = collab.role === 'editor' ? 'Editor' : 'Visualizador';
            
            html += `
                <div class="collaborator-item" data-agent-id="${agent.id}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center">
                            <div class="avatar avatar-sm bg-secondary-subtle text-secondary rounded-circle me-3">
                                <i class="ti ti-user"></i>
                            </div>
                            <div>
                                <div class="fw-semibold">${agent.firstName} ${agent.lastName}</div>
                                <small class="text-muted">${agent.email}</small>
                            </div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="role-badge ${roleClass}">
                                <i class="ti ${roleIcon} me-1"></i>${roleText}
                            </span>
                            ${this.userAccess && this.userAccess.role === 'owner' ? `
                                <button class="btn btn-sm btn-outline-danger btn-remove-agent" 
                                        data-agent-id="${agent.id}"
                                        data-agent-name="${agent.firstName} ${agent.lastName}">
                                    <i class="ti ti-x"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    ${collab.lastActivity ? `
                        <div class="mt-2 small text-muted">
                            <i class="ti ti-clock me-1"></i>
                            Última actividad: ${new Date(collab.lastActivity.date).toLocaleDateString('es-MX')}
                        </div>
                    ` : ''}
                </div>
            `;
        });
        
        html += '</div>';
        listDiv.innerHTML = html;
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
        
        // Add agent button
        const addCollabBtn = document.getElementById('btnAddCollaborator');
        if (addCollabBtn) {
            addCollabBtn.addEventListener('click', () => this.addAgent());
        }
        
        // Remove agent buttons (delegated)
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-remove-agent')) {
                const btn = e.target.closest('.btn-remove-agent');
                this.removeAgent(btn.dataset.agentId, btn.dataset.agentName);
            }
        });
    }


    async showCollaboratorsModal() {
        // Check if quote has a client selected first
        const clientField = document.getElementById('clientId');
        if (clientField) {
            const clientValue = clientField.value || clientField.tomselect?.getValue();
            if (!clientValue) {
                this.showError('Por favor selecciona un cliente antes de gestionar la propiedad');
                clientField.classList.add('is-invalid');
                clientField.focus();
                // Scroll to client field if needed
                clientField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
        }
        
        const modal = new bootstrap.Modal(document.getElementById('manageCollaboratorsModal'));
        
        // Update ownership section in modal
        this.displayOwnershipInModal();
        
        // Show/hide ownership transfer section based on permissions  
        const ownershipSection = document.getElementById('ownershipTransferSection');
        const transferForm = document.getElementById('transferOwnershipForm');
        const userRole = window.currentUser?.role || '';
        const isAdmin = userRole === 'admin' || userRole === 'superadmin';
        const canManage = isAdmin || userRole === 'department_manager';
        
        if (this.canTransfer && canManage) {
            ownershipSection.style.display = 'block';
            transferForm.style.display = 'block';
            
            // Update warning text based on ownership state
            const warningDiv = transferForm.querySelector('.alert-warning');
            if (this.owner && this.owner.needsAssignment) {
                warningDiv.innerHTML = `
                    <i class="ti ti-info-circle me-2"></i>
                    <strong>Asignación:</strong> Esta cotización no tiene propietario asignado. 
                    Selecciona un usuario para convertirlo en el propietario.
                `;
                warningDiv.className = 'alert alert-info';
            } else {
                warningDiv.innerHTML = `
                    <i class="ti ti-alert-triangle me-2"></i>
                    <strong>Importante:</strong> Al transferir la propiedad, perderás el control total sobre esta cotización.
                    Mantendrás acceso como editor.
                `;
                warningDiv.className = 'alert alert-warning';
            }
            
            // Update button text
            const confirmBtn = document.getElementById('btnConfirmTransferMain');
            if (this.owner && this.owner.needsAssignment) {
                confirmBtn.innerHTML = '<i class="ti ti-user-plus me-1"></i>Asignar Propietario';
                confirmBtn.className = 'btn btn-primary w-100';
            } else {
                confirmBtn.innerHTML = '<i class="ti ti-transfer me-1"></i>Transferir';
                confirmBtn.className = 'btn btn-warning w-100';
            }
        } else {
            ownershipSection.style.display = 'none';
        }
        
        // Load available users for both ownership and collaboration
        await Promise.all([
            this.loadAvailableUsers('newOwnerSelectMain'),
            this.loadAvailableUsers('collaboratorSelect')
        ]);
        
        // Display current agents in management view
        await this.displayAgentsManagement();
        
        modal.show();
    }

    async showEditHistory() {
        const modal = new bootstrap.Modal(document.getElementById('editHistoryModal'));
        modal.show();
        
        // Load edit history
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.displayEditHistory(data.data);
            }
        } catch (error) {
            console.error('Error loading edit history:', error);
        }
    }

    async showPendingEdits() {
        const modal = new bootstrap.Modal(document.getElementById('reviewEditsModal'));
        modal.show();
        
        // Load and display pending edits
        await this.loadPendingEdits();
        this.displayPendingEditsForReview();
    }

    displayEditHistory(edits) {
        const tbody = document.querySelector('#editHistoryTable tbody');
        
        if (edits.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-3 text-muted">
                        No hay historial de cambios
                    </td>
                </tr>
            `;
            return;
        }
        
        let html = '';
        edits.forEach(edit => {
            const statusBadge = this.getStatusBadge(edit.approvalStatus);
            const changedFieldsList = edit.changedFields.join(', ');
            
            html += `
                <tr>
                    <td><strong>v${edit.version}</strong></td>
                    <td>${new Date(edit.editedAt).toLocaleString('es-MX')}</td>
                    <td>
                        <div>
                            <div class="fw-semibold">${edit.editor.firstName} ${edit.editor.lastName}</div>
                            <small class="text-muted">${edit.editorRole}</small>
                        </div>
                    </td>
                    <td>
                        <div class="small">
                            <div>${edit.description}</div>
                            <div class="text-muted">Campos: ${changedFieldsList}</div>
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" 
                                onclick="quoteOwnership.viewEditDetails('${edit.id}')">
                            <i class="ti ti-eye"></i>
                        </button>
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
                        <button class="btn btn-sm btn-success" 
                                onclick="quoteOwnership.approveEdit('${edit.id}')">
                            <i class="ti ti-check me-1"></i>Aprobar
                        </button>
                        <button class="btn btn-sm btn-danger" 
                                onclick="quoteOwnership.rejectEdit('${edit.id}')">
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
            // Use department-filtered endpoint for both ownership transfers and agent additions
            const endpoint = `/api/quotes/${this.quoteId}/available-owners`;
            
            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            // Handle missing client error
            if (!response.ok && response.status === 400) {
                const errorData = await response.json();
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
            }
            
            if (response.ok) {
                const responseData = await response.json();
                const select = document.getElementById(selectId);
                
                select.innerHTML = '<option value="">Seleccionar usuario...</option>';
                
                // Available owners endpoint returns array directly in data
                const users = responseData.data || [];
                
                // Group users by type for better UX
                const departmentManagers = [];
                const clients = [];
                const admins = [];
                const others = [];
                
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
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                }
                
                // Add Admins
                if (admins.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Administradores';
                    admins.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.firstName} ${user.lastName} - ${user.email}`;
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
                }
                
                // Add Others if any
                if (others.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = 'Otros';
                    others.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.firstName} ${user.lastName} - ${user.email}`;
                        optgroup.appendChild(option);
                    });
                    select.appendChild(optgroup);
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
        
        let html = '<div class="list-group">';
        
        this.agents.forEach(collab => {
            const agent = collab.agent;
            
            html += `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${agent.firstName} ${agent.lastName}</strong>
                            <div class="small text-muted">${agent.email}</div>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <select class="form-select form-select-sm" 
                                    onchange="quoteOwnership.updateAgentRole('${agent.id}', this.value)"
                                    style="width: 120px;">
                                <option value="viewer" ${collab.role === 'viewer' ? 'selected' : ''}>Visualizador</option>
                                <option value="editor" ${collab.role === 'editor' ? 'selected' : ''}>Editor</option>
                            </select>
                            <button class="btn btn-sm btn-danger" 
                                    onclick="quoteOwnership.removeAgentFromModal('${agent.id}')">
                                <i class="ti ti-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        listDiv.innerHTML = html;
    }

    displayOwnershipInModal() {
        if (!this.owner) return;
        
        const modalOwnerName = document.getElementById('modalOwnerName');
        const modalOwnerEmail = document.getElementById('modalOwnerEmail');
        
        if (this.owner.isPlaceholder) {
            if (this.owner.ownershipType === 'error' || this.owner.ownershipType === 'not-found') {
                modalOwnerName.innerHTML = '<span class="text-muted">Sin asignar</span>';
                modalOwnerEmail.innerHTML = '<span class="text-muted">-</span>';
            } else if (this.owner.ownershipType === 'unassigned') {
                modalOwnerName.innerHTML = '<span class="text-warning">Sin propietario</span>';
                modalOwnerEmail.innerHTML = '<span class="text-muted">Requiere asignación</span>';
            } else {
                modalOwnerName.innerHTML = '<span class="text-warning">' + this.owner.firstName + ' ' + this.owner.lastName + '</span>';
                modalOwnerEmail.innerHTML = '<span class="text-muted">Sin propietario asignado</span>';
            }
        } else if (this.owner.isDefaultOwner) {
            // Show createdBy user as default owner
            modalOwnerName.innerHTML = `${this.owner.firstName} ${this.owner.lastName} <small class="text-muted">(Creador)</small>`;
            modalOwnerEmail.textContent = this.owner.email;
        } else {
            modalOwnerName.textContent = this.owner.firstName + ' ' + this.owner.lastName;
            modalOwnerEmail.textContent = this.owner.email;
        }
    }

    async transferOwnership() {
        const newOwnerId = document.getElementById('newOwnerSelectMain').value;
        const reason = document.getElementById('transferReasonMain').value;
        
        if (!newOwnerId) {
            this.showError('Por favor selecciona un nuevo propietario');
            return;
        }
        
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/ownership/transfer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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
                
                // Reload ownership data
                await this.loadOwnership();
                await this.loadUserAccess();
                
                // Update the modal display
                this.displayOwnershipInModal();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al transferir propiedad');
            }
        } catch (error) {
            console.error('Error transferring ownership:', error);
            this.showError('Error al transferir propiedad');
        }
    }

    async addAgent() {
        const agentId = document.getElementById('collaboratorSelect').value;
        const role = document.getElementById('collaboratorRole').value;
        
        if (!agentId) {
            this.showError('Por favor selecciona un usuario');
            return;
        }
        
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    agentId,
                    role
                })
            });
            
            if (response.ok) {
                this.showSuccess('Agente agregado exitosamente');
                
                // Reset form
                document.getElementById('collaboratorSelect').value = '';
                document.getElementById('collaboratorRole').value = 'viewer';
                
                // Reload agents
                await this.loadAgents();
                await this.displayAgentsManagement();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al agregar agente');
            }
        } catch (error) {
            console.error('Error adding agent:', error);
            this.showError('Error al agregar agente');
        }
    }

    async removeAgent(agentId, agentName) {
        if (!confirm(`¿Estás seguro de quitar a ${agentName} como agente?`)) {
            return;
        }
        
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${agentId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                this.showSuccess('Agente eliminado exitosamente');
                await this.loadAgents();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al eliminar agente');
            }
        } catch (error) {
            console.error('Error removing agent:', error);
            this.showError('Error al eliminar agente');
        }
    }

    async removeAgentFromModal(agentId) {
        const collab = this.agents.find(c => c.agent.id === agentId);
        if (collab) {
            await this.removeAgent(agentId, `${collab.agent.firstName} ${collab.agent.lastName}`);
            await this.displayAgentsManagement();
        }
    }

    async updateAgentRole(agentId, newRole) {
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/collaborators/${agentId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ role: newRole })
            });
            
            if (response.ok) {
                this.showSuccess('Rol actualizado exitosamente');
                await this.loadAgents();
            } else {
                const error = await response.json();
                this.showError(error.error || 'Error al actualizar rol');
            }
        } catch (error) {
            console.error('Error updating role:', error);
            this.showError('Error al actualizar rol');
        }
    }

    async approveEdit(editId) {
        if (!confirm('¿Aprobar esta edición?')) return;
        
        try {
            const response = await fetch(`/api/quotes/${this.quoteId}/edits/${editId}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
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

    viewEditDetails(editId) {
        // This could open a modal with detailed change view
        console.log('View edit details:', editId);
    }

    showSuccess(message) {
        // Use your existing notification system
        if (window.showNotification) {
            window.showNotification('success', message);
        } else {
            alert(message);
        }
    }

    showError(message) {
        // Use your existing notification system
        if (window.showNotification) {
            window.showNotification('error', message);
        } else {
            alert('Error: ' + message);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Get quote ID from page
    const quoteId = window.quoteId || document.querySelector('[data-quote-id]')?.dataset.quoteId;
    
    if (quoteId && quoteId !== 'new') {
        window.quoteOwnership = new QuoteOwnershipManager(quoteId);
    }
});