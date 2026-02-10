#!/usr/bin/env node

/**
 * Unified Image Optimization Script
 * 
 * This script handles both image optimization and metadata updates in a single process.
 * It optimizes images to multiple formats (AVIF, WebP, JPEG) and updates the database
 * with optimization metadata and variant information.
 * 
 * Usage:
 *   node scripts/images/unified-optimize-images.js [options]
 * 
 * Options:
 *   --batch-size=N     Process N images at a time (default: 5)
 *   --dry-run          Show what would be processed without making changes
 *   --force            Re-optimize already optimized images
 *   --vehicle-id=ID    Process images for a specific vehicle only
 *   --help             Show this help message
 */

require('dotenv').config({ path: `environments/.env.${process.env.NODE_ENV || 'development'}` });
const Parse = require('parse/node');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID || 'AMEXING_APP',
  process.env.PARSE_JAVASCRIPT_KEY,
  process.env.PARSE_MASTER_KEY || 'AMEXING_MASTER'
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

// Initialize AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

// Configuration
const CONFIG = {
  batchSize: 5,
  dryRun: false,
  force: false,
  vehicleId: null,
  experienceId: null,
  imageType: 'both', // 'vehicles', 'experiences', or 'both'
  formats: ['avif', 'webp', 'jpeg'],
  quality: {
    avif: 85,
    webp: 85,
    jpeg: 85,
  },
  s3Bucket: process.env.S3_BUCKET || 'amexing-bucket',
  s3Prefix: process.env.S3_PREFIX || (process.env.NODE_ENV === 'production' ? 'prod/' : 'dev/'),
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  for (const arg of args) {
    if (arg === '--help') {
      console.log(`
Unified Image Optimization Script

Usage:
  node scripts/images/unified-optimize-images.js [options]

Options:
  --batch-size=N     Process N images at a time (default: 5)
  --dry-run          Show what would be processed without making changes
  --force            Re-optimize already optimized images
  --vehicle-id=ID    Process images for a specific vehicle only
  --help             Show this help message

Examples:
  # Process all unoptimized images in batches of 10
  node scripts/images/unified-optimize-images.js --batch-size=10
  
  # Re-optimize all images for a specific vehicle
  node scripts/images/unified-optimize-images.js --vehicle-id=abc123 --force
  
  # Preview what would be processed
  node scripts/images/unified-optimize-images.js --dry-run
`);
      process.exit(0);
    } else if (arg.startsWith('--batch-size=')) {
      CONFIG.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      CONFIG.dryRun = true;
    } else if (arg === '--force') {
      CONFIG.force = true;
    } else if (arg.startsWith('--vehicle-id=')) {
      CONFIG.vehicleId = arg.split('=')[1];
      CONFIG.imageType = 'vehicles'; // If vehicle-id specified, only process vehicles
    } else if (arg.startsWith('--experience-id=')) {
      CONFIG.experienceId = arg.split('=')[1];
      CONFIG.imageType = 'experiences'; // If experience-id specified, only process experiences
    } else if (arg.startsWith('--type=')) {
      const type = arg.split('=')[1];
      if (['vehicles', 'experiences', 'both'].includes(type)) {
        CONFIG.imageType = type;
      } else {
        console.error(`Invalid type: ${type}. Must be 'vehicles', 'experiences', or 'both'`);
        process.exit(1);
      }
    }
  }
}

// Helper function to download file from S3
async function downloadFromS3(s3Key, localPath) {
  const params = {
    Bucket: CONFIG.s3Bucket,
    Key: s3Key,
  };
  
  const data = await s3.getObject(params).promise();
  await fs.writeFile(localPath, data.Body);
  return localPath;
}

// Helper function to upload file to S3
async function uploadToS3(localPath, s3Key, contentType = 'image/jpeg') {
  const fileContent = await fs.readFile(localPath);
  
  const params = {
    Bucket: CONFIG.s3Bucket,
    Key: s3Key,
    Body: fileContent,
    ContentType: contentType,
  };
  
  const result = await s3.upload(params).promise();
  return result;
}

