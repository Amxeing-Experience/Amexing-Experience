/**
 * duplicateQuote — COPIA FIEL del método de pago al clonar serviceItems.
 *
 * El duplicado es un registro nuevo, pero clona el itinerario TAL CUAL (deep clone) sin normalizar el
 * paymentType. Un método explícito se conserva; un borrador legacy con paymentType null se conserva null
 * (se lee como efectivo, igual que el original), evitando el mismatch de "header con método tarjeta pero
 * subtotal/iva/total de efectivo". (Antes se forzaba a 'tarjeta' cuando el método no era válido; se
 * revirtió porque dejaba totales inconsistentes con el método mostrado.)
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('duplicateQuote — copia fiel de paymentType (integration)', () => {
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
    quote.set('folio', `QTE-DUPFIEL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
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

  it('conserva un método explícito válido (tarjeta) en el duplicado', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: 'tarjeta' }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBe('tarjeta');
  });

  it('borrador legacy con paymentType=null -> el duplicado CONSERVA null (copia fiel)', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({ paymentType: null }) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBeNull();

    const dup = await new Parse.Query('Quote').get(dupId, { useMasterKey: true });
    expect(dup.get('serviceItems').paymentType).toBeNull();
  });

  it('borrador legacy con paymentType ausente (clave omitida) -> el duplicado sigue sin la clave', async () => {
    const quote = await makeQuote({ serviceItems: baseServiceItems({}) });
    const res = await duplicate(quote.id);
    expect(res.status).toBe(201);

    const dupId = res.body.data.quote.objectId;
    createdQuoteIds.push(dupId);
    expect(res.body.data.quote.serviceItems.paymentType).toBeUndefined();
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
