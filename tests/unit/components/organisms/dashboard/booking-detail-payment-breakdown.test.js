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

// council L0F0: el total que se muestra debe salir de la MISMA fuente en los 3 roles, para que una
// reservación con un ajuste muestre el mismo número a admin, agencia y agente.
//
// La fuente CAMBIÓ: antes era el tile #infoTotal de la tarjeta de info, llenado con d.totalAmount (el
// valor persistido). Ese tile ya no existe en ninguna de las 3 vistas — el total se dejó de duplicar y
// vive solo en el Resumen Financiero, que lo toma de pay.total (el summary del servidor, que ya incluye
// ajustes y propinas). El invariante se conserva y se refuerza: pay.total lo calcula el backend, así
// que ninguna vista puede derivar un número distinto.
//
// El script embebido no se ejecuta en el cascarón, así que se verifica el literal en el HTML renderizado.
describe('Booking Detail — total consistente entre roles (council L0F0)', () => {
  it.each(['admin', 'department_manager', 'client'])('%s: el total mostrado sale de pay.total (summary del servidor)', async (role) => {
    const html = await render(role);
    expect(html).toMatch(/formatCurrency\(pay\.total|Number\(pay\.total\)/);
  });

  it.each(['admin', 'department_manager', 'client'])('%s: el tile #infoTotal ya no duplica el total en la tarjeta de info', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="infoTotal"');
    expect(html).not.toContain("getElementById('infoTotal')");
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

  // El comparativo dejó de tener un enlace propio ("Ver comparativo por método de pago"): ahora lo
  // dispara el CHIP de método del hero, que queda pegado a lo que explica en vez de ser una sección
  // suelta. Sigue siendo un collapse inline con el mismo id.
  it('el chip de método del hero dispara el comparativo colapsable', () => {
    expect(html).toContain('id="paymentMethodComparison"');
    expect(html).toContain('fin-hero-method');
    expect(html).toContain('data-bs-target="#paymentMethodComparison"');
    expect(html).not.toContain('id="paymentMethodComparisonToggle"');
  });

  // El método actual se marca con un badge "Actual" en su fila del comparativo (antes: un punto
  // ti-point-filled + el texto "Método actual:" fuera de la tabla).
  it('marca el método actual con el badge "Actual" en su fila del comparativo', () => {
    expect(html).toContain('fin-cmp-badge');
    expect(html).toContain('>Actual<');
    expect(html).toContain('fin-cmp-row');
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

  // El comparativo de 3 métodos DEJÓ de ser admin-only: agencia/agente también lo ven, desplegable
  // desde el chip de método del hero. Es informativo (compara el mismo total en cada método, con datos
  // que ya tienen en pantalla) y no expone ninguna acción ni dato nuevo — a diferencia de los AJUSTES,
  // que siguen siendo admin-only porque su endpoint lo es.
  it.each(['admin', ...AGENCY_ROLES])('%s: comparativo de 3 métodos desplegable desde el chip', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="paymentMethodComparison"');
    expect(html).toContain('Total a pagar según el método de pago:');
    expect(html).toContain('fin-cmp-badge');
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

  // El carrito pasó a PESTAÑAS (Pago / Historial), igual que admin. Los chips de progreso + la sección
  // "saldo restante por método" + el bloque de descuento se fusionaron en una sola tabla "Por método de
  // pago" (Método · Total · Cubierto · Restante): antes las mismas barras se dibujaban dos veces.
  it.each(['admin', ...AGENCY_ROLES])('%s: Offcanvas con pestañas Pago/Historial y tabla por método', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="paymentsOffcanvas"');
    expect(html).toContain('offcanvas offcanvas-end');
    expect(html).toContain('id="paymentsTabs"');
    expect(html).toContain('id="tabPago"');
    expect(html).toContain('id="tabHistorial"');
    expect(html).toContain('id="paymentCoverageCard"');
    expect(html).toContain('id="paymentMethodTable"');
    expect(html).toContain('Por método de pago');
    expect(html).not.toContain('id="viewPaymentsBtn"');
    // Consume el endpoint AMPLIO (GET .../payments), no el objeto angosto de getReservationById.
    expect(html).toContain('/payments');
  });

  it.each(['admin', ...AGENCY_ROLES])('%s: los contenedores viejos del carrito ya no existen', async (role) => {
    const html = await render(role);
    expect(html).not.toContain('id="paymentChips"');
    expect(html).not.toContain('id="paymentRemainingByMethod"');
    expect(html).not.toContain('id="paymentDiscountEmphasis"');
  });

  it.each(AGENCY_ROLES)('%s: "Agregar pago" sigue siendo la única puerta de entrada al carrito', async (role) => {
    const html = await render(role);
    expect(html).toContain('id="addPaymentBtn"');
  });
});

// Fix bug ALTA: un servicio "Pago externo" (includeInTotal:false) se mostraba distinto en cada vista —
// $0.00 sin badge en admin, precio completo sin badge en agencia/agente.
//
// El BADGE se retiró de admin al rediseñar su lista de servicios con la maqueta del itinerario; agencia
// y agente aún lo pintan y se alinearán al portar esa maqueta. Lo que NO cambia —y es lo que de verdad
// arreglaba el bug— es que la línea del servicio muestre el precio REAL en las 3, en vez de $0.
// El <script> no se ejecuta en el cascarón; se verifica el literal en su fuente renderizada.
describe('Booking Detail — servicio "Pago externo" (includeInTotal:false) unificado entre roles', () => {
  let htmlAdmin;

  beforeAll(async () => { htmlAdmin = await render('admin'); });

  it.each(AGENCY_ROLES)('%s: pinta el badge "Pago externo" condicionado a includeInTotal === false', async (role) => {
    const html = await render(role);
    expect(html).toContain('Pago externo');
    expect(html).toContain('svc.subconcept?.includeInTotal === false');
  });

  // Se verifica el MARKUP del badge, no la frase: el <script> embebido viaja en el HTML y la frase
  // sobrevive en sus comentarios, así que un not.toContain('Pago externo') fallaría sin que el badge
  // se pinte.
  it('admin: el badge salió del título con el rediseño de la lista', () => {
    expect(htmlAdmin).not.toContain('>Pago externo</span>');
    expect(htmlAdmin).not.toContain('externalBadge');
  });

  // Admin ya no muestra PRECIO por servicio: su lista es la vista de operación (quién va, a qué hora,
  // en qué vehículo) y el dinero vive en el Resumen Financiero y en el carrito de pagos. Con eso el
  // bug original queda sin superficie en admin —no hay precio que pueda aparecer en $0—, pero lo que
  // de verdad hay que blindar es que el AGREGADO siga excluyendo "Pago externo" (test siguiente).
  //
  // Marcadores de MARKUP y del call site completo, no del nombre del helper: ese sigue nombrado en
  // los comentarios de la plantilla, que viajan en el <script> embebido.
  it('admin: la línea del servicio ya no pinta precio', () => {
    expect(htmlAdmin).not.toContain('<span class="svc-price">');
    expect(htmlAdmin).not.toContain('getServicePriceByTypeGross(svc, reservationData.paymentType)');
  });

  it('admin: el agregado financiero sigue usando computeServicesSubtotalByType (excluye Pago externo, no se tocó)', () => {
    expect(htmlAdmin).toContain('computeServicesSubtotalByType');
  });
});
