/**
 * PublicExperiencesService - Experiencias públicas agrupadas por categoría temática.
 *
 * Pensado para el render server-side de la página pública /servicios/experiencias.
 * Obtiene las EXPERIENCIAS ACTIVAS (clase Parse `Experience`, type `Experience`; excluye
 * Proveedores/Establecimientos que viven en la misma clase), resuelve su imagen primaria a
 * una URL servible y arma una "detail card" por experiencia, agrupadas por su categoría
 * temática (`experience_category`).
 *
 * Sigue el patrón de FleetService/POIService: consulta Parse con useMasterKey, resuelve
 * imágenes y devuelve data plana lista para la vista.
 * @author Amexing Development Team
 * @version 1.0.0
 * @since 1.0.0
 * @example
 * const byCat = await new PublicExperiencesService().getActiveExperiencesByCategory('es');
 */

const Parse = require('parse/node');
const logger = require('../../infrastructure/logger');
const ExperienceImage = require('../../domain/models/ExperienceImage');
const ImageOptimizationService = require('./ImageOptimizationService');
const { dayCodesToDayNames, sortDayCodesChronological } = require('../../infrastructure/utils/availabilityUtils');

// Imagen de respaldo cuando la experiencia no tiene imagen servible.
const FALLBACK_IMG = '/images/placeholder-heart.png';

// Categorías temáticas válidas (valores de `experience_category`).
const CATEGORY_VALUES = ['catas', 'arte', 'historia_arquitectura', 'gastronomicas', 'aventura', 'naturaleza', 'de_temporada'];

/**
 * PublicExperiencesService class — lógica de lectura pública de experiencias por categoría.
 */
class PublicExperiencesService {
  constructor() {
    // Para resolver presigned URLs de las fotos de experiencias de proveedor/establecimiento
    // (viven en la clase ProviderExperiencia, con photos[] optimizadas en la carpeta S3 de experiencias).
    this.imageService = new ImageOptimizationService({
      baseFolder: 'experiences',
      isPublic: false,
      deletionStrategy: process.env.S3_DELETION_STRATEGY || 'move',
      presignedUrlExpires: parseInt(process.env.S3_PRESIGNED_URL_EXPIRES, 10) || 86400,
    });
  }

  /**
   * Resuelve la URL de la foto de una experiencia de proveedor/establecimiento (o fallback).
   * Prefiere una variante optimizada compatible (webp → jpeg → avif) y si no, el original.
   * @param {Array<object>} photos - Array `photos` de la ProviderExperiencia.
   * @returns {Promise<string>} URL servible o cadena de respaldo.
   * @example
   * const url = await service.resolveProviderPhotoUrl(exp.get('photos'));
   */
  async resolveProviderPhotoUrl(photos) {
    if (!Array.isArray(photos) || photos.length === 0) {
      return FALLBACK_IMG;
    }
    try {
      const photo = photos.find((p) => p && p.isPrimary) || photos[0];
      const variants = photo.optimizedVariants || photo.formats;
      const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;
      let s3Key = null;
      if (variants && typeof variants === 'object') {
        s3Key = ['webp', 'jpeg', 'avif'].map((fmt) => keyFrom(variants[fmt])).find(Boolean) || null;
      }
      if (!s3Key) {
        s3Key = photo.s3Key || null;
      }
      if (s3Key) {
        const url = await this.imageService.getPresignedUrl(s3Key);
        return url || FALLBACK_IMG;
      }
    } catch (error) {
      logger.warn('Error resolving provider experience photo', { error: error.message });
    }
    return FALLBACK_IMG;
  }

