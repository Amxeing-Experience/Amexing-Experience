// Smoke E2E del "Atención a" / "Cliente" en el summary unificado (quote-summary.ejs).
// Valida la regla: cliente DIRECTO (end_client, clientType='direct') → se oculta el campo
// "Cliente" (#summaryClientItem) y queda solo "Atención a"; agencia / legacy (clientType null)
// → se muestra el campo "Cliente".
//
// Corre contra un servidor YA levantado (no lanza server). Credenciales por entorno:
//   E2E_EMAIL, E2E_PASSWORD           (cuenta NO productiva; admin)
//   E2E_SUMMARY_DIRECT_QUOTE          (id de una cotización clientType='direct')
//   E2E_SUMMARY_OTHER_QUOTE           (id de una cotización NO directa / legacy)
//   E2E_BASE_URL                      (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
// Defaults descubiertos en el ambiente de prueba; overrideables por entorno.
const DIRECT_QUOTE = process.env.E2E_SUMMARY_DIRECT_QUOTE || 'c1piPlKcG5'; // QTE-2026-0129 (direct)
const OTHER_QUOTE = process.env.E2E_SUMMARY_OTHER_QUOTE || '0kz3LcBU5Q'; // clientType null (legacy)

async function login(page) {
  await page.goto('/login');
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

// Abre el summary y espera a que el render termine (window.currentQuoteData se setea al final
// del render, DESPUÉS de aplicar la regla de ocultar "Cliente").
async function openSummary(page, quoteId) {
  await page.goto(`/dashboard/admin/quotes/${quoteId}?section=summary`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.currentQuoteData, { timeout: 30_000 });
}

test.describe('Summary — "Cliente" oculto para cliente directo', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');

  test('cliente DIRECTO: se oculta "Cliente", queda "Atención a"', async ({ page }) => {
    await login(page);
    await openSummary(page, DIRECT_QUOTE);

    const clientType = await page.evaluate(() => window.currentQuoteData?.clientType);
    expect(clientType, 'la cotización de prueba debe ser clientType="direct"').toBe('direct');

    const clientHidden = await page.evaluate(
      () => document.getElementById('summaryClientItem')?.classList.contains('d-none'),
    );
    expect(clientHidden, '#summaryClientItem debe estar oculto (d-none) en cliente directo').toBe(true);

    // "Atención a" debe seguir presente y con contenido (el cliente).
    const attn = await page.evaluate(
      () => (document.getElementById('summaryContactPerson')?.textContent || '').trim(),
    );
    expect(attn.length, '"Atención a" debe tener contenido').toBeGreaterThan(0);
    expect(attn, '"Atención a" no debe quedar en "-"').not.toBe('-');
  });

  test('cliente NO directo (legacy/agencia): se muestra "Cliente"', async ({ page }) => {
    await login(page);
    await openSummary(page, OTHER_QUOTE);

    const clientType = await page.evaluate(() => window.currentQuoteData?.clientType);
    expect(clientType, 'la cotización de control NO debe ser "direct"').not.toBe('direct');

    const clientHidden = await page.evaluate(
      () => document.getElementById('summaryClientItem')?.classList.contains('d-none'),
    );
    expect(clientHidden, '#summaryClientItem debe estar VISIBLE en no-directo').toBe(false);
  });
});
