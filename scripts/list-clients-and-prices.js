#!/usr/bin/env node
/**
 * Script to list all clients and their pricing data
 */

require('dotenv').config({
  path: require('path').join(__dirname, '../environments/.env.development')
});

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function listClientsAndPrices() {
  try {
    console.log('\n🔍 LISTING ALL CLIENTS AND PRICING DATA\n');
    console.log('=' .repeat(60));
    
    // 1. List all AmexingUser records that are clients (companies)
    const clientOrgQuery = new Parse.Query('AmexingUser');
    clientOrgQuery.exists('companyName');
    clientOrgQuery.equalTo('active', true);
    clientOrgQuery.equalTo('exists', true);
    clientOrgQuery.limit(10);
    const clientOrgs = await clientOrgQuery.find({ useMasterKey: true });
    
    console.log('\n🏢 Client Organizations Found:', clientOrgs.length);
    
    for (const org of clientOrgs) {
      console.log('\n' + '-'.repeat(40));
      console.log('Organization:', org.get('companyName'));
      console.log('  - ID:', org.id);
      console.log('  - Email:', org.get('email'));
      
      // Check for users with this clientId
      const userQuery = new Parse.Query(Parse.User);
      userQuery.equalTo('clientId', org.id);
      const userCount = await userQuery.count({ useMasterKey: true });
      console.log('  - Associated Users:', userCount);
      
      // Check for ClientPrices
      const clientPricesQuery = new Parse.Query('ClientPrices');
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const clientPointer = new AmexingUser();
      clientPointer.id = org.id;
      
      clientPricesQuery.equalTo('clientPtr', clientPointer);
      clientPricesQuery.equalTo('itemType', 'SERVICES');
      clientPricesQuery.equalTo('exists', true);
      clientPricesQuery.equalTo('active', true);
      clientPricesQuery.doesNotExist('valid_until');
      
      const priceCount = await clientPricesQuery.count({ useMasterKey: true });
      console.log('  - Custom Service Prices:', priceCount);
      
      if (priceCount > 0) {
        // Get sample price
        clientPricesQuery.limit(1);
        clientPricesQuery.include(['ratePtr', 'vehiclePtr']);
        const samplePrice = await clientPricesQuery.first({ useMasterKey: true });
        if (samplePrice) {
          const rate = samplePrice.get('ratePtr');
          const vehicle = samplePrice.get('vehiclePtr');
          console.log('  - Sample Price:');
          console.log('    • Rate:', rate ? rate.get('name') : 'N/A');
          console.log('    • Vehicle:', vehicle ? vehicle.get('name') : 'N/A');
          console.log('    • Price:', samplePrice.get('precio'), 'MXN');
        }
      }
    }
    
    // 2. List all users with role 'client'
    console.log('\n' + '=' .repeat(60));
    console.log('\n👥 USERS WITH CLIENT ROLE\n');
    
    const clientUserQuery = new Parse.Query(Parse.User);
    clientUserQuery.equalTo('role', 'client');
    clientUserQuery.limit(10);
    const clientUsers = await clientUserQuery.find({ useMasterKey: true });
    
    console.log('Client Users Found:', clientUsers.length);
    
    clientUsers.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.get('username')} (${user.get('email')})`);
      console.log('   - User ID:', user.id);
      console.log('   - ClientId field:', user.get('clientId') || 'NOT SET');
      console.log('   - Role:', user.get('role'));
    });
    
    // 3. Summary of ClientPrices table
    console.log('\n' + '=' .repeat(60));
    console.log('\n💰 CLIENT PRICES SUMMARY\n');
    
    const allPricesQuery = new Parse.Query('ClientPrices');
    allPricesQuery.equalTo('itemType', 'SERVICES');
    allPricesQuery.equalTo('exists', true);
    allPricesQuery.equalTo('active', true);
    allPricesQuery.doesNotExist('valid_until');
    const totalServicePrices = await allPricesQuery.count({ useMasterKey: true });
    
    console.log('Total Active Service Client Prices:', totalServicePrices);
    
    // Get unique clients with prices
    allPricesQuery.limit(100);
    allPricesQuery.include(['clientPtr']);
    const prices = await allPricesQuery.find({ useMasterKey: true });
    
    const uniqueClients = new Set();
    prices.forEach(price => {
      const client = price.get('clientPtr');
      if (client) {
        uniqueClients.add(client.id);
      }
    });
    
    console.log('Unique Clients with Custom Prices:', uniqueClients.size);
    
    console.log('\n' + '=' .repeat(60));
    console.log('\n✅ Listing Complete\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the script
listClientsAndPrices();