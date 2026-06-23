/**
 * rotate-dek - Rotate the data-encryption key for a sensitive field and re-encrypt
 * its records (PCI DSS 3.7.4 / 3.7.5: real re-protection, not KEK-only rotation).
 *
 * Mints a new active DEK, demotes the previous one to 'retiring' (decrypt-only), walks
 * the records still encrypted under any retiring key, decrypts + re-encrypts them under
 * the new active key, then retires keys no record references. Idempotent and resumable:
 * records already on the active key are skipped, so re-running continues where it left off.
 *
 *   NODE_ENV=staging node scripts/global/setup/rotate-dek.js client.passport
 *
 * Each field maps to its model + column via FIELD_TARGETS below.
 */

require('dotenv').config({ path: `./environments/.env.${process.env.NODE_ENV || 'development'}` });
const Parse = require('parse/node');

Parse.initialize(process.env.PARSE_APP_ID, null, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

const cipher = require('../../../src/infrastructure/crypto/envelopeCipher');
const dkm = require('../../../src/infrastructure/crypto/DataKeyManager');
const DataKey = require('../../../src/domain/models/DataKey');
const { getPolicy } = require('../../../src/application/services/SensitiveDataPolicy');

// Where each encrypt-mode field is stored: Parse class + ciphertext column.
const FIELD_TARGETS = {
  'client.passport': { className: 'Client', column: 'passportNumberEncrypted' },
};

const BATCH = 100;

async function reencryptRecords(fieldKey, target, activeKeyId, dek, policy) {
  let processed = 0;
  let reencrypted = 0;
  let skip = 0;

  for (;;) {
    const query = new Parse.Query(target.className);
    query.exists(target.column);
    query.limit(BATCH);
    query.skip(skip);
    // eslint-disable-next-line no-await-in-loop
    const rows = await query.find({ useMasterKey: true });
    if (rows.length === 0) break;

    for (const row of rows) {
      const ct = row.get(target.column);
      const keyId = cipher.parseKeyId(ct);
      if (keyId === activeKeyId) continue; // already on the active key — resumable skip

      // eslint-disable-next-line no-await-in-loop
      const oldDek = await dkm.getDekById(keyId);
      const plaintext = cipher.decryptEnvelope(ct, oldDek, policy.aad);
      row.set(target.column, cipher.encryptWithDek(plaintext, dek, activeKeyId, policy.aad));
      // eslint-disable-next-line no-await-in-loop
      await row.save(null, { useMasterKey: true });
      reencrypted += 1;
    }
    processed += rows.length;
    skip += rows.length;
  }
  return { processed, reencrypted };
}

async function run() {
  const fieldKey = process.argv[2];
  if (!fieldKey) throw new Error('Usage: rotate-dek.js <fieldKey> (e.g. client.passport)');

  const policy = getPolicy(fieldKey);
  const target = FIELD_TARGETS[fieldKey];
  if (!target) throw new Error(`No storage target mapped for ${fieldKey}`);

  const { keyId: activeKeyId } = await dkm.rotateDek(policy.dataClass);
  const { dek } = await dkm.getActiveDek(policy.dataClass);

  const stats = await reencryptRecords(fieldKey, target, activeKeyId, dek, policy);

  // Retire any retiring DEK no longer referenced by a record.
  const retiring = await DataKey.findByStatus(policy.dataClass, 'retiring');
  let retired = 0;
  for (const dk of retiring) {
    const q = new Parse.Query(target.className);
    q.matches(target.column, new RegExp(`^v1:${dk.getKeyId()}:`));
    // eslint-disable-next-line no-await-in-loop
    const remaining = await q.count({ useMasterKey: true });
    if (remaining === 0) {
      // eslint-disable-next-line no-await-in-loop
      await dkm.retireDek(dk.getKeyId());
      retired += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Rotated ${fieldKey}: active=${activeKeyId}, scanned=${stats.processed}, re-encrypted=${stats.reencrypted}, retired ${retired} old key(s).`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Rotation failed:', error.message);
  process.exit(1);
});
