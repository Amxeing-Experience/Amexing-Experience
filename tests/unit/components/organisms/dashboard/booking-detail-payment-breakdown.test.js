/**
 * Booking Detail — desglose interno + vistas de agencia/agente (Fase 3).
 *
 * Tests de CASCARÓN sobre el HTML renderizado de las 3 plantillas booking-detail.ejs (el <script>
 * embebido no se ejecuta, así que se verifica la presencia/ausencia de contenedores y marcadores
 * literales). Cubre: los 3 cargan el módulo compartido; el comparativo por método + botón de ajuste
 * viven solo en admin; la fila de propina y el desglose por servicio salieron de scope y están
 * AUSENTES del DOM en las 3 (junto con el selector de pago); y — crítico para RBAC — el control de
 * AJUSTE sigue AUSENTE del DOM en department_manager/client (adjustments = admin-only), mientras que el
 * formulario de registro de PAGO ahora SÍ vive en ellos (agencia/agente cobran sus reservaciones, nivel 4+).
 */

const { renderComponent } = require('../../../../helpers/ejsTestUtils');

const params = { reservationId: 'test-reservation-id' };
const AGENCY_ROLES = ['department_manager', 'client'];

const render = (role) => renderComponent(`dashboards/${role}/booking-detail`, params);

describe('Booking Detail Fase 3 — módulo compartido', () => {
  it.each(['admin', 'department_manager', 'client'])('%s carga /shared/payments/paymentBreakdownHelpers.js', async (role) => {
    const html = await render(role);
    expect(html).toContain('/shared/payments/paymentBreakdownHelpers.js');
  });
});

// council L0F0: el encabezado #infoTotal debe salir de la MISMA fuente en los 3 roles (d.totalAmount,
// el valor persistido que ya incluye ajustes) para que una reservación con un ajuste muestre el mismo
// número a admin, agencia y agente. El script embebido no se ejecuta en el cascarón, así que se
// verifica el literal de la asignación en el HTML renderizado.
describe('Booking Detail — #infoTotal consistente entre roles (council L0F0)', () => {
  it.each(['admin', 'department_manager', 'client'])('%s: #infoTotal se llena desde d.totalAmount', async (role) => {
    const html = await render(role);
    expect(html).toContain("getElementById('infoTotal').textContent = formatCurrency(d.totalAmount, d.currency)");
  });

  it('admin: el encabezado ya NO recomputa el total sin ajustes (headerTotal eliminado)', async () => {
    const html = await render('admin');
    expect(html).not.toContain('const headerTotal =');
    expect(html).not.toContain("getElementById('infoTotal').textContent = formatCurrency(headerTotal");
  });
});

describe('Booking Detail Fase 3 — admin (nivel 6+)', () => {
  let html;

  beforeAll(async () => { html = await render('admin'); });

  it('tiene el bloque colapsable "Ver comparativo por método de pago"', () => {
    expect(html).toContain('id="paymentMethodComparison"');
    expect(html).toContain('id="paymentMethodComparisonToggle"');
    expect(html).toContain('Ver comparativo por método de pago');
  });

  it('marca el método actual con ti-point-filled + "Método actual:"', () => {
    expect(html).toContain('ti-point-filled');
    expect(html).toContain('Método actual:');
  });

  it('N2: la propina salió de scope — ni la fila resumen ni el toggle "Ver propina por servicio" están en el DOM', () => {
    expect(html).not.toContain('>Propina<');
    expect(html).not.toContain('id="tipByServiceToggle"');
    expect(html).not.toContain('id="tipByServiceBreakdown"');
    expect(html).not.toContain('Ver propina por servicio');
    expect(html).not.toContain('Sin responsable asignado');
  });

  it('conserva el botón de agregar ajuste (regresión: sigue siendo admin-only)', () => {
    expect(html).toContain('id="addAdjustmentBtn"');
  });
});

