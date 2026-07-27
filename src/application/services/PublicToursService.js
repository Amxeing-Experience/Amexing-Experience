/**
 * PublicToursService - Tours públicos agrupados por DESTINO (POI).
 *
 * Pensado para el render server-side de la página pública /servicios/tours.
 * Obtiene los TOURS ACTIVOS (clase Parse `Tour`), resuelve su imagen primaria a una URL
 * servible y arma una "detail card" por tour, agrupados por su destino (`destinationPOI`).
 *
 * Sigue el patrón de PublicExperiencesService: consulta Parse con useMasterKey, resuelve
 * imágenes y devuelve data plana lista para la vista. Copia verbatim los helpers de
 * normalización/formato de disponibilidad de PublicExperiencesService.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const byDestino = await new PublicToursService().getActiveToursByDestino('es');
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const ImageOptimizationService = require('./ImageOptimizationService');
const POIService = require('./POIService');
const { dayCodesToDayNames, sortDayCodesChronological } = require('../../infrastructure/utils/availabilityUtils');

// Imagen de respaldo cuando el tour no tiene imagen servible ni imagen de destino.
const FALLBACK_IMG = '/images/placeholder-heart.png';

/**
 * PublicToursService class — lógica de lectura pública de tours por destino.
 */
class PublicToursService {
  constructor() {
    // Para resolver presigned URLs de las imágenes de tours (clase TourImage, con
    // optimizedVariants en la carpeta S3 de tours).
    this.imageService = new ImageOptimizationService({
      baseFolder: 'tours',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });
    // Para resolver la imagen del destino (POI) como fallback de la card del tour.
    this.poiService = new POIService();
  }

