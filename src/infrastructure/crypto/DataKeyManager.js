/**
 * DataKeyManager - DEK lifecycle for the envelope-encryption engine.
 *
 * Generates per-data-class DEKs, wraps them with the KEK (via KekProvider) and
 * stores only the wrapped form in the DataKey collection. Unwrapped DEKs live only
 * in a short-TTL in-memory cache. Every KEK unwrap is audited (PCI DSS 10.2.1.6).
 *
 * getActiveDek(dataClass)  -> { keyId, dek }   (bootstraps the first DEK)
 * getDekById(keyId)        -> Buffer            (for decrypting existing records)
 * rotateDek(dataClass)     -> { keyId }         (new active; previous -> retiring)
 * retireDek(keyId).
 */

const crypto = require('crypto');
const logger = require('../logger');
const DataKey = require('../../domain/models/DataKey');
const { getKekProvider } = require('./KekProvider');

const DEK_CACHE_TTL_MS = 5 * 60 * 1000;

// keyId -> { dek: Buffer, expires: number }
const dekCache = new Map();

// Date.now is fine at runtime; isolated here so it is the only time source.
/**
 *
 * @example
 */
function cacheNow() {
  return Date.now();
}

/**
 *
 * @param keyId
 * @example
 */
function cacheGet(keyId) {
  const entry = dekCache.get(keyId);
  if (!entry) return null;
  if (entry.expires < cacheNow()) {
    dekCache.delete(keyId);
    return null;
  }
  return entry.dek;
}

/**
 *
 * @param keyId
 * @param dek
 * @example
 */
function cacheSet(keyId, dek) {
  dekCache.set(keyId, { dek, expires: cacheNow() + DEK_CACHE_TTL_MS });
}

/**
 *
 * @param dataClass
 * @example
 */
function makeKeyId(dataClass) {
  return `${dataClass}.${crypto.randomBytes(8).toString('hex')}`;
}

/**
 *
 * @param dataKeyRow
 * @example
 */
async function unwrapAndCache(dataKeyRow) {
  const keyId = dataKeyRow.getKeyId();
  const cached = cacheGet(keyId);
  if (cached) return cached;

  const kek = getKekProvider();
  const dek = await kek.unwrap(dataKeyRow.getWrappedDek());
  cacheSet(keyId, dek);
  // Audit every key-material access (10.2.1.6).
  logger.logDataAccess('system', `datakey:${keyId}`, 'UNWRAP', true);
  return dek;
}

/**
 * Active DEK for a data class, generating and persisting the first one if needed.
 * @param {string} dataClass - E.g. 'client.passport'.
 * @returns {Promise<{keyId: string, dek: Buffer}>}
 * @example
 */
async function getActiveDek(dataClass) {
  let row = await DataKey.findActive(dataClass);
  if (!row) {
    const kek = getKekProvider();
    const dek = crypto.randomBytes(32);
    const keyId = makeKeyId(dataClass);
    const wrappedDek = await kek.wrap(dek);
    row = DataKey.create({
      keyId, dataClass, wrappedDek, kekRef: kek.kekRef(), status: 'active',
    });
    await row.save(null, { useMasterKey: true });
    cacheSet(keyId, dek);
    logger.info('DataKeyManager: bootstrapped active DEK', { dataClass, keyId, kekRef: kek.kekRef() });
    return { keyId, dek };
  }
  const dek = await unwrapAndCache(row);
  return { keyId: row.getKeyId(), dek };
}

/**
 * DEK for a specific keyId (to decrypt an existing record). Works regardless of
 * the key's status (active or retiring).
 * @param {string} keyId
 * @returns {Promise<Buffer>}
 * @example
 */
async function getDekById(keyId) {
  const cached = cacheGet(keyId);
  if (cached) return cached;
  const row = await DataKey.findByKeyId(keyId);
  if (!row) throw new Error(`Unknown DEK keyId: ${keyId}`);
  return unwrapAndCache(row);
}

/**
 * Rotate: mint a new active DEK for the class, demote the previous active to
 * 'retiring' (decrypt-only). Records are re-encrypted off the retiring key by the
 * rotation script, after which retireDek is called.
 * @param {string} dataClass
 * @returns {Promise<{keyId: string}>}
 * @example
 */
async function rotateDek(dataClass) {
  const current = await DataKey.findActive(dataClass);

  const kek = getKekProvider();
  const dek = crypto.randomBytes(32);
  const keyId = makeKeyId(dataClass);
  const wrappedDek = await kek.wrap(dek);
  const fresh = DataKey.create({
    keyId, dataClass, wrappedDek, kekRef: kek.kekRef(), status: 'active',
  });
  await fresh.save(null, { useMasterKey: true });
  cacheSet(keyId, dek);

  if (current) {
    current.setStatus('retiring');
    await current.save(null, { useMasterKey: true });
  }
  logger.info('DataKeyManager: rotated DEK', { dataClass, newKeyId: keyId, retiredKeyId: current ? current.getKeyId() : null });
  return { keyId };
}

/**
 * Mark a retiring DEK as fully retired (no record references it).
 * @param {string} keyId
 * @example
 */
async function retireDek(keyId) {
  const row = await DataKey.findByKeyId(keyId);
  if (!row) return;
  row.setStatus('retired');
  await row.save(null, { useMasterKey: true });
  dekCache.delete(keyId);
  logger.info('DataKeyManager: retired DEK', { keyId });
}

/**
 *
 * @example
 */
function clearCache() {
  dekCache.clear();
}

module.exports = {
  getActiveDek,
  getDekById,
  rotateDek,
  retireDek,
  clearCache,
};