  /**
   * Arma la "detail card" de UNA experiencia de proveedor/establecimiento.
   * @param {Parse.Object} exp - Registro ProviderExperiencia.
   * @returns {Promise<object|null>} Card lista para render, o null si falla.
   * @example
   * const card = await service.buildProviderCard(providerExperienciaRecord);
   */
  async buildProviderCard(exp) {
    try {
      const img = await this.resolveProviderPhotoUrl(exp.get('photos'));
      const { days, times } = this.normalizeAvailability(exp.get('availability'));
      const daysText = this.formatDays(days) || 'Todos los días';
      const timesText = this.formatTimes(times);

      const items = [
        { label: 'Duración', value: this.formatDuration(exp.get('duration')) },
        { label: 'Mínimo de personas', value: exp.get('min_people') || 'N/A' },
        { label: 'Días disponibles', value: daysText, block: true },
      ];
      if (timesText) {
        items.push({ label: 'Horarios disponibles', value: timesText, block: true });
      }

      return {
        title: exp.get('name'),
        img,
        bookHref: '/contacto#book',
        category: exp.get('experience_category'),
        items,
      };
    } catch (error) {
      logger.warn('Error building provider experience card', { experienceId: exp?.id, error: error.message });
      return null;
    }
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
   * @param {*} av - Valor crudo de experience.get('availability').
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
      logger.warn('Error normalizing experience availability', { error: error.message });
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
   * Resuelve la URL de la imagen primaria de una experiencia (o fallback).
   * @param {string} experienceId - ID de la experiencia.
   * @returns {Promise<string>} URL servible o cadena de respaldo.
   * @example
   * const url = await service.resolveExperienceImage('abc123');
   */
  async resolveExperienceImage(experienceId) {
    try {
      const imgs = await ExperienceImage.findByExperience(experienceId);
      if (!imgs || imgs.length === 0) {
        return FALLBACK_IMG;
      }
      const primary = imgs.find((img) => img.get('isPrimary')) || imgs[0];
      const url = await primary.getUrl();
      return url || FALLBACK_IMG;
    } catch (error) {
      logger.warn('Error resolving experience image', { experienceId, error: error.message });
      return FALLBACK_IMG;
    }
  }

  /**
   * Arma la "detail card" de UNA experiencia para la vista pública.
   * @param {Parse.Object} experience - Registro Experience.
   * @returns {Promise<object|null>} Card lista para render, o null si falla.
   * @example
   * const card = await service.buildCard(experienceRecord);
   */
  async buildCard(experience) {
    try {
      const title = experience.get('name');
      const category = experience.get('experience_category');
      const img = await this.resolveExperienceImage(experience.id);

      const { days, times } = this.normalizeAvailability(experience.get('availability'));
      const daysText = this.formatDays(days) || 'Todos los días';
      const timesText = this.formatTimes(times);

      const items = [
        { label: 'Duración', value: this.formatDuration(experience.get('duration')) },
        { label: 'Mínimo de personas', value: experience.get('min_people') || 'N/A' },
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
        category,
        items,
      };
    } catch (error) {
      logger.warn('Error building experience card', { experienceId: experience?.id, error: error.message });
      return null;
    }
  }

  /**
   * Devuelve las experiencias ACTIVAS agrupadas por su categoría temática
   * (`experience_category`). Cada valor del mapa es un array de detail cards.
   * @param {string} lang - Idioma ('es' por defecto). Reservado para futuros textos.
   * @returns {Promise<object>} Mapa { <categoryValue>: [card, ...], ... }.
   * @example
   * const byCat = await service.getActiveExperiencesByCategory('es');
   */
  async getActiveExperiencesByCategory(lang = 'es') {
    // Inicializa el mapa con todas las categorías válidas (arrays vacíos).
    const byCategory = {};
    CATEGORY_VALUES.forEach((value) => {
      byCategory[value] = [];
    });

    try {
      const query = new Parse.Query('Experience');
      query.equalTo('type', 'Experience');
      query.equalTo('active', true);
      query.equalTo('exists', true);
      query.exists('experience_category');
      query.ascending('name');
      query.limit(1000);

      const experiences = await query.find({ useMasterKey: true });
      if (!experiences.length) {
        return byCategory;
      }

      await Promise.all(experiences.map(async (experience) => {
        const category = experience.get('experience_category');
        const card = await this.buildCard(experience);
        if (!card) {
          return;
        }
        if (!Array.isArray(byCategory[category])) {
          byCategory[category] = [];
        }
        byCategory[category].push(card);
      }));

      // Experiencias de PROVEEDORES y ESTABLECIMIENTOS (clase ProviderExperiencia): también
      // tienen experience_category y deben mostrarse junto con las experiencias principales.
      const providerQuery = new Parse.Query('ProviderExperiencia');
      providerQuery.equalTo('active', true);
      providerQuery.equalTo('exists', true);
      providerQuery.exists('experience_category');
      providerQuery.ascending('name');
      providerQuery.limit(1000);
      const providerExperiencias = await providerQuery.find({ useMasterKey: true });

      await Promise.all(providerExperiencias.map(async (exp) => {
        const category = exp.get('experience_category');
        const card = await this.buildProviderCard(exp);
        if (!card) {
          return;
        }
        if (!Array.isArray(byCategory[category])) {
          byCategory[category] = [];
        }
        byCategory[category].push(card);
      }));

      return byCategory;
    } catch (error) {
      logger.error('Error building active experiences by category', { lang, error: error.message });
      return byCategory;
    }
  }

  /**
   * Resuelve la URL de la imagen única de una categoría (o fallback).
   * @param {object|null} image - Objeto imagen `{ s3Key, optimizedVariants }`.
   * @returns {Promise<string>} URL servible o respaldo.
   * @example
   */
  async resolveCategoryImageUrl(image) {
    if (!image) return FALLBACK_IMG;
    try {
      const variants = image.optimizedVariants;
      const keyFrom = (v) => (v && (v.s3Key || (typeof v === 'string' ? v : null))) || null;
      let s3Key = null;
      if (variants && typeof variants === 'object') {
        s3Key = ['webp', 'jpeg', 'avif'].map((fmt) => keyFrom(variants[fmt])).find(Boolean) || null;
      }
      if (!s3Key) {
        s3Key = image.s3Key || null;
      }
      if (s3Key) {
        const url = await this.imageService.getPresignedUrl(s3Key);
        return url || FALLBACK_IMG;
      }
    } catch (error) {
      logger.warn('Error resolving category image', { error: error.message });
    }
    return FALLBACK_IMG;
  }

  /**
   * Categorías de experiencias activas para la web pública (label por idioma + imagen).
   * @param {string} lang - Idioma ('es' | 'en').
   * @returns {Promise<Array<object>>} Array `[{ value, label, img }]` ordenado por sortOrder.
   * @example
   * const cats = await service.getActiveCategories('en');
   */
  async getActiveCategories(lang = 'es') {
    try {
      const query = new Parse.Query('ExperienceCategory');
      query.equalTo('exists', true);
      query.equalTo('active', true);
      query.ascending('sortOrder');
      query.addAscending('name');
      query.limit(500);

      const cats = await query.find({ useMasterKey: true });
      return Promise.all(
        cats.map(async (c) => ({
          value: c.get('code'),
          label: lang === 'en' ? c.get('name_en') || c.get('name') : c.get('name'),
          img: await this.resolveCategoryImageUrl(c.get('image')),
        }))
      );
    } catch (error) {
      logger.error('Error building active categories', { lang, error: error.message });
      return [];
    }
  }
}

module.exports = PublicExperiencesService;
