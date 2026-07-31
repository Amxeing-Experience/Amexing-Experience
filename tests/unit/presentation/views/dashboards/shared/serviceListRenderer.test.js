/**
 * ServiceListRenderer — la lista de servicios que comparten los tres detalles de reservación.
 *
 * El foco está en lo que CAMBIA entre vistas: qué notas ve cada rol y qué puede tocar cada quien.
 * Es lo que antes decidía cada plantilla por su cuenta, y por eso client y department_manager se
 * quedaron con una lista de hace varias versiones.
 */

// El renderizador lee estos dos como globales del navegador, cargados por <script> anteriores.
global.ServiceListHelpers = require('../../../../../../src/presentation/views/dashboards/shared/serviceListHelpers');
global.PaymentBreakdownHelpers = require('../../../../../../src/presentation/views/dashboards/shared/paymentBreakdownHelpers');

const SLR = require('../../../../../../src/presentation/views/dashboards/shared/serviceListRenderer');

const servicio = (extra = {}) => ({
  id: 's1',
  type: 'transport',
  concept: 'Traslado de prueba',
  dayNumber: 1,
  serviceDate: '2026-08-01',
  status: 'pending',
  total: 1000,
  subconcept: { quantity: 1, ...extra },
});

const ctx = (over = {}) => ({
  reservationData: { status: 'pending', currency: 'MXN' },
  formatCurrency: (n) => `$${n}`,
  allowAssign: false,
  userRole: 'client',
  ...over,
});

const CON_NOTAS = {
  notes: 'NOTA-GENERAL',
  clientNotes: 'NOTA-CLIENTE',
  providerNotes: 'NOTA-PROVEEDOR',
  teamNotes: 'NOTA-EQUIPO',
  internalNotes: 'NOTA-INTERNA',
};

describe('canales de notas por rol', () => {
  // Ningún servicio de la base tiene cargados providerNotes / teamNotes / internalNotes, así que
  // este servicio se construye a propósito: es la única forma de comprobar el filtrado.
  const pintar = (userRole) => SLR.buildHtml([servicio(CON_NOTAS)], ctx({ userRole }));

  it.each(['admin', 'superadmin'])('%s ve los cinco canales', (rol) => {
    const html = pintar(rol);
    ['NOTA-GENERAL', 'NOTA-CLIENTE', 'NOTA-PROVEEDOR', 'NOTA-EQUIPO', 'NOTA-INTERNA']
      .forEach((m) => expect(html).toContain(m));
  });

  it.each(['client', 'department_manager'])('%s NO ve proveedor, equipo ni internas', (rol) => {
    const html = pintar(rol);
    expect(html).toContain('NOTA-GENERAL');
    expect(html).toContain('NOTA-CLIENTE');
    ['NOTA-PROVEEDOR', 'NOTA-EQUIPO', 'NOTA-INTERNA']
      .forEach((m) => expect(html).not.toContain(m));
  });

  it('sin rol falla CERRADO: solo la nota general, ni siquiera las del cliente', () => {
    const html = pintar('');
    expect(html).toContain('NOTA-GENERAL');
    ['NOTA-CLIENTE', 'NOTA-PROVEEDOR', 'NOTA-EQUIPO', 'NOTA-INTERNA']
      .forEach((m) => expect(html).not.toContain(m));
  });
});

describe('allowAssign — asignar es de admin', () => {
  it('sin permiso no queda NADA clicable, no solo sin botón', () => {
    const html = SLR.buildHtml([servicio()], ctx({ allowAssign: false }));
    expect(html).not.toContain('is-pick');
    expect(html).not.toContain('data-slot-kind');
    expect(html).not.toContain('role="button"');
  });

  it('sin permiso tampoco sale el punto de entrada callado de Customer Support', () => {
    const html = SLR.buildHtml([servicio()], ctx({ allowAssign: false }));
    expect(html).not.toContain('is-quiet');
  });

  it('con permiso los círculos sí son clicables', () => {
    const html = SLR.buildHtml([servicio()], ctx({ allowAssign: true, userRole: 'admin' }));
    expect(html).toContain('is-pick');
  });

  it('una reservación cancelada no deja asignar ni siendo admin', () => {
    const html = SLR.buildHtml([servicio()], ctx({
      allowAssign: true, userRole: 'admin', reservationData: { status: 'cancelled', currency: 'MXN' },
    }));
    expect(html).not.toContain('is-pick');
  });
});

describe('estructura de la lista', () => {
  it('sin servicios avisa, en vez de dejar el panel en blanco', () => {
    expect(SLR.buildHtml([], ctx())).toContain('No hay servicios');
  });

  it('agrupa por día y respeta el orden por hora dentro del día', () => {
    const html = SLR.buildHtml([
      { ...servicio(), id: 'b', concept: 'SEGUNDO', time: '14:00' },
      { ...servicio(), id: 'a', concept: 'PRIMERO', time: '09:00' },
    ], ctx());
    expect(html.indexOf('PRIMERO')).toBeLessThan(html.indexOf('SEGUNDO'));
  });

  it('escapa el nombre del servicio: lo escribe una persona', () => {
    const html = SLR.buildHtml(
      [{ ...servicio(), concept: '<img src=x onerror=alert(1)>' }],
      ctx(),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('escapado de lo que escribe una persona', () => {
  it('escapa el TÍTULO DEL DÍA, que se captura en la cotización', () => {
    const html = SLR.buildHtml(
      [{ ...servicio(), dayTitle: '<img src=x onerror=alert(1)>' }],
      ctx(),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapa el teléfono del chofer, que también se captura a mano', () => {
    const html = SLR.buildHtml([{
      ...servicio(),
      assignedDriver: { id: 'd1', fullName: 'Ana', phone: '"><script>alert(1)</script>' },
      assignedVehicle: { id: 'v1', name: 'Hiace' },
    }], ctx());
    expect(html).not.toContain('<script>');
  });
});

describe('cobertura de asignación — solo la vista de operación', () => {
  // "1 de 2 asignados" / "Asignación completa" son vocabulario interno: al cliente no le dicen nada
  // y le siembran una duda sobre un servicio que ya tiene contratado.
  const conPlazas = () => ({ ...servicio(), subconcept: { quantity: 2 } });

  it('el cliente no ve la etiqueta de cobertura', () => {
    const html = SLR.buildHtml([conPlazas()], ctx({ allowAssign: false }));
    expect(html).not.toContain('svc-cov');
    expect(html).not.toContain('asignado');
  });

  it('admin sí la ve', () => {
    const html = SLR.buildHtml([conPlazas()], ctx({ allowAssign: true, userRole: 'admin' }));
    expect(html).toContain('svc-cov');
  });

  it('admin la sigue viendo en una reservación COMPLETADA, que es donde la revisa', () => {
    const html = SLR.buildHtml([conPlazas()], ctx({
      allowAssign: true,
      userRole: 'admin',
      reservationData: { status: 'completed', currency: 'MXN' },
    }));
    expect(html).toContain('svc-cov');
  });

  it('el cliente tampoco ve "No requiere asignación" en un concepto', () => {
    const html = SLR.buildHtml([{ ...servicio(), type: 'concepto' }], ctx({ allowAssign: false }));
    expect(html).not.toContain('No requiere asignación');
  });

  it('el estado excepcional SÍ le llega al cliente: eso sí le importa', () => {
    const html = SLR.buildHtml(
      [{ ...servicio(), status: 'cancelled' }],
      ctx({ allowAssign: false }),
    );
    expect(html).toMatch(/svc-exc|Cancelad/i);
  });
});
