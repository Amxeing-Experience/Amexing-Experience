// Smoke E2E — "Agregar a cotización" desde la tabla de Traslados (services).
//
// Verifica el flujo real (UI → API) con una sesión autenticada:
//   1. La tabla de traslados renderiza botones "Agregar a cotización" (.add-svc-to-quote-btn)
//      en la columna de precio.
//   2. Al agregar + "Crear nueva cotización" se crea una cotización y redirige a ella.
//   3. La cotización creada contiene el subconcepto de traslado con los datos correctos
//      (type='transport', transferId, total) que arma el módulo genérico add-to-quote.
//
// El add-to-quote de traslados SOLO está disponible para department_manager y client
// (no admin), así que este test requiere credenciales de uno de esos roles:
//   E2E_EMAIL, E2E_PASSWORD  (cuenta department_manager o client, NO productiva)
//   E2E_ROLE = department_manager | client
//   E2E_BASE_URL             (default http://localhost:3337 vía .env.local)
//
// NOTA: crea una cotización de prueba en la BD y la elimina al final (best-effort).
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'department_manager';

test.describe('Agregar a cotización — Traslados', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');
  test.skip(ROLE === 'admin', 'El add-to-quote de traslados no aplica para admin (solo department_manager/client)');

  test('crea cotización desde un traslado y guarda el subconcepto correcto', async ({ page }) => {
    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- Tabla de traslados: esperar botón "Agregar a cotización" en una fila ---
    await page.goto(`/dashboard/${ROLE}/services`, { waitUntil: 'domcontentloaded' });

    const addBtn = page.locator('.add-svc-to-quote-btn').first();
    await expect(addBtn, 'debe renderizarse al menos un traslado con botón "Agregar"').toBeVisible({ timeout: 45_000 });

    // Capturar los datos del traslado que el front usará para el subconcepto.
    const svc = await addBtn.evaluate((el) => ({
      serviceId: el.dataset.serviceId,
      price: parseFloat(el.dataset.price) || 0,
    }));
    expect(svc.serviceId, 'el botón debe tener data-service-id').toBeTruthy();

    // --- Abrir modal genérico y crear nueva cotización ---
    await addBtn.click();
    const createBtn = page.locator('#atqCreateNew');
    await expect(createBtn, 'el modal genérico #atqModal debe abrir con "Crear nueva cotización"')
      .toBeVisible({ timeout: 15_000 });

    // Al crear, el módulo hace POST /api/quotes + PUT service-items y redirige a la cotización.
    await Promise.all([
      page.waitForURL(/\/quotes\/[A-Za-z0-9]+/, { timeout: 30_000 }),
      createBtn.click(),
    ]);

    const quoteId = page.url().match(/\/quotes\/([A-Za-z0-9]+)/)[1];
    expect(quoteId, 'debe haberse creado una cotización con id').toBeTruthy();

    // --- Verificar por API que el subconcepto de traslado quedó bien ---
    const res = await page.request.get(`/api/quotes/${quoteId}`);
    expect(res.ok(), `GET /api/quotes/${quoteId} -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const quote = body.data || body;
    const days = quote.serviceItems?.days || [];
    const subs = days.flatMap((d) => d.subconcepts || []);
    const svcSub = subs.find((s) => s.type === 'transport');

    expect(svcSub, 'la cotización debe contener un subconcepto de traslado (transport)').toBeTruthy();
    expect(svcSub.transferId, 'el transferId del subconcepto debe coincidir con el traslado').toBe(svc.serviceId);
    expect(Number(svcSub.total), 'el total del subconcepto debe coincidir con el precio del traslado')
      .toBeCloseTo(svc.price, 2);

    // --- Limpieza best-effort: borrar la cotización de prueba ---
    try {
      await page.request.delete(`/api/quotes/${quoteId}`);
    } catch (e) {
      // si no hay endpoint de borrado, se deja la cotización de prueba en dev
    }
  });
});
