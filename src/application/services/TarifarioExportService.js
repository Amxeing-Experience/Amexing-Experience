/**
 * TarifarioExportService - Export tarifario data to Excel or PDF.
 *
 * Generates professional exports of the pricing catalog (tarifario) with
 * support for selective section export and multiple formats.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

/* eslint-disable no-param-reassign, max-lines, max-lines-per-function */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Parse = require('parse/node');
const path = require('path');
const fs = require('fs');

const VALID_SECTIONS = ['vehiculos', 'traslados', 'a-disposicion', 'experiencias', 'tours'];

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5A6A85' } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  },
};

const CELL_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

const CURRENCY_FORMAT = '$#,##0.00';

/**
 * Applies header styling to the first row of a worksheet.
 * @param {object} sheet - ExcelJS worksheet.
 * @example
 * styleHeaderRow(worksheet);
 */
function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = HEADER_STYLE.font;
    cell.fill = HEADER_STYLE.fill;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });
}

/**
 * Applies border and optional currency format to data rows.
 * @param {object} row - ExcelJS row.
 * @param {number} currencyStartCol - Column number from which to apply currency format (0 to skip).
 * @example
 * styleDataRow(row, 4);
 */
function styleDataRow(row, currencyStartCol) {
  row.eachCell((cell, colNumber) => {
    cell.border = CELL_BORDER;
    if (currencyStartCol > 0 && colNumber >= currencyStartCol) {
      cell.numFmt = CURRENCY_FORMAT;
    }
  });
}

/**
 * Formats a number as MXN currency string.
 * @param {number} val - Numeric value.
 * @returns {string} Formatted currency string or '-'.
 * @example
 * formatCurrency(1500); // '$1,500.00'
 */
