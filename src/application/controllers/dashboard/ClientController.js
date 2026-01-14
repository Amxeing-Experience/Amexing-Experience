const RoleBasedController = require('./base/RoleBasedController');

/**
 * ClientController - Implements client-specific dashboard functionality.
 */
class ClientController extends RoleBasedController {
  constructor() {
    super('client');
  }

  /**
   * Dashboard index page.
   * @function index
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
        title: 'Client Dashboard',
        stats: await this.getClientStats(),
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Departments page.
   * @function departments
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
   * @function employees
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
        title: 'Employee Management',
        employees: [],
        breadcrumb: {
          title: 'Employees',
          items: [{ name: 'Employees', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Budgets page.
   * @function budgets
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @example
   * // Usage example
   * const result = await budgets(parameters);
   * // Returns: operation result
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to operation result.
   */
  async budgets(req, res) {
    try {
      await this.renderRoleView(req, res, 'budgets', {
        title: 'Budget Management',
        budgets: [],
        breadcrumb: {
          title: 'Budgets',
          items: [{ name: 'Budgets', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Reports page.
   * @function reports
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
        title: 'Company Reports',
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
   * Renders the client vehicles page for viewing vehicle fleet.
   * Clients can view vehicle types available for their services.
   * Supports sections: 'vehicles' and 'types' for vehicle type management.
   * @function vehicles
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the vehicles view.
   * @returns {Promise<void>} - Renders the client vehicles view or handles errors.
   * @example
   * // GET /dashboard/client/vehicles
   * // GET /dashboard/client/vehicles?section=types
   * await clientController.vehicles(req, res);
   */
  async vehicles(req, res) {
    try {
      const section = req.query.section || 'types'; // Default to types

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
   * Renders the client services page for viewing transport services.
   * Clients can view services/transfers available for their business.
   * Supports sections: 'airport' (default), 'p2p' (punto a punto), and 'local' for service type management.
   * @function services
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the services view.
   * @returns {Promise<void>} - Renders the client services view or handles errors.
   * @example
   * // GET /dashboard/client/services
   * // GET /dashboard/client/services?section=p2p
   * // GET /dashboard/client/services?section=local
   * await clientController.services(req, res);
   */
  async services(req, res) {
    try {
      const section = req.query.section || 'airport';

      // Use the logged-in user's objectId as clientId for personalized pricing
      const clientId = req.user?.id || null;

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
   * Renders the client experiences page for viewing experiences.
   * Clients can view experiences available for their events.
   * Supports sections: 'experiences' (default) and 'providers' for experience providers management.
   * @function experiences
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the experiences view.
   * @returns {Promise<void>} - Renders the client experiences view or handles errors.
   * @example
   * // GET /dashboard/client/experiences
   * // GET /dashboard/client/experiences?section=providers
   * await clientController.experiences(req, res);
   */
  async experiences(req, res) {
    try {
      const section = req.query.section || 'experiences';

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
   * Renders the client tours page for viewing tour packages.
   * Clients can view tours available for their events.
   * @function tours
   * @param {object} req - Express request object containing user session and authentication data.
   * @param {object} res - Express response object for rendering the tours view.
   * @returns {Promise<void>} - Renders the client tours view or handles errors.
   * @example
   * // GET /dashboard/client/tours
   * await clientController.tours(req, res);
   */
  async tours(req, res) {
    try {
      // Use the logged-in user's objectId as clientId for personalized pricing
      const clientId = req.user?.id || null;

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
   * Get client statistics.
   * @function getClientStats
   * @example
   * // GET endpoint example
   * const result = await ClientController.getClientStats();
   * // Returns: { success: true, data: {...}, message: 'Success' }
   * // controller.methodName(req, res)
   * // Handles HTTP request and sends appropriate response
   * // Example usage:
   * // const result = await methodName(params);
   * // console.log(result);
   * @returns {Promise<object>} - Promise resolving to client statistics object containing totalEmployees, activeDepartments, monthlyBudget, budgetUsed, activeBookings, and completedTrips.
   */
  async getClientStats() {
    return {
      totalEmployees: 250,
      activeDepartments: 8,
      monthlyBudget: 50000,
      budgetUsed: 32000,
      activeBookings: 45,
      completedTrips: 1250,
    };
  }
}

module.exports = new ClientController();
