#!/usr/bin/env node
/**
 * Backfill: estandariza `duration` a MINUTOS en Experience y ProviderExperiencia.
 *
 * Contexto: históricamente `Experience.duration` y las `ProviderExperiencia` viejas se guardaban
 * en HORAS; las nuevas (tras el picker amigable) ya en MINUTOS. Este script convierte las que están
 * en horas a minutos (×60), dejando intactas las que ya están en minutos.
 *
 * Discriminador (validado contra datos reales de dev+prod, sin valores ambiguos 25–59):
 *   duration != null && duration <= 24  =>  HORAS  -> ×60
 *   duration > 24                        =>  ya en MINUTOS -> sin tocar
 *
 * Idempotencia (3 capas):
 *   1. Guard global: registro `Migration(key='duration_to_minutes_v1')`. Si existe, no corre
 *      (salvo --force).
 *   2. Flag por registro: `durationInMinutes=true` en cada convertido; los flagged se saltan.
 *   3. Magnitud: un valor ya convertido (≥30) es >24, así que no se re-convierte.
 *
 * Uso:
 *   node scripts/migrations/backfill-duration-to-minutes.js                # DRY-RUN dev (no escribe)
 *   node scripts/migrations/backfill-duration-to-minutes.js --apply        # aplica en dev
 *   node scripts/migrations/backfill-duration-to-minutes.js --env=./environments/.env.production-local --apply
 *   ... --force   # ignora el guard global (re-corre)
 *
 * Created by Denisse Maldonado
 */
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const envArg = args.find((a) => a.startsWith('--env='));
const ENV_FILE = envArg ? envArg.split('=')[1] : './environments/.env.development';
const MIGRATION_KEY = 'duration_to_minutes_v1';

require('dotenv').config({ path: ENV_FILE });
const Parse = require('parse/node');
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const HOURS_MAX = 24; // <= 24 se interpreta como horas

async function alreadyApplied() {
  try {
    const q = new Parse.Query('Migration');
    q.equalTo('key', MIGRATION_KEY);
    const found = await q.first({ useMasterKey: true });
    return found || null;
  } catch (e) {
    return null; // clase inexistente => nunca corrió
  }
}

async function markApplied(summary) {
  const Migration = Parse.Object.extend('Migration');
  const m = new Migration();
  m.set('key', MIGRATION_KEY);
  m.set('appliedAt', new Date().toISOString());
  m.set('summary', summary);
  await m.save(null, { useMasterKey: true });
}

async function backfillClass(className) {
  const q = new Parse.Query(className);
  q.equalTo('exists', true);
  q.limit(10000);
  q.select('duration', 'durationInMinutes', 'name');
  const rows = await q.find({ useMasterKey: true });

  const plan = { total: rows.length, convert: [], alreadyMinutes: 0, flagged: 0, empty: 0 };
  const toSave = [];

  for (const r of rows) {
    if (r.get('durationInMinutes') === true) { plan.flagged++; continue; }
    const raw = r.get('duration');
    if (raw === null || raw === undefined || Number(raw) === 0 || Number.isNaN(Number(raw))) { plan.empty++; continue; }
    const d = Number(raw);
    if (d <= HOURS_MAX) {
      const newVal = Math.round(d * 60);
      plan.convert.push({ id: r.id, name: (r.get('name') || '').slice(0, 32), from: d, to: newVal });
      r.set('duration', newVal);
      r.set('durationInMinutes', true);
      toSave.push(r);
    } else {
      plan.alreadyMinutes++; // ya en minutos: no se toca (ni se flaggea, la magnitud lo protege)
    }
  }

  console.log(`\n=== ${className} — ${plan.total} registros (exists=true) ===`);
  console.log(`  ya flagged (durationInMinutes): ${plan.flagged}`);
  console.log(`  ya en minutos (>${HOURS_MAX}):    ${plan.alreadyMinutes}`);
  console.log(`  sin duración:                    ${plan.empty}`);
  console.log(`  A CONVERTIR (horas -> min):      ${plan.convert.length}`);
  plan.convert.forEach((c) => console.log(`     ${c.id}  ${c.from} h -> ${c.to} min   "${c.name}"`));

  if (APPLY && toSave.length) {
    await Parse.Object.saveAll(toSave, { useMasterKey: true });
    console.log(`  ✅ Guardados ${toSave.length} registros.`);
  }
  return { className, converted: plan.convert.length, alreadyMinutes: plan.alreadyMinutes };
}

(async () => {
  try {
    console.log(`Backfill duración -> minutos`);
    console.log(`  env:    ${ENV_FILE}`);
    console.log(`  server: ${Parse.serverURL}  (appId ${process.env.PARSE_APP_ID})`);
    console.log(`  modo:   ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (no escribe)'}${FORCE ? ' --force' : ''}`);

    const prior = await alreadyApplied();
    if (prior && !FORCE) {
      console.log(`\n⚠️  Migración '${MIGRATION_KEY}' YA aplicada (${prior.get('appliedAt')}). Usa --force para re-correr.`);
      console.log(`    (no se hace nada)`);
      process.exit(0);
    }

    const results = [];
    results.push(await backfillClass('Experience'));
    results.push(await backfillClass('ProviderExperiencia'));

    const totalConverted = results.reduce((a, r) => a + r.converted, 0);
    console.log(`\nResumen: ${totalConverted} registros a convertir.`);

    if (APPLY) {
      if (!prior) {
        await markApplied(`converted=${totalConverted}; ` + results.map((r) => `${r.className}:${r.converted}`).join(', '));
        console.log(`✅ Guard '${MIGRATION_KEY}' marcado como aplicado.`);
      }
      console.log(`\n✅ Backfill APLICADO en ${ENV_FILE}.`);
    } else {
      console.log(`\n(DRY-RUN) Nada escrito. Corre con --apply para aplicar.`);
    }
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