function formatCurrency(val) {
  if (!val) return '-';
  return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

// =====================
// DATA QUERY FUNCTIONS
// =====================

/**
 * Get vehicle types data for export.
 * @returns {Promise<Array>} Formatted vehicle data.
 * @example
 * const data = await getVehiculosData();
 */
async function getVehiculosData() {
  const query = new Parse.Query('VehicleType');
  query.equalTo('exists', true);
  query.ascending('name');
  query.limit(1000);
  const results = await query.find({ useMasterKey: true });

  return results.map((vt) => ({
    name: vt.get('name') || '',
    code: vt.get('code') || '',
    capacity: vt.get('defaultCapacity') || 0,
    luggage: vt.get('trunkCapacity') || 0,
    description: vt.get('description') || '',
    status: vt.get('active') ? 'Activo' : 'Inactivo',
  }));
}

/**
 * Get active rate names for column headers.
 * @returns {Promise<string[]>} Array of rate names.
 * @example
 * const names = await getActiveRateNames();
 */
async function getActiveRateNames() {
  const rateQuery = new Parse.Query('Rate');
  rateQuery.equalTo('exists', true);
  rateQuery.equalTo('active', true);
  rateQuery.ascending('name');
  rateQuery.limit(100);
  const rates = await rateQuery.find({ useMasterKey: true });
  return rates.map((r) => r.get('name'));
}

/**
 * Get traslados (transfer services) pricing data.
 * @returns {Promise<{rows: Array, rateNames: string[]}>} Formatted traslados data with rate names.
 * @example
 * const result = await getTrasladosData();
 */
async function getTrasladosData() {
  const rateNames = await getActiveRateNames();

  const query = new Parse.Query('RatePrices');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include('originPOI');
  query.include('destinationPOI');
  query.include('vehicleType');
  query.include('rate');
  query.limit(5000);
  const ratePrices = await query.find({ useMasterKey: true });

  const grouped = {};
  ratePrices.forEach((rp) => {
    const origin = rp.get('originPOI');
    const destination = rp.get('destinationPOI');
    const vehicleType = rp.get('vehicleType');
    const rate = rp.get('rate');

    if (!destination || !vehicleType || !rate) return;

    const originName = origin ? origin.get('name') : 'N/A';
    const destName = destination.get('name') || 'N/A';
    const vtName = vehicleType.get('name') || 'N/A';
    const key = `${originName}|${destName}|${vtName}`;

    if (!grouped[key]) {
      grouped[key] = { origin: originName, destination: destName, vehicleType: vtName };
    }

    const rateName = rate.get('name');
    grouped[key][`rate_${rateName}`] = rp.get('price') || 0;
  });

  const rows = Object.values(grouped);
  rows.sort((a, b) => {
    const cmp = a.origin.localeCompare(b.origin);
    if (cmp !== 0) return cmp;
    const cmp2 = a.destination.localeCompare(b.destination);
    if (cmp2 !== 0) return cmp2;
    return a.vehicleType.localeCompare(b.vehicleType);
  });

  return { rows, rateNames };
}

/**
 * Get A Disposicion (hourly rental) pricing data.
 * @returns {Promise<Array>} Formatted disposable pricing data.
 * @example
 * const data = await getADisposicionData();
 */
async function getADisposicionData() {
  const query = new Parse.Query('DisposablePrices');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.doesNotExist('endDate');
  query.include('vehicleType');
  query.include('rate');
  query.limit(1000);
  const results = await query.find({ useMasterKey: true });

  return results
    .map((dp) => {
      const vehicleType = dp.get('vehicleType');
      const rate = dp.get('rate');
      return {
        vehicleType: vehicleType ? vehicleType.get('name') : 'N/A',
        rate: rate ? rate.get('name') : 'N/A',
        hourlyPrice: dp.get('hourlyPrice') || 0,
        currency: dp.get('currency') || 'MXN',
      };
    })
    .sort((a, b) => a.vehicleType.localeCompare(b.vehicleType) || a.rate.localeCompare(b.rate));
}

/**
 * Get experiences data for export.
 * @returns {Promise<Array>} Formatted experience data.
 * @example
 * const data = await getExperienciasData();
 */
async function getExperienciasData() {
  const query = new Parse.Query('Experience');
  query.equalTo('exists', true);
  query.equalTo('type', 'Experience');
  query.ascending('name');
  query.limit(1000);
  const results = await query.find({ useMasterKey: true });

  return results.map((exp) => ({
    name: exp.get('name') || '',
    description: exp.get('description') || '',
    cost: exp.get('cost') || 0,
    status: exp.get('active') ? 'Activo' : 'Inactivo',
  }));
}

/**
 * Get tours data with pricing matrix.
 * @returns {Promise<{rows: Array, rateNames: string[]}>} Formatted tours data with rate names.
 * @example
 * const result = await getToursData();
 */
async function getToursData() {
  const rateNames = await getActiveRateNames();

  const tourQuery = new Parse.Query('Tour');
  tourQuery.equalTo('exists', true);
  tourQuery.include('destinationPOI');
  tourQuery.ascending('destinationPOI.name');
  tourQuery.limit(1000);
  const tours = await tourQuery.find({ useMasterKey: true });

  const priceQuery = new Parse.Query('TourPrices');
  priceQuery.equalTo('exists', true);
  priceQuery.equalTo('active', true);
  priceQuery.include('ratePtr');
  priceQuery.include('tourPtr');
  priceQuery.include('vehicleType');
  priceQuery.limit(5000);
  const tourPrices = await priceQuery.find({ useMasterKey: true });

  // Build price lookup: tourId|vehicleTypeId -> { rateName: price }
  const priceLookup = {};
  const vtNames = {};
  tourPrices.forEach((tp) => {
    const tour = tp.get('tourPtr');
    const vehicleType = tp.get('vehicleType');
    const rate = tp.get('ratePtr');
    if (!tour || !rate) return;

    const vtId = vehicleType ? vehicleType.id : 'none';
    const key = `${tour.id}|${vtId}`;
    if (!priceLookup[key]) priceLookup[key] = {};
    priceLookup[key][rate.get('name')] = tp.get('price') || 0;

    if (vehicleType) {
      vtNames[vehicleType.id] = vehicleType.get('name') || 'N/A';
    }
  });

  const rows = [];
  tours.forEach((tour) => {
    const dest = tour.get('destinationPOI');
    const destName = dest ? dest.get('name') : 'N/A';
    const duration = tour.get('time') || 0;
    const isWalking = tour.get('isWalkingTour');

    if (isWalking) {
      const priceMap = priceLookup[`${tour.id}|none`] || {};
      const row = {
        destination: destName, duration, isWalkingTour: 'Si', vehicleType: 'A Pie',
      };
      rateNames.forEach((name) => { row[`rate_${name}`] = priceMap[name] || 0; });
      rows.push(row);
      return;
    }

    // Vehicle tour: collect all vehicle types with prices
    const tourKeys = Object.keys(priceLookup).filter((k) => k.startsWith(`${tour.id}|`));
    const vehicleTypeIds = tourKeys.map((k) => k.split('|')[1]).filter((v) => v !== 'none');

    if (vehicleTypeIds.length === 0) {
      const row = {
        destination: destName, duration, isWalkingTour: 'No', vehicleType: 'N/A',
      };
      rateNames.forEach((name) => { row[`rate_${name}`] = 0; });
      rows.push(row);
      return;
    }

    vehicleTypeIds.forEach((vtId) => {
      const priceMap = priceLookup[`${tour.id}|${vtId}`] || {};
      const row = {
        destination: destName,
        duration,
        isWalkingTour: 'No',
        vehicleType: vtNames[vtId] || 'N/A',
      };
      rateNames.forEach((name) => { row[`rate_${name}`] = priceMap[name] || 0; });
      rows.push(row);
    });
  });

  return { rows, rateNames };
}

// =====================
// PDF TABLE HELPERS
// =====================

/**
 * Draws a PDF header with Amexing branding.
 * @param {object} doc - PDFKit document.
 * @example
 * drawPDFHeader(doc);
 */
function drawPDFHeader(doc) {
  const logoPath = path.join(__dirname, '../../presentation/views/public/images/amexing-logo.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 20, { width: 120 });
  }

  doc.fontSize(18).fillColor('#5A6A85').text('AMEXING EXPERIENCE', 200, 30, { align: 'center' });
  doc.fontSize(12).fillColor('#64748B').text('Tarifario', 200, 55, { align: 'center' });
  const date = new Date().toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.fontSize(9).text(`Generado: ${date}`, 200, 72, { align: 'center' });

  doc.moveTo(50, 90).lineTo(doc.page.width - 50, 90).strokeColor('#E2E8F0').stroke();
  doc.y = 100;
}

/**
 * Draws a table in the PDF document.
 * @param {object} options - Table drawing options.
 * @param {object} options.doc - PDFKit document.
 * @param {string} options.title - Section title.
 * @param {string[]} options.headers - Column headers.
 * @param {Array<string[]>} options.rows - Row data.
 * @param {number[]} options.colWidths - Column widths.
 * @example
 * drawPDFTable({ doc, title: 'Vehiculos', headers, rows, colWidths });
 */
function drawPDFTable(options) {
  const {
    doc, title, headers, rows, colWidths,
  } = options;
  const startX = 50;
  const pageWidth = doc.page.width - 100;
  const rowHeight = 20;

  doc.fontSize(14).fillColor('#1E293B').text(title, startX, doc.y + 10);
  doc.y += 10;

  const widths = colWidths && colWidths.length > 0
    ? colWidths
    : headers.map(() => pageWidth / headers.length);

  let y = doc.y; // eslint-disable-line prefer-destructuring

  // Header row
  doc.rect(startX, y, pageWidth, rowHeight).fill('#5A6A85');
  let x = startX;
  headers.forEach((header, i) => {
    doc.fontSize(8).fillColor('#FFFFFF').text(header, x + 4, y + 5, { width: widths[i] - 8, align: 'center' });
    x += widths[i];
  });
  y += rowHeight;

  // Data rows
  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      drawPDFHeader(doc);
      y = doc.y; // eslint-disable-line prefer-destructuring

      doc.rect(startX, y, pageWidth, rowHeight).fill('#5A6A85');
      x = startX;
      headers.forEach((header, i) => {
        doc.fontSize(8).fillColor('#FFFFFF').text(header, x + 4, y + 5, { width: widths[i] - 8, align: 'center' });
        x += widths[i];
      });
      y += rowHeight;
    }

    const bgColor = rowIndex % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
    doc.rect(startX, y, pageWidth, rowHeight).fill(bgColor);

    x = startX;
    row.forEach((cellVal, i) => {
      doc.fontSize(8).fillColor('#334155').text(String(cellVal || ''), x + 4, y + 5, { width: widths[i] - 8, align: 'left' });
      x += widths[i];
    });
    y += rowHeight;
  });

  doc.y = y + 10;
}

