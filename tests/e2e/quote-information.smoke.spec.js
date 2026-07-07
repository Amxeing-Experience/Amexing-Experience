// Smoke E2E: rework de la sección "Información" de la cotización.
//
// Valida las variantes de campos recién implementadas:
//   - Render de las secciones nuevas: Lead Guest (con "Guardar cliente en el sistema"),
//     checkbox "contacto diferente al propietario", resumen "contacto = propietario",
//     y las chips del filtro de categorías.
//   - Toggle: al marcar "diferente" se muestran los campos de contacto y se oculta el
//     resumen; al desmarcar, al revés (vía la clase d-none que usa el JS).
//   - Guardado: con "diferente" SIN marcar, el payload copia el email del propietario
//     al contacto (evita doble captura); con "Guardar cliente" marcado, dispara el
//     POST /api/owned-clients/quick.
//
// Requiere un servidor YA corriendo y credenciales por entorno (.env.local):
//   E2E_EMAIL, E2E_PASSWORD, E2E_QUOTE_ID (una cotización existente)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const QUOTE_ID = process.env.E2E_QUOTE_ID;

// Ruido de página ajeno a este smoke (bugs pre-existentes de layout).
const IGNORED_PAGEERRORS = [
  /Cannot read properties of null \(reading 'remove'\)/, // dashboard.ejs breadcrumb
];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

/** Devuelve true si el elemento tiene la clase d-none (oculto por el JS del form). */
function hasDNone(page, id) {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    return !!el && el.classList.contains('d-none');
  }, id);
}

