/**
 * EnvelopeCipher - Low-level AES-256-GCM with a versioned, self-describing format.
 *
 * Ciphertext layout: "v1:<keyId>:<ivHex>:<authTagHex>:<ctHex>".
 * Embedding the keyId lets multiple DEK versions coexist, which is what makes
 * incremental key rotation (decrypt-old / encrypt-new) possible. The DEK is
 * supplied by the caller (DataKeyManager); this module never touches key storage.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Encrypt plaintext with a raw 32-byte DEK.
 * @param {string} plaintext - Value to encrypt.
 * @param {Buffer} dek - 32-byte data-encryption key.
 * @param {string} keyId - Identifier of the DEK (embedded in the output).
 * @param {string} aad - Context string bound into the ciphertext (e.g. 'client.passport').
 * @returns {string} Versioned ciphertext.
 * @example
 */
function encryptWithDek(plaintext, dek, keyId, aad) {
  if (typeof plaintext !== 'string') throw new Error('Plaintext must be a string');
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('DEK must be a 32-byte Buffer');
  if (!keyId) throw new Error('keyId is required');

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  cipher.setAAD(Buffer.from(aad || ''));
  let ct = cipher.update(plaintext, 'utf8', 'hex');
  ct += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${VERSION}:${keyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${ct}`;
}

/**
 * Decrypt versioned ciphertext. The DEK must correspond to the embedded keyId
 * (the caller resolves it via parseKeyId + DataKeyManager).
 * @param {string} envelope - "v1:keyId:iv:tag:ct".
 * @param {Buffer} dek - 32-byte DEK matching the embedded keyId.
 * @param {string} aad - Same AAD used at encryption time.
 * @returns {string} Plaintext.
 * @example
 */
function decryptEnvelope(envelope, dek, aad) {
  const parts = String(envelope).split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Invalid or unsupported envelope format');
  }
  const [, , ivHex, authTagHex, ct] = parts;
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('DEK must be a 32-byte Buffer');

  const decipher = crypto.createDecipheriv(ALGORITHM, dek, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(Buffer.from(aad || ''));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let plaintext = decipher.update(ct, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Extract the keyId from a versioned ciphertext (used to pick the right DEK).
 * @param {string} envelope
 * @returns {string|null} KeyId or null if the format is not recognized.
 * @example
 */
function parseKeyId(envelope) {
  const parts = String(envelope).split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  return parts[1];
}

/**
 * Whether a value is in the current versioned format (vs. A legacy ciphertext).
 * @param {string} value
 * @returns {boolean}
 * @example
 */
function isVersioned(value) {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

module.exports = {
  VERSION,
  encryptWithDek,
  decryptEnvelope,
  parseKeyId,
  isVersioned,
};
