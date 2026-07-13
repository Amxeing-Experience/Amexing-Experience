// Smoke E2E — "Agregar a cotización" desde un tour A PIE (walking).
//
// Los walking tours usan UN botón "Agregar" por tour (no por tramo): el tramo y
// el precio real dependen del nº de personas y los calcula la cotización. El botón
// guarda un subconcepto walking con default de 1 persona (tramo chico) para que no
// quede en $0, y el builder recalcula al ajustar el nº de personas.
//
// Verifica: type='tour', isWalkingTour=true, walkingTourPeopleCount=1,
// walkingPriceMode='calculated', total = precio del tramo chico (MXN) × mín horas.
//
// Solo department_manager / client (no admin).
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'department_manager';

test.describe('Agregar a cotización — Tour a pie (walking)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');
  test.skip(ROLE === 'admin', 'El add-to-quote de tours no aplica para admin');

  test('agrega un walking tour con default de 1 persona y guarda el subconcepto walking', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    await page.goto(`/dashboard/${ROLE}/tours`, { waitUntil: 'domcontentloaded' });

    // Filtrar a "A pie".
    const walkingPill = page.locator('.tour-type-pill[data-tour-type="walking"]:visible').first();
    await expect(walkingPill, 'debe existir el filtro "A pie"').toBeVisible({ timeout: 45_000 });
    await walkingPill.click();

    // Botón "Agregar" de la card de un walking tour.
    const addBtn = page.locator('.add-tour-to-quote-btn').first();
    await expect(addBtn, 'un walking tour debe mostrar el botón "Agregar"').toBeVisible({ timeout: 20_000 });

    const w = await addBtn.evaluate((el) => ({
      priceSmall: parseFloat(el.dataset.walkingPriceSmall) || 0,
      currency: (el.dataset.walkingCurrency || 'MXN').toUpperCase(),
      minHours: parseFloat(el.dataset.minHours) || 1,
    }));

    await addBtn.click();
    const createBtn = page.locator('#atqCreateNew');
    await expect(createBtn, 'el modal genérico #atqModal debe abrir').toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    // Paso de personas (nuevo): cotización NUEVA vacía → default 1 persona (tramo chico).
    const peopleConfirm = page.locator('.atq-people-confirm');
    await expect(peopleConfirm, 'debe aparecer el paso de personas').toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL(/\/quotes\/[A-Za-z0-9]+/, { timeout: 30_000 }),
      peopleConfirm.click(),
    ]);

    const quoteId = page.url().match(/\/quotes\/([A-Za-z0-9]+)/)[1];
    expect(quoteId).toBeTruthy();

    const res = await page.request.get(`/api/quotes/${quoteId}`);
    expect(res.ok(), `GET /api/quotes/${quoteId} -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const quote = body.data || body;
    const subs = (quote.serviceItems?.days || []).flatMap((d) => d.subconcepts || []);
    const s = subs.find((x) => x.type === 'tour');

    expect(s, 'debe existir un subconcepto de tour').toBeTruthy();
    expect(s.isWalkingTour, 'es walking tour').toBe(true);
    expect(Number(s.walkingTourPeopleCount), 'default 1 persona').toBe(1);
    expect(s.walkingPriceMode, 'modo calculado (lo recalcula la cotización)').toBe('calculated');
    expect(Number(s.hours), 'hours = mínimo de horas del tour').toBeCloseTo(w.minHours, 2);
    expect(s.pricesByType, 'el subconcepto trae pricesByType').toBeTruthy();

    // Total esperado sólo comparable exacto en MXN (en USD depende del tipo de cambio del server).
    if (w.currency === 'MXN' && w.priceSmall > 0) {
      const expected = Math.round(w.priceSmall * w.minHours * 100) / 100;
      expect(Number(s.total), 'total = tramo chico (MXN) × mín horas').toBeCloseTo(expected, 2);
    } else {
      expect(Number(s.total), 'total >= 0').toBeGreaterThanOrEqual(0);
    }

    try { await page.request.delete(`/api/quotes/${quoteId}`); } catch (e) { /* best-effort */ }
  });
});
