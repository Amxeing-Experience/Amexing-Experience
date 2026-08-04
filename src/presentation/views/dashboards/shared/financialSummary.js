/**
 * Resumen financiero de una reservación — el bloque de totales, saldo y comparativo por método.
 *
 * Lo pintan los detalles de client, department_manager y end_client. Vivía dentro de la plantilla de
 * client y duplicado en department_manager; end_client no lo tenía, y por eso mostraba filas de
 * Bootstrap sin total destacado, sin saldo y sin desglose por método de pago.
 *
 * buildHtml() devuelve una CADENA: no toca el DOM ni engancha eventos. El botón "Agregar pago" se
 * cablea desde la vista que sí puede registrar pagos.
 *
 * La sangría se conserva como estaba en la plantilla: sus plantillas literales la arrastran al HTML.
 * Created by Denisse Maldonado.
 */

/* eslint-disable indent */
/* global PaymentBreakdownHelpers */
const FinancialSummary = (() => {
  // Contexto de la llamada en curso, que fija buildHtml().
  let vista = {};

  /**
   * Formatea un importe con la moneda de la reservación, delegando en la vista.
   * @param {...*} args - Importe y moneda.
   * @returns {string} Importe formateado.
   * @example
   * formatCurrency(1500, 'MXN') // '$1,500.00'
   */
  const formatCurrency = (...args) => vista.formatCurrency(...args);

    /**
     * Arma el HTML del resumen financiero de la reservación.
     * @param {object} contexto - `{ reservationData, formatCurrency, allowEdit }`.
     * @returns {string} HTML del resumen.
     * @example
     * FinancialSummary.buildHtml({ reservationData, formatCurrency, allowEdit: false })
     */
    function buildHtml(contexto) {
        vista = contexto || {};
        const d = vista.reservationData;
        const adjustments = d.adjustments || [];
        const curr = d.currency || 'MXN';
        const pay = d.payment;
        // `allowEdit` es de la VISTA: end_client no registra pagos —el servidor se lo niega con
        // denyRoles— así que su hero no debe ofrecer el botón. El estado de la reservación es lo otro.
        const canEdit = vista.allowEdit !== false
            && d.status !== 'cancelled' && d.status !== 'completed';
        // Subtotal recalculado desde pricesByType[paymentType] de cada servicio, para que la reservación
        // cuadre con la cotización cuando ambas usan el mismo método. Cae a los valores guardados en data
        // muy vieja sin pricesByType.
        const computedSubtotal = PaymentBreakdownHelpers.computeServicesSubtotalByType(d.services, d.paymentType, curr);
        const servicesSubtotal = computedSubtotal > 0
            ? computedSubtotal
            : (d.servicesSubtotal || d.totalAmount || 0);
        // Propina cobrada (Fase 2): del summary del servidor (d.payment), NUNCA de d.globalTip del snapshot
        // bruto ni recalculada localmente. d.totalAmount ya la incluye vía recalculateTotal.
        const generalTip = pay ? PaymentBreakdownHelpers.round2(pay.generalTip) : 0;
        const serviceTipsTotal = pay ? PaymentBreakdownHelpers.round2(pay.serviceTipsTotal) : 0;

        // La tarjeta financiera se pinta SIEMPRE que haya datos de reservación, con o sin ajustes.
        // (Antes un early-return con 0 ajustes ocultaba también Subtotal/Total/Saldo — bug corregido.)
        // "Agregar pago" se renderiza dentro del hero (solo si canEdit); su click se cablea por
        // delegación sobre #financialSummaryCard, porque el hero se re-renderiza en cada pago.

        const paymentTypeLabel = d.paymentType
            ? d.paymentType.charAt(0).toUpperCase() + d.paymentType.slice(1)
            : '—';

        // Comparativo por método: los precios de servicios cambian por método. Se despliega desde el
        // chip de método (Transferencia ⇄), no como sección suelta — queda pegado a lo que explica.
        const comparisonMethods = [
            { method: 'efectivo', label: 'Efectivo', icon: 'ti-cash' },
            { method: 'transferencia', label: 'Transferencia', icon: 'ti-building-bank' },
            { method: 'tarjeta', label: 'Tarjeta', icon: 'ti-credit-card' },
        ];
        // El método solo cambia el SUBTOTAL de servicios; el resto (ajustes, propinas) es igual. Por eso
        // el TOTAL por método = total actual + Δsubtotal — así cada fila es el "Total a pagar" en ese
        // método, y el actual coincide con el número grande del hero.
        const cmpSubtotals = comparisonMethods.map((m) => ({
            ...m,
            subtotal: PaymentBreakdownHelpers.computeServicesSubtotalByType(d.services, m.method, curr),
        }));
        const cmpActual = cmpSubtotals.find((m) => m.method === d.paymentType) || {};
        const cmpCurrentSubtotal = cmpActual.subtotal || 0;
        const cmpBaseTotal = pay ? (Number(pay.total) || 0) : cmpCurrentSubtotal;
        const cmpAmounts = cmpSubtotals.map((m) => ({
            ...m,
            amount: cmpBaseTotal + (m.subtotal - cmpCurrentSubtotal),
        }));
        const cmpDelActual = cmpAmounts.find((m) => m.method === d.paymentType) || {};
        const cmpCurrent = cmpDelActual.amount || 0;
        const cmpCheapest = Math.min(...cmpAmounts.map((m) => m.amount));
        const comparisonRows = cmpAmounts.map((m) => {
            const isActive = m.method === d.paymentType;
            const delta = m.amount - cmpCurrent;
            let tag;
            if (isActive) {
                tag = '<span class="fin-cmp-badge">Actual</span>';
            } else if (Math.abs(delta) >= 0.005) {
                const c = delta > 0 ? '#b8894a' : '#4b6b3f';
                tag = `<span class="fin-cmp-delta" style="color:${c}">${delta > 0 ? '+' : '-'}${formatCurrency(Math.abs(delta), curr)}</span>`;
            } else {
                tag = '<span class="fin-cmp-delta" style="color:#8a8f78">igual</span>';
            }
            const cheap = (!isActive && m.amount === cmpCheapest && cmpCheapest < cmpCurrent)
                ? '<span class="fin-cmp-cheap">más barato</span>' : '';
            return `<div class="fin-cmp-row ${isActive ? 'active' : ''}">
                <span class="fin-cmp-method"><i class="ti ${m.icon}"></i>${m.label}${cheap}</span>
                <span class="fin-cmp-right"><span class="fin-cmp-amount">${formatCurrency(m.amount, curr)}</span>${tag}</span>
            </div>`;
        }).join('');
        // Chip de método = disparador del comparativo (collapse INLINE, no dropdown flotante).
        const methodChipHtml = '<button type="button" class="fin-hero-method" data-bs-toggle="collapse" data-bs-target="#paymentMethodComparison" aria-expanded="false" aria-controls="paymentMethodComparison" title="Comparar por método de pago">'
            + `<i class="ti ti-credit-card"></i>${PaymentBreakdownHelpers.escapeHtml(paymentTypeLabel)}<i class="ti ti-arrows-exchange fin-chev" title="Comparar métodos de pago"></i></button>`;
        // El comparativo se expande inline (empuja el contenido), no como panel flotante.
        const comparisonInlineHtml = '<div class="collapse fin-cmp-inline" id="paymentMethodComparison">'
            + `<div class="fin-cmp-cap">Total a pagar según el método de pago:</div>${comparisonRows}</div>`;
        // Hint de ahorro SIEMPRE visible: si otro método es más barato que el actual, lo anuncia sin
        // tener que abrir el comparativo (p. ej. "En efectivo ahorras $7,542").
        const cmpCheapestMethod = cmpAmounts.find((m) => m.amount === cmpCheapest);
        const cmpSavings = cmpCurrent - cmpCheapest;
        const savingsHint = (cmpCheapestMethod && cmpCheapestMethod.method !== d.paymentType && cmpSavings >= 0.005)
            ? `<div class="fin-hero-hint"><i class="ti ti-discount-2"></i>En ${PaymentBreakdownHelpers.escapeHtml(cmpCheapestMethod.label.toLowerCase())} ahorras ${formatCurrency(cmpSavings, curr)}</div>`
            : '';

        let html = '';
        // ===== Hero de pago: cifras clave + barra de cobertura (solo si hay datos de pago) =====
        if (pay) {
            const heroResolved = PaymentBreakdownHelpers.resolveDisplayedBalance(pay);
            const heroPaid = Number(pay.paidAmount) || 0;
            const heroTotal = Number(pay.total) || 0;
            const heroBal = heroResolved.displayedBalance;
            const heroPct = heroTotal > 0 ? Math.min(100, Math.round((heroPaid / heroTotal) * 100)) : 0;
            // La píldora de estado solo sale cuando dice algo que las cifras de este mismo hero no
            // dicen ya. Pendiente es 0% y saldo igual al total; parcial es un porcentaje entre 1 y
            // 99; pagado es 100% y saldo cero, que además se tiñe de verde solo. Reembolsado, en
            // cambio, no se deduce de ningún número de aquí. La lista es de lo que se CALLA, no de
            // lo que se muestra: un estado nuevo aparecerá por omisión en vez de esconderse.
            const ESTADOS_QUE_LAS_CIFRAS_YA_DICEN = ['pending', 'partial', 'paid'];
            const estadoHtml = ESTADOS_QUE_LAS_CIFRAS_YA_DICEN.includes(pay.paymentStatus)
                ? ''
                : `<span class="fin-status-lbl">Estado de pago</span>
                   ${PaymentBreakdownHelpers.getPaymentStatusBadge(pay.paymentStatus)}`;
            const heroSavings = heroResolved.savings
                ? `<div class="fin-savings"><i class="ti ti-discount-2 me-2"></i><strong>${PaymentBreakdownHelpers.escapeHtml(heroResolved.savings.label)}</strong><div class="small">${PaymentBreakdownHelpers.escapeHtml(heroResolved.savings.sublabel)}</div></div>`
                : '';
            html += `<div class="fin-hero">
                <div class="fin-hero-top">
                    <div>
                        <div class="fin-hero-lbl">Total a pagar ${methodChipHtml}</div>
                        <div class="fin-hero-total">${formatCurrency(heroTotal, curr)}</div>
                        ${savingsHint}
                    </div>
                    <div class="fin-hero-meta">
                        ${estadoHtml}
                        ${canEdit ? '<button class="fin-pay-btn" id="addPaymentBtn"><i class="ti ti-cash"></i>Agregar pago</button>' : ''}
                    </div>
                </div>
                ${comparisonInlineHtml}
                <div class="fin-hero-pct">${heroPct}% pagado</div>
                <div class="fin-bar"><span style="width:${heroPct}%;background:#4b6b3f"></span></div>
                <div class="fin-hero-foot">
                    <div><span class="lbl">Pagado</span><div class="val" style="color:#4b6b3f">${formatCurrency(heroPaid, curr)}</div></div>
                    <div class="text-end"><span class="lbl">Saldo</span><div class="val" style="color:${heroBal > 0 ? '#b8894a' : '#4b6b3f'}">${formatCurrency(heroBal, curr)}</div></div>
                </div>
                ${heroSavings}
            </div>`;
        }

        // ===== Desglose =====
        // Sin datos de pago no hay hero: el chip de método (con su comparativo inline) se muestra aquí.
        if (!pay) {
            html += `<div class="fin-row"><span class="lbl"><i class="ti ti-credit-card"></i>Tipo de pago</span><span class="val">${methodChipHtml}</span></div>${comparisonInlineHtml}`;
        }
        html += `<div class="fin-row"><span class="lbl"><i class="ti ti-list-details"></i>Subtotal servicios</span><span class="val">${formatCurrency(servicesSubtotal, curr)}</span></div>`;

        // Propina cobrada (Fase 2): líneas del summary del servidor para que Subtotal + ajustes + propina
        // reconcilie con el Total a pagar. La general en su línea; la de por-servicio agregada (los tips por
        // servicio también aparecen por servicio en el itinerario, aquí es el agregado).
        if (generalTip > 0) {
            html += `<div class="fin-row"><span class="lbl"><i class="ti ti-coin fin-tip"></i>Propina general</span><span class="val fin-tip">+${formatCurrency(generalTip, curr)}</span></div>`;
        }
        if (serviceTipsTotal > 0) {
            html += `<div class="fin-row"><span class="lbl"><i class="ti ti-coin fin-tip"></i>Propinas por servicio</span><span class="val fin-tip">+${formatCurrency(serviceTipsTotal, curr)}</span></div>`;
        }

        // Ajustes YA creados: se listan pero NO se pueden crear ni eliminar desde aquí (/adjustments es
        // admin-only, así que ni el botón de agregar ni el de quitar existen en el DOM). Framing neutral
        // de cargo/ajuste — nunca la palabra "descuento" ni su ícono.
        adjustments.filter((a) => a.type === 'charge').forEach((adj) => {
            html += `<div class="fin-row">
                <span class="lbl"><i class="ti ti-plus text-danger"></i>${PaymentBreakdownHelpers.escapeHtml(adj.description)}</span>
                <span class="val text-danger">+${formatCurrency(adj.amount, curr)}</span>
            </div>`;
        });
        adjustments.filter((a) => a.type === 'discount').forEach((adj) => {
            html += `<div class="fin-row">
                <span class="lbl"><i class="ti ti-minus text-success"></i>${PaymentBreakdownHelpers.escapeHtml(adj.description)}</span>
                <span class="val text-success">-${formatCurrency(adj.amount, curr)}</span>
            </div>`;
        });

        return html;
    }

  return { buildHtml };
})();

// Node (Jest). En el navegador el IIFE de arriba ya dejó window.FinancialSummary.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FinancialSummary;
}
