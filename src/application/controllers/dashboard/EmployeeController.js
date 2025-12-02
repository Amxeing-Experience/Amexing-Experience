const RoleBasedController = require('./base/RoleBasedController');

/**
 * EmployeeController - Implements employee-specific dashboard functionality.
 * Extends RoleBasedController to provide employee role access to personal bookings,
 * trip history, profile management, and dashboard statistics.
 */
class EmployeeController extends RoleBasedController {
  /**
   * Initializes the EmployeeController with employee role permissions.
   * Sets up the controller with employee-specific access rights including:
   * view_own_profile, create_booking, view_own_bookings, view_own_budget, and submit_feedback.
   * @function constructor
   * @example
   * // Controller is instantiated as singleton at module export
   * const employeeController = new EmployeeController();
   */
  constructor() {
    super('employee');
  }

  /**
   * Renders the employee dashboard index page with statistics and overview.
   * Displays employee-specific metrics including upcoming trips, completed trips,
   * monthly budget allocation, budget usage, and saved routes.
   * @function index
   * @async
   * @param {object} req - Express request object containing authenticated user information.
   * @param {object} res - Express response object for rendering dashboard view.
   * @returns {Promise<void>} Renders the employee dashboard index view.
   * @throws {Error} If user is not authenticated or lacks employee permissions.
   * @example
   * // GET /dashboard/employee
   * // Requires authentication middleware and employee role
   * router.get('/', employeeController.index);
   *
   * // Response renders view with data:
   * // {
   * //   title: 'Employee Dashboard',
   * //   stats: {
   * //     upcomingTrips: 3,
   * //     completedTrips: 45,
   * //     monthlyBudget: 500,
   * //     budgetUsed: 320,
   * //     savedRoutes: 5
   * //   }
   * // }
   */
  async index(req, res) {
    try {
      await this.renderRoleView(req, res, 'index', {
        title: 'Employee Dashboard',
        stats: await this.getEmployeeStats(),
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the employee bookings page displaying all current and upcoming bookings.
   * Shows a list of transportation bookings created by the employee with status,
   * dates, routes, and booking details. Allows employees to view their booking history
   * and manage active reservations.
   * @function bookings
   * @async
   * @param {object} req - Express request object containing authenticated user information.
   * @param {object} res - Express response object for rendering bookings view.
   * @returns {Promise<void>} Renders the employee bookings view.
   * @throws {Error} If user is not authenticated or database query fails.
   * @example
   * // GET /dashboard/employee/bookings
   * // Requires authentication middleware and employee role
   * router.get('/bookings', employeeController.bookings);
   *
   * // Response renders view with data:
   * // {
   * //   title: 'My Bookings',
   * //   bookings: [], // Array of booking objects filtered by employee
   * //   breadcrumb: {
   * //     title: 'Bookings',
   * //     items: [{ name: 'Bookings', active: true }]
   * //   }
   * // }
   */
  async bookings(req, res) {
    try {
      await this.renderRoleView(req, res, 'bookings', {
        title: 'My Bookings',
        bookings: [],
        breadcrumb: {
          title: 'Bookings',
          items: [{ name: 'Bookings', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Renders the employee trip history page showing completed transportation trips.
   * Displays a chronological list of past trips including dates, routes, drivers,
   * costs, and trip details. Helps employees track their transportation usage and
   * review historical travel data.
   * @function history
   * @async
   * @param {object} req - Express request object containing authenticated user information.
   * @param {object} res - Express response object for rendering history view.
   * @returns {Promise<void>} Renders the employee trip history view.
   * @throws {Error} If user is not authenticated or database query fails.
   * @example
   * // GET /dashboard/employee/history
   * // Requires authentication middleware and employee role
   * router.get('/history', employeeController.history);
   *
   * // Response renders view with data:
   * // {
   * //   title: 'Trip History',
   * //   trips: [], // Array of completed trip objects filtered by employee
   * //   breadcrumb: {
   * //     title: 'History',
   * //     items: [{ name: 'History', active: true }]
   * //   }
   * // }
   */
  async history(req, res) {
    try {
      await this.renderRoleView(req, res, 'history', {
        title: 'Trip History',
        trips: [],
        breadcrumb: {
          title: 'History',
          items: [{ name: 'History', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  /**
   * Retrieves employee-specific statistics for dashboard display.
   * Fetches aggregated data including upcoming trips count, completed trips total,
   * monthly budget allocation, current budget usage, and number of saved routes.
   * Used by the index method to populate dashboard statistics widgets.
   * @function getEmployeeStats
   * @async
   * @returns {Promise<object>} Employee statistics object with the following properties:
   * upcomingTrips (number) - Number of scheduled upcoming trips,
   * completedTrips (number) - Total number of completed trips,
   * monthlyBudget (number) - Monthly transportation budget allocation,
   * budgetUsed (number) - Amount of budget already used this month,
   * savedRoutes (number) - Number of frequently used saved routes.
   * @example
   * // Internal usage in index method
   * const stats = await this.getEmployeeStats();
   * // Returns:
   * // {
   * //   upcomingTrips: 3,
   * //   completedTrips: 45,
   * //   monthlyBudget: 500,
   * //   budgetUsed: 320,
   * //   savedRoutes: 5
   * // }
   * @example
   * // Future implementation with Parse Server queries
   * // const query = new Parse.Query('Booking');
   * // query.equalTo('employee', req.user);
   * // query.equalTo('status', 'upcoming');
   * // const upcomingTrips = await query.count();
   */
  async getEmployeeStats() {
    return {
      upcomingTrips: 3,
      completedTrips: 45,
      monthlyBudget: 500,
      budgetUsed: 320,
      savedRoutes: 5,
    };
  }
}

module.exports = new EmployeeController();
