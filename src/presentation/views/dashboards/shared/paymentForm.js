/**
 * Formulario de pago: alta, edición, borrado y comprobante.
 *
 * Lo usan los detalles de client, department_manager y end_client. Vivía dentro de la plantilla de
 * client, duplicado palabra por palabra en department_manager; cuando el negocio pidió que el cliente
 * directo también registrara pagos, la alternativa era una tercera copia.
 *
 * Es una FÁBRICA y no un objeto suelto porque tiene estado propio —qué pago se está editando, si el
 * alta está abierta— y ese estado no debe compartirse entre pestañas de la misma página. La vista le
 * entrega lo suyo (id de reservación, token, avisos, formato) y recupera el pago en edición con
 * getEditingId(), que es lo único que necesita para pintar la fila expandida.
 *
 * La sangría se conserva como estaba en la plantilla: sus plantillas literales la arrastran al HTML.
 * Se desactiva no-use-before-define: las ocho funciones se llaman entre sí, en el navegador las
 * declaraciones se izan, y reordenarlas para complacer a la regla dejaría el archivo más difícil de
 * leer que el problema que evita.
 * Created by Denisse Maldonado.
 */

/* eslint-disable indent, no-use-before-define */
/* global PaymentBreakdownHelpers */

/**
 * Fábrica del formulario de pago. Se expone como global del navegador, igual que los demás módulos
 * compartidos de esta carpeta.
 */
