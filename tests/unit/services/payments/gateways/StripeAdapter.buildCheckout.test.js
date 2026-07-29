/**
 * StripeAdapter.buildCheckout — unit tests against a MOCK Stripe client (zero network, zero real
 * SDK require). Covers the money/currency conventions (centavos, lowercase currency, no surcharge),
 * metadata on session + intent, idempotency key in request options, response mapping, wrapped SDK
 * errors, and up-front rejection of an invalid amount / unsupported currency BEFORE the SDK is hit.
 */

const StripeAdapter = require('../../../../../src/application/services/payments/gateways/StripeAdapter');
const PaymentGatewayError = require('../../../../../src/application/services/payments/PaymentGatewayError');

/**
 * Build a mock Stripe client whose checkout.sessions.create is a jest.fn.
 * @param {object} [session] - Overrides merged into the resolved session.
 * @returns {{ client: object, create: Function }} The mock client and its create spy.
 */
function makeMock(session = {}) {
  const create = jest.fn().mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    payment_intent: 'pi_test_456',
    status: 'open',
    ...session,
  });
  return { client: { checkout: { sessions: { create } } }, create };
}

const baseReq = () => ({
  amount: 9680,
  currency: 'MXN',
  reservationId: 'res_1',
  paymentId: 'pay_1',
  idempotencyKey: 'pay_1',
  successUrl: 'https://app/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://app/cancel',
});

