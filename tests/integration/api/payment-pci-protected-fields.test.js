/**
 * Payment PCI protectedFields — integration (Parse real + mongodb-memory-server).
 *
 * formatPayment hides gatewayRaw/gatewayIntentId/gatewaySessionId on the HTTP path, but the Payment
 * class keeps parse-server's public find/get CLP — so a direct Parse REST query could otherwise read
 * those raw fields (PR 4/5 fill gatewayRaw with the provider payload, possibly PAN/tokens). Seed 026's
 * protectPaymentPciFields() adds schema-level protectedFields for '*'. This test proves: a query WITHOUT
 * masterKey does NOT return the 3 PCI fields, but WITH masterKey it does (server keeps full access), and
 * the intentionally-public gateway fields (channel/gateway/gatewayStatus/gatewayChargeId) stay visible.
 */

const Parse = require('parse/node');
const {
  protectPaymentPciFields,
  PCI_PROTECTED_FIELDS,
} = require('../../../scripts/seeds/026-create-gatewayevent-class');

describe('Payment PCI protectedFields (integration)', () => {
  let paymentId;
  const created = [];

  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    // Create a Payment (masterKey) with all PCI + public gateway fields set. This auto-creates the
    // Payment class + fields in the memory DB if not present.
    const payment = new Parse.Object('Payment');
    payment.set('active', true);
    payment.set('exists', true);
    payment.set('amount', 1234);
    payment.set('method', 'tarjeta');
    payment.set('channel', 'online');
    payment.set('gateway', 'stripe');
    payment.set('gatewayStatus', 'succeeded');
    payment.set('gatewayChargeId', 'ch_public');
    payment.set('gatewayIntentId', 'pi_secret');
    payment.set('gatewaySessionId', 'cs_secret');
    payment.set('gatewayRaw', { last4: '4242', brand: 'visa', token: 'tok_secret' });
    await payment.save(null, { useMasterKey: true });
    paymentId = payment.id;
    created.push(payment);

    // Apply the exact protection the seed applies in Dev/Staging/Prod.
    await protectPaymentPciFields();
  }, 30000);

  afterAll(async () => {
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch (e) { /* gone */ }
    }
  });

  const fetchPayment = (useMasterKey) => {
    const q = new Parse.Query('Payment');
    q.equalTo('objectId', paymentId);
    return q.first(useMasterKey ? { useMasterKey: true } : undefined);
  };

  it('a query WITHOUT masterKey strips the 3 PCI fields but keeps the public ones', async () => {
    const obj = await fetchPayment(false);
    expect(obj).toBeDefined();
    expect(obj.id).toBe(paymentId);

    // PCI-sensitive fields must be absent for public reads.
    for (const f of PCI_PROTECTED_FIELDS) {
      expect(obj.get(f)).toBeUndefined();
    }

    // Intentionally-public gateway fields remain visible.
    expect(obj.get('channel')).toBe('online');
    expect(obj.get('gateway')).toBe('stripe');
    expect(obj.get('gatewayStatus')).toBe('succeeded');
    expect(obj.get('gatewayChargeId')).toBe('ch_public');
    expect(obj.get('amount')).toBe(1234);
  });

  it('a query WITH masterKey still returns the PCI fields (server keeps full access)', async () => {
    const obj = await fetchPayment(true);
    expect(obj).toBeDefined();
    expect(obj.get('gatewayIntentId')).toBe('pi_secret');
    expect(obj.get('gatewaySessionId')).toBe('cs_secret');
    expect(obj.get('gatewayRaw')).toEqual({ last4: '4242', brand: 'visa', token: 'tok_secret' });
  });

  it('protectPaymentPciFields is idempotent (re-applying does not throw or break access)', async () => {
    await protectPaymentPciFields();
    const publicObj = await fetchPayment(false);
    expect(publicObj.get('gatewayRaw')).toBeUndefined();
    const masterObj = await fetchPayment(true);
    expect(masterObj.get('gatewayRaw')).toEqual({ last4: '4242', brand: 'visa', token: 'tok_secret' });
  });
});
