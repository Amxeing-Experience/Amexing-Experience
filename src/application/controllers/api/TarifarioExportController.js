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

const TarifarioExportService = require('../../services/TarifarioExportService');
const logger = require('../../../infrastructure/logger');

/**
 * Controller for tarifario export operations.
 */
class TarifarioExportController {
  /**
   * Create a TarifarioExportController instance.
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

      const result = await this.exportService.exportSections(requestedSections, format);

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
