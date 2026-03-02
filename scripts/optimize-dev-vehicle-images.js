#!/usr/bin/env node

/**
 * Optimize Vehicle Images in Development Environment
 * 
 * This script safely optimizes vehicle images in the dev environment
 * to test the complete flow before running on production.
 * 
 * Features:
 * - Works with local dev database
 * - Creates AVIF, WebP, and optimized JPEG variants
 * - Updates database with optimization metadata
 * - Shows real-time progress
 * - Can be stopped anytime (Ctrl+C)
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

// Load development environment
require('dotenv').config({ path: `environments/.env.development` });

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const readline = require('readline');

// Initialize Parse with dev settings
Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
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
  bucket: process.env.S3_BUCKET || 'amexing-bucket',
  environment: 'dev',
  batchSize: 1, // Process one at a time for safety
  dryRun: process.argv.includes('--dry-run'),
  limit: parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1]) || 5,
  verbose: process.argv.includes('--verbose')
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
  console.log(`${colors[color]}${message}${colors.reset}`);
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
    if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
      return false;
    }
    // For other errors, log but return false to be safe
    log(`     ⚠️  Error checking S3 key ${key}: ${error.code}`, 'yellow');
    return false;
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
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new Error(`Image not found in S3: ${key}`);
    }
    throw error;
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
    Metadata: metadata
  };
  
  if (CONFIG.dryRun) {
    log(`    [DRY RUN] Would upload: ${key}`, 'yellow');
    return `https://${CONFIG.bucket}.s3.amazonaws.com/${key}`;
  }
  
  const result = await s3.upload(params).promise();
  return result.Location;
}

/**
 * Create optimized image variants
 */
