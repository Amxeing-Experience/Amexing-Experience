/**
 * Vehicle Rate Prices Cloud Functions
 * Creates initial pricing data for all vehicle types across all rates
 * Created by Denisse Maldonado.
 */

// Base hourly prices for each vehicle type (in MXN)
const BASE_PRICES = {
  SEDAN: 800,
  VAN: 1200,
  SUBURBAN: 1500,
  SPRINTER: 2000,
  'MODEL 3': 1800,
  'MODEL Y': 2200,
};

// Rate markups
const RATE_MARKUPS = {
  'First Class': 1.01,
  Económico: 1.05,
  'Green Class': 1.1,
  Premium: 1.2,
};

/**
 * Creates VehicleRatePrices table with initial data.
 */
Parse.Cloud.define('createVehicleRatePrices', async (request) => {
  const { user, master } = request;

  try {
    // Check if user has admin permissions or master key is used
    if (!user && !master) {
      throw new Error('Authentication required');
    }

    // Fetch all rates
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });

    if (rates.length === 0) {
      throw new Error('No rates found. Please run seed-005-rates first.');
    }

    // Fetch all vehicle types
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.equalTo('active', true);
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });

    if (vehicleTypes.length === 0) {
      throw new Error('No vehicle types found. Please run seed-006-vehicle-types first.');
    }

    // Check if prices already exist
    const existingQuery = new Parse.Query('VehicleRatePrices');
    existingQuery.doesNotExist('valid_until'); // Current prices only
    existingQuery.equalTo('exists', true);
    const existingCount = await existingQuery.count({ useMasterKey: true });

    if (existingCount > 0) {
      return {
        success: true,
        message: `VehicleRatePrices already exists with ${existingCount} records`,
        existing: existingCount,
      };
    }

    // Generate pricing data for all combinations
    const pricingData = [];
    const now = new Date();

    for (const rate of rates) {
      for (const vehicleType of vehicleTypes) {
        const basePrice = BASE_PRICES[vehicleType.get('code')] || 1000;
        const markup = RATE_MARKUPS[rate.get('name')] || 1.0;
        const finalPrice = Math.round(basePrice * markup);

        pricingData.push({
          rate,
          vehicleType,
          rateId: rate.id,
          vehicleTypeId: vehicleType.id,
          pricePerHour: finalPrice,
          currency: 'MXN',
          valid_from: now,
          created_by: 'system_seed',
          reason_for_change: 'Initial seed data',
          active: true,
          exists: true,
        });
      }
    }

    // Create price records
    const VehicleRatePrices = Parse.Object.extend('VehicleRatePrices');
    const priceObjects = [];

    for (const data of pricingData) {
      const price = new VehicleRatePrices();
      price.set('rateId', data.rateId);
      price.set('vehicleTypeId', data.vehicleTypeId);
      price.set('pricePerHour', data.pricePerHour);
      price.set('currency', data.currency);
      price.set('valid_from', data.valid_from);
      price.set('created_by', data.created_by);
      price.set('reason_for_change', data.reason_for_change);
      price.set('active', data.active);
      price.set('exists', data.exists);

      priceObjects.push(price);
    }

    // Save all records
    await Parse.Object.saveAll(priceObjects, { useMasterKey: true });

    // Create summary
    const summary = {};
    for (const data of pricingData) {
      const rateName = data.rate.get('name');
      const vehicleCode = data.vehicleType.get('code');
      const price = data.pricePerHour;

      if (!summary[rateName]) {
        summary[rateName] = [];
      }
      summary[rateName].push(`${vehicleCode}: $${price}`);
    }

    return {
      success: true,
      message: `Created ${priceObjects.length} vehicle rate prices`,
      created: priceObjects.length,
      rates: rates.length,
      vehicleTypes: vehicleTypes.length,
      summary,
    };
  } catch (error) {
    throw new Error(`Failed to create VehicleRatePrices: ${error.message}`);
  }
});

/**
 * Get all current vehicle rate prices.
 */
