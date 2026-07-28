/**
 * Active payment gateway toggle endpoint - integration tests (Parse real + Memory DB).
 *
 * Covers:
 * - RBAC on GET and PUT (admin/superadmin pass; department_manager/client/employee 403;
 *   no token 401), and that a 403 leaves the setting unchanged.
 * - Malformed body rejection (missing / non-string / empty / unknown id) with no DB change.
 * - The already-resolved central case: gateway 'mexican' (Openpay stub, unconfigured) is
 *   saved anyway (the endpoint does NOT gate on isConfigured(); the router fallback does).
 * - Normalization: 'Stripe' / ' MEXICAN ' are trimmed+lowercased before persisting.
 * - Real cache behavior: a PUT is visible on the very next GET (same tick), proving the
 *   read is not served stale.
 * - Numeric persistence: the toggle lands in Setting.value as a NUMBER (0/1), never a
 *   string, while the HTTP boundary keeps speaking the string ids (the exact schema
 *   constraint that blocked the earlier string-based design).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const {
  encodeGatewayId,
} = require('../../../src/application/services/payments/gatewayBootstrap');

const ROUTE = '/api/settings/active-gateway';
const GATEWAY_KEY = 'activePaymentGateway';

// The settings routes cap writes at 10/min per IP (settingsRoutes.writeRateLimit). This
// suite legitimately makes far more than 10 PUTs, all from the same test IP, so without a
// reset the later PUTs would 429. Reset every express-rate-limit middleware in the app
// before each test to isolate tests from the shared rate-limit window (test-only; the
// production limiter is untouched). req.ip under supertest is '::ffff:127.0.0.1'.
const RATE_LIMIT_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

/**
 * Recursively walk the Express router stack and reset any express-rate-limit middleware
 * (identified by its resetKey method) for the known test IPs.
 * @param {object} expressApp - The Express app instance.
 */
function resetRateLimiters(expressApp) {
  const rootRouter = expressApp.router || expressApp._router;
  if (!rootRouter || !Array.isArray(rootRouter.stack)) {
    return;
  }
  const seen = new Set();
  const walk = (stack) => {
    for (const layer of stack) {
      if (!layer) {
        continue;
      }
      const handle = layer.handle;
      if (handle && !seen.has(handle)) {
        seen.add(handle);
        if (typeof handle.resetKey === 'function') {
          for (const key of RATE_LIMIT_KEYS) {
            try {
              handle.resetKey(key);
            } catch {
              // ignore: key may not exist in this limiter's store yet
            }
          }
        }
        // Nested router (e.g. app.use('/api', apiRouter)) middlewares live here.
        if (Array.isArray(handle.stack)) {
          walk(handle.stack);
        }
      }
      // Route-level middlewares (router.put('/x', limiter, handler)) live on layer.route.
      if (layer.route && Array.isArray(layer.route.stack)) {
        walk(layer.route.stack);
      }
    }
  };
  walk(rootRouter.stack);
}

/**
 * Force the stored toggle to a known value via a direct Parse write (not the endpoint),
 * so each test starts from a deterministic baseline. Takes the string id and persists the
 * NUMERIC code, mirroring exactly how the endpoint stores it (Setting.value is a Number
 * column: 0 = 'stripe', 1 = 'mexican').
 * @param {string} id - The gateway id to persist ('stripe' | 'mexican').
 */
