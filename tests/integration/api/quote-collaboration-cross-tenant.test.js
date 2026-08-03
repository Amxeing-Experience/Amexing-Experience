/**
 * Aislamiento entre agencias en la CONCESIÓN de acceso a cotizaciones — integration.
 *
 * VULNERABILIDAD: `canGrantAccess` autorizaba comparando SOLO el nombre del rol contra un allowlist
 * que incluía 'client' y 'department_manager', sin mirar de qué agencia era la cotización, y nada
 * impedía que el beneficiario fuera el propio solicitante. Con eso, cualquier agente podía
 * auto-concederse un QuoteAccess sobre CUALQUIER cotización.
 *
 * Por qué era grave y no cosmético: ese QuoteAccess se traduce en scope sobre la reservación ligada
 * (ReservationController.getClientEligibleQuoteIds -> applyOwnershipScope -> loadReservation), que es
 * la ÚNICA verificación de autorización de los endpoints de pagos. O sea: leer, registrar, editar y
 * borrar los pagos de un cliente de otra agencia.
 *
 * La transferencia de propiedad era la SEGUNDA puerta al mismo lugar: `canTransferOwnership` traía el
 * mismo allowlist, así que un agente podía hacerse DUEÑO de una cotización ajena — y el dueño tiene
 * scope directo, sin necesidad de colaboradores. Cerrar solo la primera dejaba la casa abierta.
 *
 * Fix: en las dos, quien no es el dueño de la cotización debe ser staff de Amexing (admin/superadmin).
 * NO se compara "la agencia del solicitante contra la de la cotización": en datos reales 62 de 65
 * agencias no tienen departmentId NI clientId, así que ese criterio no se puede evaluar — y en
 * autorización, un criterio que no se puede evaluar no existe.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('cotizaciones: aislamiento entre agencias al conceder acceso (cross-tenant, integration)', () => {
  let app;
  let agencyAToken;
  let agencyAUser; // dueña de la cotización
  let agencyBToken;
  let agencyBUser; // otra agencia, sin relación alguna con esa cotización
  let thirdPartyUser; // beneficiario neutral: ni dueño ni atacante
  let adminToken;
  const created = { quotes: [], users: [] };

  const makeQuoteOwnedByA = async () => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-COLAB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', agencyAUser);
    quote.set('createdBy', agencyAUser);
    quote.set('owner', agencyAUser);
    await quote.save(null, { useMasterKey: true });
    created.quotes.push(quote.id);
    return quote;
  };

  const addCollaborator = (quoteId, agentId, token) => request(app)
    .post(`/api/quotes/${quoteId}/collaborators`)
    .set('Authorization', `Bearer ${token}`)
    .send({ agentId, role: 'viewer' });

  const transferOwnership = (quoteId, newOwnerId, token) => request(app)
    .post(`/api/quotes/${quoteId}/ownership/transfer`)
    .set('Authorization', `Bearer ${token}`)
    .send({ newOwnerId, reason: 'prueba de aislamiento' });

  const accessCountFor = async (quoteId, agentId) => {
    const quotePtr = new Parse.Object('Quote');
    quotePtr.id = quoteId;
    const agentPtr = new Parse.Object('AmexingUser');
    agentPtr.id = agentId;
    const q = new Parse.Query('QuoteAccess');
    q.equalTo('quote', quotePtr);
    q.equalTo('agent', agentPtr);
    return q.count({ useMasterKey: true });
  };

  const ownerIdOf = async (quoteId) => {
    const q = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
    const owner = q.get('owner');
    return owner && owner.id;
  };

  beforeAll(async () => {
    app = require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });

    agencyAToken = await AuthTestHelper.loginAs('department_manager', app);
    agencyAUser = await AuthTestHelper.getUserByRole('department_manager');
    adminToken = await AuthTestHelper.loginAs('admin', app);

    // Agencia B: usuario real y activo, MISMO rol que A (nivel 4, pasa cualquier requireRoleLevel)
    // pero otra identidad y otra organización. Ningún puntero de la cotización de A lo menciona.
    agencyBUser = new Parse.Object('AmexingUser');
    agencyBUser.set('exists', true);
    agencyBUser.set('active', true);
    agencyBUser.set('emailVerified', true);
    agencyBUser.set('role', 'department_manager');
    agencyBUser.set('roleId', agencyAUser.get('roleId'));
    agencyBUser.set('organizationId', 'test-org-colab-agencia-b');
    agencyBUser.set('email', `colab-agencyb-${Date.now()}@test.local`);
    agencyBUser.set('username', agencyBUser.get('email'));
    await agencyBUser.save(null, { useMasterKey: true });
    created.users.push(agencyBUser.id);

    thirdPartyUser = new Parse.Object('AmexingUser');
    thirdPartyUser.set('exists', true);
    thirdPartyUser.set('active', true);
    thirdPartyUser.set('role', 'client');
    thirdPartyUser.set('email', `colab-tercero-${Date.now()}@test.local`);
    thirdPartyUser.set('username', thirdPartyUser.get('email'));
    await thirdPartyUser.save(null, { useMasterKey: true });
    created.users.push(thirdPartyUser.id);

    agencyBToken = jwt.sign(
      {
        userId: agencyBUser.id,
        username: agencyBUser.get('username'),
        email: agencyBUser.get('email'),
        role: 'department_manager',
        roleId: agencyAUser.get('roleId').id,
        organizationId: agencyBUser.get('organizationId'),
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '8h' }
    );
  }, 30000);

  afterAll(async () => {
    for (const quoteId of created.quotes) {
      try {
        const quote = await new Parse.Query('Quote').get(quoteId, { useMasterKey: true });
        await quote.destroy({ useMasterKey: true });
      } catch (err) { /* ya no existe */ }
    }
    for (const userId of created.users) {
      try {
        const user = await new Parse.Query('AmexingUser').get(userId, { useMasterKey: true });
        await user.destroy({ useMasterKey: true });
      } catch (err) { /* ya no existe */ }
    }
  }, 30000);

  // -----------------------------------------------------------------------------------------
  describe('la auto-concesión sobre una cotización ajena', () => {
    it('se rechaza, y NO deja ningún QuoteAccess detrás', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await addCollaborator(quote.id, agencyBUser.id, agencyBToken);

      expect(res.status).toBeGreaterThanOrEqual(400);
      // Lo que de verdad importa no es el código HTTP sino que no exista la fila: es esa fila la que
      // se traduce en scope sobre la reservación y sus pagos.
      expect(await accessCountFor(quote.id, agencyBUser.id)).toBe(0);
    });

    // El beneficiario es un TERCERO, no el dueño actual: conceder acceso al dueño ya se rechaza por
    // otro camino (grantAccess lo comprueba), así que usarlo aquí haría pasar la prueba sin que el
    // fix exista — probaría la guarda equivocada.
    it('tampoco pasa concediéndoselo a un tercero en vez de a sí misma', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await addCollaborator(quote.id, thirdPartyUser.id, agencyBToken);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await accessCountFor(quote.id, thirdPartyUser.id)).toBe(0);
    });
  });

  describe('la segunda puerta: transferir la propiedad', () => {
    it('una agencia ajena no puede hacerse dueña, y el dueño NO cambia', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await transferOwnership(quote.id, agencyBUser.id, agencyBToken);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await ownerIdOf(quote.id)).toBe(agencyAUser.id);
    });
  });

  // La "tercera puerta" señalada en revisión: PUT /api/quotes/:id llega al mismo destino sin pasar por
  // colaboradores ni por transferencia. Los tres eslabones que la revisión cita son CIERTOS (la ruta
  // admite nivel 4; el controller traía el mismo allowlist por nombre de rol; applyChanges escribe
  // cualquier campo sin filtro), pero al intentar explotarlo aparece un CUARTO eslabón que la cadena no
  // contemplaba: QuoteVersioningService.recordEdit vuelve a llamar canEdit por su cuenta, sin override,
  // y lanza. Nunca se llega a applyChanges.
  //
  // Es decir: el acceso cruzado NO era alcanzable por aquí. Lo que el override sí hacía era convertir un
  // rechazo limpio en un 500: dejaba pasar la ejecución para que reventara más adelante, y de paso
  // escribía un log diciendo "override concedido" sobre una petición que terminó denegada.
  //
  // Estas pruebas fijan el comportamiento CORRECTO (403 y nada escrito), no el agujero — porque el
  // agujero no existía. Sin el arreglo, las dos primeras fallan por el código de estado.
  describe('la tercera puerta: editar la cotización directamente', () => {
    const putQuote = (quoteId, body, token) => request(app)
      .put(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    it('una agencia ajena no puede secuestrar el owner, y el dueño NO cambia', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await putQuote(
        quote.id,
        { owner: { __type: 'Pointer', className: 'AmexingUser', objectId: agencyBUser.id } },
        agencyBToken
      );

      // 403 exacto, no ">= 400": con el override, esto salía 500 porque la ejecución avanzaba hasta
      // reventar en recordEdit. Un 500 aquí es un rechazo por accidente, no por decisión.
      expect(res.status).toBe(403);
      expect(await ownerIdOf(quote.id)).toBe(agencyAUser.id);
    });

    it('tampoco puede escribir ningún otro campo de una cotización ajena', async () => {
      const quote = await makeQuoteOwnedByA();
      const folioOriginal = quote.get('folio');

      const res = await putQuote(quote.id, { folio: 'SECUESTRADO', numberOfPeople: 999 }, agencyBToken);

      expect(res.status).toBe(403);
      const despues = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
      expect(despues.get('folio')).toBe(folioOriginal);
      expect(despues.get('numberOfPeople')).toBe(2);
    });
  });

  describe('lo legítimo sigue funcionando (el fix no puede cerrar de más)', () => {
    it('el DUEÑO puede compartir su propia cotización', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await addCollaborator(quote.id, agencyBUser.id, agencyAToken);

      expect(res.status).toBeLessThan(400);
      expect(await accessCountFor(quote.id, agencyBUser.id)).toBe(1);
    });

    it('Amexing (admin) puede compartir cualquier cotización', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await addCollaborator(quote.id, agencyBUser.id, adminToken);

      expect(res.status).toBeLessThan(400);
      expect(await accessCountFor(quote.id, agencyBUser.id)).toBe(1);
    });

    it('el DUEÑO puede editar su propia cotización (la tercera puerta no cierra de más)', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await request(app)
        .put(`/api/quotes/${quote.id}`)
        .set('Authorization', `Bearer ${agencyAToken}`)
        .send({ numberOfPeople: 7 });

      expect(res.status).toBeLessThan(400);
      const despues = await new Parse.Query('Quote').get(quote.id, { useMasterKey: true });
      expect(despues.get('numberOfPeople')).toBe(7);
    });

    it('el DUEÑO puede transferir la propiedad de su propia cotización', async () => {
      const quote = await makeQuoteOwnedByA();

      const res = await transferOwnership(quote.id, agencyBUser.id, agencyAToken);

      expect(res.status).toBeLessThan(400);
      expect(await ownerIdOf(quote.id)).toBe(agencyBUser.id);
    });
  });
});
