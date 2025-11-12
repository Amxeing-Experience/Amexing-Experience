/**
 * InvoiceController - API controller for invoice request management.
 *
 * Handles invoice request operations including listing, processing, and completion.
 *
 * Business Rules:
 * - Only admin and superadmin can view and process invoices
 * - Department managers can only create requests (handled in QuoteController)
 * - Invoice requests track complete lifecycle from request to completion.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * GET /api/invoices - List pending invoice requests
 * PUT /api/invoices/:id/complete - Mark invoice as completed
 */

const Parse = require('parse/node');
const logger = require('../../../infrastructure/logger');
const Invoice = require('../../../domain/models/Invoice');

/**
 * InvoiceController class for handling invoice API operations.
 * @class InvoiceController
 */
class InvoiceController {
  constructor() {
    this.allowedRoles = ['superadmin', 'admin']; // Only admins can manage invoices
  }

  /**
   * Get pending invoice requests.
   * GET /api/invoices.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getPendingInvoices(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        return this.sendError(res, 'No tiene permisos para ver solicitudes de facturas', 403);
      }

      // Parse query parameters for DataTables
      const {
        draw, start = 0, length = 10, search,
      } = req.query;
      const skip = parseInt(start);
      const limit = parseInt(length);

      // Build query for pending invoices
      const query = Invoice.getPendingRequests();

      // Apply search if provided
      if (search && search.value) {
        const searchValue = search.value.trim();
        // Use Parse's contains query which is safer than regex
        const searchQuery = Parse.Query.or([
          new Parse.Query('Invoice').contains('quote.folio', searchValue),
          new Parse.Query('Invoice').contains('requestedBy.fullName', searchValue),
          new Parse.Query('Invoice').contains('requestedBy.email', searchValue),
        ]);
        // eslint-disable-next-line no-underscore-dangle
        query._orQuery = searchQuery._orQuery;
      }

      // Get total count for pagination
      const totalCount = await query.count({ useMasterKey: true });

      // Apply pagination
      query.skip(skip);
      query.limit(limit);

      // Execute query
      const invoices = await query.find({ useMasterKey: true });

      // Transform data for DataTables
      const data = invoices.map((invoice) => {
        const quote = invoice.get('quote');
        const requestedBy = invoice.get('requestedBy');

        return {
          id: invoice.id,
          status: invoice.get('status'),
          requestDate: invoice.get('requestDate'),
          notes: invoice.get('notes') || '',
          quote: {
            id: quote?.id,
            folio: quote?.get('folio'),
            eventType: quote?.get('eventType'),
            total: quote?.get('serviceItems')?.total || 0,
            client: {
              fullName: quote?.get('client')?.get('fullName') || 'N/A',
              email: quote?.get('client')?.get('email') || '',
            },
          },
          requestedBy: {
            id: requestedBy?.id,
            fullName: requestedBy?.get('fullName') || requestedBy?.get('email') || 'N/A',
            email: requestedBy?.get('email') || '',
            role: requestedBy?.get('role') || '',
          },
          createdAt: invoice.get('createdAt'),
          updatedAt: invoice.get('updatedAt'),
        };
      });

      logger.info('Pending invoices retrieved', {
        userId: currentUser.id,
        userRole,
        totalCount,
        returnedCount: data.length,
        searchTerm: search?.value || 'none',
      });

      // Return DataTables compatible response
      return res.json({
        success: true,
        draw: parseInt(draw) || 1,
        recordsTotal: totalCount,
        recordsFiltered: totalCount, // For simplicity, assuming no additional filtering
        data,
      });
    } catch (error) {
      logger.error('Error retrieving pending invoices', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener solicitudes de facturas',
        500
      );
    }
  }

  /**
   * Get invoice request details.
   * GET /api/invoices/:id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getInvoiceDetails(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        return this.sendError(res, 'No tiene permisos para ver detalles de facturas', 403);
      }

      const invoiceId = req.params.id;
      if (!invoiceId) {
        return this.sendError(res, 'ID de factura requerido', 400);
      }

      // Fetch invoice with all related data
      const query = new Parse.Query('Invoice');
      query.include(['quote', 'requestedBy', 'processedBy', 'quote.client', 'quote.rate']);

      const invoice = await query.get(invoiceId, { useMasterKey: true });
      if (!invoice) {
        return this.sendError(res, 'Solicitud de factura no encontrada', 404);
      }

      const quote = invoice.get('quote');
      const requestedBy = invoice.get('requestedBy');
      const processedBy = invoice.get('processedBy');

      const invoiceData = {
        id: invoice.id,
        status: invoice.get('status'),
        requestDate: invoice.get('requestDate'),
        processDate: invoice.get('processDate'),
        invoiceNumber: invoice.get('invoiceNumber'),
        notes: invoice.get('notes') || '',
        quote: {
          id: quote?.id,
          folio: quote?.get('folio'),
          eventType: quote?.get('eventType'),
          numberOfPeople: quote?.get('numberOfPeople'),
          contactPhone: quote?.get('contactPhone'),
          contactEmail: quote?.get('contactEmail'),
          serviceItems: quote?.get('serviceItems') || {},
          client: quote?.get('client') ? {
            id: quote.get('client').id,
            fullName: quote.get('client').get('fullName'),
            email: quote.get('client').get('email'),
            companyName: quote.get('client').get('companyName'),
          } : null,
          rate: quote?.get('rate') ? {
            id: quote.get('rate').id,
            name: quote.get('rate').get('name'),
            color: quote.get('rate').get('color'),
          } : null,
        },
        requestedBy: {
          id: requestedBy?.id,
          fullName: requestedBy?.get('fullName') || requestedBy?.get('email') || 'N/A',
          email: requestedBy?.get('email') || '',
          role: requestedBy?.get('role') || '',
        },
        processedBy: processedBy ? {
          id: processedBy.id,
          fullName: processedBy.get('fullName') || processedBy.get('email') || 'N/A',
          email: processedBy.get('email') || '',
          role: processedBy.get('role') || '',
        } : null,
        createdAt: invoice.get('createdAt'),
        updatedAt: invoice.get('updatedAt'),
      };

      logger.info('Invoice details retrieved', {
        invoiceId: invoice.id,
        userId: currentUser.id,
        userRole,
      });

      return res.json({
        success: true,
        data: invoiceData,
      });
    } catch (error) {
      logger.error('Error retrieving invoice details', {
        error: error.message,
        stack: error.stack,
        invoiceId: req.params.id,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener detalles de la factura',
        500
      );
    }
  }

  /**
   * Complete invoice request.
   * PUT /api/invoices/:id/complete.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async completeInvoice(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        return this.sendError(res, 'No tiene permisos para completar facturas', 403);
      }

      const invoiceId = req.params.id;
      const { invoiceNumber, notes } = req.body;

      if (!invoiceId) {
        return this.sendError(res, 'ID de factura requerido', 400);
      }

      if (!invoiceNumber || !invoiceNumber.trim()) {
        return this.sendError(res, 'Número de factura requerido', 400);
      }

      // Fetch invoice
      const query = new Parse.Query('Invoice');
      query.include(['quote']);

      const invoice = await query.get(invoiceId, { useMasterKey: true });
      if (!invoice) {
        return this.sendError(res, 'Solicitud de factura no encontrada', 404);
      }

      // Validate invoice is still pending
      if (invoice.get('status') !== 'pending') {
        return this.sendError(res, 'Solo se pueden completar facturas pendientes', 400);
      }

      // Complete the invoice
      await invoice.markCompleted(currentUser, invoiceNumber.trim(), notes?.trim());

      logger.info('Invoice completed by admin', {
        invoiceId: invoice.id,
        quoteId: invoice.get('quote')?.id,
        invoiceNumber: invoiceNumber.trim(),
        completedBy: currentUser.id,
        completedByRole: userRole,
      });

      return res.json({
        success: true,
        message: 'Factura completada exitosamente',
        data: {
          id: invoice.id,
          status: invoice.get('status'),
          invoiceNumber: invoice.get('invoiceNumber'),
          processDate: invoice.get('processDate'),
        },
      });
    } catch (error) {
      logger.error('Error completing invoice', {
        error: error.message,
        stack: error.stack,
        invoiceId: req.params.id,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al completar la factura',
        500
      );
    }
  }

  /**
   * Cancel invoice request.
   * DELETE /api/invoices/:id.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async cancelInvoice(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        return this.sendError(res, 'No tiene permisos para cancelar facturas', 403);
      }

      const invoiceId = req.params.id;
      const { reason } = req.body;

      if (!invoiceId) {
        return this.sendError(res, 'ID de factura requerido', 400);
      }

      // Fetch invoice
      const query = new Parse.Query('Invoice');
      query.include(['quote']);

      const invoice = await query.get(invoiceId, { useMasterKey: true });
      if (!invoice) {
        return this.sendError(res, 'Solicitud de factura no encontrada', 404);
      }

      // Validate invoice is still pending
      if (invoice.get('status') !== 'pending') {
        return this.sendError(res, 'Solo se pueden cancelar facturas pendientes', 400);
      }

      // Cancel the invoice
      await invoice.markCancelled(currentUser, reason?.trim() || 'Cancelled by admin');

      // Update the quote to remove invoice requested flag
      const quote = invoice.get('quote');
      if (quote) {
        quote.set('invoiceRequested', false);
        quote.unset('invoiceRequestDate');
        quote.unset('invoiceRequestedBy');
        await quote.save(null, { useMasterKey: true });
      }

      logger.info('Invoice cancelled by admin', {
        invoiceId: invoice.id,
        quoteId: quote?.id,
        reason: reason?.trim() || 'Cancelled by admin',
        cancelledBy: currentUser.id,
        cancelledByRole: userRole,
      });

      return res.json({
        success: true,
        message: 'Solicitud de factura cancelada exitosamente',
        data: {
          id: invoice.id,
          status: invoice.get('status'),
          processDate: invoice.get('processDate'),
        },
      });
    } catch (error) {
      logger.error('Error cancelling invoice', {
        error: error.message,
        stack: error.stack,
        invoiceId: req.params.id,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al cancelar la factura',
        500
      );
    }
  }

  /**
   * Send error response.
   * @param {object} res - Express response object.
   * @param {string} error - Error message.
   * @param {number} statusCode - HTTP status code.
   * @returns {object} JSON response.
   * @example
   */
  sendError(res, error, statusCode = 400) {
    return res.status(statusCode).json({
      success: false,
      error,
    });
  }
}

module.exports = InvoiceController;
