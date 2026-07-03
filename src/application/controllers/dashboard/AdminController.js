const RoleBasedController = require('./base/RoleBasedController');

/**
 * AdminController - Implements admin-specific dashboard functionality.
 */
/* eslint-disable max-lines */
class AdminController extends RoleBasedController {
  constructor() {
    super('admin');
  }

  /**
   * Dashboard index page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await index(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async index(req, res) {
    try {
      await this.renderRoleView(req, res, 'index', {
        title: 'Tablero de Control',
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Clients page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await clients(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async clients(req, res) {
    try {
      await this.renderRoleView(req, res, 'clients', {
        title: 'Gestión de Clientes',
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
   * Client detail page.
   * Shows complete client information with vertical navigation menu.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await clientDetail(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  /* eslint-disable max-lines-per-function */
  async clientDetail(req, res) {
    try {
      const clientId = req.params.id;
      const currentUser = req.user;

      if (!clientId) {
        return this.handleError(res, new Error('ID de cliente no proporcionado'), 400);
      }

      if (!currentUser) {
        return this.handleError(res, new Error('Autenticación requerida'), 401);
      }

      // Use UserManagementService directly instead of HTTP call
      const UserManagementService = require('../../services/UserManagementService');
      const userService = new UserManagementService();

      // Agencies and people-type clients (role 'end_client') live in AmexingUser; legacy
      // direct clients live in the Client class. Try the user service first, then fall back.
      let client = await userService.getUserById(currentUser, clientId).catch(() => null);
      const isAmexingUser = !!client; // getUserById hit ⇒ this is an AmexingUser

      if (!client) {
        const Parse = require('parse/node');
        client = await new Parse.Query('Client').get(clientId, { useMasterKey: true }).catch(() => null);
      }

      if (!client) {
        return this.handleError(res, new Error('Cliente no encontrado'), 404);
      }

      // PCI DSS Audit: Log individual READ access to client data from dashboard
      const { logReadAccess } = require('../../utils/auditHelper');
      await logReadAccess(req, client, 'Client');

      // Log role for debugging (optional - can be removed in production)
      const role = client.roleId || client.role;
      const roleName = typeof role === 'string' ? role : role?.name;
      const logger = require('../../../infrastructure/logger');
      logger.info('Client detail view accessed', {
        clientId,
        roleName,
        accessedBy: currentUser.id,
      });

      // Transform Parse object to plain object if needed
      const clientData = {
        id: client.id || client.objectId,
        firstName: client.firstName || client.get?.('firstName'),
        lastName: client.lastName || client.get?.('lastName'),
        email: client.email || client.get?.('email'),
        username: client.username || client.get?.('username'),
        phone: client.phone || client.get?.('phone'),
        active: typeof client.active !== 'undefined' ? client.active : client.get?.('active'),
        companyName:
          client.companyName
          || client.get?.('companyName')
          || client.contextualData?.companyName
          || client.get?.('contextualData')?.companyName,
        taxId:
          client.taxId
          || client.get?.('taxId')
          || client.contextualData?.taxId
          || client.get?.('contextualData')?.taxId,
        website:
          client.website
          || client.get?.('website')
          || client.contextualData?.website
          || client.get?.('contextualData')?.website,
        notes:
          client.notes
          || client.get?.('notes')
          || client.contextualData?.notes
          || client.get?.('contextualData')?.notes,
        address: client.address || client.get?.('address') || {},
        contextualData: client.contextualData || client.get?.('contextualData') || {},
        clientCategory: client.clientCategory || client.get?.('clientCategory') || null,
        isAmexingUser, // people-type clients/agents are AmexingUser → profile uses /api/agents/:id
        roleName: client.role || client.roleName || client.get?.('role') || null, // agencies = department_manager
        birthDate: client.birthDate || client.get?.('birthDate') || null,
        anniversary: client.anniversary || client.get?.('anniversary') || null,
        createdAt: client.createdAt || client.get?.('createdAt'),
        updatedAt: client.updatedAt || client.get?.('updatedAt'),
      };

      // Determine active section (default: information)
      const section = req.query.section || 'information';

      // Determine active subsection for tarifario
      const subsection = req.query.subsection || null;

      // Determine display name for the client
      let displayName = '';
      if (clientData.companyName) {
        displayName = clientData.companyName;
      } else if (clientData.firstName || clientData.lastName) {
        displayName = `${clientData.firstName || ''} ${clientData.lastName || ''}`.trim();
      } else if (clientData.email) {
        displayName = clientData.email;
      } else {
        displayName = 'Cliente sin nombre';
      }

      // Prepare view data
      const viewData = {
        title: `Cliente: ${displayName}`,
        client: clientData,
        section,
        subsection,
        breadcrumb: null, // Disable automatic breadcrumb generation
      };

      // Add DataTables assets if employees or tarifario section is active
      if (section === 'employees' || section === 'tarifario') {
        viewData.pageStyles = [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ];

        viewData.footerScripts = `
          <!-- DataTables Core -->
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
        `;
      }

      // Use renderRoleView which handles the layout properly
      await this.renderRoleView(req, res, 'client-detail', viewData);
    } catch (error) {
      const logger = require('../../../infrastructure/logger');
      logger.error('Error in AdminController.clientDetail', {
        error: error.message,
        stack: error.stack,
        clientId: req.params.id,
        userId: req.user?.id,
      });
      this.handleError(res, error);
    }
  }

