/**
 * Diagnose Rate Prices Data
 * 
 * This script checks the consistency of RatePrices and Services data
 * to understand why some rates are not showing properly.
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: './environments/.env.development' });
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  'javascript-key-dev-secure-2024',
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

async function diagnoseData() {
  try {
    console.log('🔍 Diagnosing Rate Prices Data\n');
    console.log('=' .repeat(60) + '\n');

    // 1. Get all rates
    console.log('📊 RATES IN DATABASE:');
    const ratesQuery = new Parse.Query('Rate');
    ratesQuery.equalTo('exists', true);
    ratesQuery.ascending('name');
    const rates = await ratesQuery.find({ useMasterKey: true });
    
    const rateMap = {};
    rates.forEach(rate => {
      rateMap[rate.id] = rate.get('name');
      console.log(`   - ${rate.get('name')} (ID: ${rate.id}, ${rate.get('percentage')}%)`);
    });
    console.log(`   Total: ${rates.length} rates\n`);

    // 2. Check Services table structure
    console.log('🚐 SERVICES TABLE ANALYSIS:');
    const servicesQuery = new Parse.Query('Services');
    servicesQuery.equalTo('exists', true);
    servicesQuery.include('rate');
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    
    // Group services by rate
    const servicesByRate = {};
    services.forEach(service => {
      const rate = service.get('rate');
      const rateName = rate ? rate.get('name') : 'No Rate';
      if (!servicesByRate[rateName]) {
        servicesByRate[rateName] = 0;
      }
      servicesByRate[rateName]++;
    });
    
    console.log('   Services grouped by Rate field:');
    Object.entries(servicesByRate).forEach(([rateName, count]) => {
      console.log(`   - ${rateName}: ${count} services`);
    });
    console.log(`   Total Services: ${services.length}\n`);

    // 3. Check RatePrices table
    console.log('💰 RATEPRICES TABLE ANALYSIS:');
    const ratePricesQuery = new Parse.Query('RatePrices');
    ratePricesQuery.equalTo('exists', true);
    ratePricesQuery.include(['rate', 'service', 'vehicleType']);
    ratePricesQuery.limit(1000);
    const ratePrices = await ratePricesQuery.find({ useMasterKey: true });
    
    // Group RatePrices by rate
    const ratePricesByRate = {};
    const uniqueServices = new Set();
    
    ratePrices.forEach(rp => {
      const rate = rp.get('rate');
      const service = rp.get('service');
      const rateName = rate ? rate.get('name') : 'No Rate';
      
      if (!ratePricesByRate[rateName]) {
        ratePricesByRate[rateName] = 0;
      }
      ratePricesByRate[rateName]++;
      
      if (service) {
        uniqueServices.add(service.id);
      }
    });
    
    console.log('   RatePrices grouped by Rate:');
    Object.entries(ratePricesByRate).forEach(([rateName, count]) => {
      console.log(`   - ${rateName}: ${count} rate prices`);
    });
    console.log(`   Total RatePrices: ${ratePrices.length}`);
    console.log(`   Unique Services in RatePrices: ${uniqueServices.size}\n`);

    // 4. Sample specific services
    console.log('📍 SAMPLE SERVICE ANALYSIS (First 3 services):');
    const sampleServices = services.slice(0, 3);
    
    for (const service of sampleServices) {
      const origin = service.get('originPOI');
      const destination = service.get('destinationPOI');
      const serviceRate = service.get('rate');
      
      console.log(`\n   Service ID: ${service.id}`);
      console.log(`   Route: ${origin ? origin.get('name') : 'Local'} → ${destination.get('name')}`);
      console.log(`   Service Rate field: ${serviceRate ? serviceRate.get('name') : 'None'}`);
      
      // Find all RatePrices for this service
      const rpQuery = new Parse.Query('RatePrices');
      rpQuery.equalTo('service', service);
      rpQuery.equalTo('exists', true);
      rpQuery.include(['rate', 'vehicleType']);
      const serviceRatePrices = await rpQuery.find({ useMasterKey: true });
      
      console.log(`   RatePrices for this service: ${serviceRatePrices.length}`);
      
      // Group by rate
      const pricesByRate = {};
      serviceRatePrices.forEach(rp => {
        const rate = rp.get('rate');
        const rateName = rate ? rate.get('name') : 'Unknown';
        if (!pricesByRate[rateName]) {
          pricesByRate[rateName] = [];
        }
        const vehicleType = rp.get('vehicleType');
        pricesByRate[rateName].push({
          vehicle: vehicleType ? vehicleType.get('code') : 'Unknown',
          price: rp.get('price')
        });
      });
      
      Object.entries(pricesByRate).forEach(([rateName, prices]) => {
        console.log(`     ${rateName}: ${prices.map(p => `${p.vehicle} $${p.price}`).join(', ')}`);
      });
    }

    // 5. Check for mismatches
    console.log('\n⚠️  POTENTIAL ISSUES:');
    
    // Check if Services have a rate but no RatePrices
    let servicesWithoutRatePrices = 0;
    for (const service of services.slice(0, 20)) { // Check first 20 services
      const rpQuery = new Parse.Query('RatePrices');
      rpQuery.equalTo('service', service);
      rpQuery.equalTo('exists', true);
      const count = await rpQuery.count({ useMasterKey: true });
      if (count === 0) {
        servicesWithoutRatePrices++;
      }
    }
    
    if (servicesWithoutRatePrices > 0) {
      console.log(`   ❌ ${servicesWithoutRatePrices} services (of first 20) have no RatePrices entries`);
    }
    
    // Check if all rates have RatePrices
    const missingRates = [];
    rates.forEach(rate => {
      const rateName = rate.get('name');
      if (!ratePricesByRate[rateName] || ratePricesByRate[rateName] === 0) {
        missingRates.push(rateName);
      }
    });
    
    if (missingRates.length > 0) {
      console.log(`   ❌ Rates with no RatePrices: ${missingRates.join(', ')}`);
    }

    // 6. Recommendation
    console.log('\n💡 DIAGNOSIS SUMMARY:');
    console.log('   The system has two different models:');
    console.log('   1. Services table: Has a "rate" field pointing to a specific rate');
    console.log('   2. RatePrices table: Has pricing for service+rate+vehicle combinations');
    console.log('\n   ISSUE: Services are associated with ONE rate in Services table,');
    console.log('   but the UI expects to show prices for ALL rates.');
    console.log('\n   SOLUTION: Either:');
    console.log('   a) Remove rate field from Services and use only RatePrices');
    console.log('   b) Create RatePrices entries for ALL rate combinations');
    console.log('   c) Modify UI to show only the service\'s assigned rate');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run diagnosis
diagnoseData().then(() => {
  console.log('\n✅ Diagnosis complete');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});