const express = require('express');

const router = express.Router();

// Import controllers
const superAdminController = require('../../application/controllers/dashboard/SuperAdminController');
const adminController = require('../../application/controllers/dashboard/AdminController');
const clientController = require('../../application/controllers/dashboard/ClientController');
const endClientController = require('../../application/controllers/dashboard/EndClientController');
const departmentManagerController = require('../../application/controllers/dashboard/DepartmentManagerController');
const employeeController = require('../../application/controllers/dashboard/EmployeeController');
const driverController = require('../../application/controllers/dashboard/DriverController');
const guestController = require('../../application/controllers/dashboard/GuestController');

// Import authentication middleware
const dashboardAuth = require('../../application/middleware/dashboardAuthMiddleware');
const { getEndClientCapabilities } = require('../../application/config/endClientCapabilities');

// Apply only basic authentication - role checks handled per route to avoid conflicts
router.use(dashboardAuth.requireAuth);

// Cliente directo (end_client): expone las capacidades según su tipo (clientCategory, que ya viene
// del JWT en res.locals) para que menú, vistas y controllers decidan qué mostrar/permitir.
router.use('/end_client', (req, res, next) => {
  res.locals.endClientCaps = getEndClientCapabilities(req.user && req.user.clientCategory);
  next();
});

/**
 * Guard por capacidad para rutas de end_client (p. Ej. La sección Tarifario solo para wedding
 * planner). Si el tipo de cliente no tiene la capacidad, lo regresa a su dashboard de inicio.
 * @param {string} cap - Capacidad requerida (clave de endClientCapabilities, p. Ej. 'viewTarifario').
 * @returns {Function} Middleware Express que permite o redirige según la capacidad del usuario.
 * @example
 * router.get('/end_client/vehicles', requireEndClientCap('viewTarifario'), handler);
 */
const requireEndClientCap = (cap) => (req, res, next) => {
  const caps = getEndClientCapabilities(req.user && req.user.clientCategory);
  // eslint-disable-next-line security/detect-object-injection
  if (caps && caps[cap]) return next();
  return res.redirect('/dashboard/end_client');
};

// SuperAdmin Routes
router.get('/superadmin', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.index(req, res));
router.get('/superadmin/profile', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.profile(req, res));
router.get('/superadmin/change-password', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.changePassword(req, res));
router.get('/superadmin/users', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.users(req, res));
router.get('/superadmin/roles', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.roles(req, res));
router.get('/superadmin/clients', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.clients(req, res));
router.get('/superadmin/tours', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.tours(req, res));
router.get('/superadmin/permissions', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.permissions(req, res));
router.get('/superadmin/analytics', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.analytics(req, res));
router.get('/superadmin/reports', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.reports(req, res));
router.get('/superadmin/emails', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.emails(req, res));
router.get('/superadmin/audit', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.audit(req, res));
router.get('/superadmin/settings', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.settings(req, res));
router.get('/superadmin/integrations', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.integrations(req, res));
router.get('/superadmin/security', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.security(req, res));
router.get('/superadmin/compliance', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.compliance(req, res));

// SuperAdmin Tarifario Routes
router.get('/superadmin/vehicles', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.vehicles(req, res));
router.get('/superadmin/services', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.services(req, res));
router.get('/superadmin/experiences', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.experiences(req, res));
router.get('/superadmin/greeter', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.greeter(req, res));
router.get('/superadmin/tarifario-export', dashboardAuth.requireRole('superadmin'), (req, res) => superAdminController.tarifarioExport(req, res));

