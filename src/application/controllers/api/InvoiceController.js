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
   * Upload XML/PDF file for invoice.
   * POST /api/invoices/upload-file.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async uploadInvoiceFile(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        return this.sendError(res, 'No tiene permisos para subir archivos de factura', 403);
      }

      const { invoiceId, fileType } = req.body;
      const { file } = req;

      // Validate required fields
      if (!invoiceId) {
        return this.sendError(res, 'Invoice ID es requerido', 400);
      }

      if (!fileType || !['xml', 'pdf'].includes(fileType)) {
        return this.sendError(res, 'Tipo de archivo debe ser "xml" o "pdf"', 400);
      }

      if (!file) {
        return this.sendError(res, 'Archivo es requerido', 400);
      }

      // Validate file extension
      const allowedExtensions = {
        xml: ['.xml'],
        pdf: ['.pdf'],
      };

      const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
      if (!allowedExtensions[fileType].includes(fileExtension)) {
        return this.sendError(res, `Archivo ${fileType.toUpperCase()} debe tener extensión ${allowedExtensions[fileType].join(' o ')}`, 400);
      }

      // Find the invoice
      const query = new Parse.Query('Invoice');
      const invoice = await query.get(invoiceId, { useMasterKey: true });
      if (!invoice) {
        return this.sendError(res, 'Solicitud de factura no encontrada', 404);
      }

      // Allow file uploads in any status (admin may need to replace or correct files)

      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uniqueFilename = `${fileType}_${invoiceId}_${timestamp}${fileExtension}`;

      let uploadResult;
      let storageMethod = 'gridfs'; // Default to GridFS

      // Try S3 first if configured, fallback to GridFS
      if (process.env.S3_BUCKET && process.env.AWS_REGION) {
        try {
          // Import FileStorageService
          const FileStorageService = require('../../services/FileStorageService');

          // Create file storage service for invoices
          const fileStorageService = new FileStorageService({
            baseFolder: 'invoices',
            isPublic: false,
            deletionStrategy: 'move',
            presignedUrlExpires: 3600, // 1 hour
          });

          // Upload file to S3
          uploadResult = await fileStorageService.uploadFile(
            file.buffer,
            uniqueFilename,
            file.mimetype,
            {
              entityId: invoiceId,
              metadata: {
                invoiceId,
                fileType,
                originalName: file.originalname,
                uploadedBy: currentUser.id,
                uploadedAt: new Date().toISOString(),
              },
            }
          );

          storageMethod = 's3';

          logger.info('File uploaded to S3', {
            invoiceId,
            fileType,
            s3Key: uploadResult.s3Key,
            storageMethod,
          });
        } catch (s3Error) {
          logger.warn('S3 upload failed, falling back to GridFS', {
            error: s3Error.message,
            invoiceId,
            fileType,
          });
          uploadResult = null; // Will use GridFS fallback below
        }
      }

      // Use GridFS fallback if S3 not configured or failed
      if (!uploadResult) {
        // Create Parse.File for GridFS storage
        const parseFile = new Parse.File(uniqueFilename, file.buffer, file.mimetype);
        await parseFile.save(null, { useMasterKey: true });

        uploadResult = {
          s3Key: parseFile.name(),
          s3Url: parseFile.url(),
          bucket: 'gridfs', // Indicate GridFS storage
          region: 'local',
          storageMethod: 'gridfs',
        };

        logger.info('File uploaded to GridFS', {
          invoiceId,
          fileType,
          fileName: parseFile.name(),
          url: parseFile.url(),
          storageMethod,
        });
      }

      // Update invoice with file information
      const fileField = fileType === 'xml' ? 'xmlFileS3Key' : 'pdfFileS3Key';
      const urlField = fileType === 'xml' ? 'xmlFileUrl' : 'pdfFileUrl';
      const storageField = fileType === 'xml' ? 'xmlStorageMethod' : 'pdfStorageMethod';

      invoice.set(fileField, uploadResult.s3Key);
      invoice.set(urlField, uploadResult.s3Url);
      invoice.set(storageField, storageMethod);
      invoice.set('updatedAt', new Date());

      await invoice.save(null, { useMasterKey: true });

      // Check if both XML and PDF files are now uploaded
      const xmlFileKey = invoice.get('xmlFileS3Key');
      const pdfFileKey = invoice.get('pdfFileS3Key');
      const hasAllFiles = xmlFileKey && pdfFileKey;

      let statusChanged = false;
      if (hasAllFiles && invoice.get('status') === 'pending') {
        // Auto-complete invoice when both files are uploaded (only if still pending)
        const completionTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const autoInvoiceNumber = `AUTO-${invoiceId}-${completionTimestamp}`;

        await invoice.markCompleted(
          currentUser,
          autoInvoiceNumber,
          'Factura completada automáticamente al subir ambos archivos XML y PDF'
        );

        statusChanged = true;

        logger.info('Invoice auto-completed after file upload', {
          invoiceId,
          invoiceNumber: autoInvoiceNumber,
          triggeredBy: fileType,
          completedBy: currentUser.id,
        });
      } else if (invoice.get('status') !== 'pending') {
        logger.info('File uploaded to non-pending invoice (replacement/correction)', {
          invoiceId,
          currentStatus: invoice.get('status'),
          fileType,
          uploadedBy: currentUser.id,
        });
      }

      logger.info('Invoice file uploaded successfully', {
        invoiceId,
        fileType,
        storageMethod,
        fileKey: uploadResult.s3Key,
        userId: currentUser.id,
        userRole,
        originalFilename: file.originalname,
        fileSize: file.size,
        hasAllFiles,
        statusChanged,
        newStatus: invoice.get('status'),
      });

      return res.json({
        success: true,
        data: {
          invoiceId,
          fileType,
          filename: uniqueFilename,
          originalName: file.originalname,
          fileKey: uploadResult.s3Key,
          fileUrl: uploadResult.s3Url,
          storageMethod,
          fileSize: file.size,
          hasAllFiles,
          statusChanged,
          newStatus: invoice.get('status'),
          invoiceNumber: statusChanged ? invoice.get('invoiceNumber') : null,
        },
        message: statusChanged
          ? `Archivo ${fileType.toUpperCase()} subido exitosamente. Factura completada automáticamente.`
          : `Archivo ${fileType.toUpperCase()} subido exitosamente`,
      });
    } catch (error) {
      logger.error('Error uploading invoice file', {
        error: error.message,
        stack: error.stack,
        invoiceId: req.body?.invoiceId,
        fileType: req.body?.fileType,
        userId: req.user?.id,
        userRole: req.userRole,
        filename: req.file?.originalname,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al subir el archivo',
        500
      );
    }
  }

  /**
   * Get count of pending invoices for badge display.
   * GET /api/invoices/pending-count.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async getPendingCount(req, res) {
    try {
      logger.info('getPendingCount called', {
        hasUser: !!req.user,
        userRole: req.userRole,
        userId: req.user?.id,
      });

      const currentUser = req.user;
      if (!currentUser) {
        logger.warn('getPendingCount: No user found in request');
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');
      logger.info('getPendingCount: User role', { userRole });

      // Validate permissions
      if (!this.allowedRoles.includes(userRole)) {
        logger.warn('getPendingCount: Insufficient permissions', { userRole, allowedRoles: this.allowedRoles });
        return this.sendError(res, 'No tiene permisos para ver conteo de facturas', 403);
      }

      // Count pending invoices
      const query = new Parse.Query('Invoice');
      query.equalTo('status', 'pending');
      query.equalTo('active', true);
      query.equalTo('exists', true);

      const count = await query.count({ useMasterKey: true });
      logger.info('getPendingCount: Count result', { count });

      return res.json({
        success: true,
        data: {
          pendingCount: count,
        },
      });
    } catch (error) {
      logger.error('Error getting pending invoices count', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al obtener conteo de facturas',
        500
      );
    }
  }

  /**
   * Download invoice file (XML or PDF).
   * GET /api/invoices/download/:invoiceId/:fileType.
   * @param {object} req - Express request object.
   * @param {object} res - Express response object.
   * @returns {Promise<void>}
   * @example
   */
  async downloadInvoiceFile(req, res) {
    try {
      const currentUser = req.user;
      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      const userRole = req.userRole || currentUser.get('role');
      const { invoiceId, fileType } = req.params;

      // Validate parameters
      if (!invoiceId) {
        return this.sendError(res, 'ID de factura requerido', 400);
      }

      if (!fileType || !['xml', 'pdf'].includes(fileType)) {
        return this.sendError(res, 'Tipo de archivo debe ser "xml" o "pdf"', 400);
      }

      // Department managers only see their department's invoices
      let departmentFilter = null;
      if (userRole === 'department_manager') {
        const userDepartment = currentUser.get('department');
        if (!userDepartment) {
          return this.sendError(res, 'Usuario no tiene departamento asignado', 403);
        }
        departmentFilter = userDepartment;
      }

      // Find the invoice with related quote
      const query = new Parse.Query('Invoice');
      query.include(['quote', 'quote.createdBy', 'quote.createdBy.department']);

      const invoice = await query.get(invoiceId, { useMasterKey: true });
      if (!invoice) {
        return this.sendError(res, 'Factura no encontrada', 404);
      }

      // Check department access for department managers
      if (departmentFilter) {
        const quote = invoice.get('quote');
        const quoteCreator = quote?.get('createdBy');
        const creatorDepartment = quoteCreator?.get('department');

        if (!creatorDepartment || creatorDepartment.id !== departmentFilter.id) {
          return this.sendError(res, 'No tiene acceso a facturas de otros departamentos', 403);
        }
      }

      // Check if invoice is completed and has files
      if (invoice.get('status') !== 'completed') {
        return this.sendError(res, 'Solo se pueden descargar archivos de facturas completadas', 400);
      }

      // Get file information
      const fileKey = invoice.get(fileType === 'xml' ? 'xmlFileS3Key' : 'pdfFileS3Key');
      const fileUrl = invoice.get(fileType === 'xml' ? 'xmlFileUrl' : 'pdfFileUrl');
      const storageMethod = invoice.get(fileType === 'xml' ? 'xmlStorageMethod' : 'pdfStorageMethod') || 'gridfs';

      if (!fileKey) {
        return this.sendError(res, `Archivo ${fileType.toUpperCase()} no disponible para esta factura`, 404);
      }

      // Handle download based on storage method
      if (storageMethod === 's3' && process.env.S3_BUCKET) {
        try {
          // Import FileStorageService
          const FileStorageService = require('../../services/FileStorageService');

          // Create file storage service
          const fileStorageService = new FileStorageService({
            baseFolder: 'invoices',
            isPublic: false,
            deletionStrategy: 'move',
            presignedUrlExpires: 300, // 5 minutes for download
          });

          // Generate presigned download URL
          const presignedUrl = await fileStorageService.generatePresignedUrl(fileKey, 'getObject', 300);

          // Redirect to presigned URL for direct download
          return res.redirect(presignedUrl);
        } catch (s3Error) {
          logger.error('S3 download error, falling back to direct URL', {
            error: s3Error.message,
            invoiceId,
            fileType,
            fileKey,
          });

          // Fallback to direct URL if presigned URL generation fails
          if (fileUrl) {
            return res.redirect(fileUrl);
          }
        }
      }

      // GridFS or direct URL fallback
      if (fileUrl) {
        return res.redirect(fileUrl);
      }

      // If we reach here, file exists in database but not accessible
      logger.error('Invoice file exists but cannot be accessed', {
        invoiceId,
        fileType,
        fileKey,
        fileUrl,
        storageMethod,
      });

      return this.sendError(res, 'Error al acceder al archivo solicitado', 500);
    } catch (error) {
      logger.error('Error downloading invoice file', {
        error: error.message,
        stack: error.stack,
        invoiceId: req.params.invoiceId,
        fileType: req.params.fileType,
        userId: req.user?.id,
        userRole: req.userRole,
      });

      return this.sendError(
        res,
        process.env.NODE_ENV === 'development' ? `Error: ${error.message}` : 'Error al descargar el archivo',
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
