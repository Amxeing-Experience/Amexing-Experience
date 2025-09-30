const RoleBasedController = require('./base/RoleBasedController');

/**
 * EmployeeController - Implements employee-specific dashboard functionality.
 */
class EmployeeController extends RoleBasedController {
  constructor() {
    super('employee');
  }

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

  async profile(req, res) {
    try {
      await this.renderRoleView(req, res, 'profile', {
        title: 'My Profile',
        profile: {},
        breadcrumb: {
          title: 'Profile',
          items: [{ name: 'Profile', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

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
