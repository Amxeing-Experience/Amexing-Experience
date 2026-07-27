/**
 * Cotización pública (sin sesión, GET /quotes/:folio) — el descuento por servicio SÍ debe llegar
 * al cliente. Council overnight marcó esto como MEDIUM (formatSubconcept dropea discountAmount/
 * discountType/discountValue); verificado que ese método es código muerto: preparePublicQuoteData
 * pasa serviceItems crudo (comentario en la línea 295-297 del controller, fix de paridad de
 * 2026-06-05) dentro del blob `quote = <JSON>` que services-renderer.js consume client-side. Este
 * test verifica el PLUMBING de datos (el descuento llega al blob que ve el navegador), no el
 * render final del DOM (eso requiere JS real, cubierto por la prueba de Claude Chrome).
 */
const request = require('supertest');
const Parse = require('parse/node');

describe('Public quote discount data plumbing (integration)', () => {
  let app;
  const createdQuoteIds = [];

  // Extrae el objeto `quote = {...}` embebido para el render client-side (línea
  // "quote = <%- JSON.stringify(locals.quote) %>;" en quote-summary.ejs).
  const extractEmbeddedQuote = (html) => {
    const marker = 'quote = ';
    const start = html.indexOf(marker);
    if (start < 0) throw new Error('No se encontró el blob "quote = {...}" embebido en la página');
    const jsonStart = start + marker.length;
    const jsonEnd = html.indexOf(';', jsonStart);
    return JSON.parse(html.slice(jsonStart, jsonEnd));
  };

  const makeQuote = async (subconcept) => {
    const q = new Parse.Object('Quote');
    q.set('exists', true);
    q.set('active', true);
    q.set('status', 'quoted');
    q.set('folio', `QTE-2026-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`);
    q.set('numberOfPeople', 2);
    q.set('serviceItems', {
      currency: 'MXN',
      paymentType: 'efectivo',
      subtotal: subconcept.total,
      iva: 0,
      total: subconcept.total,
      days: [{ dayNumber: 1, dayTitle: 'Día 1', subconcepts: [subconcept] }],
    });
    await q.save(null, { useMasterKey: true });
    createdQuoteIds.push(q.id);
    return q;
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
  }, 30000);

  afterAll(async () => {
    await Promise.all(createdQuoteIds.map(async (id) => {
      try {
        const o = new Parse.Object('Quote');
        o.id = id;
        await o.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }));
  });

  it('descuento tipo monto llega intacto (discountType/discountValue/discountAmount) al blob del cliente', async () => {
    const q = await makeQuote({
      id: 'svcA',
      concept: 'Servicio A',
      type: 'traslado',
      pricesByType: { efectivo: 10000, transferencia: 11600, tarjeta: 12100 },
      total: 9700,
      includeInTotal: true,
      discountType: 'amount',
      discountValue: 300,
      discountAmount: 300,
    });

    const res = await request(app).get(`/quotes/${q.get('folio')}`);
    expect(res.status).toBe(200);
    const embedded = extractEmbeddedQuote(res.text);
    const sub = embedded.serviceItems.days[0].subconcepts[0];
    expect(sub.discountType).toBe('amount');
    expect(sub.discountValue).toBe(300);
    expect(sub.discountAmount).toBe(300);
  });

  it('descuento tipo porcentaje llega intacto al blob del cliente', async () => {
    const q = await makeQuote({
      id: 'svcB',
      concept: 'Servicio B',
      type: 'tour',
      pricesByType: { efectivo: 5000, transferencia: 5800, tarjeta: 6050 },
      total: 4500,
      includeInTotal: true,
      discountType: 'percent',
      discountValue: 10,
      discountAmount: 500,
    });

    const res = await request(app).get(`/quotes/${q.get('folio')}`);
    expect(res.status).toBe(200);
    const embedded = extractEmbeddedQuote(res.text);
    const sub = embedded.serviceItems.days[0].subconcepts[0];
    expect(sub.discountType).toBe('percent');
    expect(sub.discountValue).toBe(10);
    expect(sub.discountAmount).toBe(500);
  });

  it('servicio SIN descuento no trae discountAmount en el blob del cliente', async () => {
    const q = await makeQuote({
      id: 'svcC',
      concept: 'Servicio C',
      type: 'traslado',
      pricesByType: { efectivo: 2000, transferencia: 2320, tarjeta: 2420 },
      total: 2000,
      includeInTotal: true,
    });

    const res = await request(app).get(`/quotes/${q.get('folio')}`);
    expect(res.status).toBe(200);
    const embedded = extractEmbeddedQuote(res.text);
    const sub = embedded.serviceItems.days[0].subconcepts[0];
    expect(sub.discountAmount).toBeUndefined();
  });
});
