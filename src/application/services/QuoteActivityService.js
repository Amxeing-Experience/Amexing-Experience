/**
 * QuoteActivityService - Registra y lista eventos del timeline de actividades de una
 * cotización (Fase A). Los flujos clave llaman a `log(...)` para dejar un evento legible;
 * la UI llama a `list(...)` para pintar el timeline.
 *
 * Diseño defensivo: `log` NUNCA lanza (un fallo de logging no debe romper el flujo real).
 *
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const QuoteActivity = require('../../domain/models/QuoteActivity');

/**
 * Nombre legible de un usuario Parse (firstName lastName → email → username).
 * @param {Parse.Object} user - AmexingUser.
 * @returns {string} Nombre para mostrar.
 * @example displayName(currentUser)
 */
function displayName(user) {
  if (!user || typeof user.get !== 'function') return 'Alguien';
  const fn = user.get('firstName');
  const ln = user.get('lastName');
  const full = `${fn || ''} ${ln || ''}`.trim();
  return full || user.get('email') || user.get('username') || 'Alguien';
}

const QuoteActivityService = {
  /**
   * Registra un evento del timeline. Nunca lanza.
   * @param {object} params - Datos del evento.
   * @param {string} params.quoteId - objectId de la cotización.
   * @param {Parse.Object} [params.actor] - Usuario que hizo la acción (AmexingUser).
   * @param {string} [params.actorRole] - Rol del actor (admin/department_manager/...).
   * @param {string} params.action - Acción (QuoteActivity.ACTIONS).
   * @param {string} params.summary - Texto legible ya redactado (es-MX).
   * @param {object} [params.meta] - Contexto opcional (ids, día, tipo, etc.).
   * @returns {Promise<void>} No retorna nada relevante.
   * @example
   *   await QuoteActivityService.log({ quoteId, actor, actorRole, action: 'service_added', summary: "agregó 'X' al Día 1" });
   */
  async log({
    quoteId, actor, actorRole, action, summary, meta,
  }) {
    try {
      if (!quoteId || !action || !summary) return;
      const a = new QuoteActivity();
      a.set('active', true);
      a.set('exists', true);
      a.set('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
      if (actor && actor.id) {
        a.set('actor', { __type: 'Pointer', className: 'AmexingUser', objectId: actor.id });
      }
      a.set('actorName', displayName(actor));
      a.set('actorRole', actorRole || (actor && actor.get ? actor.get('role') : '') || '');
      a.set('action', action);
      a.set('summary', String(summary).slice(0, 500));
      if (meta && typeof meta === 'object') a.set('meta', meta);
      await a.save(null, { useMasterKey: true });
    } catch (err) {
      logger.warn('QuoteActivityService.log failed', { error: err.message, quoteId, action });
    }
  },

  /**
   * Registra varios eventos (secuencial, tolerante a fallos).
   * @param {Array<object>} events - Lista de params de `log`.
   * @returns {Promise<void>} No retorna nada relevante.
   * @example
   *   await QuoteActivityService.logMany([{ quoteId, action, summary }, ...]);
   */
  async logMany(events) {
    for (const ev of (events || [])) {
      // eslint-disable-next-line no-await-in-loop
      await this.log(ev);
    }
  },

  /**
   * Lista los eventos del timeline de una cotización (más recientes primero).
   * @param {string} quoteId - objectId de la cotización.
   * @param {number} [limit] - Máximo de eventos (default 500).
   * @returns {Promise<Array<object>>} Eventos serializados.
   * @example
   *   const items = await QuoteActivityService.list(quoteId);
   */
  async list(quoteId, limit = 500) {
    const q = new Parse.Query('QuoteActivity');
    q.equalTo('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
    q.equalTo('exists', true);
    q.descending('createdAt');
    q.limit(limit);
    const rows = await q.find({ useMasterKey: true });
    return rows.map((r) => r.toDisplayJSON());
  },
};

module.exports = QuoteActivityService;
