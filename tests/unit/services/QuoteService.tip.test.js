/**
 * QuoteService — recálculo de la propina GENERAL (Fase 2, unit).
 *
 * Cubre las funciones puras computeGeneralTip / sumServiceTipsFromDays, que recomputan la propina
 * general a pesos FIJOS en efectivo desde serviceItems.globalTip (NO desde globalTip.amount persistido,
 * que puede venir inflado con recargo de tarjeta) y suman la propina por servicio del snapshot. Sin Parse
 * ni DB: sólo la lógica de cálculo.
 */

const QuoteService = require('../../../src/application/services/QuoteService');

const svc = new QuoteService();

// Helper: arma un serviceItems con un día de servicios (efectivo + descuento por servicio).
const daysOf = (efectivos, discounts = []) => ({
  days: [{
    subconcepts: efectivos.map((ef, i) => ({
      pricesByType: { efectivo: ef, tarjeta: Math.round(ef * 1.21 * 100) / 100 },
      discountAmount: discounts[i] || 0,
      includeInTotal: true,
    })),
  }],
});

describe('QuoteService.computeGeneralTip (propina general, pesos fijos en efectivo)', () => {
  it('percent: 10% sobre la base efectivo NETA, IGNORA el método de pago de la UI', () => {
    const si = { globalTip: { type: 'percent', value: 10 }, ...daysOf([2000, 1000]) };
    expect(svc.computeGeneralTip(si)).toBe(300); // 10% de 3000, no de tarjeta
  });

  it('amount: monto fijo LITERAL, no escala con método (anti-regresión directa del bug del wizard)', () => {
    const si = { globalTip: { type: 'amount', value: 500 }, ...daysOf([2000]) };
    expect(svc.computeGeneralTip(si)).toBe(500); // nunca 500 × 1.21
  });

  it('descuenta el discountAmount de cada servicio ANTES del %', () => {
    // efectivo 2000 − descuento 200 = base neta 1800; 10% = 180.
    const si = { globalTip: { type: 'percent', value: 10 }, ...daysOf([2000], [200]) };
    expect(svc.computeGeneralTip(si)).toBe(180);
  });

  it('excluye del cálculo los servicios includeInTotal:false', () => {
    const si = {
      globalTip: { type: 'percent', value: 10 },
      days: [{
        subconcepts: [
          { pricesByType: { efectivo: 2000 }, includeInTotal: true },
          { pricesByType: { efectivo: 5000 }, includeInTotal: false },
        ],
      }],
    };
    expect(svc.computeGeneralTip(si)).toBe(200); // solo el de 2000
  });

  it('globalTip null/ausente -> 0', () => {
    expect(svc.computeGeneralTip({ globalTip: null, ...daysOf([2000]) })).toBe(0);
    expect(svc.computeGeneralTip({ ...daysOf([2000]) })).toBe(0);
  });

  it('percent sobre base 0 -> 0 sin NaN', () => {
    const si = { globalTip: { type: 'percent', value: 10 }, days: [] };
    const out = svc.computeGeneralTip(si);
    expect(out).toBe(0);
    expect(Number.isNaN(out)).toBe(false);
  });

  it('value <= 0 o no finito -> 0', () => {
    expect(svc.computeGeneralTip({ globalTip: { type: 'percent', value: 0 }, ...daysOf([2000]) })).toBe(0);
    expect(svc.computeGeneralTip({ globalTip: { type: 'amount', value: -50 }, ...daysOf([2000]) })).toBe(0);
    expect(svc.computeGeneralTip({ globalTip: { type: 'percent', value: NaN }, ...daysOf([2000]) })).toBe(0);
  });

  it('type desconocido -> 0', () => {
    expect(svc.computeGeneralTip({ globalTip: { type: 'weird', value: 10 }, ...daysOf([2000]) })).toBe(0);
  });

  it('redondea a 2 decimales sin arrastre de punto flotante (0.5% de 201 = 1.005 -> 1.01)', () => {
    const si = { globalTip: { type: 'percent', value: 0.5 }, ...daysOf([201]) };
    expect(svc.computeGeneralTip(si)).toBe(1.01);
  });
});

describe('QuoteService.sumServiceTipsFromDays (propina por servicio del snapshot)', () => {
  it('suma tipAmount de los servicios activos y excluye includeInTotal:false', () => {
    const si = {
      days: [{
        subconcepts: [
          { tipAmount: 100, includeInTotal: true },
          { tipAmount: 300, includeInTotal: true },
          { tipAmount: 999, includeInTotal: false },
        ],
      }],
    };
    expect(svc.sumServiceTipsFromDays(si)).toBe(400);
  });

  it('ignora tipAmount no finito/negativo; vacío/ausente -> 0', () => {
    expect(svc.sumServiceTipsFromDays({
      days: [{ subconcepts: [{ tipAmount: NaN }, { tipAmount: -5 }, { tipAmount: 50 }] }],
    })).toBe(50);
    expect(svc.sumServiceTipsFromDays({ days: [] })).toBe(0);
    expect(svc.sumServiceTipsFromDays({})).toBe(0);
  });
});
