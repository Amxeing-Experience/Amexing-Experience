/**
 * PaymentInfo Model
 * Manages multiple payment information options for receipts.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');

/**
 * PaymentInfo Parse Object
 * Stores different payment methods and banking information.
 */
class PaymentInfo extends Parse.Object {
  constructor() {
    super('PaymentInfo');
  }

  /**
   * Initialize default values for new PaymentInfo.
   * @example
   */
  initialize() {
    super.initialize();
    this.set('active', true);
    this.set('exists', true);
    this.set('isDefault', false);
  }

  /**
   * Create a new PaymentInfo entry.
   * @param {object} data - Payment info data.
   * @returns {Promise<PaymentInfo>} Created payment info.
   * @example
   */
  static async createPaymentInfo(data) {
    try {
      const paymentInfo = new PaymentInfo();

      // Required fields
      paymentInfo.set('name', data.name); // e.g., "Bank of America - Primary"
      paymentInfo.set('bank', data.bank);
      paymentInfo.set('accountHolder', data.accountHolder);

      // Optional fields
      if (data.accountNumber) paymentInfo.set('accountNumber', data.accountNumber);
      if (data.routingNumber) paymentInfo.set('routingNumber', data.routingNumber);
      if (data.achRoutingNumber) paymentInfo.set('achRoutingNumber', data.achRoutingNumber);
      if (data.swiftCode) paymentInfo.set('swiftCode', data.swiftCode);
      if (data.iban) paymentInfo.set('iban', data.iban);

      // Alternative payment methods
      if (data.zelle) paymentInfo.set('zelle', data.zelle);
      if (data.paypal) paymentInfo.set('paypal', data.paypal);
      if (data.venmo) paymentInfo.set('venmo', data.venmo);

      // Additional info
      if (data.notes) paymentInfo.set('notes', data.notes);
      if (data.currency) paymentInfo.set('currency', data.currency || 'USD');

      // Set as default if specified
      if (data.isDefault) {
        // Unset any existing default
        await PaymentInfo.clearDefault();
        paymentInfo.set('isDefault', true);
      }

      // Metadata
      paymentInfo.set('active', true);
      paymentInfo.set('exists', true);

      const savedPaymentInfo = await paymentInfo.save(null, { useMasterKey: true });

      logger.info('PaymentInfo created successfully', {
        paymentInfoId: savedPaymentInfo.id,
        name: savedPaymentInfo.get('name'),
        bank: savedPaymentInfo.get('bank'),
      });

      return savedPaymentInfo;
    } catch (error) {
      logger.error('Error creating PaymentInfo', {
        error: error.message,
        data,
      });
      throw error;
    }
  }

