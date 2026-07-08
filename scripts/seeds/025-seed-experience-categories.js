/**
 * Seed 025 - Experience Categories.
 *
 * Siembra las 7 categorías de experiencias que hoy están hardcodeadas en el
 * frontend (catas, arte, historia_arquitectura, gastronomicas, aventura,
 * naturaleza, de_temporada) para que el admin las pueda gestionar por CRUD.
 *
 * Idempotente: se puede correr varias veces; las categorías existentes se saltan.
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 2026-07-07
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

const SEED_NAME = '025-seed-experience-categories';
const VERSION = '1.0.0';

/**
 * Categorías por defecto (code = valor usado en experience_category).
 */
const DEFAULT_CATEGORIES = [
  {
    code: 'catas', name: 'Catas', name_en: 'Tastings', description: 'Catas y degustaciones', icon: 'glass', color: '#b8894a', sortOrder: 1,
  },
  {
    code: 'arte', name: 'Arte', name_en: 'Art', description: 'Arte y cultura', icon: 'palette', color: '#a855f7', sortOrder: 2,
  },
  {
    code: 'historia_arquitectura', name: 'Historia y Arquitectura', name_en: 'History & Architecture', description: 'Historia y arquitectura', icon: 'building-monument', color: '#6b7280', sortOrder: 3,
  },
  {
    code: 'gastronomicas', name: 'Gastronómicas', name_en: 'Gastronomy', description: 'Experiencias gastronómicas', icon: 'tools-kitchen-2', color: '#ef4444', sortOrder: 4,
  },
  {
    code: 'aventura', name: 'Aventura', name_en: 'Adventure', description: 'Aventura y adrenalina', icon: 'mountain', color: '#f59e0b', sortOrder: 5,
  },
  {
    code: 'naturaleza', name: 'Naturaleza', name_en: 'Nature', description: 'Naturaleza y aire libre', icon: 'leaf', color: '#22c55e', sortOrder: 6,
  },
  {
    code: 'de_temporada', name: 'De Temporada', name_en: 'Seasonal', description: 'Experiencias de temporada', icon: 'calendar-event', color: '#0ea5e9', sortOrder: 7,
  },
];

/**
 * Verifica si ya existe una categoría por su código.
 * @param {string} code - Código de la categoría.
 * @returns {Promise<boolean>} True si existe.
 * @example
 */
async function categoryExists(code) {
  try {
    const query = new Parse.Query(Parse.Object.extend('ExperienceCategory'));
    query.equalTo('code', code);
    query.equalTo('exists', true);
    query.limit(1);
    const count = await query.count({ useMasterKey: true });
    return count > 0;
  } catch (error) {
    logger.error(`[${SEED_NAME}] Error checking category existence`, { code, error: error.message });
    return false;
  }
}

/**
 * Crea una categoría de experiencia.
 * @param {object} data - Datos de la categoría.
 * @returns {Promise<object>} Objeto Parse creado.
 * @example
 */
async function createCategory(data) {
  const ExperienceCategoryClass = Parse.Object.extend('ExperienceCategory');
  const category = new ExperienceCategoryClass();

  category.set('name', data.name);
  category.set('name_en', data.name_en || null);
  category.set('code', data.code);
  category.set('description', data.description || null);
  category.set('icon', data.icon || 'star');
  category.set('color', data.color || null);
  category.set('sortOrder', data.sortOrder || 0);
  category.set('active', true);
  category.set('exists', true);

  const saved = await category.save(null, { useMasterKey: true });
  logger.info(`[${SEED_NAME}] Category created`, { id: saved.id, code: data.code });
  return saved;
}

/**
 * Ejecuta el seed.
 * @returns {Promise<object>} Resultado con estadísticas.
 * @example
 */
async function run() {
  const startTime = Date.now();
  const statistics = { created: 0, skipped: 0, errors: 0 };

  logger.info(`[${SEED_NAME}] Starting seed execution...`);

  for (const data of DEFAULT_CATEGORIES) {
    try {
      if (await categoryExists(data.code)) {
        logger.info(`[${SEED_NAME}] Category already exists, skipping`, { code: data.code });
        statistics.skipped++;
      } else {
        await createCategory(data);
        statistics.created++;
      }
    } catch (error) {
      statistics.errors++;
      logger.error(`[${SEED_NAME}] Failed to seed category`, { code: data.code, error: error.message });
    }
  }

  const duration = Date.now() - startTime;
  logger.info(`[${SEED_NAME}] Seed completed`, { duration: `${duration}ms`, statistics });

  return {
    success: true,
    duration,
    statistics,
    metadata: {
      totalCategories: DEFAULT_CATEGORIES.length,
      categoriesSeeded: DEFAULT_CATEGORIES.map((c) => c.code),
    },
  };
}

module.exports = {
  version: VERSION,
  description: 'Seed initial experience categories (catas, arte, historia_arquitectura, gastronomicas, aventura, naturaleza, de_temporada)',
  run,
};
