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
const { buildSubconcept } = require('../../../helpers/serviceItemsFixture');

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

describe('QuoteController.evaluateTotalsConsistency — propina por servicio (doble conteo)', () => {
  // Regresión del bug del "tercer total": cuando la propina por servicio se HORNEA en sc.total
  // (bakeTipBug:true) el motor la ve divergir de pricesByType y rechaza; cuando el subconcepto
  // guarda SOLO precio (la forma corregida) no hay divergencia y el guardado pasa.
  const evalSc = (sc, subtotal, total) => QuoteController.evaluateTotalsConsistency({
    days: [{ subconcepts: [sc] }], subtotal, iva: 0, total, paymentType: 'efectivo',
  });

  it('U1: propina horneada ($150 fijo sobre $2000) reproduce el rechazo (regresión permanente)', () => {
    const sc = buildSubconcept({
      id: 's1', priceEfectivo: 2000, tipType: 'amount', tipValue: 150, bakeTipBug: true,
    });
    const r = evalSc(sc, 2150, 2150);
    expect(r.rejectMessage).not.toBeNull(); // sigue detectándose si alguien vuelve a hornear
  });

  it('U2: mismo caso pero subconcepto SIN hornear (forma corregida) no rechaza ni marca mismatch', () => {
    const sc = buildSubconcept({
      id: 's1', priceEfectivo: 2000, tipType: 'amount', tipValue: 150, bakeTipBug: false,
    });
    const r = evalSc(sc, 2000, 2000);
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(0);
  });

  it('U3: propina 10% ($200 sobre $2000) sin hornear tampoco rechaza', () => {
    const sc = buildSubconcept({
      id: 's1', priceEfectivo: 2000, tipType: 'percent', tipValue: 10, bakeTipBug: false,
    });
    const r = evalSc(sc, 2000, 2000);
    expect(r.rejectMessage).toBeNull();
  });

  it('U4: propina horneada de exactamente $1.00 (borde de tolerancia) NO rechaza (solo warning)', () => {
    const sc = buildSubconcept({
      id: 's1', priceEfectivo: 2000, tipType: 'amount', tipValue: 1, bakeTipBug: true,
    });
    const r = evalSc(sc, 2001, 2001);
    expect(r.rejectMessage).toBeNull();
  });

  it('U5: propina horneada de $1.01 (sobrepasa la tolerancia por un centavo) RECHAZA', () => {
    const sc = buildSubconcept({
      id: 's1', priceEfectivo: 2000, tipType: 'amount', tipValue: 1.01, bakeTipBug: true,
    });
    const r = evalSc(sc, 2001.01, 2001.01);
    expect(r.rejectMessage).not.toBeNull();
  });
});

describe('QuoteController.evaluateTotalsConsistency — descuento por servicio (Fase 1)', () => {
  // Regresión de un bug pre-existente: el descuento por servicio (sc.discountAmount) resta de forma
  // legítima el precio neto (sc.total) por debajo del pricesByType bruto. La validación comparaba
  // sc.total contra pricesByType[paymentType] SIN restar el descuento -> cualquier descuento neto
  // > $1.00 rechazaba el guardado por error. El fix resta el descuento ESCALADO por el mismo factor
  // de forma de pago que usa el front (getServiceDiscountInPaymentType) antes de comparar.
  const evalSc = (sc, subtotal, total, paymentType = 'efectivo') => QuoteController.evaluateTotalsConsistency({
    days: [{ subconcepts: [sc] }], subtotal, iva: 0, total, paymentType,
  });

  it('D1: descuento $300 en efectivo (repro en vivo) -> ya NO rechaza', () => {
    const sc = buildSubconcept({ id: 'disc1', priceEfectivo: 2000, discountAmount: 300 });
    expect(sc.total).toBe(1700); // el helper ya restó el descuento neto
    const r = evalSc(sc, sc.total, sc.total);
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(0);
  });

  it('D2: descuento escalado en tarjeta (300 * 2420/2000 = 363) -> no rechaza', () => {
    const sc = buildSubconcept({
      id: 'disc2', priceEfectivo: 2000, priceTarjeta: 2420, discountAmount: 300, paymentType: 'tarjeta',
    });
    expect(sc.total).toBe(2057); // 2420 - 363 (descuento escalado por el factor de tarjeta)
    const r = evalSc(sc, sc.total, sc.total, 'tarjeta');
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(0);
  });

  it('D3: descuento $300 + propina fija $100 en el mismo servicio no interfieren -> no rechaza', () => {
    const sc = buildSubconcept({
      id: 'disc3', priceEfectivo: 2000, discountAmount: 300, tipType: 'amount', tipValue: 100,
    });
    expect(sc.total).toBe(1700); // total = SOLO precio neto (la propina va aparte, no horneada)
    expect(sc.tipAmount).toBe(100);
    const r = evalSc(sc, sc.total, sc.total);
    expect(r.rejectMessage).toBeNull();
    expect(r.subconceptMismatches).toBe(0);
  });

  it('D4: descuento de exactamente $1.00 (borde de tolerancia) -> no rechaza', () => {
    const sc = buildSubconcept({ id: 'disc4', priceEfectivo: 2000, discountAmount: 1 });
    expect(sc.total).toBe(1999);
    const r = evalSc(sc, sc.total, sc.total);
    expect(r.rejectMessage).toBeNull();
  });

  it('D5: anti-regresión — un error real de $50 (no atribuible a descuento/propina) SIGUE rechazando', () => {
    const sc = buildSubconcept({ id: 'disc5', priceEfectivo: 2000, discountAmount: 300 });
    sc.total = 1750; // esperado neto = 1700; $50 de más que no corresponde a ningún descuento declarado
    const r = evalSc(sc, sc.total, sc.total);
    expect(r.rejectMessage).not.toBeNull();
    expect(r.rejectMessage).toMatch(/disc5/);
    expect(r.rejectMessage).toContain('$50.00');
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

  // Regresión "Pago externo": el chequeo por-DÍA (dayTotal) debe excluir los subconceptos
  // includeInTotal:false igual que evaluateTotalsConsistency. Antes los sumaba y rechazaba con 400
  // cualquier día que llevara un "Pago externo" (el wizard ya manda un dayTotal que los excluye).
  // Este caso de CONTROL manda un dayTotal que no cuadra NI excluyendo el externo -> debe seguir
  // rechazando (la validación sigue siendo real), y su suma esperada demuestra que el externo NO
  // se contó ($1000, no $3000). Corta ANTES del query a la BD, por eso vive en el archivo unitario.
  it('el chequeo por-día excluye includeInTotal:false: un dayTotal que no cuadra ni así RECHAZA, y la suma esperada NO incluye el "Pago externo"', async () => {
    const req = {
      user: { id: 'u1' },
      params: { id: 'q1' },
      body: baseBody({
        subtotal: 1000, // suma real = solo el servicio incluido
        total: 1000,
        days: [{
          dayNumber: 1,
          dayTitle: 'Día 1',
          dayTotal: 500, // debería ser 1000 (excluyendo el externo); 500 no cuadra ni así
          subconcepts: [
            sc(1000, 1000, 'Traslado'), // includeInTotal:true
            { concept: 'Pago externo', total: 2000, includeInTotal: false, pricesByType: { efectivo: 2000 } },
          ],
        }],
      }),
    };
    const res = mockRes();

    await QuoteController.updateServiceItems(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const msg = res.json.mock.calls[0][0].error;
    expect(msg).toMatch(/no coincide con la suma de subconceptos/);
    expect(msg).toContain('$1000'); // suma esperada excluye el externo
    expect(msg).not.toContain('$3000'); // NUNCA suma el externo ($1000 + $2000)
  });
});
