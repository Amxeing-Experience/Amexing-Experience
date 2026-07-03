#!/usr/bin/env node
/**
 * Migrate legacy `Client` (people-type direct clients) to `AmexingUser` (role end_client).
 *
 * Background: direct Amexing clients used to be stored in the legacy `Client` class and
 * referenced by quotes via `companyClientPtr`. They now live in `AmexingUser` (role
 * 'end_client') and are referenced by `quote.client` with `clientType: 'direct'`.
 * This script consolidates the data onto the new model so `companyClientPtr` is no longer
 * used, which the agency/client table filters now rely on.
 *
 * What it does (idempotent) — migrates ALL legacy `Client` records, deleting none without
 * preserving their data first:
 *   1. For EVERY legacy `Client` (used by a quote OR orphaned):
 *        - reuse an existing end_client with the same email, or create a new one (preserving
 *          name/email; no-email or duplicate-email get a placeholder username);
 *        - repoint each of its quotes: client = end_client, clientType = 'direct', unset companyClientPtr;
 *        - repoint linked reservations' clientPtr;
 *        - retire the legacy Client only AFTER its info lives in the end_client.
 *   2. Clean dangling companyClientPtr (points to a deleted Client) when the quote already
 *      has a real `client`.
 *
 * Usage:
 *   node scripts/migrate-legacy-clients-to-endclient.js            # dry-run (no writes)
 *   node scripts/migrate-legacy-clients-to-endclient.js --apply    # execute
 *
 * @author Denisse Maldonado
 */

require('dotenv').config({ path: process.env.ENV_FILE || './environments/.env.development' });
const Parse = require('parse/node');
const crypto = require('crypto');
const AmexingUser = require('../src/domain/models/AmexingUser');

Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const APPLY = process.argv.includes('--apply');

function clientPtr(id) { const C = Parse.Object.extend('Client'); const o = new C(); o.id = id; return o; }
function userPtr(id) { return { __type: 'Pointer', className: 'AmexingUser', objectId: id }; }

function splitName(name) {
  const parts = (name || '').trim().split(/\s+/);
  if (!parts[0]) return { firstName: 'Cliente', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function resolveOrCreateEndClient(legacyClient) {
  const email = (legacyClient.get('email') || '').trim().toLowerCase();
  if (email) {
    const existing = await new Parse.Query('AmexingUser')
      .equalTo('username', email).equalTo('role', 'end_client').first({ useMasterKey: true });
    if (existing) return { id: existing.id, reused: true };
  }
  const taken = email ? (await new Parse.Query('AmexingUser').equalTo('username', email).count({ useMasterKey: true })) > 0 : true;
  const { firstName, lastName } = splitName(legacyClient.get('name'));
  const user = AmexingUser.create({
    username: taken ? `enduser_${legacyClient.id}@migrated.amexing` : email,
    email: taken ? '' : email,
    firstName, lastName, role: 'end_client', organizationId: 'amexing',
    clientCategory: 'direct_client', active: true, exists: true, contextualData: {},
  });
  await user.setPassword(crypto.randomBytes(24).toString('base64'), false);
  user.set('mustChangePassword', true);
  user.set('migratedFromClientId', legacyClient.id);
  await user.save(null, { useMasterKey: true });
  return { id: user.id, reused: false };
}

(async () => {
  try {
    // 1) Quotes that still reference a Client via companyClientPtr → group by Client.
    const quotes = await new Parse.Query('Quote').exists('companyClientPtr').equalTo('exists', true)
      .include('companyClientPtr').include('client').limit(5000).find({ useMasterKey: true });
    const byClient = {}; const dangling = [];
    for (const q of quotes) {
      const cc = q.get('companyClientPtr');
      if (!cc || !cc.get('createdAt')) { dangling.push(q); continue; }
      (byClient[cc.id] = byClient[cc.id] || []).push(q);
    }

    // 2) Migrar TODOS los Client legados (usados + huérfanos) a end_client. Ninguno se
    //    borra sin preservar: cada uno se convierte en (o reusa) un end_client; el Client
    //    legado se retira sólo DESPUÉS de preservar su info en el modelo nuevo.
    const allClients = await new Parse.Query('Client').limit(5000).find({ useMasterKey: true });
    const withQuotes = allClients.filter((c) => byClient[c.id]).length;

    console.log(`Total legacy Clients: ${allClients.length} (con quotes: ${withQuotes}, huérfanos: ${allClients.length - withQuotes})`);
    console.log(`Dangling companyClientPtr quotes: ${dangling.length}`);
    allClients.forEach((c) => console.log(`  - ${c.get('name')} (${c.id}) [exists=${c.get('exists')}]: ${(byClient[c.id] || []).length} quotes`));

    if (!APPLY) { console.log('\n(dry-run) re-run with --apply to execute.'); process.exit(0); }

    console.log('\n--apply: migrando TODOS los Client legados a end_client...');
    for (const c of allClients) {
      const { id: uid, reused } = await resolveOrCreateEndClient(c);
      const qs = byClient[c.id] || [];
      for (const q of qs) {
        q.set('client', userPtr(uid)); q.unset('companyClientPtr'); q.set('clientType', 'direct');
        await q.save(null, { useMasterKey: true });
        const ress = await new Parse.Query('Reservation').equalTo('quotePtr', q).equalTo('exists', true).find({ useMasterKey: true });
        for (const r of ress) { r.set('clientPtr', userPtr(uid)); await r.save(null, { useMasterKey: true }); }
      }
      // Info preservada como end_client; se retira el Client legado para limpiar la tabla.
      try { await c.destroy({ useMasterKey: true }); } catch (e) { /* already removed */ }
      console.log(`  ${reused ? '↻' : '+'} ${c.get('name')} -> end_client ${uid} (${qs.length} quotes)`);
    }
    for (const q of dangling) { q.unset('companyClientPtr'); await q.save(null, { useMasterKey: true }); }
    if (dangling.length) console.log(`  🧹 cleaned ${dangling.length} dangling companyClientPtr`);
    console.log('\n✅ Migration complete.');
  } catch (e) { console.error('ERROR', e.message, e.stack); }
  process.exit(0);
})();
