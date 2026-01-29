/**
 * Migration: Create Form System Tables
 * Creates FormTemplate and FormSubmission tables for the dynamic form builder
 * 
 * Created by Denisse Maldonado
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

/**
 * Run the migration
 * Creates FormTemplate and FormSubmission tables with appropriate indexes
 */
async function up() {
  try {
    logger.info('Starting form system tables migration...');

    // Create FormTemplate schema
    const FormTemplate = Parse.Object.extend('FormTemplate');
    const templateSchema = new Parse.Schema('FormTemplate');
    
    // Check if schema already exists
    try {
      await templateSchema.get();
      logger.info('FormTemplate schema already exists, updating...');
    } catch (error) {
      // Schema doesn't exist, create it
      logger.info('Creating FormTemplate schema...');
      
      await templateSchema
        .addString('formId')
        .addString('title')
        .addString('description')
        .addArray('fields')
        .addObject('settings')
        .addObject('validation')
        .addNumber('version')
        .addString('createdBy')
        .addString('updatedBy')
        .addBoolean('active')
        .addBoolean('exists')
        .addDate('publishedAt')
        .addString('status')
        .addArray('tags')
        .addObject('metadata')
        .save();
        
      logger.info('FormTemplate schema created successfully');
    }

    // Add indexes for FormTemplate
    await templateSchema
      .addIndex('formId_index', { formId: 1 })
      .addIndex('active_exists_index', { active: 1, exists: 1 })
      .addIndex('status_index', { status: 1 })
      .update();
      
    logger.info('FormTemplate indexes created');

    // Create FormSubmission schema
    const FormSubmission = Parse.Object.extend('FormSubmission');
    const submissionSchema = new Parse.Schema('FormSubmission');
    
    // Check if schema already exists
    try {
      await submissionSchema.get();
      logger.info('FormSubmission schema already exists, updating...');
    } catch (error) {
      // Schema doesn't exist, create it
      logger.info('Creating FormSubmission schema...');
      
      await submissionSchema
        .addString('formId')
        .addString('formTitle')
        .addObject('data')
        .addPointer('submittedBy', '_User')
        .addDate('submittedAt')
        .addString('status')
        .addObject('metadata')
        .addBoolean('active')
        .addBoolean('exists')
        .addString('deletedBy')
        .addDate('deletedAt')
        .addArray('attachments')
        .addObject('validation')
        .addString('confirmationCode')
        .addObject('response')
        .save();
        
      logger.info('FormSubmission schema created successfully');
    }

    // Add indexes for FormSubmission
    await submissionSchema
      .addIndex('formId_index', { formId: 1 })
      .addIndex('submittedBy_index', { submittedBy: 1 })
      .addIndex('status_index', { status: 1 })
      .addIndex('exists_index', { exists: 1 })
      .addIndex('submittedAt_index', { submittedAt: -1 })
      .addIndex('confirmationCode_index', { confirmationCode: 1 })
      .update();
      
    logger.info('FormSubmission indexes created');

    // Create sample form templates
    await createSampleTemplates();

    logger.info('Form system tables migration completed successfully');
    return { success: true, message: 'Form system tables created successfully' };
  } catch (error) {
    logger.error('Error in form system tables migration:', error);
    throw error;
  }
}

/**
 * Rollback the migration
 * Removes FormTemplate and FormSubmission tables
 */
async function down() {
  try {
    logger.info('Rolling back form system tables migration...');

    // Note: Parse Server doesn't support dropping schemas programmatically
    // You would need to manually delete these schemas from Parse Dashboard
    // or MongoDB directly if needed

    logger.warn('FormTemplate and FormSubmission schemas need to be manually removed from Parse Dashboard or MongoDB');

    return { success: true, message: 'Rollback instructions provided' };
  } catch (error) {
    logger.error('Error rolling back form system tables migration:', error);
    throw error;
  }
}

/**
 * Create sample form templates
 */
