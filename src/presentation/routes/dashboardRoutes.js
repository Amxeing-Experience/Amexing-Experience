const express = require('express');

const router = express.Router();

// Import controllers
const superAdminController = require('../../application/controllers/dashboard/SuperAdminController');
const adminController = require('../../application/controllers/dashboard/AdminController');
const clientController = require('../../application/controllers/dashboard/ClientController');
const departmentManagerController = require('../../application/controllers/dashboard/DepartmentManagerController');
const employeeController = require('../../application/controllers/dashboard/EmployeeController');
const driverController = require('../../application/controllers/dashboard/DriverController');
const guestController = require('../../application/controllers/dashboard/GuestController');

// Import authentication middleware
const dashboardAuth = require('../../application/middleware/dashboardAuthMiddleware');

// Apply only basic authentication - role checks handled per route to avoid conflicts
router.use(dashboardAuth.requireAuth);

// SuperAdmin Routes
router.get('/superadmin', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.index(req, res));
router.get('/superadmin/users', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.users(req, res));
router.get('/superadmin/roles', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.roles(req, res));
router.get('/superadmin/clients', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.clients(req, res));
router.get('/superadmin/permissions', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.permissions(req, res));
router.get('/superadmin/analytics', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.analytics(req, res));
router.get('/superadmin/reports', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.reports(req, res));
router.get('/superadmin/audit', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.audit(req, res));
router.get('/superadmin/settings', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.settings(req, res));
router.get('/superadmin/integrations', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.integrations(req, res));
router.get('/superadmin/security', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.security(req, res));
router.get('/superadmin/compliance', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.compliance(req, res));

// Admin Routes
router.get('/admin', dashboardAuth.requireRole('admin'), (req, res) => adminController.index(req, res));
router.get('/admin/clients', dashboardAuth.requireRole('admin'), (req, res) => adminController.clients(req, res));
router.get('/admin/clients/:id', dashboardAuth.requireRole('admin'), (req, res) => adminController.clientDetail(req, res));
router.get('/admin/departments', dashboardAuth.requireRole('admin'), (req, res) => adminController.departments(req, res));
router.get('/admin/employees', dashboardAuth.requireRole('admin'), (req, res) => adminController.employees(req, res));
router.get('/admin/drivers', dashboardAuth.requireRole('admin'), (req, res) => adminController.drivers(req, res));
router.get('/admin/events', dashboardAuth.requireRole('admin'), (req, res) => adminController.events(req, res));
router.get('/admin/experiences', dashboardAuth.requireRole('admin'), (req, res) => adminController.experiences(req, res));
router.get('/admin/schedule', dashboardAuth.requireRole('admin'), (req, res) => adminController.schedule(req, res));
router.get('/admin/bookings', dashboardAuth.requireRole('admin'), (req, res) => adminController.bookings(req, res));
router.get('/admin/vehicles', dashboardAuth.requireRole('admin'), (req, res) => adminController.vehicles(req, res));
router.get('/admin/pois', dashboardAuth.requireRole('admin'), (req, res) => adminController.pois(req, res));
router.get('/admin/services', dashboardAuth.requireRole('admin'), (req, res) => adminController.services(req, res));
router.get('/admin/pricing', dashboardAuth.requireRole('admin'), (req, res) => adminController.pricing(req, res));
router.get('/admin/fleet', dashboardAuth.requireRole('admin'), (req, res) => adminController.fleet(req, res));
router.get('/admin/routes', dashboardAuth.requireRole('admin'), (req, res) => adminController.routes(req, res));
router.get('/admin/billing', dashboardAuth.requireRole('admin'), (req, res) => adminController.billing(req, res));
router.get('/admin/reports', dashboardAuth.requireRole('admin'), (req, res) => adminController.reports(req, res));
router.get('/admin/settings', dashboardAuth.requireRole('admin'), (req, res) => adminController.settings(req, res));
router.get('/admin/notifications', dashboardAuth.requireRole('admin'), (req, res) => adminController.notifications(req, res));

// Client Routes
router.get('/client', dashboardAuth.requireRole('client'), (req, res) => clientController.index(req, res));
router.get('/client/departments', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/employees', dashboardAuth.requireRole('client'), (req, res) => clientController.employees(req, res));
router.get('/client/managers', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/bookings', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/schedules', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/routes', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/budgets', dashboardAuth.requireRole('client'), (req, res) => clientController.budgets(req, res));
router.get('/client/invoices', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/reports', dashboardAuth.requireRole('client'), (req, res) => clientController.reports(req, res));
router.get('/client/policies', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/permissions', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/settings', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));

// Department Manager Routes
router.get('/department_manager', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.index(req, res));
router.get('/department_manager/team', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/approvals', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/bookings', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/schedules', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/usage', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/budgets', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.budgets(req, res));
router.get('/department_manager/allocations', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.budgets(req, res));
router.get('/department_manager/reports', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.reports(req, res));
router.get('/department_manager/policies', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/permissions', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/settings', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));

// Employee Routes
router.get('/employee', dashboardAuth.requireRole('employee'), (req, res) => employeeController.index(req, res));
router.get('/employee/profile', dashboardAuth.requireRole('employee'), (req, res) => employeeController.profile(req, res));
router.get('/employee/bookings', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/trips', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/history', dashboardAuth.requireRole('employee'), (req, res) => employeeController.history(req, res));
router.get('/employee/schedules', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/budget', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/expenses', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/help', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/feedback', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));
router.get('/employee/settings', dashboardAuth.requireRole('employee'), (req, res) => employeeController.bookings(req, res));

// Driver Routes
router.get('/driver', dashboardAuth.requireRole('driver'), (req, res) => driverController.index(req, res));
router.get('/driver/profile', dashboardAuth.requireRole('driver'), (req, res) => driverController.profile(req, res));
router.get('/driver/trips', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/schedule', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/routes', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/history', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/vehicle', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/maintenance', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/fuel', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/earnings', dashboardAuth.requireRole('driver'), (req, res) => driverController.earnings(req, res));
router.get('/driver/payments', dashboardAuth.requireRole('driver'), (req, res) => driverController.earnings(req, res));
router.get('/driver/bonuses', dashboardAuth.requireRole('driver'), (req, res) => driverController.earnings(req, res));
router.get('/driver/help', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));
router.get('/driver/settings', dashboardAuth.requireRole('driver'), (req, res) => driverController.trips(req, res));

// Guest Routes
router.get('/guest', dashboardAuth.requireRole('guest'), (req, res) => guestController.index(req, res));
router.get('/guest/event', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));
router.get('/guest/transport', dashboardAuth.requireRole('guest'), (req, res) => guestController.transport(req, res));
router.get('/guest/help', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));
router.get('/guest/contact', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));

// Default dashboard redirect - redirect to user's role-specific dashboard
router.get('/', dashboardAuth.requireAuth, (req, res) => {
  const userRole = req.user.role || 'guest';
  res.redirect(`/dashboard/${userRole}`);
});

module.exports = router;
