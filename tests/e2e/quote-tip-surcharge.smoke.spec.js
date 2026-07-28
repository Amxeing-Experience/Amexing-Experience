// Smoke E2E del RECARGO DE LA PROPINA por forma de pago (wizard admin).
// Un solo login/navegación (para no chocar con el rate limiter de auth: 10 req/15min), con pasos
// (test.step). Se apoya en el builder global (window.itineraryBuilder) e inyecta objetos de servicio
// deterministas — no depende de la BD ni de clics frágiles.
//
// Regla verificada: la propina se calcula en efectivo y ESCALA al método por el factor del servicio
// pricesByType[método]/efectivo (== descuento). Así el 10% se cobra sobre el total ya recargado y el
// monto fijo sube igual que el servicio. Lo mostrado == lo cobrado.
//
// Cubre:
//   1. Propina POR SERVICIO (%): 10% de $200 efectivo -> 20 / 23.2 (transf) / 24.2 (tarjeta).
//   2. Propina POR SERVICIO (fijo): $50 -> 50 / 58 / 60.5.
//   3. Propina GLOBAL (fijo): $100 escala por el factor agregado (netMétodo/netEfectivo).
//   4. Propina GLOBAL (%): 10% sobre la base neta del método.
//
// Requiere: E2E_EMAIL, E2E_PASSWORD, E2E_QUOTE_ID, E2E_ROLE=admin, E2E_BASE_URL.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const QUOTE_ID = process.env.E2E_QUOTE_ID;
const ROLE = process.env.E2E_ROLE || 'admin';

test.describe('Propina — smoke (recargo por forma de pago)', () => {
  test.skip(!EMAIL || !PASSWORD || !QUOTE_ID, 'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_QUOTE_ID');
  test.skip(ROLE !== 'admin', 'El wizard de servicios vive en el dashboard admin');

  test('la propina escala por método (por servicio y global, % y fijo)', async ({ page }) => {
    // --- Login + navegación (una sola vez) ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`/dashboard/${ROLE}/quotes/${QUOTE_ID}?section=services`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.itineraryBuilder, { timeout: 45_000 });

    await test.step('propina por servicio (%): 10% escala por el factor del servicio', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.getServiceTipInPaymentType !== 'function') return { skip: true };
        // pricesByType: efectivo 200 -> transferencia 232 (1.16) -> tarjeta 242 (1.21).
        const service = {
          pricesByType: { efectivo: 200, transferencia: 232, tarjeta: 242 },
          tipType: 'percent', tipValue: 10,
        };
        return {
          efectivo: b.getServiceTipInPaymentType(service, 'efectivo'),
          transferencia: b.getServiceTipInPaymentType(service, 'transferencia'),
          tarjeta: b.getServiceTipInPaymentType(service, 'tarjeta'),
        };
      });
      test.skip(!!r.skip, 'getServiceTipInPaymentType no disponible (rama sin la feature)');
      expect(r.efectivo, '10% de 200 = 20').toBeCloseTo(20, 2);
      expect(r.transferencia, '20 × 232/200 = 23.2 (10% del total en transferencia)').toBeCloseTo(23.2, 2);
      expect(r.tarjeta, '20 × 242/200 = 24.2 (10% del total en tarjeta)').toBeCloseTo(24.2, 2);
    });

    await test.step('propina por servicio (fijo): $50 escala por el factor del servicio', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.getServiceTipInPaymentType !== 'function') return { skip: true };
        const service = {
          pricesByType: { efectivo: 200, transferencia: 232, tarjeta: 242 },
          tipType: 'amount', tipValue: 50,
        };
        return {
          efectivo: b.getServiceTipInPaymentType(service, 'efectivo'),
          transferencia: b.getServiceTipInPaymentType(service, 'transferencia'),
          tarjeta: b.getServiceTipInPaymentType(service, 'tarjeta'),
        };
      });
      test.skip(!!r.skip, 'getServiceTipInPaymentType no disponible');
      expect(r.efectivo, 'fijo $50 en efectivo').toBeCloseTo(50, 2);
      expect(r.transferencia, '50 × 1.16 = 58').toBeCloseTo(58, 2);
      expect(r.tarjeta, '50 × 1.21 = 60.5').toBeCloseTo(60.5, 2);
    });

    await test.step('propina global (fijo): $100 escala por el factor agregado método/efectivo', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.getGlobalTipAmount !== 'function') return { skip: true };
        const prev = b.globalTip;
        b.globalTip = { type: 'amount', value: 100, mandatory: false };
        // netEfectivo agregado = 200; netMétodo tarjeta = 242 (factor 1.21).
        const out = {
          efectivo: b.getGlobalTipAmount(200, 'efectivo', 200),
          tarjeta: b.getGlobalTipAmount(242, 'tarjeta', 200),
        };
        b.globalTip = prev;
        return out;
      });
      test.skip(!!r.skip, 'getGlobalTipAmount no disponible');
      expect(r.efectivo, 'global fijo $100 en efectivo (factor 1)').toBeCloseTo(100, 2);
      expect(r.tarjeta, '100 × 242/200 = 121 (escala con el total de la cotización)').toBeCloseTo(121, 2);
    });

    await test.step('propina global (%): 10% sobre la base neta del método', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.getGlobalTipAmount !== 'function') return { skip: true };
        const prev = b.globalTip;
        b.globalTip = { type: 'percent', value: 10, mandatory: false };
        const out = {
          efectivo: b.getGlobalTipAmount(200, 'efectivo', 200),
          tarjeta: b.getGlobalTipAmount(242, 'tarjeta', 200),
        };
        b.globalTip = prev;
        return out;
      });
      test.skip(!!r.skip, 'getGlobalTipAmount no disponible');
      expect(r.efectivo, '10% de 200 = 20').toBeCloseTo(20, 2);
      expect(r.tarjeta, '10% de 242 = 24.2 (base del método)').toBeCloseTo(24.2, 2);
    });
  });
});
