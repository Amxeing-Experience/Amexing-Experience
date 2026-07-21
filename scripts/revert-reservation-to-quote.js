/* eslint-disable */
/**
 * Revert reservación → cotización (deshace una conversión hecha por error).
 *
 * Deshace lo que crea la conversión:
 *  - Desactiva (soft-delete) la(s) Reservation ligada(s) a la cotización.
 *  - Desactiva sus ReservationService.
 *  - Regresa el status de la cotización a TARGET_STATUS (quoted | requested).
 *
 * Seguridad:
 *  - Soft-delete (active=false, exists=false), NO borra físico → reversible.
 *  - Aborta si hay Payment en la reservación (a menos que FORCE_WITH_PAYMENTS=true).
 *  - DRY_RUN=true por defecto: solo imprime el plan, no modifica nada.
 *
 * Uso (correr desde la raíz del proyecto):
 *   QUOTE_FOLIO=QTE-2026-9001 node scripts/revert-reservation-to-quote.js                 # dry-run
 *   RESERVATION_FOLIO=OCT-2610-001 node scripts/revert-reservation-to-quote.js            # dry-run por folio de reservación
 *   QUOTE_FOLIO=QTE-2026-9001 TARGET_STATUS=quoted DRY_RUN=false node scripts/revert-reservation-to-quote.js
 *   # producción-local (1338): ENV_FILE=./environments/.env.production-local RESERVATION_FOLIO=... DRY_RUN=false node scripts/revert-reservation-to-quote.js
 */
require('dotenv').config({ path: process.env.ENV_FILE || './environments/.env.development' });
const Parse = require('parse/node');
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const QUOTE_FOLIO = process.env.QUOTE_FOLIO;
const RESERVATION_FOLIO = process.env.RESERVATION_FOLIO;
const TARGET_STATUS = process.env.TARGET_STATUS || 'requested';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const FORCE_WITH_PAYMENTS = process.env.FORCE_WITH_PAYMENTS === 'true';

(async () => {
  if (!QUOTE_FOLIO && !RESERVATION_FOLIO) { console.error('Falta QUOTE_FOLIO o RESERVATION_FOLIO'); process.exit(1); }
  if (!['quoted', 'requested'].includes(TARGET_STATUS)) { console.error('TARGET_STATUS debe ser quoted o requested'); process.exit(1); }

  console.log(`\n=== REVERT reservación → cotización ===`);
  console.log(`ENV: ${process.env.ENV_FILE || './environments/.env.development'}`);
  console.log(`Parse: ${Parse.serverURL}  | AppId: ${(process.env.PARSE_APP_ID || '').slice(0, 8)}...`);
  console.log(`Entrada: ${QUOTE_FOLIO ? `QUOTE_FOLIO=${QUOTE_FOLIO}` : `RESERVATION_FOLIO=${RESERVATION_FOLIO}`} | TARGET_STATUS: ${TARGET_STATUS} | DRY_RUN: ${DRY_RUN}\n`);

  // Resolver la cotización (por folio de cotización o desde el folio de reservación).
  let quote;
  if (RESERVATION_FOLIO) {
    const rq = new Parse.Query('Reservation');
    rq.equalTo('folio', RESERVATION_FOLIO);
    rq.equalTo('exists', true);
    rq.include('quotePtr');
    const r = await rq.first({ useMasterKey: true });
    if (!r) { console.error(`Reservación ${RESERVATION_FOLIO} no encontrada (o ya soft-deleted)`); process.exit(1); }
    quote = r.get('quotePtr');
    if (quote && typeof quote.fetch === 'function' && !quote.get('folio')) {
      quote = await quote.fetch({ useMasterKey: true });
    }
    if (!quote) { console.error('La reservación no tiene cotización ligada (quotePtr)'); process.exit(1); }
  } else {
    const quoteQ = new Parse.Query('Quote');
    quoteQ.equalTo('folio', QUOTE_FOLIO);
    quoteQ.equalTo('exists', true);
    quote = await quoteQ.first({ useMasterKey: true });
    if (!quote) { console.error('Cotización no encontrada'); process.exit(1); }
  }
  console.log(`Cotización ${quote.get('folio')} [status actual: ${quote.get('status')}] id=${quote.id}`);

  const byPtr = new Parse.Query('Reservation'); byPtr.equalTo('quotePtr', quote);
  const byFolio = new Parse.Query('Reservation'); byFolio.equalTo('quoteFolio', quote.get('folio'));
  const orQ = Parse.Query.or(byPtr, byFolio);
  orQ.equalTo('exists', true);
  const reservations = await orQ.find({ useMasterKey: true });
  console.log(`\nReservaciones ligadas (exists): ${reservations.length}`);

  let totalServices = 0; let totalPayments = 0;
  const svcByRes = [];
  for (const r of reservations) {
    const svcQ = new Parse.Query('ReservationService');
    svcQ.equalTo('reservationPtr', r); svcQ.equalTo('exists', true); svcQ.limit(1000);
    const svcs = await svcQ.find({ useMasterKey: true });
    const payQ = new Parse.Query('Payment');
    payQ.equalTo('reservationPtr', r); payQ.equalTo('exists', true);
    const pays = await payQ.count({ useMasterKey: true });
    totalServices += svcs.length; totalPayments += pays;
    svcByRes.push({ r, svcs });
    console.log(`  • ${r.get('folio') || r.id} [${r.get('status')}] → ${svcs.length} servicios, ${pays} pago(s)`);
  }

  if (totalPayments > 0 && !FORCE_WITH_PAYMENTS) {
    console.error(`\n⚠️  Hay ${totalPayments} pago(s) registrados. ABORTADO por seguridad.`);
    console.error(`   Revisa/borra los pagos primero, o corre con FORCE_WITH_PAYMENTS=true si estás seguro.`);
    process.exit(2);
  }

  console.log(`\nPLAN:`);
  console.log(`  - Desactivar ${reservations.length} reservación(es)  (active=false, exists=false)`);
  console.log(`  - Desactivar ${totalServices} ReservationService`);
  console.log(`  - Cotización: ${quote.get('status')}  →  ${TARGET_STATUS}`);

  if (DRY_RUN) {
    console.log(`\n(DRY RUN — no se modificó nada.) Para aplicar: agrega DRY_RUN=false\n`);
    process.exit(0);
  }

  for (const { r, svcs } of svcByRes) {
    for (const s of svcs) { s.set('active', false); s.set('exists', false); }
    if (svcs.length) await Parse.Object.saveAll(svcs, { useMasterKey: true });
    r.set('active', false); r.set('exists', false);
    await r.save(null, { useMasterKey: true });
    console.log(`  ✔ Reservación ${r.get('folio') || r.id} desactivada (+${svcs.length} servicios)`);
  }
  quote.set('status', TARGET_STATUS);
  await quote.save(null, { useMasterKey: true });
  console.log(`\n✅ LISTO. Cotización ${quote.get('folio')} ahora [${quote.get('status')}] y sin reservación activa.\n`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
