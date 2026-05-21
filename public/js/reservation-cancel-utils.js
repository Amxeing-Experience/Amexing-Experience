/**
 * Shared Reservation Cancellation Utilities
 * Provides sophisticated cancellation logic with 24-hour approval workflow
 * 
 * @author Denisse Maldonado
 * @version 1.0.0
 */

// Global variables for tracking cancellation
let cancelReservationId = null;
let cancelReservationCallback = null;

/**
 * Open cancellation modal for reservation
 * @param {string} reservationId - Reservation ID
 * @param {Function} onSuccess - Callback function to execute on successful cancellation
 */
function openReservationCancelModal(reservationId, onSuccess = null) {
    cancelReservationId = reservationId;
    cancelReservationCallback = onSuccess;
    fetchReservationForCancellation(reservationId);
}

/**
 * Open cancellation modal using existing reservation data (for detail pages)
 * @param {object} reservationData - Already loaded reservation data
 * @param {Function} onSuccess - Callback function to execute on successful cancellation
 */
function openReservationCancelModalWithData(reservationData, onSuccess = null) {
    cancelReservationId = reservationData.id;
    cancelReservationCallback = onSuccess;
    showCancelReservationModal(reservationData);
}

/**
 * Fetch reservation details and show cancellation modal
 * @param {string} reservationId - Reservation ID
 */
async function fetchReservationForCancellation(reservationId) {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/reservations/${reservationId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Error fetching reservation: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.data) {
            throw new Error('Invalid response from server');
        }

        showCancelReservationModal(result.data);
        
    } catch (error) {
        console.error('Error fetching reservation:', error);
        alert('No se pudo obtener la información de la reservación');
    }
}

/**
 * Show cancellation modal with 24-hour approval logic
 * @param {object} reservation - Reservation data
 */
