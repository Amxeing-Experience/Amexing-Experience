/**
 * Verification script for Audit Trail System.
 * Tests that hooks are registered and working correctly.
 * Run this AFTER restarting the server with the latest code changes.
 */

require('dotenv').config({
  path: `./environments/.env.${process.env.NODE_ENV || 'development'}`,
});

const Parse = require('parse/node');

// Initialize Parse SDK
Parse.initialize(
  process.env.PARSE_APP_ID,
  null,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function verifyAuditSystem() {
  console.log('\n🔍 Verifying Audit Trail System...\n');

  try {
    // Step 1: Check if server is running
    console.log('1️⃣ Checking Parse Server connection...');
    const healthCheck = new Parse.Query('_User');
    healthCheck.limit(1);
    await healthCheck.find({ useMasterKey: true });
    console.log('   ✅ Parse Server is running\n');

    // Step 2: Check if AuditLog table exists
    console.log('2️⃣ Checking AuditLog table...');
    const AuditLogClass = Parse.Object.extend('AuditLog');
    const auditQuery = new Parse.Query(AuditLogClass);
    auditQuery.limit(1);
    const existingLogs = await auditQuery.find({ useMasterKey: true });
    console.log(`   ✅ AuditLog table exists (${existingLogs.length} logs found)\n`);

    // Step 3: Count total audit logs
    console.log('3️⃣ Counting audit logs in database...');
    const countQuery = new Parse.Query(AuditLogClass);
    const totalLogs = await countQuery.count({ useMasterKey: true });
    console.log(`   📊 Total audit logs: ${totalLogs}\n`);

    if (totalLogs > 0) {
      // Step 4: Show recent audit logs
      console.log('4️⃣ Recent audit logs (last 5):');
      const recentQuery = new Parse.Query(AuditLogClass);
      recentQuery.descending('timestamp');
      recentQuery.limit(5);
      const recentLogs = await recentQuery.find({ useMasterKey: true });

      if (recentLogs.length > 0) {
        recentLogs.forEach((log, index) => {
          console.log(`\n   ${index + 1}. ${log.get('action')} on ${log.get('entityType')}`);
          console.log(`      User: ${log.get('username')} (${log.get('userId')})`);
          console.log(`      Entity ID: ${log.get('entityId')}`);
          console.log(`      Timestamp: ${log.get('timestamp')}`);
          console.log(`      IP: ${log.get('metadata')?.ip || 'N/A'}`);
        });
      }
    }

    // Step 5: Create a test client to verify hooks are working
    console.log('\n\n5️⃣ Testing audit hooks by creating a test client...');
    const Client = Parse.Object.extend('Client');
    const testClient = new Client();

    const testData = {
      name: `Test Client ${Date.now()}`,
      email: 'test@audit-verification.com',
      phone: '+1234567890',
      active: true,
      exists: true,
      isCorporate: false,
    };

    testClient.set('name', testData.name);
    testClient.set('email', testData.email);
    testClient.set('phone', testData.phone);
    testClient.set('active', testData.active);
    testClient.set('exists', testData.exists);
    testClient.set('isCorporate', testData.isCorporate);

    const savedClient = await testClient.save(null, { useMasterKey: true });
    console.log(`   ✅ Test client created: ${savedClient.id}`);

    // Wait a bit for async audit log creation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 6: Verify audit log was created for test client
    console.log('\n6️⃣ Checking if audit log was created for test client...');
    const verifyQuery = new Parse.Query(AuditLogClass);
    verifyQuery.equalTo('entityType', 'Client');
    verifyQuery.equalTo('entityId', savedClient.id);
    verifyQuery.equalTo('action', 'CREATE');
    const auditLog = await verifyQuery.first({ useMasterKey: true });

    if (auditLog) {
      console.log('   ✅ SUCCESS! Audit log created for test client');
      console.log(`      Action: ${auditLog.get('action')}`);
      console.log(`      User: ${auditLog.get('username')}`);
      console.log(`      Timestamp: ${auditLog.get('timestamp')}`);
      console.log('\n✅ ✅ ✅ AUDIT TRAIL SYSTEM IS WORKING! ✅ ✅ ✅\n');
    } else {
      console.log('   ❌ FAILED! No audit log found for test client');
      console.log('\n❌ Audit hooks are NOT executing properly');
      console.log('\nPossible issues:');
      console.log('   1. Server was not restarted after code changes');
      console.log('   2. Hooks failed to register (check server logs)');
      console.log('   3. Hook execution error (check server logs for errors)');
      console.log('\nCheck server logs for:');
      console.log('   - "✅ Audit trail hooks registered successfully"');
      console.log('   - "Registered audit hooks for X classes"');
      console.log('   - Any errors during hook registration\n');
    }

    // Step 7: Clean up test client
    console.log('7️⃣ Cleaning up test client...');
    await savedClient.destroy({ useMasterKey: true });
    console.log('   ✅ Test client deleted\n');

    // Step 8: Final count
    const finalCount = await countQuery.count({ useMasterKey: true });
    console.log(`📊 Final audit log count: ${finalCount}\n`);

  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

// Run verification
verifyAuditSystem()
  .then(() => {
    console.log('Verification complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
