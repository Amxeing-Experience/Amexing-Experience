/**
 * StripeCheckoutController.retirePending — hardened retirement (Parse real + mongodb-memory-server).
 *
 * The hallazgo this suite pins: the old implementation did setGatewayStatus('expired') +
 * softDelete() around a network call to Stripe. Between reading the row and saving it, the webhook
 * could confirm that very Payment — and the save would then push a REAL, already-captured charge
 * back to 'expired' + exists:false, where the rollup can never see it again. RP-I2 and RP-I3 below
 * FAIL against that implementation and pass against the conditional write.
 *
 * They also pin the other half of the contract: the retirement that legitimately happens must leave
 * `retiredBySystem:true`, because that marker is the only thing that later authorizes the revive.
 * A sweep or a retirePending that forgot to set it would silently make a real charge unrecoverable.
 */

const Parse = require('parse/node');
const Payment = require('../../../src/domain/models/Payment');
const PaymentService = require('../../../src/application/services/PaymentService');
const StripeCheckoutController = require('../../../src/application/controllers/api/StripeCheckoutController');
const StripeWebhookController = require('../../../src/application/controllers/api/StripeWebhookController');
const atomicStore = require('../../../src/infrastructure/payments/paymentAtomicStore');

const RUN = `rp${Date.now().toString(36)}`;

