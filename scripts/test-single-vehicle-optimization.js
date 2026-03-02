#!/usr/bin/env node

/**
 * Safe Test Script for Single Vehicle Image Optimization
 * 
 * This script safely tests image optimization on a COPY of a production vehicle image
 * WITHOUT modifying any production data. It:
 * 1. Fetches ONE vehicle image from production
 * 2. Creates a test copy with a unique name
 * 3. Runs optimization to create AVIF, WebP, and JPEG variants
 * 4. Verifies all formats and metadata
 * 5. Cleans up test files (optional)
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

// Load development environment for AWS credentials, production for Parse
require('dotenv').config({ path: `environments/.env.development` });
// Override with production Parse settings
require('dotenv').config({ path: `environments/.env.production`, override: true });

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

// Initialize Parse with production settings (from .env.production)
// Use production Parse credentials directly
const PROD_PARSE_APP_ID = 'CrTRTaJpoJFNt8PJ';
const PROD_PARSE_MASTER_KEY = process.env.PARSE_MASTER_KEY || 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP';
const PROD_PARSE_SERVER_URL = 'https://quotes.amexingexperience.com/parse';

Parse.initialize(PROD_PARSE_APP_ID, null, PROD_PARSE_MASTER_KEY);
Parse.serverURL = PROD_PARSE_SERVER_URL;
Parse.masterKey = PROD_PARSE_MASTER_KEY;

// Initialize AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

// Configuration
const CONFIG = {
  bucket: process.env.S3_BUCKET || 'amexing-bucket',
  testPrefix: `test-optimization-${Date.now()}/`,
  cleanup: !process.argv.includes('--no-cleanup'),
  verbose: process.argv.includes('--verbose')
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Get metadata from S3 object
 */
async function getS3Metadata(key) {
  try {
    const headResult = await s3.headObject({
      Bucket: CONFIG.bucket,
      Key: key
    }).promise();
    
    return {
      contentType: headResult.ContentType,
      contentLength: headResult.ContentLength,
      lastModified: headResult.LastModified,
      metadata: headResult.Metadata,
      etag: headResult.ETag
    };
  } catch (error) {
    if (error.code === 'NotFound') {
      return null;
    }
    throw error;
  }
}

/**
 * Download image from S3
 */
async function downloadFromS3(key) {
  const result = await s3.getObject({
    Bucket: CONFIG.bucket,
    Key: key
  }).promise();
  
  return result.Body;
}

/**
 * Upload optimized image to S3 (test location)
 */
async function uploadToS3(key, buffer, contentType, metadata = {}) {
  const params = {
    Bucket: CONFIG.bucket,
    Key: CONFIG.testPrefix + key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      ...metadata,
      'test-upload': 'true',
      'original-key': key,
      'upload-date': new Date().toISOString()
    }
  };
  
  if (CONFIG.verbose) {
    log(`  Uploading to: ${params.Key}`, 'cyan');
  }
  
  const result = await s3.upload(params).promise();
  return result.Location;
}

/**
 * Optimize image to multiple formats
 */
