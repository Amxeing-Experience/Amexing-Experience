/**
 * QuoteController.evaluateTotalsConsistency — unit test (función pura, sin DB).
 *
 * Documenta la asimetría de tolerancia por moneda del guard de consistencia (costura #1): la tolerancia es
 * un monto FIJO ($1.00, PRICE_MISMATCH_TOLERANCE) en unidades de la moneda de captura, sin normalizar por
 * moneda. Por eso una divergencia de $0.60 USD PASA (dentro de tolerancia) mientras que la MISMA divergencia
 * porcentual expresada en MXN ($11.10 = 0.60 × 18.5) RECHAZA. Esto es una observación conocida y aceptada
 * (no un bug a corregir): los asserts reflejan el comportamiento REAL tal cual es hoy.
 */

const quoteController = require('../../../src/application/controllers/api/QuoteController');

describe('QuoteController.evaluateTotalsConsistency (tolerancia por moneda)', () => {
  it('USD-U1: $0.60 USD de divergencia PASA (rejectMessage null); la misma en MXN ($11.10) RECHAZA', () => {
    // Caso A — USD "aceptado": subconcepto total 85, subtotal recibido 85.60 (divergencia $0.60).
    const usd = quoteController.evaluateTotalsConsistency({
      days: [{ subconcepts: [{ total: 85, includeInTotal: true }] }],
      subtotal: 85.60,
      iva: 0,
      total: 85,
      paymentType: 'efectivo',
    });
    expect(usd.subtotalDiff).toBeCloseTo(0.60, 2);
    expect(usd.rejectMessage).toBeNull(); // dentro de la tolerancia fija de $1.00

    // Caso B — MXN, mismo % real: subconcepto total 1572.50 (85 × 18.5), subtotal 1583.60
    // (divergencia $11.10 = 0.60 × 18.5).
    const mxn = quoteController.evaluateTotalsConsistency({
      days: [{ subconcepts: [{ total: 1572.50, includeInTotal: true }] }],
      subtotal: 1583.60,
      iva: 0,
      total: 1572.50,
      paymentType: 'efectivo',
    });
    expect(mxn.subtotalDiff).toBeCloseTo(11.10, 2);
    expect(mxn.rejectMessage).not.toBeNull(); // supera la tolerancia fija de $1.00 -> rechaza
  });
});
