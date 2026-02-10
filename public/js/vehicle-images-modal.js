/**
 * Vehicle Images Modal JavaScript
 * Handles the image upload modal with drag & drop, optimization support, and gallery management
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

// Global variables
let currentVehicleId = null;
let vehicleImagesDropzone = null;

/**
 * Open the vehicle images modal
 * @param {string} vehicleId - The ID of the vehicle
 * @param {string} brand - Vehicle brand
 * @param {string} model - Vehicle model
 */
window.openVehicleImagesModal = function(vehicleId, brand, model) {
    if (!vehicleId || vehicleId === 'null' || vehicleId === 'undefined') {
        showAlert('danger', 'Error: ID de vehículo no válido');
        return;
    }
    
    currentVehicleId = vehicleId;
    
    // Update modal title
    const vehicleInfoText = document.getElementById('vehicle-info-text');
    if (vehicleInfoText) {
        vehicleInfoText.textContent = `${brand} ${model}`;
    }
    
    // Show loading state
    showModalLoader();
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('vehicleImagesModal'));
    modal.show();
    
    // Initialize or reinitialize dropzone
    initializeDropzone();
    
    // Load existing images
    loadVehicleImages(vehicleId);
};

/**
 * Initialize Dropzone for image uploads
 */
function initializeDropzone() {
    const dropzoneElement = document.getElementById('vehicle-images-dropzone');
    if (!dropzoneElement) {
        return;
    }
    
    // Capture the vehicle ID to avoid scoping issues in callbacks
    const capturedVehicleId = currentVehicleId;
    
    if (!capturedVehicleId || capturedVehicleId === 'null' || capturedVehicleId === 'undefined') {
        return;
    }
    
    // Check if Dropzone is already attached to this element
    if (dropzoneElement.dropzone) {
        vehicleImagesDropzone = dropzoneElement.dropzone;
        
        // Update the URL for the current vehicle
        vehicleImagesDropzone.options.url = `/api/vehicles/${capturedVehicleId}/images`;
        
        // Clear any existing files from previous modal opens
        vehicleImagesDropzone.removeAllFiles(true);
        return;
    }
    
    // Destroy existing dropzone if it exists from our global variable
    if (vehicleImagesDropzone) {
        vehicleImagesDropzone.destroy();
        vehicleImagesDropzone = null;
    }
    
    vehicleImagesDropzone = new Dropzone(dropzoneElement, {
        url: `/api/vehicles/${capturedVehicleId}/images`,
        method: 'POST',
        paramName: 'image',
        maxFilesize: 10, // 10MB
        acceptedFiles: '.jpg,.jpeg,.png,.webp',
        addRemoveLinks: true,
        dictDefaultMessage: 'Arrastra imágenes aquí o haz clic para seleccionar',
        dictFallbackMessage: 'Tu navegador no soporta drag & drop.',
        dictFallbackText: 'Usa el formulario para subir archivos.',
        dictFileTooBig: 'El archivo es muy grande ({{filesize}}MB). Tamaño máximo: {{maxFilesize}}MB.',
        dictInvalidFileType: 'Tipo de archivo no válido. Solo se permiten imágenes.',
        dictResponseError: 'Error del servidor.',
        dictRemoveFile: 'Eliminar archivo',
        dictCancelUpload: 'Cancelar subida',
        dictCancelUploadConfirmation: '¿Cancelar la subida?',
        dictUploadCanceled: 'Subida cancelada',
        dictMaxFilesExceeded: 'No puedes subir más archivos.',
        headers: {},
        sending: async function(file, xhr, formData) {
            showUploadProgress(true);
            
            // Get token before sending
            try {
                const tokenResponse = await fetch('/api/auth/current-token', {
                    method: 'GET',
                    credentials: 'include'
                });
                
                if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json();
                    if (tokenData.success && tokenData.token) {
                        xhr.setRequestHeader('Authorization', `Bearer ${tokenData.token}`);
                    }
                }
            } catch (error) {
                // Could not retrieve auth token
            }
        },
        success: function(file, response) {
            
            if (response.success) {
                showAlert('success', 'Imagen subida exitosamente');
                
                // Remove file from dropzone
                this.removeFile(file);
                
                // Validate capturedVehicleId before calling loadVehicleImages
                if (!capturedVehicleId || capturedVehicleId === 'null' || capturedVehicleId === 'undefined') {
                    if (currentVehicleId && currentVehicleId !== 'null' && currentVehicleId !== 'undefined') {
                        loadVehicleImages(currentVehicleId);
                    } else {
                        showAlert('danger', 'Error: No se puede recargar las imágenes - ID de vehículo perdido');
                    }
                } else {
                    // Reload images gallery using captured vehicle ID to avoid scoping issues
                    loadVehicleImages(capturedVehicleId);
                }
                
                // Check if optimization is enabled
                if (response.data && response.data.optimizationId) {
                    showAlert('info', 'Imagen procesándose en segundo plano para optimización');
                }
            } else {
                showAlert('danger', response.error || 'Error al subir la imagen');
            }
        },
        error: function(file, errorMessage, xhr) {
            
            let message = 'Error al subir la imagen';
            if (typeof errorMessage === 'string') {
                message = errorMessage;
            } else if (errorMessage.error) {
                message = errorMessage.error;
            } else if (xhr && xhr.responseJSON && xhr.responseJSON.error) {
                message = xhr.responseJSON.error;
            }
            
            showAlert('danger', message);
        },
        complete: function() {
            showUploadProgress(false);
        }
    });
}

