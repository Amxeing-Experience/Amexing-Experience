/**
 * Seed 008 (system settings) - activePaymentGateway entry integration tests.
 *
 * Runs in the IN-MEMORY test database (MongoDB Memory Server, port 1339); never touches
 * dev or prod. Verifies the same idempotency contract paymentSurchargePercentage already
 * has: first run creates the setting, re-runs do not duplicate, and a value an admin
 * changed is PRESERVED across re-runs (the seed only updates metadata, never the value).
 */

const Parse = require('parse/node');

const seed = require('../../../scripts/seeds/008-seed-system-settings');

const GATEWAY_KEY = 'activePaymentGateway';

/**
 * Hard-delete every Setting row (any exists flag) for the gateway key, to guarantee a
 * clean slate independent of what globalSetup or other suites left behind.
 */
async function purgeGatewaySetting() {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  const rows = await query.find({ useMasterKey: true });
  for (const row of rows) {
    await row.destroy({ useMasterKey: true });
  }
}

/**
 * @returns {Promise<Parse.Object|undefined>} The single existing gateway Setting.
 */
async function findGatewaySetting() {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  query.equalTo('exists', true);
  return query.first({ useMasterKey: true });
}

/**
 * @returns {Promise<number>} Count of existing gateway Settings (duplicate detector).
 */
async function countGatewaySettings() {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  query.equalTo('exists', true);
  return query.count({ useMasterKey: true });
}

describe('Seed 008: activePaymentGateway setting', () => {
  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';

    await purgeGatewaySetting();
  }, 60000);

  afterAll(async () => {
    await purgeGatewaySetting();
  });

  it('first run creates the setting with the expected values (numeric code 0 = stripe)', async () => {
    await seed.run();

    const setting = await findGatewaySetting();
    expect(setting).toBeDefined();
    // The value MUST persist as the NUMBER 0, not the string 'stripe': Setting.value is a
    // Number column in Parse, which is exactly what blocked the earlier string design.
    expect(setting.get('value')).toBe(0);
    expect(typeof setting.get('value')).toBe('number');
    expect(setting.get('valueType')).toBe('number');
    expect(setting.get('category')).toBe('payments');
    expect(setting.get('displayName')).toBe('Pasarela de Pago Activa');
    expect(setting.get('editable')).toBe(true);
    expect(setting.get('active')).toBe(true);
    expect(setting.get('exists')).toBe(true);
  });

  it('a second run does not duplicate the setting', async () => {
    await seed.run();
    expect(await countGatewaySettings()).toBe(1);
  });

  it('preserves an admin-changed value (does not reset code 1 = mexican back to 0 = stripe)', async () => {
    const setting = await findGatewaySetting();
    setting.set('value', 1); // 1 = 'mexican' (numeric code, matches the Number column)
    await setting.save(null, { useMasterKey: true });

    await seed.run();

    const after = await findGatewaySetting();
    expect(after.get('value')).toBe(1);
    expect(typeof after.get('value')).toBe('number');
    expect(await countGatewaySettings()).toBe(1);
  });
});
