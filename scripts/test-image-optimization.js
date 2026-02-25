#!/usr/bin/env node

/**
 * Test Image Optimization for Experience Uploads
 * 
 * This script verifies that uploading images to experiences creates
 * AVIF and WebP optimized formats in S3.
 * 
 * Created by Denisse Maldonado
 */

require('dotenv').config({ 
  path: './environments/.env.development' 
});

const AWS = require('aws-sdk');
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

async function checkOptimizedFormats(s3Key) {
  console.log('\n🔍 Checking optimized formats for:', s3Key);
  
  // Remove extension to get base path
  const lastDot = s3Key.lastIndexOf('.');
  const basePath = s3Key.substring(0, lastDot);
  
  const formats = {
    original: s3Key,
    avif: `${basePath}.avif`,
    webp: `${basePath}.webp`,
    jpeg: `${basePath}.jpg`
  };
  
  console.log('\n📋 Expected S3 keys:');
  for (const [format, key] of Object.entries(formats)) {
    console.log(`  ${format}: ${key}`);
  }
  
  console.log('\n✅ Checking existence in S3:');
  
  const results = {};
  for (const [format, key] of Object.entries(formats)) {
    try {
      const response = await s3.headObject({
        Bucket: process.env.S3_BUCKET,
        Key: key
      }).promise();
      
      results[format] = {
        exists: true,
        size: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified
      };
      
      console.log(`  ✓ ${format}: ${(response.ContentLength / 1024).toFixed(2)} KB (${response.ContentType})`);
    } catch (error) {
      if (error.code === 'NotFound') {
        results[format] = { exists: false };
        console.log(`  ✗ ${format}: Not found`);
      } else {
        results[format] = { exists: false, error: error.message };
        console.log(`  ✗ ${format}: Error - ${error.message}`);
      }
    }
  }
  
  return results;
}

async function listRecentUploads() {
  console.log('\n📂 Recent uploads in experiences folder:');
  
  try {
    const response = await s3.listObjectsV2({
      Bucket: process.env.S3_BUCKET,
      Prefix: `${process.env.S3_PREFIX}experiences/`,
      MaxKeys: 20
    }).promise();
    
    // Sort by LastModified (most recent first)
    const files = response.Contents.sort((a, b) => b.LastModified - a.LastModified);
    
    console.log(`\nFound ${files.length} files (showing most recent):\n`);
    
    files.slice(0, 10).forEach(file => {
      const size = (file.Size / 1024).toFixed(2);
      const age = Math.floor((Date.now() - file.LastModified) / 1000 / 60);
      console.log(`  ${file.Key}`);
      console.log(`    Size: ${size} KB | Age: ${age} minutes`);
    });
    
    // Find the most recent upload (non-AVIF/WebP)
    const recentOriginal = files.find(f => 
      !f.Key.endsWith('.avif') && 
      !f.Key.endsWith('.webp') &&
      f.Key.includes('experiences/')
    );
    
    if (recentOriginal) {
      console.log('\n🎯 Testing most recent upload:');
      await checkOptimizedFormats(recentOriginal.Key);
    }
    
  } catch (error) {
    console.error('❌ Error listing uploads:', error.message);
  }
}

async function main() {
  console.log('🚀 Testing Image Optimization for Experiences');
  console.log('============================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`S3 Bucket: ${process.env.S3_BUCKET}`);
  console.log(`S3 Prefix: ${process.env.S3_PREFIX}`);
  
  // List recent uploads and check for optimized formats
  await listRecentUploads();
  
  console.log('\n============================================');
  console.log('💡 To test new uploads:');
  console.log('1. Go to http://localhost:1337/dashboard/admin/experiences');
  console.log('2. Upload a new image to any experience');
  console.log('3. Run this script again to verify AVIF/WebP creation');
  console.log('\n✅ Script complete!');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});