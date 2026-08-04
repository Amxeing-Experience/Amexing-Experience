#!/usr/bin/env node

/**
 * Crea una reservación de prueba VISIBLE para un usuario dado, clonando una existente.
 *
 * Se clona en vez de inventarse los campos porque la visibilidad de client / end_client no depende de
 * la reservación sino de la COTIZACIÓN: ReservationController.getClientEligibleQuoteIds acota por
 * `Quote.owner`, y las reservaciones se filtran después por `quotePtr`. Una reservación creada a mano
 * sin su cotización no la vería nadie.
 *
 * Clonar una real, además, hereda servicios, asignaciones, ajustes y pagos, que es lo que hace falta
 * para probar la vista de verdad: una reservación vacía no ejercita nada.
 *
 * Uso: --email <correo> para simular, --apply para escribir, --source <objectId> para clonar otra.
 *
 * Todo lo creado lleva folio con prefijo PRUEBA-, y el script imprime los objectId para poder
 * deshacerlo.
 * Created by Denisse Maldonado.
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const logger = console;
const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const EMAIL = arg('email');
const ORIGEN = arg('source') || 'NadeBc8gyG';
const APLICAR = process.argv.includes('--apply');

// Campos que NO se copian: identidad del objeto, marcas de tiempo que pone Parse, y los punteros que
// este script vuelve a apuntar a propósito.
const NO_COPIAR = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL']);

/**
 * Copia los atributos de un objeto de Parse a otro, saltando los que no deben viajar.
 * @param {Parse.Object} origen - Objeto a copiar.
 * @param {Parse.Object} destino - Objeto nuevo.
 * @param {Array<string>} [omitir] - Campos adicionales a saltar.
 * @returns {void}
 * @example
 * copiarCampos(reservaOrigen, reservaNueva, ['folio']);
 */
function copiarCampos(origen, destino, omitir = []) {
  const fuera = new Set([...NO_COPIAR, ...omitir]);
  const datos = origen.toJSON();
  Object.keys(datos).forEach((k) => {
    if (fuera.has(k)) return;
    destino.set(k, origen.get(k));
  });
}

/**
 * Clona una reservación y todo lo que cuelga de ella, a nombre del usuario indicado.
 * @returns {Promise<void>}
 * @example
 * await clonar();
 */
async function clonar() {
  if (!EMAIL) throw new Error('Falta --email');

  const usuario = await new Parse.Query('AmexingUser').equalTo('email', EMAIL).first({ useMasterKey: true });
  if (!usuario) throw new Error(`No existe ningún usuario con email ${EMAIL}`);
  logger.log(`Usuario: ${usuario.id}  ${EMAIL}  rol=${usuario.get('role')}  categoría=${usuario.get('clientCategory') || '—'}`);

  const origen = await new Parse.Query('Reservation').get(ORIGEN, { useMasterKey: true });
  const quoteOrigen = origen.get('quotePtr')
    ? await new Parse.Query('Quote').get(origen.get('quotePtr').id, { useMasterKey: true })
    : null;
  if (!quoteOrigen) throw new Error(`La reservación ${ORIGEN} no tiene cotización; sin ella el cliente no la vería`);

  const servicios = await new Parse.Query('ReservationService')
    .equalTo('reservationPtr', origen).limit(500).find({ useMasterKey: true });
  const pagos = await new Parse.Query('Payment')
    .equalTo('reservationPtr', origen).limit(500).find({ useMasterKey: true });

  logger.log(`Origen  : ${origen.id}  ${origen.get('folio')}`);
  logger.log(`  servicios: ${servicios.length}   pagos: ${pagos.length}   ajustes: ${(origen.get('adjustments') || []).length}`);
  logger.log(`  cotización: ${quoteOrigen.id}  ${quoteOrigen.get('folio')}`);

  // El sufijo sale del id de la reservación origen, no de un timestamp: así el script es
  // determinista y volver a correrlo no llena la base de folios distintos.
  const sufijo = `${usuario.id.slice(0, 4)}-${origen.id.slice(0, 4)}`.toUpperCase();
  const folioQuote = `PRUEBA-Q-${sufijo}`;
  const folioReserva = `PRUEBA-R-${sufijo}`;

  const yaExiste = await new Parse.Query('Reservation').equalTo('folio', folioReserva).first({ useMasterKey: true });
  if (yaExiste) {
    logger.log(`\nYa existe una reservación de prueba con folio ${folioReserva} (${yaExiste.id}). No se duplica.`);
    return;
  }

  logger.log('\nSe creará:');
  logger.log(`  Quote        ${folioQuote}   owner = ${EMAIL}`);
  logger.log(`  Reservation  ${folioReserva}   clientPtr = ${EMAIL}`);
  logger.log(`  ${servicios.length} servicios y ${pagos.length} pagos, copiados tal cual`);

  if (!APLICAR) {
    logger.log('\nSimulación. Para escribir: --apply');
    return;
  }

  const mePtr = usuario;

  const quote = new Parse.Object('Quote');
  copiarCampos(quoteOrigen, quote, ['folio', 'owner', 'createdBy']);
  quote.set('folio', folioQuote);
  // `owner` es lo que decide la visibilidad; `createdBy` se alinea para que la cotización se lea
  // coherente en las pantallas que muestran quién la hizo.
  quote.set('owner', mePtr);
  quote.set('createdBy', mePtr);
  await quote.save(null, { useMasterKey: true });

  const reserva = new Parse.Object('Reservation');
  copiarCampos(origen, reserva, ['folio', 'quotePtr', 'clientPtr']);
  reserva.set('folio', folioReserva);
  reserva.set('quotePtr', quote);
  reserva.set('clientPtr', mePtr);
  await reserva.save(null, { useMasterKey: true });

  const serviciosNuevos = servicios.map((s) => {
    const n = new Parse.Object('ReservationService');
    copiarCampos(s, n, ['reservationPtr']);
    n.set('reservationPtr', reserva);
    return n;
  });
  if (serviciosNuevos.length) await Parse.Object.saveAll(serviciosNuevos, { useMasterKey: true });

  const pagosNuevos = pagos.map((p) => {
    const n = new Parse.Object('Payment');
    copiarCampos(p, n, ['reservationPtr']);
    n.set('reservationPtr', reserva);
    return n;
  });
  if (pagosNuevos.length) await Parse.Object.saveAll(pagosNuevos, { useMasterKey: true });

  logger.log('\nCreado:');
  logger.log(`  Quote        ${quote.id}   ${folioQuote}`);
  logger.log(`  Reservation  ${reserva.id}   ${folioReserva}`);
  logger.log(`  servicios    ${serviciosNuevos.length}`);
  logger.log(`  pagos        ${pagosNuevos.length}`);
  logger.log(`\nPara deshacerlo: borrar la reservación ${reserva.id}, la cotización ${quote.id}, y sus servicios y pagos.`);
}

clonar()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Falló:', error.message);
    process.exit(1);
  });
