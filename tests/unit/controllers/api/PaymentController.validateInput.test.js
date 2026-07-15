/**
 * PaymentController.validatePaymentInput unit tests (Fase 1 relaxation).
 *
 * The amount floor was relaxed from > 0 to >= 0 with the OR-condition amount > 0 || tip > 0:
 * a tip-only payment (amount 0, tip > 0) is now valid, a fully-empty payment (amount 0, tip 0)
 * is rejected, and a negative amount stays rejected regardless of tip. The pre-existing tip < 0
 * rejection is left untouched.
 */

// Mock heavy/infra dependencies so requiring the controller has no side effects; leave the real
// Payment model (needed for isValidMethod/METHODS) and the pure dateValidation util.
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../../src/application/services/FileStorageService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/ServerImageOptimizationService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/PaymentService', () => ({}));
jest.mock('../../../../src/domain/models/ExchangeRate', () => ({ getCurrentValue: jest.fn() }));
jest.mock('../../../../src/application/controllers/api/ClientProfileController', () => ({ contentMatchesMime: jest.fn() }));

const PaymentController = require('../../../../src/application/controllers/api/PaymentController');

const M = 'efectivo'; // a valid Payment.METHODS token

describe('PaymentController.validatePaymentInput', () => {
  describe('happy paths (contract unchanged for amount > 0)', () => {
    it('accepts a normal payment (amount > 0, no tip) and normalizes it', () => {
      const r = PaymentController.validatePaymentInput({ amount: 500, currency: 'MXN', method: M });
      expect(r.error).toBeUndefined();
      expect(r).toEqual({
        amount: 500, currency: 'MXN', method: M, tip: 0,
      });
    });

    it('accepts amount > 0 together with a tip', () => {
      const r = PaymentController.validatePaymentInput({
        amount: 400, currency: 'MXN', method: M, tip: 100,
      });
      expect(r.error).toBeUndefined();
      expect(r.amount).toBe(400);
      expect(r.tip).toBe(100);
    });

    it('defaults currency to MXN and uppercases a lowercase currency', () => {
      const r = PaymentController.validatePaymentInput({ amount: 10, method: M });
      expect(r.currency).toBe('MXN');
      const usd = PaymentController.validatePaymentInput({ amount: 10, currency: 'usd', method: M });
      expect(usd.currency).toBe('USD');
    });
  });

  describe('relaxation — tip-only allowed, empty rejected', () => {
    it('accepts a tip-only payment (amount 0, tip > 0)', () => {
      const r = PaymentController.validatePaymentInput({
        amount: 0, currency: 'MXN', method: M, tip: 75,
      });
      expect(r.error).toBeUndefined();
      expect(r.amount).toBe(0);
      expect(r.tip).toBe(75);
    });

    it('rejects a fully-empty payment (amount 0, tip 0)', () => {
      const r = PaymentController.validatePaymentInput({
        amount: 0, currency: 'MXN', method: M, tip: 0,
      });
      expect(r.error).toBeTruthy();
    });

    it('rejects amount 0 with no tip field at all (treated as empty)', () => {
      const r = PaymentController.validatePaymentInput({ amount: 0, currency: 'MXN', method: M });
      expect(r.error).toBeTruthy();
    });
  });

  describe('negative amount stays rejected regardless of tip', () => {
    it('rejects a negative amount alone', () => {
      const r = PaymentController.validatePaymentInput({ amount: -100, currency: 'MXN', method: M });
      expect(r.error).toBeTruthy();
    });

    it('a positive tip does NOT rescue a negative amount', () => {
      const r = PaymentController.validatePaymentInput({
        amount: -100, currency: 'MXN', method: M, tip: 500,
      });
      expect(r.error).toBeTruthy();
    });

    it('rejects a non-finite amount', () => {
      const r = PaymentController.validatePaymentInput({ amount: 'abc', currency: 'MXN', method: M });
      expect(r.error).toBeTruthy();
    });
  });

  describe('pre-existing validations left intact', () => {
    it('still rejects a negative tip', () => {
      const r = PaymentController.validatePaymentInput({
        amount: 100, currency: 'MXN', method: M, tip: -1,
      });
      expect(r.error).toMatch(/propina/i);
    });

    it('rejects an amount over the maximum', () => {
      const r = PaymentController.validatePaymentInput({ amount: 100000001, currency: 'MXN', method: M });
      expect(r.error).toBeTruthy();
    });

    it('rejects a tip over the maximum', () => {
      const r = PaymentController.validatePaymentInput({
        amount: 100, currency: 'MXN', method: M, tip: 100000001,
      });
      expect(r.error).toBeTruthy();
    });

    it('rejects an invalid method', () => {
      const r = PaymentController.validatePaymentInput({ amount: 100, currency: 'MXN', method: 'cheque' });
      expect(r.error).toMatch(/[Mm]étodo/);
    });

    it('rejects an invalid currency', () => {
      const r = PaymentController.validatePaymentInput({ amount: 100, currency: 'EUR', method: M });
      expect(r.error).toMatch(/[Mm]oneda/);
    });
  });
});
