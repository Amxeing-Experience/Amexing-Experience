/**
 * QuoteController — validación de consistencia de precios al guardar service-items (costura #1).
 *
 * Regla: una divergencia entre lo que el front envía y lo que el motor recalcula de hasta $1.00
 * (PRICE_MISMATCH_TOLERANCE) se acepta como redondeo normal (solo warning, sigue guardando); una
 * divergencia MAYOR a $1.00 rechaza el guardado con 400 y un mensaje específico, sin persistir nada.
 * El límite es inclusivo del lado "está bien": exactamente $1.00 no rechaza.
 *
 * Se testea la decisión pura (evaluateTotalsConsistency) exhaustivamente, más el cableado del
 * controller (updateServiceItems responde 400 ANTES de tocar la BD cuando hay rechazo).
 */

// Mock de infra/servicios pesados para que requerir el controller no tenga efectos secundarios ni
// necesite un Parse server. pricingEngine (usado por el helper) y el modelo Payment se dejan reales.
jest.mock('../../../../src/infrastructure/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../../src/application/services/FileStorageService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/QuoteService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/QuoteOwnershipService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/QuoteCollaborationService', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../../src/application/services/QuoteVersioningService', () => jest.fn().mockImplementation(() => ({})));

const QuoteController = require('../../../../src/application/controllers/api/QuoteController');

// Un día con un único subconcepto cuyo total = pricesByType[efectivo] (subconcepto consistente).
const dayWith = (subconcepts) => ({ dayNumber: 1, dayTitle: 'Día 1', subconcepts });
const sc = (total, priceEfectivo, concept = 'Servicio') => ({
  concept, total, includeInTotal: true, pricesByType: { efectivo: priceEfectivo },
});

describe('QuoteController.evaluateTotalsConsistency (decisión pura)', () => {
  const evalC = (params) => QuoteController.evaluateTotalsConsistency({
    iva: 0, total: params.subtotal, paymentType: 'efectivo', ...params,
  });

  it('sin ningún mismatch: no rechaza, no hay divergencias que loggear', () => {
    const r = evalC({ days: [dayWith([sc(100, 100)])], subtotal: 100 });
    expect(r.rejectMessage).toBeNull();
    expect(r.subtotalDiff).toBe(0);
    expect(r.subconceptMismatches).toBe(0);
    expect(r.totalDiff).toBe(0);
  });

  it('diferencia de subtotal de $0.50: NO rechaza, se registra como warning', () => {
    const r = evalC({ days: [dayWith([sc(100, 100)])], subtotal: 100.5 });
    expect(r.rejectMessage).toBeNull();
    expect(r.subtotalDiff).toBe(0.5); // > 0.01 -> el controller loggea, pero sigue guardando
  });

  it('diferencia de subtotal EXACTA de $1.00: NO rechaza (límite inclusivo)', () => {
    const r = evalC({ days: [dayWith([sc(100, 100)])], subtotal: 101 });
    expect(r.rejectMessage).toBeNull();
    expect(r.subtotalDiff).toBe(1);
  });

  it('diferencia de subtotal de $1.01: RECHAZA con mensaje específico', () => {
    const r = evalC({ days: [dayWith([sc(100, 100)])], subtotal: 101.01 });
    expect(r.rejectMessage).toMatch(/subtotal/i);
    expect(r.rejectMessage).toContain('$1.01');
    expect(r.rejectMessage).toContain('Verifica los precios antes de guardar');
  });

  it('subconcepto con diferencia EXACTA de $1.00 (total vs pricesByType): NO rechaza', () => {
    // total 100 vs pricesByType.efectivo 101 -> diff 1.00; subtotal = suma de totales (consistente).
    const r = evalC({ days: [dayWith([sc(100, 101)])], subtotal: 100 });
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(1); // warning, no rechazo
  });

  it('subconcepto con diferencia de $1.01: RECHAZA', () => {
    const r = evalC({ days: [dayWith([sc(100, 101.01, 'Tour X')])], subtotal: 100 });
    expect(r.rejectMessage).toMatch(/Tour X/);
    expect(r.rejectMessage).toContain('$1.01');
  });

  it('varios subconceptos, uno con diferencia de $5.00: RECHAZA todo el guardado', () => {
    const days = [dayWith([
      sc(100, 100, 'Tour A'), // consistente
      sc(100, 105, 'Tour B'), // diff 5.00 -> supera tolerancia
    ])];
    // subtotal = suma de totales (200) para aislar el fallo en el subconcepto, no en el subtotal.
    const r = evalC({ days, subtotal: 200 });
    expect(r.rejectMessage).toMatch(/Tour B/);
    expect(r.rejectMessage).toContain('$5.00');
    expect(r.subtotalDiff).toBe(0); // el subtotal SÍ cuadra; el rechazo viene del subconcepto
  });

  it('cuando subtotal Y subconcepto superan la tolerancia, prioriza el mensaje del subconcepto (más accionable)', () => {
    const days = [dayWith([sc(100, 110, 'Tour Caro')])]; // subconcepto diff 10
    const r = evalC({ days, subtotal: 150 }); // subtotal diff 50 también
    expect(r.rejectMessage).toMatch(/Tour Caro/);
    expect(r.subtotalDiff).toBe(50);
  });

  it('subconceptos con includeInTotal:false no cuentan para la suma ni para el rechazo', () => {
    const days = [dayWith([
      sc(100, 100, 'Incluido'),
      { concept: 'Excluido', total: 9999, includeInTotal: false, pricesByType: { efectivo: 1 } },
    ])];
    const r = evalC({ days, subtotal: 100 });
    expect(r.rejectMessage).toBeNull();
    expect(r.sumOfSubconceptTotals).toBe(100);
  });

  it('pricesByType sin el método ancla no dispara mismatch de subconcepto (fallback histórico)', () => {
    const days = [dayWith([{ concept: 'X', total: 100, includeInTotal: true, pricesByType: { tarjeta: 999 } }])];
    const r = evalC({ days, subtotal: 100 });
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(0);
  });

  it('días o subconcepts vacíos/ausentes no rompen la evaluación', () => {
    expect(evalC({ days: [], subtotal: 0 }).rejectMessage).toBeNull();
    expect(evalC({ days: [{ dayNumber: 1 }], subtotal: 0 }).rejectMessage).toBeNull();
  });
});

describe('QuoteController.updateServiceItems (cableado del rechazo, sin BD)', () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const baseBody = (overrides) => ({
    currency: 'MXN',
    paymentType: 'efectivo',
    iva: 0,
    ...overrides,
  });

  it('rechaza con 400 (sin llegar al query de la cotización) cuando el subtotal diverge > $1.00', async () => {
    const req = {
      user: { id: 'u1' },
      params: { id: 'q1' },
      body: baseBody({
        subtotal: 200, // suma real de subconceptos = 100 -> diff 100
        total: 200,
        days: [{ dayNumber: 1, dayTitle: 'Día 1', dayTotal: 100, subconcepts: [sc(100, 100)] }],
      }),
    };
    const res = mockRes();

    await QuoteController.updateServiceItems(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/subtotal/i);
  });

  it('rechaza con 400 cuando un subconcepto diverge > $1.00 de su pricesByType', async () => {
    const req = {
      user: { id: 'u1' },
      params: { id: 'q1' },
      body: baseBody({
        subtotal: 100,
        total: 100,
        days: [{
          dayNumber: 1,
          dayTitle: 'Día 1',
          dayTotal: 100,
          subconcepts: [sc(100, 108, 'Traslado')], // diff 8
        }],
      }),
    };
    const res = mockRes();

    await QuoteController.updateServiceItems(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Traslado/);
  });
});
