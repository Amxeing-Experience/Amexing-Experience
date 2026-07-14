/**
 * TarifarioExportService - Export tarifario data to Excel or PDF.
 *
 * Generates professional exports of the pricing catalog (tarifario) with
 * support for selective section export and multiple formats.
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 */

/* eslint-disable no-param-reassign, max-lines, max-lines-per-function */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Parse = require('parse/node');
const path = require('path');
const fs = require('fs');

const pricingHelper = require('../utils/pricingHelper');

const VALID_SECTIONS = ['vehiculos', 'traslados', 'a-disposicion', 'experiencias', 'tours'];

// Color palette matching reference design
const LIGHT_GREEN = 'FFA9D18E';
const DARK_GREEN = 'FF385723';
const DARK_GRAY = 'FF605E5E';

const HEADER_STYLE = {
  font: {
    bold: true, color: { argb: 'FF000000' }, size: 12, name: 'Avenir',
  },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_GREEN } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  },
};

const CELL_BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

const BANNER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_GRAY } };
const BANNER_FONT_WHITE = {
  bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Avenir',
};
const BANNER_FONT_INFO = {
  size: 12, color: { argb: 'FFFFFFFF' }, name: 'Avenir',
};
const SECTION_TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK_GREEN } };
const SECTION_TITLE_FONT = {
  bold: true, size: 14, color: { argb: 'FFFFFFFF' }, name: 'Avenir',
};

const CURRENCY_FORMAT = '$#,##0.00';
const BANNER_ROWS = 7;
const LOGO_AVIF = path.join(__dirname, '../../../public/img/amexing_logo_horizontal.avif');
const LOGO_PNG = path.join(__dirname, '../../../public/img/amexing_logo_horizontal.png');

/**
 * Ensures a PNG version of the horizontal logo exists by converting from AVIF if needed.
 * @returns {Promise<string|null>} Path to PNG logo, or null if unavailable.
 * @example
 */
async function ensureLogoPNG() {
  if (fs.existsSync(LOGO_PNG)) return LOGO_PNG;
  if (!fs.existsSync(LOGO_AVIF)) return null;
  const sharp = require('sharp');
  await sharp(LOGO_AVIF).png().toFile(LOGO_PNG);
  return LOGO_PNG;
}

/**
 * Adds company header banner to a worksheet (rows 1-7).
 * @param {object} sheet - ExcelJS worksheet.
 * @param {object} workbook - ExcelJS workbook (for image insertion).
 * @param {number} colCount - Number of columns in the sheet.
 * @param priceOptions
 * @returns {Promise<number>} The row number where data should start (after banner + section title).
 * @example
 */
async function addCompanyHeader(sheet, workbook, colCount, priceOptions) {
  const lastCol = Math.max(colCount, 6);
  const infoCol = Math.max(Math.floor(lastCol * 0.7), 4);

  // Fill banner rows with dark gray
  for (let r = 1; r <= BANNER_ROWS; r += 1) {
    const row = sheet.getRow(r);
    row.height = r === 1 ? 30 : 18;
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.fill = BANNER_FILL;
      cell.border = {};
    }
  }

  // Add medium border around the banner
  for (let r = 1; r <= BANNER_ROWS; r += 1) {
    sheet.getCell(r, 1).border = { left: { style: 'medium' } };
    sheet.getCell(r, lastCol).border = { right: { style: 'medium' } };
  }
  for (let c = 1; c <= lastCol; c += 1) {
    const topCell = sheet.getCell(1, c);
    topCell.border = { ...topCell.border, top: { style: 'medium' } };
  }

  // Company name - row 2
  sheet.getRow(2).height = 30;
  sheet.mergeCells(2, infoCol, 2, lastCol);
  const titleCell = sheet.getCell(2, infoCol);
  titleCell.value = 'AMEXING EXPERIENCE';
  titleCell.font = BANNER_FONT_WHITE;
  titleCell.fill = BANNER_FILL;
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };

  // Company info rows
  const infoLines = [
    'Vicente Suarez 5, Independencia',
    'San Miguel de Allende, GTO 37732',
    'info@amexingexperience.com',
    '+52 (415) 167 39 90',
  ];
  infoLines.forEach((text, i) => {
    const rowNum = 3 + i;
    sheet.mergeCells(rowNum, infoCol, rowNum, lastCol);
    const cell = sheet.getCell(rowNum, infoCol);
    cell.value = text;
    cell.font = BANNER_FONT_INFO;
    cell.fill = BANNER_FILL;
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
  });

  // Insert logo (convert AVIF to PNG if needed)
  const logoPath = await ensureLogoPNG();
  if (logoPath) {
    const imageId = workbook.addImage({
      filename: logoPath,
      extension: 'png',
    });
    sheet.addImage(imageId, {
      tl: { col: 0.5, row: 0.5 },
      br: { col: 3, row: BANNER_ROWS - 0.5 },
    });
  }

  // Show selected Pago and Moneda in last banner row
  if (priceOptions) {
    const pagoLabel = (priceOptions.paymentType || 'efectivo').charAt(0).toUpperCase()
      + (priceOptions.paymentType || 'efectivo').slice(1);
    const monedaLabel = priceOptions.currency || 'MXN';
    const infoText = `Pago: ${pagoLabel}  |  Moneda: ${monedaLabel}`;
    sheet.mergeCells(BANNER_ROWS, 1, BANNER_ROWS, Math.min(3, lastCol));
    const infoCell = sheet.getCell(BANNER_ROWS, 1);
    infoCell.value = infoText;
    infoCell.font = BANNER_FONT_INFO;
    infoCell.fill = BANNER_FILL;
    infoCell.alignment = { horizontal: 'left', vertical: 'middle' };
  }

  return BANNER_ROWS + 1; // data starts after banner
}

/**
 * Adds a section title row with dark green background.
 * @param {object} sheet - ExcelJS worksheet.
 * @param {number} rowNum - Row number for the title.
 * @param {string} title - Section title text.
 * @param {number} colCount - Number of columns to merge across.
 * @example
 */
