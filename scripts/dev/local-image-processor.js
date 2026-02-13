#!/usr/bin/env node

/**
 * Local Image Processor for Development
 * 
 * Simulates AWS Lambda image processing locally for testing
 * Processes images into AVIF, WebP, and JPEG formats
 * 
 * Usage: node scripts/dev/local-image-processor.js [image-path]
 * 
 * Created by Denisse Maldonado
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');

// Configuration
const CONFIG = {
  watchFolder: process.env.WATCH_FOLDER || 'uploads/vehicles',
  outputFolder: process.env.OUTPUT_FOLDER || 'public/optimized',
  formats: {
    avif: { quality: 85, effort: 4 },
    webp: { quality: 90, effort: 4 },
    jpeg: { quality: 92, progressive: true, mozjpeg: true }
  },
  sizes: {
    thumb: { width: 150, height: 150, fit: 'cover' },
    mobile: { width: 768, height: null, fit: 'inside' },
    desktop: { width: 1920, height: null, fit: 'inside' },
    original: null
  }
};

/**
 * Process a single image
 */
async function processImage(inputPath) {
  console.log(`📸 Processing image: ${inputPath}`);
  const startTime = Date.now();

  try {
    // Read image
    const imageBuffer = await fs.readFile(inputPath);
    const metadata = await sharp(imageBuffer).metadata();
    
    console.log(`  Original: ${metadata.width}x${metadata.height}, ${metadata.format}`);

    const fileName = path.basename(inputPath, path.extname(inputPath));
    const outputBase = path.join(CONFIG.outputFolder, fileName);

    // Ensure output directories exist
    await ensureDirectories(outputBase);

    const results = {
      original: inputPath,
      formats: {},
      sizes: {},
      timings: {}
    };

    // Process each format and size combination
    for (const [formatName, formatConfig] of Object.entries(CONFIG.formats)) {
      results.formats[formatName] = {};
      
      for (const [sizeName, sizeConfig] of Object.entries(CONFIG.sizes)) {
        const formatStart = Date.now();
        
        try {
          const outputPath = await processVariant(
            imageBuffer,
            formatName,
            formatConfig,
            sizeName,
            sizeConfig,
            outputBase
          );
          
          const stats = await fs.stat(outputPath);
          const timeTaken = Date.now() - formatStart;
          
          results.formats[formatName][sizeName] = {
            path: outputPath,
            size: stats.size,
            time: timeTaken
          };
          
          console.log(`  ✓ ${formatName}/${sizeName}: ${formatBytes(stats.size)} (${timeTaken}ms)`);
        } catch (error) {
          console.error(`  ✗ ${formatName}/${sizeName}: ${error.message}`);
        }
      }
    }

    const totalTime = Date.now() - startTime;
    results.totalTime = totalTime;

    console.log(`✅ Completed in ${totalTime}ms`);
    
    // Generate HTML preview
    await generatePreview(fileName, results);
    
    return results;
  } catch (error) {
    console.error(`❌ Error processing ${inputPath}:`, error);
    throw error;
  }
}

/**
 * Process a single variant
 */
async function processVariant(imageBuffer, format, formatConfig, size, sizeConfig, outputBase) {
  let pipeline = sharp(imageBuffer);

  // Apply size transformation
  if (sizeConfig) {
    pipeline = pipeline.resize({
      width: sizeConfig.width,
      height: sizeConfig.height,
      fit: sizeConfig.fit || 'inside',
      withoutEnlargement: true
    });
  }

  // Apply format
  switch (format) {
    case 'avif':
      pipeline = pipeline.avif(formatConfig);
      break;
    case 'webp':
      pipeline = pipeline.webp(formatConfig);
      break;
    case 'jpeg':
      pipeline = pipeline.jpeg(formatConfig);
      break;
  }

  // Generate output path
  const outputDir = path.join(CONFIG.outputFolder, format, size === 'original' ? '' : 'sizes', size || '');
  await fs.mkdir(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, `${path.basename(outputBase)}.${format}`);
  
  // Save
  await pipeline.toFile(outputPath);
  
  return outputPath;
}

/**
 * Generate HTML preview page
 */
