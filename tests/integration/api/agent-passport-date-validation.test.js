/**
 * Agent Passport Date Validation - Integration Tests
 *
 * Covers the fix to ClientProfileController.updatePassport: date validation now runs on PUT,
 * merging incoming body fields with the currently-stored dateOfIssue/expirationDate so the
 * cross-field "expiration after issue" rule still holds when only one date is edited.
 *
 * @author Amexing Development Team
 * @version 1.0.0
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

// ISO (YYYY-MM-DD) date `yearOffset` years from today, so the fixture never rots.
function isoDateYearsFromNow(yearOffset) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearOffset);
  return d.toISOString().slice(0, 10);
}

describe('Agent Passport Date Validation (PUT /api/agents/:agentId/passports/:id)', () => {
  let app;
  let adminToken;
  let testAgent;
  let passportId;

  const validDateOfIssue = isoDateYearsFromNow(-5);
  const validExpirationDate = isoDateYearsFromNow(3);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    adminToken = await AuthTestHelper.loginAs('admin', app);

    testAgent = new Parse.Object('AmexingUser');
    testAgent.set('username', `test-passport-agent-${Date.now()}@amexing.test`);
    testAgent.set('email', `test-passport-agent-${Date.now()}@amexing.test`);
    testAgent.set('password', 'TestPass123!');
    testAgent.set('firstName', 'Passport');
    testAgent.set('lastName', 'Test');
    testAgent.set('role', 'employee_amexing');
    testAgent.set('active', true);
    testAgent.set('exists', true);
    await testAgent.save(null, { useMasterKey: true });

    const createResponse = await request(app)
      .post(`/api/agents/${testAgent.id}/passports`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Primary',
        countryOfIssue: 'MX',
        nationality: 'MX',
        dateOfIssue: validDateOfIssue,
        expirationDate: validExpirationDate,
      });

    expect(createResponse.status).toBe(201);
    passportId = createResponse.body.data.passport.id;
  }, 30000);

  afterAll(async () => {
    try {
      const query = new Parse.Query('ClientPassport');
      const rows = await query.find({ useMasterKey: true });
      await Promise.all(
        rows
          .filter((row) => row.getOwnerId?.() === testAgent.id || row.get('ownerUser')?.id === testAgent.id)
          .map((row) => row.destroy({ useMasterKey: true }))
      );
    } catch (error) {
      // Best-effort cleanup
    }
    try {
      if (testAgent) await testAgent.destroy({ useMasterKey: true });
    } catch (error) {
      // Agent might already be gone
    }
  });

  it('rejects a future dateOfIssue, falling back to the stored (valid) expirationDate', async () => {
    const futureDateOfIssue = isoDateYearsFromNow(1);

    const response = await request(app)
      .put(`/api/agents/${testAgent.id}/passports/${passportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dateOfIssue: futureDateOfIssue });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toEqual(expect.stringContaining('no puede ser una fecha futura'));
  });

  it('rejects an expirationDate before the stored dateOfIssue, even when dateOfIssue is omitted', async () => {
    // dateOfIssue is not sent, so it falls back to the stored validDateOfIssue (5 years ago) —
    // this expirationDate is before that, so the cross-field check must trip on the merged value.
    const expirationBeforeStoredIssue = isoDateYearsFromNow(-6);

    const response = await request(app)
      .put(`/api/agents/${testAgent.id}/passports/${passportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expirationDate: expirationBeforeStoredIssue });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toEqual(expect.stringContaining('posterior a la de emisión'));
  });

  it('accepts a new expirationDate that is still after the stored dateOfIssue', async () => {
    const newExpirationDate = isoDateYearsFromNow(4);

    const response = await request(app)
      .put(`/api/agents/${testAgent.id}/passports/${passportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expirationDate: newExpirationDate });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.passport.expirationDate).toEqual(
      expect.stringContaining(newExpirationDate)
    );
    // dateOfIssue must be untouched by this partial update.
    expect(response.body.data.passport.dateOfIssue).toEqual(
      expect.stringContaining(validDateOfIssue)
    );
  });

  it('accepts a non-date field update with no date errors, re-validating the unchanged stored dates', async () => {
    const response = await request(app)
      .put(`/api/agents/${testAgent.id}/passports/${passportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Updated label' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.passport.label).toBe('Updated label');
  });

  it('rejects a dateOfIssue before 1900, mentioning 1900 in the error', async () => {
    const response = await request(app)
      .put(`/api/agents/${testAgent.id}/passports/${passportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dateOfIssue: '1850-01-01' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toEqual(expect.stringContaining('1900'));
  });
});
