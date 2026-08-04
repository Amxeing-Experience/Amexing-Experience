/**
 * safeReturnTo - Normaliza el destino de "volver a donde estaba" tras iniciar sesión.
 *
 * El valor llega SIEMPRE del usuario: el middleware lo pone en `/login?returnTo=...`, la vista lo
 * escribe en un campo oculto y el navegador lo devuelve en el POST. O sea que cualquiera puede
 * fabricarlo, y va directo a `res.redirect()`. Sin filtro, `/login?returnTo=https://evil.com` manda
 * al usuario fuera del sitio JUSTO después de autenticarse — el momento en que más confía en lo que
 * ve. Ese es el patrón de redirect abierto clásico para phishing de credenciales.
 *
 * Sólo se aceptan rutas internas: una barra inicial y nada que el navegador pueda interpretar como
 * otro host. Cualquier otra cosa devuelve null y el llamador usa su destino por defecto.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

// Rutas que no tiene sentido "recuperar": volverían a expulsar al usuario o lo dejarían en bucle.
const BLOCKED_PREFIXES = ['/login', '/logout', '/auth/login', '/auth/logout', '/register'];

/**
 * Devuelve la ruta interna a la que es seguro redirigir, o null si el valor no sirve.
 *
 * Se rechaza explícitamente lo que no sea string o no empiece con '/' (una URL absoluta como
 * `https://evil.com`); también `//evil.com` y `/\evil.com`, que el navegador resuelve como
 * protocol-relative —o sea OTRO host— aunque a simple vista parezcan rutas internas, y que son el
 * bypass habitual de un check ingenuo de "empieza con barra"; las rutas de autenticación, que
 * dejarían al usuario dando vueltas; y los saltos de línea, que permitirían inyectar cabeceras.
 * @param {*} candidate - Valor propuesto (query, body o sesión).
 * @returns {string|null} Ruta interna segura, o null.
 * @example
 * safeReturnTo('/dashboard/admin/quotes/abc?section=summary'); // la misma ruta
 * safeReturnTo('https://evil.com'); // null
 * safeReturnTo('//evil.com');       // null
 */
function safeReturnTo(candidate) {
  if (typeof candidate !== 'string') return null;

  const value = candidate.trim();
  if (!value || value[0] !== '/') return null;

  // `//host` y `/\host` salen del sitio pese a empezar con barra.
  if (value[1] === '/' || value[1] === '\\') return null;

  // CR/LF abrirían la puerta a inyección de cabeceras en el Location.
  if (/[\r\n]/.test(value)) return null;

  const path = value.split('?')[0].split('#')[0].toLowerCase();
  if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  return value;
}

module.exports = { safeReturnTo, BLOCKED_PREFIXES };
