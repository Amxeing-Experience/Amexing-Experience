#!/usr/bin/env node

/**
 * Fix script to create missing reservation for quote QTE-2026-0028
 * 
 * Problem: The quote was changed directly to "scheduled" (AGENDADO) status without
 * passing through "requested" (SOLICITADO) status, which is when reservations are
 * automatically created.
 * 
 * Solution: This script manually creates the reservation and its services.
 * 
 * Created by Denisse Maldonado
 */

// Load environment variables from the correct file
const path = require('path');
require('dotenv').config({ 
  path: path.resolve(__dirname, '../environments/.env.production-local') 
});

const Parse = require('parse/node');
const logger = require('../src/infrastructure/logger');

// Import models
const Reservation = require('../src/domain/models/Reservation');
const ReservationService = require('../src/domain/models/ReservationService');

// Initialize Parse
Parse.initialize(
  process.env.PARSE_APP_ID,
  process.env.PARSE_JS_KEY,
  process.env.PARSE_MASTER_KEY
);
Parse.serverURL = process.env.PARSE_SERVER_URL || 'http://localhost:1338/parse';

/**
 * Generate a reservation folio
 * Format: RSV-YYYY-####
 */
async function generateReservationFolio() {
  const year = new Date().getFullYear();
  const prefix = `RSV-${year}-`;
  
  // Find the highest existing folio for this year
  const query = new Parse.Query('Reservation');
  query.startsWith('folio', prefix);
  query.descending('folio');
  query.limit(1);
  
  try {
    const lastReservation = await query.first({ useMasterKey: true });
    
    if (lastReservation) {
      const lastFolio = lastReservation.get('folio');
      const lastNumber = parseInt(lastFolio.split('-').pop(), 10);
      const newNumber = (lastNumber + 1).toString().padStart(4, '0');
      return `${prefix}${newNumber}`;
    } else {
      return `${prefix}0001`;
    }
  } catch (error) {
    logger.warn('Could not determine last folio, starting from 0001', { error: error.message });
    return `${prefix}0001`;
  }
}

/**
 * Main function to create the missing reservation
 */
