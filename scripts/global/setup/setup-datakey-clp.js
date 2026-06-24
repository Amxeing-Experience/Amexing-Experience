/**
 * setup-datakey-clp - Locks the DataKey class to master-key-only access.
 *
 * The DataKey collection holds KEK-wrapped DEKs (PCI DSS 3.6.1.2). It must never be
 * readable via REST/LiveQuery — only the server (master key) may touch it. Idempotent:
 * safe to re-run in any environment. Run after the class first exists.
 *
 *   NODE_ENV=staging node scripts/global/setup/setup-datakey-clp.js
 */

require('dotenv').config({ path: `./environments/.env.${process.env.NODE_ENV || 'development'}` });
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

async function run() {
  const schema = new Parse.Schema('DataKey');
  schema.setCLP({
    find: {}, count: {}, get: {}, create: {}, update: {}, delete: {}, addField: {},
    protectedFields: { '*': ['wrappedDek'] },
  });
  await schema.update({ useMasterKey: true });
  // eslint-disable-next-line no-console
  console.log('DataKey CLP set to master-key-only.');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to set DataKey CLP:', error.message);
  process.exit(1);
});
