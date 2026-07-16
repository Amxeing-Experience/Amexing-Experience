/**
 * PaymentBreakdownHelpers — unit tests (Fase 3).
 *
 * Cubre TODA la matriz de "Lógica" de test-designer sobre el módulo compartido puro que consumen
 * las 3 plantillas booking-detail.ejs: comparativo por método (incluyendo $0 legítimo vs ausente vs
 * Infinity/NaN/string corrupto y el fix de paridad Number.isFinite), badge de
 * estado, escapeHtml (stored XSS), moneda MXN vs USD, 0 servicios, y
 * que el redondeo a efectivo solo aplica en MXN. TestEnvironment 'node', sin DOM.
 */

const H = require('../../../../../../src/presentation/views/dashboards/shared/paymentBreakdownHelpers');

describe('PaymentBreakdownHelpers.getServicePriceByType', () => {
  it('lee el precio del método desde pricesByType (valor ya aprobado)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 121 } } }, 'tarjeta')).toBe(121);
  });

  it('acepta un $0 legítimo del método (0 != ausente)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 0 } }, total: 99 }, 'tarjeta')).toBe(0);
  });

  it('cae al fallback total cuando el método está ausente', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 100 } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('FIX Number.isFinite: Infinity en pricesByType cae al fallback, nunca pinta $Infinity', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: Infinity } }, total: 50 }, 'tarjeta')).toBe(50);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: -Infinity } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('NaN o string corrupto en pricesByType caen al fallback', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: NaN } }, total: 50 }, 'tarjeta')).toBe(50);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 'abc' } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('un total no finito también se guarda a 0 (paridad con el servidor)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: {} }, total: Infinity }, 'tarjeta')).toBe(0);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: {} }, total: 'x' }, 'tarjeta')).toBe(0);
  });

  it('un servicio excluido del total devuelve 0', () => {
    expect(H.getServicePriceByType({ subconcept: { includeInTotal: false, pricesByType: { tarjeta: 99 } } }, 'tarjeta')).toBe(0);
  });

  it('sin subconcept usa total finito o 0', () => {
    expect(H.getServicePriceByType({ total: 42 }, 'tarjeta')).toBe(42);
    expect(H.getServicePriceByType(null, 'tarjeta')).toBe(0);
  });
});

describe('PaymentBreakdownHelpers.computeServicesSubtotalByType (comparativo 3 métodos)', () => {
  const services = [
    { subconcept: { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } } },
    { subconcept: { pricesByType: { efectivo: 50, transferencia: 58, tarjeta: 60 } } },
  ];

  it('suma el precio de cada servicio por método', () => {
    expect(H.computeServicesSubtotalByType(services, 'transferencia', 'MXN')).toBe(174);
    expect(H.computeServicesSubtotalByType(services, 'tarjeta', 'MXN')).toBe(181);
  });

  it('efectivo en MXN se redondea a múltiplo de 5', () => {
    // 100 + 50 = 150 (ya múltiplo de 5) -> 150; con centavos se redondea.
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo', 'MXN')).toBe(100);
  });

  it('efectivo en USD NUNCA se redondea a múltiplo de 5 (cashRound solo MXN)', () => {
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo', 'USD')).toBe(103);
  });

  it('moneda ausente asume MXN (redondea efectivo)', () => {
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo')).toBe(100);
  });

  it('0 servicios devuelve 0', () => {
    expect(H.computeServicesSubtotalByType([], 'tarjeta', 'MXN')).toBe(0);
    expect(H.computeServicesSubtotalByType(null, 'tarjeta', 'MXN')).toBe(0);
  });

  it('un método con Infinity corrupto en un servicio no contamina el total (cae al fallback)', () => {
    const corrupt = [
      { subconcept: { pricesByType: { tarjeta: Infinity } }, total: 60 },
      { subconcept: { pricesByType: { tarjeta: 121 } } },
    ];
    expect(H.computeServicesSubtotalByType(corrupt, 'tarjeta', 'MXN')).toBe(181);
  });
});