Parse.Cloud.define('getAllVehicleRatePrices', async (request) => {
  const { user } = request;

  try {
    // Require authentication for staging/production environments
    if (!user) {
      throw new Error('Authentication required');
    }

    const query = new Parse.Query('VehicleRatePrices');
    query.doesNotExist('valid_until'); // Current prices only
    query.equalTo('exists', true);
    query.equalTo('active', true);

    const prices = await query.find({ useMasterKey: true });

    return {
      success: true,
      count: prices.length,
      prices: prices.map((p) => ({
        id: p.id,
        rateId: p.get('rateId'),
        vehicleTypeId: p.get('vehicleTypeId'),
        pricePerHour: p.get('pricePerHour'),
        currency: p.get('currency'),
        validFrom: p.get('valid_from'),
        active: p.get('active'),
      })),
    };
  } catch (error) {
    throw new Error(`Failed to get VehicleRatePrices: ${error.message}`);
  }
});

/**
 * Create additional rates for demonstration.
 */
Parse.Cloud.define('createDemoRates', async (request) => {
  const { user, master } = request;

  try {
    // Check if user has admin permissions or master key is used
    if (!user && !master) {
      throw new Error('Authentication required');
    }

    const additionalRates = [
      { name: 'First Class', active: true, exists: true },
      { name: 'Económico', active: true, exists: true },
      { name: 'Green Class', active: true, exists: true },
      { name: 'Premium', active: true, exists: true },
    ];

    const createdRates = [];

    for (const rateData of additionalRates) {
      // Check if rate already exists
      const existingQuery = new Parse.Query('Rate');
      existingQuery.equalTo('name', rateData.name);
      existingQuery.equalTo('exists', true);
      const existing = await existingQuery.first({ useMasterKey: true });

      if (!existing) {
        const Rate = Parse.Object.extend('Rate');
        const rate = new Rate();
        rate.set('name', rateData.name);
        rate.set('active', rateData.active);
        rate.set('exists', rateData.exists);

        await rate.save(null, { useMasterKey: true });
        createdRates.push(rateData.name);
      }
    }

    return {
      success: true,
      message: `Created ${createdRates.length} new rates`,
      created: createdRates,
      skipped: additionalRates.length - createdRates.length,
    };
  } catch (error) {
    throw new Error(`Failed to create demo rates: ${error.message}`);
  }
});

/**
 * Clear and recreate VehicleRatePrices table with corrected data.
 */
