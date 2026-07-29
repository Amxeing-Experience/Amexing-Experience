/**
 * Categoria B del PR 4 de la pasarela: el metodo de pago por DEFAULT del catalogo /
 * calculadora publica pasa de 'efectivo' a 'tarjeta'.
 *
 * Tests de RENDER real (no grep): cada vista se renderiza a HTML con renderComponent y se
 * verifica que la opcion seleccionada del filtro de metodo de pago es 'tarjeta', que hay
 * EXACTAMENTE UNA opcion seleccionada, y que 'efectivo' ya no esta seleccionada. Tambien se
 * cubre el fallback JS defensivo (`... || 'tarjeta'`) que aplica cuando el select no cargo.
 *
 * Casos B1-B11 del disenador + copias duplicadas por separado (tours-cards desktop/mobile,
 * unified-tours-cards x2, a-disposicion x4) + el caso especial de combined-experiences-cards
 * (se verifica el value inicial real, no la palabra 'selected') + dos vistas descubiertas por
 * el grep exigido (experiences-table.ejs, end_client/a-disposicion.ejs).
 */

const { renderComponent } = require('../../helpers/ejsTestUtils');

/**
 * Extrae el <select id="..."> del HTML renderizado y devuelve sus <option> con la marca de
 * seleccion real (atributo `selected` renderizado), sin depender de la palabra suelta.
 */
function paymentSelect(html, selectId) {
  const re = new RegExp(`<select[^>]*\\bid="${selectId}"[^>]*>([\\s\\S]*?)</select>`, 'i');
  const m = html.match(re);
  if (!m) return { found: false, options: [], selected: [], selectedValue: null };
  const inner = m[1];
  const optRe = /<option\s+value="([^"]*)"([^>]*?)>/gi;
  const options = [];
  let om;
  while ((om = optRe.exec(inner)) !== null) {
    options.push({ value: om[1], selected: /\bselected\b/i.test(om[2]) });
  }
  const selected = options.filter((o) => o.selected);
  return {
    found: true,
    options,
    selected,
    selectedValue: selected.length === 1 ? selected[0].value : null
  };
}

/** Aserto compartido: el select tiene tarjeta como unica opcion seleccionada, efectivo no. */
function expectDefaultsToTarjeta(html, selectId) {
  const sel = paymentSelect(html, selectId);
  expect(sel.found).toBe(true);
  // Existen las tres opciones de metodo de pago.
  const values = sel.options.map((o) => o.value);
  expect(values).toEqual(expect.arrayContaining(['efectivo', 'transferencia', 'tarjeta']));
  // Exactamente una seleccionada, y es tarjeta.
  expect(sel.selected).toHaveLength(1);
  expect(sel.selectedValue).toBe('tarjeta');
  // efectivo y transferencia NO estan seleccionadas.
  expect(sel.options.find((o) => o.value === 'efectivo').selected).toBe(false);
  expect(sel.options.find((o) => o.value === 'transferencia').selected).toBe(false);
}

