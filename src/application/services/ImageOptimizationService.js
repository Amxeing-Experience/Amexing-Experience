/**
 * ImageOptimizationService - Enhanced image storage with multi-format support.
 *
 * Extends FileStorageService to handle optimized image formats:
 * - Automatic format detection based on Accept headers
 * - Multi-format URL generation (AVIF, WebP, JPEG)
 * - Size variant support (thumbnail, mobile, desktop)
 * - CloudFront integration for optimal delivery
 * - Fallback chain for browser compatibility.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const Parse = require('parse/node');
const FileStorageService = require('./FileStorageService');
const logger = require('../../infrastructure/logger');

class ImageOptimizationService extends FileStorageService {
  constructor(config = {}) {
    super(config);

    // Image optimization specific config
    this.enableOptimization = config.enableOptimization !== false;
    this.cdnDomain = process.env.CDN_DOMAIN; // Generic CDN domain (optional)
    this.useDirectS3 = process.env.USE_DIRECT_S3 === 'true';
    this.supportedFormats = ['avif', 'webp', 'jpeg', 'jpg', 'png'];
    this.supportedSizes = ['thumb', 'mobile', 'desktop', 'original'];

    // Format priorities (order matters for fallback)
    this.formatPriority = ['avif', 'webp', 'jpeg'];

    // Browser support detection patterns
    this.acceptHeaders = {
      avif: 'image/avif',
      webp: 'image/webp',
    };
  }

  /**
   * Upload image and trigger optimization pipeline
   * Stores original and tracks optimization status.
   * @param fileBuffer
   * @param fileName
   * @param mimeType
   * @param options
   * @example
   */
  async uploadImage(fileBuffer, fileName, mimeType, options = {}) {
    try {
      // Upload original to trigger Lambda processing
      const originalPath = await this.uploadToOriginals(fileBuffer, fileName, mimeType, options);

      // Store optimization metadata
      const optimizationRecord = await this.createOptimizationRecord(originalPath, options);

      // Return immediately with original URL (optimized versions process async)
      return {
        ...originalPath,
        optimizationId: optimizationRecord.id,
        optimizationStatus: 'processing',
        formats: {
          jpeg: await this.getOptimizedUrl(originalPath.s3Key, 'jpeg', 'original'),
          webp: null, // Will be available after processing
          avif: null, // Will be available after processing
        },
      };
    } catch (error) {
      logger.error('Error uploading image for optimization', {
        error: error.message,
        fileName,
      });
      throw error;
    }
  }

  /**
   * Upload to originals folder to trigger Lambda.
   * @param fileBuffer
   * @param fileName
   * @param mimeType
   * @param options
   * @example
   */
  async uploadToOriginals(fileBuffer, fileName, mimeType, options) {
    const { entityId } = options;

    // Modify path to use originals folder
    // eslint-disable-next-line no-underscore-dangle
    const originalFileName = this._generateFileName(fileName, entityId);
    const s3Key = originalFileName.replace(
      `${this.baseFolder}/`,
      `${this.baseFolder}/originals/`
    );

    // Add environment prefix
    const s3Prefix = process.env.S3_PREFIX || '';
    const fullS3Key = `${s3Prefix}${s3Key}`;

    // Upload using parent class method
    return super.uploadFile(fileBuffer, fileName, mimeType, {
      ...options,
      customS3Key: fullS3Key,
    });
  }

  /**
   * Create Parse record to track optimization status.
   * @param uploadResult
   * @param options
   * @example
   */
  async createOptimizationRecord(uploadResult, options) {
    const OptimizationRecord = Parse.Object.extend('ImageOptimization');
    const record = new OptimizationRecord();

    record.set('originalS3Key', uploadResult.s3Key);
    record.set('bucket', uploadResult.bucket);
    record.set('status', 'pending');
    record.set('formats', {});
    record.set('sizes', {});
    record.set('entityType', this.baseFolder);
    record.set('entityId', options.entityId);
    record.set('uploadedBy', options.userContext?.userId);
    record.set('createdAt', new Date());

    await record.save(null, { useMasterKey: true });

    logger.info('Created optimization record', {
      id: record.id,
      s3Key: uploadResult.s3Key,
    });

    return record;
  }

  /**
   * Get optimized image URLs with format fallback
   * Returns URLs for all available formats with size variants.
   * @param originalS3Key
   * @param acceptHeader
   * @example
   */
  async getOptimizedImageUrls(originalS3Key, acceptHeader = null) {
    try {
      // Detect best format from Accept header
      const preferredFormat = this.detectPreferredFormat(acceptHeader);

      // Check which optimized versions exist
      const availableFormats = await this.checkAvailableFormats(originalS3Key);

      // Build URL response with fallback chain
      const urls = {
        preferred: null,
        formats: {},
        sizes: {},
      };

      // Set preferred format URL
      if (availableFormats[preferredFormat]) {
        urls.preferred = await this.getOptimizedUrl(originalS3Key, preferredFormat, 'original');
      } else {
        // Fallback to next best available format
        for (const format of this.formatPriority) {
          if (availableFormats[format]) {
            urls.preferred = await this.getOptimizedUrl(originalS3Key, format, 'original');
            break;
          }
        }
      }

      // Generate URLs for all available formats
      for (const format of this.formatPriority) {
        if (availableFormats[format]) {
          urls.formats[format] = await this.getOptimizedUrl(originalS3Key, format, 'original');
        }
      }

      // Generate size variants for preferred format
      if (preferredFormat && availableFormats[preferredFormat]) {
        for (const size of this.supportedSizes) {
          const sizeUrl = await this.getOptimizedUrl(originalS3Key, preferredFormat, size);
          if (sizeUrl) {
            if (!urls.sizes[size]) urls.sizes[size] = {};
            urls.sizes[size][preferredFormat] = sizeUrl;
          }
        }
      }

      // Add metadata
      urls.metadata = {
        preferredFormat,
        availableFormats: Object.keys(availableFormats).filter((f) => availableFormats[f]),
        acceptHeader,
        cacheable: true,
      };

      return urls;
    } catch (error) {
      logger.error('Error getting optimized image URLs', {
        error: error.message,
        originalS3Key,
      });

      // Fallback to original
      const BaseFileStorageService = require('./FileStorageService');
      const fileService = new BaseFileStorageService({
        baseFolder: 'vehicles',
        isPublic: false,
        presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
      });
      const presignedUrl = await fileService.getPresignedUrl(originalS3Key);
      return {
        preferred: presignedUrl,
        formats: { original: presignedUrl },
        sizes: {},
        metadata: { error: true, fallback: true },
      };
    }
  }

  /**
   * Detect preferred format from Accept header.
   * @param acceptHeader
   * @example
   */
  detectPreferredFormat(acceptHeader) {
    if (!acceptHeader) return 'jpeg';

    // Check for AVIF support
    if (acceptHeader.includes('image/avif')) {
      return 'avif';
    }

    // Check for WebP support
    if (acceptHeader.includes('image/webp')) {
      return 'webp';
    }

    // Default to JPEG
    return 'jpeg';
  }

  /**
   * Check which optimized formats exist in S3.
   * @param originalS3Key
   * @example
   */
  async checkAvailableFormats(originalS3Key) {
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3();
    const bucket = process.env.S3_BUCKET;

    const formats = {};

    // Extract base path and filename
    const keyParts = originalS3Key.split('/');
    const fileName = keyParts.pop().split('.')[0]; // Remove extension
    const env = keyParts[0]; // dev/prod

    // Check each format
    for (const format of this.formatPriority) {
      const optimizedKey = `${env}/optimized/${format}/vehicles/${fileName}.${format}`;

      try {
        await s3.headObject({
          Bucket: bucket,
          Key: optimizedKey,
        }).promise();

        formats[format] = true;
      } catch (error) {
        formats[format] = false;
      }
    }

    // Always have original available
    formats.original = true;

    return formats;
  }

  /**
   * Generate URL for specific format and size.
   * @param originalS3Key
   * @param format
   * @param size
   * @example
   */
  async getOptimizedUrl(originalS3Key, format, size = 'original') {
    try {
      // Parse the original key
      const keyParts = originalS3Key.split('/');
      const fileName = keyParts.pop();
      const fileNameNoExt = fileName.split('.')[0];
      const env = keyParts[0];

      // Extract vehicle ID from path (e.g., vehicles/abc123/...)
      const vehicleIdMatch = originalS3Key.match(/vehicles\/([^/]+)\//);
      const vehicleId = vehicleIdMatch ? vehicleIdMatch[1] : '';

      // Construct optimized key based on Lambda output structure
      let optimizedKey;
      if (size === 'original') {
        optimizedKey = `${env}/optimized/${format}/vehicles/${vehicleId}/${fileNameNoExt}.${format}`;
      } else {
        optimizedKey = `${env}/optimized/${format}/sizes/${size}/vehicles/${vehicleId}/${fileNameNoExt}.${format}`;
      }

      // Use CDN if available, otherwise direct S3 URL or presigned URL
      if (this.cdnDomain) {
        // Generic CDN (could be Cloudflare, Fastly, etc.)
        return `https://${this.cdnDomain}/${optimizedKey}`;
      } if (this.useDirectS3) {
        // Direct S3 URL (requires public bucket or public ACL)
        const bucket = process.env.S3_BUCKET;
        const region = process.env.AWS_REGION || 'us-east-2';
        return `https://${bucket}.s3.${region}.amazonaws.com/${optimizedKey}`;
      }
      // Presigned URL for private buckets
      const BaseFileStorageService = require('./FileStorageService');
      const fileService = new BaseFileStorageService({
        baseFolder: 'vehicles',
        isPublic: false,
        presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
      });
      return await fileService.getPresignedUrl(optimizedKey);
    } catch (error) {
      logger.error('Error generating optimized URL', {
        error: error.message,
        originalS3Key,
        format,
        size,
      });
      return null;
    }
  }

  /**
   * Update optimization status from Lambda completion
   * Called by webhook or Lambda destination.
   * @param originalS3Key
   * @param processedPaths
   * @example
   */
  async updateOptimizationStatus(originalS3Key, processedPaths) {
    try {
      const query = new Parse.Query('ImageOptimization');
      query.equalTo('originalS3Key', originalS3Key);
      const record = await query.first({ useMasterKey: true });

      if (!record) {
        logger.warn('Optimization record not found', { originalS3Key });
        return;
      }

      record.set('status', 'completed');
      record.set('formats', processedPaths);
      record.set('completedAt', new Date());
      await record.save(null, { useMasterKey: true });

      logger.info('Updated optimization status', {
        id: record.id,
        formats: Object.keys(processedPaths),
      });

      return record;
    } catch (error) {
      logger.error('Error updating optimization status', {
        error: error.message,
        originalS3Key,
      });
      throw error;
    }
  }

  /**
   * Get image with best format for request
   * Used by API endpoints.
   * @param vehicleImageRecord
   * @param acceptHeader
   * @example
   */
  async getImageWithOptimalFormat(vehicleImageRecord, acceptHeader) {
    const s3Key = vehicleImageRecord.get('s3Key');

    if (!s3Key) {
      // Fallback to legacy imageFile
      const imageFile = vehicleImageRecord.get('imageFile');
      if (imageFile) {
        const responseData = {
          url: imageFile.url(),
          formats: {},
          sizes: {},
          metadata: {
            preferredFormat: 'original',
            availableFormats: ['original'],
            acceptHeader,
            cacheable: true,
          },
        };
        return responseData;
      }
      const responseData = {
        url: null,
        formats: {},
        sizes: {},
        metadata: {
          preferredFormat: 'original',
          availableFormats: [],
          acceptHeader,
          cacheable: false,
        },
      };
      return responseData;
    }

    try {
      // Check if this image has optimized variants stored
      const optimizedVariants = vehicleImageRecord.get('optimizedVariants');

      if (optimizedVariants) {
        console.log('Found optimized variants in database, using direct variant URLs');

        // Detect preferred format from Accept header
        const preferredFormat = this.detectPreferredFormat(acceptHeader);

        // Check if preferred format is available in optimized variants
        let bestFormat = 'original';
        let bestUrl = null;

        // Try preferred format first
        if (optimizedVariants[preferredFormat] && optimizedVariants[preferredFormat].original) {
          bestFormat = preferredFormat;
          bestUrl = optimizedVariants[preferredFormat].original.url;
        } else {
          // Fallback chain: avif -> webp -> jpeg -> original
          for (const format of ['avif', 'webp', 'jpeg']) {
            if (optimizedVariants[format] && optimizedVariants[format].original) {
              bestFormat = format;
              bestUrl = optimizedVariants[format].original.url;
              break;
            }
          }
        }

        // Final fallback to original file if no optimized variants
        if (!bestUrl && optimizedVariants.original) {
          bestFormat = 'original';
          bestUrl = optimizedVariants.original.url;
        }

        // Last resort: generate presigned URL for S3 key if no URL found in variants
        if (!bestUrl) {
          const BaseFileStorageService = require('./FileStorageService');
          const fileService = new BaseFileStorageService({
            baseFolder: 'vehicles',
            isPublic: false,
            presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
          });
          bestUrl = await fileService.getPresignedUrl(s3Key);
          bestFormat = 'original';
        }

        // Ensure we return a proper response object
        const responseData = {
          url: bestUrl,
          format: bestFormat,
          optimized: bestUrl !== null,
          formats: this.buildFormatsObject(optimizedVariants),
          sizes: this.buildSizesObject(optimizedVariants, bestFormat),
          metadata: {
            preferredFormat,
            availableFormats: Object.keys(optimizedVariants),
            acceptHeader,
            cacheable: true,
          },
        };
        return responseData;
      }

      // Legacy: Try Lambda-style optimization (will fail gracefully)
      const optimizedUrls = await this.getOptimizedImageUrls(s3Key, acceptHeader);

      // If optimization fails, fall back to basic S3 presigned URL
      if (!optimizedUrls.preferred) {
        try {
          // Create FileStorageService instance to generate presigned URL
          const BaseFileStorageService = require('./FileStorageService');
          const fileService = new BaseFileStorageService({
            baseFolder: 'vehicles',
            isPublic: false,
            presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
          });
          const basicUrl = await fileService.getPresignedUrl(s3Key);

          if (basicUrl) {
            const responseData = {
              url: basicUrl,
              formats: {},
              sizes: {},
              metadata: {
                preferredFormat: 'original',
                availableFormats: ['original'],
                acceptHeader,
                fallback: true,
                source: 'legacy-fallback',
              },
            };
            return responseData;
          }
        } catch (error) {
          console.error('Error generating presigned URL for legacy image:', error);
        }

        // Final fallback - try direct S3 URL construction
        const bucket = process.env.S3_BUCKET;
        const region = process.env.AWS_REGION || 'us-east-2';
        const directS3Url = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;

        const responseData = {
          url: directS3Url,
          formats: {},
          sizes: {},
          metadata: {
            preferredFormat: 'original',
            availableFormats: ['original'],
            acceptHeader,
            fallback: true,
            directS3: true,
            source: 'legacy-fallback-direct-s3',
          },
        };
        return responseData;
      }

      const responseData = {
        url: optimizedUrls.preferred,
        formats: optimizedUrls.formats,
        sizes: optimizedUrls.sizes,
        metadata: optimizedUrls.metadata,
      };
      return responseData;
    } catch (error) {
      console.error('Error in image optimization, falling back to basic S3:', error);

      // Create FileStorageService instance to generate presigned URL
      const BaseFileStorageService = require('./FileStorageService');
      const fileService = new BaseFileStorageService({
        baseFolder: 'vehicles',
        isPublic: false,
        presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
      });
      const basicUrl = await fileService.getPresignedUrl(s3Key);

      const responseData = {
        url: basicUrl,
        formats: {},
        sizes: {},
        metadata: {
          preferredFormat: 'original',
          availableFormats: ['original'],
          error: error.message,
          source: 'error-fallback',
        },
      };
      return responseData;
    }
  }

  /**
   * Generate picture element data for frontend
   * Returns structured data for HTML <picture> element.
   * @param optimizedUrls
   * @example
   */
  generatePictureElementData(optimizedUrls) {
    const sources = [];

    // Add AVIF source if available
    if (optimizedUrls.formats.avif) {
      sources.push({
        srcset: this.generateSrcSet(optimizedUrls, 'avif'),
        type: 'image/avif',
      });
    }

    // Add WebP source if available
    if (optimizedUrls.formats.webp) {
      sources.push({
        srcset: this.generateSrcSet(optimizedUrls, 'webp'),
        type: 'image/webp',
      });
    }

    // JPEG fallback (always last)
    const fallback = {
      src: optimizedUrls.formats.jpeg || optimizedUrls.formats.original,
      srcset: this.generateSrcSet(optimizedUrls, 'jpeg'),
    };

    return {
      sources,
      fallback,
      loading: 'lazy',
      decoding: 'async',
    };
  }

  /**
   * Generate srcset attribute for responsive images.
   * @param optimizedUrls
   * @param format
   * @example
   */
  generateSrcSet(optimizedUrls, format) {
    const srcset = [];

    // Add size variants if available
    if (optimizedUrls.sizes.mobile?.[format]) {
      srcset.push(`${optimizedUrls.sizes.mobile[format]} 768w`);
    }

    if (optimizedUrls.sizes.desktop?.[format]) {
      srcset.push(`${optimizedUrls.sizes.desktop[format]} 1920w`);
    }

    // Add original size
    if (optimizedUrls.formats[format]) {
      srcset.push(optimizedUrls.formats[format]);
    }

    return srcset.join(', ');
  }

  /**
   * Build formats object from optimized variants.
   * @param optimizedVariants
   * @example
   */
  buildFormatsObject(optimizedVariants) {
    const formats = {};

    for (const format of Object.keys(optimizedVariants)) {
      if (optimizedVariants[format] && optimizedVariants[format].original) {
        formats[format] = optimizedVariants[format].original.url;
      }
    }

    return formats;
  }

  /**
   * Build sizes object from optimized variants for a specific format.
   * @param optimizedVariants
   * @param format
   * @example
   */
  buildSizesObject(optimizedVariants, format) {
    const sizes = {};

    if (optimizedVariants[format]) {
      for (const size of Object.keys(optimizedVariants[format])) {
        if (optimizedVariants[format][size] && optimizedVariants[format][size].url) {
          if (!sizes[size]) sizes[size] = {};
          sizes[size][format] = optimizedVariants[format][size].url;
        }
      }
    }

    return sizes;
  }
}

module.exports = ImageOptimizationService;