// =====================
// EXCEL SHEET BUILDERS
// =====================

/**
 * Adds Vehiculos sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 * await addVehiculosSheet(workbook);
 */
async function addVehiculosSheet(workbook) {
  const data = await getVehiculosData();
  const sheet = workbook.addWorksheet('Vehiculos', { properties: { tabColor: { argb: 'FF5D87FF' } } });

  sheet.columns = [
    { header: 'Tipo de Vehiculo', key: 'name', width: 25 },
    { header: 'Codigo', key: 'code', width: 15 },
    { header: 'Capacidad Pasajeros', key: 'capacity', width: 22 },
    { header: 'Capacidad Equipaje', key: 'luggage', width: 22 },
    { header: 'Descripcion', key: 'description', width: 40 },
    { header: 'Estado', key: 'status', width: 12 },
  ];

  styleHeaderRow(sheet);
  data.forEach((item) => { styleDataRow(sheet.addRow(item), 0); });
}

/**
 * Adds Traslados sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 * await addTrasladosSheet(workbook);
 */
async function addTrasladosSheet(workbook) {
  const { rows, rateNames } = await getTrasladosData();
  const sheet = workbook.addWorksheet('Traslados', { properties: { tabColor: { argb: 'FF059669' } } });

  const columns = [
    { header: 'Origen', key: 'origin', width: 25 },
    { header: 'Destino', key: 'destination', width: 25 },
    { header: 'Tipo Vehiculo', key: 'vehicleType', width: 18 },
  ];
  rateNames.forEach((rateName) => {
    columns.push({ header: rateName, key: `rate_${rateName}`, width: 18 });
  });

  sheet.columns = columns;
  styleHeaderRow(sheet);
  rows.forEach((item) => { styleDataRow(sheet.addRow(item), 4); });
}

