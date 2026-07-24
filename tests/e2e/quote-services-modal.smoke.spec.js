// Smoke E2E del MODAL de servicio (admin) — cubre los ajustes de la rama feature/quotes-ajustes-36.
// Un solo test con pasos (test.step) para hacer UN login/navegación y no chocar con el
// rate limiter de auth (10 req/15min). Cubre:
//   1. Regla de guía por palabra completa: "guiado/guiada" NO ocultan el label; "guía/guías" sí.
//   2. Filtro de origen/destino de transporte por tipo/dirección:
//        - Aeropuerto arrival: origen = solo aeropuertos, destino = sin aeropuertos.
//        - Aeropuerto departure: al revés.
//        - Local: solo POIs de tipo "Local" (sin aeropuertos).
//   3. Vehicle tour: inputs de precio por persona (adulto/niño) presentes en el modal.
//
// Se apoya en el builder global (window.itineraryBuilder) y en globales del módulo de
// servicios; no depende de clics frágiles. Requiere:
//   E2E_EMAIL, E2E_PASSWORD, E2E_QUOTE_ID, E2E_ROLE=admin, E2E_BASE_URL.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const QUOTE_ID = process.env.E2E_QUOTE_ID;
const ROLE = process.env.E2E_ROLE || 'admin';

test.describe('Modal de servicio — smoke (ajustes-36)', () => {
  test.skip(!EMAIL || !PASSWORD || !QUOTE_ID, 'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_QUOTE_ID');
  test.skip(ROLE !== 'admin', 'Estos ajustes viven en el modal de servicio del admin');

  test('ajustes del modal: guía, filtros de transporte y precio por persona', async ({ page }) => {
    // --- Login + navegación (una sola vez) ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`/dashboard/${ROLE}/quotes/${QUOTE_ID}?section=services`, { waitUntil: 'domcontentloaded' });
    // El builder es la señal de "listo" (más confiable que networkidle).
    await page.waitForFunction(() => !!window.itineraryBuilder, { timeout: 45_000 });

    await test.step('regla de guía por palabra completa (guiado/guiada NO cuentan)', async () => {
      const r = await page.evaluate(() => {
        const b = window.itineraryBuilder;
        if (typeof b.serviceIncludesMentionGuide !== 'function') return { skip: true };
        // Inyecta entradas fake en el cache para probar la regla de forma determinista
        // (getServiceIncludesInfo lee del cache por id, no del service directo).
        const all = b.experiencesCache.get('all') || [];
        all.push({ id: 'E2E_GUIADO', includes: 'Recorrido guiado por viñedo\nDegustación guiada de 4 vinos' });
        all.push({ id: 'E2E_GUIA', includes: 'Incluye guía certificado y transporte' });
        all.push({ id: 'E2E_GUIAS', includes: 'guías locales bilingües' });
        b.experiencesCache.set('all', all);
        return {
          guiado: b.serviceIncludesMentionGuide({ type: 'experience', experienceId: 'E2E_GUIADO' }),
          guia: b.serviceIncludesMentionGuide({ type: 'experience', experienceId: 'E2E_GUIA' }),
          guias: b.serviceIncludesMentionGuide({ type: 'experience', experienceId: 'E2E_GUIAS' }),
        };
      });
      test.skip(!!r.skip, 'serviceIncludesMentionGuide no disponible en el builder');
      expect(r.guiado, '"guiado/guiada" NO debe contar como guía incluida (label sí aparece)').toBe(false);
      expect(r.guia, '"guía" sí cuenta (label se oculta)').toBe(true);
      expect(r.guias, '"guías" sí cuenta').toBe(true);
    });

    await test.step('filtro de origen/destino de transporte por tipo y dirección', async () => {
      // El init carga los POIs fire-and-forget; forzamos la carga (o un fetch de respaldo)
      // para no depender del timing y probar de forma determinista el filtro.
      const ready = await page.evaluate(async () => {
        if ((!window.allActivePois || !window.allActivePois.length)
          && typeof window.loadActiveServicesForDropdowns === 'function') {
          try { await window.loadActiveServicesForDropdowns(); } catch (e) { /* ignore */ }
        }
        if (!window.allActivePois || !window.allActivePois.length) {
          try {
            const r = await fetch('/api/pois/active', { headers: { 'Content-Type': 'application/json' } });
            const j = r.ok ? await r.json() : null;
            window.allActivePois = (j && (j.data || j.pois)) || (Array.isArray(j) ? j : []);
          } catch (e) { /* ignore */ }
        }
        return {
          hasFn: typeof window.populateDropdownsForTransportType === 'function',
          hasSelects: !!document.getElementById('transportOriginSelect')
            && !!document.getElementById('transportDestinationSelect'),
          poiCount: (window.allActivePois || []).length,
        };
      });
      test.skip(!ready.hasFn, 'populateDropdownsForTransportType no es global');
      test.skip(!ready.hasSelects, 'Los selects de transporte no están en el DOM');
      test.skip(ready.poiCount === 0, 'No hay POIs activos para probar el filtro');

      const counts = await page.evaluate(() => {
        const st = (p) => String((p.serviceType && p.serviceType.name) || '').trim().toLowerCase();
        const pois = window.allActivePois || [];
        return {
          airports: pois.filter((p) => st(p) === 'aeropuerto').length,
          nonAir: pois.filter((p) => st(p) !== 'aeropuerto').length,
          locals: pois.filter((p) => st(p) === 'local').length,
        };
      });
      test.skip(counts.airports === 0 || counts.nonAir === 0, 'Faltan POIs de aeropuerto y/o no-aeropuerto');

      // Clasifica las opciones actuales de un select. Los labels NO son únicos entre
      // serviceTypes (puede haber un POI "X" aeropuerto y otro "X" no-aeropuerto), así que
      // afirmamos la INTENCIÓN: cada opción pertenece al set esperado (existe al menos un POI
      // con ese label y ese tipo). "notInAirport" = opciones sin ningún POI aeropuerto, etc.
      const classify = (id) => page.evaluate((sel) => {
        const el = document.getElementById(sel);
        const names = el
          ? Array.from(el.options).map((o) => o.textContent).filter((t) => t && !t.startsWith('--'))
          : [];
        const st = (p) => String((p.serviceType && p.serviceType.name) || '').trim().toLowerCase();
        const pois = window.allActivePois || [];
        const airportSet = new Set(pois.filter((p) => st(p) === 'aeropuerto').map((p) => p.label));
        const nonAirportSet = new Set(pois.filter((p) => st(p) !== 'aeropuerto').map((p) => p.label));
        const localSet = new Set(pois.filter((p) => st(p) === 'local').map((p) => p.label));
        return {
          total: names.length,
          notInAirport: names.filter((n) => !airportSet.has(n)).length,
          notInNonAirport: names.filter((n) => !nonAirportSet.has(n)).length,
          notInLocal: names.filter((n) => !localSet.has(n)).length,
        };
      }, id);

      // AEROPUERTO ARRIVAL: origen = solo aeropuertos, destino = solo no-aeropuertos.
      await page.evaluate(() => window.populateDropdownsForTransportType('aeropuerto', 'arrival'));
      const arrO = await classify('transportOriginSelect');
      const arrD = await classify('transportDestinationSelect');
      expect(arrO.total, 'arrival: origen con opciones').toBeGreaterThan(0);
      expect(arrO.notInAirport, 'arrival: cada origen es un aeropuerto').toBe(0);
      expect(arrD.total, 'arrival: destino con opciones').toBeGreaterThan(0);
      expect(arrD.notInNonAirport, 'arrival: cada destino es NO-aeropuerto').toBe(0);

      // AEROPUERTO DEPARTURE: origen = solo no-aeropuertos, destino = solo aeropuertos.
      await page.evaluate(() => window.populateDropdownsForTransportType('aeropuerto', 'departure'));
      const depO = await classify('transportOriginSelect');
      const depD = await classify('transportDestinationSelect');
      expect(depO.total, 'departure: origen con opciones').toBeGreaterThan(0);
      expect(depO.notInNonAirport, 'departure: cada origen es NO-aeropuerto').toBe(0);
      expect(depD.total, 'departure: destino con opciones').toBeGreaterThan(0);
      expect(depD.notInAirport, 'departure: cada destino es un aeropuerto').toBe(0);

      // LOCAL: solo POIs de tipo "Local" (sin aeropuertos ni Punto a Punto).
      if (counts.locals > 0) {
        await page.evaluate(() => window.populateDropdownsForTransportType('local', 'arrival'));
        const locD = await classify('transportDestinationSelect');
        expect(locD.total, 'local: destino con opciones').toBeGreaterThan(0);
        expect(locD.notInLocal, 'local: cada opción es de tipo Local').toBe(0);
      }
    });

    await test.step('vehicle tour: inputs de precio por persona (adulto/niño) presentes', async () => {
      const present = await page.evaluate(() => ({
        adult: !!document.getElementById('tourAdultPrice'),
        child: !!document.getElementById('tourChildPrice'),
        inVehicleSection: !!document.querySelector('#vehicleTourPricingSection #tourAdultPrice'),
      }));
      expect(present.adult, '#tourAdultPrice debe existir').toBeTruthy();
      expect(present.child, '#tourChildPrice debe existir').toBeTruthy();
      expect(present.inVehicleSection, 'los inputs deben estar en #vehicleTourPricingSection').toBeTruthy();
    });
  });
});
