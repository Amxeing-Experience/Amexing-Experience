#!/usr/bin/env node

/**
 * Corrige nombres de servicio con HTML ya escapado EN LA BASE.
 *
 * Cuatro servicios guardan su `concept` con la secuencia `&lt;->` en vez de `<->`: alguien escapó el
 * valor antes de guardarlo, o un escape de una versión anterior quedó persistido. Mientras la lista de
 * servicios interpolaba el nombre en crudo, el navegador lo desescapaba al pintar y se veía bien.
 *
 * Al cerrar la XSS —el nombre lo escribe una persona en la cotización— el nombre pasa a escaparse, y
 * entonces `&lt;` se convierte en `&amp;lt;` y el usuario ve la secuencia literal. La corrección va en
 * el DATO, no en el render: desescapar al pintar reabriría el agujero, porque bastaría con guardar
 * `&lt;script&gt;` para que se decodificara a una etiqueta real.
 *
 * Simula por defecto. Para escribir: node scripts/fix-double-escaped-concepts.js --apply
 * Created by Denisse Maldonado.
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const logger = console;
const APLICAR = process.argv.includes('--apply');

// Solo las entidades que de verdad aparecen en estos datos. Una lista corta y explícita es preferible
// a un desescapado general: este script corrige un caso conocido, no interpreta HTML arbitrario.
const ENTIDADES = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'], // al final: si no, reintroduce las de arriba
];

/**
 * Desescapa las entidades HTML de un texto guardado.
 * @param {string} texto - Valor almacenado.
 * @returns {string} Valor sin entidades.
 * @example
 * desescapar('AIFA &lt;-> SMA') // 'AIFA <-> SMA'
 */
function desescapar(texto) {
  return ENTIDADES.reduce((acc, [re, ch]) => acc.replace(re, ch), String(texto));
}

/**
 * Encuentra y corrige los servicios cuyo `concept` trae entidades HTML.
 * @returns {Promise<void>}
 * @example
 * await corregir();
 */
async function corregir() {
  const query = new Parse.Query('ReservationService');
  query.limit(2000);
  const servicios = await query.find({ useMasterKey: true });

  const afectados = servicios.filter((s) => {
    const c = s.get('concept');
    return c && desescapar(c) !== c;
  });

  logger.log(`Servicios revisados: ${servicios.length}`);
  logger.log(`Con entidades HTML en el nombre: ${afectados.length}\n`);

  afectados.forEach((s) => {
    logger.log(`  ${s.id}`);
    logger.log(`    antes  : ${s.get('concept')}`);
    logger.log(`    después: ${desescapar(s.get('concept'))}`);
  });

  if (!afectados.length) return;

  if (!APLICAR) {
    logger.log('\nSimulación. Para escribir los cambios: --apply');
    return;
  }

  // Uno por uno y no saveAll: son cuatro registros y así un fallo no deja el lote a medias sin decir
  // cuál quedó pendiente.
  let hechos = 0;
  for (const s of afectados) {
    s.set('concept', desescapar(s.get('concept')));
    // eslint-disable-next-line no-await-in-loop
    await s.save(null, { useMasterKey: true });
    hechos += 1;
  }
  logger.log(`\nCorregidos: ${hechos} de ${afectados.length}`);
}

corregir()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Falló la corrección:', error.message);
    process.exit(1);
  });
