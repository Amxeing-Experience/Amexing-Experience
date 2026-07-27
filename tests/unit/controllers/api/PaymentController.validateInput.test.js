/**
 * PaymentController.validatePaymentInput unit tests.
 *
 * El monto debe ser un número mayor a 0 (floor > 0): un monto 0, negativo o no finito se rechaza
 * con ese mensaje exacto. Se valida además el techo AMOUNT_MAX, el método y la moneda; el resultado
 * se normaliza a { amount, currency, method }.
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
  describe('happy paths', () => {
    it('accepts a normal payment (amount > 0) and normalizes it to { amount, currency, method }', () => {
      const r = PaymentController.validatePaymentInput({ amount: 500, currency: 'MXN', method: M });
      expect(r.error).toBeUndefined();
      expect(r).toEqual({ amount: 500, currency: 'MXN', method: M });
    });

    it('defaults currency to MXN and uppercases a lowercase currency', () => {
      const r = PaymentController.validatePaymentInput({ amount: 10, method: M });
      expect(r.currency).toBe('MXN');
      const usd = PaymentController.validatePaymentInput({ amount: 10, currency: 'usd', method: M });
      expect(usd.currency).toBe('USD');
    });
  });

  describe('amount floor (> 0)', () => {
    it('rejects amount 0 with the exact message', () => {
      const r = PaymentController.validatePaymentInput({ amount: 0, currency: 'MXN', method: M });
      expect(r.error).toBe('El monto debe ser un número mayor a 0');
    });

    it('rejects a negative amount with the exact message', () => {
      const r = PaymentController.validatePaymentInput({ amount: -100, currency: 'MXN', method: M });
      expect(r.error).toBe('El monto debe ser un número mayor a 0');
    });

    it('rejects a non-finite amount', () => {
      const r = PaymentController.validatePaymentInput({ amount: 'abc', currency: 'MXN', method: M });
      expect(r.error).toMatch(/mayor a 0/);
    });
  });

  describe('pre-existing validations left intact', () => {
    it('rejects an amount over the maximum', () => {
      const r = PaymentController.validatePaymentInput({ amount: 100000001, currency: 'MXN', method: M });
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
