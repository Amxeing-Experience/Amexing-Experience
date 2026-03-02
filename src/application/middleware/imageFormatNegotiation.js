/**
 * Image Format Negotiation Middleware.
 *
 * Server-side format selection based on Accept headers
 * Alternative to CloudFront for automatic format negotiation.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const path = require('path');
const logger = require('../../infrastructure/logger');

// Lazy load AWS SDK only when needed
let AWS;
let s3;

/**
 * Check if request is for an image.
 * @param {string} imagePath - Request path to check.
 * @returns {boolean} True if path is for an image.
 * @example
 */
function isImageRequest(imagePath) {
  const imageExtensions = /\.(jpg|jpeg|png|webp|avif|gif)$/i;
  return imageExtensions.test(imagePath);
}

/**
 * Detect preferred format from Accept header and User-Agent.
 * @param {string} acceptHeader - Accept header value.
 * @param {string} userAgent - User-Agent header value.
 * @returns {string} Preferred format (avif, webp, or jpeg).
 * @example
 */
function detectPreferredFormat(acceptHeader, userAgent = '') {
  // First, check if Accept header explicitly mentions formats
  if (acceptHeader && acceptHeader.includes('image/avif')) {
    return 'avif';
  }
  if (acceptHeader && acceptHeader.includes('image/webp')) {
    return 'webp';
  }

  // If Accept header is generic (*/* or image/*), detect from User-Agent
  if (!acceptHeader || acceptHeader.includes('*/*') || acceptHeader === 'image/*') {
    // Modern browsers that support AVIF (Chrome 85+, Firefox 93+, Safari 16+)
    if (userAgent) {
      // Chrome 85+ supports AVIF
      const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
      if (chromeMatch && parseInt(chromeMatch[1], 10) >= 85) {
        return 'avif';
      }

      // Firefox 93+ supports AVIF
      const firefoxMatch = userAgent.match(/Firefox\/(\d+)/);
      if (firefoxMatch && parseInt(firefoxMatch[1], 10) >= 93) {
        return 'avif';
      }

      // Safari 16+ supports AVIF
      const safariMatch = userAgent.match(/Version\/(\d+).*Safari/);
      if (safariMatch && parseInt(safariMatch[1]) >= 16) {
        return 'avif';
      }

      // Edge 85+ supports AVIF
      const edgeMatch = userAgent.match(/Edg\/(\d+)/);
      if (edgeMatch && parseInt(edgeMatch[1]) >= 85) {
        return 'avif';
      }

      // If not AVIF-capable, check for WebP support (much broader)
      // Chrome 9+, Firefox 65+, Safari 14+, Edge 18+
      if (userAgent.includes('Chrome')
          || userAgent.includes('Firefox')
          || userAgent.includes('Safari')
          || userAgent.includes('Edge')
          || userAgent.includes('Edg/')) {
        return 'webp';
      }
    }
  }

  return 'jpeg';
}

/**
 * Initialize AWS SDK if not already loaded.
 * @returns {boolean} True if AWS is available.
 * @example
 */
function initializeAWS() {
  if (!AWS) {
    try {
      AWS = require('aws-sdk');
      s3 = new AWS.S3();
    } catch (error) {
      logger.warn('AWS SDK not available, S3 features disabled', { error: error.message });
      return false;
    }
  }
  return true;
}

/**
 * Find optimized image in S3.
 * @param {string} originalPath - Original image path.
 * @param {string} format - Target format (avif, webp, jpeg).
 * @param {string} bucket - S3 bucket name.
 * @returns {Promise<string|null>} S3 key for optimized image or null.
 * @example
 */
async function findOptimizedImage(originalPath, format, bucket) {
  try {
    // Initialize AWS if needed
    if (!initializeAWS()) {
      return null;
    }
    // Parse the original path
    const pathParts = path.parse(originalPath);
    const { dir } = pathParts;
    const { name } = pathParts;

    // Construct optimized path
    // Transform: vehicles/abc123/image.jpg
    // To: optimized/webp/vehicles/abc123/image.webp
    const optimizedKey = `optimized/${format}/${dir}/${name}.${format}`;

    // Check if object exists in S3
    await s3
      .headObject({
        Bucket: bucket,
        Key: optimizedKey,
      })
      .promise();

    return optimizedKey;
  } catch (error) {
    // Object doesn't exist, return null
    return null;
  }
}

