const RoleBasedController = require('./base/RoleBasedController');

/**
 * GuestController - Implements guest-specific dashboard functionality.
 */
class GuestController extends RoleBasedController {
  constructor() {
    super('guest');
  }

  async index(req, res) {
    try {
      await this.renderRoleView(req, res, 'index', {
        title: 'Guest Dashboard',
        eventInfo: await this.getEventInfo(),
        breadcrumb: null,
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async event(req, res) {
    try {
      await this.renderRoleView(req, res, 'event', {
        title: 'Event Information',
        event: {},
        breadcrumb: {
          title: 'Event',
          items: [{ name: 'Event', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async transport(req, res) {
    try {
      await this.renderRoleView(req, res, 'transport', {
        title: 'Transport Details',
        transport: {},
        breadcrumb: {
          title: 'Transport',
          items: [{ name: 'Transport', active: true }],
        },
      });
    } catch (error) {
      this.handleError(res, error);
    }
  }

  async getEventInfo() {
    return {
      eventName: 'Annual Company Meeting',
      eventDate: new Date(),
      transportTime: '9:00 AM',
      pickupLocation: 'Main Office',
      dropoffLocation: 'Convention Center',
    };
  }
}

module.exports = new GuestController();
