/**
 * BulkImportService - Excel Bulk Import Service for Client Management
 * Handles Excel file parsing, validation, and bulk client creation.
 *
 * Features:
 * - Excel file validation and parsing (ExcelJS)
 * - Comprehensive data validation (emails, formats, duplicates)
 * - Bulk client creation with progress tracking
 * - Error reporting and recovery
 * - PCI DSS compliant (no sensitive data logging).
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-12
 * @example
 * const service = new BulkImportService();
 * const result = await service.processImport(filePath, currentUser);
 */

const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const UserManagementService = require('./UserManagementService');

/**
 * BulkImportService class for handling Excel bulk imports.
 */
class BulkImportService {
  constructor() {
    this.userService = new UserManagementService();
    this.maxRecords = 1000; // Maximum records per import
    this.clientRole = 'department_manager';

    // Required columns in Excel
    this.requiredColumns = ['firstName', 'lastName', 'email', 'companyName'];

    // Optional columns
    this.optionalColumns = [
      'phone',
      'taxId',
      'website',
      'addressStreet',
      'addressCity',
      'addressState',
      'addressZipCode',
      'addressCountry',
      'notes',
    ];

    // All valid columns
    this.validColumns = [...this.requiredColumns, ...this.optionalColumns];

    // Column mappings (header name in Excel -> internal field name)
    this.columnMappings = {
      firstName: ['firstName', 'nombre', 'first_name', 'name'],
      lastName: ['lastName', 'apellido', 'last_name', 'surname'],
      email: ['email', 'correo', 'e-mail'],
      companyName: ['companyName', 'empresa', 'company', 'razonSocial'],
      phone: ['phone', 'telefono', 'telephone'],
      taxId: ['taxId', 'rfc', 'tax_id'],
      website: ['website', 'sitioWeb', 'web'],
      addressStreet: ['addressStreet', 'calle', 'street', 'direccion'],
      addressCity: ['addressCity', 'ciudad', 'city'],
      addressState: ['addressState', 'estado', 'state'],
      addressZipCode: ['addressZipCode', 'cp', 'codigoPostal', 'zipCode'],
      addressCountry: ['addressCountry', 'pais', 'country'],
      notes: ['notes', 'notas', 'observaciones', 'comments'],
    };
  }

  /**
   * Validate Excel file structure and format.
   * @param {string} filePath - Path to Excel file.
   * @returns {Promise<object>} - Validation result.
   * @example
   */
  async validateExcelFile(filePath) {
    try {
      logger.info('Validating Excel file', { filePath });

      // Check file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return {
          valid: false,
          errors: ['Archivo no encontrado'],
          warnings: [],
        };
      }

      // Check file size (max 10MB)
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is validated from secure upload process
      const stats = await fs.stat(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        return {
          valid: false,
          errors: ['El archivo excede el tamaño máximo de 10MB'],
          warnings: [],
        };
      }

      // Try to load workbook
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      // Check for main sheet
      const worksheet = workbook.getWorksheet('Clientes') || workbook.getWorksheet(1);

      if (!worksheet) {
        return {
          valid: false,
          errors: ['No se encontró ninguna hoja de trabajo en el archivo'],
          warnings: [],
        };
      }

