// Smoke E2E de F3 (draft-first) + nombre GLOBAL obligatorio en el editor de Experiencias.
// Verifica el flujo real contra el backend, SIN depender del modal de servicios:
//   1. La página de "nueva experiencia" carga con el input de nombre GLOBAL en el
//      header y el botón Guardar DESHABILITADO (aún sin nombre).
//   2. Al escribir el nombre y salir del campo (blur) se crea automáticamente un
//      BORRADOR real (active:false, oculto de listas) — sin usar localStorage.
//   3. Tras nombrar, el botón Guardar queda HABILITADO.
//   4. Limpieza: se borra el borrador de prueba (DELETE).
//
// Requiere un servidor YA corriendo y credenciales por entorno (ver playwright.config.js):
//   E2E_EMAIL, E2E_PASSWORD  (cuenta NO productiva) · E2E_ROLE (default admin)
//   E2E_BASE_URL             (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';

test.describe('Experiencias — F3 draft-first + nombre global (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  // pageerror pre-existente y AJENO (breadcrumb de dashboard.ejs) — no debe tumbar el smoke.
  const IGNORED_PAGEERRORS = [/Cannot read properties of null \(reading 'remove'\)/];
  const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

  test('nombre global obligatorio crea el borrador al escribirlo (active:false, sin localStorage)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (!isIgnoredPageError(err.message)) pageErrors.push(err.message);
    });

    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- Nueva experiencia ---
    await page.goto(`/dashboard/${ROLE}/experiences/new`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.experienceServicesBuilder, { timeout: 30_000 });

    // 1. Nombre global en el header + Guardar deshabilitado (sin nombre)
    await expect(page.locator('#experienceName'), 'input de nombre global visible').toBeVisible();
    await expect(page.locator('#expSaveBtn'), 'Guardar deshabilitado sin nombre').toBeDisabled();

    // Sin borrador ni localStorage todavía
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

    // 3. Guardar ya habilitado + sin localStorage
    await expect(page.locator('#expSaveBtn'), 'Guardar habilitado con nombre').toBeEnabled();
    const temp = await page.evaluate(() => localStorage.getItem('tempExperienceServices'));
    expect(temp, 'sigue sin localStorage').toBeNull();

    // 4. El borrador es active:false (oculto). Verificar vía API y limpiar (DELETE).
    const draftActive = await page.evaluate(async (id) => {
      const token = window.experienceServicesBuilder.getAccessToken();
      const r = await fetch(`/api/experiences/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      const active = j.data ? j.data.active : 'no-data';
      await fetch(`/api/experiences/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return active;
    }, draftId);
    expect(draftActive, 'el borrador se crea active:false (oculto)').toBe(false);

    // Sin excepciones de página durante el flujo
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
