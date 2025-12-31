/**
 * Restore Soft-Deleted Data
 *
 * Restores records that were soft-deleted (exists=false) back to active state
 * Only restores records created before December 31, 2025 (original data)
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

async function restoreDeletedData() {
  console.log('\n♻️  Restoring soft-deleted data...\n');

  try {
    // Define cutoff date: December 31, 2025 00:00:00
    // Only restore data created BEFORE this date (original data)
    const cutoffDate = new Date('2025-12-31T00:00:00.000Z');
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
    console.log(`Will restore records created BEFORE this date\n`);

    // ==========================================
    // RESTORE CLIENTPRICES
    // ==========================================
    console.log('📋 Restoring ClientPrices...');
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const clientPricesQuery = new Parse.Query(ClientPricesClass);
    clientPricesQuery.lessThan('createdAt', cutoffDate);
    clientPricesQuery.equalTo('exists', false);
    clientPricesQuery.limit(10000);

    const clientPricesToRestore = await clientPricesQuery.find({ useMasterKey: true });
    console.log(`   Found ${clientPricesToRestore.length} ClientPrices to restore`);

    for (const cp of clientPricesToRestore) {
      cp.set('exists', true);
      cp.set('active', true);
      await cp.save(null, { useMasterKey: true });
    }
    console.log(`   ✅ Restored ${clientPricesToRestore.length} ClientPrices\n`);

    // ==========================================
    // DELETE DECEMBER 31 DATA (keep soft-deleted)
    // ==========================================
    console.log('📋 Checking for December 31 duplicates...');

    // Check Services
    const ServicesClass = Parse.Object.extend('Services');
    const servicesQuery = new Parse.Query(ServicesClass);
    servicesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    servicesQuery.equalTo('exists', true);
    const dec31Services = await servicesQuery.count({ useMasterKey: true });

    // Check RatePrices
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const ratePricesQuery = new Parse.Query(RatePricesClass);
    ratePricesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    ratePricesQuery.equalTo('exists', true);
    const dec31RatePrices = await ratePricesQuery.count({ useMasterKey: true });

    // Check ClientPrices
    const dec31ClientPricesQuery = new Parse.Query(ClientPricesClass);
    dec31ClientPricesQuery.greaterThanOrEqualTo('createdAt', cutoffDate);
    dec31ClientPricesQuery.equalTo('exists', true);
    const dec31ClientPrices = await dec31ClientPricesQuery.count({ useMasterKey: true });

    console.log(`   Services created on Dec 31: ${dec31Services}`);
    console.log(`   RatePrices created on Dec 31: ${dec31RatePrices}`);
    console.log(`   ClientPrices created on Dec 31: ${dec31ClientPrices}`);

    if (dec31Services > 0 || dec31RatePrices > 0 || dec31ClientPrices > 0) {
      console.log('\n⚠️  Found duplicate data created on Dec 31');
      console.log('   You may want to run cleanup-by-date.js to remove these\n');
    } else {
      console.log('   ✅ No duplicate data found\n');
    }

    // ==========================================
    // FINAL VERIFICATION
    // ==========================================
    console.log('📊 Final Counts:');
    const finalServicesCount = await new Parse.Query(ServicesClass).equalTo('exists', true).count({ useMasterKey: true });
    const finalRatePricesCount = await new Parse.Query(RatePricesClass).equalTo('exists', true).count({ useMasterKey: true });
    const finalClientPricesCount = await new Parse.Query(ClientPricesClass).equalTo('exists', true).count({ useMasterKey: true });

    const AmexingUserClass = Parse.Object.extend('AmexingUser');
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

    console.log('✅ Restore completed successfully!\n');

  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

restoreDeletedData();