async function generatePreview(fileName, results) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Image Optimization Preview - ${fileName}</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .card h3 {
      margin-top: 0;
      color: #666;
      font-size: 14px;
      text-transform: uppercase;
    }
    .image-container {
      position: relative;
      background: #f0f0f0;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .image-container img {
      width: 100%;
      height: auto;
      display: block;
    }
    .stats {
      font-size: 12px;
      color: #888;
      line-height: 1.6;
    }
    .stats strong {
      color: #333;
    }
    .picture-demo {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .picture-demo h2 {
      margin-top: 0;
      color: #333;
    }
    .code {
      background: #f4f4f4;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 15px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      overflow-x: auto;
    }
    .metrics {
      display: flex;
      gap: 20px;
      margin: 20px 0;
    }
    .metric {
      flex: 1;
      background: white;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #4CAF50;
    }
    .metric-label {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <h1>🖼️ Image Optimization Preview</h1>
  <p>File: <strong>${fileName}</strong> | Processed: ${new Date().toLocaleString()}</p>
  
  <div class="metrics">
    <div class="metric">
      <div class="metric-value">${results.totalTime}ms</div>
      <div class="metric-label">Total Processing Time</div>
    </div>
    <div class="metric">
      <div class="metric-value">${Object.keys(results.formats).length}</div>
      <div class="metric-label">Formats Generated</div>
    </div>
    <div class="metric">
      <div class="metric-value">${Object.keys(CONFIG.sizes).length}</div>
      <div class="metric-label">Size Variants</div>
    </div>
  </div>

  <div class="picture-demo">
    <h2>Picture Element Implementation</h2>
    <picture>
      ${results.formats.avif ? `<source type="image/avif" srcset="/optimized/avif/${fileName}.avif">` : ''}
      ${results.formats.webp ? `<source type="image/webp" srcset="/optimized/webp/${fileName}.webp">` : ''}
      <img src="/optimized/jpeg/${fileName}.jpeg" alt="${fileName}">
    </picture>
    
    <h3>HTML Code:</h3>
    <div class="code">
&lt;picture&gt;
  &lt;source type="image/avif" srcset="/optimized/avif/${fileName}.avif"&gt;
  &lt;source type="image/webp" srcset="/optimized/webp/${fileName}.webp"&gt;
  &lt;img src="/optimized/jpeg/${fileName}.jpeg" alt="${fileName}"&gt;
&lt;/picture&gt;
    </div>
  </div>

  <h2>Format Comparison</h2>
  <div class="grid">
    ${Object.entries(results.formats).map(([format, sizes]) => {
      const original = sizes.original || sizes.desktop || Object.values(sizes)[0];
      if (!original) return '';
      
      const jpegSize = results.formats.jpeg?.original?.size || 100000;
      const savings = Math.round((1 - original.size / jpegSize) * 100);
      
      return `
        <div class="card">
          <h3>${format.toUpperCase()}</h3>
          <div class="image-container">
            <img src="/${path.relative('public', original.path)}" alt="${format}">
          </div>
          <div class="stats">
            <strong>Size:</strong> ${formatBytes(original.size)}<br>
            <strong>Time:</strong> ${original.time}ms<br>
            <strong>Savings:</strong> ${savings}% vs JPEG
          </div>
        </div>
      `;
    }).join('')}
  </div>

  <h2>Size Variants</h2>
  <div class="grid">
    ${Object.entries(CONFIG.sizes).map(sizeName => {
      const webpVariant = results.formats.webp?.[sizeName];
      if (!webpVariant) return '';
      
      return `
        <div class="card">
          <h3>${sizeName.toUpperCase()}</h3>
          <div class="image-container">
            <img src="/${path.relative('public', webpVariant.path)}" alt="${sizeName}">
          </div>
          <div class="stats">
            <strong>Size:</strong> ${formatBytes(webpVariant.size)}<br>
            <strong>Dimensions:</strong> ${CONFIG.sizes[sizeName]?.width || 'auto'} x ${CONFIG.sizes[sizeName]?.height || 'auto'}
          </div>
        </div>
      `;
    }).join('')}
  </div>

  <script>
    // Test browser format support
    const formats = {
      avif: new Image(),
      webp: new Image()
    };
    
    formats.avif.onload = () => console.log('✅ Browser supports AVIF');
    formats.avif.onerror = () => console.log('❌ Browser does not support AVIF');
    formats.avif.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMgwf8AAAWAAAAACvJ+o=';
    
    formats.webp.onload = () => console.log('✅ Browser supports WebP');
    formats.webp.onerror = () => console.log('❌ Browser does not support WebP');
    formats.webp.src = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  </script>
</body>
</html>`;

  const previewPath = path.join(CONFIG.outputFolder, `${fileName}-preview.html`);
  await fs.writeFile(previewPath, html);
  console.log(`📄 Preview generated: ${previewPath}`);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Ensure output directories exist
 */
async function ensureDirectories(outputBase) {
  for (const format of Object.keys(CONFIG.formats)) {
    for (const size of Object.keys(CONFIG.sizes)) {
      const dir = path.join(CONFIG.outputFolder, format, size === 'original' ? '' : 'sizes', size || '');
      await fs.mkdir(dir, { recursive: true });
    }
  }
}

/**
 * Watch mode for development
 */
async function watchMode() {
  console.log(`👁️  Watching for images in: ${CONFIG.watchFolder}`);
  console.log(`📁 Output folder: ${CONFIG.outputFolder}`);
  console.log('');

  const watcher = chokidar.watch(CONFIG.watchFolder, {
    ignored: /(^|[\/\\])\../, // Ignore dotfiles
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  watcher
    .on('add', async (filePath) => {
      if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
        console.log(`\n🆕 New image detected: ${filePath}`);
        try {
          await processImage(filePath);
        } catch (error) {
          console.error('Processing failed:', error);
        }
      }
    })
    .on('change', async (filePath) => {
      if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
        console.log(`\n🔄 Image changed: ${filePath}`);
        try {
          await processImage(filePath);
        } catch (error) {
          console.error('Processing failed:', error);
        }
      }
    })
    .on('error', error => console.error('Watcher error:', error));

  console.log('Press Ctrl+C to stop watching\n');
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  // Check if sharp is installed
  try {
    require('sharp');
  } catch (error) {
    console.error('❌ Sharp is not installed. Please run: npm install sharp');
    process.exit(1);
  }

  // Check if chokidar is installed for watch mode
  try {
    require('chokidar');
  } catch (error) {
    console.error('❌ Chokidar is not installed. Please run: npm install chokidar');
    process.exit(1);
  }

  if (args.length === 0 || args[0] === '--watch') {
    // Watch mode
    await watchMode();
  } else {
    // Process single image
    const imagePath = args[0];
    
    if (!await fs.stat(imagePath).catch(() => false)) {
      console.error(`❌ File not found: ${imagePath}`);
      process.exit(1);
    }

    await processImage(imagePath);
    console.log('\n✨ Done! Open the preview HTML file to see results.');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { processImage, CONFIG };