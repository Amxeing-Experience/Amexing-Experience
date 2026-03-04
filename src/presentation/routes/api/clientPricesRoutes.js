/**
 * Client Prices API Routes.
 *
 * API endpoints for client-specific pricing management.
 * Created by Denisse Maldonado.
 */

const express = require('express');

const router = express.Router();
const Parse = require('parse/node');
const { authenticateToken } = require('../../../application/middleware/jwtMiddleware');

/**
 * GET /api/client-prices - Get client prices
 * Query params: clientId, itemType.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { clientId, itemType } = req.query;

    if (!clientId) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No client ID provided',
      });
    }

    const query = new Parse.Query('ClientPrices');
    query.equalTo('clientPtr', {
      __type: 'Pointer',
      className: 'ClientCompanies',
      objectId: clientId,
    });

    if (itemType) {
      query.equalTo('itemType', itemType);
    }

    query.doesNotExist('valid_until'); // Only active prices
    query.include('itemPtr');
    query.include('ratePtr');
    query.include('vehiclePtr');
    query.limit(10000);

    const clientPrices = await query.find({ useMasterKey: true });

    const result = clientPrices.map((cp) => {
      const vehiclePtr = cp.get('vehiclePtr');
      let vehicleName = null;

      // Handle vehiclePtr as either string or pointer
      if (vehiclePtr) {
        if (typeof vehiclePtr === 'string') {
          vehicleName = vehiclePtr;
        } else if (typeof vehiclePtr === 'object') {
          // If it's a pointer, get the name or type field
          vehicleName = vehiclePtr.get?.('name') || vehiclePtr.get?.('type') || vehiclePtr.id || vehiclePtr;
        }
      }

      return {
        id: cp.id,
        itemPtr: cp.get('itemPtr')?.id,
        ratePtr: cp.get('ratePtr')?.id,
        vehiclePtr: vehicleName,
        price: cp.get('price'),
        valid_until: cp.get('valid_until'),
        clientPtr: clientId,
        itemType: cp.get('itemType'),
      };
    });

    res.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error('Error fetching client prices:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/client-prices/by-tour/:tourId - Get client prices for specific tour.
 */
router.get('/by-tour/:tourId', authenticateToken, async (req, res) => {
  try {
    const { tourId } = req.params;
    const { clientId } = req.query;

    if (!clientId) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No client ID provided',
      });
    }

    const query = new Parse.Query('ClientPrices');
    query.equalTo('clientPtr', {
      __type: 'Pointer',
      className: 'ClientCompanies',
      objectId: clientId,
    });
    query.equalTo('itemPtr', {
      __type: 'Pointer',
      className: 'Tours',
      objectId: tourId,
    });
    query.equalTo('itemType', 'TOUR');
    query.doesNotExist('valid_until');
    query.include('ratePtr');
    query.include('vehiclePtr');
    query.limit(1000);

    const clientPrices = await query.find({ useMasterKey: true });

    const result = clientPrices.map((cp) => {
      const vehiclePtr = cp.get('vehiclePtr');
      let vehicleName = null;

      // Handle vehiclePtr as either string or pointer
      if (vehiclePtr) {
        if (typeof vehiclePtr === 'string') {
          vehicleName = vehiclePtr;
        } else if (typeof vehiclePtr === 'object') {
          // If it's a pointer, get the name or type field
          vehicleName = vehiclePtr.get?.('name') || vehiclePtr.get?.('type') || vehiclePtr.id || vehiclePtr;
        }
      }

      return {
        id: cp.id,
        itemPtr: tourId,
        ratePtr: cp.get('ratePtr')?.id,
        vehiclePtr: vehicleName,
        price: cp.get('price'),
        valid_until: cp.get('valid_until'),
        clientPtr: clientId,
        itemType: cp.get('itemType'),
      };
    });

    res.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error('Error fetching client prices by tour:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
