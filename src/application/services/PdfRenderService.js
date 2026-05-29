/**
 * PdfRenderService - Renders a public URL to PDF using headless Chrome (puppeteer).
 * Used to export public quote / reservation views as high-quality, vector PDFs.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const logger = require('../../infrastructure/logger');

// Single browser instance reused across requests to avoid the ~500ms cold-start.
// Lazy-launched on first use; relaunched if it crashes.
let browserPromise = null;

/**
 *
 * @example
 */
async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b && b.connected !== false) return b;
    } catch (e) {
      browserPromise = null;
    }
  }
  // eslint-disable-next-line global-require, import/no-unresolved
  const puppeteer = require('puppeteer');
  browserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=medium',
    ],
  });
  const b = await browserPromise;
  b.on('disconnected', () => { browserPromise = null; });
  return b;
}

/**
 * Render a URL to a PDF Buffer.
 * @param {string} url - Fully-qualified URL the headless browser will navigate to.
 * @param {object} [options]
 * @param {object} [options.cookies] - Optional cookies to set before navigating (for auth).
 * @param {string} [options.format]
 * @param {string} [options.margin]
 * @returns {Promise<Buffer>}
 * @example
 *   const buf = await renderUrlToPdf('http://localhost:1337/reservations/MAY-2605-001');
 */
async function renderUrlToPdf(url, options = {}) {
  const {
    format = 'Letter',
    margin = '10mm',
    cookies = null,
  } = options;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    if (cookies && Array.isArray(cookies) && cookies.length > 0) {
      await page.setCookie(...cookies);
    }
    // 'networkidle0' waits for all network activity to settle — important so
    // the unified renderer has loaded data + presigned image URLs have arrived.
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    // Wait for the summary content to render (the renderer toggles display:'' on load).
    try {
      // The arrow function below runs INSIDE the headless browser page, where `document`
      // is the global. Node-side eslint doesn't know that, so silence the rule.
      await page.waitForFunction(
        /* eslint-disable-next-line no-undef */
        () => { const el = document.getElementById('summaryContent'); return el && el.offsetHeight > 100; },
        { timeout: 15000 }
      );
    } catch (e) {
      logger.warn('PdfRenderService: summaryContent never grew, proceeding anyway', {
        url, message: e.message,
      });
    }
    // NOTE: do NOT call page.emulateMediaType('print') — the existing @media print rules
    // in the public views hide the header/footer which collapses the whole layout to nothing
    // (puppeteer ends up generating a blank 953-byte PDF). Screen media keeps the layout intact;
    // page-break behavior is still respected via the CSS `page-break-inside: avoid` rules in
    // `.pdf-export-mode` (which we toggle on via the `?pdf=1` query param).
    await page.emulateMediaType('screen');
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: margin, bottom: margin, left: margin, right: margin,
      },
    });
    return pdfBuffer;
  } finally {
    try { await page.close(); } catch (e) { /* noop */ }
  }
}

module.exports = { renderUrlToPdf };
