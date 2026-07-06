// Smoke E2E del AUTO-GUARDADO por experiencia en las bandejas de Proveedores y
// Establecimientos (admin → Experiencias). Verifica el flujo real contra el backend:
//   1. Se crea un proveedor/establecimiento (padre) desde la bandeja → obtiene id.
//   2. Se agrega una experiencia, se escribe el nombre y al SALIR del campo (blur)
//      se dispara un POST /api/providers/:id/experiencias (auto-crea) y la card
//      recibe su data-id + estado "Guardado ✓".
//   3. Se edita un campo (precio) y al salir (blur) se dispara un PUT (actualiza),
//      SIN volver a crear ni re-guardar todo el padre.
// Ambos limpian el padre creado vía API (DELETE) al terminar.
//
// Requiere un servidor YA corriendo y credenciales por entorno (ver playwright.config.js):
//   E2E_EMAIL, E2E_PASSWORD (cuenta NO productiva) · E2E_ROLE (default admin)
//   E2E_BASE_URL (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';

// pageerror pre-existente y AJENO (breadcrumb de dashboard.ejs) — no debe tumbar el smoke.
const IGNORED_PAGEERRORS = [/Cannot read properties of null \(reading 'remove'\)/];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

// Config por bandeja: mismos endpoints de experiencias (los establecimientos los reutilizan).
const BANDEJAS = [
  {
    label: 'Proveedores',
    section: 'providers',
    createBtn: '#createProviderBtn',
    nameInput: '#name',
    descInput: '#description',
    saveBtn: '#saveProviderBtn',
    parentIdField: '#providerId',
    addExpBtn: '#addExperienciaBtn',
    list: '#providerExperienciasList',
    tableId: 'experience-providers-table',
    editBtn: '.edit-provider-btn',
  },
  {
    label: 'Establecimientos',
    section: 'establishments',
    createBtn: '#createEstablishmentBtn',
    nameInput: '#establishmentName',
    descInput: '#establishmentDescription',
    saveBtn: '#saveEstablishmentBtn',
    parentIdField: '#establishmentId',
    addExpBtn: '#addEstablishmentExperienciaBtn',
    list: '#establishmentExperienciasList',
    tableId: 'experience-establishments-table',
    editBtn: '.edit-establishment-btn',
  },
];

