#!/usr/bin/env node

/**
 * Check specific image formats in S3
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

async function checkImage() {
  const baseKey = 'dev/experiences/SZt83yL2oF/1772044868147-1c3cxem5-SZt83yL2oF-1772044868146-51e1c9a30a7f3718';
  
  const formats = [
    { ext: '.png', name: 'PNG (Original)' },
    { ext: '.jpg', name: 'JPEG' },
    { ext: '.avif', name: 'AVIF' },
    { ext: '.webp', name: 'WebP' }
  ];
  
  console.log('🔍 Checking formats for image:');
  console.log(`Base: ${baseKey}`);
  console.log('\n📋 Checking existence:');
  
  for (const format of formats) {
    const key = baseKey + format.ext;
    try {
      const response = await s3.headObject({
        Bucket: process.env.S3_BUCKET,
        Key: key
      }).promise();
      
      console.log(`✅ ${format.name}: EXISTS (${(response.ContentLength / 1024).toFixed(2)} KB)`);
    } catch (error) {
      if (error.code === 'NotFound') {
        console.log(`❌ ${format.name}: NOT FOUND`);
      } else {
        console.log(`❌ ${format.name}: ERROR - ${error.message}`);
      }
    }
  }
}

checkImage().catch(console.error);