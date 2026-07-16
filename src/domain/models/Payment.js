/**
 * Payment - Domain model for reservation payments.
 *
 * One record per payment received against a reservation. A payment can be tied
 * to a specific service (reservationServicePtr) or to the reservation as a whole
 * (reservationServicePtr null). Amounts are stored in MXN (the base for balance
 * calculations); payments captured in another currency snapshot the original
 * amount, currency and the exchange rate used at capture time.
 *
 * Soft-delete and audit (modifiedBy/deletedBy/deletedAt) are inherited from
 * BaseModel; only payments with exists === true count toward the paid total.
 * @augments BaseModel
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

// Accepted payment methods (each carries its own pricing tier upstream).
const PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta'];

/**
 * Payment class for managing reservation payments.
 * @class Payment
 * @augments BaseModel
 */
class Payment extends BaseModel {
  constructor() {
    super('Payment');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  getReservationPtr() {
    return this.get('reservationPtr');
  }

  setReservationPtr(reservation) {
    this.set('reservationPtr', reservation);
  }

  getReservationServicePtr() {
    return this.get('reservationServicePtr');
  }

  setReservationServicePtr(reservationService) {
    this.set('reservationServicePtr', reservationService);
  }

  getAmount() {
    return this.get('amount');
  }

  setAmount(amount) {
    this.set('amount', amount);
  }

  getOrigAmount() {
    return this.get('origAmount');
  }

  setOrigAmount(origAmount) {
    this.set('origAmount', origAmount);
  }

  getOrigCurrency() {
    return this.get('origCurrency');
  }

  setOrigCurrency(origCurrency) {
    this.set('origCurrency', origCurrency);
  }

  getExchangeRate() {
    return this.get('exchangeRate');
  }

  setExchangeRate(exchangeRate) {
    this.set('exchangeRate', exchangeRate);
  }

  getMethod() {
    return this.get('method');
  }

  setMethod(method) {
    this.set('method', method);
  }

  getReference() {
    return this.get('reference');
  }

  setReference(reference) {
    this.set('reference', reference);
  }

  getTip() {
    return this.get('tip') || 0;
  }

  setTip(tip) {
    this.set('tip', tip);
  }

  getPaidAt() {
    return this.get('paidAt');
  }

  setPaidAt(paidAt) {
    this.set('paidAt', paidAt);
  }

  getNotes() {
    return this.get('notes');
  }

  setNotes(notes) {
    this.set('notes', notes);
  }

  getRegisteredBy() {
    return this.get('registeredBy');
  }

  setRegisteredBy(user) {
    this.set('registeredBy', user);
  }

  getPaymentInfoPtr() {
    return this.get('paymentInfoPtr');
  }

  setPaymentInfoPtr(paymentInfo) {
    this.set('paymentInfoPtr', paymentInfo);
  }

  getValidatedBy() {
    return this.get('validatedBy');
  }

  setValidatedBy(user) {
    this.set('validatedBy', user);
  }

  getValidatedAt() {
    return this.get('validatedAt');
  }

  setValidatedAt(validatedAt) {
    this.set('validatedAt', validatedAt);
  }

  getReceiptS3Key() {
    return this.get('receiptS3Key');
  }

  setReceiptS3Key(key) {
    this.set('receiptS3Key', key);
  }

  // =================
  // STATIC HELPERS
  // =================

  /**
   * Accepted payment methods.
   * @returns {string[]} List of valid method tokens.
   * @example
   *   Payment.METHODS // ['efectivo', 'transferencia', 'tarjeta']
   */
  static get METHODS() {
    return [...PAYMENT_METHODS];
  }

  /**
   * Validate a payment method token.
   * @param {string} method - Method to validate.
   * @returns {boolean} True if accepted.
   * @example
   *   Payment.isValidMethod('efectivo') // true
   */
  static isValidMethod(method) {
    return PAYMENT_METHODS.includes(method);
  }

  /**
   * Get non-deleted (existing) payments for a reservation, ordered by paidAt.
   * These are the records that count toward the paid total.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<Payment[]>} Existing payments for the reservation.
   * @example
   *   const payments = await Payment.getExistingForReservation(reservationId);
   */
  static async getExistingForReservation(reservationId) {
    const Reservation = require('./Reservation');
    const reservationPtr = new Reservation();
    reservationPtr.id = reservationId;

    const query = BaseModel.queryExisting('Payment');
    query.equalTo('reservationPtr', reservationPtr);
    query.include('registeredBy');
    query.include('paymentInfoPtr');
    query.include('reservationServicePtr');
    query.ascending('paidAt');
    query.limit(1000);

    return query.find({ useMasterKey: true });
  }

  /**
   * Format a payment for API/view responses.
   * @param {Payment} payment - Payment object.
   * @returns {object} Plain serializable payment.
   * @example
   *   const dto = Payment.formatPayment(payment);
   */
  static formatPayment(payment) {
    const registeredBy = payment.get('registeredBy');
    const paymentInfo = payment.get('paymentInfoPtr');
    const service = payment.get('reservationServicePtr');

    return {
      id: payment.id,
      amount: payment.get('amount') || 0,
      origAmount: payment.get('origAmount') || null,
      origCurrency: payment.get('origCurrency') || null,
      exchangeRate: payment.get('exchangeRate') || null,
      method: payment.get('method') || '',
      reference: payment.get('reference') || '',
      paidAt: payment.get('paidAt') || null,
      notes: payment.get('notes') || '',
      reservationServiceId: service ? service.id : null,
      paymentInfoId: paymentInfo ? paymentInfo.id : null,
      paymentInfoName: paymentInfo && paymentInfo.get ? paymentInfo.get('name') || '' : '',
      registeredById: registeredBy ? registeredBy.id : null,
      registeredByName: registeredBy && registeredBy.get
        ? `${registeredBy.get('firstName') || ''} ${registeredBy.get('lastName') || ''}`.trim()
        : '',
      validatedAt: payment.get('validatedAt') || null,
      receiptS3Key: payment.get('receiptS3Key') || null,
      createdAt: payment.createdAt || null,
      updatedAt: payment.updatedAt || null,
    };
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('Payment', Payment);

module.exports = Payment;
