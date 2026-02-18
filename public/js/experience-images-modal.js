/**
 * Experience Images Modal - JavaScript Logic
 * 
 * Handles image management for experiences including:
 * - Loading and displaying optimized images with format badges
 * - Upload functionality with Dropzone
 * - Image carousel with Owl Carousel
 * - Set primary image
 * - Delete images (soft delete) 
 * - Drag & drop reordering with Sortable.js
 * - Format detection and optimization metadata display
 */

(function() {
    'use strict';

    let currentExperienceId = null;
    let currentExperienceInfo = null;
    let experienceImagesDropzone = null;
    let sortableInstance = null;
    let imagesCarousel = null;
    let isViewOnlyMode = false;

    /**
     * Load Dropzone library dynamically
     */
    function loadDropzone() {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (typeof Dropzone !== 'undefined') {
                resolve();
                return;
            }

            // Load CSS
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/dropzone@5.9.3/dist/min/dropzone.min.css';
            document.head.appendChild(link);

            // Load JS
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/dropzone@5.9.3/dist/min/dropzone.min.js';
            script.onload = () => {
                resolve();
            };
            script.onerror = () => {
                console.error('Failed to load Dropzone library');
                reject(new Error('Failed to load Dropzone'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Load external libraries
     */
    function loadExternalLibraries() {
        return new Promise((resolve) => {
            // Load Dropzone first (dynamically if not available)
            loadDropzone().then(() => {
                // Load Sortable.js
                loadSortable().then(() => {
                    resolve();
                });
            }).catch((error) => {
                console.error('Error loading Dropzone:', error);
                resolve(); // Continue without Dropzone if it fails
            });

            // Load Owl Carousel
            if (typeof jQuery.fn.owlCarousel === 'undefined') {
                const owlScript = document.createElement('script');
                owlScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js';
                owlScript.onload = () => {
                    loadSortable().then(resolve);
                };
                document.head.appendChild(owlScript);
            } else {
                loadSortable().then(resolve);
            }
        });
    }

    /**
     * Load Sortable.js
     */
    function loadSortable() {
        return new Promise((resolve) => {
            if (typeof Sortable === 'undefined') {
                const sortableScript = document.createElement('script');
                sortableScript.src = 'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js';
                sortableScript.onload = resolve;
                document.head.appendChild(sortableScript);
            } else {
                resolve();
            }
        });
    }

    /**
     * Get authentication token for API calls
     */
    async function getAuthToken() {
        try {
            const tokenResponse = await fetch('/api/auth/current-token', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json();
                if (tokenData.success && tokenData.token) {
                    return tokenData.token;
                }
            }
        } catch (error) {
            console.error('Error getting token:', error);
        }
        
        // Try to get token from localStorage as fallback
        return localStorage.getItem('token') || sessionStorage.getItem('token');
    }

    /**
     * Initialize Dropzone instance
     */
    async function initDropzone() {
        if (typeof Dropzone === 'undefined') {
            console.error('Dropzone library not loaded');
            return null;
        }

        Dropzone.autoDiscover = false;

        // Get token before initializing Dropzone
        const authToken = await getAuthToken();

        const dropzone = new Dropzone('#experience-images-dropzone', {
            url: `/api/experiences/placeholder/images`, // Will be updated dynamically
            paramName: 'image',
            maxFilesize: null, // No size limit
            acceptedFiles: '.jpg,.jpeg,.png,.webp',
            addRemoveLinks: true,
            dictDefaultMessage: 'Arrastra archivos aquí o haz clic para seleccionar',
            dictRemoveFile: 'Eliminar',
            dictCancelUpload: 'Cancelar',
            dictUploadCanceled: 'Subida cancelada',
            dictInvalidFileType: 'Tipo de archivo no válido',
            dictFileTooBig: 'Archivo no válido.',
            dictResponseError: 'Error del servidor: {{statusCode}}',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Authorization': authToken ? `Bearer ${authToken}` : ''
            },
            sending: function(file, xhr, formData) {
                // Show upload progress like vehicles
                showUploadProgress(true);
                
                // Set auth header if we have a token (fallback)
                if (authToken) {
                    xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
                }
            },
            complete: function() {
                // Hide upload progress when done
                showUploadProgress(false);
            }
        });

        // Store reference globally for cleanup
        window['dropzone_experience-images-dropzone'] = dropzone;

        // Hide default progress elements when file is added
        dropzone.on('addedfile', function(file) {
            // Remove any existing default progress elements
            const progressElements = file.previewElement.querySelectorAll('.dz-progress, .dz-upload');
            progressElements.forEach(el => el.remove());
        });

        // Upload progress tracking
        dropzone.on('uploadprogress', function(file, progress, bytesSent) {
            // Upload progress (0-60% of total progress)
            const uploadProgress = Math.min(progress * 0.6, 60);
            updateProgressBar(file, uploadProgress, 'Subiendo imagen...');
        });

        // Processing progress simulation
        dropzone.on('sending', function(file, xhr, formData) {
            updateProgressBar(file, 5, 'Iniciando subida...');
        });

        // Success event
        dropzone.on('success', function(file, response) {
            if (response.success) {
                // Start processing simulation at 60% 
                updateProgressBar(file, 60, 'Procesando imagen...');
                simulateProcessingProgress(file, response);
                
                showSuccessAlert(response.message || 'Imagen subida exitosamente');
                
                // Reload images after processing completes
                setTimeout(() => {
                    loadExperienceImages();
                }, 2000);
            }
        });

        // Error event
        dropzone.on('error', function(file, errorMessage) {
            // Hide progress bar on error
            const progressContainer = file.previewElement?.querySelector('.upload-progress-container');
            if (progressContainer) {
                progressContainer.remove();
            }
            
            showErrorAlert(errorMessage.error || errorMessage || 'Error al subir la imagen');
        });

        return dropzone;
    }

    /**
     * Initialize experience images modal
     */
    async function initExperienceImagesModal() {
        // Initialize Dropzone
        experienceImagesDropzone = await initDropzone();

        // Set up event listeners
        document.getElementById('carousel-close-btn')?.addEventListener('click', closeCarousel);

        // Event delegation for image action buttons
        document.addEventListener('click', function(event) {
            // Set primary image button
            if (event.target.closest('.btn-set-primary')) {
                event.preventDefault();
                const button = event.target.closest('.btn-set-primary');
                const imageId = button.getAttribute('data-image-id');
                if (imageId && window.setPrimaryImage) {
                    // Show loading state
                    const originalIcon = button.innerHTML;
                    button.disabled = true;
                    button.innerHTML = '<i class="spinner-border spinner-border-sm" role="status"></i>';
                    
                    // Call the function and handle completion
                    const result = window.setPrimaryImage(imageId);
                    
                    // If it returns a promise, handle it
                    if (result && typeof result.then === 'function') {
                        result.finally(() => {
                            button.disabled = false;
                            button.innerHTML = originalIcon;
                        });
                    } else {
                        // If not async, restore after a short delay
                        setTimeout(() => {
                            button.disabled = false;
                            button.innerHTML = originalIcon;
                        }, 1000);
                    }
                }
            }
            
            // Delete image button
            if (event.target.closest('.btn-delete-image')) {
                event.preventDefault();
                const button = event.target.closest('.btn-delete-image');
                const imageId = button.getAttribute('data-image-id');
                if (imageId && window.deleteImage) {
                    // Show brief loading state before modal
                    const originalIcon = button.innerHTML;
                    button.disabled = true;
                    button.innerHTML = '<i class="spinner-border spinner-border-sm" role="status"></i>';
                    
                    // Show modal after brief delay for visual feedback
                    setTimeout(() => {
                        button.disabled = false;
                        button.innerHTML = originalIcon;
                        window.deleteImage(imageId);
                    }, 200);
                }
            }
        });

        // Event delegation for image error handling
        document.addEventListener('error', function(event) {
            if (event.target.classList.contains('image-preview')) {
                const errorUrl = event.target.getAttribute('data-error-url');
                event.target.src = '/images/placeholder.jpg';
                console.error('Failed to load image:', errorUrl);
            }
        }, true); // Use capture phase to catch image load errors

        // Modal shown event
        $('#experienceImagesModal').on('shown.bs.modal', function() {
            if (currentExperienceId) {
                showModalLoader('experienceImagesModal');
                loadExperienceImages();
            }
        });

        // Modal hidden event
        $('#experienceImagesModal').on('hidden.bs.modal', function() {
            resetModal();
        });
    }

    /**
     * Open experience images modal
     */
    window.openExperienceImagesModal = function(experienceId, experienceName, viewOnlyMode = false) {
        currentExperienceId = experienceId;
        currentExperienceInfo = { name: experienceName };
        isViewOnlyMode = viewOnlyMode;


        // Update modal title and info
        document.getElementById('experience-info-text').textContent = experienceName;

        // Show/hide upload section based on view mode
        const uploadSection = document.querySelector('.upload-section');
        if (uploadSection) {
            uploadSection.style.display = viewOnlyMode ? 'none' : 'block';
        }

        // Update dropzone URL
        updateDropzoneUrl();

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('experienceImagesModal'));
        modal.show();
    };

    /**
     * Update dropzone URL with current experience ID
     */
    function updateDropzoneUrl() {
        if (experienceImagesDropzone && currentExperienceId) {
            experienceImagesDropzone.options.url = `/api/experiences/${currentExperienceId}/images`;
        }
    }

    /**
     * Load experience images from API
     */
    async function loadExperienceImages() {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const headers = {
                'Content-Type': 'application/json',
                // Prioritize AVIF with highest quality, then WebP, then other formats
                'Accept': 'image/avif;q=1.0,image/webp;q=0.9,image/jpeg;q=0.8,image/*;q=0.5'
            };
            
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }

            const response = await fetch(`/api/experiences/${currentExperienceId}/images`, { headers });
            const data = await response.json();

            hideModalLoader('experienceImagesModal');

            if (data.success) {
                renderImages(data.data);
                updateImagesCount(data.count);
            } else {
                showErrorAlert(data.error || 'Error al cargar las imágenes');
                renderImages([]);
            }
        } catch (error) {
            hideModalLoader('experienceImagesModal');
            console.error('Error loading experience images:', error);
            showErrorAlert('Error de conexión al cargar las imágenes');
            renderImages([]);
        }
    }

    /**
     * Render images in grid with optimization metadata
     */
    function renderImages(images) {
        const grid = document.getElementById('images-grid');
        const emptyState = document.getElementById('images-empty-state');

        if (!images || images.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        grid.style.display = 'flex'; // Make sure grid is visible

        const imagesHtml = images.map((image, index) => {
            const formatFileSize = (bytes) => {
                if (!bytes) return 'Desconocido';
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / 1048576).toFixed(1) + ' MB';
            };

            return `
                <div class="col-md-4 mb-3">
                    <div class="card image-card h-100 position-relative" data-image-id="${image.id}">
                        <div class="card-img-top position-relative overflow-hidden" style="height: 200px;">
                            <img src="${image.url || ''}" 
                                 alt="${image.fileName || 'Imagen de experiencia'}" 
                                 class="w-100 h-100 image-preview"
                                 data-index="${index}"
                                 style="cursor: pointer; object-fit: cover;"
                                 loading="lazy"
                                 data-error-url="${image.url}">

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
                                
                                // Always show format badge like vehicles do
                                return `
                                    <div class="position-absolute bottom-0 start-0 m-2">
                                        <span class="badge bg-info" title="Formato: ${displayFormat}">
                                            <i class="ti ti-photo"></i> ${displayFormat}
                                        </span>
                                    </div>
                                `;
                            })()}

                            ${image.isPrimary ? `
                                <div class="position-absolute top-0 start-0 m-2">
                                    <span class="badge bg-success" title="Imagen principal">
                                        <i class="ti ti-star-filled"></i> Principal
                                    </span>
                                </div>
                            ` : ''}

                            <!-- Action buttons -->
                            ${!isViewOnlyMode ? `
                                <div class="position-absolute top-0 end-0 m-2 d-flex flex-column gap-1">
                                    ${!image.isPrimary ? `
                                        <button class="btn btn-sm btn-warning btn-set-primary" 
                                                data-image-id="${image.id}"
                                                title="Establecer como principal">
                                            <i class="ti ti-star"></i>
                                        </button>
                                    ` : ''}
                                    <button class="btn btn-sm btn-danger btn-delete-image" 
                                            data-image-id="${image.id}"
                                            title="Eliminar imagen">
                                        <i class="ti ti-trash"></i>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="card-body p-2">
                            <small class="text-muted">
                                <i class="ti ti-file"></i> ${image.fileName || 'Imagen'}<br>
                                <i class="ti ti-weight"></i> ${formatFileSize(image.fileSize)}
                                ${(() => {
                                    const metadata = image.optimizationMetadata || {};
                                    // ServerImageOptimizationService uses 'formats' not 'availableFormats'
                                    const availableFormats = metadata.formats || metadata.availableFormats || [];
                                    const optimizedFormats = availableFormats.filter(f => f !== 'original');
                                    const count = optimizedFormats.length;
                                    return count > 0 ? `<br><i class="ti ti-versions"></i> ${count} formato${count > 1 ? 's' : ''}` : '<br><i class="ti ti-versions"></i> 0 formatos';
                                })()}
                            </small>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        grid.innerHTML = imagesHtml;

        // Set up event listeners and interactions
        setupImageEventListeners();
        if (!isViewOnlyMode) {
            initSortable();
        }
        initOwlCarousel(images);
    }

    /**
     * Setup event listeners for images (delegated)
     */
    function setupImageEventListeners() {
        const grid = document.getElementById('images-grid');

        // Remove existing listeners to avoid duplicates
        const newGrid = grid.cloneNode(true);
        grid.parentNode.replaceChild(newGrid, grid);

        // Image click to open carousel
        newGrid.addEventListener('click', function(e) {
            if (e.target.classList.contains('image-preview')) {
                const index = parseInt(e.target.dataset.index);
                openCarousel(index);
            }
        });
    }

    /**
     * Initialize Sortable.js for drag & drop reordering
     */
    function initSortable() {
        if (sortableInstance) {
            sortableInstance.destroy();
        }

        const grid = document.getElementById('images-grid');
        sortableInstance = Sortable.create(grid, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: function(evt) {
                // Get new order of image IDs
                const imageIds = Array.from(grid.querySelectorAll('.image-card')).map(card => card.dataset.imageId);
                reorderImages(imageIds);
            }
        });
    }

    /**
     * Initialize Owl Carousel
     */
    function initOwlCarousel(images) {
        // Destroy existing carousel
        if (imagesCarousel) {
            imagesCarousel.trigger('destroy.owl.carousel');
            imagesCarousel = null;
        }

        const carouselHtml = images.map((image, index) => `
            <div class="item text-center">
                <img src="${image.url}" 
                     alt="${image.fileName}" 
                     class="img-fluid rounded"
                     style="max-height: 70vh; max-width: 100%; object-fit: contain;">
                <div class="mt-2 text-white">
                    <h6>${image.fileName}</h6>
                    <small>${image.isPrimary ? '<i class="ti ti-star-filled"></i> Principal' : ''}</small>
                </div>
            </div>
        `).join('');

        document.getElementById('carousel-images').innerHTML = carouselHtml;

        // Initialize carousel
        imagesCarousel = $('#carousel-images').owlCarousel({
            items: 1,
            loop: false,
            nav: true,
            dots: true,
            responsive: {
                0: { items: 1 },
                600: { items: 1 },
                1000: { items: 1 }
            }
        });
    }

    /**
     * Open carousel at specific index
     */
    window.openCarousel = function(index) {
        document.getElementById('carousel-backdrop').style.display = 'block';
        document.getElementById('carousel-container').style.display = 'block';

        if (imagesCarousel) {
            imagesCarousel.trigger('to.owl.carousel', [index, 300]);
        }
    };

    /**
     * Close carousel
     */
    function closeCarousel() {
        document.getElementById('carousel-backdrop').style.display = 'none';
        document.getElementById('carousel-container').style.display = 'none';
    }

    /**
     * Set primary image
     */
    window.setPrimaryImage = async function(imageId) {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }

            const response = await fetch(`/api/experiences/${currentExperienceId}/images/${imageId}/primary`, {
                method: 'PATCH',
                headers
            });

            const data = await response.json();

            if (data.success) {
                showSuccessAlert(data.message || 'Imagen principal actualizada');
                loadExperienceImages();
            } else {
                showErrorAlert(data.error || 'Error al establecer imagen principal');
            }
        } catch (error) {
            console.error('Error setting primary image:', error);
            showErrorAlert('Error de conexión');
        }
    };

    /**
     * Show confirmation modal for image deletion
     */
    window.deleteImage = function(imageId) {
        const modalHtml = `
            <div class="modal fade" id="deleteImageModal" tabindex="-1" aria-labelledby="deleteImageModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title" id="deleteImageModalLabel">
                                <i class="ti ti-alert-triangle me-2"></i>Confirmar Eliminación
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="text-center">
                                <i class="ti ti-trash display-4 text-danger mb-3"></i>
                                <h5>¿Estás seguro de eliminar esta imagen?</h5>
                                <p class="text-muted">Esta acción no se puede deshacer. La imagen se eliminará permanentemente.</p>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                                <i class="ti ti-x me-1"></i>Cancelar
                            </button>
                            <button type="button" class="btn btn-danger" data-action="delete-image">
                                <i class="ti ti-trash me-1"></i>Eliminar Imagen
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if present
        const existingModal = document.getElementById('deleteImageModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('deleteImageModal'));
        modal.show();

        // Add event listener for delete button
        document.querySelector('#deleteImageModal [data-action="delete-image"]')
            .addEventListener('click', function() {
                executeDeleteImage(imageId);
            });
    };

    /**
     * Execute image deletion after confirmation
     */
    window.executeDeleteImage = async function(imageId) {
        try {
            const modal = bootstrap.Modal.getInstance(document.getElementById('deleteImageModal'));
            const deleteBtn = document.querySelector('#deleteImageModal [data-action="delete-image"]');
            
            // Show loading state
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Eliminando...';

            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }

            const response = await fetch(`/api/experiences/${currentExperienceId}/images/${imageId}`, {
                method: 'DELETE',
                headers
            });

            const data = await response.json();

            if (data.success) {
                modal.hide();
                showSuccessAlert(data.message || 'Imagen eliminada exitosamente');
                loadExperienceImages();
            } else {
                showErrorAlert(data.error || 'Error al eliminar la imagen');
            }

            // Reset button state
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="ti ti-trash me-1"></i>Eliminar Imagen';

        } catch (error) {
            console.error('Error deleting image:', error);
            showErrorAlert('Error de conexión al eliminar la imagen');
            
            const deleteBtn = document.querySelector('#deleteImageModal [data-action="delete-image"]');
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="ti ti-trash me-1"></i>Eliminar Imagen';
        }
    };

    /**
     * Reorder images
     */
    async function reorderImages(imageIds) {
        try {
            const token = localStorage.getItem('token') || sessionStorage.getItem('token');
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }

            const response = await fetch(`/api/experiences/${currentExperienceId}/images/reorder`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ imageIds })
            });

            const data = await response.json();

            if (data.success) {
                showSuccessAlert('Orden actualizado exitosamente');
            } else {
                showErrorAlert(data.error || 'Error al actualizar el orden');
                loadExperienceImages(); // Reload to restore original order
            }
        } catch (error) {
            console.error('Error reordering images:', error);
            showErrorAlert('Error de conexión');
            loadExperienceImages(); // Reload to restore original order
        }
    }

    /**
     * Update images count badge
     */
    function updateImagesCount(count) {
        const badge = document.getElementById('images-count-badge');
        if (badge) {
            badge.textContent = `${count} ${count === 1 ? 'imagen' : 'imágenes'}`;
        }
    }

    /**
     * Show success alert
     */
    function showSuccessAlert(message) {
        const alertHtml = `
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                <i class="ti ti-check-circle me-2"></i>
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        const alertContainer = document.getElementById('experience-images-alerts');
        alertContainer.innerHTML = alertHtml;

        // Auto dismiss after 5 seconds
        setTimeout(() => {
            const alert = alertContainer.querySelector('.alert');
            if (alert) {
                const bsAlert = new bootstrap.Alert(alert);
                bsAlert.close();
            }
        }, 5000);
    }

    /**
     * Show error alert
     */
    function showErrorAlert(message) {
        const alertHtml = `
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
                <i class="ti ti-alert-circle me-2"></i>
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        const alertContainer = document.getElementById('experience-images-alerts');
        alertContainer.innerHTML = alertHtml;
    }

    /**
     * Reset modal state
     */
    function resetModal() {
        currentExperienceId = null;
        currentExperienceInfo = null;
        document.getElementById('images-grid').innerHTML = '';
        document.getElementById('experience-images-alerts').innerHTML = '';

        // Reset carousel
        closeCarousel();

        // Clear dropzone - safely handle null
        if (experienceImagesDropzone && typeof experienceImagesDropzone.removeAllFiles === 'function') {
            try {
                experienceImagesDropzone.removeAllFiles(true); // true = don't trigger events
            } catch (error) {
                // Ignore errors during cleanup
            }
        }
    }

    /**
     * Update progress bar for file upload
     */
    function updateProgressBar(file, progress, statusText) {
        // Find the file preview element
        const filePreview = file.previewElement;
        if (!filePreview) return;

        // Update or create progress bar
        let progressBar = filePreview.querySelector('.upload-progress-bar');
        let progressContainer = filePreview.querySelector('.upload-progress-container');
        let statusElement = filePreview.querySelector('.upload-status-text');

        if (!progressContainer) {
            // Create progress container
            progressContainer = document.createElement('div');
            progressContainer.className = 'upload-progress-container mt-2';
            progressContainer.innerHTML = `
                <div class="progress mb-1" style="height: 6px;">
                    <div class="progress-bar upload-progress-bar bg-primary" 
                         role="progressbar" style="width: 0%"></div>
                </div>
                <small class="upload-status-text text-muted">${statusText}</small>
            `;
            
            // Append progress container to file preview
            const fileInfo = filePreview.querySelector('.dz-details');
            if (fileInfo) {
                fileInfo.parentNode.insertBefore(progressContainer, fileInfo.nextSibling);
            } else {
                filePreview.appendChild(progressContainer);
            }
            
            progressBar = progressContainer.querySelector('.upload-progress-bar');
            statusElement = progressContainer.querySelector('.upload-status-text');
        }

        // Update progress
        if (progressBar) {
            progressBar.style.width = Math.round(progress) + '%';
        }
        
        if (statusElement) {
            statusElement.textContent = statusText;
        }
    }

    /**
     * Simulate processing progress after upload
     */
    function simulateProcessingProgress(file, response) {
        const stages = [
            { progress: 65, text: 'Optimizando imagen AVIF...', delay: 300 },
            { progress: 75, text: 'Generando versión WebP...', delay: 400 },
            { progress: 85, text: 'Creando JPEG optimizado...', delay: 350 },
            { progress: 95, text: 'Finalizando procesamiento...', delay: 200 },
            { progress: 100, text: 'Imagen optimizada exitosamente', delay: 300 }
        ];

        let currentStage = 0;
        
        function processNextStage() {
            if (currentStage >= stages.length) {
                // Mark as completed
                if (file.previewElement) {
                    file.previewElement.classList.add('upload-completed');
                }
                return;
            }
            
            const stage = stages[currentStage];
            updateProgressBar(file, stage.progress, stage.text);
            
            currentStage++;
            setTimeout(processNextStage, stage.delay);
        }
        
        // Start processing simulation
        setTimeout(processNextStage, 100);
    }

    /**
     * Show/hide upload progress indicator
     * @param {boolean} show - Show or hide progress
     */
    function showUploadProgress(show) {
        // Don't show blocking modal loader, just rely on Dropzone's built-in progress
        // The Dropzone library already shows progress on the image being uploaded
    }

    // Initialize on DOM ready
    function init() {
        loadExternalLibraries().then(async () => {
            await initExperienceImagesModal();
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();