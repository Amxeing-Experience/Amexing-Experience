/**
 * Seguridad — PUT /api/quotes/:id (QuoteController.updateQuote) no debe permitir mass-assignment.
 *
 * Este es el endpoint PRIMARIO que el front usa para editar una cotización. `updates` (body crudo) se pasa
 * a versioningService.recordEdit -> applyChanges, que hace quote.set(field, value) por cada campo SIN
 * filtro, y luego a quoteService.updateQuote. Sin allowlist, un editor podía fijar dinero/estructura/
 * propiedad/estado arbitrarios (total/subtotal/iva, serviceItems, owner/client, approvalStatus, folio,
 * paymentType/currency/version/collaborators...). Ahora el controller restringe el body a un allowlist
 * EXACTO de campos descriptivos/de contacto/estado y RECHAZA (400) el request completo ante cualquier campo
 * fuera de él (no stripea en silencio).
 *
 * Además cubre el fix del bypass de RBAC de status: recordEdit ya NO fija status/approvalStatus (se quitan
 * antes de applyChanges); el único camino que persiste el status es quoteService.updateQuoteStatus, que sí
 * valida adminOnlyStatuses (hold/scheduled/rejected) contra admin/superadmin. Así un department_manager/
 * client no puede "agendar" por la puerta trasera mandando {status:'scheduled', ...campo permitido}.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('updateQuote HTTP — allowlist anti mass-assignment + fix bypass de status (integration)', () => {
  let app;
  let adminToken;
  let dmToken;
  let clientToken;
  let adminUser;
  let dmUser;
  let clientUser;
  const createdQuoteIds = [];
  const createdClientIds = [];

  // serviceItems mínimo (no schedulable): sirve para los casos que no crean reservación.
  const minimalServiceItems = () => ({
    days: [], subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
  });

  // serviceItems de 1 servicio real (schedulable) para el caso admin -> scheduled.
  const schedulableServiceItems = () => {
    const sc = buildSubconcept({ id: 'ma-sched', priceEfectivo: 2000 });
    return {
      paymentType: 'efectivo',
      currency: 'MXN',
      subtotal: 2000,
      iva: 0,
      total: 2000,
      globalTip: null,
      days: [{
        dayNumber: 1,
        dayTitle: '',
        date: '2026-08-15',
        dayTotal: sc.total,
        subconcepts: [sc],
      }],
    };
  };

  const makeQuote = async ({
    owner = dmUser, client = dmUser, status = 'quoted', serviceItems = minimalServiceItems(),
  } = {}) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', `QTE-UPDMA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('eventType', 'Evento base');
    quote.set('numberOfPeople', 2);
    quote.set('contactPerson', 'Contacto Original');
    quote.set('contactEmail', 'orig@test.local');
    quote.set('notes', 'Nota original');
    quote.set('owner', owner);
    quote.set('client', client);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    createdQuoteIds.push(quote.id);
    return quote;
  };

  const put = (quoteId, body, token = dmToken) => request(app)
    .put(`/api/quotes/${quoteId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(body);

  // Variante para payloads que deben mandarse como JSON crudo (p.ej. __proto__, que un literal JS no
  // conserva como own-key). body es un string JSON literal.
  const putRaw = (quoteId, rawJson, token = dmToken) => request(app)
    .put(`/api/quotes/${quoteId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(rawJson);

  const fetchQuote = (quoteId) => new Parse.Query('Quote').get(quoteId, { useMasterKey: true });

  // El 400 del allowlist responde un mensaje GENÉRICO (review round 3, hallazgo F): nombrar el campo
  // rechazado y listar los permitidos le entregaba al atacante el mapa exacto de campos editables. El
  // detalle (disallowedFields + quoteId + userId) se queda en el log del servidor.
  const GENERIC_REJECTION = 'Campo no editable por este endpoint.';
  const expectGenericError = (res) => expect(res.body.error).toBe(GENERIC_REJECTION);

  const reservationsFor = async (quoteId) => {
    const quotePtr = new Parse.Object('Quote');
    quotePtr.id = quoteId;
    return new Parse.Query('Reservation')
      .equalTo('quotePtr', quotePtr).equalTo('exists', true).find({ useMasterKey: true });
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    adminToken = await AuthTestHelper.loginAs('admin', app);
    dmToken = await AuthTestHelper.loginAs('department_manager', app);
    clientToken = await AuthTestHelper.loginAs('client', app);
    adminUser = await AuthTestHelper.getUserByRole('admin');
    dmUser = await AuthTestHelper.getUserByRole('department_manager');
    clientUser = await AuthTestHelper.getUserByRole('client');
  }, 30000);

  afterAll(async () => {
    for (const quoteId of createdQuoteIds) {
      try {
        const reservations = await reservationsFor(quoteId);
        for (const reservation of reservations) {
          try {
            const services = await new Parse.Query('ReservationService')
              .equalTo('reservationPtr', reservation).find({ useMasterKey: true });
            await Parse.Object.destroyAll(services, { useMasterKey: true });
          } catch (e) { /* already gone */ }
          try { await reservation.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ }
        }
      } catch (e) { /* none */ }
      try {
        const q = await fetchQuote(quoteId);
        await q.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const clientId of createdClientIds) {
      try {
        const c = await new Parse.Query('Client').get(clientId, { useMasterKey: true });
        await c.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  // -------------------------------------------------------------------------
  // No-regresión: campos legítimos se aceptan y persisten
  // -------------------------------------------------------------------------

  it('INT-01 (CRÍTICO no-regresión): department_manager dueño manda TODOS los campos legítimos juntos -> 200 y persisten', async () => {
    const quote = await makeQuote({ status: 'quoted' });
    // Todos los campos del allowlist (clientId apunta a un AmexingUser válido -> se resuelve el pointer;
    // status='requested' es transición legítima para department_manager). Si el allowlist estuviera
    // incompleto, ALGÚN campo caería fuera y el request sería 400 en vez de 200 -> este test lo detecta.
    const res = await put(quote.id, {
      clientId: dmUser.id,
      clientType: 'agency',
      eventType: 'Evento Editado',
      numberOfPeople: 3,
      numberOfAdults: 2,
      numberOfChildren: 1,
      numberOfInfants: 0,
      preferredLanguage: 'en',
      contactPerson: 'Contacto Nuevo',
      contactFirstName: 'Contacto',
      contactLastName: 'Nuevo',
      contactEmail: 'nuevo@test.local',
      contactPhone: '5550001111',
      leadGuestFirstName: 'Lead',
      leadGuestLastName: 'Guest',
      lodging: 'Hotel Editado',
      notes: 'Nota editada',
      clientFinalId: '',
      clientFinalName: 'Cliente Final Texto',
      // validUntil es Date en el esquema real (createQuote/duplicateQuote lo guardan como Date). Se envía
      // con la codificación Parse de fecha para que persista como Date y NO como String.
      validUntil: { __type: 'Date', iso: '2026-12-31T00:00:00.000Z' },
      status: 'requested',
      reason: 'INT-01 non-regression',
    });
    expect(res.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('eventType')).toBe('Evento Editado');
    expect(updated.get('preferredLanguage')).toBe('en');
    expect(updated.get('contactEmail')).toBe('nuevo@test.local');
    expect(updated.get('contactPhone')).toBe('5550001111');
    expect(updated.get('leadGuestFirstName')).toBe('Lead');
    expect(updated.get('lodging')).toBe('Hotel Editado');
    expect(updated.get('notes')).toBe('Nota editada');
    expect(updated.get('clientFinalName')).toBe('Cliente Final Texto');
    expect(updated.get('validUntil')).toBeInstanceOf(Date);
    expect(updated.get('status')).toBe('requested');
  });

  it('INT-02: edición parcial (notes + contactEmail) por department_manager -> 200 y persiste', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { notes: 'Solo notas y correo', contactEmail: 'parcial@test.local' });
    expect(res.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('notes')).toBe('Solo notas y correo');
    expect(updated.get('contactEmail')).toBe('parcial@test.local');
  });

  it('INT-03: clientFinalId con auto-relleno de contacto -> 200 y contacto tomado del cliente', async () => {
    const finalClient = new Parse.Object('Client');
    finalClient.set('exists', true);
    finalClient.set('active', true);
    finalClient.set('firstName', 'Final');
    finalClient.set('lastName', 'Cliente');
    finalClient.set('email', 'final-cliente@test.local');
    finalClient.set('phone', '5559998888');
    await finalClient.save(null, { useMasterKey: true });
    createdClientIds.push(finalClient.id);

    const quote = await makeQuote();
    const res = await put(quote.id, { clientFinalId: finalClient.id });
    expect(res.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('clientFinalId')).toBe(finalClient.id);
    // El controller auto-rellena contacto desde el Cliente Final cuando no se envía contacto explícito.
    expect(updated.get('contactEmail')).toBe('final-cliente@test.local');
  });

  it('INT-04: status-only {status:requested, reason} por department_manager -> 200 vía updateQuoteStatus', async () => {
    const quote = await makeQuote({ status: 'quoted' });
    const res = await put(quote.id, { status: 'requested', reason: 'Solicitado por agencia' });
    expect(res.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).toBe('requested');
  });

  // -------------------------------------------------------------------------
  // Seguridad: campos fuera del allowlist -> 400 y NO persisten
  // -------------------------------------------------------------------------

  it('INT-05 (hallazgo F): el 400 NO revela el allowlist ni el campo rechazado (mensaje genérico)', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { total: 1, owner: 'a'.repeat(24), folio: 'QTE-HACKED' });
    expect(res.status).toBe(400);
    expectGenericError(res);
    // Ni la lista de campos permitidos ni los nombres rechazados viajan al caller.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Campos permitidos/i);
    expect(body).not.toMatch(/contactPerson|clientFinalId|leadGuestFirstName|validUntil/);
    expect(body).not.toMatch(/folio|owner|total/);
  });

  it('INT-06: rechaza serviceItems -> 400 y no muta serviceItems', async () => {
    const quote = await makeQuote();
    const before = quote.get('serviceItems');
    const res = await put(quote.id, {
      serviceItems: {
        days: [{ dayNumber: 1, subconcepts: [{ id: 'x', total: 999999 }] }],
        subtotal: 999999, iva: 0, total: 999999, paymentType: 'tarjeta',
      },
    });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('serviceItems')).toEqual(before);
  });

  it('INT-07: rechaza total/subtotal/iva (dinero) -> 400 y no los fija', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { total: 1, subtotal: 1, iva: 1 });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('total')).toBeUndefined();
    expect(updated.get('subtotal')).toBeUndefined();
    expect(updated.get('iva')).toBeUndefined();
  });

  it('INT-08: rechaza owner (id de otro) -> 400 y no reasigna el dueño', async () => {
    const quote = await makeQuote();
    const originalOwnerId = quote.get('owner').id;
    const res = await put(quote.id, { owner: 'a'.repeat(24) });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('owner').id).toBe(originalOwnerId);
  });

  it('INT-09: rechaza approvalStatus/requireApproval -> 400', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { approvalStatus: 'approved', requireApproval: false });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('approvalStatus')).toBeUndefined();
  });

  it('INT-10: rechaza folio -> 400 y no cambia el folio', async () => {
    const quote = await makeQuote();
    const originalFolio = quote.get('folio');
    const res = await put(quote.id, { folio: 'QTE-HACKED-0001' });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('folio')).toBe(originalFolio);
  });

  it('INT-11: rechaza paymentType/currency/version/collaborators -> 400', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, {
      paymentType: 'tarjeta', currency: 'USD', version: 99, collaborators: ['x'],
    });
    expect(res.status).toBe(400);
    expectGenericError(res);
  });

  it('INT-12: rechaza client como pointer crudo -> 400 y no reasigna el cliente dueño', async () => {
    const quote = await makeQuote();
    const originalClientId = quote.get('client').id;
    const res = await put(quote.id, {
      client: { __type: 'Pointer', className: 'AmexingUser', objectId: 'b'.repeat(24) },
    });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('client').id).toBe(originalClientId);
  });

  // -------------------------------------------------------------------------
  // Fix del bypass de RBAC de status
  // -------------------------------------------------------------------------

  it('INT-13 (CRÍTICO): department_manager {status:scheduled, notes} NO agenda ni crea Reservation', async () => {
    const quote = await makeQuote({ status: 'quoted' });
    const res = await put(quote.id, { status: 'scheduled', notes: 'intento agendar' });
    expect(res.status).not.toBe(200); // rechazado (updateQuoteStatus lanza para admin-only)

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).not.toBe('scheduled');
    expect(updated.get('status')).toBe('quoted');
    const reservations = await reservationsFor(quote.id);
    expect(reservations).toHaveLength(0);
  });

  it('INT-14: client {status:hold, eventType} NO bloquea (hold es admin-only) ni crea Reservation', async () => {
    const quote = await makeQuote({ owner: clientUser, client: clientUser, status: 'quoted' });
    const res = await put(quote.id, { status: 'hold', eventType: 'intento hold' }, clientToken);
    expect(res.status).not.toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).not.toBe('hold');
    expect(updated.get('status')).toBe('quoted');
    const reservations = await reservationsFor(quote.id);
    expect(reservations).toHaveLength(0);
  });

  it('INT-15: admin {status:scheduled, notes} SÍ agenda + persiste notes (camino válido)', async () => {
    const quote = await makeQuote({
      owner: adminUser, client: adminUser, status: 'quoted', serviceItems: schedulableServiceItems(),
    });
    const res = await put(quote.id, { status: 'scheduled', notes: 'agendado por admin' }, adminToken);
    expect(res.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).toBe('scheduled');
    expect(updated.get('notes')).toBe('agendado por admin');
    const reservations = await reservationsFor(quote.id);
    expect(reservations.length).toBeGreaterThan(0);
  });

  it('INT-16: department_manager {status:rejected, reason} (status-only) sigue rechazado', async () => {
    const quote = await makeQuote({ status: 'quoted' });
    const res = await put(quote.id, { status: 'rejected', reason: 'intento rechazar' });
    expect(res.status).not.toBe(200);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).not.toBe('rejected');
    expect(updated.get('status')).toBe('quoted');
  });

  // -------------------------------------------------------------------------
  // Claves peligrosas / prototype pollution / case-sensitivity
  // -------------------------------------------------------------------------

  it('INT-17: __proto__ no contamina Object.prototype ni provoca 500', async () => {
    const quote = await makeQuote();
    const res = await putRaw(quote.id, '{"__proto__":{"polluted":"yes"}}');
    // El saneador de Mongo lava __proto__ (queda en el prototipo de un objeto local, sin own-key), así que
    // nunca llega como campo al allowlist: no hay 400, pero tampoco contaminación global ni 500.
    expect(res.status).not.toBe(500);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('INT-18: constructor (own-key) cae fuera del allowlist -> 400 sin contaminación', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { constructor: 'x' });
    expect(res.status).toBe(400);
    expectGenericError(res);
    expect({}.polluted).toBeUndefined();
  });

  it('INT-19: mayúsculas (Status) no matchea el allowlist case-sensitive -> 400', async () => {
    const quote = await makeQuote({ status: 'quoted' });
    const res = await put(quote.id, { Status: 'scheduled' });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).toBe('quoted');
  });

  it('INT-20: campo suelto no reconocido (days) -> 400', async () => {
    const quote = await makeQuote();
    const res = await put(quote.id, { days: [] });
    expect(res.status).toBe(400);
    expectGenericError(res);
  });
});