async function login(page) {
  await page.goto('/login');
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Borra el padre creado usando el MISMO endpoint base que usó la bandeja al crearlo.
function deleteParent(page, baseEndpoint, id) {
  return page.evaluate(async ({ baseEndpoint, id }) => {
    const token = window.localStorage.getItem('accessToken');
    await fetch(`${baseEndpoint}/${id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }, { baseEndpoint, id });
}

test.describe('Experiencias — auto-guardado por experiencia en bandejas (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  // Un solo login para ambas bandejas (minimiza intentos de login → evita rate limit).
  test('Proveedores y Establecimientos: al salir del nombre se auto-crea (POST) y al editar precio se actualiza (PUT)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    await login(page);

    // Recorre cada bandeja con el mismo flujo (crea padre → reabre → auto-guarda experiencia).
    const runBandeja = async (b) => {
      await page.goto(`/dashboard/${ROLE}/experiences?section=${b.section}`, { waitUntil: 'networkidle' });

      // 1. Crear el padre (proveedor/establecimiento) → capturamos el POST de creación.
      // Al abrir el panel de detalle, la leyenda del auto-guardado queda visible.
      await page.locator(b.createBtn).first().click();
      await expect(
        page.getByText('Los cambios se guardan solos al salir de cada campo', { exact: false }).first(),
        'leyenda de auto-guardado visible al abrir el panel',
      ).toBeVisible();

      const uniqueName = `SMOKE AUTOSAVE ${b.section} ${Date.now()}`;
      await page.fill(b.nameInput, uniqueName);
      await page.fill(b.descInput, `Padre de prueba de auto-guardado (${b.section}).`);

      const [createResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'POST'
            && /\/api\/(providers|experiences)(\?|$)/.test(r.url())
            && r.status() < 400,
          { timeout: 20_000 },
        ),
        page.locator(b.saveBtn).first().click(),
      ]);
      const createdBody = await createResp.json();
      const parentId = createdBody?.data?.id || createdBody?.data?.objectId;
      expect(parentId, 'el padre se creó y devolvió id').toBeTruthy();
      // Endpoint base usado (para limpiar al final con el mismo).
      const baseEndpoint = new URL(createResp.request().url()).pathname;

      try {
        // 2. Reabrir el padre desde la tabla (flujo real: abrir un padre EXISTENTE y
        // agregarle una experiencia). Recargar la sección da un estado limpio y evita la
        // carrera del reload que dispara la creación del padre en la misma sesión.
        await page.goto(`/dashboard/${ROLE}/experiences?section=${b.section}`, { waitUntil: 'networkidle' });
        await page.fill(`#${b.tableId}_filter input`, uniqueName);
        // Ambas bandejas abren el detalle al hacer click en la fila (no hay botón editar):
        // clicamos la celda con el nombre (evita botones/acciones de la fila).
        const nameCell = page.locator(`#${b.tableId} tbody tr td`, { hasText: uniqueName }).first();
        await nameCell.waitFor({ state: 'visible', timeout: 15_000 });
        await nameCell.click();

        // El campo oculto del id del padre debe quedar poblado (habilita el auto-guardado).
        await expect(page.locator(b.parentIdField)).toHaveValue(parentId, { timeout: 15_000 });
        await page.waitForLoadState('networkidle');

        // 3. Agregar una experiencia y escribir el nombre → blur dispara POST /experiencias.
        await page.locator(b.addExpBtn).first().click();
        const card = page.locator(`${b.list} .experiencia-editable`).last();
        await expect(card, 'card de experiencia nueva visible').toBeVisible();

        // name + description son requeridos por el backend para crear.
        await card.locator('.experiencia-name-input').fill(`Experiencia auto ${Date.now()}`);
        const expDesc = card.locator('.experiencia-description-input');
        await expDesc.fill('Descripción de prueba del auto-guardado.');

        const [postExp] = await Promise.all([
          page.waitForResponse(
            (r) => r.request().method() === 'POST'
              && /\/api\/providers\/[^/]+\/experiencias(\?|$)/.test(r.url()),
            { timeout: 20_000 },
          ),
          expDesc.blur(), // salir del campo con name + description ya llenos
        ]);
        expect(postExp.ok(), `POST de auto-crear experiencia 2xx (status ${postExp.status()})`).toBeTruthy();

        // La card recibe su data-id y muestra "Guardado ✓".
        await expect(card, 'la card recibió data-id tras el auto-guardado').toHaveAttribute('data-id', /.+/, { timeout: 10_000 });
        await expect(card.locator('.experiencia-autosave-status'), 'estado Guardado ✓').toContainText('Guardado', { timeout: 10_000 });

        // 4. Editar el precio → blur dispara PUT /experiencias/:id (actualiza, no re-crea).
        const expPrice = card.locator('.experiencia-price-input');
        await expPrice.fill('123.45');
        const [putExp] = await Promise.all([
          page.waitForResponse(
            (r) => r.request().method() === 'PUT'
              && /\/api\/providers\/[^/]+\/experiencias\/[^/]+(\?|$)/.test(r.url()),
            { timeout: 20_000 },
          ),
          expPrice.blur(),
        ]);
        expect(putExp.ok(), `PUT de actualizar experiencia 2xx (status ${putExp.status()})`).toBeTruthy();
      } finally {
        // Limpieza: borrar el padre creado (arrastra sus experiencias).
        if (parentId) await deleteParent(page, baseEndpoint, parentId);
      }
    };

    for (const b of BANDEJAS) {
      await test.step(b.label, () => runBandeja(b));
    }

    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
