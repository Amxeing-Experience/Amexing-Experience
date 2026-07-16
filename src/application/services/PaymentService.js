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
const logger = require('../../infrastructure/logger');
// Solo se importa el redondeo a efectivo (múltiplo de 5). No se modifica el motor.
const { applyCashRounding } = require('../../domain/pricing/pricingEngine');

/**
 * Round to 2 decimals (currency precision).
 * @param {number} n - Value to round.
 * @returns {number} Rounded value (0 for non-numeric input).
 * @example
 * round2(12.345) // 12.35
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * PaymentService class with pure pricing helpers and the payment recalculation.
 */
class PaymentService {
  /**
   * Lee el precio YA calculado y aprobado por la cotización para un método de pago
   * (pricesByType[paymentType]), sin recalcular con ninguna tasa. Fallback a item.total
   * cuando ese método no está presente (dato viejo o incompleto), igual que antes.
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @returns {number} Monto a cobrar por ese método (0 si está excluido del total).
   * @example
   * PaymentService.chargeAmount({ pricesByType: { tarjeta: 121 } }, 'tarjeta') // 121
   */
  static chargeAmount(item, paymentType) {
    if (!item || item.includeInTotal === false) return 0;
    const prices = item.pricesByType;
    if (prices && typeof prices === 'object') {
      const amount = Number(prices[paymentType]);
      if (Number.isFinite(amount)) return amount;
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
   * @returns {object} { subtotal, adjustments, iva, surcharge, servicesTotal, total, paymentType }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100, tarjeta: 121 } }], 'tarjeta') // total 121
   */
  static computeTotals(serviceItems, paymentType, adjustmentsNet = 0, currency = 'MXN') {
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
    // El total nunca es negativo: un descuento mayor al monto lo deja en 0 (no se debe "menos que nada").
    const total = Math.max(0, round2(servicesTotal + adjustments));
    // Recargo agregado por el método (IVA, o IVA + tarjeta). Se expone también como `iva`
    // por compatibilidad con los consumidores existentes del summary.
    const surcharge = round2(servicesTotal - base);

    return {
      subtotal: base,
      adjustments,
      iva: surcharge,
      surcharge,
      servicesTotal,
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
   * @param {Array<string>} [opts.validMethods] - Métodos aceptados.
   * @returns {object} { totalDue, coverageAmount, remainingBase, remainingPercent, montoParaSaldar }.
   * @example
   * PaymentService.remainingBreakdown(payments, { serviceItems, anchoredMethod: 'efectivo' })
   */
  static remainingBreakdown(payments, {
    serviceItems, anchoredMethod, currency = 'MXN', adjustmentsNet = 0, validMethods = ['efectivo', 'transferencia', 'tarjeta'],
  }) {
    const baseTotal = this.totalForMethod(serviceItems, anchoredMethod, currency);
    const totalDue = Math.max(0, round2(baseTotal + (Number(adjustmentsNet) || 0)));
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
    validMethods.forEach((m) => {
      montoParaSaldar[m] = baseTotal > 0
        ? round2(remainingBase * (this.totalForMethod(serviceItems, m, currency) / baseTotal))
        : 0;
    });
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
   * Map reservation services to plain pricing items for computeTotals().
   * @param {Array<object>} services - ReservationService Parse objects.
   * @returns {Array<object>} Plain items { id, includeInTotal, pricesByType, total }.
   * @example
   * PaymentService.toServiceItems(services)
   */
  static toServiceItems(services) {
    return (services || []).map((svc) => {
      const sub = svc.get('subconcept') || {};
      const rawTotal = Number(sub.total);
      return {
        id: svc.id,
        includeInTotal: sub.includeInTotal !== false,
        pricesByType: sub.pricesByType || null,
        total: Number.isFinite(rawTotal) ? rawTotal : (Number(svc.get('total')) || 0),
      };
    });
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
   * Load a reservation, its existing services and payments, and compute the
   * totals + global paid amount (without persisting). Shared by summarize/recalculate.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} { reservation, services, totals, paidGlobal }.
   * @example
   * const data = await PaymentService.loadAndCompute(reservationId);
   */
  static async loadAndCompute(reservationId) {
    const Reservation = require('../../domain/models/Reservation');
    const Payment = require('../../domain/models/Payment');

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

    const paymentRows = payments.map((payment) => ({
      amount: payment.get('amount'),
      method: payment.get('method'),
    }));
    const totals = this.computeTotals(serviceItems, paymentType, adjustmentsNet, currency);

    const paidGlobal = this.sumPayments(paymentRows);

    // serviceItems/paymentType/currency/paymentRows viajan para que buildSummary derive la cobertura
    // equivalente-ancla (paymentStatus) y el desglose de saldo restante sin recargar nada (ADR-1b).
    return {
      reservation, services, totals, paidGlobal, serviceItems, paymentType, currency, paymentRows,
    };
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
      currency = 'MXN', paymentRows = [],
    } = computed;
    const paid = round2(paidGlobal);

    const breakdown = this.remainingBreakdown(paymentRows, {
      serviceItems,
      anchoredMethod: paymentType,
      currency,
      adjustmentsNet: totals.adjustments || 0,
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
      total: totals.total,
      coverageAmount: breakdown.coverageAmount,
      coveragePercent,
      remainingBase: breakdown.remainingBase,
      remainingPercent: breakdown.remainingPercent,
      montoParaSaldar: breakdown.montoParaSaldar,
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
  }
}

module.exports = PaymentService;