const PaymentForm = (() => {
  /**
   * Crea un formulario atado a una vista.
   * @param {object} v - Lo que el formulario necesita de la vista: reservationId, token(),
   * reservationData(), payments(), summary(), formatCurrency(), formatDate(), toast(), confirm(),
   * attachThousands(), parseAmount(), applySummary(), reload(), repaint(), methodLabels.
   * @returns {object} API del formulario.
   * @example
   * const form = PaymentForm.create({ reservationId, token: () => tok, ... });
   */
  function create(v) {
    // Estado del formulario. Vive aquí y no en la vista porque solo el formulario lo cambia; la vista
    // lo consulta con getEditingId() para saber qué fila expandir.
    let editingPaymentId = null;
    let addPaymentFormOpen = false;
    let pendingAddForm = false;

        // "Registrar pago" se OCULTA mientras hay un formulario abierto, en vez de quedarse con su aspecto
        // de llamada a la acción: ahí parecía que otro clic agregaría un segundo formulario. Además impide
        // abrir el alta encima de una edición inline (savePayment lee los campos por id global, así que un
        // segundo formulario guardaría los valores del equivocado).
        /**
         *
         * @example
         */
        function syncAddPaymentBtn() {
            const btn = document.getElementById('showPaymentFormBtn');
            if (!btn) return;
            const status = v.reservationData() ? v.reservationData().status : null;
            const canEdit = status !== 'cancelled' && status !== 'completed';
            const formOpen = addPaymentFormOpen || !!editingPaymentId;
            btn.classList.toggle('d-none', !canEdit || formOpen);
        }

        // El formulario necesita availableMethods del summary AMPLIO para poblar el select de método; si se
        // dibujara antes de que llegue, saldría con el select vacío y el guardado bloqueado, y no se volvería
        // a construir solo. Por eso se intenta en dos momentos: al terminar de abrir el panel y al llegar el
        // summary — lo que ocurra al final.
        /**
         *
         * @example
         */
        function maybeOpenAddForm() {
            if (!pendingAddForm) return;
            const status = v.reservationData() ? v.reservationData().status : null;
            const canEdit = status !== 'cancelled' && status !== 'completed';
            if (!canEdit || addPaymentFormOpen || editingPaymentId) { pendingAddForm = false; return; }
            if (!v.summary()) return; // Aún cargando: se reintenta desde applyPaymentSummary.
            pendingAddForm = false;
            renderPaymentForm(null);
        }

        // Cierra el formulario abierto, sea el del alta o el inline del historial. NUNCA puede haber dos
        // abiertos a la vez, por lo mismo de los ids globales.
        /**
         *
         * @example
         */
        function closePaymentForm() {
            const wasEditing = !!editingPaymentId;
            editingPaymentId = null;
            addPaymentFormOpen = false;
            const wrap = document.getElementById('paymentFormWrap');
            if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; wrap.classList.remove('pay-form'); }
            syncAddPaymentBtn();
            // Re-render para quitar la fila expandida y reactivar los encabezados de orden.
            if (wasEditing) v.repaint();
        }

        // Read a File as base64 (strip the "data:...;base64," prefix) for the JSON receipt upload.
        /**
         *
         * @param file
         * @example
         */
        function fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
                reader.readAsDataURL(file);
            });
        }

        // Upload a payment receipt in a SEPARATE request (decoupled from the save). El pago ya está
        // persistido, así que esto nunca lo arriesga: devuelve null si sube, o un aviso si falla.
        /**
         *
         * @param paymentId
         * @param file
         * @example
         */
        async function uploadReceipt(paymentId, file) {
            try {
                const body = JSON.stringify({
                    fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type,
                });
                const resp = await fetch(`/api/reservations/${v.reservationId}/payments/${paymentId}/receipt`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${v.token()}`, 'Content-Type': 'application/json' },
                    body,
                });
                const r = await resp.json().catch(() => ({}));
                if (resp.ok && r.success) return null;
                return r.error
                    ? `Pago guardado, pero el comprobante no se subió: ${r.error}`
                    : 'Pago guardado, pero el comprobante no se subió. Reinténtalo editando el pago.';
            } catch (err) {
                console.error('Receipt upload error:', err);
                return 'Pago guardado, pero el comprobante no se subió (se cortó la conexión). Reinténtalo editando el pago.';
            }
        }

        // Inline payment form (dentro de #paymentsOffcanvas). null = nuevo, id = editar el pago.
        // targetWrap permite dibujarlo en dos sitios: el contenedor fijo del alta o la fila expandida del
        // historial (edición). Todo lo demás es idéntico.
        /**
         *
         * @param paymentId
         * @param targetWrap
         * @example
         */
        function renderPaymentForm(paymentId, targetWrap) {
            const wrap = targetWrap || document.getElementById('paymentFormWrap');
            if (!wrap) return;
            // Alta = sin id y en el contenedor fijo. Marca el estado para que el botón que lo abrió ceda su
            // lugar al formulario.
            if (!paymentId && !targetWrap) addPaymentFormOpen = true;
            syncAddPaymentBtn();
            const existing = paymentId ? v.payments().find((p) => p.id === paymentId) : null;
            const curr = existing?.origCurrency || 'MXN';
            const paidAt = existing?.paidAt ? new Date(existing.paidAt).toISOString().slice(0, 10) : '';
            // Payment date allows the future (reservations later); shared standard 1900 .. today + 20y.
            /**
             * Tope de la fecha de pago: hoy + 20 años. Se permite el futuro porque hay reservaciones
             * futuras; el límite existe para atajar un año mal tecleado, no para prohibirlo.
             * @returns {string} Fecha máxima en formato ISO corto.
             * @example
             * paidAtMax // '2046-07-30'
             */
            const paidAtMax = (() => {
                const dt = new Date();
                dt.setFullYear(dt.getFullYear() + 20);
                return dt.toISOString().slice(0, 10);
            })();
            /**
             * Una opción del select de método.
             * @param {string} valor - Valor de la opción.
             * @param {string} label - Texto visible.
             * @param {string} sel - Valor seleccionado.
             * @returns {string} HTML de la opción.
             * @example
             * opt('efectivo', 'Efectivo', 'efectivo')
             */
            const opt = (valor, label, sel) => `<option value="${valor}" ${sel === valor ? 'selected' : ''}>${label}</option>`;
            const receiptLink = existing?.receiptUrl
                ? `<a href="${existing.receiptUrl}" target="_blank" rel="noopener" class="pay-receipt-chip"><i class="ti ti-file-invoice"></i>Ver comprobante actual</a>` : '';

            // Método: poblado dinámicamente desde availableMethods (Fase C), NUNCA hardcodeado a 3 opciones.
            // Al editar, se conserva el método guardado aunque ya no esté disponible (no cambiarlo en silencio).
            // Sin métodos disponibles (H3): select deshabilitado con mensaje y guardado bloqueado.
            const resumen = v.summary();
            const available = (resumen && Array.isArray(resumen.availableMethods))
                ? resumen.availableMethods.slice() : [];
            const method = existing?.method || available[0] || '';
            const methodOrder = available.slice();
            if (existing?.method && !methodOrder.includes(existing.method)) methodOrder.push(existing.method);
            const methodDisabled = methodOrder.length === 0;
            const methodSelectHtml = methodDisabled
                ? `<select class="form-select form-select-sm" id="paymentMethod" disabled><option value="">Sin métodos disponibles</option></select>
                   <div class="form-text text-danger">No hay métodos de pago disponibles para esta reservación.</div>`
                : `<select class="form-select form-select-sm" id="paymentMethod">${methodOrder.map((m) => opt(m, v.methodLabels[m] || m, method)).join('')}</select>`;

            const amountInit = existing ? (existing.origAmount ?? existing.amount ?? '') : '';

            // Sin encabezado propio: la fila resaltada de arriba (o el botón que lo abrió) ya dice de qué
            // pago se trata, así que un título + separador solo restaba alto útil. El dato se conserva como
            // etiqueta en el pie, que tenía todo el lado izquierdo vacío.
            const contextLabel = existing
                ? `Editando el pago del ${v.formatDate(existing.paidAt || existing.createdAt)}`
                : 'Nuevo pago';
            wrap.classList.add('pay-form');
            wrap.innerHTML = `
                <input type="hidden" id="paymentId" value="${existing ? existing.id : ''}">
                <div class="row g-3">
                    <div class="col-md-4">
                        <label class="form-label fw-semibold small" for="paymentAmount">Monto</label>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text" id="paymentAmountPrefix">${curr === 'USD' ? 'USD $' : '$'}</span>
                            <input type="text" inputmode="decimal" maxlength="17" class="form-control form-control-sm" id="paymentAmount" placeholder="0.00" value="${amountInit}">
                        </div>
                    </div>
                    <div class="col-md-4">
                        <label class="form-label fw-semibold small" for="paymentCurrency">Moneda</label>
                        <select class="form-select form-select-sm" id="paymentCurrency">${opt('MXN', 'MXN', curr)}${opt('USD', 'USD', curr)}</select>
                    </div>
                    <div class="col-md-4">
                        <label class="form-label fw-semibold small" for="paymentMethod">Método</label>
                        ${methodSelectHtml}
                    </div>
                    <div class="col-md-4">
                        <label class="form-label fw-semibold small" for="paymentPaidAt">Fecha de pago</label>
                        <input type="date" class="form-control form-control-sm" id="paymentPaidAt" min="1900-01-01" max="${paidAtMax}" value="${paidAt}" required>
                    </div>
                    <div class="${method === 'efectivo' ? 'col-md-4' : 'col-md-8'}" id="paymentReferenceWrap">
                        <label class="form-label fw-semibold small" for="paymentReference">Referencia</label>
                        <input type="text" class="form-control form-control-sm" id="paymentReference" maxlength="100" placeholder="Folio / autorización" value="${PaymentBreakdownHelpers.escapeHtml(existing?.reference || '')}">
                    </div>
                    <div class="col-md-4" id="paymentReceivedByWrap" style="display:${method === 'efectivo' ? '' : 'none'};">
                        <label class="form-label fw-semibold small" for="paymentReceivedBy">¿Quién recibió el efectivo?</label>
                        <input type="text" class="form-control form-control-sm" id="paymentReceivedBy" maxlength="100" placeholder="Nombre de quien recibió" value="${PaymentBreakdownHelpers.escapeHtml(existing?.receivedBy || '')}" ${method === 'efectivo' ? 'required' : ''}>
                    </div>
                    <div class="col-md-5">
                        <label class="form-label fw-semibold small" for="paymentReceipt">Comprobante (imagen o PDF)</label>
                        <div class="pay-drop" id="paymentReceiptDrop">
                            <input type="file" id="paymentReceipt" accept="image/*,application/pdf">
                            <div class="pay-file-row">
                                <label class="pay-file-btn" for="paymentReceipt"><i class="ti ti-paperclip"></i>Adjuntar</label>
                                <button type="button" class="pay-file-clear d-none" id="paymentReceiptClear" title="Quitar archivo" aria-label="Quitar archivo"><i class="ti ti-x"></i></button>
                            </div>
                            <span class="pay-file-name" id="paymentReceiptName">o arrastra el archivo aquí</span>
                            ${receiptLink}
                        </div>
                    </div>
                    <div class="col-md-7">
                        <label class="form-label fw-semibold small" for="paymentNotes">Notas</label>
                        <textarea class="form-control form-control-sm" id="paymentNotes" rows="2" maxlength="300" placeholder="Notas del pago">${PaymentBreakdownHelpers.escapeHtml(existing?.notes || '')}</textarea>
                    </div>
                </div>
                <div class="pay-form-actions">
                    <span class="pay-form-context">${existing ? '<i class="ti ti-edit"></i>' : '<i class="ti ti-cash"></i>'}${PaymentBreakdownHelpers.escapeHtml(contextLabel)}</span>
                    <button type="button" class="btn btn-outline-secondary" id="cancelPaymentBtn">Cancelar</button>
                    <button type="button" class="btn btn-primary" id="savePaymentBtn"><i class="ti ti-check me-1"></i>Guardar</button>
                </div>`;
            // El formulario vive dentro del offcanvas (posición fija con scroll propio): se muestra en su
            // sitio y se desplaza a la vista dentro del panel, sin scrollIntoView de página ni borde inline.
            wrap.style.display = '';
            wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            const saveBtn = document.getElementById('savePaymentBtn');
            // Sin métodos disponibles (H3): no se puede registrar/editar el pago — bloquea el guardado.
            if (methodDisabled && saveBtn) saveBtn.disabled = true;
            document.getElementById('cancelPaymentBtn').addEventListener('click', () => closePaymentForm());
            saveBtn.addEventListener('click', () => savePayment(existing ? existing.id : ''));
            v.attachThousands(document.getElementById('paymentAmount'));

            // "¿Quién recibió el efectivo?" es visible + required SOLO cuando el método es efectivo, y
            // reacciona en vivo si el usuario cambia el método DESPUÉS de abrir el formulario.
            const methodSel = document.getElementById('paymentMethod');
            /**
             *
             * @example
             */
            function syncReceivedByVisibility() {
                const isCash = methodSel && methodSel.value === 'efectivo';
                const wrapEl = document.getElementById('paymentReceivedByWrap');
                const inputEl = document.getElementById('paymentReceivedBy');
                if (wrapEl) wrapEl.style.display = isCash ? '' : 'none';
                if (inputEl) inputEl.required = !!isCash;
                // Referencia absorbe el ancho de "¿Quién recibió?" cuando está oculto, para que el renglón
                // siempre cierre las 12 columnas y no quede el hueco a la derecha.
                const refWrap = document.getElementById('paymentReferenceWrap');
                if (refWrap) {
                    refWrap.classList.toggle('col-md-4', !!isCash);
                    refWrap.classList.toggle('col-md-8', !isCash);
                }
            }
            if (methodSel) methodSel.addEventListener('change', syncReceivedByVisibility);
            syncReceivedByVisibility();

            // Zona de comprobante: el input nativo está oculto, así que el nombre del archivo elegido y el
            // botón para quitarlo son la única señal de qué se adjuntó.
            const receiptInput = document.getElementById('paymentReceipt');
            const receiptName = document.getElementById('paymentReceiptName');
            const receiptClear = document.getElementById('paymentReceiptClear');
            const receiptDrop = document.getElementById('paymentReceiptDrop');
            /**
             *
             * @example
             */
            function syncReceiptName() {
                if (!receiptInput || !receiptName) return;
                const picked = receiptInput.files && receiptInput.files[0];
                receiptName.textContent = picked ? picked.name : 'o arrastra el archivo aquí';
                receiptName.title = picked ? picked.name : '';
                receiptName.classList.toggle('has-file', !!picked);
                if (receiptClear) receiptClear.classList.toggle('d-none', !picked);
            }
            if (receiptInput) receiptInput.addEventListener('change', syncReceiptName);
            if (receiptClear && receiptInput) {
                receiptClear.addEventListener('click', () => { receiptInput.value = ''; syncReceiptName(); });
            }
            // Arrastrar y soltar sobre la zona. Se asigna vía DataTransfer porque input.files es de solo
            // lectura salvo con una FileList real.
            if (receiptDrop && receiptInput) {
                ['dragenter', 'dragover'].forEach((ev) => receiptDrop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    receiptDrop.classList.add('is-dragover');
                }));
                // relatedTarget dentro de la zona = solo se pasó sobre un hijo, no es una salida real.
                receiptDrop.addEventListener('dragleave', (e) => {
                    if (!receiptDrop.contains(e.relatedTarget)) receiptDrop.classList.remove('is-dragover');
                });
                receiptDrop.addEventListener('drop', (e) => {
                    e.preventDefault();
                    receiptDrop.classList.remove('is-dragover');
                    const dropped = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                    if (!dropped) return;
                    const dt = new DataTransfer();
                    dt.items.add(dropped);
                    receiptInput.files = dt.files;
                    syncReceiptName();
                });
            }

            // El prefijo del monto sigue a la moneda elegida, para que no quede "$" sobre un importe en USD.
            const currencySel = document.getElementById('paymentCurrency');
            const amountPrefix = document.getElementById('paymentAmountPrefix');
            if (currencySel && amountPrefix) {
                currencySel.addEventListener('change', () => {
                    amountPrefix.textContent = currencySel.value === 'USD' ? 'USD $' : '$';
                });
            }
        }

        /**
         *
         * @param paymentId
         * @example
         */
        async function savePayment(paymentId) {
            const amount = v.parseAmount(document.getElementById('paymentAmount').value);
            const paidAt = document.getElementById('paymentPaidAt').value;
            const method = document.getElementById('paymentMethod').value;
            const receivedByEl = document.getElementById('paymentReceivedBy');
            const receivedBy = receivedByEl ? receivedByEl.value.trim() : '';

            if (!amount || amount <= 0) { v.toast('El monto debe ser mayor a 0', 'warning'); return; }
            if (amount > 100000000) { v.toast('El monto no puede exceder 100,000,000', 'warning'); return; }
            if (!paidAt) { v.toast('La fecha de pago es obligatoria', 'warning'); return; }
            if (method === 'efectivo' && !receivedBy) { v.toast('Indica quién recibió el efectivo', 'warning'); return; }

            const payload = {
                amount,
                currency: document.getElementById('paymentCurrency').value,
                method,
                reference: document.getElementById('paymentReference').value.trim(),
                notes: document.getElementById('paymentNotes').value.trim(),
            };
            if (paidAt) payload.paidAt = paidAt;
            if (receivedBy) payload.receivedBy = receivedBy;

            // Receipt (optional) — validado aquí pero subido en una petición SEPARADA DESPUÉS de guardar el
            // pago (ver uploadReceipt), para que una subida lenta a S3 nunca bloquee ni pierda el pago.
            const fileInput = document.getElementById('paymentReceipt');
            const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
            if (file) {
                if (file.size > 10 * 1024 * 1024) { v.toast('El comprobante supera el límite de 10MB', 'warning'); return; }
                if (!/^image\//.test(file.type) && file.type !== 'application/pdf') { v.toast('El comprobante debe ser imagen o PDF', 'warning'); return; }
            }

            const isEdit = !!paymentId;
            const url = isEdit
                ? `/api/reservations/${v.reservationId}/payments/${paymentId}`
                : `/api/reservations/${v.reservationId}/payments`;
            const httpMethod = isEdit ? 'PUT' : 'POST';
            // Snapshot del conteo actual para reconciliar si la RESPUESTA se pierde: el request suele llegar
            // al servidor y guardar aunque la respuesta no regrese.
            const prevCount = v.payments().length;

            const btn = document.getElementById('savePaymentBtn');
            if (btn) btn.disabled = true;
            try {
                const response = await fetch(url, {
                    method: httpMethod,
                    headers: {
                        Authorization: `Bearer ${v.token()}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                // Leer el body crudo primero para que una respuesta no-JSON (p. ej. página HTML de error)
                // muestre un mensaje claro en vez del genérico.
                const rawBody = await response.text();
                let result;
                try {
                    result = JSON.parse(rawBody);
                } catch (parseErr) {
                    v.toast(`Error del servidor (HTTP ${response.status})`, 'error');
                    if (btn) btn.disabled = false;
                    return;
                }
                if (result.success) {
                    const savedId = result.data?.payment?.id || paymentId;
                    // Sube el comprobante en su propia petición ahora que el pago está guardado. Si falla,
                    // el pago se queda — solo avisamos para que el usuario reintente el comprobante.
                    let receiptWarn = result.warning || null;
                    if (file && savedId) receiptWarn = await uploadReceipt(savedId, file);
                    closePaymentForm();
                    v.applySummary(result.data?.summary);
                    await v.reload();
                    if (receiptWarn) v.toast(receiptWarn, 'warning');
                    else v.toast('Pago guardado', 'success');
                } else {
                    let msg = result.error || 'No se pudo guardar el pago';
                    if (result.detail) msg += ` — ${result.detail}`;
                    if (response.status === 401) {
                        msg = `Sesión/v.token() inválido (${result.detail || result.code || '401'}). Recarga la página (Ctrl+Shift+R) e intenta de nuevo.`;
                    }
                    v.toast(msg, 'error');
                    if (btn) btn.disabled = false;
                }
            } catch (err) {
                // Error de red: el request suele llegar al servidor y guardar aunque la respuesta se pierda.
                // En vez de un falso fallo, reconciliamos desde el servidor (lo mismo que un Ctrl+R manual).
                console.error('Save payment network error, reconciling from server:', err);
                await v.reload();
                let saved = !isEdit && v.payments().length > prevCount;
                if (!saved && !isEdit) {
                    await new Promise((resolve) => { setTimeout(resolve, 700); });
                    await v.reload();
                    saved = v.payments().length > prevCount;
                }
                if (saved) {
                    closePaymentForm();
                    v.toast('Pago guardado (se recuperó tras un corte de conexión)', 'success');
                } else if (isEdit) {
                    closePaymentForm();
                    v.toast('La respuesta se perdió, pero la lista ya se actualizó — verifica que el pago sea correcto.', 'warning');
                } else {
                    v.toast('No se pudo confirmar el guardado. Revisa la lista; si el pago no aparece, regístralo otra vez.', 'warning');
                    if (btn) btn.disabled = false;
                }
            }
        }

        /**
         *
         * @param paymentId
         * @example
         */
        async function deletePayment(paymentId) {
            if (!(await v.confirm({
                title: 'Eliminar pago',
message: '¿Eliminar este pago? Esta acción no se puede deshacer.',
                confirmText: 'Eliminar',
danger: true,
            }))) return;
            const existedBefore = v.payments().some((p) => p.id === paymentId);
            try {
                const response = await fetch(`/api/reservations/${v.reservationId}/payments/${paymentId}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${v.token()}` },
                });
                const result = await response.json();
                if (result.success) {
                    v.applySummary(result.data?.summary);
                    await v.reload();
                    v.toast('Pago eliminado', 'success');
                } else {
                    v.toast(result.error || 'Error al eliminar el pago', 'error');
                }
            } catch (err) {
                // Respuesta perdida — el delete pudo haber pasado. Reconciliamos desde el servidor en vez de
                // reportar un falso fallo (misma idea que el guardado).
                console.error('Delete payment network error, reconciling from server:', err);
                await v.reload();
                const stillThere = v.payments().some((p) => p.id === paymentId);
                if (existedBefore && !stillThere) {
                    v.toast('Pago eliminado (se recuperó tras un corte de conexión)', 'success');
                } else {
                    v.toast('No se pudo confirmar la eliminación. Revisa la lista; si el pago sigue ahí, inténtalo otra vez.', 'warning');
                }
            }
        }
    return {
      renderPaymentForm,
      savePayment,
      deletePayment,
      closePaymentForm,
      maybeOpenAddForm,
      syncAddPaymentBtn,
      uploadReceipt,
      /**
       * Pago que se está editando, o null.
       * @returns {string|null} ObjectId del pago en edición.
       * @example
       * form.getEditingId()
       */
      getEditingId: () => editingPaymentId,
      /**
       * Marca qué pago se está editando. Lo decide la VISTA, que es quien escucha el clic en el
       * renglón; el formulario solo lo recuerda para que la fila se dibuje expandida.
       * @param {string|null} id - ObjectId del pago, o null para salir de la edición.
       * @returns {void}
       * @example
       * form.setEditingId('p1')
       */
      setEditingId: (id) => { editingPaymentId = id || null; },
      /**
       * Marca que hay que abrir el alta en cuanto llegue el summary del servidor.
       * @returns {void}
       * @example
       * form.requestAddForm()
       */
      requestAddForm: () => { pendingAddForm = true; },
    };
  }

  return { create };
})();

// Node (Jest). En el navegador el IIFE de arriba ya dejó window.PaymentForm.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentForm;
}
