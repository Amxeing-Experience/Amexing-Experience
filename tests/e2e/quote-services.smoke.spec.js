// Smoke E2E del builder de Servicios (quote-services-v2).
// Objetivo principal: validar que el SPLIT de scripts (quote-services-v2.js +
// quote-services-v2-module.js) no rompió la carga ni el wiring de globals.
//
// Verifica, al abrir la sección Servicios de una cotización:
//   1. No hay errores de consola ni pageerror (un fallo de orden de carga saldría aquí).
//   2. La instancia global del builder existe (window.itineraryBuilder).
//   3. Las funciones de nivel módulo EXTRAÍDAS están disponibles (viven en el archivo
//      nuevo) — p.ej. window.checkRoundTripSpecificLocationFields.
//
// Requiere un servidor YA corriendo y credenciales por entorno:
//   E2E_EMAIL, E2E_PASSWORD  (cuenta NO productiva)
//   E2E_QUOTE_ID             (cotización existente para esa cuenta)
//   E2E_ROLE                 (admin | department_manager | client; default admin)
//   E2E_BASE_URL             (default http://localhost:1337)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const QUOTE_ID = process.env.E2E_QUOTE_ID;
const ROLE = process.env.E2E_ROLE || 'admin';

// Ruido de consola conocido / no crítico (ajustable). Vacío por ahora.
const IGNORED_CONSOLE = [
  /favicon/i,
  /Failed to load resource.*404.*\.map/i, // sourcemaps
  // Ruido de entorno / capas ajenas al builder de Servicios (no debe tumbar este smoke):
  /Refused to apply style/i, // asset CSS servido con MIME incorrecto (404 -> text/html)
  // Bug pre-existente de dashboard.ejs: breadcrumb .remove() en null, atrapado por un
  // try/catch que loguea "Dashboard error: ...". Corregido aparte con ?.remove().
  /Dashboard error:.*reading 'remove'/,
];

const isIgnored = (text) => IGNORED_CONSOLE.some((re) => re.test(text));

// Errores de PÁGINA pre-existentes y AJENOS al builder (layout/otros módulos), que no
// deben hacer fallar el smoke del split de quote-services. Mantener la lista mínima y
// específica.
const IGNORED_PAGEERRORS = [
  // dashboard.ejs: getElementById('breadcrumb-…').remove() cuando el breadcrumb no
  // existe en la página. Corregido aparte con optional chaining (?.remove()).
  /Cannot read properties of null \(reading 'remove'\)/,
];
const isIgnoredPageError = (text) => IGNORED_PAGEERRORS.some((re) => re.test(text));

test.describe('Servicios builder — smoke (split de scripts)', () => {
  test.skip(
    !EMAIL || !PASSWORD || !QUOTE_ID,
    'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_QUOTE_ID',
  );

  test('carga la sección Servicios sin errores y con los globals del builder', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isIgnored(msg.text())) consoleErrors.push(msg.text());
    });
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

    // --- Abrir la sección Servicios de la cotización ---
    const url = `/dashboard/${ROLE}/quotes/${QUOTE_ID}?section=services`;
    await page.goto(url, { waitUntil: 'networkidle' });

    // El builder se instancia en DOMContentLoaded; esperarlo.
    await page.waitForFunction(() => !!window.itineraryBuilder, { timeout: 30_000 });

    // 2. Instancia global del builder presente
    const hasBuilder = await page.evaluate(() => !!window.itineraryBuilder);
    expect(hasBuilder, 'window.itineraryBuilder debe existir').toBeTruthy();

    // 3. Funciones extraídas al archivo de módulo, expuestas en window
    const moduleFnType = await page.evaluate(
      () => typeof window.checkRoundTripSpecificLocationFields,
    );
    expect(
      moduleFnType,
      'checkRoundTripSpecificLocationFields (archivo módulo extraído) debe ser function',
    ).toBe('function');

    // 4. Helpers de formato extraídos a quote-services-v2-formatters.js (prototype):
    //    deben seguir disponibles en la instancia del builder.
    const FORMATTER_METHODS = [
      'formatCurrency', 'formatTime', 'formatTimeInput', 'formatMinutesToHoursAndMinutes',
      'parseTimeRange', 'parseTimeForSorting', 'parseSpanishDayAbbreviations',
      'calculateTourEndTime', 'roundTimeToNearest15', 'restrictTimeInputKeys',
      'extractStartTimeFromSchedule', 'calculateSuggestedDepartureTime',
    ];
    const missingFormatters = await page.evaluate(
      (names) => names.filter((n) => typeof window.itineraryBuilder[n] !== 'function'),
      FORMATTER_METHODS,
    );
    expect(
      missingFormatters,
      `formatters faltantes en el prototype: ${missingFormatters.join(', ')}`,
    ).toEqual([]);

    // Sanity: un formatter ejecuta y devuelve string (no rompe en runtime).
    const fmt = await page.evaluate(() => window.itineraryBuilder.formatCurrency(1234));
    expect(typeof fmt, 'formatCurrency(1234) debe devolver string').toBe('string');

    // 5. Helpers puros extraídos a quote-services-v2-helpers.js (prototype): muestra
    //    representativa debe seguir disponible en la instancia del builder.
    const HELPER_METHODS = [
      'getAccessToken', 'capitalizeFirst', 'generateId', 'showAlert', 'truncateText',
      'parseTimeToMinutes', 'isRoundTrip', 'cleanVehicleName', 'getPriceTypeLabel',
    ];
    const missingHelpers = await page.evaluate(
      (names) => names.filter((n) => typeof window.itineraryBuilder[n] !== 'function'),
      HELPER_METHODS,
    );
    expect(
      missingHelpers,
      `helpers puros faltantes en el prototype: ${missingHelpers.join(', ')}`,
    ).toEqual([]);

    // Sanity: un helper puro ejecuta.
    const cap = await page.evaluate(() => window.itineraryBuilder.capitalizeFirst('hola'));
    expect(cap, "capitalizeFirst('hola') debe devolver 'Hola'").toBe('Hola');

    // 1. Sin errores de consola / pageerror (orden de carga sano)
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console.error: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
