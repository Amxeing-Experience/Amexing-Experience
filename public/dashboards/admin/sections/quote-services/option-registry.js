/**
 * Registro de opciones de cotización (data-driven) — costura #2.
 *
 * Declara, como DATOS, cada opción que modifica el costo de un servicio en el builder.
 * Hoy esas opciones están hardcodeadas por tipo de servicio (cada checkbox controla a
 * la vez visibilidad y precio, enredado en ~50 métodos y 279 classList dispersos).
 * Este registro las vuelve una lista declarativa: agregar/quitar una opción = editar
 * este archivo, no 4-5 archivos.
 *
 * Cada entrada describe:
 *  - key: identificador estable de la opción.
 *  - controlId: id del checkbox/control en el modal (confirmado en quote-services-modals.ejs).
 *  - appliesTo: tipos de servicio donde aplica.
 *  - inputType: tipo de control ('toggle' por ahora; luego 'number'/'select').
 *  - label: etiqueta para UI.
 *  - showsWhenChecked: ids de contenedores a MOSTRAR cuando se activa (la visibilidad se
 *    deriva de aquí; reemplaza los classList dispersos). Solo se llenan los verificados.
 *  - priceEffect: cómo modifica el costo (descriptor; se mapea al motor/builder al cablear):
 *      'override'             → habilita captura de precio manual
 *      'addGuide'             → suma costo de guía
 *      'addAdditionalVehicle' → suma vehículo(s) adicional(es)
 *      'addTransport'         → suma costo de transporte al tour
 *      'applySurcharges'      → aplica recargos por forma de pago al concepto
 *
 * NOTA: el cableado (que setupEventListeners y el reset deriven de este registro) es el
 * siguiente incremento; aquí va el data layer + helpers puros + tests.
 *
 * @module optionRegistry
 * @author Denisse Maldonado
 */
(function defineOptionRegistry() {
  var OPTIONS = [
    {
      key: 'additionalVehicle',
      controlId: 'additionalVehicleCheckbox',
      appliesTo: ['transport'],
      inputType: 'toggle',
      label: 'Vehículo adicional',
      // Contenedores que revela el checkbox (verificado contra el handler real en
      // quote-services-v2.js: additionalVehicleCheckbox change). NO incluye
      // additionalVehicleContainer (wrapper del propio checkbox, manejado por el
      // cambio de tipo de servicio, no por esta opción).
      showsWhenChecked: [
        'additionalSegmentContainer',
        'additionalVehicleSelectContainer',
        'additionalVehiclePriceContainer',
        'extraAdditionalVehiclesContainer',
      ],
      priceEffect: 'addAdditionalVehicle',
    },
    {
      key: 'tourRequiresTransport',
      controlId: 'tourRequiresTransport',
      appliesTo: ['tour'],
      inputType: 'toggle',
      label: 'Requiere transporte',
      showsWhenChecked: [], // verificar contenedores al cablear
      priceEffect: 'addTransport',
    },
    {
      key: 'includeGuide',
      controlId: 'includeGuide',
      appliesTo: ['tour'],
      inputType: 'toggle',
      label: 'Incluir guía',
      showsWhenChecked: [],
      priceEffect: 'addGuide',
    },
    {
      key: 'aDisposicionGuide',
      controlId: 'aDisposicionGuide',
      appliesTo: ['a-disposicion'],
      inputType: 'toggle',
      label: 'Incluir guía',
      showsWhenChecked: [],
      priceEffect: 'addGuide',
    },
    {
      key: 'tourOverridePrices',
      controlId: 'tourOverridePrices',
      appliesTo: ['tour'],
      inputType: 'toggle',
      label: 'Editar precios manualmente',
      showsWhenChecked: [],
      priceEffect: 'override',
    },
    {
      key: 'tourVehicleOverridePrices',
      controlId: 'tourVehicleOverridePrices',
      appliesTo: ['tour'],
      inputType: 'toggle',
      label: 'Editar precio de vehículo',
      showsWhenChecked: [],
      priceEffect: 'override',
    },
    {
      key: 'transportOverridePrices',
      controlId: 'transportOverridePrices',
      appliesTo: ['transport'],
      inputType: 'toggle',
      label: 'Editar precios manualmente',
      showsWhenChecked: [],
      priceEffect: 'override',
    },
    {
      key: 'experienceOverridePrices',
      controlId: 'experienceOverridePrices',
      appliesTo: ['experience'],
      inputType: 'toggle',
      label: 'Editar precios manualmente',
      showsWhenChecked: [],
      priceEffect: 'override',
    },
    {
      key: 'aDisposicionOverridePrices',
      controlId: 'aDisposicionOverridePrices',
      appliesTo: ['a-disposicion'],
      inputType: 'toggle',
      label: 'Editar precios manualmente',
      showsWhenChecked: [],
      priceEffect: 'override',
    },
    {
      key: 'conceptoApplySurcharges',
      controlId: 'conceptoApplySurcharges',
      appliesTo: ['concepto'],
      inputType: 'toggle',
      label: 'Aplicar recargos',
      showsWhenChecked: [],
      priceEffect: 'applySurcharges',
    },
  ];

  // Helpers puros (sin DOM) — testeables.
  var OptionRegistry = {
    /** Todas las opciones declaradas. @returns {Array<object>} */
    all: function all() {
      return OPTIONS.slice();
    },
    /**
     * Opciones que aplican a un tipo de servicio.
     * @param {string} serviceType - transport|tour|experience|a-disposicion|concepto.
     * @returns {Array<object>}
     */
    forServiceType: function forServiceType(serviceType) {
      return OPTIONS.filter(function applies(opt) {
        return opt.appliesTo.indexOf(serviceType) !== -1;
      });
    },
    /**
     * Busca una opción por el id de su control (checkbox).
     * @param {string} controlId
     * @returns {object|null}
     */
    byControlId: function byControlId(controlId) {
      return OPTIONS.find(function match(opt) {
        return opt.controlId === controlId;
      }) || null;
    },
    /**
     * Busca una opción por su key.
     * @param {string} key
     * @returns {object|null}
     */
    byKey: function byKey(key) {
      return OPTIONS.find(function match(opt) {
        return opt.key === key;
      }) || null;
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptionRegistry;
  }
  if (typeof window !== 'undefined') {
    window.QuoteOptionRegistry = OptionRegistry;
  }
}());