// Admin Routes
router.get('/admin', dashboardAuth.requireRole('admin'), (req, res) => adminController.index(req, res));
router.get('/admin/profile', dashboardAuth.requireRole('admin'), (req, res) => adminController.profile(req, res));
router.get('/admin/change-password', dashboardAuth.requireRole('admin'), (req, res) => adminController.changePassword(req, res));
router.get('/admin/clients', dashboardAuth.requireRole('admin'), (req, res) => adminController.clients(req, res));
router.get('/admin/clients/:id', dashboardAuth.requireRole('admin'), (req, res) => adminController.clientDetail(req, res));
router.get('/admin/departments', dashboardAuth.requireRole('admin'), (req, res) => adminController.departments(req, res));
router.get('/admin/employees', dashboardAuth.requireRole('admin'), (req, res) => adminController.employees(req, res));
router.get('/admin/drivers', dashboardAuth.requireRole('admin'), (req, res) => adminController.drivers(req, res));
router.get('/admin/events', dashboardAuth.requireRole('admin'), (req, res) => adminController.events(req, res));
router.get('/admin/experiences', dashboardAuth.requireRole('admin'), (req, res) => adminController.experiences(req, res));
router.get('/admin/experiences/:id', dashboardAuth.requireRole('admin'), (req, res) => adminController.experienceDetail(req, res));
router.get('/admin/schedule', dashboardAuth.requireRole('admin'), (req, res) => adminController.schedule(req, res));
router.get('/admin/bookings', dashboardAuth.requireRole('admin'), (req, res) => adminController.bookings(req, res));
router.get('/admin/bookings/:id', dashboardAuth.requireRole('admin'), (req, res) => adminController.bookingDetail(req, res));
router.get('/admin/vehicles', dashboardAuth.requireRole('admin'), (req, res) => adminController.vehicles(req, res));
router.get('/admin/price-settings', dashboardAuth.requireRole('admin'), (req, res) => adminController.priceSettings(req, res));
router.get('/admin/cash-rounding', dashboardAuth.requireRole('admin'), (req, res) => adminController.cashRounding(req, res));
router.get('/admin/pois', dashboardAuth.requireRole('admin'), (req, res) => adminController.pois(req, res));
router.get('/admin/services', dashboardAuth.requireRole('admin'), (req, res) => adminController.services(req, res));
router.get('/admin/a-disposicion', dashboardAuth.requireRole('admin'), (req, res) => adminController.aDisposicion(req, res));
router.get('/admin/pricing', dashboardAuth.requireRole('admin'), (req, res) => adminController.pricing(req, res));
router.get('/admin/tours', dashboardAuth.requireRole('admin'), (req, res) => adminController.tours(req, res));
router.get('/admin/greeter', dashboardAuth.requireRole('admin'), (req, res) => adminController.greeter(req, res));
router.get('/admin/quotes', dashboardAuth.requireRole('admin'), (req, res) => adminController.quotes(req, res));
router.get('/admin/quotes/:id', dashboardAuth.requireRole('admin'), (req, res) => adminController.quoteDetail(req, res));
router.get('/admin/invoices', dashboardAuth.requireRole('admin'), (req, res) => adminController.invoices(req, res));
router.get('/admin/payment-info', dashboardAuth.requireRole('admin'), (req, res) => adminController.paymentInfo(req, res));
router.get('/admin/fleet', dashboardAuth.requireRole('admin'), (req, res) => adminController.fleet(req, res));
router.get('/admin/routes', dashboardAuth.requireRole('admin'), (req, res) => adminController.routes(req, res));
router.get('/admin/billing', dashboardAuth.requireRole('admin'), (req, res) => adminController.billing(req, res));
router.get('/admin/reports', dashboardAuth.requireRole('admin'), (req, res) => adminController.reports(req, res));
router.get('/admin/settings', dashboardAuth.requireRole('admin'), (req, res) => adminController.settings(req, res));
router.get('/admin/notifications', dashboardAuth.requireRole('admin'), (req, res) => adminController.notifications(req, res));
router.get('/admin/forms', dashboardAuth.requireRole('admin'), (req, res) => adminController.forms(req, res));
router.get('/admin/form-preview', dashboardAuth.requireRole('admin'), (req, res) => adminController.formPreview(req, res));
router.get('/admin/cancellation-requests', dashboardAuth.requireRole('admin'), (req, res) => adminController.cancellationRequests(req, res));
router.get('/admin/tarifario-export', dashboardAuth.requireRole('admin'), (req, res) => adminController.tarifarioExport(req, res));

