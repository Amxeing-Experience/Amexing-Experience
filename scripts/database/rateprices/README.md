# RatePrices Database Scripts

This directory contains scripts for populating and updating the RatePrices table with data from the Service table.

## Overview

The RatePrices table provides a unified pricing structure that matches rates, vehicle types, origins, and destinations. This replaces the need to query individual Service records for pricing information.

## Scripts Organization

### Population Scripts
These scripts create RatePrices entries from the Services table for each rate category:

- `populate-premium-rateprices.js` - Premium rate (SEDAN, SUBURBAN, SPRINTER)
- `populate-economico-rateprices.js` - Económico rate (SEDAN, VAN)
- `populate-greenclass-rateprices.js` - Green Class rate (MODEL 3, MODEL Y)
- `populate-firstclass-rateprices.js` - First Class rate (SEDAN, SUBURBAN)

### Price Update Scripts
These scripts update RatePrices with correct prices from the Service table:

- `update-premium-rateprices.js` - Update Premium prices
- `update-economico-rateprices.js` - Update Económico prices
- `update-greenclass-rateprices.js` - Update Green Class prices
- `update-firstclass-rateprices.js` - Update First Class prices

### Verification Script
- `verify-rateprices-populated.js` - Verify population and analyze pricing data

## Usage

### Complete Population Process

1. **Populate all rates:**
   ```bash
   node scripts/database/rateprices/populate-premium-rateprices.js
   node scripts/database/rateprices/populate-economico-rateprices.js
   node scripts/database/rateprices/populate-greenclass-rateprices.js
   node scripts/database/rateprices/populate-firstclass-rateprices.js
   ```

2. **Update prices from Service table:**
   ```bash
   node scripts/database/rateprices/update-premium-rateprices.js
   node scripts/database/rateprices/update-economico-rateprices.js
   node scripts/database/rateprices/update-greenclass-rateprices.js
   node scripts/database/rateprices/update-firstclass-rateprices.js
   ```

3. **Verify results:**
   ```bash
   node scripts/database/rateprices/verify-rateprices-populated.js
   ```

## Final Results

After running all scripts, the RatePrices table contains:

- **Total Records**: 621 entries
- **Premium**: 207 records (69 services × 3 vehicles)
- **Económico**: 138 records (69 services × 2 vehicles)  
- **Green Class**: 138 records (69 services × 2 vehicles)
- **First Class**: 138 records (69 services × 2 vehicles)

## Rate-Vehicle Type Matrix

| Rate | Vehicle Types | Records | Target Market |
|------|---------------|---------|---------------|
| Premium | SEDAN, SUBURBAN, SPRINTER | 207 | Luxury transportation |
| Económico | SEDAN, VAN | 138 | Budget-conscious |
| Green Class | MODEL 3, MODEL Y | 138 | Eco-friendly/tech |
| First Class | SEDAN, SUBURBAN | 138 | Executive/VIP |

## Safety Features

- **Idempotent**: Scripts can be run multiple times safely
- **Duplicate checking**: Existing records are skipped
- **Batch processing**: Large datasets handled efficiently
- **Error handling**: Individual failures don't stop the entire process
- **Validation**: Price matching ensures data accuracy

## Notes

- All scripts require Parse Server to be running on localhost:1337
- Scripts use master key for database operations
- Pricing data is sourced from the Service table with exact matching
- Created by Denisse Maldonado as part of the AmexingWeb project