/**
 * Cleanup Duplicate Client Users
 *
 * Keeps only the 8 valid client users from CLIENT_MAPPING
 * Soft-deletes all other department_manager users
 */

const Parse = require('parse/node');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });

Parse.initialize(
  process.env.PARSE_APP_ID || 'amexingAppId',
  process.env.PARSE_JS_KEY || 'amexingJSKey',
  process.env.PARSE_MASTER_KEY || 'amexingMasterKey'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

// Valid client emails from CLIENT_MAPPING in seed 022
const VALID_CLIENT_EMAILS = [
  'manager@dev.amexing.com',
  'abercrombie.cliente.d494ab3a@temp.amexing.com',
  'proserpina.cliente.4e41fdb0@temp.amexing.com',
  'clevia.cliente.3ce24980@temp.amexing.com',
  'godandi&sons.cliente.0f002a74@temp.amexing.com',
  'jaunt.cliente.0da32f2b@temp.amexing.com',
  'journeymexico.cliente.3b44d429@temp.amexing.com',
  'wanderer.cliente.dbba9d4d@temp.amexing.com'
];

async function cleanupDuplicateUsers() {
  console.log('\n🧹 Cleaning up duplicate client users...\n');
  console.log('Valid client emails:');
  VALID_CLIENT_EMAILS.forEach(email => console.log(`  - ${email}`));
  console.log('');

  try {
    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    const query = new Parse.Query(AmexingUserClass);
    query.include('roleId');
    query.equalTo('exists', true);
    query.limit(1000);

    const allUsers = await query.find({ useMasterKey: true });

    // Filter only department_manager client users
    const clientUsers = allUsers.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log(`Found ${clientUsers.length} department_manager client users\n`);

    let deletedCount = 0;
    let keptCount = 0;

    for (const user of clientUsers) {
      const email = user.get('email');

      if (VALID_CLIENT_EMAILS.includes(email)) {
        console.log(`  ✅ Keeping: ${email}`);
        keptCount++;
      } else {
        console.log(`  ❌ Deleting: ${email}`);
        user.set('exists', false);
        user.set('active', false);
        await user.save(null, { useMasterKey: true });
        deletedCount++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Kept: ${keptCount} users`);
    console.log(`   Deleted: ${deletedCount} users\n`);

    // Final verification
    const finalQuery = new Parse.Query(AmexingUserClass);
    finalQuery.include('roleId');
    finalQuery.equalTo('exists', true);
    const finalAllUsers = await finalQuery.find({ useMasterKey: true });
    const finalClientUsers = finalAllUsers.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log(`📋 Final Count: ${finalClientUsers.length} client users ${finalClientUsers.length >= 8 && finalClientUsers.length <= 9 ? '✅' : '⚠️'}\n`);

    if (finalClientUsers.length >= 8 && finalClientUsers.length <= 9) {
      console.log('✅ Cleanup completed successfully!\n');
    } else {
      console.log(`⚠️  Warning: Expected 8-9 users, got ${finalClientUsers.length}\n`);
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

cleanupDuplicateUsers();
