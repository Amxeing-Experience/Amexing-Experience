/**
 * Historial de pagos de una reservación — la tabla del carrito.
 *
 * La pintan los detalles de client, department_manager y end_client. Vivía dentro de la plantilla de
 * client, duplicada en department_manager, y end_client no tenía carrito en absoluto: un cliente
 * directo no podía ver ahí cuánto debía.
 *
 * Cada función devuelve una CADENA: el módulo no toca el DOM ni engancha eventos. El ORDEN y el pago
 * en edición son estado de la VISTA y entran por el contexto, porque quien los cambia es el usuario
 * al hacer clic, y esos clics los escucha la vista.
 *
 * La sangría se conserva como estaba en la plantilla: sus plantillas literales la arrastran al HTML.
 * Created by Denisse Maldonado.
 */

/* eslint-disable indent */
/* global PaymentBreakdownHelpers */
/* eslint-disable no-underscore-dangle -- `_default` es la llave de respaldo del mapa de colores */
const PaymentsPanel = (() => {
  // Contexto de la llamada en curso, que fija renderPayments().
  let vista = {};

  /**
   * Formatea un importe con la moneda de la reservación, delegando en la vista.
   * @param {...*} args - Importe y moneda.
   * @returns {string} Importe formateado.
   * @example
   * formatCurrency(1500, 'MXN') // '$1,500.00'
   */
  const formatCurrency = (...args) => vista.formatCurrency(...args);

    // Las dos fechas del historial son de naturaleza distinta y por eso se leen distinto:
    //  · PAGO (paidAt): viene de un <input type="date">, se guarda como medianoche UTC y NO tiene hora
    //    útil. Se lee en UTC — en local (México, offset negativo) caería un día antes.
    //  · REGISTRO (createdAt): instante real en que se capturó el pago. Se lee en hora local.
    // Cada una trae además su propia persona: quién recibió el dinero vs. quién lo capturó.
    const PAYMENT_DATE_FIELDS = {
        date: { get: (p) => p.paidAt || p.createdAt, utc: true },
        created: { get: (p) => p.createdAt, utc: false },
    };

    const PAYMENT_METHOD_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

    // [fondo, texto, borde] por método para el chip del historial. Misma paleta suave de marca que la
    // píldora de estado de la card de cobertura, para que el drawer se lea como una sola pieza.
    const PAYMENT_METHOD_COLORS = {
        efectivo: ['#e6efe1', '#3f5a34', '#cfe0c6'],
        transferencia: ['#eaf1f0', '#3a6b63', '#cfe1dd'],
        tarjeta: ['#f6efe2', '#96682f', '#e7d6bd'],
        _default: ['#f0eee7', '#6b6656', '#ded9cb'],
    };

    /**
     * Milisegundos de la fecha por la que se está ordenando.
     * @param {object} p - Pago.
     * @param {string} key - Campo de fecha ('date' o 'created').
     * @returns {number} Marca de tiempo.
     * @example
     * paymentMs({ paidAt: '2026-07-01' }, 'date')
     */
    const paymentMs = (p, key) => {
        const field = PAYMENT_DATE_FIELDS[key] || PAYMENT_DATE_FIELDS.date;
        const t = new Date(field.get(p) || 0).getTime();
        return Number.isNaN(t) ? 0 : t;
    };

    /**
     * Llave del mes de un pago, para agrupar el historial.
     * @param {object} p - Pago.
     * @param {string} key - Campo de fecha.
     * @returns {string} Llave "AAAA-MM".
     * @example
     * monthKey({ paidAt: '2026-07-01' }, 'date') // '2026-6'
     */
    const monthKey = (p, key) => {
        const { utc } = PAYMENT_DATE_FIELDS[key] || PAYMENT_DATE_FIELDS.date;
        const dt = new Date(paymentMs(p, key));
        const year = utc ? dt.getUTCFullYear() : dt.getFullYear();
        const month = (utc ? dt.getUTCMonth() : dt.getMonth()) + 1;
        return `${year}-${String(month).padStart(2, '0')}`;
    };

    /**
     * Rótulo del mes que encabeza cada grupo del historial.
     * @param {object} p - Pago.
     * @param {string} key - Campo de fecha.
     * @returns {string} Mes y año en texto.
     * @example
     * monthLabel({ paidAt: '2026-07-01' }, 'date') // 'julio 2026'
     */
    const monthLabel = (p, key) => {
        const { utc } = PAYMENT_DATE_FIELDS[key] || PAYMENT_DATE_FIELDS.date;
        const opts = { month: 'long', year: 'numeric' };
        if (utc) opts.timeZone = 'UTC';
        const s = new Date(paymentMs(p, key)).toLocaleDateString('es-MX', opts);
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    /**
     *
     * @param dateStr
     * @example
     */
    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('es-MX', {
 day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
});
    }

    // Fecha + hora de registro, en hora local (ver PAYMENT_DATE_FIELDS).
    /**
     *
     * @param dateStr
     * @example
     */
    function formatDateTimeShort(dateStr) {
        const dt = new Date(dateStr);
        if (Number.isNaN(dt.getTime())) return '—';
        // Día y mes por separado para evitar el guion del locale ("10-jun" → "10 jun"). Hora en 24h: más
        // compacta que "02:32 p.m." y sin ambigüedad.
        const day = dt.toLocaleDateString('es-MX', { day: '2-digit' });
        const month = dt.toLocaleDateString('es-MX', { month: 'short' });
        const time = dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${day} ${month}, ${time}`;
    }

    // Esqueleto de carga del carrito. "Agregar pago" se habilita apenas carga la reservación, así que
    // el panel se puede abrir mientras GET .../payments sigue en vuelo: sin esto salía en blanco y
    // parecía que no funcionaba.
    /**
     *
     * @example
     */
    function renderPaymentsSkeleton() {
        /**
         * Una barra del esqueleto de carga.
         * @param {string} w - Ancho en CSS.
         * @param {string} h - Alto en CSS.
         * @param {string} [extra] - Estilos adicionales.
         * @returns {string} HTML de la barra.
         * @example
         * bar('60%', '12px')
         */
        const bar = (w, h, extra = '') => `<div class="pay-skel" style="width:${w};height:${h};${extra}"></div>`;
        const coverage = document.getElementById('paymentCoverageCard');
        if (coverage) {
            coverage.innerHTML = `<div aria-busy="true" aria-live="polite">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                  <div style="flex:1;">
                    ${bar('190px', '12px')}
                    ${bar('220px', '32px', 'margin-top:9px;')}
                  </div>
                  ${bar('118px', '30px', 'border-radius:999px;')}
                </div>
                ${bar('96px', '11px', 'margin:14px 0 0 auto;')}
                ${bar('100%', '11px', 'border-radius:999px;margin:7px 0 18px;')}
                <div style="display:flex;justify-content:space-between;gap:12px;">
                  <div>${bar('64px', '10px')}${bar('120px', '22px', 'margin-top:7px;')}</div>
                  <div style="text-align:right;">${bar('64px', '10px', 'margin-left:auto;')}${bar('120px', '22px', 'margin:7px 0 0 auto;')}</div>
                </div>
                <div class="d-flex align-items-center gap-2 mt-3 text-muted" style="font-size:.82rem;">
                  <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>Cargando pagos…
                </div>
              </div>`;
        }
        const methodTable = document.getElementById('paymentMethodTable');
        if (methodTable) {
            const rows = [1, 2, 3].map(() => `<div style="display:flex;align-items:center;gap:12px;padding:.55rem 0;border-top:1px solid #f1efe8;">
                ${bar('120px', '13px')}<div style="flex:1;"></div>${bar('80px', '13px')}${bar('44px', '13px')}${bar('90px', '13px')}
              </div>`).join('');
            methodTable.innerHTML = `<div aria-busy="true">${bar('100%', '10px', 'margin-bottom:.35rem;')}${rows}</div>`;
            methodTable.style.display = '';
        }
        const body = document.getElementById('paymentsBody');
        if (body) {
            return `<div aria-busy="true" class="p-1">${[1, 2, 3].map(() => `<div style="display:flex;align-items:center;gap:12px;padding:.6rem .2rem;border-bottom:1px solid #f4f2ec;">
                ${bar('86px', '12px')}${bar('96px', '12px')}<div style="flex:1;"></div>${bar('70px', '12px')}
              </div>`).join('')}</div>`;
        }
    }
    // Si el GET falla no hay summary que pintar: dejar el esqueleto girando para siempre es peor que el
    // panel vacío, así que mostramos el error con reintento.
    /**
     *
     * @example
     */
    /**
     * Aviso de que el historial no se pudo cargar.
     * El botón "Reintentar" lo engancha la vista: reintentar es volver a llamar a SU carga.
     * @returns {string} HTML del aviso.
     * @example
     * PaymentsPanel.renderPaymentsLoadError()
     */
    function renderPaymentsLoadError() {
        return '<div class="text-center py-3 text-muted">No se pudo cargar el historial de pagos.</div>';
    }

    /**
     *
     * @param contexto
     * @example
     */
    function renderPayments(contexto) {
        vista = contexto || {};
        const paymentsSort = vista.sort || { key: 'date', dir: 'desc' };
        const pagos = Array.isArray(vista.payments) ? vista.payments : [];
        const editingPaymentId = vista.editingId || null;

        const d = vista.reservationData;
        // `allowEdit` es de la VISTA: end_client no registra ni edita pagos —el servidor se lo niega
        // con denyRoles en POST/PUT/DELETE— así que su historial no ofrece esos controles. Ver el
        // comprobante sí: es su propio pago.
        const canEdit = vista.allowEdit !== false
            && d.status !== 'cancelled' && d.status !== 'completed';
        const curr = d.currency || 'MXN';

        if (!pagos.length) {
            return `<div class="text-center py-4">
                <i class="ti ti-receipt-off" style="font-size:2rem;color:#c9cdbb;"></i>
                <div class="mt-2 fw-semibold" style="color:#6b6656;">Sin pagos registrados</div>
                <div class="small text-muted">Los pagos que registres aparecerán aquí.</div>
            </div>`;
        }

        // El backend entrega los pagos ascendentes por paidAt; el historial los muestra por defecto del
        // más reciente al más viejo (lo último es lo que se viene a revisar).
        const isDateSort = paymentsSort.key === 'date' || paymentsSort.key === 'created';
        const sorted = pagos.slice().sort((a, b) => {
            const dir = paymentsSort.dir === 'asc' ? 1 : -1;
            if (paymentsSort.key === 'amount') {
                const diff = (a.amount || 0) - (b.amount || 0);
                if (diff) return diff * dir;
            } else {
                const diff = paymentMs(a, paymentsSort.key) - paymentMs(b, paymentsSort.key);
                if (diff) return diff * dir;
            }
            // Desempate estable (dos pagos del mismo día, o dos del mismo monto): el orden de captura.
            return (paymentMs(a, 'created') - paymentMs(b, 'created')) * dir;
        });

        // Agrupar por mes solo tiene sentido con un orden cronológico —y por el mes de LA fecha que se
        // está ordenando—, y solo aporta cuando hay varios pagos repartidos en más de un mes.
        const months = new Set(sorted.map((p) => monthKey(p, paymentsSort.key)));
        const grouped = isDateSort && sorted.length > 4 && months.size > 1;

        let lastMonth = null;
        const rows = sorted.map((p) => {
            let groupRow = '';
            if (grouped && monthKey(p, paymentsSort.key) !== lastMonth) {
                lastMonth = monthKey(p, paymentsSort.key);
                const inMonth = sorted.filter((q) => monthKey(q, paymentsSort.key) === lastMonth);
                const monthSum = inMonth.reduce((acc, q) => acc + (q.amount || 0), 0);
                groupRow = `<tr class="pay-hist-group"><td colspan="6">${PaymentBreakdownHelpers.escapeHtml(monthLabel(p, paymentsSort.key))}
                    <span class="pay-hist-group-sum">${inMonth.length} ${inMonth.length === 1 ? 'pago' : 'pagos'} · ${formatCurrency(monthSum, curr)}</span></td></tr>`;
            }
            const refLine = p.reference
                ? `<span class="pay-hist-ref">${PaymentBreakdownHelpers.escapeHtml(p.reference)}</span>
                   <button type="button" class="pay-hist-act copy-ref-btn" data-ref="${PaymentBreakdownHelpers.escapeHtml(p.reference)}" title="Copiar referencia" aria-label="Copiar referencia" style="width:24px;height:24px;font-size:.85rem;vertical-align:middle;"><i class="ti ti-copy"></i></button>`
                : '<span class="text-muted">—</span>';
            // Columna PAGO: cuándo se pagó y quién recibió el dinero. "Recibió" solo aplica al efectivo
            // (en transferencia/tarjeta no hay una persona que lo tome en mano).
            const receivedLine = (p.method === 'efectivo' && p.receivedBy)
                ? `<div class="pay-hist-person" title="Recibió el dinero"><i class="ti ti-user"></i>${PaymentBreakdownHelpers.escapeHtml(p.receivedBy)}</div>` : '';
            // Columna REGISTRO: cuándo se capturó en el sistema y quién lo capturó. Es el par de la
            // columna de pago, no lo mismo: un pago del día 10 puede capturarse el 28 por otra persona.
            const registeredLine = p.registeredByName
                ? `<div class="pay-hist-person" title="Registró el pago"><i class="ti ti-user"></i>${PaymentBreakdownHelpers.escapeHtml(p.registeredByName)}</div>` : '';
            const registeredAt = p.createdAt ? formatDateTimeShort(p.createdAt) : '<span class="text-muted">—</span>';
            // El comprobante es una acción más (abrir el archivo), así que vive junto a editar/eliminar.
            const receipt = p.receiptUrl
                ? `<a href="${PaymentBreakdownHelpers.escapeHtml(p.receiptUrl)}" target="_blank" rel="noopener" class="pay-hist-act is-receipt" title="Ver comprobante" aria-label="Ver comprobante"><i class="ti ti-file-invoice"></i></a>`
                : '';
            const [mBg, mFg, mBd] = PAYMENT_METHOD_COLORS[p.method] || PAYMENT_METHOD_COLORS._default;
            // Moneda distinta a la de la reservación: el monto listado está en la moneda de la reserva,
            // así que el original se muestra aparte en ámbar en vez de dejar solo un código ambiguo.
            const isForeign = !!p.origCurrency && p.origCurrency !== curr;
            const origLine = (isForeign && p.origAmount)
                ? `<div class="pay-hist-orig">Original ${formatCurrency(p.origAmount, p.origCurrency)}${p.exchangeRate ? ` · TC ${p.exchangeRate}` : ''}</div>` : '';
            // Fila expandida con el formulario de edición, justo bajo el pago tocado. El contenido lo
            // dibuja renderPaymentForm después de montar la tabla (necesita el nodo ya en el DOM).
            const editRow = p.id === editingPaymentId
                ? '<tr class="pay-hist-edit"><td colspan="6"><div class="pay-hist-form" id="paymentEditWrap"></div></td></tr>' : '';
            return `${groupRow}<tr${p.id === editingPaymentId ? ' class="is-editing"' : ''}>
                <td class="pay-hist-date" data-label="Pago">${formatDate(p.paidAt || p.createdAt)}${receivedLine}</td>
                <td data-label="Método"><span class="pay-hist-method" style="background:${mBg};color:${mFg};border-color:${mBd};">${PaymentBreakdownHelpers.escapeHtml(PAYMENT_METHOD_LABELS[p.method] || p.method || '—')}</span></td>
                <td data-label="Referencia">${refLine}</td>
                <td class="pay-hist-meta" data-label="Registro"><div class="pay-hist-stack">${registeredAt}${registeredLine}</div></td>
                <td class="pay-hist-amount" data-label="Monto">${formatCurrency(p.amount, curr)}<span class="pay-hist-curr${isForeign ? ' is-foreign' : ''}">${PaymentBreakdownHelpers.escapeHtml(p.origCurrency || curr)}</span>${origLine}</td>
                <td class="pay-hist-actions" data-label="Acciones">
                    ${receipt}
                    ${canEdit ? `<button type="button" class="pay-hist-act edit-payment-btn" data-payment-id="${p.id}" title="Editar" aria-label="Editar pago"><i class="ti ti-edit"></i></button>
                    <button type="button" class="pay-hist-act is-danger delete-payment-btn" data-payment-id="${p.id}" title="Eliminar" aria-label="Eliminar pago"><i class="ti ti-trash"></i></button>` : ''}
                </td>
            </tr>${editRow}`;
        }).join('');

        // Total de lo listado: ancla el historial contra el "Pagado" de la card de cobertura y delata
        // capturas duplicadas.
        const total = pagos.reduce((acc, p) => acc + (p.amount || 0), 0);
        const arrow = paymentsSort.dir === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down';
        // Reordenar re-monta la tabla, y con ella el formulario inline: se deshabilita mientras hay una
        // edición abierta para no borrar lo que el usuario está escribiendo.
        /**
         * Encabezado de columna ordenable, con su flecha de sentido.
         * @param {string} key - Campo por el que ordena.
         * @param {string} label - Texto de la columna.
         * @param {string} align - Alineación del texto.
         * @returns {string} HTML del encabezado.
         * @example
         * sortTh('amount', 'Monto', 'right')
         */
        const sortTh = (key, label, align) => `<th style="text-align:${align};">
            <button type="button" class="pay-hist-sort${paymentsSort.key === key ? ' is-active' : ''}" data-sort-key="${key}"
                ${editingPaymentId ? 'disabled title="Termina de editar el pago para reordenar"' : ''}
                aria-label="Ordenar por ${label.toLowerCase()}">${label} <i class="ti ${paymentsSort.key === key ? arrow : 'ti-arrows-sort'}"></i></button>
        </th>`;

        return `<table class="pay-hist">
                <thead>
                    <tr>
                        ${sortTh('date', 'Pago', 'left')}
                        <th>Método</th>
                        <th>Referencia</th>
                        ${sortTh('created', 'Registro', 'left')}
                        ${sortTh('amount', 'Monto', 'right')}
                        <th style="text-align:right;">Acciones</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="4" class="pay-hist-foot-label">Total registrado · ${pagos.length} ${pagos.length === 1 ? 'pago' : 'pagos'}</td>
                        <td class="pay-hist-amount" data-label="Total">${formatCurrency(total, curr)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>`;
    }

  return { renderPayments, renderPaymentsSkeleton, renderPaymentsLoadError };
})();

// Node (Jest). En el navegador el IIFE de arriba ya dejó window.PaymentsPanel.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentsPanel;
}
