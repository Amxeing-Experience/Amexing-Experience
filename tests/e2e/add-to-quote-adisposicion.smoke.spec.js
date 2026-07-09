// Smoke E2E — "Agregar a cotización" desde A Disposición.
//
// Verifica el flujo real (UI → API) con una sesión autenticada:
//   1. La página a-disposición auto-selecciona tarifa+vehículo y calcula un precio,
//      mostrando el botón "Agregar a cotización".
//   2. Al agregar + "Crear nueva cotización" se crea una cotización y redirige a ella.
//   3. La cotización creada contiene el subconcepto de a-disposición con los datos
//      correctos (type='a-disposicion', total, horas, vehículos) que arma el front.
//
// Requiere servidor corriendo + credenciales por entorno (ver tests/e2e/README.md):
//   E2E_EMAIL, E2E_PASSWORD  (cuenta NO productiva; con botón de cotización)
//   E2E_ROLE                 (admin | department_manager | client; default admin)
//   E2E_BASE_URL             (default http://localhost:3337 vía .env.local)
//
// NOTA: crea una cotización de prueba en la BD y la elimina al final (best-effort).
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'department_manager';

test.describe('Agregar a cotización — A Disposición', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');
  test.skip(ROLE === 'admin', 'El add-to-quote de a-disposición se oculta para admin (solo department_manager/client)');

  test('calcula precio, crea cotización y guarda el subconcepto correcto', async ({ page }) => {
    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- A Disposición: esperar precio auto-calculado + botón visible ---
    await page.goto(`/dashboard/${ROLE}/a-disposicion`, { waitUntil: 'domcontentloaded' });

    // El botón vive en un wrapper que se muestra cuando hay un cálculo válido (total > 0).
    const addBtn = page.locator('#addDisposicionToQuoteBtn');
    await expect(addBtn, 'el botón "Agregar a cotización" debe aparecer tras el auto-cálculo').toBeVisible({ timeout: 45_000 });

    // Capturar el cálculo que el front usará para el subconcepto.
    const calc = await page.evaluate(() => window._currentDisposicionCalc || null);
    expect(calc, 'window._currentDisposicionCalc debe existir').toBeTruthy();
    expect(calc.totalCost, 'total > 0').toBeGreaterThan(0);

    // --- Abrir modal y crear nueva cotización ---
    await addBtn.click();
    const createBtn = page.locator('#atqCreateNew');
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    // Al crear, el front hace POST /api/quotes + PUT service-items y redirige a la cotización.
    await Promise.all([
      page.waitForURL(/\/quotes\/[A-Za-z0-9]+/, { timeout: 30_000 }),
      createBtn.click(),
    ]);

    const quoteId = page.url().match(/\/quotes\/([A-Za-z0-9]+)/)[1];
    expect(quoteId, 'debe haberse creado una cotización con id').toBeTruthy();

    // --- Verificar por API que el subconcepto quedó bien ---
    const res = await page.request.get(`/api/quotes/${quoteId}`);
    expect(res.ok(), `GET /api/quotes/${quoteId} -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const quote = body.data || body;
    const days = quote.serviceItems?.days || [];
    const subs = days.flatMap((d) => d.subconcepts || []);
    const disp = subs.find((s) => s.type === 'a-disposicion');

    expect(disp, 'la cotización debe contener un subconcepto de a-disposición').toBeTruthy();
    expect(disp.total, 'el total del subconcepto debe coincidir con el calculado')
      .toBeCloseTo(calc.totalCost, 2);
    expect(Number(disp.hours), 'horas coinciden').toBe(Number(calc.hours));
    expect(Number(disp.vehicleCount), 'vehículos coinciden').toBe(Number(calc.vehicleCount));
    expect(disp.rateId, 'rateId presente').toBeTruthy();
    expect(disp.vehicleType, 'vehicleType presente').toBeTruthy();

    // --- Limpieza best-effort: borrar la cotización de prueba ---
    try {
      await page.request.delete(`/api/quotes/${quoteId}`);
    } catch (e) {
      // si no hay endpoint de borrado, se deja la cotización de prueba en dev
    }
  });
});
