#!/usr/bin/env node

/**
 * Migration script to convert tour photos from array field to TourImage objects.
 * Created by Denisse Maldonado
 */

require('dotenv').config({ path: `./environments/.env.${process.env.NODE_ENV || 'development'}` });
const Parse = require('parse/node');
const logger = require('../../src/infrastructure/logger');

// Initialize Parse
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1337/parse';

// Register TourImage class
const TourImage = require('../../src/domain/models/TourImage');

async function migrateTourPhotos() {
  try {
    logger.info('Starting tour photos migration...');

    // Query all tours with photos
    const Tour = Parse.Object.extend('Tour');
    const query = new Parse.Query(Tour);
    query.exists('photos');
    query.equalTo('exists', true);
    
    const tours = await query.find({ useMasterKey: true });
    logger.info(`Found ${tours.length} tours with photos`);

    let totalPhotos = 0;
    let migratedPhotos = 0;

    for (const tour of tours) {
      const photos = tour.get('photos');
      
      if (!Array.isArray(photos) || photos.length === 0) {
        continue;
      }

      logger.info(`Processing tour ${tour.id} with ${photos.length} photos`);
      totalPhotos += photos.length;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        
        // Check if already migrated
        const existingQuery = new Parse.Query(TourImage);
        existingQuery.equalTo('tourId', tour);
        existingQuery.equalTo('s3Key', photo.s3Key);
        const existing = await existingQuery.first({ useMasterKey: true });
        
        if (existing) {
          logger.info(`Photo already migrated: ${photo.fileName}`);
          continue;
        }

        // Create new TourImage object
        const tourImage = new TourImage();
        
        tourImage.set('tourId', tour);
        tourImage.set('s3Key', photo.s3Key || null);
        tourImage.set('s3Bucket', process.env.S3_BUCKET);
        tourImage.set('s3Region', process.env.AWS_REGION);
        tourImage.set('fileName', photo.fileName || `tour_photo_${i + 1}`);
        tourImage.set('fileSize', photo.fileSize || 0);
        tourImage.set('mimeType', photo.mimeType || 'image/jpeg');
        tourImage.set('uploadedAt', tour.get('updatedAt') || new Date());
        tourImage.set('active', true);
        tourImage.set('exists', true);
        tourImage.set('isPrimary', i === 0);
        tourImage.set('displayOrder', i);
        
        // Preserve optimization data if exists
        if (photo.optimizedVariants) {
          tourImage.set('optimizedVariants', photo.optimizedVariants);
        }
        if (photo.optimizationMetadata) {
          tourImage.set('optimizationMetadata', photo.optimizationMetadata);
        }
        
        await tourImage.save(null, { useMasterKey: true });
        migratedPhotos++;
        
        logger.info(`Migrated photo ${i + 1}/${photos.length} for tour ${tour.id}`);
      }

      // Optionally clear the photos array from the tour object after migration
      // tour.unset('photos');
      // await tour.save(null, { useMasterKey: true });
    }

    logger.info(`Migration completed! Migrated ${migratedPhotos}/${totalPhotos} photos`);
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateTourPhotos()
  .then(() => {
    logger.info('Migration script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration script failed:', error);
    process.exit(1);
  });