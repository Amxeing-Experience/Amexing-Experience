/**
 * ReservationService - Domain model for individual reservation services.
 *
 * One record per service in a reservation, enabling per-service
 * employee assignments (driver, guide, greeter) and independent
 * status tracking.
 *
 * Lifecycle States:
 * - active: true, exists: true = Active service
 * - active: false, exists: true = Inactive service
 * - active: false, exists: false = Soft deleted (audit trail only).
 * @augments BaseModel
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('./BaseModel');

/**
 * ReservationService class for managing individual services within a reservation.
 * @class ReservationService
 * @augments BaseModel
 */
class ReservationService extends BaseModel {
  constructor() {
    super('ReservationService');
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

  getDayNumber() {
    return this.get('dayNumber');
  }

  setDayNumber(dayNumber) {
    this.set('dayNumber', dayNumber);
  }

  getDayTitle() {
    return this.get('dayTitle');
  }

  setDayTitle(dayTitle) {
    this.set('dayTitle', dayTitle);
  }

  getServiceDate() {
    return this.get('serviceDate');
  }

  setServiceDate(date) {
    this.set('serviceDate', date);
  }

  getType() {
    return this.get('type');
  }

  setType(type) {
    this.set('type', type);
  }

  getConcept() {
    return this.get('concept');
  }

  setConcept(concept) {
    this.set('concept', concept);
  }

  getTime() {
    return this.get('time');
  }

  setTime(time) {
    this.set('time', time);
  }

  getStatus() {
    return this.get('status');
  }

  setStatus(status) {
    this.set('status', status);
  }

  getAssignedDriver() {
    return this.get('assignedDriver');
  }

  setAssignedDriver(driver) {
    this.set('assignedDriver', driver);
  }

  getAssignedGuide() {
    return this.get('assignedGuide');
  }

  setAssignedGuide(guide) {
    this.set('assignedGuide', guide);
  }

  getAssignedGreeter() {
    return this.get('assignedGreeter');
  }

  setAssignedGreeter(greeter) {
    this.set('assignedGreeter', greeter);
  }

  getAssignedVehicle() {
    return this.get('assignedVehicle');
  }

  setAssignedVehicle(vehicle) {
    this.set('assignedVehicle', vehicle);
  }

  getPrice() {
    return this.get('price');
  }

  setPrice(price) {
    this.set('price', price);
  }

  getTotal() {
    return this.get('total');
  }

  setTotal(total) {
    this.set('total', total);
  }

  getOriginName() {
    return this.get('originName');
  }

  setOriginName(originName) {
    this.set('originName', originName);
  }

  getDestinationName() {
    return this.get('destinationName');
  }

  setDestinationName(destinationName) {
    this.set('destinationName', destinationName);
  }

  getVehicleTypeName() {
    return this.get('vehicleTypeName');
  }

  setVehicleTypeName(vehicleTypeName) {
    this.set('vehicleTypeName', vehicleTypeName);
  }

  getServiceNotes() {
    return this.get('notes');
  }

  setServiceNotes(notes) {
    this.set('notes', notes);
  }

  getSubconcept() {
    return this.get('subconcept');
  }

  setSubconcept(subconcept) {
    this.set('subconcept', subconcept);
  }
}

// Register the subclass with Parse
Parse.Object.registerSubclass('ReservationService', ReservationService);

module.exports = ReservationService;
