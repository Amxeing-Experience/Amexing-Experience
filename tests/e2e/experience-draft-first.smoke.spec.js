// Smoke E2E de F3 (draft-first) + nombre GLOBAL obligatorio en el editor de Experiencias.
// Verifica el flujo real contra el backend, SIN depender del modal de servicios:
//   Test 1: nueva experiencia -> Guardar deshabilitado sin nombre; al escribir el
//           nombre y hacer blur se crea un BORRADOR real (active:false) sin
//           localStorage; Guardar queda habilitado.
//   Test 2: se finaliza el borrador (llenar Información + Guardar) y la experiencia
//           queda active:true, redirigiendo a su detalle.
// Ambos limpian el registro creado (DELETE).
//
// Requiere un servidor YA corriendo y credenciales por entorno (ver playwright.config.js):
//   E2E_EMAIL, E2E_PASSWORD  (cuenta NO productiva) · E2E_ROLE (default admin)
//   E2E_BASE_URL             (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';

// pageerror pre-existente y AJENO (breadcrumb de dashboard.ejs) — no debe tumbar el smoke.
const IGNORED_PAGEERRORS = [/Cannot read properties of null \(reading 'remove'\)/];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

async function login(page) {
  await page.goto('/login');
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function gotoNewExperience(page) {
  await page.goto(`/dashboard/${ROLE}/experiences/new`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.experienceServicesBuilder, { timeout: 30_000 });
}

// Lee un campo de la experiencia vía API (en el contexto de la página, con el token del builder).
function fetchExperienceField(page, id, field) {
  return page.evaluate(async ({ id, field }) => {
    const token = window.experienceServicesBuilder?.getAccessToken?.()
      || localStorage.getItem('accessToken');
    const r = await fetch(`/api/experiences/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    return j.data ? j.data[field] : 'no-data';
  }, { id, field });
}

function deleteExperience(page, id) {
  return page.evaluate(async (id) => {
    const token = window.experienceServicesBuilder?.getAccessToken?.()
      || localStorage.getItem('accessToken');
    await fetch(`/api/experiences/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }, id);
}

test.describe('Experiencias — F3 draft-first + nombre global (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  test('nombre global obligatorio crea el borrador al escribirlo (active:false, sin localStorage)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    await login(page);
    await gotoNewExperience(page);

    // 1. Nombre global en el header + Guardar deshabilitado (sin nombre)
    await expect(page.locator('#experienceName'), 'input de nombre global visible').toBeVisible();
    await expect(page.locator('#expSaveBtn'), 'Guardar deshabilitado sin nombre').toBeDisabled();

    const before = await page.evaluate(() => ({
      marker: window.__experienceDraftId || null,
      temp: localStorage.getItem('tempExperienceServices'),
    }));
    expect(before.marker, 'aún no hay borrador').toBeFalsy();
    expect(before.temp, 'no se usa localStorage').toBeNull();

    // 2. Escribir el nombre y hacer blur -> se crea el borrador automáticamente
    const uniqueName = `SMOKE F3 ${Date.now()}`;
    await page.fill('#experienceName', uniqueName);
    await page.locator('#experienceName').blur();

    await page.waitForFunction(() => !!window.__experienceDraftId, { timeout: 15_000 });
    const draftId = await page.evaluate(() => window.__experienceDraftId);
    expect(draftId, 'blur del nombre -> borrador creado').toBeTruthy();

    // 3. Guardar habilitado + sigue sin localStorage
    await expect(page.locator('#expSaveBtn'), 'Guardar habilitado con nombre').toBeEnabled();
    const temp = await page.evaluate(() => localStorage.getItem('tempExperienceServices'));
    expect(temp, 'sigue sin localStorage').toBeNull();

    // 4. El borrador es active:false (oculto). Verificar vía API y limpiar.
    const active = await fetchExperienceField(page, draftId, 'active');
    expect(active, 'el borrador se crea active:false (oculto)').toBe(false);
    await deleteExperience(page, draftId);

    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });

  test('finaliza el borrador: nombre + Información -> experiencia active:true', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    await login(page);
    await gotoNewExperience(page);

    // Nombre (blur -> borrador)
    const uniqueName = `SMOKE F3 FINALIZE ${Date.now()}`;
    await page.fill('#experienceName', uniqueName);
    await page.locator('#experienceName').blur();
    await page.waitForFunction(() => !!window.__experienceDraftId, { timeout: 15_000 });
    const draftId = await page.evaluate(() => window.__experienceDraftId);
    expect(draftId, 'borrador creado').toBeTruthy();

    // Token (capturado ahora, en /new, con el builder presente) para la limpieza.
    const token = await page.evaluate(() => window.experienceServicesBuilder.getAccessToken());

    // NO llenamos descripción NI costo a propósito: SOLO el nombre es obligatorio.
    // (descripción cae al nombre por defecto; costo cae a 0).
    await page.click('#tab-informacion-btn');

    // Guardar -> debe disparar un PUT al MISMO borrador (finalize, no un POST nuevo)
    // que envía active:true. Capturamos esa respuesta (ocurre antes del redirect):
    // es la verificación determinista del finalize, sin depender del contexto post-nav.
    const [putResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PUT'
          && new RegExp(`/api/experiences/${draftId}(\\?|$)`).test(r.url()),
        { timeout: 20_000 },
      ),
      page.click('#expSaveBtn'),
    ]);
    expect(putResp.ok(), `el PUT de finalizar debe ser 2xx (status ${putResp.status()})`).toBeTruthy();
    const sentBody = JSON.parse(putResp.request().postData() || '{}');
    expect(sentBody.active, 'el finalize envía active:true (activa el borrador)').toBe(true);

    // Limpieza (best-effort: el borrador ya finalizó; lo borramos para no dejar basura).
    try {
      await page.evaluate(async ({ id, token }) => {
        await fetch(`/api/experiences/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      }, { id: draftId, token });
    } catch (_) { /* si la página ya navegó, no bloquea el test */ }

    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
