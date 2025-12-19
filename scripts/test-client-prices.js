/**
 * Test script for ClientPrices functionality
 * 
 * This script tests the creation and retrieval of client-specific prices
 * for services in the ClientPrices table.
 */

const Parse = require('parse/node');

// Load environment variables
require('dotenv').config({ path: './environments/.env.development' });

// Configure Parse
Parse.initialize(
    process.env.PARSE_APP_ID || 'AMX2024',
    process.env.PARSE_JAVASCRIPT_KEY || 'jsKey2024',
    process.env.PARSE_MASTER_KEY || 'masterKey2024'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY || 'masterKey2024';

async function testClientPrices() {
    console.log('🧪 Testing ClientPrices functionality...\n');

    try {
        // Test creating a ClientPrices entry
        const ClientPrices = Parse.Object.extend('ClientPrices');
        const testPrice = new ClientPrices();

        // Create test pointers (these would normally be real IDs from your database)
        const AmexingUser = Parse.Object.extend('AmexingUser');
        const clientPointer = new AmexingUser();
        clientPointer.id = 'TEST_CLIENT_ID';

        const Rate = Parse.Object.extend('Rate');
        const ratePointer = new Rate();
        ratePointer.id = 'TEST_RATE_ID';

        const VehicleType = Parse.Object.extend('VehicleType');
        const vehiclePointer = new VehicleType();
        vehiclePointer.id = 'TEST_VEHICLE_ID';

        // Set the fields
        testPrice.set('clientPtr', clientPointer);
        testPrice.set('ratePtr', ratePointer);
        testPrice.set('vehiclePtr', vehiclePointer);
        testPrice.set('itemType', 'SERVICES');
        testPrice.set('itemId', 'TEST_SERVICE_ID');
        testPrice.set('precio', 1500);
        testPrice.set('basePrice', 1200);
        testPrice.set('currency', 'MXN');
        testPrice.set('active', true);
        testPrice.set('exists', true);

        console.log('📝 Creating test ClientPrices entry...');
        const saved = await testPrice.save(null, { useMasterKey: true });
        console.log('✅ ClientPrices entry created successfully!');
        console.log('   ID:', saved.id);
        console.log('   Price:', saved.get('precio'));
        console.log('   Item Type:', saved.get('itemType'));
        console.log('');

        // Test querying ClientPrices
        console.log('🔍 Querying ClientPrices table...');
        const query = new Parse.Query(ClientPrices);
        query.equalTo('itemType', 'SERVICES');
        query.equalTo('exists', true);
        query.limit(5);

        const results = await query.find({ useMasterKey: true });
        console.log(`✅ Found ${results.length} ClientPrices entries`);
        
        results.forEach((price, index) => {
            console.log(`   ${index + 1}. Price: ${price.get('precio')} ${price.get('currency')}, Item: ${price.get('itemId')}`);
        });
        console.log('');

        // Clean up test data
        console.log('🧹 Cleaning up test data...');
        await saved.destroy({ useMasterKey: true });
        console.log('✅ Test data cleaned up successfully');
        console.log('');

        console.log('🎉 All tests passed successfully!');
        console.log('   The ClientPrices table is working correctly.');
        console.log('   You can now use the "Configurar" button in the client dashboard');
        console.log('   to save custom prices for services.');

    } catch (error) {
        console.error('❌ Error during testing:', error);
        console.error('   Error details:', error.message);
        
        if (error.code === 119) {
            console.log('\n⚠️  The ClientPrices table might not exist in the database yet.');
            console.log('   It will be created automatically when you first save a client price.');
        }
    }
}

// Run the test
testClientPrices().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});