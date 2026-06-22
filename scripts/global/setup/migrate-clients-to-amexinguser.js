/**
 * migrate-clients-to-amexinguser - Copies people-type clients from the Client class into
 * AmexingUser so they can eventually log in. Never deletes a Client record.
 *
 * People-type clients are clientBelongsTo='amexing' with clientCategory in
 * direct_client / wedding_planner / concierge / home_owner. Each migrated Client gets an
 * AmexingUser (role 'end_client') carrying its profile fields. For tracing/rollback the
 * user keeps legacyClientId = Client.id, and the Client keeps migratedToUserId = user.id.
 *
 * Idempotent: a Client with migratedToUserId set is skipped, and a Client whose id already
 * maps to an AmexingUser (legacyClientId) is skipped. Errors are logged per record; the run
 * continues. Pass --dry-run to report what would migrate without writing anything.
 *
 *   NODE_ENV=development node --use-system-ca scripts/global/setup/migrate-clients-to-amexinguser.js [--dry-run]
 */

require('dotenv').config({ path: `./environments/.env.${process.env.NODE_ENV || 'development'}` });
const crypto = require('crypto');
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const Client = require('../../../src/domain/models/Client');
const AmexingUser = require('../../../src/domain/models/AmexingUser');

const DRY_RUN = process.argv.includes('--dry-run');
const PERSON_CATEGORIES = ['direct_client', 'wedding_planner', 'concierge', 'home_owner'];
const BATCH = 100;

// Profile fields copied straight from Client onto the new AmexingUser.
const PROFILE_FIELDS = [
  'firstName', 'lastName', 'phone', 'contactFirstName', 'contactLastName',
  'emergencyContactName', 'emergencyContactPhone', 'companyType', 'taxId', 'website',
  'preferredLanguage', 'accessibilityRequirements', 'allergies', 'dietaryRestrictions',
  'clientCategory', 'birthDate', 'anniversary', 'loyaltyPrograms', 'address',
];

// Derive the login username from the Client email, or a stable placeholder when absent.
function deriveUsername(client) {
  const email = client.get('email');
  if (email && email.trim()) return email.trim().toLowerCase();
  return `enduser_${client.id}@migrated.amexing`;
}

// Build the AmexingUser.create() payload from a Client.
function buildUserData(client) {
  const username = deriveUsername(client);
  const userData = {
    username,
    email: client.get('email') || username,
    role: 'end_client',
    organizationId: 'amexing',
    notes: client.get('notes') || '',
    active: true,
    exists: true,
  };
  PROFILE_FIELDS.forEach((f) => {
    const value = client.get(f);
    if (value !== undefined) userData[f] = value;
  });
  return userData;
}

// True when an AmexingUser already traces back to this Client (idempotency guard).
async function userExistsForClient(clientId) {
  const query = new Parse.Query('AmexingUser');
  query.equalTo('legacyClientId', clientId);
  const existing = await query.first({ useMasterKey: true });
  return !!existing;
}

async function migrateClient(client, stats) {
  const name = client.get('name') || client.get('email') || client.id;
  const category = client.get('clientCategory');

  if (client.get('migratedToUserId')) {
    stats.skipped += 1;
    console.log(`Skip (migratedToUserId set): ${name} [${category}]`);
    return;
  }

  if (await userExistsForClient(client.id)) {
    stats.skipped += 1;
    console.log(`Skip (AmexingUser legacyClientId exists): ${name} [${category}]`);
    return;
  }

  if (DRY_RUN) {
    stats.migrated += 1;
    console.log(`Would migrate: ${name} [${category}]`);
    return;
  }

  const user = AmexingUser.create(buildUserData(client));
  user.set('legacyClientId', client.id);
  user.set('mustChangePassword', true);

  // These records don't log in yet. Seed a random placeholder password (never printed) so no
  // account ships passwordless; mustChangePassword is re-asserted because setPassword clears it.
  await user.setPassword(crypto.randomBytes(24).toString('base64'), false);
  user.set('mustChangePassword', true);
  await user.save(null, { useMasterKey: true });

  client.set('migratedToUserId', user.id);
  await client.save(null, { useMasterKey: true });

  stats.migrated += 1;
  console.log(`Migrated: ${name} [${category}] -> user ${user.id}`);
}

async function run() {
  const stats = { found: 0, migrated: 0, skipped: 0, errors: 0 };
  let skip = 0;

  console.log(`Migrating people-type clients to AmexingUser${DRY_RUN ? ' (DRY RUN)' : ''}.`);

  for (;;) {
    const query = new Parse.Query(Client);
    query.equalTo('exists', true);
    query.equalTo('clientBelongsTo', 'amexing');
    query.containedIn('clientCategory', PERSON_CATEGORIES);
    query.limit(BATCH);
    query.skip(skip);
    // eslint-disable-next-line no-await-in-loop
    const clients = await query.find({ useMasterKey: true });
    if (clients.length === 0) break;

    for (const client of clients) {
      stats.found += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        await migrateClient(client, stats);
      } catch (error) {
        stats.errors += 1;
        const name = client.get('name') || client.get('email') || client.id;
        console.error(`Error migrating ${name} (${client.id}): ${error.message}`);
      }
    }
    skip += clients.length;
  }

  console.log('---');
  console.log(`Found:    ${stats.found}`);
  console.log(`Migrated: ${stats.migrated}${DRY_RUN ? ' (would migrate)' : ''}`);
  console.log(`Skipped:  ${stats.skipped} (already migrated)`);
  console.log(`Errors:   ${stats.errors}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', error.message);
  process.exit(1);
});
