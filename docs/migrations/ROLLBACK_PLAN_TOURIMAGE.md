# TourImage Migration Rollback Plan

## Overview
This document provides steps to rollback the TourImage implementation if issues arise.

## Changes Made
1. Created TourImage Parse object model (`src/domain/models/TourImage.js`)
2. Created TourImageController (`src/application/controllers/api/TourImageController.js`) 
3. Created tour image API routes (`src/presentation/routes/api/tourImagesRoutes.js`)
4. Modified ToursController to support both TourImage objects and legacy photos array
5. Added TourImage routes to apiRoutes.js

## Rollback Steps

### Step 1: Revert ToursController Changes
1. Remove TourImage import from ToursController.js
2. Remove `createTourImageFromUpload` method
3. Remove `formatTourImagesForResponse` method  
4. Revert `getTourById` to only use legacy photos array
5. Revert `createTour` and `updateTour` to use original photo processing

### Step 2: Remove New Files
```bash
rm src/domain/models/TourImage.js
rm src/application/controllers/api/TourImageController.js
rm src/presentation/routes/api/tourImagesRoutes.js
rm scripts/migrations/migrate-tour-photos-to-tourimages.js
```

### Step 3: Remove TourImage Routes
Remove this line from `src/presentation/routes/apiRoutes.js`:
```javascript
router.use('/tours', require('./api/tourImagesRoutes')); // Tour images endpoints
```

### Step 4: Clean Up Database (Optional)
If TourImage objects were created, they can be removed:
```javascript
const TourImage = Parse.Object.extend('TourImage');
const query = new Parse.Query(TourImage);
const images = await query.find({useMasterKey: true});
await Parse.Object.destroyAll(images, {useMasterKey: true});
```

## Recovery Commands
```bash
# Revert git changes
git checkout HEAD~1 -- src/application/controllers/api/ToursController.js
git checkout HEAD~1 -- src/presentation/routes/apiRoutes.js

# Remove new files
git rm src/domain/models/TourImage.js
git rm src/application/controllers/api/TourImageController.js  
git rm src/presentation/routes/api/tourImagesRoutes.js
git rm scripts/migrations/migrate-tour-photos-to-tourimages.js

# Restart server
yarn dev
```

## Verification After Rollback
1. Visit http://localhost:1337/dashboard/admin/tours
2. Open "Editar Tour" modal 
3. Verify existing tour photos are visible
4. Test photo upload functionality
5. Check server logs for errors

## Notes
- The current implementation maintains backward compatibility
- Legacy tour photos in the `photos` array field should continue working
- No data loss should occur with rollback as legacy data structure is preserved