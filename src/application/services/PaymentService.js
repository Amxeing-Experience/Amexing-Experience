/**
 * PaymentService - Business logic for reservation payments.
 *
 * Pure helpers (servicePrice/computeTotals/deriveStatus) compute the amount due
 * and payment status without touching Parse, so they are trivially unit-testable.
 * Recalculate() loads the reservation, its services and existing payments, then
 * writes the payment rollup (paidAmount/balance/paymentStatus) onto the
 * Reservation and each ReservationService.
 *
 * The IVA math mirrors PublicReservationController.preparePublicReservationData
 * (subtotal by paymentType -> 16% IVA -> total) so there is a single source of
 * truth for what the client owes.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('../../domain/models/BaseModel');
const logger = require('../../infrastructure/logger');

const IVA_RATE = 0.16;

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
   * Resolve a single service's price (sin IVA) for a payment tier, mirroring the
   * public reservation total logic: pricesByType[paymentType] with fallback to total.
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Pricing tier (efectivo|transferencia|tarjeta).
   * @returns {number} Service price without IVA (0 when excluded from total).
   * @example
   * PaymentService.servicePrice({ pricesByType: { efectivo: 100 } }, 'efectivo') // 100
   */
  static servicePrice(item, paymentType) {
    if (!item || item.includeInTotal === false) return 0;
    const prices = item.pricesByType;
    if (prices && typeof prices === 'object') {
      const byType = Number(prices[paymentType]);
      if (Number.isFinite(byType)) return byType;
    }
    const total = Number(item.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Compute reservation totals (con IVA) from plain service items + reservation tip.
   * @param {Array<object>} serviceItems - Plain items { id, includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Pricing tier (efectivo|transferencia|tarjeta).
   * @param {number} [reservationTip] - Reservation-level tip, added on top (no IVA).
   * @returns {object} { subtotal, iva, servicesTotal, tip, total, perService }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100 } }], 'efectivo')
   */
  static computeTotals(serviceItems, paymentType, reservationTip = 0) {
    const items = Array.isArray(serviceItems) ? serviceItems : [];
    const perService = {};
    let subtotal = 0;

    for (const item of items) {
      const price = this.servicePrice(item, paymentType);
      subtotal += price;
      if (item && item.id) {
        const serviceIva = round2(price * IVA_RATE);
        perService[item.id] = round2(price + serviceIva);
      }
    }

    subtotal = round2(subtotal);
    const iva = round2(subtotal * IVA_RATE);
    const servicesTotal = round2(subtotal + iva);
    const tip = round2(reservationTip);
    const total = round2(servicesTotal + tip);

    return {
      subtotal, iva, servicesTotal, tip, total, perService,
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
   * Sum payment rows into a global total and a per-service breakdown (MXN).
   * @param {Array<object>} rows - Plain rows { amount, reservationServiceId }.
   * @returns {object} { paidGlobal, paidByService }.
   * @example
   * PaymentService.sumPayments([{ amount: 100, reservationServiceId: 'a' }])
   */
  static sumPayments(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const paidByService = {};
    let paidGlobal = 0;
    for (const row of list) {
      const amt = Number(row.amount) || 0;
      paidGlobal += amt;
      if (row.reservationServiceId) {
        paidByService[row.reservationServiceId] = round2((paidByService[row.reservationServiceId] || 0) + amt);
      }
    }
    return { paidGlobal: round2(paidGlobal), paidByService };
  }

  /**
   * Load a reservation, its existing services and payments, and compute the
   * totals + payment rollup (without persisting). Shared by summarize/recalculate.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} { reservation, services, totals, paidGlobal, paidByService }.
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
    const totals = this.computeTotals(this.toServiceItems(services), paymentType, reservationTip);

    const paymentRows = payments.map((payment) => {
      const svcPtr = payment.get('reservationServicePtr');
      return {
        amount: payment.get('amount'),
        reservationServiceId: svcPtr && svcPtr.id ? svcPtr.id : null,
      };
    });
    const { paidGlobal, paidByService } = this.sumPayments(paymentRows);

    return {
      reservation, services, totals, paidGlobal, paidByService,
    };
  }

  /**
   * Build the payment summary (global + per-service rollups) from computed data.
   * @param {string} reservationId - Reservation objectId.
   * @param {object} computed - { totals, paidGlobal, paidByService, services }.
   * @returns {object} Summary { paymentStatus, paidAmount, balance, total, ..., services[] }.
   * @example
   * PaymentService.buildSummary(id, await PaymentService.loadAndCompute(id))
   */
  static buildSummary(reservationId, computed) {
    const {
      totals, paidGlobal, paidByService, services,
    } = computed;

    const perService = services.map((svc) => {
      const total = totals.perService[svc.id] || 0;
      const paidAmount = round2(paidByService[svc.id] || 0);
      return {
        id: svc.id,
        total,
        paidAmount,
        balance: round2(total - paidAmount),
        paymentStatus: this.deriveStatus(total, paidAmount),
      };
    });

    return {
      reservationId,
      paymentStatus: this.deriveStatus(totals.total, paidGlobal),
      paidAmount: paidGlobal,
      balance: round2(totals.total - paidGlobal),
      subtotal: totals.subtotal,
      iva: totals.iva,
      tip: totals.tip,
      total: totals.total,
      services: perService,
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
   * Recalculate and persist the payment rollup for a reservation and its services.
   * Triggered on payment create/edit/delete. Does NOT touch recalculateTotal() or
   * the operational status; paymentStatus is a separate field.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} Payment summary.
   * @example
   * await PaymentService.recalculate(reservationId);
   */
  static async recalculate(reservationId) {
    try {
      const computed = await this.loadAndCompute(reservationId);
      const { reservation, services } = computed;
      const summary = this.buildSummary(reservationId, computed);

      reservation.set('paidAmount', summary.paidAmount);
      reservation.set('balance', summary.balance);
      reservation.set('paymentStatus', summary.paymentStatus);

      const byId = {};
      for (const s of summary.services) byId[s.id] = s;
      for (const svc of services) {
        const s = byId[svc.id];
        svc.set('paidAmount', s.paidAmount);
        svc.set('balance', s.balance);
        svc.set('paymentStatus', s.paymentStatus);
      }

      await Parse.Object.saveAll([reservation, ...services], { useMasterKey: true });

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
