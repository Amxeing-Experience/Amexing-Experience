/**
 * BillingController - Handles billing information operations
 * Provides API endpoints for managing user billing data
 * Created by Denisse Maldonado.
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');

class BillingController {
  /**
   * Get user's billing information
   * GET /api/billing/get.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with billing information.
   * @example
   * GET /api/billing/get
   * Response: { success: true, data: { billingInfo: {...} } }
   */
  async getBillingInfo(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      // Get user from AmexingUser table
      const userQuery = new Parse.Query('AmexingUser');
      userQuery.equalTo('objectId', userId);
      userQuery.equalTo('active', true);
      userQuery.equalTo('exists', true);

      const user = await userQuery.first({ useMasterKey: true });

      if (!user) {
        return this.sendError(res, 'User not found', 404);
      }

      // Get billing information
      const billingInfo = user.get('billingInfo') || {};

      logger.info('Billing information retrieved', {
        userId,
        userEmail: user.get('email'),
        hasBillingInfo: Object.keys(billingInfo).length > 0,
      });

      return this.sendSuccess(res, {
        billingInfo,
      });
    } catch (error) {
      logger.error('Error retrieving billing information:', error);
      return this.sendError(res, 'Failed to retrieve billing information', 500);
    }
  }

  /**
   * Save user's billing information
   * POST /api/billing/save.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with saved billing information.
   * @example
   * POST /api/billing/save
   * Body: { rfc: 'RFC123456789', razonSocial: 'Company Name' }
   * Response: { success: true, data: { billingInfo: {...} } }
   */
  async saveBillingInfo(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      const user = await this.getUserById(userId);
      if (!user) {
        return this.sendError(res, 'User not found', 404);
      }

      const billingInfo = this.validateBillingData(req.body);
      if (billingInfo.error) {
        return this.sendError(res, billingInfo.error, 400);
      }

      // Update user's billing information
      user.set('billingInfo', billingInfo.data);
      const savedUser = await user.save(null, { useMasterKey: true });

      logger.info('Billing information updated', {
        userId,
        userEmail: user.get('email'),
        fields: Object.keys(billingInfo.data),
      });

      return this.sendSuccess(res, {
        message: 'Billing information updated successfully',
        billingInfo: savedUser.get('billingInfo'),
      });
    } catch (error) {
      logger.error('Error saving billing information:', error);
      return this.sendError(res, 'Failed to save billing information', 500);
    }
  }

  /**
   * Get user by ID from AmexingUser table.
   * @param {string} userId - User ID.
   * @returns {Promise<Parse.Object|null>} User object or null.
   * @example
   * const user = await this.getUserById('abc123');
   * if (user) console.log(user.get('email'));
   */
  async getUserById(userId) {
    const userQuery = new Parse.Query('AmexingUser');
    userQuery.equalTo('objectId', userId);
    userQuery.equalTo('active', true);
    userQuery.equalTo('exists', true);
    return userQuery.first({ useMasterKey: true });
  }

  /**
   * Validate billing data.
   * @param {object} body - Request body with billing data.
   * @returns {object} Validation result with data or error.
   * @example
   * const result = this.validateBillingData({ rfc: 'ABC123456789' });
   * if (result.error) console.error(result.error);
   */
  validateBillingData(body) {
    const allowedFields = [
      'rfc',
      'regimenFiscal',
      'usoCfdi',
      'razonSocial',
      'direccion',
      'codigoPostal',
      'emailFacturacion',
    ];

    const billingInfo = {};
    allowedFields.forEach((field) => {
      if (body[field] !== undefined && body[field] !== '') {
        billingInfo[field] = body[field];
      }
    });

    // RFC validation for Mexican tax requirements
    if (billingInfo.rfc) {
      const rfc = billingInfo.rfc.toUpperCase().trim();
      const isValidRFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-V1-9][A-Z1-9][0-9A]$/.test(rfc);

      if (!isValidRFC) {
        return { error: 'RFC format is invalid' };
      }
      billingInfo.rfc = rfc;
    }

    // Código Postal validation (Mexican postal codes are 5 digits)
    if (billingInfo.codigoPostal) {
      const cp = billingInfo.codigoPostal.toString().trim();
      const isValidCP = /^[0-9]{5}$/.test(cp);

      if (!isValidCP) {
        return { error: 'Código Postal must be 5 digits' };
      }
      billingInfo.codigoPostal = cp;
    }

    return { data: billingInfo };
  }

  /**
   * Send success response.
   * @param {object} res - Express response object.
   * @param {object} data - Data to send.
   * @param {string} message - Success message.
   * @param {number} statusCode - HTTP status code.
   * @returns {void} Sends JSON response.
   * @example
   * this.sendSuccess(res, { user: userData }, 'User created', 201);
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
   * Get billing information for any user (admin access)
   * GET /api/billing/get-user/:userId.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Response with user billing information.
   * @example
   * GET /api/billing/get-user/abc123
   * Response: { success: true, data: { billingInfo: {...} } }
   */
  async getUserBillingInfo(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user?.id;
      const currentUserRole = req.userRole;

      if (!currentUserId) {
        return this.sendError(res, 'User not authenticated', 401);
      }

      logger.info('Billing info access attempt', {
        currentUserId,
        currentUserRole,
        targetUserId: userId,
        userObject: req.user,
      });

      // Only admins and superadmins can access other users' billing info
      if (!['admin', 'superadmin'].includes(currentUserRole)) {
        logger.warn('Insufficient permissions for billing access', {
          currentUserId,
          currentUserRole,
          requiredRoles: ['admin', 'superadmin'],
        });
        return this.sendError(res, 'Insufficient permissions', 403);
      }

      if (!userId) {
        return this.sendError(res, 'User ID is required', 400);
      }

      // Get target user from AmexingUser table
      const user = await this.getUserById(userId);
      if (!user) {
        return this.sendError(res, 'User not found', 404);
      }

      // Get billing information
      const billingInfo = user.get('billingInfo') || {};

      logger.info('Admin accessed user billing information', {
        adminId: currentUserId,
        adminRole: currentUserRole,
        targetUserId: userId,
        targetUserEmail: user.get('email'),
        hasBillingInfo: Object.keys(billingInfo).length > 0,
      });

      return this.sendSuccess(res, {
        billingInfo,
        user: {
          id: user.id,
          email: user.get('email'),
          fullName: user.get('fullName'),
        },
      });
    } catch (error) {
      logger.error('Error retrieving user billing information:', error);
      return this.sendError(res, 'Failed to retrieve user billing information', 500);
    }
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {void} Sends JSON error response.
   * @example
   * this.sendError(res, 'User not found', 404);
   */
  sendError(res, message, statusCode = 500) {
    res.status(statusCode).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = BillingController;