/**
 * Adds A Disposicion sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 * await addADisposicionSheet(workbook);
 */
async function addADisposicionSheet(workbook) {
  const data = await getADisposicionData();
  const sheet = workbook.addWorksheet('A Disposicion', { properties: { tabColor: { argb: 'FFF59E0B' } } });

  sheet.columns = [
    { header: 'Tipo de Vehiculo', key: 'vehicleType', width: 25 },
    { header: 'Tarifa', key: 'rate', width: 20 },
    { header: 'Precio por Hora', key: 'hourlyPrice', width: 18 },
    { header: 'Moneda', key: 'currency', width: 10 },
  ];

  styleHeaderRow(sheet);
  data.forEach((item) => { styleDataRow(sheet.addRow(item), 3); });
}

/**
 * Adds Experiencias sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 * await addExperienciasSheet(workbook);
 */
async function addExperienciasSheet(workbook) {
  const data = await getExperienciasData();
  const sheet = workbook.addWorksheet('Experiencias', { properties: { tabColor: { argb: 'FFEC4899' } } });

  sheet.columns = [
    { header: 'Nombre', key: 'name', width: 30 },
    { header: 'Descripcion', key: 'description', width: 45 },
    { header: 'Costo', key: 'cost', width: 15 },
    { header: 'Estado', key: 'status', width: 12 },
  ];

  styleHeaderRow(sheet);
  data.forEach((item) => { styleDataRow(sheet.addRow(item), 3); });
}

