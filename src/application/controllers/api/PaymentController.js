/**
 * PaymentController - API controller for reservation payments (admin/superadmin).
 *
 * CRUD over Payment records for a reservation. Every mutation recomputes the
 * reservation payment rollup via PaymentService.recalculate. Payments are stored
 * in MXN; non-MXN payments snapshot the original amount/currency and the exchange
 * rate at capture time (ExchangeRate.getCurrentValue).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const Payment = require('../../../domain/models/Payment');
const ExchangeRate = require('../../../domain/models/ExchangeRate');
const PaymentService = require('../../services/PaymentService');
const ClientProfileController = require('./ClientProfileController');
const FileStorageService = require('../../services/FileStorageService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');

// Supported currencies. Non-MXN amounts convert with the system USD/MXN rate.
const CURRENCIES = ['MXN', 'USD'];
const REFERENCE_MAX = 100;
const NOTES_MAX = 300;
// Upper bound for a single payment amount / tip — blocks absurd values (e.g. 1e19).
const AMOUNT_MAX = 100000000; // 100,000,000

// Payment receipt (proof of payment) — base64-in-JSON upload, same caps/MIME as client documents.
// The (?!svg) excludes image/svg+xml: SVG can carry script that runs when the presigned URL opens.
const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const RECEIPT_MIME = /^(image\/(?!svg)|application\/pdf$)/;

// Image variants go through the optimizer; PDFs use FileStorageService's direct S3 upload.
const fileStorageService = new FileStorageService();
const serverOptimizationService = new ServerImageOptimizationService();

/**
 * PaymentController - CRUD for reservation payments.
 */
class PaymentController {
  /**
   * Load an active reservation by id (null if not found).
   * @param {string} id - Reservation objectId.
   * @returns {Promise<object|null>} Reservation or null.
   * @example
   * const r = await PaymentController.loadReservation(id);
   */
  static async loadReservation(id) {
    const query = new Parse.Query('Reservation');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    try {
      return await query.get(id, { useMasterKey: true });
    } catch (err) {
      return null;
    }
  }

  /**
   * Load an existing service that belongs to the given reservation (null otherwise).
   * @param {string} serviceId - ReservationService objectId.
   * @param {object} reservation - Parse Reservation object.
   * @returns {Promise<object|null>} Service or null.
   * @example
   * const s = await PaymentController.loadReservationService(serviceId, reservation);
   */
  static async loadReservationService(serviceId, reservation) {
    const query = new Parse.Query('ReservationService');
    query.equalTo('reservationPtr', reservation);
    query.equalTo('exists', true);
    try {
      return await query.get(serviceId, { useMasterKey: true });
    } catch (err) {
      return null;
    }
  }