  /**
   * Departments page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await departments(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async departments(req, res) {
    try {
      await this.renderRoleView(req, res, 'departments', {
        title: 'Department Management',
        departments: [],
        breadcrumb: {
          title: 'Departments',
          items: [{ name: 'Departments', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Employees page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await employees(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async employees(req, res) {
    try {
      await this.renderRoleView(req, res, 'employees', {
        title: 'Gestión de Empleados',
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
   * Drivers page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await drivers(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async drivers(req, res) {
    try {
      await this.renderRoleView(req, res, 'drivers', {
        title: 'Driver Management',
        drivers: [],
        breadcrumb: {
          title: 'Drivers',
          items: [{ name: 'Drivers', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Bookings page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await bookings(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async bookings(req, res) {
    try {
      await this.renderRoleView(req, res, 'bookings', {
        title: 'Gestión de Reservaciones',
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
   * Render booking detail page for a reservation.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
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
   * Events management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await events(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async events(req, res) {
    try {
      await this.renderRoleView(req, res, 'events', {
        title: 'Gestión de Eventos',
        breadcrumb: null, // Disable automatic breadcrumb
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Experiences management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await experiences(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async experiences(req, res) {
    try {
      // Get section from query parameter (default: experiences)
      const section = req.query.section || 'experiences';

      await this.renderRoleView(req, res, 'experiences', {
        title: 'Gestión de Experiencias',
        section, // Pass section to view
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
          'https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/css/tom-select.css',
        ],
        footerScripts: `
          <!-- DataTables Core -->
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
          <!-- Tom Select for Enhanced Multi-Select -->
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Experience detail page with sections (information, services).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async experienceDetail(req, res) {
    try {
      const experienceId = req.params.id;
      const isNewExperience = experienceId === 'new';

      await this.renderRoleView(req, res, 'experience-detail', {
        title: isNewExperience ? 'Nueva Experiencia' : 'Experiencia',
        breadcrumb: null,
        experienceId,
        isNewExperience,
        pageStyles: [
          'https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/css/tom-select.css',
        ],
        footerScripts: `
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Schedule calendar page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await schedule(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async schedule(req, res) {
    try {
      await this.renderRoleView(req, res, 'schedule', {
        title: 'Calendario de Programación',
        breadcrumb: null, // Disable automatic breadcrumb
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Points of Interest (POIs) management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await pois(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async pois(req, res) {
    try {
      await this.renderRoleView(req, res, 'pois', {
        title: 'Puntos de Interés',
        section: req.query.section || 'pois',
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
   * Services management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await services(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async services(req, res) {
    try {
      // Menu items configuration for services submenu
      const menuItems = [
        {
          label: 'Aeropuerto',
          icon: 'plane',
          section: 'airport',
          href: '/dashboard/admin/services?section=airport',
        },
        {
          label: 'Punto a Punto',
          icon: 'route',
          section: 'p2p',
          href: '/dashboard/admin/services?section=p2p',
        },
        {
          label: 'Local',
          icon: 'map-pin',
          section: 'local',
          href: '/dashboard/admin/services?section=local',
        },
      ];

      await this.renderRoleView(req, res, 'services', {
        title: 'Gestión de Traslados',
        section: req.query.section || 'airport',
        menuItems,
        breadcrumb: null, // Disable automatic breadcrumb
        isDevelopment: process.env.NODE_ENV === 'development', // Pass development flag
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
          <!-- Tom Select for Enhanced Select -->
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Pricing management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await pricing(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async pricing(req, res) {
    try {
      await this.renderRoleView(req, res, 'pricing', {
        title: 'Gestión de Tarifas',
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
   * Tours management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await tours(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async tours(req, res) {
    try {
      await this.renderRoleView(req, res, 'tours', {
        title: 'Gestión de Tours',
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
          'https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/css/tom-select.css',
        ],
        footerScripts: `
          <!-- DataTables Core -->
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
          <!-- Tom Select for Enhanced Select -->
          <script src="https://cdn.jsdelivr.net/npm/tom-select@2.4.3/dist/js/tom-select.complete.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Render greeter management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
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
   * Quotes management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  /**
   * Payment Info management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async paymentInfo(req, res) {
    try {
      await this.renderRoleView(req, res, 'payment-info', {
        title: 'Métodos de Pago',
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
   * Display quotes management dashboard.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Renders quotes management view.
   * @author Denisse Maldonado
   * @since 1.0.0
   * @example
   */
  async quotes(req, res) {
    try {
      await this.renderRoleView(req, res, 'quotes', {
        title: 'Gestión de Cotizaciones',
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
   * Quote detail page with sections (information, services, summary).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   */
  async quoteDetail(req, res) {
    try {
      const quoteId = req.params.id;
      const section = req.query.section || 'information';

      const isNewQuote = quoteId === 'new';

      // The relabel to "Reservación" is driven by the CONTEXT it was opened in,
      // not by whether a reservation exists: opened from the bookings list
      // (?context=reservation) it reads as a reservation; opened from the quotes
      // list it stays "Cotización" even if a reservation already exists.
      const isReservation = req.query.context === 'reservation';
      let reservationFolio = '';
      let reservationId = '';
      let reservationStatus = '';
      let hasPendingCancellation = false;
      if (isReservation && !isNewQuote) {
        try {
          const Parse = require('parse/node');
          const resQuery = new Parse.Query('Reservation');
          resQuery.equalTo('quotePtr', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
          resQuery.equalTo('active', true);
          resQuery.equalTo('exists', true);
          const reservation = await resQuery.first({ useMasterKey: true });
          if (reservation) {
            reservationFolio = reservation.get('folio') || '';
            reservationId = reservation.id;
            reservationStatus = reservation.get('status') || '';
          }
          // A <24h cancellation creates a pending CancellationRequest instead of
          // cancelling immediately; surface it so the status control can show
          // "Cancelación solicitada" instead of silently staying "Confirmada".
          if (reservationStatus !== 'cancelled') {
            const pendingQuery = new Parse.Query('CancellationRequest');
            pendingQuery.equalTo('quote', { __type: 'Pointer', className: 'Quote', objectId: quoteId });
            pendingQuery.equalTo('status', 'pending');
            pendingQuery.equalTo('exists', true);
            const pendingCount = await pendingQuery.count({ useMasterKey: true });
            hasPendingCancellation = pendingCount > 0;
          }
        } catch (e) {
          reservationFolio = '';
        }
      }
      const entityLabel = isReservation ? 'Reservación' : 'Cotización';

      await this.renderRoleView(req, res, 'quote-detail', {
        // Browser tab: "Cotización"/"Reservación" without the folio/id (the
        // layout appends " - Amexing"). New quotes keep the "Nueva" prefix.
        title: isNewQuote ? `Nueva ${entityLabel}` : entityLabel,
        breadcrumb: null,
        quoteId,
        isNewQuote,
        isReservation,
        reservationFolio,
        reservationId,
        reservationStatus,
        hasPendingCancellation,
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
   * Fleet management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await fleet(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async fleet(req, res) {
    try {
      await this.renderRoleView(req, res, 'fleet', {
        title: 'Fleet Management',
        vehicles: [],
        breadcrumb: {
          title: 'Fleet',
          items: [{ name: 'Fleet', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Vehicle management page with sections (vehicles, types).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await vehicles(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async vehicles(req, res) {
    try {
      // Get section from query parameter (default: vehicles)
      const section = req.query.section || 'vehicles';

      await this.renderRoleView(req, res, 'vehicles', {
        title: 'Gestión de Vehículos',
        section, // Pass section to view
        breadcrumb: null, // Disable automatic breadcrumb
        pageStyles: [
          'https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
          'https://unpkg.com/dropzone@6/dist/dropzone.css',
        ],
        footerScripts: `
          <!-- DataTables Core -->
          <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>

          <!-- Dropzone for Image Upload -->
          <script src="https://unpkg.com/dropzone@6/dist/dropzone-min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Routes and zones page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await routes(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async routes(req, res) {
    try {
      await this.renderRoleView(req, res, 'routes', {
        title: 'Routes & Zones',
        routes: [],
        breadcrumb: {
          title: 'Routes & Zones',
          items: [{ name: 'Routes', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Billing page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await billing(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async billing(req, res) {
    try {
      await this.renderRoleView(req, res, 'billing', {
        title: 'Billing Management',
        invoices: [],
        breadcrumb: {
          title: 'Billing',
          items: [{ name: 'Billing', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Reports page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await reports(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async reports(req, res) {
    try {
      await this.renderRoleView(req, res, 'reports', {
        title: 'Reportes de Auditoría',
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
   * Settings page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await settings(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async settings(req, res) {
    try {
      await this.renderRoleView(req, res, 'settings', {
        title: 'Admin Settings',
        settings: {},
        breadcrumb: {
          title: 'Settings',
          items: [{ name: 'Settings', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Notifications page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await notifications(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async notifications(req, res) {
    try {
      await this.renderRoleView(req, res, 'notifications', {
        title: 'Notification Settings',
        notifications: [],
        breadcrumb: {
          title: 'Notifications',
          items: [{ name: 'Notifications', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get operational statistics.
   * @example
   * // GET endpoint example
   * const result = await AdminController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getOperationalStats() {
    return {
      activeClients: 42,
      totalBookings: 156,
      todayBookings: 23,
      activeDrivers: 87,
      availableVehicles: 65,
      pendingApprovals: 8,
      monthlyRevenue: 125000,
      completionRate: '94%',
    };
  }

  /**
   * Get recent bookings.
   * @example
   * // GET endpoint example
   * const result = await AdminController.getNotifications(req, res);
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async getRecentBookings() {
    return [
      {
        id: 'BK001',
        client: 'Acme Corp',
        date: new Date(),
        status: 'confirmed',
        driver: 'John Doe',
      },
      {
        id: 'BK002',
        client: 'Tech Solutions',
        date: new Date(),
        status: 'pending',
        driver: 'Pending Assignment',
      },
    ];
  }

  /**
   * Invoices management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await invoices(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async invoices(req, res) {
    try {
      await this.renderRoleView(req, res, 'invoices', {
        title: 'Gestión de Facturas',
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
   * Vehicle types data endpoint for DataTables (session-based auth).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await vehicleTypesData(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async vehicleTypesData(req, res) {
    try {
      const VehicleTypeController = require('../api/VehicleTypeController');

      // Forward the request to the API controller
      // The API controller will handle all DataTables parameters and return the expected format
      await VehicleTypeController.getVehicleTypes(req, res);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get tours data for DataTable with session-based authentication
   * Forwards request to API controller for tours data.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to tours data in DataTable format.
   * @example
   */
  async toursData(req, res) {
    try {
      const ToursController = require('../api/ToursController');

      // Forward the request to the API controller
      // The API controller will handle all DataTables parameters and return the expected format
      await ToursController.getTours(req, res);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get experiences data in DataTable format for dashboard.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to experiences data in DataTable format.
   * @example
   */
  async experiencesData(req, res) {
    try {
      const ExperienceController = require('../api/ExperienceController');

      // Forward the request to the API controller
      // The API controller will handle all DataTables parameters and return the expected format
      await ExperienceController.getExperiences(req, res);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Get disposable prices data with session-based authentication
   * Forwards request to API controller for disposable prices data.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to disposable prices data.
   * @example
   */
  async disposablePricesData(req, res) {
    try {
      const DisposablePricesController = require('../api/DisposablePricesController');

      // Forward the request to the API controller
      // Use getCurrentPrices to get all price combinations for admin management
      await DisposablePricesController.getCurrentPrices(req, res);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Batch update disposable prices with session-based authentication
   * Forwards request to API controller for batch price updates.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to update results.
   * @example
   */
  async disposablePricesBatchUpdate(req, res) {
    try {
      const DisposablePricesController = require('../api/DisposablePricesController');

      // Forward the request to the API controller
      await DisposablePricesController.batchUpdatePrices(req, res);
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Price Settings management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await priceSettings(parameters);
   * // Returns: operation result
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async priceSettings(req, res) {
    try {
      // Import rate models
      const ExchangeRate = require('../../../domain/models/ExchangeRate');
      const InflationRate = require('../../../domain/models/InflationRate');
      const AgencyRate = require('../../../domain/models/AgencyRate');
      const TransferRate = require('../../../domain/models/TransferRate');
      const DriverTourRate = require('../../../domain/models/DriverTourRate');
      const GuideTransportRate = require('../../../domain/models/GuideTransportRate');
      const GreeterRate = require('../../../domain/models/GreeterRate');

      // Get current rates
      let currentExchangeRate = await ExchangeRate.getCurrentExchangeRate();
      let currentInflationRate = await InflationRate.getCurrentInflationRate();
      let currentAgencyRate = await AgencyRate.getCurrentAgencyRate();
      let currentTransferRate = await TransferRate.getCurrentTransferRate();
      let currentDriverTourRate = await DriverTourRate.getCurrentDriverTourRate();
      let currentGuideTransportRate = await GuideTransportRate.getCurrentRate();
      let currentGreeterRate = await GreeterRate.getCurrentRate();

      // Create default inflation rate if none exists
      if (!currentInflationRate) {
        try {
          currentInflationRate = await InflationRate.createInflationRate({
            value: 5.25,
            description: 'Tasa de inflación inicial del sistema',
            createdBy: null,
          });
        } catch (error) {
          console.warn('Could not create default inflation rate:', error.message);
        }
      }

      // Create default agency rate if none exists
      if (!currentAgencyRate) {
        try {
          currentAgencyRate = await AgencyRate.createAgencyRate({
            value: 15.0,
            description: 'Rate de agencia inicial del sistema',
            createdBy: null,
          });
        } catch (error) {
          console.warn('Could not create default agency rate:', error.message);
        }
      }

      // Create default transfer rate if none exists
      if (!currentTransferRate) {
        try {
          currentTransferRate = await TransferRate.createTransferRate({
            value: 3.0,
            description: 'Porcentaje de traslado inicial del sistema',
            createdBy: null,
          });
        } catch (error) {
          console.warn('Could not create default transfer rate:', error.message);
        }
      }

      // Create default driver tour rate if none exists
      if (!currentDriverTourRate) {
        try {
          currentDriverTourRate = await DriverTourRate.createDriverTourRate({
            value: 635.0,
            description: 'Tarifa por defecto para tours con guía+chofer',
            createdBy: null,
          });
        } catch (error) {
          console.warn('Could not create default driver tour rate:', error.message);
        }
      }

      // Create default guide transport rate if none exists
      if (!currentGuideTransportRate) {
        try {
          currentGuideTransportRate = await GuideTransportRate.createDefaultIfNotExists();
        } catch (error) {
          console.warn('Could not create default guide transport rate:', error.message);
        }
      }

      // Create default greeter rate if none exists
      if (!currentGreeterRate) {
        try {
          currentGreeterRate = await GreeterRate.createDefaultIfNotExists();
        } catch (error) {
          console.warn('Could not create default greeter rate:', error.message);
        }
      }

      // Create default exchange rate if none exists
      if (!currentExchangeRate) {
        try {
          currentExchangeRate = await ExchangeRate.createExchangeRate({
            value: 18.5,
            description: 'Tipo de cambio inicial del sistema (USD a MXN)',
            createdBy: null,
          });
        } catch (error) {
          console.warn('Could not create default exchange rate:', error.message);
        }
      }

      const exchangeValue = currentExchangeRate ? currentExchangeRate.get('value') : 18.5;
      const inflationValue = currentInflationRate ? currentInflationRate.get('value') : 5.25;
      const agencyValue = currentAgencyRate ? currentAgencyRate.get('value') : 15.0;
      const transferValue = currentTransferRate ? currentTransferRate.get('value') : 3.0;
      const driverTourValue = currentDriverTourRate ? currentDriverTourRate.get('value') : 635.0;
      const guideTransportValue = currentGuideTransportRate ? currentGuideTransportRate.get('value') : 400.0;
      const greeterBasePrice = currentGreeterRate ? currentGreeterRate.get('basePrice') : 760.0;
      const greeterHourlyRate = currentGreeterRate ? currentGreeterRate.get('hourlyRate') : 640.0;

      await this.renderRoleView(req, res, 'price-settings', {
        title: 'Ajustes de Precio',
        section: req.query.section || 'exchange-rate',
        currentExchangeRate: {
          value: exchangeValue,
          formatted: ExchangeRate.formatValue(exchangeValue),
          lastUpdated: currentExchangeRate ? currentExchangeRate.get('createdAt') : new Date(),
          id: currentExchangeRate ? currentExchangeRate.id : null,
        },
        currentInflationRate: {
          value: inflationValue,
          formatted: InflationRate.formatValue(inflationValue),
          lastUpdated: currentInflationRate ? currentInflationRate.get('createdAt') : new Date(),
          id: currentInflationRate ? currentInflationRate.id : null,
        },
        currentAgencyRate: {
          value: agencyValue,
          formatted: AgencyRate.formatValue(agencyValue),
          lastUpdated: currentAgencyRate ? currentAgencyRate.get('createdAt') : new Date(),
          id: currentAgencyRate ? currentAgencyRate.id : null,
        },
        currentTransferRate: {
          value: transferValue,
          formatted: TransferRate.formatValue(transferValue),
          lastUpdated: currentTransferRate ? currentTransferRate.get('createdAt') : new Date(),
          id: currentTransferRate ? currentTransferRate.id : null,
        },
        currentDriverTourRate: {
          value: driverTourValue,
          formatted: DriverTourRate.formatValue(driverTourValue),
          lastUpdated: currentDriverTourRate ? currentDriverTourRate.get('createdAt') : new Date(),
          id: currentDriverTourRate ? currentDriverTourRate.id : null,
        },
        currentGuideTransportRate: {
          value: guideTransportValue,
          formatted: currentGuideTransportRate ? currentGuideTransportRate.getFormattedValue() : '$400.00 MXN',
          lastUpdated: currentGuideTransportRate
            ? currentGuideTransportRate.get('effectiveDate') || currentGuideTransportRate.get('createdAt')
            : new Date(),
          id: currentGuideTransportRate ? currentGuideTransportRate.id : null,
        },
        currentGreeterRate: {
          basePrice: greeterBasePrice,
          hourlyRate: greeterHourlyRate,
          formatted: currentGreeterRate ? currentGreeterRate.getFormattedValue() : '$760.00 MXN (base) + $640.00 MXN/hr',
          lastUpdated: currentGreeterRate
            ? currentGreeterRate.get('effectiveDate') || currentGreeterRate.get('createdAt')
            : new Date(),
          id: currentGreeterRate ? currentGreeterRate.id : null,
        },
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
   * Cash rounding settings page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
   */
  async cashRounding(req, res) {
    try {
      await this.renderRoleView(req, res, 'cash-rounding', {
        title: 'Configuración de Redondeo para Efectivo',
        breadcrumb: {
          title: 'Redondeo Efectivo',
          items: [
            { name: 'Dashboard', link: '/dashboard/admin', active: false },
            { name: 'Ajustes', link: '/dashboard/admin/price-settings', active: false },
            { name: 'Redondeo Efectivo', link: '#', active: true },
          ],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Forms builder page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
   */
  async forms(req, res) {
    try {
      await this.renderRoleView(req, res, 'forms', {
        title: 'Gestión de Formularios',
        breadcrumb: null,
        pageStyles: ['https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.css'],
        footerScripts: `
          <!-- SortableJS for drag and drop -->
          <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Form preview page.
   * Test runtime rendering of forms.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await formPreview(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async formPreview(req, res) {
    try {
      const requestedFormId = req.query.formId || 'experience';

      await this.renderRoleView(req, res, 'form-preview', {
        title: 'Vista Previa del Formulario',
        breadcrumb: null,
        requestedFormId,
        pageStyles: [],
        footerScripts: '',
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * A Disposición calculator page.
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
   * Tarifario export page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<object>} - Promise resolving to operation result.
   * @example
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
   * Cancellation requests management page.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await cancellationRequests(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async cancellationRequests(req, res) {
    try {
      await this.renderRoleView(req, res, 'cancellation-requests', {
        title: 'Solicitudes de Cancelación',
        breadcrumb: {
          title: 'Solicitudes de Cancelación',
          items: [{ name: 'Cancelaciones', active: true }],
        },
        pageStyles: [
          'https://cdn.datatables.net/1.13.6/css/dataTables.bootstrap5.min.css',
          'https://cdn.datatables.net/responsive/2.5.0/css/responsive.bootstrap5.min.css',
        ],
        footerScripts: `
          <script src="https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js"></script>
          <script src="https://cdn.datatables.net/1.13.6/js/dataTables.bootstrap5.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/dataTables.responsive.min.js"></script>
          <script src="https://cdn.datatables.net/responsive/2.5.0/js/responsive.bootstrap5.min.js"></script>
          <script src="/js/pages/admin/cancellation-requests.js"></script>
        `,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }
}

module.exports = new AdminController();
