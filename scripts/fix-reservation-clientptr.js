#!/usr/bin/env node

/**
 * Migration script to fix clientPtr in existing reservations
 * Changes clientPtr from pointing to client objects to pointing to the user who created the reservation
 */

require('dotenv').config();
const Parse = require('parse/node');

// Initialize Parse
Parse.initialize('amexing-app-id', undefined, 'master-key-change-in-production');
Parse.serverURL = 'http://localhost:1337/parse';

const logger = console;

async function fixReservationClientPtrs() {
  try {
    logger.log('Starting reservation clientPtr fix migration...');

    // Query all reservations
    const query = new Parse.Query('Reservation');
    query.equalTo('exists', true);
    query.include('createdBy');
    query.limit(1000); // Process in batches if needed
    
    const reservations = await query.find({ useMasterKey: true });
    
    logger.log(`Found ${reservations.length} reservations to check`);

    let fixedCount = 0;
    let errorCount = 0;

    for (const reservation of reservations) {
      try {
        const folio = reservation.get('folio');
        const currentClientPtr = reservation.get('clientPtr');
        const createdBy = reservation.get('createdBy');
        
        // Check if clientPtr is pointing to a non-user object
        if (currentClientPtr && currentClientPtr.className !== 'AmexingUser') {
          logger.log(`Reservation ${folio}: clientPtr is pointing to ${currentClientPtr.className}, needs fixing`);
          
          // If we have a createdBy user, use that
          if (createdBy) {
            const userPointer = new Parse.Object('AmexingUser');
            userPointer.id = createdBy.id;
            reservation.set('clientPtr', userPointer);
            
            // Keep the original client reference
            reservation.set('originalClient', currentClientPtr);
            
            await reservation.save(null, { useMasterKey: true });
            logger.log(`✓ Fixed reservation ${folio}: clientPtr now points to user ${createdBy.id}`);
            fixedCount++;
          } else {
            logger.warn(`✗ Reservation ${folio} has no createdBy user, skipping`);
            errorCount++;
          }
        } else if (currentClientPtr && currentClientPtr.className === 'AmexingUser') {
          logger.log(`✓ Reservation ${folio}: clientPtr already points to user, no fix needed`);
        } else {
          logger.log(`! Reservation ${folio}: no clientPtr set`);
        }
      } catch (error) {
        logger.error(`Error processing reservation ${reservation.get('folio')}:`, error.message);
        errorCount++;
      }
    }

    logger.log('\n=== Migration Summary ===');
    logger.log(`Total reservations checked: ${reservations.length}`);
    logger.log(`Reservations fixed: ${fixedCount}`);
    logger.log(`Errors encountered: ${errorCount}`);
    logger.log('Migration completed!');
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
fixReservationClientPtrs()
  .then(() => {
    logger.log('Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed:', error);
    process.exit(1);
  });