/**
 * Script to test Experience table inflation functionality
 * 
 * Tests that the Experience table is properly included in inflation process
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const Parse = require('parse/node');
const path = require('path');

// Parse Server configuration
require('dotenv').config({ path: path.join(__dirname, '../environments/.env.development') });
Parse.initialize(
  process.env.PARSE_APP_ID || 'CrTRTaJpoJFNt8PJ',
  null,
  process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

/**
 * Test Experience inflation via cloud function
 */
async function testExperienceInflation() {
  console.log('🧪 Testing Experience table inflation...\n');
  
  try {
    // First, get a count of Experience records before inflation
    const beforeQuery = new Parse.Query('Experience');
    beforeQuery.equalTo('active', true);
    beforeQuery.equalTo('exists', true);
    beforeQuery.doesNotExist('valid_until');
    
    const beforeCount = await beforeQuery.count({ useMasterKey: true });
    console.log(`📊 Experience records eligible for inflation: ${beforeCount}`);
    
    if (beforeCount === 0) {
      console.log('⚠️  No Experience records available for inflation testing.');
      console.log('💡 Run create-experience-test-data.js first to create test data.');
      return;
    }
    
    // Get some sample records to track their cost changes
    const sampleRecords = await beforeQuery.limit(3).find({ useMasterKey: true });
    
    console.log('📝 Sample Experience records before inflation:');
    sampleRecords.forEach((record, index) => {
      console.log(`  ${index + 1}. ${record.get('name')}: $${record.get('cost')}`);
    });
    
    console.log('\n🚀 Starting inflation process (5% increase)...');
    
    // Call the inflation cloud function
    const result = await Parse.Cloud.run('iniciarProcesoInflacion', {
      percentage: 5,
    }, {
      useMasterKey: true,
    });
    
    console.log('✅ Inflation process response:', result);
    
    if (result.success) {
      console.log(`\n📊 Inflation completed successfully!`);
      console.log(`🆔 Batch ID: ${result.batchId}`);
      
      // Wait a moment for the background job to complete
      console.log('\n⏳ Waiting for background job to complete...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if Experience records were inflated
      console.log('\n🔍 Checking Experience records after inflation...');
      
      const afterQuery = new Parse.Query('Experience');
      afterQuery.equalTo('inflation_batch_id', result.batchId);
      afterQuery.equalTo('active', true);
      afterQuery.equalTo('exists', true);
      
      const inflatedRecords = await afterQuery.find({ useMasterKey: true });
      
      console.log(`📊 Experience records inflated in this batch: ${inflatedRecords.length}`);
      
      if (inflatedRecords.length > 0) {
        console.log('✅ SUCCESS: Experience table inflation is working!');
        console.log('\n📝 Sample inflated Experience records:');
        
        inflatedRecords.slice(0, 5).forEach((record, index) => {
          const originalCost = record.get('cost') / 1.05; // Reverse calculation
          console.log(`  ${index + 1}. ${record.get('name')}: $${originalCost.toFixed(2)} → $${record.get('cost')}`);
        });
        
        // Test revert functionality
        console.log('\n🔄 Testing revert functionality...');
        
        const revertResult = await Parse.Cloud.run('revertirInflacion', {
          batchId: result.batchId,
        }, {
          useMasterKey: true,
        });
        
        console.log('✅ Revert process response:', revertResult);
        
        if (revertResult.success) {
          console.log('✅ SUCCESS: Experience revert is also working!');
          console.log(`📊 Total records reverted: ${revertResult.totalReverted}`);
        } else {
          console.log('❌ FAILED: Experience revert failed');
          console.log('Error:', revertResult.error);
        }
        
      } else {
        console.log('❌ FAILED: No Experience records were inflated');
        console.log('💡 Check the cloud function logic for Experience table handling');
        
        // Debug: Check if any records match the original query
        const debugQuery = new Parse.Query('Experience');
        debugQuery.equalTo('active', true);
        debugQuery.equalTo('exists', true);
        debugQuery.doesNotExist('valid_until');
        debugQuery.greaterThan('cost', 0);
        
        const debugRecords = await debugQuery.find({ useMasterKey: true });
        console.log(`🔍 Debug: ${debugRecords.length} Experience records found with valid cost > 0`);
        
        if (debugRecords.length > 0) {
          console.log('📝 Sample records that should have been inflated:');
          debugRecords.slice(0, 3).forEach((record, index) => {
            console.log(`  ${index + 1}. ${record.get('name')}: $${record.get('cost')} (Active: ${record.get('active')}, Exists: ${record.get('exists')})`);
          });
        }
      }
      
    } else {
      console.log('❌ FAILED: Inflation process failed');
      console.log('Error:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Error testing Experience inflation:', error.message);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting Experience inflation test...\n');
  
  try {
    await testExperienceInflation();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Experience inflation test completed!`);
    console.log(`⏱️  Duration: ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = { main, testExperienceInflation };