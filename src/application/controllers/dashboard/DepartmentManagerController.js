const RoleBasedController = require('./base/RoleBasedController');
const logger = require('../../../infrastructure/logger');

/**
 * DepartmentManagerController - Implements department manager dashboard functionality.
 */
class DepartmentManagerController extends RoleBasedController {
  constructor() {
    super('department_manager');
  }

  /**
   * Redirects the department manager to the vehicles page as the default dashboard view.
   * Department managers are automatically directed to the vehicle fleet page upon login.
   * @function index
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for redirecting to vehicles page.
   * @returns {Promise<void>} - Redirects to vehicles page or handles errors.
   * @example
   * // GET /dashboard/department_manager
   * // Authenticated request from department manager
   * await departmentManagerController.index(req, res);
   * // Redirects to: /dashboard/department_manager/vehicles
   */
  async index(req, res) {
    try {
      const { user } = req;
      const agencyName = user?.fullName
        || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
        || 'Agente';

      const summary = await this.getDashboardData(req);

      const dashboardData = {
        agencyName,
        basePath: 'department_manager',
        segments: summary.segments,
        pendingPayments: summary.pendingPayments,
      };

      await this.renderRoleView(req, res, 'index', {
        title: 'Inicio',
        breadcrumb: null,
        dashboardData,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Calcula el resumen del dashboard, scopeado por rol y reusando los helpers existentes.
   * quoted = cotizaciones 'quoted'; hold = reservaciones con cotización 'hold'; scheduled =
   * reservaciones con cotización 'scheduled'; pendingPayments = reservaciones pending/partial
   * con saldo &gt; 0 (top 5). Todo en try/catch: si falla, devuelve ceros/vacío.
   * @param {object} req - Express request (user + role).
   * @returns {Promise<object>} Resumen con segments y pendingPayments.
   * @example
   * const summary = await controller.getDashboardData(req);
   */
  async getDashboardData(req) {
    const Parse = require('parse/node');
    const QuoteController = require('../api/QuoteController');
    const ReservationController = require('../api/ReservationController');

    const role = req.userRole || req.user?.role || 'department_manager';
    const summary = {
      segments: { quoted: 0, hold: 0, scheduled: 0 },
      pendingPayments: [],
    };

    // COTIZADO: cotizaciones 'quoted' (reusa el scoping por rol de QuoteController).
    try {
      const quotedQuery = await QuoteController.buildBaseQuoteQuery(req.user, role, 'quoted');
      summary.segments.quoted = await quotedQuery.count({ useMasterKey: true });
    } catch (e) {
      logger.warn('Dashboard: fallo al contar cotizaciones', { error: e.message });
    }

    // Reservaciones (scopeadas por rol con getRoleFilterPointers).
    try {
      const rfp = await ReservationController.getRoleFilterPointers(req);
      const scopeReservation = (query) => {
        query.equalTo('active', true);
        query.equalTo('exists', true);
        if (rfp && rfp.field && Array.isArray(rfp.pointers)) {
          query.containedIn(rfp.field, rfp.pointers);
        }
        return query;
      };

      // AGENDADO (pendiente): reservaciones cuya cotización está en 'hold'.
      const holdQuote = new Parse.Query('Quote');
      holdQuote.equalTo('status', 'hold');
      const holdRes = scopeReservation(new Parse.Query('Reservation'));
      holdRes.matchesQuery('quotePtr', holdQuote);
      summary.segments.hold = await holdRes.count({ useMasterKey: true });

      // CONFIRMADO: reservaciones cuya cotización está 'scheduled'.
      const schedQuote = new Parse.Query('Quote');
      schedQuote.equalTo('status', 'scheduled');
      const schedRes = scopeReservation(new Parse.Query('Reservation'));
      schedRes.matchesQuery('quotePtr', schedQuote);
      summary.segments.scheduled = await schedRes.count({ useMasterKey: true });

      // PENDIENTES DE PAGO: paymentStatus pending/partial, saldo > 0 (top 5, más próximas).
      const payRes = scopeReservation(new Parse.Query('Reservation'));
      payRes.containedIn('paymentStatus', ['pending', 'partial']);
      payRes.greaterThan('balance', 0);
      payRes.ascending('startDate');
      payRes.limit(5);
      const rows = await payRes.find({ useMasterKey: true });
      summary.pendingPayments = rows.map((r) => {
        // Cliente Final = contactPerson (o lead guest), igual que la columna de la tabla de reservaciones.
        const contactPerson = (r.get('contactPerson') || '').trim();
        const leadGuest = `${r.get('leadGuestFirstName') || ''} ${r.get('leadGuestLastName') || ''}`.trim();
        const balance = Number(r.get('balance') || 0);
        const start = r.get('startDate');
        return {
          folio: r.get('folio') || '',
          client: contactPerson || leadGuest || '—',
          date: start ? new Date(start).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
          balance: `$ ${balance.toLocaleString('es-MX')}`,
          status: r.get('paymentStatus') || 'pending',
        };
      });
    } catch (e) {
      logger.warn('Dashboard: fallo al contar reservaciones', { error: e.message });
    }

    return summary;
  }

  /**
   * Renders the team management page for viewing and managing department team members.
   * Provides interface for team oversight, performance tracking, and member management.
   * @function team
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the team management view.
   * @returns {Promise<void>} - Renders the team management view or handles errors.
   * @example
   * // GET /dashboard/department_manager/team
   * // Authenticated request from department manager
   * await departmentManagerController.team(req, res);
   * // Renders team management page with:
   * // - List of team members
   * // - Team performance metrics
   * // - Member status and availability
   * // - Team activity history
   */
  async team(req, res) {
    try {
      // For department manager role, the user IS the client, so use their own ID
      const { user } = req;

      // If admin is viewing, we need to use a placeholder or skip the client ID
      // Since admin doesn't have a specific client/department, we'll use a placeholder
      let clientId = user?.id;
      let departmentId = user?.departmentId || user?.organizationId || '';
      let departmentName = user?.departmentName || 'Department';

      // For admin/superadmin viewing department_manager dashboard
      // We'll use a placeholder ID that the API can handle
      if (user?.role === 'admin' || user?.role === 'superadmin') {
        clientId = 'admin-view'; // Special placeholder for admin viewing
        departmentId = 'admin-department';
        departmentName = 'Admin View';
      }

      await this.renderRoleView(req, res, 'team', {
        title: 'My Team',
        departmentId,
        departmentName,
        clientId,
        team: [],
        breadcrumb: {
          title: 'My Team',
          items: [
            { name: 'Dashboard', url: '/dashboard/department_manager' },
            { name: 'My Team', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department budget management page for tracking and allocating budget resources.
   * Displays budget allocation, spending, available funds, and budget utilization metrics.
   * @function budgets
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the budget management view.
   * @returns {Promise<void>} - Renders the budget management view or handles errors.
   * @example
   * // GET /dashboard/department_manager/budgets
   * // Authenticated request from department manager
   * await departmentManagerController.budgets(req, res);
   * // Renders budget page with:
   * // - Total department budget allocation
   * // - Current spending and remaining balance
   * // - Budget utilization percentage
   * // - Category-wise budget breakdown
   * // - Historical spending trends
   */
  async budgets(req, res) {
    try {
      await this.renderRoleView(req, res, 'budgets', {
        title: 'Department Budget',
        budget: {},
        breadcrumb: {
          title: 'Budget',
          items: [{ name: 'Budget', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department quotes page for viewing and managing department quotes.
   * Displays quotes created by users within the department manager's department.
   * Uses the same API as admin quotes but with department-level filtering.
   * @function quotes
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the quotes view.
   * @returns {Promise<void>} - Renders the department quotes view or handles errors.
   * @example
   * // GET /dashboard/department_manager/quotes
   * // Authenticated request from department manager
   * await departmentManagerController.quotes(req, res);
   * // Renders quotes page with:
   * // - Department-filtered quotes list
   * // - DataTables integration
   * // - Quote management actions
   * // - Department-specific statistics
   */
  async quotes(req, res) {
    try {
      await this.renderRoleView(req, res, 'quotes', {
        title: 'Cotizaciones del Departamento',
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department bookings/reservations list page.
   * @function bookings
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the bookings view.
   * @returns {Promise<void>} - Renders the department bookings view or handles errors.
   * @example
   * // GET /dashboard/department_manager/bookings
   * await departmentManagerController.bookings(req, res);
   */
  async bookings(req, res) {
    try {
      await this.renderRoleView(req, res, 'bookings', {
        title: 'Reservaciones del Departamento',
        breadcrumb: null,
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department booking detail page.
   * @function bookingDetail
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the booking detail view.
   * @returns {Promise<void>} - Renders the department booking detail view or handles errors.
   * @example
   * // GET /dashboard/department_manager/bookings/:id
   * await departmentManagerController.bookingDetail(req, res);
   */
  async bookingDetail(req, res) {
    try {
      const reservationId = req.params.id;
      await this.renderRoleView(req, res, 'booking-detail', {
        title: `Reservación ${reservationId}`,
        breadcrumb: null,
        reservationId,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department invoices page for viewing and downloading invoice files.
   * Shows quotes with completed invoices that have XML and PDF files available for download.
   * Department managers can only access invoices for quotes created by users in their department.
   * @function invoices
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the invoices view.
   * @returns {Promise<void>} - Renders the department invoices view or handles errors.
   * @example
   * // GET /dashboard/department_manager/invoices
   * // Authenticated request from department manager
   * await departmentManagerController.invoices(req, res);
   * // Renders invoices page with:
   * // - Quotes with completed invoices
   * // - Download buttons for XML and PDF files
   * // - Department-filtered results
   * // - DataTables integration
   */
  async invoices(req, res) {
    try {
      await this.renderRoleView(req, res, 'invoices', {
        title: 'Facturas del Departamento',
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department quote detail page for viewing and managing a specific quote.
   * Department managers can only access quotes created by users in their department.
   * @function quoteDetail
   * @param {object} req - Express request object containing user session and quote ID.
   * @param {object} res - Express response object for rendering the quote detail view.
   * @returns {Promise<void>} - Renders the department quote detail view or handles errors.
   * @example
   * // GET /dashboard/department_manager/quotes/abc123
   * // Authenticated request from department manager
   * await departmentManagerController.quoteDetail(req, res);
   * // Renders quote detail page with:
   * // - Quote information and services
   * // - Department-level access validation
   * // - Quote management interface
   */
  async quoteDetail(req, res) {
    try {
      const quoteId = req.params.id;
      const section = req.query.section || 'information';

      const isNewQuote = quoteId === 'new';

      // Traer estado + total de la cotización para pintar el panel (timeline + botón
      // "Solicitar Servicios") server-side y que no espere al fetch del cliente.
      let quoteStatus = '';
      let quoteTotal = 0;
      if (!isNewQuote) {
        try {
          const Parse = require('parse/node');
          const q = new Parse.Query('Quote');
          q.equalTo('exists', true);
          const quote = await q.get(quoteId, { useMasterKey: true });
          if (quote) {
            quoteStatus = quote.get('status') || '';
            quoteTotal = (quote.get('serviceItems') || {}).total || 0;
          }
        } catch (e) { /* noop: el cliente lo resuelve por fetch */ }
      }

      await this.renderRoleView(req, res, 'quote-detail', {
        title: isNewQuote ? 'Nueva Cotización' : `Cotización ${quoteId}`,
        breadcrumb: null,
        quoteId,
        isNewQuote,
        quoteStatus,
        quoteTotal,
        currentSection: section,
        pageStyles: ['https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/css/tom-select.css'],
        footerScripts: `
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department vehicles page for viewing and managing vehicle fleet.
   * Department managers can view vehicles assigned to their department and vehicle types.
   * Supports sections: 'vehicles' (default) and 'types' for vehicle type management.
   * @function vehicles
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the vehicles view.
   * @returns {Promise<void>} - Renders the department vehicles view or handles errors.
   * @example
   * // GET /dashboard/department_manager/vehicles
   * // GET /dashboard/department_manager/vehicles?section=types
   * await departmentManagerController.vehicles(req, res);
   */
  async vehicles(req, res) {
    try {
      const section = req.query.section || 'vehicles'; // Default to vehicles page

      await this.renderRoleView(req, res, 'vehicles', {
        title: 'Vehículos',
        section,
        breadcrumb: {
          title: 'Vehículos',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Vehículos', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department services page for viewing and managing transport services.
   * Department managers can view services/transfers available for their department.
   * Supports sections: 'airport' (default), 'p2p' (punto a punto), and 'local' for service type management.
   * @function services
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the services view.
   * @returns {Promise<void>} - Renders the department services view or handles errors.
   * @example
   * // GET /dashboard/department_manager/services
   * // GET /dashboard/department_manager/services?section=p2p
   * // GET /dashboard/department_manager/services?section=local
   * await departmentManagerController.services(req, res);
   */
  async services(req, res) {
    try {
      const section = req.query.section || 'airport';

      // For department manager role, use user's objectId as clientId (not clientId field)
      const { user } = req;
      const clientId = user?.id;

      await this.renderRoleView(req, res, 'services', {
        title: 'Traslados',
        section,
        clientId, // Pass the user's objectId as clientId
        breadcrumb: {
          title: 'Traslados',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Traslados', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department experiences page for viewing and managing experiences.
   * Department managers can view experiences available for their department events and providers.
   * Supports sections: 'experiences' (default) and 'providers' for experience providers management.
   * @function experiences
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the experiences view.
   * @returns {Promise<void>} - Renders the department experiences view or handles errors.
   * @example
   * // GET /dashboard/department_manager/experiences
   * // GET /dashboard/department_manager/experiences?section=providers
   * await departmentManagerController.experiences(req, res);
   */
  async experiences(req, res) {
    try {
      const section = req.query.section || 'experiences'; // Default to experiences since providers is hidden for department_manager

      await this.renderRoleView(req, res, 'experiences', {
        title: 'Experiencias',
        section,
        breadcrumb: {
          title: 'Experiencias',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Experiencias', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department tours page for viewing and managing tour packages.
   * Department managers can view tours available for their department events.
   * @function tours
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the tours view.
   * @returns {Promise<void>} - Renders the department tours view or handles errors.
   * @example
   * // GET /dashboard/department_manager/tours
   * await departmentManagerController.tours(req, res);
   */
  async tours(req, res) {
    try {
      // For department manager role, use user's objectId as clientId (not clientId field)
      const { user } = req;
      const clientId = user?.id;

      await this.renderRoleView(req, res, 'tours', {
        title: 'Tours',
        clientId, // Pass the user's objectId as clientId
        breadcrumb: {
          title: 'Tours',
          items: [
            { name: 'Servicios', url: '#' },
            { name: 'Tours', active: true },
          ],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
          'https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/css/tom-select.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
          <!-- Tom Select -->
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * A Disposición calculator page for department managers.
   * Hourly vehicle rental pricing calculator with volume discounts.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
   * Created by Denisse Maldonado.
   */
  async aDisposicion(req, res) {
    try {
      await this.renderRoleView(req, res, 'a-disposicion', {
        title: 'Servicio a Disposición',
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [],
        footerScripts: '',
        csrfToken: res.locals.csrfToken, // Pass CSRF token to view
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Greeter services management page for department managers.
   * Manages greeter services with currency and payment type filters.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
   * Created by Denisse Maldonado.
   */
  async greeter(req, res) {
    try {
      await this.renderRoleView(req, res, 'greeter', {
        title: 'Gestión de Greeter',
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <!-- DataTables Core -->
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the department reports page for viewing analytics and performance metrics.
   * Provides access to department-specific reports including team performance, budget analysis,
   * booking statistics, and operational insights.
   * @function reports
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the reports view.
   * @returns {Promise<void>} - Renders the department reports view or handles errors.
   * @example
   * // GET /dashboard/department_manager/reports
   * // Authenticated request from department manager
   * await departmentManagerController.reports(req, res);
   * // Renders reports page with:
   * // - Team performance reports
   * // - Budget utilization analysis
   * // - Booking activity statistics
   * // - Departmental KPI metrics
   * // - Exportable report data
   */
  async reports(req, res) {
    try {
      await this.renderRoleView(req, res, 'reports', {
        title: 'Department Reports',
        reports: [],
        breadcrumb: {
          title: 'Reports',
          items: [{ name: 'Reports', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Retrieves current department statistics including team size, budget, and activity metrics.
   * This helper method provides aggregated data for the dashboard overview.
   * @function getDepartmentStats
   * @returns {Promise<object>} Promise resolving to department statistics object containing
   * teamMembers (number) - Total number of team members in the department,
   * departmentBudget (number) - Total allocated budget for the department,
   * budgetUsed (number) - Amount of budget currently utilized,
   * pendingApprovals (number) - Number of items awaiting manager approval,
   * activeBookings (number) - Count of active transportation bookings.
   * @example
   * // Get department statistics for dashboard
   * const stats = await departmentManagerController.getDepartmentStats();
   * // Returns:
   * // {
   * //   teamMembers: 25,
   * //   departmentBudget: 15000,
   * //   budgetUsed: 8500,
   * //   pendingApprovals: 3,
   * //   activeBookings: 12
   * // }
   */
  async getDepartmentStats() {
    return {
      teamMembers: 25,
      departmentBudget: 15000,
      budgetUsed: 8500,
      pendingApprovals: 3,
      activeBookings: 12,
    };
  }

  /**
   * Tarifario export page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Renders the tarifario export page.
   * @example
   * // GET /dashboard/department_manager/tarifario-export
   * await departmentManagerController.tarifarioExport(req, res);
   */
  async tarifarioExport(req, res) {
    try {
      await this.renderRoleView(req, res, 'tarifario-export', {
        title: 'Exportar Tarifario',
        breadcrumb: null,
        pageStyles: [],
        footerScripts: '',
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the owned clients management page.
   * Allows department_manager role users to manage their own clients.
   * Created by Denisse Maldonado.
   * @function ownedClients
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the owned clients view.
   * @returns {Promise<void>} - Renders the owned clients view or handles errors.
   * @example
   * // GET /dashboard/department_manager/clients
   * await departmentManagerController.ownedClients(req, res);
   */
  async ownedClients(req, res) {
    try {
      await this.renderRoleView(req, res, 'owned-clients', {
        title: 'Mis Clientes',
        breadcrumb: null,
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }
}

module.exports = new DepartmentManagerController();