describe('PaymentBreakdownHelpers.getPaymentStatusBadge', () => {
  it('renderiza los 4 estados con su clase', () => {
    expect(H.getPaymentStatusBadge('pending')).toContain('Pendiente de pago');
    expect(H.getPaymentStatusBadge('pending')).toContain('bg-secondary text-white');
    expect(H.getPaymentStatusBadge('partial')).toContain('Pago parcial');
    expect(H.getPaymentStatusBadge('partial')).toContain('bg-warning text-dark');
    expect(H.getPaymentStatusBadge('paid')).toContain('Pagado');
    expect(H.getPaymentStatusBadge('paid')).toContain('bg-success text-white');
    expect(H.getPaymentStatusBadge('refunded')).toContain('Reembolsado');
    expect(H.getPaymentStatusBadge('refunded')).toContain('bg-info text-white');
  });

  it('un estado desconocido cae al fallback bg-secondary con su propio texto', () => {
    const html = H.getPaymentStatusBadge('weird');
    expect(html).toContain('bg-secondary text-white');
    expect(html).toContain('>weird<');
  });

  it('null/undefined/"" devuelven string vacío', () => {
    expect(H.getPaymentStatusBadge(null)).toBe('');
    expect(H.getPaymentStatusBadge(undefined)).toBe('');
    expect(H.getPaymentStatusBadge('')).toBe('');
  });
});

describe('PaymentBreakdownHelpers.escapeHtml (stored XSS en reference/notes/adj.description)', () => {
  // Prueba adversarial: el council verificó que reference/notes/adj.description se interpolaban en
  // innerHTML / value="" / <textarea> sin escapar, permitiendo stored XSS desde nivel 4+. Estos
  // payloads deben quedar como texto inerte; ningún '<', '>', '"', "'" o '&' crudo puede sobrevivir.
  const RAW = /[<>"']/; // '&' se prueba aparte (queda como '&amp;', que contiene '&')

  it('neutraliza <script>alert(1)</script>', () => {
    const out = H.escapeHtml('<script>alert(1)</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(RAW.test(out)).toBe(false);
  });

  it('neutraliza <img src=x onerror=alert(1)>', () => {
    const out = H.escapeHtml('<img src=x onerror=alert(1)>');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(RAW.test(out)).toBe(false);
  });

  it('neutraliza el cierre de textarea </textarea><script>alert(1)</script> (vector citado por el council)', () => {
    const out = H.escapeHtml('</textarea><script>alert(1)</script>');
    expect(out).toBe('&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    // El textarea NO se puede cerrar: no queda ningún '<' ni '>' crudo.
    expect(out).not.toContain('</textarea>');
    expect(RAW.test(out)).toBe(false);
  });

  it('escapa comillas dobles (breakout de atributo value="...")', () => {
    const out = H.escapeHtml('" onmouseover="alert(1)');
    expect(out).toBe('&quot; onmouseover=&quot;alert(1)');
    expect(out).not.toContain('"');
  });

  it('escapa comillas simples (breakout de atributo delimitado por comilla simple)', () => {
    const out = H.escapeHtml("' onmouseover='alert(1)");
    expect(out).toBe('&#39; onmouseover=&#39;alert(1)');
    expect(out).not.toContain("'");
  });

  it('escapa & una sola vez (sin doble-escape): "a & b" -> "a &amp; b"', () => {
    expect(H.escapeHtml('a & b')).toBe('a &amp; b');
    // Un valor ya-escapado no se re-escapa a &amp;lt; (single pass por regex de clase).
    expect(H.escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('deja intacto un folio/referencia legítimo (sin metacaracteres HTML)', () => {
    expect(H.escapeHtml('AUTH-2607-0012')).toBe('AUTH-2607-0012');
    expect(H.escapeHtml('SPEI 123456789')).toBe('SPEI 123456789');
  });

  it('deja intactas notas legítimas con acentos y ñ (no altera visualmente el texto)', () => {
    const nota = 'Pago recibido en efectivo del señor Muñoz — depósito parcial';
    expect(H.escapeHtml(nota)).toBe(nota);
  });

  it('null/undefined/no-string -> "" (nunca "null"/"undefined")', () => {
    expect(H.escapeHtml(null)).toBe('');
    expect(H.escapeHtml(undefined)).toBe('');
    expect(H.escapeHtml('')).toBe('');
    // Un número se coacciona a su string sin romper.
    expect(H.escapeHtml(1234)).toBe('1234');
  });

  it('payload combinado en una descripción de ajuste queda 100% inerte', () => {
    const out = H.escapeHtml('Cargo extra <b>"</b> \'x\' & <svg/onload=alert(1)>');
    expect(RAW.test(out)).toBe(false);
    expect(out).toContain('&lt;svg/onload=alert(1)&gt;');
  });
});
