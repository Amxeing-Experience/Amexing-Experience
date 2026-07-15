/**
 * PaymentService - Business logic for reservation payments.
 *
 * Pure helpers (serviceBase/computeTotals/deriveStatus) compute the amount due
 * and payment status without touching Parse, so they are trivially unit-testable.
 * Recalculate() loads the reservation and its existing payments, then writes the
 * payment rollup (paidAmount/balance/paymentStatus) onto the Reservation. Payments
 * are plain money amounts applied against the grand total (balance = total − paid);
 * there is no per-service payment split.
 *
 * Modelo de precio por método de pago (solo reservación): se COBRA el valor que la
 * cotización ya calculó y el cliente ya aprobó para ese método — pricesByType.efectivo,
 * .transferencia o .tarjeta, según reservation.paymentType — sin recalcular con ninguna
 * tasa. Esto garantiza paridad exacta con la cotización por construcción (no por
 * coincidencia de números): no hay fetch de tasas, no hay riesgo de que AgencyRate/
 * TransferRate cambien entre cotizar y pagar, y no hay porcentajes propios en esta capa.
 * El efectivo en MXN se redondea a múltiplo de 5 (ley de redondeo, applyCashRounding) —
 * es una regla física del efectivo (no hay billete/moneda de 1 o 2 pesos practicable),
 * distinta de la paridad con la cotización, así que puede diferir en unos pesos del
 * monto sin redondear que muestra la cotización; tarjeta/transferencia NO se redondean.
 * NO se toca el motor de cotizaciones (pricingEngine); solo se lee lo que ya calculó.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const BaseModel = require('../../domain/models/BaseModel');
const logger = require('../../infrastructure/logger');
// Solo se importa el redondeo a efectivo (múltiplo de 5). No se modifica el motor.
const { applyCashRounding } = require('../../domain/pricing/pricingEngine');

// Tag del único ajuste que este servicio crea/reemplaza al reconciliar el método de pago.
// Distingue el ajuste automático de los ajustes que el staff agrega a mano (sin `source`),
// para poder encontrarlo y reemplazarlo sin tocar los manuales.
const RECON_SOURCE = 'payment-method-reconciliation';

/**
 * Round to 2 decimals (currency precision).
 * @param {number} n - Value to round.
 * @returns {number} Rounded value (0 for non-numeric input).
 * @example
 * round2(12.345) // 12.35
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * PaymentService class with pure pricing helpers and the payment recalculation.
 */
class PaymentService {
  /**
   * Lee el precio YA calculado y aprobado por la cotización para un método de pago
   * (pricesByType[paymentType]), sin recalcular con ninguna tasa. Fallback a item.total
   * cuando ese método no está presente (dato viejo o incompleto), igual que antes.
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @returns {number} Monto a cobrar por ese método (0 si está excluido del total).
   * @example
   * PaymentService.chargeAmount({ pricesByType: { tarjeta: 121 } }, 'tarjeta') // 121
   */
  static chargeAmount(item, paymentType) {
    if (!item || item.includeInTotal === false) return 0;
    const prices = item.pricesByType;
    if (prices && typeof prices === 'object') {
      const amount = Number(prices[paymentType]);
      if (Number.isFinite(amount)) return amount;
    }
    const total = Number(item.total);
    return Number.isFinite(total) ? total : 0;
  }

  /**
   * Resolve a single service's BASE price (efectivo), reading pricesByType.efectivo
   * (fallback to total). Es el precio de referencia para el desglose Subtotal/recargo
   * que se muestra en la UI (no se usa para calcular el cobro de otros métodos).
   * @param {object} item - Plain service item { includeInTotal, pricesByType, total }.
   * @returns {number} Base (efectivo) price (0 when excluded from total).
   * @example
   * PaymentService.serviceBase({ pricesByType: { efectivo: 100 } }) // 100
   */
  static serviceBase(item) {
    return this.chargeAmount(item, 'efectivo');
  }

