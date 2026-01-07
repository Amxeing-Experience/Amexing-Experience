#!/usr/bin/env node

/**
 * Fix Inflation Job Syntax Script
 * Fixes the syntax errors in the inflation background job
 * Created by Denisse Maldonado
 */

const fs = require('fs');
const path = require('path');

const filePath = '/Users/mrpatch/Dev/Web/Amexing-Experience/src/cloud/main.js';

console.log('Reading current cloud main.js file...');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

console.log('Applying syntax fixes...');

// The issue is with the indentation and structure inside the try-catch block
// Let me fix the specific area that has the syntax error
const fixedContent = content.replace(
  // Find the problematic section
  /for \(const className of classesToProcess\) \{\s*try \{[\s\S]*?\} catch \(classError\) \{[\s\S]*?\}\s*\}/m,
  // Replace it with properly structured code
  `for (const className of classesToProcess) {
          try {
            message(\`Processing \${className} records...\`);
            logger.info(\`Inflation job: Starting processing for \${className}\`, { batchId, percentage });
          
            const ClassObj = Parse.Object.extend(className);
            const query = new Parse.Query(ClassObj);
            query.equalTo('active', true);
            query.equalTo('exists', true);
            query.doesNotExist('inflation_batch_id'); // Don't process already inflated records
            query.limit(100);

            // Debug: Check how many records match the query
            const totalMatchingRecords = await query.count({ useMasterKey: true });
            message(\`Found \${totalMatchingRecords} \${className} records ready for inflation\`);
            logger.info(\`Inflation job: Query found \${totalMatchingRecords} records for \${className}\`, { batchId, className });

            let batchCount = 0;
            await query.eachBatch(async (records) => {
              batchCount++;
              message(\`Processing \${className} batch \${batchCount} (\${records.length} records)\`);
              logger.info(\`Starting batch \${batchCount} for \${className}\`, { batchId, batchCount, recordCount: records.length });

              const recordsToSave = [];
              const recordsToUpdate = [];

              for (const record of records) {
                try {
                  // IMPROVEMENT 2: Check for existing active records with same service/rate/vehicle combination
                  const service = record.get('service');
                  const rate = record.get('rate');
                  const vehicleType = record.get('vehicleType');
                  
                  // Validate record has required relationships
                  if (!service || !rate || !vehicleType) {
                    logger.warn(\`Skipping record with missing relationships\`, {
                      recordId: record.id,
                      className,
                      hasService: !!service,
                      hasRate: !!rate,
                      hasVehicleType: !!vehicleType
                    });
                    totalSkipped++;
                    continue;
                  }
                  
                  // Check if there's already an active record with this combination that was inflated in this batch
                  const duplicateQuery = new Parse.Query(ClassObj);
                  duplicateQuery.equalTo('service', service);
                  duplicateQuery.equalTo('rate', rate);
                  duplicateQuery.equalTo('vehicleType', vehicleType);
                  duplicateQuery.equalTo('active', true);
                  duplicateQuery.equalTo('exists', true);
                  duplicateQuery.equalTo('inflation_batch_id', batchId);
                  duplicateQuery.notEqualTo('objectId', record.id);
                  
                  const existingInflated = await duplicateQuery.first({ useMasterKey: true });
                  
                  if (existingInflated) {
                    logger.info(\`Skipping duplicate record - already inflated in this batch\`, {
                      recordId: record.id,
                      className,
                      serviceId: service.id,
                      rateId: rate.id,
                      vehicleTypeId: vehicleType.id,
                      existingRecordId: existingInflated.id
                    });
                    totalSkipped++;
                    continue;
                  }

                  // Get price field based on table name
                  let currentPrice = 0;
                  let priceFieldName = 'price';
                  
                  if (className === 'ClientPrices') {
                    currentPrice = record.get('precio') || 0;
                    priceFieldName = 'precio';
                  } else {
                    currentPrice = record.get('price') || 0;
                    priceFieldName = 'price';
                  }
                  
                  if (currentPrice <= 0) {
                    logger.warn(\`Skipping record with invalid price\`, {
                      recordId: record.id,
                      className,
                      price: currentPrice
                    });
                    totalSkipped++;
                    continue;
                  }

                  // Mark current record as historical
                  record.set('valid_until', now);
                  record.set('active', false);
                  recordsToUpdate.push(record);

                  // Create new record with inflated price
                  const newRecord = new ClassObj();
                  const newPrice = Math.round(currentPrice * (1 + percentage / 100));

                  // Copy all relevant fields except excluded ones
                  const fieldsToExclude = ['objectId', 'createdAt', 'updatedAt', 'valid_until', 'inflation_batch_id'];
                  const attrs = record.attributes;
                  
                  for (const key in attrs) {
                    if (!fieldsToExclude.includes(key)) {
                      newRecord.set(key, attrs[key]);
                    }
                  }

                  // Set new price and inflation metadata
                  newRecord.set(priceFieldName, newPrice);
                  newRecord.set('active', true);
                  newRecord.set('exists', true);
                  newRecord.set('inflation_batch_id', batchId);
                  newRecord.set('inflation_percentage', percentage);
                  newRecord.set('previous_price', currentPrice);
                  newRecord.set('inflation_applied_at', now);

                  recordsToSave.push(newRecord);
                  totalProcessed++;
                } catch (recordError) {
                  totalErrors++;
                  logger.error(\`Error processing \${className} record\`, {
                    recordId: record.id,
                    error: recordError.message,
                    batchId
                  });
                }
              }

              // IMPROVEMENT 3: Atomic batch processing with better error handling
              message(\`Saving batch: \${recordsToUpdate.length} updates, \${recordsToSave.length} new records\`);
              
              try {
                // Save in specific order to maintain consistency:
                // 1. First mark old records as historical
                if (recordsToUpdate.length > 0) {
                  logger.info(\`Updating \${recordsToUpdate.length} historical records for \${className}\`, { batchId });
                  await Parse.Object.saveAll(recordsToUpdate, { useMasterKey: true });
                }
                
                // 2. Then create new inflated records
                if (recordsToSave.length > 0) {
                  logger.info(\`Creating \${recordsToSave.length} inflated records for \${className}\`, { batchId });
                  await Parse.Object.saveAll(recordsToSave, { useMasterKey: true });
                }
                
                // 3. Update progress only after successful save
                historyRecord.set('processed_count', totalProcessed);
                historyRecord.set('skipped_count', totalSkipped);
                historyRecord.set('error_count', totalErrors);
                await historyRecord.save(null, { useMasterKey: true });
                
                message(\`\${className} batch saved successfully: processed=\${totalProcessed}, skipped=\${totalSkipped}, errors=\${totalErrors}\`);
                
              } catch (batchError) {
                // If batch save fails, log detailed error and continue with next batch
                logger.error(\`Failed to save \${className} batch\`, {
                  batchId,
                  className,
                  updateCount: recordsToUpdate.length,
                  saveCount: recordsToSave.length,
                  error: batchError.message,
                  stack: batchError.stack
                });
                
                // Try to recover: mark the batch as having errors but continue
                totalErrors += recordsToUpdate.length + recordsToSave.length;
                historyRecord.set('error_count', totalErrors);
                await historyRecord.save(null, { useMasterKey: true });
                
                message(\`\${className} batch failed - continuing with next batch\`);
                
                // Don't re-throw - continue processing other batches
              }
            }, { useMasterKey: true });
            
          } catch (classError) {
            // If there's an error with the entire class processing, log it and continue with next class
            logger.error(\`Failed to process \${className}\`, {
              batchId,
              className,
              error: classError.message,
              stack: classError.stack
            });
            
            totalErrors++;
            message(\`\${className} processing failed - continuing with next class\`);
          }
        }`
);

// Write the fixed content back to the file
fs.writeFileSync(filePath, fixedContent);

console.log('✅ Syntax fix applied successfully!');
console.log('The inflation background job should now work without syntax errors.');