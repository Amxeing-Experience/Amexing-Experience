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
 * Modelo de precio por método de pago (solo reservación): se parte del precio base
 * en efectivo (pricesByType.efectivo, intacto de la cotización) y se aplica un factor
 * por método — efectivo = base, transferencia = base × (1 + IVA), tarjeta = base ×
 * (1 + IVA + tarjeta). El IVA (16%) y la comisión de tarjeta (5%) se suman ambos sobre
 * el base (no compuestos): tarjeta = base × 1.21. El efectivo en MXN se redondea a
 * múltiplo de 5 (ley de redondeo, applyCashRounding). NO se usan agencyRate/transferRate
 * ni se toca el motor de cotizaciones.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('../../domain/models/BaseModel');
const logger = require('../../infrastructure/logger');
// Solo se importa el redondeo a efectivo (múltiplo de 5). No se modifica el motor.
const { applyCashRounding } = require('../../domain/pricing/pricingEngine');

const IVA_RATE = 0.16;
const CARD_RATE = 0.05;

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
   * Resolve a single service's BASE price (efectivo, sin IVA ni comisión), reading
   * pricesByType.efectivo (fallback to total). Es el cimiento sobre el que se aplica
   * el factor por método de pago.
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @returns {number} Base (efectivo) price (0 when excluded from total).
   * @example
   * PaymentService.serviceBase({ pricesByType: { efectivo: 100 } }) // 100
   */
  static serviceBase(item) {
    if (!item || item.includeInTotal === false) return 0;
    const prices = item.pricesByType;
    if (prices && typeof prices === 'object') {
      const base = Number(prices.efectivo);
      if (Number.isFinite(base)) return base;
    }
    const total = Number(item.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Factor por método de pago sobre el precio base: efectivo = 1, transferencia = 1 + IVA
   * (1.16), tarjeta = 1 + IVA + comisión de tarjeta (1.21). IVA y comisión se suman ambos
   * sobre el base (no compuestos).
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @returns {number} Factor multiplicador (1 para métodos desconocidos).
   * @example
   * PaymentService.methodFactor('tarjeta') // 1.21
   */
  static methodFactor(paymentType) {
    if (paymentType === 'transferencia') return 1 + IVA_RATE;
    if (paymentType === 'tarjeta') return 1 + IVA_RATE + CARD_RATE;
    return 1;
  }

  /**
   * Compute reservation totals from plain service items using the payment-method model:
   * base (efectivo) × factor(paymentType), + net adjustments + tip. Efectivo en MXN se
   * redondea a múltiplo de 5.
   * @param {Array<object>} serviceItems - Plain items { id, includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @param {number} [reservationTip] - Reservation-level tip, added on top (sin factor).
   * @param {number} [adjustmentsNet] - Net reservation adjustments (charges − discounts), pesos finales.
   * @param {string} [currency] - Moneda (MXN aplica redondeo a efectivo).
   * @returns {object} { subtotal, adjustments, iva, surcharge, servicesTotal, tip, total, paymentType }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100 } }], 'tarjeta')
   */
  static computeTotals(serviceItems, paymentType, reservationTip = 0, adjustmentsNet = 0, currency = 'MXN') {
    const items = Array.isArray(serviceItems) ? serviceItems : [];
    let base = 0;
    for (const item of items) base += this.serviceBase(item);
    base = round2(base);

    const factor = this.methodFactor(paymentType);
    let servicesTotal = round2(base * factor);
    // Efectivo en MXN: redondeo a múltiplo de 5 sobre el total (ley de redondeo del proyecto).
    if (paymentType === 'efectivo' && String(currency).toUpperCase() === 'MXN') {
      servicesTotal = round2(applyCashRounding(servicesTotal));
    }

    // Ajustes (cargos/descuentos) y propina se suman como pesos finales (sin factor).
    const adjustments = round2(Number(adjustmentsNet) || 0);
    const tip = round2(reservationTip);
    const total = round2(servicesTotal + adjustments + tip);
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
    const totals = this.computeTotals(
      this.toServiceItems(services), paymentType, reservationTip, adjustmentsNet, currency,
    );

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
