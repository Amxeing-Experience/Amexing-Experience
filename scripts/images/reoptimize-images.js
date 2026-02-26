#!/usr/bin/env node

/**
 * Re-optimize existing images with proper format generation
 * This script directly creates AVIF, WebP, and JPEG variants using Sharp
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../environments/.env.' + (process.env.NODE_ENV || 'development')) });
const Parse = require('parse/node');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const path = require('path');
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

// Configuration
const CONFIG = {
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '3'),
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  limit: parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '1000'),
};

// Quality settings for optimization
const QUALITY_SETTINGS = {
  avif: { quality: 80, effort: 4 },
  webp: { quality: 85 },
  jpeg: { quality: 90, mozjpeg: true }
};

// Stats tracking
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  errors: []
};

/**
 * Download image from S3
 */
async function downloadFromS3(key) {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key
    };
    
    const data = await s3.getObject(params).promise();
    return data.Body;
  } catch (error) {
    console.error(`Failed to download ${key}:`, error.message);
    return null;
  }
}

/**
 * Upload buffer to S3
 */
async function uploadToS3(buffer, key, contentType) {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
      Metadata: {
        'optimized-by': 'reoptimize-script',
        'optimized-at': new Date().toISOString()
      }
    };
    
    await s3.putObject(params).promise();
    return true;
  } catch (error) {
    console.error(`Failed to upload ${key}:`, error.message);
    return false;
  }
}

/**
 * Create optimized variants using Sharp
 */
async function createOptimizedVariants(buffer, originalKey) {
  const variants = {};
  
  // Parse the original key to get base path
  const keyParts = originalKey.split('/');
  const filename = keyParts[keyParts.length - 1];
  const basePath = keyParts.slice(0, -1).join('/');
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
  const optimizedPath = `${basePath}/optimized`;
  
  try {
    // Create AVIF variant
    if (CONFIG.verbose) console.log('  Creating AVIF variant...');
    const avifBuffer = await sharp(buffer)
      .avif(QUALITY_SETTINGS.avif)
      .toBuffer();
    
    const avifKey = `${optimizedPath}/${nameWithoutExt}.avif`;
    if (!CONFIG.dryRun) {
      const uploaded = await uploadToS3(avifBuffer, avifKey, 'image/avif');
      if (uploaded) {
        variants.avif = {
          s3Key: avifKey,
          fileSize: avifBuffer.length
        };
      }
    } else {
      variants.avif = { s3Key: avifKey, fileSize: avifBuffer.length };
    }
  } catch (error) {
    console.warn('  Failed to create AVIF:', error.message);
  }
  
  try {
    // Create WebP variant
    if (CONFIG.verbose) console.log('  Creating WebP variant...');
    const webpBuffer = await sharp(buffer)
      .webp(QUALITY_SETTINGS.webp)
      .toBuffer();
    
    const webpKey = `${optimizedPath}/${nameWithoutExt}.webp`;
    if (!CONFIG.dryRun) {
      const uploaded = await uploadToS3(webpBuffer, webpKey, 'image/webp');
      if (uploaded) {
        variants.webp = {
          s3Key: webpKey,
          fileSize: webpBuffer.length
        };
      }
    } else {
      variants.webp = { s3Key: webpKey, fileSize: webpBuffer.length };
    }
  } catch (error) {
    console.warn('  Failed to create WebP:', error.message);
  }
  
  try {
    // Create optimized JPEG variant
    if (CONFIG.verbose) console.log('  Creating optimized JPEG variant...');
    const jpegBuffer = await sharp(buffer)
      .jpeg(QUALITY_SETTINGS.jpeg)
      .toBuffer();
    
    const jpegKey = `${optimizedPath}/${nameWithoutExt}.jpg`;
    if (!CONFIG.dryRun) {
      const uploaded = await uploadToS3(jpegBuffer, jpegKey, 'image/jpeg');
      if (uploaded) {
        variants.jpeg = {
          s3Key: jpegKey,
          fileSize: jpegBuffer.length
        };
      }
    } else {
      variants.jpeg = { s3Key: jpegKey, fileSize: jpegBuffer.length };
    }
  } catch (error) {
    console.warn('  Failed to create JPEG:', error.message);
  }
  
  // Original is always available
  variants.original = {
    s3Key: originalKey,
    fileSize: buffer.length
  };
  
  return variants;
}

/**
 * Process a single image
 */
