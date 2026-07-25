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
   * por servicio (el valor ya aprobado en la cotización), + net adjustments + tip. Efectivo
   * en MXN se redondea a múltiplo de 5 (regla física del efectivo, no afecta tarjeta/transferencia).
   * @param {Array<object>} serviceItems - Plain items { id, includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @param {number} [reservationTip] - Reservation-level tip, added on top.
   * @param {number} [adjustmentsNet] - Net reservation adjustments (charges − discounts), pesos finales.
   * @param {string} [currency] - Moneda (MXN aplica redondeo a efectivo).
   * @returns {object} { subtotal, adjustments, iva, surcharge, servicesTotal, tip, total, paymentType }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100, tarjeta: 121 } }], 'tarjeta') // total 121
   */
  static computeTotals(serviceItems, paymentType, reservationTip = 0, adjustmentsNet = 0, currency = 'MXN') {
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

    // Ajustes (cargos/descuentos) y propina se suman como pesos finales (sin factor).
    const adjustments = round2(Number(adjustmentsNet) || 0);
    const tip = round2(reservationTip);
    // El total nunca es negativo: un descuento mayor al monto lo deja en 0 (no se debe "menos que nada").
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
   * Derive payment status from amount due vs amount paid. Overpay is allowed
   * (balance may go negative -> still 'paid'). 'refunded' is set explicitly by
   * the cancellation flow, never derived here.
   * @param {number} total - Amount due (con IVA + tip).
   * @param {number} paidAmount - Amount paid (MXN).
   * @returns {string} Pending|partial|paid.
   * @example
   * PaymentService.deriveStatus(100, 40) // 'partial'
   */
  static deriveStatus(total, paidAmount) {
    const due = round2(total);
    const paid = round2(paidAmount);
    if (paid <= 0) return 'pending';
    if (paid < due) return 'partial';
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
    const reservationTip = reservation.get('tip') || 0;
    const currency = reservation.get('currency') || 'MXN';
    // Net reservation adjustments (charges add, discounts subtract) flow into the amount due.
    const adjustmentsList = reservation.get('adjustments') || [];
    const adjustmentsNet = adjustmentsList.reduce((sum, a) => {
      const amt = Number(a && a.amount) || 0;
      return a && a.type === 'discount' ? sum - amt : sum + amt;
    }, 0);
    const serviceItems = this.toServiceItems(services);
    const totals = this.computeTotals(serviceItems, paymentType, reservationTip, adjustmentsNet, currency);

    const paidGlobal = this.sumPayments(payments.map((payment) => ({ amount: payment.get('amount') })));

    return {
      reservation, services, totals, paidGlobal,
    };
  }

  /**
   * Build the payment summary (grand-total rollup) from computed data. Payments are
   * exact money amounts subtracted from the reservation total: balance = total − paid.
   * @param {string} reservationId - Reservation objectId.
   * @param {object} computed - { totals, paidGlobal }.
   * @returns {object} Summary { paymentStatus, paidAmount, balance, subtotal, adjustments, iva, tip, total }.
   * @example
   * PaymentService.buildSummary(id, await PaymentService.loadAndCompute(id))
   */
  static buildSummary(reservationId, computed) {
    const { totals, paidGlobal } = computed;
    const paid = round2(paidGlobal);

    return {
      reservationId,
      paymentStatus: this.deriveStatus(totals.total, paid),
      paidAmount: paid,
      balance: round2(totals.total - paid),
      subtotal: totals.subtotal,
      adjustments: totals.adjustments,
      iva: totals.iva,
      tip: totals.tip,
      total: totals.total,
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
