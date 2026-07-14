// ClientController exporta una INSTANCIA; obtenemos la clase vía .constructor para extenderla.
const ClientController = require('./ClientController').constructor;
const { getDashboardSummary } = require('./dashboardSummary');

/**
 * EndClientController - Dashboard del cliente directo (end_client): cliente final sin agencia,
 * que solo ve/gestiona lo suyo (sus cotizaciones y reservaciones) y puede cotizar. Reutiliza la
 * lógica de ClientController (bookings/quotes/quoteDetail/bookingDetail) pero con rol 'end_client',
 * de modo que renderRoleView resuelve las vistas en dashboards/end_client/.
 */
class EndClientController extends ClientController {
  /**
   * Fija el rol a 'end_client' (ClientController fuerza 'client' en su super()).
   * @example
   * const controller = new EndClientController();
   */
  constructor() {
    super();
    this.role = 'end_client';
    this.permissions = this.getDefaultPermissions();
  }

  /**
   * Dashboard de inicio del cliente directo. Mismo landing editorial que client pero con
   * basePath 'end_client'; los conteos y pendientes de pago se acotan a lo suyo vía
   * getDashboardSummary (que trata end_client como client en el scoping por rol).
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Renderiza la vista de inicio o maneja el error.
   * @example
   * // GET /dashboard/end_client
   * await endClientController.index(req, res);
   */
  async index(req, res) {
    try {
      const { user } = req;
      const agencyName = user?.fullName
        || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
        || 'Cliente';

      const summary = await getDashboardSummary(req);

      const dashboardData = {
        agencyName,
        basePath: 'end_client',
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
}

module.exports = new EndClientController();