/** Fuerza el estado de un checkbox y dispara 'change' para activar los listeners. */
function setChecked(page, id, checked) {
  return page.evaluate(({ elId, val }) => {
    const el = document.getElementById(elId);
    el.checked = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { elId: id, val: checked });
}

test.describe('Quote information — campos owner/lead guest/contacto (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD || !QUOTE_ID, 'Faltan E2E_EMAIL / E2E_PASSWORD / E2E_QUOTE_ID');
  test.setTimeout(120_000);

  test('render, toggle y guardado de las variantes de campos', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (!isIgnoredPageError(err.message)) pageErrors.push(err.message);
    });

    // --- Login ---
    await page.goto('/login');
    await page.fill('#identifier', EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);

    // --- Abrir la Información de la cotización ---
    await page.goto(`/dashboard/admin/quotes/${QUOTE_ID}`, { waitUntil: 'domcontentloaded' });

    // Esperar a que el form cargue y el propietario esté disponible (window.__quoteOwner).
    // 'attached' (no 'visible'): en agencia el Lead Guest manual arranca oculto ("es cliente final").
    await page.waitForSelector('#leadGuestFirstName', { state: 'attached', timeout: 25_000 });
    await page.waitForFunction(() => !!window.__quoteOwner, { timeout: 25_000 });

    // 1. Elementos nuevos presentes.
    await expect(page.locator('#saveLeadGuestAsClient')).toHaveCount(1);
    await expect(page.locator('#contactDifferentFromOwner')).toHaveCount(1);
    await expect(page.locator('#contactOwnerSummary')).toHaveCount(1);
    await expect(page.locator('#contactFieldsWrapper')).toHaveCount(1);
    await expect(page.locator('#leadGuestIsFinalClient')).toHaveCount(1);
    await expect(page.locator('#leadGuestManualFields')).toHaveCount(1);
    // El botón "Crear Cliente" del Cliente Final se ocultó: el alta se hace inline desde el
    // combobox (escribir nombre nuevo + "guardar como cliente").
    await expect(page.locator('#createFinalClientBtn')).toHaveCount(0);
    // Comboboxes de Cliente Final y Lead Guest (elegir de agencia o crear nuevo).
    await expect(page.locator('#clientFinalId')).toHaveCount(1);
    await expect(page.locator('#leadGuestClientId')).toHaveCount(1);
    // Chips del filtro de categorías (existen en el DOM aunque el modo sea agencia).
    await expect(page.locator('.cat-chip')).toHaveCount(5);

    // Semántica del checkbox (INVERTIDA): contactDifferentFromOwner marcado = "el contacto es
    // el propietario"; desmarcado (default) = el contacto es el Lead Guest.

    // 2. Estado inicial: por defecto contacto = Lead Guest → campos visibles, resumen oculto.
    const initIsOwner = await page.isChecked('#contactDifferentFromOwner');
    expect(await hasDNone(page, 'contactFieldsWrapper'), 'wrapper d-none == es-propietario').toBe(initIsOwner);
    expect(await hasDNone(page, 'contactOwnerSummary'), 'resumen d-none == !es-propietario').toBe(!initIsOwner);

    // 3. Marcar "es propietario" → campos ocultos, resumen visible y poblado.
    await setChecked(page, 'contactDifferentFromOwner', true);
    expect(await hasDNone(page, 'contactFieldsWrapper')).toBe(true);
    expect(await hasDNone(page, 'contactOwnerSummary')).toBe(false);
    const summaryText = await page.locator('#contactOwnerSummaryText').innerText();
    expect(summaryText.trim(), 'resumen del propietario poblado').not.toMatch(/^(—|)$/);

    // 4. Desmarcar → contacto = Lead Guest: campos visibles, resumen oculto.
    await setChecked(page, 'contactDifferentFromOwner', false);
    expect(await hasDNone(page, 'contactFieldsWrapper')).toBe(false);
    expect(await hasDNone(page, 'contactOwnerSummary')).toBe(true);

    // Sin errores de página hasta aquí (antes de guardar, que redirige).
    expect(pageErrors, `errores de página: ${pageErrors.join(' | ')}`).toEqual([]);

    // 5. Guardado con "es propietario" marcado → contacto = propietario; + guardar lead guest.
    const stamp = Date.now();
    const owner = await page.evaluate(() => window.__quoteOwner);
    // Desmarcar "El Lead Guest es el cliente final" para capturar un Lead Guest propio.
    await setChecked(page, 'leadGuestIsFinalClient', false);
    // El Lead Guest ahora es un combobox en modo agencia (inputs de nombre ocultos). Escribimos un
    // nombre nuevo vía su API typed (dispara customselect:create → llena leadGuestFirstName/LastName);
    // en modo directo, los inputs de nombre son visibles y se llenan directo.
    await page.evaluate(({ first, last }) => {
      // Nombre: combobox en agencia (setTypedValue → firstName), input plano en directo.
      const comboRow = document.getElementById('leadGuestComboRow');
      const agency = comboRow && !comboRow.classList.contains('d-none');
      const el = document.getElementById('leadGuestClientId');
      if (agency && el && el.customSelect && el.customSelect.setTypedValue) {
        el.customSelect.setTypedValue(first);
      } else {
        const f = document.getElementById('leadGuestFirstName');
        if (f) { f.value = first; f.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      // Apellido: siempre en su campo.
      const l = document.getElementById('leadGuestLastName');
      if (l) { l.value = last; l.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { first: 'SmokeLead', last: `T${stamp}` });
    await setChecked(page, 'saveLeadGuestAsClient', true);
    await setChecked(page, 'contactDifferentFromOwner', true); // override: contacto = propietario

    const putP = page.waitForResponse(
      (r) => r.url().includes(`/api/quotes/${QUOTE_ID}`) && r.request().method() === 'PUT',
      { timeout: 25_000 },
    );
    // El endpoint depende del modo: agencia (admin) → admin-create-subclient (agency_client de la
    // agencia); directo/otros → quick. Se acepta cualquiera de los dos.
    const ocP = page.waitForResponse(
      (r) => /\/api\/owned-clients\/(quick|admin-create-subclient)/.test(r.url())
        && r.request().method() === 'POST',
      { timeout: 25_000 },
    );
    await page.click('#createQuoteBtn');

    // PUT del quote: éxito + el payload copió el email del propietario al contacto.
    const putResp = await putP;
    const putJson = await putResp.json();
    expect(putJson.success, 'PUT quote success').toBeTruthy();
    const sent = JSON.parse(putResp.request().postData() || '{}');
    if (owner && owner.email) {
      expect(sent.contactEmail, 'contactEmail = email del propietario').toBe(owner.email);
    }

    // POST owned-clients: se creó el cliente del lead guest. En modo agencia, además, debe ir con
    // enterpriseId (la agencia) al endpoint admin-create-subclient.
    const ocResp = await ocP;
    const ocJson = await ocResp.json();
    expect(ocJson.success, 'lead guest guardado como cliente').toBeTruthy();
    if (ocResp.url().includes('admin-create-subclient')) {
      const ocSent = JSON.parse(ocResp.request().postData() || '{}');
      expect(ocSent.enterpriseId, 'agencia: enterpriseId presente').toBeTruthy();
    }
  });
});
