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

  it('FIX council (L4F0): un null explícito da 0 (paridad con chargeAmount del servidor, NO cae a item.total)', () => {
    // Antes divergía: cliente devolvía item.total (99) y servidor 0 para el mismo input. Ahora ambos = 0.
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: null } }, total: 99 }, 'tarjeta')).toBe(0);
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

describe('PaymentBreakdownHelpers.resolveDisplayedBalance (Pregunta 0 — saldo mostrado + ahorro)', () => {
  it('paid + balance físico > 0: saldo mostrado 0 y línea de AHORRO por el residuo físico', () => {
    const r = H.resolveDisplayedBalance({ paymentStatus: 'paid', balance: 21000 });
    expect(r.displayedBalance).toBe(0);
    expect(r.savings).not.toBeNull();
    expect(r.savings.amount).toBe(21000);
    expect(r.savings.label).toBe('Descuento de $21,000.00');
    expect(r.savings.sublabel).toBe('Cubierto en su totalidad pagando en un método distinto al de la cotización.');
  });

  it('paid + balance físico <= 0 (H1, overpay/método más caro): saldo 0 y SIN línea de ahorro', () => {
    expect(H.resolveDisplayedBalance({ paymentStatus: 'paid', balance: 0 })).toEqual({ displayedBalance: 0, savings: null });
    expect(H.resolveDisplayedBalance({ paymentStatus: 'paid', balance: -1500 })).toEqual({ displayedBalance: 0, savings: null });
  });

  it('partial + balance > 0 (LA TRAMPA): saldo físico tal cual y NUNCA línea de ahorro', () => {
    // Un pago parcial en un método distinto al ancla NO genera ahorro mostrado — solo lo genera 'paid'.
    const r = H.resolveDisplayedBalance({ paymentStatus: 'partial', balance: 12000 });
    expect(r.displayedBalance).toBe(12000);
    expect(r.savings).toBeNull();
  });

  it('pending: saldo físico tal cual, sin ahorro', () => {
    expect(H.resolveDisplayedBalance({ paymentStatus: 'pending', balance: 50000 })).toEqual({ displayedBalance: 50000, savings: null });
  });

  it('refunded (H2): se trata igual que "no pagado" — saldo físico tal cual, sin ahorro', () => {
    expect(H.resolveDisplayedBalance({ paymentStatus: 'refunded', balance: 3000 })).toEqual({ displayedBalance: 3000, savings: null });
  });

  it('redondea a 2 decimales y tolera summary vacío/no numérico', () => {
    expect(H.resolveDisplayedBalance({ paymentStatus: 'pending', balance: 100.005 }).displayedBalance).toBe(100.01);
    expect(H.resolveDisplayedBalance({})).toEqual({ displayedBalance: 0, savings: null });
    expect(H.resolveDisplayedBalance(null)).toEqual({ displayedBalance: 0, savings: null });
  });
});

describe('PaymentBreakdownHelpers.cheapestAvailableMethod + buildDiscountEmphasis (dirección del descuento)', () => {
  const services = [{ subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } } }];

  it('elige el método disponible más barato', () => {
    expect(H.cheapestAvailableMethod(['efectivo', 'transferencia', 'tarjeta'], services, 'MXN')).toBe('efectivo');
    expect(H.cheapestAvailableMethod(['transferencia', 'tarjeta'], services, 'MXN')).toBe('transferencia');
    expect(H.cheapestAvailableMethod([], services, 'MXN')).toBeNull();
  });

  it('ancla más cara que TODOS los demás: desglosa un descuento por cada método más barato (no solo el más barato)', () => {
    const summary = { anchoredMethod: 'tarjeta', availableMethods: ['efectivo', 'transferencia', 'tarjeta'] };
    const html = H.buildDiscountEmphasis(summary, services, 'MXN');
    expect(html).toContain('#146c43');
    expect(html).not.toContain('text-success');
    // tarjeta=1210 vs efectivo=1000 (ahorro 210) y transferencia=1160 (ahorro 50) — AMBOS deben listarse.
    expect(html).toContain('Descuento pagando en Efectivo');
    expect(html).toContain('$210.00');
    expect(html).toContain('Descuento pagando en Transferencia');
    expect(html).toContain('$50.00');
    // Orden de mayor a menor descuento: Efectivo (210) antes que Transferencia (50).
    expect(html.indexOf('Efectivo')).toBeLessThan(html.indexOf('Transferencia'));
  });

  it('ancla ya es el más barato (efectivo): NO muestra descuento (regla de dirección)', () => {
    const summary = { anchoredMethod: 'efectivo', availableMethods: ['efectivo', 'transferencia', 'tarjeta'] };
    expect(H.buildDiscountEmphasis(summary, services, 'MXN')).toBe('');
  });

  it('un solo método disponible: sin descuento', () => {
    expect(H.buildDiscountEmphasis({ anchoredMethod: 'tarjeta', availableMethods: ['tarjeta'] }, services, 'MXN')).toBe('');
  });

  it('un ancla no reconocida (ni en availableMethods) igual se excluye del desglose, sin romper el cálculo', () => {
    // anchoredMethod fuera de la lista de métodos disponibles (dato corrupto/legacy): el fallback a
    // item.total lo hace rendir como "precio de lista" y las 2 filas de descuento se calculan igual.
    const svc = [{ subconcept: { pricesByType: { efectivo: 100, tarjeta: 200 } }, total: 500 }];
    const html = H.buildDiscountEmphasis(
      { anchoredMethod: 'bitcoin', availableMethods: ['efectivo', 'tarjeta'] }, svc, 'MXN'
    );
    expect(html).toContain('Descuento pagando en Efectivo');
    expect(html).toContain('Descuento pagando en Tarjeta');
  });
});

