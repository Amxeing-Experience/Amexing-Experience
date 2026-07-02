/**
 * Owned-client birthDate persistence + validation (integration).
 * Guards the fix where POST /api/owned-clients silently dropped birthDate (it wasn't in the
 * destructure/allowlist), and the past-only date validation added for it.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Owned client birthDate (integration)', () => {
  let app;
  let adminToken;
  const createdUserIds = [];

  const isoYearsFromNow = (years) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      try {
        const u = new Parse.Object('AmexingUser');
        u.id = id;
        await u.destroy({ useMasterKey: true });
      } catch (error) {
        // already gone
      }
    }
  });

  it('persists birthDate when creating a direct client (admin path → end_client)', async () => {
    const birthDate = '1990-05-20';
    const email = `bd-test-${Date.now()}@example.com`;
    const response = await request(app)
      .post('/api/owned-clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Birth', lastName: 'Date', email, birthDate, clientCategory: 'direct_client',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    const userId = response.body.data.id;
    createdUserIds.push(userId);

    // Verify it actually landed in the DB (the bug was a silent drop before the .create()).
    const user = new Parse.Object('AmexingUser');
    user.id = userId;
    await user.fetch({ useMasterKey: true });
    const stored = user.get('birthDate');
    expect(stored).toBeTruthy();
    expect(new Date(stored).toISOString().slice(0, 10)).toBe(birthDate);
  });

  it('rejects a future birthDate (past-only rule)', async () => {
    const response = await request(app)
      .post('/api/owned-clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Future', lastName: 'Birth', email: `fut-${Date.now()}@example.com`,
        birthDate: isoYearsFromNow(1), clientCategory: 'direct_client',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Fecha de nacimiento');
  });

  it('rejects a birthDate before 1900', async () => {
    const response = await request(app)
      .post('/api/owned-clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Old', lastName: 'Birth', email: `old-${Date.now()}@example.com`,
        birthDate: '1850-01-01', clientCategory: 'direct_client',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('1900');
  });

  it('creates a direct client without birthDate (optional field)', async () => {
    const response = await request(app)
      .post('/api/owned-clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'No', lastName: 'Birthday', email: `nobd-${Date.now()}@example.com`,
        clientCategory: 'direct_client',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    createdUserIds.push(response.body.data.id);
  });
});
