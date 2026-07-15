/**
 * PaymentBreakdownHelpers — unit tests (Fase 3).
 *
 * Cubre TODA la matriz de "Lógica" de test-designer sobre el módulo compartido puro que consumen
 * las 3 plantillas booking-detail.ejs: comparativo por método (incluyendo $0 legítimo vs ausente vs
 * Infinity/NaN/string corrupto y el fix de paridad Number.isFinite), badge automático, badge de
 * estado, propina por servicio en ambas variantes (admin con ficha de personal, agencia sin ella,
 * bucket general, huérfano fusionado, tip no finito excluido), moneda MXN vs USD, 0 servicios, y
 * que el redondeo a efectivo solo aplica en MXN. TestEnvironment 'node', sin DOM.
 */

const H = require('../../../../../../src/presentation/views/dashboards/shared/paymentBreakdownHelpers');

describe('PaymentBreakdownHelpers.getServicePriceByType', () => {
  it('lee el precio del método desde pricesByType (valor ya aprobado)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 121 } } }, 'tarjeta')).toBe(121);
  });

  it('acepta un $0 legítimo del método (0 != ausente)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 0 } }, total: 99 }, 'tarjeta')).toBe(0);
  });

  it('cae al fallback total cuando el método está ausente', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { efectivo: 100 } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('FIX Number.isFinite: Infinity en pricesByType cae al fallback, nunca pinta $Infinity', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: Infinity } }, total: 50 }, 'tarjeta')).toBe(50);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: -Infinity } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('NaN o string corrupto en pricesByType caen al fallback', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: NaN } }, total: 50 }, 'tarjeta')).toBe(50);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: { tarjeta: 'abc' } }, total: 50 }, 'tarjeta')).toBe(50);
  });

  it('un total no finito también se guarda a 0 (paridad con el servidor)', () => {
    expect(H.getServicePriceByType({ subconcept: { pricesByType: {} }, total: Infinity }, 'tarjeta')).toBe(0);
    expect(H.getServicePriceByType({ subconcept: { pricesByType: {} }, total: 'x' }, 'tarjeta')).toBe(0);
  });

  it('un servicio excluido del total devuelve 0', () => {
    expect(H.getServicePriceByType({ subconcept: { includeInTotal: false, pricesByType: { tarjeta: 99 } } }, 'tarjeta')).toBe(0);
  });

  it('sin subconcept usa total finito o 0', () => {
    expect(H.getServicePriceByType({ total: 42 }, 'tarjeta')).toBe(42);
    expect(H.getServicePriceByType(null, 'tarjeta')).toBe(0);
  });
});

describe('PaymentBreakdownHelpers.computeServicesSubtotalByType (comparativo 3 métodos)', () => {
  const services = [
    { subconcept: { pricesByType: { efectivo: 100, transferencia: 116, tarjeta: 121 } } },
    { subconcept: { pricesByType: { efectivo: 50, transferencia: 58, tarjeta: 60 } } },
  ];

  it('suma el precio de cada servicio por método', () => {
    expect(H.computeServicesSubtotalByType(services, 'transferencia', 'MXN')).toBe(174);
    expect(H.computeServicesSubtotalByType(services, 'tarjeta', 'MXN')).toBe(181);
  });

  it('efectivo en MXN se redondea a múltiplo de 5', () => {
    // 100 + 50 = 150 (ya múltiplo de 5) -> 150; con centavos se redondea.
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo', 'MXN')).toBe(100);
  });

  it('efectivo en USD NUNCA se redondea a múltiplo de 5 (cashRound solo MXN)', () => {
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo', 'USD')).toBe(103);
  });

  it('moneda ausente asume MXN (redondea efectivo)', () => {
    expect(H.computeServicesSubtotalByType([{ subconcept: { pricesByType: { efectivo: 103 } } }], 'efectivo')).toBe(100);
  });

  it('0 servicios devuelve 0', () => {
    expect(H.computeServicesSubtotalByType([], 'tarjeta', 'MXN')).toBe(0);
    expect(H.computeServicesSubtotalByType(null, 'tarjeta', 'MXN')).toBe(0);
  });

  it('un método con Infinity corrupto en un servicio no contamina el total (cae al fallback)', () => {
    const corrupt = [
      { subconcept: { pricesByType: { tarjeta: Infinity } }, total: 60 },
      { subconcept: { pricesByType: { tarjeta: 121 } } },
    ];
    expect(H.computeServicesSubtotalByType(corrupt, 'tarjeta', 'MXN')).toBe(181);
  });
});