  /**
   * GET /api/reservations/:id/payments — List payments + summary (read-only).
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success, data: { payments, summary } }.
   * @example
   * GET /api/reservations/abc123/payments
   */
  static async getPayments(req, res) {
    try {
      const { id } = req.params;
      const reservation = await PaymentController.loadReservation(id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      const payments = await Payment.getExistingForReservation(id);
      const summary = await PaymentService.summarize(id);

      const data = await Promise.all(
        payments.map((p) => PaymentController.formatPaymentWithReceipt(p))
      );

      return res.json({
        success: true,
        data: { payments: data, summary },
      });
    } catch (error) {
      logger.error('Error listing payments', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al obtener los pagos' });
    }
  }

  /**
   * POST /api/reservations/:id/payments — Register a payment, then recalculate.
   * @param {object} req - Express request; body { amount, currency, method, reference, notes, tip, paidAt, reservationServiceId, paymentInfoId }.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success, data: { payment, summary } }.
   * @example
   * POST /api/reservations/abc123/payments { amount: 1000, currency: 'MXN', method: 'efectivo' }
   */
  static async addPayment(req, res) {
    try {
      const { id } = req.params;
      const {
        amount, currency, method, reference, notes, tip, paidAt,
        reservationServiceId, paymentInfoId, fileBase64, fileName, mimeType,
      } = req.body || {};

      const validation = PaymentController.validatePaymentInput({
        amount, currency, method, tip,
      });
      if (validation.error) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      const reservation = await PaymentController.loadReservation(id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      let servicePtr = null;
      if (reservationServiceId) {
        servicePtr = await PaymentController.loadReservationService(reservationServiceId, reservation);
        if (!servicePtr) {
          return res.status(404).json({ success: false, error: 'Servicio no encontrado en la reservación' });
        }
      }

      const { amountMXN, rate } = await PaymentController.toMXN(validation.amount, validation.currency);

      const payment = new Payment();
      payment.setReservationPtr(reservation);
      if (servicePtr) payment.setReservationServicePtr(servicePtr);
      payment.setAmount(amountMXN);
      payment.setOrigAmount(validation.amount);
      payment.setOrigCurrency(validation.currency);
      payment.setExchangeRate(rate);
      payment.setMethod(method);
      if (reference) payment.setReference(String(reference).slice(0, REFERENCE_MAX));
      if (notes) payment.setNotes(String(notes).slice(0, NOTES_MAX));
      payment.setTip(validation.tip);
      payment.setPaidAt(paidAt ? new Date(paidAt) : new Date());
      payment.setRegisteredBy(req.user);
      if (paymentInfoId) {
        const pi = new Parse.Object('PaymentInfo');
        pi.id = paymentInfoId;
        payment.setPaymentInfoPtr(pi);
      }
      payment.set('active', true);
      payment.set('exists', true);
      await payment.save(null, { useMasterKey: true });

      // Optional proof-of-payment receipt — stored after the first save so the key carries payment.id.
      // A bad file (400) rolls back the just-saved payment; a storage/network failure (e.g. S3
      // unreachable) is NON-fatal — the payment is kept and a warning is returned so it isn't lost.
      let receiptWarning = null;
      if (fileBase64) {
        try {
          const s3Key = await PaymentController.storeReceiptFile(id, payment.id, {
            fileBase64, fileName, mimeType,
          });
          payment.setReceiptS3Key(s3Key);
          await payment.save(null, { useMasterKey: true });
        } catch (receiptErr) {
          if (receiptErr.status === 400) {
            await payment.destroy({ useMasterKey: true }).catch(() => {});
            return res.status(400).json({ success: false, error: receiptErr.message });
          }
          logger.warn('Payment saved but receipt upload failed', { paymentId: payment.id, error: receiptErr.message });
          receiptWarning = 'El pago se registró, pero el comprobante no se pudo subir. Edita el pago para reintentarlo.';
        }
      }

      const summary = await PaymentService.recalculate(id);

      logger.info('Payment registered', {
        reservationId: id,
        paymentId: payment.id,
        amount: amountMXN,
        method,
        performedBy: req.userId,
      });

      return res.json({
        success: true,
        message: receiptWarning || 'Pago registrado',
        warning: receiptWarning,
        data: { payment: await PaymentController.formatPaymentWithReceipt(payment), summary },
      });
    } catch (error) {
      logger.error('Error adding payment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al registrar el pago' });
    }
  }

  /**
   * PUT /api/reservations/:id/payments/:paymentId — Edit a payment, then recalculate.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success, data: { payment, summary } }.
   * @example
   * PUT /api/reservations/abc123/payments/pay123 { amount: 1500 }
   */
  static async updatePayment(req, res) {
    try {
      const { id, paymentId } = req.params;
      const {
        amount, currency, method, reference, notes, tip, paidAt, reservationServiceId,
        fileBase64, fileName, mimeType,
      } = req.body || {};

      const reservation = await PaymentController.loadReservation(id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      const payment = await PaymentController.loadPayment(paymentId, reservation);
      if (!payment) {
        return res.status(404).json({ success: false, error: 'Pago no encontrado' });
      }

      // Re-validate using the new value where provided, otherwise the stored one.
      const nextCurrency = currency !== undefined ? currency : payment.getOrigCurrency();
      const nextAmount = amount !== undefined ? amount : payment.getOrigAmount();
      const nextMethod = method !== undefined ? method : payment.getMethod();
      const nextTip = tip !== undefined ? tip : payment.getTip();
      const validation = PaymentController.validatePaymentInput({
        amount: nextAmount, currency: nextCurrency, method: nextMethod, tip: nextTip,
      });
      if (validation.error) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      if (amount !== undefined || currency !== undefined) {
        const { amountMXN, rate } = await PaymentController.toMXN(validation.amount, validation.currency);
        payment.setAmount(amountMXN);
        payment.setOrigAmount(validation.amount);
        payment.setOrigCurrency(validation.currency);
        payment.setExchangeRate(rate);
      }
      if (method !== undefined) payment.setMethod(validation.method);
      if (reference !== undefined) payment.setReference(String(reference || '').slice(0, REFERENCE_MAX));
      if (notes !== undefined) payment.setNotes(String(notes || '').slice(0, NOTES_MAX));
      if (tip !== undefined) payment.setTip(validation.tip);
      if (paidAt !== undefined) payment.setPaidAt(paidAt ? new Date(paidAt) : new Date());
      if (reservationServiceId !== undefined) {
        await PaymentController.applyServicePointer(payment, reservationServiceId, reservation, res);
        if (res.headersSent) return undefined;
      }

      // Optional receipt replacement — store the new file, then best-effort delete the old one. A bad
      // file (400) rejects; a storage/network failure (e.g. S3 unreachable) is NON-fatal: the field
      // edits still save and the existing receipt is kept, with a warning returned.
      let receiptWarning = null;
      if (fileBase64) {
        const oldKey = payment.getReceiptS3Key();
        let newKey = null;
        try {
          newKey = await PaymentController.storeReceiptFile(id, payment.id, {
            fileBase64, fileName, mimeType,
          });
        } catch (receiptErr) {
          if (receiptErr.status === 400) {
            return res.status(400).json({ success: false, error: receiptErr.message });
          }
          logger.warn('Payment updated but receipt upload failed', { paymentId: payment.id, error: receiptErr.message });
          receiptWarning = 'El pago se actualizó, pero el comprobante no se pudo subir. Reintenta editando el pago.';
        }
        if (newKey) {
          payment.setReceiptS3Key(newKey);
          if (oldKey && oldKey !== newKey) {
            try {
              await fileStorageService.deleteFile(oldKey);
            } catch (e) {
              logger.warn('Failed to delete replaced receipt file from S3', { s3Key: oldKey, error: e.message });
            }
          }
        }
      }

      payment.set('modifiedBy', req.user);
      await payment.save(null, { useMasterKey: true });

      const summary = await PaymentService.recalculate(id);

      logger.info('Payment updated', { reservationId: id, paymentId, performedBy: req.userId });

      return res.json({
        success: true,
        message: receiptWarning || 'Pago actualizado',
        warning: receiptWarning,
        data: { payment: await PaymentController.formatPaymentWithReceipt(payment), summary },
      });
    } catch (error) {
      logger.error('Error updating payment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al actualizar el pago' });
    }
  }

  /**
   * DELETE /api/reservations/:id/payments/:paymentId — Soft-delete a payment, then recalculate.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success, data: { summary } }.
   * @example
   * DELETE /api/reservations/abc123/payments/pay123
   */
  static async deletePayment(req, res) {
    try {
      const { id, paymentId } = req.params;

      const reservation = await PaymentController.loadReservation(id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      const payment = await PaymentController.loadPayment(paymentId, reservation);
      if (!payment) {
        return res.status(404).json({ success: false, error: 'Pago no encontrado' });
      }

      const receiptKey = payment.getReceiptS3Key();
      await payment.softDelete(req.userId);

      // Best-effort cleanup of the stored receipt (the payment row is already soft-deleted).
      if (receiptKey) {
        try {
          await fileStorageService.deleteFile(receiptKey);
        } catch (e) {
          logger.warn('Failed to delete receipt file from S3', { s3Key: receiptKey, error: e.message });
        }
      }

      const summary = await PaymentService.recalculate(id);

      logger.info('Payment deleted', { reservationId: id, paymentId, performedBy: req.userId });

      return res.json({ success: true, message: 'Pago eliminado', data: { summary } });
    } catch (error) {
      logger.error('Error deleting payment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al eliminar el pago' });
    }
  }

  /**
   * POST /api/reservations/:id/payments/:paymentId/receipt — Upload/replace a payment receipt.
   * Decoupled from create/update so the (potentially slow) S3 upload never blocks or risks losing
   * the payment save: the payment is already persisted, this only attaches the proof of payment.
   * @param {object} req - Express request; body { fileBase64, fileName, mimeType }.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON { success, data: { payment } }.
   * @example
   * POST /api/reservations/abc/payments/pay1/receipt { fileBase64, fileName, mimeType }
   */
  static async uploadReceipt(req, res) {
    try {
      const { id, paymentId } = req.params;
      const { fileBase64, fileName, mimeType } = req.body || {};

      const reservation = await PaymentController.loadReservation(id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }
      const payment = await PaymentController.loadPayment(paymentId, reservation);
      if (!payment) {
        return res.status(404).json({ success: false, error: 'Pago no encontrado' });
      }
      if (!fileBase64) {
        return res.status(400).json({ success: false, error: 'No se recibió ningún comprobante' });
      }

      const oldKey = payment.getReceiptS3Key();
      let s3Key;
      try {
        s3Key = await PaymentController.storeReceiptFile(id, payment.id, { fileBase64, fileName, mimeType });
      } catch (receiptErr) {
        // 400 = bad file (rejected); anything else = storage/network failure → 502 so the client can retry.
        const status = receiptErr.status === 400 ? 400 : 502;
        logger.warn('Payment receipt upload failed', { paymentId: payment.id, error: receiptErr.message });
        return res.status(status).json({ success: false, error: receiptErr.message || 'Error al subir el comprobante' });
      }

      payment.setReceiptS3Key(s3Key);
      payment.set('modifiedBy', req.user);
      await payment.save(null, { useMasterKey: true });

      // Best-effort cleanup of a replaced receipt.
      if (oldKey && oldKey !== s3Key) {
        try {
          await fileStorageService.deleteFile(oldKey);
        } catch (e) {
          logger.warn('Failed to delete replaced receipt file from S3', { s3Key: oldKey, error: e.message });
        }
      }

      logger.info('Payment receipt uploaded', { reservationId: id, paymentId: payment.id, performedBy: req.userId });

      return res.json({
        success: true,
        message: 'Comprobante subido',
        data: { payment: await PaymentController.formatPaymentWithReceipt(payment) },
      });
    } catch (error) {
      logger.error('Error uploading payment receipt', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al subir el comprobante' });
    }
  }

  // =========================
  // HELPERS
  // =========================

  /**
   * Validate a base64 receipt payload and store it via the same S3 pipeline as the
   * client documents (images → optimizer, PDFs → direct upload). Returns the s3Key.
   * Throws an Error with `.status` 400 on bad input (the caller's catch turns it into a 400).
   * @param {string} reservationId - Reservation objectId (S3 path segment).
   * @param {string} paymentId - Payment objectId (key prefix).
   * @param {object} file - { fileBase64, fileName, mimeType }.
   * @param file.fileBase64
   * @param file.fileName
   * @param file.mimeType
   * @returns {Promise<string>} The stored object's s3Key.
   * @example
   * const key = await PaymentController.storeReceiptFile(resId, payId, { fileBase64, fileName, mimeType });
   */
  static async storeReceiptFile(reservationId, paymentId, { fileBase64, fileName, mimeType }) {
    const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

    if (!fileBase64) throw fail('No se recibió ningún archivo');
    if (!mimeType || !RECEIPT_MIME.test(mimeType)) throw fail('Tipo de archivo no permitido. Solo imágenes o PDF.');
    // Reject clearly-oversized payloads before allocating the Buffer (base64 is ~1.37× the bytes).
    if (typeof fileBase64 !== 'string' || fileBase64.length > Math.ceil(RECEIPT_MAX_BYTES * 1.4)) {
      throw fail('El archivo supera el límite de 10MB');
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (!buffer.length) throw fail('Archivo inválido');
    if (buffer.length > RECEIPT_MAX_BYTES) throw fail('El archivo supera el límite de 10MB');
    // The declared mimeType can lie; verify the real content by magic bytes (shared helper).
    if (!ClientProfileController.contentMatchesMime(buffer, mimeType)) {
      logger.warn('Rejected payment receipt with mismatched content', {
        mimeType, first8Hex: buffer.slice(0, 8).toString('hex'), fileName,
      });
      throw fail('El archivo no es un PDF o imagen válido.');
    }

    const entityPath = `receipts/${reservationId}`;
    const safeName = (fileName || 'comprobante').replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `receipt-${paymentId}-${Date.now()}-${safeName}`;

    let s3Key;
    if (mimeType.startsWith('image/')) {
      const result = await serverOptimizationService.uploadOptimizedImage(
        buffer,
        uniqueName,
        mimeType,
        { entityPath, entityId: paymentId }
      );
      s3Key = result && result.originalS3Key;
    } else {
      const result = await fileStorageService.uploadFile(buffer, uniqueName, mimeType, {
        entityId: entityPath,
      });
      s3Key = result && result.s3Key;
    }
    if (!s3Key) throw new Error('Error al subir el comprobante');
    return s3Key;
  }

  /**
   * Format a payment and resolve its presigned receipt URL from the stored s3Key.
   * @param {Payment} payment - Payment object.
   * @returns {Promise<object>} The formatted DTO with receiptS3Key and (when set) receiptUrl.
   * @example
   * const dto = await PaymentController.formatPaymentWithReceipt(payment);
   */
  static async formatPaymentWithReceipt(payment) {
    const dto = Payment.formatPayment(payment);
    if (dto.receiptS3Key) {
      dto.receiptUrl = await fileStorageService.getPresignedUrl(dto.receiptS3Key);
    }
    return dto;
  }

  /**
   * Load an existing payment that belongs to the reservation (null otherwise).
   * @param {string} paymentId - Payment objectId.
   * @param {object} reservation - Parse Reservation object.
   * @returns {Promise<object|null>} Payment or null.
   * @example
   * const p = await PaymentController.loadPayment(paymentId, reservation);
   */
  static async loadPayment(paymentId, reservation) {
    const query = new Parse.Query('Payment');
    query.equalTo('reservationPtr', reservation);
    query.equalTo('exists', true);
    try {
      return await query.get(paymentId, { useMasterKey: true });
    } catch (err) {
      return null;
    }
  }

  /**
   * Set/clear a payment's service pointer, validating ownership. Writes a 404 to
   * res when the service is not found in the reservation.
   * @param {object} payment - Payment object.
   * @param {string} reservationServiceId - Service id ('' / null to clear).
   * @param {object} reservation - Parse Reservation object.
   * @param {object} res - Express response (for the 404 path).
   * @returns {Promise<void>}
   * @example
   * await PaymentController.applyServicePointer(payment, svcId, reservation, res);
   */
  static async applyServicePointer(payment, reservationServiceId, reservation, res) {
    if (!reservationServiceId) {
      payment.unset('reservationServicePtr');
      return;
    }
    const svc = await PaymentController.loadReservationService(reservationServiceId, reservation);
    if (!svc) {
      res.status(404).json({ success: false, error: 'Servicio no encontrado en la reservación' });
      return;
    }
    payment.setReservationServicePtr(svc);
  }

  /**
   * Validate and normalize payment input shared by create/update.
   * @param {object} input - { amount, currency, method, tip }.
   * @param input.amount
   * @param input.currency
   * @param input.method
   * @param input.tip
   * @returns {object} { error } or { amount, currency, method, tip }.
   * @example
   * PaymentController.validatePaymentInput({ amount: 100, currency: 'MXN', method: 'efectivo' });
   */
  static validatePaymentInput({
    amount, currency, method, tip,
  }) {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return { error: 'El monto debe ser un número mayor a 0' };
    }
    if (amountNum > AMOUNT_MAX) {
      return { error: `El monto no puede exceder ${AMOUNT_MAX.toLocaleString('es-MX')}` };
    }
    if (!Payment.isValidMethod(method)) {
      return { error: `Método inválido. Use: ${Payment.METHODS.join(', ')}` };
    }
    const cur = String(currency || 'MXN').toUpperCase();
    if (!CURRENCIES.includes(cur)) {
      return { error: `Moneda inválida. Use: ${CURRENCIES.join(', ')}` };
    }
    const tipNum = tip === undefined || tip === null || tip === '' ? 0 : Number(tip);
    if (!Number.isFinite(tipNum) || tipNum < 0) {
      return { error: 'La propina debe ser un número mayor o igual a 0' };
    }
    if (tipNum > AMOUNT_MAX) {
      return { error: `La propina no puede exceder ${AMOUNT_MAX.toLocaleString('es-MX')}` };
    }
    return {
      amount: amountNum, currency: cur, method, tip: tipNum,
    };
  }

  /**
   * Convert an amount in the given currency to MXN, snapshotting the rate.
   * @param {number} amount - Amount in the original currency.
   * @param {string} currency - Original currency (MXN|USD).
   * @returns {Promise<object>} { amountMXN, rate }.
   * @example
   * const { amountMXN, rate } = await PaymentController.toMXN(100, 'USD');
   */
  static async toMXN(amount, currency) {
    const rate = currency === 'MXN' ? 1 : await ExchangeRate.getCurrentValue();
    const amountMXN = Math.round(amount * rate * 100) / 100;
    return { amountMXN, rate };
  }
}

module.exports = PaymentController;