async function optimizeImage(buffer, originalKey) {
  const results = {
    original: null,
    jpeg: null,
    webp: null,
    avif: null,
    metadata: {}
  };
  
  try {
    // Get original image metadata
    const sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();
    results.metadata = {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: buffer.length,
      hasAlpha: metadata.hasAlpha,
      density: metadata.density
    };
    
    log(`\n📸 Original Image Metadata:`, 'cyan');
    log(`  Dimensions: ${metadata.width}x${metadata.height}`, 'reset');
    log(`  Format: ${metadata.format}`, 'reset');
    log(`  Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`, 'reset');
    
    // Create optimized JPEG
    log(`\n🔄 Creating optimized JPEG...`, 'yellow');
    const jpegBuffer = await sharp(buffer)
      .jpeg({
        quality: 85,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();
    
    const jpegKey = originalKey.replace(/\.[^.]+$/, '.jpeg');
    const jpegUrl = await uploadToS3(jpegKey, jpegBuffer, 'image/jpeg', {
      'optimization': 'jpeg',
      'quality': '85',
      'original-size': buffer.length.toString(),
      'optimized-size': jpegBuffer.length.toString()
    });
    
    results.jpeg = {
      key: CONFIG.testPrefix + jpegKey,
      size: jpegBuffer.length,
      reduction: ((1 - jpegBuffer.length / buffer.length) * 100).toFixed(2) + '%',
      url: jpegUrl
    };
    
    log(`  ✓ JPEG created: ${(jpegBuffer.length / 1024 / 1024).toFixed(2)} MB (${results.jpeg.reduction} reduction)`, 'green');
    
    // Create WebP
    log(`\n🔄 Creating WebP...`, 'yellow');
    const webpBuffer = await sharp(buffer)
      .webp({
        quality: 85,
        effort: 6
      })
      .toBuffer();
    
    const webpKey = originalKey.replace(/\.[^.]+$/, '.webp');
    const webpUrl = await uploadToS3(webpKey, webpBuffer, 'image/webp', {
      'optimization': 'webp',
      'quality': '85',
      'original-size': buffer.length.toString(),
      'optimized-size': webpBuffer.length.toString()
    });
    
    results.webp = {
      key: CONFIG.testPrefix + webpKey,
      size: webpBuffer.length,
      reduction: ((1 - webpBuffer.length / buffer.length) * 100).toFixed(2) + '%',
      url: webpUrl
    };
    
    log(`  ✓ WebP created: ${(webpBuffer.length / 1024 / 1024).toFixed(2)} MB (${results.webp.reduction} reduction)`, 'green');
    
    // Create AVIF
    log(`\n🔄 Creating AVIF...`, 'yellow');
    const avifBuffer = await sharp(buffer)
      .avif({
        quality: 80,
        effort: 6
      })
      .toBuffer();
    
    const avifKey = originalKey.replace(/\.[^.]+$/, '.avif');
    const avifUrl = await uploadToS3(avifKey, avifBuffer, 'image/avif', {
      'optimization': 'avif',
      'quality': '80',
      'original-size': buffer.length.toString(),
      'optimized-size': avifBuffer.length.toString()
    });
    
    results.avif = {
      key: CONFIG.testPrefix + avifKey,
      size: avifBuffer.length,
      reduction: ((1 - avifBuffer.length / buffer.length) * 100).toFixed(2) + '%',
      url: avifUrl
    };
    
    log(`  ✓ AVIF created: ${(avifBuffer.length / 1024 / 1024).toFixed(2)} MB (${results.avif.reduction} reduction)`, 'green');
    
    // Upload original for comparison
    const originalUrl = await uploadToS3(originalKey, buffer, `image/${metadata.format}`, {
      'optimization': 'none',
      'original': 'true'
    });
    
    results.original = {
      key: CONFIG.testPrefix + originalKey,
      size: buffer.length,
      url: originalUrl
    };
    
  } catch (error) {
    log(`  ✗ Optimization failed: ${error.message}`, 'red');
    throw error;
  }
  
  return results;
}

/**
 * Verify optimized images
 */
async function verifyOptimizedImages(results) {
  log(`\n🔍 Verifying optimized images...`, 'cyan');
  
  for (const format of ['jpeg', 'webp', 'avif']) {
    if (results[format]) {
      const metadata = await getS3Metadata(results[format].key);
      if (metadata) {
        log(`  ✓ ${format.toUpperCase()} verified:`, 'green');
        log(`    - Content-Type: ${metadata.contentType}`, 'reset');
        log(`    - Size: ${(metadata.contentLength / 1024 / 1024).toFixed(2)} MB`, 'reset');
        log(`    - Metadata: ${JSON.stringify(metadata.metadata, null, 2)}`, 'reset');
      } else {
        log(`  ✗ ${format.toUpperCase()} not found in S3`, 'red');
      }
    }
  }
}

/**
 * Clean up test files
 */
async function cleanupTestFiles(results) {
  if (!CONFIG.cleanup) {
    log(`\n⚠️  Cleanup skipped. Test files remain in S3 under: ${CONFIG.testPrefix}`, 'yellow');
    return;
  }
  
  log(`\n🧹 Cleaning up test files...`, 'yellow');
  
  const keys = [];
  for (const format of ['original', 'jpeg', 'webp', 'avif']) {
    if (results[format]?.key) {
      keys.push({ Key: results[format].key });
    }
  }
  
  if (keys.length > 0) {
    await s3.deleteObjects({
      Bucket: CONFIG.bucket,
      Delete: { Objects: keys }
    }).promise();
    
    log(`  ✓ Deleted ${keys.length} test files`, 'green');
  }
}

/**
 * Main function
 */
async function testVehicleImageOptimization() {
  try {
    log('========================================', 'bright');
    log('Vehicle Image Optimization Test', 'cyan');
    log('========================================', 'bright');
    log('\n⚠️  This is a SAFE test that will NOT modify production data', 'yellow');
    log(`Test files will be uploaded to: ${CONFIG.testPrefix}`, 'yellow');
    
    // Step 1: Find a vehicle with an image
    log('\n📊 Finding a vehicle with image from production...', 'yellow');
    
    const query = new Parse.Query('VehicleImage');
    query.equalTo('exists', true);
    query.exists('s3Key');
    query.limit(1);
    query.descending('updatedAt');
    query.include('vehicle');
    
    const vehicleImage = await query.first({ useMasterKey: true });
    
    if (!vehicleImage) {
      log('  ✗ No vehicle images found in production', 'red');
      return;
    }
    
    const s3Key = vehicleImage.get('s3Key');
    const vehicle = vehicleImage.get('vehicle');
    const vehicleName = vehicle ? vehicle.get('name') : 'Unknown';
    
    log(`  ✓ Found vehicle image: ${vehicleName}`, 'green');
    log(`    - Image ID: ${vehicleImage.id}`, 'reset');
    log(`    - S3 Key: ${s3Key}`, 'reset');
    log(`    - Vehicle: ${vehicleName} (${vehicle?.id})`, 'reset');
    
    // Step 2: Check if image exists in S3
    log('\n🔍 Checking image in S3...', 'yellow');
    const originalMetadata = await getS3Metadata(s3Key);
    
    if (!originalMetadata) {
      log(`  ✗ Image not found in S3: ${s3Key}`, 'red');
      return;
    }
    
    log(`  ✓ Image found in S3`, 'green');
    log(`    - Size: ${(originalMetadata.contentLength / 1024 / 1024).toFixed(2)} MB`, 'reset');
    log(`    - Type: ${originalMetadata.contentType}`, 'reset');
    log(`    - Last Modified: ${originalMetadata.lastModified}`, 'reset');
    
    // Step 3: Download the original image
    log('\n📥 Downloading original image...', 'yellow');
    const imageBuffer = await downloadFromS3(s3Key);
    log(`  ✓ Downloaded ${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB`, 'green');
    
    // Step 4: Optimize the image
    log('\n🎨 Starting optimization process...', 'cyan');
    const testKey = `vehicle-${vehicle?.id}-test-${Date.now()}.jpg`;
    const results = await optimizeImage(imageBuffer, testKey);
    
    // Step 5: Verify the optimized images
    await verifyOptimizedImages(results);
    
    // Step 6: Summary
    log('\n========================================', 'bright');
    log('Optimization Test Results', 'cyan');
    log('========================================', 'bright');
    log(`Vehicle: ${vehicleName}`, 'magenta');
    log(`Original Size: ${(results.original.size / 1024 / 1024).toFixed(2)} MB`, 'reset');
    log('\nOptimized Formats:', 'cyan');
    log(`  JPEG: ${(results.jpeg.size / 1024 / 1024).toFixed(2)} MB (${results.jpeg.reduction} reduction)`, 'green');
    log(`  WebP: ${(results.webp.size / 1024 / 1024).toFixed(2)} MB (${results.webp.reduction} reduction)`, 'green');
    log(`  AVIF: ${(results.avif.size / 1024 / 1024).toFixed(2)} MB (${results.avif.reduction} reduction)`, 'green');
    
    log('\n📁 Test Files Location:', 'cyan');
    log(`  S3 Bucket: ${CONFIG.bucket}`, 'reset');
    log(`  Test Prefix: ${CONFIG.testPrefix}`, 'reset');
    
    // Step 7: Cleanup (optional)
    await cleanupTestFiles(results);
    
    log('\n✅ Test completed successfully!', 'green');
    log('✨ All formats (JPEG, WebP, AVIF) were created and verified', 'green');
    log('🔒 No production data was modified', 'green');
    
  } catch (error) {
    log(`\n❌ Test failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testVehicleImageOptimization()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });