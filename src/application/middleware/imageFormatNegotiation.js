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
 * Detect preferred format from Accept header.
 * @param {string} acceptHeader - Accept header value.
 * @returns {string} Preferred format (avif, webp, or jpeg).
 * @example
 */
function detectPreferredFormat(acceptHeader) {
  if (acceptHeader.includes('image/avif')) {
    return 'avif';
  }
  if (acceptHeader.includes('image/webp')) {
    return 'webp';
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
    const format = detectPreferredFormat(acceptHeader);

    // Construct S3 keys for different formats
    const keys = {
      avif: `optimized/avif/vehicles/${vehicleId}/${imageName}.avif`,
      webp: `optimized/webp/vehicles/${vehicleId}/${imageName}.webp`,
      jpeg: `optimized/jpeg/vehicles/${vehicleId}/${imageName}.jpg`,
      original: `vehicles/${vehicleId}/${imageName}.jpg`,
    };

    // Try to serve in order of preference
    let formats;
    if (format === 'avif') {
      formats = ['avif', 'webp', 'jpeg', 'original'];
    } else if (format === 'webp') {
      formats = ['webp', 'jpeg', 'original'];
    } else {
      formats = ['jpeg', 'original'];
    }

    for (const fmt of formats) {
      try {
        const s3Object = await s3
          .getObject({
            Bucket: process.env.S3_BUCKET,
            Key: keys[fmt],
          })
          .promise();

        res.set({
          'Content-Type': getContentType(fmt),
          'Cache-Control': 'public, max-age=31536000',
          Vary: 'Accept',
          'X-Served-Format': fmt,
        });

        return res.send(s3Object.Body);
      } catch (error) {
        // Try next format
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    // No format found
    res.status(404).json({
      success: false,
      error: 'Image not found',
    });
  } catch (error) {
    logger.error('Failed to serve optimized image', {
      error: error.message,
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
