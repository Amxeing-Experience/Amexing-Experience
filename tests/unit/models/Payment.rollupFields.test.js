/**
 * Payment PR6 housekeeping fields — unit tests (no Parse server).
 *
 * retiredBySystem / lastReconciledAt / requiresRefundReview are INTERNAL state: they drive the
 * revive decision, the reconciliation cursor and the refund-review marker. None of them may ever
 * reach a client through formatPayment — the same standard gatewayIntentId/gatewayRaw already hold.
 *
 * The booleans coerce on both sides on purpose: `retiredBySystem` is read by a Mongo filter that
 * matches literal `true`, so a truthy-but-not-true value ('1', 1) stored by accident would make a
 * retired row unrevivable — a silently lost charge.
 */

const Payment = require('../../../src/domain/models/Payment');

describe('Payment rollup housekeeping fields (PR6)', () => {
  describe('getters/setters round-trip', () => {
    it('round-trips the four new fields', () => {
      const p = new Payment();
      const reconciled = new Date('2026-07-30T12:00:00.000Z');

      p.setRetiredBySystem(true);
      p.setLastReconciledAt(reconciled);
      p.setRequiresRefundReview(true);
      p.setRequiresRollupRepair(true);

      expect(p.getRetiredBySystem()).toBe(true);
      expect(p.getLastReconciledAt()).toBe(reconciled);
      expect(p.getRequiresRefundReview()).toBe(true);
      expect(p.getRequiresRollupRepair()).toBe(true);
    });

    it('an unset boolean reads as false (never undefined) so a filter can rely on it', () => {
      const p = new Payment();
      expect(p.getRetiredBySystem()).toBe(false);
      expect(p.getRequiresRefundReview()).toBe(false);
      expect(p.getRequiresRollupRepair()).toBe(false);
      expect(p.getLastReconciledAt()).toBeUndefined();
    });

    it('setRequiresRollupRepair coerces, and false really clears it (the repair path writes that)', () => {
      const p = new Payment();
      p.setRequiresRollupRepair('sí');
      expect(p.get('requiresRollupRepair')).toBe(false);
      p.setRequiresRollupRepair(true);
      expect(p.get('requiresRollupRepair')).toBe(true);
      p.setRequiresRollupRepair(false);
      expect(p.getRequiresRollupRepair()).toBe(false);
    });

    it.each([
      ['a truthy string', '1'],
      ['a truthy number', 1],
      ['an object', {}],
      ['null', null],
      ['undefined', undefined],
      ['zero', 0],
      ['an empty string', ''],
      ['the string "false"', 'false'],
    ])('setRetiredBySystem coerces %s to a strict boolean', (_label, value) => {
      const p = new Payment();
      p.setRetiredBySystem(value);
      expect(p.get('retiredBySystem')).toBe(value === true);
      expect(typeof p.get('retiredBySystem')).toBe('boolean');
    });

    it('setRequiresRefundReview coerces the same way', () => {
      const p = new Payment();
      p.setRequiresRefundReview('sí');
      expect(p.get('requiresRefundReview')).toBe(false);
      p.setRequiresRefundReview(true);
      expect(p.get('requiresRefundReview')).toBe(true);
    });

    it('setRetiredBySystem(false) really clears it (the revive path writes exactly this)', () => {
      const p = new Payment();
      p.setRetiredBySystem(true);
      p.setRetiredBySystem(false);
      expect(p.getRetiredBySystem()).toBe(false);
    });
  });

  describe('formatPayment never serializes them', () => {
    it('none of the four appears in the DTO even when all are set', () => {
      const p = new Payment();
      p.setAmount(1000);
      p.setMethod('tarjeta');
      p.setChannel('online');
      p.setGateway('stripe');
      p.setGatewayStatus('succeeded');
      p.setRetiredBySystem(true);
      p.setLastReconciledAt(new Date());
      p.setRequiresRefundReview(true);
      p.setRequiresRollupRepair(true);

      const dto = Payment.formatPayment(p);
      const keys = Object.keys(dto);
      const blob = JSON.stringify(dto);
      for (const field of ['retiredBySystem', 'lastReconciledAt', 'requiresRefundReview', 'requiresRollupRepair']) {
        expect(keys).not.toContain(field);
        expect(blob).not.toContain(field);
      }
    });

    it('the DTO still exposes exactly the fields it exposed before (no accidental widening)', () => {
      const p = new Payment();
      p.setRetiredBySystem(true);
      p.setRequiresRollupRepair(true);
      expect(Object.keys(Payment.formatPayment(p)).sort()).toEqual([
        'amount', 'channel', 'createdAt', 'exchangeRate', 'gateway', 'gatewayChargeId',
        'gatewayStatus', 'id', 'method', 'notes', 'origAmount', 'origCurrency', 'paidAt',
        'paymentInfoId', 'paymentInfoName', 'receiptS3Key', 'receivedBy', 'reference',
        'registeredById', 'registeredByName', 'reservationServiceId', 'updatedAt', 'validatedAt',
      ]);
    });
  });
});
