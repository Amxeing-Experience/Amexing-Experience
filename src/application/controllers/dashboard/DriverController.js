const RoleBasedController = require('./base/RoleBasedController');

/**
 * DriverController - Implements driver-specific dashboard functionality.
 */
class DriverController extends RoleBasedController {
  constructor() {
    super('driver');
  }

  async index(req, res) {
    try {
      await this.renderRoleView(req, res, 'index', {
        title: 'Driver Dashboard',
        stats: await this.getDriverStats(),
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async trips(req, res) {
    try {
      await this.renderRoleView(req, res, 'trips', {
        title: 'Active Trips',
        trips: [],
        breadcrumb: {
          title: 'Trips',
          items: [{ name: 'Trips', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async earnings(req, res) {
    try {
      await this.renderRoleView(req, res, 'earnings', {
        title: 'My Earnings',
        earnings: {},
        breadcrumb: {
          title: 'Earnings',
          items: [{ name: 'Earnings', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async profile(req, res) {
    try {
      await this.renderRoleView(req, res, 'profile', {
        title: 'Driver Profile',
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

  async getDriverStats() {
    return {
      todayTrips: 8,
      weeklyTrips: 45,
      monthlyEarnings: 3500,
      rating: 4.8,
      completionRate: '96%',
    };
  }
}

module.exports = new DriverController();
