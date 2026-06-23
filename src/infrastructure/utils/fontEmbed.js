/**
 * Font Embed Utility
 * Builds an inline (base64) @font-face stylesheet for Arpona so PDF templates render the
 * font reliably. Declared under its own family ('ArponaPDF') so it never competes with the
 * .otf faces in fonts.css — headless Chrome embeds the TTF outlines (FontFile2) in the PDF,
 * whereas the .otf (CFF) ones render on screen but get dropped from the PDF. Read from disk
 * once and cached for the process lifetime.
 * @module infrastructure/utils/fontEmbed
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// TTF (not OTF): headless Chrome embeds TrueType outlines (FontFile2) in generated PDFs
// but discards CFF/OpenType (.otf) outlines, so an .otf cover font renders on screen yet
// falls back to a system font in the PDF. The TTFs are converted from the OTFs.
const FONTS_DIR = path.join(__dirname, '..', '..', '..', 'public', 'fonts', 'ttf');

const ARPONA_FACES = [
  { file: 'Arpona Light.ttf', weight: 300, format: 'truetype' },
  { file: 'Arpona Regular.ttf', weight: 400, format: 'truetype' },
  { file: 'Arpona Medium.ttf', weight: 500, format: 'truetype' },
  { file: 'Arpona Bold.ttf', weight: 700, format: 'truetype' },
];

const MYRIAD_FACES = [
  { file: 'MyriadPro-Light.ttf', weight: 300, format: 'truetype' },
  { file: 'MyriadPro-Regular.ttf', weight: 400, format: 'truetype' },
  { file: 'MyriadPro-Semibold.ttf', weight: 600, format: 'truetype' },
  { file: 'MyriadPro-Bold.ttf', weight: 700, format: 'truetype' },
];

let arponaCss = null;
let myriadCss = null;

/**
 * Inline @font-face CSS for the Arpona family (base64, no network fetch).
 * @returns {string} CSS string, or '' if the font files cannot be read.
 * @example
 */
function getArponaEmbedCss() {
  if (arponaCss !== null) return arponaCss;
  try {
    arponaCss = ARPONA_FACES.map((f) => {
      // Fixed filenames from a hardcoded list under a fixed dir — not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const b64 = fs.readFileSync(path.join(FONTS_DIR, f.file)).toString('base64');
      return `@font-face{font-family:'ArponaPDF';src:url(data:font/ttf;base64,${b64}) format('${f.format}');font-weight:${f.weight};font-style:normal;font-display:block;}`;
    }).join('');
  } catch (error) {
    logger.warn('Could not embed Arpona fonts; PDF will fall back to fonts.css', { error: error.message });
    arponaCss = '';
  }
  return arponaCss;
}

/**
 * Inline @font-face CSS for the Myriad Pro family (base64, no network fetch).
 * Declared as 'MyriadPDF' (TTF) so it embeds in generated PDFs, where the .otf
 * faces from fonts.css are dropped by headless Chrome.
 * @returns {string} CSS string, or '' if the font files cannot be read.
 * @example
 * const css = getMyriadEmbedCss();
 */
function getMyriadEmbedCss() {
  if (myriadCss !== null) return myriadCss;
  try {
    myriadCss = MYRIAD_FACES.map((f) => {
      // Fixed filenames from a hardcoded list under a fixed dir — not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const b64 = fs.readFileSync(path.join(FONTS_DIR, f.file)).toString('base64');
      return `@font-face{font-family:'MyriadPDF';src:url(data:font/ttf;base64,${b64}) format('${f.format}');font-weight:${f.weight};font-style:normal;font-display:block;}`;
    }).join('');
  } catch (error) {
    logger.warn('Could not embed Myriad fonts; PDF will fall back to fonts.css', { error: error.message });
    myriadCss = '';
  }
  return myriadCss;
}

module.exports = { getArponaEmbedCss, getMyriadEmbedCss };
