/**
 * Filtro de ownership de agencia en GET /:id y endpoints de pago — integration (Fix 2, crítico).
 *
 * End-to-end sobre Parse + mongodb-memory-server. Verifica que una agencia/agente nivel 4+ solo
 * puede ver/operar SU propia reservación, reusando el mismo scoping del listado
 * (getRoleFilterPointers + getClientEligibleQuoteIds). Fuera de scope => 404 (mismo mensaje que el
 * recurso realmente inexistente), nunca 200 con datos ajenos ni un 403 que confirme su existencia.
 *
 * Cobertura: admin/superadmin sin filtro (regresión); agencia por departmentId (propia 200 / ajena
 * 404); agencia sin departmentId => fallback a propio clientPtr; agente por quote (propia 200 /
 * ajena 404 / compartida QuoteAccess activo 200 / expirado 404 / revocado 404); TRAMPA clientPtr del
 * agente coincide pero la quote no es suya => 404 (el agente NUNCA usa clientPtr); agente con
 * clientPtr null pero quote propia => 200; clientPtr null/huérfano sin relación => 404 sin crash;
 * los 5 endpoints de PaymentController repiten el scoping (ajena 404 en los 5, propia pasa en los 5).
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
// PNG 1x1 válido (firma 89 50 4E 47) para ejercitar el endpoint de comprobante hasta pasar el scope.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Reservation ownership scope — GET /:id + payment endpoints (integration)', () => {
  let app;
  let adminToken;
  let superadminToken;
  let deptRoleId;
  let clientRoleId;

  const created = {
    users: [], quotes: [], reservations: [], access: [], payments: [],
  };

  const roleIdByName = async (name) => {
    const r = await new Parse.Query('Role').equalTo('name', name).first({ useMasterKey: true });
    return r.id;
  };

  const makeUser = async (fields) => {
    const u = new Parse.Object('AmexingUser');
    u.set('exists', true);
    u.set('active', true);
    u.set('email', `oscope-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`);
    u.set('username', u.get('email'));
    Object.entries(fields).forEach(([k, v]) => u.set(k, v));
    await u.save(null, { useMasterKey: true });
    created.users.push(u);
    return u;
  };

  // Token para un usuario custom: role string + roleId (Role sembrado) → requireRoleLevel(4) pasa.
  const tokenFor = (user, roleName, roleId) => jwt.sign({
    userId: user.id,
    username: user.get('username'),
    email: user.get('email'),
    role: roleName,
    roleId,
    organizationId: user.get('organizationId') || null,
    iat: Math.floor(Date.now() / 1000),
  }, JWT_SECRET, { expiresIn: '8h' });

  const makeQuote = async (owner) => {
    const q = new Parse.Object('Quote');
    q.set('exists', true);
    q.set('active', true);
    if (owner) q.set('owner', owner);
    await q.save(null, { useMasterKey: true });
    created.quotes.push(q);
    return q;
  };

  const makeReservation = async ({ clientPtr = null, quotePtr = null } = {}) => {
    const r = new Parse.Object('Reservation');
    r.set('exists', true);
    r.set('active', true);
    r.set('status', 'confirmed');
    r.set('paymentType', 'efectivo');
    r.set('currency', 'MXN');
    if (clientPtr) r.set('clientPtr', clientPtr);
    if (quotePtr) r.set('quotePtr', quotePtr);
    await r.save(null, { useMasterKey: true });
    created.reservations.push(r);
    return r;
  };

  // QuoteAccess crudo (evita el console.log DEBUG del modelo). Query del scoping exige active+exists;
  // el filtro en memoria descarta revoked/expirado.
  const makeAccess = async (agent, quote, { revoked = false, expiresAt = null } = {}) => {
    const a = new Parse.Object('QuoteAccess');
    a.set('exists', true);
    a.set('active', true);
    a.set('agent', agent);
    a.set('quote', quote);
    a.set('revoked', revoked);
    if (expiresAt) a.set('expiresAt', expiresAt);
    await a.save(null, { useMasterKey: true });
    created.access.push(a);
    return a;
  };

  const getById = (id, token) => request(app)
    .get(`/api/reservations/${id}`)
    .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);
    deptRoleId = await roleIdByName('department_manager');
    clientRoleId = await roleIdByName('client');
  }, 30000);

  afterAll(async () => {
    const destroyAll = async (list) => Promise.all(list.map(async (o) => {
      try { await o.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ }
    }));
    await destroyAll(created.payments);
    await destroyAll(created.access);
    await destroyAll(created.reservations);
    await destroyAll(created.quotes);
    await destroyAll(created.users);
  });

  describe('admin / superadmin — sin filtro (regresión)', () => {
    it('admin ve cualquier reservación (sin scoping)', async () => {
      const owner = await makeUser({ role: 'department_manager', departmentId: 'oscope-A' });
      const res = await makeReservation({ clientPtr: owner });
      const r = await getById(res.id, adminToken);
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
    });

    it('superadmin NO queda excluido por accidente (200)', async () => {
      const owner = await makeUser({ role: 'department_manager', departmentId: 'oscope-A' });
      const res = await makeReservation({ clientPtr: owner });
      const r = await getById(res.id, superadminToken);
      expect(r.status).toBe(200);
    });
  });

  describe('agencia (department_manager) — scoping por departmentId', () => {
    it('con departmentId: accede a SU propia reservación (200) y da 404 a la de otra agencia', async () => {
      // Agencia A y un miembro de su departamento (clientPtr real de sus reservaciones).
      const agencyA = await makeUser({ role: 'department_manager', departmentId: 'oscope-depA' });
      const memberA = await makeUser({ role: 'end_client', departmentId: 'oscope-depA' });
      const tokenA = tokenFor(agencyA, 'department_manager', deptRoleId);
      const resA = await makeReservation({ clientPtr: memberA });

      // Agencia B (otro departamento) con su propia reservación.
      const memberB = await makeUser({ role: 'end_client', departmentId: 'oscope-depB' });
      const resB = await makeReservation({ clientPtr: memberB });

      expect((await getById(resA.id, tokenA)).status).toBe(200); // propia
      const ajena = await getById(resB.id, tokenA);
      expect(ajena.status).toBe(404); // ajena
      expect(ajena.body.error).toBe('Reservación no encontrada'); // mismo mensaje que la inexistente
    });

    it('sin departmentId: fallback a su propio clientPtr (propia 200, ajena 404)', async () => {
      const agencyNoDept = await makeUser({ role: 'department_manager' }); // sin departmentId
      const token = tokenFor(agencyNoDept, 'department_manager', deptRoleId);

      const own = await makeReservation({ clientPtr: agencyNoDept }); // clientPtr = ella misma
      const other = await makeReservation({ clientPtr: await makeUser({ role: 'end_client' }) });

      expect((await getById(own.id, token)).status).toBe(200);
      expect((await getById(other.id, token)).status).toBe(404);
    });

    it('departmentId sin OTROS usuarios (solo la agencia): sigue accediendo a lo propio, no a lo ajeno', async () => {
      const agencySolo = await makeUser({ role: 'department_manager', departmentId: 'oscope-solo' });
      const token = tokenFor(agencySolo, 'department_manager', deptRoleId);

      const own = await makeReservation({ clientPtr: agencySolo });
      const foreign = await makeReservation({ clientPtr: await makeUser({ role: 'end_client', departmentId: 'oscope-otherdept' }) });

      expect((await getById(own.id, token)).status).toBe(200);
      expect((await getById(foreign.id, token)).status).toBe(404);
    });

    it('clientPtr null (sin relación) => 404 para la agencia, sin crash', async () => {
      const agency = await makeUser({ role: 'department_manager', departmentId: 'oscope-depA' });
      const token = tokenFor(agency, 'department_manager', deptRoleId);
      const res = await makeReservation({ clientPtr: null });
      const r = await getById(res.id, token);
      expect(r.status).toBe(404);
    });

    it('clientPtr huérfano (usuario borrado) sin relación => 404 sin crash', async () => {
      const agency = await makeUser({ role: 'department_manager', departmentId: 'oscope-depA' });
      const token = tokenFor(agency, 'department_manager', deptRoleId);

      const ghost = await makeUser({ role: 'end_client', departmentId: 'oscope-ghost' });
      const ghostId = ghost.id;
      await ghost.destroy({ useMasterKey: true });
      created.users = created.users.filter((u) => u.id !== ghostId);
      const AmexingUser = Parse.Object.extend('AmexingUser');
      const res = await makeReservation({ clientPtr: AmexingUser.createWithoutData(ghostId) });

      const r = await getById(res.id, token);
      expect(r.status).toBe(404);
    });
  });

  describe('agente (client) — scoping por ownership/colaboración de la quote (NUNCA por clientPtr)', () => {
    it('quote propia => 200; quote ajena sin compartir => 404', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const other = await makeUser({ role: 'client' });

      const mine = await makeReservation({ quotePtr: await makeQuote(agent) });
      const theirs = await makeReservation({ quotePtr: await makeQuote(other) });

      expect((await getById(mine.id, token)).status).toBe(200);
      expect((await getById(theirs.id, token)).status).toBe(404);
    });

    it('quote compartida vía QuoteAccess ACTIVO => 200', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const owner = await makeUser({ role: 'client' });

      const sharedQuote = await makeQuote(owner);
      await makeAccess(agent, sharedQuote, { revoked: false, expiresAt: new Date(Date.now() + 86400000) });
      const res = await makeReservation({ quotePtr: sharedQuote });

      expect((await getById(res.id, token)).status).toBe(200);
    });

    it('QuoteAccess EXPIRADO => 404', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const owner = await makeUser({ role: 'client' });

      const q = await makeQuote(owner);
      await makeAccess(agent, q, { revoked: false, expiresAt: new Date(Date.now() - 86400000) });
      const res = await makeReservation({ quotePtr: q });

      expect((await getById(res.id, token)).status).toBe(404);
    });

    it('QuoteAccess REVOCADO => 404', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const owner = await makeUser({ role: 'client' });

      const q = await makeQuote(owner);
      await makeAccess(agent, q, { revoked: true });
      const res = await makeReservation({ quotePtr: q });

      expect((await getById(res.id, token)).status).toBe(404);
    });

    it('TRAMPA: clientPtr de la reservación coincide con el agente pero la quote NO es suya => 404', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const other = await makeUser({ role: 'client' });

      // clientPtr = el propio agente (coincidencia), quotePtr = quote de OTRO. El agente jamás usa
      // clientPtr para su scoping, así que esto DEBE dar 404 pese al clientPtr coincidente.
      const trap = await makeReservation({ clientPtr: agent, quotePtr: await makeQuote(other) });
      expect((await getById(trap.id, token)).status).toBe(404);
    });

    it('agente con clientPtr null pero quote propia => 200 (accede vía quote)', async () => {
      const agent = await makeUser({ role: 'client' });
      const token = tokenFor(agent, 'client', clientRoleId);
      const res = await makeReservation({ clientPtr: null, quotePtr: await makeQuote(agent) });
      expect((await getById(res.id, token)).status).toBe(200);
    });
  });

  describe('PaymentController — los 5 endpoints repiten el mismo scoping', () => {
    let agencyA;
    let tokenA;
    let agencyB;
    let tokenB;
    let resOwned;

    const postPayment = (id, token, body) => request(app)
      .post(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`).send(body);
    const listPayments = (id, token) => request(app)
      .get(`/api/reservations/${id}/payments`).set('Authorization', `Bearer ${token}`);
    const putPayment = (id, pid, token, body) => request(app)
      .put(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${token}`).send(body);
    const delPayment = (id, pid, token) => request(app)
      .delete(`/api/reservations/${id}/payments/${pid}`).set('Authorization', `Bearer ${token}`);
    const postReceipt = (id, pid, token, body) => request(app)
      .post(`/api/reservations/${id}/payments/${pid}/receipt`).set('Authorization', `Bearer ${token}`).send(body);

    beforeAll(async () => {
      agencyA = await makeUser({ role: 'department_manager', departmentId: 'oscope-pay-A' });
      tokenA = tokenFor(agencyA, 'department_manager', deptRoleId);
      const memberA = await makeUser({ role: 'end_client', departmentId: 'oscope-pay-A' });
      resOwned = await makeReservation({ clientPtr: memberA });

      agencyB = await makeUser({ role: 'department_manager', departmentId: 'oscope-pay-B' });
      tokenB = tokenFor(agencyB, 'department_manager', deptRoleId);
    });

    it('agencia AJENA (otro departamento) => 404 en los 5 endpoints', async () => {
      // Un pago real creado por la dueña, para que el 404 ajeno no sea por "pago inexistente".
      const create = await postPayment(resOwned.id, tokenA, {
        amount: 100, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
      });
      expect(create.status).toBe(200);
      const pid = create.body.data.payment.id;
      const payPtr = new Parse.Object('Payment');
      payPtr.id = pid;
      created.payments.push(payPtr);

      expect((await postPayment(resOwned.id, tokenB, { amount: 50, method: 'efectivo' })).status).toBe(404);
      expect((await listPayments(resOwned.id, tokenB)).status).toBe(404);
      expect((await putPayment(resOwned.id, pid, tokenB, { amount: 200 })).status).toBe(404);
      expect((await postReceipt(resOwned.id, pid, tokenB, { fileBase64: TINY_PNG, fileName: 'r.png', mimeType: 'image/png' })).status).toBe(404);
      expect((await delPayment(resOwned.id, pid, tokenB)).status).toBe(404);
    });

    it('agencia DUEÑA => pasa el scope en los 5 (create/get/update/delete 200; receipt no-404)', async () => {
      const create = await postPayment(resOwned.id, tokenA, {
        amount: 300, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
      });
      expect(create.status).toBe(200);
      const pid = create.body.data.payment.id;

      expect((await listPayments(resOwned.id, tokenA)).status).toBe(200);
      expect((await putPayment(resOwned.id, pid, tokenA, { amount: 400 })).status).toBe(200);

      // El comprobante requiere S3 real; sin credenciales devuelve 502. Lo que importa aquí es que la
      // dueña PASA el scope de ownership (nunca 404), a diferencia de la agencia ajena.
      const receipt = await postReceipt(resOwned.id, pid, tokenA, { fileBase64: TINY_PNG, fileName: 'r.png', mimeType: 'image/png' });
      expect(receipt.status).not.toBe(404);
      expect(receipt.status).not.toBe(403);

      expect((await delPayment(resOwned.id, pid, tokenA)).status).toBe(200);
    });
  });
});
