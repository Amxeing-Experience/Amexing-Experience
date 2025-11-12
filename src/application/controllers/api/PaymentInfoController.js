/**
 * PaymentInfoController - API controller for payment information management.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const PaymentInfo = require('../../../domain/models/PaymentInfo');
const logger = require('../../../infrastructure/logger');

/**
 * Controller for payment information management.
 * Only accessible by admin and superadmin roles.
 */
class PaymentInfoController {
  constructor() {
    this.allowedRoles = ['admin', 'superadmin'];
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} message - Error message.
   * @param {number} status - HTTP status code.
   * @example
   */
  sendError(res, message, status = 500) {
    return res.status(status).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get all payment info options
   * GET /api/payment-info.
   * @param req
   * @param res
   * @example
   */
  async getAll(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para acceder a esta información', 403);
      }

      const paymentInfos = await PaymentInfo.getActivePaymentInfos();

      return res.json({
        success: true,
        data: paymentInfos,
        count: paymentInfos.length,
      });
    } catch (error) {
      logger.error('Error fetching payment infos', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener información de pago', 500);
    }
  }

  /**
   * Get payment info by ID
   * GET /api/payment-info/:id.
   * @param req
   * @param res
   * @example
   */
  async getById(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para acceder a esta información', 403);
      }

      const { id } = req.params;
      const paymentInfo = await PaymentInfo.getPaymentInfoById(id);

      return res.json({
        success: true,
        data: paymentInfo,
      });
    } catch (error) {
      logger.error('Error fetching payment info', {
        error: error.message,
        paymentInfoId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === 101) {
        return this.sendError(res, 'Información de pago no encontrada', 404);
      }

      return this.sendError(res, 'Error al obtener información de pago', 500);
    }
  }

  /**
   * Get default payment info
   * GET /api/payment-info/default.
   * @param req
   * @param res
   * @example
   */
  async getDefault(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para acceder a esta información', 403);
      }

      const defaultInfo = await PaymentInfo.getDefaultPaymentInfo();

      if (!defaultInfo) {
        return res.json({
          success: true,
          data: null,
          message: 'No hay información de pago por defecto configurada',
        });
      }

      return res.json({
        success: true,
        data: defaultInfo,
      });
    } catch (error) {
      logger.error('Error fetching default payment info', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al obtener información de pago por defecto', 500);
    }
  }

  /**
   * Create new payment info
   * POST /api/payment-info.
   * @param req
   * @param res
   * @example
   */
  async create(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para crear información de pago', 403);
      }

      const {
        name, bank, accountHolder, accountNumber,
        routingNumber, achRoutingNumber, swiftCode, iban,
        zelle, paypal, venmo, notes, currency, isDefault,
      } = req.body;

      // Validate required fields
      if (!name || !bank || !accountHolder) {
        return this.sendError(res, 'Nombre, banco y titular de cuenta son requeridos', 400);
      }

      const paymentInfo = await PaymentInfo.createPaymentInfo({
        name,
        bank,
        accountHolder,
        accountNumber,
        routingNumber,
        achRoutingNumber,
        swiftCode,
        iban,
        zelle,
        paypal,
        venmo,
        notes,
        currency,
        isDefault,
      });

      logger.info('Payment info created', {
        paymentInfoId: paymentInfo.id,
        name: paymentInfo.get('name'),
        createdBy: req.user.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Información de pago creada exitosamente',
        data: PaymentInfo.formatPaymentInfo(paymentInfo),
      });
    } catch (error) {
      logger.error('Error creating payment info', {
        error: error.message,
        userId: req.user?.id,
      });
      return this.sendError(res, 'Error al crear información de pago', 500);
    }
  }

  /**
   * Update payment info
   * PUT /api/payment-info/:id.
   * @param req
   * @param res
   * @example
   */
  async update(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para actualizar información de pago', 403);
      }

      const { id } = req.params;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.id;
      delete updates.createdAt;
      delete updates.updatedAt;

      const paymentInfo = await PaymentInfo.updatePaymentInfo(id, updates);

      logger.info('Payment info updated', {
        paymentInfoId: id,
        updatedBy: req.user.id,
        updates,
      });

      return res.json({
        success: true,
        message: 'Información de pago actualizada exitosamente',
        data: PaymentInfo.formatPaymentInfo(paymentInfo),
      });
    } catch (error) {
      logger.error('Error updating payment info', {
        error: error.message,
        paymentInfoId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === 101) {
        return this.sendError(res, 'Información de pago no encontrada', 404);
      }

      return this.sendError(res, 'Error al actualizar información de pago', 500);
    }
  }

  /**
   * Delete payment info (soft delete)
   * DELETE /api/payment-info/:id.
   * @param req
   * @param res
   * @example
   */
  async delete(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para eliminar información de pago', 403);
      }

      const { id } = req.params;

      await PaymentInfo.deletePaymentInfo(id);

      logger.info('Payment info deleted', {
        paymentInfoId: id,
        deletedBy: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Información de pago eliminada exitosamente',
      });
    } catch (error) {
      logger.error('Error deleting payment info', {
        error: error.message,
        paymentInfoId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === 101) {
        return this.sendError(res, 'Información de pago no encontrada', 404);
      }

      return this.sendError(res, 'Error al eliminar información de pago', 500);
    }
  }

  /**
   * Set payment info as default
   * POST /api/payment-info/:id/set-default.
   * @param req
   * @param res
   * @example
   */
  async setAsDefault(req, res) {
    try {
      // Check user role
      if (!this.allowedRoles.includes(req.userRole)) {
        return this.sendError(res, 'No autorizado para cambiar configuración por defecto', 403);
      }

      const { id } = req.params;

      const paymentInfo = await PaymentInfo.updatePaymentInfo(id, { isDefault: true });

      logger.info('Payment info set as default', {
        paymentInfoId: id,
        setBy: req.user.id,
      });

      return res.json({
        success: true,
        message: 'Información de pago establecida como predeterminada',
        data: PaymentInfo.formatPaymentInfo(paymentInfo),
      });
    } catch (error) {
      logger.error('Error setting payment info as default', {
        error: error.message,
        paymentInfoId: req.params.id,
        userId: req.user?.id,
      });

      if (error.code === 101) {
        return this.sendError(res, 'Información de pago no encontrada', 404);
      }

      return this.sendError(res, 'Error al establecer información de pago por defecto', 500);
    }
  }
}

const paymentInfoController = new PaymentInfoController();

// Bind methods to maintain proper context when used in Express routes
module.exports = {
  getAll: paymentInfoController.getAll.bind(paymentInfoController),
  getById: paymentInfoController.getById.bind(paymentInfoController),
  getDefault: paymentInfoController.getDefault.bind(paymentInfoController),
  create: paymentInfoController.create.bind(paymentInfoController),
  update: paymentInfoController.update.bind(paymentInfoController),
  delete: paymentInfoController.delete.bind(paymentInfoController),
  setAsDefault: paymentInfoController.setAsDefault.bind(paymentInfoController),
};
