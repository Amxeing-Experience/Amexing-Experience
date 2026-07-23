/**
 * PaymentService - Business logic for reservation payments.
 *
 * Pure helpers (serviceBase/computeTotals/deriveStatus) compute the amount due
 * and payment status without touching Parse, so they are trivially unit-testable.
 * Recalculate() loads the reservation and its existing payments, then writes the
 * payment rollup (paidAmount/balance/paymentStatus) onto the Reservation. Payments
 * are plain money amounts applied against the grand total (balance = total − paid);
 * there is no per-service payment split.
 *
 * Modelo de precio por método de pago (solo reservación): se COBRA el valor que la
 * cotización ya calculó y el cliente ya aprobó para ese método — pricesByType.efectivo,
 * .transferencia o .tarjeta, según reservation.paymentType — sin recalcular con ninguna
 * tasa. Esto garantiza paridad exacta con la cotización por construcción (no por
 * coincidencia de números): no hay fetch de tasas, no hay riesgo de que AgencyRate/
 * TransferRate cambien entre cotizar y pagar, y no hay porcentajes propios en esta capa.
 * El efectivo en MXN se redondea a múltiplo de 5 (ley de redondeo, applyCashRounding) —
 * es una regla física del efectivo (no hay billete/moneda de 1 o 2 pesos practicable),
 * distinta de la paridad con la cotización, así que puede diferir en unos pesos del
 * monto sin redondear que muestra la cotización; tarjeta/transferencia NO se redondean.
 * NO se toca el motor de cotizaciones (pricingEngine); solo se lee lo que ya calculó.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('../../domain/models/BaseModel');
const Payment = require('../../domain/models/Payment');
const ExchangeRate = require('../../domain/models/ExchangeRate');
const logger = require('../../infrastructure/logger');
// Solo se importa el redondeo a efectivo (múltiplo de 5). No se modifica el motor.
const { applyCashRounding } = require('../../domain/pricing/pricingEngine');
const { withReservationLock } = require('../../infrastructure/concurrency/reservationLock');

/**
 * Round to 2 decimals (currency precision).
 * @param {number} n - Value to round.
 * @returns {number} Rounded value (0 for non-numeric input).
 * @example
 * round2(12.345) // 12.35
 */
function round2(n) {
  // + Number.EPSILON corrige el caso clasico de punto flotante donde un valor como 1.005 se
  // representa internamente como 1.00499999999999989, redondeando a 1.00 en vez de 1.01 (perdiendo
  // un centavo real). Verificado que no cambia ningun otro valor ya cubierto por los tests existentes.
  return Math.round((Number(n) + Number.EPSILON || 0) * 100) / 100;
}

/**
 * PaymentService class with pure pricing helpers and the payment recalculation.
 */
