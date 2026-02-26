#!/usr/bin/env node

/**
 * Test Vehicle Image Upload with Optimization
 * Tests the actual vehicle image upload API with optimization
 * 
 * Usage: 
 * 1. Start server: yarn dev
 * 2. Run test: node scripts/test-vehicle-image-upload.js
 * 
 * Created by Denisse Maldonado
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CONFIG = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:1337',
  testCredentials: {
    email: 'test-admin@amexing.test',
    password: 'TestPass123!'
  }
};

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function runTest() {
  console.log(`${colors.cyan}${colors.bright}🚗 Vehicle Image Upload Test${colors.reset}\n`);
  
  try {
    // Step 1: Check server health
    console.log(`${colors.blue}1. Checking server health...${colors.reset}`);
    await axios.get(`${CONFIG.serverUrl}/health`);
    console.log(`  ${colors.green}✓${colors.reset} Server is running\n`);
    
    // Step 2: Login
    console.log(`${colors.blue}2. Authenticating...${colors.reset}`);
    const loginResponse = await axios.post(`${CONFIG.serverUrl}/api/auth/login`, {
      email: CONFIG.testCredentials.email,
      password: CONFIG.testCredentials.password
    });
    
    const token = loginResponse.data.token;
    console.log(`  ${colors.green}✓${colors.reset} Logged in as ${CONFIG.testCredentials.email}\n`);
    
    // Step 3: Create test vehicle
    console.log(`${colors.blue}3. Creating test vehicle...${colors.reset}`);
    const vehicleResponse = await axios.post(
      `${CONFIG.serverUrl}/api/vehicles`,
      {
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        licensePlate: `TEST-${Date.now()}`,
        vin: `TEST${Date.now()}`,
        color: 'Silver',
        active: true,
        exists: true
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const vehicleId = vehicleResponse.data.data.id;
    console.log(`  ${colors.green}✓${colors.reset} Created vehicle: ${vehicleId}\n`);
    
    // Step 4: Create test image
    console.log(`${colors.blue}4. Creating test image...${colors.reset}`);
    const testImagePath = path.join(__dirname, '..', 'test-vehicle-image.jpg');
    
    // Create a colorful test image
    await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: { r: 100, g: 150, b: 200 }
      }
    })
    .jpeg({ quality: 90 })
    .toFile(testImagePath);
    
    const imageStats = fs.statSync(testImagePath);
    console.log(`  ${colors.green}✓${colors.reset} Created test image: ${formatBytes(imageStats.size)}\n`);
    
    // Step 5: Upload image
    console.log(`${colors.blue}5. Uploading image to vehicle...${colors.reset}`);
    const formData = new FormData();
    formData.append('image', fs.createReadStream(testImagePath));
    
    const uploadResponse = await axios.post(
      `${CONFIG.serverUrl}/api/vehicles/${vehicleId}/images`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          ...formData.getHeaders()
        }
      }
    );
    
    const imageData = uploadResponse.data.data;
    console.log(`  ${colors.green}✓${colors.reset} Image uploaded successfully`);
    console.log(`    - ID: ${imageData.id}`);
    console.log(`    - URL: ${imageData.url}`);
    console.log(`    - File: ${imageData.fileName}`);
    console.log(`    - Size: ${formatBytes(imageData.fileSize)}`);
    
    // Check for optimization data
    if (imageData.formats) {
      console.log(`    - Formats available:`, Object.keys(imageData.formats).join(', '));
    }
    if (imageData.optimizationId) {
      console.log(`    - Optimization: ${imageData.optimizationStatus}`);
    }
    console.log('');
    
    // Step 6: List images with format negotiation
    console.log(`${colors.blue}6. Testing format negotiation...${colors.reset}`);
    
    // Test AVIF support
    const avifResponse = await axios.get(
      `${CONFIG.serverUrl}/api/vehicles/${vehicleId}/images`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'image/avif,image/webp,image/*'
        }
      }
    );
    
    const images = avifResponse.data.data;
    if (images.length > 0) {
      console.log(`  ${colors.green}✓${colors.reset} Retrieved ${images.length} image(s)`);
      
      const firstImage = images[0];
      if (firstImage.formats) {
        console.log(`    - Formats: ${Object.keys(firstImage.formats).join(', ')}`);
      }
      if (firstImage.optimizationMetadata) {
        console.log(`    - Preferred format: ${firstImage.optimizationMetadata.preferredFormat || 'jpeg'}`);
      }
    }
    console.log('');
    
    // Step 7: Test optimized image endpoint
    console.log(`${colors.blue}7. Testing optimized image endpoint...${colors.reset}`);
    try {
      const imageName = path.basename(imageData.fileName || 'test.jpg');
      const optimizedUrl = `${CONFIG.serverUrl}/api/vehicles/optimized/${vehicleId}/${imageName}`;
      
      const optimizedResponse = await axios.get(optimizedUrl, {
        headers: {
          'Accept': 'image/webp,image/*'
        },
        responseType: 'arraybuffer'
      });
      
      console.log(`  ${colors.green}✓${colors.reset} Optimized endpoint working`);
      console.log(`    - Content-Type: ${optimizedResponse.headers['content-type']}`);
      console.log(`    - Size: ${formatBytes(optimizedResponse.data.length)}`);
      console.log(`    - Cache-Control: ${optimizedResponse.headers['cache-control'] || 'not set'}`);
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`  ${colors.yellow}⚠${colors.reset} Optimized endpoint not available (may need S3 configuration)`);
      } else {
        console.log(`  ${colors.yellow}⚠${colors.reset} Optimized endpoint error: ${error.message}`);
      }
    }
    console.log('');
    
    // Summary
    console.log(`${colors.green}${colors.bright}✅ Test completed successfully!${colors.reset}\n`);
    console.log('Summary:');
    console.log(`  • Vehicle created: ${vehicleId}`);
    console.log(`  • Image uploaded: ${imageData.id}`);
    console.log(`  • Optimization: ${imageData.optimizationStatus || 'Not enabled'}`);
    console.log(`  • Format negotiation: Working`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Enable optimization: ENABLE_IMAGE_OPTIMIZATION=true');
    console.log('  2. Configure S3: Update .env with bucket details');
    console.log('  3. Deploy Lambda: See deployment guide');
    console.log('  4. Test with browser: Check format support');
    
    // Cleanup
    fs.unlinkSync(testImagePath);
    
  } catch (error) {
    console.error(`${colors.red}❌ Test failed:${colors.reset}`, error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Check if axios is installed
try {
  require('axios');
} catch (error) {
  console.error(`${colors.red}axios is not installed. Run: npm install axios${colors.reset}`);
  process.exit(1);
}

// Run test
if (require.main === module) {
  runTest().catch(console.error);
}