/**
 * Adds Tours sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 * await addToursSheet(workbook);
 */
async function addToursSheet(workbook) {
  const { rows, rateNames } = await getToursData();
  const sheet = workbook.addWorksheet('Tours', { properties: { tabColor: { argb: 'FF8B5CF6' } } });

  const columns = [
    { header: 'Destino', key: 'destination', width: 25 },
    { header: 'Duracion (min)', key: 'duration', width: 16 },
    { header: 'Walking Tour', key: 'isWalkingTour', width: 14 },
    { header: 'Tipo Vehiculo', key: 'vehicleType', width: 18 },
  ];
  rateNames.forEach((rateName) => {
    columns.push({ header: rateName, key: `rate_${rateName}`, width: 18 });
  });

  sheet.columns = columns;
  styleHeaderRow(sheet);
  rows.forEach((item) => { styleDataRow(sheet.addRow(item), 5); });
}

// =====================
// SECTION DISPATCH MAP
// =====================

const EXCEL_BUILDERS = {
  vehiculos: addVehiculosSheet,
  traslados: addTrasladosSheet,
  'a-disposicion': addADisposicionSheet,
  experiencias: addExperienciasSheet,
  tours: addToursSheet,
};

/**
 * Builds PDF content for a given section.
 * @param {object} doc - PDFKit document.
 * @param {string} section - Section name.
 * @returns {Promise<void>} Resolves when section is drawn.
 * @example
 * await buildPDFSection(doc, 'vehiculos');
 */
async function buildPDFSection(doc, section) {
  switch (section) {
    case 'vehiculos': {
      const data = await getVehiculosData();
      const tableRows = data.map((d) => [d.name, d.code, d.capacity, d.luggage, d.description, d.status]);
      drawPDFTable({
        doc, title: 'Vehiculos', headers: ['Tipo de Vehiculo', 'Codigo', 'Cap. Pasajeros', 'Cap. Equipaje', 'Descripcion', 'Estado'], rows: tableRows, colWidths: [130, 80, 90, 90, 240, 70],
      });
      break;
    }
    case 'traslados': {
      const { rows, rateNames } = await getTrasladosData();
      const hdrs = ['Origen', 'Destino', 'Tipo Vehiculo', ...rateNames];
      const fixedW = 400;
      const remainW = doc.page.width - 100 - fixedW;
      const rateW = rateNames.length > 0 ? remainW / rateNames.length : 80;
      const tableRows = rows.map((r) => {
        const base = [r.origin, r.destination, r.vehicleType];
        rateNames.forEach((name) => { base.push(formatCurrency(r[`rate_${name}`])); });
        return base;
      });
      drawPDFTable({
        doc, title: 'Traslados', headers: hdrs, rows: tableRows, colWidths: [150, 150, 100, ...rateNames.map(() => rateW)],
      });
      break;
    }
    case 'a-disposicion': {
      const data = await getADisposicionData();
      const tableRows = data.map((d) => [d.vehicleType, d.rate, formatCurrency(d.hourlyPrice), d.currency]);
      drawPDFTable({
        doc, title: 'A Disposicion', headers: ['Tipo de Vehiculo', 'Tarifa', 'Precio por Hora', 'Moneda'], rows: tableRows, colWidths: [200, 180, 150, 80],
      });
      break;
    }
    case 'experiencias': {
      const data = await getExperienciasData();
      const tableRows = data.map((d) => [d.name, d.description, formatCurrency(d.cost), d.status]);
      drawPDFTable({
        doc, title: 'Experiencias', headers: ['Nombre', 'Descripcion', 'Costo', 'Estado'], rows: tableRows, colWidths: [200, 300, 100, 80],
      });
      break;
    }
    case 'tours': {
      const { rows, rateNames } = await getToursData();
      const hdrs = ['Destino', 'Duracion', 'Walking', 'Vehiculo', ...rateNames];
      const fixedW = 360;
      const remainW = doc.page.width - 100 - fixedW;
      const rateW = rateNames.length > 0 ? remainW / rateNames.length : 80;
      const tableRows = rows.map((r) => {
        const base = [r.destination, r.duration, r.isWalkingTour, r.vehicleType];
        rateNames.forEach((name) => { base.push(formatCurrency(r[`rate_${name}`])); });
        return base;
      });
      drawPDFTable({
        doc, title: 'Tours', headers: hdrs, rows: tableRows, colWidths: [130, 70, 60, 100, ...rateNames.map(() => rateW)],
      });
      break;
    }
    default:
      break;
  }
}

