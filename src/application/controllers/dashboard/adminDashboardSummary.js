const Parse = require('parse/node');
const { getDashboardSummary } = require('./dashboardSummary');
const PartnerRequestService = require('../../services/PartnerRequestService');
const logger = require('../../../infrastructure/logger');

/** Categorías de clientCategory que cuentan como "cliente directo" (no agency_client). */
const DIRECT_CLIENT_CATEGORIES = ['direct_client', 'wedding_planner', 'concierge', 'home_owner'];

/** Etiquetas en español para el estatus de las cotizaciones. */
const QUOTE_STATUS_LABELS = {
  quoted: 'Cotizado',
  requested: 'Solicitado',
  hold: 'Agendado',
  scheduled: 'Confirmado',
  rejected: 'Rechazado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

/**
 * Formatea una fecha como texto corto en español (ej. "5 mar 2026").
 * @param {Date|string|number} value - Fecha a formatear.
 * @returns {string} Fecha formateada, o '' si no es válida.
 * @example
 * shortDate(new Date()); // "24 jul 2026"
 */
function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Devuelve un texto relativo aproximado ("hace 2 h", "hace 3 d") para una fecha pasada.
 * @param {Date|string|number} value - Fecha de referencia.
 * @param {Date} now - Momento actual (inyectado para no usar Date.now en scripts/tests).
 * @returns {string} Texto relativo, o '' si no es válida.
 * @example
 * timeAgo(hace2h, new Date()); // "hace 2 h"
 */
function timeAgo(value, now) {
  if (!value) return '';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return shortDate(then);
}

/**
 * Cuenta agencias (department_manager), clientes directos (end_client no agency_client) y
 * solicitudes de colaborador pendientes. Cada conteo va aislado para que un fallo no rompa el resto.
 * @returns {Promise<object>} { agencies, directClients, pendingRequests }.
 * @example
 * const c = await getCounts();
 */
async function getCounts() {
  const counts = { agencies: 0, directClients: 0, pendingRequests: 0 };
  try {
    const q = new Parse.Query('AmexingUser');
    q.equalTo('role', 'department_manager');
    q.equalTo('exists', true);
    counts.agencies = await q.count({ useMasterKey: true });
  } catch (e) {
    logger.warn('Admin dashboard: fallo al contar agencias', { error: e.message });
  }
  try {
    const q = new Parse.Query('AmexingUser');
    q.equalTo('role', 'end_client');
    q.containedIn('clientCategory', DIRECT_CLIENT_CATEGORIES);
    q.equalTo('exists', true);
    counts.directClients = await q.count({ useMasterKey: true });
  } catch (e) {
    logger.warn('Admin dashboard: fallo al contar clientes directos', { error: e.message });
  }
  try {
    const res = await PartnerRequestService.listRequests({ status: 'pending', limit: 1 });
    counts.pendingRequests = res.pendingCount || 0;
  } catch (e) {
    logger.warn('Admin dashboard: fallo al contar solicitudes', { error: e.message });
  }
  return counts;
}

/**
 * Cotizaciones modificadas recientemente (por updatedAt), excluyendo las vacías (sin servicios).
 * @param {number} [limit] - Máximo de filas a devolver.
 * @returns {Promise<Array<object>>} Filas { id, folio, client, status, statusLabel, people, updated }.
 * @example
 * const rows = await getRecentQuotes(6);
 */
async function getRecentQuotes(limit = 6) {
  try {
    const q = new Parse.Query('Quote');
    q.equalTo('exists', true);
    q.notContainedIn('status', ['cancelled']);
    q.descending('updatedAt');
    q.limit(limit * 3); // margen para descartar vacías
    const objs = await q.find({ useMasterKey: true });
    const rows = [];
    objs.forEach((quote) => {
      if (rows.length >= limit) return;
      const si = quote.get('serviceItems');
      const services = si && Array.isArray(si.days)
        ? si.days.reduce((sum, day) => sum + (Array.isArray(day.subconcepts) ? day.subconcepts.length : 0), 0)
        : 0;
      if (services === 0) return; // cotización vacía
      const status = quote.get('status') || '';
      const clientName = typeof quote.get('client') === 'string' ? quote.get('client') : '';
      rows.push({
        id: quote.id,
        folio: quote.get('folio') || '',
        client: clientName || quote.get('eventType') || '—',
        status,
        statusLabel: QUOTE_STATUS_LABELS[status] || status || '—',
        people: quote.get('numberOfPeople') || 0,
        updated: shortDate(quote.get('updatedAt')),
      });
    });
    return rows;
  } catch (e) {
    logger.warn('Admin dashboard: fallo al traer cotizaciones recientes', { error: e.message });
    return [];
  }
}

/**
 * Próximas reservaciones (startDate de hoy en adelante, no canceladas), ordenadas por fecha.
 * @param {Date} now - Momento actual (inyectado).
 * @param {number} [limit] - Máximo de filas.
 * @returns {Promise<Array<object>>} Filas { id, folio, client, date, people }.
 * @example
 * const rows = await getUpcomingReservations(new Date(), 6);
 */
async function getUpcomingReservations(now, limit = 6) {
  try {
    const q = new Parse.Query('Reservation');
    q.equalTo('active', true);
    q.equalTo('exists', true);
    q.notEqualTo('status', 'cancelled');
    q.greaterThanOrEqualTo('startDate', now);
    q.ascending('startDate');
    q.limit(limit);
    const objs = await q.find({ useMasterKey: true });
    return objs.map((r) => {
      const leadGuest = `${r.get('leadGuestFirstName') || ''} ${r.get('leadGuestLastName') || ''}`.trim();
      const contactPerson = (r.get('contactPerson') || '').trim();
      return {
        id: r.id,
        folio: r.get('folio') || '',
        client: leadGuest || contactPerson || '—',
        date: shortDate(r.get('startDate')),
        people: r.get('numberOfPeople') || 0,
      };
    });
  } catch (e) {
    logger.warn('Admin dashboard: fallo al traer próximas reservaciones', { error: e.message });
    return [];
  }
}

/**
 * Actividad reciente del registro de auditoría (por timestamp desc).
 * @param {Date} now - Momento actual (para el texto relativo).
 * @param {number} [limit] - Máximo de filas.
 * @returns {Promise<Array<object>>} Filas { user, action, entity, entityName, ago }.
 * @example
 * const rows = await getRecentActivity(new Date(), 7);
 */
async function getRecentActivity(now, limit = 7) {
  try {
    const q = new Parse.Query('AuditLog');
    q.notEqualTo('exists', false);
    q.descending('timestamp');
    q.limit(limit);
    const objs = await q.find({ useMasterKey: true });
    return objs.map((log) => ({
      user: log.get('username') || 'Sistema',
      action: log.get('action') || '',
      entity: log.get('entityType') || '',
      entityName: log.get('entityName') || '',
      ago: timeAgo(log.get('timestamp'), now),
    }));
  } catch (e) {
    logger.warn('Admin dashboard: fallo al traer actividad reciente', { error: e.message });
    return [];
  }
}

/**
 * Arma el resumen del dashboard de admin: reusa los segmentos/pagos globales de getDashboardSummary
 * y agrega conteos, cotizaciones recientes, próximas reservaciones y actividad reciente. Todo
 * resiliente: cada bloque falla de forma aislada (ceros/vacío) sin romper el render.
 * @param {object} req - Express request (req.user + req.userRole = 'admin').
 * @param {Date} [now] - Momento actual (inyectable para pruebas; por defecto el actual).
 * @returns {Promise<object>} { segments, pendingPayments, counts, recentQuotes, upcoming, activity }.
 * @example
 * const data = await getAdminDashboardSummary(req);
 */
async function getAdminDashboardSummary(req, now = new Date()) {
  const [base, counts, recentQuotes, upcoming, activity] = await Promise.all([
    getDashboardSummary(req),
    getCounts(),
    getRecentQuotes(6),
    getUpcomingReservations(now, 6),
    getRecentActivity(now, 7),
  ]);

  return {
    segments: base.segments,
    pendingPayments: base.pendingPayments,
    counts,
    recentQuotes,
    upcoming,
    activity,
  };
}

module.exports = { getAdminDashboardSummary };