// Helper function to check if S3 object exists
async function s3ObjectExists(s3Key) {
  try {
    await s3.headObject({
      Bucket: CONFIG.s3Bucket,
      Key: s3Key,
    }).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
}

// Helper function to get content type for format
function getContentType(format) {
  const types = {
    avif: 'image/avif',
    webp: 'image/webp',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
  };
  return types[format] || 'application/octet-stream';
}

// Optimize a single image (works for both VehicleImage and ExperienceImage)
async function optimizeImage(image, imageType = 'vehicle') {
  const imageId = image.id;
  const fileName = image.get('fileName');
  const s3Key = image.get('s3Key');
  
  if (!s3Key) {
    console.log(`  ⚠️  Image ${fileName} has no S3 key, skipping`);
    return { skipped: true, reason: 'No S3 key' };
  }
  
  console.log(`  📸 Processing ${imageType} image: ${fileName} (ID: ${imageId})`);
  
  // Check if already optimized and not forcing
  if (!CONFIG.force) {
    const optimizationMetadata = image.get('optimizationMetadata');
    if (optimizationMetadata?.optimized) {
      console.log(`    ✅ Already optimized, skipping`);
      return { skipped: true, reason: 'Already optimized' };
    }
  }
  
  // Create temporary directory for this image
  const tempDir = path.join(os.tmpdir(), `img-opt-${imageId}-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  
  try {
    // First check if the S3 object exists
    const exists = await s3ObjectExists(s3Key);
    if (!exists) {
      console.log(`    ⚠️  S3 object not found: ${s3Key}`);
      return { skipped: true, reason: 'S3 object not found' };
    }
    
    // Download original image from S3
    console.log(`    ⬇️  Downloading from S3...`);
    const originalPath = path.join(tempDir, 'original' + path.extname(fileName));
    await downloadFromS3(s3Key, originalPath);
    
    // Get original file size
    const originalStats = await fs.stat(originalPath);
    const originalSize = originalStats.size;
    
    // Process image with Sharp to get metadata
    const image = sharp(originalPath);
    const metadata = await image.metadata();
    
    console.log(`    📐 Original: ${metadata.width}x${metadata.height}, ${(originalSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Prepare optimized variants data
    const optimizedVariants = {
      original: {
        s3Key: s3Key,
        fileSize: originalSize,
      }
    };
    
    // Optimize for each format
    const formatSizes = { original: originalSize };
    const availableFormats = ['original'];
    
    for (const format of CONFIG.formats) {
      try {
        console.log(`    🔄 Converting to ${format.toUpperCase()}...`);
        
        // Generate optimized filename
        const baseName = path.basename(fileName, path.extname(fileName));
        const optimizedFileName = `${baseName}.${format === 'jpeg' ? 'jpg' : format}`;
        const optimizedPath = path.join(tempDir, optimizedFileName);
        
        // Optimize image
        let pipeline = sharp(originalPath);
        
        if (format === 'avif') {
          pipeline = pipeline.avif({ quality: CONFIG.quality.avif, effort: 4 });
        } else if (format === 'webp') {
          pipeline = pipeline.webp({ quality: CONFIG.quality.webp });
        } else if (format === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: CONFIG.quality.jpeg, progressive: true });
        }
        
        await pipeline.toFile(optimizedPath);
        
        // Get optimized file size
        const optimizedStats = await fs.stat(optimizedPath);
        const optimizedSize = optimizedStats.size;
        
        // Upload to S3 in optimized subfolder - handle both vehicles and experiences
        let optimizedS3Key;
        if (imageType === 'vehicle') {
          optimizedS3Key = s3Key.replace('/vehicles/', '/vehicles/optimized/').replace(path.extname(s3Key), `.${format === 'jpeg' ? 'jpg' : format}`);
        } else {
          optimizedS3Key = s3Key.replace('/experiences/', '/experiences/optimized/').replace(path.extname(s3Key), `.${format === 'jpeg' ? 'jpg' : format}`);
        }
        
        if (!CONFIG.dryRun) {
          console.log(`    ⬆️  Uploading ${format.toUpperCase()} to S3...`);
          await uploadToS3(optimizedPath, optimizedS3Key, getContentType(format));
        } else {
          console.log(`    🔍 [DRY RUN] Would upload ${format.toUpperCase()} to: ${optimizedS3Key}`);
        }
        
        // Add to variants
        optimizedVariants[format] = {
          s3Key: optimizedS3Key,
          fileSize: optimizedSize,
        };
        
        formatSizes[format] = optimizedSize;
        availableFormats.push(format);
        
        const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
        console.log(`    ✅ ${format.toUpperCase()}: ${(optimizedSize / 1024 / 1024).toFixed(2)}MB (${savings}% smaller)`);
        
      } catch (error) {
        console.error(`    ❌ Failed to create ${format}: ${error.message}`);
      }
    }
    
    // Update database with optimization metadata and variants
    if (!CONFIG.dryRun) {
      console.log(`    💾 Updating database...`);
      
      // Set optimization metadata
      image.set('optimizationMetadata', {
        optimized: true,
        optimizedAt: new Date().toISOString(),
        availableFormats: availableFormats,
        hasAvif: availableFormats.includes('avif'),
        hasWebp: availableFormats.includes('webp'),
        hasJpeg: availableFormats.includes('jpeg'),
        formatSizes: formatSizes,
        originalSize: originalSize,
        dimensions: {
          width: metadata.width,
          height: metadata.height,
        },
        optimizationVersion: '3.0.0',
        optimizedBy: 'unified-optimize-script',
      });
      
      // Set optimized variants with S3 keys
      image.set('optimizedVariants', optimizedVariants);
      
      await image.save(null, { useMasterKey: true });
      console.log(`    ✅ Database updated successfully`);
    } else {
      console.log(`    🔍 [DRY RUN] Would update database with metadata and variants`);
    }
    
    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true, force: true });
    
    return {
      success: true,
      formats: availableFormats,
      sizes: formatSizes,
      variants: optimizedVariants,
    };
    
  } catch (error) {
    console.error(`    ❌ Error processing image: ${error.message}`);
    
    // Clean up temporary files on error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return {
      error: true,
      message: error.message,
    };
  }
}

