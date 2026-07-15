/**
 * BillingProfileController - Handles multiple billing profile operations per user.
 * Provides API endpoints for managing user billing profiles with support for
 * Mexico-specific tax validation (RFC, Codigo Postal) and international profiles.
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

/**
 * Billing Profile Controller for managing multiple billing profiles per user.
 * Handles CRUD operations, file uploads (constancia fiscal, additional documents),
 * and admin access to user profiles in PCI DSS compliant manner.
 * @class BillingProfileController
 * @author Denisse Maldonado
 * @since 1.0.0
 */
class BillingProfileController {
  /**
   * Create a new BillingProfileController instance.
   * @param {object} deps - Injected dependencies.
   * @param {object} [deps.fileStorageService] - File storage service for S3 uploads.
   * @example
   */
  constructor({ fileStorageService } = {}) {
    /** @type {object} */
    this.fileStorageService = fileStorageService || null;
    /** @type {string[]} */
    this.adminRoles = ['superadmin', 'admin'];
  }

  /**
   * Lazily initialize the file storage service if not injected.
   * @returns {object} FileStorageService instance.
   * @private
   * @example
   */
  getFileStorageService() {
    if (!this.fileStorageService) {
      const FileStorageService = require('../../services/FileStorageService');
      this.fileStorageService = new FileStorageService({
        baseFolder: 'billing-profiles',
        isPublic: false,
        deletionStrategy: 'move',
        presignedUrlExpires: 3600,
      });
    }
    return this.fileStorageService;
  }

