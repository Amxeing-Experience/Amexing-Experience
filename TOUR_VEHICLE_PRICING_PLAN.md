# Tour Vehicle Pricing Implementation Plan

## Overview
Implementation plan for populating vehicle dropdown based on selected rate (segmento) with price hierarchy from ClientPrices and TourPrices tables.

## Data Structure Understanding

### Tables Involved:
1. **TourPrices**
   - `tourPtr` → Tour reference
   - `ratePtr` → Rate (segmento) reference  
   - `vehicleType` → Type of vehicle
   - `price` → Standard price
   - `valid_until` → If null/undefined, price is active

2. **ClientPrices**
   - `clientPtr` → Client reference
   - `vehiclePtr` → Vehicle type/reference
   - `itemType` → Must be "TOUR" for tours
   - `itemPtr` → Tour reference
   - `ratePtr` → Rate reference
   - `price` → Client-specific price
   - `valid_until` → If null/undefined, price is active

### Price Hierarchy (Priority Order):
1. **ClientPrices** (highest priority) - Client-specific pricing
2. **TourPrices** (default) - Standard tour pricing

## Implementation Steps

### 1. Initial Data Loading
Add to `init()` method:
- `loadAllTourPrices()` - Load all active TourPrices
- `loadAllClientPrices()` - Load all ClientPrices for current client

### 2. Data Caching Strategy
```javascript
// Cache structures
this.tourPricesMap = new Map();    // Key: `${tourId}_${rateId}`
this.clientPricesMap = new Map();  // Key: `${tourId}_${rateId}_${vehiclePtr}`
```

### 3. Event Flow
1. User selects Tour → Enable Rate dropdown
2. User selects Rate → 
   - Get TourPrices from cache
   - Get ClientPrices from cache
   - Extract available vehicle types
   - Populate Vehicle dropdown with types and prices
3. User selects Vehicle →
   - Get price (ClientPrice first, then TourPrice)
   - Update price field

### 4. Key Functions to Implement

#### Data Loading:
- `loadAllTourPrices()` - Bulk load all active tour prices
- `loadAllClientPrices()` - Bulk load client-specific prices
- `refreshPriceData()` - Reload when client changes

#### Rate Selection Handler:
- `handleRateSelection()` - Main handler for rate dropdown change
- `getTourPricesFromCache(tourId, rateId)` - Get from cache
- `getClientPricesFromCache(tourId, rateId)` - Get from cache

#### Vehicle Population:
- `extractVehicleTypesFromPrices(tourPrices, clientPrices)` - Get unique types
- `populateVehicleDropdownWithPrices(vehicleTypes)` - Update dropdown
- `getVehiclePriceWithPriority(vehicleType, tourId, rateId)` - Get best price

#### Price Management:
- `handleVehicleSelection(vehicleType)` - When vehicle selected
- `calculateFinalPrice()` - Get price with hierarchy
- `updatePriceField(price)` - Update UI

### 5. API Optimization
- **Initial load**: 2 API calls (TourPrices + ClientPrices)
- **During usage**: 0 API calls (use cached data)
- **Client change**: 1 API call (reload ClientPrices only)

### 6. UI Behavior
- Vehicle dropdown disabled until Tour AND Rate selected
- Show price next to each vehicle option
- Indicate client-specific pricing with ⭐ icon
- Show "Sin vehículos disponibles" if no matches

### 7. Edge Cases
- No TourPrices for tour+rate combination
- Client price exists but TourPrice doesn't
- All prices expired (valid_until in past)
- No client selected (new quote)
- Vehicle type mismatch between tables

### 8. Implementation Order
1. Add cache properties to class
2. Implement bulk data loading functions
3. Add to init() sequence
4. Create rate selection handler
5. Implement vehicle dropdown population
6. Add price calculation logic
7. Wire up event handlers
8. Test with various scenarios

## Current Status
- [x] Plan created and saved
- [x] Cache properties added
- [x] Data loading functions implemented
- [x] Rate selection handler created
- [x] Vehicle dropdown population done
- [x] Price calculation implemented
- [x] Event handlers connected
- [x] Testing completed

## Implementation Complete! 🎉

The vehicle dropdown functionality has been fully implemented with the following features:

### ✅ Completed Features:
1. **Cache System**: Added tourPricesMap and clientPricesMap for efficient data storage
2. **Bulk Data Loading**: Implemented loadAllTourPrices() and loadAllClientPrices() 
3. **Rate Selection Handler**: Created handleRateSelection() to respond to rate changes
4. **Vehicle Population**: Implemented populateVehicleDropdownWithPrices() with price display
5. **Price Hierarchy**: Client prices take priority over tour prices
6. **Price Calculation**: getVehiclePriceWithPriority() handles the pricing logic
7. **Event Handlers**: Wired up transportCategory and vehicleSelect change events
8. **UI Updates**: Vehicle dropdown shows "Type - $Price ⭐" format with client price indicator
9. **Error Handling**: Comprehensive error handling and console logging for debugging

### 🚀 How it Works:
1. When page loads → Bulk loads all TourPrices and ClientPrices into cache
2. User selects Tour → Tour dropdown populated
3. User selects Rate → handleRateSelection() finds matching vehicles and populates dropdown
4. User selects Vehicle → handleVehicleSelection() updates price field with priority pricing

### 💎 Client Price Priority:
- If client has specific pricing for a tour+rate+vehicle → Use client price (⭐ indicator)
- Otherwise → Use standard tour pricing
- Vehicle dropdown shows both price and source indicator

## Files to Modify
1. `/Users/mrpatch/Dev/Web/AmexingQuotes/Quotes/public/dashboards/admin/sections/quote-services-v2.js`
   - Main implementation file

## Notes
- Avoid "Economico" rate for Tours (already implemented)
- Maintain existing functionality while adding new features
- Use Parse.Query for database access
- Keep console.log statements for debugging