  /**
   * Update payment info.
   * @param {string} paymentInfoId - Payment info ID.
   * @param {object} updates - Fields to update.
   * @returns {Promise<PaymentInfo>} Updated payment info.
   * @example
   */
  static async updatePaymentInfo(paymentInfoId, updates) {
    try {
      const query = new Parse.Query(PaymentInfo);
      const paymentInfo = await query.get(paymentInfoId, { useMasterKey: true });

      // Update allowed fields
      const allowedFields = [
        'name', 'bank', 'accountHolder', 'accountNumber',
        'routingNumber', 'achRoutingNumber', 'swiftCode', 'iban',
        'zelle', 'paypal', 'venmo', 'notes', 'currency', 'active',
      ];

      allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
          paymentInfo.set(field, updates[field]);
        }
      });

      // Handle default flag
      if (updates.isDefault) {
        await PaymentInfo.clearDefault();
        paymentInfo.set('isDefault', true);
      }

      const savedPaymentInfo = await paymentInfo.save(null, { useMasterKey: true });

      logger.info('PaymentInfo updated successfully', {
        paymentInfoId: savedPaymentInfo.id,
        updates,
      });

      return savedPaymentInfo;
    } catch (error) {
      logger.error('Error updating PaymentInfo', {
        paymentInfoId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all active payment info options.
   * @returns {Promise<Array>} List of payment info options.
   * @example
   */
  static async getActivePaymentInfos() {
    try {
      const query = new Parse.Query(PaymentInfo);
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.ascending('name');

      const paymentInfos = await query.find({ useMasterKey: true });

      return paymentInfos.map((info) => ({
        id: info.id,
        name: info.get('name'),
        bank: info.get('bank'),
        accountHolder: info.get('accountHolder'),
        accountNumber: info.get('accountNumber'),
        routingNumber: info.get('routingNumber'),
        achRoutingNumber: info.get('achRoutingNumber'),
        swiftCode: info.get('swiftCode'),
        iban: info.get('iban'),
        zelle: info.get('zelle'),
        paypal: info.get('paypal'),
        venmo: info.get('venmo'),
        notes: info.get('notes'),
        currency: info.get('currency'),
        isDefault: info.get('isDefault') || false,
        active: info.get('active'),
      }));
    } catch (error) {
      logger.error('Error fetching active PaymentInfos', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get payment info by ID.
   * @param {string} paymentInfoId - Payment info ID.
   * @returns {Promise<object>} Payment info data.
   * @example
   */
  static async getPaymentInfoById(paymentInfoId) {
    try {
      const query = new Parse.Query(PaymentInfo);
      const paymentInfo = await query.get(paymentInfoId, { useMasterKey: true });

      return {
        id: paymentInfo.id,
        name: paymentInfo.get('name'),
        bank: paymentInfo.get('bank'),
        accountHolder: paymentInfo.get('accountHolder'),
        accountNumber: paymentInfo.get('accountNumber'),
        routingNumber: paymentInfo.get('routingNumber'),
        achRoutingNumber: paymentInfo.get('achRoutingNumber'),
        swiftCode: paymentInfo.get('swiftCode'),
        iban: paymentInfo.get('iban'),
        zelle: paymentInfo.get('zelle'),
        paypal: paymentInfo.get('paypal'),
        venmo: paymentInfo.get('venmo'),
        notes: paymentInfo.get('notes'),
        currency: paymentInfo.get('currency'),
        isDefault: paymentInfo.get('isDefault') || false,
        active: paymentInfo.get('active'),
      };
    } catch (error) {
      logger.error('Error fetching PaymentInfo by ID', {
        paymentInfoId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get default payment info.
   * @returns {Promise<object|null>} Default payment info or null.
   * @example
   */
  static async getDefaultPaymentInfo() {
    try {
      const query = new Parse.Query(PaymentInfo);
      query.equalTo('isDefault', true);
      query.equalTo('active', true);
      query.equalTo('exists', true);

      const paymentInfo = await query.first({ useMasterKey: true });

      if (!paymentInfo) {
        // If no default, get the first active one
        const fallbackQuery = new Parse.Query(PaymentInfo);
        fallbackQuery.equalTo('active', true);
        fallbackQuery.equalTo('exists', true);
        fallbackQuery.ascending('createdAt');

        const fallbackInfo = await fallbackQuery.first({ useMasterKey: true });
        if (fallbackInfo) {
          return PaymentInfo.formatPaymentInfo(fallbackInfo);
        }
        return null;
      }

      return PaymentInfo.formatPaymentInfo(paymentInfo);
    } catch (error) {
      logger.error('Error fetching default PaymentInfo', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Clear default flag from all payment infos.
   * @returns {Promise<void>}
   * @example
   */
  static async clearDefault() {
    try {
      const query = new Parse.Query(PaymentInfo);
      query.equalTo('isDefault', true);

      const defaultInfos = await query.find({ useMasterKey: true });

      for (const info of defaultInfos) {
        info.set('isDefault', false);
        await info.save(null, { useMasterKey: true });
      }
    } catch (error) {
      logger.error('Error clearing default PaymentInfo', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete (soft delete) payment info.
   * @param {string} paymentInfoId - Payment info ID.
   * @returns {Promise<void>}
   * @example
   */
  static async deletePaymentInfo(paymentInfoId) {
    try {
      const query = new Parse.Query(PaymentInfo);
      const paymentInfo = await query.get(paymentInfoId, { useMasterKey: true });

      // Soft delete
      paymentInfo.set('exists', false);
      paymentInfo.set('active', false);
      paymentInfo.set('isDefault', false);

      await paymentInfo.save(null, { useMasterKey: true });

      logger.info('PaymentInfo deleted successfully', {
        paymentInfoId,
      });
    } catch (error) {
      logger.error('Error deleting PaymentInfo', {
        paymentInfoId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Format payment info for response.
   * @param {PaymentInfo} paymentInfo - Payment info object.
   * @returns {object} Formatted payment info.
   * @example
   */
  static formatPaymentInfo(paymentInfo) {
    return {
      id: paymentInfo.id,
      name: paymentInfo.get('name'),
      bank: paymentInfo.get('bank'),
      accountHolder: paymentInfo.get('accountHolder'),
      accountNumber: paymentInfo.get('accountNumber'),
      routingNumber: paymentInfo.get('routingNumber'),
      achRoutingNumber: paymentInfo.get('achRoutingNumber'),
      swiftCode: paymentInfo.get('swiftCode'),
      iban: paymentInfo.get('iban'),
      zelle: paymentInfo.get('zelle'),
      paypal: paymentInfo.get('paypal'),
      venmo: paymentInfo.get('venmo'),
      notes: paymentInfo.get('notes'),
      currency: paymentInfo.get('currency'),
      isDefault: paymentInfo.get('isDefault') || false,
      active: paymentInfo.get('active'),
      createdAt: paymentInfo.createdAt,
      updatedAt: paymentInfo.updatedAt,
    };
  }
}

// Register the class with Parse
Parse.Object.registerSubclass('PaymentInfo', PaymentInfo);

module.exports = PaymentInfo;