  /**
   * Convierte una hora "HH:MM" (24h) a formato 12h am/pm (p.ej. '13:00' → '1:00 pm').
   * Devuelve la cadena original si no tiene el formato esperado.
   * @param {string} hhmm - Hora en formato "HH:MM".
   * @returns {string} Hora en formato 12h am/pm.
   * @example
   * service.formatTime12h('16:00'); // '4:00 pm'
   */
  formatTime12h(hhmm) {
    if (typeof hhmm !== 'string') {
      return '';
    }
    const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return hhmm;
    }
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const suffix = hour >= 12 ? 'pm' : 'am';
    hour %= 12;
    if (hour === 0) {
      hour = 12;
    }
    return `${hour}:${minute} ${suffix}`;
  }

  /**
   * Une una lista de textos con comas y un " y " final (estilo español).
   * @param {string[]} parts - Textos a unir.
   * @returns {string} Cadena unida (p.ej. 'a, b y c').
   * @example
   * service.joinWithAnd(['lunes', 'martes', 'jueves']); // 'lunes, martes y jueves'
   */
  joinWithAnd(parts) {
    const list = (parts || []).filter(Boolean);
    if (list.length === 0) {
      return '';
    }
    if (list.length === 1) {
      return list[0];
    }
    return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
  }

  /**
   * Normaliza el campo `availability` (con varias formas históricas) a códigos de día
   * (0-6) y horas de inicio "HH:MM". Defensivo: nunca lanza.
   * @param {*} av - Valor crudo de tour.get('availability').
   * @returns {{days: number[], times: string[]}} Días y horas normalizados.
   * @example
   * service.normalizeAvailability([{ day: 1, times: [{ start: '09:00' }] }]);
   */
  normalizeAvailability(av) {
    const days = [];
    const times = [];

    if (!av) {
      return { days, times };
    }

    try {
      // Shape A: array por día — [{ day, times: [{ start, end }] }]
      if (Array.isArray(av)) {
        av.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          if (Number.isInteger(entry.day)) {
            days.push(entry.day);
          }
          if (Array.isArray(entry.times)) {
            entry.times.forEach((slot) => {
              if (slot && slot.start) {
                times.push(slot.start);
              }
            });
          } else if (entry.startTime) {
            // Tolerancia: formato plano por día { day, startTime, endTime }
            times.push(entry.startTime);
          }
        });
        return { days, times };
      }

      // Shape B: ventana única — { availableDays, startTime, endTime }
      if (typeof av === 'object') {
        if (Array.isArray(av.availableDays)) {
          av.availableDays.forEach((d) => {
            if (Number.isInteger(d)) {
              days.push(d);
            }
          });
        }
        if (av.startTime) {
          times.push(av.startTime);
        }
        return { days, times };
      }
    } catch (error) {
      logger.warn('Error normalizing tour availability', { error: error.message });
    }

    return { days, times };
  }

  /**
   * Formatea los días disponibles en texto español (p.ej. 'lunes, martes y jueves').
   * @param {number[]} dayCodes - Códigos de día (0-6).
   * @returns {string} Días formateados; '' si no hay.
   * @example
   * service.formatDays([1, 2, 4]); // 'lunes, martes y jueves'
   */
  formatDays(dayCodes) {
    const unique = [...new Set((dayCodes || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
    if (unique.length === 0) {
      return '';
    }
    const sorted = sortDayCodesChronological(unique);
    const names = dayCodesToDayNames(sorted, 'es', false).map((n) => n.toLowerCase());
    return this.joinWithAnd(names);
  }

  /**
   * Formatea las horas de inicio en 12h am/pm (p.ej. '9:00 am, 1:00 pm y 4:00 pm').
   * @param {string[]} startTimes - Horas "HH:MM".
   * @returns {string} Horas formateadas; '' si no hay.
   * @example
   * service.formatTimes(['09:00', '13:00', '16:00']);
   */
  formatTimes(startTimes) {
    const unique = [...new Set((startTimes || []).filter(Boolean))];
    if (unique.length === 0) {
      return '';
    }
    const formatted = unique.map((t) => this.formatTime12h(t));
    return this.joinWithAnd(formatted);
  }

  /**
   * Formatea la duración (en MINUTOS) a horas legibles (p.ej. 360 → '6 hrs.', 90 → '1.5 hrs.').
   * @param {number} duration - Duración en minutos.
   * @returns {string} Duración formateada o 'Por definir'.
   * @example
   * service.formatDuration(360); // '6 hrs.'
   */
  formatDuration(duration) {
    if (!duration) {
      return 'Por definir';
    }
    const hours = +(duration / 60).toFixed(duration % 60 === 0 ? 0 : 1);
    return `${hours} hrs.`;
  }

  /**
   * Resuelve la URL de la imagen primaria de un tour (clase TourImage). No aplica fallback:
   * el llamador decide el fallback a la imagen del destino.
   * @param {string} tourId - ID del tour.
   * @returns {Promise<string|null>} URL servible o null si no hay/falla.
   * @example
   * const url = await service.resolveTourImageUrl('abc123');
   */
  async resolveTourImageUrl(tourId) {
    try {
      const tourPointer = new Parse.Object('Tour');
      tourPointer.id = tourId;

      const query = new Parse.Query('TourImage');
      query.equalTo('tourId', tourPointer);
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.ascending('displayOrder');
      const images = await query.find({ useMasterKey: true });
      if (!images || images.length === 0) {
        return null;
      }

      const image = images.find((img) => img.get('isPrimary')) || images[0];
      const variants = image.get('optimizedVariants');
      /**
       * Extrae la s3Key de una variante de imagen (objeto con s3Key, o string).
       * @param {object|string} v - Variante de imagen.
       * @returns {string|null} La s3Key o null.
       */
      const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;
      let s3Key = null;
      if (variants && typeof variants === 'object') {
        s3Key = ['webp', 'jpeg', 'avif'].map((fmt) => keyFrom(variants[fmt])).find(Boolean) || null;
      }
      if (!s3Key) {
        s3Key = image.get('s3Key') || null;
      }
      if (s3Key) {
        const url = await this.imageService.getPresignedUrl(s3Key);
        return url || null;
      }
    } catch (error) {
      logger.warn('Error resolving tour image', { tourId, error: error.message });
    }
    return null;
  }

  /**
   * Arma la "detail card" de UN tour para la vista pública.
   * @param {Parse.Object} tour - Registro Tour.
   * @param {string|null} destinoImageUrl - URL de la imagen del destino (fallback).
   * @returns {Promise<object|null>} Card lista para render, o null si falla.
   * @example
   * const card = await service.buildTourCard(tourRecord, destinoImageUrl);
   */
  async buildTourCard(tour, destinoImageUrl) {
    try {
      const title = tour.get('isWalkingTour') === true ? 'Recorrido a pie' : 'Recorrido';
      const img = (await this.resolveTourImageUrl(tour.id)) || destinoImageUrl || FALLBACK_IMG;

      const { days, times } = this.normalizeAvailability(tour.get('availability') || tour.get('availableDays'));
      const daysText = this.formatDays(days) || 'Todos los días';
      const timesText = this.formatTimes(times);

      const items = [
        { label: 'Duración', value: this.formatDuration(tour.get('time')) },
        { label: 'Días disponibles', value: daysText, block: true },
      ];

      // Horarios: se omite el item por completo si no hay horas.
      if (timesText) {
        items.push({ label: 'Horarios disponibles', value: timesText, block: true });
      }

      return {
        title,
        img,
        bookHref: '/contacto#book',
        destino: tour.get('destinationPOI') ? tour.get('destinationPOI').id : '',
        items,
      };
    } catch (error) {
      logger.warn('Error building tour card', { tourId: tour?.id, error: error.message });
      return null;
    }
  }

  /**
   * Devuelve los tours ACTIVOS agrupados por su destino (`destinationPOI`). Cada valor del
   * mapa es un array de detail cards.
   * @param {string} lang - Idioma ('es' por defecto). Reservado para futuros textos.
   * @returns {Promise<object>} Mapa { <poiId>: [card, ...], ... }.
   * @example
   * const byDestino = await service.getActiveToursByDestino('es');
   */
  async getActiveToursByDestino(lang = 'es') {
    const byDestino = {};

    try {
      const query = new Parse.Query('Tour');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.exists('destinationPOI');
      query.include('destinationPOI');
      query.limit(1000);

      const tours = await query.find({ useMasterKey: true });
      if (!tours.length) {
        return byDestino;
      }

      // Agrupa por destino y resuelve la imagen del destino UNA vez por destino.
      const destinoImageCache = {};
      await Promise.all(tours.map(async (tour) => {
        const destinoPOI = tour.get('destinationPOI');
        if (!destinoPOI) {
          return;
        }
        const poiId = destinoPOI.id;

        if (!(poiId in destinoImageCache)) {
          let destinoImageUrl = null;
          try {
            destinoImageUrl = await this.poiService.resolvePOIImageUrl(destinoPOI.get('image'));
          } catch (error) {
            logger.warn('Error resolving destino image for tours', { poiId, error: error.message });
          }
          destinoImageCache[poiId] = destinoImageUrl || null;
        }

        const card = await this.buildTourCard(tour, destinoImageCache[poiId]);
        if (!card) {
          return;
        }
        if (!Array.isArray(byDestino[poiId])) {
          byDestino[poiId] = [];
        }
        byDestino[poiId].push(card);
      }));

      return byDestino;
    } catch (error) {
      logger.error('Error building active tours by destino', { lang, error: error.message });
      return byDestino;
    }
  }

  /**
   * Fusiona los destinos "Walking Tour X" dentro del destino base "X" SOLO para el render
   * público: sus tours se agrupan bajo "X" (como una card más) y el chip "Walking Tour X" se
   * oculta del strip. No toca datos: el tour, el POI, el admin, el tarifario y las cotizaciones
   * quedan intactos; es puramente presentación de /servicios/tours. Si no existe un destino
   * base "X", el destino "Walking Tour X" se deja como está (fallback seguro).
   * @param {Array<{id:string,name:string,imageUrl:string}>} tourDestinos - Destinos del strip.
   * @param {object} toursByDestino - Mapa { <poiId>: [cards] } de getActiveToursByDestino.
   * @returns {{tourDestinos: Array, toursByDestino: object}} Destinos y mapa ya fusionados.
   * @example
   * const { tourDestinos, toursByDestino } = service.mergeWalkingDestinos(destinos, mapa);
   */
  mergeWalkingDestinos(tourDestinos, toursByDestino) {
    const destinos = Array.isArray(tourDestinos) ? tourDestinos : [];
    const merged = { ...(toursByDestino || {}) };

    // Índice nombre(normalizado) → id de destino base.
    const idByName = new Map();
    destinos.forEach((d) => idByName.set((d.name || '').trim().toLowerCase(), d.id));

    const hiddenIds = new Set();
    destinos.forEach((d) => {
      const match = (d.name || '').match(/^walking tour\s+(.+)$/i);
      if (!match) {
        return;
      }
      const baseId = idByName.get(match[1].trim().toLowerCase());
      if (!baseId || baseId === d.id) {
        return; // sin destino base "X" → se deja tal cual (fallback seguro)
      }
      const walkingCards = merged[d.id] || [];
      if (walkingCards.length) {
        merged[baseId] = (merged[baseId] || []).concat(walkingCards);
      }
      delete merged[d.id];
      hiddenIds.add(d.id);
    });

    return {
      tourDestinos: destinos.filter((d) => !hiddenIds.has(d.id)),
      toursByDestino: merged,
    };
  }
}

module.exports = PublicToursService;
