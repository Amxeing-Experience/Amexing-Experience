/**
 * H12: concurrencia de PUT /api/quotes/:id/service-items sobre la MISMA cotización — integration.
 *
 * updateServiceItems no serializa por cotización (a diferencia de los pagos/ajustes de reservación), así
 * que dos escrituras casi simultáneas hacen read-compute-write con last-write-wins. Estas pruebas
 * blindan que la concurrencia NUNCA produzca un 500 ni deje `days` corrupto, y que el guard RBAC de
 * propina (FIX 1) no dispare un 403 "cruzado" a un agente que no toca la propina. Cada caso usa su
 * propia Quote y no asume cuál escritura gana.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('PUT service-items concurrente (H12, integration)', () => {
  let app;
  let adminToken;
  let agentToken;
  const created = { quotes: [] };

  const makeQuote = async (subs) => {
    const subtotal = subs.reduce((s, x) => s + (x.includeInTotal !== false ? x.total : 0), 0);
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-H12-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: '', subconcepts: subs }],
      subtotal, iva: 0, total: subtotal, currency: 'MXN', paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
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
      subtotal, iva: 0, total: subtotal, currency: 'MXN', paymentType: 'efectivo', ...extra,
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

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);
    agentToken = await AuthTestHelper.loginAs('client', app);
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  it('H12-I01: dos PUT admin casi simultáneos con globalTip distinto (10 vs 20) -> ninguno 500, final in {10,20}, days válido', async () => {
    const quote = await makeQuote([sub('svc1')]);
    const [r10, r20] = await Promise.all([
      putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'percent', value: 10, mandatory: false } }), adminToken),
      putSI(quote.id, putBody([sub('svc1')], { globalTip: { type: 'percent', value: 20, mandatory: false } }), adminToken),
    ]);
    expect(r10.status).not.toBe(500);
    expect(r20.status).not.toBe(500);
    expect(r10.status).toBe(200);
    expect(r20.status).toBe(200);

    const si = await fetchSI(quote.id);
    expect([10, 20]).toContain(si.globalTip.value); // gana uno de los dos, sin corromper
    expect(Array.isArray(si.days)).toBe(true);
    expect(si.days[0].subconcepts.find((x) => x.id === 'svc1')).toBeTruthy(); // days intacto
  });

  it('H12-I02: agente-sin-tip (edita time) vs admin-con-tip (agrega servicio con propina) -> sin 500, agente sin 403 cruzado, days válido', async () => {
    const quote = await makeQuote([sub('svc1', { time: '10:00' })]);
    // El agente edita SOLO un campo no-propina (time) y no toca la propina en su payload.
    const agentPayload = putBody([sub('svc1', { time: '14:00' })]);
    // El admin agrega un subconcepto NUEVO con propina (operación de admin, permitida).
    const adminPayload = putBody([
      sub('svc1', { time: '10:00' }),
      sub('svcNew', {
        pricesByType: { efectivo: 500, transferencia: 580, tarjeta: 605 }, total: 500, tipType: 'percent', tipValue: 10, tipAmount: 50,
      }),
    ]);

    const [agentRes, adminRes] = await Promise.all([
      putSI(quote.id, agentPayload, agentToken),
      putSI(quote.id, adminPayload, adminToken),
    ]);

    expect(agentRes.status).not.toBe(500);
    expect(adminRes.status).not.toBe(500);
    // El agente no toca la propina en su payload (svc1 sin tip, globalTip ausente == stored) -> nunca 403.
    expect(agentRes.status).toBe(200);
    expect(adminRes.status).toBe(200);

    const si = await fetchSI(quote.id);
    expect(Array.isArray(si.days)).toBe(true);
    // Gane quien gane, svc1 sobrevive y `days` queda consistente (no corrupto).
    const allSubs = si.days.flatMap((d) => d.subconcepts || []);
    expect(allSubs.find((x) => x.id === 'svc1')).toBeTruthy();
  });
});
