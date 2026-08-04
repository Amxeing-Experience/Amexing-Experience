/**
 * El JS de navegador de las vistas de detalle vive incrustado en un <script> del EJS, así que ni el
 * ESLint del repo (que mira src/**\/*.js) ni los tests de render lo revisan: esos comprueban el HTML
 * que sale del servidor, no si el script se sostiene al ejecutarse en el navegador.
 *
 * El hueco es real y ya se cobró piezas: al retirar una función se quedó una llamada suya viva y la
 * página moría con "ahorroMasBarato is not defined" al cargar; end_client llamaba a
 * formatThousandsInput sin haberla definido nunca; y client/department_manager asignaban
 * pendingAddForm, que vive dentro del módulo paymentForm.js y desde fuera no se toca.
 *
 * Este test le pasa la regla no-undef de ESLint a ese script, con los globales del navegador y los
 * del proyecto declarados. Es barato y caza justo la clase de fallo que el resto no ve.
 */
const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');
const globals = require('globals');

const VISTAS = ['admin', 'client', 'department_manager', 'end_client'];
const RAIZ = path.join(__dirname, '../../../../../src/presentation/views/dashboards');

// Lo que la página trae por fuera del <script>: módulos compartidos servidos como <script src>,
// utilidades globales del layout y librerías de terceros.
const GLOBALES_DEL_PROYECTO = {
  bootstrap: 'readonly',
  html2pdf: 'readonly',
  PaymentBreakdownHelpers: 'readonly',
  ServiceListHelpers: 'readonly',
  ServiceListRenderer: 'readonly',
  FinancialSummary: 'readonly',
  PaymentsPanel: 'readonly',
  PaymentForm: 'readonly',
  ItineraryExport: 'readonly',
  pmToast: 'readonly',
  pmConfirm: 'readonly',
  pmEsc: 'readonly',
  copyToClipboard: 'readonly',
  openReservationCancelModalWithData: 'readonly',
  getQuoteStatusBadge: 'readonly',
  getReservationOverallStatusBadge: 'readonly',
  getReservationStatusBadge: 'readonly',
  formatCurrency: 'readonly',
  formatDate: 'readonly',
};

/**
 * Identificadores usados sin declarar en el JS de navegador de una vista.
 * @param {string} archivo - Ruta de la plantilla EJS.
 * @returns {string[]} Mensajes de no-undef, vacío si está limpio.
 * @example
 * sueltos('/ruta/booking-detail.ejs')
 */
function sueltos(archivo) {
  const texto = fs.readFileSync(archivo, 'utf8');
  const bloques = [...texto.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const linter = new Linter({ configType: 'flat' });
  const fallos = [];
  for (const js of bloques) {
    // Los <% %> del servidor no son JS de navegador: se neutralizan para que el parser vea código válido.
    const limpio = js.replace(/<%[-=]?([\s\S]*?)%>/g, 'null');
    const mensajes = linter.verify(limpio, {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'script',
        globals: { ...globals.browser, ...GLOBALES_DEL_PROYECTO },
      },
      rules: { 'no-undef': 'error' },
    });
    for (const m of mensajes) fallos.push(`linea ${m.line}: ${m.message}`);
  }
  return fallos;
}

describe('JS de navegador de los detalles de reservación', () => {
  it.each(VISTAS)('%s: no llama a nada que no esté definido', (vista) => {
    expect(sueltos(path.join(RAIZ, vista, 'booking-detail.ejs'))).toEqual([]);
  });

  // Comprobación del propio test: si dejara de detectar, pasaría en verde sin revisar nada.
  it('detecta una llamada huérfana cuando la hay', () => {
    const linter = new Linter({ configType: 'flat' });
    const mensajes = linter.verify('funcionQueNoExiste();', {
      languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
      rules: { 'no-undef': 'error' },
    });
    expect(mensajes.map((m) => m.message)).toContain("'funcionQueNoExiste' is not defined.");
  });
});
