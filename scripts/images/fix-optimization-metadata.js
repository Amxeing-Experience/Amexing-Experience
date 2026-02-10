#!/usr/bin/env node

/**
 * Fix optimization metadata for vehicle and experience images
 * Updates the availableFormats field to correctly reflect all optimized variants
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../environments/.env.' + (process.env.NODE_ENV || 'development')) });
const Parse = require('parse/node');
const AWS = require('aws-sdk');
const logger = require('../../src/infrastructure/logger');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY;

// Initialize S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-2',
});

const BUCKET_NAME = process.env.S3_BUCKET;
const PREFIX = process.env.NODE_ENV === 'production' ? 'prod/' : 'dev/';

/**
 * Check if optimized variants exist in S3 for a given key
 */
async function checkOptimizedVariants(originalKey) {
  const variants = {
    avif: false,
    webp: false,
    jpeg: false,
  };

  // Extract path components
  const keyParts = originalKey.split('/');
  const filename = keyParts[keyParts.length - 1];
  const basePath = keyParts.slice(0, -1).join('/');
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));

  // Check for each variant in optimized folder
  const optimizedPath = `${basePath}/optimized`;
  
  const checksPromises = [
    // Check AVIF
    s3.headObject({
      Bucket: BUCKET_NAME,
      Key: `${optimizedPath}/${nameWithoutExt}.avif`
    }).promise().then(() => { variants.avif = true; }).catch(() => {}),
    
    // Check WebP
    s3.headObject({
      Bucket: BUCKET_NAME,
      Key: `${optimizedPath}/${nameWithoutExt}.webp`
    }).promise().then(() => { variants.webp = true; }).catch(() => {}),
    
    // Check optimized JPEG
    s3.headObject({
      Bucket: BUCKET_NAME,
      Key: `${optimizedPath}/${nameWithoutExt}.jpg`
    }).promise().then(() => { variants.jpeg = true; }).catch(() => {}),
  ];

  await Promise.all(checksPromises);
  
  return variants;
}

/**
 * Fix metadata for vehicle images
 */
async function fixVehicleImages() {
  console.log('\n📸 Fixing Vehicle Images metadata...');
  
  const query = new Parse.Query('VehicleImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(1000);
  
  const images = await query.find({ useMasterKey: true });
  console.log(`Found ${images.length} vehicle images to check`);
  
  let updated = 0;
  let skipped = 0;
  
  for (const image of images) {
    const s3Key = image.get('s3Key');
    if (!s3Key) {
      skipped++;
      continue;
    }
    
    // Check what variants actually exist in S3
    const variants = await checkOptimizedVariants(s3Key);
    
    // Build available formats array
    const availableFormats = ['original']; // Always have original
    if (variants.avif) availableFormats.unshift('avif');
    if (variants.webp) availableFormats.unshift('webp');
    if (variants.jpeg) availableFormats.unshift('jpeg');
    
    // Update metadata
    const currentMetadata = image.get('optimizationMetadata') || {};
    const newMetadata = {
      ...currentMetadata,
      availableFormats: availableFormats,
      optimized: availableFormats.length > 1,
      hasAvif: variants.avif,
      hasWebp: variants.webp,
      hasJpeg: variants.jpeg,
      updatedAt: new Date().toISOString(),
      fixedBy: 'fix-optimization-metadata-script'
    };
    
    // Only update if formats have changed
    const currentFormats = currentMetadata.availableFormats || [];
    if (JSON.stringify(currentFormats.sort()) !== JSON.stringify(availableFormats.sort())) {
      image.set('optimizationMetadata', newMetadata);
      await image.save(null, { useMasterKey: true });
      updated++;
      console.log(`✅ Updated ${image.get('fileName')}: ${availableFormats.join(', ')}`);
    } else {
      skipped++;
    }
  }
  
  console.log(`Vehicle images: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

/**
 * Fix metadata for experience images
 */
async function fixExperienceImages() {
  console.log('\n🎨 Fixing Experience Images metadata...');
  
  const query = new Parse.Query('ExperienceImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(1000);
  
  const images = await query.find({ useMasterKey: true });
  console.log(`Found ${images.length} experience images to check`);
  
  let updated = 0;
  let skipped = 0;
  
  for (const image of images) {
    const s3Key = image.get('s3Key');
    if (!s3Key) {
      skipped++;
      continue;
    }
    
    // Check what variants actually exist in S3
    const variants = await checkOptimizedVariants(s3Key);
    
    // Build available formats array
    const availableFormats = ['original']; // Always have original
    if (variants.avif) availableFormats.unshift('avif');
    if (variants.webp) availableFormats.unshift('webp');
    if (variants.jpeg) availableFormats.unshift('jpeg');
    
    // Update metadata
    const currentMetadata = image.get('optimizationMetadata') || {};
    const newMetadata = {
      ...currentMetadata,
      availableFormats: availableFormats,
      optimized: availableFormats.length > 1,
      hasAvif: variants.avif,
      hasWebp: variants.webp,
      hasJpeg: variants.jpeg,
      updatedAt: new Date().toISOString(),
      fixedBy: 'fix-optimization-metadata-script'
    };
    
    // Only update if formats have changed
    const currentFormats = currentMetadata.availableFormats || [];
    if (JSON.stringify(currentFormats.sort()) !== JSON.stringify(availableFormats.sort())) {
      image.set('optimizationMetadata', newMetadata);
      await image.save(null, { useMasterKey: true });
      updated++;
      console.log(`✅ Updated ${image.get('fileName')}: ${availableFormats.join(', ')}`);
    } else {
      skipped++;
    }
  }
  
  console.log(`Experience images: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 Fix Optimization Metadata Script');
  console.log('====================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`S3 Bucket: ${BUCKET_NAME}`);
  console.log(`S3 Prefix: ${PREFIX}`);
  console.log('');
  
  try {
    const vehicleResults = await fixVehicleImages();
    const experienceResults = await fixExperienceImages();
    
    console.log('\n📊 Summary');
    console.log('==========');
    console.log(`Vehicle Images: ${vehicleResults.updated} updated, ${vehicleResults.skipped} skipped`);
    console.log(`Experience Images: ${experienceResults.updated} updated, ${experienceResults.skipped} skipped`);
    console.log(`Total Updated: ${vehicleResults.updated + experienceResults.updated}`);
    console.log('\n✅ Metadata fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Error fixing metadata:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { fixVehicleImages, fixExperienceImages };