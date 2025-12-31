/**
 * Cleanup by Creation Date
 *
 * Removes all records created on December 31, 2025 (test data)
 * Keeps only records created before December 31, 2025
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

async function cleanupByDate() {
  console.log('\n🧹 Cleaning up records created on December 31, 2025...\n');

  try {
    // Define cutoff date: December 31, 2025 00:00:00
    const cutoffDate = new Date('2025-12-31T00:00:00.000Z');
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
    console.log(`Will delete all records created on or after this date\n`);

    // ==========================================
    // CLEANUP SERVICES
    // ==========================================
    console.log('📋 Cleaning up Services...');
    const ServicesClass = Parse.Object.extend('Services');
    const servicesQuery = new Parse.Query(ServicesClass);
    servicesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    servicesQuery.equalTo('exists', true);
    servicesQuery.limit(10000);

    const servicesToDelete = await servicesQuery.find({ useMasterKey: true });
    console.log(`   Found ${servicesToDelete.length} Services to delete`);

    for (const service of servicesToDelete) {
      service.set('exists', false);
      service.set('active', false);
      await service.save(null, { useMasterKey: true });
    }
    console.log(`   ✅ Deleted ${servicesToDelete.length} Services\n`);

    // ==========================================
    // CLEANUP RATEPRICES
    // ==========================================
    console.log('📋 Cleaning up RatePrices...');
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const ratePricesQuery = new Parse.Query(RatePricesClass);
    ratePricesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    ratePricesQuery.equalTo('exists', true);
    ratePricesQuery.limit(10000);

    const ratePricesToDelete = await ratePricesQuery.find({ useMasterKey: true });
    console.log(`   Found ${ratePricesToDelete.length} RatePrices to delete`);

    for (const rp of ratePricesToDelete) {
      rp.set('exists', false);
      rp.set('active', false);
      await rp.save(null, { useMasterKey: true });
    }
    console.log(`   ✅ Deleted ${ratePricesToDelete.length} RatePrices\n`);

    // ==========================================
    // CLEANUP CLIENTPRICES
    // ==========================================
    console.log('📋 Cleaning up ClientPrices...');
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const clientPricesQuery = new Parse.Query(ClientPricesClass);
    clientPricesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    clientPricesQuery.equalTo('exists', true);
    clientPricesQuery.limit(10000);

    const clientPricesToDelete = await clientPricesQuery.find({ useMasterKey: true });
    console.log(`   Found ${clientPricesToDelete.length} ClientPrices to delete`);

    for (const cp of clientPricesToDelete) {
      cp.set('exists', false);
      cp.set('active', false);
      await cp.save(null, { useMasterKey: true });
    }
    console.log(`   ✅ Deleted ${clientPricesToDelete.length} ClientPrices\n`);

    // ==========================================
    // CLEANUP CLIENT USERS
    // ==========================================
    console.log('📋 Cleaning up Client Users...');
    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    const usersQuery = new Parse.Query(AmexingUserClass);
    usersQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    usersQuery.equalTo('exists', true);
    usersQuery.include('roleId');
    usersQuery.limit(10000);

    const usersToDelete = await usersQuery.find({ useMasterKey: true });

    // Filter only client users (department_manager)
    const clientUsersToDelete = usersToDelete.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log(`   Found ${usersToDelete.length} total users, ${clientUsersToDelete.length} are client users`);

    for (const user of clientUsersToDelete) {
      user.set('exists', false);
      user.set('active', false);
      await user.save(null, { useMasterKey: true });
    }
    console.log(`   ✅ Deleted ${clientUsersToDelete.length} Client Users\n`);

    // ==========================================
    // FINAL VERIFICATION
    // ==========================================
    console.log('📊 Final Counts:');
    const finalServicesCount = await new Parse.Query(ServicesClass).equalTo('exists', true).count({ useMasterKey: true });
    const finalRatePricesCount = await new Parse.Query(RatePricesClass).equalTo('exists', true).count({ useMasterKey: true });
    const finalClientPricesCount = await new Parse.Query(ClientPricesClass).equalTo('exists', true).count({ useMasterKey: true });

    const finalUsersQuery = new Parse.Query(AmexingUserClass);
    finalUsersQuery.include('roleId');
    finalUsersQuery.equalTo('exists', true);
    const finalAllUsers = await finalUsersQuery.find({ useMasterKey: true });
    const finalClientUsers = finalAllUsers.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log(`   Services: ${finalServicesCount} ${finalServicesCount === 69 ? '✅' : '⚠️'}`);
    console.log(`   RatePrices: ${finalRatePricesCount} ${finalRatePricesCount === 621 ? '✅' : '⚠️'}`);
    console.log(`   ClientPrices: ${finalClientPricesCount} ${finalClientPricesCount >= 159 ? '✅' : '⚠️'}`);
    console.log(`   Client Users: ${finalClientUsers.length} ${finalClientUsers.length >= 8 && finalClientUsers.length <= 9 ? '✅' : '⚠️'}`);
    console.log('');

    console.log('✅ Cleanup completed successfully!\n');

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

cleanupByDate();
