/**
 * dateValidation Unit Tests
 * Covers validateDate boundaries (1900 floor, future ceilings) and the ISO helpers.
 */

const {
  validateDate, todayISO, maxFutureISO, MIN_DATE_ISO, MAX_FUTURE_YEARS,
} = require('../../../src/application/utils/dateValidation');

// Relative dates so the tests don't rot as "today" advances.
function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function addYears(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}
function toISO(d) {
  return d.toISOString().slice(0, 10);
}

describe('dateValidation', () => {
  describe('constants', () => {
    it('exposes the shared floor/ceiling used by the implementation', () => {
      expect(MIN_DATE_ISO).toBe('1900-01-01');
      expect(MAX_FUTURE_YEARS).toBe(20);
    });
  });

  describe('validateDate - optional/empty', () => {
    it('treats undefined, null and empty string as valid (field is optional)', () => {
      expect(validateDate(undefined)).toBeNull();
      expect(validateDate(null)).toBeNull();
      expect(validateDate('')).toBeNull();
    });
  });

  describe('validateDate - malformed input', () => {
    it('rejects an unparseable date and names the field', () => {
      const err = validateDate('not-a-date', { fieldName: 'Fecha de nacimiento' });
      expect(err).toEqual(expect.any(String));
      expect(err).toContain('Fecha de nacimiento');
    });
  });

  describe('validateDate - 1900 floor', () => {
    it('rejects a date before 1900-01-01', () => {
      expect(validateDate('1899-12-31')).toContain('1900');
      expect(validateDate('0500-01-01')).toContain('1900');
    });

    it('allows exactly 1900-01-01 (inclusive boundary)', () => {
      expect(validateDate('1900-01-01')).toBeNull();
    });
  });

  describe('validateDate - allowFuture: false (default)', () => {
    it('rejects a future date (tomorrow)', () => {
      const err = validateDate(toISO(addDays(1)));
      expect(err).toContain('futura');
    });

    it('rejects a future date (next year)', () => {
      const err = validateDate(toISO(addYears(1)));
      expect(err).toContain('futura');
    });

    it('allows today exactly, regardless of time-of-day (end-of-today ceiling)', () => {
      expect(validateDate(todayISO())).toBeNull();
    });

    it('allows yesterday and other past dates within range', () => {
      expect(validateDate(toISO(addDays(-1)))).toBeNull();
      expect(validateDate(toISO(addYears(-10)))).toBeNull();
    });
  });

  describe('validateDate - allowFuture: true', () => {
    it('allows a future date up to +20 years from today', () => {
      expect(validateDate(toISO(addYears(20)), { allowFuture: true })).toBeNull();
    });

    it('rejects a future date at +21 years or more', () => {
      const err = validateDate(toISO(addYears(21)), { allowFuture: true });
      expect(err).toContain('lejana');
    });

    it('honors a maxFutureYears override', () => {
      expect(validateDate(toISO(addYears(4)), { allowFuture: true, maxFutureYears: 5 })).toBeNull();
      const err = validateDate(toISO(addYears(6)), { allowFuture: true, maxFutureYears: 5 });
      expect(err).toContain('lejana');
    });
  });

  describe('validateDate - fieldName customization', () => {
    it('embeds the given fieldName in the error message', () => {
      const err = validateDate(toISO(addDays(1)), { fieldName: 'Fecha de pago' });
      expect(err).toContain('Fecha de pago');
    });
  });

  describe('validateDate - Date object vs ISO string input', () => {
    it('produces the same verdict whether value is a Date or an ISO string', () => {
      const future = addYears(1);
      const asDate = validateDate(future, { allowFuture: false });
      const asString = validateDate(toISO(future), { allowFuture: false });
      expect(asDate).toContain('futura');
      expect(asString).toContain('futura');
    });
  });

  describe('todayISO', () => {
    it('returns a YYYY-MM-DD string', () => {
      expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('maxFutureISO', () => {
    it('returns a YYYY-MM-DD string ~20 years from now', () => {
      const iso = maxFutureISO(20);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number(iso.slice(0, 4))).toBe(new Date().getFullYear() + 20);
    });
  });
});
