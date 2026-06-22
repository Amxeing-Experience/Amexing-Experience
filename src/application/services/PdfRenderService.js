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
    margin = '8mm',
    cookies = null,
    footer = true,
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
    // Wait for @font-face fonts to finish loading so the PDF embeds them instead of
    // substituting a system font. Templates that embed fonts (e.g. the itinerary, with
    // base64 Arpona) set window.__fontsReady after explicitly loading them; wait for that
    // when present, otherwise fall back to the generic fonts.ready. (Runs in the page.)
    try {
      await page.evaluate(async () => {
        /* eslint-disable no-undef, no-underscore-dangle */
        await document.fonts.ready;
        if (window.__fontsReady !== undefined) {
          const start = Date.now();
          while (!window.__fontsReady && Date.now() - start < 5000) {
            await new Promise((resolve) => { setTimeout(resolve, 50); });
          }
        }
        /* eslint-enable no-undef, no-underscore-dangle */
      });
    } catch (e) { /* noop */ }
    // Running footer on every page: brand link + page numbers. It softens page breaks
    // (each page reads as intentional rather than an arbitrary chop) and surfaces
    // amexingexperience.com in the PDF, matching the on-screen public view. Puppeteer
    // needs `displayHeaderFooter` plus room in the bottom margin, so we widen `bottom`
    // past the body `margin`. The empty header template suppresses Puppeteer's default
    // date/title header. Inline font-size is required — the default is 0.
    // Per-page letterhead footer: brand + website + page number. Needs a taller bottom margin.
    const footerTemplate = `
      <div style="width:100%; box-sizing:border-box; padding:0 ${margin}; font-family:'Segoe UI',Tahoma,Geneva,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        <div style="border-top:1px solid #d8dac9; padding-top:6px; display:flex; justify-content:space-between; align-items:flex-end;">
          <div style="text-align:left; line-height:1.35;">
            <div style="font-size:11px; font-weight:600; letter-spacing:2.5px; color:#969b81; text-transform:uppercase;">Amexing Experience</div>
            <div style="font-size:7.5px; color:#9aa0a6; letter-spacing:0.5px; margin-top:2px;">amexingexperience.com</div>
          </div>
          <div style="font-size:8px; color:#9aa0a6; text-align:right; padding-bottom:1px;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>
        </div>
      </div>`;
    // `margin` may be a string (all sides) or a per-side object. With the footer off,
    // the bottom margin matches the rest (no room reserved for the footer).
    const marginObj = typeof margin === 'object'
      ? margin
      : {
        top: margin, bottom: footer ? '22mm' : margin, left: margin, right: margin,
      };
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: footer,
      headerTemplate: '<span></span>',
      footerTemplate: footer ? footerTemplate : '<span></span>',
      margin: marginObj,
    });
    return pdfBuffer;
  } finally {
    try { await page.close(); } catch (e) { /* noop */ }
  }
}

module.exports = { renderUrlToPdf };
