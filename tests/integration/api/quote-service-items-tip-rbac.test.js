/**
 * FIX 1 + FIX 1b: RBAC server-side de la propina en PUT /api/quotes/:id/service-items — integration.
 *
 * El wizard oculta los controles de propina a los no-admin, pero el server persistía
 * globalTip/suggestedTipPct + tipType/tipValue/tipMandatory/tipAmount por subconcepto sin validar rol:
 * un agente (client) / agencia (department_manager) podía FIJAR cualquier propina por API directa.
 * FIX 1: solo admin/superadmin puede fijar/cambiar/quitar la propina; un no-admin únicamente puede
 * REENVIAR la misma propina ya guardada (el wizard la reenvía para no perderla) -> cualquier cambio de
 * propina responde 403 y NO persiste; el resto de la edición de servicios sigue permitida.
 * FIX 1b: el Cliente Directo (end_client) queda bloqueado por completo del endpoint (denyRoles), pese
 * a alcanzar el nivel 4 en el mapa de fallback (que existe para que pueda LEER lo suyo).
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Propina en service-items: RBAC server-side (integration)', () => {
  let app;
  let agentToken; // client = Agente (nivel 5)
  let agencyToken; // department_manager = Agencia (nivel 4)
  let adminToken;
  let superadminToken;
  let endClientToken; // forjado: rol end_client, sin roleId (roleObject null -> fallback nivel 4)
  let endClientUser;
  const created = { quotes: [], users: [] };

  const makeQuote = async (serviceItems, status = 'draft') => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', status);
    quote.set('folio', `QTE-TIPRBAC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('serviceItems', serviceItems);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const fetchSI = async (quoteId) => {
    const q = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
    return q.get('serviceItems');
  };

  const findSub = (si, id) => {
    const days = (si && Array.isArray(si.days)) ? si.days : [];
    for (const d of days) {
      const hit = (d.subconcepts || []).find((s) => s.id === id);
      if (hit) return hit;
    }
    return null;
  };

  // Suma agregada de tipAmount de TODOS los subconceptos (mismo criterio que el motor de dinero) — para
  // afirmar que la propina persistida nunca se duplica.
  const sumTips = (si) => (((si && si.days) || []).reduce(
    (s, d) => s + (d.subconcepts || []).reduce((t, sc) => t + (Number(sc.tipAmount) || 0), 0),
    0
  ));

  const putSI = (quoteId, body, token) => request(app)
    .put(`/api/quotes/${quoteId}/service-items`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  // Subconcepto base "limpio" (efectivo 1000). extra permite inyectar propina o cambiar campos.
  const sub = (id, extra = {}) => ({
    id,
    concept: 'Servicio',
    type: 'concepto',
    pricesByType: { efectivo: 1000, transferencia: 1160, tarjeta: 1210 },
    total: 1000,
    includeInTotal: true,
    ...extra,
  });

  // serviceItems GUARDADO (sin dayTotal; el server lo recalcula). El payload PUT sí lleva dayTotal.
  const storedSI = (subs, extra = {}) => ({
    days: [{ dayNumber: 1, dayTitle: '', subconcepts: subs }],
    subtotal: subs.reduce((s, x) => s + (x.includeInTotal !== false ? x.total : 0), 0),
    iva: 0,
    total: subs.reduce((s, x) => s + (x.includeInTotal !== false ? x.total : 0), 0),
    currency: 'MXN',
    paymentType: 'efectivo',
    ...extra,
  });

  // Payload PUT: total = subtotal + iva (SIN hornear la propina, para no chocar con la consistencia).
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

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    agentToken = await AuthTestHelper.loginAs('client', app);
    agencyToken = await AuthTestHelper.loginAs('department_manager', app);
    adminToken = await AuthTestHelper.loginAs('admin', app);
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);

    // No hay end_client sembrado: se crea un AmexingUser real (activo) y se forja un JWT con rol
    // end_client SIN roleId (roleObject queda null -> requireRoleLevel usa el mapa de fallback,
    // end_client=4). Así el request llega hasta denyRoles('end_client').
    endClientUser = new Parse.Object('AmexingUser');
    endClientUser.set('exists', true);
    endClientUser.set('active', true);
    endClientUser.set('role', 'end_client');
    endClientUser.set('email', `tiprbac-endclient-${Date.now()}@test.local`);
    endClientUser.set('username', endClientUser.get('email'));
    await endClientUser.save(null, { useMasterKey: true });
    created.users.push(endClientUser.id);
    endClientToken = AuthTestHelper.generateTokenForUser({
      id: endClientUser.id,
      username: endClientUser.get('username'),
      email: endClientUser.get('email'),
      role: 'end_client',
    });
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
    for (const userId of created.users) {
      try {
        const u = await new Parse.Query('AmexingUser').get(userId, { useMasterKey: true });
        await u.destroy({ useMasterKey: true });
      } catch (e) { /* already gone */ }
    }
  });

  it('F1-01: Agente FIJA globalTip en cotización sin propina previa -> 403, no persiste', async () => {
    const quote = await makeQuote(storedSI([sub('svc1')]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1')], { globalTip: { type: 'percent', value: 10, mandatory: false } }),
      agentToken
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrador/i);
    const si = await fetchSI(quote.id);
    expect(si.globalTip == null).toBe(true); // nada persistido
  });

  it('F1-02: Agencia SUBE tipValue de un servicio existente -> 403, conserva el valor viejo', async () => {
    const quote = await makeQuote(storedSI([sub('svc1', { tipType: 'percent', tipValue: 10, tipAmount: 100 })]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1', { tipType: 'percent', tipValue: 20, tipAmount: 200 })]),
      agencyToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').tipValue).toBe(10); // intacto
    expect(findSub(si, 'svc1').tipAmount).toBe(100);
  });

  it('F1-03: Agente agrega subconcepto NUEVO con propina en una reservación (scheduled) -> 403 (el hueco real)', async () => {
    const quote = await makeQuote(storedSI([sub('svc1')]), 'scheduled');
    const newSub = sub('svcNew', {
      pricesByType: { efectivo: 500, transferencia: 580, tarjeta: 605 }, total: 500, tipType: 'percent', tipValue: 10, tipAmount: 50,
    });
    const res = await putSI(quote.id, putBody([sub('svc1'), newSub]), agentToken);
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svcNew')).toBeNull(); // el subconcepto nuevo no se persistió
  });

  it('F1-04: admin FIJA globalTip -> 200, persiste', async () => {
    const quote = await makeQuote(storedSI([sub('svc1')]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1')], { globalTip: { type: 'percent', value: 10, mandatory: false } }),
      adminToken
    );
    expect(res.status).toBe(200);
    const si = await fetchSI(quote.id);
    expect(si.globalTip.type).toBe('percent');
    expect(si.globalTip.value).toBe(10);
  });

  it('F1-05: superadmin cambia tipMandatory false->true -> 200', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', {
        tipType: 'percent', tipValue: 10, tipAmount: 100, tipMandatory: false,
      }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1', {
        tipType: 'percent', tipValue: 10, tipAmount: 100, tipMandatory: true,
      })]),
      superadminToken
    );
    expect(res.status).toBe(200);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').tipMandatory).toBe(true);
  });

  it('F1-06: Agente edita SOLO campos no-propina (time) reenviando el tip idéntico -> 200, tip intacto, time actualizado', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', {
        time: '10:00', tipType: 'percent', tipValue: 10, tipAmount: 100,
      }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1', {
        time: '14:30', tipType: 'percent', tipValue: 10, tipAmount: 100,
      })]),
      agentToken
    );
    expect(res.status).toBe(200);
    const si = await fetchSI(quote.id);
    const saved = findSub(si, 'svc1');
    expect(saved.time).toBe('14:30'); // el campo no-propina sí se actualiza
    expect(saved.tipValue).toBe(10); // la propina no se tocó
    expect(saved.tipAmount).toBe(100);
  });

  it('F1-07: Agente reenvía el mismo payload con tip idéntico (no-op) -> 200', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', { tipType: 'amount', tipValue: 250, tipAmount: 250 }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1', { tipType: 'amount', tipValue: 250, tipAmount: 250 })]),
      agentToken
    );
    expect(res.status).toBe(200);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').tipAmount).toBe(250);
  });

  it('F1-08: Agencia baja suggestedTipPct 10->5 -> 403 (suggestedTipPct protegido)', async () => {
    const quote = await makeQuote(storedSI([sub('svc1')], { suggestedTipPct: 10 }));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1')], { suggestedTipPct: 5 }),
      agencyToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(si.suggestedTipPct).toBe(10); // intacto
  });

  it('F1-09: Agente intenta QUITAR un tip existente (tipType:null) -> 403, tip original intacto', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', { tipType: 'percent', tipValue: 10, tipAmount: 100 }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([sub('svc1', { tipType: null, tipValue: 0, tipAmount: 0 })]),
      agentToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').tipType).toBe('percent'); // no se quitó
    expect(findSub(si, 'svc1').tipValue).toBe(10);
  });

  it('FIX 1b: end_client (Cliente Directo) llama PUT service-items -> 403 Insufficient permissions (denyRoles)', async () => {
    const quote = await makeQuote(storedSI([sub('svc1')]));
    const res = await putSI(quote.id, putBody([sub('svc1')]), endClientToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient permissions');
    const si = await fetchSI(quote.id);
    expect(si.globalTip == null).toBe(true); // no tocó nada
  });

  // Council L0F0: subChanged solo revisaba subconceptos PRESENTES en el payload entrante, así que un
  // no-admin podía "quitar" una propina ya guardada por un admin borrando el servicio entero (o
  // reenviándolo con un id vacío/distinto) en vez de editarle el campo — sin disparar el 403.
  it('F1-10: Agente BORRA por completo un servicio con propina (lo omite del payload) -> 403, servicio y propina intactos', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', { tipType: 'amount', tipValue: 50, tipAmount: 50 }),
      sub('svc2'), // sin propina, de relleno
    ]));
    // Payload entrante solo trae svc2 -> svc1 (con propina) desapareció del todo.
    const res = await putSI(quote.id, putBody([sub('svc2')]), agentToken);
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1')).toBeTruthy(); // el servicio sigue existiendo
    expect(findSub(si, 'svc1').tipAmount).toBe(50); // y su propina, intacta
  });

  it('F1-11: Agente reenvía el servicio con propina bajo un id vacío (en vez de editarlo) -> 403, no persiste', async () => {
    const quote = await makeQuote(storedSI([
      sub('svc1', { tipType: 'amount', tipValue: 50, tipAmount: 50 }),
    ]));
    // Mismo contenido, pero con id vacío -> ya no empareja con svc1 al comparar.
    const res = await putSI(quote.id, putBody([sub('', { tipType: null, tipValue: 0, tipAmount: 0 })]), agentToken);
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svc1').tipAmount).toBe(50);
  });

  // Council (round-trip split): la detección de cambio de propina compara la SUMA AGREGADA de tipAmount,
  // sin emparejar por id. Un split ida-vuelta reparte la propina de un servicio (id reutilizado para Ida +
  // id nuevo para Vuelta) conservando la suma total; empatar por id daba un falso 403 (el id existente baja
  // de 200 a 100 y el id nuevo aporta 100 "sin previo") pese a que la suma no cambia (100+100=200).
  it('F1-12: Agente convierte un servicio con propina en round-trip (split 200 -> 100+100, suma igual) -> 200; ambas piernas persisten con tipAmount 100', async () => {
    const quote = await makeQuote(storedSI([
      sub('rt1', { tipType: 'amount', tipValue: 200, tipAmount: 200 }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([
        sub('rt1', { tipType: 'amount', tipValue: 100, tipAmount: 100 }),
        sub('rt1-new', { tipType: 'amount', tipValue: 100, tipAmount: 100 }),
      ]),
      agentToken
    );
    expect(res.status).toBe(200); // ya NO 403: la suma de propina no cambió (100 + 100 = 200)
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'rt1').tipAmount).toBe(100);
    expect(findSub(si, 'rt1-new').tipAmount).toBe(100);
  });

  // Comportamiento ACEPTADO y documentado (NO es el foco de este fix): el criterio de suma agregada
  // permite redistribuir propina entre 2 servicios DISTINTOS mientras el total no cambie. No es un split
  // legítimo, pero tampoco altera cuánto se cobra de propina en la reservación; bloquearlo exigiría volver
  // a emparejar por id (justo lo que causaba el falso 403 del round-trip). Se deja pasar a conciencia.
  it('F1-13: Agente sube la propina de un servicio y baja la de otro por el mismo monto (suma igual) -> 200 (aceptado por suma agregada)', async () => {
    const quote = await makeQuote(storedSI([
      sub('svcA', { tipType: 'amount', tipValue: 100, tipAmount: 100 }),
      sub('svcB', { tipType: 'amount', tipValue: 100, tipAmount: 100 }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([
        sub('svcA', { tipType: 'amount', tipValue: 150, tipAmount: 150 }),
        sub('svcB', { tipType: 'amount', tipValue: 50, tipAmount: 50 }),
      ]),
      agentToken
    );
    expect(res.status).toBe(200);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'svcA').tipAmount).toBe(150);
    expect(findSub(si, 'svcB').tipAmount).toBe(50);
  });

  // Council (bypass via id duplicado + dedup keep-first): el guard tipFieldsChanged corría sobre el
  // payload CRUDO, antes de sortAndCleanServiceDays (que deduplica por id manteniendo SOLO la primera
  // ocurrencia). Un no-admin mandaba, en el mismo día, DOS subconceptos con el MISMO id: el primero con
  // tip 0 y el segundo con el tip real (500). El guard sumaba ambas ocurrencias (0 + 500 = 500 = lo
  // guardado) -> no bloqueaba; pero al persistir, el dedup dejaba solo la PRIMERA (tip 0) -> la propina
  // fijada por un admin bajaba a 0 sin 403. Fix: deduplicar ANTES del guard, así ambas ocurrencias
  // colapsan en una sola (la primera, tip 0) y el guard ve sum 0 != 500 -> 403, sin persistir nada.
  it('F1-14: Agente baja una propina admin (500->0) mandando 2 subconceptos con el MISMO id (tip 0 primero) -> 403, propina intacta', async () => {
    const quote = await makeQuote(storedSI([
      sub('A', { tipType: 'amount', tipValue: 500, tipAmount: 500 }),
    ]));
    const res = await putSI(
      quote.id,
      putBody([
        sub('A', { tipType: 'amount', tipValue: 0, tipAmount: 0 }),
        sub('A', { tipType: 'amount', tipValue: 500, tipAmount: 500 }),
      ]),
      agentToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    // Nada se persistió: sigue habiendo un solo 'A' con su propina original de 500 (nunca 0).
    expect(findSub(si, 'A').tipAmount).toBe(500);
  });

  // Council (bypass RBAC de propina via decoy + restauración): el guard tipFieldsChanged corría sobre los
  // días DEDUPLICADOS pero ANTES del bloqueo por-servicio. Un no-admin ponía en $0 la propina de un
  // servicio PROTEGIDO (adminLocked, con propina fijada por un admin) y "la movía" a un servicio NUEVO
  // (decoy) con el mismo monto: la suma agregada pre-restauración (0 del protegido + 500 del decoy = 500)
  // cuadraba con lo guardado -> el guard no bloqueaba (200). Pero la restauración revertía el protegido a
  // su tip real (500) y el decoy, al no estar protegido, sobrevivía con sus 500 -> la propina persistida
  // quedaba en 1000 (el DOBLE) sin que ningún admin la aprobara. Fix: el guard corre DESPUÉS del bloqueo,
  // sobre el contenido restaurado -> ve 500 (protegido) + 500 (decoy) = 1000 != 500 -> 403, sin persistir.
  it('F1-15: Agente pone en $0 la propina de un servicio PROTEGIDO (adminLocked) y la "mueve" a un decoy nuevo (mismo monto) -> 403, propina NO se duplica', async () => {
    const quote = await makeQuote(storedSI([
      sub('P', { adminLocked: true, tipType: 'amount', tipValue: 500, tipAmount: 500 }),
    ]));
    // Decoy NUEVO sin precio (total 0) pero con propina 500, para aislar el mecanismo de la propina.
    const decoy = sub('decoy', {
      pricesByType: { efectivo: 0, transferencia: 0, tarjeta: 0 },
      total: 0,
      tipType: 'amount',
      tipValue: 500,
      tipAmount: 500,
    });
    const res = await putSI(
      quote.id,
      putBody([sub('P', { tipType: 'amount', tipValue: 0, tipAmount: 0 }), decoy]),
      agentToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    // El servicio protegido conserva su propina original; el decoy nunca se persistió.
    expect(findSub(si, 'P').tipAmount).toBe(500);
    expect(findSub(si, 'decoy')).toBeNull();
    // La suma de propina persistida sigue siendo 500 (original), jamás 1000 (duplicada).
    expect(sumTips(si)).toBe(500);
  });

  it('F1-16: mismo ataque decoy pero el servicio protegido lo es por ser reservación (scheduled), no por adminLocked -> 403, sin duplicar', async () => {
    const quote = await makeQuote(storedSI([
      sub('P', { tipType: 'amount', tipValue: 500, tipAmount: 500 }),
    ]), 'scheduled');
    const decoy = sub('decoy', {
      pricesByType: { efectivo: 0, transferencia: 0, tarjeta: 0 },
      total: 0,
      tipType: 'amount',
      tipValue: 500,
      tipAmount: 500,
    });
    const res = await putSI(
      quote.id,
      putBody([sub('P', { tipType: 'amount', tipValue: 0, tipAmount: 0 }), decoy]),
      agentToken
    );
    expect(res.status).toBe(403);
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'P').tipAmount).toBe(500);
    expect(findSub(si, 'decoy')).toBeNull();
    expect(sumTips(si)).toBe(500);
  });

  // Contra-prueba del round-trip legítimo tras mover el guard post-enforcement: reenviar la MISMA propina
  // agregada reordenando/renombrando ids de servicios NO protegidos debe seguir en 200 (no reintroducir el
  // falso 403 que ya se corrigió). Los ids del payload (legA/legB) ni siquiera coinciden con el guardado
  // (rt1): lo único que importa es que la suma agregada de propina no cambie.
  it('F1-17: Agente reparte la MISMA propina agregada entre ids NO protegidos renombrados/reordenados -> 200; ambas piernas persisten', async () => {
    const quote = await makeQuote(storedSI([
      sub('rt1', { tipType: 'amount', tipValue: 200, tipAmount: 200 }),
    ]));
    const leg = (id) => sub(id, {
      pricesByType: { efectivo: 500, transferencia: 580, tarjeta: 605 },
      total: 500,
      tipType: 'amount',
      tipValue: 100,
      tipAmount: 100,
    });
    const res = await putSI(quote.id, putBody([leg('legB'), leg('legA')]), agentToken);
    expect(res.status).toBe(200); // la suma de propina no cambió (100 + 100 = 200)
    const si = await fetchSI(quote.id);
    expect(findSub(si, 'legA').tipAmount).toBe(100);
    expect(findSub(si, 'legB').tipAmount).toBe(100);
    expect(findSub(si, 'rt1')).toBeNull(); // el id viejo se renombró; no hay duplicado fantasma
    expect(sumTips(si)).toBe(200);
    expect(si.subtotal).toBe(1000); // subtotal recomputado desde el contenido real (500 + 500)
  });
});