/**
 * Get content type for format.
 * @param {string} format - Image format.
 * @returns {string} MIME content type.
 * @example
 */
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

/**
 * Serve optimized image from S3.
 * @param {object} res - Express response object.
 * @param {string} s3Key - S3 object key.
 * @param {string} bucket - S3 bucket name.
 * @param {object} options - Serving options.
 * @returns {Promise<void>} Resolves when image is sent.
 * @example
 */
async function serveOptimizedImage(res, s3Key, bucket, options) {
  try {
    // Initialize AWS if needed
    if (!initializeAWS()) {
      throw new Error('AWS SDK not available');
    }
    // Get image from S3
    const s3Object = await s3
      .getObject({
        Bucket: bucket,
        Key: s3Key,
      })
      .promise();

    // Set appropriate headers
    res.set({
      'Content-Type': getContentType(options.format),
      'Cache-Control': options.cacheControl,
      'Content-Length': s3Object.ContentLength,
      ETag: s3Object.ETag,
      'Last-Modified': s3Object.LastModified,
      Vary: 'Accept', // Important for CDN caching
      'X-Optimized-Format': options.format,
    });

    // Send image data
    res.send(s3Object.Body);
  } catch (error) {
    throw new Error(`Failed to serve image: ${error.message}`);
  }
}

/**
 * Middleware to handle image format negotiation
 * Intercepts image requests and serves the best format.
 * @param {object} options - Configuration options.
 * @returns {Function} Express middleware function.
 * @example
 */
