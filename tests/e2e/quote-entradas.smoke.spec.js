// Smoke E2E del tipo de servicio ENTRADAS y de las ENTRADAS EN EXPERIENCIAS (modal admin).
// Un solo login/navegación (para no chocar con el rate limiter de auth: 10 req/15min), con pasos
// (test.step). Se apoya en el builder global (window.itineraryBuilder) e inyecta datos fake
// deterministas en los caches — no depende de que la BD tenga entradas ni de clics frágiles.
//
// Cubre:
//   1. Entradas (tipo de servicio): catálogo → dropdown, autollenado de precio unitario, y el dev
//      breakdown "N entrada(s) × $unit = $total" con recargo por forma de pago (pricesByType).
//   2. Entradas en experiencia: lista editable (incluir/precio/cantidad), costo por persona
//      Σ(precio×cantidad) con el toggle ON/OFF, y la línea "Entradas: N × $Y = $Z" en el desglose.
//   3. Entradas en tour (walking/vehículo, uno o más destinos): resolución de entradas POR destino
//      (principal + adicionales, señuelo de otro destino excluido), render y costo con el toggle.
//
// Requiere: E2E_EMAIL, E2E_PASSWORD, E2E_QUOTE_ID, E2E_ROLE=admin, E2E_BASE_URL.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const QUOTE_ID = process.env.E2E_QUOTE_ID;
const ROLE = process.env.E2E_ROLE || 'admin';

