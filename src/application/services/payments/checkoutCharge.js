/**
 * checkoutCharge - PURE decision of how much a card checkout may collect for a reservation,
 * and whether it is even allowed (plan seccion 5.2/5.2bis). No Parse, no DB, no SDK — so the
 * money math and the tier-rejection rules are unit-testable in isolation.
 *
 * The amount is NOT reimplemented: it is exactly
 * PaymentService.remainingBreakdown(countingPayments, opts).montoParaSaldar.tarjeta, which
 * reproduces the plan's mixed-payment example (base 10000, prior transferencia 2320 -> 9680) and
 * is invariant to the reservation's anchor method. The caller passes the outputs of
 * PaymentService.loadAndCompute (already service-mapped and rollup-filtered), so there is a single
 * source of truth for the numbers.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentService = require('../PaymentService');

// The online checkout always collects on the card tier.
const CARD_METHOD = 'tarjeta';
// Tiers whose full total must NEVER be liquidated by card with no prior counting payment
// (plan seccion 5.2bis: that would let a card charge settle the cheap tier's amount).
const DISCOUNT_TIERS = ['efectivo', 'transferencia'];

/**
 * Resolve whether a card checkout is allowed and, if so, the amount to charge in the
 * reservation's original currency.
 * @param {object} input - Plain, DB-free inputs (from PaymentService.loadAndCompute).
 * @param {string} [input.status] - Reservation status ('cancelled' is rejected).
 * @param {string} input.paymentType - Anchor method (reservation.paymentType).
 * @param {string} [input.currency] - Reservation currency ('MXN'|'USD').
 * @param {Array<object>} [input.serviceItems] - Plain service items (pricesByType/total).
 * @param {Array<object>} [input.paymentRows] - COUNTING payments only ({ amount, method }).
 * @param {number} [input.adjustmentsNet] - Net adjustments (charges − discounts), plain pesos.
 * @param {number} [input.reservationTip] - Tip collected (general + per-service), plain pesos.
 * @returns {object} { ok:true, origAmount, remainingBase, currency } or
 * { ok:false, httpStatus, error }.
 * @example
 * resolveCheckoutCharge({ paymentType: 'transferencia', serviceItems, paymentRows: [{amount:2320, method:'transferencia'}] });
 */
function resolveCheckoutCharge({
  status,
  paymentType,
  currency = 'MXN',
  serviceItems = [],
  paymentRows = [],
  adjustmentsNet = 0,
  reservationTip = 0,
}) {
  if (String(status) === 'cancelled') {
    return { ok: false, httpStatus: 422, error: 'La reservación está cancelada; no se puede cobrar en línea.' };
  }

  const breakdown = PaymentService.remainingBreakdown(paymentRows, {
    serviceItems,
    anchoredMethod: paymentType,
    currency,
    adjustmentsNet,
    reservationTip,
  });

  // Already settled (or within the cash-rounding tolerance): never create a $0 session.
  if (!(Number(breakdown.remainingBase) > 0)) {
    return { ok: false, httpStatus: 422, error: 'La reservación ya está saldada; no hay saldo por cobrar.' };
  }

  const hasCountingPayments = Array.isArray(paymentRows) && paymentRows.length > 0;
  // Tier guard (plan seccion 5.2bis): only the mixed-payment case (a prior counting payment in
  // another tier) may collect the remainder by card on an efectivo/transferencia reservation.
  if (DISCOUNT_TIERS.includes(paymentType) && !hasCountingPayments) {
    return {
      ok: false,
      httpStatus: 422,
      error: 'No se puede liquidar el total con tarjeta en una reservación de efectivo/transferencia sin pagos previos.',
    };
  }

  const origAmount = breakdown.montoParaSaldar ? Number(breakdown.montoParaSaldar[CARD_METHOD]) : NaN;
  if (!Number.isFinite(origAmount) || origAmount <= 0) {
    return { ok: false, httpStatus: 422, error: 'No hay un monto válido por cobrar con tarjeta.' };
  }

  return {
    ok: true,
    origAmount,
    remainingBase: Number(breakdown.remainingBase),
    currency: String(currency).toUpperCase(),
  };
}

module.exports = { resolveCheckoutCharge };
