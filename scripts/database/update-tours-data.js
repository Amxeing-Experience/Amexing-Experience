/**
 * Script to update existing tour records with complete data
 * Adds missing fields like description, pricing, languages, etc.
 * 
 * Usage: node scripts/database/update-tours-data.js
 * 
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2024-12-15
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

console.log('🚀 Starting tour data update...');
console.log('📊 Database:', process.env.PARSE_SERVER_URL);

async function updateTourData() {
  try {
    console.log('\n🗺️ Fetching existing tours...');
    
    const tourQuery = new Parse.Query('Tour');
    tourQuery.include(['destinationPOI', 'vehicleType', 'rate']);
    const tours = await tourQuery.find({ useMasterKey: true });
    
    console.log(`Found ${tours.length} tours to update`);
    
    // Tour data mapping based on destination
    const tourDataMapping = {
      'Atotonilco': {
        description: 'Visita al Santuario de Jesús Nazareno de Atotonilco, conocido como la "Capilla Sixtina de América".',
        price_child: 800.00,
        price_no_alcohol: 900.00,
        advance_booking_time: 2,
        min_people: 2,
        max_people: 20,
        includes: ['Guía certificado', 'Transporte', 'Entrada al santuario', 'Agua embotellada'],
        notincludes: ['Alimentos', 'Propinas', 'Souvenirs'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Lugar sagrado, vestimenta apropiada requerida. Cámaras permitidas sin flash.',
        availableDays: ['Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '09:00',
        endTime: '12:00'
      },
      'San Miguel de Allende': {
        description: 'Tour por la ciudad colonial Patrimonio de la Humanidad, explorando su arquitectura y cultura.',
        price_child: 1200.00,
        price_no_alcohol: 1400.00,
        advance_booking_time: 4,
        min_people: 2,
        max_people: 25,
        includes: ['Guía local', 'Transporte', 'Mapa de la ciudad', 'Degustación gastronómica'],
        notincludes: ['Comidas completas', 'Bebidas alcohólicas', 'Compras'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Calzado cómodo recomendado. Tour incluye caminata por empedrados.',
        availableDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '10:00',
        endTime: '15:00'
      },
      'Guanajuato': {
        description: 'Recorrido por la ciudad subterránea de Guanajuato, sus callejones y leyendas.',
        price_child: 1500.00,
        price_no_alcohol: 1700.00,
        advance_booking_time: 6,
        min_people: 3,
        max_people: 30,
        includes: ['Guía especializado', 'Transporte', 'Entradas a museos', 'Tour de callejones'],
        notincludes: ['Alimentos', 'Bebidas', 'Actividades opcionales'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Tour incluye caminata por terreno irregular. Llevar cámara.',
        availableDays: ['Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '09:00',
        endTime: '16:00'
      },
      'Dolores Hidalgo': {
        description: 'Cuna de la Independencia Mexicana, visita histórica con degustación de helados típicos.',
        price_child: 900.00,
        price_no_alcohol: 1000.00,
        advance_booking_time: 3,
        min_people: 2,
        max_people: 20,
        includes: ['Guía histórico', 'Transporte', 'Entradas a sitios', 'Degustación de helados'],
        notincludes: ['Comida principal', 'Bebidas', 'Souvenirs'],
        languages: ['Español'],
        client_booking_notes: 'Tour histórico cultural. Ideal para familias con niños.',
        availableDays: ['Martes', 'Jueves', 'Sábado', 'Domingo'],
        startTime: '10:00',
        endTime: '14:00'
      },
      'Querétaro': {
        description: 'Tour por el centro histórico de Querétaro, Patrimonio de la Humanidad y ciudad colonial.',
        price_child: 1100.00,
        price_no_alcohol: 1300.00,
        advance_booking_time: 4,
        min_people: 2,
        max_people: 25,
        includes: ['Guía certificado', 'Transporte', 'Entrada a teatros', 'Mapa turístico'],
        notincludes: ['Alimentos', 'Bebidas', 'Actividades opcionales'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Centro histórico extenso, zapatos cómodos recomendados.',
        availableDays: ['Miércoles', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '09:30',
        endTime: '15:30'
      },
      'Cañada de la Virgen': {
        description: 'Zona arqueológica prehispánica con observatorio astronómico y paisajes únicos.',
        price_child: 1300.00,
        price_no_alcohol: 1500.00,
        advance_booking_time: 8,
        min_people: 4,
        max_people: 15,
        includes: ['Guía arqueólogo', 'Transporte especializado', 'Entrada', 'Lunch', 'Equipo de protección'],
        notincludes: ['Bebidas', 'Propinas', 'Fotografía profesional'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Sitio con acceso limitado. Reserva con anticipación obligatoria.',
        availableDays: ['Miércoles', 'Viernes', 'Sábado'],
        startTime: '08:00',
        endTime: '14:00'
      },
      'Mineral de Pozos': {
        description: 'Pueblo mágico y pueblo fantasma con minas históricas y arquitectura colonial.',
        price_child: 1000.00,
        price_no_alcohol: 1200.00,
        advance_booking_time: 3,
        min_people: 2,
        max_people: 18,
        includes: ['Guía local', 'Transporte', 'Entrada a minas', 'Almuerzo típico'],
        notincludes: ['Bebidas alcohólicas', 'Actividades extremas', 'Compras'],
        languages: ['Español'],
        client_booking_notes: 'Exploración de minas incluida. Ropa que se pueda ensuciar.',
        availableDays: ['Jueves', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '09:00',
        endTime: '15:00'
      },
      'Walking Tour San Miguel de Allende': {
        description: 'Tour a pie por el corazón histórico de San Miguel de Allende con paradas gastronómicas.',
        price_child: 600.00,
        price_no_alcohol: 700.00,
        advance_booking_time: 1,
        min_people: 1,
        max_people: 12,
        includes: ['Guía peatonal', 'Mapa turístico', 'Degustaciones', 'Fotografías digitales'],
        notincludes: ['Transporte', 'Comidas completas', 'Bebidas'],
        languages: ['Español', 'Inglés'],
        client_booking_notes: 'Caminata de 2-3 horas. Calzado cómodo indispensable.',
        availableDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
        startTime: '16:00',
        endTime: '19:00'
      },
      'Prueba Tour': {
        description: 'Tour de prueba para validación del sistema. No disponible para reservas reales.',
        price_child: 500.00,
        price_no_alcohol: 500.00,
        advance_booking_time: 1,
        min_people: 1,
        max_people: 5,
        includes: ['Guía de prueba', 'Material de testing'],
        notincludes: ['Servicios reales', 'Actividades'],
        languages: ['Español'],
        client_booking_notes: 'Solo para pruebas del sistema.',
        availableDays: ['Lunes'],
        startTime: '10:00',
        endTime: '11:00'
      }
    };
    
    let updatedCount = 0;
    
    for (const tour of tours) {
      const destinationPOI = tour.get('destinationPOI');
      if (!destinationPOI) {
        console.log(`   ⚠️ Skipping tour ${tour.id} - no destination POI`);
        continue;
      }
      
      await destinationPOI.fetch({ useMasterKey: true });
      const destinationName = destinationPOI.get('name');
      
      const updateData = tourDataMapping[destinationName];
      if (!updateData) {
        console.log(`   ⚠️ Skipping tour ${tour.id} - no update data for ${destinationName}`);
        continue;
      }
      
      // Update tour with new fields
      Object.keys(updateData).forEach(key => {
        tour.set(key, updateData[key]);
      });
      
      await tour.save(null, { useMasterKey: true });
      updatedCount++;
      
      const hours = Math.floor(tour.get('time') / 60);
      const minutes = tour.get('time') % 60;
      const timeStr = hours > 0 ? (minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`) : `${minutes}min`;
      
      console.log(`   ✅ Updated Tour: ${destinationName} - ${timeStr} (${tour.id})`);
    }
    
    console.log('\n🎉 Tour data update completed successfully!');
    console.log(`   📊 Updated ${updatedCount} tours`);
    console.log('\n🔗 You can now test the tour selection at:');
    console.log('   http://localhost:1337/dashboard/admin/quotes/9TzEt6iAsu?section=services');
    console.log('\n✨ Tour fields should now populate when selected!');

  } catch (error) {
    console.error('❌ Error updating tour data:', error);
    process.exit(1);
  }
}

// Run the script
updateTourData()
  .then(() => {
    console.log('\n🏁 Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });