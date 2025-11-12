/**
 * Availability Utilities
 * Helper functions for tour availability management (days of week and time validation).
 * @module infrastructure/utils/availabilityUtils
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * Day names in Spanish.
 * @constant {string[]}
 */
const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Day names in English.
 * @constant {string[]}
 */
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Short day names in Spanish.
 * @constant {string[]}
 */
const DAY_NAMES_SHORT_ES = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

/**
 * Short day names in English.
 * @constant {string[]}
 */
const DAY_NAMES_SHORT_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Time format regex (HH:MM format, 00:00 to 23:59).
 * @constant {RegExp}
 */
const TIME_FORMAT_REGEX = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Convert day codes to day names.
 * @param {number[]} codes - Array of day codes (0-6, where 0=Sunday).
 * @param {string} language - Language code ('es' or 'en').
 * @param {boolean} short - Return short names (e.g., 'Lu' instead of 'Lunes').
 * @returns {string[]} Array of day names.
 * @example
 * dayCodesToDayNames([1, 2, 4, 0], 'es') // ['Lunes', 'Martes', 'Jueves', 'Domingo']
 * dayCodesToDayNames([1, 2], 'es', true) // ['Lu', 'Ma']
 */
function dayCodesToDayNames(codes, language = 'es', short = false) {
  if (!Array.isArray(codes)) {
    throw new Error('Codes must be an array');
  }

  let names;
  if (short && language === 'es') {
    names = DAY_NAMES_SHORT_ES;
  } else if (short && language === 'en') {
    names = DAY_NAMES_SHORT_EN;
  } else if (language === 'es') {
    names = DAY_NAMES_ES;
  } else {
    names = DAY_NAMES_EN;
  }

  return codes.map((code) => {
    if (!Number.isInteger(code) || code < 0 || code > 6) {
      throw new Error(`Invalid day code: ${code}. Must be an integer between 0 and 6.`);
    }
    return names[code];
  });
}

/**
 * Convert day names to day codes.
 * @param {string[]} names - Array of day names.
 * @param {string} language - Language code ('es' or 'en').
 * @returns {number[]} Array of day codes (0-6).
 * @example
 * dayNamesToDayCodes(['Lunes', 'Martes'], 'es') // [1, 2]
 */
function dayNamesToDayCodes(names, language = 'es') {
  if (!Array.isArray(names)) {
    throw new Error('Names must be an array');
  }

  const nameList = language === 'es' ? DAY_NAMES_ES : DAY_NAMES_EN;

  return names.map((name) => {
    const code = nameList.indexOf(name);
    if (code === -1) {
      throw new Error(`Invalid day name: ${name}`);
    }
    return code;
  });
}

/**
 * Validate time format (HH:MM).
 * @param {string} time - Time string to validate.
 * @returns {boolean} True if valid, false otherwise.
 * @example
 * validateTimeFormat('13:30') // true
 * validateTimeFormat('25:00') // false
 * validateTimeFormat('13:75') // false
 */
function validateTimeFormat(time) {
  if (typeof time !== 'string') {
    return false;
  }
  return TIME_FORMAT_REGEX.test(time);
}

/**
 * Validate availability data structure.
 * @param {object} availability - Availability object to validate.
 * @param {number[]} availability.availableDays - Array of day codes (0-6).
 * @param {string} availability.startTime - Start time (HH:MM).
 * @param {string} availability.endTime - End time (HH:MM).
 * @returns {object} Validation result with errors array.
 * @example
 * validateAvailability({ availableDays: [1, 2], startTime: '13:30', endTime: '17:30' })
 * // { valid: true, errors: [] }
 */
