// Smoke E2E — Precios de cliente en Traslados (services).
//
// Verifica, con un usuario autenticado (admin viendo a un cliente específico vía
// ?clientId, que ejercita EXACTAMENTE el mismo camino de código que usa el
// department_manager con su propio id):
//   1. La lista /api/services?clientId=… aplica precios de cliente (algún servicio
//      con priceData.isClientPrice === true).
//   2. El endpoint del "Ver todos" (all-rate-prices-with-client-prices) devuelve
//      overrides de cliente que difieren del precio base y son > 0.
//   3. El endpoint BASE (all-rate-prices, sin clientId) NO devuelve precios de cliente
//      (aislamiento correcto).
//   4. La página /dashboard/<role>/services?clientId=… carga sin errores de página.
//
// Requiere un servidor YA corriendo y credenciales por entorno:
//   E2E_EMAIL, E2E_PASSWORD   (cuenta NO productiva)
//   E2E_BASE_URL              (default http://localhost:3337 vía .env.local)
//   E2E_ROLE                  (admin | department_manager | client; default admin)
//   E2E_CLIENT_ID             (id de un AmexingUser con ClientPrices SERVICES vigentes)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';
const CLIENT_ID = process.env.E2E_CLIENT_ID;

const IGNORED_PAGEERRORS = [
  /Cannot read properties of null \(reading 'remove'\)/, // bug pre-existente de dashboard.ejs
];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

test.describe('Precios de cliente — Traslados (services)', () => {
  test.skip(!EMAIL || !PASSWORD || !CLIENT_ID, 'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_CLIENT_ID');

  test('aplica precios de cliente (lista + expand) y el base queda aislado', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    // --- Login (form clásico) ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // El JWT viaja en la cookie `accessToken` (la comparte page.request tras el login),
    // y authenticateToken la acepta — no hace falta extraer token manualmente.

    // --- 1) Lista de servicios del cliente: debe haber al menos un precio de cliente ---
    const listRes = await page.request.get(
      `/api/services?clientId=${CLIENT_ID}&draw=1&start=0&length=200`,
    );
    expect(listRes.ok(), `GET /api/services -> ${listRes.status()}`).toBeTruthy();
    const list = await listRes.json();
    const svcWithClient = (list.data || []).find(
      (s) => Array.isArray(s.priceData) && s.priceData.some((p) => p && p.isClientPrice),
    );
    expect(svcWithClient, 'debe existir al menos un servicio con precio de cliente aplicado').toBeTruthy();
    const serviceId = svcWithClient.id || svcWithClient.objectId;

    // --- 2) Expand (all-rate-prices-with-client-prices): overrides de cliente reales ---
    const withRes = await page.request.get(
      `/api/services/${serviceId}/all-rate-prices-with-client-prices?clientId=${CLIENT_ID}`,
    );
    expect(withRes.ok(), `expand con cliente -> ${withRes.status()}`).toBeTruthy();
    const withJson = await withRes.json();
    const overrides = (withJson.data || []).filter((d) => d.priceDisplay && d.priceDisplay.clientPrice != null);
    expect(overrides.length, 'el expand debe traer overrides de cliente').toBeGreaterThan(0);
    for (const o of overrides) {
      expect(o.priceDisplay.clientPrice, 'precio de cliente > 0').toBeGreaterThan(0);
    }
    const someDiffer = overrides.some((o) => Number(o.priceDisplay.clientPrice) !== Number(o.priceDisplay.basePrice));
    expect(someDiffer, 'al menos un precio de cliente debe diferir del base (override real)').toBeTruthy();

    // --- 3) Endpoint BASE: NO debe traer precios de cliente (aislamiento) ---
    const baseRes = await page.request.get(
      `/api/services/${serviceId}/all-rate-prices`,
    );
    expect(baseRes.ok(), `expand base -> ${baseRes.status()}`).toBeTruthy();
    const baseJson = await baseRes.json();
    const baseHasClient = (baseJson.data || []).some((d) => d.priceDisplay && d.priceDisplay.clientPrice != null);
    expect(baseHasClient, 'el endpoint base NO debe traer precios de cliente').toBeFalsy();

    // --- 4) La página de servicios carga (con clientId) sin errores de página ---
    await page.goto(`/dashboard/${ROLE}/services?clientId=${CLIENT_ID}`, { waitUntil: 'domcontentloaded' });
    // esperar a que el datatable pida los servicios con el clientId
    await page.waitForResponse(
      (r) => r.url().includes('/api/services') && r.url().includes(`clientId=${CLIENT_ID}`) && r.ok(),
      { timeout: 30_000 },
    );
    expect(pageErrors, `errores de página: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
