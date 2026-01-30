# Debug Mode for RatePrices in Development

## Changes Made

This document outlines the changes made to enable debugging of RatePrices objectIds in development environment.

### Files Modified

1. **src/application/controllers/dashboard/AdminController.js**
   - Added `isDevelopment: process.env.NODE_ENV === 'development'` flag to services view rendering

2. **src/presentation/views/dashboards/admin/services.ejs**
   - Passes `isDevelopment` flag to services-table organism

3. **src/presentation/views/organisms/datatable/services-table.ejs**
   - Added development mode flag initialization
   - Displays RatePrices objectId below vehicle info when in development mode
   - Adds console logging for RatePrices data in development mode
   - Shows "DEV MODE" badge in modal header when in development

## Features Added

### When NODE_ENV=development:

1. **Visual Indicators:**
   - Small blue text showing "RatePrices ID: [objectId]" below each vehicle type in the pricing modal
   - "DEV MODE" badge in the modal header

2. **Console Debugging:**
   - Logs full RatePrices response data
   - Logs RatePrices array
   - Shows sample RatePrice object structure
   - Lists all RatePrice IDs for debugging

3. **Location:**
   - Access via: http://localhost:1337/dashboard/admin/services
   - Click on any service's price configuration button to see the debug info

## Usage

1. Ensure your development server is running with `NODE_ENV=development`
2. Navigate to the services dashboard
3. Click on the price configuration button for any service
4. Look for:
   - RatePrices IDs displayed below each vehicle type
   - Console logs with detailed RatePrices data
   - DEV MODE badge in the modal header

## Security Note

This debugging information is **only displayed in development mode**. Production environments will not show any of this debug information.

Created by Denisse Maldonado