function addSectionTitleRow(sheet, rowNum, title, colCount) {
  const row = sheet.getRow(rowNum);
  row.height = 28;
  sheet.mergeCells(rowNum, 1, rowNum, colCount);
  const cell = sheet.getCell(rowNum, 1);
  cell.value = title;
  cell.font = SECTION_TITLE_FONT;
  cell.fill = SECTION_TITLE_FILL;
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = {
    left: { style: 'medium' },
    right: { style: 'medium' },
    bottom: { style: 'medium' },
  };
}

/**
 * Applies header styling to a specific row of a worksheet.
 * @param {object} sheet - ExcelJS worksheet.
 * @param {number} rowNum - Row number to style (default 1).
 * @example
 */
function styleHeaderRow(sheet, rowNum) {
  const headerRow = sheet.getRow(rowNum || 1);
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
 */
function styleDataRow(row, currencyStartCol) {
  row.eachCell((cell, colNumber) => {
    cell.border = CELL_BORDER;
    cell.font = { size: 12, name: 'Avenir' };
    if (currencyStartCol > 0 && colNumber >= currencyStartCol) {
      cell.numFmt = CURRENCY_FORMAT;
    }
  });
}

/**
 * Formats a number as MXN currency string.
 * @param {number} val - Numeric value.
 * @param currency
 * @returns {string} Formatted currency string or '-'.
 * @example
 */
function formatCurrency(val, currency) {
  if (!val) return '-';
  if (currency === 'USD') {
    return `$${Math.round(Number(val)).toLocaleString('en-US')} USD`;
  }
  return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

/**
 * Applies payment type surcharge and currency conversion to a price.
 * @param {number} price - Base price.
 * @param {object} priceOptions - Price adjustment options.
 * @returns {number} Adjusted price.
 * @example
 */
function applyPriceAdjustments(price, priceOptions) {
  if (!priceOptions || !price) return price;
  let adjusted = price;
  if (priceOptions.paymentType === 'transferencia' && priceOptions.transferRate) {
    adjusted *= (1 + priceOptions.transferRate / 100);
  } else if (priceOptions.paymentType === 'tarjeta' && priceOptions.agencyRate) {
    adjusted *= (1 + priceOptions.agencyRate / 100);
  }
  if (priceOptions.currency === 'USD' && priceOptions.exchangeRate) {
    adjusted /= priceOptions.exchangeRate;
    adjusted = pricingHelper.applyUSDRoundingRules(adjusted);
  }
  return Math.round(adjusted * 100) / 100;
}

/**
 * Merges vertically repeated cells in specified columns to avoid redundant data.
 * @param {object} sheet - ExcelJS worksheet.
 * @param {number} dataStartRow - First data row number.
 * @param {...number} colNumbers - Column numbers (1-based) to merge.
 * @example
 */
function mergeRepeatedCells(sheet, dataStartRow, ...colNumbers) {
  const totalRows = sheet.rowCount;
  if (totalRows <= dataStartRow) return;

  colNumbers.forEach((col) => {
    let rangeStart = dataStartRow;

    for (let row = dataStartRow + 1; row <= totalRows + 1; row += 1) {
      const changed = row > totalRows || String(sheet.getCell(row, col).value)
        !== String(sheet.getCell(rangeStart, col).value);

      if (changed) {
        if (row - 1 > rangeStart) {
          sheet.mergeCells(rangeStart, col, row - 1, col);
          const merged = sheet.getCell(rangeStart, col);
          merged.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        }
        rangeStart = row;
      }
    }
  });
}

// =====================
// DATA QUERY FUNCTIONS
// =====================

/**
 * Get vehicle types data for export.
 * @returns {Promise<Array>} Formatted vehicle data.
 * @example
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
  }));
}

/**
 * Get active rate names for column headers.
 * @returns {Promise<string[]>} Array of rate names.
 * @example
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
 * @param clientId
 * @param priceOptions
 * @returns {Promise<{rows: Array, rateNames: string[]}>} Formatted traslados data with rate names.
 * @example
 */
async function getTrasladosData(clientId, priceOptions) {
  const rateNames = await getActiveRateNames();

  const queries = [];

  const query = new Parse.Query('RatePrices');
  query.equalTo('exists', true);
  query.equalTo('active', true);
  query.include('originPOI');
  query.include('originPOI.serviceType');
  query.include('destinationPOI');
  query.include('destinationPOI.serviceType');
  query.include('vehicleType');
  query.include('rate');
  query.include('service');
  query.limit(5000);
  queries.push(query.find({ useMasterKey: true }));

  // Load client-specific prices if clientId provided
  if (clientId) {
    const cpQuery = new Parse.Query('ClientPrices');
    cpQuery.equalTo('clientPtr', Parse.Object.extend('AmexingUser').createWithoutData(clientId));
    cpQuery.equalTo('itemType', 'SERVICES');
    cpQuery.equalTo('exists', true);
    cpQuery.doesNotExist('valid_until');
    cpQuery.limit(50000);
    queries.push(cpQuery.find({ useMasterKey: true }));
  }

  const [ratePrices, clientPrices] = await Promise.all(queries);

  // Build client price lookup: itemId-rateId-vehicleId -> precio
  const clientPriceMap = {};
  if (clientPrices) {
    clientPrices.forEach((cp) => {
      const ratePtr = cp.get('ratePtr');
      const vehiclePtr = cp.get('vehiclePtr');
      const cpKey = `${cp.get('itemId')}-${ratePtr ? ratePtr.id : ''}-${vehiclePtr ? vehiclePtr.id : ''}`;
      clientPriceMap[cpKey] = cp.get('precio');
    });
  }

  const grouped = {};
  ratePrices.forEach((rp) => {
    const origin = rp.get('originPOI');
    const destination = rp.get('destinationPOI');
    const vehicleType = rp.get('vehicleType');
    const rate = rp.get('rate');
    const service = rp.get('service');

    if (!destination || !vehicleType || !rate) return;

    // Skip if the service is not active or doesn't exist
    if (!service || service.get('active') !== true || service.get('exists') !== true) return;

    const originName = origin ? origin.get('name') : 'N/A';
    const destName = destination.get('name') || 'N/A';
    const vtName = vehicleType.get('name') || 'N/A';
    const originST = origin && origin.get('serviceType') ? origin.get('serviceType').get('name') : null;
    const destST = destination.get('serviceType') ? destination.get('serviceType').get('name') : null;
    let serviceTypeName = 'Local';
    if (originST === 'Aeropuerto' || destST === 'Aeropuerto') serviceTypeName = 'Aeropuerto';
    else if (originST === 'Punto a Punto' || destST === 'Punto a Punto'
      || originST === 'Tours' || destST === 'Tours') serviceTypeName = 'Punto a Punto';
    else if (originST === 'Local' || destST === 'Local') serviceTypeName = 'Local';
    const key = `${originName}|${destName}|${vtName}`;

    if (!grouped[key]) {
      grouped[key] = {
        serviceType: serviceTypeName, origin: originName, destination: destName, vehicleType: vtName,
      };
    }

    const rateName = rate.get('name');
    let price = rp.get('price') || 0;

    // Override with client price if available
    if (clientId && service) {
      const cpKey = `${service.id}-${rate.id}-${vehicleType.id}`;
      if (clientPriceMap[cpKey] !== undefined) {
        price = clientPriceMap[cpKey];
      }
    }

    grouped[key][`rate_${rateName}`] = applyPriceAdjustments(price, priceOptions);
  });

  const rows = Object.values(grouped);
  rows.sort((a, b) => {
    const cmp0 = a.serviceType.localeCompare(b.serviceType);
    if (cmp0 !== 0) return cmp0;
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
 * @param priceOptions
 * @returns {Promise<Array>} Formatted disposable pricing data.
 * @example
 */
async function getADisposicionData(priceOptions) {
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
        hourlyPrice: applyPriceAdjustments(dp.get('hourlyPrice') || 0, priceOptions),
        currency: dp.get('currency') || 'MXN',
      };
    })
    .sort((a, b) => a.vehicleType.localeCompare(b.vehicleType) || a.rate.localeCompare(b.rate));
}

// =====================
// FORMATTING HELPERS
// =====================

/**
 *
 * @param availability
 * @param availableDays
 * @example
 */
function formatAvailabilityDays(availability, availableDays) {
  const dayNames = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
  if (availability && Array.isArray(availability) && availability.length > 0) {
    const days = availability
      .filter((s) => (typeof s === 'object' && typeof s.day === 'number')
               && ((s.startTime && s.endTime) || (s.times && Array.isArray(s.times) && s.times.length > 0)))
      .map((s) => dayNames[s.day] || '')
      .filter(Boolean);
    return days.length >= 7 ? 'Todos los dias' : days.join(', ');
  }
  if (availableDays && Array.isArray(availableDays) && availableDays.length > 0) {
    if (typeof availableDays[0] === 'string') {
      return availableDays.length >= 7 ? 'Todos los dias' : availableDays.map((d) => d.substring(0, 2)).join(', ');
    }
  }
  return 'Todos los dias';
}

/**
 *
 * @param availability
 * @example
 */
function formatAvailabilityTimes(availability) {
  if (!availability || !Array.isArray(availability) || availability.length === 0) return '-';
  const dayNames = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
  const times = availability
    .filter((s) => (s.startTime && s.endTime) || (s.times && Array.isArray(s.times) && s.times.length > 0))
    .map((s) => {
      const dayName = dayNames[s.day] || '';

      // Multi-slot format: {day, times: [{start, end}, ...]}
      if (s.times && Array.isArray(s.times) && s.times.length > 0) {
        const timeSlots = s.times
          .filter((slot) => slot.start && slot.end)
          .map((slot) => `${slot.start}-${slot.end}`)
          .join(', ');
        return timeSlots ? `${dayName}: ${timeSlots}` : null;
      }

      // Simple format: {day, startTime, endTime}
      if (s.startTime && s.endTime) {
        return `${dayName}: ${s.startTime}-${s.endTime}`;
      }

      return null;
    })
    .filter(Boolean);
  return times.length > 0 ? times.join(', ') : '-';
}

/**
 *
 * @param minutes
 * @example
 */
function formatAdvanceBooking(minutes) {
  if (!minutes || minutes <= 0) return '-';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    return days === 1 ? '1 dia' : `${days} dias`;
  }
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}min`;
  if (hrs > 0) return hrs === 1 ? '1 hora' : `${hrs} hrs`;
  return `${mins} min`;
}

/**
 *
 * @param minutes
 * @example
 */
function formatDurationMinutes(minutes) {
  if (!minutes || minutes <= 0) return '-';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}min`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}min`;
}

/**
 * Get experiences data for export.
 * @param priceOptions
 * @returns {Promise<Array>} Formatted experience data.
 * @example
 */
async function getExperienciasData(priceOptions) {
  const [experiences, providerExperiencias] = await Promise.all([
    (async () => {
      const query = new Parse.Query('Experience');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.equalTo('type', 'Experience');
      query.ascending('name');
      query.limit(1000);
      return query.find({ useMasterKey: true });
    })(),
    (async () => {
      const query = new Parse.Query('ProviderExperiencia');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.include('provider');
      query.ascending('name');
      query.limit(1000);
      return query.find({ useMasterKey: true });
    })(),
  ]);

  const rows = [];

  experiences.forEach((exp) => {
    const avail = exp.get('availability') || [];
    const availDays = exp.get('availableDays') || [];
    const incl = exp.get('includes') || [];
    const notIncl = exp.get('notincludes') || [];
    const langs = exp.get('languages') || [];
    rows.push({
      name: exp.get('name') || '',
      description: exp.get('description') || '',
      adulto: applyPriceAdjustments(exp.get('cost') || 0, priceOptions),
      nino: applyPriceAdjustments(exp.get('price_child') || 0, priceOptions),
      sinAlcohol: applyPriceAdjustments(exp.get('price_no_alcohol') || 0, priceOptions),
      tipo: 'Experiencia',
      provider: '-',
      duration: formatDurationMinutes(exp.get('duration') || 0),
      diasSugeridos: formatAvailabilityDays(avail, availDays),
      horarios: formatAvailabilityTimes(avail),
      anticipacion: formatAdvanceBooking(exp.get('advance_booking_time') || 0),
      incluye: Array.isArray(incl) ? incl.join(', ') : (incl || ''),
      noIncluye: Array.isArray(notIncl) ? notIncl.join(', ') : (notIncl || ''),
      idiomas: Array.isArray(langs) ? langs.join(', ') : (langs || ''),
    });
  });

  providerExperiencias.forEach((pe) => {
    const prov = pe.get('provider');

    // Skip if the provider is not active or doesn't exist
    if (!prov || prov.get('active') !== true || prov.get('exists') !== true) return;
    const avail = pe.get('availability') || [];
    const availDays = pe.get('availableDays') || [];
    const incl = pe.get('includes') || [];
    const notIncl = pe.get('notincludes') || [];
    const langs = pe.get('languages') || [];
    rows.push({
      name: pe.get('name') || '',
      description: pe.get('description') || '',
      adulto: applyPriceAdjustments(pe.get('price') || 0, priceOptions),
      nino: applyPriceAdjustments(pe.get('price_child') || 0, priceOptions),
      sinAlcohol: applyPriceAdjustments(pe.get('price_no_alcohol') || 0, priceOptions),
      tipo: pe.get('tipo') || 'Proveedor',
      provider: prov ? prov.get('name') : '-',
      duration: formatDurationMinutes(pe.get('duration') || 0),
      diasSugeridos: formatAvailabilityDays(avail, availDays),
      horarios: formatAvailabilityTimes(avail),
      anticipacion: formatAdvanceBooking(pe.get('advance_booking_time') || 0),
      incluye: Array.isArray(incl) ? incl.join(', ') : (incl || ''),
      noIncluye: Array.isArray(notIncl) ? notIncl.join(', ') : (notIncl || ''),
      idiomas: Array.isArray(langs) ? langs.join(', ') : (langs || ''),
    });
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/**
 * Get tours data with pricing matrix.
 * @param clientId
 * @param priceOptions
 * @returns {Promise<{rows: Array, rateNames: string[]}>} Formatted tours data with rate names.
 * @example
 */
async function getToursData(clientId, priceOptions) {
  const rateNames = await getActiveRateNames();

  const queries = [];

  const tourQuery = new Parse.Query('Tour');
  tourQuery.equalTo('exists', true);
  tourQuery.equalTo('active', true);
  tourQuery.include('destinationPOI');
  tourQuery.ascending('destinationPOI.name');
  tourQuery.limit(1000);
  queries.push(tourQuery.find({ useMasterKey: true }));

  const priceQuery = new Parse.Query('TourPrices');
  priceQuery.equalTo('exists', true);
  priceQuery.equalTo('active', true);
  priceQuery.include('ratePtr');
  priceQuery.include('tourPtr');
  priceQuery.include('vehicleType');
  priceQuery.limit(5000);
  queries.push(priceQuery.find({ useMasterKey: true }));

  // Load client-specific prices if clientId provided
  if (clientId) {
    const cpQuery = new Parse.Query('ClientPrices');
    cpQuery.equalTo('clientPtr', Parse.Object.extend('AmexingUser').createWithoutData(clientId));
    cpQuery.equalTo('itemType', 'TOUR');
    cpQuery.equalTo('exists', true);
    cpQuery.doesNotExist('valid_until');
    cpQuery.limit(50000);
    queries.push(cpQuery.find({ useMasterKey: true }));
  }

  const [tours, tourPrices, clientPrices] = await Promise.all(queries);

  // Build client price lookup: tourId-rateId-vehicleId -> precio
  const clientPriceMap = {};
  if (clientPrices) {
    clientPrices.forEach((cp) => {
      const ratePtr = cp.get('ratePtr');
      const vehiclePtr = cp.get('vehiclePtr');
      const cpKey = `${cp.get('itemId')}-${ratePtr ? ratePtr.id : ''}-${vehiclePtr ? vehiclePtr.id : ''}`;
      clientPriceMap[cpKey] = cp.get('precio');
    });
  }

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

    let price = tp.get('price') || 0;

    // Override with client price if available
    if (clientId) {
      const cpKey = `${tour.id}-${rate.id}-${vehicleType ? vehicleType.id : ''}`;
      if (clientPriceMap[cpKey] !== undefined) {
        price = clientPriceMap[cpKey];
      }
    }

    priceLookup[key][rate.get('name')] = applyPriceAdjustments(price, priceOptions);

    if (vehicleType) {
      vtNames[vehicleType.id] = vehicleType.get('name') || 'N/A';
    }
  });

  const rows = [];
  tours.forEach((tour) => {
    const dest = tour.get('destinationPOI');
    const destName = dest ? dest.get('name') : 'N/A';
    const durationMin = tour.get('time') || 0;
    const duration = formatDurationMinutes(durationMin);
    const isWalking = tour.get('isWalkingTour');

    // Common detail fields for all tour types
    const avail = tour.get('availability') || [];
    const availDays = tour.get('availableDays') || [];
    const incl = tour.get('includes') || [];
    const notIncl = tour.get('notincludes') || [];
    const langs = tour.get('languages') || [];
    const tourDetails = {
      description: tour.get('description') || tour.get('notes') || '',
      diasSugeridos: formatAvailabilityDays(avail, availDays),
      horarios: formatAvailabilityTimes(avail),
      anticipacion: formatAdvanceBooking(tour.get('advance_booking_time') || 0),
      incluye: Array.isArray(incl) ? incl.join(', ') : (incl || ''),
      noIncluye: Array.isArray(notIncl) ? notIncl.join(', ') : (notIncl || ''),
      idiomas: Array.isArray(langs) ? langs.join(', ') : (langs || ''),
    };

    if (isWalking) {
      const priceMap = priceLookup[`${tour.id}|none`] || {};
      const walkingSmall = applyPriceAdjustments(tour.get('walkingPriceSmall') || 0, priceOptions);
      const walkingMedium = applyPriceAdjustments(tour.get('walkingPriceMedium') || 0, priceOptions);
      const walkingLarge = applyPriceAdjustments(tour.get('walkingPriceLarge') || 0, priceOptions);
      const row = {
        destination: destName,
        duration,
        walkingTour: 'Si',
        vehicleType: 'A Pie',
        walkingPriceSmall: walkingSmall,
        walkingPriceMedium: walkingMedium,
        walkingPriceLarge: walkingLarge,
        ...tourDetails,
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
        destination: destName, duration, walkingTour: 'No', vehicleType: 'N/A', ...tourDetails,
      };
      rateNames.forEach((name) => { row[`rate_${name}`] = 0; });
      rows.push(row);
      return;
    }

    vehicleTypeIds.forEach((vtId, idx) => {
      const priceMap = priceLookup[`${tour.id}|${vtId}`] || {};
      const row = {
        destination: destName,
        duration,
        walkingTour: 'No',
        vehicleType: vtNames[vtId] || 'N/A',
        // Only show details on first vehicle row to avoid repetition
        ...(idx === 0 ? tourDetails : {
          description: '',
          diasSugeridos: '',
          horarios: '',
          anticipacion: '',
          incluye: '',
          noIncluye: '',
          idiomas: '',
        }),
      };
      rateNames.forEach((name) => { row[`rate_${name}`] = priceMap[name] || 0; });
      rows.push(row);
    });
  });

  rows.sort((a, b) => a.destination.localeCompare(b.destination) || a.vehicleType.localeCompare(b.vehicleType));

  return { rows, rateNames };
}

// =====================
// PDF TABLE HELPERS
// =====================

/**
 * Draws a PDF header with Amexing branding in green scheme.
 * @param {object} doc - PDFKit document.
 * @param priceOptions
 * @returns {Promise<void>} Resolves when header is drawn.
 * @example
 */
async function drawPDFHeader(doc, priceOptions) {
  const bannerHeight = 90;
  const textX = 200;
  const textWidth = doc.page.width - 260;

  // Dark gray banner
  doc.rect(50, 15, doc.page.width - 100, bannerHeight).fill('#605E5E');

  const logoPath = await ensureLogoPNG();
  if (logoPath) {
    doc.image(logoPath, 60, 25, { width: 120 });
  }

  doc.fontSize(16).fillColor('#FFFFFF').text('AMEXING EXPERIENCE', textX, 22, { align: 'right', width: textWidth });
  doc.fontSize(9).fillColor('#FFFFFF').text('Vicente Suarez 5, Independencia', textX, 42, { align: 'right', width: textWidth });
  doc.fontSize(9).fillColor('#FFFFFF').text('San Miguel de Allende, GTO 37732', textX, 54, { align: 'right', width: textWidth });
  doc.fontSize(9).fillColor('#FFFFFF').text('info@amexingexperience.com', textX, 66, { align: 'right', width: textWidth });
  doc.fontSize(9).fillColor('#FFFFFF').text('+52 (415) 167 39 90', textX, 78, { align: 'right', width: textWidth });

  // Show Pago and Moneda on the left, date on the right
  if (priceOptions) {
    const pagoLabel = (priceOptions.paymentType || 'efectivo').charAt(0).toUpperCase()
      + (priceOptions.paymentType || 'efectivo').slice(1);
    const monedaLabel = priceOptions.currency || 'MXN';
    doc.fontSize(8).fillColor('#FFFFFF').text(`Pago: ${pagoLabel}  |  Moneda: ${monedaLabel}`, 60, 92, { width: 200, align: 'left' });
  }

  const date = new Date().toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.fontSize(8).fillColor('#FFFFFF').text(`Generado: ${date}`, textX, 92, { align: 'right', width: textWidth });

  doc.y = 115;
}

/**
 * Draws a table in the PDF document with green color scheme.
 * @param {object} options - Table drawing options.
 * @param {object} options.doc - PDFKit document.
 * @param {string} options.title - Section title.
 * @param {string[]} options.headers - Column headers.
 * @param {Array<string[]>} options.rows - Row data.
 * @param {number[]} options.colWidths - Column widths.
 * @example
 */
async function drawPDFTable(options) {
  const {
    doc, title, headers, rows, colWidths, groupColumns, priceOptions,
  } = options;
  const startX = 50;
  const pageWidth = doc.page.width - 100;
  const minRowHeight = 20;
  const cellPadding = 5;

  // Section title bar (dark green)
  doc.rect(startX, doc.y, pageWidth, 24).fill('#385723');
  doc.fontSize(12).fillColor('#FFFFFF').text(title.toUpperCase(), startX + 8, doc.y + 6, { width: pageWidth - 16 });
  doc.y += 30;

  const widths = colWidths && colWidths.length > 0
    ? colWidths
    : headers.map(() => pageWidth / headers.length);

  let y = doc.y; // eslint-disable-line prefer-destructuring

  /**
   * Calculate the height needed for a row based on text wrapping.
   * @param {Array} row - Array of cell values.
   * @returns {number} Row height in points.
   * @example
   */
  const calcRowHeight = (row) => {
    let maxH = minRowHeight;
    row.forEach((cellVal, i) => {
      const val = String(cellVal || '');
      if (!val) return;
      const textH = doc.fontSize(8).heightOfString(val, { width: widths[i] - 8 });
      const cellH = textH + cellPadding * 2;
      if (cellH > maxH) maxH = cellH;
    });
    return maxH;
  };

  /**
   * Draw the header row with green background.
   * @returns {void}
   * @example
   */
  const drawHeaderRow = () => {
    doc.rect(startX, y, pageWidth, minRowHeight).fill('#A9D18E');
    let hx = startX;
    headers.forEach((header, i) => {
      doc.fontSize(8).fillColor('#000000').text(header, hx + 4, y + cellPadding, { width: widths[i] - 8, align: 'center' });
      hx += widths[i];
    });
    y += minRowHeight;
  };

  drawHeaderRow();

  // Track group values for visual separation
  const prevGroupValues = groupColumns ? groupColumns.map(() => null) : [];

  // Data rows
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowHeight = calcRowHeight(row);

    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      // eslint-disable-next-line no-await-in-loop
      await drawPDFHeader(doc, priceOptions);
      y = doc.y; // eslint-disable-line prefer-destructuring
      drawHeaderRow();
    }

    // Determine group changes
    let topGroupChanged = false;
    let anyGroupChanged = false;
    if (groupColumns && groupColumns.length > 0) {
      for (let g = 0; g < groupColumns.length; g += 1) {
        const colIdx = groupColumns[g];
        const cellVal = String(row[colIdx] || '');
        if (cellVal && cellVal !== prevGroupValues[g]) {
          anyGroupChanged = true;
          if (g === 0) topGroupChanged = true;
          // Reset all deeper groups when a higher group changes
          for (let deeper = g; deeper < groupColumns.length; deeper += 1) {
            prevGroupValues[deeper] = String(row[groupColumns[deeper]] || '');
          }
          break;
        }
      }
    }

    // Draw separator line when group changes (not on first row)
    if (anyGroupChanged && rowIndex > 0) {
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y)
        .lineWidth(topGroupChanged ? 2 : 1)
        .strokeColor(topGroupChanged ? '#385723' : '#A9D18E')
        .stroke();
      doc.lineWidth(1);
    }

    // Background: light green tint for first row of a top-level group, alternating otherwise
    let bgColor;
    if (topGroupChanged || rowIndex === 0) {
      bgColor = '#E8F5E0';
    } else {
      bgColor = rowIndex % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
    }
    doc.rect(startX, y, pageWidth, rowHeight).fill(bgColor);

    // Render cells with vertical centering
    let x = startX;
    const currentY = y;
    // eslint-disable-next-line no-loop-func
    row.forEach((cellVal, i) => {
      const isGroupCol = groupColumns && groupColumns.includes(i);
      const val = String(cellVal || '');
      const textY = currentY + cellPadding;

      // For group columns: show value only on first occurrence, bold
      if (isGroupCol && val) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#1E293B')
          .text(val, x + 4, textY, { width: widths[i] - 8, align: 'left' });
        doc.font('Helvetica');
      } else {
        doc.fontSize(8).fillColor('#334155')
          .text(val, x + 4, textY, { width: widths[i] - 8, align: 'left' });
      }
      x += widths[i];
    });
    y += rowHeight;
  }

  doc.y = y + 10;
}

// =====================
// EXCEL SHEET BUILDERS
// =====================

/**
 * Adds Vehiculos sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @param priceOptions
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 */
async function addVehiculosSheet(workbook, priceOptions) {
  const data = await getVehiculosData();
  const sheet = workbook.addWorksheet('Vehiculos', { properties: { tabColor: { argb: LIGHT_GREEN } } });
  const colCount = 5;

  const dataStart = await addCompanyHeader(sheet, workbook, colCount, priceOptions);
  addSectionTitleRow(sheet, dataStart, 'TARIFARIO - VEHICULOS', colCount);
  const headerRowNum = dataStart + 1;

  // Set column widths
  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 22;
  sheet.getColumn(5).width = 40;

  // Add header row
  const headerRow = sheet.getRow(headerRowNum);
  ['Tipo de Vehiculo', 'Codigo', 'Capacidad Pasajeros', 'Capacidad Equipaje', 'Descripcion'].forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(sheet, headerRowNum);

  // Add data rows
  data.forEach((item) => {
    const row = sheet.addRow([item.name, item.code, item.capacity, item.luggage, item.description]);
    styleDataRow(row, 0);
  });
}

/**
 * Adds Traslados sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @param clientId
 * @param priceOptions
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 */
async function addTrasladosSheet(workbook, clientId, priceOptions) {
  const { rows, rateNames } = await getTrasladosData(clientId, priceOptions);
  const sheet = workbook.addWorksheet('Traslados', { properties: { tabColor: { argb: LIGHT_GREEN } } });

  const headerNames = ['Tipo', 'Origen', 'Destino', 'Tipo Vehiculo', ...rateNames];
  const colCount = headerNames.length;

  const dataStart = await addCompanyHeader(sheet, workbook, colCount, priceOptions);
  addSectionTitleRow(sheet, dataStart, 'TARIFARIO - TRASLADOS', colCount);
  const headerRowNum = dataStart + 1;

  // Set column widths
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 25;
  sheet.getColumn(3).width = 25;
  sheet.getColumn(4).width = 18;
  rateNames.forEach((_, i) => { sheet.getColumn(5 + i).width = 18; });

  // Add header row
  const headerRow = sheet.getRow(headerRowNum);
  headerNames.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  styleHeaderRow(sheet, headerRowNum);

  // Add data rows
  const firstDataRow = headerRowNum + 1;
  rows.forEach((item) => {
    const vals = [item.serviceType, item.origin, item.destination, item.vehicleType];
    rateNames.forEach((name) => { vals.push(item[`rate_${name}`] || 0); });
    const row = sheet.addRow(vals);
    styleDataRow(row, 5);
  });

  // Merge repeated Tipo, Origen, and Destino cells
  mergeRepeatedCells(sheet, firstDataRow, 1, 2, 3);
}

/**
 * Adds A Disposicion sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @param priceOptions
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 */
async function addADisposicionSheet(workbook, priceOptions) {
  const data = await getADisposicionData(priceOptions);
  const sheet = workbook.addWorksheet('A Disposicion', { properties: { tabColor: { argb: LIGHT_GREEN } } });
  const colCount = 3;

  const dataStart = await addCompanyHeader(sheet, workbook, colCount, priceOptions);
  addSectionTitleRow(sheet, dataStart, 'TARIFARIO - A DISPOSICION', colCount);
  const headerRowNum = dataStart + 1;

  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 20;
  sheet.getColumn(3).width = 18;

  const headerRow = sheet.getRow(headerRowNum);
  ['Tipo de Vehiculo', 'Tarifa', 'Precio por Hora'].forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(sheet, headerRowNum);

  data.forEach((item) => {
    const row = sheet.addRow([item.vehicleType, item.rate, item.hourlyPrice]);
    styleDataRow(row, 3);
  });
}

/**
 * Adds Experiencias sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @param priceOptions
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 */
async function addExperienciasSheet(workbook, priceOptions) {
  const data = await getExperienciasData(priceOptions);
  const sheet = workbook.addWorksheet('Experiencias', { properties: { tabColor: { argb: LIGHT_GREEN } } });
  const headers = ['Nombre', 'Descripcion', 'Adulto', 'Niño', 'Sin Alcohol', 'Duracion', 'Dias Sugeridos', 'Horarios', 'Anticipacion', 'Incluye', 'No Incluye', 'Idiomas'];
  const colCount = headers.length;

  const dataStart = await addCompanyHeader(sheet, workbook, colCount, priceOptions);
  addSectionTitleRow(sheet, dataStart, 'TARIFARIO - EXPERIENCIAS', colCount);
  const headerRowNum = dataStart + 1;

  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 35;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 18;
  sheet.getColumn(8).width = 25;
  sheet.getColumn(9).width = 14;
  sheet.getColumn(10).width = 30;
  sheet.getColumn(11).width = 30;
  sheet.getColumn(12).width = 18;

  const headerRow = sheet.getRow(headerRowNum);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(sheet, headerRowNum);

  data.forEach((item) => {
    const row = sheet.addRow([
      item.name, item.description, item.adulto, item.nino, item.sinAlcohol, item.duration,
      item.diasSugeridos, item.horarios, item.anticipacion,
      item.incluye, item.noIncluye, item.idiomas,
    ]);
    styleDataRow(row, 3);
  });
}

/**
 * Adds Tours sheet to workbook.
 * @param {object} workbook - ExcelJS workbook.
 * @param clientId
 * @param priceOptions
 * @returns {Promise<void>} Resolves when sheet is added.
 * @example
 */
async function addToursSheet(workbook, clientId, priceOptions) {
  const { rows, rateNames } = await getToursData(clientId, priceOptions);
  const sheet = workbook.addWorksheet('Tours', { properties: { tabColor: { argb: LIGHT_GREEN } } });

  const fixedHeaders = ['Destino', 'Descripcion', 'Min. Horas', 'Walking Tour', 'Tipo Vehiculo',
    '1-5 pax', '6-10 pax', '11-15 pax',
    'Dias Sugeridos', 'Horarios', 'Anticipacion', 'Incluye', 'No Incluye', 'Idiomas'];
  const headerNames = [...fixedHeaders, ...rateNames];
  const colCount = headerNames.length;
  const rateStartCol = fixedHeaders.length + 1;

  const dataStart = await addCompanyHeader(sheet, workbook, colCount, priceOptions);
  addSectionTitleRow(sheet, dataStart, 'TARIFARIO - TOURS', colCount);
  const headerRowNum = dataStart + 1;

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 30;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 14;
  sheet.getColumn(9).width = 16;
  sheet.getColumn(10).width = 22;
  sheet.getColumn(11).width = 14;
  sheet.getColumn(12).width = 28;
  sheet.getColumn(13).width = 28;
  sheet.getColumn(14).width = 16;
  rateNames.forEach((_, i) => { sheet.getColumn(rateStartCol + i).width = 18; });

  const headerRow = sheet.getRow(headerRowNum);
  headerNames.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  styleHeaderRow(sheet, headerRowNum);

  const firstDataRow = headerRowNum + 1;
  rows.forEach((item) => {
    const vals = [item.destination, item.description, item.duration, item.walkingTour, item.vehicleType,
      item.walkingPriceSmall || '', item.walkingPriceMedium || '', item.walkingPriceLarge || '',
      item.diasSugeridos, item.horarios, item.anticipacion, item.incluye, item.noIncluye, item.idiomas];
    rateNames.forEach((name) => { vals.push(item[`rate_${name}`] || 0); });
    const row = sheet.addRow(vals);
    styleDataRow(row, 6);
  });

  // Merge repeated Destino cells
  mergeRepeatedCells(sheet, firstDataRow, 1);
}

// =====================
// SECTION DISPATCH MAP
// =====================

const EXCEL_BUILDERS = {
  vehiculos: (wb, _cId, po) => addVehiculosSheet(wb, po),
  traslados: (wb, cId, po) => addTrasladosSheet(wb, cId, po),
  'a-disposicion': (wb, _cId, po) => addADisposicionSheet(wb, po),
  experiencias: (wb, _cId, po) => addExperienciasSheet(wb, po),
  tours: (wb, cId, po) => addToursSheet(wb, cId, po),
};

/**
 * Builds PDF content for a given section.
 * @param {object} doc - PDFKit document.
 * @param {string} section - Section name.
 * @param clientId
 * @param priceOptions
 * @returns {Promise<void>} Resolves when section is drawn.
 * @example
 */
async function buildPDFSection(doc, section, clientId, priceOptions) {
  switch (section) {
    case 'vehiculos': {
      const data = await getVehiculosData();
      const tableRows = data.map((d) => [d.name, d.code, d.capacity, d.luggage, d.description]);
      await drawPDFTable({
        doc, title: 'Vehiculos', headers: ['Tipo de Vehiculo', 'Codigo', 'Cap. Pasajeros', 'Cap. Equipaje', 'Descripcion'], rows: tableRows, colWidths: [150, 90, 100, 100, 260], priceOptions,
      });
      break;
    }
    case 'traslados': {
      const { rows, rateNames } = await getTrasladosData(clientId, priceOptions);
      const hdrs = ['Tipo', 'Origen', 'Destino', 'Tipo Vehiculo', ...rateNames];
      const fixedW = 480;
      const remainW = doc.page.width - 100 - fixedW;
      const rateW = rateNames.length > 0 ? remainW / rateNames.length : 80;
      let prevType = '';
      let prevOrigin = '';
      let prevDest = '';
      const tableRows = rows.map((r) => {
        const showType = r.serviceType !== prevType;
        const showOrigin = r.serviceType !== prevType || r.origin !== prevOrigin;
        const showDest = showOrigin || r.destination !== prevDest;
        prevType = r.serviceType;
        prevOrigin = r.origin;
        prevDest = r.destination;
        const base = [showType ? r.serviceType : '', showOrigin ? r.origin : '', showDest ? r.destination : '', r.vehicleType];
        const cur = priceOptions ? priceOptions.currency : null;
        rateNames.forEach((name) => { base.push(formatCurrency(r[`rate_${name}`], cur)); });
        return base;
      });
      await drawPDFTable({
        doc, title: 'Traslados', headers: hdrs, rows: tableRows, colWidths: [80, 130, 130, 100, ...rateNames.map(() => rateW)], groupColumns: [0, 1, 2], priceOptions,
      });
      break;
    }
    case 'a-disposicion': {
      const data = await getADisposicionData(priceOptions);
      const cur = priceOptions ? priceOptions.currency : null;
      const tableRows = data.map((d) => [
        d.vehicleType, d.rate, formatCurrency(d.hourlyPrice, cur),
      ]);
      await drawPDFTable({
        doc, title: 'A Disposicion', headers: ['Tipo de Vehiculo', 'Tarifa', 'Precio por Hora'], rows: tableRows, colWidths: [250, 220, 180], priceOptions,
      });
      break;
    }
    case 'experiencias': {
      const data = await getExperienciasData(priceOptions);
      const cur = priceOptions ? priceOptions.currency : null;
      const tableRows = data.map((d) => [
        d.name, d.description,
        formatCurrency(d.adulto, cur),
        formatCurrency(d.nino, cur),
        formatCurrency(d.sinAlcohol, cur),
        d.duration, d.diasSugeridos, d.horarios, d.anticipacion,
        d.incluye, d.noIncluye, d.idiomas,
      ]);
      await drawPDFTable({
        doc,
        title: 'Experiencias',
        headers: ['Nombre', 'Descripcion', 'Adulto', 'Niño', 'Sin Alcohol', 'Duracion', 'Dias', 'Horarios', 'Anticipacion', 'Incluye', 'No Incluye', 'Idiomas'],
        rows: tableRows,
        colWidths: [90, 130, 52, 52, 52, 46, 58, 70, 52, 90, 90, 52],
        priceOptions,
      });
      break;
    }
    case 'tours': {
      const { rows, rateNames } = await getToursData(clientId, priceOptions);
      const cur = priceOptions ? priceOptions.currency : null;
      const hdrs = ['Destino', 'Descripcion', 'Min. Hrs', 'Walking', 'Vehiculo',
        '1-5 pax', '6-10 pax', '11-15 pax',
        'Dias', 'Horarios', 'Anticipacion', 'Incluye', 'No Incluye', 'Idiomas', ...rateNames];
      const fixedW = 780;
      const remainW = doc.page.width - 100 - fixedW;
      const rateW = rateNames.length > 0 ? Math.max(remainW / rateNames.length, 45) : 45;
      let prevTourDest = '';
      const tableRows = rows.map((r) => {
        const showDest = r.destination !== prevTourDest;
        prevTourDest = r.destination;
        const base = [showDest ? r.destination : '', r.description || '', r.duration, r.walkingTour, r.vehicleType,
          r.walkingPriceSmall ? formatCurrency(r.walkingPriceSmall, cur) : '',
          r.walkingPriceMedium ? formatCurrency(r.walkingPriceMedium, cur) : '',
          r.walkingPriceLarge ? formatCurrency(r.walkingPriceLarge, cur) : '',
          r.diasSugeridos || '', r.horarios || '', r.anticipacion || '',
          r.incluye || '', r.noIncluye || '', r.idiomas || ''];
        rateNames.forEach((name) => { base.push(formatCurrency(r[`rate_${name}`], cur)); });
        return base;
      });
      await drawPDFTable({
        doc,
        title: 'Tours',
        headers: hdrs,
        rows: tableRows,
        colWidths: [70, 75, 35, 35, 55, 45, 45, 45, 45, 55, 45, 60, 60, 40, ...rateNames.map(() => rateW)],
        groupColumns: [0],
        priceOptions,
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

/**
 * Service for exporting tarifario data in Excel and PDF formats.
 * @example
 */
class TarifarioExportService {
  /**
   * Export selected sections in the specified format.
   * @param {string[]} sections - Array of section names to export.
   * @param {string} format - Export format: 'excel' or 'pdf'.
   * @param clientId
   * @param priceOptions
   * @returns {Promise<{buffer: Buffer, contentType: string, filename: string}>} Export result.
   * @example
   */
  async exportSections(sections, format = 'excel', clientId = null, priceOptions = null) {
    const validSections = sections.filter((s) => VALID_SECTIONS.includes(s));
    if (validSections.length === 0) {
      throw new Error('No valid sections specified');
    }

    const date = new Date().toISOString().split('T')[0];

    if (format === 'pdf') {
      const buffer = await TarifarioExportService.buildPDF(validSections, clientId, priceOptions);
      return {
        buffer,
        contentType: 'application/pdf',
        filename: `tarifario-amexing-${date}.pdf`,
      };
    }

    const workbook = await TarifarioExportService.buildExcelWorkbook(validSections, clientId, priceOptions);
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
   */
  static getValidSections() {
    return [...VALID_SECTIONS];
  }

  /**
   * Build an Excel workbook with selected sections as sheets.
   * @param {string[]} sections - Sections to include.
   * @param clientId
   * @param priceOptions
   * @returns {Promise<object>} Populated ExcelJS workbook.
   * @example
   */
  static async buildExcelWorkbook(sections, clientId = null, priceOptions = null) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Amexing Experience';
    workbook.created = new Date();

    const buildPromises = sections
      .filter((s) => EXCEL_BUILDERS[s])
      .map((s) => EXCEL_BUILDERS[s](workbook, clientId, priceOptions));

    await Promise.all(buildPromises);
    return workbook;
  }

  /**
   * Build a PDF document with selected sections.
   * @param {string[]} sections - Sections to include.
   * @param clientId
   * @param priceOptions
   * @returns {Promise<Buffer>} PDF buffer.
   * @example
   */
  static async buildPDF(sections, clientId = null, priceOptions = null) {
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

    await drawPDFHeader(doc, priceOptions);

    for (let i = 0; i < sections.length; i += 1) {
      if (i > 0) {
        doc.addPage();
        // eslint-disable-next-line no-await-in-loop
        await drawPDFHeader(doc, priceOptions);
      }
      // Sequential PDF rendering required
      // eslint-disable-next-line no-await-in-loop
      await buildPDFSection(doc, sections[i], clientId, priceOptions);
    }

    // Footer on last page
    const footerY = doc.page.height - 40;
    doc.fontSize(8).fillColor('#385723')
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