/**
 * Load vehicle images from API
 * @param {string} vehicleId - Vehicle ID
 */
async function loadVehicleImages(vehicleId) {
    // CRITICAL DEBUG: Log every call to this function
    const debugData = {
        receivedVehicleId: vehicleId,
        globalCurrentVehicleId: currentVehicleId,
        timestamp: new Date().toISOString(),
        callStack: new Error().stack
    };
    
    
    // Send debug info to server for tracking
    fetch('/api/debug/load-vehicle-images-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(debugData)
    }).catch(() => {}); // Silent fail
    
    if (!vehicleId || vehicleId === 'null' || vehicleId === 'undefined') {
        
        // Send an alert to server logs to track this issue
        fetch('/api/debug/null-vehicle-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'NULL_VEHICLE_ID_DETECTED',
                vehicleId: vehicleId,
                currentVehicleId: currentVehicleId,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href,
                callStack: new Error().stack
            })
        }).catch(() => {}); // Silent fail
        
        hideModalLoader();
        showAlert('danger', 'Error: ID de vehículo no válido');
        return;
    }
    
    showModalLoader();
    
    try {
        // Get current session token
        const tokenResponse = await fetch('/api/auth/current-token', {
            method: 'GET',
            credentials: 'include'
        });
        
        let headers = {
            'Accept': 'image/avif,image/webp,image/*'
        };
        
        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            if (tokenData.success && tokenData.token) {
                headers['Authorization'] = `Bearer ${tokenData.token}`;
            }
        }
        
        const response = await fetch(`/api/vehicles/${vehicleId}/images`, {
            method: 'GET',
            headers: headers,
            credentials: 'include'
        });
        
        const data = await response.json();
        hideModalLoader();
        
        
        if (data.success) {
            renderImagesGallery(data.data);
            updateImagesCount(data.data.length);
        } else {
            showAlert('danger', data.error || 'Error al cargar las imágenes');
        }
    } catch (error) {
        hideModalLoader();
        showAlert('danger', 'Error al cargar las imágenes');
    }
}

/**
 * Render images gallery
 * @param {Array} images - Array of image objects
 */
