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

  describe('Collapsible accordion', () => {
    test('the header exposes a Bootstrap collapse toggle targeting #paymentsCollapse', async () => {
      const html = await renderComponent(componentPath, params);
      const paymentsCard = html.split('id="paymentsCard"')[1];

      expect(paymentsCard).toContain('data-bs-toggle="collapse"');
      expect(paymentsCard).toContain('data-bs-target="#paymentsCollapse"');
      expect(paymentsCard).toContain('id="paymentsChevron"');
      expect(paymentsCard).toContain('id="paymentsCountBadge"');
    });

    test('the collapse body wraps the form and the table, and starts expanded', async () => {
      const html = await renderComponent(componentPath, params);
      const collapseHtml = html.split('id="paymentsCollapse"')[1].split('</div>\n    ')[0];

      // Starts expanded (class="collapse show") so there's no flash-of-hidden-content before JS decides.
      expect(html).toContain('class="collapse show" id="paymentsCollapse"');
      expect(collapseHtml).toContain('paymentFormWrap');
    });

    test('addPaymentBtn sits outside the collapse-toggle element so clicking it does not also toggle the accordion', async () => {
      const html = await renderComponent(componentPath, params);
      const paymentsCard = html.split('id="paymentsCard"')[1];
      const toggleBlock = paymentsCard.split('data-bs-toggle="collapse"')[1].split('</div>')[0];

      expect(toggleBlock).not.toContain('id="addPaymentBtn"');
    });
  });
});
