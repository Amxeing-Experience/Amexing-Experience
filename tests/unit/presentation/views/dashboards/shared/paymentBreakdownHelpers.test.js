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

describe('PaymentBreakdownHelpers.round2 (paridad con PaymentService.round2 del servidor)', () => {
  it('un valor X.XX5 exacto (ej. 1.005) redondea al centavo correcto, no lo pierde por punto flotante', () => {
    // 1.005 se representa en IEEE-754 double como 1.00499999999999989; sin el fix de Number.EPSILON,
    // Math.round(1.005*100)/100 da 1.00 (pierde un centavo real) en vez de 1.01.
    expect(H.round2(1.005)).toBe(1.01);
  });

  it('no rompe ningún valor ya verificado (no introduce un desvío nuevo)', () => {
    expect(H.round2(12.345)).toBe(12.35);
    expect(H.round2(483.95999999999987)).toBe(483.96);
    expect(H.round2(-1979)).toBe(-1979);
    expect(H.round2(0)).toBe(0);
  });
});

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

  // FIX 2 (council): getServicePriceByType duplicaba chargeAmount SIN restar el descuento por servicio,
  // así que el staff veía el desglose por servicio en BRUTO mientras el motor real (PaymentService) ya
  // restaba el descuento — dos fuentes de verdad divergentes en la misma pantalla. Ahora resta
  // discountAmount escalado por pricesByType[método]/pricesByType.efectivo, idéntico a chargeAmount.
  it('FIX 2: en efectivo resta discountAmount directo (factor 1)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 2000 }, discountAmount: 300 } }, 'efectivo')).toBe(1700);
  });

  it('FIX 2: en tarjeta el descuento se escala por pricesByType[tarjeta]/pricesByType.efectivo', () => {
    // discEf 100, efectivo 1000, tarjeta 1210 -> descuento en tarjeta = 100 * (1210/1000) = 121; neto 1089.
    expect(H.getServicePriceByType(
      { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } },
      'tarjeta'
    )).toBe(1089);
    // Mismo servicio en efectivo: 1000 - 100 = 900.
    expect(H.getServicePriceByType(
      { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } },
      'efectivo'
    )).toBe(900);
  });

  it('FIX 2: un descuento mayor al precio del método hace clamp a 0 (nunca negativo)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 200 }, discountAmount: 500 } }, 'efectivo')).toBe(0);
  });

  it('FIX 2: sin base efectivo utilizable, resta el discountAmount bruto (mismo fallback que chargeAmount)', () => {
    // Sin pricesByType.efectivo (>0): el factor no se puede escalar, se resta el bruto. tarjeta 500 - 100 = 400.
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 500 }, discountAmount: 100 } }, 'tarjeta')).toBe(400);
  });

  it('FIX 2: discountAmount ausente/0/negativo no altera el precio (comportamiento previo intacto)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 1000 } } }, 'efectivo')).toBe(1000);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 1000 }, discountAmount: 0 } }, 'efectivo')).toBe(1000);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 1000 }, discountAmount: -50 } }, 'efectivo')).toBe(1000);
  });
});

