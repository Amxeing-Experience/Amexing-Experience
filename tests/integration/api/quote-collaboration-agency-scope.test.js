/**
 * La agencia sobre lo de SUS agentes — integration.
 *
 * Regla de negocio: un department_manager (LA AGENCIA) puede ver y mover todo lo de los agentes de su
 * propia agencia — compartir, revocar, cambiar rol, transferir. Un agente NO puede hacerlo sobre lo de
 * sus compañeros.
 *
 * El vínculo existe y está poblado: la agencia ES el department_manager (no tiene clientId porque ella
 * misma es el destino) y cada agente recibe `clientId = <objectId del manager>` al darse de alta
 * (ClientEmployeesController). El cierre anterior de este PR dejó pasar solo al dueño y a Amexing, lo
 * que bloqueaba a la agencia sobre lo de sus propios agentes; estas pruebas fijan la regla completa.
 *
 * Las tres primeras fallan sin el arreglo. Las de aislamiento pasan en ambos casos: son la regresión
 * que no se puede reabrir.
 */

const request = require('supertest');
const Parse = require('parse/node');
const jwt = require('jsonwebtoken');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('cotizaciones: la agencia manda sobre lo de sus agentes (integration)', () => {
  let app;
  let agencyA; // department_manager, LA agencia
  let agencyAToken;
  let agentA1; // agente de la agencia A, dueño de la cotización
  let agentA2; // compañero del mismo equipo: NO debe poder
  let agentA2Token;
  let agencyB; // otra agencia, sin relación
  let agencyBToken;
  let orphanAgent; // sin clientId: nadie puede reclamarlo
  const created = { quotes: [], users: [] };

  const tokenFor = (user, role) => jwt.sign(
    {
      userId: user.id,
      username: user.get('username'),
      email: user.get('email'),
      role,
      roleId: user.get('roleId') && user.get('roleId').id,
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '8h' }
  );

  const makeUser = async (role, roleIdPointer, extra = {}) => {
    const user = new Parse.Object('AmexingUser');
    user.set('exists', true);
    user.set('active', true);
    user.set('emailVerified', true);
    user.set('role', role);
    if (roleIdPointer) user.set('roleId', roleIdPointer);
    user.set('email', `agencyscope-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`);
    user.set('username', user.get('email'));
    Object.entries(extra).forEach(([k, v]) => user.set(k, v));
    await user.save(null, { useMasterKey: true });
    created.users.push(user.id);
    return user;
  };

  const makeQuoteOwnedBy = async (owner) => {
    const quote = new Parse.Object('Quote');
    quote.set('exists', true);
    quote.set('active', true);
    quote.set('status', 'draft');
    quote.set('folio', `QTE-SCOPE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    quote.set('numberOfPeople', 2);
    quote.set('client', owner);
    quote.set('createdBy', owner);
    quote.set('owner', owner);
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
    .send({ newOwnerId, reason: 'prueba de alcance de agencia' });

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

    const seededManager = await AuthTestHelper.getUserByRole('department_manager');
    const managerRoleId = seededManager.get('roleId');
    const clientRole = await new Parse.Query('Role').equalTo('name', 'client').first({ useMasterKey: true });

    // La agencia no lleva clientId: ella misma ES el destino al que apuntan sus agentes.
    agencyA = await makeUser('department_manager', managerRoleId, { organizationId: 'client' });
    agencyB = await makeUser('department_manager', managerRoleId, { organizationId: 'client' });
    agentA1 = await makeUser('client', clientRole, { clientId: agencyA.id, organizationId: agencyA.id });
    agentA2 = await makeUser('client', clientRole, { clientId: agencyA.id, organizationId: agencyA.id });
    orphanAgent = await makeUser('client', clientRole, { organizationId: 'client' });

    agencyAToken = tokenFor(agencyA, 'department_manager');
    agencyBToken = tokenFor(agencyB, 'department_manager');
    agentA2Token = tokenFor(agentA2, 'client');
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
  describe('lo que la agencia SÍ puede sobre lo de su propio agente', () => {
    it('comparte la cotización de su agente', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);

      const res = await addCollaborator(quote.id, agentA2.id, agencyAToken);

      expect(res.status).toBeLessThan(400);
      expect(await accessCountFor(quote.id, agentA2.id)).toBe(1);
    });

    it('revoca un acceso que ella misma concedió', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);
      await addCollaborator(quote.id, agentA2.id, agencyAToken);

      const res = await request(app)
        .delete(`/api/quotes/${quote.id}/collaborators/${agentA2.id}`)
        .set('Authorization', `Bearer ${agencyAToken}`)
        .send({ reason: 'prueba' });

      expect(res.status).toBeLessThan(400);
    });

    it('transfiere la propiedad de la cotización de su agente', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);

      const res = await transferOwnership(quote.id, agentA2.id, agencyAToken);

      expect(res.status).toBeLessThan(400);
      expect(await ownerIdOf(quote.id)).toBe(agentA2.id);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('lo que sigue cerrado (pasa con y sin el arreglo)', () => {
    it('un AGENTE no puede sobre la cotización de su compañero de equipo', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);

      const res = await addCollaborator(quote.id, agentA2.id, agentA2Token);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await accessCountFor(quote.id, agentA2.id)).toBe(0);
    });

    it('un agente tampoco puede hacerse dueño de lo de su compañero', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);

      const res = await transferOwnership(quote.id, agentA2.id, agentA2Token);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await ownerIdOf(quote.id)).toBe(agentA1.id);
    });

    it('una agencia AJENA no puede sobre el agente de otra agencia', async () => {
      const quote = await makeQuoteOwnedBy(agentA1);

      const res = await addCollaborator(quote.id, agentA2.id, agencyBToken);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await accessCountFor(quote.id, agentA2.id)).toBe(0);
    });

    // El agujero de comparar dos ausencias: si la comparación fuera manager.clientId === agente.clientId,
    // ambos lados serían null y CUALQUIER agencia se creería dueña de CUALQUIER huérfano.
    it('un agente sin clientId no pertenece a nadie: ninguna agencia lo reclama', async () => {
      const quote = await makeQuoteOwnedBy(orphanAgent);

      const res = await addCollaborator(quote.id, agentA2.id, agencyAToken);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await accessCountFor(quote.id, agentA2.id)).toBe(0);
    });
  });
});