describe('retirePending hardened (integration)', () => {
  const created = [];

  const reservationPtr = (id) => {
    const ptr = new Parse.Object('Reservation');
    ptr.id = id;
    return ptr;
  };

  const createReservation = async (total = 1000) => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', 'efectivo');
    reservation.set('currency', 'MXN');
    await reservation.save(null, { useMasterKey: true });
    created.push(reservation);

    const rs = new Parse.Object('ReservationService');
    rs.set('active', true);
    rs.set('exists', true);
    rs.set('reservationPtr', reservation);
    rs.set('subconcept', { includeInTotal: true, pricesByType: null, total });
    await rs.save(null, { useMasterKey: true });
    created.push(rs);
    return reservation.id;
  };

  // The REAL model class, not a bare Parse.Object: retirePending reads getGatewaySessionId() off it,
  // exactly as it receives it from findPendingOnline/buildPendingPayment in production.
  const createPendingOnline = async (reservationId, amount = 1000, gatewayStatus = 'requires_payment') => {
    const p = new Payment();
    p.set('reservationPtr', reservationPtr(reservationId));
    p.set('amount', amount);
    p.set('origAmount', amount);
    p.set('origCurrency', 'MXN');
    p.set('method', 'tarjeta');
    p.set('channel', 'online');
    p.set('gateway', 'stripe');
    p.set('gatewayStatus', gatewayStatus);
    p.set('gatewaySessionId', `cs_${RUN}_${created.length}`);
    p.set('expiresAt', new Date(Date.now() + 30 * 60 * 1000));
    p.set('active', true);
    p.set('exists', true);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  const reload = async (id) => new Parse.Query('Payment').get(id, { useMasterKey: true });

  // A fake adapter whose expireCheckout resolves instantly; the network is never touched.
  const adapter = () => ({ expireCheckout: jest.fn().mockResolvedValue({}) });

  // The webhook's own path into Capa B, without HTTP: the same code the real delivery runs.
  const confirmViaWebhook = (payment, reservationId) => StripeWebhookController.applyToPayment({
    id: `evt_${RUN}_${payment.id}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${RUN}`,
        object: 'checkout.session',
        status: 'complete',
        metadata: { paymentId: payment.id, reservationId },
      },
    },
  }, { gatewayStatus: 'succeeded', crossesThreshold: true });

  beforeAll(async () => {
    require('../../../src/index');
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';
  }, 60000);

  afterAll(async () => {
    for (const o of created) {
      try { await o.destroy({ useMasterKey: true }); } catch { /* gone */ }
    }
    await atomicStore.closeForTests();
  }, 60000);

  // -----------------------------------------------------------------------------------------
  describe('RP-I1 — the normal retirement', () => {
    it('leaves the row expired, soft-deleted AND flagged as retired by the system', async () => {
      const reservationId = await createReservation(1000);
      const pending = await createPendingOnline(reservationId, 1000);

      const retired = await StripeCheckoutController.retirePending(pending, adapter());
      expect(retired).toBe(true);

      const row = await reload(pending.id);
      expect(row.get('gatewayStatus')).toBe('expired');
      expect(row.get('exists')).toBe(false);
      expect(row.get('active')).toBe(false);
      expect(row.get('retiredBySystem')).toBe(true);
      expect(row.get('deletedAt')).toBeInstanceOf(Date);
      // Housekeeping has no author: deletedBy stays absent, which is what distinguishes this row
      // from a deliberate staff delete even before reading the flag.
      expect(row.get('deletedBy')).toBeUndefined();
    });

    it('expires the remote Checkout Session exactly once before retiring locally', async () => {
      const reservationId = await createReservation(1000);
      const pending = await createPendingOnline(reservationId, 1000);
      const a = adapter();
      await StripeCheckoutController.retirePending(pending, a);
      expect(a.expireCheckout).toHaveBeenCalledTimes(1);
      expect(a.expireCheckout).toHaveBeenCalledWith(pending.get('gatewaySessionId'));
    });

    it('a retired pending no longer counts nor blocks: the rollup is unchanged (it never counted)', async () => {
      const reservationId = await createReservation(1000);
      const pending = await createPendingOnline(reservationId, 1000);
      await StripeCheckoutController.retirePending(pending, adapter());
      const summary = await PaymentService.summarize(reservationId);
      expect(summary.paidAmount).toBe(0);
      expect(summary.balance).toBe(1000);
      expect(summary.paymentStatus).toBe('pending');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('RP-I2 — it must NOT walk a succeeded row backwards', () => {
    it('a Payment the webhook already confirmed is left exactly as it is (no-op, no throw)', async () => {
      const reservationId = await createReservation(1000);
      const pending = await createPendingOnline(reservationId, 1000);

      // The webhook wins the race first (this is the state retirePending finds after its network call).
      await confirmViaWebhook(pending, reservationId);
      expect((await reload(pending.id)).get('gatewayStatus')).toBe('succeeded');

      // The in-memory copy retirePending holds is the STALE one PR4 loaded before the confirmation.
      const retired = await StripeCheckoutController.retirePending(pending, adapter());
      expect(retired).toBe(false);

      const row = await reload(pending.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('active')).toBe(true);
      expect(row.get('retiredBySystem')).toBeUndefined();
      // And the money is still visible to the rollup.
      const reservation = await new Parse.Query('Reservation').get(reservationId, { useMasterKey: true });
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('RP-I3 — the REAL race, both orders', () => {
    it.each([
      ['retirePending first', true],
      ['webhook first', false],
    ])('%s: the charge always ends visible and counted, with exactly one recalculate', async (_label, retireFirst) => {
      const reservationId = await createReservation(1000);
      const pending = await createPendingOnline(reservationId, 1000);

      const recalcSpy = jest.spyOn(PaymentService, 'recalculate');
      let results;
      try {
        const retire = () => StripeCheckoutController.retirePending(pending, adapter());
        const confirm = () => confirmViaWebhook(pending, reservationId);
        results = await Promise.all(retireFirst ? [retire(), confirm()] : [confirm(), retire()]);
        expect(recalcSpy).toHaveBeenCalledTimes(1);
        expect(recalcSpy).toHaveBeenCalledWith(reservationId);
      } finally {
        recalcSpy.mockRestore();
      }
      expect(results).toHaveLength(2); // neither call threw

      // Whoever won the write, the outcome is the SAME: the money is confirmed and visible. If the
      // retirement got there first, the confirmation revived the row it had retired; that is the
      // whole point of the marker. What can never happen is succeeded + exists:false.
      const row = await reload(pending.id);
      expect(row.get('gatewayStatus')).toBe('succeeded');
      expect(row.get('exists')).toBe(true);
      expect(row.get('active')).toBe(true);
      expect(row.get('retiredBySystem')).toBe(false);

      const reservation = await new Parse.Query('Reservation').get(reservationId, { useMasterKey: true });
      expect(reservation.get('paidAmount')).toBe(1000);
      expect(reservation.get('balance')).toBe(0);
      expect(reservation.get('paymentStatus')).toBe('paid');
    }, 30000);
  });

  // -----------------------------------------------------------------------------------------
  describe('RP-I4 — the statuses it must never touch', () => {
    it.each(['failed', 'processing', 'succeeded', 'expired', 'refunded', 'disputed', 'dispute_lost'])(
      'a Payment at %p is left untouched (only requires_payment is retirable)',
      async (status) => {
        const reservationId = await createReservation(1000);
        const pending = await createPendingOnline(reservationId, 1000, status);

        const retired = await StripeCheckoutController.retirePending(pending, adapter());
        expect(retired).toBe(false);

        const row = await reload(pending.id);
        expect(row.get('gatewayStatus')).toBe(status);
        expect(row.get('exists')).toBe(true);
        expect(row.get('retiredBySystem')).toBeUndefined();
      }
    );
  });
});