describe('PaymentBreakdownHelpers.getPaymentStatusBadge', () => {
  it('renderiza los 4 estados con su clase', () => {
    expect(H.getPaymentStatusBadge('pending')).toContain('Pendiente de pago');
    expect(H.getPaymentStatusBadge('pending')).toContain('bg-secondary text-white');
    expect(H.getPaymentStatusBadge('partial')).toContain('Pago parcial');
    expect(H.getPaymentStatusBadge('partial')).toContain('bg-warning text-dark');
    expect(H.getPaymentStatusBadge('paid')).toContain('Pagado');
    expect(H.getPaymentStatusBadge('paid')).toContain('bg-success text-white');
    expect(H.getPaymentStatusBadge('refunded')).toContain('Reembolsado');
    expect(H.getPaymentStatusBadge('refunded')).toContain('bg-info text-white');
  });

  it('un estado desconocido cae al fallback bg-secondary con su propio texto', () => {
    const html = H.getPaymentStatusBadge('weird');
    expect(html).toContain('bg-secondary text-white');
    expect(html).toContain('>weird<');
  });

  it('null/undefined/"" devuelven string vacío', () => {
    expect(H.getPaymentStatusBadge(null)).toBe('');
    expect(H.getPaymentStatusBadge(undefined)).toBe('');
    expect(H.getPaymentStatusBadge('')).toBe('');
  });
});

describe('PaymentBreakdownHelpers.hasAutoReconciliationBadge', () => {
  it('true solo para source === payment-method-reconciliation', () => {
    expect(H.hasAutoReconciliationBadge({ source: 'payment-method-reconciliation' })).toBe(true);
  });

  it('false para ajustes manuales (source ausente/null/""/otro valor)', () => {
    expect(H.hasAutoReconciliationBadge({})).toBe(false);
    expect(H.hasAutoReconciliationBadge({ source: null })).toBe(false);
    expect(H.hasAutoReconciliationBadge({ source: '' })).toBe(false);
    expect(H.hasAutoReconciliationBadge({ source: 'manual' })).toBe(false);
    expect(H.hasAutoReconciliationBadge(null)).toBe(false);
    expect(H.hasAutoReconciliationBadge(undefined)).toBe(false);
  });
});

describe('PaymentBreakdownHelpers.groupTipEntriesForDisplay', () => {
  const services = [
    { id: 'a', concept: 'Traslado aeropuerto', assignedDriver: { fullName: 'Juan Pérez' } },
    { id: 'b', concept: 'Tour centro', assignedGuide: { fullName: 'Ana Ruiz' } },
    { id: 'c', concept: 'Recepción' },
  ];

  it('variante admin (includeStaff): adjunta el responsable del servicio', () => {
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: 'a', tip: 200 }], services, { includeStaff: true });
    expect(entries).toEqual([{
      serviceId: 'a',
      isGeneral: false,
      label: 'Traslado aeropuerto',
      tip: 200,
      staff: [{
        icon: 'ti-steering-wheel', colorClass: 'info', roleLabel: 'Conductor', name: 'Juan Pérez',
      }],
    }]);
  });

  it('variante admin: servicio SIN responsable devuelve staff vacío (la plantilla pinta "Sin responsable")', () => {
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: 'c', tip: 40 }], services, { includeStaff: true });
    expect(entries[0].staff).toEqual([]);
    expect(entries[0].isGeneral).toBe(false);
  });

  it('mapea guía (map-pin/success) y greeter (hand-stop/warning) al ícono/color correcto', () => {
    const svc = [{
      id: 'z', concept: 'Full', assignedGuide: { fullName: 'G' }, assignedGreeter: { fullName: 'R' },
    }];
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: 'z', tip: 10 }], svc, { includeStaff: true });
    expect(entries[0].staff).toEqual([
      {
        icon: 'ti-map-pin', colorClass: 'success', roleLabel: 'Guia', name: 'G',
      },
      {
        icon: 'ti-hand-stop', colorClass: 'warning', roleLabel: 'Greeter', name: 'R',
      },
    ]);
  });

  it('variante agencia (includeStaff false): solo nombre + monto, sin ficha de personal', () => {
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: 'a', tip: 200 }], services, { includeStaff: false });
    expect(entries).toEqual([{
      serviceId: 'a', isGeneral: false, label: 'Traslado aeropuerto', tip: 200, staff: [],
    }]);
  });

  it('el bucket null es la propina general (sin servicio)', () => {
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: null, tip: 300 }], services, {});
    expect(entries).toEqual([{
      serviceId: null, isGeneral: true, label: H.GENERAL_TIP_LABEL, tip: 300, staff: [],
    }]);
  });

  it('un reservationServiceId huérfano (servicio inexistente) se FUSIONA al bucket general, nunca se pierde', () => {
    const entries = H.groupTipEntriesForDisplay([
      { reservationServiceId: 'ghost', tip: 50 },
      { reservationServiceId: null, tip: 300 },
    ], services, {});
    expect(entries).toEqual([{
      serviceId: null, isGeneral: true, label: H.GENERAL_TIP_LABEL, tip: 350, staff: [],
    }]);
  });

  it('las entradas de servicio van en orden de `services`, y el general al final', () => {
    const entries = H.groupTipEntriesForDisplay([
      { reservationServiceId: 'b', tip: 30 },
      { reservationServiceId: 'a', tip: 20 },
      { reservationServiceId: null, tip: 10 },
    ], services, { includeStaff: false });
    expect(entries.map((e) => e.serviceId)).toEqual(['a', 'b', null]);
  });

  it('acumula varios buckets del mismo servicio', () => {
    const entries = H.groupTipEntriesForDisplay([
      { reservationServiceId: 'a', tip: 20 },
      { reservationServiceId: 'a', tip: 15 },
    ], services, { includeStaff: false });
    expect(entries).toEqual([{
      serviceId: 'a', isGeneral: false, label: 'Traslado aeropuerto', tip: 35, staff: [],
    }]);
  });

  it('un tip no finito (Infinity/NaN) se trata como 0 y la entrada se omite', () => {
    expect(H.groupTipEntriesForDisplay([{ reservationServiceId: 'a', tip: Infinity }], services, {})).toEqual([]);
    expect(H.groupTipEntriesForDisplay([{ reservationServiceId: null, tip: NaN }], services, {})).toEqual([]);
  });

  it('reservación con 0 servicios: un bucket con servicio se trata como huérfano -> general', () => {
    const entries = H.groupTipEntriesForDisplay([{ reservationServiceId: 'a', tip: 100 }], [], {});
    expect(entries).toEqual([{
      serviceId: null, isGeneral: true, label: H.GENERAL_TIP_LABEL, tip: 100, staff: [],
    }]);
  });

  it('tipByService vacío o no-array devuelve []', () => {
    expect(H.groupTipEntriesForDisplay([], services, {})).toEqual([]);
    expect(H.groupTipEntriesForDisplay(null, services, {})).toEqual([]);
    expect(H.groupTipEntriesForDisplay(undefined, undefined, undefined)).toEqual([]);
  });

  it('la suma de las entradas mostradas == el total de propina (nunca se pierde dinero)', () => {
    const buckets = [
      { reservationServiceId: 'a', tip: 200 },
      { reservationServiceId: 'ghost', tip: 50 },
      { reservationServiceId: null, tip: 300 },
    ];
    const entries = H.groupTipEntriesForDisplay(buckets, services, {});
    const shown = entries.reduce((s, e) => s + e.tip, 0);
    const real = buckets.reduce((s, b) => s + b.tip, 0);
    expect(shown).toBe(real);
  });
});
