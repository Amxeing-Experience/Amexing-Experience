/**
 * Minimal in-process TTL cache for rarely-changing "current" values (rates/formulas).
 *
 * Estos valores (tipo de cambio, tarifas de traslado/agencia/driver/guía/greeter y sus
 * fórmulas) cambian muy poco pero se consultan en CADA carga de la vista de cotización, y cada
 * consulta a Parse/Mongo tarda 1-3 s. Cachearlos en memoria evita re-consultar en cada request.
 *
 * Single-instance: la invalidación (clear) es completa. Multi-instance (cluster/PM2): cada
 * proceso tiene su propio caché, con consistencia eventual dentro del TTL — aceptable para datos
 * que cambian rara vez. Invalida siempre tras un write (create/update) del dato cacheado.
 *
 * Created by Denisse Maldonado.
 */
class TtlCache {
  /**
   * @param {number} [ttlMs] - Tiempo de vida en ms (default 15 min).
   */
  constructor(ttlMs = 15 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.entry = null; // { value, expires }
  }

  /**
   * Devuelve el valor cacheado si sigue fresco, o `undefined` si expiró/no existe.
   * @returns {*} Valor cacheado o undefined.
   */
  get() {
    if (this.entry && Date.now() < this.entry.expires) {
      return this.entry.value;
    }
    return undefined;
  }

  /**
   * Guarda un valor con el TTL configurado y lo devuelve (para encadenar).
   * @param {*} value - Valor a cachear.
   * @returns {*} El mismo valor.
   */
  set(value) {
    this.entry = { value, expires: Date.now() + this.ttlMs };
    return value;
  }

  /**
   * Limpia el valor cacheado. Llamar tras cualquier write del dato.
   * @returns {void}
   */
  clear() {
    this.entry = null;
  }
}

module.exports = { TtlCache };
