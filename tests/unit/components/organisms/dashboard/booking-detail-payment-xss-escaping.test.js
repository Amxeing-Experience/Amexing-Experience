/**
 * Booking Detail — stored XSS escaping regression (reference / notes / adj.description).
 *
 * El council verificó que las 3 plantillas booking-detail.ejs interpolaban texto controlado por el
 * usuario dentro de innerHTML / value="" / <textarea> SIN escapar (permitiendo stored XSS desde
 * cualquier agencia/agente nivel 4+ que crea pagos/ajustes, ejecutado en la sesión de un admin al
 * abrir la reservación). Estos tests atan el fix a las plantillas: cada punto de interpolación de
 * campo libre debe pasar por PaymentBreakdownHelpers.escapeHtml(...), y ninguna interpolación cruda
 * de esos campos puede sobrevivir. La neutralización real de los payloads la prueba el unit test de
 * escapeHtml (paymentBreakdownHelpers.test.js); aquí garantizamos que el dato pasa por ahí.
 */

const { renderComponent } = require('../../../../helpers/ejsTestUtils');

const params = { reservationId: 'test-reservation-id' };

describe('Booking Detail admin - escapa reference/notes/adj.description (XSS)', () => {
  let html;
  beforeAll(async () => { html = await renderComponent('dashboards/admin/booking-detail', params); });

  test('la referencia del listado de pagos pasa por escapeHtml (no se interpola cruda)', () => {
    expect(html).toContain('PaymentBreakdownHelpers.escapeHtml(p.reference)');
    expect(html).not.toContain('? p.reference :');
  });

  test('la referencia del formulario usa escapeHtml completo (no el .replace parcial de comillas)', () => {
    // El input de referencia del formulario de pago ahora escapa los 5 metacaracteres, no solo la
    // comilla doble. (El .replace(/"/g,...) parcial aún existe en buildPersonCard/data-name, fuera
    // del alcance de pagos — reportado como superficie de la misma clase pendiente de un pase amplio.)
    const refInput = html.split('id="paymentReference"')[1].split('>')[0];
    expect(refInput).toContain("PaymentBreakdownHelpers.escapeHtml(existing?.reference || '')");
    expect(refInput).not.toContain(".replace(");
  });

  test('las notas del formulario (textarea) pasan por escapeHtml (bloquea el cierre </textarea>)', () => {
    expect(html).toContain("PaymentBreakdownHelpers.escapeHtml(existing?.notes || '')");
    expect(html).not.toContain("${existing?.notes || ''}");
  });

  test('la descripción de ajuste (cargo y descuento) pasa por escapeHtml', () => {
    expect(html).toContain('PaymentBreakdownHelpers.escapeHtml(adj.description)');
    expect(html).not.toContain('${adj.description}');
  });
});

describe.each([
  ['department_manager'],
  ['client'],
])('Booking Detail %s (agencia) - escapa adj.description (XSS)', (role) => {
  let html;
  beforeAll(async () => { html = await renderComponent(`dashboards/${role}/booking-detail`, params); });

  test('la descripción de ajuste del desglose pasa por escapeHtml (no se interpola cruda)', () => {
    expect(html).toContain('PaymentBreakdownHelpers.escapeHtml(adj.description)');
    expect(html).not.toContain('${adj.description}');
  });
});
