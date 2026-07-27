/**
 * In-process serialization of money writes per reservation.
 *
 * Payment and adjustment writes do read-compute-write on the Reservation without any DB-level lock,
 * so two near-simultaneous operations on the SAME reservation can interleave and the last save
 * silently overwrites the other (lost update). The helper chains every operation for a given
 * reservationId AFTER the previous pending one for that same id, so they run strictly one at a time.
 * Operations on DIFFERENT reservations never block each other (an independent chain per id).
 *
 * Scope: this is an in-memory lock local to THIS Node process. It fully protects a single-process
 * deployment (development runs `instances: 1`, fork mode). It does NOT serialize across processes:
 * under PM2 cluster (production and staging run `instances: 'max'`, `exec_mode: 'cluster'`) two
 * workers can still race the same reservation. Cross-process safety would need a distributed lock
 * such as an atomic Mongo guard, an infrastructure change out of scope here; this stays a real
 * improvement for the single-worker path regardless.
 * @module reservationLock
 */

// Tail of the pending promise chain per reservationId. The entry is deleted once its chain drains,
// so the Map holds at most one live entry per reservation with work in flight (no unbounded growth).
const chains = new Map();

/**
 * Run asyncFn serialized against any other operation for the same reservationId.
 * @param {string} reservationId - Reservation objectId used as the lock key.
 * @param {() => Promise<object>} asyncFn - Async function doing the read-compute-write; its result is returned.
 * @returns {Promise<object>} Resolves/rejects with asyncFn's outcome (a failure never blocks later ops).
 * @example
 * await withReservationLock(id, () => PaymentService.recalculate(id));
 */
function withReservationLock(reservationId, asyncFn) {
  const key = String(reservationId);
  const previous = chains.get(key) || Promise.resolve();

  // Chain after the previous op regardless of whether it resolved or rejected, so one failure does
  // not stall the queue. `result` carries THIS caller's real outcome (value or rejection).
  const result = previous.then(() => asyncFn(), () => asyncFn());

  // `settled` never rejects: it is what the NEXT operation waits on, and it swallows this op's
  // outcome so a rejection here does not propagate into the following operation.
  const settled = result.then(() => {}, () => {});
  chains.set(key, settled);

  // Drop the entry once this is the last op in the chain (no newer op replaced it), avoiding a leak.
  settled.finally(() => {
    if (chains.get(key) === settled) {
      chains.delete(key);
    }
  });

  return result;
}

module.exports = { withReservationLock };
