/**
 * Seed 013 - Tour Catalog (Rate-Agnostic Tours).
 *
 * Creates the Tour table from existing Tours data, extracting unique tour combinations
 * without rate dependencies. This creates a clean catalog of available tours.
 *
 * Data Structure:
 * - destinationPOI: Destination point (required)
 * - time: Duration in minutes (required)
 * - notes: Tour description/notes (optional)
 * - availability: New availability format (optional)
 * - availableDays: Legacy availability format (optional)
 * - startTime: Legacy start time (optional)
 * - endTime: Legacy end time (optional)
 * - active: Tour availability (boolean)
 * - exists: Logical deletion flag (boolean)..
 *
 * Business Logic:
 * - Each unique combination of destination-duration creates one tour
 * - Rate-specific pricing is handled separately in TourPrices table
 * - Preserves all tour metadata (duration, availability).
 *
 * Configuration:
 * - Idempotent: true - Can be run multiple times safely, creates unique combinations only
 * - Dependencies: 009-seed-pois-tours, 010-seed-tours-from-csv
 * @author Denisse Maldonado
 * @version 1.0.0
 * @since 1.0.0
 */

const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Seed configuration
const SEED_NAME = '013-seed-tour-catalog';
const VERSION = '1.0.0';

/**
 * Run the seed
 * @returns {Promise<object>} Seed result with statistics
 */
async function run() {
  const startTime = Date.now();
  const stats = { created: 0, skipped: 0, errors: 0 };

  logger.info(`🌱 Starting ${SEED_NAME} v${VERSION}`);

  try {
    // ==========================================
    // STEP 1: GET ALL TOURS FROM TOURS TABLE
    // ==========================================
    logger.info('📋 Loading tours from Tours table...');

    const ToursClass = Parse.Object.extend('Tours');
    const toursQuery = new Parse.Query(ToursClass);
    toursQuery.equalTo('exists', true);
    toursQuery.include('destinationPOI');
    toursQuery.include('rate');
    toursQuery.limit(500);

    const originalTours = await toursQuery.find({ useMasterKey: true });
    logger.info(`Found ${originalTours.length} tours in Tours table`);

    // ==========================================
    // STEP 2: FILTER TO VALID TOURS
    // ==========================================
    const validTours = [];

    for (const tour of originalTours) {
      const destinationPOI = tour.get('destinationPOI');
      const time = tour.get('time');

      // A tour is valid if it has destinationPOI + time
      if (destinationPOI && time) {
        validTours.push({
          destinationPOI,
          time,
          notes: tour.get('notes') || tour.get('note') || '',
          availability: tour.get('availability'),
          availableDays: tour.get('availableDays'),
          startTime: tour.get('startTime'),
          endTime: tour.get('endTime'),
          originalId: tour.id,
        });
      }
    }

    logger.info(`Found ${validTours.length} valid tours`);

    // ==========================================
    // STEP 3: CREATE UNIQUE TOUR COMBINATIONS
    // ==========================================
    const TourClass = Parse.Object.extend('Tour');
    const uniqueTours = new Map();
    let duplicates = 0;

    for (const tourData of validTours) {
      // Create unique key: destination-time
      const tourKey = `${tourData.destinationPOI.id}-${tourData.time}`;

      if (!uniqueTours.has(tourKey)) {
        uniqueTours.set(tourKey, tourData);
      } else {
        // For duplicates, merge metadata (take non-null values)
        const existing = uniqueTours.get(tourKey);
        const merged = {
          ...existing,
          notes: existing.notes || tourData.notes,
          availability: existing.availability || tourData.availability,
          availableDays: existing.availableDays || tourData.availableDays,
          startTime: existing.startTime || tourData.startTime,
          endTime: existing.endTime || tourData.endTime,
        };
        uniqueTours.set(tourKey, merged);
        duplicates += 1;
      }
    }

    logger.info(`Created ${uniqueTours.size} unique tour combinations (${duplicates} duplicates merged)`);

    // ==========================================
    // STEP 4: CREATE TOUR RECORDS
    // ==========================================
    logger.info('📦 Creating Tour records...');

    for (const [tourKey, tourData] of uniqueTours) {
      try {
        // Check if tour already exists
        const existingQuery = new Parse.Query(TourClass);
        existingQuery.equalTo('destinationPOI', tourData.destinationPOI);
        existingQuery.equalTo('time', tourData.time);
        existingQuery.equalTo('exists', true);

        const existingTour = await existingQuery.first({ useMasterKey: true });

        if (existingTour) {
          stats.skipped += 1;
          continue;
        }

        // Create new tour
        const newTour = new TourClass();

        newTour.set('destinationPOI', tourData.destinationPOI);
        newTour.set('time', tourData.time);

        // Optional fields
        if (tourData.notes) {
          newTour.set('notes', tourData.notes);
        }
        if (tourData.availability) {
          newTour.set('availability', tourData.availability);
        }
        if (tourData.availableDays) {
          newTour.set('availableDays', tourData.availableDays);
        }
        if (tourData.startTime) {
          newTour.set('startTime', tourData.startTime);
        }
        if (tourData.endTime) {
          newTour.set('endTime', tourData.endTime);
        }

        newTour.set('active', true);
        newTour.set('exists', true);

        await newTour.save(null, { useMasterKey: true });
        stats.created += 1;

        if (stats.created % 10 === 0) {
          logger.info(`Progress: ${stats.created}/${uniqueTours.size} tours created`);
        }
      } catch (error) {
        stats.errors += 1;
        logger.error(`Error creating tour ${tourKey}:`, error.message);
      }
    }

    const duration = Date.now() - startTime;

    logger.info(`✅ Seed ${SEED_NAME} completed successfully`, {
      stats,
      duration: `${duration}ms`,
    });

    return {
      success: true,
      duration,
      statistics: stats,
    };
  } catch (error) {
    logger.error(`❌ Seed ${SEED_NAME} failed:`, error.message);
    throw new Error(`Seed failed: ${error.message}`);
  }
}

// Export for use by seed runner
module.exports = {
  version: VERSION,
  description: 'Create Tour catalog from Tours table (rate-agnostic unique tours without vehicle type)',
  run,
};