function imageFormatNegotiation(options = {}) {
  const {
    bucket = process.env.S3_BUCKET,
    region = process.env.AWS_REGION || 'us-east-2',
    cacheControl = 'public, max-age=31536000, immutable',
    enableLogging = true,
  } = options;

  return async (req, res, next) => {
    // Only handle image requests
    if (!isImageRequest(req.path)) {
      return next();
    }

    try {
      // Extract Accept header
      const acceptHeader = req.get('accept') || '';

      // Detect preferred format
      const preferredFormat = detectPreferredFormat(acceptHeader);

      // Get original image path
      const originalPath = req.path.replace(/^\/images\//, '');

      // Check if optimized version exists
      const optimizedPath = await findOptimizedImage(originalPath, preferredFormat, bucket);

      if (optimizedPath) {
        // Serve optimized image
        await serveOptimizedImage(res, optimizedPath, bucket, {
          format: preferredFormat,
          cacheControl,
          region,
        });

        if (enableLogging) {
          logger.info('Served optimized image', {
            original: originalPath,
            optimized: optimizedPath,
            format: preferredFormat,
            acceptHeader,
          });
        }
      } else {
        // Fallback to original or next middleware
        next();
      }
    } catch (error) {
      logger.error('Image format negotiation error', {
        error: error.message,
        path: req.path,
      });
      next();
    }
  };
}

/**
 * Express route handler for dynamic image optimization
 * Can be used instead of or alongside the middleware.
 * @param req
 * @param res
 * @example
 */
async function serveOptimizedImageRoute(req, res) {
  try {
    // Initialize AWS if needed
    if (!initializeAWS()) {
      return res.status(503).json({
        success: false,
        error: 'Image optimization service not available',
      });
    }

    const { vehicleId, imageName } = req.params;
    const acceptHeader = req.get('accept') || '';
    const userAgent = req.get('user-agent') || '';
    const preferredFormat = detectPreferredFormat(acceptHeader, userAgent);

    // Look up the vehicle image from the database to get stored S3 keys
    let Parse;
    try {
      Parse = require('parse/node');
    } catch (error) {
      throw new Error('Parse SDK not available');
    }

    // Find the vehicle image by vehicle and filename
    const imageQuery = new Parse.Query('VehicleImage');
    const vehiclePointer = {
      __type: 'Pointer',
      className: 'Vehicle',
      objectId: vehicleId,
    };
    imageQuery.equalTo('vehicleId', vehiclePointer);

    // Match by filename (try both with and without extension)
    // Escape special regex characters in imageName for safe regex matching
    const escapedImageName = imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const orQuery = Parse.Query.or(
      // eslint-disable-next-line security/detect-non-literal-regexp
      new Parse.Query('VehicleImage').matches('fileName', new RegExp(`^${escapedImageName}\\.[^.]+$`, 'i')),
      new Parse.Query('VehicleImage').equalTo('fileName', imageName),
      new Parse.Query('VehicleImage').equalTo('fileName', `${imageName}.jpg`),
      new Parse.Query('VehicleImage').equalTo('fileName', `${imageName}.jpeg`),
      new Parse.Query('VehicleImage').equalTo('fileName', `${imageName}.png`),
      new Parse.Query('VehicleImage').equalTo('fileName', `${imageName}.webp`),
      new Parse.Query('VehicleImage').equalTo('fileName', `${imageName}.avif`)
    );

    const combinedQuery = Parse.Query.and(imageQuery, orQuery);
    combinedQuery.exists('optimizedVariants');

    const vehicleImages = await combinedQuery.find({ useMasterKey: true });

    if (vehicleImages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vehicle image not found in database',
      });
    }

    const vehicleImage = vehicleImages[0];
    const optimizedVariants = vehicleImage.get('optimizedVariants');

    if (!optimizedVariants) {
      return res.status(404).json({
        success: false,
        error: 'No optimized variants available for this image',
      });
    }

    // Build format preference order based on Accept header
    let formatOrder;
    if (preferredFormat === 'avif') {
      formatOrder = ['avif', 'webp', 'jpeg', 'original'];
    } else if (preferredFormat === 'webp') {
      formatOrder = ['webp', 'jpeg', 'original'];
    } else {
      formatOrder = ['jpeg', 'original'];
    }

    // Try each format in order of preference
    for (const format of formatOrder) {
      const variant = optimizedVariants[format];
      if (variant) {
        // Handle nested structure with size variants (thumb, mobile, desktop, original)
        let s3Key;
        if (variant.original && variant.original.s3Key) {
          // New structure with size variants
          ({ s3Key } = variant.original);
        } else if (variant.s3Key) {
          // Old structure with direct s3Key
          ({ s3Key } = variant);
        }

        if (s3Key) {
          try {
            const s3Object = await s3
              .getObject({
                Bucket: process.env.S3_BUCKET,
                Key: s3Key,
              })
              .promise();

            res.set({
              'Content-Type': getContentType(format),
              'Cache-Control': 'public, max-age=31536000, immutable',
              Vary: 'Accept',
              'X-Served-Format': format,
              'X-Original-Format': preferredFormat,
              'X-S3-Key': s3Key,
            });

            logger.info('Served optimized vehicle image', {
              vehicleId,
              imageName,
              servedFormat: format,
              preferredFormat,
              s3Key,
              acceptHeader,
              userAgent: userAgent.substring(0, 100), // Truncate for logs
            });

            return res.send(s3Object.Body);
          } catch (s3Error) {
            logger.warn('Failed to fetch variant from S3, trying next format', {
              format,
              s3Key,
              error: s3Error.message,
            });
            // Continue to next format
          }
        }
      }
    }

    // No format could be served
    logger.error('No optimized variants could be served', {
      vehicleId,
      imageName,
      availableVariants: Object.keys(optimizedVariants),
      preferredFormat,
    });

    res.status(404).json({
      success: false,
      error: 'Image variants not found in S3',
    });
  } catch (error) {
    logger.error('Failed to serve optimized image', {
      error: error.message,
      stack: error.stack,
      vehicleId: req.params.vehicleId,
      imageName: req.params.imageName,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to load image',
    });
  }
}

module.exports = {
  imageFormatNegotiation,
  serveOptimizedImageRoute,
  detectPreferredFormat,
  getContentType,
};
