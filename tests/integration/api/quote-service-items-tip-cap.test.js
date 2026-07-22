/**
 * FIX 3: tope de 100% en la propina tipo PORCENTAJE — integration (vía PUT /service-items).
 *
 * El porcentaje de propina (general o por servicio) no puede exceder 100%: el endpoint responde 400 y
 * NO persiste. El monto FIJO (type 'amount') NO lleva límite. Se corre como admin para aislar la
 * validación del tope (un no-admin chocaría antes con el guard RBAC de FIX 1). El payload usa
 * total = subtotal + iva (sin hornear la propina) para no chocar con evaluateTotalsConsistency.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Propina en service-items: tope 100% en percent (FIX 3, integration)', () => {
  let app;
  let adminToken;
  const created = { quotes: [] };

  const makeQuote = async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-TIPCAP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: '', subconcepts: [] }],
      subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchSI = async (quoteId) => {
    const q = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
    return q.get('serviceItems');
  };

  const sub = (id, extra = {}) => ({
    id,
    concept: 'Servicio',
    type: 'concepto',
    pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
    total: 1000,
    includeInTotal: true,
    ...extra,
  });

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
      paymentType: 'efectivo',
      ...extra,
    };
  };

  const putSI = (quoteId, body) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  it('F3-I01: globalTip percent=100 -> 200', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'percent', value: 100, mandatory: false } }));
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).globalTip.value).toBe(100);
  });

  it('F3-I02: globalTip percent=100.01 -> 400, no persiste', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'percent', value: 100.01, mandatory: false } }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100%/);
    expect((await fetchSI(quote.id)).globalTip == null).toBe(true);
  });

  it('F3-I03: globalTip percent=150 -> 400', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'percent', value: 150, mandatory: false } }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100%/);
  });

  it('F3-I04: globalTip amount=50000 (monto fijo sin límite) -> 200', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'amount', value: 50000, mandatory: false } }));
    expect(res.status).toBe(200);
    expect((await fetchSI(quote.id)).globalTip.value).toBe(50000);
  });

  it('F3-I05: subconcepto percent=100 -> 200', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1', { tipType: 'percent', tipValue: 100, tipAmount: 1000 })]));
    expect(res.status).toBe(200);
  });

  it('F3-I06: subconcepto percent=101 -> 400 (mensaje identifica el día/servicio)', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1', { tipType: 'percent', tipValue: 101, tipAmount: 1010 })]));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subconcepto/i);
    expect(res.body.error).toMatch(/día/i);
    expect(res.body.error).toMatch(/100%/);
  });

  it('F3-I07: subconcepto amount=50000 (monto fijo sin límite) -> 200', async () => {
    const quote = await makeQuote();
    const res = await putSI(quote.id, putBody([sub('svc1', { tipType: 'amount', tipValue: 50000, tipAmount: 50000 })]));
    expect(res.status).toBe(200);
  });

  it('F3-I08: globalTip percent=150 + subconcepto percent=200 en el mismo request -> 400 (no crashea)', async () => {
    const quote = await makeQuote();
    const res = await putSI(
      quote.id,
      putBody(
        [sub('svc1', { tipType: 'percent', tipValue: 200, tipAmount: 2000 })],
        { globalTip: { type: 'percent', value: 150, mandatory: false } }
      )
    );
    expect(res.status).toBe(400); // rechazo limpio, nunca 500
    expect(res.body.error).toMatch(/100%/);
  });
});
