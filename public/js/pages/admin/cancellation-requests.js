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

    const statusMap = {
        pending:  { label: 'Pendiente', cls: 'bg-warning text-dark', icon: 'ti-clock' },
        approved: { label: 'Aprobada',  cls: 'bg-success',           icon: 'ti-check' },
        rejected: { label: 'Rechazada', cls: 'bg-danger',            icon: 'ti-x' },
    };
    const st = statusMap[request.status] || { label: request.status || 'N/A', cls: 'bg-secondary', icon: 'ti-help-circle' };
    const statusBadge = `<span class="badge ${st.cls} px-3 py-2 fs-6"><i class="ti ${st.icon} me-1"></i>${st.label}</span>`;

    const isReservation = request.cancellationType === 'reservation';
    const typeBadge = isReservation
        ? '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="ti ti-calendar me-1"></i>Reservación</span>'
        : '<span class="badge bg-primary-subtle text-primary border border-primary-subtle"><i class="ti ti-file-text me-1"></i>Cotización</span>';
    // Mostrar solo el folio que corresponde al tipo: el de la reservación cuando es
    // reservación, el de la cotización cuando es cotización (congruente entre ambos).
    const primaryFolio = isReservation
        ? (request.reservationFolio || request.quoteFolio || 'N/A')
        : (request.quoteFolio || 'N/A');

    const hours = request.hoursBeforeEvent ?? 0;
    const urgent = hours < 24;
    const hoursBadge = `<span class="badge ${urgent ? 'bg-danger' : 'bg-success'}">${hours} horas</span>`;

    // Tarjeta compacta de dato: ícono + etiqueta + valor.
    const infoItem = (icon, label, value) => `
        <div class="col-md-6">
            <div class="d-flex align-items-start gap-2">
                <i class="ti ${icon} fs-5 text-muted mt-1"></i>
                <div class="flex-grow-1" style="min-width:0;">
                    <div class="text-muted text-uppercase fw-semibold" style="font-size:.7rem; letter-spacing:.04em;">${label}</div>
                    <div class="fw-medium">${value}</div>
                </div>
            </div>
        </div>`;

    const content = `
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 p-3 mb-4 rounded-3 border bg-light">
            <div>
                <div class="text-muted text-uppercase fw-semibold" style="font-size:.7rem; letter-spacing:.05em;">Solicitud de cancelación</div>
                <div class="d-flex align-items-center gap-2 mt-1">
                    ${typeBadge}
                    <span class="fw-bold fs-5">${primaryFolio}</span>
                </div>
            </div>
            <div class="text-end">
                ${statusBadge}
                <div class="small text-muted mt-2 font-monospace">${request.id}</div>
            </div>
        </div>

        ${(urgent && request.status === 'pending') ? `
            <div class="alert alert-warning d-flex align-items-center py-2 mb-3">
                <i class="ti ti-alert-triangle me-2"></i>
                <span class="small">Cancelación con menos de 24 horas de anticipación — requiere tu aprobación.</span>
            </div>
        ` : ''}

        <div class="row g-3 mb-2">
            ${infoItem('ti-user', 'Cliente', request.clientName || 'N/A')}
            ${infoItem('ti-user-check', 'Solicitado por', request.requestedByName || 'Usuario desconocido')}
            ${infoItem('ti-calendar-event', 'Fecha del evento', eventDate)}
            ${infoItem('ti-hourglass', 'Horas antes del evento', hoursBadge)}
        </div>

        <hr class="my-3">

        <div class="mb-3">
            <div class="text-muted text-uppercase fw-semibold mb-1" style="font-size:.7rem; letter-spacing:.04em;"><i class="ti ti-message-2 me-1"></i>Motivo de cancelación</div>
            <div class="border-start border-3 border-secondary-subtle ps-3 py-1">
                ${request.reason || '<span class="text-muted fst-italic">Sin motivo especificado</span>'}
            </div>
        </div>

        <div class="mb-3">
            <label class="form-label fw-semibold">Política de cancelación</label>
            <div class="border rounded p-2 bg-light">
                <div class="d-flex justify-content-between"><span>Crédito (saldo a favor)</span><span>$${Number(request.creditoAmount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
                <div class="d-flex justify-content-between"><span>Penalización</span><span>$${Number(request.penalizacionAmount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
                <div class="d-flex justify-content-between"><span>Reembolso a tarjeta</span><span>$${Number(request.reembolsoAmount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
                <hr class="my-1">
                <div class="small text-muted">Regla: ${({ empresa: 'Cancela la empresa (100% reembolso)', no_show: 'No-show (100% penalización)', mayor_igual_24h: '≥24 h (100% crédito)', entre_12_24h: '12–24 h (50/50)', menor_12h: '<12 h (100% penalización)' }[request.policyTier] || request.policyTier || '—')}</div>
                <div class="small text-muted">Tipo: ${request.tipoCancelacion === 'empresa' ? 'Empresa' : 'Cliente'}${request.esNoShow ? ' · No-show' : ''}</div>
            </div>
        </div>

        ${request.adminComments ? `
            <div class="mb-3">
                <div class="text-muted text-uppercase fw-semibold mb-1" style="font-size:.7rem; letter-spacing:.04em;"><i class="ti ti-message-circle me-1"></i>Comentarios del administrador</div>
                <div class="border-start border-3 border-info-subtle ps-3 py-1">
                    ${request.adminComments}
                </div>
            </div>
        ` : ''}

        <div class="d-flex align-items-center text-muted small mt-3 pt-2 border-top">
            <i class="ti ti-clock me-1"></i>Solicitada el ${createdAt}
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

    // Ir directo al diálogo de confirmación (con comentarios), sin pasar por el
    // modal de detalle — para revisar primero está el botón "Ver".
    showApprovalModal(action);
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
    // For approvals, let the reviewer set who cancels and whether it was a no-show.
    // The server recomputes the credit/penalty/refund split from these.
    const policyInputs = isApproval ? `
        <div class="mb-2">
            <label class="form-label fw-semibold">Tipo de cancelación</label>
            <select id="reviewTipoCancelacion" class="form-select form-select-sm">
                <option value="cliente">Cliente</option>
                <option value="empresa">Empresa (100% reembolso)</option>
            </select>
        </div>
        <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="reviewEsNoShow">
            <label class="form-check-label" for="reviewEsNoShow">El cliente no se presentó (no-show → 100% penalización)</label>
        </div>
        <div class="small text-muted">Al aprobar se aplicará la política de cancelación con estos datos.</div>
    ` : '';

    $('#approvalContent').html(`
        <div class="alert ${isApproval ? 'alert-success' : 'alert-danger'}">
            <i class="ti ${isApproval ? 'ti-check-circle' : 'ti-x-circle'} me-2"></i>
            ${content}
        </div>
        ${policyInputs}
    `);
    
    const confirmBtn = $('#confirmActionBtn');
    confirmBtn.removeClass('btn-success btn-danger').addClass(isApproval ? 'btn-success' : 'btn-danger');
    confirmBtn.html(`<i class="ti ${isApproval ? 'ti-check' : 'ti-x'} me-2"></i>${isApproval ? 'Aprobar' : 'Rechazar'}`);
    confirmBtn.prop('disabled', false);
    
    // Clear previous comments and reflect that rejecting requires a comment.
    $('#adminComments').val('');
    if (isApproval) {
        $('label[for="adminComments"]').text('Comentarios (opcional)');
    } else {
        $('label[for="adminComments"]').html('Comentarios <span class="text-danger">*</span> <small class="text-muted">(requerido para rechazar)</small>');
    }

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

    // Rechazar requiere un comentario (lo valida también el backend); avisar aquí
    // evita un viaje al servidor para fallar.
    const isReject = currentAction === 'reject' || currentAction === 'rejected';
    if (isReject && !comments) {
        showAlert('Debes agregar un comentario para rechazar la solicitud', 'error');
        $('#adminComments').focus();
        return;
    }

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
                adminComments: comments,
                tipoCancelacion: $('#reviewTipoCancelacion').val() || 'cliente',
                esNoShow: $('#reviewEsNoShow').is(':checked')
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
    } finally {
        // Restaurar el botón SIEMPRE (éxito o error); antes solo se restauraba en el
        // catch, así que tras aprobar/rechazar quedaba deshabilitado en "Procesando…".
        confirmBtn.html(originalText);
        confirmBtn.prop('disabled', false);
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