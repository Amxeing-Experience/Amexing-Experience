/**
 * FileStorageService - Generic file storage operations using direct AWS SDK S3 uploads.
 *
 * Provides centralized file management with direct S3 integration:
 * - Direct AWS SDK uploads (no Parse Server adapter)
 * - Public vs private access (future use)
 * - Base folder paths (vehicles/, experiences/, documents/, etc.)
 * - Deletion strategies (soft, move to deleted/, hard delete)
 * - Presigned URL expiration (1 hour default for PCI DSS compliance)
 * - Server-side encryption (AES256/KMS)
 * - PCI DSS security logging.
 *
 * Follows SOLID principles and Clean Architecture.
 * Service Layer pattern for infrastructure abstraction.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/* eslint-disable no-underscore-dangle */
/* Private methods use underscore prefix as JavaScript convention for internal methods */
/* eslint-disable security/detect-non-literal-regexp */
/* File extension validation uses dynamic RegExp for flexibility */

/**
 * @example
 * // Vehicle images with move-to-deleted strategy and encryption
 * const vehicleImageService = new FileStorageService({
 *   baseFolder: 'vehicles',
 *   isPublic: false,
 *   deletionStrategy: 'move',
 *   presignedUrlExpires: 3600 // 1 hour
 * });
 *
 * // Upload file to S3 with encryption
 * const uploadResult = await vehicleImageService.uploadFile(
 *   fileBuffer,
 *   'vehicle-photo.jpg',
 *   'image/jpeg',
 *   {
 *     entityId: 'vehicle123',
 *     userContext: { userId: 'user123', email: 'user@example.com' }
 *   }
 * );
 * // Returns: { s3Key, s3Url, bucket, region, encryption }
 *
 * // Get presigned URL from s3Key
 * const url = vehicleImageService.getPresignedUrl(uploadResult.s3Key);
 *
 * // Delete file (moves to deleted/ folder with encryption)
 * await vehicleImageService.deleteFile(uploadResult.s3Key);
 */

const Parse = require('parse/node');
const crypto = require('crypto');
const logger = require('../../infrastructure/logger');

/**
 * AWS S3 Direct Upload File Storage Service
 * Provides secure file upload, download, and deletion operations using AWS SDK directly.
 * Implements server-side encryption (AES256), presigned URLs, and logical deletion strategies.
 * @class FileStorageService
 */