async function createMissingReservation() {
  const quoteFolio = 'QTE-2026-0028';
  
  try {
    logger.info('🔍 Starting reservation creation for quote', { quoteFolio });
    
    // 1. Find the quote
    const quoteQuery = new Parse.Query('Quote');
    quoteQuery.equalTo('folio', quoteFolio);
    quoteQuery.equalTo('exists', true);
    quoteQuery.include('client');
    quoteQuery.include('rate');
    
    const quote = await quoteQuery.first({ useMasterKey: true });
    
    if (!quote) {
      throw new Error(`Quote ${quoteFolio} not found`);
    }
    
    logger.info('✅ Quote found', {
      quoteId: quote.id,
      folio: quote.get('folio'),
      status: quote.get('status'),
      client: quote.get('client')?.id,
    });
    
    // 2. Check if reservation already exists
    const existingQuery = new Parse.Query('Reservation');
    existingQuery.equalTo('quotePtr', quote);
    existingQuery.equalTo('exists', true);
    
    const existingReservation = await existingQuery.first({ useMasterKey: true });
    
    if (existingReservation) {
      logger.warn('⚠️ Reservation already exists for this quote', {
        reservationId: existingReservation.id,
        reservationFolio: existingReservation.get('folio'),
      });
      return existingReservation;
    }
    
    // 3. Get service items from quote
    const serviceItems = quote.get('serviceItems') || {};
    const days = serviceItems.days || [];
    
    if (!days || days.length === 0) {
      throw new Error('No service days found in quote');
    }
    
    logger.info('📊 Service items found', {
      totalDays: days.length,
      totalAmount: serviceItems.total,
      currency: serviceItems.currency || 'MXN',
    });
    
    // 4. Generate reservation folio
    const folio = await generateReservationFolio();
    logger.info('📋 Generated folio', { folio });
    
    // 5. Calculate date range
    let startDate = null;
    let endDate = null;
    for (const day of days) {
      if (day.date) {
        const d = new Date(`${day.date}T12:00:00`);
        if (!startDate || d < startDate) startDate = d;
        if (!endDate || d > endDate) endDate = d;
      }
    }
    
    // 6. Create Reservation
    const reservation = new Reservation();
    reservation.set('quotePtr', quote);
    reservation.set('quoteFolio', quoteFolio);
    reservation.set('folio', folio);
    reservation.set('status', 'pending');
    reservation.set('totalAmount', serviceItems.total || 0);
    reservation.set('servicesSubtotal', serviceItems.total || 0);
    reservation.set('adjustments', []);
    reservation.set('currency', serviceItems.currency || 'MXN');
    reservation.set('paymentType', serviceItems.paymentType || 'efectivo');
    reservation.set('numberOfPeople', quote.get('numberOfPeople') || 1);
    reservation.set('eventType', quote.get('eventType') || '');
    reservation.set('contactPerson', quote.get('contactPerson') || '');
    reservation.set('contactEmail', quote.get('contactEmail') || '');
    reservation.set('contactPhone', quote.get('contactPhone') || '');
    reservation.set('notes', quote.get('notes') || '');
    reservation.set('serviceItemsSnapshot', serviceItems);
    reservation.set('active', true);
    reservation.set('exists', true);
    
    if (startDate) reservation.set('startDate', startDate);
    if (endDate) reservation.set('endDate', endDate);
    
    // Set client pointer
    const client = quote.get('client');
    if (client) {
      reservation.set('clientPtr', client);
      logger.info('Set clientPtr for reservation', {
        clientId: client.id,
      });
    }
    
    // Set createdBy to system user (since we're running manually)
    // We'll use the first admin user we find
    const adminQuery = new Parse.Query('AmexingUser');
    adminQuery.equalTo('role', 'admin');
    adminQuery.limit(1);
    const adminUser = await adminQuery.first({ useMasterKey: true });
    
    if (adminUser) {
      const userPointer = new Parse.Object('AmexingUser');
      userPointer.id = adminUser.id;
      reservation.set('createdBy', userPointer);
    }
    
    // Save reservation
    logger.info('💾 Saving reservation...');
    await reservation.save(null, { useMasterKey: true });
    logger.info('✅ Reservation saved', {
      reservationId: reservation.id,
      folio: reservation.get('folio'),
    });
    
    // 7. Create ReservationService entries
    const servicesToSave = [];
    
    for (const day of days) {
      const subconcepts = day.subconcepts || [];
      
      logger.info(`📅 Processing day ${day.dayNumber}`, {
        concept: day.concept,
        date: day.date,
        subconceptsCount: subconcepts.length,
      });
      
      for (const sub of subconcepts) {
        const resSvc = new ReservationService();
        resSvc.set('reservationPtr', reservation);
        resSvc.set('dayNumber', day.dayNumber || 1);
        resSvc.set('dayTitle', day.concept || day.dayTitle || `Día ${day.dayNumber || 1}`);
        resSvc.set('type', sub.type || 'concepto');
        resSvc.set('concept', sub.concept || sub.name || '');
        resSvc.set('time', sub.time || '');
        resSvc.set('status', 'pending');
        resSvc.set('price', sub.unitPrice || sub.price || 0);
        resSvc.set('total', sub.total || sub.unitPrice || 0);
        resSvc.set('originName', sub.originName || sub.origin || '');
        resSvc.set('destinationName', sub.destinationName || sub.destination || '');
        resSvc.set('vehicleTypeName', sub.vehicleTypeName || sub.vehicleType || '');
        resSvc.set('notes', sub.notes || '');
        resSvc.set('subconcept', sub);
        resSvc.set('active', true);
        resSvc.set('exists', true);
        
        if (day.date) {
          try {
            resSvc.set('serviceDate', new Date(`${day.date}T12:00:00`));
          } catch (dateError) {
            logger.warn('⚠️ Invalid date format', {
              dayNumber: day.dayNumber,
              originalDate: day.date,
            });
          }
        }
        
        servicesToSave.push(resSvc);
      }
    }
    
    // Save all services
    if (servicesToSave.length > 0) {
      logger.info('💾 Saving reservation services...', {
        count: servicesToSave.length,
      });
      
      await Parse.Object.saveAll(servicesToSave, { useMasterKey: true });
      
      logger.info('✅ All services saved', {
        servicesCount: servicesToSave.length,
      });
    }
    
    // 8. Final summary
    logger.info('🎉 Reservation created successfully!', {
      quoteId: quote.id,
      quoteFolio: quote.get('folio'),
      reservationId: reservation.id,
      reservationFolio: reservation.get('folio'),
      servicesCreated: servicesToSave.length,
      totalAmount: reservation.get('totalAmount'),
      currency: reservation.get('currency'),
    });
    
    console.log('\n✅ SUCCESS! Reservation created:');
    console.log(`   Quote: ${quoteFolio}`);
    console.log(`   Reservation ID: ${reservation.id}`);
    console.log(`   Reservation Folio: ${reservation.get('folio')}`);
    console.log(`   Services Created: ${servicesToSave.length}`);
    console.log(`   Total Amount: ${reservation.get('totalAmount')} ${reservation.get('currency')}`);
    
    return reservation;
    
  } catch (error) {
    logger.error('❌ Error creating reservation', {
      quoteFolio,
      error: error.message,
      stack: error.stack,
    });
    
    console.error('\n❌ ERROR: Failed to create reservation');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

// Run the script
logger.info('🚀 Starting script to fix missing reservation for QTE-2026-0028');

createMissingReservation()
  .then(() => {
    logger.info('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Script failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });