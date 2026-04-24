# Pricing Discrepancy Fix Solution

## Problem Summary

The León Airport → San Miguel de Allende route (Premium segment, SEDAN vehicle) shows **different prices** in different systems:

- **Quotes System**: Shows **1486**
- **Traslados Table**: Shows **$1,858.00 MXN**  
- **Database Reality**: All services have base price **2461 MXN**
- **Expected with surcharge**: **2980.02 MXN** (2461 × 1.2109)

**None of the displayed prices match the database or expected calculations!**

## Root Cause Analysis

### 1. **Duplicate POI Problem** ✅ IDENTIFIED
- **5 duplicate León Airport POIs** with same name but different IDs
- **4 duplicate San Miguel POIs** with same name but different IDs  
- Different systems query different POI IDs accidentally
- Results in **154 services needing consolidation**

### 2. **Missing RatePrice Records** ✅ IDENTIFIED  
- **0 RatePrice records** in database (should have hundreds)
- Systems may fall back to different default calculations
- Quote system relies on Service.price but may have fallback logic

### 3. **Client-Specific Pricing** ❓ POSSIBLE
- ClientPrices table exists but may have custom rates
- Different users might see different prices
- System might apply user-specific discounts/markups

### 4. **Caching/Stale Data** ❓ POSSIBLE
- Frontend might cache old price data
- Different calculation logic in client-side vs server-side

## Comprehensive Fix Strategy

### Phase 1: Data Consolidation (CRITICAL)

1. **Consolidate Duplicate POIs**
   ```javascript
   // Use fix-poi-duplicates.js script
   // - Keep canonical POI for each location
   // - Update all Services to reference canonical POI
   // - Mark duplicates as inactive
   ```

2. **Seed Missing RatePrice Records**
   ```bash
   # Run the rate prices seed
   yarn seed scripts/seeds/021-seed-rate-prices.js
   ```

3. **Verify Service Consistency**
   ```javascript
   // Ensure all León Airport Premium SEDAN services have same price
   // Should all be 2461 MXN base price
   ```

### Phase 2: API Endpoint Validation

1. **Test Quote API Endpoint**
   ```bash
   # Test: GET /api/quotes/services-by-rate/{premiumRateId}
   # Should return León services with 2461 base, 2980.02 total
   ```

2. **Test Traslados API Endpoint**  
   ```bash
   # Test: GET /api/services?serviceType=Aeropuerto
   # Should return same León services with same pricing
   ```

3. **Compare Response Consistency**
   - Both should return services with identical POI references
   - Both should apply same surcharge calculations
   - Both should show same final prices

### Phase 3: Frontend Logic Verification

1. **Check Quote Price Display Logic**
   - File: `public/dashboards/admin/sections/quote-services-v2.js`
   - Function: `getDisplayPrice()` around line 4801
   - Verify surcharge application logic

2. **Check Traslados Price Display Logic** 
   - File: `src/presentation/views/organisms/datatable/airport-services-table.ejs`
   - Verify price rendering and surcharge calculations

### Phase 4: User-Specific Testing

1. **Test with Different User Roles**
   - Admin vs Client vs Department Manager
   - Check for role-specific pricing logic
   - Verify ClientPrices table isn't overriding

2. **Clear Cache/Cookies**
   - Clear browser cache
   - Clear any API response caching
   - Test with fresh session

## Expected Results After Fix

### All Systems Should Show:
- **Base Price (Efectivo)**: 2,461.00 MXN
- **Price with Surcharge**: 2,980.02 MXN  
- **Consistent POI references**: Same León Airport and San Miguel POIs
- **Same service selection**: Both systems query same Service records

### Pricing Breakdown:
```
Base Price (Precio Efectivo): $2,461.00 MXN
Surcharge (21.09%): $519.02 MXN  
Total Price (Precio Base): $2,980.02 MXN
```

## Implementation Steps

### Step 1: Database Fixes
```bash
# 1. Run POI consolidation (dry run first)
node fix-poi-duplicates.js

# 2. Seed missing RatePrice records  
yarn seed scripts/seeds/021-seed-rate-prices.js

# 3. Verify pricing consistency
node check-pricing-endpoints.js
```

### Step 2: Test Both Systems
```bash
# 1. Test quote creation with León Airport route
# 2. Test traslados table filtering
# 3. Verify both show 2,980.02 MXN for Premium SEDAN
```

### Step 3: Monitor & Validate
```bash  
# 1. Check with multiple users
# 2. Test both directions (arrival/departure)
# 3. Verify prices persist after page refresh
```

## Risk Mitigation

### Backup Strategy
- **Database backup** before running consolidation  
- **POI ID mapping** to rollback if needed
- **Service reference backup** for recovery

### Testing Strategy  
- **Staging environment** testing first
- **User acceptance testing** with actual quotes
- **Cross-browser validation**

### Rollback Plan
- Keep original POI records (mark inactive, don't delete)
- Document all Service ID changes
- Maintain mapping for emergency rollback

## Success Metrics

✅ Both systems show **identical prices** for same routes  
✅ **2,980.02 MXN** displayed for León Airport Premium SEDAN  
✅ **No more 1486 or 1858 discrepancies**  
✅ **Consistent behavior** across user roles  
✅ **Same POI references** in both systems  

## Technical Notes

- All Services have **2461 MXN base price** (verified)
- **21.09% surcharge** should be consistently applied
- **POI consolidation** is the critical first step
- **RatePrice seeding** may not be needed if Services work correctly
- **Client-side caching** should be cleared after fixes