describe('StripeAdapter.buildCheckout (mock client)', () => {
  it('U13 MXN amount -> unit_amount in centavos + lowercase "mxn"', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    await adapter.buildCheckout({ ...baseReq(), amount: 9680, currency: 'MXN' });
    const [params] = create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(968000);
    expect(params.line_items[0].price_data.currency).toBe('mxn');
  });

  it('U14 USD amount -> unit_amount in centavos + lowercase "usd"', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    const r = await adapter.buildCheckout({ ...baseReq(), amount: 100, currency: 'USD' });
    const [params] = create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(10000);
    expect(params.line_items[0].price_data.currency).toBe('usd');
    expect(r.currency).toBe('USD'); // result echoes the MAJOR-unit ISO code, uppercase
  });

  it('U15 no surcharge: the charged amount equals the requested amount (no ×1.05)', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    const r = await adapter.buildCheckout({ ...baseReq(), amount: 9680 });
    expect(r.amount).toBe(9680);
    expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(968000);
  });

  it('U16 fractional amount rounds to the nearest centavo', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    await adapter.buildCheckout({ ...baseReq(), amount: 1850.5, currency: 'USD' });
    expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(185050);
  });

  it('U17 restricts the offered method to card only', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    await adapter.buildCheckout(baseReq());
    expect(create.mock.calls[0][0].payment_method_types).toEqual(['card']);
    expect(create.mock.calls[0][0].mode).toBe('payment');
  });

  it('U18 puts reservationId/paymentId in metadata AND payment_intent_data.metadata', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    await adapter.buildCheckout({ ...baseReq(), reservationId: 'res_9', paymentId: 'pay_9' });
    const [params] = create.mock.calls[0];
    expect(params.metadata).toEqual(expect.objectContaining({ reservationId: 'res_9', paymentId: 'pay_9' }));
    expect(params.payment_intent_data.metadata).toEqual(
      expect.objectContaining({ reservationId: 'res_9', paymentId: 'pay_9' })
    );
  });

  it('U19 passes the idempotency key in the request options (never the params)', async () => {
    const { client, create } = makeMock();
    const adapter = new StripeAdapter({ client });
    await adapter.buildCheckout({ ...baseReq(), idempotencyKey: 'pay_777' });
    const [, options] = create.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: 'pay_777' });
  });

  it('U20 maps session -> { checkoutUrl, gatewaySessionId, gatewayIntentId }', async () => {
    const { client } = makeMock({ id: 'cs_map', url: 'https://pay/cs_map', payment_intent: 'pi_map' });
    const adapter = new StripeAdapter({ client });
    const r = await adapter.buildCheckout(baseReq());
    expect(r.checkoutUrl).toBe('https://pay/cs_map');
    expect(r.gatewaySessionId).toBe('cs_map');
    expect(r.gatewayIntentId).toBe('pi_map');
    expect(r.status).toBe('requires_payment');
    expect(r.gateway).toBe('stripe');
  });

  it('U20b extracts the id when payment_intent is an expanded object', async () => {
    const { client } = makeMock({ payment_intent: { id: 'pi_expanded', object: 'payment_intent' } });
    const adapter = new StripeAdapter({ client });
    const r = await adapter.buildCheckout(baseReq());
    expect(r.gatewayIntentId).toBe('pi_expanded');
  });

  it('U21 wraps a raw SDK error in PaymentGatewayError (PROVIDER_ERROR); raw SDK object NEVER embedded (PCI)', async () => {
    // The raw SDK error carries card-adjacent junk (last4/PAN) that must NEVER leak through logging.
    const rawErr = Object.assign(new Error('card_declined'), { last4: '4242', pan: '4111111111111111' });
    const create = jest.fn().mockRejectedValue(rawErr);
    const adapter = new StripeAdapter({ client: { checkout: { sessions: { create } } } });
    let error;
    try {
      await adapter.buildCheckout(baseReq());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
    // council PCI: the raw SDK object is NOT attached at all (providerError stays null). A non-enumerable
    // property was still reachable via getOwnPropertyNames, so the only safe design is to never embed it.
    expect(error.providerError).toBeNull();
    // Neither a plain stringify NOR the adversarial own-property-name walk can surface last4/PAN.
    expect(JSON.stringify(error)).not.toContain('4242');
    const adversarial = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(adversarial).not.toContain('4242');
    expect(adversarial).not.toContain('4111111111111111');
  });

  describe('U23 invalid amount / currency rejected BEFORE the SDK is called', () => {
    it.each([0, -100, NaN, undefined, 'abc'])('amount %p -> PROVIDER_ERROR, create never called', async (amount) => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      let error;
      try {
        await adapter.buildCheckout({ ...baseReq(), amount });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
      expect(create).not.toHaveBeenCalled();
    });

    it('unsupported currency -> UNSUPPORTED_CURRENCY, create never called', async () => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      let error;
      try {
        await adapter.buildCheckout({ ...baseReq(), currency: 'EUR' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.UNSUPPORTED_CURRENCY);
      expect(create).not.toHaveBeenCalled();
    });
  });

  it('isConfigured() is true when a client is injected', () => {
    const { client } = makeMock();
    expect(new StripeAdapter({ client }).isConfigured()).toBe(true);
  });

  describe('BUG B — expires_at aligned to the local pending TTL (no 24h-vs-30min double session)', () => {
    it('sets expires_at (Unix seconds) inside Stripe\'s [now+30min, now+24h] window', async () => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      const before = Date.now();
      await adapter.buildCheckout(baseReq());
      const after = Date.now();
      const { expires_at: expiresAt } = create.mock.calls[0][0];
      expect(Number.isInteger(expiresAt)).toBe(true);
      // Must be >= now+30min (Stripe's hard minimum) and <= now+24h (its hard maximum), in seconds.
      const minSec = Math.floor((before + 30 * 60 * 1000) / 1000);
      const maxSec = Math.floor((after + 24 * 60 * 60 * 1000) / 1000);
      expect(expiresAt).toBeGreaterThanOrEqual(minSec);
      expect(expiresAt).toBeLessThanOrEqual(maxSec);
      // And close to the 31-min cushion (aligned with the 30-min local pending), not Stripe's 24h default.
      expect(expiresAt).toBeLessThanOrEqual(Math.floor((after + 32 * 60 * 1000) / 1000));
    });
  });

  describe('HIGH — expires_at is FROZEN from sessionExpiresAt (idempotency-safe, not Date.now())', () => {
    it('stamps expires_at = floor(sessionExpiresAt/1000) verbatim, independent of Date.now()', async () => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      const frozenMs = 1_900_000_000_000; // a fixed epoch ms, unrelated to the current clock
      await adapter.buildCheckout({ ...baseReq(), sessionExpiresAt: frozenMs });
      expect(create.mock.calls[0][0].expires_at).toBe(Math.floor(frozenMs / 1000));
    });

    it('two calls with the SAME frozen sessionExpiresAt send the SAME expires_at even as the clock advances', async () => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      const frozenMs = Date.now() + 31 * 60 * 1000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
      try {
        await adapter.buildCheckout({ ...baseReq(), sessionExpiresAt: frozenMs });
        nowSpy.mockReturnValue(1_000_000_000_000 + 10 * 60 * 1000); // +10 min later
        await adapter.buildCheckout({ ...baseReq(), sessionExpiresAt: frozenMs });
      } finally {
        nowSpy.mockRestore();
      }
      expect(create.mock.calls[0][0].expires_at).toBe(create.mock.calls[1][0].expires_at);
      expect(create.mock.calls[0][0].expires_at).toBe(Math.floor(frozenMs / 1000));
    });

    it('falls back to a now-based window when no sessionExpiresAt is provided', async () => {
      const { client, create } = makeMock();
      const adapter = new StripeAdapter({ client });
      const before = Date.now();
      await adapter.buildCheckout(baseReq()); // no sessionExpiresAt
      const after = Date.now();
      const { expires_at: expiresAt } = create.mock.calls[0][0];
      expect(expiresAt).toBeGreaterThanOrEqual(Math.floor((before + 30 * 60 * 1000) / 1000));
      expect(expiresAt).toBeLessThanOrEqual(Math.floor((after + 32 * 60 * 1000) / 1000));
    });
  });

  describe('BUG B — expireCheckout closes an old session', () => {
    it('calls client.checkout.sessions.expire with the session id and returns the SDK result', async () => {
      const expire = jest.fn().mockResolvedValue({ id: 'cs_old', status: 'expired' });
      const adapter = new StripeAdapter({ client: { checkout: { sessions: { expire } } } });
      const out = await adapter.expireCheckout('cs_old');
      expect(expire).toHaveBeenCalledWith('cs_old');
      expect(out).toEqual({ id: 'cs_old', status: 'expired' });
    });

    it('wraps an SDK failure in PROVIDER_ERROR and never embeds the raw SDK object (PCI)', async () => {
      const rawErr = Object.assign(new Error('already expired'), { last4: '4242', pan: '4111111111111111' });
      const expire = jest.fn().mockRejectedValue(rawErr);
      const adapter = new StripeAdapter({ client: { checkout: { sessions: { expire } } } });
      let error;
      try {
        await adapter.expireCheckout('cs_old');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error.code).toBe(PaymentGatewayError.CODES.PROVIDER_ERROR);
      expect(error.providerError).toBeNull();
      const adversarial = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(adversarial).not.toContain('4242');
      expect(adversarial).not.toContain('4111111111111111');
    });
  });
});
