/**
 * Reservation - Domain model for reservation management.
 *
 * Created when a quote is confirmed ("Agendado"). Links to Quote
 * and provides its own lifecycle for managing employee assignments,
 * vehicles, and per-service status tracking.
 *
 * Lifecycle States:
 * - active: true, exists: true = Active reservation
 * - active: false, exists: true = Inactive reservation
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * Reservation class for managing reservations.
 * @class Reservation
 * @augments BaseModel
 */
class Reservation extends BaseModel {
  constructor() {
    super('Reservation');
  }

  // =================
  // GETTERS & SETTERS
  // =================

  getQuotePtr() {
    return this.get('quotePtr');
  }

  setQuotePtr(quote) {
    this.set('quotePtr', quote);
  }

  getFolio() {
    return this.get('folio');
  }

  setFolio(folio) {
    this.set('folio', folio);
  }

  getClientPtr() {
    return this.get('clientPtr');
  }

  setClientPtr(client) {
    this.set('clientPtr', client);
  }

  getStatus() {
    return this.get('status');
  }

  setStatus(status) {
    this.set('status', status);
  }

  getStartDate() {
    return this.get('startDate');
  }

  setStartDate(date) {
    this.set('startDate', date);
  }

  getEndDate() {
    return this.get('endDate');
  }

  setEndDate(date) {
    this.set('endDate', date);
  }

  getTotalAmount() {
    return this.get('totalAmount');
  }

  setTotalAmount(amount) {
    this.set('totalAmount', amount);
  }

  getCurrency() {
    return this.get('currency');
  }

  setCurrency(currency) {
    this.set('currency', currency);
  }

  getPaymentType() {
    return this.get('paymentType');
  }

  setPaymentType(paymentType) {
    this.set('paymentType', paymentType);
  }

  getNumberOfPeople() {
    return this.get('numberOfPeople') || 1;
  }

  setNumberOfPeople(numberOfPeople) {
    this.set('numberOfPeople', numberOfPeople);
  }

  getEventType() {
    return this.get('eventType');
  }

  setEventType(eventType) {
    this.set('eventType', eventType);
  }

  getContactPerson() {
    return this.get('contactPerson');
  }

  setContactPerson(contactPerson) {
    this.set('contactPerson', contactPerson);
  }

  getContactEmail() {
    return this.get('contactEmail');
  }

  setContactEmail(contactEmail) {
    this.set('contactEmail', contactEmail);
  }

  getContactPhone() {
    return this.get('contactPhone');
  }

  setContactPhone(contactPhone) {
    this.set('contactPhone', contactPhone);
  }

  getNotes() {
    return this.get('notes');
  }

  setNotes(notes) {
    this.set('notes', notes);
  }

  getServiceItemsSnapshot() {
    return this.get('serviceItemsSnapshot');
  }

  setServiceItemsSnapshot(snapshot) {
    this.set('serviceItemsSnapshot', snapshot);
  }

  getCreatedBy() {
    return this.get('createdBy');
  }

  setCreatedBy(user) {
    this.set('createdBy', user);
  }

  getServiceCustomer() {
    return this.get('serviceCustomer');
  }

  setServiceCustomer(serviceCustomer) {
    this.set('serviceCustomer', serviceCustomer);
  }

  getAdjustments() {
    return this.get('adjustments') || [];
  }

  setAdjustments(adjustments) {
    this.set('adjustments', adjustments);
  }

  getServicesSubtotal() {
    return this.get('servicesSubtotal');
  }

  setServicesSubtotal(amount) {
    this.set('servicesSubtotal', amount);
  }

  // Payment rollup (computed by PaymentService from active Payment records).
  // paymentStatus is orthogonal to status (operational): pending|partial|paid|refunded.

  getPaymentStatus() {
    return this.get('paymentStatus') || 'pending';
  }

  setPaymentStatus(paymentStatus) {
    this.set('paymentStatus', paymentStatus);
  }

  getPaidAmount() {
    return this.get('paidAmount') || 0;
  }

  setPaidAmount(amount) {
    this.set('paidAmount', amount);
  }

  getBalance() {
    return this.get('balance');
  }

  setBalance(balance) {
    this.set('balance', balance);
  }

  // Reservation-level tip (added on top of services + IVA for the amount due).
  getTip() {
    return this.get('tip') || 0;
  }

  setTip(tip) {
    this.set('tip', tip);
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('Reservation', Reservation);

module.exports = Reservation;
