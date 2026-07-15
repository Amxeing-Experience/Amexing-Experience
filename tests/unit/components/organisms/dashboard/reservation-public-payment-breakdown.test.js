/**
 * Reservation-public.ejs — payment breakdown redesign (Fase 2).
 *
 * Unit-level EJS-render matrix over the public reservation view, fed a hand-built `quote`
 * matching the shape PublicReservationController.preparePublicReservationData produces.
 * Covers the dual client-type framing (descuento vs IVA), forbidden-word guarantees, the
 * discount-amount math, the IVA-row method-gating trap (cash rounding must NOT open it),
 * adjustment itemization, the Total/Saldo reconciliation regression, the per-service
 * mini-table threshold logic, and accessibility (sign in text, native details/button).
 */

const { renderComponent } = require('../../../../helpers/ejsTestUtils');

const VIEW = 'dashboards/admin/reservation-public';

// Services total per method for the default single-service reservation (base 100, ×1.16 / ×1.21).
const TOTAL_BY_METHOD = { efectivo: 100, transferencia: 116, tarjeta: 121 };

/**
 *
 * @param overrides
 * @example
 */
function service(overrides = {}) {
  return {
    type: 'transport',
    concept: 'Traslado',
    includeInTotal: true,
    includedExperiences: [],
    pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 },
    total: 121,
    ...overrides,
  };
}

/**
 *
 * @param overrides
 * @example
 */
function quote(overrides = {}) {
  const si = {
    days: [{ date: '2026-07-20', subconcepts: [service()] }],
    subtotal: 100,
    iva: 21,
    total: 121,
    paymentType: 'tarjeta',
    currency: 'MXN',
    methodTotals: { efectivo: 100, transferencia: 116, tarjeta: 121 },
    hasPricesByType: true,
    ...(overrides.serviceItems || {}),
  };
  const base = {
    folio: 'TST-2607-001',
    isAgency: false,
    adjustments: [],
    travelSpecialist: {},
    payment: {
      paymentStatus: 'pending', paidAmount: 0, balance: si.total, tip: 0, total: si.total,
    },
    ...overrides,
  };
  base.serviceItems = si;
  return base;
}

const render = (q) => renderComponent(VIEW, { pageTitle: 'Reservación', quote: q });
const paySection = (html) => html.split('Resumen de pago')[1] || '';

describe('reservation-public payment breakdown (Fase 2)', () => {
  describe('Forbidden-word guarantees per framing/method (case-insensitive)', () => {
    const cdCases = ['efectivo', 'transferencia', 'tarjeta'];
    cdCases.forEach((method) => {
      test(`cliente directo (${method}) never renders "recargo"`, async () => {
        const total = TOTAL_BY_METHOD[method];
        const html = await render(quote({
          isAgency: false,
          serviceItems: {
            paymentType: method, subtotal: 100, iva: total - 100, total,
          },
          payment: {
            paymentStatus: 'pending', paidAmount: 0, balance: total, tip: 0, total,
          },
        }));
        expect(/recargo/i.test(html)).toBe(false);
      });
    });

    const agCases = ['efectivo', 'transferencia', 'tarjeta'];
    agCases.forEach((method) => {
      test(`agencia (${method}) never renders "descuento"`, async () => {
        const total = TOTAL_BY_METHOD[method];
        const html = await render(quote({
          isAgency: true,
          serviceItems: {
            paymentType: method, subtotal: 100, iva: total - 100, total,
          },
          payment: {
            paymentStatus: 'pending', paidAmount: 0, balance: total, tip: 0, total,
          },
        }));
        expect(/descuento/i.test(html)).toBe(false);
      });
    });
  });

  describe('Cliente directo — discount framing', () => {
    test('efectivo shows "Descuento pago efectivo" = -(tarjeta - efectivo) with explicit minus in text', async () => {
      const html = await render(quote({
        isAgency: false,
        serviceItems: {
          paymentType: 'efectivo', subtotal: 100, iva: 0, total: 100,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 100, tip: 0, total: 100,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Precio de lista');
      expect(s).toContain('Descuento pago efectivo');
      // tarjeta 121 - efectivo 100 = 21, rendered with a literal '-' in the value text (not color alone).
      expect(/rc-adj-discount">-\$21/.test(s)).toBe(true);
    });

    test('transferencia shows "Descuento pago transferencia" = -(121 - 116) = -$5', async () => {
      const html = await render(quote({
        isAgency: false,
        serviceItems: {
          paymentType: 'transferencia', subtotal: 100, iva: 16, total: 116,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 116, tip: 0, total: 116,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Descuento pago transferencia');
      expect(/rc-adj-discount">-\$5 /.test(s)).toBe(true);
    });

    test('tarjeta shows no discount row (nothing to discount vs itself)', async () => {
      const html = await render(quote({ isAgency: false })); // default tarjeta
      const s = paySection(html);
      expect(s).toContain('Precio de lista');
      expect(s).not.toContain('Descuento pago');
    });

    test('discount omitted entirely (not a $0 row) when difference is 0', async () => {
      const html = await render(quote({
        isAgency: false,
        serviceItems: {
          paymentType: 'efectivo',
          subtotal: 100,
          iva: 0,
          total: 100,
          methodTotals: { efectivo: 100, transferencia: 100, tarjeta: 100 },
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 100, transferencia: 100, tarjeta: 100 }, total: 100 })] }],
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 100, tip: 0, total: 100,
        },
      }));
      const s = paySection(html);
      expect(s).not.toContain('Descuento pago');
      expect(s).toContain('Precio de lista');
    });
  });

  describe('Agencia — IVA framing, gated strictly on method (never on computed surcharge)', () => {
    test('transferencia shows a neutral "IVA" row (never "descuento")', async () => {
      const html = await render(quote({
        isAgency: true,
        serviceItems: {
          paymentType: 'transferencia', subtotal: 100, iva: 16, total: 116,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 116, tip: 0, total: 116,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('>IVA<');
      expect(/descuento/i.test(s)).toBe(false);
    });

    test('tarjeta shows "IVA + comisión de tarjeta"', async () => {
      const html = await render(quote({ isAgency: true })); // default tarjeta
      const s = paySection(html);
      expect(s).toContain('IVA + comisión de tarjeta');
    });

    test('efectivo does NOT open the IVA row even when cash rounding leaves a nonzero surcharge (the trap)', async () => {
      // pricesByType.efectivo=102 -> cash rounding to 100 -> surcharge (iva) = -2, but efectivo must never show IVA.
      const html = await render(quote({
        isAgency: true,
        serviceItems: {
          paymentType: 'efectivo',
          subtotal: 102,
          iva: -2,
          total: 100,
          methodTotals: { efectivo: 100, transferencia: 118.32, tarjeta: 123.42 },
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 102, transferencia: 118.32, tarjeta: 123.42 }, total: 123.42 })] }],
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 100, tip: 0, total: 100,
        },
      }));
      const s = paySection(html);
      expect(/\bIVA\b/.test(s)).toBe(false);
      // The agency subtotal shown for efectivo is the (rounded) services total, not the pre-round base.
      expect(s).toContain('Subtotal');
    });
  });

  describe('Adjustment itemization (manual + reconciliation-sourced)', () => {
    test('manual charge renders with + sign and ti-plus, plus a "Subtotal servicios" intermediate row', async () => {
      const html = await render(quote({
        adjustments: [{
          id: 'a1', type: 'charge', description: 'Cargo manual extra', amount: 500, source: null,
        }],
        payment: {
          paymentStatus: 'partial', paidAmount: 0, balance: 621, tip: 0, total: 621,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Subtotal servicios');
      expect(s).toContain('Cargo manual extra');
      expect(/rc-adj-charge">\+\$500/.test(s)).toBe(true);
      expect(s).toContain('ti-plus');
    });

    test('reconciliation-sourced adjustment renders its neutral description verbatim', async () => {
      const html = await render(quote({
        isAgency: true,
        adjustments: [{
          id: 'r1', type: 'charge', description: 'Ajuste por método de pago (tarjeta)', amount: 200, source: 'payment-method-reconciliation',
        }],
        payment: {
          paymentStatus: 'partial', paidAmount: 0, balance: 321, tip: 0, total: 321,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Ajuste por método de pago (tarjeta)');
      expect(/rc-adj-charge">\+\$200/.test(s)).toBe(true);
    });

    test('discount adjustment renders with - sign and ti-discount-2', async () => {
      const html = await render(quote({
        adjustments: [{
          id: 'd1', type: 'discount', description: 'Cortesía', amount: 50, source: null,
        }],
        payment: {
          paymentStatus: 'partial', paidAmount: 0, balance: 71, tip: 0, total: 71,
        },
      }));
      const s = paySection(html);
      expect(/rc-adj-discount">-\$50/.test(s)).toBe(true);
      expect(s).toContain('ti-discount-2');
    });

    test('mixed charge + discount both itemized', async () => {
      const html = await render(quote({
        adjustments: [
          {
            id: 'a', type: 'charge', description: 'Cargo A', amount: 300, source: null,
          },
          {
            id: 'b', type: 'discount', description: 'Descuento B', amount: 100, source: null,
          },
        ],
        payment: {
          paymentStatus: 'partial', paidAmount: 0, balance: 321, tip: 0, total: 321,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Cargo A');
      expect(s).toContain('Descuento B');
      expect(/rc-adj-charge">\+\$300/.test(s)).toBe(true);
      expect(/rc-adj-discount">-\$100/.test(s)).toBe(true);
    });

    test('no adjustments => no "Subtotal servicios" duplicate row', async () => {
      const html = await render(quote({ adjustments: [] }));
      const s = paySection(html);
      expect(s).not.toContain('Subtotal servicios');
    });
  });

  describe('Total/Saldo reconciliation regression (Total a pagar must equal payment.total)', () => {
    test('tarjeta $1,210 + tip $100, paid $1,310 => Total $1,310 (not $1,210) and Saldo "Pagado en su totalidad"', async () => {
      const html = await render(quote({
        isAgency: false,
        serviceItems: {
          paymentType: 'tarjeta',
          subtotal: 1000,
          iva: 210,
          total: 1210,
          methodTotals: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 }, total: 1210 })] }],
        },
        payment: {
          paymentStatus: 'paid', paidAmount: 1310, balance: 0, tip: 100, total: 1310,
        },
      }));
      const s = paySection(html);
      expect(/Total a pagar<\/span><span class="v">\$1,310/.test(s)).toBe(true);
      expect(/Total a pagar<\/span><span class="v">\$1,210/.test(s)).toBe(false);
      expect(s).toContain('Pagado en su totalidad');
      // Propina row appears BEFORE the bold Total row.
      expect(s.indexOf('Propina')).toBeGreaterThan(-1);
      expect(s.indexOf('Propina')).toBeLessThan(s.indexOf('Total a pagar'));
      expect(/\$100/.test(s.slice(s.indexOf('Propina'), s.indexOf('Total a pagar')))).toBe(true);
    });
  });

  describe('Per-service mini-table threshold (native <details>, keyboard-operable)', () => {
    const MINI = 'Ver desglose por método de pago';
    const miniRows = (html) => {
      const m = html.match(/<details class="rc-mini">[\s\S]*?<\/details>/);
      return m ? (m[0].match(/rc-mini-row/g) || []).length : 0;
    };

    test('3 finite keys => mini-table with 3 rows', async () => {
      const html = await render(quote());
      expect(html).toContain(MINI);
      expect(miniRows(html)).toBe(3);
      expect(html).toMatch(/<details class="rc-mini">/);
      expect(html).toMatch(/<summary>Ver desglose/);
    });

    test('2 finite keys => mini-table with 2 rows', async () => {
      const html = await render(quote({
        serviceItems: {
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 100, tarjeta: 121 }, total: 121 })] }],
        },
      }));
      expect(html).toContain(MINI);
      expect(miniRows(html)).toBe(2);
    });

    test('1 finite key => NO mini-table', async () => {
      const html = await render(quote({
        serviceItems: {
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { tarjeta: 121 }, total: 121 })] }],
        },
      }));
      expect(html).not.toContain(MINI);
    });

    test('0 keys (pricesByType null) => NO mini-table', async () => {
      const html = await render(quote({
        serviceItems: {
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: null, total: 121 })] }],
        },
      }));
      expect(html).not.toContain(MINI);
    });

    test('genuinely-free service {efectivo:0,transferencia:0,tarjeta:0} shows the zero in all 3 rows, never falling back to item.total', async () => {
      const html = await render(quote({
        serviceItems: {
          paymentType: 'tarjeta',
          subtotal: 0,
          iva: 0,
          total: 0,
          methodTotals: { efectivo: 0, transferencia: 0, tarjeta: 0 },
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 0, transferencia: 0, tarjeta: 0 }, total: 500 })] }],
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 0, tip: 0, total: 0,
        },
      }));
      expect(html).toContain(MINI);
      expect(miniRows(html)).toBe(3);
      const mini = html.match(/<details class="rc-mini">[\s\S]*?<\/details>/)[0];
      // The zero is rendered (not treated as falsy) and the item.total fallback (500) never appears.
      expect(mini).toContain('$0');
      expect(mini).not.toContain('$500');
    });

    test('non-finite / Infinity corrupt values are omitted (single finite key => no mini-table)', async () => {
      const html = await render(quote({
        serviceItems: {
          paymentType: 'efectivo',
          subtotal: 100,
          iva: 0,
          total: 100,
          methodTotals: { efectivo: 100, transferencia: 100, tarjeta: 100 },
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: { efectivo: 100, transferencia: Infinity, tarjeta: 'abc' }, total: 999 })] }],
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 100, tip: 0, total: 100,
        },
      }));
      expect(html).not.toContain(MINI);
      expect(html).not.toContain('Infinity');
      expect(html).not.toContain('NaN');
    });

    test('active method is marked with text + symbol (not color alone)', async () => {
      const html = await render(quote()); // tarjeta active
      const mini = html.match(/<details class="rc-mini">[\s\S]*?<\/details>/)[0];
      expect(mini).toContain('Método actual');
      expect(mini).toContain('ti-point-filled');
    });
  });

  describe('Accessibility', () => {
    test('exposes a real <button> for PDF export and native <details>/<summary> for breakdown', async () => {
      const html = await render(quote());
      expect(html).toMatch(/<button id="exportPdfBtn"/);
      expect(html).toMatch(/<details class="rc-mini">/);
      expect(html).toMatch(/<summary>/);
    });

    test('discount sign is present in the text content, not signaled by color alone', async () => {
      const html = await render(quote({
        isAgency: false,
        serviceItems: {
          paymentType: 'efectivo', subtotal: 100, iva: 0, total: 100,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 100, tip: 0, total: 100,
        },
      }));
      // The '-' character sits inside the value span's text, adjacent to the amount.
      expect(paySection(html)).toMatch(/>-\$21/);
    });
  });

  describe('isAgency unresolved / undefined => treated as false (discount framing, never recargo)', () => {
    test('undefined isAgency renders discount framing for a non-tarjeta method', async () => {
      const q = quote({
        serviceItems: {
          paymentType: 'transferencia', subtotal: 100, iva: 16, total: 116,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 116, tip: 0, total: 116,
        },
      });
      delete q.isAgency; // genuinely absent
      const html = await render(q);
      expect(paySection(html)).toContain('Descuento pago transferencia');
      expect(/recargo/i.test(html)).toBe(false);
    });
  });

  describe('Degraded / legacy data', () => {
    test('no pricesByType on any service => legacy Subtotal/Recargo fallback (no "Precio de lista")', async () => {
      const html = await render(quote({
        serviceItems: {
          paymentType: 'transferencia',
          subtotal: 100,
          iva: 16,
          total: 116,
          hasPricesByType: false,
          days: [{ date: '2026-07-20', subconcepts: [service({ pricesByType: null, total: 116 })] }],
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 116, tip: 0, total: 116,
        },
      }));
      const s = paySection(html);
      expect(s).toContain('Recargo');
      expect(s).not.toContain('Precio de lista');
    });

    test('USD currency renders amounts with the USD suffix', async () => {
      const html = await render(quote({
        serviceItems: {
          currency: 'USD', paymentType: 'tarjeta', subtotal: 100, iva: 21, total: 121,
        },
        payment: {
          paymentStatus: 'pending', paidAmount: 0, balance: 121, tip: 0, total: 121,
        },
      }));
      expect(paySection(html)).toContain('USD');
    });
  });
});
