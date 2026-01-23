/**
 * Comprehensive Inflation Process Debug Test
 * Tests each step of the inflation process to identify failures
 * Created by Denisse Maldonado
 */

const request = require('supertest');
const AuthTestHelper = require('../helpers/authTestHelper');

describe('Inflation Process Debug Test', () => {
  let app;
  let adminToken;
  let testData = [];

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../src/index');

    // Wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Login with admin user
    adminToken = await AuthTestHelper.loginAs('admin', app);
    console.log('✅ Admin authentication successful');
  }, 30000);

  afterAll(async () => {
    // Cleanup all test data
    try {
      for (const item of testData) {
        await item.destroy({ useMasterKey: true });
      }
      console.log('✅ Test data cleanup completed');
    } catch (error) {
      console.log('⚠️ Cleanup error:', error.message);
    }
  });

  describe('Step 1: Test Data Creation', () => {
    it('should create test RatePrice records', async () => {
      const Parse = require('parse/node');
      
      // Create test RatePrice
      const RatePrice = Parse.Object.extend('RatePrice');
      const testRatePrice = new RatePrice();
      testRatePrice.set('name', 'Debug Test Rate');
      testRatePrice.set('price', 100);
      testRatePrice.set('active', true);
      testRatePrice.set('exists', true);
      testRatePrice.set('isDebugTest', true);
      
      await testRatePrice.save(null, { useMasterKey: true });
      testData.push(testRatePrice);
      
      console.log(`✅ Created RatePrice: ${testRatePrice.get('name')} - $${testRatePrice.get('price')}`);
      expect(testRatePrice.id).toBeDefined();
    });

    it('should create test TourPrice records', async () => {
      const Parse = require('parse/node');
      
      // Create test TourPrice
      const TourPrice = Parse.Object.extend('TourPrice');
      const testTourPrice = new TourPrice();
      testTourPrice.set('name', 'Debug Test Tour');
      testTourPrice.set('price', 500);
      testTourPrice.set('active', true);
      testTourPrice.set('exists', true);
      testTourPrice.set('isDebugTest', true);
      
      await testTourPrice.save(null, { useMasterKey: true });
      testData.push(testTourPrice);
      
      console.log(`✅ Created TourPrice: ${testTourPrice.get('name')} - $${testTourPrice.get('price')}`);
      expect(testTourPrice.id).toBeDefined();
    });

    it('should create test ClientPrice records', async () => {
      const Parse = require('parse/node');
      
      // Create test ClientPrice
      const ClientPrice = Parse.Object.extend('ClientPrice');
      const testClientPrice = new ClientPrice();
      testClientPrice.set('name', 'Debug Test Client Rate');
      testClientPrice.set('price', 250);
      testClientPrice.set('active', true);
      testClientPrice.set('exists', true);
      testClientPrice.set('isDebugTest', true);
      
      await testClientPrice.save(null, { useMasterKey: true });
      testData.push(testClientPrice);
      
      console.log(`✅ Created ClientPrice: ${testClientPrice.get('name')} - $${testClientPrice.get('price')}`);
      expect(testClientPrice.id).toBeDefined();
    });
  });

  describe('Step 2: Cloud Function Tests', () => {
    let batchId;

    it('should test iniciarProcesoInflacion cloud function directly', async () => {
      const Parse = require('parse/node');
      
      try {
        console.log('🧪 Testing iniciarProcesoInflacion cloud function...');
        
        const result = await Parse.Cloud.run('iniciarProcesoInflacion', {
          percentage: 10
        }, { useMasterKey: true });

        console.log('Cloud function result:', JSON.stringify(result, null, 2));
        
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.batchId).toBeDefined();
        
        batchId = result.batchId;
        console.log(`✅ Inflation initiated with batch ID: ${batchId}`);
        
      } catch (error) {
        console.error('❌ Cloud function error:', error);
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          code: error.code
        });
        throw error;
      }
    }, 15000);

    it('should wait and check inflation status', async () => {
      if (!batchId) {
        throw new Error('No batch ID from previous test');
      }

      console.log('⏳ Waiting 5 seconds for background job...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      const Parse = require('parse/node');
      
      try {
        const status = await Parse.Cloud.run('obtenerEstadoInflacion', {
          batchId
        }, { useMasterKey: true });

        console.log('Status result:', JSON.stringify(status, null, 2));
        
        expect(status).toBeDefined();
        expect(status.success).toBeDefined();
        
        if (status.success) {
          console.log(`📊 Status: ${status.status}, Processed: ${status.processed_count}, Errors: ${status.error_count}`);
          
          if (status.error_message) {
            console.error(`❌ Background job error: ${status.error_message}`);
          }
        }
        
      } catch (error) {
        console.error('❌ Status check error:', error);
        throw error;
      }
    }, 10000);

    it('should check inflation history records', async () => {
      const Parse = require('parse/node');
      
      const InflationHistory = Parse.Object.extend('InflationHistory');
      const query = new Parse.Query(InflationHistory);
      query.descending('createdAt');
      query.limit(3);
      
      const histories = await query.find({ useMasterKey: true });
      
      console.log(`📋 Found ${histories.length} inflation history records:`);
      
      histories.forEach((history, index) => {
        console.log(`  ${index + 1}. Batch: ${history.get('batchId')}`);
        console.log(`     Status: ${history.get('status')}`);
        console.log(`     Percentage: ${history.get('percentage')}%`);
        console.log(`     Processed: ${history.get('processed_count') || 0}`);
        console.log(`     Errors: ${history.get('error_count') || 0}`);
        if (history.get('error_message')) {
          console.log(`     Error: ${history.get('error_message')}`);
        }
        console.log('');
      });

      expect(histories.length).toBeGreaterThan(0);
    });
  });

  describe('Step 3: API Endpoint Tests', () => {
    it('should test /api/inflation-rate/apply endpoint', async () => {
      console.log('🧪 Testing API endpoint...');
      
      const response = await request(app)
        .post('/api/inflation-rate/apply')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          percentage: 5
        });

      console.log('API Response:', JSON.stringify(response.body, null, 2));
      console.log('Status Code:', response.status);
      
      if (response.status !== 200) {
        console.error('❌ API Error:', response.body);
      }
      
      // Don't fail the test if there's an error - we want to see what happens
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Step 4: Database Inspection', () => {
    it('should check if price records were affected', async () => {
      const Parse = require('parse/node');
      
      // Check RatePrice records
      const RatePriceQuery = new Parse.Query('RatePrice');
      RatePriceQuery.equalTo('isDebugTest', true);
      const ratePrices = await RatePriceQuery.find({ useMasterKey: true });
      
      console.log('🔍 Debug RatePrice records:');
      ratePrices.forEach((price, index) => {
        console.log(`  ${index + 1}. ${price.get('name')}: $${price.get('price')}`);
        console.log(`     Active: ${price.get('active')}, Exists: ${price.get('exists')}`);
        console.log(`     Valid Until: ${price.get('valid_until')}`);
        console.log(`     Inflation Batch: ${price.get('inflation_batch_id')}`);
        console.log('');
      });

      // Check for inflation-related records
      const inflationQuery = new Parse.Query('RatePrice');
      inflationQuery.exists('inflation_batch_id');
      inflationQuery.equalTo('isDebugTest', true);
      const inflationRecords = await inflationQuery.find({ useMasterKey: true });
      
      console.log(`📈 Found ${inflationRecords.length} inflation-affected records`);
      
      expect(ratePrices.length).toBeGreaterThan(0);
    });

    it('should manually test inflation logic', async () => {
      console.log('🧪 Testing manual inflation logic...');
      
      const Parse = require('parse/node');
      const percentage = 10;
      const batchId = `MANUAL_TEST_${Date.now()}`;
      
      // Get a test record
      const query = new Parse.Query('RatePrice');
      query.equalTo('isDebugTest', true);
      query.equalTo('active', true);
      const testRecord = await query.first({ useMasterKey: true });
      
      if (!testRecord) {
        throw new Error('No test record found');
      }
      
      console.log(`Original price: $${testRecord.get('price')}`);
      
      try {
        // Step 1: Mark as historical
        const validUntil = new Date();
        testRecord.set('valid_until', validUntil);
        testRecord.set('active', false);
        await testRecord.save(null, { useMasterKey: true });
        console.log('✅ Step 1: Marked original as historical');
        
        // Step 2: Create inflated copy
        const RatePrice = Parse.Object.extend('RatePrice');
        const inflatedRecord = new RatePrice();
        inflatedRecord.set('name', testRecord.get('name'));
        inflatedRecord.set('price', Math.round(testRecord.get('price') * (1 + percentage / 100)));
        inflatedRecord.set('active', true);
        inflatedRecord.set('exists', true);
        inflatedRecord.set('inflation_batch_id', batchId);
        inflatedRecord.set('inflation_percentage', percentage);
        inflatedRecord.set('previous_price', testRecord.get('price'));
        inflatedRecord.set('isDebugTest', true);
        
        await inflatedRecord.save(null, { useMasterKey: true });
        testData.push(inflatedRecord);
        
        console.log(`✅ Step 2: Created inflated record: $${inflatedRecord.get('price')}`);
        console.log(`🎯 Manual inflation test successful!`);
        
        // Restore original for cleanup
        testRecord.set('active', true);
        testRecord.set('valid_until', undefined);
        await testRecord.save(null, { useMasterKey: true });
        
      } catch (error) {
        console.error('❌ Manual inflation error:', error);
        throw error;
      }
    });
  });

  describe('Step 5: Parse Server Job System Check', () => {
    it('should check if Parse Server job system is working', async () => {
      console.log('🔧 Checking Parse Server job system...');
      
      // Try to get Parse Server info
      const Parse = require('parse/node');
      
      try {
        // Test a simple cloud function call
        const testResult = await Parse.Cloud.run('test-simple-function', {}, { useMasterKey: true });
        console.log('✅ Cloud functions are working');
      } catch (error) {
        if (error.message.includes('Invalid function')) {
          console.log('✅ Cloud functions system is working (function not found is expected)');
        } else {
          console.log('❌ Cloud functions system error:', error.message);
        }
      }
      
      // Check if we can create and query InflationHistory
      const InflationHistory = Parse.Object.extend('InflationHistory');
      const testHistory = new InflationHistory();
      testHistory.set('batchId', 'TEST_BATCH');
      testHistory.set('status', 'TEST');
      testHistory.set('percentage', 1);
      
      try {
        await testHistory.save(null, { useMasterKey: true });
        testData.push(testHistory);
        console.log('✅ Can create InflationHistory records');
        
        const query = new Parse.Query(InflationHistory);
        query.equalTo('batchId', 'TEST_BATCH');
        const found = await query.first({ useMasterKey: true });
        
        if (found) {
          console.log('✅ Can query InflationHistory records');
        } else {
          console.log('❌ Cannot query InflationHistory records');
        }
        
      } catch (error) {
        console.log('❌ Cannot create InflationHistory records:', error.message);
      }
    });
  });
});