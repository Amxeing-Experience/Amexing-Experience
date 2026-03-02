#!/usr/bin/env node

/**
 * S3 Integrity Check Script
 * 
 * This script verifies that all S3 keys in the database actually exist in S3.
 * It helps identify orphaned database records that point to missing files.
 * 
 * CRITICAL for production safety!
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const envFile = process.argv[2] === '--production' ? 'production' : 'development';
require('dotenv').config({ path: `environments/.env.${envFile}` });

const Parse = require('parse/node');
const AWS = require('aws-sdk');
const fs = require('fs').promises;

// Initialize Parse
if (envFile === 'production') {
  Parse.initialize('CrTRTaJpoJFNt8PJ', null, 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP');
  Parse.serverURL = 'https://quotes.amexingexperience.com/parse';
  Parse.masterKey = 'MEu9DMJo6bQHqxoKqLx0mx/il5hTnBEgn6SIdfKsEvA+1xcW2c5yJ4Idbq4awCUP';
} else {
  Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
  Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';
  Parse.masterKey = process.env.PARSE_MASTER_KEY;
}

// Initialize AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();
const BUCKET = process.env.S3_BUCKET || 'amexing-bucket';

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

/**
 * Check if S3 object exists
 */
async function s3ObjectExists(key) {
  try {
    await s3.headObject({
      Bucket: BUCKET,
      Key: key
    }).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
      return false;
    }
    // Log other errors but consider as not found
    log(`Error checking ${key}: ${error.code}`, 'yellow');
    return false;
  }
}

/**
 * Main integrity check
 */
async function checkS3Integrity() {
  log('========================================', 'bright');
  log(`S3 Integrity Check - ${envFile.toUpperCase()}`, 'cyan');
  log('========================================', 'bright');
  log(`Environment: ${envFile}`, 'yellow');
  log(`Parse Server: ${Parse.serverURL}`, 'yellow');
  log(`S3 Bucket: ${BUCKET}`, 'yellow');
  log('', 'reset');
  
  try {
    // Fetch all vehicle images with S3 keys
    log('📊 Fetching all vehicle images from database...', 'cyan');
    
    const query = new Parse.Query('VehicleImage');
    query.exists('s3Key');
    query.include('vehicle');
    query.limit(1000); // Adjust as needed
    
    const images = await query.find({ useMasterKey: true });
    log(`Found ${images.length} images with S3 keys\n`, 'green');
    
    const results = {
      total: images.length,
      valid: 0,
      missing: 0,
      missingImages: [],
      errors: 0
    };
    
    log('🔍 Checking S3 existence for each image...', 'cyan');
    
    // Progress counter
    let checked = 0;
    
    for (const image of images) {
      const s3Key = image.get('s3Key');
      const fileName = image.get('fileName');
      const vehicle = image.get('vehicle');
      const vehicleName = vehicle ? 
        `${vehicle.get('brand')} ${vehicle.get('model')}` : 
        'No vehicle';
      
      checked++;
      if (checked % 10 === 0) {
        process.stdout.write(`\rChecking: ${checked}/${results.total}`);
      }
      
      const exists = await s3ObjectExists(s3Key);
      
      if (exists) {
        results.valid++;
      } else {
        results.missing++;
        results.missingImages.push({
          id: image.id,
          fileName,
          s3Key,
          vehicleName,
          vehicleId: vehicle?.id,
          hasOptimizedVariants: !!image.get('optimizedVariants')
        });
      }
      
      // Check optimized variants if they exist
      const variants = image.get('optimizedVariants');
      if (variants) {
        for (const [format, variant] of Object.entries(variants)) {
          if (variant.s3Key) {
            const variantExists = await s3ObjectExists(variant.s3Key);
            if (!variantExists) {
              results.missing++;
              results.missingImages.push({
                id: image.id,
                fileName: `${fileName} (${format} variant)`,
                s3Key: variant.s3Key,
                vehicleName,
                vehicleId: vehicle?.id,
                isVariant: true,
                format
              });
            }
          }
        }
      }
    }
    
    console.log('\r'); // Clear the progress line
    
    // Results summary
    log('\n========================================', 'bright');
    log('Integrity Check Results', 'cyan');
    log('========================================', 'bright');
    
    if (results.missing === 0) {
      log(`✅ ALL GOOD! All ${results.total} S3 files exist!`, 'green');
    } else {
      log(`🚨 CRITICAL: ${results.missing} S3 files are MISSING!`, 'red');
      log(`✅ Valid files: ${results.valid}`, 'green');
      log(`❌ Missing files: ${results.missing}`, 'red');
      
      log('\n🔴 Missing S3 Files:', 'red');
      log('========================================', 'red');
      
      // Group by vehicle
      const byVehicle = {};
      results.missingImages.forEach(img => {
        const key = img.vehicleName || 'Unlinked';
        if (!byVehicle[key]) {
          byVehicle[key] = [];
        }
        byVehicle[key].push(img);
      });
      
      for (const [vehicleName, images] of Object.entries(byVehicle)) {
        log(`\n${vehicleName}:`, 'yellow');
        images.forEach(img => {
          log(`  - ${img.fileName} (ID: ${img.id})`, 'red');
          log(`    S3 Key: ${img.s3Key}`, 'yellow');
          if (img.isVariant) {
            log(`    Type: ${img.format} variant`, 'yellow');
          }
        });
      }
      
      // Save report
      const reportFile = `s3-integrity-report-${envFile}-${Date.now()}.json`;
      await fs.writeFile(reportFile, JSON.stringify({
        environment: envFile,
        timestamp: new Date().toISOString(),
        bucket: BUCKET,
        results,
        missingFiles: results.missingImages
      }, null, 2));
      
      log(`\n📄 Detailed report saved to: ${reportFile}`, 'cyan');
      
      log('\n⚠️  RECOMMENDATIONS:', 'yellow');
      log('========================================', 'yellow');
      
      if (envFile === 'production') {
        log('PRODUCTION CRITICAL ACTIONS:', 'red');
        log('1. IMMEDIATELY check CloudTrail for deletion events', 'red');
        log('2. Check if S3 versioning can recover the files', 'red');
        log('3. Verify backup systems have these files', 'red');
        log('4. Enable S3 Object Lock to prevent deletions', 'red');
        log('5. Set up S3 lifecycle rules with caution', 'red');
      } else {
        log('DEVELOPMENT ENVIRONMENT:', 'yellow');
        log('1. These missing files can be cleaned up from database', 'yellow');
        log('2. Run: node scripts/cleanup-orphaned-records.js', 'yellow');
        log('3. Consider re-uploading missing images if needed', 'yellow');
      }
      
      log('\nTo remove orphaned database records:', 'cyan');
      log('1. Review the report file first', 'reset');
      log('2. Create a backup of your database', 'reset');
      log('3. Run cleanup script to remove orphaned records', 'reset');
    }
    
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Help message
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  log('S3 Integrity Check Script', 'cyan');
  log('========================', 'bright');
  log('\nUsage:', 'yellow');
  log('  node scripts/check-s3-integrity.js           # Check development', 'reset');
  log('  node scripts/check-s3-integrity.js --production  # Check production', 'reset');
  log('\nThis script verifies that all S3 keys in the database', 'reset');
  log('actually correspond to existing files in S3.', 'reset');
  log('\n⚠️  CRITICAL for production safety!', 'red');
  process.exit(0);
}

// Run check
checkS3Integrity()
  .then(() => {
    log('\n✨ Integrity check complete!', 'green');
    process.exit(0);
  })
  .catch(error => {
    log(`\n❌ Script failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });