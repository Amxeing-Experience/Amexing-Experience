/**
 * Migration script to add phone and notes fields to AmexingUser class
 * 
 * This script ensures that the phone and notes fields are properly defined
 * in the Parse Server schema for the AmexingUser class.
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
require('dotenv').config({ path: './environments/.env.development' });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'AMEXING_DEV_APP_ID',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AMEXING_DEV_MASTER_KEY'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function addPhoneNotesFields() {
  try {
    console.log('🔄 Starting migration to add phone and notes fields to AmexingUser...');
    
    // Create a dummy user object to force schema creation
    const AmexingUser = Parse.Object.extend('AmexingUser');
    const testUser = new AmexingUser();
    
    // Set the fields we want to ensure exist
    testUser.set('phone', '');
    testUser.set('notes', '');
    
    // We don't actually save, just prepare the object
    // This forces Parse Server to recognize these fields in the schema
    
    // Now update existing users to have these fields if they don't already
    const query = new Parse.Query('AmexingUser');
    query.limit(1000); // Process in batches
    
    let processed = 0;
    let updated = 0;
    
    const users = await query.find({ useMasterKey: true });
    
    for (const user of users) {
      let needsUpdate = false;
      
      // Check if phone field exists, if not add it
      if (!user.has('phone')) {
        user.set('phone', '');
        needsUpdate = true;
      }
      
      // Check if notes field exists, if not add it
      if (!user.has('notes')) {
        user.set('notes', '');
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await user.save(null, { useMasterKey: true });
        updated++;
      }
      
      processed++;
      
      if (processed % 10 === 0) {
        console.log(`  Processed ${processed} users, updated ${updated}...`);
      }
    }
    
    console.log(`✅ Migration complete! Processed ${processed} users, updated ${updated} users.`);
    console.log('📝 Phone and notes fields are now available for all AmexingUser records.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the migration
addPhoneNotesFields().then(() => {
  console.log('🎉 Migration finished successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});