Parse.Cloud.define('recreateVehicleRatePrices', async (request) => {
  const { user, master } = request;

  try {
    // Check if user has admin permissions or master key is used
    if (!user && !master) {
      throw new Error('Authentication required');
    }

    // Clear existing records
    const existingQuery = new Parse.Query('VehicleRatePrices');
    const existingRecords = await existingQuery.find({ useMasterKey: true });

    if (existingRecords.length > 0) {
      await Parse.Object.destroyAll(existingRecords, { useMasterKey: true });
    }

    // Fetch all rates
    const rateQuery = new Parse.Query('Rate');
    rateQuery.equalTo('exists', true);
    rateQuery.equalTo('active', true);
    const rates = await rateQuery.find({ useMasterKey: true });

    // Fetch all vehicle types (corrected table name)
    const vehicleQuery = new Parse.Query('VehicleType');
    vehicleQuery.equalTo('exists', true);
    vehicleQuery.equalTo('active', true);
    const vehicleTypes = await vehicleQuery.find({ useMasterKey: true });

    // Generate pricing data for all combinations
    const pricingData = [];
    const now = new Date();

    for (const rate of rates) {
      for (const vehicleType of vehicleTypes) {
        const basePrice = BASE_PRICES[vehicleType.get('code')] || 1000;
        const markup = RATE_MARKUPS[rate.get('name')] || 1.0;
        const finalPrice = Math.round(basePrice * markup);

        pricingData.push({
          rate,
          vehicleType,
          rateId: rate.id,
          vehicleTypeId: vehicleType.id,
          pricePerHour: finalPrice,
          currency: 'MXN',
          valid_from: now,
          created_by: 'system_seed',
          reason_for_change: 'Recreated with corrected table names',
          active: true,
          exists: true,
        });
      }
    }

    // Create price records
    const VehicleRatePrices = Parse.Object.extend('VehicleRatePrices');
    const priceObjects = [];

    for (const data of pricingData) {
      const price = new VehicleRatePrices();
      price.set('rateId', data.rateId);
      price.set('vehicleTypeId', data.vehicleTypeId);
      price.set('pricePerHour', data.pricePerHour);
      price.set('currency', data.currency);
      price.set('valid_from', data.valid_from);
      price.set('created_by', data.created_by);
      price.set('reason_for_change', data.reason_for_change);
      price.set('active', data.active);
      price.set('exists', data.exists);

      priceObjects.push(price);
    }

    // Save all records
    await Parse.Object.saveAll(priceObjects, { useMasterKey: true });

    // Create summary
    const summary = {};
    for (const data of pricingData) {
      const rateName = data.rate.get('name');
      const vehicleCode = data.vehicleType.get('code');
      const price = data.pricePerHour;

      if (!summary[rateName]) {
        summary[rateName] = [];
      }
      summary[rateName].push(`${vehicleCode}: $${price}`);
    }

    return {
      success: true,
      message: `Recreated ${priceObjects.length} vehicle rate prices`,
      cleared: existingRecords.length,
      created: priceObjects.length,
      rates: rates.length,
      vehicleTypes: vehicleTypes.length,
      summary,
    };
  } catch (error) {
    throw new Error(`Failed to recreate VehicleRatePrices: ${error.message}`);
  }
});

/**
 * Get all TourPrices for vehicle dropdown population.
 */
Parse.Cloud.define('getTourPrices', async (request) => {
  const { user } = request;

  try {
    // Require authentication
    if (!user) {
      throw new Error('Authentication required');
    }

    const query = new Parse.Query('TourPrices');
    query.doesNotExist('valid_until'); // Only active prices
    query.equalTo('exists', true);
    query.include('tourPtr');
    query.include('ratePtr');
    query.limit(10000);

    const tourPrices = await query.find({ useMasterKey: true });

    return tourPrices.map((tp) => ({
      id: tp.id,
      tourPtr: tp.get('tourPtr')?.id,
      ratePtr: tp.get('ratePtr')?.id,
      vehicleType: tp.get('vehicleType'),
      price: tp.get('price'),
      valid_until: tp.get('valid_until'),
    }));
  } catch (error) {
    throw new Error(`Failed to get TourPrices: ${error.message}`);
  }
});

/**
 * Get ClientPrices for specific client and tour type.
 */
Parse.Cloud.define('getClientPrices', async (request) => {
  const { user, params } = request;
  const { clientId, itemType } = params;

  try {
    // Require authentication
    if (!user) {
      throw new Error('Authentication required');
    }

    if (!clientId) {
      return []; // No client specified
    }

    const query = new Parse.Query('ClientPrices');
    query.equalTo('clientPtr', {
      __type: 'Pointer',
      className: 'ClientCompanies',
      objectId: clientId,
    });
    query.equalTo('itemType', itemType || 'TOUR');
    query.doesNotExist('valid_until'); // Only active prices
    query.include('itemPtr');
    query.include('ratePtr');
    query.limit(10000);

    const clientPrices = await query.find({ useMasterKey: true });

    return clientPrices.map((cp) => ({
      id: cp.id,
      itemPtr: cp.get('itemPtr')?.id,
      ratePtr: cp.get('ratePtr')?.id,
      vehiclePtr: cp.get('vehiclePtr'),
      price: cp.get('price'),
      valid_until: cp.get('valid_until'),
      clientPtr: clientId,
      itemType: cp.get('itemType'),
    }));
  } catch (error) {
    throw new Error(`Failed to get ClientPrices: ${error.message}`);
  }
});

module.exports = {
  // Export for testing if needed
};
