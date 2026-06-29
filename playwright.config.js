// Playwright config — smoke E2E para el dashboard (separado de Jest).
// Corre contra un servidor YA levantado (no lanza el server). Configura el target
// y credenciales por variables de entorno (ver tests/e2e/README.md):
//   E2E_BASE_URL   (default http://localhost:1337)
//   E2E_EMAIL / E2E_PASSWORD   (cuenta de prueba NO productiva)
//   E2E_QUOTE_ID   (id de una cotización para abrir la sección Servicios)
//   E2E_ROLE       (admin | department_manager | client; default admin)
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:1337',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