// =====================
// SERVICE CLASS
// =====================

class TarifarioExportService {
  /**
   * Export selected sections in the specified format.
   * @param {string[]} sections - Array of section names to export.
   * @param {string} format - Export format: 'excel' or 'pdf'.
   * @returns {Promise<{buffer: Buffer, contentType: string, filename: string}>} Export result.
   * @example
   * const result = await service.exportSections(['vehiculos', 'traslados'], 'excel');
   */
  async exportSections(sections, format = 'excel') {
    const validSections = sections.filter((s) => VALID_SECTIONS.includes(s));
    if (validSections.length === 0) {
      throw new Error('No valid sections specified');
    }

    const date = new Date().toISOString().split('T')[0];

    if (format === 'pdf') {
      const buffer = await TarifarioExportService.buildPDF(validSections);
      return {
        buffer,
        contentType: 'application/pdf',
        filename: `tarifario-amexing-${date}.pdf`,
      };
    }

    const workbook = await TarifarioExportService.buildExcelWorkbook(validSections);
    const excelBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(excelBuffer),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `tarifario-amexing-${date}.xlsx`,
    };
  }

  /**
   * Get list of valid section identifiers.
   * @returns {string[]} Valid section names.
   * @example
   * const sections = TarifarioExportService.getValidSections();
   */
  static getValidSections() {
    return [...VALID_SECTIONS];
  }

  /**
   * Build an Excel workbook with selected sections as sheets.
   * @param {string[]} sections - Sections to include.
   * @returns {Promise<object>} Populated ExcelJS workbook.
   * @example
   * const wb = await TarifarioExportService.buildExcelWorkbook(['vehiculos']);
   */
  static async buildExcelWorkbook(sections) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Amexing Experience';
    workbook.created = new Date();

    const buildPromises = sections
      .filter((s) => EXCEL_BUILDERS[s])
      .map((s) => EXCEL_BUILDERS[s](workbook));

    await Promise.all(buildPromises);
    return workbook;
  }

  /**
   * Build a PDF document with selected sections.
   * @param {string[]} sections - Sections to include.
   * @returns {Promise<Buffer>} PDF buffer.
   * @example
   * const buffer = await TarifarioExportService.buildPDF(['vehiculos', 'tours']);
   */
  static async buildPDF(sections) {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: {
        top: 40,
        bottom: 40,
        left: 50,
        right: 50,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    drawPDFHeader(doc);

    for (let i = 0; i < sections.length; i += 1) {
      if (i > 0) {
        doc.addPage();
        drawPDFHeader(doc);
      }
      // Sequential PDF rendering required
      // eslint-disable-next-line no-await-in-loop
      await buildPDFSection(doc, sections[i]);
    }

    // Footer on last page
    const footerY = doc.page.height - 40;
    doc.fontSize(8).fillColor('#94A3B8')
      .text('Amexing Experience - Tarifario Confidencial', 50, footerY, {
        align: 'center',
        width: doc.page.width - 100,
      });

    doc.end();

    return new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }
}

module.exports = TarifarioExportService;
