/**
 * PdfRenderService - Renders a public URL to PDF using headless Chrome (puppeteer).
 * Used to export public quote / reservation views as high-quality, vector PDFs.
 *
 * Created by Denisse Maldonado.
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../infrastructure/logger');

// Single browser instance reused across requests to avoid the ~500ms cold-start.
// Lazy-launched on first use; relaunched if it crashes.
let browserPromise = null;

// Puppeteer's header/footer templates render in an isolated document that can't
// see the page's @font-face rules or load external font files, so a bare
// font-family falls back to a system font and looks foreign next to the quote
// (which uses Myriad Pro). We embed Myriad Pro as base64 @font-face directly in
// the footer template. Read once and cached — the .otf is ~95KB, encoded once.
let footerFontFaceCss = null;
/**
 * Build (and cache) the base64-embedded @font-face CSS for the PDF footer so it
 * renders in Myriad Pro like the rest of the quote. Read from disk once.
 * @returns {string} `@font-face` rules, or '' if the font files can't be read.
 * @example
 *   const css = getFooterFontFaceCss(); // "@font-face{font-family:'Myriad Pro';...}"
 */
function getFooterFontFaceCss() {
  if (footerFontFaceCss !== null) return footerFontFaceCss;
  const fonts = [
    { file: 'MyriadPro-Regular.otf', weight: 400 },
    { file: 'MyriadPro-Semibold.otf', weight: 600 },
  ];
  try {
    footerFontFaceCss = fonts.map(({ file, weight }) => {
      // `file` comes from the hardcoded list above (no user input), so the path
      // is safe — silence the non-literal-fs-filename security rule.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const b64 = fs.readFileSync(
        path.join(__dirname, '../../../public/fonts', file)
      ).toString('base64');
      return `@font-face{font-family:'Myriad Pro';font-style:normal;font-weight:${weight};`
        + `src:url(data:font/otf;base64,${b64}) format('opentype');}`;
    }).join('');
  } catch (e) {
    // Font files missing → fall back to the system stack (no embedded faces).
    logger.warn('PdfRenderService: could not embed footer fonts', { message: e.message });
    footerFontFaceCss = '';
  }
  return footerFontFaceCss;
}

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
      <style>${getFooterFontFaceCss()}</style>
      <div style="width:100%; box-sizing:border-box; padding:0 ${margin}; font-family:'Myriad Pro','Segoe UI',Tahoma,Geneva,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
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
    // ── Height-aware day pagination ──────────────────────────────────────────
    // Tag each .day-card that fits within a single printed page with
    // `.pdf-keep-whole` so the CSS `break-inside: avoid` keeps it whole (a short
    // day jumps to the next page intact instead of splitting mid-day). Days taller
    // than a page stay untagged so they flow and break BETWEEN services — otherwise
    // an oversized day forces a blank first page. The FIRST day is also left
    // untagged so it starts right under the header and fills page 1 (breaking
    // between services if needed) instead of jumping whole and leaving page 1 with
    // only the header. Done here, after fonts/layout
    // have settled, comparing against the printable page geometry: the content
    // aspect ratio is invariant under puppeteer's width-based scale to the paper,
    // so maxHeightPx = referenceWidthPx * aspect holds in the live layout's units.
    try {
      const pageDims = { Letter: [8.5, 11], A4: [8.27, 11.69], Legal: [8.5, 14] };
      const [pageWIn, pageHIn] = pageDims[format] || pageDims.Letter;
      /**
       * Parse a CSS length (mm/cm/in/px or unitless) into inches.
       * @param {string} v - CSS length, e.g. '8mm', '0.5in', '12'.
       * @returns {number} The length in inches (0 if unparseable).
       * @example toIn('8mm') // 0.3149...
       */
      const toIn = (v) => {
        if (typeof v !== 'string') return 0;
        const m = v.match(/^([\d.]+)\s*(mm|cm|in|px)?$/);
        if (!m) return 0;
        const n = parseFloat(m[1]);
        switch (m[2]) {
          case 'mm': return n / 25.4;
          case 'cm': return n / 2.54;
          case 'px': return n / 96;
          default: return n; // 'in' or unitless
        }
      };
      const printableWIn = pageWIn - toIn(marginObj.left) - toIn(marginObj.right);
      const printableHIn = pageHIn - toIn(marginObj.top) - toIn(marginObj.bottom);
      const aspect = printableHIn / printableWIn;
      await page.evaluate((aspectRatio) => {
        /* eslint-disable no-undef */
        const refWidth = document.documentElement.clientWidth;
        const maxHeight = refWidth * aspectRatio * 0.96; // small headroom for rounding
        document.querySelectorAll('.day-card').forEach((el, i) => {
          // The FIRST day is never tagged: let it start right below the header on
          // page 1 and break BETWEEN services if it overflows, so page 1 isn't left
          // near-empty (header only) while the day jumps whole to page 2. Later days
          // keep the whole-day protection (jump intact rather than split).
          el.classList.toggle('pdf-keep-whole', i > 0 && el.offsetHeight <= maxHeight);
        });
        /* eslint-enable no-undef */
      }, aspect);
    } catch (e) { /* noop — fall back to plain per-service breaks */ }
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