describe('Categoria B - default de metodo de pago del catalogo = tarjeta', () => {
  describe('B1 - tours.ejs propaga defaultPaymentType=tarjeta a sus includes', () => {
    let html;
    beforeAll(async () => {
      html = await renderComponent('dashboards/admin/tours', { userRole: 'admin' });
    });
    test('walking-tours-section incluido muestra tarjeta por default', () => {
      expectDefaultsToTarjeta(html, 'walkingPaymentFilter-admin-walking-tours');
    });
    test('tours-table incluido muestra tarjeta por default', () => {
      expectDefaultsToTarjeta(html, 'paymentTypeFilter-tours-table');
    });
  });

  describe('B2 - walking-tours-section (fallback typeof no-trivial)', () => {
    test('sin defaultPaymentType (undefined) el default es tarjeta, una sola seleccionada', async () => {
      const html = await renderComponent('organisms/tours/walking-tours-section', { walkingToursId: 'wt' });
      expectDefaultsToTarjeta(html, 'walkingPaymentFilter-wt');
    });
    test('defaultPaymentType=tarjeta selecciona tarjeta (una sola)', async () => {
      const html = await renderComponent('organisms/tours/walking-tours-section', {
        walkingToursId: 'wt',
        defaultPaymentType: 'tarjeta'
      });
      expectDefaultsToTarjeta(html, 'walkingPaymentFilter-wt');
    });
    test('defaultPaymentType=efectivo aun respeta efectivo (una sola, no doble)', async () => {
      const html = await renderComponent('organisms/tours/walking-tours-section', {
        walkingToursId: 'wt',
        defaultPaymentType: 'efectivo'
      });
      const sel = paymentSelect(html, 'walkingPaymentFilter-wt');
      expect(sel.selected).toHaveLength(1);
      expect(sel.selectedValue).toBe('efectivo');
    });
    test('defaultPaymentType=transferencia respeta transferencia (una sola, no doble)', async () => {
      const html = await renderComponent('organisms/tours/walking-tours-section', {
        walkingToursId: 'wt',
        defaultPaymentType: 'transferencia'
      });
      const sel = paymentSelect(html, 'walkingPaymentFilter-wt');
      expect(sel.selected).toHaveLength(1);
      expect(sel.selectedValue).toBe('transferencia');
    });
  });

  describe('B3/B4 - tours-cards.ejs (copias desktop + mobile independientes)', () => {
    let html;
    beforeAll(async () => {
      html = await renderComponent('organisms/tours/tours-cards', { tableId: 'tc', apiEndpoint: '/api/tours' });
    });
    test('B3 desktop -> tarjeta', () => expectDefaultsToTarjeta(html, 'paymentTypeFilter-tc'));
    test('B4 mobile  -> tarjeta', () => expectDefaultsToTarjeta(html, 'paymentTypeFilterMobile-tc'));
    test('el default es tarjeta tambien para rol agencia (department_manager)', async () => {
      const dm = await renderComponent('organisms/tours/tours-cards', {
        tableId: 'tc', apiEndpoint: '/api/tours', userRole: 'department_manager'
      });
      expectDefaultsToTarjeta(dm, 'paymentTypeFilter-tc');
      expectDefaultsToTarjeta(dm, 'paymentTypeFilterMobile-tc');
    });
  });

  describe('B5/B6 - unified-tours-cards.ejs (dos bloques desktop + mobile)', () => {
    let html;
    beforeAll(async () => {
      html = await renderComponent('organisms/tours/unified-tours-cards', { tableId: 'ut', apiEndpoint: '/api/tours' });
    });
    test('B5 desktop -> tarjeta', () => expectDefaultsToTarjeta(html, 'paymentTypeFilter-ut'));
    test('B6 mobile  -> tarjeta', () => expectDefaultsToTarjeta(html, 'paymentTypeFilterMobile-ut'));
    test('el default es tarjeta tambien para rol agente (client)', async () => {
      const cl = await renderComponent('organisms/tours/unified-tours-cards', {
        tableId: 'ut', apiEndpoint: '/api/tours', userRole: 'client'
      });
      expectDefaultsToTarjeta(cl, 'paymentTypeFilter-ut');
      expectDefaultsToTarjeta(cl, 'paymentTypeFilterMobile-ut');
    });
  });

  describe('B7 - tours-table.ejs', () => {
    test('filtro de tabla -> tarjeta', async () => {
      const html = await renderComponent('organisms/datatable/tours-table', { tableId: 'tt' });
      expectDefaultsToTarjeta(html, 'paymentTypeFilter-tt');
    });
  });

  describe('B8 - services-table.ejs', () => {
    test('filtro de tabla -> tarjeta', async () => {
      const html = await renderComponent('organisms/datatable/services-table', { tableId: 'st', accessToken: '' });
      expectDefaultsToTarjeta(html, 'paymentTypeFilter-st');
    });
  });

  describe('B9 - greeter-table.ejs', () => {
    test('filtro de tabla -> tarjeta', async () => {
      const html = await renderComponent('organisms/datatable/greeter-table', { tableId: 'gt' });
      expectDefaultsToTarjeta(html, 'paymentTypeFilter-gt');
    });
  });

  describe('B10 - vehicle-rate-prices-section.ejs', () => {
    test('filtro de vehiculos -> tarjeta', async () => {
      const html = await renderComponent('organisms/services/vehicle-rate-prices-section', { vehicleRatePricesId: 'vr' });
      expectDefaultsToTarjeta(html, 'vehicleRatesPaymentFilter-vr');
    });
  });

  describe('B11 - combined-experiences-cards.ejs (caso especial: value inicial real)', () => {
    test('la opcion seleccionada renderizada es tarjeta, no efectivo/transferencia', async () => {
      const html = await renderComponent('organisms/experiences/combined-experiences-cards', { userRole: 'admin' });
      const sel = paymentSelect(html, 'filterPayment');
      // Se verifica el value REAL seleccionado, no la mera presencia de la palabra 'selected'.
      expect(sel.found).toBe(true);
      expect(sel.selected).toHaveLength(1);
      expect(sel.selectedValue).toBe('tarjeta');
      expect(sel.options.find((o) => o.value === 'efectivo').selected).toBe(false);
    });
  });

  describe('a-disposicion.ejs - calculadora de renta por horas (4 copias por rol)', () => {
    test.each([
      ['admin', 'dashboards/admin/a-disposicion'],
      ['client', 'dashboards/client/a-disposicion'],
      ['department_manager', 'dashboards/department_manager/a-disposicion'],
      ['end_client', 'dashboards/end_client/a-disposicion'] // descubierta por el grep exigido
    ])('dashboard %s -> disposicion-payment default tarjeta', async (role, view) => {
      const html = await renderComponent(view, { userRole: role });
      expectDefaultsToTarjeta(html, 'disposicion-payment');
    });
  });

  describe('experiences-table.ejs (descubierta por el grep exigido - catalogo experiencias admin)', () => {
    test('filtro de tabla -> tarjeta', async () => {
      const html = await renderComponent('organisms/datatable/experiences-table', { tableId: 'et', accessToken: '' });
      expectDefaultsToTarjeta(html, 'paymentTypeFilter-et');
    });
  });

  describe('Fallback JS defensivo: si el select no cargo, el calculo default usa tarjeta', () => {
    test('semantica || : un valor cargado gana; undefined/"" resuelven a tarjeta', () => {
      const fb = (v) => v || 'tarjeta';
      expect(fb(undefined)).toBe('tarjeta');
      expect(fb('')).toBe('tarjeta');
      expect(fb('efectivo')).toBe('efectivo');
      expect(fb('tarjeta')).toBe('tarjeta');
    });

    test('tours-cards: el fallback del filtro resuelve a tarjeta, no a efectivo', async () => {
      const html = await renderComponent('organisms/tours/tours-cards', { tableId: 'tc', apiEndpoint: '/api/tours' });
      expect(html).toContain("paymentFilterDesktop?.value || paymentFilterMobile?.value || 'tarjeta'");
      expect(html).not.toContain("paymentFilterDesktop?.value || paymentFilterMobile?.value || 'efectivo'");
    });

    test('unified-tours-cards: fallbacks (|| y ternario) resuelven a tarjeta', async () => {
      const html = await renderComponent('organisms/tours/unified-tours-cards', { tableId: 'ut', apiEndpoint: '/api/tours' });
      expect(html).toContain("paymentFilterDesktop?.value || paymentFilterMobile?.value || 'tarjeta'");
      expect(html).toContain("paymentFilter ? paymentFilter.value : 'tarjeta'");
      expect(html).not.toContain("|| paymentFilterMobile?.value || 'efectivo'");
      expect(html).not.toContain("paymentFilter ? paymentFilter.value : 'efectivo'");
    });

    test('tours-table: parametros default de funcion y fallbacks resuelven a tarjeta', async () => {
      const html = await renderComponent('organisms/datatable/tours-table', { tableId: 'tt' });
      expect(html).toContain("paymentType = 'tarjeta', currency = 'MXN', includeDriver = false");
      expect(html).toContain("paymentTypeEl ? paymentTypeEl.value : 'tarjeta'");
      expect(html).toContain(".val() || 'tarjeta'");
      expect(html).not.toContain("paymentType = 'efectivo', currency = 'MXN', includeDriver = false");
      expect(html).not.toContain("paymentTypeEl ? paymentTypeEl.value : 'efectivo'");
      expect(html).not.toContain(".val() || 'efectivo'");
    });

    test('a-disposicion (admin): el fallback del calculo resuelve a tarjeta', async () => {
      const html = await renderComponent('dashboards/admin/a-disposicion', { userRole: 'admin' });
      expect(html).toContain("$('#disposicion-payment').val() || 'tarjeta'");
      expect(html).not.toContain("$('#disposicion-payment').val() || 'efectivo'");
    });

    test('vehicle-rate-prices: el fallback del filtro resuelve a tarjeta', async () => {
      const html = await renderComponent('organisms/services/vehicle-rate-prices-section', { vehicleRatePricesId: 'vr' });
      expect(html).toContain("?.value || 'tarjeta'");
      expect(html).not.toContain("?.value || 'efectivo'");
    });
  });
});
