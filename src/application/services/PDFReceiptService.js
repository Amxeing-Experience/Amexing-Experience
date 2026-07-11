/**
 * PDFReceiptService - PDF Receipt Generation Service.
 *
 * Genera el recibo (INVOICE) de Amexing como PDF vía HTML + Puppeteer
 * (PdfRenderService.renderHtmlToPdf), a partir de la plantilla
 * `src/presentation/views/pdf/receipt.ejs`. El diseño (logo centrado, banda verde,
 * ISSUED TO con datos fiscales, tabla de conceptos, totales y footer con paginación)
 * se controla en HTML/CSS.
 * @author Denisse Maldonado
 * @version 2.0.0
 * @since 1.0.0
 * @example
 * const service = new PDFReceiptService();
 * const pdfBuffer = await service.generateReceipt(quoteData);
 */

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const logger = require('../../infrastructure/logger');
const { renderHtmlToPdf } = require('./PdfRenderService');

const TEMPLATE_PATH = path.join(__dirname, '../../presentation/views/pdf/receipt.ejs');
// Mismo logo que usa la cotización (wordmark sin el corazón).
const LOGO_PATH = path.join(process.cwd(), 'public/images/logos/light_amexing.png');
const BRAND_GREEN = '#969b81';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * PDFReceiptService class for generating quote receipts.
 */
class PDFReceiptService {
  constructor() {
    this.companyWebsite = 'amexingexperience.com';
    // El logo (base64) sí se cachea (rara vez cambia); la plantilla se lee en cada
    // recibo para que los ajustes de diseño se reflejen sin reiniciar el server.
    this.logoDataUriCache = undefined;
  }

  /**
   * Lee la plantilla EJS del recibo (sin caché: refleja cambios de diseño al vuelo).
   * @returns {string} Contenido de la plantilla.
   * @example
   */
  getTemplate() {
    return fs.readFileSync(TEMPLATE_PATH, 'utf8');
  }

  /**
   * Lee (y cachea) el logo horizontal como data URI base64 (o '' si no existe).
   * @returns {string} data:image/png;base64,... o ''.
   * @example
   */
  getLogoDataUri() {
    if (this.logoDataUriCache === undefined) {
      try {
        const b64 = fs.readFileSync(LOGO_PATH).toString('base64');
        this.logoDataUriCache = `data:image/png;base64,${b64}`;
      } catch (e) {
        logger.warn('PDFReceiptService: no se pudo leer el logo, usando fallback de texto', { error: e.message });
        this.logoDataUriCache = '';
      }
    }
    return this.logoDataUriCache;
  }

  /**
   * Genera el recibo PDF de una cotización agendada.
   * @param {object} quoteData - Datos: quote, client, serviceItems, totals, billingProfile, guestNames.
   * @returns {Promise<Buffer>} PDF buffer.
   * @throws {Error} Si falla la generación.
   * @example
   * const receipt = await service.generateReceipt({ quote, client, serviceItems, totals });
   */
  async generateReceipt(quoteData) {
    try {
      const {
        quote, client, serviceItems, totals, billingProfile, guestNames, reservationFolio,
      } = quoteData;

      const viewData = {
        brand: BRAND_GREEN,
        logoDataUri: this.getLogoDataUri(),
        issuedTo: this.buildIssuedTo(client, billingProfile),
        invoiceNo: reservationFolio || String(quote.folio || '').replace('QTE-', '') || 'N/A',
        date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
        guestNames: Array.isArray(guestNames) ? guestNames.filter(Boolean) : [],
        items: (serviceItems || []).map((item) => this.buildItem(item)),
        subtotal: `$${this.formatCurrency(totals.subtotal || 0)} MXN`,
        taxes: `$${this.formatCurrency(totals.iva || 0)} MXN`,
        total: `$${this.formatCurrency(totals.total || 0)} MXN`,
      };

      const html = ejs.render(this.getTemplate(), viewData);
      const pdfBuffer = await renderHtmlToPdf(html, { format: 'A4', margin: '12mm' });

      logger.info('PDF receipt generated successfully', {
        quoteId: quote.id, quoteFolio: quote.folio, bufferSize: pdfBuffer.length,
      });
      return pdfBuffer;
    } catch (error) {
      logger.error('Error generating PDF receipt', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Arma el bloque ISSUED TO: perfil de facturación de la agencia si se eligió; si no, el cliente.
   * @param {object} client - Datos del cliente.
   * @param {object|null} billingProfile - Perfil fiscal serializado (o null).
   * @returns {{name: string, lines: string[]}} Nombre + líneas a mostrar.
   * @example
   */
  buildIssuedTo(client = {}, billingProfile = null) {
    if (billingProfile) {
      const bp = billingProfile;
      const nameBase = bp.razonSocial || bp.commercialName || bp.label || 'N/A';
      const taxId = bp.rfc || bp.taxId || '';
      const streetLine = [
        bp.streetType, bp.street,
        bp.exteriorNumber ? `#${bp.exteriorNumber}` : '',
        bp.interiorNumber ? `Int. ${bp.interiorNumber}` : '',
      ].filter(Boolean).join(' ');
      const cityLine = [
        bp.colonia, bp.city, bp.state,
        bp.codigoPostal ? `C.P. ${bp.codigoPostal}` : '',
      ].filter(Boolean).join(', ');
      const lines = [
        streetLine, cityLine, bp.country,
        bp.phone || client.phone, bp.emailFacturacion || client.email,
      ].filter(Boolean);
      return { name: taxId ? `${nameBase} - ${taxId}` : nameBase, lines };
    }
    // Fallback: datos del cliente.
    let name = '';
    if (client.firstName || client.lastName) {
      name = `${client.firstName || ''} ${client.lastName || ''}`.trim();
    } else {
      name = client.fullName || client.email || 'N/A';
    }
    const lines = [client.phone, client.email].filter(Boolean);
    return { name, lines };
  }

  /**
   * Arma un renglón de concepto: fecha (por día), descripción (HTML con <br>) y monto.
   * @param {object} item - Item de servicio del día.
   * @returns {{date: string, desc: string, amount: string}} Renglón listo para la plantilla.
   * @example
   */
  buildItem(item) {
    // Fecha real del día (dayDate 'YYYY-MM-DD'); solo viene en el primer servicio del día.
    const date = item.dayDate ? `${this.formatDayDate(item.dayDate)}:` : '';

    const parts = [];
    if (item.concept) parts.push(this.escapeHtml(item.concept));
    // Segmento + vehículo + desglose de personas (p.ej. "Premium Suburban - 2 adultos").
    const vehicle = [item.segment, item.vehicle].filter(Boolean).join(' ');
    if (vehicle) {
      parts.push(this.escapeHtml(`${vehicle}${item.paxText ? ` - ${item.paxText}` : ''}`));
    } else if (item.paxText) {
      // Sin vehículo (experiencias / walking tours): solo el desglose de personas.
      parts.push(this.escapeHtml(item.paxText));
    }
    // Vehículos adicionales (si existen), uno por línea.
    (item.additionalVehicles || []).forEach((av) => {
      const v = [av.segment, av.vehicle].filter(Boolean).join(' ');
      if (v) parts.push(this.escapeHtml(`+ ${v}`));
    });

    return {
      date,
      desc: parts.join('<br>'),
      amount: this.formatCurrency(item.total || 0),
    };
  }

  /**
   * Formatea una fecha 'YYYY-MM-DD' a "December 2nd" (sin desfase de zona horaria).
   * @param {string} iso - Fecha ISO corta.
   * @returns {string} Fecha legible en inglés (o la cadena original si no parsea).
   * @example
   *   this.formatDayDate('2025-12-02'); // 'December 2nd'
   */
  formatDayDate(iso) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    const month = MONTHS[parseInt(m[2], 10) - 1] || '';
    const day = parseInt(m[3], 10);
    return `${month} ${day}${this.getOrdinalSuffix(day)}`;
  }

  /**
   * Escapa texto para insertarlo como HTML seguro en la plantilla.
   * @param {string} s - Texto.
   * @returns {string} Texto escapado.
   * @example
   */
  escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Format currency with commas.
   * @param {number} amount - Amount to format.
   * @returns {string} Formatted currency string.
   * @example
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  /**
   * Clean vehicle name by removing ObjectId in parentheses.
   * @param {string} vehicleName - Vehicle name to clean.
   * @returns {string} Clean vehicle name.
   * @example
   */
  cleanVehicleName(vehicleName) {
    if (!vehicleName) return '';
    return vehicleName.replace(/\s*\([^)]*\)/g, '').trim();
  }

  /**
   * Get ordinal suffix for dates.
   * @param {number} day - Day number.
   * @returns {string} Ordinal suffix.
   * @example
   */
  getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }
}

module.exports = PDFReceiptService;
