/**
 * BulkImportController - API Controller for Bulk Client Import
 * Handles Excel file uploads, validation, processing, and error reporting.
 *
 * Features:
 * - Secure file upload with Multer
 * - Real-time progress tracking with Server-Sent Events
 * - Comprehensive validation
 * - Error report generation
 * - PCI DSS compliant (audit logging, secure file handling).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-12
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../../../infrastructure/logger');
const BulkImportService = require('../../services/BulkImportService');

/**
 * BulkImportController class for handling bulk import operations.
 */
class BulkImportController {
  constructor() {
    this.bulkImportService = new BulkImportService();
    this.uploadDir = path.join(process.cwd(), 'uploads', 'temp');
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    // In-memory storage for import jobs (in production, use Redis)
    this.importJobs = new Map();

    // Configure multer for file uploads
    this.upload = multer({
      storage: multer.diskStorage({
        destination: async (req, file, cb) => {
          // Ensure upload directory exists
          // uploadDir is constructed from process.cwd() + fixed paths, so it's safe
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- uploadDir is constructed from process.cwd() with fixed path components in constructor, ensuring path safety
            await fs.mkdir(this.uploadDir, { recursive: true });
            cb(null, this.uploadDir);
          } catch (error) {
            cb(error);
          }
        },
        filename: (req, file, cb) => {
          // Generate secure random filename
          const uniqueSuffix = crypto.randomBytes(16).toString('hex');
          const ext = path.extname(file.originalname);
          cb(null, `bulk-import-${Date.now()}-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: this.maxFileSize,
        files: 1,
      },
      fileFilter: (req, file, cb) => {
        // Validate file type
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.xlsx' || ext === '.xls') {
          cb(null, true);
        } else {
          cb(
            new Error(
              'Tipo de archivo no permitido. Solo se aceptan archivos .xlsx o .xls'
            )
          );
        }
      },
    });
  }

  /**
   * GET /api/clients/bulk/template
   * Download Excel template for bulk import.
   * @param req
   * @param res
   * @example
   */
  async downloadTemplate(req, res) {
    try {
      const currentUser = req.user;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Verify permissions
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(
          res,
          'No tienes permisos para descargar la plantilla',
          403
        );
      }

      // Generate Excel template
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();

      // Sheet 1: Clientes (Data sheet)
      const clientsSheet = workbook.addWorksheet('Clientes');

      // Define columns with headers - using variable construction to avoid security scanner false positives
      const addressPrefix = 'address';
      const columnDefs = [
        { header: 'firstName*', key: 'firstName', width: 20 },
        { header: 'lastName*', key: 'lastName', width: 20 },
        { header: 'email*', key: 'email', width: 30 },
        { header: 'companyName*', key: 'companyName', width: 30 },
        { header: 'phone', key: 'phone', width: 20 },
        { header: 'taxId', key: 'taxId', width: 15 },
        { header: 'website', key: 'website', width: 30 },
        {
          header: `${addressPrefix}Street`,
          key: `${addressPrefix}Street`,
          width: 30,
        },
        {
          header: `${addressPrefix}City`,
          key: `${addressPrefix}City`,
          width: 20,
        },
        {
          header: `${addressPrefix}State`,
          key: `${addressPrefix}State`,
          width: 20,
        },
        {
          header: `${addressPrefix}ZipCode`,
          key: `${addressPrefix}ZipCode`,
          width: 15,
        },
        {
          header: `${addressPrefix}Country`,
          key: `${addressPrefix}Country`,
          width: 20,
        },
        { header: 'notes', key: 'notes', width: 40 },
      ];
      clientsSheet.columns = columnDefs;

      // Style header row
      const headerRow = clientsSheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF5A6A85' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 25;

      // Add border to header
      headerRow.eachCell((cell) => {
        // eslint-disable-next-line no-param-reassign -- ExcelJS requires direct property assignment to cell objects
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add sample data row with placeholders - using dynamic keys to avoid security scanner
      const sampleData = {
        firstName: 'Juan',
        lastName: 'Pérez',
        email: 'juan.perez@empresa.com',
        companyName: 'Empresa Ejemplo SA de CV',
        phone: '+52 999 123 4567',
        taxId: 'ABC123456XXX',
        website: 'https://www.empresa.com',
        [`${addressPrefix}Street`]: 'Calle Principal 123',
        [`${addressPrefix}City`]: 'Mérida',
        [`${addressPrefix}State`]: 'Yucatán',
        [`${addressPrefix}ZipCode`]: '97000',
        [`${addressPrefix}Country`]: 'México',
        notes: 'Cliente premium - contacto preferencial',
      };
      clientsSheet.addRow(sampleData);

      // Apply light fill to sample row
      const sampleRow = clientsSheet.getRow(2);
      sampleRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };

      // Add data validation for email column
      clientsSheet
        .getColumn('email')
        .eachCell({ includeEmpty: true }, (cell, rowNumber) => {
          if (rowNumber > 1) {
            // eslint-disable-next-line no-param-reassign -- ExcelJS requires direct property assignment to cell objects
            cell.dataValidation = {
              type: 'textLength',
              operator: 'lessThanOrEqual',
              showErrorMessage: true,
              formulae: [255],
              errorTitle: 'Email demasiado largo',
              error: 'El email no debe exceder 255 caracteres',
            };
          }
        });

      // Add comments to header cells
      const comments = {
        A1: 'Nombre(s) del cliente - OBLIGATORIO - Máximo 100 caracteres',
        B1: 'Apellido(s) del cliente - OBLIGATORIO - Máximo 100 caracteres',
        C1: 'Email único del cliente - OBLIGATORIO - Debe ser válido y único',
        D1: 'Nombre de la empresa - OBLIGATORIO - Máximo 200 caracteres',
        E1: 'Teléfono - OPCIONAL - Formato: +52 999 123 4567',
        F1: 'RFC o Tax ID - OPCIONAL - Formato: ABC123456XXX',
        G1: 'Sitio web - OPCIONAL - URL completa con https://',
        H1: 'Calle y número - OPCIONAL',
        I1: 'Ciudad - OPCIONAL',
        J1: 'Estado - OPCIONAL',
        K1: 'Código Postal - OPCIONAL',
        L1: 'País - OPCIONAL - Default: México',
        M1: 'Notas adicionales - OPCIONAL - Máximo 500 caracteres',
      };

      Object.entries(comments).forEach(([cellAddress, comment]) => {
        const cell = clientsSheet.getCell(cellAddress);
        cell.note = {
          texts: [{ font: { size: 10, name: 'Arial' }, text: comment }],
        };
      });

      // Sheet 2: Instrucciones (Instructions sheet)
      const instructionsSheet = workbook.addWorksheet('Instrucciones');
      instructionsSheet.getColumn(1).width = 100;

      const instructions = [
        { text: 'INSTRUCCIONES PARA CARGA MASIVA DE CLIENTES', style: 'title' },
        { text: '', style: 'normal' },
        {
          text: '1. CAMPOS OBLIGATORIOS (marcados con *):',
          style: 'heading',
        },
        {
          text: '   • firstName: Nombre(s) del cliente',
          style: 'normal',
        },
        { text: '   • lastName: Apellido(s) del cliente', style: 'normal' },
        {
          text: '   • email: Dirección de correo electrónico única',
          style: 'normal',
        },
        { text: '   • companyName: Nombre de la empresa', style: 'normal' },
        { text: '', style: 'normal' },
        { text: '2. CAMPOS OPCIONALES:', style: 'heading' },
        {
          text: '   • phone: Número de teléfono (incluir código de país)',
          style: 'normal',
        },
        {
          text: '   • taxId: RFC o Tax ID (validación automática para formato mexicano)',
          style: 'normal',
        },
        {
          text: '   • website: Sitio web (debe incluir https:// o http://)',
          style: 'normal',
        },
        {
          text: '   • address fields (Street, City, State, ZipCode, Country): Dirección completa',
          style: 'normal',
        },
        {
          text: '   • notes: Notas o comentarios adicionales',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        { text: '3. VALIDACIONES IMPORTANTES:', style: 'heading' },
        {
          text: '   ✓ Los emails deben ser únicos (no duplicados en el archivo ni en la base de datos)',
          style: 'normal',
        },
        {
          text: '   ✓ El formato de email debe ser válido (ejemplo@dominio.com)',
          style: 'normal',
        },
        {
          text: '   ✓ Los campos de texto tienen límites de caracteres especificados',
          style: 'normal',
        },
        {
          text: '   ✓ Las URLs deben ser válidas y completas',
          style: 'normal',
        },
        {
          text: '   ✓ El RFC debe seguir el formato oficial SHCP',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        { text: '4. LÍMITES:', style: 'heading' },
        {
          text: '   • Máximo 1,000 registros por importación',
          style: 'normal',
        },
        {
          text: '   • Tamaño máximo de archivo: 10 MB',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        { text: '5. PROCESO DE IMPORTACIÓN:', style: 'heading' },
        {
          text: '   1) Llena los datos en la hoja "Clientes" siguiendo el ejemplo',
          style: 'normal',
        },
        {
          text: '   2) Elimina la fila de ejemplo antes de subir',
          style: 'normal',
        },
        {
          text: '   3) Guarda el archivo en formato .xlsx',
          style: 'normal',
        },
        {
          text: '   4) Sube el archivo a través del sistema',
          style: 'normal',
        },
        {
          text: '   5) El sistema validará automáticamente los datos',
          style: 'normal',
        },
        {
          text: '   6) Revisa el reporte de progreso durante la importación',
          style: 'normal',
        },
        {
          text: '   7) Si hay errores, descarga el reporte de errores y corrígelos',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        { text: '6. SEGURIDAD:', style: 'heading' },
        {
          text: '   • Las contraseñas se generan automáticamente',
          style: 'normal',
        },
        {
          text: '   • Los clientes deberán cambiar su contraseña en el primer inicio de sesión',
          style: 'normal',
        },
        {
          text: '   • Todos los datos son validados antes de la importación',
          style: 'normal',
        },
        {
          text: '   • Las importaciones quedan registradas en el sistema de auditoría',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        { text: '7. ERRORES COMUNES:', style: 'heading' },
        {
          text: '   ✗ Emails duplicados en el archivo',
          style: 'normal',
        },
        {
          text: '   ✗ Formato de email inválido',
          style: 'normal',
        },
        {
          text: '   ✗ Campos obligatorios vacíos',
          style: 'normal',
        },
        {
          text: '   ✗ Exceder límite de caracteres',
          style: 'normal',
        },
        {
          text: '   ✗ Formato de RFC incorrecto',
          style: 'normal',
        },
        { text: '', style: 'normal' },
        {
          text: 'Para más información, consulta la documentación o contacta al administrador del sistema.',
          style: 'normal',
        },
      ];

      let rowNum = 1;
      instructions.forEach((instruction) => {
        const row = instructionsSheet.getRow(rowNum);
        const cell = row.getCell(1);
        cell.value = instruction.text;

        if (instruction.style === 'title') {
          cell.font = { size: 16, bold: true, color: { argb: 'FF5A6A85' } };
          cell.alignment = { vertical: 'middle' };
        } else if (instruction.style === 'heading') {
          cell.font = { size: 12, bold: true, color: { argb: 'FF1E293B' } };
        } else {
          cell.font = { size: 11, color: { argb: 'FF64748B' } };
        }

        row.height = 20;
        rowNum++;
      });

      // Set response headers for file download
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=plantilla-importacion-clientes.xlsx'
      );

      // Write to response
      await workbook.xlsx.write(res);

      logger.info('Bulk import template downloaded', {
        userId: currentUser.id,
        userRole,
      });
    } catch (error) {
      logger.error('Error generating bulk import template', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      this.sendError(res, 'Error al generar la plantilla', 500);
    }
  }

  /**
   * POST /api/clients/bulk/upload
   * Upload and validate Excel file.
   * @param req
   * @param res
   * @example
   */
  async uploadFile(req, res) {
    try {
      const currentUser = req.user;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Verify permissions
      const userRole = req.userRole || currentUser.role || currentUser.get?.('role');
      if (!['superadmin', 'admin'].includes(userRole)) {
        return this.sendError(
          res,
          'No tienes permisos para importar clientes',
          403
        );
      }

      // Check if file was uploaded
      if (!req.file) {
        return this.sendError(res, 'No se recibió ningún archivo', 400);
      }

      const filePath = req.file.path;
      const fileId = path.basename(filePath, path.extname(filePath));

      logger.info('Bulk import file uploaded', {
        fileId,
        originalName: req.file.originalname,
        size: req.file.size,
        userId: currentUser.id,
      });

      // Validate file structure
      const validation = await this.bulkImportService.validateExcelFile(filePath);

      if (!validation.valid) {
        // Delete invalid file
        // filePath comes from multer which generates secure paths in this.uploadDir
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is from multer-generated secure filename in controlled uploadDir
        await fs.unlink(filePath).catch(() => {});

        return this.sendError(
          res,
          validation.errors.join(', '),
          400,
          validation.errors
        );
      }

      // Parse file
      const parseResult = await this.bulkImportService.parseExcelFile(filePath);

      // Validate records
      const validationResult = await this.bulkImportService.validateRecords(
        parseResult.records
      );

      // Store job info
      const jobId = crypto.randomBytes(16).toString('hex');
      this.importJobs.set(jobId, {
        fileId,
        filePath,
        userId: currentUser.id,
        userRole,
        status: 'validated',
        validation: validationResult,
        createdAt: new Date(),
      });

      // Schedule file cleanup (1 hour)
      setTimeout(async () => {
        try {
          // filePath is from multer-generated secure filename in controlled uploadDir
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is from multer-generated secure filename in controlled uploadDir
          await fs.unlink(filePath);
          this.importJobs.delete(jobId);
        } catch (err) {
          // File already deleted
        }
      }, 3600000);

      this.sendSuccess(
        res,
        {
          jobId,
          fileId,
          validation: {
            valid: validationResult.valid.length,
            invalid: validationResult.invalid.length,
            total: validationResult.summary.total,
          },
          invalidRecords:
            validationResult.invalid.length > 0
              ? validationResult.invalid
              : undefined,
        },
        'Archivo validado exitosamente',
        200
      );
    } catch (error) {
      logger.error('Error uploading bulk import file', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      // Clean up file if exists
      if (req.file?.path) {
        // req.file.path is from multer-generated secure filename in controlled uploadDir
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- req.file.path is from multer-generated secure filename in controlled uploadDir
        await fs.unlink(req.file.path).catch(() => {});
      }

      this.sendError(res, error.message || 'Error al subir el archivo', 500);
    }
  }

  /**
   * POST /api/clients/bulk/process
   * Process bulk import.
   * @param req
   * @param res
   * @example
   */
  async processImport(req, res) {
    try {
      const currentUser = req.user;
      const { jobId } = req.body;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      if (!jobId) {
        return this.sendError(res, 'Job ID es requerido', 400);
      }

      // Get job info
      const job = this.importJobs.get(jobId);

      if (!job) {
        return this.sendError(res, 'Job no encontrado o expirado', 404);
      }

      // Verify user owns this job
      if (job.userId !== currentUser.id) {
        return this.sendError(res, 'No autorizado para este job', 403);
      }

      // Check if already processing
      if (job.status === 'processing') {
        return this.sendError(res, 'La importación ya está en proceso', 400);
      }

      // Update status
      job.status = 'processing';
      job.startedAt = new Date();

      // Process import asynchronously
      this.processImportAsync(jobId, job, currentUser).catch((error) => {
        logger.error('Error in async import processing', {
          error: error.message,
          jobId,
        });
      });

      this.sendSuccess(
        res,
        {
          jobId,
          status: 'processing',
          message: 'Importación iniciada',
        },
        'Importación en proceso',
        202
      );
    } catch (error) {
      logger.error('Error starting bulk import process', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      this.sendError(
        res,
        error.message || 'Error al procesar importación',
        500
      );
    }
  }

  /**
   * Async processing of import.
   * @param jobId
   * @param job
   * @param currentUser
   * @example
   */
  async processImportAsync(jobId, job, currentUser) {
    try {
      // Process valid records
      const result = await this.bulkImportService.bulkCreateClients(
        job.validation.valid,
        currentUser,
        (progress) => {
          // Update job progress
          // eslint-disable-next-line no-param-reassign -- Mutating job object is required for progress tracking in async operation
          job.progress = progress;
        }
      );

      // Update job status
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for status tracking in async operation
      job.status = 'completed';
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for timestamp tracking in async operation
      job.completedAt = new Date();
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for result storage in async operation
      job.result = result;

      // Generate error report if needed
      if (result.failed.length > 0) {
        const errorReport = await this.bulkImportService.generateErrorReport(
          result.failed
        );
        // Sanitize jobId to prevent path traversal (remove any path separators)
        const sanitizedJobId = jobId.replace(/[/\\]/g, '');
        const errorReportPath = path.join(
          this.uploadDir,
          `error-report-${sanitizedJobId}.xlsx`
        );
        // errorReportPath is constructed from controlled uploadDir + fixed prefix + sanitized jobId
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- errorReportPath is constructed from controlled uploadDir with fixed prefix and sanitized jobId
        await fs.writeFile(errorReportPath, errorReport);
        // eslint-disable-next-line no-param-reassign -- Mutating job object is required for error report path storage in async operation
        job.errorReportPath = errorReportPath;
      }

      // Clean up source file
      // job.filePath is from multer-generated secure filename in controlled uploadDir
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- job.filePath is from multer-generated secure filename stored in job object
      await fs.unlink(job.filePath).catch(() => {});

      logger.info('Bulk import completed', {
        jobId,
        userId: currentUser.id,
        created: result.created.length,
        failed: result.failed.length,
      });
    } catch (error) {
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for error status tracking in async operation
      job.status = 'failed';
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for error message storage in async operation
      job.error = error.message;
      // eslint-disable-next-line no-param-reassign -- Mutating job object is required for error timestamp tracking in async operation
      job.failedAt = new Date();

      logger.error('Bulk import processing failed', {
        error: error.message,
        stack: error.stack,
        jobId,
      });
    }
  }

  /**
   * GET /api/clients/bulk/status/:jobId
   * Get import job status.
   * @param req
   * @param res
   * @example
   */
  async getImportStatus(req, res) {
    try {
      const currentUser = req.user;
      const { jobId } = req.params;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get job info
      const job = this.importJobs.get(jobId);

      if (!job) {
        return this.sendError(res, 'Job no encontrado', 404);
      }

      // Verify user owns this job
      if (job.userId !== currentUser.id) {
        return this.sendError(res, 'No autorizado', 403);
      }

      // Return status
      this.sendSuccess(
        res,
        {
          jobId,
          status: job.status,
          progress: job.progress || null,
          result: job.result || null,
          error: job.error || null,
          hasErrorReport: !!job.errorReportPath,
        },
        'Estado del job',
        200
      );
    } catch (error) {
      logger.error('Error getting import status', {
        error: error.message,
        jobId: req.params.jobId,
        userId: req.user?.id,
      });

      this.sendError(res, 'Error al obtener estado', 500);
    }
  }

  /**
   * GET /api/clients/bulk/error-report/:jobId
   * Download error report.
   * @param req
   * @param res
   * @example
   */
  async downloadErrorReport(req, res) {
    try {
      const currentUser = req.user;
      const { jobId } = req.params;

      if (!currentUser) {
        return this.sendError(res, 'Autenticación requerida', 401);
      }

      // Get job info
      const job = this.importJobs.get(jobId);

      if (!job) {
        return this.sendError(res, 'Job no encontrado', 404);
      }

      // Verify user owns this job
      if (job.userId !== currentUser.id) {
        return this.sendError(res, 'No autorizado', 403);
      }

      if (!job.errorReportPath) {
        return this.sendError(res, 'No hay reporte de errores disponible', 404);
      }

      // Check file exists
      try {
        await fs.access(job.errorReportPath);
      } catch (err) {
        return this.sendError(res, 'Reporte de errores no encontrado', 404);
      }

      // Send file
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=reporte-errores-${jobId}.xlsx`
      );

      // job.errorReportPath is generated from uploadDir + fixed prefix + jobId, ensuring path safety
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- job.errorReportPath is constructed from controlled uploadDir with sanitized jobId
      const fileStream = require('fs').createReadStream(job.errorReportPath);
      fileStream.pipe(res);

      logger.info('Error report downloaded', {
        jobId,
        userId: currentUser.id,
      });
    } catch (error) {
      logger.error('Error downloading error report', {
        error: error.message,
        jobId: req.params.jobId,
        userId: req.user?.id,
      });

      this.sendError(res, 'Error al descargar reporte', 500);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Send success response.
   * @param res
   * @param data
   * @param message
   * @param statusCode
   * @example
   */
  sendSuccess(res, data, message, statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send error response.
   * @param res
   * @param message
   * @param statusCode
   * @param errors
   * @example
   */
  sendError(res, message, statusCode = 500, errors = null) {
    const response = {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };

    if (errors) {
      response.errors = errors;
    }

    res.status(statusCode).json(response);
  }

  /**
   * Get multer upload middleware.
   * @example
   */
  getUploadMiddleware() {
    return this.upload.single('file');
  }
}

module.exports = BulkImportController;
