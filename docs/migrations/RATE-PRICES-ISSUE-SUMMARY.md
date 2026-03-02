# Rate Prices Issue Summary

## Problem Description

When viewing services at http://localhost:1337/dashboard/admin/services:
- Selecting "Económico" in the header dropdown shows some prices
- Clicking "Ver todos" (expand) only shows "First Class" prices
- Other rates (Económico, Green Class, Premium) are missing from expanded view

## Root Cause Analysis

### Data Structure Issues Found:

1. **Services Table:**
   - 77 total services
   - 69 services have NO rate field (showing as "No Rate")
   - Only 8 services have a rate assigned

2. **RatePrices Table:**
   - Only 145 RatePrices entries exist
   - Only 9 unique services have RatePrices (out of 77)
   - Most services are missing RatePrices for different rate/vehicle combinations

3. **Data Model Confusion:**
   - Services table has a `rate` field (but mostly unused)
   - RatePrices table is meant to store pricing for all rate/vehicle combinations
   - UI expects each service to have prices for ALL rates

## The Issue

The system has **two conflicting models**:

1. **Services Model**: Each service can have ONE rate (via `rate` field)
2. **RatePrices Model**: Each service should have prices for ALL rates

The UI is designed for Model #2 but the data follows Model #1 partially.

## Solution

### Immediate Fix
Create RatePrices entries for all services with all rate combinations:
- Each service needs RatePrices for all 4 rates
- Each rate needs prices for all 6 vehicle types
- Total: 77 services × 4 rates × 6 vehicles = 1,848 RatePrices needed

### Scripts Created

1. **`scripts/dev/diagnose-rate-prices.js`**
   - Diagnoses the current state of the data
   - Shows distribution of services and rate prices

2. **`scripts/dev/fix-rate-prices-complete.js`**
   - Cleans up duplicate/invalid RatePrices
   - Creates comprehensive RatePrices for all services

3. **`scripts/dev/fix-rate-prices-targeted.js`**
   - Fixes specific key routes for testing
   - Faster execution for demonstration

## How It Should Work

### When Económico is selected:
1. Header shows "Económico" 
2. Main table shows Económico prices for each service
3. Clicking "Ver todos" shows ALL rates including Económico

### Data Structure Required:
```
Service (Querétaro → San Miguel)
  ├── RatePrice (First Class + SEDAN) = $808
  ├── RatePrice (First Class + VAN) = $889
  ├── RatePrice (Económico + SEDAN) = $840
  ├── RatePrice (Económico + VAN) = $924
  ├── RatePrice (Green Class + SEDAN) = $880
  ├── RatePrice (Green Class + VAN) = $968
  └── RatePrice (Premium + SEDAN) = $960
      └── RatePrice (Premium + VAN) = $1056
```

## UI Behavior

The UI correctly:
1. Filters by selected rate in the header
2. Shows filtered prices in main table
3. Attempts to show all rates when expanded

The issue is **missing data**, not UI logic.

## Recommended Actions

1. **Run the fix script** to populate all RatePrices:
   ```bash
   node scripts/dev/fix-rate-prices-complete.js
   ```

2. **Verify the fix** by checking:
   - Select different rates in header
   - Each shows appropriate prices
   - "Ver todos" shows all 4 rates

3. **Consider architecture change**:
   - Remove `rate` field from Services table
   - Use only RatePrices for all pricing
   - Simplify the data model

## Debug Features Added

When `NODE_ENV=development`:
- RatePrices objectIds shown below vehicle types
- Console logs for debugging data
- "DEV MODE" badge in modal headers

This helps identify which RatePrices records are being loaded.

Created by Denisse Maldonado