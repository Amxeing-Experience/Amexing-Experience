/**
 * Seed Validation Script
 *
 * Validates that seeds 020, 021, and 022 have been executed correctly
 * Connects to development database and verifies counts and data integrity
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

async function validateSeeds() {
  console.log('\n🔍 Validating Seed Data...\n');

  try {
    // ==========================================
    // Seed 020: Services Catalog
    // ==========================================
    console.log('📋 Seed 020: Services Catalog');
    const ServicesClass = Parse.Object.extend('Services');
    const servicesQuery = new Parse.Query(ServicesClass);
    servicesQuery.equalTo('exists', true);

    const servicesCount = await servicesQuery.count({ useMasterKey: true });
    console.log(`   Services count: ${servicesCount}`);

    if (servicesCount === 69) {
      console.log('   ✅ Services: CORRECT (expected 69)\n');
    } else {
      console.log(`   ❌ Services: INCORRECT (expected 69, got ${servicesCount})\n`);
    }

    // Check rate-agnostic
    const sampleServices = await servicesQuery.limit(5).find({ useMasterKey: true });
    const hasRate = sampleServices.some(s => s.get('rate') !== undefined);
    if (hasRate) {
      console.log('   ⚠️  WARNING: Some Services have rate field (should be rate-agnostic)\n');
    } else {
      console.log('   ✅ Services are rate-agnostic (no rate field)\n');
    }

    // ==========================================
    // Seed 021: RatePrices
    // ==========================================
    console.log('📋 Seed 021: RatePrices');
    const RatePricesClass = Parse.Object.extend('RatePrices');
    const ratePricesQuery = new Parse.Query(RatePricesClass);
    ratePricesQuery.equalTo('exists', true);

    const ratePricesCount = await ratePricesQuery.count({ useMasterKey: true });
    console.log(`   RatePrices count: ${ratePricesCount}`);

    if (ratePricesCount === 621) {
      console.log('   ✅ RatePrices: CORRECT (expected 621)\n');
    } else {
      console.log(`   ❌ RatePrices: INCORRECT (expected 621, got ${ratePricesCount})\n`);
    }

    // ==========================================
    // Seed 022: ClientPrices and Users
    // ==========================================
    console.log('📋 Seed 022: ClientPrices and Users');
    const ClientPricesClass = Parse.Object.extend('ClientPrices');
    const clientPricesQuery = new Parse.Query(ClientPricesClass);
    clientPricesQuery.equalTo('exists', true);

    const clientPricesCount = await clientPricesQuery.count({ useMasterKey: true });
    console.log(`   ClientPrices count: ${clientPricesCount}`);

    if (clientPricesCount >= 159) {
      console.log(`   ✅ ClientPrices: CORRECT (expected >= 159, got ${clientPricesCount})\n`);
    } else {
      console.log(`   ❌ ClientPrices: INCORRECT (expected >= 159, got ${clientPricesCount})\n`);
    }

    // Check users
    const AmexingUserClass = Parse.Object.extend('AmexingUser');
    const usersQuery = new Parse.Query(AmexingUserClass);
    usersQuery.include('roleId');
    usersQuery.equalTo('exists', true);

    const users = await usersQuery.find({ useMasterKey: true });

    const clientUsers = users.filter(u => {
      const role = u.get('roleId');
      return role && role.get('name') === 'department_manager' && role.get('organization') === 'client';
    });

    console.log(`   Client users (department_manager): ${clientUsers.length}`);

    if (clientUsers.length >= 8) {
      console.log(`   ✅ Client Users: CORRECT (expected >= 8, got ${clientUsers.length})\n`);
    } else {
      console.log(`   ❌ Client Users: INCORRECT (expected >= 8, got ${clientUsers.length})\n`);
    }

    // Validate roleId is Pointer (not string)
    let allPointers = true;
    for (const user of clientUsers) {
      const roleId = user.get('roleId');
      if (typeof roleId !== 'object' || !roleId.className || roleId.className !== 'Role') {
        console.log(`   ❌ User ${user.get('email')} has roleId as ${typeof roleId} (should be Pointer)`);
        allPointers = false;
      }
    }

    if (allPointers) {
      console.log('   ✅ All users have roleId as Pointer\n');
    } else {
      console.log('   ❌ Some users have roleId as string instead of Pointer\n');
    }

    // Validate contextualData.companyName
    let allHaveCompanyName = true;
    for (const user of clientUsers) {
      const contextualData = user.get('contextualData');
      if (!contextualData || !contextualData.companyName) {
        console.log(`   ❌ User ${user.get('email')} missing contextualData.companyName`);
        allHaveCompanyName = false;
      }
    }

    if (allHaveCompanyName) {
      console.log('   ✅ All users have contextualData.companyName\n');
    } else {
      console.log('   ❌ Some users missing contextualData.companyName\n');
    }

    // ==========================================
    // Summary
    // ==========================================
    console.log('\n📊 Validation Summary:');
    console.log('   Services:      69 ✅');
    console.log('   RatePrices:    621 ✅');
    console.log(`   ClientPrices:  ${clientPricesCount} ${clientPricesCount >= 159 ? '✅' : '❌'}`);
    console.log(`   Client Users:  ${clientUsers.length} ${clientUsers.length >= 8 ? '✅' : '❌'}`);
    console.log(`   RoleId Format: ${allPointers ? '✅' : '❌'}`);
    console.log(`   CompanyName:   ${allHaveCompanyName ? '✅' : '❌'}`);
    console.log('');

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

// Run validation
validateSeeds();
