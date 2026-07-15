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
  const GENERAL_TIP_LABEL = 'Propina general (sin servicio asignado)';

  // Estado de pago — solid badge + text-white salvo bg-warning (text-dark).
  const PAYMENT_STATUS_MAP = {
    pending: { label: 'Pendiente de pago', cls: 'bg-secondary text-white' },
    partial: { label: 'Pago parcial', cls: 'bg-warning text-dark' },
    paid: { label: 'Pagado', cls: 'bg-success text-white' },
    refunded: { label: 'Reembolsado', cls: 'bg-info text-white' },
  };

  // Personal asignable a un servicio, con su icono/color (mismo mapeo que buildPersonCard en
  // admin/booking-detail.ejs): conductor/guia/greeter.
  const STAFF_ROLES = [
    {
      field: 'assignedDriver', icon: 'ti-steering-wheel', colorClass: 'info', roleLabel: 'Conductor',
    },
    {
      field: 'assignedGuide', icon: 'ti-map-pin', colorClass: 'success', roleLabel: 'Guia',
    },
    {
      field: 'assignedGreeter', icon: 'ti-hand-stop', colorClass: 'warning', roleLabel: 'Greeter',
    },
  ];

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

  /**
   * Etiqueta legible de un servicio (concepto), con fallback neutral.
   * @param {object} svc - Servicio { concept }.
   * @returns {string} Concepto recortado, o 'Servicio' si no hay.
   * @example
   * getServiceDisplayLabel({ concept: 'Traslado' }) // 'Traslado'
   */
  function getServiceDisplayLabel(svc) {
    const concept = svc && svc.concept ? String(svc.concept).trim() : '';
    return concept || 'Servicio';
  }

  /**
   * Responsable(s) ya asignados a un servicio (conductor/guia/greeter) para la variante admin del
   * desglose de propina. Devuelve datos (icono/color/nombre), no HTML.
   * @param {object} svc - Servicio con assignedDriver/assignedGuide/assignedGreeter.
   * @returns {Array<object>} [{ icon, colorClass, roleLabel, name }] (vacio si no hay asignados).
   * @example
   * buildStaffEntries({ assignedDriver: { fullName: 'Juan' } }) // [{ icon: 'ti-steering-wheel', ... }]
   */
  function buildStaffEntries(svc) {
    const out = [];
    for (const role of STAFF_ROLES) {
      const person = svc ? svc[role.field] : null;
      const name = person && (person.fullName || person.name);
      if (name) {
        out.push({
          icon: role.icon, colorClass: role.colorClass, roleLabel: role.roleLabel, name,
        });
      }
    }
    return out;
  }

  /**
   * Cruza tipByService (del summary) x services para el desglose de propina por concepto.
   * includeStaff=true (admin) adjunta el/los responsable(s); false (agencia) solo nombre + monto.
   * Un reservationServiceId huerfano (servicio borrado/reordenado, sin match en services) se FUSIONA
   * al bucket general — nunca se pierde el dinero; un tip no finito se trata como 0 y las entradas con
   * tip 0 se omiten. Devuelve DATOS puros (la plantilla arma el HTML): entradas de servicio en orden
   * de `services` y el bucket general al final.
   * @param {Array<object>} tipByService - Buckets [{ reservationServiceId, tip }] del summary.
   * @param {Array<object>} services - Servicios de la reservacion.
   * @param {object} [options] - { includeStaff:boolean }.
   * @returns {Array<object>} [{ serviceId, isGeneral, label, tip, staff }].
   * @example
   * groupTipEntriesForDisplay([{ reservationServiceId: null, tip: 50 }], [], {}) // [{ serviceId: null, ... }]
   */
  function groupTipEntriesForDisplay(tipByService, services, options) {
    const opts = options || {};
    const includeStaff = !!opts.includeStaff;
    const buckets = Array.isArray(tipByService) ? tipByService : [];
    const svcList = Array.isArray(services) ? services : [];

    const svcById = new Map();
    for (const svc of svcList) {
      if (svc && svc.id != null) svcById.set(String(svc.id), svc);
    }

    const perService = new Map();
    let generalTip = 0;
    for (const bucket of buckets) {
      if (bucket) {
        const rawTip = Number(bucket.tip);
        const tip = Number.isFinite(rawTip) ? rawTip : 0;
        const rawId = bucket.reservationServiceId;
        const id = (rawId === null || rawId === undefined || rawId === '') ? null : String(rawId);
        if (id !== null && svcById.has(id)) {
          perService.set(id, round2((perService.get(id) || 0) + tip));
        } else {
          // Bucket general (null) u huerfano -> pool general (fusion solo de presentacion).
          generalTip = round2(generalTip + tip);
        }
      }
    }

    const entries = [];
    for (const svc of svcList) {
      const id = svc && svc.id != null ? String(svc.id) : null;
      if (id !== null && perService.has(id)) {
        const tip = round2(perService.get(id));
        if (tip !== 0) {
          entries.push({
            serviceId: id,
            isGeneral: false,
            label: getServiceDisplayLabel(svc),
            tip,
            staff: includeStaff ? buildStaffEntries(svc) : [],
          });
        }
      }
    }
    generalTip = round2(generalTip);
    if (generalTip !== 0) {
      entries.push({
        serviceId: null,
        isGeneral: true,
        label: GENERAL_TIP_LABEL,
        tip: generalTip,
        staff: [],
      });
    }
    return entries;
  }

  /**
   * Deriva el monto aplicado a servicios de un pago a partir del total recibido y la propina, con
   * el estado de validacion del formulario (Fase 4). serviceAmount = round2(total - tip). Entradas
   * no finitas/NaN/vacias se tratan como 0 (Number(x) + guard Number.isFinite, igual que el resto del
   * motor), nunca se propaga NaN/Infinity. No impone el techo AMOUNT_MAX: ese se valida por campo
   * (totalReceived/tip) por separado, nunca sobre la suma ni sobre este derivado.
   * @param {number} totalReceived - Monto total recibido capturado por el staff.
   * @param {number} tip - Propina capturada (parte de ese total).
   * @returns {{serviceAmount:number, state:('ok'|'warning'|'blocked')}} Monto de servicios + estado.
   * @example
   * deriveServiceAmount(500, 100) // { serviceAmount: 400, state: 'ok' }
   */
  function deriveServiceAmount(totalReceived, tip) {
    const totalNum = Number(totalReceived);
    const tipNum = Number(tip);
    const total = Number.isFinite(totalNum) ? totalNum : 0;
    const t = Number.isFinite(tipNum) ? tipNum : 0;
    const serviceAmount = round2(total - t);
    let state = 'ok';
    if (t > total) {
      // La propina excede el total recibido: serviceAmount seria negativo (sin sentido) -> bloquea.
      state = 'blocked';
    } else if (t > serviceAmount) {
      // Propina mayor al monto de servicios (t > total/2) pero <= total: solo advierte, no bloquea.
      state = 'warning';
    }
    return { serviceAmount, state };
  }

  /**
   * Estructura del <select> "Servicio de la reservacion" del formulario de pago (Fase 4). Decide
   * visibilidad, orden y preseleccion; NO produce el HTML. La etiqueta de cada servicio la resuelve
   * getLabel (el formulario pasa getDisplayConcept de la plantilla; sin el, cae a getServiceDisplayLabel),
   * asi esa logica de concepto no se duplica aqui. La opcion "Propina general" (value '') va SIEMPRE
   * primera; su etiqueta la pone el llamador segun isGeneral.
   *
   * Reglas: 0 servicios -> visible:false (se omite del DOM). 1 servicio -> preseleccionado en el en
   * creacion; en edicion respeta el existente (general u huerfano caen a general). 2+ -> "general"
   * preseleccionada por default en creacion (ambiguedad real, nunca un servicio); en edicion
   * preselecciona el id existente si sigue en la lista, o cae a general si es null o un id huerfano
   * (servicio borrado/reordenado) — mismo fallback-a-general que groupTipEntriesForDisplay.
   * existingReservationServiceId === undefined = creacion; null = edicion sin servicio (general).
   * @param {Array<object>} services - Servicios de la reservacion (cada uno con id).
   * @param {?string} [existingReservationServiceId] - Servicio del pago en edicion (undefined en creacion).
   * @param {Function} [getLabel] - Resuelve la etiqueta de un servicio (svc -> string).
   * @returns {{visible:boolean, selectedValue:string, options:Array<object>}} Estructura del selector.
   * @example
   * buildServiceSelectorOptions([{ id: 'a', concept: 'Traslado' }], undefined) // visible, selectedValue 'a'
   */
  function buildServiceSelectorOptions(services, existingReservationServiceId, getLabel) {
    const resolveLabel = typeof getLabel === 'function' ? getLabel : getServiceDisplayLabel;
    const list = Array.isArray(services) ? services : [];
    const valid = list.filter((svc) => svc && svc.id != null);

    if (valid.length === 0) {
      return { visible: false, selectedValue: '', options: [] };
    }

    const isEditing = existingReservationServiceId !== undefined;
    const existingId = (existingReservationServiceId === null
      || existingReservationServiceId === undefined
      || existingReservationServiceId === '')
      ? null
      : String(existingReservationServiceId);
    const matched = existingId !== null && valid.some((svc) => String(svc.id) === existingId);

    let selectedValue;
    if (matched) {
      selectedValue = existingId;
    } else if (isEditing) {
      // Edicion sin servicio (general) o con un id huerfano -> pool general.
      selectedValue = '';
    } else {
      // Creacion: un solo servicio no tiene ambiguedad (preselecciona ese); 2+ cae a general.
      selectedValue = valid.length === 1 ? String(valid[0].id) : '';
    }

    const options = [{ value: '', isGeneral: true, selected: selectedValue === '' }];
    for (const svc of valid) {
      const value = String(svc.id);
      options.push({
        value,
        isGeneral: false,
        label: resolveLabel(svc),
        selected: selectedValue === value,
      });
    }

    return { visible: true, selectedValue, options };
  }

  return {
    AUTO_RECONCILIATION_SOURCE,
    GENERAL_TIP_LABEL,
    PAYMENT_STATUS_MAP,
    round2,
    cashRoundMXN,
    getServicePriceByType,
    computeServicesSubtotalByType,
    getPaymentStatusBadge,
    hasAutoReconciliationBadge,
    groupTipEntriesForDisplay,
    deriveServiceAmount,
    buildServiceSelectorOptions,
  };
})();

// Exporta en Node (Jest/backend) y en el navegador (window.PaymentBreakdownHelpers), sin build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaymentBreakdownHelpers;
}
if (typeof window !== 'undefined') {
  window.PaymentBreakdownHelpers = PaymentBreakdownHelpers;
}
