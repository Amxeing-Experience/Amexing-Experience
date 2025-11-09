/**
 * Unit Tests for BulkImportService
 * Tests Excel parsing, validation, and bulk client creation
 *
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 2024-10-13
 */

const BulkImportService = require('../../../src/application/services/BulkImportService');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');

// Mock dependencies
jest.mock('../../../src/infrastructure/logger');
jest.mock('../../../src/application/services/UserManagementService');

describe('BulkImportService', () => {
  let service;
  let testFilePath;

  beforeEach(() => {
    service = new BulkImportService();
    jest.clearAllMocks();
    testFilePath = path.join(__dirname, '../../fixtures', 'test-clients.xlsx');
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  describe('normalizeColumnName', () => {
    it('should normalize column names correctly', () => {
      expect(service.normalizeColumnName('firstName*')).toBe('firstname');
      expect(service.normalizeColumnName('First Name')).toBe('firstname');
      expect(service.normalizeColumnName('first-name')).toBe('firstname');
      expect(service.normalizeColumnName('first_name')).toBe('firstname');
      expect(service.normalizeColumnName('FIRSTNAME')).toBe('firstname');
    });

    it('should handle empty values', () => {
      expect(service.normalizeColumnName('')).toBe('');
      expect(service.normalizeColumnName(null)).toBe('');
      expect(service.normalizeColumnName(undefined)).toBe('');
    });
  });

  describe('isColumnMatch', () => {
    it('should match column names correctly', () => {
      expect(service.isColumnMatch('firstName*', 'firstName')).toBe(true);
      expect(service.isColumnMatch('nombre', 'firstName')).toBe(true);
      expect(service.isColumnMatch('first_name', 'firstName')).toBe(true);
      expect(service.isColumnMatch('email*', 'email')).toBe(true);
      expect(service.isColumnMatch('correo', 'email')).toBe(true);
    });

    it('should not match unrelated columns', () => {
      expect(service.isColumnMatch('firstName', 'lastName')).toBe(false);
      expect(service.isColumnMatch('email', 'phone')).toBe(false);
    });
  });

  describe('validateExcelFile', () => {
    it('should reject non-existent files', async () => {
      const result = await service.validateExcelFile('/path/to/nonexistent.xlsx');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Archivo no encontrado');
    });

    it('should reject files larger than 10MB', async () => {
      const largeFilePath = path.join(__dirname, '../../fixtures', 'large-file.xlsx');

      // Mock fs.stat to return large size
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 11 * 1024 * 1024 });
      jest.spyOn(fs, 'access').mockResolvedValue();

      const result = await service.validateExcelFile(largeFilePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('excede el tamaño máximo');
    });
  });

  describe('generateErrorReport', () => {
    it('should generate Excel error report with correct structure', async () => {
      const failedRecords = [
        {
          rowNumber: 2,
          email: 'invalid@example.com',
          companyName: 'Empresa Test',
          error: 'Email ya existe',
        },
        {
          rowNumber: 3,
          email: 'test@example.com',
          companyName: 'Empresa 2',
          error: 'Datos inválidos',
        },
      ];

      const buffer = await service.generateErrorReport(failedRecords);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify it's a valid Excel file by parsing it
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      // The worksheet is named 'Errores de Importación'
      const worksheet = workbook.getWorksheet('Errores de Importación');
      expect(worksheet).toBeDefined();

      // Check headers
      const headerRow = worksheet.getRow(1);
      const headers = [];
      headerRow.eachCell((cell) => {
        headers.push(cell.value);
      });

      expect(headers).toContain('Fila');
      expect(headers).toContain('Email');
      expect(headers).toContain('Empresa');
      expect(headers).toContain('Error');

      // Check data rows
      expect(worksheet.rowCount).toBeGreaterThanOrEqual(3); // Header + 2 error rows
    });
  });

  describe('Configuration', () => {
    it('should have correct default configuration', () => {
      expect(service.maxRecords).toBe(1000);
      expect(service.clientRole).toBe('department_manager');
      expect(service.requiredColumns).toEqual(['firstName', 'lastName', 'email', 'companyName']);
      expect(service.optionalColumns).toContain('phone');
      expect(service.optionalColumns).toContain('taxId');
      expect(service.optionalColumns).toContain('website');
    });

    it('should have column mappings for localization', () => {
      expect(service.columnMappings.firstName).toContain('nombre');
      expect(service.columnMappings.email).toContain('correo');
      expect(service.columnMappings.companyName).toContain('empresa');
    });
  });
});
