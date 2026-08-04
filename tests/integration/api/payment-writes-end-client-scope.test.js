/**
 * Candado de seguridad: el Cliente Directo (end_client) escribe pagos SOLO en sus propias
 * reservaciones.
 *
 * Este archivo defendía lo contrario: los 4 endpoints de escritura llevaban denyRoles('end_client') y
 * respondían 403 aunque la reservación fuera suya, porque el negocio lo quería de solo lectura. Esa
 * restricción se retiró a petición del negocio: ahora registra sus propios pagos igual que agencia y
 * agente. El archivo se conserva —renombrado— porque lo que queda protegido es lo que de verdad
 * importa ahora.
 *
 * Al quitar el guard por ROL, lo único que separa a un cliente de los pagos de OTRO es el scoping de
 * propiedad, que vive en el controller (PaymentController.loadReservation aplica applyOwnershipScope y
 * devuelve 404 si la reservación no cae en su scope). Antes ese scoping era una segunda línea que
 * nunca se alcanzaba, porque el 403 del middleware disparaba primero. Ahora es la ÚNICA línea, así que
 * estos tests la ejercitan directamente sobre los cuatro verbos.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
// PNG 1x1 válido para ejercitar el endpoint de comprobante (el 403 es previo, pero el body es realista).
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Payment writes — end_client acotado por propiedad (integration)', () => {
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

  describe('end_client sobre SU PROPIA reservación: ya puede escribir', () => {
    it('POST /payments => 200', async () => {
      const r = await postPayment(ownReservation.id, endClientToken, {
        amount: 50, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
      });
      expect(r.status).toBe(200);
      if (r.body.data?.payment?.id) {
        const payPtr = new Parse.Object('Payment');
        payPtr.id = r.body.data.payment.id;
        created.payments.push(payPtr);
      }
    });

    it('PUT /payments/:paymentId => 200 y el importe queda aplicado', async () => {
      const r = await putPayment(ownReservation.id, realPaymentId, endClientToken, { amount: 200 });
      expect(r.status).toBe(200);
      const lista = await listPayments(ownReservation.id, adminToken);
      const p = (lista.body.data.payments || []).find((x) => x.id === realPaymentId);
      expect(p.amount).toBe(200);
    });

    it('GET /payments sigue en 200', async () => {
      const r = await listPayments(ownReservation.id, endClientToken);
      expect(r.status).toBe(200);
      const ids = (r.body.data.payments || []).map((p) => p.id);
      expect(ids).toContain(realPaymentId);
    });

    it('DELETE /payments/:paymentId => 200', async () => {
      const r = await delPayment(ownReservation.id, realPaymentId, endClientToken);
      expect(r.status).toBe(200);
    });
  });

  // Lo que de verdad hay que blindar ahora. Sin el guard por rol, el scoping de propiedad es lo ÚNICO
  // que impide que un cliente toque los pagos de otro; antes era una segunda línea que nunca se
  // alcanzaba porque el 403 del middleware disparaba primero.
  describe('end_client sobre una reservación AJENA: 404 por scope', () => {
    let ajena;
    let pagoAjeno;

    beforeAll(async () => {
      const otro = await makeUser({ role: 'end_client' });
      ajena = await makeReservation({ quotePtr: await makeQuote(otro) });
      const create = await postPayment(ajena.id, adminToken, {
        amount: 100, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'QA Cajero',
      });
      pagoAjeno = create.body.data.payment.id;
      const payPtr = new Parse.Object('Payment');
      payPtr.id = pagoAjeno;
      created.payments.push(payPtr);
    }, 30000);

    it('POST /payments => 404', async () => {
      const r = await postPayment(ajena.id, endClientToken, {
        amount: 50, method: 'efectivo', paidAt: new Date().toISOString(), receivedBy: 'x',
      });
      expect(r.status).toBe(404);
    });

    it('PUT /payments/:paymentId => 404', async () => {
      const r = await putPayment(ajena.id, pagoAjeno, endClientToken, { amount: 999 });
      expect(r.status).toBe(404);
    });

    it('DELETE /payments/:paymentId => 404', async () => {
      const r = await delPayment(ajena.id, pagoAjeno, endClientToken);
      expect(r.status).toBe(404);
    });

    it('POST /payments/:paymentId/receipt => 404', async () => {
      const r = await postReceipt(ajena.id, pagoAjeno, endClientToken, {
        fileBase64: TINY_PNG, fileName: 'r.png', mimeType: 'image/png',
      });
      expect(r.status).toBe(404);
    });

    it('el pago ajeno queda INTACTO tras los cuatro intentos', async () => {
      const r = await listPayments(ajena.id, adminToken);
      const p = (r.body.data.payments || []).find((x) => x.id === pagoAjeno);
      expect(p).toBeTruthy();
      expect(p.amount).toBe(100);
    });
  });

  describe('regresión: agencia (department_manager) sigue pudiendo cobrar', () => {
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
