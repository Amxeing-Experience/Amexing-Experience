// Smoke E2E de la IMAGEN ÚNICA por destino (POI) en admin → Destinos.
// Verifica el flujo real contra el backend (con optimización + S3):
//   1. Crear un destino CON imagen → POST /api/pois responde 2xx y data.image trae url.
//   2. La imagen persiste: al reabrir el destino en edición se muestra el preview.
//   3. Quitar la imagen y guardar → PUT deja image en null.
// Limpia el destino creado vía API (DELETE) al terminar. Un solo login.
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

// PNG 2x2 rojo válido (para que el optimizador de imágenes lo pueda decodificar/reencodear).
const PNG_2x2_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSFQIAG9REwHhSDj0AAAAAElFTkSuQmCC';
const PNG_BUFFER = Buffer.from(PNG_2x2_BASE64, 'base64');

async function login(page) {
  await page.goto('/login');
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Borra el destino creado vía API (best-effort). El token vive en la cookie accessToken.
function deletePOI(page, id) {
  return page.evaluate(async (id) => {
    const token = (document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('accessToken=')) || '').split('=')[1];
    await fetch(`/api/pois/${id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }, id);
}

test.describe('Destinos — imagen única por destino (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  test('crear con imagen (POST optimiza) → persiste al editar → quitar imagen (PUT null)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    await login(page);
    await page.goto(`/dashboard/${ROLE}/pois`, { waitUntil: 'networkidle' });
    await expect(page.locator('#createPOIBtn'), 'botón crear destino visible').toBeVisible();

    // 1. Crear destino CON imagen.
    await page.locator('#createPOIBtn').click();
    await expect(page.locator('#poiModal')).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();

    const uniqueName = `SMOKE DESTINO IMG ${Date.now()}`;
    await page.fill('#name', uniqueName);

    // El tipo de traslado es requerido: esperar a que carguen las opciones y elegir la primera real.
    await expect(page.locator('#serviceType option')).not.toHaveCount(1, { timeout: 15_000 });
    await page.locator('#serviceType').selectOption({ index: 1 });

    // Adjuntar la imagen → debe aparecer el preview.
    await page.locator('#poiImageInput').setInputFiles({ name: 'destino.png', mimeType: 'image/png', buffer: PNG_BUFFER });
    await expect(page.locator('#poiImagePreviewWrap'), 'preview de imagen visible tras adjuntar').not.toHaveClass(/d-none/);

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/pois(\?|$)/.test(r.url()),
        { timeout: 45_000 }, // la optimización (AVIF/WebP/JPEG) puede tardar unos segundos
      ),
      page.locator('#savePOIBtn').click(),
    ]);
    expect(createResp.ok(), `POST /api/pois 2xx (status ${createResp.status()})`).toBeTruthy();
    const createBody = await createResp.json();
    const poiId = createBody?.data?.id;
    expect(poiId, 'el destino se creó y devolvió id').toBeTruthy();

    try {
      // El destino creado trae imagen optimizada con url servible.
      expect(createBody?.data?.image, 'la respuesta incluye la imagen').toBeTruthy();
      expect(typeof createBody.data.image.url, 'la imagen trae url (presigned/optimizada)').toBe('string');
      expect(createBody.data.image.url.length, 'la url no está vacía').toBeGreaterThan(0);

      // 2. Persistencia: reabrir el destino en edición y ver el preview.
      await page.fill('#pois-table_filter input', uniqueName);
      const editBtn = page.locator(`.edit-poi-btn[data-id="${poiId}"]`);
      await editBtn.first().waitFor({ state: 'visible', timeout: 15_000 });

      const [getResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'GET' && new RegExp(`/api/pois/${poiId}(\\?|$)`).test(r.url()),
          { timeout: 15_000 },
        ),
        editBtn.first().click(),
      ]);
      const getBody = await getResp.json();
      expect(getBody?.data?.image?.url, 'la imagen persiste y se devuelve con url al editar').toBeTruthy();

      await expect(page.locator('#poiModal')).toBeVisible();
      await expect(page.locator('#poiImagePreviewWrap'), 'preview visible al reabrir (imagen persistió)').not.toHaveClass(/d-none/);
      await expect(page.locator('#poiImagePreview'), 'preview con src').toHaveAttribute('src', /.+/);

      // 3. Quitar la imagen y guardar → PUT deja image en null.
      await page.locator('#removePOIImageBtn').click();
      await expect(page.locator('#poiImagePreviewWrap')).toHaveClass(/d-none/);

      const [putResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'PUT' && new RegExp(`/api/pois/${poiId}(\\?|$)`).test(r.url()),
          { timeout: 20_000 },
        ),
        page.locator('#savePOIBtn').click(),
      ]);
      expect(putResp.ok(), `PUT /api/pois 2xx (status ${putResp.status()})`).toBeTruthy();
      const putBody = await putResp.json();
      expect(putBody?.data?.image, 'tras quitarla, la imagen queda en null').toBeNull();
    } finally {
      if (poiId) await deletePOI(page, poiId);
    }

    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
