/**
 * AWS Lambda Function for Image Processing
 * 
 * Processes uploaded images to generate optimized versions in multiple formats:
 * - AVIF (best compression, newer browsers)
 * - WebP (good compression, wide support)
 * - JPEG (universal fallback)
 * 
 * Also generates multiple size variants for responsive images.
 * 
 * Created by Denisse Maldonado
 * @version 1.0.0
 */

const AWS = require('aws-sdk');
const sharp = require('sharp');

const s3 = new AWS.S3();

// Configuration
const SIZES = {
  thumb: { width: 150, height: 150, fit: 'cover' },
  mobile: { width: 768, height: null, fit: 'inside' },
  desktop: { width: 1920, height: null, fit: 'inside' },
  original: null // Keep original size for format conversion
};

const FORMATS = {
  avif: {
    quality: 85,
    effort: 4, // 0-9, higher = slower but better compression
    chromaSubsampling: '4:4:4'
  },
  webp: {
    quality: 90,
    effort: 4,
    smartSubsample: true
  },
  jpeg: {
    quality: 92,
    progressive: true,
    optimizeScans: true,
    mozjpeg: true
  }
};

// Priority levels for processing
const PROCESSING_PRIORITY = {
  IMMEDIATE: ['jpeg', 'thumb'], // Process immediately for availability
  HIGH: ['webp', 'mobile'],      // Process with high priority
  LOW: ['avif', 'desktop']        // Process in background
};

/**
 * Lambda handler for S3 image upload events
 */
exports.handler = async (event) => {
  console.log('Image processing Lambda triggered', { 
    records: event.Records?.length,
    timestamp: new Date().toISOString()
  });

  const results = [];
  
  for (const record of event.Records) {
    if (record.eventName.startsWith('ObjectCreated:')) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      
      // Skip if already processed (in optimized/ folder)
      if (key.includes('/optimized/') || key.includes('/sizes/')) {
        console.log('Skipping already processed image', { key });
        continue;
      }
      
      // Skip non-original uploads
      if (!key.includes('/originals/') && !key.includes('/vehicles/')) {
        console.log('Skipping non-original image', { key });
        continue;
      }
      
      try {
        const result = await processImage(bucket, key);
        results.push(result);
      } catch (error) {
        console.error('Error processing image', { 
          bucket, 
          key, 
          error: error.message 
        });
        results.push({ 
          success: false, 
          key, 
          error: error.message 
        });
      }
    }
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Image processing completed',
      results
    })
  };
};

/**
 * Process a single image into multiple formats and sizes
 */
async function processImage(bucket, key) {
  console.log('Processing image', { bucket, key });
  
  // Download original image
  const originalImage = await s3.getObject({ 
    Bucket: bucket, 
    Key: key 
  }).promise();
  
  // Get image metadata
  const metadata = await sharp(originalImage.Body).metadata();
  console.log('Image metadata', { 
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    size: originalImage.Body.length
  });
  
  // Extract path components
  const pathParts = key.split('/');
  const fileName = pathParts.pop();
  const fileNameWithoutExt = fileName.split('.').slice(0, -1).join('.');
  const basePath = pathParts.join('/').replace('/originals', '').replace('/vehicles', '/vehicles/originals');
  
  const uploadPromises = [];
  const processedPaths = {};
  
  // Process each size variant
  for (const [sizeName, sizeConfig] of Object.entries(SIZES)) {
    processedPaths[sizeName] = {};
    
    // Process each format for this size
    for (const [format, formatConfig] of Object.entries(FORMATS)) {
      const priority = getPriority(format, sizeName);
      
      // Skip AVIF for thumbnails (not worth the processing time)
      if (format === 'avif' && sizeName === 'thumb') {
        continue;
      }
      
      // Generate optimized image
      const optimizedBuffer = await generateOptimizedImage(
        originalImage.Body,
        format,
        formatConfig,
        sizeConfig
      );
      
      // Construct S3 key for optimized image
      const optimizedKey = constructS3Key(
        basePath,
        fileNameWithoutExt,
        sizeName,
        format
      );
      
      // Upload to S3
      const uploadParams = {
        Bucket: bucket,
        Key: optimizedKey,
        Body: optimizedBuffer,
        ContentType: getContentType(format),
        CacheControl: 'max-age=31536000, immutable', // 1 year cache
        Metadata: {
          originalKey: key,
          format: format,
          size: sizeName,
          processedAt: new Date().toISOString(),
          priority: priority
        }
      };
      
      // Process based on priority
      if (priority === 'IMMEDIATE') {
        // Upload immediately and wait
        await s3.upload(uploadParams).promise();
        console.log('Uploaded immediate priority image', { 
          key: optimizedKey,
          format,
          size: sizeName
        });
      } else {
        // Queue for background upload
        uploadPromises.push(
          s3.upload(uploadParams).promise()
            .then(() => {
              console.log('Uploaded background image', { 
                key: optimizedKey,
                format,
                size: sizeName,
                priority
              });
            })
        );
      }
      
      processedPaths[sizeName][format] = optimizedKey;
    }
  }
  
  // Wait for all background uploads
  await Promise.all(uploadPromises);
  
  // Update metadata in DynamoDB or Parse
  await updateImageMetadata(bucket, key, processedPaths, metadata);
  
  return {
    success: true,
    originalKey: key,
    processedPaths,
    metadata: {
      originalFormat: metadata.format,
      originalWidth: metadata.width,
      originalHeight: metadata.height
    }
  };
}