      // Get headers from first row
      const headerRow = worksheet.getRow(1);
      const headers = [];
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(this.normalizeColumnName(cell.value));
      });

      // Validate required columns are present
      const missingColumns = [];
      this.requiredColumns.forEach((requiredCol) => {
        const found = headers.some((header) => this.isColumnMatch(header, requiredCol));
        if (!found) {
          missingColumns.push(requiredCol);
        }
      });

      if (missingColumns.length > 0) {
        return {
          valid: false,
          errors: [
            `Columnas requeridas faltantes: ${missingColumns.join(', ')}`,
          ],
          warnings: [],
        };
      }

      // Count data rows (excluding header)
      let rowCount = 0;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && this.hasDataInRow(row)) {
          rowCount++;
        }
      });

      if (rowCount === 0) {
        return {
          valid: false,
          errors: ['El archivo no contiene datos para importar'],
          warnings: [],
        };
      }

      if (rowCount > this.maxRecords) {
        return {
          valid: false,
          errors: [
            `El archivo contiene ${rowCount} registros. Máximo permitido: ${this.maxRecords}`,
          ],
          warnings: [],
        };
      }

      // Validation successful
      return {
        valid: true,
        errors: [],
        warnings: [],
        metadata: {
          rowCount,
          headers,
          sheetName: worksheet.name,
        },
      };
    } catch (error) {
      logger.error('Error validating Excel file', {
        error: error.message,
        stack: error.stack,
        filePath,
      });

      return {
        valid: false,
        errors: [
          'Error al leer el archivo Excel. Asegúrate de que sea un archivo válido (.xlsx)',
        ],
        warnings: [],
      };
    }
  }

  /**
   * Parse Excel file and extract records.
   * @param {string} filePath - Path to Excel file.
   * @returns {Promise<object>} - Parsed records and metadata.
   * @example
   */
  async parseExcelFile(filePath) {
    try {
      logger.info('Parsing Excel file', { filePath });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const worksheet = workbook.getWorksheet('Clientes') || workbook.getWorksheet(1);

      // Get column mappings from first row
      const headerRow = worksheet.getRow(1);
      const columnMap = {};

      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const headerName = this.normalizeColumnName(cell.value);
        const internalName = this.mapColumnName(headerName);
        if (internalName) {
          columnMap[colNumber] = internalName;
        }
      });

      // Parse data rows
      const records = [];
      const parseErrors = [];

      worksheet.eachRow((row, rowNumber) => {
        // Skip header row
        if (rowNumber === 1) return;

        // Skip empty rows
        if (!this.hasDataInRow(row)) return;

        try {
          const record = { rowNumber };

          // Extract cell values based on column mapping
          Object.keys(columnMap).forEach((colNumber) => {
            const fieldName = columnMap[colNumber];
            const cell = row.getCell(parseInt(colNumber));
            const value = this.getCellValue(cell);

            if (value !== null && value !== '') {
              record[fieldName] = value;
            }
          });

          records.push(record);
        } catch (error) {
          parseErrors.push({
            row: rowNumber,
            error: `Error al parsear fila: ${error.message}`,
          });
        }
      });

      logger.info('Excel file parsed successfully', {
        recordCount: records.length,
        parseErrors: parseErrors.length,
      });

      return {
        records,
        parseErrors,
        metadata: {
          totalRows: records.length,
          columnsFound: Object.values(columnMap),
        },
      };
    } catch (error) {
      logger.error('Error parsing Excel file', {
        error: error.message,
        stack: error.stack,
        filePath,
      });

      throw new Error('Error al procesar el archivo Excel');
    }
  }

  /**
   * Validate individual records.
   * @param {Array} records - Array of records to validate.
   * @returns {Promise<object>} - Validation results.
   * @example
   */
  async validateRecords(records) {
    logger.info('Validating records', { count: records.length });

    const validRecords = [];
    const invalidRecords = [];
    const emailsInFile = new Set();

    // Get existing emails from database
    const existingEmails = await this.getExistingEmails();

    for (const record of records) {
      const errors = [];
      const warnings = [];

      // Validate required fields
      this.requiredColumns.forEach((field) => {
        if (!record[field] || record[field].trim() === '') {
          errors.push(`Campo requerido faltante: ${field}`);
        }
      });

      // Validate email format
      if (record.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(record.email)) {
          errors.push('Formato de email inválido');
        } else {
          // Check for duplicate in file
          const emailLower = record.email.toLowerCase();
          if (emailsInFile.has(emailLower)) {
            errors.push('Email duplicado en el archivo');
          } else {
            emailsInFile.add(emailLower);

            // Check for duplicate in database
            if (existingEmails.has(emailLower)) {
              errors.push('Email ya existe en la base de datos');
            }
          }
        }
      }

      // Validate field lengths
      if (record.firstName && record.firstName.length > 100) {
        errors.push('firstName excede 100 caracteres');
      }
      if (record.lastName && record.lastName.length > 100) {
        errors.push('lastName excede 100 caracteres');
      }
      if (record.email && record.email.length > 255) {
        errors.push('Email excede 255 caracteres');
      }
      if (record.companyName && record.companyName.length > 200) {
        errors.push('companyName excede 200 caracteres');
      }
      if (record.notes && record.notes.length > 500) {
        errors.push('Notas exceden 500 caracteres');
      }

      // Validate phone format (optional, if provided)
      if (record.phone) {
        // Basic phone validation (digits, spaces, dashes, parentheses, plus)
        const phoneRegex = /^[\d\s\-()+]+$/;
        if (!phoneRegex.test(record.phone)) {
          warnings.push('Formato de teléfono puede ser inválido');
        }
      }

      // Validate URL format (optional, if provided)
      if (record.website) {
        try {
          const url = new URL(record.website);
          // URL is valid if no error is thrown
          if (!url) {
            warnings.push('Formato de URL inválido');
          }
        } catch (e) {
          warnings.push('Formato de URL inválido');
        }
      }

      // Validate RFC format (optional, if provided)
      if (record.taxId) {
        // Basic RFC validation (12-13 alphanumeric characters)
        const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
        if (!rfcRegex.test(record.taxId)) {
          warnings.push('Formato de RFC puede ser inválido');
        }
      }

      // Categorize record
      if (errors.length > 0) {
        invalidRecords.push({
          ...record,
          errors,
          warnings,
        });
      } else {
        validRecords.push({
          ...record,
          warnings,
        });
      }
    }

    logger.info('Record validation complete', {
      valid: validRecords.length,
      invalid: invalidRecords.length,
    });

    return {
      valid: validRecords,
      invalid: invalidRecords,
      summary: {
        total: records.length,
        valid: validRecords.length,
        invalid: invalidRecords.length,
      },
    };
  }

  /**
   * Get existing emails from database.
   * @returns {Promise<Set>} - Set of existing emails (lowercase).
   * @example
   */
  async getExistingEmails() {
    try {
      const query = new Parse.Query('AmexingUser');
      query.select('email');
      query.equalTo('exists', true);
      query.limit(10000); // Adjust as needed

      const users = await query.find({ useMasterKey: true });
      const emails = new Set();

      users.forEach((user) => {
        const email = user.get('email');
        if (email) {
          emails.add(email.toLowerCase());
        }
      });

      return emails;
    } catch (error) {
      logger.error('Error fetching existing emails', {
        error: error.message,
      });
      return new Set();
    }
  }

  /**
   * Bulk create clients with progress tracking.
   * @param {Array} records - Valid records to create.
   * @param {object} currentUser - Current authenticated user.
   * @param {Function} progressCallback - Optional progress callback.
   * @returns {Promise<object>} - Creation results.
   * @example
   */
  async bulkCreateClients(records, currentUser, progressCallback = null) {
    logger.info('Starting bulk client creation', {
      recordCount: records.length,
      userId: currentUser.id,
    });

    const created = [];
    const failed = [];
    const total = records.length;

    // Get role object once
    const roleQuery = new Parse.Query('Role');
    roleQuery.equalTo('name', this.clientRole);
    roleQuery.equalTo('active', true);
    roleQuery.equalTo('exists', true);
    const roleObject = await roleQuery.first({ useMasterKey: true });

    if (!roleObject) {
      throw new Error(
        `Role '${this.clientRole}' not found. Please ensure roles are configured.`
      );
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        // Prepare client data
        const clientData = {
          firstName: record.firstName.trim(),
          lastName: record.lastName.trim(),
          email: record.email.trim().toLowerCase(),
          username: record.email.trim().toLowerCase(),
          companyName: record.companyName.trim(),
          organizationId: 'client',
          roleId: roleObject.id,
          role: this.clientRole,
          password: this.generateSecurePassword(),
          mustChangePassword: true,
          active: true,
          exists: true,
        };

        // Add optional fields
        if (record.phone) clientData.phone = record.phone.trim();
        if (record.taxId) clientData.taxId = record.taxId.trim();
        if (record.website) clientData.website = record.website.trim();

        // Add address if any field is provided
        const address = {};
        if (record.addressStreet) address.street = record.addressStreet.trim();
        if (record.addressCity) address.city = record.addressCity.trim();
        if (record.addressState) address.state = record.addressState.trim();
        if (record.addressZipCode) address.zipCode = record.addressZipCode.trim();
        if (record.addressCountry) address.country = record.addressCountry.trim();

        if (Object.keys(address).length > 0) {
          clientData.address = address;
        }

        // Add contextual data
        clientData.contextualData = {
          companyName: clientData.companyName,
          taxId: clientData.taxId || null,
          website: clientData.website || null,
          notes: record.notes?.trim() || '',
          createdVia: 'bulk_import',
          importedBy: currentUser.id,
          importDate: new Date().toISOString(),
        };

        // Create user
        const userWithRole = currentUser;
        userWithRole.role = currentUser.get?.('role') || 'admin';

        const result = await this.userService.createUser(
          clientData,
          userWithRole
        );

        created.push({
          rowNumber: record.rowNumber,
          email: record.email,
          companyName: record.companyName,
          userId: result.user?.id,
        });

        logger.info('Client created via bulk import', {
          email: record.email,
          companyName: record.companyName,
          rowNumber: record.rowNumber,
        });
      } catch (error) {
        failed.push({
          rowNumber: record.rowNumber,
          email: record.email,
          companyName: record.companyName,
          error: error.message,
        });

        logger.error('Failed to create client in bulk import', {
          email: record.email,
          error: error.message,
          rowNumber: record.rowNumber,
        });
      }

      // Report progress
      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback({
          processed: i + 1,
          total,
          created: created.length,
          failed: failed.length,
          percentage: Math.round(((i + 1) / total) * 100),
        });
      }
    }

    logger.info('Bulk import completed', {
      total,
      created: created.length,
      failed: failed.length,
    });

    return {
      created,
      failed,
      summary: {
        total,
        successful: created.length,
        failed: failed.length,
        successRate: Math.round((created.length / total) * 100),
      },
    };
  }

  /**
   * Generate Excel error report with failed records.
   * @param {Array} failedRecords - Array of failed records.
   * @returns {Promise<Buffer>} - Excel file buffer.
   * @example
   */
  async generateErrorReport(failedRecords) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Errores de Importación');

      // Define columns
      worksheet.columns = [
        { header: 'Fila', key: 'rowNumber', width: 10 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Empresa', key: 'companyName', width: 30 },
        { header: 'Error', key: 'error', width: 50 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE74C3C' },
      };

      // Add data rows
      failedRecords.forEach((record) => {
        worksheet.addRow({
          rowNumber: record.rowNumber,
          email: record.email || '',
          companyName: record.companyName || '',
          error: Array.isArray(record.errors)
            ? record.errors.join('; ')
            : record.error || '',
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;
    } catch (error) {
      logger.error('Error generating error report', {
        error: error.message,
      });
      throw new Error('Error al generar reporte de errores');
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Normalize column name (lowercase, trim, remove spaces and special chars).
   * @param value
   * @example
   */
  normalizeColumnName(value) {
    if (!value) return '';
    return String(value)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '')
      .replace(/[*_-]/g, ''); // Remove asterisks, underscores, and dashes
  }

  /**
   * Map Excel column name to internal field name.
   * @param headerName
   * @example
   */
  mapColumnName(headerName) {
    const normalized = this.normalizeColumnName(headerName);

    for (const [internalName, aliases] of Object.entries(this.columnMappings)) {
      const normalizedAliases = aliases.map((alias) => this.normalizeColumnName(alias));
      if (normalizedAliases.includes(normalized)) {
        return internalName;
      }
    }

    return null;
  }

  /**
   * Check if column name matches expected name.
   * @param headerName
   * @param expectedName
   * @example
   */
  isColumnMatch(headerName, expectedName) {
    return this.mapColumnName(headerName) === expectedName;
  }

  /**
   * Check if row has any data.
   * @param row
   * @example
   */
  hasDataInRow(row) {
    let hasData = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== '') {
        hasData = true;
      }
    });
    return hasData;
  }

  /**
   * Get cell value, handling different cell types.
   * @param cell
   * @example
   */
  getCellValue(cell) {
    if (!cell || cell.value === null) return null;

    // Handle formula cells
    if (cell.type === ExcelJS.ValueType.Formula) {
      return cell.result !== null ? String(cell.result) : null;
    }

    // Handle rich text
    if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
      return cell.value.richText.map((rt) => rt.text).join('');
    }

    // Handle hyperlinks
    if (cell.value && typeof cell.value === 'object' && cell.value.text) {
      return cell.value.text;
    }

    // Handle date cells
    if (cell.type === ExcelJS.ValueType.Date) {
      return cell.value.toISOString();
    }

    // Return as string
    return String(cell.value).trim();
  }

  /**
   * Generate secure random password.
   * @example
   */
  generateSecurePassword() {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const specialChars = '!@#$%^&*';
    const allChars = lowercase + uppercase + numbers + specialChars;

    let password = '';
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += specialChars[Math.floor(Math.random() * specialChars.length)];

    for (let i = 0; i < 8; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}

module.exports = BulkImportService;
