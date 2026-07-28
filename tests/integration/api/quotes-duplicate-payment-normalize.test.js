/**
 * HUECO 2 — duplicateQuote normaliza el método de pago al clonar serviceItems.
 *
 * El duplicado es un registro NUEVO. Si el original NO trae un método válido (borrador legacy con
 * paymentType null/ausente), el clon heredaba ese null y aguas abajo se lee como efectivo. Ahora, tras el
 * deep-clone, si cloned.paymentType no es válido (Payment.isValidMethod false) se fija a 'tarjeta' (el
 * default de un registro nuevo). Un método explícito y válido se conserva tal cual (copia fiel).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('duplicateQuote — normalización de paymentType (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const createdQuoteIds = [];

  const baseServiceItems = (paymentTypeKV) => ({
    days: [{
      dayNumber: 1,
      dayTitle: 'Día 1',
      dayTotal: 1000,
      subconcepts: [{
        id: 'svc1', concept: 'Servicio', type: 'concepto', total: 1000, includeInTotal: true,
      }],
    }],
    subtotal: 1000,
    iva: 160,
    total: 1160,
    currency: 'MXN',
    ...paymentTypeKV,
  });

  const makeQuote = async ({ serviceItems } = {}) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-DUPNORM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('eventType', 'Evento duplicable');
    quote.set('numberOfPeople', 2);
    quote.set('owner', adminUser);
    quote.set('createdBy', adminUser);
    if (serviceItems !== undefined) {
      quote.set('serviceItems', serviceItems);
    }
    await quote.save(null, { useMasterKey: true });
    createdQuoteIds.push(quote.id);
    return quote;
  };

  const duplicate = (quoteId) => request(app)
    .post(`/api/quotes/${quoteId}/duplicate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Content-Type', 'application/json')
    .send({});

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

  it('conserva un método explícito válido (efectivo) en el duplicado', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: 'efectivo' }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('efectivo');

    const dup = await new Parse.Query('Quote').get(dupId, { useMasterKey: true });
    expect(dup.get('serviceItems').paymentType).toBe('efectivo');
  });

  it('conserva un método explícito válido (transferencia) en el duplicado', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: 'transferencia' }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('transferencia');
  });

  it('borrador legacy con paymentType=null -> el duplicado queda tarjeta', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: null }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('tarjeta');

    const dup = await new Parse.Query('Quote').get(dupId, { useMasterKey: true });
    expect(dup.get('serviceItems').paymentType).toBe('tarjeta');
  });

  it('borrador legacy con paymentType ausente (clave omitida) -> el duplicado queda tarjeta', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({}) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('tarjeta');
  });

  it('método inválido (basura) -> el duplicado se normaliza a tarjeta', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: 'bitcoin' }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('tarjeta');
  });

  it('cotización sin serviceItems -> no truena y usa el default vacío (sin paymentType)', async () => {
    const quote = await makeQuote({ serviceItems: undefined });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    const dupServiceItems = res.body.data.quote.serviceItems;
    expect(dupServiceItems).toEqual({ days: [], subtotal: 0, iva: 0, total: 0 });
    expect(dupServiceItems.paymentType).toBeUndefined();
  });
});
