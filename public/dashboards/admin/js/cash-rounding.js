/**
 * Cash Rounding Toggle Functionality
 * Handles the cash rounding configuration in admin price settings
 */

function initializeCashRoundingToggle() {
    const toggle = document.getElementById('cashRoundingToggle');
    const saveButton = document.getElementById('saveCashRoundingSetting');
    const statusContainer = document.getElementById('cashRoundingCurrentStatus');
    
    if (!toggle || !saveButton || !statusContainer) {
        console.error('Cash rounding elements not found');
        return;
    }
    
    let originalState = null;
    
    // Get access token from various sources (same as quote-services-v2.js)
    function getAccessToken() {
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
    
    // Load current setting
    loadCashRoundingSetting();
    
    // Handle toggle change
    toggle.addEventListener('change', function() {
        const hasChanged = originalState !== null && toggle.checked !== originalState;
        saveButton.disabled = !hasChanged;
        
        if (hasChanged) {
            saveButton.classList.add('btn-warning');
            saveButton.classList.remove('btn-primary');
            saveButton.innerHTML = '<i class="ti ti-alert-circle me-2"></i>Configuración Modificada - Guardar';
        } else {
            saveButton.classList.remove('btn-warning');
            saveButton.classList.add('btn-primary');
            saveButton.innerHTML = '<i class="ti ti-device-floppy me-2"></i>Guardar Configuración';
        }
    });
    
    // Handle save button click
    saveButton.addEventListener('click', function() {
        saveCashRoundingSetting();
    });
    
    function loadCashRoundingSetting() {
        statusContainer.innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Cargando...</span>
            </div>
            <p class="text-muted mt-2">Verificando configuración...</p>
        `;
        
        const accessToken = getAccessToken();
        if (!accessToken) {
            console.error('No access token found');
            statusContainer.innerHTML = `
                <div class="py-3">
                    <div class="text-danger mb-2">
                        <i class="ti ti-alert-circle fs-4"></i>
                    </div>
                    <h6 class="text-danger mb-1">Error de Autenticación</h6>
                    <p class="text-muted mb-0">No se encontró token de acceso. Por favor, inicie sesión nuevamente.</p>
                </div>
            `;
            return;
        }
        
        fetch('/api/settings/cash-rounding', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error('Error de conexión');
            }
        })
        .then(data => {
            if (data.success) {
                const enabled = data.data.enabled;
                const lastUpdated = data.data.lastUpdated;
                
                toggle.checked = enabled;
                originalState = enabled;
                
                const statusBadge = enabled 
                    ? '<span class="badge bg-success fs-6 px-3 py-2"><i class="ti ti-check me-1"></i>HABILITADO</span>'
                    : '<span class="badge bg-danger fs-6 px-3 py-2"><i class="ti ti-x me-1"></i>DESHABILITADO</span>';
                
                const updateInfo = lastUpdated 
                    ? `<small class="text-muted">Última actualización: ${new Date(lastUpdated).toLocaleString('es-MX')}</small>`
                    : '<small class="text-muted">Configuración por defecto</small>';
                
                statusContainer.innerHTML = `
                    <div class="py-3">
                        <div class="mb-3">${statusBadge}</div>
                        <h6 class="mb-1">${enabled ? 'Redondeo Activo' : 'Redondeo Inactivo'}</h6>
                        <p class="text-muted mb-2">
                            ${enabled ? 'Los precios se redondean a múltiplos de $5 MXN cuando se selecciona efectivo' : 'Los precios se muestran sin redondeo'}
                        </p>
                        ${updateInfo}
                    </div>
                `;
            } else {
                throw new Error(data.error || 'Error al cargar configuración');
            }
        })
        .catch(error => {
            console.error('Error loading cash rounding setting:', error);
            statusContainer.innerHTML = `
                <div class="py-3">
                    <div class="text-danger mb-2">
                        <i class="ti ti-alert-circle fs-4"></i>
                    </div>
                    <h6 class="text-danger mb-1">Error al Cargar</h6>
                    <p class="text-muted mb-0">${error.message}</p>
                </div>
            `;
            
            // Set default state
            toggle.checked = true;
            originalState = true;
        });
    }
    
    function saveCashRoundingSetting() {
        const enabled = toggle.checked;
        
        const accessToken = getAccessToken();
        if (!accessToken) {
            console.error('No access token found');
            if (typeof showAlert === 'function') {
                showAlert('Error de autenticación. Por favor, inicie sesión nuevamente.', 'error');
            }
            return;
        }
        
        saveButton.disabled = true;
        saveButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';
        
        fetch('/api/settings/cash-rounding', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ enabled })
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error('Error de conexión');
            }
        })
        .then(data => {
            if (data.success) {
                originalState = enabled;
                saveButton.disabled = false;
                saveButton.classList.remove('btn-warning');
                saveButton.classList.add('btn-primary');
                saveButton.innerHTML = '<i class="ti ti-device-floppy me-2"></i>Guardar Configuración';
                
                // Refresh the status display
                loadCashRoundingSetting();
                
                // Show success alert
                if (typeof showAlert === 'function') {
                    showAlert('Configuración guardada exitosamente', 'success');
                }
                
                // Refresh the PricingUtils cache
                if (window.PricingUtils && window.PricingUtils.refreshCashRoundingSetting) {
                    window.PricingUtils.refreshCashRoundingSetting();
                }
                
            } else {
                throw new Error(data.error || 'Error al guardar configuración');
            }
        })
        .catch(error => {
            console.error('Error saving cash rounding setting:', error);
            saveButton.disabled = false;
            saveButton.innerHTML = '<i class="ti ti-device-floppy me-2"></i>Guardar Configuración';
            
            if (typeof showAlert === 'function') {
                showAlert('Error al guardar configuración: ' + error.message, 'error');
            }
        });
    }
}

// Initialize cash rounding when DOM is ready if we're on the cash-rounding section
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the price settings page with cash-rounding section
    // OR if we're on the dedicated cash-rounding page
    const urlParams = new URLSearchParams(window.location.search);
    const section = urlParams.get('section');
    const pathname = window.location.pathname;
    
    if (section === 'cash-rounding' || pathname.includes('/cash-rounding')) {
        initializeCashRoundingToggle();
    }
});