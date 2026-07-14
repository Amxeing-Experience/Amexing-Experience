const Parse = require('parse/node');
const QuoteController = require('../api/QuoteController');
const ReservationController = require('../api/ReservationController');
const PaymentService = require('../../services/PaymentService');
const logger = require('../../../infrastructure/logger');

/**
 * Resumen del dashboard de inicio (segmentos + pendientes de pago), scopeado por rol.
 * Reusa los helpers existentes: quoted = cotizaciones 'quoted'; hold = reservaciones con
 * cotización 'hold'; scheduled = reservaciones con cotización 'scheduled'; pendingPayments =
 * reservaciones confirmadas no canceladas con pago pending/partial y saldo &gt; 0 (top 5,
 * recalculado con PaymentService). Todo en try/catch: si falla, devuelve ceros/vacío.
 * @param {object} req - Express request (req.user + req.userRole).
 * @returns {Promise<object>} Resumen con segments y pendingPayments.
 * @example
 * const summary = await getDashboardSummary(req);
 */
async function getDashboardSummary(req) {
  const role = req.userRole || req.user?.role || 'client';
  const summary = {
    segments: { quoted: 0, hold: 0, scheduled: 0 },
    pendingPayments: [],
  };

  // En la ruta del dashboard, dashboardAuthMiddleware deja req.user como un POJO mínimo del JWT
  // (sin .get() ni departmentId) y NO setea req.userRole. Los helpers de scoping por rol de
  // Quote/Reservation esperan un AmexingUser completo (usan .get() y departmentId, p. ej. para
  // department_manager) y leen req.userRole. Cargamos el usuario real y armamos un req scopeado
  // para que el scoping funcione igual que en las rutas de API. Si falla la carga, usamos el POJO.
  let scopedReq = { userRole: role, user: req.user };
  try {
    const fullUser = await new Parse.Query('AmexingUser').get(req.user.id, { useMasterKey: true });
    scopedReq = { userRole: role, user: fullUser };
  } catch (e) {
    logger.warn('Dashboard: no se pudo cargar el usuario completo; uso el del request', { error: e.message });
  }

  // COTIZADO: cotizaciones 'quoted' + 'requested' (reusa el scoping por rol de QuoteController),
  // excluyendo las cotizaciones vacías (sin ningún servicio agregado). Como "vacía" depende del
  // JSON serviceItems (no consultable con count), traemos solo ese campo y filtramos en memoria.
  try {
    // statusFilter null → el helper aplica por defecto containedIn('status', ['quoted','requested']).
    const quotedQuery = await QuoteController.buildBaseQuoteQuery(scopedReq.user, role, null);
    quotedQuery.select('serviceItems');
    quotedQuery.limit(10000);
    const quoteObjs = await quotedQuery.find({ useMasterKey: true });
    summary.segments.quoted = quoteObjs.filter((q) => {
      const si = q.get('serviceItems');
      if (!si || !Array.isArray(si.days)) return false;
      const services = si.days.reduce(
        (sum, day) => sum + (Array.isArray(day.subconcepts) ? day.subconcepts.length : 0),
        0
      );
      return services > 0; // vacía = sin servicios → no se cuenta
    }).length;
  } catch (e) {
    logger.warn('Dashboard: fallo al contar cotizaciones', { error: e.message });
  }

  // Reservaciones (scopeadas por rol). Para department_manager el scope va por clientPtr
  // (getRoleFilterPointers); para client va por la cotización (quotePtr), usando los ids de
  // cotizaciones elegibles (getClientEligibleQuoteIds). Ese scope de client se combina con el
  // filtro de estatus en UNA sola subquery de Quote, porque dos matchesQuery sobre quotePtr se
  // pisan entre sí (mismo criterio que la lista de reservaciones: applyQuoteConstraint).
  try {
    const rfp = await ReservationController.getRoleFilterPointers(scopedReq);
    // Ids de cotizaciones que el client puede ver (owner/legacy/compartidas); null para otros roles.
    const clientQuoteIds = await ReservationController.getClientEligibleQuoteIds(scopedReq);

    /**
     * Aplica los filtros base (active/exists) y el scope por clientPtr (department_manager)
     * a una query de Reservation. Para client rfp es null y el scope va por quotePtr.
     * @param {Parse.Query} query - Query de Reservation a acotar.
     * @returns {Parse.Query} La misma query, ya restringida.
     * @example
     * const q = scopeReservation(new Parse.Query('Reservation'));
     */
    const scopeReservation = (query) => {
      query.equalTo('active', true);
      query.equalTo('exists', true);
      if (rfp && rfp.field && Array.isArray(rfp.pointers)) {
        query.containedIn(rfp.field, rfp.pointers);
      }
      return query;
    };

    /**
     * Subquery de Quote por estatus, combinando el scope de client (quotePtr) cuando aplica.
     * Un clientQuoteIds vacío ([]) produce cero resultados (el client no ve nada), correcto.
     * @param {string} status - Estatus de cotización a filtrar ('hold' | 'scheduled').
     * @returns {Parse.Query} Subquery de Quote lista para matchesQuery('quotePtr', ...).
     * @example
     * reservationQuery.matchesQuery('quotePtr', quoteSubquery('scheduled'));
     */
    const quoteSubquery = (status) => {
      const q = new Parse.Query('Quote');
      q.equalTo('status', status);
      if (clientQuoteIds) {
        q.containedIn('objectId', clientQuoteIds);
      }
      return q;
    };

    // AGENDADO (pendiente): reservaciones cuya cotización está en 'hold'.
    const holdRes = scopeReservation(new Parse.Query('Reservation'));
    holdRes.matchesQuery('quotePtr', quoteSubquery('hold'));
    summary.segments.hold = await holdRes.count({ useMasterKey: true });

    // CONFIRMADO: reservaciones cuya cotización está 'scheduled'.
    const schedRes = scopeReservation(new Parse.Query('Reservation'));
    schedRes.matchesQuery('quotePtr', quoteSubquery('scheduled'));
    summary.segments.scheduled = await schedRes.count({ useMasterKey: true });

    // PENDIENTES DE PAGO: solo reservaciones CONFIRMADAS (cotización 'scheduled') y NO canceladas,
    // con paymentStatus pending/partial y saldo > 0 (top 5, más próximas).
    const payRes = scopeReservation(new Parse.Query('Reservation'));
    payRes.containedIn('paymentStatus', ['pending', 'partial']);
    payRes.greaterThan('balance', 0);
    payRes.notEqualTo('status', 'cancelled');
    payRes.matchesQuery('quotePtr', quoteSubquery('scheduled'));
    payRes.ascending('startDate');
    payRes.limit(10); // candidatos: se recalcula el pago real y se descartan los ya pagados.
    const candidates = await payRes.find({ useMasterKey: true });

    // Recalcula el estado/saldo de pago reales con PaymentService (igual que la tabla),
    // para no depender del rollup guardado (que puede quedar desactualizado). En paralelo.
    const summaries = await Promise.all(
      candidates.map((r) => PaymentService.summarize(r.id).catch(() => null))
    );
    const list = [];
    candidates.forEach((r, i) => {
      if (list.length >= 5) return;
      const ps = summaries[i];
      const paidAmount = Number(ps ? ps.paidAmount : (r.get('paidAmount') || 0)) || 0;
      const balance = Number(ps ? ps.balance : (r.get('balance') || 0)) || 0;
      // Si summarize falla, derivamos el estado del monto pagado (0 → pendiente),
      // no del rollup guardado 'paymentStatus' (que puede estar desactualizado).
      let paymentStatus = paidAmount > 0 ? 'partial' : 'pending';
      if (ps) {
        ({ paymentStatus } = ps);
      }
      if (paymentStatus === 'paid' || balance <= 0) return; // ya no debe nada
      // Cliente Final = lead guest (prioritario) y, si no hay, contactPerson.
      const leadGuest = `${r.get('leadGuestFirstName') || ''} ${r.get('leadGuestLastName') || ''}`.trim();
      const contactPerson = (r.get('contactPerson') || '').trim();
      const start = r.get('startDate');
      list.push({
        id: r.id,
        folio: r.get('folio') || '',
        client: leadGuest || contactPerson || '—',
        date: start ? new Date(start).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        balance: `$ ${balance.toLocaleString('es-MX')}`,
        status: paymentStatus,
      });
    });
    summary.pendingPayments = list;
  } catch (e) {
    logger.warn('Dashboard: fallo al contar reservaciones', { error: e.message });
  }

  return summary;
}

module.exports = { getDashboardSummary };