class PaymentService {
  /**
   * Lee el precio YA calculado y aprobado por la cotización para un método de pago
   * (pricesByType[paymentType]), MENOS el descuento por servicio (Fase 1). pricesByType es la base
   * PURA sin descuento; el descuento se captura en efectivo (item.discountAmount) y se resta aquí
   * escalado por el mismo factor multiplicativo que el front (getServiceDiscountInPaymentType) y el
   * server (evaluateTotalsConsistency), de modo que el cobro coincida EXACTO con reservation.totalAmount.
   * Sin restarlo, un servicio con descuento cobraba el bruto y el saldo quedaba positivo (= el descuento)
   * para siempre, con paymentStatus atascado en 'partial'. Fallback a item.total (ya neto) cuando ese
   * método no está presente (dato viejo o incompleto), igual que antes.
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total, discountAmount }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @returns {number} Monto a cobrar por ese método, neto de descuento (0 si está excluido o si el descuento lo supera).
   * @example
   * PaymentService.chargeAmount({ pricesByType: { efectivo: 2000 }, discountAmount: 300 }, 'efectivo') // 1700
   */
  static chargeAmount(item, paymentType) {
    if (!item || item.includeInTotal === false) return 0;
    const prices = item.pricesByType;
    if (prices && typeof prices === 'object') {
      const amount = Number(prices[paymentType]);
      if (Number.isFinite(amount)) {
        const discEf = Number(item.discountAmount) || 0;
        let discountInType = 0;
        if (discEf > 0) {
          const efBase = Number(prices.efectivo);
          // El recargo por forma de pago es multiplicativo: descontar sobre la base y recargar ==
          // recargar y descontar el monto escalado por pricesByType[método]/pricesByType.efectivo. En
          // efectivo el factor es 1 (resta directa). Sin base efectivo utilizable, se resta el bruto.
          discountInType = (efBase > 0 && prices[paymentType] != null)
            ? round2(discEf * (amount / efBase))
            : discEf;
        }
        // Clamp a 0: un descuento mayor al precio del método nunca da un cobro negativo.
        return Math.max(0, round2(amount - discountInType));
      }
    }
    const total = Number(item.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Resolve a single service's BASE price (efectivo), reading pricesByType.efectivo
   * (fallback to total). Es el precio de referencia para el desglose Subtotal/recargo
   * que se muestra en la UI (no se usa para calcular el cobro de otros métodos).
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @returns {number} Base (efectivo) price (0 when excluded from total).
   * @example
   * PaymentService.serviceBase({ pricesByType: { efectivo: 100 } }) // 100
   */
  static serviceBase(item) {
    return this.chargeAmount(item, 'efectivo');
  }

  /**
   * Compute reservation totals from plain service items: se suma pricesByType[paymentType]
   * por servicio (el valor ya aprobado en la cotización), + net adjustments. Efectivo
   * en MXN se redondea a múltiplo de 5 (regla física del efectivo, no afecta tarjeta/transferencia).
   * @param {Array<object>} serviceItems - Plain items { id, includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @param {number} [adjustmentsNet] - Net reservation adjustments (charges − discounts), pesos finales.
   * @param {string} [currency] - Moneda (MXN aplica redondeo a efectivo).
   * @param {number} [reservationTip] - Propina cobrada (general + por servicio), pesos FIJOS que no escalan por método.
   * @returns {object} { subtotal, adjustments, iva, surcharge, servicesTotal, tip, total, paymentType }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100, tarjeta: 121 } }], 'tarjeta') // total 121
   */
  static computeTotals(serviceItems, paymentType, adjustmentsNet = 0, currency = 'MXN', reservationTip = 0) {
    const items = Array.isArray(serviceItems) ? serviceItems : [];
    let base = 0;
    let chargeSum = 0;
    for (const item of items) {
      base += this.serviceBase(item);
      chargeSum += this.chargeAmount(item, paymentType);
    }
    base = round2(base);

    let servicesTotal = round2(chargeSum);
    // Efectivo en MXN: redondeo a múltiplo de 5 sobre el total (ley de redondeo del proyecto).
    if (paymentType === 'efectivo' && String(currency).toUpperCase() === 'MXN') {
      servicesTotal = round2(applyCashRounding(servicesTotal));
    }

    // Ajustes (cargos/descuentos) se suman como pesos finales (sin factor).
    const adjustments = round2(Number(adjustmentsNet) || 0);
    // Propina = pesos FIJOS que NUNCA escalan por método de pago (mismo criterio que los ajustes). Se
    // suma DESPUÉS del redondeo a efectivo de los servicios y DESPUÉS de los ajustes, dentro del clamp
    // final; NO se re-redondea a múltiplo de 5, NO afecta servicesTotal (base de conversión entre
    // métodos) ni surcharge. Guarda: solo un número finito y positivo cuenta (NaN/Infinity/negativo -> 0).
    const rawTip = Number(reservationTip);
    const tip = Number.isFinite(rawTip) && rawTip > 0 ? round2(rawTip) : 0;
    // El total nunca es negativo: un descuento mayor a servicios+propina lo deja en 0 (no "menos que nada").
    const total = Math.max(0, round2(servicesTotal + adjustments + tip));
    // Recargo agregado por el método (IVA, o IVA + tarjeta). Se expone también como `iva`
    // por compatibilidad con los consumidores existentes del summary.
    const surcharge = round2(servicesTotal - base);

    return {
      subtotal: base,
      adjustments,
      iva: surcharge,
      surcharge,
      servicesTotal,
      tip,
      total,
      paymentType,
    };
  }

  /**
   * Total a cobrar por un método (solo servicios, sin ajustes): computeTotals(...).servicesTotal.
   * Función pura reutilizable — recibe serviceItems/currency explícitos, sin capturar estado externo.
   * @param {Array<object>} serviceItems - Plain items { includeInTotal, pricesByType, total }.
   * @param {string} method - Método (efectivo|transferencia|tarjeta).
   * @param {string} [currency] - Moneda (MXN aplica redondeo a efectivo).
   * @returns {number} Total de servicios por ese método.
   * @example
   * PaymentService.totalForMethod([{ pricesByType: { tarjeta: 121 } }], 'tarjeta') // 121
   */
  static totalForMethod(serviceItems, method, currency = 'MXN') {
    return this.computeTotals(serviceItems, method, 0, currency).servicesTotal;
  }

  /**
   * Tolerancia de cierre de saldo: $5 MXN (única fuente de desvío es el redondeo de efectivo a
   * múltiplo de 5); $0.01 para USD o cualquier combinación sin efectivo.
   * @param {string} currency - Moneda de la reservación.
   * @returns {number} Tolerancia en la moneda de cobro.
   * @example
   * PaymentService.resolveTolerance('MXN') // 5
   */
  static resolveTolerance(currency) {
    return String(currency).toUpperCase() === 'MXN' ? 5 : 0.01;
  }

  /**
   * Convierte un pago a pesos-equivalentes del método ANCLA de la reservación (heredado de la
   * cotización). Un pago en un método más caro que el ancla cubre MENOS base; uno más barato cubre
   * MÁS. SIEMPRE re-basado al ancla real (nunca hardcodeado a efectivo). Guardas: monto no finito
   * (Infinity/NaN) -> 0 (fail-safe); base del ancla <= 0 (sin servicios cobrables) -> 0; método
   * corrupto o tier del método <= 0 -> 1:1 sin convertir.
   * @param {object} payment - Pago { amount, method }.
   * @param {object} opts - Contexto de conversión.
   * @param {Array<object>} opts.serviceItems - Plain service items.
   * @param {string} opts.anchoredMethod - Método ancla (reservation.paymentType).
   * @param {string} [opts.currency] - Moneda.
   * @param {Array<string>} [opts.validMethods] - Métodos aceptados.
   * @returns {number} Cobertura del pago en pesos del ancla.
   * @example
   * PaymentService.baseEquivalente({ amount: 121, method: 'tarjeta' }, { serviceItems, anchoredMethod: 'tarjeta' }) // 121
   */
  static baseEquivalente(payment, {
    serviceItems, anchoredMethod, currency = 'MXN', validMethods = ['efectivo', 'transferencia', 'tarjeta'],
  }) {
    const amt = Number.isFinite(payment?.amount) ? payment.amount : 0;
    const baseTotal = this.totalForMethod(serviceItems, anchoredMethod, currency);
    if (!Number.isFinite(baseTotal) || baseTotal <= 0) return 0;
    const method = payment?.method;
    const isValid = validMethods.includes(method);
    const tierTotal = isValid ? this.totalForMethod(serviceItems, method, currency) : null;
    if (tierTotal === null || !Number.isFinite(tierTotal) || tierTotal <= 0) return amt;
    return amt * (baseTotal / tierTotal);
  }

  /**
   * Desglose de saldo restante medido contra el ancla (Requisito 8): deuda total, cobertura
   * equivalente-ancla de los pagos, saldo base restante (clamp a 0 dentro de tolerancia, nunca
   * negativo), su % y cuánto costaría saldarlo en cada método. El ratio de conversión entre métodos
   * usa SIEMPRE servicesTotal (nunca .total con ajustes): los ajustes manuales son pesos fijos sin
   * tarifa por método — se suman una sola vez al totalDue/remainingBase, sin volver a convertirlos.
   * @param {Array<object>} payments - Pagos { amount, method }.
   * @param {object} opts - Contexto de conversión.
   * @param {Array<object>} opts.serviceItems - Plain service items.
   * @param {string} opts.anchoredMethod - Método ancla (reservation.paymentType).
   * @param {string} [opts.currency] - Moneda.
   * @param {number} [opts.adjustmentsNet] - Ajustes netos (cargos − descuentos), pesos finales.
   * @param {number} [opts.reservationTip] - Propina cobrada (general + por servicio), pesos planos sin escalar por método.
   * @param {Array<string>} [opts.validMethods] - Métodos aceptados.
   * @returns {object} { totalDue, coverageAmount, remainingBase, remainingPercent, montoParaSaldar }.
   * @example
   * PaymentService.remainingBreakdown(payments, { serviceItems, anchoredMethod: 'efectivo' })
   */
  static remainingBreakdown(payments, {
    serviceItems, anchoredMethod, currency = 'MXN', adjustmentsNet = 0, reservationTip = 0, validMethods = ['efectivo', 'transferencia', 'tarjeta'],
  }) {
    const baseTotal = this.totalForMethod(serviceItems, anchoredMethod, currency);
    // La propina entra al saldo como pesos planos, EXACTAMENTE igual que adjustmentsNet (no se re-convierte
    // por método): se suma una sola vez a la deuda total, nunca por el ratio de montoParaSaldar.
    const tipDue = Number.isFinite(Number(reservationTip)) && Number(reservationTip) > 0 ? round2(reservationTip) : 0;
    const totalDue = Math.max(0, round2(baseTotal + (Number(adjustmentsNet) || 0) + tipDue));
    const coverageAmount = round2((payments || []).reduce(
      (sum, p) => sum + this.baseEquivalente(p, {
        serviceItems, anchoredMethod, currency, validMethods,
      }),
      0
    ));
    const tolerance = this.resolveTolerance(currency);
    const rawRemaining = round2(totalDue - coverageAmount);
    // Clamp: un residuo dentro de la tolerancia (redondeo de efectivo) se cierra en 0; nunca negativo.
    const remainingBase = Math.abs(rawRemaining) <= tolerance ? 0 : Math.max(0, rawRemaining);
    const remainingPercent = totalDue > 0 ? round2((remainingBase / totalDue) * 100) : 0;
    const montoParaSaldar = {};
    // La parte PLANA (ajustes + propina) del remanente NUNCA debe pasar por el ratio de conversión entre
    // métodos (council L0F0/L5F0): multiplicar remainingBase completo por totalForMethod(m)/baseTotal
    // re-escalaba tambien esa parte plana con el recargo de tarjeta/transferencia (ej. propina de $300
    // se cobraba como $363 en tarjeta). Se separa el remanente en dos componentes con un criterio simple
    // y determinista (cobertura aplicada primero a servicios, el excedente a lo plano): solo el componente
    // de SERVICIOS escala por método; lo plano se suma igual, sin importar el método.
    const flatDue = round2((Number(adjustmentsNet) || 0) + tipDue);
    if (remainingBase <= 0) {
      validMethods.forEach((m) => { montoParaSaldar[m] = 0; });
    } else {
      const coverageTowardServices = Math.min(coverageAmount, baseTotal);
      const remainingServices = Math.max(0, round2(baseTotal - coverageTowardServices));
      const coverageTowardFlat = Math.max(0, round2(coverageAmount - baseTotal));
      const remainingFlat = Math.max(0, round2(flatDue - coverageTowardFlat));
      validMethods.forEach((m) => {
        if (baseTotal > 0) {
          montoParaSaldar[m] = round2(
            remainingServices * (this.totalForMethod(serviceItems, m, currency) / baseTotal) + remainingFlat
          );
        } else {
          // Sin base de servicios (baseTotal<=0) el saldo proviene solo de ajustes/cargos manuales: pesos
          // fijos sin tarifa por método, no hay "regla de tres" que aplicar — el monto a saldar en cualquier
          // método es el remanente completo. Antes quedaba en 0 aunque remainingPercent mostrara 100%,
          // contradiciendo la UI ("restante 100%: $0.00 en los 3 métodos", council L0F0 original).
          montoParaSaldar[m] = remainingBase;
        }
      });
    }
    return {
      totalDue, coverageAmount, remainingBase, remainingPercent, montoParaSaldar,
    };
  }

  /**
   * Derive payment status from amount due vs amount covered. Overpay is allowed
   * (balance may go negative -> still 'paid'). 'refunded' is set explicitly by
   * the cancellation flow, never derived here. La tolerancia (default 0.01) permite cerrar como
   * 'paid' dentro del margen de redondeo de efectivo ($5 MXN) sin exigir centavo exacto.
   * @param {number} total - Amount due (con IVA).
   * @param {number} paidAmount - Amount covered (equivalente-ancla o pagado, según el llamador).
   * @param {number} [tolerance] - Margen de cierre (0.01 preserva el comportamiento estricto previo).
   * @returns {string} Pending|partial|paid.
   * @example
   * PaymentService.deriveStatus(100, 40) // 'partial'
   */
  static deriveStatus(total, paidAmount, tolerance = 0.01) {
    const due = round2(total);
    const paid = round2(paidAmount);
    if (paid <= 0) return 'pending';
    if (due - paid > tolerance) return 'partial';
    return 'paid';
  }

  /**
   * Map reservation services to plain pricing items for computeTotals(). Expone tipAmount (la propina
   * por servicio, YA resuelta a pesos fijos por el wizard en subconcept.tipAmount) para que sumServiceTips
   * la agregue, y discountAmount (el descuento por servicio en efectivo) para que chargeAmount lo reste;
   * ambos solo se LEEN, nunca se recalculan aquí.
   * @param {Array<object>} services - ReservationService Parse objects.
   * @returns {Array<object>} Plain items { id, includeInTotal, pricesByType, total, tipAmount, discountAmount }.
   * @example
   * PaymentService.toServiceItems(services)
   */
  static toServiceItems(services) {
    return (services || []).map((svc) => {
      const sub = svc.get('subconcept') || {};
      const rawTotal = Number(sub.total);
      const rawTip = Number(sub.tipAmount);
      const rawDisc = Number(sub.discountAmount);
      return {
        id: svc.id,
        includeInTotal: sub.includeInTotal !== false,
        pricesByType: sub.pricesByType || null,
        total: Number.isFinite(rawTotal) ? rawTotal : (Number(svc.get('total')) || 0),
        tipAmount: Number.isFinite(rawTip) ? rawTip : 0,
        discountAmount: Number.isFinite(rawDisc) ? rawDisc : 0,
      };
    });
  }

  /**
   * Suma la propina por servicio (subconcept.tipAmount, ya en pesos fijos) de los servicios ACTIVOS.
   * Un servicio excluido del total (includeInTotal === false) aporta $0 igual que su precio; los
   * soft-eliminados ya los filtró queryExisting antes de llegar aquí. Solo un tipAmount finito y positivo
   * cuenta (NaN/Infinity/negativo -> 0). No recalcula porcentajes ni montos: el valor final ya está resuelto.
   * @param {Array<object>} items - Plain items { includeInTotal, tipAmount } (de toServiceItems).
   * @returns {number} Suma de propinas por servicio, a 2 decimales.
   * @example
   * PaymentService.sumServiceTips([{ tipAmount: 100 }, { tipAmount: 300 }]) // 400
   */
  static sumServiceTips(items) {
    const list = Array.isArray(items) ? items : [];
    let total = 0;
    for (const item of list) {
      if (item && item.includeInTotal !== false) {
        const tip = Number(item.tipAmount);
        if (Number.isFinite(tip) && tip > 0) total += tip;
      }
    }
    return round2(total);
  }

  /**
   * Deriva los métodos de pago realmente disponibles para una reservación a partir de los datos que
   * la cotización ya calculó: un método está disponible solo si ALGÚN servicio facturable trae un
   * precio finito para ese método en su pricesByType (unión por servicio, no intersección). El método
   * ancla (paymentType heredado de la cotización) SIEMPRE está disponible (invariante) — cubre también
   * 0 servicios y reservaciones 100% legacy sin pricesByType, que caen solo al ancla. Un ancla corrupta
   * (no válida) nunca se inyecta; si además ningún servicio respalda método alguno, se cae a los métodos
   * canónicos (fallback de seguridad) para no bloquear todo registro de pago por un dato corrupto.
   *
   * Inspecciona pricesByType[method] DIRECTAMENTE con Number.isFinite(Number(...)): a diferencia de
   * chargeAmount/serviceBase, que caen a item.total cuando falta la llave y harían que cualquier
   * reservación (incluida la legacy) "ofrezca" los 3 métodos — el hardcode disfrazado a eliminar.
   * @param {Array<object>} serviceItems - Plain items { includeInTotal, pricesByType }.
   * @param {string} anchoredMethod - Método ancla (reservation.paymentType).
   * @param {Array<string>} [validMethods] - Métodos aceptados por el sistema (orden canónico de salida).
   * @returns {Array<string>} Métodos disponibles, subconjunto de validMethods en orden canónico.
   * @example
   * PaymentService.deriveAvailableMethods([{ pricesByType: { efectivo: 100, tarjeta: 121 } }], 'efectivo')
   */
  static deriveAvailableMethods(serviceItems, anchoredMethod, validMethods = Payment.METHODS) {
    const items = Array.isArray(serviceItems) ? serviceItems : [];
    const supported = (method) => items.some((item) => item
      && item.includeInTotal !== false
      && item.pricesByType && typeof item.pricesByType === 'object'
      && Number.isFinite(Number(item.pricesByType[method])));

    const union = new Set(validMethods.filter(supported));
    // El ancla SIEMPRE disponible (invariante crítico): garantiza que el método que fijó la cotización
    // no quede fuera aunque ningún servicio traiga su llave. Un ancla no válida no se agrega (nunca se
    // inyecta un token inválido).
    if (validMethods.includes(anchoredMethod)) union.add(anchoredMethod);
    // Fallback de seguridad (council L0F1): si el ancla es un token corrupto (fuera de validMethods) Y
    // ningún servicio respalda método alguno, la unión queda vacía; el guard de escritura del controller
    // rechaza cualquier método contra una lista vacía, bloqueando TODO pago para todos los roles (incluido
    // admin) sin salida. Se exponen los métodos canónicos para no dejar la reservación sin vía de pago por
    // un dato corrupto — el token inválido nunca se inyecta.
    if (union.size === 0) validMethods.forEach((m) => union.add(m));
    return validMethods.filter((m) => union.has(m));
  }

  /**
   * Sum all payment amounts into the global paid total. Payments are plain money
   * amounts applied against the reservation grand total (no per-service split).
   * @param {Array<object>} rows - Plain rows { amount }.
   * @returns {number} Total paid (MXN), rounded to cents.
   * @example
   * PaymentService.sumPayments([{ amount: 100 }, { amount: 50 }]) // 150
   */
  static sumPayments(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let paidGlobal = 0;
    for (const row of list) paidGlobal += Number(row.amount) || 0;
    return round2(paidGlobal);
  }

  /**
   * Expresa un pago (siempre almacenado en `amount` MXN) en la MONEDA DE LA RESERVACIÓN, para que el
   * motor de cobertura (baseEquivalente/remainingBreakdown/paidAmount) compare contra pricesByType y
   * totalDue, que ya vienen en esa moneda, sin mezclar unidades. Reservación MXN: se usa `amount` tal
   * cual (misma cifra que antes; Fase B intacta). Reservación USD: un pago capturado en USD usa su
   * snapshot exacto (origAmount); un pago capturado en MXN se reconvierte con la tasa que pasa el llamador
   * (la tasa snapshot del pago es 1 para una captura en MXN, así que no sirve para MXN->USD) — introduce a
   * lo sumo un error menor de redondeo, nunca un desajuste de unidades (bug del council L5F0: $10 USD se
   * contaba como ~$185 y disparaba coverage ~183% / status 'paid' con cobertura real ~10%). La tasa la
   * resuelve loadAndCompute: prefiere el snapshot CONGELADO de la reservación (exchangeRateSnapshot) y solo
   * cae a la vigente para reservaciones legacy sin snapshot.
   * @param {object} payment - Pago plano { amount, origAmount, origCurrency }.
   * @param {string} currency - Moneda de la reservación (MXN|USD).
   * @param {number} [currentRate] - Tasa USD/MXN de la reservación (snapshot congelado, o vigente en legacy).
   * @returns {number} Monto del pago en la moneda de la reservación.
   * @example
   * PaymentService.paymentAmountInCurrency({ amount: 185, origAmount: 10, origCurrency: 'USD' }, 'USD') // 10
   */
  static paymentAmountInCurrency(payment, currency, currentRate = 0) {
    const amountMXN = Number(payment && payment.amount) || 0;
    if (String(currency).toUpperCase() !== 'USD') return amountMXN;
    const origCurrency = String((payment && payment.origCurrency) || '').toUpperCase();
    const origAmount = Number(payment && payment.origAmount);
    // Capturado en USD: el snapshot original ES el monto en la moneda de la reservación (exacto, sin tasa).
    if (origCurrency === 'USD' && Number.isFinite(origAmount)) return round2(origAmount);
    // Capturado en MXN (o sin snapshot USD): convertir MXN -> USD con la tasa vigente.
    const rate = Number(currentRate) > 0 ? Number(currentRate) : 0;
    return rate > 0 ? round2(amountMXN / rate) : amountMXN;
  }

  /**
   * Load a reservation, its existing services and payments, and compute the
   * totals + global paid amount (without persisting). Shared by summarize/recalculate.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} { reservation, services, totals, paidGlobal }.
   * @example
   * const data = await PaymentService.loadAndCompute(reservationId);
   */
  static async loadAndCompute(reservationId) {
    const Reservation = require('../../domain/models/Reservation');

    const reservation = await new Parse.Query(Reservation).get(reservationId, { useMasterKey: true });

    const reservationPtr = new Reservation();
    reservationPtr.id = reservationId;
    const servicesQuery = BaseModel.queryExisting('ReservationService');
    servicesQuery.equalTo('reservationPtr', reservationPtr);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });

    const payments = await Payment.getExistingForReservation(reservationId);

    const paymentType = reservation.get('paymentType') || 'efectivo';
    const currency = reservation.get('currency') || 'MXN';
    // Net reservation adjustments (charges add, discounts subtract) flow into the amount due.
    const adjustmentsList = reservation.get('adjustments') || [];
    const adjustmentsNet = adjustmentsList.reduce((sum, a) => {
      const amt = Number(a && a.amount) || 0;
      return a && a.type === 'discount' ? sum - amt : sum + amt;
    }, 0);
    const serviceItems = this.toServiceItems(services);

    // Reservación USD: los pagos se almacenan en MXN pero el motor de cobertura trabaja en la moneda de
    // la reservación (pricesByType/totalDue en USD). Se resuelve la tasa UNA vez y solo cuando hace falta
    // (pago MXN contra reservación USD); un pago USD usa su snapshot exacto sin tocar la tasa (council L5F0).
    // Tipo de cambio CONGELADO: se prefiere la tasa que la reservación fijó al crearse (exchangeRateSnapshot)
    // para que el saldo no "respire" cuando la tasa del sistema cambie después. Fallback a la tasa vigente
    // solo para reservaciones legacy (creadas antes de este cambio, sin snapshot) o un snapshot corrupto.
    let usdRate = 0;
    if (String(currency).toUpperCase() === 'USD') {
      const snapshot = Number(reservation.get('exchangeRateSnapshot'));
      usdRate = Number.isFinite(snapshot) && snapshot > 0 ? snapshot : await ExchangeRate.getCurrentValue();
    }

    const paymentRows = payments.map((payment) => ({
      amount: this.paymentAmountInCurrency({
        amount: payment.get('amount'),
        origAmount: payment.get('origAmount'),
        origCurrency: payment.get('origCurrency'),
      }, currency, usdRate),
      method: payment.get('method'),
    }));

    // Propina cobrada (Fase 2) = general (recalculada y persistida en reservation.tip por QuoteService) +
    // Σ propina por servicio en vivo (subconcept.tipAmount de los servicios activos). Pesos fijos que NO
    // escalan por método; se congelan sólo en el sentido de que la general vive en la reservación, no aquí.
    const generalTip = Number(reservation.get('tip')) || 0;
    const serviceTipsTotal = this.sumServiceTips(serviceItems);
    const reservationTip = round2(generalTip + serviceTipsTotal);

    const totals = this.computeTotals(serviceItems, paymentType, adjustmentsNet, currency, reservationTip);

    const paidGlobal = this.sumPayments(paymentRows);

    // serviceItems/paymentType/currency/paymentRows viajan para que buildSummary derive la cobertura
    // equivalente-ancla (paymentStatus) y el desglose de saldo restante sin recargar nada (ADR-1b).
    // generalTip/serviceTipsTotal viajan aparte para exponer la propina desglosada en el summary.
    return {
      reservation,
      services,
      totals,
      paidGlobal,
      serviceItems,
      paymentType,
      currency,
      paymentRows,
      generalTip: round2(generalTip),
      serviceTipsTotal,
    };
  }

