# DisposablePrices Migration to Production

## Overview
This document describes the process to migrate DisposablePrices data from staging to production environment.

## Prerequisites

### 1. Required Data in Production
Before running the migration, ensure production has the following:

#### Rates Table
The following rates must exist in production (matched by name):
- Your production rates matching those in staging

#### VehicleType Table  
The following vehicle types must exist in production (matched by name):
- Your production vehicle types matching those in staging

### 2. Production Credentials
You need the following environment variables set:
- `PROD_PARSE_APP_ID` - Production Parse App ID
- `PROD_PARSE_MASTER_KEY` - Production Parse Master Key  
- `PROD_PARSE_SERVER_URL` - Production Parse Server URL

## Migration Scripts

### 1. View Current Data (Optional)
Check what DisposablePrices exist in staging:
```bash
node scripts/view-disposable-prices.js
```

### 2. Dry Run (Recommended)
Test the migration without making changes:
```bash
# Set production credentials
export PROD_PARSE_APP_ID="your-production-app-id"
export PROD_PARSE_MASTER_KEY="your-production-master-key"
export PROD_PARSE_SERVER_URL="https://your-production-server.herokuapp.com/parse"

# Run dry-run
node scripts/migrate-disposable-prices.js --dry-run
```

### 3. Execute Migration
Once you've verified the dry-run output:
```bash
# With credentials already set from dry-run
node scripts/migrate-disposable-prices.js
```

## Migration Process

The script will:
1. Connect to staging database (local/staging)
2. Fetch all DisposablePrices with their related VehicleType and Rate
3. Connect to production database
4. Map VehicleTypes and Rates by name between environments
5. Create matching DisposablePrices in production
6. Skip any prices where VehicleType or Rate doesn't exist in production
7. Report success/skip/error counts

## Data Mapping

The migration matches data between environments using:
- **VehicleType**: Matched by `name` field
- **Rate**: Matched by `name` field
- **Prices**: All price data (hourlyPrice, currency, dates) copied as-is

## Safety Features

- **Dry-run mode**: Preview changes without modifying production
- **Confirmation prompt**: Warns if data already exists in production
- **Name-based matching**: Ensures correct relationships in production
- **Detailed logging**: Shows exactly what will be/was migrated
- **Error handling**: Continues migration even if individual records fail

## Troubleshooting

### "Production Parse credentials not configured"
Set the required environment variables as shown above.

### "VehicleType not found in production"
Ensure all vehicle types from staging exist in production with the same names.

### "Rate not found in production"
Ensure all rates from staging exist in production with the same names.

### Connection errors
Verify your production Parse server URL and credentials are correct.

## Post-Migration Verification

After migration:
1. Check production Parse Dashboard for DisposablePrices
2. Verify all expected prices were created
3. Test the pricing functionality in production application

## Rollback

If needed, you can manually delete the migrated DisposablePrices from production via:
- Parse Dashboard
- Custom script targeting specific date ranges

## Support

Created by Denisse Maldonado
For issues, check the migration logs for detailed error messages.