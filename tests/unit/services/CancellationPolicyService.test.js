/**
 * CancellationPolicyService Unit Tests
 * Tests for cancellation credit / penalty / refund business logic.
 */

const CancellationPolicyService = require('../../../src/application/services/CancellationPolicyService');

describe('CancellationPolicyService.calculate', () => {
  const montoPagado = 1000;

  it('48h antelacion -> 100% credit, tier mayor_igual_24h', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 48, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(1000);
    expect(result.penalizacion).toBe(0);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('mayor_igual_24h');
  });

  it('exactly 24h -> 100% credit, tier mayor_igual_24h', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 24, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(1000);
    expect(result.penalizacion).toBe(0);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('mayor_igual_24h');
  });

  it('18h -> 50% credit / 50% penalty, tier entre_12_24h', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 18, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(500);
    expect(result.penalizacion).toBe(500);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('entre_12_24h');
  });

  it('exactly 12h -> 50% credit / 50% penalty, tier entre_12_24h', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 12, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(500);
    expect(result.penalizacion).toBe(500);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('entre_12_24h');
  });

  it('6h -> 100% penalty, tier menor_12h', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 6, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(1000);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('menor_12h');
  });

  it('no-show -> 100% penalty, tier no_show', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 5, tipoCancelacion: 'cliente', esNoShow: true,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(1000);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('no_show');
  });

  it('no-show takes priority over 48h nominal hours', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 48, tipoCancelacion: 'cliente', esNoShow: true,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(1000);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('no_show');
  });

  it('empresa cancellation -> full refund regardless of hours', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 6, tipoCancelacion: 'empresa', esNoShow: false,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(0);
    expect(result.reembolso).toBe(1000);
    expect(result.policyTier).toBe('empresa');
  });

  it('empresa has priority over no-show', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado, horasAntelacion: 6, tipoCancelacion: 'empresa', esNoShow: true,
    });
    expect(result.reembolso).toBe(1000);
    expect(result.policyTier).toBe('empresa');
  });

  it('INVARIANT: credito + penalizacion + reembolso === montoPagado for varied inputs', () => {
    const cases = [
      {
        montoPagado: 1000, horasAntelacion: 48, tipoCancelacion: 'cliente', esNoShow: false,
      },
      {
        montoPagado: 1000, horasAntelacion: 18, tipoCancelacion: 'cliente', esNoShow: false,
      },
      {
        montoPagado: 1000, horasAntelacion: 6, tipoCancelacion: 'cliente', esNoShow: false,
      },
      {
        montoPagado: 750.5, horasAntelacion: 12, tipoCancelacion: 'cliente', esNoShow: false,
      },
      {
        montoPagado: 333.33, horasAntelacion: 5, tipoCancelacion: 'cliente', esNoShow: true,
      },
      {
        montoPagado: 1234.56, horasAntelacion: 3, tipoCancelacion: 'empresa', esNoShow: false,
      },
      {
        montoPagado: 99.99, horasAntelacion: 24, tipoCancelacion: 'cliente', esNoShow: false,
      },
    ];
    cases.forEach((input) => {
      const result = CancellationPolicyService.calculate(input);
      expect(result.credito + result.penalizacion + result.reembolso).toBe(input.montoPagado);
    });
  });

  it('rounding-edge: invariant holds and penalizacion has at most 2 decimals', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado: 1000.01, horasAntelacion: 18, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito + result.penalizacion + result.reembolso).toBe(1000.01);
    expect(typeof result.penalizacion).toBe('number');
    expect(Math.round(result.penalizacion * 100) / 100).toBe(result.penalizacion);
  });

  it('montoPagado = 0 -> all outputs are 0', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado: 0, horasAntelacion: 18, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(0);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('entre_12_24h');
  });

  it('montoPagado = NaN -> all outputs are 0', () => {
    const result = CancellationPolicyService.calculate({
      montoPagado: NaN, horasAntelacion: 48, tipoCancelacion: 'cliente', esNoShow: false,
    });
    expect(result.credito).toBe(0);
    expect(result.penalizacion).toBe(0);
    expect(result.reembolso).toBe(0);
    expect(result.policyTier).toBe('mayor_igual_24h');
  });

  it('exposes TIERS static getter with all tier strings', () => {
    expect(CancellationPolicyService.TIERS).toEqual([
      'empresa', 'no_show', 'mayor_igual_24h', 'entre_12_24h', 'menor_12h',
    ]);
  });
});
