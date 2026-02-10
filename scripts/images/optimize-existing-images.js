#!/usr/bin/env node

/**
 * Optimize Existing Images Script
 * 
 * Processes all existing vehicle and experience images using server-side optimization
 * to generate AVIF, WebP, and optimized JPEG variants. Skips images that are already
 * optimized to avoid duplicate processing.
 * 
 * Features:
 * - Server-side processing with Sharp.js (no AWS Lambda required)
 * - Checks for existing optimized variants before processing
 * - Progress tracking and detailed reporting
 * - Batch processing for memory efficiency
 * - Support for both vehicle and experience images
 * - Dry run mode for testing
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

require('dotenv').config({ path: `environments/.env.${process.env.NODE_ENV || 'development'}` });

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const ServerImageOptimizationService = require('../../src/application/services/ServerImageOptimizationService');
const { getEnvironmentRegion } = require('../../src/infrastructure/aws/awsRegionValidator');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY;

// Initialize AWS with validated region
AWS.config.update({
  region: getEnvironmentRegion(),
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

// Configuration
const CONFIG = {
  bucket: process.env.S3_BUCKET,
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 5,
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  onlyVehicles: process.argv.includes('--only-vehicles'),
  onlyExperiences: process.argv.includes('--only-experiences'),
  forceReprocess: process.argv.includes('--force'),
  reportFile: `image-optimization-report-${Date.now()}.json`,
  environment: process.env.NODE_ENV || 'development',
  s3Prefix: process.env.S3_PREFIX || (process.env.NODE_ENV === 'production' ? 'prod/' : 'dev/')
};

// Statistics tracking
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  startTime: Date.now(),
  errors: [],
  vehicleImages: { total: 0, processed: 0, skipped: 0, failed: 0 },
  experienceImages: { total: 0, processed: 0, skipped: 0, failed: 0 }
};

/**
 * Main optimization function
 */
async function optimizeImages() {
  console.log('🎨 Starting image optimization for existing images');
  console.log('Configuration:', {
    ...CONFIG,
    bucket: CONFIG.bucket?.replace(/./g, '*') // Hide bucket name for security
  });
  
  if (CONFIG.dryRun) {
    console.log('⚠️  DRY RUN MODE - No actual processing will be performed');
  }
  
  // Confirm before proceeding in production
  if (!CONFIG.dryRun && CONFIG.environment === 'production') {
    const confirmed = await confirmOptimization();
    if (!confirmed) {
      console.log('Optimization cancelled');
      process.exit(0);
    }
  }
  
  try {
    // Initialize optimization service
    const optimizationService = new ServerImageOptimizationService({
      baseFolder: 'images',
      isPublic: false,
      presignedUrlExpires: 86400
    });
    
    let allImages = [];
    
    // Step 1: Get vehicle images (if not disabled)
    if (!CONFIG.onlyExperiences) {
      console.log('\n📋 Fetching vehicle images...');
      const vehicleImages = await getAllVehicleImages();
      allImages.push(...vehicleImages.map(img => ({ imageRecord: img, type: 'vehicle' })));
      stats.vehicleImages.total = vehicleImages.length;
      console.log(`Found ${vehicleImages.length} vehicle images`);
    }
    
    // Step 2: Get experience images (if not disabled)
    if (!CONFIG.onlyVehicles) {
      console.log('\n📋 Fetching experience images...');
      const experienceImages = await getAllExperienceImages();
      allImages.push(...experienceImages.map(img => ({ imageRecord: img, type: 'experience' })));
      stats.experienceImages.total = experienceImages.length;
      console.log(`Found ${experienceImages.length} experience images`);
    }
    
    stats.total = allImages.length;
    console.log(`\n🎯 Total images to process: ${stats.total}`);
    
    if (stats.total === 0) {
      console.log('No images found to process');
      return;
    }
    
    // Step 3: Process images in batches
    await processImagesInBatches(allImages, optimizationService);
    
    // Step 4: Generate report
    await generateReport();
    
    console.log('\n✅ Image optimization completed successfully');
    
  } catch (error) {
    console.error('❌ Optimization failed:', error);
    stats.errors.push({
      stage: 'main',
      error: error.message,
      stack: error.stack
    });
    await generateReport();
    process.exit(1);
  }
}

