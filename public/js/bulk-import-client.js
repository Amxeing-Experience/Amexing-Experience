/**
 * Bulk Import Client Module
 * JavaScript module for handling bulk client import functionality
 *
 * Features:
 * - Multi-step wizard interface
 * - File upload with Dropzone.js
 * - Real-time validation
 * - Progress tracking with polling
 * - Error handling and reporting
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-12
 */

(function() {
    'use strict';

    // Module state
    const BulkImport = {
        currentStep: 1,
        totalSteps: 4,
        jobId: null,
        fileId: null,
        validationResult: null,
        pollingInterval: null,
        dropzoneInstance: null,
    };

    /**
     * Initialize bulk import modal
     */
    function initializeBulkImportModal() {
        console.log('Initializing bulk import modal...');
        const modal = document.getElementById('bulkImportModal');
        if (!modal) {
            console.error('Bulk import modal not found');
            return;
        }

        console.log('Modal found, setting up...');

        // Reset on modal open
        modal.addEventListener('show.bs.modal', function() {
            console.log('Modal opened, resetting...');
            resetModal();
        });

        // Setup button handlers
        setupButtonHandlers();

        // Setup dropzone custom events
        setupDropzoneEvents();

        console.log('Bulk import modal initialized successfully');
    }

    /**
     * Reset modal to initial state
     */
    function resetModal() {
        BulkImport.currentStep = 1;
        BulkImport.jobId = null;
        BulkImport.fileId = null;
        BulkImport.validationResult = null;

        // Clear polling if active
        if (BulkImport.pollingInterval) {
            clearInterval(BulkImport.pollingInterval);
            BulkImport.pollingInterval = null;
        }

        // Reset dropzone if exists
        if (window.dropzone_bulkImportDropzone) {
            window['dropzone_bulk-import-dropzone'].removeAllFiles();
        }

        // Show step 1
        goToStep(1);

        // Clear validation results
        document.getElementById('uploadValidationResult').innerHTML = '';
        document.getElementById('invalidRecordsTable').querySelector('tbody').innerHTML = '';
    }

    /**
     * Setup button event handlers
     */
    function setupButtonHandlers() {
        console.log('Setting up button handlers...');

        // Download template button
        const downloadBtn = document.getElementById('downloadTemplateBtn');
        if (downloadBtn) {
            console.log('Download template button found, adding listener');
            downloadBtn.addEventListener('click', downloadTemplate);
        } else {
            console.warn('Download template button not found');
        }

        // Navigation buttons
        const nextBtn = document.getElementById('bulkImportNextBtn');
        if (nextBtn) {
            nextBtn.addEventListener('click', handleNext);
        }

        const prevBtn = document.getElementById('bulkImportPrevBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', handlePrevious);
        }

        const processBtn = document.getElementById('bulkImportProcessBtn');
        if (processBtn) {
            processBtn.addEventListener('click', processImport);
        }

        const finishBtn = document.getElementById('bulkImportFinishBtn');
        if (finishBtn) {
            finishBtn.addEventListener('click', finishImport);
        }

        // Download error report button
        const errorReportBtn = document.getElementById('downloadErrorReportBtn');
        if (errorReportBtn) {
            errorReportBtn.addEventListener('click', downloadErrorReport);
        }

        console.log('Button handlers setup complete');
    }

    /**
     * Setup dropzone custom event listeners
     */
    function setupDropzoneEvents() {
        // File added event
        document.addEventListener('dropzone:fileAdded', function(e) {
            if (e.detail.dropzoneId === 'bulk-import-dropzone') {
                console.log('File added to dropzone:', e.detail.file.name);
                console.log('File will be auto-uploaded with autoProcessQueue=true');
            }
        });

        // Upload success event
        document.addEventListener('dropzone:uploadSuccess', function(e) {
            if (e.detail.dropzoneId === 'bulk-import-dropzone') {
                console.log('Upload successful:', e.detail.response);
                handleUploadSuccess(e.detail.response);
            }
        });

        // Upload error event
        document.addEventListener('dropzone:uploadError', function(e) {
            if (e.detail.dropzoneId === 'bulk-import-dropzone') {
                console.error('Upload error:', e.detail.errorMessage);
                handleUploadError(e.detail.errorMessage);
            }
        });

        // Sending event (when upload starts)
        document.addEventListener('dropzone:sending', function(e) {
            if (e.detail && e.detail.dropzoneId === 'bulk-import-dropzone') {
                console.log('Upload starting for file:', e.detail.file?.name);
            }
        });
    }

    /**
     * Download Excel template
     */
    async function downloadTemplate() {
        console.log('downloadTemplate function called');
        try {
            const btn = document.getElementById('downloadTemplateBtn');
            console.log('Button element:', btn);
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ti ti-loader me-2"></i>Descargando...';

            console.log('Fetching template from API...');
            const response = await fetch('/api/clients/bulk/template', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });

            if (!response.ok) {
                throw new Error('Error al descargar la plantilla');
            }

            // Download file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'plantilla-importacion-clientes.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            btn.disabled = false;
            btn.innerHTML = originalHTML;

            showAlert('success', 'Plantilla descargada exitosamente', 'uploadValidationResult');
        } catch (error) {
            console.error('Error downloading template:', error);
            showAlert('danger', error.message || 'Error al descargar la plantilla', 'uploadValidationResult');

            const btn = document.getElementById('downloadTemplateBtn');
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-download me-2"></i>Descargar Plantilla';
        }
    }

    /**
     * Handle file upload success
     */
    function handleUploadSuccess(response) {
        console.log('handleUploadSuccess called with response:', response);

        if (!response.success) {
            handleUploadError(response.error || response.message || 'Error al validar el archivo');
            return;
        }

        BulkImport.jobId = response.data.jobId;
        BulkImport.fileId = response.data.fileId;
        BulkImport.validationResult = response.data.validation;

        console.log('Stored jobId:', BulkImport.jobId);
        console.log('Stored validation result:', BulkImport.validationResult);

        // Show validation results
        const message = `
            <div class="alert alert-success" role="alert">
                <h6 class="alert-heading"><i class="ti ti-check-circle me-2"></i>Archivo validado exitosamente</h6>
                <p class="mb-0">
                    Se encontraron <strong>${response.data.validation.total}</strong> registros:
                    <strong class="text-success">${response.data.validation.valid}</strong> válidos,
                    <strong class="text-danger">${response.data.validation.invalid}</strong> inválidos.
                </p>
            </div>
        `;
        document.getElementById('uploadValidationResult').innerHTML = message;

        // Enable next button
        const nextBtn = document.getElementById('bulkImportNextBtn');
        nextBtn.disabled = false;
        console.log('Next button enabled:', !nextBtn.disabled);

        // Store invalid records if any
        if (response.data.invalidRecords && response.data.invalidRecords.length > 0) {
            BulkImport.invalidRecords = response.data.invalidRecords;
        }
    }

    /**
     * Handle file upload error
     */
    function handleUploadError(errorMessage) {
        console.log('handleUploadError called with:', errorMessage);

        // Extract error message if it's an object
        let errorText = errorMessage;
        if (typeof errorMessage === 'object') {
            if (errorMessage.error) {
                errorText = errorMessage.error;
            } else if (errorMessage.message) {
                errorText = errorMessage.message;
            } else {
                errorText = JSON.stringify(errorMessage);
            }
        }

        console.log('Processed error text:', errorText);

        const message = `
            <div class="alert alert-danger" role="alert">
                <h6 class="alert-heading"><i class="ti ti-alert-circle me-2"></i>Error de Validación</h6>
                <p class="mb-0">${errorText}</p>
            </div>
        `;
        document.getElementById('uploadValidationResult').innerHTML = message;

        // Disable next button
        document.getElementById('bulkImportNextBtn').disabled = true;

        // Remove the failed file from dropzone to allow re-upload
        if (window['dropzone_bulk-import-dropzone']) {
            const dropzone = window['dropzone_bulk-import-dropzone'];
            dropzone.removeAllFiles();
            console.log('Removed all files from dropzone');
        }
    }

    /**
     * Handle next button click
     */
    function handleNext() {
        if (BulkImport.currentStep < BulkImport.totalSteps) {
            const nextStep = BulkImport.currentStep + 1;

            // Validate before moving to next step
            if (nextStep === 3) {
                // Moving to review step - load validation data
                loadReviewData();
            }

            goToStep(nextStep);
        }
    }

    /**
     * Handle previous button click
     */
    function handlePrevious() {
        if (BulkImport.currentStep > 1) {
            goToStep(BulkImport.currentStep - 1);
        }
    }

    /**
     * Go to specific step
     */
    function goToStep(step) {
        // Hide all steps
        for (let i = 1; i <= BulkImport.totalSteps; i++) {
            document.getElementById(`step-${i}`)?.classList.add('d-none');
            const stepCircle = document.querySelector(`[data-step="${i}"] .step-circle`);
            stepCircle?.classList.remove('active', 'completed');

            if (i < step) {
                stepCircle?.classList.add('completed');
            }
        }

        // Show current step
        document.getElementById(`step-${step}`)?.classList.remove('d-none');
        const currentCircle = document.querySelector(`[data-step="${step}"] .step-circle`);
        currentCircle?.classList.add('active');

        const currentItem = document.querySelector(`[data-step="${step}"]`);
        currentItem?.classList.add('active');

        // Update buttons
        updateButtons(step);

        BulkImport.currentStep = step;
    }

    /**
     * Update button visibility based on step
     */
    function updateButtons(step) {
        const prevBtn = document.getElementById('bulkImportPrevBtn');
        const nextBtn = document.getElementById('bulkImportNextBtn');
        const processBtn = document.getElementById('bulkImportProcessBtn');
        const finishBtn = document.getElementById('bulkImportFinishBtn');
        const cancelBtn = document.getElementById('bulkImportCancelBtn');

        // Hide all action buttons
        prevBtn.classList.add('d-none');
        nextBtn.classList.add('d-none');
        processBtn.classList.add('d-none');
        finishBtn.classList.add('d-none');

        switch (step) {
            case 1:
                nextBtn.classList.remove('d-none');
                break;
            case 2:
                prevBtn.classList.remove('d-none');
                nextBtn.classList.remove('d-none');
                nextBtn.disabled = !BulkImport.jobId; // Disable until file uploaded
                break;
            case 3:
                prevBtn.classList.remove('d-none');
                processBtn.classList.remove('d-none');
                break;
            case 4:
                cancelBtn.textContent = 'Cerrar';
                finishBtn.classList.remove('d-none');
                finishBtn.disabled = true; // Enable when processing completes
                break;
        }
    }

    /**
     * Load review data for step 3
     */
    function loadReviewData() {
        if (!BulkImport.validationResult) return;

        // Update counts
        document.getElementById('validRecordsCount').textContent = BulkImport.validationResult.valid || 0;
        document.getElementById('invalidRecordsCount').textContent = BulkImport.validationResult.invalid || 0;
        document.getElementById('totalRecordsCount').textContent = BulkImport.validationResult.total || 0;

        // Show invalid records section if any
        if (BulkImport.validationResult.invalid > 0 && BulkImport.invalidRecords) {
            document.getElementById('invalidRecordsSection').classList.remove('d-none');

            // Populate invalid records table (first 10)
            const tbody = document.getElementById('invalidRecordsTable').querySelector('tbody');
            tbody.innerHTML = '';

            const recordsToShow = BulkImport.invalidRecords.slice(0, 10);
            recordsToShow.forEach(record => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${record.rowNumber || '-'}</td>
                    <td>${record.email || '-'}</td>
                    <td>${record.companyName || '-'}</td>
                    <td class="text-danger">${Array.isArray(record.errors) ? record.errors.join(', ') : record.error || '-'}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            document.getElementById('invalidRecordsSection').classList.add('d-none');
        }
    }

    /**
     * Process bulk import
     */
    async function processImport() {
        try {
            const btn = document.getElementById('bulkImportProcessBtn');
            btn.disabled = true;

            // Move to step 4
            goToStep(4);

            // Start processing
            const response = await fetch('/api/clients/bulk/process', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    jobId: BulkImport.jobId,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Error al iniciar el procesamiento');
            }

            // Start polling for status
            startStatusPolling();

        } catch (error) {
            console.error('Error processing import:', error);
            showProcessingError(error.message);
        }
    }

    /**
     * Start polling for import status
     */
    function startStatusPolling() {
        BulkImport.pollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/clients/bulk/status/${BulkImport.jobId}`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error('Error al consultar estado');
                }

                updateProgress(result.data);

                // Stop polling if completed or failed
                if (result.data.status === 'completed' || result.data.status === 'failed') {
                    clearInterval(BulkImport.pollingInterval);
                    BulkImport.pollingInterval = null;

                    if (result.data.status === 'completed') {
                        showCompletionResults(result.data);
                    } else {
                        showProcessingError(result.data.error || 'Error durante el procesamiento');
                    }
                }
            } catch (error) {
                console.error('Error polling status:', error);
            }
        }, 2000); // Poll every 2 seconds
    }

    /**
     * Update progress bar
     */
    function updateProgress(data) {
        if (!data.progress) return;

        const { processed, total, percentage, created, failed } = data.progress;

        // Update progress bar
        const progressBar = document.getElementById('importProgressBar');
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);

        // Update progress text
        document.getElementById('progressText').textContent = `${processed} / ${total}`;
        document.getElementById('progressPercentage').textContent = `${percentage}%`;
        document.getElementById('progressLabel').textContent =
            `Procesados: ${processed} | Exitosos: ${created} | Errores: ${failed}`;
    }

    /**
     * Show completion results
     */
    function showCompletionResults(data) {
        // Hide processing icon, show completed icon
        document.getElementById('processingIcon').classList.add('d-none');
        document.getElementById('completedIcon').classList.remove('d-none');

        // Update title
        document.getElementById('processingTitle').textContent = 'Importación Completada';
        document.getElementById('processingSubtitle').textContent =
            'La importación de clientes ha finalizado exitosamente.';

        // Remove animation from progress bar
        const progressBar = document.getElementById('importProgressBar');
        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');

        // Show results
        const results = data.result || {};
        document.getElementById('successfulCount').textContent = results.successful || 0;
        document.getElementById('failedCount').textContent = results.failed || 0;
        document.getElementById('resultsSection').classList.remove('d-none');

        // Show error report section if there were failures
        if (results.failed > 0 && data.hasErrorReport) {
            document.getElementById('errorReportSection').classList.remove('d-none');
        }

        // Enable finish button
        document.getElementById('bulkImportFinishBtn').disabled = false;

        // Reload clients table
        if (window.clientsTable) {
            window.clientsTable.ajax.reload(null, false);
        }
    }

    /**
     * Show processing error
     */
    function showProcessingError(errorMessage) {
        // Hide processing icon, show error icon
        document.getElementById('processingIcon').classList.add('d-none');
        document.getElementById('errorIcon').classList.remove('d-none');

        // Update title
        document.getElementById('processingTitle').textContent = 'Error en la Importación';
        document.getElementById('processingSubtitle').textContent = errorMessage;

        // Remove animation from progress bar
        const progressBar = document.getElementById('importProgressBar');
        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
        progressBar.classList.add('bg-danger');

        // Enable finish button
        document.getElementById('bulkImportFinishBtn').disabled = false;
    }

    /**
     * Download error report
     */
    async function downloadErrorReport() {
        try {
            const btn = document.getElementById('downloadErrorReportBtn');
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ti ti-loader me-1"></i>Descargando...';

            const response = await fetch(`/api/clients/bulk/error-report/${BulkImport.jobId}`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });

            if (!response.ok) {
                throw new Error('Error al descargar el reporte');
            }

            // Download file
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reporte-errores-${BulkImport.jobId}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            btn.disabled = false;
            btn.innerHTML = originalHTML;
        } catch (error) {
            console.error('Error downloading error report:', error);
            alert('Error al descargar el reporte de errores');

            const btn = document.getElementById('downloadErrorReportBtn');
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-download me-1"></i>Descargar Reporte de Errores';
        }
    }

    /**
     * Finish import and close modal
     */
    function finishImport() {
        const modal = bootstrap.Modal.getInstance(document.getElementById('bulkImportModal'));
        modal.hide();
    }

    /**
     * Show alert message
     */
    function showAlert(type, message, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const iconMap = {
            success: 'ti-check-circle',
            danger: 'ti-alert-circle',
            warning: 'ti-alert-triangle',
            info: 'ti-info-circle',
        };

        const icon = iconMap[type] || 'ti-info-circle';

        container.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                <i class="ti ${icon} me-2"></i>${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeBulkImportModal);
    } else {
        initializeBulkImportModal();
    }

    // Export for external use
    window.BulkImportClient = {
        initialize: initializeBulkImportModal,
        goToStep: goToStep,
    };
})();