// Process vehicle images
async function processVehicleImages() {
  console.log('\n🚘 Processing Vehicle Images...');
  console.log('--------------------------------');
  
  // Build query for vehicle images
  const query = new Parse.Query('VehicleImage');
  
  if (CONFIG.vehicleId) {
      // Process specific vehicle
      const vehicle = new Parse.Object('Vehicle');
      vehicle.id = CONFIG.vehicleId;
      query.equalTo('vehicle', vehicle);
    } else if (!CONFIG.force) {
      // Only process unoptimized images - check for those without optimizationMetadata
      // or where optimized field is false/missing
      const unoptimizedQuery = new Parse.Query('VehicleImage');
      unoptimizedQuery.doesNotExist('optimizationMetadata');
      
      const notOptimizedQuery = new Parse.Query('VehicleImage');
      notOptimizedQuery.equalTo('optimizationMetadata.optimized', false);
      
      query._orQuery([unoptimizedQuery, notOptimizedQuery]);
    }
    
    // Only process images with valid S3 keys and that are active
    query.exists('s3Key');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    query.ascending('createdAt');
    query.limit(CONFIG.batchSize);
    
    // Get total count
    const totalCount = await query.count({ useMasterKey: true });
    console.log(`📊 Found ${totalCount} images to process\n`);
    
    if (totalCount === 0) {
      console.log('✅ No images need optimization!');
      return;
    }
    
    if (CONFIG.dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    // Process in batches
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    while (processedCount < totalCount) {
      query.skip(processedCount);
      const images = await query.find({ useMasterKey: true });
      
      if (images.length === 0) {
        break;
      }
      
      console.log(`\n📦 Processing batch ${Math.floor(processedCount / CONFIG.batchSize) + 1} (${images.length} vehicle images):`);
      
      for (const image of images) {
        const result = await optimizeImage(image, 'vehicle');
        
        if (result.success) {
          successCount++;
        } else if (result.error) {
          errorCount++;
        } else if (result.skipped) {
          skippedCount++;
        }
        
        processedCount++;
        
        // Show progress
        const progress = ((processedCount / totalCount) * 100).toFixed(1);
        console.log(`  📊 Progress: ${processedCount}/${totalCount} (${progress}%)\n`);
      }
      
      // Small delay between batches to avoid overloading
      if (processedCount < totalCount) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return { processed: processedCount, success: successCount, error: errorCount, skipped: skippedCount };
}

// Process experience images
async function processExperienceImages() {
  console.log('\n🎨 Processing Experience Images...');
  console.log('-----------------------------------');
  
  // Build query for experience images
  const query = new Parse.Query('ExperienceImage');
  
  if (CONFIG.experienceId) {
    // Process specific experience
    const experience = new Parse.Object('Experience');
    experience.id = CONFIG.experienceId;
    query.equalTo('experience', experience);
  } else if (!CONFIG.force) {
    // Only process unoptimized images
    const unoptimizedQuery = new Parse.Query('ExperienceImage');
    unoptimizedQuery.doesNotExist('optimizationMetadata');
    
    const notOptimizedQuery = new Parse.Query('ExperienceImage');
    notOptimizedQuery.equalTo('optimizationMetadata.optimized', false);
    
    query._orQuery([unoptimizedQuery, notOptimizedQuery]);
  }
  
  // Only process images with valid S3 keys and that are active
  query.exists('s3Key');
  query.equalTo('active', true);
  query.equalTo('exists', true);
  query.ascending('createdAt');
  query.limit(CONFIG.batchSize);
  
  // Get total count
  const totalCount = await query.count({ useMasterKey: true });
  console.log(`📊 Found ${totalCount} experience images to process\n`);
  
  if (totalCount === 0) {
    console.log('✅ No experience images need optimization!');
    return { processed: 0, success: 0, error: 0, skipped: 0 };
  }
  
  // Process in batches
  let processedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  
  while (processedCount < totalCount) {
    query.skip(processedCount);
    const images = await query.find({ useMasterKey: true });
    
    if (images.length === 0) {
      break;
    }
    
    console.log(`\n📦 Processing batch ${Math.floor(processedCount / CONFIG.batchSize) + 1} (${images.length} experience images):`);
    
    for (const image of images) {
      const result = await optimizeImage(image, 'experience');
      
      if (result.success) {
        successCount++;
      } else if (result.error) {
        errorCount++;
      } else if (result.skipped) {
        skippedCount++;
      }
      
      processedCount++;
      
      // Show progress
      const progress = ((processedCount / totalCount) * 100).toFixed(1);
      console.log(`  📊 Progress: ${processedCount}/${totalCount} (${progress}%)\n`);
    }
    
    // Small delay between batches to avoid overloading
    if (processedCount < totalCount) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { processed: processedCount, success: successCount, error: errorCount, skipped: skippedCount };
}

// Main processing function
async function processImages() {
  try {
    console.log('\n🚀 Unified Image Optimization Script');
    console.log('====================================');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`S3 Bucket: ${CONFIG.s3Bucket}`);
    console.log(`S3 Prefix: ${CONFIG.s3Prefix}`);
    console.log(`Batch Size: ${CONFIG.batchSize}`);
    console.log(`Dry Run: ${CONFIG.dryRun}`);
    console.log(`Force Re-optimize: ${CONFIG.force}`);
    console.log(`Image Type: ${CONFIG.imageType}`);
    if (CONFIG.vehicleId) {
      console.log(`Vehicle ID: ${CONFIG.vehicleId}`);
    }
    if (CONFIG.experienceId) {
      console.log(`Experience ID: ${CONFIG.experienceId}`);
    }
    console.log('');
    
    if (CONFIG.dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    // Track overall stats
    const stats = {
      vehicles: { processed: 0, success: 0, error: 0, skipped: 0 },
      experiences: { processed: 0, success: 0, error: 0, skipped: 0 }
    };
    
    // Process based on imageType setting
    if (CONFIG.imageType === 'vehicles' || CONFIG.imageType === 'both') {
      stats.vehicles = await processVehicleImages();
    }
    
    if (CONFIG.imageType === 'experiences' || CONFIG.imageType === 'both') {
      stats.experiences = await processExperienceImages();
    }
    
    // Calculate totals
    const totalProcessed = stats.vehicles.processed + stats.experiences.processed;
    const totalSuccess = stats.vehicles.success + stats.experiences.success;
    const totalError = stats.vehicles.error + stats.experiences.error;
    const totalSkipped = stats.vehicles.skipped + stats.experiences.skipped;
    
    // Final summary
    console.log('\n========================================');
    console.log('📈 Optimization Complete!');
    console.log('========================================');
    
    if (CONFIG.imageType === 'both' || CONFIG.imageType === 'vehicles') {
      console.log('\n🚘 Vehicle Images:');
      console.log(`  ✅ Successfully optimized: ${stats.vehicles.success}`);
      console.log(`  ⏭️  Skipped: ${stats.vehicles.skipped}`);
      console.log(`  ❌ Errors: ${stats.vehicles.error}`);
      console.log(`  📊 Total: ${stats.vehicles.processed}`);
    }
    
    if (CONFIG.imageType === 'both' || CONFIG.imageType === 'experiences') {
      console.log('\n🎨 Experience Images:');
      console.log(`  ✅ Successfully optimized: ${stats.experiences.success}`);
      console.log(`  ⏭️  Skipped: ${stats.experiences.skipped}`);
      console.log(`  ❌ Errors: ${stats.experiences.error}`);
      console.log(`  📊 Total: ${stats.experiences.processed}`);
    }
    
    console.log('\n📊 Overall Summary:');
    console.log(`  ✅ Successfully optimized: ${totalSuccess} images`);
    console.log(`  ⏭️  Skipped (already optimized): ${totalSkipped} images`);
    console.log(`  ❌ Errors: ${totalError} images`);
    console.log(`  📊 Total processed: ${totalProcessed} images`);
    
    if (CONFIG.dryRun) {
      console.log('\n🔍 This was a DRY RUN - no actual changes were made');
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
async function main() {
  parseArgs();
  await processImages();
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled rejection:', error);
  process.exit(1);
});

main();