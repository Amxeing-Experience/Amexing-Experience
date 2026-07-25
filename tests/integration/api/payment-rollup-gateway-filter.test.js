/**
 * Rollup gateway filter — integration (Parse real + mongodb-memory-server).
 *
 * The money route: PaymentService.summarize() must (1) keep EXACTLY the same paidAmount/balance/
 * paymentStatus for reservations with only manual payments (regression that catches any drift the
 * new .filter() could introduce on ALL existing reservations, not just gateway ones), and (2) apply
 * the countsInRollup allowlist to online payments — succeeded/disputed count, everything else does not.
 *
 * Payments are created DIRECTLY via Parse (masterKey) because the manual POST /payments endpoint does
 * not set gatewayStatus; here we need to simulate online payments in each gateway state.
 */

const Parse = require('parse/node');
const PaymentService = require('../../../src/application/services/PaymentService');

describe('rollup gateway filter (integration)', () => {
  beforeAll(async () => {
    Parse.initialize('test-app-id', null, 'test-master-key');
    Parse.serverURL = 'http://localhost:1339/parse';
    Parse.masterKey = 'test-master-key';
    // Parse Server (1339) + Memory DB are already up via jest globalSetup.
    await new Promise((resolve) => { setTimeout(resolve, 300); });
  }, 30000);

  const created = [];

  afterAll(async () => {
    const destroy = async (o) => { try { await o.destroy({ useMasterKey: true }); } catch (e) { /* gone */ } };
    for (const o of created) await destroy(o);
  });

  // Reservation (MXN, efectivo anchor) + one ReservationService per total. total-only subconcept
  // (no pricesByType) mirrors the existing breakdown fixtures: every method resolves 1:1 to the anchor,
  // so coverage == raw paid regardless of method mix — the pre-filter behavior we must not regress.
  const createReservation = async (serviceTotals, paymentType = 'efectivo') => {
    const reservation = new Parse.Object('Reservation');
    reservation.set('active', true);
    reservation.set('exists', true);
    reservation.set('status', 'confirmed');
    reservation.set('paymentType', paymentType);
    reservation.set('currency', 'MXN');
    await reservation.save(null, { useMasterKey: true });
    created.push(reservation);

    for (let i = 0; i < serviceTotals.length; i += 1) {
      const rs = new Parse.Object('ReservationService');
      rs.set('active', true);
      rs.set('exists', true);
      rs.set('reservationPtr', reservation);
      rs.set('concept', `Servicio ${i + 1}`);
      rs.set('type', 'transport');
      rs.set('subconcept', { includeInTotal: true, pricesByType: null, total: serviceTotals[i] });
      await rs.save(null, { useMasterKey: true });
      created.push(rs);
    }
    return reservation.id;
  };

  // Direct Payment creation with optional gateway state.
  const addPayment = async (reservationId, { amount, method = 'efectivo', channel, gateway, gatewayStatus }) => {
    const resPtr = new Parse.Object('Reservation');
    resPtr.id = reservationId;
    const p = new Parse.Object('Payment');
    p.set('active', true);
    p.set('exists', true);
    p.set('reservationPtr', resPtr);
    p.set('amount', amount);
    p.set('method', method);
    p.set('paidAt', new Date());
    if (channel) p.set('channel', channel);
    if (gateway) p.set('gateway', gateway);
    // Set gatewayStatus whenever provided, including an explicit '' (legacy manual edge case).
    if (gatewayStatus !== undefined) p.set('gatewayStatus', gatewayStatus);
    await p.save(null, { useMasterKey: true });
    created.push(p);
    return p;
  };

  describe('regresion de dinero — solo pagos manuales (mismo paidAmount/balance/paymentStatus de siempre)', () => {
    it('pago exacto 100% => paid, balance 0', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 1000, method: 'efectivo' });
      const s = await PaymentService.summarize(id);
      expect(s.total).toBe(1000);
      expect(s.paidAmount).toBe(1000);
      expect(s.balance).toBe(0);
      expect(s.paymentStatus).toBe('paid');
    });

    it('parcial 40% => partial, balance 600', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 400, method: 'efectivo' });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(400);
      expect(s.balance).toBe(600);
      expect(s.paymentStatus).toBe('partial');
    });

    it('overpay 120% => paid, balance negativo', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 1200, method: 'efectivo' });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(1200);
      expect(s.balance).toBe(-200);
      expect(s.paymentStatus).toBe('paid');
    });

    it('0 pagos => pending, balance = total', async () => {
      const id = await createReservation([1000]);
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(0);
      expect(s.balance).toBe(1000);
      expect(s.paymentStatus).toBe('pending');
    });

    it('multi-pago mixto efectivo+transferencia+tarjeta suma exacta => paid, balance 0', async () => {
      const id = await createReservation([900]);
      await addPayment(id, { amount: 300, method: 'efectivo' });
      await addPayment(id, { amount: 300, method: 'transferencia' });
      await addPayment(id, { amount: 300, method: 'tarjeta' });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(900);
      expect(s.balance).toBe(0);
      expect(s.paymentStatus).toBe('paid');
    });

    it("manual con gatewayStatus '' (cadena vacia) sigue contando (no sobrecobra)", async () => {
      // Un pago manual/legacy cuyo campo String se guarde como '' debe tratarse como manual y contar;
      // si cayera del rollup, el saldo se inflaria y sobrecobraria al cliente.
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 1000, method: 'efectivo', gatewayStatus: '' });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(1000);
      expect(s.balance).toBe(0);
      expect(s.paymentStatus).toBe('paid');
    });
  });

  describe('truth table con I/O real — el filtro de gateway aplica en el rollup', () => {
    it('manual $400 + online succeeded $600 => cuenta ambos ($1000)', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 400, method: 'efectivo' });
      await addPayment(id, {
        amount: 600, method: 'tarjeta', channel: 'online', gateway: 'stripe', gatewayStatus: 'succeeded',
      });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(1000);
      expect(s.balance).toBe(0);
      expect(s.paymentStatus).toBe('paid');
    });

    it('manual $400 + online requires_payment $600 => cuenta solo el manual ($400)', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 400, method: 'efectivo' });
      await addPayment(id, {
        amount: 600, method: 'tarjeta', channel: 'online', gateway: 'stripe', gatewayStatus: 'requires_payment',
      });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(400); // el pendiente NO infla el saldo
      expect(s.balance).toBe(600);
      expect(s.paymentStatus).toBe('partial');
    });

    it('solo online disputed $1000 => cuenta ($1000): el dinero ya se capturo', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, {
        amount: 1000, method: 'tarjeta', channel: 'online', gateway: 'stripe', gatewayStatus: 'disputed',
      });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(1000);
      expect(s.balance).toBe(0);
      expect(s.paymentStatus).toBe('paid');
    });

    it('manual $400 + online dispute_lost $600 => cuenta solo el manual ($400)', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 400, method: 'efectivo' });
      await addPayment(id, {
        amount: 600, method: 'tarjeta', channel: 'online', gateway: 'stripe', gatewayStatus: 'dispute_lost',
      });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(400);
      expect(s.balance).toBe(600);
    });

    it('manual $400 + online estado desconocido "foobar" $600 => cuenta solo el manual ($400, fail-safe)', async () => {
      const id = await createReservation([1000]);
      await addPayment(id, { amount: 400, method: 'efectivo' });
      await addPayment(id, {
        amount: 600, method: 'tarjeta', channel: 'online', gateway: 'stripe', gatewayStatus: 'foobar',
      });
      const s = await PaymentService.summarize(id);
      expect(s.paidAmount).toBe(400); // un estado nuevo/desconocido NO cuenta
      expect(s.balance).toBe(600);
    });
  });
});
