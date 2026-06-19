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

let arponaCss = null;

/**
 * Inline @font-face CSS for the Arpona family (base64, no network fetch).
 * @returns {string} CSS string, or '' if the font files cannot be read.
 */
function getArponaEmbedCss() {
  if (arponaCss !== null) return arponaCss;
  try {
    arponaCss = ARPONA_FACES.map((f) => {
      const b64 = fs.readFileSync(path.join(FONTS_DIR, f.file)).toString('base64');
      return `@font-face{font-family:'ArponaPDF';src:url(data:font/ttf;base64,${b64}) format('${f.format}');font-weight:${f.weight};font-style:normal;font-display:block;}`;
    }).join('');
  } catch (error) {
    logger.warn('Could not embed Arpona fonts; PDF will fall back to fonts.css', { error: error.message });
    arponaCss = '';
  }
  return arponaCss;
}

module.exports = { getArponaEmbedCss };
