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

  // 860px. Se probó bajarlo a 700 y la tabla del historial quedaba en scroll horizontal: con una
  // referencia larga, quién recibió, quién registró y moneda extranjera pide ~793 px. El vacío del
  // desglose, que era el motivo para angostarlo, se resuelve limitando ESE bloque.
  test('existe el Offcanvas nativo de Bootstrap con ancho 860px y breakpoint sm (576px)', () => {
    expect(html).toContain('id="paymentsOffcanvas"');
    expect(html).toContain('offcanvas offcanvas-end');
    expect(html).toContain('--bs-offcanvas-width: 860px');
    expect(html).toContain('@media (max-width: 576px)');
  });

  // "Agregar pago" dejó el header del Resumen Financiero: ahora lo dibuja renderFinancialSummary
  // DENTRO del hero (y solo si la reservación es editable), así que ya no hay un orden de DOM que
  // verificar en el cascarón. Lo que sigue importando es que ambos controles existan y que el de
  // AJUSTE siga siendo admin-only (su endpoint es requireRole(['admin','superadmin'])).
  // Las dos afordancias se mudaron con el rediseño: "Agregar pago" vivía en el hero de la tarjeta
  // financiera y ahora está en la barra de cobranza del pie; "+ Agregar ajuste" bajó al carrito,
  // junto al desglose que modifica. Lo que este test protege es lo mismo: que admin conserve una
  // forma de registrar un pago y otra de crear un ajuste.
  test('admin conserva cómo registrar un pago y cómo agregar un ajuste', () => {
    expect(html).toContain('id="payBarPagarBtn"');
    expect(html).toContain('id="addAdjustmentBtn"');
  });

  test('la barra de cobranza trae el saldo, el avance y el método, no sólo un botón', () => {
    expect(html).toContain('id="payBarSaldo"');
    expect(html).toContain('id="payBarFill"');
    expect(html).toContain('id="payBarDetalle"');
    // El método decide CUÁL de los tres precios se está cobrando: sin él, el total de la barra no
    // dice de cuál habla, y la diferencia entre métodos es de decenas de miles.
    expect(html).toContain('id="payBarMetodo"');
  });

  // El desglose dejó de vivir en una tarjeta de la página: sus cinco cifras clave estaban ahí y en
  // la tarjeta de cobertura del carrito a la vez.
  test('el desglose ya no se pinta en la página, sino dentro del carrito', () => {
    expect(html).toContain('id="payDesglose"');
    expect(html).not.toContain('class="fin-wrap mb-4" id="financialSummaryCard"');
  });

  test('el offcanvas contiene los contenedores clave: cobertura, comparativo, historial', () => {
    // Sin pestañas: el panel se lee de corrido y el historial es la última sección.
    expect(html).not.toContain('id="paymentsTabs"');
    expect(html).not.toContain('id="tabHistorial"');
    expect(html).toContain('id="payHistSec"');
    expect(html).toContain('id="paymentCoverageCard"');
    // El comparativo por método vive ahora en su propia sección (#payCmp), no en una tabla aparte.
    expect(html).toContain('id="payCmp"');
    expect(html).not.toContain('id="paymentMethodTable"');
    expect(html).toContain('id="paymentsBody"');
    // Los chips de progreso, el "saldo restante por método" y el bloque de descuento se fusionaron
    // en la tabla por método: dibujaban las mismas barras dos veces.
    expect(html).not.toContain('id="paymentChips"');
    expect(html).not.toContain('id="paymentRemainingByMethod"');
    expect(html).not.toContain('id="paymentDiscountEmphasis"');
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

  test('la fecha de pago es obligatoria (atributo required en #paymentPaidAt)', () => {
    const paidAtInput = html.split('id="paymentPaidAt"')[1].split('>')[0];
    expect(paidAtInput).toContain('required');
  });

  test('existe el campo "¿Quién recibió el efectivo?" con maxlength 100', () => {
    expect(html).toContain('id="paymentReceivedByWrap"');
    expect(html).toContain('id="paymentReceivedBy"');
    expect(html).toContain('¿Quién recibió el efectivo?');
    const receivedInput = html.split('id="paymentReceivedBy"')[1].split('>')[0];
    expect(receivedInput).toContain('maxlength="100"');
  });

  test('el campo "recibió" está oculto por defecto salvo que el método sea efectivo (display condicional)', () => {
    // El cascarón no ejecuta JS: se verifica el literal del template embebido — display none salvo efectivo.
    expect(html).toContain("style=\"display:${method === 'efectivo' ? '' : 'none'};\"");
    // y su required también es condicional al método efectivo.
    expect(html).toContain("${method === 'efectivo' ? 'required' : ''}");
  });

  test('reacciona en vivo al cambiar el método (listener de change en #paymentMethod)', () => {
    expect(html).toContain("methodSel.addEventListener('change', syncReceivedByVisibility)");
    expect(html).toContain('function syncReceivedByVisibility');
  });

  test('pre-llena el receivedBy guardado al editar (mismo patrón que reference/notes, escapado)', () => {
    expect(html).toContain("PaymentBreakdownHelpers.escapeHtml(existing?.receivedBy || '')");
  });
});
