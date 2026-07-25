/**
 * serviceItems.subtotal NUNCA incluye propinas (general o por servicio) — integration tests
 * (Parse + mongodb-memory-server).
 *
 * Regresión del caso DISC-100 (Claude Chrome, arco propina/descuento por servicio): en
 * quote-summary.ejs el "Subtotal" mostrado se derivaba como `total - iva`, y en efectivo `iva`
 * siempre es 0 -> Subtotal_mostrado colapsaba a Total (la propina general quedaba "horneada" en el
 * Subtotal). El fix (quote-summary.ejs) hace que el Subtotal mostrado lea directamente
 * serviceItems.subtotal (el mismo campo ya persistido aquí) en vez de restar sólo el IVA del Total.
 *
 * Esta suite NO prueba el JS de navegador (sin harness en este repo para JS embebido en .ejs — ver
 * tests/integration/frontend/quote-services-auto-sort.test.js, describe.skip con la misma limitación
 * documentada). Bloquea la fuente de verdad server-side de la que el fix ahora depende:
 * QuoteController.updateServiceItems debe persistir serviceItems.subtotal como el neto de servicios
 * (precio − descuento), SIN ninguna propina, sin importar paymentType ni si el subtotal cae a $0.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('serviceItems.subtotal excluye propinas (regresión DISC-100, integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const created = { quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const siBody = (subs, {
    subtotal, total, globalTip = null, paymentType = 'efectivo',
  }) => ({
    paymentType,
    currency: 'MXN',
    subtotal,
    iva: 0,
    total,
    globalTip,
    suggestedTipPct: 10,
    days: [{
      dayNumber: 1,
      dayTitle: '',
      date: '2026-08-15',
      dayTotal: subs.reduce((s, x) => s + (x.total || 0), 0),
      subconcepts: subs,
    }],
  });

  const emptySI = {
    days: [{ dayNumber: 1, dayTitle: '', subconcepts: [] }],
    subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
  };

  const makeQuote = async (serviceItems, status = 'draft') => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', uniqueFolio('QTE-SUBTOTIP'));
    quote.set('numberOfPeople', 2);
    quote.set('client', adminUser);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const putSI = (quoteId, body, token = adminToken) => request(app)
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

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `subtotip-admin-${Date.now()}@test.local`);
    adminUser.set('username', adminUser.get('email'));
    await adminUser.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    if (adminUser) { try { await adminUser.destroy({ useMasterKey: true }); } catch (e) { /* already gone */ } }
  });

  it('DISC-100: Servicio A 100% descontado ($0) + Servicio B $1000 + propina general 20% (efectivo) -> subtotal 1000, NUNCA 1200', async () => {
    const svcA = buildSubconcept({ id: 'discA', priceEfectivo: 1000, discountAmount: 1000 });
    const svcB = buildSubconcept({ id: 'discB', priceEfectivo: 1000 });
    expect(svcA.total).toBe(0);
    expect(svcB.total).toBe(1000);

    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(quote.id, siBody([svcA, svcB], {
      subtotal: 1000, total: 1200, globalTip: { type: 'percent', value: 20, mandatory: false },
    }));
    expect(res.status).toBe(200);

    const saved = await fetchSI(quote.id);
    expect(saved.subtotal).toBe(1000); // NUNCA 1200: la propina general no está horneada en el subtotal
    expect(saved.iva).toBe(0);
    expect(saved.total).toBe(1200); // 1000 subtotal + 200 propina general (20% de 1000)
    expect(saved.globalTip.value).toBe(20);
  });

  it('DISC-100 en tarjeta: mismo escenario con paymentType=tarjeta -> subtotal sigue siendo neto de servicios, sin la propina', async () => {
    // pricesByType.tarjeta > efectivo (recargo) para que la variante "sutil" del bug (IVA calculado
    // sólo sobre netSubtotal, subtotal = total - iva) sea observable si reapareciera: con recargo,
    // total-iva NO colapsaría a total pero sí arrastraría ambas propinas fuera del neto de servicios.
    const svcA = buildSubconcept({
      id: 'discA2', priceEfectivo: 1000, priceTransferencia: 1160, priceTarjeta: 1210,
      discountAmount: 1000, paymentType: 'tarjeta',
    });
    const svcB = buildSubconcept({
      id: 'discB2', priceEfectivo: 1000, priceTransferencia: 1160, priceTarjeta: 1210,
      paymentType: 'tarjeta',
    });
    expect(svcA.total).toBe(0);
    expect(svcB.total).toBe(1210);

    const quote = await makeQuote(emptySI, 'draft');
    const netTarjeta = svcA.total + svcB.total; // 1210
    const ivaSobreNeto = Math.round((netTarjeta - netTarjeta / 1.16) * 100) / 100;
    const globalTipAmount = Math.round(netTarjeta * 0.2 * 100) / 100; // 20% sobre neto en tarjeta
    const total = Math.round((netTarjeta + globalTipAmount) * 100) / 100;
    const res = await putSI(quote.id, siBody([svcA, svcB], {
      subtotal: netTarjeta, total, paymentType: 'tarjeta', globalTip: { type: 'percent', value: 20, mandatory: false },
    }));
    expect(res.status).toBe(200);

    const saved = await fetchSI(quote.id);
    expect(saved.subtotal).toBe(netTarjeta); // 1210: SOLO servicios, sin la propina general
    expect(saved.subtotal).not.toBe(total); // el bug colapsaba subtotal a total en efectivo; aquí tampoco debe ocurrir
    void ivaSobreNeto; // documenta la base de la variante sutil del bug; no se compara serviceItems.iva (front lo desglosa)
  });

  it('propina general + propina por servicio combinadas -> subtotal excluye AMBAS, no sólo una', async () => {
    const sc = buildSubconcept({
      id: 'bothtips', priceEfectivo: 1000, tipType: 'amount', tipValue: 100,
    });
    expect(sc.total).toBe(1000); // el subconcepto guarda SOLO precio; la propina por servicio es metadata aparte

    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(quote.id, siBody([sc], {
      subtotal: 1000, total: 1300, globalTip: { type: 'amount', value: 200, mandatory: false },
    }));
    expect(res.status).toBe(200);

    const saved = await fetchSI(quote.id);
    expect(saved.subtotal).toBe(1000); // ni la propina por servicio ($100) ni la general ($200) están en el subtotal
    expect(saved.total).toBe(1300); // 1000 + 100 (servicio) + 200 (general)
  });

  it('subtotal $0 legítimo (único servicio 100% descontado, sin propina) -> se persiste 0, no un valor inválido', async () => {
    const sc = buildSubconcept({ id: 'zero', priceEfectivo: 500, discountAmount: 500 });
    expect(sc.total).toBe(0);

    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(quote.id, siBody([sc], { subtotal: 0, total: 0 }));
    expect(res.status).toBe(200);

    const saved = await fetchSI(quote.id);
    expect(saved.subtotal).toBe(0); // 0 es un subtotal VÁLIDO (no "faltante"): el front no debe caer al fallback
    expect(saved.total).toBe(0);
  });
});
