/**
 * Add Vehicles Form Template to Database
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../environments/.env.development') });

// Parse Server configuration
const PARSE_APP_ID = process.env.PARSE_APP_ID;
const PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY;
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

Parse.initialize(PARSE_APP_ID);
Parse.masterKey = PARSE_MASTER_KEY;
Parse.serverURL = PARSE_SERVER_URL;

const vehiclesTemplate = {
  name: 'Vehículos',
  description: 'Formulario para registrar y gestionar vehículos',
  formType: 'vehicle',
  formId: 'vehicle',
  status: 'active',
  fields: [
    {
      id: 'field_1',
      type: 'text',
      name: 'vehicleBrand',
      label: 'Marca del Vehículo',
      placeholder: 'Ej: Toyota, Honda, Ford',
      required: true,
      validation: {
        minLength: 2,
        maxLength: 50
      }
    },
    {
      id: 'field_2',
      type: 'text',
      name: 'vehicleModel',
      label: 'Modelo',
      placeholder: 'Ej: Camry, Accord, Focus',
      required: true,
      validation: {
        minLength: 1,
        maxLength: 50
      }
    },
    {
      id: 'field_3',
      type: 'number',
      name: 'vehicleYear',
      label: 'Año del Vehículo',
      placeholder: '2024',
      required: true,
      min: 1980,
      max: 2030
    },
    {
      id: 'field_4',
      type: 'text',
      name: 'licensePlate',
      label: 'Matrícula/Placa',
      placeholder: 'ABC-123',
      required: true,
      validation: {
        minLength: 3,
        maxLength: 15
      }
    },
    {
      id: 'field_5',
      type: 'select',
      name: 'vehicleType',
      label: 'Tipo de Vehículo',
      required: true,
      options: [
        { value: 'sedan', label: 'Sedán' },
        { value: 'suv', label: 'SUV' },
        { value: 'hatchback', label: 'Hatchback' },
        { value: 'pickup', label: 'Camioneta' },
        { value: 'van', label: 'Van' },
        { value: 'bus', label: 'Autobús' },
        { value: 'motorcycle', label: 'Motocicleta' }
      ]
    },
    {
      id: 'field_6',
      type: 'number',
      name: 'passengerCapacity',
      label: 'Capacidad de Pasajeros',
      placeholder: '4',
      required: true,
      min: 1,
      max: 50
    },
    {
      id: 'field_7',
      type: 'select',
      name: 'fuelType',
      label: 'Tipo de Combustible',
      required: true,
      options: [
        { value: 'gasoline', label: 'Gasolina' },
        { value: 'diesel', label: 'Diésel' },
        { value: 'electric', label: 'Eléctrico' },
        { value: 'hybrid', label: 'Híbrido' },
        { value: 'gas', label: 'Gas Natural' }
      ]
    },
    {
      id: 'field_8',
      type: 'text',
      name: 'color',
      label: 'Color',
      placeholder: 'Blanco, Negro, Azul',
      required: true,
      validation: {
        minLength: 2,
        maxLength: 30
      }
    },
    {
      id: 'field_9',
      type: 'text',
      name: 'vin',
      label: 'Número VIN',
      placeholder: '17 caracteres',
      required: false,
      helpText: 'Número de identificación del vehículo (opcional)',
      validation: {
        minLength: 17,
        maxLength: 17,
        pattern: '^[A-HJ-NPR-Z0-9]{17}$'
      }
    },
    {
      id: 'field_10',
      type: 'date',
      name: 'registrationDate',
      label: 'Fecha de Registro',
      required: true
    },
    {
      id: 'field_11',
      type: 'date',
      name: 'insuranceExpiry',
      label: 'Vencimiento del Seguro',
      required: false,
      helpText: 'Fecha de vencimiento de la póliza de seguro'
    },
    {
      id: 'field_12',
      type: 'textarea',
      name: 'notes',
      label: 'Notas Adicionales',
      placeholder: 'Observaciones, mantenimientos, etc.',
      required: false,
      rows: 3
    }
  ],
  settings: {
    submitButtonText: 'Registrar Vehículo',
    cancelButtonText: 'Cancelar',
    showProgressBar: false,
    allowSaveDraft: true
  }
};

async function addVehiclesTemplate() {
  console.log('\n=== Adding Vehicles Form Template ===\n');

  try {
    // Check if template already exists
    const FormTemplate = Parse.Object.extend('FormTemplate');
    const query = new Parse.Query(FormTemplate);
    query.equalTo('formType', 'vehicle');
    query.equalTo('exists', true);
    const existing = await query.first({ useMasterKey: true });

    if (existing) {
      console.log('⚠ Vehicles template already exists, updating...');
      
      // Update existing template
      Object.keys(vehiclesTemplate).forEach(key => {
        existing.set(key, vehiclesTemplate[key]);
      });
      existing.set('version', (existing.get('version') || 0) + 1);
      existing.set('active', true);
      existing.set('exists', true);
      
      await existing.save(null, { useMasterKey: true });
      console.log('✓ Vehicles template updated successfully');
      
    } else {
      console.log('Creating new vehicles template...');
      
      // Create new template
      const formTemplate = new FormTemplate();
      
      Object.keys(vehiclesTemplate).forEach(key => {
        formTemplate.set(key, vehiclesTemplate[key]);
      });
      
      formTemplate.set('active', true);
      formTemplate.set('exists', true);
      formTemplate.set('version', 1);
      
      await formTemplate.save(null, { useMasterKey: true });
      console.log('✓ Vehicles template created successfully');
    }

    console.log('\n=== Template Details ===');
    console.log(`Name: ${vehiclesTemplate.name}`);
    console.log(`Form Type: ${vehiclesTemplate.formType}`);
    console.log(`Fields: ${vehiclesTemplate.fields.length}`);
    console.log(`Description: ${vehiclesTemplate.description}`);

    console.log('\n✅ Vehicles form template added successfully\n');
    return true;

  } catch (error) {
    console.error('❌ Error adding vehicles template:', error);
    throw error;
  }
}

async function runScript() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║            Add Vehicles Form Template                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    await addVehiclesTemplate();
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║              Script Completed Successfully            ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║                   Script Failed                       ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run script
if (require.main === module) {
  runScript();
}

module.exports = { addVehiclesTemplate };