class FileStorageService {
  /**
   * Initialize FileStorageService with configuration.
   * @param {object} config - Service configuration.
   * @param {string} config.baseFolder - Base folder path (vehicles/, experiences/, documents/).
   * @param {boolean} config.isPublic - Public vs private access (future use).
   * @param {string} config.deletionStrategy - Deletion strategy: 'soft', 'move', 'hard'.
   * @param {number} config.presignedUrlExpires - Presigned URL expiration in seconds.
   * @example
   */
  constructor(config = {}) {
    this.baseFolder = config.baseFolder || 'files';
    this.isPublic = config.isPublic || false;
    this.deletionStrategy = config.deletionStrategy || 'move';
    this.presignedUrlExpires = config.presignedUrlExpires || 3600; // 1 hour (PCI DSS 4.2.1)
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Upload file directly to S3 using AWS SDK.
   *
   * Creates unique filename with timestamp and random hex to prevent collisions.
   * Organizes files by baseFolder and optional entityId with environment prefix.
   * @param {Buffer} fileBuffer - File buffer data.
   * @param {string} fileName - Original filename.
   * @param {string} mimeType - MIME type (image/jpeg, image/png, etc.).
   * @param {object} options - Additional options.
   * @param {string} options.entityId - Entity ID for path organization (vehicleId, experienceId, etc.).
   * @param {object} options.metadata - Additional metadata for S3 object.
   * @returns {Promise<object>} Upload result with { s3Key, s3Url, bucket, region }.
   * @throws {Error} If upload fails.
   * @example
   * const buffer = fs.readFileSync('vehicle.jpg');
   * const result = await service.uploadFile(
   *   buffer,
   *   'vehicle-photo.jpg',
   *   'image/jpeg',
   *   { entityId: 'vehicle123' }
   * );
   * console.log(result.s3Url); // S3 object URL
   * console.log(result.s3Key); // vehicles/vehicle123/1234567890-abcdef.jpg
   */
  async uploadFile(fileBuffer, fileName, mimeType, options = {}) {
    try {
      const { entityId, metadata = {} } = options;

      logger.info('FileStorageService.uploadFile - Direct S3 upload with AWS SDK', {
        fileName,
        mimeType,
        bufferLength: fileBuffer?.length,
        timestamp: new Date().toISOString(),
      });

      // Generate unique filename with path structure
      const uniqueFileName = this._generateFileName(fileName, entityId);

      // Add environment prefix (dev/ or prod/)
      const s3Prefix = process.env.S3_PREFIX || '';
      const s3Key = `${s3Prefix}${uniqueFileName}`;

      // Initialize AWS S3 client using credential chain (IAM role, env vars, etc.)
      const AWS = require('aws-sdk');
      const region = process.env.AWS_REGION || 'us-east-2';

      // Configure AWS to use EC2 instance metadata with IMDSv2
      AWS.config.update({
        region,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000,
          connectTimeout: 5000,
        },
      });

      // Use EC2 Metadata credentials explicitly if no env credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        AWS.config.credentials = new AWS.EC2MetadataCredentials({
          httpOptions: { timeout: 5000 },
          maxRetries: 3,
        });
      }

      const s3 = new AWS.S3();

      const bucket = process.env.S3_BUCKET;

      logger.info('Uploading directly to S3', {
        bucket,
        s3Key,
        mimeType,
        bufferLength: fileBuffer.length,
      });

      // Upload to S3 with encryption (PCI DSS 3.5.1)
      const uploadParams = {
        Bucket: bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimeType,
        ServerSideEncryption: process.env.S3_ENCRYPTION_TYPE || 'AES256',
        Metadata: {
          originalFileName: fileName,
          uploadedAt: new Date().toISOString(),
          encryptedAt: new Date().toISOString(),
          ...metadata,
        },
      };

      const uploadResult = await s3.upload(uploadParams).promise();

      logger.info('File uploaded to S3 successfully', {
        fileName: uniqueFileName,
        size: fileBuffer.length,
        mimeType,
        s3Key: uploadResult.Key,
        s3Location: uploadResult.Location,
        bucket: uploadResult.Bucket,
        encryption: uploadParams.ServerSideEncryption,
        baseFolder: this.baseFolder,
        entityId,
      });

      // Add user context logging if provided (PCI DSS 10.2.1)
      if (options.userContext) {
        logger.logDataAccess(options.userContext.userId, 's3_file_storage', 'UPLOAD', true);
      }

      // Return standardized result
      return {
        s3Key: uploadResult.Key,
        s3Url: uploadResult.Location,
        bucket: uploadResult.Bucket,
        region: process.env.AWS_REGION || 'us-east-2',
        eTag: uploadResult.ETag,
        encryption: uploadParams.ServerSideEncryption,
      };
    } catch (error) {
      logger.error('Error uploading file to S3', {
        error: error.message,
        stack: error.stack,
        fileName,
        mimeType,
        baseFolder: this.baseFolder,
        code: error.code,
        statusCode: error.statusCode,
      });
      throw error;
    }
  }

  /**
   * Delete file based on configured deletion strategy.
   *
   * Strategies:
   * - 'soft': Mark as deleted in database, keep file in S3 (application-level only)
   * - 'move': Move file to deleted/ folder in S3 (allows recovery)
   * - 'hard': Permanently delete file from S3 (cannot be recovered).
   * @param {Parse.File} parseFile - Parse.File object to delete.
   * @param {object} options - Additional options.
   * @param {string} options.deletedBy - User ID who initiated deletion.
   * @param {string} options.reason - Deletion reason for audit.
   * @returns {Promise<object>} Result object with success, strategy, location.
   * @throws {Error} If deletion fails or unknown strategy.
   * @example
   * const result = await service.deleteFile(parseFile, {
   *   deletedBy: 'user123',
   *   reason: 'User requested deletion'
   * });
   * // result: { success: true, strategy: 'move', location: 'deleted/vehicles/...' }
   */
  async deleteFile(parseFile, options = {}) {
    try {
      switch (this.deletionStrategy) {
        case 'soft':
          return await this._softDelete(parseFile, options);
        case 'move':
          return await this._moveToDeleted(parseFile, options);
        case 'hard':
          return await this._hardDelete(parseFile, options);
        default:
          throw new Error(`Unknown deletion strategy: ${this.deletionStrategy}`);
      }
    } catch (error) {
      logger.error('Error deleting file', {
        error: error.message,
        stack: error.stack,
        strategy: this.deletionStrategy,
        fileName: parseFile.name(),
      });
      throw error;
    }
  }

  /**
   * Generate URL for file access.
   *
   * For public files: Returns direct S3 URL without expiration.
   * For private files: Returns presigned URL with expiration.
   *
   * Uses AWS SDK credential chain (IAM role, environment variables, etc.)
   * instead of explicit credentials for better security.
   * @param {string} s3Key - S3 object key (full path including prefix).
   * @param {number} expiresIn - URL expiration in seconds (only for presigned URLs).
   * @returns {Promise<string>} S3 URL (direct or presigned based on isPublic setting).
   * @example
   * // Public file (direct URL)
   * const url = await service.getPresignedUrl('prod/vehicles/abc123/image.jpg');
   * // https://amexing-bucket.s3.us-east-2.amazonaws.com/prod/vehicles/abc123/image.jpg
   *
   * // Private file (presigned URL)
   * const privateUrl = await service.getPresignedUrl('prod/documents/sensitive.pdf', 3600);
   * // https://amexing-bucket.s3.us-east-2.amazonaws.com/prod/documents/sensitive.pdf?X-Amz-Signature=...
   */
  async getPresignedUrl(s3Key, expiresIn = null) {
    try {
      const bucket = process.env.S3_BUCKET;
      const region = process.env.AWS_REGION || 'us-east-2';

      // Validate inputs
      if (!bucket) {
        throw new Error('S3_BUCKET environment variable is not configured');
      }
      if (!s3Key) {
        throw new Error('s3Key parameter is required');
      }

      // For public files, generate direct S3 URL (no signature needed)
      if (this.isPublic) {
        const directUrl = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;

        logger.debug('Generated direct S3 URL for public file', {
          s3Key,
          bucket,
          region,
          urlLength: directUrl.length,
        });

        return directUrl;
      }

      // For private files, generate presigned URL with signature
      const AWS = require('aws-sdk');

      // Configure AWS to use EC2 instance metadata with IMDSv2
      AWS.config.update({
        region,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000, // 5 second timeout
          connectTimeout: 5000,
        },
      });

      // Use EC2 Metadata credentials explicitly if no env credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        const credentials = new AWS.EC2MetadataCredentials({
          httpOptions: { timeout: 5000 },
          maxRetries: 3,
        });

        // IMPORTANT: Wait for credentials to load before generating URL
        await new Promise((resolve, reject) => {
          credentials.get((err) => {
            if (err) {
              logger.error('Failed to load EC2 metadata credentials', {
                error: err.message,
                code: err.code,
              });
              reject(err);
            } else {
              logger.debug('EC2 metadata credentials loaded successfully', {
                accessKeyId: `${credentials.accessKeyId?.substring(0, 8)}...`,
              });
              resolve();
            }
          });
        });

        AWS.config.credentials = credentials;
      }

      const s3 = new AWS.S3({
        signatureVersion: 'v4',
      });

      const expiration = expiresIn || this.presignedUrlExpires;
      const params = {
        Bucket: bucket,
        Key: s3Key,
        Expires: expiration,
      };

      const url = s3.getSignedUrl('getObject', params);

      // Validate the generated presigned URL
      if (!url.includes(bucket) || !url.includes(s3Key)) {
        logger.error('Generated presigned URL is incomplete - possibly missing AWS credentials', {
          url,
          bucket,
          s3Key,
          hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
          hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
        });

        // Fallback to direct URL if presigned URL generation fails
        const fallbackUrl = `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`;
        logger.warn('Using direct S3 URL as fallback (may fail if bucket is private)', {
          fallbackUrl,
        });
        return fallbackUrl;
      }

      logger.debug('Generated presigned URL', {
        s3Key,
        expiresIn: expiration,
        urlLength: url.length,
      });

      return url;
    } catch (error) {
      logger.error('Error generating S3 URL', {
        error: error.message,
        stack: error.stack,
        s3Key,
        isPublic: this.isPublic,
      });
      throw error;
    }
  }

  /**
   * DEPRECATED: Use getPresignedUrl() instead.
   * Kept for backward compatibility with Parse.File references.
   * @deprecated
   * @param {Parse.File|string} parseFileOrKey - Parse.File object or S3 key.
   * @returns {Promise<string|null>} Presigned S3 URL or null if file is null/undefined.
   * @example
   */
  async generateUrl(parseFileOrKey) {
    if (!parseFileOrKey) return null;

    // If it's a Parse.File, extract the name (S3 key)
    if (parseFileOrKey.name && typeof parseFileOrKey.name === 'function') {
      return this.getPresignedUrl(parseFileOrKey.name());
    }

    // If it's already a string (S3 key), use it directly
    if (typeof parseFileOrKey === 'string') {
      return this.getPresignedUrl(parseFileOrKey);
    }

    return null;
  }

  /**
   * Generate unique filename with folder structure.
   *
   * Format: {baseFolder}/{entityId}/{timestamp}-{randomHex}.{extension}
   * Example: vehicles/abc123/1640000000000-a1b2c3d4e5f6g7h8.jpg.
   * @private
   * @param {string} originalName - Original filename with extension.
   * @param {string} entityId - Entity ID for path organization (optional).
   * @returns {string} Unique filename with full path.
   * @example
   * _generateFileName('photo.jpg', 'vehicle123')
   * // vehicles/vehicle123/1640000000000-a1b2c3d4e5f6g7h8.jpg
   */
  _generateFileName(originalName, entityId) {
    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(8).toString('hex');
    const extension = originalName.split('.').pop();
    const baseName = `${timestamp}-${randomHex}.${extension}`;

    // Structure: {baseFolder}/{entityId}/{filename}
    if (entityId) {
      return `${this.baseFolder}/${entityId}/${baseName}`;
    }

    // Structure: {baseFolder}/{filename}
    return `${this.baseFolder}/${baseName}`;
  }

  /**
   * Soft delete: Mark file as deleted in database, keep in S3.
   *
   * This is an application-level deletion strategy.
   * The actual database record should be marked as exists=false.
   * File remains in S3 at original location.
   * @private
   * @param {Parse.File} parseFile - Parse.File object.
   * @param {object} options - Deletion options.
   * @returns {Promise<object>} Result object.
   * @example
   */
  async _softDelete(parseFile, options) {
    logger.info('File soft deleted (database only, file remains in S3)', {
      fileName: parseFile.name(),
      deletedBy: options.deletedBy,
      reason: options.reason,
    });

    return {
      success: true,
      strategy: 'soft',
      location: 'original',
    };
  }

  /**
   * Move file to deleted/ folder in S3.
   *
   * Copies file to deleted/ prefix, then deletes original.
   * Allows file recovery if needed within retention period.
   * @private
   * @param {Parse.File} parseFile - Parse.File object.
   * @param {object} options - Deletion options.
   * @returns {Promise<object>} Result object with new location.
   * @example
   */
  async _moveToDeleted(parseFile, options) {
    try {
      // Use AWS SDK directly for copy/delete operations
      // Parse.File doesn't support move/copy natively
      const AWS = require('aws-sdk');
      const region = process.env.AWS_REGION || 'us-east-2';

      // Configure AWS to use EC2 instance metadata with IMDSv2
      AWS.config.update({
        region,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000,
          connectTimeout: 5000,
        },
      });

      // Use EC2 Metadata credentials explicitly if no env credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        AWS.config.credentials = new AWS.EC2MetadataCredentials({
          httpOptions: { timeout: 5000 },
          maxRetries: 3,
        });
      }

      const s3 = new AWS.S3();

      const bucket = process.env.S3_BUCKET;
      const sourceKey = parseFile.name();

      // Extract environment prefix (dev/, prod/, test/) if present
      const prefixMatch = sourceKey.match(/^(dev\/|prod\/|test\/)/);
      const prefix = prefixMatch ? prefixMatch[1] : '';

      // Remove prefix from source key for processing
      const keyWithoutPrefix = prefix ? sourceKey.substring(prefix.length) : sourceKey;

      // Construct destination key: {prefix}deleted/{baseFolder}/...
      // Example: test/vehicles/abc/photo.jpg → test/deleted/vehicles/abc/photo.jpg
      const destKey = prefix ? `${prefix}deleted/${keyWithoutPrefix}` : `deleted/${keyWithoutPrefix}`;

      // Copy to deleted/ folder with encryption (PCI DSS 3.5.1)
      await s3
        .copyObject({
          Bucket: bucket,
          CopySource: `${bucket}/${sourceKey}`,
          Key: destKey,
          ServerSideEncryption: process.env.S3_ENCRYPTION_TYPE || 'AES256',
          MetadataDirective: 'COPY', // Preserve original metadata including encryptedAt
        })
        .promise();

      // Delete original
      await s3
        .deleteObject({
          Bucket: bucket,
          Key: sourceKey,
        })
        .promise();

      logger.info('File moved to deleted folder in S3', {
        from: sourceKey,
        to: destKey,
        deletedBy: options?.deletedBy || 'system',
        reason: options?.reason || 'soft delete',
      });

      return {
        success: true,
        strategy: 'move',
        location: destKey,
      };
    } catch (error) {
      logger.error('Error moving file to deleted folder', {
        error: error.message,
        fileName: parseFile.name(),
      });
      throw error;
    }
  }

  /**
   * Hard delete: Permanently remove file from S3.
   *
   * File cannot be recovered after hard deletion.
   * Use with caution.
   * @private
   * @param {Parse.File} parseFile - Parse.File object.
   * @param {object} options - Deletion options.
   * @returns {Promise<object>} Result object.
   * @example
   */
  async _hardDelete(parseFile, options) {
    try {
      const AWS = require('aws-sdk');
      const region = process.env.AWS_REGION || 'us-east-2';

      // Configure AWS to use EC2 instance metadata with IMDSv2
      AWS.config.update({
        region,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000,
          connectTimeout: 5000,
        },
      });

      // Use EC2 Metadata credentials explicitly if no env credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        AWS.config.credentials = new AWS.EC2MetadataCredentials({
          httpOptions: { timeout: 5000 },
          maxRetries: 3,
        });
      }

      const s3 = new AWS.S3();

      await s3
        .deleteObject({
          Bucket: process.env.S3_BUCKET,
          Key: parseFile.name(),
        })
        .promise();

      logger.info('File permanently deleted from S3', {
        fileName: parseFile.name(),
        deletedBy: options?.deletedBy || 'system',
        reason: options?.reason || 'hard delete',
      });

      return {
        success: true,
        strategy: 'hard',
        location: 'deleted',
        fileName: parseFile.name(),
      };
    } catch (error) {
      logger.error('Error hard deleting file from S3', {
        error: error.message,
        fileName: parseFile.name(),
      });
      throw error;
    }
  }

  /**
   * List files in S3 with optional prefix filter.
   * @param {string} prefix - Prefix filter (folder path or entity ID).
   * @returns {Promise<Array>} Array of S3 object metadata.
   * @example
   * const files = await service.listFiles('vehicle123');
   * // Returns all files in vehicles/vehicle123/
   */
  async listFiles(prefix) {
    try {
      const AWS = require('aws-sdk');
      const region = process.env.AWS_REGION || 'us-east-2';

      // Configure AWS to use EC2 instance metadata with IMDSv2
      AWS.config.update({
        region,
        maxRetries: 3,
        httpOptions: {
          timeout: 5000,
          connectTimeout: 5000,
        },
      });

      // Use EC2 Metadata credentials explicitly if no env credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        AWS.config.credentials = new AWS.EC2MetadataCredentials({
          httpOptions: { timeout: 5000 },
          maxRetries: 3,
        });
      }

      const s3 = new AWS.S3();

      const fullPrefix = `${this.baseFolder}/${prefix || ''}`;
      const result = await s3
        .listObjectsV2({
          Bucket: process.env.S3_BUCKET,
          Prefix: fullPrefix,
        })
        .promise();

      return result.Contents || [];
    } catch (error) {
      logger.error('Error listing files from S3', {
        error: error.message,
        prefix,
      });
      throw error;
    }
  }
}

module.exports = FileStorageService;
