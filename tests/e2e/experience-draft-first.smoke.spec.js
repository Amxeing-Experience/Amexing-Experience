// Smoke E2E de F3 (draft-first) en el editor de Experiencias.
// Verifica el corazón de F3 contra el backend real, SIN depender del modal/UI:
//   1. La página de "nueva experiencia" carga y expone window.experienceServicesBuilder
//      con los métodos nuevos (ensureDraftExperience / showBasicInfoRequired).
//   2. ensureDraftExperience() SIN nombre -> devuelve null y NO crea borrador (aviso).
//   3. ensureDraftExperience() CON nombre -> crea un borrador REAL, marca
//      window.__experienceDraftId y NO escribe localStorage (adiós flujo frágil).
//   4. El borrador se crea active:false (oculto de listas). Luego se limpia (DELETE).
//
// Requiere un servidor YA corriendo y credenciales por entorno (ver playwright.config.js):
//   E2E_EMAIL, E2E_PASSWORD  (cuenta NO productiva)
//   E2E_ROLE                 (default admin)
//   E2E_BASE_URL             (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';

test.describe('Experiencias — F3 draft-first (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  // Errores de PÁGINA pre-existentes y AJENOS a F3 (layout/otros módulos) que no deben
  // tumbar este smoke. Mantener la lista mínima y específica.
  const IGNORED_PAGEERRORS = [
    // dashboard.ejs: getElementById('breadcrumb-…').remove() cuando el breadcrumb no
    // existe. Bug pre-existente (mismo que ignora quote-services.smoke.spec.js).
    /Cannot read properties of null \(reading 'remove'\)/,
  ];
  const isIgnoredPageError = (text) => IGNORED_PAGEERRORS.some((re) => re.test(text));

  test('nueva experiencia crea un borrador active:false sin localStorage', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (!isIgnoredPageError(err.message)) pageErrors.push(err.message);
    });

    // --- Login (form clásico; el csrfToken ya viene en la página) ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- Página de nueva experiencia ---
    await page.goto(`/dashboard/${ROLE}/experiences/new`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.experienceServicesBuilder, { timeout: 30_000 });

    // 1. Métodos F3 presentes en la instancia
    const methods = await page.evaluate(() => ({
      ensure: typeof window.experienceServicesBuilder.ensureDraftExperience,
      prompt: typeof window.experienceServicesBuilder.showBasicInfoRequired,
    }));
    expect(methods.ensure, 'ensureDraftExperience debe existir').toBe('function');
    expect(methods.prompt, 'showBasicInfoRequired debe existir').toBe('function');

    // 2. SIN nombre -> null y sin borrador (silenciamos el aviso para no bloquear)
    const withoutName = await page.evaluate(async () => {
      const b = window.experienceServicesBuilder;
      b._draftExperienceId = null;
      window.__experienceDraftId = null;
      const nameEl = document.getElementById('experienceName');
      if (nameEl) nameEl.value = '';
      const origAlert = window.alert;
      window.alert = () => {};
      window.showAlert = () => {};
      const res = await b.ensureDraftExperience();
      window.alert = origAlert;
      return { res, marker: window.__experienceDraftId };
    });
    expect(withoutName.res, 'sin nombre -> null').toBeNull();
    expect(withoutName.marker, 'sin nombre -> no marca borrador').toBeFalsy();

    // 3. CON nombre -> crea borrador real, marca el id, y NO usa localStorage
    const uniqueName = `SMOKE F3 ${Date.now()}`;
    await page.fill('#experienceName', uniqueName);
    const created = await page.evaluate(async () => {
      const b = window.experienceServicesBuilder;
      b._draftExperienceId = null;
      window.__experienceDraftId = null;
      const id = await b.ensureDraftExperience();
      return {
        id,
        marker: window.__experienceDraftId,
        temp: localStorage.getItem('tempExperienceServices'),
      };
    });
    expect(created.id, 'con nombre -> id de borrador').toBeTruthy();
    expect(created.marker, 'marca window.__experienceDraftId con el id').toBe(created.id);
    expect(created.temp, 'NO se escribe localStorage tempExperienceServices').toBeNull();

    // 4. El borrador es active:false (oculto). Verificar vía API y limpiar (DELETE).
    const draftActive = await page.evaluate(async (id) => {
      const token = window.experienceServicesBuilder.getAccessToken();
      const r = await fetch(`/api/experiences/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      const active = j.data ? j.data.active : 'no-data';
      // cleanup: borrar el borrador de prueba
      await fetch(`/api/experiences/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return active;
    }, created.id);
    expect(draftActive, 'el borrador se crea active:false (oculto)').toBe(false);

    // Sin excepciones de página durante el flujo
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
