/**
 * SensitiveDataPolicy - Central registry of protected fields and their handling.
 *
 * Each fieldKey declares its data class (key lineage), AAD (crypto context binding),
 * how it is masked, who may reveal it, and its cryptoperiod. Card fields are
 * pre-declared for the roadmap but use tokenize-mode (built later). Sensitive
 * authentication data (CVV/track/PIN) is in a FORBIDDEN set that hard-throws if any
 * code ever tries to encrypt or tokenize it — SAD is un-storable by construction
 * (PCI DSS 3.3.1).
 */

// fieldKey -> policy
const FIELDS = {
  'client.passport': {
    dataClass: 'client.passport',
    aad: 'client.passport',
    maskRule: 'last4',
    storageMode: 'encrypt',
    revealPermission: 'sensitive-data:reveal-passport',
    revealRoles: ['admin', 'superadmin'], // fallback while the permission is being rolled out
    isSAD: false,
    retentionDays: 365 * 5,
  },
  // Roadmap (cards) — tokenize-mode and PAN masking are implemented in a later phase.
  'client.pan': {
    dataClass: 'client.pan',
    aad: 'client.pan',
    maskRule: 'pan',
    storageMode: 'tokenize',
    revealPermission: 'sensitive-data:reveal-pan',
    revealRoles: [],
    isSAD: false,
    retentionDays: 365,
  },
};

// Sensitive Authentication Data: never stored, never encrypted, never tokenized.
const FORBIDDEN_FIELD_KEYS = new Set([
  'client.cvv', 'client.cvc', 'client.cvv2', 'card.cvv', 'card.cvc',
  'client.track', 'card.track', 'card.track1', 'card.track2',
  'client.pin', 'card.pin', 'card.pinblock',
]);

/**
 * Resolve a field policy, refusing forbidden SAD fields outright.
 * @param {string} fieldKey
 * @returns {object} The policy for the field.
 */
function getPolicy(fieldKey) {
  if (FORBIDDEN_FIELD_KEYS.has(fieldKey)) {
    throw new Error(`Forbidden sensitive authentication data: ${fieldKey} must never be stored (PCI DSS 3.3.1)`);
  }
  const policy = Object.prototype.hasOwnProperty.call(FIELDS, fieldKey) ? FIELDS[fieldKey] : null;
  if (!policy) throw new Error(`Unknown sensitive field: ${fieldKey}`);
  return policy;
}

function isForbidden(fieldKey) {
  return FORBIDDEN_FIELD_KEYS.has(fieldKey);
}

module.exports = {
  getPolicy,
  isForbidden,
  FORBIDDEN_FIELD_KEYS,
};
