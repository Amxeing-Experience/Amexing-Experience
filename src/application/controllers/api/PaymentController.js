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

// Supported currencies. Non-MXN amounts convert with the system USD/MXN rate.
const CURRENCIES = ['MXN', 'USD'];
const REFERENCE_MAX = 100;
const NOTES_MAX = 300;

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

      return res.json({
        success: true,
        data: {
          payments: payments.map((p) => Payment.formatPayment(p)),
          summary,
        },
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
        reservationServiceId, paymentInfoId,
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
        message: 'Pago registrado',
        data: { payment: Payment.formatPayment(payment), summary },
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

      payment.set('modifiedBy', req.user);
      await payment.save(null, { useMasterKey: true });

      const summary = await PaymentService.recalculate(id);

      logger.info('Payment updated', { reservationId: id, paymentId, performedBy: req.userId });

      return res.json({
        success: true,
        message: 'Pago actualizado',
        data: { payment: Payment.formatPayment(payment), summary },
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

      await payment.softDelete(req.userId);

      const summary = await PaymentService.recalculate(id);

      logger.info('Payment deleted', { reservationId: id, paymentId, performedBy: req.userId });

      return res.json({ success: true, message: 'Pago eliminado', data: { summary } });
    } catch (error) {
      logger.error('Error deleting payment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al eliminar el pago' });
    }
  }

  // =========================
  // HELPERS
  // =========================

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
