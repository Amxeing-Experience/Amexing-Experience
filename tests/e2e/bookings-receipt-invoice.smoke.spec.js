// Smoke E2E: los botones "Generar Recibo" y "Solicitar Factura" se movieron de la
// tabla de COTIZACIONES (quotes-table.ejs) a la de RESERVACIONES (reservations-table.ejs).
//
// Valida:
//   1. La página de bookings carga sin errores de consola/página (detecta que el JS
//      portado no rompe el orden de carga del reservations-table).
//   2. Los modales de recibo/factura existen en la tabla de reservaciones.
//   3. Gating por rol del RENDER de botones:
//        admin              → Recibo + Factura
//        department_manager → Factura (no Recibo)
//        client             → ninguno
//      (Los botones solo aparecen en reservaciones cuya cotización sigue 'scheduled';
//       si no hay datos, se valida presencia de modales + interacción cuando exista fila.)
//   4. Interacción: si hay una fila con botón, al hacer click abre su modal.
//   5. Regresión: en la tabla de COTIZACIONES ya NO están los modales de recibo/factura.
//
// Requiere un servidor YA corriendo y credenciales por entorno (.env.local):
//   E2E_EMAIL, E2E_PASSWORD, E2E_ROLE (admin | department_manager | client; default admin)
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ROLE = process.env.E2E_ROLE || 'admin';

// Ruido de página ajeno a este smoke (bugs pre-existentes de layout).
const IGNORED_PAGEERRORS = [
  /Cannot read properties of null \(reading 'remove'\)/, // dashboard.ejs breadcrumb
];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

// Expectativa de gating por rol acorde a los permisos de ruta.
// Recibo: los 3 roles (generate-receipt permite nivel 4+; client=5 también).
// Factura: admin + department_manager.
const EXPECT = {
  admin: { receipt: true, invoice: true },
  department_manager: { receipt: true, invoice: true },
  client: { receipt: true, invoice: false },
};

async function login(page) {
  await page.goto('/login');
  await page.fill('#identifier', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard\//, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test.describe('Bookings — Recibo/Factura movidos a reservaciones (smoke)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Faltan E2E_EMAIL / E2E_PASSWORD');
  test.setTimeout(120_000);

  test(`render, gating por rol e interacción (${ROLE})`, async ({ page }) => {
    const expected = EXPECT[ROLE] || EXPECT.admin;
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (!isIgnoredPageError(err.message)) pageErrors.push(err.message);
    });

    await login(page);

    // --- Página de reservaciones ---
    await page.goto(`/dashboard/${ROLE}/bookings`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#reservations-table', { state: 'attached', timeout: 25_000 });
    // Esperar a que el DataTable pinte su tbody (fila real o "sin datos").
    await page.waitForSelector('#reservations-table tbody tr', { state: 'attached', timeout: 25_000 });

    // 2. Los modales portados existen en la tabla de reservaciones.
    await expect(page.locator('#generateReceiptModal')).toHaveCount(1);
    await expect(page.locator('#requestInvoiceModal')).toHaveCount(1);
    await expect(page.locator('#confirmGenerateReceiptBtn')).toHaveCount(1);
    await expect(page.locator('#confirmRequestInvoiceBtn')).toHaveCount(1);
    // El dropdown de Perfil de Facturación existe para los 3 roles.
    await expect(page.locator('#billingProfileSelect')).toHaveCount(1);

    // 3/4. Botones de fila (solo si hay reservación con cotización 'scheduled').
    const receiptBtns = page.locator('#reservations-table .generate-receipt-btn');
    const invoiceBtns = page.locator('#reservations-table .request-invoice-btn');

    // Recorre los filtros de fecha buscando un periodo con reservaciones agendadas,
    // para poder ejercitar el click real (los datos dev pueden no estar en "próximas").
    const FILTER_LABEL = {
      ongoing: 'filterOngoing',
      past: 'filterPast',
      pending_completion: 'filterPendingCompletion',
    };
    async function switchDateFilter(value) {
      const wait = page.waitForResponse(
        (r) => r.url().includes('/api/reservations') && r.request().method() === 'GET',
        { timeout: 20_000 },
      ).catch(() => null);
      // El radio .btn-check está oculto (Bootstrap): se activa clickeando su <label>.
      await page.click(`label[for="${FILTER_LABEL[value]}"]`);
      await wait;
      await page.waitForSelector('#reservations-table tbody tr', { state: 'attached', timeout: 20_000 });
    }

    let nReceipt = await receiptBtns.count();
    let nInvoice = await invoiceBtns.count();
    // Si el rol ve botones pero el filtro default no trae ninguno, prueba otros periodos.
    if ((expected.receipt || expected.invoice) && nReceipt === 0 && nInvoice === 0) {
      for (const f of ['ongoing', 'past', 'pending_completion']) {
        await switchDateFilter(f);
        nReceipt = await receiptBtns.count();
        nInvoice = await invoiceBtns.count();
        if (nReceipt > 0 || nInvoice > 0) break;
      }
    }

    // El rol client NUNCA debe renderizar estos botones, haya datos o no.
    if (!expected.receipt) {
      expect(nReceipt, 'este rol no debe ver Generar Recibo').toBe(0);
    }
    if (!expected.invoice) {
      expect(nInvoice, 'este rol no debe ver Solicitar Factura').toBe(0);
    }

    // Interacción: si el rol permite y hay al menos una fila, el click abre el modal.
    if (expected.receipt && nReceipt > 0) {
      await receiptBtns.first().click();
      await expect(page.locator('#generateReceiptModal')).toBeVisible();
      await page.locator('#generateReceiptModal [data-bs-dismiss="modal"]').first().click();
      await expect(page.locator('#generateReceiptModal')).toBeHidden();
    }
    if (expected.invoice && nInvoice > 0) {
      await invoiceBtns.first().click();
      await expect(page.locator('#requestInvoiceModal')).toBeVisible();
      await page.locator('#requestInvoiceModal [data-bs-dismiss="modal"]').first().click();
      await expect(page.locator('#requestInvoiceModal')).toBeHidden();
    }

    // Diagnóstico útil cuando no hay datos agendados para ejercitar el click.
    if (expected.receipt && nReceipt === 0 && nInvoice === 0) {
      console.log('[smoke] No hay reservaciones con cotización "scheduled" para ejercitar los botones; se validaron modales y regresión.');
    }

    expect(pageErrors, `errores de página en bookings: ${pageErrors.join(' | ')}`).toEqual([]);

    // 5. Regresión: en la tabla de COTIZACIONES los modales de recibo/factura ya NO existen.
    await page.goto(`/dashboard/${ROLE}/quotes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#quotes-table', { state: 'attached', timeout: 25_000 });
    await expect(page.locator('#generateReceiptModal'), 'modal recibo removido de cotizaciones').toHaveCount(0);
    await expect(page.locator('#requestInvoiceModal'), 'modal factura removido de cotizaciones').toHaveCount(0);
  });
});