  /**
   * Compute reservation totals from plain service items: se suma pricesByType[paymentType]
   * por servicio (el valor ya aprobado en la cotización), + net adjustments + tip. Efectivo
   * en MXN se redondea a múltiplo de 5 (regla física del efectivo, no afecta tarjeta/transferencia).
   * @param {Array<object>} serviceItems - Plain items { id, includeInTotal, pricesByType, total }.
   * @param {string} paymentType - Método (efectivo|transferencia|tarjeta).
   * @param {number} [reservationTip] - Reservation-level tip, added on top.
   * @param {number} [adjustmentsNet] - Net reservation adjustments (charges − discounts), pesos finales.
   * @param {string} [currency] - Moneda (MXN aplica redondeo a efectivo).
   * @returns {object} { subtotal, adjustments, iva, surcharge, servicesTotal, tip, total, paymentType }.
   * @example
   * PaymentService.computeTotals([{ id: 'a', pricesByType: { efectivo: 100, tarjeta: 121 } }], 'tarjeta') // total 121
   */
  static computeTotals(serviceItems, paymentType, reservationTip = 0, adjustmentsNet = 0, currency = 'MXN') {
    const items = Array.isArray(serviceItems) ? serviceItems : [];
    let base = 0;
    let chargeSum = 0;
    for (const item of items) {
      base += this.serviceBase(item);
      chargeSum += this.chargeAmount(item, paymentType);
    }
    base = round2(base);

    let servicesTotal = round2(chargeSum);
    // Efectivo en MXN: redondeo a múltiplo de 5 sobre el total (ley de redondeo del proyecto).
    if (paymentType === 'efectivo' && String(currency).toUpperCase() === 'MXN') {
      servicesTotal = round2(applyCashRounding(servicesTotal));
    }

    // Ajustes (cargos/descuentos) y propina se suman como pesos finales (sin factor).
    const adjustments = round2(Number(adjustmentsNet) || 0);
    const tip = round2(reservationTip);
    // El total nunca es negativo: un descuento mayor al monto lo deja en 0 (no se debe "menos que nada").
    const total = Math.max(0, round2(servicesTotal + adjustments + tip));
    // Recargo agregado por el método (IVA, o IVA + tarjeta). Se expone también como `iva`
    // por compatibilidad con los consumidores existentes del summary.
    const surcharge = round2(servicesTotal - base);

    return {
      subtotal: base,
      adjustments,
      iva: surcharge,
      surcharge,
      servicesTotal,
      tip,
      total,
      paymentType,
    };
  }

  /**
   * Derive payment status from amount due vs amount paid. Overpay is allowed
   * (balance may go negative -> still 'paid'). 'refunded' is set explicitly by
   * the cancellation flow, never derived here.
   * @param {number} total - Amount due (con IVA + tip).
   * @param {number} paidAmount - Amount paid (MXN).
   * @returns {string} Pending|partial|paid.
   * @example
   * PaymentService.deriveStatus(100, 40) // 'partial'
   */
  static deriveStatus(total, paidAmount) {
    const due = round2(total);
    const paid = round2(paidAmount);
    if (paid <= 0) return 'pending';
    if (paid < due) return 'partial';
    return 'paid';
  }

  /**
   * Map reservation services to plain pricing items for computeTotals().
   * @param {Array<object>} services - ReservationService Parse objects.
   * @returns {Array<object>} Plain items { id, includeInTotal, pricesByType, total }.
   * @example
   * PaymentService.toServiceItems(services)
   */
  static toServiceItems(services) {
    return (services || []).map((svc) => {
      const sub = svc.get('subconcept') || {};
      const rawTotal = Number(sub.total);
      return {
        id: svc.id,
        includeInTotal: sub.includeInTotal !== false,
        pricesByType: sub.pricesByType || null,
        total: Number.isFinite(rawTotal) ? rawTotal : (Number(svc.get('total')) || 0),
      };
    });
  }

