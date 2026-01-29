/**
 * Debug script to check if phone and notes fields exist in database
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

async function checkPhoneNotesFields() {
  try {
    console.log('🔍 Checking phone and notes fields for user FrwWiajmCP...\n');
    
    const query = new Parse.Query('AmexingUser');
    query.equalTo('objectId', 'FrwWiajmCP');
    
    const user = await query.first({ useMasterKey: true });
    
    if (!user) {
      console.log('❌ User not found!');
      return;
    }
    
    console.log('✅ User found:', user.get('email'));
    console.log('\n📊 Field Check:');
    console.log('  has phone field:', user.has('phone'));
    console.log('  phone value:', user.get('phone'));
    console.log('  has notes field:', user.has('notes'));
    console.log('  notes value:', user.get('notes'));
    
    console.log('\n🔍 All attributes:');
    const attrs = user.attributes;
    Object.keys(attrs).forEach(key => {
      if (key === 'phone' || key === 'notes') {
        console.log(`  ⭐ ${key}: "${attrs[key]}"`);
      }
    });
    
    // Try to set the fields if they don't exist
    if (!user.has('phone') || !user.has('notes')) {
      console.log('\n🔧 Fields missing, adding them...');
      user.set('phone', user.get('phone') || '');
      user.set('notes', user.get('notes') || '');
      await user.save(null, { useMasterKey: true });
      console.log('✅ Fields added!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkPhoneNotesFields().then(() => {
  console.log('\n✨ Check complete!');
  process.exit(0);
});