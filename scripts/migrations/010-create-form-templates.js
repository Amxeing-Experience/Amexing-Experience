/**
 * Migration: Create FormTemplate Table
 * Creates FormTemplate class for dynamic form builder
 *
 * Schema:
 * - name: String (required) - Form template name
 * - description: String - Form description
 * - formType: String (required) - Type of form (experience, tour, reservation, etc.)
 * - fields: Array - JSON array of form field definitions
 * - settings: Object - Form configuration settings
 * - status: String - Form status (draft, active, inactive)
 * - version: Number - Form version number
 * - createdBy: Pointer<AmexingUser> - User who created the template
 * - lastModifiedBy: Pointer<AmexingUser> - User who last modified
 * - active: Boolean (default: true)
 * - exists: Boolean (default: true)
 */

const Parse = require('parse/node');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../../environments/.env.development') });

// Parse Server configuration
const PARSE_APP_ID = process.env.PARSE_APP_ID;
const PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY;
const PARSE_SERVER_URL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

Parse.initialize(PARSE_APP_ID);
Parse.masterKey = PARSE_MASTER_KEY;
Parse.serverURL = PARSE_SERVER_URL;

async function createFormTemplateClass() {
  console.log('\n=== Creating FormTemplate Class ===\n');

  try {
    // Define schema
    const schema = new Parse.Schema('FormTemplate');

    // Basic Information
    schema.addString('name', { required: true });
    schema.addString('description');
    schema.addString('formType', { required: true });
    
    // Form Structure
    schema.addArray('fields');
    schema.addObject('settings');
    
    // Status and Versioning
    schema.addString('status', { defaultValue: 'draft' });
    schema.addNumber('version', { defaultValue: 1 });
    
    // Audit fields
    schema.addPointer('createdBy', 'AmexingUser');
    schema.addPointer('lastModifiedBy', 'AmexingUser');
    
    // Status fields
    schema.addBoolean('active', { defaultValue: true });
    schema.addBoolean('exists', { defaultValue: true });

    // Create or update the class
    try {
      await schema.get({ useMasterKey: true });
      console.log('✓ FormTemplate class already exists, updating schema...');
      await schema.update({ useMasterKey: true });
      console.log('✓ FormTemplate schema updated successfully');
    } catch (error) {
      if (error.code === Parse.Error.INVALID_CLASS_NAME) {
        console.log('Creating new FormTemplate class...');
        await schema.save({ useMasterKey: true });
        console.log('✓ FormTemplate class created successfully');
      } else {
        throw error;
      }
    }

    // Set Class Level Permissions
    console.log('\nSetting Class Level Permissions...');
    const clp = {
      find: { 'role:Admin': true, 'role:SuperAdmin': true },
      count: { 'role:Admin': true, 'role:SuperAdmin': true },
      get: { 'role:Admin': true, 'role:SuperAdmin': true },
      create: { 'role:Admin': true, 'role:SuperAdmin': true },
      update: { 'role:Admin': true, 'role:SuperAdmin': true },
      delete: { 'role:SuperAdmin': true },
      addField: { 'role:SuperAdmin': true },
      protectedFields: {
        '*': ['exists', 'createdBy'] // Protect soft delete flag and creator
      }
    };

    // Try to set CLP via Cloud Function first, fallback to direct
    try {
      await Parse.Cloud.run('setClassLevelPermissions', {
        className: 'FormTemplate',
        permissions: clp
      }, { useMasterKey: true });
    } catch (e) {
      console.log('⚠ Could not set CLP via Cloud Function, setting directly...');
      const updatedSchema = new Parse.Schema('FormTemplate');
      updatedSchema.setCLP(clp);
      await updatedSchema.update({ useMasterKey: true });
    }

    console.log('✓ Class Level Permissions configured');

    // Create indexes
    console.log('\nCreating indexes...');

    const indexSchema = new Parse.Schema('FormTemplate');
    
    try {
      // Index on formType for filtering
      indexSchema.addIndex('formType_index', { formType: 1 });
      await indexSchema.update({ useMasterKey: true });
      console.log('✓ formType_index added');
    } catch (e) {
      console.log('⚠ formType index might already exist');
    }

    try {
      // Index on status for filtering
      indexSchema.addIndex('status_index', { status: 1 });
      await indexSchema.update({ useMasterKey: true });
      console.log('✓ status_index added');
    } catch (e) {
      console.log('⚠ status index might already exist');
    }

    try {
      // Compound index for soft delete queries (active + exists)
      indexSchema.addIndex('active_exists_index', { active: 1, exists: 1 });
      await indexSchema.update({ useMasterKey: true });
      console.log('✓ active_exists_index added');
    } catch (e) {
      console.log('⚠ active_exists index might already exist');
    }

    try {
      // Compound index for type + status queries
      indexSchema.addIndex('formType_status_index', { formType: 1, status: 1 });
      await indexSchema.update({ useMasterKey: true });
      console.log('✓ formType_status_index added');
    } catch (e) {
      console.log('⚠ formType_status index might already exist');
    }

    console.log('✓ Indexes created successfully');

    // Create default form templates
    await createDefaultTemplates();

    console.log('\n✅ FormTemplate class setup completed successfully\n');
    return true;

  } catch (error) {
    console.error('❌ Error creating FormTemplate class:', error);
    throw error;
  }
}

