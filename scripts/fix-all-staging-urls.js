#!/usr/bin/env node

/**
 * Fix ALL Staging URLs in Database
 * 
 * This script comprehensively fixes all staging URL references in the database,
 * including nested objects and optimizedVariants.
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ 
  path: process.env.NODE_ENV === 'production' 
    ? './environments/.env.production' 
    : './environments/.env.development' 
});

const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

const S3_PREFIX = process.env.S3_PREFIX || 'dev/';

/**
 * Recursively fix staging references in an object
 */
function fixStagingInObject(obj) {
  if (!obj) return obj;
  
  if (typeof obj === 'string') {
    // Replace staging/ with current environment prefix
    return obj.replace(/staging\//g, S3_PREFIX);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => fixStagingInObject(item));
  }
  
  if (typeof obj === 'object') {
    const fixed = {};
    for (const key in obj) {
      fixed[key] = fixStagingInObject(obj[key]);
    }
    return fixed;
  }
  
  return obj;
}

async function fixProviderExperiences() {
  console.log('🔍 Fixing ALL staging references in Provider Experiences...');
  console.log(`Current Environment Prefix: ${S3_PREFIX}`);
  console.log('-----------------------------------');

  try {
    const query = new Parse.Query('ProviderExperiencia');
    query.equalTo('exists', true);
    query.limit(1000);
    const experiences = await query.find({ useMasterKey: true });

    console.log(`Found ${experiences.length} provider experiences to check\n`);

    let fixedCount = 0;
    let fixedExperiences = 0;

    for (const exp of experiences) {
      const photos = exp.get('photos') || [];
      const originalJson = JSON.stringify(photos);
      
      // Fix all staging references in photos (including nested objects)
      const fixedPhotos = fixStagingInObject(photos);
      const fixedJson = JSON.stringify(fixedPhotos);
      
      if (originalJson !== fixedJson) {
        // Count how many staging references were fixed
        const stagingMatches = originalJson.match(/staging\//g);
        const fixCount = stagingMatches ? stagingMatches.length : 0;
        
        console.log(`📝 Experience: ${exp.get('name')} (${exp.id})`);
        console.log(`   Fixed ${fixCount} staging references`);
        
        exp.set('photos', fixedPhotos);
        await exp.save(null, { useMasterKey: true });
        
        fixedCount += fixCount;
        fixedExperiences++;
        console.log(`   ✅ Saved successfully\n`);
      }
    }

    console.log('-----------------------------------');
    console.log('📊 Provider Experiences Summary:');
    console.log(`✅ Fixed ${fixedCount} staging references`);
    console.log(`📝 Updated ${fixedExperiences} experiences`);
    console.log(`📁 Total checked: ${experiences.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

async function fixExperienceImages() {
  console.log('\n🔍 Fixing staging references in Experience Images...');
  console.log('-----------------------------------');

  try {
    const query = new Parse.Query('ExperienceImage');
    query.equalTo('exists', true);
    query.limit(1000);
    const images = await query.find({ useMasterKey: true });

    console.log(`Found ${images.length} experience images to check\n`);

    let fixedCount = 0;

    for (const img of images) {
      let hasChanges = false;
      
      // Fix s3Key
      const s3Key = img.get('s3Key');
      if (s3Key && s3Key.includes('staging/')) {
        const newKey = s3Key.replace(/staging\//g, S3_PREFIX);
        console.log(`🔄 Fixing s3Key: ${s3Key} → ${newKey}`);
        img.set('s3Key', newKey);
        hasChanges = true;
        fixedCount++;
      }
      
      // Fix optimizedVariants
      const optimizedVariants = img.get('optimizedVariants');
      if (optimizedVariants) {
        const originalJson = JSON.stringify(optimizedVariants);
        const fixed = fixStagingInObject(optimizedVariants);
        const fixedJson = JSON.stringify(fixed);
        
        if (originalJson !== fixedJson) {
          console.log(`🔄 Fixing optimizedVariants for ${img.get('fileName')}`);
          img.set('optimizedVariants', fixed);
          hasChanges = true;
          fixedCount++;
        }
      }
      
      // Fix optimizationMetadata
      const metadata = img.get('optimizationMetadata');
      if (metadata) {
        const originalJson = JSON.stringify(metadata);
        const fixed = fixStagingInObject(metadata);
        const fixedJson = JSON.stringify(fixed);
        
        if (originalJson !== fixedJson) {
          console.log(`🔄 Fixing optimizationMetadata for ${img.get('fileName')}`);
          img.set('optimizationMetadata', fixed);
          hasChanges = true;
          fixedCount++;
        }
      }
      
      if (hasChanges) {
        await img.save(null, { useMasterKey: true });
        console.log(`   ✅ Saved successfully\n`);
      }
    }

    console.log('-----------------------------------');
    console.log('📊 Experience Images Summary:');
    console.log(`✅ Fixed ${fixedCount} staging references`);
    console.log(`📁 Total checked: ${images.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

async function fixAllStagingReferences() {
  console.log('🚀 Starting comprehensive staging URL fix...');
  console.log('===========================================\n');
  
  try {
    await fixProviderExperiences();
    await fixExperienceImages();
    
    console.log('\n===========================================');
    console.log('✅ All staging references have been fixed!');
    console.log('🔄 Please refresh your browser to see the changes.');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

// Run the script
fixAllStagingReferences()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });