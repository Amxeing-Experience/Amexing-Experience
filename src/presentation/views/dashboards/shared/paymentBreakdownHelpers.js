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

  // El verde de descuento del proyecto (#146c43, el mismo token que reservation-public.ejs usa en
  // .rc-adj-discount) pasó a la hoja: .pay-cob-ahorro-tit lo aplica. Aquí quedaba una constante sin
  // uso. NO usar text-success de Bootstrap: el dueño fijó ese color exacto para el énfasis.

  /**
   * Redondea a 2 decimales (0 para entradas no numericas), igual que round2 del servidor.
   * @param {number} value - Valor a redondear.
   * @returns {number} Valor con 2 decimales.
   * @example
   * round2(12.345) // 12.35
   */
  function round2(value) {
    // + Number.EPSILON corrige el caso clasico de punto flotante donde un valor como 1.005 se
    // representa internamente como 1.00499999999999989, redondeando a 1.00 en vez de 1.01 (perdiendo
    // un centavo real) — misma correccion que PaymentService.round2 del servidor, para no divergir.
    return Math.round((Number(value) + Number.EPSILON || 0) * 100) / 100;
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
   * Descuento por servicio (Fase 1) expresado en el metodo dado. discountAmount se captura en efectivo;
   * como el recargo por forma de pago es multiplicativo, se escala por pricesByType[metodo]/pricesByType.efectivo
   * (en efectivo el factor es 1). Es la MISMA cantidad que getServicePriceByType resta al precio y que
   * PaymentService.chargeAmount usa en el servidor, extraida aqui para reusarla tal cual en la etiqueta
   * "Descuento" del desglose por servicio (antes pintaba el monto BRUTO en efectivo, divergente del precio
   * escalado mostrado justo arriba). Sin base efectivo utilizable (o metodo no finito) cae al bruto.
   * @param {object} svc - Servicio { subconcept: { pricesByType, discountAmount } }.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @returns {number} Descuento aplicado en ese metodo, a 2 decimales (0 si no hay descuento).
   * @example
   * getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 1000, tarjeta: 1210 }, discountAmount: 100 } }, 'tarjeta') // 121
   */
  function getServiceDiscountByType(svc, paymentType) {
    const sub = svc && svc.subconcept;
    const discEf = Number(sub && sub.discountAmount) || 0;
    if (discEf <= 0) return 0;
    const pbt = sub ? sub.pricesByType : null;
    if (pbt && typeof pbt === 'object') {
      const v = Number(pbt[paymentType]);
      const efBase = Number(pbt.efectivo);
      if (Number.isFinite(v) && efBase > 0 && pbt[paymentType] != null) {
        return round2(discEf * (v / efBase));
      }
    }
    return round2(discEf);
  }

  /**
   * Núcleo de precio por método: pricesByType[paymentType] MENOS el descuento por servicio (Fase 1),
   * SIN aplicar el zero-out de includeInTotal. Paridad EXACTA con PaymentService.chargeAmount del
   * servidor; el descuento se resta via getServiceDiscountByType (misma fuente que la etiqueta
   * "Descuento"). Guard Number.isFinite (no !Number.isNaN) para que Infinity/NaN caigan al mismo
   * fallback (item.total, tambien finite-guarded) que un valor ausente. Compartido por
   * getServicePriceByType (que excluye) y getServicePriceByTypeGross (que no).
   * @param {object} svc - Servicio { subconcept: { pricesByType, discountAmount }, total }.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @returns {number} Precio por método, neto de descuento.
   */
  function servicePriceCore(svc, paymentType) {
    const pbt = svc && svc.subconcept ? svc.subconcept.pricesByType : null;
    // Paridad EXACTA con PaymentService.chargeAmount del servidor: solo un Number(...) FINITO cuenta.
    // Sin el pre-check `!= null`: un null explícito (Number(null) === 0) da 0 igual que el servidor, en
    // vez de caer al fallback item.total (antes divergían: cliente=item.total vs servidor=0).
    if (pbt && typeof pbt === 'object') {
      const v = Number(pbt[paymentType]);
      if (Number.isFinite(v)) {
        // Descuento escalado por método (getServiceDiscountByType), idéntico a chargeAmount. Clamp a
        // 0: nunca un cobro negativo aunque el descuento supere el precio del método.
        return Math.max(0, round2(v - getServiceDiscountByType(svc, paymentType)));
      }
    }
    const total = Number(svc && svc.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Monto a COBRAR por método (servicePriceCore) con el zero-out de includeInTotal: un servicio
   * excluido del total ("Pago externo") devuelve 0 porque no suma al agregado financiero
   * (Subtotal/Total/Saldo). Es el usado por computeServicesSubtotalByType. NO usar para pintar la línea
   * individual de un servicio excluido (mostraría $0.00): para eso está getServicePriceByTypeGross.
   * @param {object} svc - Servicio { subconcept: { includeInTotal, pricesByType, discountAmount }, total }.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @returns {number} Monto a cobrar por ese metodo, neto de descuento (0 si esta excluido o si el descuento lo supera).
   * @example
   * getServicePriceByType({ subconcept: { pricesByType: { efectivo: 2000 }, discountAmount: 300 } }, 'efectivo') // 1700
   */
  function getServicePriceByType(svc, paymentType) {
    if (svc && svc.subconcept && svc.subconcept.includeInTotal === false) return 0;
    return servicePriceCore(svc, paymentType);
  }

  /**
   * Precio REAL del servicio por método, SIN el zero-out de includeInTotal: idéntico a
   * getServicePriceByType salvo que un servicio excluido del total ("Pago externo") devuelve su precio
   * real, no 0. Es el que debe usar la LÍNEA individual de la lista de servicios, para que el monto real
   * se vea (marcado con su badge "Pago externo") en vez de aparentar un servicio gratis. NO usar para el
   * agregado financiero: ese sigue en getServicePriceByType/computeServicesSubtotalByType, que sí
   * excluye. Para un servicio NO excluido devuelve exactamente lo mismo que getServicePriceByType.
   * @param {object} svc - Servicio { subconcept: { pricesByType, discountAmount }, total }.
   * @param {string} paymentType - Metodo (efectivo|transferencia|tarjeta).
   * @returns {number} Precio real por método, neto de descuento (nunca forzado a 0 por exclusión).
   * @example
   * getServicePriceByTypeGross({ subconcept: { includeInTotal: false, pricesByType: { tarjeta: 99 } } }, 'tarjeta') // 99
   */
  function getServicePriceByTypeGross(svc, paymentType) {
    return servicePriceCore(svc, paymentType);
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
   * pagado" literal — H2) el saldo mostrado es el `balance` físico, clampado a 0 (NUNCA se muestra un
   * saldo negativo, decisión explícita del dueño del negocio) y NUNCA hay línea de ahorro, sin importar
   * el método del pago parcial (trampa: un parcial en método distinto al ancla no genera ahorro
   * mostrado; solo lo genera un pago 'paid').
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
            label: `Descuento de $${shown}`,
            sublabel: 'Cubierto en su totalidad pagando en un método distinto al de la cotización.',
          },
        };
      }
      // Overpay / método igual o más caro que el ancla (H1): saldo $0, sin mensaje especial.
      return { displayedBalance: 0, savings: null };
    }
    // pending / partial / refunded (H2): saldo físico tal cual, nunca línea de ahorro. Se clampa a 0
    // (nunca un saldo negativo mostrado): puede ocurrir cuando el pago parcial fue en un método más
    // caro que el ancla y su equivalente aún no cierra 'paid', dejando el balance físico en negativo
    // (se pagó más dinero físico del total, pero no lo suficiente en la moneda de la cotización). El
    // dueño del negocio fue explícito: nunca debe mostrarse un saldo negativo.
    return { displayedBalance: Math.max(0, balance), savings: null };
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
   * Card de cobertura: badge de estado, barra grande con `coveragePercent` (del backend, tal cual),
   * fila "Pagado" (monto físico `paidAmount`, sin cambio de fórmula) y fila "Saldo" (usa
   * resolveDisplayedBalance — 0 cuando está pagado — con la línea de ahorro cuando aplica).
   * El hint de ahorro ("En efectivo ahorras…") se recibe ya construido porque depende de los totales
   * por método, que se calculan desde los servicios de la reservación y este helper no los recibe.
   * @param {object} summary - Summary del backend.
   * @param {string} currency - Moneda.
   * @param {string} [savingsHintHtml] - HTML opcional a insertar bajo "Total a pagar".
   * @param {object} [opciones] - Ajustes de la vista.
   * @param {boolean} [opciones.metodoInteractivo] - El chip del método abre el comparativo.
   * @param {boolean} [opciones.ocultarEstado] - Sin píldora de estado; el chip toma su esquina.
   * @returns {string} HTML de la card de cobertura.
   * @example
   * buildCoverageCard(summary, 'MXN')
   */
  function buildCoverageCard(summary, currency, savingsHintHtml, opciones) {
    const s = summary || {};
    const coverage = round2(s.coveragePercent);
    const coverageWidth = Math.max(0, Math.min(100, coverage));
    const resolved = resolveDisplayedBalance(s);
    const savingsHtml = resolved.savings
      ? `<div class="pay-cob-ahorro">
          <div class="pay-cob-ahorro-tit"><i class="ti ti-discount-2"></i>${escapeHtml(resolved.savings.label)}</div>
          <div class="pay-cob-ahorro-sub">${escapeHtml(resolved.savings.sublabel)}</div>
        </div>` : '';
    // Píldora de estado: la clase la resuelve la hoja (.pay-cob-estado.is-*), no un estilo en línea.
    const tonos = {
      'bg-secondary text-white': 'is-neutro',
      'bg-warning text-dark': 'is-parcial',
      'bg-success text-white': 'is-pagado',
      'bg-info text-white': 'is-favor',
    };
    const sm = PAYMENT_STATUS_MAP[s.paymentStatus] || { label: s.paymentStatus, cls: 'bg-secondary text-white' };
    // La píldora se calla donde el estado ya se dice de otras formas —el porcentaje, lo pagado, el
    // saldo, y en admin además la barra del pie, que es de donde se abre este panel—.
    const sinEstado = Boolean(opciones && opciones.ocultarEstado);
    const statusPill = sinEstado
      ? ''
      : `<span class="pay-cob-estado ${tonos[sm.cls] || 'is-neutro'}"><span class="pay-cob-punto"></span>${escapeHtml(sm.label)}</span>`;
    // Método cotizado como chip a un lado de "Total a pagar". Donde hay un comparativo que abrir
    // (hoy solo admin) el chip es el botón que lo despliega: queda pegado a lo que explica.
    const interactivo = Boolean(opciones && opciones.metodoInteractivo);
    const methodChip = interactivo
      ? `<button type="button" class="pay-cob-metodo is-boton" data-cmp-toggle aria-expanded="false"
          title="Comparar el total en cada método de pago"><i class="ti ti-credit-card"></i>${escapeHtml(methodLabel(s.anchoredMethod))}<i class="ti ti-arrows-exchange pay-cob-metodo-chev"></i></button>`
      : `<span class="pay-cob-metodo" title="Método cotizado"><i class="ti ti-credit-card"></i>${escapeHtml(methodLabel(s.anchoredMethod))}</span>`;
    // El bloque dejó de ser una tarjeta blanca con filete de acento dentro de un panel que ya es una
    // superficie: lo que separa ahora es la jerarquía —rótulo en versalitas, cifra grande, barra— y no
    // una caja. El porcentaje baja DEBAJO de la barra: es su lectura, no un dato aparte.
    return `<div class="pay-cob-top">
        <div>
          <div class="pay-cob-cap">Total a pagar${sinEstado ? '' : ` ${methodChip}`}</div>
          <div class="pay-cob-total">${formatMoney(round2(s.total), currency)}</div>
          ${savingsHintHtml || ''}
        </div>
        ${sinEstado ? methodChip : statusPill}
      </div>
      <div class="pay-cob-barra" role="progressbar" aria-valuenow="${coverageWidth}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${coverageWidth}%"></span>
      </div>
      <div class="pay-cob-pct">${coverage}% pagado</div>
      <div class="pay-cob-par">
        <div>
          <div class="pay-cob-cap-sm">Pagado</div>
          <div class="pay-cob-cifra is-pagado">${formatMoney(round2(s.paidAmount), currency)}</div>
        </div>
        <div class="pay-cob-der">
          <div class="pay-cob-cap-sm">Saldo</div>
          <div class="pay-cob-cifra${resolved.displayedBalance > 0 ? '' : ' is-cubierto'}">${formatMoney(resolved.displayedBalance, currency)}</div>
        </div>
      </div>
      ${savingsHtml}`;
  }

  return {
    PAYMENT_STATUS_MAP,
    METHOD_LABELS,
    round2,
    escapeHtml,
    cashRoundMXN,
    getServiceDiscountByType,
    getServicePriceByType,
    getServicePriceByTypeGross,
    computeServicesSubtotalByType,
    getPaymentStatusBadge,
    methodLabel,
    formatMoney,
    formatDate,
    resolveDisplayedBalance,
    cheapestAvailableMethod,
    buildCoverageCard,
  };
})();

// Exporta en Node (Jest/backend) y en el navegador (window.PaymentBreakdownHelpers), sin build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentBreakdownHelpers;
}
if (typeof window !== 'undefined') {
  window.PaymentBreakdownHelpers = PaymentBreakdownHelpers;
}