async function setGatewaySetting(id) {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  query.equalTo('exists', true);
  const existing = await query.first({ useMasterKey: true });

  // Always write through a FRESH, generic Parse.Object -- never mutate the fetched Setting
  // instance. Once src/index is loaded, 'Setting' is a registered Parse subclass whose
  // validate() override returns a truthy {valid, errors} object, and Parse SDK set() throws
  // that object. A generic Parse.Object uses the default no-op validate. This mirrors the
  // controller's fresh-object pattern exactly.
  const setting = new Parse.Object('Setting');
  if (existing) {
    setting.id = existing.id;
    setting.set('key', existing.get('key') || GATEWAY_KEY);
    setting.set('category', existing.get('category') || 'payments');
    setting.set('displayName', existing.get('displayName') || 'Pasarela de Pago Activa');
    setting.set('description', existing.get('description') || 'test baseline');
    setting.set('editable', existing.get('editable') !== false);
    setting.set('active', existing.get('active') !== false);
    setting.set('exists', existing.get('exists') !== false);
  } else {
    setting.set('key', GATEWAY_KEY);
    setting.set('category', 'payments');
    setting.set('displayName', 'Pasarela de Pago Activa');
    setting.set('description', 'test baseline');
    setting.set('editable', true);
    setting.set('active', true);
    setting.set('exists', true);
  }
  setting.set('value', encodeGatewayId(id));
  setting.set('valueType', 'number');
  await setting.save(null, { useMasterKey: true });
}

/**
 * @returns {Promise<number|null>} The stored toggle numeric code read straight from the DB.
 */
async function getGatewaySettingValue() {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  query.equalTo('exists', true);
  const setting = await query.first({ useMasterKey: true });
  return setting ? setting.get('value') : null;
}

/**
 * @returns {Promise<string|null>} The stored toggle valueType read straight from the DB.
 */
async function getGatewaySettingValueType() {
  const query = new Parse.Query('Setting');
  query.equalTo('key', GATEWAY_KEY);
  query.equalTo('exists', true);
  const setting = await query.first({ useMasterKey: true });
  return setting ? setting.get('valueType') : null;
}

