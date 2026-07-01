// Smoke E2E: alta de clientes directos por categoría + creación de cotización.
//
// Cubre el destape de las categorías especiales (wedding_planner / concierge /
// home_owner) end-to-end:
//   1. Da de alta un cliente directo de cada categoría desde el modal admin.
//   2. Verifica que CADA cliente quedó persistido en SU categoría (consultando
//      /api/clients/mixed?type=<categoría> — valida el fix del payload +
//      buildEndClientQuery).
//   3. Crea una cotización (clientType=direct) para cada cliente y valida que el
//      backend la acepta (POST /api/quotes → success + id).
//
// Requiere un servidor YA corriendo y credenciales por entorno (.env.local):
//   E2E_EMAIL, E2E_PASSWORD  (cuenta admin NO productiva)
//   E2E_BASE_URL             (default http://localhost:1337; en dev usar :3337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// Categorías de cliente directo a probar (value = clientCategory real en BD).
const CATEGORIES = [
  { value: 'direct_client', label: 'Cliente Directo' },
  { value: 'wedding_planner', label: 'Wedding Planner' },
  { value: 'concierge', label: 'Concierge' },
  { value: 'home_owner', label: 'Home Owner' },
];

// Ruido de página ajeno a este smoke (bugs pre-existentes de layout).
const IGNORED_PAGEERRORS = [
  /Cannot read properties of null \(reading 'remove'\)/, // dashboard.ejs breadcrumb
];
const isIgnoredPageError = (text) => IGNORED_PAGEERRORS.some((re) => re.test(text));

/**
 * Fuerza el valor de un radio btn-check (visualmente oculto) y dispara 'change'
 * para activar los listeners del formulario, ya que Playwright no puede click-ear
 * un input clip-eado con pointer-events:none.
 * @param {import('@playwright/test').Page} page - Página de Playwright.
 * @param {string} id - Id del input radio.
 * @returns {Promise<void>}
 */
