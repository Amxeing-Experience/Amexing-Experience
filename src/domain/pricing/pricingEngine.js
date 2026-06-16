/* global window */
/**
 * PricingEngine - Motor de calculo puro e isomorfico para cotizaciones.
 *
 * Unica fuente de verdad para el calculo de precios del builder de cotizaciones.
 * Se ejecuta igual en el navegador (preview en vivo) y en Node (validar al guardar
 * / alimentar el PDF), eliminando la divergencia front/back.
 *
 * Reglas de diseno (a proposito): es PURO (sin DOM, sin Parse, sin fetch, sin estado
 * global; todo entra por parametros), COMPONIBLE (cada componente de costo es una
 * funcion pura y el orden de operaciones se define una sola vez en applyDisplayPrice)
 * y FIEL (reproduce las formulas actuales; ver tests golden).
 *
 * Modelo de recargo canonico del builder: efectivo sin recargo (con redondeo a
 * efectivo opcional en MXN), transferencia precio * (1 + transferRate/100), tarjeta
 * precio * (1 + agencyRate/100), USD dividido entre exchangeRate y luego redondeo USD
 * a multiplos de 5. Difiere del pricingHelper (recargo unico paymentSurchargePercentage)
 * usado en otros contextos; reconciliar ambos modelos es un paso posterior.
 * @module pricingEngine
 * @author Denisse Maldonado
 */