describe('Active payment gateway endpoint (integration)', () => {
  let app;
  let adminToken;
  let superadminToken;
  let managerToken; // department_manager = level 4
  let clientToken; // client = level 5 (still below the level-6 guard)
  let employeeToken; // employee = level 3

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    adminToken = await AuthTestHelper.loginAs('admin', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
    managerToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    employeeToken = await AuthTestHelper.loginAs('employee', app);
  }, 30000);

  beforeEach(async () => {
    resetRateLimiters(app);
    await setGatewaySetting('stripe');
  });

  afterAll(async () => {
    const query = new Parse.Query('Setting');
    query.equalTo('key', GATEWAY_KEY);
    const rows = await query.find({ useMasterKey: true });
    for (const row of rows) {
      await row.destroy({ useMasterKey: true });
    }
  });

  describe('GET /api/settings/active-gateway - RBAC', () => {
    it('lets an admin read the toggle', async () => {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.gateway).toBe('stripe');
      expect(res.body.data.availableGateways.sort()).toEqual(['mexican', 'stripe']);
    });

    it('lets a superadmin read the toggle', async () => {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${superadminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('denies a department_manager (level 4)', async () => {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(403);
    });

    it('denies a client (level 5)', async () => {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${clientToken}`);
      expect(res.status).toBe(403);
    });

    it('denies an employee (level 3)', async () => {
      const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${employeeToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects a request with no token (401)', async () => {
      const res = await request(app).get(ROUTE);
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/settings/active-gateway - RBAC', () => {
    it('lets an admin update the toggle', async () => {
      const res = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gateway: 'mexican' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.gateway).toBe('mexican');
      expect(await getGatewaySettingValue()).toBe(1);
    });

    it('lets a superadmin update the toggle', async () => {
      const res = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ gateway: 'mexican' });
      expect(res.status).toBe(200);
      expect(await getGatewaySettingValue()).toBe(1);
    });

    it('denies a department_manager and leaves the setting unchanged', async () => {
      const res = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ gateway: 'mexican' });
      expect(res.status).toBe(403);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('denies a client and leaves the setting unchanged', async () => {
      const res = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ gateway: 'mexican' });
      expect(res.status).toBe(403);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('denies an employee and leaves the setting unchanged', async () => {
      const res = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ gateway: 'mexican' });
      expect(res.status).toBe(403);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects a PUT with no token (401) and leaves the setting unchanged', async () => {
      const res = await request(app).put(ROUTE).send({ gateway: 'mexican' });
      expect(res.status).toBe(401);
      expect(await getGatewaySettingValue()).toBe(0);
    });
  });

  describe('PUT /api/settings/active-gateway - malformed body (admin)', () => {
    const auth = () => `Bearer ${adminToken}`;

    it('rejects an empty body (no gateway)', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({});
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects a numeric gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 123 });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects a null gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: null });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects an object gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: {} });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects an array gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: [] });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects an empty-string gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: '' });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects a whitespace-only gateway', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: '   ' });
      expect(res.status).toBe(400);
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects an unknown gateway id with a clear message and no DB change', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 'foobar' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('foobar');
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('rejects an over-long gateway id up front and never echoes it back (length clamp)', async () => {
      const giant = 'x'.repeat(5000);
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: giant });
      expect(res.status).toBe(400);
      // The oversized payload must NOT be reflected in the error (rejected before echo).
      expect(res.body.error).not.toContain(giant);
      expect(await getGatewaySettingValue()).toBe(0);
    });
  });

  describe('PUT /api/settings/active-gateway - central case + normalization (admin)', () => {
    const auth = () => `Bearer ${adminToken}`;

    it('saves gateway "mexican" even though Openpay is unconfigured (router fallback covers it)', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 'mexican' });
      expect(res.status).toBe(200);
      expect(res.body.data.gateway).toBe('mexican');
      expect(await getGatewaySettingValue()).toBe(1);
    });

    it('normalizes "Stripe" (case) to "stripe" before saving', async () => {
      await setGatewaySetting('mexican');
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 'Stripe' });
      expect(res.status).toBe(200);
      expect(res.body.data.gateway).toBe('stripe');
      expect(await getGatewaySettingValue()).toBe(0);
    });

    it('normalizes " MEXICAN " (case + spaces) to "mexican" before saving', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: ' MEXICAN ' });
      expect(res.status).toBe(200);
      expect(res.body.data.gateway).toBe('mexican');
      expect(await getGatewaySettingValue()).toBe(1);
    });
  });

  // The read path builds a fresh SettingsService per request, so a PUT is always visible on
  // the next GET without relying on cache invalidation (there is no live cross-request cache
  // for this key). This proves the read is never served stale.
  describe('reads are fresh per request (admin)', () => {
    it('reflects a PUT on the very next GET, same tick (no stale TTL read)', async () => {
      const before = await request(app).get(ROUTE).set('Authorization', `Bearer ${adminToken}`);
      expect(before.body.data.gateway).toBe('stripe');

      const put = await request(app)
        .put(ROUTE)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gateway: 'mexican' });
      expect(put.status).toBe(200);

      const after = await request(app).get(ROUTE).set('Authorization', `Bearer ${adminToken}`);
      expect(after.body.data.gateway).toBe('mexican');
    });
  });

  // This is the exact requirement that blocked the earlier string-based design: the
  // Setting.value column is a Number in Parse, so the toggle MUST land in the DB as a
  // numeric code (0/1), while the HTTP boundary keeps speaking the string ids.
  describe('persists the toggle as a NUMBER, not a string (schema constraint)', () => {
    const auth = () => `Bearer ${adminToken}`;

    it('stores code 1 (number) for "mexican" while the API still returns the string', async () => {
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 'mexican' });
      expect(res.status).toBe(200);
      expect(res.body.data.gateway).toBe('mexican'); // API boundary: string id, never the number

      const stored = await getGatewaySettingValue();
      expect(typeof stored).toBe('number');
      expect(stored).toBe(1);
      expect(await getGatewaySettingValueType()).toBe('number');
    });

    it('stores code 0 (number) for "stripe" while the API still returns the string', async () => {
      await setGatewaySetting('mexican');
      const res = await request(app).put(ROUTE).set('Authorization', auth()).send({ gateway: 'stripe' });
      expect(res.status).toBe(200);
      expect(res.body.data.gateway).toBe('stripe');

      const stored = await getGatewaySettingValue();
      expect(typeof stored).toBe('number');
      expect(stored).toBe(0);
      expect(await getGatewaySettingValueType()).toBe('number');
    });
  });
});
