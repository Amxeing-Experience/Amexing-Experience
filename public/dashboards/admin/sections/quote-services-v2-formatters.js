/* eslint-env browser */
/**
 * quote-services-v2-formatters.js
 * Helpers de formato/tiempo extraidos de quote-services-v2.js (prototype de
 * ItineraryBuilder). DEBE cargarse DESPUES de quote-services-v2.js.
 * Created by Denisse Maldonado
 */

ItineraryBuilder.prototype.formatCurrency = function (amount) {
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
};

ItineraryBuilder.prototype.formatMinutesToHoursAndMinutes = function (minutes) {
    if (!minutes || minutes === 0) {
      return '0 minutos';
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    let result = '';

    if (hours > 0) {
      result += `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }

    if (remainingMinutes > 0) {
      if (result) result += ' y ';
      result += `${remainingMinutes} ${remainingMinutes === 1 ? 'minuto' : 'minutos'}`;
    }

    return result;
};

ItineraryBuilder.prototype.parseTimeForSorting = function (timeStr) {
    if (!timeStr) return 999999; // Put services without time at the end

    // Handle range formats like "08:00 - 12:00"
    const rangeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*-/);
    if (rangeMatch) {
      const hours = parseInt(rangeMatch[1], 10);
      const minutes = parseInt(rangeMatch[2], 10);
      return hours * 60 + minutes;
    }

    // Handle single time formats like "13:00"
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      return hours * 60 + minutes;
    }

    // If we can't parse it, put it at the end
    return 999999;
};

ItineraryBuilder.prototype.extractStartTimeFromSchedule = function (scheduleText) {
    if (!scheduleText) return '';

    // Handle range formats like "08:00 - 12:00" - extract start time
    const rangeMatch = scheduleText.match(/^(\d{1,2}:\d{2})\s*-/);
    if (rangeMatch) {
      return rangeMatch[1];
    }

    // Handle single time formats like "13:00"
    const timeMatch = scheduleText.match(/^(\d{1,2}:\d{2})/);
    if (timeMatch) {
      return timeMatch[1];
    }

    // If we can't extract a valid time, return empty
    return '';
};

ItineraryBuilder.prototype.parseTimeRange = function (timeStr) {
    if (!timeStr) return null;

    // Handle range formats like "08:00 - 12:00"
    const rangeMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (rangeMatch) {
      const startHours = parseInt(rangeMatch[1], 10);
      const startMinutes = parseInt(rangeMatch[2], 10);
      const endHours = parseInt(rangeMatch[3], 10);
      const endMinutes = parseInt(rangeMatch[4], 10);

      return {
        start: startHours * 60 + startMinutes,
        end: endHours * 60 + endMinutes,
      };
    }

    // Handle single time - assume 1 hour duration
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const start = hours * 60 + minutes;

      return {
        start,
        end: start + 60, // Assume 1 hour duration for single times
      };
    }

    return null;
};

ItineraryBuilder.prototype.formatTime = function (timeString) {
    // Handle different time formats
    if (!timeString) return '';

    // If it's already formatted, return as is
    if (typeof timeString === 'string' && timeString.includes(':')) {
      return timeString;
    }

    // If it's a Parse Date object
    if (timeString.iso) {
      const date = new Date(timeString.iso);
      return date.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    // If it's a JavaScript Date
    if (timeString instanceof Date) {
      return timeString.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    // Return as string if none of the above
    return String(timeString);
};

ItineraryBuilder.prototype.calculateTourEndTime = function () {
    const startTimeField = document.getElementById('tourStartTime');
    const durationField = document.getElementById('tourDuration');
    const endTimeField = document.getElementById('tourEndTime');

    if (!startTimeField || !durationField || !endTimeField) return;

    const startTime = startTimeField.value;
    const duration = parseFloat(durationField.value || 0);

    if (!startTime || !duration) return;

    // Parse start time (HH:MM format)
    const [hours, minutes] = startTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return;

    // Calculate end time
    const totalMinutes = (hours * 60) + minutes + (duration * 60);
    const endHours = Math.floor(totalMinutes / 60) % 24; // Handle day overflow
    const endMinutes = totalMinutes % 60;

    // Format as HH:MM
    const formattedEndTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;

    // Set the end time field (input de texto: acepta cualquier HH:MM).
    endTimeField.value = formattedEndTime;
};

ItineraryBuilder.prototype.calculateSuggestedDepartureTime = function (flightTime, routeDurationMinutes) {
    qsDevLog('🧮 calculateSuggestedDepartureTime called:', {
      flightTime,
      routeDurationMinutes,
    });

    if (!flightTime || !routeDurationMinutes) {
      console.warn('⚠️ Missing parameters:', { flightTime, routeDurationMinutes });
      return '';
    }

    // Parse flight time (HH:MM)
    const [hours, minutes] = flightTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      console.warn('⚠️ Invalid time format:', flightTime);
      return '';
    }

    // Convert to minutes since midnight
    let totalMinutes = hours * 60 + minutes;
    qsDevLog('📍 Step 1 - Flight time in minutes:', totalMinutes);

    // Subtract route duration + 2 hours (120 minutes)
    const bufferTime = routeDurationMinutes + 120;
    totalMinutes -= bufferTime;
    qsDevLog('📍 Step 2 - After subtracting (route + 2h):', {
      routeDuration: routeDurationMinutes,
      buffer: 120,
      totalBuffer: bufferTime,
      resultMinutes: totalMinutes,
    });

    // Handle day boundary (if negative, add 24 hours)
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60;
      qsDevLog('📍 Step 3 - Adjusted for day boundary:', totalMinutes);
    }

    // Round down to nearest 15 minutes (00, 15, 30, 45)
    const originalMinutes = totalMinutes;
    totalMinutes = Math.floor(totalMinutes / 15) * 15;
    qsDevLog('📍 Step 4 - Rounded to 15min interval:', {
      before: originalMinutes,
      after: totalMinutes,
    });

    // Convert back to HH:MM
    const suggestedHours = Math.floor(totalMinutes / 60) % 24;
    const suggestedMinutes = totalMinutes % 60;
    const result = `${String(suggestedHours).padStart(2, '0')}:${String(suggestedMinutes).padStart(2, '0')}`;

    qsDevLog('✅ Suggested departure time calculated:', result);
    return result;
};

ItineraryBuilder.prototype.roundTimeToNearest15 = function (timeString) {
    if (!timeString || !timeString.includes(':')) {
      return timeString;
    }

    // Parse time
    const [hours, minutes] = timeString.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      return timeString;
    }

    // Convert to total minutes
    let totalMinutes = hours * 60 + minutes;

    // Round DOWN to previous 15 minutes (00, 15, 30, 45)
    totalMinutes = Math.floor(totalMinutes / 15) * 15;

    // Convert back to HH:MM
    const roundedHours = Math.floor(totalMinutes / 60) % 24;
    const roundedMinutes = totalMinutes % 60;

    return `${String(roundedHours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
};

ItineraryBuilder.prototype.formatTimeInput = function (input) {
    let value = input.value.replace(/[^0-9]/g, ''); // Remove non-digits

    // Auto-format as user types
    if (value.length >= 2) {
      value = `${value.substring(0, 2)}:${value.substring(2, 4)}`;
    }

    // Validate hours (00-23) and minutes (00-59)
    if (value.length === 5) {
      const [hours, minutes] = value.split(':');
      const h = parseInt(hours);
      const m = parseInt(minutes);

      if (h > 23) {
        value = `23:${minutes}`;
      }
      if (m > 59) {
        value = `${hours}:59`;
      }
    }

    input.value = value;
};

ItineraryBuilder.prototype.restrictTimeInputKeys = function (e) {
    // Allow: backspace, delete, tab, escape, enter
    if ([8, 9, 27, 13, 46].indexOf(e.keyCode) !== -1
      // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
      || (e.keyCode === 65 && e.ctrlKey === true)
      || (e.keyCode === 67 && e.ctrlKey === true)
      || (e.keyCode === 86 && e.ctrlKey === true)
      || (e.keyCode === 88 && e.ctrlKey === true)) {
      return;
    }

    // Ensure that it's a number and stop if not
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
    }

    // Limit to 5 characters (HH:MM)
    if (e.target.value.length >= 5) {
      e.preventDefault();
    }
};

ItineraryBuilder.prototype.parseSpanishDayAbbreviations = function (availabilityString, dayOfWeek) {
    if (!availabilityString || typeof availabilityString !== 'string') {
      return false;
    }

    // Map Spanish day abbreviations to day numbers (0=Sunday, 1=Monday, etc.)
    const spanishDayMap = {
      do: 0,
      dom: 0,
      domingo: 0,
      lu: 1,
      lun: 1,
      lunes: 1,
      ma: 2,
      mar: 2,
      martes: 2,
      mi: 3,
      mie: 3,
      miércoles: 3,
      miercoles: 3,
      ju: 4,
      jue: 4,
      jueves: 4,
      vi: 5,
      vie: 5,
      viernes: 5,
      sa: 6,
      sab: 6,
      sábado: 6,
      sabado: 6,
    };

    // Convert to lowercase and split by common separators
    const dayAbbreviations = availabilityString.toLowerCase()
      .replace(/\s+/g, ' ')
      .split(/[,;|\s]+/)
      .filter((day) => day.trim().length > 0);

    // Check if the current day of week is in the available days
    for (const dayAbbr of dayAbbreviations) {
      const trimmedDay = dayAbbr.trim();
      if (spanishDayMap.hasOwnProperty(trimmedDay)) {
        const availableDay = spanishDayMap[trimmedDay];
        if (availableDay === dayOfWeek) {
          return true;
        }
      }
    }

    return false;
};
