/**
 * PaymentBreakdownHelpers — funciones puras compartidas por las 3 plantillas
 * booking-detail.ejs (admin / department_manager / client) para el desglose de pagos.
 *
 * Isomorfico: se requiere en Node (Jest, testEnvironment 'node') y se carga en el navegador
 * como <script src="/shared/payments/paymentBreakdownHelpers.js"> (window.PaymentBreakdownHelpers),
 * sin build step — mismo patron que pricingEngine.js. Es PURO: sin document/DOM, sin fetch, sin
 * estado global; todo entra por parametros. Centraliza la logica que antes vivia duplicada dentro
 * de cada <script> embebido (y byte-a-byte entre department_manager/client), y corrige el guard de
 * paridad con el servidor (Number.isFinite, no !Number.isNaN) para nunca pintar $Infinity/NaN.
 * @module paymentBreakdownHelpers
 */

const PaymentBreakdownHelpers = (() => {
  // Entidades HTML para neutralizar texto controlado por el usuario (referencia/notas de pago,
  // descripcion de ajuste) antes de interpolarlo en innerHTML / atributo / <textarea>. Un solo
  // pase por regex evita el doble-escape de '&'.
  const HTML_ENTITIES = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };

  // Estado de pago — solid badge + text-white salvo bg-warning (text-dark).
  const PAYMENT_STATUS_MAP = {
    pending: { label: 'Pendiente de pago', cls: 'bg-secondary text-white' },
    partial: { label: 'Pago parcial', cls: 'bg-warning text-dark' },
    paid: { label: 'Pagado', cls: 'bg-success text-white' },
    refunded: { label: 'Reembolsado', cls: 'bg-info text-white' },
  };

  // Etiquetas legibles de los métodos de pago (mismo set en las 3 plantillas del carrito).
  const METHOD_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

  // Verde de descuento del proyecto (mismo token literal que reservation-public.ejs .rc-adj-discount).
  // NO usar text-success de Bootstrap: el dueño fijó este color exacto para el énfasis de descuento.
  const DISCOUNT_GREEN = '#146c43';

  /**
   * Redondea a 2 decimales (0 para entradas no numericas), igual que round2 del servidor.
   * @param {number} value - Valor a redondear.
   * @returns {number} Valor con 2 decimales.
   * @example
   * round2(12.345) // 12.35
   */
  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  /**
   * Escapa los 5 caracteres con significado en HTML (& < > " ') a sus entidades, para interpolar
   * texto controlado por el usuario dentro de innerHTML, de un atributo o de un textarea sin permitir
   * inyeccion de markup/script (stored XSS). null/undefined -> '' (nunca 'null'/'undefined').
   * @param {*} value - Valor a escapar (se coacciona a string).
   * @returns {string} Texto seguro para interpolar en HTML.
   * @example
   * escapeHtml('<img src=x onerror=alert(1)>') // '&lt;img src=x onerror=alert(1)&gt;'
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
  }

  /**
   * Redondeo a efectivo: multiplo de 5 MXN (regla fisica del efectivo, applyCashRounding del
   * servidor). NO aplica a tarjeta/transferencia ni a USD.
   * @param {number} price - Precio a redondear.
   * @returns {number} Precio redondeado al multiplo de 5.
   * @example
   * cashRoundMXN(103) // 100
   */
  function cashRoundMXN(price) {
    const value = Number(price) || 0;
    const integerPart = Math.floor(value);
    const decimalPart = value - integerPart;
    if (decimalPart <= 0.50) return Math.floor(integerPart / 5) * 5;
    if (integerPart === 0) return 5;
    return Math.ceil(integerPart / 5) * 5;
  }

  /**
   * Precio ya aprobado por la cotizacion para este metodo (pricesByType[paymentType]), igual que
   * PaymentService.chargeAmount. Guard Number.isFinite (no !Number.isNaN) para que Infinity/NaN
   * caigan al mismo fallback (item.total, tambien finite-guarded) que un valor ausente — nunca $Infinity.
   * @param {object} svc - Servicio { subconcept: { includeInTotal, pricesByType }, total }.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @returns {number} Monto a cobrar por ese metodo (0 si esta excluido del total).
   * @example
   * getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 121 } } }, 'tarjeta') // 121
   */
  function getServicePriceByType(svc, paymentType) {
    if (svc && svc.subconcept && svc.subconcept.includeInTotal === false) return 0;
    const pbt = svc && svc.subconcept ? svc.subconcept.pricesByType : null;
    if (pbt && typeof pbt === 'object' && pbt[paymentType] != null) {
      const v = Number(pbt[paymentType]);
      if (Number.isFinite(v)) return v;
    }
    const total = Number(svc && svc.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Total de servicios por metodo: suma de pricesByType[paymentType]; efectivo en MXN redondeado a
   * multiplo de 5 (nunca en USD). La moneda entra por parametro (antes era estado global).
   * @param {Array<object>} services - Servicios de la reservacion.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @param {string} currency - Moneda (MXN aplica redondeo a efectivo).
   * @returns {number} Subtotal de servicios para ese metodo, a 2 decimales.
   * @example
   * computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo', 'MXN') // 100
   */
  function computeServicesSubtotalByType(services, paymentType, currency) {
    const list = Array.isArray(services) ? services : [];
    let value = list.reduce((sum, svc) => sum + getServicePriceByType(svc, paymentType), 0);
    const curr = String(currency || 'MXN').toUpperCase();
    if (paymentType === 'efectivo' && curr === 'MXN') {
      value = cashRoundMXN(value);
    }
    return round2(value);
  }

  /**
   * Badge HTML del estado de pago (mismo PAYMENT_STATUS_MAP en las 3 plantillas). Estado nulo/vacio
   * devuelve string vacio; estado desconocido cae al fallback bg-secondary con su propio texto.
   * @param {string} status - pending|partial|paid|refunded (u otro).
   * @returns {string} HTML del badge, o '' si status es falsy.
   * @example
   * getPaymentStatusBadge('paid') // '<span class="badge bg-success text-white" ...>Pagado</span>'
   */
  function getPaymentStatusBadge(status) {
    if (!status) return '';
    const s = PAYMENT_STATUS_MAP[status] || { label: status, cls: 'bg-secondary text-white' };
    return `<span class="badge ${s.cls}" title="Estado de pago">${s.label}</span>`;
  }

  /**
   * Etiqueta legible de un método de pago (fallback al string crudo cuando es desconocido/legacy).
   * @param {string} method - efectivo|transferencia|tarjeta (u otro).
   * @returns {string} Etiqueta para mostrar.
   * @example
   * methodLabel('efectivo') // 'Efectivo'
   */
  function methodLabel(method) {
    return METHOD_LABELS[method] || method || '—';
  }

  /**
   * Formatea un monto como moneda (mismo formato que formatCurrency de las plantillas: es-MX, 2
   * decimales; prefijo "USD $" para USD, "$" en otro caso).
   * @param {number} amount - Monto a formatear.
   * @param {string} [currency] - Moneda (USD antepone "USD $").
   * @returns {string} Monto formateado.
   * @example
   * formatMoney(1234.5, 'MXN') // '$1,234.50'
   */
  function formatMoney(amount, currency) {
    const sym = currency === 'USD' ? 'USD $' : '$';
    return `${sym}${(Number(amount) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Formatea una fecha (mismo formato que formatDate de las plantillas: es-MX, UTC, dd/mmm/yyyy).
   * @param {string} dateStr - Fecha ISO o parseable.
   * @returns {string} Fecha formateada, o '—' cuando es vacía.
   * @example
   * formatDate('2026-07-15T00:00:00Z') // '15 jul 2026'
   */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }

  /**
   * Regla del Saldo mostrado (Pregunta 0, aprobada por el dueño). El campo `balance` físico (total −
   * paidAmount) NO cambia; esto SOLO decide cómo se PRESENTA el saldo y si se muestra una línea de
   * ahorro aparte. Cuando `paymentStatus === 'paid'` el saldo mostrado es SIEMPRE 0 (nunca el residuo
   * físico): si además el `balance` físico quedó positivo (se pagó en un método más barato que el ancla
   * de la cotización), ese residuo es un AHORRO y se muestra como línea separada, nunca restado del
   * saldo; si el `balance` físico es <= 0 (se pagó igual o más caro que el ancla, caso overpay H1) no
   * hay línea de ahorro. Cuando NO está pagado (pending/partial, y refunded se trata igual que "no
   * pagado" literal — H2) el saldo mostrado es el `balance` físico tal cual y NUNCA hay línea de ahorro,
   * sin importar el método del pago parcial (trampa: un parcial en método distinto al ancla no genera
   * ahorro mostrado; solo lo genera un pago 'paid').
   * @param {object} summary - Summary de PaymentService.buildSummary ({ paymentStatus, balance, ... }).
   * @returns {object} { displayedBalance:number, savings:null|{ amount:number, label:string, sublabel:string } }.
   * @example
   * resolveDisplayedBalance({ paymentStatus: 'paid', balance: 21000 })
   * // { displayedBalance: 0, savings: { amount: 21000, label: 'Ahorraste $21,000.00 ...', sublabel: '...' } }
   */
  function resolveDisplayedBalance(summary) {
    const s = summary || {};
    const balance = round2(s.balance);
    if (s.paymentStatus === 'paid') {
      if (balance > 0) {
        const shown = balance.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return {
          displayedBalance: 0,
          savings: {
            amount: balance,
            label: `Ahorraste $${shown} pagando en un método distinto al de la cotización.`,
            sublabel: 'Cubierto en su totalidad pagando en un método distinto al de la cotización.',
          },
        };
      }
      // Overpay / método igual o más caro que el ancla (H1): saldo $0, sin mensaje especial.
      return { displayedBalance: 0, savings: null };
    }
    // pending / partial / refunded (H2): saldo físico tal cual, nunca línea de ahorro.
    return { displayedBalance: balance, savings: null };
  }

  /**
   * Método disponible más barato (menor total de servicios). Base para el énfasis de descuento: solo
   * hay "descuento" cuando el ancla es más cara que este método (regla de dirección, no una regla fija
   * por tipo de cliente). Devuelve null si no hay métodos.
   * @param {Array<string>} availableMethods - Métodos disponibles (derivados por el backend).
   * @param {Array<object>} services - Servicios de la reservación.
   * @param {string} currency - Moneda.
   * @returns {string|null} Método más barato, o null.
   * @example
   * cheapestAvailableMethod(['efectivo', 'tarjeta'], services, 'MXN') // 'efectivo'
   */
  function cheapestAvailableMethod(availableMethods, services, currency) {
    const methods = Array.isArray(availableMethods) ? availableMethods : [];
    let best = null;
    let bestTotal = Infinity;
    methods.forEach((m) => {
      const total = computeServicesSubtotalByType(services, m, currency);
      if (total < bestTotal) { bestTotal = total; best = m; }
    });
    return best;
  }

  /**
   * Chips de método de pago (Requisito 3): un chip por método disponible con su total por método
   * (gran total = servicios en ese método + ajustes netos) y una mini barra de cobertura. La barra y el
   * % usan `coveragePercent` del backend TAL CUAL, idéntico en los 3 chips (correcto: `montoParaSaldar`
   * excluye ajustes del denominador y `coveragePercent` los incluye, así que re-derivar en cliente daría
   * un número distinto e incorrecto). El chip del método más barato lleva un badge verde "Más barato".
   * @param {object} summary - Summary del backend.
   * @param {Array<object>} services - Servicios de la reservación (para el total por método).
   * @param {string} currency - Moneda.
   * @returns {string} HTML de los chips (o un aviso si no hay métodos — H3).
   * @example
   * buildMethodChips(summary, services, 'MXN')
   */
  function buildMethodChips(summary, services, currency) {
    const s = summary || {};
    const methods = Array.isArray(s.availableMethods) ? s.availableMethods : [];
    if (!methods.length) {
      return '<div class="text-muted small py-2">No hay métodos de pago disponibles para esta reservación.</div>';
    }
    const adjustments = round2(s.adjustments);
    const coverage = round2(s.coveragePercent);
    const coverageWidth = Math.max(0, Math.min(100, coverage));
    const anchor = s.anchoredMethod;
    const cheapest = cheapestAvailableMethod(methods, services, currency);
    const showCheaper = cheapest && anchor && cheapest !== anchor;
    const chips = methods.map((m) => {
      const methodTotal = round2(computeServicesSubtotalByType(services, m, currency) + adjustments);
      const anchorTag = m === anchor
        ? '<span class="badge bg-secondary-subtle text-secondary ms-1">Cotizado</span>' : '';
      const cheaperTag = (showCheaper && m === cheapest)
        ? `<span class="badge ms-1" style="background:${DISCOUNT_GREEN};color:#fff;">Más barato</span>` : '';
      return `<div class="border rounded p-2">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-semibold small">${methodLabel(m)}${anchorTag}${cheaperTag}</span>
            <span class="small">${formatMoney(methodTotal, currency)}</span>
          </div>
          <div class="progress" style="height:6px;" role="progressbar" aria-valuenow="${coverageWidth}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar bg-success" style="width:${coverageWidth}%;"></div>
          </div>
          <div class="text-muted mt-1" style="font-size:0.7rem;">${coverage}% cubierto</div>
        </div>`;
    }).join('');
    return `<div class="d-flex flex-column gap-2">${chips}</div>`;
  }

  /**
   * Card de cobertura: badge de estado, barra grande con `coveragePercent` (del backend, tal cual),
   * fila "Pagado" (monto físico `paidAmount`, sin cambio de fórmula) y fila "Saldo" (usa
   * resolveDisplayedBalance — 0 cuando está pagado — con la línea de ahorro cuando aplica).
   * @param {object} summary - Summary del backend.
   * @param {string} currency - Moneda.
   * @returns {string} HTML de la card de cobertura.
   * @example
   * buildCoverageCard(summary, 'MXN')
   */
  function buildCoverageCard(summary, currency) {
    const s = summary || {};
    const coverage = round2(s.coveragePercent);
    const coverageWidth = Math.max(0, Math.min(100, coverage));
    const resolved = resolveDisplayedBalance(s);
    const balanceCls = resolved.displayedBalance > 0 ? 'text-danger' : 'text-success';
    const savingsHtml = resolved.savings
      ? `<div class="mt-2 p-2 rounded" style="background:#e8f5ee;">
          <div class="fw-semibold" style="color:${DISCOUNT_GREEN};"><i class="ti ti-discount-2 me-1"></i>${escapeHtml(resolved.savings.label)}</div>
          <div class="small" style="color:${DISCOUNT_GREEN};">${escapeHtml(resolved.savings.sublabel)}</div>
        </div>` : '';
    return `<div class="d-flex justify-content-between align-items-center mb-2">
        <span class="text-muted small"><i class="ti ti-cash me-1"></i>Estado de pago</span>
        ${getPaymentStatusBadge(s.paymentStatus)}
      </div>
      <div class="progress mb-2" style="height:12px;" role="progressbar" aria-valuenow="${coverageWidth}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar bg-success" style="width:${coverageWidth}%;">${coverage}%</div>
      </div>
      <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
        <span class="text-muted small"><i class="ti ti-check me-1"></i>Pagado</span>
        <span class="fw-semibold text-success">${formatMoney(round2(s.paidAmount), currency)}</span>
      </div>
      <div class="d-flex justify-content-between align-items-center py-1">
        <span class="text-muted small"><i class="ti ti-wallet me-1"></i>Saldo</span>
        <span class="fw-semibold ${balanceCls}">${formatMoney(resolved.displayedBalance, currency)}</span>
      </div>
      ${savingsHtml}`;
  }

  /**
   * Desglose de saldo restante por método (Requisito 8): cuánto costaría saldar en cada método
   * disponible, leyendo `montoParaSaldar` del backend tal cual. Vacío cuando ya está pagado o no hay
   * métodos.
   * @param {object} summary - Summary del backend.
   * @param {string} currency - Moneda.
   * @returns {string} HTML del desglose (o '' cuando no aplica).
   * @example
   * buildRemainingByMethod(summary, 'MXN')
   */
  function buildRemainingByMethod(summary, currency) {
    const s = summary || {};
    if (s.paymentStatus === 'paid') return '';
    const methods = Array.isArray(s.availableMethods) ? s.availableMethods : [];
    if (!methods.length) return '';
    const mps = s.montoParaSaldar || {};
    const rows = methods.map((m) => `<div class="d-flex justify-content-between align-items-center py-1 border-bottom">
        <span class="small">${methodLabel(m)}</span>
        <span class="fw-semibold">${formatMoney(round2(mps[m]), currency)}</span>
      </div>`).join('');
    return `<div class="text-muted small mb-1">Para saldar el restante (${round2(s.remainingPercent)}%):</div>${rows}`;
  }

  /**
   * Énfasis de descuento (Fase E): cuando el método ancla es más caro que el método disponible más
   * barato, resalta el ahorro potencial de pagar en el más barato (verde #146c43, no text-success).
   * Frase explícita de ahorro + precio de lista del ancla tachado. Vacío cuando el ancla ya es el más
   * barato (sin descuento que mostrar — regla de dirección).
   * @param {object} summary - Summary del backend.
   * @param {Array<object>} services - Servicios de la reservación.
   * @param {string} currency - Moneda.
   * @returns {string} HTML del énfasis (o '' cuando no hay descuento).
   * @example
   * buildDiscountEmphasis(summary, services, 'MXN')
   */
  function buildDiscountEmphasis(summary, services, currency) {
    const s = summary || {};
    const methods = Array.isArray(s.availableMethods) ? s.availableMethods : [];
    const anchor = s.anchoredMethod;
    if (methods.length < 2 || !anchor) return '';
    const cheapest = cheapestAvailableMethod(methods, services, currency);
    if (!cheapest || cheapest === anchor) return '';
    const anchorTotal = computeServicesSubtotalByType(services, anchor, currency);
    const cheapestTotal = computeServicesSubtotalByType(services, cheapest, currency);
    const savings = round2(anchorTotal - cheapestTotal);
    if (savings <= 0) return '';
    return `<div class="p-2 rounded" style="background:#e8f5ee;">
        <div class="fw-semibold" style="color:${DISCOUNT_GREEN};"><i class="ti ti-discount-2 me-1"></i>Ahorra ${formatMoney(savings, currency)} pagando en ${methodLabel(cheapest)}.</div>
        <div class="small" style="color:${DISCOUNT_GREEN};">Precio de lista (${methodLabel(anchor)}): <s>${formatMoney(anchorTotal, currency)}</s> &middot; Con ${methodLabel(cheapest)}: ${formatMoney(cheapestTotal, currency)}</div>
      </div>`;
  }

  /**
   * Tabla de historial de pagos de SOLO LECTURA (agencia/agente): sin columna de acciones. El texto
   * controlado por el usuario (referencia) se escapa (stored XSS). Admin usa su propia tabla interactiva.
   * @param {Array<object>} payments - Pagos formateados (DTO de Payment.formatPayment).
   * @param {string} currency - Moneda de la reservación.
   * @returns {string} HTML de la tabla (o un vacío legible cuando no hay pagos).
   * @example
   * buildPaymentsHistoryTable(payments, 'MXN')
   */
  function buildPaymentsHistoryTable(payments, currency) {
    const list = Array.isArray(payments) ? payments : [];
    if (!list.length) return '<div class="text-center py-3 text-muted">Sin pagos registrados</div>';
    const rows = list.map((p) => {
      const ref = p.reference ? escapeHtml(p.reference) : '<span class="text-muted">&mdash;</span>';
      const receipt = p.receiptUrl
        ? `<a href="${escapeHtml(p.receiptUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary py-0 px-1" title="Ver comprobante"><i class="ti ti-file-invoice"></i></a>`
        : '<span class="text-muted">&mdash;</span>';
      return `<tr>
          <td>${formatDate(p.paidAt || p.createdAt)}</td>
          <td><span class="badge bg-secondary-subtle text-secondary">${methodLabel(p.method)}</span></td>
          <td>${ref}</td>
          <td class="text-end">${formatMoney(p.amount, currency)}</td>
          <td>${escapeHtml(p.origCurrency || currency)}</td>
          <td class="text-center">${receipt}</td>
        </tr>`;
    }).join('');
    return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">
        <thead class="table-light"><tr>
          <th>Fecha</th><th>Método</th><th>Referencia</th><th class="text-end">Monto</th><th>Moneda</th><th class="text-center">Comprobante</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  return {
    PAYMENT_STATUS_MAP,
    METHOD_LABELS,
    round2,
    escapeHtml,
    cashRoundMXN,
    getServicePriceByType,
    computeServicesSubtotalByType,
    getPaymentStatusBadge,
    methodLabel,
    formatMoney,
    formatDate,
    resolveDisplayedBalance,
    cheapestAvailableMethod,
    buildMethodChips,
    buildCoverageCard,
    buildRemainingByMethod,
    buildDiscountEmphasis,
    buildPaymentsHistoryTable,
  };
})();

// Exporta en Node (Jest/backend) y en el navegador (window.PaymentBreakdownHelpers), sin build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentBreakdownHelpers;
}
if (typeof window !== 'undefined') {
  window.PaymentBreakdownHelpers = PaymentBreakdownHelpers;
}