async function createSampleTemplates() {
  try {
    const FormTemplate = Parse.Object.extend('FormTemplate');
    
    // Check if sample templates already exist
    const query = new Parse.Query(FormTemplate);
    query.equalTo('formId', 'experience');
    const existing = await query.first({ useMasterKey: true });
    
    if (existing) {
      logger.info('Sample form templates already exist');
      return;
    }

    // Experience form template
    const experienceTemplate = new FormTemplate();
    experienceTemplate.set('formId', 'experience');
    experienceTemplate.set('title', 'Formulario de Experiencias');
    experienceTemplate.set('description', 'Formulario para crear y editar experiencias turísticas');
    experienceTemplate.set('fields', [
      {
        id: 'field-1',
        componentType: 'atom:input-text',
        props: {
          name: 'experienceName',
          label: 'Nombre de la Experiencia',
          placeholder: 'Ingrese el nombre de la experiencia',
          required: true,
          helpText: 'Este será el título principal de la experiencia',
          validation: {
            minLength: 3,
            maxLength: 100
          }
        },
        position: 0,
        section: 'basic-info'
      },
      {
        id: 'field-2',
        componentType: 'atom:textarea',
        props: {
          name: 'description',
          label: 'Descripción',
          placeholder: 'Describa la experiencia',
          rows: 4,
          helpText: 'Proporcione una descripción detallada',
          validation: {
            maxLength: 500
          }
        },
        position: 1,
        section: 'basic-info'
      },
      {
        id: 'field-3',
        componentType: 'atom:select',
        props: {
          name: 'category',
          label: 'Categoría',
          required: true,
          options: [
            { value: 'adventure', label: 'Aventura' },
            { value: 'cultural', label: 'Cultural' },
            { value: 'relaxation', label: 'Relajación' },
            { value: 'gastronomy', label: 'Gastronomía' }
          ]
        },
        position: 2,
        section: 'basic-info'
      },
      {
        id: 'field-4',
        componentType: 'atom:input-number',
        props: {
          name: 'price',
          label: 'Precio',
          placeholder: '0.00',
          required: true,
          min: 0,
          step: 0.01,
          helpText: 'Precio en USD'
        },
        position: 3,
        section: 'pricing'
      },
      {
        id: 'field-5',
        componentType: 'atom:datepicker',
        props: {
          name: 'availableFrom',
          label: 'Disponible desde',
          required: true
        },
        position: 4,
        section: 'availability'
      }
    ]);
    experienceTemplate.set('settings', {
      submitUrl: '/api/forms/experience/submit',
      redirectAfterSubmit: false,
      showProgressBar: false,
      enableDrafts: true
    });
    experienceTemplate.set('validation', {
      validateOnBlur: true,
      validateOnSubmit: true,
      showInlineErrors: true
    });
    experienceTemplate.set('version', 1);
    experienceTemplate.set('status', 'published');
    experienceTemplate.set('active', true);
    experienceTemplate.set('exists', true);
    experienceTemplate.set('tags', ['tourism', 'experience']);
    
    await experienceTemplate.save(null, { useMasterKey: true });
    logger.info('Created experience form template');

    // Tour form template
    const tourTemplate = new FormTemplate();
    tourTemplate.set('formId', 'tour');
    tourTemplate.set('title', 'Formulario de Tours');
    tourTemplate.set('description', 'Formulario para gestionar tours');
    tourTemplate.set('fields', [
      {
        id: 'field-1',
        componentType: 'atom:input-text',
        props: {
          name: 'tourName',
          label: 'Nombre del Tour',
          placeholder: 'Ingrese el nombre del tour',
          required: true,
          validation: {
            minLength: 3,
            maxLength: 100
          }
        },
        position: 0
      },
      {
        id: 'field-2',
        componentType: 'atom:input-number',
        props: {
          name: 'duration',
          label: 'Duración (horas)',
          min: 1,
          max: 24,
          required: true
        },
        position: 1
      },
      {
        id: 'field-3',
        componentType: 'atom:input-number',
        props: {
          name: 'maxParticipants',
          label: 'Participantes Máximos',
          min: 1,
          max: 100,
          required: true
        },
        position: 2
      }
    ]);
    tourTemplate.set('settings', {
      submitUrl: '/api/forms/tour/submit',
      enableDrafts: true
    });
    tourTemplate.set('version', 1);
    tourTemplate.set('status', 'published');
    tourTemplate.set('active', true);
    tourTemplate.set('exists', true);
    tourTemplate.set('tags', ['tourism', 'tour']);
    
    await tourTemplate.save(null, { useMasterKey: true });
    logger.info('Created tour form template');

    // Vehicle form template
    const vehicleTemplate = new FormTemplate();
    vehicleTemplate.set('formId', 'vehicle');
    vehicleTemplate.set('title', 'Formulario de Vehículos');
    vehicleTemplate.set('description', 'Formulario para registrar vehículos');
    vehicleTemplate.set('fields', [
      {
        id: 'field-1',
        componentType: 'atom:input-text',
        props: {
          name: 'licensePlate',
          label: 'Placa',
          placeholder: 'ABC-123',
          required: true,
          validation: {
            pattern: '^[A-Z0-9-]+$'
          }
        },
        position: 0
      },
      {
        id: 'field-2',
        componentType: 'atom:input-text',
        props: {
          name: 'brand',
          label: 'Marca',
          required: true
        },
        position: 1
      },
      {
        id: 'field-3',
        componentType: 'atom:input-text',
        props: {
          name: 'model',
          label: 'Modelo',
          required: true
        },
        position: 2
      },
      {
        id: 'field-4',
        componentType: 'atom:input-number',
        props: {
          name: 'year',
          label: 'Año',
          min: 1900,
          max: new Date().getFullYear() + 1,
          required: true
        },
        position: 3
      }
    ]);
    vehicleTemplate.set('settings', {
      submitUrl: '/api/forms/vehicle/submit',
      enableDrafts: false
    });
    vehicleTemplate.set('version', 1);
    vehicleTemplate.set('status', 'published');
    vehicleTemplate.set('active', true);
    vehicleTemplate.set('exists', true);
    vehicleTemplate.set('tags', ['fleet', 'vehicle']);
    
    await vehicleTemplate.save(null, { useMasterKey: true });
    logger.info('Created vehicle form template');

    logger.info('Sample form templates created successfully');
  } catch (error) {
    logger.error('Error creating sample templates:', error);
    throw error;
  }
}

module.exports = {
  up,
  down,
  description: 'Create FormTemplate and FormSubmission tables for dynamic form builder'
};