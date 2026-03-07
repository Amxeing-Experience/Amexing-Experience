/**
 * Employee Photo Route Middleware
 * Serves employee profile photos without requiring authentication
 * Similar to vehicle images but for employee profile pictures
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const FileStorageService = require('../services/FileStorageService');
const logger = require('../../infrastructure/logger');

/**
 * Determine content type from S3 key extension.
 * @param {string} s3Key - S3 key path.
 * @returns {string} Content type.
 * @example getContentTypeFromS3Key('employees/photo.jpg')
 */
function getContentTypeFromS3Key(s3Key) {
  const extension = s3Key.split('.').pop().toLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg'; // Default fallback
  }
}

/**
 * Serve employee photo route handler.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {Promise<void>}
 * @example serveEmployeePhotoRoute(req, res)
 */
async function serveEmployeePhotoRoute(req, res) {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: 'Employee ID is required',
      });
    }

    // Get employee data from database
    const userQuery = new Parse.Query('AmexingUser');
    userQuery.equalTo('objectId', employeeId);
    userQuery.equalTo('exists', true); // Only active employees

    const user = await userQuery.first({ useMasterKey: true });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found',
      });
    }

    // Get profile photo S3 key
    const profilePhotoS3Key = user.get('profilePhotoS3Key');

    if (!profilePhotoS3Key) {
      return res.status(404).json({
        success: false,
        error: 'No profile photo found for this employee',
      });
    }

    logger.info('Serving employee photo', {
      employeeId,
      s3Key: profilePhotoS3Key,
      userAgent: req.get('User-Agent'),
    });

    // Use FileStorageService to get the file from S3
    const fileStorageService = new FileStorageService();

    try {
      // Try to get the file buffer from S3
      let fileBuffer;
      let actualS3Key = profilePhotoS3Key;
      let contentType = getContentTypeFromS3Key(profilePhotoS3Key);

      try {
        fileBuffer = await fileStorageService.downloadFile(profilePhotoS3Key);
      } catch (originalError) {
        if (originalError.code === 'NoSuchKey') {
          // Original file missing, try optimized versions
          const photoOptimization = user.get('profilePhotoOptimization');
          if (photoOptimization?.optimizedVariants) {
            const variants = ['jpeg', 'webp', 'avif']; // Try in order of preference

            for (const variant of variants) {
              const variantData = photoOptimization.optimizedVariants[variant];
              if (variantData?.s3Key && !fileBuffer) {
                try {
                  fileBuffer = await fileStorageService.downloadFile(variantData.s3Key);
                  actualS3Key = variantData.s3Key;
                  contentType = getContentTypeFromS3Key(actualS3Key);
                  logger.info('Using optimized variant for employee photo', {
                    employeeId,
                    originalS3Key: profilePhotoS3Key,
                    variantS3Key: actualS3Key,
                    format: variant,
                  });
                } catch (variantError) {
                  // Variant failed, will try next one
                }
              }
            }
          }

          if (!fileBuffer) {
            throw originalError; // No variants worked, throw original error
          }
        } else {
          throw originalError; // Not a NoSuchKey error, re-throw
        }
      }

      // Set appropriate headers
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        ETag: `"${employeeId}-${Date.now()}"`, // Simple ETag
      });

      // Send the file
      res.send(fileBuffer);
    } catch (downloadError) {
      logger.error('Failed to download employee photo from S3', {
        employeeId,
        s3Key: profilePhotoS3Key,
        error: downloadError.message,
        code: downloadError.code,
      });

      // If file doesn't exist in S3, return 404 instead of 500
      if (downloadError.code === 'NoSuchKey') {
        return res.status(404).json({
          success: false,
          error: 'Profile photo not found in storage',
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve profile photo',
      });
    }
  } catch (error) {
    logger.error('Error in serveEmployeePhotoRoute', {
      employeeId: req.params.employeeId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

module.exports = {
  serveEmployeePhotoRoute,
};
