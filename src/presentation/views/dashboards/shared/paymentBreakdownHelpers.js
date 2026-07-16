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
  // Ajustes generados por el mecanismo de reconciliacion de metodo de pago (Fase 0). Los
  // ajustes manuales del staff no llevan source.
  const AUTO_RECONCILIATION_SOURCE = 'payment-method-reconciliation';

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
   * True si el ajuste fue generado por la reconciliacion automatica de metodo de pago (source
   * === 'payment-method-reconciliation'). Los ajustes manuales del staff (sin source) dan false.
   * @param {object} adjustment - Ajuste { source }.
   * @returns {boolean} True para el ajuste automatico, false en cualquier otro caso.
   * @example
   * hasAutoReconciliationBadge({ source: 'payment-method-reconciliation' }) // true
   */
  function hasAutoReconciliationBadge(adjustment) {
    return !!(adjustment && adjustment.source === AUTO_RECONCILIATION_SOURCE);
  }

  return {
    AUTO_RECONCILIATION_SOURCE,
    PAYMENT_STATUS_MAP,
    round2,
    escapeHtml,
    cashRoundMXN,
    getServicePriceByType,
    computeServicesSubtotalByType,
    getPaymentStatusBadge,
    hasAutoReconciliationBadge,
  };
})();

// Exporta en Node (Jest/backend) y en el navegador (window.PaymentBreakdownHelpers), sin build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentBreakdownHelpers;
}
if (typeof window !== 'undefined') {
  window.PaymentBreakdownHelpers = PaymentBreakdownHelpers;
}
