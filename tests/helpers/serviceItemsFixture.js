/**
 * Fixture compartido para los tests de la propina por servicio (doble conteo).
 *
 * buildSubconcept arma un subconcepto de serviceItems con la MISMA aritmética que el wizard
 * (quote-services-v2.saveToBackend): unitPrice/total guardan SOLO precio (formaCorregida) y la
 * propina va como metadata (tipAmount/tipType/tipValue). `bakeTipBug:true` reproduce el bug viejo
 * (la propina horneada dentro de total), útil como regresión permanente contra reintroducirlo.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} opts
 * @param {string} opts.id - id estable del subconcepto.
 * @param {number} opts.priceEfectivo - precio base en efectivo.
 * @param {number} [opts.priceTransferencia] - precio en transferencia (default = efectivo).
 * @param {number} [opts.priceTarjeta] - precio en tarjeta (default = efectivo).
 * @param {string|null} [opts.tipType] - 'percent' | 'amount' | null.
 * @param {number} [opts.tipValue] - valor de la propina (porcentaje o monto).
 * @param {number} [opts.discountAmount] - descuento por servicio.
 * @param {string} [opts.paymentType] - método ancla para el precio de display.
 * @param {boolean} [opts.bakeTipBug] - true = replica el bug viejo (propina horneada en total).
 * @returns {object} Subconcepto listo para el payload de service-items.
 * @example
 * buildSubconcept({ id: 's1', priceEfectivo: 2000, tipType: 'amount', tipValue: 150 });
 */
function buildSubconcept({
  id, priceEfectivo, priceTransferencia = priceEfectivo, priceTarjeta = priceEfectivo,
  tipType = null, tipValue = 0, discountAmount = 0, paymentType = 'efectivo',
  bakeTipBug = false,
}) {
  const pricesByType = { efectivo: priceEfectivo, transferencia: priceTransferencia, tarjeta: priceTarjeta };
  // El descuento se captura en efectivo y se escala por el factor de forma de pago, igual que el
  // wizard (getServiceDiscountInPaymentType/getServiceDisplayPrice): descontar sobre la base y
  // recargar == recargar y descontar el monto escalado. En efectivo el factor es 1 (sin cambio).
  const discFactor = (priceEfectivo > 0 && pricesByType[paymentType] != null)
    ? pricesByType[paymentType] / priceEfectivo : 1;
  const discountInType = round2(discountAmount * discFactor);
  const servicePrice = Math.max(0, pricesByType[paymentType] - discountInType);
  let tipAmount = 0;
  if (tipType === 'percent' && tipValue > 0) {
    tipAmount = round2((priceEfectivo - discountAmount) * (tipValue / 100));
  } else if (tipType === 'amount' && tipValue > 0) {
    tipAmount = round2(tipValue);
  }
  const total = bakeTipBug ? round2(servicePrice + tipAmount) : servicePrice;
  return {
    id,
    concept: `Servicio ${id}`,
    type: 'concepto',
    pricesByType,
    discountAmount,
    tipType,
    tipValue,
    tipAmount,
    unitPrice: servicePrice,
    total,
    includeInTotal: true,
  };
}

module.exports = { buildSubconcept, round2 };
