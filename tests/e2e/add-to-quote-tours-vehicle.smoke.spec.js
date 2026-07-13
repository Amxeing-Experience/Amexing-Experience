// Smoke E2E — "Agregar a cotización" POR VEHÍCULO desde un tour con vehículo.
//
// Los tours con vehículo no usan el botón global (por persona): cada vehículo
// tiene su propio botón "Agregar a cotización" (como traslados), tanto en la card
// como en la pestaña de precios del modal de detalle. Este test usa el modal de
// detalle (los botones por vehículo siempre están, sin depender del segmento).
//
// Verifica que el subconcepto guardado es un tour CON vehículo:
//   type='tour', requiresTransport=true, vehicleTypeName, isWalkingTour=false,
//   y total = precio base por hora (+ recargo de chofer solo si "Guía + Chofer").
//
// Solo department_manager / client (no admin). Requiere server + credenciales:
//   E2E_EMAIL, E2E_PASSWORD, E2E_ROLE=department_manager|client
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'department_manager';

test.describe('Agregar a cotización — Tour con vehículo (por vehículo)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');
  test.skip(ROLE === 'admin', 'El add-to-quote de tours no aplica para admin');

  test('agrega un vehículo del tour y guarda el subconcepto tour+vehículo', async ({ page }) => {
    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    await page.goto(`/dashboard/${ROLE}/tours`, { waitUntil: 'domcontentloaded' });

    // Filtrar a "Con vehículo" (usa el pill visible).
    const vehiclePill = page.locator('.tour-type-pill[data-tour-type="vehicle"]:visible').first();
    await expect(vehiclePill, 'debe existir el filtro "Con vehículo"').toBeVisible({ timeout: 45_000 });
    await vehiclePill.click();

    // Abrir el detalle del primer tour con vehículo.
    const viewMore = page.locator('.view-more-btn').first();
    await expect(viewMore, 'debe haber al menos un tour con vehículo').toBeVisible({ timeout: 20_000 });
    await viewMore.click();

    // En la sección de precios del detalle (dentro del modal), botón "Agregar" por vehículo.
    const vehBtn = page.locator('#tourDetailsModal .add-tour-vehicle-to-quote-btn').first();
    await expect(vehBtn, 'el detalle debe mostrar botones "Agregar" por vehículo').toBeVisible({ timeout: 20_000 });

    const veh = await vehBtn.evaluate((el) => ({
      tourName: el.dataset.tourName,
      vehicleName: el.dataset.vehicleName,
      basePrice: parseFloat(el.dataset.basePrice) || 0,
      driverRate: parseFloat(el.dataset.driverRate) || 0,
      withDriver: el.dataset.withDriver === '1',
      minHours: parseFloat(el.dataset.minHours) || 1,
    }));
    const hourly = veh.basePrice + (veh.withDriver ? veh.driverRate : 0);
    const expectedTotal = Math.round(hourly * veh.minHours * 100) / 100;
    expect(veh.vehicleName, 'el botón debe tener data-vehicle-name').toBeTruthy();

    // Click → cierra el detalle y abre el modal genérico.
    await vehBtn.click();
    const createBtn = page.locator('#atqCreateNew');
    await expect(createBtn, 'el modal genérico #atqModal debe abrir').toBeVisible({ timeout: 15_000 });

    await Promise.all([
      page.waitForURL(/\/quotes\/[A-Za-z0-9]+/, { timeout: 30_000 }),
      createBtn.click(),
    ]);

    const quoteId = page.url().match(/\/quotes\/([A-Za-z0-9]+)/)[1];
    expect(quoteId).toBeTruthy();

    // --- Verificar el subconcepto por API ---
    const res = await page.request.get(`/api/quotes/${quoteId}`);
    expect(res.ok(), `GET /api/quotes/${quoteId} -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const quote = body.data || body;
    const subs = (quote.serviceItems?.days || []).flatMap((d) => d.subconcepts || []);
    const s = subs.find((x) => x.type === 'tour');

    expect(s, 'debe existir un subconcepto de tour').toBeTruthy();
    expect(s.requiresTransport, 'el tour con vehículo requiere transporte').toBe(true);
    expect(s.isWalkingTour, 'no es walking tour').toBe(false);
    expect(s.vehicleTypeName, 'lleva el nombre del vehículo').toBe(veh.vehicleName);
    expect(Number(s.hours), 'hours = mínimo de horas del tour').toBeCloseTo(veh.minHours, 2);
    expect(s.includeGuide, 'includeGuide refleja "Guía + Chofer"').toBe(veh.withDriver);
    expect(Number(s.total), 'total = (base + chofer) × mín horas').toBeCloseTo(expectedTotal, 2);

    try { await page.request.delete(`/api/quotes/${quoteId}`); } catch (e) { /* best-effort */ }
  });
});