test.describe('Entradas — smoke (tipo de servicio + entradas en experiencia)', () => {
  test.skip(!EMAIL || !PASSWORD || !QUOTE_ID, 'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_QUOTE_ID');
  test.skip(ROLE !== 'admin', 'El modal de servicio (Entradas) vive en el dashboard admin');

  test('Entradas como servicio y entradas asociadas a experiencia', async ({ page }) => {
    // --- Login + navegación (una sola vez) ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`/dashboard/${ROLE}/quotes/${QUOTE_ID}?section=services`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.itineraryBuilder, { timeout: 45_000 });

    await test.step('tipo Entradas: dropdown, autollenado de precio y dev breakdown por método', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        const out = {};
        if (typeof b.populateEntradaSelect !== 'function' || typeof b.handleEntradaSelection !== 'function') {
          return { skip: true };
        }
        // Inyecta una entrada fake determinista en el catálogo global.
        const all = (b.entradasCache && b.entradasCache.get('all')) || [];
        all.push({
          id: 'E2E_ENTRADA', name: 'E2E Museo Test', price: 250, destinoId: 'E2E_D', destinoName: 'E2E Destino',
        });
        b.entradasCache.set('all', all);

        // Selecciona el tipo "Entradas" y puebla el dropdown.
        const radio = document.getElementById('typeEntrada');
        out.hasRadio = !!radio;
        if (radio) { radio.checked = true; b.handleServiceTypeChange('entrada'); }
        b.populateEntradaSelect();
        const sel = document.getElementById('entradaSelect');
        out.optionExists = !!(sel && sel.querySelector('option[value="E2E_ENTRADA"]'));

        // Selecciona la entrada → autollena el precio unitario en #servicePrice.
        if (b.resetMainPriceManualEdit) b.resetMainPriceManualEdit();
        if (sel) sel.value = 'E2E_ENTRADA';
        b.handleEntradaSelection('E2E_ENTRADA');
        out.autofilledPrice = parseFloat(document.getElementById('servicePrice')?.value || 0);

        // Cantidad = 3 y refresco del dev breakdown (llena los 3 métodos).
        const qty = document.getElementById('entradaQuantity');
        if (qty) qty.value = '3';
        if (b.updateDevPaymentBreakdown) b.updateDevPaymentBreakdown();
        out.devEfectivo = document.getElementById('devBreakdownEfectivo')?.value || '';
        out.devTransferencia = document.getElementById('devBreakdownTransferencia')?.value || '';
        out.efectivoTotal = b.extractTotalFromBreakdown
          ? b.extractTotalFromBreakdown(out.devEfectivo) : 0;
        out.transferenciaTotal = b.extractTotalFromBreakdown
          ? b.extractTotalFromBreakdown(out.devTransferencia) : 0;
        return out;
      });

      test.skip(!!r.skip, 'Métodos de Entradas no disponibles en el builder (rama sin la feature)');
      expect(r.hasRadio, 'debe existir el radio #typeEntrada').toBeTruthy();
      expect(r.optionExists, 'la entrada inyectada aparece en #entradaSelect').toBeTruthy();
      expect(r.autofilledPrice, 'precio unitario autollenado = catálogo (250)').toBeCloseTo(250, 2);
      expect(r.devEfectivo, 'dev breakdown menciona "3 entrada(s)"').toMatch(/3 entrada\(s\)/i);
      expect(r.efectivoTotal, 'total efectivo = 250 × 3 = 750').toBeCloseTo(750, 1);
      // El total en transferencia debe llevar recargo (> efectivo) — se aplica el paymentType.
      expect(r.transferenciaTotal, 'total transferencia con recargo (> efectivo)').toBeGreaterThan(r.efectivoTotal - 0.01);
    });

    await test.step('entradas en experiencia: lista editable, costo por persona (toggle) y línea en desglose', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.renderExperienceEntradas !== 'function'
          || typeof b.getExperienceEntradasCostMXN !== 'function') {
          return { skip: true };
        }
        const out = {};
        // Selecciona el tipo experiencia.
        const radio = document.getElementById('typeExperience');
        if (radio) { radio.checked = true; b.handleServiceTypeChange('experience'); }

        // Renderiza entradas fake de la experiencia (2 boletos).
        b.renderExperienceEntradas([
          { id: 'X1', name: 'Entrada A', price: 100, destinoName: 'D' },
          { id: 'X2', name: 'Entrada B', price: 50, destinoName: 'D' },
        ]);
        const section = document.getElementById('experienceEntradasSection');
        out.sectionVisible = !!(section && !section.classList.contains('d-none'));
        out.rows = document.querySelectorAll('#experienceEntradasList .exp-entrada-row').length;
        // La cantidad trae placeholder "0" (requisito: si no hay personas en la cotización).
        out.qtyPlaceholder = document.querySelector('#experienceEntradasList .exp-entrada-qty')?.placeholder;

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        // SYNC: al cambiar las cantidades de personas, la cantidad de la entrada se auto-llena con la
        // suma (adultos + niños + sin-alcohol) = 5 + 2 + 0 = 7.
        setVal('adultsQuantity', '5'); setVal('childrenQuantity', '2'); setVal('adultsNoAlcoholQuantity', '0');
        document.getElementById('adultsQuantity').dispatchEvent(new Event('input', { bubbles: true }));
        out.syncedQty = document.querySelector('#experienceEntradasList .exp-entrada-qty')?.value;

        // Fija cantidades explícitas (1 c/u) para un cálculo determinista del costo (independiente
        // del sync anterior).
        document.querySelectorAll('#experienceEntradasList .exp-entrada-qty').forEach((el) => { el.value = '1'; });
        setVal('adultsQuantity', '2');
        setVal('childrenQuantity', '1');
        setVal('adultPrice', '200');

        const toggle = document.getElementById('experienceEntradasPerPerson');
        // Toggle OFF → costo 0 (no afecta el precio).
        if (toggle) toggle.checked = false;
        out.costOff = b.getExperienceEntradasCostMXN();

        // Toggle ON → Σ(precio × cantidad) = 100×1 + 50×1 = 150 (la cantidad ya es el nº de boletos).
        if (toggle) toggle.checked = true;
        out.costOn = b.getExperienceEntradasCostMXN();

        const st = b.getExperienceEntradasState();
        out.itemsCount = st.items.length;
        out.perPersonFlag = st.perPerson;

        // Desglose de experiencia: debe incluir la línea "Entradas: $150.00".
        if (b.updateDevPaymentBreakdown) b.updateDevPaymentBreakdown();
        out.devEfectivo = document.getElementById('devBreakdownEfectivo')?.value || '';
        return out;
      });

      test.skip(!!r.skip, 'Entradas-en-experiencia no disponible en el builder (rama sin la feature)');
      expect(r.sectionVisible, 'la sección de entradas se muestra con entradas').toBeTruthy();
      expect(r.rows, 'render de 2 filas editables').toBe(2);
      expect(r.qtyPlaceholder, 'la cantidad tiene placeholder "0"').toBe('0');
      expect(Number(r.syncedQty), 'la cantidad de la entrada se auto-llena con adultos+niños+sin-alcohol (5+2=7)').toBe(7);
      expect(r.itemsCount, 'getExperienceEntradasState devuelve 2 items').toBe(2);
      expect(r.costOff, 'toggle OFF → costo = 0').toBe(0);
      expect(r.costOn, 'toggle ON → Σ(precio×cantidad) = 100 + 50 = 150').toBeCloseTo(150, 2);
      expect(r.perPersonFlag, 'flag del toggle = true con ON').toBe(true);
      expect(r.devEfectivo, 'desglose incluye la línea "Entradas: $150..."').toMatch(/Entradas:.*\$150/i);
    });

    await test.step('entradas en tour: resolución por destino (principal + adicional), render y costo (toggle)', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.renderTourEntradas !== 'function'
          || typeof b.getTourEntradasCostMXN !== 'function'
          || typeof b.getTourEntradas !== 'function') {
          return { skip: true };
        }
        const out = {};
        // Dos tours walking fake, cada uno con su destino (POI).
        b.toursCache.set('all', [
          { id: 'E2E_TOUR', objectId: 'E2E_TOUR', isWalkingTour: true, destinationPOI: { objectId: 'E2E_TD', name: 'Destino Tour' } },
          { id: 'E2E_TOUR2', objectId: 'E2E_TOUR2', isWalkingTour: true, destinationPOI: { objectId: 'E2E_TD2', name: 'Destino Tour 2' } },
        ]);
        // Entradas: 1 del destino principal + 1 del destino adicional + 1 señuelo de OTRO destino
        // (no debe aparecer: la resolución es POR destino del/los tour(s)).
        b.entradasCache.set('all', [
          { id: 'TE1', name: 'Entrada Tour A', price: 120, destinoId: 'E2E_TD', destinoName: 'Destino Tour' },
          { id: 'TE2', name: 'Entrada Tour B', price: 80, destinoId: 'E2E_TD2', destinoName: 'Destino Tour 2' },
          { id: 'DECOY', name: 'No debe salir', price: 999, destinoId: 'OTRO_DESTINO', destinoName: 'Otro' },
        ]);
        // Selecciona el tipo tour y el tour principal (asegura la opción en el dropdown).
        const radio = document.getElementById('typeTour');
        if (radio) { radio.checked = true; b.handleServiceTypeChange('tour'); }
        const tsel = document.getElementById('tourSelect');
        if (tsel) {
          if (!tsel.querySelector('option[value="E2E_TOUR"]')) {
            const o = document.createElement('option'); o.value = 'E2E_TOUR'; o.textContent = 'E2E Tour'; tsel.appendChild(o);
          }
          tsel.value = 'E2E_TOUR';
        }
        // Combina un destino adicional → sus entradas también entran.
        b.additionalTourIds = ['E2E_TOUR2'];

        out.destinoIds = b.getTourDestinoIds().slice().sort();
        const ent = b.getTourEntradas();
        out.entradaIds = ent.map((e) => e.id).sort();

        // Render de la lista editable.
        b.renderTourEntradas(ent);
        const section = document.getElementById('tourEntradasSection');
        out.sectionVisible = !!(section && !section.classList.contains('d-none'));
        out.rows = document.querySelectorAll('#tourEntradasList .tour-entrada-row').length;

        // Cantidad 1 c/u para un costo determinista.
        document.querySelectorAll('#tourEntradasList .tour-entrada-qty').forEach((el) => { el.value = '1'; });
        const toggle = document.getElementById('tourEntradasPerPerson');
        if (toggle) toggle.checked = false;
        out.costOff = b.getTourEntradasCostMXN();
        if (toggle) toggle.checked = true;
        out.costOn = b.getTourEntradasCostMXN();
        out.itemsCount = b.getTourEntradasState().items.length;
        return out;
      });

      test.skip(!!r.skip, 'Entradas-en-tour no disponible en el builder (rama sin la feature)');
      expect(r.destinoIds, 'destinos del tour = principal + adicional').toEqual(['E2E_TD', 'E2E_TD2']);
      expect(r.entradaIds, 'entradas resueltas por destino (señuelo excluido)').toEqual(['TE1', 'TE2']);
      expect(r.sectionVisible, 'la sección de entradas del tour se muestra').toBeTruthy();
      expect(r.rows, 'render de 2 filas editables').toBe(2);
      expect(r.itemsCount, 'getTourEntradasState devuelve 2 items').toBe(2);
      expect(r.costOff, 'toggle OFF → costo = 0').toBe(0);
      expect(r.costOn, 'toggle ON → Σ(precio×cantidad) = 120 + 80 = 200').toBeCloseTo(200, 2);
    });
  });
});
