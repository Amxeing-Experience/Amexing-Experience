#!/usr/bin/env node
/**
 * Backfill de `id` estable en subconceptos de serviceItems.
 *
 * Servicios de flujos viejos (o de "Agregar a cotización") quedaron sin `id`. Sin id
 * se rompen request-change y el bloqueo por-servicio, que keyean por sc.id. Este script
 * asigna un id estable SOLO a los subconceptos que falten. No toca precio, tipo ni ningún
 * otro campo. Es idempotente.
 *
 * Uso: node scripts/backfill-service-ids.js [envFile] [--write]
 * envFile default: environments/.env.development. Sin --write = DRY RUN.
 *
 * @author Denisse Maldonado
 */

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const envFile = args.find((a) => !a.startsWith('--')) || 'environments/.env.development';

require('dotenv').config({ path: envFile });
const Parse = require('parse/node');

Parse.initialize(
  process.env.PARSE_APP_ID,
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

let idCounter = 0;

/**
 * Genera un id estable y único dentro de esta corrida.
 * @returns {string} Nuevo id de servicio.
 * @example newServiceId();
 */
function newServiceId() {
  idCounter += 1;
  return `service_${Date.now()}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Asigna ids faltantes en un serviceItems (inmutable-ish sobre subconceptos).
 * @param {object} si - serviceItems del quote.
 * @returns {number} Cuántos subconceptos se repararon.
 * @example fillMissingIds(quote.get('serviceItems'));
 */
function fillMissingIds(si) {
  let changed = 0;
  (si.days || []).forEach((d) => {
    (d.subconcepts || []).forEach((sc) => {
      if (sc && !sc.id) {
        Object.assign(sc, { id: newServiceId() });
        changed += 1;
      }
    });
  });
  return changed;
}

/**
 * Ejecuta el backfill (dry-run o write según flags).
 * @returns {Promise<void>} Nada.
 * @example run();
 */
async function run() {
  console.log(`env: ${envFile} | serverURL: ${Parse.serverURL} | db: ${process.env.DATABASE_NAME || '(?)'}`);
  console.log(WRITE ? '>>> MODO WRITE (va a escribir)\n' : '>>> DRY RUN (no escribe)\n');

  const query = new Parse.Query('Quote');
  query.equalTo('exists', true);
  query.limit(20000);
  const quotes = await query.find({ useMasterKey: true });

  let scanned = 0;
  let quotesNeedingFix = 0;
  let subconceptsFixed = 0;
  let quotesSaved = 0;
  let saveErrors = 0;

  for (const quote of quotes) {
    scanned += 1;
    const si = quote.get('serviceItems');
    if (si && Array.isArray(si.days)) {
      const changed = fillMissingIds(si);
      if (changed > 0) {
        quotesNeedingFix += 1;
        subconceptsFixed += changed;
        if (WRITE) {
          quote.set('serviceItems', si);
          try {
            // eslint-disable-next-line no-await-in-loop
            await quote.save(null, { useMasterKey: true });
            quotesSaved += 1;
          } catch (e) {
            saveErrors += 1;
            console.error(`  x error guardando quote ${quote.id}: ${e.message || e}`);
          }
        }
      }
    }
  }

  console.log('=== RESULTADO ===');
  console.log(`Quotes escaneados:        ${scanned}`);
  console.log(`Quotes con faltantes:     ${quotesNeedingFix}`);
  console.log(`Subconceptos a reparar:   ${subconceptsFixed}`);
  if (WRITE) {
    console.log(`Quotes guardados:         ${quotesSaved}`);
    console.log(`Errores de guardado:      ${saveErrors}`);
  } else {
    console.log('(dry-run: nada escrito. Corre con --write para aplicar)');
  }
}

run().then(() => process.exit(0)).catch((e) => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