describe('Booking Detail Fase 3 — agencia/agente (nivel 4+, patrón idéntico)', () => {
  it.each(AGENCY_ROLES)('%s: bloque de pago nuevo (Estado/Total/Pagado/Saldo)', async (role) => {
    const html = await render(role);
    expect(html).toContain('Estado de pago');
    expect(html).toContain('Total a pagar');
    expect(html).toContain('Pagado');
    expect(html).toContain('Saldo');
  });

  it.each(AGENCY_ROLES)('%s N3: propina AUSENTE del DOM (fila resumen y desglose por servicio fuera de scope)', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="tipByServiceToggle"');
    expect(html).not.toContain('id="tipByServiceBreakdown"');
    expect(html).not.toContain('Ver propina por servicio');
    expect(html).not.toContain('>Propina<');
  });

  it.each(AGENCY_ROLES)('%s: los AJUSTES se enmarcan neutrales (ti-plus/ti-minus), no como descuento', async (role) => {
    // El ícono de descuento (ti-discount-2) ya NO está prohibido en toda la plantilla: la línea de
    // AHORRO (Fase D+E, aprobada) sí lo usa. Lo que se conserva es el framing NEUTRAL de los ajustes.
    const html = await render(role);
    expect(html).toContain('ti-plus text-danger');
    expect(html).toContain('ti-minus text-success');
  });

  it.each(AGENCY_ROLES)('%s: SIN comparativo de 3 métodos (fuera de alcance)', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="paymentMethodComparison"');
    expect(html).not.toContain('Ver comparativo por método de pago');
  });

  // RBAC — /adjustments es requireRole(['admin','superadmin']); la agencia NO debe ni ver el control.
  it.each(AGENCY_ROLES)('%s: botón + Ajuste AUSENTE del DOM (no solo oculto)', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="addAdjustmentBtn"');
  });

  it.each(AGENCY_ROLES)('%s: botón de eliminar ajuste AUSENTE del DOM', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('remove-adj-btn');
  });

  // INVERSIÓN (política confirmada): agencia (department_manager) y agente (client) AHORA registran /
  // editan / eliminan pagos de SUS reservaciones (backend nivel 4+). Portan el mismo formulario que admin.
  it.each(AGENCY_ROLES)('%s: AHORA porta el formulario de registro de pago (agencia/agente cobran, nivel 4+)', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="paymentFormWrap"');
    expect(html).toContain('id="addPaymentBtn"');
    expect(html).toContain('id="showPaymentFormBtn"');
    // savePaymentBtn se emite dentro de renderPaymentForm (marcador literal en el <script>).
    expect(html).toContain('id="savePaymentBtn"');
    expect(html).toContain('function renderPaymentForm');
  });

  // INVERSIÓN Fase D: antes agencia/agente NO tenían historial de pagos; ahora SÍ (offcanvas de lectura).
  it.each(AGENCY_ROLES)('%s: AHORA existe el historial de pagos (#paymentsBody); la tarjeta vieja nunca existió', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="paymentsBody"');
    expect(html).not.toContain('id="paymentsCard"');
  });

  it.each(AGENCY_ROLES)('%s: Offcanvas con chips/cobertura/saldo restante/descuento + botón "Agregar pago" (ya no "Ver pagos")', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="paymentsOffcanvas"');
    expect(html).toContain('offcanvas offcanvas-end');
    expect(html).toContain('id="paymentChips"');
    expect(html).toContain('id="paymentCoverageCard"');
    expect(html).toContain('id="paymentRemainingByMethod"');
    expect(html).toContain('id="paymentDiscountEmphasis"');
    expect(html).toContain('id="addPaymentBtn"');
    expect(html).not.toContain('id="viewPaymentsBtn"');
    // Consume el endpoint AMPLIO (GET .../payments), no el objeto angosto de getReservationById.
    expect(html).toContain('/payments');
  });
});
