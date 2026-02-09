#!/usr/bin/env node

/**
 * Migration Script: Process Existing Images to Optimized Formats
 * 
 * Migrates existing vehicle images to the new multi-format system:
 * - Copies originals to trigger Lambda processing
 * - Updates database records with optimization metadata
 * - Monitors processing status
 * - Generates report
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

require('dotenv').config({ path: `environments/.env.${process.env.NODE_ENV || 'development'}` });

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
Parse.masterKey = process.env.PARSE_MASTER_KEY;

// Initialize AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

// Configuration
const CONFIG = {
  bucket: process.env.S3_BUCKET,
  batchSize: 10,
  maxConcurrent: 5,
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose'),
  reportFile: `migration-report-${Date.now()}.json`,
  environment: process.env.NODE_ENV || 'development'
};

// Migration statistics
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  startTime: Date.now(),
  errors: []
};

/**
 * Main migration function
 */
async function migrate() {
  console.log('🚀 Starting image migration to optimized formats');
  console.log('Configuration:', CONFIG);
  
  if (CONFIG.dryRun) {
    console.log('⚠️  DRY RUN MODE - No actual changes will be made');
  }
  
  // Confirm before proceeding
  if (!CONFIG.dryRun && process.env.NODE_ENV === 'production') {
    const confirmed = await confirmMigration();
    if (!confirmed) {
      console.log('Migration cancelled');
      process.exit(0);
    }
  }
  
  try {
    // Step 1: Get all vehicle images
    const images = await getAllVehicleImages();
    stats.total = images.length;
    console.log(`Found ${stats.total} vehicle images to process`);
    
    // Step 2: Process images in batches
    await processImagesInBatches(images);
    
    // Step 3: Wait for Lambda processing
    if (!CONFIG.dryRun) {
      await waitForProcessing();
    }
    
    // Step 4: Verify and update records
    await verifyAndUpdateRecords(images);
    
    // Step 5: Generate report
    await generateReport();
    
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
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
        console.log(`Fetched ${images.length} images...`);
      }
    }
  }
  
  return images;
}

/**
 * Process images in batches
 */
async function processImagesInBatches(images) {
  console.log(`Processing ${images.length} images in batches of ${CONFIG.batchSize}`);
  
  for (let i = 0; i < images.length; i += CONFIG.batchSize) {
    const batch = images.slice(i, Math.min(i + CONFIG.batchSize, images.length));
    console.log(`Processing batch ${Math.floor(i / CONFIG.batchSize) + 1} (${batch.length} images)`);
    
    await Promise.all(batch.map(image => processImage(image)));
    
    // Progress update
    const progress = Math.round((i + batch.length) / images.length * 100);
    console.log(`Progress: ${progress}% (${i + batch.length}/${images.length})`);
  }
}

/**
 * Process a single image
 */
async function processImage(imageRecord) {
  try {
    const s3Key = imageRecord.get('s3Key');
    const imageFile = imageRecord.get('imageFile');
    
    if (!s3Key && !imageFile) {
      console.warn(`Skipping image ${imageRecord.id} - no S3 key or file`);
      stats.skipped++;
      return;
    }
    
    const sourceKey = s3Key || (imageFile ? imageFile.name() : null);
    if (!sourceKey) {
      console.warn(`Skipping image ${imageRecord.id} - could not determine source key`);
      stats.skipped++;
      return;
    }
    
    // Check if already optimized
    const isOptimized = await checkIfOptimized(sourceKey);
    if (isOptimized) {
      if (CONFIG.verbose) {
        console.log(`Image ${imageRecord.id} already optimized`);
      }
      stats.skipped++;
      return;
    }
    
    // Copy to originals folder to trigger Lambda
    if (!CONFIG.dryRun) {
      await triggerOptimization(sourceKey, imageRecord);
    }
    
    stats.processed++;
    
    if (CONFIG.verbose) {
      console.log(`Triggered optimization for image ${imageRecord.id}`);
    }
  } catch (error) {
    console.error(`Failed to process image ${imageRecord.id}:`, error.message);
    stats.failed++;
    stats.errors.push({
      imageId: imageRecord.id,
      error: error.message
    });
  }
}

/**
 * Check if image is already optimized
 */
async function checkIfOptimized(s3Key) {
  try {
    // Check if optimized versions exist
    const env = s3Key.split('/')[0];
    const fileName = path.basename(s3Key, path.extname(s3Key));
    
    const optimizedKey = `${env}/optimized/webp/vehicles/${fileName}.webp`;
    
    await s3.headObject({
      Bucket: CONFIG.bucket,
      Key: optimizedKey
    }).promise();
    
    return true; // Optimized version exists
  } catch (error) {
    return false; // Optimized version doesn't exist
  }
}

/**
 * Trigger optimization by copying to originals folder
 */
async function triggerOptimization(sourceKey, imageRecord) {
  const env = CONFIG.environment === 'production' ? 'prod' : 'dev';
  const vehicleId = imageRecord.get('vehicleId')?.id || 'unknown';
  const fileName = path.basename(sourceKey);
  const destinationKey = `${env}/vehicles/originals/${vehicleId}/${fileName}`;
  
  // Copy to originals folder
  await s3.copyObject({
    Bucket: CONFIG.bucket,
    CopySource: `${CONFIG.bucket}/${sourceKey}`,
    Key: destinationKey,
    Metadata: {
      originalKey: sourceKey,
      imageId: imageRecord.id,
      triggeredBy: 'migration',
      timestamp: new Date().toISOString()
    },
    MetadataDirective: 'REPLACE'
  }).promise();
  
  // Create optimization record
  const OptimizationRecord = Parse.Object.extend('ImageOptimization');
  const record = new OptimizationRecord();
  
  record.set('originalS3Key', destinationKey);
  record.set('sourceS3Key', sourceKey);
  record.set('imageId', imageRecord.id);
  record.set('vehicleId', vehicleId);
  record.set('status', 'pending');
  record.set('triggeredAt', new Date());
  record.set('migration', true);
  
  await record.save(null, { useMasterKey: true });
}

/**
 * Wait for Lambda processing to complete
 */
async function waitForProcessing() {
  console.log('⏳ Waiting for Lambda processing to complete...');
  console.log('This may take several minutes depending on the number of images');
  
  const checkInterval = 30000; // 30 seconds
  const maxWaitTime = 30 * 60 * 1000; // 30 minutes
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const query = new Parse.Query('ImageOptimization');
    query.equalTo('migration', true);
    query.equalTo('status', 'pending');
    
    const pendingCount = await query.count({ useMasterKey: true });
    
    if (pendingCount === 0) {
      console.log('✅ All images processed');
      break;
    }
    
    console.log(`${pendingCount} images still processing...`);
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
}

/**
 * Verify optimization and update records
 */
async function verifyAndUpdateRecords(images) {
  console.log('Verifying optimization and updating records...');
  
  for (const image of images) {
    try {
      const query = new Parse.Query('ImageOptimization');
      query.equalTo('imageId', image.id);
      const optimizationRecord = await query.first({ useMasterKey: true });
      
      if (optimizationRecord && optimizationRecord.get('status') === 'completed') {
        // Update vehicle image record with optimization data
        image.set('optimized', true);
        image.set('optimizationId', optimizationRecord.id);
        image.set('formats', optimizationRecord.get('formats'));
        await image.save(null, { useMasterKey: true });
        
        if (CONFIG.verbose) {
          console.log(`Updated image ${image.id} with optimization data`);
        }
      }
    } catch (error) {
      console.error(`Failed to verify image ${image.id}:`, error.message);
    }
  }
}

/**
 * Generate migration report
 */
async function generateReport() {
  const duration = Date.now() - stats.startTime;
  const report = {
    ...stats,
    duration: duration,
    durationMinutes: Math.round(duration / 1000 / 60),
    successRate: stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0,
    timestamp: new Date().toISOString(),
    environment: CONFIG.environment
  };
  
  // Save report to file
  const reportPath = path.join(__dirname, CONFIG.reportFile);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n📊 Migration Report:');
  console.log('==================');
  console.log(`Total images: ${report.total}`);
  console.log(`Processed: ${report.processed}`);
  console.log(`Skipped: ${report.skipped}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Success rate: ${report.successRate}%`);
  console.log(`Duration: ${report.durationMinutes} minutes`);
  console.log(`Report saved to: ${reportPath}`);
  
  if (report.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    report.errors.slice(0, 10).forEach(error => {
      console.log(`  - ${error.imageId || 'General'}: ${error.error}`);
    });
    
    if (report.errors.length > 10) {
      console.log(`  ... and ${report.errors.length - 10} more errors (see report file)`);
    }
  }
}

/**
 * Confirm migration in production
 */
async function confirmMigration() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question('\n⚠️  You are about to migrate PRODUCTION images. Continue? (yes/no): ', answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

// Run migration
if (require.main === module) {
  migrate().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { migrate };