  /**
   * Sum all payment amounts into the global paid total. Payments are plain money
   * amounts applied against the reservation grand total (no per-service split).
   * @param {Array<object>} rows - Plain rows { amount }.
   * @returns {number} Total paid (MXN), rounded to cents.
   * @example
   * PaymentService.sumPayments([{ amount: 100 }, { amount: 50 }]) // 150
   */
  static sumPayments(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let paidGlobal = 0;
    for (const row of list) paidGlobal += Number(row.amount) || 0;
    return round2(paidGlobal);
  }

  /**
   * Sum every payment tip into the global tip total. Sister to sumPayments; tips are
   * real money received, separate from the services amount and never surcharged by
   * payment method. Non-numeric/missing tip counts as 0 (same defensiveness as sumPayments).
   * @param {Array<object>} rows - Plain rows { tip }.
   * @returns {number} Total tip (MXN), rounded to cents.
   * @example
   * PaymentService.sumTips([{ tip: 100 }, { tip: 50 }]) // 150
   */
  static sumTips(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let tipGlobal = 0;
    for (const row of list) tipGlobal += Number(row.tip) || 0;
    return round2(tipGlobal);
  }

  /**
   * Load a reservation, its existing services and payments, and compute the
   * totals + global paid amount (without persisting). Shared by summarize/recalculate.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} { reservation, services, totals, paidGlobal }.
   * @example
   * const data = await PaymentService.loadAndCompute(reservationId);
   */
  static async loadAndCompute(reservationId) {
    const Reservation = require('../../domain/models/Reservation');
    const Payment = require('../../domain/models/Payment');

    const reservation = await new Parse.Query(Reservation).get(reservationId, { useMasterKey: true });

    const reservationPtr = new Reservation();
    reservationPtr.id = reservationId;
    const servicesQuery = BaseModel.queryExisting('ReservationService');
    servicesQuery.equalTo('reservationPtr', reservationPtr);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });

    const payments = await Payment.getExistingForReservation(reservationId);

    const paymentType = reservation.get('paymentType') || 'efectivo';
    const currency = reservation.get('currency') || 'MXN';
    // Net reservation adjustments (charges add, discounts subtract) flow into the amount due.
    const adjustmentsList = reservation.get('adjustments') || [];
    const adjustmentsNet = adjustmentsList.reduce((sum, a) => {
      const amt = Number(a && a.amount) || 0;
      return a && a.type === 'discount' ? sum - amt : sum + amt;
    }, 0);
    const serviceItems = this.toServiceItems(services);

    // Tip is aggregated from the real payments (Payment.tip), not Reservation.tip — a dead field
    // nothing writes. Each row carries its own amount + tip for the global rollup.
    const paymentRows = payments.map((payment) => ({
      amount: payment.get('amount'),
      tip: payment.get('tip'),
    }));
    const tipTotal = this.sumTips(paymentRows);
    const totals = this.computeTotals(serviceItems, paymentType, tipTotal, adjustmentsNet, currency);

    // paidGlobal MUST include the tip: both the services amount AND the tip are real money received.
    // computeTotals folds the tip into `total`, so excluding it here would leave a phantom pending
    // balance exactly equal to the tip (e.g. a 100%-tip payment). Net effect: tip is balance-neutral.
    const paidGlobal = round2(this.sumPayments(paymentRows) + tipTotal);

    return {
      reservation, services, totals, paidGlobal,
    };
  }

  /**
   * Build the payment summary (grand-total rollup) from computed data. Payments are
   * exact money amounts subtracted from the reservation total: balance = total − paid.
   * @param {string} reservationId - Reservation objectId.
   * @param {object} computed - { totals, paidGlobal }.
   * @returns {object} Summary { paymentStatus, paidAmount, balance, subtotal, adjustments, iva, tip, total }.
   * @example
   * PaymentService.buildSummary(id, await PaymentService.loadAndCompute(id))
   */
  static buildSummary(reservationId, computed) {
    const { totals, paidGlobal } = computed;
    const paid = round2(paidGlobal);

    return {
      reservationId,
      paymentStatus: this.deriveStatus(totals.total, paid),
      paidAmount: paid,
      balance: round2(totals.total - paid),
      subtotal: totals.subtotal,
      adjustments: totals.adjustments,
      iva: totals.iva,
      tip: totals.tip,
      total: totals.total,
    };
  }

  /**
   * Compute the payment summary for a reservation WITHOUT persisting (read path).
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} Payment summary.
   * @example
   * const summary = await PaymentService.summarize(reservationId);
   */
  static async summarize(reservationId) {
    const computed = await this.loadAndCompute(reservationId);
    return this.buildSummary(reservationId, computed);
  }

  /**
   * Recalculate and persist the payment rollup for a reservation. Triggered on
   * payment create/edit/delete. Payments subtract from the grand total, so only the
   * Reservation carries the rollup (paidAmount/balance/paymentStatus); there is no
   * per-service split. Does NOT touch recalculateTotal() or the operational status.
   * @param {string} reservationId - Reservation objectId.
   * @returns {Promise<object>} Payment summary.
   * @example
   * await PaymentService.recalculate(reservationId);
   */
  static async recalculate(reservationId) {
    try {
      const computed = await this.loadAndCompute(reservationId);
      const { reservation } = computed;
      const summary = this.buildSummary(reservationId, computed);

      reservation.set('paidAmount', summary.paidAmount);
      reservation.set('balance', summary.balance);
      reservation.set('paymentStatus', summary.paymentStatus);

      await reservation.save(null, { useMasterKey: true });

      logger.info('Reservation payment status recalculated', {
        reservationId,
        paidAmount: summary.paidAmount,
        total: summary.total,
        paymentStatus: summary.paymentStatus,
      });

      return summary;
    } catch (error) {
      logger.error('Error recalculating reservation payment status', {
        reservationId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Pure decision logic that reconciles reservation.paymentType against the real
   * method of the payments being registered. No Parse I/O — trivially unit-testable.
   *
   * WHY the tier ratio is derived from THIS reservation's own pricesByType/computeTotals
   * and never from fixed 1.00/1.16/1.21 constants: pricesByType can carry a negotiated
   * ("dirty") price that does NOT follow base×1.16/×1.21, and AgencyRate/TransferRate are
   * configurable rates that may have changed since the quote was frozen. The only correct
   * cross-tier ratio is the real per-method total of this reservation.
   *
   * WHY the adjustment is recomputed in full from the whole payment history and REPLACES a
   * single tagged adjustment (never stacks): computing an incremental delta per payment
   * over-counts partial payments (each delta wrongly assumed the payment settled the entire
   * remaining base), leaving a phantom balance. Recomputing the total target adjustment from
   * scratch every call is idempotent by construction and self-corrects any inconsistent state.
   * @param {object} input - Plain inputs (no Parse objects).
   * @param {Array<object>} input.serviceItems - Plain service items for computeTotals.
   * @param {string} [input.currency] - Reservation currency (MXN applies cash rounding).
   * @param {string} [input.anchoredMethod] - Current reservation.paymentType.
   * @param {Array<object>} [input.priorPayments] - Existing payments { method, amount }, excluding the current one.
   * @param {object|null} [input.currentPayment] - Payment being registered { method, amount }, or null (delete/recalc).
   * @param {object|null} [input.existingReconciliationAdjustment] - The current tagged adjustment, or null.
   * @param {Array<string>} [input.validMethods] - Accepted method tokens (Payment.METHODS).
   * @param {string} [input.reconciliationDescription] - Base text for the auto adjustment description.
   * @param {boolean} [input.isAgency] - True SOLO para agencias (re-ancla el total al nuevo tier). Cliente directo o indeterminado = false (fail-closed): nunca re-ancla, resuelve con el ajuste acotado ('complex'). Default false.
   * @returns {object} Decision { scenario, expectedCeiling, warning, paymentTypeUpdate, reconciliationAdjustment }.
   * @example
   * PaymentService.decidePaymentMethodChange({ serviceItems, anchoredMethod: 'efectivo', currentPayment: { method: 'tarjeta', amount: 121 }, isAgency: true });
   */
  static decidePaymentMethodChange(input) {
    const {
      serviceItems = [],
      currency = 'MXN',
      anchoredMethod = 'efectivo',
      priorPayments = [],
      currentPayment = null,
      existingReconciliationAdjustment = null,
      validMethods = ['efectivo', 'transferencia', 'tarjeta'],
      reconciliationDescription = 'Ajuste por método de pago',
      isAgency = false,
    } = input || {};

    // Fix 1 (hallazgo crítico del council): el re-anclaje automático de paymentType solo es correcto
    // para AGENCIAS. Para un cliente directo la referencia SIEMPRE es tarjeta y NUNCA debe re-anclarse
    // (un pago de $1 no puede repriciar la reservación completa). Fail-closed: cualquier valor que no
    // sea exactamente true (indeterminado incluido) se trata como NO-agencia → fuerza 'complex'.
    const agency = isAgency === true;

    const isValid = (m) => validMethods.includes(m);
    const totalForMethod = (m) => this.computeTotals(serviceItems, m, 0, 0, currency).servicesTotal;
    const baseTotal = totalForMethod('efectivo');

    // Escenario: comparar el método del pago actual contra TODOS los pagos previos. Un pago previo con
    // método corrupto/legacy (null/vacío/inválido) fuerza el camino conservador 'complex'; un cliente
    // directo (no-agencia) también lo fuerza SIEMPRE (nunca re-ancla el tier de precio).
    const currentMethod = currentPayment ? currentPayment.method : anchoredMethod;
    const corruptPrior = priorPayments.filter((p) => !isValid(p.method));
    const hasDifferentValidPrior = priorPayments.some((p) => isValid(p.method) && p.method !== currentMethod);
    const scenario = (!agency || corruptPrior.length > 0 || hasDifferentValidPrior) ? 'complex' : 'none';

    // El paymentType solo se reescribe en el caso simple (solo agencia), cuando llega un pago REAL de
    // servicios con método distinto. Un pago solo-propina (amount 0) NUNCA ancla el tier: no tiene
    // dinero de servicios sobre el cual decidir el método de precio de la reservación.
    let paymentTypeUpdate = null;
    const currentAmount = currentPayment ? (Number(currentPayment.amount) || 0) : 0;
    if (scenario === 'none' && currentPayment && currentAmount > 0 && isValid(currentMethod) && currentMethod !== anchoredMethod) {
      paymentTypeUpdate = currentMethod;
    }
    // El ancla contra la que se mide la reconciliación: el método ya actualizado en el caso simple.
    const reconAnchor = paymentTypeUpdate || anchoredMethod;

    const warnings = [];
    if (corruptPrior.length > 0) {
      warnings.push(`${corruptPrior.length} pago(s) con método inválido forzaron la reconciliación; revisar manualmente.`);
    }

    const remove = () => (existingReconciliationAdjustment
      ? {
        action: 'remove', type: null, amount: null, description: null, source: RECON_SOURCE,
      }
      : {
        action: 'noop', type: null, amount: null, description: null, source: RECON_SOURCE,
      });

    // Guarda de división entre cero: reservación sin servicios cobrables (todo es propina/ajustes).
    // Sin base no hay relación entre tiers que reconciliar; se limpia cualquier ajuste taggeado viejo.
    if (!Number.isFinite(baseTotal) || baseTotal <= 0) {
      return {
        scenario,
        expectedCeiling: 0,
        warning: warnings.length ? warnings.join(' ') : null,
        paymentTypeUpdate,
        reconciliationAdjustment: remove(),
      };
    }

    const anchorTotal = totalForMethod(reconAnchor);
    // baseEquivalente(p) = p.amount × (T(efectivo) / T(p.method)). Un método corrupto se trata con el
    // tier del ancla, de modo que no aporta ni resta al ajuste (ni penaliza ni beneficia).
    const baseEquivalente = (row) => {
      const amt = Number(row.amount) || 0;
      const tierTotal = isValid(row.method) ? totalForMethod(row.method) : anchorTotal;
      if (!Number.isFinite(tierTotal) || tierTotal <= 0) return amt;
      return amt * (baseTotal / tierTotal);
    };

    // Mecanismo (a): techo esperado SOLO para el pago que se está registrando. Advierte, no bloquea.
    let expectedCeiling = 0;
    if (currentPayment) {
      const sumBaseBefore = priorPayments.reduce((s, p) => s + baseEquivalente(p), 0);
      const remainingBaseBefore = baseTotal - sumBaseBefore;
      const ratioCurrent = totalForMethod(currentMethod) / baseTotal;
      expectedCeiling = round2(remainingBaseBefore * ratioCurrent);
      const captured = Number(currentPayment.amount) || 0;
      const overage = round2(captured - expectedCeiling);
      // Efectivo tolera hasta $5 (redondeo físico a múltiplo de 5); tarjeta/transferencia solo $0.01.
      const tolerance = currentMethod === 'efectivo' ? 5 : 0.01;
      if (overage > tolerance) {
        warnings.push(`El monto capturado (${captured}) excede el máximo esperado (${expectedCeiling}) para saldar en ${currentMethod}.`);
      }
    }

    // Reconciliación (7.5): recalcular el ajuste TOTAL desde el historial completo (incluyendo el pago
    // actual) y reemplazar el único ajuste taggeado. Idempotente: dos llamadas seguidas dan lo mismo.
    const allPayments = currentPayment ? priorPayments.concat([currentPayment]) : priorPayments;
    const sumAmount = allPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const sumBaseEquivalente = allPayments.reduce((s, p) => s + baseEquivalente(p), 0);
    const ratioAnchor = anchorTotal / baseTotal;
    const targetAdjustment = round2(sumAmount - sumBaseEquivalente * ratioAnchor);

    let reconciliationAdjustment;
    if (Math.abs(targetAdjustment) < 0.005) {
      reconciliationAdjustment = remove();
    } else {
      reconciliationAdjustment = {
        action: existingReconciliationAdjustment ? 'replace' : 'create',
        type: targetAdjustment > 0 ? 'charge' : 'discount',
        amount: Math.abs(targetAdjustment),
        description: `${reconciliationDescription} (${reconAnchor})`.slice(0, 150),
        source: RECON_SOURCE,
      };
    }

    return {
      scenario,
      expectedCeiling,
      warning: warnings.length ? warnings.join(' ') : null,
      paymentTypeUpdate,
      reconciliationAdjustment,
    };
  }

  /**
   * Reconcile reservation.paymentType against the real payment method: load the
   * reservation/services/payments, compute the pure decision, then persist the
   * paymentType update and/or the single tagged reconciliation adjustment. The
   * balance rollup itself is recomputed separately by recalculate(). Non-persisting
   * for the balance — only paymentType and the adjustments array are written here.
   * @param {string} reservationId - Reservation objectId.
   * @param {object} [options] - { method, amountMXN, currentPaymentId }.
   * @param {string} [options.method] - Method of the payment being registered/edited (omit for delete).
   * @param {number} [options.amountMXN] - Amount (MXN) of that payment, already converted from its currency.
   * @param {string} [options.currentPaymentId] - Id of the payment being edited/added, excluded from priors.
   * @returns {Promise<object>} The decision returned by decidePaymentMethodChange.
   * @example
   * await PaymentService.resolvePaymentMethodChange(id, { method: 'tarjeta', amountMXN: 4840, currentPaymentId });
   */
  static async resolvePaymentMethodChange(reservationId, options = {}) {
    const { method, amountMXN, currentPaymentId } = options;
    const Reservation = require('../../domain/models/Reservation');
    const Payment = require('../../domain/models/Payment');

    // .include('clientPtr') es OBLIGATORIO: sin él clientPtr llega como pointer sin datos y
    // clientPtr.get('role') devolvería undefined SIEMPRE, resolviendo isAgency mal en todos los casos.
    const reservationQuery = new Parse.Query(Reservation);
    reservationQuery.include('clientPtr');
    const reservation = await reservationQuery.get(reservationId, { useMasterKey: true });

    const reservationPtr = new Reservation();
    reservationPtr.id = reservationId;
    const servicesQuery = BaseModel.queryExisting('ReservationService');
    servicesQuery.equalTo('reservationPtr', reservationPtr);
    servicesQuery.limit(1000);
    const services = await servicesQuery.find({ useMasterKey: true });
    const serviceItems = this.toServiceItems(services);

    const currency = reservation.get('currency') || 'MXN';
    const anchoredMethod = reservation.get('paymentType') || 'efectivo';

    // isAgency del DUEÑO de la reservación, con el MISMO criterio exacto que PublicReservationController:
    // rol string barato del pointer (o clientCategory), sin fetch extra de Role. clientPtr null o
    // huérfano (usuario borrado) => '' => isAgency false (fail-closed, no re-ancla). La limitación
    // conocida (roleId sin string `role`) es deuda preexistente documentada, fuera de alcance.
    const clientPtr = reservation.get('clientPtr');
    const clientRole = (clientPtr && typeof clientPtr.get === 'function') ? (clientPtr.get('role') || '') : '';
    const clientCategory = (clientPtr && typeof clientPtr.get === 'function') ? (clientPtr.get('clientCategory') || '') : '';
    const isAgency = clientRole === 'department_manager' || clientCategory === 'agency';

    const payments = await Payment.getExistingForReservation(reservationId);
    const priorPayments = payments
      .filter((p) => p.id !== currentPaymentId)
      .map((p) => ({ method: p.get('method'), amount: p.get('amount') }));

    const currentPayment = (method !== undefined && method !== null)
      ? { method, amount: Number(amountMXN) || 0 }
      : null;

    const adjustments = reservation.get('adjustments') || [];
    const existingIdx = adjustments.findIndex((a) => a && a.source === RECON_SOURCE);
    const existing = existingIdx >= 0 ? adjustments[existingIdx] : null;

    const decision = this.decidePaymentMethodChange({
      serviceItems,
      currency,
      anchoredMethod,
      priorPayments,
      currentPayment,
      existingReconciliationAdjustment: existing,
      validMethods: Payment.METHODS,
      isAgency,
    });

    let mutated = false;
    if (decision.paymentTypeUpdate) {
      reservation.set('paymentType', decision.paymentTypeUpdate);
      mutated = true;
    }

    const recon = decision.reconciliationAdjustment;
    // NOTA (7.7, sub-pregunta 2): este ajuste automático se crea sin importar el nivel RBAC del actor
    // que registró el pago (agencia/agente nivel 4+ incluido), a diferencia de POST /adjustments que es
    // admin-only. Es un ajuste calculado por el sistema, no discrecional, atado a dinero que ese actor ya
    // está autorizado a cobrar. Marcado como decisión de seguridad pendiente del visto bueno del dueño.
    if (recon.action === 'remove' && existingIdx >= 0) {
      adjustments.splice(existingIdx, 1);
      reservation.set('adjustments', adjustments);
      mutated = true;
    } else if (recon.action === 'create' || recon.action === 'replace') {
      const entry = {
        id: existing ? existing.id : `adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        type: recon.type,
        description: recon.description,
        amount: recon.amount,
        percentage: null,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        source: RECON_SOURCE,
      };
      if (existingIdx >= 0) {
        adjustments[existingIdx] = entry;
      } else {
        adjustments.push(entry);
      }
      reservation.set('adjustments', adjustments);
      mutated = true;
    }

    if (mutated) {
      await reservation.save(null, { useMasterKey: true });
    }

    logger.info('Payment method reconciliation resolved', {
      reservationId,
      isAgency,
      scenario: decision.scenario,
      action: recon.action,
      paymentTypeUpdate: decision.paymentTypeUpdate,
      hasWarning: !!decision.warning,
    });

    return decision;
  }
}

module.exports = PaymentService;
