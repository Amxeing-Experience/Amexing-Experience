/**
 * Aislamiento entre agencias (multi-tenant) en PUT /api/quotes/:id/service-items — integration.
 *
 * VULNERABILIDAD (la más severa de la sesión): la ruta solo exigía requireRoleLevel(4) +
 * denyRoles('end_client'), sin ningún check de pertenencia. Cualquier department_manager/client
 * autenticado podía mandar el PUT directo con el quoteId de una cotización de OTRA agencia y
 * sobrescribir sus servicios/precios/propina — sin relación alguna con esa cotización.
 *
 * Fix: updateServiceItems aplica el MISMO control de acceso que la lectura (getQuoteById):
 * collaborationService.hasAccess con fallback legacy a checkQuoteAccess.
 *
 * Escenario: dos agencias (department_manager) SIN relación entre sí. La Agencia A es dueña de una
 * cotización; la Agencia B (autenticada, token válido) intenta editarla -> 403 y la cotización de A
 * queda INTACTA. Caso positivo: la Agencia A editando SU PROPIA cotización sigue en 200.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('service-items: aislamiento entre agencias (cross-tenant, integration)', () => {
  let app;
  let agencyAToken; // department_manager seeded = Agencia A (dueña de la cotización)
  let agencyAUser;
  let agencyBToken; // department_manager real pero SIN relación con la cotización = atacante
  let agencyBUser;
  const created = { quotes: [], users: [] };

  const sub = (id, priceEfectivo = 1000, extra = {}) => ({
    id,
    concept: 'Servicio',
    type: 'concepto',
    pricesByType: { efectivo: priceEfectivo, transferencia: priceEfectivo, tarjeta: priceEfectivo },
    total: priceEfectivo,
    includeInTotal: true,
    ...extra,
  });

  // Payload autoconsistente (subtotal = suma de totales, total = subtotal + iva, dayTotal cuadra):
  // pasa evaluateTotalsConsistency para que el ÚNICO gate que lo pueda frenar sea el de ownership.
  const putBody = (subs) => {
    const subtotal = subs.reduce((s, x) => s + (x.includeInTotal !== false ? x.total : 0), 0);
    return {
      days: [{
        dayNumber: 1, dayTitle: '', dayTotal: subs.reduce((s, x) => s + x.total, 0), subconcepts: subs,
      }],
      subtotal,
      iva: 0,
      total: subtotal,
      currency: 'MXN',
      paymentType: 'efectivo',
    };
  };

  const putSI = (quoteId, body, token) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  const fetchSI = async (quoteId) => {
    const q = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
    return q.get('serviceItems');
  };

  const findSub = (si, id) => {
    for (const d of (si && si.days) || []) {
      const hit = (d.subconcepts || []).find((s) => s.id === id);
      if (hit) return hit;
    }
    return null;
  };

  // Cotización propiedad de la Agencia A: client pointer = A (la agencia pasa checkQuoteAccess por su
  // client pointer), createdBy/owner = A. Ningún puntero apunta a la Agencia B.
  const makeQuoteOwnedByA = async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-XTEN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyAUser);
    quote.set('createdBy', agencyAUser);
    quote.set('owner', agencyAUser);
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: '', subconcepts: [sub('svc1', 1000)] }],
      subtotal: 1000,
      iva: 0,
      total: 1000,
      currency: 'MXN',
      paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    agencyAToken = await AuthTestHelper.loginAs('department_manager', app);
    agencyAUser = await AuthTestHelper.getUserByRole('department_manager');

    // Agencia B: usuario real, activo, con el MISMO rol (department_manager) que A pero otra identidad
    // y otra organización -> nivel 4 (pasa requireRoleLevel) pero ninguna relación con la cotización de A.
    agencyBUser = new Parse.Object('AmexingUser');
    agencyBUser.set('exists', true);
    agencyBUser.set('active', true);
    agencyBUser.set('emailVerified', true);
    agencyBUser.set('role', 'department_manager');
    agencyBUser.set('roleId', agencyAUser.get('roleId')); // misma fila Role, distinto usuario
    agencyBUser.set('organizationId', 'test-org-agencia-b');
    agencyBUser.set('email', `xtenant-agencyb-${Date.now()}@test.local`);
    agencyBUser.set('username', agencyBUser.get('email'));
    await agencyBUser.save(null, { useMasterKey: true });
    created.users.push(agencyBUser.id);

    // Token realista de la Agencia B: incluye roleId real -> validateToken resuelve un roleObject
    // department_manager (nivel 4), igual que un login normal de agencia.
    agencyBToken = jwt.sign(
      {
        userId: agencyBUser.id,
        username: agencyBUser.get('username'),
        email: agencyBUser.get('email'),
        role: 'department_manager',
        roleId: agencyAUser.get('roleId').id,
        organizationId: agencyBUser.get('organizationId'),
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const userId of created.users) {
      try {
        const u = await new Parse.Query('AmexingUser').get(userId, { useMasterKey: true });
        await u.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  it('XTEN-01: Agencia B (ajena) edita la cotización de la Agencia A -> 403, cotización de A INTACTA', async () => {
    const quote = await makeQuoteOwnedByA();

    // Payload autoconsistente que subiría svc1 de $1000 a $9999 si se persistiera.
    const res = await putSI(quote.id, putBody([sub('svc1', 9999)]), agencyBToken);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permisos/i);

    // La cotización de A no cambió: svc1 sigue en $1000 y el subtotal intacto.
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').total).toBe(1000);
    expect(si.subtotal).toBe(1000);
  });

  it('XTEN-02: Agencia A edita SU PROPIA cotización -> 200, el cambio persiste', async () => {
    const quote = await makeQuoteOwnedByA();

    const res = await putSI(quote.id, putBody([sub('svc1', 1500)]), agencyAToken);

    expect(res.status).toBe(200);

    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').total).toBe(1500);
    expect(si.subtotal).toBe(1500);
  });

  it('XTEN-03: la Agencia B tampoco puede editar una cotización de A con un id "adivinado" existente -> 403', async () => {
    // Segunda cotización de A: reproduce el barrido de ids (B conoce/adivina el quoteId y lo ataca directo).
    const quote = await makeQuoteOwnedByA();
    const before = await fetchSI(quote.id);

    const res = await putSI(quote.id, putBody([sub('svc1', 7777), sub('svc2', 3333)]), agencyBToken);

    expect(res.status).toBe(403);
    // Nada nuevo se agregó ni se alteró: svc2 nunca existió y svc1 sigue en su valor original.
    const after = await fetchSI(quote.id);
    expect(findSub(after, 'svc2')).toBeNull();
    expect(findSub(after, 'svc1').total).toBe(before.subtotal); // 1000, sin tocar
    expect(after.subtotal).toBe(1000);
  });
});
