#!/usr/bin/env node

/**
 * Sync ExperienceImage database records with actual S3 files
 * 
 * This script:
 * 1. Checks what files actually exist in S3
 * 2. Updates database records to match
 * 3. Removes references to non-existent files
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ 
  path: './environments/.env.development' 
});

const Parse = require('parse/node');
const AWS = require('aws-sdk');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = 'http://localhost:1337/parse';

// Initialize S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

async function checkS3FileExists(key) {
  try {
    await s3.headObject({
      Bucket: process.env.S3_BUCKET,
      Key: key
    }).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
}

async function syncImages() {
  console.log('🔄 Syncing ExperienceImage records with S3...');
  console.log('============================================\n');

  try {
    // Query all experience images
    const query = new Parse.Query('ExperienceImage');
    query.equalTo('exists', true);
    query.limit(1000);
    const images = await query.find({ useMasterKey: true });
    
    console.log(`Found ${images.length} images in database\n`);
    
    let fixedCount = 0;
    let deletedCount = 0;
    let validCount = 0;

    for (const img of images) {
      const s3Key = img.get('s3Key');
      const fileName = img.get('fileName');
      const experienceId = img.get('experienceId');
      
      if (!s3Key) {
        console.log(`⚠️  No S3 key for ${fileName}`);
        continue;
      }
      
      // Check if the file exists in S3
      const exists = await checkS3FileExists(s3Key);
      
      if (!exists) {
        console.log(`❌ Not in S3: ${s3Key}`);
        
        // Try to find a similar file in S3 for this experience
        if (experienceId) {
          const expId = experienceId.id || experienceId;
          const prefix = `${process.env.S3_PREFIX}experiences/${expId}/`;
          
          const listResult = await s3.listObjectsV2({
            Bucket: process.env.S3_BUCKET,
            Prefix: prefix
          }).promise();
          
          if (listResult.Contents && listResult.Contents.length > 0) {
            console.log(`   Found ${listResult.Contents.length} files in ${prefix}`);
            
            // Find the most recent PNG file
            const pngFiles = listResult.Contents
              .filter(f => f.Key.endsWith('.png') || f.Key.endsWith('.jpg') || f.Key.endsWith('.jpeg'))
              .sort((a, b) => b.LastModified - a.LastModified);
            
            if (pngFiles.length > 0) {
              const newKey = pngFiles[0].Key;
              console.log(`   ✅ Updating to: ${newKey}`);
              
              // Update the record with the correct S3 key
              img.set('s3Key', newKey);
              
              // Clear optimization metadata since it's invalid
              img.unset('optimizedVariants');
              img.unset('optimizationMetadata');
              
              await img.save(null, { useMasterKey: true });
              fixedCount++;
            } else {
              // No replacement found, mark as deleted
              console.log(`   🗑️  No replacement found, marking as deleted`);
              img.set('exists', false);
              await img.save(null, { useMasterKey: true });
              deletedCount++;
            }
          } else {
            // No files at all for this experience
            console.log(`   🗑️  No files for experience, marking as deleted`);
            img.set('exists', false);
            await img.save(null, { useMasterKey: true });
            deletedCount++;
          }
        } else {
          // No experience ID, can't fix
          console.log(`   🗑️  No experience ID, marking as deleted`);
          img.set('exists', false);
          await img.save(null, { useMasterKey: true });
          deletedCount++;
        }
      } else {
        console.log(`✅ Valid: ${s3Key}`);
        validCount++;
      }
    }

    console.log('\n============================================');
    console.log('📊 Sync Summary:');
    console.log(`✅ Valid: ${validCount} images`);
    console.log(`🔧 Fixed: ${fixedCount} images`);
    console.log(`🗑️  Deleted: ${deletedCount} images`);
    console.log(`📁 Total: ${images.length} images`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the sync
syncImages()
  .then(() => {
    console.log('\n✅ Sync complete! Refresh your browser to see the changes.');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });