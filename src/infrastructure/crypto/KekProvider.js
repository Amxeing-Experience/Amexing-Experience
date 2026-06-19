/**
 * KekProvider - The key-encryption-key seam.
 *
 * A KEK only ever wraps/unwraps DEKs; it never touches record data. Abstracting
 * it here means the migration to AWS KMS is a single new provider + an env switch
 * (KEK_PROVIDER), with no change to ciphertext or stored DEKs.
 *
 * Contract:
 *   wrap(dek: Buffer) -> Promise<string>   wrapped DEK, base64/opaque
 *   unwrap(wrapped: string) -> Promise<Buffer>   the 32-byte DEK
 *   kekRef() -> string   identifier of the KEK in use (e.g. 'env:v1', a CMK ARN)
 */

let cached = null;

/**
 * Resolve the configured KEK provider (singleton). Defaults to the env-backed
 * provider; set KEK_PROVIDER=aws-kms once AwsKmsKekProvider is implemented.
 * @returns {object} A KEK provider.
 */
function getKekProvider() {
  if (cached) return cached;

  const provider = (process.env.KEK_PROVIDER || 'env').toLowerCase();
  switch (provider) {
    case 'env': {
      const EnvKekProvider = require('./EnvKekProvider');
      cached = new EnvKekProvider();
      break;
    }
    // case 'aws-kms': added in Phase 4 (cards). Implement AwsKmsKekProvider then.
    default:
      throw new Error(`Unknown KEK_PROVIDER: ${provider}`);
  }
  return cached;
}

// Test/rotation hook to force re-resolution after env changes.
function resetKekProvider() {
  cached = null;
}

module.exports = { getKekProvider, resetKekProvider };
