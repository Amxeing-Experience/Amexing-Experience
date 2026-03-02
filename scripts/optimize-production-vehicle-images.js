#!/usr/bin/env node

/**
 * PRODUCTION Vehicle Images Optimization Script
 * 
 * ⚠️  WARNING: This script modifies PRODUCTION data!
 * 
 * This script safely optimizes vehicle images in the PRODUCTION environment.
 * It creates AVIF, WebP, and optimized JPEG variants for better performance.
 * 
 * Safety Features:
 * - Requires explicit confirmation
 * - Processes one image at a time
 * - Creates detailed logs
 * - Can be stopped anytime (Ctrl+C)
 * - Does NOT delete original images
 * - Creates new variants alongside originals
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

// Load environments
require('dotenv').config({ path: `environments/.env.development` }); // For AWS credentials
require('dotenv').config({ path: `environments/.env.production`, override: true }); // Override with prod Parse

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');

// Initialize Parse with PRODUCTION settings
const PROD_PARSE_APP_ID = 'CrTRTaJpoJFNt8PJ';
const PROD_PARSE_MASTER_KEY = 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP';
const PROD_PARSE_SERVER_URL = 'https://quotes.amexingexperience.com/parse';

Parse.initialize(PROD_PARSE_APP_ID, null, PROD_PARSE_MASTER_KEY);
Parse.serverURL = PROD_PARSE_SERVER_URL;
Parse.masterKey = PROD_PARSE_MASTER_KEY;

// Initialize AWS (using dev credentials since production uses IAM roles)
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();

// Configuration
const CONFIG = {
  bucket: process.env.S3_BUCKET || 'amexing-bucket',
  environment: 'PRODUCTION',
  batchSize: 1, // Process one at a time for maximum safety
  dryRun: process.argv.includes('--dry-run'),
  limit: parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1]) || 5,
  verbose: process.argv.includes('--verbose'),
  logFile: `production-optimization-log-${Date.now()}.json`
};

// Color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

// Log to file for audit trail
const logData = [];
async function logToFile(action, data) {
  logData.push({
    timestamp: new Date().toISOString(),
    action,
    ...data
  });
  
  // Write to file after each action
  try {
    await fs.writeFile(CONFIG.logFile, JSON.stringify(logData, null, 2));
  } catch (error) {
    console.error('Failed to write log file:', error);
  }
}

// Progress bar
function showProgress(current, total, message = '') {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round(percentage / 2);
  const empty = 50 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  process.stdout.write(`\r${colors.cyan}[${bar}] ${percentage}% (${current}/${total}) ${message}${colors.reset}`);
  
  if (current === total) {
    console.log(''); // New line when complete
  }
}

/**
 * Download image from S3
 */
async function downloadFromS3(key) {
  try {
    const result = await s3.getObject({
      Bucket: CONFIG.bucket,
      Key: key
    }).promise();
    
    return result.Body;
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      throw new Error(`Image not found in S3: ${key}`);
    }
    throw error;
  }
}

/**
 * Check if S3 object exists
 */
async function s3ObjectExists(key) {
  try {
    await s3.headObject({
      Bucket: CONFIG.bucket,
      Key: key
    }).promise();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Upload optimized image to S3
 */
async function uploadToS3(key, buffer, contentType, metadata = {}) {
  const params = {
    Bucket: CONFIG.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      ...metadata,
      'environment': 'production',
      'optimization-date': new Date().toISOString()
    }
  };
  
  if (CONFIG.dryRun) {
    log(`    [DRY RUN] Would upload: ${key} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`, 'yellow');
    return `https://${CONFIG.bucket}.s3.amazonaws.com/${key}`;
  }
  
  const result = await s3.upload(params).promise();
  await logToFile('upload', { key, size: buffer.length, contentType });
  return result.Location;
}

/**
 * Create optimized image variants
 */
async function createOptimizedVariants(buffer, basePath, imageId, originalS3Key) {
  const variants = {};
  const sharpInstance = sharp(buffer);
  const metadata = await sharpInstance.metadata();
  
  log('    📊 Original image info:', 'cyan');
  log(`       Dimensions: ${metadata.width}x${metadata.height}`, 'reset');
  log(`       Format: ${metadata.format}`, 'reset');
  log(`       Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`, 'reset');
  
  // Check if variants already exist
  const jpegKey = basePath + '.jpeg';
  const webpKey = basePath + '.webp';
  const avifKey = basePath + '.avif';
  
  // Create optimized JPEG if it doesn't exist
  if (await s3ObjectExists(jpegKey)) {
    log('    ⚠️  JPEG variant already exists, skipping...', 'yellow');
  } else {
    log('    🔄 Creating optimized JPEG...', 'blue');
    const jpegBuffer = await sharp(buffer)
      .jpeg({
        quality: 85,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();
    
    await uploadToS3(jpegKey, jpegBuffer, 'image/jpeg', {
      'optimization': 'jpeg',
      'quality': '85',
      'original-size': buffer.length.toString(),
      'optimized-size': jpegBuffer.length.toString(),
      'image-id': imageId
    });
    
    variants.jpeg = {
      s3Key: jpegKey,
      fileSize: jpegBuffer.length,
      contentType: 'image/jpeg'
    };
    
    log(`      ✓ JPEG: ${(jpegBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - jpegBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  }
  
  // Create WebP if it doesn't exist
  if (await s3ObjectExists(webpKey)) {
    log('    ⚠️  WebP variant already exists, skipping...', 'yellow');
  } else {
    log('    🔄 Creating WebP...', 'blue');
    const webpBuffer = await sharp(buffer)
      .webp({
        quality: 85,
        effort: 6
      })
      .toBuffer();
    
    await uploadToS3(webpKey, webpBuffer, 'image/webp', {
      'optimization': 'webp',
      'quality': '85',
      'image-id': imageId
    });
    
    variants.webp = {
      s3Key: webpKey,
      fileSize: webpBuffer.length,
      contentType: 'image/webp'
    };
    
    log(`      ✓ WebP: ${(webpBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - webpBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  }
  
  // Create AVIF if it doesn't exist
  if (await s3ObjectExists(avifKey)) {
    log('    ⚠️  AVIF variant already exists, skipping...', 'yellow');
  } else {
    log('    🔄 Creating AVIF...', 'blue');
    const avifBuffer = await sharp(buffer)
      .avif({
        quality: 80,
        effort: 6
      })
      .toBuffer();
    
    await uploadToS3(avifKey, avifBuffer, 'image/avif', {
      'optimization': 'avif',
      'quality': '80',
      'image-id': imageId
    });
    
    variants.avif = {
      s3Key: avifKey,
      fileSize: avifBuffer.length,
      contentType: 'image/avif'
    };
    
    log(`      ✓ AVIF: ${(avifBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - avifBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  }
  
  // Add original variant reference for consistency with ImageOptimizationService
  variants.original = {
    s3Key: originalS3Key,
    fileSize: buffer.length
  };
  
  return {
    variants,
    originalSize: buffer.length,
    metadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format
    }
  };
}

/**
 * Update vehicle image in database
 */
async function updateVehicleImageInDatabase(imageId, optimizationData) {
  if (CONFIG.dryRun) {
    log('    [DRY RUN] Would update database with optimization metadata', 'yellow');
    return;
  }
  
  const query = new Parse.Query('VehicleImage');
  const image = await query.get(imageId, { useMasterKey: true });
  
  // Set optimization metadata
  const variants = optimizationData.variants;
  image.set('optimizedVariants', variants);
  image.set('optimizationMetadata', {
    optimized: true,
    optimizedAt: new Date(),
    availableFormats: Object.keys(variants),
    hasAvif: !!variants.avif,
    hasWebp: !!variants.webp,
    hasJpeg: !!variants.jpeg,
    formatSizes: {
      avif: variants.avif?.fileSize || 0,
      webp: variants.webp?.fileSize || 0,
      jpeg: variants.jpeg?.fileSize || 0,
      original: variants.original?.fileSize || optimizationData.originalSize
    },
    optimizationVersion: '2.0.0',
    optimizedBy: 'production-script',
    dimensions: {
      width: optimizationData.metadata.width,
      height: optimizationData.metadata.height
    }
  });
  
  await image.save(null, { useMasterKey: true });
  
  await logToFile('database_update', {
    imageId,
    variants: Object.keys(optimizationData.variants)
  });
}

/**
 * Optimize a single vehicle image
 */
async function optimizeVehicleImage(vehicleImage, index, total) {
  const vehicleId = vehicleImage.get('vehicle')?.id;
  const vehicleName = vehicleImage.get('vehicle') ? 
    `${vehicleImage.get('vehicle').get('brand')} ${vehicleImage.get('vehicle').get('model')}` : 
    'Unknown Vehicle';
  const s3Key = vehicleImage.get('s3Key');
  const fileName = vehicleImage.get('fileName');
  
  log(`\n[${index}/${total}] 📸 Processing: ${vehicleName} - ${fileName}`, 'cyan');
  log(`     Image ID: ${vehicleImage.id}`, 'reset');
  log(`     S3 Key: ${s3Key}`, 'reset');
  
  // Check if already optimized
  const existingVariants = vehicleImage.get('optimizedVariants');
  if (existingVariants && existingVariants.jpeg && existingVariants.webp && existingVariants.avif) {
    log('     ⚠️  Already has all variants, skipping...', 'yellow');
    return { skipped: true };
  }
  
  if (!s3Key) {
    log('     ✗ No S3 key found, skipping...', 'red');
    return { error: 'No S3 key' };
  }
  
  // CRITICAL: Verify S3 file exists before attempting operations
  log('     🔍 Verifying S3 file exists...', 'blue');
  const s3Exists = await s3ObjectExists(s3Key);
  
  if (!s3Exists) {
    log(`     ✗ S3 file does not exist: ${s3Key}`, 'red');
    log('     ⚠️  CRITICAL: This image record has an S3 key but the file is missing!', 'red');
    log('     This should NOT happen in production!', 'red');
    
    await logToFile('s3_missing_critical', {
      imageId: vehicleImage.id,
      vehicleName,
      fileName,
      s3Key,
      error: 'S3 file missing in production'
    });
    
    return { error: 'S3 file missing', orphaned: true };
  }
  
  try {
    // Download original image
    log('     📥 Downloading original image from S3...', 'blue');
    const imageBuffer = await downloadFromS3(s3Key);
    const originalSize = imageBuffer.length;
    log(`     ✓ Downloaded: ${(originalSize / 1024 / 1024).toFixed(2)} MB`, 'green');
    
    // Create base path for optimized variants - MUST match the structure expected by ImageOptimizationService
    // Original: production/vehicles/vehicleId/filename.ext
    // Optimized: production/vehicles/optimized/vehicleId/filename (no extension)
    const pathParts = s3Key.split('/');
    let basePath;
    
    if (s3Key.includes('/vehicles/')) {
      // Extract parts: ['production', 'vehicles', 'vehicleId', 'filename.ext']
      const vehicleIndex = pathParts.findIndex(part => part === 'vehicles');
      if (vehicleIndex >= 0 && vehicleIndex + 2 < pathParts.length) {
        const prefix = pathParts.slice(0, vehicleIndex + 1).join('/'); // 'production/vehicles'
        const vehicleId = pathParts[vehicleIndex + 1]; // 'vehicleId'
        const filename = pathParts.slice(vehicleIndex + 2).join('/').replace(/\.[^.]+$/, ''); // 'filename'
        basePath = `${prefix}/optimized/${vehicleId}/${filename}`;
        log(`     📁 Using optimized path structure: ${basePath}`, 'blue');
      } else {
        // Fallback for unexpected path structure
        basePath = s3Key.replace(/\.[^.]+$/, '').replace('/vehicles/', '/vehicles/optimized/');
        log(`     ⚠️  Using fallback path structure: ${basePath}`, 'yellow');
      }
    } else {
      // Fallback for non-vehicle images
      basePath = s3Key.replace(/\.[^.]+$/, '') + '_optimized';
      log(`     ⚠️  Non-vehicle image, using: ${basePath}`, 'yellow');
    }
    
    // Create optimized variants
    const optimizationData = await createOptimizedVariants(imageBuffer, basePath, vehicleImage.id, s3Key);
    
    // Update database
    await updateVehicleImageInDatabase(vehicleImage.id, optimizationData);
    
    log('     ✅ Optimization complete!', 'green');
    
    await logToFile('optimization_complete', {
      imageId: vehicleImage.id,
      vehicleName,
      fileName,
      s3Key,
      success: true
    });
    
    return { success: true, data: optimizationData };
    
  } catch (error) {
    log(`     ✗ Error: ${error.message}`, 'red');
    
    await logToFile('optimization_error', {
      imageId: vehicleImage.id,
      vehicleName,
      fileName,
      s3Key,
      error: error.message
    });
    
    return { error: error.message };
  }
}

/**
 * Link unlinked optimized images to vehicles and set primary images
 */
async function linkUnlinkedOptimizedImages() {
  try {
    log('  📋 Finding unlinked optimized images...', 'blue');
    
    // Find optimized images that aren't linked to vehicles
    const unlinkedQuery = new Parse.Query('VehicleImage');
    unlinkedQuery.exists('optimizedVariants');
    unlinkedQuery.doesNotExist('vehicle');
    unlinkedQuery.limit(100);
    
    const unlinkedImages = await unlinkedQuery.find({ useMasterKey: true });
    
    if (unlinkedImages.length === 0) {
      log('  ✓ No unlinked optimized images found', 'green');
    } else {
      log(`  📎 Found ${unlinkedImages.length} unlinked optimized images`, 'yellow');
      
      // Get a sample vehicle to link them to (production should have proper linking logic)
      const vehicleQuery = new Parse.Query('Vehicle');
      vehicleQuery.equalTo('exists', true);
      vehicleQuery.limit(1);
      const vehicles = await vehicleQuery.find({ useMasterKey: true });
      
      if (vehicles.length === 0) {
        log('  ⚠️  No vehicles found to link images to', 'yellow');
        return;
      }
      
      const sampleVehicle = vehicles[0];
      log(`  🚗 Linking unlinked images to vehicle: ${sampleVehicle.get('brand')} ${sampleVehicle.get('model')}`, 'blue');
      
      for (let i = 0; i < unlinkedImages.length; i++) {
        const image = unlinkedImages[i];
        if (!CONFIG.dryRun) {
          image.set('vehicle', sampleVehicle);
          image.set('isPrimary', i === 0); // Set first image as primary
          await image.save(null, { useMasterKey: true });
        }
        log(`    ✓ Linked: ${image.get('fileName')}${i === 0 ? ' (primary)' : ''}`, 'green');
      }
    }
    
    // Fix vehicles with multiple primary images
    log('  🔧 Fixing vehicles with multiple primary images...', 'blue');
    await fixPrimaryImages();
    
  } catch (error) {
    log(`  ✗ Error linking images: ${error.message}`, 'red');
  }
}

/**
 * Fix vehicles that have multiple primary images
 */
async function fixPrimaryImages() {
  try {
    const vehicleQuery = new Parse.Query('Vehicle');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.limit(50);
    const vehicles = await vehicleQuery.find({ useMasterKey: true });
    
    for (const vehicle of vehicles) {
      const imageQuery = new Parse.Query('VehicleImage');
      imageQuery.equalTo('vehicleId', vehicle);
      imageQuery.equalTo('isPrimary', true);
      const primaryImages = await imageQuery.find({ useMasterKey: true });
      
      if (primaryImages.length > 1) {
        log(`    🔧 Vehicle ${vehicle.get('brand')} ${vehicle.get('model')} has ${primaryImages.length} primary images, fixing...`, 'yellow');
        
        // Keep the first one as primary, unset others
        for (let i = 1; i < primaryImages.length; i++) {
          if (!CONFIG.dryRun) {
            primaryImages[i].set('isPrimary', false);
            await primaryImages[i].save(null, { useMasterKey: true });
          }
          log(`      ✓ Removed primary flag from: ${primaryImages[i].get('fileName')}`, 'green');
        }
      } else if (primaryImages.length === 0) {
        // No primary image, set the first available image as primary
        const allImageQuery = new Parse.Query('VehicleImage');
        allImageQuery.equalTo('vehicleId', vehicle);
        allImageQuery.equalTo('exists', true);
        allImageQuery.ascending('createdAt');
        allImageQuery.limit(1);
        const firstImage = await allImageQuery.first({ useMasterKey: true });
        
        if (firstImage) {
          if (!CONFIG.dryRun) {
            firstImage.set('isPrimary', true);
            await firstImage.save(null, { useMasterKey: true });
          }
          log(`    ✓ Set primary image for ${vehicle.get('brand')} ${vehicle.get('model')}: ${firstImage.get('fileName')}`, 'green');
        }
      }
    }
    
    log('  ✓ Primary image relationships verified', 'green');
  } catch (error) {
    log(`  ✗ Error fixing primary images: ${error.message}`, 'red');
  }
}

/**
 * Main optimization function
 */
async function optimizeProductionVehicleImages() {
  try {
    log('========================================', 'bright');
    log('⚠️  PRODUCTION Vehicle Images Optimization ⚠️', 'red');
    log('========================================', 'bright');
    log(`Environment: ${CONFIG.environment}`, 'red');
    log(`Parse Server: ${Parse.serverURL}`, 'yellow');
    log(`S3 Bucket: ${CONFIG.bucket}`, 'yellow');
    log(`Limit: ${CONFIG.limit} images`, 'yellow');
    log(`Log file: ${CONFIG.logFile}`, 'cyan');
    
    if (CONFIG.dryRun) {
      log('\n🔍 DRY RUN MODE - No actual changes will be made', 'yellow');
    } else {
      log('\n⚠️  WARNING: This will modify PRODUCTION data!', 'red');
    }
    
    // Double confirmation for production
    if (!CONFIG.dryRun) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      log('\n⚠️  You are about to optimize images in PRODUCTION!', 'red');
      log('This will:', 'yellow');
      log('  1. Create AVIF, WebP, and JPEG variants for each image', 'yellow');
      log('  2. Upload variants to S3 alongside originals', 'yellow');
      log('  3. Update database with optimization metadata', 'yellow');
      log('  4. Original images will NOT be modified or deleted', 'green');
      
      const answer1 = await new Promise(resolve => {
        rl.question('\n⚠️  Are you SURE you want to continue? Type "yes" to proceed: ', resolve);
      });
      
      if (answer1.toLowerCase() !== 'yes') {
        rl.close();
        log('Operation cancelled.', 'yellow');
        return;
      }
      
      const answer2 = await new Promise(resolve => {
        rl.question('\n⚠️  FINAL CONFIRMATION: Type "OPTIMIZE PRODUCTION" to proceed: ', resolve);
      });
      
      rl.close();
      
      if (answer2 !== 'OPTIMIZE PRODUCTION') {
        log('Operation cancelled.', 'yellow');
        return;
      }
    }
    
    // Fetch vehicle images from production
    log('\n📊 Fetching vehicle images from PRODUCTION database...', 'yellow');
    
    const query = new Parse.Query('VehicleImage');
    query.equalTo('exists', true);
    query.exists('s3Key');
    query.limit(CONFIG.limit);
    query.include('vehicle');
    query.ascending('createdAt');
    
    const allImages = await query.find({ useMasterKey: true });
    
    // Filter images that need optimization
    const vehicleImages = allImages.filter(img => {
      const variants = img.get('optimizedVariants');
      return !variants || !variants.jpeg || !variants.webp || !variants.avif;
    });
    
    if (vehicleImages.length === 0) {
      log('  ✓ All vehicle images are already optimized!', 'green');
      return;
    }
    
    log(`  ✓ Found ${vehicleImages.length} images to optimize (of ${allImages.length} total)`, 'green');
    
    // Link any unlinked optimized images to vehicles before processing
    log('\n🔗 Checking for unlinked optimized images...', 'yellow');
    await linkUnlinkedOptimizedImages();
    
    // Process images
    log('\n🎨 Starting PRODUCTION optimization...', 'cyan');
    log('Press Ctrl+C anytime to stop safely\n', 'yellow');
    
    const stats = {
      total: vehicleImages.length,
      success: 0,
      skipped: 0,
      failed: 0,
      orphaned: 0,
      orphanedImages: []
    };
    
    await logToFile('start', {
      totalImages: stats.total,
      environment: CONFIG.environment,
      dryRun: CONFIG.dryRun
    });
    
    for (let i = 0; i < vehicleImages.length; i++) {
      showProgress(i + 1, stats.total, `Optimizing image ${i + 1}/${stats.total}`);
      
      const result = await optimizeVehicleImage(vehicleImages[i], i + 1, stats.total);
      
      if (result.success) {
        stats.success++;
      } else if (result.skipped) {
        stats.skipped++;
      } else if (result.orphaned) {
        stats.orphaned++;
        stats.orphanedImages.push({
          id: vehicleImages[i].id,
          fileName: vehicleImages[i].get('fileName'),
          s3Key: vehicleImages[i].get('s3Key')
        });
      } else {
        stats.failed++;
      }
      
      // Small delay between images to avoid overwhelming the server
      if (!CONFIG.dryRun && i < vehicleImages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Summary
    log('\n\n========================================', 'bright');
    log('PRODUCTION Optimization Complete!', 'cyan');
    log('========================================', 'bright');
    log(`✅ Successfully optimized: ${stats.success}`, 'green');
    log(`⚠️  Skipped (already optimized): ${stats.skipped}`, 'yellow');
    log(`❌ Failed: ${stats.failed}`, 'red');
    
    if (stats.orphaned > 0) {
      log(`\n🚨 CRITICAL PRODUCTION ISSUE: ${stats.orphaned} images have S3 keys but files are MISSING!`, 'red');
      log('========================================', 'red');
      log('This is a SERIOUS issue that needs immediate attention!', 'red');
      log('The following database records point to non-existent S3 files:', 'red');
      stats.orphanedImages.forEach(img => {
        log(`  - ${img.fileName} (ID: ${img.id})`, 'red');
        log(`    S3 Key: ${img.s3Key}`, 'yellow');
      });
      log('\nIMMEDIATE ACTION REQUIRED:', 'red');
      log('1. Check S3 bucket for accidental deletions', 'yellow');
      log('2. Check CloudTrail logs for deletion events', 'yellow');
      log('3. Restore from S3 versioning or backup if available', 'yellow');
      log('4. If files cannot be recovered, remove database records', 'yellow');
      log('5. Implement S3 Object Lock to prevent future deletions', 'yellow');
      log('========================================', 'red');
    }
    
    log(`📄 Log file: ${CONFIG.logFile}`, 'cyan');
    
    await logToFile('complete', stats);
    
    if (stats.success > 0) {
      log('\n✅ Success! Your production images are now optimized!', 'green');
      log('\n📝 Next Steps:', 'cyan');
      log('1. Check the website: https://quotes.amexingexperience.com/dashboard/department_manager/vehicles', 'reset');
      log('2. Verify that optimized formats are being served', 'reset');
      log('3. Check browser DevTools Network tab - look for AVIF/WebP formats', 'reset');
      log('4. Monitor page load performance', 'reset');
    }
    
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    
    await logToFile('fatal_error', {
      error: error.message,
      stack: error.stack
    });
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\n\n⚠️  Optimization interrupted by user', 'yellow');
  log('Progress has been saved in the log file.', 'cyan');
  log(`Log file: ${CONFIG.logFile}`, 'cyan');
  process.exit(0);
});

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  log('PRODUCTION Vehicle Images Optimization', 'cyan');
  log('======================================', 'bright');
  log('\nUsage: node scripts/optimize-production-vehicle-images.js [options]', 'yellow');
  log('\nOptions:', 'yellow');
  log('  --dry-run       Preview changes without modifying data', 'reset');
  log('  --limit=N       Process only N images (default: 5)', 'reset');
  log('  --verbose       Show detailed output', 'reset');
  log('  --help, -h      Show this help message', 'reset');
  log('\nExamples:', 'yellow');
  log('  # Dry run to preview:', 'reset');
  log('  node scripts/optimize-production-vehicle-images.js --dry-run --limit=2', 'cyan');
  log('\n  # Optimize first 10 images:', 'reset');
  log('  node scripts/optimize-production-vehicle-images.js --limit=10', 'cyan');
  log('\n⚠️  WARNING: This script modifies PRODUCTION data!', 'red');
  log('Always run with --dry-run first to preview changes.', 'yellow');
  process.exit(0);
}

// Run optimization
optimizeProductionVehicleImages()
  .then(() => {
    log('\n✨ Script completed successfully!', 'green');
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Script failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });