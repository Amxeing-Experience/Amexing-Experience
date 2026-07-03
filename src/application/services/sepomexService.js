/**
 * SepomexService - Official SEPOMEX (Correos de México) postal-code lookup, self-hosted from a
 * compressed dataset bundled in the repo (src/infrastructure/data/sepomex-cp.json.gz). Resolves a
 * 5-digit CP to its estado, municipio and the list of colonias. Loaded lazily and cached in memory.
 *
 * Dataset shape: { "<cp>": ["<estado>", "<municipio>", ["<colonia>", ...]] }.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const logger = require('../../infrastructure/logger');

const DATA_FILE = path.join(__dirname, '..', '..', 'infrastructure', 'data', 'sepomex-cp.json.gz');
let data = null;

/**
 *
 * @example
 */
function load() {
  if (data) return data;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const gz = fs.readFileSync(DATA_FILE);
    data = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    logger.info('SEPOMEX dataset loaded', { codes: Object.keys(data).length });
  } catch (error) {
    logger.error('Failed to load SEPOMEX dataset', { error: error.message });
    data = {};
  }
  return data;
}

/**
 * Look up a Mexican postal code.
 * @param {string} cp - 5-digit postal code.
 * @returns {{estado: string, municipio: string, colonias: string[]}|null} Match or null.
 * @example
 */
function lookup(cp) {
  const code = String(cp || '').replace(/\D/g, '').slice(0, 5);
  if (code.length !== 5) return null;
  const entry = load()[code];
  if (!entry) return null;
  return { estado: entry[0], municipio: entry[1], colonias: entry[2] || [] };
}

module.exports = { lookup };