  /**
   * List current user's billing profiles.
   * GET /api/billing-profiles.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with array of billing profiles.
   * @example
   * GET /api/billing-profiles
   * Response: { success: true, data: { profiles: [...] } }
   */
  async list(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userPointer = AmexingUser.createWithoutData(userId);

      const query = new Parse.Query('BillingProfile');
      query.equalTo('userPtr', userPointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.descending('isPrimary');
      query.addDescending('createdAt');

      const profiles = await query.find({ useMasterKey: true });

      const data = await Promise.all(profiles.map((profile) => this.serializeProfile(profile)));

      logger.info('Billing profiles listed', {
        userId,
        count: data.length,
      });

      return this.sendSuccess(res, { profiles: data });
    } catch (error) {
      logger.error('Error listing billing profiles:', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to list billing profiles', 500);
    }
  }

  /**
   * Get a single billing profile by ID.
   * GET /api/billing-profiles/:id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with billing profile data.
   * @example
   * GET /api/billing-profiles/abc123
   * Response: { success: true, data: { profile: {...} } }
   */
  async getById(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      logger.info('Billing profile retrieved', {
        profileId: id,
        userId,
        userRole,
      });

      return this.sendSuccess(res, { profile: await this.serializeProfile(profile) });
    } catch (error) {
      logger.error('Error retrieving billing profile:', {
        error: error.message,
        profileId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to retrieve billing profile', 500);
    }
  }

  /**
   * Create a new billing profile for the current user.
   * POST /api/billing-profiles.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with created billing profile.
   * @example
   * POST /api/billing-profiles
   * Body: { razonSocial: 'Company', rfc: 'ABC123456789', country: 'MX', isPrimary: true }
   * Response: { success: true, data: { profile: {...} } }
   */
  async create(req, res) {
    try {
      const currentUserId = req.user?.id;

      if (!currentUserId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      // Dueño del perfil: por defecto el usuario autenticado. Si viene :userId en la ruta
      // (admin/dept_manager creando a nombre de una agencia), se resuelve el destino y se valida.
      let userId = currentUserId;
      if (req.params.userId) {
        const effectiveRole = req.userRole || req.user?.role;
        const allowedRoles = [...this.adminRoles, 'department_manager', 'client'];
        if (!allowedRoles.includes(effectiveRole)) {
          return this.sendError(res, 'Insufficient permissions', 403);
        }
        let targetId = req.params.userId;
        // Si el id es un registro Client, resolver al department_manager dueño.
        const clientRecord = await new Parse.Query('Client')
          .include('createdBy')
          .get(targetId, { useMasterKey: true })
          .catch(() => null);
        if (clientRecord) {
          const createdBy = clientRecord.get('createdBy');
          if (createdBy) targetId = createdBy.id;
        }
        // Verificar que el usuario destino existe y está activo.
        const targetQuery = new Parse.Query('AmexingUser');
        targetQuery.equalTo('objectId', targetId);
        targetQuery.equalTo('active', true);
        targetQuery.equalTo('exists', true);
        const targetUser = await targetQuery.first({ useMasterKey: true });
        if (!targetUser) {
          return this.sendError(res, 'Target user not found', 404);
        }
        userId = targetId;
      }

      const validation = this.validateProfileData(req.body);
      if (validation.error) {
        return this.sendError(res, validation.error, 400);
      }

      const profileData = validation.data;
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userPointer = AmexingUser.createWithoutData(userId);

      // If isPrimary, unset isPrimary on other profiles
      if (profileData.isPrimary) {
        await this.unsetPrimaryForUser(userPointer);
      }

      const profile = new Parse.Object('BillingProfile');
      profile.set('userPtr', userPointer);
      profile.set('active', true);
      profile.set('exists', true);

      // Set all validated fields
      Object.keys(profileData).forEach((key) => {
        profile.set(key, profileData[key]);
      });

      const savedProfile = await profile.save(null, { useMasterKey: true });

      logger.info('Billing profile created', {
        profileId: savedProfile.id,
        userId,
        isPrimary: profileData.isPrimary || false,
        country: profileData.country || 'MX',
      });

      return this.sendSuccess(res, {
        message: 'Billing profile created successfully',
        profile: await this.serializeProfile(savedProfile),
      }, 'Billing profile created successfully', 201);
    } catch (error) {
      logger.error('Error creating billing profile:', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, `Failed to create billing profile: ${error.message}`, 500);
    }
  }

  /**
   * Update an existing billing profile.
   * PUT /api/billing-profiles/:id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with updated billing profile.
   * @example
   * PUT /api/billing-profiles/abc123
   * Body: { razonSocial: 'Updated Company', isPrimary: true }
   * Response: { success: true, data: { profile: {...} } }
   */
  async update(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const validation = this.validateProfileData(req.body);
      if (validation.error) {
        return this.sendError(res, validation.error, 400);
      }

      const profileData = validation.data;

      // If isPrimary changed to true, unset others
      if (profileData.isPrimary && !profile.get('isPrimary')) {
        const ownerPointer = profile.get('userPtr');
        await this.unsetPrimaryForUser(ownerPointer);
      }

      // Update all validated fields
      Object.keys(profileData).forEach((key) => {
        profile.set(key, profileData[key]);
      });

      const savedProfile = await profile.save(null, { useMasterKey: true });

      logger.info('Billing profile updated', {
        profileId: id,
        userId,
        userRole,
        updatedFields: Object.keys(profileData),
      });

      return this.sendSuccess(res, {
        message: 'Billing profile updated successfully',
        profile: await this.serializeProfile(savedProfile),
      });
    } catch (error) {
      logger.error('Error updating billing profile:', {
        error: error.message,
        profileId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to update billing profile', 500);
    }
  }

  /**
   * Soft delete a billing profile.
   * DELETE /api/billing-profiles/:id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response confirming deletion.
   * @example
   * DELETE /api/billing-profiles/abc123
   * Response: { success: true, data: { message: 'Billing profile removed' } }
   */
  async remove(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const wasPrimary = profile.get('isPrimary');
      const ownerPointer = profile.get('userPtr');

      // Soft delete
      profile.set('exists', false);
      profile.set('isPrimary', false);
      await profile.save(null, { useMasterKey: true });

      // If was primary, make next available profile primary
      if (wasPrimary) {
        await this.promoteNextPrimary(ownerPointer);
      }

      logger.info('Billing profile soft deleted', {
        profileId: id,
        userId,
        userRole,
        wasPrimary,
      });

      return this.sendSuccess(res, {
        message: 'Billing profile removed successfully',
      });
    } catch (error) {
      logger.error('Error removing billing profile:', {
        error: error.message,
        profileId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to remove billing profile', 500);
    }
  }

  /**
   * Get billing profiles for a specific user (admin only).
   * GET /api/billing-profiles/user/:userId.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with array of billing profiles for specified user.
   * @example
   * GET /api/billing-profiles/user/xyz789
   * Response: { success: true, data: { profiles: [...], user: {...} } }
   */
  async getByUser(req, res) {
    try {
      const currentUserId = req.user?.id;
      const currentUserRole = req.userRole;

      if (!currentUserId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const effectiveRole = currentUserRole || req.user?.role;

      // Allow admins, department_managers, and clients to access
      const allowedRoles = [...this.adminRoles, 'department_manager', 'client'];
      if (!allowedRoles.includes(effectiveRole)) {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      let { userId } = req.params;
      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // If the userId is a Client record ID (not a user), resolve to the department manager
      const clientQuery = new Parse.Query('Client');
      clientQuery.include('createdBy');
      const clientRecord = await clientQuery.get(userId, { useMasterKey: true }).catch(() => null);
      if (clientRecord) {
        const createdBy = clientRecord.get('createdBy');
        if (createdBy) {
          userId = createdBy.id;
        }
      }

      // Verify target user exists
      const userQuery = new Parse.Query('AmexingUser');
      userQuery.equalTo('objectId', userId);
      userQuery.equalTo('active', true);
      userQuery.equalTo('exists', true);
      const targetUser = await userQuery.first({ useMasterKey: true });

      if (!targetUser) {
        return this.sendError(res, 'User not found', 404);
      }

      const AmexingUser = Parse.Object.extend('AmexingUser');
      const userPointer = AmexingUser.createWithoutData(userId);

      const query = new Parse.Query('BillingProfile');
      query.equalTo('userPtr', userPointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.descending('isPrimary');
      query.addDescending('createdAt');

      const profiles = await query.find({ useMasterKey: true });

      const data = await Promise.all(profiles.map((profile) => this.serializeProfile(profile)));

      logger.info('Admin accessed user billing profiles', {
        adminId: currentUserId,
        adminRole: currentUserRole,
        targetUserId: userId,
        targetUserEmail: targetUser.get('email'),
        count: data.length,
      });

      return this.sendSuccess(res, {
        profiles: data,
        user: {
          id: targetUser.id,
          email: targetUser.get('email'),
          fullName: targetUser.get('fullName'),
        },
      });
    } catch (error) {
      logger.error('Error retrieving user billing profiles:', {
        error: error.message,
        targetUserId: req.params.userId,
        adminId: req.user?.id,
      });
      return this.sendError(res, 'Failed to retrieve user billing profiles', 500);
    }
  }

  /**
   * Upload constancia fiscal file for a billing profile.
   * POST /api/billing-profiles/:id/upload-constancia.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with upload result.
   * @example
   * POST /api/billing-profiles/abc123/upload-constancia
   * Body: { fileData: "data:application/pdf;base64,...", fileName: "constancia.pdf" }
   * Response: { success: true, data: { constanciaFiscalUrl: "...", ... } }
   */
  async uploadConstancia(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const { fileData, fileName } = req.body;

      if (!fileData || !fileName) {
        return this.sendError(res, 'fileData and fileName are required', 400);
      }

      // Parse base64 data - extract from data URL
      let mimeType = 'application/pdf';
      let base64Data = fileData;
      const commaIdx = fileData.indexOf(',');
      if (commaIdx > -1 && fileData.startsWith('data:')) {
        const header = fileData.substring(0, commaIdx);
        const typeMatch = header.match(/data:([^;]+)/);
        if (typeMatch) mimeType = typeMatch[1];
        base64Data = fileData.substring(commaIdx + 1);
      }
      // Trim whitespace/newlines from base64
      base64Data = base64Data.replace(/\s/g, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Validate file type (PDF only for constancia fiscal)
      if (mimeType !== 'application/pdf') {
        return this.sendError(res, 'La constancia fiscal debe ser un archivo PDF', 400);
      }

      // Validate buffer starts with PDF header
      const pdfHeader = buffer.slice(0, 5).toString('ascii');
      if (pdfHeader !== '%PDF-') {
        logger.error('Uploaded constancia is not a valid PDF', { pdfHeader, bufferLength: buffer.length });
        return this.sendError(res, `El archivo no es un PDF valido (header: ${pdfHeader}, size: ${buffer.length} bytes)`, 400);
      }

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueFileName = `constancia_${id}_${timestamp}_${sanitizedName}`;

      let uploadResult;
      let storageMethod = 'gridfs';

      // Try S3 first if configured
      if (process.env.S3_BUCKET && process.env.AWS_REGION) {
        try {
          const fileStorageService = this.getFileStorageService();

          uploadResult = await fileStorageService.uploadFile(buffer, uniqueFileName, mimeType, {
            entityId: id,
            metadata: {
              profileId: id,
              type: 'constancia_fiscal',
              originalName: fileName,
              uploadedBy: userId,
              uploadedAt: new Date().toISOString(),
            },
          });

          storageMethod = 's3';

          logger.info('Constancia fiscal uploaded to S3', {
            profileId: id,
            s3Key: uploadResult.s3Key,
            storageMethod,
          });
        } catch (s3Error) {
          logger.warn('S3 upload failed for constancia fiscal, falling back to GridFS', {
            error: s3Error.message,
            profileId: id,
          });
          uploadResult = null;
        }
      }

      // Fallback to GridFS
      if (!uploadResult) {
        const parseFile = new Parse.File(uniqueFileName, buffer, mimeType);
        await parseFile.save(null, { useMasterKey: true });

        uploadResult = {
          s3Key: parseFile.name(),
          s3Url: parseFile.url(),
          bucket: 'gridfs',
          region: 'local',
        };
      }

      // Update profile with constancia fiscal information
      profile.set('constanciaFiscalS3Key', uploadResult.s3Key);
      profile.set('constanciaFiscalUrl', uploadResult.s3Url || '');
      profile.set('constanciaFiscalUploadDate', new Date());
      profile.set('constanciaFiscalStorageMethod', storageMethod);

      await profile.save(null, { useMasterKey: true });

      logger.info('Constancia fiscal uploaded successfully', {
        profileId: id,
        userId,
        storageMethod,
        fileSize: buffer.length,
        originalFilename: fileName,
      });

      return this.sendSuccess(res, {
        message: 'Constancia fiscal uploaded successfully',
        constanciaFiscalS3Key: uploadResult.s3Key,
        constanciaFiscalUrl: uploadResult.s3Url || '',
        constanciaFiscalUploadDate: profile.get('constanciaFiscalUploadDate'),
        storageMethod,
      });
    } catch (error) {
      logger.error('Error uploading constancia fiscal:', {
        error: error.message,
        profileId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to upload constancia fiscal', 500);
    }
  }

  /**
   * Download constancia fiscal — redirects to a presigned S3 URL with inline disposition.
   * GET /api/billing-profiles/:id/download-constancia.
   * @param req
   * @param res
   * @example
   */
  async downloadConstancia(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) return this.sendError(res, 'User not authenticated', 401);

      const { id } = req.params;
      const profile = await this.getProfileById(id);
      if (!profile) return this.sendError(res, 'Profile not found', 404);

      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || null;
      const effectiveRole = req.userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const s3Key = profile.get('constanciaFiscalS3Key');
      if (!s3Key) return this.sendError(res, 'No constancia uploaded', 404);

      const storageMethod = profile.get('constanciaFiscalStorageMethod') || '';

      if (storageMethod === 'gridfs') {
        const fileUrl = profile.get('constanciaFiscalUrl');
        return res.redirect(fileUrl);
      }

      // Stream from S3 directly to response (avoids presigned URL browser issues)
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-2' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="constancia.pdf"');

      const stream = s3.getObject({ Bucket: process.env.S3_BUCKET, Key: s3Key }).createReadStream();
      stream.on('error', (err) => {
        logger.error('S3 stream error:', { error: err.message, s3Key });
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Error streaming file' });
        }
      });
      stream.pipe(res);
    } catch (error) {
      logger.error('Error downloading constancia:', { error: error.message, profileId: req.params.id });
      if (!res.headersSent) {
        return this.sendError(res, 'Error downloading constancia', 500);
      }
    }
  }

  /**
   * Upload an additional document for a billing profile.
   * POST /api/billing-profiles/:id/upload-document.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with updated documents array.
   * @example
   * POST /api/billing-profiles/abc123/upload-document
   * Body: { fileData: "data:application/pdf;base64,...", fileName: "doc.pdf" }
   * Response: { success: true, data: { additionalDocuments: [...] } }
   */
  async uploadDocument(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const { fileData, fileName } = req.body;

      if (!fileData || !fileName) {
        return this.sendError(res, 'fileData and fileName are required', 400);
      }

      // Parse base64 data - extract from data URL
      let mimeType = 'application/octet-stream';
      let base64Data = fileData;
      const commaIdx = fileData.indexOf(',');
      if (commaIdx > -1 && fileData.startsWith('data:')) {
        const header = fileData.substring(0, commaIdx);
        const typeMatch = header.match(/data:([^;]+)/);
        if (typeMatch) mimeType = typeMatch[1];
        base64Data = fileData.substring(commaIdx + 1);
      }
      base64Data = base64Data.replace(/\s/g, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueFileName = `doc_${id}_${timestamp}_${sanitizedName}`;

      let uploadResult;
      let storageMethod = 'gridfs';

      // Try S3 first if configured
      if (process.env.S3_BUCKET && process.env.AWS_REGION) {
        try {
          const fileStorageService = this.getFileStorageService();

          uploadResult = await fileStorageService.uploadFile(buffer, uniqueFileName, mimeType, {
            entityId: id,
            metadata: {
              profileId: id,
              type: 'additional_document',
              originalName: fileName,
              uploadedBy: userId,
              uploadedAt: new Date().toISOString(),
            },
          });

          storageMethod = 's3';
        } catch (s3Error) {
          logger.warn('S3 upload failed for document, falling back to GridFS', {
            error: s3Error.message,
            profileId: id,
          });
          uploadResult = null;
        }
      }

      // Fallback to GridFS
      if (!uploadResult) {
        const parseFile = new Parse.File(uniqueFileName, buffer, mimeType);
        await parseFile.save(null, { useMasterKey: true });

        uploadResult = {
          s3Key: parseFile.name(),
          s3Url: parseFile.url(),
          bucket: 'gridfs',
          region: 'local',
        };
      }

      // Add document to additionalDocuments array
      const additionalDocuments = profile.get('additionalDocuments') || [];
      additionalDocuments.push({
        s3Key: uploadResult.s3Key,
        url: uploadResult.s3Url || '',
        fileName,
        mimeType,
        fileSize: buffer.length,
        storageMethod,
        uploadedAt: new Date().toISOString(),
        uploadedBy: userId,
      });

      profile.set('additionalDocuments', additionalDocuments);
      await profile.save(null, { useMasterKey: true });

      logger.info('Additional document uploaded', {
        profileId: id,
        userId,
        storageMethod,
        documentCount: additionalDocuments.length,
        originalFilename: fileName,
      });

      return this.sendSuccess(res, {
        message: 'Document uploaded successfully',
        additionalDocuments,
      });
    } catch (error) {
      logger.error('Error uploading document:', {
        error: error.message,
        profileId: req.params.id,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to upload document', 500);
    }
  }

  /**
   * Remove an additional document from a billing profile by index.
   * DELETE /api/billing-profiles/:id/document/:docIndex.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with updated documents array.
   * @example
   * DELETE /api/billing-profiles/abc123/document/0
   * Response: { success: true, data: { additionalDocuments: [...] } }
   */
  async removeDocument(req, res) {
    try {
      const userId = req.user?.id;
      const { userRole } = req;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const { id, docIndex } = req.params;
      if (!id) {
        return this.sendError(res, 'Profile ID is required', 400);
      }

      const index = parseInt(docIndex, 10);
      if (Number.isNaN(index) || index < 0) {
        return this.sendError(res, 'Valid document index is required', 400);
      }

      const profile = await this.getProfileById(id);
      if (!profile) {
        return this.sendError(res, 'Billing profile not found', 404);
      }

      // Verify ownership or admin role
      const userPtrObj = profile.get('userPtr');
      const profileUserId = userPtrObj?.id || userPtrObj?.objectId || (typeof userPtrObj === 'string' ? userPtrObj : null);
      const effectiveRole = userRole || req.user?.role;
      if (profileUserId !== userId && !this.adminRoles.includes(effectiveRole)) {
        logger.warn('Billing profile access denied', { profileUserId, userId, effectiveRole });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      const additionalDocuments = profile.get('additionalDocuments') || [];

      if (index >= additionalDocuments.length) {
        return this.sendError(res, 'Document index out of range', 400);
      }

      const removedDoc = additionalDocuments[index];
      additionalDocuments.splice(index, 1);

      profile.set('additionalDocuments', additionalDocuments);
      await profile.save(null, { useMasterKey: true });

      logger.info('Additional document removed', {
        profileId: id,
        userId,
        removedDocFileName: removedDoc.fileName,
        remainingCount: additionalDocuments.length,
      });

      return this.sendSuccess(res, {
        message: 'Document removed successfully',
        additionalDocuments,
      });
    } catch (error) {
      logger.error('Error removing document:', {
        error: error.message,
        profileId: req.params.id,
        docIndex: req.params.docIndex,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Failed to remove document', 500);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get a billing profile by ID (exists=true, active=true).
   * @param {string} profileId - Profile object ID.
   * @returns {Promise<Parse.Object|null>} Profile or null.
   * @private
   * @example
   */
  async getProfileById(profileId) {
    try {
      const query = new Parse.Query('BillingProfile');
      query.include('userPtr');
      const profile = await query.get(profileId, { useMasterKey: true });
      // Check soft-delete flags
      if (!profile || profile.get('exists') === false || profile.get('active') === false) {
        return null;
      }
      return profile;
    } catch (error) {
      // Parse throws if object not found
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) return null;
      throw error;
    }
  }

  /**
   * Unset isPrimary on all billing profiles for a given user.
   * @param {Parse.User} userPointer - User pointer.
   * @returns {Promise<void>}
   * @private
   * @example
   */
  async unsetPrimaryForUser(userPointer) {
    const query = new Parse.Query('BillingProfile');
    query.equalTo('userPtr', userPointer);
    query.equalTo('exists', true);
    query.equalTo('active', true);
    query.equalTo('isPrimary', true);

    const primaries = await query.find({ useMasterKey: true });

    const savePromises = primaries.map((p) => {
      p.set('isPrimary', false);
      return p.save(null, { useMasterKey: true });
    });

    await Promise.all(savePromises);
  }

  /**
   * Promote the next available profile to primary for a user.
   * @param {Parse.User} userPointer - User pointer.
   * @returns {Promise<void>}
   * @private
   * @example
   */
  async promoteNextPrimary(userPointer) {
    const query = new Parse.Query('BillingProfile');
    query.equalTo('userPtr', userPointer);
    query.equalTo('exists', true);
    query.equalTo('active', true);
    query.descending('createdAt');
    query.limit(1);

    const nextProfile = await query.first({ useMasterKey: true });
    if (nextProfile) {
      nextProfile.set('isPrimary', true);
      await nextProfile.save(null, { useMasterKey: true });

      logger.info('Next billing profile promoted to primary', {
        profileId: nextProfile.id,
        userId: userPointer.id,
      });
    }
  }

  /**
   * Validate billing profile data based on country.
   * @param {object} body - Request body.
   * @returns {object} Validation result { data } or { error }.
   * @private
   * @example
   */
  validateProfileData(body) {
    const allowedFields = [
      'country', 'label', 'isPrimary',
      // Contact information
      'firstName', 'lastName', 'phone', 'emailFacturacion',
      // Mexico-specific fields
      'rfc', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'codigoPostal',
      // International fields
      'taxId', 'commercialName',
      // Address fields
      'streetType', 'street', 'exteriorNumber', 'interiorNumber',
      'colonia', 'city', 'state', 'postalCode',
    ];

    const profileData = {};
    allowedFields.forEach((field) => {
      if (body[field] !== undefined) {
        profileData[field] = body[field];
      }
    });

    // Map billingEmail alias to emailFacturacion
    if (body.billingEmail !== undefined && !profileData.emailFacturacion) {
      profileData.emailFacturacion = body.billingEmail;
    }

    const country = profileData.country || 'MX';
    profileData.country = country;

    // Mexico-specific validations
    if (country === 'MX') {
      // RFC validation
      if (profileData.rfc) {
        const rfc = profileData.rfc.toUpperCase().trim();
        const isValidRFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-V1-9][A-Z1-9][0-9A]$/.test(rfc);

        if (!isValidRFC) {
          return { error: 'RFC format is invalid' };
        }
        profileData.rfc = rfc;
      }

      // Codigo Postal validation (5 digits)
      if (profileData.codigoPostal) {
        const cp = profileData.codigoPostal.toString().trim();
        const isValidCP = /^[0-9]{5}$/.test(cp);

        if (!isValidCP) {
          return { error: 'Codigo Postal must be 5 digits' };
        }
        profileData.codigoPostal = cp;
      }
    }

    // Email validation (if provided)
    if (profileData.emailFacturacion) {
      const email = profileData.emailFacturacion.trim().toLowerCase();
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      if (!isValidEmail) {
        return { error: 'Invalid billing email format' };
      }
      profileData.emailFacturacion = email;
    }

    // Boolean coercion for isPrimary
    if (profileData.isPrimary !== undefined) {
      profileData.isPrimary = Boolean(profileData.isPrimary);
    }

    return { data: profileData };
  }

  /**
   * Serialize a BillingProfile Parse object to plain JSON.
   * @param {Parse.Object} profile - BillingProfile Parse object.
   * @returns {object} Serialized profile data.
   * @private
   * @example
   */
  async serializeProfile(profile) {
    // Generate presigned URLs for private S3 files
    let constanciaUrl = '';
    const constanciaS3Key = profile.get('constanciaFiscalS3Key') || '';
    const constanciaStorageMethod = profile.get('constanciaFiscalStorageMethod') || '';
    if (constanciaS3Key) {
      if (constanciaStorageMethod === 'gridfs') {
        constanciaUrl = profile.get('constanciaFiscalUrl') || '';
      } else {
        try {
          const AWS = require('aws-sdk');
          const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-2' });
          constanciaUrl = s3.getSignedUrl('getObject', {
            Bucket: process.env.S3_BUCKET,
            Key: constanciaS3Key,
            Expires: 3600,
            ResponseContentType: 'application/pdf',
            ResponseContentDisposition: 'attachment; filename="constancia_fiscal.pdf"',
          });
        } catch (e) {
          constanciaUrl = profile.get('constanciaFiscalUrl') || '';
        }
      }
    }

    // Generate presigned URLs for additional documents
    const rawDocs = profile.get('additionalDocuments') || [];
    const additionalDocuments = [];
    for (const doc of rawDocs) {
      let docUrl = doc.url || '';
      if (doc.s3Key && doc.storageMethod !== 'gridfs') {
        try {
          const AWS = require('aws-sdk');
          const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-2' });
          docUrl = s3.getSignedUrl('getObject', {
            Bucket: process.env.S3_BUCKET,
            Key: doc.s3Key,
            Expires: 3600,
            ResponseContentDisposition: `attachment; filename="${doc.fileName || 'documento'}"`,
          });
        } catch (e) {
          // keep original url
        }
      }
      additionalDocuments.push({
        ...doc,
        url: docUrl,
      });
    }

    return {
      id: profile.id,
      objectId: profile.id,
      country: profile.get('country') || 'MX',
      label: profile.get('label') || '',
      isPrimary: profile.get('isPrimary') || false,
      // Contact information
      firstName: profile.get('firstName') || '',
      lastName: profile.get('lastName') || '',
      phone: profile.get('phone') || '',
      emailFacturacion: profile.get('emailFacturacion') || '',
      billingEmail: profile.get('emailFacturacion') || '',
      // Mexico-specific fields
      rfc: profile.get('rfc') || '',
      razonSocial: profile.get('razonSocial') || '',
      regimenFiscal: profile.get('regimenFiscal') || '',
      usoCfdi: profile.get('usoCfdi') || '',
      codigoPostal: profile.get('codigoPostal') || '',
      // International fields
      taxId: profile.get('taxId') || '',
      commercialName: profile.get('commercialName') || '',
      // Address fields
      streetType: profile.get('streetType') || '',
      street: profile.get('street') || '',
      streetName: profile.get('street') || '', // Alias for backward compatibility
      exteriorNumber: profile.get('exteriorNumber') || '',
      interiorNumber: profile.get('interiorNumber') || '',
      colonia: profile.get('colonia') || '',
      city: profile.get('city') || '',
      state: profile.get('state') || '',
      postalCode: profile.get('postalCode') || '',
      constancia: {
        s3Key: constanciaS3Key,
        url: constanciaUrl,
        uploadDate: profile.get('constanciaFiscalUploadDate') || null,
      },
      additionalDocuments,
      active: profile.get('active'),
      exists: profile.get('exists'),
      createdAt: profile.get('createdAt'),
      updatedAt: profile.get('updatedAt'),
    };
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Response data.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {void} Sends JSON response.
   * @example
   */
  sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {void} Sends JSON error response.
   * @example
   */
  sendError(res, error, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = BillingProfileController;
