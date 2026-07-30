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
