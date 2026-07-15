/**
 * QuoteActivity - Timeline de actividades legible de una cotización (Fase A).
 *
 * A diferencia de QuoteEdit (versionado + diffs técnicos), esto es un log de eventos
 * pensado para humanos: cada registro guarda un `summary` ya redactado en español
 * ("agregó 'Transporte – Aeropuerto' al Día 2", "aprobó la solicitud de borrado de X").
 * Alimenta un timeline read-only que ven admin y owner/agencia.
 *
 * Los eventos los emite QuoteActivityService desde los flujos clave (servicios, estado,
 * solicitudes de cambio). Se puede ampliar en Fase B (conversión, cancelación, ownership).
 *
 * @augments BaseModel
 * @author Denisse Maldonado
 * @example
 *   const a = new QuoteActivity();
 *   a.set('quote', quotePtr);
 *   a.set('action', 'service_added');
 *   a.set('summary', "agregó 'Tour Nocturno' al Día 1");
 *   await a.save(null, { useMasterKey: true });
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * QuoteActivity class.
 * @class QuoteActivity
 * @augments BaseModel
 */
class QuoteActivity extends BaseModel {
  /**
   * Create a QuoteActivity instance.
   * @example
   * const a = new QuoteActivity();
   */
  constructor() {
    super('QuoteActivity');
  }

  /**
   * Acciones soportadas (Fase A). Ampliable en Fase B.
   * @returns {object} Mapa de acciones.
   * @example QuoteActivity.ACTIONS.SERVICE_ADDED
   */
  static get ACTIONS() {
    return {
      SERVICE_ADDED: 'service_added',
      SERVICE_EDITED: 'service_edited',
      SERVICE_REMOVED: 'service_removed',
      STATUS_CHANGED: 'status_changed',
      CHANGE_REQUESTED: 'change_requested',
      CHANGE_APPROVED: 'change_approved',
      CHANGE_REJECTED: 'change_rejected',
    };
  }

  /**
   * Serializa la actividad a un objeto plano para la API/UI.
   * @returns {object} Datos de la actividad.
   * @example activity.toDisplayJSON();
   */
  toDisplayJSON() {
    return {
      id: this.id,
      action: this.get('action') || '',
      summary: this.get('summary') || '',
      actorId: this.get('actor') ? this.get('actor').id : null,
      actorName: this.get('actorName') || '',
      actorRole: this.get('actorRole') || '',
      meta: this.get('meta') || null,
      createdAt: this.get('createdAt') || null,
    };
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('QuoteActivity', QuoteActivity);

module.exports = QuoteActivity;
