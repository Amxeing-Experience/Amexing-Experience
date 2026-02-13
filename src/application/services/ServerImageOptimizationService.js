/**
 * Server-Side Image Optimization Service.
 *
 * Processes images directly on the Node.js server using Sharp.js
 * - Creates AVIF, WebP, and optimized JPEG variants
 * - Uploads all variants to S3
 * - No AWS Lambda required.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const sharp = require('sharp');
const FileStorageService = require('./FileStorageService');
const logger = require('../../infrastructure/logger');

class ServerImageOptimizationService extends FileStorageService {
  constructor(config = {}) {
    super(config);

    // Optimization settings
    this.enableOptimization = process.env.ENABLE_IMAGE_OPTIMIZATION !== 'false';
    this.supportedFormats = ['avif', 'webp', 'jpeg'];
    this.qualitySettings = {
      avif: { quality: 85, effort: 4 },
      webp: { quality: 90, effort: 4 },
      jpeg: { quality: 92, progressive: true, mozjpeg: true },
    };

    // Size variants
    this.sizeVariants = {
      thumb: { width: 150, height: 150, fit: 'cover' },
      mobile: { width: 400, height: 300, fit: 'inside' },
      desktop: { width: 800, height: 600, fit: 'inside' },
      original: null, // No resizing
    };
  }

  /**
   * Upload image with server-side optimization
   * Creates multiple format variants during upload.
   * @param fileBuffer
   * @param fileName
   * @param mimeType
   * @param options
   * @example
   */
  async uploadOptimizedImage(fileBuffer, fileName, mimeType, options = {}) {
    try {
      const optimizationResults = {};

      // Generate base S3 key
      const baseKey = this.generateS3Key(fileName, options);
      const baseName = baseKey.split('.')[0]; // Remove extension

      // Process each format
      for (const format of this.supportedFormats) {
        optimizationResults[format] = {};

        // Process each size variant
        for (const [sizeName, sizeConfig] of Object.entries(this.sizeVariants)) {
          try {
            const optimizedBuffer = await this.processImageFormat(
              fileBuffer,
              format,
              sizeConfig
            );

            // Generate S3 key for this variant
            const variantKey = `${baseName}-${sizeName}.${format}`;

            // Upload to S3
            const uploadResult = await this.uploadFile(
              optimizedBuffer,
              variantKey,
              `image/${format}`,
              { customS3Key: variantKey }
            );

            optimizationResults[format][sizeName] = {
              s3Key: uploadResult.s3Key,
              url: await this.getPresignedUrl(uploadResult.s3Key),
              fileSize: optimizedBuffer.length,
            };
          } catch (error) {
            console.error(`Error processing ${format} ${sizeName}:`, error);
            optimizationResults[format][sizeName] = { error: error.message };
          }
        }
      }

      // Also upload original
      const originalKey = `${baseName}-original.${this.getFileExtension(fileName)}`;
      const originalUpload = await this.uploadFile(fileBuffer, originalKey, mimeType, {
        customS3Key: originalKey,
      });

      optimizationResults.original = {
        s3Key: originalUpload.s3Key,
        url: await this.getPresignedUrl(originalUpload.s3Key),
        fileSize: fileBuffer.length,
      };

      return {
        success: true,
        originalS3Key: originalUpload.s3Key,
        optimizedVariants: optimizationResults,
        metadata: {
          formats: this.supportedFormats,
          sizes: Object.keys(this.sizeVariants),
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Server-side image optimization failed:', error);

      // Fallback: upload original only
      const fallbackKey = this.generateS3Key(fileName, options);
      const fallbackUpload = await this.uploadFile(fileBuffer, fallbackKey, mimeType, options);

      return {
        success: true,
        originalS3Key: fallbackUpload.s3Key,
        optimizedVariants: {
          original: {
            s3Key: fallbackUpload.s3Key,
            url: await this.getPresignedUrl(fallbackUpload.s3Key),
            fileSize: fileBuffer.length,
          },
        },
        metadata: {
          fallback: true,
          error: error.message,
        },
      };
    }
  }

  /**
   * Process image into specific format and size.
   * @param buffer
   * @param format
   * @param sizeConfig
   * @example
   */
  async processImageFormat(buffer, format, sizeConfig) {
    let sharpInstance = sharp(buffer);

    // Apply size transformation
    if (sizeConfig) {
      sharpInstance = sharpInstance.resize(sizeConfig);
    }

    // Apply format-specific optimization
    switch (format) {
      case 'avif':
        return sharpInstance
          .avif(this.qualitySettings.avif)
          .toBuffer();

      case 'webp':
        return sharpInstance
          .webp(this.qualitySettings.webp)
          .toBuffer();

      case 'jpeg':
        return sharpInstance
          .jpeg(this.qualitySettings.jpeg)
          .toBuffer();

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Get best available image URL for client.
   * @param originalS3Key
   * @param acceptHeader
   * @param size
   * @example
   */
  async getOptimizedImageUrl(originalS3Key, acceptHeader = '', size = 'original') {
    try {
      // Parse the base name from original key
      const baseName = originalS3Key.split('-original.')[0];

      // Detect preferred format from Accept header
      const preferredFormat = this.detectPreferredFormat(acceptHeader);

      // Try to get optimized version
      const optimizedKey = `${baseName}-${size}.${preferredFormat}`;

      // Check if optimized version exists
      const optimizedExists = await this.checkS3ObjectExists(optimizedKey);

      if (optimizedExists) {
        const url = await this.getPresignedUrl(optimizedKey);
        return {
          url,
          format: preferredFormat,
          size,
          optimized: true,
        };
      }

      // Fallback to original
      const originalUrl = await this.getPresignedUrl(originalS3Key);

      return {
        url: originalUrl,
        format: 'original',
        size: 'original',
        optimized: false,
      };
    } catch (error) {
      console.error('Error getting optimized URL:', error);

      // Final fallback
      const originalUrl = await this.getPresignedUrl(originalS3Key);
      return {
        url: originalUrl,
        format: 'original',
        size: 'original',
        optimized: false,
        error: error.message,
      };
    }
  }

  /**
   * Detect preferred image format from Accept header.
   * @param acceptHeader
   * @example
   */
  detectPreferredFormat(acceptHeader) {
    if (!acceptHeader) return 'jpeg';

    if (acceptHeader.includes('image/avif')) return 'avif';
    if (acceptHeader.includes('image/webp')) return 'webp';
    return 'jpeg';
  }

  /**
   * Check if S3 object exists.
   * @param s3Key
   * @example
   */
  async checkS3ObjectExists(s3Key) {
    try {
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3();
      await s3.headObject({
        Bucket: process.env.S3_BUCKET,
        Key: s3Key,
      }).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file extension from filename.
   * @param filename
   * @example
   */
  getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  /**
   * Generate S3 key for file.
   * @param fileName
   * @param options
   * @example
   */
  generateS3Key(fileName, options = {}) {
    const prefix = process.env.S3_PREFIX || '';
    const entityPath = options.entityPath || 'images';
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);

    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '');
    const extension = this.getFileExtension(fileName);
    const baseName = cleanFileName.replace(`.${extension}`, '');

    return `${prefix}${entityPath}/${timestamp}-${randomId}-${baseName}.${extension}`;
  }
}

module.exports = ServerImageOptimizationService;