async function processImage(image, type) {
  const s3Key = image.get('s3Key');
  const fileName = image.get('fileName');
  
  if (!s3Key) {
    console.log(`⏭️  Skipping ${type} image ${image.id} - no S3 key`);
    stats.skipped++;
    return;
  }
  
  console.log(`\n📸 Processing ${type} image: ${fileName || s3Key}`);
  
  if (CONFIG.dryRun) {
    console.log(`  [DRY RUN] Would process: ${s3Key}`);
    stats.processed++;
    return;
  }
  
  try {
    // Download original image
    if (CONFIG.verbose) console.log('  Downloading from S3...');
    const buffer = await downloadFromS3(s3Key);
    
    if (!buffer) {
      throw new Error('Failed to download image from S3');
    }
    
    // Create optimized variants
    const variants = await createOptimizedVariants(buffer, s3Key);
    
    // Update database with new metadata
    const availableFormats = Object.keys(variants);
    const metadata = {
      optimized: availableFormats.length > 1,
      optimizedAt: new Date(),
      availableFormats: availableFormats,
      hasAvif: availableFormats.includes('avif'),
      hasWebp: availableFormats.includes('webp'),
      hasJpeg: availableFormats.includes('jpeg'),
      formatSizes: {},
      optimizationVersion: '2.0.0',
      optimizedBy: 'reoptimize-script'
    };
    
    // Add size information
    for (const [format, data] of Object.entries(variants)) {
      if (data.fileSize) {
        metadata.formatSizes[format] = data.fileSize;
      }
    }
    
    // Update the image record
    image.set('optimizationMetadata', metadata);
    image.set('optimizedVariants', variants);
    await image.save(null, { useMasterKey: true });
    
    console.log(`  ✅ Successfully created formats: ${availableFormats.join(', ')}`);
    stats.processed++;
    
  } catch (error) {
    console.error(`  ❌ Failed to process: ${error.message}`);
    stats.failed++;
    stats.errors.push({
      imageId: image.id,
      type,
      error: error.message,
      s3Key
    });
  }
}

/**
 * Process vehicle images
 */
async function processVehicleImages() {
  console.log('\n🚗 Processing Vehicle Images...');
  
  const query = new Parse.Query('VehicleImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(CONFIG.limit);
  
  const images = await query.find({ useMasterKey: true });
  console.log(`Found ${images.length} vehicle images`);
  
  stats.total += images.length;
  
  for (let i = 0; i < images.length; i += CONFIG.batchSize) {
    const batch = images.slice(i, Math.min(i + CONFIG.batchSize, images.length));
    const batchNumber = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(images.length / CONFIG.batchSize);
    
    console.log(`\n📦 Batch ${batchNumber}/${totalBatches}`);
    
    for (const image of batch) {
      await processImage(image, 'vehicle');
    }
    
    // Small delay between batches
    if (i + batch.length < images.length && !CONFIG.dryRun) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Process experience images
 */
async function processExperienceImages() {
  console.log('\n🎨 Processing Experience Images...');
  
  const query = new Parse.Query('ExperienceImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.limit(CONFIG.limit);
  
  const images = await query.find({ useMasterKey: true });
  console.log(`Found ${images.length} experience images`);
  
  stats.total += images.length;
  
  for (let i = 0; i < images.length; i += CONFIG.batchSize) {
    const batch = images.slice(i, Math.min(i + CONFIG.batchSize, images.length));
    const batchNumber = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(images.length / CONFIG.batchSize);
    
    console.log(`\n📦 Batch ${batchNumber}/${totalBatches}`);
    
    for (const image of batch) {
      await processImage(image, 'experience');
    }
    
    // Small delay between batches
    if (i + batch.length < images.length && !CONFIG.dryRun) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 Image Re-optimization Script');
  console.log('================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`S3 Bucket: ${BUCKET_NAME}`);
  console.log(`S3 Prefix: ${PREFIX}`);
  console.log(`Batch Size: ${CONFIG.batchSize}`);
  console.log(`Dry Run: ${CONFIG.dryRun}`);
  console.log(`Limit: ${CONFIG.limit}`);
  console.log('');
  
  if (process.argv.includes('--help')) {
    console.log('Usage: node reoptimize-images.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --batch-size=N    Process N images at a time (default: 3)');
    console.log('  --dry-run         Preview what would be done without making changes');
    console.log('  --verbose         Show detailed progress');
    console.log('  --limit=N         Process maximum N images per type (default: 1000)');
    console.log('  --help            Show this help message');
    process.exit(0);
  }
  
  const startTime = Date.now();
  
  try {
    // Check if Sharp is properly installed
    const sharpInfo = sharp.versions;
    console.log(`Sharp version: ${sharpInfo.sharp}`);
    console.log(`libvips version: ${sharpInfo.vips}`);
    console.log('');
    
    await processVehicleImages();
    await processExperienceImages();
    
    const duration = Date.now() - startTime;
    const minutes = Math.round(duration / 60000);
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Final Report');
    console.log('='.repeat(50));
    console.log(`Total images: ${stats.total}`);
    console.log(`Processed: ${stats.processed}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Success rate: ${stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0}%`);
    console.log(`Duration: ${minutes} minutes`);
    
    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.forEach(err => {
        console.log(`  - ${err.type} ${err.imageId}: ${err.error}`);
      });
    }
    
    console.log('\n✅ Re-optimization completed!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { processImage };