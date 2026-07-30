/**
 * FinancialSummary y PaymentsPanel — los dos bloques de dinero del detalle de reservación.
 *
 * El foco es `allowEdit`, que es lo único que difiere entre vistas y es de PERMISOS: el servidor le
 * niega POST/PUT/DELETE de pagos a end_client con denyRoles, así que su interfaz tampoco debe
 * ofrecerlos. Leer sí: GET /payments está abierto a ese rol a propósito.
 */

global.PaymentBreakdownHelpers = require('../../../../../../src/presentation/views/dashboards/shared/paymentBreakdownHelpers');

const FinancialSummary = require('../../../../../../src/presentation/views/dashboards/shared/financialSummary');
const PaymentsPanel = require('../../../../../../src/presentation/views/dashboards/shared/paymentsPanel');

const formatCurrency = (a, c) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: c || 'MXN',
}).format(Number(a) || 0);

const reserva = (over = {}) => ({
  status: 'pending',
  currency: 'MXN',
  paymentType: 'efectivo',
  services: [],
  payment: { total: 5000, paidAmount: 1000, paymentStatus: 'partial' },
  ...over,
});

const pagos = [
  { id: 'p1', amount: 1000, method: 'efectivo', paidAt: '2026-07-01T10:00:00Z', createdAt: '2026-07-01T10:00:00Z', reference: 'REF-1' },
  { id: 'p2', amount: 2500.5, method: 'transferencia', paidAt: '2026-07-15T10:00:00Z', createdAt: '2026-07-15T10:00:00Z', receiptUrl: 'https://x/y.pdf' },
];

describe('FinancialSummary — allowEdit', () => {
  it('sin permiso no ofrece "Agregar pago"', () => {
    const html = FinancialSummary.buildHtml({ reservationData: reserva(), formatCurrency, allowEdit: false });
    expect(html).not.toContain('addPaymentBtn');
  });

  it('con permiso sí lo ofrece', () => {
    const html = FinancialSummary.buildHtml({ reservationData: reserva(), formatCurrency, allowEdit: true });
    expect(html).toContain('addPaymentBtn');
  });

  it('una reservación cancelada no lo ofrece ni con permiso', () => {
    const html = FinancialSummary.buildHtml({
      reservationData: reserva({ status: 'cancelled' }), formatCurrency, allowEdit: true,
    });
    expect(html).not.toContain('addPaymentBtn');
  });

  it('muestra el saldo y el porcentaje pagado, que es lo que el cliente viene a ver', () => {
    const html = FinancialSummary.buildHtml({ reservationData: reserva(), formatCurrency, allowEdit: false });
    expect(html).toContain('Saldo');
    expect(html).toContain('20% pagado');
  });

  it('escapa la descripción de un ajuste, que la escribe una persona', () => {
    const html = FinancialSummary.buildHtml({
      reservationData: reserva({ adjustments: [{ type: 'charge', description: '<img src=x onerror=alert(1)>', amount: 100 }] }),
      formatCurrency,
      allowEdit: false,
    });
    expect(html).not.toContain('<img src=x');
  });
});

describe('PaymentsPanel — allowEdit', () => {
  const ctx = (allowEdit) => ({
    reservationData: reserva(), formatCurrency, payments: pagos, sort: { key: 'date', dir: 'desc' }, allowEdit,
  });

  it('sin permiso no ofrece editar ni borrar', () => {
    const html = PaymentsPanel.renderPayments(ctx(false));
    expect(html).not.toContain('edit-payment-btn');
    expect(html).not.toContain('delete-payment-btn');
  });

  it('sin permiso SÍ deja ver el comprobante: es su propio pago', () => {
    const html = PaymentsPanel.renderPayments(ctx(false));
    expect(html).toContain('https://x/y.pdf');
  });

  it('con permiso ofrece editar y borrar', () => {
    const html = PaymentsPanel.renderPayments(ctx(true));
    expect(html).toContain('edit-payment-btn');
    expect(html).toContain('delete-payment-btn');
  });

  it('sin pagos avisa, en vez de dejar la tabla vacía', () => {
    const html = PaymentsPanel.renderPayments({ ...ctx(false), payments: [] });
    expect(html).toContain('Sin pagos registrados');
  });

  it('ordena por importe cuando se le pide', () => {
    const html = PaymentsPanel.renderPayments({ ...ctx(false), sort: { key: 'amount', dir: 'asc' } });
    expect(html.indexOf('REF-1')).toBeLessThan(html.indexOf('y.pdf'));
  });

  it('escapa la referencia del pago, que se captura a mano', () => {
    const html = PaymentsPanel.renderPayments({
      ...ctx(false),
      payments: [{ ...pagos[0], reference: '"><script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>alert(1)');
  });
});

describe('PaymentForm — la fábrica del formulario de pago', () => {
  // DOM mínimo: al formulario solo se le pide el HTML que deja en su contenedor.
  const nodo = () => ({
    innerHTML: '',
    style: {},
    value: '',
    dataset: {},
    textContent: '',
    checked: false,
    files: [],
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false,
    },
    addEventListener() {},
    appendChild() {},
    focus() {},
    remove() {},
    scrollIntoView() {},
    setAttribute() {},
    getAttribute: () => null,
    closest: () => null,
    querySelector: () => nodo(),
    querySelectorAll: () => [],
  });

  const pagos = [{
    id: 'p1', amount: 1500, method: 'transferencia', paidAt: '2026-07-15T10:00:00Z', reference: 'REF-9', origCurrency: 'MXN',
  }];

  const contexto = (over = {}) => ({
    reservationId: 'R1',
    token: () => 'tok',
    reservationData: () => ({ status: 'pending', currency: 'MXN', paymentType: 'efectivo', services: [] }),
    payments: () => pagos,
    summary: () => ({ total: 5000, availableMethods: ['efectivo', 'transferencia', 'tarjeta'] }),
    formatCurrency,
    formatDate: (x) => String(x || '').slice(0, 10),
    toast: () => {},
    confirm: async () => true,
    attachThousands: () => {},
    parseAmount: (x) => Number(String(x).replace(/,/g, '')) || 0,
    applySummary: () => {},
    reload: async () => {},
    repaint: () => {},
    methodLabels: { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' },
    ...over,
  });

  let PaymentForm;

  beforeAll(() => {
    global.document = {
      getElementById: () => nodo(),
      querySelector: () => nodo(),
      querySelectorAll: () => [],
      createElement: () => nodo(),
      body: nodo(),
    };
    // eslint-disable-next-line global-require
    PaymentForm = require('../../../../../../src/presentation/views/dashboards/shared/paymentForm');
  });

  it('el alta pinta un formulario sin pago asociado', () => {
    const wrap = nodo();
    PaymentForm.create(contexto()).renderPaymentForm(null, wrap);
    expect(wrap.innerHTML).toContain('id="paymentId" value=""');
  });

  it('la edición precarga el pago', () => {
    const wrap = nodo();
    PaymentForm.create(contexto()).renderPaymentForm('p1', wrap);
    expect(wrap.innerHTML).toContain('id="paymentId" value="p1"');
    expect(wrap.innerHTML).toContain('REF-9');
  });

  it('ofrece solo los métodos DISPONIBLES, no tres fijos', () => {
    const wrap = nodo();
    PaymentForm.create(contexto({
      summary: () => ({ total: 5000, availableMethods: ['efectivo'] }),
    })).renderPaymentForm(null, wrap);
    expect(wrap.innerHTML).toContain('efectivo');
    expect(wrap.innerHTML).not.toContain('value="tarjeta"');
  });

  it('cada instancia lleva SU propio pago en edición: dos no se pisan', () => {
    const a = PaymentForm.create(contexto());
    const b = PaymentForm.create(contexto());
    a.setEditingId('p1');
    expect(a.getEditingId()).toBe('p1');
    expect(b.getEditingId()).toBeNull();
  });

  it('salir de la edición lo limpia', () => {
    const f = PaymentForm.create(contexto());
    f.setEditingId('p1');
    f.setEditingId(null);
    expect(f.getEditingId()).toBeNull();
  });
});
