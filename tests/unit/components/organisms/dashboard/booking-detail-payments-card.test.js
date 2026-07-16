/**
 * Booking Detail — Pagos como Offcanvas (Fase D+E, carrito de pagos).
 *
 * La antigua #paymentsCard (tarjeta colapsable) se reemplazó por #paymentsOffcanvas (Bootstrap 5
 * nativo). Tests de CASCARÓN: renderComponent NO ejecuta el <script>, así que se verifica la presencia
 * de los contenedores estáticos (chips / cobertura / saldo restante / descuento / historial / formulario)
 * y la desaparición del andamiaje colapsable viejo. El contenido dinámico de esos contenedores lo
 * pinta el JS en runtime desde el summary — fuera del alcance de este test.
 */

const { renderComponent } = require('../../../../helpers/ejsTestUtils');

describe('Booking Detail - Pagos Offcanvas (admin)', () => {
  const componentPath = 'dashboards/admin/booking-detail';
  const params = { reservationId: 'test-reservation-id', userRole: 'admin' };

  let html;
  beforeAll(async () => { html = await renderComponent(componentPath, params); });

  test('la antigua #paymentsCard colapsable ya no existe (ni su andamiaje)', () => {
    expect(html).not.toContain('id="paymentsCard"');
    expect(html).not.toContain('id="paymentsCollapse"');
    expect(html).not.toContain('id="paymentsChevron"');
    expect(html).not.toContain('id="paymentsCountBadge"');
  });

  test('existe el Offcanvas nativo de Bootstrap con ancho 680px y breakpoint sm (576px)', () => {
    expect(html).toContain('id="paymentsOffcanvas"');
    expect(html).toContain('offcanvas offcanvas-end');
    expect(html).toContain('--bs-offcanvas-width: 680px');
    expect(html).toContain('@media (max-width: 576px)');
  });

  test('el header del Resumen Financiero tiene "Agregar pago" ANTES de "+ Ajuste"', () => {
    const summaryHeader = html.split('id="financialSummaryBody"')[0];
    expect(summaryHeader).toContain('id="addPaymentBtn"');
    expect(summaryHeader).toContain('id="addAdjustmentBtn"');
    // "Agregar pago" aparece antes que el botón de "Ajuste" en el DOM del header.
    expect(summaryHeader.indexOf('id="addPaymentBtn"')).toBeLessThan(summaryHeader.indexOf('id="addAdjustmentBtn"'));
  });

  test('el offcanvas contiene los contenedores clave: chips, cobertura, saldo restante, descuento, historial', () => {
    expect(html).toContain('id="paymentChips"');
    expect(html).toContain('id="paymentCoverageCard"');
    expect(html).toContain('id="paymentRemainingByMethod"');
    expect(html).toContain('id="paymentDiscountEmphasis"');
    expect(html).toContain('id="paymentsBody"');
  });

  test('solo admin: el formulario de registro y el botón "Registrar pago" viven dentro del offcanvas', () => {
    // El offcanvas está después de todo el contenido de la reservación; su bloque contiene el formulario.
    const oc = html.split('id="paymentsOffcanvas"')[1];
    expect(oc).toContain('id="paymentFormWrap"');
    expect(oc).toContain('id="showPaymentFormBtn"');
  });

  test('el <select id="paymentMethod"> se puebla dinámicamente desde availableMethods (Fase C), no hardcodeado', () => {
    // El trío hardcodeado (opt('transferencia', ...)) desapareció; ahora se arma desde availableMethods.
    expect(html).not.toContain("opt('transferencia', 'Transferencia', method)");
    expect(html).toContain('methodSelectHtml');
    expect(html).toContain('availableMethods');
  });
});