// Client Routes - Dashboard de inicio (antes redirigía a /vehicles)
router.get('/client', dashboardAuth.requireRole('client'), (req, res) => clientController.index(req, res));
router.get('/client/profile', dashboardAuth.requireRole('client'), (req, res) => clientController.profile(req, res));
router.get('/client/change-password', dashboardAuth.requireRole('client'), (req, res) => clientController.changePassword(req, res));
router.get('/client/clients', dashboardAuth.requireRole('client'), (req, res) => clientController.ownedClients(req, res));
router.get('/client/departments', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/employees', dashboardAuth.requireRole('client'), (req, res) => clientController.employees(req, res));
router.get('/client/team', dashboardAuth.requireRole('client'), (req, res) => clientController.team(req, res));
router.get('/client/managers', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/bookings', dashboardAuth.requireRole('client'), (req, res) => clientController.bookings(req, res));
router.get('/client/bookings/:id', dashboardAuth.requireRole('client'), (req, res) => clientController.bookingDetail(req, res));
router.get('/client/schedules', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/routes', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/budgets', dashboardAuth.requireRole('client'), (req, res) => clientController.budgets(req, res));
router.get('/client/invoices', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/reports', dashboardAuth.requireRole('client'), (req, res) => clientController.reports(req, res));
router.get('/client/policies', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/permissions', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/settings', dashboardAuth.requireRole('client'), (req, res) => clientController.departments(req, res));
router.get('/client/vehicles', dashboardAuth.requireRole('client'), (req, res) => clientController.vehicles(req, res));
router.get('/client/services', dashboardAuth.requireRole('client'), (req, res) => clientController.services(req, res));
router.get('/client/experiences', dashboardAuth.requireRole('client'), (req, res) => clientController.experiences(req, res));
router.get('/client/tours', dashboardAuth.requireRole('client'), (req, res) => clientController.tours(req, res));
router.get('/client/a-disposicion', dashboardAuth.requireRole('client'), (req, res) => clientController.aDisposicion(req, res));
router.get('/client/greeter', dashboardAuth.requireRole('client'), (req, res) => clientController.greeter(req, res));
router.get('/client/quotes', dashboardAuth.requireRole('client'), (req, res) => clientController.quotes(req, res));
router.get('/client/quotes/:id', dashboardAuth.requireRole('client'), (req, res) => clientController.quoteDetail(req, res));
router.get('/client/tarifario-export', dashboardAuth.requireRole('client'), (req, res) => clientController.tarifarioExport(req, res));

// End Client Routes (cliente directo: solo lo suyo — inicio, reservaciones, cotizaciones + cotizar)
router.get('/end_client', dashboardAuth.requireRole('end_client'), (req, res) => endClientController.index(req, res));
router.get('/end_client/profile', dashboardAuth.requireRole('end_client'), (req, res) => endClientController.profile(req, res));
router.get('/end_client/change-password', dashboardAuth.requireRole('end_client'), (req, res) => endClientController.changePassword(req, res));
router.get('/end_client/bookings', dashboardAuth.requireRole('end_client'), (req, res) => endClientController.bookings(req, res));
router.get('/end_client/bookings/:id', dashboardAuth.requireRole('end_client'), (req, res) => endClientController.bookingDetail(req, res));
router.get('/end_client/quotes', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewQuotes'), (req, res) => endClientController.quotes(req, res));
router.get('/end_client/quotes/:id', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewQuotes'), (req, res) => endClientController.quoteDetail(req, res));
// Sección Tarifario (catálogo) — solo tipos con viewTarifario (wedding planner).
router.get('/end_client/vehicles', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.vehicles(req, res));
router.get('/end_client/services', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.services(req, res));
router.get('/end_client/a-disposicion', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.aDisposicion(req, res));
router.get('/end_client/experiences', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.experiences(req, res));
router.get('/end_client/tours', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.tours(req, res));
router.get('/end_client/tarifario-export', dashboardAuth.requireRole('end_client'), requireEndClientCap('viewTarifario'), (req, res) => endClientController.tarifarioExport(req, res));

// Department Manager Routes
router.get('/department_manager', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.index(req, res));
router.get('/department_manager/profile', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.profile(req, res));
router.get('/department_manager/change-password', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.changePassword(req, res));
router.get('/department_manager/clients', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.ownedClients(req, res));
router.get('/department_manager/team', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/approvals', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/bookings', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.bookings(req, res));
router.get('/department_manager/bookings/:id', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.bookingDetail(req, res));
router.get('/department_manager/schedules', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/usage', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/budgets', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.budgets(req, res));
router.get('/department_manager/allocations', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.budgets(req, res));
router.get('/department_manager/quotes', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.quotes(req, res));
router.get('/department_manager/quotes/:id', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.quoteDetail(req, res));
router.get('/department_manager/invoices', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.invoices(req, res));
router.get('/department_manager/vehicles', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.vehicles(req, res));
router.get('/department_manager/services', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.services(req, res));
router.get('/department_manager/experiences', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.experiences(req, res));
router.get('/department_manager/tours', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.tours(req, res));
router.get('/department_manager/a-disposicion', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.aDisposicion(req, res));
router.get('/department_manager/greeter', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.greeter(req, res));
router.get('/department_manager/reports', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.reports(req, res));
router.get('/department_manager/policies', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/permissions', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/settings', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.team(req, res));
router.get('/department_manager/tarifario-export', dashboardAuth.requireRole('department_manager'), (req, res) => departmentManagerController.tarifarioExport(req, res));

// Employee Routes
router.get('/employee', dashboardAuth.requireRole('employee'), (req, res) => employeeController.index(req, res));
router.get('/employee/profile', dashboardAuth.requireRole('employee'), (req, res) => employeeController.profile(req, res));
router.get('/employee/change-password', dashboardAuth.requireRole('employee'), (req, res) => employeeController.changePassword(req, res));
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
router.get('/driver/change-password', dashboardAuth.requireRole('driver'), (req, res) => driverController.changePassword(req, res));
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
router.get('/guest/profile', dashboardAuth.requireRole('guest'), (req, res) => guestController.profile(req, res));
router.get('/guest/change-password', dashboardAuth.requireRole('guest'), (req, res) => guestController.changePassword(req, res));
router.get('/guest/event', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));
router.get('/guest/transport', dashboardAuth.requireRole('guest'), (req, res) => guestController.transport(req, res));
router.get('/guest/help', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));
router.get('/guest/contact', dashboardAuth.requireRole('guest'), (req, res) => guestController.event(req, res));

// Dashboard data endpoints for DataTables (session-based auth)
router.get('/data/vehicle-types', dashboardAuth.requireRole('admin'), (req, res) => adminController.vehicleTypesData(req, res));
router.get('/data/tours', dashboardAuth.requireRole('admin'), (req, res) => adminController.toursData(req, res));
router.get('/data/experiences', dashboardAuth.requireRole('admin'), (req, res) => adminController.experiencesData(req, res));
router.get('/data/disposable-prices', dashboardAuth.requireRole('admin'), (req, res) => adminController.disposablePricesData(req, res));
router.put('/data/disposable-prices/batch-update', dashboardAuth.requireRole('admin'), (req, res) => adminController.disposablePricesBatchUpdate(req, res));

// Default dashboard redirect - redirect to user's role-specific dashboard
router.get('/', dashboardAuth.requireAuth, (req, res) => {
  const userRole = req.user.role || 'guest';
  res.redirect(`/dashboard/${userRole}`);
});

module.exports = router;
