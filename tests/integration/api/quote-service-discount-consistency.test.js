/**
 * Descuento por servicio (Fase 1) sin rechazo espurio — integration tests (Parse + mongodb-memory-server).
 *
 * Regresión de un bug pre-existente: el descuento por servicio (sc.discountAmount) resta de forma
 * legítima el precio neto (sc.total) por debajo del pricesByType bruto. evaluateTotalsConsistency
 * comparaba sc.total contra pricesByType[paymentType] SIN restar el descuento, así que cualquier
 * descuento neto > $1.00 hacía que el PUT /service-items respondiera 400 "el precio no coincide".
 * El fix resta el descuento escalado (mismo factor que el front) antes de comparar.
 *
 * D-I1 es la prueba central: el PUT que antes daba 400 ahora da 200 y guarda el precio neto.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');
const { buildSubconcept } = require('../../helpers/serviceItemsFixture');

describe('Descuento por servicio sin rechazo espurio (integration)', () => {
  let app;
  let adminToken;
  let adminUser;
  const created = { quotes: [] };

  const uniqueFolio = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const siBody = (subs, {
    subtotal, total, paymentType = 'efectivo',
  }) => ({
    paymentType,
    currency: 'MXN',
    subtotal,
    iva: 0,
    total,
    globalTip: null,
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
    quote.set('folio', uniqueFolio('QTE-SVCDISC'));
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

  const fetchQuote = (id) => new Parse.Query('Quote').get(id, { useMasterKey: true });

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    adminToken = await AuthTestHelper.loginAs('admin', app);

    adminUser = new Parse.Object('AmexingUser');
    adminUser.set('exists', true);
    adminUser.set('active', true);
    adminUser.set('role', 'admin');
    adminUser.set('email', `svcdisc-admin-${Date.now()}@test.local`);
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

  it('D-I1: servicio $2000 con descuento $300 (sin propina) -> 200; guarda el precio neto $1700 [antes daba 400]', async () => {
    const sc = buildSubconcept({ id: 'di1', priceEfectivo: 2000, discountAmount: 300 });
    expect(sc.total).toBe(1700);
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(quote.id, siBody([sc], { subtotal: 1700, total: 1700 }));
    expect(res.status).toBe(200);
    const saved = await fetchQuote(quote.id);
    expect(saved.get('serviceItems').days[0].subconcepts[0].total).toBe(1700);
    expect(saved.get('serviceItems').days[0].subconcepts[0].discountAmount).toBe(300);
  });

  // Guard de entrada (council LOW): el descuento por servicio nunca se validaba server-side. Un
  // discountAmount/discountValue negativo llegaba a persistirse e inflaba la base de la propina general
  // porcentual (computeGeneralTip: netBaseEfectivo += Math.max(0, ef - disc); con disc<0 => ef + |disc|).
  // El PUT ahora rechaza con 400 ANTES de persistir; el descuento porcentual además no puede exceder 100%.
  const guardSub = (extra = {}) => ({
    id: 'dg',
    concept: 'Servicio dg',
    type: 'concepto',
    pricesByType: { efectivo: 2000, transferencia: 2000, tarjeta: 2000 },
    unitPrice: 2000,
    total: 2000,
    includeInTotal: true,
    ...extra,
  });

  // El quote se crea con emptySI (day 1 con 0 subconcepts); un rechazo 400 no debe persistir nada.
  const expectNothingPersisted = async (quoteId) => {
    const saved = await fetchQuote(quoteId);
    expect(saved.get('serviceItems').days[0].subconcepts.length).toBe(0);
  };

  it('D-G1: discountAmount negativo (-300) -> 400, nada persiste', async () => {
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(
      quote.id,
      siBody([guardSub({ discountAmount: -300 })], { subtotal: 2000, total: 2000 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Dd]escuento/);
    await expectNothingPersisted(quote.id);
  });

  it('D-G2: discountType percent con discountValue negativo (-10) -> 400, nada persiste', async () => {
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(
      quote.id,
      siBody([guardSub({ discountType: 'percent', discountValue: -10 })], { subtotal: 2000, total: 2000 })
    );
    expect(res.status).toBe(400);
    await expectNothingPersisted(quote.id);
  });

  it('D-G3: discountType percent con discountValue > 100 (150) -> 400', async () => {
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(
      quote.id,
      siBody([guardSub({ discountType: 'percent', discountValue: 150 })], { subtotal: 2000, total: 2000 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100%/);
    await expectNothingPersisted(quote.id);
  });

  it('D-G4: discountType amount con discountValue negativo (-50) -> 400', async () => {
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(
      quote.id,
      siBody([guardSub({ discountType: 'amount', discountValue: -50 })], { subtotal: 2000, total: 2000 })
    );
    expect(res.status).toBe(400);
    await expectNothingPersisted(quote.id);
  });

  it('D-G5: control — descuento legítimo (discountAmount 300, amount/300) -> 200, el guard no rompe el caso normal', async () => {
    const sc = {
      ...buildSubconcept({ id: 'dg5', priceEfectivo: 2000, discountAmount: 300 }),
      discountType: 'amount',
      discountValue: 300,
    };
    expect(sc.total).toBe(1700);
    const quote = await makeQuote(emptySI, 'draft');
    const res = await putSI(quote.id, siBody([sc], { subtotal: 1700, total: 1700 }));
    expect(res.status).toBe(200);
    const saved = await fetchQuote(quote.id);
    const persisted = saved.get('serviceItems').days[0].subconcepts[0];
    expect(persisted.total).toBe(1700);
    expect(persisted.discountAmount).toBe(300);
    expect(persisted.discountValue).toBe(300);
  });
});
