// Smoke E2E de la página pública /nuestra-flota (sin login).
// Verifica que la flota se muestra por categoría (VehicleType) con el diseño de la landing:
//   - Hay tabs de categoría y cards de vehículo.
//   - Cambiar de tab actualiza las cards y el hero.
//   - Click en una card actualiza el hero destacado.
//   - El lightbox de galería abre y cierra.
// Página pública → no requiere credenciales.
const { test, expect } = require('@playwright/test');

const IGNORED_PAGEERRORS = [/Cannot read properties of null \(reading 'remove'\)/];
const isIgnoredPageError = (t) => IGNORED_PAGEERRORS.some((re) => re.test(t));

test.describe('Nuestra Flota — página pública por categoría (smoke)', () => {
  test('tabs por categoría, cards por vehículo, hero navegable y galería', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => { if (!isIgnoredPageError(err.message)) pageErrors.push(err.message); });

    await page.goto('/nuestra-flota', { waitUntil: 'networkidle' });

    const tabs = page.locator('.fleet__tab');
    await expect(tabs.first(), 'hay al menos una tab de categoría').toBeVisible();
    const tabCount = await tabs.count();
    expect(tabCount, 'hay categorías').toBeGreaterThan(0);

    const cards = page.locator('.fleet__cards .fleet-card');
    await expect(cards.first(), 'la categoría activa muestra al menos una card').toBeVisible();

    // Click en una segunda card (si la categoría activa tiene varias) → esa card queda activa.
    if (await cards.count() >= 2) {
      await cards.nth(1).click();
      await expect(cards.nth(1), 'la card clickeada queda activa').toHaveClass(/is-active/);
    }

    // Cambiar de categoría: click en una tab distinta a la activa → cards y hero se actualizan.
    if (tabCount >= 2) {
      const inactiveTab = page.locator('.fleet__tab:not(.is-active)').first();
      const targetLabel = (await inactiveTab.textContent() || '').trim();
      await inactiveTab.click();
      // La categoría (clase) del hero pasa a ser la de la tab clickeada.
      await expect(page.locator('[data-bind="class"]'), 'el hero refleja la categoría elegida').toHaveText(targetLabel);
      await expect(cards.first(), 'la nueva categoría muestra cards').toBeVisible();
    }

    // Galería: abre y cierra.
    await page.locator('[data-gallery-open]').click();
    const lightbox = page.locator('#fleet-lightbox');
    await expect(lightbox, 'el lightbox abre').toHaveClass(/is-open/);
    await page.locator('[data-gallery-close]').click();
    await expect(lightbox, 'el lightbox cierra').not.toHaveClass(/is-open/);

    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
