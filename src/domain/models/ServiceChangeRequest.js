/**
 * ServiceChangeRequest - Historial de solicitudes de cambio sobre servicios bloqueados
 * por admin en una cotización (Fase 3 del bloqueo por-servicio).
 *
 * El owner (no-admin) solicita BORRAR o MODIFICAR un servicio que un admin agregó/editó
 * (adminLocked). El admin aprueba o rechaza. A diferencia del marcador inline en el
 * subconcepto, este registro NO se borra al resolverse: transiciona su status para que
 * quede el historial (y para el badge/contador del owner). Guarda un snapshot del nombre
 * del servicio para sobrevivir si el servicio se elimina.
 *
 * Pensado para poder alimentar, más adelante, un timeline de actividades de la cotización.
 *
 * @augments BaseModel
 * @author Denisse Maldonado
 * @example
 *   const r = new ServiceChangeRequest();
 *   r.set('quote', quotePtr);
 *   r.set('serviceId', 'service_17');
 *   r.set('type', 'delete');
 *   await r.save(null, { useMasterKey: true });
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * ServiceChangeRequest class.
 * @class ServiceChangeRequest
 * @augments BaseModel
 */
class ServiceChangeRequest extends BaseModel {
  /**
   * Create a ServiceChangeRequest instance.
   * @example
   * const r = new ServiceChangeRequest();
   */
  constructor() {
    super('ServiceChangeRequest');
  }

  /**
   * Tipos de solicitud.
   * @returns {object} { DELETE, MODIFY }.
   * @example ServiceChangeRequest.TYPES.DELETE
   */
  static get TYPES() {
    return { DELETE: 'delete', MODIFY: 'modify' };
  }

  /**
   * Estados de la solicitud.
   * @returns {object} { PENDING, APPROVED, REJECTED }.
   * @example ServiceChangeRequest.STATUS.PENDING
   */
  static get STATUS() {
    return { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
  }

  /**
   * Serializa la solicitud a un objeto plano para la API/UI.
   * @returns {object} Datos de la solicitud.
   * @example request.toJSON();
   */
  toDisplayJSON() {
    return {
      id: this.id,
      serviceId: this.get('serviceId') || null,
      serviceLabel: this.get('serviceLabel') || '',
      type: this.get('type') || 'modify',
      note: this.get('note') || '',
      status: this.get('status') || 'pending',
      requestedById: this.get('requestedBy') ? this.get('requestedBy').id : null,
      requestedByName: this.get('requestedByName') || '',
      requestedAt: this.get('requestedAt') || this.get('createdAt') || null,
      reviewedById: this.get('reviewedBy') ? this.get('reviewedBy').id : null,
      reviewedByName: this.get('reviewedByName') || '',
      reviewedAt: this.get('reviewedAt') || null,
      reviewNote: this.get('reviewNote') || '',
      serviceDeleted: this.get('serviceDeleted') === true,
      seenByRequester: this.get('seenByRequester') === true,
    };
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('ServiceChangeRequest', ServiceChangeRequest);

module.exports = ServiceChangeRequest;
