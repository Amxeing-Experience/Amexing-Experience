/**
 * ReservationCancellationNotifier - Envía el correo de cancelación de reservación al
 * propietario (owner) de la cotización. Usado por los dos flujos que cancelan una
 * reservación: la cancelación directa (ReservationController.cancelReservation) y la
 * aprobación de una solicitud (CancellationRequestsController.cascadeCancelReservation).
 *
 * El destinatario real es el owner de la cotización; en development EmailService lo
 * redirige a un correo de pruebas (ver EmailService.sendReservationCancellation).
 *
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const emailService = require('./EmailService');

/**
 * Resuelve el owner de la cotización y envía el correo de cancelación. Nunca lanza:
 * cualquier error se registra y se ignora para no romper el flujo de cancelación.
 * @param {object} params - Parámetros.
 * @param {Parse.Object} params.quote - Cotización (Quote) ligada a la reservación.
 * @param {Parse.Object} params.reservation - Reservación cancelada.
 * @param {string} [params.reason] - Motivo de la cancelación.
 * @param {string} [params.cancellationType] - 'automatic' | 'admin' | 'approved'.
 * @returns {Promise<void>} No retorna nada relevante.
 * @example
 *   await notifyReservationCancellation({ quote, reservation, reason, cancellationType: 'admin' });
 */
async function notifyReservationCancellation({
  quote, reservation, reason, cancellationType,
}) {
  try {
    if (!quote) return;

    // Resolver owner (email + nombre) de la cotización.
    let ownerEmail = null;
    let ownerName = null;
    let ownerPtr = null;
    const ownerRef = quote.get('owner');
    if (ownerRef && ownerRef.id) {
      try {
        const ownerQuery = new Parse.Query('AmexingUser');
        const ownerObj = await ownerQuery.get(ownerRef.id, { useMasterKey: true });
        if (ownerObj) {
          ownerEmail = ownerObj.get('email') || null;
          const fn = ownerObj.get('firstName');
          const ln = ownerObj.get('lastName');
          ownerName = (fn || ln)
            ? `${fn || ''} ${ln || ''}`.trim()
            : (ownerObj.get('name') || ownerObj.get('username') || null);
          ownerPtr = { __type: 'Pointer', className: 'AmexingUser', objectId: ownerObj.id };
        }
      } catch (ownerErr) {
        logger.warn('notifyReservationCancellation: no se pudo cargar el owner', {
          error: ownerErr.message,
          ownerId: ownerRef.id,
        });
      }
    }

    const cancelledAt = new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

    await emailService.sendReservationCancellation({
      recipientEmail: ownerEmail,
      recipientName: ownerName,
      reservationFolio: reservation ? (reservation.get('folio') || reservation.id) : null,
      quoteFolio: quote.get('folio') || null,
      cancelledAt,
      reason: reason || null,
      cancellationType: cancellationType || 'automatic',
      recipientUser: ownerPtr,
    });
  } catch (err) {
    logger.error('notifyReservationCancellation failed', { error: err.message });
  }
}

module.exports = { notifyReservationCancellation };
