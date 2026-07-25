/**
 * Payment gateway fields — unit tests (no Parse server).
 *
 * Covers the 9 additive online-gateway getters/setters (round-trip + unset=undefined), the
 * formatPayment DTO contract (exposes ONLY channel/gateway/gatewayStatus/gatewayChargeId; NEVER
 * gatewayIntentId/gatewayRaw, even when set; legacy manual -> channel:'manual', rest null), and
 * the hard rule that Payment.METHODS stays exactly ['efectivo','transferencia','tarjeta'] with
 * 'stripe'/'online' NOT valid methods (regression that fails if channel/gateway leak into method).
 */

const Payment = require('../../../src/domain/models/Payment');

describe('Payment gateway fields', () => {
  describe('getters/setters round-trip', () => {
    it('round-trips all 9 gateway fields through their get/set pairs', () => {
      const p = new Payment();
      const expires = new Date('2026-08-01T12:00:00.000Z');
      const confirmed = new Date('2026-08-01T12:05:00.000Z');
      const raw = { status: 'succeeded', brand: 'visa', last4: '4242', fee: 12.34 };

      p.setChannel('online');
      p.setGateway('stripe');
      p.setGatewayStatus('succeeded');
      p.setGatewayIntentId('pi_123');
      p.setGatewaySessionId('cs_456');
      p.setGatewayChargeId('ch_789');
      p.setGatewayRaw(raw);
      p.setExpiresAt(expires);
      p.setConfirmedAt(confirmed);

      expect(p.getChannel()).toBe('online');
      expect(p.getGateway()).toBe('stripe');
      expect(p.getGatewayStatus()).toBe('succeeded');
      expect(p.getGatewayIntentId()).toBe('pi_123');
      expect(p.getGatewaySessionId()).toBe('cs_456');
      expect(p.getGatewayChargeId()).toBe('ch_789');
      expect(p.getGatewayRaw()).toEqual(raw);
      expect(p.getExpiresAt()).toBe(expires);
      expect(p.getConfirmedAt()).toBe(confirmed);
    });

    it('a getter with no prior set returns undefined (no implicit default at the model layer)', () => {
      const p = new Payment();
      expect(p.getChannel()).toBeUndefined();
      expect(p.getGateway()).toBeUndefined();
      expect(p.getGatewayStatus()).toBeUndefined();
      expect(p.getGatewayIntentId()).toBeUndefined();
      expect(p.getGatewaySessionId()).toBeUndefined();
      expect(p.getGatewayChargeId()).toBeUndefined();
      expect(p.getGatewayRaw()).toBeUndefined();
      expect(p.getExpiresAt()).toBeUndefined();
      expect(p.getConfirmedAt()).toBeUndefined();
    });

    it('round-trips a large gatewayRaw object without mutating it', () => {
      const p = new Payment();
      const big = {
        id: 'evt_1', type: 'payment_intent.succeeded',
        data: { object: { status: 'succeeded', charges: { data: [{ id: 'ch_1', amount: 185000 }] } } },
        nested: { a: { b: { c: Array.from({ length: 50 }, (_, i) => i) } } },
      };
      p.setGatewayRaw(big);
      expect(p.getGatewayRaw()).toEqual(big);
    });

    it('stores expiresAt/confirmedAt as Date and accepts null', () => {
      const p = new Payment();
      const d = new Date('2026-01-01T00:00:00.000Z');
      p.setExpiresAt(d);
      p.setConfirmedAt(null);
      expect(p.getExpiresAt()).toBeInstanceOf(Date);
      expect(p.getExpiresAt().getTime()).toBe(d.getTime());
      expect(p.getConfirmedAt()).toBeNull();
    });

    it('does NOT normalize gatewayStatus — stores the literal string as given', () => {
      const p = new Payment();
      p.setGatewayStatus('SUCCEEDED');
      expect(p.getGatewayStatus()).toBe('SUCCEEDED'); // not lowercased/trimmed
    });
  });

  describe('formatPayment DTO contract', () => {
    it('exposes the 4 allowed gateway fields and NEVER gatewayIntentId/gatewayRaw (even when set)', () => {
      const p = new Payment();
      p.setChannel('online');
      p.setGateway('stripe');
      p.setGatewayStatus('succeeded');
      p.setGatewayChargeId('ch_789');
      // Sensitive/noisy fields that must never be serialized:
      p.setGatewayIntentId('pi_secret');
      p.setGatewaySessionId('cs_secret');
      p.setGatewayRaw({ last4: '4242', brand: 'visa' });
      p.setExpiresAt(new Date());
      p.setConfirmedAt(new Date());

      const dto = Payment.formatPayment(p);

      expect(dto.channel).toBe('online');
      expect(dto.gateway).toBe('stripe');
      expect(dto.gatewayStatus).toBe('succeeded');
      expect(dto.gatewayChargeId).toBe('ch_789');

      expect(dto).not.toHaveProperty('gatewayIntentId');
      expect(dto).not.toHaveProperty('gatewayRaw');
      // Not part of the DTO in this PR (only the 4 above are exposed):
      expect(dto).not.toHaveProperty('gatewaySessionId');
      expect(dto).not.toHaveProperty('expiresAt');
      expect(dto).not.toHaveProperty('confirmedAt');
    });

    it('a legacy manual payment (no gateway fields set) -> channel:manual, rest null', () => {
      const p = new Payment();
      p.setAmount(500);
      p.setMethod('efectivo');

      const dto = Payment.formatPayment(p);

      expect(dto.channel).toBe('manual');
      expect(dto.gateway).toBeNull();
      expect(dto.gatewayStatus).toBeNull();
      expect(dto.gatewayChargeId).toBeNull();
      // Manual DTO still carries its normal fields.
      expect(dto.amount).toBe(500);
      expect(dto.method).toBe('efectivo');
    });
  });

  describe('Payment.METHODS is the closed tier enum (channel/gateway are orthogonal)', () => {
    it('METHODS is exactly the 3 tiers', () => {
      expect(Payment.METHODS).toEqual(['efectivo', 'transferencia', 'tarjeta']);
    });

    it("'stripe' and 'online' are NOT valid methods (regression: never leak into method)", () => {
      expect(Payment.isValidMethod('stripe')).toBe(false);
      expect(Payment.isValidMethod('online')).toBe(false);
      expect(Payment.isValidMethod('efectivo')).toBe(true);
      expect(Payment.isValidMethod('transferencia')).toBe(true);
      expect(Payment.isValidMethod('tarjeta')).toBe(true);
    });
  });
});
