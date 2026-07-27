/**
 * Candado de seguridad: los 4 endpoints de ESCRITURA de pagos niegan al Cliente Directo (end_client)
 * con 403, aunque su reservación sea SUYA. Complementa reservation-ownership-scope.test.js (que cubre
 * el scoping de ownership 404) cerrando el hueco por ROL: end_client alcanza requireRoleLevel(4) vía
 * el mapa de fallback de requireRoleLevel (roleObject null — no hay Role sembrado para él, solo puede
 * LEER lo suyo), así que sin denyRoles('end_client') un endpoint de escritura que solo pida nivel 4
 * coincidía sin querer con él. denyRoles corre DESPUÉS de requireRoleLevel y responde 403
 * 'Insufficient permissions'.
 *
 * Estructura del candado: el 403 se dispara en el MIDDLEWARE, antes del scoping de ownership del
 * controller, por lo que se usa la reservación PROPIA del end_client — el único motivo de rechazo
 * posible es el rol (nunca un 404 de scope). La prueba lo comprueba de dos formas:
 *   1. body.error === 'Insufficient permissions' (denyRoles), NO 'Insufficient role level'
 *      (requireRoleLevel) NI 'Reservación no encontrada' (ownership 404).
 *   2. GET /payments sobre la MISMA reservación propia SÍ da 200 — prueba que el nivel del end_client
 *      alcanza requireRoleLevel(4) y que lo único que frena las escrituras es denyRoles.
 * Contraste de regresión (mismo archivo): department_manager (agencia) sobre SU reservación sigue en
 * 200 — denyRoles solo excluye a end_client, no a los demás roles nivel 4+.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
// PNG 1x1 válido para ejercitar el endpoint de comprobante (el 403 es previo, pero el body es realista).
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Payment writes — end_client denegado por rol (integration)', () => {
  let app;
  let adminToken;
  let deptRoleId;

  const created = {
    users: [], quotes: [], reservations: [], payments: [],
  };

  const roleIdByName = async (name) => {
    const r = await new Parse.Query('Role').equalTo('name', name).first({ useMasterKey: true });
    return r.id;
  };

  const makeUser = async (fields) => {
    const u = new Parse.Object('AmexingUser');
    u.set('exists', true);
    u.set('active', true);
    u.set('email', `deny-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`);
    u.set('username', u.get('email'));
    Object.entries(fields).forEach(([k, v]) => u.set(k, v));
    await u.save(null, { useMasterKey: true });
    created.users.push(u);
    return u;
  };

  // Token custom. roleId opcional: para end_client se deja NULL a propósito → req.roleObject queda
  // null → requireRoleLevel(4) cae al mapa de fallback (end_client=4). Reproduce el caso real que el
  // fix defiende. Para agencia sí se pasa un roleId real (nivel desde el Role sembrado).
  const tokenFor = (user, roleName, roleId = null) => jwt.sign({
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

  // end_client dueño de la reservación (por propiedad de la quote, igual que un agente) + un pago real
  // creado por admin, para que PUT/DELETE/receipt apunten a algo existente.
  let endClientToken;
  let ownReservation;
  let realPaymentId;

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    deptRoleId = await roleIdByName('department_manager');

    // Admin crafteado con tokenFor + roleId real (mismo patrón que los demás tokens de esta suite),
    // NO vía loginAs('admin'): el endpoint HTTP /auth/login hace un fetch externo que no aplica al
    // scope de este candado (que es puro RBAC de middleware). El roleObject del Role 'admin' sembrado
    // da nivel 6, así que pasa requireRoleLevel(4) y no lo toca denyRoles.
    const adminRoleId = await roleIdByName('admin');
    const adminUser = await makeUser({ role: 'admin' });
    adminToken = tokenFor(adminUser, 'admin', adminRoleId);

    const endClient = await makeUser({ role: 'end_client' });
    endClientToken = tokenFor(endClient, 'end_client', null); // roleId null → fallback map nivel 4
    ownReservation = await makeReservation({ quotePtr: await makeQuote(endClient) });

    // Pago real registrado por admin (admin no tiene scope, alcanza cualquier reservación).
    const create = await postPayment(ownReservation.id, adminToken, {
      amount: 100, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
    });
    expect(create.status).toBe(200);
    realPaymentId = create.body.data.payment.id;
    const payPtr = new Parse.Object('Payment');
    payPtr.id = realPaymentId;
    created.payments.push(payPtr);
  }, 30000);

  afterAll(async () => {
    const destroyAll = async (list) => Promise.all(list.map(async (o) => {
      try { await o.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ }
    }));
    await destroyAll(created.payments);
    await destroyAll(created.reservations);
    await destroyAll(created.quotes);
    await destroyAll(created.users);
  });

  describe('end_client sobre SU PROPIA reservación', () => {
    it('POST /payments => 403 por rol (denyRoles), no por scope', async () => {
      const r = await postPayment(ownReservation.id, endClientToken, {
        amount: 50, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'x',
      });
      expect(r.status).toBe(403);
      // 'Insufficient permissions' = denyRoles; NO 'Insufficient role level' (sí alcanza el nivel) ni
      // 'Reservación no encontrada' (la reservación es suya).
      expect(r.body.error).toBe('Insufficient permissions');
    });

    it('PUT /payments/:paymentId (pago real existente) => 403', async () => {
      const r = await putPayment(ownReservation.id, realPaymentId, endClientToken, { amount: 200 });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('Insufficient permissions');
    });

    it('DELETE /payments/:paymentId => 403', async () => {
      const r = await delPayment(ownReservation.id, realPaymentId, endClientToken);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('Insufficient permissions');
    });

    it('POST /payments/:paymentId/receipt => 403', async () => {
      const r = await postReceipt(ownReservation.id, realPaymentId, endClientToken, {
        fileBase64: TINY_PNG, fileName: 'r.png', mimeType: 'image/png',
      });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('Insufficient permissions');
    });

    it('GET /payments SIGUE en 200 (lectura de su propio historial es intencional)', async () => {
      const r = await listPayments(ownReservation.id, endClientToken);
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      // El pago real registrado por admin aparece en su historial de solo lectura.
      const ids = (r.body.data.payments || []).map((p) => p.id);
      expect(ids).toContain(realPaymentId);
    });

    it('el pago real sigue intacto tras los intentos de escritura (denyRoles bloquea antes del controller)', async () => {
      // DELETE/PUT nunca corrieron en el controller, así que el pago no se tocó.
      const r = await listPayments(ownReservation.id, adminToken);
      expect(r.status).toBe(200);
      const p = (r.body.data.payments || []).find((x) => x.id === realPaymentId);
      expect(p).toBeTruthy();
      expect(p.amount).toBe(100); // el PUT a 200 del end_client nunca aplicó
    });
  });

  describe('regresión: agencia (department_manager) NO queda bloqueada por denyRoles', () => {
    it('POST /payments sobre SU reservación => 200', async () => {
      const agency = await makeUser({ role: 'department_manager', departmentId: 'deny-agency-A' });
      const member = await makeUser({ role: 'end_client', departmentId: 'deny-agency-A' });
      const agencyToken = tokenFor(agency, 'department_manager', deptRoleId);
      const agencyRes = await makeReservation({ clientPtr: member });

      const r = await postPayment(agencyRes.id, agencyToken, {
        amount: 100, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
      });
      expect(r.status).toBe(200);
      if (r.body.data?.payment?.id) {
        const payPtr = new Parse.Object('Payment');
        payPtr.id = r.body.data.payment.id;
        created.payments.push(payPtr);
      }
    });
  });
});