const PricingEngine = (() => {
  // ============================================================
  // PRIMITIVOS PUROS
  // ============================================================

  /**
   * Redondea a 2 decimales (el redondeo estandar usado en todo el calculo).
   * @param {number} value - Valor a redondear.
   * @returns {number} Valor con 2 decimales.
   * @example
   */
  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  /**
   * Redondeo USD a multiplos de 5 con reglas especiales.
   * Termina en 3 u 8 (parte entera) sube al siguiente multiplo de 5; resto menor o
   * igual a 2.7 baja; resto mayor a 2.7 sube. Identico a PricingUtils y pricingHelper.
   * @param {number} usdPrice - Precio USD a redondear.
   * @returns {number} Precio USD redondeado.
   * @example
   */
  function applyUSDRoundingRules(usdPrice) {
    const base = Math.floor(usdPrice / 5) * 5;
    const remainder = usdPrice % 5;
    if (remainder === 0) {
      const lastDigitBeforeDecimal = Math.floor(usdPrice) % 10;
      if (lastDigitBeforeDecimal === 3 || lastDigitBeforeDecimal === 8) {
        return base + 5;
      }
      return base;
    }
    if (remainder <= 2.7) {
      return base;
    }
    return base + 5;
  }

  /**
   * Redondeo a efectivo: a multiplo de 5 MXN. Decimal menor o igual a 0.50 baja, mayor
   * a 0.50 sube. Identico a PricingUtils.applyCashRounding.
   * @param {number} price - Precio a redondear.
   * @returns {number} Precio redondeado (multiplo de 5).
   * @example
   */
  function applyCashRounding(price) {
    const integerPart = Math.floor(price);
    const decimalPart = price - integerPart;
    if (decimalPart <= 0.50) {
      return Math.floor(integerPart / 5) * 5;
    }
    if (integerPart === 0) {
      return 5;
    }
    return Math.ceil(integerPart / 5) * 5;
  }

  /**
   * Aplica el recargo por forma de pago. Transferencia usa transferRate, tarjeta usa
   * agencyRate, efectivo no cambia. Identico a PricingUtils.applyPaymentRate.
   * @param {number} price - Precio base.
   * @param {string} paymentType - Efectivo, transferencia o tarjeta.
   * @param {number} transferRate - Porcentaje de recargo por transferencia.
   * @param {number} agencyRate - Porcentaje de recargo por tarjeta.
   * @returns {number} Precio con recargo aplicado.
   * @example
   */
  function applyPaymentRate(price, paymentType, transferRate, agencyRate) {
    if (paymentType === 'transferencia') {
      return price * (1 + (transferRate || 0) / 100);
    }
    if (paymentType === 'tarjeta') {
      return price * (1 + (agencyRate || 0) / 100);
    }
    return price;
  }

  /**
   * Redondeo estilo greeter: si los ultimos 2 digitos son menores a 50 baja a la
   * centena, si no sube. Identico a pricingHelper.applyGreeterRounding.
   * @param {number} price - Precio a redondear.
   * @returns {number} Precio redondeado a la centena.
   * @example
   */
  function applyGreeterRounding(price) {
    const integerPart = Math.floor(price);
    const lastTwoDigits = integerPart % 100;
    if (lastTwoDigits === 0) {
      return integerPart;
    }
    if (lastTwoDigits < 50) {
      return Math.floor(integerPart / 100) * 100;
    }
    return Math.ceil(integerPart / 100) * 100;
  }

  // ============================================================
  // ORDEN DE OPERACIONES CANONICO (un solo lugar)
  // ============================================================

  /**
   * Convierte un precio base en MXN al precio mostrado. Aplica en orden: redondeo a
   * efectivo (solo efectivo y MXN si cashRoundingEnabled), recargo por forma de pago,
   * y conversion de moneda (USD: dividir entre exchangeRate y redondeo USD).
   * Version sin DOM de getDisplayPrice (que hoy lee y muta #priceTypeSelect).
   * @param {number} mxnPrice - Precio base en MXN.
   * @param {object} opts - Opciones de calculo.
   * @param {string} [opts.paymentType] - Efectivo, transferencia o tarjeta.
   * @param {string} [opts.currency] - MXN o USD.
   * @param {number} [opts.transferRate] - Porcentaje de recargo transferencia.
   * @param {number} [opts.agencyRate] - Porcentaje de recargo tarjeta.
   * @param {number} [opts.exchangeRate] - Tipo de cambio USD (MXN por USD).
   * @param {boolean} [opts.cashRoundingEnabled] - Aplicar redondeo a efectivo.
   * @returns {number} Precio mostrado en la moneda pedida.
   * @example
   */
  function applyDisplayPrice(mxnPrice, opts) {
    const o = opts || {};
    const paymentType = o.paymentType || 'efectivo';
    const currency = o.currency || 'MXN';
    const cashRoundingEnabled = o.cashRoundingEnabled !== false;

    let priceToProcess = Number(mxnPrice) || 0;
    if (paymentType === 'efectivo' && currency === 'MXN' && cashRoundingEnabled) {
      priceToProcess = applyCashRounding(priceToProcess);
    }

    const withSurcharge = applyPaymentRate(priceToProcess, paymentType, o.transferRate, o.agencyRate);

    if (currency === 'USD' && o.exchangeRate > 0) {
      return applyUSDRoundingRules(withSurcharge / o.exchangeRate);
    }
    return withSurcharge;
  }

  // ============================================================
  // DESCUENTOS Y NODOS COMPUESTOS
  // ============================================================

  /**
   * Descuento por volumen de A-Disposicion segun horas (escalonado).
   * @param {number} hours - Horas del servicio.
   * @returns {number} Porcentaje de descuento.
   * @example
   */
  function getADisposicionDiscount(hours) {
    if (hours >= 16) return 10;
    if (hours >= 12) return 7.5;
    if (hours >= 10) return 5;
    if (hours >= 8) return 2.5;
    return 0;
  }

  /**
   * Calculo completo de A-Disposicion (version sin DOM de calculateADisposicionPricing).
   * @param {object} p - Parametros del calculo.
   * @param {number} p.baseVehicleCostPerHour - Costo base por hora por vehiculo (MXN).
   * @param {number} p.hours - Horas.
   * @param {number} p.vehicleQuantity - Cantidad de vehiculos.
   * @param {number} [p.guideRate] - Tarifa de guia por hora por vehiculo (sin recargo).
   * @param {string} [p.paymentType] - Efectivo, transferencia o tarjeta.
   * @param {string} [p.currency] - MXN o USD.
   * @param {number} [p.transferRate] - Porcentaje de recargo transferencia.
   * @param {number} [p.agencyRate] - Porcentaje de recargo tarjeta.
   * @param {number} [p.exchangeRate] - Tipo de cambio USD.
   * @param {boolean} [p.cashRoundingEnabled] - Aplicar redondeo a efectivo.
   * @returns {object} Desglose con totales por vehiculo, guia, descuento y subtotal.
   * @example
   */
  function calculateADisposicion(p) {
    const hours = Number(p.hours) || 0;
    const vehicleQuantity = Number(p.vehicleQuantity) || 0;
    const guideRate = Number(p.guideRate) || 0;

    const baseVehicleTotal = round2((Number(p.baseVehicleCostPerHour) || 0) * hours * vehicleQuantity);
    const vehicleTotalWithSurcharge = round2(applyDisplayPrice(baseVehicleTotal, p));
    const guideTotalCost = round2(guideRate * hours * vehicleQuantity);
    const baseTotal = round2(vehicleTotalWithSurcharge + guideTotalCost);

    let discountAmount = 0;
    if (hours > 0) {
      const discountPercentage = getADisposicionDiscount(hours);
      if (discountPercentage > 0) {
        // El descuento se calcula sobre el total CON recargo (coherente: descuento y
        // total sobre la misma base). Antes se calculaba sobre la base sin recargo.
        const finalCost = round2(vehicleTotalWithSurcharge + guideTotalCost);
        discountAmount = round2(finalCost * (discountPercentage / 100));
      }
    }

    const subtotal = round2(baseTotal - discountAmount);
    const divisor = hours * vehicleQuantity;

    return {
      baseVehicleTotal,
      vehicleTotalWithSurcharge,
      guideTotalCost,
      baseTotal,
      discountAmount,
      subtotal,
      finalTotal: subtotal,
      hourlyRatePerVehicle: divisor > 0 ? round2(vehicleTotalWithSurcharge / divisor) : 0,
      paymentType: p.paymentType || 'efectivo',
    };
  }

  // ============================================================
  // IVA / TOTALES
  // ============================================================

  // Tasa de IVA por defecto (16%). Configurable por parametro.
  const DEFAULT_IVA_RATE = 0.16;

  /**
   * Calcula el IVA de un subtotal.
   * @param {number} subtotal - Subtotal base.
   * @param {number} [ivaRate] - Tasa de IVA (default 0.16).
   * @returns {number} IVA redondeado a 2 decimales.
   * @example
   */
  function calcIVA(subtotal, ivaRate) {
    const rate = (ivaRate === undefined || ivaRate === null) ? DEFAULT_IVA_RATE : ivaRate;
    return round2((Number(subtotal) || 0) * rate);
  }

  /**
   * Suma subtotal mas IVA.
   * @param {number} subtotal - Subtotal base.
   * @param {number} [ivaRate] - Tasa de IVA (default 0.16).
   * @returns {number} Total con IVA.
   * @example
   */
  function calcTotalWithIVA(subtotal, ivaRate) {
    const s = Number(subtotal) || 0;
    return round2(s + calcIVA(s, ivaRate));
  }

  return {
    round2,
    applyUSDRoundingRules,
    applyCashRounding,
    applyPaymentRate,
    applyGreeterRounding,
    applyDisplayPrice,
    getADisposicionDiscount,
    calculateADisposicion,
    DEFAULT_IVA_RATE,
    calcIVA,
    calcTotalWithIVA,
  };
})();

// Exporta en Node (backend) y en el navegador (window.PricingEngine), sin build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PricingEngine;
}
if (typeof window !== 'undefined') {
  window.PricingEngine = PricingEngine;
}