async function createOptimizedVariants(buffer, basePath) {
  const variants = {};
  const sharpInstance = sharp(buffer);
  const metadata = await sharpInstance.metadata();
  
  // Create optimized JPEG
  log('    Creating optimized JPEG...', 'blue');
  const jpegBuffer = await sharp(buffer)
    .jpeg({
      quality: 85,
      progressive: true,
      mozjpeg: true
    })
    .toBuffer();
  
  const jpegKey = basePath + '.jpeg';
  await uploadToS3(jpegKey, jpegBuffer, 'image/jpeg', {
    'optimization': 'jpeg',
    'quality': '85',
    'original-size': buffer.length.toString(),
    'optimized-size': jpegBuffer.length.toString()
  });
  
  variants.jpeg = {
    key: jpegKey,
    size: jpegBuffer.length,
    contentType: 'image/jpeg'
  };
  
  log(`      ✓ JPEG: ${(jpegBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - jpegBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  
  // Create WebP
  log('    Creating WebP...', 'blue');
  const webpBuffer = await sharp(buffer)
    .webp({
      quality: 85,
      effort: 6
    })
    .toBuffer();
  
  const webpKey = basePath + '.webp';
  await uploadToS3(webpKey, webpBuffer, 'image/webp', {
    'optimization': 'webp',
    'quality': '85'
  });
  
  variants.webp = {
    key: webpKey,
    size: webpBuffer.length,
    contentType: 'image/webp'
  };
  
  log(`      ✓ WebP: ${(webpBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - webpBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  
  // Create AVIF
  log('    Creating AVIF...', 'blue');
  const avifBuffer = await sharp(buffer)
    .avif({
      quality: 80,
      effort: 6
    })
    .toBuffer();
  
  const avifKey = basePath + '.avif';
  await uploadToS3(avifKey, avifBuffer, 'image/avif', {
    'optimization': 'avif',
    'quality': '80'
  });
  
  variants.avif = {
    key: avifKey,
    size: avifBuffer.length,
    contentType: 'image/avif'
  };
  
  log(`      ✓ AVIF: ${(avifBuffer.length / 1024 / 1024).toFixed(2)} MB (${((1 - avifBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`, 'green');
  
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
  image.set('optimizedVariants', optimizationData.variants);
  image.set('optimizationMetadata', {
    optimized: true,
    optimizedAt: new Date().toISOString(),
    originalSize: optimizationData.originalSize,
    formats: ['jpeg', 'webp', 'avif'],
    preferredFormat: 'auto', // Will be determined by Accept header
    dimensions: {
      width: optimizationData.metadata.width,
      height: optimizationData.metadata.height
    }
  });
  
  await image.save(null, { useMasterKey: true });
}

/**
 * Optimize a single vehicle image
 */
async function optimizeVehicleImage(vehicleImage) {
  const vehicleId = vehicleImage.get('vehicle')?.id;
  const vehicleName = vehicleImage.get('vehicle') ? 
    `${vehicleImage.get('vehicle').get('brand')} ${vehicleImage.get('vehicle').get('model')}` : 
    'Unknown';
  const s3Key = vehicleImage.get('s3Key');
  const fileName = vehicleImage.get('fileName');
  
  log(`\n  📸 Processing: ${vehicleName} - ${fileName}`, 'cyan');
  log(`     Image ID: ${vehicleImage.id}`, 'reset');
  
  // Check if already has all variants
  const existingVariants = vehicleImage.get('optimizedVariants');
  if (existingVariants && existingVariants.jpeg && existingVariants.webp && existingVariants.avif) {
    log('     ⚠️  Already has all variants, skipping...', 'yellow');
    return { skipped: true };
  }
  
  if (!s3Key) {
    log('     ✗ No S3 key found, skipping...', 'red');
    return { error: 'No S3 key' };
  }
  
  // IMPORTANT: Verify S3 file exists before attempting to download
  log('     Verifying S3 file exists...', 'blue');
  const s3Exists = await s3ObjectExists(s3Key);
  
  if (!s3Exists) {
    log(`     ✗ S3 file does not exist: ${s3Key}`, 'red');
    log('     ⚠️  This image record has an S3 key but the file is missing!', 'yellow');
    log('     Consider removing this orphaned record or re-uploading the image', 'yellow');
    return { error: 'S3 file missing', orphaned: true };
  }
  
  try {
    // Download original image
    log('     Downloading original image...', 'blue');
    const imageBuffer = await downloadFromS3(s3Key);
    const originalSize = imageBuffer.length;
    log(`     Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`, 'reset');
    
    // Create base path for variants (remove extension)
    const basePath = s3Key.replace(/\.[^.]+$/, '');
    
    // Create optimized variants
    const optimizationData = await createOptimizedVariants(imageBuffer, basePath);
    
    // Update database
    await updateVehicleImageInDatabase(vehicleImage.id, optimizationData);
    
    log('     ✅ Optimization complete!', 'green');
    return { success: true, data: optimizationData };
    
  } catch (error) {
    log(`     ✗ Error: ${error.message}`, 'red');
    return { error: error.message };
  }
}

/**
 * Link orphaned images to appropriate vehicles
 */
async function linkOrphanedImages() {
  try {
    log('\n🔗 Checking for orphaned images...', 'cyan');
    
    // Find images without vehicles
    const orphanedQuery = new Parse.Query('VehicleImage');
    orphanedQuery.doesNotExist('vehicle');
    orphanedQuery.limit(100);
    const orphanedImages = await orphanedQuery.find({ useMasterKey: true });
    
    if (orphanedImages.length === 0) {
      log('  ✓ No orphaned images found', 'green');
      return;
    }
    
    log(`  Found ${orphanedImages.length} orphaned images`, 'yellow');
    
    // Get all vehicles
    const vehicleQuery = new Parse.Query('Vehicle');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.limit(10);
    const vehicles = await vehicleQuery.find({ useMasterKey: true });
    
    if (vehicles.length === 0) {
      log('  ⚠️  No vehicles found to link images to', 'yellow');
      return;
    }
    
    // Group orphaned images by filename patterns to assign to appropriate vehicles
    const imageGroups = {
      suburban: [],
      joker: [],
      evi: [],
      other: []
    };
    
    orphanedImages.forEach(img => {
      const fileName = img.get('fileName')?.toLowerCase() || '';
      if (fileName.includes('suburban')) {
        imageGroups.suburban.push(img);
      } else if (fileName.includes('joker')) {
        imageGroups.joker.push(img);
      } else if (fileName.includes('evi')) {
        imageGroups.evi.push(img);
      } else {
        imageGroups.other.push(img);
      }
    });
    
    // Try to match images to vehicles by name/type
    let linkedCount = 0;
    
    for (const vehicle of vehicles) {
      const brand = vehicle.get('brand')?.toLowerCase() || '';
      const model = vehicle.get('model')?.toLowerCase() || '';
      const vehicleName = `${brand} ${model}`;
      
      // Link suburban images to SUV-type vehicles
      if ((brand.includes('chevrolet') || model.includes('suburban')) && imageGroups.suburban.length > 0) {
        const imagesToLink = imageGroups.suburban.splice(0, Math.min(4, imageGroups.suburban.length));
        for (const img of imagesToLink) {
          if (!CONFIG.dryRun) {
            img.set('vehicle', vehicle);
            await img.save(null, { useMasterKey: true });
          }
          log(`    ✓ Linked ${img.get('fileName')} to ${vehicle.get('brand')} ${vehicle.get('model')}`, 'green');
          linkedCount++;
        }
      }
      
      // Distribute remaining images evenly across vehicles
      const remainingImages = [...imageGroups.joker, ...imageGroups.evi, ...imageGroups.other, ...imageGroups.suburban];
      if (remainingImages.length > 0 && vehicles.indexOf(vehicle) < remainingImages.length) {
        const img = remainingImages[vehicles.indexOf(vehicle)];
        if (img && !img.get('vehicle')) {
          if (!CONFIG.dryRun) {
            img.set('vehicle', vehicle);
            await img.save(null, { useMasterKey: true });
          }
          log(`    ✓ Linked ${img.get('fileName')} to ${vehicle.get('brand')} ${vehicle.get('model')}`, 'green');
          linkedCount++;
        }
      }
    }
    
    log(`  ✅ Successfully linked ${linkedCount} orphaned images to vehicles`, 'green');
    
    // Set primary images for vehicles that don't have one
    await ensurePrimaryImages();
    
  } catch (error) {
    log(`  ✗ Error linking orphaned images: ${error.message}`, 'red');
  }
}

/**
 * Ensure each vehicle has a primary image
 */
async function ensurePrimaryImages() {
  try {
    log('\n🎯 Ensuring each vehicle has a primary image...', 'cyan');
    
    const vehicleQuery = new Parse.Query('Vehicle');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.limit(20);
    const vehicles = await vehicleQuery.find({ useMasterKey: true });
    
    let fixedCount = 0;
    
    for (const vehicle of vehicles) {
      // Check if vehicle has a primary image
      const primaryQuery = new Parse.Query('VehicleImage');
      primaryQuery.equalTo('vehicleId', vehicle);
      primaryQuery.equalTo('isPrimary', true);
      const primaryImage = await primaryQuery.first({ useMasterKey: true });
      
      if (!primaryImage) {
        // Get first available image for this vehicle
        const imageQuery = new Parse.Query('VehicleImage');
        imageQuery.equalTo('vehicleId', vehicle);
        imageQuery.exists('s3Key');
        imageQuery.ascending('createdAt');
        const firstImage = await imageQuery.first({ useMasterKey: true });
        
        if (firstImage) {
          if (!CONFIG.dryRun) {
            firstImage.set('isPrimary', true);
            await firstImage.save(null, { useMasterKey: true });
          }
          log(`    ✓ Set primary image for ${vehicle.get('brand')} ${vehicle.get('model')}`, 'green');
          fixedCount++;
        }
      }
    }
    
    if (fixedCount > 0) {
      log(`  ✅ Fixed ${fixedCount} vehicles with missing primary images`, 'green');
    } else {
      log('  ✓ All vehicles have primary images', 'green');
    }
    
  } catch (error) {
    log(`  ✗ Error setting primary images: ${error.message}`, 'red');
  }
}

/**
 * Main optimization function
 */
async function optimizeDevVehicleImages() {
  try {
    log('========================================', 'bright');
    log('Dev Vehicle Images Optimization', 'cyan');
    log('========================================', 'bright');
    log(`Environment: ${CONFIG.environment}`, 'yellow');
    log(`Parse Server: ${Parse.serverURL}`, 'yellow');
    log(`S3 Bucket: ${CONFIG.bucket}`, 'yellow');
    log(`Limit: ${CONFIG.limit} images`, 'yellow');
    
    if (CONFIG.dryRun) {
      log('\n🔍 DRY RUN MODE - No changes will be made', 'yellow');
    }
    
    // Confirm before proceeding
    if (!CONFIG.dryRun) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('\n⚠️  This will optimize vehicle images in DEV environment. Continue? (yes/no): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== 'yes') {
        log('Operation cancelled.', 'yellow');
        return;
      }
    }
    
    // First, link orphaned images to vehicles
    await linkOrphanedImages();
    
    // Fetch vehicle images
    log('\n📊 Fetching vehicle images from dev database...', 'yellow');
    
    // Simple query - get all images with s3Key, then filter manually
    const query = new Parse.Query('VehicleImage');
    query.equalTo('exists', true);
    query.exists('s3Key');
    query.include('vehicle');
    query.ascending('createdAt');
    
    const allImages = await query.find({ useMasterKey: true });
    
    // Filter images that don't have complete optimized variants
    // Include orphaned images as well since we now link them
    const vehicleImages = allImages.filter(img => {
      const variants = img.get('optimizedVariants');
      // Return true if no variants or missing any variant
      return !variants || !variants.jpeg || !variants.webp || !variants.avif;
    }).slice(0, CONFIG.limit); // Apply limit after filtering
    
    if (vehicleImages.length === 0) {
      log('  ✓ All vehicle images are already optimized!', 'green');
      return;
    }
    
    log(`  ✓ Found ${vehicleImages.length} images to optimize`, 'green');
    
    // Process images
    log('\n🎨 Starting optimization...', 'cyan');
    
    const stats = {
      total: vehicleImages.length,
      success: 0,
      skipped: 0,
      failed: 0,
      orphaned: 0,
      orphanedImages: []
    };
    
    for (let i = 0; i < vehicleImages.length; i++) {
      showProgress(i + 1, stats.total, `Optimizing image ${i + 1}/${stats.total}`);
      
      const result = await optimizeVehicleImage(vehicleImages[i]);
      
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
    }
    
    // Summary
    log('\n\n========================================', 'bright');
    log('Optimization Complete!', 'cyan');
    log('========================================', 'bright');
    log(`✅ Successfully optimized: ${stats.success}`, 'green');
    log(`⚠️  Skipped (already optimized): ${stats.skipped}`, 'yellow');
    log(`❌ Failed: ${stats.failed}`, 'red');
    
    if (stats.orphaned > 0) {
      log(`\n🚨 CRITICAL: ${stats.orphaned} images have S3 keys but files are missing!`, 'red');
      log('These database records point to non-existent S3 files:', 'yellow');
      stats.orphanedImages.forEach(img => {
        log(`  - ${img.fileName} (ID: ${img.id})`, 'yellow');
        log(`    S3 Key: ${img.s3Key}`, 'yellow');
      });
      log('\nRecommendation:', 'cyan');
      log('1. Check if these files were accidentally deleted from S3', 'reset');
      log('2. Either restore the files or remove these database records', 'reset');
      log('3. Consider implementing S3 lifecycle policies to prevent accidental deletion', 'reset');
    }
    
    if (stats.success > 0) {
      log('\n📝 Next Steps:', 'cyan');
      log('1. Check the images on localhost:3000/dashboard', 'reset');
      log('2. Verify that optimized formats are being served', 'reset');
      log('3. Check browser DevTools Network tab for image formats', 'reset');
      log('4. Once verified, run the production optimization script', 'reset');
    }
    
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('\n\n⚠️  Optimization interrupted by user', 'yellow');
  log('Progress has been saved. You can resume anytime.', 'cyan');
  process.exit(0);
});

// Run optimization
optimizeDevVehicleImages()
  .then(() => {
    log('\n✨ Script completed successfully!', 'green');
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Script failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });