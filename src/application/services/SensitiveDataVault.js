/**
 * SensitiveDataVault - The single public API for protecting sensitive fields.
 *
 * Models call only this. It owns crypto (via the envelope engine), authorization
 * (default-deny reveal), masking, and audit, so models stay thin. Routes by the
 * field's storageMode: 'encrypt' keeps ciphertext on the business row (passport
 * today); 'tokenize' segregates ciphertext into a vault collection (cards, later).
 *
 * PCI DSS: 3.5 (strong crypto + managed keys), 3.4 (masking), 7 (least-privilege
 * reveal), 10 (audit every access).
 */

const logger = require('../../infrastructure/logger');
const cipher = require('../../infrastructure/crypto/envelopeCipher');
const dkm = require('../../infrastructure/crypto/DataKeyManager');
const { maskByRule } = require('../../infrastructure/crypto/fieldMasking');
const { getPolicy } = require('./SensitiveDataPolicy');

function auditResource(fieldKey, recordId) {
  return recordId ? `${fieldKey}:${recordId}` : fieldKey;
}

/**
 * Encrypt a plaintext value for storage. Returns the versioned ciphertext to put on
 * the business row (encrypt-mode). Refuses forbidden SAD via the policy resolver.
 * @param {string} fieldKey - e.g. 'client.passport'.
 * @param {string} plaintext - Raw value.
 * @returns {Promise<string>} Versioned ciphertext.
 */
async function encryptField(fieldKey, plaintext) {
  const policy = getPolicy(fieldKey);
  if (policy.storageMode !== 'encrypt') {
    throw new Error(`encryptField is only for encrypt-mode fields; ${fieldKey} is ${policy.storageMode}`);
  }
  const { keyId, dek } = await dkm.getActiveDek(policy.dataClass);
  return cipher.encryptWithDek(plaintext, dek, keyId, policy.aad);
}

/**
 * Whether a requesting user may reveal cleartext for this field. Permission-based
 * (AmexingUser.hasPermission) with a role fallback; default-deny.
 * @param {object} policy
 * @param {object} requestingUser
 * @returns {Promise<boolean>}
 */
async function canReveal(policy, requestingUser) {
  if (!requestingUser) return false;

  if (typeof requestingUser.hasPermission === 'function' && policy.revealPermission) {
    try {
      if (await requestingUser.hasPermission(policy.revealPermission)) return true;
    } catch (error) {
      logger.warn('SensitiveDataVault: hasPermission check failed, falling back to roles', { error: error.message });
    }
  }

  const role = requestingUser.role || (requestingUser.get && requestingUser.get('role'));
  return Array.isArray(policy.revealRoles) && policy.revealRoles.includes(role);
}

/**
 * Decrypt cleartext, gated by authorization and always audited (default-deny).
 * @param {string} fieldKey
 * @param {string} ciphertext - The stored versioned ciphertext.
 * @param {object} ctx - { user, recordId } — user requesting, record being read.
 * @returns {Promise<string|null>} Cleartext, or null if denied / empty.
 */
async function decryptField(fieldKey, ciphertext, ctx = {}) {
  const policy = getPolicy(fieldKey);
  const { user, recordId } = ctx;

  const userId = user && (user.id || (user.get && user.get('id'))) || 'unknown';
  const allowed = await canReveal(policy, user);

  logger.logDataAccess(userId, auditResource(fieldKey, recordId), 'REVEAL', allowed);
  if (!allowed || !ciphertext) return null;

  try {
    const keyId = cipher.parseKeyId(ciphertext);
    const dek = await dkm.getDekById(keyId);
    return cipher.decryptEnvelope(ciphertext, dek, policy.aad);
  } catch (error) {
    logger.warn('SensitiveDataVault: decrypt failed', { fieldKey, error: error.message });
    return null;
  }
}

/**
 * Masked value for display. Decrypts internally (no authz needed — output is masked)
 * and emits a low-severity audit event. Returns '' when there is no stored value.
 * @param {string} fieldKey
 * @param {string} ciphertext
 * @param {object} ctx - { user, recordId } (optional, for audit).
 * @returns {Promise<string>}
 */
async function maskField(fieldKey, ciphertext, ctx = {}) {
  const policy = getPolicy(fieldKey);
  if (!ciphertext) return '';

  try {
    const keyId = cipher.parseKeyId(ciphertext);
    const dek = await dkm.getDekById(keyId);
    const plaintext = cipher.decryptEnvelope(ciphertext, dek, policy.aad);
    const userId = (ctx.user && (ctx.user.id || (ctx.user.get && ctx.user.get('id')))) || 'system';
    logger.logDataAccess(userId, auditResource(fieldKey, ctx.recordId), 'DESCRIBE', true);
    return maskByRule(policy.maskRule, plaintext);
  } catch (error) {
    logger.warn('SensitiveDataVault: mask failed', { fieldKey, error: error.message });
    return '';
  }
}

module.exports = {
  encryptField,
  decryptField,
  maskField,
};
