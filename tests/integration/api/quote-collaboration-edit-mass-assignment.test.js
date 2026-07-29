/**
 * Seguridad — POST /api/quotes/:quoteId/edits (QuoteCollaborationController.recordEdit) no debe permitir
 * mass-assignment de campos arbitrarios.
 *
 * El servicio aplica quote.set(field, value) por cada campo de `changes`. Sin filtro, un usuario con
 * permiso de edición podía fijar dinero/estructura/propiedad/estado (total, serviceItems, owner, status,
 * approvalStatus, ...). El controller HTTP ahora restringe `changes` a un allowlist conservador de campos
 * descriptivos/de contacto (contactPerson, contactEmail, contactPhone, notes, eventType) y RECHAZA (400) el
 * request completo si trae cualquier campo fuera de él.
 *
 * Además se confirma que el camino interno NO se rompió: PUT /:id/service-items (endpoint dedicado y
 * validado) sigue persistiendo serviceItems; ese path llama al servicio recordEdit directamente, no al
 * controller HTTP, así que el allowlist no lo afecta.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('recordEdit HTTP — allowlist anti mass-assignment (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const createdQuoteIds = [];

  // Tiers de ejemplo para el PUT de service-items (el guard de consistencia compara total vs
  // pricesByType[paymentType]). Reutiliza el patrón de quote-service-items-payment-default.
  const PRICES = { efectivo: 1000, transferencia: 1040, tarjeta: 1080 };

  const makeQuote = async (extra = {}) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-MASSASSIGN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('eventType', 'Evento base');
    quote.set('numberOfPeople', 2);
    quote.set('contactPerson', 'Contacto Original');
    quote.set('notes', 'Nota original');
    // owner/createdBy = admin: pasa checkQuoteAccess/canEdit y auto-approve (requireApproval no está en true)
    quote.set('owner', adminUser);
    quote.set('createdBy', adminUser);
    quote.set('serviceItems', {
      days: [], subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
    });
    Object.entries(extra).forEach(([k, v]) => quote.set(k, v));
    await quote.save(null, { useMasterKey: true });
    createdQuoteIds.push(quote.id);
    return quote;
  };

  const postEdit = (quoteId, changes, token = adminToken) => request(app)
    .post(`/api/quotes/${quoteId}/edits`)
    .set('Authorization', `Bearer ${token}`)
    .send({ changes, description: 'test edit' });

  const fetchQuote = (quoteId) => new Parse.Query('Quote').get(quoteId, { useMasterKey: true });

  // El 400 del allowlist responde un mensaje GENÉRICO (review round 3, hallazgo F): nombrar el campo
  // rechazado y listar los permitidos le entregaba al atacante el mapa exacto de campos editables. El
  // detalle (disallowedFields + quoteId + userId) se queda en el log del servidor.
  const GENERIC_REJECTION = 'Campo no editable por este endpoint.';
  const expectGenericError = (res) => expect(res.body.error).toBe(GENERIC_REJECTION);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    adminToken = await AuthTestHelper.loginAs('admin', app);
    adminUser = await AuthTestHelper.getUserByRole('admin');
  }, 30000);

  afterAll(async () => {
    for (const quoteId of createdQuoteIds) {
      try {
        const q = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await q.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  // ---- Happy path: campo permitido se aplica ----

  it('permite un campo del allowlist (notes) -> 201 y persiste', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { notes: 'Nota editada colaborativamente' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('notes')).toBe('Nota editada colaborativamente');
  });

  it('permite varios campos del allowlist a la vez (contactPerson + contactEmail) -> 201 y persiste', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, {
      contactPerson: 'Nuevo Contacto', contactEmail: 'nuevo@test.local',
    });
    expect(res.status).toBe(201);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('contactPerson')).toBe('Nuevo Contacto');
    expect(updated.get('contactEmail')).toBe('nuevo@test.local');
  });

  // ---- Seguridad: campos fuera del allowlist -> 400 y NO persisten ----

  it('SEGURIDAD (hallazgo F): el 400 NO revela el allowlist ni el campo rechazado', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { total: 1, owner: 'a'.repeat(24) });
    expect(res.status).toBe(400);
    expectGenericError(res);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Campos permitidos/i);
    expect(body).not.toMatch(/contactPerson|contactEmail|contactPhone|notes|eventType/);
    expect(body).not.toMatch(/owner|total/);
  });

  it('SEGURIDAD: rechaza serviceItems -> 400 y no muta serviceItems', async () => {
    const quote = await makeQuote();
    const before = quote.get('serviceItems');

    const res = await postEdit(quote.id, {
      serviceItems: {
        days: [{ dayNumber: 1, subconcepts: [{ id: 'x', total: 999999 }] }],
        subtotal: 999999, iva: 0, total: 999999, paymentType: 'tarjeta',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('serviceItems')).toEqual(before); // intacto
  });

  it('SEGURIDAD: rechaza total (campo de dinero) -> 400 y no lo fija', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { total: 1 });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('total')).toBeUndefined(); // nunca se escribió
  });

  it('SEGURIDAD: rechaza owner (pointer de dueño) -> 400 y no reasigna el dueño', async () => {
    const quote = await makeQuote();
    const originalOwnerId = quote.get('owner').id;

    const res = await postEdit(quote.id, { owner: 'a'.repeat(24) });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('owner').id).toBe(originalOwnerId); // dueño sin cambios
  });

  it('SEGURIDAD: rechaza status -> 400 y no cambia el estado', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { status: 'scheduled' });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('status')).toBe('draft');
  });

  it('SEGURIDAD: rechaza approvalStatus -> 400', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { approvalStatus: 'pending_approval' });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    expect(updated.get('approvalStatus')).toBeUndefined();
  });

  it('SEGURIDAD: rechaza paymentType (no editable por esta vía genérica) -> 400', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { paymentType: 'tarjeta' });
    expect(res.status).toBe(400);
    expectGenericError(res);
  });

  it('SEGURIDAD: request mixto (permitido + prohibido) se rechaza COMPLETO -> 400 y ni el permitido se aplica', async () => {
    const quote = await makeQuote();
    const res = await postEdit(quote.id, { notes: 'no debe aplicarse', total: 5 });
    expect(res.status).toBe(400);
    expectGenericError(res);

    const updated = await fetchQuote(quote.id);
    // El request completo se rechaza: el campo permitido tampoco se persiste.
    expect(updated.get('notes')).toBe('Nota original');
    expect(updated.get('total')).toBeUndefined();
  });

  // ---- No-regresión del camino interno: PUT /:id/service-items sigue vivo ----

  it('NO-REGRESIÓN: PUT /:id/service-items sigue persistiendo serviceItems (path del servicio, no del controller HTTP)', async () => {
    const quote = await makeQuote();
    const putRes = await request(app)
      .put(`/api/quotes/${quote.id}/service-items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        days: [{
          dayNumber: 1,
          dayTitle: '',
          dayTotal: PRICES.efectivo,
          subconcepts: [{
            id: 'svc1',
            concept: 'Servicio',
            type: 'concepto',
            pricesByType: { ...PRICES },
            total: PRICES.efectivo,
            includeInTotal: true,
          }],
        }],
        subtotal: PRICES.efectivo,
        iva: 0,
        total: PRICES.efectivo,
        currency: 'MXN',
        paymentType: 'efectivo',
      });
    expect(putRes.status).toBe(200);

    const updated = await fetchQuote(quote.id);
    const si = updated.get('serviceItems');
    expect(si.days).toHaveLength(1);
    expect(si.subtotal).toBe(PRICES.efectivo);
    expect(si.paymentType).toBe('efectivo');
  });
});
