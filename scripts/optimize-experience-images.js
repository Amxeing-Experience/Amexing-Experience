#!/usr/bin/env node

/**
 * Quick script to optimize experience images
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ 
  path: './environments/.env.development' 
});

const AWS = require('aws-sdk');
const sharp = require('sharp');
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = 'http://localhost:1337/parse';

// Initialize S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

async function downloadFromS3(key) {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key
  };
  
  const data = await s3.getObject(params).promise();
  return data.Body;
}

async function uploadToS3(buffer, key, contentType) {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000'
  };
  
  await s3.upload(params).promise();
  console.log(`  ✅ Uploaded: ${key}`);
}

async function optimizeImage(s3Key) {
  console.log(`\n📸 Processing: ${s3Key}`);
  
  try {
    // Download original
    console.log('  ⬇️  Downloading from S3...');
    const buffer = await downloadFromS3(s3Key);
    
    // Get base path without extension
    const basePath = s3Key.replace(/\.(png|jpg|jpeg)$/i, '');
    
    // Create AVIF
    console.log('  🔄 Creating AVIF...');
    const avifBuffer = await sharp(buffer)
      .avif({ quality: 85, effort: 4 })
      .toBuffer();
    await uploadToS3(avifBuffer, `${basePath}.avif`, 'image/avif');
    
    // Create WebP
    console.log('  🔄 Creating WebP...');
    const webpBuffer = await sharp(buffer)
      .webp({ quality: 90 })
      .toBuffer();
    await uploadToS3(webpBuffer, `${basePath}.webp`, 'image/webp');
    
    // Create optimized JPEG
    console.log('  🔄 Creating optimized JPEG...');
    const jpegBuffer = await sharp(buffer)
      .jpeg({ quality: 90, progressive: true })
      .toBuffer();
    await uploadToS3(jpegBuffer, `${basePath}.jpg`, 'image/jpeg');
    
    console.log('  ✅ Complete!');
    return true;
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  const experienceId = process.argv[2] || 'SZt83yL2oF';
  
  console.log('🚀 Experience Image Optimizer');
  console.log('==============================');
  console.log(`Experience ID: ${experienceId}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`S3 Bucket: ${process.env.S3_BUCKET}`);
  console.log(`S3 Prefix: ${process.env.S3_PREFIX}`);
  
  try {
    // List all files in S3 for this experience
    const listParams = {
      Bucket: process.env.S3_BUCKET,
      Prefix: `${process.env.S3_PREFIX}experiences/${experienceId}/`
    };
    
    const s3Files = await s3.listObjectsV2(listParams).promise();
    
    // Filter for PNG/JPG files only (skip already optimized)
    const imagesToProcess = s3Files.Contents
      .filter(file => /\.(png|jpg|jpeg)$/i.test(file.Key))
      .filter(file => !file.Key.includes('.avif') && !file.Key.includes('.webp'));
    
    console.log(`\n📊 Found ${imagesToProcess.length} images to optimize`);
    
    // Process each image
    let successful = 0;
    for (const file of imagesToProcess) {
      const result = await optimizeImage(file.Key);
      if (result) successful++;
    }
    
    console.log(`\n✅ Optimization complete!`);
    console.log(`   Processed: ${successful}/${imagesToProcess.length} images`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });