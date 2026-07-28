/**
 * stripeClient — lazy-require + configuration guards (no real `stripe` package installed).
 *
 * The whole point: requiring this module must NEVER pull in the `stripe` package, so the app boots
 * without it. We prove that by making `stripe` a virtual mock that THROWS if it is ever required —
 * loading stripeClient stays green, and only a real getStripeClient() build (client not injected,
 * a key present) reaches the throwing require, confirming require('stripe') lives inside the
 * function. An injected client short-circuits before the require entirely.
 */

// Virtual mock: `stripe` is not installed. If anything ever require()s it, throw loudly so a
// non-lazy require would fail this suite immediately.
jest.mock('stripe', () => { throw new Error('Cannot find module "stripe" (virtual mock)'); }, { virtual: true });

const stripeClient = require('../../../../src/infrastructure/payments/stripeClient');

describe('stripeClient (lazy require + guards)', () => {
  const savedTest = process.env.STRIPE_SECRET_KEY_TEST;
  const savedLive = process.env.STRIPE_SECRET_KEY_LIVE;

  beforeEach(() => {
    stripeClient.resetForTests();
    delete process.env.STRIPE_SECRET_KEY_TEST;
    delete process.env.STRIPE_SECRET_KEY_LIVE;
  });

  afterAll(() => {
    stripeClient.resetForTests();
    if (savedTest === undefined) delete process.env.STRIPE_SECRET_KEY_TEST;
    else process.env.STRIPE_SECRET_KEY_TEST = savedTest;
    if (savedLive === undefined) delete process.env.STRIPE_SECRET_KEY_LIVE;
    else process.env.STRIPE_SECRET_KEY_LIVE = savedLive;
  });

  it('U24 requiring the module does not throw and does not require the stripe package', () => {
    // If require('stripe') ran at module scope, the virtual throwing mock would have blown up the
    // top-level require above; reaching here proves it did not.
    expect(typeof stripeClient.getStripeClient).toBe('function');
    expect(typeof stripeClient.isStripeConfigured).toBe('function');
  });

  it('U24 an injected mock client is returned WITHOUT ever requiring the real SDK', () => {
    const fakeClient = { checkout: { sessions: { create: () => {} } } };
    stripeClient.setClientForTests(fakeClient);
    expect(stripeClient.isStripeConfigured()).toBe(true);
    // Would throw if it reached require('stripe'); it must not.
    expect(stripeClient.getStripeClient()).toBe(fakeClient);
  });

  it('isStripeConfigured() is false with neither an injected client nor a key', () => {
    expect(stripeClient.isStripeConfigured()).toBe(false);
  });

  it('isStripeConfigured() is true once a (test) key is present', () => {
    process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_abc';
    expect(stripeClient.isStripeConfigured()).toBe(true);
  });

  it('U25 getStripeClient() throws NOT-CONFIGURED before any require when no key/client', () => {
    // Reaches neither the require nor a build: fails on the missing key, proving the require is not
    // at module scope (module load succeeded).
    expect(() => stripeClient.getStripeClient()).toThrow(/not configured/i);
  });

  it('U25 getStripeClient() only reaches require("stripe") when actually building a real client', () => {
    process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_abc';
    // No injected client -> it must build a real one -> LAZY require('stripe') runs here -> the
    // virtual mock throws its "Cannot find module" error, proving require is inside the function.
    expect(() => stripeClient.getStripeClient()).toThrow(/Cannot find module "stripe"/);
  });

  it('boot guard rejects a live key outside production', () => {
    process.env.STRIPE_SECRET_KEY_TEST = 'sk_live_should_not_be_here';
    // NODE_ENV=test (non-prod): a live-looking key must fail the env guard BEFORE requiring the SDK.
    expect(() => stripeClient.getStripeClient()).toThrow(/LIVE secret key/);
  });

  describe('MEDIUM — env guard also gates RESTRICTED (rk_) keys by mode, rejects unknown prefixes', () => {
    it('rejects a RESTRICTED LIVE key (rk_live_) outside production', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'rk_live_restricted_should_not_be_here';
      // A restricted live key moves real money exactly like sk_live_; it must be blocked in non-prod too.
      expect(() => stripeClient.getStripeClient()).toThrow(/LIVE secret key/);
    });

    it('accepts a RESTRICTED TEST key (rk_test_) in non-production (reaches the lazy require)', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'rk_test_restricted_ok';
      // Mode matches the env -> passes the guard and only then hits require('stripe') (virtual throw).
      expect(() => stripeClient.getStripeClient()).toThrow(/Cannot find module "stripe"/);
    });

    it('rejects an unknown key prefix (never assumed to be a test key)', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'pk_test_publishable_is_wrong_here';
      expect(() => stripeClient.getStripeClient()).toThrow(/unrecognized prefix/);
    });
  });

  describe('LOW — isStripeConfigured requires a valid key prefix, not just a non-empty string', () => {
    it('a junk non-empty key is NOT considered configured', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'garbage-not-a-real-key';
      expect(stripeClient.isStripeConfigured()).toBe(false);
    });

    it('a restricted (rk_test_) key IS considered configured', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'rk_test_abc';
      expect(stripeClient.isStripeConfigured()).toBe(true);
    });
  });
});
