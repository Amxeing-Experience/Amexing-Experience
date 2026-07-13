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

  // COTIZADO: cotizaciones 'quoted' + 'requested' (reusa el scoping por rol de QuoteController),
  // excluyendo las cotizaciones vacías (sin ningún servicio agregado). Como "vacía" depende del
  // JSON serviceItems (no consultable con count), traemos solo ese campo y filtramos en memoria.
  try {
    // statusFilter null → el helper aplica por defecto containedIn('status', ['quoted','requested']).
    const quotedQuery = await QuoteController.buildBaseQuoteQuery(req.user, role, null);
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

  // Reservaciones (scopeadas por rol con getRoleFilterPointers).
  try {
    const rfp = await ReservationController.getRoleFilterPointers(req);
    const scopeReservation = (query) => {
      query.equalTo('active', true);
      query.equalTo('exists', true);
      if (rfp && rfp.field && Array.isArray(rfp.pointers)) {
        query.containedIn(rfp.field, rfp.pointers);
      }
      return query;
    };

    // AGENDADO (pendiente): reservaciones cuya cotización está en 'hold'.
    const holdQuote = new Parse.Query('Quote');
    holdQuote.equalTo('status', 'hold');
    const holdRes = scopeReservation(new Parse.Query('Reservation'));
    holdRes.matchesQuery('quotePtr', holdQuote);
    summary.segments.hold = await holdRes.count({ useMasterKey: true });

    // CONFIRMADO: reservaciones cuya cotización está 'scheduled'.
    const schedQuote = new Parse.Query('Quote');
    schedQuote.equalTo('status', 'scheduled');
    const schedRes = scopeReservation(new Parse.Query('Reservation'));
    schedRes.matchesQuery('quotePtr', schedQuote);
    summary.segments.scheduled = await schedRes.count({ useMasterKey: true });

    // PENDIENTES DE PAGO: solo reservaciones CONFIRMADAS (cotización 'scheduled') y NO canceladas,
    // con paymentStatus pending/partial y saldo > 0 (top 5, más próximas).
    const payRes = scopeReservation(new Parse.Query('Reservation'));
    payRes.containedIn('paymentStatus', ['pending', 'partial']);
    payRes.greaterThan('balance', 0);
    payRes.notEqualTo('status', 'cancelled');
    const payScheduledQuote = new Parse.Query('Quote');
    payScheduledQuote.equalTo('status', 'scheduled');
    payRes.matchesQuery('quotePtr', payScheduledQuote);
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
