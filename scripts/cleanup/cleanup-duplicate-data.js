/**
 * Cleanup Duplicate Data Script
 *
 * Removes duplicate data created during testing in development environment
 * Specifically cleans up extra Services, RatePrices, and ClientPrices
 *
 * USAGE:
 *   node scripts/cleanup/cleanup-duplicate-data.js
 */

const Parse = require('parse/node');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });

// Initialize Parse with development credentials
Parse.initialize(
  process.env.PARSE_APP_ID || 'amexingAppId',
  process.env.PARSE_JS_KEY || 'amexingJSKey',
  process.env.PARSE_MASTER_KEY || 'amexingMasterKey'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function cleanupDuplicateData() {
  console.log('\n🧹 Starting Data Cleanup...\n');

  try {
    // Ask for confirmation
    console.log('⚠️  WARNING: This will delete duplicate data from DEVELOPMENT database');
    console.log('   Database: AmexingDEV');
    console.log('   Server: http://localhost:1337/parse\n');

    console.log('This script will:');
    console.log('   1. Keep only 69 Services (remove extras)');
    console.log('   2. Keep only 621 RatePrices (remove extras)');
    console.log('   3. Keep only 159 ClientPrices from first 8 clients (remove extras)');
    console.log('   4. Keep only 8 department_manager client users\n');

    // Get current counts
    const ServicesClass = Parse.Object.extend('Services');
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const AmexingUserClass = Parse.Object.extend('AmexingUser');

    const servicesCount = await new Parse.Query(ServicesClass).equalTo('exists', true).count({ useMasterKey: true });
    const ratePricesCount = await new Parse.Query(RatePricesClass).equalTo('exists', true).count({ useMasterKey: true });
    const clientPricesCount = await new Parse.Query(ClientPricesClass).equalTo('exists', true).count({ useMasterKey: true });

    const usersQuery = new Parse.Query(AmexingUserClass);
    usersQuery.include('roleId');
    usersQuery.equalTo('exists', true);
    const allUsers = await usersQuery.find({ useMasterKey: true });
    const clientUsers = allUsers.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log('📊 Current Counts:');
    console.log(`   Services: ${servicesCount} (expected: 69)`);
    console.log(`   RatePrices: ${ratePricesCount} (expected: 621)`);
    console.log(`   ClientPrices: ${clientPricesCount} (expected: 159)`);
    console.log(`   Client Users: ${clientUsers.length} (expected: 8-9)\n`);

    if (servicesCount <= 69 && ratePricesCount <= 621 && clientPricesCount <= 159 && clientUsers.length <= 9) {
      console.log('✅ No cleanup needed - counts are within expected ranges\n');
      process.exit(0);
    }

    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ==========================================
    // CLEANUP SERVICES
    // ==========================================
    if (servicesCount > 69) {
      console.log('\n📋 Cleaning up Services...');
      const servicesToKeep = 69;
      const servicesToDelete = servicesCount - servicesToKeep;

      // Get all services sorted by createdAt (keep oldest ones - they are the correct ones)
      const servicesQuery = new Parse.Query(ServicesClass);
      servicesQuery.equalTo('exists', true);
      servicesQuery.ascending('createdAt');
      servicesQuery.limit(10000);
      const allServices = await servicesQuery.find({ useMasterKey: true });

      // Mark extras as deleted (logical deletion)
      const extras = allServices.slice(servicesToKeep);
      for (const service of extras) {
        service.set('exists', false);
        service.set('active', false);
        await service.save(null, { useMasterKey: true });
      }

      console.log(`   ✅ Marked ${servicesToDelete} extra Services as deleted (kept oldest ${servicesToKeep})`);
    }

    // ==========================================
    // CLEANUP RATEPRICES
    // ==========================================
    if (ratePricesCount > 621) {
      console.log('\n📋 Cleaning up RatePrices...');
      const ratePricesToKeep = 621;
      const ratePricesToDelete = ratePricesCount - ratePricesToKeep;

      const ratePricesQuery = new Parse.Query(RatePricesClass);
      ratePricesQuery.equalTo('exists', true);
      ratePricesQuery.ascending('createdAt');
      ratePricesQuery.limit(10000);
      const allRatePrices = await ratePricesQuery.find({ useMasterKey: true });

      const extras = allRatePrices.slice(ratePricesToKeep);
      for (const rp of extras) {
        rp.set('exists', false);
        rp.set('active', false);
        await rp.save(null, { useMasterKey: true });
      }

      console.log(`   ✅ Marked ${ratePricesToDelete} extra RatePrices as deleted (kept oldest ${ratePricesToKeep})`);
    }

    // ==========================================
    // CLEANUP CLIENTPRICES
    // ==========================================
    if (clientPricesCount > 159) {
      console.log('\n📋 Cleaning up ClientPrices...');

      // Get the 8 main client indexes
      const validClientIndexes = ['1', '2', '3', '4', '5', '6', '7', '8'];

      const clientPricesQuery = new Parse.Query(ClientPricesClass);
      clientPricesQuery.equalTo('exists', true);
      clientPricesQuery.limit(10000);
      const allClientPrices = await clientPricesQuery.find({ useMasterKey: true });

      let deletedCount = 0;
      for (const cp of allClientPrices) {
        const clientIndex = cp.get('clientIndex');
        // Delete if not in valid indexes OR if duplicate
        if (!validClientIndexes.includes(clientIndex)) {
          cp.set('exists', false);
          cp.set('active', false);
          await cp.save(null, { useMasterKey: true });
          deletedCount++;
        }
      }

      // Also handle duplicates within valid indexes
      const seenCombinations = new Set();
      for (const cp of allClientPrices) {
        const clientIndex = cp.get('clientIndex');
        if (!validClientIndexes.includes(clientIndex)) continue;

        const itemId = cp.get('itemId');
        const ratePtr = cp.get('ratePtr');
        const vehiclePtr = cp.get('vehiclePtr');
        const combo = `${clientIndex}-${itemId}-${ratePtr?.id}-${vehiclePtr?.id}`;

        if (seenCombinations.has(combo)) {
          cp.set('exists', false);
          cp.set('active', false);
          await cp.save(null, { useMasterKey: true });
          deletedCount++;
        } else {
          seenCombinations.add(combo);
        }
      }

      console.log(`   ✅ Marked ${deletedCount} extra ClientPrices as deleted`);
    }

    // ==========================================
    // CLEANUP CLIENT USERS
    // ==========================================
    if (clientUsers.length > 9) {
      console.log('\n📋 Cleaning up Client Users...');

      // Keep only users with emails from CLIENT_MAPPING
      const validEmails = [
        'manager@dev.amexing.com',
        'abercrombie.cliente.d494ab3a@temp.amexing.com',
        'proserpina.cliente.4e41fdb0@temp.amexing.com',
        'clevia.cliente.3ce24980@temp.amexing.com',
        'godandi&sons.cliente.0f002a74@temp.amexing.com',
        'jaunt.cliente.0da32f2b@temp.amexing.com',
        'journeymexico.cliente.3b44d429@temp.amexing.com',
        'wanderer.cliente.dbba9d4d@temp.amexing.com'
      ];

      let deletedUsers = 0;
      for (const user of clientUsers) {
        const email = user.get('email');
        if (!validEmails.includes(email)) {
          user.set('exists', false);
          user.set('active', false);
          await user.save(null, { useMasterKey: true });
          deletedUsers++;
        }
      }

      console.log(`   ✅ Marked ${deletedUsers} extra client users as deleted`);
    }

    // ==========================================
    // FINAL VERIFICATION
    // ==========================================
    console.log('\n📊 Final Counts:');
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
    console.log(`   ClientPrices: ${finalClientPricesCount} ${finalClientPricesCount >= 159 && finalClientPricesCount <= 159 ? '✅' : '⚠️'}`);
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

// Run cleanup
cleanupDuplicateData();