describe('PaymentBreakdownHelpers.buildMethodChips (Requisito 3 — % del backend TAL CUAL)', () => {
  const services = [{ subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } } }];

  it('H3: availableMethods vacío NO crashea — renderiza el aviso, cero chips', () => {
    const html = H.buildMethodChips({ availableMethods: [] }, services, 'MXN');
    expect(html).toContain('No hay métodos de pago disponibles para esta reservación.');
  });

  it('usa coveragePercent del backend TAL CUAL, idéntico en los 3 chips (no re-deriva por método)', () => {
    const summary = {
      availableMethods: ['efectivo', 'transferencia', 'tarjeta'], anchoredMethod: 'efectivo',
      adjustments: 0, coveragePercent: 42.5, remainingPercent: 57.5,
    };
    const html = H.buildMethodChips(summary, services, 'MXN');
    // El mismo 42.5% aparece una vez por chip (3 métodos) — nunca un % distinto por método.
    const matches = html.match(/42\.5% cubierto/g) || [];
    expect(matches.length).toBe(3);
  });

  it('marca el método más barato con el badge "Más barato" cuando el ancla es más cara', () => {
    const summary = {
      availableMethods: ['efectivo', 'tarjeta'], anchoredMethod: 'tarjeta',
      adjustments: 0, coveragePercent: 0,
    };
    expect(H.buildMethodChips(summary, services, 'MXN')).toContain('Más barato');
  });

  it('FIX council (L4F1): un descuento/ajuste mayor al subtotal NO pinta un total negativo (clamp a $0.00)', () => {
    // Subtotal efectivo 1000 + ajuste -1400 => -400 en el servidor se clampa a 0; la UI debe mostrar $0.00.
    const summary = {
      availableMethods: ['efectivo'], anchoredMethod: 'efectivo',
      adjustments: -1400, coveragePercent: 0,
    };
    const html = H.buildMethodChips(summary, services, 'MXN');
    expect(html).not.toContain('-$');
    expect(html).toContain('$0.00');
  });
});

describe('PaymentBreakdownHelpers.buildCoverageCard + buildRemainingByMethod', () => {
  it('coverage card muestra la línea de ahorro cuando paid + balance > 0', () => {
    const html = H.buildCoverageCard({ paymentStatus: 'paid', balance: 500, paidAmount: 2000, coveragePercent: 100 }, 'MXN');
    expect(html).toContain('Descuento de $500.00');
    expect(html).toContain('#146c43');
  });

  it('muestra "Cotizado: <método>" junto al Total a pagar', () => {
    const html = H.buildCoverageCard({ anchoredMethod: 'tarjeta', total: 1210, coveragePercent: 0 }, 'MXN');
    expect(html).toContain('Total a pagar');
    expect(html).toContain('Cotizado');
    expect(html).toContain('Tarjeta');
  });

  it('FIX council (L3F0, stored XSS): un anchoredMethod malicioso se ESCAPA en "Cotizado"', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const html = H.buildCoverageCard({ anchoredMethod: payload, total: 100, coveragePercent: 0 }, 'MXN');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"><img');
  });

  it('remaining-by-method vacío cuando ya está pagado', () => {
    expect(H.buildRemainingByMethod({ paymentStatus: 'paid', availableMethods: ['efectivo'] }, 'MXN')).toBe('');
  });

  it('remaining-by-method lista montoParaSaldar por método cuando NO está pagado', () => {
    const summary = {
      paymentStatus: 'partial', availableMethods: ['efectivo', 'tarjeta'], remainingPercent: 50,
      montoParaSaldar: { efectivo: 500, tarjeta: 605 },
    };
    const html = H.buildRemainingByMethod(summary, 'MXN');
    expect(html).toContain('$500.00');
    expect(html).toContain('$605.00');
    expect(html).toContain('(50%)');
  });
});

describe('PaymentBreakdownHelpers.buildPaymentsHistoryTable (solo lectura, agencia/agente)', () => {
  it('vacío legible cuando no hay pagos', () => {
    expect(H.buildPaymentsHistoryTable([], 'MXN')).toContain('Sin pagos registrados');
  });

  it('renderiza filas SIN columna/acciones de editar/eliminar y escapa la referencia (XSS)', () => {
    const html = H.buildPaymentsHistoryTable([
      { method: 'efectivo', amount: 1000, reference: '<img src=x onerror=alert(1)>', paidAt: '2026-07-15T00:00:00Z' },
    ], 'MXN');
    expect(html).toContain('$1,000.00');
    expect(html).not.toContain('edit-payment-btn');
    expect(html).not.toContain('delete-payment-btn');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
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
