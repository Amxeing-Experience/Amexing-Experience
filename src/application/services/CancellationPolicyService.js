/**
 * CancellationPolicyService - Pure business logic for cancellation refunds.
 *
 * Computes how a client's paid amount splits into credit / penalty / refund
 * when a reservation is cancelled, per the company cancellation policy.
 *
 * Definitions:
 * - credito (credit): balance kept for future use, NOT refunded to card.
 * - penalizacion (penalty): amount the company retains.
 * - reembolso (refund): money returned to the original payment method.
 *
 * This module is PURE: no Parse, no I/O, no Date, no randomness.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const result = CancellationPolicyService.calculate({
 *   montoPagado: 1000, horasAntelacion: 18, tipoCancelacion: 'cliente', esNoShow: false,
 * });
 * // Returns: { credito: 500, penalizacion: 500, reembolso: 0, policyTier: 'entre_12_24h' }
 */

/**
 * Round a value to 2 decimals, coercing non-finite input to 0.
 * @param {number} n - Value to round.
 * @returns {number} Value rounded to 2 decimals.
 * @example
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * CancellationPolicyService class implementing cancellation refund logic.
 *
 * Provides a single static pure method `calculate` that classifies a
 * cancellation into a policy tier and splits the paid amount accordingly.
 */
class CancellationPolicyService {
  /**
   * Policy tier identifiers, in evaluation order.
   * @returns {string[]} List of policy tier strings.
   */
  static get TIERS() {
    return ['empresa', 'no_show', 'mayor_igual_24h', 'entre_12_24h', 'menor_12h'];
  }

  /**
   * Classify a cancellation into a policy tier and split the paid amount.
   *
   * Rules are evaluated in this exact order, first match wins:
   * 1. TipoCancelacion === 'empresa' -> full refund, tier 'empresa'.
   * 2. EsNoShow === true -> 100% penalty, tier 'no_show'.
   * 3. HorasAntelacion >= 24 -> 100% credit, tier 'mayor_igual_24h'.
   * 4. HorasAntelacion >= 12 -> 50% credit / 50% penalty, tier 'entre_12_24h'.
   * 5. Else -> 100% penalty, tier 'menor_12h'.
   *
   * If montoPagado is not a finite number or <= 0, amounts are all zero but
   * the tier is still classified by the same rule order.
   * @param {object} params - Calculation inputs.
   * @param {number} params.montoPagado - Total paid by the client.
   * @param {number} params.horasAntelacion - Hours between confirmed cancellation and service start.
   * @param {string} params.tipoCancelacion - Who cancelled: 'cliente' | 'empresa'.
   * @param {boolean} params.esNoShow - True if the client no-showed.
   * @returns {object} Result { credito, penalizacion, reembolso, policyTier }.
   * @example
   */
  static calculate({
    montoPagado, horasAntelacion, tipoCancelacion, esNoShow,
  }) {
    const total = Number.isFinite(montoPagado) && montoPagado > 0 ? montoPagado : 0;

    let policyTier;
    let credito = 0;
    let reembolso = 0;

    if (tipoCancelacion === 'empresa') {
      policyTier = 'empresa';
      reembolso = total;
    } else if (esNoShow === true) {
      policyTier = 'no_show';
    } else if (horasAntelacion >= 24) {
      policyTier = 'mayor_igual_24h';
      credito = total;
    } else if (horasAntelacion >= 12) {
      policyTier = 'entre_12_24h';
      credito = total * 0.50;
    } else {
      policyTier = 'menor_12h';
    }

    credito = round2(credito);
    reembolso = round2(reembolso);
    const penalizacion = round2(total - credito - reembolso);

    return {
      credito, penalizacion, reembolso, policyTier,
    };
  }
}

module.exports = CancellationPolicyService;
