/**
 * Script to create test Experience records for inflation testing
 * 
 * Creates 5 Experience records with different cost values to test inflation
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
 * Create test Experience records
 */
async function createExperienceTestData() {
  console.log('🚀 Creating Experience test data for inflation testing...\n');
  
  try {
    // Test Experience data
    const experienceData = [
      {
        name: 'Tour Centro Histórico',
        description: 'Recorrido por el centro histórico de la ciudad',
        cost: 450.00,
        type: 'Experience',
        active: true,
        exists: true
      },
      {
        name: 'Tour Gastronómico',
        description: 'Experiencia culinaria por los mejores restaurantes',
        cost: 850.75,
        type: 'Experience',
        active: true,
        exists: true
      },
      {
        name: 'Aventura en la Montaña',
        description: 'Senderismo y aventura en las montañas cercanas',
        cost: 1200.50,
        type: 'Experience',
        active: true,
        exists: true
      },
      {
        name: 'Proveedor Premium',
        description: 'Servicio de transporte premium exclusivo',
        cost: 2500.00,
        type: 'Provider',
        active: true,
        exists: true
      },
      {
        name: 'Tour Nocturno',
        description: 'Recorrido nocturno por la vida nocturna de la ciudad',
        cost: 675.25,
        type: 'Experience',
        active: true,
        exists: true
      }
    ];

    const createdRecords = [];

    for (const [index, data] of experienceData.entries()) {
      console.log(`📝 Creating Experience ${index + 1}: ${data.name}`);
      
      const experience = new Parse.Object('Experience');
      experience.set('name', data.name);
      experience.set('description', data.description);
      experience.set('cost', data.cost);
      experience.set('type', data.type);
      experience.set('active', data.active);
      experience.set('exists', data.exists);
      
      // Add optional fields
      experience.set('experiences', []); // Array of included experiences
      experience.set('tours', []); // Array of included tours
      
      const savedRecord = await experience.save(null, { useMasterKey: true });
      createdRecords.push({
        id: savedRecord.id,
        name: savedRecord.get('name'),
        cost: savedRecord.get('cost'),
        type: savedRecord.get('type')
      });
      
      console.log(`✅ Created Experience: ${savedRecord.id} - ${data.name} ($${data.cost})`);
    }

    console.log('\n📊 Summary of created Experience records:');
    console.log('ID\t\t\tName\t\t\tCost\t\tType');
    console.log('─'.repeat(80));
    createdRecords.forEach(record => {
      console.log(`${record.id}\t${record.name.padEnd(25)}\t$${record.cost}\t${record.type}`);
    });

    console.log(`\n✅ Successfully created ${createdRecords.length} Experience records!`);
    console.log('💡 These records are ready for inflation testing.');
    
    return createdRecords;

  } catch (error) {
    console.error('❌ Error creating Experience test data:', error.message);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Verify Experience records are ready for inflation
 */
async function verifyExperienceData() {
  console.log('\n🔍 Verifying Experience records for inflation eligibility...\n');
  
  try {
    const query = new Parse.Query('Experience');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.doesNotExist('valid_until');
    
    const records = await query.find({ useMasterKey: true });
    
    console.log(`📊 Found ${records.length} Experience records eligible for inflation:`);
    console.log('ID\t\t\tName\t\t\tCost\t\tActive\tExists');
    console.log('─'.repeat(90));
    
    records.forEach(record => {
      console.log(`${record.id}\t${record.get('name').padEnd(25)}\t$${record.get('cost')}\t${record.get('active')}\t${record.get('exists')}`);
    });
    
    if (records.length > 0) {
      console.log('\n✅ Experience records are ready for inflation testing!');
      console.log('💡 You can now test inflation on http://localhost:1337/dashboard/admin/price-settings?section=inflation');
    } else {
      console.log('\n⚠️  No Experience records found for inflation. Run createExperienceTestData() first.');
    }
    
    return records;
    
  } catch (error) {
    console.error('❌ Error verifying Experience data:', error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const startTime = Date.now();
  console.log('🚀 Starting Experience test data creation...\n');
  
  try {
    // Create test data
    await createExperienceTestData();
    
    // Verify the data
    await verifyExperienceData();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Experience test data creation completed!`);
    console.log(`⏱️  Duration: ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main, createExperienceTestData, verifyExperienceData };