function showCancelReservationModal(reservation) {
    // Get the earliest service date to calculate hours before event
    let earliestEventDate = null;
    if (reservation.services && reservation.services.length > 0) {
        reservation.services.forEach(service => {
            if (service.serviceDate) {
                const eventDate = new Date(service.serviceDate);
                if (!earliestEventDate || eventDate < earliestEventDate) {
                    earliestEventDate = eventDate;
                }
            }
        });
    }
    
    // If no service dates found, use startDate from reservation
    if (!earliestEventDate && reservation.startDate) {
        earliestEventDate = new Date(reservation.startDate);
    }

    // Calculate hours before event
    const now = new Date();
    const hoursBeforeEvent = earliestEventDate ? Math.max(0, Math.floor((earliestEventDate.getTime() - now.getTime()) / (1000 * 60 * 60))) : 0;
    const requiresApproval = hoursBeforeEvent < 24;

    // Format earliest event date
    const eventDateStr = earliestEventDate ? 
        earliestEventDate.toLocaleDateString('es-MX', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'No definida';

    // Create modal HTML
    const modalHtml = `
        <div class="modal fade" id="cancelReservationModal" tabindex="-1" aria-labelledby="cancelReservationModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title" id="cancelReservationModalLabel">
                            <i class="ti ti-x me-2"></i>Cancelar Reservación
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert ${requiresApproval ? 'alert-warning' : 'alert-info'}">
                            <i class="ti ${requiresApproval ? 'ti-alert-triangle' : 'ti-info-circle'} me-2"></i>
                            ${requiresApproval ? 
                                `<strong>¡Atención!</strong> La cancelación es con menos de 24 horas de anticipación (${hoursBeforeEvent} horas restantes). Se creará una solicitud de cancelación que requerirá aprobación administrativa.` :
                                `La cancelación es con más de 24 horas de anticipación (${hoursBeforeEvent} horas restantes). La reservación se cancelará automáticamente.`
                            }
                        </div>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label fw-semibold">Folio de Reservación</label>
                                <div class="form-control-plaintext">${reservation.folio || reservation.id}</div>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label fw-semibold">Fecha del Evento</label>
                                <div class="form-control-plaintext">${eventDateStr}</div>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label for="cancellationReason" class="form-label fw-semibold">
                                Motivo de la Cancelación <span class="text-danger">*</span>
                            </label>
                            <textarea 
                                class="form-control" 
                                id="cancellationReason" 
                                rows="4" 
                                placeholder="Por favor especifique el motivo de la cancelación..."
                                required
                            ></textarea>
                        </div>

                        <div class="alert alert-secondary">
                            <h6><i class="ti ti-info-circle me-2"></i>Información del Proceso:</h6>
                            <ul class="mb-0">
                                ${requiresApproval ? 
                                    `<li>Se creará una solicitud de cancelación para revisión</li>
                                     <li>Un administrador revisará y aprobará/rechazará la solicitud</li>
                                     <li>Recibirá notificación del resultado</li>` :
                                    `<li>La reservación se cancelará inmediatamente</li>
                                     <li>Se enviará confirmación de cancelación</li>
                                     <li>No se requiere aprobación adicional</li>`
                                }
                            </ul>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                        <button type="button" class="btn btn-danger" id="confirmCancellationBtn">
                            <i class="ti ti-check me-2"></i>
                            ${requiresApproval ? 'Crear Solicitud' : 'Cancelar Reservación'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('cancelReservationModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Insert modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Get modal element and show it
    const modalElement = document.getElementById('cancelReservationModal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    // Attach confirmation button event listener
    document.getElementById('confirmCancellationBtn').addEventListener('click', () => {
        processCancellationRequest(reservation, requiresApproval, hoursBeforeEvent, earliestEventDate, modal);
    });

    // Clean up modal when hidden
    modalElement.addEventListener('hidden.bs.modal', () => {
        modalElement.remove();
    });
}

/**
 * Process the cancellation request
 * @param {object} reservation - Reservation data
 * @param {boolean} requiresApproval - Whether approval is required
 * @param {number} hoursBeforeEvent - Hours before event
 * @param {Date} eventDate - Event date
 * @param {Modal} modal - Bootstrap modal instance
 */
async function processCancellationRequest(reservation, requiresApproval, hoursBeforeEvent, eventDate, modal) {
    const reason = document.getElementById('cancellationReason').value.trim();

    // Validate input
    if (!reason) {
        alert('Por favor ingrese un motivo para la cancelación');
        return;
    }

    // Show loading state
    const btn = document.getElementById('confirmCancellationBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Procesando...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        
        // Prepare request data
        const requestData = {
            reason: reason,
            hoursBeforeEvent: hoursBeforeEvent,
            eventDate: eventDate ? eventDate.toISOString() : null,
            // Reservation traceability data
            cancellationType: 'reservation',
            reservationId: reservation.id,
            reservationFolio: reservation.folio
        };

        // For reservations, we'll use the direct reservation cancel API if 24+ hours
        // or cancellation-requests API if less than 24 hours
        let response;
        if (requiresApproval) {
            // Create cancellation request for approval with full traceability
            response = await fetch('/api/cancellation-requests', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quoteFolio: reservation.quoteFolio,
                    ...requestData
                })
            });
        } else {
            // Direct cancellation
            response = await fetch(`/api/reservations/${reservation.id}/cancel`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
        }

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al procesar la cancelación');
        }

        // Close modal
        modal.hide();

        // Show success message based on cancellation type
        if (requiresApproval) {
            alert('Solicitud de cancelación creada exitosamente. Un administrador la revisará y le notificarán el resultado.');
        } else {
            alert('Reservación cancelada exitosamente.');
        }

        // Execute success callback if provided
        if (cancelReservationCallback) {
            cancelReservationCallback();
        }

    } catch (error) {
        console.error('Error processing cancellation:', error);
        alert(`Error: ${error.message}`);
        
        // Restore button state
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}