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
const ReservationController = require('./ReservationController');
const ClientProfileController = require('./ClientProfileController');
const FileStorageService = require('../../services/FileStorageService');
const ServerImageOptimizationService = require('../../services/ServerImageOptimizationService');
const { validateDate } = require('../../utils/dateValidation');

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
   * Load an active reservation by id, scoped to what the acting actor may access (null otherwise).
   * Reuses ReservationController.applyOwnershipScope so an out-of-scope reservation (another agency's)
   * returns null exactly like a truly-missing one — the 5 call sites answer 404 either way, never
   * leaking a foreign reservation nor a 403 that confirms it exists.
   * @param {string} id - Reservation objectId.
   * @param {object} req - Express request with user info from JWT middleware.
   * @returns {Promise<object|null>} Reservation the actor may access, or null.
   * @example
   * const r = await PaymentController.loadReservation(id, req);
   */
  static async loadReservation(id, req) {
    const query = new Parse.Query('Reservation');
    query.equalTo('active', true);
    query.equalTo('exists', true);
    await ReservationController.applyOwnershipScope(query, req);
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
      const reservation = await PaymentController.loadReservation(id, req);
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

      const reservation = await PaymentController.loadReservation(id, req);
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

      // Payment date — shared standard: future allowed (reservations later), 1900 .. today + 20y.
      const paidAtError = validateDate(paidAt, { fieldName: 'Fecha de pago', allowFuture: true });
      if (paidAtError) return res.status(400).json({ success: false, error: paidAtError });

      const { amountMXN, rate } = await PaymentController.toMXN(validation.amount, validation.currency);
      // Tip converts with the SAME snapshot rate as the amount (both are money from this one
      // payment): never surcharged, but a non-MXN tip must land in MXN like the amount does.
      const tipMXN = Math.round(validation.tip * rate * 100) / 100;

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
      payment.setTip(tipMXN);
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

      // Reconcile reservation.paymentType against this payment's real method (Fase 0): updates
      // paymentType cleanly when nothing to reconcile, or writes a single tagged adjustment when a
      // prior payment used a different tier. Non-fatal: the payment is already saved.
      let methodWarning = null;
      try {
        const decision = await PaymentService.resolvePaymentMethodChange(id, {
          method: payment.getMethod(),
          amountMXN: payment.getAmount(),
          currentPaymentId: payment.id,
        });
        methodWarning = decision.warning;
      } catch (reconErr) {
        logger.warn('Payment saved but method reconciliation failed', {
          reservationId: id, paymentId: payment.id, error: reconErr.message,
        });
      }

      const summary = await PaymentService.recalculate(id);
      const warning = [methodWarning, receiptWarning].filter(Boolean).join(' ') || null;

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
        warning,
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

      const reservation = await PaymentController.loadReservation(id, req);
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

      // Payment date — shared standard (future allowed). Only validated when a new value is sent.
      if (paidAt !== undefined) {
        const paidAtError = validateDate(paidAt, { fieldName: 'Fecha de pago', allowFuture: true });
        if (paidAtError) return res.status(400).json({ success: false, error: paidAtError });
      }

      let tipRate = null;
      if (amount !== undefined || currency !== undefined) {
        const { amountMXN, rate } = await PaymentController.toMXN(validation.amount, validation.currency);
        payment.setAmount(amountMXN);
        payment.setOrigAmount(validation.amount);
        payment.setOrigCurrency(validation.currency);
        payment.setExchangeRate(rate);
        tipRate = rate;
      }
      if (method !== undefined) payment.setMethod(validation.method);
      if (reference !== undefined) payment.setReference(String(reference || '').slice(0, REFERENCE_MAX));
      if (notes !== undefined) payment.setNotes(String(notes || '').slice(0, NOTES_MAX));
      if (tip !== undefined) {
        // When only the tip changes (no amount/currency in the payload), reuse the rate ALREADY
        // snapshotted on this payment — never a fresh current rate — so amount and tip on the same
        // Payment are never computed at different rates from being edited at different times.
        const rateForTip = tipRate !== null ? tipRate : (payment.getExchangeRate() || 1);
        payment.setTip(Math.round(validation.tip * rateForTip * 100) / 100);
      }
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

      // Reconcile against the (possibly changed) method/amount. Runs on every edit — including an
      // amount-only change — so the tagged adjustment stays correct and never leaves a phantom
      // balance against money already collected. Non-fatal: the payment edit is already saved.
      let methodWarning = null;
      try {
        const decision = await PaymentService.resolvePaymentMethodChange(id, {
          method: payment.getMethod(),
          amountMXN: payment.getAmount(),
          currentPaymentId: payment.id,
        });
        methodWarning = decision.warning;
      } catch (reconErr) {
        logger.warn('Payment updated but method reconciliation failed', {
          reservationId: id, paymentId, error: reconErr.message,
        });
      }

      const summary = await PaymentService.recalculate(id);
      const warning = [methodWarning, receiptWarning].filter(Boolean).join(' ') || null;

      logger.info('Payment updated', { reservationId: id, paymentId, performedBy: req.userId });

      return res.json({
        success: true,
        message: receiptWarning || 'Pago actualizado',
        warning,
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

      const reservation = await PaymentController.loadReservation(id, req);
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

      // Reconcile over the remaining payments (no current payment): recomputes the tagged adjustment
      // from scratch and removes it when the reservation is consistent again, so deleting a
      // cross-tier payment never leaves a phantom balance. Non-fatal: the payment is already deleted.
      try {
        await PaymentService.resolvePaymentMethodChange(id, {});
      } catch (reconErr) {
        logger.warn('Payment deleted but method reconciliation failed', {
          reservationId: id, paymentId, error: reconErr.message,
        });
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

      const reservation = await PaymentController.loadReservation(id, req);
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
    // Floor relaxed from > 0 to >= 0 so a tip-only payment (amount 0, tip > 0) is allowed. A
    // negative amount stays rejected regardless of tip: a positive tip never rescues it.
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return { error: 'El monto debe ser un número mayor o igual a 0' };
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
    // Reject a fully-empty payment (no services, no tip). amount > 0 || tip > 0 is required.
    if (amountNum === 0 && tipNum === 0) {
      return { error: 'El pago debe incluir un monto o una propina mayor a 0' };
    }
    // TODO (Fase 4, future form): the planned "monto total recibido" + "de los cuales, propina" UI
    // must prevent tip from exceeding the captured total (which would compute a negative services
    // amount). The backend contract here is independent-additive (amount = services, tip separate),
    // so it needs no such rule today — this is a form-only constraint for whoever builds Fase 4.
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