/**
 * Get all vehicle images from database
 */
async function getAllVehicleImages() {
  const images = [];
  const query = new Parse.Query('VehicleImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include(['vehicleId']);
  query.limit(1000);
  
  let skip = 0;
  let hasMore = true;
  
  while (hasMore) {
    query.skip(skip);
    const batch = await query.find({ useMasterKey: true });
    
    if (batch.length === 0) {
      hasMore = false;
    } else {
      images.push(...batch);
      skip += batch.length;
      
      if (CONFIG.verbose) {
        console.log(`Fetched ${images.length} vehicle images...`);
      }
    }
  }
  
  return images;
}

/**
 * Get all experience images from database
 */
async function getAllExperienceImages() {
  const images = [];
  const query = new Parse.Query('ExperienceImage');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include(['experienceId']);
  query.limit(1000);
  
  let skip = 0;
  let hasMore = true;
  
  while (hasMore) {
    query.skip(skip);
    const batch = await query.find({ useMasterKey: true });
    
    if (batch.length === 0) {
      hasMore = false;
    } else {
      images.push(...batch);
      skip += batch.length;
      
      if (CONFIG.verbose) {
        console.log(`Fetched ${images.length} experience images...`);
      }
    }
  }
  
  return images;
}

/**
 * Process images in batches to avoid memory issues
 */
async function processImagesInBatches(images, optimizationService) {
  console.log(`\n🔄 Processing ${images.length} images in batches of ${CONFIG.batchSize}`);
  
  for (let i = 0; i < images.length; i += CONFIG.batchSize) {
    const batch = images.slice(i, Math.min(i + CONFIG.batchSize, images.length));
    const batchNumber = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(images.length / CONFIG.batchSize);
    
    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)`);
    
    // Process batch sequentially to avoid overwhelming the system
    for (const image of batch) {
      await processImage(image, optimizationService);
    }
    
    // Progress update
    const progress = Math.round((i + batch.length) / images.length * 100);
    console.log(`📈 Progress: ${progress}% (${i + batch.length}/${images.length})`);
    
    // Small delay between batches
    if (i + batch.length < images.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Process a single image
 */
async function processImage(imageData, optimizationService) {
  const { imageRecord, type } = imageData;
  const typeStats = type === 'vehicle' ? stats.vehicleImages : stats.experienceImages;
  
  try {
    const s3Key = imageRecord.get('s3Key');
    const imageFile = imageRecord.get('imageFile');
    
    if (!s3Key && !imageFile) {
      if (CONFIG.verbose) {
        console.log(`⏭️  Skipping ${type} image ${imageRecord.id} - no S3 key or file`);
      }
      stats.skipped++;
      typeStats.skipped++;
      return;
    }
    
    const sourceKey = s3Key || (imageFile ? imageFile.name() : null);
    if (!sourceKey) {
      if (CONFIG.verbose) {
        console.log(`⏭️  Skipping ${type} image ${imageRecord.id} - could not determine source key`);
      }
      stats.skipped++;
      typeStats.skipped++;
      return;
    }
    
    // Check if already optimized (unless forced)
    if (!CONFIG.forceReprocess) {
      const isOptimized = await checkIfOptimized(sourceKey);
      if (isOptimized) {
        if (CONFIG.verbose) {
          console.log(`⏭️  ${type} image ${imageRecord.id} already optimized`);
        }
        stats.skipped++;
        typeStats.skipped++;
        return;
      }
    }
    
    if (CONFIG.dryRun) {
      console.log(`🔍 [DRY RUN] Would optimize ${type} image ${imageRecord.id}: ${sourceKey}`);
      stats.processed++;
      typeStats.processed++;
      return;
    }
    
    // Download original image from S3
    const imageBuffer = await downloadImageFromS3(sourceKey);
    if (!imageBuffer) {
      throw new Error('Could not download image from S3');
    }
    
    // Determine file info
    const fileName = path.basename(sourceKey);
    const mimeType = getMimeTypeFromExtension(fileName);
    
    // Process with optimization service
    const result = await optimizationService.uploadOptimizedImage(
      imageBuffer,
      fileName,
      mimeType,
      {
        entityId: type === 'vehicle' ? imageRecord.get('vehicleId')?.id : imageRecord.get('experienceId')?.id,
        entityPath: type === 'vehicle' ? 'vehicles' : 'experiences'
      }
    );
    
    if (result.success) {
      // Update database record with optimization metadata
      await updateImageRecord(imageRecord, result, type);
      
      stats.processed++;
      typeStats.processed++;
      
      if (CONFIG.verbose) {
        const formats = Object.keys(result.optimizedVariants).join(', ');
        console.log(`✅ Optimized ${type} image ${imageRecord.id}: ${formats}`);
      }
    } else {
      throw new Error('Optimization service returned failure');
    }
    
  } catch (error) {
    console.error(`❌ Failed to process ${type} image ${imageRecord.id}:`, error.message);
    stats.failed++;
    typeStats.failed++;
    stats.errors.push({
      imageId: imageRecord.id,
      type,
      error: error.message,
      s3Key: imageRecord.get('s3Key') || 'unknown'
    });
  }
}

/**
 * Check if image already has optimized variants
 */
async function checkIfOptimized(s3Key) {
  try {
    // Extract info from S3 key
    const keyParts = s3Key.split('/');
    const fileName = path.basename(s3Key, path.extname(s3Key));
    
    // Construct path for optimized version
    let optimizedKey;
    if (s3Key.includes('vehicles/')) {
      optimizedKey = `${CONFIG.s3Prefix}optimized/avif/vehicles/${fileName}.avif`;
    } else if (s3Key.includes('experiences/')) {
      optimizedKey = `${CONFIG.s3Prefix}optimized/avif/experiences/${fileName}.avif`;
    } else {
      // Fallback - check in generic optimized folder
      optimizedKey = `${CONFIG.s3Prefix}optimized/avif/${fileName}.avif`;
    }
    
    await s3.headObject({
      Bucket: CONFIG.bucket,
      Key: optimizedKey
    }).promise();
    
    return true; // AVIF variant exists
  } catch (error) {
    if (error.code === 'NotFound') {
      return false; // Not optimized yet
    }
    // For other errors, assume not optimized to be safe
    return false;
  }
}

/**
 * Download image from S3
 */
async function downloadImageFromS3(s3Key) {
  try {
    const result = await s3.getObject({
      Bucket: CONFIG.bucket,
      Key: s3Key
    }).promise();
    
    return result.Body;
  } catch (error) {
    if (CONFIG.verbose) {
      console.error(`Failed to download image ${s3Key}:`, error.message);
    }
    return null;
  }
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Update image record with optimization metadata
 */
async function updateImageRecord(imageRecord, optimizationResult, imageType) {
  try {
    // Determine available formats
    let availableFormats = Object.keys(optimizationResult.optimizedVariants);
    
    // If the result contains metadata with fallback flag, it means optimization failed
    // and we only have the original format
    if (optimizationResult.metadata?.fallback) {
      console.warn(`⚠️  Optimization fallback for ${imageType} image ${imageRecord.id} - only original format available`);
      availableFormats = ['original'];
    } else {
      // Ensure we have the expected formats
      // The service should create avif, webp, jpeg, and original
      const expectedFormats = ['avif', 'webp', 'jpeg', 'original'];
      const actualFormats = availableFormats.filter(f => expectedFormats.includes(f));
      
      if (actualFormats.length < expectedFormats.length) {
        console.warn(`⚠️  Missing formats for ${imageType} image ${imageRecord.id}. Expected: ${expectedFormats.join(', ')}, Got: ${actualFormats.join(', ')}`);
      }
      
      // Always include 'original' if not present
      if (!availableFormats.includes('original')) {
        availableFormats.push('original');
      }
    }
    
    // Create optimization metadata
    const metadata = {
      optimized: availableFormats.length > 1, // Only marked as optimized if we have more than just original
      optimizedAt: new Date(),
      availableFormats: availableFormats,
      originalSize: optimizationResult.optimizedVariants.original?.fileSize || 0,
      optimizationVersion: '1.0.0',
      hasAvif: availableFormats.includes('avif'),
      hasWebp: availableFormats.includes('webp'),
      hasJpeg: availableFormats.includes('jpeg')
    };
    
    // Add format-specific metadata
    const formatSizes = {};
    for (const [format, data] of Object.entries(optimizationResult.optimizedVariants)) {
      if (data.fileSize) {
        formatSizes[format] = data.fileSize;
      }
    }
    metadata.formatSizes = formatSizes;
    
    // Update the Parse object
    imageRecord.set('optimizationMetadata', metadata);
    imageRecord.set('optimizedAt', new Date());
    
    await imageRecord.save(null, { useMasterKey: true });
    
  } catch (error) {
    console.error(`Failed to update ${imageType} image record ${imageRecord.id}:`, error.message);
  }
}

/**
 * Generate detailed report
 */
async function generateReport() {
  const duration = Date.now() - stats.startTime;
  const report = {
    ...stats,
    duration,
    durationMinutes: Math.round(duration / 1000 / 60),
    successRate: stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0,
    timestamp: new Date().toISOString(),
    environment: CONFIG.environment,
    config: {
      batchSize: CONFIG.batchSize,
      dryRun: CONFIG.dryRun,
      onlyVehicles: CONFIG.onlyVehicles,
      onlyExperiences: CONFIG.onlyExperiences,
      forceReprocess: CONFIG.forceReprocess
    }
  };
  
  // Save report to file
  const reportPath = path.join(__dirname, CONFIG.reportFile);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  
  // Display summary
  console.log('\n📊 Image Optimization Report:');
  console.log('============================');
  console.log(`Total images: ${report.total}`);
  console.log(`Processed: ${report.processed}`);
  console.log(`Skipped: ${report.skipped}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Success rate: ${report.successRate}%`);
  console.log(`Duration: ${report.durationMinutes} minutes`);
  
  // Vehicle images breakdown
  if (stats.vehicleImages.total > 0) {
    console.log(`\n🚗 Vehicle Images:`);
    console.log(`  Total: ${stats.vehicleImages.total}`);
    console.log(`  Processed: ${stats.vehicleImages.processed}`);
    console.log(`  Skipped: ${stats.vehicleImages.skipped}`);
    console.log(`  Failed: ${stats.vehicleImages.failed}`);
  }
  
  // Experience images breakdown
  if (stats.experienceImages.total > 0) {
    console.log(`\n🎨 Experience Images:`);
    console.log(`  Total: ${stats.experienceImages.total}`);
    console.log(`  Processed: ${stats.experienceImages.processed}`);
    console.log(`  Skipped: ${stats.experienceImages.skipped}`);
    console.log(`  Failed: ${stats.experienceImages.failed}`);
  }
  
  console.log(`\n📄 Report saved to: ${reportPath}`);
  
  if (report.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    report.errors.slice(0, 5).forEach(error => {
      console.log(`  - ${error.type} ${error.imageId}: ${error.error}`);
    });
    
    if (report.errors.length > 5) {
      console.log(`  ... and ${report.errors.length - 5} more errors (see report file)`);
    }
  }
}

/**
 * Confirm optimization in production
 */
async function confirmOptimization() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question('\n⚠️  You are about to optimize PRODUCTION images. Continue? (yes/no): ', answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Display help information
 */
function displayHelp() {
  console.log(`
🎨 Image Optimization Script

Usage: node optimize-existing-images.js [options]

Options:
  --dry-run              Run in dry-run mode (no actual processing)
  --verbose              Enable verbose logging
  --only-vehicles        Process only vehicle images
  --only-experiences     Process only experience images
  --force                Force reprocessing of already optimized images
  --batch-size=N         Set batch size (default: 5)
  --help                 Show this help message

Examples:
  node optimize-existing-images.js --dry-run
  node optimize-existing-images.js --only-vehicles --batch-size=3
  node optimize-existing-images.js --force --verbose
  NODE_ENV=production node optimize-existing-images.js

The script will:
1. Scan for existing vehicle and experience images
2. Check if they already have optimized variants
3. Process unoptimized images using Sharp.js
4. Generate AVIF, WebP, and optimized JPEG variants
5. Update database records with optimization metadata
6. Generate a detailed report

Note: Only images that haven't been optimized will be processed
(unless --force is used).
`);
}

// Run optimization
if (require.main === module) {
  if (process.argv.includes('--help')) {
    displayHelp();
    process.exit(0);
  }
  
  optimizeImages().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { optimizeImages };