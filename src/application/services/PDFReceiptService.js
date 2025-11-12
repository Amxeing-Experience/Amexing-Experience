/**
 * PDFReceiptService - PDF Receipt Generation Service.
 *
 * Generates professional PDF receipts for scheduled quotes using PDFKit.
 * Based on Amexing Experience invoice template design.
 *
 * Features:
 * - Professional Amexing branding
 * - Dynamic quote data integration
 * - Service items breakdown
 * - Tax calculations
 * - Payment information
 * - Client information display.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const service = new PDFReceiptService();
 * const pdfBuffer = await service.generateReceipt(quoteData);
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('../../infrastructure/logger');

/**
 * PDFReceiptService class for generating quote receipts.
 */
/* eslint-disable no-param-reassign */ // PDF generation requires modifying doc properties
class PDFReceiptService {
  constructor() {
    this.companyName = 'AMEXING EXPERIENCE';
    this.companyContact = 'contact@angelicatours.com';
    this.companyWebsite = 'amexingexperience.com';
    this.paymentInfo = {
      bank: 'Bank of America',
      accountHolder: 'Angelica Tours LLC',
      accountNumber: '488113623873',
      routingNumber: '111000025',
      achRoutingNumber: '026009593',
    };
  }

  /**
   * Generate PDF receipt for a scheduled quote.
   * @param {object} quoteData - Quote data including client, services, totals.
   * @param {object} quoteData.quote - Quote details.
   * @param {object} quoteData.client - Client information.
   * @param {Array} quoteData.serviceItems - Array of service items/days.
   * @param {object} quoteData.totals - Subtotal, taxes, total amounts.
   * @param {boolean} quoteData.includePaymentInfo - Whether to include payment info (default: true).
   * @param {object} quoteData.selectedPaymentInfo - Specific payment info to use (admin selected).
   * @returns {Promise<Buffer>} PDF buffer.
   * @throws {Error} If PDF generation fails.
   * @example
   * const receipt = await service.generateReceipt({
   *   quote: { folio: 'QTE-2025-0001', validUntil: new Date() },
   *   client: { fullName: 'John Doe', email: 'john@example.com', phone: '+1234567890' },
   *   serviceItems: [{ concept: 'Transfer', vehicleType: 'Sprinter', total: 9000 }],
   *   totals: { subtotal: 15500, iva: 2480, total: 17980 },
   *   includePaymentInfo: true,
   *   selectedPaymentInfo: { bank: 'Chase', accountHolder: 'Test LLC' }
   * });
   */
  async generateReceipt(quoteData) {
    try {
      const {
        quote, client, serviceItems, totals, includePaymentInfo = true, selectedPaymentInfo,
      } = quoteData;

      // Create PDF document with smaller margins
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 40, bottom: 40, left: 50, right: 50,
        },
      });

      // Set up fonts
      this.setupFonts(doc);

      // Generate receipt content (removed header for more space)
      this.addInvoiceAndClientInfo(doc, quote, client);
      this.addServiceItems(doc, serviceItems || []);
      this.addTotals(doc, totals);

      // Only include payment info if requested (admin/superadmin roles)
      if (includePaymentInfo) {
        this.addPaymentInfo(doc, selectedPaymentInfo);
      }

      this.addFooter(doc);

      // Convert to buffer
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));

      return new Promise((resolve, reject) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          logger.info('PDF receipt generated successfully', {
            quoteId: quote.id,
            quoteFolio: quote.folio,
            bufferSize: pdfBuffer.length,
          });
          resolve(pdfBuffer);
        });

        doc.on('error', reject);
        doc.end();
      });
    } catch (error) {
      logger.error('Error generating PDF receipt', {
        error: error.message,
        stack: error.stack,
        quoteData: JSON.stringify(quoteData, null, 2),
      });
      throw error;
    }
  }

  /**
   * Setup fonts for the PDF document.
   * @param {PDFDocument} doc - PDF document instance.
   * @example
   */
  setupFonts() {
    // PDFKit includes standard fonts, we'll use them
    // Helvetica for body text, Helvetica-Bold for headings
  }

  /**
   * Add header section with company branding.
   * @param {PDFDocument} doc - PDF document instance.
   * @example
   */
  addHeader(doc) {
    const pageWidth = doc.page.width;
    const margin = doc.page.margins.left;

    // Header background (light gray) - reduced height
    doc.fillColor('#f8f9fa')
      .rect(0, 0, pageWidth, 60)
      .fill();

    // Company name and invoice title - smaller font
    doc.fillColor('#333333')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('TAXINVOICE-AMEXING', margin, 20, { align: 'left' });

    // Date in header - smaller font
    const currentDate = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    });
    const currentTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    doc.fontSize(10)
      .text(`${currentDate}, ${currentTime}`, margin, 20, { align: 'right' });

    // Reset position after header - reduced spacing
    doc.y = 75;
  }

  /**
   * Add invoice information and client information side by side.
   * @param {PDFDocument} doc - PDF document instance.
   * @param {object} quote - Quote details.
   * @param {object} client - Client data.
   * @example
   */
  addInvoiceAndClientInfo(doc, quote, client) {
    const pageWidth = doc.page.width;
    const margin = doc.page.margins.left;
    const leftColumnX = margin;
    const rightColumnX = pageWidth * 0.55; // Start right column at 55% of page width

    // Save starting Y position for left and right columns (start from top)
    const startY = margin;

    // Left side - Bigger Amexing logo
    let leftY = startY;
    try {
      // Add Amexing logo image - much bigger
      const logoPath = path.join(process.cwd(), 'public/img/amexing_logo_vertical.png');
      if (fs.existsSync(logoPath)) {
        // Logo dimensions: 528x301, aspect ratio ~1.75
        // Make logo significantly bigger
        const logoWidth = 140; // Increased from 80 to 140
        const logoHeight = logoWidth / 1.75; // Maintain aspect ratio
        doc.image(logoPath, leftColumnX, leftY, { width: logoWidth, height: logoHeight });
        leftY += logoHeight + 20;
      } else {
        // Fallback to text if logo not found - bigger
        doc.fillColor('#333333')
          .fontSize(28)
          .text('AMEXING', leftColumnX, leftY, { width: 140, align: 'left' });
        leftY += 30;
        doc.fontSize(14)
          .text('E X P E R I E N C E', leftColumnX, leftY, { width: 140, align: 'left' });
        leftY += 30;
      }
    } catch (error) {
      // Fallback to text if logo loading fails - bigger
      logger.warn('Failed to load logo, using text fallback', { error: error.message });
      doc.fillColor('#333333')
        .fontSize(28)
        .text('AMEXING', leftColumnX, leftY, { width: 140, align: 'left' });
      leftY += 30;
      doc.fontSize(14)
        .text('E X P E R I E N C E', leftColumnX, leftY, { width: 140, align: 'left' });
      leftY += 30;
    }

    // Add client information below the logo on the left
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#666666')
      .text('ISSUED TO:', leftColumnX, leftY, { width: 200 });
    leftY += 15;

    // Determine display name: firstName + lastName, or just email if both names are empty
    let displayName = '';
    if (client.firstName || client.lastName) {
      displayName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
    } else if (client.email) {
      // If no first/last name, just show email (it will be shown again below, but that's ok)
      displayName = client.email;
    } else {
      displayName = 'N/A';
    }

    doc.font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#333333')
      .text(displayName, leftColumnX, leftY);
    leftY += 15;

    if (client.phone) {
      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#333333')
        .text(client.phone, leftColumnX, leftY);
      leftY += 12;
    }

    if (client.email) {
      doc.fontSize(10)
        .text(client.email, leftColumnX, leftY);
      leftY += 12;
    }

    // Right side - All invoice information
    let rightY = startY;
    // Invoice title
    doc.fillColor('#333333')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text('INVOICE', rightColumnX, rightY, { width: 200, align: 'right' });
    rightY += 40;

    // Invoice number
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#666666')
      .text('INVOICE NO.', rightColumnX, rightY, { width: 200, align: 'right' });
    rightY += 12;

    doc.font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#333333')
      .text(quote.folio.replace('QTE-', ''), rightColumnX, rightY, { width: 200, align: 'right' });
    rightY += 20;

    // Invoice date
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#666666')
      .text('DATE:', rightColumnX, rightY, { width: 200, align: 'right' });
    rightY += 12;

    const invoiceDate = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
    doc.font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#333333')
      .text(invoiceDate, rightColumnX, rightY, { width: 200, align: 'right' });
    rightY += 20;

    // Set doc.y to the maximum of both columns plus padding
    const newY = Math.max(leftY, rightY) + 30;
    /* eslint-disable-next-line no-param-reassign */
    doc.y = newY;
  }

  /**
   * Add service items table.
   * @param {PDFDocument} doc - PDF document instance.
   * @param {Array} serviceItems - Service items array.
   * @example
   */
  addServiceItems(doc, serviceItems) {
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width;
    const tableWidth = pageWidth - (margin * 2);

    // Table header - smaller font and spacing
    const headerY = doc.y; // Store the Y position for both headers
    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#333333');

    // Left header: DESCRIPTION
    doc.text('DESCRIPTION', margin, headerY, { width: tableWidth * 0.7 });

    // Right header: TOTAL (positioned at same Y)
    doc.text('TOTAL', margin + (tableWidth * 0.7), headerY, { width: tableWidth * 0.3, align: 'right' });

    // Header line - reduced spacing
    doc.y += 15;
    doc.strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(margin, doc.y)
      .lineTo(margin + tableWidth, doc.y)
      .stroke();

    doc.y += 10;

    // Limit service items to fit on one page (max 8 items to ensure everything fits)
    const maxItems = 8;
    const itemsToShow = serviceItems.slice(0, maxItems);
    const hasMoreItems = serviceItems.length > maxItems;

    // Service items
    itemsToShow.forEach((item) => {
      const startY = doc.y;

      // Service description
      let description = '';
      if (item.dayNumber) {
        const date = new Date();
        date.setDate(date.getDate() + (item.dayNumber - 1));
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
        description += `${monthNames[date.getMonth()]} ${date.getDate()}`
          + `${this.getOrdinalSuffix(date.getDate())}\n`;
      }

      if (item.concept) {
        description += `${item.concept}\n`;
      }

      if (item.vehicleType && item.hours) {
        description += `${item.vehicleType} - ${item.hours}h`;
      } else if (item.vehicleType) {
        description += `${item.vehicleType}`;
      }

      if (item.notes) {
        description += `\n${item.notes}`;
      }

      // Add description text and capture the Y position after it's rendered
      doc.font('Helvetica')
        .fontSize(9)
        .fillColor('#333333')
        .text(description, margin, startY, { width: tableWidth * 0.7 });

      // Calculate the actual end position of the description text
      const descriptionEndY = doc.y;

      // Position the price aligned with the last line of the description
      // Subtract the line height to align with the last text line instead of after it
      const lineHeight = 12; // Approximate line height for 9pt font
      const priceY = descriptionEndY - lineHeight;

      // Price - positioned to align with the last line of the description
      const price = `$ ${this.formatCurrency(item.total || 0)} MXN`;
      doc.fontSize(9)
        .fillColor('#333333')
        .text(price, margin + (tableWidth * 0.7), priceY, { width: tableWidth * 0.3, align: 'right' });

      // Ensure consistent spacing between items - use the description end position
      doc.y = descriptionEndY + 5;
    });

    // Add note if there are more items
    if (hasMoreItems) {
      doc.font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text(`... and ${serviceItems.length - maxItems} more item(s)`, margin, doc.y);
      doc.y += 15;
    }

    doc.y += 5;
  }

  /**
   * Add totals section.
   * @param {PDFDocument} doc - PDF document instance.
   * @param {object} totals - Totals data.
   * @example
   */
  addTotals(doc, totals) {
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width;
    const tableWidth = pageWidth - (margin * 2);

    // Totals table
    const totalsX = margin + (tableWidth * 0.6);
    const totalsWidth = tableWidth * 0.4;

    // Separator line
    doc.strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(totalsX, doc.y)
      .lineTo(margin + tableWidth, doc.y)
      .stroke();

    doc.y += 10;

    // Subtotal - smaller font and spacing
    doc.font('Helvetica')
      .fontSize(10)
      // .text('SUBTOTAL', totalsX, doc.y)
      .text(
        `SUBTOTAL  $ ${this.formatCurrency(totals.subtotal || 0)} MXN`,
        totalsX,
        doc.y,
        { width: totalsWidth, align: 'right' }
      );

    doc.y += 15;

    // Taxes
    doc// .text('TAXES', totalsX, doc.y)
      .text(
        `TAXES  $ ${this.formatCurrency(totals.iva || 0)} MXN`,
        totalsX,
        doc.y,
        { width: totalsWidth, align: 'right' }
      );

    doc.y += 15;

    // Total
    doc.font('Helvetica-Bold')
      .fontSize(11)
      // .text('TOTAL', totalsX, doc.y)
      .text(
        `TOTAL  $ ${this.formatCurrency(totals.total || 0)} MXN`,
        totalsX,
        doc.y,
        { width: totalsWidth, align: 'right' }
      );

    doc.y += 25;
  }

  /**
   * Add payment information section.
   * @param {PDFDocument} doc - PDF document instance.
   * @param {object} selectedPaymentInfo - Selected payment info (optional, falls back to default).
   * @example
   */
  addPaymentInfo(doc, selectedPaymentInfo = null) {
    const margin = doc.page.margins.left;

    // Use selected payment info if provided, otherwise use default
    const paymentInfo = selectedPaymentInfo || this.paymentInfo;

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .text('PAYMENT INFO:', margin, doc.y);

    doc.y += 15;

    // Store starting Y position for payment info
    let currentY = doc.y;

    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#333333');

    // Add payment info lines with consistent spacing
    if (paymentInfo.bank) {
      doc.text(`Bank: ${paymentInfo.bank}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.accountHolder) {
      doc.text(`Account Holder: ${paymentInfo.accountHolder}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.accountNumber) {
      doc.text(`Account Number: ${paymentInfo.accountNumber}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.routingNumber) {
      doc.text(`Routing Number: ${paymentInfo.routingNumber}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.achRoutingNumber) {
      doc.text(`ACH Routing Number: ${paymentInfo.achRoutingNumber}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.swiftCode) {
      doc.text(`SWIFT Code: ${paymentInfo.swiftCode}`, margin, currentY);
      currentY += 12;
    }

    if (paymentInfo.iban) {
      doc.text(`IBAN: ${paymentInfo.iban}`, margin, currentY);
      currentY += 12;
    }

    // Handle additional payment methods in right column
    let rightColumnY = doc.y + 10;
    const rightColumnX = margin + 280;
    let hasRightColumn = false;

    // Zelle info
    if (paymentInfo.zelle) {
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#6c5ce7')
        .text('Zelle', rightColumnX, rightColumnY);

      doc.fillColor('#333333')
        .font('Helvetica')
        .fontSize(8)
        .text(paymentInfo.zelle, rightColumnX, rightColumnY + 15);

      rightColumnY += 35;
      hasRightColumn = true;
    }

    // PayPal info
    if (paymentInfo.paypal) {
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#003087')
        .text('PayPal', rightColumnX, rightColumnY);

      doc.fillColor('#333333')
        .font('Helvetica')
        .fontSize(8)
        .text(paymentInfo.paypal, rightColumnX, rightColumnY + 15);

      rightColumnY += 35;
      hasRightColumn = true;
    }

    // Venmo info
    if (paymentInfo.venmo) {
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#008cff')
        .text('Venmo', rightColumnX, rightColumnY);

      doc.fillColor('#333333')
        .font('Helvetica')
        .fontSize(8)
        .text(paymentInfo.venmo, rightColumnX, rightColumnY + 15);

      rightColumnY += 35;
      hasRightColumn = true;
    }

    // Add notes if present
    if (paymentInfo.notes) {
      const notesY = Math.max(currentY, rightColumnY) + 10;
      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#666666')
        .text('Notes:', margin, notesY);

      doc.font('Helvetica')
        .fontSize(8)
        .fillColor('#333333')
        .text(paymentInfo.notes, margin, notesY + 12, { width: 400 });

      currentY = notesY + 25;
    }

    // Update doc.y to the end of the payment info section
    const newY = Math.max(currentY, hasRightColumn ? rightColumnY : currentY) + 20;
    /* eslint-disable-next-line no-param-reassign */
    doc.y = newY;
  }

  /**
   * Add footer section.
   * @param {PDFDocument} doc - PDF document instance.
   * @example
   */
  addFooter(doc) {
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width;

    // Thank you message - smaller
    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#333333')
      .text('THANK YOU FOR YOUR PREFERENCE!', margin, doc.y, { width: pageWidth - (margin * 2), align: 'center' });

    doc.y += 15;

    // Website - smaller
    doc.font('Helvetica')
      .fontSize(8)
      .text(this.companyWebsite, margin, doc.y, { width: pageWidth - (margin * 2), align: 'center' });
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
