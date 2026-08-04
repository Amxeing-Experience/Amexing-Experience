/**
 * AgencyScope - Resuelve si un usuario pertenece a la agencia de otro.
 *
 * LA AGENCIA ES EL department_manager. No tiene clientId porque no apunta a nada: ella misma es el
 * destino (ver el comentario literal en ClientEmployeesController: "Department managers don't have
 * clientId - they ARE the client"). Cada agente que se da de alta bajo una agencia recibe
 * `clientId = <objectId del department_manager>` en el mismo controller, y ese controller ya autoriza
 * con esta misma comparación.
 *
 * Regla de negocio: una agencia puede ver y mover TODO lo de sus propios agentes. Un agente NO puede
 * hacerlo sobre lo de sus compañeros — su clientId apunta hacia arriba, nunca hacia los lados.
 *
 * Fuente única compartida a propósito: las cuatro guardas de colaboración y transferencia usaban un
 * allowlist por nombre de rol copiado cuatro veces, y las cuatro copias se desincronizaron. Si esta
 * comparación vive en un solo lugar, no puede volver a divergir.
 */

const Parse = require('parse/node');
const QuoteOwnership = require('../../domain/models/QuoteOwnership');
const logger = require('../../infrastructure/logger');

const AGENCY_ROLE = 'department_manager';

/**
 * Lee el clientId de un usuario (Parse object o plano), normalizado.
 * Devuelve null para vacíos, para que dos ausencias nunca se comparen como iguales.
 * @param {object} user - Usuario Parse o plano.
 * @returns {string|null} Valor normalizado o null.
 * @example
 * readClientId(agentUser); // 'AK6LUQ1GXT'
 */
function readClientId(user) {
  if (!user) return null;
  const raw = typeof user.get === 'function' ? user.get('clientId') : user.clientId;
  if (typeof raw !== 'string') return null;
  return raw.trim() || null;
}

/**
 * Devuelve el id de un usuario, tolerando Parse object y objeto plano.
 * @param {object} user - Usuario.
 * @returns {string|null} El objectId, o null si no se puede leer.
 * @example
 * userIdOf(managerUser); // 'AK6LUQ1GXT'
 */
function userIdOf(user) {
  if (!user) return null;
  const raw = user.id || (typeof user.get === 'function' ? user.get('objectId') : user.objectId);
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Id del dueño actual de una cotización, con el MISMO orden de resolución que QuoteOwnership.isOwner:
 * registro formal de propiedad, luego Quote.owner, luego el creador original. Si esos tres divergieran
 * de isOwner, un manager podría pasar por una puerta que el dueño real no reconoce.
 * @param {string} quoteId - Id de la cotización.
 * @returns {Promise<string|null>} Id del dueño o null si no se puede determinar.
 * @example
 * await resolveOwnerUserId('abc123'); // 'OxBVmiCHmC'
 */
async function resolveOwnerUserId(quoteId) {
  if (typeof quoteId !== 'string' || !quoteId.trim()) return null;

  const ownership = await QuoteOwnership.getCurrentOwnership(quoteId);
  if (ownership) {
    return ownership.getOwner()?.id || null;
  }

  const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
  return quote.get('owner')?.id || quote.get('createdBy')?.id || null;
}

/**
 * ¿El actor es la agencia dueña del agente al que pertenece esta cotización?
 *
 * Solo responde true para department_manager. Fail-safe: si algo no se puede determinar (usuario
 * borrado, clientId ausente, cotización sin dueño) devuelve false — en autorización, un criterio que
 * no se puede evaluar deniega, nunca concede.
 * @param {object} actorUser - Usuario que pide la acción.
 * @param {string} actorRole - Rol efectivo del actor.
 * @param {string} quoteId - Cotización sobre la que quiere actuar.
 * @returns {Promise<boolean>} True si el actor es la agencia dueña del agente.
 * @example
 * await isAgencyOwnerOfQuote(managerUser, 'department_manager', quoteId); // true
 */
async function isAgencyOwnerOfQuote(actorUser, actorRole, quoteId) {
  try {
    if (actorRole !== AGENCY_ROLE) return false;

    // La agencia se identifica por su PROPIO id, no por un clientId (que por diseño no tiene).
    const agencyId = userIdOf(actorUser);
    if (!agencyId) return false;

    const ownerId = await resolveOwnerUserId(quoteId);
    if (!ownerId) return false;

    // Su propia cotización. isOwner ya lo cubre; aquí es defensa, no la vía normal.
    if (ownerId === agencyId) return true;

    const ownerUser = await new Parse.Query('AmexingUser').get(ownerId, { useMasterKey: true });

    // Se compara SOLO contra clientId, nunca contra organizationId: en las agencias ese campo trae la
    // cadena genérica 'client' (una marca de tipo, no un identificador), así que dos cuentas distintas
    // lo comparten. Y nunca al revés (manager.clientId === agente.clientId): el clientId del manager es
    // null por diseño, y comparar dos nulls haría que dos agencias cualesquiera se creyeran la misma.
    const ownerAgencyId = readClientId(ownerUser);
    if (!ownerAgencyId) return false;

    return ownerAgencyId === agencyId;
  } catch (error) {
    logger.warn('No se pudo determinar la agencia de la cotización; se deniega', {
      quoteId,
      error: error.message,
    });
    return false;
  }
}

module.exports = {
  AGENCY_ROLE,
  isAgencyOwnerOfQuote,
  resolveOwnerUserId,
};
