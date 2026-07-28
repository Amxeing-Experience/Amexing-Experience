/**
 * Categoría A — default del método de pago 'efectivo' -> 'tarjeta' en el ÚNICO punto de escritura de
 * serviceItems.paymentType desde un request: PUT /api/quotes/:id/service-items (updateServiceItems).
 *
 * El default de JS SOLO aplica cuando el request OMITE la clave (JSON.stringify elimina `undefined`,
 * reproduciendo fielmente "el campo nunca llegó"). Un null/''/valor inválido NO lo reemplaza el default
 * y lo sigue rechazando el guard Payment.isValidMethod (400). El fallback de LECTURA de datos legacy
 * (paymentType null/ausente -> efectivo) queda intacto: sólo se escribe 'tarjeta' cuando el request lo
 * omite en ESTE endpoint; nunca al leer ni al promover un borrador viejo a reservación.
 *
 * DINERO: la tier tarjeta (1080) vs efectivo (1000) es el corazón del cambio. evaluateTotalsConsistency
 * compara sc.total contra pricesByType[paymentType]; con el default 'tarjeta', un payload consistente
 * con la tier tarjeta pasa y persiste, y uno con la tier efectivo (pero sin método explícito) se rechaza
 * -- por eso estos tests se romperían si alguien revierte el default a 'efectivo'.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('service-items: default de paymentType tarjeta (Categoría A, integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  let dmToken;
  let dmUser;
  let agentToken;
  let agentUser;
  let endClientToken;
  let sampleQuoteId; // cualquier quote para las pruebas RBAC (denyRoles corre antes del controller)
  const created = {
    quotes: [], users: [], roles: [], reservations: [],
  };

  // Tiers de ejemplo: tarjeta = efectivo * 1.08. La diferencia (80) supera la tolerancia de $1 del
  // guard de consistencia, así que un total de una tier no cuadra bajo el paymentType de otra.
  const PRICES = { efectivo: 1000, transferencia: 1040, tarjeta: 1080 };

  const sub = (id, total, extra = {}) => ({
    id,
    concept: 'Servicio',
    type: 'concepto',
    pricesByType: { ...PRICES },
    total,
    includeInTotal: true,
    ...extra,
  });

  // Body autoconsistente (subtotal = suma de totales, total = subtotal + iva, dayTotal cuadra). NO
  // incluye paymentType: cada test decide si lo omite (default) o lo manda explícito vía `extra`.
  const putBody = (subs, extra = {}) => {
    const subtotal = subs.reduce((s, x) => s + (x.includeInTotal !== false ? x.total : 0), 0);
    return {
      days: [{
        dayNumber: 1, dayTitle: '', dayTotal: subs.reduce((s, x) => s + x.total, 0), subconcepts: subs,
      }],
      subtotal,
      iva: 0,
      total: subtotal,
      currency: 'MXN',
      ...extra,
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

  // Crea una Quote seed. `owner`/`createdBy`/`client` se fijan al usuario dado para que agencia/agente
  // pasen el control de acceso (mismo mecanismo que getQuoteById: checkQuoteAccess por owner/createdBy).
  const makeQuote = async ({
    status = 'draft', ownerUser = null, serviceItems = { days: [], subtotal: 0, iva: 0, total: 0, currency: 'MXN' },
  } = {}) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', `QTE-PAYDEF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    if (ownerUser) {
      quote.set('client', ownerUser);
      quote.set('createdBy', ownerUser);
      quote.set('owner', ownerUser);
    }
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const findReservationForQuote = async (quote) => new Parse.Query('Reservation')
    .equalTo('quotePtr', quote)
    .equalTo('exists', true)
    .first({ useMasterKey: true });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    adminToken = await AuthTestHelper.loginAs('admin', app);
    adminUser = await AuthTestHelper.getUserByRole('admin');
    dmToken = await AuthTestHelper.loginAs('department_manager', app);
    dmUser = await AuthTestHelper.getUserByRole('department_manager');
    agentToken = await AuthTestHelper.loginAs('client', app);
    agentUser = await AuthTestHelper.getUserByRole('client');

    // Cliente Directo (end_client): no está en el seeder. Se crea (o reutiliza) la fila Role nivel 4 y un
    // usuario con ella, y se firma un token realista (roleId real -> roleObject nivel 4 pasa
    // requireRoleLevel(4), pero denyRoles('end_client') lo debe cerrar).
    let endClientRole = await new Parse.Query('Role').equalTo('name', 'end_client').first({ useMasterKey: true });
    if (!endClientRole) {
      endClientRole = new Parse.Object('Role');
      endClientRole.set('name', 'end_client');
      endClientRole.set('displayName', 'Cliente Directo');
      endClientRole.set('description', 'Direct end client (person)');
      endClientRole.set('level', 4);
      endClientRole.set('isSystemRole', true);
      endClientRole.set('active', true);
      endClientRole.set('exists', true);
      await endClientRole.save(null, { useMasterKey: true });
      created.roles.push(endClientRole.id); // sólo se destruye si LO creó este test
    }

    const endClientUser = new Parse.Object('AmexingUser');
    endClientUser.set('exists', true);
    endClientUser.set('active', true);
    endClientUser.set('emailVerified', true);
    endClientUser.set('role', 'end_client');
    endClientUser.set('roleId', endClientRole);
    endClientUser.set('organizationId', 'test-org-endclient');
    endClientUser.set('email', `paydef-endclient-${Date.now()}@test.local`);
    endClientUser.set('username', endClientUser.get('email'));
    await endClientUser.save(null, { useMasterKey: true });
    created.users.push(endClientUser.id);

    endClientToken = jwt.sign(
      {
        userId: endClientUser.id,
        username: endClientUser.get('username'),
        email: endClientUser.get('email'),
        role: 'end_client',
        roleId: endClientRole.id,
        organizationId: endClientUser.get('organizationId'),
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );

    const sampleQuote = await makeQuote({ ownerUser: adminUser });
    sampleQuoteId = sampleQuote.id;
  }, 30000);

  afterAll(async () => {
    // Reservaciones (por quotePtr) + sus ReservationService, antes de borrar las quotes.
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        const reservations = await new Parse.Query('Reservation')
          .equalTo('quotePtr', quote).find({ useMasterKey: true });
        for (const reservation of reservations) {
          const services = await new Parse.Query('ReservationService')
            .equalTo('reservationPtr', reservation).find({ useMasterKey: true });
          for (const svc of services) {
            await svc.destroy({ useMasterKey: true }).catch(() => {});
          }
          await reservation.destroy({ useMasterKey: true }).catch(() => {});
        }
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const userId of created.users) {
      try {
        const u = await new Parse.Query('AmexingUser').get(userId, { useMasterKey: true });
        await u.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const roleId of created.roles) {
      try {
        const r = await new Parse.Query('Role').get(roleId, { useMasterKey: true });
        await r.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  // ---- Default aplicado (DINERO) ----

  it('INT-1: PUT sin paymentType -> persiste tarjeta (no null, no efectivo); GET lo confirma', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });

    // paymentType: undefined -> JSON.stringify lo elimina -> el campo nunca llega -> aplica el default.
    const res = await putSI(quote.id, { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined }, adminToken);
    expect(res.status).toBe(200);

    const si = await fetchSI(quote.id);
    expect(si.paymentType).toBe('tarjeta');

    const getRes = await request(app)
      .get(`/api/quotes/${quote.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.serviceItems.paymentType).toBe('tarjeta');
  });

  it('INT-2: sin paymentType, total de la tier tarjeta (1080) -> persiste la tier tarjeta, no efectivo', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });

    const res = await putSI(quote.id, { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined }, adminToken);
    expect(res.status).toBe(200); // evaluateTotalsConsistency NO rechaza (base = tier tarjeta)

    const si = await fetchSI(quote.id);
    expect(si.paymentType).toBe('tarjeta');
    expect(si.subtotal).toBe(PRICES.tarjeta); // 1080, la tier tarjeta — NO 1000 (efectivo)
    expect(si.total).toBe(PRICES.tarjeta);
  });

  it('INT-2b (adversarial DINERO): sin paymentType, total de la tier efectivo (1000) -> 400, no persiste', async () => {
    // Con el default 'tarjeta', el guard de consistencia espera 1080; un total de 1000 diverge $80 (> $1)
    // -> rechazo. Este 400 es EXACTAMENTE lo que prueba que el default cambió: bajo 'efectivo' pasaría.
    const quote = await makeQuote({ ownerUser: adminUser });

    const res = await putSI(quote.id, { ...putBody([sub('svc1', PRICES.efectivo)]), paymentType: undefined }, adminToken);
    expect(res.status).toBe(400);

    const si = await fetchSI(quote.id);
    expect(si.days).toEqual([]); // nada se persistió
  });

  // ---- Método explícito respetado (no se pisa con tarjeta) ----

  it('INT-3: paymentType explícito efectivo -> se respeta', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });
    const res = await putSI(quote.id, putBody([sub('svc1', PRICES.efectivo)], { paymentType: 'efectivo' }), adminToken);
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).paymentType).toBe('efectivo');
  });

  it('INT-4: paymentType explícito transferencia -> se respeta', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });
    const res = await putSI(quote.id, putBody([sub('svc1', PRICES.transferencia)], { paymentType: 'transferencia' }), adminToken);
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).paymentType).toBe('transferencia');
  });

  // ---- No-regresión del guard: el default de JS NO reemplaza null/''/inválido ----

  it('INT-5: paymentType null -> 400 Forma de pago inválida (el default no reemplaza null)', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });
    const res = await putSI(quote.id, putBody([sub('svc1', PRICES.tarjeta)], { paymentType: null }), adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Forma de pago inválida/i);
  });

  it('INT-6: paymentType "" -> 400 Forma de pago inválida', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });
    const res = await putSI(quote.id, putBody([sub('svc1', PRICES.tarjeta)], { paymentType: '' }), adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Forma de pago inválida/i);
  });

  it('INT-7: paymentType "EFECTIVO" (mayúsculas) -> 400 (match exacto, sin normalizar)', async () => {
    const quote = await makeQuote({ ownerUser: adminUser });
    const res = await putSI(quote.id, putBody([sub('svc1', PRICES.tarjeta)], { paymentType: 'EFECTIVO' }), adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Forma de pago inválida/i);
  });

  // ---- No-regresión CRÍTICA del fallback de LECTURA de datos legacy ----

  it('INT-8: borrador legacy (paymentType=null sembrado directo) -> al LEERLO sigue null, no se reescribe a tarjeta', async () => {
    const quote = await makeQuote({
      ownerUser: adminUser,
      serviceItems: {
        days: [{ dayNumber: 1, dayTitle: '', subconcepts: [sub('svcLegacy', PRICES.efectivo)] }],
        subtotal: PRICES.efectivo, iva: 0, total: PRICES.efectivo, currency: 'MXN', paymentType: null,
      },
    });

    const getRes = await request(app)
      .get(`/api/quotes/${quote.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    // La lectura NO aplica el default nuevo: el dato legacy conserva su paymentType null (el fallback de
    // lectura lo trata como efectivo aguas abajo). El default 'tarjeta' es exclusivo de la ESCRITURA.
    expect(getRes.body.data.serviceItems.paymentType).toBeNull();
    // Y en BD tampoco fue mutado por la lectura.
    expect((await fetchSI(quote.id)).paymentType).toBeNull();
  });

  // ---- Herencia a reservación (DINERO) ----

  it('INT-11: cotización nueva (default tarjeta) -> reservación nueva hereda paymentType tarjeta', async () => {
    const quote = await makeQuote({ status: 'requested', ownerUser: adminUser });

    const putRes = await putSI(
      quote.id,
      { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined },
      adminToken
    );
    expect(putRes.status).toBe(200);
    expect((await fetchSI(quote.id)).paymentType).toBe('tarjeta');

    const convRes = await request(app)
      .post(`/api/quotes/${quote.id}/convert-to-reservation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(convRes.status).toBe(200);

    const reservation = await findReservationForQuote(quote);
    expect(reservation).toBeTruthy();
    expect(reservation.get('paymentType')).toBe('tarjeta');
  });

  it('INT-12 (blindaje): borrador legacy (paymentType=null) promovido a reservación -> paymentType efectivo (fallback intacto)', async () => {
    // Borrador legacy sembrado directo (paymentType=null, con día/subconcepto), status requested para que
    // convert-to-reservation llame createReservationFromQuote. El fallback de QuoteService debe anclar la
    // reservación en 'efectivo'. Si alguien cambia ese fallback por error, este test se rompe.
    const quote = await makeQuote({
      status: 'requested',
      ownerUser: adminUser,
      serviceItems: {
        days: [{ dayNumber: 1, dayTitle: '', subconcepts: [sub('svcLegacy', PRICES.efectivo)] }],
        subtotal: PRICES.efectivo, iva: 0, total: PRICES.efectivo, currency: 'MXN', paymentType: null,
      },
    });

    const convRes = await request(app)
      .post(`/api/quotes/${quote.id}/convert-to-reservation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(convRes.status).toBe(200);

    const reservation = await findReservationForQuote(quote);
    expect(reservation).toBeTruthy();
    expect(reservation.get('paymentType')).toBe('efectivo');
  });

  // ---- RBAC: el default aplica igual para agencia y agente; end_client bloqueado ----

  it('INT-13: agencia (department_manager, nivel 4) sin paymentType -> persiste tarjeta', async () => {
    const quote = await makeQuote({ ownerUser: dmUser });
    const res = await putSI(quote.id, { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined }, dmToken);
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).paymentType).toBe('tarjeta');
  });

  it('INT-14: agente (client, nivel 5) sin paymentType -> persiste tarjeta', async () => {
    const quote = await makeQuote({ ownerUser: agentUser });
    const res = await putSI(quote.id, { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined }, agentToken);
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).paymentType).toBe('tarjeta');
  });

  it('INT-15: end_client -> 403 en PUT service-items (denyRoles), pese a alcanzar nivel 4', async () => {
    const res = await putSI(
      sampleQuoteId,
      { ...putBody([sub('svc1', PRICES.tarjeta)]), paymentType: undefined },
      endClientToken
    );
    expect(res.status).toBe(403);
  });
});
