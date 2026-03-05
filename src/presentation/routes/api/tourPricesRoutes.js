/**
 * Tour Prices API Routes.
 *
 * API endpoints for tour pricing management.
 * Created by Denisse Maldonado.
 */

const express = require('express');

const router = express.Router();
const Parse = require('parse/node');
const { authenticateToken } = require('../../../application/middleware/jwtMiddleware');

/**
 * GET /api/tour-prices - Get all active tour prices
 * Returns all tour prices for populating vehicle dropdowns.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const query = new Parse.Query('TourPrices');
    query.doesNotExist('valid_until'); // Only active prices
    query.equalTo('exists', true);
    query.include('tourPtr');
    query.include('ratePtr');
    query.include('vehicleType');
    query.limit(10000);

    const tourPrices = await query.find({ useMasterKey: true });

    const result = tourPrices.map((tp) => {
      const vehicleType = tp.get('vehicleType');
      let vehicleTypeId = null;
      let vehicleTypeName = null;

      // Handle vehicleType as either string or pointer
      if (vehicleType) {
        if (typeof vehicleType === 'string') {
          vehicleTypeId = vehicleType;
          vehicleTypeName = vehicleType;
        } else if (typeof vehicleType === 'object') {
          // If it's a pointer, get the ID and name
          vehicleTypeId = vehicleType.id;
          vehicleTypeName = vehicleType.get?.('name') || vehicleType.get?.('type') || vehicleType.id;
        }
      }

      return {
        id: tp.id,
        tourPtr: tp.get('tourPtr')?.id,
        ratePtr: tp.get('ratePtr')?.id,
        vehicleType: vehicleTypeName,
        vehicleTypeId,
        price: tp.get('price'),
        valid_until: tp.get('valid_until'),
      };
    });

    res.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error('Error fetching tour prices:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/tour-prices/by-tour/:tourId - Get prices for specific tour.
 */
router.get('/by-tour/:tourId', authenticateToken, async (req, res) => {
  try {
    const { tourId } = req.params;

    const query = new Parse.Query('TourPrices');
    query.equalTo('tourPtr', {
      __type: 'Pointer',
      className: 'Tours',
      objectId: tourId,
    });
    query.doesNotExist('valid_until');
    query.equalTo('exists', true);
    query.include('ratePtr');
    query.include('vehicleType');
    query.limit(1000);

    const tourPrices = await query.find({ useMasterKey: true });

    const result = tourPrices.map((tp) => {
      const vehicleType = tp.get('vehicleType');
      let vehicleTypeId = null;
      let vehicleTypeName = null;

      // Handle vehicleType as either string or pointer
      if (vehicleType) {
        if (typeof vehicleType === 'string') {
          vehicleTypeId = vehicleType;
          vehicleTypeName = vehicleType;
        } else if (typeof vehicleType === 'object') {
          // If it's a pointer, get the ID and name
          vehicleTypeId = vehicleType.id;
          vehicleTypeName = vehicleType.get?.('name') || vehicleType.get?.('type') || vehicleType.id;
        }
      }

      return {
        id: tp.id,
        tourPtr: tourId,
        ratePtr: tp.get('ratePtr')?.id,
        vehicleType: vehicleTypeName,
        vehicleTypeId,
        price: tp.get('price'),
        valid_until: tp.get('valid_until'),
      };
    });

    res.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error('Error fetching tour prices by tour:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
