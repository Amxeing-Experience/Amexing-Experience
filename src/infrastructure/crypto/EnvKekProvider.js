/**
 * EnvKekProvider - Interim KEK provider backed by an env variable.
 *
 * The KEK is a base64 32-byte value in KEK_MASTER (falls back to ENCRYPTION_KEY so
 * the system runs before a dedicated KEK is provisioned). It wraps/unwraps DEKs with
 * AES-256-GCM. This is the acknowledged plaintext-KEK-in-env interim: it achieves
 * DEK/KEK separation (the DEK is generated, wrapped, and stored apart from the data)
 * but the KEK itself is not yet in an HSM — that is the AWS KMS migration (Phase 4).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('kek-wrap');

class EnvKekProvider {
  constructor() {
    const raw = process.env.KEK_MASTER || process.env.ENCRYPTION_KEY;
    if (!raw) throw new Error('KEK_MASTER (or ENCRYPTION_KEY) is required for the env KEK provider');
    this.kek = Buffer.from(raw, 'base64');
    if (this.kek.length !== 32) {
      throw new Error('KEK must decode to 32 bytes (base64)');
    }
    // 'env:v1' for a dedicated KEK_MASTER, 'env:legacy' when still falling back.
    this.ref = process.env.KEK_MASTER ? 'env:v1' : 'env:legacy';
  }

  /**
   * Wrap (encrypt) a raw DEK under the KEK.
   * @param {Buffer} dek - 32-byte DEK.
   * @returns {Promise<string>} "ivHex:authTagHex:ctHex".
   * @example
   */
  async wrap(dek) {
    if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('DEK must be a 32-byte Buffer');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, this.kek, iv);
    cipher.setAAD(AAD);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ct.toString('hex')}`;
  }

  /**
   * Unwrap (decrypt) a wrapped DEK back to its raw bytes.
   * @param {string} wrapped - "ivHex:authTagHex:ctHex".
   * @returns {Promise<Buffer>} 32-byte DEK.
   * @example
   */
  async unwrap(wrapped) {
    const [ivHex, authTagHex, ctHex] = String(wrapped).split(':');
    if (!ivHex || !authTagHex || !ctHex) throw new Error('Invalid wrapped DEK format');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.kek, Buffer.from(ivHex, 'hex'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  }

  kekRef() {
    return this.ref;
  }
}

module.exports = EnvKekProvider;