function validateAvailability(availability) {
  const errors = [];

  // Validate availableDays
  if (!availability.availableDays) {
    errors.push('availableDays is required');
  } else if (!Array.isArray(availability.availableDays)) {
    errors.push('availableDays must be an array');
  } else if (availability.availableDays.length === 0) {
    errors.push('At least one day must be selected');
  } else {
    // Validate each day code
    const invalidDays = availability.availableDays.filter(
      (day) => !Number.isInteger(day) || day < 0 || day > 6
    );
    if (invalidDays.length > 0) {
      errors.push(`Invalid day codes: ${invalidDays.join(', ')}. Must be integers between 0 and 6.`);
    }

    // Check for duplicates
    const uniqueDays = new Set(availability.availableDays);
    if (uniqueDays.size !== availability.availableDays.length) {
      errors.push('Duplicate day codes are not allowed');
    }
  }

  // Validate startTime
  if (!availability.startTime) {
    errors.push('startTime is required');
  } else if (!validateTimeFormat(availability.startTime)) {
    errors.push('Invalid startTime format. Must be HH:MM (00:00 to 23:59)');
  }

  // Validate endTime
  if (!availability.endTime) {
    errors.push('endTime is required');
  } else if (!validateTimeFormat(availability.endTime)) {
    errors.push('Invalid endTime format. Must be HH:MM (00:00 to 23:59)');
  }

  // Validate time range (endTime must be after startTime)
  if (
    availability.startTime
    && availability.endTime
    && validateTimeFormat(availability.startTime)
    && validateTimeFormat(availability.endTime)
  ) {
    if (availability.startTime >= availability.endTime) {
      errors.push('endTime must be after startTime');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format availability as human-readable string.
 * @param {object} availability - Availability object.
 * @param {number[]} availability.availableDays - Array of day codes (0-6).
 * @param {string} availability.startTime - Start time (HH:MM).
 * @param {string} availability.endTime - End time (HH:MM).
 * @param {string} language - Language code ('es' or 'en').
 * @returns {string} Formatted availability string.
 * @example
 * formatAvailabilitySummary({ availableDays: [1, 2, 4, 0], startTime: '13:30', endTime: '17:30' }, 'es')
 * // 'Disponible: Lu, Ma, Ju, Do de 13:30 a 17:30'
 */
function formatAvailabilitySummary(availability, language = 'es') {
  if (!availability || !availability.availableDays || !availability.startTime || !availability.endTime) {
    return language === 'es' ? 'Sin disponibilidad definida' : 'No availability defined';
  }

  const validation = validateAvailability(availability);
  if (!validation.valid) {
    return language === 'es' ? 'Disponibilidad inválida' : 'Invalid availability';
  }

  const dayNames = dayCodesToDayNames(availability.availableDays, language, true);
  const daysList = dayNames.join(', ');

  if (language === 'es') {
    return `Disponible: ${daysList} de ${availability.startTime} a ${availability.endTime}`;
  }
  return `Available: ${daysList} from ${availability.startTime} to ${availability.endTime}`;
}

/**
 * Sort day codes in chronological order (Monday first, Sunday last).
 * @param {number[]} dayCodes - Array of day codes (0-6).
 * @returns {number[]} Sorted array starting from Monday.
 * @example
 * sortDayCodesChronological([0, 1, 4, 2]) // [1, 2, 4, 0] (Monday, Tuesday, Thursday, Sunday)
 */
function sortDayCodesChronological(dayCodes) {
  if (!Array.isArray(dayCodes)) {
    throw new Error('Day codes must be an array');
  }

  // Sort with Monday (1) first, Sunday (0) last
  return [...dayCodes].sort((a, b) => {
    // Sunday (0) should be last, so treat it as 7 for sorting
    const aVal = a === 0 ? 7 : a;
    const bVal = b === 0 ? 7 : b;
    return aVal - bVal;
  });
}

/**
 * Check if a specific day is available.
 * @param {number[]} availableDays - Array of available day codes.
 * @param {number} dayCode - Day code to check (0-6).
 * @returns {boolean} True if day is available.
 * @example
 * isDayAvailable([1, 2, 4], 1) // true (Monday is available)
 * isDayAvailable([1, 2, 4], 3) // false (Wednesday not available)
 */
function isDayAvailable(availableDays, dayCode) {
  if (!Array.isArray(availableDays)) {
    throw new Error('Available days must be an array');
  }
  if (!Number.isInteger(dayCode) || dayCode < 0 || dayCode > 6) {
    throw new Error('Day code must be an integer between 0 and 6');
  }
  return availableDays.includes(dayCode);
}

/**
 * Validate a single day schedule object (NEW FORMAT).
 * @param {object} schedule - Schedule object { day, startTime, endTime }.
 * @param {number} schedule.day - Day code (0-6).
 * @param {string} schedule.startTime - Start time (HH:MM).
 * @param {string} schedule.endTime - End time (HH:MM).
 * @returns {object} Validation result { valid, errors }.
 * @example
 * validateDaySchedule({ day: 1, startTime: '09:00', endTime: '17:00' })
 * // { valid: true, errors: [] }
 */
function validateDaySchedule(schedule) {
  const errors = [];

  if (!schedule || typeof schedule !== 'object') {
    errors.push('Schedule must be an object');
    return { valid: false, errors };
  }

  // Validate day code
  if (!Number.isInteger(schedule.day) || schedule.day < 0 || schedule.day > 6) {
    errors.push(`Invalid day code: ${schedule.day}. Must be 0-6.`);
  }

  // Validate startTime
  if (!schedule.startTime) {
    errors.push(`startTime is required for day ${schedule.day}`);
  } else if (!validateTimeFormat(schedule.startTime)) {
    errors.push(`Invalid startTime format for day ${schedule.day}: ${schedule.startTime}. Must be HH:MM (00:00 to 23:59)`);
  }

  // Validate endTime
  if (!schedule.endTime) {
    errors.push(`endTime is required for day ${schedule.day}`);
  } else if (!validateTimeFormat(schedule.endTime)) {
    errors.push(`Invalid endTime format for day ${schedule.day}: ${schedule.endTime}. Must be HH:MM (00:00 to 23:59)`);
  }

  // Validate time range
  if (schedule.startTime && schedule.endTime
      && validateTimeFormat(schedule.startTime)
      && validateTimeFormat(schedule.endTime)) {
    if (schedule.startTime >= schedule.endTime) {
      errors.push(`endTime must be after startTime for day ${schedule.day}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate array of day schedules (NEW FORMAT).
 * @param {Array<object>} schedules - Array of schedule objects.
 * @returns {object} Validation result { valid, errors }.
 * @example
 * validateDaySchedules([
 *   { day: 1, startTime: '09:00', endTime: '17:00' },
 *   { day: 2, startTime: '10:00', endTime: '18:00' }
 * ])
 * // { valid: true, errors: [] }
 */
function validateDaySchedules(schedules) {
  const errors = [];

  if (!Array.isArray(schedules)) {
    errors.push('Availability must be an array');
    return { valid: false, errors };
  }

  if (schedules.length === 0) {
    errors.push('At least one day schedule must be provided');
    return { valid: false, errors };
  }

  // Check for duplicate days
  const daysSeen = new Set();
  schedules.forEach((schedule) => {
    if (schedule && typeof schedule === 'object' && 'day' in schedule) {
      if (daysSeen.has(schedule.day)) {
        errors.push(`Duplicate day code: ${schedule.day}`);
      }
      daysSeen.add(schedule.day);
    }
  });

  // Validate each schedule
  schedules.forEach((schedule) => {
    const validation = validateDaySchedule(schedule);
    if (!validation.valid) {
      errors.push(...validation.errors);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Format a single day schedule as human-readable string.
 * @param {object} schedule - Schedule object { day, startTime, endTime }.
 * @param {string} language - Language code ('es' or 'en').
 * @returns {string} Formatted string.
 * @example
 * formatDaySchedule({ day: 1, startTime: '09:00', endTime: '17:00' }, 'es')
 * // 'Lunes: 09:00 a 17:00'
 */
function formatDaySchedule(schedule, language = 'es') {
  if (!schedule || !schedule.day || !schedule.startTime || !schedule.endTime) {
    return language === 'es' ? 'Horario inválido' : 'Invalid schedule';
  }

  const dayName = dayCodesToDayNames([schedule.day], language)[0];
  const separator = language === 'es' ? 'a' : 'to';
  return `${dayName}: ${schedule.startTime} ${separator} ${schedule.endTime}`;
}

/**
 * Format array of day schedules as human-readable string (NEW FORMAT).
 * @param {Array<object>} schedules - Array of schedule objects.
 * @param {string} language - Language code ('es' or 'en').
 * @returns {string} Formatted availability string.
 * @example
 * formatDaySchedulesSummary([
 *   { day: 1, startTime: '09:00', endTime: '17:00' },
 *   { day: 2, startTime: '10:00', endTime: '18:00' }
 * ], 'es')
 * // 'Lunes: 09:00 a 17:00, Martes: 10:00 a 18:00'
 */
function formatDaySchedulesSummary(schedules, language = 'es') {
  if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
    return language === 'es' ? 'Sin disponibilidad definida' : 'No availability defined';
  }

  const validation = validateDaySchedules(schedules);
  if (!validation.valid) {
    return language === 'es' ? 'Disponibilidad inválida' : 'Invalid availability';
  }

  // Sort schedules chronologically
  const sortedSchedules = [...schedules].sort((a, b) => {
    const aVal = a.day === 0 ? 7 : a.day;
    const bVal = b.day === 0 ? 7 : b.day;
    return aVal - bVal;
  });

  // Format each schedule
  const formattedSchedules = sortedSchedules.map((schedule) => formatDaySchedule(schedule, language));

  return formattedSchedules.join(', ');
}

/**
 * Sort day schedules in chronological order (Monday first, Sunday last).
 * @param {Array<object>} schedules - Array of schedule objects.
 * @returns {Array<object>} Sorted array starting from Monday.
 * @example
 * sortDaySchedulesChronological([
 *   { day: 0, startTime: '08:00', endTime: '14:00' },
 *   { day: 1, startTime: '09:00', endTime: '17:00' }
 * ])
 * // [{ day: 1, ...}, { day: 0, ...}]
 */
function sortDaySchedulesChronological(schedules) {
  if (!Array.isArray(schedules)) {
    throw new Error('Schedules must be an array');
  }

  // Sort with Monday (1) first, Sunday (0) last
  return [...schedules].sort((a, b) => {
    // Sunday (0) should be last, so treat it as 7 for sorting
    const aVal = a.day === 0 ? 7 : a.day;
    const bVal = b.day === 0 ? 7 : b.day;
    return aVal - bVal;
  });
}

module.exports = {
  // Constants
  DAY_NAMES_ES,
  DAY_NAMES_EN,
  DAY_NAMES_SHORT_ES,
  DAY_NAMES_SHORT_EN,
  TIME_FORMAT_REGEX,

  // Legacy Functions (for backward compatibility)
  dayCodesToDayNames,
  dayNamesToDayCodes,
  validateTimeFormat,
  validateAvailability,
  formatAvailabilitySummary,
  sortDayCodesChronological,
  isDayAvailable,

  // New Functions (day-specific schedules)
  validateDaySchedule,
  validateDaySchedules,
  formatDaySchedule,
  formatDaySchedulesSummary,
  sortDaySchedulesChronological,
};
