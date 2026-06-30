/**
 * Cancellation Requests Management Script
 * Handles admin interface for managing cancellation requests
 * 
 * @author Denisse Maldonado
 * @version 1.0.0
 */

let cancellationRequestsTable;
let currentRequestId = null;
let currentAction = null;

$(document).ready(function() {
    initializeCancellationRequestsTable();
    attachEventListeners();
});

/**
 * Initialize DataTables for cancellation requests
 */
function initializeCancellationRequestsTable() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    
    cancellationRequestsTable = $('#cancellationRequestsTable').DataTable({
        processing: true,
        serverSide: true,
        responsive: true,
        pageLength: 25,
        order: [[8, 'desc']], // Order by request date (newest first)
        ajax: {
            url: '/api/cancellation-requests',
            type: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            data: function(d) {
                // Add filter parameters
                d.status = $('input[name="statusFilter"]:checked').val();
                d.type = $('input[name="typeFilter"]:checked').val();
            },
            dataFilter: function(data) {
                // Parse the JSON response
                const json = JSON.parse(data);
                
                // If the response is wrapped in success structure, unwrap it
                if (json.success && json.data) {
                    // DataTables expects these fields at root level
                    const datatableResponse = {
                        draw: json.data.draw || 1,
                        recordsTotal: json.data.recordsTotal || 0,
                        recordsFiltered: json.data.recordsFiltered || 0,
                        data: json.data.data || []
                    };
                    return JSON.stringify(datatableResponse);
                }
                
                // If already in correct format, return as-is
                return data;
            },
            error: function(xhr, error, code) {
                console.error('Error loading cancellation requests:', error, xhr);
                showAlert('Error cargando solicitudes de cancelación: ' + (xhr.responseJSON?.error || error), 'error');
            }
        },
        columns: [
            {
                data: 'quoteFolio',
                name: 'folio',
                render: function(data, type, row) {
                    let folio = data;
                    if (row.cancellationType === 'reservation' && row.reservationFolio) {
                        folio = row.reservationFolio;
                    }
                    return `<code class="text-primary">${folio || 'N/A'}</code>`;
                }
            },
            {
                data: 'cancellationType',
                name: 'type',
                render: function(data, type, row) {
                    if (data === 'reservation') {
                        return '<span class="badge bg-success"><i class="ti ti-calendar me-1"></i>Reservación</span>';
                    } else {
                        return '<span class="badge bg-primary"><i class="ti ti-file-text me-1"></i>Cotización</span>';
                    }
                }
            },
            {
                data: 'clientName',
                name: 'client',
                render: function(data, type, row) {
                    return data || '<span class="text-muted">N/A</span>';
                }
            },
            {
                data: 'reason',
                name: 'reason',
                render: function(data, type, row) {
                    if (!data) return '<span class="text-muted">Sin motivo</span>';
                    
                    const truncated = data.length > 50 ? data.substring(0, 50) + '...' : data;
                    return `<span title="${data}">${truncated}</span>`;
                }
            },
            {
                data: 'hoursBeforeEvent',
                name: 'hours',
                render: function(data, type, row) {
                    if (data === null || data === undefined) {
                        return '<span class="text-muted">N/A</span>';
                    }
                    
                    const hours = parseInt(data);
                    let badgeClass = 'bg-danger';
                    if (hours >= 24) badgeClass = 'bg-success';
                    else if (hours >= 12) badgeClass = 'bg-warning';
                    
                    return `<span class="badge ${badgeClass}">${hours}h</span>`;
                }
            },
            {
                data: 'eventDate',
                name: 'event_date',
                render: function(data, type, row) {
                    if (!data) return '<span class="text-muted">N/A</span>';
                    
                    const date = new Date(data);
                    return date.toLocaleString('es-MX', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            },
            {
                data: 'status',
                name: 'status',
                render: function(data, type, row) {
                    const statusMap = {
                        'pending': { class: 'bg-warning', icon: 'ti-clock', text: 'Pendiente' },
                        'approved': { class: 'bg-success', icon: 'ti-check', text: 'Aprobada' },
                        'rejected': { class: 'bg-danger', icon: 'ti-x', text: 'Rechazada' }
                    };
                    
                    const status = statusMap[data] || { class: 'bg-secondary', icon: 'ti-question-mark', text: data };
                    return `<span class="badge ${status.class}"><i class="ti ${status.icon} me-1"></i>${status.text}</span>`;
                }
            },
            {
                data: 'requestedByName',
                name: 'requested_by',
                render: function(data, type, row) {
                    return data || '<span class="text-muted">Usuario desconocido</span>';
                }
            },
            {
                data: 'createdAt',
                name: 'created_at',
                render: function(data, type, row) {
                    if (!data) return '<span class="text-muted">N/A</span>';
                    
                    const date = new Date(data);
                    return date.toLocaleString('es-MX', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function(data, type, row) {
                    // CSP no permite handlers inline (onclick); se usan data-attrs +
                    // delegación de eventos (ver listener tras inicializar la tabla).
                    let actions = `
                        <button type="button" class="btn btn-sm btn-outline-primary me-1"
                                data-action="view" data-id="${row.id}"
                                title="Ver detalles">
                            <i class="ti ti-eye"></i>
                        </button>
                    `;

                    if (row.status === 'pending') {
                        actions += `
                            <button type="button" class="btn btn-sm btn-outline-success me-1"
                                    data-action="approve" data-id="${row.id}"
                                    title="Aprobar">
                                <i class="ti ti-check"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-danger"
                                    data-action="reject" data-id="${row.id}"
                                    title="Rechazar">
                                <i class="ti ti-x"></i>
                            </button>
                        `;
                    }

                    return actions;
                }
            }
        ],
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json'
        },
        drawCallback: function() {
            // Update page info
            const info = cancellationRequestsTable.page.info();
            console.log(`Mostrando ${info.recordsDisplay} solicitudes de cancelación`);
        }
    });
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
    // Action buttons (Ver / Aprobar / Rechazar): delegación de eventos en el tbody
    // en lugar de onclick inline, que la CSP bloquea (no hay 'unsafe-inline').
    $('#cancellationRequestsTable tbody').on('click', 'button[data-action]', function() {
        const id = this.getAttribute('data-id');
        const action = this.getAttribute('data-action');
        if (!id) return;
        if (action === 'view') {
            viewRequest(id);
        } else if (action === 'approve' || action === 'reject') {
            reviewRequest(id, action);
        }
    });

    // Filter change handlers
    $('input[name="statusFilter"], input[name="typeFilter"]').on('change', function() {
        cancellationRequestsTable.ajax.reload();
    });
    
    // Review modal action buttons
    $('#approveBtn').on('click', function() {
        showApprovalModal('approve');
    });
    
    $('#rejectBtn').on('click', function() {
        showApprovalModal('reject');
    });
    
    // Confirmation modal
    $('#confirmActionBtn').on('click', function() {
        processReviewAction();
    });
}

/**
 * View request details
 */
async function viewRequest(requestId) {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/cancellation-requests/${requestId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }
        
        const request = result.data;
        showRequestDetails(request);
        
    } catch (error) {
        console.error('Error loading request details:', error);
        showAlert('Error cargando detalles de la solicitud', 'error');
    }
}

/**
 * Show request details in modal
 */
function showRequestDetails(request) {
    const eventDate = request.eventDate ? 
        new Date(request.eventDate).toLocaleString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'No definida';
    
    const createdAt = request.createdAt ? 
        new Date(request.createdAt).toLocaleString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'No definida';

    let statusBadge = '';
    switch (request.status) {
        case 'pending':
            statusBadge = '<span class="badge bg-warning"><i class="ti ti-clock me-1"></i>Pendiente</span>';
            break;
        case 'approved':
            statusBadge = '<span class="badge bg-success"><i class="ti ti-check me-1"></i>Aprobada</span>';
            break;
        case 'rejected':
            statusBadge = '<span class="badge bg-danger"><i class="ti ti-x me-1"></i>Rechazada</span>';
            break;
    }

    const typeBadge = request.cancellationType === 'reservation' ?
        '<span class="badge bg-success"><i class="ti ti-calendar me-1"></i>Reservación</span>' :
        '<span class="badge bg-primary"><i class="ti ti-file-text me-1"></i>Cotización</span>';

    const content = `
        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">ID de Solicitud</label>
                    <div class="form-control-plaintext font-monospace">${request.id}</div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Estado</label>
                    <div class="form-control-plaintext">${statusBadge}</div>
                </div>
            </div>
        </div>
        
        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Tipo</label>
                    <div class="form-control-plaintext">${typeBadge}</div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Folio</label>
                    <div class="form-control-plaintext">
                        <code class="text-primary">${request.quoteFolio || 'N/A'}</code>
                        ${request.reservationFolio ? `<br><small class="text-muted">Reservación: ${request.reservationFolio}</small>` : ''}
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Cliente</label>
                    <div class="form-control-plaintext">${request.clientName || 'N/A'}</div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Solicitado por</label>
                    <div class="form-control-plaintext">${request.requestedByName || 'Usuario desconocido'}</div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Horas antes del evento</label>
                    <div class="form-control-plaintext">
                        <span class="badge ${request.hoursBeforeEvent < 24 ? 'bg-danger' : 'bg-success'}">
                            ${request.hoursBeforeEvent || 0} horas
                        </span>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="mb-3">
                    <label class="form-label fw-semibold">Fecha del evento</label>
                    <div class="form-control-plaintext">${eventDate}</div>
                </div>
            </div>
        </div>

        <div class="mb-3">
            <label class="form-label fw-semibold">Motivo de cancelación</label>
            <div class="form-control-plaintext border rounded p-2 bg-light">
                ${request.reason || 'Sin motivo especificado'}
            </div>
        </div>

        ${request.adminComments ? `
            <div class="mb-3">
                <label class="form-label fw-semibold">Comentarios del administrador</label>
                <div class="form-control-plaintext border rounded p-2 bg-light">
                    ${request.adminComments}
                </div>
            </div>
        ` : ''}

        <div class="mb-3">
            <label class="form-label fw-semibold">Fecha de solicitud</label>
            <div class="form-control-plaintext">${createdAt}</div>
        </div>
    `;

    $('#modalContent').html(content);
    
    // Show action buttons only for pending requests
    if (request.status === 'pending') {
        $('#approveBtn, #rejectBtn').show();
        currentRequestId = request.id;
    } else {
        $('#approveBtn, #rejectBtn').hide();
        currentRequestId = null;
    }
    
    $('#reviewModal').modal('show');
}

/**
 * Start review process
 */
function reviewRequest(requestId, action) {
    currentRequestId = requestId;
    currentAction = action;
    
    // First load the request details
    viewRequest(requestId);
}

/**
 * Show approval/rejection confirmation modal
 */
function showApprovalModal(action) {
    currentAction = action;
    
    const isApproval = action === 'approve';
    const title = isApproval ? 'Aprobar Solicitud' : 'Rechazar Solicitud';
    const content = isApproval ? 
        '¿Está seguro que desea aprobar esta solicitud de cancelación? Esta acción procederá con la cancelación.' :
        '¿Está seguro que desea rechazar esta solicitud de cancelación? La solicitud será denegada.';
    
    $('#approvalModalLabel').text(title);
    $('#approvalContent').html(`
        <div class="alert ${isApproval ? 'alert-success' : 'alert-danger'}">
            <i class="ti ${isApproval ? 'ti-check-circle' : 'ti-x-circle'} me-2"></i>
            ${content}
        </div>
    `);
    
    const confirmBtn = $('#confirmActionBtn');
    confirmBtn.removeClass('btn-success btn-danger').addClass(isApproval ? 'btn-success' : 'btn-danger');
    confirmBtn.html(`<i class="ti ${isApproval ? 'ti-check' : 'ti-x'} me-2"></i>${isApproval ? 'Aprobar' : 'Rechazar'}`);
    
    // Clear previous comments
    $('#adminComments').val('');
    
    $('#reviewModal').modal('hide');
    $('#approvalModal').modal('show');
}

/**
 * Process review action
 */
async function processReviewAction() {
    if (!currentRequestId || !currentAction) {
        showAlert('Error: No se pudo procesar la acción', 'error');
        return;
    }

    const comments = $('#adminComments').val().trim();
    const confirmBtn = $('#confirmActionBtn');
    const originalText = confirmBtn.html();
    
    // Show loading state
    confirmBtn.html('<span class="spinner-border spinner-border-sm me-2"></span>Procesando...');
    confirmBtn.prop('disabled', true);

    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/cancellation-requests/${currentRequestId}/review`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: currentAction,
                adminComments: comments
            })
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error);
        }

        // Close modal and refresh table
        $('#approvalModal').modal('hide');
        cancellationRequestsTable.ajax.reload();
        
        const actionText = currentAction === 'approve' ? 'aprobada' : 'rechazada';
        showAlert(`Solicitud ${actionText} exitosamente`, 'success');

    } catch (error) {
        console.error('Error processing review:', error);
        showAlert(`Error: ${error.message}`, 'error');
        
        // Restore button state
        confirmBtn.html(originalText);
        confirmBtn.prop('disabled', false);
    } finally {
        // Reset current values
        currentRequestId = null;
        currentAction = null;
    }
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
    const alertClass = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    };

    const alert = $(`
        <div class="alert ${alertClass[type]} alert-dismissible fade show position-fixed" 
             style="top: 20px; right: 20px; z-index: 9999; min-width: 300px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `);

    $('body').append(alert);
    
    // Auto dismiss after 5 seconds
    setTimeout(() => {
        alert.alert('close');
    }, 5000);
}