  /**
   * Wrapper con I/O de deriveAvailableMethods: carga los ReservationService de la reservación (misma
   * query que loadAndCompute), los mapea con toServiceItems y deriva la lista de métodos disponibles
   * usando reservation.paymentType como ancla. Lo consumen el guard de escritura del controller y el
   * summary de lectura, para que ninguno hardcodee los métodos. No comparte carga con loadAndCompute
   * (el controller ya tiene la reservación scopeada), así que hace su propia query mínima de servicios.
   * @param {object} reservation - Parse Reservation object (ya cargado/scopeado por el controller).
   * @returns {Promise<Array<string>>} Métodos disponibles en orden canónico.
   * @example
   * const methods = await PaymentService.loadAvailableMethods(reservation);
   */
  static async loadAvailableMethods(reservation) {
    const servicesQuery = BaseModel.queryExisting('ReservationService');
    servicesQuery.equalTo('reservationPtr', reservation);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    const serviceItems = this.toServiceItems(services);
    const anchoredMethod = reservation.get('paymentType') || 'efectivo';
    return this.deriveAvailableMethods(serviceItems, anchoredMethod);
  }

  /**
   * Build the payment summary (grand-total rollup) from computed data.
   *
   * ADR-1b: paidAmount/balance NO cambian de fórmula — siguen siendo dinero físico real
   * (paidAmount = Σ payment.amount crudo; balance = total − paidAmount). Lo ÚNICO que cambia de base
   * es paymentStatus, que ahora deriva de la cobertura equivalente-ancla (coverageAmount) en vez de
   * comparar el pagado crudo contra el total — así un pago en un método distinto al ancla ya no
   * bloquea el badge en 'partial'. Los campos coverageAmount/coveragePercent (sin truncar a 100) y el
   * desglose de saldo restante (remainingBase/remainingPercent/montoParaSaldar) son ADITIVOS,
   * calculados en cada lectura (no persistidos), igual que subtotal/iva/total.
   * @param {string} reservationId - Reservation objectId.
   * @param {object} computed - { totals, paidGlobal, serviceItems, paymentType, currency, paymentRows }.
   * @returns {object} Summary con los campos viejos MÁS los aditivos de cobertura/saldo restante.
   * @example
   * PaymentService.buildSummary(id, await PaymentService.loadAndCompute(id))
   */
  static buildSummary(reservationId, computed) {
    const {
      totals, paidGlobal, serviceItems = [], paymentType = 'efectivo',
      currency = 'MXN', paymentRows = [], generalTip = 0, serviceTipsTotal = 0,
    } = computed;
    const paid = round2(paidGlobal);
    // Propina combinada = general + por servicio (ya calculada en totals.tip). generalTip/serviceTipsTotal
    // se exponen por separado (solo lectura, trazabilidad/auditoría); su suma es siempre `tip`.
    const tip = round2(totals.tip || 0);

    const breakdown = this.remainingBreakdown(paymentRows, {
      serviceItems,
      anchoredMethod: paymentType,
      currency,
      adjustmentsNet: totals.adjustments || 0,
      reservationTip: tip,
    });
    const tolerance = this.resolveTolerance(currency);
    // coveragePercent se expone CRUDO (puede superar 100 con sobrepago en un método más barato que el
    // ancla — hueco #1 resuelto): la capa de presentación (Fase D) decide cómo visualizarlo.
    const coveragePercent = totals.total > 0
      ? round2((breakdown.coverageAmount / totals.total) * 100)
      : 0;

    return {
      reservationId,
      paymentStatus: this.deriveStatus(totals.total, breakdown.coverageAmount, tolerance),
      paidAmount: paid,
      balance: round2(totals.total - paid),
      subtotal: totals.subtotal,
      adjustments: totals.adjustments,
      iva: totals.iva,
      // Propina cobrada (Fase 2): combinada (tip) + desglosada de solo lectura (generalTip +
      // serviceTipsTotal, que sumados dan tip). El total ya la incluye.
      tip,
      generalTip: round2(generalTip),
      serviceTipsTotal: round2(serviceTipsTotal),
      total: totals.total,
      coverageAmount: breakdown.coverageAmount,
      coveragePercent,
      remainingBase: breakdown.remainingBase,
      remainingPercent: breakdown.remainingPercent,
      montoParaSaldar: breakdown.montoParaSaldar,
      // Fase C (carrito de pagos): métodos realmente disponibles derivados de pricesByType (nunca
      // hardcodeados) + el ancla, expuestos en cada lectura sin query extra (serviceItems/paymentType
      // ya vienen en `computed`). Consumidos por la capa de presentación y validados por el controller.
      availableMethods: this.deriveAvailableMethods(serviceItems, paymentType),
      anchoredMethod: paymentType,
    };
  }