function renderImagesGallery(images) {
    const gridContainer = document.getElementById('images-grid');
    const emptyState = document.getElementById('images-empty-state');
    
    if (!images || images.length === 0) {
        gridContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    gridContainer.style.display = 'flex';
    emptyState.style.display = 'none';
    
    // Clear existing content
    gridContainer.innerHTML = '';
    
    // Create image cards
    images.forEach(image => {
        const imageCard = createImageCard(image);
        gridContainer.appendChild(imageCard);
    });
}

/**
 * Create an image card element
 * @param {Object} image - Image data
 * @returns {HTMLElement} Image card element
 */
function createImageCard(image) {
    
    const card = document.createElement('div');
    card.className = 'col-md-4 col-sm-6';
    card.innerHTML = `
        <div class="card image-card" data-image-id="${image.id}">
            <div class="position-relative">
                <img src="${image.url}" 
                     alt="Vehicle image" 
                     class="card-img-top vehicle-image" 
                     loading="lazy"
                     style="height: 200px; object-fit: cover; cursor: pointer;">
                
                ${image.isPrimary ? '<span class="badge bg-success position-absolute top-0 start-0 m-2">Principal</span>' : ''}
                
                <div class="position-absolute top-0 end-0 m-2">
                    <div class="btn-group-vertical" role="group">
                        ${!image.isPrimary ? `
                            <button type="button" 
                                    class="btn btn-sm btn-primary set-primary-btn" 
                                    data-image-id="${image.id}"
                                    title="Establecer como principal">
                                <i class="ti ti-star"></i>
                            </button>
                        ` : ''}
                        <button type="button" 
                                class="btn btn-sm btn-danger delete-image-btn" 
                                data-image-id="${image.id}"
                                title="Eliminar imagen">
                            <i class="ti ti-trash"></i>
                        </button>
                    </div>
                </div>
                
                ${(() => {
                    // Determine the format being displayed
                    let displayFormat = 'ORIGINAL';
                    
                    if (image.url) {
                        // Try to detect format from URL - check for optimized path patterns
                        // The optimized images are stored in 'optimized/' subfolder with format extensions
                        if (image.url.includes('/optimized/') && image.url.includes('.avif')) {
                            displayFormat = 'AVIF';
                        } else if (image.url.includes('/optimized/') && image.url.includes('.webp')) {
                            displayFormat = 'WEBP';
                        } else if (image.url.includes('/optimized/') && (image.url.includes('.jpg') || image.url.includes('.jpeg'))) {
                            displayFormat = 'JPEG';
                        } else if (image.url.includes('.avif')) {
                            displayFormat = 'AVIF';
                        } else if (image.url.includes('.webp')) {
                            displayFormat = 'WEBP';
                        } else if (image.url.includes('.jpg') || image.url.includes('.jpeg')) {
                            displayFormat = 'JPEG';
                        } else if (image.url.includes('.png')) {
                            displayFormat = 'PNG';
                        }
                    }
                    
                    // Only show badge if image is optimized
                    if (image.optimizationMetadata && image.optimizationMetadata.optimized) {
                        return `
                            <div class="position-absolute bottom-0 start-0 m-2">
                                <span class="badge bg-info" title="Formato: ${displayFormat}">
                                    <i class="ti ti-photo"></i> ${displayFormat}
                                </span>
                            </div>
                        `;
                    }
                    return '';
                })()}
            </div>
            
            <div class="card-body p-2">
                <small class="text-muted">
                    <i class="ti ti-file"></i> ${image.fileName || 'Imagen'}<br>
                    <i class="ti ti-weight"></i> ${formatFileSize(image.fileSize)}
                    ${(() => {
                        // Handle potential Parse object or proxy wrapping
                        let metadata = image.optimizationMetadata || {};
                        
                        // If metadata looks like an object but properties aren't accessible,
                        // try to extract the actual data
                        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
                            // Force conversion to plain object
                            try {
                                // This handles Parse objects or other wrapped objects
                                const metadataStr = JSON.stringify(metadata);
                                metadata = JSON.parse(metadataStr);
                            } catch (e) {
                                // Silently handle parse errors
                            }
                        }
                        
                        // Handle both old and new metadata structures
                        // Check for availableFormats first (from ImageOptimizationService)
                        // Then check for formats (from database/ServerImageOptimizationService)
                        let availableFormats = metadata.availableFormats || metadata.formats || [];
                        
                        // Try different ways to access formats if the above didn't work
                        if ((!availableFormats || availableFormats.length === 0)) {
                            // Try accessing through bracket notation
                            if (metadata['formats']) {
                                availableFormats = metadata['formats'];
                            } 
                            // Try parsing the entire metadata if it's a string
                            else if (typeof metadata === 'string') {
                                try {
                                    const parsed = JSON.parse(metadata);
                                    availableFormats = parsed.formats || parsed.availableFormats || [];
                                } catch (e) {
                                    // Silently handle parse errors
                                }
                            }
                            // Try extracting from JSON representation
                            else {
                                try {
                                    const metadataStr = JSON.stringify(metadata);
                                    const reparsed = JSON.parse(metadataStr);
                                    availableFormats = reparsed.formats || reparsed.availableFormats || [];
                                } catch (e) {
                                    // Silently handle parse errors
                                }
                            }
                        }
                        
                        // Handle case where formats might be a string that needs parsing
                        if (typeof availableFormats === 'string') {
                            try {
                                availableFormats = JSON.parse(availableFormats);
                            } catch (e) {
                                console.warn('Failed to parse formats string:', availableFormats);
                                availableFormats = [];
                            }
                        }
                        
                        // Ensure it's an array
                        if (!Array.isArray(availableFormats)) {
                            console.warn('Formats is not an array:', availableFormats);
                            availableFormats = [];
                        }
                        
                        const optimizedFormats = availableFormats.filter(f => f !== 'original');
                        const count = optimizedFormats.length;
                        
                        
                        return count > 0 ? `<br><i class="ti ti-versions"></i> ${count} formato${count > 1 ? 's' : ''}` : '<br><i class="ti ti-versions"></i> 0 formatos';
                    })()}
                </small>
            </div>
        </div>
    `;
    
    // Add event listeners
    const imgElement = card.querySelector('.vehicle-image');
    imgElement.addEventListener('click', () => openImageCarousel(image.id));
    
    const setPrimaryBtn = card.querySelector('.set-primary-btn');
    if (setPrimaryBtn) {
        setPrimaryBtn.addEventListener('click', () => setPrimaryImage(image.id));
    }
    
    const deleteBtn = card.querySelector('.delete-image-btn');
    deleteBtn.addEventListener('click', () => deleteImage(image.id));
    
    return card;
}

/**
 * Set an image as primary
 * @param {string} imageId - Image ID
 */
async function setPrimaryImage(imageId) {
    const vehicleId = currentVehicleId;
    
    if (!vehicleId || vehicleId === 'null' || vehicleId === 'undefined') {
        showAlert('danger', 'Error: ID de vehículo no válido');
        return;
    }
    
    try {
        // Get current session token
        const tokenResponse = await fetch('/api/auth/current-token', {
            method: 'GET',
            credentials: 'include'
        });
        
        let headers = {
            'Content-Type': 'application/json'
        };
        
        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            if (tokenData.success && tokenData.token) {
                headers['Authorization'] = `Bearer ${tokenData.token}`;
            }
        }
        
        const response = await fetch(`/api/vehicles/${vehicleId}/images/${imageId}/primary`, {
            method: 'PATCH',
            headers: headers,
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert('success', 'Imagen principal actualizada');
            loadVehicleImages(vehicleId);
        } else {
            showAlert('danger', data.error || 'Error al establecer imagen principal');
        }
    } catch (error) {
        showAlert('danger', 'Error al establecer imagen principal');
    }
}

/**
 * Delete an image
 * @param {string} imageId - Image ID
 */
async function deleteImage(imageId) {
    const vehicleId = currentVehicleId;
    
    if (!vehicleId || vehicleId === 'null' || vehicleId === 'undefined') {
        showAlert('danger', 'Error: ID de vehículo no válido');
        return;
    }
    
    if (!confirm('¿Estás seguro de que deseas eliminar esta imagen?')) {
        return;
    }
    
    try {
        // Get current session token
        const tokenResponse = await fetch('/api/auth/current-token', {
            method: 'GET',
            credentials: 'include'
        });
        
        let headers = {};
        
        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            if (tokenData.success && tokenData.token) {
                headers['Authorization'] = `Bearer ${tokenData.token}`;
            }
        }
        
        const response = await fetch(`/api/vehicles/${vehicleId}/images/${imageId}`, {
            method: 'DELETE',
            headers: headers,
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert('success', 'Imagen eliminada exitosamente');
            loadVehicleImages(vehicleId);
        } else {
            showAlert('danger', data.error || 'Error al eliminar la imagen');
        }
    } catch (error) {
        showAlert('danger', 'Error al eliminar la imagen');
    }
}

/**
 * Open image carousel (placeholder)
 * @param {string} imageId - Image ID
 */
function openImageCarousel(imageId) {
    // This would open a full-screen image carousel
    // For now, just show info
    showAlert('info', 'Vista de carrusel próximamente');
}

/**
 * Show modal loader
 */
function showModalLoader() {
    const loader = document.querySelector('#vehicleImagesModal .modal-loader-overlay');
    if (loader) {
        loader.style.display = 'flex';
    }
}

/**
 * Hide modal loader
 */
function hideModalLoader() {
    const loader = document.querySelector('#vehicleImagesModal .modal-loader-overlay');
    if (loader) {
        loader.style.display = 'none';
    }
}

/**
 * Show upload progress
 * @param {boolean} show - Show or hide progress
 */
function showUploadProgress(show) {
    // Could add a progress bar here
    // Upload progress indicator handled by UI
}

/**
 * Update images count badge
 * @param {number} count - Number of images
 */
function updateImagesCount(count) {
    const badge = document.getElementById('images-count-badge');
    if (badge) {
        badge.textContent = `${count} ${count === 1 ? 'imagen' : 'imágenes'}`;
    }
}

/**
 * Format file size in human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Show alert message in the modal
 * @param {string} type - Alert type (success, danger, warning, info)
 * @param {string} message - Alert message
 */
function showAlert(type, message) {
    const alertsContainer = document.getElementById('vehicle-images-alerts');
    if (!alertsContainer) return;
    
    // Remove existing alerts
    alertsContainer.innerHTML = '';
    
    // Create new alert
    const alertElement = document.createElement('div');
    alertElement.className = `alert alert-${type} alert-dismissible fade show`;
    alertElement.innerHTML = `
        <i class="ti ti-${type === 'success' ? 'check-circle' : type === 'danger' ? 'alert-circle' : 'info-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    alertsContainer.appendChild(alertElement);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (alertElement.parentNode) {
            alertElement.classList.remove('show');
            setTimeout(() => {
                if (alertElement.parentNode) {
                    alertElement.remove();
                }
            }, 150);
        }
    }, 5000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Check if Dropzone is available
    if (typeof Dropzone === 'undefined') {
        return;
    }
    
    // Disable Dropzone auto-discovery
    Dropzone.autoDiscover = false;
    
});