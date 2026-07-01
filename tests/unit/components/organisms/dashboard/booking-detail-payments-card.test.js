/**
 * Booking Detail — Pagos card split.
 * Regression test for separating "Pagos" from "Resumen Financiero + Cargos Adicionales"
 * into its own card (they used to share one card, which testers found confusing).
 */

const { renderComponent } = require('../../../../helpers/ejsTestUtils');

describe('Booking Detail - Pagos card split', () => {
  const componentPath = 'dashboards/admin/booking-detail';
  const params = { reservationId: 'test-reservation-id' };

  test('renders Resumen Financiero and Pagos as two separate cards', async () => {
    const html = await renderComponent(componentPath, params);

    expect(html).toContain('id="financialSummaryCard"');
    expect(html).toContain('id="paymentsCard"');
    expect(html).not.toContain('Pagos y Resumen Financiero');
  });

  test('Resumen Financiero card keeps the adjustment button, not the payment button', async () => {
    const html = await renderComponent(componentPath, params);
    const summaryCard = html.split('id="paymentsCard"')[0];

    expect(summaryCard).toContain('Resumen Financiero');
    expect(summaryCard).toContain('id="addAdjustmentBtn"');
    expect(summaryCard).not.toContain('id="addPaymentBtn"');
  });

  test('Pagos card owns the payment form, the payment button and the payments table', async () => {
    const html = await renderComponent(componentPath, params);
    const paymentsCard = html.split('id="paymentsCard"')[1];

    expect(paymentsCard).toContain('id="addPaymentBtn"');
    expect(paymentsCard).toContain('id="paymentFormWrap"');
    expect(paymentsCard).toContain('id="paymentsBody"');
    expect(paymentsCard).not.toContain('id="addAdjustmentBtn"');
  });
});