  /**
   * Compute the payment summary for a reservation WITHOUT persisting (read path).
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} Payment summary.
   * @example
   * const summary = await PaymentService.summarize(reservationId);
   */
  static async summarize(reservationId) {
    const computed = await this.loadAndCompute(reservationId);
    return this.buildSummary(reservationId, computed);
  }

  /**
   * Recalculate and persist the payment rollup for a reservation. Triggered on
   * payment create/edit/delete. Payments subtract from the grand total, so only the
   * Reservation carries the rollup (paidAmount/balance/paymentStatus); there is no
   * per-service split. Does NOT touch recalculateTotal() or the operational status.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} Payment summary.
   * @example
   * await PaymentService.recalculate(reservationId);
   */
  static async recalculate(reservationId) {
    // Serializa el read-compute-write por reservación: dos recálculos casi simultáneos para la MISMA
    // reservación corren en fila (no en paralelo), de modo que el último lee el estado ya persistido
    // por el anterior y ningún pago se pierde por un last-write-wins. Distintas reservaciones no se
    // bloquean entre sí. Lock in-process (ver reservationLock: no cubre PM2 cluster multi-worker).
    return withReservationLock(reservationId, async () => {
      try {
        const computed = await this.loadAndCompute(reservationId);
        const { reservation } = computed;
        const summary = this.buildSummary(reservationId, computed);

        reservation.set('paidAmount', summary.paidAmount);
        reservation.set('balance', summary.balance);
        reservation.set('paymentStatus', summary.paymentStatus);

        await reservation.save(null, { useMasterKey: true });

        logger.info('Reservation payment status recalculated', {
          reservationId,
          paidAmount: summary.paidAmount,
          total: summary.total,
          paymentStatus: summary.paymentStatus,
        });

        return summary;
      } catch (error) {
        logger.error('Error recalculating reservation payment status', {
          reservationId,
          error: error.message,
        });
        throw error;
      }
    });
  }
}

module.exports = PaymentService;
