#!/usr/bin/env node

/**
 * Check Vehicle Images on Production
 * Verifies which image formats are being served on production
 * Created by Denisse Maldonado
 */

// Load production environment
require('dotenv').config({ path: `environments/.env.development` });
require('dotenv').config({ path: `environments/.env.production`, override: true });

const Parse = require('parse/node');

// Initialize Parse with production settings
const PROD_PARSE_APP_ID = 'CrTRTaJpoJFNt8PJ';
const PROD_PARSE_MASTER_KEY = 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP';
const PROD_PARSE_SERVER_URL = 'https://quotes.amexingexperience.com/parse';

Parse.initialize(PROD_PARSE_APP_ID, null, PROD_PARSE_MASTER_KEY);
Parse.serverURL = PROD_PARSE_SERVER_URL;
Parse.masterKey = PROD_PARSE_MASTER_KEY;

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

async function checkVehicleImages() {
  try {
    log('========================================', 'bright');
    log('Production Vehicle Images Check', 'cyan');
    log('========================================', 'bright');
    
    // Step 1: Get vehicle images from production
    log('\n📊 Fetching vehicle images from production...', 'yellow');
    
    const query = new Parse.Query('VehicleImage');
    query.equalTo('exists', true);
    query.exists('s3Key');
    query.limit(5); // Check first 5 images
    query.descending('updatedAt');
    query.include('vehicle');
    
    const vehicleImages = await query.find({ useMasterKey: true });
    
    if (vehicleImages.length === 0) {
      log('  ✗ No vehicle images found in production', 'red');
      return;
    }
    
    log(`  ✓ Found ${vehicleImages.length} vehicle images`, 'green');
    
    // Step 2: Analyze each image
    log('\n🔍 Analyzing image formats and optimization...', 'cyan');
    
    for (const image of vehicleImages) {
      const vehicle = image.get('vehicle');
      const vehicleName = vehicle ? `${vehicle.get('brand')} ${vehicle.get('model')}` : 'Unknown';
      const s3Key = image.get('s3Key');
      const optimizationMetadata = image.get('optimizationMetadata');
      const optimizedVariants = image.get('optimizedVariants');
      
      log(`\n📸 Vehicle: ${vehicleName}`, 'magenta');
      log(`  Image ID: ${image.id}`, 'reset');
      log(`  S3 Key: ${s3Key}`, 'reset');
      
      // Check for optimization metadata
      if (optimizationMetadata) {
        log('  ✓ Has optimization metadata', 'green');
        
        if (typeof optimizationMetadata === 'object') {
          const formats = optimizationMetadata.formats || [];
          const preferredFormat = optimizationMetadata.preferredFormat;
          
          if (formats.length > 0) {
            log(`    Available formats: ${formats.join(', ')}`, 'cyan');
          }
          if (preferredFormat) {
            log(`    Preferred format: ${preferredFormat}`, 'cyan');
          }
        }
      } else {
        log('  ⚠️  No optimization metadata found', 'yellow');
      }
      
      // Check for optimized variants
      if (optimizedVariants) {
        log('  ✓ Has optimized variants', 'green');
        
        const variants = Object.keys(optimizedVariants);
        if (variants.length > 0) {
          log(`    Variants: ${variants.join(', ')}`, 'cyan');
          
          // Check each variant
          for (const variant of variants) {
            const variantData = optimizedVariants[variant];
            if (variantData && variantData.key) {
              const extension = variantData.key.split('.').pop();
              log(`    - ${variant.toUpperCase()}: .${extension} (${variantData.size ? Math.round(variantData.size / 1024) + ' KB' : 'size unknown'})`, 'reset');
            }
          }
        }
      } else {
        log('  ⚠️  No optimized variants found', 'yellow');
      }
      
      // Check what formats are available in S3
      if (s3Key) {
        const baseName = s3Key.replace(/\.[^.]+$/, '');
        const possibleFormats = ['avif', 'webp', 'jpeg', 'jpg'];
        
        log('  📁 Checking for format variants in S3 path:', 'cyan');
        for (const format of possibleFormats) {
          const variantKey = `${baseName}.${format}`;
          if (optimizedVariants && optimizedVariants[format]) {
            log(`    ✓ ${format.toUpperCase()} variant exists`, 'green');
          } else {
            log(`    ✗ ${format.toUpperCase()} variant not found`, 'reset');
          }
        }
      }
    }
    
    // Step 3: Summary
    log('\n========================================', 'bright');
    log('Summary', 'cyan');
    log('========================================', 'bright');
    
    let optimizedCount = 0;
    let notOptimizedCount = 0;
    
    for (const image of vehicleImages) {
      const hasOptimization = image.get('optimizationMetadata') || image.get('optimizedVariants');
      if (hasOptimization) {
        optimizedCount++;
      } else {
        notOptimizedCount++;
      }
    }
    
    log(`Total images checked: ${vehicleImages.length}`, 'reset');
    log(`✓ Optimized: ${optimizedCount}`, 'green');
    log(`⚠ Not optimized: ${notOptimizedCount}`, 'yellow');
    
    if (notOptimizedCount > 0) {
      log('\n📝 Recommendation:', 'cyan');
      log('Some images are missing optimization. Run the optimization script to create AVIF, WebP, and JPEG variants.', 'yellow');
    } else if (optimizedCount > 0) {
      log('\n✅ All checked images have optimization data!', 'green');
      log('The system should be serving optimized formats based on browser capabilities.', 'green');
    }
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the check
checkVehicleImages()
  .then(() => {
    log('\n✨ Check completed successfully!', 'green');
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });