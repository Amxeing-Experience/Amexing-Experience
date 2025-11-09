/**
 * Script to insert sample tours data into Parse Server database
 * 
 * This script creates sample data for:
 * - POIs (Points of Interest)
 * - VehicleTypes
 * - Rates  
 * - Tours (with references to the above)
 * 
 * Usage: node scripts/database/insert-sample-tours-data.js
 * 
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-28
 */

const Parse = require('parse/node');
require('dotenv').config({ path: 'environments/.env.development' });

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL;

console.log('🚀 Starting sample tours data insertion...');
console.log('📊 Database:', process.env.PARSE_SERVER_URL);

async function insertSampleData() {
  try {
    console.log('\n📍 Creating sample POIs...');
    
    // Create sample POIs
    const poisData = [
      {
        name: 'Centro Histórico de Mérida',
        description: 'Centro histórico de la ciudad blanca',
        location: 'Centro de Mérida, Yucatán',
        address: 'Plaza Grande, Centro, 97000 Mérida, Yuc.',
        latitude: 20.9674,
        longitude: -89.5926,
        category: 'Histórico',
        active: true,
        exists: true
      },
      {
        name: 'Chichén Itzá',
        description: 'Zona arqueológica maya patrimonio de la humanidad',
        location: 'Chichén Itzá, Yucatán',
        address: 'Zona Arqueológica, 97751 Chichén Itzá, Yuc.',
        latitude: 20.6843,
        longitude: -88.5678,
        category: 'Arqueológico',
        active: true,
        exists: true
      },
      {
        name: 'Uxmal',
        description: 'Zona arqueológica maya',
        location: 'Uxmal, Yucatán',
        address: 'Carretera Mérida-Campeche Km 78, 97844 Uxmal, Yuc.',
        latitude: 20.3587,
        longitude: -89.7714,
        category: 'Arqueológico',
        active: true,
        exists: true
      },
      {
        name: 'Cenotes de Dzitnup',
        description: 'Cenotes cristalinos para nadar',
        location: 'Dzitnup, Yucatán',
        address: 'Carretera Valladolid-Chichén Itzá Km 7, Dzitnup, Yuc.',
        latitude: 20.7167,
        longitude: -88.2167,
        category: 'Natural',
        active: true,
        exists: true
      },
      {
        name: 'Playa de Progreso',
        description: 'Puerto de playa en la costa yucateca',
        location: 'Progreso, Yucatán',
        address: 'Malecón de Progreso, 97320 Progreso, Yuc.',
        latitude: 21.2833,
        longitude: -89.6667,
        category: 'Playa',
        active: true,
        exists: true
      }
    ];

    const savedPOIs = [];
    for (const poiData of poisData) {
      const POI = Parse.Object.extend('POI');
      const poi = new POI();
      
      // Set all properties
      Object.keys(poiData).forEach(key => {
        poi.set(key, poiData[key]);
      });
      
      const savedPOI = await poi.save(null, { useMasterKey: true });
      savedPOIs.push(savedPOI);
      console.log(`   ✅ Created POI: ${savedPOI.get('name')} (${savedPOI.id})`);
    }

    console.log('\n🚗 Creating sample Vehicle Types...');
    
    // Create sample Vehicle Types
    const vehicleTypesData = [
      {
        code: 'VAN_TUR',
        name: 'Van Turística',
        capacity: 15,
        description: 'Van con aire acondicionado para turismo',
        amenities: ['Aire acondicionado', 'Asientos cómodos', 'Audio'],
        active: true,
        exists: true
      },
      {
        code: 'BUS_TUR',
        name: 'Autobús',
        capacity: 40,
        description: 'Autobús de turismo con aire acondicionado',
        amenities: ['Aire acondicionado', 'Asientos reclinables', 'Audio/Video', 'Baño'],
        active: true,
        exists: true
      },
      {
        code: 'CAM_4X4',
        name: 'Camioneta',
        capacity: 8,
        description: 'Camioneta 4x4 para aventuras',
        amenities: ['Aire acondicionado', '4x4', 'Equipo de seguridad'],
        active: true,
        exists: true
      },
      {
        code: 'SED_EJE',
        name: 'Sedan Ejecutivo',
        capacity: 4,
        description: 'Sedan de lujo para traslados ejecutivos',
        amenities: ['Aire acondicionado', 'Asientos de cuero', 'WiFi'],
        active: true,
        exists: true
      }
    ];

    const savedVehicleTypes = [];
    for (const vtData of vehicleTypesData) {
      const VehicleType = Parse.Object.extend('VehicleType');
      const vehicleType = new VehicleType();
      
      Object.keys(vtData).forEach(key => {
        vehicleType.set(key, vtData[key]);
      });
      
      const savedVT = await vehicleType.save(null, { useMasterKey: true });
      savedVehicleTypes.push(savedVT);
      console.log(`   ✅ Created Vehicle Type: ${savedVT.get('name')} (${savedVT.id})`);
    }

    console.log('\n💰 Creating sample Rates...');
    
    // Create sample Rates
    const ratesData = [
      {
        code: 'STD',
        name: 'Tarifa Estándar',
        description: 'Tarifa base para tours regulares',
        multiplier: 1.0,
        currency: 'MXN',
        active: true,
        exists: true
      },
      {
        code: 'PREM',
        name: 'Tarifa Premium',
        description: 'Tarifa para tours de lujo',
        multiplier: 1.5,
        currency: 'MXN',
        active: true,
        exists: true
      },
      {
        code: 'ECO',
        name: 'Tarifa Ecológica',
        description: 'Tarifa especial para tours ecológicos',
        multiplier: 1.2,
        currency: 'MXN',
        active: true,
        exists: true
      },
      {
        code: 'COAST',
        name: 'Tarifa Costera',
        description: 'Tarifa para tours costeros',
        multiplier: 0.8,
        currency: 'MXN',
        active: true,
        exists: true
      },
      {
        code: 'EXEC',
        name: 'Tarifa Ejecutiva',
        description: 'Tarifa para servicios ejecutivos',
        multiplier: 2.0,
        currency: 'MXN',
        active: true,
        exists: true
      }
    ];

    const savedRates = [];
    for (const rateData of ratesData) {
      const Rate = Parse.Object.extend('Rate');
      const rate = new Rate();
      
      Object.keys(rateData).forEach(key => {
        rate.set(key, rateData[key]);
      });
      
      const savedRate = await rate.save(null, { useMasterKey: true });
      savedRates.push(savedRate);
      console.log(`   ✅ Created Rate: ${savedRate.get('name')} (${savedRate.id})`);
    }

    console.log('\n🗺️ Creating sample Tours...');
    
    // Create sample Tours
    const toursData = [
      {
        destinationPOI: savedPOIs[0], // Centro Histórico de Mérida
        time: 120, // 2 hours
        vehicleType: savedVehicleTypes[0], // Van Turística
        price: 1500.00,
        rate: savedRates[0], // Tarifa Estándar
        active: true,
        exists: true
      },
      {
        destinationPOI: savedPOIs[1], // Chichén Itzá
        time: 480, // 8 hours
        vehicleType: savedVehicleTypes[1], // Autobús
        price: 2800.00,
        rate: savedRates[1], // Tarifa Premium
        active: true,
        exists: true
      },
      {
        destinationPOI: savedPOIs[2], // Uxmal
        time: 360, // 6 hours
        vehicleType: savedVehicleTypes[0], // Van Turística
        price: 2200.00,
        rate: savedRates[0], // Tarifa Estándar
        active: true,
        exists: true
      },
      {
        destinationPOI: savedPOIs[3], // Cenotes de Dzitnup
        time: 240, // 4 hours
        vehicleType: savedVehicleTypes[2], // Camioneta
        price: 1800.00,
        rate: savedRates[2], // Tarifa Ecológica
        active: true,
        exists: true
      },
      {
        destinationPOI: savedPOIs[4], // Playa de Progreso
        time: 300, // 5 hours
        vehicleType: savedVehicleTypes[0], // Van Turística
        price: 1200.00,
        rate: savedRates[3], // Tarifa Costera
        active: false, // Inactive example
        exists: true
      },
      {
        destinationPOI: savedPOIs[0], // Centro Histórico (Executive)
        time: 180, // 3 hours
        vehicleType: savedVehicleTypes[3], // Sedan Ejecutivo
        price: 3500.00,
        rate: savedRates[4], // Tarifa Ejecutiva
        active: true,
        exists: true
      }
    ];

    const savedTours = [];
    for (const tourData of toursData) {
      const Tour = Parse.Object.extend('Tours');
      const tour = new Tour();
      
      Object.keys(tourData).forEach(key => {
        tour.set(key, tourData[key]);
      });
      
      const savedTour = await tour.save(null, { useMasterKey: true });
      savedTours.push(savedTour);
      
      const destName = tourData.destinationPOI.get('name');
      const vehicleName = tourData.vehicleType.get('name');
      const hours = Math.floor(tourData.time / 60);
      const minutes = tourData.time % 60;
      const timeStr = hours > 0 ? (minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`) : `${minutes}min`;
      
      console.log(`   ✅ Created Tour: ${destName} - ${timeStr} - ${vehicleName} - $${tourData.price} (${savedTour.id})`);
    }

    console.log('\n🎉 Sample data insertion completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   📍 POIs created: ${savedPOIs.length}`);
    console.log(`   🚗 Vehicle Types created: ${savedVehicleTypes.length}`);
    console.log(`   💰 Rates created: ${savedRates.length}`);
    console.log(`   🗺️ Tours created: ${savedTours.length}`);
    
    console.log('\n🔗 You can now access the Tours management at:');
    console.log('   👑 SuperAdmin: http://localhost:1337/dashboard/superadmin/tours');
    console.log('   🔧 Admin: http://localhost:1337/dashboard/admin/tours');
    
    console.log('\n✨ All done! The Tours table should now display the sample data.');

  } catch (error) {
    console.error('❌ Error inserting sample data:', error);
    process.exit(1);
  }
}

// Run the script
insertSampleData()
  .then(() => {
    console.log('\n🏁 Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });