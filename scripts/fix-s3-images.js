#!/usr/bin/env node

/**
 * Fix S3 Image Issues Script
 * 
 * This script checks for missing S3 images and updates database records
 * to ensure all image URLs point to the correct environment.
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ 
  path: process.env.NODE_ENV === 'production' 
    ? './environments/.env.production' 
    : './environments/.env.development' 
});

const Parse = require('parse/node');
const AWS = require('aws-sdk');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

// Initialize AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-2',
});

const S3_BUCKET = process.env.S3_BUCKET || 'amexing-bucket';
const S3_PREFIX = process.env.S3_PREFIX || 'dev/';

async function checkS3FileExists(key) {
  try {
    await s3.headObject({
      Bucket: S3_BUCKET,
      Key: key,
    }).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
}

async function fixExperienceImages() {
  console.log('🔍 Checking Experience Images...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`S3 Bucket: ${S3_BUCKET}`);
  console.log(`S3 Prefix: ${S3_PREFIX}`);
  console.log('-----------------------------------');

  try {
    // Query all experience images
    const query = new Parse.Query('ExperienceImage');
    query.equalTo('exists', true);
    query.limit(1000);
    const images = await query.find({ useMasterKey: true });

    console.log(`Found ${images.length} experience images to check\n`);

    let fixedCount = 0;
    let missingCount = 0;
    let stagingCount = 0;

    for (const img of images) {
      const s3Key = img.get('s3Key');
      const fileName = img.get('fileName');
      
      if (!s3Key) {
        console.log(`⚠️  No S3 key for image ${img.id} (${fileName})`);
        continue;
      }

      // Check if it's using wrong environment prefix
      if (s3Key.startsWith('staging/') && S3_PREFIX === 'dev/') {
        stagingCount++;
        const newKey = s3Key.replace('staging/', 'dev/');
        console.log(`🔄 Fixing staging URL: ${s3Key} → ${newKey}`);
        
        // Check if the dev version exists
        const devExists = await checkS3FileExists(newKey);
        if (devExists) {
          img.set('s3Key', newKey);
          await img.save(null, { useMasterKey: true });
          fixedCount++;
          console.log(`✅ Updated to dev prefix`);
        } else {
          console.log(`❌ Dev version doesn't exist in S3`);
          missingCount++;
        }
      } else if (s3Key.startsWith('dev/')) {
        // Check if file exists in S3
        const exists = await checkS3FileExists(s3Key);
        if (!exists) {
          console.log(`❌ Missing in S3: ${s3Key} (${fileName})`);
          missingCount++;
          
          // Mark as inactive if file doesn't exist
          img.set('active', false);
          img.set('exists', false);
          await img.save(null, { useMasterKey: true });
          console.log(`   Marked as deleted in database`);
        }
      }
    }

    console.log('\n-----------------------------------');
    console.log('📊 Summary:');
    console.log(`✅ Fixed ${fixedCount} images with wrong environment`);
    console.log(`⚠️  Found ${stagingCount} staging references`);
    console.log(`❌ Found ${missingCount} missing images in S3`);
    console.log(`📁 Total images checked: ${images.length}`);

    // Also check provider experiences
    await fixProviderExperienceImages();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function fixProviderExperienceImages() {
  console.log('\n🔍 Checking Provider Experience Images...');
  console.log('-----------------------------------');

  try {
    const query = new Parse.Query('ProviderExperiencia');
    query.equalTo('exists', true);
    query.limit(1000);
    const experiences = await query.find({ useMasterKey: true });

    console.log(`Found ${experiences.length} provider experiences to check\n`);

    let fixedCount = 0;
    let issuesCount = 0;

    for (const exp of experiences) {
      const photos = exp.get('photos') || [];
      let hasChanges = false;

      const updatedPhotos = photos.map(photo => {
        if (photo.s3Key) {
          // Fix staging references
          if (photo.s3Key.startsWith('staging/') && S3_PREFIX === 'dev/') {
            const newKey = photo.s3Key.replace('staging/', 'dev/');
            console.log(`🔄 Fixing provider photo: ${photo.s3Key} → ${newKey}`);
            hasChanges = true;
            fixedCount++;
            return { ...photo, s3Key: newKey };
          }
        }
        return photo;
      });

      if (hasChanges) {
        exp.set('photos', updatedPhotos);
        await exp.save(null, { useMasterKey: true });
        console.log(`✅ Updated provider experience ${exp.id}`);
      }
    }

    console.log('\n-----------------------------------');
    console.log('📊 Provider Summary:');
    console.log(`✅ Fixed ${fixedCount} photo references`);
    console.log(`📁 Total experiences checked: ${experiences.length}`);

  } catch (error) {
    console.error('❌ Error in provider experiences:', error.message);
  }
}

// Run the script
fixExperienceImages()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });