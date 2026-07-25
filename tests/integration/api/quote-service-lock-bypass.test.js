/**
 * Bypass del bloqueo por-servicio via PRICE_MISMATCH_TOLERANCE (council L2F0/L5F1) — integration.
 *
 * evaluateTotalsConsistency SOLO valida que el payload sea autoconsistente contra SUS PROPIOS days,
 * antes de que el bloqueo por-servicio restaure el contenido protegido. Un no-admin puede mandar un
 * payload fabricado (subtotal/total a juego con un precio de servicio protegido alterado) que pasa esa
 * validación, y aun cuando el bloqueo restaura el subconcepto real, subtotal/total NO se recalculaban
 * desde el contenido restaurado — se persistía el número fabricado (el "tercer total" reintroducido).
 * Fix: tras `serviceItems.days = enforcedDays`, subtotal/total se re-derivan del contenido restaurado.
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Bloqueo por-servicio: subtotal/total se recalculan desde el contenido restaurado (integration)', () => {
  let app;
  let agencyToken;
  let agencyUser; // department_manager seeded — client pointer de las quotes (aislamiento entre agencias)
  const created = { quotes: [] };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    agencyToken = await AuthTestHelper.loginAs('department_manager', app);
    agencyUser = await AuthTestHelper.getUserByRole('department_manager');
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  it('un payload autoconsistente pero manipulado por un no-admin NO logra persistir un subtotal/total falsos', async () => {
    // status: 'scheduled' => isReservation=true => CUALQUIER servicio existente queda protegido
    // (no requiere adminLocked explícito), igual que una cotización ya convertida a reservación.
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'scheduled');
    quote.set('folio', `QTE-LOCK-${Date.now()}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyUser); // la agencia que edita es dueña (aislamiento entre agencias)
    const realSub = {
      id: 'svc1',
      concept: 'Servicio real',
      type: 'concepto',
      pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
      total: 1000,
      includeInTotal: true,
    };
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: 'Día 1', subconcepts: [realSub] }],
      subtotal: 1000,
      iva: 0,
      total: 1000,
      currency: 'MXN',
      paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);

    // Payload manipulado: MISMO id (svc1) pero con precio fabricado a $1, autoconsistente consigo
    // mismo (subtotal/día/subconcepto todos cuadran entre sí en $1) -- pasa evaluateTotalsConsistency,
    // que no conoce el precio REAL ($1000) hasta que el bloqueo por-servicio lo restaura después.
    const tamperedSub = {
      id: 'svc1',
      concept: 'Servicio real',
      type: 'concepto',
      pricesByType: { efectivo: 1, transferencia: 1, tarjeta: 1 },
      total: 1,
      includeInTotal: true,
    };
    const res = await request(app)
      .put(`/api/quotes/${quote.id}/service-items`)
      .set('Authorization', `Bearer ${agencyToken}`)
      .send({
        days: [{
          dayNumber: 1, dayTitle: 'Día 1', dayTotal: 1, subconcepts: [tamperedSub],
        }],
        subtotal: 1,
        iva: 0,
        total: 1,
        currency: 'MXN',
        paymentType: 'efectivo',
      });

    // El payload autoconsistente NO se rechaza (nada en evaluateTotalsConsistency lo detecta solo).
    expect(res.status).toBe(200);

    const after = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
    const si = after.get('serviceItems');
    const savedSub = si.days[0].subconcepts.find((s) => s.id === 'svc1');

    // El bloqueo por-servicio restaura el precio REAL del subconcepto...
    expect(savedSub.total).toBe(1000);
    expect(savedSub.pricesByType.efectivo).toBe(1000);
    // ...y subtotal/total DEBEN reflejar ese precio restaurado, NUNCA el $1 fabricado.
    expect(si.subtotal).toBe(1000);
    expect(si.total).toBe(1000);
  });

  // "Cuarto total" (council MEDIUM): el recálculo de subtotal/total desde el contenido real vivía dentro
  // de `if (storedLockedById.size > 0)`, así que una cotización SIN ningún servicio protegido persistía el
  // subtotal/total tal cual venían del payload. Un no-admin podía mandar un subtotal/total que NO cuadran
  // con la suma real de los subconceptos pero que pasa evaluateTotalsConsistency (subtotal dentro de la
  // tolerancia de $1; `total` que esa validación no limita) -> el header mostraba un número y el motor de
  // pagos calculaba otro. Fix: el recálculo corre SIEMPRE, con o sin servicios protegidos.
  it('cotización SIN servicios protegidos: subtotal/total se recalculan desde el contenido real, ignorando los del payload', async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft'); // draft + sin adminLocked => NINGÚN servicio protegido
    quote.set('folio', `QTE-LOCK0-${Date.now()}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyUser); // la agencia que edita es dueña (aislamiento entre agencias)
    quote.set('serviceItems', {
      days: [{
        dayNumber: 1,
        dayTitle: 'Día 1',
        subconcepts: [{
          id: 'svcX',
          concept: 'Servicio',
          type: 'concepto',
          pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
          total: 1000,
          includeInTotal: true,
        }],
      }],
      subtotal: 1000,
      iva: 0,
      total: 1000,
      currency: 'MXN',
      paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);

    // Contenido real: un único servicio de $1000 (dayTotal cuadra con él). Pero subtotal (1000.75, dentro
    // de la tolerancia de $1 de evaluateTotalsConsistency) y total (5000, que esa validación NO limita)
    // vienen fabricados y no cuadran con la suma real.
    const res = await request(app)
      .put(`/api/quotes/${quote.id}/service-items`)
      .set('Authorization', `Bearer ${agencyToken}`)
      .send({
        days: [{
          dayNumber: 1,
          dayTitle: 'Día 1',
          dayTotal: 1000,
          subconcepts: [{
            id: 'svcX',
            concept: 'Servicio',
            type: 'concepto',
            pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
            total: 1000,
            includeInTotal: true,
          }],
        }],
        subtotal: 1000.75,
        iva: 0,
        total: 5000,
        currency: 'MXN',
        paymentType: 'efectivo',
      });

    // El payload es autoconsistente contra sus days (dentro de tolerancia) -> no se rechaza.
    expect(res.status).toBe(200);

    const after = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
    const si = after.get('serviceItems');
    // subtotal/total recomputados desde el contenido real ($1000), NUNCA el 1000.75 / 5000 fabricados.
    expect(si.subtotal).toBe(1000);
    expect(si.total).toBe(1000);
  });

  // Regresión "Pago externo" (includeInTotal:false): el chequeo por-DÍA (dayTotal) sumaba el total de
  // TODOS los subconceptos del día sin excluir los includeInTotal:false, a diferencia de
  // evaluateTotalsConsistency. El wizard (quote-services-v2.saveToBackend) manda un dayTotal que YA
  // excluye los "Pago externo", así que la comparación divergía por el monto completo del externo y
  // rechazaba con 400 todo guardado que llevara uno. Fix: el reduce del dayTotal excluye
  // includeInTotal:false, igual que el resto del motor.
  it('un día con un servicio "Pago externo" (includeInTotal:false) y dayTotal que lo excluye se ACEPTA (200), no se rechaza por el chequeo de día', async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft'); // sin servicios protegidos
    quote.set('folio', `QTE-EXT-${Date.now()}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyUser);
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: 'Día 1', subconcepts: [] }],
      subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);

    const normalSub = {
      id: 'norm1', concept: 'Traslado', type: 'concepto',
      pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
      total: 1000, includeInTotal: true,
    };
    const externalSub = {
      id: 'ext1', concept: 'Pago externo', type: 'concepto',
      pricesByType: { efectivo: 2000, transferencia: 2000, tarjeta: 2000 },
      total: 2000, includeInTotal: false,
    };

    const res = await request(app)
      .put(`/api/quotes/${quote.id}/service-items`)
      .set('Authorization', `Bearer ${agencyToken}`)
      .send({
        days: [{
          dayNumber: 1, dayTitle: 'Día 1', dayTotal: 1000, // excluye el externo (1000, no 3000)
          subconcepts: [normalSub, externalSub],
        }],
        subtotal: 1000, iva: 0, total: 1000, currency: 'MXN', paymentType: 'efectivo',
      });

    // Antes del fix: 400 "El total del día 1 ($1000) no coincide con la suma de subconceptos ($3000)".
    expect(res.status).toBe(200);

    const after = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
    const si = after.get('serviceItems');
    // El externo se conserva pero NO cuenta para subtotal/total del header.
    expect(si.subtotal).toBe(1000);
    expect(si.total).toBe(1000);
    const savedExt = si.days[0].subconcepts.find((s) => s.id === 'ext1');
    expect(savedExt).toBeTruthy();
    expect(savedExt.includeInTotal).toBe(false);
  });

  it('control: un dayTotal que no cuadra NI excluyendo el "Pago externo" SIGUE rechazando con 400 (la validación sigue siendo real)', async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-EXT0-${Date.now()}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyUser);
    quote.set('serviceItems', {
      days: [{ dayNumber: 1, dayTitle: 'Día 1', subconcepts: [] }],
      subtotal: 0, iva: 0, total: 0, currency: 'MXN', paymentType: 'efectivo',
    });
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);

    const res = await request(app)
      .put(`/api/quotes/${quote.id}/service-items`)
      .set('Authorization', `Bearer ${agencyToken}`)
      .send({
        days: [{
          dayNumber: 1, dayTitle: 'Día 1', dayTotal: 500, // debería ser 1000 excluyendo el externo
          subconcepts: [
            {
              id: 'norm1', concept: 'Traslado', type: 'concepto',
              pricesByType: { efectivo: 1000 }, total: 1000, includeInTotal: true,
            },
            {
              id: 'ext1', concept: 'Pago externo', type: 'concepto',
              pricesByType: { efectivo: 2000 }, total: 2000, includeInTotal: false,
            },
          ],
        }],
        subtotal: 1000, iva: 0, total: 1000, currency: 'MXN', paymentType: 'efectivo',
      });

    expect(res.status).toBe(400);
    // El error viene del chequeo por-día y su suma esperada EXCLUYE el externo ($1000, no $3000).
    expect(res.body.error).toMatch(/no coincide con la suma de subconceptos/);
    expect(res.body.error).toContain('$1000');
    expect(res.body.error).not.toContain('$3000');
  });
});
