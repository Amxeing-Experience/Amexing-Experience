/**
 * safeReturnTo — unit test (función pura, sin DB).
 *
 * El valor de "volver a donde estaba" viene SIEMPRE del usuario: el middleware lo pone en
 * `/login?returnTo=...`, la vista lo escribe en un campo oculto y el navegador lo devuelve en el
 * POST. De ahí va directo a `res.redirect()`, así que sin filtro es un redirect abierto: el usuario
 * termina fuera del sitio justo después de autenticarse, que es cuando más confía en lo que ve.
 *
 * Estos casos documentan qué se acepta y, sobre todo, qué NO — incluidas las formas que parecen
 * rutas internas pero el navegador resuelve como otro host.
 */

const { safeReturnTo } = require('../../../src/application/utils/safeReturnTo');

describe('safeReturnTo', () => {
  it('acepta rutas internas, conservando query y fragmento', () => {
    expect(safeReturnTo('/dashboard/admin')).toBe('/dashboard/admin');
    expect(safeReturnTo('/dashboard/admin/quotes/oFUavTrYfh?section=summary&context=reservation'))
      .toBe('/dashboard/admin/quotes/oFUavTrYfh?section=summary&context=reservation');
    expect(safeReturnTo('/dashboard/admin#totales')).toBe('/dashboard/admin#totales');
  });

  it('rechaza URLs absolutas', () => {
    expect(safeReturnTo('https://evil.com')).toBeNull();
    expect(safeReturnTo('http://evil.com/x')).toBeNull();
    expect(safeReturnTo('javascript:alert(1)')).toBeNull();
  });

  it('rechaza las que PARECEN internas pero salen del sitio', () => {
    // El caso que rompe el check ingenuo de "empieza con /": el navegador lo lee como
    // protocol-relative y va a evil.com.
    expect(safeReturnTo('//evil.com')).toBeNull();
    expect(safeReturnTo('//evil.com/dashboard/admin')).toBeNull();
    // Variante con backslash, que algunos navegadores normalizan a //.
    expect(safeReturnTo('/\\evil.com')).toBeNull();
  });

  it('rechaza rutas de autenticación, que dejarían al usuario en bucle', () => {
    expect(safeReturnTo('/login')).toBeNull();
    expect(safeReturnTo('/login?returnTo=/x')).toBeNull();
    expect(safeReturnTo('/auth/login')).toBeNull();
    expect(safeReturnTo('/logout')).toBeNull();
    // Pero una ruta que sólo EMPIEZA parecido sí es válida.
    expect(safeReturnTo('/loginhistory')).toBe('/loginhistory');
  });

  it('rechaza saltos de línea (inyección de cabeceras en el Location)', () => {
    expect(safeReturnTo('/dashboard\r\nSet-Cookie: a=b')).toBeNull();
    expect(safeReturnTo('/dashboard\nX-Injected: 1')).toBeNull();
  });

  it('rechaza vacíos y tipos que no son string', () => {
    expect(safeReturnTo('')).toBeNull();
    expect(safeReturnTo('   ')).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(123)).toBeNull();
    expect(safeReturnTo(['/dashboard'])).toBeNull();
    // Un query repetido (?returnTo=a&returnTo=b) llega como array en Express: debe caer, no romper.
    expect(safeReturnTo({ toString: () => '/dashboard' })).toBeNull();
  });

  it('rechaza rutas relativas sin barra inicial', () => {
    expect(safeReturnTo('dashboard/admin')).toBeNull();
    expect(safeReturnTo('../admin')).toBeNull();
  });
});
