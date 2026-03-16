/**
 * TarifarioExportController - API controller for tarifario exports.
 *
 * Handles GET /api/tarifario/export with query parameters:
 * - sections: comma-separated section names (default: all)
 * - format: 'excel' or 'pdf' (default: excel).
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const TarifarioExportService = require('../../services/TarifarioExportService');
const logger = require('../../../infrastructure/logger');

/**
 * Controller for tarifario export operations.
 */
class TarifarioExportController {
  /**
   * Create a TarifarioExportController instance.
   * @example
   */
  constructor() {
    this.exportService = new TarifarioExportService();
  }

  /**
   * Export tarifario data.
   * GET /api/tarifario/export?sections=vehiculos,traslados&format=excel.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>} Sends file download response.
   * @example
   */
  async exportTarifario(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return res.status(401).json({ success: false, error: 'Autenticacion requerida' });
      }

      // Parse sections parameter
      const sectionsParam = req.query.sections || '';
      let sections;
      if (!sectionsParam || sectionsParam === 'all') {
        sections = TarifarioExportService.getValidSections();
      } else {
        sections = sectionsParam.split(',').map((s) => s.trim().toLowerCase());
      }

      // Validate format
      const format = (req.query.format || 'excel').toLowerCase();
      if (!['excel', 'pdf'].includes(format)) {
        return res.status(400).json({
          success: false,
          error: 'Formato invalido. Use "excel" o "pdf".',
        });
      }

      // Validate at least one valid section
      const validSections = TarifarioExportService.getValidSections();
      const requestedSections = sections.filter((s) => validSections.includes(s));
      if (requestedSections.length === 0) {
        return res.status(400).json({
          success: false,
          error: `Secciones invalidas. Opciones: ${validSections.join(', ')}`,
        });
      }

      logger.info('Tarifario export requested', {
        userId: currentUser.id,
        sections: requestedSections,
        format,
      });

      // Pass clientId for client/department_manager roles to get client-specific prices
      // dept_manager: their own user IS the clientPtr in ClientPrices
      // client: their clientId field points to the parent user (dept_manager) who owns the prices
      const userRole = currentUser.get('role');
      let clientId = null;
      if (userRole === 'department_manager') {
        clientId = currentUser.id;
      } else if (userRole === 'client') {
        clientId = currentUser.get('clientId') || null;
      }

      // Parse payment type and currency options
      const paymentType = (req.query.paymentType || 'efectivo').toLowerCase();
      const currency = (req.query.currency || 'MXN').toUpperCase();

      // Build price options - fetch rates from DB as needed
      const priceOptions = { paymentType, currency };
      const rateQueries = [];

      if (paymentType === 'transferencia') {
        const tQuery = new Parse.Query('TransferRate');
        tQuery.equalTo('active', true);
        tQuery.descending('createdAt');
        rateQueries.push(tQuery.first({ useMasterKey: true }).then((r) => {
          priceOptions.transferRate = r ? r.get('value') : 0;
        }));
      } else if (paymentType === 'tarjeta') {
        const aQuery = new Parse.Query('AgencyRate');
        aQuery.equalTo('active', true);
        aQuery.descending('createdAt');
        rateQueries.push(aQuery.first({ useMasterKey: true }).then((r) => {
          priceOptions.agencyRate = r ? r.get('value') : 0;
        }));
      }

      if (currency === 'USD') {
        const eQuery = new Parse.Query('ExchangeRate');
        eQuery.equalTo('active', true);
        eQuery.descending('createdAt');
        rateQueries.push(eQuery.first({ useMasterKey: true }).then((r) => {
          priceOptions.exchangeRate = r ? r.get('value') : 18.5;
        }));
      }

      if (rateQueries.length > 0) {
        await Promise.all(rateQueries);
      }

      const result = await this.exportService.exportSections(requestedSections, format, clientId, priceOptions);

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Length', result.buffer.length);
      res.send(result.buffer);

      logger.info('Tarifario export completed', {
        userId: currentUser.id,
        sections: requestedSections,
        format,
        fileSize: result.buffer.length,
      });
    } catch (error) {
      logger.error('Tarifario export failed', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      res.status(500).json({
        success: false,
        error: 'Error al generar la exportacion del tarifario',
      });
    }
  }
}

module.exports = TarifarioExportController;
