/**
 * Booking Detail — desglose interno + vistas de agencia/agente (Fase 3).
 *
 * Tests de CASCARÓN sobre el HTML renderizado de las 3 plantillas booking-detail.ejs (el <script>
 * embebido no se ejecuta, así que se verifica la presencia/ausencia de contenedores y marcadores
 * literales). Cubre: los 3 cargan el módulo compartido; el comparativo por método + botón de ajuste
 * viven solo en admin; el bloque de pago + toggle de propina existen en las 3; y — crítico para RBAC —
 * los controles de ajuste/pago están AUSENTES DEL DOM (no solo ocultos) en department_manager/client.
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

  it('tiene la fila de Propina y el toggle "Ver propina por servicio" en variante COMPLETA (con personal)', () => {
    expect(html).toContain('id="tipByServiceToggle"');
    expect(html).toContain('id="tipByServiceBreakdown"');
    expect(html).toContain('Ver propina por servicio');
    // Variante completa: incluye responsable + fallback "Sin responsable asignado".
    expect(html).toContain('includeStaff: true');
    expect(html).toContain('Sin responsable asignado');
  });

  it('renderiza el badge [Automático] con su tooltip para ajustes de reconciliación', () => {
    expect(html).toContain('Automático');
    expect(html).toContain('Generado automáticamente al detectar un cambio de método de pago');
  });

  it('conserva el botón de agregar ajuste (regresión: sigue siendo admin-only)', () => {
    expect(html).toContain('id="addAdjustmentBtn"');
  });
});

describe('Booking Detail Fase 3 — agencia/agente (nivel 4+, patrón idéntico)', () => {
  it.each(AGENCY_ROLES)('%s: bloque de pago nuevo (Estado/Total/Pagado/Propina/Saldo)', async (role) => {
    const html = await render(role);
    expect(html).toContain('Estado de pago');
    expect(html).toContain('Total a pagar');
    expect(html).toContain('Pagado');
    expect(html).toContain('Propina');
    expect(html).toContain('Saldo');
  });

  it.each(AGENCY_ROLES)('%s: toggle de propina en variante SIMPLIFICADA (sin ficha de personal)', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="tipByServiceToggle"');
    expect(html).toContain('includeStaff: false');
    // La variante simplificada NO muestra la ficha de personal ni su fallback.
    expect(html).not.toContain('Sin responsable asignado');
  });

  it.each(AGENCY_ROLES)('%s: badge [Automático] presente para ajustes de reconciliación', async (role) => {
    const html = await render(role);
    expect(html).toContain('Automático');
    expect(html).toContain('Generado automáticamente al detectar un cambio de método de pago');
  });

  it.each(AGENCY_ROLES)('%s: framing de ajustes sin el ícono de descuento (ti-discount-2)', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('ti-discount-2');
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

  it.each(AGENCY_ROLES)('%s: formulario de registro de pago AUSENTE del DOM', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="paymentFormWrap"');
    expect(html).not.toContain('id="addPaymentBtn"');
    expect(html).not.toContain('id="savePaymentBtn"');
  });

  it.each(AGENCY_ROLES)('%s: tabla de historial de pagos AUSENTE del DOM', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="paymentsBody"');
    expect(html).not.toContain('id="paymentsCard"');
  });
});

describe('Booking Detail Fase 4 — formulario claridad monto-servicios vs propina (admin)', () => {
  let html;

  beforeAll(async () => { html = await render('admin'); });

  it('reagrupa el monto total recibido + propina + monto aplicado a servicios', () => {
    expect(html).toContain('Monto total recibido');
    expect(html).toContain('Monto aplicado a servicios');
    expect(html).toContain('id="paymentServiceAmount"');
  });

  it('el selector de servicio incluye la opción "Propina general (se reparte entre todo el personal)"', () => {
    expect(html).toContain('Propina general (se reparte entre todo el personal)');
    expect(html).toContain('id="paymentService"');
  });

  it('el banner de advertencia es no bloqueante (role=status, aria-live=polite)', () => {
    expect(html).toContain('id="paymentTipWarning"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('ti-alert-triangle');
  });

  it('el error bloqueante de propina es un role=alert inline con el copy exacto', () => {
    expect(html).toContain('id="paymentTipError"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('La propina no puede ser mayor al monto total recibido.');
  });

  it('regresión maxlength sin cambios: Monto=17, Propina=17, Referencia=100, Notas=300', () => {
    expect(html).toContain('maxlength="17" class="form-control form-control-sm" id="paymentAmount"');
    expect(html).toContain('maxlength="17" class="form-control form-control-sm" id="paymentTip"');
    expect(html).toContain('id="paymentReference" maxlength="100"');
    expect(html).toContain('id="paymentNotes" rows="2" maxlength="300"');
  });

  it('getDisplayConcept sigue definido UNA sola vez (no duplicado en el módulo compartido)', () => {
    expect((html.match(/function getDisplayConcept/g) || []).length).toBe(1);
  });

  it('carga deriveServiceAmount/buildServiceSelectorOptions desde el módulo compartido (no reimplementa)', () => {
    expect(html).toContain('PaymentBreakdownHelpers.deriveServiceAmount');
    expect(html).toContain('PaymentBreakdownHelpers.buildServiceSelectorOptions');
  });
});

describe('Booking Detail Fase 4 — el formulario nuevo sigue AUSENTE en agencia/agente (Fase 3 intacta)', () => {
  it.each(AGENCY_ROLES)('%s: sin "Monto total recibido" ni selector de servicio de pago', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('Monto total recibido');
    expect(html).not.toContain('id="paymentService"');
    expect(html).not.toContain('Propina general (se reparte entre todo el personal)');
  });
});