async function createDefaultTemplates() {
  console.log('\n=== Creating Default Form Templates ===\n');

  const defaultTemplates = [
    {
      name: 'Formulario de Experiencias',
      description: 'Formulario para crear y editar experiencias turísticas',
      formType: 'experience',
      status: 'active',
      fields: [
        {
          id: 'field_1',
          type: 'text',
          name: 'name',
          label: 'Nombre de la Experiencia',
          placeholder: 'Ingrese el nombre de la experiencia',
          required: true,
          helpText: 'Este será el título principal de la experiencia',
          validation: { minLength: 3, maxLength: 100 }
        },
        {
          id: 'field_2',
          type: 'textarea',
          name: 'description',
          label: 'Descripción',
          placeholder: 'Describa la experiencia',
          required: true,
          rows: 4,
          validation: { minLength: 10, maxLength: 500 }
        },
        {
          id: 'field_3',
          type: 'number',
          name: 'duration',
          label: 'Duración (horas)',
          placeholder: 'Duración en horas',
          required: true,
          min: 1,
          max: 72
        },
        {
          id: 'field_4',
          type: 'number',
          name: 'price',
          label: 'Precio (MXN)',
          placeholder: '0.00',
          required: true,
          min: 0,
          step: 0.01
        },
        {
          id: 'field_5',
          type: 'select',
          name: 'category',
          label: 'Categoría',
          required: true,
          options: [
            { value: 'adventure', label: 'Aventura' },
            { value: 'cultural', label: 'Cultural' },
            { value: 'gastronomic', label: 'Gastronómica' },
            { value: 'nature', label: 'Naturaleza' },
            { value: 'relaxation', label: 'Relajación' }
          ]
        },
        {
          id: 'field_6',
          type: 'number',
          name: 'capacity',
          label: 'Capacidad Máxima',
          placeholder: 'Número de personas',
          required: true,
          min: 1,
          max: 100
        }
      ],
      settings: {
        submitButtonText: 'Guardar Experiencia',
        cancelButtonText: 'Cancelar',
        showProgressBar: false,
        allowSaveDraft: true
      }
    },
    {
      name: 'Formulario de Tours',
      description: 'Formulario para crear y editar tours',
      formType: 'tour',
      status: 'active',
      fields: [
        {
          id: 'field_1',
          type: 'text',
          name: 'tourName',
          label: 'Nombre del Tour',
          placeholder: 'Ingrese el nombre del tour',
          required: true,
          validation: { minLength: 3, maxLength: 100 }
        },
        {
          id: 'field_2',
          type: 'textarea',
          name: 'itinerary',
          label: 'Itinerario',
          placeholder: 'Describa el itinerario del tour',
          required: true,
          rows: 5
        },
        {
          id: 'field_3',
          type: 'daterange',
          name: 'tourDates',
          label: 'Fechas del Tour',
          required: true
        },
        {
          id: 'field_4',
          type: 'location',
          name: 'meetingPoint',
          label: 'Punto de Encuentro',
          required: true
        },
        {
          id: 'field_5',
          type: 'checkbox',
          name: 'inclusions',
          label: 'Incluye',
          options: [
            { value: 'transport', label: 'Transporte' },
            { value: 'meals', label: 'Comidas' },
            { value: 'guide', label: 'Guía' },
            { value: 'tickets', label: 'Entradas' },
            { value: 'insurance', label: 'Seguro' }
          ]
        }
      ],
      settings: {
        submitButtonText: 'Crear Tour',
        cancelButtonText: 'Cancelar',
        showProgressBar: true,
        allowSaveDraft: true
      }
    },
    {
      name: 'Formulario de Reservaciones',
      description: 'Formulario para crear reservaciones',
      formType: 'reservation',
      status: 'active',
      fields: [
        {
          id: 'field_1',
          type: 'text',
          name: 'customerName',
          label: 'Nombre del Cliente',
          placeholder: 'Nombre completo',
          required: true
        },
        {
          id: 'field_2',
          type: 'email',
          name: 'customerEmail',
          label: 'Email',
          placeholder: 'correo@ejemplo.com',
          required: true
        },
        {
          id: 'field_3',
          type: 'phone',
          name: 'customerPhone',
          label: 'Teléfono',
          placeholder: '+52 123 456 7890',
          required: true
        },
        {
          id: 'field_4',
          type: 'date',
          name: 'reservationDate',
          label: 'Fecha de Reservación',
          required: true
        },
        {
          id: 'field_5',
          type: 'time',
          name: 'pickupTime',
          label: 'Hora de Recogida',
          required: true
        },
        {
          id: 'field_6',
          type: 'select',
          name: 'serviceType',
          label: 'Tipo de Servicio',
          required: true,
          options: [
            { value: 'airport', label: 'Aeropuerto' },
            { value: 'hotel', label: 'Hotel' },
            { value: 'tour', label: 'Tour' },
            { value: 'experience', label: 'Experiencia' },
            { value: 'transfer', label: 'Traslado' }
          ]
        },
        {
          id: 'field_7',
          type: 'number',
          name: 'passengers',
          label: 'Número de Pasajeros',
          required: true,
          min: 1,
          max: 50
        },
        {
          id: 'field_8',
          type: 'textarea',
          name: 'specialRequests',
          label: 'Solicitudes Especiales',
          placeholder: 'Ingrese cualquier solicitud especial',
          rows: 3
        }
      ],
      settings: {
        submitButtonText: 'Confirmar Reservación',
        cancelButtonText: 'Cancelar',
        showProgressBar: true,
        allowSaveDraft: false,
        sendConfirmationEmail: true
      }
    }
  ];

  for (const template of defaultTemplates) {
    try {
      // Check if template already exists
      const query = new Parse.Query('FormTemplate');
      query.equalTo('formType', template.formType);
      query.equalTo('exists', true);
      const existing = await query.first({ useMasterKey: true });

      if (!existing) {
        const FormTemplate = Parse.Object.extend('FormTemplate');
        const formTemplate = new FormTemplate();
        
        Object.keys(template).forEach(key => {
          formTemplate.set(key, template[key]);
        });
        
        // Ensure formId matches formType for default templates
        formTemplate.set('formId', template.formType);
        formTemplate.set('active', true);
        formTemplate.set('exists', true);
        formTemplate.set('version', 1);
        
        await formTemplate.save(null, { useMasterKey: true });
        console.log(`✓ Created default template: ${template.name}`);
      } else {
        console.log(`⚠ Template already exists: ${template.name}`);
      }
    } catch (error) {
      console.error(`❌ Error creating template ${template.name}:`, error);
    }
  }
}

async function runMigration() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     Migration: Create FormTemplate Table              ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    // Create FormTemplate class
    await createFormTemplateClass();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║              Migration Completed Successfully         ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(0);

  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║                Migration Failed                        ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  runMigration();
}

module.exports = { createFormTemplateClass };