describe('PaymentBreakdownHelpers.getServiceDiscountByType (etiqueta "Descuento" escalada por método — M1)', () => {
  it('en efectivo el descuento es literal (factor 1)', () => {
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 2000 }, discountAmount: 300 } }, 'efectivo')).toBe(300);
  });

  it('en tarjeta el descuento se escala por pricesByType[tarjeta]/pricesByType.efectivo', () => {
    // discEf 100, efectivo 1000, tarjeta 1210 -> descuento en tarjeta = 100 * (1210/1000) = 121.
    expect(H.getServiceDiscountByType(
      { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } },
      'tarjeta'
    )).toBe(121);
    expect(H.getServiceDiscountByType(
      { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } },
      'transferencia'
    )).toBe(116);
  });

  it('PARIDAD: getServicePriceByType === precio del método − getServiceDiscountByType (misma fuente)', () => {
    // La etiqueta y el precio mostrado justo arriba deben restar EXACTAMENTE el mismo descuento.
    const svc = { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } };
    ['efectivo', 'transferencia', 'tarjeta'].forEach((m) => {
      const price = H.getServicePriceByType(svc, m);
      const disc = H.getServiceDiscountByType(svc, m);
      expect(H.round2(svc.subconcept.pricesByType[m] - disc)).toBe(price);
    });
  });

  it('descuento ausente/0/negativo devuelve 0 (sin etiqueta)', () => {
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 1000 } } }, 'efectivo')).toBe(0);
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 1000 }, discountAmount: 0 } }, 'efectivo')).toBe(0);
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 1000 }, discountAmount: -50 } }, 'efectivo')).toBe(0);
  });

  it('sin base efectivo utilizable, devuelve el descuento bruto (mismo fallback que getServicePriceByType)', () => {
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { tarjeta: 500 }, discountAmount: 100 } }, 'tarjeta')).toBe(100);
  });

  it('un método null explícito cae al bruto (no escala con un factor 0)', () => {
    // pbt.tarjeta === null -> Number(null)=0 finito, pero pbt[método] != null es false -> bruto.
    expect(H.getServiceDiscountByType({ subconcept: { pricesByType: { efectivo: 1000, tarjeta: null }, discountAmount: 100 } }, 'tarjeta')).toBe(100);
  });

  it('sin subconcept devuelve 0 (no crashea)', () => {
    expect(H.getServiceDiscountByType({ total: 500 }, 'tarjeta')).toBe(0);
    expect(H.getServiceDiscountByType(null, 'tarjeta')).toBe(0);
  });
});

describe('PaymentBreakdownHelpers.getServicePriceByTypeGross (línea del servicio — Pago externo NO se pone en $0)', () => {
  // Fix bug ALTA: un servicio "Pago externo" (includeInTotal:false) se pintaba en $0.00 en la línea
  // individual (usaba getServicePriceByType, que lo pone a 0 para el agregado). La línea debe mostrar
  // el precio REAL; el zero-out solo aplica al Total/Saldo. gross NO excluye; el resto es idéntico.
  it('DIFERENCIA CLAVE: un servicio excluido devuelve su precio REAL, no 0 (al revés que getServicePriceByType)', () => {
    const svc = { subconcept: { includeInTotal: false, pricesByType: { tarjeta: 99 } }, total: 99 };
    expect(H.getServicePriceByType(svc, 'tarjeta')).toBe(0);   // agregado: sigue excluyendo
    expect(H.getServicePriceByTypeGross(svc, 'tarjeta')).toBe(99); // línea: precio real
  });

  it('excluido con descuento: muestra el precio real NETO de descuento (no 0, no bruto)', () => {
    // efectivo 2000 - descuento 300 = 1700 aunque esté excluido del total.
    const svc = { subconcept: { includeInTotal: false, pricesByType: { efectivo: 2000 }, discountAmount: 300 } };
    expect(H.getServicePriceByType(svc, 'efectivo')).toBe(0);
    expect(H.getServicePriceByTypeGross(svc, 'efectivo')).toBe(1700);
  });

  it('PARIDAD: para un servicio NO excluido devuelve EXACTAMENTE lo mismo que getServicePriceByType', () => {
    const cases = [
      [{ subconcept: { pricesByType: { tarjeta: 121 } } }, 'tarjeta'],
      [{ subconcept: { pricesByType: { efectivo: 1000, tarjeta: 1210 }, discountAmount: 100 } }, 'tarjeta'],
      [{ subconcept: { pricesByType: { tarjeta: null } }, total: 99 }, 'tarjeta'],
      [{ subconcept: { pricesByType: { tarjeta: Infinity } }, total: 50 }, 'tarjeta'],
      [{ total: 42 }, 'tarjeta'],
      [null, 'tarjeta'],
    ];
    cases.forEach(([svc, pt]) => {
      expect(H.getServicePriceByTypeGross(svc, pt)).toBe(H.getServicePriceByType(svc, pt));
    });
  });

  it('excluido + método ausente cae al fallback total (no 0)', () => {
    const svc = { subconcept: { includeInTotal: false, pricesByType: { efectivo: 100 } }, total: 50 };
    expect(H.getServicePriceByTypeGross(svc, 'tarjeta')).toBe(50);
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

  it('FIX 2: el descuento por servicio se propaga al subtotal (getServicePriceByType lo resta por servicio)', () => {
    const withDiscount = [
      { subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, discountAmount: 100 } },
      { subconcept: { pricesByType: { efectivo: 500, transferencia: 580, tarjeta: 605 } } },
    ];
    // efectivo: (1000-100) + 500 = 1400 (múltiplo de 5, sin ruido de redondeo).
    expect(H.computeServicesSubtotalByType(withDiscount, 'efectivo', 'MXN')).toBe(1400);
    // tarjeta: (1210 - 100*1210/1000) + 605 = 1089 + 605 = 1694.
    expect(H.computeServicesSubtotalByType(withDiscount, 'tarjeta', 'MXN')).toBe(1694);
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

  it('partial + balance físico NEGATIVO (pagó en un método más caro que el ancla sin cerrar "paid"): saldo se clampa a 0, NUNCA negativo', () => {
    // Decisión explícita del dueño: nunca debe mostrarse un saldo negativo, en ningún estado.
    const r = H.resolveDisplayedBalance({ paymentStatus: 'partial', balance: -1979 });
    expect(r.displayedBalance).toBe(0);
    expect(r.savings).toBeNull();
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

describe('PaymentBreakdownHelpers.cheapestAvailableMethod (dirección del descuento)', () => {
  const services = [{ subconcept: { pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 } } }];

  it('elige el método disponible más barato', () => {
    expect(H.cheapestAvailableMethod(['efectivo', 'transferencia', 'tarjeta'], services, 'MXN')).toBe('efectivo');
    expect(H.cheapestAvailableMethod(['transferencia', 'tarjeta'], services, 'MXN')).toBe('transferencia');
    expect(H.cheapestAvailableMethod([], services, 'MXN')).toBeNull();
  });
});

describe('PaymentBreakdownHelpers.buildCoverageCard', () => {
  it('coverage card muestra la línea de ahorro cuando paid + balance > 0', () => {
    const html = H.buildCoverageCard({ paymentStatus: 'paid', balance: 500, paidAmount: 2000, coveragePercent: 100 }, 'MXN');
    expect(html).toContain('Descuento de $500.00');
    expect(html).toContain('#146c43');
  });

  it('muestra el método cotizado como chip junto al Total a pagar', () => {
    const html = H.buildCoverageCard({ anchoredMethod: 'tarjeta', total: 1210, coveragePercent: 0 }, 'MXN');
    expect(html).toContain('Total a pagar');
    expect(html).toContain('Método cotizado');
    expect(html).toContain('Tarjeta');
  });

  it('FIX council (L3F0, stored XSS): un anchoredMethod malicioso se ESCAPA en "Cotizado"', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const html = H.buildCoverageCard({ anchoredMethod: payload, total: 100, coveragePercent: 0 }, 'MXN');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"><img');
  });

  it('acepta el hint de ahorro opcional bajo "Total a pagar" y lo omite cuando no se pasa', () => {
    const summary = { total: 1210, coveragePercent: 0, anchoredMethod: 'tarjeta' };
    expect(H.buildCoverageCard(summary, 'MXN')).not.toContain('pay-savings-hint');
    expect(H.buildCoverageCard(summary, 'MXN', '<div class="pay-savings-hint">x</div>')).toContain('pay-savings-hint');
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