/**
 * Generate optimized image in specified format and size
 */
async function generateOptimizedImage(inputBuffer, format, formatConfig, sizeConfig) {
  let pipeline = sharp(inputBuffer);
  
  // Apply size transformation if specified
  if (sizeConfig) {
    pipeline = pipeline.resize({
      width: sizeConfig.width,
      height: sizeConfig.height,
      fit: sizeConfig.fit || 'inside',
      withoutEnlargement: true
    });
  }
  
  // Apply format-specific optimization
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
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
  
  return await pipeline.toBuffer();
}

/**
 * Construct S3 key for optimized image
 */
function constructS3Key(basePath, fileName, size, format) {
  // Structure: {env}/optimized/{format}/{size}/vehicles/{vehicleId}/{filename}.{format}
  // Example: prod/optimized/webp/mobile/vehicles/abc123/image.webp
  
  const env = basePath.split('/')[0]; // Extract env prefix (dev/prod)
  const vehiclePath = basePath.replace(env + '/', ''); // Remove env prefix
  
  if (size === 'original') {
    return `${env}/optimized/${format}/${vehiclePath}/${fileName}.${format}`;
  }
  
  return `${env}/optimized/${format}/sizes/${size}/${vehiclePath}/${fileName}.${format}`;
}

/**
 * Get MIME type for format
 */
function getContentType(format) {
  const types = {
    avif: 'image/avif',
    webp: 'image/webp',
    jpeg: 'image/jpeg'
  };
  return types[format] || 'application/octet-stream';
}

/**
 * Get processing priority for format and size combination
 */
function getPriority(format, size) {
  if (format === 'jpeg' || size === 'thumb') {
    return 'IMMEDIATE';
  }
  if (format === 'webp' || size === 'mobile') {
    return 'HIGH';
  }
  return 'LOW';
}

/**
 * Update image metadata in database with processed paths
 */
async function updateImageMetadata(bucket, originalKey, processedPaths, imageMetadata) {
  // This would typically update DynamoDB or trigger a Parse Cloud function
  // For now, we'll store metadata in S3 as a JSON file
  
  const metadataKey = originalKey.replace(/\.[^/.]+$/, '.metadata.json');
  const metadataContent = {
    originalKey,
    processedAt: new Date().toISOString(),
    originalMetadata: {
      format: imageMetadata.format,
      width: imageMetadata.width,
      height: imageMetadata.height,
      space: imageMetadata.space,
      channels: imageMetadata.channels,
      depth: imageMetadata.depth,
      density: imageMetadata.density,
      hasAlpha: imageMetadata.hasAlpha
    },
    processedPaths,
    bucket
  };
  
  await s3.putObject({
    Bucket: bucket,
    Key: metadataKey,
    Body: JSON.stringify(metadataContent, null, 2),
    ContentType: 'application/json',
    Metadata: {
      type: 'image-processing-metadata'
    }
  }).promise();
  
  console.log('Metadata updated', { metadataKey });
}