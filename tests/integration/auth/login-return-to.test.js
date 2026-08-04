/**
 * "Volver a donde estaba" tras iniciar sesión (returnTo) — integration.
 *
 * BUG: cuando la sesión expiraba, dashboardAuthMiddleware mandaba a
 * `/login?returnTo=<la url donde estaba>`, pero al iniciar sesión el usuario terminaba SIEMPRE en su
 * dashboard. La cadena estaba cortada en DOS puntos independientes, y arreglar solo uno no bastaba:
 *
 *   1. `authController.showLogin` renderizaba la vista sin pasar `returnTo`, así que
 *      `login.ejs` evaluaba `typeof returnTo !== 'undefined'` contra una variable que nunca llegaba.
 *      Como el campo oculto es condicional (`<% if (loginRedirectTo) %>`), NI SE RENDERIZABA.
 *   2. El formulario manda el campo como `redirectTo` (login-form.ejs, y el enlace de OAuth usa ese
 *      mismo nombre) pero el POST leía `req.body.returnTo`. Nombres distintos.
 *
 * SEGURIDAD: ese valor viene del usuario y termina en `res.redirect()`, así que sin filtro era un
 * redirect abierto — `/login?returnTo=https://evil.com` sacaba a la persona del sitio justo después
 * de autenticarse, que es cuando más confía en lo que ve. Se valida con utils/safeReturnTo, y se
 * valida en el REDIRECT y no solo al renderizar, porque el body del POST se puede fabricar a mano
 * sin pasar por la vista (ver el último caso).
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const app = require('../../../src/index');
const AuthTestHelper = require('../../helpers/authTestHelper');

const DEEP_URL = '/dashboard/admin/quotes/abc123?section=summary&context=reservation';

/**
 * Extrae el value del campo oculto que lleva el destino, o null si no se renderizó.
 *
 * Se desescapan las entidades porque EJS escapa el atributo (`&` sale como `&amp;`), que es lo
 * correcto: el navegador lo decodifica al leer el value y el POST viaja con la URL original. Sin
 * esto la comparación fallaría por el `&` de la query string, no por un problema real.
 * @param {string} html - HTML de la página de login.
 * @returns {string|null} El destino ya desescapado, o null cuando el campo no existe.
 * @example
 * hiddenRedirect('<input name="redirectTo" value="/a?x=1&amp;y=2">'); // '/a?x=1&y=2'
 */
function hiddenRedirect(html) {
  const m = /name="redirectTo"\s+value="([^"]*)"/.exec(html || '');
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Espera a que la app termine de montar sus rutas.
 *
 * `src/index.js` las registra dentro de `initI18n().then(...)` y no exporta ese promise, así que una
 * petición que llega antes recibe 404 en vez de la respuesta real — un falso rojo que aparece y
 * desaparece según lo que tarde el arranque. Se sondea /login, que se monta en el mismo bloque.
 * @returns {Promise<void>} Se resuelve cuando las rutas responden.
 */
async function waitForRoutes() {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).get('/login');
    if (res.status !== 404) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error('Las rutas de la app no quedaron montadas a tiempo');
}

describe('login: volver a donde estaba (returnTo)', () => {
  beforeAll(waitForRoutes);

  describe('la cadena completa', () => {
    it('una URL profunda sin sesión manda a /login conservando el destino', async () => {
      const res = await request(app).get(DEEP_URL);

      expect(res.status).toBe(302);
      const loc = res.headers.location || '';
      expect(loc.startsWith('/login?returnTo=')).toBe(true);
      // El destino viaja completo, con su query string.
      expect(decodeURIComponent(loc.replace('/login?returnTo=', ''))).toBe(DEEP_URL);
    });

    it('el formulario de login RENDERIZA el destino en su campo oculto (corte #1)', async () => {
      const res = await request(app).get(`/login?returnTo=${encodeURIComponent(DEEP_URL)}`);

      expect(res.status).toBe(200);
      // Antes del arreglo esto era null: showLogin no pasaba returnTo y el campo, al ser
      // condicional, no se pintaba.
      expect(hiddenRedirect(res.text)).toBe(DEEP_URL);
    });

    it('sin returnTo el campo no se renderiza (no estorba el caso normal)', async () => {
      const res = await request(app).get('/login');

      expect(res.status).toBe(200);
      expect(hiddenRedirect(res.text)).toBeNull();
    });
  });

  describe('el destino externo nunca sale del sitio', () => {
    it('un returnTo absoluto se descarta al renderizar', async () => {
      const res = await request(app)
        .get(`/login?returnTo=${encodeURIComponent('https://evil.com/phish')}`);

      expect(res.status).toBe(200);
      expect(hiddenRedirect(res.text)).toBeNull();
    });

    it('tampoco pasa //evil.com, que parece ruta interna pero es otro host', async () => {
      const res = await request(app).get(`/login?returnTo=${encodeURIComponent('//evil.com')}`);

      expect(res.status).toBe(200);
      expect(hiddenRedirect(res.text)).toBeNull();
    });
  });

  describe('el POST, que es donde de verdad importa', () => {
    const creds = AuthTestHelper.getCredentials('admin');

    const login = (redirectTo) => request(app)
      .post('/auth/login')
      .type('form')
      .send({ identifier: creds.email, password: creds.password, redirectTo });

    it('un destino interno se respeta y NO cae al dashboard (corte #2)', async () => {
      const res = await login(DEEP_URL);

      expect(res.status).toBe(302);
      // Antes del arreglo esto era '/dashboard/admin': el handler leía `returnTo` mientras el
      // formulario mandaba `redirectTo`.
      expect(res.headers.location).toBe(DEEP_URL);
    });

    it('un destino externo fabricado a mano en el body se ignora', async () => {
      // Se manda directo al endpoint, sin pasar por la vista: aunque el render lo hubiera
      // descartado, el body siempre lo puede fabricar cualquiera.
      const res = await login('https://evil.com/phish');

      const loc = res.headers.location || '';
      expect(loc).not.toContain('evil.com');
      expect(loc.startsWith('http')).toBe(false);
      expect(loc.startsWith('//')).toBe(false);
      // Cae al destino por defecto del rol.
      expect(loc).toBe('/dashboard/admin');
    });

    it('tampoco pasa //evil.com en el body', async () => {
      const res = await login('//evil.com/phish');

      expect(res.headers.location).toBe('/dashboard/admin');
    });
  });
});
