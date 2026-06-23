/**
 * seed-end-client-role - Inserts the `end_client` Role for people-type clients
 * (direct_client / wedding_planner / concierge / home_owner) that log in via AmexingUser.
 *
 * Idempotent: if a role named 'end_client' (exists=true) is already present it logs and
 * exits without creating a duplicate. Safe to re-run in any environment.
 *
 *   NODE_ENV=development node --use-system-ca scripts/global/setup/seed-end-client-role.js
 */

require('dotenv').config({ path: `./environments/.env.${process.env.NODE_ENV || 'development'}` });
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const Role = require('../../../src/domain/models/Role');

async function run() {
  const query = new Parse.Query('Role');
  query.equalTo('name', 'end_client');
  query.equalTo('exists', true);
  const existing = await query.first({ useMasterKey: true });

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Role 'end_client' already exists (id=${existing.id}). Nothing to do.`);
    return;
  }

  // Level 5: same tier as the 'client' role. end_client is a portal-facing person who
  // owns their own profile/bookings within the client organization scope, not a sub-role
  // beneath department managers — so it sits at the organization level, mirroring 'client'.
  const role = Role.create({
    name: 'end_client',
    displayName: 'Cliente Final',
    description: 'Cliente persona con acceso al portal mediante AmexingUser',
    level: 5,
    scope: 'organization',
    organization: 'client',
    basePermissions: [],
    delegatable: false,
    isSystemRole: true,
    color: '#059669',
    icon: 'user',
    active: true,
    exists: true,
  });

  const saved = await role.save(null, { useMasterKey: true });

  // eslint-disable-next-line no-console
  console.log(`Created role 'end_client' (id=${saved.id}).`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to seed end_client role:', error.message);
  process.exit(1);
});
