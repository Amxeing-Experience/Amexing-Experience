#!/usr/bin/env node

/**
 * Quick Image Upload Test for Localhost
 * Simple script to test image optimization locally
 * 
 * Usage: node scripts/quick-image-test.js [image-path]
 * 
 * Created by Denisse Maldonado
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

async function testImage(imagePath) {
  console.log('🖼️  Testing Image Optimization\n');
  
  // If no image provided, create a test one
  if (!imagePath) {
    console.log('Creating test image...');
    imagePath = 'test-image.jpg';
    
    await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: { r: 255, g: 100, b: 50 }
      },
      text: {
        text: 'Test Vehicle Image',
        font: 'sans',
        dpi: 72,
        rgba: true
      }
    })
    .jpeg({ quality: 90 })
    .toFile(imagePath);
    
    console.log('✅ Test image created: test-image.jpg\n');
  }
  
  // Read the image
  const buffer = await fs.readFile(imagePath);
  const metadata = await sharp(buffer).metadata();
  const originalSize = buffer.length;
  
  console.log('📊 Original Image:');
  console.log(`   Size: ${(originalSize / 1024).toFixed(2)} KB`);
  console.log(`   Dimensions: ${metadata.width}x${metadata.height}`);
  console.log(`   Format: ${metadata.format}\n`);
  
  // Process formats
  console.log('🔄 Processing Formats:\n');
  
  // AVIF
  console.log('Processing AVIF...');
  const avifStart = Date.now();
  const avif = await sharp(buffer).avif({ quality: 85 }).toBuffer();
  const avifTime = Date.now() - avifStart;
  const avifReduction = ((1 - avif.length / originalSize) * 100).toFixed(1);
  console.log(`✅ AVIF: ${(avif.length / 1024).toFixed(2)} KB (${avifReduction}% smaller, ${avifTime}ms)\n`);
  
  // WebP
  console.log('Processing WebP...');
  const webpStart = Date.now();
  const webp = await sharp(buffer).webp({ quality: 90 }).toBuffer();
  const webpTime = Date.now() - webpStart;
  const webpReduction = ((1 - webp.length / originalSize) * 100).toFixed(1);
  console.log(`✅ WebP: ${(webp.length / 1024).toFixed(2)} KB (${webpReduction}% smaller, ${webpTime}ms)\n`);
  
  // Optimized JPEG
  console.log('Processing optimized JPEG...');
  const jpegStart = Date.now();
  const jpeg = await sharp(buffer).jpeg({ quality: 92, progressive: true }).toBuffer();
  const jpegTime = Date.now() - jpegStart;
  const jpegReduction = ((1 - jpeg.length / originalSize) * 100).toFixed(1);
  console.log(`✅ JPEG: ${(jpeg.length / 1024).toFixed(2)} KB (${jpegReduction}% smaller, ${jpegTime}ms)\n`);
  
  // Save outputs
  console.log('💾 Saving optimized versions...');
  const baseName = path.basename(imagePath, path.extname(imagePath));
  
  await fs.mkdir('test-optimized', { recursive: true });
  await fs.writeFile(`test-optimized/${baseName}.avif`, avif);
  await fs.writeFile(`test-optimized/${baseName}.webp`, webp);
  await fs.writeFile(`test-optimized/${baseName}-optimized.jpg`, jpeg);
  
  console.log('✅ Saved to test-optimized/ folder\n');
  
  // Generate HTML preview
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Image Optimization Test</title>
  <style>
    body { font-family: Arial; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { border: 1px solid #ddd; padding: 10px; border-radius: 8px; }
    img { width: 100%; height: auto; }
    .stats { font-size: 12px; color: #666; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>Image Optimization Results</h1>
  
  <div class="grid">
    <div class="card">
      <h3>Original JPEG</h3>
      <img src="../${imagePath}" alt="Original">
      <div class="stats">Size: ${(originalSize / 1024).toFixed(2)} KB</div>
    </div>
    
    <div class="card">
      <h3>AVIF (${avifReduction}% smaller)</h3>
      <img src="${baseName}.avif" alt="AVIF">
      <div class="stats">Size: ${(avif.length / 1024).toFixed(2)} KB</div>
    </div>
    
    <div class="card">
      <h3>WebP (${webpReduction}% smaller)</h3>
      <img src="${baseName}.webp" alt="WebP">
      <div class="stats">Size: ${(webp.length / 1024).toFixed(2)} KB</div>
    </div>
    
    <div class="card">
      <h3>Optimized JPEG (${jpegReduction}% smaller)</h3>
      <img src="${baseName}-optimized.jpg" alt="Optimized JPEG">
      <div class="stats">Size: ${(jpeg.length / 1024).toFixed(2)} KB</div>
    </div>
  </div>
  
  <h2>Summary</h2>
  <ul>
    <li>AVIF: ${avifReduction}% size reduction (best compression)</li>
    <li>WebP: ${webpReduction}% size reduction (good balance)</li>
    <li>JPEG: ${jpegReduction}% size reduction (universal support)</li>
  </ul>
  
  <h2>Processing Times</h2>
  <ul>
    <li>AVIF: ${avifTime}ms</li>
    <li>WebP: ${webpTime}ms</li>
    <li>JPEG: ${jpegTime}ms</li>
  </ul>
</body>
</html>`;
  
  await fs.writeFile('test-optimized/preview.html', html);
  console.log('🌐 Preview page created: test-optimized/preview.html\n');
  
  console.log('✨ Test Complete!\n');
  console.log('View results:');
  console.log('  1. Check test-optimized/ folder for files');
  console.log('  2. Open test-optimized/preview.html in browser\n');
}

// Run test
const imagePath = process.argv[2];
testImage(imagePath).catch(console.error);