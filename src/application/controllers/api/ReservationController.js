/**
 * ReservationController - API controller for reservation management.
 *
 * Handles CRUD operations for reservations created when quotes
 * are confirmed ("Agendado"). Supports DataTables server-side
 * processing, employee assignment, and service status updates.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const FileStorageService = require('../../services/FileStorageService');
const PaymentService = require('../../services/PaymentService');
// Models used via Parse.Query string references

// Module-level FileStorageService for presigned S3 URLs (static class needs this)
const fileStorageService = new FileStorageService({
  baseFolder: 'vehicles',
  isPublic: false,
  presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
});

/**
 * ReservationController - API controller for reservation management.
 */
class ReservationController {
  /**
   * Fetch an object by id, returning null when it does not exist instead of throwing.
   * Parse's Query.get() throws OBJECT_NOT_FOUND (101) for missing/invalid ids; without
   * this the surrounding catch blocks turn a legitimate "not found" into a 500.
   * @param {Parse.Query} query - Configured query (includes/constraints already set).
   * @param {string} id - ObjectId to fetch.
   * @returns {Promise<Parse.Object|null>} The object, or null if not found.
   * @example
   */
  static async safeGet(query, id) {
    try {
      return await query.get(id, { useMasterKey: true });
    } catch (error) {
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the clientPtr-based visibility filter for reservations (DM and default roles).
   * Returns null for admin/superadmin (see all) and for clients (which are scoped by quote
   * ownership via getClientEligibleQuoteIds + applyQuoteConstraint instead).
   * @param {object} req - Express request with user info from JWT middleware.
   * @returns {object|null} { field: 'clientPtr', pointers: Array } for containedIn, or null.
   * @example
   */
  static async getRoleFilterPointers(req) {
    const { userRole } = req;
    const currentUser = req.user;

    // Admins and superadmins see all reservations
    if (userRole === 'superadmin' || userRole === 'admin') {
      return null;
    }

    // Department managers see reservations for clients in their department (filtered by clientPtr)
    if (userRole === 'department_manager') {
      const userDepartmentId = currentUser.departmentId || currentUser.get('departmentId');

      if (userDepartmentId) {
        const departmentUsersQuery = new Parse.Query('AmexingUser');
        departmentUsersQuery.equalTo('departmentId', userDepartmentId);
        departmentUsersQuery.equalTo('exists', true);
        departmentUsersQuery.equalTo('active', true);
        const departmentUsers = await departmentUsersQuery.find({ useMasterKey: true });

        if (departmentUsers.length > 0) {
          logger.info('Applied department filter to reservations query (clientPtr)', {
            userId: currentUser.id,
            departmentId: userDepartmentId,
            departmentUsersCount: departmentUsers.length,
          });
          return {
            field: 'clientPtr',
            pointers: departmentUsers.map((user) => ({
              __type: 'Pointer',
              className: 'AmexingUser',
              objectId: user.id,
            })),
          };
        }
      }

      // Fallback: only reservations where they are the client
      logger.warn('Department manager missing departmentId, restricting to own reservations', {
        userId: currentUser.id,
      });
      return {
        field: 'clientPtr',
        pointers: [{ __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id }],
      };
    }

    // Clients are scoped by quote ownership, which lives on the quote (quotePtr), not on the
    // reservation. That scoping is applied via the quote subquery inside applyQuoteConstraint
    // (see getClientEligibleQuoteIds) so it composes with the hold/type filter through a
    // SINGLE matchesQuery on quotePtr (two separate constraints on quotePtr overwrite each
    // other). Therefore no clientPtr filter is returned here.
    if (userRole === 'client') {
      return null;
    }

    // Default (employee/driver/guest): only reservations where they are the client
    return {
      field: 'clientPtr',
      pointers: [{ __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id }],
    };
  }

  /**
   * Compute the quote ids a client may see: quotes they currently own (creator = initial
   * owner, updated on transfer), legacy quotes without an owner pointer that they created,
   * or quotes explicitly shared with them via collaboration (QuoteAccess). Reservations are
   * then scoped to these quotes (through quotePtr). Returns null for non-client roles.
   * @param {object} req - Express request with user info from JWT middleware.
   * @returns {Array<string>|null} Eligible quote ids for clients, or null for other roles.
   */
  static async getClientEligibleQuoteIds(req) {
    const { userRole } = req;
    const currentUser = req.user;
    if (userRole !== 'client') {
      return null;
    }

    const mePtr = { __type: 'Pointer', className: 'AmexingUser', objectId: currentUser.id };

    // Quotes explicitly shared with this user via collaboration
    const accessQuery = new Parse.Query('QuoteAccess');
    accessQuery.equalTo('agent', mePtr);
    accessQuery.equalTo('active', true);
    accessQuery.equalTo('exists', true);
    const accessRecords = await accessQuery.find({ useMasterKey: true });
    const now = new Date();
    const sharedQuoteIds = accessRecords
      // Match QuoteAccess.isValid(): exclude revoked and expired shares.
      .filter((access) => access.get('revoked') !== true)
      .filter((access) => {
        const expiresAt = access.get('expiresAt');
        return !expiresAt || expiresAt > now;
      })
      .map((access) => access.get('quote')?.id)
      .filter((id) => id);

    // Eligible quotes: owner == me OR (legacy: no owner pointer AND created by me) OR shared
    const ownedQuotesQuery = new Parse.Query('Quote');
    ownedQuotesQuery.equalTo('owner', mePtr);

    const legacyQuotesQuery = new Parse.Query('Quote');
    legacyQuotesQuery.doesNotExist('owner');
    legacyQuotesQuery.equalTo('createdBy', mePtr);

    const orParts = [ownedQuotesQuery, legacyQuotesQuery];
    if (sharedQuoteIds.length > 0) {
      const sharedQuotesQuery = new Parse.Query('Quote');
      sharedQuotesQuery.containedIn('objectId', sharedQuoteIds);
      orParts.push(sharedQuotesQuery);
    }

    const eligibleQuotesQuery = Parse.Query.or(...orParts);
    eligibleQuotesQuery.limit(1000);
    const eligibleQuotes = await eligibleQuotesQuery.find({ useMasterKey: true });

    if (eligibleQuotes.length === 1000) {
      logger.warn('Client eligible-quotes lookup hit the 1000 limit; some reservations may be omitted', {
        userId: currentUser.id,
      });
    }

    logger.info('Computed client eligible quotes for reservation scoping', {
      userId: currentUser.id,
      eligibleQuotesCount: eligibleQuotes.length,
      sharedQuotesCount: sharedQuoteIds.length,
    });

    return eligibleQuotes.map((quote) => quote.id);
  }

  /**
   * Apply the SAME role-based ownership scope the listing uses (getRoleFilterPointers +
   * getClientEligibleQuoteIds) to a single-reservation query (get-by-id / payment endpoints),
   * so a nivel-4+ actor can only reach reservations they own. Admin/superadmin: no filter.
   * Agency (department_manager): clientPtr must be a user in its departmentId (fallback: own
   * clientPtr). Agent (client): scoped by quote ownership/collaboration ONLY, never by clientPtr
   * (a clientPtr match can be accidental). Out-of-scope ids then miss the query and .get() throws
   * OBJECT_NOT_FOUND → surfaced as 404 by the caller (never a 200 with foreign data, never a 403
   * that confirms the resource exists).
   * @param {Parse.Query} query - Reservation query to constrain in place.
   * @param {object} req - Express request with user info from JWT middleware.
   * @returns {Promise<void>}
   * @example
   */
  static async applyOwnershipScope(query, req) {
    const roleFilterPointers = await ReservationController.getRoleFilterPointers(req);
    const clientQuoteIds = await ReservationController.getClientEligibleQuoteIds(req);
    if (roleFilterPointers) {
      query.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
    }
    // Client scoping lives on the quote (quotePtr), not on the reservation. An empty eligible list
    // yields zero matches (containedIn on []), which is exactly what we want (deny by default).
    if (clientQuoteIds) {
      const innerQuote = new Parse.Query('Quote');
      innerQuote.containedIn('objectId', clientQuoteIds);
      query.matchesQuery('quotePtr', innerQuote);
    }
  }

  /**
   * GET /api/reservations — DataTables server-side processing.
   * @param req
   * @param res
   * @example
   */
  static async getReservations(req, res) {
    try {
      const draw = parseInt(req.query.draw) || 1;
      const start = parseInt(req.query.start) || 0;
      const length = parseInt(req.query.length) || 10;
      const searchValue = req.query.search?.value || '';
      const orderColumnIndex = parseInt(req.query.order?.[0]?.column) || 0;
      const orderDir = req.query.order?.[0]?.dir === 'desc' ? 'descending' : 'ascending';

      // Column mapping for sorting — index-aligned with the frontend DataTable
      // columns (bookings.ejs). `null` marks computed/non-sortable columns
      // (Servicios = assigned/total count, Acciones) which fall back to createdAt.
      const columnMap = [
        'folio', // 0 Folio
        'clientPtr', // 1 Cliente
        null, // 2 Propietario (computed: quotePtr.owner | createdBy)
        'eventType', // 3 Motivo de Viaje
        'contactPerson', // 4 Cliente Final
        null, // 5 Persona de Contacto (computed: contacto | propietario + teléfono)
        'startDate', // 6 Fecha Inicio
        'numberOfPeople', // 7 Personas
        null, // 8 Servicios (computed)
        'status', // 9 Estado
        'updatedAt', // 10 Última Modificación
        null, // 11 Acciones (orderable: false)
      ];
      const orderField = columnMap[orderColumnIndex] || 'startDate';

      // Status filter
      const statusFilter = req.query.statusFilter || '';

      // Date filter
      const dateFilter = req.query.dateFilter || 'upcoming'; // Default to upcoming
      // "Pendientes de completar" = reservaciones con cotización en hold. En ese filtro
      // solo mostramos las hold ('only'); en los pills por fecha las excluimos ('exclude').
      const holdMode = dateFilter === 'pending_completion' ? 'only' : 'exclude';

      // Year, Month, Day filters
      const yearFilter = req.query.yearFilter ? parseInt(req.query.yearFilter, 10) : null;
      const monthFilter = req.query.monthFilter ? parseInt(req.query.monthFilter, 10) : null;
      const dayFilter = req.query.dayFilter ? parseInt(req.query.dayFilter, 10) : null;

      // Agency/Client filter (molecule client-agency-filter). Empty type = no filter;
      // 'agency'/'client' filter by type (even without a specific entity).
      // '', 'agency', 'client', o categoría de persona (wedding_planner/concierge/home_owner)
      const clientTypeFilter = req.query.clientTypeFilter || '';
      const clientIdFilter = req.query.clientIdFilter || '';

      // Get role-based filter pointers (null = no filter for admins)
      const roleFilterPointers = await ReservationController.getRoleFilterPointers(req);
      // For clients: ids of quotes they may see (owner/legacy/shared). null for other roles.
      // Applied inside applyQuoteConstraint so it composes with the hold/type filter.
      const clientQuoteIds = await ReservationController.getClientEligibleQuoteIds(req);

      // Build query
      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.include('quotePtr');
      query.include('quotePtr.owner'); // propietario (vive en la cotización)
      query.include('quotePtr.client'); // agencia (AmexingUser)
      query.include('quotePtr.companyClientPtr'); // cliente directo (Client)
      query.include('clientPtr');
      query.include('createdBy');
      if (roleFilterPointers) {
        query.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
      }

      /**
       * Apply the upcoming/ongoing/past filter together with the optional
       * year/month/day period filter, computing combined date bounds so the
       * two filters never overwrite each other's constraints.
       *
       * Both filters constrain `startDate`/`endDate`. The Parse SDK stores only
       * ONE value per comparator per field, so calling e.g.
       * `greaterThanOrEqualTo('endDate', x)` twice silently overwrites the
       * first. That caused an ended reservation (endDate < today) to also show
       * up in EN CURSO, because the year filter's `endDate >= yearStart`
       * clobbered ongoing's `endDate >= today`. We therefore merge the bounds
       * (max for lower bounds, min for upper bounds) and apply each comparator
       * at most once per field.
       * @param {Parse.Query} q - The Parse query to constrain.
       * @param {string} filter - 'upcoming' | 'ongoing' | 'past'.
       * @param {Date} today - Start of today (00:00).
       * @param {number|null} yearVal - Year filter (e.g. 2026) or null.
       * @param {number|null} monthVal - Month filter (1-12) or null.
       * @param {number|null} dayVal - Day-of-month filter (1-31) or null.
       * @returns {void}
       * @example
       *   applyDateConstraints(query, 'ongoing', today, 2026, 5, null);
       */
      const applyDateConstraints = (q, filter, today, yearVal, monthVal, dayVal) => {
        // 'pending_completion' (estado de cotización hold) y 'cancelled' (estado de la
        // reservación) no son filtros por fecha → no aplican restricción de periodo.
        if (filter === 'pending_completion') return;
        if (filter === 'cancelled') return;
        /**
         * Return the later of two dates, treating a falsy value as unbounded.
         * @param {Date|null} a - First date, or null if unbounded.
         * @param {Date|null} b - Second date, or null if unbounded.
         * @returns {Date|null} The later date, or the other operand if one is falsy.
         * @example
         *   maxDate(new Date('2026-05-01'), new Date('2026-06-01')); // 2026-06-01
         */
        const maxDate = (a, b) => {
          if (!a) return b;
          if (!b) return a;
          return a > b ? a : b;
        };
        /**
         * Return the earlier of two dates, treating a falsy value as unbounded.
         * @param {Date|null} a - First date, or null if unbounded.
         * @param {Date|null} b - Second date, or null if unbounded.
         * @returns {Date|null} The earlier date, or the other operand if one is falsy.
         * @example
         *   minDate(new Date('2026-05-01'), new Date('2026-06-01')); // 2026-05-01
         */
        const minDate = (a, b) => {
          if (!a) return b;
          if (!b) return a;
          return a < b ? a : b;
        };

        // Period [pStart, pEnd) from the year/month/day selectors (null if no year).
        let pStart = null;
        let pEnd = null;
        if (yearVal !== null) {
          if (monthVal !== null && dayVal !== null) {
            pStart = new Date(yearVal, monthVal - 1, dayVal);
            pEnd = new Date(yearVal, monthVal - 1, dayVal + 1);
          } else if (monthVal !== null) {
            pStart = new Date(yearVal, monthVal - 1, 1);
            pEnd = new Date(yearVal, monthVal, 1);
          } else {
            pStart = new Date(yearVal, 0, 1);
            pEnd = new Date(yearVal + 1, 0, 1);
          }
        }

        // Combined bounds (null = unbounded).
        let startGt = null; // startDate >  (exclusive lower)
        let startLte = null; // startDate <= (inclusive upper)
        let startLt = null; // startDate <  (exclusive upper)
        let endGte = null; // endDate   >= (inclusive lower)
        let endLt = null; // endDate   <  (exclusive upper)

        if (filter === 'upcoming') {
          startGt = today; // hasn't started yet
        } else if (filter === 'ongoing') {
          startLte = today; // already started
          endGte = today; // hasn't ended
        } else if (filter === 'past') {
          endLt = today; // already ended
        }

        // Fold in the period (overlap: startDate < pEnd AND endDate >= pStart).
        // Merging avoids a second $gte/$lt on the same field overwriting the above.
        if (pEnd) startLt = minDate(startLt, pEnd);
        if (pStart) endGte = maxDate(endGte, pStart);

        if (startGt) q.greaterThan('startDate', startGt);
        if (startLte) q.lessThanOrEqualTo('startDate', startLte);
        if (startLt) q.lessThan('startDate', startLt);
        if (endGte) q.greaterThanOrEqualTo('endDate', endGte);
        if (endLt) q.lessThan('endDate', endLt);
      };

      /**
       * Visibilidad de reservaciones canceladas: viven SOLO en el filtro 'cancelled'.
       * - dateFilter === 'cancelled' → solo status = 'cancelled'.
       * - cualquier otro filtro (sin statusFilter explícito) → se excluyen las canceladas.
       * @param {Parse.Query} q - Query de Reservation a restringir.
       * @returns {void}
       * @example
       *   applyCancelledVisibility(query);
       */
      const applyCancelledVisibility = (q) => {
        if (dateFilter === 'cancelled') {
          q.equalTo('status', 'cancelled');
        } else if (!statusFilter) {
          q.notEqualTo('status', 'cancelled');
        }
      };

      /**
       * Constrain a Reservation query by agency/client. No-op when type is empty.
       * Matches through the quote so it's consistent with the "Cliente" column:
       * - 'agency': quotePtr.client (AmexingUser). With id → that agency; without
       * id → any agency-type reservation (quote.client exists).
       * - 'client': quotePtr.companyClientPtr (Client). With id → that client;
       * without id → any direct-client reservation (companyClientPtr exists and
       * client doesn't, to match the display where agency takes priority).
       * @param {Parse.Query} q - Reservation query to constrain.
       * @param {string} type - '' | 'agency' | 'client' | 'wedding_planner' | 'concierge' | 'home_owner'.
       * @param {string} id - ObjectId of the agency (AmexingUser) or Client (optional).
       * @returns {void}
       * @example
       */
      /**
       * Constrain a Reservation query through its quote: combines the agency/client
       * molecule filter with the quote-status (hold) filter in a SINGLE inner Quote
       * query + one matchesQuery, so the two don't overwrite each other on `quotePtr`.
       * @param {Parse.Query} q - Reservation query to constrain.
       * @param {string} type - '' | 'agency' | 'client' | 'wedding_planner' | 'concierge' | 'home_owner'.
       * @param {string} id - ObjectId of the agency (AmexingUser) or Client (optional).
       * @param {string|null} holdFilter - 'only' = solo cotización en hold; 'exclude' = saca las hold; null = sin filtro de estado.
       * @returns {void}
       * @example
       *   applyQuoteConstraint(query, 'agency', 'abc', 'exclude');
       */
      const applyQuoteConstraint = (q, type, id, holdFilter) => {
        // Mapea el tipo de filtro de persona → clientCategory. 'client' = directos;
        // las categorías especiales usan su propio nombre.
        const PERSON_CATEGORY_BY_FILTER = {
          client: 'direct_client',
          wedding_planner: 'wedding_planner',
          concierge: 'concierge',
          home_owner: 'home_owner',
        };
        const personCategory = PERSON_CATEGORY_BY_FILTER[type];
        const innerQuote = new Parse.Query('Quote');
        let has = false;
        if (personCategory) {
          // Clientes directos y categorías especiales (wedding_planner/concierge/
          // home_owner): viven en quote.client (AmexingUser end_client) con clientType
          // 'direct'. (Antes eran companyClientPtr → Client legado, ya migrado.)
          if (id) {
            const UserCls = Parse.Object.extend('AmexingUser');
            const userObj = new UserCls();
            userObj.id = id;
            innerQuote.equalTo('client', userObj);
            innerQuote.equalTo('clientType', 'direct');
          } else {
            // Sin id: acota a la categoría seleccionada (direct_client / wedding_planner
            // / concierge / home_owner) vía subquery sobre el pointer client.
            const innerClient = new Parse.Query('AmexingUser');
            innerClient.equalTo('clientCategory', personCategory);
            innerQuote.matchesQuery('client', innerClient);
            innerQuote.equalTo('clientType', 'direct');
          }
          has = true;
        } else if (type === 'agency') {
          if (id) {
            const UserCls = Parse.Object.extend('AmexingUser');
            const userObj = new UserCls();
            userObj.id = id;
            innerQuote.equalTo('client', userObj);
          } else {
            // Agencia = tiene client (AmexingUser) y NO es directo.
            innerQuote.exists('client');
            innerQuote.notEqualTo('clientType', 'direct');
          }
          has = true;
        }
        if (holdFilter === 'only') {
          innerQuote.equalTo('status', 'hold');
          has = true;
        } else if (holdFilter === 'exclude') {
          innerQuote.notEqualTo('status', 'hold');
          has = true;
        }
        // Client scoping: restrict to quotes the client owns / was shared with (see
        // getClientEligibleQuoteIds). Applied on the SAME inner Quote query so it composes
        // with the hold/type filter via a single matchesQuery on quotePtr (avoids the
        // two-constraints-on-quotePtr overwrite). An empty list yields zero results.
        if (clientQuoteIds) {
          innerQuote.containedIn('objectId', clientQuoteIds);
          has = true;
        }
        if (has) q.matchesQuery('quotePtr', innerQuote);
      };

      // Apply date filter based on startDate and endDate
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      // Apply combined date constraints (upcoming/ongoing/past + year/month/day)
      applyDateConstraints(query, dateFilter, today, yearFilter, monthFilter, dayFilter);
      applyQuoteConstraint(query, clientTypeFilter, clientIdFilter, holdMode);

      // Total count (without search/status filters, but with role filter)
      const totalQuery = new Parse.Query('Reservation');
      totalQuery.equalTo('active', true);
      totalQuery.equalTo('exists', true);
      if (roleFilterPointers) {
        totalQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
      }

      // Apply the same combined date constraints to the total count
      applyDateConstraints(totalQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);
      applyQuoteConstraint(totalQuery, clientTypeFilter, clientIdFilter, holdMode);
      applyCancelledVisibility(totalQuery);

      const recordsTotal = await totalQuery.count({ useMasterKey: true });

      // Contador del pill "Pendientes de completar": reservaciones con cotización en
      // hold, respetando rol y el filtro agencia/cliente, sin importar fecha ni el pill activo.
      const pendingCountQuery = new Parse.Query('Reservation');
      pendingCountQuery.equalTo('active', true);
      pendingCountQuery.equalTo('exists', true);
      if (roleFilterPointers) {
        pendingCountQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
      }
      applyQuoteConstraint(pendingCountQuery, clientTypeFilter, clientIdFilter, 'only');
      // El badge de pendientes siempre excluye canceladas (viven solo en su propio filtro).
      pendingCountQuery.notEqualTo('status', 'cancelled');
      const pendingCompletionCount = await pendingCountQuery.count({ useMasterKey: true });

      // Apply search filter
      if (searchValue) {
        const folioQuery = new Parse.Query('Reservation');
        folioQuery.equalTo('active', true);
        folioQuery.equalTo('exists', true);
        folioQuery.matches('folio', searchValue, 'i');

        const contactQuery = new Parse.Query('Reservation');
        contactQuery.equalTo('active', true);
        contactQuery.equalTo('exists', true);
        contactQuery.matches('contactPerson', searchValue, 'i');

        const eventQuery = new Parse.Query('Reservation');
        eventQuery.equalTo('active', true);
        eventQuery.equalTo('exists', true);
        eventQuery.matches('eventType', searchValue, 'i');

        const emailQuery = new Parse.Query('Reservation');
        emailQuery.equalTo('active', true);
        emailQuery.equalTo('exists', true);
        emailQuery.matches('contactEmail', searchValue, 'i');

        // Apply role filter to each sub-query
        if (roleFilterPointers) {
          folioQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
          contactQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
          eventQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
          emailQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
        }

        // Apply the same combined date constraints to each search sub-query
        applyDateConstraints(folioQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);
        applyDateConstraints(contactQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);
        applyDateConstraints(eventQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);
        applyDateConstraints(emailQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);

        // Apply the same agency/client filter to each search sub-query
        applyQuoteConstraint(folioQuery, clientTypeFilter, clientIdFilter, holdMode);
        applyQuoteConstraint(contactQuery, clientTypeFilter, clientIdFilter, holdMode);
        applyQuoteConstraint(eventQuery, clientTypeFilter, clientIdFilter, holdMode);
        applyQuoteConstraint(emailQuery, clientTypeFilter, clientIdFilter, holdMode);

        const compoundQuery = Parse.Query.or(folioQuery, contactQuery, eventQuery, emailQuery);
        compoundQuery.include('quotePtr');
        compoundQuery.include('quotePtr.owner'); // propietario (vive en la cotización)
        compoundQuery.include('quotePtr.client'); // agencia (AmexingUser)
        compoundQuery.include('quotePtr.companyClientPtr'); // cliente directo (Client)
        compoundQuery.include('clientPtr');
        compoundQuery.include('createdBy');

        if (statusFilter) {
          compoundQuery.equalTo('status', statusFilter);
        }
        applyCancelledVisibility(compoundQuery);

        // Sort
        if (orderDir === 'descending') {
          compoundQuery.descending(orderField);
        } else {
          compoundQuery.ascending(orderField);
        }

        const recordsFiltered = await compoundQuery.count({ useMasterKey: true });

        compoundQuery.skip(start);
        compoundQuery.limit(length);
        const results = await compoundQuery.find({ useMasterKey: true });

        // Get service counts for each reservation
        const pendingCancelQuoteIds = await ReservationController.getPendingCancellationQuoteIds(results);
        const pendingInvoiceQuoteIds = await ReservationController.getPendingInvoiceQuoteIds(results);
        const data = await Promise.all(results.map(async (reservation) => {
          const serviceCount = await ReservationController.getServiceCounts(reservation.id);
          const qid = reservation.get('quotePtr')?.id;
          return ReservationController.formatReservationRow(
            reservation,
            serviceCount,
            pendingCancelQuoteIds.has(qid),
            pendingInvoiceQuoteIds.has(qid)
          );
        }));

        return res.json({
          draw, recordsTotal, recordsFiltered, data, pendingCompletionCount,
        });
      }

      // Apply status filter
      if (statusFilter) {
        query.equalTo('status', statusFilter);
      }
      applyCancelledVisibility(query);

      // Count filtered
      const countQuery = new Parse.Query('Reservation');
      countQuery.equalTo('active', true);
      countQuery.equalTo('exists', true);
      if (roleFilterPointers) {
        countQuery.containedIn(roleFilterPointers.field, roleFilterPointers.pointers);
      }
      if (statusFilter) {
        countQuery.equalTo('status', statusFilter);
      }
      applyCancelledVisibility(countQuery);

      // Apply the same combined date constraints to the count query
      applyDateConstraints(countQuery, dateFilter, today, yearFilter, monthFilter, dayFilter);
      applyQuoteConstraint(countQuery, clientTypeFilter, clientIdFilter, holdMode);

      const recordsFiltered = await countQuery.count({ useMasterKey: true });

      // Sort
      if (orderDir === 'descending') {
        query.descending(orderField);
      } else {
        query.ascending(orderField);
      }

      query.skip(start);
      query.limit(length);
      const results = await query.find({ useMasterKey: true });

      // Get service counts for each reservation
      const pendingCancelQuoteIds = await ReservationController.getPendingCancellationQuoteIds(results);
      const pendingInvoiceQuoteIds = await ReservationController.getPendingInvoiceQuoteIds(results);
      const data = await Promise.all(results.map(async (reservation) => {
        const serviceCount = await ReservationController.getServiceCounts(reservation.id);
        const qid = reservation.get('quotePtr')?.id;
        return ReservationController.formatReservationRow(
          reservation,
          serviceCount,
          pendingCancelQuoteIds.has(qid),
          pendingInvoiceQuoteIds.has(qid)
        );
      }));

      return res.json({
        draw, recordsTotal, recordsFiltered, data, pendingCompletionCount,
      });
    } catch (error) {
      logger.error('Error fetching reservations', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al obtener reservaciones' });
    }
  }

  /**
   * GET /api/reservations/:id — Get reservation detail with services.
   * @param req
   * @param res
   * @example
   */
  static async getReservationById(req, res) {
    try {
      const { id } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      // Ownership scope (mismo criterio que el listado): una agencia/agente nivel 4+ solo puede ver
      // SU propia reservación. Fuera de scope, .get() no encuentra match → safeGet null → 404.
      await ReservationController.applyOwnershipScope(query, req);
      query.include('quotePtr');
      query.include('clientPtr');
      query.include('createdBy');
      query.include('serviceCustomer');
      const reservation = await ReservationController.safeGet(query, id);

      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch services
      const servicesQuery = new Parse.Query('ReservationService');
      servicesQuery.equalTo('reservationPtr', reservation);
      servicesQuery.equalTo('active', true);
      servicesQuery.equalTo('exists', true);
      servicesQuery.include('assignedDriver');
      servicesQuery.include('assignedGuide');
      servicesQuery.include('assignedGreeter');
      servicesQuery.include('assignedVehicle');
      servicesQuery.include('assignedServiceCustomer');
      servicesQuery.ascending('dayNumber');
      servicesQuery.addAscending('time');
      servicesQuery.limit(1000);
      const services = await servicesQuery.find({ useMasterKey: true });

      // Payment rollup (fresh, non-persisting) for the financial summary + per-service status.
      let paymentSummary = null;
      try {
        paymentSummary = await PaymentService.summarize(id);
      } catch (payErr) {
        logger.warn('ReservationController.getReservationById: payment summary failed', { error: payErr.message });
      }
      // Payments now apply against the reservation grand total (no per-service split); the
      // summary no longer carries a services[] rollup. Kept guarded for backward compatibility.
      const paymentByService = {};
      if (paymentSummary && Array.isArray(paymentSummary.services)) {
        for (const s of paymentSummary.services) paymentByService[s.id] = s;
      }

      const client = reservation.get('clientPtr');

      // Build a lookup from serviceItemsSnapshot for fallback when subconcept is null
      const snapshot = reservation.get('serviceItemsSnapshot') || {};
      const snapshotDays = snapshot.days || [];
      const snapshotLookup = {};
      for (const day of snapshotDays) {
        for (const sub of (day.subconcepts || [])) {
          const key = `${day.dayNumber || 1}_${sub.concept || sub.name || ''}_${sub.time || ''}`;
          snapshotLookup[key] = sub;
        }
      }

      const serviceCustomerObj = reservation.get('serviceCustomer');

      // Build a Rate id → { name, color } map so older subconcepts that were saved before
      // we started persisting categoryName / categoryColor / segmentName / segmentColor can
      // still surface a proper segment label in the booking dashboard.
      const rateMap = new Map();
      try {
        const rateQuery = new Parse.Query('Rate');
        rateQuery.equalTo('exists', true);
        rateQuery.limit(1000);
        const rates = await rateQuery.find({ useMasterKey: true });
        rates.forEach((r) => rateMap.set(r.id, {
          name: r.get('name') || '',
          color: r.get('color') || '',
        }));
      } catch (rateErr) {
        logger.warn('ReservationController.getReservationById: failed to load rate map', { error: rateErr.message });
      }
      // Mutates the given subconcept in place to fill any missing segment names / colors
      // using the rateMap. Returns the same object for fluent use.
      // Intentional in-place mutation: this helper enriches the subconcept blob with
      // segment names / colors when they are missing, so callers receive a fully populated
      // object without having to remap. The no-param-reassign rule is disabled accordingly.
      /* eslint-disable no-param-reassign */
      /**
       * Enrich a subconcept blob with segment names / colors when missing, using rateMap.
       * Mutates the passed object in place and returns it for fluent chaining.
       * @param {object} sub - Subconcept blob from a ReservationService.
       * @returns {object} The same subconcept, with categoryName/categoryColor/etc filled in.
       * @example
       *   enrichSubconceptSegments(service.get('subconcept'));
       */
      const enrichSubconceptSegments = (sub) => {
        if (!sub || typeof sub !== 'object') return sub;
        const mainSegmentId = sub.category || sub.rateId;
        if (mainSegmentId && rateMap.has(mainSegmentId)) {
          const r = rateMap.get(mainSegmentId);
          if (!sub.categoryName) sub.categoryName = r.name;
          if (!sub.categoryColor) sub.categoryColor = r.color;
        }
        if (sub.additionalVehicleSegment && rateMap.has(sub.additionalVehicleSegment)) {
          const r = rateMap.get(sub.additionalVehicleSegment);
          if (!sub.additionalVehicleSegmentName) sub.additionalVehicleSegmentName = r.name;
          if (!sub.additionalVehicleSegmentColor) sub.additionalVehicleSegmentColor = r.color;
        }
        if (Array.isArray(sub.extraAdditionalVehicles)) {
          sub.extraAdditionalVehicles = sub.extraAdditionalVehicles.map((v) => {
            if (!v || !v.segment) return v;
            const r = rateMap.get(v.segment);
            if (!r) return v;
            return {
              ...v,
              segmentName: v.segmentName || r.name,
              segmentColor: v.segmentColor || r.color,
            };
          });
        }
        return sub;
      };
      /* eslint-enable no-param-reassign */

      // Batch fetch primary images for assigned vehicles (including extra assignments)
      const vehicleIds = services
        .map((svc) => svc.get('assignedVehicle')?.id)
        .filter(Boolean);
      // Also collect vehicle IDs from extra assignments
      services.forEach((svc) => {
        const extras = svc.get('extraAssignments') || [];
        extras.forEach((ea) => {
          if (ea.vehicleId) vehicleIds.push(ea.vehicleId);
        });
      });
      const uniqueVehicleIds = [...new Set(vehicleIds)];
      const vehicleImageMap = {};
      if (uniqueVehicleIds.length > 0) {
        try {
          // First try: query with isPrimary
          const imgQuery = new Parse.Query('VehicleImage');
          const Vehicle = Parse.Object.extend('Vehicle');
          const vehiclePointers = uniqueVehicleIds.map((vid) => Vehicle.createWithoutData(vid));
          imgQuery.containedIn('vehicleId', vehiclePointers);
          imgQuery.equalTo('isPrimary', true);
          imgQuery.equalTo('exists', true);
          let images = await imgQuery.find({ useMasterKey: true });

          // Fallback: if no primary images, get first image per vehicle
          if (images.length === 0) {
            const fallbackQuery = new Parse.Query('VehicleImage');
            fallbackQuery.containedIn('vehicleId', vehiclePointers);
            fallbackQuery.equalTo('exists', true);
            fallbackQuery.ascending('displayOrder');
            images = await fallbackQuery.find({ useMasterKey: true });
          }

          // Deduplicate: keep first image per vehicle, generate presigned URLs
          const formatPriority = ['avif', 'webp', 'jpeg'];
          await Promise.all(images.map(async (img) => {
            const vid = img.get('vehicleId')?.id;
            if (!vid || vehicleImageMap[vid]) return;

            let imageUrl = '';
            const optimizedVariants = img.get('optimizedVariants');
            const optimizationMetadata = img.get('optimizationMetadata');
            const s3Key = img.get('s3Key');
            const imageFile = img.get('imageFile');

            // Prefer optimized variants (avif → webp → jpeg)
            if (optimizedVariants && typeof optimizedVariants === 'object') {
              for (const format of formatPriority) {
                const variant = optimizedVariants[format];
                if (variant?.s3Key) {
                  try {
                    imageUrl = await fileStorageService.getPresignedUrl(variant.s3Key);
                    break;
                  } catch (e) {
                    // Continue to next format
                  }
                }
              }
            }

            // Fallback: optimizationMetadata.formats (older uploads)
            if (!imageUrl && optimizationMetadata?.formats && typeof optimizationMetadata.formats === 'object') {
              for (const format of formatPriority) {
                const formatData = optimizationMetadata.formats[format];
                if (formatData?.s3Key) {
                  try {
                    imageUrl = await fileStorageService.getPresignedUrl(formatData.s3Key);
                    break;
                  } catch (e) {
                    // Continue to next format
                  }
                }
              }
            }

            // Fallback: original s3Key
            if (!imageUrl && s3Key) {
              try {
                imageUrl = await fileStorageService.getPresignedUrl(s3Key);
              } catch (e) {
                // Fall through to legacy
              }
            }

            // Fallback: construct direct S3 URL from metadata
            if (!imageUrl && s3Key) {
              const s3Bucket = img.get('s3Bucket');
              const s3Region = img.get('s3Region');
              if (s3Bucket && s3Region) {
                imageUrl = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${s3Key}`;
              }
            }

            // Fallback: legacy Parse.File or url field
            if (!imageUrl && imageFile) {
              imageUrl = imageFile.url();
            } else if (!imageUrl) {
              imageUrl = img.get('url') || '';
            }

            vehicleImageMap[vid] = imageUrl;
          }));
        } catch (imgErr) {
          logger.warn('Failed to fetch vehicle images', { error: imgErr.message });
        }
      }

      // Whether a <24h cancellation request is awaiting approval (the reservation
      // stays in its real status until approved). Surfaced so the detail shows the
      // "Pendiente de cancelación" label instead of the cancel button.
      let hasPendingCancellation = false;
      if (reservation.get('status') !== 'cancelled') {
        const quotePtr = reservation.get('quotePtr');
        if (quotePtr) {
          const pendingQuery = new Parse.Query('CancellationRequest');
          pendingQuery.equalTo('quote', quotePtr);
          pendingQuery.equalTo('status', 'pending');
          pendingQuery.equalTo('exists', true);
          const pendingCount = await pendingQuery.count({ useMasterKey: true });
          hasPendingCancellation = pendingCount > 0;
        }
      }

      return res.json({
        success: true,
        data: {
          id: reservation.id,
          folio: reservation.get('folio'),
          quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
          quoteId: reservation.get('quotePtr')?.id || '',
          quoteStatus: reservation.get('quotePtr')?.get('status') || '',
          status: reservation.get('status'),
          hasPendingCancellation,
          startDate: reservation.get('startDate'),
          endDate: reservation.get('endDate'),
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal: reservation.get('servicesSubtotal') || reservation.get('totalAmount'),
          adjustments: reservation.get('adjustments') || [],
          currency: reservation.get('currency'),
          paymentType: reservation.get('paymentType'),
          // Payment rollup (con IVA): paymentStatus pending|partial|paid|refunded.
          payment: paymentSummary ? {
            paymentStatus: paymentSummary.paymentStatus,
            paidAmount: paymentSummary.paidAmount,
            balance: paymentSummary.balance,
            subtotal: paymentSummary.subtotal,
            iva: paymentSummary.iva,
            total: paymentSummary.total,
          } : {
            // Fallback (summarize() lanzó): deriva total = balance + paidAmount para que la UI de
            // agencia no lo pinte $0 junto a un Pagado real.
            paymentStatus: reservation.get('paymentStatus') || 'pending',
            paidAmount: reservation.get('paidAmount') || 0,
            balance: reservation.get('balance'),
            total: Math.round(
              ((Number(reservation.get('balance')) || 0) + (Number(reservation.get('paidAmount')) || 0)) * 100
            ) / 100,
          },
          numberOfPeople: reservation.get('numberOfPeople'),
          eventType: reservation.get('eventType'),
          contactPerson: reservation.get('contactPerson'),
          contactEmail: reservation.get('contactEmail'),
          contactPhone: reservation.get('contactPhone'),
          // Lead guest names and quote-level notes propagated from the quote at
          // conversion time (see QuoteService.createReservationFromQuote).
          leadGuestFirstName: reservation.get('leadGuestFirstName') || '',
          leadGuestLastName: reservation.get('leadGuestLastName') || '',
          notes: reservation.get('notes'),
          client: client ? {
            id: client.id,
            fullName: client.get('fullName') || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim(),
            companyName: client.get('contextualData')?.companyName || null,
            email: client.get('email'),
            phone: client.get('phone'),
          } : null,
          serviceCustomer: serviceCustomerObj ? {
            id: serviceCustomerObj.id,
            fullName: serviceCustomerObj.get('fullName') || `${serviceCustomerObj.get('firstName') || ''} ${serviceCustomerObj.get('lastName') || ''}`.trim() || serviceCustomerObj.get('username'),
            phone: serviceCustomerObj.get('phone') || '',
            profilePhotoUrl: serviceCustomerObj.get('profilePhotoUrl') || '',
          } : null,
          createdBy: reservation.get('createdBy')?.get('username') || '',
          createdAt: reservation.createdAt,
          services: services.map((svc) => {
            // Use stored subconcept, or fallback to snapshot match
            const storedSub = svc.get('subconcept');
            const fallbackKey = `${svc.get('dayNumber') || 1}_${svc.get('concept') || ''}_${svc.get('time') || ''}`;
            const subconcept = enrichSubconceptSegments(storedSub || snapshotLookup[fallbackKey] || null);

            return {
              id: svc.id,
              dayNumber: svc.get('dayNumber'),
              dayTitle: svc.get('dayTitle'),
              serviceDate: svc.get('serviceDate'),
              type: svc.get('type'),
              concept: svc.get('concept'),
              time: svc.get('time'),
              status: svc.get('status'),
              price: svc.get('price'),
              total: svc.get('total'),
              // Per-service payment rollup (granularidad por servicio).
              paymentStatus: paymentByService[svc.id]
                ? paymentByService[svc.id].paymentStatus : (svc.get('paymentStatus') || 'pending'),
              paidAmount: paymentByService[svc.id]
                ? paymentByService[svc.id].paidAmount : (svc.get('paidAmount') || 0),
              paymentBalance: paymentByService[svc.id]
                ? paymentByService[svc.id].balance : svc.get('balance'),
              originName: svc.get('originName'),
              destinationName: svc.get('destinationName'),
              vehicleTypeName: svc.get('vehicleTypeName'),
              notes: svc.get('notes'),
              subconcept,
              // Suggested departure time fields
              flightDepartureTimeSuggested: svc.get('flightDepartureTimeSuggested'),
              roundTripDepartureTimeSuggestedIda: svc.get('roundTripDepartureTimeSuggestedIda'),
              roundTripDepartureTimeSuggestedVuelta: svc.get('roundTripDepartureTimeSuggestedVuelta'),
              assignedDriver: svc.get('assignedDriver') ? {
                id: svc.get('assignedDriver').id,
                fullName: svc.get('assignedDriver').get('fullName') || `${svc.get('assignedDriver').get('firstName') || ''} ${svc.get('assignedDriver').get('lastName') || ''}`.trim() || svc.get('assignedDriver').get('username'),
                phone: svc.get('assignedDriver').get('phone') || '',
                profilePhotoUrl: svc.get('assignedDriver').get('profilePhotoUrl') || '',
              } : null,
              assignedGuide: svc.get('assignedGuide') ? {
                id: svc.get('assignedGuide').id,
                fullName: svc.get('assignedGuide').get('fullName') || `${svc.get('assignedGuide').get('firstName') || ''} ${svc.get('assignedGuide').get('lastName') || ''}`.trim() || svc.get('assignedGuide').get('username'),
                phone: svc.get('assignedGuide').get('phone') || '',
                profilePhotoUrl: svc.get('assignedGuide').get('profilePhotoUrl') || '',
              } : null,
              assignedGreeter: svc.get('assignedGreeter') ? {
                id: svc.get('assignedGreeter').id,
                fullName: svc.get('assignedGreeter').get('fullName') || `${svc.get('assignedGreeter').get('firstName') || ''} ${svc.get('assignedGreeter').get('lastName') || ''}`.trim() || svc.get('assignedGreeter').get('username'),
                phone: svc.get('assignedGreeter').get('phone') || '',
                profilePhotoUrl: svc.get('assignedGreeter').get('profilePhotoUrl') || '',
              } : null,
              assignedVehicle: svc.get('assignedVehicle') ? {
                id: svc.get('assignedVehicle').id,
                name: `${svc.get('assignedVehicle').get('brand') || ''} ${svc.get('assignedVehicle').get('model') || ''}`.trim() || svc.get('assignedVehicle').get('licensePlate') || 'Vehiculo',
                imageUrl: vehicleImageMap[svc.get('assignedVehicle').id] || '',
              } : null,
              assignedServiceCustomer: svc.get('assignedServiceCustomer') ? {
                id: svc.get('assignedServiceCustomer').id,
                fullName: svc.get('assignedServiceCustomer').get('fullName') || `${svc.get('assignedServiceCustomer').get('firstName') || ''} ${svc.get('assignedServiceCustomer').get('lastName') || ''}`.trim() || svc.get('assignedServiceCustomer').get('username'),
                phone: svc.get('assignedServiceCustomer').get('phone') || '',
                profilePhotoUrl: svc.get('assignedServiceCustomer').get('profilePhotoUrl') || '',
              } : null,
              extraAssignments: (svc.get('extraAssignments') || []).map((ea) => {
                // Backfill segmentName / segmentColor from rateMap when missing (legacy data).
                let segName = ea.segmentName || '';
                let segColor = ea.segmentColor || '';
                if (ea.segmentId && rateMap.has(ea.segmentId)) {
                  const r = rateMap.get(ea.segmentId);
                  if (!segName) segName = r.name;
                  if (!segColor) segColor = r.color;
                }
                return {
                  ...ea,
                  segmentName: segName,
                  segmentColor: segColor,
                  vehicleImageUrl: ea.vehicleId ? (vehicleImageMap[ea.vehicleId] || '') : '',
                };
              }),
            };
          }),
        },
      });
    } catch (error) {
      logger.error('Error fetching reservation detail', { id: req.params.id, error: error.message });
      return res.status(500).json({ success: false, error: 'Error al obtener reservación' });
    }
  }

  /**
   * PUT /api/reservations/:id/services/:serviceId/assign — Assign employees/vehicle to a service.
   * @param req
   * @param res
   * @example
   */
  static async assignEmployee(req, res) {
    try {
      const { id, serviceId } = req.params;
      const {
        driverId, guideId, greeterId, vehicleId, serviceCustomerId, extraAssignments,
      } = req.body;

      // Verify reservation exists
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(resQuery, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch the service
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      const service = await ReservationController.safeGet(svcQuery, serviceId);
      if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
      }

      // Assign fields
      if (driverId !== undefined) {
        if (driverId) {
          const driver = new Parse.Object('AmexingUser');
          driver.id = driverId;
          service.set('assignedDriver', driver);
        } else {
          service.unset('assignedDriver');
        }
      }

      if (guideId !== undefined) {
        if (guideId) {
          const guide = new Parse.Object('AmexingUser');
          guide.id = guideId;
          service.set('assignedGuide', guide);
        } else {
          service.unset('assignedGuide');
        }
      }

      if (greeterId !== undefined) {
        if (greeterId) {
          const greeter = new Parse.Object('AmexingUser');
          greeter.id = greeterId;
          service.set('assignedGreeter', greeter);
        } else {
          service.unset('assignedGreeter');
        }
      }

      if (vehicleId !== undefined) {
        if (vehicleId) {
          const vehicle = new Parse.Object('Vehicle');
          vehicle.id = vehicleId;
          service.set('assignedVehicle', vehicle);
        } else {
          service.unset('assignedVehicle');
        }
      }

      if (serviceCustomerId !== undefined) {
        if (serviceCustomerId) {
          const sc = new Parse.Object('AmexingUser');
          sc.id = serviceCustomerId;
          service.set('assignedServiceCustomer', sc);
        } else {
          service.unset('assignedServiceCustomer');
        }
      }

      if (extraAssignments !== undefined) {
        service.set('extraAssignments', extraAssignments || []);
      }

      // Auto-update service status: pending → assigned when a driver is assigned
      const hasDriver = driverId || service.get('assignedDriver');
      if (hasDriver && service.get('status') === 'pending') {
        service.set('status', 'assigned');
      }
      // If all assignments are removed, revert to pending
      if (!driverId && driverId !== undefined && !service.get('assignedDriver') && service.get('status') === 'assigned') {
        service.set('status', 'pending');
      }

      await service.save(null, { useMasterKey: true });

      // Check if all services in the reservation now have at least one assignment
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Service assignment updated', {
        reservationId: id,
        serviceId,
        driverId,
        guideId,
        greeterId,
        vehicleId,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Asignación actualizada exitosamente' });
    } catch (error) {
      logger.error('Error assigning employee', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al asignar empleado' });
    }
  }

  /**
   * PATCH /api/reservations/:id/services/:serviceId/status — Update individual service status.
   * @param req
   * @param res
   * @example
   */
  static async updateServiceStatus(req, res) {
    try {
      const { id, serviceId } = req.params;
      const { status } = req.body;

      const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'confirmed', 'hold'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: `Estado inválido. Debe ser: ${validStatuses.join(', ')}` });
      }

      // Verify reservation
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(resQuery, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch service
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      const service = await ReservationController.safeGet(svcQuery, serviceId);
      if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
      }

      service.set('status', status);
      await service.save(null, { useMasterKey: true });

      // Update parent reservation status based on service statuses
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Service status updated', {
        reservationId: id,
        serviceId,
        newStatus: status,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Estado del servicio actualizado' });
    } catch (error) {
      logger.error('Error updating service status', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al actualizar estado del servicio' });
    }
  }

  /**
   * POST /api/reservations/:id/cancel — Cancel reservation and cascade to services.
   * @param req
   * @param res
   * @example
   */
  static async cancelReservation(req, res) {
    try {
      const { id } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(query, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Cancel reservation
      reservation.set('status', 'cancelled');
      await reservation.save(null, { useMasterKey: true });

      // Cascade cancel to all services
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      svcQuery.limit(1000);
      const services = await svcQuery.find({ useMasterKey: true });

      for (const svc of services) {
        svc.set('status', 'cancelled');
      }
      if (services.length > 0) {
        await Parse.Object.saveAll(services, { useMasterKey: true });
      }

      // Revert linked quote status back to 'requested'
      const quotePtr = reservation.get('quotePtr');
      if (quotePtr) {
        const quoteQuery = new Parse.Query('Quote');
        quoteQuery.equalTo('exists', true);
        const quote = await quoteQuery.get(quotePtr.id, { useMasterKey: true });
        if (quote && quote.get('status') === 'scheduled') {
          quote.set('status', 'requested');
          await quote.save(null, { useMasterKey: true });
          logger.info('Quote status reverted to requested', { quoteId: quote.id });
        }
      }

      logger.info('Reservation cancelled with cascade', {
        reservationId: id,
        servicesCancelled: services.length,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Reservación cancelada exitosamente' });
    } catch (error) {
      logger.error('Error cancelling reservation', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al cancelar reservación' });
    }
  }

  /**
   * PUT /api/reservations/:id/status — Manually set the reservation's overall status.
   * Only the MANUAL states are allowed here: 'confirmed' (todo asignado y confirmado)
   * and 'hold' (bloqueado). The derived states (pending/assigned/in_progress/completed)
   * are computed from service assignments by updateReservationStatus and must not be set
   * by hand; 'cancelled' has its own cascade flow (cancelReservation).
   * @param {object} req - Express request; body: { status }.
   * @param {object} res - Express response.
   * @returns {Promise<void>} JSON { success, data: { status } }.
   * @example
   *   PUT /api/reservations/abc123/status { "status": "confirmed" }
   */
  static async setReservationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body || {};
      // 'confirmed'/'hold' are set manually. 'pending' is the RELEASE action: it
      // clears the manual state and recomputes the real status from the service
      // assignments (so the user can step back out of Bloqueado/Confirmada).
      const MANUAL_STATUSES = ['confirmed', 'hold'];
      const RELEASE_STATUS = 'pending';
      const ALLOWED = [...MANUAL_STATUSES, RELEASE_STATUS];
      if (!ALLOWED.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Estado inválido. Sólo se permite: ${ALLOWED.join(', ')}`,
        });
      }

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(query, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      if (reservation.get('status') === 'cancelled') {
        return res.status(409).json({
          success: false,
          error: 'No se puede cambiar el estado de una reservación cancelada',
        });
      }

      if (status === RELEASE_STATUS) {
        // Drop the manual hold/confirmed, then let updateReservationStatus derive
        // the real state (pending/assigned/completed) from the service statuses.
        reservation.set('status', 'pending');
        await reservation.save(null, { useMasterKey: true });
        await ReservationController.updateReservationStatus(reservation);
        const finalStatus = reservation.get('status');
        logger.info('Reservation status released (recomputed)', {
          reservationId: id, finalStatus, performedBy: req.user?.id,
        });
        return res.json({ success: true, data: { status: finalStatus } });
      }

      reservation.set('status', status);
      await reservation.save(null, { useMasterKey: true });

      // When a reservation is confirmed, advance its quote from 'hold' (Bloqueada) to
      // 'scheduled' (Agendada): confirming the reservation means the block is resolved.
      // Non-blocking — the reservation status change already succeeded.
      if (status === 'confirmed') {
        try {
          const quotePtr = reservation.get('quotePtr');
          if (quotePtr) {
            const quote = await new Parse.Query('Quote').get(quotePtr.id, { useMasterKey: true });
            if (quote && quote.get('status') === 'hold') {
              quote.set('status', 'scheduled');
              await quote.save(null, { useMasterKey: true });
              logger.info('Quote advanced hold → scheduled after reservation confirmed', {
                reservationId: id, quoteId: quote.id, performedBy: req.user?.id,
              });
            }
          }
        } catch (quoteErr) {
          logger.warn('Failed to advance quote status after reservation confirmed', {
            reservationId: id, error: quoteErr.message,
          });
        }
      }

      logger.info('Reservation status set manually', {
        reservationId: id, status, performedBy: req.user?.id,
      });

      return res.json({ success: true, data: { status } });
    } catch (error) {
      logger.error('Error setting reservation status', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al actualizar estado' });
    }
  }

  /**
   * PUT /api/reservations/:id/services/batch-assign — Batch assign employees/vehicle to multiple services.
   * @param req
   * @param res
   * @example
   */
  static async batchAssignEmployees(req, res) {
    try {
      const { id } = req.params;
      const {
        serviceIds, driverId, guideId, greeterId, vehicleId, serviceCustomerId,
      } = req.body;

      if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Se requiere al menos un servicio' });
      }

      // Verify reservation exists
      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(resQuery, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Fetch all target services
      const svcQuery = new Parse.Query('ReservationService');
      svcQuery.equalTo('reservationPtr', reservation);
      svcQuery.equalTo('active', true);
      svcQuery.equalTo('exists', true);
      svcQuery.containedIn('objectId', serviceIds);
      svcQuery.limit(1000);
      const services = await svcQuery.find({ useMasterKey: true });

      if (services.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontraron servicios' });
      }

      // Apply assignments to all services
      for (const service of services) {
        if (driverId !== undefined) {
          if (driverId) {
            const driver = new Parse.Object('AmexingUser');
            driver.id = driverId;
            service.set('assignedDriver', driver);
          } else {
            service.unset('assignedDriver');
          }
        }
        if (guideId !== undefined) {
          if (guideId) {
            const guide = new Parse.Object('AmexingUser');
            guide.id = guideId;
            service.set('assignedGuide', guide);
          } else {
            service.unset('assignedGuide');
          }
        }
        if (greeterId !== undefined) {
          if (greeterId) {
            const greeter = new Parse.Object('AmexingUser');
            greeter.id = greeterId;
            service.set('assignedGreeter', greeter);
          } else {
            service.unset('assignedGreeter');
          }
        }
        if (vehicleId !== undefined) {
          if (vehicleId) {
            const vehicle = new Parse.Object('Vehicle');
            vehicle.id = vehicleId;
            service.set('assignedVehicle', vehicle);
          } else {
            service.unset('assignedVehicle');
          }
        }
        if (serviceCustomerId !== undefined) {
          if (serviceCustomerId) {
            const sc = new Parse.Object('AmexingUser');
            sc.id = serviceCustomerId;
            service.set('assignedServiceCustomer', sc);
          } else {
            service.unset('assignedServiceCustomer');
          }
        }
      }

      await Parse.Object.saveAll(services, { useMasterKey: true });
      await ReservationController.updateReservationStatus(reservation);

      logger.info('Batch assignment updated', {
        reservationId: id,
        serviceCount: services.length,
        driverId,
        guideId,
        greeterId,
        vehicleId,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: `Asignación actualizada en ${services.length} servicio(s)` });
    } catch (error) {
      logger.error('Error batch assigning', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al asignar en lote' });
    }
  }

  /**
   * PUT /api/reservations/:id/service-customer — Assign service customer at reservation level.
   * @param req
   * @param res
   * @example
   */
  static async assignServiceCustomer(req, res) {
    try {
      const { id } = req.params;
      const { serviceCustomerId } = req.body;

      const resQuery = new Parse.Query('Reservation');
      resQuery.equalTo('active', true);
      resQuery.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(resQuery, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      if (serviceCustomerId) {
        const sc = new Parse.Object('AmexingUser');
        sc.id = serviceCustomerId;
        reservation.set('serviceCustomer', sc);
      } else {
        reservation.unset('serviceCustomer');
      }

      await reservation.save(null, { useMasterKey: true });

      logger.info('Reservation service customer updated', {
        reservationId: id,
        serviceCustomerId,
        performedBy: req.user?.id,
      });

      return res.json({ success: true, message: 'Seguidor de servicio actualizado' });
    } catch (error) {
      logger.error('Error assigning service customer', { error: error.message });
      return res.status(500).json({ success: false, error: 'Error al asignar seguidor' });
    }
  }

  // =========================
  // FINANCIAL ADJUSTMENTS
  // =========================

  /**
   * POST /api/reservations/:id/adjustments — Add extra charge or discount.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON response with updated adjustments.
   * @example
   */
  static async addAdjustment(req, res) {
    try {
      const { id } = req.params;
      const {
        type, description, amount, percentage,
      } = req.body;

      // Validate type
      if (!type || !['charge', 'discount'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Tipo inválido. Debe ser "charge" o "discount"',
        });
      }

      // Validate description
      if (!description || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({
          success: false,
          error: 'La descripción es requerida',
        });
      }

      // Validate amount or percentage
      if (type === 'charge') {
        if (!amount || typeof amount !== 'number' || amount <= 0) {
          return res.status(400).json({
            success: false,
            error: 'El monto debe ser un número mayor a 0',
          });
        }
      } else if (!percentage && (!amount || typeof amount !== 'number' || amount <= 0)) {
        // Discount requires either amount or percentage
        if (percentage !== undefined && (typeof percentage !== 'number' || percentage <= 0 || percentage > 100)) {
          return res.status(400).json({
            success: false,
            error: 'El porcentaje debe ser un número entre 0 y 100',
          });
        }
        if (!percentage) {
          return res.status(400).json({
            success: false,
            error: 'Se requiere un monto o porcentaje para el descuento',
          });
        }
      }

      // Fetch reservation
      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(query, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      // Initialize servicesSubtotal if not set
      const servicesSubtotal = reservation.get('servicesSubtotal')
        || reservation.get('totalAmount') || 0;
      if (!reservation.get('servicesSubtotal')) {
        reservation.set('servicesSubtotal', servicesSubtotal);
      }

      // Calculate final amount for percentage discounts
      let finalAmount = amount;
      if (type === 'discount' && percentage) {
        finalAmount = Math.round(((servicesSubtotal * percentage) / 100) * 100) / 100;
      }

      if (Number(finalAmount) > 100000000) {
        return res.status(400).json({ success: false, error: 'El monto del ajuste no puede exceder 100,000,000' });
      }

      // Create adjustment entry
      const adjustment = {
        id: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type,
        description: description.trim().slice(0, 150),
        amount: finalAmount,
        percentage: type === 'discount' && percentage ? percentage : null,
        createdAt: new Date().toISOString(),
      };

      // Append to adjustments array
      const adjustments = reservation.get('adjustments') || [];
      adjustments.push(adjustment);
      reservation.set('adjustments', adjustments);

      // Recalculate total
      ReservationController.recalculateTotal(reservation);

      await reservation.save(null, { useMasterKey: true });

      // Keep the payment rollup (balance/paymentStatus) in sync with the new amount due (adjustments
      // now flow into the payment total). Non-fatal: the adjustment itself already saved.
      try {
        await require('../../services/PaymentService').recalculate(id);
      } catch (e) {
        logger.warn('Adjustment saved but payment recalculate failed', { reservationId: id, error: e.message });
      }

      logger.info('Reservation adjustment added', {
        reservationId: id,
        adjustmentId: adjustment.id,
        type,
        amount: finalAmount,
        description: description.trim(),
        performedBy: req.user?.id,
      });

      return res.json({
        success: true,
        message: type === 'charge' ? 'Cargo agregado' : 'Descuento agregado',
        data: {
          adjustment,
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal,
          adjustments,
        },
      });
    } catch (error) {
      logger.error('Error adding adjustment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al agregar ajuste' });
    }
  }

  /**
   * DELETE /api/reservations/:id/adjustments/:adjustmentId — Remove an adjustment.
   * @param {object} req - Express request.
   * @param {object} res - Express response.
   * @returns {Promise<object>} JSON response with updated adjustments.
   * @example
   */
  static async removeAdjustment(req, res) {
    try {
      const { id, adjustmentId } = req.params;

      const query = new Parse.Query('Reservation');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      const reservation = await ReservationController.safeGet(query, id);
      if (!reservation) {
        return res.status(404).json({ success: false, error: 'Reservación no encontrada' });
      }

      const adjustments = reservation.get('adjustments') || [];
      const idx = adjustments.findIndex((a) => a.id === adjustmentId);
      if (idx === -1) {
        return res.status(404).json({ success: false, error: 'Ajuste no encontrado' });
      }

      const removed = adjustments.splice(idx, 1)[0];
      reservation.set('adjustments', adjustments);

      // Recalculate total
      ReservationController.recalculateTotal(reservation);

      await reservation.save(null, { useMasterKey: true });

      // Keep the payment rollup in sync with the new amount due (non-fatal).
      try {
        await require('../../services/PaymentService').recalculate(id);
      } catch (e) {
        logger.warn('Adjustment removed but payment recalculate failed', { reservationId: id, error: e.message });
      }

      logger.info('Reservation adjustment removed', {
        reservationId: id,
        adjustmentId,
        type: removed.type,
        amount: removed.amount,
        performedBy: req.user?.id,
      });

      return res.json({
        success: true,
        message: 'Ajuste eliminado',
        data: {
          totalAmount: reservation.get('totalAmount'),
          servicesSubtotal: reservation.get('servicesSubtotal') || reservation.get('totalAmount'),
          adjustments,
        },
      });
    } catch (error) {
      logger.error('Error removing adjustment', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Error al eliminar ajuste' });
    }
  }

  /**
   * Recalculate totalAmount from servicesSubtotal and adjustments.
   * @param {object} reservation - Parse Reservation object.
   * @example
   */
  static recalculateTotal(reservation) {
    const servicesSubtotal = reservation.get('servicesSubtotal')
      || reservation.get('totalAmount') || 0;
    const adjustments = reservation.get('adjustments') || [];

    const charges = adjustments
      .filter((a) => a.type === 'charge')
      .reduce((sum, a) => sum + (a.amount || 0), 0);

    const discounts = adjustments
      .filter((a) => a.type === 'discount')
      .reduce((sum, a) => sum + (a.amount || 0), 0);

    const finalTotal = Math.max(0, servicesSubtotal + charges - discounts);
    reservation.set('totalAmount', Math.round(finalTotal * 100) / 100);
  }

  // =================
  // PRIVATE HELPERS
  // =================

  /**
   * Get service counts for a reservation (total, assigned).
   * @param reservationId
   * @example
   */
  static async getServiceCounts(reservationId) {
    const resPointer = new Parse.Object('Reservation');
    resPointer.id = reservationId;

    const totalQuery = new Parse.Query('ReservationService');
    totalQuery.equalTo('reservationPtr', resPointer);
    totalQuery.equalTo('active', true);
    totalQuery.equalTo('exists', true);
    const totalCount = await totalQuery.count({ useMasterKey: true });

    // Pendientes de asignación REALES: requieren asignación (no 'concepto') y siguen
    // 'pending'. Los concepto no requieren asignación → no cuentan como pendientes.
    const pendingQuery = new Parse.Query('ReservationService');
    pendingQuery.equalTo('reservationPtr', resPointer);
    pendingQuery.equalTo('active', true);
    pendingQuery.equalTo('exists', true);
    pendingQuery.notEqualTo('type', 'concepto');
    pendingQuery.equalTo('status', 'pending');
    const pendingCount = await pendingQuery.count({ useMasterKey: true });

    // "Asignados" = total menos los realmente pendientes (concepto cuenta como satisfecho).
    const assignedCount = totalCount - pendingCount;

    return { totalCount, assignedCount };
  }

  /**
   * Format a reservation for DataTable row.
   * @param reservation
   * @param serviceCount
   * @example
   */
  /**
   * For a page of reservations, return the Set of quote objectIds that have a
   * pending CancellationRequest. One batched query instead of N per-row lookups,
   * so the table can flag reservations awaiting cancellation approval.
   * @param {Array<Parse.Object>} reservations - Reservation page results.
   * @returns {Promise<Set<string>>} Set of quoteId strings with a pending request.
   * @example
   */
  static async getPendingCancellationQuoteIds(reservations) {
    const quotes = reservations.map((r) => r.get('quotePtr')).filter(Boolean);
    if (quotes.length === 0) return new Set();
    const query = new Parse.Query('CancellationRequest');
    query.containedIn('quote', quotes);
    query.equalTo('status', 'pending');
    query.equalTo('exists', true);
    query.select('quote');
    query.limit(1000);
    const requests = await query.find({ useMasterKey: true });
    return new Set(requests.map((req) => req.get('quote')?.id).filter(Boolean));
  }

  /**
   * For a page of reservations, return the Set of quote objectIds that have a
   * pending Invoice request. One batched query instead of N per-row lookups, so
   * the table can disable "Solicitar Factura" when a request is already pending.
   * @param {Array<Parse.Object>} reservations - Reservation page results.
   * @returns {Promise<Set<string>>} Set of quoteId strings with a pending request.
   * @example
   */
  static async getPendingInvoiceQuoteIds(reservations) {
    const quotes = reservations.map((r) => r.get('quotePtr')).filter(Boolean);
    if (quotes.length === 0) return new Set();
    const query = new Parse.Query('Invoice');
    query.containedIn('quote', quotes);
    query.equalTo('status', 'pending');
    query.equalTo('exists', true);
    query.select('quote');
    query.limit(1000);
    const requests = await query.find({ useMasterKey: true });
    return new Set(requests.map((req) => req.get('quote')?.id).filter(Boolean));
  }

  static formatReservationRow(
    reservation,
    serviceCount,
    hasPendingCancellation = false,
    hasPendingInvoiceRequest = false
  ) {
    // Cliente mostrado: se resuelve desde la cotización para reflejar el modelo real.
    // En una cotización 'direct' la persona es el cliente: nuevas llevan un AmexingUser
    // end_client en quotePtr.client; las legadas un Client en quotePtr.companyClientPtr.
    // En agencia, quotePtr.client = AmexingUser de la agencia. Si la cotización no lo
    // tiene, cae a clientPtr y luego a contactPerson.
    const quotePtr = reservation.get('quotePtr');
    const quoteClient = quotePtr ? quotePtr.get('client') : null; // AmexingUser
    const quoteCompanyClient = quotePtr ? quotePtr.get('companyClientPtr') : null; // Client
    const isDirectQuote = quotePtr ? quotePtr.get('clientType') === 'direct' : false;

    let clientName = 'N/A';
    let clientType = null; // 'agency' | 'client' | null
    if (isDirectQuote) {
      // Cliente directo: el AmexingUser end_client (nuevas) o el Client legado.
      if (quoteClient) {
        clientName = `${quoteClient.get('firstName') || ''} ${quoteClient.get('lastName') || ''}`.trim()
          || quoteClient.get('email')
          || quoteClient.get('username') || 'N/A';
      } else if (quoteCompanyClient) {
        clientName = quoteCompanyClient.get('name') || 'N/A';
      }
      clientType = 'client';
    } else if (quoteClient) {
      const cd = quoteClient.get('contextualData');
      clientName = (cd && cd.companyName)
        || quoteClient.get('companyName')
        || `${quoteClient.get('firstName') || ''} ${quoteClient.get('lastName') || ''}`.trim()
        || quoteClient.get('username') || 'N/A';
      clientType = 'agency';
    } else if (quoteCompanyClient) {
      clientName = quoteCompanyClient.get('name') || 'N/A';
      clientType = 'client';
    } else {
      // Fallback: clientPtr (AmexingUser) y luego contactPerson.
      const client = reservation.get('clientPtr');
      if (client) {
        const contextualData = client.get('contextualData');
        clientName = (contextualData && contextualData.companyName)
          || client.get('fullName')
          || `${client.get('firstName') || ''} ${client.get('lastName') || ''}`.trim()
          || 'N/A';
      }
      if (clientName === 'N/A' || !clientName) {
        clientName = reservation.get('contactPerson') || 'N/A';
      }
    }

    const status = reservation.get('status');
    const quoteStatus = reservation.get('quotePtr')?.get('status') || '';

    // Propietario: la Reservation no lo tiene; vive en la cotización (quotePtr.owner).
    // Si la cotización no tiene un owner con nombre usable, caemos al creador (createdBy).
    const createdBy = reservation.get('createdBy');
    const quoteOwner = reservation.get('quotePtr')?.get('owner');
    const hasUsableOwner = quoteOwner
      && (quoteOwner.get('firstName') || quoteOwner.get('lastName') || quoteOwner.get('email'));
    const ownerSource = hasUsableOwner ? quoteOwner : createdBy;
    const ownerName = ownerSource
      ? (`${ownerSource.get('firstName') || ''} ${ownerSource.get('lastName') || ''}`.trim()
        || ownerSource.get('email') || ownerSource.get('username') || 'N/A')
      : 'N/A';
    console.log(`🔍 [API] Reservation ${reservation.get('folio')} - Quote status: ${quoteStatus}, Reservation status: ${status}`);

    return {
      id: reservation.id,
      folio: reservation.get('folio'),
      quoteId: reservation.get('quotePtr')?.id || '',
      quoteFolio: reservation.get('quotePtr')?.get('folio') || '',
      quoteStatus,
      clientName,
      clientType, // 'agency' | 'client' | null — para la etiqueta de tipo en la tabla
      // Cliente Final: copiado a la reservación desde la cotización (no hace falta el quote).
      contactPerson: reservation.get('contactPerson') || '',
      contactPhone: reservation.get('contactPhone') || '',
      // Teléfono del propietario, para cuando el contacto = propietario (fallback en la tabla).
      ownerPhone: ownerSource ? (ownerSource.get('phone') || '') : '',
      leadGuestFirstName: reservation.get('leadGuestFirstName') || '',
      leadGuestLastName: reservation.get('leadGuestLastName') || '',
      eventType: reservation.get('eventType') || '',
      startDate: reservation.get('startDate'),
      // endDate is exposed so the UI can explain (in local/dev) why a reservation
      // falls into the upcoming/ongoing/past filter. The date-filter queries use
      // both startDate and endDate, so showing endDate reveals data anomalies.
      endDate: reservation.get('endDate') || null,
      numberOfPeople: reservation.get('numberOfPeople'),
      totalAmount: reservation.get('totalAmount'),
      currency: reservation.get('currency'),
      totalServices: serviceCount.totalCount,
      assignedServices: serviceCount.assignedCount,
      status,
      // A <24h cancellation creates a pending request while the reservation stays
      // in its real status; flag it so the table shows "Pendiente de cancelación".
      hasPendingCancellation: !!hasPendingCancellation && status !== 'cancelled',
      // Flag para deshabilitar "Solicitar Factura" cuando ya hay una solicitud pendiente
      // para la cotización de esta reservación.
      hasPendingInvoiceRequest: !!hasPendingInvoiceRequest,
      owner: ownerName,
      ownerIsCreator: !hasUsableOwner, // true cuando se usó el creador como fallback
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }

  /**
   * Update reservation status based on service statuses.
   * @param reservation
   * @example
   */
  static async updateReservationStatus(reservation) {
    const svcQuery = new Parse.Query('ReservationService');
    svcQuery.equalTo('reservationPtr', reservation);
    svcQuery.equalTo('active', true);
    svcQuery.equalTo('exists', true);
    svcQuery.limit(1000);
    const services = await svcQuery.find({ useMasterKey: true });

    if (services.length === 0) return;

    const currentStatus = reservation.get('status');
    const statuses = services.map((s) => s.get('status'));
    // Los servicios tipo 'concepto' NO requieren asignación, así que no deben mantener
    // la reserva en 'pending' (Asignaciones pendientes). Se excluyen del check de asignación.
    const assignableStatuses = services
      .filter((s) => s.get('type') !== 'concepto')
      .map((s) => s.get('status'));
    const allCompleted = statuses.every((s) => s === 'completed' || s === 'cancelled');
    const allAssigned = assignableStatuses.every((s) => s === 'assigned' || s === 'completed' || s === 'cancelled');
    const someInProgress = statuses.some((s) => s === 'in_progress');

    let newStatus = currentStatus;

    // Preserve 'confirmed' and 'hold' statuses unless services are completed
    if (allCompleted) {
      newStatus = 'completed';
    } else if (someInProgress) {
      newStatus = 'in_progress';
    } else if (allAssigned && !['confirmed', 'hold'].includes(currentStatus)) {
      newStatus = 'assigned';
    } else if (!allAssigned && !['confirmed', 'hold'].includes(currentStatus)) {
      newStatus = 'pending';
    }
    // For 'confirmed' and 'hold', only change to 'in_progress' or 'completed'

    if (newStatus !== currentStatus) {
      reservation.set('status', newStatus);
      await reservation.save(null, { useMasterKey: true });
    }
  }
}

module.exports = ReservationController;
