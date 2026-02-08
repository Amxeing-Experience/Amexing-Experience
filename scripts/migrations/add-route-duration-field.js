#!/usr/bin/env node

/**
 * Migration: Add routeDuration field to Services table
 * 
 * This script adds the routeDuration field to the Services table
 * to store the estimated duration of each route in minutes.
 */

require('dotenv').config({
  path: `environments/.env.${process.env.NODE_ENV || 'development'}`
});

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'amexingExperience',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'masterKey123'
);

Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

async function addRouteDurationField() {
  try {
    console.log('🚀 Starting migration: Add routeDuration field to Services table');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Parse Server URL:', Parse.serverURL);

    // Get the schema
    const schema = new Parse.Schema('Services');
    
    try {
      // Fetch existing schema
      await schema.get();
      
      // Check if field already exists
      const existingFields = schema._fields;
      if (existingFields.routeDuration) {
        console.log('⚠️ Field routeDuration already exists in Services schema');
        return;
      }
      
      // Add the routeDuration field
      schema.addNumber('routeDuration');
      
      // Update the schema
      await schema.update({ useMasterKey: true });
      
      console.log('✅ Successfully added routeDuration field to Services schema');
    } catch (error) {
      if (error.message.includes('Class Services does not exist')) {
        console.log('⚠️ Services class does not exist yet');
        
        // Create the schema with the field
        const newSchema = new Parse.Schema('Services');
        newSchema.addNumber('routeDuration');
        await newSchema.save({ useMasterKey: true });
        
        console.log('✅ Created Services schema with routeDuration field');
      } else {
        throw error;
      }
    }

    // Verify the field was added
    const updatedSchema = new Parse.Schema('Services');
    await updatedSchema.get();
    
    if (updatedSchema._fields.routeDuration) {
      console.log('✅ Verification successful: routeDuration field is present in Services schema');
      console.log('Field type:', updatedSchema._fields.routeDuration.type);
    } else {
      console.error('❌ Verification failed: routeDuration field not found in schema');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the migration
addRouteDurationField()
  .then(() => {
    console.log('🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration error:', error);
    process.exit(1);
  });