async function selectRadio(page, id) {
  await page.evaluate((radioId) => {
    const r = document.getElementById(radioId);
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
}

/**
 * Lee el token de auth del almacenamiento del navegador (como lo hace la app).
 * @param {import('@playwright/test').Page} page - Página de Playwright.
 * @returns {Promise<string>} El bearer token.
 */
function readToken(page) {
  return page.evaluate(
    () => localStorage.getItem('token') || sessionStorage.getItem('token') || '',
  );
}

test.describe('Clientes por categoría + cotización — smoke', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  // Alta de 4 clientes + 4 cotizaciones (+ service-items) por UI: subir el timeout.
  test.setTimeout(240_000);

  test('da de alta cada tipo de cliente, lo persiste en su categoría y cotiza', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (!isIgnoredPageError(err.message)) pageErrors.push(err.message);
    });

    const stamp = Date.now();
    // Fecha futura (YYYY-MM-DD) para el día de servicio de cada cotización, así la
    // tabla las muestra bajo su filtro por defecto ('future' oculta las sin fechas).
    const futureDate = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    const created = [];

    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- 1. Alta de un cliente directo por categoría ---
    for (const cat of CATEGORIES) {
      await page.goto('/dashboard/admin/clients', { waitUntil: 'domcontentloaded' });

      // Abrir el modal por API de Bootstrap (el botón lo pinta el DataTable).
      await page.evaluate(() => {
        const el = document.getElementById('createClientModal');
        window.bootstrap.Modal.getOrCreateInstance(el).show();
      });
      await page.waitForSelector('#createClientModal.show', { timeout: 10_000 });

      // Cambiar a "Cliente Directo" y elegir la categoría.
      await selectRadio(page, 'clientType');
      await page.waitForSelector('#directClientFirstName', { state: 'visible' });
      await page.selectOption('#directClientCategory', cat.value);

      const firstName = `Smoke ${cat.label}`;
      const lastName = `T${stamp}`;
      const email = `smoke_${cat.value}_${stamp}@example.com`;
      await page.fill('#directClientFirstName', firstName);
      await page.fill('#directClientLastName', lastName);
      await page.fill('#directClientEmail', email);

      // Enviar y capturar la respuesta del alta.
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/owned-clients')
            && r.request().method() === 'POST',
          { timeout: 20_000 },
        ),
        page.click('#submitCreateClient'),
      ]);
      const json = await resp.json();
      expect(resp.status(), `alta ${cat.value} status`).toBeLessThan(300);
      expect(json.success, `alta ${cat.value} success`).toBeTruthy();
      const id = json.data && json.data.id;
      expect(id, `alta ${cat.value} id`).toBeTruthy();

      created.push({ ...cat, id, name: `${firstName} ${lastName}` });
    }

    expect(created.length).toBe(CATEGORIES.length);

    // --- 2. Cada cliente debe aparecer en SU categoría (persistencia + query) ---
    const token = await readToken(page);
    for (const c of created) {
      const found = await page.evaluate(async ({ id, type, bearer }) => {
        const r = await fetch(`/api/clients/mixed?type=${type}&limit=1000`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });
        const j = await r.json();
        const users = (j && j.data && j.data.users) || [];
        return users.some((u) => String(u.id) === String(id));
      }, { id: c.id, type: c.value, bearer: token });
      expect(found, `cliente "${c.name}" debe listarse en categoría ${c.value}`).toBeTruthy();
    }

    // --- 3. Crear una cotización (direct) para cada cliente ---
    for (const c of created) {
      await page.goto('/dashboard/admin/quotes/new', { waitUntil: 'domcontentloaded' });

      // Modo cliente directo. El custom-select de agencia se crea muy temprano (script
      // del atom), ANTES de que setupClientTypeSelector enganche los listeners de los
      // radios; por eso reintentamos el toggle hasta que #directClientRow se muestre.
      await expect
        .poll(
          async () => {
            await selectRadio(page, 'clientTypeDirect');
            return page.locator('#directClientRow').isVisible();
          },
          { timeout: 20_000, intervals: [400] },
        )
        .toBe(true);

      // Esperar a que exista la instancia del custom-select de cliente directo.
      await page.waitForFunction(
        (id) => {
          const el = document.getElementById(id);
          return !!(el && el.customSelect);
        },
        'directClientId',
        { timeout: 15_000 },
      );

      // Inyectar la opción del cliente y seleccionarla. setValue del custom-select
      // sólo aplica si la opción existe en allOptions, por eso addOption primero.
      await page.evaluate(({ id, value, label }) => {
        const cs = document.getElementById(id).customSelect;
        cs.addOption({ value, text: label });
        cs.setValue(value);
      }, { id: 'directClientId', value: c.id, label: c.name });

      const selected = await page.evaluate(
        (id) => document.getElementById(id).customSelect.getValue(),
        'directClientId',
      );
      expect(selected, `selección de cliente ${c.value}`).toBe(c.id);

      // Enviar la cotización y validar la respuesta del backend.
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().split('?')[0].endsWith('/api/quotes')
            && r.request().method() === 'POST',
          { timeout: 20_000 },
        ),
        page.click('#createQuoteBtn'),
      ]);
      const json = await resp.json();
      expect(json.success, `cotización ${c.value} success`).toBeTruthy();
      expect(json.data && json.data.id, `cotización ${c.value} id`).toBeTruthy();

      // Agregar un día de servicio con fecha futura para que la cotización sea
      // VISIBLE en la tabla (el filtro por defecto 'future' oculta las cotizaciones
      // sin fechas de servicio). Día mínimo válido: dayTotal 0 = suma de 0 subconcepts.
      const quoteId = json.data.id;
      const svc = await page.evaluate(async ({ id, date, bearer }) => {
        const r = await fetch(`/api/quotes/${id}/service-items`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            days: [{
              dayNumber: 1, dayTitle: 'Smoke', date, subconcepts: [], dayTotal: 0,
            }],
            subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
          }),
        });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, success: !!j.success };
      }, { id: quoteId, date: futureDate, bearer: token });
      expect(svc.success, `service-items ${c.value} (status ${svc.status})`).toBeTruthy();
    }

    // Ningún error de página no ignorado durante el flujo.
    expect(pageErrors, `errores de página: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
