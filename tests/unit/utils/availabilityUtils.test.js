/**
 * Availability Utils Unit Tests
 * Tests for availability utility functions
 */

const {
  dayCodesToDayNames,
  dayNamesToDayCodes,
  validateTimeFormat,
  validateAvailability,
  formatAvailabilitySummary,
  sortDayCodesChronological,
  isDayAvailable,
  DAY_NAMES_ES,
  DAY_NAMES_EN,
  DAY_NAMES_SHORT_ES,
} = require('../../../src/infrastructure/utils/availabilityUtils');

describe('Availability Utils Unit Tests', () => {
  describe('dayCodesToDayNames', () => {
    it('should convert day codes to Spanish names', () => {
      const result = dayCodesToDayNames([1, 2, 4, 0], 'es');
      expect(result).toEqual(['Lunes', 'Martes', 'Jueves', 'Domingo']);
    });

    it('should convert day codes to English names', () => {
      const result = dayCodesToDayNames([1, 2, 4, 0], 'en');
      expect(result).toEqual(['Monday', 'Tuesday', 'Thursday', 'Sunday']);
    });

    it('should convert day codes to short Spanish names', () => {
      const result = dayCodesToDayNames([1, 2, 4, 0], 'es', true);
      expect(result).toEqual(['Lu', 'Ma', 'Ju', 'Do']);
    });

    it('should throw error for invalid day code', () => {
      expect(() => dayCodesToDayNames([1, 2, 7], 'es')).toThrow('Invalid day code: 7');
    });

    it('should throw error for non-array input', () => {
      expect(() => dayCodesToDayNames('invalid', 'es')).toThrow('Codes must be an array');
    });
  });

  describe('dayNamesToDayCodes', () => {
    it('should convert Spanish day names to codes', () => {
      const result = dayNamesToDayCodes(['Lunes', 'Martes', 'Jueves'], 'es');
      expect(result).toEqual([1, 2, 4]);
    });

    it('should convert English day names to codes', () => {
      const result = dayNamesToDayCodes(['Monday', 'Tuesday', 'Thursday'], 'en');
      expect(result).toEqual([1, 2, 4]);
    });

    it('should throw error for invalid day name', () => {
      expect(() => dayNamesToDayCodes(['Lunes', 'InvalidDay'], 'es')).toThrow('Invalid day name: InvalidDay');
    });

    it('should throw error for non-array input', () => {
      expect(() => dayNamesToDayCodes('invalid', 'es')).toThrow('Names must be an array');
    });
  });

  describe('validateTimeFormat', () => {
    it('should validate correct time formats', () => {
      expect(validateTimeFormat('00:00')).toBe(true);
      expect(validateTimeFormat('13:30')).toBe(true);
      expect(validateTimeFormat('23:59')).toBe(true);
    });

    it('should reject invalid hours', () => {
      expect(validateTimeFormat('24:00')).toBe(false);
      expect(validateTimeFormat('25:30')).toBe(false);
    });

    it('should reject invalid minutes', () => {
      expect(validateTimeFormat('13:60')).toBe(false);
      expect(validateTimeFormat('13:75')).toBe(false);
    });

    it('should reject invalid formats', () => {
      expect(validateTimeFormat('1:30')).toBe(false); // Missing leading zero
      expect(validateTimeFormat('13:3')).toBe(false); // Missing leading zero
      expect(validateTimeFormat('13-30')).toBe(false); // Wrong separator
      expect(validateTimeFormat('1330')).toBe(false); // Missing separator
      expect(validateTimeFormat('abc')).toBe(false);
    });

    it('should reject non-string input', () => {
      expect(validateTimeFormat(1330)).toBe(false);
      expect(validateTimeFormat(null)).toBe(false);
      expect(validateTimeFormat(undefined)).toBe(false);
    });
  });

  describe('validateAvailability', () => {
    it('should validate correct availability data', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4, 0],
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject missing availableDays', () => {
      const result = validateAvailability({
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('availableDays is required');
    });

    it('should reject non-array availableDays', () => {
      const result = validateAvailability({
        availableDays: 'invalid',
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('availableDays must be an array');
    });

    it('should reject empty availableDays array', () => {
      const result = validateAvailability({
        availableDays: [],
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('At least one day must be selected');
    });

    it('should reject invalid day codes', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 7, 8],
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid day codes'))).toBe(true);
    });

    it('should reject duplicate day codes', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 2, 4],
        startTime: '13:30',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate day codes are not allowed');
    });

    it('should reject missing startTime', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('startTime is required');
    });

    it('should reject invalid startTime format', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        startTime: '25:00',
        endTime: '17:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid startTime format. Must be HH:MM (00:00 to 23:59)');
    });

    it('should reject missing endTime', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        startTime: '13:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('endTime is required');
    });

    it('should reject invalid endTime format', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        startTime: '13:30',
        endTime: '13:75',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid endTime format. Must be HH:MM (00:00 to 23:59)');
    });

    it('should reject endTime before startTime', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        startTime: '17:30',
        endTime: '13:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('endTime must be after startTime');
    });

    it('should reject equal startTime and endTime', () => {
      const result = validateAvailability({
        availableDays: [1, 2, 4],
        startTime: '13:30',
        endTime: '13:30',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('endTime must be after startTime');
    });
  });

  describe('formatAvailabilitySummary', () => {
    it('should format availability summary in Spanish', () => {
      const result = formatAvailabilitySummary(
        {
          availableDays: [1, 2, 4, 0],
          startTime: '13:30',
          endTime: '17:30',
        },
        'es',
      );

      expect(result).toBe('Disponible: Lu, Ma, Ju, Do de 13:30 a 17:30');
    });

    it('should format availability summary in English', () => {
      const result = formatAvailabilitySummary(
        {
          availableDays: [1, 2, 4, 0],
          startTime: '13:30',
          endTime: '17:30',
        },
        'en',
      );

      expect(result).toBe('Available: Mo, Tu, Th, Su from 13:30 to 17:30');
    });

    it('should return message for missing availability', () => {
      const result = formatAvailabilitySummary(null, 'es');
      expect(result).toBe('Sin disponibilidad definida');
    });

    it('should return message for invalid availability', () => {
      const result = formatAvailabilitySummary(
        {
          availableDays: [1, 2, 7], // Invalid day code
          startTime: '13:30',
          endTime: '17:30',
        },
        'es',
      );

      expect(result).toBe('Disponibilidad inválida');
    });
  });

  describe('sortDayCodesChronological', () => {
    it('should sort day codes with Monday first', () => {
      const result = sortDayCodesChronological([0, 4, 1, 2]);
      expect(result).toEqual([1, 2, 4, 0]); // Monday, Tuesday, Thursday, Sunday
    });

    it('should handle already sorted array', () => {
      const result = sortDayCodesChronological([1, 2, 3, 4, 5, 6, 0]);
      expect(result).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    it('should handle single day', () => {
      const result = sortDayCodesChronological([3]);
      expect(result).toEqual([3]);
    });

    it('should not modify original array', () => {
      const original = [0, 4, 1, 2];
      const result = sortDayCodesChronological(original);
      expect(original).toEqual([0, 4, 1, 2]); // Unchanged
      expect(result).toEqual([1, 2, 4, 0]); // Sorted
    });

    it('should throw error for non-array input', () => {
      expect(() => sortDayCodesChronological('invalid')).toThrow('Day codes must be an array');
    });
  });

  describe('isDayAvailable', () => {
    it('should return true for available day', () => {
      const result = isDayAvailable([1, 2, 4], 1);
      expect(result).toBe(true);
    });

    it('should return false for unavailable day', () => {
      const result = isDayAvailable([1, 2, 4], 3);
      expect(result).toBe(false);
    });

    it('should handle Sunday (0)', () => {
      const result = isDayAvailable([1, 2, 4, 0], 0);
      expect(result).toBe(true);
    });

    it('should throw error for non-array availableDays', () => {
      expect(() => isDayAvailable('invalid', 1)).toThrow('Available days must be an array');
    });

    it('should throw error for invalid day code', () => {
      expect(() => isDayAvailable([1, 2, 4], 7)).toThrow('Day code must be an integer between 0 and 6');
    });
  });

  describe('Constants', () => {
    it('should have correct Spanish day names', () => {
      expect(DAY_NAMES_ES).toEqual([
        'Domingo',
        'Lunes',
        'Martes',
        'Miércoles',
        'Jueves',
        'Viernes',
        'Sábado',
      ]);
    });

    it('should have correct English day names', () => {
      expect(DAY_NAMES_EN).toEqual([
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]);
    });

    it('should have correct short Spanish day names', () => {
      expect(DAY_NAMES_SHORT_ES).toEqual(['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa']);
    });
  });
});
