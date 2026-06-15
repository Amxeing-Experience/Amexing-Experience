/**
 * Registro de opciones de cotización — tests del data layer (costura #2).
 * Valida la forma del registro y los helpers puros (sin DOM).
 * @author Denisse Maldonado
 */

const OptionRegistry = require('../../../public/dashboards/admin/sections/quote-services/option-registry');

const SERVICE_TYPES = ['transport', 'tour', 'experience', 'a-disposicion', 'concepto'];
const PRICE_EFFECTS = ['override', 'addGuide', 'addAdditionalVehicle', 'addTransport', 'applySurcharges'];

describe('OptionRegistry — forma del registro', () => {
  it('expone las 10 opciones reales del modal', () => {
    expect(OptionRegistry.all()).toHaveLength(10);
  });

  it('cada opción tiene los campos requeridos y válidos', () => {
    OptionRegistry.all().forEach((opt) => {
      expect(typeof opt.key).toBe('string');
      expect(typeof opt.controlId).toBe('string');
      expect(Array.isArray(opt.appliesTo)).toBe(true);
      expect(opt.appliesTo.length).toBeGreaterThan(0);
      opt.appliesTo.forEach((t) => expect(SERVICE_TYPES).toContain(t));
      expect(opt.inputType).toBe('toggle');
      expect(typeof opt.label).toBe('string');
      expect(Array.isArray(opt.showsWhenChecked)).toBe(true);
      expect(PRICE_EFFECTS).toContain(opt.priceEffect);
    });
  });

  it('las keys y los controlId son únicos', () => {
    const keys = OptionRegistry.all().map((o) => o.key);
    const ids = OptionRegistry.all().map((o) => o.controlId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('OptionRegistry — helpers puros', () => {
  it('forServiceType(transport) devuelve las opciones de transporte', () => {
    const keys = OptionRegistry.forServiceType('transport').map((o) => o.key).sort();
    expect(keys).toEqual(['additionalVehicle', 'transportOverridePrices']);
  });

  it('forServiceType(tour) incluye guía, transporte y overrides de tour', () => {
    const keys = OptionRegistry.forServiceType('tour').map((o) => o.key).sort();
    expect(keys).toEqual(['includeGuide', 'tourOverridePrices', 'tourRequiresTransport', 'tourVehicleOverridePrices']);
  });

  it('forServiceType de un tipo inexistente devuelve []', () => {
    expect(OptionRegistry.forServiceType('inexistente')).toEqual([]);
  });

  it('byControlId encuentra la opción por el id del checkbox', () => {
    const opt = OptionRegistry.byControlId('additionalVehicleCheckbox');
    expect(opt).not.toBeNull();
    expect(opt.key).toBe('additionalVehicle');
  });

  it('byKey encuentra la opción por su key', () => {
    expect(OptionRegistry.byKey('includeGuide').controlId).toBe('includeGuide');
  });

  it('byControlId/byKey devuelven null si no existe', () => {
    expect(OptionRegistry.byControlId('noExiste')).toBeNull();
    expect(OptionRegistry.byKey('noExiste')).toBeNull();
  });
});

describe('OptionRegistry — visibilidad data-driven', () => {
  it('additionalVehicle declara los contenedores reales que revela el checkbox', () => {
    const opt = OptionRegistry.byKey('additionalVehicle');
    expect(opt.showsWhenChecked).toEqual([
      'additionalSegmentContainer',
      'additionalVehicleSelectContainer',
      'additionalVehiclePriceContainer',
      'extraAdditionalVehiclesContainer',
    ]);
  });
});
