/**
 * Parse Platform Global Test Teardown
 * Cleans up test environment after all tests complete
 */

module.exports = async () => {
  console.log('\n🧹 Starting Parse Platform global test teardown...');

  // Clean up test-specific environment variables
  delete process.env.PARSE_TEST_MODE;
  delete process.env.MONGODB_URI_TEST;

  console.log('   ✅ Parse Platform global teardown complete');
  console.log('   📊 All Parse Platform tests finished\n');
};